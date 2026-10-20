/**
 * domains-claim-form.spec.ts - the pre-hydration guard for the domain claim form
 * (DECISION-159; Track F Batch 1d), same pattern as giving-offline-gift-form.spec.ts:
 * hold every `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the
 * domain field and Start are inoperable, release the scripts, use control enablement
 * as the hydration signal (no networkidle, no waitForTimeout, no throttling), then
 * type a bare domain, pick the NON-DEFAULT "without www" primary, submit, and assert
 * the PERSISTED rows - a DOM check alone would not catch a form that looked filled in
 * but submitted its defaults (F116).
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the
 * `prod-build` project. The acting person is the mfa-enrolled user, so a real TOTP
 * challenge is completed first. Its rows live in a throwaway congregation removed in
 * afterAll.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { addDomain } from "../support/custom-hosts";
import {
  ACTION_MS,
  removeDomainsUiFixture,
  retireAllDomains,
  setupDomainsUiFixture,
  verifiedContext,
  type DomainsUiFixture,
} from "../support/domains-ui-fixture";

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

test.describe("Hydration - domain claim form (DECISION-159)", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let fx: DomainsUiFixture;
  let ctx: BrowserContext;
  const stamp = Date.now();
  const domain = `hydrate-${stamp}.invalid`;

  test.beforeAll(async ({ browser }) => {
    // The fixture retries a dropped Neon connection (up to 4 times, with back-off) and then signs in with a real
    // TOTP challenge; the default 30 s hook timeout is inside that worst case.
    test.setTimeout(120_000);
    sql = platformSql("hydration/domains-claim-form.spec");
    fx = await setupDomainsUiFixture(sql, { stamp });
    ctx = await verifiedContext(browser, `/o/${fx.slug}/admin/domains`);
  });

  test.afterAll(async () => {
    await ctx?.close();
    await removeDomainsUiFixture(sql, fx);
  });

  test("the domain field and Start are disabled until hydration, and the non-default primary picked afterwards is persisted", async () => {
    const page = await ctx.newPage();
    const release = await holdScripts(page);

    await page.goto(`/o/${fx.slug}/admin/domains`, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("Your domain")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();

    release();
    await expect(page.getByLabel("Your domain")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();

    await page.getByLabel("Your domain").fill(domain);
    await page.getByRole("radio", { name: "The address without www" }).check();
    await page.getByRole("button", { name: "Start" }).click();
    // The claim is a server-action POST that takes 3-5.3 s on Neon (QA run 2, a'): the default 5 s expect timeout
    // is inside that, so the card, which appears only after the POST revalidates, gets the shared ceiling.
    await expect(page.getByTestId("claim-card")).toBeVisible({ timeout: ACTION_MS });

    const saved = (await sql`
      select hostname, web_role, state from organization_domains
       where organization_id = ${fx.orgId}::uuid order by hostname`) as { hostname: string; web_role: string; state: string }[];
    expect(saved).toEqual([
      { hostname: domain, web_role: "canonical", state: "pending" },
      { hostname: `www.${domain}`, web_role: "alias", state: "pending" },
    ]);
    await page.close();
  });

  test("the Copy and Check now controls are also inert before hydration, and enabled after", async () => {
    // Independent of the first test (QA run 2, a'): it seeds its OWN claim after retiring whatever the first test left,
    // so it neither fails nor depends on a claim existing because the first test happened to pass.
    await retireAllDomains(sql, fx.orgId);
    await addDomain(sql, { orgId: fx.orgId, hostname: `copy-${stamp}.invalid`, role: "canonical", state: "pending" });
    const page = await ctx.newPage();
    const release = await holdScripts(page);
    await page.goto(`/o/${fx.slug}/admin/domains`, { waitUntil: "domcontentloaded" });
    // Server-rendered disabled: nothing can be tapped that would do nothing.
    await expect(page.getByRole("button", { name: "Check now" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Copy the record value" }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: /Why isn.t it working/ })).toBeDisabled();
    release();
    await expect(page.getByRole("button", { name: "Check now" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Copy the record value" }).first()).toBeEnabled();
    await expect(page.getByRole("button", { name: /Why isn.t it working/ })).toBeEnabled();
    await page.close();
  });
});
