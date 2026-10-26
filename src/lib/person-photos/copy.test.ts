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
  CONSEQUENCE_COPY,
  DIRECTORY_LINES,
  OFF_WARNING_FALLBACK,
  REFUSAL_COPY,
  REFUSALS_NAMING_PERSON,
  REUSED_COPY,
  UPLOAD_REJECTED_COPY,
  WEBSITE_LINES,
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
