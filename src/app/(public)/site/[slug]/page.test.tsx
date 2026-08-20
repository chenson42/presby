// @vitest-environment jsdom
/**
 * Orchestration tests for `/site/<slug>`'s page.tsx. What this file exists
 * to pin:
 *
 *   1. `{ kind: "not_found" }` from `getPublishedSite()` calls Next's real
 *      `notFound()` — this is the SAME response for a never-provisioned
 *      site, a suspended one, a nonexistent slug, the render flag off, and
 *      a corrupt bundle (Phase 1 Gap 5's enumeration-safety collapse); this
 *      page never re-derives which one it got, it only branches on `kind`.
 *   2. `renderSiteBundle()` returning `null` (no page in the bundle matches
 *      `currentPath`) also calls `notFound()`.
 *   3. On the ok path, `renderSiteBundle()` receives exactly what
 *      `getPublishedSite()` returned — `pages`, `brand`, and an `imageUrl`
 *      closure built from `imageKeys` — never a placeholder.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getPublishedSite = vi.fn();
vi.mock("@/lib/sites", () => ({
  getPublishedSite: (...args: unknown[]) => getPublishedSite(...args),
}));

const renderSiteBundle = vi.fn();
vi.mock("presby-site-kit", () => ({
  renderSiteBundle: (...args: unknown[]) => renderSiteBundle(...args),
}));

vi.mock("./actions", () => ({
  submitContactMessageAction: vi.fn(),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

import PublicSitePage from "./page";

afterEach(() => {
  cleanup();
  getPublishedSite.mockReset();
  renderSiteBundle.mockReset();
  notFoundMock.mockClear();
});

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

const BRAND = {
  tokens: { light: {}, dark: {}, version: 1 },
  fontPairing: { bodyClassName: "font-body", headingClassName: "font-heading" },
};

const SITE = {
  organizationId: "org-1",
  organizationName: "Alder Creek Presbyterian Church",
  organizationType: "congregation",
  brand: BRAND,
  pages: [{ path: "/", frontMatter: { title: "Welcome" }, mdxAst: null }],
  imageKeys: { hero: "blob-key-1" },
};

describe("PublicSitePage — the enumeration-safe not_found collapse", () => {
  it("calls notFound() when getPublishedSite() returns not_found", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });

    await expect(
      PublicSitePage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(renderSiteBundle).not.toHaveBeenCalled();
  });

  it("calls notFound() when renderSiteBundle() returns null (no matching page)", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(null);

    await expect(
      PublicSitePage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("PublicSitePage — the ok path", () => {
  it("passes getPublishedSite()'s own pages, brand, and currentPath to renderSiteBundle() — never a placeholder", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<h1>Welcome</h1>);

    const el = await PublicSitePage({ params: makeParams() });
    render(el);

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        pages: SITE.pages,
        currentPath: "/",
        brand: SITE.brand,
        imageUrl: expect.any(Function),
      }),
    );
  });

  it("builds imageUrl() from the site's own imageKeys map, resolving through this route's asset route", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      imageUrl: (key: string) => string;
    };
    expect(call.imageUrl("hero")).toBe(
      "/site/alder-creek/assets/blob-key-1",
    );
    // An unmapped manifestKey falls back to itself rather than throwing —
    // the asset route then fails to resolve it as a blob id (a broken
    // image, never a crash).
    expect(call.imageUrl("missing")).toBe(
      "/site/alder-creek/assets/missing",
    );
  });

  it("renders the site-kit output plus a Contact section naming the organization", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<h1>Welcome page content</h1>);

    const el = await PublicSitePage({ params: makeParams() });
    render(el);

    expect(screen.getByText("Welcome page content")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: /contact alder creek presbyterian church/i,
      }),
    ).toBeTruthy();
  });
});
