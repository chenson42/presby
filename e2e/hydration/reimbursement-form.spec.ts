/**
 * reimbursement-form.spec.ts - the pre-hydration guard for the reimbursement
 * request form (DECISION-159; Treasury Increment 1, Batch 5; docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 "New e2e specs" 6). A money form: a
 * pre-hydration overwrite of what a member typed (react-hook-form writes
 * `defaultValues` over the live DOM in the hydration commit, F116) is worse here
 * than anywhere. Same pattern as giving-give-form.spec.ts: hold every
 * `/_next/static/**.js` chunk, load with `domcontentloaded`, assert every control
 * and both buttons are inoperable, release the scripts, use control enablement as
 * the hydration signal (no networkidle, no waitForTimeout, no throttling), then
 * pick NON-DEFAULT values (the second group, "Pay a vendor"), type an amount, and
 * assert the PERSISTED `reimbursement_requests` row - a DOM check alone would not
 * catch a form that looked filled in but saved its defaults.
 *
 * The send-back dialog is the other `useForm` root; its content is created when
 * its button is pressed, which needs the page's JavaScript, so it has no
 * pre-hydration window to test; its HydrationGate is pinned structurally by
 * decision-dialogs.test.tsx and `check:hydration-gate`.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the
 * `prod-build` project. Signs in through the cached `member` storage state.
 * NEGATIVE CONTROL (recorded in the work-log): with `<HydrationGate>` removed
 * from request-form.tsx this spec goes red.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, withDbRetry, type Sql } from "../support/db";
import { E2E_USERS, storageStatePath } from "../support/users";

const TOGGLE = "org_portal.reimbursement";
const P = "e2e96000-0000-4000-8000-";
const pid = (n: number) => `${P}${String(n).padStart(12, "0")}`;

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

test.use({ storageState: storageStatePath("member") });

test.describe("Hydration - reimbursement request form (DECISION-159)", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let orgId = "";
  let slug = "";
  let groupA = "";
  let groupB = "";

  async function removeOrgs(ids: string[]) {
    for (const id of ids) {
      try {
        await withDbRetry(`delete org ${id}`, async () => {
          await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
          try {
            await sql`delete from organizations where id = ${id}::uuid`;
          } finally {
            await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
          }
        });
      } finally {
        await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
      }
    }
  }

  test.beforeAll(async () => {
    sql = platformSql("hydration/reimbursement-form.spec");
    const stale = (await sql`select id from organizations where slug ~ '^e2e-reimb[a-z]*-[0-9]+$'`) as { id: string }[];
    await removeOrgs(stale.map((r) => r.id));
    await withDbRetry("clear people", () => sql`delete from people where id in (${pid(2)}::uuid, ${pid(5)}::uuid)`);

    const stamp = Date.now();
    slug = `e2e-reimb-${stamp}`;
    orgId = `e2e96001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
    groupA = pid(12);
    groupB = pid(13);
    const userId = ((await sql`select id from users where email = ${E2E_USERS.member.email}`) as { id: string }[])[0]!.id;
    await sql`
      insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
      values (${orgId}::uuid, 'congregation', 'E2E Hydration Reimbursement Church', ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
    await sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
    await sql`
      insert into groups (id, organization_id, group_type_id, name, membership_source)
      values (${groupA}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Alpha Committee', 'managed'),
             (${groupB}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Beta Committee', 'managed')`;
    await sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${pid(5)}::uuid, ${userId}::uuid, 'Tamsin', 'Brightwater', now() + interval '3 hours')`;
    await sql`insert into memberships (organization_id, person_id, engagement_status, current_roll) values (${orgId}::uuid, ${pid(5)}::uuid, 'regular', 'active')`;
    await sql`
      insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
      values (${orgId}::uuid, ${groupA}::uuid, ${userId}::uuid), (${orgId}::uuid, ${groupB}::uuid, ${userId}::uuid)`;
    await sql`
      insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${orgId}::uuid, ${TOGGLE}, true)`;
  });

  test.afterAll(async () => {
    if (!orgId) return;
    await removeOrgs([orgId]);
    await withDbRetry("delete people", () => sql`delete from people where id in (${pid(5)}::uuid)`);
  });

  test("every control and both buttons are disabled until hydration, and what is picked afterwards is what is saved", async ({ page }) => {
    const release = await holdScripts(page);
    await page.goto(`/o/${slug}/reimbursements/new`, { waitUntil: "domcontentloaded" });
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("Charge to")).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Pay a vendor" })).toBeDisabled();
    await expect(page.getByLabel("Amount")).toBeDisabled();
    await expect(page.getByLabel("Date of the expense")).toBeDisabled();
    await expect(page.getByLabel("What was it for?")).toBeDisabled();
    await expect(page.getByLabel("I can't attach a receipt")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send request" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();

    release();
    await expect(page.getByLabel("Amount")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();

    // The SECOND group, a vendor, and an amount: none of these is the form's default.
    await page.getByLabel("Charge to").selectOption({ label: "Beta Committee" });
    await page.getByRole("radio", { name: "Pay a vendor" }).check();
    await page.getByLabel("Vendor name").fill("Harbor Lumber & Supply");
    await page.getByLabel("Amount").fill("3750");
    await page.getByLabel("What was it for?").fill("Lumber");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    const saved = (await sql`
      select group_id, kind, vendor_name, amount_cents, status from reimbursement_requests where organization_id = ${orgId}::uuid`) as Record<string, unknown>[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ group_id: groupB, kind: "vendor", vendor_name: "Harbor Lumber & Supply", amount_cents: 3750, status: "draft" });
    expect(saved[0]!.group_id).not.toBe(groupA);
  });
});
