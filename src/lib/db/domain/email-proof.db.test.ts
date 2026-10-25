/**
 * drizzle/0065_presby_sign_in_and_connect.sql sections 1-4 and 10, proven
 * against a real database: address proof as a database fact (R37, R38; F230,
 * F187; DECISION-225). Community Increment 2b, Batch A1, Test Plan T-2 and
 * T-3 (docs/work-log/2026-10-22-founding-admin-directory.md, "Phase 3
 * amendment 2" sections 5.2, 5.6 and 8.3).
 *
 *   T-2  users_guard_email_proof in both directions: a non-owner stamp is
 *        refused (presby_app, and a second non-owner role, deny by default);
 *        an address change clears an unchanged stamp for every role; a
 *        letter-case-only change keeps it; clearing is allowed. The section 2
 *        clean-up clears only provably stale stamps. The section 1 stop-block
 *        raises with counts and never a value.
 *   T-3  the two owner-path proof writers: every condition of
 *        presby_record_google_email_proof, every outcome of
 *        presby_complete_email_change, a two-connection race of two verifies
 *        on one address, and one token used once.
 *
 * Two connections: `presby_app` (`db`, RLS enforced) for what the application
 * can do, and the owner (`getPlatformDb()`) for fixtures and what only the
 * owner reaches. Work that must not persist runs inside a rolled-back
 * transaction; the race cases COMMIT on fixture-only users the fixture
 * deletes.
 *
 * Fixtures: synthetic names, `example.invalid` addresses (No Real Data).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/email-proof.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const MIGRATION_PATH = path.join(process.cwd(), "drizzle", "0065_presby_sign_in_and_connect.sql");
const PROOF_REFUSED =
  /users: email_verified is recorded only on the owner path, by presby_accept_invitation, presby_record_google_email_proof or presby_complete_email_change/;

interface Tx {
  execute(query: SQL): Promise<unknown>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
class Rollback extends Error {}

function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 6) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}
function pgCode(err: unknown): string | undefined {
  for (const e of chain(err)) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}
function pgText(err: unknown): string {
  return chain(err)
    .map((e) => {
      const x = e as { message?: unknown; constraint?: unknown };
      return `${String(x.message ?? e)} ${String(x.constraint ?? "")}`;
    })
    .join(" :: ");
}
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}
function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** The text of one numbered section of 0065 (`-- N. title` to the next). */
function migrationSection(n: number): string {
  const text = readFileSync(MIGRATION_PATH, "utf8");
  const start = text.search(new RegExp(`^-- ${n}\\. `, "m"));
  const end = text.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0 || end < 0) throw new Error(`section ${n} not found in 0065`);
  return text.slice(start, end);
}

