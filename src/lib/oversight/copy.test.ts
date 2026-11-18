/**
 * U3: copy.ts is the one home of every string the module produces
 * (docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "Copy" C1 to C9 and
 * "Test plan"). Pinned here: every refusal kind has its Copy string; the
 * validator and the store carry no sentence of their own; no string claims what
 * the accepted residuals deny; no string leaks database vocabulary; the Locked
 * and empty strings are shared where the design says so.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS, type Refusal } from "./contract";
import { GATE_COPY, PHOTO_COPY, PHOTO_REFUSAL, REFUSAL, STATE, TOAST, VALIDATION, photoRefusalMessage, refusalMessage } from "./copy";

/** Every string copy.ts can produce, functions called with sample arguments. */
function catalog(): string[] {
  const out: string[] = [];
  const walk = (value: unknown, name: string) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      const fn = value as (...a: unknown[]) => unknown;
      const sample =
        name === "yearFormat" || name === "yearRange" ? [fn("Year built", 2026), fn("Year built", 2026)]
        : [fn(2026), fn(4000)];
      for (const s of sample) if (typeof s === "string") out.push(s);
    } else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(REFUSAL, "REFUSAL");
  walk(GATE_COPY, "GATE_COPY");
  walk(VALIDATION, "VALIDATION");
  walk(TOAST, "TOAST");
  walk(STATE, "STATE");
  walk(PHOTO_REFUSAL, "PHOTO_REFUSAL");
  walk(PHOTO_COPY, "PHOTO_COPY");
  out.push(refusalMessage("duplicate_appraisal_year", { assessedYear: 2024 }));
  return out;
}

