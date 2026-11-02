// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory/parishes/unassigned`'s page.tsx
 * (tag CMP). `getUnassignedPage()`'s own SQL (the G8 definition, the buckets,
 * the masking) is proven against Postgres in `parishes.test.ts`; this pins the
 * gate order, the allowlist parsing of `?hide=` and `?page=`, and the three
 * different empty/failure panels (an empty list, a load failure and a
 * hidden-everything state are never the same text).
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

const getUnassignedPage = vi.fn();
vi.mock("@/lib/parishes", () => ({
  getUnassignedPage: (...args: unknown[]) => getUnassignedPage(...args),
}));
vi.mock("./actions", () => ({ assignHouseholdAction: vi.fn() }));
vi.mock("../[orgUnitId]/actions", () => ({ moveHouseholdAction: vi.fn(), bulkMoveAction: vi.fn() }));
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

import UnassignedPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getUnassignedPage.mockReset();
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
const params = () => Promise.resolve({ slug: "alder-creek" });
const search = (value: { hide?: string; page?: string } = {}) => Promise.resolve(value);
const flagsOn = () =>
  isFlagEnabled.mockImplementation((key: string) =>
    Promise.resolve(key === "org_portal.directory" || key === "org_portal.directory_v2"),
  );

const MOVER = {
  canDefine: false,
  canMove: true,
  canListHouseholds: true,
  canReadRoster: true,
  seesHiddenNames: false,
  holdsSeatKey: true,
};
const COUNTS = { members: 2, participants: 1, visitors: 1, others: 1 };
const HOUSEHOLDS = [
  { householdId: "h1", name: "The Smith Family", group: "members", people: [{ name: "Pat Smith", masked: false, connection: "member" }] },
  { householdId: "h2", name: "The Jones Household", group: "visitors", people: [{ name: "Private", masked: true, connection: "visitor" }] },
];

function okResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    counts: COUNTS,
    households: HOUSEHOLDS,
    totalShown: 2,
    page: 1,
    pageSize: 25,
    activeTargets: [{ orgUnitId: "u1", name: "North District", deaconName: null }],
    authority: MOVER,
    ...overrides,
  };
}

async function renderPage(query: { hide?: string; page?: string } = {}) {
  render(await UnassignedPage({ params: params(), searchParams: search(query) }));
}

describe("UnassignedPage - gate order and failures", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(UnassignedPage({ params: params(), searchParams: search() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fdirectory%2Fparishes%2Funassigned",
    );
    expect(getUnassignedPage).not.toHaveBeenCalled();
  });

  it("never reads households when a platform directory flag is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);
    await renderPage();
    expect(getUnassignedPage).not.toHaveBeenCalled();
  });

  it("a load failure is its own panel and never reads as `every household is in a district`; OrgAccessError is re-thrown", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockRejectedValueOnce(new OrgAccessError("p", "o"));
    await expect(UnassignedPage({ params: params(), searchParams: search() })).rejects.toThrow(
      "mock: no active membership",
    );
    getUnassignedPage.mockRejectedValueOnce(new Error("connection reset"));
    await renderPage({ hide: "members" });
    expect(screen.getByRole("alert").textContent).toBe("We couldn't load the households. Try again.");
    expect(document.body.textContent).not.toMatch(/Every household is in a district/);
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes/unassigned?hide=members",
    );
  });

  it("off and forbidden are their own panels", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValueOnce({ kind: "off" });
    await renderPage();
    expect(screen.getByText(/Parish management isn.t turned on/)).toBeTruthy();
    cleanup();
    getUnassignedPage.mockResolvedValueOnce({ kind: "forbidden" });
    await renderPage();
    expect(screen.getByText(/You don.t have permission to view households by district/)).toBeTruthy();
  });
});

describe("UnassignedPage - URL state is allowlist-parsed", () => {
  it("passes only allowlisted group tokens and a positive-integer page to the library", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(okResult());
    await renderPage({ hide: "members,'; drop table x;--,bogus", page: "abc" });
    const [personId, orgId, opts] = getUnassignedPage.mock.calls[0]!;
    expect([personId, orgId]).toEqual(["person-1", "org-1"]);
    expect([...opts.hide]).toEqual(["members"]);
    expect(opts.page).toBe(1);
  });
});

