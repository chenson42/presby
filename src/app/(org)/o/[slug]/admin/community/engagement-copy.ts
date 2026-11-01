import {
  membershipStanding,
  type EditableEngagement,
  type Engagement,
} from "@/lib/membership-standing";
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
 * Batch C adds the strings the screens show around those outcomes: the
 * Engagement card (Copy group A), the dialog titles, bodies and impact lines
 * (groups B and D), `engagementImpact` (the pure rule for which lines a dialog
 * carries, EC-25) and the Visit details labels (group F). Nothing here says
 * anything about follow-ups (3a says nothing about them, D8).
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

// ---------------------------------------------------------------------------
// Group A: the Engagement card
// ---------------------------------------------------------------------------

export const ENGAGEMENT_CARD_COPY = {
  heading: "Engagement",
  helper:
    "Engagement is for your own care. It is never reported to the presbytery or the denomination, and it does not change anyone's membership roll. It does decide who appears in the member directory and what a connected sign-in can see.",
  selectLabel: "Engagement",
  selectAccessibleName: (name: string) => `Engagement for ${name}`,
  currentOption: (label: string) => `${label} (current)`,
  staffRecord: "This is a staff record, so engagement isn't tracked.",
  archived: (name: string) => `${name} was archived. Restore them to change this.`,
  otherEnded: (name: string) => `${name}'s connection here has ended, so engagement can't be changed.`,
  nudge: (name: string) => `${name} is still marked as a visitor. Mark as a regular attender?`,
  nudgeButton: "Mark as regular attender",
  save: "Save engagement",
  saving: "Saving…",
} as const;

/**
 * The line under the select for the option it is showing, which depends on
 * whether the person is on the roll. A rolled person marked Visitor has no line
 * (Visitor is not offered to them; the nudge speaks instead).
 */
export function engagementDescription(onRoll: boolean, value: EditableEngagement): string | null {
  if (!onRoll) {
    switch (value) {
      case "visitor":
        return "Visitor. Does not appear in the member directory.";
      case "regular":
        return "Regular attender. Can appear in the member directory.";
      case "inactive":
        return "Inactive. Not attending lately. Does not appear in the member directory.";
      case "moved_away":
        return "Moved away. Does not appear in the member directory.";
    }
  }
  switch (value) {
    case "visitor":
      return null;
    case "regular":
      return "Regular attender. Can appear in the member directory.";
    case "inactive":
      return "Inactive. Not attending lately. Can still appear in the member directory because they are on the roll.";
    case "moved_away":
      return "Moved away. Can still appear in the member directory because they are on the roll. A departure is recorded as a roll action, not here.";
  }
}

// ---------------------------------------------------------------------------
// Group B: the engagement dialog and its impact lines
// ---------------------------------------------------------------------------

/**
 * What a dialog needs to know to say the truth. A fact the page could not read
 * is `null`, never a guess: an unknown sign-in is the "if" line, and an unknown
 * address or toggle omits the auto-connect line (it would promise a
 * connection the definer might refuse).
 */
export interface EngagementImpactInput {
  /** The engagement the page rendered (what `expectedFrom` carries). */
  from: Engagement;
  to: EditableEngagement;
  /** `memberships.current_roll` as rendered; the roll alone can list a person. */
  currentRoll: string | null;
  /** `people.user_id is not null`; null when the page could not read it. */
  signInConnected: boolean | null;
  /** An active address is on file; null when unknown. */
  addressOnFile: boolean | null;
  /** `org_portal.sign_in_connect` for the organization; null when unknown. */
  selfConnectEnabled: boolean | null;
}

export interface EngagementImpact {
  /** Whether the change moves the person into or out of the member directory. */
  listingChange: "gains" | "loses" | "none";
  /** A dialog opens only when listing changes; otherwise the change saves directly. */
  opensDialog: boolean;
  /** The sign-in line: connected, or the "if" form for unknown; none when known not connected. */
  signInLine: "connected" | "unknown" | null;
  /** Shown only when every one of its four premises is known true. */
  autoConnectLine: boolean;
}

/**
 * The one rule behind the engagement dialog (Copy group B, EC-25). Listing is
 * the classifier's `listed` standing (`membershipStanding`), so a person on the
 * roll never changes listing here: the roll lists them whatever the engagement.
 */
