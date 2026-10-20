/**
 * serving.spec.ts - a church's own domain serves that church's public site, and
 * every other host serves nothing (Track F, Batch 1c; docs/work-log/
 * 2026-10-19-custom-domains.md: DECISION-176/178/181, Phase 2 R1/R6, adversarial
 * A1/A2/A3). Runs in BOTH lanes (the dev server and `next build && next start`).
 *
 * The first test is a CANARY: it proves Chromium really resolves `*.invalid` to
 * the server under test and that the server answers for it, so a failure in any
 * later test is a real defect and not a mis-mapped host.
 *
 * What it proves:
 *   - a live host renders ITS org's site (and not the other org's), keeps the church's
 *     brand cascade, and names the canonical host in canonical / og:url / robots / sitemap;
 *   - the lifecycle walk: one host walked through every legal state, one request per
 *     state. Every non-serving state is a neutral 404 BYTE-IDENTICAL (status, body,
 *     headers) to the baseline taken before the host had any row at all; `live` is the
 *     only state that serves; a hold (paused/disputed) darkens it and clearing restores it;
 *   - toggle off / site suspended / org inactive / render flag off each darken a live host
 *     into that same 404, and restoring each brings it back;
 *   - 307 only, always `no-store`: alias -> canonical keeps path and query; the slug URL of
 *     an org whose custom host is serving hands off to it (HTML pages, sitemap, robots) but
 *     assets and `give/return` are never redirected; while not serving the slug URL serves
 *     itself.
 */
import { test, expect, type APIResponse } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import {
  HOSTS,
  ORG_NAMES,
  TITLES,
  buildWorld,
  getPublicRenderFlag,
  originFor,
  rawGet,
  setDomainsToggle,
  setHold,
  setOrgStatus,
  setPublicRenderFlag,
  setSiteStatus,
  snapshot,
  stepDomain,
  teardownWorld,
  addExpiredClaim,
  type Snapshot,
  type World,
} from "../support/custom-hosts";

let sql: Sql;
let world: World;
let originalFlag: boolean;

test.beforeAll(async () => {
  sql = platformSql("custom-domains/serving.spec");
  originalFlag = await getPublicRenderFlag(sql);
  world = await buildWorld(sql);
  // The render flag is part of the serving predicate; this spec needs it ON and restores it.
  await setPublicRenderFlag(sql, true);
});

test.afterAll(async () => {
  if (sql) {
    await setPublicRenderFlag(sql, originalFlag);
    expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalFlag);
  }
  await teardownWorld(sql, world);
});

const get = (request: Parameters<typeof rawGet>[0], baseURL: string | undefined, host: string | null, path: string, headers?: Record<string, string>) =>
  rawGet(request, baseURL, host, path, headers);

/**
 * `Cache-Control` of a redirect must forbid reusing it: a 307 that a CDN kept would strand visitors after a lapse.
 * A PRODUCTION build says `no-store`; the dev server says `no-cache, must-revalidate` for every dynamic response,
 * which also forbids reuse without revalidation. Either way: nothing public, shared or max-age'd.
 */
const IS_PROD_LANE = process.env.PW_PROD_BUILD === "1";
const noStore = (res: APIResponse) => {
  const cc = res.headers()["cache-control"] ?? "";
  expect(cc, `cache-control: ${cc}`).toMatch(IS_PROD_LANE ? /no-store/ : /no-store|no-cache/);
  expect(cc, `cache-control: ${cc}`).not.toMatch(/public|s-maxage|immutable|max-age=[1-9]/);
};

/** Every URL-bearing attribute of the document (href / src / action / content of an og:url), nothing from script payloads. */
function urlAttributes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\s(?:href|src|action)="([^"]*)"/g)) out.push(m[1]!);
  for (const m of html.matchAll(/<meta property="og:(?:url|image)" content="([^"]*)"/g)) out.push(m[1]!);
  return out;
}

