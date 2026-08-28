"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { hasPermission, resolveOrgContext } from "@/lib/authz";
import {
  endStaffPosition,
  startStaffPosition,
  type EndStaffPositionInput,
  type StartStaffPositionInput,
} from "@/lib/staff";
import { createPerson, type CreatePersonInput } from "@/lib/people";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/staff` — staff-and-personnel Phase 3
 * design (`docs/work-log/2026-08-27-staff-and-personnel.md`), api-developer
 * slice. All SQL correctness (the `staff.manage` gate, the F21-shaped
 * membership scoping, the exclusion-constraint mapping, the no-upsert/no-
 * delete write path) lives in and is proven by `src/lib/staff.ts`/
 * `staff.test.ts` — this file's only job is the auth-in-the-action-body
 * plumbing, the error→copy mapping, and (for `createStaffPersonAction`) never
 * trusting a client-supplied `rollAction`. Read paths (`listStaffRoster`/
 * `getStaffHistory`/`getStaffFormOptions`) are called directly from the page
 * (a Server Component), not through this file — same shape as
 * `admin/officers/actions.ts` and `admin/roles/page.tsx`.
 *
 * `organizationId` NEVER comes from client-supplied form data. Every action
 * takes the URL `slug` and re-resolves it through `resolveOrgContext()` —
 * inside THIS user's own membership set — via `resolveActingIdentity()`,
 * verbatim the same helper `admin/officers/actions.ts`/`admin/roles/
 * actions.ts` define. `src/lib/staff.ts` additionally re-validates the
 * person belongs to this same org before writing, so this is
 * belt-and-suspenders, not the only gate.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` — same convention every other
 * `actions.ts` in this codebase follows for Server Actions.
 *
 * `createStaffPersonAction` — DECISION-128's "thin caller of the shared,
 * F21-safe `createPerson()`" affordance, NOT a second person-creation
 * surface. `rollAction` is ALWAYS overwritten to `{ kind: "none" }` here,
 * server-side, REGARDLESS of what the caller's `input.rollAction` says — a
 * Server Action's parameter type is not a runtime trust boundary (any caller
 * who knows this action's id can post an arbitrary JSON body), so if this
 * override were omitted, a `staff.manage`-only-and-`people.manage`-holding
 * caller could smuggle a real `profession_of_faith`/`other_participant_
 * enrolled` roll action through the staff form — a roll mutation with none of
 * `admin/members/new`'s own review/confirm wizard steps. `createPerson()`'s
 * own gate (`people.manage` unconditionally, per DECISION-128 ruling 2) is
 * one half of the enforcement; this action ALSO checks `staff.manage` itself
 * (via `hasPermission()`) before ever calling `createPerson()` — per the
 * architect's Phase 2 ruling (DECISION-128 ruling 2), creating a brand-new
 * person from the STAFF-HIRING surface requires BOTH `staff.manage` AND
 * `people.manage`, so a `people.manage`-only holder (no `staff.manage` grant
 * at all) cannot use this staff-specific action to anchor a new person as
 * `engagementStatus: "staff"` — they would have to go through
 * `admin/members/new`'s own wizard instead, which writes a real roll action.
 * QA's Phase 5 loop-back (`docs/work-log/2026-08-27-staff-and-personnel.md`)
 * found this action previously relied ONLY on `createPerson()`'s internal
 * `people.manage` check, silently forgetting `staff.manage` — fixed here.
 *
 * NO `recordAudit()` CALLS IN THIS FILE (DECISION-129, fourth ruling) —
 * staff hiring/termination are personnel-administration mutations with no
 * access-change nexus (`staff_positions` has no FK/trigger into `role_
 * grants`/`group_memberships`, unlike `officer_terms`). Each mutation below
 * carries a `// audit-exempt:` comment naming this reasoning for the next
 * reader — the mechanical `check:audit` tripwire does not fire on this file
 * either way (the actual `tx.insert`/`tx.update` calls live in `src/lib/
 * staff.ts`, not here), so the comment is for humans, not the tripwire.
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

// ---------------------------------------------------------------------------
// startStaffPositionAction
// ---------------------------------------------------------------------------

