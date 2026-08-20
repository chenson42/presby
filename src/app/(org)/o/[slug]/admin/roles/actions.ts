"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { grantRole, revokeRole, type RoleGrantee } from "@/lib/role-grants";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/roles` — P9 commit 2/3
 * (`docs/work-log/2026-08-19-tenant-administration.md`, Phase 3 design).
 * All SQL correctness (the escalation subset check, the arm-1 cascade
 * visibility, the self-lockout guard) lives in and is proven by
 * `src/lib/role-grants.ts` / `role-grants.test.ts` — this file's only job is
 * the auth-in-the-action-body plumbing and the audit write.
 *
 * `organizationId` NEVER comes from client-supplied form data. Both actions
 * take the URL `slug` and re-resolve it through `resolveOrgContext()` —
 * inside THIS user's own membership set, the same resolution every `(org)`
 * page performs — so the organization id a mutation runs against is always
 * the server's own answer to "what org is this signed-in user allowed to act
 * at, given this slug", never a value a client could forge. `role-grants.ts`
 * additionally re-validates the role and target belong to that same org
 * before touching the subset check, so this is belt-and-suspenders, not the
 * only gate (finding 2).
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()`. `src/lib/auth/cached-auth.ts`'s
 * own header says plainly: "Server actions — each action is a separate
 * invocation; cache() is a no-op ... Call auth() directly." This commit's
 * brief named `cachedAuth()`; the codebase's own documented convention (and
 * every existing `actions.ts` in the tree — `account/actions.ts`,
 * `account/2fa/actions.ts`, `admin/organizations/[id]/actions.ts`) uses
 * `auth()` here instead, so that convention is what this file follows.
 *
 * `role_grants.granted_by` IS A `users.id` FK, `role-grants.ts`'s own
 * membership/permission checks run against `people.id`. This is the layer
 * that has both: `session.user.id` (a `users.id`, from `auth()`) and
 * `resolved.org.personId` (a `people.id`, from `resolveOrgContext()`) — it
 * passes both into `grantRole()` rather than either function re-deriving one
 * from the other. Same bug class `src/lib/brand/read-org-brand.ts`'s header
 * documents for the equivalent `personId`-vs-`users.id` mixup (P0.5).
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
// grantRoleAction
// ---------------------------------------------------------------------------

export async function grantRoleAction(
  slug: string,
  input: { roleId: string; target: RoleGrantee; startsOn?: string },
): Promise<ActionResult<{ grantId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await grantRole(
    identity.personId,
    identity.organizationId,
    identity.userId,
    { roleId: input.roleId, target: input.target, startsOn: input.startsOn },
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to grant roles here.",
      };
    case "invalid_role":
      return { ok: false, error: "That role doesn't exist at this organization." };
    case "invalid_target":
      return {
        ok: false,
        error:
          input.target.kind === "person"
            ? "That person doesn't have a current membership at this organization."
            : "That group doesn't exist at this organization.",
      };
    case "escalation_denied":
      return {
        ok: false,
        error: `You can't grant permissions you don't hold yourself: ${result.missingPermissions.join(", ")}.`,
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.TENANT_ROLE_GRANTED,
    resourceType: "role_grant",
    resourceId: result.grantId,
    metadata: {
      organizationId: identity.organizationId,
      roleId: input.roleId,
      roleKey: result.roleKey,
      granteeType: input.target.kind,
      granteeId:
        input.target.kind === "person"
          ? input.target.personId
          : input.target.groupId,
    },
  });

  revalidatePath(`/o/${slug}/admin/roles`);

  return { ok: true, data: { grantId: result.grantId } };
}

// ---------------------------------------------------------------------------
// revokeRoleAction
// ---------------------------------------------------------------------------

/**
 * `role-grants.ts`'s `revokeRole()` returns only a result kind, not the
 * grant's role/grantee details — the caller (the roles page, which already
 * fetched `listGrants()` to render the row being revoked) supplies them so
 * this can write a complete audit-metadata record without a second read
 * inside the action.
 */
export async function revokeRoleAction(
  slug: string,
  input: {
    grantId: string;
    roleId: string;
    roleKey: string;
    granteeType: "person" | "group";
    granteeId: string;
  },
): Promise<ActionResult> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await revokeRole(
    identity.personId,
    identity.organizationId,
    input.grantId,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to revoke roles here.",
      };
    case "not_found":
      return { ok: false, error: "That role grant no longer exists." };
    case "self_lockout_blocked":
      return {
        ok: false,
        error:
          "Revoking this would leave nobody able to grant or revoke roles at this organization. Contact support if you need to change this.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.TENANT_ROLE_REVOKED,
    resourceType: "role_grant",
    resourceId: input.grantId,
    metadata: {
      organizationId: identity.organizationId,
      roleId: input.roleId,
      roleKey: input.roleKey,
      granteeType: input.granteeType,
      granteeId: input.granteeId,
    },
  });

  revalidatePath(`/o/${slug}/admin/roles`);

  return { ok: true };
}
