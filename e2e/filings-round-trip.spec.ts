/**
 * filings-round-trip.spec.ts — publish -> presbytery sees -> withdraw ->
 * presbytery sees (2026-09-28-presbytery-e2e, tech-lead Phase 3 Notes §8).
 *
 * PUBLISH IS STAGED, NEVER BROWSED (architect ruling 3, orchestrator ruling
 * 3/4): `org_portal.statistical_publication` is a seeded flag with no page
 * behind it (confirmed by grep). `beforeAll` stages TWO fresh publication
 * chains at e2e-alpha via `e2e/support/sasr-fixture.ts`'s
 * `stagePublishedReturn()` (year 2094 for the desktop withdraw, year 2096 for
 * the 360px pass — case 5 spends 2094 on a real withdrawal before case 9's
 * mobile pass would otherwise need one) — through the product's own
 * `presby_publish_sasr_snapshot()`, never a hand-rolled imitation.
 *
 * DECISION-157: Alder Creek's real 2025 publication is NEVER touched by this
 * spec. `beforeAll`/`afterAll` both call `assertNoStrayFixtureReturns()`/
 * `assertSeedPublicationsIntact()` to prove it.
 *
 * `withdrawFiling`'s refusal copy (already_withdrawn/superseded) surfaces as
 * TOAST copy, not page copy, and is dead code from the UI's own perspective
 * once the Withdraw button is gone (which case 6 below proves) — asserting
 * it would require an artificial direct-action-call bypassing this suite's
 * "real credentials, no session mocking" invariant. Ruling: assert the
 * button's absence, not the toast.
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, type FlagCapture, setFlag } from "./support/flags";
import { stagePublishedReturn, removePublishedReturn } from "./support/sasr-fixture";
import {
  assertNoStrayFixtureReturns,
  assertSeedPublicationsIntact,
} from "./support/assert-fixture-invariants";

const FILINGS_FLAG = "org_portal.filings";
const DESKTOP_YEAR = 2094;
const MOBILE_YEAR = 2096;

test.describe.serial("Filings round trip (2026-09-28-presbytery-e2e, DECISION-157)", () => {
  let sql: Sql;
  let flags: FlagCapture;
  let desktopPublicationId: string;
  let mobilePublicationId: string;

  test.beforeAll(async () => {
    sql = platformSql("filings-round-trip.spec");
    flags = await captureFlags(sql, [FILINGS_FLAG]);
    await setFlag(sql, FILINGS_FLAG, true);

    await assertNoStrayFixtureReturns();
    await assertSeedPublicationsIntact();

    const desktop = await stagePublishedReturn(sql, {
      congregationOrgId: E2E_ORGS.alpha.id,
      reportYear: DESKTOP_YEAR,
      minuteReference: "Session minutes, e2e fixture (desktop)",
    });
    desktopPublicationId = desktop.publicationId;

    const mobile = await stagePublishedReturn(sql, {
      congregationOrgId: E2E_ORGS.alpha.id,
      reportYear: MOBILE_YEAR,
      minuteReference: "Session minutes, e2e fixture (mobile)",
    });
    mobilePublicationId = mobile.publicationId;
  });

  test.afterAll(async () => {
    await flags.restore();
    await removePublishedReturn(sql, { congregationOrgId: E2E_ORGS.alpha.id, reportYear: DESKTOP_YEAR });
    await removePublishedReturn(sql, { congregationOrgId: E2E_ORGS.alpha.id, reportYear: MOBILE_YEAR });
    await assertNoStrayFixtureReturns();
    await assertSeedPublicationsIntact();
  });

  test("1. staged fixture: both publications exist and are un-withdrawn", async () => {
    const rows = (await sql`
      select report_year, withdrawn_at from publications p
        join statistical_returns sr on sr.id = p.artifact_id and sr.organization_id = p.organization_id
       where p.id in (${desktopPublicationId}::uuid, ${mobilePublicationId}::uuid)
    `) as { report_year: number; withdrawn_at: string | null }[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.withdrawn_at === null)).toBe(true);
  });

  test("2. the presbytery has no Withdraw affordance anywhere in its own tree", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports/${E2E_ORGS.alpha.id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /^withdraw$/i })).toHaveCount(0);

    await context.close();
  });

  test("3. congregation clerk sees the current filing with a Withdraw button", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("congregation-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/filings`);
    await page.waitForLoadState("networkidle");
    const desktopRow = page.locator("tr", { hasText: String(DESKTOP_YEAR) });
    await expect(desktopRow.getByText("Current")).toBeVisible();
    await expect(desktopRow.getByRole("button", { name: /^withdraw$/i })).toBeVisible();
    await expect(
      page.getByText(/don't have permission to manage statistical filings/i),
    ).toHaveCount(0);

    await context.close();
  });

  test("4. an unrelated person is refused by the organization-access axis, not the permission axis", async ({
    browser,
  }) => {
    // presbytery-nogrant has NO membership at e2e-alpha at all -- this is
    // DECISION-040's org-access axis, not statistics.publish's permission
    // axis (a real relationship with no grant would instead see
    // FilingsSectionForbidden, which this fixture is NOT built to test here).
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-nogrant"),
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/filings`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: new RegExp(`you don't have access to`, "i") }),
    ).toBeVisible();

    await context.close();
  });

  test("5. congregation clerk withdraws the 2094 filing; audit row written", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("congregation-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/filings`);
    await page.waitForLoadState("networkidle");
    const desktopRow = page.locator("tr", { hasText: String(DESKTOP_YEAR) });
    await desktopRow.getByRole("button", { name: /^withdraw$/i }).click();

    await page
      .locator(`#withdraw-minute-reference-${desktopPublicationId}`)
      .fill("Session minutes, 2026-09-28, item 4 (e2e fixture withdrawal)");
    await page.getByRole("button", { name: /^yes, withdraw this filing$/i }).click();

    await expect(page.getByText(new RegExp(`${DESKTOP_YEAR} filing withdrawn`, "i"))).toBeVisible({
      timeout: 10_000,
    });
    await expect(desktopRow.getByText("Withdrawn")).toBeVisible();
    await expect(desktopRow.getByRole("button", { name: /^withdraw$/i })).toHaveCount(0);

    const rows = (await sql`
      select resource_id, metadata
        from audit_events
       where action = 'tenant.statistics_return.withdrawn'
         and resource_id = ${desktopPublicationId}
       order by created_at desc
       limit 1
    `) as { resource_id: string; metadata: Record<string, unknown> }[];
    expect(rows.length).toBe(1);
    expect(rows[0].metadata.aboutOrgId).toBe(E2E_ORGS.alpha.id);
    expect(rows[0].metadata.recipientOrgId).toBe(E2E_ORGS.presbytery.id);

    await context.close();
  });

  test("6. re-loading shows the withdrawal persisted; no Withdraw button reappears", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("congregation-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/filings`);
    await page.waitForLoadState("networkidle");
    const desktopRow = page.locator("tr", { hasText: String(DESKTOP_YEAR) });
    await expect(desktopRow.getByText("Withdrawn")).toBeVisible();
    await expect(desktopRow.getByRole("button", { name: /^withdraw$/i })).toHaveCount(0);

    await context.close();
  });

  test("7. the presbytery's reports rollup excludes the withdrawn return", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports?year=${DESKTOP_YEAR}`);
    await page.waitForLoadState("networkidle");
    const alphaRow = page.locator("tr", { hasText: E2E_ORGS.alpha.name });
    await expect(alphaRow.getByText("No data on file")).toBeVisible();
    await expect(alphaRow.getByText("Congregation reported")).toHaveCount(0);

    await context.close();
  });

  test("8. the presbytery's per-congregation filing history shows the withdrawn row, never deleted", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports/${E2E_ORGS.alpha.id}`);
    await page.waitForLoadState("networkidle");
    const historyRow = page.locator("tr", { hasText: String(DESKTOP_YEAR) });
    await expect(historyRow.getByText("Withdrawn")).toBeVisible();
    await expect(historyRow.getByText("Published")).toHaveCount(0);

    await context.close();
  });

  test("9. [360px] withdrawing operates past the table's horizontal scroller", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("congregation-clerk"),
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/filings`);
    await page.waitForLoadState("networkidle");

    // Known issue (docs/TODO.md withdraw residual (2)): the Withdraw button
    // sits inside the table's own horizontal scroller at 360px. Assert the
    // known behavior POSITIVELY -- the scroller overflows -- and still
    // operate the control via scrollIntoViewIfNeeded(), rather than
    // test.fixme()/test.fail() (architect Phase 2 Notes §5).
    test.info().annotations.push({
      type: "known-issue",
      description:
        "docs/TODO.md withdraw residual (2) -- Withdraw sits inside the table " +
        "scroller at 360px; asserted positively (scrollWidth > clientWidth) and " +
        "operated via scrollIntoViewIfNeeded(), not skipped.",
    });

    const mobileRow = page.locator("tr", { hasText: String(MOBILE_YEAR) });
    const withdrawButton = mobileRow.getByRole("button", { name: /^withdraw$/i });
    const scroller = page.locator("[data-slot='table-container']").first();
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    await withdrawButton.scrollIntoViewIfNeeded();
    await withdrawButton.click();
    await page
      .locator(`#withdraw-minute-reference-${mobilePublicationId}`)
      .fill("Session minutes, 2026-09-28, item 5 (e2e fixture withdrawal, mobile)");
    await page.getByRole("button", { name: /^yes, withdraw this filing$/i }).click();

    await expect(page.getByText(new RegExp(`${MOBILE_YEAR} filing withdrawn`, "i"))).toBeVisible({
      timeout: 10_000,
    });

    await context.close();
  });
});

/**
 * Filings' three reachable denial states (2026-09-28-presbytery-e2e, Phase 5
 * loop-back closing GAP-1). Phase 2 Notes §4 enumerated all three anchors and
 * named the fixtures for the wrong-org-type direction; Phase 3's design table
 * silently dropped them. `presbytery-oversight.spec.ts`, `presbytery-
 * credentials.spec.ts` and `presbytery-reports.spec.ts` each already assert
 * flag-off + wrong-org-type + no-grant for their own surfaces — this block is
 * filings' turn.
 *
 * A SEPARATE `describe.serial` from the round trip above, not folded into it:
 * the round trip's `beforeAll` sets `org_portal.filings` ON for its whole
 * 9-case chain and its `afterAll` restores it, so interleaving a flag-off
 * assertion into that block would fight its own fixture lifecycle. This block
 * owns the flag for its own three cases via the same `captureFlags`/`setFlag`
 * helpers, captured and restored independently.
 *
 * `org-single` (Marguerite Ashcombe) has an active, ungranted relationship at
 * e2e-alpha — the "state 3" no-grant fixture for this surface, exactly like
 * `presbytery-nogrant` is for oversight/reports/credentials. `org-multi`
 * (Tobias Fennimore) has a SECOND, active relationship at e2e-presbytery — a
 * `presbytery` org, which `FILINGS_ORG_TYPES` never includes — the
 * wrong-org-type fixture named by Phase 2 Notes §4. No new fixtures needed.
 *
 * Each case asserts its own anchor visible AND a sibling anchor absent (the
 * flag-off <-> forbidden pair), closing the "filings asserts no sibling
 * state at all" gap QA's Observations also named.
 */
