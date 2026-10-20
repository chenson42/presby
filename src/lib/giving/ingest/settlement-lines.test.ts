import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const stripe = vi.hoisted(() => ({ listBalanceTransactionsForPayout: vi.fn() }));
vi.mock("../providers/stripe/client", () => stripe);
const fns = vi.hoisted(() => ({ applySettlementLines: vi.fn() }));
vi.mock("./functions", () => fns);

import { fillSettlementLines, mapPayoutLineKind, toLineInput } from "./settlement-lines";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  balanceTransactionId: id, kind: "charge", amountCents: 100, feeCents: 3, netCents: 97, paymentIntentId: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  fns.applySettlementLines.mockResolvedValue("applied");
});

describe("mapPayoutLineKind", () => {
  it.each([
    ["charge", "charge"], ["payment", "charge"],
    ["refund", "refund"], ["payment_refund", "refund"], ["payment_failure_refund", "refund"],
    ["stripe_fee", "fee"], ["application_fee", "fee"],
    ["dispute", "dispute"], ["dispute_reversal", "dispute"],
    ["adjustment", "adjustment"],
    ["payout", "other"], ["payout_cancel", "other"], ["", "other"], ["something_stripe_adds_next_year", "other"],
  ])("Stripe's %s is a %s line", (type, kind) => {
    expect(mapPayoutLineKind(type)).toBe(kind);
  });

  it("only ever yields a kind the table's CHECK allows", () => {
    const allowed = ["charge", "refund", "dispute", "fee", "adjustment", "other"];
    for (const t of ["charge", "payment", "refund", "stripe_fee", "dispute", "adjustment", "zzz"]) expect(allowed).toContain(mapPayoutLineKind(t));
  });
});

describe("toLineInput", () => {
  it("keeps the signed amounts and the payment intent, and maps the kind", () => {
    expect(toLineInput(row("txn_x1", { kind: "payment_refund", amountCents: -500, feeCents: 0, netCents: -500, paymentIntentId: "pi_abcdefgh12" }))).toEqual({
      balanceTransactionId: "txn_x1", kind: "refund", grossCents: -500, feeCents: 0, netCents: -500, paymentIntentId: "pi_abcdefgh12",
    });
  });
});

describe("fillSettlementLines", () => {
  it("reads one page and stores it under the claimed inbox row and the payout id", async () => {
    stripe.listBalanceTransactionsForPayout.mockResolvedValue({ rows: [row("txn_a1")], hasMore: false });
    expect(await fillSettlementLines("inbox-1", "acct_fixtureAccount0001", "po_fixturePayout000001")).toBe("applied");
    expect(stripe.listBalanceTransactionsForPayout).toHaveBeenCalledWith("acct_fixtureAccount0001", "po_fixturePayout000001", undefined);
    expect(fns.applySettlementLines).toHaveBeenCalledWith("inbox-1", "po_fixturePayout000001", [expect.objectContaining({ balanceTransactionId: "txn_a1" })]);
  });

  it("follows the cursor (the last id of each page) and stores everything in ONE call", async () => {
    stripe.listBalanceTransactionsForPayout
      .mockResolvedValueOnce({ rows: [row("txn_a1"), row("txn_a2")], hasMore: true })
      .mockResolvedValueOnce({ rows: [row("txn_b1")], hasMore: false });
    await fillSettlementLines("inbox-1", "acct_x", "po_x");
    expect(stripe.listBalanceTransactionsForPayout).toHaveBeenNthCalledWith(2, "acct_x", "po_x", "txn_a2");
    expect(fns.applySettlementLines).toHaveBeenCalledTimes(1);
    expect(fns.applySettlementLines.mock.calls[0]![2].map((l: { balanceTransactionId: string }) => l.balanceTransactionId)).toEqual(["txn_a1", "txn_a2", "txn_b1"]);
  });

  it("an empty payout stores an empty list (so the payout is marked loaded)", async () => {
    stripe.listBalanceTransactionsForPayout.mockResolvedValue({ rows: [], hasMore: false });
    await fillSettlementLines("inbox-1", "acct_x", "po_x");
    expect(fns.applySettlementLines).toHaveBeenCalledWith("inbox-1", "po_x", []);
  });

  it("a page that claims more but gives no cursor stops and stores nothing partial", async () => {
    stripe.listBalanceTransactionsForPayout.mockResolvedValue({ rows: [], hasMore: true });
    expect(await fillSettlementLines("inbox-1", "acct_x", "po_x")).toBe("ignored:too_many_lines");
    expect(fns.applySettlementLines).not.toHaveBeenCalled();
  });

  it("a Stripe failure propagates (the processor turns it into a retry); nothing is stored", async () => {
    stripe.listBalanceTransactionsForPayout.mockRejectedValue(new Error("boom"));
    await expect(fillSettlementLines("inbox-1", "acct_x", "po_x")).rejects.toThrow("boom");
    expect(fns.applySettlementLines).not.toHaveBeenCalled();
  });
});
