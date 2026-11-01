/**
 * drizzle/0083_presby_help_contact.sql on a REAL Postgres connection
 * (docs/work-log/2026-10-31-help-contact.md, Phase 2 CA1/CA3/CA6, Phase 3
 * "Database tests"; DECISION-300/301/303). The presby_app half that needs no
 * owner statement is also in scripts/help-contact/test-rls-83.sql.
 *
 *   - the live catalog: FORCE RLS with ZERO policies, no table privilege for
 *     presby_app, presby_platform or PUBLIC, the two guards, the definer's
 *     shape and ACL, and its SQL constants agreeing with the TypeScript ones;
 *   - as presby_app (the real `db` login): SELECT, INSERT, UPDATE, DELETE and
 *     TRUNCATE are each 42501; EXECUTE on the definer works; after the
 *     operator's kill-switch revoke the call is 42501 (which submit.ts maps to
 *     "unavailable"), and the matching grant restores it;
 *   - on the OWNER path (getPlatformDb() is neondb_owner, which no grant
 *     binds, F44): the delete guard; the update guard's refusals (a rewrite of
 *     any personal field, an identity or provenance change, a clear while
 *     `new`, an unnamed clear, a partial clear, an un-clear, a re-stamp, a
 *     cleared row returning to `new`, an unnamed status change, a stamp moved
 *     without a status change) and its forced stamps; every CHECK;
 *   - the definer: `stored_notify` then `stored` inside one window, an aged
 *     claim letting the next message claim, the stored row's exact shape, the
 *     hourly and daily ceilings (`ceiling`, nothing written), and two
 *     concurrent connections: the second waits on the advisory lock, and of
 *     two concurrent committed submissions in a quiet window exactly one
 *     claims the notification.
 *
 * NOTHING DURABLE IS WRITTEN, with ONE exception. Every probe runs inside a
 * transaction that rolls back. Where a test needs a quiet table it disables
 * the delete guard and deletes inside that rolled-back transaction (DDL is
 * transactional; the careers cap-trigger precedent), so committed rows never
 * change a count. The exception is the concurrent-commit test: two
 * transactions on two connections cannot share a rolled-back view, so it
 * COMMITS two synthetic rows (example.invalid, a per-run marker) per run.
 * Messages cannot be deleted, so those rows stay; its expectation is read
 * from the committed state first, so a re-run inside the same hour (window
 * already claimed) asserts zero claims rather than failing.
 *
 * The kill-switch test COMMITS a revoke and re-grants in `finally`
 * (neondb_owner cannot SET ROLE presby_app, so the revoke cannot share a
 * transaction with the presby_app call).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/db/domain/help-contact.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import {
  HELP_CONTACT_DB_CEILING_PER_DAY,
  HELP_CONTACT_DB_CEILING_PER_HOUR,
  HELP_CONTACT_NOTIFY_WINDOW_MINUTES,
} from "./help-contact";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
type Exec = { execute: (q: SQL) => Promise<unknown> };
type TxRunner = { transaction: <T>(fn: (tx: Exec & TxRunner) => Promise<T>) => Promise<T> };

const SUBMIT = "presby_submit_help_contact(text, text, text, text, text)";

const MIGRATION = readFileSync(
  path.join(__dirname, "../../../../drizzle/0083_presby_help_contact.sql"),
  "utf8",
);

class Rollback extends Error {
  constructor() {
    super("rollback-on-purpose");
  }
}

function rowsOf(result: unknown): Row[] {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

function chain(err: unknown): { messages: string; codes: string[] } {
  const messages: string[] = [];
  const codes: string[] = [];
  for (let e = err as { message?: string; code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    messages.push(String(e.message ?? e));
    if (e.code) codes.push(e.code);
  }
  return { messages: messages.join(" | "), codes };
}

function isRollback(err: unknown): boolean {
  for (let e = err as { cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e instanceof Rollback) return true;
  }
  return chain(err).messages.includes("rollback-on-purpose");
}

/** Run `fn` in a transaction on `conn` that always rolls back. */
async function rolledBack<T>(conn: TxRunner, fn: (tx: Exec & TxRunner) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await conn.transaction(async (tx) => {
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!isRollback(err)) throw err;
  }
  return out as T;
}

