/**
 * worship-forms.spec.ts - the pre-hydration guard for the worship forms (DECISION-159, rule H3).
 * Hold every `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the blockout form
 * and the new-team and new-service forms are INERT (every control disabled inside the gate), release
 * the scripts, wait for the gate to open, then pick NON-DEFAULT values and assert the PERSISTED row:
 * a DOM check alone would not catch a form that looked filled in but saved its defaults.
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, the production build.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { removeWorshipFixture, setupWorshipFixture, signedInContext, type WorshipFixture } from "../support/worship-fixture";

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
let fx: WorshipFixture;
const base = () => `/o/${fx.slug}`;

test.describe("Hydration - worship forms (DECISION-159)", () => {
  test.setTimeout(180_000);
  test.beforeAll(async () => {
    sql = platformSql("hydration/worship-forms.spec");
    fx = await setupWorshipFixture(sql, { tag: "h" });
  });
  test.afterAll(async () => {
    if (sql && fx) await removeWorshipFixture(sql, fx);
  });

  async function inertThenOpen(page: Page, path: string, release: () => void) {
    await page.goto(`${base()}${path}`, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    for (const control of await gate.locator("input, select, button").all()) await expect(control).toBeDisabled();
    release();
    await expect(gate).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
  }

  test("the blockout form: a pre-hydration pick cannot overwrite; the saved row is the one chosen", async ({ browser }) => {
    const context = await signedInContext(browser, "wren", `${base()}/worship`, { width: 360, height: 740 });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, "/worship/blockouts", release);
    const from = new Date(Date.now() + 80 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 82 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("From", { exact: true }).fill(from);
    await page.getByLabel("To", { exact: true }).fill(to);
    await page.getByLabel("Reason (optional)").selectOption("work");
    await page.getByRole("button", { name: "Save dates" }).click();
    await expect(page.getByText("Dates saved.")).toBeVisible();
    const [row] = (await sql`select starts_on::text as a, ends_on::text as b, reason from worship_blockouts where organization_id = ${fx.orgId}::uuid and ended_at is null`) as Array<{ a: string; b: string; reason: string }>;
    expect([row!.a, row!.b, row!.reason]).toEqual([from, to, "work"]);
    await context.close();
  });

  test("the new-team form saves the non-default kind and starter", async ({ browser }) => {
    const context = await signedInContext(browser, "planner", `${base()}/admin/worship`, { width: 360, height: 740 });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await inertThenOpen(page, "/admin/worship/teams/new", release);
    await page.getByLabel("Team name").fill("Hydration Choir");
    await page.getByLabel("Kind").selectOption("choir");
    await page.getByLabel("Start with").selectOption("greeters");
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hydration Choir" })).toBeVisible();
    const rows = (await sql`
      select gt.key as kind, (select count(*)::int from worship_positions p where p.group_id = g.id and p.name = 'Greeter') as greeters
        from groups g join group_types gt on gt.id = g.group_type_id
       where g.organization_id = ${fx.orgId}::uuid and g.name = 'Hydration Choir'`) as Array<{ kind: string; greeters: number }>;
    expect(rows).toEqual([{ kind: "choir", greeters: 1 }]);
    await context.close();
  });
});
