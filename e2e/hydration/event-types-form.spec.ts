/**
 * event-types-form.spec.ts - the pre-hydration guard for the event-types
 * manager's add form (DECISION-159), same pattern as
 * statistics-congregation.spec.ts: hold every `/_next/static/**.js` chunk, load
 * with `domcontentloaded`, assert the form is inoperable, release the scripts,
 * and use control enablement as the hydration signal. No networkidle, no
 * waitForTimeout, no throttling.
 *
 * The persisted-row assertion is the point: a DOM check alone would not catch a
 * form that looked filled in but submitted its defaults.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in
 * the `prod-build` project. Creates only its own rows ("E2E ..." names, role
 * keys `e2e_calendar_*`) and removes them in afterAll.
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "../support/users";
import { E2E_ORGS } from "../support/seed-orgs";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import {
  CAL_PEOPLE,
  grantCalendarRole,
  removeCalendarFixture,
} from "../support/calendar-fixture";

const EVENTS_FLAG = "org_portal.events";
const TYPES_URL = `/o/${E2E_ORGS.alpha.slug}/admin/events/types`;
const TYPE_NAME = "E2E Hydration Type";

/** Holds every `/_next/static/**.js` request until the returned function is called. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  return release;
}

test.describe("Hydration - event types form (DECISION-159)", () => {
  test.setTimeout(90_000);

  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("hydration/event-types-form.spec");
    flags = await captureFlags(sql, [EVENTS_FLAG]);
    await setFlag(sql, EVENTS_FLAG, true);
    await grantCalendarRole(sql, "manager", CAL_PEOPLE.congregationClerk);
  });

  test.afterAll(async () => {
    // state null: this spec never touched the calendar toggle.
    await removeCalendarFixture(sql, null);
    await flags.restore();
  });

  test("the Name input and Add button are disabled until hydration, and the type picked afterwards is persisted", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("congregation-clerk") });
    const page = await context.newPage();
    const release = await holdScripts(page);

    await page.goto(TYPES_URL, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').last();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel(/^Name/)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add event type" })).toBeDisabled();

    release();
    await expect(page.getByLabel(/^Name/)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Add event type" })).toBeEnabled();

    await page.getByLabel(/^Name/).fill(TYPE_NAME);
    await page.getByLabel("Amber").check();
    await page.getByRole("button", { name: "Add event type" }).click();
    await expect(page.getByRole("heading", { level: 3, name: TYPE_NAME })).toBeVisible();

    const rows = (await sql`
      select color from event_types
       where organization_id = ${E2E_ORGS.alpha.id}::uuid and name = ${TYPE_NAME}
    `) as { color: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].color).toBe("amber");
    await context.close();
  });
});
