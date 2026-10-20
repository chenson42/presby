/**
 * DB-backed grid: the TS `grossUp()` equals SQL `presby_giving_gross_up()`
 * for every amount x method x rate set (docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Pure helpers" — "A DB-backed grid test ... asserts grossUp ==
 * presby_giving_gross_up"). The browser shows `grossUp()` as a preview; the
 * charged total is the database's, so the two must never disagree by a cent.
 *
 * One statement per rate set (the whole grid goes in as parallel arrays), so
 * this is ~200 round trips of 18 cases, not 3,600. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/money.db.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);

const AMOUNTS = [100, 101, 999, 1000, 2500, 9999, 10000, 123456, 2_500_000];

type Rates = { cardBps: number; cardFixedCents: number; achBps: number; achCapCents: number };

/** A small deterministic PRNG so a failure reproduces. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fuzzedRateSets(count: number): Rates[] {
  const rnd = mulberry32(0x5eed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const sets: Rates[] = [];
  for (let i = 0; i < count; i += 1) {
    // The schema's CHECK ranges: card_fee_bps 0..1000, ach_fee_bps 0..500,
    // card_fee_fixed_cents 0..100, ach_fee_cap_cents 0..2000.
    sets.push({
      cardBps: int(0, 1000),
      cardFixedCents: int(0, 100),
      achBps: int(0, 500),
      achCapCents: int(0, 2000),
    });
  }
  // The boundaries of every range, which fuzzing rarely lands on.
  sets.push({ cardBps: 0, cardFixedCents: 0, achBps: 0, achCapCents: 0 });
  sets.push({ cardBps: 1000, cardFixedCents: 100, achBps: 500, achCapCents: 2000 });
  return sets;
}

describe.skipIf(!hasDb)("grossUp() == presby_giving_gross_up() (Postgres-backed)", () => {
  it("agrees on every amount x method for the default rates and 200 fuzzed rate sets", async () => {
    const { getPlatformDb } = await import("@/lib/db");
    const { grossUp, DEFAULT_RATES } = await import("./money");
    const db = getPlatformDb();

    const rateSets: Rates[] = [DEFAULT_RATES, ...fuzzedRateSets(200)];
    let compared = 0;

    for (const rates of rateSets) {
      const cases = AMOUNTS.flatMap((amount) =>
        (["card", "bank"] as const).map((method) => ({ amount, method })),
      );
      const result = await db.execute(sql`
        select c.amount, c.method,
               presby_giving_gross_up(c.amount, c.method, ${rates.cardBps}, ${rates.cardFixedCents},
                                      ${rates.achBps}, ${rates.achCapCents}) as total
          from unnest(${sql.raw(`array[${cases.map((c) => c.amount).join(",")}]::integer[]`)},
                      ${sql.raw(`array[${cases.map((c) => `'${c.method}'`).join(",")}]::text[]`)})
               as c(amount, method)`);
      const rows = (result as unknown as { rows: Array<{ amount: number; method: string; total: number }> }).rows;
      expect(rows).toHaveLength(cases.length);
      for (const row of rows) {
        const ts = grossUp(Number(row.amount), row.method as "card" | "bank", rates);
        expect(ts.totalCents, `${row.method} ${row.amount} ${JSON.stringify(rates)}`).toBe(Number(row.total));
        compared += 1;
      }
    }
    expect(compared).toBe(rateSets.length * AMOUNTS.length * 2);
  }, 120_000);

  it("reproduces the exact values 46l pins: card $50.00 -> 5181, bank $100.00 -> 10081, bank $1000.00 -> 100500", async () => {
    const { getPlatformDb } = await import("@/lib/db");
    const db = getPlatformDb();
    const result = await db.execute(sql`
      select presby_giving_gross_up(5000, 'card', 290, 30, 80, 500) as a,
             presby_giving_gross_up(10000, 'bank', 290, 30, 80, 500) as b,
             presby_giving_gross_up(100000, 'bank', 290, 30, 80, 500) as c`);
    const row = (result as unknown as { rows: Array<Record<string, number>> }).rows[0]!;
    expect([Number(row.a), Number(row.b), Number(row.c)]).toEqual([5181, 10081, 100500]);
  });
});
