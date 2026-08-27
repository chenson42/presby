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
  ROLL_ACTION_KIND_LABELS,
  ROLL_ACTION_KIND_TO_ROLL,
  WIZARD_ROLL_ACTION_KINDS,
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
