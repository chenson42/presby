// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>`'s page.tsx.
 *
 * The four-way-miss branches (not-found/forbidden/ended) are unchanged from
 * P0 and already covered by e2e (post-login-routing.spec.ts). What this file
 * pins is the ORDERING AND ERROR-HANDLING CONTRACT of the home, as extended by
 * the portal-home alignment pipeline
 * (docs/work-log/2026-10-14-portal-home-alignment.md, DECISION-162):
 *
 *   1. `org_portal.home_v2` OFF renders the unchanged `OrgPortalStub` and
 *      never calls a v2 loader.
 *   2. ON: `assertOrgAccess` is the first and sequential gate; then the three
 *      tenant loaders run under ONE `Promise.all` (independent failure
 *      domains).
 *   3. A non-`OrgAccessError` failure degrades only its own widget, logging a
 *      fixed string with ids only; `OrgAccessError` from any loader re-throws.
 *   4. Find-a-person shows only for a `directory.view` holder.
 *   5. The "Coming up" card is decided by the list function's `kind`; the page
 *      reads no calendar flag and no permission helper of its own.
 *   6. No `loading.tsx`, no `Suspense` (the `(org)` contract).
 *
 * Every collaborator is mocked; this file makes no DB connection.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const getPortalHomeData = vi.fn();
vi.mock("@/lib/org-portal/home-data", () => ({
  getPortalHomeData: (...args: unknown[]) => getPortalHomeData(...args),
}));

const getViewerGroups = vi.fn();
vi.mock("@/lib/org-portal/my-groups", () => ({
  getViewerGroups: (...args: unknown[]) => getViewerGroups(...args),
}));

const listUpcomingMemberEvents = vi.fn();
vi.mock("@/lib/calendar", () => ({
  listUpcomingMemberEvents: (...args: unknown[]) =>
    listUpcomingMemberEvents(...args),
}));

const visiblePortalTiles = vi.fn();
vi.mock("@/lib/org-portal/tiles", () => ({
  DOMAIN_LABELS: { people: "Community" },
  DOMAIN_ORDER: ["people"],
}));

vi.mock("@/lib/org-portal/visible-tiles", () => ({
  visiblePortalTiles: (
    category: string,
    organizationType: string,
    viewer: unknown,
  ) => visiblePortalTiles(category, organizationType, viewer),
}));

const getFeedbackPromptState = vi.fn();
const shouldShowFeedbackPrompt = vi.fn();
vi.mock("@/lib/feedback-prompt", () => ({
  getFeedbackPromptState: (...args: unknown[]) => getFeedbackPromptState(...args),
  shouldShowFeedbackPrompt: (...args: unknown[]) => shouldShowFeedbackPrompt(...args),
}));

vi.mock("@/components/org-portal/find-person-form", () => ({
  FindPersonForm: () => <div data-testid="find-person-form-stub" />,
}));

const domainTileSectionsSpy = vi.fn();
vi.mock("@/components/shared/domain-tile-sections", () => ({
  DomainTileSections: (props: unknown) => {
    domainTileSectionsSpy(props);
    return null;
  },
}));

vi.mock("@/components/org-portal/tile-icons", () => ({
  TILE_ICONS: {},
}));

