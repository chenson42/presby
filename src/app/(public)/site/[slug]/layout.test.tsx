// @vitest-environment jsdom
/**
 * Tests for `/site/<slug>`'s layout.tsx — the second (previously dormant)
 * `<BrandTokens>` emitter (DECISION-047/052). What this file exists to pin:
 *
 *   1. `<BrandTokens>` receives exactly what `getPublishedSite()`'s own
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

const getPublishedSite = vi.fn();
vi.mock("@/lib/sites", () => ({
  getPublishedSite: (...args: unknown[]) => getPublishedSite(...args),
}));

const brandTokensSpy = vi.fn();
vi.mock("@/components/brand/brand-tokens", () => ({
  BrandTokens: (props: { brand: unknown }) => {
    brandTokensSpy(props.brand);
    return null;
  },
}));

import PublicSiteLayout from "./layout";

afterEach(() => {
  cleanup();
  getPublishedSite.mockReset();
  brandTokensSpy.mockClear();
});

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

const BRAND_TOKENS = { light: { primary: "oklch(1 0 0)" }, dark: {}, version: 1 };

describe("PublicSiteLayout — brand emission", () => {
  it("passes getPublishedSite()'s own brand.tokens to the emitter, not a placeholder", async () => {
    getPublishedSite.mockResolvedValue({
      kind: "ok",
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
    getPublishedSite.mockResolvedValue({ kind: "not_found" });

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
    getPublishedSite.mockResolvedValue({
      kind: "ok",
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
