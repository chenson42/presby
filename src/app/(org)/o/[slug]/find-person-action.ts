"use server";

import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { findPersonMatches } from "@/lib/org-portal/find-person";
import type { FindPersonResult } from "@/types/org-portal";

/**
 * The portal-home find-a-person search (Phase 3, Increment 1).
 *
 * RE-DERIVES IDENTITY FROM THE SESSION ITSELF — `auth()`, then a fresh
 * `resolveOrgContext(session.user.id, slug)` — never trusting a
 * client-supplied personId/organizationId. A server action is its own trust
 * boundary; the calling page having already resolved the same slug moments
 * earlier proves nothing about THIS invocation. `auth()` DIRECTLY, not
 * `cachedAuth()` — this runs inside a server action, a separate execution
 * context each call, where `cache()` is a documented no-op
 * (`src/lib/auth/cached-auth.ts`'s own header names server actions as the
 * one place NOT to use it).
 *
 * `directory.view` IS RE-CHECKED, via `findPersonMatches()`'s identical
 * `presby_has_permission()` SQL call to `getDirectory()`'s — never trusted
 * from the page that rendered the search box.
 *
 * INCREMENT 3 UPDATE: a unique match now redirects to the real
 * `/o/<slug>/directory/<personId>` detail route, which Increment 3 lands.
 * Increment 1 shipped this same function sending a unique match to the SAME
 * search-fallthrough href as zero/many/forbidden (the route didn't exist
 * yet) — that was the one-line divergence its own header comment flagged
 * for this exact update.
 *
 * FAILS CLOSED TO THE HONEST FALLTHROUGH, not a thrown error — this box
 * sits on the portal's front page, and a search that can crash the page a
 * member lands on first is worse than one that quietly falls through to the
 * full directory (which renders its own honest denied/broken state).
 */
export async function findPersonAction(
  slug: string,
  query: string,
): Promise<FindPersonResult> {
  const trimmed = query.trim();
  const fallthroughHref = `/o/${slug}/directory?search=${encodeURIComponent(trimmed)}`;

  if (trimmed === "") {
    return { kind: "fallthrough", href: fallthroughHref };
  }

  const session = await auth();
  if (!session?.user) {
    return { kind: "fallthrough", href: fallthroughHref };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { kind: "fallthrough", href: fallthroughHref };
  }

  try {
    const result = await findPersonMatches(
      resolved.org.personId,
      resolved.org.organizationId,
      trimmed,
    );
    if (result.kind === "ok" && result.personIds.length === 1) {
      return {
        kind: "redirect",
        href: `/o/${slug}/directory/${result.personIds[0]}`,
      };
    }
    return { kind: "fallthrough", href: fallthroughHref };
  } catch {
    // OrgAccessError (the relationship vanished mid-request) or a genuine DB
    // failure both fail closed to the same fallthrough — see this
    // function's header comment for why a home-page search box never
    // surfaces a raw error.
    return { kind: "fallthrough", href: fallthroughHref };
  }
}
