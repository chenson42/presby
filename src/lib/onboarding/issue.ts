import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { people } from "@/lib/db/domain/people";
import { accountInvitations, type AccountInvitationPurpose } from "@/lib/db/domain/invitations";
import { AUDIT_ACTIONS, insertAuditRow, type AuditActor } from "@/lib/audit-tx";
import { attemptQueuedSend, cancelQueuedEmail, insertQueueRowInTx } from "@/lib/email/queue";
import { isTotpConfigured } from "@/lib/two-factor";
import { platformOrigin } from "@/lib/domains/host";
import { treasurerDesignationApplies } from "./treasurer-designation";
import type { RevokeAllScope } from "./sign-in-types";
import { mintInvitationToken } from "./invitation-token";
import {
  ACCOUNT_INVITATION_TEMPLATE_KEY,
  renderInvitationEmail,
} from "./invitation-email";
import { deriveInvitationStatus, deliveryState, type DeliveryState, type InvitationStatus } from "./status";
import {
  deriveInviteeDisplayName,
  type InvitationCopyPurpose,
  type InvitationWarningCode,
} from "./invitation-copy";
import {
  UUID_RE,
  normalizeInvitationEmail,
  normalizePersonName,
} from "./input";

/**
 * The ISSUE side of an account invitation: create, resend, revoke,
 * revoke-all and list (DECISION-183/186/189, docs/work-log/2026-10-21-
 * invitations.md Phase 2 R2/R4/R8, Phase 3, Phase 2 addendum D-1/D-2).
 *
 * CONNECTION: `getPlatformDb()` ONLY, and this module is imported only from
 * `(admin)` code (a source-scan test holds that line, the `src/lib/giving/`
 * idiom). The caller is a platform operator acting on a tenant, the same
 * reasoning as the designation modules this feature retires: a platform
 * operator has no `personId` to hand `withOrgContext()`, and fabricating one
 * is the phantom-membership violation Two Hierarchies forbids. The ACCEPT side
 * (`accept.ts`) is the opposite: presby_app only, never this connection.
 *
 * WHAT A SEND NEVER DOES: it never reads `users`. The operator's screen is
 * identical whether or not the address has an account (the enumeration
 * defence, S2: under C1 "no enumeration" is UI uniformity for platform
 * senders). Every refusal describes the organization or the roster, never
 * account existence.
 *
 * ONE OPERATOR-RULED ADDITION (2026-10-23, person-emails pipeline): a created
 * invitation carries a NON-BLOCKING warning when the address is on file for a
 * person on THIS organization's roster who already signs in
 * (`people.user_id` set), because acceptance would then be refused as
 * `person_linked_elsewhere` unless the invitee is that person's own account.
 * It reads the person's link column on the roster, scoped to this
 * organization, and still never reads `users`; it blocks nothing and writes
 * nothing. Production hit it: adding a second address to the operator's own
 * record silently re-targeted a treasurer invitation at them.
 *
 * LOCK ORDER, every writer here and in `presby_accept_invitation`:
 * organization row -> invitation row -> users row -> person. Each mutation
 * below opens by locking the organization row `for update`, so every
 * invitation write for an org serializes (acceptable at this volume) and the
 * durable limits are evaluated inside the lock.
 *
 * ATOMICITY (R4): the invitation row, its `email_queue` row and the link
 * between them (`email_queue_id`, set at insert and immutable, D-8) and the
 * audit row commit in ONE transaction. The provider call happens AFTER the
 * commit (`attemptQueuedSend`); if it fails the row stays `queued` for the
 * worker and the caller is told delivery is delayed. Audit rows are inserted
 * with `insertAuditRow(tx, ...)` in the same transaction, never `recordAudit()`
 * (which opens its own connection and swallows failures): a failed audit
 * insert fails the change.
 *
 * INSERT RULES the 0059 `BEFORE INSERT` guard enforces and this file obeys:
 * rows are born open; a founding-administrator row names NO person at insert;
 * a resend points at a SUPERSEDED parent with the same purpose, address and
 * person and `resend_count = parent + 1`. Hence resend order: supersede the old
 * row FIRST (which frees both partial unique indexes), then insert the new one.
 *
 * A `unique_violation` on either partial index
 * (`account_invitations_open_designation_uq` or `_open_address_uq`, matched by
 * CONSTRAINT NAME) is `already_pending`, never `db_error` (D-2).
 *
 * Audit metadata is ids only: never the token, its hash or the address.
 *
 * PLATFORM ROWS ONLY (Community Increment 2b, F198). Since 0065 the table also
 * holds a congregation's own sign-in invitations (`origin = 'org'`, sent by a
 * `people.manage` holder through `org-invite.ts`). This module never sees them
 * except through the two doors that are deliberately about them:
 *   - `revokeAllOpenInvitations({ scope: "org_sent" })`, the platform's kill
 *     lever for a congregation that abuses invitations; and
 *   - `summarizeOrgSentInvitations()`, a MASKED panel (first character of the
 *     local part, the domain, a status; no name, no full address).
 * Every other read and write here is bounded to `origin = 'platform'`: the three
 * durable-limit counts (a congregation's sends must not spend the platform's
 * budget, nor the reverse), resend and revoke (a congregation's row is
 * `not_found` to a platform operator), and the organization's list.
 */

