"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  addGroupMember,
  createGroup,
  endGroupMembership,
  setGroupMembershipPublicDisplayOrder,
  setGroupMembershipPublicListed,
  updateGroup,
  type AddGroupMemberInput,
  type CreateGroupInput,
  type EndGroupMembershipInput,
  type SetGroupMembershipPublicDisplayOrderInput,
  type SetGroupMembershipPublicListedInput,
  type UpdateGroupInput,
} from "@/lib/groups";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/groups` — docs/work-log/
 * 2026-08-26-groups-admin.md, Phase 3 design, Phase 4 commit 2. All SQL
 * correctness (the `groups.manage` gate, the F21-shaped membership scoping,
 * the manageable-group-type re-validation, the app-level overlap check, the
 * derived-group guards) lives in and is proven by `src/lib/groups.ts` /
 * `groups.test.ts` — this file's only job is the auth-in-the-action-body
 * plumbing, the error→copy mapping named in Phase 3's API contract, and the
 * audit write. Read paths (`listGroups`/`getGroup`/`getGroupFormOptions`)
 * are called directly from their pages (Server Components), not through
 * this file — same shape as `admin/officers/actions.ts`.
 *
 * `organizationId` NEVER comes from client-supplied form data. Every action
 * takes the URL `slug` and re-resolves it through `resolveOrgContext()` —
 * inside THIS user's own membership set — via `resolveActingIdentity()`,
 * verbatim the same helper `admin/officers/actions.ts` defines.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` — server actions are each a
 * separate invocation, so `cache()` is a no-op; same convention every other
 * `actions.ts` in this tree follows.
 *
 * `setGroupMembershipPublicListedAction`/
 * `setGroupMembershipPublicDisplayOrderAction` (docs/work-log/
 * 2026-08-28-public-directory-primitives.md) are DELIBERATE DIVERGENCES from
 * this file's own "actions.ts calls recordAudit()" convention above — for
 * the FIRST of those two, `recordAudit()` is called from INSIDE
 * `src/lib/groups.ts`'s `setGroupMembershipPublicListed()` instead, per that
 * work-log's explicit Phase 3 instruction (matching
 * `setStaffPositionPublicListedAction`/`setOfficerTermPublicListedAction`'s
 * own identical divergence in their own files); the second is never audited
 * at all. Neither action calls `recordAudit()` itself. `resolveActingIdentity`
 * below now also resolves `userId` (a `users.id`, from `session.user.id`) —
 * needed as `setGroupMembershipPublicListed`'s `actingUserId` parameter,
 * matching `admin/staff/actions.ts`'s/`admin/officers/actions.ts`'s own
 * identical shape; every pre-existing caller in this file ignores the new
 * field.
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
// createGroupAction
// ---------------------------------------------------------------------------

export async function createGroupAction(
  slug: string,
  input: CreateGroupInput,
): Promise<ActionResult<{ groupId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await createGroup(
    identity.personId,
    identity.organizationId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage groups here.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    // Unreachable from createGroup in practice — handled anyway for
    // exhaustiveness, same discipline officers/actions.ts documents for its
    // own unreachable branches.
    case "invalid_target":
    case "overlap":
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GROUP_CREATED,
    resourceType: "group",
    resourceId: result.data.groupId,
    metadata: {
      organizationId: identity.organizationId,
      groupTypeId: input.groupTypeId,
      name: input.name,
    },
  });

  revalidatePath(`/o/${slug}/admin/groups`);

  return { ok: true, data: { groupId: result.data.groupId } };
}

// ---------------------------------------------------------------------------
// updateGroupAction
// ---------------------------------------------------------------------------

export async function updateGroupAction(
  slug: string,
  input: UpdateGroupInput,
): Promise<ActionResult<{ groupId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await updateGroup(
    identity.personId,
    identity.organizationId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage groups here.",
      };
    case "invalid_target":
      // Covers both "no longer exists" AND "this is a derived group" — the
      // load-bearing guard Flow 2 names. `updateGroup()` does not
      // distinguish which, same shape `endOfficerTermAction`'s
      // `invalid_target` copy takes.
      return {
        ok: false,
        error: "That group doesn't exist, or can't be edited directly.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    // Unreachable from updateGroup in practice.
    case "overlap":
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GROUP_UPDATED,
    resourceType: "group",
    resourceId: input.groupId,
    metadata: {
      organizationId: identity.organizationId,
      groupId: input.groupId,
      name: input.name,
    },
  });

  revalidatePath(`/o/${slug}/admin/groups`);
  revalidatePath(`/o/${slug}/admin/groups/${input.groupId}`);

  return { ok: true, data: { groupId: result.data.groupId } };
}

// ---------------------------------------------------------------------------
// addGroupMemberAction
// ---------------------------------------------------------------------------

export async function addGroupMemberAction(
  slug: string,
  input: AddGroupMemberInput,
): Promise<ActionResult<{ groupMembershipId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await addGroupMember(
    identity.personId,
    identity.organizationId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage groups here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error: "That group or person doesn't belong to this organization.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      return {
        ok: false,
        error: `${result.personName} is already an active member of ${result.groupName}.`,
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GROUP_MEMBER_ADDED,
    resourceType: "group_membership",
    resourceId: result.data.groupMembershipId,
    metadata: {
      organizationId: identity.organizationId,
      groupId: input.groupId,
      personId: input.personId,
      groupRole: input.groupRole,
      startsOn: input.startsOn,
    },
  });

  revalidatePath(`/o/${slug}/admin/groups/${input.groupId}`);

  return {
    ok: true,
    data: { groupMembershipId: result.data.groupMembershipId },
  };
}

