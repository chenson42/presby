/**
 * public-events-calendar.spec.ts (hydration) - the public events calendar before
 * its scripts run (DECISION-159 in spirit; docs/work-log/2026-10-25-public-
 * events-calendar.md, Phase 3 T20; DECISION-239). Same pattern as
 * giving-give-form.spec.ts: hold every `/_next/static/**.js` chunk, load with
 * `domcontentloaded`, assert what a visitor can and cannot do with NO script,
 * release, and use control enablement as the hydration signal (no networkidle,
 * no waitForTimeout, no throttling).
 *
 * The calendar is not a form, so the property is the inverse of the forms':
 * the READ is already complete in the HTML (the opening month's list and event
 * are there, a native <details> opens, the phone shows a list and no grid), and
 * the CONTROLS are inert - an arrow that does nothing is never presented as
 * live, and a click on it before hydration changes nothing.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in
 * the `prod-build` project. Anonymous: no sign-in.
 */

import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import {
  PUBCAL_TEXT,
  PUBCAL_TITLES,
  removePublicCalendarWorld,
  setPublicCalendarToggle,
  setupPublicCalendarWorld,
  type PublicCalendarWorld,
} from "../support/public-calendar-fixture";

/** Holds every `/_next/static/**.js` request until the returned function is called. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  return release;
}

test.describe("Hydration - public events calendar", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let flags: FlagCapture;
  let world: PublicCalendarWorld;

  test.beforeAll(async () => {
    sql = platformSql("hydration/public-events-calendar.spec");
    flags = await captureFlags(sql, ["sites.public_render"]);
    await setFlag(sql, "sites.public_render", true);
    world = await setupPublicCalendarWorld(sql);
    await setPublicCalendarToggle(sql, world.orgId, true);
  });

  test.afterAll(async () => {
    if (world) await removePublicCalendarWorld(sql, world);
    if (flags) await flags.restore();
  });

  test.describe("on a phone (360px)", () => {
    test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

    test("the list and the event are in the HTML, details open with no script, every control is disabled until hydration", async ({ page }) => {
      const release = await holdScripts(page);
      await page.goto(`/site/${world.slug}`, { waitUntil: "domcontentloaded" });

      // The read is complete: a list (not a grid), today's event, full-text day heading.
      const panel = page.locator("[data-month]:not([hidden])");
      await expect(panel.getByText(PUBCAL_TITLES.today)).toBeVisible();
      await expect(panel.getByRole("heading", { level: 3 }).first()).toContainText(/\w+, \w+ \d+/);
      await expect(panel.getByText("Sun", { exact: true })).toBeHidden();
      // Only the opening month is visible; the others are in the HTML but hidden.
      await expect(page.locator("[data-month][hidden]")).toHaveCount(13);

      // A native <details> opens with NO script at all.
      await panel.locator("summary", { hasText: PUBCAL_TITLES.today }).click();
      await expect(panel.getByText(`Where: ${PUBCAL_TEXT.todayLocation}`)).toBeVisible();

      // Every control is inert, and a click on one changes nothing.
      const month = await page.getByTestId("public-calendar-month").textContent();
      const next = page.getByRole("button", { name: /^Next month/ });
      await expect(next).toBeDisabled();
      await expect(page.getByRole("button", { name: /^Previous month/ })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Today" })).toBeDisabled();
      await next.click({ force: true, noWaitAfter: true }).catch(() => {});
      await expect(page.getByTestId("public-calendar-month")).toHaveText(month!);

      release();
      await expect(next).toBeEnabled();
      await next.click();
      await expect(page.getByTestId("public-calendar-month")).not.toHaveText(month!);
    });
  });

  test.describe("on a computer (1280px)", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("the month grid and its controls: the grid is in the HTML, the layout buttons are disabled until hydration", async ({ page }) => {
      const release = await holdScripts(page);
      await page.goto(`/site/${world.slug}`, { waitUntil: "domcontentloaded" });

      const panel = page.locator("[data-month]:not([hidden])");
      await expect(panel.getByText("Sun", { exact: true })).toBeVisible();
      await expect(panel.getByText(PUBCAL_TITLES.today)).toBeVisible();
      await expect(page.getByRole("button", { name: "List", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: /^Next month/ })).toBeDisabled();

      release();
      await expect(page.getByRole("button", { name: /^Next month/ })).toBeEnabled();
      await page.getByRole("button", { name: "List", exact: true }).click();
      await expect(page.getByTestId("public-calendar")).toHaveAttribute("data-view", "list");
    });
  });
});