describe.skipIf(!hasDb)("drizzle/0065 address proof (Postgres-backed)", () => {
  let fx: InvitationFixture;

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  /** A fixture user, optionally stamped (owner path). */
  async function user(tag: string, opts: { stamped?: boolean; isActive?: boolean; address?: string } = {}) {
    const address = opts.address ?? fx.email(tag);
    const id = await fx.makeUser(address, { isActive: opts.isActive ?? true });
    if (opts.stamped) {
      await q(sql`update users set email_verified = timestamptz '2026-01-02T03:04:05Z' where id = ${id}`);
    }
    return { id, address };
  }

  async function stampOf(id: string): Promise<string | null> {
    const [r] = await q(sql`select email_verified::text as v from users where id = ${id}`);
    return (r!.v as string | null) ?? null;
  }

  async function inRolledBackOwnerTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await fx.platform.transaction(async (tx) => {
        await fn(tx as unknown as Tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function inRolledBackAppTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await fx.appDb.transaction(async (tx) => {
        await fn(tx as unknown as Tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function rejected(tx: Tx, query: SQL): Promise<{ code?: string; text: string }> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(query);
      });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error("expected the statement to be rejected");
    return { code: pgCode(caught), text: pgText(caught) };
  }

  async function one(tx: Tx, query: SQL): Promise<Row> {
    return rowsOf(await tx.execute(query))[0]!;
  }

  /**
   * Inside an owner transaction: create a throwaway NOLOGIN role that is NOT
   * the owner of users, give it DML on users, and switch to it. Proves the
   * guard denies by default (any non-owner role), not by naming presby_app.
   * Everything (the role included) is undone by the caller's rollback.
   */
  async function becomeThrowawayRole(tx: Tx): Promise<void> {
    const role = `presby_t65_${Math.floor(Math.random() * 1e9)}`;
    await tx.execute(sql.raw(`create role ${role} nologin`));
    await tx.execute(sql.raw(`grant ${role} to current_user with set true`));
    await tx.execute(sql.raw(`grant select, insert, update on users to ${role}`));
    await tx.execute(sql.raw(`set local role ${role}`));
  }

  beforeAll(async () => {
    const { createInvitationFixture } = await import("@/lib/testing/invitation-fixture");
    fx = await createInvitationFixture("ep65");
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  // ===========================================================================
  // Structure
  // ===========================================================================
  describe("structure", () => {
    it("users_guard_email_proof is a BEFORE INSERT OR UPDATE row trigger, enabled; users_email_lower_uq exists", async () => {
      const [t] = await q(sql`
        select tgenabled, pg_get_triggerdef(oid) as def from pg_trigger
         where tgrelid = 'users'::regclass and tgname = 'users_guard_email_proof'`);
      expect(t!.tgenabled).toBe("O");
      expect(String(t!.def)).toMatch(/BEFORE INSERT OR UPDATE ON public\.users FOR EACH ROW EXECUTE FUNCTION presby_users_guard_email_proof\(\)/);
      const [ix] = await q(sql`select indexdef from pg_indexes where indexname = 'users_email_lower_uq'`);
      expect(String(ix!.indexdef)).toBe("CREATE UNIQUE INDEX users_email_lower_uq ON public.users USING btree (lower(email))");
    });

    it("the proof writers: SECURITY DEFINER, EXECUTE for presby_app only (not public, not presby_platform)", async () => {
      const rows = await q(sql`
        select p.proname, p.prosecdef,
               has_function_privilege('presby_app', p.oid, 'execute') as app,
               has_function_privilege('presby_platform', p.oid, 'execute') as platform,
               has_function_privilege('public', p.oid, 'execute') as pub
          from pg_proc p
         where p.proname in ('presby_record_google_email_proof', 'presby_complete_email_change')
         order by p.proname`);
      expect(rows).toEqual([
        { proname: "presby_complete_email_change", prosecdef: true, app: true, platform: false, pub: false },
        { proname: "presby_record_google_email_proof", prosecdef: true, app: true, platform: false, pub: false },
      ]);
    });
  });

  // ===========================================================================
  // T-2: R37, both directions
  // ===========================================================================
  describe("T-2 users_guard_email_proof (R37)", () => {
    it("presby_app: an INSERT carrying a stamp is refused with the literal; without one it passes (the adapter's shape)", async () => {
      await inRolledBackAppTx(async (tx) => {
        const r = await rejected(tx, sql`
          insert into users (email, name, email_verified) values (${fx.email("ins")}, 'T', now())`);
        expect(r.code).toBe("42501");
        expect(r.text).toMatch(PROOF_REFUSED);
        const ok = await one(tx, sql`
          insert into users (email, name) values (${fx.email("ins-ok")}, 'T') returning email_verified`);
        expect(ok.email_verified).toBeNull();
      });
    });

    it("presby_app: stamping from null is refused; changing one stamp to another is refused; clearing passes", async () => {
      const unstamped = await user("u0");
      const stamped = await user("u1", { stamped: true });
      await inRolledBackAppTx(async (tx) => {
        const a = await rejected(tx, sql`update users set email_verified = now() where id = ${unstamped.id}`);
        expect(a.code).toBe("42501");
        expect(a.text).toMatch(PROOF_REFUSED);
        const b = await rejected(tx, sql`update users set email_verified = now() where id = ${stamped.id}`);
        expect(b.code).toBe("42501");
        expect(b.text).toMatch(PROOF_REFUSED);
        await tx.execute(sql`update users set email_verified = null where id = ${stamped.id}`);
        const c = await one(tx, sql`select email_verified from users where id = ${stamped.id}`);
        expect(c.email_verified).toBeNull();
      });
    });

    it("presby_app: an update that leaves the stamp alone is unaffected (the jwt lastLoginAt write)", async () => {
      const stamped = await user("u2", { stamped: true });
      await inRolledBackAppTx(async (tx) => {
        await tx.execute(sql`update users set last_login_at = now(), failed_login_attempts = 0 where id = ${stamped.id}`);
        const r = await one(tx, sql`select email_verified::text as v from users where id = ${stamped.id}`);
        expect(r.v).not.toBeNull();
      });
    });

    it("an address change clears an unchanged stamp, for presby_app AND for the owner (the old verify-email page's write)", async () => {
      const a = await user("chg-app", { stamped: true });
      const b = await user("chg-own", { stamped: true });
      await inRolledBackAppTx(async (tx) => {
        await tx.execute(sql`update users set email = ${fx.email("chg-app-new")} where id = ${a.id}`);
        const r = await one(tx, sql`select email_verified from users where id = ${a.id}`);
        expect(r.email_verified).toBeNull();
      });
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`update users set email = ${fx.email("chg-own-new")} where id = ${b.id}`);
        const r = await one(tx, sql`select email_verified from users where id = ${b.id}`);
        expect(r.email_verified).toBeNull();
      });
    });

    it("a letter-case-only change keeps the stamp (both roles)", async () => {
      const a = await user("case-app", { stamped: true });
      await inRolledBackAppTx(async (tx) => {
        await tx.execute(sql`update users set email = upper(email) where id = ${a.id}`);
        const r = await one(tx, sql`select email_verified::text as v from users where id = ${a.id}`);
        expect(r.v).not.toBeNull();
      });
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`update users set email = upper(email) where id = ${a.id}`);
        const r = await one(tx, sql`select email_verified::text as v from users where id = ${a.id}`);
        expect(r.v).not.toBeNull();
      });
    });

    it("the owner may stamp, and an owner address change that re-stamps in the same statement keeps the new stamp", async () => {
      const u = await user("own");
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`update users set email_verified = now() where id = ${u.id}`);
        await tx.execute(sql`update users set email = ${fx.email("own-new")}, email_verified = clock_timestamp() where id = ${u.id}`);
        const r = await one(tx, sql`select email_verified from users where id = ${u.id}`);
        expect(r.email_verified).not.toBeNull();
        const ins = await one(tx, sql`
          insert into users (email, name, email_verified) values (${fx.email("own-ins")}, 'T', now()) returning email_verified`);
        expect(ins.email_verified).not.toBeNull();
      });
    });

    it("a second non-owner role is refused the same way (deny by default, no role named)", async () => {
      const unstamped = await user("2nd");
      await inRolledBackOwnerTx(async (tx) => {
        await becomeThrowawayRole(tx);
        const a = await rejected(tx, sql`update users set email_verified = now() where id = ${unstamped.id}`);
        expect(a.code).toBe("42501");
        expect(a.text).toMatch(PROOF_REFUSED);
        const b = await rejected(tx, sql`
          insert into users (email, name, email_verified) values (${fx.email("2nd-ins")}, 'T', now())`);
        expect(b.code).toBe("42501");
        expect(b.text).toMatch(PROOF_REFUSED);
      });
    });

    it("section 2 clears only provably stale stamps: a stamped user with a user.email_changed row, never one without", async () => {
      const stale = await user("stale", { stamped: true });
      const kept = await user("kept", { stamped: true });
      const other = await user("other-action", { stamped: true });
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`
          insert into audit_events (action, resource_type, resource_id, metadata)
          values ('user.email_changed', 'user', ${stale.id}, '{}'::jsonb),
                 ('user.updated', 'user', ${other.id}, '{}'::jsonb)`);
        await tx.execute(sql.raw(migrationSection(2)));
        const rows = rowsOf(await tx.execute(sql`
          select id::text, email_verified is not null as stamped from users
           where id in (${stale.id}, ${kept.id}, ${other.id})`));
        const byId = Object.fromEntries(rows.map((r) => [String(r.id), r.stamped]));
        expect(byId[stale.id]).toBe(false);
        expect(byId[kept.id]).toBe(true);
        expect(byId[other.id]).toBe(true);
        // idempotent: a second run changes nothing
        await tx.execute(sql.raw(migrationSection(2)));
        const [again] = rowsOf(await tx.execute(sql`
          select count(*) filter (where email_verified is not null)::int as n from users
           where id in (${stale.id}, ${kept.id}, ${other.id})`));
        expect(again!.n).toBe(2);
      });
    });

    it("the section 1 stop-block raises with counts and never an address; a clean table passes", async () => {
      // Against a constraint-free temp copy, so no lock is taken on users.
      const stop = migrationSection(1).replace(/\busers\b/g, "users_probe");
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`create temp table users_probe (like users including defaults) on commit drop`);
        await tx.execute(sql`insert into users_probe (id, email) values (gen_random_uuid(), 'probe@example.invalid')`);
        await tx.execute(sql.raw(stop)); // clean: passes
        await tx.execute(sql`insert into users_probe (id, email) values (gen_random_uuid(), 'Probe@Example.invalid')`);
        const r = await rejected(tx, sql.raw(stop));
        expect(r.code).toBe("23514");
        expect(r.text).toContain("case_duplicate_email_groups=1");
        expect(r.text).toContain("purpose_origin_tie_violations=0");
        expect(r.text).not.toMatch(/@example\.invalid/i);
      });
    });
  });

  // ===========================================================================
  // F187 / E1: one account per address regardless of case
  // ===========================================================================
  describe("users_email_lower_uq (F187, E1)", () => {
    it("a case-variant duplicate is refused in both orders, as presby_app (the NextAuth adapter's insert)", async () => {
      const lower = fx.email("dup");
      const upper = lower.toUpperCase();
      for (const [first, second] of [
        [lower, upper],
        [upper, lower],
      ] as const) {
        await inRolledBackAppTx(async (tx) => {
          await tx.execute(sql`insert into users (email, name) values (${first}, 'T')`);
          const r = await rejected(tx, sql`insert into users (email, name) values (${second}, 'T')`);
          expect(r.code).toBe("23505");
          expect(r.text).toContain("users_email_lower_uq");
        });
      }
    });
  });

  // ===========================================================================
  // T-3: R38, the proof writers
  // ===========================================================================
  describe("T-3 presby_record_google_email_proof", () => {
    async function proof(userId: string | null, address: string | null): Promise<boolean> {
      const [r] = rowsOf(await fx.appDb.execute(
        sql`select presby_record_google_email_proof(${userId}::uuid, ${address}::text) as stamped`,
      ));
      return r!.stamped as boolean;
    }

    it("stamps an active, unstamped account whose address matches (case-insensitive, trimmed); a second call is false", async () => {
      const u = await user("g1");
      expect(await proof(u.id, `  ${u.address.toUpperCase()} `)).toBe(true);
      expect(await stampOf(u.id)).not.toBeNull();
      const first = await stampOf(u.id);
      expect(await proof(u.id, u.address)).toBe(false);
      expect(await stampOf(u.id)).toBe(first);
    });

    it("stamps nothing for a different address, an inactive account, an already-stamped account or a null argument", async () => {
      const different = await user("g2");
      const inactive = await user("g3", { isActive: false });
      const stamped = await user("g4", { stamped: true });
      expect(await proof(different.id, fx.email("someone-else"))).toBe(false);
      expect(await stampOf(different.id)).toBeNull();
      expect(await proof(inactive.id, inactive.address)).toBe(false);
      expect(await stampOf(inactive.id)).toBeNull();
      const before = await stampOf(stamped.id);
      expect(await proof(stamped.id, stamped.address)).toBe(false);
      expect(await stampOf(stamped.id)).toBe(before);
      expect(await proof(null, different.address)).toBe(false);
      expect(await proof(different.id, null)).toBe(false);
      expect(await proof("00000000-0000-4065-8000-000000000000", different.address)).toBe(false);
    });
  });

  describe("T-3 presby_complete_email_change", () => {
    async function token(userId: string, newEmail: string, opts: { expired?: boolean } = {}) {
      const raw = `t65-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      const hash = sha256Hex(raw);
      // Written as presby_app, the way requestEmailChange writes it today.
      await fx.appDb.execute(sql`
        insert into email_verification_tokens (user_id, token, new_email, expires_at)
        values (${userId}, ${hash}, ${newEmail},
                ${opts.expired ? sql`now() - interval '1 minute'` : sql`now() + interval '1 hour'`})
        on conflict (user_id) do update set token = excluded.token, new_email = excluded.new_email,
                                            expires_at = excluded.expires_at`);
      return hash;
    }
    async function complete(hash: string | null, via: Tx | null = null): Promise<Row> {
      const exec: { execute(query: SQL): Promise<unknown> } = via ?? fx.appDb;
      return rowsOf(await exec.execute(sql`select * from presby_complete_email_change(${hash}::text)`))[0]!;
    }
    async function tokenCount(hash: string): Promise<number> {
      const [r] = await q(sql`select count(*)::int as n from email_verification_tokens where token = ${hash}`);
      return r!.n as number;
    }

    it("ok: the address and a fresh stamp are written in one statement, the token is gone, old/new returned", async () => {
      const u = await user("ec-ok");
      const next = fx.email("ec-ok-new");
      const hash = await token(u.id, next);
      const r = await complete(hash);
      expect(r).toEqual({ outcome: "ok", user_id: u.id, old_email: u.address, new_email: next });
      const [row] = await q(sql`select email, email_verified is not null as stamped from users where id = ${u.id}`);
      expect(row).toEqual({ email: next, stamped: true });
      expect(await tokenCount(hash)).toBe(0);
    });

    it("expired: the token row is deleted and nothing else changes", async () => {
      const u = await user("ec-exp", { stamped: true });
      const before = await stampOf(u.id);
      const hash = await token(u.id, fx.email("ec-exp-new"), { expired: true });
      expect(await complete(hash)).toEqual({ outcome: "expired", user_id: null, old_email: null, new_email: null });
      expect(await tokenCount(hash)).toBe(0);
      const [row] = await q(sql`select email from users where id = ${u.id}`);
      expect(row!.email).toBe(u.address);
      expect(await stampOf(u.id)).toBe(before);
    });

    it("email_taken: another account holds the address in a different case; nothing is written and the token stays", async () => {
      const holder = await user("ec-holder");
      const u = await user("ec-taken", { stamped: true });
      const before = await stampOf(u.id);
      const hash = await token(u.id, holder.address.toUpperCase());
      expect(await complete(hash)).toEqual({ outcome: "email_taken", user_id: null, old_email: null, new_email: null });
      expect(await tokenCount(hash)).toBe(1);
      const [row] = await q(sql`select email from users where id = ${u.id}`);
      expect(row!.email).toBe(u.address);
      expect(await stampOf(u.id)).toBe(before);
    });

    it("invalid: an unknown hash and a null hash", async () => {
      expect(await complete(sha256Hex("never-issued"))).toEqual({ outcome: "invalid", user_id: null, old_email: null, new_email: null });
      expect(await complete(null)).toEqual({ outcome: "invalid", user_id: null, old_email: null, new_email: null });
    });

    it("two-connection race: two accounts verifying the same new address, one wins and the other is email_taken", async () => {
      const a = await user("race-a");
      const b = await user("race-b");
      const target = fx.email("race-target");
      const ha = await token(a.id, target);
      const hb = await token(b.id, target.toUpperCase());

      let releaseA!: () => void;
      const aHolding = new Promise<void>((r) => (releaseA = r));
      let aCalled!: () => void;
      const aDidCall = new Promise<void>((r) => (aCalled = r));

      const first = fx.appDb.transaction(async (tx) => {
        const r = await complete(ha, tx as unknown as Tx);
        aCalled();
        await aHolding; // hold the uncommitted change
        return r;
      });
      await aDidCall;
      const second = fx.appDb.transaction(async (tx) => complete(hb, tx as unknown as Tx));
      await new Promise((r) => setTimeout(r, 750)); // let B block on the unique index
      releaseA();
      const [ra, rb] = await Promise.all([first, second]);
      expect(ra!.outcome).toBe("ok");
      expect(rb!.outcome).toBe("email_taken");
      const rows = await q(sql`select count(*)::int as n from users where lower(email) = lower(${target})`);
      expect(rows[0]!.n).toBe(1);
      expect(await tokenCount(hb)).toBe(1);
    });

    it("one token is used once: a concurrent second use waits on the token row, then finds nothing (invalid)", async () => {
      const u = await user("once");
      const next = fx.email("once-new");
      const hash = await token(u.id, next);

      let release!: () => void;
      const holding = new Promise<void>((r) => (release = r));
      let called!: () => void;
      const didCall = new Promise<void>((r) => (called = r));

      const first = fx.appDb.transaction(async (tx) => {
        const r = await complete(hash, tx as unknown as Tx);
        called();
        await holding;
        return r;
      });
      await didCall;
      const second = fx.appDb.transaction(async (tx) => complete(hash, tx as unknown as Tx));
      await new Promise((r) => setTimeout(r, 750));
      release();
      const [r1, r2] = await Promise.all([first, second]);
      expect(r1!.outcome).toBe("ok");
      expect(r2!.outcome).toBe("invalid");
      const [row] = await q(sql`select email from users where id = ${u.id}`);
      expect(row!.email).toBe(next);
    });
  });
});
