"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { adoptTemplate, createRole } from "@/lib/role-definitions";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/roles/new` (docs/work-log/
 * 2026-08-26-role-permissions-admin.md, Phase 3 design). Same conventions as
 * `admin/roles/actions.ts`: `auth()` not `cachedAuth()` (a Server Action is a
 * fresh invocation each time — `cachedAuth()`'s own header says to call
 * `auth()` directly here), `slug` re-resolved server-side through
 * `resolveOrgContext()`, never trusted from client-supplied form data —
 * `src/lib/role-definitions.ts` additionally re-verifies the acting person's
 * own `roles.manage` permission and, for `adoptTemplateAction`, the template
 * row itself, so this file is belt-and-suspenders plumbing, not the only
 * gate.
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
// createRoleAction
// ---------------------------------------------------------------------------

export async function createRoleAction(
  slug: string,
  input: { key: string; name: string; permissionKeys: string[] },
): Promise<ActionResult<{ roleId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await createRole(
    identity.personId,
    identity.organizationId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to create roles here.",
      };
    case "invalid_input":
      return { ok: false, error: result.reason };
    case "duplicate_key":
      return {
        ok: false,
        error: "A role with that key already exists at this organization.",
      };
    case "escalation_denied":
      return {
        ok: false,
        error: `You can't create a role with permissions you don't hold yourself: ${result.missingPermissions.join(", ")}.`,
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_DEFINITION_CREATED,
    resourceType: "app_role",
    resourceId: result.roleId,
    metadata: {
      organizationId: identity.organizationId,
      roleKey: result.roleKey,
      permissionKeys: input.permissionKeys,
    },
  });

  revalidatePath(`/o/${slug}/admin/roles`);

  return { ok: true, data: { roleId: result.roleId } };
}

// ---------------------------------------------------------------------------
// adoptTemplateAction
// ---------------------------------------------------------------------------

export async function adoptTemplateAction(
  slug: string,
  input: { templateRoleId: string; key?: string; name?: string },
): Promise<ActionResult<{ roleId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await adoptTemplate(
    identity.personId,
    identity.organizationId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to create roles here.",
      };
    case "template_not_found":
      return {
        ok: false,
        error: "That template role doesn't exist for this organization.",
      };
    case "invalid_input":
      return { ok: false, error: result.reason };
    case "duplicate_key":
      return {
        ok: false,
        error: "A role with that key already exists at this organization.",
      };
    case "escalation_denied":
      return {
        ok: false,
        error: `That template carries permissions you don't hold yourself: ${result.missingPermissions.join(", ")}.`,
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE,
    resourceType: "app_role",
    resourceId: result.roleId,
    metadata: {
      organizationId: identity.organizationId,
      roleKey: result.roleKey,
      templateRoleId: input.templateRoleId,
      templateKey: result.templateKey,
    },
  });

  revalidatePath(`/o/${slug}/admin/roles`);

  return { ok: true, data: { roleId: result.roleId } };
}
