/**
 * invitation-fixture.ts - a throwaway congregation (and throwaway accounts) for
 * the account-invitation e2e specs (docs/work-log/2026-10-21-invitations.md,
 * Phase 3 "E2E blast radius" and Phase 4 Batch 4; DECISION-157: assert-and-throw
 * guards, not comments).
 *
 * WHY A THROWAWAY ORGANIZATION. Invitation rows cannot be deleted by anyone
 * except the cascade of their organization (`account_invitations_guard_delete`),
 * and the durable per-inviter / per-organization / per-address limits would make
 * repeated runs fail on a permanent fixture. So every spec that creates or seeds
 * an invitation builds its own congregation (`deletable_until`-stamped,
 * `e2e-invite-<stamp>` slug) and removes it at the end; the cascade takes the
 * invitations, grants and memberships with it. Same idiom as
 * `e2e/support/domains-ui-fixture.ts`, whose retry and sweep helpers are reused.
 *
 * WHAT TEARDOWN ALSO REMOVES, AND WHAT IT CANNOT.
 *   - People: every person with a membership at the org (a founding-administrator
 *     acceptance CREATES one, as production code, so `deletable_until` is stamped
 *     at teardown - the documented exception, `src/lib/testing/fixture-deletable.ts`).
 *     That includes the person an acceptance created for a PERMANENT fixture user
 *     (`mfa-enrolled`): a leftover membership would change that user's post-login
 *     landing for every later spec (`/o/<slug>` or `/home`, not `/admin`), which is
 *     why `sweepStaleInvitationFixtures` also runs from globalSetup.
 *   - Users: only those whose address starts with this run's own
 *     `e2e-invite-<stamp>-` prefix and ends `@example.invalid` (the throwaway
 *     "existing" account and the accepted new account). Never a roster user.
 *   - NOT audit rows: `audit_events` is append-only; a run's invitation audit rows
 *     stay (their actor_user_id becomes null when a throwaway user is deleted).
 *     Specs therefore identify their rows by invitation id, never by count.
 *
 * Nothing here imports application modules except the dependency-free token
 * helper (`invitation-token.ts`: `node:crypto` only), which is the one seam the
 * seeded token and the SQL-side `sha256(convert_to(token,'UTF8'))` share.
 * Everything is synthetic: `.invalid` addresses, invented names (No Real Data).
 */
import bcrypt from "bcryptjs";
import { mintInvitationToken } from "../../src/lib/onboarding/invitation-token";
import type { Sql } from "./db";
import { withDbRetry } from "./domains-ui-fixture";
import { E2E_USERS, type E2ERole } from "./users";

export const INVITE_NAMES = {
  org: "E2E Invitation Church",
  /** The founding administrator's invitation names (a NEW person at the org). */
  first: "Rosalind",
  last: "Thistlewood",
  /** The roster person a treasurer invitation resolves to. */
  rosterFirst: "Bartholomew",
  rosterLast: "Quillfeather",
} as const;

/** The throwaway "existing" account's password. Not a secret: a throwaway `.invalid` account. */
export const THROWAWAY_PASSWORD = "e2e-invite-throwaway-not-a-secret";

export interface InviteOrg {
  orgId: string;
  slug: string;
  name: string;
  stamp: number;
  /** Every fixture-created address for this run starts with this (guarded at delete). */
  emailPrefix: string;
}

const SLUG_RE = /^e2e-invite-\d+$/;
const EMAIL_RE_OK = /\.invalid$/;

function assertFixtureOrg(org: { slug: string; emailPrefix?: string }): void {
  if (!SLUG_RE.test(org.slug)) {
    throw new Error(`[invitation-fixture] refusing to touch non-fixture organization slug "${org.slug}"`);
  }
}

function assertFixtureAddress(address: string): void {
  if (!EMAIL_RE_OK.test(address)) {
    throw new Error(`[invitation-fixture] refusing a non-.invalid address "${address}"`);
  }
}

