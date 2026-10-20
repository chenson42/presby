/**
 * giving-offline-gift-form.spec.ts - the pre-hydration guard for the offline
 * gift form (DECISION-159; online giving Batch 2), same pattern as
 * event-types-form.spec.ts: hold every `/_next/static/**.js` chunk, load with
 * `domcontentloaded`, assert the amount / fund / date / method controls and
 * Save are inoperable, release the scripts, use control enablement as the
 * hydration signal (no networkidle, no waitForTimeout, no throttling), then pick
 * a NON-DEFAULT fund, type an amount, submit, and assert the PERSISTED gift
 * row - a DOM check alone would not catch a form that looked filled in but
 * submitted its defaults (F116).
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in
 * the `prod-build` project. The giving role is held by the mfa-enrolled user,
 * so a real TOTP challenge is completed first (support/giving-fixture.ts). Its
 * rows live in a throwaway congregation removed in afterAll.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import {
  GIVING_NAMES as N,
  removeGivingFixture,
  setGivingRole,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
} from "../support/giving-fixture";

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

test.describe("Hydration - offline gift form (DECISION-159)", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let fx: GivingFixture;
  let ctx: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("hydration/giving-offline-gift-form.spec");
    fx = await setupGivingFixture(sql);
    await setGivingToggle(sql, fx, true);
    await setGivingRole(sql, fx, "treasurer");
    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (fx) await removeGivingFixture(sql, fx);
  });

  test("the amount, fund, date and method controls and Save are disabled until hydration, and the non-default fund picked afterwards is persisted", async () => {
    const page = await ctx.newPage();
    const release = await holdScripts(page);

    await page.goto(`/o/${fx.slug}/admin/giving/gifts/new`, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel(/^Amount/)).toBeDisabled();
    await expect(page.getByLabel(/^Fund/)).toBeDisabled();
    await expect(page.getByLabel(/Date received/)).toBeDisabled();
    await expect(page.getByLabel(/How was it given/)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Record gift" })).toBeDisabled();

    release();
    await expect(page.getByLabel(/^Amount/)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Record gift" })).toBeEnabled();

    // a plate offering needs no donor search; pick the SECOND (non-default) fund
    await page.getByRole("radio", { name: "Unidentified (plate offering)" }).check();
    await page.getByLabel(/^Fund/).selectOption({ label: N.fundBuilding });
    await page.getByLabel(/^Amount/).fill("412.30");
    await page.getByRole("button", { name: "Record gift" }).click();
    await expect(page.getByTestId("gift-recorded")).toContainText("Recorded $412.30");

    const saved = await sql`
      select g.amount_cents, f.name as fund, g.method, d.kind
        from giving_gifts g
        join giving_funds f on f.id = g.fund_id
        join giving_donors d on d.id = g.donor_id
       where g.organization_id = ${fx.orgId}::uuid` as { amount_cents: number; fund: string; method: string; kind: string }[];
    expect(saved).toEqual([{ amount_cents: 41_230, fund: N.fundBuilding, method: "cash", kind: "unidentified" }]);
    await page.close();
  });
});
