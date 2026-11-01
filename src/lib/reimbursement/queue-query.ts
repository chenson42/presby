import { isRealIsoDate } from "./dates";
import { REQUEST_STATUSES, type RequestStatus } from "./states";

/**
 * The treasurer queue's and the CSV export's query strings - docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 Copy C7 and P3-16. PURE.
 *
 * Both parse leniently, the house shape (`giving/gift-input.ts`): a value that
 * is not one of the closed set, a real date or a uuid is DROPPED, never an
 * error and never passed on. The dates filter on the organization-local date
 * the request was last SUBMITTED (or created, for an import) - the operator's
 * ruling on Batch 1a, which is why Copy says "submitted" - and are applied by
 * the database, not here.
 */

/** The five tabs of `presby_reimbursement_treasurer_list`, in the order Copy C7 lists them. */
export const TREASURER_TABS = ["pay", "override", "progress", "paid", "all"] as const;
export type TreasurerTab = (typeof TREASURER_TABS)[number];

export const QUEUE_PAGE_SIZE = 50;
/** A page number past this is clamped, so `(page - 1) * QUEUE_PAGE_SIZE` stays a small integer. */
export const QUEUE_MAX_PAGE = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;

function one(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : undefined;
}

export interface QueueQuery {
  tab: TreasurerTab;
  groupId: string | null;
  from: string | null;
  to: string | null;
  /** 1-based. */
  page: number;
}

export function parseQueueQuery(raw: Raw): QueueQuery {
  const tab = one(raw, "tab");
  const group = one(raw, "group");
  const from = one(raw, "from");
  const to = one(raw, "to");
  const pageText = one(raw, "page");
  const page = pageText && /^[0-9]+$/.test(pageText) ? Math.min(Math.max(Number(pageText), 1), QUEUE_MAX_PAGE) : 1;
  return {
    tab: tab && (TREASURER_TABS as readonly string[]).includes(tab) ? (tab as TreasurerTab) : "pay",
    groupId: group && UUID.test(group) ? group : null,
    from: from && isRealIsoDate(from) ? from : null,
    to: to && isRealIsoDate(to) ? to : null,
    page,
  };
}

export interface ExportFilters {
  from?: string;
  to?: string;
  status?: Exclude<RequestStatus, "draft">;
}

/** `?from&to&status` of the CSV route. A draft is never exported, so `status=draft` is dropped like any unknown value. */
export function parseExportFilters(raw: Raw): ExportFilters {
  const out: ExportFilters = {};
  const from = one(raw, "from");
  const to = one(raw, "to");
  const status = one(raw, "status");
  if (from && isRealIsoDate(from)) out.from = from;
  if (to && isRealIsoDate(to)) out.to = to;
  if (status && status !== "draft" && (REQUEST_STATUSES as readonly string[]).includes(status)) {
    out.status = status as ExportFilters["status"];
  }
  return out;
}
