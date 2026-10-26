import { test, expect, type Browser } from "@playwright/test";
import bcrypt from "bcryptjs";
import { platformSql } from "./support/db";
import {
  addRosterPerson,
  inviteAddress,
  removeInviteOrg,
  setupInviteOrg,
  THROWAWAY_PASSWORD,
  type InviteOrg,
} from "./support/invitation-fixture";
import { signInOnPage } from "./support/invitation-ui";
import { storageStatePath } from "./support/users";

/**
 * Two-factor is role-based (F343, DECISION-291; docs/work-log/2026-10-26-2fa-default.md, T16).
 * A new account's own setting is OFF by default; what asks a person for two-factor is a role they hold,
 * a congregation's policy, or their own setting. Three walks, each against the real sign-in path:
 *
 *   1. a new account (the column omitted, the same default a Google first sign-in gets) signs in and lands
 *      in its congregation with NO /totp hop;
 *   2. the same account, once a role carrying roles.manage is granted, is walked to enrolment at its next
 *      sign-in, with its own setting still off (the requirement came from the role);
 *   3. granting the platform administrator role from /admin/users switches the person's own setting on,
 *      audited, and the new administrator is walked to enrolment.
 *
 * Self-contained: it inserts through the owner connection and removes everything it made with the invitation
 * fixture's teardown (every address starts with the fixture org's prefix). Audit rows are append-only, so
 * the spec reads its own by resource id. Flags: auth.require_2fa only (seeded ON); none is set here.
 */

test.setTimeout(150_000);

const sql = platformSql("two-factor-role-based.spec");
let org: InviteOrg | undefined;

test.beforeEach(async () => {
  org = await setupInviteOrg(sql);
});

test.afterEach(async () => {
  await removeInviteOrg(sql, org);
  org = undefined;
});

/** A throwaway account whose insert OMITS two_factor_required, so it gets the column default. */
async function newAccount(o: InviteOrg, tag: string, opts: { member: boolean }) {
  const email = inviteAddress(o, tag);
  const hash = await bcrypt.hash(THROWAWAY_PASSWORD, 10);
  const [user] = (await sql`
    insert into users (email, name, password, email_verified, is_active)
    values (${email}, ${`Role Based ${tag}`}, ${hash}, now(), true)
    returning id`) as { id: string }[];
  let personId: string | null = null;
  if (opts.member) {
    personId = await addRosterPerson(sql, o, { first: "Wilhelmina", last: `Fenwick${tag}`, email });
    await sql`update people set user_id = ${user.id}::uuid where id = ${personId}::uuid`;
  }
  return { id: user.id, email, personId };
}

const settings = async (userId: string) =>
  ((await sql`
    select two_factor_required as own, presby_two_factor_required(id) as via_role
      from users where id = ${userId}::uuid`) as { own: boolean; via_role: boolean }[])[0];

/** A fresh, signed-out browser context signs in through the standard form. */
async function freshSignIn(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });
  await page.goto("/signin");
  await signInOnPage(page, email, THROWAWAY_PASSWORD);
  return { context, page, visited };
}

test("a new account created without naming the column is not required: it signs in and lands in its congregation with no /totp hop", async ({ browser }) => {
  const o = org!;
  const account = await newAccount(o, "plain", { member: true });
  expect(await settings(account.id), "the default is off and no role or congregation requires it").toEqual({ own: false, via_role: false });

  const { context, page, visited } = await freshSignIn(browser, account.email);
  try {
    await page.waitForURL((url) => url.pathname === `/o/${o.slug}`, { timeout: 40_000 });
    expect(visited, "never sent to the two-factor challenge").not.toContain("/totp");
    expect(visited, "never sent to enrolment").not.toContain("/account/2fa");
  } finally {
    await context.close();
  }
});

test("the same account, once a role with roles.manage is granted at its congregation, is walked to enrolment at its next sign-in", async ({ browser }) => {
  const o = org!;
  const account = await newAccount(o, "granted", { member: true });

  // First sign-in: no role yet, so no challenge (the previous test's walk, in brief).
  const first = await freshSignIn(browser, account.email);
  try {
    await first.page.waitForURL((url) => url.pathname === `/o/${o.slug}`, { timeout: 40_000 });
  } finally {
    await first.context.close();
  }

  // A role carrying roles.manage, granted to the person at the congregation (the owner connection stands in for
  // the administration screen, which is not what this spec is about).
  const [role] = (await sql`
    insert into app_roles (organization_id, key, name, role_kind)
    values (${o.orgId}::uuid, ${`fx_roles_manage_${o.stamp}`}, 'Fixture roles manager', 'custom') returning id`) as { id: string }[];
  await sql`insert into app_role_permissions (role_id, permission_key) values (${role.id}::uuid, 'roles.manage')`;
  await sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on)
    values (${o.orgId}::uuid, ${role.id}::uuid, ${account.personId!}::uuid, '2020-01-01')`;
  expect(await settings(account.id), "required through the role; the account's own setting is untouched").toEqual({ own: false, via_role: true });

  const second = await freshSignIn(browser, account.email);
  try {
    // A required, not-enrolled account is sent from sign-in to /totp and on to enrolment, the post-login router
    // (/launch) kept as the destination, exactly as invitation-new-account.spec.ts observes.
    await second.page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 40_000 });
    expect(new URL(second.page.url()).searchParams.get("callbackUrl")).toBe("/launch");
    expect(second.visited).toContain("/totp");
  } finally {
    await second.context.close();
  }
  expect((await settings(account.id)).own, "signing in never wrote the account's own setting").toBe(false);
});

test.describe("granting the platform administrator role", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("from /admin/users switches the person's own setting on, audited, and the new administrator is walked to enrolment", async ({ page, browser }) => {
    const o = org!;
    const account = await newAccount(o, "newadmin", { member: false });
    const [adminRole] = (await sql`select id from roles where name = 'admin'`) as { id: string }[];
    expect(await settings(account.id)).toEqual({ own: false, via_role: false });

    await page.goto(`/admin/users?q=${encodeURIComponent(account.email)}`);
    const row = page.getByRole("row").filter({ hasText: account.email });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByLabel("Assign role").selectOption(adminRole.id);
    await row.getByRole("button", { name: "Add" }).click();

    // The grant and the setting commit together; poll the row, not the DOM.
    await expect
      .poll(async () => (await settings(account.id)).own, { timeout: 20_000, message: "the person's own setting was switched on" })
      .toBe(true);
    const audit = (await sql`
      select actor_user_id, metadata from audit_events
       where resource_id = ${account.id} and action = 'user.2fa_required.changed'`) as { actor_user_id: string | null; metadata: Record<string, unknown> }[];
    expect(audit, "exactly one audit row for the change").toHaveLength(1);
    expect(audit[0].metadata).toEqual({ required: true, cause: "platform_role_granted", roleName: "admin" });
    expect(audit[0].actor_user_id, "attributed to the acting administrator").not.toBeNull();
    const granted = (await sql`select 1 from user_roles where user_id = ${account.id}::uuid and role_id = ${adminRole.id}::uuid`) as unknown[];
    expect(granted).toHaveLength(1);

    // The new administrator's next sign-in: required and not enrolled, so /totp walks it to enrolment.
    const fresh = await freshSignIn(browser, account.email);
    try {
      await fresh.page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 40_000 });
      expect(fresh.visited).toContain("/totp");
      expect(new URL(fresh.page.url()).searchParams.get("callbackUrl")).toBe("/launch");
    } finally {
      await fresh.context.close();
    }
  });
});
