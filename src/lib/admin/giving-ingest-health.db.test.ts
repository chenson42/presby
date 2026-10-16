/**
 * The platform ingest-health reader against a REAL database: the owner-only
 * functions through `getPlatformDb()`. docs/work-log/2026-10-15-online-giving.md,
 * P3-6 / Batch 3a. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/admin/giving-ingest-health.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { IngestHarness } from "@/lib/testing/giving-ingest-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("giving ingest health (Postgres-backed)", () => {
  let h: IngestHarness;
  let health: typeof import("./giving-ingest-health");

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-ingest-fixture");
    h = await mod.createIngestHarness("ingest-health");
    health = await import("./giving-ingest-health");
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  async function send(accountId: string, count: number) {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const r = await h.functions.ingestEvent({
        account: accountId, eventId: `evt_fixture${h.unique()}`, livemode: false, eventType: "charge.succeeded",
        rawBody: '{"donor":"Fixture Donor","amount":5000}',
      });
      out.push(r.inboxId!);
    }
    return out;
  }

  it("summarizes per connection: counts by status, last received, oldest pending age, and nothing else", async () => {
    const o = await h.org("health-counts");
    const [applied, parked, dead, received] = await send(o.accountId, 4);
    for (const id of [applied!, parked!, dead!]) await h.functions.claimEvent(id);
    await h.functions.finishEvent(applied!, "applied", null);
    await h.functions.finishEvent(parked!, "parked", "no_gift");
    await h.functions.finishEvent(dead!, "dead", "over_reversal");
    void received;

    const rows = await health.listIngestHealth();
    const row = rows.find((r) => r.connectionId === o.connectionId)!;
    expect(row).toEqual({
      organizationId: o.organizationId,
      connectionId: o.connectionId,
      provider: "stripe",
      livemode: false,
      status: "active",
      receivedCount: 4,
      appliedCount: 1,
      parkedCount: 1,
      deadLetterCount: 1,
      lastReceivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      oldestPendingSeconds: expect.any(Number),
    });
    // counts and timestamps only: no amount, name, body or event id can appear in a row
    expect(JSON.stringify(row)).not.toMatch(/Fixture Donor|5000|evt_/);
    expect(Object.keys(row).sort()).toEqual(
      [
        "appliedCount", "connectionId", "deadLetterCount", "lastReceivedAt", "livemode", "oldestPendingSeconds",
        "organizationId", "parkedCount", "provider", "receivedCount", "status",
      ].sort(),
    );
  });

  it("a connection that never received anything is a zero row with null times", async () => {
    const o = await h.org("health-empty");
    const row = (await health.listIngestHealth()).find((r) => r.connectionId === o.connectionId)!;
    expect(row).toMatchObject({ receivedCount: 0, appliedCount: 0, parkedCount: 0, deadLetterCount: 0, lastReceivedAt: null, oldestPendingSeconds: null });
  });

  it("is cross-organization by nature (it is owner-only for exactly that reason)", async () => {
    const a = await h.org("health-x-a");
    const b = await h.org("health-x-b");
    const ids = new Set((await health.listIngestHealth()).map((r) => r.connectionId));
    expect(ids.has(a.connectionId)).toBe(true);
    expect(ids.has(b.connectionId)).toBe(true);
  });

  it("requeues a dead letter (attempts reset, due now) and refuses anything else", async () => {
    const o = await h.org("health-requeue");
    const [deadId, appliedId] = await send(o.accountId, 2);
    await h.functions.claimEvent(deadId!);
    await h.functions.finishEvent(deadId!, "dead", "over_reversal");
    await h.functions.claimEvent(appliedId!);
    await h.functions.finishEvent(appliedId!, "applied", null);

    expect(await health.requeueDeadLetter(appliedId!)).toBe("not_dead_letter");
    expect(await health.requeueDeadLetter("00000000-0000-4000-8000-00000000beef")).toBe("not_found");
    expect((await h.eventRow(deadId!)).status).toBe("dead_letter");

    expect(await health.requeueDeadLetter(deadId!)).toBe("requeued");
    expect(await h.eventRow(deadId!)).toMatchObject({ status: "received", attempts: 0, last_error: null, processed_at: null });
    expect(await health.requeueDeadLetter(deadId!)).toBe("not_dead_letter");
    expect(await h.functions.dueEvents(100)).toContain(deadId);
  });

  it("the replayed event is processed again by the same claim path", async () => {
    const o = await h.org("health-replay");
    const [id] = await send(o.accountId, 1);
    await h.functions.claimEvent(id!);
    await h.functions.finishEvent(id!, "dead", "exception");
    await health.requeueDeadLetter(id!);
    expect((await h.functions.claimEvent(id!))!.attempts).toBe(1);
    await h.owner(sql`select 1`);
  });
});
