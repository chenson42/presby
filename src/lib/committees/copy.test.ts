/**
 * U3: the copy file's own properties (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 3 "Test plan" and "Copy"). Pure; no database. The
 * residual-denial list is the Phase 3 "Accepted residuals no string may deny".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Refusal } from "./contract";
import * as copy from "./copy";
import {
  carriesNote,
  carriesWarning,
  chairLine,
  dateText,
  dissolveCarries,
  GATE_COPY,
  PAGE_STATE,
  refusalMessage,
  REFUSAL,
  seatDateLineText,
  servingLine,
  TITLES_NOTE,
  TOAST,
  VALIDATION,
} from "./copy";

/** Every refusal kind, typed so a new `Refusal` member fails to compile here until it is listed. */
const ALL_REFUSALS: Record<Refusal, true> = {
  forbidden: true,
  not_found: true,
  seat_not_found: true,
  duplicate_name: true,
  overlap: true,
  not_a_member: true,
  committee_dissolved: true,
  already_dissolved: true,
  already_ended: true,
  same_role: true,
  date_before_start: true,
  stale: true,
  save_failed: true,
};

/** Every string the module can show, flattened (functions are called with sample values). */
function everyString(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      for (const arg of [[["Reviewer"]], ["Name", "Committee"], ["2026-11-19"], [3], ["Name"]]) {
        try {
          const r = (value as (...a: unknown[]) => unknown)(...(arg as unknown[]));
          if (typeof r === "string") out.push(r);
        } catch {
          /* a helper that does not take this shape */
        }
      }
    } else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(copy);
  for (const reason of Object.keys(ALL_REFUSALS) as Refusal[]) {
    out.push(refusalMessage(reason, { existingName: "Finance", personName: "Wren Halloway", committeeName: "Finance", date: "2026-11-01" }));
    out.push(refusalMessage(reason, { during: "edit" } as never));
  }
  out.push(...(carriesNote(["Property"]) ? [carriesNote(["Property"])!, carriesNote(["Property", "Finance"])!] : []));
  out.push(...[carriesWarning(["A"])!, carriesWarning(["A", "B"])!, dissolveCarries(["A"])!, dissolveCarries(["A", "B"])!]);
  return out;
}

