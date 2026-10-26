// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory/parishes/<orgUnitId>`'s page.tsx
 * (tag CMP). `getDistrictPage()`'s own SQL (the toggle, the authority, the
 * single count, the masking, the 404 matrix) is proven against Postgres in
 * `parishes.test.ts`; this pins the page-level gate order, the result branches
 * and what renders from an already-resolved result.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));

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
vi.mock("@/lib/flags", () => ({ isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args) }));

const getDistrictPage = vi.fn();
vi.mock("@/lib/parishes", () => ({
  getDistrictPage: (...args: unknown[]) => getDistrictPage(...args),
}));
vi.mock("./actions", () => ({ moveHouseholdAction: vi.fn(), bulkMoveAction: vi.fn() }));
vi.mock("../unassigned/actions", () => ({ assignHouseholdAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import DistrictPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getDistrictPage.mockReset();
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
const params = (orgUnitId = "u1") => Promise.resolve({ slug: "alder-creek", orgUnitId });
const searchParams = (value: { page?: string } = {}) => Promise.resolve(value);
const flagsOn = () =>
  isFlagEnabled.mockImplementation((key: string) =>
    Promise.resolve(key === "org_portal.directory" || key === "org_portal.directory_v2"),
  );

const AUTH_MOVER = {
  canDefine: false,
  canMove: true,
  canListHouseholds: true,
  canReadRoster: true,
  seesHiddenNames: false,
  holdsSeatKey: true,
};

const HOUSEHOLDS = [
  {
    householdId: "h1",
    name: "The Smith Family",
    people: [{ name: "Pat Smith", masked: false, connection: "member" }],
  },
  {
    householdId: "h2",
    name: "The Jones Household",
    people: [{ name: "Private", masked: true, connection: "visitor" }],
  },
];

function okResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    district: {
      orgUnitId: "u1",
      name: "North District",
      unitType: "district",
      archived: false,
      deaconName: "Priya Balakrishnan",
      householdCount: 2,
    },
    authority: AUTH_MOVER,
    households: HOUSEHOLDS,
    total: 2,
    page: 1,
    pageSize: 25,
    activeTargets: [{ orgUnitId: "u2", name: "South District", deaconName: null }],
    ...overrides,
  };
}

async function renderPage(page: Record<string, string> = {}) {
  render(await DistrictPage({ params: params(), searchParams: searchParams(page) }));
}

describe("DistrictPage - gate order and result branches", () => {
  it("redirects to /signin with a callbackUrl back to THIS page when unauthenticated, before anything else", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(DistrictPage({ params: params("u1"), searchParams: searchParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fdirectory%2Fparishes%2Fu1",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(getDistrictPage).not.toHaveBeenCalled();
  });

  it("renders the directory flag-off state, and never reads the district, when a platform directory flag is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);
    await renderPage();
    expect(getDistrictPage).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t available for Alder Creek/i)).toBeTruthy();
  });

  it("re-throws OrgAccessError, and shows the load-error panel (never an empty list) for any other failure", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockRejectedValueOnce(new OrgAccessError("person-1", "org-1"));
    await expect(DistrictPage({ params: params(), searchParams: searchParams() })).rejects.toThrow(
      "mock: no active membership",
    );

    getDistrictPage.mockRejectedValueOnce(new Error("connection reset"));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toBe("We couldn't load the households. Try again.");
    expect(screen.queryByText(/No households/)).toBeNull();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes/u1",
    );
  });

  it("off, forbidden and not_found each have their own answer; not_found is a 404", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();

    getDistrictPage.mockResolvedValueOnce({ kind: "off" });
    await renderPage();
    expect(screen.getByText("Parish management isn't turned on for Alder Creek Presbyterian Church yet.")).toBeTruthy();
    cleanup();

    getDistrictPage.mockResolvedValueOnce({ kind: "forbidden" });
    await renderPage();
    expect(screen.getByText(/You don.t have permission to view households by district/)).toBeTruthy();
    cleanup();

    getDistrictPage.mockResolvedValueOnce({ kind: "not_found" });
    await expect(DistrictPage({ params: params("missing"), searchParams: searchParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("passes the org's own ids and the parsed page to the library - never an id from the URL for the organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(okResult({ page: 2 }));
    await renderPage({ page: "2" });
    expect(getDistrictPage).toHaveBeenCalledWith("person-1", "org-1", "u1", { page: 2 });
  });

  it("an unparseable ?page= is page 1", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(okResult());
    await renderPage({ page: "-3; drop" });
    expect(getDistrictPage).toHaveBeenCalledWith("person-1", "org-1", "u1", { page: 1 });
  });
});

