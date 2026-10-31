import "server-only";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit-tx";
import { withOrgContext } from "@/lib/authz";
import { auditReimbursement } from "./audit";
import { isNotPermitted, rowsOf } from "./db-util";
import type { RequestActor } from "./requests";

/**
 * The configuration a `reimbursement.manage` holder sets: which groups can
 * receive requests, and the one category list - docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 file plan (`config.ts`), P3-4, R9, EC30. The pages
 * and `admin/reimbursements/actions.ts` are Batch 4 and 6; this is the library
 * under them.
 *
 * Each function runs in ONE `withOrgContext`: the definer call (which requires
 * `reimbursement.manage` and answers an identity refusal otherwise), then the
 * audit row in the same transaction, committed together (P3-20). An unchanged
 * answer writes NO audit row. Metadata is ids and tags only - never a category
 * name (a name is free text).
 *
 *   chargeable groups: any group of the organization may be chargeable,
 *     including a derived one (Session, Diaconate); those have no chair or
 *     leader rows, so their requests take the treasurer path (operator Q5).
 *     Un-listing a group ends the row (`ended_at`), never deletes it, and a
 *     request already in that group keeps going.
 *   categories: one list per organization (P3-4), required at submit when any
 *     is active. A retired category stays on old requests; a rename keeps the
 *     id.
 */

type ConfigActor = Pick<RequestActor, "userId" | "email" | "personId" | "organizationId">;

export type SetChargeableResult =
  | { kind: "ok"; changed: boolean }
  | { kind: "refused"; outcome: "group_unavailable" }
  | { kind: "denied" };

export async function setChargeable(
  actor: ConfigActor,
  input: { groupId: string; chargeable: boolean },
): Promise<SetChargeableResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<SetChargeableResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_set_chargeable(
            ${input.groupId}::uuid, ${input.chargeable}::boolean, ${actor.userId}::uuid)`),
      )[0]!;
      if (out.outcome === "group_unavailable") return { kind: "refused", outcome: "group_unavailable" };
      if (out.outcome === "unchanged") return { kind: "ok", changed: false };
      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_CHARGEABLE_CHANGED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_group",
        resourceId: input.groupId,
        metadata: { groupId: input.groupId, chargeable: input.chargeable },
      });
      return { kind: "ok", changed: true };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

export type SaveCategoryResult =
  | { kind: "ok"; categoryId: string; created: boolean }
  | { kind: "refused"; outcome: "not_found" | "name_invalid" | "name_taken" }
  | { kind: "denied" };

/** Create (no `categoryId`) or rename/reorder a live category. */
export async function saveCategory(
  actor: ConfigActor,
  input: { categoryId: string | null; name: string; sortOrder: number | null },
): Promise<SaveCategoryResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<SaveCategoryResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_save_category(
            ${input.categoryId}::uuid, ${input.name}::text, ${input.sortOrder}::integer, ${actor.userId}::uuid)`),
      )[0]!;
      if (out.outcome !== "ok") {
        return { kind: "refused", outcome: out.outcome as "not_found" | "name_invalid" | "name_taken" };
      }
      const categoryId = String(out.category_id);
      const created = input.categoryId === null;
      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_CATEGORY_CHANGED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_category",
        resourceId: categoryId,
        metadata: { categoryId, change: created ? "created" : "renamed" },
      });
      return { kind: "ok", categoryId, created };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

export type EndCategoryResult =
  | { kind: "ok" }
  | { kind: "refused"; outcome: "not_found" }
  | { kind: "denied" };

/** Retire a category: it stays on old requests and drops off the form. */
export async function endCategory(actor: ConfigActor, input: { categoryId: string }): Promise<EndCategoryResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<EndCategoryResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_end_category(${input.categoryId}::uuid, ${actor.userId}::uuid)`),
      )[0]!;
      if (out.outcome !== "ok") return { kind: "refused", outcome: "not_found" };
      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_CATEGORY_CHANGED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_category",
        resourceId: input.categoryId,
        metadata: { categoryId: input.categoryId, change: "retired" },
      });
      return { kind: "ok" };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}
