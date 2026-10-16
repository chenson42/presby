// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/giving` — docs/work-log/
 * 2026-10-15-online-giving.md, Batch 1b (the toggle-aware shell) and Batch 2
 * (the overview). Replaces the product-IA placeholder's test (DECISION-117):
 * the `org_portal.giving` PLATFORM flag is gone (R11), so there is no flag gate
 * to test; the gate is the per-org toggle, read by `loadGivingContext` (mocked
 * here — its own DB-backed suite is `src/lib/giving/access.test.ts`).
 *
 * The page runs the shared `gateGivingPage()` unmocked, so these tests pin the
 * gate's behaviour THROUGH the page: the shared four-way miss, the gate ORDER
 * (sign-in -> org miss -> assertOrgAccess -> Node-side 2FA ->
 * applicability/toggle -> permission), each state's copy and the Features link
 * rule, the load-error state (a blip is never an empty or "off" answer). The
 * "ok" half pins what the overview shows to whom (S4/S5): a recorder sees one
 * attention number and only the tiles their key opens.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
const { OrgAccessError } = vi.hoisted(() => ({
  OrgAccessError: class OrgAccessError extends Error {},
}));
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
  assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
  withOrgContext: (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn({}),
  OrgAccessError,
}));

const loadAttention = vi.fn();
vi.mock("@/lib/giving/attention", () => ({
  loadAttention: (...args: unknown[]) => loadAttention(...args),
}));

const assertGivingSession = vi.fn();
const loadGivingContext = vi.fn();
vi.mock("@/lib/giving/access", () => ({
  assertGivingSession: (...args: unknown[]) => assertGivingSession(...args),
  givingTotpRedirectUrl: (path: string) => `/totp?callbackUrl=${encodeURIComponent(path)}`,
  loadGivingContext: (...args: unknown[]) => loadGivingContext(...args),
}));

// The shell must not consult the retired platform flag.
const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({ isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args) }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
}));

import GivingAdminPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  assertGivingSession.mockReset();
  loadGivingContext.mockReset();
  loadAttention.mockReset();
  isFlagEnabled.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const OK_RESOLVED = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

const params = (slug = "alder-creek") => Promise.resolve({ slug });

const CLEAR = {
  scope: "full",
  failedGifts: 0, stuckPending: 0, monthlyPaymentFailures: 0,
  connection: { state: "none", testMode: false, requirementsDue: false, publicPageOn: false },
  parkedEvents: 0, deadLetters: 0, staleStatements: 0, possibleDuplicateDonors: 0, linkProposals: 0,
};
const RECORDER_ATTENTION = {
  scope: "recorder",
  failedGifts: null, stuckPending: null, monthlyPaymentFailures: null, connection: null,
  parkedEvents: null, deadLetters: null, staleStatements: null, possibleDuplicateDonors: null, linkProposals: 0,
};

/** A signed-in session whose 2FA check passes, and a resolved org. */
function arrangeSignedIn() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
  assertGivingSession.mockReturnValue({ kind: "ok", userId: "u1" });
}

describe("GivingAdminPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/giving when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(GivingAdminPage({ params: params() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(GivingAdminPage({ params: params() })).rejects.toThrow("NOT_FOUND");
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("renders the shared access-denied copy for a forbidden org relationship, reading nothing further", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Some Other Church",
      organizationType: "congregation",
    });
    render(await GivingAdminPage({ params: params("other-church") }));
    expect(screen.getByText(/you don.t have access to Some Other Church/i)).toBeTruthy();
    expect(assertOrgAccess).not.toHaveBeenCalled();
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });
    render(await GivingAdminPage({ params: params("fernwood") }));
    expect(screen.getByText(/your access to Fernwood.*has ended/i)).toBeTruthy();
    expect(loadGivingContext).not.toHaveBeenCalled();
  });
});

