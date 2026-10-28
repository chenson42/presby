/**
 * sign-in-invite-fixture.ts - rows and page helpers for the two Community
 * Increment 2b e2e specs (`no-organization-connect.spec.ts` and
 * `community-sign-in-invite.spec.ts`; docs/work-log/2026-10-22-founding-admin-
 * directory.md, Phase 3 amendment 2 section 8.5, Phase 4 Batch D).
 *
 * A NEW file on purpose, not an edit to `invitation-fixture.ts`: that file is a
 * shared one (Workflow Rule 16), so nothing here changes it. It composes its
 * exports (`setupInviteOrg`, `createThrowawayUser`, `removeInviteOrg`).
 *
 * EVERYTHING HERE RUNS ON THE OWNER CONNECTION, which is fixture plumbing and
 * never application code. Two consequences the specs rely on:
 *
 *   - `people.user_id` is written directly (`linkUser`). The 0065 user-link
 *     guard binds every NON-owner role; the owner path is the documented paper
 *     residual, so a fixture can link a sender to their account.
 *   - A proven address (`users.email_verified`) is an owner-path fact since
 *     0065 (`users_guard_email_proof`); `createThrowawayUser` already stamps it.
 *
 * Every organization these specs use is a throwaway `e2e-invite-<stamp>`
 * congregation, so the invitation rows (which cannot be deleted except by that
 * cascade), the roles, the groups and the officer terms all go with it. The
 * one thing the cascade cannot take is an APPROVED roll action (the freeze
 * trigger), so `removeSignInOrg` clears the organization's roll actions first,
 * with the trigger disabled and re-enabled in a `finally`.
 *
 * GUARD TRIGGERS. `backdateInvitation` is the one place a guard trigger on
 * `account_invitations` is disabled (the cooldown is five minutes from
 * `created_at`, and `created_at` is an immutable column); the disable, the
 * update and the re-enable are one retried unit with the re-enable in `finally`.
 *
 * Everything is synthetic: `.invalid` addresses and invented names (No Real
 * Data).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { mintInvitationToken } from "../../src/lib/onboarding/invitation-token";
import { withDbRetry, type Sql } from "./db";
import {
  createThrowawayUser,
  inviteAddress,
  removeInviteOrg,
  THROWAWAY_PASSWORD,
  type InviteOrg,
} from "./invitation-fixture";
import { enterTotpCode } from "./totp-page";
import { expectPanelSurvives, recordUrls, sessionClaim } from "./enrolment-fixture";

export const COMMUNITY_FLAG = "org_portal.members_create";
export const OFFICERS_FLAG = "org_portal.officers";
export const ROLL_ACTION_EDIT_FLAG = "org_portal.members_roll_action_edit";
export const REQUIRE_2FA_FLAG = "auth.require_2fa";
export const CONNECT_TOGGLE = "org_portal.sign_in_connect";

export const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "360px", width: 360, height: 740 },
] as const;

// ---------------------------------------------------------------------------
// organization toggles
// ---------------------------------------------------------------------------

/** Writes (or, with `null`, removes) one organization toggle row. */
export async function setOrgToggle(sql: Sql, org: InviteOrg, key: string, enabled: boolean | null): Promise<void> {
  await withDbRetry(`toggle ${key}`, async () => {
    if (enabled === null) {
      await sql`delete from organization_feature_toggles where organization_id = ${org.orgId}::uuid and feature_key = ${key}`;
    } else {
      await sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
        values (${org.orgId}::uuid, ${key}, ${enabled}, null)
        on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`;
    }
  });
}

// ---------------------------------------------------------------------------
// people and accounts
// ---------------------------------------------------------------------------

export interface FixtureMember {
  personId: string;
  first: string;
  last: string;
  /** "First Last", as the Community list and the card print it. */
  name: string;
  /** The address on the record, or null for a person with none. */
  email: string | null;
}

/**
 * A person with a membership at the org and, unless `email` is null, one main
 * address on file. `engagement: 'visitor'` makes a visitor (no roll);
 * the default is a regular, active member.
 */
export async function addMember(
  sql: Sql,
  org: InviteOrg,
  input: { first: string; last: string; email: string | null; engagement?: "regular" | "visitor" | "staff" },
): Promise<FixtureMember> {
  const engagement = input.engagement ?? "regular";
  const [person] = (await sql`
    insert into people (first_name, last_name, deletable_until)
    values (${input.first}, ${input.last}, now() + interval '3 hours')
    returning id`) as { id: string }[];
  if (input.email !== null) {
    await sql`
      insert into contact_methods (person_id, kind, value, is_primary)
      values (${person.id}::uuid, 'email', ${input.email.trim().toLowerCase()}, true)`;
  }
  await sql`
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    values (${org.orgId}::uuid, ${person.id}::uuid, ${engagement},
            ${engagement === "regular" ? "active" : null})`;
  return {
    personId: person.id,
    first: input.first,
    last: input.last,
    name: `${input.first} ${input.last}`,
    email: input.email,
  };
}

/** Links an account to a person (owner path; the guard binds every other role). */
export async function linkUser(sql: Sql, personId: string, userId: string): Promise<void> {
  await withDbRetry("link user", () => sql`update people set user_id = ${userId}::uuid where id = ${personId}::uuid`);
}

export interface FixtureAccount {
  id: string;
  email: string;
  password: string;
}

/**
 * A proven, password account whose address is `inviteAddress(org, tag)`. The
 * default is the connect specs' "stamped, unlinked account": no two-factor
 * requirement, no enrolment.
 */
export async function addAccount(
  sql: Sql,
  org: InviteOrg,
  tag: string,
  options: { twoFactorRequired?: boolean; name?: string } = {},
): Promise<FixtureAccount> {
  const user = await createThrowawayUser(sql, org, {
    tag,
    name: options.name ?? "Fixture Account",
    twoFactorRequired: options.twoFactorRequired,
  });
  return { id: user.id, email: user.email, password: THROWAWAY_PASSWORD };
}

/** A custom role at the org with these permission keys, granted to one person by the person arm. */
export async function grantCustomRole(
  sql: Sql,
  org: InviteOrg,
  input: { personId: string; key: string; name: string; permissions: readonly string[]; grantedBy: string },
): Promise<string> {
  const [role] = (await sql`
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (${org.orgId}::uuid, ${input.key}, ${input.name}, 'custom', false)
    returning id`) as { id: string }[];
  for (const permission of input.permissions) {
    await sql`insert into app_role_permissions (role_id, permission_key) values (${role.id}::uuid, ${permission})`;
  }
  await sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    values (${org.orgId}::uuid, ${role.id}::uuid, ${input.personId}::uuid, date '2020-01-01', ${input.grantedBy}::uuid)`;
  return role.id;
}

/** The permissions a congregation's office holder needs to send invitations and read the Community pages. */
export const SENDER_PERMISSIONS = ["people.manage", "officers.manage", "directory.view", "roll.propose"] as const;

export interface FixtureSender extends FixtureMember {
  user: FixtureAccount;
}

/**
 * The person who sends invitations: a linked account holding `people.manage`,
 * `officers.manage`, `directory.view` and `roll.propose` by a custom role. No
 * two-factor requirement, so a password sign-in lands in the congregation.
 */
export async function addSender(
  sql: Sql,
  org: InviteOrg,
  options: { tag?: string; permissions?: readonly string[] } = {},
): Promise<FixtureSender> {
  const tag = options.tag ?? "sender";
  const user = await addAccount(sql, org, tag, { name: "Fixture Sender" });
  const member = await addMember(sql, org, { first: "Ottilie", last: `Marchbanks${tag}`, email: user.email });
  await linkUser(sql, member.personId, user.id);
  await grantCustomRole(sql, org, {
    personId: member.personId,
    key: `e2e_${tag}`.replace(/[^a-z0-9_]/g, "_"),
    name: `E2E ${tag}`,
    permissions: options.permissions ?? SENDER_PERMISSIONS,
    grantedBy: user.id,
  });
  return { ...member, user };
}

/** The baseline `member` role (directory and events, bound to Active Membership), as provisioning seeds it. */
export async function addBaselineMemberRole(sql: Sql, org: InviteOrg): Promise<void> {
  const [role] = (await sql`
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (${org.orgId}::uuid, 'member', 'Member', 'custom', false)
    returning id`) as { id: string }[];
  for (const permission of ["directory.view", "events.view"]) {
    await sql`insert into app_role_permissions (role_id, permission_key) values (${role.id}::uuid, ${permission})`;
  }
  await sql`
    insert into role_grants (organization_id, role_id, group_id, starts_on)
    select ${org.orgId}::uuid, ${role.id}::uuid, g.id, date '2020-01-01'
      from groups g where g.organization_id = ${org.orgId}::uuid and g.derived_from = 'active_membership'`;
}

/**
 * The Session group and the `session_member` role (`roll.approve` only, bound to
 * the derived group), exactly what `createOrganization` seeds for a congregation.
 */
export async function addSession(sql: Sql, org: InviteOrg): Promise<void> {
  const [group] = (await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${org.orgId}::uuid, gt.id, 'Session', 'derived', 'session', true
      from group_types gt where gt.key = 'court'
    returning id`) as { id: string }[];
  const [role] = (await sql`
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (${org.orgId}::uuid, 'session_member', 'Session member', 'custom', false)
    returning id`) as { id: string }[];
  await sql`insert into app_role_permissions (role_id, permission_key) values (${role.id}::uuid, 'roll.approve')`;
  await sql`
    insert into role_grants (organization_id, role_id, group_id, starts_on)
    values (${org.orgId}::uuid, ${role.id}::uuid, ${group.id}::uuid, date '2020-01-01')`;
}

/** A ruling-elder term in effect (the trigger materializes the Session roster). Needs `addSession` first. */
export async function seatElder(sql: Sql, org: InviteOrg, personId: string): Promise<void> {
  await sql`
    insert into officer_terms (organization_id, person_id, office, starts_on)
    values (${org.orgId}::uuid, ${personId}::uuid, 'ruling_elder', date '2020-01-01')`;
}

/**
 * A member proposal waiting for the Session: a new person with a regular
 * membership and no roll, and a PENDING profession of faith proposed by `proposerUserId`
 * (what the Add person wizard writes for a Member). Returns the person and the roll action.
 */
export async function addProposal(
  sql: Sql,
  org: InviteOrg,
  proposerUserId: string,
  input: { first: string; last: string; effectiveDate?: string },
): Promise<{ personId: string; rollActionId: string; name: string }> {
  const [person] = (await sql`
    insert into people (first_name, last_name, deletable_until)
    values (${input.first}, ${input.last}, now() + interval '3 hours')
    returning id`) as { id: string }[];
  await sql`
    insert into memberships (organization_id, person_id, engagement_status)
    values (${org.orgId}::uuid, ${person.id}::uuid, 'regular')`;
  const [action] = (await sql`
    insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, proposed_by)
    values (${org.orgId}::uuid, ${person.id}::uuid, 'profession_of_faith', ${input.effectiveDate ?? "2026-06-01"}::date,
            'active', 'pending', ${proposerUserId}::uuid)
    returning id`) as { id: string }[];
  return { personId: person.id, rollActionId: action.id, name: `${input.first} ${input.last}` };
}

/**
 * Accepts an invitation as the account itself through the same definer the
 * running app calls (owner connection), so a spec gets a REAL founding
 * administrator - the role, the clerk office, the staff membership and the link -
 * without driving the pages. Returns the outcome literal.
 */
export async function acceptAsAccount(sql: Sql, token: string, userId: string): Promise<string> {
  const rows = (await sql`
    select outcome from presby_accept_invitation(${token}::text, ${userId}::uuid, null, null, null)`) as { outcome: string }[];
  return rows[0]?.outcome ?? "none";
}

// ---------------------------------------------------------------------------
// sign-in invitations (the congregation's own, purpose 'sign_in', origin 'org')
// ---------------------------------------------------------------------------

export interface SeededSignIn {
  id: string;
  token: string;
  tokenHash: string;
}

/**
 * Seeds an OPEN sign-in invitation with a KNOWN token (the raw token never
 * exists in the database; only its sha256 hex does). A sign-in row names its
 * person, carries no invitee names, and is `origin 'org'`. `resentFromId` +
 * `resendCount` build a chain row (the parent must already be superseded).
 */
export async function seedSignInInvitation(
  sql: Sql,
  org: InviteOrg,
  input: {
    personId: string;
    address: string;
    createdByUserId: string;
    resentFromId?: string;
    resendCount?: number;
    expiresInDays?: number;
    /** The queued email this row points at (immutable once set, so it is given at insert). */
    emailQueueId?: string;
  },
): Promise<SeededSignIn> {
  if (!/\.invalid$/.test(input.address)) throw new Error(`[sign-in-invite-fixture] refusing a non-.invalid address "${input.address}"`);
  const { token, tokenHash } = mintInvitationToken();
  const [row] = (await sql`
    insert into account_invitations
      (organization_id, purpose, origin, email_normalized, person_id, token_hash, created_by_user_id,
       expires_at, resent_from_id, resend_count, email_queue_id)
    values (${org.orgId}::uuid, 'sign_in', 'org', ${input.address.toLowerCase()}, ${input.personId}::uuid,
            ${tokenHash}, ${input.createdByUserId}::uuid, now() + (${input.expiresInDays ?? 7} * interval '1 day'),
            ${input.resentFromId ?? null}, ${input.resendCount ?? 0}, ${input.emailQueueId ?? null})
    returning id`) as { id: string }[];
  return { id: row.id, token, tokenHash };
}

/** Marks an open invitation superseded (the legal transition a resend performs on its parent). */
export async function supersedeInvitation(sql: Sql, id: string): Promise<void> {
  await withDbRetry("supersede invitation", () => sql`update account_invitations set superseded_at = now() where id = ${id}::uuid`);
}

/** Revokes an open invitation (the owner-path transition `revokeSignInInvitation` performs through the definer). */
export async function revokeInvitation(sql: Sql, id: string, byUserId: string): Promise<void> {
  await withDbRetry(
    "revoke invitation",
    () => sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${byUserId}::uuid where id = ${id}::uuid`,
  );
}

/**
 * Moves an invitation's `created_at` into the past so the five-minute resend
 * cooldown has run. `created_at` is an immutable column, so the update guard is
 * disabled for the one statement, as ONE retried unit with the re-enable in a
 * `finally` (and a second `finally` after the retry, for a failed re-enable).
 */
export async function backdateInvitation(sql: Sql, id: string, minutes: number): Promise<void> {
  try {
    await withDbRetry("backdate invitation", async () => {
      try {
        await sql`alter table account_invitations disable trigger account_invitations_guard_update`;
        await sql`
          update account_invitations
             set created_at = created_at - (${minutes} * interval '1 minute')
           where id = ${id}::uuid`;
      } finally {
        await sql`alter table account_invitations enable trigger account_invitations_guard_update`;
      }
    });
  } finally {
    await withDbRetry("re-enable invitation guard", () => sql`alter table account_invitations enable trigger account_invitations_guard_update`);
  }
}

export interface InvitationState {
  id: string;
  purpose: string;
  origin: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
  revoked_at: string | null;
  superseded_at: string | null;
  blocked_at: string | null;
  resend_count: number;
  resent_from_id: string | null;
  email_queue_id: string | null;
  person_id: string | null;
}

/** Every invitation row at the org, oldest first. */
export async function invitationsAt(sql: Sql, org: InviteOrg): Promise<InvitationState[]> {
  return (await withDbRetry("list invitations", () => sql`
    select id, purpose, origin, accepted_at, accepted_user_id, revoked_at, superseded_at, blocked_at,
           resend_count, resent_from_id, email_queue_id, person_id
      from account_invitations where organization_id = ${org.orgId}::uuid
     order by created_at, id`)) as InvitationState[];
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

export interface AuditRowOut {
  action: string;
  actor_user_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
}

/** Audit rows of one action whose metadata names this organization, oldest first. */
export async function auditAt(sql: Sql, org: InviteOrg, action: string): Promise<AuditRowOut[]> {
  return (await withDbRetry("read audit", () => sql`
    select action, actor_user_id, resource_type, resource_id, metadata
      from audit_events
     where action = ${action}
       and (metadata->>'organizationId' = ${org.orgId} or resource_id = ${org.orgId})
     order by created_at, id`)) as AuditRowOut[];
}

/** The audit rows an action wrote for one resource id (a person, an invitation, a user), oldest first. */
export async function auditFor(sql: Sql, action: string, resourceId: string): Promise<AuditRowOut[]> {
  return (await withDbRetry("read audit by resource", () => sql`
    select action, actor_user_id, resource_type, resource_id, metadata
      from audit_events where action = ${action} and resource_id = ${resourceId}
     order by created_at, id`)) as AuditRowOut[];
}

/** The person linked to this account anywhere (the connect specs ask "is it linked yet?"). */
export async function personOfUser(sql: Sql, userId: string): Promise<string | null> {
  const rows = (await withDbRetry("person of user", () => sql`select id from people where user_id = ${userId}::uuid`)) as { id: string }[];
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

/**
 * `removeInviteOrg`, after clearing the roll actions the organization holds. An
 * approved roll action is frozen by trigger and the org's cascade cannot delete
 * it; the freeze trigger is disabled for the delete only, as one retried unit
 * with the re-enable in a `finally` (the community fixture's idiom).
 */
export async function removeSignInOrg(sql: Sql, org: InviteOrg | undefined): Promise<void> {
  if (!org) return;
  // The sign-in emails a real send queued: `email_queue_id` is a plain uuid (no FK, so no cascade) and the shared
  // teardown clears only the platform designation's template. A crashed earlier run's rows go too (guarded by the
  // fixture address shape: only `e2e-invite-*@example.invalid` recipients).
  await withDbRetry("delete queued sign-in mail", () => sql`
    delete from email_queue
     where template_key = 'account_sign_in_invitation'
       and (id in (select email_queue_id from account_invitations
                    where organization_id = ${org.orgId}::uuid and email_queue_id is not null)
            or (to_email like 'e2e-invite-%@example.invalid' and created_at < now() - interval '1 hour'))`);
  try {
    await withDbRetry("clear org roll actions", async () => {
      try {
        await sql`alter table roll_actions disable trigger roll_actions_freeze`;
        await sql`delete from roll_actions where organization_id = ${org.orgId}::uuid and kind = 'void'`;
        await sql`delete from roll_actions where organization_id = ${org.orgId}::uuid`;
      } finally {
        await sql`alter table roll_actions enable trigger roll_actions_freeze`;
      }
    });
  } finally {
    await withDbRetry("re-enable roll freeze", () => sql`alter table roll_actions enable trigger roll_actions_freeze`);
  }
  await removeInviteOrg(sql, org);
}

// ---------------------------------------------------------------------------
// page helpers
// ---------------------------------------------------------------------------

/** Nothing scrolls sideways. */
export async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);
}

/** Every locator is a tap target of at least 44px in height. */
export async function expectTargets44(...targets: Locator[]): Promise<void> {
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box, "target is on screen").not.toBeNull();
    expect(box!.height, `${await target.innerText().catch(() => "target")} is at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
}

/** Signs in through the real form and waits for the first URL that matches `landing`. */
export async function signInAs(page: Page, account: FixtureAccount, landing: RegExp | ((url: URL) => boolean), callbackPath?: string): Promise<void> {
  await page.goto(callbackPath ? `/signin?callbackUrl=${encodeURIComponent(callbackPath)}` : "/signin");
  const email = page.locator('input[name="email"]');
  await expect(email).toBeEnabled({ timeout: 30_000 });
  await email.fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL(landing, { timeout: 45_000 });
}

/**
 * Enrols two-factor sign-in on `/account/2fa` and returns the secret that was
 * accepted. The code is typed through the shared helper; the sixth digit
 * confirms the enrolment by itself (DECISION-257), so nothing is pressed.
 *
 * F166 (DECISION-292): a first enrolment ends on the one-time recovery-codes
 * panel, which survives the server-action re-render, and the session is marked
 * verified through the two-factor grant. This helper waits for that panel, proves
 * it survives the re-render (the management view's "You enrolled on" never takes
 * its place) and that the session now reports `twoFactorVerified`. It does NOT
 * press Continue: the caller does, so it can assert where Continue lands.
 *
 * The former reload-and-retry for the stale-secret race is gone: F342 (0.46.2)
 * fixed the race, so a refused code now fails here loudly instead of being
 * retried (TODO: the `enrolOnPage` workaround line).
 */
export async function enrolOnPage(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible({ timeout: 30_000 });
  const secret = ((await page.locator("details pre").textContent()) ?? "").trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await enterTotpCode(page, generateSync({ secret }));
  await expect(page.getByRole("heading", { level: 1, name: "Two-factor authentication enabled" })).toBeVisible({ timeout: 45_000 });
  await expectPanelSurvives(page);
  expect((await sessionClaim(page)).twoFactorVerified, "enrolment verified the session (F166)").toBe(true);
  return secret;
}

/**
 * Presses the codes panel's Continue and waits for `landing`, returning every
 * main-frame URL visited on the way so a caller can assert there was no `/totp`
 * hop. Continue carries the server-sanitized `callbackUrl` (`expectedHref`).
 */
export async function continueFromCodesPanel(
  page: Page,
  expectedHref: string,
  landing: (url: URL) => boolean,
): Promise<string[]> {
  const cont = page.getByRole("link", { name: "Continue" });
  await expect(cont).toHaveAttribute("href", expectedHref);
  const urls = recordUrls(page);
  await cont.click();
  await page.waitForURL(landing, { timeout: 45_000 });
  expect(
    urls.filter((u) => new URL(u).pathname === "/totp"),
    "no second challenge after enrolling (F166)",
  ).toEqual([]);
  return urls;
}

export { inviteAddress, THROWAWAY_PASSWORD };
