// @vitest-environment jsdom
/**
 * Orchestration tests for `/site/<key>`'s page.tsx. What this file exists
 * to pin:
 *
 *   0. (Track F) the route segment is a SITE KEY: `resolveSite(key)` decides, the
 *      slug the DATABASE returned drives every slug-keyed read, and a resolved
 *      `redirectHost` is a 307 (never rendered) with path and query kept.
 *   1. `{ kind: "not_found" }` from `resolveSite()` calls Next's real
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
 *      `resolveSite()` returned — `pages`, `brand`, and an `imageUrl`
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

const resolveSite = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolveSite: (...args: unknown[]) => resolveSite(...args),
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

// The `giving` slot imports the give action and the public-config reader (both
// server-only, database-backed); neither runs in this orchestration test.
vi.mock("../give/actions", () => ({ createPublicGiveSessionAction: vi.fn() }));
vi.mock("@/lib/giving/public-config", () => ({ readPublicGivingConfig: vi.fn() }));

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
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (url: string) => redirectMock(url),
}));

import { buildSiteUrls } from "@/lib/site-urls";
import PublicSitePage, { generateMetadata } from "./page";
import { PublicStaffDirectory } from "../staff-directory";
import { PublicCommitteeDirectory } from "../committee-directory";
import { PublicGivingSlot } from "../public-giving-slot";

afterEach(() => {
  cleanup();
  resolveSite.mockReset();
  redirectMock.mockClear();
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

/** The page also takes `searchParams` (to keep the query on a 307); most tests have none. */
function renderPage(args: { params: ReturnType<typeof makeParams>; searchParams?: Record<string, string | string[] | undefined> }) {
  return PublicSitePage({ params: args.params, searchParams: Promise.resolve(args.searchParams ?? {}) });
}

type LegacyResult =
  | { kind: "ok"; site: unknown }
  | { kind: "not_found"; reason?: "absent" | "read_failed" };

/**
 * Stubs `resolveSite()` for SLUG MODE from the result shape these tests were written against:
 * the mock answers by the KEY it is called with, so `makeParams("northern-reach")` yields a
 * resolved site (or a miss) for slug `northern-reach`. `redirectHost` is null unless given.
 */
