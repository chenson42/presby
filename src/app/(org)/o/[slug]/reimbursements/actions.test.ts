/**
 * The member reimbursement server actions with the gate and the library mocked:
 * the gate runs FIRST and a refusal short-circuits everything, input is
 * validated before the library is touched, the slug (never an organization id
 * or a person id from the client) is what is gated, outcomes map to Copy
 * strings, and nothing here writes an audit row (save, submit and withdraw are
 * recorded in reimbursement_events, Phase 3 "Not audited"). Batch 2a; approve and
 * send back (audited and notified inside `decisions.ts`) are Batch 3.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  saveRequest: vi.fn(),
  submitRequest: vi.fn(),
  withdrawRequest: vi.fn(),
  approveRequest: vi.fn(),
  returnRequest: vi.fn(),
  searchBeneficiaries: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/reimbursement/gate", () => ({ gateReimbursementAction: mocks.gate }));
vi.mock("@/lib/reimbursement/requests", () => ({
  saveRequest: mocks.saveRequest,
  submitRequest: mocks.submitRequest,
  withdrawRequest: mocks.withdrawRequest,
}));
vi.mock("@/lib/reimbursement/decisions", () => ({
  approveRequest: mocks.approveRequest,
  returnRequest: mocks.returnRequest,
}));
vi.mock("@/lib/reimbursement/pickers", () => ({ searchBeneficiaries: mocks.searchBeneficiaries }));

import {
  approveRequestAction,
  returnRequestAction,
  saveRequestAction,
  searchBeneficiariesAction,
  submitRequestAction,
  withdrawRequestAction,
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
  has: { requestForOthers: false, view: false, pay: false, manage: false },
};
const GROUP = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const save = { clientKey: "k3y-abcdefgh", kind: "vendor", groupId: GROUP, vendorName: "Hardware Co", amountCents: 4150, expenseDate: "2026-10-20", purpose: "Paint" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue(IDENTITY);
});

describe("every action gates first and short-circuits on a refusal", () => {
  const refusal = { ok: false, error: "Please confirm your two-factor code to continue.", kind: "two_factor_required", redirectTo: "/totp?callbackUrl=x" };

  it.each([
    ["saveRequestAction", () => saveRequestAction("alder", save)],
    ["submitRequestAction", () => submitRequestAction("alder", { requestId: REQ, expectedRevision: 1 })],
    ["withdrawRequestAction", () => withdrawRequestAction("alder", { requestId: REQ })],
    ["searchBeneficiariesAction", () => searchBeneficiariesAction("alder", { query: "Quill" })],
    ["approveRequestAction", () => approveRequestAction("alder", { requestId: REQ, expectedRevision: 1 })],
    ["returnRequestAction", () => returnRequestAction("alder", { requestId: REQ, expectedRevision: 1, kind: "needs_info", reason: "Why" })],
  ])("%s returns the gate's failure untouched and calls nothing else", async (_name, run) => {
    mocks.gate.mockResolvedValue(refusal);
    expect(await run()).toEqual(refusal);
    for (const fn of [mocks.saveRequest, mocks.submitRequest, mocks.withdrawRequest, mocks.approveRequest, mocks.returnRequest, mocks.searchBeneficiaries, mocks.revalidatePath]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("passes the SLUG to the gate - an organization id in the input is never read", async () => {
    mocks.saveRequest.mockResolvedValue({ kind: "ok", requestId: REQ, revision: 1, created: true });
    await saveRequestAction("alder", { ...save, organizationId: "org-evil", personId: "person-evil" });
    expect(mocks.gate).toHaveBeenCalledWith("alder");
    const [actor, values] = mocks.saveRequest.mock.calls[0]!;
    expect(actor.organizationId).toBe("org-1");
    expect(actor.userId).toBe("user-1");
    expect(values.organizationId).toBeUndefined();
    expect(values.personId).toBeUndefined();
  });
});

describe("saveRequestAction", () => {
  it("returns the request id and revision, and refreshes the list and the detail", async () => {
    mocks.saveRequest.mockResolvedValue({ kind: "ok", requestId: REQ, revision: 3, created: false });
    expect(await saveRequestAction("alder", save)).toEqual({ ok: true, data: { requestId: REQ, revision: 3 } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/alder/reimbursements");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/o/alder/reimbursements/${REQ}`);
  });

  it("invalid input never reaches the library; the error is the first field message (a Copy string)", async () => {
    const result = await saveRequestAction("alder", { ...save, amountCents: 12.5 });
    expect(result).toMatchObject({
      ok: false,
      error: "Enter an amount between $0.01 and $100,000.00.",
      fieldErrors: { amountCents: "Enter an amount between $0.01 and $100,000.00." },
    });
    expect(mocks.saveRequest).not.toHaveBeenCalled();
    expect(await saveRequestAction("alder", null)).toMatchObject({ ok: false });
    expect(await saveRequestAction("alder", "nonsense")).toMatchObject({ ok: false });
  });

  it("maps a refused outcome to its field and Copy text", async () => {
    mocks.saveRequest.mockResolvedValue({ kind: "refused", outcome: "date_out_of_range" });
    expect(await saveRequestAction("alder", save)).toMatchObject({
      ok: false,
      fieldErrors: { expenseDate: "Choose a date that isn't in the future or more than a year ago." },
    });
    mocks.saveRequest.mockResolvedValue({ kind: "refused", outcome: "changed_since_viewed" });
    expect(await saveRequestAction("alder", save)).toMatchObject({ ok: false, kind: "changed_since_viewed" });
    mocks.saveRequest.mockResolvedValue({ kind: "refused", outcome: "not_eligible" });
    expect(await saveRequestAction("alder", save)).toMatchObject({
      error: "Requests can be started by members, regular attenders and staff of Alder Creek Church. If you think you should be able to, tell the church office.",
    });
  });

  it("an identity refusal from the database is a plain 'not permitted', not a crash", async () => {
    mocks.saveRequest.mockResolvedValue({ kind: "denied" });
    expect(await saveRequestAction("alder", save)).toEqual({ ok: false, error: "You don't have permission to do that." });
  });

  it("does not swallow a database failure: it propagates so the caller shows its own load/save error, never 'not allowed'", async () => {
    mocks.saveRequest.mockRejectedValue(new Error("connection reset"));
    await expect(saveRequestAction("alder", save)).rejects.toThrow("connection reset");
  });
});

describe("submitRequestAction", () => {
  it("says where it went, by the route the definer computed live", async () => {
    mocks.submitRequest.mockResolvedValue({ kind: "ok", route: "treasurer", groupName: "Property Committee", revision: 2, already: false, notifyPersonIds: ["p"] });
    expect(await submitRequestAction("alder", { requestId: REQ, expectedRevision: 2 })).toEqual({
      ok: true,
      data: {
        route: "treasurer",
        groupName: "Property Committee",
        revision: 2,
        message: "No one in Property Committee is able to approve this, so it was sent to the treasurer.",
      },
    });
  });

  it("a second tap (already_submitted) is a success with no second event", async () => {
    mocks.submitRequest.mockResolvedValue({ kind: "ok", route: null, groupName: "Property Committee", revision: 2, already: true, notifyPersonIds: [] });
    expect(await submitRequestAction("alder", { requestId: REQ, expectedRevision: 2 })).toMatchObject({ ok: true });
  });

  it("incomplete names what is missing next to its field", async () => {
    mocks.submitRequest.mockResolvedValue({ kind: "incomplete", missing: ["receipt", "purpose"] });
    expect(await submitRequestAction("alder", { requestId: REQ, expectedRevision: 2 })).toMatchObject({
      ok: false,
      fieldErrors: {
        receipts: "Add a receipt, or tick “I can't attach a receipt”.",
        purpose: "Tell us what this was for.",
      },
    });
  });

  it("a stale revision tells the requester to review again; the neutral not-found is one string", async () => {
    mocks.submitRequest.mockResolvedValue({ kind: "refused", outcome: "changed_since_viewed" });
    expect(await submitRequestAction("alder", { requestId: REQ, expectedRevision: 1 })).toMatchObject({
      kind: "changed_since_viewed",
      error: "This request changed in another window. Reload to see the latest.",
    });
    mocks.submitRequest.mockResolvedValue({ kind: "refused", outcome: "not_found" });
    expect(await submitRequestAction("alder", { requestId: REQ, expectedRevision: 1 })).toEqual({
      ok: false,
      error: "This request isn't available.",
      kind: "not_found",
    });
  });

  it("rejects a malformed id or revision before the library", async () => {
    expect(await submitRequestAction("alder", { requestId: "nope", expectedRevision: 1 })).toMatchObject({ ok: false });
    expect(await submitRequestAction("alder", { requestId: REQ })).toMatchObject({ ok: false });
    expect(mocks.submitRequest).not.toHaveBeenCalled();
  });
});

describe("withdrawRequestAction", () => {
  it("withdraws", async () => {
    mocks.withdrawRequest.mockResolvedValue({ kind: "ok" });
    expect(await withdrawRequestAction("alder", { requestId: REQ })).toEqual({ ok: true, data: undefined });
    expect(mocks.withdrawRequest.mock.calls[0]![1]).toEqual({ requestId: REQ, reason: null });
  });

  it("says 'already paid' only when the request WAS paid; any other dead end is the neutral string", async () => {
    mocks.withdrawRequest.mockResolvedValue({ kind: "not_withdrawable", status: "paid" });
    expect(await withdrawRequestAction("alder", { requestId: REQ })).toEqual({
      ok: false,
      error: "This request was already paid, so it can't be withdrawn. Ask the treasurer.",
    });
    mocks.withdrawRequest.mockResolvedValue({ kind: "not_withdrawable", status: "voided" });
    expect(await withdrawRequestAction("alder", { requestId: REQ })).toEqual({
      ok: false,
      error: "This request isn't available.",
      kind: "not_found",
    });
  });

  it("a request that is not the caller's is the neutral not-found", async () => {
    mocks.withdrawRequest.mockResolvedValue({ kind: "refused", outcome: "not_found" });
    expect(await withdrawRequestAction("alder", { requestId: REQ })).toMatchObject({ kind: "not_found" });
  });
});

describe("searchBeneficiariesAction", () => {
  it("returns names for a real query", async () => {
    mocks.searchBeneficiaries.mockResolvedValue([{ personId: "p1", displayName: "Pat Quill" }]);
    expect(await searchBeneficiariesAction("alder", { query: "Quill" })).toEqual({
      ok: true,
      data: { candidates: [{ personId: "p1", displayName: "Pat Quill" }] },
    });
    expect(mocks.searchBeneficiaries.mock.calls[0]![1]).toBe("Quill");
  });

  it("a too-short or malformed query is an empty list, not an error (nothing is learned)", async () => {
    expect(await searchBeneficiariesAction("alder", { query: "Q" })).toEqual({ ok: true, data: { candidates: [] } });
    expect(await searchBeneficiariesAction("alder", {})).toEqual({ ok: true, data: { candidates: [] } });
    expect(mocks.searchBeneficiaries).not.toHaveBeenCalled();
  });
});

describe("no audit row from these actions (the events table is their record)", () => {
  it("imports nothing from the audit modules", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(__dirname + "/actions.ts", "utf8");
    expect(source).not.toMatch(/recordAudit|insertAuditRow|auditEvents|@\/lib\/audit/);
  });
});

describe("approveRequestAction", () => {
  const ask = { requestId: REQ, expectedRevision: 3 };

  it("approves on the SEAT path - a posted path, person or organization is never read - and refreshes both trees", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "ok", path: "seat", decidedOn: "2026-10-25" });
    expect(await approveRequestAction("alder", { ...ask, path: "override", personId: "evil", organizationId: "org-evil" })).toEqual({
      ok: true,
      data: { message: "Approved." },
    });
    expect(mocks.gate).toHaveBeenCalledWith("alder");
    const [actor, values] = mocks.approveRequest.mock.calls[0]!;
    expect(actor.organizationId).toBe("org-1");
    expect(actor.userId).toBe("user-1");
    expect(values).toEqual({ requestId: REQ, expectedRevision: 3, path: "seat" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/o/alder/reimbursements/${REQ}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/alder/admin/reimbursements");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/o/alder/admin/reimbursements/${REQ}`);
  });

  it("already decided: the date in words, the raw date and the status, and no actor", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "already_decided", decidedOn: "2026-10-25", status: "approved" });
    const result = await approveRequestAction("alder", ask);
    expect(result).toEqual({
      ok: false,
      error: "This was already approved on October 25, 2026.",
      kind: "already_decided",
      decidedOn: "2026-10-25",
      status: "approved",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("a stale revision tells the approver to review again; every other dead end is the neutral string", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "refused", outcome: "changed_since_viewed" });
    expect(await approveRequestAction("alder", ask)).toEqual({
      ok: false,
      error: "This request changed after you opened it. Review it again.",
      kind: "changed_since_viewed",
    });
    for (const outcome of ["not_found", "not_approvable"]) {
      mocks.approveRequest.mockResolvedValue({ kind: "refused", outcome });
      expect(await approveRequestAction("alder", ask)).toEqual({ ok: false, error: "This request isn't available.", kind: "not_found" });
    }
  });

  it("an identity refusal is a plain 'not permitted'; a database failure propagates, never 'not allowed'", async () => {
    mocks.approveRequest.mockResolvedValue({ kind: "denied" });
    expect(await approveRequestAction("alder", ask)).toEqual({ ok: false, error: "You don't have permission to do that." });
    mocks.approveRequest.mockRejectedValue(new Error("connection reset"));
    await expect(approveRequestAction("alder", ask)).rejects.toThrow("connection reset");
  });

  it("rejects a malformed id or revision before the library", async () => {
    expect(await approveRequestAction("alder", { requestId: "nope", expectedRevision: 1 })).toMatchObject({ ok: false });
    expect(await approveRequestAction("alder", { requestId: REQ })).toMatchObject({ ok: false });
    expect(await approveRequestAction("alder", null)).toMatchObject({ ok: false });
    expect(mocks.approveRequest).not.toHaveBeenCalled();
  });
});

describe("returnRequestAction", () => {
  const ask = { requestId: REQ, expectedRevision: 2, kind: "needs_info", reason: "  Please add the invoice  " };

  it("sends back with the cleaned reason and says so; not approved says that", async () => {
    mocks.returnRequest.mockResolvedValue({ kind: "ok", returnedKind: "needs_info", decidedOn: "2026-10-25" });
    expect(await returnRequestAction("alder", ask)).toEqual({ ok: true, data: { message: "Sent back." } });
    expect(mocks.returnRequest.mock.calls[0]![1]).toEqual({
      requestId: REQ, expectedRevision: 2, kind: "needs_info", reason: "Please add the invoice",
    });
    mocks.returnRequest.mockResolvedValue({ kind: "ok", returnedKind: "not_approved", decidedOn: "2026-10-25" });
    expect(await returnRequestAction("alder", { ...ask, kind: "not_approved" })).toEqual({ ok: true, data: { message: "Marked not approved." } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/alder/admin/reimbursements");
  });

  it("a missing reason is 'Give a reason.' next to the field, before the library is touched", async () => {
    for (const reason of ["", "   ", undefined]) {
      expect(await returnRequestAction("alder", { ...ask, reason })).toMatchObject({
        ok: false,
        error: "Give a reason.",
        fieldErrors: { reason: "Give a reason." },
      });
    }
    expect(await returnRequestAction("alder", { ...ask, reason: "x".repeat(301) })).toMatchObject({
      fieldErrors: { reason: "Use 300 characters or fewer." },
    });
    expect(mocks.returnRequest).not.toHaveBeenCalled();
  });

  it("an unknown kind never reaches the library", async () => {
    expect(await returnRequestAction("alder", { ...ask, kind: "voided" })).toMatchObject({ ok: false });
    expect(mocks.returnRequest).not.toHaveBeenCalled();
  });

  it("already sent back reads 'already sent back on <date>'; a stale revision and the neutral dead end map as for approve", async () => {
    mocks.returnRequest.mockResolvedValue({ kind: "already_decided", decidedOn: "2026-01-02", status: "returned" });
    expect(await returnRequestAction("alder", ask)).toMatchObject({
      error: "This was already sent back on January 2, 2026.",
      kind: "already_decided",
    });
    mocks.returnRequest.mockResolvedValue({ kind: "refused", outcome: "changed_since_viewed" });
    expect(await returnRequestAction("alder", ask)).toMatchObject({ kind: "changed_since_viewed" });
    mocks.returnRequest.mockResolvedValue({ kind: "refused", outcome: "not_returnable" });
    expect(await returnRequestAction("alder", ask)).toEqual({ ok: false, error: "This request isn't available.", kind: "not_found" });
    mocks.returnRequest.mockResolvedValue({ kind: "denied" });
    expect(await returnRequestAction("alder", ask)).toEqual({ ok: false, error: "You don't have permission to do that." });
  });
});
