/**
 * create-organization-form.spec.ts - the pre-hydration guard for
 * /admin/organizations/new (DECISION-159, F275). Same pattern as
 * event-types-form.spec.ts: hold every `/_next/static/**.js` chunk, load with
 * `domcontentloaded`, assert the form is inoperable, release, and use control
 * enablement as the hydration signal. The type picked afterwards must reach
 * the form (the select is state-controlled, so a pre-hydration pick would be
 * overwritten). Creates no rows: it never submits.
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "../support/users";

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

test.describe("Hydration - create organization form (DECISION-159)", () => {
  test.setTimeout(90_000);

  test("the form is disabled until hydration, then accepts a type pick", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("admin") });
    const page = await context.newPage();
    const release = await holdScripts(page);

    await page.goto("/admin/organizations/new", { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').last();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#organizationType")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create organization" })).toBeDisabled();

    release();
    await expect(page.locator("#organizationType")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Create organization" })).toBeEnabled();

    await page.locator("#organizationType").selectOption("presbytery");
    await expect(page.locator("#organizationType")).toHaveValue("presbytery");
    await expect(page.locator("#parentOrganizationChoice")).toBeVisible();
    await context.close();
  });
});
