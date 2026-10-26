import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { isDirectoryListedPerson } from "@/lib/directory";
import { holdsPermissions } from "@/lib/treasury/keys";
import { isNotPermitted, rowsOf } from "./db-util";
import { memberDetailSchema, type MemberDetail } from "./detail-shape";
import type { SaveRequestValues } from "./input";
import { REIMBURSEMENT_KEYS } from "./keys";
import type { OutcomeOf, SubmitMissing, SubmitRoute } from "./outcomes";

/**
 * The requester's write path: save a draft, edit it, send it, withdraw it -
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 file plan (`requests.ts`),
 * P3-5, P3-8, EC1, EC2, EC15, EC17.
 *
 * Every function runs inside ONE `withOrgContext(personId, organizationId, …)`
 * and calls the SECURITY DEFINER doors with the acting `users.id` as the bounded
 * actor claim (last parameter), taken from the session by the caller and never
 * from a client. The definers derive the organization from `presby_current_org()`
 * and decide everything that matters (who may file, the freeze rules, the
 * revision check); this file only translates.
 *
 * A STATE refusal comes back as `{ kind: "refused", outcome }`; an IDENTITY
 * refusal (`reimbursement: not permitted`, SQLSTATE 42501) aborts the
 * transaction and is caught here, outside it, as `{ kind: "denied" }`. A missing
 * request and one the actor may not touch both answer `not_found`, from the
 * same path.
 *
 * NOT AUDITED, by design (the events table is the record): save, submit,
 * resubmit, withdraw. Receipts (attach, detach) belong to Batch 2b.
 */

export interface RequestActor {
  userId: string;
  email: string | null;
  personId: string;
  organizationId: string;
}

export type SaveOutcome = Exclude<OutcomeOf<"saveDraft"> | OutcomeOf<"updateRequest">, "ok">;

export type SaveRequestResult =
  | { kind: "ok"; requestId: string; revision: number; created: boolean }
  | { kind: "refused"; outcome: SaveOutcome }
  | { kind: "denied" };

const text = (value: string | null | undefined) => sql`${value ?? null}::text`;
const uuid = (value: string | null | undefined) => sql`${value ?? null}::uuid`;

/** The member-level detail of one request inside an open transaction (null: missing or not visible). */
async function memberDetailInTx(tx: OrgTx, requestId: string, userId: string): Promise<MemberDetail | null> {
  const rows = rowsOf(
    await tx.execute(sql`select presby_reimbursement_detail(${requestId}::uuid, ${userId}::uuid, 'member') as detail`),
  );
  const raw = rows[0]?.detail;
  if (raw === null || raw === undefined) return null;
  return memberDetailSchema.parse(raw);
}

/**
 * EC17: a posted beneficiary id is never trusted. When a reimbursement names
 * someone other than the actor, the actor must hold `request_for_others` (the
 * key FIRST, so a caller without it learns nothing about the person) and the
 * person must appear in the directory by the directory's own eligibility
 * predicate (`isDirectoryListedPerson`), so a `directory_hidden` member cannot be
 * named by a hand-posted id even though the picker would never offer them.
 * `null` means "the definer may decide".
 */
async function beneficiaryRefusal(
  tx: OrgTx,
  actor: RequestActor,
  values: SaveRequestValues,
  currentBeneficiaryId: string | null,
): Promise<"not_allowed_for_others" | "beneficiary_unavailable" | null> {
  if (values.kind !== "reimburse" || !values.beneficiaryPersonId) return null;
  if (values.beneficiaryPersonId === actor.personId) return null;
  // An unchanged payee on an edit is not re-judged (the database applies its
  // "as of now" checks only to a value being set or changed).
  if (currentBeneficiaryId !== null && values.beneficiaryPersonId === currentBeneficiaryId) return null;

  const [holds] = await holdsPermissions(tx, actor, [REIMBURSEMENT_KEYS.requestForOthers]);
  if (!holds) return "not_allowed_for_others";
  if (!(await isDirectoryListedPerson(tx, actor.organizationId, values.beneficiaryPersonId))) {
    return "beneficiary_unavailable";
  }
  return null;
}

/** The field list, in the order both write definers take it (after the keys that differ). */
function fieldArgs(values: SaveRequestValues) {
  return sql`${text(values.kind)}, ${uuid(values.groupId)}, ${uuid(values.beneficiaryPersonId)},
    ${text(values.vendorName)}, ${sql`${values.amountCents}::integer`}, ${sql`${values.expenseDate}::date`},
    ${text(values.purpose)}, ${uuid(values.categoryId)}, ${text(values.preApprovedBy)}, ${values.noReceiptClaimed}`;
}

async function updateInTx(
  tx: OrgTx,
  actor: RequestActor,
  requestId: string,
  expectedRevision: number,
  values: SaveRequestValues,
): Promise<SaveRequestResult> {
  const out = rowsOf(
    await tx.execute(sql`
      select * from presby_reimbursement_update_request(
        ${requestId}::uuid, ${expectedRevision}::integer, ${fieldArgs(values)}, ${actor.userId}::uuid)`),
  )[0]!;
  if (out.outcome !== "ok") return { kind: "refused", outcome: out.outcome as SaveOutcome };
  return { kind: "ok", requestId, revision: Number(out.revision), created: false };
}

