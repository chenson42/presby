import type { EditableEngagement } from "@/lib/membership-standing";
import type {
  ArchiveRefusal,
  ChangeEngagementRefusal,
  RestoreRefusal,
  VisitDetailsRefusal,
} from "@/lib/community-engagement";
import { VALIDATION_COPY } from "./participant-copy";

/**
 * Every outcome's user-facing sentence for the four Community writes of
 * Increment 3a (docs/work-log/2026-10-22-founding-admin-directory-inc3.md,
 * Phase 3 Copy groups B, D and F). PURE: no `server-only`, no database, so the
 * actions, the dialogs and the tests read the same table and a screen cannot
 * invent a second wording (the `participant-copy.ts` precedent).
 *
 * Each table is a `Record` over the library's own outcome union, so an outcome
 * added to `community-engagement.ts` without a sentence here is a type error
 * (and `engagement-copy.test.ts` fails), exactly as `PARTICIPANT_COPY` is
 * over the participant refusals.
 *
 * What is NOT here, on purpose: the dialog bodies and the Engagement card
 * descriptions (Batch C's UI strings, Copy groups A and B), and anything about
 * follow-ups (3a says nothing about them, D8).
 *
 * Two sentences are shared across the four writes because Copy gives them once:
 * `forbidden` ("You don't have permission to change this.") and `not_found`
 * ("That person could not be found."), both Copy group B. Archive has its own
 * `forbidden` (Copy group D). A refusal never names a database term, a code or
 * a function.
 */

/** The label of each engagement an administrator may set (Copy group A, options). */
export const ENGAGEMENT_LABELS: Record<EditableEngagement, string> = {
  visitor: "Visitor",
  regular: "Regular attender",
  inactive: "Inactive",
  moved_away: "Moved away",
};

/** `changeEngagement`'s outcomes that are not `ok` (Copy group B), plus `unchanged`. */
export const CHANGE_ENGAGEMENT_COPY: Record<ChangeEngagementRefusal | "unchanged" | "db_error", string> = {
  unchanged: "That is already how this person is marked.",
  forbidden: "You don't have permission to change this.",
  not_found: "That person could not be found.",
  ended: "This person's connection here has ended, so this can't be changed.",
  staff_record: "This is a staff record, so engagement can't be changed.",
  needs_no_roll: "A person on the roll can't be marked as a visitor.",
  changed_meanwhile: "This changed while you were looking. Reload the page to see the current setting.",
  db_error: "We couldn't save that change. Nothing was changed.",
};

/** The success toast, one per engagement ("{Name} is now marked as a regular attender." ...). */
export function engagementSuccessMessage(name: string, to: EditableEngagement): string {
  switch (to) {
    case "regular":
      return `${name} is now marked as a regular attender.`;
    case "inactive":
      return `${name} is now marked as inactive.`;
    case "moved_away":
      return `${name} is now marked as moved away.`;
    case "visitor":
      return `${name} is now marked as a visitor.`;
  }
}

/** `archivePerson`'s outcomes that are not `ok` (Copy group D). */
export const ARCHIVE_COPY: Record<ArchiveRefusal | "db_error", string> = {
  forbidden: "You don't have permission to archive people here.",
  not_found: "That person could not be found.",
  already_ended: "This person's connection here has already ended.",
  not_eligible:
    "Only visitors and people marked inactive or moved away can be archived. A member leaves through a roll action; a participant is removed as a participant.",
  self_target: "You can't archive your own record. Ask another administrator.",
  holds_position: "This person still holds an office, a role or a staff position here. End that first, then try again.",
  pending_action:
    "This person has a roll action waiting for the Session, so they can't be archived yet. Try again once the Session has decided it or it has been withdrawn.",
  db_error: "We couldn't archive them. Nothing was changed.",
};

/** `restorePerson`'s outcomes that are not `ok` (Copy group D). */
export const RESTORE_COPY: Record<RestoreRefusal | "db_error", string> = {
  forbidden: "You don't have permission to change this.",
  not_found: "That person could not be found.",
  not_archived: "That person wasn't archived here.",
  person_unavailable: "This person's record is marked deceased or merged, so they can't be restored.",
  db_error: "We couldn't restore them. Nothing was changed.",
};

/** `updateVisitDetails`'s outcomes that are not `ok` (Copy group F), plus `unchanged`. */
export const VISIT_DETAILS_COPY: Record<VisitDetailsRefusal | "unchanged" | "db_error", string> = {
  forbidden: "You don't have permission to change this.",
  not_found: "That person could not be found.",
  ended: "This person's connection here has ended, so this can't be changed.",
  bad_date: "That date can't be used. Choose a date from 1900 up to today.",
  bad_text: VALIDATION_COPY.howHeardTooLong,
  // Saving what is already stored is a quiet success: the form shows the same line.
  unchanged: "Visit details saved.",
  db_error: "We couldn't save that change. Nothing was changed.",
};

/** The success sentences the actions' callers show (Copy groups D and F). */
export const ENGAGEMENT_SUCCESS_COPY = {
  visitDetailsSaved: "Visit details saved.",
  archived: (name: string) => `${name} is archived. You can restore them from Former.`,
  restored: (name: string, list: "visitors" | "inactive") =>
    `${name} is back on the ${list === "visitors" ? "Visitors" : "Inactive"} list.`,
} as const;
