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
  confirmLink,
  createDonor,
  dismissLink,
  mergeDonors,
  removeLink,
  updateDonorContact,
} from "@/lib/giving/donors";
import { createDonorSchema, updateDonorContactSchema } from "@/lib/giving/donor-input";

/**
 * Server Actions for the donor pages - docs/work-log/2026-10-15-online-giving.md,
 * Batch 2. Shared gate first, then validation, one `donors.ts` call, the audit
 * write after the commit, `revalidatePath`.
 *
 * Audit metadata is ids and field NAMES: never a donor's name, email, address,
 * or the member's name (the link events name the membership id).
 */

const linkSchema = z.object({ donorId: z.guid(), membershipId: z.guid() });
const donorIdSchema = z.object({ donorId: z.guid() });
const mergeSchema = z.object({ sourceId: z.guid(), targetId: z.guid() });

function revalidateDonor(slug: string, donorId: string) {
  revalidatePath(`/o/${slug}/admin/giving/donors`);
  revalidatePath(`/o/${slug}/admin/giving/donors/${donorId}`);
  revalidatePath(`/o/${slug}/admin/giving`);
}

export async function createDonorAction(
  slug: string,
  input: unknown,
  options: { acknowledgeDuplicate?: boolean } = {},
): Promise<
  GivingActionResult<
    | { status: "created"; donorId: string }
    | { status: "duplicate_donor"; donors: Array<{ id: string; displayName: string }> }
  >
> {
  const gate = await gateGivingAction(slug, ["record"]);
  if (!gate.ok) return gate;
  const parsed = createDonorSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await createDonor(gate.personId, gate.organizationId, gate.userId, parsed.data, {
    acknowledgeDuplicate: options.acknowledgeDuplicate === true,
  });
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to add donors here." };
    case "duplicate_warning":
      return { ok: true, data: { status: "duplicate_donor", donors: result.donors } };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_DONOR_CREATED,
    resourceType: "giving_donor",
    resourceId: result.donorId,
    metadata: { organizationId: gate.organizationId, donorId: result.donorId, via: "donor_form" },
  });
  revalidateDonor(slug, result.donorId);
  return { ok: true, data: { status: "created", donorId: result.donorId } };
}

export async function updateDonorContactAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = updateDonorContactSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await updateDonorContact(gate.personId, gate.organizationId, gate.userId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to edit donors here." };
    case "not_found":
      return { ok: false, error: "That donor no longer exists." };
    case "not_editable":
      return { ok: false, error: "That donor can't be edited (a plate offering, or merged into another donor)." };
    case "ok":
      break;
  }

  if (result.changedFields.length > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_DONOR_CONTACT_CHANGED,
      resourceType: "giving_donor",
      resourceId: parsed.data.donorId,
      metadata: {
        organizationId: gate.organizationId,
        donorId: parsed.data.donorId,
        fields: result.changedFields,
      },
    });
  }
  revalidateDonor(slug, parsed.data.donorId);
  return { ok: true };
}

export async function mergeDonorsAction(
  slug: string,
  input: { sourceId: string; targetId: string },
): Promise<GivingActionResult<{ targetId: string }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await mergeDonors(
    gate.personId,
    gate.organizationId,
    gate.userId,
    parsed.data.sourceId,
    parsed.data.targetId,
  );
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to merge donors here." };
    case "same_donor":
      return { ok: false, error: "Pick a different donor to merge into." };
    case "not_found":
      return { ok: false, error: "One of those donors no longer exists." };
    case "invalid_target":
      return { ok: false, error: "Those donors can't be merged (a plate offering, or one is already merged)." };
    case "link_conflict":
      return {
        ok: false,
        error: "Both donors are linked to different members. Remove one link first, then merge.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_DONOR_MERGED,
    resourceType: "giving_donor",
    resourceId: parsed.data.sourceId,
    metadata: {
      organizationId: gate.organizationId,
      sourceId: parsed.data.sourceId,
      targetId: parsed.data.targetId,
      repointedCount: result.repointedCount,
      inheritedLink: result.inheritedLink,
    },
  });
  revalidateDonor(slug, parsed.data.sourceId);
  revalidateDonor(slug, parsed.data.targetId);
  return { ok: true, data: { targetId: parsed.data.targetId } };
}

export async function confirmLinkAction(slug: string, input: unknown): Promise<GivingActionResult<{ personName: string }>> {
  const gate = await gateGivingAction(slug, ["record"]);
  if (!gate.ok) return gate;
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await confirmLink(
    gate.personId,
    gate.organizationId,
    gate.userId,
    parsed.data.donorId,
    parsed.data.membershipId,
  );
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to link donors here." };
    case "not_found":
      return { ok: false, error: "That donor no longer exists." };
    case "already_linked":
      return { ok: false, error: "That donor is already linked to a member." };
    case "no_proposal":
      return { ok: false, error: "That suggestion is no longer available. Reload the page." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_DONOR_LINK_CONFIRMED,
    resourceType: "giving_donor",
    resourceId: parsed.data.donorId,
    metadata: {
      organizationId: gate.organizationId,
      donorId: parsed.data.donorId,
      membershipId: parsed.data.membershipId,
    },
  });
  revalidateDonor(slug, parsed.data.donorId);
  return { ok: true, data: { personName: result.personName } };
}

export async function dismissLinkAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["record"]);
  if (!gate.ok) return gate;
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await dismissLink(
    gate.personId,
    gate.organizationId,
    gate.userId,
    parsed.data.donorId,
    parsed.data.membershipId,
  );
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to link donors here." };
    case "not_found":
      return { ok: false, error: "That suggestion is no longer available. Reload the page." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_DONOR_LINK_DISMISSED,
    resourceType: "giving_donor",
    resourceId: parsed.data.donorId,
    metadata: {
      organizationId: gate.organizationId,
      donorId: parsed.data.donorId,
      membershipId: parsed.data.membershipId,
    },
  });
  revalidateDonor(slug, parsed.data.donorId);
  return { ok: true };
}

export async function removeLinkAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["record"]);
  if (!gate.ok) return gate;
  const parsed = donorIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await removeLink(gate.personId, gate.organizationId, gate.userId, parsed.data.donorId);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to link donors here." };
    case "not_found":
      return { ok: false, error: "That donor no longer exists." };
    case "not_linked":
      return { ok: false, error: "That donor isn't linked to a member." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_DONOR_LINK_REMOVED,
    resourceType: "giving_donor",
    resourceId: parsed.data.donorId,
    metadata: {
      organizationId: gate.organizationId,
      donorId: parsed.data.donorId,
      membershipId: result.membershipId,
    },
  });
  revalidateDonor(slug, parsed.data.donorId);
  return { ok: true };
}
