/**
 * U2: the half-open boundaries and the roster derivations (docs/work-log/
 * 2026-11-19-presbytery-committees.md, Phase 3 "Test plan"). Pure; `today` is
 * injected, so there are no fake timers.
 */
import { describe, expect, it } from "vitest";
import {
  chairNames,
  classifySeat,
  groupCommittees,
  orderSeats,
  personStatus,
  seatDatesText,
  seatsOverlap,
  splitRoster,
  type RosterSeat,
} from "./derive";

const TODAY = "2026-11-19";
const YESTERDAY = "2026-11-18";
const TOMORROW = "2026-11-20";

describe("classifySeat: the half-open boundaries", () => {
  it("ends_on = today is past (the first day it no longer applies)", () => {
    expect(classifySeat({ startsOn: "2025-01-01", endsOn: TODAY }, TODAY)).toBe("past");
  });

  it("ends_on = tomorrow is still serving", () => {
    expect(classifySeat({ startsOn: "2025-01-01", endsOn: TOMORROW }, TODAY)).toBe("serving");
  });

  it("starts_on = today is serving; starts_on = tomorrow is planned", () => {
    expect(classifySeat({ startsOn: TODAY, endsOn: null }, TODAY)).toBe("serving");
    expect(classifySeat({ startsOn: TOMORROW, endsOn: null }, TODAY)).toBe("planned");
  });

  it("an open seat that began long ago is serving; an ended one is past", () => {
    expect(classifySeat({ startsOn: "2010-01-01", endsOn: null }, TODAY)).toBe("serving");
    expect(classifySeat({ startsOn: "2010-01-01", endsOn: YESTERDAY }, TODAY)).toBe("past");
  });

  it("a zero-length seat served no day: past, whenever it is read (including a cancelled planned term)", () => {
    expect(classifySeat({ startsOn: TODAY, endsOn: TODAY }, TODAY)).toBe("past");
    expect(classifySeat({ startsOn: YESTERDAY, endsOn: YESTERDAY }, TODAY)).toBe("past");
    expect(classifySeat({ startsOn: TOMORROW, endsOn: TOMORROW }, TODAY)).toBe("past");
  });

  it("a planned seat with a planned end is planned until it starts", () => {
    expect(classifySeat({ startsOn: TOMORROW, endsOn: "2027-01-01" }, TODAY)).toBe("planned");
  });
});

describe("seatDatesText: the lines a seat shows", () => {
  it("serving: Since; with a planned end, Since and Ends", () => {
    expect(seatDatesText({ startsOn: "2025-01-01", endsOn: null }, TODAY)).toEqual([{ kind: "since", date: "2025-01-01" }]);
    expect(seatDatesText({ startsOn: "2025-01-01", endsOn: "2027-01-01" }, TODAY)).toEqual([
      { kind: "since", date: "2025-01-01" },
      { kind: "ends", date: "2027-01-01" },
    ]);
  });

  it("planned: Starts (and Ends when planned); past: Started and Ended; zero-length: the one line", () => {
    expect(seatDatesText({ startsOn: TOMORROW, endsOn: null }, TODAY)).toEqual([{ kind: "starts", date: TOMORROW }]);
    expect(seatDatesText({ startsOn: TOMORROW, endsOn: "2027-01-01" }, TODAY)).toEqual([
      { kind: "starts", date: TOMORROW },
      { kind: "ends", date: "2027-01-01" },
    ]);
    expect(seatDatesText({ startsOn: "2020-01-01", endsOn: TODAY }, TODAY)).toEqual([
      { kind: "started", date: "2020-01-01" },
      { kind: "ended", date: TODAY },
    ]);
    expect(seatDatesText({ startsOn: YESTERDAY, endsOn: YESTERDAY }, TODAY)).toEqual([{ kind: "zero_length" }]);
  });
});

describe("seatsOverlap: interval overlap on [starts_on, ends_on)", () => {
  const s = (startsOn: string, endsOn: string | null) => ({ startsOn, endsOn });

  it("adjacent seats do not overlap (a role change is one continuous stretch)", () => {
    expect(seatsOverlap(s("2025-01-01", "2026-01-01"), s("2026-01-01", "2027-01-01"))).toBe(false);
    expect(seatsOverlap(s("2026-01-01", "2027-01-01"), s("2025-01-01", "2026-01-01"))).toBe(false);
  });

  it("contained, partial and open-ended seats overlap", () => {
    expect(seatsOverlap(s("2025-01-01", "2028-01-01"), s("2026-01-01", "2027-01-01"))).toBe(true);
    expect(seatsOverlap(s("2025-01-01", "2026-06-01"), s("2026-01-01", "2027-01-01"))).toBe(true);
    expect(seatsOverlap(s("2025-01-01", null), s("2030-01-01", null))).toBe(true);
    expect(seatsOverlap(s("2025-01-01", null), s("2020-01-01", "2025-01-02"))).toBe(true);
    expect(seatsOverlap(s("2025-01-01", null), s("2020-01-01", "2025-01-01"))).toBe(false);
  });

  it("a back-dated seat before an open one does not overlap it when it ends first", () => {
    expect(seatsOverlap(s("2019-01-01", "2021-01-01"), s("2025-01-01", null))).toBe(false);
  });

  it("zero-length rows are ignored on either side", () => {
    expect(seatsOverlap(s("2026-01-01", "2026-01-01"), s("2025-01-01", null))).toBe(false);
    expect(seatsOverlap(s("2025-01-01", null), s("2026-01-01", "2026-01-01"))).toBe(false);
  });
});

