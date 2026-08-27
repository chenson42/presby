// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/giving`'s page.tsx — product-IA
 * scaffold, docs/work-log/2026-08-27-product-ia-scaffold.md (Phase 3 §3/§9,
 * DECISION-117). Mirrors `admin/credentials/page.test.tsx`'s assertion
 * style for the shared four-way miss response and the flag-gate ordering.
 * `giving` is a universal tile (no `orgTypeScope`), so there is no org-type
 * branch to test here (unlike `committees`/`oversight`/`reports`).
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

import GivingPage from "./page";

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

describe("GivingPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/giving when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(GivingPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(GivingPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Some Other Church",
      organizationType: "congregation",
    });

    const el = await GivingPage({ params: makeParams("other-church") });
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

    const el = await GivingPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});

describe("GivingPage — auth gate ordering", () => {
  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await GivingPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("GivingPage — flag states", () => {
  it("flag off renders PlaceholderFlagOff naming the org, checked with org_portal.giving", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await GivingPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.giving");
    expect(
      screen.getByText(/isn.t turned on for Alder Creek Presbyterian Church yet/i),
    ).toBeTruthy();
  });

  it("flag on renders ComingSoon with the area heading, a description, and the feedback link", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);

    const el = await GivingPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Giving & Finance" }),
    ).toBeTruthy();
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /want this sooner\? tell us\./i,
    });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/feedback");
  });
});
