import { addDays, isDayKey } from "@/lib/calendar/month";
import { LIMITS, type NoticeOutcome } from "./vocab";

/**
 * Scheduling arithmetic - docs/work-log/2026-11-04-worship-inc1.md, Phase 3
 * module layout (`plan.ts`). PURE: no `server-only`, no database, no `Intl`.
 *
 * Every time here is wall-clock TEXT ('YYYY-MM-DDTHH:mm', DECISION-113 ruling
 * 3): a label, not an instant. The only arithmetic is on the numeric fields
 * through `Date.UTC`, so nothing depends on the process time zone. The
 * organization's zone is used only by the database to decide what "now" is.
 */

// ---------------------------------------------------------------------------
// Overlap window
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

/** Milliseconds since the epoch of the wall-clock digits read as UTC. Not an instant. */
export function wallClockMs(wallClock: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wallClock);
  if (!match) throw new Error(`wallClockMs: expected 'YYYY-MM-DDTHH:mm', got ${JSON.stringify(wallClock)}`);
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, 0, 0);
}

export interface OverlapWindow {
  startMs: number;
  endMs: number;
}

/**
 * The span a service occupies for conflict checks. A service with no end is
 * treated as two hours long (`LIMITS.noEndServiceHours`); an end not after the
 * start gets the same default.
 */
export function overlapWindow(startsAt: string, endsAt: string | null | undefined): OverlapWindow {
  const startMs = wallClockMs(startsAt);
  const endMs = endsAt ? wallClockMs(endsAt) : Number.NaN;
  const fallback = startMs + LIMITS.noEndServiceHours * 60 * MINUTE_MS;
  return { startMs, endMs: Number.isFinite(endMs) && endMs > startMs ? endMs : fallback };
}

/** Half-open overlap: a service ending at 10:00 does not overlap one starting at 10:00. */
export function windowsOverlap(a: OverlapWindow, b: OverlapWindow): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

// ---------------------------------------------------------------------------
// Picker warnings
// ---------------------------------------------------------------------------

/** What the picker query knows about one candidate for one position on one service. */
export interface PickerFacts {
  /** The candidate has a live blockout covering the service's date. */
  blockedOut: boolean;
  /** Positions they already hold (non-withdrawn) on another service that same day, by position name. */
  sameDayPositions: readonly string[];
  /** Titles of OTHER services whose window overlaps this one, where they hold a live assignment. */
  overlappingServices: readonly string[];
  /** They declined a position on THIS service. */
  declinedThisService: boolean;
  /** Presumed under 18 (`presby_photo_subject_is_minor`): they will not get an email. */
  mayBeUnder18: boolean;
  /** They are marked as able to fill this position. */
  qualified: boolean;
}

export type PickerWarning =
  | { kind: "blocked_out"; date: string }
  | { kind: "same_day"; position: string }
  | { kind: "overlap"; title: string }
  | { kind: "declined_this_service" };

export type PickerInfo = { kind: "may_be_under_18" };

export interface PickerAssessment {
  /** Warn, never block (G6): the leader can always choose "Add anyway". */
  warnings: PickerWarning[];
  info: PickerInfo[];
  qualified: boolean;
}

/**
 * Turns the query's flags into the ordered warnings the picker shows. Never
 * refuses: scheduling someone against a warning is the leader's call, and the
 * database does not know about availability at all.
 */
export function pickerWarnings(facts: PickerFacts, ctx: { serviceDate: string }): PickerAssessment {
  const warnings: PickerWarning[] = [];
  if (facts.blockedOut) warnings.push({ kind: "blocked_out", date: ctx.serviceDate });
  for (const position of facts.sameDayPositions) warnings.push({ kind: "same_day", position });
  for (const title of facts.overlappingServices) warnings.push({ kind: "overlap", title });
  if (facts.declinedThisService) warnings.push({ kind: "declined_this_service" });
  return {
    warnings,
    info: facts.mayBeUnder18 ? [{ kind: "may_be_under_18" }] : [],
    qualified: facts.qualified,
  };
}

// ---------------------------------------------------------------------------
// Blockouts
// ---------------------------------------------------------------------------

export interface BlockoutRange {
  startsOn: string;
  endsOn: string;
}

export interface ExistingBlockout extends BlockoutRange {
  id: string;
}

export type BlockoutRangeProblem = "invalid_date" | "end_before_start" | "in_past" | "too_long";

/** Days from `a` to `b` (both 'YYYY-MM-DD'), inclusive of neither end: b - a. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The input rules for a new blockout (Copy G6 errors). A range may not end
 * before the organization's `today`, may not be longer than 366 days counting
 * both ends, and its end may not precede its start. The database repeats the
 * order, length and past rules (CHECKs and a trigger); this is the message.
 */
