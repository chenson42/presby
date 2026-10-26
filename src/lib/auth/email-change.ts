import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";

/**
 * Complete an email change from a verification link (Community Increment 2b,
 * R38, DECISION-225).
 *
 * The verify-email page used to `update users set email` itself. After
 * drizzle/0065 a non-owner role cannot write `users.email_verified`, and an
 * address change with no new stamp clears the old one, so the change now goes
 * through `presby_complete_email_change`: it consumes the token row, writes the
 * new address AND the proof stamp in one statement (the link proves the new
 * mailbox), and deletes the token. This keeps "verify your new address"
 * truthful: after it, `email_verified` refers to the address on the row.
 *
 * Outcomes pin to the SQL literals (`EMAIL_CHANGE_OUTCOMES`, a test reads the
 * migration): `invalid | expired | email_taken | ok`. On `ok` this writes the
 * EXISTING `user.email_changed` audit row, same shape as before, in the same
 * transaction, so a failed audit insert undoes the change.
 *
 * The URL carries the raw token; the database stores only its SHA-256 hash.
 * The hash is computed here and only the hash reaches SQL. Never logged: the
 * token, its hash, either address.
 */

export const EMAIL_CHANGE_OUTCOMES = ["invalid", "expired", "email_taken", "ok"] as const;
export type EmailChangeOutcome = (typeof EMAIL_CHANGE_OUTCOMES)[number];

export type CompleteEmailChangeResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "email_taken" }
  | { kind: "error" };

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
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

export async function completeEmailChange(
  rawToken: string,
): Promise<CompleteEmailChangeResult> {
  if (typeof rawToken !== "string" || rawToken.length === 0) return { kind: "invalid" };
  const tokenHash = sha256Hex(rawToken);

  try {
    return await db.transaction(async (tx): Promise<CompleteEmailChangeResult> => {
      const result = await tx.execute(
        sql`select * from presby_complete_email_change(${tokenHash}::text)`,
      );
      const row = rowsOf(result)[0];
      if (!row) throw new Error("presby_complete_email_change returned no row");

      switch (row.outcome) {
        case "invalid":
          return { kind: "invalid" };
        case "expired":
          // The definer deleted the expired row; this transaction commits that.
          return { kind: "expired" };
        case "email_taken":
          return { kind: "email_taken" };
        case "ok": {
          const userId = String(row.user_id);
          const oldEmail = String(row.old_email);
          const newEmail = String(row.new_email);
          await insertAuditRow(tx, {
            action: AUDIT_ACTIONS.USER_EMAIL_CHANGED,
            actor: { userId, email: newEmail },
            resourceType: "user",
            resourceId: userId,
            metadata: { oldEmail, newEmail },
          });
          return { kind: "ok" };
        }
        default:
          throw new Error("presby_complete_email_change returned an unknown outcome");
      }
    });
  } catch (err) {
    console.error("[email-change] failed", errorClass(err));
    return { kind: "error" };
  }
}
