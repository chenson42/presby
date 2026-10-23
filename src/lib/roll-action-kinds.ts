import type { rollActionKind } from "@/lib/db/domain/roll";

/**
 * Shared, plain (no `"server-only"`) data module — Phase 2 Note 3 / Phase 3
 * Data Model (`docs/work-log/2026-08-26-member-roll-on-edit.md`). Both a
 * server function (`src/lib/roll.ts`'s `recordRollAction()`) and two client
 * components (the `/new` wizard's `RollActionStep`, this pipeline's
 * `RecordRollActionForm`) need the same label map, so it cannot live in
 * `roll.ts` (which carries `"server-only"`) or in either component file.
 *
 * ALLOW-LIST, NOT EXCLUSION-LIST (Phase 2 Note 3): each surface declares its
 * own explicit array of the kinds it offers, rather than rendering "every
 * kind except X" — a future 18th `roll_action_kind` therefore appears on
 * NEITHER `<select>` until a human explicitly adds it to one of the lists
 * below. `void` is never in either list; corrections happen through the
 * approve/deny worklist's own mechanism, not either creation surface.
 */

export type RollActionKind = (typeof rollActionKind)["enumValues"][number];

export const ROLL_ACTION_KIND_LABELS: Record<RollActionKind, string> = {
  opening_balance: "Opening balance",
  profession_of_faith: "Profession of faith",
  reaffirmation: "Reaffirmation of faith",
  restoration: "Restoration",
  certificate_received: "Certificate received (transfer in)",
  other_gain: "Other gain",
  baptized_member_enrolled: "Enrolled as a baptized member",
  affiliate_received: "Enrolled as an affiliate member",
  other_participant_enrolled: "Enrolled as a participant",
  certificate_dismissed: "Certificate dismissed (transfer out)",
  death: "Death",
  removed_by_session: "Removed by session action",
  renunciation_of_jurisdiction: "Renunciation of jurisdiction",
  other_loss: "Other loss",
  affiliate_ended: "Affiliate status ended",
  other_participant_removed: "Removed as a participant",
  void: "Void (correction)",
};

/**
 * `null` = removes the person from a roll (a loss). Never `null` for a kind
 * this pipeline's edit-time increment allows — see `EDIT_TIME_ROLL_ACTION_
 * KINDS` below, whose membership rule ("every kind whose `resultingRoll` is
 * non-null") is what makes the F19 exclusion mechanical rather than a
 * per-kind judgment call (Phase 3, correcting Phase 2's own Note 1 /
 * blocking-item contradiction over `certificate_dismissed`).
 */
export const ROLL_ACTION_KIND_TO_ROLL: Record<RollActionKind, string | null> = {
  opening_balance: null, // caller-supplied in practice; not reached by either surface
  profession_of_faith: "active",
  reaffirmation: "active",
  restoration: "active",
  certificate_received: "active",
  other_gain: "active",
  baptized_member_enrolled: "baptized",
  affiliate_received: "affiliate",
  other_participant_enrolled: "other_participant",
  certificate_dismissed: null,
  death: null,
  removed_by_session: null,
  renunciation_of_jurisdiction: null,
  other_loss: null,
  affiliate_ended: null,
  other_participant_removed: null,
  void: null,
};

/**
 * The edit-time picker's allow-list (`/o/<slug>/admin/community/<id>/edit`'s
 * `RecordRollActionForm`) — mechanically every kind whose `resultingRoll` is
 * non-null. Nothing that only ADDS to a roll can ever need `officer_terms`/
 * `role_grants`/`group_memberships` to change, so F19 (open, see
 * `docs/schema-design.md`) cannot fire through this list regardless of the
 * trigger gap. `certificate_dismissed` is deliberately excluded alongside
 * `death` — it sets `resultingRoll` to `null` (a loss), same as `death`.
 */
export const EDIT_TIME_ROLL_ACTION_KINDS = [
  "profession_of_faith",
  "reaffirmation",
  "restoration",
  "certificate_received",
  "other_gain",
  "baptized_member_enrolled",
  "affiliate_received",
  "other_participant_enrolled",
] as const satisfies readonly RollActionKind[];

export type EditTimeRollActionKind = (typeof EDIT_TIME_ROLL_ACTION_KINDS)[number];

/** Unchanged from the `/new` wizard's own original inline list. */
export const WIZARD_ROLL_ACTION_KINDS = [
  "profession_of_faith",
  "other_participant_enrolled",
] as const satisfies readonly RollActionKind[];

// ---------------------------------------------------------------------------
// On-record kinds (docs/work-log/2026-10-22-founding-admin-directory.md,
// Phase 2 R4/R9/R10, Phase 3 "Pure shared modules"; DECISION-198)
// ---------------------------------------------------------------------------

