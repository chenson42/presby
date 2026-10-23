"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  gateGivingAction,
  invalidInput,
  type GivingActionResult,
} from "@/lib/giving/action-gate";
import { fundSchema, updateFundSchema } from "@/lib/giving/fund-input";
import { createFund, reactivateFund, retireFund, updateFund } from "@/lib/giving/funds";

/**
 * Server Actions for `/o/<slug>/admin/giving/funds` - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2. Every action: the shared gate (sign-in
 * -> Node-side 2FA -> four-way org resolve -> applicability and toggle ->
 * `giving.manage`), then validation, then exactly one `funds.ts` call, then the
 * audit write AFTER the commit and only on success, then `revalidatePath`.
 *
 * The audit metadata is ids and flags only: never a fund's name or description.
 */

const idSchema = z.object({ fundId: z.guid() });

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/admin/giving/funds`);
  revalidatePath(`/o/${slug}/admin/giving`);
}

export async function createFundAction(
  slug: string,
  input: unknown,
): Promise<GivingActionResult<{ fundId: string }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = fundSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await createFund(gate.personId, gate.organizationId, gate.userId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to manage funds here." };
    case "duplicate_name":
      return {
        ok: false,
        error: "A fund with that name already exists (a retired fund keeps its name).",
        fieldErrors: { name: "A fund with that name already exists" },
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_FUND_CREATED,
    resourceType: "giving_fund",
    resourceId: result.fundId,
    metadata: {
      organizationId: gate.organizationId,
      fundId: result.fundId,
      restrictionClass: parsed.data.restrictionClass,
      offeredOnline: parsed.data.offeredOnline,
    },
  });
  revalidate(slug);
  return { ok: true, data: { fundId: result.fundId } };
}

export async function updateFundAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = updateFundSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fundId, ...values } = parsed.data;

  const result = await updateFund(gate.personId, gate.organizationId, gate.userId, fundId, values);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to manage funds here." };
    case "not_found":
      return { ok: false, error: "That fund no longer exists." };
    case "duplicate_name":
      return {
        ok: false,
        error: "A fund with that name already exists (a retired fund keeps its name).",
        fieldErrors: { name: "A fund with that name already exists" },
      };
    case "ok":
      break;
  }

  if (result.changedFields.length > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_FUND_UPDATED,
      resourceType: "giving_fund",
      resourceId: fundId,
      metadata: { organizationId: gate.organizationId, fundId, fields: result.changedFields },
    });
  }
  revalidate(slug);
  return { ok: true };
}

/** `confirm` is set by the client only after the AlertDialog for "the last online fund". */
export async function retireFundAction(
  slug: string,
  input: { fundId: string; confirm?: boolean },
): Promise<GivingActionResult<{ confirmRequired?: "last_online_fund" }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await retireFund(gate.personId, gate.organizationId, gate.userId, parsed.data.fundId, {
    confirm: input.confirm === true,
  });
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to manage funds here." };
    case "not_found":
      return { ok: false, error: "That fund no longer exists." };
    case "already_retired":
      return { ok: false, error: "That fund is already retired." };
    case "confirm_required":
      return { ok: true, data: { confirmRequired: result.reason } };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_FUND_RETIRED,
    resourceType: "giving_fund",
    resourceId: parsed.data.fundId,
    metadata: { organizationId: gate.organizationId, fundId: parsed.data.fundId },
  });
  revalidate(slug);
  return { ok: true, data: {} };
}

export async function reactivateFundAction(
  slug: string,
  input: { fundId: string },
): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await reactivateFund(gate.personId, gate.organizationId, gate.userId, parsed.data.fundId);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to manage funds here." };
    case "not_found":
      return { ok: false, error: "That fund no longer exists." };
    case "already_active":
      return { ok: false, error: "That fund is already active." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_FUND_REACTIVATED,
    resourceType: "giving_fund",
    resourceId: parsed.data.fundId,
    metadata: { organizationId: gate.organizationId, fundId: parsed.data.fundId },
  });
  revalidate(slug);
  return { ok: true };
}

/** The empty state's one-click "Create General Fund": unrestricted, not offered online. */
export async function createGeneralFundAction(
  slug: string,
): Promise<GivingActionResult<{ fundId: string }>> {
  return createFundAction(slug, {
    name: "General Fund",
    restrictionClass: "unrestricted",
    offeredOnline: false,
  });
}
