// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/feedback`'s page.tsx — the baseline
 * on-ramp. What this pins:
 *
 *   1. NO `tickets.file` check — a current member with no special
 *      permission still reaches the form (this page never imports
 *      `hasTicketsFile`/`listTickets`/anything from `@/lib/tickets` at all
 *      beyond the shared org-access resolution).
 *   2. `org_portal.tickets` off renders "isn't turned on yet" copy, not the
 *      form.
 *   3. The shared four-way miss response (not-found/forbidden/ended/ok)
 *      behaves identically to every other `(org)` page.
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

vi.mock("./actions", () => ({
  submitCongregationFeedbackAction: vi.fn(),
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

import FeedbackPage from "./page";

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

function makeParams() {
  return Promise.resolve({ slug: "alder-creek" });
}

describe("FeedbackPage — no permission gate beyond active membership", () => {
  it("renders the form for any member who reaches assertOrgAccess, with the flag on", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);

    const el = await FeedbackPage({ params: makeParams() });
    render(el);

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
    expect(screen.getByLabelText(/what.s on your mind/i)).toBeTruthy();
  });
});

describe("FeedbackPage — flag off", () => {
  it("renders 'isn't turned on yet' copy, not the form", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await FeedbackPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
    expect(screen.queryByLabelText(/what.s on your mind/i)).toBeNull();
  });
});

describe("FeedbackPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to feedback when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(FeedbackPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Ffeedback",
    );
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(FeedbackPage({ params: makeParams() })).rejects.toThrow(
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

    const el = await FeedbackPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await FeedbackPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
