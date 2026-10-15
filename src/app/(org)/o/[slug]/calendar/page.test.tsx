// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/calendar`'s page.tsx: the gate order, the
 * state switch, the empty states, and which links render for whom. The SQL is
 * proven by `src/lib/calendar.test.ts`; the pure helpers by `src/lib/calendar/*`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { makeEntry, makeMonthData, STUDY_TYPE, WORSHIP_TYPE, GENERAL_TYPE } from "./calendar-test-data";

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

const getMonthCalendar = vi.fn();
vi.mock("@/lib/calendar", () => ({
  getMonthCalendar: (...args: unknown[]) => getMonthCalendar(...args),
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

import CalendarPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getMonthCalendar.mockReset();
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

function signedIn() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const el = await CalendarPage({
    params: Promise.resolve({ slug: "alder-creek" }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(el);
}

describe("CalendarPage — the gate order", () => {
  it("redirects a signed-out visitor to /signin with the REBUILT canonical calendar href", async () => {
    cachedAuth.mockResolvedValue(null);
    const teal = WORSHIP_TYPE.id;

    await expect(
      renderPage({ month: "2026-10", types: `${teal.toUpperCase()},not-a-uuid`, view: "list", junk: "<script>" }),
    ).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(`/o/alder-creek/calendar?month=2026-10&types=${teal}&view=list`)}`,
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("drops a garbage month from the signed-out callback instead of reflecting it", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(renderPage({ month: "0000-01" })).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent("/o/alder-creek/calendar")}`,
    );
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    expect(getMonthCalendar).not.toHaveBeenCalled();
  });

  it("renders the shared access-denied copy, naming the organization, with no calendar read", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });
    await renderPage();
    expect(screen.getByText(/you don.t have access to Bramblewood/i)).toBeTruthy();
    expect(getMonthCalendar).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });
    await renderPage();
    expect(screen.getByText(/Fernwood/)).toBeTruthy();
    expect(getMonthCalendar).not.toHaveBeenCalled();
  });

  it("calls assertOrgAccess before reading the calendar, and reads it with the parsed request", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData() });
    await renderPage({ month: "2026-11", types: WORSHIP_TYPE.id });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
    expect(getMonthCalendar).toHaveBeenCalledWith("person-1", "org-1", {
      month: { year: 2026, month: 11 },
      requestedTypeIds: [WORSHIP_TYPE.id],
    });
  });

  it("falls back cleanly on ?month=0000-01 and ?types=not-a-uuid (no month, no types, no error)", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData() });
    await renderPage({ month: "0000-01", types: "not-a-uuid", view: "bogus" });

    expect(getMonthCalendar).toHaveBeenCalledWith("person-1", "org-1", {
      month: undefined,
      requestedTypeIds: [],
    });
    expect(screen.getByRole("heading", { level: 2, name: "October 2026" })).toBeTruthy();
  });
});

describe("CalendarPage — non-data states", () => {
  it("renders the disabled copy, without reading the flag", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "disabled" });
    await renderPage();
    expect(
      screen.getByText("The calendar isn't turned on for Alder Creek Presbyterian Church yet."),
    ).toBeTruthy();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it("renders the forbidden copy", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "forbidden" });
    await renderPage();
    expect(screen.getByText(/isn't available to your account/)).toBeTruthy();
  });

  it("renders the load error with a Try again link that keeps month, types and view", async () => {
    signedIn();
    getMonthCalendar.mockRejectedValue(new Error("connection reset"));
    await renderPage({ month: "2026-10", types: WORSHIP_TYPE.id, view: "list" });
    expect(screen.getByText(/couldn.t load the calendar right now/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      `/o/alder-creek/calendar?month=2026-10&types=${WORSHIP_TYPE.id}&view=list`,
    );
  });

  it("re-throws OrgAccessError instead of rendering the load error", async () => {
    signedIn();
    getMonthCalendar.mockRejectedValue(new OrgAccessError("person-1", "org-1"));
    await expect(renderPage()).rejects.toThrow("mock: no active membership");
  });
});

