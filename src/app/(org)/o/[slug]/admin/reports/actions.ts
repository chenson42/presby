"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  generatePerCapitaRecords,
  recordPerCapitaPayment,
  setCongregationStatistics,
  setPerCapitaRate,
  type RecordPerCapitaPaymentInput,
  type SasrAggregateInput,
  type SetPerCapitaRateInput,
} from "@/lib/presbytery";
import {
  issueStatisticsGrant,
  revokeStatisticsGrant,
  type IssueStatisticsGrantInput,
} from "@/lib/statistics-grants";
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

// ---------------------------------------------------------------------------
// issueStatisticsGrantAction / revokeStatisticsGrantAction
//
// Submission grants (increment 6, D16 / DECISION-147). SAME `resolveActing
// Identity(slug)` plumbing as every action above — `organizationId` never
// comes from client-supplied form data. All SQL correctness (the permission
// gate, the parent-path re-check, the partial-unique/trigger-literal
// translation) lives in and is proven by `src/lib/statistics-grants.ts` /
// `statistics-grants.test.ts`; this file's only job is auth-in-the-action-
// body plumbing, error->copy mapping, and the audit write. The THIRD action
// this feature needs — the public, session-less submission — lives in its
// own un-brandable route group, `src/app/(statistics-submit)/actions.ts`,
// never here.
// ---------------------------------------------------------------------------

export async function issueStatisticsGrantAction(
  slug: string,
  input: IssueStatisticsGrantInput,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  // Phase 5 FAIL-1 (docs/work-log/2026-09-25-submission-grants.md) —
  // Phase 1 and Phase 2's [BINDING] "issuance is separately limited per
  // issuing org" ruling, dropped without notation in Phase 3 and therefore
  // absent from Phase 4's build. Keyed on `organizationId` ALONE, on the
  // `(password-reset)/actions.ts` pattern (`checkRateLimit`, one call, one
  // friendly-error return) — deliberately NOT also per-user: this caps the
  // presbytery's total issuance volume regardless of which admin at that
  // org is issuing, which is the property that matters for the threat named
  // (a single compromised or careless clerk account amplifying outbound
  // email / mailbox flooding). A per-user key ADDED alongside the per-org
  // one would only ever widen the effective budget for an org with more
  // than one admin — a strictly weaker property — so it is not layered on
  // top. 30/hour is generous for a legitimate bulk pass (a large presbytery
  // issuing to every member congregation for a new report year in one
  // sitting) while still bounding the sustained-abuse ceiling Phase 5 named
  // (~200 queued emails per congregation across the report-year range).
  const limited = await checkRateLimit(
    `stats_grant_issue:${identity.organizationId}`,
    { max: 30, windowSeconds: 3600 },
    {
      userId: identity.userId,
      actor: identity.organizationId,
      reason: "statistics_grant_issue",
    },
  );
  if (!limited.allowed) {
    const mins = Math.ceil(limited.retryAfterSeconds / 60);
    return {
      ok: false,
      error: `Too many grants issued recently. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    };
  }

  const result = await issueStatisticsGrant(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to issue submission grants here.",
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
    action: AUDIT_ACTIONS.STATISTICS_GRANT_ISSUED,
    resourceType: "statistics_submission_grants",
    resourceId: result.data.id,
    metadata: {
      organizationId: identity.organizationId,
      aboutOrgId: input.aboutOrgId,
      reportYear: input.reportYear,
    },
  });

  revalidatePath(`/o/${slug}/admin/reports`);

  return { ok: true, data: { id: result.data.id } };
}

export async function revokeStatisticsGrantAction(
  slug: string,
  grantId: string,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await revokeStatisticsGrant(
    identity.personId,
    identity.organizationId,
    grantId,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to revoke submission grants here.",
      };
    case "invalid_target":
      return { ok: false, error: "That grant could not be found." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.STATISTICS_GRANT_REVOKED,
    resourceType: "statistics_submission_grants",
    resourceId: grantId,
    // Phase 5 Advisory 2 — restored to Phase 3's Audit Events block shape
    // (`{ organizationId, aboutOrgId, reportYear, grantId }`), thinned to
    // `{ organizationId, grantId }` in the first pass. `aboutOrgId`/
    // `reportYear` come from `revokeStatisticsGrant()`'s own pre-select — no
    // extra round trip.
    metadata: {
      organizationId: identity.organizationId,
      aboutOrgId: result.data.aboutOrgId,
      reportYear: result.data.reportYear,
      grantId,
    },
  });

  revalidatePath(`/o/${slug}/admin/reports`);

  return { ok: true, data: { id: result.data.id } };
}
