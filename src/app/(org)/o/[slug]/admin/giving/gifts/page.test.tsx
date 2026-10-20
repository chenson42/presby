// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/gifts` page (docs/work-log/2026-10-15-online-giving.md,
 * Batch 2): the ledger variant (giving.view), the S4 recorder variant (own
 * entries only), the filters-in-the-URL contract, paging and the CSV link.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const listGifts = vi.fn();
const listRecentOwnEntries = vi.fn();
vi.mock("@/lib/giving/gifts", () => ({
  listGifts: (...a: unknown[]) => listGifts(...a),
  listRecentOwnEntries: (...a: unknown[]) => listRecentOwnEntries(...a),
}));
const listFundOptions = vi.fn();
vi.mock("@/lib/giving/funds", () => ({ listFundOptions: (...a: unknown[]) => listFundOptions(...a) }));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
vi.mock("./recent-entries", () => ({ RecentEntries: ({ entries }: { entries: unknown[] }) => <div data-testid="recent-entries-stub">{entries.length} entries</div> }));

import GivingGiftsPage from "./page";

const org = { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" };
const ledger = { ok: true, userId: "u1", org, has: { view: true, record: true, manage: false } };
const recorderOnly = { ok: true, userId: "u1", org, has: { view: false, record: true, manage: false } };
const FUND = "11111111-1111-4111-8111-111111111111";
const gift = (id: string, over: Record<string, unknown> = {}) => ({
  id, occurredOn: "2026-03-14", donorId: "d1", donorName: "Imogen Thackeray", fundId: FUND, fundName: "General Fund",
  source: "offline", method: "check", status: "succeeded", testMode: false, amountCents: 12_550,
  donorCoveredFeeCents: 0, feeCents: null, netCents: null, checkNumber: "1042", reversedCents: 0, voided: false, ...over,
});
const props = (search: Record<string, string> = {}) => ({ params: Promise.resolve({ slug: "alder-creek" }), searchParams: Promise.resolve(search) });

afterEach(() => {
  cleanup();
  for (const fn of [gate, listGifts, listRecentOwnEntries, listFundOptions]) fn.mockReset();
});

describe("the ledger variant (giving.view)", () => {
  function arrange(gifts = [gift("g1")], nextCursor: string | null = null) {
    gate.mockResolvedValue(ledger);
    listGifts.mockResolvedValue({ kind: "ok", gifts, nextCursor });
    listFundOptions.mockResolvedValue({ kind: "ok", funds: [{ id: FUND, name: "General Fund" }] });
  }

  it("opens the gate to view OR record, and reads the ledger with the URL's parsed filters and cursor", async () => {
    arrange();
    await GivingGiftsPage(props({ status: "failed", fund: FUND, from: "garbage", cursor: "2026-03-14|abc" }));
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({ anyOf: ["view", "record"], path: "/o/alder-creek/admin/giving/gifts" }));
    expect(listGifts).toHaveBeenCalledWith("p1", "o1", { filters: { status: "failed", fundId: FUND }, cursor: "2026-03-14|abc" });
    expect(listRecentOwnEntries).not.toHaveBeenCalled();
  });

  it("lists each gift as a link with donor, amount, date, fund, method and check number", async () => {
    arrange([gift("g1"), gift("g2", { donorName: "Barnaby Quill", amountCents: 5_000, method: "cash", checkNumber: null })]);
    render(await GivingGiftsPage(props()));
    const rows = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.includes("/gifts/g"));
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/o/alder-creek/admin/giving/gifts/g1", "/o/alder-creek/admin/giving/gifts/g2"]);
    expect(screen.getByText("Imogen Thackeray")).toBeTruthy();
    expect(screen.getByText("$125.50")).toBeTruthy();
    expect(screen.getByText(/Check #1042/)).toBeTruthy();
  });

  it("badges are words: Test, Pending, Failed, Voided, Refunded, and a partial refund names its amount", async () => {
    arrange([
      gift("g1", { testMode: true, source: "online", method: "card", checkNumber: null }),
      gift("g2", { status: "pending", source: "online", method: "us_bank_account", checkNumber: null }),
      gift("g3", { status: "failed", source: "online", checkNumber: null }),
      gift("g4", { voided: true, reversedCents: 12_550 }),
      gift("g5", { reversedCents: 12_550, source: "online", method: "card", checkNumber: null }),
      gift("g6", { reversedCents: 4_000, source: "online", method: "card", checkNumber: null }),
    ]);
    render(await GivingGiftsPage(props()));
    for (const word of ["Test", "Pending", "Failed", "Voided", "Refunded", "$40.00 refunded"]) {
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    }
  });

  it("the CSV link carries the same filters (and not the cursor)", async () => {
    arrange();
    render(await GivingGiftsPage(props({ status: "failed", from: "2026-01-01", cursor: "2026-03-14|x" })));
    const csv = screen.getByRole("link", { name: /download csv/i });
    expect(csv.getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts/export?from=2026-01-01&status=failed");
  });

  it("a next cursor becomes 'Show older gifts', preserving the filters", async () => {
    arrange([gift("g1")], "2026-03-01|aaaa");
    render(await GivingGiftsPage(props({ status: "failed" })));
    expect(screen.getByRole("link", { name: "Show older gifts" }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/giving/gifts?status=failed&cursor=2026-03-01%7Caaaa",
    );
  });

  it("empty (unfiltered): says how gifts arrive, with the Record action for a recorder", async () => {
    arrange([]);
    render(await GivingGiftsPage(props()));
    expect(screen.getByText("No gifts recorded yet")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Record a gift" }).length).toBeGreaterThan(0);
  });

  it("empty (filtered): says nothing MATCHED, and offers to clear the filters", async () => {
    arrange([]);
    render(await GivingGiftsPage(props({ status: "failed" })));
    expect(screen.getByText("No gifts match those filters")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts");
  });

  it("a database failure is the load-error state, never an empty ledger", async () => {
    gate.mockResolvedValue(ledger);
    listGifts.mockRejectedValue(new Error("reset"));
    listFundOptions.mockResolvedValue({ kind: "ok", funds: [] });
    render(await GivingGiftsPage(props()));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.queryByText("No gifts recorded yet")).toBeNull();
  });

  it("rethrows an OrgAccessError", async () => {
    gate.mockResolvedValue(ledger);
    listGifts.mockRejectedValue(new OrgAccessError("gone"));
    listFundOptions.mockResolvedValue({ kind: "ok", funds: [] });
    await expect(GivingGiftsPage(props())).rejects.toBeInstanceOf(OrgAccessError);
  });
});

describe("the recorder variant (giving.record without giving.view, S4)", () => {
  it("shows ONLY their own recent entries: never calls the ledger, the fund filter or the CSV", async () => {
    gate.mockResolvedValue(recorderOnly);
    listRecentOwnEntries.mockResolvedValue({ kind: "ok", entries: [{ id: "e1" }, { id: "e2" }] });
    const { container } = render(await GivingGiftsPage(props({ status: "failed" })));
    expect(listGifts).not.toHaveBeenCalled();
    expect(listFundOptions).not.toHaveBeenCalled();
    expect(listRecentOwnEntries).toHaveBeenCalledWith("p1", "o1", "u1");
    expect(screen.getByRole("heading", { level: 1, name: "Your recent entries" })).toBeTruthy();
    expect(screen.getByTestId("recent-entries-stub").textContent).toBe("2 entries");
    expect(screen.queryByRole("link", { name: /download csv/i })).toBeNull();
    expect(container.querySelector("form")).toBeNull(); // no filters
    expect(screen.getByRole("link", { name: "Record a gift" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts/new");
  });

  it("a failure loading their entries is the load-error state", async () => {
    gate.mockResolvedValue(recorderOnly);
    listRecentOwnEntries.mockRejectedValue(new Error("reset"));
    render(await GivingGiftsPage(props()));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
  });
});
