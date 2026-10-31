import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { UUID_RE } from "./input";

/**
 * Connect a proven sign-in to the one person it identifies (Community
 * Increment 2b, R41/R42, DECISION-226).
 *
 * Everything that decides eligibility lives in SQL: `presby_connect_signed_in_
 * account(user, factor)` finds the candidate by the account's own PROVEN
 * address, applies the standing core (visitors, shared addresses, two
 * congregations, ended or merged records, an open invitation, the
 * congregation's toggle, a second factor for authority-bearing records) and
 * writes `people.user_id` through the bind helper, nothing else. This module
 * is a thin, audited caller. IDENTIFICATION LIVES IN SQL ONLY: nothing here
 * names the contact tables, their module or the credential-address reader
 * (R43; the scans in `src/lib/contact-methods/scan.test.ts` hold the line).
 *
 * TWO CALL SITES, and only two (pinned by a scan in
 * `src/lib/onboarding/boundaries.test.ts`): the `jwt` sign-in branch in
 * `src/auth.ts` (`via: "sign_in"`) and the Check-again action under
 * `src/app/no-organization/` (`via: "check_again"`). Identity comes from
 * `auth()` at both. At sign-in the second-factor flag is ALWAYS false: a fresh
 * session has not been through the challenge. The input type makes passing one
 * at sign-in a compile error.
 *
 * AUDIT (Workflow Rule 7). On `connected`, one `tenant.person.sign_in_connected`
 * row is inserted in the SAME transaction as the link, so a throw from the audit
 * insert rolls the link back. Declines write nothing. Metadata is ids, enums and
 * booleans, from a closed key list (`CONNECT_AUDIT_METADATA_KEYS`): no address,
 * no name, no token. `contactMethodCreatedAt` lets a reviewer join to the
 * `tenant.person_email.added` row (and its actor) that put the address on the
 * record, which is the detection chain for F232.
 *
 * BEST EFFORT. A connect must never hold up or fail a sign-in: the transaction
 * sets a 3 s lock timeout, every failure collapses to `{ kind: "error" }` and
 * logs an error CLASS only (no address, no id). The caller swallows it.
 */

export type ConnectInput =
  | { userId: string; via: "sign_in"; proof: "google" | "account"; actorEmail?: string | null }
  | { userId: string; via: "check_again"; secondFactorVerified: boolean; actorEmail?: string | null };

export type ConnectResult =
  | { kind: "connected"; organizationSlug: string }
  | { kind: "already_connected" }
  | { kind: "needs_second_factor" }
  | { kind: "declined" }
  | { kind: "error" };

/** The definer's outcome literals (pinned to drizzle/0065 section 14 by a test). */
export const CONNECT_OUTCOMES = [
  "connected",
  "already_connected",
  "needs_second_factor",
  "declined",
] as const;

/** The closed audit metadata key list (E-29). A test compares the written row to it. */
export const CONNECT_AUDIT_METADATA_KEYS = [
  "organizationId",
  "personId",
  "contactMethodId",
  "contactMethodCreatedAt",
  "via",
  "proof",
  "secondFactor",
  "authority",
] as const;
export const CONNECT_AUDIT_AUTHORITY_KEYS = [
  "sessionSeat",
  "diaconateSeat",
  "roleKeys",
  "permissionKeys",
] as const;

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

/**
 * An error CLASS for the log: the error's name and, when one is found on the
 * error or its `cause` chain, the 5-character SQLSTATE (Drizzle wraps the
 * driver's error, so a lock timeout arrives as a wrapper whose `cause` carries
 * 55P03). Never the message: a Drizzle message carries the statement and its
 * parameters, which here include ids and addresses.
 */
function errorClass(err: unknown): string {
  let code: string | undefined;
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 6 && code === undefined; depth += 1) {
    const candidate = (cur as { code?: unknown }).code;
    if (typeof candidate === "string" && /^[0-9A-Z]{5}$/.test(candidate)) code = candidate;
    cur = (cur as { cause?: unknown }).cause;
  }
  const name = err instanceof Error ? err.name : typeof err;
  return code ? `${name}/${code}` : name;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function isoOf(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

export async function connectSignedInAccount(input: ConnectInput): Promise<ConnectResult> {
  const { userId } = input;
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return { kind: "error" };

  // At sign-in the factor is never verified; at Check-again it is whatever the
  // session claims (DECISION-230: server-granted, never from a payload).
  const secondFactorVerified =
    input.via === "check_again" ? input.secondFactorVerified === true : false;
  const proof = input.via === "sign_in" ? input.proof : null;

  try {
    return await db.transaction(async (tx): Promise<ConnectResult> => {
      // A connect must never hold up a sign-in: give up on a lock after 3 s
      // (55P03), which surfaces as `error` below and is swallowed by the caller.
      await tx.execute(sql`set local lock_timeout = '3s'`);

      const result = await tx.execute(
        sql`select * from presby_connect_signed_in_account(${userId}::uuid, ${secondFactorVerified}::boolean)`,
      );
      const row = rowsOf(result)[0];
      if (!row) throw new Error("presby_connect_signed_in_account returned no row");

      switch (row.outcome) {
        case "declined":
          return { kind: "declined" };
        case "already_connected":
          return { kind: "already_connected" };
        case "needs_second_factor":
          return { kind: "needs_second_factor" };
        case "connected": {
          const organizationId = String(row.organization_id);
          const personId = String(row.person_id);
          await insertAuditRow(tx, {
            action: AUDIT_ACTIONS.TENANT_PERSON_SIGN_IN_CONNECTED,
            actor: { userId, email: input.actorEmail ?? null },
            resourceType: "person",
            resourceId: personId,
            metadata: {
              organizationId,
              personId,
              contactMethodId: String(row.contact_method_id),
              contactMethodCreatedAt: isoOf(row.contact_method_created_at),
              via: input.via,
              proof,
              secondFactor: secondFactorVerified,
              authority: {
                sessionSeat: row.session_seat === true,
                diaconateSeat: row.diaconate_seat === true,
                roleKeys: stringList(row.role_keys),
                permissionKeys: stringList(row.permission_keys),
              },
            },
          });
          return { kind: "connected", organizationSlug: String(row.organization_slug) };
        }
        default:
          throw new Error("presby_connect_signed_in_account returned an unknown outcome");
      }
    });
  } catch (err) {
    // Class only: never an address, an id or a message that could carry one.
    console.error("[connect] failed", errorClass(err));
    return { kind: "error" };
  }
}
