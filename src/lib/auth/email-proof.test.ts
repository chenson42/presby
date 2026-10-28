/**
 * `recordGoogleEmailProof` (Community Increment 2b, R38, DECISION-225): the
 * TypeScript half of the Google proof writer. The SQL decisions (which account
 * the definer stamps) are proven in `src/lib/db/domain/email-proof.db.test.ts`;
 * the Postgres-backed behaviour of this wrapper (rollback with the audit row)
 * is `email-proof.db.test.ts` beside this file. This file pins what the wrapper
 * decides before and after the call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  insertAuditRow: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => h.transaction(fn),
  },
}));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return { ...actual, insertAuditRow: h.insertAuditRow };
});

const { recordGoogleEmailProof, GOOGLE_PROOF_SOURCE } = await import("./email-proof");

const USER = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "proof-fixture@example.invalid";
const tx = { execute: h.execute };

function sqlOf(call: number): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(h.execute.mock.calls[call]![0]);
}

beforeEach(() => {
  h.execute.mockReset();
  h.insertAuditRow.mockReset();
  h.transaction.mockReset();
  h.transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
});

describe("recordGoogleEmailProof", () => {
  it("calls the definer with the user and the Google-asserted address, and nothing else", async () => {
    h.execute.mockResolvedValue({ rows: [{ stamped: false }] });
    await recordGoogleEmailProof({ userId: USER, address: ADDRESS });
    expect(h.execute).toHaveBeenCalledTimes(1);
    const q = sqlOf(0);
    expect(q.sql).toMatch(/presby_record_google_email_proof/);
    expect(q.params).toEqual([USER, ADDRESS]);
  });

  it("when the definer stamps: returns true and writes one user.email_proof_recorded row in the SAME transaction", async () => {
    h.execute.mockResolvedValue({ rows: [{ stamped: true }] });
    await expect(recordGoogleEmailProof({ userId: USER, address: ADDRESS })).resolves.toBe(true);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.insertAuditRow).toHaveBeenCalledTimes(1);
    const [passedTx, row] = h.insertAuditRow.mock.calls[0]!;
    expect(passedTx).toBe(tx);
    expect(row.action).toBe("user.email_proof_recorded");
    expect(row.actor).toEqual({ userId: USER, email: ADDRESS });
    expect(row.resourceType).toBe("user");
    expect(row.resourceId).toBe(USER);
  });

  it("audit metadata is the source tag and nothing else: no address, no id", async () => {
    h.execute.mockResolvedValue({ rows: [{ stamped: true }] });
    await recordGoogleEmailProof({ userId: USER, address: ADDRESS });
    const row = h.insertAuditRow.mock.calls[0]![1];
    expect(row.metadata).toEqual({ source: GOOGLE_PROOF_SOURCE });
    expect(GOOGLE_PROOF_SOURCE).toBe("google");
    expect(JSON.stringify(row.metadata)).not.toMatch(/@/);
  });

  it("when the definer stamps nothing (a different address, already proven, inactive): returns false and writes no audit row", async () => {
    h.execute.mockResolvedValue({ rows: [{ stamped: false }] });
    await expect(recordGoogleEmailProof({ userId: USER, address: ADDRESS })).resolves.toBe(false);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("reads the driver's array-shaped result as well as { rows }", async () => {
    h.execute.mockResolvedValue([{ stamped: true }]);
    await expect(recordGoogleEmailProof({ userId: USER, address: ADDRESS })).resolves.toBe(true);
  });

  it("treats anything but the boolean true as not stamped (fail closed)", async () => {
    for (const stamped of [null, undefined, "t", 1, "true"]) {
      h.insertAuditRow.mockReset();
      h.execute.mockResolvedValue({ rows: [{ stamped }] });
      await expect(recordGoogleEmailProof({ userId: USER, address: ADDRESS })).resolves.toBe(false);
      expect(h.insertAuditRow).not.toHaveBeenCalled();
    }
  });

  it("a malformed user id or a blank address reaches no database at all", async () => {
    await expect(recordGoogleEmailProof({ userId: "not-a-uuid", address: ADDRESS })).resolves.toBe(false);
    await expect(recordGoogleEmailProof({ userId: USER, address: "" })).resolves.toBe(false);
    await expect(recordGoogleEmailProof({ userId: USER, address: "   " })).resolves.toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("a failed audit insert fails the call (the transaction rolls the stamp back) — the caller in auth.ts swallows it", async () => {
    h.execute.mockResolvedValue({ rows: [{ stamped: true }] });
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed (test-injected)"));
    await expect(recordGoogleEmailProof({ userId: USER, address: ADDRESS })).rejects.toThrow(/audit insert failed/);
  });

  it("a database error propagates (it is not turned into 'no proof')", async () => {
    h.execute.mockRejectedValue(new Error("connection reset"));
    await expect(recordGoogleEmailProof({ userId: USER, address: ADDRESS })).rejects.toThrow(/connection reset/);
  });
});
