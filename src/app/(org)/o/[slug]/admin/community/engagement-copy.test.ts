import { describe, expect, it } from "vitest";
import {
  EDITABLE_ENGAGEMENTS,
  ENGAGEMENT_STATUSES,
  membershipStanding,
  type EditableEngagement,
  type Engagement,
} from "@/lib/membership-standing";
import {
  ARCHIVE_COPY,
  CHANGE_ENGAGEMENT_COPY,
  ENGAGEMENT_CARD_COPY,
  ENGAGEMENT_LABELS,
  ENGAGEMENT_SUCCESS_COPY,
  RESTORE_COPY,
  VISIT_DETAILS_COPY,
  VISIT_DETAILS_FORM_COPY,
  archiveDialogCopy,
  engagementDescription,
  engagementDialogCopy,
  engagementImpact,
  engagementSuccessMessage,
  listNameForEngagement,
  restoreDialogCopy,
  type EngagementImpactInput,
} from "./engagement-copy";

/**
 * The Group B, D and F copy of the Increment 3a design, by exact text. The
 * tables are `Record`s over the library's outcome unions (a missing outcome is a
 * type error); this file pins the words and the properties the Copy checks name.
 */

const TABLES = {
  CHANGE_ENGAGEMENT_COPY,
  ARCHIVE_COPY,
  RESTORE_COPY,
  VISIT_DETAILS_COPY,
};

