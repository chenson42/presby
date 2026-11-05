import { describe, expect, it } from "vitest";
import {
  daysBetween,
  mergeBlockoutRanges,
  overlapWindow,
  pickerWarnings,
  rangeCovers,
  sendPlan,
  summarizeSend,
  validateBlockoutRange,
  wallClockMs,
  windowsOverlap,
  type DraftToSend,
  type PickerFacts,
} from "./plan";

describe("overlapWindow", () => {
  it("treats a service with no end as two hours long", () => {
    const w = overlapWindow("2026-11-15T09:00", null);
    expect(w.endMs - w.startMs).toBe(2 * 60 * 60 * 1000);
    expect(overlapWindow("2026-11-15T09:00", undefined)).toEqual(w);
  });

  it("uses the real end when it is after the start, and the two-hour default when it is not", () => {
    const real = overlapWindow("2026-11-15T09:00", "2026-11-15T10:15");
    expect(real.endMs - real.startMs).toBe(75 * 60 * 1000);
    const same = overlapWindow("2026-11-15T09:00", "2026-11-15T09:00");
    expect(same.endMs - same.startMs).toBe(2 * 60 * 60 * 1000);
    const before = overlapWindow("2026-11-15T09:00", "2026-11-15T08:00");
    expect(before.endMs - before.startMs).toBe(2 * 60 * 60 * 1000);
  });

  it("is half-open: back-to-back services do not overlap; one minute of overlap does", () => {
    const a = overlapWindow("2026-11-15T09:00", "2026-11-15T10:00");
    const b = overlapWindow("2026-11-15T10:00", "2026-11-15T11:00");
    const c = overlapWindow("2026-11-15T09:59", "2026-11-15T11:00");
    expect(windowsOverlap(a, b)).toBe(false);
    expect(windowsOverlap(a, c)).toBe(true);
    expect(windowsOverlap(c, a)).toBe(true);
  });

  it("an 09:00 service with no end overlaps a service at 10:30, not one at 11:00", () => {
    const base = overlapWindow("2026-11-15T09:00", null);
    expect(windowsOverlap(base, overlapWindow("2026-11-15T10:30", null))).toBe(true);
    expect(windowsOverlap(base, overlapWindow("2026-11-15T11:00", null))).toBe(false);
  });

  it("does not depend on the process time zone (UTC fields only)", () => {
    expect(wallClockMs("2026-03-08T02:30")).toBe(Date.UTC(2026, 2, 8, 2, 30));
    expect(() => wallClockMs("2026-03-08 02:30")).toThrow();
  });
});

describe("pickerWarnings", () => {
  const clean: PickerFacts = {
    blockedOut: false,
    sameDayPositions: [],
    overlappingServices: [],
    declinedThisService: false,
    mayBeUnder18: false,
    qualified: true,
  };

  it("a clean candidate has no warnings and no info", () => {
    expect(pickerWarnings(clean, { serviceDate: "2026-11-15" })).toEqual({ warnings: [], info: [], qualified: true });
  });

  it("orders blocked out, same day, overlap, declined; the minor note is info, not a warning", () => {
    const out = pickerWarnings(
      {
        blockedOut: true,
        sameDayPositions: ["Drums"],
        overlappingServices: ["Evening prayer"],
        declinedThisService: true,
        mayBeUnder18: true,
        qualified: false,
      },
      { serviceDate: "2026-11-15" },
    );
    expect(out.warnings).toEqual([
      { kind: "blocked_out", date: "2026-11-15" },
      { kind: "same_day", position: "Drums" },
      { kind: "overlap", title: "Evening prayer" },
      { kind: "declined_this_service" },
    ]);
    expect(out.info).toEqual([{ kind: "may_be_under_18" }]);
    expect(out.qualified).toBe(false);
  });

  it("never refuses: every combination yields warnings, not an error (warn, never block)", () => {
    expect(() =>
      pickerWarnings({ ...clean, blockedOut: true, declinedThisService: true }, { serviceDate: "2026-11-15" }),
    ).not.toThrow();
  });
});

describe("validateBlockoutRange", () => {
  const today = "2026-11-10";

  it("accepts a range starting today, in the future, or already begun but not yet ended", () => {
    expect(validateBlockoutRange({ startsOn: "2026-11-10", endsOn: "2026-11-10" }, today)).toBeNull();
    expect(validateBlockoutRange({ startsOn: "2026-12-01", endsOn: "2026-12-08" }, today)).toBeNull();
    expect(validateBlockoutRange({ startsOn: "2026-11-01", endsOn: "2026-11-12" }, today)).toBeNull();
  });

  it("refuses an end before the start, a range wholly in the past, and a malformed or impossible date", () => {
    expect(validateBlockoutRange({ startsOn: "2026-12-05", endsOn: "2026-12-04" }, today)).toBe("end_before_start");
    expect(validateBlockoutRange({ startsOn: "2026-11-01", endsOn: "2026-11-09" }, today)).toBe("in_past");
    expect(validateBlockoutRange({ startsOn: "2026-13-01", endsOn: "2026-13-02" }, today)).toBe("invalid_date");
    expect(validateBlockoutRange({ startsOn: "tomorrow", endsOn: "2026-11-12" }, today)).toBe("invalid_date");
  });

  it("allows 366 days counting both ends and refuses 367", () => {
    expect(validateBlockoutRange({ startsOn: "2026-11-10", endsOn: "2027-11-10" }, today)).toBeNull();
    expect(validateBlockoutRange({ startsOn: "2026-11-10", endsOn: "2027-11-11" }, today)).toBe("too_long");
  });

  it("daysBetween is a plain difference", () => {
    expect(daysBetween("2026-11-10", "2026-11-10")).toBe(0);
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
  });
});

