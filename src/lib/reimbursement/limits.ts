/**
 * Every cap in the feature, in one place - docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 P3-10, P3-16, P3-17, P3-18. PURE.
 *
 * The database enforces its own copies of these (drizzle/0073 CHECKs and the
 * definers' field outcomes); `limits.test.ts` parses the migration text and
 * fails when a number here and the number there disagree. User-facing copy
 * derives from these constants (`copy.ts`), so "4 MB" and "5 files" can never
 * drift from what the upload route enforces.
 */

/** Money is integer cents end to end; nothing is rounded (P3-10). */
export const MIN_AMOUNT_CENTS = 1;
export const MAX_AMOUNT_CENTS = 10_000_000; // $100,000.00

/** Maximum lengths, in characters (code points), after cleaning (`text.ts`). */
export const MAX_LENGTH = {
  purpose: 500,
  vendor: 120,
  preApprover: 80,
  /** A return, void, withdraw or reversal reason. */
  reason: 300,
  waiverNote: 300,
  paymentNote: 300,
  /** A treasurer note (an event row's note). */
  note: 500,
  reference: 40,
  category: 60,
  displayName: 80,
} as const;

/** The expense date is not in the future and not more than this many days back (P3-18). */
export const MAX_EXPENSE_DAYS_BACK = 365;

/** Receipts (P3-17). Enforced by Batch 2b's upload route and by the 0073 CHECK. */
export const MAX_RECEIPTS = 5;
export const MAX_RECEIPT_BYTES = 4_000_000;
/** The route accepts a body up to this size (the file plus multipart framing). */
export const MAX_RECEIPT_BODY_BYTES = 4_200_000;
export const MAX_RECEIPT_UPLOADS_PER_HOUR = 40;

/** Open drafts per user (P3-17); `too_many_drafts` at the 21st. */
export const MAX_OPEN_DRAFTS = 20;

/** The CSV export is refused over this many rows, never truncated (P3-16). */
export const CSV_MAX_ROWS = 20_000;

/** `reimbursement_requests.client_key`: the idempotency key a form generates once. */
export const CLIENT_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** The beneficiary search: at least two characters, at most eight names (P3 pickers.ts). */
export const BENEFICIARY_QUERY_MIN = 2;
export const BENEFICIARY_QUERY_MAX = 80;
export const BENEFICIARY_RESULTS_MAX = 8;

/** `my_requests` page size (the definer clamps to 1..100). */
export const MY_REQUESTS_PAGE_SIZE = 50;
