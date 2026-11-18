"use server";

import { finish, invalidResult, resolveOversightActor } from "@/lib/oversight/action-gate";
import type { OversightActionResult } from "@/lib/oversight/contract";
import { recordAppraisal, removeAppraisal } from "@/lib/oversight/store";
import { parseAppraisal, type AppraisalValues } from "@/lib/oversight/validate";

/**
 * The appraisal actions (docs/work-log/2026-11-17-congregation-profile.md, Phase 3
 * "API Contract"; T4: an appraisal is recorded and removed, never edited). Both
 * need `congregation_oversight.finance`, checked inside `store.ts`'s transaction,
 * which writes the audit row in that same transaction. The building is resolved
 * only under `(presbytery, congregation)`; a miss is the one `not_found`.
 */

export async function recordAppraisalAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  values: AppraisalValues,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId });
  if (!gate.ok) return gate.result;
  const parsed = parseAppraisal(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  return finish(
    gate.identity,
    aboutOrgId,
    await recordAppraisal(gate.identity.ctx, aboutOrgId, buildingId, parsed.value),
    { assessedYear: parsed.value.assessedYear },
  );
}

export async function removeAppraisalAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  appraisalId: string,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId, appraisalId });
  if (!gate.ok) return gate.result;
  return finish(
    gate.identity,
    aboutOrgId,
    await removeAppraisal(gate.identity.ctx, aboutOrgId, buildingId, appraisalId),
  );
}
