// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/community`'s page.tsx — the gate
 * composition contract (flag AND org toggle, per DECISION-097) plus the
 * `getDirectory()` reuse and the `people.manage`-gated "Add person" CTA.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
const hasPermission = vi.fn();
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
    hasPermission: (...args: unknown[]) => hasPermission(...args),
  };
});

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const isOrgFeatureEnabled = vi.fn();
vi.mock("@/lib/org-features", () => ({
  isOrgFeatureEnabled: (...args: unknown[]) => isOrgFeatureEnabled(...args),
}));

const getDirectory = vi.fn();
vi.mock("@/lib/directory", () => ({
  getDirectory: (...args: unknown[]) => getDirectory(...args),
  DIRECTORY_STATUSES: ["active", "baptized", "affiliate", "other_participant"],
}));

const listVisitors = vi.fn();
const listStaff = vi.fn();
const listFormerParticipants = vi.fn();
const getCommunityBadges = vi.fn();
vi.mock("@/lib/community", () => ({
  listVisitors: (...args: unknown[]) => listVisitors(...args),
  listStaff: (...args: unknown[]) => listStaff(...args),
  listFormerParticipants: (...args: unknown[]) => listFormerParticipants(...args),
  getCommunityBadges: (...args: unknown[]) => getCommunityBadges(...args),
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

import MembersPage from "./page";

const PAGINATION = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  isOrgFeatureEnabled.mockReset();
  getDirectory.mockReset();
  listVisitors.mockReset();
  listStaff.mockReset();
  listFormerParticipants.mockReset();
  getCommunityBadges.mockReset().mockResolvedValue({});
  hasPermission.mockReset();
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

function makeSearchParams(
  overrides: { search?: string; view?: string; page?: string } = {},
) {
  return Promise.resolve(overrides);
}

describe("MembersPage — gate composition (flag AND org toggle, DECISION-097)", () => {
  it("flag off, toggle never checked → renders flag-off state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
    expect(getDirectory).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("flag on but org toggle off → renders flag-off state (same copy, no leak of which axis is off)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(false);

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(isOrgFeatureEnabled).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "org_portal.members_create",
    );
    expect(getDirectory).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("flag on AND org toggle on AND permission → renders the list", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });
    hasPermission.mockResolvedValue(true);

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^community$/i })).toBeTruthy();
    // Two CTAs can legitimately render at once: the page header's own, and
    // the empty state's.
    expect(screen.getAllByRole("link", { name: /add person/i }).length).toBeGreaterThan(0);
  });
});

describe("MembersPage — getDirectory() error handling", () => {
  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(MembersPage({ params: makeParams(), searchParams: makeSearchParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockRejectedValue(new Error("connection reset"));

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });

  it("getDirectory() forbidden, no people.manage → MembersForbidden, body byte-identical, heading Community", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "forbidden" });
    hasPermission.mockResolvedValue(false);

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^community$/i })).toBeTruthy();
    expect(
      screen.getByText(
        "You don't have permission to do that at Alder Creek Presbyterian Church. If you think this is a mistake, ask your stated clerk or another administrator there.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /add person/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /community view/i })).toBeNull();
  });
});

describe("MembersPage — the degrade (DECISION-197, F172): people.manage without directory.view", () => {
  async function renderLimited(view?: string) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "forbidden" });
    listVisitors.mockResolvedValue({
      kind: "ok",
      rows: [
        {
          personId: "p-3",
          displayName: "Wren Alder",
          email: null,
          firstVisitDate: "2026-03-01",
          positions: [],
          endedOn: null,
        },
      ],
      pagination: PAGINATION,
    });
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) => key === "people.manage",
    );
    render(
      await MembersPage({ params: makeParams(), searchParams: makeSearchParams({ view }) }),
    );
  }

  it("keeps the header, Add person and the nav, and names the missing permission — regression for founding administrator cannot reach Add person (F172)", async () => {
    await renderLimited();
    expect(screen.getByRole("heading", { name: /^community$/i })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /add person/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: /community view/i })).toBeTruthy();
    expect(screen.getByText(/the directory\.view permission/i)).toBeTruthy();
    expect(screen.queryByText(/don.t have permission to do that/i)).toBeNull();
  });

  it("Visitors still works for them", async () => {
    await renderLimited("visitors");
    expect(screen.getByRole("heading", { name: "Wren Alder" })).toBeTruthy();
    expect(screen.queryByText(/the directory\.view permission/i)).toBeNull();
  });
});

