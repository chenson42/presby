/**
 * settlements.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 6): the payouts list is giving.view only,
 * tenant-scoped, read-only, and tells an automatic payout (with its contents), a
 * manual payout (reconciliation unavailable), a failed payout and a payout whose
 * lines have not arrived apart. The ROWS are written the way the ingest path
 * writes them elsewhere (`ingest/process.db.test.ts`); here they are inserted on
 * the owner connection so the reader is tested on its own. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/settlements.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";
import { reconciliationOf } from "./settlement-display";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Actor = { personId: string; userId: string };
let counter = 0;
const po = () => `po_settle${Date.now().toString(36)}${(counter += 1)}x`;

describe.skipIf(!hasDb)("settlements.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let settlements: typeof import("./settlements");
  let org: string;
  let orgB: string;
  let conn: string;
  let connB: string;
  let fund: string;
  let viewer: Actor;
  let recorder: Actor;
  let manager: Actor;
  let plain: Actor;
  let viewerB: Actor;

  async function q(query: ReturnType<typeof sql>) {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  async function payout(
    organizationId: string,
    connectionId: string,
    over: { arrival?: string | null; status?: "paid" | "failed"; automatic?: boolean; gross: number; livemode?: boolean; loaded?: boolean } = { gross: 0 },
  ): Promise<{ id: string; po: string }> {
    const external = po();
    const [row] = await q(sql`
      insert into giving_settlements (organization_id, connection_id, external_settlement_id, arrival_date, status, automatic,
             gross_cents, livemode, lines_loaded_at)
      values (${organizationId}, ${connectionId}, ${external}, ${over.arrival === undefined ? "2027-02-01" : over.arrival},
              ${over.status ?? "paid"}, ${over.automatic ?? true}, ${over.gross}, ${over.livemode ?? true},
              ${over.loaded ? sql`now()` : sql`null`})
      returning id::text as id`);
    return { id: String(row!.id), po: external };
  }

  async function line(
    organizationId: string,
    settlementId: string,
    p: { kind: "charge" | "refund" | "dispute" | "fee" | "adjustment" | "other"; gross: number; fee?: number; giftId?: string | null; pi?: string | null },
  ) {
    const fee = p.fee ?? 0;
    await q(sql`
      insert into giving_settlement_lines (organization_id, settlement_id, gift_id, external_balance_transaction_id, payment_intent_id,
             kind, gross_cents, fee_cents, net_cents)
      values (${organizationId}, ${settlementId}, ${p.giftId ?? null}, ${`txn_${Date.now().toString(36)}${(counter += 1)}`}, ${p.pi ?? null},
              ${p.kind}, ${p.gross}, ${fee}, ${p.gross - fee})`);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("giving-settle-test");
    settlements = await import("./settlements");
    org = await fx.makeOrg("a", { givingToggle: true });
    orgB = await fx.makeOrg("b", { givingToggle: true });
    conn = await fx.makeConnection(org, { livemode: true });
    connB = await fx.makeConnection(orgB, { livemode: true });
    fund = await fx.makeFund(org, "General Fund");
    viewer = await fx.makeActor(org, "Vera", "Viewer", ["giving.view"]);
    recorder = await fx.makeActor(org, "Rex", "Recorder", ["giving.record"]);
    manager = await fx.makeActor(org, "Max", "Manager", ["giving.manage"]);
    plain = await fx.makeActor(org, "Nora", "Nobody", []);
    viewerB = await fx.makeActor(orgB, "Veronica", "Viewer", ["giving.view"]);
  }, 120_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("is giving.view only: a recorder, a manage-only holder and a plain member are refused, with no row read", async () => {
    await payout(org, conn, { gross: 100 });
    for (const actor of [recorder, manager, plain]) {
      expect(await settlements.listSettlements(actor.personId, org)).toEqual({ kind: "forbidden" });
    }
    expect((await settlements.listSettlements(viewer.personId, org)).kind).toBe("ok");
  });

  it("an AUTOMATIC payout reports its contents: charges, returns, fees, net, and the charges that match no recorded gift", async () => {
    const donor = await fx.makeDonor(org, "Pia Payoutdonor");
    const gift = await fx.makeOnlineGift(org, conn, donor, fund, 5000, { occurredOn: "2027-01-28" });
    const p = await payout(org, conn, { gross: 5000 + 3000 - 1000 - 175 - 117, loaded: true, arrival: "2027-02-03" });
    await line(org, p.id, { kind: "charge", gross: 5000, fee: 175, giftId: gift, pi: "pi_matchedgift0001" });
    await line(org, p.id, { kind: "charge", gross: 3000, fee: 117, pi: "pi_notourgift00001" });
    await line(org, p.id, { kind: "refund", gross: -1000 });

    const result = await settlements.listSettlements(viewer.personId, org);
    if (result.kind !== "ok") throw new Error("expected ok");
    const row = result.settlements.find((s) => s.id === p.id)!;
    expect(row).toMatchObject({
      payoutId: p.po,
      arrivalDate: "2027-02-03",
      status: "paid",
      automatic: true,
      testMode: false,
      amountCents: 6708,
      linesLoaded: true,
      lineCount: 3,
      chargeCount: 2,
      chargeGrossCents: 8000,
      returnCount: 1,
      returnGrossCents: -1000,
      feeCents: 292,
      netCents: 6708,
      unmatchedCharges: 1,
    });
    expect(reconciliationOf(row)).toBe("balanced");
    expect(row.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("lines that do not add up to the payout are a MISMATCH, not a quiet pass", async () => {
    const p = await payout(org, conn, { gross: 9999, loaded: true });
    await line(org, p.id, { kind: "charge", gross: 5000, fee: 100 });
    const result = await settlements.listSettlements(viewer.personId, org);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(reconciliationOf(result.settlements.find((s) => s.id === p.id)!)).toBe("mismatch");
  });

  it("a MANUAL payout has no contents and says so: automatic = false, never 'loaded', zero lines - 'reconciliation unavailable'", async () => {
    const p = await payout(org, conn, { gross: 40000, automatic: false });
    const result = await settlements.listSettlements(viewer.personId, org);
    if (result.kind !== "ok") throw new Error("expected ok");
    const row = result.settlements.find((s) => s.id === p.id)!;
    expect(row).toMatchObject({ automatic: false, linesLoaded: false, lineCount: 0, amountCents: 40000 });
    expect(reconciliationOf(row)).toBe("manual");
  });

  it("a payout whose lines have not arrived is 'waiting', and a failed payout is 'failed'", async () => {
    const waiting = await payout(org, conn, { gross: 1000, loaded: false });
    const failed = await payout(org, conn, { gross: 2000, status: "failed" });
    const result = await settlements.listSettlements(viewer.personId, org);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(reconciliationOf(result.settlements.find((s) => s.id === waiting.id)!)).toBe("waiting");
    expect(reconciliationOf(result.settlements.find((s) => s.id === failed.id)!)).toBe("failed");
  });

  it("a Stripe test-mode payout is flagged as a test", async () => {
    const p = await payout(org, conn, { gross: 700, livemode: false });
    const result = await settlements.listSettlements(viewer.personId, org);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.settlements.find((s) => s.id === p.id)!.testMode).toBe(true);
  });

  it("lists newest arrival first, with an undated payout last", async () => {
    const o = await fx.makeOrg("order", { givingToggle: true });
    const c = await fx.makeConnection(o, { livemode: true });
    const v = await fx.makeActor(o, "Olive", "Viewer", ["giving.view"]);
    const older = await payout(o, c, { gross: 1, arrival: "2026-12-01" });
    const undated = await payout(o, c, { gross: 2, arrival: null });
    const newer = await payout(o, c, { gross: 3, arrival: "2027-03-01" });
    const result = await settlements.listSettlements(v.personId, o);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.settlements.map((s) => s.id)).toEqual([newer.id, older.id, undated.id]);
  });

  it("another organization's payouts are never returned", async () => {
    const mine = await payout(org, conn, { gross: 11 });
    const theirs = await payout(orgB, connB, { gross: 22 });
    const a = await settlements.listSettlements(viewer.personId, org);
    const b = await settlements.listSettlements(viewerB.personId, orgB);
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("expected ok");
    expect(a.settlements.map((s) => s.id)).toContain(mine.id);
    expect(a.settlements.map((s) => s.id)).not.toContain(theirs.id);
    expect(b.settlements.map((s) => s.id)).toEqual([theirs.id]);
  });

  it("is read-only for the tenant connection: the application role cannot insert or update a payout", async () => {
    const { db } = await import("@/lib/db");
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        await tx.execute(sql`update giving_settlements set gross_cents = 1 where organization_id = ${org}`);
      }),
    ).rejects.toThrow();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        await tx.execute(sql`
          insert into giving_settlements (organization_id, connection_id, external_settlement_id, status, gross_cents, livemode)
          values (${org}, ${conn}, 'po_forgedfromtenant01', 'paid', 1, true)`);
      }),
    ).rejects.toThrow();
  });

  it("caps the list and says so", async () => {
    const o = await fx.makeOrg("many", { givingToggle: true });
    const c = await fx.makeConnection(o, { livemode: true });
    const v = await fx.makeActor(o, "Mabel", "Viewer", ["giving.view"]);
    await q(sql`
      insert into giving_settlements (organization_id, connection_id, external_settlement_id, arrival_date, status, automatic, gross_cents, livemode)
      select ${o}, ${c}, 'po_many' || lpad(n::text, 8, '0'), date '2025-01-01' + n, 'paid', true, n, true
        from generate_series(1, 105) n`);
    const result = await settlements.listSettlements(v.personId, o);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.settlements).toHaveLength(100);
    expect(result.truncated).toBe(true);
  }, 60_000);
});

describe("reconciliationOf", () => {
  const base = { status: "paid" as const, automatic: true, linesLoaded: true, netCents: 1000, amountCents: 1000 };
  it("is decided by status, then automatic, then whether the lines are here, then whether they add up", () => {
    expect(reconciliationOf({ ...base, status: "failed", automatic: false })).toBe("failed");
    expect(reconciliationOf({ ...base, automatic: false })).toBe("manual");
    expect(reconciliationOf({ ...base, linesLoaded: false })).toBe("waiting");
    expect(reconciliationOf(base)).toBe("balanced");
    expect(reconciliationOf({ ...base, netCents: 999 })).toBe("mismatch");
  });
});
