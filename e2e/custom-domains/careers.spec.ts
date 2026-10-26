/**
 * careers.spec.ts (custom domains) - job openings on a church's OWN domain
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 T26; DECISION-176/178/181 "a custom host is a key,
 * not an identity"; DECISION-264). The same pages on the platform host, and the staff admin, are
 * e2e/careers.spec.ts.
 *
 * Driven by a real browser at `http://careers-church.invalid:<port>/` (Chromium maps `*.invalid` to
 * loopback, playwright.config.ts). What it proves that the platform-host spec cannot:
 *   - the list, a posting and the slot render at the CLEAN paths `/careers`, `/careers/<posting>` and
 *     `/employment` of the church's domain, from the DATABASE's organization, never the host;
 *   - the canonical URL and every link name the church's host (and no `/site/<slug>` path);
 *   - `/api/*` is a neutral 404 there, no response sets a cookie, and the slug URL of the platform hands
 *     off (307, `no-store`) to the serving host;
 *   - the toggle off is the site's 404, and nothing overflows at 360px.
 *
 * Creates only its own rows (a throwaway `e2e-careers-*` congregation with a live site, a canonical
 * host, postings written through the owner connection) and removes them in afterAll.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { addDomain, getPublicRenderFlag, originFor, rawGet, setDomainsToggle, setPublicRenderFlag } from "../support/custom-hosts";
import {
  CAREERS_NAMES,
  addPosting,
  removeCareersFixture,
  setCareersToggle,
  setupCareersFixture,
  type CareersFixture,
} from "../support/careers-fixture";

const HOST = "careers-church.invalid";
const TITLE_OPEN = "E2E Host Open Posting";
const TITLE_CLOSED = "E2E Host Closed Posting";
const TITLE_LONG = `E2E${"W".repeat(147)}`;

let sql: Sql;
let fx: CareersFixture;
let originalRenderFlag: boolean;

test.beforeAll(async () => {
  sql = platformSql("custom-domains/careers.spec");
  originalRenderFlag = await getPublicRenderFlag(sql);
  await setPublicRenderFlag(sql, true);
  fx = await setupCareersFixture(sql);
  await setDomainsToggle(sql, fx.orgId, true);
  await addDomain(sql, { orgId: fx.orgId, hostname: HOST, role: "canonical", state: "live", token: 9 });
  await setCareersToggle(sql, fx, true);
  await addPosting(sql, fx, {
    slug: "host-open",
    title: TITLE_OPEN,
    state: "published",
    description: "## About the role\n\nA role at the church's own domain.\n\n- Item one\n- Item two",
  });
  await addPosting(sql, fx, { slug: "host-closed", title: TITLE_CLOSED, state: "closed" });
  await addPosting(sql, fx, { slug: "host-long", title: TITLE_LONG, state: "published", summary: "x".repeat(250) });
  await addPosting(sql, fx, { slug: "host-draft", title: "E2E Host Draft", state: "draft" });
});

test.afterAll(async () => {
  if (sql) {
    if (fx) await removeCareersFixture(sql, fx);
    await setPublicRenderFlag(sql, originalRenderFlag);
    expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalRenderFlag);
  }
});

test.afterEach(async () => {
  await setCareersToggle(sql, fx, true);
});

async function noHorizontalScroll(page: Page, width: number) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw, `scrollWidth ${m.sw} vs viewport ${width}`).toBeLessThanOrEqual(width);
}

test("canary: the church's domain serves the church's page", async ({ page, baseURL }) => {
  const response = await page.goto(`${originFor(HOST, baseURL)}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fx.name);
});

test("the list renders at the clean /careers path with clean links, and names no platform path", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  const response = await page.goto(`${originFor(HOST, baseURL)}/careers`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Job openings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: TITLE_OPEN })).toBeVisible();
  // A draft and a closed posting are never listed.
  const html = await page.content();
  expect(html).not.toContain("E2E Host Draft");
  expect(html).not.toContain(TITLE_CLOSED);
  expect(html).not.toContain(`/site/${fx.slug}`);
  const hrefs = await page.locator("main a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs).toContain("/careers/host-open");
  expect(hrefs).toContain("/");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a posting renders at /careers/<posting>; its canonical URL and links name the church's host", async ({ page, baseURL }) => {
  const response = await page.goto(`${originFor(HOST, baseURL)}/careers/host-open`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: TITLE_OPEN })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "About the role" })).toBeVisible();
  await expect(page.getByTestId("how-to-apply")).toContainText(`To apply, please contact ${fx.name}. You can reach us at ${CAREERS_NAMES.phone}`);
  // The canonical link is absolute on the CHURCH's host (from the verified database row), not the request's.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://${HOST}/careers/host-open`);
  const hrefs = await page.locator("main a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  for (const href of hrefs) {
    expect(href).not.toContain("/site/");
    expect(href).not.toContain(fx.slug);
  }
  expect(hrefs).toContain("/");
  await expect(page.getByRole("link", { name: "All job openings" })).toHaveAttribute("href", "/employment");
});

test("a closed posting reads P6 and carries noindex; a draft and an unknown posting are the site's 404", async ({ page, baseURL }) => {
  await page.goto(`${originFor(HOST, baseURL)}/careers/host-closed`);
  await expect(page.getByTestId("posting-closed")).toContainText("This position is no longer accepting applications.");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  for (const path of ["/careers/host-draft", "/careers/nope", "/careers/Not%20A%20Slug"]) {
    expect((await page.goto(`${originFor(HOST, baseURL)}${path}`))?.status(), path).toBe(404);
  }
});

test("the slot on /employment renders the list inside the church's own site", async ({ page, baseURL }) => {
  await page.goto(`${originFor(HOST, baseURL)}/employment`);
  await expect(page.locator(".presby-site").getByTestId("careers-list")).toBeVisible();
  const href = await page.getByRole("link", { name: /View this position/ }).first().getAttribute("href");
  expect(href).toMatch(/^\/careers\/host-/);
});

test("toggle off: /careers and a posting are the site's 404 on the church's domain, and the slot says P1", async ({ page, baseURL }) => {
  await setCareersToggle(sql, fx, null);
  expect((await page.goto(`${originFor(HOST, baseURL)}/careers`))?.status()).toBe(404);
  expect((await page.goto(`${originFor(HOST, baseURL)}/careers/host-open`))?.status()).toBe(404);
  await page.goto(`${originFor(HOST, baseURL)}/employment`);
  await expect(page.getByTestId("careers-unavailable")).toHaveText("Our job openings aren't available right now. Please check back soon.");
  expect(await page.content()).not.toContain(TITLE_OPEN);
});

test("/api/* is a neutral 404 on the church's domain, and no careers response sets a cookie", async ({ request, baseURL }) => {
  const api = await rawGet(request, baseURL, HOST, "/api/auth/csrf");
  expect(api.status()).toBe(404);
  for (const path of ["/careers", "/careers/host-open", "/careers/host-closed", "/careers/nope", "/employment"]) {
    const res = await rawGet(request, baseURL, HOST, path);
    expect(res.headers()["set-cookie"], path).toBeUndefined();
  }
});

test("the platform's slug URL hands off (307, no-store) to the serving host, keeping the path", async ({ request, baseURL }) => {
  for (const path of ["/careers", "/careers/host-open"]) {
    const res = await request.get(`${new URL(baseURL!).origin}/site/${fx.slug}${path}`, { maxRedirects: 0, failOnStatusCode: false });
    expect(res.status(), path).toBe(307);
    expect(res.headers()["location"]).toBe(`https://${HOST}${path}`);
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});

test.describe("at 360px (a phone)", () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

  test("the list, a posting with a 150-character unbroken title and the slot do not scroll sideways", async ({ page, baseURL }) => {
    await page.goto(`${originFor(HOST, baseURL)}/careers`);
    await expect(page.getByRole("heading", { level: 2, name: TITLE_LONG })).toBeVisible();
    await noHorizontalScroll(page, 360);
    await page.goto(`${originFor(HOST, baseURL)}/careers/host-long`);
    await expect(page.getByRole("heading", { level: 1, name: TITLE_LONG })).toBeVisible();
    await noHorizontalScroll(page, 360);
    await page.goto(`${originFor(HOST, baseURL)}/employment`);
    await expect(page.getByTestId("careers-list")).toBeVisible();
    await noHorizontalScroll(page, 360);
    for (const link of await page.getByRole("link", { name: /View this position/ }).all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
