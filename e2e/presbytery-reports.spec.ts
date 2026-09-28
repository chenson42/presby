/**
 * presbytery-reports.spec.ts — `/o/<slug>/admin/reports`, the presbytery's
 * congregation-statistics + per-capita + submission-grants page
 * (2026-09-28-presbytery-e2e, tech-lead Phase 3 Notes §7).
 *
 * `describe.serial`: statistics entry -> rate -> generate -> payment is a
 * real dependency chain, and the split-permission case (case 5) depends on
 * `org-multi`'s existing `e2e_statistics_manage` role staying at EXACTLY one
 * permission (`statistics.manage`, no `per_capita.manage`) — never widen that
 * role; it is `statistics-submit.spec.ts`'s own shared fixture too.
 *
 * This file uses report/billing year 2095 (reserved SASR band) for its own
 * `congregation_statistics` write, and its OWN spec-local disable/delete/
 * enable helper scoped to `congregation_statistics_freeze` ONLY — not
 * `e2e/support/sasr-fixture.ts`, which is scoped to the publish/withdraw
 * chain (`publications`/`statistical_returns`). The `presbytery_entered`
 * provenance path this page writes through (`setCongregationStatistics()`)
 * never creates a `publications`/`statistical_returns` row at all (confirmed
 * by reading `src/lib/presbytery.ts`), so growing `sasr-fixture.ts` to cover
 * a table it was not designed around would blur its one job. Per-capita's own
 * tables (`per_capita_rates`/`per_capita_records` — a payment is columns on
 * the record itself, `paid_amount`/`paid_at`/`paid_status`, not a separate
 * table) carry no freeze trigger (confirmed by information_schema) — plain
 * deletes in `afterAll`.
 *
 * Flow 3 (submission-grant issue/revoke/anonymous-submit) is fully covered
 * by `e2e/statistics-submit.spec.ts` and is NOT re-covered here — case 9
 * below only proves the "Submission grants" section's OWN flag-off state,
 * which that spec never exercises (it always runs with the flag on).
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, type FlagCapture, setFlag } from "./support/flags";

const REPORTS_FLAG = "org_portal.reports";
const SUBMISSION_GRANTS_FLAG = "statistics.submission_grants";
const REPORT_YEAR = 2095;

async function removeCongregationStatistics(
  sql: Sql,
  organizationId: string,
  aboutOrgId: string,
  year: number,
): Promise<void> {
  await sql.query(`
    do $cleanup$
    begin
      alter table congregation_statistics disable trigger congregation_statistics_freeze;
      delete from congregation_statistics
       where organization_id = '${organizationId}'::uuid
         and about_org_id = '${aboutOrgId}'::uuid
         and year = ${year};
      alter table congregation_statistics enable trigger congregation_statistics_freeze;
    end
    $cleanup$;
  `);
  await sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`;
  const rows = (await sql`
    select tgenabled from pg_trigger where tgname = 'congregation_statistics_freeze'
  `) as { tgenabled: string }[];
  if (rows[0]?.tgenabled !== "O") {
    throw new Error(
      "[presbytery-reports.spec] teardown left congregation_statistics_freeze " +
        "disabled -- append-only enforcement is OFF until this is fixed by hand.",
    );
  }
}

test.describe.serial("Presbytery reports (2026-09-28-presbytery-e2e)", () => {
  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("presbytery-reports.spec");
    flags = await captureFlags(sql, [REPORTS_FLAG, SUBMISSION_GRANTS_FLAG]);
    await setFlag(sql, REPORTS_FLAG, true);
    await setFlag(sql, SUBMISSION_GRANTS_FLAG, true);

    // Idempotent re-run: remove any leftover 2095 fixture data from a prior
    // crashed run before this run stages its own.
    await removeCongregationStatistics(sql, E2E_ORGS.presbytery.id, E2E_ORGS.alpha.id, REPORT_YEAR);
    await sql`
      delete from per_capita_records
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid and billing_year = ${REPORT_YEAR}
    `;
    await sql`
      delete from per_capita_rates
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid and billing_year = ${REPORT_YEAR}
    `;
  });

  test.afterAll(async () => {
    await flags.restore();

    await sql`
      delete from per_capita_records
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid and billing_year = ${REPORT_YEAR}
    `;
    await sql`
      delete from per_capita_rates
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid and billing_year = ${REPORT_YEAR}
    `;
    await removeCongregationStatistics(sql, E2E_ORGS.presbytery.id, E2E_ORGS.alpha.id, REPORT_YEAR);
  });

  test("1. presbytery clerk enters congregation statistics for 2095", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports?year=${REPORT_YEAR}`);
    await page.waitForLoadState("networkidle");
    await page.locator("#stats-congregation").selectOption(E2E_ORGS.alpha.id);
    await page.locator("#stats-year").fill(String(REPORT_YEAR));
    await page.locator("#stats-endingActive").fill("120");
    await page.locator("#stats-minute-reference").fill("Session minutes, e2e fixture");
    await page.getByRole("button", { name: /^save statistics$/i }).click();

    await expect(page.getByText(/statistics saved/i)).toBeVisible({ timeout: 10_000 });
    const statsSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Congregation Statistics" }),
    });
    await expect(statsSection.getByText("Presbytery estimate")).toBeVisible();

    const rows = (await sql`
      select id from audit_events
       where action = 'tenant.congregation_statistics.entered'
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
         and metadata->>'aboutOrgId' = ${E2E_ORGS.alpha.id}
       order by created_at desc
       limit 1
    `) as { id: string }[];
    expect(rows.length).toBe(1);

    await context.close();
  });

  test("2. presbytery clerk sets the per-capita rate for 2095", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports?billingYear=${REPORT_YEAR}`);
    await page.waitForLoadState("networkidle");
    // Explicit basis year matching REPORT_YEAR itself -- the statistics row
    // case 1 just entered lives at year 2095, not the default basisYear
    // (billingYear - 2 = 2093), which would find nothing for e2e-alpha.
    await page.locator("#rate-basis-year").fill(String(REPORT_YEAR));
    await page.locator("#rate-per-member").fill("35.00");
    await page.getByRole("button", { name: new RegExp(`save rate for ${REPORT_YEAR}`, "i") }).click();

    await expect(page.getByText(/per-capita rate saved/i)).toBeVisible({ timeout: 10_000 });

    const rows = (await sql`
      select id from audit_events
       where action = 'tenant.per_capita_rate.set'
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
       order by created_at desc
       limit 1
    `) as { id: string }[];
    expect(rows.length).toBe(1);

    await context.close();
  });

  test("3. presbytery clerk generates 2095 per-capita records", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports?billingYear=${REPORT_YEAR}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: new RegExp(`generate ${REPORT_YEAR} records`, "i") }).click();

    await expect(page.getByText(/generated \d+ record/i)).toBeVisible({ timeout: 10_000 });

    const rows = (await sql`
      select id from audit_events
       where action = 'tenant.per_capita_records.generated'
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
       order by created_at desc
       limit 1
    `) as { id: string }[];
    expect(rows.length).toBe(1);

    await context.close();
  });

  test("4. presbytery clerk records a per-capita payment", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports?billingYear=${REPORT_YEAR}`);
    await page.waitForLoadState("networkidle");
    await page.locator("#payment-amount").fill("2100.00");
    await page.locator("#payment-date").fill("2095-03-15");
    await page.getByRole("button", { name: /^record payment$/i }).click();

    await expect(page.getByText(/payment recorded/i)).toBeVisible({ timeout: 10_000 });

    const rows = (await sql`
      select id from audit_events
       where action = 'tenant.per_capita_payment.recorded'
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
       order by created_at desc
       limit 1
    `) as { id: string }[];
    expect(rows.length).toBe(1);

    await context.close();
  });

  test("5. split permission: statistics.manage without per_capita.manage renders one section live, one forbidden", async ({
    browser,
  }) => {
    // org-multi holds e2e_statistics_manage (statistics.manage ONLY) at
    // e2e-presbytery -- NEVER widen that role; see this file's header and
    // statistics-submit.spec.ts, which shares it.
    const context = await browser.newContext({ storageState: storageStatePath("org-multi") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Congregation Statistics" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    await expect(
      page.getByText(/don't have permission to manage per-capita billing/i),
    ).toBeVisible();
    // The live section's own form fields are visible; the per-capita form is not.
    await expect(page.locator("#rate-per-member")).toHaveCount(0);

    await context.close();
  });

  test("6. no grant at all: both statistics and per-capita sections are forbidden", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-nogrant"),
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/don't have permission to manage statistics/i)).toBeVisible();
    await expect(
      page.getByText(/don't have permission to manage per-capita billing/i),
    ).toBeVisible();
    await expect(page.locator("#stats-congregation")).toHaveCount(0);
    await expect(page.locator("#rate-per-member")).toHaveCount(0);

    await context.close();
  });

  test("7. the wrong org type gets a product-not-here message", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("org-single") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/reports`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/isn't the kind of organization this tool is built for/i),
    ).toBeVisible();
    await expect(page.getByText(/don't have permission to manage/i)).toHaveCount(0);

    await context.close();
  });

  test("8. flag off renders a plain 'not turned on yet' message for the whole page", async ({
    browser,
  }) => {
    await setFlag(sql, REPORTS_FLAG, false);
    try {
      const context = await browser.newContext({
        storageState: storageStatePath("presbytery-clerk"),
      });
      const page = await context.newPage();

      await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports`);
    await page.waitForLoadState("networkidle");
      await expect(page.getByText(/isn't turned on for .* yet/i)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Congregation Statistics" })).toHaveCount(0);

      await context.close();
    } finally {
      await setFlag(sql, REPORTS_FLAG, true);
    }
  });

  test("9. submission grants' OWN flag-off state, independent of the page flag", async ({
    browser,
  }) => {
    await setFlag(sql, SUBMISSION_GRANTS_FLAG, false);
    try {
      const context = await browser.newContext({
        storageState: storageStatePath("presbytery-clerk"),
      });
      const page = await context.newPage();

      await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports`);
    await page.waitForLoadState("networkidle");
      // The page's own org_portal.reports flag is still ON -- the statistics
      // section renders live, proving this is the grants section's OWN gate,
      // not the whole-page flag.
      await expect(page.getByRole("heading", { name: "Congregation Statistics" })).toBeVisible();
      await expect(
        page.getByText(/submission grants aren't turned on for .* yet/i),
      ).toBeVisible();
      await expect(page.locator("#grant-congregation")).toHaveCount(0);

      await context.close();
    } finally {
      await setFlag(sql, SUBMISSION_GRANTS_FLAG, true);
    }
  });

  test("10. [360px] entering statistics is operable at mobile width", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports?year=${REPORT_YEAR}`);
    await page.waitForLoadState("networkidle");
    await page.locator("#stats-congregation").selectOption(E2E_ORGS.alpha.id);
    await page.locator("#stats-endingActive").fill("121");
    await page.getByRole("button", { name: /^save statistics$/i }).click();
    await expect(page.getByText(/statistics saved/i)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
