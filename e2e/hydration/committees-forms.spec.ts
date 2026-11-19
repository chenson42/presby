/**
 * committees-forms.spec.ts - the pre-hydration guard for the presbytery-committee forms (DECISION-159, rule
 * H3; Presbytery committees Increment 1, Batch B4). Hold every `/_next/static/**.js` chunk, load with
 * `domcontentloaded`, assert the form is INERT (every control disabled inside the gate), release the scripts,
 * wait for the gate to open, then pick NON-DEFAULT values and assert the PERSISTED row: a DOM check alone would
 * not catch a form that looked filled in but saved its defaults (react-hook-form writes `defaultValues` over the
 * live DOM in the hydration commit; F116). Covers the three `useForm` roots of Increment 1: the new-committee
 * form (a text, a required select and two optional texts), the add-member form (two selects and two dates) and
 * the change-role form (a select and a date).
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod` (here with PW_PROD_BUILD=1 and
 * PW_PROD_PORT=3801), the production build: the lane that counts (DECISION-159). Flag `org_portal.committees`
 * set here and restored in afterAll.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import {
  COMMITTEES_FLAG,
  committeeByName,
  removeCommitteesFixture,
  seatsOf,
  SEATABLE_NAMES,
  seedCommittee,
  seedSeat,
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

/** `YYYY-MM-DD` shifted by whole days (UTC arithmetic on a date-only string). */
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.describe("Hydration - presbytery committee forms (DECISION-159)", () => {
  test.setTimeout(240_000);
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    sql = platformSql("hydration/committees-forms.spec");
    flags = await captureFlags(sql, [COMMITTEES_FLAG]);
    await setFlag(sql, COMMITTEES_FLAG, true);
    fx = await setupCommitteesFixture(sql, { tag: "h", who: ["clerk"] });
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

  test("the new-committee form: a pre-hydration pick cannot overwrite; the saved row is the one chosen", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", base(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${base()}/new`, release);

    await page.locator("#committee-name").fill("Hydration Committee");
    await page.locator("#committee-kind").selectOption("ad_hoc");
    await page.locator("#committee-purpose").fill("Chosen after hydration.");
    await page.locator("#committee-meets").fill("Fourth Thursday");
    await page.getByRole("button", { name: "Create committee" }).click();
    await expect(page.getByText("Committee created.")).toBeVisible();
    await page.waitForURL((url) => /\/admin\/committees\/[0-9a-f-]{36}$/.test(url.pathname));

    const rows = (await sql`
      select g.name, g.description, g.meets_when, cd.kind
        from groups g join committee_details cd on cd.group_id = g.id
       where g.organization_id = ${fx.presbytery.id}::uuid and g.name = 'Hydration Committee'`) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ name: "Hydration Committee", description: "Chosen after hydration.", meets_when: "Fourth Thursday", kind: "ad_hoc" }]);
    await context.close();
  });

  test("the add-member form saves the person, role and dates chosen after the gate opened, not the defaults", async ({ browser }) => {
    const committeeId = await seedCommittee(sql, fx, { name: "Hydration Add Committee", kind: "standing" });
    const context = await signedInContext(browser, "clerk", base(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${base()}/${committeeId}/members/new`, release);

    const today = await page.locator("#add-starts").inputValue();
    await page.locator("#add-person").selectOption({ label: SEATABLE_NAMES.casey });
    await page.locator("#add-role").selectOption("secretary");
    await page.locator("#add-starts").fill(shift(today, -10));
    await page.locator("#add-ends").fill(shift(today, 200));
    await page.getByRole("button", { name: "Add to committee" }).click();
    await expect(page.getByText("Added to the committee.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === `${base()}/${committeeId}`);

    const seats = await seatsOf(sql, committeeId);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ person_id: fx.seatable.casey, group_role: "secretary", starts_on: shift(today, -10), ends_on: shift(today, 200) });
    await context.close();
  });

  test("the change-role form saves the role chosen after the gate opened", async ({ browser }) => {
    const committeeId = await seedCommittee(sql, fx, { name: "Hydration Role Committee", kind: "required" });
    const seatId = await seedSeat(sql, fx, committeeId, fx.seatable.devon, { role: "member", startsOn: "2022-01-01" });
    const context = await signedInContext(browser, "clerk", base(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${base()}/${committeeId}/members/${seatId}/role`, release, 3); // a select, a date and the submit

    await page.locator("#change-role").selectOption("clerk");
    const effective = await page.locator("#change-effective").inputValue();
    await page.getByRole("button", { name: "Change role" }).click();
    await expect(page.getByText("Role changed.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === `${base()}/${committeeId}`);

    const seats = await seatsOf(sql, committeeId);
    expect(seats.map((s) => [s.group_role, s.starts_on, s.ends_on])).toEqual([
      ["member", "2022-01-01", effective],
      ["clerk", effective, null],
    ]);
    expect((await committeeByName(sql, fx, "Hydration Role Committee"))?.id).toBe(committeeId);
    await context.close();
  });
});