// ---------------------------------------------------------------------------
// Constants (one block: DECISION-189)
// ---------------------------------------------------------------------------

/** Default and maximum lifetime. The table CHECK caps at 30 days. */
export const INVITATION_EXPIRY_DAYS = 7;

/** Durable limits, counted on `account_invitations` INCLUDING superseded and
 * revoked rows so churn cannot dodge them (G7). Rolling 24 hours. */
export const INVITATION_LIMITS = {
  perInviterPer24h: 20,
  perOrganizationPer24h: 10,
  perAddressPer24h: 3,
  /** A resend is refused until this long after the latest row was created. */
  resendCooldownMinutes: 5,
  /** The table CHECK `resend_count between 0 and 5` is the same number. */
  maxResendsPerChain: 5,
} as const;

const OPEN_DESIGNATION_INDEXES = new Set([
  "account_invitations_open_designation_uq",
  "account_invitations_open_address_uq",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlatformDb = ReturnType<typeof getPlatformDb>;
type PlatformTx = Parameters<Parameters<PlatformDb["transaction"]>[0]>[0];

export interface InvitationActor {
  userId: string;
  email: string | null;
}

/** A non-blocking note on a created invitation. */
export type InvitationWarning = InvitationWarningCode;

export interface CreateInvitationInput {
  organizationId: string;
  purpose: AccountInvitationPurpose;
  email: string;
  /** Required for `founding_administrator`; ignored for `treasurer`. */
  firstName?: string;
  lastName?: string;
  inviter: InvitationActor;
  acknowledgeDoNotContact?: boolean;
}

export type CreateInvitationResult =
  | {
      kind: "ok";
      invitationId: string;
      expiresAt: Date;
      delivery: "sent" | "queued";
      selfAddressed: boolean;
      /**
       * Who must accept, for the operator's success notice: the founding
       * administrator's typed name, or the treasurer's roster FIRST NAME only.
       * Null only if the data to derive it is missing.
       */
      inviteeDisplayName: string | null;
      /** Present only when non-empty. The invitation WAS created and sent. */
      warnings?: InvitationWarning[];
    }
  | { kind: "has_holders" }
  | { kind: "already_pending"; invitationId: string | null; expired: boolean }
  | { kind: "not_applicable" }
  | { kind: "provisioning_incomplete" }
  | { kind: "no_matching_person" }
  | { kind: "ambiguous_person" }
  | { kind: "membership_ended" }
  | { kind: "needs_acknowledgement"; reason: "do_not_contact" }
  | { kind: "totp_unavailable" }
  | { kind: "link_origin_unavailable" }
  | { kind: "invalid_input"; field: "organizationId" | "email" | "firstName" | "lastName" | "purpose" }
  | { kind: "rate_limited" }
  | { kind: "db_error" };

export type ResendInvitationResult =
  | {
      kind: "ok";
      invitationId: string;
      expiresAt: Date;
      delivery: "sent" | "queued";
      /** As on a create: the founding administrator's name, or the treasurer's first name. */
      inviteeDisplayName: string | null;
    }
  | { kind: "not_found" }
  | { kind: "not_open" }
  | { kind: "has_holders" }
  | { kind: "link_origin_unavailable" }
  | { kind: "rate_limited" }
  | { kind: "db_error" };

export type RevokeInvitationResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "not_open" }
  | { kind: "db_error" };

export type RevokeAllResult = { kind: "ok"; revoked: number } | { kind: "db_error" };

export interface InvitationListRow {
  id: string;
  purpose: AccountInvitationPurpose;
  /** Full address, shown to platform admins only while `redactedAt` is null. */
  email: string | null;
  inviteeFirstName: string | null;
  inviteeLastName: string | null;
  /**
   * Who the invitation is for: the founding administrator's typed name, or the
   * treasurer's roster FIRST NAME only. Server-derived; null when unavailable.
   */
  inviteeDisplayName: string | null;
  personId: string | null;
  status: InvitationStatus;
  delivery: DeliveryState;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  /** Accepted by the same user who sent it. */
  selfDesignated: boolean;
  blockedReason: string | null;
  resendCount: number;
  /** For an open row: the earliest moment a resend is allowed. Else null. */
  canResendAt: Date | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** Error CLASS only, for logs: never the message (it can carry values). */
function errorClass(err: unknown): string {
  const code = codeOf(err) ?? codeOf((err as { cause?: unknown } | null)?.cause);
  const name = err instanceof Error ? err.name : typeof err;
  return code ? `${name}/${code}` : name;
}

function codeOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

/** The violated constraint name of a Postgres unique violation (walks `.cause`). */
export function uniqueViolationConstraint(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (codeOf(current) === "23505") {
      const constraint = (current as { constraint?: unknown }).constraint;
      return typeof constraint === "string" ? constraint : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function isOpenDesignationViolation(err: unknown): boolean {
  const constraint = uniqueViolationConstraint(err);
  return constraint !== null && OPEN_DESIGNATION_INDEXES.has(constraint);
}

function auditActor(actor: InvitationActor): AuditActor {
  return { userId: actor.userId, email: actor.email };
}

async function lockOrganization(
  tx: PlatformTx,
  organizationId: string,
): Promise<{ id: string; organizationType: string; name: string } | null> {
  const result = await tx.execute(sql`
    select id, organization_type, name
      from organizations
     where id = ${organizationId}::uuid
       for update
  `);
  const row = rowsOf<{ id: string; organization_type: string; name: string }>(result)[0];
  return row ? { id: row.id, organizationType: row.organization_type, name: row.name } : null;
}

async function holderCount(
  tx: PlatformTx,
  purpose: AccountInvitationPurpose,
  organizationId: string,
): Promise<number> {
  const result =
    purpose === "founding_administrator"
      ? await tx.execute(
          sql`select presby_founding_administrator_holder_count(${organizationId}::uuid) as n`,
        )
      : await tx.execute(
          sql`select presby_giving_manage_holder_count(${organizationId}::uuid) as n`,
        );
  return Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0);
}

/** Baseline provisioning that acceptance needs, checked at send so the operator hears early. */
async function provisioningComplete(
  tx: PlatformTx,
  purpose: AccountInvitationPurpose,
  organizationId: string,
  organizationType: string,
): Promise<boolean> {
  // Both baseline groups: Active Membership (the membership sync raises
  // without it, F16) and All Current Records (the sync raises without it
  // since drizzle/0066, and the calendar baseline is bound to it). The
  // database pairs them by trigger, so a missing one means a hand-built
  // organization; the operator hears at send, not at acceptance.
  const group = await tx.execute(sql`
    select count(distinct derived_from)::int as n from groups
     where organization_id = ${organizationId}::uuid
       and derived_from in ('active_membership', 'all_memberships')
  `);
  if (Number(rowsOf<{ n: number }>(group)[0]?.n ?? 0) !== 2) return false;
  if (purpose === "founding_administrator") return true;
  // Treasurer: both role templates in scope for the org type must exist.
  const templates = await tx.execute(sql`
    select count(distinct key)::int as n
      from app_roles
     where organization_id is null
       and key in ('treasurer', 'giving_recorder')
       and (organization_type_scope is null or organization_type_scope::text = ${organizationType})
  `);
  return Number(rowsOf<{ n: number }>(templates)[0]?.n ?? 0) === 2;
}

type TreasurerPerson =
  | { kind: "ok"; personId: string; firstName: string }
  | { kind: "no_matching_person" | "ambiguous_person" | "membership_ended" };

/**
 * C6: the treasurer is resolved from a person ALREADY at this organization,
 * found by the email on file, never by account. Exact normalized match, live
 * (not merged) people with a membership here; exactly one with an ACTIVE
 * membership. No fuzzy matching.
 */
async function resolveTreasurerPerson(
  tx: PlatformTx,
  organizationId: string,
  email: string,
): Promise<TreasurerPerson> {
  const result = await tx.execute(sql`
    select distinct on (p.id) p.id as person_id, p.first_name, (m.ended_on is null) as active
      from contact_methods cm
      join people p on p.id = cm.person_id and p.merged_into_id is null
      join memberships m on m.person_id = p.id and m.organization_id = ${organizationId}::uuid
     where cm.kind = 'email'
       and cm.ended_at is null
       and lower(btrim(cm.value)) = ${email}
     order by p.id
  `);
  const rows = rowsOf<{ person_id: string; first_name: string; active: boolean }>(result);
  if (rows.length === 0) return { kind: "no_matching_person" };
  const active = rows.filter((r) => r.active);
  if (active.length > 1) return { kind: "ambiguous_person" };
  if (active.length === 0) return { kind: "membership_ended" };
  return { kind: "ok", personId: active[0]!.person_id, firstName: active[0]!.first_name };
}

/** G19: a `do_not_contact` address is transactional here, so warn, never block. */
async function hasDoNotContact(
  tx: PlatformTx,
  organizationId: string,
  email: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select 1 as ok
      from contact_methods cm
      join memberships m on m.person_id = cm.person_id and m.organization_id = ${organizationId}::uuid
     where cm.kind = 'email'
       and cm.ended_at is null
       and lower(btrim(cm.value)) = ${email}
       and cm.do_not_contact
     limit 1
  `);
  return rowsOf(result).length > 0;
}

/**
 * The operator-ruled warning (see the header): an ACTIVE address on a live
 * person on this organization's roster whose `people.user_id` is set. Same
 * match predicate acceptance uses for a founding administrator (active address,
 * live person, a membership here), so a warning means acceptance would be
 * refused for any account but that person's own. Reads `people.user_id` only;
 * never `users`.
 */
async function addressOnSignedInPerson(
  tx: PlatformTx,
  organizationId: string,
  email: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select 1 as ok
      from contact_methods cm
      join people p on p.id = cm.person_id and p.merged_into_id is null and p.user_id is not null
      join memberships m on m.person_id = p.id and m.organization_id = ${organizationId}::uuid
     where cm.kind = 'email'
       and cm.ended_at is null
       and lower(btrim(cm.value)) = ${email}
     limit 1
  `);
  return rowsOf(result).length > 0;
}

/**
 * The durable limits (R8). Evaluated inside the organization lock. Counts
 * every PLATFORM-origin row regardless of state (a congregation's sign-in sends
 * have their own, separate counters in the issue definer, F198), over a rolling
 * 24 hours bounded ABOVE by `now()`: the dev seed carries rows dated 2099 and
 * they must never count.
 * Returns true when any limit is reached.
 */
async function overLimits(
  tx: PlatformTx,
  input: { inviterUserId: string; organizationId: string; email: string },
): Promise<boolean> {
  const result = await tx.execute(sql`
    select
      (select count(*) from account_invitations
        where created_by_user_id = ${input.inviterUserId}::uuid and origin = 'platform'
          and created_at > now() - interval '24 hours' and created_at <= now())::int as inviter_n,
      (select count(*) from account_invitations
        where organization_id = ${input.organizationId}::uuid and origin = 'platform'
          and created_at > now() - interval '24 hours' and created_at <= now())::int as org_n,
      (select count(*) from account_invitations
        where email_normalized = ${input.email} and origin = 'platform'
          and created_at > now() - interval '24 hours' and created_at <= now())::int as address_n
  `);
  const row = rowsOf<{ inviter_n: number; org_n: number; address_n: number }>(result)[0]!;
  return (
    Number(row.inviter_n) >= INVITATION_LIMITS.perInviterPer24h ||
    Number(row.org_n) >= INVITATION_LIMITS.perOrganizationPer24h ||
    Number(row.address_n) >= INVITATION_LIMITS.perAddressPer24h
  );
}

/**
 * Narrow a row's purpose to the two this module handles. A platform-origin row
 * can only carry one of them (the `purpose = 'sign_in'` <=> `origin = 'org'`
 * tie is a CHECK), and every query here is bounded to platform rows, so a
 * `sign_in` purpose reaching this is a defect: throw, which rolls the work back.
 */
function designationPurpose(purpose: AccountInvitationPurpose): InvitationCopyPurpose {
  if (purpose === "founding_administrator" || purpose === "treasurer") return purpose;
  throw new Error("issue.ts handled a congregation-sent invitation");
}

function newExpiry(): Date {
  return new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

async function readOpenDesignation(
  organizationId: string,
  purpose: AccountInvitationPurpose,
): Promise<{ id: string; expired: boolean } | null> {
  const [row] = await getPlatformDb()
    .select({ id: accountInvitations.id, expiresAt: accountInvitations.expiresAt })
    .from(accountInvitations)
    .where(
      and(
        eq(accountInvitations.organizationId, organizationId),
        eq(accountInvitations.purpose, purpose),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.revokedAt),
        isNull(accountInvitations.supersededAt),
        isNull(accountInvitations.blockedAt),
      ),
    )
    .limit(1);
  return row ? { id: row.id, expired: row.expiresAt.getTime() <= Date.now() } : null;
}

/** The post-commit provider attempt. Never throws; failure means "queued". */
async function sendAfterCommit(queueId: string): Promise<"sent" | "queued"> {
  try {
    const { sentInline } = await attemptQueuedSend(queueId);
    return sentInline ? "sent" : "queued";
  } catch (err) {
    console.error("[invitations] post-commit send attempt failed:", errorClass(err));
    return "queued";
  }
}

// ---------------------------------------------------------------------------
// createInvitation
// ---------------------------------------------------------------------------

type CreateTxOutcome =
  | { kind: "org_missing" }
  | {
      kind: "created";
      invitationId: string;
      queueId: string;
      expiresAt: Date;
      inviteeDisplayName: string | null;
      selfAddressed: boolean;
      warnings: InvitationWarning[];
    }
  | Exclude<CreateInvitationResult, { kind: "ok" } | { kind: "db_error" } | { kind: "invalid_input" } | { kind: "link_origin_unavailable" }>;

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  // --- validate before any database call -----------------------------------
  if (!UUID_RE.test(input.organizationId)) return { kind: "invalid_input", field: "organizationId" };
  if (input.purpose !== "founding_administrator" && input.purpose !== "treasurer") {
    return { kind: "invalid_input", field: "purpose" };
  }
  const email = normalizeInvitationEmail(input.email);
  if (email === null) return { kind: "invalid_input", field: "email" };

  let firstName: string | null = null;
  let lastName: string | null = null;
  if (input.purpose === "founding_administrator") {
    firstName = normalizePersonName(input.firstName);
    if (firstName === null) return { kind: "invalid_input", field: "firstName" };
    lastName = normalizePersonName(input.lastName);
    if (lastName === null) return { kind: "invalid_input", field: "lastName" };
  }

  // An unset or invalid production origin refuses the send (a link built from
  // anything else is phishable). Checked before the lock; the render below
  // uses the same function.
  if (platformOrigin() === null) return { kind: "link_origin_unavailable" };

  const { token, tokenHash } = mintInvitationToken();
  const expiresAt = newExpiry();
  const inviterEmail = normalizeInvitationEmail(input.inviter.email);
  const selfAddressed = inviterEmail !== null && inviterEmail === email;

  try {
    const outcome = await getPlatformDb().transaction(async (tx): Promise<CreateTxOutcome> => {
      const org = await lockOrganization(tx, input.organizationId);
      if (!org) return { kind: "org_missing" };

      if (input.purpose === "treasurer" && !treasurerDesignationApplies(org.organizationType)) {
        return { kind: "not_applicable" };
      }

      if ((await holderCount(tx, input.purpose, org.id)) > 0) return { kind: "has_holders" };

      if (!(await provisioningComplete(tx, input.purpose, org.id, org.organizationType))) {
        return { kind: "provisioning_incomplete" };
      }

      // Treasurer: the person comes FIRST (C6), before anything is created.
      let personId: string | null = null;
      let greetingName: string | null = firstName;
      if (input.purpose === "treasurer") {
        const person = await resolveTreasurerPerson(tx, org.id, email);
        if (person.kind !== "ok") return { kind: person.kind };
        personId = person.personId;
        greetingName = person.firstName;
      }

      // Both invitation purposes grant a key flagged requires_two_factor (the
      // treasurer's giving keys, the founding administrator's roles.manage and
      // role_grants.manage; DECISION-291), so an unconfigured deployment would
      // strand either invitee at the 2FA wall (D-4, G8). The new account's own
      // column is false by default; the ROLE is the reason.
      if (!isTotpConfigured()) return { kind: "totp_unavailable" };

      if (!input.acknowledgeDoNotContact && (await hasDoNotContact(tx, org.id, email))) {
        return { kind: "needs_acknowledgement", reason: "do_not_contact" };
      }

      // Non-blocking (operator ruling, see the header): never changes the
      // outcome, only rides on the ok result.
      const warnings: InvitationWarning[] = (await addressOnSignedInPerson(tx, org.id, email))
        ? ["address_on_signed_in_person"]
        : [];

      // One open designation per (org, purpose). The partial unique indexes
      // are the database form; this read is the friendly path.
      const [open] = await tx
        .select({ id: accountInvitations.id, expiresAt: accountInvitations.expiresAt })
        .from(accountInvitations)
        .where(
          and(
            eq(accountInvitations.organizationId, org.id),
            eq(accountInvitations.purpose, input.purpose),
            isNull(accountInvitations.acceptedAt),
            isNull(accountInvitations.revokedAt),
            isNull(accountInvitations.supersededAt),
            isNull(accountInvitations.blockedAt),
          ),
        )
        .limit(1);
      if (open) {
        return {
          kind: "already_pending",
          invitationId: open.id,
          expired: open.expiresAt.getTime() <= Date.now(),
        };
      }

      if (await overLimits(tx, { inviterUserId: input.inviter.userId, organizationId: org.id, email })) {
        return { kind: "rate_limited" };
      }

      const rendered = renderInvitationEmail({
        firstName: greetingName,
        organizationName: org.name,
        purpose: input.purpose,
        token,
        expiresAt,
      });
      if (!rendered) throw new Error("link origin vanished between check and render");

      const queued = await insertQueueRowInTx(tx, {
        to: email,
        message: rendered.message,
        templateKey: ACCOUNT_INVITATION_TEMPLATE_KEY,
      });

      const [created] = await tx
        .insert(accountInvitations)
        .values({
          organizationId: org.id,
          purpose: input.purpose,
          emailNormalized: email,
          inviteeFirstName: firstName,
          inviteeLastName: lastName,
          personId,
          tokenHash,
          createdByUserId: input.inviter.userId,
          expiresAt,
          emailQueueId: queued.id,
        })
        .returning({ id: accountInvitations.id });

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.INVITATION_CREATED,
        actor: auditActor(input.inviter),
        resourceType: "account_invitation",
        resourceId: created!.id,
        metadata: {
          invitationId: created!.id,
          organizationId: org.id,
          purpose: input.purpose,
          personId,
          expiresAt: expiresAt.toISOString(),
          selfAddressed,
          acknowledgedDoNotContact: input.acknowledgeDoNotContact === true,
        },
      });

      return {
        kind: "created",
        invitationId: created!.id,
        queueId: queued.id,
        expiresAt,
        selfAddressed,
        warnings,
        inviteeDisplayName: deriveInviteeDisplayName({
          purpose: designationPurpose(input.purpose),
          firstName,
          lastName,
          rosterFirstName: input.purpose === "treasurer" ? greetingName : null,
        }),
      };
    });

    if (outcome.kind === "org_missing") return { kind: "invalid_input", field: "organizationId" };
    if (outcome.kind !== "created") return outcome;

    const delivery = await sendAfterCommit(outcome.queueId);
    return {
      kind: "ok",
      invitationId: outcome.invitationId,
      expiresAt: outcome.expiresAt,
      delivery,
      selfAddressed: outcome.selfAddressed,
      inviteeDisplayName: outcome.inviteeDisplayName,
      ...(outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {}),
    };
  } catch (err) {
    if (isOpenDesignationViolation(err)) {
      const open = await readOpenDesignation(input.organizationId, input.purpose).catch(() => null);
      return {
        kind: "already_pending",
        invitationId: open?.id ?? null,
        expired: open?.expired ?? false,
      };
    }
    console.error("[invitations] create failed:", errorClass(err));
    return { kind: "db_error" };
  }
}