vi.mock("@/components/shared/feedback-prompt-card", () => ({
  FeedbackPromptCard: () => <div data-testid="feedback-prompt-card-stub" />,
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

import OrgPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getPortalHomeData.mockReset();
  getViewerGroups.mockReset().mockResolvedValue([]);
  listUpcomingMemberEvents
    .mockReset()
    .mockResolvedValue({ kind: "disabled" });
  visiblePortalTiles.mockReset().mockResolvedValue([]);
  getFeedbackPromptState.mockReset().mockResolvedValue(null);
  shouldShowFeedbackPrompt.mockReset().mockReturnValue(false);
  domainTileSectionsSpy.mockReset();
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

describe("OrgPage — org_portal.home_v2 OFF (the regression floor)", () => {
  it("renders the unchanged OrgPortalStub and never calls the v2 data functions", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => {
      if (key === "org_portal.home_v2") return false;
      return false;
    });

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.home_v2");
    expect(getPortalHomeData).not.toHaveBeenCalled();
    expect(getViewerGroups).not.toHaveBeenCalled();
    expect(listUpcomingMemberEvents).not.toHaveBeenCalled();
    expect(visiblePortalTiles).not.toHaveBeenCalled();
    expect(screen.getByText(/you're in/i)).toBeTruthy();
  });
});

describe("OrgPage — org_portal.home_v2 ON", () => {
  it("renders the greeting, and passes the household through to the yours zone", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      canViewDirectory: true,
      household: { id: "h1", name: "The Fennimore Family", memberCount: 2 },
    });
    visiblePortalTiles.mockResolvedValue([]);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /Sam\.$/,
    );
    expect(screen.getByText("The Fennimore Family")).toBeTruthy();
    expect(screen.queryByText(/you're in/i)).toBeNull();
    // Guards against an accidental swap to "administer" here, which would
    // silently list permission-gated setup tools on the main page instead of
    // the day-to-day tools (Phase 3 design, page.test.tsx call-site note).
    // organizationType (bug fix, docs/work-log/
    // 2026-08-27-credentials-tile-org-type.md): forwarded from the resolved
    // org, not hardcoded or omitted.
    expect(visiblePortalTiles).toHaveBeenCalledWith("operate", "congregation", {
      personId: "person-1",
      organizationId: "org-1",
    });
    // org_portal.motion (docs/work-log/2026-08-26-portal-visual-modernization.md)
    // must be read alongside org_portal.home_v2, and — mocked false here — must
    // NOT leave the greeting band's mount fade-in classes present. This is the
    // wiring itself, not just the flag's own on/off behavior (covered in
    // greeting.test.tsx): a future refactor that drops this read, swaps the
    // key, or inverts the boolean would otherwise ship with every test green.
    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.motion");
    const bandOff = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(bandOff?.className).not.toContain("animate-in");
    expect(bandOff?.className).not.toContain("fade-in-0");
  });

  it("threads org_portal.motion ON to Greeting's motionEnabled prop", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(
      async (key: string) =>
        key === "org_portal.home_v2" || key === "org_portal.motion",
    );
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      canViewDirectory: true,
      household: null,
    });
    visiblePortalTiles.mockResolvedValue([]);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.motion");
    const bandOn = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(bandOn?.className).toContain("animate-in");
    expect(bandOn?.className).toContain("fade-in-0");
  });

  it("degrades to a null home data (no crash) on a non-OrgAccessError failure", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockRejectedValue(new Error("connection reset"));
    visiblePortalTiles.mockResolvedValue([]);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Welcome.",
    );
  });

  it("re-throws OrgAccessError from getPortalHomeData rather than degrading", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(OrgPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });
});

describe("OrgPage — DomainTileSections wiring (commit 1, docs/work-log/2026-08-27-platform-home-and-portal.md, genericized shared component)", () => {
  it("passes the visiblePortalTiles() result, a slug-closure getHref, and the domain order/labels through to DomainTileSections", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      canViewDirectory: true,
      household: null,
    });
    const tiles = [{ key: "directory", href: (slug: string) => `/o/${slug}/directory` }];
    visiblePortalTiles.mockResolvedValue(tiles);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(domainTileSectionsSpy).toHaveBeenCalledTimes(1);
    const props = domainTileSectionsSpy.mock.calls[0][0] as {
      tiles: typeof tiles;
      getHref: (tile: (typeof tiles)[number]) => string;
      domainOrder: unknown;
      domainLabels: unknown;
    };
    expect(props.tiles).toBe(tiles);
    expect(props.getHref(tiles[0])).toBe("/o/alder-creek/directory");
    expect(props.domainOrder).toEqual(["people"]);
    expect(props.domainLabels).toEqual({ people: "Community" });
  });
});