export async function startStaffPositionAction(
  slug: string,
  input: StartStaffPositionInput,
): Promise<ActionResult<{ positionId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await startStaffPosition(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage staff here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error: "That person doesn't belong to this organization.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      return {
        ok: false,
        error: `${result.personName} already has an open position as ${result.position} — end it first.`,
      };
    case "ok":
      break;
  }

  // audit-exempt: personnel-administration record-keeping, no access-change
  // nexus — see this file's header (DECISION-129, fourth ruling).
  revalidatePath(`/o/${slug}/admin/staff`);

  return { ok: true, data: { positionId: result.data.positionId } };
}

// ---------------------------------------------------------------------------
// endStaffPositionAction
// ---------------------------------------------------------------------------

/**
 * `staff.ts`'s `endStaffPosition()` returns only a result kind, not the
 * position's person/title, mirroring `endOfficerTermAction`'s identical
 * shape — the caller (the roster page, which already fetched
 * `listStaffRoster()` to render the row being ended) supplies `personId`/
 * `position` for consistency with that sibling contract, even though this
 * file writes no audit metadata from them (see header).
 */
export async function endStaffPositionAction(
  slug: string,
  input: EndStaffPositionInput & { personId: string; position: string },
): Promise<ActionResult<{ positionId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await endStaffPosition(identity.personId, identity.organizationId, {
    positionId: input.positionId,
    endsOn: input.endsOn,
    endReason: input.endReason,
  });

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage staff here.",
      };
    case "invalid_target":
      return { ok: false, error: "That staff position no longer exists." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      // Unreachable from endStaffPosition in practice — no insert happens
      // on this path, so no exclusion constraint can fire. Handled for
      // exhaustiveness, matching endOfficerTermAction's own precedent.
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  // audit-exempt: personnel-administration record-keeping, no access-change
  // nexus — see this file's header (DECISION-129, fourth ruling).
  revalidatePath(`/o/${slug}/admin/staff`);

  return { ok: true, data: { positionId: result.data.positionId } };
}

// ---------------------------------------------------------------------------
// createStaffPersonAction
// ---------------------------------------------------------------------------

/**
 * The staff form's "can't find them, add a new person" fallback — a thin
 * wrapper over the shared `createPerson()` (DECISION-128). Creating a
 * brand-new person from this staff-specific surface requires BOTH
 * `staff.manage` (checked explicitly below, first) AND `people.manage`
 * (enforced inside `createPerson()` itself, unconditionally) — per the
 * architect's Phase 2 ruling (DECISION-128 ruling 2): a `staff.manage`-only
 * holder may still attach a position to an EXISTING matched person via
 * `startStaffPositionAction`, but creating a new `people` row is a
 * People-domain action regardless of which module's UI triggered it, so a
 * `people.manage`-only holder (no `staff.manage` grant) must not be able to
 * use THIS action to anchor a new person as `engagementStatus: "staff"`. The
 * client-side form additionally hides/disables the affordance for a session
 * lacking `people.manage` and names the gap ("Ask someone who manages People
 * to add them first") — that UI-side hiding is a separate, already-correct
 * concern from this server-side gate.
 */
export async function createStaffPersonAction(
  slug: string,
  input: CreatePersonInput,
): Promise<ActionResult<{ personId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const canManageStaff = await hasPermission(
    identity.personId,
    identity.organizationId,
    "staff.manage",
  );
  if (!canManageStaff) {
    return {
      ok: false,
      error: "You don't have permission to manage staff here.",
    };
  }

  const result = await createPerson(
    identity.personId,
    identity.organizationId,
    identity.userId,
    {
      ...input,
      // NEVER trust a client-supplied rollAction here — see this file's
      // header comment for why.
      rollAction: { kind: "none" },
    },
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error:
          "You don't have permission to add a new person. Ask someone who manages People to add them first.",
      };
    case "existing_member_elsewhere":
      return {
        ok: false,
        error:
          "That person already belongs to another organization. Contact support about a transfer.",
      };
    case "invalid_household":
      return {
        ok: false,
        error: "That household no longer exists. Choose another or leave it unset.",
      };
    case "ok":
      break;
  }

  // audit-exempt: this action never writes a roll action (rollAction is
  // pinned to { kind: "none" } above) and staff_positions itself carries no
  // access-change nexus — see this file's header (DECISION-129, fourth
  // ruling). The underlying `people` row create itself also carries no
  // AUDIT_ACTIONS entry today (admin/members/new/actions.ts's own precedent
  // — createPerson() writes no audit event by design).
  revalidatePath(`/o/${slug}/admin/staff`);

  return { ok: true, data: { personId: result.personId } };
}
