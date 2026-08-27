// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/oversight`'s page.tsx —
 * Presbytery program Increment 3 (`docs/work-log/
 * 2026-08-27-presbytery-program.md`, DECISION-118 through 121). Replaces
 * the product-IA scaffold's `ComingSoon` assertions with the real list.
 * Same flag-then-org-type ordering contract the stub already established
 * (`docs/work-log/2026-08-27-product-ia-scaffold.md`) — this file keeps
 * those tests and adds the read-path/forbidden/load-error contract
 * `../credentials/page.test.tsx` documents for its own list read.
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

const getCongregationOversightList = vi.fn();
vi.mock("@/lib/presbytery", () => ({
  getCongregationOversightList: (...args: unknown[]) =>
    getCongregationOversightList(...args),
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

import OversightPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getCongregationOversightList.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const OK_RESOLVED_PRESBYTERY = {
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

const OK_RESOLVED_CONGREGATION = {
  kind: "ok" as const,
  org: {
    organizationId: "org-2",
    personId: "person-2",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

function makeParams(slug = "northern-reach") {
  return Promise.resolve({ slug });
}

describe("OversightPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/oversight when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(OversightPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Fnorthern-reach%2Fadmin%2Foversight",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(OversightPage({ params: makeParams() })).rejects.toThrow(
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

    const el = await OversightPage({ params: makeParams("other-presbytery") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Some Other Presbytery/i),
    ).toBeTruthy();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbytery",
      endedOn: "2026-03-31",
    });

    const el = await OversightPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});

describe("OversightPage — the flag-before-org-type ordering contract", () => {
  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);

    await OversightPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });

  it("flag off renders PlaceholderFlagOff, checked with org_portal.oversight, WITHOUT calling getCongregationOversightList()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);

    const el = await OversightPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.oversight");
    expect(getCongregationOversightList).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /isn.t turned on for Presbytery of the Northern Reach yet/i,
      ),
    ).toBeTruthy();
  });

  it("flag off wins over org type — a congregation with the flag off still sees PlaceholderFlagOff, not PlaceholderNotAvailable", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_CONGREGATION);
    isFlagEnabled.mockResolvedValue(false);

    const el = await OversightPage({ params: makeParams("alder-creek") });
    render(el);

    expect(
      screen.getByText(/isn.t turned on for Alder Creek Presbyterian Church yet/i),
    ).toBeTruthy();
  });

  it("flag on + wrong org type (congregation) renders PlaceholderNotAvailable, WITHOUT calling getCongregationOversightList()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_CONGREGATION);
    isFlagEnabled.mockResolvedValue(true);

    const el = await OversightPage({ params: makeParams("alder-creek") });
    render(el);

    expect(getCongregationOversightList).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t available for Alder Creek Presbyterian Church/i),
    ).toBeTruthy();
    expect(screen.queryByText(/don.t have permission/i)).toBeNull();
  });
});

describe("OversightPage — getCongregationOversightList() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightList.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(OversightPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightList.mockRejectedValue(new Error("connection reset"));

    const el = await OversightPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load oversight records right now/i),
    ).toBeTruthy();
  });
});

describe("OversightPage — result branches", () => {
  it("renders OversightForbidden when the read returns forbidden", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightList.mockResolvedValue({ kind: "forbidden" });

    const el = await OversightPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage congregation oversight/i),
    ).toBeTruthy();
  });

  it("renders the empty state when there are no member congregations", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightList.mockResolvedValue({ kind: "ok", data: [] });

    const el = await OversightPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Congregation Oversight" }),
    ).toBeTruthy();
    expect(screen.getByText(/no member congregations on record/i)).toBeTruthy();
  });

  it("renders the list, distinguishing an assessed congregation from one with no data on file", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightList.mockResolvedValue({
      kind: "ok",
      data: [
        {
          organizationId: "cong-1",
          name: "Alder Creek Presbyterian Church",
          platformStatus: "managed",
          hasData: true,
          viabilityScore: 3,
          redevelopmentNotes: null,
          buildingsNotes: null,
          insuranceCarrier: "Fieldstone Mutual",
          insuranceExpiresOn: "2027-03-01",
          latitude: "41.2033",
          longitude: "-77.1945",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          organizationId: "cong-2",
          name: "Quillhaven Presbyterian Church",
          platformStatus: "unmanaged",
          hasData: false,
          viabilityScore: null,
          redevelopmentNotes: null,
          buildingsNotes: null,
          insuranceCarrier: null,
          insuranceExpiresOn: null,
          latitude: null,
          longitude: null,
          updatedAt: null,
        },
      ],
    });

    const el = await OversightPage({ params: makeParams() });
    render(el);

    expect(screen.getByText("Alder Creek Presbyterian Church")).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("Quillhaven Presbyterian Church")).toBeTruthy();
    expect(screen.getByText("Not yet assessed")).toBeTruthy();
    expect(screen.getByRole("link", { name: /view \/ edit/i }).getAttribute("href")).toBe(
      "/o/northern-reach/admin/oversight/cong-1",
    );
    expect(screen.getByRole("link", { name: /^assess$/i }).getAttribute("href")).toBe(
      "/o/northern-reach/admin/oversight/cong-2",
    );
  });
});
