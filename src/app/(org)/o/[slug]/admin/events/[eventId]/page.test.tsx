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

vi.mock("../extend-series-form", () => ({
  ExtendSeriesForm: () => <div>ExtendSeriesForm</div>,
}));
vi.mock("../cancel-event-dialog", () => ({
  CancelEventDialog: () => <div>CancelEventDialog</div>,
}));

import EventDetailPage from "./page";

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

describe("EventDetailPage — result branches", () => {
  it("404s (via notFound()) when getEvent() returns invalid_target", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({ kind: "invalid_target" });

    await expect(EventDetailPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("renders the event's own title/time and an Edit link plus Cancel dialog when not cancelled", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({ kind: "ok", data: baseEvent() });

    const el = await EventDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /session meeting/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /edit event/i })).toBeTruthy();
    expect(screen.getByText("CancelEventDialog")).toBeTruthy();
  });

  it("renders NO Edit link and NO Cancel dialog for a cancelled event", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({
      kind: "ok",
      data: baseEvent({ cancelledAt: "2027-02-01T00:00:00.000Z" }),
    });

    const el = await EventDetailPage({ params: makeParams() });
    render(el);

    expect(screen.queryByRole("link", { name: /edit event/i })).toBeNull();
    expect(screen.queryByText("CancelEventDialog")).toBeNull();
  });

  it("renders ExtendSeriesForm ONLY for a series parent, never a standalone event or a child occurrence", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);

    getEvent.mockResolvedValue({ kind: "ok", data: baseEvent() });
    let el = await EventDetailPage({ params: makeParams() });
    render(el);
    expect(screen.queryByText("ExtendSeriesForm")).toBeNull();
    cleanup();

    getEvent.mockResolvedValue({
      kind: "ok",
      data: baseEvent({
        isRecurringSeries: true,
        recurrencePattern: "weekly",
        recurrenceCount: 4,
      }),
    });
    el = await EventDetailPage({ params: makeParams() });
    render(el);
    expect(screen.getByText("ExtendSeriesForm")).toBeTruthy();
    cleanup();

    getEvent.mockResolvedValue({
      kind: "ok",
      data: baseEvent({ isSeriesOccurrence: true, parentEventId: "parent-1" }),
    });
    el = await EventDetailPage({ params: makeParams() });
    render(el);
    expect(screen.queryByText("ExtendSeriesForm")).toBeNull();
  });

  it("renders the series-siblings table for a series occurrence", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getEvent.mockResolvedValue({
      kind: "ok",
      data: baseEvent({
        isSeriesOccurrence: true,
        parentEventId: "parent-1",
        seriesOccurrences: [
          { eventId: "parent-1", startsAt: "2027-03-01T19:00:00", cancelledAt: null },
        ],
      }),
    });

    const el = await EventDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /part of a series/i })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});
