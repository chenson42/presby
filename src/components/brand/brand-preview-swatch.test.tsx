// @vitest-environment jsdom
/**
 * Tests for <BrandPreviewSwatch> and platformSchemeTokens() — P0.5 slice c,
 * commit `c3`.
 *
 * THE C1 TRAP IS THE POINT OF THIS FILE. `(admin)` sits outside
 * BRANDABLE_PREFIXES in scripts/check-brand-scope.mjs, so this component must
 * paint every colour via inline `style`, never a `bg-brand-*`/`text-brand-*`
 * utility class — those would resolve to nothing (or the platform default)
 * and lie to the operator about what is about to save. The static tripwire
 * (`npm run check:brand-scope`) proves the SOURCE has no such class string;
 * this test proves the RENDERED OUTPUT actually carries the previewed
 * organization's colours, which a grep cannot.
 *
 * No jest-dom matchers (see org-mark.test.tsx's header) — jsdom normalizes
 * an inline `#rrggbb` style value to `rgb(r, g, b)`, so hexToRgb() below
 * converts the generator's hex output before comparing against
 * `element.style.backgroundColor`.
 */

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { generateBrandTokens } from "@/lib/brand/generate";
import { BRAND_ROLES } from "@/lib/brand/contract";
import { BrandPreviewSwatch, platformSchemeTokens } from "./brand-preview-swatch";

afterEach(cleanup);

function hexToRgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const [, r, g, b] = m;
  return `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`;
}

// An invented seed, deliberately not near-grey and not near the platform
// destructive hue — a plain, unremarkable colour so no adjustments fire and
// the test stays about rendering, not about the generator's edge cases
// (those are generate.test.ts's job).
const SEED_HEX = "#2f6f4f";

describe("BrandPreviewSwatch", () => {
  it("paints every previewed surface via inline style, never a brand utility class", () => {
    const { tokens } = generateBrandTokens(SEED_HEX);
    const { container } = render(
      <BrandPreviewSwatch
        tokens={tokens.light}
        scheme="light"
        organizationName="Invented Fixture Congregation"
      />,
    );

    // C1, proven at the DOM level: no *-brand utility class anywhere in the
    // rendered markup.
    expect(container.innerHTML).not.toMatch(/\bbg-brand\b/);
    expect(container.innerHTML).not.toMatch(/\btext-brand\b/);

    // The masthead band actually carries the SEED's own colour (brand-raw,
    // D10 — unmodified), as an inline style, not a class.
    const masthead = screen.getByText("Invented Fixture Congregation");
    expect(masthead.style.backgroundColor).toBe(
      hexToRgb(tokens.light["brand-raw"]),
    );

    // The primary action swatch carries the DERIVED brand fill.
    const button = screen.getByRole("button", { name: "Primary action" });
    expect(button.style.backgroundColor).toBe(hexToRgb(tokens.light.brand));
  });

  it("renders which scheme is being previewed", () => {
    const { tokens } = generateBrandTokens(SEED_HEX);
    render(
      <BrandPreviewSwatch
        tokens={tokens.dark}
        scheme="dark"
        organizationName="Invented Fixture Congregation"
      />,
    );
    expect(screen.getByText(/dark preview/i)).toBeTruthy();
  });
});

describe("platformSchemeTokens", () => {
  it("produces a value for every declared brand role, in both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      const tokens = platformSchemeTokens(scheme);
      for (const role of BRAND_ROLES) {
        expect(tokens[role], `missing role "${role}" (${scheme})`).toBeTruthy();
      }
    }
  });
});
