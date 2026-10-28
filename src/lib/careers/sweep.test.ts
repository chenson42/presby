/**
 * runCareersSweep's connection and transaction discipline, with the database
 * mocked - docs/work-log/2026-10-25-careers-inc1.md, Phase 3 T23. What the sweep
 * actually does to rows (and that its audit rows roll back with it) is
 * `sweep.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const txExecute = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const tenantDb = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: tenantDb,
  getPlatformDb: () => ({ transaction, execute: vi.fn() }),
}));
const insertAuditRow = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit-tx", () => ({ insertAuditRow }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { CAREERS_POSTING_CLOSED: "careers.posting.closed" },
}));

import { runCareersSweep, sweepClosedPostings } from "./sweep";

const FAKE_TX = { execute: txExecute };

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX));
});

describe("runCareersSweep", () => {
  it("runs in ONE transaction on the PLATFORM connection, never the tenant one", async () => {
    txExecute.mockResolvedValueOnce({ rows: [] });
    await runCareersSweep();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tenantDb.execute).not.toHaveBeenCalled();
    expect(tenantDb.transaction).not.toHaveBeenCalled();
  });

  it("calls the owner-only definer with the default batch size of 200", async () => {
    txExecute.mockResolvedValueOnce({ rows: [] });
    await runCareersSweep();
    expect(txExecute).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(txExecute.mock.calls[0]![0]);
    expect(text).toContain("presby_careers_sweep");
    expect(text).toContain("200");
  });

  it("writes one CLOSED audit row per posting closed: actor null, ids and 'closing_date' only, in the SAME transaction", async () => {
    txExecute.mockResolvedValueOnce({
      rows: [
        { kind: "posting_closed", organization_id: "org-1", posting_id: "post-1", application_id: null },
        { kind: "posting_closed", organization_id: "org-2", posting_id: "post-2", application_id: null },
      ],
    });
    const count = await runCareersSweep();
    expect(count).toBe(2);
    expect(insertAuditRow).toHaveBeenCalledTimes(2);
    for (const [index, [tx, input]] of insertAuditRow.mock.calls.entries()) {
      expect(tx).toBe(FAKE_TX);
      expect(input).toEqual({
        action: "careers.posting.closed",
        actor: null,
        resourceType: "job_posting",
        resourceId: `post-${index + 1}`,
        metadata: { organizationId: `org-${index + 1}`, postingId: `post-${index + 1}`, via: "closing_date" },
      });
    }
  });

  it("counts and audits only posting_closed rows (a later increment adds other kinds)", async () => {
    txExecute.mockResolvedValueOnce({
      rows: [
        { kind: "posting_closed", organization_id: "o", posting_id: "p", application_id: null },
        { kind: "application_redacted", organization_id: "o", posting_id: "p", application_id: "a" },
      ],
    });
    expect(await runCareersSweep()).toBe(1);
    expect(insertAuditRow).toHaveBeenCalledTimes(1);
  });

  it("accepts the driver's bare-array result shape", async () => {
    txExecute.mockResolvedValueOnce([
      { kind: "posting_closed", organization_id: "o", posting_id: "p", application_id: null },
    ]);
    expect(await runCareersSweep()).toBe(1);
  });

  it("a failing audit insert PROPAGATES, so the transaction (the sweep with it) rolls back", async () => {
    txExecute.mockResolvedValueOnce({
      rows: [{ kind: "posting_closed", organization_id: "o", posting_id: "p", application_id: null }],
    });
    insertAuditRow.mockRejectedValueOnce(new Error("audit insert failed"));
    await expect(runCareersSweep()).rejects.toThrow("audit insert failed");
  });

  it("a failing sweep call propagates too", async () => {
    txExecute.mockRejectedValueOnce(new Error("function does not exist"));
    await expect(runCareersSweep()).rejects.toThrow("function does not exist");
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  it("no rows means no audit and a zero", async () => {
    txExecute.mockResolvedValueOnce({ rows: [] });
    expect(await runCareersSweep()).toBe(0);
    expect(insertAuditRow).not.toHaveBeenCalled();
  });
});

describe("sweepClosedPostings", () => {
  it("takes the caller's transaction and does not open its own", async () => {
    txExecute.mockResolvedValueOnce({ rows: [] });
    await sweepClosedPostings(FAKE_TX as never);
    expect(transaction).not.toHaveBeenCalled();
  });
});
