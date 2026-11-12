/**
 * learn-spot-the-scam.spec.ts (custom domains) - Spot the scam on a church's OWN domain
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "E2E plan"; DECISION-176/178/181 "a custom host is a key,
 * not an identity"; DECISION-332). The same page on the platform host and in the portal is
 * e2e/learn-spot-the-scam.spec.ts.
 *
 * Driven by a real browser at `http://learn-church.invalid:<port>/` (Chromium maps `*.invalid` to loopback,
 * playwright.config.ts). What it proves that the platform-host spec cannot:
 *   - the practice renders at the CLEAN path `/learn/spot-the-scam` of the church's domain (the proxy rewrites
 *     it into the one public tree), from the DATABASE's organization, never the host;
 *   - the canonical URL and the back link name the church's host and no `/site/<slug>` path;
 *   - "your answers are never sent or saved" holds on a church's own domain: ZERO requests after hydration and
 *     no Set-Cookie on any response and no cookie in the browser;
 *   - the platform's slug URL hands off (307, `no-store`) to the serving host;
 *   - the toggle off is the site's 404 there, `/api/*` is a neutral 404, and nothing overflows at 360px.
 *
 * Creates only its own rows (a throwaway `e2e-learn-*` congregation and presbytery, a live canonical host
 * for the congregation) and removes them in afterAll.
 */
import { test, expect, type Page, type Request } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { addDomain, getPublicRenderFlag, originFor, rawGet, setDomainsToggle, setPublicRenderFlag } from "../support/custom-hosts";
import { SCENARIOS } from "../../src/lib/learn/spot-the-scam/content";
import { removeLearnFixture, setLearnToggle, setupLearnFixture, type LearnFixture } from "../support/learn-fixture";

const HOST = "learn-church.invalid";
const TOTAL = SCENARIOS.length;

let sql: Sql;
let fx: LearnFixture;
let originalRenderFlag: boolean;

test.beforeAll(async () => {
  sql = platformSql("custom-domains/learn-spot-the-scam.spec");
  originalRenderFlag = await getPublicRenderFlag(sql);
  await setPublicRenderFlag(sql, true);
  fx = await setupLearnFixture(sql);
  await setDomainsToggle(sql, fx.congregation.orgId, true);
  await addDomain(sql, { orgId: fx.congregation.orgId, hostname: HOST, role: "canonical", state: "live", token: 8 });
  await setLearnToggle(sql, fx.congregation.orgId, true);
});

test.afterAll(async () => {
  if (sql) {
    if (fx) await removeLearnFixture(sql, fx);
    await setPublicRenderFlag(sql, originalRenderFlag);
    expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalRenderFlag);
  }
});

test.afterEach(async () => {
  await setLearnToggle(sql, fx.congregation.orgId, true);
});

async function noHorizontalScroll(page: Page, width: number) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw, `scrollWidth ${m.sw} vs viewport ${width}`).toBeLessThanOrEqual(width);
}

async function hydrated(page: Page) {
  await expect(page.getByRole("button", { name: "Looks genuine" }).first()).toBeEnabled({ timeout: 30_000 });
}

