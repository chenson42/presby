import { describe, expect, it } from "vitest";
import {
  deriveListed,
  inheritedListing,
  planSeriesListing,
  type SeriesRow,
} from "./website-listing";

function row(
  id: string,
  startsAt: string,
  over: Partial<Omit<SeriesRow, "id" | "startsAt">> = {},
): SeriesRow {
  return {
    id,
    startsAt: new Date(`${startsAt}:00.000Z`),
    isPublic: true,
    websiteListed: false,
    cancelled: false,
    ...over,
  };
}

describe("deriveListed (F251: the stored value is never the posted value alone)", () => {
  it("is wanted AND isPublic", () => {
    expect(deriveListed(true, true)).toBe(true);
    expect(deriveListed(true, false)).toBe(false);
    expect(deriveListed(false, true)).toBe(false);
    expect(deriveListed(false, false)).toBe(false);
  });
});

describe("planSeriesListing", () => {
  const rows: SeriesRow[] = [
    row("a", "2027-01-03T10:00"),
    row("b", "2027-01-10T10:00"),
    row("c", "2027-01-17T10:00"),
    row("d", "2027-01-24T10:00"),
    row("e", "2027-01-31T10:00"),
  ];

  it("changes only the anchor and later rows, never earlier ones", () => {
    const plan = planSeriesListing(rows, "c", true);
    expect(plan.ids).toEqual(["c", "d", "e"]);
    expect(plan.unchanged).toBe(0);
    expect(plan.skippedCancelled).toBe(0);
    expect(plan.skippedMembersOnly).toBe(0);
  });

  it("includes the anchor itself and every row at the very same start", () => {
    const withTie = [...rows, row("c2", "2027-01-17T10:00")];
    expect(planSeriesListing(withTie, "c", true).ids.sort()).toEqual(["c", "c2", "d", "e"]);
  });

  it("is order-independent", () => {
    const shuffled = [rows[3]!, rows[0]!, rows[4]!, rows[2]!, rows[1]!];
    expect(planSeriesListing(shuffled, "c", true).ids.sort()).toEqual(["c", "d", "e"]);
  });

  it("skips and counts cancelled rows in either direction", () => {
    const mixed = [
      row("a", "2027-01-03T10:00"),
      row("b", "2027-01-10T10:00", { cancelled: true, websiteListed: true }),
      row("c", "2027-01-17T10:00", { cancelled: true }),
      row("d", "2027-01-24T10:00"),
    ];
    const put = planSeriesListing(mixed, "a", true);
    expect(put.ids).toEqual(["a", "d"]);
    expect(put.skippedCancelled).toBe(2);
    const take = planSeriesListing(mixed, "a", false);
    expect(take.skippedCancelled).toBe(2);
    expect(take.ids).toEqual([]);
    expect(take.unchanged).toBe(2);
  });

  it("when listing, skips and counts members-only rows; when unlisting they are just unchanged", () => {
    const mixed = [
      row("a", "2027-01-03T10:00"),
      row("b", "2027-01-10T10:00", { isPublic: false }),
      row("c", "2027-01-17T10:00"),
    ];
    const put = planSeriesListing(mixed, "a", true);
    expect(put.ids).toEqual(["a", "c"]);
    expect(put.skippedMembersOnly).toBe(1);
    const take = planSeriesListing(mixed, "a", false);
    expect(take.skippedMembersOnly).toBe(0);
    expect(take.ids).toEqual([]);
    expect(take.unchanged).toBe(3);
  });

  it("counts rows already in the target state as unchanged and leaves them out of ids", () => {
    const mixed = [
      row("a", "2027-01-03T10:00", { websiteListed: true }),
      row("b", "2027-01-10T10:00", { websiteListed: true }),
      row("c", "2027-01-17T10:00"),
    ];
    const put = planSeriesListing(mixed, "a", true);
    expect(put.ids).toEqual(["c"]);
    expect(put.unchanged).toBe(2);
    const take = planSeriesListing(mixed, "b", false);
    expect(take.ids).toEqual(["b"]);
    expect(take.unchanged).toBe(1);
  });

  it("returns an empty plan for an anchor that is not in the rows", () => {
    expect(planSeriesListing(rows, "zzz", true)).toEqual({
      ids: [],
      unchanged: 0,
      skippedCancelled: 0,
      skippedMembersOnly: 0,
    });
  });
});

describe("inheritedListing (F252: from the LATEST non-cancelled occurrence, never the parent alone)", () => {
  it("is false for an empty series", () => {
    expect(inheritedListing([])).toBe(false);
  });

  it("takes the latest non-cancelled occurrence, parent included", () => {
    const rows = [
      row("p", "2027-01-03T10:00", { websiteListed: true }),
      row("b", "2027-01-10T10:00", { websiteListed: true }),
      row("c", "2027-01-17T10:00", { websiteListed: false }),
    ];
    expect(inheritedListing(rows)).toBe(false);
    expect(inheritedListing([rows[0]!])).toBe(true);
  });

  it("ignores cancelled rows, even a later one", () => {
    const rows = [
      row("p", "2027-01-03T10:00", { websiteListed: true }),
      row("b", "2027-01-10T10:00", { websiteListed: false, cancelled: true }),
    ];
    expect(inheritedListing(rows)).toBe(true);
  });

  it("is false when every row is cancelled", () => {
    expect(
      inheritedListing([row("p", "2027-01-03T10:00", { websiteListed: true, cancelled: true })]),
    ).toBe(false);
  });
});
