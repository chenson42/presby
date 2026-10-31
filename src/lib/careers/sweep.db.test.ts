/**
 * The cron's careers step against a REAL Postgres - docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 T23. `presby_careers_sweep()` itself is proven by scripts/careers/test-rls-71.sql and
 * src/lib/db/domain/careers.db.test.ts; this file proves what `sweep.ts` adds: one audit row
 * per closed posting, in the same transaction, actor null, ids and `via` only - and that a
 * failed audit insert rolls the closes back.
 *
 * The sweep is CROSS-ORGANIZATION, so a committed run would also close every other due posting
 * on the branch (the dev seed's, for one). Everything here therefore runs inside a transaction
 * that is rolled back, through `sweepClosedPostings(tx)`; `runCareersSweep()` is only the
 * `getPlatformDb().transaction(...)` wrapper around the same function (sweep.test.ts).
 *
 * Run with (serial):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/careers/sweep.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { CAREERS_POSTING_CLOSED: "careers.posting.closed" },
}));
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
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}
class Rollback extends Error {}

describe.skipIf(!hasDb)("sweepClosedPostings (Postgres-backed, rolled back)", () => {
  let fx: CalendarFixture;
  let sweep: typeof import("./sweep");
  let org: string;
  let otherOrg: string;

  /** Runs `body` in a platform transaction that is ALWAYS rolled back. */
  async function rolledBack<T>(body: (tx: Parameters<typeof sweep.sweepClosedPostings>[0]) => Promise<T>): Promise<T> {
    let out!: T;
    try {
      await fx.platform.transaction(async (tx) => {
        out = await body(tx as unknown as Parameters<typeof sweep.sweepClosedPostings>[0]);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return out;
  }

  const q = (tx: { execute(query: SQL): Promise<unknown> }, query: SQL) => tx.execute(query).then(rowsOf);

  async function due(tx: { execute(query: SQL): Promise<unknown> }, orgId: string, slug: string, closingExpr: SQL) {
    await q(tx, sql`
      insert into job_postings (organization_id, slug, title, summary, location, description_md)
      values (${orgId}, ${slug}, ${`Title ${slug}`}, 's', 'l', 'd')`);
    await q(tx, sql`update job_postings set status = 'published' where organization_id = ${orgId} and slug = ${slug}`);
    await q(tx, sql`update job_postings set closing_date = ${closingExpr} where organization_id = ${orgId} and slug = ${slug}`);
  }

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("careersweep");
    sweep = await import("./sweep");
    org = await fx.makeOrg("a", { timeZone: "Pacific/Kiritimati" });
    otherOrg = await fx.makeOrg("b", { timeZone: "Pacific/Kiritimati" });
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("closes a posting past its closing date and writes ONE audit row: actor null, via closing_date, ids only", async () => {
    const seen = await rolledBack(async (tx) => {
      await due(tx, org, "past-due-1", sql`(presby_careers_org_today(${org}::uuid) - 3)`);
      await due(tx, org, "not-due", sql`(presby_careers_org_today(${org}::uuid) + 3)`);
      const closed = await sweep.sweepClosedPostings(tx);
      const [post] = await q(tx, sql`select id, status from job_postings where organization_id = ${org} and slug = 'past-due-1'`);
      const [notDue] = await q(tx, sql`select status from job_postings where organization_id = ${org} and slug = 'not-due'`);
      const audit = await q(tx, sql`
        select action, actor_user_id, actor_email, resource_type, resource_id, metadata
          from audit_events where metadata->>'postingId' = ${String(post!.id)}`);
      return { closed, post, notDue, audit };
    });
    expect(seen.closed).toBeGreaterThanOrEqual(1);
    expect(seen.post!.status).toBe("closed");
    expect(seen.notDue!.status).toBe("published");
    expect(seen.audit).toHaveLength(1);
    expect(seen.audit[0]).toMatchObject({
      action: "careers.posting.closed",
      actor_user_id: null,
      actor_email: null,
      resource_type: "job_posting",
      resource_id: String(seen.post!.id),
      metadata: { organizationId: org, postingId: String(seen.post!.id), via: "closing_date" },
    });
    expect(Object.keys(seen.audit[0]!.metadata as object).sort()).toEqual(["organizationId", "postingId", "via"]);
    expect(JSON.stringify(seen.audit[0])).not.toContain("past-due-1");
    expect(JSON.stringify(seen.audit[0])).not.toContain("Title");
  });

  it("one audit row per posting closed, across organizations; a second run closes and audits nothing more for them", async () => {
    const seen = await rolledBack(async (tx) => {
      await due(tx, org, "multi-a", sql`(presby_careers_org_today(${org}::uuid) - 1)`);
      await due(tx, otherOrg, "multi-b", sql`(presby_careers_org_today(${otherOrg}::uuid) - 5)`);
      const first = await sweep.sweepClosedPostings(tx);
      const ids = (await q(tx, sql`select id from job_postings where slug in ('multi-a', 'multi-b')`)).map((r) => String(r.id));
      const auditAfterFirst = await q(tx, sql`
        select metadata->>'postingId' as id from audit_events
         where action = 'careers.posting.closed' and metadata->>'postingId' = any(${sql.raw(`array['${ids.join("','")}']::text[]`)})`);
      await sweep.sweepClosedPostings(tx);
      const auditAfterSecond = await q(tx, sql`
        select metadata->>'postingId' as id from audit_events
         where action = 'careers.posting.closed' and metadata->>'postingId' = any(${sql.raw(`array['${ids.join("','")}']::text[]`)})`);
      return { first, ids, auditAfterFirst, auditAfterSecond };
    });
    expect(seen.first).toBeGreaterThanOrEqual(2);
    expect(seen.auditAfterFirst.map((r) => r.id).sort()).toEqual([...seen.ids].sort());
    expect(seen.auditAfterSecond).toHaveLength(2);
  });

  it("a failing audit insert rolls the closes back with it", async () => {
    // The due posting is COMMITTED first, so the assertion afterwards is about the sweep's
    // transaction rolling back and not about a fixture that vanished with it.
    await due(fx.platform, org, "audit-fails", sql`(presby_careers_org_today(${org}::uuid) - 2)`);
    let thrown: unknown = null;
    auditControl.fail = true;
    try {
      await fx.platform.transaction(async (tx) => {
        await sweep.sweepClosedPostings(tx as unknown as Parameters<typeof sweep.sweepClosedPostings>[0]);
      });
    } catch (err) {
      thrown = err;
    } finally {
      auditControl.fail = false;
    }
    expect(String((thrown as Error)?.message)).toMatch(/audit insert failed/);

    const [post] = rowsOf(
      await fx.platform.execute(sql`select id, status from job_postings where organization_id = ${org} and slug = 'audit-fails'`),
    );
    expect(post!.status).toBe("published"); // the close rolled back with the failed audit insert
    const audit = rowsOf(
      await fx.platform.execute(sql`select 1 from audit_events where metadata->>'postingId' = ${String(post!.id)}`),
    );
    expect(audit).toHaveLength(0);
  });
});
