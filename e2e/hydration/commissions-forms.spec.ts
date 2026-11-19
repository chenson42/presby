/**
 * commissions-forms.spec.ts - the pre-hydration guard for the administrative-commission forms (DECISION-159,
 * rule H3; Presbytery committees Increment 2, Batch B7). Hold every `/_next/static/**.js` chunk, load with
 * `domcontentloaded`, assert the form is INERT (every control disabled inside the gate), release the scripts,
 * wait for the gate to open, then pick NON-DEFAULT values and assert the PERSISTED row: a DOM check alone would
 * not catch a form that looked filled in but saved its defaults (react-hook-form writes `defaultValues` over the
 * live DOM in the hydration commit; F116). Covers the two `useForm` roots of Increment 2: the commission record
 * form (a text, a textarea, a select, a date and a text; both its record and its edit mode) and the add-member
 * form (two selects and two dates). The end-commission and remove dialogs are plain controlled dialogs with no
 * form root: they cannot open before hydration, so there is no pre-hydration state to hold.
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod` (here with PW_PROD_BUILD=1 and
 * PW_PROD_PORT=3801), the production build: the lane that counts (DECISION-159). Flag `org_portal.committees`
 * set here and restored in afterAll.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import {
  COMMITTEES_FLAG,
  COMMITTEES_NAMES,
  commissionById,
  commissionMembers,
  commissionsByTitle,
  removeCommitteesFixture,
  SEATABLE_NAMES,
  seedCommission,
  setupCommitteesFixture,
  signedInContext,
  type CommitteesFixture,
} from "../support/committees-fixture";

async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  return release;
}

let sql: Sql;
let fx: CommitteesFixture;
let flags: FlagCapture;
const base = () => `/o/${fx.presbytery.slug}/admin/committees`;
const commissions = () => `${base()}/commissions`;

/** `YYYY-MM-DD` shifted by whole days (UTC arithmetic on a date-only string). */
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.describe("Hydration - administrative commission forms (DECISION-159)", () => {
  test.setTimeout(240_000);
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    sql = platformSql("hydration/commissions-forms.spec");
    flags = await captureFlags(sql, [COMMITTEES_FLAG]);
    await setFlag(sql, COMMITTEES_FLAG, true);
    fx = await setupCommitteesFixture(sql, { tag: "hk", who: ["clerk"] });
  });
  test.afterAll(async () => {
    if (sql && fx) await removeCommitteesFixture(sql, fx);
    await flags?.restore();
  });

  async function inertThenOpen(page: Page, path: string, release: () => void, minControls = 4) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    const controls = await gate.locator("input, select, textarea, button").all();
    expect(controls.length).toBeGreaterThanOrEqual(minControls);
    for (const control of controls) await expect(control).toBeDisabled();
    release();
    await expect(gate).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
  }

  test("the record form: a pre-hydration pick cannot overwrite; the saved row is the one chosen", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", base(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${commissions()}/new`, release, 5);

    const today = await page.locator("#commission-appointed").inputValue();
    await page.locator("#commission-title").fill("Hydration Commission");
    await page.locator("#commission-charge").fill("Chosen after hydration.");
    await page.locator("#commission-congregation").selectOption({ label: COMMITTEES_NAMES.congB });
    await page.locator("#commission-appointed").fill(shift(today, -12));
    await page.locator("#commission-minute").fill("Chosen minute 7");
    await page.getByRole("button", { name: "Record commission" }).click();
    await expect(page.getByText("Commission recorded.")).toBeVisible();
    await page.waitForURL((url) => /\/commissions\/[0-9a-f-]{36}$/.test(url.pathname));

    const rows = await commissionsByTitle(sql, fx, "Hydration Commission");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      charge: "Chosen after hydration.",
      about_org_id: fx.congB.id,
      appointed_on: shift(today, -12),
      minute_reference: "Chosen minute 7",
      ended_on: null,
    });
    await context.close();
  });

  test("the edit form carries the record and saves the values chosen after the gate opened", async ({ browser }) => {
    const id = await seedCommission(sql, fx, { title: "Hydration Edit Commission", charge: "Before.", aboutOrgId: fx.congA.id, appointedOn: "2024-05-01", minuteReference: "Before minute" });
    const context = await signedInContext(browser, "clerk", base(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${commissions()}/${id}/edit`, release, 5);

    await expect(page.locator("#commission-title")).toHaveValue("Hydration Edit Commission");
    await page.locator("#commission-charge").fill("After.");
    await page.locator("#commission-congregation").selectOption({ label: COMMITTEES_NAMES.congB });
    await page.locator("#commission-minute").fill("After minute");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Commission saved.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === `${commissions()}/${id}`);

    expect(await commissionById(sql, id)).toMatchObject({
      title: "Hydration Edit Commission",
      charge: "After.",
      about_org_id: fx.congB.id,
      appointed_on: "2024-05-01",
      minute_reference: "After minute",
    });
    await context.close();
  });

  test("the add-member form saves the person, title and dates chosen after the gate opened, not the defaults", async ({ browser }) => {
    const id = await seedCommission(sql, fx, { title: "Hydration Member Commission", appointedOn: "2024-05-01" });
    const context = await signedInContext(browser, "clerk", base(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${commissions()}/${id}/members/new`, release);

    const today = await page.locator("#commission-starts").inputValue();
    await page.locator("#commission-person").selectOption({ label: SEATABLE_NAMES.casey });
    await page.locator("#commission-role").selectOption("secretary");
    await page.locator("#commission-starts").fill(shift(today, -10));
    await page.locator("#commission-ends").fill(shift(today, 200));
    await page.getByRole("button", { name: "Add to commission" }).click();
    await expect(page.getByText("Added to the commission.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === `${commissions()}/${id}`);

    const members = await commissionMembers(sql, id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ person_id: fx.seatable.casey, role: "secretary", starts_on: shift(today, -10), ends_on: shift(today, 200) });
    await context.close();
  });
});
