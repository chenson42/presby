import "server-only";
import { sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, insertAuditRow, type AuditActor } from "@/lib/audit-tx";
import type {
  AccountInvitationBlockedReason,
  AccountInvitationPurpose,
} from "@/lib/db/domain/invitations";
import { isWellFormedInvitationToken } from "./invitation-token";
import {
  UUID_RE,
  normalizePersonName,
  passwordProblem,
} from "./input";

/**
 * The ACCEPT side of an account invitation (DECISION-183/188, docs/work-log/
 * 2026-10-21-invitations.md Phase 2 R1/R5/R7, Phase 3, Phase 2 addendum D-3).
 *
 * CONNECTION: `db` (presby_app) ONLY - never `getPlatformDb()`. This module is
 * reached from an anonymous, internet-facing route. presby_app holds no table
 * privilege on `account_invitations`; its only way in is EXECUTE on the two
 * SECURITY DEFINER functions called below, which take the RAW token (R5), hash
 * it in SQL, derive organization, purpose, address and person from the token's
 * own row, and set no org GUC. A source-scan test (S4) holds this line for this
 * file and everything under `src/app/(invite)/`.
 *
 * `previewInvitation` and `acceptInvitation` are the only two calls. Neither
 * ever sees the invited address in full: the preview masks it in SQL
 * (DECISION-153) and returns `session_matches` so the page can say "signed in
 * as another account" without holding it.
 *
 * D-3: the `userId` passed to `previewInvitation` comes ONLY from the `auth()`
 * session - never from form data, the query or a cookie. With it null the
 * function reads no `users` row at all (S1). The same holds for
 * `acceptInvitation`'s existing-account `userId`.
 *
 * ACCEPTANCE (R1, R7). One transaction on presby_app:
 *   1. `presby_accept_invitation(token, userId, passwordHash, first, last)`;
 *   2. the audit rows, inserted in THAT SAME transaction with `insertAuditRow`
 *      (never `recordAudit()`): a failed audit insert rolls the whole
 *      acceptance back - the account, the person, the designation and the
 *      claim - and the caller gets `db_error` with the token still live.
 *
 * VALIDATION (G17) happens BEFORE the database: names 1-100 after trim/NFC/
 * control-strip, password 8 characters minimum and 72 UTF-8 bytes maximum.
 * Validation failures are independent of the token, so they cannot act as a
 * token oracle.
 *
 * COST PARITY: for a new-account submission bcrypt (cost 10, as the reset path)
 * is computed BEFORE the token is looked up, so a dead token costs the same as
 * a live one. A malformed token is the dead bucket, after that same work.
 *
 * REFUSALS (DECISION-152 split): identity-uniform, state-honest after the
 * credential is proven. `dead` is ONE outcome for unknown / expired / revoked /
 * superseded / consumed / blocked. Honest outcomes (`account_exists`,
 * `email_mismatch`, `account_inactive`, `blocked` + reason) are returned only
 * once the token has been proven.
 *
 * IN PLACE (Community Increment 2b, R45/Q2). `acceptInvitationInPlace` is the
 * second presentation of the SAME acceptance: a proven, active account whose
 * address is the invited address accepts an open invitation from
 * `/no-organization` without the emailed link, by invitation ID. It calls
 * `presby_accept_in_place`, which runs the shared core, and writes the audit rows
 * through the SAME writer the token path uses (`writeAcceptedAudit`); the only
 * difference in a row is two extra keys, `via: "in_place"` and `secondFactor`.
 * The token path's rows are unchanged byte for byte. Identity (`userId`) and the
 * factor flag come from `auth()` in the caller (E-30): this module never reads
 * either from a request, a cookie or a payload.
 *
 * NEVER LOGGED: the token, its hash, the password, the address. `db_error`
 * logs an error class only.
 */

const BCRYPT_COST = 10;

export interface InvitationPreview {
  organizationName: string;
  organizationType: string;
  purpose: AccountInvitationPurpose;
  inviteeFirstName: string | null;
  inviteeLastName: string | null;
  /** The person the invitee will be linked to, in words ("Accepting as ..."). */
  personDisplayName: string | null;
  /** `m***@example.org`, masked in SQL. The full address never reaches this code. */
  maskedEmail: string;
  expiresAt: Date;
  /** Null when no `userId` was supplied. Otherwise whether that account owns the invited address. */
  sessionMatches: boolean | null;
}