describe("GivingAdminPage — gate ordering", () => {
  it("calls assertOrgAccess before the 2FA check, and the 2FA check before the toggle/permission read", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "forbidden" });
    const order: string[] = [];
    assertOrgAccess.mockImplementation(async () => void order.push("assertOrgAccess"));
    assertGivingSession.mockImplementation(() => {
      order.push("assertGivingSession");
      return { kind: "ok", userId: "u1" };
    });
    loadGivingContext.mockImplementation(async () => {
      order.push("loadGivingContext");
      return { kind: "forbidden" };
    });
    await GivingAdminPage({ params: params() });
    expect(order).toEqual(["assertOrgAccess", "assertGivingSession", "loadGivingContext"]);
    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });

  it("refuses a session that requires 2FA and has not verified it: redirects to /totp with the callback, and reads NOTHING about giving", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    assertGivingSession.mockReturnValue({ kind: "two_factor_required" });
    await expect(GivingAdminPage({ params: params() })).rejects.toThrow(
      "REDIRECT:/totp?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving",
    );
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("hands the 2FA check the session it just read", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "forbidden" });
    await GivingAdminPage({ params: params() });
    expect(assertGivingSession).toHaveBeenCalledWith({ user: { id: "u1" } });
  });

  it("never consults a platform flag (R11: giving is toggle-only)", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: false, manage: false } });
    await GivingAdminPage({ params: params() });
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it("passes loadGivingContext the resolved person, organization and TYPE (never a slug-derived guess)", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "forbidden" });
    await GivingAdminPage({ params: params() });
    expect(loadGivingContext).toHaveBeenCalledWith({
      personId: "person-1",
      organizationId: "org-1",
      organizationType: "congregation",
    });
  });
});

