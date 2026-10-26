/**
 * Edge gate tests.
 *
 * What is worth pinning here is the boundary the file's shape invites people to
 * get wrong: /o/* is authenticated, active-checked and 2FA-gated at the Edge and
 * NOTHING else — no membership check, no PROTECTION_RULES entry (DECISION-035) —
 * and /home sits deliberately outside the 2FA gate. (This was /orgs, which
 * itself sat outside the gate despite starting with "/o" — DECISION-124
 * retired /orgs to a permanent redirect at /home, and the underlying property
 * moved with it, not away.)
 */
vi.mock("@/lib/auth/config", () => ({ edgeAuth: vi.fn() }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { edgeAuth } from "@/lib/auth/config";
import { proxy } from "./proxy";
import { ADMIN_ROLE, FEATURES } from "@/lib/permissions";

const auth = vi.mocked(edgeAuth);

type SessionUser = {
  id?: string;
  isActive?: boolean;
  roles?: string[];
  features?: string[];
  twoFactorRequired?: boolean;
  twoFactorVerified?: boolean;
};

function signedIn(user: SessionUser = {}) {
  auth.mockResolvedValueOnce({
    user: { id: "u1", isActive: true, roles: [], features: [], ...user },
  } as unknown as Awaited<ReturnType<typeof edgeAuth>>);
}

// The synthetic platform host. Since Track F the proxy's FIRST decision is the
// request Host (src/lib/domains/host.ts), so the fixtures' origin must be in the
// platform-host set - otherwise every request below would be a custom-host
// rewrite. `NEXT_PUBLIC_PLATFORM_HOSTS` is how production declares the same.
const PLATFORM_HOST = "presby.example.invalid";
process.env.NEXT_PUBLIC_PLATFORM_HOSTS = PLATFORM_HOST;

function request(pathname: string, host: string = PLATFORM_HOST, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, `https://${host}`), {
    headers: { host, ...headers },
  });
}

beforeEach(() => {
  auth.mockReset();
});