/** An address unique to this run, ending `@example.invalid`. */
export function inviteAddress(org: InviteOrg, tag: string): string {
  return `${org.emailPrefix}${tag}@example.invalid`;
}

export async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const rows = (await sql`select id from users where email = ${email}`) as { id: string }[];
  if (!rows[0]) throw new Error(`[invitation-fixture] no user row for ${email}; globalSetup must run first`);
  return rows[0].id;
}

export async function rosterUserId(sql: Sql, role: E2ERole): Promise<string> {
  return userIdByEmail(sql, E2E_USERS[role].email);
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

/**
 * A congregation with the derived Active Membership group (the baseline an
 * acceptance requires: without it the accept blocks `provisioning_incomplete`),
 * no administrator and no giving.manage holder. Sweeps stale fixtures first
 * (unless `sweep: false`, for a second org built beside a live one).
 */
export async function setupInviteOrg(
  sql: Sql,
  opts: { stamp?: number; sweep?: boolean } = {},
): Promise<InviteOrg> {
  // A spec that builds a SECOND org alongside its first passes `sweep: false`, or the sweep would remove the first.
  if (opts.sweep !== false) await sweepStaleInvitationFixtures(sql);
  const stamp = opts.stamp ?? Date.now();
  const slug = `e2e-invite-${stamp}`;
  assertFixtureOrg({ slug });
  // Unique per run: the id never repeats, so a leaked row can never collide with the next run's.
  const orgId = `e2e95001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;

  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${INVITE_NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
  return { orgId, slug, name: INVITE_NAMES.org, stamp, emailPrefix: `e2e-invite-${stamp}-` };
}

/**
 * A roster person at the org with a primary email on file and an active
 * membership (what a treasurer invitation resolves, C6 / F159).
 */
export async function addRosterPerson(
  sql: Sql,
  org: InviteOrg,
  input: { first: string; last: string; email: string },
): Promise<string> {
  assertFixtureOrg(org);
  assertFixtureAddress(input.email);
  const [person] = (await sql`
    insert into people (first_name, last_name, deletable_until)
    values (${input.first}, ${input.last}, now() + interval '3 hours')
    returning id`) as { id: string }[];
  await sql`
    insert into contact_methods (person_id, kind, value, is_primary)
    values (${person.id}::uuid, 'email', ${input.email}, true)`;
  await sql`
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    values (${org.orgId}::uuid, ${person.id}::uuid, 'regular', 'active')`;
  return person.id;
}

/**
 * A throwaway account that signs in with a password and needs no 2FA - the
 * "existing account, no MFA" invitee (Case A). Deleted at teardown (its address
 * carries this run's prefix).
 */
export async function createThrowawayUser(
  sql: Sql,
  org: InviteOrg,
  input: { tag: string; name: string; twoFactorRequired?: boolean },
): Promise<{ id: string; email: string; password: string }> {
  assertFixtureOrg(org);
  const email = inviteAddress(org, input.tag);
  assertFixtureAddress(email);
  const hash = await bcrypt.hash(THROWAWAY_PASSWORD, 10);
  const [row] = (await sql`
    insert into users (email, name, password, email_verified, is_active, two_factor_required)
    values (${email}, ${input.name}, ${hash}, now(), true, ${input.twoFactorRequired ?? false})
    returning id`) as { id: string }[];
  return { id: row.id, email, password: THROWAWAY_PASSWORD };
}

export interface SeededInvitation {
  id: string;
  token: string;
  tokenHash: string;
  email: string;
}

/**
 * Seeds an OPEN invitation with a KNOWN token (the raw token never exists in the
 * database; only its sha256 hex does). `createdByUserId` is the sender - pass the
 * invitee's own id for a self-designation. A founding-administrator row carries
 * the invitee names and no person; a treasurer row names the roster person.
 */
export async function seedInvitation(
  sql: Sql,
  org: InviteOrg,
  input: {
    purpose: "founding_administrator" | "treasurer";
    email: string;
    createdByUserId: string;
    firstName?: string;
    lastName?: string;
    personId?: string;
  },
): Promise<SeededInvitation> {
  assertFixtureOrg(org);
  assertFixtureAddress(input.email);
  const { token, tokenHash } = mintInvitationToken();
  const fa = input.purpose === "founding_administrator";
  const [row] = (await sql`
    insert into account_invitations
      (organization_id, purpose, email_normalized, invitee_first_name, invitee_last_name,
       person_id, token_hash, created_by_user_id, expires_at)
    values (${org.orgId}::uuid, ${input.purpose}, ${input.email.toLowerCase()},
            ${fa ? (input.firstName ?? INVITE_NAMES.first) : null},
            ${fa ? (input.lastName ?? INVITE_NAMES.last) : null},
            ${input.personId ?? null}, ${tokenHash}, ${input.createdByUserId}::uuid,
            now() + interval '7 days')
    returning id`) as { id: string }[];
  return { id: row.id, token, tokenHash, email: input.email.toLowerCase() };
}

// ---------------------------------------------------------------------------
// reading back the persisted outcome
// ---------------------------------------------------------------------------

export interface InvitationRow {
  id: string;
  purpose: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
  created_by_user_id: string;
  blocked_at: string | null;
  blocked_reason: string | null;
  revoked_at: string | null;
  person_id: string | null;
  email_queue_id: string | null;
  resend_count: number;
}

export async function invitationRow(sql: Sql, id: string): Promise<InvitationRow> {
  const rows = (await sql`
    select id, purpose, accepted_at, accepted_user_id, created_by_user_id, blocked_at, blocked_reason,
           revoked_at, person_id, email_queue_id, resend_count
      from account_invitations where id = ${id}::uuid`) as InvitationRow[];
  if (!rows[0]) throw new Error(`[invitation-fixture] invitation ${id} not found`);
  return rows[0];
}

export interface AuditRow {
  action: string;
  actor_user_id: string | null;
  actor_email: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
}

/** Every audit row that names this invitation (as `invitationId` or `viaInvitationId`), oldest first. */
export async function auditRowsFor(sql: Sql, invitationId: string): Promise<AuditRow[]> {
  return (await sql`
    select action, actor_user_id, actor_email, resource_id, metadata
      from audit_events
     where metadata->>'invitationId' = ${invitationId}
        or metadata->>'viaInvitationId' = ${invitationId}
     order by created_at, id`) as AuditRow[];
}

/** The role keys (and person) a person holds at the org through grants today. */
export async function grantedRoleKeys(sql: Sql, org: InviteOrg, personId: string): Promise<string[]> {
  const rows = (await sql`
    select r.key
      from role_grants rg join app_roles r on r.id = rg.role_id
     where rg.organization_id = ${org.orgId}::uuid and rg.person_id = ${personId}::uuid
       and rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
     order by r.key`) as { key: string }[];
  return rows.map((r) => r.key);
}

/** The person linked to a user at the org (active membership), or null. */
export async function personAtOrgFor(sql: Sql, org: InviteOrg, userId: string): Promise<string | null> {
  const rows = (await sql`
    select p.id
      from people p join memberships m on m.person_id = p.id
     where p.user_id = ${userId}::uuid and m.organization_id = ${org.orgId}::uuid and m.ended_on is null`) as { id: string }[];
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

async function removeOrgById(sql: Sql, orgId: string): Promise<void> {
  // The invitation e-mails an admin-UI send queued: `email_queue_id` is a plain uuid (no FK, so no cascade).
  // Delete exactly the invitation rows this org's invitations point at, before the cascade removes the pointers.
  await withDbRetry(
    "delete queued invitation mail",
    () => sql`
      delete from email_queue
       where template_key = 'account_invitation'
         and id in (select email_queue_id from account_invitations
                     where organization_id = ${orgId}::uuid and email_queue_id is not null)`,
  );
  const people = (await withDbRetry(
    "list fixture people",
    async () => (await sql`select distinct person_id as id from memberships where organization_id = ${orgId}::uuid`) as { id: string }[],
  ));
  // The derived-roster trigger refuses the cascade a fixture org's delete fires against its
  // group_memberships; disabled around the delete exactly as every other fixture teardown here does.
  // The whole disable/delete/enable unit is retried, so a drop between the statements can never leave it off.
  try {
    await withDbRetry(`delete org ${orgId}`, async () => {
      await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
      try {
        await sql`delete from organizations where id = ${orgId}::uuid`;
      } finally {
        await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
      }
    });
  } finally {
    await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
  }
  for (const { id } of people) {
    // Production code made some of these (acceptance), so they were not stamped at insert: stamp now.
    // Only a person with no membership left anywhere is removed (the org's were cascaded above).
    await withDbRetry(`delete person ${id}`, async () => {
      await sql`update people set deletable_until = now() + interval '1 hour' where id = ${id}::uuid`;
      await sql`delete from contact_methods where person_id = ${id}::uuid`;
      await sql`delete from people p where p.id = ${id}::uuid and not exists (select 1 from memberships m where m.person_id = p.id)`;
    });
  }
}

/** Removes every throwaway user whose address starts with the prefix (and ends `@example.invalid`). */
async function removeUsersWithPrefix(sql: Sql, prefix: string): Promise<void> {
  if (!/^e2e-invite-(\d+-)?$/.test(prefix)) {
    throw new Error(`[invitation-fixture] refusing to delete users by prefix "${prefix}"`);
  }
  const like = `${prefix}%@example.invalid`;
  await withDbRetry("delete throwaway users", () => sql`delete from users where email like ${like}`);
}

/**
 * Removes any fixture org (and throwaway users) a crashed or dropped run left.
 * Safe at any time and from globalSetup: it touches only `e2e-invite-<digits>`
 * organizations and `e2e-invite-%@example.invalid` accounts.
 */
export async function sweepStaleInvitationFixtures(sql: Sql): Promise<number> {
  const stale = await withDbRetry(
    "list stale invitation orgs",
    async () => (await sql`select id from organizations where slug ~ '^e2e-invite-[0-9]+$'`) as { id: string }[],
  );
  for (const { id } of stale) await removeOrgById(sql, id);
  await removeUsersWithPrefix(sql, "e2e-invite-");
  return stale.length;
}

/** Confirms by SELECT that nothing of the fixture survived. */
export async function removeInviteOrg(sql: Sql, org: InviteOrg | undefined): Promise<void> {
  if (!org) return;
  assertFixtureOrg(org);
  await removeOrgById(sql, org.orgId);
  await removeUsersWithPrefix(sql, org.emailPrefix);
  const left = await withDbRetry("confirm org gone", async () => (await sql`select 1 from organizations where id = ${org.orgId}::uuid`) as unknown[]);
  if (left.length > 0) throw new Error(`[invitation-fixture] ${org.slug} was not removed`);
  const inv = await withDbRetry("confirm invitations gone", async () => (await sql`select 1 from account_invitations where organization_id = ${org.orgId}::uuid`) as unknown[]);
  if (inv.length > 0) throw new Error(`[invitation-fixture] invitation rows of ${org.slug} survived its removal`);
  const users = await withDbRetry("confirm users gone", async () => (await sql`select 1 from users where email like ${`${org.emailPrefix}%`}`) as unknown[]);
  if (users.length > 0) throw new Error(`[invitation-fixture] throwaway users of ${org.slug} survived its removal`);
  // The two permanent platform-admin fixtures carry ZERO memberships by invariant (assertAdminFixtureHasNoOrgs);
  // an acceptance addressed to mfa-enrolled must not have left one behind, or its landing moves for later specs.
  const lingering = await withDbRetry("confirm no roster membership left", async () => (await sql`
    select 1 from memberships m join people p on p.id = m.person_id join users u on u.id = p.user_id
     where u.email = any(${[E2E_USERS.admin.email, E2E_USERS["mfa-enrolled"].email]})`) as unknown[]);
  if (lingering.length > 0) throw new Error(`[invitation-fixture] a platform-admin fixture still holds a membership after removing ${org.slug}`);
}
