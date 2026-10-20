/**
 * Platform requeue action (docs/work-log/2026-10-15-online-giving.md, Batch
 * 3b): gate order, the dead-letter lookup that supplies the audit row's
 * organization id, audit ONLY on a real requeue, ids-only metadata.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// audit.ts opens the pool at import time; the real AUDIT_ACTIONS is all this test needs from it.
vi.mock("@/lib/db", () => ({ db: {}, getPlatformDb: vi.fn() }));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const mockRevalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, recordAudit: mockRecordAudit };
});
const mockList = vi.hoisted(() => vi.fn());
const mockRequeue = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/giving-ingest-health", () => ({
  listDeadLetters: (...a: unknown[]) => mockList(...a),
  requeueDeadLetter: (...a: unknown[]) => mockRequeue(...a),
}));

import { AUDIT_ACTIONS } from "@/lib/audit";
import { FEATURES } from "@/lib/permissions";
import { requeueDeadLetterAction } from "./actions";

const EVENT = "11111111-1111-4111-8111-111111111111";
const ROW = {
  eventId: EVENT,
  connectionId: "conn-1",
  organizationId: "org-9",
  externalEventId: "evt_fixture0001",
  eventType: "charge.refunded",
  receivedAt: "2026-10-14T12:00:00.000Z",
  attempts: 8,
  lastErrorClass: "over_reversal",
};
const admin = { user: { id: "u1", features: [FEATURES.ADMIN_ORGANIZATIONS] } };

afterEach(() => {
  for (const fn of [mockAuth, mockRevalidate, mockRecordAudit, mockList, mockRequeue]) fn.mockReset();
  mockRecordAudit.mockResolvedValue(undefined);
});

describe("requeueDeadLetterAction", () => {
  it("refuses a signed-out caller and touches nothing", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await requeueDeadLetterAction(EVENT)).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockList).not.toHaveBeenCalled();
    expect(mockRequeue).not.toHaveBeenCalled();
  });

  it("refuses a caller without ADMIN_ORGANIZATIONS (a different admin feature does not count)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", features: [FEATURES.ADMIN_USERS] } });
    expect(await requeueDeadLetterAction(EVENT)).toEqual({ ok: false, error: "Forbidden." });
    expect(mockRequeue).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-uuid", "11111111-1111-4111-8111-11111111111g"])("refuses a malformed id %j before any read", async (bad) => {
    mockAuth.mockResolvedValue(admin);
    const result = await requeueDeadLetterAction(bad);
    expect(result.ok).toBe(false);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("requeues a listed dead letter and audits it with the organization id FROM THE DATABASE row, ids only", async () => {
    mockAuth.mockResolvedValue(admin);
    mockList.mockResolvedValue([ROW]);
    mockRequeue.mockResolvedValue("requeued");
    expect(await requeueDeadLetterAction(EVENT)).toEqual({ ok: true });
    expect(mockRequeue).toHaveBeenCalledWith(EVENT);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: AUDIT_ACTIONS.ORG_GIVING_EVENT_REQUEUED,
      resourceType: "organization",
      resourceId: "org-9",
      metadata: { organizationId: "org-9", connectionId: "conn-1", eventId: EVENT, eventType: "charge.refunded", attempts: 8 },
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/giving");
    expect(JSON.stringify(mockRecordAudit.mock.calls)).not.toMatch(/evt_|over_reversal/);
  });

  it("an event not in the current dead-letter list is refused WITHOUT calling the requeue function or auditing", async () => {
    mockAuth.mockResolvedValue(admin);
    mockList.mockResolvedValue([]);
    const result = await requeueDeadLetterAction(EVENT);
    expect(result.ok).toBe(false);
    expect(mockRequeue).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it.each(["not_dead_letter", "not_found"])("a %s outcome is a refusal with no audit row", async (outcome) => {
    mockAuth.mockResolvedValue(admin);
    mockList.mockResolvedValue([ROW]);
    mockRequeue.mockResolvedValue(outcome);
    const result = await requeueDeadLetterAction(EVENT);
    expect(result).toMatchObject({ ok: false });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("a database failure reading the list or requeueing is an honest refusal, not a throw", async () => {
    mockAuth.mockResolvedValue(admin);
    mockList.mockRejectedValueOnce(new Error("db"));
    expect((await requeueDeadLetterAction(EVENT)).ok).toBe(false);
    mockList.mockResolvedValue([ROW]);
    mockRequeue.mockRejectedValueOnce(new Error("db"));
    expect((await requeueDeadLetterAction(EVENT)).ok).toBe(false);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