describe("copy.ts", () => {
  it("every refusal kind has a message, and the verbatim strings are the design's", () => {
    const kinds: Refusal[] = [
      "forbidden", "not_found", "duplicate_name", "duplicate_policy_year", "duplicate_appraisal_year", "stale",
      "already_retired", "not_retired", "already_paid_off", "not_paid_off", "building_removed", "save_failed",
    ];
    for (const kind of kinds) expect(refusalMessage(kind, { assessedYear: 2024 }).length, kind).toBeGreaterThan(10);
    expect(refusalMessage("stale")).toBe(
      "This record was changed by someone else after you opened it. Reload the page to see their change, then make yours again.",
    );
    expect(refusalMessage("not_found")).toBe("That record could not be found.");
    expect(refusalMessage("forbidden")).toBe("You don't have permission to do that here.");
    expect(refusalMessage("save_failed")).toBe("We couldn't save that. Nothing was changed.");
    expect(refusalMessage("building_removed")).toBe("That building was removed.");
    expect(refusalMessage("duplicate_name")).toBe("A building with that name is already recorded.");
    expect(refusalMessage("duplicate_policy_year")).toBe("Insurance for that year is already recorded. Edit it instead.");
    expect(refusalMessage("already_retired")).toBe("That building is already retired.");
    expect(refusalMessage("not_retired")).toBe("That building isn't retired.");
    expect(refusalMessage("already_paid_off")).toBe("That loan is already paid off.");
    expect(refusalMessage("not_paid_off")).toBe("That loan isn't paid off.");
    expect(refusalMessage("duplicate_appraisal_year", { assessedYear: 2024 })).toBe(
      "An appraisal for 2024 is already recorded for this building. Remove it first to record a corrected amount.",
    );
  });

  it("the gate strings are the existing ones", () => {
    expect(GATE_COPY.signedOut).toBe("You must be signed in to do that.");
    expect(GATE_COPY.noAccess).toBe("You don't have access to that organization.");
  });

  it("validation messages interpolate the injected year, never a clock", () => {
    expect(VALIDATION.yearOrganizedRange(2031)).toBe("Year organized must be between 1600 and 2031.");
    expect(VALIDATION.yearRange("First addition", 2031)).toBe("First addition must be between 1600 and 2031.");
    expect(VALIDATION.assessedYearRange(2031)).toBe("Year assessed must be between 1600 and 2031.");
    expect(VALIDATION.policyYearRange(2032)).toBe("Policy year must be between 1900 and 2032.");
    expect(VALIDATION.notesTooLong(4000)).toBe("Notes must be 4000 characters or fewer.");
    expect(VALIDATION.balanceDateStale).toBe('Update the "as of" date for the new balance.');
  });

  it("no string contains a claim the accepted residuals deny, or a word the design forbids", () => {
    const forbidden = [/everything is recorded/i, /nothing is kept/i, /never deleted/i, /\bonly\b[^.]*\bcan see\b/i, /\bonly\b[^.]*\bsees\b/i];
    for (const text of catalog()) for (const re of forbidden) expect(text, text).not.toMatch(re);
  });

  it("no string leaks database vocabulary or an internal key", () => {
    const leaks = [/constraint/i, /sqlstate/i, /postgres/i, /violat/i, /row_version/i, /\bsql\b/i, /congregation_oversight\./i, /\bid\b/];
    for (const text of catalog()) for (const re of leaks) expect(text, text).not.toMatch(re);
  });

  it("the Locked strings are shared across the sections that use them, and name their own permission", () => {
    expect(STATE.lockedManage).toBe(
      "You need permission to manage congregation oversight. An administrator can give it under Roles.",
    );
    expect(STATE.lockedFinance).toBe(
      "You need permission to manage congregation property finances. An administrator can give it under Roles.",
    );
    expect(STATE.lockedManage).not.toBe(STATE.lockedFinance);
    expect(STATE.lockedBadge).toBe("Locked");
  });

  it("the empty states say 'recorded' about what is not, never 'No loans.'", () => {
    expect(STATE.emptyLoans).toBe("No loans are recorded for this congregation.");
    expect(STATE.emptyBuildings).toBe("No buildings are recorded for this congregation.");
    expect(STATE.emptyInsurance).toBe("No insurance is recorded for this congregation.");
    expect(STATE.emptyAppraisals).toBe("No appraisal is recorded for this building.");
    expect(STATE.emptyProfile).toBe("Nothing is recorded in the profile yet.");
  });

  it("the managed note names what is known and does not claim the copies agree", () => {
    expect(STATE.managedNote).toContain("can keep its own profile there");
    expect(STATE.managedNote).toContain("does not change theirs, and theirs does not change it");
    expect(STATE.managedNote).not.toMatch(/has a profile|agree|in sync|synced/i);
  });

  it("the toasts are the design's", () => {
    expect(TOAST.noChanges).toBe("No changes to save.");
    expect(TOAST.assessmentSaved).toBe("Oversight record saved.");
    expect(TOAST.loanReopened).toBe("Loan reopened.");
    expect(TOAST.buildingReinstated).toBe("Building brought back into use.");
  });
});

