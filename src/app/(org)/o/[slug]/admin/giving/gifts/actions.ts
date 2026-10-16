"use server";

import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  gateGivingAction,
  invalidInput,
  type GivingActionResult,
} from "@/lib/giving/action-gate";
import { searchDonors, type DonorPickerRow } from "@/lib/giving/donors";
import { recordOfflineGift, voidGift } from "@/lib/giving/gifts";
import { offlineGiftSchema, voidGiftSchema } from "@/lib/giving/gift-input";

/**
 * Server Actions for the gift pages - docs/work-log/2026-10-15-online-giving.md,
 * Batch 2. Shared gate first (sign-in -> Node-side 2FA -> org resolve ->
 * toggle -> key), then validation, then one `gifts.ts` call, then the audit
 * write AFTER the commit and only on success.
 *
 * The audit metadata is ids, the method and the amount in cents - never a
 * donor's name or email, never a memo, never a void reason (the reason is a row
 * on the reversal, where `giving.view` can read it).
 *
 * The two SOFT WARNINGS (a possible duplicate gift, a possible duplicate donor)
 * come back as `ok: true` with a `status` the form renders inline; nothing was
 * written, and the form re-submits with `acknowledgeDuplicate: true` if the
 * person says it is a different gift.
 */

export type RecordGiftOutcome =
  | { status: "recorded"; giftId: string; donorId: string }
  | { status: "duplicate_gift"; giftId: string }
  | { status: "duplicate_donor"; donors: Array<{ id: string; displayName: string }> };

export async function recordOfflineGiftAction(
  slug: string,
  input: unknown,
): Promise<GivingActionResult<RecordGiftOutcome>> {
  const gate = await gateGivingAction(slug, ["record"]);
  if (!gate.ok) return gate;
  const parsed = offlineGiftSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await recordOfflineGift(gate.personId, gate.organizationId, gate.userId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to record gifts here." };
    case "invalid":
      return { ok: false, error: "Check the highlighted fields and try again.", fieldErrors: result.fieldErrors };
    case "retired_fund":
      return {
        ok: false,
        error: "That fund is retired, so it can't take new gifts. Pick another fund.",
        fieldErrors: { fundId: "That fund is retired" },
      };
    case "future_date":
      return {
        ok: false,
        error: "That date is in the future (or before 2000). Gifts are recorded on the day they were given.",
        fieldErrors: { occurredOn: "That date can't be recorded" },
      };
    case "unidentified_method":
      return {
        ok: false,
        error: "Only cash can be recorded without a donor. Pick a donor for a check, stock or other gift.",
        fieldErrors: { method: "Only cash can be recorded without a donor" },
      };
    case "duplicate_warning":
      return { ok: true, data: { status: "duplicate_gift", giftId: result.giftId } };
    case "duplicate_donor":
      return { ok: true, data: { status: "duplicate_donor", donors: result.donors } };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_GIFT_RECORDED,
    resourceType: "giving_gift",
    resourceId: result.giftId,
    metadata: {
      organizationId: gate.organizationId,
      giftId: result.giftId,
      donorId: result.donorId,
      fundId: parsed.data.fundId,
      method: parsed.data.method,
      amountCents: result.amountCents,
      createdDonor: result.createdDonor,
    },
  });
  if (result.createdDonor) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_DONOR_CREATED,
      resourceType: "giving_donor",
      resourceId: result.donorId,
      metadata: { organizationId: gate.organizationId, donorId: result.donorId, via: "offline_gift" },
    });
  }
  revalidatePath(`/o/${slug}/admin/giving/gifts`);
  revalidatePath(`/o/${slug}/admin/giving/donors`);
  revalidatePath(`/o/${slug}/admin/giving`);
  return { ok: true, data: { status: "recorded", giftId: result.giftId, donorId: result.donorId } };
}

export async function voidGiftAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["record"]);
  if (!gate.ok) return gate;
  const parsed = voidGiftSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await voidGift(gate.personId, gate.organizationId, gate.userId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You can't void this gift. A recorder can void their own entries for 30 days; the treasurer can void any offline gift.",
      };
    case "not_found":
      return { ok: false, error: "That gift no longer exists." };
    case "invalid":
      return { ok: false, error: "Give a reason for voiding this gift.", fieldErrors: result.fieldErrors };
    case "not_voidable":
      return {
        ok: false,
        error:
          result.reason === "already_voided"
            ? "That gift has already been voided."
            : result.reason === "outside_window"
              ? "You can void your own entries for 30 days. Ask the treasurer to void this one."
              : result.reason === "not_offline"
                ? "Only gifts recorded by hand can be voided here. Refund an online gift in Stripe."
                : "Only a completed gift can be voided.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_GIFT_VOIDED,
    resourceType: "giving_gift",
    resourceId: parsed.data.giftId,
    metadata: {
      organizationId: gate.organizationId,
      giftId: parsed.data.giftId,
      reversalId: result.reversalId,
      amountCents: result.amountCents,
    },
  });
  revalidatePath(`/o/${slug}/admin/giving/gifts`);
  revalidatePath(`/o/${slug}/admin/giving/gifts/${parsed.data.giftId}`);
  revalidatePath(`/o/${slug}/admin/giving/gifts/new`);
  return { ok: true };
}

/** The donor picker's typeahead: name, kind and a has-email boolean, at most 20. */
export async function searchDonorsAction(
  slug: string,
  query: string,
): Promise<GivingActionResult<{ donors: DonorPickerRow[] }>> {
  const gate = await gateGivingAction(slug, ["record", "view"]);
  if (!gate.ok) return gate;
  const result = await searchDonors(gate.personId, gate.organizationId, typeof query === "string" ? query : "");
  if (result.kind === "forbidden") {
    return { ok: false, error: "You don't have permission to look up donors here." };
  }
  return { ok: true, data: { donors: result.donors } };
}
