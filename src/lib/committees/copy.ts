/**
 * Every user-visible string this module produces (docs/work-log/2026-11-19-
 * presbytery-committees.md, Phase 3 "Copy", C1 to C9, and C15 for the commission
 * record, Increment 2: only the strings this MODULE produces; the commission
 * pages' chrome is the ux batch's, in ui-copy.ts). PURE: it imports only
 * the pure date formatter and the pure role labels, so a form, a page, the
 * validators and the tests read one file. A string that is not in the design's
 * Copy section does not belong here: it stops for a ruling.
 *
 * What no string below may deny (the Phase 3 "Accepted residuals no string may
 * deny"): a committee can carry a role, so adding someone is an access change
 * (the carries note says so in words, and the titles note says TITLES give no
 * access, never that membership gives none); a person who has left the
 * presbytery keeps their seat until someone ends it; ex officio is entered by
 * hand; the public list switches on the UTC day; turning a public listing off is
 * not a full retraction; committee-name uniqueness is checked by the
 * application, not the database; dissolution cannot be undone FROM THIS PAGE
 * (not "at all"); committee and seat history is protected by the application,
 * not by a database grant. Nothing here says "everyone can", "no one else can
 * see", "nothing is kept" or "this can never happen"; `copy.test.ts` pins it.
 */
import { formatDateUTC } from "@/lib/format-date";
import { GROUP_ROLE_LABELS, type GroupRoleValue } from "@/lib/group-roles";
import type { Refusal, RefusalDetail } from "./contract";
import { AREA } from "./ui-copy";

/** A date-only `YYYY-MM-DD` as a plain string ("Mar 4, 2026"): for messages built outside JSX (the UTC day, deterministic). */
export function dateText(iso: string): string {
  return formatDateUTC(new Date(`${iso}T00:00:00Z`));
}

// ---------------------------------------------------------------------------
// C9: refusals (one fixed string per kind, never raw database text)
// ---------------------------------------------------------------------------

type PlainRefusal = Exclude<
  Refusal,
  "duplicate_name" | "overlap" | "date_before_start" | "committee_dissolved" | "congregation_not_found"
>;

export const REFUSAL: Record<PlainRefusal, string> = {
  forbidden: "You don't have permission to manage committees here.",
  // ONE string for a committee id that does not exist, is another presbytery's, is a choir, a derived group,
  // a congregation's committee, or is malformed (a prober cannot tell absent from foreign: DECISION-040).
  not_found: "That committee could not be found.",
  // The seat/member twin: the only string that differs from the one above, and only by the object the form named.
  seat_not_found: "That member could not be found.",
  not_a_member: "That person is no longer connected to this presbytery, so they can't be added.",
  already_dissolved: "This committee has already been dissolved.",
  already_ended: "That term has already ended.",
  same_role: "Choose a different role.",
  stale: "This seat was changed by someone else after you opened it. Reload the page, then try again.",
  save_failed: "We couldn't save that. Nothing was changed. Try again.",
  // C15
  commission_ended: "This commission has ended, so no one can be added.",
};

/** C15: the same refusal kinds, worded for a commission record (`RefusalDetail.subject === "commission"`). */
export const COMMISSION_REFUSAL = {
  stale: "This record was changed by someone else after you opened it. Reload the page, then make your change again.",
  alreadyEnded: "This commission has already ended.",
  overlap: (personName: string) => `${personName} already serves on this commission during those dates. End that term first.`,
  dateBeforeStart: (date: string) => `A member started on ${dateText(date)}. The end date can't be before that.`,
  /** One wording for another presbytery's congregation, a non-congregation, a nonexistent id and a malformed one. */
  congregationNotFound: (presbyteryName: string) =>
    `That congregation could not be found among ${presbyteryName}'s member congregations.`,
} as const;

/** C5: the add-member refusal for a dissolved committee. */
export const COMMITTEE_DISSOLVED_ADD = "This committee has been dissolved, so no one can be added.";
/** C4: an edit of a dissolved committee ("kept as history"). Also the edit page's state when there is no form. */
export const COMMITTEE_DISSOLVED_EDIT =
  "This committee was dissolved. A dissolved committee is kept as history and isn't edited here.";