describe("copy.ts (U3)", () => {
  it("every Refusal kind has a string", () => {
    for (const reason of Object.keys(ALL_REFUSALS) as Refusal[]) {
      const message = refusalMessage(reason, { existingName: "Finance", personName: "Wren", committeeName: "Finance", date: "2026-11-01" });
      expect(message, reason).toBeTruthy();
      expect(message.length, reason).toBeGreaterThan(8);
    }
  });

  it("the refusal strings are the Copy section's (C4, C5, C9)", () => {
    expect(REFUSAL.forbidden).toBe("You don't have permission to manage committees here.");
    expect(REFUSAL.not_found).toBe("That committee could not be found.");
    expect(REFUSAL.seat_not_found).toBe("That member could not be found.");
    expect(REFUSAL.already_dissolved).toBe("This committee has already been dissolved.");
    expect(REFUSAL.save_failed).toBe("We couldn't save that. Nothing was changed. Try again.");
    expect(GATE_COPY).toEqual({ signedOut: "You must be signed in to do that.", noAccess: "You don't have access to that organization." });
    expect(refusalMessage("duplicate_name", { existingName: "Finance Committee" })).toBe(
      'A committee named "Finance Committee" already exists. Choose a different name.',
    );
    expect(refusalMessage("overlap", { personName: "Wren Halloway", committeeName: "Finance Committee" })).toBe(
      'Wren Halloway already serves on Finance Committee during those dates. Use "Change role", or end that term first.',
    );
    expect(refusalMessage("committee_dissolved")).toBe("This committee has been dissolved, so no one can be added.");
    expect(refusalMessage("committee_dissolved", { during: "edit" })).toBe(
      "This committee was dissolved. A dissolved committee is kept as history and isn't edited here.",
    );
    expect(refusalMessage("date_before_start", { date: "2026-11-01" })).toBe(
      "A member started on Nov 1, 2026. The dissolve date can't be before that.",
    );
  });

  it("the two not_found strings are the only refusal strings that differ by object, and they name no id", () => {
    expect(REFUSAL.not_found).not.toBe(REFUSAL.seat_not_found);
    expect(REFUSAL.not_found).not.toMatch(/[0-9a-f]{8}-/);
    expect(REFUSAL.seat_not_found).not.toMatch(/[0-9a-f]{8}-/);
  });

  it("the titles note is the Copy section's, byte for byte", () => {
    expect(TITLES_NOTE).toBe("Chair, vice chair, clerk, secretary and ex officio are titles. A title doesn't give anyone access.");
  });

  it("the carries note, warning and dissolve sentence are the Copy section's", () => {
    expect(carriesNote([])).toBeNull();
    expect(carriesNote(["Property"])).toBe(
      "Everyone serving on this committee also holds the Property role, so adding someone here gives them that role's access.",
    );
    expect(carriesNote(["Property", "Finance"])).toBe(
      "Everyone serving on this committee also holds these roles: Property, Finance. Adding someone here gives them their access.",
    );
    expect(carriesWarning(["Property"])).toBe("This committee carries the Property role. Adding someone here also gives them that role's access.");
    expect(carriesWarning(["A", "B"])).toBe("This committee carries these roles: A, B. Adding someone here also gives them their access.");
    expect(dissolveCarries(["Property"])).toBe(
      "This committee carries the Property role. Dissolving it ends the access that comes from belonging to it.",
    );
    expect(copy.END_TERM_CARRIES).toBe("Ending the term also ends the access that comes from belonging to this committee.");
  });

  it("the validator messages are the Copy section's", () => {
    expect(VALIDATION.nameRequired).toBe("Name is required.");
    expect(VALIDATION.kindRequired).toBe("Choose Required, Standing or Ad hoc.");
    expect(VALIDATION.startTooFar).toBe("The start date can't be more than 5 years ahead.");
    expect(VALIDATION.endNotAfterStart).toBe("The end date has to be after the start date.");
    expect(VALIDATION.effectiveBeforeStart("2026-11-01")).toBe("The effective date can't be before Nov 1, 2026, when this role began.");
    expect(VALIDATION.effectiveNotBeforeEnd("2026-11-01")).toBe("The effective date has to be before this term ends on Nov 1, 2026.");
    expect(VALIDATION.dissolveFuture).toBe("The dissolve date can't be in the future.");
    expect(VALIDATION.endBeforeStart).toBe("The end date can't be before the start date.");
  });

  it("the list and roster lines are the Copy section's", () => {
    expect(chairLine([])).toBe("No chair serving");
    expect(chairLine(["A", "B"])).toBe("Chair: A, B");
    expect(servingLine(1)).toBe("1 serving");
    expect(seatDateLineText({ kind: "since", date: "x" }, "Jan 1, 2025")).toBe("Since Jan 1, 2025");
    expect(seatDateLineText({ kind: "zero_length" }, "")).toBe("Ended the day it started");
    expect(copy.END_CONTROL).toEqual({ serving: "End term", plannedEnd: "Change end date", notStarted: "Cancel planned term" });
    expect(copy.STATUS_BADGE.noLongerConnected).toBe("No longer connected to this presbytery");
    expect(copy.STATUS_BADGE.deceased).toBe("Recorded as deceased");
    expect(PAGE_STATE.forbidden("Northern Reach")).toBe(
      "You don't have permission to manage committees at Northern Reach. If you think this is a mistake, ask your presbytery's administrator.",
    );
    expect(TOAST.created).toBe("Committee created.");
    expect(TOAST.listed("Wren", "Ministry")).toBe("Wren is now listed publicly on Ministry's roster.");
  });

  it("dateText is the deterministic UTC day, never the machine's", () => {
    expect(dateText("2026-03-01")).toBe("Mar 1, 2026");
    expect(dateText("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("no date-field string says 'Last day' or 'the day before' (T2: every end-like date is the first day it no longer applies)", () => {
    for (const s of everyString()) {
      expect(s, s).not.toMatch(/last day/i);
      expect(s, s).not.toMatch(/the day before/i);
    }
  });

  it("no string denies a residual: no 'everyone can', 'no one else can see', 'nothing is kept' or 'can never happen'", () => {
    for (const s of everyString()) {
      expect(s, s).not.toMatch(/everyone can/i);
      expect(s, s).not.toMatch(/no one else can see/i);
      expect(s, s).not.toMatch(/nothing is kept/i);
      expect(s, s).not.toMatch(/can never happen/i);
      expect(s, s).not.toMatch(/can't be undone at all|cannot be undone at all/i);
    }
  });

  it("the titles note says titles give no access, and no string says membership gives none (residual 1)", () => {
    expect(TITLES_NOTE).toMatch(/titles/);
    for (const s of everyString()) expect(s, s).not.toMatch(/membership (gives|confers) no/i);
  });
});

describe("validate.ts and store.ts hold no user-facing sentence of their own (every message comes from copy.ts)", () => {
  const SENTENCE = /(["'`])[A-Z][A-Za-z'’ ,"]{18,}[.?]\1/;
  for (const file of ["validate.ts", "store.ts", "reads.ts", "action-gate.ts"]) {
    it(file, () => {
      const source = readFileSync(path.join(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(SENTENCE.exec(source)?.[0]).toBeUndefined();
    });
  }
});
