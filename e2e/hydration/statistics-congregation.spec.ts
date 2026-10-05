/**
 * statistics-congregation.spec.ts — the pre-hydration regression for F116
 * (`docs/work-log/2026-09-28-select-hydration-revert.md`, DECISION-159).
 *
 * The defect: react-hook-form's `register()` writes `defaultValues` over the
 * live DOM when it attaches during hydration, so a congregation picked in the
 * statistics form before the page's JavaScript ran was silently replaced by the
 * default, and a different congregation's annual statistics were saved with a
 * success toast. The fix is `<HydrationGate>`: the form is `disabled` until it
 * hydrates.
 *
 * Deterministic by construction, never by racing a throttle: every
 * `/_next/static/**.js` request is held behind a promise with `page.route`, the
 * page is loaded with `waitUntil: "domcontentloaded"` (Next's scripts are
 * `async`, so the HTML parses fully with no JavaScript), the pre-hydration
 * state is asserted, the scripts are released, and CONTROL ENABLEMENT is the
 * hydration signal. No `networkidle`, no `waitForTimeout`, no throttling. CSS is
 * deliberately NOT held (a held render-blocking stylesheet breaks Playwright's
 * visibility checks).
 *
 * Runs in the default `chromium` project (dev server) and, via
 * `npm run test:e2e:prod`, in the `prod-build` project against
 * `next build && next start`. Report year 2096 is this spec's own
 * (`presbytery-reports.spec.ts` owns 2095; DECISION-157 reserves 2090-2099).
 *
 * The persisted-row assertion is the point of test 1: a DOM check is not enough,
 * because the failure mode of a controlled select (F121) looks correct on
 * screen while Submit sends the default.
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "../support/users";
import { E2E_ORGS } from "../support/seed-orgs";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, type FlagCapture, setFlag } from "../support/flags";
import { removeCongregationStatistics } from "../support/statistics-fixture";

const REPORTS_FLAG = "org_portal.reports";
const YEAR = 2096;
const REPORTS_URL = `/o/${E2E_ORGS.presbytery.slug}/admin/reports?year=${YEAR}`;

/** Holds every `/_next/static/**.js` request until the returned function is called. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    // The page may be gone by the time a late chunk is released.
    await route.continue().catch(() => {});
  });
  return release;
}

test.describe("Hydration — statistics form (DECISION-159, F116)", () => {
  test.setTimeout(90_000);

  let sql: Sql;
  let flags: FlagCapture;

  async function clearFixtureRows() {
    for (const cong of [E2E_ORGS.alpha, E2E_ORGS.beta, E2E_ORGS.gamma]) {
      await removeCongregationStatistics(sql, E2E_ORGS.presbytery.id, cong.id, YEAR);
    }
  }

  test.beforeAll(async () => {
    sql = platformSql("hydration/statistics-congregation.spec");
    flags = await captureFlags(sql, [REPORTS_FLAG]);
    await setFlag(sql, REPORTS_FLAG, true);
  });

  test.beforeEach(async () => {
    // Idempotent: a retry or a crashed prior run, and the wrong-congregation row
    // (the default, gamma) that a regression would write.
    await clearFixtureRows();
  });

  test.afterAll(async () => {
    await clearFixtureRows();
    await flags.restore();
  });

  test("a congregation picked before hydration is impossible; the one picked after is the one persisted", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
    });
    const page = await context.newPage();
    const release = await holdScripts(page);
    try {
      await page.goto(REPORTS_URL, { waitUntil: "domcontentloaded" });

      const select = page.locator("#stats-congregation");
      const submit = page.getByRole("button", { name: /^save statistics$/i });

      // Pre-release: these are the lines that fail without the gate.
      await expect(select).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect(page.locator("#stats-endingActive")).toBeDisabled();
      // (The reports page holds more than one gated form -- statistics and
      // per-capita rate -- so scope to the gate that contains the select.)
      await expect(
        page.locator('fieldset[data-slot="hydration-gate"][aria-busy="true"]', {
          has: select,
        }),
      ).toHaveCount(1);
      // Fixture sanity: alpha (Wrenfield) must be a NON-default option (the
      // default is the alphabetically first, Halloway = gamma), or this test
      // would pass vacuously.
      await expect(select).not.toHaveValue(E2E_ORGS.alpha.id);

      release();

      // Enablement IS the hydration signal.
      await expect(select).toBeEnabled({ timeout: 30_000 });

      await select.selectOption(E2E_ORGS.alpha.id);
      await expect(select).toHaveValue(E2E_ORGS.alpha.id);
      await page.locator("#stats-endingActive").fill("73");
      await page.locator("#stats-minute-reference").fill("Hydration spec, e2e fixture");
      await submit.click();

      await expect(page.getByText(/statistics saved/i)).toBeVisible({ timeout: 10_000 });

      const rows = (await sql`
        select about_org_id, ending_active, minute_reference
          from congregation_statistics
         where organization_id = ${E2E_ORGS.presbytery.id}::uuid and year = ${YEAR}
      `) as { about_org_id: string; ending_active: number; minute_reference: string }[];
      expect(rows).toHaveLength(1);
      // The clicked congregation, NOT the default (gamma).
      expect(rows[0].about_org_id).toBe(E2E_ORGS.alpha.id);
      expect(rows[0].ending_active).toBe(73);
      expect(rows[0].minute_reference).toBe("Hydration spec, e2e fixture");
    } finally {
      release();
      await context.close();
    }
  });

  test("a Submit before hydration is inert (F123)", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
    });
    const page = await context.newPage();
    const release = await holdScripts(page);
    try {
      await page.goto(REPORTS_URL, { waitUntil: "domcontentloaded" });

      const select = page.locator("#stats-congregation");
      const submit = page.getByRole("button", { name: /^save statistics$/i });
      await expect(submit).toBeDisabled();

      // `force` is the point: it bypasses Playwright's own enabled check to
      // prove the browser itself swallows the click. A native GET submit would
      // navigate to `...?aboutOrgId=...&year=...` (every field in the URL).
      const startUrl = page.url();
      await submit.click({ force: true });

      release();
      await expect(select).toBeEnabled({ timeout: 30_000 });
      await expect(page).toHaveURL(startUrl);
    } finally {
      release();
      await context.close();
    }
  });

  test("[360px] the gate is visible and releases at mobile width", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();
    const release = await holdScripts(page);
    try {
      await page.goto(REPORTS_URL, { waitUntil: "domcontentloaded" });

      const select = page.locator("#stats-congregation");
      await expect(select).toBeDisabled();
      await expect(page.getByRole("button", { name: /^save statistics$/i })).toBeDisabled();
      await expect(page.locator("#stats-year")).toBeDisabled();

      release();
      await expect(select).toBeEnabled({ timeout: 30_000 });
      await select.selectOption(E2E_ORGS.alpha.id);
      await expect(select).toHaveValue(E2E_ORGS.alpha.id);
    } finally {
      release();
      await context.close();
    }
  });
});
