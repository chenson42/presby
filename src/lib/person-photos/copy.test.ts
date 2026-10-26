/**
 * U4: the server-side copy (docs/work-log/2026-10-26-person-photos-inc1.md,
 * Phase 3 Test Plan U4 and the four copy-truthfulness checks). Exhaustive over
 * `PhotoRefusal`; every string non-empty, emoji-free, and free of raw error text
 * or a placeholder; the removal strings carry the residual sentences the design
 * requires; the toggle description carries "up to a day"; and nothing claims
 * "adults only" (a null date of birth is an adult, so the product never says
 * all photos are of adults).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn() }));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" }, recordAudit: vi.fn() }));

import "@/lib/db/schema";
import { ORG_FEATURE_CATALOG } from "@/lib/org-features";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CONFIRM_COPY,
  CONSEQUENCE_COPY,
  DESIGNATE_COPY,
  DIRECTORY_LINES,
  EDIT_LINK_COPY,
  PAGE_COPY,
  UPLOAD_COPY,
  OFF_WARNING_FALLBACK,
  REFUSAL_COPY,
  REFUSALS_NAMING_PERSON,
  REUSED_COPY,
  UPLOAD_REJECTED_COPY,
  WEBSITE_LINES,
  listingConsentCopy,
  listingLine,
  offWarningCopy,
  refusalMessage,
} from "./copy";
import type { PhotoRefusal } from "./types";

/** Every PhotoRefusal literal, read from types.ts so a kind added there fails this test until it has a string. */
const TYPES = readFileSync(path.resolve(__dirname, "types.ts"), "utf8");
const KINDS = [...(TYPES.match(/export type PhotoRefusal =([\s\S]*?);/)![1]!.matchAll(/"([a-z_]+)"/g))].map((m) => m[1]!) as PhotoRefusal[];

const EMOJI = /\p{Extended_Pictographic}/u;
const RAW = /undefined|null|\[object|Error:|sqlstate|stack|\{[a-zA-Z]+\}|\$\{/i;

function allStrings(): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") out.push((v as (...a: string[]) => string)("Ada", "Ada"));
    else if (v && typeof v === "object") Object.values(v).forEach(add);
  };
  add(REFUSAL_COPY);
  add(REUSED_COPY);
  add(DIRECTORY_LINES);
  add(WEBSITE_LINES);
  add(CONSEQUENCE_COPY);
  add(OFF_WARNING_FALLBACK);
  add(PAGE_COPY);
  add(UPLOAD_COPY);
  add(DESIGNATE_COPY);
  add(CONFIRM_COPY);
  out.push(EDIT_LINK_COPY, listingConsentCopy("Ada"));
  out.push(UPLOAD_REJECTED_COPY, offWarningCopy(1).description, offWarningCopy(3).description, offWarningCopy(1).title);
  out.push(listingLine("Ada", []), listingLine("Ada", ["staff", "committee"]));
  return out;
}

