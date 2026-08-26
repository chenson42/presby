// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/officers`'s page.tsx — groups-and-
 * officers Phase 3, commit 3/3.
 *
 * Everything this page delegates to is already tested elsewhere —
 * `resolveOrgContext`/`assertOrgAccess` in authz's own suite, `listOfficerRoster`/
 * `getOfficerFormOptions`'s SQL correctness in `officers.test.ts`, the three
 * states' copy in `officers-states.test.tsx`, the table in
 * `officer-roster.test.tsx`, the form in `add-officer-term-form.test.tsx`.
 * What is NOT tested anywhere else, and what this file exists to pin —
 * mirroring `admin/roles/page.test.tsx`'s exact assertion style — is the
 * ORDERING AND ERROR-HANDLING CONTRACT Phase 3's design and this pipeline's
 * brief both call mandatory:
 *
 *   1. `isFlagEnabled("org_portal.officers")` is checked BEFORE
 *      `listOfficerRoster()` is ever called.
 *   2. `OrgAccessError` thrown by `listOfficerRoster()`/
 *      `getOfficerFormOptions()` is RE-THROWN, not swallowed into the
 *      load-error state.
 *   3. Any OTHER thrown error renders the load-error state, not a crash.
 *   4. `{ kind: "forbidden" }` from `listOfficerRoster()` renders
 *      `OfficersForbidden` WITHOUT ever calling `getOfficerFormOptions()`.
 *   5. The ok path renders the roster table and the add-term form.
 *   6. The copy naming the two unlinked systems (recording the office vs.
 *      granting software access) renders next to the form.
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

const listOfficerRoster = vi.fn();
const getOfficerFormOptions = vi.fn();
// A plain, full mock — none of this page's rendered children
// (`OfficerRoster`, `AddOfficerTermForm`, `EndTermDialog`) import a RUNTIME
// value from `@/lib/officers` (only types; display labels live in
// `office-labels.ts`, see that file's header), so there is no real export
// to preserve via `importActual` here. Mirrors `admin/roles/page.test.tsx`'s
// identical full-mock shape for `@/lib/role-grants`.
vi.mock("@/lib/officers", () => ({
  listOfficerRoster: (...args: unknown[]) => listOfficerRoster(...args),
  getOfficerFormOptions: (...args: unknown[]) => getOfficerFormOptions(...args),
}));

vi.mock("./actions", () => ({
  startOfficerTermAction: vi.fn(),
  endOfficerTermAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
  useRouter: () => ({ refresh: vi.fn() }),
}));

import OfficersPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listOfficerRoster.mockReset();
  getOfficerFormOptions.mockReset();
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

const EMPTY_OPTIONS = {
  kind: "ok" as const,
  data: { people: [], orgUnits: [] },
};

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

describe("OfficersPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listOfficerRoster()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await OfficersPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.officers");
    expect(listOfficerRoster).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag (the authoritative gate still runs)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await OfficersPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("OfficersPage — listOfficerRoster() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOfficerRoster.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(OfficersPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOfficerRoster.mockRejectedValue(new Error("connection reset"));

    const el = await OfficersPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load officer records right now/i),
    ).toBeTruthy();
  });
});

describe("OfficersPage — getOfficerFormOptions() error handling", () => {
  it("re-throws OrgAccessError from getOfficerFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOfficerRoster.mockResolvedValue({ kind: "ok", data: [] });
    getOfficerFormOptions.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(OfficersPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error from getOfficerFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOfficerRoster.mockResolvedValue({ kind: "ok", data: [] });
    getOfficerFormOptions.mockRejectedValue(new Error("connection reset"));

    const el = await OfficersPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load officer records right now/i),
    ).toBeTruthy();
  });
});

describe("OfficersPage — result branches", () => {
  it("renders OfficersForbidden when listOfficerRoster() returns { kind: 'forbidden' }, WITHOUT calling getOfficerFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOfficerRoster.mockResolvedValue({ kind: "forbidden" });

    const el = await OfficersPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage officer terms/i),
    ).toBeTruthy();
    expect(getOfficerFormOptions).not.toHaveBeenCalled();
  });

  it("renders the roster table and the add-term form, plus the two-systems copy, when both calls return ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOfficerRoster.mockResolvedValue({
      kind: "ok",
      data: [
        {
          termId: "term-1",
          personId: "person-2",
          displayName: "Tobias Renwick",
          office: "clerk_of_session",
          classYear: null,
          startsOn: "2023-01-08",
          endsOn: null,
          orgUnitId: null,
          orgUnitName: null,
        },
      ],
    });
    getOfficerFormOptions.mockResolvedValue({
      kind: "ok",
      data: {
        people: [{ personId: "person-2", displayName: "Tobias Renwick" }],
        orgUnits: [],
      },
    });

    const el = await OfficersPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^officers$/i })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /add officer term/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/granting software access.*is done separately/i),
    ).toBeTruthy();
  });

  it("renders the empty-roster state when listOfficerRoster() returns ok with zero entries", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOfficerRoster.mockResolvedValue({ kind: "ok", data: [] });
    getOfficerFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const el = await OfficersPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no officers recorded yet/i)).toBeTruthy();
    expect(
      screen.getByText(/nobody has a current membership/i),
    ).toBeTruthy();
  });
});

describe("OfficersPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/officers when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(OfficersPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fofficers",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(OfficersPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await OfficersPage({ params: makeParams("bramblewood") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(listOfficerRoster).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await OfficersPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
