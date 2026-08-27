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
 * The edit-time picker's allow-list (`/o/<slug>/admin/members/<id>/edit`'s
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
