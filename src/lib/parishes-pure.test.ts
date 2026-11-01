/**
 * The pure half of parish management (docs/work-log/2026-10-25-parish-
 * management.md, Phase 3 tag PURE): the district-name rule, the allowlist
 * parsers for the Unassigned page's URL state, and the household bucketing.
 * No database, no mocks.
 */
import { describe, expect, it } from "vitest";
import {
  BULK_MOVE_MAX,
  DISTRICT_NAME_MAX,
  MANAGEABLE_UNIT_TYPES,
  PARISH_ASSIGN_KEY,
  SEAT_ONLY_PERMISSION_KEYS,
  UNASSIGNED_GROUPS,
  bucketForConnections,
  districtNameFormSchema,
  isSeatOnlyPermissionKey,
  normalizeDistrictName,
  parseHide,
  parsePage,
  serializeHide,
} from "./parishes-pure";
import type { Connection } from "./community-labels";

describe("constants", () => {
  it("pin the design numbers", () => {
    expect(BULK_MOVE_MAX).toBe(100);
    expect(DISTRICT_NAME_MAX).toBe(80);
    expect([...MANAGEABLE_UNIT_TYPES]).toEqual(["district", "parish"]);
    expect([...UNASSIGNED_GROUPS]).toEqual(["members", "participants", "visitors", "others"]);
  });

  it("parishes.assign is the one seat-only key", () => {
    expect([...SEAT_ONLY_PERMISSION_KEYS]).toEqual([PARISH_ASSIGN_KEY]);
    expect(isSeatOnlyPermissionKey("parishes.assign")).toBe(true);
    expect(isSeatOnlyPermissionKey("people.manage")).toBe(false);
    expect(isSeatOnlyPermissionKey("roll.approve")).toBe(false);
  });
});

describe("normalizeDistrictName", () => {
  it("trims, collapses whitespace runs (tabs and newlines included) and NFC-normalizes", () => {
    expect(normalizeDistrictName("  North \t  District\n")).toEqual({ ok: true, name: "North District" });
    // "e" + combining acute becomes the single precomposed character.
    expect(normalizeDistrictName("Cafe\u0301 District")).toEqual({ ok: true, name: "Caf\u00E9 District" });
  });

  it("strips control and zero-width characters", () => {
    expect(normalizeDistrictName("No\u200Brth\u2060 Dis\uFEFFtrict\u0007")).toEqual({ ok: true, name: "North District" });
    expect(normalizeDistrictName("\u0000a\u009Fb")).toEqual({ ok: true, name: "ab" });
  });

  it("normalizeDistrictName returns NFC text after stripping zero-width characters (QA run 1, Finding 2)", () => {
    expect(normalizeDistrictName("Cafe\u200B\u0301 District")).toEqual({ ok: true, name: "Caf\u00E9 District" });
    // Each invisible or control character placed between a base letter and a
    // combining mark: stripping them joins the pair, so the result must be
    // composed AFTER the strip.
    for (const between of ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF", "\u0007", "\u009F"]) {
      const result = normalizeDistrictName(`Cafe${between}\u0301 District`);
      expect(result.ok, JSON.stringify(between)).toBe(true);
      if (!result.ok) continue;
      expect(result.name, JSON.stringify(between)).toBe(result.name.normalize("NFC"));
      expect(result.name, JSON.stringify(between)).toBe("Caf\u00E9 District");
    }
  });

  it("refuses an empty result as `empty` (blank, whitespace-only, only invisible characters, not a string)", () => {
    for (const raw of ["", "   ", "\u200B\u200C\u200D", "\n\t", undefined, null, 42]) {
      expect(normalizeDistrictName(raw), String(raw)).toEqual({ ok: false, reason: "empty" });
    }
  });

  it("accepts exactly 80 characters and refuses 81; counts characters, not UTF-16 units", () => {
    expect(normalizeDistrictName("a".repeat(80))).toEqual({ ok: true, name: "a".repeat(80) });
    expect(normalizeDistrictName("a".repeat(81))).toEqual({ ok: false, reason: "too_long" });
    // 80 astral characters are 160 UTF-16 units but 80 characters.
    expect(normalizeDistrictName("\u{1F33F}".repeat(80)).ok).toBe(true);
    expect(normalizeDistrictName("\u{1F33F}".repeat(81))).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses a 5,000-character name without cleaning it first", () => {
    expect(normalizeDistrictName("x".repeat(5000))).toEqual({ ok: false, reason: "too_long" });
  });

  it("is idempotent: the stored form normalizes to itself", () => {
    const once = normalizeDistrictName("  Mixed   Case \u200B Name ");
    if (!once.ok) throw new Error("expected ok");
    expect(normalizeDistrictName(once.name)).toEqual(once);
  });

  it("keeps case (uniqueness is the database's lower(name) index, not a rewrite here)", () => {
    expect(normalizeDistrictName("NORTH district")).toEqual({ ok: true, name: "NORTH district" });
  });
});

