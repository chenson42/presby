const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `DirectoryEntry.dateOfBirth` is a full 'YYYY-MM-DD' string (nulled per
 * `person_privacy.hide_birthday`, whose default is TRUE — the most
 * restrictive of the five field flags). This renders month/day ONLY, never
 * the year: even when a member has explicitly unhidden their birthday, a
 * congregation directory's "wish someone a happy birthday" use case does not
 * need their age or exact birth year published alongside it, and the
 * heightened default-hidden posture on this one field is itself a signal
 * that presby should not go further than the design explicitly asks for. Not
 * mandated by the Phase 3 design text (which is silent on birthday display
 * format) — a UX decision, recorded here and in the work-log.
 *
 * A plain string function, not `<FormattedDate>`: the input is a bare
 * calendar date with no timezone to shift, so there is nothing for a
 * client-side hydration swap to correct — indexing the 'YYYY-MM-DD' string
 * directly (never `new Date(...)`, which reintroduces exactly the
 * timezone-parsing bug `<FormattedDate>`'s own header documents) produces an
 * identical string on the server and in the browser.
 */
export function formatBirthdayMonthDay(dateOfBirth: string): string {
  const [, monthStr, dayStr] = dateOfBirth.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  const monthName = MONTH_NAMES[month - 1];
  if (!monthName || !Number.isFinite(day)) {
    return dateOfBirth;
  }
  return `${monthName} ${day}`;
}
