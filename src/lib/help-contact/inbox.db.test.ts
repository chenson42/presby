/**
 * inbox.ts against a REAL Postgres connection: the CA10 test, which replaces
 * `check:audit` for these writes (AF-7: `MUTATION_RE` cannot see a write that
 * lives in a library file).
 *
 *   - setMessageStatus and clearMessageDetails each write EXACTLY ONE
 *     audit_events row, with the right action key and resource id;
 *   - that row's metadata (and the whole row) contains NONE of the seeded name,
 *     email, congregation or message strings: audit_events is kept forever, and
 *     an audit row that copied them would defeat "Clear details" (AF-5);
 *   - a refused or no-op mutation writes no row;
 *   - the guard's stamps are in place (status_changed_by, cleared_by);
 *   - keyset paging on created_at drops nothing and repeats nothing, at
 *     microsecond precision.
 *
 * NOTHING DURABLE IS WRITTEN: every test runs inside a transaction on the owner
 * connection that rolls back, and `exec` hands inbox.ts that transaction, so the
 * audit rows roll back with the change. (Messages cannot be deleted; the guard
 * refuses it even for the owner, so nothing here may commit.)
 *
 * Run (serial, docs/testing.md):
 *   npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/help-contact/inbox.db.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
type Tx = { execute: (q: SQL) => Promise<unknown> };
type TxRunner = { transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> };

class Rollback extends Error {
  constructor() {
    super("rollback-on-purpose");
  }
}

function rowsOf(result: unknown): Row[] {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function rolledBack<T>(conn: TxRunner, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await conn.transaction(async (tx) => {
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    let rolled = false;
    for (let e = err as { cause?: unknown; message?: string } | undefined; e; e = e.cause as typeof e) {
      if (e instanceof Rollback || String(e.message).includes("rollback-on-purpose")) rolled = true;
    }
    if (!rolled) throw err;
  }
  return out as T;
}

describe.skipIf(!hasDb)("inbox.ts (Postgres-backed): the CA10 audit test", () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  // Distinctive strings: if any of these appears in an audit row, a personal field leaked.
  const SEED = {
    name: `Seed Name ${stamp}`,
    email: `seed-${stamp}@example.invalid`,
    congregation: `Seed Congregation ${stamp}`,
    message: `Seed message body ${stamp} with enough length.`,
  };

  const platform = async () => (await import("@/lib/db")).getPlatformDb() as unknown as TxRunner;
  const inbox = () => import("./inbox");

  async function operator(tx: Tx): Promise<{ userId: string; email: string }> {
    const email = `hc-inbox-operator-${stamp}@example.invalid`;
    const [r] = rowsOf(
      await tx.execute(sql`insert into users (email, name) values (${email}, 'Fixture Operator') returning id`),
    );
    return { userId: String(r!.id), email };
  }

  async function seed(tx: Tx, createdAt?: string): Promise<string> {
    const [r] = rowsOf(
      await tx.execute(sql`
        insert into help_contact_messages (topic, name, email, congregation, message, created_at)
        values ('signing_in', ${SEED.name}, ${SEED.email}, ${SEED.congregation}, ${SEED.message},
                coalesce(${createdAt ?? null}::timestamptz, now()))
        returning id`),
    );
    return String(r!.id);
  }

  async function auditRows(tx: Tx, id: string): Promise<Row[]> {
    return rowsOf(
      await tx.execute(sql`select action, resource_type, resource_id, actor_user_id, metadata::text as metadata_text,
                                  to_jsonb(audit_events)::text as whole
                             from audit_events where resource_id = ${id} order by created_at`),
    );
  }

  function expectNoPersonalField(row: Row) {
    for (const text of [String(row.metadata_text), String(row.whole)]) {
      for (const value of Object.values(SEED)) {
        expect(text, `audit row leaked ${value}`).not.toContain(value);
      }
    }
  }

  it("a status change writes exactly one audit row, with ids and statuses only", async () => {
    const { setMessageStatus } = await inbox();
    await rolledBack(await platform(), async (tx) => {
      const actor = await operator(tx);
      const id = await seed(tx);
      const exec = <T,>(fn: (t: never) => Promise<T>) => fn(tx as never);

      expect(await setMessageStatus(actor, id, "handled", exec)).toEqual({ ok: true });

      const rows = await auditRows(tx, id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "help_contact.status_changed",
        resource_type: "help_contact_message",
        resource_id: id,
        actor_user_id: actor.userId,
      });
      expect(JSON.parse(String(rows[0]!.metadata_text))).toEqual({ messageId: id, from: "new", to: "handled" });
      expectNoPersonalField(rows[0]!);

      const [m] = rowsOf(
        await tx.execute(sql`select status, status_changed_by, status_changed_at = now() as stamped
                               from help_contact_messages where id = ${id}`),
      );
      expect(m).toMatchObject({ status: "handled", status_changed_by: actor.userId, stamped: true });

      // A change to the status it already has writes nothing more.
      expect(await setMessageStatus(actor, id, "handled", exec)).toEqual({ ok: true });
      expect(await auditRows(tx, id)).toHaveLength(1);

      // Another real change is one more row, not more.
      expect(await setMessageStatus(actor, id, "spam", exec)).toEqual({ ok: true });
      const after = await auditRows(tx, id);
      expect(after).toHaveLength(2);
      expect(JSON.parse(String(after[1]!.metadata_text))).toEqual({ messageId: id, from: "handled", to: "spam" });
      after.forEach(expectNoPersonalField);
    });
  });

  it("clearing writes exactly one audit row, carries no personal field, and blanks the record", async () => {
    const { clearMessageDetails, setMessageStatus } = await inbox();
    await rolledBack(await platform(), async (tx) => {
      const actor = await operator(tx);
      const id = await seed(tx);
      const exec = <T,>(fn: (t: never) => Promise<T>) => fn(tx as never);

      // A new message cannot be cleared; nothing is written.
      expect(await clearMessageDetails(actor, id, exec)).toEqual({ ok: false, reason: "needs_triage" });
      expect(await auditRows(tx, id)).toHaveLength(0);

      await setMessageStatus(actor, id, "handled", exec);
      expect(await auditRows(tx, id)).toHaveLength(1);

      expect(await clearMessageDetails(actor, id, exec)).toEqual({ ok: true });
      const rows = await auditRows(tx, id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        action: "help_contact.details_cleared",
        resource_type: "help_contact_message",
        resource_id: id,
        actor_user_id: actor.userId,
      });
      expect(JSON.parse(String(rows[1]!.metadata_text))).toEqual({ messageId: id, status: "handled" });
      rows.forEach(expectNoPersonalField);

      const [m] = rowsOf(
        await tx.execute(sql`select name, email, congregation, message, status, topic, cleared_by,
                                    cleared_at = now() as stamped
                               from help_contact_messages where id = ${id}`),
      );
      expect(m).toEqual({
        name: null,
        email: null,
        congregation: null,
        message: null,
        status: "handled",
        topic: "signing_in",
        cleared_by: actor.userId,
        stamped: true,
      });

      // A second clear is refused and writes no row.
      expect(await clearMessageDetails(actor, id, exec)).toEqual({ ok: false, reason: "already_cleared" });
      expect(await auditRows(tx, id)).toHaveLength(2);

      // A cleared message cannot return to new; nothing is written. It may still move between handled and spam.
      expect(await setMessageStatus(actor, id, "new", exec)).toEqual({ ok: false, reason: "cleared_cannot_be_new" });
      expect(await auditRows(tx, id)).toHaveLength(2);
      expect(await setMessageStatus(actor, id, "spam", exec)).toEqual({ ok: true });
      expect(await auditRows(tx, id)).toHaveLength(3);
    });
  });

  it("a missing message is not_found and writes no row", async () => {
    const { clearMessageDetails, setMessageStatus } = await inbox();
    await rolledBack(await platform(), async (tx) => {
      const actor = await operator(tx);
      const exec = <T,>(fn: (t: never) => Promise<T>) => fn(tx as never);
      const missing = "00000000-0000-4083-8000-000000000001";
      expect(await setMessageStatus(actor, missing, "handled", exec)).toEqual({ ok: false, reason: "not_found" });
      expect(await clearMessageDetails(actor, missing, exec)).toEqual({ ok: false, reason: "not_found" });
      expect(await auditRows(tx, missing)).toHaveLength(0);
    });
  });

  it("readMessage joins the two operator names the stamps point at", async () => {
    const { readMessage, setMessageStatus, clearMessageDetails } = await inbox();
    await rolledBack(await platform(), async (tx) => {
      const actor = await operator(tx);
      const id = await seed(tx);
      const exec = <T,>(fn: (t: never) => Promise<T>) => fn(tx as never);

      const fresh = await readMessage(id, exec);
      expect(fresh).toMatchObject({ id, status: "new", cleared: false, statusChangedByName: null, ...SEED });
      expect(fresh!.statusChangedAt).toBeNull();

      await setMessageStatus(actor, id, "handled", exec);
      await clearMessageDetails(actor, id, exec);
      const done = await readMessage(id, exec);
      expect(done).toMatchObject({
        status: "handled",
        cleared: true,
        name: null,
        email: null,
        message: null,
        statusChangedByName: "Fixture Operator",
        clearedByName: "Fixture Operator",
      });
      expect(done!.statusChangedAt).toBeInstanceOf(Date);
      expect(done!.clearedAt).toBeInstanceOf(Date);
    });
  });

  it("keyset paging drops nothing and repeats nothing at microsecond precision", async () => {
    const { listMessages } = await inbox();
    await rolledBack(await platform(), async (tx) => {
      const exec = <T,>(fn: (t: never) => Promise<T>) => fn(tx as never);
      // Three rows a microsecond apart: a Date cursor (milliseconds) would skip the third.
      const a = await seed(tx, "2020-01-01T00:00:00.000100Z");
      const b = await seed(tx, "2020-01-01T00:00:00.000200Z");
      const c = await seed(tx, "2020-01-01T00:00:00.000300Z");
      const bound = "2020-01-01T00:00:01.000000Z";

      const first = await listMessages({ status: "new", before: bound, limit: 2 }, exec);
      expect(first.rows.map((r) => r.id)).toEqual([c, b]);
      expect(first.hasMore).toBe(true);
      expect(first.rows[0]!.cursor).toBe("2020-01-01T00:00:00.000300Z");

      const second = await listMessages({ status: "new", before: first.rows[1]!.cursor, limit: 2 }, exec);
      expect(second.rows.map((r) => r.id)).toEqual([a]);
      expect(second.hasMore).toBe(false);
    });
  });
});
