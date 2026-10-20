// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/gifts/new` page (docs/work-log/2026-10-15-online-giving.md,
 * Batch 2): giving.record, the S4 reads (fund list, defaults, OWN entries), and
 * the "no funds yet" state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const listFundOptions = vi.fn();
vi.mock("@/lib/giving/funds", () => ({ listFundOptions: (...a: unknown[]) => listFundOptions(...a) }));
const getRecordingDefaults = vi.fn();
const listRecentOwnEntries = vi.fn();
vi.mock("@/lib/giving/gifts", () => ({
  getRecordingDefaults: (...a: unknown[]) => getRecordingDefaults(...a),
  listRecentOwnEntries: (...a: unknown[]) => listRecentOwnEntries(...a),
}));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
vi.mock("./offline-gift-form", () => ({
  OfflineGiftForm: ({ funds, today }: { funds: unknown[]; today: string }) => <div data-testid="gift-form">{funds.length} funds, {today}</div>,
}));
vi.mock("../recent-entries", () => ({ RecentEntries: ({ entries }: { entries: unknown[] }) => <div data-testid="recent">{entries.length} recent</div> }));

import NewGiftPage from "./page";

const org = { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" };
const recorder = { ok: true, userId: "u1", org, has: { view: false, record: true, manage: false } };
const params = Promise.resolve({ slug: "alder-creek" });

function arrange(funds = [{ id: "f1", name: "General Fund" }]) {
  listFundOptions.mockResolvedValue({ kind: "ok", funds });
  getRecordingDefaults.mockResolvedValue({ kind: "ok", today: "2026-04-12" });
  listRecentOwnEntries.mockResolvedValue({ kind: "ok", entries: [{ id: "e1" }] });
}

afterEach(() => {
  cleanup();
  for (const fn of [gate, listFundOptions, getRecordingDefaults, listRecentOwnEntries]) fn.mockReset();
});

describe("NewGiftPage", () => {
  it("asks the gate for giving.record only", async () => {
    gate.mockResolvedValue(recorder);
    arrange();
    await NewGiftPage({ params });
    expect(gate).toHaveBeenCalledWith({ slug: "alder-creek", path: "/o/alder-creek/admin/giving/gifts/new", anyOf: ["record"], section: "Record a gift" });
  });

  it("renders the form with the org-local date and the funds, then the recorder's OWN entries (S4), passing the session user id", async () => {
    gate.mockResolvedValue(recorder);
    arrange();
    render(await NewGiftPage({ params }));
    expect(screen.getByRole("heading", { level: 1, name: "Record a gift" })).toBeTruthy();
    expect(screen.getByTestId("gift-form").textContent).toBe("1 funds, 2026-04-12");
    expect(screen.getByTestId("recent").textContent).toBe("1 recent");
    expect(listRecentOwnEntries).toHaveBeenCalledWith("p1", "o1", "u1");
  });

  it("no funds, a recorder: says whom to ask; no form", async () => {
    gate.mockResolvedValue(recorder);
    arrange([]);
    render(await NewGiftPage({ params }));
    expect(screen.getByText("There are no funds to record against yet")).toBeTruthy();
    expect(screen.getByText(/Ask your treasurer to add a fund/)).toBeTruthy();
    expect(screen.queryByTestId("gift-form")).toBeNull();
    expect(screen.queryByRole("link", { name: "Go to Funds" })).toBeNull();
  });

  it("no funds, a manager who can record: links to Funds", async () => {
    gate.mockResolvedValue({ ...recorder, has: { view: true, record: true, manage: true } });
    arrange([]);
    render(await NewGiftPage({ params }));
    expect(screen.getByRole("link", { name: "Go to Funds" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/funds");
  });

  it("a read failure is the load-error state with a retry to this page, not an empty form", async () => {
    gate.mockResolvedValue(recorder);
    listFundOptions.mockRejectedValue(new Error("reset"));
    getRecordingDefaults.mockResolvedValue({ kind: "ok", today: "2026-04-12" });
    listRecentOwnEntries.mockResolvedValue({ kind: "ok", entries: [] });
    render(await NewGiftPage({ params }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /try again/i }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts/new");
    expect(screen.queryByTestId("gift-form")).toBeNull();
  });

  it("a 'forbidden' answer from a read (the key was lost mid-request) is also the load-error state", async () => {
    gate.mockResolvedValue(recorder);
    arrange();
    listFundOptions.mockResolvedValue({ kind: "forbidden" });
    render(await NewGiftPage({ params }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
  });

  it("rethrows an OrgAccessError", async () => {
    gate.mockResolvedValue(recorder);
    arrange();
    listRecentOwnEntries.mockRejectedValue(new OrgAccessError("gone"));
    await expect(NewGiftPage({ params })).rejects.toBeInstanceOf(OrgAccessError);
  });
});
