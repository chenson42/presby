// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/members/<id>/edit/guardians`'s
 * page.tsx — same gate-composition contract as `edit/sensitive/page.test.tsx`,
 * but checked bare (no org toggle) and gated on a single permission
 * (`children.roster`, collapsed inside `getGuardianLinksForEdit()`).
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

const getGuardianLinksForEdit = vi.fn();
vi.mock("@/lib/children", () => ({
  getGuardianLinksForEdit: (...args: unknown[]) => getGuardianLinksForEdit(...args),
}));

vi.mock("./actions", () => ({
  addGuardianLinkAction: vi.fn(),
  updateGuardianLinkAction: vi.fn(),
  removeGuardianLinkAction: vi.fn(),
  searchLinkablePeopleAction: vi.fn(),
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

import EditGuardiansPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getGuardianLinksForEdit.mockReset();
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

describe("EditGuardiansPage — gate composition (bare flag, no org toggle)", () => {
  it("flag off → renders flag-off, never looks up guardian links", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await EditGuardiansPage({ params: makeParams() });
    render(el);

    expect(getGuardianLinksForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });
});

describe("EditGuardiansPage — children.roster permission collapse", () => {
  it("forbidden → shared MembersForbidden state, not a 404", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGuardianLinksForEdit.mockResolvedValue({ kind: "forbidden" });

    const el = await EditGuardiansPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("not_found → calls next/navigation's notFound()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGuardianLinksForEdit.mockResolvedValue({ kind: "not_found" });

    await expect(EditGuardiansPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGuardianLinksForEdit.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(EditGuardiansPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGuardianLinksForEdit.mockRejectedValue(new Error("connection reset"));

    const el = await EditGuardiansPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });

  it("ok with an empty link list renders the form's own empty state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGuardianLinksForEdit.mockResolvedValue({
      kind: "ok",
      personId: "p-1",
      links: [],
    });

    const el = await EditGuardiansPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^guardians$/i })).toBeTruthy();
    expect(screen.getByText(/no guardians on file/i)).toBeTruthy();
  });

  it("ok with links renders each row", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGuardianLinksForEdit.mockResolvedValue({
      kind: "ok",
      personId: "p-1",
      links: [
        {
          id: "link-1",
          relatedPersonId: "adult-1",
          relatedName: null,
          relatedPersonName: "Tobias Renwick",
          relationship: "parent",
          isEmergencyContact: true,
          notes: null,
        },
      ],
    });

    const el = await EditGuardiansPage({ params: makeParams() });
    render(el);

    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
  });
});
