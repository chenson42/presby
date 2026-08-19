// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory`'s page.tsx.
 *
 * Everything this page delegates to is already tested elsewhere —
 * `resolveOrgContext`/`assertOrgAccess` in authz's own suite,
 * `getDirectory()`'s privacy filtering in directory.test.ts, the four
 * states' copy in directory-states.test.tsx / directory-list.test.tsx. What
 * is NOT tested anywhere else, and what this file exists to pin, is the
 * ORDERING AND ERROR-HANDLING CONTRACT the Phase 3 design and this
 * pipeline's brief both call mandatory:
 *
 *   1. `isFlagEnabled("org_portal.directory")` is checked BEFORE
 *      `getDirectory()` is ever called — a congregation with the feature
 *      off must never pay for (or be exposed to) a permission-resolver
 *      round trip.
 *   2. `OrgAccessError` thrown by `getDirectory()` is RE-THROWN, not
 *      swallowed into the load-error state — `[slug]/error.tsx` owns that
 *      copy.
 *   3. Any OTHER thrown error renders the load-error state, not a crash.
 *   4. `{ kind: "forbidden" }` and `{ kind: "ok", entries }` render the
 *      correct branch.
 *
 * Every collaborator is mocked; this file makes no DB connection. The mock
 * `@/lib/authz` module supplies a REAL (mock-module-scoped) `OrgAccessError`
 * class rather than a bare Error, because the page's `instanceof` check is
 * exactly what's under test — a stub with the same name would pass a
 * message-matching assertion but not this one.
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

const getDirectory = vi.fn();
vi.mock("@/lib/directory", () => ({
  getDirectory: (...args: unknown[]) => getDirectory(...args),
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
}));

import DirectoryPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getDirectory.mockReset();
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

describe("DirectoryPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getDirectory()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await DirectoryPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.directory");
    expect(getDirectory).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t available for Alder Creek/i),
    ).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag (the authoritative gate still runs)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await DirectoryPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("DirectoryPage — getDirectory() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getDirectory.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(DirectoryPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getDirectory.mockRejectedValue(new Error("connection reset"));

    const el = await DirectoryPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load the directory right now/i),
    ).toBeTruthy();
    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/directory");
  });
});

describe("DirectoryPage — result branches", () => {
  it("renders the forbidden state when getDirectory() returns { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "forbidden" });

    const el = await DirectoryPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
  });

  it("renders the entry list when getDirectory() returns ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({
      kind: "ok",
      entries: [
        {
          personId: "c1",
          firstName: "Marguerite",
          lastName: "Ashcombe",
          preferredName: null,
          email: null,
          phone: null,
          address: null,
          dateOfBirth: null,
          photoKey: null,
        },
      ],
    });

    const el = await DirectoryPage({ params: makeParams() });
    render(el);

    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();
  });

  it("renders zero visible members honestly when getDirectory() returns ok with no entries", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    const el = await DirectoryPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/no one is listed in the directory yet/i),
    ).toBeTruthy();
  });
});

describe("DirectoryPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to the directory when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(DirectoryPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fdirectory",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(DirectoryPage({ params: makeParams() })).rejects.toThrow(
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

    const el = await DirectoryPage({ params: makeParams("bramblewood") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    // The whole-portal denial, never the directory's own single-feature copy.
    expect(getDirectory).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await DirectoryPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
