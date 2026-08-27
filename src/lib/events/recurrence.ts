/**
 * Recurrence pattern utilities for generating recurring event dates.
 *
 * Ported near-verbatim from `~/git/fpcw-directory/src/lib/events/
 * recurrence.ts` (~200 lines of vanilla `Date` math, no dependency —
 * architect's Phase 2 ruling: no rrule/date library warranted). Kept in its
 * own module, out of `src/lib/events.ts`, so this pure-function pattern math
 * stays independently unit-testable without pulling in `server-only`/the
 * Neon pool — same split `officers.ts`/`db/domain/officers.ts` already model
 * for logic vs. schema (docs/work-log/2026-08-26-events-model.md, Phase 3).
 *
 * `recurrencePattern` strings generated/consumed here are a CONVENIENCE
 * GENERATION FORMAT ONLY — never parsed at read time by any other module
 * (DECISION-113 ruling 1). `src/lib/events.ts`'s `createEvent`/
 * `extendSeriesPattern` are the only two callers of `generateRecurringDates`.
 *
 * Patterns:
 * - Simple: "weekly", "biweekly", "monthly"
 * - Day-of-week: "1st Monday", "2nd Tuesday", "3rd Wednesday", "4th Thursday", "last Friday"
 */

export type SimplePattern = "weekly" | "biweekly" | "monthly";
export type Ordinal = "1st" | "2nd" | "3rd" | "4th" | "last";
export type DayOfWeek =
  | "Sunday"
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday";

export const SIMPLE_PATTERNS: SimplePattern[] = ["weekly", "biweekly", "monthly"];
export const ORDINALS: Ordinal[] = ["1st", "2nd", "3rd", "4th", "last"];
export const DAYS_OF_WEEK: DayOfWeek[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Pattern display labels for UI
 */
export const PATTERN_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly (same date)",
};

/**
 * DECISION-115: a series' TOTAL occurrence count (not a per-call limit) may
 * never exceed 52 — "about a year of weekly events," cheap to over-shoot
 * slightly without real cost, small enough a fat-fingered "repeat x5000" can
 * never happen. `createEvent`'s initial `recurrence.count` and
 * `extendSeriesPattern`'s `existingCount + additionalCount` are BOTH checked
 * against this same constant — a series cannot be grown past the cap through
 * repeated small extensions.
 */
export const MAX_SERIES_TOTAL = 52;

/**
 * Whether `totalCount` (an initial creation count, or an existing-plus-
 * additional extension total) is a legal series size: at least 1 and no more
 * than `MAX_SERIES_TOTAL`. Pure and DB-free so it is unit-testable directly,
 * independent of the `withOrgContext()` transaction `src/lib/events.ts`
 * wraps its own callers in.
 */
export function seriesTotalWithinCap(totalCount: number): boolean {
  return Number.isInteger(totalCount) && totalCount >= 1 && totalCount <= MAX_SERIES_TOTAL;
}

/**
 * Parse a recurrence pattern string into its components
 */
export function parsePattern(pattern: string): {
  type: "simple" | "dayofweek";
  value: SimplePattern | { ordinal: Ordinal; day: DayOfWeek };
} {
  if (SIMPLE_PATTERNS.includes(pattern as SimplePattern)) {
    return { type: "simple", value: pattern as SimplePattern };
  }

  // Try to parse day-of-week pattern (e.g., "2nd Monday")
  const match = pattern.match(/^(1st|2nd|3rd|4th|last)\s+(\w+)$/i);
  if (match) {
    const ordinal = match[1].toLowerCase() as Ordinal;
    const day = match[2] as DayOfWeek;
    if (ORDINALS.includes(ordinal) && DAYS_OF_WEEK.includes(day)) {
      return { type: "dayofweek", value: { ordinal, day } };
    }
  }

  throw new Error(`Invalid recurrence pattern: ${pattern}`);
}

/**
 * Get the day of week index (0 = Sunday, 6 = Saturday)
 */
function getDayIndex(day: DayOfWeek): number {
  return DAYS_OF_WEEK.indexOf(day);
}