/** The message for a refusal. The three that name something take it from `detail` (a stored value, never a client one). */
export function refusalMessage(reason: Refusal, detail: RefusalDetail = {}): string {
  const commission = detail.subject === "commission";
  switch (reason) {
    case "duplicate_name":
      return `A committee named "${detail.existingName ?? ""}" already exists. Choose a different name.`;
    case "overlap":
      if (commission) return COMMISSION_REFUSAL.overlap(detail.personName ?? "That person");
      return `${detail.personName ?? "That person"} already serves on ${detail.committeeName ?? "this committee"} during those dates. Use "Change role", or end that term first.`;
    case "date_before_start":
      if (commission && detail.date) return COMMISSION_REFUSAL.dateBeforeStart(detail.date);
      return `A member started on ${detail.date ? dateText(detail.date) : "a later date"}. The dissolve date can't be before that.`;
    case "committee_dissolved":
      return detail.during === "edit" ? COMMITTEE_DISSOLVED_EDIT : COMMITTEE_DISSOLVED_ADD;
    case "stale":
      return commission ? COMMISSION_REFUSAL.stale : REFUSAL.stale;
    case "already_ended":
      return commission ? COMMISSION_REFUSAL.alreadyEnded : REFUSAL.already_ended;
    case "congregation_not_found":
      return COMMISSION_REFUSAL.congregationNotFound(detail.presbyteryName ?? "this presbytery");
    default:
      return REFUSAL[reason];
  }
}

/** The two answers before a form is read (the existing strings, reused: C9). */
export const GATE_COPY = {
  signedOut: "You must be signed in to do that.",
  noAccess: "You don't have access to that organization.",
  /** The page's own flag-off sentence (`PlaceholderFlagOff`), so a Server Action refused for the flag says what the page says. */
  flagOff: (orgName: string) => `${AREA} isn't turned on for ${orgName} yet.`,
} as const;

// ---------------------------------------------------------------------------
// C1: whole-page states (the only ones this module words; the org denial and the
// ended notice are the existing components')
// ---------------------------------------------------------------------------

export const PAGE_STATE = {
  forbidden: (name: string) =>
    `You don't have permission to manage committees at ${name}. If you think this is a mistake, ask your presbytery's administrator.`,
  loadError: "We couldn't load committees right now. Try again in a moment.",
  sectionError: "We couldn't load this. Try again.",
  tryAgain: "Try again",
} as const;

// ---------------------------------------------------------------------------
// C4 to C8: validation messages (each is returned only by the check it names)
// ---------------------------------------------------------------------------

export const VALIDATION = {
  // C4
  nameRequired: "Name is required.",
  nameTooLong: "Name must be 200 characters or fewer.",
  kindRequired: "Choose Required, Standing or Ad hoc.",
  purposeTooLong: "Purpose must be 2000 characters or fewer.",
  meetsWhenTooLong: "When it meets must be 200 characters or fewer.",
  // C5
  personRequired: "Choose a person.",
  roleRequired: "Choose a role.",
  startRequired: "Choose a start date.",
  dateInvalid: "That date isn't valid.",
  startTooFar: "The start date can't be more than 5 years ahead.",
  endNotAfterStart: "The end date has to be after the start date.",
  endTooFar: "The end date can't be more than 10 years ahead.",
  // C6
  roleDifferent: "Choose a different role.",
  effectiveBeforeStart: (iso: string) => `The effective date can't be before ${dateText(iso)}, when this role began.`,
  effectiveNotBeforeEnd: (iso: string) => `The effective date has to be before this term ends on ${dateText(iso)}.`,
  effectiveTooFar: "The date can't be more than 5 years ahead.",
  // C7 (the existing groups-admin wording for the first)
  endBeforeStart: "The end date can't be before the start date.",
  // C8
  dissolveFuture: "The dissolve date can't be in the future.",
  // C15: the commission record's fields and its end dialog
  titleRequired: "Title is required.",
  titleTooLong: "Title must be 200 characters or fewer.",
  chargeTooLong: "Charge must be 500 characters or fewer.",
  minuteTooLong: "Minute reference must be 200 characters or fewer.",
  appointedRequired: "Choose the date it was appointed.",
  endedFuture: "The end date can't be in the future.",
  endedBeforeAppointed: (iso: string) => `The end date can't be before ${dateText(iso)}, when it was appointed.`,
} as const;

// ---------------------------------------------------------------------------
// C3 to C8: the sentences a page composes around a roster
// ---------------------------------------------------------------------------

/** C3 / C5: above the roster and under the add form's title. Says TITLES give no access; never that membership gives none. */
export const TITLES_NOTE =
  "Chair, vice chair, clerk, secretary and ex officio are titles. A title doesn't give anyone access.";

/**
 * C15: the sentence a commission page carries about access. True by construction: a
 * commission record has no `role_id` and no `group_id` (0090's closing assertion;
 * `boundaries.test.ts` pins that nothing writes the downward tables) and its policy is
 * organization-only (`test-rls-90.sql` (d)). It says "gives no one access" and "does
 * not see it": never "no one at the presbytery can see it" (the charge is tier 1,
 * residual 10, stated by the form's helper and the help page).
 */
export function commissionNoAccess(congregationName: string | null): string {
  return congregationName === null
    ? "This record gives no one access to any congregation's PresbyPortal."
    : `This record gives no one access to ${congregationName}'s PresbyPortal, and ${congregationName} does not see it.`;
}

