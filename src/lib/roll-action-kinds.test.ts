import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// Imported via the domain barrel (`@/lib/db/domain`), NOT the `./roll`
// submodule directly — a pre-existing, unrelated circular-import ordering
// defect (discovered while writing this test, filed to docs/TODO.md) makes
// a bare top-level `import { rollActionKind } from "@/lib/db/domain/roll"`
// throw "organizationType is not a function" at module-evaluation time,
// because `domain/authz.ts` runs before `domain/org.ts`'s own export is
// initialized when `./roll` is the entry point. Going through the barrel
// (which every other production caller of this module already does,
// directly or transitively via `@/lib/db/schema`) evaluates `./org` first
// and avoids it entirely.
import { rollActionKind } from "@/lib/db/domain";
import {
  EDIT_TIME_ROLL_ACTION_KINDS,
  ON_RECORD_ROLL_ACTION_KINDS,
  PARTICIPANT_RECORD_REFUSALS,
  PARTICIPANT_REMOVAL_ENDED_REASON,
  PARTICIPANT_VOID_REFUSALS,
  ROLL_ACTION_KIND_LABELS,
  ROLL_ACTION_KIND_TO_ROLL,
  WIZARD_ROLL_ACTION_KINDS,
  deriveRollFields,
  isOnRecordKind,
  type RollActionKind,
} from "./roll-action-kinds";

const ALL_KINDS = rollActionKind.enumValues as readonly RollActionKind[];

