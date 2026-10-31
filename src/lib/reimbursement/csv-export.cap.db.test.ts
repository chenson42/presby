/**
 * The CSV row cap - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 P3-16 and
 * DECISION-271: more than the cap is `too_many` (the route answers 413), the file
 * is NEVER truncated, and a refused export writes no audit row. The cap is 20,000
 * in `limits.ts`; building 20,001 requests is not a test, so this file lowers the
 * constant to 2 and proves the behaviour at the boundary (2 rows pass, 3 do not).
 * `csv-shape.test.ts` pins the real number. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/csv-export.cap.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });
vi.mock("./limits", async (importOriginal) => ({ ...(await importOriginal<typeof import("./limits")>()), CSV_MAX_ROWS: 2 }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { REIMBURSEMENT_EXPORTED: "tenant.reimbursement.exported" },
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/email/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/queue")>();
  return { ...actual, attemptQueuedSend: vi.fn(async () => ({ sentInline: true })) };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

describe.skipIf(!hasDb)("exportRequests at the row cap (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let exporter: typeof import("./csv-export");
  let requests: typeof import("./requests");
  let input: typeof import("./input");
  let reads: typeof import("./reads");
  let A: string;
  let group: string;
  let requester: RequestActor;
  let treasurer: RequestActor;
  let today: string;
  let seq = 0;

  const exportedCount = async () =>
    Number((await fx.q(sql`select count(*)::int as n from audit_events where action = 'tenant.reimbursement.exported' and (metadata ->> 'organizationId') = ${A}`))[0]!.n);

  async function fileOne() {
    seq += 1;
    const saved = await requests.saveRequest(requester, input.saveRequestSchema.parse({
      clientKey: `cap${Date.now().toString(36)}${seq}`.padEnd(10, "x"), kind: "reimburse", groupId: group, amountCents: 100 + seq,
      expenseDate: today, purpose: `Cap row ${seq}`, noReceiptClaimed: true,
    }));
    if (saved.kind !== "ok") throw new Error(JSON.stringify(saved));
    const sub = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    if (sub.kind !== "ok") throw new Error(JSON.stringify(sub));
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("csvcap");
    exporter = await import("./csv-export");
    requests = await import("./requests");
    input = await import("./input");
    reads = await import("./reads");
    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    group = await fx.makeGroup(A, "Cap Committee");
    const r = await fx.member(A, "Requester");
    const t = await fx.member(A, "Treasurer");
    requester = { userId: r.userId, email: null, personId: r.personId, organizationId: A };
    treasurer = { userId: t.userId, email: null, personId: t.personId, organizationId: A };
    await fx.grant(A, await fx.makeRole(A, "t_like", ALL_KEYS), t.personId);
    await fx.chargeable(A, group, t.userId);
    today = await reads.getOrgToday({ userId: r.userId, personId: r.personId, organizationId: A });
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("exactly the cap is a whole file; one more is too_many with NO rows and NO audit row (nothing left the database)", async () => {
    await fileOne();
    await fileOne();
    const before = await exportedCount();
    const atCap = await exporter.exportRequests(treasurer, {});
    expect(atCap.kind).toBe("ok");
    if (atCap.kind === "ok") expect(atCap.rows).toHaveLength(2);
    expect(await exportedCount()).toBe(before + 1);

    await fileOne();
    const over = await exporter.exportRequests(treasurer, {});
    expect(over).toEqual({ kind: "too_many" });
    expect(await exportedCount()).toBe(before + 1);

    // narrowing by status/date is how the treasurer gets under the cap
    const narrowed = await exporter.exportRequests(treasurer, { status: "approved" });
    expect(narrowed).toEqual({ kind: "ok", rows: [] });
  });
});
