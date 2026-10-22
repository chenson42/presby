import { test, expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { platformSql } from "./support/db";
import {
  auditRowsFor,
  grantedRoleKeys,
  invitationRow,
  INVITE_NAMES,
  inviteAddress,
  personAtOrgFor,
  removeInviteOrg,
  rosterUserId,
  seedInvitation,
  setupInviteOrg,
  type InviteOrg,
} from "./support/invitation-fixture";
import { DEAD_LINK_PHRASE } from "./support/invitation-observer";
import { signInOnPage, submitTotp } from "./support/invitation-ui";
import { enterTotpCode } from "./support/totp-page";

/**
 * The new-invitee path, end to end (DECISION-183/185,
 * docs/work-log/2026-10-21-invitations.md; Phase 3 QA requirement 1; the
 * Phase 4/5 auth-e2e gate - this feature creates accounts and drives sign-in):
 *
 *   open the link, reload twice (nothing is consumed by looking) -> a refused
 *   short password and a refused mismatch (inline, nothing created) -> create the
 *   account -> "Your account is ready" -> sign in through the standard form ->
 *   the /totp wall walks the new account into /account/2fa ENROLMENT (the secret
 *   is read from the page, the code computed from it) -> lands in the
 *   congregation WITH AUTHORITY -> the same link is now dead.
 *
 * It asserts the PERSISTED outcome, not just the DOM: the account (verified,
 * 2FA required, bcrypt-hashed), the invitation row, the linked person and
 * membership, the grants, the three audit rows (ids only), and that the token
 * and its hash are in no audit row and no email_queue row. This is the specs'
 * first successful click-through of the create-account path (Batch 3's browser
 * pass could not click it: it grants real authority). One throwaway
 * congregation, removed at the end; audit rows stay (append-only).
 */

test.setTimeout(180_000);

const sql = platformSql("invitation-new-account.spec");
let org: InviteOrg | undefined;

test.beforeEach(async () => {
  org = await setupInviteOrg(sql);
});

test.afterEach(async () => {
  await removeInviteOrg(sql, org);
  org = undefined;
});

// leak-ok: a throwaway password for a `.invalid` fixture account, deleted at teardown (not a credential)
const PASSWORD = "Brindled-Wren-Cordage-42";

async function fillCreateForm(page: Page, password: string, confirm: string) {
  const first = page.locator("#invite-first-name");
  await expect(first).toBeEnabled({ timeout: 15_000 });
  await page.locator("#invite-password").fill(password);
  await page.locator("#invite-confirm").fill(confirm);
}

test("a new invitee: preview consumes nothing, bad passwords are refused inline, the account is created, 2FA is enrolled, and they land with authority", async ({
  page,
  browser,
  baseURL,
}) => {
  const o = org!;
  const operatorId = await rosterUserId(sql, "admin");
  const address = inviteAddress(o, "newcomer");
  const invitation = await seedInvitation(sql, o, {
    purpose: "founding_administrator",
    email: address,
    createdByUserId: operatorId,
  });

  // --- the preview: reload twice, nothing is consumed -----------------------------------------------
  for (let visit = 0; visit < 3; visit++) {
    if (visit === 0) await page.goto(`/invite?token=${invitation.token}`);
    else await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
    await expect(page.getByText(o.name).first()).toBeVisible();
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body, "the full address never reaches the page").not.toContain(address);
    expect(body).toContain("***@example.invalid");
  }
  expect((await invitationRow(sql, invitation.id)).accepted_at, "looking consumed nothing").toBeNull();
  await expect(page.locator("#invite-first-name")).toHaveValue(INVITE_NAMES.first);
  await expect(page.locator("#invite-last-name")).toHaveValue(INVITE_NAMES.last);
  // The rules are stated before the field is typed in.
  await expect(page.getByText(/at least 8 characters/i)).toBeVisible();

  // --- refusals are inline, announced, and create nothing --------------------------------------------
  await fillCreateForm(page, "short77", "short77");
  await page.getByRole("button", { name: "Create account" }).click();
  const error = page.locator("#invite-error");
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toHaveAttribute("role", "alert");
  await expect(error).toContainText(/at least 8/i);
  await expect(page.locator("#invite-password"), "the visitor's entries are kept").toHaveValue("short77");

  await fillCreateForm(page, PASSWORD, `${PASSWORD}-different`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(error).toContainText(/don.t match/i, { timeout: 15_000 });

  const nothing = (await sql`select count(*)::int as n from users where lower(email) = ${address}`) as { n: number }[];
  expect(nothing[0].n, "a refused submit creates no account").toBe(0);
  expect((await invitationRow(sql, invitation.id)).accepted_at).toBeNull();

  // --- the create-account click-through --------------------------------------------------------------
  await fillCreateForm(page, PASSWORD, PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => url.pathname === "/invite/accepted", { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Your account is ready" })).toBeVisible();
  expect(page.url(), "no token in the confirmation URL").not.toContain(invitation.token);

  // --- the persisted outcome of the account creation --------------------------------------------------
  const users = (await sql`
    select id, email_verified is not null as verified, two_factor_required, password, is_active
      from users where lower(email) = ${address}`) as {
    id: string; verified: boolean; two_factor_required: boolean; password: string; is_active: boolean;
  }[];
  expect(users).toHaveLength(1);
  const user = users[0];
  expect(user.verified, "the address is verified by the act of using the link").toBe(true);
  expect(user.two_factor_required, "a new account defaults to 2FA required").toBe(true);
  expect(user.is_active).toBe(true);
  expect(user.password, "stored as a bcrypt hash, never the password").toMatch(/^\$2[aby]\$\d{2}\$/);
  expect(user.password).not.toContain(PASSWORD);

  const row = await invitationRow(sql, invitation.id);
  expect(row.accepted_at).not.toBeNull();
  expect(row.accepted_user_id).toBe(user.id);
  const personId = await personAtOrgFor(sql, o, user.id);
  expect(personId, "a person was created at the organization and linked to the account").not.toBeNull();
  expect(row.person_id).toBe(personId);
  const [person] = (await sql`select first_name, last_name from people where id = ${personId!}::uuid`) as { first_name: string; last_name: string }[];
  expect(person).toEqual({ first_name: INVITE_NAMES.first, last_name: INVITE_NAMES.last });
  const [membership] = (await sql`
    select engagement_status, current_roll, ended_on from memberships where organization_id = ${o.orgId}::uuid and person_id = ${personId!}::uuid`) as { engagement_status: string; current_roll: string | null; ended_on: string | null }[];
  // A staff-kind membership (DECISION-128/129): live, and NOT on the membership roll - no roll action is written.
  expect(membership).toMatchObject({ engagement_status: "staff", current_roll: null, ended_on: null });
  expect(await grantedRoleKeys(sql, o, personId!)).toContain("founding_administrator");

  const audit = await auditRowsFor(sql, invitation.id);
  const byAction = Object.fromEntries(audit.map((a) => [a.action, a]));
  expect(Object.keys(byAction).sort()).toEqual([
    "invitation.accepted",
    "org.founding_administrator.designated",
    "user.created_via_invitation",
  ]);
  expect(byAction["invitation.accepted"].metadata).toMatchObject({
    invitationId: invitation.id,
    organizationId: o.orgId,
    purpose: "founding_administrator",
    personId,
    mode: "new_account",
    invitedByUserId: operatorId,
    inviterIsInvitee: false,
  });
  expect(byAction["invitation.accepted"].actor_user_id).toBe(user.id);
  expect(byAction["user.created_via_invitation"].metadata).toMatchObject({ userId: user.id, invitationId: invitation.id, organizationId: o.orgId });
  expect(byAction["org.founding_administrator.designated"].metadata).toMatchObject({
    viaInvitationId: invitation.id,
    invitedByUserId: operatorId,
    inviterIsInvitee: false,
  });
  expect(byAction["org.founding_administrator.designated"].resource_id).toBe(o.orgId);
  const everything = JSON.stringify(audit);
  for (const secret of [invitation.token, invitation.tokenHash, PASSWORD, address]) {
    expect(everything, "audit rows carry ids only: no token, hash, password or address").not.toContain(secret);
  }
  // The token is at rest nowhere but as its hash on the invitation row: not in audit_events, not in email_queue.
  const leaks = (await sql`
    select
      (select count(*)::int from audit_events where metadata::text like ${`%${invitation.token}%`}) as audit_token,
      (select count(*)::int from audit_events where metadata::text like ${`%${invitation.tokenHash}%`}) as audit_hash,
      (select count(*)::int from email_queue where html_body like ${`%${invitation.token}%`} or text_body like ${`%${invitation.token}%`}) as queue_token`) as { audit_token: number; audit_hash: number; queue_token: number }[];
  expect(leaks[0]).toEqual({ audit_token: 0, audit_hash: 0, queue_token: 0 });

  // --- sign in through the standard form; the 2FA wall walks them into enrolment ---------------------------
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/signin", { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/launch");
  await signInOnPage(page, address, PASSWORD);

  // required + not enrolled: /totp sends them on to enrolment, the destination preserved.
  await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/launch");
  await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible();
  // The secret is in the <pre> under "Can't scan? Enter manually" (in the DOM whether or not the <details> is open).
  const secret = ((await page.locator("details pre").textContent()) ?? "").trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  // Six labelled digit boxes (review-polish Batch B), typed through the shared helper.
  await enterTotpCode(page, generateSync({ secret }));
  await page.getByRole("button", { name: "Confirm enrollment" }).click();
  // The enrolment persists, and the page settles on the management view ("You enrolled on ..."). (The one-time
  // "enabled" panel with the recovery codes is replaced by that view as soon as the revalidated server tree
  // arrives, and the callbackUrl goes with it: a pre-existing behaviour of /account/2fa recorded as F166 in the
  // work-log, not something this spec papers over - so the next step is the post-login router, as a user would.)
  await expect(page.getByText(/you enrolled on/i)).toBeVisible({ timeout: 20_000 });
  const enrolled = (await sql`select 1 from user_totp where user_id = ${user.id}::uuid`) as unknown[];
  expect(enrolled, "the enrolment was persisted").toHaveLength(1);

  // --- landing, with authority -----------------------------------------------------------------------
  // Enrolling does not verify the session: the post-login router lands on /o/<slug>, the proxy puts the
  // 2FA challenge in front of it (destination preserved), and the new account answers it with a code from
  // the secret it just enrolled.
  await page.goto("/launch");
  await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(`/o/${o.slug}`);
  await submitTotp(page, secret);
  await page.waitForURL((url) => url.pathname === `/o/${o.slug}`, { timeout: 30_000 });
  await expect(page.getByText(o.name).first()).toBeVisible({ timeout: 15_000 });
  await page.goto(`/o/${o.slug}/admin/roles`);
  await expect(page.getByRole("heading", { level: 1, name: "Roles" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/don.t have permission to grant or revoke roles/i)).toHaveCount(0);

  // --- the link is single use: a fresh visitor gets the one dead-link page --------------------------------
  const stranger = await browser.newContext({ baseURL });
  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/invite?token=${invitation.token}`);
    await expect(strangerPage.getByRole("heading", { level: 1, name: DEAD_LINK_PHRASE })).toBeVisible();
    await expect(strangerPage.getByRole("button", { name: "Create account" })).toHaveCount(0);
  } finally {
    await stranger.close();
  }
  expect((await invitationRow(sql, invitation.id)).accepted_user_id).toBe(user.id);
});
