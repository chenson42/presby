/**
 * Orchestration tests for the statements actions (docs/work-log/2026-10-15-
 * online-giving.md, Batch 5b): the shared gate first, validation before the
 * library, the audit event written AFTER and only for what happened, ids and
 * counts in the metadata and never a name, address or amount.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
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
    GIVING_STATEMENT_ISSUED: "tenant.giving_statement.issued",
    GIVING_STATEMENT_REISSUED: "tenant.giving_statement.reissued",
    GIVING_STATEMENT_NOTICE_SENT: "tenant.giving_statement.notice_sent",
    GIVING_STATEMENT_DELIVERY_RECORDED: "tenant.giving_statement.delivery_recorded",
  },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const lib = vi.hoisted(() => ({
  issueStatementBatch: vi.fn(),
  reissueStatement: vi.fn(),
  recordDelivery: vi.fn(),
  sendStatementNotices: vi.fn(),
}));
vi.mock("@/lib/giving/statements", () => lib);
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import {
  issueStatementBatchAction,
  recordDeliveryAction,
  reissueStatementAction,
  sendStatementNoticesAction,
} from "./actions";

const IDENTITY = { ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", has: { view: true, record: true, manage: true } };
const SID = "11111111-1111-4111-8111-111111111111";
const DID = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  gate.mockReset();
  recordAudit.mockClear();
  revalidatePath.mockReset();
  for (const fn of Object.values(lib)) fn.mockReset();
});

describe("issueStatementBatchAction", () => {
  const ok = (over: Record<string, unknown> = {}) => ({
    kind: "ok", issued: 2, skipped: 0, failed: [], nextCursor: null,
    issuedStatements: [{ statementId: SID, donorId: DID, version: 1 }, { statementId: "s2", donorId: "d2", version: 1 }], ...over,
  });

  it("asks for giving.manage and returns the gate's refusal untouched, calling nothing", async () => {
    gate.mockResolvedValue({ ok: false, error: "nope", kind: "two_factor_required", redirectTo: "/totp" });
    expect(await issueStatementBatchAction("s", { year: 2027 })).toEqual({ ok: false, error: "nope", kind: "two_factor_required", redirectTo: "/totp" });
    expect(gate).toHaveBeenCalledWith("s", ["manage"]);
    expect(lib.issueStatementBatch).not.toHaveBeenCalled();
  });

  it("validates the year and the cursor before the library", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await issueStatementBatchAction("s", { year: "2027" })).toMatchObject({ ok: false, fieldErrors: { year: expect.any(String) } });
    expect(await issueStatementBatchAction("s", { year: 1999 })).toMatchObject({ ok: false });
    expect(await issueStatementBatchAction("s", { year: 2027, cursor: "not-a-uuid" })).toMatchObject({ ok: false, fieldErrors: { cursor: expect.any(String) } });
    expect(lib.issueStatementBatch).not.toHaveBeenCalled();
  });

  it("passes the actor and cursor through, audits EACH issued statement with ids only, and returns the loop's data", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.issueStatementBatch.mockResolvedValue(ok({ nextCursor: DID }));
    const result = await issueStatementBatchAction("alder-creek", { year: 2027, cursor: SID });
    expect(lib.issueStatementBatch).toHaveBeenCalledWith("person-1", "org-1", "user-1", { year: 2027, cursor: SID });
    expect(result).toEqual({ ok: true, data: { issued: 2, skipped: 0, failed: [], nextCursor: DID } });
    expect(recordAudit).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenNthCalledWith(1, {
      action: "tenant.giving_statement.issued",
      resourceType: "giving_statement",
      resourceId: SID,
      metadata: { organizationId: "org-1", statementId: SID, donorId: DID, taxYear: 2027, version: 1 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/giving/statements");
  });

  it("writes no audit event when nothing was issued", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.issueStatementBatch.mockResolvedValue(ok({ issued: 0, issuedStatements: [] }));
    await issueStatementBatchAction("s", { year: 2027 });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a failed donor is returned by name and reason for the dialog to list; the audit covers only the issued ones", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.issueStatementBatch.mockResolvedValue(ok({ issued: 1, issuedStatements: [{ statementId: SID, donorId: DID, version: 1 }], failed: [{ donorId: "d9", donorName: "Fixture Donor", reason: "consistency" }] }));
    const result = await issueStatementBatchAction("s", { year: 2027 });
    expect(result).toMatchObject({ ok: true, data: { failed: [{ donorId: "d9", donorName: "Fixture Donor", reason: "consistency" }] } });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Fixture Donor");
  });

  it.each([
    ["forbidden", /manage and view/],
    ["disabled", /switched on once your accountant/],
    ["invalid_year", /year/],
  ])("%s is a plain refusal with no audit", async (kind, message) => {
    gate.mockResolvedValue(IDENTITY);
    lib.issueStatementBatch.mockResolvedValue({ kind });
    expect(await issueStatementBatchAction("s", { year: 2027 })).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("blocked names what is missing", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.issueStatementBatch.mockResolvedValue({ kind: "blocked", blockers: ["donee_name", "donee_address"] });
    const result = await issueStatementBatchAction("s", { year: 2027 });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/legal name.*mailing address/) });
  });
});

describe("reissueStatementAction", () => {
  it("audits the correction with the new id, the superseded id and the version", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.reissueStatement.mockResolvedValue({ kind: "ok", statementId: DID, version: 2 });
    expect(await reissueStatementAction("alder-creek", SID)).toEqual({ ok: true, data: { statementId: DID, version: 2 } });
    expect(lib.reissueStatement).toHaveBeenCalledWith("person-1", "org-1", "user-1", SID);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_statement.reissued",
      resourceType: "giving_statement",
      resourceId: DID,
      metadata: { organizationId: "org-1", statementId: DID, supersedesId: SID, version: 2 },
    });
  });

  it("rejects a malformed id before the library", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await reissueStatementAction("s", "../x")).toMatchObject({ ok: false });
    expect(lib.reissueStatement).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", /manage and view/],
    ["disabled", /switched on once/],
    ["not_found", /no longer exists/],
    ["not_latest", /newer version/],
    ["not_stale", /up to date/],
    ["already_reissued", /just issued a correction/],
    ["nothing_to_count", /refunded/],
    ["failed", /try again/],
  ])("%s is a plain refusal with no audit", async (kind, message) => {
    gate.mockResolvedValue(IDENTITY);
    lib.reissueStatement.mockResolvedValue({ kind });
    expect(await reissueStatementAction("s", SID)).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("recordDeliveryAction", () => {
  it("audits the first mark and not a repeat", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.recordDelivery.mockResolvedValueOnce({ kind: "ok", alreadyRecorded: false }).mockResolvedValueOnce({ kind: "ok", alreadyRecorded: true });
    expect(await recordDeliveryAction("s", SID)).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_statement.delivery_recorded",
      resourceType: "giving_statement",
      resourceId: SID,
      metadata: { organizationId: "org-1", statementId: SID, channel: "print_mailed" },
    });
    expect(await recordDeliveryAction("s", SID)).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("refusals write nothing", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.recordDelivery.mockResolvedValue({ kind: "forbidden" });
    expect(await recordDeliveryAction("s", SID)).toMatchObject({ ok: false, error: expect.stringMatching(/permission/) });
    lib.recordDelivery.mockResolvedValue({ kind: "not_found" });
    expect(await recordDeliveryAction("s", SID)).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    expect(await recordDeliveryAction("s", "nope")).toMatchObject({ ok: false });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("sendStatementNoticesAction", () => {
  it("audits one event per call with the year, a count and statement ids - no email address", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.sendStatementNotices.mockResolvedValue({ kind: "ok", sent: 2, skipped: 0, failed: 0, nextCursor: null, sentStatements: [{ statementId: SID, version: 1 }, { statementId: DID, version: 1 }] });
    expect(await sendStatementNoticesAction("s", { year: 2027 })).toEqual({ ok: true, data: { sent: 2, skipped: 0, failed: 0, nextCursor: null } });
    expect(lib.sendStatementNotices).toHaveBeenCalledWith("person-1", "org-1", "user-1", { year: 2027, cursor: null });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_statement.notice_sent",
      resourceType: "giving_statements",
      resourceId: "org-1",
      metadata: { organizationId: "org-1", taxYear: 2027, sent: 2, statementIds: [SID, DID] },
    });
  });

  it("writes no audit event when nothing was sent, and validates the year", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.sendStatementNotices.mockResolvedValue({ kind: "ok", sent: 0, skipped: 3, failed: 0, nextCursor: null, sentStatements: [] });
    await sendStatementNoticesAction("s", { year: 2027 });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(await sendStatementNoticesAction("s", { year: "x" })).toMatchObject({ ok: false });
  });

  it.each([
    ["forbidden", /permission/],
    ["invalid_year", /year/],
    ["origin_unconfigured", /secure web address/],
  ])("%s is a plain refusal", async (kind, message) => {
    gate.mockResolvedValue(IDENTITY);
    lib.sendStatementNotices.mockResolvedValue({ kind });
    expect(await sendStatementNoticesAction("s", { year: 2027 })).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// zod 4 characterization (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 2):
// the id schemas accept the project's non-RFC ids and reject a malformed one.
// Where the action returns fixed copy for a bad id, that string is pinned
// exactly; the per-field zod text (cursor, year) is tamper-only, so those pin
// the action's fixed copy and the failing path only.
// ---------------------------------------------------------------------------
describe("id inputs accept non-RFC ids and refuse malformed ones", () => {
  const NON_RFC = ["00000000-0000-0000-0000-000000000005", "d9100000-0000-0000-0000-000000000010"];
  const GONE = "That statement no longer exists.";

  it.each(NON_RFC)("reissue and record-delivery reach the library with statement id %s", async (id) => {
    gate.mockResolvedValue(IDENTITY);
    lib.reissueStatement.mockResolvedValue({ kind: "ok", statementId: id, version: 2 });
    lib.recordDelivery.mockResolvedValue({ kind: "ok", alreadyRecorded: true });
    expect(await reissueStatementAction("s", id)).toMatchObject({ ok: true });
    expect(await recordDeliveryAction("s", id)).toEqual({ ok: true });
    expect(lib.reissueStatement).toHaveBeenCalledWith("person-1", "org-1", "user-1", id);
    expect(lib.recordDelivery).toHaveBeenCalledWith("person-1", "org-1", "user-1", id);
  });

  it("refuses a malformed statement id with the fixed copy and no library call", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await reissueStatementAction("s", "not-a-uuid")).toEqual({ ok: false, error: GONE });
    expect(await recordDeliveryAction("s", "not-a-uuid")).toEqual({ ok: false, error: GONE });
    expect(await reissueStatementAction("s", undefined)).toEqual({ ok: false, error: GONE });
    expect(lib.reissueStatement).not.toHaveBeenCalled();
    expect(lib.recordDelivery).not.toHaveBeenCalled();
  });

  it.each(NON_RFC)("issue and notices accept the cursor %s, and null or absent", async (cursor) => {
    gate.mockResolvedValue(IDENTITY);
    lib.issueStatementBatch.mockResolvedValue({ kind: "ok", issued: 0, skipped: 0, failed: [], nextCursor: null, issuedStatements: [] });
    lib.sendStatementNotices.mockResolvedValue({ kind: "ok", sent: 0, skipped: 0, failed: 0, nextCursor: null, sentStatements: [] });
    await issueStatementBatchAction("s", { year: 2027, cursor });
    await sendStatementNoticesAction("s", { year: 2027, cursor });
    expect(lib.issueStatementBatch).toHaveBeenLastCalledWith("person-1", "org-1", "user-1", { year: 2027, cursor });
    expect(lib.sendStatementNotices).toHaveBeenLastCalledWith("person-1", "org-1", "user-1", { year: 2027, cursor });
    await issueStatementBatchAction("s", { year: 2027, cursor: null });
    await issueStatementBatchAction("s", { year: 2027 });
    expect(lib.issueStatementBatch).toHaveBeenLastCalledWith("person-1", "org-1", "user-1", { year: 2027, cursor: null });
  });

  it("refuses a malformed cursor or an out-of-range year at the right path", async () => {
    gate.mockResolvedValue(IDENTITY);
    const INVALID = "Check the highlighted fields and try again.";
    for (const [input, path] of [
      [{ year: 2027, cursor: "not-a-uuid" }, "cursor"],
      [{ year: 1999 }, "year"],
      [{ year: 2101 }, "year"],
      [{ year: 2027.5 }, "year"],
      [{ year: "2027" }, "year"],
    ] as const) {
      for (const action of [issueStatementBatchAction, sendStatementNoticesAction]) {
        const refused = await action("s", input);
        expect(refused).toMatchObject({ ok: false, error: INVALID });
        expect(Object.keys((refused as { fieldErrors: object }).fieldErrors)).toEqual([path]);
      }
    }
    expect(lib.issueStatementBatch).not.toHaveBeenCalled();
    expect(lib.sendStatementNotices).not.toHaveBeenCalled();
  });
});
