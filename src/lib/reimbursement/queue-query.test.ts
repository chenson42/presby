import { describe, expect, it } from "vitest";
import { QUEUE_PAGE_SIZE, TREASURER_TABS, parseExportFilters, parseQueueQuery } from "./queue-query";
import { COPY } from "./copy";

const GROUP = "22222222-2222-4222-8222-222222222222";

describe("parseQueueQuery", () => {
  it("defaults to the waiting-for-payment tab, page 1, no filters", () => {
    expect(parseQueueQuery({})).toEqual({ tab: "pay", groupId: null, from: null, to: null, page: 1 });
  });

  it("the tabs are the five the definer knows, in the order Copy lists them", () => {
    expect([...TREASURER_TABS]).toEqual(["pay", "override", "progress", "paid", "all"]);
    expect(Object.keys(COPY.queue.tabs)).toEqual([...TREASURER_TABS]);
  });

  it("takes a known tab, a group id, real dates and a page; ignores everything else", () => {
    expect(parseQueueQuery({ tab: "paid", group: GROUP, from: "2026-01-01", to: "2026-06-30", page: "3" })).toEqual({
      tab: "paid", groupId: GROUP, from: "2026-01-01", to: "2026-06-30", page: 3,
    });
    expect(parseQueueQuery({ tab: "everything", group: "x", from: "2026-02-30", to: "soon", page: "-4" })).toEqual({
      tab: "pay", groupId: null, from: null, to: null, page: 1,
    });
  });

  it("an array value (a repeated query key) takes the first", () => {
    expect(parseQueueQuery({ tab: ["all", "paid"], page: ["2", "9"] })).toMatchObject({ tab: "all", page: 2 });
  });

  it("a page far past anything real is clamped so the offset stays a small integer", () => {
    const q = parseQueueQuery({ page: "99999999999999999999" });
    expect(Number.isSafeInteger((q.page - 1) * QUEUE_PAGE_SIZE)).toBe(true);
    expect(q.page).toBeLessThanOrEqual(10_000);
  });
});

describe("parseExportFilters", () => {
  it("takes real dates and a status other than draft; drops the rest", () => {
    expect(parseExportFilters({ from: "2026-01-01", to: "2026-12-31", status: "paid" })).toEqual({ from: "2026-01-01", to: "2026-12-31", status: "paid" });
    expect(parseExportFilters({ from: "01/02/2026", status: "draft" })).toEqual({});
    expect(parseExportFilters({ status: "whatever" })).toEqual({});
    expect(parseExportFilters({})).toEqual({});
  });
});