// ---------------------------------------------------------------------------
// resendInvitation
// ---------------------------------------------------------------------------

type OpenRow = {
  id: string;
  purpose: AccountInvitationPurpose;
  email_normalized: string | null;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  person_id: string | null;
  email_queue_id: string | null;
  resend_count: number;
  created_at: string | Date;
};

type ResendTxOutcome =
  | {
      kind: "created";
      invitationId: string;
      queueId: string;
      expiresAt: Date;
      inviteeDisplayName: string | null;
    }
  | Exclude<ResendInvitationResult, { kind: "ok" } | { kind: "db_error" } | { kind: "link_origin_unavailable" }>;

export async function resendInvitation(input: {
  organizationId: string;
  invitationId: string;
  actor: InvitationActor;
}): Promise<ResendInvitationResult> {
  if (!UUID_RE.test(input.organizationId) || !UUID_RE.test(input.invitationId)) {
    return { kind: "not_found" };
  }
  if (platformOrigin() === null) return { kind: "link_origin_unavailable" };

  const { token, tokenHash } = mintInvitationToken();
  const expiresAt = newExpiry();

  try {
    const outcome = await getPlatformDb().transaction(async (tx): Promise<ResendTxOutcome> => {
      // Lock order: organization -> invitation.
      const org = await lockOrganization(tx, input.organizationId);
      if (!org) return { kind: "not_found" };

      const found = rowsOf<OpenRow & {
        accepted_at: unknown; revoked_at: unknown; superseded_at: unknown; blocked_at: unknown;
      }>(
        await tx.execute(sql`
          select id, purpose, email_normalized, invitee_first_name, invitee_last_name, person_id,
                 email_queue_id, resend_count, created_at,
                 accepted_at, revoked_at, superseded_at, blocked_at
            from account_invitations
           where id = ${input.invitationId}::uuid
             and organization_id = ${org.id}::uuid
             and origin = 'platform'
             for update
        `),
      )[0];
      if (!found) return { kind: "not_found" };
      if (found.accepted_at || found.revoked_at || found.superseded_at || found.blocked_at) {
        return { kind: "not_open" };
      }
      if (found.email_normalized === null) return { kind: "not_open" };
      const email = found.email_normalized;

      // A holder appeared meanwhile: a new link would only be blocked at accept.
      if ((await holderCount(tx, found.purpose, org.id)) > 0) return { kind: "has_holders" };

      // Cooldown from the head of the chain (this row, being open), and the
      // per-chain cap. One literal for every limit cause.
      const createdAtMs = new Date(found.created_at).getTime();
      if (Date.now() - createdAtMs < INVITATION_LIMITS.resendCooldownMinutes * 60 * 1000) {
        return { kind: "rate_limited" };
      }
      if (found.resend_count >= INVITATION_LIMITS.maxResendsPerChain) return { kind: "rate_limited" };
      if (await overLimits(tx, { inviterUserId: input.actor.userId, organizationId: org.id, email })) {
        return { kind: "rate_limited" };
      }

      // The greeting name: the invitee's own name (founding administrator), or
      // the roster person's first name (treasurer).
      let greetingName = found.invitee_first_name;
      let rosterFirstName: string | null = null;
      if (found.purpose === "treasurer" && found.person_id) {
        const person = rowsOf<{ first_name: string }>(
          await tx.execute(sql`select first_name from people where id = ${found.person_id}::uuid`),
        )[0];
        greetingName = person?.first_name ?? null;
        rosterFirstName = greetingName;
      }

      const rendered = renderInvitationEmail({
        firstName: greetingName,
        organizationName: org.name,
        purpose: found.purpose,
        token,
        expiresAt,
      });
      if (!rendered) throw new Error("link origin vanished between check and render");

      // 1. SUPERSEDE FIRST: frees both partial unique indexes for the successor
      //    (D-2: reversing this order violates the designation index).
      await tx
        .update(accountInvitations)
        .set({ supersededAt: sql`now()` })
        .where(eq(accountInvitations.id, found.id));

      // 2. The old email, if it has not left yet, is cancelled in the same
      //    transaction (one already `processing` arrives dead).
      if (found.email_queue_id) await cancelQueuedEmail(tx, found.email_queue_id);

      // 3. The successor: new token, new queue row, lineage, count + 1.
      const queued = await insertQueueRowInTx(tx, {
        to: email,
        message: rendered.message,
        templateKey: ACCOUNT_INVITATION_TEMPLATE_KEY,
      });
      const [created] = await tx
        .insert(accountInvitations)
        .values({
          organizationId: org.id,
          purpose: found.purpose,
          emailNormalized: email,
          inviteeFirstName: found.invitee_first_name,
          inviteeLastName: found.invitee_last_name,
          personId: found.person_id,
          tokenHash,
          createdByUserId: input.actor.userId,
          expiresAt,
          emailQueueId: queued.id,
          resentFromId: found.id,
          resendCount: found.resend_count + 1,
        })
        .returning({ id: accountInvitations.id });

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.INVITATION_RESENT,
        actor: auditActor(input.actor),
        resourceType: "account_invitation",
        resourceId: created!.id,
        metadata: {
          invitationId: created!.id,
          supersededInvitationId: found.id,
          organizationId: org.id,
          purpose: found.purpose,
          resendCount: found.resend_count + 1,
        },
      });

      return {
        kind: "created",
        invitationId: created!.id,
        queueId: queued.id,
        expiresAt,
        inviteeDisplayName: deriveInviteeDisplayName({
          purpose: designationPurpose(found.purpose),
          firstName: found.invitee_first_name,
          lastName: found.invitee_last_name,
          rosterFirstName,
        }),
      };
    });

    if (outcome.kind !== "created") return outcome;
    const delivery = await sendAfterCommit(outcome.queueId);
    return {
      kind: "ok",
      invitationId: outcome.invitationId,
      expiresAt: outcome.expiresAt,
      delivery,
      inviteeDisplayName: outcome.inviteeDisplayName,
    };
  } catch (err) {
    if (isOpenDesignationViolation(err)) return { kind: "not_open" };
    console.error("[invitations] resend failed:", errorClass(err));
    return { kind: "db_error" };
  }
}