describe("OrgPage — feedback prompt card (mid-design operator correction, §6b)", () => {
  it("renders the feedback prompt card when org_portal.feedback is ON and shouldShowFeedbackPrompt() returns true", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(
      async (key: string) =>
        key === "org_portal.home_v2" || key === "org_portal.feedback",
    );
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      canViewDirectory: true,
      household: null,
    });
    visiblePortalTiles.mockResolvedValue([]);
    getFeedbackPromptState.mockResolvedValue(null);
    shouldShowFeedbackPrompt.mockReturnValue(true);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(getFeedbackPromptState).toHaveBeenCalledWith("u1");
    expect(screen.getByTestId("feedback-prompt-card-stub")).toBeTruthy();
  });

  it("omits the feedback prompt card when org_portal.feedback is OFF, even if shouldShowFeedbackPrompt() would return true", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      canViewDirectory: true,
      household: null,
    });
    visiblePortalTiles.mockResolvedValue([]);
    getFeedbackPromptState.mockResolvedValue(null);
    shouldShowFeedbackPrompt.mockReturnValue(true);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(screen.queryByTestId("feedback-prompt-card-stub")).toBeNull();
  });

  it("omits the feedback prompt card when org_portal.feedback is ON but shouldShowFeedbackPrompt() returns false (snoozed/submitted/opted-out today)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(
      async (key: string) =>
        key === "org_portal.home_v2" || key === "org_portal.feedback",
    );
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      canViewDirectory: true,
      household: null,
    });
    visiblePortalTiles.mockResolvedValue([]);
    getFeedbackPromptState.mockResolvedValue({
      optedOut: false,
      lastSnoozedDate: "2026-08-27",
      lastSubmittedDate: null,
    });
    shouldShowFeedbackPrompt.mockReturnValue(false);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(screen.queryByTestId("feedback-prompt-card-stub")).toBeNull();
  });
});

function homeOn(extra: string[] = []) {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
  isFlagEnabled.mockImplementation(
    async (key: string) => key === "org_portal.home_v2" || extra.includes(key),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const HOME = {
  displayName: "Sam",
  canViewDirectory: true,
  household: null,
};

const EVENT = {
  id: "e1",
  seriesKey: "e1",
  title: "Choir rehearsal",
  startsAtWallClock: "2026-10-18T10:30",
  endsAtWallClock: null,
  location: null,
  eventType: { name: "Music", colorToken: "violet", iconKey: "Music" },
};

describe("OrgPage — gate ordering and concurrency", () => {
  it("holds every loader until assertOrgAccess resolves", async () => {
    homeOn();
    const gate = deferred<void>();
    assertOrgAccess.mockReset().mockReturnValue(gate.promise);
    getPortalHomeData.mockResolvedValue(HOME);

    const pending = OrgPage({ params: makeParams() });
    await new Promise((r) => setTimeout(r, 0));
    expect(getPortalHomeData).not.toHaveBeenCalled();
    expect(getViewerGroups).not.toHaveBeenCalled();
    expect(listUpcomingMemberEvents).not.toHaveBeenCalled();

    gate.resolve();
    await pending;
    expect(getPortalHomeData).toHaveBeenCalledTimes(1);
  });

  it("starts all three loaders before any of them resolves (one Promise.all)", async () => {
    homeOn();
    const home = deferred<typeof HOME>();
    const groups = deferred<unknown[]>();
    const events = deferred<unknown>();
    getPortalHomeData.mockReturnValue(home.promise);
    getViewerGroups.mockReturnValue(groups.promise);
    listUpcomingMemberEvents.mockReturnValue(events.promise);

    const pending = OrgPage({ params: makeParams() });
    await new Promise((r) => setTimeout(r, 0));
    expect(getPortalHomeData).toHaveBeenCalledTimes(1);
    expect(getViewerGroups).toHaveBeenCalledTimes(1);
    expect(listUpcomingMemberEvents).toHaveBeenCalledTimes(1);

    home.resolve(HOME);
    groups.resolve([]);
    events.resolve({ kind: "disabled" });
    await pending;
  });

  it("passes the server-resolved ids, and nothing else, to each loader", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    await OrgPage({ params: makeParams() });

    expect(getPortalHomeData).toHaveBeenCalledWith("person-1", "org-1");
    expect(getViewerGroups).toHaveBeenCalledWith("person-1", "org-1");
    expect(listUpcomingMemberEvents).toHaveBeenCalledWith("person-1", "org-1", {
      limit: 4,
    });
    expect(visiblePortalTiles).toHaveBeenCalledWith("operate", "congregation", {
      personId: "person-1",
      organizationId: "org-1",
    });
    // arity: no target-person parameter, ever.
    expect(getViewerGroups.mock.calls[0]).toHaveLength(2);
  });

  it("requests no flag whose key contains 'calendar'", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    await OrgPage({ params: makeParams() });
    const keys = isFlagEnabled.mock.calls.map((c) => String(c[0]));
    expect(keys.some((k) => k.includes("calendar"))).toBe(false);
  });
});

