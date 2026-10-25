import { OrgAccessError } from "@/lib/authz";
import type {
  ArchiveDistrictResult,
  BulkMoveResult,
  DefineDistrictResult,
  MoveHouseholdResult,
  RenameDistrictResult,
  RestoreDistrictResult,
} from "@/lib/parishes";
import { BULK_TOO_MANY_COPY } from "./parish-copy";

/**
 * The one error-to-copy mapping for the three parish `actions.ts` files
 * (docs/work-log/2026-10-25-parish-management.md, Phase 3 "Server actions" and
 * Copy C2/C4/C5). Exhaustive on `result.kind`: a new kind in `parishes.ts`
 * without copy here is a TYPE ERROR, not a silent fall-through.
 *
 * Every string is from the design's Copy table. Nothing here names who could do
 * the thing (the toggle being off and authority being missing are the same
 * refusal), and nothing carries an id or a household name.
 */

export type ParishFailure = Exclude<
  | DefineDistrictResult
  | RenameDistrictResult
  | ArchiveDistrictResult
  | RestoreDistrictResult
  | MoveHouseholdResult
  | BulkMoveResult,
  { kind: "ok" }
>;

export type ParishActionKind =
  | "define"
  | "rename"
  | "archive"
  | "restore"
  | "move"
  | "assign"
  | "undo"
  | "bulk";

export const PERMISSION_COPY = "You don't have permission to do that.";

const SAVE_FAILED = "We couldn't save that. Nothing was changed.";
const MOVE_FAILED = "Could not move the household. Nothing was changed.";
const BULK_FAILED = "Could not move the households. Nothing was changed.";
const UNDO_FAILED = "Could not undo. Nothing was changed.";

/** The "nothing worked, nothing changed" line for an action kind. */
export function genericFailureCopy(action: ParishActionKind): string {
  switch (action) {
    case "define":
    case "rename":
    case "archive":
    case "restore":
      return SAVE_FAILED;
    case "move":
    case "assign":
      return MOVE_FAILED;
    case "undo":
      return UNDO_FAILED;
    case "bulk":
      return BULK_FAILED;
  }
}

export function describeParishFailure(
  result: ParishFailure,
  ctx: { action: ParishActionKind },
): string {
  const { action } = ctx;
  const undo = action === "undo";
  switch (result.kind) {
    case "off":
    case "forbidden":
      return PERMISSION_COPY;
    case "not_found":
      if (undo) return "Can't undo: this household has been moved since.";
      // A bulk `not_found` is the source or target DISTRICT: the household set
      // is derived server-side (QA run 1, Finding 4).
      if (action === "move" || action === "assign") {
        return "We couldn't find that household. We've refreshed the list.";
      }
      return "We couldn't find that district. We've refreshed the list.";
    case "wrong_state":
      return "This district was just changed by someone else. We've refreshed the list.";
    case "invalid_input":
      return result.reason === "empty"
        ? "Enter a name for the district."
        : "Use 80 characters or fewer.";
    case "name_taken":
      return action === "restore"
        ? "Another district already uses that name. Rename that one first, or leave this one archived."
        : "A district with that name already exists.";
    case "conflict":
      return undo
        ? "Can't undo: this household has been moved since."
        : "This household was just moved by someone else. We've refreshed the list.";
    case "target_unavailable": {
      if (result.reason !== "archived") return genericFailureCopy(action);
      const name = result.districtName;
      return undo && name
        ? `Can't undo: ${name} is archived.`
        : "That district was just archived. Choose another.";
    }
    case "source_not_archived":
      return "Only an archived district can be emptied this way.";
    case "same_unit":
      return genericFailureCopy(action);
    case "too_many":
      return BULK_TOO_MANY_COPY;
    case "count_changed":
      return "The households in this district changed while you were looking. We've refreshed the page. Check the count and try again.";
  }
}

/**
 * A thrown error from `parishes.ts` is a genuine failure. A viewer whose
 * membership ended (`OrgAccessError`) gets the refusal copy, never the stack;
 * anything else (a database blip, a deadlock) is the "nothing was changed" line.
 */
export function describeParishThrow(err: unknown, action: ParishActionKind): string {
  if (err instanceof OrgAccessError) return PERMISSION_COPY;
  return genericFailureCopy(action);
}
