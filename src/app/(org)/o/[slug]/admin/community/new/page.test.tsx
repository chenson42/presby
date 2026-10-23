// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/community/new`'s page.tsx — the
 * gate-composition contract: flag off OR org toggle off both render the
 * SAME flag-off copy (never leaking which axis is off), and
 * `getHouseholds()` forbidden degrades to an empty picker rather than
 * blocking the page (a named Increment-1 coupling, Phase 3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
const hasPermission = vi.fn();
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
    hasPermission: (...args: unknown[]) => hasPermission(...args),
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

const getHouseholds = vi.fn();
vi.mock("@/lib/directory", () => ({
  getHouseholds: (...args: unknown[]) => getHouseholds(...args),
}));

const getSessionApprovalState = vi.fn();
vi.mock("@/lib/roll", () => ({
  getSessionApprovalState: (...args: unknown[]) => getSessionApprovalState(...args),
}));

vi.mock("./actions", () => ({
  matchPersonAction: vi.fn(),
  createPersonAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewMemberPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  hasPermission.mockReset().mockResolvedValue(true);
  isFlagEnabled.mockReset();
  isOrgFeatureEnabled.mockReset();
  getHouseholds.mockReset();
  getSessionApprovalState
    .mockReset()
    .mockResolvedValue({ kind: "ok", state: { kind: "ready" } });
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

describe("NewMemberPage — gate composition (DECISION-097)", () => {
  it("flag off → renders flag-off, never checks the org toggle or households", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await NewMemberPage({ params: makeParams() });
    render(el);

    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
    expect(getHouseholds).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("flag on but org toggle off → renders the SAME flag-off copy (no axis leak)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(false);

    const el = await NewMemberPage({ params: makeParams() });
    render(el);

    expect(getHouseholds).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("both on → renders the wizard", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await NewMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /add a person/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^search$/i })).toBeTruthy();
  });
});

describe("NewMemberPage — the roll-bearing choices follow roll.propose (DECISION-197)", () => {
  async function renderWith(canPropose: boolean) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) =>
        key === "roll.propose" ? canPropose : true,
    );
    render(await NewMemberPage({ params: makeParams() }));
    // Walk the wizard far enough to see the Connection select would need the
    // full flow; the page's own contract is the permission it computed.
    return hasPermission.mock.calls.map((c) => c[2]);
  }

  it("asks for roll.propose, and nothing wider, for the wizard", async () => {
    const asked = await renderWith(true);
    expect(asked).toContain("roll.propose");
    expect(asked).not.toContain("roll.approve");
  });

  it("still renders the wizard for a people.manage holder without roll.propose", async () => {
    await renderWith(false);
    expect(screen.getByRole("heading", { name: /add a person/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^search$/i })).toBeTruthy();
  });
});

describe("NewMemberPage — the Session decides whether Member is offered (R15, F185)", () => {
  function setup(canPropose: boolean) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) =>
        key === "roll.propose" ? canPropose : true,
    );
  }

  it("reads the Session state only for a roll.propose holder", async () => {
    setup(false);
    render(await NewMemberPage({ params: makeParams() }));
    expect(getSessionApprovalState).not.toHaveBeenCalled();
    cleanup();
    setup(true);
    render(await NewMemberPage({ params: makeParams() }));
    expect(getSessionApprovalState).toHaveBeenCalledWith("person-1", "org-1");
  });

  it("a failed read still renders the wizard (the server refuses no_session regardless)", async () => {
    setup(true);
    getSessionApprovalState.mockRejectedValue(new Error("boom"));
    render(await NewMemberPage({ params: makeParams() }));
    expect(screen.getByRole("heading", { name: /add a person/i })).toBeTruthy();
  });
});

describe("NewMemberPage — getHouseholds() degrades gracefully", () => {
  it("forbidden → renders the wizard anyway with an empty household list (named Increment-1 coupling)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getHouseholds.mockResolvedValue({ kind: "forbidden" });

    const el = await NewMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /add a person/i })).toBeTruthy();
  });

  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getHouseholds.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(NewMemberPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getHouseholds.mockRejectedValue(new Error("connection reset"));

    const el = await NewMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });
});