describe("the refusal copy", () => {
  it("has exactly one string per PhotoRefusal kind, no more and no fewer", () => {
    expect(KINDS.length).toBe(15);
    expect(Object.keys(REFUSAL_COPY).sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)("%s: a non-empty sentence that ends cleanly", (kind) => {
    const text = refusalMessage(kind, "Ada");
    expect(text.length).toBeGreaterThan(8);
    expect(text).toMatch(/[.!?]$/);
  });

  it("the three strings that name the person are exactly the ones REFUSALS_NAMING_PERSON lists", () => {
    const naming = KINDS.filter((k) => refusalMessage(k, "Zelda").includes("Zelda"));
    expect([...naming].sort()).toEqual([...REFUSALS_NAMING_PERSON].sort());
  });

  it("every string in the module is non-empty, emoji-free, and carries no raw error text or unfilled placeholder", () => {
    const strings = allStrings();
    expect(strings.length).toBeGreaterThan(40);
    for (const text of strings) {
      expect(text.trim().length, text).toBeGreaterThan(0);
      expect(EMOJI.test(text), text).toBe(false);
      expect(RAW.test(text), text).toBe(false);
    }
  });

  it("reuses the existing generic strings verbatim", () => {
    expect(REUSED_COPY.signedOut).toBe("You must be signed in to do that.");
    expect(REUSED_COPY.noOrgAccess).toBe("You don't have access to that organization.");
    expect(REUSED_COPY.forbidden).toBe("You don't have permission to do that here.");
    expect(REFUSAL_COPY.forbidden("")).toBe(REUSED_COPY.forbidden);
  });
});

describe("the residuals are stated (G8, G9)", () => {
  it("removal says the file stays in storage and cannot be erased from here, and that a browser can keep a copy for up to a day", () => {
    expect(CONSEQUENCE_COPY.removeBase).toContain("The image file stays in storage and can't be erased from here.");
    expect(CONSEQUENCE_COPY.removeCaches).toContain("up to a day");
  });

  it("removing a website photo says search engines and web archives may keep copies that cannot be recalled", () => {
    expect(CONSEQUENCE_COPY.websiteCaches).toContain("up to a day");
    expect(CONSEQUENCE_COPY.websiteCaches).toContain("search engines or web archives");
    expect(CONSEQUENCE_COPY.websiteCaches).toContain("can't be recalled");
  });

  it("the toggle description (the catalog entry's) says 'up to a day' and that nothing is deleted", () => {
    const entry = ORG_FEATURE_CATALOG.find((e) => e.key === "org_portal.person_photos")!;
    expect(entry.description).toContain("up to a day");
    expect(entry.description).toContain("Nothing is deleted");
    expect(entry.description).toContain("including on your public website");
  });

  it("the off-warning says the same, for one photo and for several, and never claims erasure", () => {
    for (const n of [1, 5]) {
      const w = offWarningCopy(n);
      expect(w.description).toContain("up to a day");
      expect(w.description).toContain("Nothing is deleted");
      expect(w.description).not.toMatch(/erase|permanently|gone forever/i);
    }
    expect(OFF_WARNING_FALLBACK.description).toContain("up to a day");
    expect(OFF_WARNING_FALLBACK.title).toBe(offWarningCopy(1).title);
  });
});

describe("what the copy does not claim", () => {
  it("nothing says 'adults only' or that every photo is of an adult (a null date of birth is an adult)", () => {
    for (const text of allStrings()) {
      expect(text, text).not.toMatch(/adults? only|only adults|all (of )?our adults/i);
    }
    const entry = ORG_FEATURE_CATALOG.find((e) => e.key === "org_portal.person_photos")!;
    expect(entry.description).not.toMatch(/adults? only|only adults/i);
  });

  it("says 'appears to be under 18' (the predicate includes a birth-year-only ambiguity), never 'is a minor'", () => {
    for (const text of [REFUSAL_COPY.minor("Ada"), DIRECTORY_LINES.minor("Ada"), WEBSITE_LINES.minor("Ada")]) {
      expect(text).toContain("appears to be under 18");
      expect(text).not.toMatch(/is a minor|is under 18/);
    }
  });

  it("describes hide_photo as a stored setting ('has hidden their photo'), not a promise the person can change it", () => {
    expect(DIRECTORY_LINES.hide("Ada")).toBe("Directory: not shown, because Ada has hidden their photo.");
    expect(WEBSITE_LINES.hide("Ada")).toBe("Website: not shown, because Ada has hidden their photo.");
  });

  it("the off-warning counts photos 'chosen for' the directory or the website, never 'shown'", () => {
    expect(offWarningCopy(2).description).toContain("currently chosen for the directory or the website");
    expect(offWarningCopy(2).description).not.toMatch(/currently (shown|showing)/i);
  });

  it("the listing lines say 'listed', never 'showing now' (site status and the platform flags are not read)", () => {
    for (const text of [listingLine("Ada", []), listingLine("Ada", ["officer"])]) {
      expect(text).not.toMatch(/showing now|currently showing|is showing/i);
    }
  });

  it("the duplicate refusal speaks only of the same person's own photos (no oracle on another person's)", () => {
    expect(REFUSAL_COPY.duplicate("Ada")).toBe("That picture is already in Ada's photos.");
  });
});

describe("the UI copy (Batch 3: C2, C3, C4, C5, C7, C8)", () => {
  it("the website dialog states the standing residual: search engines and archives may keep copies that cannot be recalled", () => {
    expect(DESIGNATE_COPY.website.body).toContain("Search engines and web archives may keep copies");
    expect(DESIGNATE_COPY.website.body).toContain("can't recall them");
  });

  it("the upload helper says location information is not stored, and does not claim the original file is changed", () => {
    expect(UPLOAD_COPY.helper).toContain("stored without location information");
    expect(UPLOAD_COPY.helper).not.toMatch(/original/i);
  });

  it("the under-18 notice says 'appears to be under 18'", () => {
    expect(PAGE_COPY.minorNotice("Ada")).toContain("appears to be under 18");
  });

  it("the three listing dialogs' consent copy says a photo MAY be shown, names no permission, and gives no instruction", () => {
    const text = listingConsentCopy("Ada Lovelace");
    expect(text).toContain("Ada Lovelace's name and role");
    expect(text).toContain("A photo may be shown too");
    expect(text).toContain("including search engines and archival crawlers");
    expect(text).not.toMatch(/people\.manage|ask |go to |under Photos/i);
    expect(text).not.toMatch(/if one is on file/);
  });

  it("the page and the counter agree with the cap", () => {
    expect(PAGE_COPY.counter(3)).toBe("3 of 10 photos");
  });
});

/**
 * T3 (Phase 5 run 1 copy rulings, R-a3, R-a5, R-a6, R-a7, R-b2, R-b3): every
 * replacement string asserted VERBATIM, and every old string it replaced
 * asserted ABSENT, so a revert to the promise wording fails here by name.
 */
describe("the Phase 5 run 1 copy rulings (exact text)", () => {
  const UNLESS = "unless something withholds it, such as Ada hiding their photo or appearing to be under 18.";

  it("the consequence sentences say 'can appear ... while the website is published, unless ...' (R-a3)", () => {
    expect(CONSEQUENCE_COPY.directoryAlsoOnWebsite("Ada")).toBe(
      `Because Ada is listed on the public website and has no website photo, this photo can also appear there while the website is published, ${UNLESS}`,
    );
    expect(CONSEQUENCE_COPY.websiteListed("Ada")).toBe(
      `Ada is listed, so this photo can appear on the website while the website is published, ${UNLESS}`,
    );
  });

  it("the new withheld sentences (R-a3)", () => {
    expect(CONSEQUENCE_COPY.minorBlocked("Ada")).toBe(
      "Ada appears to be under 18, so a photo of Ada can't be chosen for the directory or the website yet.",
    );
    expect(CONSEQUENCE_COPY.directoryHidden("Ada")).toBe("Ada has hidden their photo, so the directory won't show this photo while that is so.");
    expect(CONSEQUENCE_COPY.websiteHidden("Ada")).toBe("Ada has hidden their photo, so the website won't show this photo while that is so.");
    expect(CONSEQUENCE_COPY.websiteMerged).toBe("This record was merged into another, so the website won't show this photo.");
    expect(CONSEQUENCE_COPY.removeIsWebsiteWithheld).toBe("It is also their website photo, which the website isn't showing at the moment.");
  });

  it("the directory dialog body names who sees it and carries the unless-clause (R-a5)", () => {
    expect(DESIGNATE_COPY.directory.body("Ada Lovelace", "Ada")).toBe(
      "Members who can see Ada Lovelace in the directory will see this photo instead of their initials, unless Ada has hidden their photo or appears to be under 18.",
    );
  });

  it("the two retroactive directory strings are conditional on who can see the person (R-a6)", () => {
    expect(CONSEQUENCE_COPY.directoryInitials("Ada")).toBe("Wherever Ada appears in the directory, their initials will show instead.");
    expect(CONSEQUENCE_COPY.removeIsDirectory("Ada")).toBe(
      "It is Ada's directory photo, so wherever Ada appears in the directory it will show initials instead.",
    );
  });

  it("the directory status lines are conditional on who can see the person; hide and minor are unchanged (R-a7)", () => {
    expect(DIRECTORY_LINES.shown("Ada")).toBe('Directory: members who can see Ada in the directory see the photo marked "Directory" below.');
    expect(DIRECTORY_LINES.none("Ada")).toBe("Directory: no photo chosen, so members who can see Ada in the directory see initials.");
    expect(DIRECTORY_LINES.hide("Ada")).toBe("Directory: not shown, because Ada has hidden their photo.");
    expect(DIRECTORY_LINES.minor("Ada")).toBe("Directory: not shown. Ada appears to be under 18, and photos of children aren't used yet.");
  });

  it("the unattested remedy names a control the page has (R-b3), and the control's label is the same words", () => {
    expect(WEBSITE_LINES.unattested).toBe(
      'Website: none. The directory photo isn\'t cleared for the website. Choose a website photo, or choose "Clear for website" on the photo marked "Directory".',
    );
    expect(PAGE_COPY.clearForWebsite).toBe("Clear for website");
    expect(WEBSITE_LINES.unattested).toContain(`"${PAGE_COPY.clearForWebsite}"`);
  });

  it("the clear dialog (R-b2): title, body with the standing residual, the directory checkbox verbatim, confirm", () => {
    expect(DESIGNATE_COPY.clear.title).toBe("Clear this photo for the website?");
    expect(DESIGNATE_COPY.clear.body("Ada")).toBe(
      "This is Ada's directory photo. Clearing it lets the public website use it too when Ada is listed and no website photo is chosen. Anyone on the internet can see a photo on the public website. Search engines and web archives may keep copies, and removing the photo later can't recall them.",
    );
    expect(DESIGNATE_COPY.clear.checkbox("Ada")).toBe(
      "I have Ada's permission to also use this photo on the public website if they are listed there and no website photo is chosen.",
    );
    expect(DESIGNATE_COPY.clear.checkbox("Ada")).toBe(DESIGNATE_COPY.directory.checkbox("Ada"));
    expect(DESIGNATE_COPY.clear.confirm).toBe("Clear for website");
  });

  it("the old strings are gone (as of 0df93af: copy.ts:98, 99, 108-109, 142, 149, 154, 166, 219)", () => {
    const everything = allStrings().join("\n") + "\n" + DESIGNATE_COPY.directory.body("Ada Lovelace", "Ada");
    const OLD = [
      'Directory: members see the photo marked "Directory" below.',
      "Directory: no photo chosen, so members see initials.",
      "or clear the directory photo for the website.",
      "this photo will also appear there.",
      "so this photo will appear on the website.",
      "'s initials will show in the directory instead.",
      "'s directory photo, so the directory will show initials.",
      "will see this photo instead of their initials.",
    ];
    for (const old of OLD) expect(everything, old).not.toContain(old);
    expect(everything).not.toMatch(/will (also )?appear/);
  });
});
