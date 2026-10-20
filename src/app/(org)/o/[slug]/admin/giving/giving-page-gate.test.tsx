// @vitest-environment jsdom
/**
 * `gateGivingPage()` - the one gate every admin/giving page runs (docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Gate order on every surface"). The
 * overview's page.test.tsx pins the order and the shared states through a real
 * page; this file pins what ONLY the shared gate decides: which key a page
 * needs, what a holder of a DIFFERENT key sees, and which path each redirect
 * carries.
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
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { gateGivingPage } from "./giving-page-gate";

const ORG = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Presbyterian Church", organizationType: "congregation" as const, slug: "alder-creek", platformStatus: "managed" as const },
};
const base = { slug: "alder-creek", path: "/o/alder-creek/admin/giving/funds", section: "Funds" };

function arrange(has: { view: boolean; record: boolean; manage: boolean }) {
  cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
  resolveOrgContext.mockResolvedValue(ORG);
  assertGivingSession.mockReturnValue({ kind: "ok", userId: "user-1" });
  loadGivingContext.mockResolvedValue({ kind: "ok", has });
}

afterEach(() => {
  cleanup();
  for (const fn of [cachedAuth, resolveOrgContext, assertOrgAccess, assertGivingSession, loadGivingContext, redirectMock]) fn.mockReset();
  redirectMock.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("gateGivingPage", () => {
  it("admits a holder of the needed key and returns the resolved org, user and keys", async () => {
    arrange({ view: false, record: false, manage: true });
    expect(await gateGivingPage({ ...base, anyOf: ["manage"] })).toEqual({
      ok: true,
      userId: "user-1",
      org: { personId: "person-1", organizationId: "org-1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" },
      has: { view: false, record: false, manage: true },
    });
  });

  it("admits a holder of ANY of the listed keys", async () => {
    arrange({ view: false, record: true, manage: false });
    expect((await gateGivingPage({ ...base, anyOf: ["view", "record"] })).ok).toBe(true);
  });

  it("a holder of a DIFFERENT giving key gets the section-specific state - names the page, points back, no data (no key implies another)", async () => {
    arrange({ view: true, record: true, manage: false });
    const gate = await gateGivingPage({ ...base, anyOf: ["manage"] });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    render(<>{gate.node}</>);
    expect(screen.getByRole("heading", { level: 1, name: "Funds" })).toBeTruthy();
    expect(screen.getByText(/Funds isn.t available to your account at Alder Creek/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Giving" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving");
  });

  it("a holder of NO giving key gets the general Forbidden state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(ORG);
    assertGivingSession.mockReturnValue({ kind: "ok", userId: "user-1" });
    loadGivingContext.mockResolvedValue({ kind: "forbidden" });
    const gate = await gateGivingPage({ ...base, anyOf: ["manage"] });
    if (gate.ok) throw new Error("expected refusal");
    render(<>{gate.node}</>);
    expect(screen.getByText(/Giving administration isn.t available to your account/)).toBeTruthy();
  });

  it("redirects a signed-out visitor to /signin with THIS page's path (the deep link survives)", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(gateGivingPage({ ...base, anyOf: ["manage"] })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving%2Ffunds",
    );
  });

  it("redirects an unverified-2FA session to /totp with THIS page's path, before reading any giving data", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(ORG);
    assertGivingSession.mockReturnValue({ kind: "two_factor_required" });
    await expect(gateGivingPage({ ...base, anyOf: ["manage"] })).rejects.toThrow(
      "REDIRECT:/totp?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving%2Ffunds",
    );
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("the load-error 'Try again' link returns to THIS page, not the overview", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(ORG);
    assertGivingSession.mockReturnValue({ kind: "ok", userId: "user-1" });
    loadGivingContext.mockRejectedValue(new Error("reset"));
    const gate = await gateGivingPage({ ...base, anyOf: ["manage"] });
    if (gate.ok) throw new Error("expected refusal");
    render(<>{gate.node}</>);
    expect(screen.getByRole("link", { name: /try again/i }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/funds");
  });

  it("rethrows an OrgAccessError rather than rendering it as a load error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(ORG);
    assertGivingSession.mockReturnValue({ kind: "ok", userId: "user-1" });
    loadGivingContext.mockRejectedValue(new OrgAccessError("gone"));
    await expect(gateGivingPage({ ...base, anyOf: ["manage"] })).rejects.toBeInstanceOf(OrgAccessError);
  });
});