test.describe.serial(
  "Filings permission states (2026-09-28-presbytery-e2e loop-back, GAP-1)",
  () => {
    let sql: Sql;
    let flags: FlagCapture;

    test.beforeAll(async () => {
      sql = platformSql("filings-round-trip.spec (GAP-1 block)");
      flags = await captureFlags(sql, [FILINGS_FLAG]);
    });

    test.afterAll(async () => {
      await flags.restore();
    });

    test("10. flag OFF: org-single sees the flag-off placeholder, not the forbidden copy", async ({
      browser,
    }) => {
      await setFlag(sql, FILINGS_FLAG, false);

      const context = await browser.newContext({ storageState: storageStatePath("org-single") });
      const page = await context.newPage();

      await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/filings`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/isn't turned on for/i)).toBeVisible();
      await expect(
        page.getByText(/don't have permission to manage statistical filings/i),
      ).toHaveCount(0);

      await context.close();
    });

    test("11. flag ON, wrong org type: org-multi at the presbytery sees the not-available placeholder", async ({
      browser,
    }) => {
      await setFlag(sql, FILINGS_FLAG, true);

      const context = await browser.newContext({ storageState: storageStatePath("org-multi") });
      const page = await context.newPage();

      await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/filings`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(/isn't the kind of organization this tool is built for/i),
      ).toBeVisible();
      await expect(
        page.getByText(/don't have permission to manage statistical filings/i),
      ).toHaveCount(0);

      await context.close();
    });

    test("12. flag ON, no grant: org-single at e2e-alpha is refused by the permission axis", async ({
      browser,
    }) => {
      // Flag is already ON from case 11 -- this block's own serial ordering,
      // not an assumption about the round trip above.
      const context = await browser.newContext({ storageState: storageStatePath("org-single") });
      const page = await context.newPage();

      await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/filings`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(/don't have permission to manage statistical filings/i),
      ).toBeVisible();
      await expect(page.getByText(/isn't turned on for/i)).toHaveCount(0);

      await context.close();
    });
  },
);
