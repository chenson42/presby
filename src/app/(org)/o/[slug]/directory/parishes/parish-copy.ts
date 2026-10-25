/**
 * Copy shared by the parish management surfaces and their tests - pure, no
 * `server-only`, no database, safe for client components. Every string is from
 * the design's Copy table (docs/work-log/2026-10-25-parish-management.md, Phase
 * 3 "Copy"); a string a surface needs that is not listed there is a ruling, not
 * an improvisation. Plurals follow "1 household" / "N households".
 */

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
