import type {
  ParticipantRecordRefusal,
  ParticipantVoidRefusal,
} from "@/lib/roll-action-kinds";

/**
 * The one copy table for every typed outcome the participant, undo, wizard and
 * edit-time roll actions can return (docs/work-log/2026-10-22-founding-admin-
 * directory.md, Phase 3 "Copy for every outcome"). Plain module (no
 * `server-only`, no `"use server"`): the server actions import it for their
 * `{ ok: false, error }` strings and the client forms may import it for toasts,
 * so a code never has two wordings.
 *
 * `Record<Code, string>` over the two closed vocabularies in
 * `roll-action-kinds.ts` (themselves pinned to the SQL by a source-scan test):
 * a code the database can return that has no copy here is a TYPE ERROR, not a
 * runtime hole. Organization names are not interpolated (the actions have no
 * name in scope).
 */

export type ParticipantCopyCode =
  | ParticipantRecordRefusal
  | ParticipantVoidRefusal
  | "forbidden";

export const PARTICIPANT_COPY: Record<ParticipantCopyCode, string> = {
  forbidden: "You don't have permission to record roll actions here.",
  invalid_kind: "That action can't be recorded from this screen.",
  date_out_of_range:
    "That date can't be used. Choose today or an earlier date that is after the person's birth date.",
  person_not_found: "That person could not be found.",
  person_deceased:
    "This person is recorded as deceased, so this can't be recorded for them.",
  membership_ended:
    "This person's connection to this organization has ended, so this can't be recorded.",
  pending_action:
    "This person has a roll action waiting for the Session. Wait for the Session to decide it, then try again.",
  already_participant: "This person is already recorded as a participant.",
  on_member_roll:
    "This person is on the member roll. Moving someone off the member roll is a Session decision and can't be recorded here.",
  not_participant:
    "This person isn't a participant right now, so there is nothing to remove.",
  date_before_latest_action:
    "That date is earlier than this person's most recent roll entry. Choose that date or a later one.",
  holds_position:
    "This person still holds an office, a role or a staff position here. End that first, then try again.",
  self_target: "You can't remove yourself as a participant. Ask another administrator.",
  provisioning_incomplete:
    "This organization's membership setup isn't finished, so this can't be recorded yet. Send us a support ticket and we'll finish it.",
  reason_required: "Say why you're undoing this entry.",
  reason_too_long: "Keep the reason under 500 characters.",
  action_not_found: "That entry could not be found.",
  not_on_record_kind:
    "Only participant entries recorded without approval can be undone here.",
  already_voided: "That entry was already undone.",
  not_latest_action:
    "Only this person's most recent roll entry can be undone. Undo the later entry first.",
  membership_changed:
    "This person's connection changed after the removal was recorded, so it can't be reopened here. Send us a support ticket.",
};

/**
 * Input-validation copy the actions use BEFORE calling the lib (a malformed
 * value is bad input, which the lib throws on; a user must see a message, not
 * a 500). Date wording reuses `date_out_of_range` for effective dates.
 */
export const VALIDATION_COPY = {
  signedOut: "You must be signed in to do that.",
  noAccess: "You don't have access to that organization.",
  badDate: PARTICIPANT_COPY.date_out_of_range,
  badBirthDate: "Enter a valid birth date, or leave it blank.",
  badFirstVisit: "That date can't be used. Choose today or an earlier date.",
  minuteTooLong: "Keep the minute reference under 200 characters.",
  howHeardTooLong: "Keep this under 200 characters.",
  unknownKind: "That choice isn't available.",
} as const;

/** The success toasts, kept beside the failures so a screen cannot invent a
 * third wording. */
export const SUCCESS_COPY = {
  visitorAdded: "Visitor added.",
  participantAdded: "Participant added. They're counted from the date you chose.",
  memberProposed:
    "Person added. They'll appear as a member once the Session approves.",
  rollRecorded: "Participant recorded. No approval is needed.",
  rollProposed: "Roll action proposed. It's waiting for the Session to approve.",
  participantRemoved:
    "Removed as a participant. Undo is available from this page or under Former.",
  enrolmentUndone: "Enrolment undone. They're no longer a participant.",
  removalUndone: "Removal undone. They're back as a participant.",
  filedPeriodWarning:
    "This changes a year that has already been filed. The filed return is not changed. If it needs correcting, file a correcting return.",
  shadowedProposal:
    "Proposed. Note: it's dated before this person's latest roll entry, so it won't change their current status when approved.",
} as const;

/** The two extra messages the wizard's create action adds on top of the table. */
export const CREATE_COPY = {
  forbidden: "You don't have permission to add people here.",
  existingElsewhere:
    "That person already belongs to another organization. This step can't attach them here yet — contact support about a transfer.",
  alreadyHere:
    "That person is already in this community. Open their record instead.",
  invalidHousehold:
    "That household no longer exists. Choose another or create a new one.",
} as const;
