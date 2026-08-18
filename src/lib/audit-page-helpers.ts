/**
 * Pure input-guard helpers for the /admin/audit page.
 *
 * Extracted from the page so they can be unit-tested directly without a
 * running Next.js server. All three functions are stateless and have no
 * side effects — safe to import in any environment.
 *
 * These helpers correspond to the three trust-boundary validations required
 * for the read-only GET-param filter form:
 *   1. validateAuditAction  — must be a known AUDIT_ACTIONS value
 *   2. clampPage            — must be a positive integer
 *   3. truncateActor        — length cap before passing to ilike
 */

import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit";

/**
 * Validate that a raw URL param string is a recognized AUDIT_ACTIONS value.
 *
 * Returns the typed `AuditAction` if valid, or `undefined` if the value is
 * empty, missing, or not present in the catalog.  Silently dropping an
 * unrecognized value (rather than surfacing an error) is the correct posture
 * for a read-only filter — no data leaks, no user-visible error.
 */
export function validateAuditAction(
  value: string | undefined,
): AuditAction | undefined {
  if (!value) return undefined;
  return (Object.values(AUDIT_ACTIONS) as string[]).includes(value)
    ? (value as AuditAction)
    : undefined;
}

/**
 * Parse a page-number URL param string into a positive integer.
 *
 * Invalid, missing, zero, or negative inputs all return `1` (the first page).
 * There is no upper clamp here — the page component clamps against totalPages
 * after the count query resolves.
 */
export function clampPage(value: string | undefined): number {
  return Math.max(1, parseInt(value ?? "1", 10) || 1);
}

/**
 * Sanitize the actor email substring search term.
 *
 * Trims whitespace and truncates to 256 characters (the maximum length that
 * will be passed to an ilike clause).  An empty or missing value returns
 * `undefined` so the caller can reliably use `if (validActor)` as a
 * presence check.
 */
export function truncateActor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.slice(0, 256).trim();
  return trimmed || undefined;
}
