"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  createEventType,
  moveEventType,
  seedStandardEventTypes,
  setEventTypeActive,
  updateEventType,
  type EventTypeInput,
} from "@/lib/event-types";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/events/types` - docs/work-log/
 * 2026-10-14-member-calendar.md, Phase 3 design, Phase 4 commit 4. All SQL
 * correctness (the `event_types.manage` gate, field validation, the duplicate
 * -name pre-check and the 23505 race, the fallback rules, ordering, the seed)
 * lives in and is proven by `src/lib/event-types.ts` / `event-types.test.ts`.
 * This file's only job is the auth-in-the-action-body plumbing and the
 * result-to-copy mapping.
 *
 * `organizationId` NEVER comes from client-supplied input. Every action takes
 * the URL `slug` and re-resolves it through `resolveOrgContext()` - inside THIS
 * user's own membership set - via `resolveActingIdentity()`, a private copy of
 * the helper every `actions.ts` in this tree defines (one-per-file convention).
 *
 * NO AUDIT WRITE ON ANY OF THESE FIVE ACTIONS - DECISION-161, ruling R7. Event
 * types are content configuration, an extension of DECISION-113 ruling 5 (event
 * create/edit/cancel is not audited either); there is no tenant audit reader
 * yet (DECISION-067), so an audit row would have no tenant-side reader.
 * Attribution is `updated_by` / `updated_at` on the row. This is deliberate,
 * not an oversight - do not add a `recordAudit()` call without a fresh ruling.
 * Every mutation here is made through `src/lib/event-types.ts` on a `tx`, so
 * no direct `db.` mutation appears in this file; if one is ever added it
 * carries `// audit-exempt: DECISION-161` on the line above it, and
 * `npm run check:audit` will fail until it does.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` - server actions are each a
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
    return { ok: false, error: "You don't have access to that organization." };
  }

  return {
    ok: true,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    userId: session.user.id,
  };
}

function mapFailure(
  result:
    | { kind: "forbidden" }
    | { kind: "invalid_target" }
    | { kind: "invalid_input"; message: string },
): { ok: false; error: string } {
  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage event types here.",
      };
    case "invalid_target":
      return { ok: false, error: "That event type doesn't exist." };
    case "invalid_input":
      return { ok: false, error: result.message };
  }
}

/** The manager page and the calendar's pills both show types. */
function revalidateTypeSurfaces(slug: string): void {
  revalidatePath(`/o/${slug}/admin/events/types`);
  revalidatePath(`/o/${slug}/calendar`);
}

export async function createEventTypeAction(
  slug: string,
  input: EventTypeInput,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await createEventType(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidateTypeSurfaces(slug);
  return { ok: true, data: { id: result.data.id } };
}

export async function updateEventTypeAction(
  slug: string,
  input: EventTypeInput & { id: string },
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await updateEventType(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidateTypeSurfaces(slug);
  return { ok: true, data: { id: result.data.id } };
}

export async function setEventTypeActiveAction(
  slug: string,
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setEventTypeActive(
    identity.personId,
    identity.organizationId,
    identity.userId,
    id,
    isActive,
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidateTypeSurfaces(slug);
  return { ok: true, data: { id: result.data.id } };
}

export async function moveEventTypeAction(
  slug: string,
  id: string,
  direction: "up" | "down",
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await moveEventType(
    identity.personId,
    identity.organizationId,
    identity.userId,
    id,
    direction,
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidateTypeSurfaces(slug);
  return { ok: true, data: { id: result.data.id } };
}

export async function seedStandardEventTypesAction(
  slug: string,
): Promise<ActionResult<{ created: number }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await seedStandardEventTypes(
    identity.personId,
    identity.organizationId,
    identity.userId,
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidateTypeSurfaces(slug);
  return { ok: true, data: { created: result.data.created } };
}