describe("roll-action-kinds — the shared allow-list module", () => {
  it("ROLL_ACTION_KIND_LABELS carries every kind in the schema enum, no more no less", () => {
    expect(Object.keys(ROLL_ACTION_KIND_LABELS).sort()).toEqual(
      [...ALL_KINDS].sort(),
    );
  });

  it("ROLL_ACTION_KIND_TO_ROLL carries every kind in the schema enum", () => {
    expect(Object.keys(ROLL_ACTION_KIND_TO_ROLL).sort()).toEqual(
      [...ALL_KINDS].sort(),
    );
  });

  it("void is never in either allow-list (Phase 2 Note 3)", () => {
    expect(EDIT_TIME_ROLL_ACTION_KINDS).not.toContain("void");
    expect(WIZARD_ROLL_ACTION_KINDS).not.toContain("void");
  });

  it("WIZARD_ROLL_ACTION_KINDS is unchanged from the wizard's original 2-kind list", () => {
    expect(WIZARD_ROLL_ACTION_KINDS).toEqual([
      "profession_of_faith",
      "other_participant_enrolled",
    ]);
  });

  it("EDIT_TIME_ROLL_ACTION_KINDS is mechanically every kind whose resultingRoll is non-null (F19 exclusion rule)", () => {
    const expectedGains = ALL_KINDS.filter(
      (kind) => ROLL_ACTION_KIND_TO_ROLL[kind] !== null,
    );
    expect([...EDIT_TIME_ROLL_ACTION_KINDS].sort()).toEqual(
      [...expectedGains].sort(),
    );
  });

  it("certificate_dismissed is excluded from EDIT_TIME_ROLL_ACTION_KINDS, alongside death (Phase 3's correction of Phase 2's own contradiction)", () => {
    expect(EDIT_TIME_ROLL_ACTION_KINDS).not.toContain("certificate_dismissed");
    expect(EDIT_TIME_ROLL_ACTION_KINDS).not.toContain("death");
  });

  it("every EDIT_TIME_ROLL_ACTION_KINDS entry has a human label", () => {
    for (const kind of EDIT_TIME_ROLL_ACTION_KINDS) {
      expect(typeof ROLL_ACTION_KIND_LABELS[kind]).toBe("string");
      expect(ROLL_ACTION_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// On-record kinds, vocabularies pinned to drizzle/0061, deriveRollFields (F173)
// docs/work-log/2026-10-22-founding-admin-directory.md, Phase 3 Test Plan 1.8
// ---------------------------------------------------------------------------

const MIGRATION_0061 = readFileSync(
  path.resolve(__dirname, "../../drizzle/0061_presby_participant_roll.sql"),
  "utf8",
);

/** The text of one `create or replace function <name>(` body, up to the next
 * `create or replace function` (or end of file). */
function functionBody(name: string): string {
  const start = MIGRATION_0061.indexOf(`create or replace function ${name}(`);
  expect(start, `${name} not found in 0061`).toBeGreaterThanOrEqual(0);
  const next = MIGRATION_0061.indexOf("create or replace function ", start + 10);
  return MIGRATION_0061.slice(start, next === -1 ? undefined : next);
}

function outcomesIn(body: string): string[] {
  return [...new Set([...body.matchAll(/outcome := '([a-z_]+)'/g)].map((m) => m[1]!))]
    .filter((outcome) => outcome !== "ok")
    .sort();
}

describe("on-record kinds (DECISION-198, R4)", () => {
  it("ON_RECORD_ROLL_ACTION_KINDS is exactly the SQL function's accepted list", () => {
    const match = /p_kind not in \(([^)]*)\)/.exec(functionBody("presby_record_participant_action"));
    expect(match, "p_kind not in (...) not found").not.toBeNull();
    const sqlKinds = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect([...ON_RECORD_ROLL_ACTION_KINDS].sort()).toEqual(sqlKinds);
  });

  it("only participant kinds take effect on record; no membership kind is ever in the list", () => {
    expect([...ON_RECORD_ROLL_ACTION_KINDS]).toEqual([
      "other_participant_enrolled",
      "other_participant_removed",
    ]);
    for (const kind of [
      "profession_of_faith",
      "reaffirmation",
      "restoration",
      "certificate_received",
      "other_gain",
      "baptized_member_enrolled",
      "affiliate_received",
      "certificate_dismissed",
      "death",
      "removed_by_session",
      "void",
      "opening_balance",
    ]) {
      expect(isOnRecordKind(kind)).toBe(false);
    }
    expect(isOnRecordKind("other_participant_enrolled")).toBe(true);
    expect(isOnRecordKind(undefined)).toBe(false);
    expect(isOnRecordKind({ toString: () => "other_participant_enrolled" })).toBe(false);
  });

  it("the removal marker equals the literal the SQL writes (and the Directory-style fixed-string contract)", () => {
    expect(PARTICIPANT_REMOVAL_ENDED_REASON).toBe("other_participant_removed");
    expect(functionBody("presby_record_participant_action")).toContain(
      `ended_reason = '${PARTICIPANT_REMOVAL_ENDED_REASON}'`,
    );
  });

  it("every on-record kind has a label", () => {
    for (const kind of ON_RECORD_ROLL_ACTION_KINDS) {
      expect(ROLL_ACTION_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("outcome vocabularies are pinned to drizzle/0061", () => {
  it("PARTICIPANT_RECORD_REFUSALS equals the record function's outcome literals, minus ok", () => {
    expect([...PARTICIPANT_RECORD_REFUSALS].sort()).toEqual(
      outcomesIn(functionBody("presby_record_participant_action")),
    );
  });

  it("PARTICIPANT_VOID_REFUSALS equals the void function's outcome literals, minus ok", () => {
    expect([...PARTICIPANT_VOID_REFUSALS].sort()).toEqual(
      outcomesIn(functionBody("presby_void_participant_action")),
    );
  });
});

describe("deriveRollFields (F173)", () => {
  it("resultingRoll follows ROLL_ACTION_KIND_TO_ROLL for every kind", () => {
    for (const kind of ALL_KINDS) {
      expect(deriveRollFields(kind, null, "2026-01-01").resultingRoll).toBe(
        ROLL_ACTION_KIND_TO_ROLL[kind],
      );
    }
  });

  it("ageAtAction is null when the birth date is unknown", () => {
    expect(deriveRollFields("profession_of_faith", null, "2026-01-01").ageAtAction).toBeNull();
    expect(deriveRollFields("profession_of_faith", undefined, "2026-01-01").ageAtAction).toBeNull();
  });

  // The table Batch A's DB test pins against the SQL expression
  // date_part('year', age(effective_date, date_of_birth))::int.
  it.each([
    ["2000-02-29", "2025-02-28", 24],
    ["2000-02-29", "2025-03-01", 25],
    ["2000-02-29", "2024-02-28", 23],
    ["2000-02-29", "2024-02-29", 24],
    ["2000-06-15", "2026-06-14", 25],
    ["2000-06-15", "2026-06-15", 26],
  ])("dob %s on %s is %i", (dob, on, expected) => {
    expect(deriveRollFields("profession_of_faith", dob, on).ageAtAction).toBe(expected);
  });

  it("an 18th birthday on the effective date is 18 (the 17/18 split in presby_roll_changes)", () => {
    expect(deriveRollFields("profession_of_faith", "2008-03-10", "2026-03-10").ageAtAction).toBe(18);
    expect(deriveRollFields("profession_of_faith", "2008-03-11", "2026-03-10").ageAtAction).toBe(17);
  });

  it("throws on a malformed date rather than computing NaN", () => {
    expect(() => deriveRollFields("profession_of_faith", null, "03/01/2026")).toThrow(/effectiveDate/);
    expect(() => deriveRollFields("profession_of_faith", "June 2000", "2026-01-01")).toThrow(/dateOfBirth/);
  });
});
