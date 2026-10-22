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
  | { kind: "blocked"; reason: AccountInvitationBlockedReason }
  | { kind: "invalid_input"; field: "password" | "firstName" | "lastName" }
  | { kind: "db_error" };

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
    return await db.transaction(async (tx): Promise<AcceptResult> => {
      const result = await tx.execute(sql`
        select * from presby_accept_invitation(
          ${input.token}::text, ${userId}::uuid, ${passwordHash}::text,
          ${firstName}::text, ${lastName}::text)
      `);
      const row = rowsOf(result)[0];
      if (!row) throw new Error("presby_accept_invitation returned no row");

      switch (row.outcome) {
        case "dead":
          return { kind: "dead" };
        case "account_exists":
          return { kind: "account_exists" };
        case "email_mismatch":
          return { kind: "email_mismatch" };
        case "account_inactive":
          return { kind: "account_inactive" };

        case "blocked": {
          const actor: AuditActor = row.user_id
            ? { userId: String(row.user_id), email: actorEmail }
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
          return { kind: "blocked", reason: row.blocked_reason as AccountInvitationBlockedReason };
        }

        case "accepted": {
          const invitationId = String(row.invitation_id);
          const organizationId = String(row.organization_id);
          const acceptedUserId = String(row.user_id);
          const personId = String(row.person_id);
          const purpose = String(row.purpose);
          const acceptedMode = row.mode === "new_account" ? "new_account" : "existing_account";
          const invitedByUserId = String(row.created_by_user_id);
          const inviterIsInvitee = row.inviter_is_invitee === true;
          const actor: AuditActor = { userId: acceptedUserId, email: actorEmail };

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
          // organizationId stamp (F18); both the inviter and the accepting
          // user are on the row (actor = accepting user).
          if (purpose === "founding_administrator") {
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
              },
            });
          } else {
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
              },
            });
          }

          return {
            kind: "accepted",
            mode: acceptedMode,
            organizationSlug: String(row.organization_slug),
          };
        }

        default:
          // An outcome this code does not know: fail closed, roll back.
          throw new Error("presby_accept_invitation returned an unknown outcome");
      }
    });
  } catch (err) {
    console.error("[invitations] accept failed:", errorClass(err));
    return { kind: "db_error" };
  }
}
