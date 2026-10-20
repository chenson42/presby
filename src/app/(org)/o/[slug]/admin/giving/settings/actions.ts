"use server";

import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  gateGivingAction,
  invalidInput,
  type GivingActionResult,
} from "@/lib/giving/action-gate";
import { updateGivingSettings } from "@/lib/giving/settings";
import { givingSettingsSchema } from "@/lib/giving/settings-input";

/**
 * Server Action for `/o/<slug>/admin/giving/settings` - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2. Shared gate (`giving.manage`), then
 * validation, then the upsert, then ONE audit event carrying the NAMES of the
 * fields that changed - never the legal name, address or EIN themselves.
 */
export async function updateGivingSettingsAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = givingSettingsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await updateGivingSettings(gate.personId, gate.organizationId, gate.userId, parsed.data);
  if (result.kind === "forbidden") {
    return { ok: false, error: "You don't have permission to change giving settings here." };
  }

  if (result.changedFields.length > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_SETTINGS_CHANGED,
      resourceType: "giving_settings",
      resourceId: gate.organizationId,
      metadata: { organizationId: gate.organizationId, fields: result.changedFields },
    });
  }
  revalidatePath(`/o/${slug}/admin/giving/settings`);
  revalidatePath(`/o/${slug}/admin/giving`);
  return { ok: true };
}
