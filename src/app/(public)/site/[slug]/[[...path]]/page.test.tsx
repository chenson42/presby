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
 *      `currentPath`) also calls `notFound()` — NEVER the presbytery
 *      fallback below, even for a presbytery org: a site that exists but
 *      has no matching sub-path is a real 404, not a "never published"
 *      case.
 *   3. On the ok path, `renderSiteBundle()` receives exactly what
 *      `getPublishedSite()` returned — `pages`, `brand`, and an `imageUrl`
 *      closure built from `imageKeys` — never a placeholder.
 *   4. DECISION-121 — on the `not_found` branch ONLY, a presbytery/synod/
 *      general_assembly org renders `PresbyteryFallback` instead of the
 *      404; a congregation (or a truly nonexistent slug) keeps the
 *      untouched `notFound()` collapse. The org-type matrix this pins:
 *      congregation → 404 unchanged, presbytery → fallback, nonexistent →
 *      404.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getPublishedSite = vi.fn();
vi.mock("@/lib/sites", () => ({
  getPublishedSite: (...args: unknown[]) => getPublishedSite(...args),
}));

const publicOrgSummary = vi.fn();
vi.mock("@/lib/authz", () => ({
  publicOrgSummary: (...args: unknown[]) => publicOrgSummary(...args),
}));

const renderSiteBundle = vi.fn();
const buildPageMetadata = vi.fn();
vi.mock("presby-site-kit", () => ({
  renderSiteBundle: (...args: unknown[]) => renderSiteBundle(...args),
  buildPageMetadata: (...args: unknown[]) => buildPageMetadata(...args),
}));

vi.mock("../actions", () => ({
  submitContactMessageAction: vi.fn(),
}));

