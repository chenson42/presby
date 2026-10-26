/**
 * The shared parish copy helpers (docs/work-log/2026-10-25-parish-management.md,
 * Copy C2, C4, C5). Every expected string is the design's, verbatim.
 */
import { describe, expect, it } from "vitest";
import {
  ARCHIVED_BASE_COPY,
  BULK_TOO_MANY_COPY,
  archiveBodyCopy,
  archivedMoveSentence,
  archivedMoveState,
  noActiveDistrictsCopy,
  archiveDeaconCopy,
  bulkConfirmBodyCopy,
  bulkConfirmTailCopy,
  bulkSuccessCopy,
  householdsLabel,
  movedToastCopy,
} from "./parish-copy";

describe("householdsLabel", () => {
  it("is `1 household` and `N households` (zero included)", () => {
    expect(householdsLabel(0)).toBe("0 households");
    expect(householdsLabel(1)).toBe("1 household");
    expect(householdsLabel(2)).toBe("2 households");
  });
});

describe("bulkSuccessCopy (C5)", () => {
  it("names the count and the destination", () => {
    expect(bulkSuccessCopy(12, 0, "North District")).toBe("Moved 12 households to North District.");
    expect(bulkSuccessCopy(1, 0, "North District")).toBe("Moved 1 household to North District.");
  });

  it("appends the skipped sentence when others had moved some, counts only", () => {
    expect(bulkSuccessCopy(10, 2, "North District")).toBe(
      "Moved 10 households to North District. 2 had already been moved by someone else and were left alone.",
    );
  });

  it("zero moved is its own sentence, whatever was skipped", () => {
    expect(bulkSuccessCopy(0, 3, "North District")).toBe("No households were left to move.");
  });
});

describe("movedToastCopy (C4)", () => {
  it("Moved / Assigned / Removed, by mode and by whether a destination exists", () => {
    expect(movedToastCopy("move", { fromName: "A", toName: "B" })).toBe("Moved to B.");
    expect(movedToastCopy("assign", { fromName: null, toName: "B" })).toBe("Assigned to B.");
    expect(movedToastCopy("move", { fromName: "A", toName: null })).toBe("Removed from A.");
  });
});

describe("archive dialog copy (C2)", () => {
  it("states the count, with the zero and one forms", () => {
    expect(archiveBodyCopy(0)).toBe("No households are in it. You can restore it later.");
    expect(archiveBodyCopy(1)).toBe(
      "1 household is still in it. It stays there until it is moved to another district. No households can be moved into an archived district. You can restore it later.",
    );
    expect(archiveBodyCopy(7)).toBe(
      "7 households are still in it. They stay there until they are moved to another district. No households can be moved into an archived district. You can restore it later.",
    );
  });

  it("never claims the households need or will get a new district automatically", () => {
    expect(archiveBodyCopy(7)).not.toMatch(/need/i);
    expect(archiveBodyCopy(7)).not.toMatch(/reassign/i);
  });

  it("names the open deacon and points to Officers", () => {
    expect(archiveDeaconCopy("Dee Deaconson")).toBe(
      "Dee Deaconson is still recorded as this district's Deacon. End that term in Officers if they have stepped down.",
    );
  });
});

describe("bulk confirmation copy (C5)", () => {
  it("names the deacon of the destination as `recorded`, or says none is", () => {
    expect(
      bulkConfirmBodyCopy({ count: 3, source: "East", destination: "North", destinationDeacon: "Dee Deaconson" }),
    ).toBe("All 3 households in East will move to North. Dee Deaconson is recorded as North's Deacon.");
    expect(
      bulkConfirmBodyCopy({ count: 1, source: "East", destination: "North", destinationDeacon: null }),
    ).toBe("All 1 household in East will move to North. No deacon is recorded for North yet.");
  });

  it("says plainly there is no bulk undo but single moves are still possible", () => {
    expect(bulkConfirmTailCopy("East")).toBe(
      "East is archived, so households can't be moved back into it. This can't be undone in one step; households can be moved again one at a time.",
    );
  });
});

describe("archivedMoveState (QA run 1, Finding 3)", () => {
  it("is the four-state table over canMove x households (0, 1, 100, 101) x active targets (0, 1)", () => {
    for (const householdCount of [0, 1, 100, 101]) {
      for (const activeTargetCount of [0, 1]) {
        const label = `${householdCount} households, ${activeTargetCount} targets`;
        expect(archivedMoveState({ canMove: false, householdCount, activeTargetCount }), `no canMove: ${label}`).toBe("none");
        const expected =
          householdCount === 0
            ? "none"
            : activeTargetCount === 0
              ? "no_target"
              : householdCount > 100
                ? "over_cap"
                : "bulk";
        expect(archivedMoveState({ canMove: true, householdCount, activeTargetCount }), label).toBe(expected);
      }
    }
  });

  it("no_target wins over over_cap (nowhere to move them, so no promise about how)", () => {
    expect(archivedMoveState({ canMove: true, householdCount: 150, activeTargetCount: 0 })).toBe("no_target");
  });
});

describe("archived-notice strings (QA run 1, Finding 3)", () => {
  it("the base sentence is unchanged", () => {
    expect(ARCHIVED_BASE_COPY).toBe("This district is archived. No households can be moved into it.");
  });

  it("only the bulk and over_cap states append a sentence, and only bulk promises `all at once below`", () => {
    expect(archivedMoveSentence("bulk")).toBe(" Move households out one at a time, or all at once below.");
    expect(archivedMoveSentence("over_cap")).toBe(" Move households out one at a time below.");
    expect(archivedMoveSentence("no_target")).toBe("");
    expect(archivedMoveSentence("none")).toBe("");
  });

  it("the too-many sentence is shared by the over-cap child and the refusal toast", () => {
    expect(BULK_TOO_MANY_COPY).toBe(
      "This district has more than 100 households, so they can't be moved all at once.",
    );
  });

  it("the no-active-district line adds the instruction only for a viewer who can define districts", () => {
    expect(noActiveDistrictsCopy(true)).toBe(
      "There are no active districts to move them to. Add a district or restore an archived one on the Parishes page first.",
    );
    expect(noActiveDistrictsCopy(false)).toBe("There are no active districts to move them to.");
  });
});

describe("movedToastCopy fallback (QA run 1, Finding 4)", () => {
  it("`Removed from its district.` is the fallback when the previous district's name is unknown (a move with no previous district writes nothing, so this is unreachable by design)", () => {
    expect(movedToastCopy("move", { fromName: null, toName: null })).toBe("Removed from its district.");
    expect(movedToastCopy("move", { fromName: "North", toName: null })).toBe("Removed from North.");
  });
});
