/**
 * A throwaway-tenant harness for the DB-backed account-invitation suites
 * (`src/lib/db/domain/invitations.db.test.ts`,
 * `src/lib/onboarding/designation-parity.db.test.ts`, and Batch 2's
 * `issue.ts` / `accept.ts` suites). TEST SUPPORT ONLY - never imported by
 * application code.
 *
 * Built on `createCalendarFixture()` (organizations stamped
 * `deletable_until`, the derived Active Membership group, people, roles,
 * grants). Invitation rows need nothing of their own at teardown: deleting the
 * fixture org cascades to them, which `account_invitations_guard_delete`
 * permits because the parent organization is gone (drizzle/0059 section 3c).
 *
 * What this adds:
 *   - `mintToken()`: 32 random bytes base64url and its sha256 hex - the same
 *     shape `src/lib/onboarding/invitation-token.ts` mints (Batch 2a), so the
 *     SQL-side `encode(sha256(convert_to(token,'UTF8')),'hex')` agrees.
 *   - `insertInvitation()`: an OPEN row on the owner connection (the only
 *     writer in Increment 1 is issue.ts on getPlatformDb()).
 *   - `accept()` / `preview()`: the two definer functions called THROUGH THE
 *     presby_app CONNECTION (`db`), exactly as accept.ts will.
 *   - `cleanup()`: also removes the people and users that ACCEPTANCE created
 *     (production code, so not stamped at insert: `deletable_until` is set at
 *     teardown, the documented exception in fixture-deletable.ts).
 *
 * Every database module is imported INSIDE the functions (the calendar
 * fixture's rule). The calling test must `vi.mock("server-only")` itself.
 * Names are synthetic and every address is `example.invalid` (No Real Data).
 */
