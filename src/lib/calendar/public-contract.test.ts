import { describe, expect, it } from "vitest";
import {
  PUBLIC_CALENDAR_MAX_SPAN,
  PUBLIC_CALENDAR_MONTHS_AFTER,
  PUBLIC_CALENDAR_MONTHS_BEFORE,
  PUBLIC_CALENDAR_SLOT,
  parseCalendarFilter,
} from "./public-contract";

describe("parseCalendarFilter (the marker's filter is untrusted author JSON)", () => {
  it("honours exactly 'month' and 'list'", () => {
    expect(parseCalendarFilter({ view: "month" })).toEqual({ view: "month" });
    expect(parseCalendarFilter({ view: "list" })).toEqual({ view: "list" });
  });

  it("defaults to month for anything else and never throws", () => {
    const garbage: unknown[] = [
      undefined,
      null,
      "list",
      42,
      true,
      [],
      ["list"],
      {},
      { view: "List" },
      { view: " list" },
      { view: "grid" },
      { view: 1 },
      { view: null },
      { view: ["list"] },
      { view: { toString: () => "list" } },
      { filter: "list" },
      Object.create(null),
    ];
    for (const g of garbage) {
      expect(() => parseCalendarFilter(g)).not.toThrow();
      expect(parseCalendarFilter(g)).toEqual({ view: "month" });
    }
  });

  it("returns only the view key, ignoring every other key", () => {
    expect(
      Object.keys(parseCalendarFilter({ view: "list", types: ["x"], months: 99, __proto__: { view: "list" } })),
    ).toEqual(["view"]);
  });
});

describe("contract constants", () => {
  it("names the slot eventsCalendar and a 14-month window", () => {
    expect(PUBLIC_CALENDAR_SLOT).toBe("eventsCalendar");
    expect(PUBLIC_CALENDAR_MONTHS_BEFORE).toBe(1);
    expect(PUBLIC_CALENDAR_MONTHS_AFTER).toBe(12);
    expect(PUBLIC_CALENDAR_MAX_SPAN).toBe(14);
  });
});