// ---------------------------------------------------------------------------
// endGroupMembershipAction
// ---------------------------------------------------------------------------

/**
 * `groups.ts`'s `endGroupMembership()` returns only a result kind, not the
 * membership's group/person details — the caller (the group detail page,
 * which already fetched `getGroup()` to render the row being ended) supplies
 * `personId`/`groupId`/`groupName` so this can write a complete audit-
 * metadata record without a second read inside the action. Mirrors
 * `endOfficerTermAction`'s identical shape.
 */
export async function endGroupMembershipAction(
  slug: string,
  input: EndGroupMembershipInput & {
    personId: string;
    groupId: string;
    groupName: string;
  },
): Promise<ActionResult<{ groupMembershipId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await endGroupMembership(
    identity.personId,
    identity.organizationId,
    {
      groupMembershipId: input.groupMembershipId,
      endsOn: input.endsOn,
    },
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage groups here.",
      };
    case "invalid_target":
      // Covers both "no longer exists" AND "this is a derived-group
      // membership" — the load-bearing guard Flow 4 names.
      return {
        ok: false,
        error: "That group membership no longer exists.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    // Unreachable from endGroupMembership in practice — no insert happens
    // on this path.
    case "overlap":
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GROUP_MEMBER_ENDED,
    resourceType: "group_membership",
    resourceId: input.groupMembershipId,
    metadata: {
      organizationId: identity.organizationId,
      groupId: input.groupId,
      personId: input.personId,
      groupName: input.groupName,
      endsOn: input.endsOn,
    },
  });

  revalidatePath(`/o/${slug}/admin/groups/${input.groupId}`);

  return {
    ok: true,
    data: { groupMembershipId: result.data.groupMembershipId },
  };
}

// ---------------------------------------------------------------------------
// setGroupMembershipPublicListedAction
// ---------------------------------------------------------------------------

/**
 * Public committee-directory opt-in/opt-out (docs/work-log/
 * 2026-08-28-public-directory-primitives.md, Phase 3). All SQL correctness
 * (the `groups.manage` gate, the re-load-scoped-to-`managed`-before-mutate
 * derived-group guard, the `recordAudit()` call) lives in and is proven by
 * `src/lib/groups.ts`/`groups.test.ts` — this action's only job is the
 * auth-in-the-action-body plumbing and the error->copy mapping. `groupId` is
 * caller-supplied (the group detail page, which already fetched `getGroup()`
 * to render the row being toggled) purely for `revalidatePath` — mirroring
 * `endGroupMembershipAction`'s identical shape.
 *
 * DELIBERATE DIVERGENCE from this file's own "actions.ts calls
 * recordAudit()" convention (see this file's header) — this action calls no
 * `recordAudit()` itself.
 */
export async function setGroupMembershipPublicListedAction(
  slug: string,
  input: SetGroupMembershipPublicListedInput & { groupId: string },
): Promise<
  ActionResult<{ groupMembershipId: string; publicListed: boolean }>
> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setGroupMembershipPublicListed(
    identity.personId,
    identity.organizationId,
    identity.userId,
    {
      groupMembershipId: input.groupMembershipId,
      publicListed: input.publicListed,
    },
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage groups here.",
      };
    case "invalid_target":
      // Covers both "no longer exists" AND "this is a derived group's
      // membership" — the load-bearing guard Phase 1 Flow 2 names.
      return {
        ok: false,
        error: "That group membership no longer exists.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      // Unreachable from setGroupMembershipPublicListed in practice — no
      // insert happens on this path.
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/groups/${input.groupId}`);

  return {
    ok: true,
    data: {
      groupMembershipId: result.data.groupMembershipId,
      publicListed: result.data.publicListed,
    },
  };
}

// ---------------------------------------------------------------------------
// setGroupMembershipPublicDisplayOrderAction
// ---------------------------------------------------------------------------

/**
 * Public-directory display-order curation (docs/work-log/
 * 2026-08-28-public-directory-primitives.md, Phase 3). A SEPARATE action
 * from `setGroupMembershipPublicListedAction` above — see
 * `src/lib/groups.ts`'s own doc comment on
 * `setGroupMembershipPublicDisplayOrder()` for why. This action calls no
 * `recordAudit()` (matching the underlying mutation's own no-audit ruling —
 * presentation-order only, not a disclosure fact).
 */
export async function setGroupMembershipPublicDisplayOrderAction(
  slug: string,
  input: SetGroupMembershipPublicDisplayOrderInput & { groupId: string },
): Promise<
  ActionResult<{
    groupMembershipId: string;
    publicDisplayOrder: number | null;
  }>
> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setGroupMembershipPublicDisplayOrder(
    identity.personId,
    identity.organizationId,
    {
      groupMembershipId: input.groupMembershipId,
      publicDisplayOrder: input.publicDisplayOrder,
    },
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage groups here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error: "That group membership no longer exists.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      // Unreachable from setGroupMembershipPublicDisplayOrder in practice.
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/groups/${input.groupId}`);

  return {
    ok: true,
    data: {
      groupMembershipId: result.data.groupMembershipId,
      publicDisplayOrder: result.data.publicDisplayOrder,
    },
  };
}
