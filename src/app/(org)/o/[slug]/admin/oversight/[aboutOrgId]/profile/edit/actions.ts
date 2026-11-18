"use server";

import { finish, invalidResult, parseVersion, resolveOversightActor, staleResult } from "@/lib/oversight/action-gate";
import type { OversightActionResult } from "@/lib/oversight/contract";
import { setProfile } from "@/lib/oversight/store";
import { parseProfile, type ProfileValues } from "@/lib/oversight/validate";

/**
 * The profile form's Server Action (docs/work-log/2026-11-17-congregation-
 * profile.md, Phase 3 "API Contract"). Authenticate (with the Node-side
 * second-factor recheck) -> resolve the organization from the slug -> UUID check
 * -> pure parse -> `store.ts`, which checks `congregation_oversight.manage` inside
 * its own transaction and writes the audit row in that same transaction.
 *
 * `expectedVersion` is `null` when the page showed no profile yet (a create) and
 * the row's `rowVersion` otherwise; a mismatch is `stale`.
 */
export async function setProfileAction(
  slug: string,
  aboutOrgId: string,
  values: ProfileValues,
  expectedVersion: number | null,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId });
  if (!gate.ok) return gate.result;
  const parsed = parseProfile(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  let version: number | null = null;
  if (expectedVersion !== null) {
    version = parseVersion(expectedVersion);
    if (version === null) return staleResult;
  }
  return finish(gate.identity, aboutOrgId, await setProfile(gate.identity.ctx, aboutOrgId, parsed.value, version));
}
