import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ADMIN_ROLE, FEATURES } from "@/lib/permissions";

/**
 * `users.is_platform_admin`, read live from the database.
 *
 * DELIBERATELY NOT A SESSION CLAIM. The precedent is `developer/guard.ts`,
 * which has always read it live "so revoking platform admin takes effect
 * immediately instead of at the next token refresh." Caching it in the JWT
 * would be the stale-authorization bug on the one predicate that opens a map of
 * the whole application.
 *
 * It is neither a permission nor a feature flag; it is a column (D7, S5). It
 * decides which PAGES are reachable — the developer portal, and the Developer
 * card on the chooser — and never whether a query is filtered. That is what the
 * second, RLS-bypassing connection is for.
 *
 * NOT the same predicate as `canAccessAdmin` (session `roles`/`features`),
 * which is what the Edge enforces on `/admin`. The two are held by roughly the
 * same people by accident — nothing seeds this column — and DECISION-044(1)
 * exists because routing on either alone ships a bug in opposite directions.
 *
 * Extracted here as the third copy of the same four-line select
 * (`developer/guard.ts`, `developer/schema.json/route.ts`) — so there is not a
 * fourth.
 */
export async function readIsPlatformAdmin(userId: string): Promise<boolean> {
  const [me] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return me?.isPlatformAdmin === true;
}

/**
 * The OTHER platform predicate: would the Edge admit this session to `/admin`?
 *
 * A pure read of session claims — no database, no await. It mirrors
 * `src/proxy.ts` exactly: the proxy waves through anyone holding `ADMIN_ROLE`
 * (`proxy.ts`, the `roles?.includes(ADMIN_ROLE)` line) and otherwise requires
 * `FEATURES.ADMIN_DASHBOARD` for `/admin` via `PROTECTION_RULES`.
 *
 * Extracted because THREE places now have to agree on it — the Edge, `/launch`
 * (which routes a zero-org holder straight to `/admin`) and `/orgs` (which
 * renders the Admin card). If they disagree, the router sends a user to a page
 * the Edge bounces to `/access-pending`, which reads as a broken login rather
 * than as a permissions problem. The proxy keeps its own inline copy because it
 * runs on the Edge and must not import a module that pulls `@/lib/db`; this
 * file does, so the proxy cannot import from here. Change one, change both —
 * `src/proxy.test.ts` and `platform-admin.test.ts` pin them to the same rule.
 *
 * NOT `isPlatformAdmin` (DECISION-044(1)): that is a column, read live, and it
 * gates the Developer portal. These two are held by the same people today by
 * accident, not by design.
 */
export function sessionCanAccessAdmin(user: {
  roles?: string[] | null;
  features?: string[] | null;
}): boolean {
  return (
    user.roles?.includes(ADMIN_ROLE) === true ||
    user.features?.includes(FEATURES.ADMIN_DASHBOARD) === true
  );
}
