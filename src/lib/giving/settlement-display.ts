/**
 * The pure half of the payouts list - docs/work-log/2026-10-15-online-giving.md,
 * Batch 6. The row shape `settlements.ts` returns and the one derived fact a
 * page needs about it, with no database and no `server-only`, so the page, its
 * tests and a future client component all read one definition.
 */

export interface SettlementRow {
  id: string;
  /** Stripe's payout id (`po_...`): what the treasurer finds in the Stripe dashboard. */
  payoutId: string;
  /** 'YYYY-MM-DD', or null when Stripe gave none. */
  arrivalDate: string | null;
  status: "paid" | "failed";
  automatic: boolean;
  testMode: boolean;
  /** The payout's own amount. */
  amountCents: number;
  /** ISO-8601 UTC the header first arrived. */
  recordedAt: string;
  /** Every line is stored (`lines_loaded_at`). Always false for a manual payout. */
  linesLoaded: boolean;
  lineCount: number;
  chargeCount: number;
  chargeGrossCents: number;
  /** Refunds and disputes (signed, <= 0 in practice). */
  returnCount: number;
  returnGrossCents: number;
  /** Fees Stripe took across the lines. */
  feeCents: number;
  /** The lines' net: what the payout should equal. */
  netCents: number;
  /** Charges whose payment intent matches no recorded gift (not ours, or not recorded yet). */
  unmatchedCharges: number;
}

/**
 * What a payout's contents say about it, as a pure function of its row so the
 * page and its tests agree: `manual` (nothing to reconcile, ever), `waiting`
 * (an automatic payout whose lines have not arrived), `failed`, `balanced` (the
 * lines add up to the payout) or `mismatch` (they do not - the treasurer should
 * look in Stripe).
 */
export type SettlementReconciliation = "manual" | "failed" | "waiting" | "balanced" | "mismatch";

export function reconciliationOf(
  row: Pick<SettlementRow, "status" | "automatic" | "linesLoaded" | "netCents" | "amountCents">,
): SettlementReconciliation {
  if (row.status === "failed") return "failed";
  if (!row.automatic) return "manual";
  if (!row.linesLoaded) return "waiting";
  return row.netCents === row.amountCents ? "balanced" : "mismatch";
}
