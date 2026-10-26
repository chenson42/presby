/**
 * The treasurer-tree server actions with the gate and the library mocked: the
 * gate runs FIRST with the KEY each verb needs (pay / view / manage) and a
 * refusal short-circuits everything; input is validated before the library is
 * touched; the SLUG (never an organization id, a person id, a payer, a self-paid
 * flag or an approval path from the client) is what is gated; outcomes map to
 * Copy strings; both trees are revalidated; nothing here touches the database.
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Layer 3, Batch 4.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  recordPayment: vi.fn(),
  reversePayment: vi.fn(),
  waiveReceipt: vi.fn(),
  voidRequest: vi.fn(),
  addNote: vi.fn(),
  approveRequest: vi.fn(),
  returnRequest: vi.fn(),
  getRequestDetail: vi.fn(),
  setChargeable: vi.fn(),
  saveCategory: vi.fn(),
  endCategory: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/reimbursement/gate", () => ({ gateReimbursementAction: mocks.gate }));
vi.mock("@/lib/reimbursement/payments", () => ({
  recordPayment: mocks.recordPayment,
  reversePayment: mocks.reversePayment,
  waiveReceipt: mocks.waiveReceipt,
  voidRequest: mocks.voidRequest,
  addNote: mocks.addNote,
}));
vi.mock("@/lib/reimbursement/decisions", () => ({
  approveRequest: mocks.approveRequest,
  returnRequest: mocks.returnRequest,
}));
vi.mock("@/lib/reimbursement/reads", () => ({ getRequestDetail: mocks.getRequestDetail }));
vi.mock("@/lib/reimbursement/config", () => ({
  setChargeable: mocks.setChargeable,
  saveCategory: mocks.saveCategory,
  endCategory: mocks.endCategory,
}));

import {
  addNoteAction,
  endCategoryAction,
  overrideApproveAction,
  recordPaymentAction,
  reversePaymentAction,
  saveCategoryAction,
  setChargeableAction,
  treasuryReturnAction,
  voidAction,
  waiveReceiptAction,
} from "./actions";

const IDENTITY = {
  ok: true as const,
  userId: "user-1",
  email: "pat@example.invalid",
  personId: "person-1",
  organizationId: "org-1",
  organizationName: "Alder Creek Church",
  organizationType: "congregation",
  slug: "alder",
  has: { requestForOthers: false, view: true, pay: true, manage: false },
};
const REQ = "22222222-2222-4222-8222-222222222222";
const GROUP = "11111111-1111-4111-8111-111111111111";
const pay = { requestId: REQ, method: "check", reference: "1042", paidOn: "2026-10-20", note: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue(IDENTITY);
});

const ALL_LIBS = () => [
  mocks.recordPayment, mocks.reversePayment, mocks.waiveReceipt, mocks.voidRequest, mocks.addNote,
  mocks.approveRequest, mocks.returnRequest, mocks.setChargeable, mocks.saveCategory, mocks.endCategory, mocks.revalidatePath,
];

describe("every action gates first, with the key its verb needs, and short-circuits on a refusal", () => {
  const refusal = { ok: false, error: "Please confirm your two-factor code to continue.", kind: "two_factor_required", redirectTo: "/totp?callbackUrl=x" };
  const cases: Array<[string, "pay" | "view" | "manage", () => Promise<unknown>]> = [
    ["recordPaymentAction", "pay", () => recordPaymentAction("alder", pay)],
    ["reversePaymentAction", "pay", () => reversePaymentAction("alder", { requestId: REQ, reason: "Wrong payee" })],
    ["waiveReceiptAction", "pay", () => waiveReceiptAction("alder", { requestId: REQ })],
    ["treasuryReturnAction", "pay", () => treasuryReturnAction("alder", { requestId: REQ, expectedRevision: 1, reason: "Why" })],
    ["voidAction", "pay", () => voidAction("alder", { requestId: REQ, reason: "Duplicate" })],
    ["overrideApproveAction", "pay", () => overrideApproveAction("alder", { requestId: REQ, expectedRevision: 1 })],
    ["addNoteAction", "view", () => addNoteAction("alder", { requestId: REQ, note: "Mailed" })],
    ["setChargeableAction", "manage", () => setChargeableAction("alder", { groupId: GROUP, chargeable: true })],
    ["saveCategoryAction", "manage", () => saveCategoryAction("alder", { name: "Supplies" })],
    ["endCategoryAction", "manage", () => endCategoryAction("alder", { categoryId: GROUP })],
  ];

  it.each(cases)("%s returns the gate's failure untouched and calls nothing else", async (_name, _key, run) => {
    mocks.gate.mockResolvedValue(refusal);
    expect(await run()).toEqual(refusal);
    for (const fn of ALL_LIBS()) expect(fn).not.toHaveBeenCalled();
    expect(mocks.getRequestDetail).not.toHaveBeenCalled();
  });

  it.each(cases)("%s asks the gate for the %s key by the SLUG", async (_name, key, run) => {
    for (const fn of ALL_LIBS()) fn.mockResolvedValue({ kind: "ok", changed: true, categoryId: GROUP, created: true, paymentId: "p", selfPaid: false });
    await run();
    expect(mocks.gate).toHaveBeenCalledWith("alder", { anyOf: [key] });
  });
});

describe("recordPaymentAction", () => {
  it("records, says so, reports self-paid, and refreshes both trees", async () => {
    mocks.recordPayment.mockResolvedValue({ kind: "ok", paymentId: "p-1", selfPaid: true });
    expect(await recordPaymentAction("alder", pay)).toEqual({ ok: true, data: { message: "Payment recorded.", selfPaid: true } });
    const [actor, values] = mocks.recordPayment.mock.calls[0]!;
    expect(actor).toMatchObject({ userId: "user-1", personId: "person-1", organizationId: "org-1" });
    expect(values).toEqual({ requestId: REQ, method: "check", reference: "1042", paidOn: "2026-10-20", note: null });
    for (const path of [
      "/o/alder/admin/reimbursements", `/o/alder/admin/reimbursements/${REQ}`,
      "/o/alder/reimbursements", `/o/alder/reimbursements/${REQ}`,
    ]) expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
  });

  it("an organization id, a payer, a self-paid flag or a person id in the input is never read", async () => {
    mocks.recordPayment.mockResolvedValue({ kind: "ok", paymentId: "p-1", selfPaid: false });
    await recordPaymentAction("alder", { ...pay, organizationId: "org-evil", paidBy: "u", selfPaid: true, personId: "p" });
    const [actor, values] = mocks.recordPayment.mock.calls[0]!;
    expect(actor.organizationId).toBe("org-1");
    expect(Object.keys(values).sort()).toEqual(["method", "note", "paidOn", "reference", "requestId"]);
  });

  it("a check without its number never reaches the library: 'Enter a check number.' next to the field", async () => {
    expect(await recordPaymentAction("alder", { ...pay, reference: "" })).toMatchObject({
      ok: false, error: "Enter a check number.", fieldErrors: { reference: "Enter a check number." },
    });
    expect(mocks.recordPayment).not.toHaveBeenCalled();
  });

  it("maps each blocking outcome to its C8 sentence", async () => {
    const expected: Record<string, string> = {
      payer_is_approver: "A different person must record this payment.",
      needs_another_payer: "Another person who can record payments should do this, because you entered this request or are being paid by it.",
      receipt_missing: "Add a receipt or waive it before paying.",
      not_payable: "This request isn't waiting for payment.",
      already_paid: "This payment was already recorded.",
    };
    for (const [outcome, error] of Object.entries(expected)) {
      mocks.recordPayment.mockResolvedValue({ kind: "refused", outcome });
      expect(await recordPaymentAction("alder", pay), outcome).toMatchObject({ ok: false, error });
    }
    mocks.recordPayment.mockResolvedValue({ kind: "refused", outcome: "not_found" });
    expect(await recordPaymentAction("alder", pay)).toEqual({ ok: false, error: "This request isn't available.", kind: "not_found" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("an identity refusal from the database is a plain 'not permitted'; a database failure propagates, never 'not allowed'", async () => {
    mocks.recordPayment.mockResolvedValue({ kind: "denied" });
    expect(await recordPaymentAction("alder", pay)).toEqual({ ok: false, error: "You don't have permission to do that." });
    mocks.recordPayment.mockRejectedValue(new Error("connection reset"));
    await expect(recordPaymentAction("alder", pay)).rejects.toThrow("connection reset");
  });
});

describe("the reason verbs", () => {
  it("reverse: succeeds with the C8 text; a missing reason is 'Give a reason.' before the library", async () => {
    mocks.reversePayment.mockResolvedValue({ kind: "ok", paymentId: "r-1" });
    expect(await reversePaymentAction("alder", { requestId: REQ, reason: "  Wrong payee " })).toEqual({
      ok: true, data: { message: "Payment reversed." },
    });
    expect(mocks.reversePayment.mock.calls[0]![1]).toEqual({ requestId: REQ, reason: "Wrong payee" });
    expect(await reversePaymentAction("alder", { requestId: REQ, reason: " " })).toMatchObject({
      ok: false, fieldErrors: { reason: "Give a reason." },
    });
    expect(mocks.reversePayment).toHaveBeenCalledTimes(1);
  });

  it("void: succeeds with the C8 text; a request that cannot be voided is the neutral string", async () => {
    mocks.voidRequest.mockResolvedValue({ kind: "ok" });
    expect(await voidAction("alder", { requestId: REQ, reason: "Duplicate" })).toEqual({ ok: true, data: { message: "Request voided." } });
    mocks.voidRequest.mockResolvedValue({ kind: "refused", outcome: "not_voidable" });
    expect(await voidAction("alder", { requestId: REQ, reason: "Duplicate" })).toEqual({ ok: false, error: "This request isn't available.", kind: "not_found" });
  });

  it("waive: the note is optional; a request that cannot take a waiver is the neutral string", async () => {
    mocks.waiveReceipt.mockResolvedValue({ kind: "ok" });
    expect(await waiveReceiptAction("alder", { requestId: REQ })).toEqual({ ok: true, data: { message: "Receipt waived." } });
    expect(mocks.waiveReceipt.mock.calls[0]![1]).toEqual({ requestId: REQ, note: null });
    mocks.waiveReceipt.mockResolvedValue({ kind: "refused", outcome: "receipt_present" });
    expect(await waiveReceiptAction("alder", { requestId: REQ })).toMatchObject({ kind: "not_found" });
  });

  it("a note: needs the view key, is internal, and revalidates only the treasury page", async () => {
    mocks.addNote.mockResolvedValue({ kind: "ok" });
    expect(await addNoteAction("alder", { requestId: REQ, note: "Mailed Monday" })).toEqual({ ok: true, data: { message: "Note added." } });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/o/alder/admin/reimbursements/${REQ}`);
    mocks.addNote.mockResolvedValue({ kind: "refused", outcome: "note_too_long" });
    expect(await addNoteAction("alder", { requestId: REQ, note: "x" })).toMatchObject({ fieldErrors: { note: "Use 500 characters or fewer." } });
  });
});

describe("treasuryReturnAction", () => {
  it("sends back for CHANGES only - a posted kind is dropped, so the treasurer's door cannot mark a request not approved", async () => {
    mocks.returnRequest.mockResolvedValue({ kind: "ok", returnedKind: "needs_info", decidedOn: "2026-10-26" });
    expect(await treasuryReturnAction("alder", { requestId: REQ, expectedRevision: 2, reason: "Add the invoice", kind: "not_approved" })).toEqual({
      ok: true, data: { message: "Sent back." },
    });
    expect(mocks.returnRequest.mock.calls[0]![1]).toEqual({ requestId: REQ, expectedRevision: 2, reason: "Add the invoice", kind: "needs_info" });
  });

  it("already decided reads with the date and no actor; stale revision and dead ends map as for the seat", async () => {
    mocks.returnRequest.mockResolvedValue({ kind: "already_decided", decidedOn: "2026-10-25", status: "returned" });
    expect(await treasuryReturnAction("alder", { requestId: REQ, expectedRevision: 2, reason: "Why" })).toMatchObject({
      ok: false, kind: "already_decided", error: "This was already sent back on October 25, 2026.", decidedOn: "2026-10-25",
    });
    mocks.returnRequest.mockResolvedValue({ kind: "refused", outcome: "changed_since_viewed" });
    expect(await treasuryReturnAction("alder", { requestId: REQ, expectedRevision: 2, reason: "Why" })).toMatchObject({ kind: "changed_since_viewed" });
    mocks.returnRequest.mockResolvedValue({ kind: "refused", outcome: "not_returnable" });
    expect(await treasuryReturnAction("alder", { requestId: REQ, expectedRevision: 2, reason: "Why" })).toMatchObject({ kind: "not_found" });
  });
});

describe("overrideApproveAction", () => {
  it("is ALWAYS the override path - a posted path is dropped", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "ok", path: "override", decidedOn: "2026-10-26" });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3, path: "seat" })).toEqual({
      ok: true, data: { message: "Approved." },
    });
    expect(mocks.approveRequest.mock.calls[0]![1]).toEqual({ requestId: REQ, expectedRevision: 3, path: "override" });
  });

  it("seat_holder_exists names the group from the member-level detail", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "refused", outcome: "seat_holder_exists" });
    mocks.getRequestDetail.mockResolvedValue({ kind: "ok", detail: { group: { id: GROUP, name: "Property Committee" } } });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 })).toEqual({
      ok: false, error: "Someone in Property Committee can approve this, so it needs their approval.",
    });
    expect(mocks.getRequestDetail).toHaveBeenCalledWith(IDENTITY, REQ, "member");
  });

  it("seat_holder_exists for a viewer who cannot read the request says 'the group'", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "refused", outcome: "seat_holder_exists" });
    mocks.getRequestDetail.mockResolvedValue({ kind: "not_found" });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 })).toMatchObject({
      error: "Someone in the group can approve this, so it needs their approval.",
    });
  });

  it("needs_second_payer: the team suggestion is for a viewer who holds manage ONLY", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "refused", outcome: "needs_second_payer" });
    const payOnly = await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 });
    expect(payOnly).toEqual({ ok: false, error: "This needs a second person who can record payments before you can approve it. Whoever approves can't also pay." });
    expect(mocks.getRequestDetail).not.toHaveBeenCalled();
    mocks.gate.mockResolvedValue({ ...IDENTITY, has: { ...IDENTITY.has, manage: true } });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 })).toMatchObject({
      ok: false, suggestTeam: true,
    });
  });

  it("already decided, stale revision and the neutral dead end", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "already_decided", decidedOn: "2026-10-25", status: "approved" });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 })).toMatchObject({
      kind: "already_decided", error: "This was already approved on October 25, 2026.",
    });
    mocks.approveRequest.mockResolvedValue({ kind: "refused", outcome: "changed_since_viewed" });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 })).toMatchObject({ kind: "changed_since_viewed" });
    mocks.approveRequest.mockResolvedValue({ kind: "refused", outcome: "not_approvable" });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 })).toMatchObject({ kind: "not_found" });
  });

  it("without the pay key at the database the answer is a plain 'not permitted'", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "denied" });
    expect(await overrideApproveAction("alder", { requestId: REQ, expectedRevision: 3 })).toEqual({ ok: false, error: "You don't have permission to do that." });
  });
});

describe("settings verbs", () => {
  it("setChargeable reports whether anything changed and refreshes the settings page and the request form", async () => {
    mocks.setChargeable.mockResolvedValue({ kind: "ok", changed: false });
    expect(await setChargeableAction("alder", { groupId: GROUP, chargeable: true })).toEqual({ ok: true, data: { changed: false } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/alder/admin/reimbursements/settings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/alder/reimbursements/new");
    mocks.setChargeable.mockResolvedValue({ kind: "refused", outcome: "group_unavailable" });
    expect(await setChargeableAction("alder", { groupId: GROUP, chargeable: true })).toEqual({
      ok: false, error: "That group can't receive requests right now. Choose another.",
    });
    expect(await setChargeableAction("alder", { groupId: "nope", chargeable: true })).toMatchObject({ ok: false });
  });

  it("saveCategory validates the name with the Copy sentence and maps the definer's refusals to it", async () => {
    expect(await saveCategoryAction("alder", { name: "   " })).toMatchObject({ ok: false, fieldErrors: { name: "Use 1 to 60 characters." } });
    expect(mocks.saveCategory).not.toHaveBeenCalled();
    mocks.saveCategory.mockResolvedValue({ kind: "refused", outcome: "name_taken" });
    expect(await saveCategoryAction("alder", { name: "Supplies" })).toMatchObject({
      ok: false, fieldErrors: { name: "You already have a category with that name." },
    });
    mocks.saveCategory.mockResolvedValue({ kind: "ok", categoryId: GROUP, created: true });
    expect(await saveCategoryAction("alder", { categoryId: null, name: " Supplies ", sortOrder: 2 })).toEqual({
      ok: true, data: { categoryId: GROUP, created: true },
    });
    expect(mocks.saveCategory.mock.calls.at(-1)![1]).toEqual({ categoryId: null, name: "Supplies", sortOrder: 2 });
  });

  it("endCategory retires; a database refusal of identity is 'not permitted'", async () => {
    mocks.endCategory.mockResolvedValue({ kind: "ok" });
    expect(await endCategoryAction("alder", { categoryId: GROUP })).toEqual({ ok: true, data: undefined });
    mocks.endCategory.mockResolvedValue({ kind: "denied" });
    expect(await endCategoryAction("alder", { categoryId: GROUP })).toEqual({ ok: false, error: "You don't have permission to do that." });
  });
});

describe("no audit row is written here (the library writes it in the change's own transaction)", () => {
  it("imports nothing from the audit modules", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/audit/);
    expect(source).not.toMatch(/recordAudit|insertAuditRow/);
    expect(source).not.toMatch(/getPlatformDb|from "@\/lib\/db"/);
  });
});
