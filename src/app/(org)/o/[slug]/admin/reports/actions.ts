"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  generatePerCapitaRecords,
  recordPerCapitaPayment,
  setCongregationStatistics,
  setPerCapitaRate,
  type RecordPerCapitaPaymentInput,
  type SasrAggregateInput,
  type SetPerCapitaRateInput,
} from "@/lib/presbytery";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/reports` — Presbytery program
 * Increment 3b (`docs/work-log/2026-08-27-presbytery-program.md`). Same
 * shape as every other `actions.ts` under `(org)`: all SQL correctness
 * lives in and is proven by `src/lib/presbytery.ts`/`presbytery.test.ts` —
 * this file's only job is auth-in-the-action-body plumbing, the
 * error->copy mapping, and the audit write. `organizationId` NEVER comes
 * from client-supplied form data.
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
    return { ok: false, error: "You don't have access to that organization." };
  }

  return {
    ok: true,
    userId: session.user.id,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}

// ---------------------------------------------------------------------------
// setCongregationStatisticsAction
// ---------------------------------------------------------------------------

export async function setCongregationStatisticsAction(
  slug: string,
  aboutOrgId: string,
  year: number,
  input: SasrAggregateInput,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setCongregationStatistics(
    identity.personId,
    identity.organizationId,
    identity.userId,
    aboutOrgId,
    year,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage statistics here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error: "That congregation doesn't belong to this presbytery.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.CONGREGATION_STATISTICS_ENTERED,
    resourceType: "congregation_statistics",
    resourceId: result.data.id,
    metadata: { organizationId: identity.organizationId, aboutOrgId, year },
  });

  revalidatePath(`/o/${slug}/admin/reports`);

  return { ok: true, data: { id: result.data.id } };
}

// ---------------------------------------------------------------------------
// setPerCapitaRateAction
// ---------------------------------------------------------------------------

export async function setPerCapitaRateAction(
  slug: string,
  billingYear: number,
  input: SetPerCapitaRateInput,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setPerCapitaRate(
    identity.personId,
    identity.organizationId,
    identity.userId,
    billingYear,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage per-capita rates here.",
      };
    case "invalid_target":
      // Unreachable — setPerCapitaRate() never returns invalid_target (no
      // aboutOrgId to validate). Handled anyway rather than assumed, same
      // discipline every other actions.ts in this tree documents for its
      // own unreachable branches.
      return { ok: false, error: "That rate could not be found." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.PER_CAPITA_RATE_SET,
    resourceType: "per_capita_rates",
    resourceId: result.data.id,
    metadata: {
      organizationId: identity.organizationId,
      billingYear,
      basisYear: input.basisYear ?? billingYear - 2,
      ratePerMember: input.ratePerMember,
    },
  });

  revalidatePath(`/o/${slug}/admin/reports`);

  return { ok: true, data: { id: result.data.id } };
}

// ---------------------------------------------------------------------------
// generatePerCapitaRecordsAction
// ---------------------------------------------------------------------------

export async function generatePerCapitaRecordsAction(
  slug: string,
  billingYear: number,
): Promise<ActionResult<{ created: number; skipped: string[] }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await generatePerCapitaRecords(
    identity.personId,
    identity.organizationId,
    identity.userId,
    billingYear,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage per-capita records here.",
      };
    case "invalid_target":
      return { ok: false, error: "That billing year could not be found." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.PER_CAPITA_RECORDS_GENERATED,
    resourceType: "per_capita_records",
    resourceId: identity.organizationId,
    metadata: {
      organizationId: identity.organizationId,
      billingYear,
      created: result.data.created,
      skipped: result.data.skipped,
    },
  });

  revalidatePath(`/o/${slug}/admin/reports`);

  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// recordPerCapitaPaymentAction
// ---------------------------------------------------------------------------

export async function recordPerCapitaPaymentAction(
  slug: string,
  recordId: string,
  input: RecordPerCapitaPaymentInput,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await recordPerCapitaPayment(
    identity.personId,
    identity.organizationId,
    identity.userId,
    recordId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage per-capita payments here.",
      };
    case "invalid_target":
      return { ok: false, error: "That per-capita record no longer exists." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.PER_CAPITA_PAYMENT_RECORDED,
    resourceType: "per_capita_records",
    resourceId: recordId,
    metadata: {
      organizationId: identity.organizationId,
      recordId,
      paidAmount: input.paidAmount,
    },
  });

  revalidatePath(`/o/${slug}/admin/reports`);

  return { ok: true, data: { id: result.data.id } };
}
