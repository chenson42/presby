// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/features`'s page.tsx, mirroring
 * `admin/roles/page.test.tsx`'s exact assertion style — see that file's
 * header for the ordering/error-handling contract this pins:
 *
 *   1. `isFlagEnabled("org_portal.features")` is checked BEFORE
 *      `listFeatureToggles()` is ever called.
 *   2. `OrgAccessError` from `listFeatureToggles()` is RE-THROWN.
 *   3. Any OTHER thrown error renders the load-error state.
 *   4. `{ kind: "forbidden" }` renders `FeaturesForbidden`.
 *   5. The ok path renders the toggle list.
 *   6. NO CIRCULAR GATE: this page's own source never imports/references
 *      `isOrgFeatureEnabled` — its reachability rides on the flag + the
 *      `org_features.manage` permission alone, never on the very toggle
 *      table it exists to administer (Phase 3's explicit ruling).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const listFeatureToggles = vi.fn();
vi.mock("@/lib/org-features", () => ({
  listFeatureToggles: (...args: unknown[]) => listFeatureToggles(...args),
}));

vi.mock("./actions", () => ({
  toggleFeatureAction: vi.fn(),
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

import FeaturesPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listFeatureToggles.mockReset();
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

describe("FeaturesPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listFeatureToggles()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await FeaturesPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.features");
    expect(listFeatureToggles).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await FeaturesPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("FeaturesPage — listFeatureToggles() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listFeatureToggles.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(FeaturesPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listFeatureToggles.mockRejectedValue(new Error("connection reset"));

    const el = await FeaturesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load feature settings right now/i),
    ).toBeTruthy();
  });
});

describe("FeaturesPage — result branches", () => {
  it("renders FeaturesForbidden when listFeatureToggles() returns { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listFeatureToggles.mockResolvedValue({ kind: "forbidden" });

    const el = await FeaturesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage features/i),
    ).toBeTruthy();
  });

  it("renders the toggle list when listFeatureToggles() returns ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listFeatureToggles.mockResolvedValue({
      kind: "ok",
      toggles: [
        {
          key: "org_portal.members_create",
          name: "Add & approve members",
          description: "Lets this congregation's admins create people.",
          enabled: false,
          updatedAt: null,
          updatedByEmail: null,
        },
      ],
    });

    const el = await FeaturesPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^features$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /add & approve members/i })).toBeTruthy();
  });

  it("renders the empty state when listFeatureToggles() returns ok with zero toggles", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listFeatureToggles.mockResolvedValue({ kind: "ok", toggles: [] });

    const el = await FeaturesPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no optional features yet/i)).toBeTruthy();
  });
});

describe("FeaturesPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/features when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(FeaturesPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Ffeatures",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(FeaturesPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});

describe("FeaturesPage — no circular gate (Phase 3)", () => {
  it("the page's own source never imports or calls isOrgFeatureEnabled (the header's own explanatory prose mentioning the name by way of contrast is fine)", () => {
    const source = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");
    expect(source).not.toMatch(/import\s*\{[^}]*isOrgFeatureEnabled/);
    expect(source).not.toMatch(/isOrgFeatureEnabled\(/);
  });
});
