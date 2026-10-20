// @vitest-environment jsdom
/**
 * `/site/<key>/give` page state machine (docs/work-log/2026-10-15-online-giving.md,
 * Batch 4). `live` -> the form; `unavailable` -> the notice and never the form;
 * `absent` -> the platform's own notFound(), the SAME outcome for an unknown slug,
 * a non-tenant slug and a toggle-off organization (the database answers all three
 * with the one `absent` row, so the page must not branch on anything else).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_RATES } from "@/lib/giving/money";

const readPublicGivingConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readPublicGivingConfig: (...a: unknown[]) => readPublicGivingConfig(...a) }));
vi.mock("./actions", () => ({ createPublicGiveSessionAction: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
// The site key -> the DB-returned slug and the url builder (sites.ts's own tests cover the resolver).
// Default: slug mode, where the key is the slug.
const resolveGiveSite = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({ resolveGiveSite: (...a: unknown[]) => resolveGiveSite(...a) }));
// The catch-all's own render path (extracted so this page can fall through to it). Mocked here;
// fall-through.test.tsx runs the real one against the same fixtures the catch-all test uses.
const renderSitePage = vi.hoisted(() => vi.fn());
const siteBundleMetadata = vi.hoisted(() => vi.fn());
const siteBundleHasPage = vi.hoisted(() => vi.fn());
vi.mock("../render-site-page", () => ({
  renderSitePage: (...a: unknown[]) => renderSitePage(...a),
  siteBundleMetadata: (...a: unknown[]) => siteBundleMetadata(...a),
  siteBundleHasPage: (...a: unknown[]) => siteBundleHasPage(...a),
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { buildSiteUrls } from "@/lib/site-urls";
import PublicGivePage, { dynamic, generateMetadata } from "./page";

const params = (slug: string) => Promise.resolve({ slug });
/** The page takes `searchParams` too (to keep the query on a 307); most tests have none. */
const page = (args: { params: Promise<{ slug: string }>; searchParams?: Record<string, string | string[] | undefined> }) =>
  PublicGivePage({ params: args.params, searchParams: Promise.resolve(args.searchParams ?? {}) });

const slugTarget = (key: string, redirectHost: string | null = null) => ({
  slug: key,
  urls: buildSiteUrls({ mode: "slug", slug: key, platformOrigin: "http://localhost:3000" }),
  redirectHost,
});
const hostTarget = (host: string, dbSlug: string, redirectHost: string | null = null) => ({
  slug: dbSlug,
  urls: buildSiteUrls({ mode: "host", host, slug: dbSlug, platformOrigin: "http://localhost:3000" }),
  redirectHost,
});
const LIVE = {
  state: "live" as const,
  organizationName: "Alder Creek Presbyterian Church",
  livemode: true,
  contactPhone: "614-555-0123",
  funds: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "General Fund" }],
  cardEnabled: true,
  achEnabled: true,
  rates: DEFAULT_RATES,
  minAmountCents: 100,
  maxAmountCents: 2_500_000,
};

const UNAVAILABLE = { state: "unavailable" as const, organizationName: "Alder Creek Presbyterian Church", contactPhone: "614-555-0123" };
const BUNDLE_NODE = <main data-testid="bundle-give-page">The bundle own give page</main>;

beforeEach(() => {
  resolveGiveSite.mockImplementation(async (key: string) => slugTarget(key));
});

afterEach(() => {
  cleanup();
  resolveGiveSite.mockReset();
  readPublicGivingConfig.mockReset();
  renderSitePage.mockReset();
  siteBundleMetadata.mockReset();
  siteBundleHasPage.mockReset();
  renderSitePage.mockResolvedValue({ kind: "miss" });
  siteBundleHasPage.mockResolvedValue(false);
});

