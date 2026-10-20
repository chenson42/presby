// @vitest-environment jsdom
/**
 * `/admin/giving` (platform): gate, the four states (permission, error, empty
 * via the tables, data) and the no-donor-data guarantee. The tables have their
 * own specs; they are stubbed here to expose only what the page hands them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const mockHealth = vi.hoisted(() => vi.fn());
const mockDead = vi.hoisted(() => vi.fn());
const mockNames = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/giving-ingest-health", () => ({
  listIngestHealth: (...a: unknown[]) => mockHealth(...a),
  listDeadLetters: (...a: unknown[]) => mockDead(...a),
  listOrganizationNames: (...a: unknown[]) => mockNames(...a),
}));
const healthProps = vi.hoisted(() => vi.fn());
const deadProps = vi.hoisted(() => vi.fn());
vi.mock("./ingest-health-table", () => ({
  IngestHealthTable: (p: unknown) => (healthProps(p), <div data-testid="health-table-stub" />),
}));
vi.mock("./dead-letters-table", () => ({
  DeadLettersTable: (p: unknown) => (deadProps(p), <div data-testid="dead-table-stub" />),
}));

import { FEATURES } from "@/lib/permissions";
import PlatformGivingHealthPage from "./page";

const admin = { user: { features: [FEATURES.ADMIN_ORGANIZATIONS] } };
const hrow = (over: Record<string, unknown> = {}) => ({
  organizationId: "org-1", connectionId: "c1", provider: "stripe", livemode: true, status: "active",
  receivedCount: 4, appliedCount: 3, parkedCount: 1, deadLetterCount: 2, lastReceivedAt: null, oldestPendingSeconds: null, ...over,
});

afterEach(() => {
  cleanup();
  for (const fn of [mockAuth, mockHealth, mockDead, mockNames, healthProps, deadProps]) fn.mockReset();
});

describe("PlatformGivingHealthPage", () => {
  it("without ADMIN_ORGANIZATIONS: a permission message, and NOTHING is read", async () => {
    mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_USERS] } });
    render(await PlatformGivingHealthPage());
    expect(screen.getByText(/don.t have permission to view giving health/)).toBeTruthy();
    expect(mockHealth).not.toHaveBeenCalled();
    expect(mockDead).not.toHaveBeenCalled();
  });

  it("signed out: the same refusal", async () => {
    mockAuth.mockResolvedValue(null);
    render(await PlatformGivingHealthPage());
    expect(screen.getByText(/don.t have permission/)).toBeTruthy();
  });

  it("data: totals from the rows, names resolved from the public join, both tables handed their rows", async () => {
    mockAuth.mockResolvedValue(admin);
    mockHealth.mockResolvedValue([hrow(), hrow({ connectionId: "c2", organizationId: "org-2", parkedCount: 4, deadLetterCount: 0 })]);
    mockDead.mockResolvedValue([{ eventId: "e1", organizationId: "org-1" }]);
    mockNames.mockResolvedValue(new Map([["org-1", "Alder Creek Presbyterian Church"], ["org-2", "Fernwood Community Church"]]));
    render(await PlatformGivingHealthPage());
    const summary = screen.getByTestId("giving-health-summary").textContent ?? "";
    expect(summary).toMatch(/Connections\s*2/);
    expect(summary).toMatch(/Notices waiting\s*5/);
    expect(summary).toMatch(/Dead letters\s*2/);
    expect(mockNames).toHaveBeenCalledWith(["org-1", "org-2", "org-1"]);
    expect(healthProps.mock.calls[0]![0].names.get("org-2")).toBe("Fernwood Community Church");
    expect(deadProps.mock.calls[0]![0].names).toEqual({ "org-1": "Alder Creek Presbyterian Church", "org-2": "Fernwood Community Church" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("empty: zero totals and the tables render their own empty states", async () => {
    mockAuth.mockResolvedValue(admin);
    mockHealth.mockResolvedValue([]);
    mockDead.mockResolvedValue([]);
    mockNames.mockResolvedValue(new Map());
    render(await PlatformGivingHealthPage());
    expect(screen.getByTestId("giving-health-summary").textContent).toMatch(/Connections\s*0/);
    expect(healthProps.mock.calls[0]![0].rows).toEqual([]);
  });

  it("a failed read is an honest error with a retry link - never an empty, all-clear table", async () => {
    mockAuth.mockResolvedValue(admin);
    mockHealth.mockRejectedValue(new Error("db down"));
    mockDead.mockResolvedValue([]);
    render(await PlatformGivingHealthPage());
    expect(screen.getByTestId("giving-health-error").textContent).toMatch(/can.t load giving health right now/);
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/admin/giving");
    expect(screen.queryByTestId("health-table-stub")).toBeNull();
  });

  it("says plainly that no gift, donor or amount is shown", async () => {
    mockAuth.mockResolvedValue(admin);
    mockHealth.mockResolvedValue([]);
    mockDead.mockResolvedValue([]);
    mockNames.mockResolvedValue(new Map());
    const { container } = render(await PlatformGivingHealthPage());
    expect(container.textContent).toMatch(/no gift, donor or\s+amount is shown/);
  });
});
