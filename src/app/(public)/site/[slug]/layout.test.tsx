// @vitest-environment jsdom
/**
 * Tests for `/site/<key>`'s layout.tsx — the second (previously dormant)
 * `<BrandTokens>` emitter (DECISION-047/052). What this file exists to pin:
 *
 *   1. `<BrandTokens>` receives exactly what `resolveSite()`'s own
 *      `site.brand.tokens` returned — never a placeholder, never re-derived.
 *   2. A `not_found` result (which collapses "never provisioned",
 *      "suspended", "nonexistent slug", "org inactive", "flag off", and "a
 *      corrupt bundle" into one outcome) renders with NO brand — the
 *      platform default, never a crash, and never a different code path per
 *      reason. This layout does not gate or redirect on the result; it
 *      simply has nothing to emit, same discipline `<BrandTokens>` itself
 *      documents for the (org) access-denied/ended/404 pages.
 *   3. The layout renders regardless of outcome — page.tsx is what 404s a
 *      not_found slug, never this layout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const resolveSite = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolveSite: (...args: unknown[]) => resolveSite(...args),
}));

const brandTokensSpy = vi.fn();
vi.mock("@/components/brand/brand-tokens", () => ({
  BrandTokens: (props: { brand: unknown }) => {
    brandTokensSpy(props.brand);
    return null;
  },
}));

import PublicSiteLayout, { generateMetadata } from "./layout";
import { NEUTRAL_404_METADATA } from "./neutral-metadata";

afterEach(() => {
  cleanup();
  resolveSite.mockReset();
  brandTokensSpy.mockClear();
});

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

const BRAND_TOKENS = { light: { primary: "oklch(1 0 0)" }, dark: {}, version: 1 };

describe("PublicSiteLayout — brand emission", () => {
  it("passes resolveSite()'s own brand.tokens to the emitter, not a placeholder", async () => {
    resolveSite.mockResolvedValue({
      kind: "ok",
      mode: "slug",
      slug: "alder-creek",
      urls: {},
      redirectHost: null,
      site: {
        organizationId: "org-1",
        organizationName: "Alder Creek Presbyterian Church",
        organizationType: "congregation",
        brand: {
          tokens: BRAND_TOKENS,
          fontPairing: { bodyClassName: "font-body", headingClassName: "font-heading" },
        },
        pages: [],
        imageKeys: {},
      },
    });

    const el = await PublicSiteLayout({
      children: <div>content</div>,
      params: makeParams(),
    });
    render(el);

    expect(brandTokensSpy).toHaveBeenCalledWith(BRAND_TOKENS);
  });

  it("renders with brand null — not a crash, not a redirect — when the result is not_found", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });

    const el = await PublicSiteLayout({
      children: <div>content</div>,
      params: makeParams(),
    });
    const { getByText } = render(el);

    expect(brandTokensSpy).toHaveBeenCalledWith(null);
    // The layout still renders its children — page.tsx is what 404s, never
    // this layout.
    expect(getByText("content")).toBeTruthy();
  });

  it("renders with brand null when the org has no brand row at all (ok result, brand: null)", async () => {
    resolveSite.mockResolvedValue({
      kind: "ok",
      mode: "slug",
      slug: "alder-creek",
      urls: {},
      redirectHost: null,
      site: {
        organizationId: "org-1",
        organizationName: "Bramblewood Presbyterian Church",
        organizationType: "congregation",
        brand: null,
        pages: [],
        imageKeys: {},
      },
    });

    const el = await PublicSiteLayout({
      children: <div>content</div>,
      params: makeParams("bramblewood"),
    });
    render(el);

    expect(brandTokensSpy).toHaveBeenCalledWith(null);
  });
});

describe("PublicSiteLayout - the segment is a site key (Track F)", () => {
  it("resolves exactly the route segment, so a custom host's brand is read through the same call", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });

    await PublicSiteLayout({ children: <div>content</div>, params: makeParams("church-one.invalid") });

    expect(resolveSite).toHaveBeenCalledTimes(1);
    expect(resolveSite).toHaveBeenCalledWith("church-one.invalid");
  });

  it("emits the verified site's brand for a host key, and nothing for a host that does not resolve", async () => {
    resolveSite.mockResolvedValueOnce({
      kind: "ok",
      mode: "host",
      slug: "alder-creek",
      urls: {},
      redirectHost: null,
      site: {
        organizationId: "org-1",
        organizationName: "Alder Creek Presbyterian Church",
        organizationType: "congregation",
        brand: { tokens: BRAND_TOKENS, fontPairing: { bodyClassName: "font-body" } },
        pages: [],
        imageKeys: {},
      },
    });
    render(await PublicSiteLayout({ children: <div>content</div>, params: makeParams("church-one.invalid") }));
    expect(brandTokensSpy).toHaveBeenLastCalledWith(BRAND_TOKENS);

    resolveSite.mockResolvedValueOnce({ kind: "not_found", mode: "host", slug: null });
    render(await PublicSiteLayout({ children: <div>content</div>, params: makeParams("unclaimed.invalid") }));
    expect(brandTokensSpy).toHaveBeenLastCalledWith(null);
  });
});

describe("PublicSiteLayout - generateMetadata (the title of an unclaimed domain)", () => {
  it("a host key that does not resolve gets the NEUTRAL metadata: no product in the title or the social tags", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });
    const meta = await generateMetadata({ params: makeParams("unclaimed.invalid") });
    expect(meta).toBe(NEUTRAL_404_METADATA);
    expect(meta.title).toEqual({ absolute: "Page not found" });
    expect(JSON.stringify(meta)).not.toMatch(/presby|portal/i);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("an unusable key is the same neutral metadata", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "invalid", slug: null });
    expect(await generateMetadata({ params: makeParams("Bad_Key") })).toBe(NEUTRAL_404_METADATA);
  });

  it("a slug miss keeps the platform's title (it may be DECISION-121's presbytery sign-in page, a real 200)", async () => {
    resolveSite.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "northern-reach" });
    expect(await generateMetadata({ params: makeParams("northern-reach") })).toEqual({});
  });

  it("a resolved site returns nothing: each page sets its own title", async () => {
    resolveSite.mockResolvedValue({ kind: "ok", mode: "host", slug: "alder-creek", urls: {}, redirectHost: null, site: { brand: null } });
    expect(await generateMetadata({ params: makeParams("church-one.invalid") })).toEqual({});
  });
});
