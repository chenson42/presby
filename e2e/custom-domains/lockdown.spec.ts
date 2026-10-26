/**
 * lockdown.spec.ts - a church's own domain serves ONE thing, that church's public
 * site, and nothing else the platform has (Track F, Batch 1c; docs/work-log/
 * 2026-10-19-custom-domains.md: DECISION-176/177, Phase 2 R1/R3/R4, A6, T1,
 * adversarial A2/A3/A8/A9, F151). Runs in BOTH lanes (dev, and `next build && next start`).
 *
 * Proves, against a running server with real hosts in `Host`:
 *   - every platform route (`/api/*` including auth, webhooks, ingest and cron; the
 *     auth pages; `/home`, `/launch`, `/orgs`, `/o/*`, `/admin`, `/account`; the slug URL
 *     of ANY org; the internal `/site/<host>` target) is the same neutral 404 on a
 *     serving host as a path the church simply has no page for, and on an UNCLAIMED host;
 *   - NO `Set-Cookie` on any response class: page, 404, asset, sitemap, robots, both
 *     redirects, the probe's 204, and the cron pass-through (the server-action POST is in
 *     forms-and-giving.spec.ts, where a real browser submits a real form);
 *   - the host is a lookup key, not an identity: a spoofed `X-Forwarded-Host` /
 *     `Forwarded` / `X-Original-Host` changes nothing, in either direction;
 *   - `/site/<host>` and `/site/<other-slug>` reach nothing from either host class;
 *   - the probe answers a valid HMAC for exactly this host with a bodiless 204, and
 *     nothing else does (T1);
 *   - the cron pass-through (A6): a valid bearer reaches ALL FOUR cron handlers on a custom
 *     host; a missing, wrong, empty or wrong-length bearer is byte-identical to the 404 of
 *     any other `/api/*` path; encoded, upper-case and extra-segment variants never reach a
 *     handler even with the valid bearer; trailing-slash and doubled-slash variants never answer
 *     with a handler's output in ONE hop (Next's 308 or the 404); dot-segment variants, sent
 *     raw over node:http, are collapsed by Next BEFORE the proxy runs, so without the bearer they
 *     are the neutral 404 and with it they reach the same handler the exact path does (A6
 *     permits that: the bearer, not the spelling, is the credential), while a dot-segment that
 *     climbs OUT of /api/cron reaches no handler at all, bearer or not;
 *   - the raw-path helper is itself checked (an echo server asserts each dot-segment and
 *     climb-out path arrives byte-for-byte), so the raw cases cannot pass vacuously;
 *   - the static exclusions (`favicon.ico`, `*.svg|png|...`, `_next/static`) are the ONLY
 *     platform files that answer on a custom host (F151, an enumerated residual).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type APIResponse } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { makeProbe } from "../../src/lib/domains/probe";
import {
  HOSTS,
  TITLES,
  buildWorld,
  getPublicRenderFlag,
  portOf,
  rawGet,
  rawPathGet,
  rawPost,
  setPublicRenderFlag,
  shape,
  visibleText,
  teardownWorld,
  type World,
} from "../support/custom-hosts";

let sql: Sql;
let world: World;
let originalFlag: boolean;

test.beforeAll(async () => {
  sql = platformSql("custom-domains/lockdown.spec");
  originalFlag = await getPublicRenderFlag(sql);
  world = await buildWorld(sql);
  await setPublicRenderFlag(sql, true);
});

test.afterAll(async () => {
  if (sql) {
    await setPublicRenderFlag(sql, originalFlag);
    expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalFlag);
  }
  await teardownWorld(sql, world);
});

const CRON_SECRET = process.env.CRON_SECRET ?? "giving-e2e-cron-secret";
const CRON_PATHS = ["/api/cron/email-queue", "/api/cron/maintenance", "/api/cron/giving", "/api/cron/domains"] as const;

const noCookie = (res: APIResponse, label: string) => expect(res.headers()["set-cookie"], `Set-Cookie on ${label}`).toBeUndefined();

// Every platform route. None may mean anything on a church's own domain.
const PLATFORM_PATHS = [
  "/api/auth/csrf",
  "/api/auth/session",
  "/api/auth/providers",
  "/api/auth/signin",
  "/api/webhooks/stripe",
  "/api/webhooks/resend",
  "/api/sites/ingest",
  "/api/cron/email-queue",
  "/api/cron/domains",
  "/api/does-not-exist",
  "/signin",
  "/totp",
  "/forgot-password",
  "/reset-password",
  "/file-statistics",
  "/file-statistics/submitted",
  "/access-pending",
  "/home",
  "/launch",
  "/no-organization",
  "/orgs",
  "/account",
  "/account/2fa",
  "/account/verify-email/abc",
  "/admin",
  "/admin/organizations",
  "/developer",
  "/developer/tables/roll_actions",
  "/developer/schema.json",
  "/o/e2e-alpha",
  "/o/e2e-alpha/admin",
  // The Community route move (DECISION-201): the old path is redirected ONLY on a platform host (F151),
  // so here it is the neutral 404 with no `location`, and the new path is the same neutral 404.
  "/o/e2e-alpha/admin/members",
  "/o/e2e-alpha/admin/members/new?x=1",
  "/o/e2e-alpha/admin/community",
] as const;

// Looping over dozens of paths against a DEV server compiles each route on first touch; allow for it.
test.describe.configure({ timeout: 180_000 });

test.describe("platform routes on a church's own domain", () => {
  test("every one is the same neutral 404 as a path the church has no page for - GET, on a serving host", async ({ request, baseURL }) => {
    const reference = await shape(await rawGet(request, baseURL, HOSTS.oneCanonical, "/no-such-page-at-all"), HOSTS.oneCanonical);
    expect(reference.status).toBe(404);
    for (const path of PLATFORM_PATHS) {
      const res = await rawGet(request, baseURL, HOSTS.oneCanonical, path);
      expect(res.status(), path).toBe(404);
      noCookie(res, path);
      const snap = await shape(res, HOSTS.oneCanonical);
      const body = snap.body;
      // Nothing of the platform's own answer leaks: no NextAuth JSON, no sign-in form, no redirect.
      expect(body, path).not.toMatch(/"csrfToken"|Sign in to|callbackUrl=/i);
      expect(res.headers()["location"], path).toBeUndefined();
      // JSON/plain 404s for non-page routes differ from the HTML page 404 only in what a missing page is; the catch-all
      // answers ALL of these paths (they are bundle paths), so they are identical to the reference.
      expect(snap, path).toEqual(reference);
    }
  });

  test("...and on an UNCLAIMED host, where it is the same 404 as its home page", async ({ request, baseURL }) => {
    const reference = await shape(await rawGet(request, baseURL, HOSTS.unknown, "/"), HOSTS.unknown);
    expect(reference.status).toBe(404);
    for (const path of PLATFORM_PATHS) {
      const res = await rawGet(request, baseURL, HOSTS.unknown, path);
      noCookie(res, path);
      expect(await shape(res, HOSTS.unknown), path).toEqual(reference);
    }
  });

  test("a POST to a platform route is also nothing: credentials sign-in, webhooks, ingest", async ({ request, baseURL }) => {
    for (const path of ["/api/auth/callback/credentials", "/api/auth/signout", "/api/webhooks/stripe", "/api/webhooks/resend", "/api/sites/ingest"]) {
      const res = await rawPost(request, baseURL, HOSTS.oneCanonical, path, {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        data: "email=a%40b.invalid&password=x",
      });
      expect(res.status(), path).toBe(404);
      noCookie(res, path);
      expect(visibleText(await res.text()), path).not.toMatch(/csrfToken|Unauthorized|CredentialsSignin|invalid signature/i);
    }
  });

  test("the platform host is unaffected: /api/auth/csrf answers and /signin renders", async ({ request, baseURL }) => {
    const csrf = await request.get(new URL("/api/auth/csrf", baseURL).toString());
    expect(csrf.status()).toBe(200);
    expect(await csrf.json()).toHaveProperty("csrfToken");
    const signin = await request.get(new URL("/signin", baseURL).toString());
    expect(signin.status()).toBe(200);
  });
});

test.describe("/site/<anything> reaches nothing it should not", () => {
  test("on a custom host, /site/<slug> of ANY org (even its own) and /site/<host> are the neutral 404", async ({ request, baseURL }) => {
    const reference = await shape(await rawGet(request, baseURL, HOSTS.oneCanonical, "/no-such-page-at-all"), HOSTS.oneCanonical);
    for (const path of [
      `/site/${world.one.slug}`,
      `/site/${world.two.slug}`,
      `/site/${world.two.slug}/about`,
      "/site/e2e-alpha",
      `/site/${HOSTS.two}`,
      `/site/${HOSTS.oneCanonical}`,
      `/site/${HOSTS.two}/about`,
      "/site",
    ]) {
      const res = await rawGet(request, baseURL, HOSTS.oneCanonical, path);
      expect(res.status(), path).toBe(404);
      noCookie(res, path);
      const body = visibleText(await res.text());
      expect(body, path).not.toContain(TITLES.two);
      expect(await shape(res, HOSTS.oneCanonical), path).toEqual(reference);
    }
  });

  test("on the platform host, the internal /site/<host> target is not addressable (a dot in the segment, or %2e)", async ({ request, baseURL }) => {
    for (const path of [
      `/site/${HOSTS.two}`,
      `/site/${HOSTS.two}/about`,
      `/site/${HOSTS.oneCanonical}`,
      "/site/a.b",
      "/site/a%2eb",
      "/site/a%2Eb/about",
      "/site/.hidden",
    ]) {
      const res = await request.get(new URL(path, baseURL).toString(), { maxRedirects: 0, failOnStatusCode: false });
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain(TITLES.two);
      noCookie(res, path);
    }
  });

  test("a path the proxy matcher skips cannot smuggle a key past the resolver (Host !== key, or a slug on a custom host)", async ({ request, baseURL }) => {
    // `.png` is matcher-excluded, so the proxy neither rewrites nor 404s these: the ROUTE and the resolver decide.
    for (const [host, path] of [
      [HOSTS.oneCanonical, `/site/${HOSTS.two}/x.png`],
      ["localhost", `/site/${HOSTS.two}/x.png`],
      [HOSTS.two, `/site/${world.one.slug}/x.png`],
      [HOSTS.two, `/site/${HOSTS.oneCanonical}/x.png`],
    ] as const) {
      const res = await rawGet(request, baseURL, host, path);
      expect(res.status(), `${host} ${path}`).toBe(404);
      const body = await res.text();
      expect(body).not.toContain(TITLES.one);
      expect(body).not.toContain(TITLES.two);
    }
  });
});

test.describe("a host is a lookup key, not an identity (R3, A2)", () => {
  const SPOOF = (as: string) => ({
    "x-forwarded-host": as,
    forwarded: `host=${as};proto=https`,
    "x-original-host": as,
    "x-forwarded-proto": "https",
  });

  test("a church host claiming to be the platform stays a church host", async ({ request, baseURL }) => {
    const platform = `localhost:${portOf(baseURL)}`;
    // /signin on the platform host is a 200 sign-in page; on a church host it is a 404 whatever the headers say.
    const plain = await rawGet(request, baseURL, HOSTS.oneCanonical, "/signin");
    const spoofed = await rawGet(request, baseURL, HOSTS.oneCanonical, "/signin", SPOOF(platform));
    expect(plain.status()).toBe(404);
    expect(spoofed.status()).toBe(404);
    // ...and /api/auth/csrf likewise.
    const csrf = await rawGet(request, baseURL, HOSTS.oneCanonical, "/api/auth/csrf", SPOOF(platform));
    expect(csrf.status()).toBe(404);
    noCookie(csrf, "spoofed csrf");
  });

  test("a church host claiming to be ANOTHER church serves its own site, never the other's", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, HOSTS.oneCanonical, "/", SPOOF(HOSTS.two));
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(TITLES.one);
    expect(html).not.toContain(TITLES.two);
  });

  test("the platform host claiming to be a church stays the platform: no church page, no rewrite", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, "localhost", "/signin", SPOOF(HOSTS.oneCanonical));
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain(TITLES.one);
    const home = await rawGet(request, baseURL, "localhost", "/home", SPOOF(HOSTS.two));
    // Unauthenticated: the platform's own redirect to /signin, not a church page.
    expect(home.status()).toBe(307);
    expect(new URL(home.headers()["location"]!, baseURL).pathname).toBe("/signin");
  });

  test("an unclaimed host spoofing a serving church is still unclaimed", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, HOSTS.unknown, "/", SPOOF(HOSTS.oneCanonical));
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(TITLES.one);
  });

  test("a serving host's sitemap and robots name the ROW's canonical host, whatever the forwarded headers say", async ({ request, baseURL }) => {
    const sitemap = await (await rawGet(request, baseURL, HOSTS.oneCanonical, "/sitemap.xml", SPOOF("evil.invalid"))).text();
    expect(sitemap).toContain(`https://${HOSTS.oneCanonical}/`);
    expect(sitemap).not.toContain("evil.invalid");
    const robots = await (await rawGet(request, baseURL, HOSTS.oneCanonical, "/robots.txt", SPOOF("evil.invalid"))).text();
    expect(robots).toContain(`Sitemap: https://${HOSTS.oneCanonical}/sitemap.xml`);
    expect(robots).not.toContain("evil.invalid");
    // ...and an alias redirect names the row's canonical host, never the spoofed one.
    const alias = await rawGet(request, baseURL, HOSTS.oneAlias, "/about", SPOOF("evil.invalid"));
    expect(alias.status()).toBe(307);
    expect(alias.headers()["location"]).toBe(`https://${HOSTS.oneCanonical}/about`);
  });
});

test.describe("no Set-Cookie on any response class", () => {
  test("page, 404, asset, sitemap, robots, both redirects, and an HTML page with a sub-path", async ({ request, baseURL }) => {
    const classes: Array<[string, string, string]> = [
      ["200 page", HOSTS.oneCanonical, "/"],
      ["200 sub-page", HOSTS.oneCanonical, "/about"],
      ["404 page", HOSTS.oneCanonical, "/nope"],
      ["404 unclaimed host", HOSTS.unknown, "/"],
      ["asset", HOSTS.oneCanonical, `/assets/${world.oneImageId}`],
      ["404 asset", HOSTS.oneCanonical, "/assets/00000000-0000-4000-8000-000000000000"],
      ["sitemap", HOSTS.oneCanonical, "/sitemap.xml"],
      ["robots", HOSTS.oneCanonical, "/robots.txt"],
      ["alias redirect", HOSTS.oneAlias, "/about"],
      ["alias sitemap redirect", HOSTS.oneAlias, "/sitemap.xml"],
      ["slug URL redirect", "localhost", `/site/${world.two.slug}/about`],
      ["slug sitemap redirect", "localhost", `/site/${world.two.slug}/sitemap.xml`],
      ["give 404", HOSTS.oneCanonical, "/give"],
      ["give/return 404", HOSTS.oneCanonical, "/give/return?session_id=cs_x"],
    ];
    for (const [label, host, path] of classes) {
      const res = await rawGet(request, baseURL, host, path);
      noCookie(res, label);
    }
  });

  test("a whole browser journey on a church's domain leaves the cookie jar EMPTY", async ({ page, context, baseURL }) => {
    const origin = `http://${HOSTS.oneCanonical}:${portOf(baseURL)}`;
    for (const path of ["/", "/about", "/nope", "/sitemap.xml", "/robots.txt"]) {
      await page.goto(`${origin}${path}`);
    }
    await page.goto(`http://${HOSTS.oneAlias}:${portOf(baseURL)}/about`, { waitUntil: "commit" }).catch(() => {
      // The alias 307s to https://<canonical> which does not resolve in this harness (https on a mapped name): fine.
    });
    expect(await context.cookies(), "no cookie for any host").toEqual([]);
  });
});

test.describe("the live-ness probe (T1)", () => {
  const secret = process.env.AUTH_SECRET;

  test.beforeEach(() => {
    expect(secret, "AUTH_SECRET must be in the environment (it derives the probe key); it is in .env.local").toBeTruthy();
  });

  test("a valid probe for exactly this host gets a bodiless 204 and the ack, with no cookie", async ({ request, baseURL }) => {
    const probe = makeProbe(HOSTS.two, secret);
    const res = await rawGet(request, baseURL, HOSTS.two, "/", { "x-presby-probe": probe.header });
    expect(res.status()).toBe(204);
    expect(res.headers()["x-presby-probe-ack"]).toBe(probe.expectedAck);
    expect(await res.text()).toBe("");
    noCookie(res, "probe 204");
  });

  test("it answers on an UNCLAIMED host too (it proves routing, not tenancy) and on any path", async ({ request, baseURL }) => {
    const probe = makeProbe(HOSTS.unknown, secret);
    const res = await rawGet(request, baseURL, HOSTS.unknown, "/some/deep/path?x=1", { "x-presby-probe": probe.header });
    expect(res.status()).toBe(204);
    expect(res.headers()["x-presby-probe-ack"]).toBe(probe.expectedAck);
  });

  test("a probe minted for another host, a forged MAC or a malformed header is not answered", async ({ request, baseURL }) => {
    const other = makeProbe(HOSTS.oneCanonical, secret);
    const wrongHost = await rawGet(request, baseURL, HOSTS.two, "/", { "x-presby-probe": other.header });
    expect(wrongHost.status()).toBe(200); // the site, as for any visitor
    expect(wrongHost.headers()["x-presby-probe-ack"]).toBeUndefined();

    for (const bad of ["garbage", `${"0".repeat(32)}.forged`, ""]) {
      const res = await rawGet(request, baseURL, HOSTS.two, "/", { "x-presby-probe": bad });
      expect(res.headers()["x-presby-probe-ack"], bad).toBeUndefined();
    }
  });

  test("the platform host ignores the probe header", async ({ request, baseURL }) => {
    const probe = makeProbe("localhost", secret);
    const res = await rawGet(request, baseURL, "localhost", "/signin", { "x-presby-probe": probe.header });
    expect(res.status()).toBe(200);
    expect(res.headers()["x-presby-probe-ack"]).toBeUndefined();
  });
});

test.describe("the cron pass-through on a custom host (A6)", () => {
  const bearer = { authorization: `Bearer ${CRON_SECRET}` };

  test("a valid bearer reaches EACH of the four cron handlers, with no cookie", async ({ request, baseURL }) => {
    for (const path of CRON_PATHS) {
      // ?limit=1 keeps the email queue and the domain sweep to (at most) one unit of work.
      const res = await rawGet(request, baseURL, HOSTS.oneCanonical, `${path}?limit=1`, bearer);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"], path).toContain("application/json");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok, path).toBe(true);
      noCookie(res, path);
    }
  });

  test("it works on an UNCLAIMED host as well (the exemption is keyed on the bearer, not on tenancy)", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, HOSTS.unknown, "/api/cron/giving", bearer);
    expect(res.status()).toBe(200);
  });

  test("a missing, wrong, empty or wrong-length bearer is byte-identical to the 404 of any other /api/* path", async ({ request, baseURL }) => {
    const reference = await shape(await rawGet(request, baseURL, HOSTS.oneCanonical, "/api/auth/csrf"), HOSTS.oneCanonical);
    expect(reference.status).toBe(404);
    const bad: Array<Record<string, string>> = [
      {},
      { authorization: "" },
      { authorization: "Bearer " },
      { authorization: "Bearer wrong" },
      { authorization: `Bearer ${CRON_SECRET}x` },
      { authorization: `Bearer ${CRON_SECRET.slice(0, -1)}` },
      { authorization: CRON_SECRET },
      { authorization: `bearer ${CRON_SECRET}` },
      { authorization: `Basic ${CRON_SECRET}` },
    ];
    for (const path of CRON_PATHS) {
      for (const headers of bad) {
        const res = await rawGet(request, baseURL, HOSTS.oneCanonical, path, headers);
        const label = `${path} ${JSON.stringify(headers)}`;
        expect(res.status(), label).toBe(404);
        noCookie(res, label);
        expect(await shape(res, HOSTS.oneCanonical), label).toEqual(reference);
      }
    }
  });

  test("a user-agent or schedule header is not a credential (Vercel's cron markers open nothing)", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, HOSTS.oneCanonical, "/api/cron/email-queue", {
      "user-agent": "vercel-cron/1.0",
      "x-vercel-cron-schedule": "*/5 * * * *",
    });
    expect(res.status()).toBe(404);
  });

  test("encoded, upper-case and extra-segment variants never reach a handler, even with the valid bearer", async ({ request, baseURL }) => {
    const variants = [
      "/api/cron/%65mail-queue",
      "/api/cron%2Femail-queue",
      "/API/cron/email-queue",
      "/api/CRON/email-queue",
      "/api/cron/Email-Queue",
      "/api/cron/email-queue/extra",
      "/api/cron/unknown",
      "/api/cron/email-queue%2F",
    ];
    for (const path of variants) {
      const res = await rawGet(request, baseURL, HOSTS.oneCanonical, path, bearer);
      expect(res.status(), path).toBe(404);
      expect(res.headers()["content-type"] ?? "", path).not.toContain("application/json");
      noCookie(res, path);
    }
    // A trailing slash and a doubled leading slash are normalised by Next itself (a 308 to the exact path, the same
    // for any URL, before the proxy runs). That is the "unless Next has already normalized them" case: the variant
    // never answers with a handler's output in ONE hop.
    for (const path of ["/api/cron/email-queue/", "//api/cron/email-queue"]) {
      const res = await rawGet(request, baseURL, HOSTS.oneCanonical, path, bearer);
      expect([308, 404], path).toContain(res.status());
      expect(res.headers()["content-type"] ?? "", path).not.toContain("application/json");
      noCookie(res, path);
    }
  });

  // DOT-SEGMENTS (A6, F-2). The client libraries above normalise `.` / `..` away before sending, so these go out
  // through node:http with the request-target exactly as written. MEASURED behaviour (dev and production build):
  // Next collapses dot-segments (literal and %2e / %2E) BEFORE the proxy runs, so the proxy sees the exact path.
  // Therefore: with NO bearer the variant is the same neutral 404 as any other /api/* path on a custom host; with
  // the valid bearer it reaches the handler exactly as the exact path does (A6 permits "unless Next has already
  // normalized them" - the bearer, not the spelling, is the credential). Neither is a bypass: the bearer is still
  // required, and what it opens is the one handler the exact path opens.
  test.describe("raw dot-segment paths (sent un-normalized)", () => {
    const DOT_VARIANTS = [
      "/api/cron/./email-queue",
      "/api/cron/x/../email-queue",
      "/api/cron/%2e/email-queue",
      "/api/cron/%2E/email-queue",
      "/api/cron/x/%2e%2e/email-queue",
      "/api/cron/x/%2E%2E/email-queue",
      "/api/cron/x/.%2e/email-queue",
      "/api/cron/%2e%2e/cron/email-queue",
      "/api/cron/./giving",
    ];
    // Paths whose dot-segments climb out of /api/cron (collapsing them yields a platform route).
    const CLIMB_OUT = ["/api/cron/../auth/csrf", "/api/cron/%2e%2e/auth/csrf", "/api/cron/x/../../auth/session"];

    // HARNESS SELF-CHECK (QA run 2, F-3). Every behavioural assertion below would pass unchanged if `rawPathGet`
    // silently normalised the path client-side (measured: raw and WHATWG-normalised sends give identical
    // responses), so the property "the request-target leaves the client verbatim" is asserted directly, against
    // a local node:http server that records what it received.
    test("harness self-check: rawPathGet puts every dot-segment and climb-out path on the wire verbatim (and a normalizing client would not)", async () => {
      const received: string[] = [];
      const server = http.createServer((req, res) => {
        received.push(req.url ?? "");
        res.writeHead(200, { "content-type": "text/plain" }).end("echo");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const echoBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const all = [...DOT_VARIANTS, ...CLIMB_OUT];
        for (const path of all) {
          for (const target of [path, `${path}?limit=1`]) {
            received.length = 0;
            const res = await rawPathGet(echoBase, HOSTS.oneCanonical, target, bearer);
            expect(res.status, target).toBe(200);
            expect(received, target).toEqual([target]);
          }
        }
        // Non-vacuity: a normalising client (the WHATWG URL parser Playwright's `request` and a browser use) would
        // have sent something different for EVERY one of these forms, so the equality above can fail.
        for (const path of all) {
          expect(new URL(path, echoBase).pathname, path).not.toBe(path);
        }
        // And the instrument can fail: a normalised send is observably different on the same server.
        received.length = 0;
        await rawPathGet(echoBase, HOSTS.oneCanonical, new URL(DOT_VARIANTS[1]!, echoBase).pathname);
        expect(received).not.toEqual([DOT_VARIANTS[1]]);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test("without the bearer each is byte-identical to the 404 of any other /api/* path", async ({ request, baseURL }) => {
      const reference = await shape(await rawGet(request, baseURL, HOSTS.oneCanonical, "/api/auth/csrf"), HOSTS.oneCanonical);
      expect(reference.status).toBe(404);
      for (const path of DOT_VARIANTS) {
        const res = await rawPathGet(baseURL, HOSTS.oneCanonical, path);
        expect(res.status, path).toBe(404);
        expect(res.rawHeaders["set-cookie"], `Set-Cookie on ${path}`).toBeUndefined();
        expect({ status: res.status, headers: res.headers, body: res.body }, path).toEqual(reference);
      }
    });

    test("a wrong bearer is the same 404 as no bearer, and the same variants are 404 on an UNCLAIMED host too", async ({ baseURL }) => {
      // Consistency of the 404 posture across credential and tenancy states. It does NOT prove the path went out
      // un-normalized (it would pass if it had); that property is the harness self-check above.
      for (const path of DOT_VARIANTS) {
        const wrong = await rawPathGet(baseURL, HOSTS.oneCanonical, path, { authorization: "Bearer wrong" });
        const none = await rawPathGet(baseURL, HOSTS.oneCanonical, path);
        const unclaimed = await rawPathGet(baseURL, HOSTS.unknown, path);
        expect(wrong.status, path).toBe(404);
        expect(wrong, path).toEqual({ ...none, rawHeaders: wrong.rawHeaders });
        expect(unclaimed.status, path).toBe(404);
      }
    });

    test("with the valid bearer each gets the same status and body class as the exact path (the handler's own answer, nothing else)", async ({ request, baseURL }) => {
      const cases: Array<{ path: string; exact: string }> = DOT_VARIANTS.map((path) => ({
        path,
        exact: path.endsWith("/giving") ? "/api/cron/giving" : "/api/cron/email-queue",
      }));
      for (const { path, exact } of cases) {
        // ?limit=1 keeps the email queue to one unit of work.
        const ref = await rawGet(request, baseURL, HOSTS.oneCanonical, `${exact}?limit=1`, bearer);
        expect(ref.status(), exact).toBe(200);
        const res = await rawPathGet(baseURL, HOSTS.oneCanonical, `${path}?limit=1`, bearer);
        expect(res.status, path).toBe(ref.status());
        expect(String(res.rawHeaders["content-type"] ?? ""), path).toContain("application/json");
        expect((JSON.parse(res.body) as { ok?: boolean }).ok, path).toBe(true);
        expect(res.rawHeaders["set-cookie"], `Set-Cookie on ${path}`).toBeUndefined();
      }
    });

    test("a dot-segment that climbs OUT of /api/cron is not a cron call: it never reaches a handler, bearer or not", async ({ baseURL }) => {
      // `/api/cron/../auth/csrf` collapses to a platform route, which a custom host answers with the neutral 404.
      for (const path of CLIMB_OUT) {
        for (const headers of [{}, bearer]) {
          const res = await rawPathGet(baseURL, HOSTS.oneCanonical, path, headers);
          expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(404);
          expect(String(res.rawHeaders["content-type"] ?? ""), path).not.toContain("application/json");
        }
      }
    });
  });

  test("the exemption is for GET-style cron calls only on those exact paths: a POST with the bearer is still 404", async ({ request, baseURL }) => {
    const res = await rawPost(request, baseURL, HOSTS.oneCanonical, "/api/cron/giving", { headers: bearer });
    // The proxy lets the exact path through; the handler exports GET only, so a POST is Next's 405 - never a 200 run.
    expect([404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(200);
  });
});

test.describe("what still answers on a custom host: the static exclusions, enumerated (F151)", () => {
  test("only favicon / icon routes / public brand files and _next assets are served by the platform; everything else rewrites", async ({ request, baseURL }) => {
    // The proxy matcher excludes these, so they bypass the host branch and answer on ANY attached host with the
    // platform's own bytes. This list is the accepted residual; a new platform static route must be added here
    // consciously (or served from the church's tree).
    const ANSWERS = ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/brand/presbyportal-mark.svg", "/brand/presbyportal-logo-horizontal.svg"];
    for (const path of ANSWERS) {
      const res = await rawGet(request, baseURL, HOSTS.unknown, path);
      expect(res.status(), path).toBe(200);
      noCookie(res, path);
    }

    // A _next static chunk (a real one, from a real page) answers too: the church's pages need them.
    const page = await (await rawGet(request, baseURL, HOSTS.oneCanonical, "/")).text();
    const chunk = /<script src="(\/_next\/static\/[^"]+\.js)"/.exec(page)?.[1];
    expect(chunk, "a _next/static script on the page").toBeTruthy();
    const js = await rawGet(request, baseURL, HOSTS.unknown, chunk!);
    expect(js.status()).toBe(200);
    noCookie(js, chunk!);

    // Any other file-looking path is NOT served: the matcher excludes only the extensions above, and these have
    // no static file behind them, so they 404 as Next's plain not-found. None is a platform route.
    for (const path of ["/robots.png", "/signin.svg", "/admin.jpg", "/x.gif", "/x.webp"]) {
      const res = await rawGet(request, baseURL, HOSTS.unknown, path);
      expect(res.status(), path).toBe(404);
    }
  });
});
