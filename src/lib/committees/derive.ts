/**
 * Pure derivations over committee rows (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 3 "Module and file plan", T2, T4, T5, T15). No database,
 * no clock: `today` is the ORGANIZATION'S local calendar day (`YYYY-MM-DD`),
 * injected by the reader, so a boundary test needs no fake timers.
 *
 * HALF-OPEN DATES. Every end-like date is the first day the thing no longer
 * applies, as the resolver, reimbursement and worship read them: `ends_on > today`
 * means serving, `ends_on = today` means ended. A zero-length seat
 * (`ends_on = starts_on`) served no day: it is PAST, whenever it is read, and
 * history shows it as "Ended the day it started".
 *
 * Date strings compare lexically (`YYYY-MM-DD`), never through `Date`.
 */
import { groupRoleSortRank, type GroupRoleValue } from "@/lib/group-roles";
import type { CommitteeKind } from "./contract";
import type { SeatDateLine } from "./copy";

/**
 * `iso` plus `years` calendar years, same month and day; 29 February clamps to
 * 28 February in a year that has none. Pure.
 */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = y + years;
  const lastDay = new Date(Date.UTC(target, m, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(target).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface SeatDates {
  startsOn: string;
  endsOn: string | null;
}

export type SeatState = "serving" | "planned" | "past";

/** `serving` (in date today), `planned` (starts later), or `past` (ended, or served no day). */
export function classifySeat(seat: SeatDates, today: string): SeatState {
  if (seat.endsOn !== null && seat.endsOn <= seat.startsOn) return "past";
  if (seat.endsOn !== null && seat.endsOn <= today) return "past";
  if (seat.startsOn > today) return "planned";
  return "serving";
}

/**
 * Do two seats of the same person overlap in time? Interval overlap on
 * `[starts_on, ends_on)` with a null end meaning "no set end". ADJACENT seats
 * (`[a,b)` and `[b,c)`) do not overlap, which is what makes a role change one
 * continuous stretch. A ZERO-LENGTH seat served no day and overlaps nothing.
 */
export function seatsOverlap(a: SeatDates, b: SeatDates): boolean {
  if (a.endsOn !== null && a.endsOn <= a.startsOn) return false;
  if (b.endsOn !== null && b.endsOn <= b.startsOn) return false;
  const aBeforeBEnds = b.endsOn === null || a.startsOn < b.endsOn;
  const bBeforeAEnds = a.endsOn === null || b.startsOn < a.endsOn;
  return aBeforeBEnds && bBeforeAEnds;
}

export interface RosterSeat extends SeatDates {
  role: GroupRoleValue;
  displayName: string;
}

/** Name order: case-insensitive, deterministic. */
export const compareNames = (a: string, b: string): number => a.localeCompare(b, "en", { sensitivity: "base" });
const byName = compareNames;

/** Role order (chair, leader, vice chair, clerk, secretary, ex officio, member), then name. */
export function orderSeats<S extends RosterSeat>(seats: readonly S[]): S[] {
  return [...seats].sort(
    (a, b) =>
      groupRoleSortRank(a.role) - groupRoleSortRank(b.role) ||
      byName(a.displayName, b.displayName) ||
      a.startsOn.localeCompare(b.startsOn),
  );
}

export interface SplitRoster<S> {
  serving: S[];
  planned: S[];
  past: S[];
}

/**
 * The roster's three sections: Serving now (role order), Starting later (soonest
 * first), Past members (most recently ended first). Every seat is in exactly one.
 */
export function splitRoster<S extends RosterSeat>(seats: readonly S[], today: string): SplitRoster<S> {
  const serving: S[] = [];
  const planned: S[] = [];
  const past: S[] = [];
  for (const seat of seats) {
    const state = classifySeat(seat, today);
    (state === "serving" ? serving : state === "planned" ? planned : past).push(seat);
  }
  const ordered = (list: S[]) => orderSeats(list);
  return {
    serving: ordered(serving),
    planned: ordered(planned).sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
    past: ordered(past).sort((a, b) => (b.endsOn ?? "").localeCompare(a.endsOn ?? "")),
  };
}

/** The names of the chairs serving today (co-chairs are both listed), in name order. */
export function chairNames(seats: readonly RosterSeat[], today: string): string[] {
  return seats
    .filter((s) => s.role === "chair" && classifySeat(s, today) === "serving")
    .map((s) => s.displayName)
    .sort(byName);
}

/**
 * The date lines a seat shows (C3), as pieces a page formats: a serving seat is
 * "Since {date}" (and "Ends {date}" when it has a planned end); a planned seat is
 * "Starts {date}" (and "Ends" when planned); a past seat is "Started {date}" and
 * "Ended {date}", or "Ended the day it started" when it served no day.
 */
export function seatDatesText(seat: SeatDates, today: string): SeatDateLine[] {
  const state = classifySeat(seat, today);
  if (seat.endsOn !== null && seat.endsOn <= seat.startsOn) return [{ kind: "zero_length" }];
  if (state === "past") {
    return [
      { kind: "started", date: seat.startsOn },
      { kind: "ended", date: seat.endsOn! },
    ];
  }
  const lines: SeatDateLine[] = [state === "planned" ? { kind: "starts", date: seat.startsOn } : { kind: "since", date: seat.startsOn }];
  if (seat.endsOn !== null) lines.push({ kind: "ends", date: seat.endsOn });
  return lines;
}

export interface ListedCommittee {
  id: string;
  name: string;
  kind: CommitteeKind | null;
  /** `YYYY-MM-DD` when dissolved, else null. */
  dissolvedOn: string | null;
}

export interface CommitteeSections<C> {
  required: C[];
  standing: C[];
  ad_hoc: C[];
  /** No details row, or a row with no kind. */
  unlabelled: C[];
  /** Dissolved, whatever their kind. */
  dissolved: C[];
}

/** The list's sections (C2): Required, Standing, Ad hoc, Not yet labelled and Dissolved, each in name order. */
export function groupCommittees<C extends ListedCommittee>(committees: readonly C[]): CommitteeSections<C> {
  const sections: CommitteeSections<C> = { required: [], standing: [], ad_hoc: [], unlabelled: [], dissolved: [] };
  for (const committee of committees) {
    if (committee.dissolvedOn !== null) sections.dissolved.push(committee);
    else if (committee.kind === null) sections.unlabelled.push(committee);
    else sections[committee.kind].push(committee);
  }
  const lists: C[][] = [sections.required, sections.standing, sections.ad_hoc, sections.unlabelled, sections.dissolved];
  for (const list of lists) list.sort((a, b) => byName(a.name, b.name) || a.id.localeCompare(b.id));
  return sections;
}

export interface PersonStatus {
  /** False when the person's membership at this presbytery has ended: the "No longer connected" badge. */
  connected: boolean;
  /** True when the person has a date of death: the "Recorded as deceased" badge. */
  deceased: boolean;
}

/** The two badges a seat can carry (C3), from the person's own records. */
export function personStatus(facts: { membershipEndedOn: string | null; dateOfDeath: string | null }): PersonStatus {
  return { connected: facts.membershipEndedOn === null, deceased: facts.dateOfDeath !== null };
}
