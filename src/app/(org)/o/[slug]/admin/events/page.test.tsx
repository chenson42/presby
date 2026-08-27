// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/events`'s page.tsx — docs/
 * work-log/2026-08-26-events-model.md, Phase 4 commit 2. Mirrors `groups/
 * page.test.tsx`'s exact assertion style: the ordering and error-handling
 * contract, not the SQL correctness already proven in `events.test.ts`.
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

const listEvents = vi.fn();
vi.mock("@/lib/events", () => ({
  listEvents: (...args: unknown[]) => listEvents(...args),
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

import EventsPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listEvents.mockReset();
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

describe("EventsPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listEvents()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await EventsPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.events");
    expect(listEvents).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await EventsPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("EventsPage — listEvents() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listEvents.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(EventsPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listEvents.mockRejectedValue(new Error("connection reset"));

    const el = await EventsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load event records right now/i)).toBeTruthy();
  });
});

describe("EventsPage — result branches", () => {
  it("renders EventsForbidden when listEvents() returns { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listEvents.mockResolvedValue({ kind: "forbidden" });

    const el = await EventsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission to manage events/i)).toBeTruthy();
  });

  it("renders the list and a 'New event' link when ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listEvents.mockResolvedValue({
      kind: "ok",
      data: [
        {
          eventId: "event-1",
          title: "Session meeting",
          startsAt: "2027-03-01T19:00:00",
          endsAt: null,
          isPublic: true,
          allowsCheckin: false,
          cancelledAt: null,
          isRecurringSeries: false,
          isSeriesOccurrence: false,
        },
      ],
    });

    const el = await EventsPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^events$/i })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Session meeting")).toBeTruthy();
    const newEventLink = screen.getByRole("link", { name: /new event/i });
    expect(newEventLink.getAttribute("href")).toBe("/o/alder-creek/admin/events/new");
  });

  it("renders the empty state when listEvents() returns ok with zero entries", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listEvents.mockResolvedValue({ kind: "ok", data: [] });

    const el = await EventsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no events yet/i)).toBeTruthy();
  });
});

describe("EventsPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/events when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(EventsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fevents",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(EventsPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await EventsPage({ params: makeParams("bramblewood") });
    render(el);

    expect(screen.getByText(/you don.t have access to Bramblewood/i)).toBeTruthy();
    expect(listEvents).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await EventsPage({ params: makeParams("fernwood") });
    render(el);

    expect(screen.getByText(/your access to Fernwood.*has ended/i)).toBeTruthy();
  });
});