import { createHash, randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { createCalendarFixture, type FixtureOrgOptions } from "./calendar-fixture";

export type Row = Record<string, unknown>;

export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

/** 32 random bytes, base64url (43 chars), and its sha256 hex. */
export function mintToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A syntactically valid bcrypt string (the function checks shape only). */
export const FAKE_BCRYPT = `$2b$10$${"a".repeat(53)}`;

export interface InvitationInput {
  organizationId: string;
  purpose: "founding_administrator" | "treasurer";
  email: string;
  createdByUserId: string;
  firstName?: string | null;
  lastName?: string | null;
  personId?: string | null;
  /** Default now() + 7 days. */
  expiresAt?: SQL;
  /** Default now(). Backdate to build an expired row. */
  createdAt?: SQL;
  resentFromId?: string | null;
  resendCount?: number;
}

export interface AcceptInput {
  userId?: string | null;
  passwordHash?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export async function createInvitationFixture(label: string) {
  const base = await createCalendarFixture(label);
  const { platform } = base;
  const { db } = await import("@/lib/db");
  const appDb = db;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  let counter = 0;
  const userIds: string[] = [];
  const extraOrgIds: string[] = [];

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await platform.execute(query));
  }

  /** A unique example.invalid address for this run. */
  function email(tag: string): string {
    counter += 1;
    return `${label}-${tag}-${stamp}-${counter}@example.invalid`.toLowerCase();
  }

  async function makeUser(
    address: string,
    options: { isActive?: boolean; name?: string } = {},
  ): Promise<string> {
    const [row] = await q(sql`
      insert into users (email, name, is_active)
      values (${address}, ${options.name ?? "Invitation Fixture User"}, ${options.isActive ?? true})
      returning id`);
    const id = String(row!.id);
    userIds.push(id);
    return id;
  }

  /** Track a user that production code (acceptance) created. */
  function trackUser(id: string | null | undefined) {
    if (id && !userIds.includes(id)) userIds.push(id);
  }

  async function addEmail(personId: string, address: string): Promise<void> {
    await q(sql`
      insert into contact_methods (person_id, kind, value, is_primary)
      values (${personId}, 'email', ${address}, true)`);
  }

  async function linkUser(personId: string, userId: string): Promise<void> {
    await q(sql`update people set user_id = ${userId} where id = ${personId}`);
  }

  /** An org created WITHOUT the derived Active Membership group (provisioning_incomplete). */
  async function makeBareOrg(name: string, organizationType: FixtureOrgOptions["organizationType"] = "congregation") {
    counter += 1;
    const slug = `${label}-${name}-${stamp}-${counter}`.toLowerCase();
    const [row] = await q(sql`
      insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
      values (${organizationType ?? "congregation"}, ${`Fixture ${name} for ${label}`}, ${slug},
              ${slug.replace(/-/g, "_")}, 'unmanaged', now() + interval '2 hours')
      returning id`);
    const id = String(row!.id);
    extraOrgIds.push(id);
    return id;
  }

  async function insertInvitation(input: InvitationInput): Promise<{ id: string; token: string; tokenHash: string }> {
    const { token, tokenHash } = mintToken();
    const [row] = await q(sql`
      insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
             invitee_last_name, person_id, token_hash, created_by_user_id, created_at, expires_at,
             resent_from_id, resend_count)
      values (${input.organizationId}, ${input.purpose}, ${input.email},
              ${input.firstName === undefined ? (input.purpose === "founding_administrator" ? "Invited" : null) : input.firstName},
              ${input.lastName === undefined ? (input.purpose === "founding_administrator" ? "Person" : null) : input.lastName},
              ${input.personId ?? null}, ${tokenHash}, ${input.createdByUserId},
              ${input.createdAt ?? sql`now()`}, ${input.expiresAt ?? sql`now() + interval '7 days'`},
              ${input.resentFromId ?? null}, ${input.resendCount ?? 0})
      returning id`);
    return { id: String(row!.id), token, tokenHash };
  }

  async function invitation(id: string): Promise<Row> {
    const [row] = await q(sql`select * from account_invitations where id = ${id}`);
    return row!;
  }

  /** presby_accept_invitation through the presby_app connection, in its own committed transaction. */
  async function accept(token: string | null, input: AcceptInput): Promise<Row> {
    const row = await appDb.transaction(async (tx) => {
      const result = await tx.execute(sql`
        select * from presby_accept_invitation(${token}::text, ${input.userId ?? null}::uuid,
               ${input.passwordHash ?? null}::text, ${input.firstName ?? null}::text, ${input.lastName ?? null}::text)`);
      return rowsOf(result)[0]!;
    });
    trackUser(row.user_id as string | null);
    return row;
  }

  /** presby_preview_invitation through the presby_app connection. */
  async function preview(token: string | null, userId?: string | null): Promise<Row[]> {
    return rowsOf(
      await appDb.execute(sql`select * from presby_preview_invitation(${token}::text, ${userId ?? null}::uuid)`),
    );
  }

  /**
   * Every row an acceptance could touch, scoped to one org and one address,
   * so "nothing written" is an equality of two snapshots.
   */
  async function snapshot(organizationId: string, address: string): Promise<Row> {
    const [row] = await q(sql`
      select
        (select count(*) from users where lower(email) = lower(${address}))::int as users,
        (select count(*) from people p join users u on u.id = p.user_id where lower(u.email) = lower(${address}))::int as linked_people,
        (select count(*) from memberships where organization_id = ${organizationId})::int as memberships,
        (select count(*) from memberships where organization_id = ${organizationId} and ended_on is not null)::int as ended_memberships,
        (select count(*) from role_grants where organization_id = ${organizationId})::int as role_grants,
        (select count(*) from app_roles where organization_id = ${organizationId})::int as app_roles,
        (select count(*) from app_roles where organization_id = ${organizationId} and deactivated_at is null)::int as active_roles,
        (select count(*) from app_role_permissions arp join app_roles r on r.id = arp.role_id
          where r.organization_id = ${organizationId})::int as role_permissions,
        (select count(*) from contact_methods cm join memberships m on m.person_id = cm.person_id
          where m.organization_id = ${organizationId} and cm.verified_at is not null)::int as verified_contacts,
        (select count(*) from people p join memberships m on m.person_id = p.id
          where m.organization_id = ${organizationId} and p.user_id is not null)::int as linked_members,
        (select count(*) from groups where organization_id = ${organizationId}
          and derived_from = 'active_membership')::int as derived_groups`);
    return row!;
  }

  async function cleanup() {
    // People acceptance created or linked to a tracked user: stamp at
    // teardown (production code made them), then delete after the orgs are
    // gone (role_grants / memberships reference them until then).
    const createdPeople = userIds.length
      ? await q(sql`select id from people where user_id in (${sql.join(userIds.map((u) => sql`${u}::uuid`), sql`, `)})`)
      : [];

    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    try {
      for (const id of extraOrgIds) {
        await platform.execute(sql`delete from organizations where id = ${id}`);
      }
    } finally {
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
    }
    await base.cleanup();

    for (const r of createdPeople) {
      await platform.execute(sql`update people set deletable_until = now() + interval '2 hours' where id = ${String(r.id)}`);
      await platform.execute(sql`delete from people where id = ${String(r.id)}`);
    }
    for (const id of userIds) {
      await platform.execute(sql`delete from users where id = ${id}`);
    }
  }

  return {
    ...base,
    appDb,
    q,
    email,
    makeUser,
    trackUser,
    addEmail,
    linkUser,
    makeBareOrg,
    insertInvitation,
    invitation,
    accept,
    preview,
    snapshot,
    cleanup,
  };
}

export type InvitationFixture = Awaited<ReturnType<typeof createInvitationFixture>>;
