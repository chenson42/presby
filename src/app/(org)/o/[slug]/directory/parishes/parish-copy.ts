/**
 * Copy shared by the parish management surfaces and their tests - pure, no
 * `server-only`, no database, safe for client components. Every string is from
 * the design's Copy table (docs/work-log/2026-10-25-parish-management.md, Phase
 * 3 "Copy"); a string a surface needs that is not listed there is a ruling, not
 * an improvisation. Plurals follow "1 household" / "N households".
 */

import { BULK_MOVE_MAX } from "@/lib/parishes-pure";

export function householdsLabel(count: number): string {
  return `${count} ${count === 1 ? "household" : "households"}`;
}

/** C5: the bulk-move result toast. Counts and a district name only. */
export function bulkSuccessCopy(moved: number, skipped: number, toName: string): string {
  if (moved === 0) return "No households were left to move.";
  const base = `Moved ${householdsLabel(moved)} to ${toName}.`;
  return skipped > 0
    ? `${base} ${skipped} had already been moved by someone else and were left alone.`
    : base;
}

/** C4: the toast after a single move, assign or clear. */
export function movedToastCopy(
  mode: "move" | "assign",
  change: { fromName: string | null; toName: string | null },
): string {
  if (change.toName === null) {
    return `Removed from ${change.fromName ?? "its district"}.`;
  }
  return mode === "assign"
    ? `Assigned to ${change.toName}.`
    : `Moved to ${change.toName}.`;
}

/** C2: the archive confirmation body. */
export function archiveBodyCopy(householdCount: number): string {
  if (householdCount === 0) return "No households are in it. You can restore it later.";
  const lead =
    householdCount === 1
      ? "1 household is still in it. It stays there until it is moved to another district."
      : `${householdCount} households are still in it. They stay there until they are moved to another district.`;
  return `${lead} No households can be moved into an archived district. You can restore it later.`;
}

export function archiveDeaconCopy(deaconName: string): string {
  return `${deaconName} is still recorded as this district's Deacon. End that term in Officers if they have stepped down.`;
}

/** C5: the bulk confirmation body, before the "can't move back" sentence. */
export function bulkConfirmBodyCopy(args: {
  count: number;
  source: string;
  destination: string;
  destinationDeacon: string | null;
}): string {
  const { count, source, destination, destinationDeacon } = args;
  const lead = `All ${householdsLabel(count)} in ${source} will move to ${destination}.`;
  const deacon = destinationDeacon
    ? `${destinationDeacon} is recorded as ${destination}'s Deacon.`
    : `No deacon is recorded for ${destination} yet.`;
  return `${lead} ${deacon}`;
}

export function bulkConfirmTailCopy(source: string): string {
  return `${source} is archived, so households can't be moved back into it. This can't be undone in one step; households can be moved again one at a time.`;
}

/**
 * The archived district's way out, as ONE decision the notice and the control
 * beneath it both read, so the sentence that promises a way out can never
 * disagree with what renders under it (QA run 1, Finding 3; Phase 3 amendment 1).
 * Precedence: `none` if the viewer cannot move households or there are none;
 * else `no_target` if no active district exists; else `over_cap` above the bulk
 * cap; else `bulk`.
 */
export type ArchivedMoveState = "none" | "bulk" | "over_cap" | "no_target";

export function archivedMoveState(args: {
  canMove: boolean;
  householdCount: number;
  activeTargetCount: number;
}): ArchivedMoveState {
  const { canMove, householdCount, activeTargetCount } = args;
  if (!canMove || householdCount === 0) return "none";
  if (activeTargetCount === 0) return "no_target";
  if (householdCount > BULK_MOVE_MAX) return "over_cap";
  return "bulk";
}

export const ARCHIVED_BASE_COPY = "This district is archived. No households can be moved into it.";

/** The sentence appended to the base for a state; only `bulk` promises "all at once below". */
export function archivedMoveSentence(state: ArchivedMoveState): string {
  switch (state) {
    case "bulk":
      return " Move households out one at a time, or all at once below.";
    case "over_cap":
      return " Move households out one at a time below.";
    case "no_target":
    case "none":
      return "";
  }
}

/** The over-cap child and the `too_many` refusal toast: one sentence, one constant. */
export const BULK_TOO_MANY_COPY = `This district has more than ${BULK_MOVE_MAX} households, so they can't be moved all at once.`;

/** The `no_target` child; the instruction is for the viewer who can define or restore districts. */
export function noActiveDistrictsCopy(canDefine: boolean): string {
  return canDefine
    ? "There are no active districts to move them to. Add a district or restore an archived one on the Parishes page first."
    : "There are no active districts to move them to.";
}