describe("C14: building photos", () => {
  it("every refusal kind has its Copy string, verbatim", () => {
    expect(PHOTO_REFUSAL.unsupported_type).toBe(
      "That file isn't a JPEG, PNG or WebP picture. If it's an iPhone photo, pick it from your photo library or convert it to JPEG first.",
    );
    expect(PHOTO_REFUSAL.animated).toBe("Animated pictures aren't supported. Choose a still picture.");
    expect(PHOTO_REFUSAL.too_many_pixels).toBe("That picture is too large to process. Try a smaller one.");
    expect(PHOTO_REFUSAL.too_large).toBe("That picture is too big to upload. Try a smaller one.");
    expect(PHOTO_REFUSAL.unreadable).toBe("We couldn't read that picture. Try a different file.");
    expect(PHOTO_REFUSAL.empty).toBe("That file is empty.");
    expect(PHOTO_REFUSAL.duplicate).toBe("That picture is already in this building's photos.");
    expect(PHOTO_REFUSAL.cap_reached).toBe("This building already has 10 photos. Remove one to add another.");
    expect(PHOTO_REFUSAL.already_removed).toBe("That photo was already removed.");
    expect(PHOTO_REFUSAL.save_failed).toBe("We couldn't save that photo. Nothing was changed. Try again.");
    expect(photoRefusalMessage("not_found")).toBe(REFUSAL.not_found);
    expect(photoRefusalMessage("forbidden")).toBe(REFUSAL.forbidden);
    expect(photoRefusalMessage("building_removed")).toBe(REFUSAL.building_removed);
  });

  it("the cap in the cap_reached string is the cap the store enforces", () => {
    expect(PHOTO_REFUSAL.cap_reached).toContain(` ${LIMITS.photoCap} photos`);
  });

  it("the page, dialog, toast and caption strings are the design's", () => {
    expect(PHOTO_COPY.blockHeading).toBe("Photos");
    expect(PHOTO_COPY.addPhoto).toBe("Add a photo");
    expect(PHOTO_COPY.allPhotos(3)).toBe("All photos (3)");
    expect(PHOTO_COPY.pageTitle("Main sanctuary")).toBe("Photos of Main sanctuary");
    expect(PHOTO_COPY.backToBuilding("Main sanctuary")).toBe("Back to Main sanctuary");
    expect(PHOTO_COPY.viewLarger(null)).toBe("View larger: photo");
    expect(PHOTO_COPY.viewLarger("The front steps")).toBe("View larger: The front steps");
    expect(PHOTO_COPY.editCaption).toBe("Edit caption");
    expect(PHOTO_COPY.captionLabel).toBe("Caption (optional)");
    expect(PHOTO_COPY.makeCover).toBe("Make this the cover");
    expect(PHOTO_COPY.removePhoto).toBe("Remove photo");
    expect(PHOTO_COPY.backToAll).toBe("Back to all photos");
    expect(PHOTO_COPY.uploadFailed).toBe("That picture couldn't be uploaded. Check your connection, or try a smaller picture.");
    expect(PHOTO_COPY.removeDialog).toEqual({
      title: "Remove this photo?",
      body: "It will no longer be listed here. The picture file itself stays in storage and can't be erased from here.",
      confirm: "Remove photo",
      cancel: "Cancel",
    });
    expect(VALIDATION.captionTooLong).toBe("Caption must be 200 characters or fewer.");
    expect(LIMITS.captionMax).toBe(200);
    expect([TOAST.photoAdded, TOAST.captionSaved, TOAST.coverChanged, TOAST.photoRemoved]).toEqual([
      "Photo added.",
      "Caption saved.",
      "Cover changed.",
      "Photo removed.",
    ]);
  });

  it("the remove dialog states the residual in words: the file stays, it is not erased", () => {
    expect(PHOTO_COPY.removeDialog.body).toMatch(/stays in storage/);
    expect(PHOTO_COPY.removeDialog.body).toMatch(/can't be erased/);
    for (const text of Object.values(PHOTO_REFUSAL)) expect(text).not.toMatch(/deleted|erased permanently/i);
  });
});

describe("no sentence of its own outside copy.ts", () => {
  /** A literal that reads as a sentence: a capital, a space, and a terminal period or question mark. */
  const SENTENCE = /(["'`])[A-Z][^"'`\n]*\s[^"'`\n]*[.?]\1/;
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("the scan matches a sentence literal (a rule that stops matching fails, not passes)", () => {
    expect(SENTENCE.test('return { message: "We could not save that." };')).toBe(true);
    expect(SENTENCE.test("const m = `Enter the date.`;")).toBe(true);
    expect(SENTENCE.test('const k = "oversight_buildings_live_name_idx";')).toBe(false);
  });

  for (const file of ["validate.ts", "store.ts", "action-gate.ts", "reads.ts", "derive.ts", "photo-store.ts", "photo-reads.ts"]) {
    it(`${file} writes no user-facing sentence (it imports its strings from copy.ts)`, () => {
      const source = stripComments(readFileSync(path.join(__dirname, file), "utf8"));
      const hit = SENTENCE.exec(source);
      expect(hit?.[0] ?? null, `${file} contains a sentence literal`).toBeNull();
    });
  }
});
