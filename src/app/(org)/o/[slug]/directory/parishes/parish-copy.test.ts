/**
 * The shared parish copy helpers (docs/work-log/2026-10-25-parish-management.md,
 * Copy C2, C4, C5). Every expected string is the design's, verbatim.
 */
import { describe, expect, it } from "vitest";
import {
  archiveBodyCopy,
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
