/**
 * presbytery-credentials.spec.ts — `/o/<slug>/admin/credentials`, recording
 * ordinations and pastoral appointments (2026-09-28-presbytery-e2e,
 * tech-lead Phase 3 Notes §6). Same four-negative-state discipline as
 * presbytery-oversight.spec.ts (architect Phase 2 Notes §4).
 *
 * THE PERSON-PICKER DRAWS FROM MEMBERSHIPS AT THE PRESBYTERY ITSELF (Notes
 * §4/Edge Cases) — `getCredentialsFormOptions()` queries current memberships
 * at `organizationId` (the presbytery), not at a member congregation. This is
 * why `presbytery-clerk`/`presbytery-nogrant` deliberately have their
 * memberships AT e2e-presbytery, and why case 1 records an ordination for
 * Cassius Brightwell (presbytery-nogrant's own person) rather than inventing
 * a fourth fixture actor.
 *
 * `EndAppointmentDialog`'s confirm button is disabled until a non-empty
 * "Reason" is entered — read directly off end-appointment-dialog.tsx, not
 * assumed from the design table.
 *
 * ORDINATIONS/APPOINTMENTS ARE NOT UPSERTED — unlike `congregation_oversight`
 * (idempotent by `(organization_id, about_org_id)`) or `statistical_returns`
 * (governed by DECISION-157's reserved-year band), every run of case 1/2/7
 * inserts a genuinely NEW row for Cassius Brightwell. Left uncleaned, repeat
 * runs accumulate rows until the "Pastoral appointments" section carries more
 * than one row naming him, and a page-wide `tr` locator becomes ambiguous —
 * a real strict-mode violation caught by running this spec twice in a row
 * (Phase 4 finding, not anticipated by Phase 3's design). `beforeAll` clears
 * any leftovers from a prior crashed run; `afterAll` clears this run's own
 * rows — the same "mint your own rows and clean up" discipline
 * `statistics-submit.spec.ts` already documents for its own SASR chain.
 * Neither table carries a freeze/append-only trigger (confirmed via
 * `pg_trigger`), so a plain `DELETE` is safe here.
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, type FlagCapture, setFlag } from "./support/flags";

const CREDENTIALS_FLAG = "org_portal.credentials";

async function clearFixtureCredentials(sql: Sql): Promise<void> {
  const rows = (await sql`
    select p.id from people p
      join users u on u.id = p.user_id
     where u.email = 'presbytery-nogrant@presby.invalid'
  `) as { id: string }[];
  const personId = rows[0]?.id;
  if (!personId) return;
  await sql`delete from appointments where person_id = ${personId}::uuid`;
  await sql`delete from ordinations where person_id = ${personId}::uuid`;
}

// describe.serial: case 3 consumes case 2's side effect (the appointment case
// 2 records) — QA Phase 5 observation on presbytery-credentials.spec.ts:54.
// `workers: 1`/`fullyParallel: false` happened to keep ordering correct under
// plain `describe`, but case 3 could not be run alone and a case-2 failure
// would have surfaced as a confusing case-3 failure instead of a skip.
test.describe.serial("Presbytery credentials (2026-09-28-presbytery-e2e)", () => {
  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("presbytery-credentials.spec");
    flags = await captureFlags(sql, [CREDENTIALS_FLAG]);
    await setFlag(sql, CREDENTIALS_FLAG, true);
    await clearFixtureCredentials(sql);
  });

  test.afterAll(async () => {
    await flags.restore();
    await clearFixtureCredentials(sql);
  });

  test("1. presbytery clerk records an ordination; the list and audit row reflect it", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/credentials`);
    await expect(page.locator("#ordination-person")).toBeEnabled();
    await page.locator("#ordination-person").selectOption({ label: "Cassius Brightwell" });
    await page.locator("#ordination-ministry").selectOption("ruling_elder");
    await page.locator("#ordination-ordained-on").fill("2020-06-01");
    await page.locator("#ordination-minute-reference").fill("Presbytery minutes, e2e fixture");
    await page.getByRole("button", { name: /^record ordination$/i }).click();

    await expect(page.getByText(/ordination recorded/i)).toBeVisible({ timeout: 10_000 });
    // Scoped to a table CELL, not the bare name -- the person-picker
    // `<select>`s on this same page also carry "Cassius Brightwell" as
    // `<option>` text, which would make a page-wide getByText ambiguous.
    await expect(page.getByRole("cell", { name: "Cassius Brightwell" }).first()).toBeVisible();

    const rows = (await sql`
      select actor_user_id, metadata
        from audit_events
       where action = 'tenant.ordination.recorded'
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
       order by created_at desc
       limit 1
    `) as { actor_user_id: string; metadata: { ministry: string } }[];
    expect(rows.length).toBe(1);
    expect(rows[0].metadata.ministry).toBe("ruling_elder");

    const clerkUser = (await sql`
      select id from users where email = 'presbytery-clerk@presby.invalid'
    `) as { id: string }[];
    expect(rows[0].actor_user_id).toBe(clerkUser[0].id);

    await context.close();
  });

  test("2. presbytery clerk records a pastoral appointment", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/credentials`);
    await expect(page.locator("#appointment-person")).toBeEnabled();
    await page.locator("#appointment-person").selectOption({ label: "Cassius Brightwell" });
    await page.locator("#appointment-serving-org").selectOption(E2E_ORGS.alpha.id);
    await page.locator("#appointment-call-type").selectOption("installed_pastor");
    await page.locator("#appointment-starts-on").fill("2020-07-01");
    await page.locator("#appointment-minute-reference").fill("Presbytery minutes, e2e fixture");
    await page.getByRole("button", { name: /^record appointment$/i }).click();

    await expect(page.getByText(/appointment recorded/i)).toBeVisible({ timeout: 10_000 });

    // Scoped to the "Pastoral appointments" section specifically -- the
    // Ordinations table (case 1) also has a row naming Cassius Brightwell, so
    // a page-wide `tr` locator would be ambiguous.
    const appointmentsSection = page.locator("div", {
      has: page.getByRole("heading", { name: "Pastoral appointments" }),
    });
    const appointmentRow = appointmentsSection.locator("tr", { hasText: "Cassius Brightwell" });
    await expect(appointmentRow.getByText(E2E_ORGS.alpha.name)).toBeVisible();

    const rows = (await sql`
      select id from audit_events
       where action = 'tenant.appointment.recorded'
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
         and metadata->>'servingOrgId' = ${E2E_ORGS.alpha.id}
       order by created_at desc
       limit 1
    `) as { id: string }[];
    expect(rows.length).toBe(1);

    await context.close();
  });

  test("3. presbytery clerk ends the appointment from case 2", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/credentials`);
    await page.waitForLoadState("networkidle");
    const appointmentsSection = page.locator("div", {
      has: page.getByRole("heading", { name: "Pastoral appointments" }),
    });
    const appointmentRow = appointmentsSection.locator("tr", { hasText: "Cassius Brightwell" });
    await appointmentRow.getByRole("button", { name: /^end appointment$/i }).click();

    // The AlertDialog's confirm button stays disabled until a non-empty
    // Reason is entered (end-appointment-dialog.tsx).
    await page.getByLabel("Reason").fill("Accepted a call elsewhere (e2e fixture)");
    await page.getByRole("button", { name: /^yes, end appointment$/i }).click();

    await expect(page.getByText(/appointment ended for cassius brightwell/i)).toBeVisible({
      timeout: 10_000,
    });

    // No more "End appointment" button on that row; the Ends cell now shows
    // a date instead of an em dash.
    await expect(appointmentRow.getByRole("button", { name: /^end appointment$/i })).toHaveCount(0);

    const rows = (await sql`
      select id from audit_events
       where action = 'tenant.appointment.ended'
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
       order by created_at desc
       limit 1
    `) as { id: string }[];
    expect(rows.length).toBe(1);

    await context.close();
  });

  // -------------------------------------------------------------------
  // Case 4: FAILING-FIRST DEMONSTRATION (Implementation Order step 7).
  // Written first against presbytery-clerk (who HOLDS the grant) to confirm
  // it fails, then re-pointed at presbytery-nogrant and confirmed to pass.
  // -------------------------------------------------------------------
  test("4. a related person with no grant is refused, naming the permission", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-nogrant"),
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/credentials`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/don't have permission to manage ministry credentials/i),
    ).toBeVisible();
    await expect(
      page.getByText(/isn't turned on for|isn't available for/i),
    ).toHaveCount(0);

    await context.close();
  });

  test("5. the wrong org type gets a product-not-here message naming no remedy", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("org-single") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/credentials`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/isn't available for .* this is a presbytery-level tool/i),
    ).toBeVisible();
    await expect(
      page.getByText(/don't have permission to manage ministry credentials/i),
    ).toHaveCount(0);

    await context.close();
  });

  test("6. flag off renders a plain 'not turned on yet' message", async ({ browser }) => {
    await setFlag(sql, CREDENTIALS_FLAG, false);
    try {
      const context = await browser.newContext({
        storageState: storageStatePath("presbytery-clerk"),
      });
      const page = await context.newPage();

      await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/credentials`);
    await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(/ministry credentials & pastoral appointments isn't turned on for/i),
      ).toBeVisible();
      await expect(
        page.getByText(/don't have permission to manage ministry credentials/i),
      ).toHaveCount(0);

      await context.close();
    } finally {
      await setFlag(sql, CREDENTIALS_FLAG, true);
    }
  });

  test("7. [360px] recording an ordination is operable at mobile width", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/credentials`);
    await expect(page.locator("#ordination-person")).toBeEnabled();
    await page.locator("#ordination-person").selectOption({ label: "Cassius Brightwell" });
    await page.locator("#ordination-ordained-on").fill("2021-01-15");
    await page.getByRole("button", { name: /^record ordination$/i }).click();
    await expect(page.getByText(/ordination recorded/i)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