export function validateBlockoutRange(range: BlockoutRange, today: string): BlockoutRangeProblem | null {
  if (!isDayKey(range.startsOn) || !isDayKey(range.endsOn)) return "invalid_date";
  if (range.endsOn < range.startsOn) return "end_before_start";
  if (range.endsOn < today) return "in_past";
  if (daysBetween(range.startsOn, range.endsOn) > LIMITS.blockoutMaxDays - 1) return "too_long";
  return null;
}

/**
 * Joins a new range with every live range it overlaps or touches (an end on
 * the day before a start counts as touching). Returns the union to insert and
 * the ids of the rows it absorbs, which the store ends. Pure; the store does
 * the writes, so history is kept and nothing is deleted (DECISION-327).
 */
export function mergeBlockoutRanges(
  existing: readonly ExistingBlockout[],
  added: BlockoutRange,
): { merged: BlockoutRange; absorbedIds: string[] } {
  let startsOn = added.startsOn;
  let endsOn = added.endsOn;
  const absorbed = new Set<string>();
  // A union can bridge two previously separate ranges, so repeat until stable.
  let grew = true;
  while (grew) {
    grew = false;
    for (const range of existing) {
      if (absorbed.has(range.id)) continue;
      const touches = range.startsOn <= addDays(endsOn, 1) && addDays(range.endsOn, 1) >= startsOn;
      if (!touches) continue;
      absorbed.add(range.id);
      if (range.startsOn < startsOn) startsOn = range.startsOn;
      if (range.endsOn > endsOn) endsOn = range.endsOn;
      grew = true;
    }
  }
  return { merged: { startsOn, endsOn }, absorbedIds: [...absorbed] };
}

/** Whether `day` ('YYYY-MM-DD') falls inside a range (both ends inclusive). */
export function rangeCovers(range: BlockoutRange, day: string): boolean {
  return range.startsOn <= day && day <= range.endsOn;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface DraftToSend {
  assignmentId: string;
  eventId: string;
  personId: string;
  /** Wall-clock 'YYYY-MM-DDTHH:mm'. */
  startsAt: string;
  positionName: string;
  teamName: string;
}

export interface PersonRequests {
  personId: string;
  items: DraftToSend[];
}

export interface SendPlan {
  people: PersonRequests[];
  /** Total assignments across everyone. */
  total: number;
  /** Distinct services touched. */
  services: number;
  overAssignmentCap: boolean;
  overServiceCap: boolean;
}

/**
 * Groups drafts by person (one email per person per Send), orders each
 * person's lines by service start then position name, and reports whether the
 * Send is over a cap (`over_cap`: 200 assignments or 52 services). People are
 * ordered by their earliest service, then id, so the result is deterministic.
 */
export function sendPlan(drafts: readonly DraftToSend[]): SendPlan {
  const byPerson = new Map<string, DraftToSend[]>();
  for (const draft of drafts) {
    const list = byPerson.get(draft.personId);
    if (list) list.push(draft);
    else byPerson.set(draft.personId, [draft]);
  }
  const people: PersonRequests[] = [...byPerson.entries()].map(([personId, items]) => ({
    personId,
    items: [...items].sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) ||
        a.positionName.localeCompare(b.positionName) ||
        a.assignmentId.localeCompare(b.assignmentId),
    ),
  }));
  people.sort(
    (a, b) => a.items[0]!.startsAt.localeCompare(b.items[0]!.startsAt) || a.personId.localeCompare(b.personId),
  );
  const services = new Set(drafts.map((d) => d.eventId)).size;
  return {
    people,
    total: drafts.length,
    services,
    overAssignmentCap: drafts.length > LIMITS.sendMaxAssignments,
    overServiceCap: services > LIMITS.sendMaxServices,
  };
}

export interface SendSummary {
  /** People whose notice outcome is `emailed`. */
  emailed: number;
  guardian: number;
  noAddress: number;
  doNotContact: number;
  /** guardian + noAddress + doNotContact: the people who cannot be emailed. */
  notEmailed: number;
}

/** Counts of people by outcome (Copy G5, the Send dialog: "{x} can't be emailed ({y} ..., {z} ..., {w} ...)"). */
export function summarizeSend(outcomes: readonly NoticeOutcome[]): SendSummary {
  const summary: SendSummary = { emailed: 0, guardian: 0, noAddress: 0, doNotContact: 0, notEmailed: 0 };
  for (const outcome of outcomes) {
    if (outcome === "emailed") summary.emailed += 1;
    else if (outcome === "guardian") summary.guardian += 1;
    else if (outcome === "no_address") summary.noAddress += 1;
    else summary.doNotContact += 1;
  }
  summary.notEmailed = summary.guardian + summary.noAddress + summary.doNotContact;
  return summary;
}