export type AcceptMode =
  | { kind: "new_account"; firstName: string; lastName: string; password: string }
  | { kind: "existing_account"; userId: string; email: string | null };

export type AcceptResult =
  | { kind: "accepted"; mode: "new_account" | "existing_account"; organizationSlug: string }
  | { kind: "dead" }
  | { kind: "account_exists" }
  | { kind: "email_mismatch" }
  | { kind: "account_inactive" }
  | {
      kind: "blocked";
      reason: AccountInvitationBlockedReason;
      /** The purpose the blocked invitation carried: the invitee's copy depends on it (G6). */
      purpose: AccountInvitationPurpose;
      /** The congregation's public name, for the neutral "contact the office" line. Null if unreadable. */
      organizationName: string | null;
    }
  /**
   * In place only: a founding administrator, a treasurer or an authority-bearing
   * sign-in needs a confirmed second factor first. Non-terminal: the invitation
   * stays open and nothing was written.
   */
  | { kind: "needs_second_factor" }
  | { kind: "invalid_input"; field: "password" | "firstName" | "lastName" }
  | { kind: "db_error" };

/** The outcomes `presby_accept_in_place` and the token wrapper return (pinned to the migration by a test). */
export const ACCEPT_OUTCOMES = [
  "dead",
  "account_exists",
  "email_mismatch",
  "account_inactive",
  "blocked",
  "accepted",
  "needs_second_factor",
] as const;

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

function errorClass(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  const name = err instanceof Error ? err.name : typeof err;
  return code ? `${name}/${code}` : name;
}

// ---------------------------------------------------------------------------
// previewInvitation
// ---------------------------------------------------------------------------

/**
 * One `select * from presby_preview_invitation($token, $userId)`. Null for
 * every non-live state (unknown, expired, accepted, revoked, superseded,
 * blocked, redacted) - the dead-link bucket - and for a malformed token
 * (which cannot exist, so no round trip is needed).
 *
 * `userId` MUST come from the `auth()` session and nowhere else (D-3).
 */
export async function previewInvitation(
  token: string,
  userId?: string | null,
): Promise<InvitationPreview | null> {
  if (!isWellFormedInvitationToken(token)) return null;
  const sessionUserId = userId && UUID_RE.test(userId) ? userId : null;
  const rows = rowsOf(
    await db.execute(
      sql`select * from presby_preview_invitation(${token}::text, ${sessionUserId}::uuid)`,
    ),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    organizationName: String(row.organization_name),
    organizationType: String(row.organization_type),
    purpose: row.purpose as AccountInvitationPurpose,
    inviteeFirstName: (row.invitee_first_name as string | null) ?? null,
    inviteeLastName: (row.invitee_last_name as string | null) ?? null,
    personDisplayName: (row.person_display_name as string | null) ?? null,
    maskedEmail: String(row.masked_email),
    expiresAt: new Date(row.expires_at as string | Date),
    sessionMatches: row.session_matches === null || row.session_matches === undefined
      ? null
      : Boolean(row.session_matches),
  };
}

// ---------------------------------------------------------------------------
// acceptInvitation
// ---------------------------------------------------------------------------

export async function acceptInvitation(input: {
  token: string;
  mode: AcceptMode;
}): Promise<AcceptResult> {
  const { mode } = input;

  // --- validate before the database (independent of the token) --------------
  let firstName: string | null = null;
  let lastName: string | null = null;
  let passwordHash: string | null = null;
  let userId: string | null = null;

  if (mode.kind === "new_account") {
    firstName = normalizePersonName(mode.firstName);
    if (firstName === null) return { kind: "invalid_input", field: "firstName" };
    lastName = normalizePersonName(mode.lastName);
    if (lastName === null) return { kind: "invalid_input", field: "lastName" };
    if (passwordProblem(mode.password) !== null) return { kind: "invalid_input", field: "password" };
    // Cost parity: hashed BEFORE the token is looked up.
    passwordHash = await hash(mode.password, BCRYPT_COST);
  } else {
    if (!UUID_RE.test(mode.userId)) return { kind: "dead" };
    userId = mode.userId;
  }

  if (!isWellFormedInvitationToken(input.token)) return { kind: "dead" };

  const actorEmail = mode.kind === "existing_account" ? mode.email : null;

  try {
    const after: AfterCommit = {};
    const result = await db.transaction(async (tx): Promise<AcceptResult> => {
      const queried = await tx.execute(sql`
        select * from presby_accept_invitation(
          ${input.token}::text, ${userId}::uuid, ${passwordHash}::text,
          ${firstName}::text, ${lastName}::text)
      `);
      const row = rowsOf(queried)[0];
      if (!row) throw new Error("presby_accept_invitation returned no row");
      return handleOutcome(tx, row, { presentation: "token", actorEmail }, after);
    });
    return await withOrganizationName(result, after);
  } catch (err) {
    console.error("[invitations] accept failed:", errorClass(err));
    return { kind: "db_error" };
  }
}