// ---------------------------------------------------------------------------
// revokeInvitation / revokeAllOpenInvitations
// ---------------------------------------------------------------------------

type RevocableRow = {
  id: string;
  purpose: AccountInvitationPurpose;
  email_queue_id: string | null;
};

/** Revoke one locked, open row inside the caller's transaction. */
async function revokeRow(
  tx: PlatformTx,
  row: RevocableRow,
  organizationId: string,
  actor: InvitationActor,
  via: "single" | "revoke_all",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await tx
    .update(accountInvitations)
    .set({ revokedAt: sql`now()`, revokedByUserId: actor.userId })
    .where(eq(accountInvitations.id, row.id));
  if (row.email_queue_id) await cancelQueuedEmail(tx, row.email_queue_id);
  await insertAuditRow(tx, {
    action: AUDIT_ACTIONS.INVITATION_REVOKED,
    actor: auditActor(actor),
    resourceType: "account_invitation",
    resourceId: row.id,
    metadata: { invitationId: row.id, organizationId, purpose: row.purpose, via, ...extra },
  });
}

export async function revokeInvitation(input: {
  organizationId: string;
  invitationId: string;
  actor: InvitationActor;
}): Promise<RevokeInvitationResult> {
  if (!UUID_RE.test(input.organizationId) || !UUID_RE.test(input.invitationId)) {
    return { kind: "not_found" };
  }
  try {
    return await getPlatformDb().transaction(async (tx): Promise<RevokeInvitationResult> => {
      const org = await lockOrganization(tx, input.organizationId);
      if (!org) return { kind: "not_found" };
      const row = rowsOf<RevocableRow & {
        accepted_at: unknown; revoked_at: unknown; superseded_at: unknown; blocked_at: unknown;
      }>(
        await tx.execute(sql`
          select id, purpose, email_queue_id, accepted_at, revoked_at, superseded_at, blocked_at
            from account_invitations
           where id = ${input.invitationId}::uuid
             and organization_id = ${org.id}::uuid
             and origin = 'platform'
             for update
        `),
      )[0];
      if (!row) return { kind: "not_found" };
      if (row.accepted_at || row.revoked_at || row.superseded_at || row.blocked_at) {
        return { kind: "not_open" };
      }
      await revokeRow(tx, row, org.id, input.actor, "single");
      return { kind: "ok" };
    });
  } catch (err) {
    console.error("[invitations] revoke failed:", errorClass(err));
    return { kind: "db_error" };
  }
}

