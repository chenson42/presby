/**
 * `completeEmailChange` (Community Increment 2b, R38, DECISION-225): the
 * verify-email page's change, behind `presby_complete_email_change`. The SQL
 * outcomes are proven in `src/lib/db/domain/email-proof.db.test.ts`; the
 * Postgres-backed behaviour of this wrapper is `email-change.db.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const { completeEmailChange, EMAIL_CHANGE_OUTCOMES, sha256Hex } = await import("./email-change");

const RAW = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const USER = "22222222-2222-4222-8222-222222222222";
const OLD = "old-address@example.invalid";
const NEW = "new-address@example.invalid";
const tx = { execute: h.execute };

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.execute.mockReset();
  h.insertAuditRow.mockReset();
  h.transaction.mockReset();
  h.transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("completeEmailChange", () => {
  it("hashes the token (sha256 hex) and passes ONLY the hash to SQL", async () => {
    h.execute.mockResolvedValue({ rows: [{ outcome: "invalid" }] });
    await completeEmailChange(RAW);
    const q = new PgDialect().sqlToQuery(h.execute.mock.calls[0]![0]);
    expect(q.sql).toMatch(/presby_complete_email_change/);
    expect(q.params).toEqual([createHash("sha256").update(RAW).digest("hex")]);
    expect(q.params).not.toContain(RAW);
    expect(sha256Hex(RAW)).toBe(createHash("sha256").update(RAW).digest("hex"));
  });

  it.each([
    ["invalid", { kind: "invalid" }],
    ["expired", { kind: "expired" }],
    ["email_taken", { kind: "email_taken" }],
  ] as const)("outcome %s maps to the page's state and writes no audit row", async (outcome, expected) => {
    h.execute.mockResolvedValue({ rows: [{ outcome }] });
    await expect(completeEmailChange(RAW)).resolves.toEqual(expected);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("ok writes the EXISTING user.email_changed row (same shape as before) in the same transaction", async () => {
    h.execute.mockResolvedValue({
      rows: [{ outcome: "ok", user_id: USER, old_email: OLD, new_email: NEW }],
    });
    await expect(completeEmailChange(RAW)).resolves.toEqual({ kind: "ok" });
    expect(h.insertAuditRow).toHaveBeenCalledTimes(1);
    const [passedTx, row] = h.insertAuditRow.mock.calls[0]!;
    expect(passedTx).toBe(tx);
    expect(row.action).toBe("user.email_changed");
    expect(row.actor).toEqual({ userId: USER, email: NEW });
    expect(row.resourceType).toBe("user");
    expect(row.resourceId).toBe(USER);
    expect(row.metadata).toEqual({ oldEmail: OLD, newEmail: NEW });
  });

  it("a failed audit insert surfaces as 'error' (the transaction rolls the change back), logging a class only", async () => {
    h.execute.mockResolvedValue({
      rows: [{ outcome: "ok", user_id: USER, old_email: OLD, new_email: NEW }],
    });
    h.insertAuditRow.mockRejectedValue(new Error(`audit failed for ${NEW}`));
    await expect(completeEmailChange(RAW)).resolves.toEqual({ kind: "error" });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toMatch(/@/);
    expect(logged).not.toContain(RAW);
    expect(logged).not.toContain(sha256Hex(RAW));
  });

  it("an unknown outcome, an empty result and a thrown database error are all 'error', never a success", async () => {
    h.execute.mockResolvedValue({ rows: [{ outcome: "something_new" }] });
    await expect(completeEmailChange(RAW)).resolves.toEqual({ kind: "error" });
    h.execute.mockResolvedValue({ rows: [] });
    await expect(completeEmailChange(RAW)).resolves.toEqual({ kind: "error" });
    h.execute.mockRejectedValue(new Error("connection reset"));
    await expect(completeEmailChange(RAW)).resolves.toEqual({ kind: "error" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("an empty token is invalid and reaches no database", async () => {
    await expect(completeEmailChange("")).resolves.toEqual({ kind: "invalid" });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("EMAIL_CHANGE_OUTCOMES equals the literals the SQL function can return (pinned to drizzle/0065)", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../drizzle/0065_presby_sign_in_and_connect.sql"), "utf8");
    const start = sql.indexOf("create or replace function presby_complete_email_change");
    const end = sql.indexOf("revoke all on function presby_record_google_email_proof");
    const body = sql.slice(start, end);
    const literals = new Set([...body.matchAll(/select '([a-z_]+)'::text, /g)].map((m) => m[1]));
    expect([...literals].sort()).toEqual([...EMAIL_CHANGE_OUTCOMES].sort());
  });
});
