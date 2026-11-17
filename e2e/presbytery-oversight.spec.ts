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
    await expect(page.locator("#oversight-viability")).toBeEnabled();
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
    await expect(page.locator("#oversight-viability")).toBeEnabled();
    await page.locator("#oversight-viability").selectOption("3");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/oversight record saved/i)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  // -------------------------------------------------------------------
  // Map location (DECISION-343, docs/work-log/2026-11-17-presbytery-dashboard-map.md). No tile key is needed:
  // these are the form and the write, not the map. Each case that saves puts the alpha row's coordinates back.
  // -------------------------------------------------------------------

  const ALPHA_ROW = (id: string) => ({ org: E2E_ORGS.presbytery.id, about: id });

  async function readCoordinates(aboutId: string) {
    const { org, about } = ALPHA_ROW(aboutId);
    const rows = (await sql`
      select latitude::text as latitude, longitude::text as longitude
        from congregation_oversight where organization_id = ${org}::uuid and about_org_id = ${about}::uuid
    `) as { latitude: string | null; longitude: string | null }[];
    return rows[0] ?? null;
  }

  async function restoreCoordinates(aboutId: string, prior: { latitude: string | null; longitude: string | null } | null) {
    const { org, about } = ALPHA_ROW(aboutId);
    await sql`
      update congregation_oversight
         set latitude = ${prior?.latitude ?? null}::numeric, longitude = ${prior?.longitude ?? null}::numeric
       where organization_id = ${org}::uuid and about_org_id = ${about}::uuid
    `;
  }

  test("7. the Map location group names itself, hints each box, and refuses a half-set pair or 0 and 0 inline", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight/${E2E_ORGS.alpha.id}`);
    const lat = page.locator("#oversight-latitude");
    const lng = page.locator("#oversight-longitude");
    await expect(lat).toBeEnabled();

    await expect(page.getByText("Map location")).toBeVisible();
    await expect(page.getByText(/future viability map/i)).toHaveCount(0);
    await expect(page.getByText(/Decimal degrees between -90 and 90, for example 39\.9612\. Enter this first\./)).toBeVisible();
    await expect(page.getByText(/Congregations in the United States have a negative\s+longitude/)).toBeVisible();

    // Latitude alone is refused with the half-set sentence, on the blank field, and nothing is saved.
    await lat.fill("39.9612");
    await lng.fill("");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Enter both latitude and longitude, or leave both blank.")).toBeVisible();
    await expect(page.getByText(/oversight record saved/i)).toHaveCount(0);

    // 0 and 0 is refused with its own sentence.
    await lat.fill("0");
    await lng.fill("0");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/^0 and 0 is a point in the ocean/)).toBeVisible();
    await expect(page.getByText(/oversight record saved/i)).toHaveCount(0);

    // A non-decimal value is refused too.
    await lat.fill("1e5");
    await lng.fill("-82");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Must be a number")).toBeVisible();
    await context.close();
  });

  test("8. pasting a pair into either box splits it into both, and says so", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight/${E2E_ORGS.alpha.id}`);
    const lat = page.locator("#oversight-latitude");
    const lng = page.locator("#oversight-longitude");
    await expect(lat).toBeEnabled();

    await lat.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "39.9612, -82.9988");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(lat).toHaveValue("39.9612");
    await expect(lng).toHaveValue("-82.9988");
    await expect(page.getByText("Filled latitude and longitude from the pasted pair. Check them before you save.")).toBeVisible();

    // An ordinary paste is left alone: a single number is not split.
    await lat.fill("");
    await lng.fill("");
    await lat.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "41.5");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(lng).toHaveValue("");
    await context.close();
  });

  test("9. a valid pair is stored, the toast keeps its title, and no coordinate reaches the audit row", async ({ browser }) => {
    const prior = await readCoordinates(E2E_ORGS.alpha.id);
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    try {
      await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/oversight/${E2E_ORGS.alpha.id}`);
      await expect(page.locator("#oversight-latitude")).toBeEnabled();
      await page.locator("#oversight-latitude").fill("39.9612");
      await page.locator("#oversight-longitude").fill("-82.9988");
      await page.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByText(/oversight record saved/i)).toBeVisible({ timeout: 10_000 });

      const stored = await readCoordinates(E2E_ORGS.alpha.id);
      expect(Number(stored?.latitude)).toBe(39.9612);
      expect(Number(stored?.longitude)).toBe(-82.9988);

      const audit = (await sql`
        select metadata from audit_events
         where action = 'tenant.congregation_oversight.set'
           and metadata->>'aboutOrgId' = ${E2E_ORGS.alpha.id}
         order by created_at desc limit 1
      `) as { metadata: Record<string, unknown> }[];
      expect(Object.keys(audit[0].metadata)).not.toContain("latitude");
      expect(Object.keys(audit[0].metadata)).not.toContain("longitude");
      expect(JSON.stringify(audit[0].metadata)).not.toContain("39.9612");
    } finally {
      await restoreCoordinates(E2E_ORGS.alpha.id, prior);
      await context.close();
    }
  });
});