function metaContent(html: string, key: string, attr: "name" | "property" = "name"): string | null {
  const m = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html);
  return m ? m[1]! : null;
}
function linkHref(html: string, rel: string): string | null {
  const m = new RegExp(`<link rel="${rel}" href="([^"]*)"`).exec(html);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// canary
// ---------------------------------------------------------------------------

test.describe("canary: the host mapping is real", () => {
  test("a browser reaches the server as an unknown *.invalid host and gets OUR neutral 404 (not a DNS error)", async ({ page, baseURL }) => {
    const res = await page.goto(`${originFor(HOSTS.unknown, baseURL)}/`);
    expect(res, "the mapped host must reach the server").not.toBeNull();
    expect(res!.status()).toBe(404);
    await expect(page.locator("h1")).toHaveText("Page not found");
    expect(new URL(page.url()).hostname).toBe(HOSTS.unknown);
    // Hydration must not flip the tab title back to the root layout's product name.
    await page.waitForLoadState("networkidle");
    expect(await page.title()).toBe("Page not found");
  });

  test("the neutral 404 names no product in the document the SERVER sends (title and social tags)", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, HOSTS.unknown, "/");
    expect(res.status()).toBe(404);
    const html = await res.text();
    expect(html).toContain("<title>Page not found</title>");
    expect(metaContent(html, "og:title", "property")).toBe("Page not found");
    expect(html).not.toMatch(/PresbyPortal/);
  });

  test("a live church host renders its own site in a real browser", async ({ page, baseURL }) => {
    const res = await page.goto(`${originFor(HOSTS.oneCanonical, baseURL)}/`);
    expect(res!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLES.one);
    expect(new URL(page.url()).hostname).toBe(HOSTS.oneCanonical);
    // The browser never left the church's domain, and no link on the page points at a platform path.
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      expect(href, `link ${href}`).not.toMatch(/\/site\//);
      expect(href, `link ${href}`).not.toMatch(/\/(signin|admin|home|launch)\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// rendering and the right org
// ---------------------------------------------------------------------------

test.describe("a live host serves its own org", () => {
  test("ONE's canonical host renders ONE; TWO's host renders TWO; neither shows the other", async ({ request, baseURL }) => {
    const one = await get(request, baseURL, HOSTS.oneCanonical, "/");
    expect(one.status()).toBe(200);
    const oneHtml = await one.text();
    expect(oneHtml).toContain(TITLES.one);
    expect(oneHtml).not.toContain(TITLES.two);

    const two = await get(request, baseURL, HOSTS.two, "/");
    expect(two.status()).toBe(200);
    const twoHtml = await two.text();
    expect(twoHtml).toContain(TITLES.two);
    expect(twoHtml).not.toContain(TITLES.one);
  });

  test("a sub-page renders at its CLEAN path, and a path the church has no page for is the neutral 404", async ({ request, baseURL }) => {
    const about = await get(request, baseURL, HOSTS.oneCanonical, "/about");
    expect(about.status()).toBe(200);
    expect(await about.text()).toContain(TITLES.oneAbout);

    const missing = await get(request, baseURL, HOSTS.oneCanonical, "/no-such-page");
    expect(missing.status()).toBe(404);
  });

  test("canonical, og:url, robots and the sitemap name the CANONICAL host: clean paths, no slug, no noindex", async ({ request, baseURL }) => {
    const res = await get(request, baseURL, HOSTS.oneCanonical, "/about");
    const html = await res.text();
    expect(linkHref(html, "canonical")).toBe(`https://${HOSTS.oneCanonical}/about`);
    expect(metaContent(html, "og:url", "property")).toBe(`https://${HOSTS.oneCanonical}/about`);
    expect(metaContent(html, "og:site_name", "property")).toBe("E2E Domains Church One");
    // The page's own robots override the root layout's pre-release `noindex`.
    expect(metaContent(html, "robots")).toBe("index, follow");
    expect(html).not.toContain("noindex");
    // The only place the slug may appear on a church's domain is the absolute portal link on the PLATFORM
    // (the sign-in lives there). No URL attribute routes by slug (G5).
    const urls = urlAttributes(html);
    expect(urls.length).toBeGreaterThan(3);
    const portal = urls.filter((u) => /^https?:\/\/[^/]+\/o\//.test(u));
    expect(portal.length, "the portal link is absolute and on the platform").toBeGreaterThan(0);
    for (const u of portal) expect(u).not.toContain(`.invalid`);
    for (const u of urls.filter((u) => !portal.includes(u))) {
      expect(u, `URL ${u}`).not.toContain("/site/");
      expect(u, `URL ${u}`).not.toContain(world.one.slug);
    }

    const sitemap = await get(request, baseURL, HOSTS.oneCanonical, "/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("application/xml");
    const xml = await sitemap.text();
    expect(xml).toContain(`<loc>https://${HOSTS.oneCanonical}/</loc>`);
    expect(xml).toContain(`<loc>https://${HOSTS.oneCanonical}/about</loc>`);
    expect(xml).not.toContain("/site/");
    expect(xml).not.toContain(world.one.slug);

    const robots = await get(request, baseURL, HOSTS.oneCanonical, "/robots.txt");
    expect(robots.status()).toBe(200);
    expect(robots.headers()["content-type"]).toContain("text/plain");
    const txt = await robots.text();
    expect(txt).toContain("Allow: /");
    expect(txt).toContain(`Sitemap: https://${HOSTS.oneCanonical}/sitemap.xml`);
    expect(txt).not.toMatch(/Disallow/i);
  });

  test("the platform's own robots.txt is unchanged on the platform host", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/robots.txt", baseURL).toString());
    expect(res.status()).toBe(200);
    const txt = await res.text();
    expect(txt).toContain("Allow: /site/");
    expect(txt).toContain("Disallow: /");
  });

  test("the church's brand cascade reaches a custom host (a maroon seed, not the platform blue)", async ({ request, baseURL }) => {
    const plain = await (await get(request, baseURL, HOSTS.oneCanonical, "/")).text();
    const branded = await (await get(request, baseURL, HOSTS.two, "/")).text();
    // <BrandTokens> emits a <style> re-declaring --primary only for a branded org.
    expect(branded).toMatch(/<style[^>]*>[^<]*--primary:/);
    expect(plain).not.toMatch(/<style[^>]*>[^<]*--primary:/);
  });

  test("the church's logo-less page carries no platform product name in its title or social tags", async ({ request, baseURL }) => {
    const html = await (await get(request, baseURL, HOSTS.oneCanonical, "/")).text();
    expect(html).toContain("<title>Church One Home Page | E2E Domains Church One</title>");
    expect(html).not.toMatch(/<title>[^<]*PresbyPortal/);
    expect(metaContent(html, "og:title", "property")).not.toMatch(/presby/i);
  });

  test("a content-addressed asset is served on the church's own domain at /assets/<key>", async ({ request, baseURL }) => {
    const res = await get(request, baseURL, HOSTS.oneCanonical, `/assets/${world.oneImageId}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    // ...and ONE's blob is not TWO's: another org's asset key is the same JSON 404 as no key.
    const foreign = await get(request, baseURL, HOSTS.two, `/assets/${world.oneImageId}`);
    expect(foreign.status()).toBe(404);
    const none = await get(request, baseURL, HOSTS.two, "/assets/00000000-0000-4000-8000-000000000000");
    expect(none.status()).toBe(404);
    expect(await foreign.text()).toBe(await none.text());
  });
});

// ---------------------------------------------------------------------------
// 307 hand-offs
// ---------------------------------------------------------------------------

test.describe("307 hand-offs: always temporary, always no-store", () => {
  test("an alias redirects to the canonical host keeping path and query", async ({ request, baseURL }) => {
    const res = await get(request, baseURL, HOSTS.oneAlias, "/about?tab=2&x=a%20b");
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toBe(`https://${HOSTS.oneCanonical}/about?tab=2&x=a+b`);
    noStore(res);

    const home = await get(request, baseURL, HOSTS.oneAlias, "/");
    expect(home.status()).toBe(307);
    expect(home.headers()["location"]).toBe(`https://${HOSTS.oneCanonical}/`);
    noStore(home);
  });

  test("the alias hands off its sitemap and robots.txt too, and never serves a body itself", async ({ request, baseURL }) => {
    for (const path of ["/sitemap.xml", "/robots.txt"]) {
      const res = await get(request, baseURL, HOSTS.oneAlias, path);
      expect(res.status(), path).toBe(307);
      expect(res.headers()["location"], path).toBe(`https://${HOSTS.oneCanonical}${path}`);
      noStore(res);
      expect(await res.text(), path).toBe("");
    }
  });

  test("the alias does NOT redirect assets (content-addressed)", async ({ request, baseURL }) => {
    const res = await get(request, baseURL, HOSTS.oneAlias, `/assets/${world.oneImageId}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["location"]).toBeUndefined();
  });

  test("the slug URL of an org whose custom host is serving hands off to it: pages, sitemap and robots", async ({ request, baseURL }) => {
    const slug = world.two.slug;
    const page = await get(request, baseURL, "localhost", `/site/${slug}/about?z=1`);
    expect(page.status()).toBe(307);
    expect(page.headers()["location"]).toBe(`https://${HOSTS.two}/about?z=1`);
    noStore(page);

    const home = await get(request, baseURL, "localhost", `/site/${slug}`);
    expect(home.status()).toBe(307);
    expect(home.headers()["location"]).toBe(`https://${HOSTS.two}/`);

    const sitemap = await get(request, baseURL, "localhost", `/site/${slug}/sitemap.xml`);
    expect(sitemap.status()).toBe(307);
    expect(sitemap.headers()["location"]).toBe(`https://${HOSTS.two}/sitemap.xml`);
    noStore(sitemap);
  });

  test("the slug URL never redirects assets or give/return, and serves its own asset", async ({ request, baseURL }) => {
    const slug = world.two.slug;
    const asset = await get(request, baseURL, "localhost", `/site/${slug}/assets/${world.twoImageId}`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["location"]).toBeUndefined();

    const ret = await get(request, baseURL, "localhost", `/site/${slug}/give/return?session_id=cs_test_none`);
    expect(ret.headers()["location"], "give/return must never redirect").toBeUndefined();
    expect(ret.status()).toBe(200);
  });

  test("while NOTHING serves, the slug URL serves itself (its own canonical), indexable", async ({ request, baseURL }) => {
    await stepDomain(sql, world.rows.two.id, "lapsed");
    try {
      const res = await get(request, baseURL, "localhost", `/site/${world.two.slug}`);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).toContain(TITLES.two);
      expect(linkHref(html, "canonical")).toMatch(new RegExp(`/site/${world.two.slug}$`));
      expect(html).not.toContain("noindex");
    } finally {
      await stepDomain(sql, world.rows.two.id, "verified");
      await stepDomain(sql, world.rows.two.id, "attach_pending");
      await stepDomain(sql, world.rows.two.id, "attached");
      await stepDomain(sql, world.rows.two.id, "live");
    }
    const back = await get(request, baseURL, "localhost", `/site/${world.two.slug}`);
    expect(back.status(), "restored to serving").toBe(307);
  });
});

// ---------------------------------------------------------------------------
// every non-serving state is one neutral 404
// ---------------------------------------------------------------------------

test.describe("the lifecycle walk: one host, one request per state", () => {
  // Each step arranges the NEXT state of one row, so the order is the test.
  test.describe.configure({ mode: "serial" });

  /** Paths compared in every state; each must be identical to the no-row baseline. */
  const PATHS = ["/", "/about", "/sitemap.xml", "/robots.txt"] as const;
  let baseline: Record<string, Snapshot> = {};

  async function snap(request: Parameters<typeof rawGet>[0], baseURL: string | undefined, path: string): Promise<Snapshot> {
    return snapshot(await rawGet(request, baseURL, HOSTS.walk, path), HOSTS.walk);
  }

  test("baseline: the host has a pending claim and serves nothing - a neutral 404 on every path", async ({ request, baseURL }) => {
    // The world arranged WALK as `pending`; the SAME host before it had any claim is indistinguishable
    // from an unknown one, which is the point. Capture the baseline from a host that has no row at all
    // and prove the pending host matches it modulo the rewrite header (normalised in snapshot()).
    for (const path of PATHS) {
      const unknown = await snapshot(await rawGet(request, baseURL, HOSTS.unknown, path), HOSTS.unknown);
      expect(unknown.status, path).toBe(404);
      baseline[path] = unknown;
      expect(await snap(request, baseURL, path), `pending vs unknown ${path}`).toEqual(unknown);
    }
  });

  test("walk: verified, attach_pending, attached are NOT serving - same 404 as no row at all", async ({ request, baseURL }) => {
    for (const state of ["verified", "attach_pending", "attached"]) {
      await stepDomain(sql, world.rows.walk.id, state);
      for (const path of PATHS) {
        expect(await snap(request, baseURL, path), `${state} ${path}`).toEqual(baseline[path]);
      }
    }
  });

  test("live serves; a hold (paused, then disputed) darkens it into the same 404; clearing restores it", async ({ request, baseURL }) => {
    await stepDomain(sql, world.rows.walk.id, "live");
    const live = await rawGet(request, baseURL, HOSTS.walk, "/");
    expect(live.status()).toBe(200);
    expect(await live.text()).toContain(TITLES.walk);

    for (const hold of ["paused", "disputed"] as const) {
      await setHold(sql, world.rows.walk.id, hold);
      for (const path of PATHS) {
        expect(await snap(request, baseURL, path), `${hold} ${path}`).toEqual(baseline[path]);
      }
      await setHold(sql, world.rows.walk.id, null);
      expect((await rawGet(request, baseURL, HOSTS.walk, "/")).status(), `after clearing ${hold}`).toBe(200);
    }
  });

  test("lapsed, parked, release_pending and released are NOT serving - the same 404", async ({ request, baseURL }) => {
    const walk = world.rows.walk.id;
    // live -> lapsed -> parked -> release_pending -> released: every legal onward edge.
    await stepDomain(sql, walk, "lapsed");
    for (const path of PATHS) expect(await snap(request, baseURL, path), `lapsed ${path}`).toEqual(baseline[path]);

    await stepDomain(sql, walk, "parked", "removed");
    for (const path of PATHS) expect(await snap(request, baseURL, path), `parked ${path}`).toEqual(baseline[path]);

    await stepDomain(sql, walk, "release_pending", "force_released", "Arranged by the e2e fixture.");
    for (const path of PATHS) expect(await snap(request, baseURL, path), `release_pending ${path}`).toEqual(baseline[path]);

    await stepDomain(sql, walk, "released");
    for (const path of PATHS) expect(await snap(request, baseURL, path), `released ${path}`).toEqual(baseline[path]);
  });

  test("an expired (never proven) claim is the same 404", async ({ request, baseURL }) => {
    await addExpiredClaim(sql, world.walk.orgId, HOSTS.expired);
    for (const path of PATHS) {
      const expired = await snapshot(await rawGet(request, baseURL, HOSTS.expired, path), HOSTS.expired);
      expect(expired, `expired ${path}`).toEqual(baseline[path]);
    }
  });
});

test.describe("each part of the serving predicate darkens a live host into that same 404", () => {
  async function expectDark(request: Parameters<typeof rawGet>[0], baseURL: string | undefined, label: string) {
    // The baseline is an unknown host's answer, taken fresh each time (a host that has no row at all).
    const baseline404 = await snapshot(await rawGet(request, baseURL, HOSTS.unknown, "/"), HOSTS.unknown);
    expect(baseline404.status, label).toBe(404);
    const res = await snapshot(await rawGet(request, baseURL, HOSTS.two, "/"), HOSTS.two);
    expect(res, label).toEqual(baseline404);
    for (const path of ["/about", "/sitemap.xml", "/robots.txt"]) {
      expect((await rawGet(request, baseURL, HOSTS.two, path)).status(), `${label} ${path}`).toBe(404);
    }
  }
  async function expectServing(request: Parameters<typeof rawGet>[0], baseURL: string | undefined, label: string) {
    const res = await rawGet(request, baseURL, HOSTS.two, "/");
    expect(res.status(), label).toBe(200);
    expect(await res.text(), label).toContain(TITLES.two);
  }

  test("the org's domains toggle off", async ({ request, baseURL }) => {
    await setDomainsToggle(sql, world.two.orgId, false);
    await expectDark(request, baseURL, "toggle off");
    await setDomainsToggle(sql, world.two.orgId, null);
    await expectDark(request, baseURL, "toggle row absent");
    await setDomainsToggle(sql, world.two.orgId, true);
    await expectServing(request, baseURL, "toggle restored");
  });

  test("the site suspended, or not yet published", async ({ request, baseURL }) => {
    for (const status of ["suspended", "provisioning"] as const) {
      await setSiteStatus(sql, world.two.orgId, status);
      await expectDark(request, baseURL, `site ${status}`);
    }
    await setSiteStatus(sql, world.two.orgId, "live");
    await expectServing(request, baseURL, "site restored");
  });

  test("the organization inactive", async ({ request, baseURL }) => {
    await setOrgStatus(sql, world.two.orgId, "inactive");
    await expectDark(request, baseURL, "org inactive");
    await setOrgStatus(sql, world.two.orgId, "active");
    await expectServing(request, baseURL, "org restored");
  });

  test("the sites.public_render flag off", async ({ request, baseURL }) => {
    await setPublicRenderFlag(sql, false);
    try {
      await expectDark(request, baseURL, "flag off");
    } finally {
      await setPublicRenderFlag(sql, true);
    }
    await expectServing(request, baseURL, "flag restored");
  });

  test("a different org's name is never in any of these responses", async ({ request, baseURL }) => {
    for (const org of [ORG_NAMES.two, ORG_NAMES.walk, "E2E Domains Church One"]) {
      const res = await rawGet(request, baseURL, HOSTS.unknown, "/");
      expect(await res.text()).not.toContain(org);
    }
  });
});
