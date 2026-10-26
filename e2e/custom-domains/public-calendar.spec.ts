/**
 * public-calendar.spec.ts (custom domains) - the public events calendar on a
 * church's OWN domain (docs/work-log/2026-10-25-public-events-calendar.md,
 * Phase 3 T19; DECISION-176/178/181 "a custom host is a key, not an identity";
 * DECISION-239). The same page on the platform host, and the editor flow, are
 * e2e/public-calendar.spec.ts.
 *
 * Driven by a real browser at `http://pubcal-church.invalid:<port>/` (Chromium maps
 * `*.invalid` to loopback, playwright.config.ts). What it proves that the platform-host
 * spec cannot:
 *   - the calendar renders at the CLEAN paths `/` and `/events` of the church's domain
 *     and reads the DATABASE's organization, never the host;
 *   - month switching makes NO network request at all (every `/api/*` path 404s on a
 *     custom host, so a navigation that fetched would be a broken calendar);
 *   - the one outbound link, "Member sign-in", is absolute and on the PLATFORM host
 *     (where sign-in lives), names the church's slug only there, and carries no query
 *     or callbackUrl;
 *   - no horizontal scroll at 360px, and the toggle off is the one unavailable sentence.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import {
  addDomain,
  getPublicRenderFlag,
  originFor,
  setDomainsToggle,
  setPublicRenderFlag,
} from "../support/custom-hosts";
import {
  PUBCAL_TITLES,
  removePublicCalendarWorld,
  setMemberCalendarToggle,
  setPublicCalendarToggle,
  setupPublicCalendarWorld,
  type PublicCalendarWorld,
} from "../support/public-calendar-fixture";

const HOST = "pubcal-church.invalid";
const UNAVAILABLE = "Our events calendar isn't available right now. Please check back soon.";

let sql: Sql;
let world: PublicCalendarWorld;
let originalRenderFlag: boolean;

test.beforeAll(async () => {
  sql = platformSql("custom-domains/public-calendar.spec");
  originalRenderFlag = await getPublicRenderFlag(sql);
  await setPublicRenderFlag(sql, true);
  world = await setupPublicCalendarWorld(sql);
  await setDomainsToggle(sql, world.orgId, true);
  await addDomain(sql, { orgId: world.orgId, hostname: HOST, role: "canonical", state: "live", token: 7 });
  await setPublicCalendarToggle(sql, world.orgId, true);
});

test.afterAll(async () => {
  if (sql) {
    if (world) await removePublicCalendarWorld(sql, world);
    await setPublicRenderFlag(sql, originalRenderFlag);
    expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalRenderFlag);
  }
});

test.afterEach(async () => {
  await setPublicCalendarToggle(sql, world.orgId, true);
  await setMemberCalendarToggle(sql, world.orgId, null);
});

async function noHorizontalScroll(page: Page, width: number) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw, `scrollWidth ${m.sw} vs viewport ${width}`).toBeLessThanOrEqual(width);
}

test("canary: the church's domain serves the church's page", async ({ page, baseURL }) => {
  const response = await page.goto(`${originFor(HOST, baseURL)}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(world.name);
});

test("the calendar renders at the clean / and /events paths from the database's organization", async ({ page, baseURL }) => {
  for (const path of ["/", "/events"]) {
    await page.goto(`${originFor(HOST, baseURL)}${path}`);
    await expect(page.getByTestId("public-calendar")).toBeVisible();
    await expect(page.getByText(PUBCAL_TITLES.today)).toBeVisible();
    const html = await page.content();
    // Nothing a visitor receives names the platform's URL space for this church except the one portal link.
    expect(html).not.toContain(`/site/${world.slug}/events`);
  }
});

test("only the marked events are ever sent on the church's domain", async ({ page, baseURL }) => {
  await page.goto(`${originFor(HOST, baseURL)}/`);
  const html = await page.content();
  expect(html).toContain(PUBCAL_TITLES.listed);
  for (const title of [PUBCAL_TITLES.membersOnly, PUBCAL_TITLES.cancelled, PUBCAL_TITLES.unlisted, "Session business"]) {
    expect(html, title).not.toContain(title);
  }
});

test("switching months and opening details make no network request at all", async ({ page, baseURL }) => {
  await page.goto(`${originFor(HOST, baseURL)}/`);
  const next = page.getByRole("button", { name: /^Next month/ });
  await expect(next).toBeEnabled();

  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
  await next.click();
  await expect(page.locator("[data-month]:not([hidden])").getByText(PUBCAL_TITLES.listed)).toBeVisible();
  await page.locator("[data-month]:not([hidden]) summary", { hasText: PUBCAL_TITLES.listed }).click();
  await page.getByRole("button", { name: "Today" }).click();
  expect(requests, requests.join("\n")).toEqual([]);
});

test("the member sign-in link is absolute, on the PLATFORM host, with no query", async ({ page, baseURL }) => {
  await setMemberCalendarToggle(sql, world.orgId, true);
  await page.goto(`${originFor(HOST, baseURL)}/`);
  const link = page.getByRole("link", { name: "Member sign-in" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  const url = new URL(href);
  expect(url.host).not.toBe(`${HOST}:${new URL(baseURL!).port}`);
  expect(url.hostname).not.toBe(HOST);
  expect(url.pathname).toBe(`/o/${world.slug}/calendar`);
  expect(url.search).toBe("");
  expect(href).not.toMatch(/callback/i);
});

test("the toggle off is the one unavailable sentence on the church's domain too", async ({ page, baseURL }) => {
  await setPublicCalendarToggle(sql, world.orgId, null);
  await page.goto(`${originFor(HOST, baseURL)}/`);
  await expect(page.getByTestId("public-calendar-unavailable")).toHaveText(UNAVAILABLE);
  const html = await page.content();
  for (const title of [PUBCAL_TITLES.today, PUBCAL_TITLES.listed]) expect(html).not.toContain(title);
});

test.describe("at 360px (a phone)", () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

  test("a list with no horizontal scroll, even for the 200-character unbroken title; controls at least 44px", async ({ page, baseURL }) => {
    await page.goto(`${originFor(HOST, baseURL)}/`);
    const next = page.getByRole("button", { name: /^Next month/ });
    await expect(next).toBeEnabled();
    await expect(page.locator("[data-month]:not([hidden])").getByText("Sun", { exact: true })).toBeHidden();
    for (const name of [/^Previous month/, "Today", /^Next month/]) {
      const box = (await page.getByRole("button", { name }).boundingBox())!;
      expect(box.height, String(name)).toBeGreaterThanOrEqual(44);
    }
    await next.click();
    await expect(page.locator("[data-month]:not([hidden])").getByText(PUBCAL_TITLES.long)).toBeVisible();
    await noHorizontalScroll(page, 360);
  });
});

test.describe("at 1280px (a computer)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the month grid, with no horizontal scroll", async ({ page, baseURL }) => {
    await page.goto(`${originFor(HOST, baseURL)}/`);
    await expect(page.getByRole("button", { name: /^Next month/ })).toBeEnabled();
    await expect(page.locator("[data-month]:not([hidden])").getByText("Sun", { exact: true })).toBeVisible();
    await noHorizontalScroll(page, 1280);
  });
});
