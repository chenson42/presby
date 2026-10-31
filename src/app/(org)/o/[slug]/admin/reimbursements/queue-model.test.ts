import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/reimbursement/copy";
import type { QueueQuery } from "@/lib/reimbursement/queue-query";
import {
  emptyMessage,
  exportNotes,
  exportHref,
  groupSelectOptions,
  isFiltered,
  needsClampToFirstPage,
  queueHref,
  tabCount,
  totalPages,
} from "./queue-model";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";

const base: QueueQuery = { tab: "pay", groupId: null, from: null, to: null, page: 1 };
const q = (over: Partial<QueueQuery> = {}): QueueQuery => ({ ...base, ...over });

describe("queueHref", () => {
  it("carries the tab and only the filters that are set, built from the PARSED query (X7)", () => {
    expect(queueHref("alder", q())).toBe("/o/alder/admin/reimbursements?tab=pay");
    expect(queueHref("alder", q({ tab: "paid", groupId: G1, from: "2026-01-02", to: "2026-02-03" }))).toBe(
      `/o/alder/admin/reimbursements?tab=paid&group=${G1}&from=2026-01-02&to=2026-02-03`,
    );
  });

  it("adds page only past page 1, and a tab change can drop it", () => {
    expect(queueHref("alder", q({ page: 3 }))).toBe("/o/alder/admin/reimbursements?tab=pay&page=3");
    expect(queueHref("alder", q({ page: 1 }))).not.toContain("page=");
    expect(queueHref("alder", q({ page: 3 }), { page: 1 })).not.toContain("page=");
    expect(queueHref("alder", q({ page: 3 }), { tab: "all", page: 1 })).toBe("/o/alder/admin/reimbursements?tab=all");
  });
});

describe("exportHref", () => {
  it("is the CSV route with the queue's date range, and status only where the tab is one status", () => {
    expect(exportHref("alder", q({ from: "2026-01-02", to: "2026-02-03" }))).toBe(
      "/o/alder/admin/reimbursements/export?from=2026-01-02&to=2026-02-03&status=approved",
    );
    expect(exportHref("alder", q({ tab: "paid" }))).toBe("/o/alder/admin/reimbursements/export?status=paid");
    expect(exportHref("alder", q({ tab: "all" }))).toBe("/o/alder/admin/reimbursements/export");
    // 'progress' and 'override' span several statuses, so they never narrow the export.
    expect(exportHref("alder", q({ tab: "progress" }))).toBe("/o/alder/admin/reimbursements/export");
    expect(exportHref("alder", q({ tab: "override" }))).toBe("/o/alder/admin/reimbursements/export");
  });

  it("never carries the group filter (the export route has none)", () => {
    expect(exportHref("alder", q({ tab: "all", groupId: G1 }))).not.toContain("group");
  });
});

describe("totalPages and the X6 clamp", () => {
  it("rounds up at 50 a page and is at least 1", () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(50)).toBe(1);
    expect(totalPages(51)).toBe(2);
    expect(totalPages(101)).toBe(3);
  });

  it("clamps only a page past the first whose rows are empty (X6): never 'page 2 of 0'", () => {
    expect(needsClampToFirstPage(q({ page: 2 }), 0)).toBe(true);
    expect(needsClampToFirstPage(q({ page: 2 }), 3)).toBe(false);
    expect(needsClampToFirstPage(q({ page: 1 }), 0)).toBe(false);
  });
});

describe("emptyMessage (amendment S7)", () => {
  it("is the tab's sentence with no filter and 'No requests match those filters.' with any filter", () => {
    expect(emptyMessage(q({ tab: "pay" }))).toBe("Nothing is waiting for payment.");
    expect(emptyMessage(q({ tab: "override" }))).toBe("Nothing needs a treasurer's approval.");
    expect(emptyMessage(q({ tab: "progress" }))).toBe("Nothing is in progress.");
    expect(emptyMessage(q({ tab: "paid" }))).toBe("Nothing has been paid yet.");
    expect(emptyMessage(q({ tab: "all" }))).toBe("No one has sent in a request yet.");
    for (const filter of [{ groupId: G1 }, { from: "2026-01-01" }, { to: "2026-01-01" }]) {
      expect(emptyMessage(q({ tab: "paid", ...filter }))).toBe(COPY.queue.empty.filtered);
    }
    expect(isFiltered(q())).toBe(false);
    expect(isFiltered(q({ from: "2026-01-01" }))).toBe(true);
  });
});

describe("groupSelectOptions (amendment S7)", () => {
  const groups = [
    { id: G1, name: "Property" },
    { id: G2, name: "Worship" },
  ];

  it("lists the derived groups and no 'This group' when the selection is in the list or empty", () => {
    expect(groupSelectOptions(groups, null, [])).toEqual({ groups, extraSelected: null });
    expect(groupSelectOptions(groups, G1, [])).toEqual({ groups, extraSelected: null });
  });

  it("adds 'This group' only for a selected id that the list lacks and no returned row names", () => {
    const stranger = "33333333-3333-4333-8333-333333333333";
    expect(groupSelectOptions(groups, stranger, [])).toEqual({
      groups,
      extraSelected: { id: stranger, name: COPY.queue.filter.groupSelected },
    });
    // A returned row names it: the real name is used instead of the placeholder.
    expect(groupSelectOptions(groups, stranger, [{ groupId: stranger, groupName: "Hospitality" }])).toEqual({
      groups,
      extraSelected: { id: stranger, name: "Hospitality" },
    });
  });
});

describe("tabCount", () => {
  it("reads the three counted tabs from the counts and has none for paid or all", () => {
    const counts = { waitingForMe: 0, needsTreasurer: 4, waitingForPayment: 7, inProgress: 2 };
    expect(tabCount("pay", counts)).toBe(7);
    expect(tabCount("override", counts)).toBe(4);
    expect(tabCount("progress", counts)).toBe(2);
    expect(tabCount("paid", counts)).toBeNull();
    expect(tabCount("all", counts)).toBeNull();
  });
});

describe("exportNotes (T4)", () => {
  it("is empty on pay, paid and all with no group", () => {
    for (const tab of ["pay", "paid", "all"] as const) expect(exportNotes(q({ tab }))).toEqual([]);
  });
  it("names the requests on override and progress", () => {
    for (const tab of ["override", "progress"] as const) expect(exportNotes(q({ tab }))).toEqual([COPY.queue.exportNote.requests]);
  });
  it("names the group on every tab once one is chosen, group first", () => {
    for (const tab of ["pay", "paid", "all"] as const) expect(exportNotes(q({ tab, groupId: G1 }))).toEqual([COPY.queue.exportNote.group]);
    for (const tab of ["override", "progress"] as const)
      expect(exportNotes(q({ tab, groupId: G1 }))).toEqual([COPY.queue.exportNote.group, COPY.queue.exportNote.requests]);
  });
});
