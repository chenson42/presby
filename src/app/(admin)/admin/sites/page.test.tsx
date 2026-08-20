// @vitest-environment jsdom
/**
 * Orchestration tests for `/admin/sites` — the cross-org public-site health
 * list. Mocked at the `@/lib/sites` boundary (this page's only query),
 * mirroring `admin/tickets/page.test.tsx`'s db-mock shape but simpler since
 * this page never touches `getPlatformDb()` directly.
 *
 * What this pins:
 *   1. `FEATURES.ADMIN_ORGANIZATIONS` gate — missing the feature renders a
 *      denial, no query ever runs.
 *   2. The empty state (real copy, not a blank screen).
 *   3. A populated row links to the organization's detail page and shows
 *      its status, repo, and last-ingested/provisioned-since dates.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const listSitesForAdmin = vi.fn();
vi.mock("@/lib/sites", () => ({
  listSitesForAdmin: (...args: unknown[]) => listSitesForAdmin(...args),
}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

import AdminSitesPage from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  listSitesForAdmin.mockReset();
});

const OPERATOR_SESSION = {
  user: { id: "operator-1", features: ["admin.organizations"] },
};

describe("AdminSitesPage — feature gate", () => {
  it("renders a denial, never running the query, when the session lacks admin.organizations", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", features: [] } });

    const el = await AdminSitesPage();
    render(el);

    expect(
      screen.getByText(/don.t have permission to view organization sites/i),
    ).toBeTruthy();
    expect(listSitesForAdmin).not.toHaveBeenCalled();
  });
});

describe("AdminSitesPage — empty state", () => {
  it("renders real copy, not a blank screen, when no sites are provisioned", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    listSitesForAdmin.mockResolvedValue([]);

    const el = await AdminSitesPage();
    render(el);

    expect(screen.getByText(/no sites provisioned yet/i)).toBeTruthy();
  });
});

describe("AdminSitesPage — populated", () => {
  it("renders a row per site, linking to the organization's detail page", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    listSitesForAdmin.mockResolvedValue([
      {
        organizationId: "org-1",
        organizationName: "Alder Creek Presbyterian Church",
        slug: "alder-creek",
        repo: "presby-churches/site-alder-creek",
        status: "live",
        lastIngestedAt: "2026-08-19T10:00:00Z",
        createdAt: "2026-08-01T00:00:00Z",
      },
    ]);

    const el = await AdminSitesPage();
    render(el);

    const link = screen.getByRole("link", {
      name: /alder creek presbyterian church/i,
    });
    expect(link.getAttribute("href")).toBe("/admin/organizations/org-1");
    expect(screen.getByText("presby-churches/site-alder-creek")).toBeTruthy();
    expect(screen.getByText("live")).toBeTruthy();
  });

  it("renders 'Never' for a provisioned site with no ingest yet", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    listSitesForAdmin.mockResolvedValue([
      {
        organizationId: "org-2",
        organizationName: "Bramblewood Presbyterian Church",
        slug: "bramblewood",
        repo: "presby-churches/site-bramblewood",
        status: "provisioning",
        lastIngestedAt: null,
        createdAt: "2026-08-20T00:00:00Z",
      },
    ]);

    const el = await AdminSitesPage();
    render(el);

    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.getByText("provisioning")).toBeTruthy();
  });
});