describe("DistrictPage - an active district", () => {
  it("shows the name, deacon, count, a fixed back link, and a Move control per household for someone who can move", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(okResult());
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "North District" })).toBeTruthy();
    expect(screen.getByText("Deacon: Priya Balakrishnan")).toBeTruthy();
    expect(screen.getByText("2 households")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Parishes" }).getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes",
    );
    expect(screen.getByRole("link", { name: "Back to Parishes" }).className).toContain("min-h-11");
    expect(screen.getAllByTestId("household-row")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Move / })).toHaveLength(2);
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.queryByTestId("archived-notice")).toBeNull();
  });

  it("a viewer who may list but not move (directory.view_hidden) sees the households with no Move control", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(
      okResult({ authority: { ...AUTH_MOVER, canMove: false, holdsSeatKey: false }, activeTargets: [] }),
    );
    await renderPage();
    expect(screen.getAllByTestId("household-row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
  });

  it("an empty active district says so", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(
      okResult({ households: [], total: 0, district: { ...okResult().district, householdCount: 0 } }),
    );
    await renderPage();
    expect(screen.getByText("No households in this district yet.")).toBeTruthy();
  });

  it("pages with fixed links: no user-controlled return parameter", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(okResult({ total: 60, page: 1 }));
    await renderPage();
    const next = screen.getByRole("link", { name: "Next" });
    expect(next.getAttribute("href")).toBe("/o/alder-creek/directory/parishes/u1?page=2");
  });
});

