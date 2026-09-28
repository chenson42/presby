/**
 * presbytery-oversight.spec.ts — `/o/<slug>/admin/oversight`, the presbytery's
 * own record of each member congregation's viability, buildings, and
 * insurance (2026-09-28-presbytery-e2e, tech-lead Phase 3 Notes §5).
 *
 * FOUR-NEGATIVE-STATE DISCIPLINE (architect Phase 2 Notes §4): each denied
 * case asserts its own distinguishing paragraph VISIBLE and at least one
 * sibling state's paragraph ABSENT — an `<h1>`-only assertion cannot tell
 * "flag off" from "wrong org type" apart, since `PlaceholderFlagOff` and
 * `PlaceholderNotAvailable` render the identical `<h1>{AREA}</h1>`. The
 * fourth state (a genuine load error) is out of scope for e2e — it is not
 * reachable without breaking the database mid-run; `oversight/page.test.tsx`
 * covers it.
 *
 * No `describe.serial` — every case is independent (the edit-form case does
 * not depend on the list-read case's own state), and `workers: 1` /
 * `fullyParallel: false` (playwright.config.ts) already makes ordering
 * deterministic.
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";

const OVERSIGHT_FLAG = "org_portal.oversight";

test.describe("Presbytery oversight (2026-09-28-presbytery-e2e)", () => {
  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("presbytery-oversight.spec");
    flags = await captureFlags(sql, [OVERSIGHT_FLAG]);
    await setFlag(sql, OVERSIGHT_FLAG, true);
  });

  test.afterAll(async () => {
    await flags.restore();
  });

  test("1. presbytery clerk sees the member-congregation list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Congregation Oversight" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Congregation" })).toBeVisible();
    await expect(page.getByRole("cell", { name: E2E_ORGS.alpha.name })).toBeVisible();
    await expect(page.getByRole("cell", { name: E2E_ORGS.beta.name })).toBeVisible();
    await expect(page.getByRole("cell", { name: E2E_ORGS.gamma.name })).toBeVisible();

    // Sibling state absent: the "no permission" copy never appears alongside
    // a real, rendered table.
    await expect(
      page.getByText(/don't have permission to manage congregation oversight/i),
    ).toHaveCount(0);

    await context.close();
  });

  test("2. presbytery clerk records an assessment; the list reflects it and an audit row is written", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight/${E2E_ORGS.alpha.id}`);
    await page.waitForLoadState("networkidle");
    await page.locator("#oversight-viability").selectOption("2");
    await page.locator("#oversight-buildings").fill("Roof replaced 2026; no outstanding repairs.");
    await page.locator("#oversight-insurance-carrier").fill("E2E Fixture Mutual");
    await page.locator("#oversight-insurance-expires").fill("2027-06-30");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText(/oversight record saved/i)).toBeVisible({ timeout: 10_000 });

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight`);
    await page.waitForLoadState("networkidle");
    const alphaRow = page.locator("tr", { hasText: E2E_ORGS.alpha.name });
    await expect(alphaRow.getByText("Fair")).toBeVisible();
    await expect(alphaRow.getByText("Not yet assessed")).toHaveCount(0);

    const rows = (await sql`
      select actor_user_id, metadata
        from audit_events
       where action = 'tenant.congregation_oversight.set'
         and metadata->>'aboutOrgId' = ${E2E_ORGS.alpha.id}
         and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
       order by created_at desc
       limit 1
    `) as { actor_user_id: string; metadata: { viabilityScore: number | null } }[];
    expect(rows.length).toBe(1);
    expect(rows[0].metadata.viabilityScore).toBe(2);

    const clerkUser = (await sql`
      select id from users where email = 'presbytery-clerk@presby.invalid'
    `) as { id: string }[];
    expect(rows[0].actor_user_id).toBe(clerkUser[0].id);

    await context.close();
  });

  // -------------------------------------------------------------------
  // Case 3: FAILING-FIRST DEMONSTRATION (Implementation Order step 6).
  // Written first against presbytery-clerk (who HOLDS the grant) to confirm
  // it fails -- i.e. it would catch a regression that accidentally granted
  // everyone access -- then re-pointed at presbytery-nogrant and confirmed to
  // pass. Both halves recorded below; only the passing half ships.
  // -------------------------------------------------------------------
  test("3. a related person with no grant is refused, naming the permission", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-nogrant"),
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/don't have permission to manage congregation oversight records/i),
    ).toBeVisible();

    // Sibling state absent: no table rendered.
    await expect(page.getByRole("table")).toHaveCount(0);

    await context.close();
  });

  test("4. the wrong org type gets a product-not-here message, never a permission denial", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("org-single") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.alpha.slug}/admin/oversight`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/isn't the kind of organization this tool is built for/i),
    ).toBeVisible();
    await expect(
      page.getByText(/don't have permission to manage congregation oversight/i),
    ).toHaveCount(0);

    await context.close();
  });

  test("5. flag off renders a plain 'not turned on yet' message", async ({ browser }) => {
    await setFlag(sql, OVERSIGHT_FLAG, false);
    try {
      const context = await browser.newContext({
        storageState: storageStatePath("presbytery-clerk"),
      });
      const page = await context.newPage();

      await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight`);
    await page.waitForLoadState("networkidle");
      await expect(page.getByText(/isn't turned on for .* yet/i)).toBeVisible();
      await expect(
        page.getByText(/don't have permission to manage congregation oversight/i),
      ).toHaveCount(0);

      await context.close();
    } finally {
      await setFlag(sql, OVERSIGHT_FLAG, true);
    }
  });

  test("6. [360px] the edit form's primary control is operable at mobile width", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight/${E2E_ORGS.alpha.id}`);
    await page.waitForLoadState("networkidle");
    await page.locator("#oversight-viability").selectOption("3");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/oversight record saved/i)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
