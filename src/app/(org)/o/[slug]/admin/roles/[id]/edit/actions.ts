"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { deactivateRole, setRolePermissions } from "@/lib/role-definitions";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/roles/[id]/edit` (docs/work-log/
 * 2026-08-26-role-permissions-admin.md, Phase 3 design). Same conventions as
 * `admin/roles/actions.ts` and this feature's own `new/actions.ts` sibling —
 * `auth()`, `slug` re-resolved server-side, `roleId` re-verified against
 * this org (and against `isProtected`) inside `src/lib/role-definitions.ts`,
 * never trusted from the client beyond "which row did they click".
 */

async function resolveActingIdentity(slug: string): Promise<
  | { ok: true; personId: string; organizationId: string }
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
  };
}

// ---------------------------------------------------------------------------
// setRolePermissionsAction
// ---------------------------------------------------------------------------

export async function setRolePermissionsAction(
  slug: string,
  roleId: string,
  newPermissionKeys: string[],
): Promise<ActionResult<{ addedKeys: string[]; removedKeys: string[] }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setRolePermissions(
    identity.personId,
    identity.organizationId,
    roleId,
    newPermissionKeys,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to edit roles here.",
      };
    case "not_found":
      return { ok: false, error: "That role no longer exists at this organization." };
    case "protected_role":
      return {
        ok: false,
        error: "Constitutional roles can't be edited here.",
      };
    case "escalation_denied":
      return {
        ok: false,
        error: `You can't add permissions you don't hold yourself: ${result.missingPermissions.join(", ")}.`,
      };
    case "self_lockout_blocked":
      return {
        ok: false,
        error:
          "Removing this would leave nobody able to create or edit roles at this organization. Contact support if you need to change this.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_DEFINITION_PERMISSIONS_CHANGED,
    resourceType: "app_role",
    resourceId: roleId,
    metadata: {
      organizationId: identity.organizationId,
      addedKeys: result.addedKeys,
      removedKeys: result.removedKeys,
      holderCount: result.holderCount,
    },
  });

  revalidatePath(`/o/${slug}/admin/roles`);

  return {
    ok: true,
    data: { addedKeys: result.addedKeys, removedKeys: result.removedKeys },
  };
}

// ---------------------------------------------------------------------------
// deactivateRoleAction
// ---------------------------------------------------------------------------

export async function deactivateRoleAction(
  slug: string,
  roleId: string,
): Promise<ActionResult> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await deactivateRole(
    identity.personId,
    identity.organizationId,
    roleId,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to deactivate roles here.",
      };
    case "not_found":
      return { ok: false, error: "That role no longer exists at this organization." };
    case "protected_role":
      return {
        ok: false,
        error: "Constitutional roles can't be deactivated here.",
      };
    case "already_deactivated":
      return { ok: false, error: "That role has already been deactivated." };
    case "self_lockout_blocked":
      return {
        ok: false,
        error:
          "Deactivating this would leave nobody able to create or edit roles at this organization. Contact support if you need to change this.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_DEFINITION_DEACTIVATED,
    resourceType: "app_role",
    resourceId: roleId,
    metadata: {
      organizationId: identity.organizationId,
      endedGrantCount: result.endedGrantCount,
    },
  });

  revalidatePath(`/o/${slug}/admin/roles`);

  return { ok: true };
}
