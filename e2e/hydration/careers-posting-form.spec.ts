/**
 * careers-posting-form.spec.ts - the pre-hydration guard for the job-openings staff
 * surfaces (DECISION-159, rule H1; docs/work-log/2026-10-25-careers-inc1.md, Phase 3 T27).
 * The same pattern as giving-offline-gift-form.spec.ts: hold every
 * `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the controls are
 * inoperable, release the scripts, use control enablement as the hydration signal (no
 * networkidle, no waitForTimeout, no throttling), then pick NON-DEFAULT values, submit, and
 * assert the PERSISTED row - a DOM check alone would not catch a form that looked filled in
 * but submitted its defaults (F116).
 *
 *   new posting   the form is a busy, disabled fieldset: title, type, pay, summary, closing
 *                 date, address, the description and its seven toolbar buttons, and Save;
 *                 after hydration a non-default type, unit and amount are saved and read back;
 *   edit posting  Publish and Discard (and the form around them) are disabled until hydration;
 *   the list      every Move button is disabled until hydration.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the `prod-build`
 * project. The careers role is held by the mfa-enrolled user, so a real TOTP challenge is
 * completed first (giving-fixture `verifiedContext`). Rows live in a throwaway congregation
 * removed in afterAll.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { verifiedContext } from "../support/giving-fixture";
import {
  addPosting,
  postingBySlug,
  removeCareersFixture,
  setCareersRole,
  setCareersToggle,
  setupCareersFixture,
  type CareersFixture,
} from "../support/careers-fixture";

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

const TOOLBAR = ["Heading", "Subheading", "Bold", "Italic", "Bulleted list", "Numbered list", "Link"];

test.describe("Hydration - job openings (DECISION-159)", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let fx: CareersFixture;
  let ctx: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("hydration/careers-posting-form.spec");
    fx = await setupCareersFixture(sql);
    await setCareersToggle(sql, fx, true);
    await setCareersRole(sql, fx, "manager");
    await addPosting(sql, fx, { slug: "hyd-one", title: "E2E Hydration One", state: "published" });
    await addPosting(sql, fx, { slug: "hyd-two", title: "E2E Hydration Two", state: "published" });
    await addPosting(sql, fx, { slug: "hyd-draft", title: "E2E Hydration Draft", state: "draft" });
    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (fx) await removeCareersFixture(sql, fx);
  });

  test("the new-posting form is inoperable until hydration, and the non-default type, unit and amount picked afterwards are persisted", async () => {
    const page = await ctx.newPage();
    const release = await holdScripts(page);

    await page.goto(`/o/${fx.slug}/admin/careers/new`, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').last();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel(/^Title/)).toBeDisabled();
    await expect(page.getByLabel("Type")).toBeDisabled();
    await expect(page.getByLabel("Lowest")).toBeDisabled();
    await expect(page.getByLabel("Short summary")).toBeDisabled();
    await expect(page.getByLabel("Closing date (optional)")).toBeDisabled();
    await expect(page.getByLabel("Web address")).toBeDisabled();
    await expect(page.getByLabel("Description")).toBeDisabled();
    for (const name of TOOLBAR) await expect(page.getByRole("button", { name, exact: true }), name).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();

    release();
    await expect(page.getByLabel(/^Title/)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    for (const name of TOOLBAR) await expect(page.getByRole("button", { name, exact: true }), name).toBeEnabled();

    await page.getByLabel(/^Title/).fill("E2E Hydration Saved");
    await page.getByLabel("Type").selectOption("intern");
    await page.getByLabel("Lowest").fill("52,000");
    await page.getByLabel("Pay (optional)").selectOption("year");
    await page.getByLabel("Description").fill("## Duties\n\nLearn the work.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    const saved = (await sql`
      select employment_type, pay_min_cents, pay_max_cents, pay_unit, status
        from job_postings where organization_id = ${fx.orgId}::uuid and slug = 'e2e-hydration-saved'`) as Record<string, unknown>[];
    expect(saved).toEqual([{ employment_type: "intern", pay_min_cents: 5_200_000, pay_max_cents: null, pay_unit: "year", status: "draft" }]);
    await page.close();
  });

  test("on the edit page Publish and Discard are disabled until hydration, then enable", async () => {
    const draft = await postingBySlug(sql, fx, "hyd-draft");
    expect(draft?.status).toBe("draft");
    const id = ((await sql`select id from job_postings where organization_id = ${fx.orgId}::uuid and slug = 'hyd-draft'`) as { id: string }[])[0]!.id;

    const page = await ctx.newPage();
    const release = await holdScripts(page);
    await page.goto(`/o/${fx.slug}/admin/careers/${id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('fieldset[data-slot="hydration-gate"]').last()).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Discard this draft" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();

    release();
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Discard this draft" })).toBeEnabled();
    // Nothing happened to the draft while the page was inert.
    expect((await postingBySlug(sql, fx, "hyd-draft"))?.status).toBe("draft");
    await page.close();
  });

  test("on the list every Move button is disabled until hydration", async () => {
    const page = await ctx.newPage();
    const release = await holdScripts(page);
    await page.goto(`/o/${fx.slug}/admin/careers`, { waitUntil: "domcontentloaded" });
    const moves = page.getByRole("button", { name: /^Move / });
    await expect(moves.first()).toBeVisible();
    for (const button of await moves.all()) await expect(button).toBeDisabled();

    const before = [(await postingBySlug(sql, fx, "hyd-one"))!.sort_order, (await postingBySlug(sql, fx, "hyd-two"))!.sort_order];
    release();
    // hyd-two was published last, so it is first: its Move down is the one that enables.
    await expect(page.getByRole("button", { name: "Move E2E Hydration Two down" })).toBeEnabled();
    expect([(await postingBySlug(sql, fx, "hyd-one"))!.sort_order, (await postingBySlug(sql, fx, "hyd-two"))!.sort_order]).toEqual(before);
    await page.close();
  });
});