// ---------------------------------------------------------------------------
// acceptInvitationInPlace (R45): the second presentation of the same acceptance
// ---------------------------------------------------------------------------

export async function acceptInvitationInPlace(input: {
  invitationId: string;
  /** From `auth()` only (E-30). */
  userId: string;
  /** The session's address, for the audit actor only. */
  email: string | null;
  /** From `session.user.twoFactorVerified === true` only (E-30, DECISION-230). */
  secondFactorVerified: boolean;
}): Promise<AcceptResult> {
  // A malformed id or user is the dead bucket, with no round trip: the id is a
  // selection, not an oracle, and every identity miss looks like a dead link.
  if (!UUID_RE.test(input.invitationId) || !UUID_RE.test(input.userId)) return { kind: "dead" };
  const factor = input.secondFactorVerified === true;

  try {
    const after: AfterCommit = {};
    const result = await db.transaction(async (tx): Promise<AcceptResult> => {
      const queried = await tx.execute(sql`
        select * from presby_accept_in_place(
          ${input.invitationId}::uuid, ${input.userId}::uuid, ${factor}::boolean)
      `);
      const row = rowsOf(queried)[0];
      if (!row) throw new Error("presby_accept_in_place returned no row");
      return handleOutcome(
        tx,
        row,
        { presentation: "in_place", secondFactor: factor, actorEmail: input.email },
        after,
      );
    });
    return await withOrganizationName(result, after);
  } catch (err) {
    console.error("[invitations] accept in place failed:", errorClass(err));
    return { kind: "db_error" };
  }
}

// ---------------------------------------------------------------------------
// The shared outcome handler and the one audit writer
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type Presentation =
  | { presentation: "token"; actorEmail: string | null }
  | { presentation: "in_place"; secondFactor: boolean; actorEmail: string | null };

/** Keys an in-place row carries beyond the token path's. The token path adds none. */
function presentationKeys(p: Presentation): Record<string, unknown> {
  return p.presentation === "in_place" ? { via: "in_place", secondFactor: p.secondFactor } : {};
}

/** Facts the transaction hands to the code that runs after it commits. */
interface AfterCommit {
  blockedOrganizationId?: string;
}

async function handleOutcome(tx: Tx, row: Row, p: Presentation, after: AfterCommit): Promise<AcceptResult> {
  switch (row.outcome) {
    case "dead":
      return { kind: "dead" };
    case "account_exists":
      return { kind: "account_exists" };
    case "email_mismatch":
      return { kind: "email_mismatch" };
    case "account_inactive":
      return { kind: "account_inactive" };
    case "needs_second_factor":
      // Only the in-place presentation can ask for it. The token wrapper never
      // returns it, and an unexpected one fails closed (rolls back).
      if (p.presentation !== "in_place") {
        throw new Error("presby_accept_invitation returned an unknown outcome");
      }
      return { kind: "needs_second_factor" };

    case "blocked": {
      const actor: AuditActor = row.user_id
        ? { userId: String(row.user_id), email: p.actorEmail }
        : null;
      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.INVITATION_ACCEPT_BLOCKED,
        actor,
        resourceType: "account_invitation",
        resourceId: String(row.invitation_id),
        metadata: {
          invitationId: String(row.invitation_id),
          organizationId: String(row.organization_id),
          purpose: row.purpose,
          reason: row.blocked_reason,
        },
      });
      after.blockedOrganizationId = String(row.organization_id);
      return {
        kind: "blocked",
        reason: row.blocked_reason as AccountInvitationBlockedReason,
        purpose: row.purpose as AccountInvitationPurpose,
        organizationName: null,
      };
    }

    case "accepted": {
      await writeAcceptedAudit(tx, row, p);
      return {
        kind: "accepted",
        mode: row.mode === "new_account" ? "new_account" : "existing_account",
        organizationSlug: String(row.organization_slug),
      };
    }

    default:
      // An outcome this code does not know: fail closed, roll back.
      throw new Error("presby_accept_invitation returned an unknown outcome");
  }
}