describe("PublicGivePage", () => {
  it("is never served from a shared cache (the page mints a per-request idempotency key)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("live: a heading naming the congregation, the form, and the way back to the site", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    render(await page({ params: params("alder-creek") }));
    expect(readPublicGivingConfig).toHaveBeenCalledWith("alder-creek");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Give to Alder Creek Presbyterian Church");
    expect(screen.getByTestId("give-form")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Alder Creek Presbyterian Church/ }).getAttribute("href")).toBe("/site/alder-creek");
  });

  it("live: each request gets its own idempotency key", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    const keys: string[] = [];
    for (let n = 0; n < 2; n += 1) {
      const { container, unmount } = render(await page({ params: params("alder-creek") }));
      keys.push((container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement).value);
      unmount();
    }
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("unavailable: the notice with the church's phone, and no form at all", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "unavailable", organizationName: "Alder Creek Presbyterian Church", contactPhone: "614-555-0123" });
    const { container } = render(await page({ params: params("alder-creek") }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect(container.querySelector("form, input, button")).toBeNull();
  });

  it.each([
    ["an unknown slug", "no-such-church"],
    ["a non-tenant slug", "some-presbytery"],
    ["a toggle-off organization", "alder-creek"],
  ])("absent (%s): the same notFound(), identical whichever of the three it was", async (_label, slug) => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    await expect(page({ params: params(slug) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("absent: the three cases reject with the very same error and add no title of their own", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    const errors: string[] = [];
    for (const slug of ["no-such-church", "some-presbytery", "alder-creek"]) {
      errors.push(String(await page({ params: params(slug) }).catch((e: unknown) => e)));
      expect(await generateMetadata({ params: params(slug) })).toEqual({});
    }
    expect(new Set(errors).size).toBe(1);
  });

  it("titles a live or unavailable page with the congregation's name", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    expect(await generateMetadata({ params: params("alder-creek") })).toEqual({ title: { absolute: "Give to Alder Creek Presbyterian Church" } });
  });

  it("titles an unavailable platform page with the congregation's name and keeps it out of search indexes", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    expect(await generateMetadata({ params: params("alder-creek") })).toEqual({
      title: { absolute: "Give to Alder Creek Presbyterian Church" },
      robots: { index: false },
    });
  });

  it("a live page is indexable as before (no robots override)", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    const meta = await generateMetadata({ params: params("alder-creek") });
    expect(meta.robots).toBeUndefined();
  });
});

