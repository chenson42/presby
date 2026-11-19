"use server";

import { finish, invalidResult, resolveCommitteesActor } from "@/lib/committees/action-gate";
import type { CommitteesActionResult } from "@/lib/committees/contract";
import { createCommittee } from "@/lib/committees/store";
import { parseCommittee, type CommitteeValues } from "@/lib/committees/validate";

/**
 * Create a committee (docs/work-log/2026-11-19-presbytery-committees.md, Phase 3
 * "API Contract", Increment 1). Authenticate (Node-side second-factor recheck) ->
 * resolve the organization from the slug -> pure parse -> `store.ts`, where the key
 * (`groups.manage`), the organization type and the duplicate-name check are made
 * again inside the transaction and the audit row is written in that same
 * transaction. `organizationId` is never a parameter.
 */
export async function createCommitteeAction(slug: string, values: CommitteeValues): Promise<CommitteesActionResult> {
  const gate = await resolveCommitteesActor(slug);
  if (!gate.ok) return gate.result;
  const parsed = parseCommittee(values);
  if (!parsed.ok) return invalidResult(parsed);
  return finish(gate.identity, null, await createCommittee(gate.identity.ctx, parsed.value));
}