describe("MembersPage — the six views", () => {
  async function run(view?: string, perms: Record<string, boolean> = { "people.manage": true }) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [], pagination: PAGINATION });
    const empty = { kind: "ok", rows: [], pagination: PAGINATION };
    listVisitors.mockResolvedValue(empty);
    listStaff.mockResolvedValue(empty);
    listFormerParticipants.mockResolvedValue(empty);
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) => perms[key] === true,
    );
    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams({ view }) });
    render(el);
  }

  it("Everyone reads the Directory with no status filter", async () => {
    await run();
    const opts = getDirectory.mock.calls[0][2];
    expect(opts.status).toBeUndefined();
    expect(opts.rollStatuses).toBeUndefined();
    expect(listVisitors).not.toHaveBeenCalled();
  });

  it("Members is active, baptized and affiliate", async () => {
    await run("members");
    expect(getDirectory.mock.calls[0][2].rollStatuses).toEqual(["active", "baptized", "affiliate"]);
  });

  it("Participants is the other_participant status", async () => {
    await run("participants");
    expect(getDirectory.mock.calls[0][2].status).toBe("other_participant");
  });

  it.each([
    ["visitors", () => listVisitors, /no visitors yet/i],
    ["staff", () => listStaff, /no one holds a staff position yet/i],
    ["former", () => listFormerParticipants, /no former participants/i],
  ] as const)("%s reads its admin list, never the Directory", async (view, fn, empty) => {
    await run(view);
    expect(fn()).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ page: 1, pageSize: 25 }),
    );
    expect(getDirectory).not.toHaveBeenCalled();
    expect(screen.getByText(empty)).toBeTruthy();
  });

  it.each(["visitors", "staff", "former"])(
    "%s without people.manage is the unchanged forbidden state and reads nothing",
    async (view) => {
      await run(view, { "directory.view": true });
      expect(listVisitors).not.toHaveBeenCalled();
      expect(listStaff).not.toHaveBeenCalled();
      expect(listFormerParticipants).not.toHaveBeenCalled();
      expect(getDirectory).not.toHaveBeenCalled();
      expect(screen.getByText(/don.t have permission to do that at/i)).toBeTruthy();
    },
  );

  it("an unknown view falls back to Everyone", async () => {
    await run("nonsense");
    expect(getDirectory).toHaveBeenCalled();
  });

  it("asks for badges only for a people.manage holder, for the rendered ids", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({
      kind: "ok",
      entries: [
        {
          personId: "p-1",
          firstName: "Nora",
          lastName: "Ashgrove",
          preferredName: null,
          email: null,
        },
      ],
      pagination: PAGINATION,
    });
    getCommunityBadges.mockResolvedValue({ "p-1": "participant" });
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) => key === "people.manage",
    );
    render(await MembersPage({ params: makeParams(), searchParams: makeSearchParams() }));
    expect(getCommunityBadges).toHaveBeenCalledWith("person-1", "org-1", ["p-1"]);
    expect(screen.getByText("Participant")).toBeTruthy();

    cleanup();
    getCommunityBadges.mockClear();
    hasPermission.mockResolvedValue(false);
    render(await MembersPage({ params: makeParams(), searchParams: makeSearchParams() }));
    expect(getCommunityBadges).not.toHaveBeenCalled();
  });

  it("the nav shows the admin views only to a people.manage holder", async () => {
    await run(undefined, { "directory.view": true });
    expect(screen.queryByRole("link", { name: "Visitors" })).toBeNull();
    cleanup();
    await run(undefined, { "people.manage": true });
    expect(screen.getByRole("link", { name: "Visitors" })).toBeTruthy();
  });

  it("the Staff empty state links to the Staff page only with the flag and staff.manage", async () => {
    isFlagEnabled.mockReset();
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isOrgFeatureEnabled.mockResolvedValue(true);
    isFlagEnabled.mockImplementation(async (key: string) => key !== "org_portal.children_ministry");
    listStaff.mockResolvedValue({ kind: "ok", rows: [], pagination: PAGINATION });
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) =>
        key === "people.manage" || key === "staff.manage",
    );
    render(await MembersPage({ params: makeParams(), searchParams: makeSearchParams({ view: "staff" }) }));
    expect(screen.getByRole("link", { name: /staff page/i })).toBeTruthy();

    cleanup();
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) => key === "people.manage",
    );
    render(await MembersPage({ params: makeParams(), searchParams: makeSearchParams({ view: "staff" }) }));
    expect(screen.queryByRole("link", { name: /staff page/i })).toBeNull();
  });
});

