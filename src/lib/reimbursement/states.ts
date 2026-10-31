import { COPY } from "./copy";

/**
 * Request statuses and the transition table, mirrored from drizzle/0073
 * section 4c - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 (the
 * DECISION-267 table) and EC6. PURE.
 *
 * The database is the authority: a trigger enforces this table on EVERY
 * connection, the owner included (F44). This mirror exists so the UI can ask
 * "could this ever be a legal move" without a round trip, and so a test can
 * fail when the two disagree (`states.test.ts` parses the trigger's own
 * expression out of the migration text).
 */

export const REQUEST_STATUSES = [
  "draft",
  "submitted",
  "returned",
  "not_approved",
  "approved",
  "paid",
  "withdrawn",
  "voided",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["approved", "returned", "not_approved", "withdrawn", "voided"],
  returned: ["submitted", "withdrawn", "voided"],
  not_approved: ["withdrawn"],
  approved: ["paid", "returned", "withdrawn", "voided"],
  paid: ["approved"], // a payment reversal only
  withdrawn: [],
  voided: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** No outgoing move at all. */
export function isTerminal(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * "Open" for the Features page's off-warning (Copy check C1): the statuses
 * `presby_reimbursement_open_count()` counts. Drafts are excluded.
 */
export const OPEN_STATUSES: readonly RequestStatus[] = ["submitted", "returned", "approved"];

/** The event kinds in `reimbursement_events.kind` (0073 section 1f). */
export const EVENT_KINDS = [
  "created",
  "submitted",
  "resubmitted",
  "approved",
  "override_approved",
  "returned",
  "not_approved",
  "withdrawn",
  "voided",
  "receipt_waived",
  "payment_recorded",
  "payment_reversed",
  "note",
  "imported",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Who is reading a status: the requester, or someone working the queue (approver, treasury). */
export type StatusAudience = "requester" | "staff";

/** The human label for a status (Copy C2). Staff lists say "Sent back", not "Sent back to you". */
export function statusLabel(status: RequestStatus, audience: StatusAudience): string {
  const labels = audience === "requester" ? COPY.statusLabels.requester : COPY.statusLabels.staff;
  return labels[status];
}

/** The history label for an event (Copy C5). `treasury` unlocks the treasury-only labels. */
export function historyLabel(kind: EventKind): string {
  return COPY.detail.history[kind];
}