describe("OrgPage — find-a-person visibility", () => {
  it("is shown when the viewer can view the directory", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    render(await OrgPage({ params: makeParams() }));
    expect(screen.getByTestId("find-person-form-stub")).toBeTruthy();
  });

  it("is hidden when the viewer cannot", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue({ ...HOME, canViewDirectory: false });
    render(await OrgPage({ params: makeParams() }));
    expect(screen.queryByTestId("find-person-form-stub")).toBeNull();
  });

  it("is hidden when the home read failed (fail closed)", async () => {
    homeOn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPortalHomeData.mockRejectedValue(new Error("connection reset"));
    render(await OrgPage({ params: makeParams() }));
    expect(screen.queryByTestId("find-person-form-stub")).toBeNull();
  });
});

describe("OrgPage — household link target", () => {
  const withHousehold = {
    ...HOME,
    household: { id: "h1", name: "The Fennimore Family", memberCount: 2 },
  };

  it("links to the household page when directory and directory_v2 are both on", async () => {
    homeOn(["org_portal.directory", "org_portal.directory_v2"]);
    getPortalHomeData.mockResolvedValue(withHousehold);
    render(await OrgPage({ params: makeParams() }));
    expect(
      screen
        .getByRole("link", { name: /view household/i })
        .getAttribute("href"),
    ).toBe("/o/alder-creek/directory/households/h1");
  });

  it.each([
    ["org_portal.directory"],
    ["org_portal.directory_v2"],
    [],
  ])("links to the directory when only %s is on", async (...on) => {
    homeOn(on);
    getPortalHomeData.mockResolvedValue(withHousehold);
    render(await OrgPage({ params: makeParams() }));
    expect(
      screen.getByRole("link", { name: /view directory/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/directory");
  });
});

describe("OrgPage — groups", () => {
  it("renders the viewer's groups as pills", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    getViewerGroups.mockResolvedValue([
      { groupId: "g1", name: "Altar Guild" },
      { groupId: "g2", name: "Session" },
    ]);
    render(await OrgPage({ params: makeParams() }));
    expect(screen.getByText("Altar Guild")).toBeTruthy();
    expect(screen.getByText("Session")).toBeTruthy();
  });

  it("a groups failure omits only the pills, keeps greeting and household, and logs a fixed string", async () => {
    homeOn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getPortalHomeData.mockResolvedValue({
      ...HOME,
      household: { id: "h1", name: "The Fennimore Family", memberCount: 2 },
    });
    getViewerGroups.mockRejectedValue(new Error("relation SECRET_SQL missing"));
    render(await OrgPage({ params: makeParams() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Sam\./);
    expect(screen.getByText("The Fennimore Family")).toBeTruthy();
    expect(screen.queryByText("My groups")).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "[org-home] widget read failed; degrading",
      { widget: "groups", personId: "person-1", organizationId: "org-1" },
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET_SQL");
  });

  it("re-throws OrgAccessError from the groups loader", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    getViewerGroups.mockRejectedValue(new OrgAccessError("person-1", "org-1"));
    await expect(OrgPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });
});

describe("OrgPage — Coming up", () => {
  it("renders the card with row links and the footer link for rows", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    listUpcomingMemberEvents.mockResolvedValue({ kind: "ok", data: [EVENT] });
    render(await OrgPage({ params: makeParams() }));

    expect(screen.getByRole("heading", { name: "Coming up" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /choir rehearsal/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/calendar/e1?from=%2Fo%2Falder-creek");
    expect(screen.getByRole("link", { name: /see the full calendar/i })).toBeTruthy();
  });

  it("renders the empty copy for ok with no rows", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    listUpcomingMemberEvents.mockResolvedValue({ kind: "ok", data: [] });
    render(await OrgPage({ params: makeParams() }));
    expect(screen.getByText("Nothing is on the calendar right now.")).toBeTruthy();
  });

  it.each(["disabled", "forbidden"])(
    "renders no card for %s",
    async (kind) => {
      homeOn();
      getPortalHomeData.mockResolvedValue(HOME);
      listUpcomingMemberEvents.mockResolvedValue({ kind });
      render(await OrgPage({ params: makeParams() }));
      expect(screen.queryByRole("heading", { name: "Coming up" })).toBeNull();
    },
  );

  it("a thrown read shows the failure copy and logs the same fixed string", async () => {
    homeOn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getPortalHomeData.mockResolvedValue(HOME);
    listUpcomingMemberEvents.mockRejectedValue(new Error("timeout SECRET_SQL"));
    render(await OrgPage({ params: makeParams() }));

    expect(
      screen.getByText(
        "We can't load upcoming events right now. Try again in a moment.",
      ),
    ).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith(
      "[org-home] widget read failed; degrading",
      { widget: "events", personId: "person-1", organizationId: "org-1" },
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET_SQL");
  });

  it("re-throws OrgAccessError from the events loader", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    listUpcomingMemberEvents.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );
    await expect(OrgPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });
});

describe("OrgPage — main-row layout", () => {
  it("both cards present: the row is a two-column grid at md", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue({
      ...HOME,
      household: { id: "h1", name: "The Fennimore Family", memberCount: 2 },
    });
    listUpcomingMemberEvents.mockResolvedValue({ kind: "ok", data: [EVENT] });
    render(await OrgPage({ params: makeParams() }));
    expect(screen.getByTestId("home-main-row").className).toContain(
      "md:grid-cols-2",
    );
  });

  it("no cards: no grid wrapper element at all", async () => {
    homeOn();
    getPortalHomeData.mockResolvedValue(HOME);
    render(await OrgPage({ params: makeParams() }));
    expect(screen.queryByTestId("home-main-row")).toBeNull();
  });
});

describe("OrgPage — the (org) streaming contract", () => {
  it("has no loading.tsx beside it and imports no Suspense", () => {
    const dir = join(process.cwd(), "src/app/(org)/o/[slug]");
    expect(existsSync(join(dir, "loading.tsx"))).toBe(false);
    const source = readFileSync(join(dir, "page.tsx"), "utf8");
    // The docblock names Suspense to explain its absence; check the import
    // and the element, not the word.
    expect(source).not.toMatch(/import[^;]*\bSuspense\b/);
    expect(source).not.toContain("<Suspense");
  });
});

describe("OrgPage — the shared four-way miss response is unchanged", () => {
  it("redirects to /signin with a callbackUrl when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(OrgPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(OrgPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });
});