describe("mergeBlockoutRanges", () => {
  const e = (id: string, startsOn: string, endsOn: string) => ({ id, startsOn, endsOn });

  it("with nothing to join, returns the added range and absorbs nothing", () => {
    expect(mergeBlockoutRanges([e("a", "2026-12-01", "2026-12-03")], { startsOn: "2026-12-10", endsOn: "2026-12-12" })).toEqual({
      merged: { startsOn: "2026-12-10", endsOn: "2026-12-12" },
      absorbedIds: [],
    });
  });

  it("joins an overlapping range and a touching one (an end the day before a start)", () => {
    const overlap = mergeBlockoutRanges([e("a", "2026-12-01", "2026-12-05")], { startsOn: "2026-12-04", endsOn: "2026-12-08" });
    expect(overlap.merged).toEqual({ startsOn: "2026-12-01", endsOn: "2026-12-08" });
    const touching = mergeBlockoutRanges([e("a", "2026-12-01", "2026-12-05")], { startsOn: "2026-12-06", endsOn: "2026-12-08" });
    expect(touching.merged).toEqual({ startsOn: "2026-12-01", endsOn: "2026-12-08" });
    expect(touching.absorbedIds).toEqual(["a"]);
  });

  it("does not join a range one clear day away", () => {
    const apart = mergeBlockoutRanges([e("a", "2026-12-01", "2026-12-05")], { startsOn: "2026-12-07", endsOn: "2026-12-08" });
    expect(apart.absorbedIds).toEqual([]);
  });

  it("a range that bridges two existing ranges absorbs both", () => {
    const out = mergeBlockoutRanges(
      [e("a", "2026-12-01", "2026-12-03"), e("b", "2026-12-08", "2026-12-10"), e("far", "2027-02-01", "2027-02-02")],
      { startsOn: "2026-12-03", endsOn: "2026-12-08" },
    );
    expect(out.merged).toEqual({ startsOn: "2026-12-01", endsOn: "2026-12-10" });
    expect(out.absorbedIds.sort()).toEqual(["a", "b"]);
  });

  it("a range that contains an existing one absorbs it and keeps its own bounds", () => {
    const out = mergeBlockoutRanges([e("a", "2026-12-03", "2026-12-04")], { startsOn: "2026-12-01", endsOn: "2026-12-09" });
    expect(out.merged).toEqual({ startsOn: "2026-12-01", endsOn: "2026-12-09" });
    expect(out.absorbedIds).toEqual(["a"]);
  });

  it("rangeCovers is inclusive at both ends", () => {
    const r = { startsOn: "2026-12-01", endsOn: "2026-12-03" };
    expect(rangeCovers(r, "2026-12-01")).toBe(true);
    expect(rangeCovers(r, "2026-12-03")).toBe(true);
    expect(rangeCovers(r, "2026-12-04")).toBe(false);
    expect(rangeCovers(r, "2026-11-30")).toBe(false);
  });
});

describe("sendPlan", () => {
  const draft = (n: number, personId: string, eventId: string, startsAt: string, positionName: string): DraftToSend => ({
    assignmentId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    eventId,
    personId,
    startsAt,
    positionName,
    teamName: "Praise band",
  });

  it("groups by person (one email per person), orders each person's lines by start then position", () => {
    const plan = sendPlan([
      draft(1, "p2", "e1", "2026-11-15T09:00", "Keys"),
      draft(2, "p1", "e2", "2026-11-22T09:00", "Drums"),
      draft(3, "p1", "e1", "2026-11-15T09:00", "Vocals"),
      draft(4, "p1", "e1", "2026-11-15T09:00", "Bass"),
    ]);
    expect(plan.people.map((p) => p.personId)).toEqual(["p1", "p2"]);
    expect(plan.people[0]!.items.map((i) => i.positionName)).toEqual(["Bass", "Vocals", "Drums"]);
    expect(plan.total).toBe(4);
    expect(plan.services).toBe(2);
    expect(plan.overAssignmentCap).toBe(false);
    expect(plan.overServiceCap).toBe(false);
  });

  it("is deterministic regardless of input order", () => {
    const a = [draft(1, "p1", "e1", "2026-11-15T09:00", "A"), draft(2, "p2", "e1", "2026-11-15T09:00", "B")];
    expect(sendPlan(a)).toEqual(sendPlan([...a].reverse()));
  });

  it("flags 201 assignments and 53 services as over their caps, and exactly 200 and 52 as within them", () => {
    const many = (count: number, services: number) =>
      Array.from({ length: count }, (_, i) =>
        draft(i + 1, `p${i % 50}`, `e${i % services}`, `2026-11-${String(10 + (i % services % 18)).padStart(2, "0")}T09:00`, `Pos${i}`),
      );
    expect(sendPlan(many(200, 5)).overAssignmentCap).toBe(false);
    expect(sendPlan(many(201, 5)).overAssignmentCap).toBe(true);
    expect(sendPlan(many(60, 52)).overServiceCap).toBe(false);
    expect(sendPlan(many(60, 53)).overServiceCap).toBe(true);
  });

  it("an empty send is an empty plan", () => {
    expect(sendPlan([])).toEqual({ people: [], total: 0, services: 0, overAssignmentCap: false, overServiceCap: false });
  });
});

describe("summarizeSend", () => {
  it("counts people by outcome and sums the ones who cannot be emailed", () => {
    expect(summarizeSend(["emailed", "emailed", "guardian", "no_address", "no_address", "do_not_contact"])).toEqual({
      emailed: 2,
      guardian: 1,
      noAddress: 2,
      doNotContact: 1,
      notEmailed: 4,
    });
    expect(summarizeSend([])).toEqual({ emailed: 0, guardian: 0, noAddress: 0, doNotContact: 0, notEmailed: 0 });
  });
});
