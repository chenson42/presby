// @vitest-environment jsdom
/**
 * `connect/return` (docs/work-log/2026-10-15-online-giving.md, Batch 3b): the
 * URL proves nothing - the page RETRIEVES from Stripe (refreshConnection)
 * before it renders, whatever the query string says. Gate order is the shared
 * gate's (sign-in, org miss, 2FA, toggle, giving.manage).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));
const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a),
  assertOrgAccess: (...a: unknown[]) => assertOrgAccess(...a),
  OrgAccessError,
}));
const assertGivingSession = vi.fn();
const loadGivingContext = vi.fn();
vi.mock("@/lib/giving/access", () => ({
  assertGivingSession: (...a: unknown[]) => assertGivingSession(...a),
  givingTotpRedirectUrl: (p: string) => `/totp?callbackUrl=${encodeURIComponent(p)}`,
  loadGivingContext: (...a: unknown[]) => loadGivingContext(...a),
}));
const refreshConnection = vi.fn();
const loadConnectionPanel = vi.fn();
vi.mock("@/lib/giving/connection", () => ({
  refreshConnection: (...a: unknown[]) => refreshConnection(...a),
  loadConnectionPanel: (...a: unknown[]) => loadConnectionPanel(...a),
}));
vi.mock("../../connect-panel", () => ({ ConnectPanel: () => <div data-testid="connect-panel-stub" /> }));
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import ConnectReturnPage from "./page";
import { panelOf } from "../../connect-fixtures";

const OK_RESOLVED = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Presbyterian Church", organizationType: "congregation" as const, slug: "alder-creek", platformStatus: "managed" as const },
};
const params = Promise.resolve({ slug: "alder-creek" });

function arrange(manage = true) {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
  assertGivingSession.mockReturnValue({ kind: "ok", userId: "u1" });
  assertOrgAccess.mockResolvedValue(undefined);
  loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: false, manage } });
}

afterEach(() => {
  cleanup();
  for (const fn of [cachedAuth, resolveOrgContext, assertOrgAccess, assertGivingSession, loadGivingContext, refreshConnection, loadConnectionPanel, redirectMock]) fn.mockReset();
});

describe("connect/return page", () => {
  it("signed out: redirects to /signin keeping the return URL, and reads nothing from Stripe", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(ConnectReturnPage({ params })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving%2Fconnect%2Freturn",
    );
    expect(refreshConnection).not.toHaveBeenCalled();
  });

  it("a viewer without giving.manage gets the section-forbidden state and NEVER triggers a retrieve", async () => {
    arrange(false);
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: false, manage: false } });
    render(await ConnectReturnPage({ params }));
    expect(screen.getByText(/Stripe connection isn.t available to your account/)).toBeTruthy();
    expect(refreshConnection).not.toHaveBeenCalled();
    expect(loadConnectionPanel).not.toHaveBeenCalled();
  });

  it("toggle off: the honest toggle-off state, no retrieve", async () => {
    arrange();
    loadGivingContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: false });
    render(await ConnectReturnPage({ params }));
    expect(screen.getByText(/Giving isn.t turned on/)).toBeTruthy();
    expect(refreshConnection).not.toHaveBeenCalled();
  });

  it("retrieves from Stripe with the SESSION's identity (never anything from the URL), then reads the panel", async () => {
    arrange();
    const order: string[] = [];
    refreshConnection.mockImplementation(async () => (order.push("refresh"), { kind: "ok", outcome: "applied:status_changed", status: {} }));
    loadConnectionPanel.mockImplementation(async () => (order.push("panel"), { kind: "ok", panel: panelOf("active") }));
    render(await ConnectReturnPage({ params }));
    expect(order).toEqual(["refresh", "panel"]);
    expect(refreshConnection).toHaveBeenCalledWith({ personId: "person-1", organizationId: "org-1", userId: "u1" });
    expect(screen.getByTestId("connect-return-result").textContent).toMatch(/Stripe confirms your account is connected/);
    expect(screen.getByTestId("connection-card").getAttribute("data-state")).toBe("active");
  });

  it("renders the state Stripe reported: pending verification when details are in", async () => {
    arrange();
    refreshConnection.mockResolvedValue({ kind: "ok", outcome: "noop", status: {} });
    loadConnectionPanel.mockResolvedValue({ kind: "ok", panel: panelOf("onboarding", {}, { detailsSubmitted: true }) });
    render(await ConnectReturnPage({ params }));
    expect(screen.getByTestId("connect-return-result").textContent).toMatch(/Stripe has your details and is checking them/);
  });

  it("a returning treasurer who did NOT finish sees details-due, not a success", async () => {
    arrange();
    refreshConnection.mockResolvedValue({ kind: "ok", outcome: "noop", status: {} });
    loadConnectionPanel.mockResolvedValue({ kind: "ok", panel: panelOf("onboarding") });
    render(await ConnectReturnPage({ params }));
    expect(screen.getByTestId("connect-return-result").textContent).toMatch(/still needs a few details/);
    expect(screen.getByTestId("connection-card").getAttribute("data-state")).toBe("details_due");
  });

  it("Stripe unreachable: says nothing was changed and still shows the last known state", async () => {
    arrange();
    refreshConnection.mockResolvedValue({ kind: "provider_error" });
    loadConnectionPanel.mockResolvedValue({ kind: "ok", panel: panelOf("onboarding") });
    render(await ConnectReturnPage({ params }));
    expect(screen.getByTestId("connect-return-result").textContent).toMatch(/couldn.t reach Stripe .* nothing was changed/i);
    expect(screen.getByTestId("connection-card")).toBeTruthy();
  });

  it("no connection: says so and offers to start one", async () => {
    arrange();
    refreshConnection.mockResolvedValue({ kind: "no_connection" });
    loadConnectionPanel.mockResolvedValue({ kind: "ok", panel: panelOf("none") });
    render(await ConnectReturnPage({ params }));
    expect(screen.getByTestId("connect-return-result").textContent).toMatch(/no Stripe connection to check/);
    expect(screen.getByTestId("connection-card").getAttribute("data-state")).toBe("not_started");
  });

  it("a database failure is the load-error state with a retry link, never a blank page", async () => {
    arrange();
    refreshConnection.mockRejectedValue(new Error("connection reset"));
    render(await ConnectReturnPage({ params }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /try again/i }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/connect/return");
  });

  it("has exactly one h1", async () => {
    arrange();
    refreshConnection.mockResolvedValue({ kind: "ok", outcome: "noop", status: {} });
    loadConnectionPanel.mockResolvedValue({ kind: "ok", panel: panelOf("active") });
    const { container } = render(await ConnectReturnPage({ params }));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