const seat = (role: RosterSeat["role"], displayName: string, startsOn: string, endsOn: string | null = null): RosterSeat => ({
  role,
  displayName,
  startsOn,
  endsOn,
});

describe("orderSeats and splitRoster", () => {
  it("orders chair, leader, vice chair, clerk, secretary, ex officio, member, then name", () => {
    const ordered = orderSeats([
      seat("member", "Zed Aldridge", "2025-01-01"),
      seat("ex_officio", "Wren Halloway", "2025-01-01"),
      seat("member", "Abe Corwin", "2025-01-01"),
      seat("secretary", "Iris Bramblewood", "2025-01-01"),
      seat("clerk", "Odette Marsh", "2025-01-01"),
      seat("vice_chair", "Pell Ardmore", "2025-01-01"),
      seat("leader", "Tobias Fenwick", "2025-01-01"),
      seat("chair", "Maren Ostrander", "2025-01-01"),
    ]);
    expect(ordered.map((x) => x.role)).toEqual([
      "chair",
      "leader",
      "vice_chair",
      "clerk",
      "secretary",
      "ex_officio",
      "member",
      "member",
    ]);
    expect(ordered.slice(-2).map((x) => x.displayName)).toEqual(["Abe Corwin", "Zed Aldridge"]);
  });

  it("lists co-chairs both, in name order", () => {
    const seats = [seat("chair", "Wren Halloway", "2025-01-01"), seat("chair", "Corwin Aldridge", "2025-06-01"), seat("member", "Iris Bramblewood", "2025-01-01")];
    expect(chairNames(seats, TODAY)).toEqual(["Corwin Aldridge", "Wren Halloway"]);
  });

  it("chairNames ignores a chair whose term has ended or has not started", () => {
    const seats = [
      seat("chair", "Ended Chair", "2020-01-01", TODAY),
      seat("chair", "Later Chair", TOMORROW),
      seat("chair", "Serving Chair", "2025-01-01"),
      seat("vice_chair", "Not A Chair", "2025-01-01"),
    ];
    expect(chairNames(seats, TODAY)).toEqual(["Serving Chair"]);
    expect(chairNames([seat("chair", "Ended Chair", "2020-01-01", TODAY)], TODAY)).toEqual([]);
  });

  it("splits into serving, planned (soonest first) and past (latest end first); every seat in exactly one", () => {
    const seats = [
      seat("member", "A", "2025-01-01"),
      seat("member", "B", "2027-03-01"),
      seat("member", "C", "2027-01-01"),
      seat("member", "D", "2020-01-01", "2021-01-01"),
      seat("member", "E", "2022-01-01", "2024-01-01"),
      seat("member", "F", TODAY, TODAY),
      seat("member", "G", "2025-01-01", TOMORROW),
    ];
    const split = splitRoster(seats, TODAY);
    expect(split.serving.map((x) => x.displayName)).toEqual(["A", "G"]);
    expect(split.planned.map((x) => x.displayName)).toEqual(["C", "B"]);
    expect(split.past.map((x) => x.displayName)).toEqual(["F", "E", "D"]);
    expect(split.serving.length + split.planned.length + split.past.length).toBe(seats.length);
  });
});

describe("groupCommittees", () => {
  const c = (id: string, name: string, kind: "required" | "standing" | "ad_hoc" | null, dissolvedOn: string | null = null) => ({
    id,
    name,
    kind,
    dissolvedOn,
  });

  it("puts each committee in its kind's section, unlabelled ones in Not yet labelled, dissolved ones in Dissolved whatever their kind", () => {
    const sections = groupCommittees([
      c("1", "Nominating", "required"),
      c("2", "Finance", "standing"),
      c("3", "Camp study", "ad_hoc"),
      c("4", "Old", null),
      c("5", "Spring retreat", "ad_hoc", "2025-06-01"),
      c("6", "Ministry", "required"),
      c("7", "Gone required", "required", "2024-01-01"),
    ]);
    expect(sections.required.map((x) => x.name)).toEqual(["Ministry", "Nominating"]);
    expect(sections.standing.map((x) => x.name)).toEqual(["Finance"]);
    expect(sections.ad_hoc.map((x) => x.name)).toEqual(["Camp study"]);
    expect(sections.unlabelled.map((x) => x.name)).toEqual(["Old"]);
    expect(sections.dissolved.map((x) => x.name)).toEqual(["Gone required", "Spring retreat"]);
  });

  it("an empty list has five empty sections", () => {
    expect(groupCommittees([])).toEqual({ required: [], standing: [], ad_hoc: [], unlabelled: [], dissolved: [] });
  });
});

describe("personStatus", () => {
  it("connected unless the membership here has ended; deceased when there is a date of death; both can be true", () => {
    expect(personStatus({ membershipEndedOn: null, dateOfDeath: null })).toEqual({ connected: true, deceased: false });
    expect(personStatus({ membershipEndedOn: "2025-01-01", dateOfDeath: null })).toEqual({ connected: false, deceased: false });
    expect(personStatus({ membershipEndedOn: null, dateOfDeath: "2025-01-01" })).toEqual({ connected: true, deceased: true });
    expect(personStatus({ membershipEndedOn: "2025-01-01", dateOfDeath: "2025-01-01" })).toEqual({ connected: false, deceased: true });
  });
});