describe("engagement copy", () => {
  it("labels the four editable engagements exactly as the Engagement card does (Group A)", () => {
    expect(ENGAGEMENT_LABELS).toEqual({
      visitor: "Visitor",
      regular: "Regular attender",
      inactive: "Inactive",
      moved_away: "Moved away",
    });
    expect(Object.keys(ENGAGEMENT_LABELS).sort()).toEqual([...EDITABLE_ENGAGEMENTS].sort());
  });

  it("the success toast names the person and the new engagement (Group B)", () => {
    expect(engagementSuccessMessage("Wendeline Ashgrove", "regular")).toBe("Wendeline Ashgrove is now marked as a regular attender.");
    expect(engagementSuccessMessage("Wendeline Ashgrove", "inactive")).toBe("Wendeline Ashgrove is now marked as inactive.");
    expect(engagementSuccessMessage("Wendeline Ashgrove", "moved_away")).toBe("Wendeline Ashgrove is now marked as moved away.");
    expect(engagementSuccessMessage("Wendeline Ashgrove", "visitor")).toBe("Wendeline Ashgrove is now marked as a visitor.");
  });

  it("the archive and restore toasts (Group D)", () => {
    expect(ENGAGEMENT_SUCCESS_COPY.archived("Wendeline Ashgrove")).toBe("Wendeline Ashgrove is archived. You can restore them from Former.");
    expect(ENGAGEMENT_SUCCESS_COPY.restored("Wendeline Ashgrove", "visitors")).toBe("Wendeline Ashgrove is back on the Visitors list.");
    expect(ENGAGEMENT_SUCCESS_COPY.restored("Wendeline Ashgrove", "inactive")).toBe("Wendeline Ashgrove is back on the Inactive list.");
    expect(ENGAGEMENT_SUCCESS_COPY.visitDetailsSaved).toBe("Visit details saved.");
  });

  it("every database-error sentence says nothing was changed", () => {
    for (const [name, table] of Object.entries(TABLES)) {
      expect((table as Record<string, string>).db_error, name).toMatch(/Nothing was changed\.$/);
    }
    expect(CHANGE_ENGAGEMENT_COPY.db_error).toBe("We couldn't save that change. Nothing was changed.");
    expect(ARCHIVE_COPY.db_error).toBe("We couldn't archive them. Nothing was changed.");
    expect(RESTORE_COPY.db_error).toBe("We couldn't restore them. Nothing was changed.");
    expect(VISIT_DETAILS_COPY.db_error).toBe("We couldn't save that change. Nothing was changed.");
  });

  it("the shared sentences are one wording across the writes (Copy group B gives them once)", () => {
    expect(CHANGE_ENGAGEMENT_COPY.forbidden).toBe("You don't have permission to change this.");
    for (const table of [CHANGE_ENGAGEMENT_COPY, RESTORE_COPY, VISIT_DETAILS_COPY]) {
      expect(table.forbidden).toBe(CHANGE_ENGAGEMENT_COPY.forbidden);
      expect(table.not_found).toBe("That person could not be found.");
    }
    expect(ARCHIVE_COPY.not_found).toBe("That person could not be found.");
    expect(CHANGE_ENGAGEMENT_COPY.ended).toBe(VISIT_DETAILS_COPY.ended);
  });

  it("no sentence leaks a code, a function, a table or a database term, or says 'deleted' (nothing is ever deleted)", () => {
    const everything = Object.values(TABLES).flatMap((table) => Object.values(table));
    expect(everything.length).toBeGreaterThan(20);
    for (const text of everything) {
      expect(text.length).toBeGreaterThan(10);
      expect(text, text).not.toMatch(/presby_|memberships?\b|constraint|trigger|check_violation|SQL|postgres|_[a-z]+_|\bdelet/i);
      expect(text, text).toMatch(/[.?]$/);
    }
    expect(ENGAGEMENT_SUCCESS_COPY.archived("N")).not.toMatch(/delet/i);
  });

  it("denies no accepted residual and promises nothing the database does not do (Copy checks R)", () => {
    // 'Their record is kept and you can restore it' is true of an end date with a marker; the words below never appear.
    for (const text of [...Object.values(ARCHIVE_COPY), ...Object.values(RESTORE_COPY)]) {
      expect(text).not.toMatch(/permanently|can't be undone|cannot be undone|removed forever/i);
    }
    // The blocked-archive sentences say what to do first, and `pending_action` makes no promise the viewer can withdraw.
    expect(ARCHIVE_COPY.holds_position).toMatch(/End that first, then try again\.$/);
    expect(ARCHIVE_COPY.pending_action).toContain("decided it or it has been withdrawn");
  });

  it("the bad-date sentence names both bounds the writer enforces", () => {
    expect(VISIT_DETAILS_COPY.bad_date).toContain("1900");
    expect(VISIT_DETAILS_COPY.bad_date).toContain("today");
    expect(VISIT_DETAILS_COPY.bad_text).toBe("Keep this under 200 characters.");
  });
});

describe("engagementImpact: the rule behind the dialog (EC-25, Copy group B)", () => {
  const ROLLS: Array<string | null> = [null, "active", "baptized", "affiliate", "other_participant", "transferred"];
  const FACTS: Array<boolean | null> = [true, false, null];

  /** Every from / to / roll / connected / address / toggle combination. */
  const cases: EngagementImpactInput[] = [];
  for (const from of ENGAGEMENT_STATUSES) {
    for (const to of EDITABLE_ENGAGEMENTS) {
      for (const currentRoll of ROLLS) {
        for (const signInConnected of FACTS) {
          for (const addressOnFile of FACTS) {
            for (const selfConnectEnabled of FACTS) {
              cases.push({ from, to, currentRoll, signInConnected, addressOnFile, selfConnectEnabled });
            }
          }
        }
      }
    }
  }

  it("covers the whole grid (so a new engagement or roll is a visible change)", () => {
    expect(cases.length).toBe(5 * 4 * 6 * 27);
  });

  it("listing change is exactly the classifier's before/after, so the roll can never change it", () => {
    for (const input of cases) {
      const before = membershipStanding(input.currentRoll, input.from) === "listed";
      const after = membershipStanding(input.currentRoll, input.to) === "listed";
      const impact = engagementImpact(input);
      expect(impact.listingChange, JSON.stringify(input)).toBe(!before && after ? "gains" : before && !after ? "loses" : "none");
      expect(impact.opensDialog, JSON.stringify(input)).toBe(impact.listingChange !== "none");
    }
  });

  it("a person on a listed roll never opens a dialog, whatever the engagement (the roll lists them)", () => {
    for (const input of cases.filter((c) => ["active", "baptized", "affiliate", "other_participant"].includes(c.currentRoll ?? ""))) {
      expect(engagementImpact(input).opensDialog, JSON.stringify(input)).toBe(false);
    }
  });

  it("the sign-in line appears only with a dialog: connected says so, unknown says 'if', known-not-connected says nothing", () => {
    for (const input of cases) {
      const impact = engagementImpact(input);
      const expected = !impact.opensDialog
        ? null
        : input.signInConnected === true
          ? "connected"
          : input.signInConnected === null
            ? "unknown"
            : null;
      expect(impact.signInLine, JSON.stringify(input)).toBe(expected);
    }
  });

  it("the auto-connect line needs all four premises known true: a dialog that gives listing, not connected, an address, the toggle on", () => {
    for (const input of cases) {
      const impact = engagementImpact(input);
      const all =
        impact.listingChange === "gains" &&
        input.signInConnected === false &&
        input.addressOnFile === true &&
        input.selfConnectEnabled === true;
      expect(impact.autoConnectLine, JSON.stringify(input)).toBe(all);
    }
    // An unknown premise never produces the line (it would promise a connection the definer may refuse).
    const base = { from: "visitor", to: "regular", currentRoll: null, signInConnected: false, addressOnFile: true, selfConnectEnabled: true } as const;
    expect(engagementImpact(base).autoConnectLine).toBe(true);
    expect(engagementImpact({ ...base, selfConnectEnabled: null }).autoConnectLine).toBe(false);
    expect(engagementImpact({ ...base, addressOnFile: null }).autoConnectLine).toBe(false);
    expect(engagementImpact({ ...base, signInConnected: null }).autoConnectLine).toBe(false);
    // Losing listing never says a connection could happen.
    expect(engagementImpact({ ...base, from: "regular", to: "inactive" }).autoConnectLine).toBe(false);
  });

  it("the named transitions with no roll", () => {
    const b = { currentRoll: null, signInConnected: false, addressOnFile: null, selfConnectEnabled: null } as const;
    const change = (from: Engagement, to: EditableEngagement) => engagementImpact({ ...b, from, to }).listingChange;
    expect(change("visitor", "regular")).toBe("gains");
    expect(change("inactive", "regular")).toBe("gains");
    expect(change("moved_away", "regular")).toBe("gains");
    expect(change("regular", "inactive")).toBe("loses");
    expect(change("regular", "moved_away")).toBe("loses");
    expect(change("regular", "visitor")).toBe("loses");
    expect(change("visitor", "inactive")).toBe("none");
    expect(change("inactive", "moved_away")).toBe("none");
    expect(change("inactive", "visitor")).toBe("none");
  });
});

describe("engagementDialogCopy (Group B)", () => {
  const gains = engagementImpact({ from: "visitor", to: "regular", currentRoll: null, signInConnected: true, addressOnFile: true, selfConnectEnabled: true });
  const loses = engagementImpact({ from: "regular", to: "inactive", currentRoll: null, signInConnected: null, addressOnFile: null, selfConnectEnabled: null });

  it("to Regular: title, body, the connected line, Keep and the confirm label", () => {
    expect(engagementDialogCopy("Wren Alder", "regular", gains)).toEqual({
      title: "Mark Wren Alder as a regular attender?",
      body: "They can then appear in the member directory.",
      lines: ["Wren Alder has a sign-in connected, so this can also change what they can see."],
      cancel: "Keep as it is",
      confirm: "Mark as regular attender",
      pending: "Saving…",
    });
  });

  it("away from Regular: the three titles and confirms, the body, and the 'if' line for unknown sign-in facts", () => {
    const copy = (to: EditableEngagement) => engagementDialogCopy("Wren Alder", to, loses);
    expect(copy("inactive").title).toBe("Mark Wren Alder as inactive?");
    expect(copy("moved_away").title).toBe("Mark Wren Alder as moved away?");
    expect(copy("visitor").title).toBe("Mark Wren Alder as a visitor?");
    expect(copy("inactive").confirm).toBe("Mark as inactive");
    expect(copy("moved_away").confirm).toBe("Mark as moved away");
    expect(copy("visitor").confirm).toBe("Mark as a visitor");
    expect(copy("inactive").body).toBe("They will no longer appear in the member directory.");
    expect(copy("inactive").lines).toEqual(["If Wren Alder has a sign-in connected, this can also change what they can see."]);
  });

  it("the auto-connect line says 'could', never 'will' or 'safely' (it discloses the residual)", () => {
    const impact = engagementImpact({ from: "visitor", to: "regular", currentRoll: null, signInConnected: false, addressOnFile: true, selfConnectEnabled: true });
    const lines = engagementDialogCopy("Wren Alder", "regular", impact).lines;
    expect(lines).toEqual(["Wren Alder could be connected to this record automatically when they sign in with an address on file."]);
    expect(lines.join(" ")).not.toMatch(/\bwill\b|safe/i);
  });
});

describe("the Engagement card and Visit details strings (Groups A and F)", () => {
  it("the heading, helper, button and the three card lines, verbatim", () => {
    expect(ENGAGEMENT_CARD_COPY.heading).toBe("Engagement");
    expect(ENGAGEMENT_CARD_COPY.helper).toBe(
      "Engagement is for your own care. It is never reported to the presbytery or the denomination, and it does not change anyone's membership roll. It does decide who appears in the member directory and what a connected sign-in can see.",
    );
    expect(ENGAGEMENT_CARD_COPY.save).toBe("Save engagement");
    expect(ENGAGEMENT_CARD_COPY.staffRecord).toBe("This is a staff record, so engagement isn't tracked.");
    expect(ENGAGEMENT_CARD_COPY.archived("Wren Alder")).toBe("Wren Alder was archived. Restore them to change this.");
    expect(ENGAGEMENT_CARD_COPY.otherEnded("Wren Alder")).toBe("Wren Alder's connection here has ended, so engagement can't be changed.");
    expect(ENGAGEMENT_CARD_COPY.nudge("Wren Alder")).toBe("Wren Alder is still marked as a visitor. Mark as a regular attender?");
    expect(ENGAGEMENT_CARD_COPY.nudgeButton).toBe("Mark as regular attender");
    expect(ENGAGEMENT_CARD_COPY.selectAccessibleName("Wren Alder")).toBe("Engagement for Wren Alder");
    expect(ENGAGEMENT_CARD_COPY.currentOption("Visitor")).toBe("Visitor (current)");
  });

  it("the descriptions, with and without the roll", () => {
    expect(engagementDescription(false, "visitor")).toBe("Visitor. Does not appear in the member directory.");
    expect(engagementDescription(false, "regular")).toBe("Regular attender. Can appear in the member directory.");
    expect(engagementDescription(false, "inactive")).toBe("Inactive. Not attending lately. Does not appear in the member directory.");
    expect(engagementDescription(false, "moved_away")).toBe("Moved away. Does not appear in the member directory.");
    expect(engagementDescription(true, "regular")).toBe("Regular attender. Can appear in the member directory.");
    expect(engagementDescription(true, "inactive")).toBe(
      "Inactive. Not attending lately. Can still appear in the member directory because they are on the roll.",
    );
    expect(engagementDescription(true, "moved_away")).toBe(
      "Moved away. Can still appear in the member directory because they are on the roll. A departure is recorded as a roll action, not here.",
    );
    expect(engagementDescription(true, "visitor")).toBeNull();
  });

  it("no card string claims the label is harmless or denies the access effect (architect note 4)", () => {
    expect(ENGAGEMENT_CARD_COPY.helper).not.toMatch(/changes nothing|harmless/i);
    expect(ENGAGEMENT_CARD_COPY.helper).toContain("It does decide who appears in the member directory");
  });

  it("Visit details labels are the wizard's", () => {
    expect(VISIT_DETAILS_FORM_COPY).toMatchObject({
      heading: "Visit details",
      firstVisit: "First visit (optional)",
      howHeard: "How did they hear about us? (optional)",
      save: "Save visit details",
    });
  });
});

describe("archive and restore dialog copy (Group D)", () => {
  it("archive: title, body naming the list, the two added lines, Keep and Archive", () => {
    const copy = archiveDialogCopy("Wren Alder", "Alder Creek Church", { list: "Visitors", signInConnected: true, invitationOpen: true });
    expect(copy).toEqual({
      title: "Archive Wren Alder?",
      body: "Wren Alder will leave the Visitors list and appear under Former. Their record is kept and you can restore it any time.",
      lines: [
        "Wren Alder has a sign-in connected and will no longer reach Alder Creek Church through this record.",
        "An invitation to Wren Alder is still open. It will stop working.",
      ],
      cancel: "Keep",
      confirm: "Archive",
      pending: "Archiving…",
    });
  });

  it("archive adds only the lines whose facts are true, and the Inactive list is named for the others", () => {
    const copy = archiveDialogCopy("Wren Alder", "Alder Creek Church", { list: "Inactive", signInConnected: false, invitationOpen: false });
    expect(copy.lines).toEqual([]);
    expect(copy.body).toContain("leave the Inactive list");
    expect(archiveDialogCopy("W", "O", { list: "Inactive", signInConnected: false, invitationOpen: true }).lines).toEqual([
      "An invitation to W is still open. It will stop working.",
    ]);
  });

  it("restore: title, body, the connected line only for a known connected sign-in, Keep archived and Restore", () => {
    expect(restoreDialogCopy("Wren Alder", "Alder Creek Church", { list: "Inactive", signInConnected: true })).toEqual({
      title: "Restore Wren Alder?",
      body: "Wren Alder will return to the Inactive list.",
      lines: ["Wren Alder has a sign-in connected and will reach Alder Creek Church again."],
      cancel: "Keep archived",
      confirm: "Restore",
      pending: "Saving…",
    });
    for (const facts of [false, null]) {
      expect(restoreDialogCopy("W", "O", { list: "Visitors", signInConnected: facts }).lines).toEqual([]);
    }
  });

  it("a visitor returns to Visitors and anyone else to Inactive (the library's own rule)", () => {
    expect(listNameForEngagement("visitor")).toBe("Visitors");
    for (const e of ["regular", "inactive", "moved_away", "staff"] as const) {
      expect(listNameForEngagement(e)).toBe("Inactive");
    }
  });
});