/**
 * Get the Nth occurrence of a day of week in a given month
 * @param year The year
 * @param month The month (0-indexed)
 * @param dayOfWeek The day of week (0 = Sunday, 6 = Saturday)
 * @param nth Which occurrence (1-4) or -1 for last
 * @returns Date of the Nth occurrence
 */
function getNthDayOfMonth(
  year: number,
  month: number,
  dayOfWeek: number,
  nth: number,
): Date {
  if (nth === -1) {
    // Find last occurrence
    // Start from end of month and work backwards
    const lastDay = new Date(year, month + 1, 0);
    const lastDayOfWeek = lastDay.getDay();
    let daysBack = lastDayOfWeek - dayOfWeek;
    if (daysBack < 0) daysBack += 7;
    return new Date(year, month, lastDay.getDate() - daysBack);
  }

  // Find first occurrence of the day in the month
  const firstOfMonth = new Date(year, month, 1);
  const firstDayOfWeek = firstOfMonth.getDay();
  let daysForward = dayOfWeek - firstDayOfWeek;
  if (daysForward < 0) daysForward += 7;

  // Calculate the Nth occurrence
  const day = 1 + daysForward + (nth - 1) * 7;
  const result = new Date(year, month, day);

  // Verify we're still in the same month
  if (result.getMonth() !== month) {
    throw new Error(`No ${nth}th occurrence of day ${dayOfWeek} in month ${month}`);
  }

  return result;
}

/**
 * Generate the next occurrence date based on pattern
 */
export function getNextOccurrence(date: Date, pattern: string): Date {
  const parsed = parsePattern(pattern);

  if (parsed.type === "simple") {
    const next = new Date(date);

    switch (parsed.value) {
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "biweekly":
        next.setDate(next.getDate() + 14);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next;
  } else {
    // Day-of-week pattern
    const { ordinal, day } = parsed.value as { ordinal: Ordinal; day: DayOfWeek };
    const dayIndex = getDayIndex(day);
    const nthValue = ordinal === "last" ? -1 : parseInt(ordinal);

    // Start from next month
    let targetMonth = date.getMonth() + 1;
    let targetYear = date.getFullYear();
    if (targetMonth > 11) {
      targetMonth = 0;
      targetYear++;
    }

    // Get the Nth day of the target month
    const result = getNthDayOfMonth(targetYear, targetMonth, dayIndex, nthValue);

    // Preserve the time from the original date
    result.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());

    return result;
  }
}

/**
 * Generate multiple recurring dates starting from a start date
 */
export function generateRecurringDates(
  startDate: Date,
  pattern: string,
  count: number,
): Date[] {
  if (count < 1) return [];

  const dates: Date[] = [new Date(startDate)];

  let current = new Date(startDate);
  for (let i = 1; i < count; i++) {
    current = getNextOccurrence(current, pattern);
    dates.push(new Date(current));
  }

  return dates;
}

/**
 * Format a pattern for display
 */
export function formatPattern(pattern: string): string {
  if (PATTERN_LABELS[pattern]) {
    return PATTERN_LABELS[pattern];
  }

  // Day-of-week patterns are already human-readable
  return pattern;
}

/**
 * Build a day-of-week pattern string from ordinal and day
 */
export function buildDayOfWeekPattern(ordinal: Ordinal, day: DayOfWeek): string {
  return `${ordinal} ${day}`;
}

/**
 * Check if an event is part of a recurring series
 */
export function isRecurringEvent(event: {
  parentEventId?: string | null;
  recurrencePattern?: string | null;
}): boolean {
  return !!(event.parentEventId || event.recurrencePattern);
}

/**
 * Check if an event is the parent (first instance) of a recurring series
 */
export function isParentEvent(event: {
  parentEventId?: string | null;
  recurrencePattern?: string | null;
}): boolean {
  return !!event.recurrencePattern && !event.parentEventId;
}

/**
 * Check if an event is a child instance of a recurring series
 */
export function isChildEvent(event: { parentEventId?: string | null }): boolean {
  return !!event.parentEventId;
}
