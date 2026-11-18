/**
 * oversight-finance.spec.ts - the tier-2 half of the congregation records (Congregation profile Increment 1,
 * Batch B4; docs/work-log/2026-11-17-congregation-profile-inc1.md, parent Phase 3 "E2E").
 *
 * WHO: a presbytery staff member who holds `congregation_oversight.finance` and NOTHING else (a flagged key,
 * so the account is MFA enrolled and answers `/totp` at sign-in), and a second holder of both keys for the
 * two steps that need a building (appraisals live on a building's page, and a building is tier 1: B3's
 * accepted deviation 1, orchestrator ruling 2026-11-18). A throwaway presbytery from
 * `support/oversight-fixture.ts`; flag `org_portal.oversight` set here and restored in afterAll.
 *
 * COVERS, on a 360px phone: the finance-only viewer's record page (Profile, Assessment and Buildings are
 * Locked cards; Insurance and Loans are open), a building's page and the appraisal form opened by URL (a
 * Locked page, because the building is tier 1); the list (an Insurance column and NO viability, city or
 * buildings column; "Expired" in words; the newest policy year's expiry); insurance (record, a duplicate
 * year, a stale edit from a second session, remove and record again); loans (record, a changed balance that
 * needs a new date, a stale edit from a second session, mark paid off, reopen, remove, amounts shown); an
 * appraisal by the holder of both keys (record, a duplicate year, remove); audit rows that never carry a
 * carrier, a lender or an amount; and a 360px walk of every finance page with 44px controls.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  newPhonePage,
  noSidewaysScroll,
  OVERSIGHT_FLAG,
  oversightAudit,
  removeOversightFixture,
  sectionStates,
  seedBuilding,
  seedInsurance,
  setupOversightFixture,
  signedInContext,
  smallControls,
  waitHydrated,
  type OversightFixture,
} from "./support/oversight-fixture";

let sql: Sql;
let fx: OversightFixture;
let flags: FlagCapture;
let finance: BrowserContext;
let both: BrowserContext;
let buildingId: string;
const base = () => `/o/${fx.presbytery.slug}/admin/oversight`;
const record = () => `${base()}/${fx.congA.id}`;

const SENTINEL_CARRIER = "SENTINEL-CARRIER Mutual 5521";
const SENTINEL_POLICY = "SENTINEL-POLICY-88123";
const SENTINEL_LENDER = "SENTINEL-LENDER Savings 3307";
const SENTINEL_GUARANTEE = "SENTINEL-GUARANTEE signed by the session";
const THIS_YEAR = new Date().getFullYear();

const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const card = (page: Page, sectionName: string, heading: string | RegExp) =>
  section(page, sectionName).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: heading }) });

async function insuranceRows(): Promise<Array<{ policy_year: number; carrier: string | null; row_version: number; removed: boolean }>> {
  return (await sql`
    select policy_year, carrier, row_version, removed_at is not null as removed from oversight_insurance_years
     where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid order by policy_year, created_at`) as never;
}

async function loanRows(): Promise<Array<{ id: string; lender: string | null; status: string; balance: string | null; as_of: string | null; row_version: number; removed: boolean }>> {
  return (await sql`
    select id, lender, status, current_balance_cents::text as balance, balance_as_of::text as as_of, row_version, removed_at is not null as removed
      from oversight_loans where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid order by created_at`) as never;
}

test.describe.serial("Oversight finance: the finance-only holder", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    sql = platformSql("oversight-finance.spec");
    flags = await captureFlags(sql, [OVERSIGHT_FLAG]);
    await setFlag(sql, OVERSIGHT_FLAG, true);
    fx = await setupOversightFixture(sql, { tag: "f", who: ["clerk", "finance", "both"] });
    buildingId = await seedBuilding(sql, fx, "congA", { name: "Main Sanctuary", primary: true, yearBuilt: 1931 });
    finance = await signedInContext(browser, "finance", record());
    both = await signedInContext(browser, "both", record());
  });

  test.afterAll(async () => {
    await finance?.close();
    await both?.close();
    if (sql && fx) await removeOversightFixture(sql, fx);
    await flags?.restore();
  });

  test("the record page: Insurance and Loans open, Profile, Assessment and Buildings Locked; a building and an appraisal form by URL are a Locked page", async () => {
    const page = await newPhonePage(finance);
    await page.goto(record());
    await expect(page.getByRole("heading", { level: 1, name: fx.congA.name })).toBeVisible();
    expect(await sectionStates(page)).toEqual({ Profile: "locked", Assessment: "locked", Buildings: "locked", Insurance: "open", Loans: "open" });
    // The Locked cards name the permission and who can give it; the open sections have their empty states.
    await expect(section(page, "Buildings")).toContainText(
      "You need permission to manage congregation oversight. An administrator can give it under Roles.",
    );
    await expect(page.getByText("No insurance is recorded for this congregation.")).toBeVisible();
    await expect(page.getByText("No loans are recorded for this congregation.")).toBeVisible();
    await expect(section(page, "Buildings").getByRole("link")).toHaveCount(0);

    // A building is tier 1: its page, and the appraisal form that hangs off it, are a Locked page (never a 404, never a form).
    await page.goto(`${record()}/buildings/${buildingId}`);
    await expect(page.getByText("Locked", { exact: true })).toBeVisible();
    await expect(page.getByText("Main Sanctuary")).toHaveCount(0);
    await page.goto(`${record()}/buildings/${buildingId}/appraisals/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Record an appraisal" })).toBeVisible();
    await expect(page.getByText("You need permission to manage congregation oversight.")).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
    // The manage-only forms are Locked pages as well.
    await page.goto(`${record()}/profile/edit`);
    await expect(page.getByRole("heading", { level: 1, name: "Edit profile" })).toBeVisible();
    await expect(page.getByText("Locked", { exact: true })).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
    await page.close();
  });

  test("insurance: record a past year, then a newer one; a duplicate year is refused; \"Expired\" is said in words", async () => {
    const page = await newPhonePage(finance);
    await page.goto(record());
    await page.getByRole("link", { name: "Record a year" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Record insurance for a year" })).toBeVisible();
    await waitHydrated(page);
    await page.getByRole("button", { name: "Save insurance" }).click();
    await expect(page.locator("#insurance-year-error")).toHaveText("Enter the policy year.");

    await page.locator("#insurance-year").fill("2022");
    await page.locator("#insurance-carrier").fill(SENTINEL_CARRIER);
    await page.locator("#insurance-policy-number").fill(SENTINEL_POLICY);
    await page.locator("#insurance-expires").fill("2022-06-30");
    await page.locator("#insurance-claims").selectOption("no");
    await page.locator("#insurance-pool").selectOption("yes");
    await page.getByRole("button", { name: "Save insurance" }).click();
    await expect(page.getByText("Insurance saved.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());
    const y2022 = card(page, "Insurance", "2022");
    await expect(y2022).toContainText(SENTINEL_CARRIER);
    await expect(y2022.getByText("Expired", { exact: true })).toBeVisible();
    await expect(y2022).toContainText("Recent claims");
    await expect(y2022).toContainText("Interested in the insurance pool");

    // The same year again: refused under the year with the "edit it instead" line, the typed values kept.
    await page.goto(`${record()}/insurance/new`);
    await waitHydrated(page);
    await page.locator("#insurance-year").fill("2022");
    await page.locator("#insurance-carrier").fill("A different carrier");
    await page.getByRole("button", { name: "Save insurance" }).click();
    await expect(page.locator("#insurance-year-error")).toHaveText("Insurance for that year is already recorded. Edit it instead.");
    await expect(page.locator("#insurance-carrier")).toHaveValue("A different carrier");

    // A newer year with a far-future expiry: the list reads the NEWEST policy year's expiry.
    await page.locator("#insurance-year").fill(String(THIS_YEAR));
    await page.locator("#insurance-expires").fill("2099-06-30");
    await page.getByRole("button", { name: "Save insurance" }).click();
    await expect(page.getByText("Insurance saved.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());
    await expect(card(page, "Insurance", String(THIS_YEAR)).getByText("Expired", { exact: true })).toHaveCount(0);
    await page.close();
    expect((await insuranceRows()).map((r) => r.policy_year)).toEqual([2022, THIS_YEAR]);
  });

  test("the list: an Insurance column and no viability, city or buildings column; Expired in words; the newest year's expiry", async () => {
    // Another congregation whose only policy is long expired, and one with none.
    await seedInsurance(sql, fx, "congB", { policyYear: 2021, carrier: "Birch Mutual", expiresOn: "2021-12-31" });
    const page = await newPhonePage(finance);
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 1, name: "Congregation Oversight" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Congregation", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Insurance expires" })).toBeVisible();
    for (const name of ["Viability", "City and county", "Buildings in use", "Assessment updated"]) {
      await expect(page.getByRole("columnheader", { name })).toHaveCount(0);
    }
    await expect(
      page.getByText("Viability, city and county, and buildings need permission to manage congregation oversight. An administrator can give it under Roles."),
    ).toBeVisible();
    // Congregation A's newest policy year (this year, expiring in 2099) is not expired; Birch's only year is.
    const alder = page.locator("tr", { hasText: fx.congA.name });
    await expect(alder.getByText(/Expired/)).toHaveCount(0);
    await expect(alder).toContainText(/2099|6\/30\/99/);
    const birch = page.locator("tr", { hasText: fx.congB.name });
    await expect(birch).toContainText("Expired");
    await expect(birch).toContainText(/2021|12\/31\/21/);
    await noSidewaysScroll(page);
    expect(await smallControls(page)).toEqual([]);
    await page.close();
  });

  test("insurance: a stale edit from a second session writes nothing and keeps the typed values; remove, then record the year again", async () => {
    const [target] = (await insuranceRows()).filter((r) => r.policy_year === 2022);
    expect(target!.row_version).toBe(1);
    const idRow = (await sql`select id from oversight_insurance_years where organization_id = ${fx.presbytery.id}::uuid and policy_year = 2022`) as { id: string }[];
    const editUrl = `${record()}/insurance/${idRow[0]!.id}/edit`;

    const mine = await newPhonePage(finance);
    const theirs = await newPhonePage(both);
    await mine.goto(editUrl);
    await waitHydrated(mine);
    await theirs.goto(editUrl);
    await waitHydrated(theirs);
    await expect(mine.locator("#insurance-year")).toHaveAttribute("readonly", "");

    await theirs.locator("#insurance-carrier").fill("Second Session Carrier");
    await theirs.getByRole("button", { name: "Save insurance" }).click();
    await expect(theirs.getByText("Insurance saved.")).toBeVisible();

    await mine.locator("#insurance-carrier").fill("My Late Carrier");
    await mine.getByRole("button", { name: "Save insurance" }).click();
    await expect(
      mine.getByText("This record was changed by someone else after you opened it. Reload the page to see their change, then make yours again."),
    ).toBeVisible();
    await expect(mine.locator("#insurance-carrier")).toHaveValue("My Late Carrier");
    const after = (await insuranceRows()).filter((r) => r.policy_year === 2022);
    expect(after[0]).toMatchObject({ carrier: "Second Session Carrier", row_version: 2 });
    await theirs.close();

    // Reload, and the second try succeeds.
    await mine.reload();
    await waitHydrated(mine);
    await expect(mine.locator("#insurance-carrier")).toHaveValue("Second Session Carrier");
    await mine.locator("#insurance-carrier").fill(SENTINEL_CARRIER);
    await mine.getByRole("button", { name: "Save insurance" }).click();
    await expect(mine.getByText("Insurance saved.")).toBeVisible();

    // Remove the year (an AlertDialog), then the year can be recorded again.
    await mine.goto(record());
    await card(mine, "Insurance", "2022").getByRole("button", { name: /^Remove/ }).click();
    await expect(mine.getByRole("alertdialog")).toContainText("Remove this year's insurance?");
    await mine.getByRole("alertdialog").getByRole("button", { name: "Remove insurance record" }).click();
    await expect(mine.getByText("Insurance removed.")).toBeVisible();
    await expect(card(mine, "Insurance", "2022")).toHaveCount(0);
    await mine.goto(`${record()}/insurance/new`);
    await waitHydrated(mine);
    await mine.locator("#insurance-year").fill("2022");
    await mine.locator("#insurance-expires").fill("2022-06-30");
    await mine.getByRole("button", { name: "Save insurance" }).click();
    await expect(mine.getByText("Insurance saved.")).toBeVisible();
    await mine.waitForURL((url) => url.pathname === record());
    await expect(card(mine, "Insurance", "2022")).toHaveCount(1);
    await mine.close();
    const rows = await insuranceRows();
    expect(rows.filter((r) => r.policy_year === 2022 && !r.removed).length).toBe(1);
    expect(rows.filter((r) => r.policy_year === 2022 && r.removed).length).toBe(1);
  });

  test("loans: record with amounts shown, a changed balance needs a new date, a stale edit, mark paid off, reopen, remove", async () => {
    const page = await newPhonePage(finance);
    await page.goto(record());
    await page.getByRole("link", { name: "Record a loan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Record a loan" })).toBeVisible();
    await waitHydrated(page);
    await page.getByRole("button", { name: "Save loan" }).click();
    await expect(page.locator("#loan-kind-error")).toHaveText("Choose the kind of loan.");

    await page.locator("#loan-kind").selectOption("presbytery_program");
    await page.locator("#loan-lender").fill(SENTINEL_LENDER);
    await page.locator("#loan-original").fill("250000");
    await page.locator("#loan-balance").fill("180000.50");
    await page.locator("#loan-balance-as-of").fill("2025-01-31");
    await page.locator("#loan-grants").fill("15000");
    await page.locator("#loan-guarantee").fill(SENTINEL_GUARANTEE);
    await page.getByRole("button", { name: "Save loan" }).click();
    await expect(page.getByText("Loan saved.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());
    const loan = card(page, "Loans", "Presbytery program loan");
    await expect(loan).toContainText("$250,000");
    await expect(loan).toContainText("$180,000.50");
    await expect(loan).toContainText("$15,000");
    await expect(loan).toContainText(SENTINEL_LENDER);
    await expect(loan.getByText("Open", { exact: true })).toBeVisible();
    const [row] = await loanRows();
    expect(row).toMatchObject({ status: "open", balance: "18000050" });
    const editUrl = `${record()}/loans/${row!.id}/edit`;

    // A changed balance with the same "as of" date is refused under that date; a new date saves it.
    await page.getByRole("link", { name: "Edit loan" }).click();
    await waitHydrated(page);
    await page.locator("#loan-balance").fill("175000");
    await page.getByRole("button", { name: "Save loan" }).click();
    await expect(page.locator("#loan-balance-as-of-error")).toHaveText('Update the "as of" date for the new balance.');
    await expect(page.locator("#loan-balance")).toHaveValue("175000");
    await page.locator("#loan-balance-as-of").fill("2025-06-30");
    await page.getByRole("button", { name: "Save loan" }).click();
    // The earlier "Loan saved." toast may still be up: the database is the witness that THIS save landed.
    await expect.poll(async () => (await loanRows())[0]?.row_version, { timeout: 15_000 }).toBe(2);
    await expect(page.getByText("Loan saved.")).toBeVisible();
    await page.close();
    expect((await loanRows())[0]).toMatchObject({ balance: "17500000", as_of: "2025-06-30", row_version: 2 });

    // Two sessions open the same loan; the second save is stale and writes nothing.
    const mine = await newPhonePage(finance);
    const theirs = await newPhonePage(both);
    await mine.goto(editUrl);
    await waitHydrated(mine);
    await theirs.goto(editUrl);
    await waitHydrated(theirs);
    await theirs.locator("#loan-lender").fill("Second Session Lender");
    await theirs.getByRole("button", { name: "Save loan" }).click();
    await expect(theirs.getByText("Loan saved.")).toBeVisible();
    await mine.locator("#loan-lender").fill("My Late Lender");
    await mine.getByRole("button", { name: "Save loan" }).click();
    await expect(
      mine.getByText("This record was changed by someone else after you opened it. Reload the page to see their change, then make yours again."),
    ).toBeVisible();
    await expect(mine.locator("#loan-lender")).toHaveValue("My Late Lender");
    expect((await loanRows())[0]).toMatchObject({ lender: "Second Session Lender", row_version: 3 });
    await theirs.close();

    // Mark paid off (a dialog): the balance becomes $0 and the card says so; then reopen it; then remove it.
    await mine.goto(record());
    await mine.getByRole("button", { name: "Mark paid off" }).click();
    const dialog = mine.getByRole("dialog");
    await expect(dialog).toContainText("Mark this loan paid off?");
    await dialog.locator("#paid-off-date").fill("2026-01-15");
    await dialog.getByRole("button", { name: "Mark paid off" }).click();
    await expect(mine.getByText("Loan marked paid off.")).toBeVisible();
    await expect(card(mine, "Loans", "Presbytery program loan")).toContainText("Paid off");
    await expect(card(mine, "Loans", "Presbytery program loan")).toContainText("$0");
    expect((await loanRows())[0]).toMatchObject({ status: "paid_off", balance: "0", as_of: "2026-01-15" });

    await mine.getByRole("button", { name: "Reopen this loan" }).click();
    await expect(mine.getByText("Loan reopened.")).toBeVisible();
    await expect(card(mine, "Loans", "Presbytery program loan").getByText("Open", { exact: true })).toBeVisible();
    expect((await loanRows())[0]).toMatchObject({ status: "open" });

    await card(mine, "Loans", "Presbytery program loan").getByRole("button", { name: /^Remove/ }).click();
    await expect(mine.getByRole("alertdialog")).toContainText("Remove this loan?");
    await mine.getByRole("alertdialog").getByRole("button", { name: "Remove loan" }).click();
    await expect(mine.getByText("Loan removed.")).toBeVisible();
    await expect(mine.getByText("No loans are recorded for this congregation.")).toBeVisible();
    expect((await loanRows())[0]).toMatchObject({ removed: true });
    await mine.close();
  });

  test("appraisals, by the holder of both keys: record, a duplicate year, remove, record the corrected amount", async () => {
    const page = await newPhonePage(both);
    await page.goto(`${record()}/buildings/${buildingId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Main Sanctuary" })).toBeVisible();
    await expect(section(page, "Appraisals").getByText("No appraisal is recorded for this building.")).toBeVisible();
    await page.getByRole("link", { name: "Record an appraisal" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Record an appraisal" })).toBeVisible();
    await waitHydrated(page);
    await page.getByRole("button", { name: "Save appraisal" }).click();
    await expect(page.locator("#appraisal-year-error")).toHaveText("Enter the year assessed.");
    await expect(page.locator("#appraisal-amount-error")).toHaveText("Enter the appraised amount in dollars.");

    await page.locator("#appraisal-year").fill("2023");
    await page.locator("#appraisal-amount").fill("1850000");
    await page.getByRole("button", { name: "Save appraisal" }).click();
    await expect(page.getByText("Appraisal recorded.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === `${record()}/buildings/${buildingId}`);
    const y2023 = card(page, "Appraisals", "2023");
    await expect(y2023).toContainText("$1,850,000");
    await expect(y2023.getByText("Current", { exact: true })).toBeVisible();

    // The same year again names the year and says to remove it first.
    await page.getByRole("link", { name: "Record an appraisal" }).click();
    await waitHydrated(page);
    await page.locator("#appraisal-year").fill("2023");
    await page.locator("#appraisal-amount").fill("1900000");
    await page.getByRole("button", { name: "Save appraisal" }).click();
    await expect(page.locator("#appraisal-year-error")).toHaveText(
      "An appraisal for 2023 is already recorded for this building. Remove it first to record a corrected amount.",
    );

    // An older year does not take the "Current" tag; the newest does.
    await page.locator("#appraisal-year").fill("2019");
    await page.locator("#appraisal-amount").fill("1500000");
    await page.getByRole("button", { name: "Save appraisal" }).click();
    await expect(page.getByText("Appraisal recorded.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === `${record()}/buildings/${buildingId}`);
    await expect(card(page, "Appraisals", "2019").getByText("Current", { exact: true })).toHaveCount(0);
    await expect(card(page, "Appraisals", "2023").getByText("Current", { exact: true })).toBeVisible();

    // Remove 2023 (an AlertDialog), then 2019 is the current one.
    await card(page, "Appraisals", "2023").getByRole("button", { name: /^Remove/ }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Remove this appraisal?");
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove appraisal" }).click();
    await expect(page.getByText("Appraisal removed.")).toBeVisible();
    await expect(card(page, "Appraisals", "2023")).toHaveCount(0);
    await expect(card(page, "Appraisals", "2019").getByText("Current", { exact: true })).toBeVisible();
    await page.close();
  });

  test("audit rows name ids and fields and never a carrier, lender, policy number, guarantee or amount", async () => {
    const audit = await oversightAudit(sql, fx.presbytery.id);
    const actions = new Set(audit.map((a) => a.action));
    for (const expected of [
      "tenant.oversight_insurance.recorded",
      "tenant.oversight_insurance.updated",
      "tenant.oversight_insurance.removed",
      "tenant.oversight_loan.recorded",
      "tenant.oversight_loan.updated",
      "tenant.oversight_loan.paid_off",
      "tenant.oversight_loan.removed",
      "tenant.oversight_appraisal.recorded",
      "tenant.oversight_appraisal.removed",
    ]) {
      expect(actions, expected).toContain(expected);
    }
    // Ids are random hex and could contain a short digit run by chance: strip them before looking for a value.
    const text = JSON.stringify(audit).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
    for (const secret of [
      "SENTINEL", SENTINEL_CARRIER, SENTINEL_POLICY, SENTINEL_LENDER, SENTINEL_GUARANTEE, "Second Session", "My Late",
      "1850000", "1900000", "1500000", "250000", "180000", "17500000", "18000050",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    for (const row of audit) {
      expect(row.metadata.organizationId).toBe(fx.presbytery.id);
      expect(row.metadata.aboutOrgId).toBe(fx.congA.id);
    }
    // The two writers who are not the same person: both are attributed.
    const actors = (await sql`
      select count(distinct actor_user_id)::int as n from audit_events
       where action like 'tenant.oversight_%' and metadata->>'organizationId' = ${fx.presbytery.id}`) as { n: number }[];
    expect(actors[0]!.n).toBe(2);
  });

  test("360px: every finance page has no sideways scroll and no control under 44px", async () => {
    // A loan and a year to open, with long text in every free field.
    const long = "L".repeat(200);
    const [seededInsurance] = (await sql`
      insert into oversight_insurance_years (organization_id, about_org_id, policy_year, carrier, policy_number, notes, created_by, updated_by)
      values (${fx.presbytery.id}::uuid, ${fx.congA.id}::uuid, 2018, ${long}, ${"P".repeat(100)}, ${"N".repeat(400)}, ${fx.users.both}::uuid, ${fx.users.both}::uuid)
      returning id`) as { id: string }[];
    const [seededLoan] = (await sql`
      insert into oversight_loans (organization_id, about_org_id, kind, lender, guarantee_note, notes, created_by, updated_by)
      values (${fx.presbytery.id}::uuid, ${fx.congA.id}::uuid, 'other', ${long}, ${"G".repeat(300)}, ${"N".repeat(300)}, ${fx.users.both}::uuid, ${fx.users.both}::uuid)
      returning id`) as { id: string }[];
    const page = await newPhonePage(finance, 360, 740);
    const pages: Array<[string, string]> = [
      ["the record page", record()],
      ["the list", base()],
      ["record insurance", `${record()}/insurance/new`],
      ["edit insurance", `${record()}/insurance/${seededInsurance!.id}/edit`],
      ["record a loan", `${record()}/loans/new`],
      ["edit a loan", `${record()}/loans/${seededLoan!.id}/edit`],
    ];
    for (const [label, path] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await waitHydrated(page).catch(() => undefined);
      await noSidewaysScroll(page);
      expect(await smallControls(page), `${label}: a control under 44px`).toEqual([]);
    }
    await page.close();

    // The appraisal form, as the holder of both keys.
    const both360 = await newPhonePage(both, 360, 740);
    for (const [label, path] of [
      ["a building with appraisals", `${record()}/buildings/${buildingId}`],
      ["record an appraisal", `${record()}/buildings/${buildingId}/appraisals/new`],
    ] as const) {
      await both360.goto(path);
      await expect(both360.getByRole("heading", { level: 1 })).toBeVisible();
      await waitHydrated(both360).catch(() => undefined);
      await noSidewaysScroll(both360);
      expect(await smallControls(both360), `${label}: a control under 44px`).toEqual([]);
    }
    await both360.close();
  });
});
