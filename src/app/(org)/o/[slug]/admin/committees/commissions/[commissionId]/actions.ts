"use server";

import {
  finishCommission,
  invalidResult,
  resolveCommitteesActor,
  tamperedResult,
} from "@/lib/committees/action-gate";
import type { CommitteesActionResult } from "@/lib/committees/contract";
import {
  addCommissionMember,
  endCommission,
  endCommissionMember,
  removeCommissionRecord,
  updateCommission,
} from "@/lib/committees/store";
import {
  parseCommission,
  parseCommissionMember,
  parseEndCommission,
  parseEndSeat,
  parseExpectedVersion,
  type CommissionValues,
  type EndCommissionValues,
  type EndSeatValues,
  type SeatValues,
} from "@/lib/committees/validate";

/**
 * The actions on one commission record (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 3 "API Contract", Increment 2; all key `groups.manage`). Every
 * one: authenticate (Node-side second-factor recheck) -> resolve the organization from
 * the slug -> the `org_portal.committees` flag -> UUID check on every id -> pure parse
 * -> `store.ts` (the key, the organization type and the record are checked again inside
 * its transaction; the audit row is written in that same transaction). The record's id
 * travels with the form's values (a plain object of strings, never `FormData`);
 * `organizationId` is never a parameter. Nothing here writes a group, a role or a
 * delegation: a commission record grants no one anything.
 */

/** A form's value object, read defensively: a Server Action receives whatever the client sent. */
const bag = (values: unknown): Record<string, unknown> =>
  values !== null && typeof values === "object" ? (values as Record<string, unknown>) : {};

export async function updateCommissionAction(
  slug: string,
  values: CommissionValues & { commissionId: string; expectedVersion: string | number },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { commissionId: v.commissionId });
  if (!gate.ok) return gate.result;
  const parsed = parseCommission(v);
  if (!parsed.ok) return invalidResult(parsed);
  const expectedVersion = parseExpectedVersion(v.expectedVersion);
  if (expectedVersion === null) return tamperedResult;
  const commissionId = v.commissionId as string;
  return finishCommission(
    gate.identity,
    commissionId,
    await updateCommission(gate.identity.ctx, commissionId, parsed.value, expectedVersion),
  );
}

export async function addCommissionMemberAction(
  slug: string,
  values: SeatValues & { commissionId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { commissionId: v.commissionId });
  if (!gate.ok) return gate.result;
  const parsed = parseCommissionMember(v, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const commissionId = v.commissionId as string;
  return finishCommission(
    gate.identity,
    commissionId,
    await addCommissionMember(gate.identity.ctx, commissionId, parsed.value),
  );
}

export async function endCommissionMemberAction(
  slug: string,
  values: EndSeatValues & { commissionId: string; memberId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { commissionId: v.commissionId, memberId: v.memberId });
  if (!gate.ok) return gate.result;
  const parsed = parseEndSeat(v, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const commissionId = v.commissionId as string;
  return finishCommission(
    gate.identity,
    commissionId,
    await endCommissionMember(gate.identity.ctx, commissionId, v.memberId as string, parsed.value),
  );
}

export async function endCommissionAction(
  slug: string,
  values: EndCommissionValues & { commissionId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { commissionId: v.commissionId });
  if (!gate.ok) return gate.result;
  const parsed = parseEndCommission(v, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const commissionId = v.commissionId as string;
  return finishCommission(gate.identity, commissionId, await endCommission(gate.identity.ctx, commissionId, parsed.value));
}

export async function removeCommissionRecordAction(
  slug: string,
  values: { commissionId: string },
): Promise<CommitteesActionResult> {
  const v = bag(values);
  const gate = await resolveCommitteesActor(slug, { commissionId: v.commissionId });
  if (!gate.ok) return gate.result;
  const commissionId = v.commissionId as string;
  return finishCommission(gate.identity, commissionId, await removeCommissionRecord(gate.identity.ctx, commissionId));
}
