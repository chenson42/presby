"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { type ReimbursementActionResult } from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementAction } from "@/lib/reimbursement/gate";
import { zodFieldErrors } from "@/lib/reimbursement/action-result";
import { TEAM_TEMPLATE_KEYS } from "@/lib/reimbursement/keys";
import { ensureTreasuryRole, grantTreasuryRole, revokeTreasuryRole } from "@/lib/treasury/team";

/**
 * Server Actions for `/o/<slug>/admin/reimbursements/team` - docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 API Contract Layer 3, P3-14, F296,
 * EC31. The Treasury team page: the people who hold a treasury role, and the
 * two roles a treasurer sets up (the Treasurer, and the Reimbursement Clerk).
 *
 * Wrappers over the surface-parameterized `treasury/team.ts` with
 * `surface: "reimbursement"`: the actor gate is `reimbursement.manage` (the
 * gate here AND inside each team function, read live), the five safety steps
 * and the subset rule ("you can only hand out keys you hold") live in
 * `team.ts` and are not weakened here. A role is delegable when every key it
 * carries is in a treasury module; the last holder of `reimbursement.manage`
 * cannot be ended on this surface (residual 12: that guard is per surface).
 *
 * Audit rows are written HERE, after the commit, with `recordAudit()` - the
 * house shape of the giving team (`admin/giving/team/actions.ts`), so
 * `check:audit` finds them: grants and revokes reuse `TENANT_ROLE_GRANTED` /
 * `TENANT_ROLE_REVOKED`, setting up a role from a template reuses
 * `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE`, all with `path:
 * "reimbursement_team"` so the audit reader can tell this narrow path from the
 * ordinary `role_grants.manage` one. Metadata is ids and keys only.
 */

const grantSchema = z.object({ roleId: z.guid(), personId: z.guid() });
const revokeSchema = z.object({ grantId: z.guid() });
const ensureSchema = z.object({ templateKey: z.enum(TEAM_TEMPLATE_KEYS) });

const MANAGE = { anyOf: ["manage"] } as const;
const AUDIT_PATH = "reimbursement_team";

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/admin/reimbursements/team`);
  revalidatePath(`/o/${slug}/admin/reimbursements`);
}

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string> } {
  const fieldErrors = zodFieldErrors(error);
  return { ok: false, error: Object.values(fieldErrors)[0] ?? COPY.form.saveFailed, fieldErrors };
}

export async function grantTreasuryRoleAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ grantId: string }>> {
  const gate = await gateReimbursementAction(slug, MANAGE);
  if (!gate.ok) return gate;
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await grantTreasuryRole("reimbursement", gate.personId, gate.organizationId, gate.userId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: COPY.team.forbidden };
    case "invalid_role":
      return { ok: false, error: COPY.team.invalidRole };
    case "invalid_target":
      return { ok: false, error: COPY.team.notAMember };
    case "not_treasury_only":
      return { ok: false, error: COPY.team.notTreasuryOnly };
    case "escalation_denied":
      return { ok: false, error: COPY.team.escalation(result.missingPermissions.join(", ")) };
    case "already_granted":
      return { ok: false, error: COPY.team.alreadyGranted };
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
      path: AUDIT_PATH,
    },
  });
  revalidate(slug);
  return { ok: true, data: { grantId: result.grantId } };
}

export async function revokeTreasuryRoleAction(slug: string, input: unknown): Promise<ReimbursementActionResult> {
  const gate = await gateReimbursementAction(slug, MANAGE);
  if (!gate.ok) return gate;
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await revokeTreasuryRole("reimbursement", gate.personId, gate.organizationId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: COPY.team.forbidden };
    case "not_found":
      return { ok: false, error: COPY.team.assignmentEnded };
    case "not_treasury_only":
      return { ok: false, error: COPY.team.endFromRoles };
    case "last_manager_blocked":
      return { ok: false, error: COPY.team.lastManager };
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
      path: AUDIT_PATH,
    },
  });
  revalidate(slug);
  return { ok: true, data: undefined };
}

export async function ensureTreasuryRoleAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ roleId: string; skippedKeys: string[] }>> {
  const gate = await gateReimbursementAction(slug, MANAGE);
  if (!gate.ok) return gate;
  const parsed = ensureSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await ensureTreasuryRole("reimbursement", gate.personId, gate.organizationId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: COPY.team.forbidden };
    case "template_not_found":
      return { ok: false, error: COPY.team.templateUnavailable };
    case "not_treasury_only":
      return { ok: false, error: COPY.team.notTreasuryOnly };
    case "escalation_denied":
      return { ok: false, error: COPY.team.ensureEscalation(result.missingPermissions.join(", ")) };
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
        path: AUDIT_PATH,
      },
    });
  }
  revalidate(slug);
  return { ok: true, data: { roleId: result.roleId, skippedKeys: result.skippedKeys } };
}
