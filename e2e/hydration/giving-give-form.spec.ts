/**
 * giving-give-form.spec.ts - the pre-hydration guard for the public give form
 * (DECISION-159; online giving Batch 4b; docs/work-log/2026-10-15-online-giving.md,
 * G19: "it is a money form, so a pre-hydration overwrite is worse here than
 * anywhere"). Same pattern as giving-offline-gift-form.spec.ts: hold every
 * `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the amount /
 * fund / frequency / cover-fees controls, the preset chips and Give are
 * inoperable, release the scripts, use control enablement as the hydration
 * signal (no networkidle, no waitForTimeout, no throttling), then pick a
 * NON-DEFAULT fund and monthly, type 37.50, submit, and assert the PERSISTED
 * `giving_checkout_intents` row - a DOM check alone would not catch a form that
 * looked filled in but submitted its defaults (F116).
 *
 * `STRIPE_SECRET_KEY` is unset in e2e, so the submit ends as a `failed` intent
 * and an "isn't available" banner; the row still carries exactly what the donor
 * chose, which is what this spec reads. Anonymous: no sign-in, no TOTP.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the
 * `prod-build` project. NEGATIVE CONTROL (recorded in the work-log): with the
 * `<HydrationGate>` removed from give-form.tsx this spec goes red.
 */

import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import {
  latestIntents,
  offerFundOnline,
  removeGivingFixture,
  setConnection,
  setGivingToggle,
  setupGivingFixture,
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

test.describe("Hydration - public give form (DECISION-159)", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let fx: GivingFixture;

  test.beforeAll(async () => {
    sql = platformSql("hydration/giving-give-form.spec");
    fx = await setupGivingFixture(sql);
    await setGivingToggle(sql, fx, true);
    await offerFundOnline(sql, fx, true, "general");
    await offerFundOnline(sql, fx, true, "building");
    await setConnection(sql, fx, { status: "active", publicOn: true, attested: true, livemode: false });
  });

  test.afterAll(async () => {
    if (fx) await removeGivingFixture(sql, fx);
  });

  test("every control and Give are disabled until hydration, and the non-default fund and monthly picked afterwards are persisted", async ({ page }) => {
    const release = await holdScripts(page);

    await page.goto(`/site/${fx.slug}/give`, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel(/Amount \(US dollars\)/)).toBeDisabled();
    await expect(page.getByLabel(/^Fund/)).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Give once" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Give every month" })).toBeDisabled();
    await expect(page.getByLabel(/Add the processing fee/)).toBeDisabled();
    await expect(page.getByRole("button", { name: "$25", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Give", exact: true })).toBeDisabled();

    release();
    await expect(page.getByLabel(/Amount \(US dollars\)/)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Give", exact: true })).toBeEnabled();

    // the first fund is the default; pick the SECOND, choose monthly, type an amount
    await page.getByLabel(/^Fund/).selectOption({ label: "Building campaign" });
    await page.getByRole("radio", { name: "Give every month" }).check();
    await page.getByLabel(/Amount \(US dollars\)/).fill("37.50");
    await page.getByRole("button", { name: "Give", exact: true }).click();
    await expect(page.getByTestId("give-banner")).toContainText("isn't available right now");

    const saved = await latestIntents(sql, fx);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      fund_id: fx.funds.building,
      gift_amount_cents: 3750,
      total_cents: 3750,
      donor_covered_fee_cents: 0,
      cover_fees: false,
      frequency: "monthly",
      status: "failed",
    });
    // the fund really is a non-default one, and not the fixture's general fund
    expect(saved[0]!.fund_id).not.toBe(fx.funds.general);
  });
});
