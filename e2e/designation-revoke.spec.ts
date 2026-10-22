import { test, expect, type Page } from "@playwright/test";
import { platformSql } from "./support/db";
import {
  addRosterPerson,
  inviteAddress,
  removeInviteOrg,
  rosterUserId,
  setupInviteOrg,
  type InviteOrg,
} from "./support/invitation-fixture";
import { storageStatePath } from "./support/users";

/**
 * Revoke a founding administrator / treasurer from the admin organization page
 * (docs/work-log/2026-10-22-designation-revoke.md, Phase 3 "Test Plan" e2e;
 * DECISION-194/195/196). Lockout recovery: the page lists the holders by display
 * name only (never an email), each row has a Revoke that opens an AlertDialog
 * naming the organization, the person and the roles that end, a reason is
 * REQUIRED, and the persisted outcome is asserted in the database, not only the
 * DOM: the grants end today, unrelated grants are untouched, and exactly one
 * `org.*.revoked` audit row exists with ids/counts/reason only (no name, no
 * email).
 *
 * Every test runs on its own throwaway congregation (`setupInviteOrg`,
 * `deletable_until`-stamped, removed at the end). Holders are seeded with
 * `platformSql()`, the same owner-connection fixture idiom the invitation specs
 * use. Audit rows are append-only, so specs identify theirs by organization id.
 * Everything is synthetic: `.invalid` addresses, invented names (No Real Data).
 */

test.use({ storageState: storageStatePath("admin") });
test.setTimeout(120_000);

const sql = platformSql("designation-revoke.spec");

const HOLDER = { first: "Alderic", last: "Fennimore" } as const;
const HOLDER_NAME = `${HOLDER.first} ${HOLDER.last}`;
const REASON = "Fixture grant left over from the first test setup.";

const orgs: InviteOrg[] = [];
let stampCounter = 0;

async function newOrg(): Promise<InviteOrg> {
  stampCounter += 1;
  // `sweep: false`: a sibling test's org must never be swept from under it.
  const org = await setupInviteOrg(sql, { stamp: Date.now() * 10 + stampCounter, sweep: false });
  orgs.push(org);
  return org;
}

test.afterEach(async () => {
  while (orgs.length > 0) await removeInviteOrg(sql, orgs.pop());
});

async function makeRole(org: InviteOrg, key: string, name: string, permissionKeys: string[]): Promise<string> {
  const [role] = (await sql`
    insert into app_roles (organization_id, key, name, role_kind)
    values (${org.orgId}::uuid, ${key}, ${name}, 'custom')
    returning id`) as { id: string }[];
  for (const permissionKey of permissionKeys) {
    await sql`insert into app_role_permissions (role_id, permission_key) values (${role.id}::uuid, ${permissionKey})`;
  }
  return role.id;
}

async function grantTo(
  org: InviteOrg,
  roleId: string,
  subject: { personId?: string; groupId?: string },
  reason: string | null,
): Promise<string> {
  const operator = await rosterUserId(sql, "admin");
  const [grant] = (await sql`
    insert into role_grants (organization_id, role_id, person_id, group_id, starts_on, granted_by, grant_reason)
    values (${org.orgId}::uuid, ${roleId}::uuid, ${subject.personId ?? null}, ${subject.groupId ?? null},
            '2020-01-01'::date, ${operator}::uuid, ${reason})
    returning id`) as { id: string }[];
  return grant.id;
}

/** A roster person (with an email on file, which must never reach the page) holding a slot through a custom role. */
async function seedFounder(org: InviteOrg) {
  const email = inviteAddress(org, "holder");
  const personId = await addRosterPerson(sql, org, { first: HOLDER.first, last: HOLDER.last, email });
  const manage = await makeRole(org, "portal_admin", "Portal Administrator", ["roles.manage", "role_grants.manage"]);
  const helper = await makeRole(org, "records_helper", "Records Helper", ["people.manage"]);
  const manageGrant = await grantTo(org, manage, { personId }, "dev-seed: admin grant");
  const unrelatedGrant = await grantTo(org, helper, { personId }, null);
  return { email, personId, manageGrant, unrelatedGrant };
}

