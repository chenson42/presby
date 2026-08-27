"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  cancelEvent,
  createEvent,
  extendSeriesPattern,
  updateEvent,
  type CreateEventInput,
  type ExtendSeriesInput,
  type UpdateEventInput,
} from "@/lib/events";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/events` — docs/work-log/
 * 2026-08-26-events-model.md, Phase 3 design, Phase 4 commit 2. All SQL
 * correctness (the `events.manage` gate, the length limits, the end-before-
 * start check, the 52-occurrence series-total cap, the same-org parent
 * guard) lives in and is proven by `src/lib/events.ts` / `events.test.ts` —
 * this file's only job is the auth-in-the-action-body plumbing and the
 * error→copy mapping named in Phase 3's API contract. Read paths
 * (`listEvents`/`getEvent`) are called directly from their pages (Server
 * Components), not through this file — same shape as `admin/groups/
 * actions.ts`.
 *
 * `organizationId` NEVER comes from client-supplied form data. Every action
 * takes the URL `slug` and re-resolves it through `resolveOrgContext()` —
 * inside THIS user's own membership set — via `resolveActingIdentity()`,
 * verbatim the same helper `admin/groups/actions.ts`/`admin/officers/
 * actions.ts` define.
 *
 * NO AUDIT WRITE ON ANY OF THESE FOUR ACTIONS — DECISION-113 ruling 5, event
 * create/edit/cancel is content configuration, not an identity/access/
 * security-control mutation (matching the `replaceOrganizationServiceTimes`/
 * `setOrganizationProfile` precedent). This is deliberate, not an oversight —
 * do not add one without a fresh architectural ruling.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` — server actions are each a
 * separate invocation, so `cache()` is a no-op; same convention every other
 * `actions.ts` in this tree follows.
 */

async function resolveActingIdentity(slug: string): Promise<
  | { ok: true; personId: string; organizationId: string; userId: string }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return {
      ok: false,
      error: "You don't have access to that organization.",
    };
  }

  return {
    ok: true,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    userId: session.user.id,
  };
}

function mapForbiddenOrInvalid(
  result: { kind: "forbidden" } | { kind: "invalid_target" } | { kind: "invalid_input"; message: string },
): { ok: false; error: string } {
  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage events here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error: "That event doesn't exist, or can't be edited directly.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
  }
}

// ---------------------------------------------------------------------------
// createEventAction
// ---------------------------------------------------------------------------

export async function createEventAction(
  slug: string,
  input: CreateEventInput,
): Promise<ActionResult<{ eventId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await createEvent(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );

  if (result.kind !== "ok") {
    return mapForbiddenOrInvalid(result);
  }

  revalidatePath(`/o/${slug}/admin/events`);

  return { ok: true, data: { eventId: result.data.eventId } };
}

// ---------------------------------------------------------------------------
// updateEventAction
// ---------------------------------------------------------------------------

export async function updateEventAction(
  slug: string,
  input: UpdateEventInput,
): Promise<ActionResult<{ eventId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await updateEvent(identity.personId, identity.organizationId, input);

  if (result.kind !== "ok") {
    return mapForbiddenOrInvalid(result);
  }

  revalidatePath(`/o/${slug}/admin/events`);
  revalidatePath(`/o/${slug}/admin/events/${input.eventId}`);

  return { ok: true, data: { eventId: result.data.eventId } };
}

// ---------------------------------------------------------------------------
// extendSeriesPatternAction
// ---------------------------------------------------------------------------

export async function extendSeriesPatternAction(
  slug: string,
  input: ExtendSeriesInput,
): Promise<ActionResult<{ occurrenceIds: string[] }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await extendSeriesPattern(identity.personId, identity.organizationId, input);

  if (result.kind !== "ok") {
    return mapForbiddenOrInvalid(result);
  }

  revalidatePath(`/o/${slug}/admin/events`);
  revalidatePath(`/o/${slug}/admin/events/${input.parentEventId}`);

  return { ok: true, data: { occurrenceIds: result.data.occurrenceIds } };
}

// ---------------------------------------------------------------------------
// cancelEventAction
// ---------------------------------------------------------------------------

export async function cancelEventAction(
  slug: string,
  eventId: string,
): Promise<ActionResult<{ eventId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await cancelEvent(identity.personId, identity.organizationId, eventId);

  if (result.kind !== "ok") {
    return mapForbiddenOrInvalid(result);
  }

  revalidatePath(`/o/${slug}/admin/events`);
  revalidatePath(`/o/${slug}/admin/events/${eventId}`);

  return { ok: true, data: { eventId: result.data.eventId } };
}
