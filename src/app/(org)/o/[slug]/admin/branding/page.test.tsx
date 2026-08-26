// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/branding`'s page.tsx, mirroring
 * `admin/features/page.test.tsx`'s exact assertion style — see that file's
 * header for the ordering/error-handling contract this pins:
 *
 *   1. `isFlagEnabled("org_portal.branding")` is checked BEFORE
 *      `getOrgBrandForEdit()` is ever called.
 *   2. `OrgAccessError` from `getOrgBrandForEdit()` is RE-THROWN.
 *   3. Any OTHER thrown error renders the load-error state.
 *   4. `{ kind: "forbidden" }` renders `BrandingForbidden`.
 *   5. The ok path renders the form, pre-filled from the existing brand.
 *   6. The empty-state (no existing brand row) renders sensible defaults,
 *      not a broken form.
 *   7. `assertOrgAccess` runs before the flag check (the authoritative gate
 *      every `(org)` page calls).
 *   8. The shared four-way miss response (redirect / not-found) works the
 *      same as every other `(org)/admin/*` page.
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

const getOrgBrandForEdit = vi.fn();
vi.mock("@/lib/tenant-branding", () => ({
  getOrgBrandForEdit: (...args: unknown[]) => getOrgBrandForEdit(...args),
}));

const blobResolve = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve: (...args: unknown[]) => blobResolve(...args) }),
}));

vi.mock("./actions", () => ({
  setOrgBrandAction: vi.fn(),
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
  useRouter: () => ({ refresh: vi.fn() }),
}));

import BrandingPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getOrgBrandForEdit.mockReset();
  blobResolve.mockReset();
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

describe("BrandingPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getOrgBrandForEdit()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await BrandingPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.branding");
    expect(getOrgBrandForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await BrandingPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("BrandingPage — getOrgBrandForEdit() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOrgBrandForEdit.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(BrandingPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOrgBrandForEdit.mockRejectedValue(new Error("connection reset"));

    const el = await BrandingPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load brand settings right now/i),
    ).toBeTruthy();
  });
});

describe("BrandingPage — result branches", () => {
  it("renders BrandingForbidden when getOrgBrandForEdit() returns { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOrgBrandForEdit.mockResolvedValue({ kind: "forbidden" });

    const el = await BrandingPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage branding/i),
    ).toBeTruthy();
  });

  it("renders the form pre-filled from an existing brand row, and resolves the logo via the blob store", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOrgBrandForEdit.mockResolvedValue({
      kind: "ok",
      brand: {
        seedHex: "#7a1f2b",
        typePairing: "classic",
        markAssetKey: "mark-1",
        wordmarkAssetKey: null,
        brandTokenVersion: 1,
        lightOnly: true,
      },
    });
    blobResolve.mockResolvedValue({
      contentType: "image/png",
      bytes: Buffer.from("fake-bytes"),
    });

    const el = await BrandingPage({ params: makeParams() });
    render(el);

    expect(blobResolve).toHaveBeenCalledWith({
      organizationId: "org-1",
      key: "mark-1",
    });
    expect(screen.getByRole("heading", { name: /^branding$/i })).toBeTruthy();
    const hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;
    expect(hexInput.value).toBe("#7a1f2b");
    const lightOnlyCheckbox = screen.getByLabelText(
      "Light mode only",
    ) as HTMLInputElement;
    expect(lightOnlyCheckbox.checked).toBe(true);
  });

  it("renders the empty state (no existing brand row) with sensible defaults, not a broken form", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOrgBrandForEdit.mockResolvedValue({ kind: "ok", brand: null });

    const el = await BrandingPage({ params: makeParams() });
    render(el);

    expect(blobResolve).not.toHaveBeenCalled();
    const hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;
    // The platform accent default — a starting point, not a suggestion.
    expect(hexInput.value).toBe("#2563eb");
    const lightOnlyCheckbox = screen.getByLabelText(
      "Light mode only",
    ) as HTMLInputElement;
    expect(lightOnlyCheckbox.checked).toBe(false);
    const save = screen.getByRole("button", { name: /save brand/i });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("BrandingPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/branding when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(BrandingPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fbranding",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(BrandingPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