describe("MembersPage — 'Add person' CTA gated on people.manage", () => {
  it("hides the CTA when the viewer lacks people.manage, even though the list renders", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });
    hasPermission.mockResolvedValue(false);

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(screen.queryAllByRole("link", { name: /add person/i })).toHaveLength(0);
  });
});

describe("MembersPage — 'Children's roster' link (docs/work-log/2026-08-26-childrens-ministry.md)", () => {
  /** `isFlagEnabled` gates TWO keys on this page now
   * (`org_portal.members_create`, `org_portal.children_ministry`) — keyed
   * by argument, same discrimination `edit/page.test.tsx`'s `mockFlags`
   * already applies, so a test targeting one flag doesn't accidentally
   * exercise the other. */
  function mockFlagsKeyed({
    membersCreate,
    childrenMinistry,
  }: {
    membersCreate: boolean;
    childrenMinistry: boolean;
  }) {
    isFlagEnabled.mockImplementation(async (key: string) => {
      if (key === "org_portal.members_create") return membersCreate;
      if (key === "org_portal.children_ministry") return childrenMinistry;
      return false;
    });
  }

  /** `hasPermission` is called with TWO different keys on this page now
   * (`people.manage`, `children.roster`) — keyed by third argument. */
  function mockPermissions({
    peopleManage,
    childrenRoster,
  }: {
    peopleManage: boolean;
    childrenRoster: boolean;
  }) {
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) => {
        if (key === "people.manage") return peopleManage;
        if (key === "children.roster") return childrenRoster;
        return false;
      },
    );
  }

  it("children-ministry flag off → link absent, children.roster never checked", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsKeyed({ membersCreate: true, childrenMinistry: false });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });
    mockPermissions({ peopleManage: true, childrenRoster: true });

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(hasPermission).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "children.roster",
    );
    expect(screen.queryByRole("link", { name: /children.s roster/i })).toBeNull();
  });

  it("children-ministry flag on but viewer lacks children.roster → link absent", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsKeyed({ membersCreate: true, childrenMinistry: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });
    mockPermissions({ peopleManage: true, childrenRoster: false });

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(screen.queryByRole("link", { name: /children.s roster/i })).toBeNull();
  });

  it("children-ministry flag on AND viewer holds children.roster → link renders, pointing at /admin/community/children", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsKeyed({ membersCreate: true, childrenMinistry: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });
    mockPermissions({ peopleManage: false, childrenRoster: true });

    const el = await MembersPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    const link = screen.getByRole("link", { name: /children.s roster/i });
    expect(link.getAttribute("href")).toBe(
      "/o/alder-creek/admin/community/children",
    );
  });
});

describe("MembersPage — the shared four-way miss response", () => {
  it("redirects to /signin when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(MembersPage({ params: makeParams(), searchParams: makeSearchParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fcommunity",
    );
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(MembersPage({ params: makeParams(), searchParams: makeSearchParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});

describe("MembersPage — reuses getDirectory(), no bespoke reader", () => {
  it("the page's own source imports getDirectory from @/lib/directory", () => {
    const source = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");
    expect(source).toMatch(/getDirectory/);
    expect(source).toMatch(/@\/lib\/directory/);
  });
});

describe("MembersPage — Increment 5: searchParams parsing (search/view/page)", () => {
  async function run(overrides: {
    search?: string;
    view?: string;
    page?: string;
  }) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });
    hasPermission.mockResolvedValue(true);
    await MembersPage({
      params: makeParams(),
      searchParams: makeSearchParams(overrides),
    });
  }

  it("passes a trimmed search string through to getDirectory()", async () => {
    await run({ search: "  Nora  " });
    expect(getDirectory).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ search: "Nora" }),
    );
  });

  it("defaults to page 1 when page is missing", async () => {
    await run({});
    expect(getDirectory).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ page: 1, pageSize: 25 }),
    );
  });

  it("defaults to page 1 for a non-numeric or zero/negative page value", async () => {
    await run({ page: "not-a-number" });
    expect(getDirectory).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ page: 1 }),
    );

    getDirectory.mockClear();
    await run({ page: "0" });
    expect(getDirectory).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ page: 1 }),
    );
  });

  it("parses a valid page number", async () => {
    await run({ page: "3" });
    expect(getDirectory).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ page: 3 }),
    );
  });
});
