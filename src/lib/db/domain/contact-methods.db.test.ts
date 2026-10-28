/**
 * drizzle/0064_presby_person_emails.sql, proven against a real database
 * (docs/work-log/2026-10-23-person-emails.md, Phase 3 "Test plan", Batch 1;
 * DECISION-215, DECISION-216; F210, F211, F213, F214).
 *
 * Two connections, on purpose:
 *   - `presby_app` (`db`, RLS enforced, NOBYPASSRLS) for everything the
 *     application path can do: the guard's non-owner rules, the revoked
 *     DELETE, the indexes and CHECKs as a tenant meets them, the deferred
 *     "at least one main" check, the invoker reader under an org GUC, and the
 *     two re-created invitation definers;
 *   - the owner (`getPlatformDb()`) for fixtures and for what only the owner
 *     can reach (the guard binding the owner too, the stop-block, the whole
 *     file re-applied). Owner work that must not persist runs inside a
 *     transaction that is always rolled back.
 *
 * Deferred-check cases force the commit-time check with
 * `set constraints contact_methods_primary_required immediate` inside a
 * rolled-back transaction; two cases COMMIT for real, so the "at commit"
 * claim is proven as stated, not only by the immediate-mode shortcut.
 *
 * The TypeScript halves (isValidEmailShape's one-way pin, the chooseEmail
 * matrix, the treasurer match and the do_not_contact warning in issue.ts)
 * are Batch 2's (store/matrix/ended-readers suites). This file proves the
 * SQL side only.
 *
 * Fixtures: synthetic names, `example.invalid` addresses (No Real Data);
 * organizations and people are stamped `deletable_until` at insert by
 * createInvitationFixture(), whose cleanup cascades every contact row here.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/contact-methods.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
// Remote Neon, many round trips per case; the defaults are too tight on a
// cold pipeline branch.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const MIGRATION_PATH = path.join(process.cwd(), "drizzle", "0064_presby_person_emails.sql");
const GUARD_IMMUTABLE = /id, person_id, kind, value and created_at are immutable/;
const GUARD_ENDED = /is ended and cannot change/;
// drizzle/0065 section 7 (R43) re-states 0064's message: two owner-path
// writers now, invitation acceptance and sign-in connection.
const GUARD_VERIFIED = /verified_at is set only on the owner path, by invitation acceptance or by sign-in connection/;
const NO_MAIN = /has active email addresses and no main address/;

// The driver's transaction object, typed loosely so one helper serves both
// connections (the participant-roll suite's cast, same reason).
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

/** The text of one numbered section of 0064 (`-- N. title` to the next). */
function migrationSection(n: number): string {
  const text = readFileSync(MIGRATION_PATH, "utf8");
  const start = text.search(new RegExp(`^-- ${n}\\. `, "m"));
  const end = text.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0 || end < 0) throw new Error(`section ${n} not found in 0064`);
  return text.slice(start, end);
}