async function endsOn(grantId: string): Promise<string | null> {
  const rows = (await sql`select ends_on::text as e from role_grants where id = ${grantId}::uuid`) as { e: string | null }[];
  return rows[0]?.e ?? null;
}

async function today(): Promise<string> {
  const rows = (await sql`select current_date::text as d`) as { d: string }[];
  return rows[0].d;
}

async function revokeAudits(org: InviteOrg, action: string) {
  return (await sql`
    select action, resource_type, resource_id, actor_email, metadata
      from audit_events
     where action = ${action} and metadata->>'organizationId' = ${org.orgId}
     order by created_at`) as {
    action: string;
    resource_type: string;
    resource_id: string;
    actor_email: string | null;
    metadata: Record<string, unknown>;
  }[];
}

async function openDialogFor(page: Page, section: ReturnType<Page["getByTestId"]>, name: string) {
  const button = section.getByRole("button", { name: `Revoke access for ${name}` });
  // The page hydrates before a click does anything (the dialog needs client JS).
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await button.click();
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return page.getByRole("alertdialog");
}

test.describe("founding administrator", () => {
  test("lists the holder by display name only, and Revoke opens an AlertDialog naming the organization, the person and the roles", async ({ page }) => {
    const org = await newOrg();
    const founder = await seedFounder(org);
    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("founding-administrator-section");

    await expect(section).toContainText("1 person can manage roles at this organization");
    const row = section.getByTestId("designation-holder-row");
    await expect(row).toContainText(HOLDER_NAME);
    await expect(row).toContainText("Granted another way");
    await expect(row).toContainText("Portal Administrator");
    // Display name only: the person's email is on file and is nowhere on the page.
    expect(await page.content()).not.toContain(founder.email);
    expect(await section.textContent()).not.toMatch(/@/);
    // The invite form is not offered while somebody holds the slot.
    await expect(section.getByLabel("Email address")).toHaveCount(0);

    const dialog = await openDialogFor(page, section, HOLDER_NAME);
    await expect(dialog).toContainText(`End ${HOLDER_NAME}'s access?`);
    await expect(dialog).toContainText(org.name);
    await expect(dialog).toContainText("Portal Administrator");
    await expect(dialog).toContainText(/only person who has this access/);
    await expect(dialog).toContainText(/recorded in the audit log with your reason/);
    // Cancel leaves everything as it was.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await endsOn(founder.manageGrant)).toBeNull();
  });

  test("a reason that is too short shows the inline error and the dialog stays open; nothing is written", async ({ page }) => {
    const org = await newOrg();
    const founder = await seedFounder(org);
    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("founding-administrator-section");
    const dialog = await openDialogFor(page, section, HOLDER_NAME);

    await dialog.getByLabel(/reason \(kept in the audit log\)/i).fill("too short");
    await dialog.getByRole("button", { name: "Yes, end access" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Add a reason of at least 10 characters.");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(await endsOn(founder.manageGrant)).toBeNull();
    expect(await revokeAudits(org, "org.founding_administrator.revoked")).toHaveLength(0);
  });

  test("a valid reason ends the grants, shows the success copy, reopens the invite form at zero, and writes exactly one audit row with no name or email", async ({ page }) => {
    const org = await newOrg();
    const founder = await seedFounder(org);
    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("founding-administrator-section");
    const dialog = await openDialogFor(page, section, HOLDER_NAME);

    await dialog.getByLabel(/reason \(kept in the audit log\)/i).fill(REASON);
    await dialog.getByRole("button", { name: "Yes, end access" }).click();

    // The list re-reads, the slot is empty, and the invite form is back.
    await expect(section.getByLabel("Email address")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(section.getByRole("status").filter({ hasText: "Access ended for" })).toContainText(
      `Access ended for ${HOLDER_NAME}. Nobody holds this now. Invite a replacement below.`,
    );
    await expect(section.getByTestId("designation-holder-row")).toHaveCount(0);

    // Persisted: the counted grant ends today; the person's unrelated grant is untouched.
    expect(await endsOn(founder.manageGrant)).toBe(await today());
    expect(await endsOn(founder.unrelatedGrant)).toBeNull();

    const audits = await revokeAudits(org, "org.founding_administrator.revoked");
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    expect(audit.resource_type).toBe("organization");
    expect(audit.resource_id).toBe(org.orgId);
    expect(audit.metadata).toMatchObject({
      organizationId: org.orgId,
      slot: "founding_administrator",
      arm: "person",
      personId: founder.personId,
      grantIds: [founder.manageGrant],
      roleKeys: ["portal_admin"],
      reason: REASON,
      holderCountBefore: 1,
      holderCountAfter: 0,
      reachedZero: true,
      selfRevoke: false,
    });
    const serialized = JSON.stringify(audit.metadata);
    expect(serialized).not.toContain(HOLDER.first);
    expect(serialized).not.toContain(HOLDER.last);
    expect(serialized).not.toContain(founder.email);
    expect(serialized).not.toMatch(/@/);
  });

  test("a second tab submitting the same revoke gets the 'already removed' copy and writes no second audit row", async ({ page, context }) => {
    const org = await newOrg();
    const founder = await seedFounder(org);
    await page.goto(`/admin/organizations/${org.orgId}`);
    const second = await context.newPage();
    await second.goto(`/admin/organizations/${org.orgId}`);

    const sectionA = page.getByTestId("founding-administrator-section");
    const sectionB = second.getByTestId("founding-administrator-section");
    const dialogA = await openDialogFor(page, sectionA, HOLDER_NAME);
    // The second tab renders the same (soon stale) list and has its dialog open before the first submits.
    const dialogB = await openDialogFor(second, sectionB, HOLDER_NAME);

    await dialogA.getByLabel(/reason \(kept in the audit log\)/i).fill(REASON);
    await dialogA.getByRole("button", { name: "Yes, end access" }).click();
    await expect(sectionA.getByLabel("Email address")).toBeVisible({ timeout: 30_000 });
    expect(await endsOn(founder.manageGrant)).toBe(await today());

    await dialogB.getByLabel(/reason \(kept in the audit log\)/i).fill(REASON);
    await dialogB.getByRole("button", { name: "Yes, end access" }).click();
    await expect(second.getByText("That access has already been removed. The list has been refreshed.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(second.getByRole("alertdialog")).toHaveCount(0);
    expect(await revokeAudits(org, "org.founding_administrator.revoked")).toHaveLength(1);
    await second.close();
  });

  test("a derived-group holder (the Active Membership roster) is listed with no Revoke button", async ({ page }) => {
    const org = await newOrg();
    const email = inviteAddress(org, "member");
    await addRosterPerson(sql, org, { first: "Bartholomew", last: "Quillfeather", email });
    const [group] = (await sql`
      select id from groups where organization_id = ${org.orgId}::uuid and derived_from = 'active_membership'`) as { id: string }[];
    const manage = await makeRole(org, "everyone_admin", "Everyone Administrator", ["roles.manage"]);
    await grantTo(org, manage, { groupId: group.id }, null);

    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("founding-administrator-section");
    await expect(section.getByTestId("designation-holder-row")).toHaveCount(1, { timeout: 30_000 });
    await expect(section.getByTestId("derived-holder-note")).toContainText("the congregation's own officers change this");
    await expect(section.getByRole("button", { name: /revoke/i })).toHaveCount(0);
    // A group's members are never named.
    expect(await section.textContent()).not.toContain("Quillfeather");
    expect(await page.content()).not.toContain(email);
  });
});

test.describe("treasurer", () => {
  test("a congregation lists the treasurer by name; the dialog says donor and gift data stays; revoking writes org.treasurer.revoked", async ({ page }) => {
    const org = await newOrg();
    const email = inviteAddress(org, "treasurer");
    const personId = await addRosterPerson(sql, org, { first: "Ottoline", last: "Fairweather", email });
    const role = await makeRole(org, "giving_manager", "Giving Manager", ["giving.manage"]);
    const treasurerGrant = await grantTo(org, role, { personId }, "treasurer designation");

    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("treasurer-designation-section");
    await expect(section).toContainText("1 person can manage giving at this organization");
    await expect(section).toContainText(
      "Gift and donor records are not changed by ending access here. Every designation and every ending of access is recorded in the audit log.",
    );
    await expect(section.getByTestId("designation-holder-row")).toContainText("Designated through an invitation");
    expect(await page.content()).not.toContain(email);

    const dialog = await openDialogFor(page, section, "Ottoline Fairweather");
    await expect(dialog).toContainText(/manage giving at/);
    await expect(dialog).toContainText(
      "Gift and donor records are not changed. This is recorded in the audit log.",
    );
    await dialog.getByLabel(/reason \(kept in the audit log\)/i).fill(REASON);
    await dialog.getByRole("button", { name: "Yes, end access" }).click();

    await expect(section.getByLabel(/treasurer.s email address/i)).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole("status").filter({ hasText: "Access ended for" })).toContainText(
      "Access ended for Ottoline Fairweather. Nobody holds this now. Invite a replacement below.",
    );
    expect(await endsOn(treasurerGrant)).toBe(await today());
    const audits = await revokeAudits(org, "org.treasurer.revoked");
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ slot: "treasurer", arm: "person", personId, reason: REASON, reachedZero: true });
    expect(await revokeAudits(org, "org.founding_administrator.revoked")).toHaveLength(0);
    expect(JSON.stringify(audits[0].metadata)).not.toContain("Fairweather");
    expect(JSON.stringify(audits[0].metadata)).not.toContain(email);
  });

  test("a presbytery shows no treasurer section", async ({ page }) => {
    const org = await newOrg();
    await sql`update organizations set organization_type = 'presbytery' where id = ${org.orgId}::uuid`;
    await page.goto(`/admin/organizations/${org.orgId}`);
    await expect(page.getByTestId("founding-administrator-section")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("treasurer-designation-section")).toHaveCount(0);
  });
});

test.describe("at a 360 px phone viewport", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the holder row and the dialog fit without sideways scroll, and Revoke is a 44 px target", async ({ page }) => {
    const org = await newOrg();
    await seedFounder(org);
    // A group with a very long name must wrap, not scroll the page sideways.
    const [type] = (await sql`select id from group_types where key = 'roster'`) as { id: string }[];
    const longName = "The Committee For The Ongoing Care Of The Fellowship Hall And All Of Its Many Rooms";
    const [group] = (await sql`
      insert into groups (organization_id, group_type_id, name, membership_source)
      values (${org.orgId}::uuid, ${type.id}::uuid, ${longName}, 'managed') returning id`) as { id: string }[];
    const memberA = await addRosterPerson(sql, org, { first: "Bartholomew", last: "Quillfeather", email: inviteAddress(org, "g1") });
    await sql`
      insert into group_memberships (organization_id, group_id, person_id, source, starts_on)
      values (${org.orgId}::uuid, ${group.id}::uuid, ${memberA}::uuid, 'managed', current_date)`;
    const groupRole = await makeRole(org, "hall_admin", "Hall Administrator", ["roles.manage"]);
    await grantTo(org, groupRole, { groupId: group.id }, null);

    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("founding-administrator-section");
    await expect(section.getByTestId("designation-holder-row")).toHaveCount(2, { timeout: 30_000 });

    const overflow = await section.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(overflow.scroll, "the section does not scroll sideways").toBeLessThanOrEqual(overflow.client);
    const pageOverflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(pageOverflow.scroll, "the page does not scroll sideways").toBeLessThanOrEqual(pageOverflow.client);

    const person = section.getByRole("button", { name: `Revoke access for ${HOLDER_NAME}` });
    const personBox = await person.boundingBox();
    expect(personBox!.height).toBeGreaterThanOrEqual(44);
    const groupButton = section.getByRole("button", { name: `Revoke access for the ${longName} group` });
    const groupBox = await groupButton.boundingBox();
    expect(groupBox!.height).toBeGreaterThanOrEqual(44);

    // The dialog fits the phone: no sideways scroll, and its confirm button can be scrolled to.
    const dialog = await openDialogFor(page, section, HOLDER_NAME);
    const dialogOverflow = await dialog.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(dialogOverflow.scroll).toBeLessThanOrEqual(dialogOverflow.client);
    const confirm = dialog.getByRole("button", { name: "Yes, end access" });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
});
