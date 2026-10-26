"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  cancelEvent,
  createEvent,
  extendSeriesPattern,
  setSeriesWebsiteListing,
  updateEvent,
  type CreateEventInput,
  type EventActor,
  type ExtendSeriesInput,
  type SeriesListingOutcome,
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
 * AUDIT LIVES IN THE LIB, NOT HERE (DECISION-240, amending DECISION-113
 * ruling 5). Event create, edit, extend and cancel are content configuration
 * and are not audited - EXCEPT when `events.website_listed` changes (an event
 * going onto, or coming off, the public website is a disclosure change). The
 * four writers that can change it (`createEvent`, `updateEvent`,
 * `extendSeriesPattern`, `setSeriesWebsiteListing`) write that one row
 * themselves with `insertAuditRow(tx, ...)` in the SAME transaction as the
 * change, so it cannot commit without it; that is why this file carries no
 * `recordAudit()` (the `check:audit` tripwire scans `actions.ts` only). These
 * actions pass the acting user and email through as an `EventActor`. A
 * cancel changes nothing about the listing and writes nothing.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` — server actions are each a
 * separate invocation, so `cache()` is a no-op; same convention every other
 * `actions.ts` in this tree follows.
 */

async function resolveActingIdentity(slug: string): Promise<
  | { ok: true; personId: string; organizationId: string; actor: EventActor }
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
    actor: { userId: session.user.id, email: session.user.email ?? null },
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
    identity.actor,
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

  const result = await updateEvent(
    identity.personId,
    identity.organizationId,
    identity.actor,
    input,
  );

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

  const result = await extendSeriesPattern(
    identity.personId,
    identity.organizationId,
    identity.actor,
    input,
  );

  if (result.kind !== "ok") {
    return mapForbiddenOrInvalid(result);
  }

  revalidatePath(`/o/${slug}/admin/events`);
  revalidatePath(`/o/${slug}/admin/events/${input.parentEventId}`);

  return { ok: true, data: { occurrenceIds: result.data.occurrenceIds } };
}

// ---------------------------------------------------------------------------
// setSeriesWebsiteListingAction
// ---------------------------------------------------------------------------

/**
 * "Put this and all later events on the website" / "take them off". The counts
 * the caller toasts are the ones the lib RETURNS (what actually changed), not
 * the confirmation's.
 */
export async function setSeriesWebsiteListingAction(
  slug: string,
  input: { eventId: string; listed: boolean },
): Promise<ActionResult<SeriesListingOutcome>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setSeriesWebsiteListing(
    identity.personId,
    identity.organizationId,
    identity.actor,
    { eventId: input.eventId, listed: input.listed },
  );

  if (result.kind !== "ok") {
    return mapForbiddenOrInvalid(result);
  }

  revalidatePath(`/o/${slug}/admin/events`);
  revalidatePath(`/o/${slug}/admin/events/${input.eventId}`);

  return { ok: true, data: result.data };
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
