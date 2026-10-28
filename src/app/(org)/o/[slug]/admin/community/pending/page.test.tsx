// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/community/pending`'s page.tsx —
 * same gate-composition and error-handling contract as
 * `admin/community/page.test.tsx`, applied to `listPendingRollActions()`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  }
  return {
    OrgAccessError: MockOrgAccessError,
    resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
    assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
  };
});

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const isOrgFeatureEnabled = vi.fn();
vi.mock("@/lib/org-features", () => ({
  isOrgFeatureEnabled: (...args: unknown[]) => isOrgFeatureEnabled(...args),
}));

const listPendingRollActions = vi.fn();
const listRecentlyDecidedRollActions = vi.fn();
const getSessionApprovalState = vi.fn();
vi.mock("@/lib/roll", () => ({
  listPendingRollActions: (...args: unknown[]) => listPendingRollActions(...args),
  listRecentlyDecidedRollActions: (...args: unknown[]) =>
    listRecentlyDecidedRollActions(...args),
  getSessionApprovalState: (...args: unknown[]) => getSessionApprovalState(...args),
}));

const listSessionSignInRows = vi.fn();
vi.mock("@/lib/onboarding/org-invite", () => ({
  listSessionSignInRows: (...args: unknown[]) => listSessionSignInRows(...args),
}));

vi.mock("./actions", () => ({
  approveRollActionAction: vi.fn(),
  approveRollActionsAction: vi.fn(),
  denyRollActionAction: vi.fn(),
  withdrawRollActionAction: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import PendingMembersPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  isOrgFeatureEnabled.mockReset();
  listPendingRollActions.mockReset();
  listRecentlyDecidedRollActions.mockReset();
  getSessionApprovalState.mockReset();
  listSessionSignInRows.mockReset();
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

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

function makeSearch(page?: string) {
  return Promise.resolve(page === undefined ? {} : { page });
}

const VIEWER_DECIDE = { canApprove: true, canPropose: false, canManagePeople: true };
const VIEWER_READ = { canApprove: false, canPropose: true, canManagePeople: false };
const PAGINATION = { page: 1, pageSize: 50, total: 0, totalPages: 1 };

function action(over: Record<string, unknown> = {}) {
  return {
    id: "ra-1",
    personId: "person-9",
    personDisplayName: "Nora Ashgrove",
    kind: "profession_of_faith",
    effectiveDate: "2026-06-01",
    minuteReference: null,
    proposedOn: "2026-05-20",
    proposedByIsViewer: false,
    membershipEnded: false,
    personDeceased: false,
    ...over,
  };
}

function sessionState(kind: string, over: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    state: {
      kind,
      recorded: 0,
      startingLater: 0,
      nextStart: null,
      withAccount: 0,
      canApprove: 0,
      viewer: { canApprove: false, canManageOfficers: false },
      ...over,
    },
  };
}

function gates() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
  isFlagEnabled.mockResolvedValue(true);
  isOrgFeatureEnabled.mockResolvedValue(true);
}

describe("PendingMembersPage — gate composition", () => {
  it("flag off → renders flag-off, never calls listPendingRollActions", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() });
    render(el);

    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
    expect(listPendingRollActions).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("flag on but org toggle off → renders flag-off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(false);

    const el = await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() });
    render(el);

    expect(listPendingRollActions).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("both on → calls listPendingRollActions and renders the worklist", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "decide",
      actions: [],
      pagination: PAGINATION,
      viewer: VIEWER_DECIDE,
    });
    listRecentlyDecidedRollActions.mockResolvedValue({ kind: "ok", actions: [] });
    getSessionApprovalState.mockResolvedValue(sessionState("ready"));

    const el = await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() });
    render(el);

    expect(
      screen.getByRole("heading", { name: /pending approvals/i }),
    ).toBeTruthy();
    expect(screen.getByText(/nothing waiting for your approval/i)).toBeTruthy();
  });
});

describe("PendingMembersPage — error handling", () => {
  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    listPendingRollActions.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(
      PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("forbidden → renders MembersForbidden", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    listPendingRollActions.mockResolvedValue({ kind: "forbidden" });

    const el = await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() });
    render(el);

    expect(screen.getByText(/don.t have permission to do that/i)).toBeTruthy();
  });
});

