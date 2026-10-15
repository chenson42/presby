// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/calendar/<eventId>`: the gate order, the
 * single `notFound()` for every "no such event for you", the validated `from`,
 * and the absence of any admin-only field.
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

const getMemberEvent = vi.fn();
vi.mock("@/lib/calendar", () => ({
  getMemberEvent: (...args: unknown[]) => getMemberEvent(...args),
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

import CalendarEventPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getMemberEvent.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    title: "Sunday worship",
    description: "Come as you are.\nCoffee after.",
    location: "Sanctuary",
    startsAtWallClock: "2026-10-04T10:00",
    endsAtWallClock: "2026-10-04T11:30",
    eventType: { id: "t1", name: "Worship", colorToken: "teal", iconKey: "Church" },
    isSeriesOccurrence: false,
    ...overrides,
  };
}

function signedIn() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
}

async function renderPage(from?: string | string[], eventId = EVENT_ID) {
  const el = await CalendarEventPage({
    params: Promise.resolve({ slug: "alder-creek", eventId }),
    searchParams: Promise.resolve({ from }),
  });
  return render(el);
}

describe("CalendarEventPage — gates", () => {
  it("redirects a signed-out visitor to /signin with a callback to this event", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(`/o/alder-creek/calendar/${EVENT_ID}`)}`,
    );
    expect(getMemberEvent).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
  });

  it("renders the disabled and forbidden copy, without a lookup result leaking", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "disabled" });
    const { unmount } = await renderPage();
    expect(screen.getByText(/isn't turned on for Alder Creek/)).toBeTruthy();
    unmount();

    getMemberEvent.mockResolvedValue({ kind: "forbidden" });
    await renderPage();
    expect(screen.getByText(/isn't available to your account/)).toBeTruthy();
  });

  it("answers notFound() for event: null (missing, other org, cancelled and non-UUID alike)", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: null, canManage: false } });
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    await expect(renderPage(undefined, "not-a-uuid")).rejects.toThrow("NOT_FOUND");
    expect(getMemberEvent).toHaveBeenLastCalledWith("person-1", "org-1", "not-a-uuid");
  });

  it("re-throws OrgAccessError and renders a retry for any other failure", async () => {
    signedIn();
    getMemberEvent.mockRejectedValue(new OrgAccessError("person-1", "org-1"));
    await expect(renderPage()).rejects.toThrow("mock: no active membership");

    getMemberEvent.mockRejectedValue(new Error("connection reset"));
    await renderPage();
    expect(screen.getByText(/couldn.t load the calendar right now/i)).toBeTruthy();
  });
});

describe("CalendarEventPage — the event", () => {
  it("shows the title, the type chip, when, where and the description", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Sunday worship" })).toBeTruthy();
    expect(screen.getByText("Worship")).toBeTruthy();
    expect(screen.getByText("Sunday, October 4, 2026, 10:00 AM – 11:30 AM")).toBeTruthy();
    expect(screen.getByText("Sanctuary")).toBeTruthy();
    const description = screen.getByText(/Come as you are/);
    expect(description.className).toContain("whitespace-pre-line");
    expect(description.className).toContain("text-base");
  });

  it("shows an event ending on another day as two lines", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({
      kind: "ok",
      data: { event: detail({ endsAtWallClock: "2026-10-05T09:00" }), canManage: false },
    });
    await renderPage();
    expect(screen.getByText("Sunday, October 4, 2026, 10:00 AM")).toBeTruthy();
    expect(screen.getByText("Ends Monday, October 5, 2026, 9:00 AM")).toBeTruthy();
  });

  it("omits the chip, location, description and series note when absent, and shows the series note when present", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({
      kind: "ok",
      data: {
        event: detail({ eventType: null, location: null, description: null, endsAtWallClock: null }),
        canManage: false,
      },
    });
    const { unmount } = await renderPage();
    expect(screen.queryByText("Worship")).toBeNull();
    expect(screen.queryByText(/repeating series/)).toBeNull();
    unmount();

    getMemberEvent.mockResolvedValue({
      kind: "ok",
      data: { event: detail({ isSeriesOccurrence: true }), canManage: false },
    });
    await renderPage();
    expect(screen.getByText("Part of a repeating series")).toBeTruthy();
  });

  it("renders no admin-only field", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    const { container } = await renderPage();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/members only|public|check-in|created by|repeats|occurrences total/i);
  });

  it("never uses text-xs", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: true } });
    isFlagEnabled.mockResolvedValue(true);
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain("text-xs");
  });
});

describe("CalendarEventPage — back link", () => {
  it("defaults to the calendar", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    await renderPage();
    const back = screen.getByRole("link", { name: /back to calendar/i });
    expect(back.getAttribute("href")).toBe("/o/alder-creek/calendar");
  });

  it("returns to the same month and filter from a validated from=", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    await renderPage("/o/alder-creek/calendar?month=2026-11&view=list");
    expect(screen.getByRole("link", { name: /back to calendar/i }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar?month=2026-11&view=list",
    );
  });

  it("reads 'Back to home' for ?from=/o/<slug>", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    await renderPage("/o/alder-creek");
    const back = screen.getByRole("link", { name: /back to home/i });
    expect(back.getAttribute("href")).toBe("/o/alder-creek");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/o/other-church/calendar",
    "/o/alder-creek/admin/roles",
    "/o/alder-creek/calendar/../admin",
    "/o/alder-creek/calendar#x",
    "\\\\evil.example",
  ])("replaces the hostile from=%s with the calendar default, never reflecting it", async (from) => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    const { container } = await renderPage(from);
    expect(screen.getByRole("link", { name: /back to calendar/i }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar",
    );
    expect(container.innerHTML).not.toContain("evil.example");
  });

  it("ignores an array-valued from", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    await renderPage(["/o/alder-creek", "/o/alder-creek"]);
    expect(screen.getByRole("link", { name: /back to calendar/i })).toBeTruthy();
  });
});

describe("CalendarEventPage — Edit this event", () => {
  it("shows the link to a manager when org_portal.events is on", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: true } });
    isFlagEnabled.mockResolvedValue(true);
    await renderPage();
    expect(screen.getByRole("link", { name: /edit this event/i }).getAttribute("href")).toBe(
      `/o/alder-creek/admin/events/${EVENT_ID}`,
    );
  });

  it("hides it when the flag is off, and for an ordinary member (without reading the flag)", async () => {
    signedIn();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: true } });
    isFlagEnabled.mockResolvedValue(false);
    const { unmount } = await renderPage();
    expect(screen.queryByRole("link", { name: /edit this event/i })).toBeNull();
    unmount();

    isFlagEnabled.mockReset();
    getMemberEvent.mockResolvedValue({ kind: "ok", data: { event: detail(), canManage: false } });
    await renderPage();
    expect(isFlagEnabled).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /edit this event/i })).toBeNull();
  });
});
