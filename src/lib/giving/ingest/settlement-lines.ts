import "server-only";
import { listBalanceTransactionsForPayout, type PayoutBalanceRow } from "../providers/stripe/client";
import { applySettlementLines, type SettlementLineInput } from "./functions";

/**
 * Filling a payout's lines - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Settlements" and Batch 6. Called from `process.ts`, in the same claim as the
 * `payout.paid` header, because `presby_giving_apply_settlement_lines` (like
 * every apply function) acts only on a CLAIMED inbox row. That is also why this
 * lives in the cron/webhook path rather than in a page: nothing a user does can
 * make the platform read a congregation's balance transactions.
 *
 * Only AUTOMATIC payouts have lines to list. Stripe's balance-transaction list
 * filters by payout only for those; a manual payout is one number with no
 * contents, so the header stands alone and the page says "reconciliation
 * unavailable" (the caller never gets here for one).
 *
 * The whole payout is read before anything is stored, so `lines_loaded_at` means
 * "every line is here". A payout over `MAX_PAGES` pages (1,000 transactions -
 * far beyond a congregation) is left without lines and the header stands, with a
 * one-line log (ids only) rather than a partial list that would add up wrong.
 * A Stripe failure throws, `process.ts` turns it into a `failed:*` outcome, and
 * the event retries on the normal back-off; the header write is idempotent.
 */

const MAX_PAGES = 10;

/** Stripe's balance-transaction `type` as the settlement-line `kind` the table allows. */
export function mapPayoutLineKind(type: string): SettlementLineInput["kind"] {
  switch (type) {
    case "charge":
    case "payment":
      return "charge";
    case "refund":
    case "payment_refund":
    case "payment_failure_refund":
      return "refund";
    case "stripe_fee":
    case "application_fee":
      return "fee";
    case "dispute":
    case "dispute_reversal":
      return "dispute";
    case "adjustment":
      return "adjustment";
    default:
      return "other";
  }
}

export function toLineInput(row: PayoutBalanceRow): SettlementLineInput {
  return {
    balanceTransactionId: row.balanceTransactionId,
    kind: mapPayoutLineKind(row.kind),
    grossCents: row.amountCents,
    feeCents: row.feeCents,
    netCents: row.netCents,
    paymentIntentId: row.paymentIntentId,
  };
}

/**
 * Reads every balance transaction of `payoutId` and stores them. Returns the
 * apply function's outcome, or `ignored:too_many_lines` when the payout is over
 * the page cap. Throws a `ProviderError` on a Stripe failure.
 */
export async function fillSettlementLines(
  inboxId: string,
  accountId: string,
  payoutId: string,
): Promise<string> {
  const rows: PayoutBalanceRow[] = [];
  let startingAfter: string | undefined;
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listBalanceTransactionsForPayout(accountId, payoutId, startingAfter);
    rows.push(...result.rows);
    if (!result.hasMore) {
      complete = true;
      break;
    }
    startingAfter = result.rows.at(-1)?.balanceTransactionId;
    if (!startingAfter) break;
  }
  if (!complete) {
    console.error("[giving/ingest] payout too large to list", { payoutId, pages: MAX_PAGES });
    return "ignored:too_many_lines";
  }
  return applySettlementLines(inboxId, payoutId, rows.map(toLineInput));
}
