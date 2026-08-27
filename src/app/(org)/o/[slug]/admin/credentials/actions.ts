"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  changeOrdinationStatus,
  endAppointment,
  recordAppointment,
  recordOrdination,
  type ChangeOrdinationStatusInput,
  type EndAppointmentInput,
  type RecordAppointmentInput,
  type RecordOrdinationInput,
} from "@/lib/credentials";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/credentials` — presbytery-functionality
 * Increment 2 Phase 3 design (`docs/work-log/
 * 2026-08-26-presbytery-functionality.md`). All SQL correctness (the
 * `credentials.manage` gate, the F21-shaped membership scoping, the
 * `servingOrgId` parent-path check, the no-upsert/no-delete write path)
 * lives in and is proven by `src/lib/credentials.ts`/`credentials.test.ts`
 * — this file's only job is the auth-in-the-action-body plumbing, the
 * error->copy mapping, and the audit write. Read paths (`listOrdinations`/
 * `listAppointments`/`getCredentialsFormOptions`) are called directly from
 * the page (a Server Component), not through this file — same shape as
 * `admin/officers/page.tsx` calling `listOfficerRoster`/
 * `getOfficerFormOptions` directly.
 *
 * `organizationId` NEVER comes from client-supplied form data. Every action
 * takes the URL `slug` and re-resolves it through `resolveOrgContext()` —
 * inside THIS user's own membership set — via `resolveActingIdentity()`,
 * verbatim the same helper `admin/officers/actions.ts`/`admin/roles/
 * actions.ts` define. `src/lib/credentials.ts` additionally re-validates
 * every target belongs to this same org before writing, so this is
 * belt-and-suspenders, not the only gate.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` — same convention every other
 * `actions.ts` in this tree follows (server actions are separate
 * invocations; `cachedAuth()`'s cache is a no-op there).
 */

async function resolveActingIdentity(slug: string): Promise<
  | { ok: true; userId: string; personId: string; organizationId: string }
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
    userId: session.user.id,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}

const FORBIDDEN_MESSAGE =
  "You don't have permission to manage ministry credentials here.";

// ---------------------------------------------------------------------------
// recordOrdinationAction
// ---------------------------------------------------------------------------

export async function recordOrdinationAction(
  slug: string,
  input: RecordOrdinationInput,
): Promise<ActionResult<{ ordinationId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await recordOrdination(
    identity.personId,
    identity.organizationId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: FORBIDDEN_MESSAGE };
    case "invalid_target":
      return {
        ok: false,
        error:
          "That person doesn't hold a current membership at this organization.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ORDINATION_RECORDED,
    resourceType: "ordination",
    resourceId: result.data.ordinationId,
    metadata: {
      organizationId: identity.organizationId,
      personId: input.personId,
      ministry: input.ministry,
      ordainedOn: input.ordainedOn,
    },
  });

  revalidatePath(`/o/${slug}/admin/credentials`);

  return { ok: true, data: { ordinationId: result.data.ordinationId } };
}

// ---------------------------------------------------------------------------
// changeOrdinationStatusAction
// ---------------------------------------------------------------------------

/**
 * Backs BOTH the "Change status" picker and the "End ordination" confirm
 * dialog — the latter always submits `status: "removed"`. See
 * `src/lib/credentials.ts`'s header for why this is one function, not two.
 */
export async function changeOrdinationStatusAction(
  slug: string,
  input: ChangeOrdinationStatusInput & { personId: string },
): Promise<ActionResult<{ ordinationId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await changeOrdinationStatus(
    identity.personId,
    identity.organizationId,
    {
      ordinationId: input.ordinationId,
      status: input.status,
      minuteReference: input.minuteReference,
    },
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: FORBIDDEN_MESSAGE };
    case "invalid_target":
      return { ok: false, error: "That ordination record no longer exists." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ORDINATION_STATUS_CHANGED,
    resourceType: "ordination",
    resourceId: input.ordinationId,
    metadata: {
      organizationId: identity.organizationId,
      personId: input.personId,
      ordinationId: input.ordinationId,
      status: input.status,
    },
  });

  revalidatePath(`/o/${slug}/admin/credentials`);

  return { ok: true, data: { ordinationId: result.data.ordinationId } };
}

// ---------------------------------------------------------------------------
// recordAppointmentAction
// ---------------------------------------------------------------------------

export async function recordAppointmentAction(
  slug: string,
  input: RecordAppointmentInput,
): Promise<ActionResult<{ appointmentId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await recordAppointment(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: FORBIDDEN_MESSAGE };
    case "invalid_target":
      return {
        ok: false,
        error:
          "That person or congregation doesn't belong to this presbytery.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.APPOINTMENT_RECORDED,
    resourceType: "appointment",
    resourceId: result.data.appointmentId,
    metadata: {
      organizationId: identity.organizationId,
      personId: input.personId,
      servingOrgId: input.servingOrgId,
      callType: input.callType,
      startsOn: input.startsOn,
    },
  });

  revalidatePath(`/o/${slug}/admin/credentials`);

  return { ok: true, data: { appointmentId: result.data.appointmentId } };
}

// ---------------------------------------------------------------------------
// endAppointmentAction
// ---------------------------------------------------------------------------

/**
 * `credentials.ts`'s `endAppointment()` returns only a result kind, not the
 * appointment's person/serving-org details — the caller (the appointment
 * list, which already fetched `listAppointments()` to render the row being
 * ended) supplies them so this can write a complete audit-metadata record
 * without a second read. Mirrors `endOfficerTermAction`'s identical shape.
 */
export async function endAppointmentAction(
  slug: string,
  input: EndAppointmentInput & { personId: string; servingOrgId: string },
): Promise<ActionResult<{ appointmentId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await endAppointment(identity.personId, identity.organizationId, {
    appointmentId: input.appointmentId,
    endsOn: input.endsOn,
    endReason: input.endReason,
  });

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: FORBIDDEN_MESSAGE };
    case "invalid_target":
      return { ok: false, error: "That appointment record no longer exists." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.APPOINTMENT_ENDED,
    resourceType: "appointment",
    resourceId: input.appointmentId,
    metadata: {
      organizationId: identity.organizationId,
      appointmentId: input.appointmentId,
      personId: input.personId,
      servingOrgId: input.servingOrgId,
      endsOn: input.endsOn,
    },
  });

  revalidatePath(`/o/${slug}/admin/credentials`);

  return { ok: true, data: { appointmentId: result.data.appointmentId } };
}
