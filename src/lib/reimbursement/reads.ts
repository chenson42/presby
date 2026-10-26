import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { payHolderCount } from "./counts";
import { isNotPermitted, rowsOf } from "./db-util";
import {
  formOptionsSchema,
  requestDetailSchema,
  settingsSchema,
  type DetailLevel,
  type FormOptions,
  type ReimbursementSettings,
  type RequestDetail,
} from "./detail-shape";
import { MY_REQUESTS_PAGE_SIZE } from "./limits";
import { QUEUE_PAGE_SIZE, type TreasurerTab } from "./queue-query";
import type { RequestStatus } from "./states";

/**
 * The read path - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 file plan
 * (`reads.ts`) and the "Read doors" table. Every read goes through a SECURITY
 * DEFINER door (`presby_app` holds SELECT on neither the requests nor the
 * history), each in ONE `withOrgContext`, each with the acting `users.id` as
 * the bounded claim. There is no second code path for "does it exist" and "may
 * you see it": a missing request and a forbidden one both read as `null`
 * (`not_found` here), from the same single definer call, so neither the answer
 * nor the number of reads tells them apart (EC16).
 *
 * `identity` is `{ personId, organizationId, userId }` from a gate; the
 * organization is never a client input.
 *
 * The jsonb doors (`detail`, `settings`, `form_options`) are parsed with the
 * STRICT zod schemas in `detail-shape.ts`: a key the definer adds that no
 * schema names fails loudly here instead of reaching a template.
 *
 * The treasurer's reads (`treasurer_list` here, `export_rows` in `csv-export.ts`,
 * which audits what it reads) need `reimbursement.view`: a caller without it is
 * `denied` (the definer's identity refusal).
 */

export interface ReadIdentity {
  userId: string;
  personId: string;
  organizationId: string;
}

// ---------------------------------------------------------------------------
// Form options, org today
// ---------------------------------------------------------------------------

/**
 * What the request form offers: the live chargeable groups and categories, and
 * whether the caller may enter for others. `mayFile: false` (with empty lists)
 * for a member who may not file - the page then shows the C2 sentence and the
 * list still renders.
 */
export async function getFormOptions(identity: ReadIdentity): Promise<FormOptions> {
  const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
    rowsOf(await tx.execute(sql`select presby_reimbursement_form_options(${identity.userId}::uuid) as options`)),
  );
  return formOptionsSchema.parse(rows[0]?.options);
}

/** Today at the organization (org-local; America/New_York when its settings row is missing), `YYYY-MM-DD`. */
export async function getOrgToday(identity: ReadIdentity): Promise<string> {
  const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
    rowsOf(await tx.execute(sql`select presby_reimbursement_org_today()::text as today`)),
  );
  return String(rows[0]?.today);
}

// ---------------------------------------------------------------------------
// The member lists
// ---------------------------------------------------------------------------

export interface RequestListItem {
  id: string;
  status: RequestStatus;
  kind: "reimburse" | "vendor";
  /** The vendor's name, or the beneficiary's display name (merge-resolved). */
  payeeLabel: string | null;
  amountCents: number | null;
  /** `YYYY-MM-DD` or null (a partial draft). */
  expenseDate: string | null;
  groupName: string;
  /** The first 80 characters of the purpose. */
  purposeExcerpt: string | null;
  revision: number;
  /** The actor created it (as opposed to being the payee of one entered for them). */
  isCreator: boolean;
  enteredOnBehalf: boolean;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string;
}

export interface WaitingItem {
  id: string;
  kind: "reimburse" | "vendor";
  payeeLabel: string | null;
  amountCents: number | null;
  expenseDate: string | null;
  groupName: string;
  purposeExcerpt: string | null;
  revision: number;
  enteredOnBehalf: boolean;
  submittedAt: string | null;
}

export interface RequestCounts {
  /** Requests the caller can approve right now (a live seat, EC11). */
  waitingForMe: number;
  /** The three treasury counts are null unless the caller holds `reimbursement.view`. */
  needsTreasurer: number | null;
  waitingForPayment: number | null;
  inProgress: number | null;
}

type ListResult<T> = { kind: "ok"; items: T[] } | { kind: "denied" };

