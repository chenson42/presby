/**
 * visitor-access.spec.ts - Community Increment 3a, Batch D: what a visitor with a
 * connected sign-in can and cannot open, end to end at a desktop width and at
 * 360px (docs/work-log/2026-10-22-founding-admin-directory-inc3.md, Phase 3
 * amendment A9, D14, EC-43, walk W1).
 *
 * The rule under test (DECISION-233/234): a visitor is not listed, so the member
 * baseline (`directory.view`, bound to Active Membership) does not reach them, but
 * the calendar baseline (`events.view`, bound to All Current Records) does. So the
 * visitor can open the calendar, sees the Directory and Calendar tiles on the
 * congregation's page (tiles are permission-blind, D14), and is told in words,
 * not with a 403, that they cannot view the directory. A regular member of the same
 * congregation opens the directory: the control that keeps the refusal from being
 * a broken page.
 *
 * Who: a throwaway congregation (`e2e-invite-<stamp>`) built with the invitation
 * fixture, with the baseline `member` role and a spec-local `calendar_viewer` role
 * bound to the derived All Current Records group (what provisioning seeds for a
 * new congregation), a connected visitor and a connected regular member. Everything
 * goes with the congregation; no person-id range is claimed and nothing under
 * `e2e/support/*` changes (Workflow Rule 16).
 *
 * FLAGS. `org_portal.events` and `org_portal.directory` (global) are captured, set
 * and restored; the congregation's own `org_portal.calendar` toggle is written by
 * SQL on the throwaway congregation. No key is added to `e2e-baseline-flags.sql`.
 */
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  addAccount,
  addBaselineMemberRole,
  addMember,
  linkUser,
  noHorizontalOverflow,
  removeSignInOrg,
  setOrgToggle,
  signInAs,
  VIEWPORTS,
  type FixtureAccount,
} from "./support/sign-in-invite-fixture";
import { setupInviteOrg, type InviteOrg } from "./support/invitation-fixture";

const expect = baseExpect.configure({ timeout: 30_000 });

const EVENTS_FLAG = "org_portal.events";
const DIRECTORY_FLAG = "org_portal.directory";
const CALENDAR_TOGGLE = "org_portal.calendar";

/** The `calendar_viewer` baseline: `events.view`, bound to the derived All Current Records group (as `createOrganization` seeds it). */
async function addCalendarViewerRole(sql: Sql, org: InviteOrg): Promise<void> {
  const [role] = (await sql`
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (${org.orgId}::uuid, 'calendar_viewer', 'Calendar viewer', 'custom', false)
    returning id`) as { id: string }[];
  await sql`insert into app_role_permissions (role_id, permission_key) values (${role.id}::uuid, 'events.view')`;
  const bound = (await sql`
    insert into role_grants (organization_id, role_id, group_id, starts_on)
    select ${org.orgId}::uuid, ${role.id}::uuid, g.id, date '2020-01-01'
      from groups g where g.organization_id = ${org.orgId}::uuid and g.derived_from = 'all_memberships'
    returning id`) as { id: string }[];
  if (bound.length !== 1) {
    throw new Error("[visitor-access] the congregation has no All Current Records group: 0066's pair trigger did not run");
  }
}

test.describe("A visitor's access (Increment 3a)", () => {
  test.setTimeout(180_000);

  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("visitor-access.spec");
    flags = await captureFlags(sql, [EVENTS_FLAG, DIRECTORY_FLAG]);
    for (const key of [EVENTS_FLAG, DIRECTORY_FLAG]) await setFlag(sql, key, true);
  });

  test.afterAll(async () => {
    await flags.restore();
  });

  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      let org: InviteOrg | undefined;
      let visitor: FixtureAccount;
      let member: FixtureAccount;

      test.beforeEach(async () => {
        org = await setupInviteOrg(sql);
        await setOrgToggle(sql, org, CALENDAR_TOGGLE, true);
        await addBaselineMemberRole(sql, org);
        await addCalendarViewerRole(sql, org);
        visitor = await addAccount(sql, org, "visitor");
        const visitorPerson = await addMember(sql, org, { first: "Perpetua", last: "Quillon", email: visitor.email, engagement: "visitor" });
        await linkUser(sql, visitorPerson.personId, visitor.id);
        member = await addAccount(sql, org, "member");
        const memberPerson = await addMember(sql, org, { first: "Wendeline", last: "Ashgrove", email: member.email });
        await linkUser(sql, memberPerson.personId, member.id);
      });

      test.afterEach(async () => {
        await removeSignInOrg(sql, org);
        org = undefined;
      });

      const portalTile = (page: Page, label: string) => page.getByRole("main").getByRole("link", { name: new RegExp(`^${label}`) });

      test("a connected visitor sees the Directory and Calendar tiles, opens the calendar, and is told in words that the directory is not theirs", async ({ page }) => {
        const o = org!;
        await signInAs(page, visitor, new RegExp(`/o/${o.slug}`));

        // The congregation's page: both tiles (tiles are permission-blind) and no error.
        await page.goto(`/o/${o.slug}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(portalTile(page, "Directory")).toBeVisible();
        await expect(portalTile(page, "Calendar")).toBeVisible();
        await noHorizontalOverflow(page);

        // The calendar opens: the baseline reaches every current record.
        const calendar = await page.goto(`/o/${o.slug}/calendar`);
        expect(calendar?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
        await expect(page.getByText(/isn't available to your account/)).toHaveCount(0);
        await noHorizontalOverflow(page);

        // The directory: a plain sentence, not a 403 and not a blank page.
        const directory = await page.goto(`/o/${o.slug}/directory`);
        expect(directory?.status()).toBe(200);
        await expect(page.getByText("You don't have permission to view the directory.")).toBeVisible();
        await noHorizontalOverflow(page);
      });

      test("a connected regular member of the same congregation opens the directory (the control)", async ({ page }) => {
        const o = org!;
        await signInAs(page, member, new RegExp(`/o/${o.slug}`));
        const directory = await page.goto(`/o/${o.slug}/directory`);
        expect(directory?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Directory" })).toBeVisible();
        await expect(page.getByText("You don't have permission to view the directory.")).toHaveCount(0);
        // The member is listed, so the directory shows them (and never the visitor).
        await expect(page.getByText("Ashgrove").first()).toBeVisible();
        await expect(page.getByText("Quillon")).toHaveCount(0);
      });
    });
  }
});
