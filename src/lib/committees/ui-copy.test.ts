/**
 * The page chrome (`ui-copy.ts`) against the design's Copy section (C2 to C8, C10):
 * the words a reader sees are the ratified ones, no date field is called "Last day",
 * no string says "the day before", and none overclaims (Phase 3 "Accepted residuals no
 * string may deny"). Pure: no database, no DOM.
 */
import { describe, expect, it } from "vitest";
import { ADD, AREA, CHANGE, DISSOLVE, END, FORM, GROUPS_POINTER, LIST, PAGE } from "./ui-copy";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return strings((value as (...a: string[]) => unknown)("X", "Y"));
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
const ALL = [AREA, LIST, PAGE, FORM, ADD, CHANGE, END, DISSOLVE, GROUPS_POINTER].flatMap(strings);

describe("ui-copy: the ratified words", () => {
  it("the list (C2)", () => {
    expect(AREA).toBe("Committees & Commissions");
    expect(LIST.sections).toEqual({
      required: "Required committees",
      standing: "Standing committees",
      ad_hoc: "Ad hoc committees",
      unlabelled: "Not yet labelled",
      dissolved: "Dissolved committees",
    });
    expect(LIST.showDissolved(2)).toBe("Show dissolved committees (2)");
    expect(LIST.meets("Monthly")).toBe("Meets Monthly");
    expect(LIST.emptyBody).toBe("Start with the committees your presbytery is required to have, then add standing and ad hoc ones as you need them.");
  });

  it("the add form and its empty state (C5)", () => {
    expect(ADD.alreadyServes("Ada")).toBe("Ada (already serves)");
    expect(ADD.endsHelper).toBe("The first day they are no longer on the committee. Leave it empty if the term has no set end.");
    expect(ADD.emptyBody("the Presbytery")).toBe(
      'People serve on a committee from the presbytery\'s own records, so add them under Community first. If Community is off for the Presbytery, turn on "Community: add people and record roll actions" under Features. If you don\'t see Community or Features, ask your presbytery\'s administrator.',
    );
  });

  it("the dissolve dialog says it can't be undone FROM THIS PAGE, never that it can't be undone at all (C8)", () => {
    expect(DISSOLVE.body).toContain("it can't be undone from this page");
    expect(DISSOLVE.body).not.toMatch(/can never|cannot ever|permanent/i);
    expect(DISSOLVE.helper).toContain("It can't be in the future.");
  });

  it("the end dialog (C7)", () => {
    expect(END.titleCancel("Ada")).toBe("Cancel Ada's planned term?");
    expect(END.helper).toContain("enter the day after it");
  });

  it("the groups pointer (C10)", () => {
    expect(GROUPS_POINTER.before + "the Presbytery" + GROUPS_POINTER.middle + AREA + GROUPS_POINTER.after).toBe(
      "Committees of the Presbytery are kept under Committees & Commissions.",
    );
    expect(GROUPS_POINTER.emptyTitle).toBe("No groups yet");
  });
});

describe("ui-copy: nothing a date field or helper may not say", () => {
  it("no 'Last day' field and no 'the day before' (T2: every end-like date is the first day it no longer applies)", () => {
    for (const s of ALL) {
      expect(s, s).not.toMatch(/last day(?! of service)/i);
      expect(s, s).not.toMatch(/the day before/i);
    }
  });

  it("no string overclaims: everyone, no one else, nothing is kept, can never", () => {
    for (const s of ALL) {
      expect(s, s).not.toMatch(/everyone can|no one else can see|nothing is kept|can never happen/i);
    }
  });
});
