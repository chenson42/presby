/**
 * Parity test — the third leg of the field-set agreement this codebase
 * already enforces twice (`drizzle/0046` section 2's `DO` block: field_spec
 * keys == typed `congregation_statistics` columns). This file asserts the
 * hand-maintained label/group module (`src/lib/sasr-fields.ts`) declares
 * EXACTLY the same key set the seeded `sasr_form_versions.field_spec` for
 * `'2024'` declares — no more, no fewer, no typos.
 *
 * DB-BACKED (real Postgres — `hasDb` skip-guard, same convention as every
 * other `*.test.ts` in this tree). `npm test` in CI does not set
 * `DATABASE_URL`, so this suite is SKIPPED there, not failed. Run it for
 * real with:
 *   dotenv -e .env.local -- vitest run src/lib/sasr-fields.test.ts
 *
 * A STATIC TWIN (no DB) also runs unconditionally below: it pins the exact
 * key set as a literal snapshot, captured from the live catalog on
 * 2026-09-25 (`docs/work-log/2026-09-25-submission-grants.md`, Phase 4 batch
 * B). If the DB-backed half above is ever skipped (CI), this half still
 * catches a label-module typo or an accidental key removal — it just can't
 * catch upstream DB drift the way the DB-backed half can.
 */
import { describe, expect, it } from "vitest";
import { SASR_FIELD_GROUPS, sasrFieldKeys } from "./sasr-fields";

const hasDb = Boolean(process.env.DATABASE_URL);

// Captured from `select jsonb_object_keys(field_spec->'fields') from
// sasr_form_versions where key = '2024'` on the seeded dev database,
// 2026-09-25. 60 keys, matching drizzle/0046's own field-count comment.
const EXPECTED_2024_KEYS = [
  "age_17_under",
  "age_18_25",
  "age_26_40",
  "age_41_55",
  "age_56_70",
  "age_71_over",
  "age_unknown",
  "avg_weekly_worship_attendance",
  "baptisms_adults",
  "baptisms_children",
  "budgeted_expense",
  "budgeted_income",
  "disability_hearing",
  "disability_mobility",
  "disability_other",
  "disability_sight",
  "ending_active",
  "ending_affiliate",
  "ending_baptized",
  "ending_other_participants",
  "exp_capital",
  "exp_ga_theological_education_fund",
  "exp_investment",
  "exp_local_mission",
  "exp_local_program",
  "exp_other_mission",
  "exp_per_capita_apportionment",
  "exp_validated_mission_pcusa",
  "gains_certificate",
  "gains_other",
  "gains_professions_18plus",
  "gains_professions_under18",
  "gender_man",
  "gender_nonbinary",
  "gender_woman",
  "losses_certificate",
  "losses_deaths",
  "losses_other",
  "officers_deacon_count",
  "officers_ruling_elder_count",
  "potential_giving_units",
  "race_african",
  "race_african_american",
  "race_asian",
  "race_black",
  "race_hispanic",
  "race_middle_eastern",
  "race_native_american",
  "race_other",
  "race_white",
  "receipts_bequests",
  "receipts_capital_building_funds",
  "receipts_contributions",
  "receipts_investment_endowment_income",
  "receipts_other_income",
  "receipts_subsidy_or_aid",
  "youth_4_under",
  "youth_6_8",
  "youth_9_12",
  "youth_k_5",
].sort();

describe("SASR_FIELD_GROUPS['2024'] — static snapshot twin (no DB required)", () => {
  it("declares exactly 60 fields", () => {
    expect(sasrFieldKeys("2024")).toHaveLength(60);
  });

  it("has no duplicate keys", () => {
    const keys = sasrFieldKeys("2024");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches the 2026-09-25 snapshot of the seeded 2024 field_spec key set exactly", () => {
    expect([...sasrFieldKeys("2024")].sort()).toStrictEqual(EXPECTED_2024_KEYS);
  });

  it("every group has a title and at least one field", () => {
    for (const group of SASR_FIELD_GROUPS["2024"]) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.fields.length).toBeGreaterThan(0);
    }
  });

  it("every field has a non-empty label and a valid inputType", () => {
    for (const group of SASR_FIELD_GROUPS["2024"]) {
      for (const field of group.fields) {
        expect(field.label.length).toBeGreaterThan(0);
        expect(["count", "currency"]).toContain(field.inputType);
      }
    }
  });
});

describe.skipIf(!hasDb)(
  "SASR_FIELD_GROUPS['2024'] vs. the live seeded field_spec (Postgres-backed)",
  () => {
    it("key sets are identical", async () => {
      const { db } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const result = await db.execute(sql`
        select jsonb_object_keys(field_spec -> 'fields') as key
        from sasr_form_versions
        where key = '2024'
      `);
      const rows = (result as unknown as { rows?: Array<{ key: string }> }).rows ?? [];
      const dbKeys = rows.map((r) => r.key).sort();

      const tsKeys = [...sasrFieldKeys("2024")].sort();

      expect(tsKeys).toStrictEqual(dbKeys);
    });

    it("every field's declared type (integer/numeric) agrees with this module's inputType", async () => {
      const { db } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const result = await db.execute(sql`
        select f.key as key, f.value ->> 'type' as spec_type
        from sasr_form_versions v, jsonb_each(v.field_spec -> 'fields') f
        where v.key = '2024'
      `);
      const rows =
        (result as unknown as { rows?: Array<{ key: string; spec_type: string }> })
          .rows ?? [];
      const specTypeByKey = new Map(rows.map((r) => [r.key, r.spec_type]));

      for (const group of SASR_FIELD_GROUPS["2024"]) {
        for (const field of group.fields) {
          const specType = specTypeByKey.get(field.key);
          expect(specType, `missing spec type for ${field.key}`).toBeDefined();
          const expectedInputType = specType === "numeric" ? "currency" : "count";
          expect(field.inputType, `mismatch for ${field.key}`).toBe(
            expectedInputType,
          );
        }
      }
    });
  },
);
