/**
 * reimbursement-treasurer-forms.spec.ts - the pre-hydration guard for the treasurer
 * pages' three page-level `useForm` roots: Record payment, Add a category, and
 * Give a role on the Treasury team page (DECISION-159; Treasury Increment 1,
 * Batch 6). The dialogs' forms mount when a button is pressed, after hydration, so
 * their HydrationGate is pinned by `treasury-dialogs.test.tsx` and
 * `check:hydration-gate`. Same pattern as reimbursement-form.spec.ts: hold every
 * `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the controls
 * are inoperable, release, then pick NON-default values and assert what was
 * PERSISTED, not just what the DOM shows.
 *
 * Signs in as the MFA-enrolled user through one real TOTP step. Runs in the default
 * `chromium` project and, via `npm run test:e2e:prod`, in the `prod-build` project.
 * NEGATIVE CONTROL (recorded in the work-log): with `<HydrationGate>` removed from
 * payment-form.tsx this spec goes red.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, withDbRetry, type Sql } from "../support/db";
import { verifiedContext } from "../support/giving-fixture";
import { E2E_USERS } from "../support/users";

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

test.describe("Hydration - reimbursement treasurer forms (DECISION-159)", () => {
  test.setTimeout(180_000);

  let sql: Sql;
  let orgId = "";
  let slug = "";
  let requestId = "";
  let treasurerUser = "";

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
    sql = platformSql("hydration/reimbursement-treasurer-forms.spec");
    const stale = (await sql`select id from organizations where slug ~ '^e2e-reimbh-[0-9]+$'`) as { id: string }[];
    await removeOrgs(stale.map((r) => r.id));
    await withDbRetry("clear people", () => sql`delete from people where id in (${pid(50)}::uuid, ${pid(51)}::uuid, ${pid(52)}::uuid)`);

    const stamp = Date.now();
    slug = `e2e-reimbh-${stamp}`;
    orgId = `e2e96001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
    const group = pid(60);
    const role = pid(61);
    const user = async (email: string) => ((await sql`select id from users where email = ${email}`) as { id: string }[])[0]!.id;
    treasurerUser = await user(E2E_USERS["mfa-enrolled"].email);
    const requesterUser = await user(E2E_USERS.member.email);
    const chairUser = await user(E2E_USERS["presbytery-nogrant"].email);
    const chairPerson = ((await sql`select id from people where user_id = ${chairUser}::uuid`) as { id: string }[])[0]!.id;

    await sql`
      insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
      values (${orgId}::uuid, 'congregation', 'E2E Hydration Treasurer Church', ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
    await sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
    await sql`
      insert into groups (id, organization_id, group_type_id, name, membership_source)
      values (${group}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Alpha Committee', 'managed')`;
    await sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${pid(50)}::uuid, ${requesterUser}::uuid, 'Tamsin', 'Brightwater', now() + interval '3 hours'),
             (${pid(51)}::uuid, ${treasurerUser}::uuid, 'Octavia', 'Vance', now() + interval '3 hours'),
             (${pid(52)}::uuid, null, 'Marisol', 'Quillfeather', now() + interval '3 hours')`;
    for (const person of [pid(50), pid(51), pid(52), chairPerson]) {
      await sql`
        with armed as (select set_config('app.person_claim_authorized', ${person}, true))
        insert into memberships (organization_id, person_id, engagement_status, current_roll)
        select ${orgId}::uuid, ${person}::uuid, 'regular', 'active' from armed
        on conflict (person_id, organization_id) do nothing`;
    }
    await sql`
      insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
      values (${orgId}::uuid, ${group}::uuid, ${chairPerson}::uuid, 'chair', 'managed', date '2020-01-01')`;
    await sql`
      insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
      values (${orgId}::uuid, ${group}::uuid, ${chairUser}::uuid)`;
    await sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${role}::uuid, ${orgId}::uuid, 'e2e_reimbh_treasurer', 'E2E Hydration Treasurer', 'custom', false)`;
    await sql`
      insert into app_role_permissions (role_id, permission_key)
      values (${role}::uuid, 'reimbursement.request_for_others'), (${role}::uuid, 'reimbursement.view'),
             (${role}::uuid, 'reimbursement.pay'), (${role}::uuid, 'reimbursement.manage')`;
    await sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
      values (${orgId}::uuid, ${role}::uuid, ${pid(51)}::uuid, date '2020-01-01', ${treasurerUser}::uuid)`;
    await sql`
      insert into organization_feature_toggles (organization_id, feature_key, enabled)
      values (${orgId}::uuid, 'org_portal.reimbursement', true)`;

    // One approved request with its receipt waived, made by the definers (the app's own code path).
    await sql.query(`
      do $do$
      declare v_rid uuid; v_rev integer;
      begin
        perform set_config('app.current_org_id', '${orgId}', true);
        select s.request_id, s.revision into v_rid, v_rev from presby_reimbursement_save_draft(
          'hyd-treasurer-0001', 'reimburse', '${group}'::uuid, null, null, 2500,
          ((now() at time zone 'America/New_York')::date - 2), 'Hymn books', null, null, true, '${requesterUser}'::uuid) s;
        select s.revision into v_rev from presby_reimbursement_submit(v_rid, v_rev, '${requesterUser}'::uuid) s;
        perform * from presby_reimbursement_approve(v_rid, v_rev, 'seat', '${chairUser}'::uuid);
        perform * from presby_reimbursement_waive_receipt(v_rid, null, '${treasurerUser}'::uuid);
      end $do$`);
    requestId = ((await sql`select id from reimbursement_requests where organization_id = ${orgId}::uuid`) as { id: string }[])[0]!.id;
  });

  test.afterAll(async () => {
    if (!orgId) return;
    await removeOrgs([orgId]);
    await withDbRetry("delete people", () => sql`delete from people where id in (${pid(50)}::uuid, ${pid(51)}::uuid, ${pid(52)}::uuid)`);
  });

  test("Record payment: every control is disabled until hydration, and what is picked afterwards is what is saved", async ({ browser }) => {
    const context = await verifiedContext(browser, `/o/${slug}/admin/reimbursements`);
    const page = await context.newPage();
    const release = await holdScripts(page);
    await page.goto(`/o/${slug}/admin/reimbursements/${requestId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('fieldset[data-slot="hydration-gate"]').first()).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("How was it paid?")).toBeDisabled();
    await expect(page.getByLabel("Check number")).toBeDisabled();
    await expect(page.getByLabel("Date paid")).toBeDisabled();
    await expect(page.getByLabel("Note (optional)")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Record payment" }).last()).toBeDisabled();

    release();
    await expect(page.getByLabel("How was it paid?")).toBeEnabled();
    // ACH, a reference and a note: none is the form's default (a check with an empty reference).
    await page.getByLabel("How was it paid?").selectOption("ach");
    await page.getByLabel("Reference (optional)").fill("ACH-77");
    await page.getByLabel("Note (optional)").fill("Sent by bank transfer");
    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Payment recorded.").first()).toBeVisible();
    const saved = (await sql`
      select method, reference, note, kind from reimbursement_payments where request_id = ${requestId}::uuid`) as Record<string, unknown>[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ method: "ach", reference: "ACH-77", note: "Sent by bank transfer", kind: "payment" });
    await context.close();
  });

  test("Add a category and Give a role: disabled until hydration; the persisted rows are what was entered", async ({ browser }) => {
    const context = await verifiedContext(browser, `/o/${slug}/admin/reimbursements`);
    const page = await context.newPage();
    let release = await holdScripts(page);
    await page.goto(`/o/${slug}/admin/reimbursements/settings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("add-category-form").locator("xpath=ancestor::fieldset[@data-slot='hydration-gate']")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
    await expect(page.getByTestId("add-category-submit")).toBeDisabled();
    release();
    await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
    await page.getByLabel("Name", { exact: true }).fill("Music and choir");
    await page.getByTestId("add-category-submit").click();
    await expect(page.getByTestId("category-row").filter({ hasText: "Music and choir" })).toBeVisible();
    const cats = (await sql`select name from reimbursement_categories where organization_id = ${orgId}::uuid and ended_at is null`) as { name: string }[];
    expect(cats.map((c) => c.name)).toEqual(["Music and choir"]);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    release = await holdScripts(page);
    await page.goto(`/o/${slug}/admin/reimbursements/team`, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Role", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Person", { exact: true })).toBeDisabled();
    await expect(page.getByTestId("team-grant-submit")).toBeDisabled();
    release();
    await expect(page.getByLabel("Role", { exact: true })).toBeEnabled();
    await page.getByLabel("Role", { exact: true }).selectOption({ label: "E2E Hydration Treasurer" });
    await page.getByLabel("Person", { exact: true }).selectOption({ label: "Marisol Quillfeather" });
    await page.getByTestId("team-grant-submit").click();
    await expect(page.getByText("Role given.").first()).toBeVisible();
    const grants = (await sql`
      select count(*)::int as n from role_grants where organization_id = ${orgId}::uuid and person_id = ${pid(52)}::uuid`) as { n: number }[];
    expect(grants[0]!.n).toBe(1);
    await context.close();
  });
});
