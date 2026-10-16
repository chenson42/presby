/**
 * Orchestration tests for the gift server actions (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2). The SQL and the function vocabulary
 * are proven by src/lib/giving/gifts.db.test.ts; this pins: the gate asks for
 * `record`, input is validated first, every library result maps to the right
 * message / field error, the two SOFT warnings come back as ok-with-status
 * WITHOUT an audit row, and the audit carries ids, the method and the cents -
 * never a name, a memo or a void reason.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/action-gate", async () => {
  const { zodFieldErrors } = await import("@/lib/giving/field-errors");
  return {
    gateGivingAction: (...a: unknown[]) => gate(...a),
    invalidInput: (e: import("zod").ZodError) => ({ ok: false, error: "Check the highlighted fields and try again.", fieldErrors: zodFieldErrors(e) }),
  };
});
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    GIVING_GIFT_RECORDED: "tenant.giving_gift.recorded",
    GIVING_GIFT_VOIDED: "tenant.giving_gift.voided",
    GIVING_DONOR_CREATED: "tenant.giving_donor.created",
  },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const gifts = vi.hoisted(() => ({ recordOfflineGift: vi.fn(), voidGift: vi.fn() }));
vi.mock("@/lib/giving/gifts", () => gifts);
const searchDonors = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/donors", () => ({ searchDonors: (...a: unknown[]) => searchDonors(...a) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { recordOfflineGiftAction, searchDonorsAction, voidGiftAction } from "./actions";

const IDENTITY = { ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", has: { view: false, record: true, manage: false } };
const FUND = "22222222-2222-4222-8222-222222222222";
const DONOR = "33333333-3333-4333-8333-333333333333";
const GIFT = "44444444-4444-4444-8444-444444444444";
const input = (over: Record<string, unknown> = {}) => ({
  donor: { mode: "existing", donorId: DONOR },
  fundId: FUND,
  occurredOn: "2026-04-12",
  method: "check",
  amount: "125.50",
  checkNumber: "1042",
  memo: "Mrs. Fenwick's envelope",
  ...over,
});

afterEach(() => {
  gate.mockReset();
  recordAudit.mockClear();
  revalidatePath.mockReset();
  gifts.recordOfflineGift.mockReset();
  gifts.voidGift.mockReset();
  searchDonors.mockReset();
});

describe("recordOfflineGiftAction", () => {
  it("asks the gate for giving.record and returns its refusal without touching the library", async () => {
    gate.mockResolvedValue({ ok: false, error: "nope" });
    expect(await recordOfflineGiftAction("s", input())).toEqual({ ok: false, error: "nope" });
    expect(gate).toHaveBeenCalledWith("s", ["record"]);
    expect(gifts.recordOfflineGift).not.toHaveBeenCalled();
  });

  it("validates first: a bad amount and a bad date come back as inline errors, nothing recorded", async () => {
    gate.mockResolvedValue(IDENTITY);
    const result = await recordOfflineGiftAction("s", input({ amount: "$5", occurredOn: "2026-02-30" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { amount: expect.any(String), occurredOn: expect.any(String) } });
    expect(gifts.recordOfflineGift).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("on ok: the library gets the SESSION's person, org and user (never client ids) and the audit is ids + method + cents", async () => {
    gate.mockResolvedValue(IDENTITY);
    gifts.recordOfflineGift.mockResolvedValue({ kind: "ok", giftId: GIFT, donorId: DONOR, amountCents: 12_550, createdDonor: false });
    const result = await recordOfflineGiftAction("alder-creek", input());
    expect(result).toEqual({ ok: true, data: { status: "recorded", giftId: GIFT, donorId: DONOR } });
    expect(gifts.recordOfflineGift).toHaveBeenCalledWith("person-1", "org-1", "user-1", expect.objectContaining({ method: "check", checkNumber: "1042" }));
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_gift.recorded",
      resourceType: "giving_gift",
      resourceId: GIFT,
      metadata: { organizationId: "org-1", giftId: GIFT, donorId: DONOR, fundId: FUND, method: "check", amountCents: 12_550, createdDonor: false },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toMatch(/Fenwick|1042/);
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/giving/gifts");
  });

  it("a gift that created a donor also audits the donor creation", async () => {
    gate.mockResolvedValue(IDENTITY);
    gifts.recordOfflineGift.mockResolvedValue({ kind: "ok", giftId: GIFT, donorId: DONOR, amountCents: 100, createdDonor: true });
    await recordOfflineGiftAction("s", input({ donor: { mode: "new", displayName: "Barnaby Quill" }, method: "cash", checkNumber: "" }));
    expect(recordAudit.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      "tenant.giving_gift.recorded",
      "tenant.giving_donor.created",
    ]);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Barnaby");
  });

  it("the two soft warnings are ok-with-status and write NOTHING (no audit, no revalidation)", async () => {
    gate.mockResolvedValue(IDENTITY);
    gifts.recordOfflineGift.mockResolvedValue({ kind: "duplicate_warning", giftId: GIFT });
    expect(await recordOfflineGiftAction("s", input())).toEqual({ ok: true, data: { status: "duplicate_gift", giftId: GIFT } });
    gifts.recordOfflineGift.mockResolvedValue({ kind: "duplicate_donor", donors: [{ id: DONOR, displayName: "Josephine" }] });
    expect(await recordOfflineGiftAction("s", input())).toEqual({ ok: true, data: { status: "duplicate_donor", donors: [{ id: DONOR, displayName: "Josephine" }] } });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "retired_fund" }, { fieldErrors: { fundId: expect.any(String) }, error: expect.stringMatching(/retired/i) }],
    [{ kind: "future_date" }, { fieldErrors: { occurredOn: expect.any(String) }, error: expect.stringMatching(/future/i) }],
    [{ kind: "unidentified_method" }, { fieldErrors: { method: expect.any(String) }, error: expect.stringMatching(/only cash/i) }],
    [{ kind: "invalid", fieldErrors: { "donor.donorId": "gone" } }, { fieldErrors: { "donor.donorId": "gone" } }],
    [{ kind: "forbidden" }, { error: expect.stringMatching(/permission/i) }],
  ])("maps %j to a plain-language failure with no audit", async (libResult, expected) => {
    gate.mockResolvedValue(IDENTITY);
    gifts.recordOfflineGift.mockResolvedValue(libResult);
    expect(await recordOfflineGiftAction("s", input())).toMatchObject({ ok: false, ...expected });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("voidGiftAction", () => {
  const body = { giftId: GIFT, reason: "Keyed twice by mistake" };

  it("asks for giving.record, validates the reason, then voids with the session identity", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await voidGiftAction("s", { giftId: GIFT, reason: "x" })).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect(gifts.voidGift).not.toHaveBeenCalled();
    gifts.voidGift.mockResolvedValue({ kind: "ok", reversalId: "r1", amountCents: 3_000 });
    expect(await voidGiftAction("alder-creek", body)).toEqual({ ok: true });
    expect(gate).toHaveBeenCalledWith("s", ["record"]);
    expect(gifts.voidGift).toHaveBeenCalledWith("person-1", "org-1", "user-1", { giftId: GIFT, reason: "Keyed twice by mistake" });
  });

  it("audits ids and cents but NOT the reason", async () => {
    gate.mockResolvedValue(IDENTITY);
    gifts.voidGift.mockResolvedValue({ kind: "ok", reversalId: "r1", amountCents: 3_000 });
    await voidGiftAction("s", body);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_gift.voided",
      resourceType: "giving_gift",
      resourceId: GIFT,
      metadata: { organizationId: "org-1", giftId: GIFT, reversalId: "r1", amountCents: 3_000 },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Keyed twice");
  });

  it.each([
    [{ kind: "not_voidable", reason: "already_voided" }, /already been voided/],
    [{ kind: "not_voidable", reason: "outside_window" }, /30 days/],
    [{ kind: "not_voidable", reason: "not_offline" }, /Refund an online gift in Stripe/],
    [{ kind: "not_found" }, /no longer exists/],
    [{ kind: "forbidden" }, /can't void/],
  ])("maps %j", async (libResult, pattern) => {
    gate.mockResolvedValue(IDENTITY);
    gifts.voidGift.mockResolvedValue(libResult);
    const result = await voidGiftAction("s", body);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(pattern);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("searchDonorsAction", () => {
  it("is open to record OR view, returns the picker rows, and passes the query through the library (which bounds it)", async () => {
    gate.mockResolvedValue(IDENTITY);
    searchDonors.mockResolvedValue({ kind: "ok", donors: [{ id: DONOR, displayName: "Josephine", kind: "identified", hasEmail: true }] });
    expect(await searchDonorsAction("s", "jos")).toEqual({ ok: true, data: { donors: [{ id: DONOR, displayName: "Josephine", kind: "identified", hasEmail: true }] } });
    expect(gate).toHaveBeenCalledWith("s", ["record", "view"]);
    expect(searchDonors).toHaveBeenCalledWith("person-1", "org-1", "jos");
  });

  it("coerces a non-string query to empty rather than throwing, and reports a library refusal", async () => {
    gate.mockResolvedValue(IDENTITY);
    searchDonors.mockResolvedValue({ kind: "forbidden" });
    expect(await searchDonorsAction("s", 42 as never)).toEqual({ ok: false, error: "You don't have permission to look up donors here." });
    expect(searchDonors).toHaveBeenCalledWith("person-1", "org-1", "");
  });

  it("writes no audit row (a read)", async () => {
    gate.mockResolvedValue(IDENTITY);
    searchDonors.mockResolvedValue({ kind: "ok", donors: [] });
    await searchDonorsAction("s", "x");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
