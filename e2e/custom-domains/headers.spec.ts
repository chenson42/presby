/**
 * headers.spec.ts - the host-split security headers of Track F (F147, F151, T13;
 * docs/work-log/2026-10-19-custom-domains.md). Runs in BOTH lanes: `headers()` and
 * `redirects()` are evaluated at config time and baked into the routes manifest by
 * `next build`, so the dev server alone cannot prove a production build behaves the same.
 *
 *   - HSTS: a PLATFORM host (the app host, loopback, `*.vercel.app`) keeps
 *     `max-age=63072000; includeSubDomains`; EVERY OTHER host gets `max-age=63072000` only.
 *     `includeSubDomains` on a church's domain would pin HTTPS for all of its subdomains for two
 *     years and outlive the church's departure (F147). Checked on every response class a church
 *     host can produce: page, 404, asset, sitemap, redirect.
 *   - `/orgs` -> `/home` (a platform redirect that runs BEFORE the proxy) is scoped to platform
 *     hosts: on a church's domain it is the same neutral 404 as any other path (F151).
 *   - The ENFORCED CSP applies to `/give` on a church's domain (it matches the incoming path,
 *     before the proxy's rewrite; T13) and only the report-only policy to the rest of its site.
 */
import { test, expect, type APIResponse } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import {
  HOSTS,
  buildWorld,
  getPublicRenderFlag,
  rawGet,
  setPublicRenderFlag,
  teardownWorld,
  type World,
} from "../support/custom-hosts";

let sql: Sql;
let world: World;
let originalFlag: boolean;

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  sql = platformSql("custom-domains/headers.spec");
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

const PLATFORM_HSTS = "max-age=63072000; includeSubDomains";
const CUSTOM_HSTS = "max-age=63072000";
const hsts = (res: APIResponse) => res.headers()["strict-transport-security"];

test.describe("HSTS is split by host (F147)", () => {
  test("a platform host keeps includeSubDomains: the app host (loopback here), a *.vercel.app host", async ({ request, baseURL }) => {
    for (const host of ["localhost", "preview-abc123-team.vercel.app"]) {
      for (const path of ["/signin", "/api/auth/csrf", "/robots.txt"]) {
        const res = await rawGet(request, baseURL, host, path);
        expect(hsts(res), `${host} ${path}`).toBe(PLATFORM_HSTS);
      }
    }
  });

  test("a church's host gets max-age only, on every response class it can produce", async ({ request, baseURL }) => {
    const classes: Array<[string, string, string]> = [
      ["page", HOSTS.oneCanonical, "/"],
      ["sub-page", HOSTS.oneCanonical, "/about"],
      ["404 page", HOSTS.oneCanonical, "/no-such-page"],
      ["unclaimed host", HOSTS.unknown, "/"],
      ["asset", HOSTS.oneCanonical, `/assets/${world.oneImageId}`],
      ["sitemap", HOSTS.oneCanonical, "/sitemap.xml"],
      ["robots", HOSTS.oneCanonical, "/robots.txt"],
      ["alias 307", HOSTS.oneAlias, "/about"],
      ["a platform route", HOSTS.oneCanonical, "/signin"],
    ];
    for (const [label, host, path] of classes) {
      const res = await rawGet(request, baseURL, host, path);
      expect(hsts(res), label).toBe(CUSTOM_HSTS);
      expect(hsts(res), label).not.toContain("includeSubDomains");
    }
  });

  test("a host that merely ENDS in a platform host's name is still a church host", async ({ request, baseURL }) => {
    for (const host of ["localhost.evil.invalid", "evil-localhost", "x.vercel.app.evil.invalid", "vercel.app"]) {
      const res = await rawGet(request, baseURL, host, "/");
      expect(hsts(res), host).toBe(CUSTOM_HSTS);
    }
  });
});

test.describe("/orgs is a platform-host redirect only (F151)", () => {
  test("308 to /home on the platform; the neutral 404 on a church's domain, with no Location", async ({ request, baseURL }) => {
    const platform = await rawGet(request, baseURL, "localhost", "/orgs");
    expect(platform.status()).toBe(308);
    expect(platform.headers()["location"]).toBe("/home");

    for (const host of [HOSTS.oneCanonical, HOSTS.unknown]) {
      const res = await rawGet(request, baseURL, host, "/orgs");
      expect(res.status(), host).toBe(404);
      expect(res.headers()["location"], host).toBeUndefined();
    }
  });
});

test.describe("the CSP follows the INCOMING path (T13)", () => {
  const enforced = (res: APIResponse) => res.headers()["content-security-policy"];
  const reportOnly = (res: APIResponse) => res.headers()["content-security-policy-report-only"];

  test("/give on a church's domain carries the ENFORCED policy, whether or not that host serves", async ({ request, baseURL }) => {
    for (const host of [HOSTS.oneCanonical, HOSTS.unknown]) {
      for (const path of ["/give", "/give/return?session_id=cs_x"]) {
        const res = await rawGet(request, baseURL, host, path);
        expect(enforced(res), `${host} ${path}`).toContain("form-action 'self'");
        expect(enforced(res), `${host} ${path}`).toBe(reportOnly(res));
      }
    }
  });

  test("the rest of a church's site carries the report-only policy and NO enforced one", async ({ request, baseURL }) => {
    for (const path of ["/", "/about", "/sitemap.xml", "/no-such-page"]) {
      const res = await rawGet(request, baseURL, HOSTS.oneCanonical, path);
      expect(reportOnly(res), path).toContain("default-src 'self'");
      expect(enforced(res), path).toBeUndefined();
    }
  });

  test("the platform's give routes stay enforced, and a platform page stays report-only", async ({ request, baseURL }) => {
    const give = await rawGet(request, baseURL, "localhost", `/site/${world.two.slug}/give`);
    expect(enforced(give)).toContain("form-action 'self'");
    const signin = await rawGet(request, baseURL, "localhost", "/signin");
    expect(enforced(signin)).toBeUndefined();
    expect(reportOnly(signin)).toContain("default-src 'self'");
  });

  test("the other security headers still reach a church's pages", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, HOSTS.oneCanonical, "/");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
  });
});
