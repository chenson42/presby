"use server";

import { finish, invalidResult, parseVersion, resolveOversightActor, staleResult } from "@/lib/oversight/action-gate";
import type { OversightActionResult } from "@/lib/oversight/contract";
import { recordInsurance, removeInsurance, updateInsurance } from "@/lib/oversight/store";
import { parseInsurance, type InsuranceValues } from "@/lib/oversight/validate";

/**
 * The insurance actions (docs/work-log/2026-11-17-congregation-profile.md, Phase 3
 * "API Contract"). All `congregation_oversight.finance` (tier 2), checked inside
 * `store.ts`'s transaction, which writes the audit row in that same transaction.
 * The policy year is not editable: to correct it, remove the record and record it
 * again.
 */

export async function recordInsuranceAction(
  slug: string,
  aboutOrgId: string,
  values: InsuranceValues,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId });
  if (!gate.ok) return gate.result;
  const parsed = parseInsurance(values, gate.identity.env, "create");
  if (!parsed.ok) return invalidResult(parsed);
  return finish(gate.identity, aboutOrgId, await recordInsurance(gate.identity.ctx, aboutOrgId, parsed.value));
}

export async function updateInsuranceAction(
  slug: string,
  aboutOrgId: string,
  recordId: string,
  values: InsuranceValues,
  expectedVersion: number,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, recordId });
  if (!gate.ok) return gate.result;
  const parsed = parseInsurance(values, gate.identity.env, "edit");
  if (!parsed.ok) return invalidResult(parsed);
  const version = parseVersion(expectedVersion);
  if (version === null) return staleResult;
  return finish(
    gate.identity,
    aboutOrgId,
    await updateInsurance(gate.identity.ctx, aboutOrgId, recordId, parsed.value, version),
  );
}

export async function removeInsuranceAction(
  slug: string,
  aboutOrgId: string,
  recordId: string,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, recordId });
  if (!gate.ok) return gate.result;
  return finish(gate.identity, aboutOrgId, await removeInsurance(gate.identity.ctx, aboutOrgId, recordId));
}
