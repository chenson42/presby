// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/members/<id>/edit/sensitive`'s
 * page.tsx — same gate-composition contract as `edit/page.test.tsx`
 * (DECISION-097), plus the four-permission-collapse `forbidden`/`not_found`
 * split (DECISION-108).
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

const getSensitiveInfoForEdit = vi.fn();
vi.mock("@/lib/person-sensitive", () => ({
  getSensitiveInfoForEdit: (...args: unknown[]) => getSensitiveInfoForEdit(...args),
}));

vi.mock("./actions", () => ({
  addPersonNoteAction: vi.fn(),
  setPersonDemographicsAction: vi.fn(),
  setPersonMedicalAction: vi.fn(),
  setPersonDisabilitiesAction: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

import EditSensitiveInfoPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  isOrgFeatureEnabled.mockReset();
  getSensitiveInfoForEdit.mockReset();
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

function makeParams(slug = "alder-creek", id = "p-1") {
  return Promise.resolve({ slug, id });
}

const GRANTS_ALL_FALSE = {
  pastoralNotes: false,
  demographics: false,
  medical: false,
  disabilities: false,
};

describe("EditSensitiveInfoPage — gate composition (DECISION-097)", () => {
  it("flag off → renders flag-off, never looks up sensitive info", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await EditSensitiveInfoPage({ params: makeParams() });
    render(el);

    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
    expect(getSensitiveInfoForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("flag on but org toggle off → same flag-off copy (no axis leak)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(false);

    const el = await EditSensitiveInfoPage({ params: makeParams() });
    render(el);

    expect(getSensitiveInfoForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });
});

describe("EditSensitiveInfoPage — permission collapse (DECISION-108)", () => {
  it("forbidden (none of the four permissions) → shared MembersForbidden state, not a 404", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getSensitiveInfoForEdit.mockResolvedValue({ kind: "forbidden" });

    const el = await EditSensitiveInfoPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("not_found → calls next/navigation's notFound()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getSensitiveInfoForEdit.mockResolvedValue({ kind: "not_found" });

    await expect(
      EditSensitiveInfoPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getSensitiveInfoForEdit.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(
      EditSensitiveInfoPage({ params: makeParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getSensitiveInfoForEdit.mockRejectedValue(new Error("connection reset"));

    const el = await EditSensitiveInfoPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });

  it("ok with all four grants false renders no section (defensive; page trusts the forbidden/ok split, not per-section rendering)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getSensitiveInfoForEdit.mockResolvedValue({
      kind: "ok",
      data: {
        personId: "p-1",
        grants: GRANTS_ALL_FALSE,
        disabilityTrackingEnabled: false,
      },
    });

    const el = await EditSensitiveInfoPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: /sensitive information/i }),
    ).toBeTruthy();
  });

  it("ok with pastoralNotes granted renders the notes section", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getSensitiveInfoForEdit.mockResolvedValue({
      kind: "ok",
      data: {
        personId: "p-1",
        grants: { ...GRANTS_ALL_FALSE, pastoralNotes: true },
        notes: [],
        disabilityTrackingEnabled: false,
      },
    });

    const el = await EditSensitiveInfoPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: /pastoral care notes/i }),
    ).toBeTruthy();
  });
});
