import { COPY } from "@/lib/reimbursement/copy";
import type { TreasuryDetail } from "@/lib/reimbursement/detail-shape";

/**
 * What the treasurer's request page offers, decided from the treasury detail
 * ALONE - docs/work-log/2026-10-25-treasury-inc1.md, Batch 4 "Contract for
 * Batch 5 and 6" ("the UI should ALSO decide which block to show BEFORE rendering
 * the form, from `treasuryViewer` (isApprover, isRequesterSide, anotherPayerExists)
 * and status / receiptWaived / receipts, so the action's answer is the backstop")
 * and Copy C8. PURE.
 *
 * The order of the payment blocks is the definer's: the approver (`payer_is_approver`)
 * before the requester side (`needs_another_payer`) before the receipt
 * (`receipt_missing`). A block replaces the form because the click could not
 * succeed. Everything here is a courtesy to the person looking: the definers
 * re-derive each answer, live, on every click, so a stale page costs a refusal
 * sentence, never a wrong write.
 *
 * "Requester side" is the viewer who created the request or is paid by it. They
 * may not waive a receipt, send it back, or approve it as treasurer; they may
 * record its payment only when no other pay holder could (the sole-holder
 * exception, residual 8, which the page reports rather than hides).
 */

export type PaymentArea =
  | { kind: "none" }
  | { kind: "block"; message: string }
  | { kind: "form" };

export interface TreasuryUi {
  payment: PaymentArea;
  reverse: boolean;
  waive: boolean;
  /** Which body the send-back dialog uses, or null when the verb is not offered. */
  sendBack: "submitted" | "approved" | null;
  void: boolean;
  override: boolean;
  note: boolean;
}

export function treasuryUi(
  detail: Pick<TreasuryDetail, "status" | "receipts" | "receiptWaived" | "payments" | "treasuryViewer">,
): TreasuryUi {
  const v = detail.treasuryViewer;
  const status = detail.status;
  const noReceipt = detail.receipts.length === 0 && !detail.receiptWaived;
  const livePayment = detail.payments.some((p) => p.kind === "payment" && !p.reversed);

  let payment: PaymentArea = { kind: "none" };
  if (v.holdsPay) {
    if (status === "approved") {
      if (v.isApprover) payment = { kind: "block", message: COPY.treasury.blocks.approverCannotPay };
      else if (v.isRequesterSide && v.anotherPayerExists) payment = { kind: "block", message: COPY.treasury.blocks.anotherPayer };
      else if (noReceipt) payment = { kind: "block", message: COPY.treasury.blocks.receiptNeeded };
      else payment = { kind: "form" };
    } else if (status === "paid") {
      payment = { kind: "block", message: COPY.treasury.blocks.alreadyPaid };
    } else {
      payment = { kind: "block", message: COPY.treasury.blocks.notWaitingForPayment };
    }
  }

  const holdsPay = v.holdsPay;
  const open = status === "submitted" || status === "approved";
  return {
    payment,
    reverse: holdsPay && status === "paid" && livePayment,
    waive: holdsPay && open && detail.receipts.length === 0 && !detail.receiptWaived && !v.isRequesterSide,
    sendBack:
      holdsPay && !v.isRequesterSide
        ? status === "approved"
          ? "approved"
          : status === "submitted" && !v.seatHolderExists
            ? "submitted"
            : null
        : null,
    void: holdsPay && (status === "submitted" || status === "returned" || status === "approved"),
    override: holdsPay && status === "submitted" && !v.seatHolderExists && !v.isRequesterSide,
    note: true,
  };
}
