"use server";

import { revalidatePath } from "next/cache";
import { BULK_MOVE_MAX } from "@/lib/parishes-pure";
import { bulkMoveHouseholds, moveHousehold } from "@/lib/parishes";
import { isUuid } from "@/lib/is-uuid";
import type { ActionResult } from "@/types/actions";
import { resolveActingIdentity } from "../acting-identity";
import { parseMoveInput } from "../move-input";
import { describeParishFailure, describeParishThrow } from "../parish-failure";

/**
 * Server actions for `/o/<slug>/directory/parishes/<orgUnitId>` - move one
 * household (and Undo it, which is the same call with expected and target
 * swapped) and empty an archived district into an active one
 * (docs/work-log/2026-10-25-parish-management.md, Phase 3 "Server actions";
 * DECISION-245).
 *
 * The toggle, the authority (`parishes.assign` through the seat, or
 * `people.manage`), the expected-value conditional update, the lock order and
 * the audit rows live in `src/lib/parishes.ts` and are proven by
 * `parishes.test.ts`. This file does the identity plumbing, shape validation
 * (a bad id is "not found", never a cast error) and the copy mapping. The bulk
 * request carries NO household ids: `{ sourceOrgUnitId, targetOrgUnitId,
 * expectedCount }`, and its response carries counts and a district name only.
 * No `recordAudit()` here: the library audits in the same transaction.
 */

function revalidate(slug: string): void {
  revalidatePath(`/o/${slug}/directory/parishes`, "layout");
}

export interface MoveActionData {
  changed: boolean;
  fromOrgUnitId: string | null;
  toOrgUnitId: string | null;
  fromName: string | null;
  toName: string | null;
}

export async function moveHouseholdAction(
  slug: string,
  input: {
    householdId: string;
    expectedOrgUnitId: string | null;
    targetOrgUnitId: string | null;
    undo?: boolean;
  },
): Promise<ActionResult<MoveActionData>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = parseMoveInput(input);
  const kind = parsed?.undo ? "undo" : "move";
  if (!parsed) {
    return { ok: false, error: describeParishFailure({ kind: "not_found" }, { action: kind }) };
  }

  try {
    const result = await moveHousehold(
      identity.personId,
      identity.organizationId,
      { userId: identity.userId, email: identity.email },
      parsed,
    );
    if (result.kind !== "ok") {
      return { ok: false, error: describeParishFailure(result, { action: kind }) };
    }
    revalidate(slug);
    return {
      ok: true,
      data: {
        changed: result.changed,
        fromOrgUnitId: result.fromOrgUnitId,
        toOrgUnitId: result.toOrgUnitId,
        fromName: result.fromName,
        toName: result.toName,
      },
    };
  } catch (err) {
    return { ok: false, error: describeParishThrow(err, kind) };
  }
}

export interface BulkMoveActionData {
  moved: number;
  skipped: number;
  toName: string;
}

export async function bulkMoveAction(
  slug: string,
  input: { sourceOrgUnitId: string; targetOrgUnitId: string; expectedCount: number },
): Promise<ActionResult<BulkMoveActionData>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  if (
    typeof input !== "object" ||
    input === null ||
    !isUuid(input.sourceOrgUnitId) ||
    !isUuid(input.targetOrgUnitId)
  ) {
    return { ok: false, error: describeParishFailure({ kind: "not_found" }, { action: "bulk" }) };
  }
  const count = input.expectedCount;
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: describeParishFailure({ kind: "count_changed" }, { action: "bulk" }) };
  }
  if (count > BULK_MOVE_MAX) {
    return { ok: false, error: describeParishFailure({ kind: "too_many" }, { action: "bulk" }) };
  }

  try {
    const result = await bulkMoveHouseholds(
      identity.personId,
      identity.organizationId,
      { userId: identity.userId, email: identity.email },
      {
        sourceOrgUnitId: input.sourceOrgUnitId,
        targetOrgUnitId: input.targetOrgUnitId,
        expectedCount: count,
      },
    );
    if (result.kind !== "ok") {
      return { ok: false, error: describeParishFailure(result, { action: "bulk" }) };
    }
    revalidate(slug);
    return {
      ok: true,
      data: { moved: result.moved, skipped: result.skipped, toName: result.toName },
    };
  } catch (err) {
    return { ok: false, error: describeParishThrow(err, "bulk") };
  }
}
