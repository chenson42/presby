// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin`'s page.tsx — portal-reorg
 * pipeline (docs/work-log/2026-08-26-portal-reorg-and-modernization.md,
 * Phase 3/4), mirroring `admin/features/page.test.tsx`'s assertion style.
 * Pins:
 *
 *   1. `isFlagEnabled("org_portal.admin_hub")` is checked BEFORE
 *      `visiblePortalTiles()` is ever called — flag-off renders
 *      `AdminHubFlagOff` without reading the tile registry at all.
 *   2. Flag-on calls `visiblePortalTiles("administer")` (never "operate") and
 *      renders the returned tiles in a `TileGrid`.
 *   3. THE NON-NEGOTIABLE ACCEPTANCE CRITERION (named by both Phase 2 and
 *      Phase 3): the hub performs NO permission check of any kind — a
 *      viewer with zero tenant permissions still sees every flag-enabled
 *      "administer" tile. This file proves it two ways: a source scan (the
 *      page never imports or calls any permission-resolving function) and a
 *      rendering assertion (every tile `visiblePortalTiles()` returns is
 *      rendered as a link, with no filtering step in between).
 *   4. Zero visible administer tiles (hub flag on, every tile's own flag
 *      off) renders the "Nothing is turned on here yet" fallback rather than
 *      a bare heading.
 *   5. The shared four-way-miss response (not-found/forbidden/ended/
 *      unauthenticated) is unchanged from every other `(org)/admin/*` page.
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

const visiblePortalTiles = vi.fn();
vi.mock("@/lib/org-portal/tiles", () => ({
  visiblePortalTiles: (category: string) => visiblePortalTiles(category),
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

import AdminHubPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  visiblePortalTiles.mockReset();
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

const ADMINISTER_TILES = [
  {
    key: "members",
    label: "Members",
    description: "Add a person and record roll actions.",
    href: (slug: string) => `/o/${slug}/admin/members`,
    flagKey: "org_portal.members_create",
    category: "administer" as const,
  },
  {
    key: "roles",
    label: "Roles",
    description: "Manage roles and permissions for this organization.",
    href: (slug: string) => `/o/${slug}/admin/roles`,
    flagKey: "org_portal.roles",
    category: "administer" as const,
  },
  {
    key: "officers",
    label: "Officers",
    description: "Record officer terms and view the session/diaconate roster.",
    href: (slug: string) => `/o/${slug}/admin/officers`,
    flagKey: "org_portal.officers",
    category: "administer" as const,
  },
  {
    key: "features",
    label: "Features",
    description:
      "Turn optional portal features on or off for this organization.",
    href: (slug: string) => `/o/${slug}/admin/features`,
    flagKey: "org_portal.features",
    category: "administer" as const,
  },
];

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

describe("AdminHubPage — the flag-before-registry ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling visiblePortalTiles()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await AdminHubPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.admin_hub");
    expect(visiblePortalTiles).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t turned on for Alder Creek/i),
    ).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await AdminHubPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });

  it("calls visiblePortalTiles with the 'administer' category, never 'operate'", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    visiblePortalTiles.mockResolvedValue([]);

    await AdminHubPage({ params: makeParams() });

    expect(visiblePortalTiles).toHaveBeenCalledWith("administer");
  });
});

describe("AdminHubPage — non-negotiable acceptance criterion: no permission pre-filter", () => {
  it("the page's own source performs no permission check of any kind — only the flag check", () => {
    // Strip block comments before scanning: this file's own header
    // deliberately NAMES the permission keys it must never check (as a "do
    // not add this" warning), which would otherwise false-positive against
    // a naive substring scan of the raw source.
    const rawSource = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "");
    // No permission-resolving helper is imported or called anywhere in this
    // file's executable code. `assertOrgAccess` is membership re-validation
    // (the same call every `(org)` page makes, not a per-tile grant check)
    // and is exempted explicitly.
    expect(source).not.toMatch(/hasFeature\(/);
    expect(source).not.toMatch(/hasPermission\(/);
    expect(source).not.toMatch(/presby_has_permission/);
    expect(source).not.toMatch(/\.manage["'`]/);
    expect(source).not.toMatch(/\.propose["'`]/);
  });

  it("a viewer with zero tenant permissions still sees every flag-enabled administer tile — Members, Roles, Officers, and Features all render as links", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    // This mock stands in for "every administer tile's own flag is on"; the
    // page never consults the viewer's own grants (role_grants.manage,
    // officers.manage, org_features.manage, people.manage) to decide which
    // of these to render — the destination pages are the sole authority.
    visiblePortalTiles.mockResolvedValue(ADMINISTER_TILES);

    const el = await AdminHubPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("link", { name: /members/i }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/members",
    );
    expect(screen.getByRole("link", { name: /^roles/i }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/roles",
    );
    expect(
      screen.getByRole("link", { name: /officers/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/officers");
    expect(
      screen.getByRole("link", { name: /^features/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/features");
  });

  it("renders exactly what visiblePortalTiles() returns — no client-side filtering step reduces the set", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    visiblePortalTiles.mockResolvedValue([ADMINISTER_TILES[0]]);

    const el = await AdminHubPage({ params: makeParams() });
    render(el);

    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("AdminHubPage — empty hub", () => {
  it("renders 'Nothing is turned on here yet' when the hub flag is on but every administer tile's own flag is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    visiblePortalTiles.mockResolvedValue([]);

    const el = await AdminHubPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/nothing is turned on here yet/i)).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("AdminHubPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to /admin when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(AdminHubPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(AdminHubPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("renders OrgAccessDenied for a forbidden (no relationship) resolution", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await AdminHubPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have access to Bramblewood/i),
    ).toBeTruthy();
  });

  it("renders OrgAccessEnded for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Bramblewood Presbyterian Church",
      endedOn: "2026-01-01",
    });

    const el = await AdminHubPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/access to Bramblewood Presbyterian Church has ended/i),
    ).toBeTruthy();
  });
});
