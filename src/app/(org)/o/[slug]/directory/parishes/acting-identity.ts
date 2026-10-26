import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";

/**
 * The acting identity for the three `directory/parishes/**` `actions.ts` files -
 * the same helper `admin/officers/actions.ts` and `admin/roles/actions.ts`
 * each define privately, shared here because three action files use it.
 *
 * NOT a `'use server'` module: it is imported BY the action files, and a helper
 * in a server-action file would itself become an exported action.
 *
 * `auth()` DIRECTLY, never `cachedAuth()` (a server action is its own
 * invocation; `cache()` is a no-op there - `src/lib/auth/cached-auth.ts`).
 * `organizationId` is never client input: the URL `slug` is re-resolved through
 * `resolveOrgContext()` inside THIS user's own membership set, so the
 * organization a mutation runs against is always the server's answer to "what
 * org may this signed-in user act at, for this slug". `userId` (a `users.id`)
 * and `personId` (a `people.id`) are both returned and never confused: the
 * audit actor is the first, every authority check the second.
 */
export type ParishIdentity =
  | {
      ok: true;
      userId: string;
      email: string | null;
      personId: string;
      organizationId: string;
    }
  | { ok: false; error: string };

export async function resolveActingIdentity(slug: string): Promise<ParishIdentity> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  return {
    ok: true,
    userId: session.user.id,
    email: session.user.email ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}
