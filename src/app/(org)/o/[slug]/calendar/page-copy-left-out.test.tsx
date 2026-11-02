// @vitest-environment jsdom
/**
 * T9 (docs/work-log/2026-11-02-members-only-events.md): Copy month's "(N
 * members-only events left out)" count is computed from what the viewer was
 * GIVEN, so a visitor (whose result holds no `isPublic: false` entry,
 * DECISION-316) is never told that a members-only event exists, while a member
 * still is. The button is stubbed to expose the one prop that carries the count.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { makeEntry, makeMonthData } from "./calendar-test-data";

vi.mock("./copy-month-button", () => ({
  CopyMonthButton: (props: { leftOutCount: number }) => (
    <button data-testid="copy-month" data-left-out={props.leftOutCount}>Copy month</button>
  ),
}));

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

async function renderWith(entries: ReturnType<typeof makeEntry>[]) {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue({
    kind: "ok",
    org: {
      organizationId: "org-1",
      personId: "person-1",
      name: "Alder Creek Presbyterian Church",
      organizationType: "congregation",
      slug: "alder-creek",
      platformStatus: "managed",
    },
  });
  getMonthCalendar.mockResolvedValue({ kind: "ok", data: makeMonthData({ entries, inMonthCount: entries.length, unfilteredInMonthCount: entries.length }) });
  const el = await CalendarPage({
    params: Promise.resolve({ slug: "alder-creek" }),
    searchParams: Promise.resolve({}),
  });
  render(el);
  return screen.getByTestId("copy-month").getAttribute("data-left-out");
}

const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Copy month's left-out count counts only what the viewer was given", () => {
  it("a visitor-shaped result (no members-only entry) reports 0 left out", async () => {
    expect(await renderWith([makeEntry(), makeEntry({ id: OTHER, startsAtWallClock: "2026-10-05T09:00" })])).toBe("0");
  });

  it("a member-shaped result (one members-only entry in the month) still reports 1 left out", async () => {
    expect(
      await renderWith([makeEntry(), makeEntry({ id: OTHER, startsAtWallClock: "2026-10-05T09:00", isPublic: false })]),
    ).toBe("1");
  });
});