/**
 * The congregation's public name (the organization tree is public and not
 * tenant-isolated), for the invitee's neutral blocked sentence. Read AFTER the
 * acceptance transaction has committed, on its own statement and best effort:
 * a failure inside the transaction would abort it, and the blocked outcome that
 * was just recorded must not be lost for a sentence.
 */
async function withOrganizationName(result: AcceptResult, after: AfterCommit): Promise<AcceptResult> {
  if (result.kind !== "blocked" || !after.blockedOrganizationId) return result;
  try {
    const queried = await db.execute(
      sql`select name from organizations where id = ${after.blockedOrganizationId}::uuid`,
    );
    const name = rowsOf(queried)[0]?.name;
    return { ...result, organizationName: typeof name === "string" && name.trim() ? name : null };
  } catch {
    return result;
  }
}

/**
 * The one writer of an acceptance's audit rows, for both presentations (the
 * in-place path cannot fork the token path's rows). Purpose routing is
 * EXPLICIT and exhaustive (F196's TypeScript half): `sign_in` writes
 * `invitation.accepted` and, for a new account, `user.created_via_invitation`,
 * and NO `org.*.designated` row, because it designates nobody; an unknown
 * purpose throws, which rolls the whole acceptance back.
 */
async function writeAcceptedAudit(tx: Tx, row: Row, p: Presentation): Promise<void> {
  const invitationId = String(row.invitation_id);
  const organizationId = String(row.organization_id);
  const acceptedUserId = String(row.user_id);
  const personId = String(row.person_id);
  const purpose = row.purpose as AccountInvitationPurpose;
  const acceptedMode = row.mode === "new_account" ? "new_account" : "existing_account";
  const invitedByUserId = String(row.created_by_user_id);
  const inviterIsInvitee = row.inviter_is_invitee === true;
  const actor: AuditActor = { userId: acceptedUserId, email: p.actorEmail };
  const extra = presentationKeys(p);

  await insertAuditRow(tx, {
    action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
    actor,
    resourceType: "account_invitation",
    resourceId: invitationId,
    metadata: {
      invitationId,
      organizationId,
      purpose,
      personId,
      mode: acceptedMode,
      invitedByUserId,
      inviterIsInvitee,
      ...extra,
    },
  });

  if (acceptedMode === "new_account") {
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.USER_CREATED_VIA_INVITATION,
      actor,
      resourceType: "user",
      resourceId: acceptedUserId,
      metadata: { userId: acceptedUserId, invitationId, organizationId },
    });
  }

  // The designation events keep their existing shape and the tenant
  // organizationId stamp (F18); both the inviter and the accepting user are on
  // the row (actor = accepting user).
  switch (purpose) {
    case "founding_administrator":
      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.ORG_FOUNDING_ADMINISTRATOR_DESIGNATED,
        actor,
        resourceType: "organization",
        resourceId: organizationId,
        metadata: {
          organizationId,
          personId,
          userId: acceptedUserId,
          mode: row.person_mode,
          officeRoleKey: row.office_role_key ?? null,
          administrationRoleKey: row.administration_role_key,
          permissionKeys: row.permission_keys,
          // The gate proved it inside the function before any write.
          priorHolderCount: 0,
          viaInvitationId: invitationId,
          invitedByUserId,
          inviterIsInvitee,
          ...extra,
        },
      });
      return;
    case "treasurer":
      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.ORG_TREASURER_DESIGNATED,
        actor,
        resourceType: "organization",
        resourceId: organizationId,
        metadata: {
          organizationId,
          personId,
          roleId: row.treasurer_role_id,
          permissionKeys: row.permission_keys,
          viaInvitationId: invitationId,
          invitedByUserId,
          inviterIsInvitee,
          ...extra,
        },
      });
      return;
    case "sign_in":
      // Designates nobody: the acceptance row above is the whole record.
      return;
    default: {
      const _exhaustive: never = purpose;
      throw new Error(`Unhandled invitation purpose: ${String(_exhaustive)}`);
    }
  }
}
