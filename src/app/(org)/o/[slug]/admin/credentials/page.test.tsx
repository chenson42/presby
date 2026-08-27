// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/credentials`'s page.tsx —
 * presbytery-functionality Increment 2 Phase 3 design.
 *
 * Everything this page delegates to is already tested elsewhere —
 * `resolveOrgContext`/`assertOrgAccess` in authz's own suite,
 * `listOrdinations`/`listAppointments`/`getCredentialsFormOptions`'s SQL
 * correctness in `credentials.test.ts`, the three states' copy in
 * `credentials-states.test.tsx`, the tables in `ordination-list.test.tsx`/
 * `appointment-list.tsx`. What this file exists to pin — mirroring
 * `../officers/page.test.tsx`'s exact assertion style — is the ORDERING AND
 * ERROR-HANDLING CONTRACT:
 *
 *   1. `isFlagEnabled("org_portal.credentials")` is checked BEFORE
 *      `listOrdinations()` is ever called.
 *   2. `OrgAccessError` thrown by any of the three reads is RE-THROWN, not
 *      swallowed into the load-error state.
 *   3. Any OTHER thrown error renders the load-error state, not a crash.
 *   4. `{ kind: "forbidden" }` from `listOrdinations()` renders
 *      `CredentialsForbidden` WITHOUT ever calling `listAppointments()` or
 *      `getCredentialsFormOptions()`.
 *   5. The ok path renders both sections (ordinations, appointments) and
 *      both forms.
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

const listOrdinations = vi.fn();
const listAppointments = vi.fn();
const getCredentialsFormOptions = vi.fn();
// A plain, full mock — none of this page's rendered children import a
// RUNTIME value from `@/lib/credentials` (only types; display labels/option
// lists live in `credential-labels.ts`, see that file's header). Mirrors
// `../officers/page.test.tsx`'s identical full-mock shape.
vi.mock("@/lib/credentials", () => ({
  listOrdinations: (...args: unknown[]) => listOrdinations(...args),
  listAppointments: (...args: unknown[]) => listAppointments(...args),
  getCredentialsFormOptions: (...args: unknown[]) =>
    getCredentialsFormOptions(...args),
}));

vi.mock("./actions", () => ({
  recordOrdinationAction: vi.fn(),
  changeOrdinationStatusAction: vi.fn(),
  recordAppointmentAction: vi.fn(),
  endAppointmentAction: vi.fn(),
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

import CredentialsPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listOrdinations.mockReset();
  listAppointments.mockReset();
  getCredentialsFormOptions.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const OK_RESOLVED = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Presbytery of the Northern Reach",
    organizationType: "presbytery" as const,
    slug: "northern-reach",
    platformStatus: "managed" as const,
  },
};

const EMPTY_OPTIONS = {
  kind: "ok" as const,
  data: { people: [], servingOrgs: [] },
};

function makeParams(slug = "northern-reach") {
  return Promise.resolve({ slug });
}

describe("CredentialsPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listOrdinations()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await CredentialsPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.credentials");
    expect(listOrdinations).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t turned on for Presbytery of the Northern Reach/i),
    ).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag (the authoritative gate still runs)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await CredentialsPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("CredentialsPage — listOrdinations() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOrdinations.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(CredentialsPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOrdinations.mockRejectedValue(new Error("connection reset"));

    const el = await CredentialsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load credentials records right now/i),
    ).toBeTruthy();
  });
});

describe("CredentialsPage — result branches", () => {
  it("renders CredentialsForbidden when listOrdinations() returns forbidden, WITHOUT calling listAppointments() or getCredentialsFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOrdinations.mockResolvedValue({ kind: "forbidden" });

    const el = await CredentialsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage ministry credentials/i),
    ).toBeTruthy();
    expect(listAppointments).not.toHaveBeenCalled();
    expect(getCredentialsFormOptions).not.toHaveBeenCalled();
  });

  it("renders both sections and both forms when every read returns ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOrdinations.mockResolvedValue({
      kind: "ok",
      data: [
        {
          ordinationId: "ord-1",
          personId: "person-2",
          displayName: "Idris Calloway",
          ministry: "minister_of_word_and_sacrament",
          ordainedOn: "2015-06-01",
          status: "active",
          minuteReference: null,
          endedOn: null,
          endedReason: null,
        },
      ],
    });
    listAppointments.mockResolvedValue({
      kind: "ok",
      data: [
        {
          appointmentId: "appt-1",
          personId: "person-2",
          displayName: "Idris Calloway",
          servingOrgId: "cong-1",
          servingOrgName: "Alder Creek Presbyterian Church",
          callType: "installed_pastor",
          startsOn: "2020-01-01",
          endsOn: null,
          minuteReference: null,
        },
      ],
    });
    getCredentialsFormOptions.mockResolvedValue({
      kind: "ok",
      data: {
        people: [{ personId: "person-2", displayName: "Idris Calloway" }],
        servingOrgs: [
          {
            organizationId: "cong-1",
            name: "Alder Creek Presbyterian Church",
            platformStatus: "managed",
          },
        ],
      },
    });

    const el = await CredentialsPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^credentials$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /ordinations/i })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /pastoral appointments/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /record ordination/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /record appointment/i }),
    ).toBeTruthy();
    // Two distinct actions per Phase 3's named edge case — never one control.
    expect(
      screen.getByRole("button", { name: /change status/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /end ordination/i }),
    ).toBeTruthy();
  });

  it("renders both empty states when both lists are empty", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOrdinations.mockResolvedValue({ kind: "ok", data: [] });
    listAppointments.mockResolvedValue({ kind: "ok", data: [] });
    getCredentialsFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const el = await CredentialsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no ordinations recorded yet/i)).toBeTruthy();
    expect(screen.getByText(/no appointments recorded yet/i)).toBeTruthy();
    // The transferring-in-minister empty state (Phase 3's named edge case).
    expect(
      screen.getAllByText(/add them via members/i).length,
    ).toBeGreaterThan(0);
  });
});

describe("CredentialsPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/credentials when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(CredentialsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Fnorthern-reach%2Fadmin%2Fcredentials",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(CredentialsPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Some Other Presbytery",
      organizationType: "presbytery",
    });

    const el = await CredentialsPage({ params: makeParams("other-presbytery") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Some Other Presbytery/i),
    ).toBeTruthy();
    expect(listOrdinations).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbytery",
      endedOn: "2026-03-31",
    });

    const el = await CredentialsPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
