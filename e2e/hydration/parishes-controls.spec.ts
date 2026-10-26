/**
 * parishes-controls.spec.ts - the pre-hydration guard for parish management's
 * controls (DECISION-159; docs/work-log/2026-10-25-parish-management.md, Phase 3
 * tag HYD), same pattern as event-types-form.spec.ts: hold every
 * `/_next/static/**.js` chunk, load with `domcontentloaded`, assert each control
 * is inoperable, release the scripts, and use control enablement as the
 * hydration signal. No networkidle, no throttling.
 *
 * Covered: the row picker (select + Assign), Add district, the Rename and Archive
 * triggers, and the bulk-move trigger. The persisted-row assertions are the
 * point: a DOM check alone would not catch a control that looked operable but
 * submitted a default.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the
 * `prod-build` project. Creates only its own throwaway congregation
 * (`e2e-parish-<stamp>`) and removes it in afterAll.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import {
  ACTION_MS,
  districtOf,
  removeParishFixture,
  setActorRole,
  setupParishFixture,
  verifiedContext,
  type ParishFixture,
} from "../support/parish-fixture";

const FLAGS = ["org_portal.directory", "org_portal.directory_v2"];

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

test.describe("Hydration - parish management controls (DECISION-159)", () => {
  test.setTimeout(120_000);
  test.describe.configure({ mode: "serial" });

  let sql: Sql;
  let flags: FlagCapture;
  let fx: ParishFixture;
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("hydration/parishes-controls.spec");
    flags = await captureFlags(sql, FLAGS);
    for (const key of FLAGS) await setFlag(sql, key, true);
    fx = await setupParishFixture(sql);
    context = await verifiedContext(browser, `/o/${fx.slug}/directory`);
  });

  test.afterAll(async () => {
    await context?.close();
    await removeParishFixture(sql, fx);
    await flags?.restore();
  });

  test("the Unassigned row picker and Assign button are disabled until hydration, and the district picked afterwards is the one persisted", async () => {
    await setActorRole(sql, fx, "seat");
    const page = await context.newPage();
    const release = await holdScripts(page);
    try {
      await page.goto(`/o/${fx.slug}/directory/parishes/unassigned`, { waitUntil: "domcontentloaded" });
      const row = page.locator(`[data-household-id="${fx.households.unVisitor}"]`);
      const gate = row.locator('fieldset[data-slot="hydration-gate"]');
      await expect(gate).toHaveAttribute("aria-busy", "true");
      await expect(row.getByLabel(/^Assign to/)).toBeDisabled();
      await expect(row.getByRole("button", { name: /^Assign/ })).toBeDisabled();

      release();
      await expect(row.getByLabel(/^Assign to/)).toBeEnabled({ timeout: ACTION_MS });
      await expect(row.getByRole("button", { name: /^Assign/ })).toBeEnabled();

      await row.getByLabel(/^Assign to/).selectOption({ label: "South District" });
      await row.getByRole("button", { name: /^Assign/ }).click();
      await expect(page.getByText("Assigned to South District.")).toBeVisible({ timeout: ACTION_MS });
      expect(await districtOf(sql, fx.households.unVisitor)).toBe("South District");
    } finally {
      await page.close();
    }
  });

  test("Add district, Rename and Archive are inoperable until hydration, and the name typed afterwards is the one persisted", async () => {
    await setActorRole(sql, fx, "admin");
    const page = await context.newPage();
    const release = await holdScripts(page);
    try {
      await page.goto(`/o/${fx.slug}/directory/parishes`, { waitUntil: "domcontentloaded" });
      await expect(page.locator('fieldset[data-slot="hydration-gate"]').first()).toHaveAttribute("aria-busy", "true");
      await expect(page.getByLabel("District name")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Add district" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Rename North District" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Archive North District" })).toBeDisabled();

      release();
      await expect(page.getByLabel("District name")).toBeEnabled({ timeout: ACTION_MS });
      await expect(page.getByRole("button", { name: "Rename North District" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Archive North District" })).toBeEnabled();

      await page.getByLabel("District name").fill("Hydration District");
      await page.getByRole("button", { name: "Add district" }).click();
      await expect(page.getByRole("heading", { level: 3, name: "Hydration District" })).toBeVisible({ timeout: ACTION_MS });
      const rows = (await sql`
        select unit_type, archived_at from org_units
         where organization_id = ${fx.orgId}::uuid and name = 'Hydration District'`) as Array<{ unit_type: string; archived_at: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ unit_type: "district", archived_at: null });
    } finally {
      await page.close();
    }
  });

  test("the bulk-move trigger on an archived district is disabled until hydration", async () => {
    await setActorRole(sql, fx, "seat");
    const page = await context.newPage();
    const release = await holdScripts(page);
    try {
      await page.goto(`/o/${fx.slug}/directory/parishes/${fx.districts.east}`, { waitUntil: "domcontentloaded" });
      const trigger = page.getByRole("button", { name: "Move all 2 households to…" });
      await expect(trigger).toBeDisabled();
      await expect(page.getByLabel(/^Move to/).first()).toBeDisabled();
      release();
      await expect(trigger).toBeEnabled({ timeout: ACTION_MS });
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      // Nothing was written by opening it.
      expect(await districtOf(sql, fx.households.eastOne)).toBe("East District");
      expect(await districtOf(sql, fx.households.eastTwo)).toBe("East District");
    } finally {
      await page.close();
    }
  });
});