describe("DistrictPage - an archived district", () => {
  const archived = (count: number, extra: Record<string, unknown> = {}) =>
    okResult({
      district: {
        orgUnitId: "u1",
        name: "East District",
        unitType: "district",
        archived: true,
        deaconName: null,
        householdCount: count,
      },
      total: count,
      ...extra,
    });

  it("shows the Archived badge, the notice, and `Move all N households to…` for a mover", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(archived(2));
    await renderPage();
    expect(screen.getByText("Archived")).toBeTruthy();
    const notice = screen.getByTestId("archived-notice");
    expect(notice.textContent).toContain("This district is archived. No households can be moved into it.");
    expect(within(notice).getByRole("button", { name: "Move all 2 households to…" })).toBeTruthy();
  });

  it("over 100 households: the message replaces the picker", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(archived(150, { households: HOUSEHOLDS }));
    await renderPage();
    expect(screen.getByTestId("bulk-over-cap").textContent).toBe(
      "This district has more than 100 households, so they can't be moved all at once.",
    );
    expect(screen.queryByRole("button", { name: /^Move all/ })).toBeNull();
  });

  const BASE = "This district is archived. No households can be moved into it.";
  const BULK_SENTENCE = "Move households out one at a time, or all at once below.";
  const AUTH_ADMIN = { ...AUTH_MOVER, canDefine: true, holdsSeatKey: false };
  const AUTH_DEFINER_ONLY = { ...AUTH_MOVER, canDefine: true, canMove: false, holdsSeatKey: false };
  const AUTH_NEITHER = { ...AUTH_MOVER, canMove: false, holdsSeatKey: false };
  const OTHER = [{ orgUnitId: "u2", name: "South District", deaconName: null }];

  async function mount(count: number, authority: Record<string, unknown>, activeTargets: unknown[]) {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(
      archived(count, { authority, activeTargets, households: count > 0 ? HOUSEHOLDS : [] }),
    );
    await renderPage();
    return screen.getByTestId("archived-notice");
  }

  it("bulk state: the sentence promises `all at once below` and the bulk trigger is beneath it", async () => {
    const notice = await mount(5, AUTH_MOVER, OTHER);
    expect(notice.textContent).toContain(`${BASE} ${BULK_SENTENCE}`);
    expect(within(notice).getByRole("button", { name: "Move all 5 households to…" })).toBeTruthy();
    expect(screen.queryByTestId("bulk-over-cap")).toBeNull();
  });

  it("over_cap state: `one at a time below` and the exact cap message; no `all at once below`", async () => {
    const notice = await mount(101, AUTH_MOVER, OTHER);
    expect(notice.textContent).toContain(`${BASE} Move households out one at a time below.`);
    expect(notice.textContent).not.toMatch(/all at once below/);
    expect(notice.textContent).not.toMatch(/smaller groups/);
    expect(within(notice).getByTestId("bulk-over-cap").textContent).toBe(
      "This district has more than 100 households, so they can't be moved all at once.",
    );
    expect(within(notice).queryByRole("button")).toBeNull();
  });

  it("exactly 100 is the bulk state and exactly 101 is over_cap", async () => {
    const at100 = await mount(100, AUTH_MOVER, OTHER);
    expect(at100.textContent).toContain(BULK_SENTENCE);
    cleanup();
    const at101 = await mount(101, AUTH_MOVER, OTHER);
    expect(at101.textContent).not.toContain("all at once below");
  });

  it("no_target state, a seat holder: the base sentence and the plain fact, no promise, no instruction to add a district", async () => {
    const notice = await mount(5, AUTH_MOVER, []);
    expect(notice.textContent).toBe(`${BASE}There are no active districts to move them to.`);
    expect(within(notice).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("bulk-over-cap")).toBeNull();
  });

  it("no_target state, a viewer who can move and define: the fact plus how to fix it", async () => {
    const notice = await mount(5, AUTH_ADMIN, []);
    expect(notice.textContent).toBe(
      `${BASE}There are no active districts to move them to. Add a district or restore an archived one on the Parishes page first.`,
    );
  });

  it("no_target wins over 101+ households: the cap message is not shown when there is nowhere to move them", async () => {
    const notice = await mount(150, AUTH_ADMIN, []);
    expect(notice.textContent).not.toMatch(/more than 100/);
    expect(notice.textContent).toContain("There are no active districts to move them to.");
  });

  it("none state: a viewer who cannot move (defining alone does not move) sees the base sentence and nothing else", async () => {
    for (const authority of [AUTH_DEFINER_ONLY, AUTH_NEITHER]) {
      const notice = await mount(5, authority, OTHER);
      expect(notice.textContent).toBe(BASE);
      expect(within(notice).queryByRole("button")).toBeNull();
      cleanup();
    }
  });

  it("`all at once below` appears if and only if the bulk trigger is present, for every viewer and count", async () => {
    const viewers = [AUTH_MOVER, AUTH_ADMIN, AUTH_DEFINER_ONLY, AUTH_NEITHER];
    for (const authority of viewers) {
      for (const count of [0, 1, 100, 101]) {
        for (const targets of [[], OTHER]) {
          const notice = await mount(count, authority, targets);
          const hasTrigger = within(notice).queryByRole("button", { name: /^Move all/ }) !== null;
          const promises = /all at once below/.test(notice.textContent ?? "");
          expect(promises, `canMove=${String(authority.canMove)} n=${count} targets=${targets.length}`).toBe(hasTrigger);
          expect(notice.textContent).not.toMatch(/smaller groups/);
          cleanup();
        }
      }
    }
  });

  it("a viewer who cannot move sees the notice without the move sentence or any control", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(
      archived(2, { authority: { ...AUTH_MOVER, canMove: false }, activeTargets: [] }),
    );
    await renderPage();
    expect(screen.getByTestId("archived-notice").textContent).not.toMatch(/Move households out/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an empty archived district says it has no households and shows no empty-active message", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getDistrictPage.mockResolvedValue(archived(0, { households: [] }));
    await renderPage();
    expect(screen.getByTestId("archived-notice").textContent).toContain("It has no households.");
    expect(screen.queryByText("No households in this district yet.")).toBeNull();
  });
});