describe.skipIf(!hasDb)("drizzle/0064 contact_methods (Postgres-backed)", () => {
  let fx: InvitationFixture;
  let FAKE_BCRYPT: string;
  let orgA: string;
  let orgB: string;

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  /** A fresh person, a member of orgA unless `org` is null. */
  async function subject(org: string | null = orgA, first = "Ottoline"): Promise<string> {
    const p = await fx.makePerson(first, `Brackwater${Math.floor(Math.random() * 1e6)}`);
    if (org) await fx.addMember(org, p);
    return p;
  }

  interface RowOpts {
    kind?: "email" | "phone" | string;
    subtype?: string | null;
    primary?: boolean;
    dnc?: boolean;
    /** Minutes after 2020-01-01T00:00Z (owner may supply created_at). */
    minute?: number;
    ended?: boolean;
    verified?: boolean;
  }

  function insertSql(person: string, value: string, o: RowOpts = {}): SQL {
    return sql`
      insert into contact_methods (person_id, kind, subtype, value, is_primary, do_not_contact,
                                   created_at, ended_at, verified_at)
      values (${person}, ${o.kind ?? "email"}, ${o.subtype ?? null}, ${value}, ${o.primary ?? false},
              ${o.dnc ?? false},
              ${o.minute === undefined ? sql`clock_timestamp()` : sql`timestamptz '2020-01-01T00:00:00Z' + ${o.minute} * interval '1 minute'`},
              ${o.ended ? sql`now()` : sql`null`}, ${o.verified ? sql`now()` : sql`null`})
      returning id`;
  }

  /** An owner-path insert, committed (the deferred check runs at its commit). */
  async function addRow(person: string, value: string, o: RowOpts = {}): Promise<string> {
    const [row] = await q(insertSql(person, value, o));
    return String(row!.id);
  }

  async function rowOf(id: string): Promise<Row> {
    const [row] = await q(sql`
      select id, value, subtype, is_primary, do_not_contact, verified_at, ended_at, created_at
        from contact_methods where id = ${id}`);
    return row!;
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

  async function inRolledBackAppTx(org: string | null, fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await fx.appDb.transaction(async (tx) => {
        if (org) await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        await fn(tx as unknown as Tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** A COMMITTED presby_app transaction under `org`. */
  async function inAppTx<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fx.appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  }

  /** Runs `query` in a savepoint and returns its error (the outer tx stays usable). */
  async function rejected(tx: Tx, query: SQL): Promise<{ code?: string; text: string }> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(query);
      });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error(`expected the statement to be rejected`);
    return { code: pgCode(caught), text: pgText(caught) };
  }

  /** True when `query` succeeds inside a savepoint (rolled back to it either way is not needed). */
  async function accepted(tx: Tx, query: SQL): Promise<boolean> {
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(query);
      });
      return true;
    } catch {
      return false;
    }
  }

  const forceDeferred = sql`set constraints contact_methods_primary_required immediate`;

  beforeAll(async () => {
    const { createInvitationFixture, FAKE_BCRYPT: bcrypt } = await import("@/lib/testing/invitation-fixture");
    FAKE_BCRYPT = bcrypt;
    fx = await createInvitationFixture("cm64");
    orgA = await fx.makeOrg("a");
    orgB = await fx.makeOrg("b");
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  // ===========================================================================
  // Structure
  // ===========================================================================
  describe("structure", () => {
    it("created_at is NOT NULL with default clock_timestamp(); ended_at is nullable (F210, ER1, D2)", async () => {
      const rows = await q(sql`
        select column_name, is_nullable, column_default
          from information_schema.columns
         where table_schema = 'public' and table_name = 'contact_methods'
           and column_name in ('created_at', 'ended_at')
         order by column_name`);
      expect(rows).toEqual([
        { column_name: "created_at", is_nullable: "NO", column_default: "clock_timestamp()" },
        { column_name: "ended_at", is_nullable: "YES", column_default: null },
      ]);
    });

    it("the four CHECKs exist and are VALIDATED (F213)", async () => {
      const rows = await q(sql`
        select conname, convalidated from pg_constraint
         where conrelid = 'contact_methods'::regclass and contype = 'c' order by conname`);
      expect(rows).toEqual([
        { conname: "contact_methods_ended_not_primary", convalidated: true },
        { conname: "contact_methods_kind_check", convalidated: true },
        { conname: "contact_methods_subtype_check", convalidated: true },
        { conname: "contact_methods_value_shape", convalidated: true },
      ]);
    });

    it("the three partial indexes, with their predicates; the lower(value) index is gone (ER15, ER17, S2, S9)", async () => {
      const rows = await q(sql`
        select indexname, indexdef from pg_indexes
         where schemaname = 'public' and tablename = 'contact_methods' order by indexname`);
      const byName = Object.fromEntries(rows.map((r) => [String(r.indexname), String(r.indexdef)]));
      expect(Object.keys(byName).sort()).toEqual([
        "contact_methods_email_norm_idx",
        "contact_methods_one_primary_uq",
        "contact_methods_person_email_uq",
        "contact_methods_person_idx",
        "contact_methods_pkey",
      ]);
      expect(byName.contact_methods_one_primary_uq).toBe(
        "CREATE UNIQUE INDEX contact_methods_one_primary_uq ON public.contact_methods USING btree (person_id, kind) WHERE (is_primary AND (ended_at IS NULL))",
      );
      expect(byName.contact_methods_person_email_uq).toBe(
        "CREATE UNIQUE INDEX contact_methods_person_email_uq ON public.contact_methods USING btree (person_id, lower(btrim(value))) WHERE ((kind = 'email'::text) AND (ended_at IS NULL))",
      );
      expect(byName.contact_methods_email_norm_idx).toBe(
        "CREATE INDEX contact_methods_email_norm_idx ON public.contact_methods USING btree (lower(btrim(value))) WHERE ((kind = 'email'::text) AND (ended_at IS NULL))",
      );
    });

    it("the guard is a BEFORE INSERT OR UPDATE row trigger; the primary check is a deferrable, initially deferred constraint trigger (ER1c, ER15)", async () => {
      const rows = await q(sql`
        select tgname, tgenabled, tgdeferrable, tginitdeferred, tgconstraint <> 0 as is_constraint,
               (tgtype & 2) <> 0 as before, (tgtype & 1) <> 0 as row_level,
               (tgtype & 4) <> 0 as on_insert, (tgtype & 16) <> 0 as on_update, (tgtype & 8) <> 0 as on_delete,
               p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config
          from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'contact_methods'::regclass and not t.tgisinternal
         order by tgname`);
      expect(rows).toEqual([
        {
          tgname: "contact_methods_guard_write", tgenabled: "O", tgdeferrable: false, tginitdeferred: false,
          is_constraint: false, before: true, row_level: true, on_insert: true, on_update: true, on_delete: false,
          proname: "presby_contact_methods_guard_write", prosecdef: false, config: "search_path=public, pg_temp",
        },
        {
          tgname: "contact_methods_primary_required", tgenabled: "O", tgdeferrable: true, tginitdeferred: true,
          is_constraint: true, before: false, row_level: true, on_insert: true, on_update: true, on_delete: false,
          proname: "presby_contact_methods_primary_check", prosecdef: true, config: "search_path=public, pg_temp",
        },
      ]);
    });

    it("function surface: the reader is invoker, pinned, executable by presby_app only; the trigger functions by nobody but the owner (ER11)", async () => {
      const rows = await q(sql`
        select p.proname, p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',') as config,
               has_function_privilege('presby_app', p.oid, 'execute') as app,
               has_function_privilege('presby_platform', p.oid, 'execute') as platform,
               coalesce(p.proacl::text like '%=X/%' and p.proacl::text ~ '(^|[{,])=X', false) as public_exec
          from pg_proc p
         where p.proname in ('presby_person_email', 'presby_contact_methods_guard_write',
                             'presby_contact_methods_primary_check')
         order by p.proname`);
      expect(rows).toEqual([
        { proname: "presby_contact_methods_guard_write", prosecdef: false, provolatile: "v", config: "search_path=public, pg_temp", app: false, platform: false, public_exec: false },
        { proname: "presby_contact_methods_primary_check", prosecdef: true, provolatile: "v", config: "search_path=public, pg_temp", app: false, platform: false, public_exec: false },
        { proname: "presby_person_email", prosecdef: false, provolatile: "s", config: "search_path=public, pg_temp", app: true, platform: false, public_exec: false },
      ]);
      const [sig] = await q(sql`select pg_get_function_identity_arguments('presby_person_email'::regproc) as args,
                                       pg_get_function_result('presby_person_email'::regproc) as result`);
      expect(sig).toEqual({
        args: "p_person_id uuid, p_purpose text",
        result: "TABLE(contact_method_id uuid, address text, subtype text, do_not_contact boolean)",
      });
    });

    it("privileges: DELETE is gone from presby_app and presby_platform; SELECT/INSERT/UPDATE remain; the owner keeps DELETE (ER1b)", async () => {
      const [r] = await q(sql`
        select has_table_privilege('presby_app', 'contact_methods', 'DELETE') as app_delete,
               has_table_privilege('presby_platform', 'contact_methods', 'DELETE') as platform_delete,
               has_table_privilege('presby_app', 'contact_methods', 'SELECT,INSERT,UPDATE') as app_siu,
               has_table_privilege('presby_platform', 'contact_methods', 'SELECT,INSERT,UPDATE') as platform_siu,
               has_table_privilege((select relowner from pg_class where oid = 'contact_methods'::regclass),
                                   'contact_methods', 'DELETE') as owner_delete`);
      expect(r).toEqual({ app_delete: false, platform_delete: false, app_siu: true, platform_siu: true, owner_delete: true });
    });

    it("FORCE RLS and the same four person-level policies (unchanged by 0064)", async () => {
      const [c] = await q(sql`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'contact_methods'::regclass`);
      expect(c).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const pols = await q(sql`select policyname, cmd from pg_policies where tablename = 'contact_methods' order by policyname`);
      expect(pols).toEqual([
        { policyname: "visible_via_membership_delete", cmd: "DELETE" },
        { policyname: "visible_via_membership_insert", cmd: "INSERT" },
        { policyname: "visible_via_membership_read", cmd: "SELECT" },
        { policyname: "visible_via_membership_update", cmd: "UPDATE" },
      ]);
    });

    // drizzle/0065 section 13 moved the acceptance body into the owner-only
    // presby__accept_invitation_core (the token wrapper reads no contact row)
    // and added three sign_in currency checks (preview's, and the core's
    // unlocked and FOR SHARE ones): 0064's 3 + 1 sites are now 0 + 5 + 2.
    it("preview, accept and the accept core are definers with a pinned search_path, carry ended_at at every contact site (ER3; 0065 section 13), and only preview and accept are executable by presby_app", async () => {
      const rows = await q(sql`
        select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config,
               has_function_privilege('presby_app', p.oid, 'execute') as app,
               has_function_privilege('presby_platform', p.oid, 'execute') as platform,
               (length(p.prosrc) - length(replace(p.prosrc, 'ended_at is null', ''))) / length('ended_at is null') as sites
          from pg_proc p
         where p.proname in ('presby_preview_invitation', 'presby_accept_invitation', 'presby__accept_invitation_core')
         order by p.proname`);
      expect(rows).toEqual([
        { proname: "presby__accept_invitation_core", prosecdef: true, config: "search_path=public, pg_temp", app: false, platform: false, sites: 5 },
        { proname: "presby_accept_invitation", prosecdef: true, config: "search_path=public, pg_temp", app: true, platform: false, sites: 0 },
        { proname: "presby_preview_invitation", prosecdef: true, config: "search_path=public, pg_temp", app: true, platform: false, sites: 2 },
      ]);
    });

    it("catalog scan: every function body that names contact_methods also names ended_at, bar presby_guard_people_delete's comment (ER3b)", async () => {
      const rows = await q(sql`
        select proname from pg_proc
         where prosrc ilike '%contact_methods%' and prosrc not ilike '%ended_at%'
         order by proname`);
      expect(rows.map((r) => r.proname)).toEqual(["presby_guard_people_delete"]);
    });
  });

  // ===========================================================================
  // The guard (ER1c, ER1e, D2, F214)
  // ===========================================================================
  describe("guard: end-and-replace is a database property", () => {
    it("value, kind, person_id, created_at and id are immutable, for presby_app AND the owner", async () => {
      const p = await subject();
      const other = await subject();
      const id = await addRow(p, fx.email("imm"), { primary: true });
      const attempts: Array<[string, SQL]> = [
        ["value", sql`update contact_methods set value = ${fx.email("imm2")} where id = ${id}`],
        ["kind", sql`update contact_methods set kind = 'phone', value = '555-0101' where id = ${id}`],
        ["person_id", sql`update contact_methods set person_id = ${other} where id = ${id}`],
        ["created_at", sql`update contact_methods set created_at = created_at - interval '1 day' where id = ${id}`],
        ["id", sql`update contact_methods set id = gen_random_uuid() where id = ${id}`],
      ];
      await inRolledBackAppTx(orgA, async (tx) => {
        for (const [label, query] of attempts) {
          const r = await rejected(tx, query);
          expect({ label, code: r.code }).toEqual({ label, code: "42501" });
          expect(r.text).toMatch(GUARD_IMMUTABLE);
        }
      });
      await inRolledBackOwnerTx(async (tx) => {
        for (const [label, query] of attempts) {
          const r = await rejected(tx, query);
          expect({ label, code: r.code }).toEqual({ label, code: "42501" });
          expect(r.text).toMatch(GUARD_IMMUTABLE);
        }
      });
      expect(await rowOf(id)).toMatchObject({ is_primary: true, ended_at: null });
    });

    it("an ended row is frozen for every role: no relabel, no un-ending, no re-dating", async () => {
      const p = await subject();
      await addRow(p, fx.email("live"), { primary: true });
      const ended = await addRow(p, fx.email("gone"), { ended: true });
      const attempts: Array<[string, SQL]> = [
        ["relabel", sql`update contact_methods set subtype = 'work' where id = ${ended}`],
        ["un-end", sql`update contact_methods set ended_at = null where id = ${ended}`],
        ["re-date", sql`update contact_methods set ended_at = now() - interval '1 day' where id = ${ended}`],
        ["do_not_contact", sql`update contact_methods set do_not_contact = true where id = ${ended}`],
      ];
      for (const run of [inRolledBackAppTx.bind(null, orgA), inRolledBackOwnerTx]) {
        await run(async (tx) => {
          for (const [label, query] of attempts) {
            const r = await rejected(tx, query);
            expect({ label, code: r.code }).toEqual({ label, code: "42501" });
            expect(r.text).toMatch(GUARD_ENDED);
          }
        });
      }
    });

    it("verified_at write refused as presby_app (insert and update); the owner may write it", async () => {
      const p = await subject();
      const id = await addRow(p, fx.email("ver"), { primary: true });
      await inRolledBackAppTx(orgA, async (tx) => {
        const up = await rejected(tx, sql`update contact_methods set verified_at = now() where id = ${id}`);
        expect(up.code).toBe("42501");
        expect(up.text).toMatch(GUARD_VERIFIED);
        const ins = await rejected(tx, sql`
          insert into contact_methods (person_id, kind, value, is_primary, verified_at)
          values (${p}, 'email', ${fx.email("ver2")}, false, now())`);
        expect(ins.code).toBe("42501");
        expect(ins.text).toMatch(GUARD_VERIFIED);
      });
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`update contact_methods set verified_at = now() where id = ${id}`);
        const [r] = rowsOf(await tx.execute(sql`select verified_at is not null as v from contact_methods where id = ${id}`));
        expect(r!.v).toBe(true);
      });
    });

    it("presby_app cannot insert an ended row, and cannot backdate created_at (forced to clock_timestamp)", async () => {
      const p = await subject();
      await addRow(p, fx.email("main"), { primary: true });
      await inRolledBackAppTx(orgA, async (tx) => {
        const r = await rejected(tx, sql`
          insert into contact_methods (person_id, kind, value, is_primary, ended_at)
          values (${p}, 'email', ${fx.email("born-ended")}, false, now())`);
        expect(r.code).toBe("42501");
        expect(r.text).toMatch(/a new address starts active/);

        const value = fx.email("backdated");
        await tx.execute(sql`
          insert into contact_methods (person_id, kind, value, is_primary, created_at)
          values (${p}, 'email', ${value}, false, timestamptz '2000-01-01T00:00:00Z')`);
        const [row] = rowsOf(await tx.execute(sql`
          select created_at >= now() as forced from contact_methods where person_id = ${p} and value = ${value}`));
        expect(row!.forced).toBe(true);
      });
    });

    it("the owner may supply created_at (seeds and fixtures need ordered rows)", async () => {
      const p = await subject();
      const id = await addRow(p, fx.email("old"), { primary: true, minute: 0 });
      const [r] = await q(sql`select created_at = timestamptz '2020-01-01T00:00:00Z' as kept from contact_methods where id = ${id}`);
      expect(r!.kept).toBe(true);
    });

    it("the legal in-place changes pass as presby_app: label, do_not_contact, demote-and-promote, and the end itself", async () => {
      const p = await subject();
      const a = await addRow(p, fx.email("a"), { primary: true, subtype: "personal" });
      const b = await addRow(p, fx.email("b"));
      await inRolledBackAppTx(orgA, async (tx) => {
        await tx.execute(sql`update contact_methods set subtype = 'work', do_not_contact = true where id = ${b}`);
        await tx.execute(sql`update contact_methods set is_primary = false, ended_at = now() where id = ${a}`);
        await tx.execute(sql`update contact_methods set is_primary = true where id = ${b}`);
        await tx.execute(forceDeferred);
        const rows = rowsOf(await tx.execute(sql`
          select id, subtype, do_not_contact, is_primary, ended_at is not null as ended
            from contact_methods where person_id = ${p} order by created_at, id`));
        expect(rows).toEqual([
          { id: a, subtype: "personal", do_not_contact: false, is_primary: false, ended: true },
          { id: b, subtype: "work", do_not_contact: true, is_primary: true, ended: false },
        ]);
      });
    });

    it("resurrection: ending then re-adding an address gives a NEW, unverified row; the verified one stays ended", async () => {
      const p = await subject();
      const value = fx.email("again");
      const old = await addRow(p, value, { primary: true, verified: true });
      await inAppTx(orgA, async (tx) => {
        await tx.execute(sql`update contact_methods set is_primary = false, ended_at = now() where id = ${old}`);
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p}, 'email', ${value}, true)`);
      });
      const rows = await q(sql`
        select id = ${old} as is_old, verified_at is not null as verified, ended_at is not null as ended, is_primary
          from contact_methods where person_id = ${p} order by created_at, id`);
      expect(rows).toEqual([
        { is_old: true, verified: true, ended: true, is_primary: false },
        { is_old: false, verified: false, ended: false, is_primary: true },
      ]);
    });
  });

  // ===========================================================================
  // Revoked DELETE, the primary rules, uniqueness (ER1b, ER1d, ER15, ER17)
  // ===========================================================================
  describe("delete, primary and uniqueness", () => {
    it("delete is refused as presby_app (permission denied), even for a visible row", async () => {
      const p = await subject();
      const id = await addRow(p, fx.email("del"), { primary: true });
      await inRolledBackAppTx(orgA, async (tx) => {
        const [seen] = rowsOf(await tx.execute(sql`select count(*)::int as n from contact_methods where id = ${id}`));
        expect(seen!.n).toBe(1);
        const r = await rejected(tx, sql`delete from contact_methods where id = ${id}`);
        expect(r.code).toBe("42501");
        expect(r.text).toMatch(/permission denied for table contact_methods/);
      });
      expect(await rowOf(id)).toMatchObject({ id });
    });

    it("a second active primary is refused, for email and for phone", async () => {
      const p = await subject();
      await addRow(p, fx.email("m1"), { primary: true });
      await addRow(p, "555-0110", { kind: "phone", primary: true });
      await inRolledBackAppTx(orgA, async (tx) => {
        const e = await rejected(tx, sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p}, 'email', ${fx.email("m2")}, true)`);
        expect(e.code).toBe("23505");
        expect(e.text).toMatch(/contact_methods_one_primary_uq/);
        const ph = await rejected(tx, sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p}, 'phone', '555-0111', true)`);
        expect(ph.code).toBe("23505");
        expect(ph.text).toMatch(/contact_methods_one_primary_uq/);
      });
    });

    it("an ended row cannot be primary: ending the main without clearing the flag is refused (ER1d)", async () => {
      const p = await subject();
      const id = await addRow(p, fx.email("endmain"), { primary: true });
      await inRolledBackAppTx(orgA, async (tx) => {
        const r = await rejected(tx, sql`update contact_methods set ended_at = now() where id = ${id}`);
        expect(r.code).toBe("23514");
        expect(r.text).toMatch(/contact_methods_ended_not_primary/);
        // Clearing the flag in the same statement is the legal end.
        await tx.execute(sql`update contact_methods set is_primary = false, ended_at = now() where id = ${id}`);
        await tx.execute(forceDeferred);
      });
      await inRolledBackOwnerTx(async (tx) => {
        const r = await rejected(tx, insertSql(p, fx.email("ended-main"), { primary: true, ended: true }));
        expect(r.code).toBe("23514");
        expect(r.text).toMatch(/contact_methods_ended_not_primary/);
      });
    });

    it("one active row per (person, address): a duplicate is refused, re-adding after ending is allowed, two people may share", async () => {
      const p = await subject();
      const sharer = await subject();
      const value = fx.email("dup");
      const id = await addRow(p, value, { primary: true });
      await inRolledBackOwnerTx(async (tx) => {
        const r = await rejected(tx, insertSql(p, value));
        expect(r.code).toBe("23505");
        expect(r.text).toMatch(/contact_methods_person_email_uq/);
        await tx.execute(sql`update contact_methods set is_primary = false, ended_at = now() where id = ${id}`);
        await tx.execute(insertSql(p, value, { primary: true }));
        await tx.execute(insertSql(sharer, value, { primary: true }));
        await tx.execute(forceDeferred);
      });
    });
  });

  // ===========================================================================
  // The deferred "at least one main" check (ER15, F26)
  // ===========================================================================
  describe("deferred check: at least one active main email", () => {
    it("refused AT COMMIT: presby_app demotes the only main and commits", async () => {
      const p = await subject();
      const id = await addRow(p, fx.email("only"), { primary: true });
      await addRow(p, fx.email("second"));
      let caught: unknown;
      try {
        await inAppTx(orgA, async (tx) => {
          await tx.execute(sql`update contact_methods set is_primary = false where id = ${id}`);
        });
      } catch (err) {
        caught = err;
      }
      expect(caught, "the commit must fail").toBeDefined();
      expect(pgCode(caught)).toBe("23514");
      expect(pgText(caught)).toMatch(NO_MAIN);
      expect(await rowOf(id)).toMatchObject({ is_primary: true });
    });

    it("refused: a non-main email for a person with no main", async () => {
      const p = await subject();
      await inRolledBackAppTx(orgA, async (tx) => {
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p}, 'email', ${fx.email("nomain")}, false)`);
        const r = await rejected(tx, forceDeferred);
        expect(r.code).toBe("23514");
        expect(r.text).toMatch(NO_MAIN);
      });
    });

    it("SECURITY DEFINER (F26): it counts rows presby_app cannot see, in createPerson's pre-membership window (D11)", async () => {
      // An unclaimed person (no membership anywhere): the insert policy lets
      // presby_app write their contact rows, the read policy shows none. An
      // invoker check would count zero active rows and pass.
      const p = await subject(null);
      await inRolledBackAppTx(orgA, async (tx) => {
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p}, 'email', ${fx.email("unseen")}, false)`);
        const [seen] = rowsOf(await tx.execute(sql`select count(*)::int as n from contact_methods where person_id = ${p}`));
        expect(seen!.n).toBe(0);
        const r = await rejected(tx, forceDeferred);
        expect(r.code).toBe("23514");
        expect(r.text).toMatch(NO_MAIN);
      });
      // Positive control: the same window, inserting the main, passes.
      await inRolledBackAppTx(orgA, async (tx) => {
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p}, 'email', ${fx.email("unseen-main")}, true)`);
        await tx.execute(forceDeferred);
      });
    });

    it("passes: demote-then-promote in one transaction; ending the only email; phones carry no at-least-one rule", async () => {
      const p = await subject();
      const a = await addRow(p, fx.email("x"), { primary: true });
      const b = await addRow(p, fx.email("y"));
      await inRolledBackAppTx(orgA, async (tx) => {
        await tx.execute(sql`update contact_methods set is_primary = false where id = ${a}`);
        await tx.execute(sql`update contact_methods set is_primary = true where id = ${b}`);
        await tx.execute(forceDeferred);
      });
      await inRolledBackAppTx(orgA, async (tx) => {
        await tx.execute(sql`update contact_methods set ended_at = now() where id = ${b}`);
        await tx.execute(sql`update contact_methods set is_primary = false, ended_at = now() where id = ${a}`);
        await tx.execute(forceDeferred);
      });
      const q2 = await subject();
      await inRolledBackAppTx(orgA, async (tx) => {
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${q2}, 'phone', '555-0120', false)`);
        await tx.execute(forceDeferred);
      });
    });

    it("a fixture cascade (owner deletes a deletable_until person) passes, committed", async () => {
      const p = await subject(null);
      await addRow(p, fx.email("casc-main"), { primary: true });
      await addRow(p, fx.email("casc-other"));
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`delete from people where id = ${p}`);
      });
      const [n] = await q(sql`select count(*)::int as n from contact_methods where person_id = ${p}`);
      expect(n!.n).toBe(0);
    });
  });

  // ===========================================================================
  // CHECK samples (ER16, ER18) and the subset pin against the invitation shape
  // ===========================================================================
  describe("CHECK samples", () => {
    const local64 = "a".repeat(64);
    const len254 = `${local64}@${"b".repeat(186)}.co`;
    const len255 = `${local64}@${"b".repeat(187)}.co`;
    const SAMPLES: Array<{ label: string; kind: string; value: string; subtype?: string | null; ok: boolean }> = [
      { label: "plain", kind: "email", value: "plain@example.invalid", ok: true },
      { label: "plus tag and dots", kind: "email", value: "first.last+tag@example.invalid", ok: true },
      { label: "underscore, subdomain", kind: "email", value: "x_y@sub.example.invalid", ok: true },
      { label: "non-ascii, lowercase", kind: "email", value: "émile@exämple.invalid", ok: true },
      { label: "exactly 254", kind: "email", value: len254, ok: true },
      { label: "255", kind: "email", value: len255, ok: false },
      { label: "upper case", kind: "email", value: "Upper@example.invalid", ok: false },
      { label: "leading space", kind: "email", value: " lead@example.invalid", ok: false },
      { label: "trailing space", kind: "email", value: "trail@example.invalid ", ok: false },
      { label: "inner space", kind: "email", value: "in ner@example.invalid", ok: false },
      { label: "tab", kind: "email", value: "ta\tb@example.invalid", ok: false },
      { label: "newline", kind: "email", value: "nl@example.invalid\n", ok: false },
      { label: "two @", kind: "email", value: "a@b@example.invalid", ok: false },
      { label: "double @", kind: "email", value: "a@@example.invalid", ok: false },
      { label: "comma", kind: "email", value: "a,b@example.invalid", ok: false },
      { label: "comma list", kind: "email", value: "a@x.invalid, b@y.invalid", ok: false },
      { label: "no dot in domain", kind: "email", value: "a@localhost", ok: false },
      { label: "no local part", kind: "email", value: "@example.invalid", ok: false },
      { label: "domain starts with dot", kind: "email", value: "a@.invalid", ok: false },
      { label: "domain ends with dot", kind: "email", value: "a@example.", ok: false },
      { label: "no @", kind: "email", value: "example.invalid", ok: false },
      { label: "empty", kind: "email", value: "", ok: false },
      { label: "email personal", kind: "email", value: "lab1@example.invalid", subtype: "personal", ok: true },
      { label: "email work", kind: "email", value: "lab2@example.invalid", subtype: "work", ok: true },
      { label: "email other", kind: "email", value: "lab3@example.invalid", subtype: "other", ok: true },
      { label: "email home (migrated away)", kind: "email", value: "lab4@example.invalid", subtype: "home", ok: false },
      { label: "email mobile", kind: "email", value: "lab5@example.invalid", subtype: "mobile", ok: false },
      { label: "phone", kind: "phone", value: "555-0130", ok: true },
      { label: "phone mobile", kind: "phone", value: "555-0131", subtype: "mobile", ok: true },
      { label: "phone home", kind: "phone", value: "555-0132", subtype: "home", ok: true },
      { label: "phone work", kind: "phone", value: "555-0133", subtype: "work", ok: true },
      { label: "phone personal", kind: "phone", value: "555-0134", subtype: "personal", ok: false },
      { label: "phone blank", kind: "phone", value: "", ok: false },
      { label: "phone spaces only", kind: "phone", value: "   ", ok: false },
      { label: "phone padded", kind: "phone", value: " 555-0135", ok: false },
      { label: "unknown kind", kind: "fax", value: "555-0136", ok: false },
    ];

    it("each sample is accepted or refused exactly as the CHECKs state", async () => {
      const p = await subject(null);
      const outcomes: Array<{ label: string; ok: boolean }> = [];
      await inRolledBackOwnerTx(async (tx) => {
        for (const s of SAMPLES) {
          // Unique per-run values so a shared branch never collides.
          outcomes.push({ label: s.label, ok: await accepted(tx, insertSql(p, s.value, { kind: s.kind, subtype: s.subtype ?? null })) });
        }
      });
      expect(outcomes).toEqual(SAMPLES.map((s) => ({ label: s.label, ok: s.ok })));
    });

    it("subset pin: every email the contact CHECK accepts also passes account_invitations_email_shape (ER13)", async () => {
      const [def] = await q(sql`
        select regexp_replace(pg_get_constraintdef(oid), '^CHECK ', '') as expr
          from pg_constraint where conname = 'account_invitations_email_shape'`);
      const expr = String(def!.expr);
      for (const s of SAMPLES.filter((x) => x.kind === "email" && x.ok)) {
        const [r] = await q(sql`select (${sql.raw(expr)}) as ok from (select ${s.value}::text as email_normalized) s`);
        expect({ label: s.label, ok: r!.ok }).toEqual({ label: s.label, ok: true });
      }
    });
  });

  // ===========================================================================
  // The reader (ER11, ER12)
  // ===========================================================================
  describe("presby_person_email", () => {
    async function read(person: string, purpose: string, org: string | null = orgA): Promise<Row[]> {
      let out: Row[] = [];
      await inRolledBackAppTx(org, async (tx) => {
        out = rowsOf(await tx.execute(sql`select * from presby_person_email(${person}::uuid, ${purpose}::text)`));
      });
      return out;
    }
    async function pick(person: string, purpose: string): Promise<string | null> {
      const rows = await read(person, purpose);
      expect(rows.length).toBeLessThanOrEqual(1);
      return rows[0] ? String(rows[0].address) : null;
    }

    interface Case {
      label: string;
      rows: Array<{ tag: string; o: RowOpts }>;
      expect: { credential: string | null; role: string | null; personal: string | null };
    }
    const CASES: Case[] = [
      {
        label: "Personal main, Work, Other",
        rows: [
          { tag: "p", o: { subtype: "personal", primary: true, minute: 1 } },
          { tag: "w", o: { subtype: "work", minute: 2 } },
          { tag: "o", o: { subtype: "other", minute: 3 } },
        ],
        expect: { credential: "p", role: "w", personal: "p" },
      },
      {
        label: "Work main, Personal",
        rows: [
          { tag: "w", o: { subtype: "work", primary: true, minute: 1 } },
          { tag: "p", o: { subtype: "personal", minute: 2 } },
        ],
        expect: { credential: "w", role: "w", personal: "p" },
      },
      {
        label: "do_not_contact main (returned for credential only), Work also do_not_contact, unlabelled",
        rows: [
          { tag: "m", o: { primary: true, dnc: true, minute: 1 } },
          { tag: "w", o: { subtype: "work", dnc: true, minute: 2 } },
          { tag: "n", o: { minute: 3 } },
        ],
        expect: { credential: "m", role: "n", personal: "n" },
      },
      {
        label: "two Work rows: role takes the oldest non-main Work after any Work main",
        rows: [
          { tag: "p", o: { subtype: "personal", primary: true, minute: 1 } },
          { tag: "w2", o: { subtype: "work", minute: 5 } },
          { tag: "w1", o: { subtype: "work", minute: 4 } },
        ],
        expect: { credential: "p", role: "w1", personal: "p" },
      },
      {
        label: "only a do_not_contact Work main",
        rows: [{ tag: "w", o: { subtype: "work", primary: true, dnc: true, minute: 1 } }],
        expect: { credential: "w", role: null, personal: null },
      },
      {
        label: "only ended rows",
        rows: [{ tag: "e", o: { ended: true, minute: 1 } }],
        expect: { credential: null, role: null, personal: null },
      },
      {
        label: "no rows",
        rows: [],
        expect: { credential: null, role: null, personal: null },
      },
      {
        label: "ended main replaced; null labels",
        rows: [
          { tag: "new", o: { primary: true, minute: 9 } },
          { tag: "old", o: { ended: true, minute: 1 } },
          { tag: "x", o: { minute: 5 } },
        ],
        expect: { credential: "new", role: "new", personal: "new" },
      },
    ];

    for (const c of CASES) {
      it(`matrix: ${c.label}`, async () => {
        const p = await subject();
        const addr: Record<string, string> = {};
        for (const r of c.rows) {
          addr[r.tag] = fx.email(r.tag);
          await addRow(p, addr[r.tag]!, r.o);
        }
        const got = {
          credential: await pick(p, "credential"),
          role: await pick(p, "role"),
          personal: await pick(p, "personal"),
        };
        const want = {
          credential: c.expect.credential && addr[c.expect.credential]!,
          role: c.expect.role && addr[c.expect.role]!,
          personal: c.expect.personal && addr[c.expect.personal]!,
        };
        expect(got).toEqual(want);
      });
    }

    it("credential returns do_not_contact (the caller acknowledges); the row carries id, address, label, flag", async () => {
      const p = await subject();
      const value = fx.email("dnc");
      const id = await addRow(p, value, { subtype: "work", primary: true, dnc: true });
      expect(await read(p, "credential")).toEqual([
        { contact_method_id: id, address: value, subtype: "work", do_not_contact: true },
      ]);
    });

    it("created_at ties fall to id order (the shared order: is_primary desc, created_at, id)", async () => {
      const p = await subject();
      await addRow(p, fx.email("main"), { primary: true, dnc: true, minute: 1 });
      const a = await addRow(p, fx.email("tie-a"), { minute: 7 });
      const b = await addRow(p, fx.email("tie-b"), { minute: 7 });
      const first = [a, b].sort()[0];
      const rows = await read(p, "personal");
      expect(rows[0]!.contact_method_id).toBe(first);
    });

    it("an unknown or null purpose raises internal_error (R35)", async () => {
      const p = await subject();
      for (const purpose of ["credentials", "", null]) {
        await inRolledBackAppTx(orgA, async (tx) => {
          const r = await rejected(tx, sql`select * from presby_person_email(${p}::uuid, ${purpose}::text)`);
          expect(r.code).toBe("XX000");
          expect(r.text).toMatch(/presby_person_email: unknown purpose/);
        });
      }
    });

    it("invoker: another organization's context, or none, sees nothing", async () => {
      const p = await subject();
      await addRow(p, fx.email("iso"), { primary: true });
      expect(await read(p, "credential", orgA)).toHaveLength(1);
      expect(await read(p, "credential", orgB)).toEqual([]);
      expect(await read(p, "credential", null)).toEqual([]);
    });
  });

  // ===========================================================================
  // The four 0064 section 10 sites: an ended address is not on file (F211).
  // Failing-first, one predicate reverted at a time (work-log Phase 4 Batch
  // A): site 1 fails the preview case; site 2 fails both accept-resolution
  // cases; site 3 alone is visible only when an active and an ended copy
  // compete (the first accept case: the ended holder wins the `limit 1`), since
  // with site 2 in place an ended-only address counts zero; site 4 fails the
  // verified_at case (the stamp reaches the frozen ended row and the guard
  // raises).
  // ===========================================================================
  describe("ended addresses in the re-created invitation definers (F211)", () => {
    async function faInvitation(org: string, address: string) {
      return fx.insertInvitation({
        organizationId: org, purpose: "founding_administrator", email: address,
        createdByUserId: fx.actingUserId, firstName: "Marisol", lastName: "Quenby",
      });
    }
    function newAccount() {
      return { passwordHash: FAKE_BCRYPT, firstName: "Marisol", lastName: "Quenby" };
    }

    it("site 1, preview: an ended address does not name the person; an active one does", async () => {
      const org = await fx.makeOrg("pv");
      const address = fx.email("pv");
      const inv = await faInvitation(org, address);
      const q1 = await fx.makePerson("Rosamund", "Tilbury");
      await fx.addMember(org, q1);
      await addRow(q1, fx.email("rm"), { primary: true });
      await addRow(q1, address, { ended: true });
      expect((await fx.preview(inv.token))[0]!.person_display_name).toBe("Marisol Quenby");

      const org2 = await fx.makeOrg("pv2");
      const address2 = fx.email("pv2");
      const inv2 = await faInvitation(org2, address2);
      const q2 = await fx.makePerson("Rosamund", "Tilbury");
      await fx.addMember(org2, q2);
      await addRow(q2, address2, { primary: true });
      expect((await fx.preview(inv2.token))[0]!.person_display_name).toBe("Rosamund Tilbury");
    });

    it("sites 2 and 3, accept's match count and resolution: another person's ENDED copy neither makes the address ambiguous nor wins the match", async () => {
      const org = await fx.makeOrg("ac");
      const address = fx.email("ac");
      const inv = await faInvitation(org, address);
      const holder = await fx.makePerson("Active", "Holder");
      const former = await fx.makePerson("Former", "Holder");
      for (const p of [former, holder]) await fx.addMember(org, p);
      await addRow(former, fx.email("former-main"), { primary: true });
      await addRow(former, address, { ended: true });
      await addRow(holder, address, { primary: true });
      const r = await fx.accept(inv.token, newAccount());
      expect(r).toMatchObject({ outcome: "accepted", person_mode: "linked_person", person_id: holder });
    });

    it("sites 2 and 3, an address held only as ENDED resolves nobody (a new person is created)", async () => {
      const org = await fx.makeOrg("ar");
      const address = fx.email("ar");
      const inv = await faInvitation(org, address);
      const former = await fx.makePerson("Former", "Only");
      await fx.addMember(org, former);
      await addRow(former, address, { ended: true });
      const r = await fx.accept(inv.token, newAccount());
      expect(r).toMatchObject({ outcome: "accepted", person_mode: "created_person" });
      expect(r.person_id).not.toBe(former);
      const [f] = await q(sql`select user_id from people where id = ${former}`);
      expect(f!.user_id).toBeNull();
    });

    it("site 4, the verified_at stamp: only the ACTIVE row is proven; the ended row of the same address is untouched", async () => {
      const org = await fx.makeOrg("av");
      const address = fx.email("av");
      const inv = await faInvitation(org, address);
      const p = await fx.makePerson("Verity", "Stamp");
      await fx.addMember(org, p);
      const ended = await addRow(p, address, { ended: true, minute: 1 });
      const live = await addRow(p, address, { primary: true, minute: 2 });
      const r = await fx.accept(inv.token, newAccount());
      expect(r).toMatchObject({ outcome: "accepted", person_mode: "linked_person", person_id: p });
      expect((await rowOf(live)).verified_at).not.toBeNull();
      expect((await rowOf(ended)).verified_at).toBeNull();
    });
  });

  // ===========================================================================
  // The migration itself (ER19, idempotence)
  // ===========================================================================
  describe("migration", () => {
    it("the stop-block raises, counts only, for bad shape, several primaries and active emails without a main; a clean table passes", async () => {
      // Section 1 run against a constraint-free temp copy of the table, so no
      // lock is taken on the shared contact_methods.
      const stop = migrationSection(1).replaceAll("contact_methods", "cm_probe");
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`create temp table cm_probe (like contact_methods) on commit drop`);
        const p = "00000000-0000-4000-8000-000000000641";
        const p2 = "00000000-0000-4000-8000-000000000642";
        await tx.execute(sql`insert into cm_probe (id, person_id, kind, value, is_primary, do_not_contact, created_at)
                             values (gen_random_uuid(), ${p}, 'email', 'ok@example.invalid', true, false, now())`);
        await tx.execute(sql.raw(stop)); // clean: passes

        const cases: Array<[string, SQL]> = [
          ["bad_email_shape=1", sql`insert into cm_probe (id, person_id, kind, value, is_primary, do_not_contact, created_at)
                                    values (gen_random_uuid(), ${p}, 'email', 'Bad@Example.invalid', false, false, now())`],
          ["several_active_primaries=1", sql`insert into cm_probe (id, person_id, kind, value, is_primary, do_not_contact, created_at)
                                             values (gen_random_uuid(), ${p}, 'email', 'two@example.invalid', true, false, now())`],
          ["active_emails_without_primary=1", sql`insert into cm_probe (id, person_id, kind, value, is_primary, do_not_contact, created_at)
                                                  values (gen_random_uuid(), ${p2}, 'email', 'none@example.invalid', false, false, now())`],
        ];
        for (const [count, insert] of cases) {
          await tx.transaction(async (sp) => {
            await sp.execute(insert);
            const r = await rejected(sp, sql.raw(stop));
            expect(r.code).toBe("23514");
            expect(r.text).toContain(count);
            expect(r.text).not.toMatch(/@example\.invalid/); // counts, never a value
            throw new Rollback();
          }).catch((err) => {
            if (!(err instanceof Rollback)) throw err;
          });
        }
      });
    });

    it("the whole file applies twice more with no error, inside a rolled-back transaction", async () => {
      const text = readFileSync(MIGRATION_PATH, "utf8");
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql.raw(text));
        await tx.execute(sql.raw(text));
        const [n] = rowsOf(await tx.execute(sql`select count(*)::int as n from contact_methods where kind = 'email' and subtype = 'home'`));
        expect(n!.n).toBe(0);
      });
    });
  });
});
