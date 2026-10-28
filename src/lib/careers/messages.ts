/**
 * The staff-facing error strings of Copy S8 - pure, no `server-only`, importable by
 * the server actions and by the client (docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 Copy S8). A `"use server"` file may export only async functions, so the
 * strings live here; the client compares an action's `error` with
 * `STALE_MESSAGE` to decide whether to offer the "Reload" button, which is the one
 * result that changes what the form does next (an `ActionResult` carries a
 * message, not a kind).
 */

export const FORBIDDEN_MESSAGE = "You don't have permission to manage job openings.";
export const NOT_FOUND_MESSAGE = "That job opening no longer exists.";
export const FEATURE_OFF_MESSAGE = "Job openings aren't turned on.";
export const STALE_MESSAGE =
  "This opening was changed by someone else after you opened it, so your changes were not saved. Reload the page to see what changed.";
export const SLUG_TAKEN_MESSAGE = "Another opening already uses that web address. Choose a different one.";
export const PUBLISH_LIMIT_MESSAGE =
  "You already have 100 job openings published, which is the most we can show. Close one before publishing another.";
export const INVALID_TRANSITION_MESSAGE =
  "That can't be done to this opening right now. Reload the page and try again.";
export const GENERIC_MESSAGE = "We couldn't save that. Try again.";

/** "summary" / "summary and location" / "summary, location and description". */
function joinMissing(missing: readonly string[]): string {
  if (missing.length <= 1) return missing.join("");
  return `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
}

/** "Add a summary and location before publishing." */
export function incompleteMessage(missing: readonly string[]): string {
  return `Add a ${joinMissing(missing)} before publishing.`;
}

export function closingDatePassedMessage(reopening: boolean): string {
  return reopening
    ? "The closing date has already passed. Change it, save, then reopen."
    : "The closing date has already passed. Change it before publishing.";
}