describe("PublicGivePage - fall-through to the site bundle's own /give page (Phase 6 Gate A)", () => {
  it("not live (unavailable) + the bundle has /give: renders the bundle's page via the catch-all's render path, not the notice", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    renderSitePage.mockResolvedValue({ kind: "page", node: BUNDLE_NODE });
    const out = await page({ params: params("alder-creek") });
    expect(renderSitePage).toHaveBeenCalledWith("alder-creek", "/give", { presbyteryFallback: false });
    expect(out).toBe(BUNDLE_NODE);
  });

  it("not live (unavailable) + the bundle has /give: the metadata is the bundle page's, not the platform title", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    siteBundleHasPage.mockResolvedValue(true);
    siteBundleMetadata.mockResolvedValue({ title: { absolute: "Give online - Alder Creek" } });
    expect(await generateMetadata({ params: params("alder-creek") })).toEqual({ title: { absolute: "Give online - Alder Creek" } });
    expect(siteBundleMetadata).toHaveBeenCalledWith("alder-creek", "/give");
  });

  it("not live (unavailable) + no /give in the bundle: the platform's unavailable notice, no form", async () => {
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    renderSitePage.mockResolvedValue({ kind: "miss" });
    const { container } = render(await page({ params: params("alder-creek") }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect(container.querySelector("form, input, button")).toBeNull();
    expect(screen.queryByTestId("bundle-give-page")).toBeNull();
  });

  it("absent + the bundle has /give: the bundle's page (the toggle-off organization the catch-all always served)", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    renderSitePage.mockResolvedValue({ kind: "page", node: BUNDLE_NODE });
    expect(await page({ params: params("alder-creek") })).toBe(BUNDLE_NODE);
  });

  it("never asks for the catch-all's presbytery sign-in fallback (absent stays the one 404 for a presbytery slug too)", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    await expect(page({ params: params("some-presbytery") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(renderSitePage).toHaveBeenCalledWith("some-presbytery", "/give", { presbyteryFallback: false });
  });

  it("absent + no bundle page: still the one notFound()", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    renderSitePage.mockResolvedValue({ kind: "miss" });
    await expect(page({ params: params("alder-creek") })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("absent + the bundle has /give: its metadata; absent without one: still {}", async () => {
    readPublicGivingConfig.mockResolvedValue({ state: "absent" });
    siteBundleHasPage.mockResolvedValue(true);
    siteBundleMetadata.mockResolvedValue({ title: { absolute: "Give online" } });
    expect(await generateMetadata({ params: params("alder-creek") })).toEqual({ title: { absolute: "Give online" } });
    siteBundleHasPage.mockResolvedValue(false);
    expect(await generateMetadata({ params: params("alder-creek") })).toEqual({});
  });

  it("LIVE: the platform give page wins - the bundle is never consulted, even if it has a /give page", async () => {
    readPublicGivingConfig.mockResolvedValue(LIVE);
    renderSitePage.mockResolvedValue({ kind: "page", node: BUNDLE_NODE });
    siteBundleHasPage.mockResolvedValue(true);
    render(await page({ params: params("alder-creek") }));
    expect(screen.getByTestId("give-form")).toBeTruthy();
    expect(screen.queryByTestId("bundle-give-page")).toBeNull();
    await generateMetadata({ params: params("alder-creek") });
    expect(renderSitePage).not.toHaveBeenCalled();
    expect(siteBundleHasPage).not.toHaveBeenCalled();
    expect(siteBundleMetadata).not.toHaveBeenCalled();
  });
});

describe("PublicGivePage - a site KEY: a host on a church's own domain (Track F)", () => {
  const HOST = "church-one.invalid";

  it("reads giving for the DB-returned slug (not the host), links home at '/', and binds the give action to the HOST key", async () => {
    resolveGiveSite.mockResolvedValue(hostTarget(HOST, "alder-creek"));
    readPublicGivingConfig.mockResolvedValue(LIVE);

    render(await page({ params: params(HOST) }));

    expect(resolveGiveSite).toHaveBeenCalledWith(HOST);
    expect(readPublicGivingConfig).toHaveBeenCalledWith("alder-creek");
    expect(readPublicGivingConfig).not.toHaveBeenCalledWith(HOST);
    const back = screen.getByRole("link", { name: /Back to Alder Creek Presbyterian Church/ }).getAttribute("href");
    expect(back).toBe("/");
    expect(back).not.toContain("/site/");
    expect(screen.getByTestId("give-form")).toBeTruthy();
  });

  it("a host key that does not resolve is the one notFound() and reads nothing", async () => {
    resolveGiveSite.mockResolvedValue(null);

    await expect(page({ params: params(HOST) })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(readPublicGivingConfig).not.toHaveBeenCalled();
    expect(await generateMetadata({ params: params(HOST) })).toEqual({});
  });

  it("falls through to the bundle's /give page using the KEY (the resolver maps it), not the slug", async () => {
    resolveGiveSite.mockResolvedValue(hostTarget(HOST, "alder-creek"));
    readPublicGivingConfig.mockResolvedValue(UNAVAILABLE);
    renderSitePage.mockResolvedValue({ kind: "page", node: BUNDLE_NODE });

    expect(await page({ params: params(HOST) })).toBe(BUNDLE_NODE);
    expect(renderSitePage).toHaveBeenCalledWith(HOST, "/give", { presbyteryFallback: false });
  });

  it("an alias host, or the slug URL of an org whose custom host is serving, 307s to the canonical /give and keeps the query", async () => {
    resolveGiveSite.mockResolvedValue(hostTarget("church-one.invalid", "alder-creek", "www.church-one.invalid"));
    readPublicGivingConfig.mockResolvedValue(LIVE);
    await expect(page({ params: params(HOST), searchParams: { fund: "abc", x: ["1", "2"] } })).rejects.toThrow(
      "NEXT_REDIRECT:https://www.church-one.invalid/give?fund=abc&x=1&x=2",
    );

    resolveGiveSite.mockResolvedValue(slugTarget("alder-creek", "www.church-one.invalid"));
    await expect(page({ params: params("alder-creek") })).rejects.toThrow(
      "NEXT_REDIRECT:https://www.church-one.invalid/give",
    );
    // Nothing was read for a response that is only a redirect.
    expect(readPublicGivingConfig).not.toHaveBeenCalled();
  });
});
