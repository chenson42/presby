import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { UUID_RE } from "@/lib/onboarding/input";

/**
 * Record that a Google sign-in proved control of an account's CURRENT address
 * (Community Increment 2b, R38, DECISION-225).
 *
 * `users.email_verified` is a fact about the address the account carries now.
 * The database refuses every stamp from a non-owner role (the
 * `users_guard_email_proof` trigger, drizzle/0065 section 3), so the only way
 * `presby_app` can write one is this SECURITY DEFINER function, which stamps an
 * active, unstamped account whose address equals the one Google asserted and
 * returns whether it did.
 *
 * SINGLE CALL SITE. `recordGoogleEmailProof` is called from `src/auth.ts`, in
 * the `jwt` sign-in branch, behind the `provider === "google"` test and the
 * strict `email_verified === true` claim check (F231's gate, DECISION-246,
 * refuses the sign-in before this is ever reached). A scan in
 * `src/lib/onboarding/boundaries.test.ts` holds both properties.
 *
 * ACCEPTED RESIDUAL (`paper`, F187 class): the database cannot check a Google
 * ID token, so any `presby_app` caller could call the definer. It can only ever
 * stamp the account's own current address, and the call-site scan is the
 * mitigation.
 *
 * Names `users`-side objects only (never the contact tables), so the auth-roots
 * scan in `src/lib/contact-methods/scan.test.ts` holds. Audit metadata is the
 * source tag and nothing else: no address.
 */

export const GOOGLE_PROOF_SOURCE = "google" as const;

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

/**
 * True when this call stamped the account. False for every non-stamping case
 * (a different address, an already-stamped or inactive account, malformed
 * input). Throws on a database error; the caller (`src/auth.ts`) catches it and
 * sign-in proceeds without proof.
 */
export async function recordGoogleEmailProof(input: {
  userId: string;
  address: string;
}): Promise<boolean> {
  const { userId, address } = input;
  if (!UUID_RE.test(userId)) return false;
  if (typeof address !== "string" || address.trim().length === 0) return false;

  return db.transaction(async (tx) => {
    const result = await tx.execute(
      sql`select presby_record_google_email_proof(${userId}::uuid, ${address}::text) as stamped`,
    );
    const stamped = rowsOf(result)[0]?.stamped === true;
    if (!stamped) return false;
    // The audit row shares the stamp's transaction: a failed insert undoes the
    // stamp (Workflow Rule 7). The actor is the account itself.
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.USER_EMAIL_PROOF_RECORDED,
      actor: { userId, email: address },
      resourceType: "user",
      resourceId: userId,
      metadata: { source: GOOGLE_PROOF_SOURCE },
    });
    return true;
  });
}