function mockSite(result: LegacyResult, redirectHost: string | null = null) {
  resolveSite.mockImplementation(async (key: string) => {
    if (result.kind === "not_found") {
      return { kind: "not_found", mode: "slug", slug: key, ...(result.reason ? { reason: result.reason } : {}) };
    }
    return {
      kind: "ok",
      mode: "slug",
      slug: key,
      site: result.site,
      urls: buildSiteUrls({ mode: "slug", slug: key, platformOrigin: "http://localhost:3000" }),
      redirectHost,
    };
  });
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
  it("calls notFound() when resolveSite() returns not_found and the slug resolves to nothing (a truly nonexistent org)", async () => {
    mockSite({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue(null);

    await expect(
      renderPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(renderSiteBundle).not.toHaveBeenCalled();
  });

  it("calls notFound() when resolveSite() returns not_found and the slug is a CONGREGATION — the fallback never applies to it", async () => {
    mockSite({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "Alder Creek Presbyterian Church",
      organizationType: "congregation",
    });

    await expect(
      renderPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("calls notFound() when renderSiteBundle() returns null (no matching page) — never the presbytery fallback, even for a presbytery org", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(null);

    await expect(
      renderPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(publicOrgSummary).not.toHaveBeenCalled();
  });
});

describe("PublicSitePage — reason: \"read_failed\" skips the publicOrgSummary follow-up read (docs/work-log/2026-09-26-public-render-blip.md)", () => {
  it("does not call publicOrgSummary() when resolveSite() reports a DB read failure, and still 404s", async () => {
    mockSite({
      kind: "not_found",
      reason: "read_failed",
    });

    await expect(
      renderPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(publicOrgSummary).not.toHaveBeenCalled();
  });

  it("still calls publicOrgSummary() when the not_found reason is absent (a confirmed miss, not a DB failure)", async () => {
    mockSite({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue(null);

    await expect(
      renderPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(publicOrgSummary).toHaveBeenCalledWith("alder-creek");
  });

  it("still calls publicOrgSummary() when reason is explicitly \"absent\"", async () => {
    mockSite({ kind: "not_found", reason: "absent" });
    publicOrgSummary.mockResolvedValue(null);

    await expect(
      renderPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");

    expect(publicOrgSummary).toHaveBeenCalledWith("alder-creek");
  });

  it("renders the byte-identical notFound() collapse whether the miss is a DB failure or a confirmed absence — the response never varies on `reason`", async () => {
    mockSite({
      kind: "not_found",
      reason: "read_failed",
    });
    const readFailedOutcome = await renderPage({
      params: makeParams(),
    }).catch((err: Error) => err.message);

    mockSite({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue(null);
    const absentOutcome = await renderPage({
      params: makeParams(),
    }).catch((err: Error) => err.message);

    expect(readFailedOutcome).toBe(absentOutcome);
    expect(readFailedOutcome).toBe("NOT_FOUND");
  });
});

describe("PublicSitePage — DECISION-121, the presbytery/synod/GA fallback", () => {
  it("renders PresbyteryFallback (org name + sign-in link) when the not_found slug resolves to a presbytery", async () => {
    mockSite({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "Presbytery of the Northern Reach",
      organizationType: "presbytery",
    });

    const el = await renderPage({ params: makeParams("northern-reach") });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Presbytery of the Northern Reach" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /sign in to the portal/i });
    expect(link.getAttribute("href")).toBe("/o/northern-reach");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("renders the same fallback for a synod", async () => {
    mockSite({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "Synod of the Wide Plains",
      organizationType: "synod",
    });

    const el = await renderPage({ params: makeParams("wide-plains-synod") });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Synod of the Wide Plains" }),
    ).toBeTruthy();
  });

  it("renders the same fallback for the General Assembly", async () => {
    mockSite({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({
      name: "General Assembly",
      organizationType: "general_assembly",
    });

    const el = await renderPage({ params: makeParams("ga") });
    render(el);

    expect(screen.getByRole("heading", { name: "General Assembly" })).toBeTruthy();
  });
});

describe("PublicSitePage — the ok path", () => {
  it("passes resolveSite()'s own pages, brand, and currentPath to renderSiteBundle() — never a placeholder", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<h1>Welcome</h1>);

    const el = await renderPage({ params: makeParams() });
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
        portalUrl: "http://localhost:3000/o/alder-creek",
        portalNavGroup: "Connect",
        portalLabel: "Our Portal",
      }),
    );
  });

  it("points portalUrl at /o/<slug>, unaffected by which sub-page is being rendered", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek", ["about"]) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ portalUrl: "http://localhost:3000/o/alder-creek" }),
    );
  });

  it("derives currentPath from the catch-all path segments — a sub-page, not just the root", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek", ["about"]) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ currentPath: "/about" }),
    );
  });

  it("joins multiple path segments with a leading slash for a nested sub-page", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek", ["ministries", "food-pantry"]) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ currentPath: "/ministries/food-pantry" }),
    );
  });

  it("an empty path array (not undefined) still resolves to the root, not an empty string", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek", []) });

    expect(renderSiteBundle).toHaveBeenCalledWith(
      expect.objectContaining({ currentPath: "/" }),
    );
  });

  it("builds pageUrl() as a same-origin /site/<slug>/<path> link, root path collapsing to no trailing path", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      pageUrl: (path: string) => string;
    };
    expect(call.pageUrl("/")).toBe("/site/alder-creek");
    expect(call.pageUrl("/about")).toBe("/site/alder-creek/about");
  });

  it("builds imageUrl() from the site's own imageKeys map, resolving through this route's asset route", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek") });

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
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);
    orgBrandsSelectMock.mockResolvedValue([{ markAssetKey: "mark-blob-key" }]);

    await renderPage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as { logoUrl: string | null };
    expect(call.logoUrl).toBe("/site/alder-creek/assets/mark-blob-key");
  });

  it("passes logoUrl as null when the org has no brand row or no mark set — never a broken image", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);
    orgBrandsSelectMock.mockResolvedValue([]);

    await renderPage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as { logoUrl: string | null };
    expect(call.logoUrl).toBeNull();
  });

  it("degrades to logoUrl: null (never throws) when resolveLogoUrl's own read fails mid-request — docs/work-log/2026-09-26-public-render-blip.md", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);
    orgBrandsSelectMock.mockRejectedValue(new Error("simulated DB blip"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await renderPage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as { logoUrl: string | null };
    expect(call.logoUrl).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(consoleErrorSpy.mock.calls[0]);
    expect(serialized).not.toMatch(/select|Failed query|params:/i);
    expect(serialized).toContain("alder-creek");

    consoleErrorSpy.mockRestore();
  });

  it("translates PublishedSite.profile.social's keyed object into site-kit's socialLinks array, omitting unset platforms", async () => {
    mockSite({
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

    await renderPage({ params: makeParams() });

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
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams() });

    const call = renderSiteBundle.mock.calls[0][0] as {
      profile: { address: string | null; socialLinks: unknown[] };
    };
    expect(call.profile.address).toBeNull();
    expect(call.profile.socialLinks).toEqual([]);
  });

  it("returns the site-kit output alone — no page-level chrome bolted around it", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<h1>Welcome page content</h1>);

    const el = await renderPage({ params: makeParams() });
    const { container } = render(<>{el}</>);

    expect(screen.getByText("Welcome page content")).toBeTruthy();
    // The contact form no longer renders on every page below the bundle —
    // it rides site-kit's own contactForm block now (next test). Nothing
    // else may wrap or trail the bundle's own output.
    expect(container.textContent).toBe("Welcome page content");
  });

  it("passes the interactive ContactForm element into renderSiteBundle() for the contactForm block to place", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams() });

    const call = renderSiteBundle.mock.calls[0][0] as { contactForm?: unknown };
    expect(call.contactForm).toBeTruthy();
  });

  it("passes a liveSlots.staffDirectory RESOLVER FUNCTION into renderSiteBundle() for a {\"type\":\"liveSlot\"} block to place — presby-site-kit v4.0.0 made liveSlots values functions, not elements (docs/work-log/2026-08-28-public-directory-primitives.md)", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek") });

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
    expect(resolved.props).toEqual({ slug: "alder-creek", urls: expect.objectContaining({ mode: "slug" }), filter: suppliedFilter });
  });

  it("passes a liveSlots.committeeDirectory resolver function into renderSiteBundle() alongside staffDirectory, resolving to a real <PublicCommitteeDirectory> element built from that call's own filter (docs/work-log/2026-08-28-public-directory-primitives.md)", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek") });

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
    expect(resolved.props).toEqual({ slug: "alder-creek", urls: expect.objectContaining({ mode: "slug" }), filter: suppliedFilter });
  });

  it("a marker with no filter still resolves staffDirectory to {} — reproducing the shipped feature's exact unfiltered behavior with no content-repo migration required", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots?: Record<string, (filter: Record<string, unknown>) => unknown>;
    };
    const resolved = call.liveSlots?.staffDirectory?.({}) as {
      props: { filter: unknown };
    };
    expect(resolved.props.filter).toEqual({});
  });

  it("passes a liveSlots.giving resolver that closes over the page's own slug and hands the marker's filter to <PublicGivingSlot> (docs/work-log/2026-10-15-online-giving.md, G16)", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots?: Record<string, (filter: Record<string, unknown>) => unknown>;
    };
    const suppliedFilter = { fund: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const resolved = call.liveSlots?.giving?.(suppliedFilter) as {
      type: unknown;
      props: { slug: string; filter: unknown };
    };
    expect(resolved.type).toBe(PublicGivingSlot);
    // `slug` (reads) and `siteKey` (the server-bound give action argument) are both passed.
    expect(resolved.props).toEqual({ slug: "alder-creek", siteKey: "alder-creek", filter: suppliedFilter });
  });

  it("exposes exactly staffDirectory, committeeDirectory and giving — no other named slot", async () => {
    mockSite({ kind: "ok", site: SITE });
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams("alder-creek") });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots?: Record<string, unknown>;
    };
    expect(Object.keys(call.liveSlots ?? {}).sort()).toEqual([
      "committeeDirectory",
      "giving",
      "staffDirectory",
    ]);
  });
});