/** Which origin each scope revokes (F198: one lever per origin, never a mixed one). */
const SCOPE_ORIGIN: Record<RevokeAllScope, "platform" | "org"> = {
  designations: "platform",
  org_sent: "org",
};

/** The abuse takedown and the kill lever: revoke every open invitation of an org, within one scope. Refunds no limit. */
export async function revokeAllOpenInvitations(input: {
  organizationId: string;
  actor: InvitationActor;
  scope: RevokeAllScope;
}): Promise<RevokeAllResult> {
  if (!UUID_RE.test(input.organizationId)) return { kind: "ok", revoked: 0 };
  const origin = SCOPE_ORIGIN[input.scope];
  if (origin === undefined) return { kind: "db_error" };
  try {
    return await getPlatformDb().transaction(async (tx): Promise<RevokeAllResult> => {
      const org = await lockOrganization(tx, input.organizationId);
      if (!org) return { kind: "ok", revoked: 0 };
      const open = rowsOf<RevocableRow>(
        await tx.execute(sql`
          select id, purpose, email_queue_id
            from account_invitations
           where organization_id = ${org.id}::uuid
             and origin = ${origin}
             and accepted_at is null and revoked_at is null
             and superseded_at is null and blocked_at is null
           order by created_at
             for update
        `),
      );
      for (const row of open) {
        await revokeRow(
          tx,
          row,
          org.id,
          input.actor,
          "revoke_all",
          input.scope === "org_sent" ? { scope: "org_sent" } : {},
        );
      }
      return { kind: "ok", revoked: open.length };
    });
  } catch (err) {
    console.error("[invitations] revoke-all failed:", errorClass(err));
    return { kind: "db_error" };
  }
}

