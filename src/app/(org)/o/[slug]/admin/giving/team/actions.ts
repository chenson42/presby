"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  gateGivingAction,
  invalidInput,
  type GivingActionResult,
} from "@/lib/giving/action-gate";
import {
  ensureGivingRole,
  grantGivingRole,
  revokeGivingRole,
  GIVING_TEMPLATE_KEYS,
} from "@/lib/giving/team";

/**
 * Server Actions for `/o/<slug>/admin/giving/team` - docs/work-log/
 * 2026-10-15-online-giving.md, Phase 2 R3 (F138), Phase 3 P3-18. Shared gate
 * (`giving.manage`), validation, one `team.ts` call, the audit write after the
 * commit. Grants and revokes reuse `TENANT_ROLE_GRANTED` / `TENANT_ROLE_REVOKED`
 * with `path: "giving_team"` so the audit reader can tell this narrow path from
 * the ordinary `role_grants.manage` one; setting up a role from a template
 * reuses `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE` with the same `path`.
 */

const grantSchema = z.object({ roleId: z.guid(), personId: z.guid() });
const revokeSchema = z.object({ grantId: z.guid() });
const ensureSchema = z.object({ templateKey: z.enum(GIVING_TEMPLATE_KEYS) });

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/admin/giving/team`);
  revalidatePath(`/o/${slug}/admin/giving`);
}

export async function grantGivingRoleAction(slug: string, input: unknown): Promise<GivingActionResult<{ grantId: string }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await grantGivingRole(gate.personId, gate.organizationId, gate.userId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to manage the giving team." };
    case "invalid_role":
      return { ok: false, error: "That role isn't available at this organization." };
    case "invalid_target":
      return { ok: false, error: "That person doesn't have a current membership here." };
    case "not_giving_only":
      return {
        ok: false,
        error: "That role includes permissions outside Giving and Reimbursements. An administrator can grant it from Roles.",
      };
    case "escalation_denied":
      return {
        ok: false,
        error: `You can't grant permissions you don't hold yourself: ${result.missingPermissions.join(", ")}.`,
      };
    case "already_granted":
      return { ok: false, error: "That person already has this role." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.TENANT_ROLE_GRANTED,
    resourceType: "role_grant",
    resourceId: result.grantId,
    metadata: {
      organizationId: gate.organizationId,
      roleId: parsed.data.roleId,
      roleKey: result.roleKey,
      granteeType: "person",
      granteeId: parsed.data.personId,
      path: "giving_team",
    },
  });
  revalidate(slug);
  return { ok: true, data: { grantId: result.grantId } };
}

export async function revokeGivingRoleAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await revokeGivingRole(gate.personId, gate.organizationId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to manage the giving team." };
    case "not_found":
      return { ok: false, error: "That role assignment has already ended." };
    case "not_giving_only":
      return { ok: false, error: "That assignment can only be ended from Roles." };
    case "last_manager_blocked":
      return {
        ok: false,
        error: "That would leave no one able to manage giving. Give the role to someone else first.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.TENANT_ROLE_REVOKED,
    resourceType: "role_grant",
    resourceId: parsed.data.grantId,
    metadata: {
      organizationId: gate.organizationId,
      roleId: result.roleId,
      roleKey: result.roleKey,
      granteeType: "person",
      granteeId: result.personId,
      path: "giving_team",
    },
  });
  revalidate(slug);
  return { ok: true };
}

export async function ensureGivingRoleAction(
  slug: string,
  input: unknown,
): Promise<GivingActionResult<{ roleId: string; skippedKeys: string[] }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = ensureSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await ensureGivingRole(gate.personId, gate.organizationId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to manage the giving team." };
    case "template_not_found":
      return { ok: false, error: "That role isn't available to set up. Contact support." };
    case "not_giving_only":
      return {
        ok: false,
        error: "That role already exists with permissions outside Giving and Reimbursements. An administrator can fix it under Roles.",
      };
    case "escalation_denied":
      return {
        ok: false,
        error: `You can't set up a role with permissions you don't hold yourself: ${result.missingPermissions.join(", ")}.`,
      };
    case "ok":
      break;
  }

  if (result.created || result.reactivated || result.addedKeys.length > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE,
      resourceType: "app_role",
      resourceId: result.roleId,
      metadata: {
        organizationId: gate.organizationId,
        roleKey: result.roleKey,
        templateRoleId: result.templateRoleId,
        templateKey: parsed.data.templateKey,
        created: result.created,
        reactivated: result.reactivated,
        path: "giving_team",
      },
    });
  }
  revalidate(slug);
  return { ok: true, data: { roleId: result.roleId, skippedKeys: result.skippedKeys } };
}
