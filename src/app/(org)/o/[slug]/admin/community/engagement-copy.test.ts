import { describe, expect, it } from "vitest";
import { EDITABLE_ENGAGEMENTS } from "@/lib/membership-standing";
import {
  ARCHIVE_COPY,
  CHANGE_ENGAGEMENT_COPY,
  ENGAGEMENT_LABELS,
  ENGAGEMENT_SUCCESS_COPY,
  RESTORE_COPY,
  VISIT_DETAILS_COPY,
  engagementSuccessMessage,
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