// ---------------------------------------------------------------------------
// listInvitationsForOrg
// ---------------------------------------------------------------------------

/**
 * Every non-superseded PLATFORM invitation of an organization (a congregation's
 * own sign-in invitations are summarized by `summarizeOrgSentInvitations`,
 * masked), newest first, with derived status and the delivery state joined from
 * `email_queue`. Platform admins see the full address while `redacted_at` is
 * null. Superseded rows are replaced by their successor and never listed.
 */
export async function listInvitationsForOrg(organizationId: string): Promise<InvitationListRow[]> {
  if (!UUID_RE.test(organizationId)) return [];
  const now = new Date();
  const rows = await getPlatformDb()
    .select({
      inv: accountInvitations,
      // The treasurer's invitation stores only `personId`; the roster person's
      // first name is what the list and the notice show. Platform connection.
      rosterFirstName: people.firstName,
      queueStatus: emailQueue.status,
      deliveredAt: emailQueue.deliveredAt,
      bouncedAt: emailQueue.bouncedAt,
      complainedAt: emailQueue.complainedAt,
    })
    .from(accountInvitations)
    .leftJoin(emailQueue, eq(emailQueue.id, accountInvitations.emailQueueId))
    .leftJoin(people, eq(people.id, accountInvitations.personId))
    .where(
      and(
        eq(accountInvitations.organizationId, organizationId),
        eq(accountInvitations.origin, "platform"),
        isNull(accountInvitations.supersededAt),
      ),
    )
    .orderBy(desc(accountInvitations.createdAt));

  return rows.map(({ inv, rosterFirstName, queueStatus, deliveredAt, bouncedAt, complainedAt }) => {
    const status = deriveInvitationStatus(inv, now) as InvitationStatus;
    const open = status === "pending" || status === "expired";
    return {
      id: inv.id,
      purpose: inv.purpose,
      email: inv.redactedAt ? null : inv.emailNormalized,
      inviteeFirstName: inv.inviteeFirstName,
      inviteeLastName: inv.inviteeLastName,
      inviteeDisplayName: deriveInviteeDisplayName({
        purpose: designationPurpose(inv.purpose),
        firstName: inv.inviteeFirstName,
        lastName: inv.inviteeLastName,
        rosterFirstName,
      }),
      personId: inv.personId,
      status,
      delivery: deliveryState(
        queueStatus === null
          ? null
          : { status: queueStatus, deliveredAt, bouncedAt, complainedAt },
      ),
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      selfDesignated: inv.acceptedUserId !== null && inv.acceptedUserId === inv.createdByUserId,
      blockedReason: inv.blockedReason,
      resendCount: inv.resendCount,
      canResendAt: open
        ? new Date(inv.createdAt.getTime() + INVITATION_LIMITS.resendCooldownMinutes * 60 * 1000)
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// summarizeOrgSentInvitations (the platform's masked view of a congregation's own sends)
// ---------------------------------------------------------------------------

export interface OrgSentInvitationRow {
  id: string;
  status: InvitationStatus;
  /**
   * `m***@example.org`: the first character of the local part, `***@`, the
   * domain. Masked IN SQL (the full address never reaches this code), null once
   * the address was redacted. No person name, ever: a platform operator holds no
   * tenant authority over a congregation's people.
   */
  maskedAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface OrgSentSummary {
  counts: Record<InvitationStatus, number>;
  /** What "Cancel all open sign-in invitations" would revoke: pending plus expired-but-not-closed. */
  revocable: number;
  /** Non-superseded rows, newest first. */
  rows: OrgSentInvitationRow[];
}

/**
 * The platform's view of a congregation's own sign-in invitations: counts by
 * derived status and one masked row each (Phase 3, F198). Platform connection,
 * `origin = 'org'` rows only.
 */
export async function summarizeOrgSentInvitations(organizationId: string): Promise<OrgSentSummary> {
  const counts: Record<InvitationStatus, number> = {
    pending: 0,
    accepted: 0,
    expired: 0,
    revoked: 0,
    blocked: 0,
  };
  if (!UUID_RE.test(organizationId)) return { counts, revocable: 0, rows: [] };
  const now = new Date();
  const found = await getPlatformDb()
    // Named columns, never the whole row: the full address and the token hash
    // must not reach this process at all ("masked in SQL" means exactly that).
    .select({
      id: accountInvitations.id,
      createdAt: accountInvitations.createdAt,
      expiresAt: accountInvitations.expiresAt,
      acceptedAt: accountInvitations.acceptedAt,
      revokedAt: accountInvitations.revokedAt,
      supersededAt: accountInvitations.supersededAt,
      blockedAt: accountInvitations.blockedAt,
      masked: sql<string | null>`case
        when ${accountInvitations.redactedAt} is not null or ${accountInvitations.emailNormalized} is null then null
        else left(${accountInvitations.emailNormalized}, 1) || '***@' || split_part(${accountInvitations.emailNormalized}, '@', 2)
      end`,
    })
    .from(accountInvitations)
    .where(
      and(
        eq(accountInvitations.organizationId, organizationId),
        eq(accountInvitations.origin, "org"),
        isNull(accountInvitations.supersededAt),
      ),
    )
    .orderBy(desc(accountInvitations.createdAt));

  const rows: OrgSentInvitationRow[] = found.map((r) => {
    const status = deriveInvitationStatus(r, now) as InvitationStatus;
    counts[status] += 1;
    return { id: r.id, status, maskedAddress: r.masked, createdAt: r.createdAt, expiresAt: r.expiresAt };
  });
  return { counts, revocable: counts.pending + counts.expired, rows };
}
