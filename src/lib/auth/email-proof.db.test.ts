/**
 * `recordGoogleEmailProof` and `completeEmailChange` on a REAL Postgres
 * connection, through the presby_app `db` exactly as `src/auth.ts` and the
 * verify-email page run them (Community Increment 2b, Batch B1, T-9; R38,
 * edge cases E-4, E-5). The SQL decisions are proven in
 * `src/lib/db/domain/email-proof.db.test.ts`; this file proves what the
 * wrappers add:
 *
 *   - RULE 7: the audit row is written in the SAME transaction as the stamp or
 *     the address change, so a failed audit insert leaves the account exactly
 *     as it was;
 *   - the audit rows carry the documented shape: `user.email_proof_recorded`
 *     {source:'google'} and the EXISTING `user.email_changed` {oldEmail,newEmail};
 *   - a stamp lands only for the account's own current address, and a second
 *     call is false with no second audit row;
 *   - an email change writes the new address AND its stamp, deletes the token,
 *     and an expired token is deleted without a change.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/auth/email-proof.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("address proof wrappers (Postgres-backed)", () => {
  let fx: InvitationFixture;
  let proof: typeof import("./email-proof");
  let change: typeof import("./email-change");
  let errorSpy: ReturnType<typeof vi.spyOn>;

  async function q(query: ReturnType<typeof sql>): Promise<Row[]> {
    return fx.q(query);
  }

  async function userRow(id: string): Promise<{ email: string; stamped: boolean }> {
    const [r] = await q(sql`select email, email_verified is not null as stamped from users where id = ${id}`);
    return { email: String(r!.email), stamped: r!.stamped === true };
  }

  async function auditFor(action: string, userId: string): Promise<Row[]> {
    return q(sql`select * from audit_events where action = ${action} and resource_id = ${userId}`);
  }

  /** A token row for `userId` -> `newEmail`, on the owner connection; returns the raw token. */
  async function mintChange(userId: string, newEmail: string, expires = sql`now() + interval '1 hour'`): Promise<string> {
    const raw = `${fx.email("tok")}-${Math.floor(Math.random() * 1e9).toString(16)}`.replace(/[^a-z0-9-]/g, "");
    await q(sql`
      insert into email_verification_tokens (user_id, token, new_email, expires_at)
      values (${userId}, ${change.sha256Hex(raw)}, ${newEmail}, ${expires})
      on conflict (user_id) do update set token = excluded.token, new_email = excluded.new_email,
                                          expires_at = excluded.expires_at`);
    return raw;
  }

  async function tokenCount(userId: string): Promise<number> {
    const [r] = await q(sql`select count(*)::int as n from email_verification_tokens where user_id = ${userId}`);
    return Number(r!.n);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("b1proof");
    proof = await import("./email-proof");
    change = await import("./email-change");
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  beforeEach(() => {
    auditControl.fail = false;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  // -------------------------------------------------------------------------
  // recordGoogleEmailProof
  // -------------------------------------------------------------------------

  describe("recordGoogleEmailProof", () => {
    it("stamps the account's own address, writes one user.email_proof_recorded row {source:'google'}, and a second call is false with no second row", async () => {
      const address = fx.email("g");
      const id = await fx.makeUser(address);
      expect((await userRow(id)).stamped).toBe(false);

      await expect(proof.recordGoogleEmailProof({ userId: id, address })).resolves.toBe(true);
      expect((await userRow(id)).stamped).toBe(true);

      const rows = await auditFor("user.email_proof_recorded", id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toEqual({ source: "google" });
      expect(rows[0]!.actor_user_id).toBe(id);
      expect(JSON.stringify(rows[0]!.metadata)).not.toMatch(/@/);

      await expect(proof.recordGoogleEmailProof({ userId: id, address })).resolves.toBe(false);
      expect(await auditFor("user.email_proof_recorded", id)).toHaveLength(1);
    });

    it("a different address stamps nothing and writes no row; the case of the address does not matter", async () => {
      const address = fx.email("g");
      const id = await fx.makeUser(address);
      await expect(proof.recordGoogleEmailProof({ userId: id, address: fx.email("other") })).resolves.toBe(false);
      expect((await userRow(id)).stamped).toBe(false);
      expect(await auditFor("user.email_proof_recorded", id)).toHaveLength(0);

      await expect(proof.recordGoogleEmailProof({ userId: id, address: ` ${address.toUpperCase()} ` })).resolves.toBe(true);
      expect((await userRow(id)).stamped).toBe(true);
    });

    it("an inactive account is not stamped", async () => {
      const address = fx.email("g");
      const id = await fx.makeUser(address, { isActive: false });
      await expect(proof.recordGoogleEmailProof({ userId: id, address })).resolves.toBe(false);
      expect((await userRow(id)).stamped).toBe(false);
    });

    it("a FAILED audit insert undoes the stamp (Rule 7): the account is exactly as it was", async () => {
      const address = fx.email("g");
      const id = await fx.makeUser(address);
      auditControl.fail = true;
      await expect(proof.recordGoogleEmailProof({ userId: id, address })).rejects.toThrow(/audit insert failed/);
      auditControl.fail = false;
      expect((await userRow(id)).stamped).toBe(false);
      expect(await auditFor("user.email_proof_recorded", id)).toHaveLength(0);
      // ...and it works afterwards.
      await expect(proof.recordGoogleEmailProof({ userId: id, address })).resolves.toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // completeEmailChange
  // -------------------------------------------------------------------------

  describe("completeEmailChange", () => {
    it("ok: writes the new address AND its stamp, deletes the token, and writes the existing user.email_changed row", async () => {
      const oldAddress = fx.email("old");
      const newAddress = fx.email("new");
      const id = await fx.makeUser(oldAddress);
      const raw = await mintChange(id, newAddress);

      await expect(change.completeEmailChange(raw)).resolves.toEqual({ kind: "ok" });
      expect(await userRow(id)).toEqual({ email: newAddress, stamped: true });
      expect(await tokenCount(id)).toBe(0);

      const rows = await auditFor("user.email_changed", id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toEqual({ oldEmail: oldAddress, newEmail: newAddress });
      expect(rows[0]!.actor_user_id).toBe(id);
      expect(rows[0]!.actor_email).toBe(newAddress);

      // The link is single-use.
      await expect(change.completeEmailChange(raw)).resolves.toEqual({ kind: "invalid" });
    });

    it("an unknown token is invalid and changes nothing", async () => {
      await expect(change.completeEmailChange("no-such-token")).resolves.toEqual({ kind: "invalid" });
    });

    it("an expired token is expired, the row is deleted (today's behaviour), and the address is unchanged", async () => {
      const oldAddress = fx.email("old");
      const id = await fx.makeUser(oldAddress);
      const raw = await mintChange(id, fx.email("new"), sql`now() - interval '1 minute'`);
      await expect(change.completeEmailChange(raw)).resolves.toEqual({ kind: "expired" });
      expect((await userRow(id)).email).toBe(oldAddress);
      expect(await tokenCount(id)).toBe(0);
      expect(await auditFor("user.email_changed", id)).toHaveLength(0);
    });

    it("an address another account holds (even in a different case) is email_taken: nothing written, the token stays", async () => {
      const taken = fx.email("taken");
      await fx.makeUser(taken);
      const oldAddress = fx.email("old");
      const id = await fx.makeUser(oldAddress);
      const raw = await mintChange(id, taken.toUpperCase());
      await expect(change.completeEmailChange(raw)).resolves.toEqual({ kind: "email_taken" });
      expect((await userRow(id)).email).toBe(oldAddress);
      expect(await tokenCount(id)).toBe(1);
      expect(await auditFor("user.email_changed", id)).toHaveLength(0);
    });

    it("a FAILED audit insert undoes the whole change: address, stamp and token are exactly as they were (Rule 7)", async () => {
      const oldAddress = fx.email("old");
      const id = await fx.makeUser(oldAddress);
      const raw = await mintChange(id, fx.email("new"));
      auditControl.fail = true;
      await expect(change.completeEmailChange(raw)).resolves.toEqual({ kind: "error" });
      auditControl.fail = false;
      expect(await userRow(id)).toEqual({ email: oldAddress, stamped: false });
      expect(await tokenCount(id)).toBe(1);
      expect(await auditFor("user.email_changed", id)).toHaveLength(0);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/@/);
      // The token is still live: the same link works once the audit insert does.
      await expect(change.completeEmailChange(raw)).resolves.toEqual({ kind: "ok" });
    });

    it("two verifies racing for the same address: exactly one wins, the other is email_taken", async () => {
      const target = fx.email("race");
      const a = await fx.makeUser(fx.email("a"));
      const b = await fx.makeUser(fx.email("b"));
      const rawA = await mintChange(a, target);
      const rawB = await mintChange(b, target);
      const results = await Promise.all([change.completeEmailChange(rawA), change.completeEmailChange(rawB)]);
      expect(results.map((r) => r.kind).sort()).toEqual(["email_taken", "ok"]);
    });
  });
});
