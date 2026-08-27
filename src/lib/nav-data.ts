import "server-only";
import { cache } from "react";
import {
  isEnterableOrganization,
  userOrganizations,
  type UserOrganization,
} from "@/lib/authz";
import { readIsPlatformAdmin } from "@/lib/platform-admin";

/**
 * Request-scoped reads for the signed-in header.
 *
 * THE HEADER IS ON EVERY PAGE, so anything it reads is read on every page. Both
 * of these are already read by `/home` (DECISION-124 — this used to be
 * `/orgs`), and `readIsPlatformAdmin` is
 * deliberately NOT a session claim (revocation must take effect immediately),
 * so without memoization the header would double every one of those queries for
 * a value that cannot change mid-render.
 *
 * `cache()` is per-request and per-render-pass — the same wrapper `cachedAuth`
 * uses for the session, and for the same reason. It is a no-op in server actions
 * and route handlers; call the underlying functions directly there.
 *
 * NOTE: `resolveOrgContext()` calls `userOrganizations()` directly, so an
 * `/o/<slug>` page still pays one read here and one there. Deduplicating that
 * means memoizing inside `src/lib/authz.ts`, where the call sits between two
 * security comments; it is a follow-up, not a drive-by.
 */

export const cachedUserOrganizations = cache(userOrganizations);

export const cachedIsPlatformAdmin = cache(readIsPlatformAdmin);

/**
 * The enterable subset, derived from the memoized unfiltered read.
 *
 * Deliberately re-derived through `isEnterableOrganization` rather than
 * wrapping `availableOrganizations` in its own `cache()`: two memoized readers
 * over the same function would each hold their own promise and issue their own
 * query, which is the exact duplication this file exists to remove.
 */
export async function cachedAvailableOrganizations(
  userId: string,
): Promise<UserOrganization[]> {
  const all = await cachedUserOrganizations(userId);
  return all.filter(isEnterableOrganization);
}