/** C15: the "About" line of a commission page; a congregation that has left the presbytery is said so. */
export function commissionAboutLine(congregationName: string | null, stillMember: boolean): string {
  if (congregationName === null) return "No congregation recorded";
  return stillMember
    ? `About ${congregationName}`
    : `About ${congregationName} (no longer a member of this presbytery)`;
}

function roleList(names: readonly string[]): string {
  return names.join(", ");
}

/** C3: the note on the committee page when the committee carries a role (grants effective today). */
export function carriesNote(roleNames: readonly string[]): string | null {
  if (roleNames.length === 0) return null;
  if (roleNames.length === 1) {
    return `Everyone serving on this committee also holds the ${roleNames[0]} role, so adding someone here gives them that role's access.`;
  }
  return `Everyone serving on this committee also holds these roles: ${roleList(roleNames)}. Adding someone here gives them their access.`;
}

/** C5: the warning on the add form. */
export function carriesWarning(roleNames: readonly string[]): string | null {
  if (roleNames.length === 0) return null;
  if (roleNames.length === 1) {
    return `This committee carries the ${roleNames[0]} role. Adding someone here also gives them that role's access.`;
  }
  return `This committee carries these roles: ${roleList(roleNames)}. Adding someone here also gives them their access.`;
}

/** C7: the extra body sentence of the end-term dialog when a role is carried. */
export const END_TERM_CARRIES = "Ending the term also ends the access that comes from belonging to this committee.";

/** C8: the extra body sentence of the dissolve dialog when a role is carried. */
export function dissolveCarries(roleNames: readonly string[]): string | null {
  if (roleNames.length === 0) return null;
  const which = roleNames.length === 1 ? `the ${roleNames[0]} role` : `these roles: ${roleList(roleNames)}`;
  return `This committee carries ${which}. Dissolving it ends the access that comes from belonging to it.`;
}

/** C3: the role badge text for a seat. */
export function roleLabel(role: GroupRoleValue): string {
  return GROUP_ROLE_LABELS[role];
}

/** C3: status badges derived from the person's records. */
export const STATUS_BADGE = {
  noLongerConnected: "No longer connected to this presbytery",
  deceased: "Recorded as deceased",
} as const;

/** C3: one line of a seat's dates, as the pieces a page renders (it formats `date` through `FormattedDate`). */
export type SeatDateLine =
  | { kind: "since"; date: string }
  | { kind: "starts"; date: string }
  | { kind: "ends"; date: string }
  | { kind: "started"; date: string }
  | { kind: "ended"; date: string }
  | { kind: "zero_length" };

const DATE_LINE_PREFIX: Record<Exclude<SeatDateLine["kind"], "zero_length">, string> = {
  since: "Since",
  starts: "Starts",
  ends: "Ends",
  started: "Started",
  ended: "Ended",
};

/** The words before the date ("Since", "Ends"...) of a date line; empty for the zero-length line. A page puts `FormattedDate` after it. */
export function seatDateLinePrefix(line: SeatDateLine): string {
  return line.kind === "zero_length" ? "" : DATE_LINE_PREFIX[line.kind];
}

/** The text of a date line with the date already formatted by the caller (`FormattedDate` in JSX, `dateText` in a string). */
export function seatDateLineText(line: SeatDateLine, formattedDate: string): string {
  return line.kind === "zero_length" ? "Ended the day it started" : `${DATE_LINE_PREFIX[line.kind]} ${formattedDate}`;
}

/** C3: the end control's label, chosen by the seat's state. */
export const END_CONTROL = {
  serving: "End term",
  plannedEnd: "Change end date",
  notStarted: "Cancel planned term",
} as const;

/** The committee list's "Chair: {names}" and "{n} serving" (C2). */
export function chairLine(names: readonly string[]): string {
  return names.length === 0 ? "No chair serving" : `Chair: ${names.join(", ")}`;
}
export function servingLine(n: number): string {
  return `${n} serving`;
}

// ---------------------------------------------------------------------------
// C4 to C8: toasts on success (a client toasts them; a server action never does)
// ---------------------------------------------------------------------------

export const TOAST = {
  created: "Committee created.",
  saved: "Committee saved.",
  dissolved: "Committee dissolved.",
  memberAdded: "Added to the committee.",
  roleChanged: "Role changed.",
  termEnded: "Term ended.",
  endDateSaved: "End date saved.",
  plannedCancelled: "Planned term cancelled.",
  // C15
  commissionRecorded: "Commission recorded.",
  commissionSaved: "Commission saved.",
  commissionMemberAdded: "Added to the commission.",
  commissionEnded: "Commission ended.",
  recordRemoved: "Record removed.",
  listed: (name: string, committee: string) => `${name} is now listed publicly on ${committee}'s roster.`,
  unlisted: (name: string, committee: string) => `${name} is no longer listed publicly on ${committee}'s roster.`,
} as const;
