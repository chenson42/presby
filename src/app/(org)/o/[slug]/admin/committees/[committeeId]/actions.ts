"use server";

import {
  finish,
  invalidResult,
  resolveCommitteesActor,
  tamperedResult,
} from "@/lib/committees/action-gate";
import type { CommitteesActionResult } from "@/lib/committees/contract";
import {
  addCommitteeSeat,
  changeCommitteeSeatRole,
  dissolveCommittee,
  endCommitteeSeat,
  setCommitteeSeatPublicListed,
  updateCommittee,
} from "@/lib/committees/store";
import {
  parseChangeRole,
  parseCommittee,
  parseDissolve,
  parseEndSeat,
  parseSeat,
  type ChangeRoleValues,
  type CommitteeValues,
  type DissolveValues,
  type EndSeatValues,
  type SeatValues,
} from "@/lib/committees/validate";

/**
 * The actions on one committee (docs/work-log/2026-11-19-presbytery-committees.md,
 * Phase 3 "API Contract", Increment 1). Every one: authenticate (Node-side
 * second-factor recheck) -> resolve the organization from the slug -> UUID check
 * on every id -> pure parse -> `store.ts` (the key, the organization type and the
 * committee are checked again inside its transaction; the audit row is written in
 * that same transaction). All key `groups.manage`. `organizationId` is never a
 * parameter, and the committee's id travels with the form's values (a plain object
 * of strings, never `FormData`).
 */

/** A form's value object, read defensively: a Server Action receives whatever the client sent. */
const bag = (values: unknown): Record<string, unknown> =>
  values !== null && typeof values === "object" ? (values as Record<string, unknown>) : {};

export async function updateCommitteeAction(
  slug: string,
  values: CommitteeValues & { committeeId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { committeeId: v.committeeId });
  if (!gate.ok) return gate.result;
  const parsed = parseCommittee(v);
  if (!parsed.ok) return invalidResult(parsed);
  const committeeId = v.committeeId as string;
  return finish(gate.identity, committeeId, await updateCommittee(gate.identity.ctx, committeeId, parsed.value));
}

export async function dissolveCommitteeAction(
  slug: string,
  values: DissolveValues & { committeeId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { committeeId: v.committeeId });
  if (!gate.ok) return gate.result;
  const parsed = parseDissolve(v, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const committeeId = v.committeeId as string;
  return finish(
    gate.identity,
    committeeId,
    await dissolveCommittee(gate.identity.ctx, committeeId, parsed.value.dissolvedOn),
  );
}

export async function addCommitteeSeatAction(
  slug: string,
  values: SeatValues & { committeeId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { committeeId: v.committeeId });
  if (!gate.ok) return gate.result;
  const parsed = parseSeat(v, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const committeeId = v.committeeId as string;
  return finish(gate.identity, committeeId, await addCommitteeSeat(gate.identity.ctx, committeeId, parsed.value));
}

export async function changeCommitteeSeatRoleAction(
  slug: string,
  values: ChangeRoleValues & { committeeId: string; membershipId: string; expectedRole: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { committeeId: v.committeeId, membershipId: v.membershipId });
  if (!gate.ok) return gate.result;
  const parsed = parseChangeRole(v, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const committeeId = v.committeeId as string;
  const expectedRole = typeof v.expectedRole === "string" ? v.expectedRole : "";
  return finish(
    gate.identity,
    committeeId,
    await changeCommitteeSeatRole(gate.identity.ctx, committeeId, v.membershipId as string, {
      expectedRole,
      newRole: parsed.value.newRole,
      effectiveOn: parsed.value.effectiveOn,
    }),
  );
}

export async function endCommitteeSeatAction(
  slug: string,
  values: EndSeatValues & { committeeId: string; membershipId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { committeeId: v.committeeId, membershipId: v.membershipId });
  if (!gate.ok) return gate.result;
  const parsed = parseEndSeat(v, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const committeeId = v.committeeId as string;
  return finish(
    gate.identity,
    committeeId,
    await endCommitteeSeat(gate.identity.ctx, committeeId, v.membershipId as string, parsed.value),
  );
}

export async function setCommitteeSeatPublicListedAction(
  slug: string,
  values: { committeeId: string; membershipId: string; publicListed: boolean },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { committeeId: v.committeeId, membershipId: v.membershipId });
  if (!gate.ok) return gate.result;
  if (typeof v.publicListed !== "boolean") return tamperedResult;
  const committeeId = v.committeeId as string;
  return finish(
    gate.identity,
    committeeId,
    await setCommitteeSeatPublicListed(gate.identity.ctx, committeeId, v.membershipId as string, v.publicListed),
  );
}
