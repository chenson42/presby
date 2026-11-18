/**
 * oversight-forms.spec.ts - the pre-hydration guard for the congregation-record forms (DECISION-159, rule H3;
 * Congregation profile Increment 1, Batch B4). Hold every `/_next/static/**.js` chunk, load with
 * `domcontentloaded`, assert the form is INERT (every control disabled inside the gate), release the scripts,
 * wait for the gate to open, then pick NON-DEFAULT values and assert the PERSISTED row: a DOM check alone would
 * not catch a form that looked filled in but saved its defaults (react-hook-form writes `defaultValues` over the
 * live DOM in the hydration commit; F116). Covers the building form (a required select, a checkbox, three
 * Yes/No selects, text, year and number-ish fields) and the profile form.
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, the production build (the lane that
 * counts, DECISION-159). Flag `org_portal.oversight` set here and restored in afterAll.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import { OVERSIGHT_FLAG, removeOversightFixture, setupOversightFixture, signedInContext, type OversightFixture } from "../support/oversight-fixture";

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
let fx: OversightFixture;
let flags: FlagCapture;
const record = () => `/o/${fx.presbytery.slug}/admin/oversight/${fx.congA.id}`;

test.describe("Hydration - congregation record forms (DECISION-159)", () => {
  test.setTimeout(240_000);
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    sql = platformSql("hydration/oversight-forms.spec");
    flags = await captureFlags(sql, [OVERSIGHT_FLAG]);
    await setFlag(sql, OVERSIGHT_FLAG, true);
    fx = await setupOversightFixture(sql, { tag: "h", who: ["clerk"] });
  });
  test.afterAll(async () => {
    if (sql && fx) await removeOversightFixture(sql, fx);
    await flags?.restore();
  });

  async function inertThenOpen(page: Page, path: string, release: () => void) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    const controls = await gate.locator("input, select, textarea, button").all();
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) await expect(control).toBeDisabled();
    release();
    await expect(gate).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
  }

  test("the building form: a pre-hydration pick cannot overwrite; the saved row is the one chosen", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", record(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${record()}/buildings/new`, release);

    await page.locator("#building-name").fill("Hydration Hall");
    await page.locator("#building-type").selectOption("fellowship_hall");
    await page.locator("#building-primary").check();
    await page.locator("#building-year-built").fill("1952");
    await page.locator("#building-first-addition").fill("1974");
    await page.locator("#building-square-feet").fill("3200");
    await page.locator("#building-roof").selectOption("poor");
    await page.locator("#building-plumbing").selectOption("fair");
    await page.locator("#building-hvac").selectOption("good");
    await page.locator("#building-boiler").selectOption("poor");
    await page.locator("#building-sprinklers").selectOption("yes");
    await page.locator("#building-fire-alarm").selectOption("no");
    await page.locator("#building-security").selectOption("yes");
    await page.locator("#building-notes").fill("Chosen after hydration.");
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.getByText("Building added.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());

    const rows = (await sql`
      select name, building_type, is_primary, year_built, first_addition_year, square_feet, roof_condition, plumbing_condition,
             hvac_condition, boiler_condition, has_sprinklers, has_fire_alarm, has_security_system, notes
        from oversight_buildings where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid`) as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        name: "Hydration Hall",
        building_type: "fellowship_hall",
        is_primary: true,
        year_built: 1952,
        first_addition_year: 1974,
        square_feet: 3200,
        roof_condition: "poor",
        plumbing_condition: "fair",
        hvac_condition: "good",
        boiler_condition: "poor",
        has_sprinklers: true,
        has_fire_alarm: false,
        has_security_system: true,
        notes: "Chosen after hydration.",
      },
    ]);
    await context.close();
  });

  test("the profile form saves what was typed after the gate opened", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", record(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, `${record()}/profile/edit`, release);
    await page.locator("#profile-address").fill("12 Hydration Lane");
    await page.locator("#profile-city").fill("Gateville");
    await page.locator("#profile-county").fill("Release County");
    await page.locator("#profile-year-organized").fill("1888");
    await page.locator("#profile-phone").fill("555-0177");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    const rows = (await sql`
      select street_address, city, county, year_organized, phone from oversight_profiles
       where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid`) as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { street_address: "12 Hydration Lane", city: "Gateville", county: "Release County", year_organized: 1888, phone: "555-0177" },
    ]);
    await context.close();
  });
});