describe("UnassignedPage - rendering", () => {
  it("shows the heading, the intro, four toggles with counts, the precedence hint and one Assign control per household", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(okResult());
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Households with no district" })).toBeTruthy();
    expect(
      screen.getByText("Households with at least one living, current person that aren't in any district yet."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hide Members (2)" })).toBeTruthy();
    expect(screen.getByText(/appears under the first group that fits: Members, then Participants/)).toBeTruthy();
    // Copy group J: Others includes the people the Community lists call inactive or moved away.
    expect(
      screen.getByText(
        /Others are households where everyone is only listed, on\s+staff, or marked inactive or moved away\./,
      ),
    ).toBeTruthy();
    expect(screen.getAllByTestId("household-row")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Assign / })).toHaveLength(2);
    expect(screen.getByText("Private")).toBeTruthy();
  });

  it("zero everywhere is `Every household is in a district.` with a way back", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(
      okResult({ counts: { members: 0, participants: 0, visitors: 0, others: 0 }, households: [], totalShown: 0 }),
    );
    await renderPage();
    expect(screen.getByText("Every household is in a district.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Back to Parishes" }).length).toBeGreaterThan(0);
  });

  it("every group hidden is `Every group is hidden…`, with the counts still shown", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(okResult({ households: [], totalShown: 0 }));
    await renderPage({ hide: "members,participants,visitors,others" });
    expect(screen.getByText("Every group is hidden. Show a group to see its households.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show Members (2)" })).toBeTruthy();
    expect(screen.queryByText("Every household is in a district.")).toBeNull();
  });

  it("some groups hidden and the groups still shown empty is never blank: `No households in the groups shown.` with a fixed link that clears ?hide=", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(okResult({ households: [], totalShown: 0 }));
    await renderPage({ hide: "members,participants,visitors" });
    const panel = screen.getByTestId("none-in-groups-shown");
    expect(panel.textContent).toContain("No households in the groups shown.");
    expect(within(panel).getByRole("link", { name: "Show all groups" }).getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes/unassigned",
    );
    expect(screen.queryByText("Every household is in a district.")).toBeNull();
    expect(screen.queryByText("Every group is hidden. Show a group to see its households.")).toBeNull();
  });

  it("every text link on the page is a 44px target: the back links and `Show all groups` (QA run 1, Finding 5)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(okResult({ households: [], totalShown: 0 }));
    await renderPage({ hide: "members,participants,visitors" });
    const show = screen.getByRole("link", { name: "Show all groups" });
    expect(show.className).toContain("min-h-11");
    expect(show.className).toContain("inline-flex");
    for (const back of screen.getAllByRole("link", { name: "Back to Parishes" })) {
      expect(back.className).toContain("min-h-11");
    }
    cleanup();
    getUnassignedPage.mockResolvedValue(
      okResult({ counts: { members: 0, participants: 0, visitors: 0, others: 0 }, households: [], totalShown: 0 }),
    );
    await renderPage();
    const backs = screen.getAllByRole("link", { name: "Back to Parishes" });
    expect(backs.length).toBe(2);
    for (const back of backs) expect(back.className).toContain("min-h-11");
  });

  it("nothing hidden and zero households everywhere stays `Every household is in a district.` (not the groups-shown text)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(
      okResult({ counts: { members: 0, participants: 0, visitors: 0, others: 0 }, households: [], totalShown: 0 }),
    );
    await renderPage();
    expect(screen.getByText("Every household is in a district.")).toBeTruthy();
    expect(screen.queryByTestId("none-in-groups-shown")).toBeNull();
  });

  it("with no active district, an administrator is pointed to add one and no Assign control is offered", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(
      okResult({ activeTargets: [], authority: { ...MOVER, canDefine: true } }),
    );
    await renderPage();
    const note = screen.getByTestId("no-targets");
    expect(note.textContent).toContain("There are no districts to assign to yet.");
    expect(note.querySelector("a")?.textContent).toBe("Add a district");
    expect(screen.queryByRole("button", { name: /^Assign / })).toBeNull();
  });

  it("with no active district, anyone else is told to ask the administrator", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(okResult({ activeTargets: [] }));
    await renderPage();
    expect(screen.getByTestId("no-targets").textContent).toContain(
      "Ask your congregation's administrator to add them.",
    );
  });

  it("a viewer who may list but not move sees the households with no Assign control and no no-targets note", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(
      okResult({ authority: { ...MOVER, canMove: false, holdsSeatKey: false }, activeTargets: [] }),
    );
    await renderPage();
    expect(screen.getAllByTestId("household-row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Assign / })).toBeNull();
    expect(screen.queryByTestId("no-targets")).toBeNull();
  });

  it("keeps the hide state in the pager links and resets to a clean URL otherwise", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    flagsOn();
    getUnassignedPage.mockResolvedValue(okResult({ totalShown: 60 }));
    await renderPage({ hide: "others" });
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes/unassigned?hide=others&page=2",
    );
  });
});
