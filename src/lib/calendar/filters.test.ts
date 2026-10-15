import { describe, expect, it } from "vitest";
import {
  MAX_TYPES_PARAM_CHARS,
  MAX_TYPES_PARAM_ENTRIES,
  buildCalendarHref,
  describeTypeFilter,
  isUuidShaped,
  parseTypesParam,
  parseViewParam,
  safeCalendarBackHref,
  sanitizeTypeFilter,
  toggleTypeSelection,
} from "./filters";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FOREIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("isUuidShaped", () => {
  it("accepts UUID shapes in either case and nothing else", () => {
    expect(isUuidShaped(A)).toBe(true);
    expect(isUuidShaped(A.toUpperCase())).toBe(true);
    expect(isUuidShaped("not-a-uuid")).toBe(false);
    expect(isUuidShaped("")).toBe(false);
    expect(isUuidShaped(`${A}x`)).toBe(false);
    expect(isUuidShaped(` ${A}`)).toBe(false);
    expect(isUuidShaped("1' or '1'='1")).toBe(false);
  });
});

describe("parseViewParam", () => {
  it("only 'list' is list", () => {
    expect(parseViewParam("list")).toBe("list");
    expect(parseViewParam("month")).toBe("month");
    expect(parseViewParam("LIST")).toBe("month");
    expect(parseViewParam(undefined)).toBe("month");
    expect(parseViewParam(["list", "month"])).toBe("list");
    expect(parseViewParam(["month", "list"])).toBe("month");
    expect(parseViewParam([])).toBe("month");
  });
});

describe("parseTypesParam", () => {
  it("keeps UUID-shaped tokens, lower-cased, de-duplicated, in order", () => {
    expect(parseTypesParam(`${B.toUpperCase()},${A},${B},junk,,${A}`)).toEqual([B, A]);
  });

  it("drops non-UUID tokens and a SQL-looking string", () => {
    expect(parseTypesParam("not-a-uuid,123")).toEqual([]);
    expect(parseTypesParam("1' or '1'='1; drop table events;--")).toEqual([]);
    expect(parseTypesParam(`${A}' or 1=1`)).toEqual([]);
  });

  it("uses the first element of an array and tolerates undefined / empty", () => {
    expect(parseTypesParam([A, B])).toEqual([A]);
    expect(parseTypesParam([])).toEqual([]);
    expect(parseTypesParam(undefined)).toEqual([]);
    expect(parseTypesParam("")).toEqual([]);
  });

  it("caps at 50 entries", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const parsed = parseTypesParam(many.join(","));
    expect(parsed).toHaveLength(MAX_TYPES_PARAM_ENTRIES);
    expect(parsed[0]).toBe(many[0]);
  });

  it("truncates to 2,000 characters before splitting", () => {
    const filler = "x".repeat(MAX_TYPES_PARAM_CHARS);
    // A valid id placed after the cutoff is never seen.
    expect(parseTypesParam(`${filler},${A}`)).toEqual([]);
    // A valid id before the cutoff is.
    expect(parseTypesParam(`${A},${filler}`)).toEqual([A]);
  });
});

describe("sanitizeTypeFilter", () => {
  const active = [A, B, C];

  it("keeps a proper subset of the active ids", () => {
    expect(sanitizeTypeFilter([A, B], active)).toEqual([A, B]);
  });

  it("drops another org's UUID-shaped id, and it does not count toward 'N active'", () => {
    expect(sanitizeTypeFilter([A, FOREIGN], active)).toEqual([A]);
    expect(sanitizeTypeFilter([FOREIGN], active)).toEqual([]);
    // Two requested, one foreign: only ONE is left, so the filter is a one-item list, not two.
    expect(sanitizeTypeFilter([FOREIGN, B], active)).toEqual([B]);
  });

  it("returns [] (All) when nothing valid remains", () => {
    expect(sanitizeTypeFilter([], active)).toEqual([]);
    expect(sanitizeTypeFilter([FOREIGN], active)).toEqual([]);
    expect(sanitizeTypeFilter([A], [])).toEqual([]);
  });

  it("returns [] (All) when the valid set covers every active type", () => {
    expect(sanitizeTypeFilter([C, B, A], active)).toEqual([]);
    expect(sanitizeTypeFilter([A, B, C, FOREIGN], active)).toEqual([]);
  });

  it("de-duplicates", () => {
    expect(sanitizeTypeFilter([A, A], active)).toEqual([A]);
  });
});

