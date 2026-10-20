// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/funds` page (docs/work-log/2026-10-15-online-giving.md,
 * Batch 2). The gate is mocked (giving-page-gate.test.tsx owns it); this pins
 * the page's key, its four states and the active/retired split.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const listFunds = vi.fn();
vi.mock("@/lib/giving/funds", () => ({ listFunds: (...a: unknown[]) => listFunds(...a) }));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
vi.mock("./fund-form", () => ({ FundForm: () => <div data-testid="fund-form" /> }));
vi.mock("./fund-row-actions", () => ({ FundRowActions: ({ fund }: { fund: { name: string } }) => <div data-testid={`actions-${fund.name}`} /> }));
vi.mock("./create-general-fund-button", () => ({ CreateGeneralFundButton: () => <button type="button">Create General Fund</button> }));

import GivingFundsPage from "./page";

const OK = { ok: true, userId: "u1", org: { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" }, has: { view: false, record: false, manage: true } };
const fund = (over: Record<string, unknown> = {}) => ({
  id: "f1", name: "General Fund", onlineDisplayName: null, description: null, restrictionClass: "unrestricted",
  offeredOnline: false, isActive: true, retiredOn: null, sortOrder: 0, hasGifts: false, ...over,
});
const params = Promise.resolve({ slug: "alder-creek" });

afterEach(() => {
  cleanup();
  gate.mockReset();
  listFunds.mockReset();
});

describe("GivingFundsPage", () => {
  it("asks the gate for giving.manage on THIS page's path", async () => {
    gate.mockResolvedValue(OK);
    listFunds.mockResolvedValue({ kind: "ok", funds: [fund()], publicPageLive: false });
    await GivingFundsPage({ params });
    expect(gate).toHaveBeenCalledWith({ slug: "alder-creek", path: "/o/alder-creek/admin/giving/funds", anyOf: ["manage"], section: "Funds" });
  });

  it("returns the gate's refusal node and reads no funds", async () => {
    gate.mockResolvedValue({ ok: false, node: <p>REFUSED</p> });
    render(await GivingFundsPage({ params }));
    expect(screen.getByText("REFUSED")).toBeTruthy();
    expect(listFunds).not.toHaveBeenCalled();
  });

  it("empty: a designed state with the one action that fills it", async () => {
    gate.mockResolvedValue(OK);
    listFunds.mockResolvedValue({ kind: "ok", funds: [], publicPageLive: false });
    render(await GivingFundsPage({ params }));
    expect(screen.getByText("No funds yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create General Fund" })).toBeTruthy();
    expect(screen.getByTestId("fund-form")).toBeTruthy(); // the add form is always offered
  });

  it("populated: active funds under 'Active funds', retired under their own heading, with badges in words", async () => {
    gate.mockResolvedValue(OK);
    listFunds.mockResolvedValue({
      kind: "ok",
      publicPageLive: true,
      funds: [
        fund({ id: "f1", name: "General Fund", offeredOnline: true, onlineDisplayName: "Giving" }),
        fund({ id: "f2", name: "Building Fund", restrictionClass: "temporarily_restricted" }),
        fund({ id: "f3", name: "Old Missions", isActive: false, retiredOn: "2026-01-31" }),
      ],
    });
    render(await GivingFundsPage({ params }));
    expect(screen.getByRole("heading", { level: 1, name: "Funds" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active funds" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Retired funds" })).toBeTruthy();
    expect(screen.getByText("Offered online")).toBeTruthy();
    expect(screen.getByText("Donors see: Giving")).toBeTruthy();
    expect(screen.getByText("Temporarily restricted")).toBeTruthy();
    expect(screen.getAllByText("Retired").length).toBeGreaterThan(0);
    expect(screen.getByTestId("actions-Old Missions")).toBeTruthy();
    expect(screen.queryByText("No funds yet")).toBeNull();
  });

  it("every fund retired: says so instead of an empty heading", async () => {
    gate.mockResolvedValue(OK);
    listFunds.mockResolvedValue({ kind: "ok", publicPageLive: false, funds: [fund({ isActive: false })] });
    render(await GivingFundsPage({ params }));
    expect(screen.getByText(/Every fund is retired/)).toBeTruthy();
  });

  it("a database failure is the load-error state with a retry to THIS page - never an empty list", async () => {
    gate.mockResolvedValue(OK);
    listFunds.mockRejectedValue(new Error("reset"));
    render(await GivingFundsPage({ params }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /try again/i }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/funds");
    expect(screen.queryByText("No funds yet")).toBeNull();
  });

  it("rethrows an OrgAccessError", async () => {
    gate.mockResolvedValue(OK);
    listFunds.mockRejectedValue(new OrgAccessError("gone"));
    await expect(GivingFundsPage({ params })).rejects.toBeInstanceOf(OrgAccessError);
  });

  it("exactly one h1", async () => {
    gate.mockResolvedValue(OK);
    listFunds.mockResolvedValue({ kind: "ok", funds: [fund()], publicPageLive: false });
    const { container } = render(await GivingFundsPage({ params }));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
