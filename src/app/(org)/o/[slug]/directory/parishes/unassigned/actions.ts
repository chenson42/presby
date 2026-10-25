"use server";

import { revalidatePath } from "next/cache";
import { moveHousehold } from "@/lib/parishes";
import type { ActionResult } from "@/types/actions";
import { resolveActingIdentity } from "../acting-identity";
import { parseMoveInput } from "../move-input";
import { describeParishFailure, describeParishThrow } from "../parish-failure";

/**
 * The Unassigned page's server action: assign a household to a district, and
 * Undo it (docs/work-log/2026-10-25-parish-management.md, Phase 3 "Server
 * actions"). The same `moveHousehold()` the district page uses - a first
 * assignment passes `expectedOrgUnitId: null`, and Undo passes the assigned
 * district as expected and `null` as the target (a clear is a write, never a
 * delete). All rules, the lock order and the audit row are in
 * `src/lib/parishes.ts`; this file is identity, shape validation and copy. No
 * `recordAudit()` here: the library audits in the same transaction.
 */

export interface AssignActionData {
  changed: boolean;
  fromOrgUnitId: string | null;
  toOrgUnitId: string | null;
  fromName: string | null;
  toName: string | null;
}

export async function assignHouseholdAction(
  slug: string,
  input: {
    householdId: string;
    expectedOrgUnitId: string | null;
    targetOrgUnitId: string | null;
    undo?: boolean;
  },
): Promise<ActionResult<AssignActionData>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = parseMoveInput(input);
  const kind = parsed?.undo ? "undo" : "assign";
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
    revalidatePath(`/o/${slug}/directory/parishes`, "layout");
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