describe("PendingMembersPage — modes, banner, history, pagination", () => {
  it("decide mode: Approve and Deny render, no banner when the Session is ready", async () => {
    gates();
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "decide",
      actions: [action()],
      pagination: PAGINATION,
      viewer: VIEWER_DECIDE,
    });
    listRecentlyDecidedRollActions.mockResolvedValue({ kind: "ok", actions: [] });
    getSessionApprovalState.mockResolvedValue(sessionState("ready"));

    render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));

    expect(screen.getByRole("button", { name: /^approve nora/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^deny nora/i })).toBeTruthy();
    expect(screen.queryByTestId("session-state-banner")).toBeNull();
    expect(screen.getByText(/nothing decided yet/i)).toBeTruthy();
  });

  it("read mode (a propose-only holder): no Approve, Deny or checkbox, the subtitle and the banner show", async () => {
    gates();
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "read",
      actions: [action()],
      pagination: PAGINATION,
      viewer: VIEWER_READ,
    });
    listRecentlyDecidedRollActions.mockResolvedValue({ kind: "ok", actions: [] });
    getSessionApprovalState.mockResolvedValue(sessionState("empty"));

    render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));

    expect(screen.queryByRole("button", { name: /^approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^deny/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: /withdraw proposal for nora/i })).toBeTruthy();
    expect(screen.getByText(/only members of the session can approve/i)).toBeTruthy();
    expect(screen.getByText(/your session roster is empty/i)).toBeTruthy();
  });

  it("decide mode shows the banner only for no_session", async () => {
    gates();
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "decide",
      actions: [],
      pagination: PAGINATION,
      viewer: VIEWER_DECIDE,
    });
    listRecentlyDecidedRollActions.mockResolvedValue({ kind: "ok", actions: [] });

    getSessionApprovalState.mockResolvedValue(sessionState("empty"));
    const { unmount } = render(
      await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }),
    );
    expect(screen.queryByTestId("session-state-banner")).toBeNull();
    unmount();

    getSessionApprovalState.mockResolvedValue(sessionState("no_session"));
    render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));
    expect(screen.getByText(/no session to approve/i)).toBeTruthy();
  });

  describe("the Session hand-off (Community Increment 2b)", () => {
    function readMode() {
      gates();
      listPendingRollActions.mockResolvedValue({
        kind: "ok",
        mode: "read",
        actions: [action()],
        pagination: PAGINATION,
        viewer: VIEWER_READ,
      });
      listRecentlyDecidedRollActions.mockResolvedValue({ kind: "ok", actions: [] });
      getSessionApprovalState.mockResolvedValue(sessionState("no_sign_in", { recorded: 2 }));
    }

    it("a viewer with both keys gets the rows, read with the session's user and organization, and the toggle decides the first sentence", async () => {
      readMode();
      cachedAuth.mockResolvedValue({ user: { id: "u1", email: "clerk@example.invalid" } });
      listSessionSignInRows.mockResolvedValue({
        kind: "ok",
        rows: [{ personId: "p-1", name: "Nora Ashgrove", state: "not_invited", sentAt: null, action: "invite" }],
      });
      isOrgFeatureEnabled.mockImplementation(async (_p: string, _o: string, key: string) => key !== "org_portal.sign_in_connect");

      render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));

      expect(listSessionSignInRows).toHaveBeenCalledTimes(1);
      expect(listSessionSignInRows.mock.calls[0][0]).toEqual({
        organizationId: "org-1",
        actingPersonId: "person-1",
        actingUserId: "u1",
        actingUserEmail: "clerk@example.invalid",
      });
      expect(screen.getByTestId("session-sign-in-row").textContent).toContain("Nora Ashgrove");
      // Toggle off (the mock answers false for it): the rows, not the sentence.
      expect(screen.queryByText(/is also connected when they sign in/i)).toBeNull();
    });

    it("toggle on adds the first sentence", async () => {
      readMode();
      listSessionSignInRows.mockResolvedValue({ kind: "ok", rows: [] });
      isOrgFeatureEnabled.mockResolvedValue(true);
      render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));
      expect(screen.getByText(/is also connected when they sign in/i)).toBeTruthy();
    });

    it("any other viewer (forbidden) and a failed read get the one no-names sentence and no link", async () => {
      readMode();
      listSessionSignInRows.mockResolvedValue({ kind: "forbidden" });
      const { unmount } = render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));
      expect(screen.getByText("Ask an administrator to invite your Session members to sign in.")).toBeTruthy();
      expect(screen.queryByTestId("session-sign-in-rows")).toBeNull();
      unmount();

      listSessionSignInRows.mockResolvedValue({ kind: "error" });
      render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));
      expect(screen.getByText("Ask an administrator to invite your Session members to sign in.")).toBeTruthy();
    });

    it("reads the rows only for the no_sign_in banner", async () => {
      readMode();
      getSessionApprovalState.mockResolvedValue(sessionState("no_permission", { recorded: 2 }));
      render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));
      expect(listSessionSignInRows).not.toHaveBeenCalled();
    });
  });

  it("?page= reaches the library and the pager links to the next page", async () => {
    gates();
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "decide",
      actions: [action()],
      pagination: { page: 2, pageSize: 50, total: 120, totalPages: 3 },
      viewer: VIEWER_DECIDE,
    });
    listRecentlyDecidedRollActions.mockResolvedValue({ kind: "ok", actions: [] });
    getSessionApprovalState.mockResolvedValue(sessionState("ready"));

    render(
      await PendingMembersPage({ params: makeParams(), searchParams: makeSearch("2") }),
    );

    expect(listPendingRollActions).toHaveBeenCalledWith("person-1", "org-1", { page: 2 });
    const next = screen.getByRole("link", { name: /next/i });
    expect(next.getAttribute("href")).toBe("/o/alder-creek/admin/community/pending?page=3");
    const prev = screen.getByRole("link", { name: /previous/i });
    expect(prev.getAttribute("href")).toBe("/o/alder-creek/admin/community/pending");
  });

  it("a garbage ?page= falls back to page 1", async () => {
    gates();
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "decide",
      actions: [],
      pagination: PAGINATION,
      viewer: VIEWER_DECIDE,
    });
    listRecentlyDecidedRollActions.mockResolvedValue({ kind: "ok", actions: [] });
    getSessionApprovalState.mockResolvedValue(sessionState("ready"));

    render(
      await PendingMembersPage({ params: makeParams(), searchParams: makeSearch("-4x") }),
    );
    expect(listPendingRollActions).toHaveBeenCalledWith("person-1", "org-1", { page: 1 });
  });

  it("a database failure in any of the three reads renders the load-error state", async () => {
    gates();
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "decide",
      actions: [],
      pagination: PAGINATION,
      viewer: VIEWER_DECIDE,
    });
    listRecentlyDecidedRollActions.mockRejectedValue(new Error("boom"));
    getSessionApprovalState.mockResolvedValue(sessionState("ready"));

    render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.getByRole("heading", { name: /pending approvals/i })).toBeTruthy();
    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });

  it("recently decided renders approvals, denials and reasons, with the self-approved badge", async () => {
    gates();
    listPendingRollActions.mockResolvedValue({
      kind: "ok",
      mode: "decide",
      actions: [],
      pagination: PAGINATION,
      viewer: VIEWER_DECIDE,
    });
    listRecentlyDecidedRollActions.mockResolvedValue({
      kind: "ok",
      actions: [
        {
          id: "d1", personId: "p1", personDisplayName: "Ada Birch", kind: "profession_of_faith",
          effectiveDate: "2026-05-01", status: "denied", decidedOn: "2026-05-02",
          reason: "Duplicate of an earlier entry", minuteReference: null, selfDecided: false,
        },
        {
          id: "d2", personId: "p2", personDisplayName: "Cal Dune", kind: "reaffirmation",
          effectiveDate: "2026-04-01", status: "approved", decidedOn: "2026-04-02",
          reason: null, minuteReference: "Minutes 4/2", selfDecided: true,
        },
      ],
    });
    getSessionApprovalState.mockResolvedValue(sessionState("ready"));

    render(await PendingMembersPage({ params: makeParams(), searchParams: makeSearch() }));
    expect(screen.getByText(/duplicate of an earlier entry/i)).toBeTruthy();
    expect(screen.getAllByTestId("decided-row")).toHaveLength(2);
    expect(screen.getAllByText("Self-approved")).toHaveLength(1);
  });
});