export function engagementImpact(input: EngagementImpactInput): EngagementImpact {
  const before = membershipStanding(input.currentRoll, input.from) === "listed";
  const after = membershipStanding(input.currentRoll, input.to) === "listed";
  const listingChange = !before && after ? "gains" : before && !after ? "loses" : "none";
  const opensDialog = listingChange !== "none";
  return {
    listingChange,
    opensDialog,
    signInLine: !opensDialog
      ? null
      : input.signInConnected === true
        ? "connected"
        : input.signInConnected === null
          ? "unknown"
          : null,
    autoConnectLine:
      opensDialog &&
      listingChange === "gains" &&
      input.signInConnected === false &&
      input.addressOnFile === true &&
      input.selfConnectEnabled === true,
  };
}

const ENGAGEMENT_DIALOG_TARGET: Record<EditableEngagement, { title: (name: string) => string; confirm: string }> = {
  regular: { title: (n) => `Mark ${n} as a regular attender?`, confirm: "Mark as regular attender" },
  inactive: { title: (n) => `Mark ${n} as inactive?`, confirm: "Mark as inactive" },
  moved_away: { title: (n) => `Mark ${n} as moved away?`, confirm: "Mark as moved away" },
  visitor: { title: (n) => `Mark ${n} as a visitor?`, confirm: "Mark as a visitor" },
};

export interface EngagementDialogCopy {
  title: string;
  body: string;
  /** The added lines, in order (connected or unknown, then auto-connect). */
  lines: string[];
  cancel: string;
  confirm: string;
  pending: string;
}

export function engagementDialogCopy(
  name: string,
  to: EditableEngagement,
  impact: EngagementImpact,
): EngagementDialogCopy {
  const lines: string[] = [];
  if (impact.signInLine === "connected") {
    lines.push(`${name} has a sign-in connected, so this can also change what they can see.`);
  } else if (impact.signInLine === "unknown") {
    lines.push(`If ${name} has a sign-in connected, this can also change what they can see.`);
  }
  if (impact.autoConnectLine) {
    lines.push(`${name} could be connected to this record automatically when they sign in with an address on file.`);
  }
  return {
    title: ENGAGEMENT_DIALOG_TARGET[to].title(name),
    body:
      impact.listingChange === "gains"
        ? "They can then appear in the member directory."
        : "They will no longer appear in the member directory.",
    lines,
    cancel: "Keep as it is",
    confirm: ENGAGEMENT_DIALOG_TARGET[to].confirm,
    pending: "Saving…",
  };
}

// ---------------------------------------------------------------------------
// Group D: the archive and restore dialogs
// ---------------------------------------------------------------------------

/** The list a person leaves on archive, and returns to on restore. */
export type EngagementListName = "Visitors" | "Inactive";

/** Restore returns a visitor to Visitors and anyone else to Inactive (the library's own rule). */
export function listNameForEngagement(engagement: Engagement): EngagementListName {
  return engagement === "visitor" ? "Visitors" : "Inactive";
}

export interface ArchiveDialogFacts {
  list: EngagementListName;
  signInConnected: boolean;
  /** An invitation is open and still working; false when none or when the read did not load. */
  invitationOpen: boolean;
}

export function archiveDialogCopy(name: string, organization: string, facts: ArchiveDialogFacts) {
  const lines: string[] = [];
  if (facts.signInConnected) {
    lines.push(`${name} has a sign-in connected and will no longer reach ${organization} through this record.`);
  }
  if (facts.invitationOpen) {
    lines.push(`An invitation to ${name} is still open. It will stop working.`);
  }
  return {
    title: `Archive ${name}?`,
    body: `${name} will leave the ${facts.list} list and appear under Former. Their record is kept and you can restore it any time.`,
    lines,
    cancel: "Keep",
    confirm: "Archive",
    pending: "Archiving…",
  };
}

/** `signInConnected` is null where the screen never read it (the wizard's already-here step): the line is then omitted. */
export function restoreDialogCopy(
  name: string,
  organization: string,
  facts: { list: EngagementListName; signInConnected: boolean | null },
) {
  return {
    title: `Restore ${name}?`,
    body: `${name} will return to the ${facts.list} list.`,
    lines: facts.signInConnected === true ? [`${name} has a sign-in connected and will reach ${organization} again.`] : [],
    cancel: "Keep archived",
    confirm: "Restore",
    pending: "Saving…",
  };
}

// ---------------------------------------------------------------------------
// Group F: visit details
// ---------------------------------------------------------------------------

export const VISIT_DETAILS_FORM_COPY = {
  heading: "Visit details",
  firstVisit: "First visit (optional)",
  howHeard: "How did they hear about us? (optional)",
  save: "Save visit details",
  saving: "Saving…",
} as const;