describe("proxy — /o/* (the org portal)", () => {
  it("sends an unauthenticated visitor to /signin carrying the deep link", async () => {
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/o/alder-creek/roll"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/o/alder-creek/roll");
  });

  it("challenges 2FA before the org page renders", async () => {
    signedIn({ twoFactorRequired: true, twoFactorVerified: false });

    const res = await proxy(request("/o/alder-creek"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/totp");
    expect(location.searchParams.get("callbackUrl")).toBe("/o/alder-creek");
  });

  it("admits a member with no platform role or feature at all", async () => {
    // The Edge does NOT authorize membership — that is resolveOrgContext() plus
    // withOrgContext() in the RSC layer. A PROTECTION_RULES entry here would
    // gate the tenant axis with a platform-axis claim and lock every ordinary
    // member out of their own congregation.
    signedIn({ roles: [], features: [] });

    const res = await proxy(request("/o/alder-creek"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("admits a verified user whose organization requires 2FA", async () => {
    signedIn({ twoFactorRequired: true, twoFactorVerified: true });

    const res = await proxy(request("/o/alder-creek"));

    expect(res.status).toBe(200);
  });

  it("bounces a deactivated user regardless of the org", async () => {
    signedIn({ isActive: false });

    const res = await proxy(request("/o/alder-creek"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("error")).toBe("deactivated");
  });
});

describe("proxy — the routes around it", () => {
  it("leaves /home outside the 2FA gate — it is not an org path", async () => {
    // /home carries the chooser-equivalent content (DECISION-124) and renders
    // no tenant data; it is the one page a user with a lost or pending
    // organization can still reach without clearing 2FA.
    signedIn({ twoFactorRequired: true, twoFactorVerified: false });

    const res = await proxy(request("/home"));

    expect(res.status).toBe(200);
  });

  it("leaves /launch outside the 2FA gate — the destination carries it", async () => {
    signedIn({ twoFactorRequired: true, twoFactorVerified: false });

    const res = await proxy(request("/launch"));

    expect(res.status).toBe(200);
  });

  it("still gates /admin on 2FA", async () => {
    signedIn({
      twoFactorRequired: true,
      twoFactorVerified: false,
      roles: [ADMIN_ROLE],
    });

    const res = await proxy(request("/admin/users"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/totp");
    expect(location.searchParams.get("callbackUrl")).toBe("/admin/users");
  });

  it("still sends a signed-in user without the feature to /access-pending", async () => {
    signedIn({ features: [FEATURES.ADMIN_DASHBOARD] });

    const res = await proxy(request("/admin/users"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/access-pending");
    expect(location.searchParams.get("from")).toBe("/admin/users");
  });

  it("sends an unauthenticated visitor away from /no-organization", async () => {
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/no-organization"));

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/no-organization");
  });
});

describe("proxy — /site/* (public organization websites, DECISION-085)", () => {
  it("admits an anonymous visitor to /site/<slug> with no redirect", async () => {
    // No signedIn()/auth mock call here on purpose — edgeAuth() must never be
    // consulted at all for this path. If it were, this test would still pass
    // (auth.mockReset() in beforeEach leaves it resolving undefined, which
    // itself would 307 to /signin) — the real assertion is res.status === 200
    // AND that this happens with zero auth() setup, unlike every other
    // describe block in this file.
    const res = await proxy(request("/site/alder-creek"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it("admits /site/<slug>/assets/<key>, a nested path under the bypass", async () => {
    const res = await proxy(request("/site/alder-creek/assets/some-key"));

    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
  });

  it("does not bypass /siteX or other paths that merely start with the string", async () => {
    // startsWith("/site/") must not accidentally admit an unrelated route
    // that happens to share a prefix character sequence.
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/sitemap-builder"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
  });
});

describe("proxy — /invite (account invitations, DECISION-183/185)", () => {
  // Exact-path entries in PUBLIC_PATHS, like /file-statistics: the token rides
  // the query string or the host-only Path=/ hand-off cookie, so no prefix bypass.

  it("admits /invite and /invite/accepted with no auth() call at all", async () => {
    for (const path of ["/invite", "/invite?token=abc123", "/invite/accepted"]) {
      const res = await proxy(request(path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
    expect(auth).not.toHaveBeenCalled();
  });

  it("does NOT admit /invite/anything-else or look-alikes - exact paths only", async () => {
    for (const path of ["/invite/x", "/invite/accepted/x", "/invitex", "/invite-me"]) {
      auth.mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof edgeAuth>>);
      const res = await proxy(request(path));
      expect(res.status, path).toBe(307);
      const location = new URL(res.headers.get("location") as string);
      expect(location.pathname, path).toBe("/signin");
      expect(location.searchParams.get("callbackUrl"), path).toBe(path);
    }
  });
});

describe("proxy — /file-statistics (submission grants, D16/DECISION-147)", () => {
  // EXACT-PATH entries in PUBLIC_PATHS (a Set, not a prefix match) — the
  // deliberate amendment over /site/*'s startsWith bypass (Phase 2 BINDING,
  // `docs/work-log/2026-09-25-submission-grants.md`): a token-bearing path
  // must not be reachable by a startsWith-style rule the way /site/ needs,
  // so both segments are named individually and nothing beyond them is
  // admitted, including a third segment nested under the same prefix.

  it("admits /file-statistics with no auth() call at all", async () => {
    // No signedIn()/auth mock call on purpose, same discipline the /site/*
    // block above documents: edgeAuth() must never be consulted for this
    // path — the token is the credential, not a session.
    const res = await proxy(request("/file-statistics"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it("admits /file-statistics with a ?token= query string, unauthenticated", async () => {
    const res = await proxy(request("/file-statistics?token=abc123"));

    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
  });

  it("admits /file-statistics/submitted, the static confirmation page", async () => {
    const res = await proxy(request("/file-statistics/submitted"));

    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
  });

  it("does NOT admit /file-statistics/anything-else — exact paths only, no prefix bypass", async () => {
    // The whole point of using a Set of exact pathnames instead of a
    // startsWith rule (Phase 2's amendment to Ruling 11): a third segment
    // under the same prefix must fall through to ordinary edgeAuth()
    // handling, unlike /site/<slug>/anything, which is deliberately open.
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/file-statistics/anything-else"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe(
      "/file-statistics/anything-else",
    );
  });

  it("does not bypass /file-statisticsX or other paths that merely share the prefix", async () => {
    auth.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof edgeAuth>
    >);

    const res = await proxy(request("/file-statisticsX"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/signin");
  });
});

// ---------------------------------------------------------------------------
// Track F: the custom-host first branch (DECISION-176, Phase 2 R1-R4, A6, T1)
// ---------------------------------------------------------------------------

import { afterEach } from "vitest";
import { makeProbe } from "@/lib/domains/probe";

const CUSTOM = "church-one.invalid";

/** A rewrite carries `x-middleware-rewrite`; a pass-through carries `x-middleware-next`. */
function rewriteTarget(res: Response): URL | null {
  const raw = res.headers.get("x-middleware-rewrite");
  return raw === null ? null : new URL(raw);
}
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

function expectNoCookies(res: Response) {
  expect(res.headers.get("set-cookie")).toBeNull();
}

describe("proxy - a custom host is rewritten to /site/<host><path> (R1)", () => {
  it("rewrites the home page and keeps the query string", async () => {
    const res = await proxy(request("/", CUSTOM));
    expect(rewriteTarget(res)?.pathname).toBe(`/site/${CUSTOM}`);

    const withQuery = await proxy(request("/about?tab=2&x=%20y", CUSTOM));
    const target = rewriteTarget(withQuery);
    expect(target?.pathname).toBe(`/site/${CUSTOM}/about`);
    expect(target?.search).toBe("?tab=2&x=%20y");
  });

  it("never consults edgeAuth() and sets no cookie, for any path", async () => {
    for (const p of ["/", "/about", "/sitemap.xml", "/robots.txt", "/give", "/give/return?session_id=cs_x"]) {
      const res = await proxy(request(p, CUSTOM));
      expect(rewriteTarget(res), p).not.toBeNull();
      expectNoCookies(res);
    }
    expect(auth).not.toHaveBeenCalled();
  });

  it("rewrites every platform route into bundle-path space instead of serving it", async () => {
    // These are the platform's own routes. On a church's domain each one is
    // just a path the church's bundle has no page for, so it lands on the same
    // neutral 404 as any other. None may reach /api, /signin or the gates.
    const platformPaths = [
      "/api/auth/csrf",
      "/api/auth/callback/credentials",
      "/api/webhooks/stripe",
      "/api/sites/ingest",
      // the staged ingest (DECISION-279): fixed paths, so they stay on this list
      "/api/sites/ingest/plan",
      "/api/sites/ingest/images",
      "/api/sites/ingest/commit",
      "/api/cron/email-queue",
      "/signin",
      "/totp",
      "/forgot-password",
      "/reset-password",
      "/file-statistics",
      "/access-pending",
      "/home",
      "/launch",
      "/orgs",
      "/account/verify-email/abc",
      "/o/alder-creek",
      "/admin",
      "/account",
      "/site/alder-creek",
      `/site/${CUSTOM}`,
    ];
    for (const p of platformPaths) {
      const res = await proxy(request(p, CUSTOM));
      const target = rewriteTarget(res);
      expect(target?.pathname, p).toBe(`/site/${CUSTOM}${p}`);
      expect(passedThrough(res), p).toBe(false);
      expect(res.headers.get("location"), p).toBeNull();
    }
    expect(auth).not.toHaveBeenCalled();
  });

  it("PX-2: the staged-ingest paths are matched by config.matcher - none ends in an excluded image extension (F151)", async () => {
    const { config } = await import("./proxy");
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ["/api/sites/ingest", "/api/sites/ingest/plan", "/api/sites/ingest/images", "/api/sites/ingest/commit"]) {
      expect(matcher.test(p), p).toBe(true);
    }
    // the reason the routes are FIXED paths: a dynamic segment ending in .jpg would bypass the proxy
    expect(matcher.test("/api/sites/ingest/images/hero.jpg")).toBe(false);
  });

  it("is a lookup key, not an identity: forwarded headers change nothing (R3, A2)", async () => {
    const spoof = {
      "x-forwarded-host": PLATFORM_HOST,
      forwarded: `host=${PLATFORM_HOST}`,
      "x-original-host": PLATFORM_HOST,
      "x-forwarded-proto": "https",
    };
    // A custom host claiming to be the platform stays a custom host.
    const asCustom = await proxy(request("/signin", CUSTOM, spoof));
    expect(rewriteTarget(asCustom)?.pathname).toBe(`/site/${CUSTOM}/signin`);

    // The platform host claiming to be a church stays the platform: /home still
    // asks edgeAuth() (unauthenticated -> /signin), and /signin is still public.
    auth.mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof edgeAuth>>);
    const asPlatform = await proxy(
      request("/home", PLATFORM_HOST, {
        "x-forwarded-host": CUSTOM,
        forwarded: `host=${CUSTOM}`,
        "x-original-host": CUSTOM,
      }),
    );
    expect(rewriteTarget(asPlatform)).toBeNull();
    expect(new URL(asPlatform.headers.get("location") as string).pathname).toBe("/signin");
  });

  it("matches the Host header case-insensitively and ignores the port and a trailing dot", async () => {
    for (const host of ["CHURCH-ONE.INVALID", `${CUSTOM}:3000`, `${CUSTOM}.`]) {
      const res = await proxy(request("/about", host));
      expect(rewriteTarget(res)?.pathname, host).toBe(`/site/${CUSTOM}/about`);
    }
  });

  it("answers an unusable Host with a bare 404 and no rewrite, no auth, no cookie", async () => {
    for (const host of ["", "exa mple.invalid", "-bad.invalid", "a..b.invalid", "bad_host.invalid", "ex@mple.invalid"]) {
      const req = new NextRequest(new URL("/", "https://x.invalid"), { headers: { host } });
      const res = await proxy(req);
      expect(res.status, JSON.stringify(host)).toBe(404);
      expect(rewriteTarget(res)).toBeNull();
      expectNoCookies(res);
    }
    // No Host header at all.
    const missing = await proxy(new NextRequest(new URL("/", "https://x.invalid")));
    expect(missing.status).toBe(404);
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("proxy - the platform-host set (R2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats *.vercel.app as the platform", async () => {
    auth.mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof edgeAuth>>);
    const res = await proxy(request("/home", "presby-git-branch-team.vercel.app"));
    expect(rewriteTarget(res)).toBeNull();
    expect(res.status).toBe(307);
  });

  it("treats loopback as the platform outside a production deployment, and as nothing in one", async () => {
    const dev = await proxy(request("/signin", "localhost:3000"));
    expect(passedThrough(dev)).toBe(true);

    vi.stubEnv("VERCEL_ENV", "production");
    const prod = await proxy(request("/signin", "localhost:3000"));
    expect(rewriteTarget(prod)?.pathname).toBe("/site/localhost/signin");
    // An IP literal is refused outright in production.
    const ip = await proxy(request("/signin", "203.0.113.9"));
    expect(ip.status).toBe(404);
    expect(rewriteTarget(ip)).toBeNull();
  });

  it("does not let a church host that merely ends in a platform host's name through", async () => {
    for (const host of [`${PLATFORM_HOST}.evil.invalid`, `evil-${PLATFORM_HOST}`, `x.${PLATFORM_HOST}`]) {
      const res = await proxy(request("/signin", host));
      expect(rewriteTarget(res)?.pathname, host).toBe(`/site/${host}/signin`);
    }
  });
});

describe("proxy - /site/<dotted> is not addressable from a platform host (R1, A3)", () => {
  it("404s the internal rewrite target, with no auth and no body", async () => {
    for (const p of [
      `/site/${CUSTOM}`,
      `/site/${CUSTOM}/about`,
      "/site/a.b",
      "/site/a%2eb",
      "/site/a%2Eb/about",
      "/site/.hidden",
    ]) {
      const res = await proxy(request(p));
      expect(res.status, p).toBe(404);
      expect(passedThrough(res), p).toBe(false);
    }
    expect(auth).not.toHaveBeenCalled();
  });

  it("still admits a normal slug and a dot deeper in the path", async () => {
    for (const p of ["/site/alder-creek", "/site/alder-creek/assets/some.key", "/site/alder-creek/about.html"]) {
      const res = await proxy(request(p));
      expect(res.status, p).toBe(200);
      expect(passedThrough(res), p).toBe(true);
    }
  });
});

describe("proxy - the live-ness probe (T1)", () => {
  const SECRET = "probe-secret-fixture";
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers a valid probe for exactly this host with a bodiless 204, the ack, and no cookie", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const probe = makeProbe(CUSTOM, SECRET);
    const res = await proxy(request("/", CUSTOM, { "x-presby-probe": probe.header }));
    expect(res.status).toBe(204);
    expect(res.headers.get("x-presby-probe-ack")).toBe(probe.expectedAck);
    expectNoCookies(res);
    expect(await res.text()).toBe("");
    expect(auth).not.toHaveBeenCalled();
  });

  it("answers on any path and method, since the sweeper probes GET /", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const probe = makeProbe(CUSTOM, SECRET);
    const res = await proxy(request("/anything/at/all?x=1", CUSTOM, { "x-presby-probe": probe.header }));
    expect(res.status).toBe(204);
  });

  it("does not answer a probe minted for another host, a forged MAC, or a malformed header", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const other = makeProbe("church-two.invalid", SECRET);
    const wrongHost = await proxy(request("/", CUSTOM, { "x-presby-probe": other.header }));
    expect(wrongHost.status).not.toBe(204);
    expect(wrongHost.headers.get("x-presby-probe-ack")).toBeNull();
    expect(rewriteTarget(wrongHost)?.pathname).toBe(`/site/${CUSTOM}`);

    for (const bad of ["", "garbage", `${"0".repeat(32)}.forged`, "a.b.c"]) {
      const res = await proxy(request("/", CUSTOM, { "x-presby-probe": bad }));
      expect(res.headers.get("x-presby-probe-ack"), bad).toBeNull();
    }
  });

  it("does not answer when AUTH_SECRET is unset (a guessable key would forge 'live')", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const probe = makeProbe(CUSTOM, SECRET);
    const res = await proxy(request("/", CUSTOM, { "x-presby-probe": probe.header }));
    expect(res.headers.get("x-presby-probe-ack")).toBeNull();
  });

  it("ignores the probe header on a platform host", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const probe = makeProbe(PLATFORM_HOST, SECRET);
    const res = await proxy(request("/signin", PLATFORM_HOST, { "x-presby-probe": probe.header }));
    expect(res.headers.get("x-presby-probe-ack")).toBeNull();
    expect(passedThrough(res)).toBe(true);
  });
});

describe("proxy - the cron pass-through on a custom host (A6)", () => {
  const SECRET = "cron-secret-fixture-value";
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes an exact cron path with the exact bearer straight through, with no cookie and no auth", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const p of ["/api/cron/email-queue", "/api/cron/maintenance", "/api/cron/giving", "/api/cron/domains"]) {
      const res = await proxy(request(p, CUSTOM, { authorization: `Bearer ${SECRET}` }));
      expect(passedThrough(res), p).toBe(true);
      expect(rewriteTarget(res), p).toBeNull();
      expectNoCookies(res);
    }
    expect(auth).not.toHaveBeenCalled();
  });

  it("keeps the query string reachable (the handlers read ?limit=)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await proxy(request("/api/cron/email-queue?limit=1", CUSTOM, { authorization: `Bearer ${SECRET}` }));
    expect(passedThrough(res)).toBe(true);
  });

  it("rewrites (the neutral 404 path) for a missing, wrong, empty or wrong-length bearer", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const p = "/api/cron/email-queue";
    const baseline = rewriteTarget(await proxy(request("/api/auth/csrf", CUSTOM)));
    expect(baseline).not.toBeNull();
    for (const headers of [
      {},
      { authorization: "" },
      { authorization: "Bearer " },
      { authorization: "Bearer wrong" },
      { authorization: `Bearer ${SECRET}x` },
      { authorization: SECRET },
    ] as Array<Record<string, string>>) {
      const res = await proxy(request(p, CUSTOM, headers));
      expect(passedThrough(res), JSON.stringify(headers)).toBe(false);
      expect(rewriteTarget(res)?.pathname, JSON.stringify(headers)).toBe(`/site/${CUSTOM}${p}`);
    }
  });

  it("rewrites when CRON_SECRET is unset, whatever the header says", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const authorization of ["Bearer ", "Bearer undefined", "Bearer"]) {
      const res = await proxy(request("/api/cron/email-queue", CUSTOM, { authorization }));
      expect(passedThrough(res), authorization).toBe(false);
      expect(rewriteTarget(res)).not.toBeNull();
    }
  });

  it("does not match encoded, dot-segment, trailing-slash or upper-case variants", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const authorization = `Bearer ${SECRET}`;
    for (const p of [
      "/api/cron/email-queue/",
      "/api/cron/%65mail-queue",
      "/api/cron%2Femail-queue",
      "/API/cron/email-queue",
      "/api/cron/Email-Queue",
      "/api/cron/email-queue/extra",
      "/api/cron/unknown",
    ]) {
      const res = await proxy(request(p, CUSTOM, { authorization }));
      expect(passedThrough(res), p).toBe(false);
      expect(rewriteTarget(res), p).not.toBeNull();
    }
  });
});