describe("GivingAdminPage — states", () => {
  it("not_applicable: names the organization and says who Giving is for, no Features link", async () => {
    arrangeSignedIn();
    resolveOrgContext.mockResolvedValue({
      ...OK_RESOLVED,
      org: { ...OK_RESOLVED.org, name: "Presbytery of the Alders", organizationType: "presbytery" },
    });
    loadGivingContext.mockResolvedValue({ kind: "not_applicable" });
    render(await GivingAdminPage({ params: params() }));
    expect(screen.getByRole("heading", { name: "Giving" })).toBeTruthy();
    expect(
      screen.getByText(/giving isn.t available for Presbytery of the Alders/i),
    ).toBeTruthy();
    expect(screen.getByText(/congregations and new worshiping communities/i)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("toggle_off for an org_features.manage holder: an honest 'not turned on' with a link to Features — never a 404", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: true });
    render(await GivingAdminPage({ params: params() }));
    expect(screen.getByText(/giving isn.t turned on for Alder Creek Presbyterian Church/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /go to features/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/features");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("toggle_off for anyone else: the same honest message, NO Features link (it would only lead to their own Forbidden)", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: false });
    render(await GivingAdminPage({ params: params() }));
    expect(screen.getByText(/giving isn.t turned on for Alder Creek Presbyterian Church/i)).toBeTruthy();
    expect(screen.getByText(/ask an administrator who manages your organization.s features/i)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("forbidden: toggle on but no giving key — names the org, points at the treasurer, no data", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "forbidden" });
    render(await GivingAdminPage({ params: params() }));
    expect(
      screen.getByText(/giving administration isn.t available to your account at Alder Creek/i),
    ).toBeTruthy();
    expect(screen.getByText(/ask your treasurer/i)).toBeTruthy();
  });

  it("a database failure renders the load-error state with a retry link — never an empty or 'off' answer", async () => {
    arrangeSignedIn();
    loadGivingContext.mockRejectedValue(new Error("connection reset"));
    render(await GivingAdminPage({ params: params() }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /try again/i }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/giving",
    );
    expect(screen.queryByText(/isn.t turned on/i)).toBeNull();
  });

  it("an OrgAccessError (membership ended mid-request) is rethrown, not swallowed into the load-error state", async () => {
    arrangeSignedIn();
    loadGivingContext.mockRejectedValue(new OrgAccessError("gone"));
    await expect(GivingAdminPage({ params: params() })).rejects.toBeInstanceOf(OrgAccessError);
  });

  it("ok: names the organization, shows attention and the tiles the viewer's keys open - and nothing the ledger holds", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: true, manage: true } });
    loadAttention.mockResolvedValue(CLEAR);
    const { container } = render(await GivingAdminPage({ params: params() }));
    expect(screen.getByRole("heading", { level: 1, name: "Giving" })).toBeTruthy();
    expect(screen.getByText("Alder Creek Presbyterian Church")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeTruthy();
    expect(screen.getByText("Nothing needs attention")).toBeTruthy();
    // the manage-only "Online giving" placeholder is honest that Stripe is not set up
    expect(screen.getByRole("heading", { name: "Online giving" })).toBeTruthy();
    expect(screen.getByText("Not set up")).toBeTruthy();
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/o/alder-creek/admin/giving/gifts/new",
        "/o/alder-creek/admin/giving/gifts",
        "/o/alder-creek/admin/giving/donors",
        "/o/alder-creek/admin/giving/funds",
        "/o/alder-creek/admin/giving/settings",
        "/o/alder-creek/admin/giving/team",
      ]),
    );
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it("hands loadAttention the transaction, the organization AND the viewer's keys (so a recorder is narrowed in ONE place)", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: true, manage: false } });
    loadAttention.mockResolvedValue(RECORDER_ATTENTION);
    await GivingAdminPage({ params: params() });
    expect(loadAttention).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      has: { view: false, record: true, manage: false },
    });
  });

  it("S4: a recorder sees only Record a gift, their recent entries and Donors - no Funds, Settings, Team, ledger or Online giving card", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: true, manage: false } });
    loadAttention.mockResolvedValue({ ...RECORDER_ATTENTION, linkProposals: 2 });
    const { container } = render(await GivingAdminPage({ params: params() }));
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/o/alder-creek/admin/giving/gifts/new",
        "/o/alder-creek/admin/giving/donors",
      ]),
    );
    expect(screen.getByText("Your recent entries")).toBeTruthy();
    expect(screen.queryByText("Funds")).toBeNull();
    expect(screen.queryByText("Statement details")).toBeNull();
    expect(screen.queryByText("Giving team")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Online giving" })).toBeNull();
    // the one thing they are told: donor suggestions
    expect(screen.getByText(/2 donors look like a member/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/failed|pending|monthly|Stripe/i);
  });

  it("a viewer without record sees Gifts (the ledger), not 'Record a gift'; a manager sees Funds, Statement details and Giving team", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: false, manage: false } });
    loadAttention.mockResolvedValue(CLEAR);
    const first = render(await GivingAdminPage({ params: params() }));
    expect(screen.getByText("Gifts")).toBeTruthy();
    expect(screen.queryByText("Record a gift")).toBeNull();
    expect(screen.queryByText("Funds")).toBeNull();
    first.unmount();

    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: false, manage: true } });
    render(await GivingAdminPage({ params: params() }));
    expect(screen.getByText("Funds")).toBeTruthy();
    expect(screen.getByText("Statement details")).toBeTruthy();
    expect(screen.getByText("Giving team")).toBeTruthy();
    expect(screen.queryByText("Record a gift")).toBeNull();
  });

  it("a failure loading attention is the honest load-error state, not an empty list", async () => {
    arrangeSignedIn();
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: false, manage: false } });
    loadAttention.mockRejectedValue(new Error("connection reset"));
    render(await GivingAdminPage({ params: params() }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.queryByText("Nothing needs attention")).toBeNull();
  });

  it("renders exactly one h1 in every state (ui-standards: one h1 per page)", async () => {
    for (const ctx of [
      { kind: "not_applicable" },
      { kind: "toggle_off", canManageFeatures: true },
      { kind: "forbidden" },
      { kind: "ok", has: { view: true, record: true, manage: true } },
    ]) {
      arrangeSignedIn();
      loadGivingContext.mockResolvedValue(ctx);
      loadAttention.mockResolvedValue(CLEAR);
      const { container, unmount } = render(await GivingAdminPage({ params: params() }));
      expect(container.querySelectorAll("h1").length).toBe(1);
      unmount();
    }
  });
});