describe("generateMetadata", () => {
  it("returns {} (no title override) when the site is not_found — never a distinguishable error page title", async () => {
    mockSite({ kind: "not_found" });
    const meta = await generateMetadata({ params: makeParams() });
    expect(meta).toEqual({});
    expect(buildPageMetadata).not.toHaveBeenCalled();
  });

  it("passes organizationName, origin, pages, currentPath, pageUrl, and the resolved logoUrl to buildPageMetadata()", async () => {
    mockSite({ kind: "ok", site: SITE });
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

  it("degrades to logoUrl: null (never throws) when resolveLogoUrl's own read fails mid-request — its own call site, distinct from the page body's", async () => {
    mockSite({ kind: "ok", site: SITE });
    buildPageMetadata.mockReturnValue({
      title: "Welcome",
      description: undefined,
      canonicalUrl: "http://localhost:3000/site/alder-creek",
      openGraph: { type: "website", title: "Welcome", url: "x", siteName: "x", images: [] },
      twitter: { card: "summary", title: "Welcome", description: undefined },
      robots: { index: true, follow: true },
    });
    orgBrandsSelectMock.mockRejectedValue(new Error("simulated DB blip"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await generateMetadata({ params: makeParams("alder-creek") });

    expect(buildPageMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: null }),
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("translates buildPageMetadata()'s result into Next's Metadata shape, with an absolute title that bypasses the root layout's own template", async () => {
    mockSite({ kind: "ok", site: SITE });
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

// ---------------------------------------------------------------------------
// Track F: a custom host is a site KEY (DECISION-176, DECISION-181)
// ---------------------------------------------------------------------------

import { submitContactMessageAction } from "../actions";

const HOST = "church-one.invalid";
const CANONICAL = "www.church-one.invalid";
const DB_SLUG = "alder-creek";

/** Stubs `resolveSite()` for HOST MODE: the key is a host, the slug is the DATABASE's. */
function mockHostSite(opts: { redirectHost?: string | null; canonicalHost?: string } = {}) {
  resolveSite.mockImplementation(async (key: string) => ({
    kind: "ok",
    mode: "host",
    slug: DB_SLUG,
    site: SITE,
    urls: buildSiteUrls({
      mode: "host",
      host: opts.canonicalHost ?? key,
      slug: DB_SLUG,
      platformOrigin: "http://localhost:3000",
    }),
    redirectHost: opts.redirectHost ?? null,
  }));
}

describe("PublicSitePage - host mode: clean URLs, the DB slug, nothing the visitor controls", () => {
  it("hands site-kit a clean-path URL space on the verified canonical host, and the portal link on the PLATFORM", async () => {
    mockHostSite();
    renderSiteBundle.mockReturnValue(<div />);
    orgBrandsSelectMock.mockResolvedValue([{ markAssetKey: "mark-blob-key" }]);

    await renderPage({ params: makeParams(HOST, ["about"]) });

    const call = renderSiteBundle.mock.calls[0][0] as {
      origin: string;
      pageUrl: (p: string) => string;
      imageUrl: (k: string) => string;
      logoUrl: string | null;
      portalUrl: string;
    };
    expect(call.origin).toBe(`https://${HOST}`);
    expect(call.pageUrl("/")).toBe("/");
    expect(call.pageUrl("/about")).toBe("/about");
    expect(call.imageUrl("hero")).toBe("/assets/blob-key-1");
    expect(call.logoUrl).toBe("/assets/mark-blob-key");
    // Absolute and fixed: sign-in lives on the platform host, never on a church's domain.
    expect(call.portalUrl).toBe(`http://localhost:3000/o/${DB_SLUG}`);
    // No call-built URL names a /site/ prefix or the slug (G5).
    for (const url of [call.pageUrl("/about"), call.imageUrl("hero"), call.logoUrl!]) {
      expect(url).not.toContain("/site/");
      expect(url).not.toContain(DB_SLUG);
    }
  });

  it("closes the live slots over the DB-returned slug (reads) and the host key (the bound give action) - never the other way round", async () => {
    mockHostSite();
    renderSiteBundle.mockReturnValue(<div />);

    await renderPage({ params: makeParams(HOST) });

    const call = renderSiteBundle.mock.calls[0][0] as {
      liveSlots: Record<string, (filter: Record<string, unknown>) => { props: Record<string, unknown> }>;
    };
    expect(call.liveSlots.staffDirectory!({}).props).toMatchObject({ slug: DB_SLUG });
    expect(call.liveSlots.committeeDirectory!({}).props).toMatchObject({ slug: DB_SLUG });
    expect(call.liveSlots.giving!({}).props).toMatchObject({ slug: DB_SLUG, siteKey: HOST });
    // The staff photo builder is the host-mode one.
    const staff = call.liveSlots.staffDirectory!({}).props as { urls: { asset: (k: string) => string } };
    expect(staff.urls.asset("photo-1")).toBe("/assets/photo-1");
  });

  it("binds the contact form's action to the SITE KEY on the server (the client __slug field is gone)", async () => {
    mockHostSite();
    renderSiteBundle.mockReturnValue(<div />);
    vi.mocked(submitContactMessageAction).mockClear();

    await renderPage({ params: makeParams(HOST) });

    const call = renderSiteBundle.mock.calls[0][0] as {
      contactForm: { props: { action: (fd: FormData) => unknown } };
    };
    const fd = new FormData();
    await call.contactForm.props.action(fd);
    expect(vi.mocked(submitContactMessageAction)).toHaveBeenCalledWith(HOST, fd);
  });

  it("a host miss is the one notFound(): no presbytery fallback, no org summary read", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });

    await expect(renderPage({ params: makeParams(HOST) })).rejects.toThrow("NOT_FOUND");

    expect(publicOrgSummary).not.toHaveBeenCalled();
    expect(renderSiteBundle).not.toHaveBeenCalled();
  });

  it("an unusable key (neither slug nor host) is the same notFound()", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "invalid", slug: null });

    await expect(renderPage({ params: makeParams("Bad_Key") })).rejects.toThrow("NOT_FOUND");
    expect(publicOrgSummary).not.toHaveBeenCalled();
  });

  it("generateMetadata names the canonical host in origin and pageUrl", async () => {
    mockHostSite();
    buildPageMetadata.mockReturnValue({
      title: "About",
      description: undefined,
      canonicalUrl: `https://${HOST}/about`,
      openGraph: { type: "website", title: "About", url: "x", siteName: "x", images: [] },
      twitter: { card: "summary", title: "About", description: undefined },
      robots: { index: true, follow: true },
    });

    await generateMetadata({ params: makeParams(HOST, ["about"]) });

    const arg = buildPageMetadata.mock.calls[0][0] as { origin: string; pageUrl: (p: string) => string };
    expect(arg.origin).toBe(`https://${HOST}`);
    expect(arg.pageUrl("/about")).toBe("/about");
  });
});

describe("PublicSitePage - 307 hand-offs (DECISION-178)", () => {
  it("a non-canonical alias redirects to the canonical host, keeping path and query, and renders nothing", async () => {
    mockHostSite({ redirectHost: CANONICAL, canonicalHost: CANONICAL });

    await expect(
      renderPage({ params: makeParams("church-one.invalid", ["about", "our staff"]), searchParams: { tab: "2", x: ["a", "b c"] } }),
    ).rejects.toThrow(`REDIRECT:https://${CANONICAL}/about/our%20staff?tab=2&x=a&x=b+c`);

    expect(renderSiteBundle).not.toHaveBeenCalled();
  });

  it("the slug URL of an org whose custom host is serving redirects to that host", async () => {
    mockSite({ kind: "ok", site: SITE }, HOST);

    await expect(renderPage({ params: makeParams("alder-creek") })).rejects.toThrow(`REDIRECT:https://${HOST}/`);
    await expect(renderPage({ params: makeParams("alder-creek", ["about"]) })).rejects.toThrow(
      `REDIRECT:https://${HOST}/about`,
    );
    expect(renderSiteBundle).not.toHaveBeenCalled();
  });

  it("serves in place when there is no redirect host", async () => {
    mockSite({ kind: "ok", site: SITE }, null);
    renderSiteBundle.mockReturnValue(<h1>Welcome</h1>);

    await renderPage({ params: makeParams("alder-creek") });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(renderSiteBundle).toHaveBeenCalled();
  });

  it("never redirects a miss (there is no target to name)", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });
    publicOrgSummary.mockResolvedValue(null);

    await expect(renderPage({ params: makeParams("alder-creek") })).rejects.toThrow("NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("refuses to follow a malformed redirect host: serves in place instead (no open redirect from a corrupt row)", async () => {
    mockSite({ kind: "ok", site: SITE }, "evil.invalid/path?x=1#");
    renderSiteBundle.mockReturnValue(<h1>Welcome</h1>);

    await renderPage({ params: makeParams("alder-creek") });

    expect(redirectMock).not.toHaveBeenCalled();
  });
});