/**
 * The kinds that take effect ON RECORD (no Session approval): other-participant
 * enrolment and removal. PINNED EQUAL to the list inside
 * `presby_record_participant_action()` (`drizzle/0061_presby_participant_roll.
 * sql`, `p_kind not in (...)`) by a source-scan test
 * (`roll-action-kinds.test.ts`): the kind ALONE decides, in the database, and
 * this list is only TypeScript's copy of it. A forged membership kind is never
 * in this list, so it always goes down the pending path.
 */
export const ON_RECORD_ROLL_ACTION_KINDS = [
  "other_participant_enrolled",
  "other_participant_removed",
] as const satisfies readonly RollActionKind[];

export type OnRecordRollActionKind = (typeof ON_RECORD_ROLL_ACTION_KINDS)[number];

export function isOnRecordKind(kind: unknown): kind is OnRecordRollActionKind {
  return (
    typeof kind === "string" &&
    (ON_RECORD_ROLL_ACTION_KINDS as readonly string[]).includes(kind)
  );
}

/**
 * The fixed `memberships.ended_reason` a participant removal writes (and the
 * undo's reopen precondition compares against). Pinned equal to the literal in
 * `drizzle/0061` by the same source-scan test.
 */
export const PARTICIPANT_REMOVAL_ENDED_REASON = "other_participant_removed";

/**
 * The closed outcome vocabularies of the two definer functions, minus `ok`.
 * Pinned equal to the `outcome := '...'` literals in `drizzle/0061` by a
 * source-scan test, so a code the database can return that TypeScript has no
 * copy for is a failing test and (via `participant-copy.ts`'s
 * `Record<..., string>`) a type error.
 */
export const PARTICIPANT_RECORD_REFUSALS = [
  "invalid_kind",
  "date_out_of_range",
  "person_not_found",
  "person_deceased",
  "membership_ended",
  "pending_action",
  "already_participant",
  "on_member_roll",
  "not_participant",
  "date_before_latest_action",
  "holds_position",
  "self_target",
  "provisioning_incomplete",
] as const;

export type ParticipantRecordRefusal = (typeof PARTICIPANT_RECORD_REFUSALS)[number];

export const PARTICIPANT_VOID_REFUSALS = [
  "reason_required",
  "reason_too_long",
  "action_not_found",
  "not_on_record_kind",
  "already_voided",
  "not_latest_action",
  "membership_changed",
  "provisioning_incomplete",
] as const;

export type ParticipantVoidRefusal = (typeof PARTICIPANT_VOID_REFUSALS)[number];

// ---------------------------------------------------------------------------
// deriveRollFields (F173)
// ---------------------------------------------------------------------------

const DERIVE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `resulting_roll` and `age_at_action` for a roll action, from ONE derivation
 * that every writer shares (F173: `createPerson()` once wrote neither, so
 * `presby_sync_current_roll` projected `current_roll = null` on approval and
 * every profession of faith read as "18 and older" through
 * `coalesce(age_at_action, 99)`). Replaces `roll.ts`'s private `ageAsOf`.
 *
 * `ageAtAction` matches the SQL the definer function uses,
 * `date_part('year', age(effective_date, date_of_birth))::int` (whole years
 * completed on the effective date), including a 29 February birthday: in a
 * non-leap year the birthday is reached on 1 March, so 2000-02-29 is 24 on
 * 2025-02-28 and 25 on 2025-03-01. `roll-action-kinds.test.ts` pins that table
 * and `participant-roll.db.test.ts` compares both against the database.
 * `null` when the birth date is unknown (the caller leaves `age_at_action`
 * null, which `presby_roll_changes()` treats as an unknown age).
 */
export function deriveRollFields(
  kind: RollActionKind,
  dateOfBirth: string | null | undefined,
  effectiveDate: string,
): { resultingRoll: string | null; ageAtAction: number | null } {
  if (!DERIVE_YMD_RE.test(effectiveDate)) {
    throw new Error(
      `deriveRollFields: effectiveDate must be 'YYYY-MM-DD', got ${JSON.stringify(effectiveDate)}`,
    );
  }
  const resultingRoll = ROLL_ACTION_KIND_TO_ROLL[kind];
  if (!dateOfBirth) {
    return { resultingRoll, ageAtAction: null };
  }
  if (!DERIVE_YMD_RE.test(dateOfBirth)) {
    throw new Error(
      `deriveRollFields: dateOfBirth must be 'YYYY-MM-DD', got ${JSON.stringify(dateOfBirth)}`,
    );
  }
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ay, am, ad] = effectiveDate.split("-").map(Number);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) {
    age -= 1;
  }
  return { resultingRoll, ageAtAction: age };
}
