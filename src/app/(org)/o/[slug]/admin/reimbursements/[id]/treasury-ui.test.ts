import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/reimbursement/copy";
import type { TreasuryDetail } from "@/lib/reimbursement/detail-shape";
import { treasuryUi } from "./treasury-ui";

const ID = "11111111-1111-4111-8111-111111111111";

type Over = Partial<Pick<TreasuryDetail, "status" | "receipts" | "receiptWaived" | "payments" | "route">> & {
  viewer?: Partial<TreasuryDetail["treasuryViewer"]>;
};

function detail(over: Over = {}): Pick<
  TreasuryDetail,
  "status" | "receipts" | "receiptWaived" | "payments" | "treasuryViewer"
> {
  return {
    status: over.status ?? "approved",
    receipts: over.receipts ?? [
      { id: ID, displayName: "r.jpg", contentType: "image/jpeg", byteSize: 10, createdAt: "2026-10-01T00:00:00Z" },
    ],
    receiptWaived: over.receiptWaived ?? false,
    payments: over.payments ?? [],
    treasuryViewer: {
      holdsPay: true,
      holdsManage: false,
      isApprover: false,
      isRequesterSide: false,
      seatHolderExists: false,
      secondPayerExists: true,
      anotherPayerExists: true,
      ...over.viewer,
    },
  };
}

const livePayment = {
  id: ID,
  kind: "payment" as const,
  method: "check" as const,
  reference: "1001",
  paidOn: "2026-10-05",
  amountCents: 1000,
  byName: "Rowan Pell",
  selfPaid: false,
  note: null,
  offsetsPaymentId: null,
  reason: null,
  createdAt: "2026-10-05T00:00:00Z",
  reversed: false,
};

describe("treasuryUi - the payment area (Copy C8 pre-form blocks, decided from the detail BEFORE the form renders)", () => {
  it("an approved, receipted request offers the form to a pay holder who did not approve it", () => {
    expect(treasuryUi(detail()).payment).toEqual({ kind: "form" });
  });

  it("the approver is told a different person must pay, and gets no form", () => {
    expect(treasuryUi(detail({ viewer: { isApprover: true } })).payment).toEqual({
      kind: "block",
      message: COPY.treasury.blocks.approverCannotPay,
    });
  });

  it("the requester side is sent to another payer only when one exists; the sole pay holder gets the form (residual 8)", () => {
    expect(treasuryUi(detail({ viewer: { isRequesterSide: true, anotherPayerExists: true } })).payment).toEqual({
      kind: "block",
      message: COPY.treasury.blocks.anotherPayer,
    });
    expect(treasuryUi(detail({ viewer: { isRequesterSide: true, anotherPayerExists: false } })).payment).toEqual({ kind: "form" });
  });

  it("the definer's order holds: the approver block comes before 'another payer', which comes before the receipt block", () => {
    const none = { receipts: [] };
    expect(treasuryUi(detail({ ...none, viewer: { isApprover: true, isRequesterSide: true } })).payment).toMatchObject({
      message: COPY.treasury.blocks.approverCannotPay,
    });
    expect(treasuryUi(detail({ ...none, viewer: { isRequesterSide: true } })).payment).toMatchObject({
      message: COPY.treasury.blocks.anotherPayer,
    });
    expect(treasuryUi(detail(none)).payment).toMatchObject({ message: COPY.treasury.blocks.receiptNeeded });
  });

  it("a waived receipt lifts the receipt block", () => {
    expect(treasuryUi(detail({ receipts: [], receiptWaived: true })).payment).toEqual({ kind: "form" });
  });

  it("says why there is no form on a request that is not waiting for payment, and when it was paid", () => {
    for (const status of ["submitted", "returned", "not_approved", "withdrawn", "voided"] as const) {
      expect(treasuryUi(detail({ status })).payment).toEqual({ kind: "block", message: COPY.treasury.blocks.notWaitingForPayment });
    }
    expect(treasuryUi(detail({ status: "paid", payments: [livePayment] })).payment).toEqual({
      kind: "block",
      message: COPY.treasury.blocks.alreadyPaid,
    });
  });

  it("shows nothing to a holder without pay", () => {
    expect(treasuryUi(detail({ viewer: { holdsPay: false } })).payment).toEqual({ kind: "none" });
  });
});

describe("treasuryUi - which verbs are offered (the definers decide again on every click)", () => {
  it("reverse needs a live (unreversed) payment on a paid request", () => {
    expect(treasuryUi(detail({ status: "paid", payments: [livePayment] })).reverse).toBe(true);
    expect(treasuryUi(detail({ status: "paid", payments: [{ ...livePayment, reversed: true }] })).reverse).toBe(false);
    expect(treasuryUi(detail({ status: "approved" })).reverse).toBe(false);
  });

  it("waive: submitted or approved, no receipt, not waived, and never on the actor's own request", () => {
    expect(treasuryUi(detail({ receipts: [] })).waive).toBe(true);
    expect(treasuryUi(detail({ status: "submitted", receipts: [] })).waive).toBe(true);
    expect(treasuryUi(detail({ receipts: [], receiptWaived: true })).waive).toBe(false);
    expect(treasuryUi(detail()).waive).toBe(false);
    expect(treasuryUi(detail({ receipts: [], viewer: { isRequesterSide: true } })).waive).toBe(false);
    expect(treasuryUi(detail({ status: "returned", receipts: [] })).waive).toBe(false);
  });

  it("send back: from approved, or from submitted only when no seat holder exists; never the actor's own", () => {
    expect(treasuryUi(detail({ status: "approved" })).sendBack).toBe("approved");
    expect(treasuryUi(detail({ status: "submitted" })).sendBack).toBe("submitted");
    expect(treasuryUi(detail({ status: "submitted", viewer: { seatHolderExists: true } })).sendBack).toBeNull();
    expect(treasuryUi(detail({ status: "approved", viewer: { isRequesterSide: true } })).sendBack).toBeNull();
    expect(treasuryUi(detail({ status: "paid" })).sendBack).toBeNull();
  });

  it("void: submitted, returned or approved", () => {
    for (const status of ["submitted", "returned", "approved"] as const) expect(treasuryUi(detail({ status })).void).toBe(true);
    for (const status of ["paid", "withdrawn", "voided", "not_approved"] as const) {
      expect(treasuryUi(detail({ status })).void).toBe(false);
    }
  });

  it("override: a submitted request with no seat holder, not the actor's own", () => {
    expect(treasuryUi(detail({ status: "submitted" })).override).toBe(true);
    expect(treasuryUi(detail({ status: "submitted", viewer: { seatHolderExists: true } })).override).toBe(false);
    expect(treasuryUi(detail({ status: "submitted", viewer: { isRequesterSide: true } })).override).toBe(false);
    expect(treasuryUi(detail({ status: "approved" })).override).toBe(false);
  });

  it("a holder without pay is offered no pay verb, but the note stays (it needs view, which the page already required)", () => {
    const ui = treasuryUi(detail({ status: "submitted", receipts: [], viewer: { holdsPay: false } }));
    expect(ui).toMatchObject({ reverse: false, waive: false, sendBack: null, void: false, override: false, note: true });
  });
});
