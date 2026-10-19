// @vitest-environment jsdom
/**
 * `/site/<slug>/give` falls through to the site bundle's own `/give` page when giving
 * is not live (docs/work-log/2026-10-15-online-giving.md, Phase 6 "Phase 1 miss: the
 * /give shadow" and the follow-up section). Unlike page.test.tsx this runs the REAL
 * `render-site-page` helper - the same function the `[[...path]]` catch-all calls - with
 * the same boundary mocks the catch-all's own test uses, so what is pinned is that the
 * give route reaches `renderSiteBundle` with the bundle's pages and `currentPath: "/give"`
 * and returns whatever it produced, rather than building a second render path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_RATES } from "@/lib/giving/money";

const readPublicGivingConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readPublicGivingConfig: (...a: unknown[]) => readPublicGivingConfig(...a) }));
vi.mock("./actions", () => ({ createPublicGiveSessionAction: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }) }));

const getPublishedSite = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({ getPublishedSite: (...a: unknown[]) => getPublishedSite(...a) }));
const publicOrgSummary = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({ publicOrgSummary: (...a: unknown[]) => publicOrgSummary(...a) }));

const renderSiteBundle = vi.hoisted(() => vi.fn());
const buildPageMetadata = vi.hoisted(() => vi.fn());
vi.mock("presby-site-kit", () => ({
  renderSiteBundle: (...a: unknown[]) => renderSiteBundle(...a),
  buildPageMetadata: (...a: unknown[]) => buildPageMetadata(...a),
}));
vi.mock("../actions", () => ({ submitContactMessageAction: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getPlatformDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) }),
}));
vi.mock("@/lib/db/domain/org", () => ({ organizationBrands: {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import PublicGivePage, { generateMetadata } from "./page";

const params = (slug: string) => Promise.resolve({ slug });
const BRAND = { tokens: { light: {}, dark: {}, version: 1 }, fontPairing: { bodyClassName: "b", headingClassName: "h" } };
const SOCIAL = { facebook: null, instagram: null, xTwitter: null, youtube: null, other: null };
const site = (paths: string[]) => ({
  organizationId: "org-1",
  organizationName: "Alder Creek Presbyterian Church",
  organizationType: "congregation",
  brand: BRAND,
  pages: paths.map((path) => ({ path, frontMatter: { title: `Page ${path}`, navLabel: path }, mdxAst: null })),
  imageKeys: {},
  profile: { address: null, phone: null, social: SOCIAL },
  serviceTimes: [],
  officeHours: [],
});
const UNAVAILABLE = { state: "unavailable", organizationName: "Alder Creek Presbyterian Church", contactPhone: "614-555-0123" };
const LIVE = {
  state: "live",
  organizationName: "Alder Creek Presbyterian Church",
  livemode: true,
  contactPhone: null,
  funds: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "General Fund" }],
  cardEnabled: true,
  achEnabled: true,
  rates: DEFAULT_RATES,
  minAmountCents: 100,
  maxAmountCents: 2_500_000,
};

afterEach(() => {
  cleanup();
  for (const m of [readPublicGivingConfig, getPublishedSite, publicOrgSummary, renderSiteBundle, buildPageMetadata]) m.mockReset();
  publicOrgSummary.mockResolvedValue(null);
});

describe("/site/<slug>/give against a real bundle", () => {
  it("not live + the bundle has a /give page: the bundle renders at currentPath /give through renderSiteBundle", async () => {
    const s = site(["/", "/give"]);
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    getPublishedSite.mockResolvedValue({ kind: "ok", site: s });
    renderSiteBundle.mockReturnValue(<main data-testid="bundle-give-page">Give online (external provider link)</main>);

    render(await PublicGivePage({ params: params("alder-creek") }));

    expect(screen.getByTestId("bundle-give-page")).toBeTruthy();
    expect(screen.queryByTestId("giving-unavailable")).toBeNull();
    expect(renderSiteBundle).toHaveBeenCalledTimes(1);
    const input = renderSiteBundle.mock.calls[0][0] as { currentPath: string; pages: unknown; brand: unknown; pageUrl: (p: string) => string };
    expect(input.currentPath).toBe("/give");
    expect(input.pages).toBe(s.pages);
    expect(input.brand).toBe(BRAND);
    expect(input.pageUrl("/give")).toBe("/site/alder-creek/give");
  });

  it("not live + the bundle has a /give page: metadata is the catch-all's (buildPageMetadata for /give), indexable as the author wrote it", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    getPublishedSite.mockResolvedValue({ kind: "ok", site: site(["/", "/give"]) });
    buildPageMetadata.mockReturnValue({
      title: "Give online - Alder Creek Presbyterian Church",
      description: undefined,
      canonicalUrl: "http://localhost:3000/site/alder-creek/give",
      openGraph: {},
      twitter: {},
      robots: { index: true, follow: true },
    });
    const meta = await generateMetadata({ params: params("alder-creek") });
    expect((buildPageMetadata.mock.calls[0][0] as { currentPath: string }).currentPath).toBe("/give");
    expect(meta.title).toEqual({ absolute: "Give online - Alder Creek Presbyterian Church" });
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("not live + a published bundle with no /give page: the platform notice, noindex", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    getPublishedSite.mockResolvedValue({ kind: "ok", site: site(["/", "/about"]) });
    renderSiteBundle.mockReturnValue(null);

    const { container } = render(await PublicGivePage({ params: params("alder-creek") }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();
    const meta = await generateMetadata({ params: params("alder-creek") });
    expect(meta.robots).toEqual({ index: false });
    expect(buildPageMetadata).not.toHaveBeenCalled();
  });

  it("not live + no published site at all: the platform notice (as before)", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    render(await PublicGivePage({ params: params("alder-creek") }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
  });

  it("a /give/<other> bundle page is the catch-all's own, never this route's concern (path equality is exact)", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    getPublishedSite.mockResolvedValue({ kind: "ok", site: site(["/", "/give/ways"]) });
    renderSiteBundle.mockReturnValue(null);
    render(await PublicGivePage({ params: params("alder-creek") }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect((renderSiteBundle.mock.calls[0][0] as { currentPath: string }).currentPath).toBe("/give");
  });

  it("absent + no site: notFound(), the catch-all's collapse", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    await expect(PublicGivePage({ params: params("no-such-church") })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("absent for a presbytery slug: the one notFound(), and neither the org summary nor the sign-in fallback is touched", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    getPublishedSite.mockResolvedValue({ kind: "not_found" });
    publicOrgSummary.mockResolvedValue({ name: "Fixture Presbytery", organizationType: "presbytery" });
    await expect(PublicGivePage({ params: params("fixture-presbytery") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(publicOrgSummary).not.toHaveBeenCalled();
  });

  it("LIVE: the form, with the bundle never read", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    getPublishedSite.mockResolvedValue({ kind: "ok", site: site(["/", "/give"]) });
    render(await PublicGivePage({ params: params("alder-creek") }));
    expect(screen.getByTestId("give-form")).toBeTruthy();
    expect(getPublishedSite).not.toHaveBeenCalled();
    expect(renderSiteBundle).not.toHaveBeenCalled();
  });
});