// resolveLogoUrl()'s dynamically-imported getPlatformDb() chain — mocked
// the same way @/lib/sites is mocked above, and for the identical reason:
// @/lib/db's module-scope pool construction throws outside a real
// DATABASE_URL. Resolves to "no brand row" (empty array) by default; the
// logo-specific test below overrides this per-case.
const orgBrandsSelectMock = vi.fn(() => Promise.resolve([] as { markAssetKey: string | null }[]));
vi.mock("@/lib/db", () => ({
  getPlatformDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => orgBrandsSelectMock(),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/db/domain/org", () => ({ organizationBrands: {} }));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

import PublicSitePage, { generateMetadata } from "./page";
import { PublicStaffDirectory } from "../staff-directory";
import { PublicCommitteeDirectory } from "../committee-directory";

afterEach(() => {
  cleanup();
  getPublishedSite.mockReset();
  publicOrgSummary.mockReset();
  publicOrgSummary.mockResolvedValue(null);
  renderSiteBundle.mockReset();
  buildPageMetadata.mockReset();
  notFoundMock.mockClear();
  orgBrandsSelectMock.mockReset();
  orgBrandsSelectMock.mockImplementation(() => Promise.resolve([]));
});

function makeParams(slug = "alder-creek", path?: string[]) {
  return Promise.resolve({ slug, path });
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
  profile: {
    address: null,
    phone: null,
    social: {
      facebook: null,
      instagram: null,
      xTwitter: null,
      youtube: null,
      other: null,
    },
  },
  serviceTimes: [],
  officeHours: [],
};

describe("PublicSitePage — the enumeration-safe not_found collapse", () => {
  it("calls notFound() when getPublishedSite() returns not_found and the slug resolves to nothing (a truly nonexistent org)", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue(null);

    await expect(
      PublicSitePage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(renderSiteBundle).not.toHaveBeenCalled();
  });

  it("calls notFound() when getPublishedSite() returns not_found and the slug is a CONGREGATION — the fallback never applies to it", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "Alder Creek Presbyterian Church",
      organizationType: "congregation",
    });

    await expect(
      PublicSitePage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("calls notFound() when renderSiteBundle() returns null (no matching page) — never the presbytery fallback, even for a presbytery org", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(null);

    await expect(
      PublicSitePage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(publicOrgSummary).not.toHaveBeenCalled();
  });
});

describe("PublicSitePage — DECISION-121, the presbytery/synod/GA fallback", () => {
  it("renders PresbyteryFallback (org name + sign-in link) when the not_found slug resolves to a presbytery", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "Presbytery of the Northern Reach",
      organizationType: "presbytery",
    });

    const el = await PublicSitePage({ params: makeParams("northern-reach") });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Presbytery of the Northern Reach" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /sign in to the portal/i });
    expect(link.getAttribute("href")).toBe("/o/northern-reach");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("renders the same fallback for a synod", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "Synod of the Wide Plains",
      organizationType: "synod",
    });

    const el = await PublicSitePage({ params: makeParams("wide-plains-synod") });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Synod of the Wide Plains" }),
    ).toBeTruthy();
  });

  it("renders the same fallback for the General Assembly", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "General Assembly",
      organizationType: "general_assembly",
    });

    const el = await PublicSitePage({ params: makeParams("ga") });
    render(el);

    expect(screen.getByRole("heading", { name: "General Assembly" })).toBeTruthy();
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
        organizationName: SITE.organizationName,
        origin: "http://localhost:3000",
        pages: SITE.pages,
        currentPath: "/",
        brand: SITE.brand,
        imageUrl: expect.any(Function),
        pageUrl: expect.any(Function),
        portalUrl: "/o/alder-creek",
        portalNavGroup: "Connect",
        portalLabel: "Our Directory",
      }),
    );
  });

  it("points portalUrl at /o/<slug>, unaffected by which sub-page is being rendered", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek", ["about"]) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ portalUrl: "/o/alder-creek" }),
    );
  });

  it("derives currentPath from the catch-all path segments — a sub-page, not just the root", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek", ["about"]) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ currentPath: "/about" }),
    );
  });

  it("joins multiple path segments with a leading slash for a nested sub-page", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek", ["ministries", "food-pantry"]) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ currentPath: "/ministries/food-pantry" }),
    );
  });

  it("an empty path array (not undefined) still resolves to the root, not an empty string", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek", []) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ currentPath: "/" }),
    );
  });

  it("builds pageUrl() as a same-origin /site/<slug>/<path> link, root path collapsing to no trailing path", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      pageUrl: (path: string) => string;
    };
    expect(call.pageUrl("/")).toBe("/site/alder-creek");
    expect(call.pageUrl("/about")).toBe("/site/alder-creek/about");
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

  it("resolves logoUrl through the same generic asset route when the org has a brand mark", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);
    orgBrandsSelectMock.mockResolvedValue([{ markAssetKey: "mark-blob-key" }]);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as { logoUrl: string | null };
    expect(call.logoUrl).toBe("/site/alder-creek/assets/mark-blob-key");
  });

  it("passes logoUrl as null when the org has no brand row or no mark set — never a broken image", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);
    orgBrandsSelectMock.mockResolvedValue([]);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as { logoUrl: string | null };
    expect(call.logoUrl).toBeNull();
  });

  it("translates PublishedSite.profile.social's keyed object into site-kit's socialLinks array, omitting unset platforms", async () => {
    getPublishedSite.mockResolvedValue({
      kind: "ok",
      site: {
        ...SITE,
        profile: {
          address: "123 Fixture Ln",
          phone: "555-0100",
          social: {
            facebook: "https://facebook.com/fixture",
            instagram: null,
            xTwitter: null,
            youtube: "https://youtube.com/fixture",
            other: null,
          },
        },
        serviceTimes: [
          { dayOfWeek: 0, startTime: "10:15", endTime: "11:15", label: "Sunday Worship" },
        ],
        officeHours: [],
      },
    });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams() });

    const call = renderSiteBundle.mock.calls[0][0] as {
      profile: {
        address: string | null;
        phone: string | null;
        socialLinks: { platform: string; url: string }[];
        serviceTimes: unknown[];
        officeHours: unknown[];
      };
    };
    expect(call.profile.address).toBe("123 Fixture Ln");
    expect(call.profile.phone).toBe("555-0100");
    // Only the two set platforms appear, in the fixed platform order — never
    // a null/undefined entry for facebook/instagram/xTwitter/youtube/other.
    expect(call.profile.socialLinks).toEqual([
      { platform: "facebook", url: "https://facebook.com/fixture" },
      { platform: "youtube", url: "https://youtube.com/fixture" },
    ]);
    expect(call.profile.serviceTimes).toEqual([
      { dayOfWeek: 0, startTime: "10:15", endTime: "11:15", label: "Sunday Worship" },
    ]);
    expect(call.profile.officeHours).toEqual([]);
  });

  it("passes an all-null/empty profile through unchanged when nothing is set — never omitted, never thrown", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams() });

    const call = renderSiteBundle.mock.calls[0][0] as {
      profile: { address: string | null; socialLinks: unknown[] };
    };
    expect(call.profile.address).toBeNull();
    expect(call.profile.socialLinks).toEqual([]);
  });

  it("returns the site-kit output alone — no page-level chrome bolted around it", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<h1>Welcome page content</h1>);

    const el = await PublicSitePage({ params: makeParams() });
    const { container } = render(<>{el}</>);

    expect(screen.getByText("Welcome page content")).toBeTruthy();
    // The contact form no longer renders on every page below the bundle —
    // it rides site-kit's own contactForm block now (next test). Nothing
    // else may wrap or trail the bundle's own output.
    expect(container.textContent).toBe("Welcome page content");
  });

  it("passes the interactive ContactForm element into renderSiteBundle() for the contactForm block to place", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams() });

    const call = renderSiteBundle.mock.calls[0][0] as { contactForm?: unknown };
    expect(call.contactForm).toBeTruthy();
  });

  it("passes a liveSlots.staffDirectory RESOLVER FUNCTION into renderSiteBundle() for a {\"type\":\"liveSlot\"} block to place — presby-site-kit v4.0.0 made liveSlots values functions, not elements (docs/work-log/2026-08-28-public-directory-primitives.md)", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots?: Record<string, (filter: Record<string, unknown>) => unknown>;
    };
    expect(typeof call.liveSlots?.staffDirectory).toBe("function");

    // A truthy-function check alone would still pass even if the resolver
    // ignored its own `filter` argument or closed over the wrong slug — this
    // asserts on the RESOLVED OUTPUT of actually CALLING the closure: it
    // must be a real <PublicStaffDirectory> element built from exactly the
    // `filter` object this call passed in and this page's own `slug`, not
    // merely "some truthy value."
    const suppliedFilter = { kind: "officer", hasPriority: true };
    const resolved = call.liveSlots?.staffDirectory?.(suppliedFilter) as {
      type: unknown;
      props: { slug: string; filter: unknown };
    };
    expect(resolved.type).toBe(PublicStaffDirectory);
    expect(resolved.props).toEqual({ slug: "alder-creek", filter: suppliedFilter });
  });

  it("passes a liveSlots.committeeDirectory resolver function into renderSiteBundle() alongside staffDirectory, resolving to a real <PublicCommitteeDirectory> element built from that call's own filter (docs/work-log/2026-08-28-public-directory-primitives.md)", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots?: Record<string, (filter: Record<string, unknown>) => unknown>;
    };
    expect(typeof call.liveSlots?.committeeDirectory).toBe("function");

    const suppliedFilter = { committee: "Missions Committee" };
    const resolved = call.liveSlots?.committeeDirectory?.(suppliedFilter) as {
      type: unknown;
      props: { slug: string; filter: unknown };
    };
    expect(resolved.type).toBe(PublicCommitteeDirectory);
    expect(resolved.props).toEqual({ slug: "alder-creek", filter: suppliedFilter });
  });

  it("a marker with no filter still resolves staffDirectory to {} — reproducing the shipped feature's exact unfiltered behavior with no content-repo migration required", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots?: Record<string, (filter: Record<string, unknown>) => unknown>;
    };
    const resolved = call.liveSlots?.staffDirectory?.({}) as {
      props: { filter: unknown };
    };
    expect(resolved.props.filter).toEqual({});
  });

  it("exposes exactly staffDirectory and committeeDirectory — no other named slot", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await PublicSitePage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots?: Record<string, unknown>;
    };
    expect(Object.keys(call.liveSlots ?? {}).sort()).toEqual([
      "committeeDirectory",
      "staffDirectory",
    ]);
  });
});

