// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/oversight`'s page.tsx —
 * product-IA scaffold, docs/work-log/2026-08-27-product-ia-scaffold.md
 * (Phase 3 §3/§9, DECISION-117). Mirrors `admin/committees/page.test.tsx`'s
 * flag-before-org-type ordering contract. `oversight` is a presbytery-scoped
 * placeholder tile.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
  assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
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

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
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

  it("flag off renders PlaceholderFlagOff, checked with org_portal.oversight", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);

    const el = await OversightPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.oversight");
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

  it("flag on + wrong org type (congregation) renders PlaceholderNotAvailable, with no permission-shaped copy", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_CONGREGATION);
    isFlagEnabled.mockResolvedValue(true);

    const el = await OversightPage({ params: makeParams("alder-creek") });
    render(el);

    expect(
      screen.getByText(/isn.t available for Alder Creek Presbyterian Church/i),
    ).toBeTruthy();
    expect(screen.queryByText(/don.t have permission/i)).toBeNull();
  });

  it("flag on + correct org type (presbytery) renders ComingSoon", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);

    const el = await OversightPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Congregation Oversight" }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/isn.t available for/i),
    ).toBeNull();
    const link = screen.getByRole("link", {
      name: /want this sooner\? tell us\./i,
    });
    expect(link.getAttribute("href")).toBe("/o/northern-reach/feedback");
  });
});