describe("districtNameFormSchema", () => {
  it("accepts a normal name and explains an empty or over-long one in the design's words", () => {
    expect(districtNameFormSchema.safeParse({ name: "North" }).success).toBe(true);
    const empty = districtNameFormSchema.safeParse({ name: "  " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe("Enter a name for the district.");
    const long = districtNameFormSchema.safeParse({ name: "x".repeat(81) });
    expect(long.error?.issues[0]?.message).toBe("Use 80 characters or fewer.");
  });
});

describe("parseHide / serializeHide", () => {
  it("parses an allowlisted comma list; unknown tokens are ignored; repeats collapse", () => {
    expect([...parseHide("members,visitors")].sort()).toEqual(["members", "visitors"]);
    expect([...parseHide("members,members, others ,bogus,__proto__,")].sort()).toEqual(["members", "others"]);
  });

  it("treats anything that is not a string (absent, array of strings uses the first) as the default", () => {
    expect(parseHide(undefined).size).toBe(0);
    expect(parseHide(null).size).toBe(0);
    expect(parseHide("").size).toBe(0);
    expect([...parseHide(["visitors", "members"])]).toEqual(["visitors"]);
  });

  it("a raw value never reaches a query branch: only the four allowlisted tokens can come out", () => {
    const parsed = parseHide("'; drop table households;--,members");
    expect([...parsed]).toEqual(["members"]);
  });

  it("serializes in canonical order, and null when nothing is hidden", () => {
    expect(serializeHide(new Set())).toBeNull();
    expect(serializeHide(new Set(["visitors", "members"] as const))).toBe("members,visitors");
    expect(serializeHide(parseHide("others,participants,members,visitors"))).toBe(
      "members,participants,visitors,others",
    );
  });
});

describe("parsePage", () => {
  it("accepts a positive integer and falls back to page 1 for everything else", () => {
    expect(parsePage("3")).toBe(3);
    for (const raw of [undefined, null, "", "0", "-2", "1.5", "abc", "1e3", "9999999", " 4"]) {
      expect(parsePage(raw as string | undefined), String(raw)).toBe(1);
    }
    expect(parsePage(["7", "2"])).toBe(7);
  });
});

describe("bucketForConnections - first match wins", () => {
  const b = (...c: Connection[]) => bucketForConnections(c);
  it("any member makes a Members household, whatever else is in it", () => {
    expect(b("member")).toBe("members");
    expect(b("visitor", "participant", "member")).toBe("members");
  });
  it("else any participant, else any visitor", () => {
    expect(b("participant", "visitor", "listed")).toBe("participants");
    expect(b("visitor", "listed", "staff")).toBe("visitors");
  });
  it("else Others: listed or staff only (and nobody at all)", () => {
    expect(b("listed")).toBe("others");
    expect(b("staff", "listed")).toBe("others");
    expect(b()).toBe("others");
  });
  it("a household of only inactive, moved-away, listed or staff people stays in Others (3a, EC-42)", () => {
    expect(b("inactive")).toBe("others");
    expect(b("moved_away")).toBe("others");
    expect(b("inactive", "moved_away", "listed", "staff")).toBe("others");
    expect(b("unclassified")).toBe("others");
  });
  it("an inactive person does not hide a visitor, a participant or a member in the same household", () => {
    expect(b("inactive", "visitor")).toBe("visitors");
    expect(b("moved_away", "participant")).toBe("participants");
    expect(b("inactive", "member")).toBe("members");
  });
  it("is exclusive: every combination lands in exactly one of the four groups", () => {
    const all: Connection[] = [
      "visitor",
      "participant",
      "member",
      "staff",
      "listed",
      "inactive",
      "moved_away",
      "unclassified",
    ];
    for (let mask = 0; mask < 1 << all.length; mask += 1) {
      const set = all.filter((_, i) => mask & (1 << i));
      expect(UNASSIGNED_GROUPS).toContain(bucketForConnections(set));
    }
  });
});