describe("toggleTypeSelection", () => {
  const active = [A, B, C];

  it("from All, a click starts a one-item list", () => {
    expect(toggleTypeSelection([], A, active)).toEqual([A]);
  });

  it("clicking a selected pill removes it; removing the last returns to All", () => {
    expect(toggleTypeSelection([A, B], A, active)).toEqual([B]);
    expect(toggleTypeSelection([A], A, active)).toEqual([]);
  });

  it("adding a pill extends the list", () => {
    expect(toggleTypeSelection([A], B, active)).toEqual([A, B]);
  });

  it("reaching every active type collapses to All", () => {
    expect(toggleTypeSelection([A, B], C, active)).toEqual([]);
  });

  it("with a single active type, the first click is already 'every type' so it stays All", () => {
    expect(toggleTypeSelection([], A, [A])).toEqual([]);
  });

  it("ignores an id that is not an active type", () => {
    expect(toggleTypeSelection([A], FOREIGN, active)).toEqual([A]);
    expect(toggleTypeSelection([], FOREIGN, active)).toEqual([]);
  });
});

describe("describeTypeFilter", () => {
  it("All -> null; one -> 'X only'; several -> 'N event types'", () => {
    expect(describeTypeFilter([])).toBeNull();
    expect(describeTypeFilter(["Worship"])).toBe("Worship only");
    expect(describeTypeFilter(["Worship", "Music"])).toBe("2 event types");
    expect(describeTypeFilter(["a", "b", "c"])).toBe("3 event types");
  });
});

describe("buildCalendarHref", () => {
  const oct = { year: 2026, month: 10 };

  it("omits month null, types [] and view month", () => {
    expect(buildCalendarHref("alder-creek", { month: null, types: [], view: "month" })).toBe(
      "/o/alder-creek/calendar",
    );
  });

  it("emits month, types, view in that order", () => {
    expect(
      buildCalendarHref("alder-creek", { month: oct, types: [A, B], view: "list" }),
    ).toBe(`/o/alder-creek/calendar?month=2026-10&types=${A},${B}&view=list`);
    expect(buildCalendarHref("alder-creek", { month: oct, types: [], view: "month" })).toBe(
      "/o/alder-creek/calendar?month=2026-10",
    );
    expect(buildCalendarHref("alder-creek", { month: null, types: [A], view: "month" })).toBe(
      `/o/alder-creek/calendar?types=${A}`,
    );
    expect(buildCalendarHref("alder-creek", { month: null, types: [], view: "list" })).toBe(
      "/o/alder-creek/calendar?view=list",
    );
  });

  it("zero-pads the month", () => {
    expect(
      buildCalendarHref("x", { month: { year: 2026, month: 3 }, types: [], view: "month" }),
    ).toBe("/o/x/calendar?month=2026-03");
  });
});

describe("safeCalendarBackHref", () => {
  const slug = "alder-creek";
  const DEFAULT = { href: "/o/alder-creek/calendar", label: "calendar" };

  it("accepts the portal home (label 'home')", () => {
    expect(safeCalendarBackHref(slug, "/o/alder-creek")).toEqual({
      href: "/o/alder-creek",
      label: "home",
    });
  });

  it("accepts the calendar, with or without a bounded query", () => {
    expect(safeCalendarBackHref(slug, "/o/alder-creek/calendar")).toEqual(DEFAULT);
    const withQuery = `/o/alder-creek/calendar?month=2026-10&types=${A},${B}&view=list`;
    expect(safeCalendarBackHref(slug, withQuery)).toEqual({
      href: withQuery,
      label: "calendar",
    });
    expect(safeCalendarBackHref(slug, "/o/alder-creek/calendar?")).toEqual({
      href: "/o/alder-creek/calendar?",
      label: "calendar",
    });
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/o/other/calendar",
    "/o/other",
    "/o/alder-creek/calendar/../admin",
    "/o/alder-creek/admin/roles",
    "/o/alder-creek/calendar#x",
    "/o/alder-creek/calendar?month=2026-10#x",
    "/o/alder-creek/calendar?x=\\evil",
    "/o/alder-creek/calendar?x=a b",
    "/o/alder-creek/calendar?x=<script>",
    "/o/alder-creek/calendarx",
    "/o/alder-creek/",
    "/o/alder-creek/calendar/abc",
    "",
    "javascript:alert(1)",
  ])("rejects %j -> the hardcoded default", (from) => {
    expect(safeCalendarBackHref(slug, from)).toEqual(DEFAULT);
  });

  it("rejects a query longer than 300 characters and accepts exactly 300", () => {
    expect(
      safeCalendarBackHref(slug, `/o/alder-creek/calendar?${"a".repeat(301)}`),
    ).toEqual(DEFAULT);
    const ok = `/o/alder-creek/calendar?${"a".repeat(300)}`;
    expect(safeCalendarBackHref(slug, ok).href).toBe(ok);
  });

  it("rejects non-strings", () => {
    expect(safeCalendarBackHref(slug, undefined)).toEqual(DEFAULT);
    expect(safeCalendarBackHref(slug, null)).toEqual(DEFAULT);
    expect(safeCalendarBackHref(slug, 42)).toEqual(DEFAULT);
    expect(safeCalendarBackHref(slug, ["/o/alder-creek"])).toEqual(DEFAULT);
    expect(safeCalendarBackHref(slug, {})).toEqual(DEFAULT);
  });
});
