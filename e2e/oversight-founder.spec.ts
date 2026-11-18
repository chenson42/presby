/**
 * oversight-founder.spec.ts - THE R2 WALK (the F362 lesson; Congregation profile Increment 1, Batch B4;
 * docs/work-log/2026-11-17-congregation-profile.md DECISION-345, Phase 3 "E2E" and the Phase 6 handoff).
 *
 * The finance key is not bound to any role except the presbytery founding-administrator bundle. A bundle the
 * definer mints must work with NO further grant, and the founding administrator is the only person who can
 * give the key to anyone else (`assertPermissionSubset`: a person can grant only what they hold). So the walk
 * is end to end, through the real definer and the real screens, as the people each step creates:
 *
 *   1. a presbytery founding administrator minted by `presby_apply_founding_administrator` (the same call the
 *      platform operator's designation makes), with no other grant, sees all five sections of a record open,
 *      and the bundle's key list read from the database carries both oversight keys;
 *   2. she creates a custom role carrying only the finance key (the subset check passes) and grants it to a
 *      second person, on the Roles screens at 360px;
 *   3. that second person, who held no role and never enrolled, signs in and is sent to enrol two-factor (a
 *      flagged key), enrols with a real code, and lands on the record: Insurance and Loans open, Profile,
 *      Assessment and Buildings Locked;
 *   4. a person who holds only the manage key sees Insurance and Loans Locked and the rest open.
 *
 * Flags: `org_portal.oversight` and `org_portal.roles` (the Roles screens), set here and restored in afterAll.
 * Before the grant the second person is refused, naming the permission. Screenshots go to the directory in
 * `OVERSIGHT_SHOTS_DIR` when it is set (the walk's evidence), else to the test's own output folder.
 * Throwaway presbytery, invented names, `.invalid` addresses.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import path from "node:path";
import { platformSql, type Sql } from "./support/db";
import { typeEnrolmentCode } from "./support/enrolment-fixture";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  FINANCE_KEY,
  MANAGE_KEY,
  newPhonePage,
  noSidewaysScroll,
  OVERSIGHT_FLAG,
  OVERSIGHT_NAMES,
  removeOversightFixture,
  sectionStates,
  setupOversightFixture,
  signedInContext,
  smallControls,
  waitHydrated,
  type OversightFixture,
} from "./support/oversight-fixture";

const ROLES_FLAG = "org_portal.roles";

let sql: Sql;
let fx: OversightFixture;
let flags: FlagCapture;
let founder: BrowserContext;
let shotDir: string;
const base = () => `/o/${fx.presbytery.slug}/admin/oversight`;
const record = () => `${base()}/${fx.congA.id}`;
const roles = () => `/o/${fx.presbytery.slug}/admin/roles`;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
}

async function keysOfRole(roleKey: string): Promise<string[]> {
  const found = (await sql`
    select p.permission_key from app_roles r join app_role_permissions p on p.role_id = r.id
     where r.organization_id = ${fx.presbytery.id}::uuid and r.key = ${roleKey} order by p.permission_key`) as { permission_key: string }[];
  return found.map((row) => row.permission_key);
}

test.describe.serial("Oversight: the founding administrator needs no further grant (R2, DECISION-345)", () => {
  test.setTimeout(300_000);

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(420_000);
    shotDir = process.env.OVERSIGHT_SHOTS_DIR || testInfo.outputPath("walk");
    sql = platformSql("oversight-founder.spec");
    // Role administration is its own global toggle (off in a fresh database): the walk needs both.
    flags = await captureFlags(sql, [OVERSIGHT_FLAG, ROLES_FLAG]);
    await setFlag(sql, OVERSIGHT_FLAG, true);
    await setFlag(sql, ROLES_FLAG, true);
    fx = await setupOversightFixture(sql, { tag: "w", who: ["clerk", "founder", "second"] });
    founder = await signedInContext(browser, "founder", record());
  });

  test.afterAll(async () => {
    await founder?.close();
    if (sql && fx) await removeOversightFixture(sql, fx);
    await flags?.restore();
  });

  test("1. the minted bundle carries both oversight keys, and the founder sees all five sections open with no further grant", async () => {
    // The key list as the database holds it: exactly what the definer's own function says a presbytery bundle is.
    const minted = await keysOfRole("founding_administrator");
    const [plan] = (await sql`select presby_founding_administrator_permission_keys('presbytery') as keys`) as { keys: string[] }[];
    expect(minted).toEqual([...plan!.keys].sort());
    expect(minted).toContain(MANAGE_KEY);
    expect(minted).toContain(FINANCE_KEY);
    expect(minted.length).toBe(13);
    // A congregation's bundle does not carry the finance key (the key is presbytery-only).
    const [congregation] = (await sql`select presby_founding_administrator_permission_keys('congregation') as keys`) as { keys: string[] }[];
    expect(congregation!.keys).not.toContain(FINANCE_KEY);

    // She holds nothing else: the only grants at this presbytery are the founding role and the presbytery office role.
    const grants = (await sql`
      select r.key from role_grants g join app_roles r on r.id = g.role_id
       where g.organization_id = ${fx.presbytery.id}::uuid and g.person_id = ${fx.people.founder}::uuid order by r.key`) as { key: string }[];
    expect(grants.map((g) => g.key)).toEqual(["founding_administrator", "presbytery_stated_clerk"].sort());

    const page = await newPhonePage(founder);
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 1, name: "Congregation Oversight" })).toBeVisible();
    for (const name of ["Viability", "City and county", "Buildings in use", "Insurance expires", "Assessment updated"]) {
      // At 360px some columns are hidden until `sm` (they are still in the table): count them, do not look for them.
      await expect(page.locator("th", { hasText: new RegExp(`^${name}$`) })).toHaveCount(1);
    }
    await expect(page.getByText(/need permission to manage congregation/)).toHaveCount(0);
    await shot(page, "01-founder-list-360");
    await page.goto(record());
    await expect(page.getByRole("heading", { level: 1, name: fx.congA.name })).toBeVisible();
    expect(await sectionStates(page)).toEqual({ Profile: "open", Assessment: "open", Buildings: "open", Insurance: "open", Loans: "open" });
    await expect(page.getByRole("link", { name: "Record a year" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Record a loan" })).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "02-founder-record-360");

    // She can do the finance work too: a form page opens (not a Locked page).
    await page.goto(`${record()}/insurance/new`);
    await waitHydrated(page);
    await expect(page.locator("#insurance-year")).toBeEnabled();
    await expect(page.getByText("Locked", { exact: true })).toHaveCount(0);
    await page.close();
  });

  test("2. before the grant, the second person is refused naming the permission; the founder creates a finance-only role and grants it", async ({ browser }) => {
    const before = await signedInContext(browser, "second", record());
    const refused = await newPhonePage(before);
    await refused.goto(record());
    await expect(refused.getByText(/don't have permission to manage congregation oversight records/i)).toBeVisible();
    // No congregation is named and no section is drawn (nothing about the record leaks before the key is held).
    await expect(refused.getByRole("region", { name: "Buildings", exact: true })).toHaveCount(0);
    await expect(refused.getByText(fx.congA.name)).toHaveCount(0);
    await shot(refused, "03-second-before-grant-360");
    await refused.close();
    await before.close();

    // The founder creates the role: the checklist is tier-grouped; the finance key is tier 2.
    const page = await newPhonePage(founder);
    await page.goto(`${roles()}/new`);
    await expect(page.getByRole("heading", { name: "Create a custom role" })).toBeVisible();
    await waitHydrated(page);
    await page.locator("#role-key").fill("finance_reader");
    await page.locator("#role-name").fill("Finance Reader");
    const financeBox = page.locator(`[id="perm-2-${FINANCE_KEY}"]`);
    await expect(financeBox).toBeVisible();
    // The checklist says what the key does, in the Roles screen's own words.
    await expect(financeBox.locator("xpath=ancestor::label")).toContainText("appraisals, insurance and loans");
    await financeBox.check();
    await noSidewaysScroll(page);
    await shot(page, "04-founder-create-role-360");
    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByText("Role created.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === roles());
    expect(await keysOfRole("finance_reader")).toEqual([FINANCE_KEY]);

    // Grant it to the second person.
    await waitHydrated(page);
    await page.locator("#grant-role").selectOption({ label: "Finance Reader" });
    await page.locator("#grant-person").selectOption({ label: OVERSIGHT_NAMES.second });
    await shot(page, "05-founder-grant-360");
    await page.getByRole("button", { name: "Grant role" }).click();
    await expect(page.getByText("Role granted.")).toBeVisible();
    await expect(page.getByText(OVERSIGHT_NAMES.second).first()).toBeVisible();
    await page.close();

    const grant = (await sql`
      select r.key from role_grants g join app_roles r on r.id = g.role_id
       where g.organization_id = ${fx.presbytery.id}::uuid and g.person_id = ${fx.people.second}::uuid and g.ends_on is null`) as { key: string }[];
    expect(grant.map((g) => g.key)).toEqual(["finance_reader"]);
  });

  test("3. the second person is sent to enrol two-factor, enrols with a real code, and sees Insurance and Loans open and the rest Locked", async ({ browser }) => {
    // Signed in after the grant: the account never enrolled, and the key is flagged, so sign-in asks for enrolment.
    const context = await signedInContext(browser, "second", record(), { answerTotp: false });
    const page = await newPhonePage(context);
    await page.goto(record());
    await page.waitForURL((url) => url.pathname === "/account/2fa" || url.pathname === "/totp", { timeout: 60_000 });
    if (new URL(page.url()).pathname === "/totp") await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 60_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(record());
    await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible();
    await shot(page, "06-second-forced-enrolment-360");
    await noSidewaysScroll(page);

    await typeEnrolmentCode(page, (secret) => generateSync({ secret }));
    await expect(page.getByRole("heading", { level: 1, name: "Two-factor authentication enabled" })).toBeVisible({ timeout: 30_000 });
    await shot(page, "07-second-enrolled-360");
    await page.getByRole("link", { name: "Continue" }).click();
    await page.waitForURL((url) => url.pathname === record(), { timeout: 30_000 });

    await expect(page.getByRole("heading", { level: 1, name: fx.congA.name })).toBeVisible();
    expect(await sectionStates(page)).toEqual({ Profile: "locked", Assessment: "locked", Buildings: "locked", Insurance: "open", Loans: "open" });
    await expect(section(page, "Profile")).toContainText(
      "You need permission to manage congregation oversight. An administrator can give it under Roles.",
    );
    await expect(page.getByRole("link", { name: "Record a year" })).toBeVisible();
    await noSidewaysScroll(page);
    expect(await smallControls(page)).toEqual([]);
    await shot(page, "08-second-record-360");

    // The list: an Insurance column and no manage columns; the tier-1 forms are Locked pages.
    await page.goto(base());
    await expect(page.locator("th", { hasText: /^Insurance expires$/ })).toBeVisible();
    await expect(page.locator("th", { hasText: /^Viability$/ })).toHaveCount(0);
    await shot(page, "09-second-list-360");
    await page.goto(`${record()}/buildings/new`);
    await expect(page.getByText("Locked", { exact: true })).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
    await shot(page, "10-second-locked-form-360");

    // A page opened without a re-challenge: the session is verified, so no /totp hop.
    await page.goto(`${record()}/insurance/new`);
    await waitHydrated(page);
    await expect(page.locator("#insurance-year")).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe(`${record()}/insurance/new`);
    await page.close();
    await context.close();

    // The account is now enrolled and requires the second factor from here on.
    const [account] = (await sql`
      select exists (select 1 from user_totp where user_id = ${fx.users.second}::uuid) as enrolled
      from users where id = ${fx.users.second}::uuid`) as { enrolled: boolean }[];
    expect(account!.enrolled).toBe(true);
  });

  test("4. a person who holds only the manage key sees Profile, Assessment and Buildings open and Insurance and Loans Locked", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", record());
    const page = await newPhonePage(context);
    await page.goto(record());
    await expect(page.getByRole("heading", { level: 1, name: fx.congA.name })).toBeVisible();
    expect(await sectionStates(page)).toEqual({ Profile: "open", Assessment: "open", Buildings: "open", Insurance: "locked", Loans: "locked" });
    await expect(section(page, "Loans")).toContainText(
      "You need permission to manage congregation property finances. An administrator can give it under Roles.",
    );
    await noSidewaysScroll(page);
    expect(await smallControls(page)).toEqual([]);
    await shot(page, "11-clerk-record-360");
    await page.goto(base());
    await expect(page.locator("th", { hasText: /^Insurance expires$/ })).toHaveCount(0);
    await shot(page, "12-clerk-list-360");
    await page.close();
    await context.close();
  });
});

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}
