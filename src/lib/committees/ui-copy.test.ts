/**
 * The page chrome (`ui-copy.ts`) against the design's Copy section (C2 to C8, C10):
 * the words a reader sees are the ratified ones, no date field is called "Last day",
 * no string says "the day before", and none overclaims (Phase 3 "Accepted residuals no
 * string may deny"). Pure: no database, no DOM.
 */
import { describe, expect, it } from "vitest";
import { ADD, AREA, CHANGE, COMMISSION_MEMBER, COMMISSIONS, DISSOLVE, END, END_COMMISSION, FORM, GROUPS_POINTER, LIST, PAGE, REMOVE_RECORD } from "./ui-copy";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return strings((value as (...a: string[]) => unknown)("X", "Y"));
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
const ALL = [AREA, LIST, PAGE, FORM, ADD, CHANGE, END, DISSOLVE, GROUPS_POINTER, COMMISSIONS, COMMISSION_MEMBER, END_COMMISSION, REMOVE_RECORD].flatMap(strings);

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

describe("ui-copy: the commission chrome (C15), byte for byte", () => {
  it("the list intro (C2 II), the section, its intro and the buttons", () => {
    expect(LIST.intro("the Presbytery")).toBe("The committees of the Presbytery, who serves on each, and the administrative commissions it has recorded.");
    expect(COMMISSIONS.heading).toBe("Administrative commissions");
    expect(COMMISSIONS.intro).toBe(
      "The presbytery's own record of the administrative commissions it has appointed. A record gives no one access to a congregation's PresbyPortal, and the congregation does not see it.",
    );
    expect(COMMISSIONS.record).toBe("Record a commission");
    expect(COMMISSIONS.emptyTitle).toBe("No administrative commissions are recorded.");
    expect(COMMISSIONS.showEnded(2)).toBe("Show ended commissions (2)");
    expect(COMMISSIONS.hideEnded).toBe("Hide ended commissions");
    expect(COMMISSIONS.tableHead).toEqual({ title: "Title", congregation: "Congregation", appointed: "Appointed", status: "Status", serving: "Serving" });
  });

  it("the commission page", () => {
    expect([COMMISSIONS.edit, COMMISSIONS.addMember, COMMISSIONS.endCommission, COMMISSIONS.removeRecord, COMMISSIONS.charge]).toEqual([
      "Edit commission",
      "Add a member",
      "End commission",
      "Remove this record",
      "Charge",
    ]);
    expect(COMMISSIONS.minute("Item 4")).toBe("Minute: Item 4");
    expect(COMMISSIONS.noMinute).toBe("No minute recorded");
    expect(COMMISSIONS.reportedIn("Item 9")).toBe("Reported in: Item 9");
  });

  it("the record form", () => {
    expect([COMMISSIONS.newTitle, COMMISSIONS.editTitle, COMMISSIONS.fieldTitle, COMMISSIONS.fieldCharge, COMMISSIONS.fieldCongregation, COMMISSIONS.congregationNone, COMMISSIONS.fieldAppointed, COMMISSIONS.fieldMinute, COMMISSIONS.submitRecord]).toEqual([
      "Record a commission",
      "Edit commission",
      "Title",
      "Charge (optional)",
      "Congregation (optional)",
      "No congregation",
      "Appointed on",
      "Minute reference (optional)",
      "Record commission",
    ]);
    expect(COMMISSIONS.chargeHelper).toBe(
      "Describe the charge in general terms. Don't record confidential details. Anyone who can manage committees at this presbytery can read it.",
    );
    expect(COMMISSIONS.minuteHelper).toBe("For example, the meeting date and item.");
  });

  it("the end and remove dialogs", () => {
    expect(END_COMMISSION.title).toBe("End this commission?");
    expect(END_COMMISSION.body).toBe(
      "This ends every member's term on the date you choose and records that the commission has ended. The record is kept, and it can't be reopened from this page.",
    );
    expect(END_COMMISSION.helper).toBe("The first day the commission no longer exists. Every member's term ends on this date. It can't be in the future.");
    expect(END_COMMISSION.minuteField).toBe("Minute reference for its report (optional)");
    expect(REMOVE_RECORD.title).toBe("Remove this record?");
    expect(REMOVE_RECORD.body).toBe(
      "Use this only for a record entered by mistake. It will no longer be listed here, and this page can't bring it back. To record that a commission finished, end it instead.",
    );
    expect(REMOVE_RECORD.confirm).toBe("Remove record");
  });

  it("the member form and its end dialog are the committee's words with 'commission' (a recorded deviation), and say no 'committee'", () => {
    expect(COMMISSION_MEMBER.endTitle("Ada")).toBe("End Ada's term on this commission?");
    expect(COMMISSION_MEMBER.submit).toBe("Add to commission");
    for (const s of strings(COMMISSION_MEMBER)) expect(s, s).not.toMatch(/committee/i);
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