/**
 * Create-or-find by `(organization, actor, clientKey)` (P3-5), or edit by id.
 *
 *   - No `requestId`: `save_draft`. A NEW row comes back `created: true`. If the
 *     key was already used (a double tap, a lost reply, or a second Save from
 *     the same open form) the existing row comes back UNTOUCHED, `created:
 *     false`; when the form also carried the `expectedRevision` it last saw,
 *     the edit is then applied with `update_request`, so a re-save from the
 *     same form is an edit and a double tap is a no-op (EC1).
 *   - A `requestId`: `update_request` with the `expectedRevision`
 *     (`changed_since_viewed` if it moved while the form was open).
 */
export async function saveRequest(actor: RequestActor, values: SaveRequestValues): Promise<SaveRequestResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx) => {
      if (values.requestId) {
        const current = await memberDetailInTx(tx, values.requestId, actor.userId);
        const currentBeneficiary = current?.payee.kind === "person" ? current.payee.personId : null;
        const refusal = await beneficiaryRefusal(tx, actor, values, currentBeneficiary);
        if (refusal) return { kind: "refused", outcome: refusal };
        return updateInTx(tx, actor, values.requestId, values.expectedRevision!, values);
      }

      const refusal = await beneficiaryRefusal(tx, actor, values, null);
      if (refusal) return { kind: "refused", outcome: refusal };

      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_save_draft(
            ${values.clientKey}::text, ${fieldArgs(values)}, ${actor.userId}::uuid)`),
      )[0]!;
      if (out.outcome !== "ok") return { kind: "refused", outcome: out.outcome as SaveOutcome };

      const requestId = String(out.request_id);
      if (out.created === true || values.expectedRevision === undefined || values.expectedRevision === null) {
        return { kind: "ok", requestId, revision: Number(out.revision), created: out.created === true };
      }
      // The key already names a request and the form carried the revision it last saw: an edit.
      return updateInTx(tx, actor, requestId, values.expectedRevision, values);
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export type SubmitOutcome = Exclude<OutcomeOf<"submit">, "ok" | "already_submitted" | "incomplete">;

export type SubmitRequestResult =
  | {
      kind: "ok";
      /** Where it waits, computed live; null when it was already past submission (`already_submitted`). */
      route: SubmitRoute | null;
      groupName: string | null;
      revision: number;
      /** True for `already_submitted`: a second tap on a request that is already in. Success, no second event. */
      already: boolean;
      /**
       * The people to tell (Batch 3 wires the notice into this same transaction):
       * the eligible approvers for route `seat`, every effective `pay` holder who
       * is not the requester or payee for route `treasurer`, empty otherwise.
       */
      notifyPersonIds: string[];
    }
  | { kind: "incomplete"; missing: SubmitMissing[] }
  | { kind: "refused"; outcome: SubmitOutcome }
  | { kind: "denied" };

/** Send (or send again) a draft or returned request, carrying the revision the requester saw. */
export async function submitRequest(
  actor: RequestActor,
  input: { requestId: string; expectedRevision: number },
): Promise<SubmitRequestResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<SubmitRequestResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_submit(
            ${input.requestId}::uuid, ${input.expectedRevision}::integer, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"submit">;
      if (outcome === "incomplete") {
        return { kind: "incomplete", missing: ((out.missing as string[] | null) ?? []) as SubmitMissing[] };
      }
      if (outcome === "ok" || outcome === "already_submitted") {
        const already = outcome === "already_submitted";
        let route = (out.route as SubmitRoute | null) ?? null;
        if (already && route === null) {
          // A request that is still waiting reports where; one already decided has no route.
          const detail = await memberDetailInTx(tx, input.requestId, actor.userId);
          route = detail?.route ?? null;
        }
        return {
          kind: "ok",
          route,
          groupName: (out.group_name as string | null) ?? null,
          revision: Number(out.revision),
          already,
          notifyPersonIds: ((out.notify_person_ids as string[] | null) ?? []).map(String),
        };
      }
      return { kind: "refused", outcome: outcome as SubmitOutcome };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Withdraw
// ---------------------------------------------------------------------------

export type WithdrawRequestResult =
  | { kind: "ok" }
  /** Paid, already withdrawn or voided. `status` lets the caller say "paid" only when it was paid. */
  | { kind: "not_withdrawable"; status: MemberDetail["status"] | null }
  | { kind: "refused"; outcome: "not_found" | "reason_too_long" }
  | { kind: "denied" };

/** Withdraw: the creator, or the beneficiary when that person has an account (P3-22). Never from `paid`. */
export async function withdrawRequest(
  actor: RequestActor,
  input: { requestId: string; reason: string | null },
): Promise<WithdrawRequestResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<WithdrawRequestResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_withdraw(
            ${input.requestId}::uuid, ${text(input.reason)}, ${actor.userId}::uuid)`),
      )[0]!;
      switch (out.outcome) {
        case "ok":
          return { kind: "ok" };
        case "not_withdrawable": {
          const detail = await memberDetailInTx(tx, input.requestId, actor.userId);
          return { kind: "not_withdrawable", status: detail?.status ?? null };
        }
        default:
          return { kind: "refused", outcome: out.outcome as "not_found" | "reason_too_long" };
      }
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}
