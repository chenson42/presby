/**
 * WCAG 2.1 contrast math.
 *
 * ZERO RUNTIME IMPORTS, for the same reason `contract.ts` has none: slice 0
 * needs this to prove the platform palette meets its own floors, slice b needs
 * the identical math inside the ramp generator, and duplicating it is how the
 * two drift. The one import is `import type { BrandPair }` from the contract,
 * which erases at compile time. The dependency points contract <- contrast and
 * never back.
 *
 * Relative luminance and the ratio formula are WCAG 2.1 as published
 * (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance,
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio). Colours are quantised to
 * 8-bit sRGB before luminance is taken, because that is what a browser paints
 * and what every published reference value is computed from.
 *
 * Not `server-only` (precedent: `src/lib/utils.ts:6-8`) — the brand editor's
 * preview (slice d) evaluates the same floors in the browser.
 */

import type { BrandPair } from "./contract";

export type Rgb = { r: number; g: number; b: number };

/**
 * Parse a CSS colour into 8-bit sRGB channels.
 *
 * Supports exactly the two notations the token files use: `hsl()` (modern
 * space-separated or legacy comma-separated) and `#rrggbb`. Everything else
 * throws rather than degrading to black — a colour this cannot read is a
 * colour whose contrast nobody has verified, and returning a plausible value
 * for it would make the property tests pass on a palette that was never
 * measured. Alpha is rejected for the same reason: a contrast ratio against a
 * translucent fill depends on what is behind it, so it is not a property of
 * the pair.
 */
export function parseColor(css: string): Rgb {
  const value = css.trim();

  const hex = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }

  const hsl =
    /^hsl\(\s*(-?[0-9.]+)(?:deg)?\s*[, ]\s*([0-9.]+)%\s*[, ]\s*([0-9.]+)%\s*\)$/.exec(
      value,
    );
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  }

  throw new Error(
    `Unsupported colour notation: ${JSON.stringify(css)}. ` +
      `The token contract uses hsl() and #rrggbb only.`,
  );
}

/**
 * HSL -> 8-bit sRGB, rounded per channel exactly as a browser does. Hue wraps;
 * saturation and lightness are clamped rather than throwing, because a
 * generator (slice b) legitimately walks lightness past the ends of the ramp
 * while searching for a value that clears a floor.
 */
function hslToRgb(hDeg: number, sPct: number, lPct: number): Rgb {
  const h = ((hDeg % 360) + 360) % 360;
  const s = clamp01(sPct / 100);
  const l = clamp01(lPct / 100);

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** WCAG 2.1 relative luminance of an 8-bit sRGB colour. */
export function relativeLuminance(rgb: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) +
    0.7152 * channel(rgb.g) +
    0.0722 * channel(rgb.b)
  );
}

/**
 * WCAG 2.1 contrast ratio between two colours. Symmetric, and always >= 1 —
 * the brighter colour is the numerator regardless of argument order, so
 * callers never have to know which of a pair is lighter.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseColor(a));
  const lb = relativeLuminance(parseColor(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Does this foreground/background pair clear the floor the pair itself
 * declares?
 *
 * The floor is read from `pair.min` and never restated by the caller — that is
 * the whole point of putting `min` on the pair. Comparison is against the raw
 * ratio with no rounding: a value of 4.4996 does not become a pass because a
 * report would print it as "4.50".
 */
export function meets(pair: BrandPair, fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= pair.min;
}