/**
 * Expect `query` to raise, inside a SAVEPOINT on `tx` so the enclosing
 * transaction stays usable. Matches the message chain and the SQLSTATE.
 */
async function expectRaise(tx: TxRunner, query: SQL, pattern: RegExp, code: string): Promise<void> {
  let caught: unknown = null;
  try {
    await tx.transaction(async (sp) => {
      await sp.execute(query);
    });
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected a raise matching ${pattern}`).not.toBeNull();
  const { messages, codes } = chain(caught);
  expect(messages).toMatch(pattern);
  expect(codes).toContain(code);
}

const GUARD = "42501"; // insufficient_privilege: the guards and the grants
const CHECK = "23514"; // check_violation

describe.skipIf(!hasDb)("drizzle/0083 help_contact_messages (Postgres-backed)", () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const platform = async () => (await import("@/lib/db")).getPlatformDb() as unknown as Exec & TxRunner;
  const app = async () => (await import("@/lib/db")).db as unknown as Exec & TxRunner;
  const q = async (query: SQL) => rowsOf(await (await platform()).execute(query));

  /** Quiet the table inside a rolled-back transaction (see the header). */
  async function quiet(tx: Exec) {
    await tx.execute(sql`alter table help_contact_messages disable trigger help_contact_guard_delete`);
    await tx.execute(sql`delete from help_contact_messages`);
    await tx.execute(sql`alter table help_contact_messages enable trigger help_contact_guard_delete`);
  }

  /** An owner-path message, born new. */
  async function message(tx: Exec, extra: { name?: string | null } = {}): Promise<string> {
    const [r] = rowsOf(
      await tx.execute(sql`
        insert into help_contact_messages (topic, name, email, congregation, message)
        values ('signing_in', ${extra.name === undefined ? "Fixture Sender" : extra.name},
                ${`fixture-${stamp}@example.invalid`}, 'Fixture Congregation',
                'A fixture message long enough to pass.')
        returning id`),
    );
    return String(r!.id);
  }

  /** A users row for the operator stamps (rolled back with its transaction). */
  async function operator(tx: Exec, label: string): Promise<string> {
    const [r] = rowsOf(
      await tx.execute(sql`insert into users (email, name)
                           values (${`hc-operator-${label}-${stamp}@example.invalid`}, 'Fixture Operator')
                           returning id`),
    );
    return String(r!.id);
  }

  /**
   * Call the definer. `tag` (letters, digits and hyphens only) goes into the
   * statement text as a comment, because pg_stat_activity shows a
   * parameterized statement with $n placeholders, not its values.
   */
  async function submit(tx: Exec, email: string, body = "A message from the database test.", tag = ""): Promise<string> {
    if (!/^[A-Za-z0-9-]*$/.test(tag)) throw new Error(`unsafe tag: ${tag}`);
    const [r] = rowsOf(
      await tx.execute(sql`select presby_submit_help_contact('something_else', 'Test Sender', ${email},
                                                             'Test Congregation', ${body}) as outcome ${sql.raw(tag ? `/* ${tag} */` : "")}`),
    );
    return String(r!.outcome);
  }

  async function row(tx: Exec, id: string): Promise<Row> {
    const [r] = rowsOf(
      await tx.execute(sql`select *, status_changed_at = now() as status_stamped_now, cleared_at = now() as cleared_now
                             from help_contact_messages where id = ${id}`),
    );
    return r!;
  }

  // -------------------------------------------------------------------------
  describe("the live catalog (CA1)", () => {
    it("FORCE ROW LEVEL SECURITY is on, with zero policies", async () => {
      const [c] = await q(sql`select relrowsecurity, relforcerowsecurity from pg_class
                               where oid = 'help_contact_messages'::regclass`);
      expect(c).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const [p] = await q(sql`select count(*)::int as n from pg_policies where tablename = 'help_contact_messages'`);
      expect(p!.n).toBe(0);
    });

    it("no role but the owner holds any table privilege (no presby_app, presby_platform or PUBLIC)", async () => {
      const acl = await q(sql`
        select a.grantee::regrole::text as grantee, a.privilege_type
          from pg_class c, aclexplode(c.relacl) a
         where c.oid = 'help_contact_messages'::regclass and a.grantee <> c.relowner`);
      expect(acl).toEqual([]);
      const verbs = await q(sql`
        select r, v from unnest(array['presby_app', 'presby_platform']) r,
                         unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v
         where has_table_privilege(r, 'help_contact_messages', v)`);
      expect(verbs).toEqual([]);
    });

    it("the two guards are enabled, SECURITY INVOKER, search_path pinned, executable by the owner alone", async () => {
      const guards = await q(sql`
        select t.tgname, t.tgenabled, p.prosecdef, p.proconfig,
               has_function_privilege('presby_app', p.oid, 'execute') as app_exec,
               has_function_privilege('public', p.oid, 'execute') as public_exec
          from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'help_contact_messages'::regclass and not t.tgisinternal
         order by t.tgname`);
      expect(guards).toEqual([
        { tgname: "help_contact_guard_delete", tgenabled: "O", prosecdef: false,
          proconfig: ["search_path=public, pg_temp"], app_exec: false, public_exec: false },
        { tgname: "help_contact_guard_update", tgenabled: "O", prosecdef: false,
          proconfig: ["search_path=public, pg_temp"], app_exec: false, public_exec: false },
      ]);
    });

    it("the definer is SECURITY DEFINER, search_path pinned, EXECUTE to presby_app and not PUBLIC or presby_platform", async () => {
      const [f] = await q(sql`
        select p.prosecdef, p.proconfig, pg_get_function_result(p.oid) as result,
               pg_get_userbyid(p.proowner) as owner,
               has_function_privilege('presby_app', p.oid, 'execute') as app_exec,
               has_function_privilege('public', p.oid, 'execute') as public_exec,
               has_function_privilege('presby_platform', p.oid, 'execute') as platform_exec,
               (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
                  from aclexplode(p.proacl) a) as grantees
          from pg_proc p where p.oid = ${SUBMIT}::regprocedure`);
      expect(f).toMatchObject({
        prosecdef: true,
        proconfig: ["search_path=public, pg_temp"],
        result: "text",
        app_exec: true,
        public_exec: false,
        platform_exec: false,
      });
      expect(f!.grantees).toEqual([String(f!.owner), "presby_app"].sort());
    });

    it("the definer's window and ceilings are the SQL constants the TypeScript names (and are in the migration text)", async () => {
      const [f] = await q(sql`select prosrc from pg_proc where oid = ${SUBMIT}::regprocedure`);
      const src = String(f!.prosrc);
      expect(src).toMatch(new RegExp(`c_window\\s+constant interval := interval '${HELP_CONTACT_NOTIFY_WINDOW_MINUTES} minutes'`));
      expect(src).toMatch(new RegExp(`c_ceil_hour constant integer\\s+:= ${HELP_CONTACT_DB_CEILING_PER_HOUR};`));
      expect(src).toMatch(new RegExp(`c_ceil_day\\s+constant integer\\s+:= ${HELP_CONTACT_DB_CEILING_PER_DAY};`));
      expect(MIGRATION).toContain(src.trim().slice(0, 200));
    });
  });

  // -------------------------------------------------------------------------
  describe("as presby_app (the real db login)", () => {
    it("SELECT, INSERT, UPDATE, DELETE and TRUNCATE are each 42501", async () => {
      const db = await app();
      await rolledBack(db, async (tx) => {
        for (const stmt of [
          sql`select count(*) from help_contact_messages`,
          sql`insert into help_contact_messages (topic, email, message)
              values ('something_else', ${`app-${stamp}@example.invalid`}, 'A direct insert probe.')`,
          sql`update help_contact_messages set status = 'spam'`,
          sql`delete from help_contact_messages`,
          sql`truncate help_contact_messages`,
        ]) {
          await expectRaise(tx, stmt, /permission denied for table help_contact_messages/, GUARD);
        }
      });
    });

    it("EXECUTE on the definer works and answers a closed token, never an id", async () => {
      const db = await app();
      const outcome = await rolledBack(db, (tx) => submit(tx, `app-exec-${stamp}@example.invalid`));
      expect(["stored", "stored_notify"]).toContain(outcome);
    });

    it("the kill switch: after `revoke execute ... from presby_app` the call is 42501, and the grant restores it", async () => {
      const db = await app();
      try {
        await q(sql.raw(`revoke execute on function ${SUBMIT} from presby_app`));
        const [h] = await q(sql`select has_function_privilege('presby_app', ${SUBMIT}::regprocedure, 'execute') as ok`);
        expect(h!.ok).toBe(false);
        await rolledBack(db, (tx) =>
          expectRaise(
            tx,
            sql`select presby_submit_help_contact('something_else', null, ${`revoked-${stamp}@example.invalid`}, null,
                                                  'A message sent while switched off.')`,
            /permission denied for function presby_submit_help_contact/,
            GUARD,
          ),
        );
      } finally {
        await q(sql.raw(`grant execute on function ${SUBMIT} to presby_app`));
      }
      const [h] = await q(sql`select has_function_privilege('presby_app', ${SUBMIT}::regprocedure, 'execute') as ok`);
      expect(h!.ok).toBe(true);
      const outcome = await rolledBack(db, (tx) => submit(tx, `restored-${stamp}@example.invalid`));
      expect(["stored", "stored_notify"]).toContain(outcome);
    });
  });

  // -------------------------------------------------------------------------
  describe("the guards on the OWNER path (F44)", () => {
    it("the delete guard refuses the owner", async () => {
      await rolledBack(await platform(), async (tx) => {
        const id = await message(tx);
        await expectRaise(tx, sql`delete from help_contact_messages where id = ${id}`, /messages are permanent/, GUARD);
      });
    });

    it("no personal field can be rewritten, or nulled, outside a clear", async () => {
      await rolledBack(await platform(), async (tx) => {
        const id = await message(tx);
        for (const stmt of [
          sql`update help_contact_messages set name = 'Someone Else' where id = ${id}`,
          sql`update help_contact_messages set email = 'other@example.invalid' where id = ${id}`,
          sql`update help_contact_messages set congregation = 'Another Congregation' where id = ${id}`,
          sql`update help_contact_messages set message = 'Words the sender never wrote.' where id = ${id}`,
          sql`update help_contact_messages set name = null where id = ${id}`,
          sql`update help_contact_messages set congregation = null where id = ${id}`,
        ]) {
          await expectRaise(tx, stmt, /cannot be rewritten; they can only be cleared/, GUARD);
        }
        const r = await row(tx, id);
        expect(r).toMatchObject({ name: "Fixture Sender", congregation: "Fixture Congregation" });
      });
    });

    it("id, created_at, topic and notified_at never change", async () => {
      await rolledBack(await platform(), async (tx) => {
        const id = await message(tx);
        for (const stmt of [
          sql`update help_contact_messages set id = gen_random_uuid() where id = ${id}`,
          sql`update help_contact_messages set created_at = now() - interval '1 day' where id = ${id}`,
          sql`update help_contact_messages set topic = 'something_else' where id = ${id}`,
          sql`update help_contact_messages set notified_at = now() where id = ${id}`,
        ]) {
          await expectRaise(tx, stmt, /id, created_at, topic and notified_at never change/, GUARD);
        }
      });
    });

    it("a status change needs its operator, and the guard stamps the time itself", async () => {
      await rolledBack(await platform(), async (tx) => {
        const id = await message(tx);
        const op = await operator(tx, "status");
        await expectRaise(
          tx,
          sql`update help_contact_messages set status = 'handled' where id = ${id}`,
          /a status change names the operator/,
          GUARD,
        );
        await tx.execute(sql`update help_contact_messages
                                set status = 'handled', status_changed_by = ${op},
                                    status_changed_at = timestamptz '2000-01-01 00:00:00+00'
                              where id = ${id}`);
        const r = await row(tx, id);
        expect(r.status).toBe("handled");
        expect(r.status_changed_by).toBe(op);
        expect(r.status_stamped_now, "the guard overwrote the caller's 2000-01-01 with now()").toBe(true);
        // With the status unchanged, neither stamp moves.
        await expectRaise(
          tx,
          sql`update help_contact_messages set status_changed_at = now() - interval '1 hour' where id = ${id}`,
          /the status stamps move only with a status change/,
          GUARD,
        );
        await expectRaise(
          tx,
          sql`update help_contact_messages set status_changed_by = null, status_changed_at = null where id = ${id}`,
          /the status stamps move only with a status change/,
          GUARD,
        );
        // Moving back to new is allowed while uncleared.
        await tx.execute(sql`update help_contact_messages set status = 'new', status_changed_by = ${op} where id = ${id}`);
        expect((await row(tx, id)).status).toBe("new");
      });
    });

    it("clearing is refused while new, unnamed, or partial", async () => {
      await rolledBack(await platform(), async (tx) => {
        const id = await message(tx);
        const op = await operator(tx, "clear-refused");
        await expectRaise(
          tx,
          sql`update help_contact_messages
                 set cleared_by = ${op}, name = null, email = null, congregation = null, message = null
               where id = ${id}`,
          /mark a message handled or spam before clearing/,
          GUARD,
        );
        await tx.execute(sql`update help_contact_messages set status = 'spam', status_changed_by = ${op} where id = ${id}`);
        await expectRaise(
          tx,
          sql`update help_contact_messages
                 set cleared_at = now(), name = null, email = null, congregation = null, message = null
               where id = ${id}`,
          /names the operator who cleared it/,
          GUARD,
        );
        await expectRaise(
          tx,
          sql`update help_contact_messages set cleared_by = ${op}, name = null, email = null where id = ${id}`,
          /sets name, email, congregation and message to null/,
          GUARD,
        );
        const r = await row(tx, id);
        expect(r.cleared_at).toBeNull();
        expect(r.message).not.toBeNull();
      });
    });

    it("a clear blanks all four fields, stamps cleared_at itself, and is irreversible", async () => {
      await rolledBack(await platform(), async (tx) => {
        const id = await message(tx);
        const op = await operator(tx, "clear");
        const other = await operator(tx, "clear-other");
        // A status change and a clear in one statement: the (new) status is not `new`.
        await tx.execute(sql`update help_contact_messages
                                set status = 'handled', status_changed_by = ${op},
                                    cleared_by = ${op}, cleared_at = timestamptz '2000-01-01 00:00:00+00',
                                    name = null, email = null, congregation = null, message = null
                              where id = ${id}`);
        const r = await row(tx, id);
        expect(r).toMatchObject({ name: null, email: null, congregation: null, message: null, cleared_by: op, status: "handled" });
        expect(r.cleared_now, "the guard overwrote the caller's 2000-01-01 with now()").toBe(true);

        // No un-clear, no re-stamp, no restored words, no return to new.
        await expectRaise(tx, sql`update help_contact_messages set cleared_at = null, cleared_by = null where id = ${id}`,
          /a cleared message stays cleared/, GUARD);
        await expectRaise(tx, sql`update help_contact_messages set cleared_by = ${other} where id = ${id}`,
          /a cleared message stays cleared/, GUARD);
        await expectRaise(tx, sql`update help_contact_messages set cleared_at = now() - interval '1 day' where id = ${id}`,
          /a cleared message stays cleared/, GUARD);
        await expectRaise(tx, sql`update help_contact_messages set message = 'Restored words.' where id = ${id}`,
          /cannot be rewritten; they can only be cleared/, GUARD);
        await expectRaise(tx, sql`update help_contact_messages set status = 'new', status_changed_by = ${op} where id = ${id}`,
          /a cleared message cannot return to new/, GUARD);
        // A cleared row may still move between handled and spam.
        await tx.execute(sql`update help_contact_messages set status = 'spam', status_changed_by = ${other} where id = ${id}`);
        expect((await row(tx, id)).status).toBe("spam");
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("the CHECKs (owner path; each refusal is 23514 naming its constraint)", () => {
    async function insertRefused(fields: Record<string, unknown>, constraint: string) {
      const base = {
        topic: "something_else",
        name: null,
        email: `check-${stamp}@example.invalid`,
        congregation: null,
        message: "A message long enough to pass.",
        ...fields,
      } as Record<string, unknown>;
      await rolledBack(await platform(), (tx) =>
        expectRaise(
          tx,
          sql`insert into help_contact_messages (topic, name, email, congregation, message, status,
                                                 cleared_at, cleared_by, status_changed_at, status_changed_by)
              values (${base.topic}, ${base.name}, ${base.email}, ${base.congregation}, ${base.message},
                      ${(base.status as string) ?? "new"}, ${base.cleared_at ?? null}, ${base.cleared_by ?? null},
                      ${base.status_changed_at ?? null}, ${base.status_changed_by ?? null})`,
          new RegExp(constraint),
          CHECK,
        ),
      );
    }

    async function insertAccepted(fields: Record<string, unknown>) {
      await rolledBack(await platform(), async (tx) => {
        await tx.execute(sql`insert into help_contact_messages (topic, name, email, congregation, message)
                             values ('something_else', ${fields.name ?? null},
                                     ${(fields.email as string) ?? `ok-${stamp}@example.invalid`},
                                     ${fields.congregation ?? null},
                                     ${(fields.message as string) ?? "A message long enough to pass."})`);
      });
    }

    it("topic and status are closed lists", async () => {
      await insertRefused({ topic: "billing" }, "help_contact_topic_allowed");
      await insertRefused({ status: "archived" }, "help_contact_status_allowed");
    });

    it("lengths are bounded in characters, and a message must have ten non-blank characters", async () => {
      await insertRefused({ name: "n".repeat(101) }, "help_contact_bounds");
      await insertRefused({ congregation: "c".repeat(151) }, "help_contact_bounds");
      await insertRefused({ email: `${"e".repeat(243)}@example.org` }, "help_contact_bounds"); // 255 characters
      await insertRefused({ message: "123456789" }, "help_contact_bounds");
      await insertRefused({ message: "\n\n\n\n\n\n\n\n\n\n\n\n" }, "help_contact_bounds");
      await insertRefused({ message: "          " }, "help_contact_bounds");
      await insertRefused({ message: "m".repeat(2001) }, "help_contact_bounds");
      // Code points, not bytes or UTF-16 units: 2,000 emoji fit, and so do the exact maxima.
      await insertAccepted({ message: "\u{1F54A}".repeat(2000) });
      await insertAccepted({ name: "n".repeat(100), congregation: "c".repeat(150), message: "m".repeat(2000) });
      await insertAccepted({ email: `${"e".repeat(242)}@example.org` }); // 254 characters
    });

    it("email is shape-only: one @, a dotted domain with a character either side of the dot, no whitespace", async () => {
      for (const email of ["no-at.example.invalid", "a@b", "a@@b.invalid", "a@b@c.invalid", "x@b.", "x@.invalid",
                           "@example.invalid", "a b@example.invalid", "a@example.invalid\n"]) {
        await insertRefused({ email }, "help_contact_email_shape");
      }
      await insertAccepted({ email: "A.Sender+tag@Example.Invalid" });
    });

    it("no C0 control but tab, LF and CR, and no DEL, in any free-text field", async () => {
      await insertRefused({ name: `Bad${String.fromCharCode(1)}Name` }, "help_contact_no_controls");
      await insertRefused({ congregation: `Bad${String.fromCharCode(0x7f)}` }, "help_contact_no_controls");
      await insertRefused({ message: `A long enough message${String.fromCharCode(0x0b)} here.` }, "help_contact_no_controls");
      await insertRefused({ message: `A long enough message${String.fromCharCode(0x1f)} here.` }, "help_contact_no_controls");
      await insertAccepted({ message: "A message with a\ttab,\na newline\r\nand a CR." });
    });

    it("an uncleared message has an email and a message; a cleared one has neither, and both stamps travel in pairs", async () => {
      await insertRefused({ email: null }, "help_contact_cleared_shape");
      await insertRefused({ message: null }, "help_contact_cleared_shape");
      await insertRefused({ status: "handled", cleared_at: new Date().toISOString(),
                            name: null, email: null, congregation: null, message: null },
                          "help_contact_cleared_shape");
      await insertRefused({ status_changed_at: new Date().toISOString() }, "help_contact_status_stamp_shape");
    });
  });

  // -------------------------------------------------------------------------
  describe("presby_submit_help_contact (owner path, quiet table)", () => {
    it("the first message in a window claims the notification, the second does not, and the row is exactly what was typed", async () => {
      await rolledBack(await platform(), async (tx) => {
        await quiet(tx);
        expect(await submit(tx, `first-${stamp}@example.invalid`, "The first message in the window.")).toBe("stored_notify");
        expect(await submit(tx, `second-${stamp}@example.invalid`)).toBe("stored");
        const rows = rowsOf(await tx.execute(sql`
          select topic, name, email, congregation, message, status, status_changed_at, status_changed_by,
                 cleared_at, cleared_by, notified_at is not null as notified, created_at = now() as created_now
            from help_contact_messages order by notified_at nulls last`));
        expect(rows).toEqual([
          { topic: "something_else", name: "Test Sender", email: `first-${stamp}@example.invalid`,
            congregation: "Test Congregation", message: "The first message in the window.", status: "new",
            status_changed_at: null, status_changed_by: null, cleared_at: null, cleared_by: null,
            notified: true, created_now: true },
          { topic: "something_else", name: "Test Sender", email: `second-${stamp}@example.invalid`,
            congregation: "Test Congregation", message: "A message from the database test.", status: "new",
            status_changed_at: null, status_changed_by: null, cleared_at: null, cleared_by: null,
            notified: false, created_now: true },
        ]);
      });
    });

    it("a claim 61 minutes old lets the next message claim; a claim 59 minutes old does not", async () => {
      await rolledBack(await platform(), async (tx) => {
        await quiet(tx);
        await tx.execute(sql`insert into help_contact_messages (topic, email, message, created_at, notified_at)
                             values ('something_else', ${`aged-${stamp}@example.invalid`}, 'An older claimed message.',
                                     now() - interval '61 minutes', now() - interval '61 minutes')`);
        expect(await submit(tx, `after-aged-${stamp}@example.invalid`)).toBe("stored_notify");
      });
      await rolledBack(await platform(), async (tx) => {
        await quiet(tx);
        await tx.execute(sql`insert into help_contact_messages (topic, email, message, created_at, notified_at)
                             values ('something_else', ${`young-${stamp}@example.invalid`}, 'A recent claimed message.',
                                     now() - interval '59 minutes', now() - interval '59 minutes')`);
        expect(await submit(tx, `after-young-${stamp}@example.invalid`)).toBe("stored");
      });
    });

    it("the hourly ceiling: the 90th message in an hour is stored, the 91st is refused and writes nothing", async () => {
      await rolledBack(await platform(), async (tx) => {
        await quiet(tx);
        await tx.execute(sql`insert into help_contact_messages (topic, email, message, created_at)
                             select 'something_else', 'flood-' || g || ${`-${stamp}@example.invalid`},
                                    'A flood message number ' || g, now() - interval '30 minutes'
                               from generate_series(1, ${HELP_CONTACT_DB_CEILING_PER_HOUR - 1}) g`);
        expect(await submit(tx, `ninetieth-${stamp}@example.invalid`)).toBe("stored_notify");
        expect(await submit(tx, `ninety-first-${stamp}@example.invalid`)).toBe("ceiling");
        const [c] = rowsOf(await tx.execute(sql`select count(*)::int as n from help_contact_messages`));
        expect(c!.n).toBe(HELP_CONTACT_DB_CEILING_PER_HOUR);
        // Messages older than an hour do not count against the hourly ceiling.
        await quiet(tx);
        await tx.execute(sql`insert into help_contact_messages (topic, email, message, created_at)
                             select 'something_else', 'old-' || g || ${`-${stamp}@example.invalid`},
                                    'An older message number ' || g, now() - interval '61 minutes'
                               from generate_series(1, ${HELP_CONTACT_DB_CEILING_PER_HOUR}) g`);
        expect(await submit(tx, `after-hour-${stamp}@example.invalid`)).toBe("stored_notify");
      });
    });

    it("the daily ceiling: 300 messages in 24 hours refuse the next; messages older than 24 hours do not count", async () => {
      await rolledBack(await platform(), async (tx) => {
        await quiet(tx);
        await tx.execute(sql`insert into help_contact_messages (topic, email, message, created_at)
                             select 'something_else', 'day-' || g || ${`-${stamp}@example.invalid`},
                                    'A message earlier today number ' || g, now() - interval '2 hours' - (g || ' seconds')::interval
                               from generate_series(1, ${HELP_CONTACT_DB_CEILING_PER_DAY}) g`);
        expect(await submit(tx, `day-over-${stamp}@example.invalid`)).toBe("ceiling");
        const [c] = rowsOf(await tx.execute(sql`select count(*)::int as n from help_contact_messages`));
        expect(c!.n).toBe(HELP_CONTACT_DB_CEILING_PER_DAY);
        await quiet(tx);
        await tx.execute(sql`insert into help_contact_messages (topic, email, message, created_at)
                             select 'something_else', 'yesterday-' || g || ${`-${stamp}@example.invalid`},
                                    'A message from yesterday number ' || g, now() - interval '25 hours'
                               from generate_series(1, ${HELP_CONTACT_DB_CEILING_PER_DAY}) g`);
        expect(await submit(tx, `day-fresh-${stamp}@example.invalid`)).toBe("stored_notify");
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("presby_submit_help_contact under concurrency (two connections)", () => {
    it("a second caller waits on the advisory lock while the first transaction is open", async () => {
      const conn = await platform();
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const isHeld = new Promise<void>((resolve) => (held = resolve));
      const marker = `lock-probe-${stamp}`;

      const first = rolledBack(conn, async (tx) => {
        await submit(tx, `${marker}-1@example.invalid`, "The first caller, holding the lock.", `${marker}-1`);
        held();
        await released;
      });
      let second: Promise<string> | null = null;
      let secondDone = false;
      let waiting = 0;
      try {
        await isHeld;
        second = rolledBack(conn, async (tx) => {
          const outcome = await submit(tx, `${marker}-2@example.invalid`, "The second caller, waiting.", `${marker}-2`);
          secondDone = true;
          return outcome;
        });
        for (let i = 0; i < 50 && waiting === 0; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const [w] = await q(sql`
            select count(*)::int as n from pg_stat_activity
             where datname = current_database() and pid <> pg_backend_pid()
               and wait_event_type = 'Lock' and wait_event = 'advisory'
               and query like ${`%/* ${marker}-2 */%`}`);
          waiting = Number(w!.n);
        }
        expect(waiting, "the second caller is blocked on the advisory lock").toBe(1);
        expect(secondDone).toBe(false);
      } finally {
        release();
        await first;
      }
      expect(["stored", "stored_notify", "ceiling"]).toContain(await second);
    });

    it("two concurrent committed submissions in a quiet window: exactly one claims the notification (state-aware)", async () => {
      const conn = await platform();
      const marker = `db-race-${stamp}`;
      const [pre] = await q(sql`
        select exists (select 1 from help_contact_messages
                        where notified_at > now() - interval '59 minutes') as young,
               not exists (select 1 from help_contact_messages
                            where notified_at > now() - interval '60 minutes') as quiet,
               (select count(*)::int from help_contact_messages where created_at > now() - interval '1 hour') as hour,
               (select count(*)::int from help_contact_messages where created_at > now() - interval '24 hours') as day`);
      const nearCeiling =
        Number(pre!.hour) + 2 > HELP_CONTACT_DB_CEILING_PER_HOUR || Number(pre!.day) + 2 > HELP_CONTACT_DB_CEILING_PER_DAY;
      expect(nearCeiling, "the branch is within two messages of the database ceiling; the race cannot be read").toBe(false);

      // Each transaction holds the lock for 750 ms after its call, so the two
      // overlap: without the lock both would read the quiet window before
      // either committed (the failing-first run shows two claims).
      const outcomes = await Promise.all(
        [1, 2].map((i) =>
          conn.transaction(async (tx) => {
            const outcome = await submit(tx, `race-${i}-${stamp}@example.invalid`, `${marker} concurrent submission ${i}.`);
            await tx.execute(sql`select pg_sleep(0.75)`);
            return outcome;
          }),
        ),
      );
      const claims = outcomes.filter((o) => o === "stored_notify").length;
      expect(outcomes.every((o) => o === "stored" || o === "stored_notify")).toBe(true);
      expect(claims).toBeLessThanOrEqual(1);
      if (pre!.quiet) expect(claims, "a quiet window: exactly one claim").toBe(1);
      if (pre!.young) expect(claims, "the window was already claimed: no claim").toBe(0);

      const [after] = await q(sql`
        select count(*)::int as n, count(notified_at)::int as notified
          from help_contact_messages where message like ${`${marker} %`}`);
      expect(after).toEqual({ n: 2, notified: claims });
    });
  });
});
