// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/insights`'s page.tsx — product-IA
 * scaffold, docs/work-log/2026-08-27-product-ia-scaffold.md (Phase 3 §3/§9,
 * DECISION-117). Mirrors `admin/giving/page.test.tsx`'s assertion style.
 * `insights` is a universal tile (no `orgTypeScope`) — deliberately, unlike
 * its `domain`-sibling `reports`, which IS presbytery-scoped (Phase 3 §1).
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

import InsightsPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
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

describe("InsightsPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/insights when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(InsightsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Finsights",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(InsightsPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Some Other Church",
      organizationType: "congregation",
    });

    const el = await InsightsPage({ params: makeParams("other-church") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Some Other Church/i),
    ).toBeTruthy();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await InsightsPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});

describe("InsightsPage — auth gate ordering", () => {
  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await InsightsPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("InsightsPage — flag states", () => {
  it("flag off renders PlaceholderFlagOff naming the org, checked with org_portal.insights", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await InsightsPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.insights");
    expect(
      screen.getByText(/isn.t turned on for Alder Creek Presbyterian Church yet/i),
    ).toBeTruthy();
  });

  it("flag on renders ComingSoon with the area heading, a description, and the feedback link — works for a congregation too (universal tile)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);

    const el = await InsightsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Insights & Analytics" }),
    ).toBeTruthy();
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /want this sooner\? tell us\./i,
    });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/feedback");
  });
});