test("canary: the church's domain serves the church's page", async ({ page, baseURL }) => {
  const response = await page.goto(`${originFor(HOST, baseURL)}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fx.congregation.name);
});

test("the practice renders at the clean /learn/spot-the-scam path; its canonical URL and back link name the church's host and no platform path", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  const response = await page.goto(`${originFor(HOST, baseURL)}/learn/spot-the-scam`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Spot the scam" })).toBeVisible();
  await expect(page.getByTestId("rules-card")).toBeVisible();
  // From the DATABASE's organization, never the request's host.
  await expect(page.getByRole("link", { name: `Back to ${fx.congregation.name}` })).toHaveAttribute("href", "/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://${HOST}/learn/spot-the-scam`);
  expect(await page.content()).not.toContain(`/site/${fx.congregation.slug}`);
  const hrefs = await page.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  for (const href of hrefs) {
    expect(href).not.toContain("/site/");
    expect(href).not.toContain(fx.congregation.slug);
  }
  // Indexable (operator ruling 2026-11-11).
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots ?? "index").not.toMatch(/noindex/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a full run on the church's own domain sends nothing: zero requests after hydration, no Set-Cookie, no cookie", async ({ page, baseURL }) => {
  const response = await page.goto(`${originFor(HOST, baseURL)}/learn/spot-the-scam`);
  expect(response?.headers()["set-cookie"], "the document sets no cookie").toBeUndefined();
  await hydrated(page);
  await page.waitForTimeout(1000); // a quiet period: a post-hydration prefetch or beacon would land here

  const seen: Request[] = [];
  page.on("request", (req) => seen.push(req));
  for (let i = 0; i < TOTAL; i += 1) {
    const s = SCENARIOS[i]!;
    await expect(page.getByRole("heading", { level: 3, name: `Message ${i + 1} of ${TOTAL}` })).toBeVisible();
    await page.getByRole("button", { name: i % 2 === 0 ? (s.isScam ? "Something's off" : "Looks genuine") : s.isScam ? "Looks genuine" : "Something's off" }).click();
    await expect(page.getByRole("heading", { level: 4 })).toBeFocused();
    await page.getByRole("button", { name: i === TOTAL - 1 ? "See your result" : "Next message" }).click();
  }
  await expect(page.getByRole("heading", { level: 3, name: /of 7 correct$/ })).toBeFocused();
  await page.getByRole("button", { name: "Practice again" }).click();
  await page.waitForTimeout(500);
  expect(seen.map((r) => `${r.method()} ${r.resourceType()} ${r.url()}`), "requests made after hydration").toEqual([]);
  expect((await page.context().cookies()).map((c) => c.name)).toEqual([]);
});

test("the slot on a bundle page renders the practice inside the church's own site", async ({ page, baseURL }) => {
  await page.goto(`${originFor(HOST, baseURL)}/practice`);
  await expect(page.locator(".presby-site").getByTestId("trainer")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("/learn and /learn/<other> are the bundle's own pages on the church's domain; the platform reserves nothing", async ({ page, baseURL }) => {
  expect((await page.goto(`${originFor(HOST, baseURL)}/learn`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Our own learn page" })).toBeVisible();
  expect((await page.goto(`${originFor(HOST, baseURL)}/learn/other`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Our own other learn page" })).toBeVisible();
});

test("toggle off: the practice is the site's 404 on the church's domain, and the slot says the one notice", async ({ page, baseURL }) => {
  await setLearnToggle(sql, fx.congregation.orgId, null);
  expect((await page.goto(`${originFor(HOST, baseURL)}/learn/spot-the-scam`))?.status()).toBe(404);
  await expect(page.getByTestId("trainer")).toHaveCount(0);
  await page.goto(`${originFor(HOST, baseURL)}/practice`);
  await expect(page.getByTestId("spot-the-scam-unavailable")).toHaveText("Our scam-spotting practice isn't available right now. Please check back soon.");
});

test("/api/* is a neutral 404 on the church's domain, and no Learn response sets a cookie", async ({ request, baseURL }) => {
  const api = await rawGet(request, baseURL, HOST, "/api/auth/csrf");
  expect(api.status()).toBe(404);
  for (const path of ["/learn/spot-the-scam", "/practice", "/learn", "/learn/other"]) {
    const res = await rawGet(request, baseURL, HOST, path);
    expect(res.headers()["set-cookie"], path).toBeUndefined();
  }
});

test("the platform's slug URL hands off (307, no-store) to the serving host, keeping the path", async ({ request, baseURL }) => {
  const res = await request.get(`${new URL(baseURL!).origin}/site/${fx.congregation.slug}/learn/spot-the-scam`, { maxRedirects: 0, failOnStatusCode: false });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toBe(`https://${HOST}/learn/spot-the-scam`);
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test.describe("at 360px (a phone)", () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

  test("the practice and a slot page do not scroll sideways; the answers are 44px", async ({ page, baseURL }) => {
    await page.goto(`${originFor(HOST, baseURL)}/learn/spot-the-scam`);
    await hydrated(page);
    await noHorizontalScroll(page, 360);
    for (const name of ["Looks genuine", "Something's off"]) {
      expect((await page.getByRole("button", { name }).boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
    }
    await page.goto(`${originFor(HOST, baseURL)}/practice`);
    await hydrated(page);
    await noHorizontalScroll(page, 360);
  });
});
