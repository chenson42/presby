"use server";

import { finishCommission, invalidResult, resolveCommitteesActor } from "@/lib/committees/action-gate";
import type { CommitteesActionResult } from "@/lib/committees/contract";
import { recordCommission } from "@/lib/committees/store";
import { parseCommission, type CommissionValues } from "@/lib/committees/validate";

/**
 * Record an administrative commission (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 3 "API Contract", Increment 2; key `groups.manage`).
 * authenticate (Node-side second-factor recheck) -> resolve the organization from the
 * slug -> the `org_portal.committees` flag -> pure parse -> `store.ts` (the key, the
 * organization type and the congregation are checked again inside its transaction; the
 * audit row is written in that same transaction). `organizationId` is never a
 * parameter. The record is the presbytery's own note: it grants no one anything.
 */

/** A form's value object, read defensively: a Server Action receives whatever the client sent. */
const bag = (values: unknown): Record<string, unknown> =>
  values !== null && typeof values === "object" ? (values as Record<string, unknown>) : {};

export async function recordCommissionAction(slug: string, values: CommissionValues): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug);
  if (!gate.ok) return gate.result;
  const parsed = parseCommission(v);
  if (!parsed.ok) return invalidResult(parsed);
  return finishCommission(gate.identity, null, await recordCommission(gate.identity.ctx, parsed.value));
}
