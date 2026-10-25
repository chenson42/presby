/**
 * The error-to-copy mapping for the parish actions (Copy C2/C4/C5). The switch
 * is exhaustive at the type level; this pins what each kind SAYS, and that the
 * toggle being off and authority being missing are the same refusal.
 */
import { describe, expect, it, vi } from "vitest";

const { MockOrgAccessError } = vi.hoisted(() => ({
  MockOrgAccessError: class extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  },
}));
vi.mock("@/lib/authz", () => ({ OrgAccessError: MockOrgAccessError }));

import {
  PERMISSION_COPY,
  describeParishFailure,
  describeParishThrow,
  genericFailureCopy,
  type ParishFailure,
} from "./parish-failure";

const ALL_KINDS: ParishFailure[] = [
  { kind: "off" },
  { kind: "forbidden" },
  { kind: "not_found" },
  { kind: "wrong_state" },
  { kind: "invalid_input", reason: "empty" },
  { kind: "invalid_input", reason: "too_long" },
  { kind: "name_taken" },
  { kind: "conflict" },
  { kind: "target_unavailable", reason: "archived", districtName: "East" },
  { kind: "target_unavailable", reason: "campus" },
  { kind: "source_not_archived" },
  { kind: "same_unit" },
  { kind: "too_many" },
  { kind: "count_changed" },
];

describe("describeParishFailure", () => {
  it("the toggle being off and missing authority are the SAME refusal, and it names no role", () => {
    expect(describeParishFailure({ kind: "off" }, { action: "move" })).toBe(
      "You don't have permission to do that.",
    );
    expect(describeParishFailure({ kind: "forbidden" }, { action: "move" })).toBe(PERMISSION_COPY);
    expect(PERMISSION_COPY).not.toMatch(/moderator|administrator|deacon/i);
  });

  it("answers every kind for every action with a non-empty string and no id", () => {
    for (const result of ALL_KINDS) {
      for (const action of ["define", "rename", "archive", "restore", "move", "assign", "undo", "bulk"] as const) {
        const text = describeParishFailure(result, { action });
        expect(text.length, `${result.kind}/${action}`).toBeGreaterThan(0);
        expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      }
    }
  });

  it("district name errors are the field copy", () => {
    expect(describeParishFailure({ kind: "invalid_input", reason: "empty" }, { action: "define" })).toBe(
      "Enter a name for the district.",
    );
    expect(describeParishFailure({ kind: "invalid_input", reason: "too_long" }, { action: "rename" })).toBe(
      "Use 80 characters or fewer.",
    );
    expect(describeParishFailure({ kind: "name_taken" }, { action: "define" })).toBe(
      "A district with that name already exists.",
    );
    expect(describeParishFailure({ kind: "name_taken" }, { action: "restore" })).toBe(
      "Another district already uses that name. Rename that one first, or leave this one archived.",
    );
  });

  it("a conflict says the household was just moved; an Undo conflict says it can't be undone", () => {
    expect(describeParishFailure({ kind: "conflict" }, { action: "move" })).toBe(
      "This household was just moved by someone else. We've refreshed the list.",
    );
    expect(describeParishFailure({ kind: "conflict" }, { action: "undo" })).toBe(
      "Can't undo: this household has been moved since.",
    );
  });

  it("an archived target says so; an Undo into an archived district names it; a campus is the generic failure", () => {
    expect(
      describeParishFailure({ kind: "target_unavailable", reason: "archived" }, { action: "move" }),
    ).toBe("That district was just archived. Choose another.");
    expect(
      describeParishFailure(
        { kind: "target_unavailable", reason: "archived", districtName: "East" },
        { action: "undo" },
      ),
    ).toBe("Can't undo: East is archived.");
    expect(
      describeParishFailure({ kind: "target_unavailable", reason: "campus" }, { action: "move" }),
    ).toBe("Could not move the household. Nothing was changed.");
  });

  it("not_found is a household for moves and a district for lifecycle", () => {
    expect(describeParishFailure({ kind: "not_found" }, { action: "assign" })).toBe(
      "We couldn't find that household. We've refreshed the list.",
    );
    expect(describeParishFailure({ kind: "not_found" }, { action: "rename" })).toBe(
      "We couldn't find that district. We've refreshed the list.",
    );
  });

  it("the bulk kinds carry the bulk copy", () => {
    expect(describeParishFailure({ kind: "too_many" }, { action: "bulk" })).toBe(
      "This district has more than 100 households, so move them in smaller groups with Move.",
    );
    expect(describeParishFailure({ kind: "count_changed" }, { action: "bulk" })).toBe(
      "The households in this district changed while you were looking. We've refreshed the page. Check the count and try again.",
    );
    expect(describeParishFailure({ kind: "source_not_archived" }, { action: "bulk" })).toBe(
      "Only an archived district can be emptied this way.",
    );
  });
});

describe("generic and thrown failures", () => {
  it("each action family has its own `nothing was changed` line", () => {
    expect(genericFailureCopy("define")).toBe("We couldn't save that. Nothing was changed.");
    expect(genericFailureCopy("move")).toBe("Could not move the household. Nothing was changed.");
    expect(genericFailureCopy("undo")).toBe("Could not undo. Nothing was changed.");
    expect(genericFailureCopy("bulk")).toBe("Could not move the households. Nothing was changed.");
  });

  it("a lapsed membership (OrgAccessError) is the refusal, anything else the generic line - never a stack or a message", () => {
    expect(describeParishThrow(new MockOrgAccessError(), "move")).toBe(PERMISSION_COPY);
    expect(describeParishThrow(new Error("connection reset by peer"), "move")).toBe(
      "Could not move the household. Nothing was changed.",
    );
    expect(describeParishThrow("boom", "bulk")).toBe("Could not move the households. Nothing was changed.");
  });
});
