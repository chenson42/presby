import "server-only";
import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext } from "@/lib/authz";
import type { ActionResult } from "@/types/actions";
import type { WorshipViewer } from "./access";
import { ACTION_COPY, GATE_COPY } from "./copy";
import type { WorshipResult } from "./result";

/**
 * The first two steps of every worship server action - docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 "Server actions": authenticate, then
 * resolve the organization from the URL SLUG inside THIS user's own
 * memberships. The viewer (person, organization, type, user) is derived from
 * that resolution and the session and from nothing the client sent; no action
 * takes an organization id or an acting person from its input.
 *
 * Uses `auth()` directly, not `cachedAuth()`: each server action is a separate
 * invocation, so `cache()` is a no-op there (the convention every other
 * `actions.ts` follows).
 *
 * An unauthenticated caller, a slug that does not resolve for this user and a
 * membership that ended mid-request all get the SAME refusal as a missing
 * permission: the action surface does not distinguish them (the proxy has
 * already sent a signed-out visitor to sign in).
 */

export interface ActionIdentity {
  viewer: WorshipViewer;
  slug: string;
  organizationName: string;
}

export async function resolveActionIdentity(
  slug: string,
): Promise<{ ok: true; identity: ActionIdentity } | { ok: false; error: string }> {
  if (typeof slug !== "string") return { ok: false, error: ACTION_COPY.forbidden };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: ACTION_COPY.forbidden };
  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") return { ok: false, error: ACTION_COPY.forbidden };
  return {
    ok: true,
    identity: {
      slug: resolved.org.slug,
      organizationName: resolved.org.name,
      viewer: {
        personId: resolved.org.personId,
        organizationId: resolved.org.organizationId,
        organizationType: resolved.org.organizationType,
        userId: session.user.id,
        email: session.user.email ?? null,
      },
    },
  };
}

/**
 * A store result as the `ActionResult` the client toasts. Every sentence is a
 * Copy string (`copy.ts`) or a message the store already took from it. A
 * `not_found` is the generic "that has changed" line: the action surface never
 * says whether an id exists.
 */
export function toActionResult<T, U = T>(
  result: WorshipResult<T>,
  organizationName: string,
  map?: (data: T) => U,
): ActionResult<U> {
  switch (result.kind) {
    case "ok":
      return { ok: true, data: (map ? map(result.data) : (result.data as unknown as U)) };
    case "not_applicable":
      return { ok: false, error: GATE_COPY.notApplicable };
    case "toggle_off":
      return { ok: false, error: GATE_COPY.off(organizationName) };
    case "forbidden":
      return { ok: false, error: ACTION_COPY.forbidden };
    case "not_found":
      return { ok: false, error: ACTION_COPY.stale };
    case "invalid_input":
    case "conflict":
      return { ok: false, error: result.message };
  }
}

/** Runs a store call; an `OrgAccessError` (the membership ended mid-request) is the forbidden refusal. */
export async function guardedCall<T>(call: () => Promise<WorshipResult<T>>): Promise<WorshipResult<T>> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof OrgAccessError) return { kind: "forbidden" };
    throw err;
  }
}