/** The caller's own requests (drafts included) and those that pay them (from submitted on), newest first. */
export async function listMyRequests(
  identity: ReadIdentity,
  page: { limit?: number; offset?: number } = {},
): Promise<ListResult<RequestListItem>> {
  try {
    const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
      rowsOf(
        await tx.execute(sql`
          select id, status, kind, payee_label, amount_cents, expense_date::text as expense_date, group_name,
                 purpose_excerpt, revision, is_creator, entered_on_behalf,
                 to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                 to_char(submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as submitted_at,
                 to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
            from presby_reimbursement_my_requests(
              ${identity.userId}::uuid, ${page.limit ?? MY_REQUESTS_PAGE_SIZE}::integer, ${page.offset ?? 0}::integer)`),
      ),
    );
    return {
      kind: "ok",
      items: rows.map((r) => ({
        id: String(r.id),
        status: r.status as RequestStatus,
        kind: r.kind as "reimburse" | "vendor",
        payeeLabel: (r.payee_label as string | null) ?? null,
        amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
        expenseDate: (r.expense_date as string | null) ?? null,
        groupName: String(r.group_name),
        purposeExcerpt: (r.purpose_excerpt as string | null) ?? null,
        revision: Number(r.revision),
        isCreator: r.is_creator === true,
        enteredOnBehalf: r.entered_on_behalf === true,
        createdAt: String(r.created_at),
        submittedAt: (r.submitted_at as string | null) ?? null,
        updatedAt: String(r.updated_at),
      })),
    };
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

/** Submitted requests the caller may approve NOW (a seat that has ended is gone at once); oldest first. */
export async function listWaitingForMe(identity: ReadIdentity): Promise<ListResult<WaitingItem>> {
  try {
    const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
      rowsOf(
        await tx.execute(sql`
          select id, kind, payee_label, amount_cents, expense_date::text as expense_date, group_name,
                 purpose_excerpt, revision, entered_on_behalf,
                 to_char(submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as submitted_at
            from presby_reimbursement_waiting_for_me(${identity.userId}::uuid)`),
      ),
    );
    return {
      kind: "ok",
      items: rows.map((r) => ({
        id: String(r.id),
        kind: r.kind as "reimburse" | "vendor",
        payeeLabel: (r.payee_label as string | null) ?? null,
        amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
        expenseDate: (r.expense_date as string | null) ?? null,
        groupName: String(r.group_name),
        purposeExcerpt: (r.purpose_excerpt as string | null) ?? null,
        revision: Number(r.revision),
        enteredOnBehalf: r.entered_on_behalf === true,
        submittedAt: (r.submitted_at as string | null) ?? null,
      })),
    };
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

/** The page header's "waiting for you" count and, for a `view` holder, the three queue counts. */
export async function getCounts(identity: ReadIdentity): Promise<{ kind: "ok"; counts: RequestCounts } | { kind: "denied" }> {
  try {
    const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
      rowsOf(await tx.execute(sql`select * from presby_reimbursement_counts(${identity.userId}::uuid)`)),
    );
    const r = rows[0]!;
    const nullable = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      kind: "ok",
      counts: {
        waitingForMe: Number(r.waiting_for_me ?? 0),
        needsTreasurer: nullable(r.needs_treasurer),
        waitingForPayment: nullable(r.waiting_for_payment),
        inProgress: nullable(r.in_progress),
      },
    };
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

export type RequestDetailResult =
  | { kind: "ok"; detail: RequestDetail }
  /** Missing, or not visible to the caller at this level: ONE answer for both (EC16). */
  | { kind: "not_found" }
  | { kind: "denied" };

/**
 * One request as the caller may see it. `level: "member"` is the requester
 * projection (any viewer relation: creator, beneficiary, a live seat approver,
 * or a `view` holder); `level: "treasury"` needs `reimbursement.view` and a
 * non-draft row and adds the actor names, payments, approval path, waiver,
 * notes and duplicate request ids. A draft is visible to its creator only.
 *
 * A request id that is not a uuid is the same `not_found` as one that does not
 * exist - no SQL error, no different timing class.
 */
export async function getRequestDetail(
  identity: ReadIdentity,
  requestId: string,
  level: DetailLevel,
): Promise<RequestDetailResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return { kind: "not_found" };
  }
  try {
    const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
      rowsOf(
        await tx.execute(
          sql`select presby_reimbursement_detail(${requestId}::uuid, ${identity.userId}::uuid, ${level}::text) as detail`,
        ),
      ),
    );
    const raw = rows[0]?.detail;
    if (raw === null || raw === undefined) return { kind: "not_found" };
    return { kind: "ok", detail: requestDetailSchema.parse(raw) };
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Settings (reimbursement.manage)
// ---------------------------------------------------------------------------

export type SettingsResult = { kind: "ok"; settings: ReimbursementSettings } | { kind: "denied" };

/**
 * Every group with whether it is chargeable and how many seats can approve now
 * (managed groups only; a derived group's count is 0, so its requests take the
 * treasurer path), the active categories, and the pay-holder count. A caller
 * without `reimbursement.manage` is `denied` (the definer's identity refusal).
 */
export async function getSettings(identity: ReadIdentity): Promise<SettingsResult> {
  try {
    const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
      rowsOf(await tx.execute(sql`select presby_reimbursement_settings(${identity.userId}::uuid) as settings`)),
    );
    return { kind: "ok", settings: settingsSchema.parse(rows[0]?.settings) };
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The treasurer queue (reimbursement.view)
// ---------------------------------------------------------------------------

/** One row of the treasurer queue. Names are the treasury level's; a merged person reads as the person they merged into. */
export interface TreasurerListItem {
  id: string;
  status: RequestStatus;
  kind: "reimburse" | "vendor";
  /** The vendor's name, or the beneficiary's display name. */
  payeeLabel: string | null;
  amountCents: number | null;
  /** `YYYY-MM-DD`. */
  expenseDate: string | null;
  groupId: string;
  groupName: string;
  categoryName: string | null;
  /** The first 80 characters of the purpose. */
  purposeExcerpt: string | null;
  creatorName: string | null;
  approverName: string | null;
  /** Entered by someone other than the payee: the "Entered on someone's behalf" badge. */
  enteredOnBehalf: boolean;
  approvalPath: "seat" | "override" | null;
  /** ISO-8601, UTC. */
  submittedAt: string | null;
  approvedAt: string | null;
  /** `YYYY-MM-DD` of the live payment. */
  paidOn: string | null;
  revision: number;
}

export type TreasurerListResult =
  | { kind: "ok"; items: TreasurerListItem[]; total: number }
  | { kind: "denied" };

/**
 * One page of the queue behind a tab (Copy C7): `pay` approved and waiting for
 * payment (oldest approved first), `override` submitted with no eligible approver
 * (computed LIVE), `progress` submitted with an approver or returned, `paid`, or
 * `all` (every non-draft). `from`/`to` filter on the organization-local date the
 * request was last SUBMITTED (the ruling on Batch 1a), so a late-night
 * submission lands on the day the treasurer remembers. `total` is the full
 * filtered count for paging.
 */
export async function listTreasurerRequests(
  identity: ReadIdentity,
  query: { tab: TreasurerTab; groupId: string | null; from: string | null; to: string | null; page: number },
): Promise<TreasurerListResult> {
  const offset = (Math.max(query.page, 1) - 1) * QUEUE_PAGE_SIZE;
  try {
    const rows = await withOrgContext(identity.personId, identity.organizationId, async (tx) =>
      rowsOf(
        await tx.execute(sql`
          select id, status, kind, payee_label, amount_cents, expense_date::text as expense_date,
                 group_id, group_name, category_name, purpose_excerpt, creator_name, approver_name,
                 entered_on_behalf, approval_path,
                 to_char(submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as submitted_at,
                 to_char(approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as approved_at,
                 paid_on::text as paid_on, revision, total_count::integer as total_count
            from presby_reimbursement_treasurer_list(
              ${identity.userId}::uuid, ${query.tab}::text, ${query.groupId}::uuid,
              ${query.from}::date, ${query.to}::date, ${QUEUE_PAGE_SIZE}::integer, ${offset}::integer)`),
      ),
    );
    return {
      kind: "ok",
      total: rows.length === 0 ? 0 : Number(rows[0]!.total_count),
      items: rows.map((r) => ({
        id: String(r.id),
        status: r.status as RequestStatus,
        kind: r.kind as "reimburse" | "vendor",
        payeeLabel: (r.payee_label as string | null) ?? null,
        amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
        expenseDate: (r.expense_date as string | null) ?? null,
        groupId: String(r.group_id),
        groupName: String(r.group_name),
        categoryName: (r.category_name as string | null) ?? null,
        purposeExcerpt: (r.purpose_excerpt as string | null) ?? null,
        creatorName: (r.creator_name as string | null) ?? null,
        approverName: (r.approver_name as string | null) ?? null,
        enteredOnBehalf: r.entered_on_behalf === true,
        approvalPath: (r.approval_path as "seat" | "override" | null) ?? null,
        submittedAt: (r.submitted_at as string | null) ?? null,
        approvedAt: (r.approved_at as string | null) ?? null,
        paidOn: (r.paid_on as string | null) ?? null,
        revision: Number(r.revision),
      })),
    };
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The queue's "Charged to" options (Phase 3 amendment S7)
// ---------------------------------------------------------------------------

/** `presby_reimbursement_treasurer_list` clamps a page to 200 rows (drizzle/0073). */
export const GROUP_SCAN_PAGE_SIZE = 200;
/** The most requests `listTreasurerGroups` reads: 10 pages of 200. */
export const GROUP_SCAN_MAX_ROWS = 2_000;

export type TreasurerGroupsResult =
  | {
      kind: "ok";
      /** Distinct groups named by the requests read, by name, under their CURRENT names. */
      groups: Array<{ id: string; name: string }>;
      /** The organization has more requests than the bound, so a group whose only requests are older is missing. */
      truncated: boolean;
    }
  | { kind: "denied" };

/**
 * The groups behind the queue's "Charged to" filter: the distinct groups
 * present in the requests the viewer can already see (orchestrator ruling
 * 2026-10-26; no definer, no schema). It pages the existing `all` tab, newest
 * first, in ONE transaction (a stable view of the order) until it has read every
 * row or `maxRows` of them, and says whether the bound was hit so the page can
 * show `COPY.queue.filter.groupsTruncated` instead of a silently wrong list.
 * The same `view` gate as the queue: a caller without it is `denied`.
 *
 * `bounds` exists so a test can lower the cap; `pageSize` above the definer's
 * clamp of 200 would skip rows, so it is held to it.
 */
export async function listTreasurerGroups(
  identity: ReadIdentity,
  bounds: { pageSize?: number; maxRows?: number } = {},
): Promise<TreasurerGroupsResult> {
  const pageSize = Math.min(Math.max(Math.trunc(bounds.pageSize ?? GROUP_SCAN_PAGE_SIZE), 1), GROUP_SCAN_PAGE_SIZE);
  const maxRows = Math.max(Math.trunc(bounds.maxRows ?? GROUP_SCAN_MAX_ROWS), 1);
  try {
    return await withOrgContext(identity.personId, identity.organizationId, async (tx) => {
      const found = new Map<string, string>();
      let total = 0;
      for (let offset = 0; offset < maxRows; offset += pageSize) {
        const limit = Math.min(pageSize, maxRows - offset);
        const rows = rowsOf(
          await tx.execute(sql`
            select group_id, group_name, total_count::integer as total_count
              from presby_reimbursement_treasurer_list(
                ${identity.userId}::uuid, 'all'::text, null::uuid, null::date, null::date,
                ${limit}::integer, ${offset}::integer)`),
        );
        if (rows.length === 0) break;
        total = Number(rows[0]!.total_count);
        for (const r of rows) found.set(String(r.group_id), String(r.group_name));
        if (offset + rows.length >= total) break;
      }
      const groups = [...found].map(([id, name]) => ({ id, name }));
      groups.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
      return { kind: "ok" as const, groups, truncated: total > maxRows };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

/**
 * Effective holders of `reimbursement.pay` (the queue's "No one can record
 * payments yet" banner when it is zero). A bare count of the organization: it
 * reveals a number and nothing else, so any gated viewer may ask.
 */
export async function getPayHolderCount(identity: ReadIdentity): Promise<number> {
  return withOrgContext(identity.personId, identity.organizationId, async (tx) => payHolderCount(tx));
}
