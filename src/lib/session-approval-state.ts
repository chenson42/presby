/**
 * The five states in which a congregation's Session can or cannot act on the
 * roll actions waiting for it (docs/work-log/2026-10-22-founding-admin-
 * directory.md, Increment 2 Flow 7, S4, DECISION-205).
 *
 * Pure (no `server-only`, no database): `src/lib/roll.ts`'s
 * `getSessionApprovalState()` gathers the counts in one SQL statement and
 * calls `deriveSessionApprovalKind()`; the queue banner, the wizard and the
 * edit page choose copy by the kind. A separate module so the derivation is
 * unit-testable without a connection and importable by client components.
 */

export type SessionApprovalStateKind =
  | "no_session"
  | "empty"
  | "no_sign_in"
  | "no_permission"
  | "ready";

export interface SessionApprovalCounts {
  /** The organization has a derived `session` group (only congregations do). */
  hasSessionGroup: boolean;
  /** Live Session seats: distinct persons, active membership, an open term in
   * effect today. */
  recorded: number;
  /** Seats that start after today whose holder has no seat in effect. */
  startingLater: number;
  /** Of `recorded`: `people.user_id` is not null. */
  withAccount: number;
  /** Of `recorded` with an account: holds `roll.approve` today. */
  canApprove: number;
}

/**
 * Order matters. No Session group first (F185). Then an empty roster: nobody
 * is seated now or later. Then "seated but nobody can sign in", which
 * includes a roster whose every seat starts later. Then "has accounts but none
 * holds the key" (the Session role was changed). Else ready.
 */
export function deriveSessionApprovalKind(
  counts: SessionApprovalCounts,
): SessionApprovalStateKind {
  if (!counts.hasSessionGroup) return "no_session";
  if (counts.recorded === 0 && counts.startingLater === 0) return "empty";
  if (counts.recorded === 0 || counts.withAccount === 0) return "no_sign_in";
  if (counts.canApprove === 0) return "no_permission";
  return "ready";
}
