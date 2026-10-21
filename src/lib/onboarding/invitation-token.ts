/**
 * Account-invitation credential: mint, hash, shape-check
 * (DECISION-183, docs/work-log/2026-10-21-invitations.md Phase 3).
 *
 * PURE. Imports `node:crypto` and nothing else, so it is safe from any
 * runtime, from tests, and from the e2e fixture that seeds an invitation
 * with a known token (e2e/support/invitation-fixture.ts, Batch 4).
 *
 * The token is 32 random bytes, base64url (43 characters). It is held by the
 * recipient and stored ONLY as its sha256 hex digest in
 * `account_invitations.token_hash`. The two SECURITY DEFINER functions take
 * the RAW token and hash it in SQL (`encode(sha256(convert_to(t,'UTF8')),
 * 'hex')`, R5), so reading `token_hash` never confers the ability to claim an
 * invitation. `hashInvitationToken()` here and that SQL expression must agree
 * byte for byte; the DB suites pin it.
 */
import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes -> 43 base64url characters, no padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

/**
 * Whether `value` has the exact shape of a minted token. A cheap pre-database
 * filter for the public page and action: anything else is the dead-link
 * bucket without a round trip.
 */
export function isWellFormedInvitationToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}