describe("generateMetadata", () => {
  it("returns {} (no title override) when the site is not_found — never a distinguishable error page title", async () => {
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    const meta = await generateMetadata({ params: makeParams() });
    expect(meta).toEqual({});
    expect(buildPageMetadata).not.toHaveBeenCalled();
  });

  it("passes organizationName, origin, pages, currentPath, pageUrl, and the resolved logoUrl to buildPageMetadata()", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    buildPageMetadata.mockReturnValue({
      title: "Welcome",
      description: undefined,
      canonicalUrl: "http://localhost:3000/site/alder-creek",
      openGraph: { type: "website", title: "Welcome", url: "x", siteName: "x", images: [] },
      twitter: { card: "summary", title: "Welcome", description: undefined },
      robots: { index: true, follow: true },
    });
    orgBrandsSelectMock.mockResolvedValue([{ markAssetKey: "mark-blob-key" }]);

    await generateMetadata({ params: makeParams("alder-creek", ["about"]) });

    expect(buildPageMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationName: SITE.organizationName,
        origin: "http://localhost:3000",
        pages: SITE.pages,
        currentPath: "/about",
        pageUrl: expect.any(Function),
        logoUrl: "/site/alder-creek/assets/mark-blob-key",
      }),
    );
  });

  it("translates buildPageMetadata()'s result into Next's Metadata shape, with an absolute title that bypasses the root layout's own template", async () => {
    getPublishedSite.mockResolvedValue({ kind: "ok", site: SITE });
    buildPageMetadata.mockReturnValue({
      title: "Worship — Alder Creek Presbyterian Church",
      description: "Join us Sundays.",
      canonicalUrl: "http://localhost:3000/site/alder-creek/worship",
      openGraph: {
        type: "website",
        title: "Worship — Alder Creek Presbyterian Church",
        description: "Join us Sundays.",
        url: "http://localhost:3000/site/alder-creek/worship",
        siteName: "Alder Creek Presbyterian Church",
        images: [],
      },
      twitter: {
        card: "summary",
        title: "Worship — Alder Creek Presbyterian Church",
        description: "Join us Sundays.",
      },
      robots: { index: true, follow: true },
    });

    const meta = await generateMetadata({ params: makeParams("alder-creek", ["worship"]) });

    expect(meta.title).toEqual({ absolute: "Worship — Alder Creek Presbyterian Church" });
    expect(meta.description).toBe("Join us Sundays.");
    expect(meta.alternates).toEqual({ canonical: "http://localhost:3000/site/alder-creek/worship" });
    expect(meta.robots).toEqual({ index: true, follow: true });
  });
});
