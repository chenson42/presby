// @vitest-environment jsdom
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

const getEvent = vi.fn();
vi.mock("@/lib/events", () => ({
  getEvent: (...args: unknown[]) => getEvent(...args),
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

vi.mock("../../edit-event-form", () => ({
  EditEventForm: ({ event }: { event: { title: string } }) => (
    <div>EditEventForm for {event.title}</div>
  ),
}));

import EditEventPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getEvent.mockReset();
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

function makeParams(eventId = "event-1") {
  return Promise.resolve({ slug: "alder-creek", eventId });
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-1",
    title: "Session meeting",
    description: null,
    location: null,
    startsAt: "2027-03-01T19:00:00",
    endsAt: null,
    isPublic: true,
    allowsCheckin: false,
    cancelledAt: null,
    isRecurringSeries: false,
    isSeriesOccurrence: false,
    parentEventId: null,
    recurrencePattern: null,
    recurrenceCount: null,
    seriesOccurrences: [],
    ...overrides,
  };
}

describe("EditEventPage", () => {
  it("404s when getEvent() returns invalid_target", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({ kind: "invalid_target" });

    await expect(EditEventPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("404s when the event is already cancelled — the load-bearing guard, same as invalid_target", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({
      kind: "ok",
      data: baseEvent({ cancelledAt: "2027-02-01T00:00:00.000Z" }),
    });

    await expect(EditEventPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("renders EditEventForm for a live, non-cancelled event", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({ kind: "ok", data: baseEvent() });

    const el = await EditEventPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /edit event/i })).toBeTruthy();
    expect(screen.getByText("EditEventForm for Session meeting")).toBeTruthy();
  });

  it("renders EventsForbidden when getEvent() returns forbidden", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({ kind: "forbidden" });

    const el = await EditEventPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission to manage events/i)).toBeTruthy();
  });
});