describe("CalendarPage — the calendar", () => {
  it("renders both the grid and the list (CSS picks one), and the entries link to detail pages", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData() });
    await renderPage();

    expect(screen.getByTestId("calendar-grid")).toBeTruthy();
    expect(screen.getByTestId("calendar-list")).toBeTruthy();
    expect(screen.getAllByTestId("calendar-entry")).toHaveLength(2);
    const href = screen.getAllByTestId("calendar-entry")[0].getAttribute("href")!;
    expect(href).toContain("/o/alder-creek/calendar/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?from=");
    expect(decodeURIComponent(href.split("?from=")[1])).toBe("/o/alder-creek/calendar?month=2026-10");
  });

  it("the entries' from= is the displayed month, types and view", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({ activeTypeIds: [WORSHIP_TYPE.id] }),
    });
    await renderPage({ month: "2026-10", types: WORSHIP_TYPE.id, view: "list" });
    const href = screen.getAllByTestId("calendar-entry")[0].getAttribute("href")!;
    expect(decodeURIComponent(href.split("?from=")[1])).toBe(
      `/o/alder-creek/calendar?month=2026-10&types=${WORSHIP_TYPE.id}&view=list`,
    );
  });

  it("Today drops the month but keeps the sanitized types and the view", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({ activeTypeIds: [STUDY_TYPE.id] }),
    });
    await renderPage({ month: "2026-02", types: STUDY_TYPE.id, view: "list" });
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("href")).toBe(
      `/o/alder-creek/calendar?types=${STUDY_TYPE.id}&view=list`,
    );
  });

  it("the month/list switch is hidden below md and marks the current view", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData() });
    await renderPage({ view: "list" });
    const group = screen.getByRole("group", { name: "Calendar view" });
    expect(group.className).toContain("hidden");
    expect(group.className).toContain("md:inline-flex");
    expect(screen.getByRole("link", { name: "List" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Month" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Month" }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar?month=2026-10",
    );
  });

  it("omits the pills entirely when the org has one type or none", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({ types: [GENERAL_TYPE] }),
    });
    await renderPage();
    expect(screen.queryByRole("navigation", { name: "Filter by event type" })).toBeNull();
    expect(screen.queryByTestId("calendar-filters")).toBeNull();
  });

  it("renders the pills (twice: disclosure and inline) when there are several types", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData() });
    await renderPage();
    expect(screen.getAllByRole("navigation", { name: "Filter by event type" })).toHaveLength(2);
  });

  it("shows Copy month, last in the action bar, when the month has events", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData() });
    await renderPage();
    const copy = screen.getByTestId("copy-month");
    const today = screen.getByRole("link", { name: "Today" });
    expect(today.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never renders text-xs on the member calendar", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({ canManage: true, entries: [makeEntry(), makeEntry({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startsAtWallClock: "2026-10-05T09:00" })] }),
    });
    isFlagEnabled.mockResolvedValue(true);
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain("text-xs");
  });
});

describe("CalendarPage — manager links need canManage AND the org_portal.events flag", () => {
  it("shows Add an event and Manage events for a manager with the flag on", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData({ canManage: true }) });
    isFlagEnabled.mockResolvedValue(true);
    await renderPage();
    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.events");
    expect(screen.getByRole("link", { name: "Add an event" }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/events/new",
    );
    expect(screen.getByRole("link", { name: "Manage events" }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/events",
    );
  });

  it("hides both for a manager when the flag is off", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData({ canManage: true }) });
    isFlagEnabled.mockResolvedValue(false);
    await renderPage();
    expect(screen.queryByRole("link", { name: "Add an event" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Manage events" })).toBeNull();
  });

  it("hides both, without reading the flag, for an ordinary member", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData({ canManage: false }) });
    await renderPage();
    expect(isFlagEnabled).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Add an event" })).toBeNull();
  });

  it("treats a failed flag read as flag-off rather than failing the page", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData({ canManage: true }) });
    isFlagEnabled.mockRejectedValue(new Error("connection reset"));
    await renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "October 2026" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add an event" })).toBeNull();
  });
});

describe("CalendarPage — empty states", () => {
  const EMPTY = {
    entries: [],
    inMonthCount: 0,
    unfilteredInMonthCount: 0,
  };

  it("an org with no events at all, viewed by a manager: invitation plus an Add an event button (only once)", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({ ...EMPTY, orgHasEvents: false, canManage: true }),
    });
    isFlagEnabled.mockResolvedValue(true);
    await renderPage();
    expect(screen.getByText("Alder Creek Presbyterian Church hasn't added any events yet.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Add an event" })).toHaveLength(1);
    expect(screen.queryByTestId("calendar-grid")).toBeNull();
  });

  it("an org with no events at all, viewed by a member: a quiet note and no buttons", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({ ...EMPTY, orgHasEvents: false }),
    });
    await renderPage();
    expect(
      screen.getByText("When Alder Creek Presbyterian Church adds events, they'll appear here."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add an event" })).toBeNull();
  });

  it("a manager with the flag off sees the member wording, not an Add button", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({ ...EMPTY, orgHasEvents: false, canManage: true }),
    });
    isFlagEnabled.mockResolvedValue(false);
    await renderPage();
    expect(screen.getByText(/adds events, they'll appear here/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add an event" })).toBeNull();
  });

  it("an empty month keeps the month nav and says nothing is scheduled", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData({ ...EMPTY }) });
    await renderPage({ month: "2026-10" });
    expect(screen.getByText("Nothing is scheduled for October 2026.")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Month" })).toBeTruthy();
    expect(screen.queryByTestId("copy-month")).toBeNull();
  });

  it("filters hiding everything offers 'Show all event types' (types dropped, month and view kept)", async () => {
    signedIn();
    getMonthCalendar.mockResolvedValue({
      kind: "ok",
      data: makeMonthData({
        entries: [],
        inMonthCount: 0,
        unfilteredInMonthCount: 4,
        activeTypeIds: [STUDY_TYPE.id],
      }),
    });
    await renderPage({ types: STUDY_TYPE.id, view: "list" });
    expect(screen.getByText("No events match these event types.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all event types" }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar?month=2026-10&view=list",
    );
  });
});
