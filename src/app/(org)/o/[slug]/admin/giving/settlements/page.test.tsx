// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/settlements` - the read-only payouts page
 * (docs/work-log/2026-10-15-online-giving.md, Batch 6). Pins the gate, the four
 * designed states (forbidden/off via the gate, a load error that is NOT an empty
 * list, empty, populated), and the five honest statements about a payout's
 * contents - above all that a MANUAL payout reads "Reconciliation unavailable"
 * and never "no transactions".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const gateGivingPage = vi.hoisted(() => vi.fn());
vi.mock("../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gateGivingPage(...a) }));
const listSettlements = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/settlements", () => ({ listSettlements: (...a: unknown[]) => listSettlements(...a) }));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));

import GivingSettlementsPage from "./page";

const params = Promise.resolve({ slug: "alder-creek" });
const GATE_OK = {
  ok: true,
  userId: "user-1",
  org: { personId: "person-1", organizationId: "org-1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" },
  has: { view: true, record: false, manage: false },
};

const payout = (over: Record<string, unknown> = {}) => ({
  id: "s1", payoutId: "po_fixture0000001", arrivalDate: "2027-02-03", status: "paid", automatic: true, testMode: false,
  amountCents: 6708, recordedAt: "2027-02-03T10:00:00Z", linesLoaded: true, lineCount: 3, chargeCount: 2, chargeGrossCents: 8000,
  returnCount: 1, returnGrossCents: -1000, feeCents: 292, netCents: 6708, unmatchedCharges: 0, ...over,
});

afterEach(() => {
  cleanup();
  gateGivingPage.mockReset();
  listSettlements.mockReset();
});

describe("the gate and the states", () => {
  it("runs the shared giving gate for giving.view only", async () => {
    gateGivingPage.mockResolvedValue(GATE_OK);
    listSettlements.mockResolvedValue({ kind: "ok", settlements: [], truncated: false });
    render(await GivingSettlementsPage({ params }));
    expect(gateGivingPage).toHaveBeenCalledWith({ slug: "alder-creek", path: "/o/alder-creek/admin/giving/settlements", anyOf: ["view"], section: "Payouts" });
    expect(listSettlements).toHaveBeenCalledWith("person-1", "org-1");
  });

  it("a gate refusal (forbidden, toggle-off, not applicable) is returned as is, and nothing is read", async () => {
    gateGivingPage.mockResolvedValue({ ok: false, node: <p>GATE NODE</p> });
    render(await GivingSettlementsPage({ params }));
    expect(screen.getByText("GATE NODE")).toBeTruthy();
    expect(listSettlements).not.toHaveBeenCalled();
  });

  it("a database failure is the honest load error, never an empty list", async () => {
    gateGivingPage.mockResolvedValue(GATE_OK);
    listSettlements.mockRejectedValue(new Error("db down"));
    render(await GivingSettlementsPage({ params }));
    expect(screen.getByText(/can.t load Giving right now/)).toBeTruthy();
    expect(screen.queryByTestId("settlements-empty")).toBeNull();
  });

  it("a membership that ended mid-request is rethrown to the segment's boundary", async () => {
    gateGivingPage.mockResolvedValue(GATE_OK);
    listSettlements.mockRejectedValue(new OrgAccessError("ended"));
    await expect(GivingSettlementsPage({ params })).rejects.toBeInstanceOf(OrgAccessError);
  });

  it("a library 'forbidden' (the key was lost mid-request) is the load error, not a leak", async () => {
    gateGivingPage.mockResolvedValue(GATE_OK);
    listSettlements.mockResolvedValue({ kind: "forbidden" });
    render(await GivingSettlementsPage({ params }));
    expect(screen.getByText(/can.t load Giving right now/)).toBeTruthy();
  });

  it("empty: says what normally appears here", async () => {
    gateGivingPage.mockResolvedValue(GATE_OK);
    listSettlements.mockResolvedValue({ kind: "ok", settlements: [], truncated: false });
    render(await GivingSettlementsPage({ params }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Payouts");
    expect(within(screen.getByTestId("settlements-empty")).getByText("No payouts yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Giving" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving");
  });
});

describe("a payout's contents, said honestly", () => {
  async function renderRows(rows: unknown[], truncated = false) {
    gateGivingPage.mockResolvedValue(GATE_OK);
    listSettlements.mockResolvedValue({ kind: "ok", settlements: rows, truncated });
    return render(await GivingSettlementsPage({ params }));
  }

  it("an automatic payout whose lines add up: the figures, the net and 'adds up'; every charge matched", async () => {
    await renderRows([payout()]);
    const row = screen.getByTestId("settlement-row");
    expect(row.getAttribute("data-reconciliation")).toBe("balanced");
    expect(row.textContent).toContain("po_fixture0000001");
    expect(row.textContent).toContain("$67.08");
    expect(row.textContent).toContain("Charges (2)");
    expect(row.textContent).toContain("$80.00");
    expect(row.textContent).toContain("Refunds and disputes (1)");
    expect(row.textContent).toContain("-$10.00");
    expect(row.textContent).toContain("-$2.92");
    expect(row.textContent).toContain("Net deposited");
    expect(row.textContent).toContain("The transactions below add up to the payout.");
    expect(within(row).getByTestId("settlement-matching").textContent).toBe("Every charge matches a gift recorded here.");
    expect(within(row).getByText("Paid")).toBeTruthy();
    expect(within(row).getByText("Automatic")).toBeTruthy();
  });

  it("says how many charges match no recorded gift", async () => {
    await renderRows([payout({ unmatchedCharges: 1 }), payout({ id: "s2", unmatchedCharges: 2 })]);
    const [a, b] = screen.getAllByTestId("settlement-matching");
    expect(a!.textContent).toMatch(/1 charge doesn't match a gift recorded here/);
    expect(b!.textContent).toMatch(/2 charges don't match a gift recorded here/);
  });

  it("lines that do not add up to the payout are a stated MISMATCH with both numbers", async () => {
    await renderRows([payout({ amountCents: 9999, netCents: 4900 })]);
    const row = screen.getByTestId("settlement-row");
    expect(row.getAttribute("data-reconciliation")).toBe("mismatch");
    expect(row.textContent).toContain("The transactions listed total $49.00, but the payout was $99.99.");
    expect(row.textContent).not.toContain("add up to the payout");
  });

  it("a MANUAL payout reads 'Reconciliation unavailable' - never zero transactions or a zero net", async () => {
    await renderRows([payout({ automatic: false, linesLoaded: false, lineCount: 0, chargeCount: 0, chargeGrossCents: 0, returnCount: 0, returnGrossCents: 0, feeCents: 0, netCents: 0, amountCents: 40000 })]);
    const row = screen.getByTestId("settlement-row");
    expect(row.getAttribute("data-reconciliation")).toBe("manual");
    expect(within(row).getByTestId("settlement-manual").textContent).toContain("Reconciliation unavailable");
    expect(within(row).getByText("Manual")).toBeTruthy();
    expect(row.textContent).toContain("$400.00");
    expect(within(row).queryByTestId("settlement-contents")).toBeNull();
    expect(row.textContent).not.toMatch(/Charges \(0\)|Net deposited/);
  });

  it("an automatic payout whose lines have not arrived says so, without figures", async () => {
    await renderRows([payout({ linesLoaded: false, lineCount: 0, netCents: 0 })]);
    const row = screen.getByTestId("settlement-row");
    expect(row.getAttribute("data-reconciliation")).toBe("waiting");
    expect(within(row).getByTestId("settlement-waiting")).toBeTruthy();
    expect(within(row).queryByTestId("settlement-contents")).toBeNull();
  });

  it("a failed payout says there is nothing to match; a test payout is flagged; an undated one says so", async () => {
    await renderRows([payout({ status: "failed", arrivalDate: null, testMode: true })]);
    const row = screen.getByTestId("settlement-row");
    expect(row.getAttribute("data-reconciliation")).toBe("failed");
    expect(within(row).getByText("Failed")).toBeTruthy();
    expect(within(row).getByText("Test")).toBeTruthy();
    expect(row.textContent).toContain("Date not given");
    expect(row.textContent).toContain("nothing to match");
  });

  it("says plainly when only the newest payouts are shown", async () => {
    await renderRows([payout()], true);
    expect(screen.getByTestId("settlements-truncated").textContent).toBe("Showing the 1 most recent payouts.");
  });

  it("is read-only: no form, no button that acts", async () => {
    const { container } = await renderRows([payout(), payout({ id: "s2", automatic: false })]);
    expect(container.querySelector("form, button, input")).toBeNull();
  });
});
