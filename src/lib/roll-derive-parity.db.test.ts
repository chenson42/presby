/**
 * deriveRollFields() against the database's own age expression (Phase 3 Test
 * Plan 1.8): the TypeScript derivation that `createPerson()` and
 * `recordRollAction()` share must agree with the SQL the definer function uses,
 * `date_part('year', age(effective_date, date_of_birth))::int`, on every date a
 * roll action can carry. One query over a grid of birth dates (29 February,
 * month and year ends, century years) crossed with effective dates around each
 * birthday, so a one-day disagreement anywhere is a failing test.
 *
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/roll-derive-parity.db.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { deriveRollFields } from "./roll-action-kinds";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const BIRTH_DATES = [
  "2000-02-29",
  "1996-02-29",
  "1900-02-28",
  "2000-01-01",
  "1985-12-31",
  "1990-06-15",
  "2008-03-10",
  "1975-03-01",
  "2023-11-30",
];

function around(dob: string): string[] {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (const year of [y + 17, y + 18, y + 24, y + 25, y + 50]) {
    for (const delta of [-1, 0, 1]) {
      const date = new Date(Date.UTC(year, m - 1, d + delta));
      out.push(date.toISOString().slice(0, 10));
    }
  }
  return out.filter((date) => date >= dob);
}

describe.skipIf(!hasDb)("deriveRollFields parity with the SQL age expression", () => {
  it("agrees with date_part('year', age(...)) on every sampled pair", async () => {
    const { getPlatformDb } = await import("@/lib/db");
    const pairs: Array<[string, string]> = [];
    for (const dob of BIRTH_DATES) {
      for (const on of around(dob)) pairs.push([dob, on]);
    }
    expect(pairs.length).toBeGreaterThan(100);

    const values = sql.join(
      pairs.map(([dob, on]) => sql`(${dob}::date, ${on}::date)`),
      sql`, `,
    );
    const result = await getPlatformDb().execute(sql`
      select dob::text as dob, eff::text as eff,
             date_part('year', age(eff, dob))::int as age
        from (values ${values}) as t(dob, eff)
    `);
    const rows = (result as unknown as { rows: Array<{ dob: string; eff: string; age: number }> }).rows;
    expect(rows).toHaveLength(pairs.length);

    const disagreements = rows.filter(
      (row) => deriveRollFields("profession_of_faith", row.dob, row.eff).ageAtAction !== row.age,
    );
    expect(disagreements).toEqual([]);
  });
});
