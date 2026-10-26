import { COPY } from "@/lib/reimbursement/copy";
import { QUEUE_PAGE_SIZE, type QueueQuery, type TreasurerTab } from "@/lib/reimbursement/queue-query";
import type { RequestCounts } from "@/lib/reimbursement/reads";

/**
 * The treasurer queue's pure page logic - docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 Copy C7, the Batch 4 amendment (S7 filter strings and empty states;
 * X6 the clamp; X7 URLs from the PARSED query). No React, no database.
 *
 * Every link on the page is built here from a `QueueQuery` that
 * `parseQueueQuery` produced, never from the raw search string (X7): the bar
 * therefore shows exactly the filter that was applied, and a hand-typed bad date
 * can only widen the view the person sees on screen.
 */

const BASE = (slug: string) => `/o/${slug}/admin/reimbursements`;

/** The queue address for `query`, with `override` fields replacing it; page 1 and unset filters are left out. */
export function queueHref(slug: string, query: QueueQuery, override: Partial<QueueQuery> = {}): string {
  const next = { ...query, ...override };
  const params = new URLSearchParams();
  params.set("tab", next.tab);
  if (next.groupId) params.set("group", next.groupId);
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.page > 1) params.set("page", String(next.page));
  return `${BASE(slug)}?${params.toString()}`;
}

/**
 * `Export CSV`: the export route with the queue's date range (the dates mean
 * "last submitted", the same as the filter). The export has no group filter, so
 * the group is never carried. `status` narrows only on the two tabs that are one
 * status (the others span several), so on Needs treasurer approval and In progress
 * the file is wider than the tab. `exportNotes` says so on the page.
 */
export function exportHref(slug: string, query: QueueQuery): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.tab === "pay") params.set("status", "approved");
  if (query.tab === "paid") params.set("status", "paid");
  const text = params.toString();
  return `${BASE(slug)}/export${text ? `?${text}` : ""}`;
}

/** What the CSV covers beyond the screen (T4): the group when one is chosen, every sent-in request on the two multi-status tabs. */
export function exportNotes(query: QueueQuery): string[] {
  const notes: string[] = [];
  if (query.groupId !== null) notes.push(COPY.queue.exportNote.group);
  if (query.tab === "override" || query.tab === "progress") notes.push(COPY.queue.exportNote.requests);
  return notes;
}

export function totalPages(total: number): number {
  return Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
}

/**
 * X6: `treasurer_list` past the last page returns no rows and a total of 0, so
 * the page cannot print "page 2 of 0". A page above 1 with no rows goes to page 1
 * of the same filters.
 */
export function needsClampToFirstPage(query: QueueQuery, itemCount: number): boolean {
  return query.page > 1 && itemCount === 0;
}

export function isFiltered(query: QueueQuery): boolean {
  return query.groupId !== null || query.from !== null || query.to !== null;
}

/** The empty-state sentence: the tab's own, or the filtered one when any of group, from or to is set. */
export function emptyMessage(query: QueueQuery): string {
  return isFiltered(query) ? COPY.queue.empty.filtered : COPY.queue.empty[query.tab];
}

/**
 * The "Charged to" options. `groups` is `listTreasurerGroups`' derived list. A
 * selected id that the list lacks (an old group past the 2,000-row bound, or a
 * hand-typed id) still has to appear as the selected option, or the control
 * would silently show "All groups" while the list is filtered; it is named by a
 * returned row if one has it, else by the neutral `This group`.
 */
export function groupSelectOptions(
  groups: Array<{ id: string; name: string }>,
  selectedId: string | null,
  rows: Array<{ groupId: string; groupName: string }>,
): { groups: Array<{ id: string; name: string }>; extraSelected: { id: string; name: string } | null } {
  if (selectedId === null || groups.some((g) => g.id === selectedId)) return { groups, extraSelected: null };
  const named = rows.find((r) => r.groupId === selectedId);
  return { groups, extraSelected: { id: selectedId, name: named ? named.groupName : COPY.queue.filter.groupSelected } };
}

/** The number beside a tab: only three tabs have one (`paid` and `all` are uncounted by the definer). */
export function tabCount(tab: TreasurerTab, counts: RequestCounts): number | null {
  switch (tab) {
    case "pay":
      return counts.waitingForPayment;
    case "override":
      return counts.needsTreasurer;
    case "progress":
      return counts.inProgress;
    default:
      return null;
  }
}
