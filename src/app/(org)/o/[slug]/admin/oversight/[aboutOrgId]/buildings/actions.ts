"use server";

import { finish, invalidResult, parseVersion, resolveOversightActor, staleResult } from "@/lib/oversight/action-gate";
import type { OversightActionResult } from "@/lib/oversight/contract";
import {
  createBuilding,
  reinstateBuilding,
  removeBuilding,
  retireBuilding,
  updateBuilding,
} from "@/lib/oversight/store";
import {
  parseBuilding,
  parseRetire,
  type BuildingValues,
  type RetireValues,
} from "@/lib/oversight/validate";

/**
 * The building actions (docs/work-log/2026-11-17-congregation-profile.md, Phase 3
 * "API Contract"). Every one: authenticate (Node-side second-factor recheck) ->
 * resolve the organization from the slug -> UUID check on every id -> pure parse ->
 * `store.ts` (the key, the congregation and the row are checked again inside its
 * transaction; the audit row is written in that same transaction). All
 * `congregation_oversight.manage`. `organizationId` is never a parameter.
 */

export async function createBuildingAction(
  slug: string,
  aboutOrgId: string,
  values: BuildingValues,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId });
  if (!gate.ok) return gate.result;
  const parsed = parseBuilding(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  return finish(gate.identity, aboutOrgId, await createBuilding(gate.identity.ctx, aboutOrgId, parsed.value));
}

export async function updateBuildingAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  values: BuildingValues,
  expectedVersion: number,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId });
  if (!gate.ok) return gate.result;
  const parsed = parseBuilding(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const version = parseVersion(expectedVersion);
  if (version === null) return staleResult;
  return finish(
    gate.identity,
    aboutOrgId,
    await updateBuilding(gate.identity.ctx, aboutOrgId, buildingId, parsed.value, version),
  );
}

export async function retireBuildingAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  values: RetireValues,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId });
  if (!gate.ok) return gate.result;
  const parsed = parseRetire(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  return finish(
    gate.identity,
    aboutOrgId,
    await retireBuilding(gate.identity.ctx, aboutOrgId, buildingId, parsed.value),
  );
}

export async function reinstateBuildingAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId });
  if (!gate.ok) return gate.result;
  return finish(gate.identity, aboutOrgId, await reinstateBuilding(gate.identity.ctx, aboutOrgId, buildingId));
}

export async function removeBuildingAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId });
  if (!gate.ok) return gate.result;
  return finish(gate.identity, aboutOrgId, await removeBuilding(gate.identity.ctx, aboutOrgId, buildingId));
}
