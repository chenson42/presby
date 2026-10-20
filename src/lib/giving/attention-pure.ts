/**
 * The shapes `loadAttention()` returns, and the one pure question asked of
 * them - split from `attention.ts` (which is `server-only` and reads the
 * database) so the overview's list component and its tests can use them
 * without a database import. docs/work-log/2026-10-15-online-giving.md, S5.
 */

export type AttentionConnectionState = "none" | "onboarding" | "active" | "restricted" | "disconnected";

export interface AttentionConnection {
  state: AttentionConnectionState;
  /** True when the open connection is a Stripe TEST-mode account (shown as a "Test mode" badge). */
  testMode: boolean;
  requirementsDue: boolean;
  publicPageOn: boolean;
}

export interface Attention {
  scope: "full" | "recorder";
  failedGifts: number | null;
  stuckPending: number | null;
  monthlyPaymentFailures: number | null;
  connection: AttentionConnection | null;
  parkedEvents: number | null;
  deadLetters: number | null;
  staleStatements: number | null;
  possibleDuplicateDonors: number | null;
  linkProposals: number;
}

export interface AttentionContext {
  organizationId: string;
  has: { view: boolean; record: boolean; manage: boolean };
}

/** Does anything in `a` need a human? (The overview shows "all clear" otherwise.) */
export function attentionIsClear(a: Attention): boolean {
  const nums = [
    a.failedGifts,
    a.stuckPending,
    a.monthlyPaymentFailures,
    a.parkedEvents,
    a.deadLetters,
    a.staleStatements,
    a.possibleDuplicateDonors,
    a.linkProposals,
  ];
  if (nums.some((n) => (n ?? 0) > 0)) return false;
  if (a.connection && (a.connection.state === "restricted" || a.connection.requirementsDue)) return false;
  return true;
}
