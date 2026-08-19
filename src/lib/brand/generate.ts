/**
 * The colour ramp generator.
 *
 * A pure function: one sRGB seed hex -> two independently-derived token sets
 * (light, dark) + a non-empty-when-needed `adjustments[]`, versioned. This is
 * slice b of P0.5, the pipeline's single highest-value artifact (Phase 3,
 * commit `b1`) — proven correct the same way slice 0's own palette was: a
 * property test sweeping every `LEGAL_PAIRS` entry across a deterministic
 * OKLCH-derived grid, in both schemes.
 *
 * ZERO RUNTIME IMPORTS beyond `./contract` and `./contrast` (DECISION-057).
 * No `@/lib/db`, no `next/*`, no `react`, no `drizzle`, no colour-science
 * dependency (`culori` et al. are unapproved and have no second consumer in
 * the tree). Björn Ottosson's reference sRGB<->OKLab transform
 * (https://bottosson.github.io/posts/oklab/) is transcribed inline below,
 * ~40 lines, and is the only new math in this file — `contrast.ts` already
 * owns WCAG luminance/ratio and is reused, not reimplemented.
 *
 * ---------------------------------------------------------------------------
 * The nine-step derivation (Phase 4 notes name any deviation from this list):
 *
 *   1. Parse and validate the seed hex; convert to OKLCH (L, C, H).
 *   2. Classify near-grey (chroma below a threshold) and decide the chroma to
 *      search with — the seed's own, or a floor, for a seed with no real hue.
 *   3. Derive `brand-raw` / `on-brand-raw` — the UNMODIFIED seed (D10), text
 *      resolved by an achromatic text-first search between pure black and
 *      pure white (always resolves >=4.5:1 for ANY background luminance —
 *      see the WCAG luminance-gap proof in `pickAchromaticForeground`'s
 *      header comment; no hue or lightness of the seed ever moves for this
 *      role).
 *   4. Derive `surface` / `on-surface` per scheme — D7-bounded, a near-white
 *      (light) or near-dark (dark) tint of the seed's own hue, text resolved
 *      by the same achromatic search (always resolves >=7:1 at these extreme
 *      lightnesses).
 *   5. Derive `accent` / `on-accent` per scheme — DECISION-054's bounded
 *      near-neutral tint, same mechanism as step 4 at a shallower lightness
 *      bound (closer to `muted`, so it still reads as a hover surface).
 *   6. Derive `brand` / `on-brand` per scheme simultaneously — a directional
 *      lightness search along the SEED'S OWN HUE (darken toward black for
 *      light scheme, lighten toward white for dark scheme) until D3 (`brand`
 *      on `surface` >=3:1) clears, gamut-clamping chroma at each candidate
 *      lightness; `on-brand` resolved by the same achromatic search as steps
 *      3-5 (always resolves >=4.5:1, independent of `brand`'s lightness).
 *   7. Apply the D10 minimum-chroma floor for a near-grey seed, and a bounded
 *      hue nudge (+-5..20 degrees) ONLY as a fallback when gamut clipping
 *      still collapsed a non-near-grey seed's chroma near zero at the
 *      lightness step 6 found — logged as an adjustment either way, never a
 *      silent identity change.
 *   8. `ring` := `brand`, verbatim. No second search: D4 is closed
 *      structurally by `FOCUS_RING_OFFSET_PX` (a geometry property of the
 *      primitives themselves — every focus-visible ring is drawn with that
 *      many pixels of `surface` between the ring and the control it rings),
 *      not a colour property this module owns. `ring on surface >=3:1`
 *      reduces to `brand on surface >=3:1`, which step 6 already guarantees.
 *   9. Copy `danger` / `on-danger`, `border` / `input-border`,
 *      `muted-surface` / `on-muted-surface` VERBATIM from `PLATFORM_TOKENS`
 *      (D6: platform-fixed, never derived). Run the D6 hue-distance check
 *      (`MIN_BRAND_DANGER_HUE_DISTANCE_DEG`) against the FINAL `brand` hue
 *      (post any step-7 nudge) and record an adjustment — never a forced
 *      shift, which would violate D10 — if the seed's hue sits inside the
 *      band. Steps 2-9 run independently for `dark` (D11: not a CSS
 *      inversion of `light`). Stamp `BRAND_TOKEN_VERSION` (D8).
 *
 * One property worth stating once rather than at every step: for ANY
 * background luminance, at least one of pure black / pure white ALWAYS
 * clears a 4.5:1 floor (the two failure conditions are mutually exclusive —
 * see `pickAchromaticForeground`), so text never needs to touch hue or
 * lightness to satisfy D2. It is only D3's "brand visible against surface"
 * that can require moving `brand`'s OWN lightness, and D7's near-white/
 * near-dark bound is exactly what keeps `surface`/`on-surface` and
 * `accent`/`on-accent` clear of the well-known WCAG "mid-grey" AAA gap
 * (roughly relative luminance 0.10-0.30, where neither black nor white
 * text clears 7:1). This is why hue almost never needs to move in practice —
 * Flow 3's "move the text, not the hue" holds by construction rather than by
 * discipline, and the bounded hue nudge in step 7 is a documented safety net,
 * not the primary mechanism. See Phase 4 notes for whether the property test
 * grid ever exercised it.
 *
 * D9 ("the ramp is monotone in lightness") is not asserted by this module:
 * the closed `BrandRole` vocabulary (`contract.ts`) has no hover/pressed
 * role, so there is no second ramp step to compare against `brand` for
 * monotonicity. Named here as a gap for the vocabulary, not silently
 * dropped — see Phase 4 notes.
 *
 * Design: docs/work-log/2026-08-19-brand-foundation.md, Phase 3 (re-run),
 * commit `b1`. DECISION-057 (inline OKLCH, deterministic grid).
 */

import {
  BRAND_ROLES,
  BRAND_TOKEN_VERSION,
  MIN_BRAND_DANGER_HUE_DISTANCE_DEG,
  PLATFORM_TOKENS,
  ROLE_TO_TOKEN,
  type BrandRole,
  type PlatformTokenName,
  type Scheme,
} from "./contract";
import { contrastRatio, parseColor, type Rgb } from "./contrast";

/* ---------------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------------ */

/** One scheme's full role -> CSS colour string map. Total over BRAND_ROLES. */
export type SchemeTokens = Record<BrandRole, string>;

export type BrandTokenSet = {
  /** D8: pinned so a generator improvement never silently re-skins an org. */
  readonly version: number;
  readonly light: SchemeTokens;
  readonly dark: SchemeTokens;
};

/**
 * D12: the generator returns adjustments as DATA, so disclosure is a
 * contract of the generator rather than a UI nicety a second implementer
 * forgets. `message` is written to be quoted directly in the editor
 * (Flow 3: "a sentence they believe").
 */
export type BrandAdjustment = {
  readonly role: BrandRole;
  readonly scheme: Scheme | "both";
  readonly message: string;
};

export type GeneratedBrand = {
  readonly tokens: BrandTokenSet;
  readonly adjustments: readonly BrandAdjustment[];
};

/* ---------------------------------------------------------------------------
 * sRGB <-> OKLab/OKLCH — Björn Ottosson's reference transform, transcribed.
 * ------------------------------------------------------------------------ */

type Oklab = { L: number; a: number; b: number };
export type Oklch = { L: number; C: number; H: number };

function srgbChannelToLinear(c: number): number {
  const v = c;
  return v >= 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
}

function linearChannelToSrgb(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v >= 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
}

function linearSrgbToOklab(r: number, g: number, b: number): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearSrgb(lab: Oklab): { r: number; g: number; b: number } {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function rgbToHex(rgb: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`;
}

/**
 * Parsed CSS colour (hex or hsl(), via `contrast.ts`'s `parseColor`) ->
 * OKLCH. Used both to read the seed and to measure the platform's own
 * `--destructive` hue for the D6 check.
 */
export function oklchOf(css: string): Oklch {
  const { r, g, b } = parseColor(css);
  const lab = linearSrgbToOklab(
    srgbChannelToLinear(r / 255),
    srgbChannelToLinear(g / 255),
    srgbChannelToLinear(b / 255),
  );
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let H = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: lab.L, C, H };
}

/**
 * OKLCH -> in-gamut sRGB hex, reducing chroma (never lightness or hue) by
 * binary search until every channel lands in [0,1]. Returns the CHROMA
 * actually used, so callers can detect when gamut clipping ate a seed's
 * saturation (step 7's fallback trigger).
 */
function oklchToHexClamped(
  L: number,
  C: number,
  H: number,
): { hex: string; C: number } {
  const hRad = (H * Math.PI) / 180;
  const cosH = Math.cos(hRad);
  const sinH = Math.sin(hRad);

  const inGamut = (chroma: number): boolean => {
    const lin = oklabToLinearSrgb({
      L,
      a: chroma * cosH,
      b: chroma * sinH,
    });
    const eps = 1e-4;
    return (
      lin.r >= -eps &&
      lin.r <= 1 + eps &&
      lin.g >= -eps &&
      lin.g <= 1 + eps &&
      lin.b >= -eps &&
      lin.b <= 1 + eps
    );
  };

  let usedC = Math.max(0, C);
  if (!inGamut(usedC)) {
    let lo = 0;
    let hi = usedC;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) lo = mid;
      else hi = mid;
    }
    usedC = lo;
  }

  const lin = oklabToLinearSrgb({ L, a: usedC * cosH, b: usedC * sinH });
  const rgb: Rgb = {
    r: linearChannelToSrgb(lin.r) * 255,
    g: linearChannelToSrgb(lin.g) * 255,
    b: linearChannelToSrgb(lin.b) * 255,
  };
  return { hex: rgbToHex(rgb), C: usedC };
}

/* ---------------------------------------------------------------------------
 * Achromatic text-first search (steps 3-6's shared foreground mechanism).
 *
 * WCAG luminance-gap proof, for the record: contrast(black, bg) < 4.5 iff
 * relLum(bg) < 0.175; contrast(white, bg) < 4.5 iff relLum(bg) > 0.1833.
 * Those two conditions cannot both hold (0.175 < 0.1833), so for ANY
 * background at least one of {black, white} clears 4.5:1 — text never has to
 * move the seed's hue or lightness to satisfy D2. (The equivalent AAA/7:1
 * proof does NOT close — both fail for relLum(bg) in (0.10, 0.30), which is
 * exactly the mid-grey gap D7's near-white/near-dark bound exists to avoid
 * for `surface`/`accent`.)
 * ------------------------------------------------------------------------ */

function pickAchromaticForeground(bgHex: string): string {
  const black = contrastRatio("#000000", bgHex);
  const white = contrastRatio("#ffffff", bgHex);
  return white > black ? "#ffffff" : "#000000";
}

/* ---------------------------------------------------------------------------
 * Tunable bounds, local to the generator (not part of the shared contract —
 * these are implementation choices, not vocabulary).
 * ------------------------------------------------------------------------ */

const NEAR_GREY_CHROMA_THRESHOLD = 0.03;
const MIN_BRAND_CHROMA = 0.06;
/** D10's bound; a fallback (step 7), not the primary mechanism — see header. */
const MAX_BRAND_HUE_DRIFT_DEG = 20;
/** Every 5 degrees up to the D10 bound, both directions. */
const HUE_NUDGE_CANDIDATES_DEG: readonly number[] = Array.from(
  { length: MAX_BRAND_HUE_DRIFT_DEG / 5 },
  (_, i) => (i + 1) * 5,
).flatMap((d) => [d, -d]);
const BRAND_LIGHTNESS_STEP = 0.01;

/**
 * `light` is 0.995, not a rounder-looking 0.97, for a reason discovered
 * empirically and worth recording: `--input` (D3's `input-border`) is
 * PLATFORM-FIXED at `hsl(214 32% 59%)` and clears exactly 3.20:1 against
 * pure white. That margin is razor-thin — 0.995 keeps every hue's tinted
 * `surface` at >=3.05:1 against the fixed control border (verified by a
 * full 5-degree hue sweep during Phase 4); 0.97 measured as low as 2.93:1
 * for some seeds, an outright floor violation the property test caught.
 * `dark`'s near-black band has a wide margin against `--input`'s dark value
 * (>=4:1 even well past 0.16) so it did not need the same tightening.
 */
const SURFACE_L: Record<Scheme, number> = { light: 0.995, dark: 0.16 };
const SURFACE_TINT_CHROMA_CAP = 0.02;
const ACCENT_L: Record<Scheme, number> = { light: 0.92, dark: 0.24 };
const ACCENT_TINT_CHROMA_CAP = 0.03;

function hueDistanceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* ---------------------------------------------------------------------------
 * Step 6: the directional lightness search for `brand`.
 * ------------------------------------------------------------------------ */

function searchBrandLightness(
  scheme: Scheme,
  surfaceHex: string,
  startL: number,
  C: number,
  H: number,
): { hex: string; L: number; C: number } {
  const direction = scheme === "light" ? -1 : 1;
  let L = Math.min(0.99, Math.max(0.01, startL));

  for (let i = 0; i < 100; i++) {
    const { hex, C: usedC } = oklchToHexClamped(L, C, H);
    if (contrastRatio(hex, surfaceHex) >= 3) return { hex, L, C: usedC };
    L += direction * BRAND_LIGHTNESS_STEP;
    if (L <= 0 || L >= 1) break;
  }

  const fallbackL = direction === -1 ? 0.02 : 0.98;
  const { hex, C: usedC } = oklchToHexClamped(fallbackL, C, H);
  return { hex, L: fallbackL, C: usedC };
}

/* ---------------------------------------------------------------------------
 * Per-scheme derivation (D11: independent, not a CSS inversion).
 * ------------------------------------------------------------------------ */

function deriveScheme(
  scheme: Scheme,
  seed: Oklch,
  isNearGrey: boolean,
  adjustments: BrandAdjustment[],
): SchemeTokens {
  const platform = PLATFORM_TOKENS[scheme];
  const copyPlatform = (role: BrandRole): string =>
    platform[ROLE_TO_TOKEN[role] as PlatformTokenName];

  // Step 3 — brand-raw / on-brand-raw: the unmodified seed. Recompute the hex
  // from the parsed OKLCH rather than echoing the caller's string (A7).
  const brandRawHex = oklchToHexClamped(seed.L, seed.C, seed.H).hex;
  const onBrandRaw = pickAchromaticForeground(brandRawHex);

  // Step 4 — surface / on-surface: D7-bounded near-white/near-dark tint.
  const surfaceHue = isNearGrey ? 0 : seed.H;
  const surfaceTintC = Math.min(seed.C * 0.15, SURFACE_TINT_CHROMA_CAP);
  const surfaceHex = oklchToHexClamped(
    SURFACE_L[scheme],
    surfaceTintC,
    surfaceHue,
  ).hex;
  const onSurface = pickAchromaticForeground(surfaceHex);

  // Step 5 — accent / on-accent (DECISION-054): a shallower near-neutral tint.
  const accentTintC = Math.min(seed.C * 0.2, ACCENT_TINT_CHROMA_CAP);
  const accentHex = oklchToHexClamped(
    ACCENT_L[scheme],
    accentTintC,
    surfaceHue,
  ).hex;
  const onAccent = pickAchromaticForeground(accentHex);

  // Step 2/6 — brand / on-brand: directional lightness search at the seed's
  // own hue (or a default hue + chroma floor for a near-grey seed).
  //
  // A near-grey seed's OWN lightness is not a safe search starting point:
  // a seed like #fafafa sits at the gamut's white TIP, where essentially no
  // chroma is available at any hue — the MIN_BRAND_CHROMA floor set below
  // would be gamut-clamped straight back to ~0 before the search even
  // moves. (Caught by the property test against #fafafa in dark scheme —
  // see Phase 4 notes.) A near-grey seed carries no real hue opinion
  // anyway, so the search starts from a mid-lightness with full chroma
  // headroom at every hue instead of the seed's own extreme.
  const NEAR_GREY_BRAND_START_L = 0.55;
  const searchChroma = isNearGrey ? MIN_BRAND_CHROMA : seed.C;
  const searchHue = isNearGrey ? 0 : seed.H;
  const searchStartL = isNearGrey ? NEAR_GREY_BRAND_START_L : seed.L;
  let brand = searchBrandLightness(
    scheme,
    surfaceHex,
    searchStartL,
    searchChroma,
    searchHue,
  );
  let brandHue = searchHue;

  if (isNearGrey) {
    adjustments.push({
      role: "brand",
      scheme,
      message:
        "Your colour is very close to grey, with no clear hue of its own. " +
        "A modest amount of colour was added so links and buttons stay " +
        "visibly different from ordinary body text.",
    });
  }

  // Step 7 — fallback: gamut clipping collapsed a genuinely-coloured seed's
  // chroma near zero at the lightness step 6 needed. Try a bounded hue nudge
  // and keep it only if it recovers meaningfully more chroma.
  if (!isNearGrey && brand.C < MIN_BRAND_CHROMA) {
    let best = { ...brand, H: brandHue };
    for (const dh of HUE_NUDGE_CANDIDATES_DEG) {
      const nudgedH = ((brandHue + dh) % 360 + 360) % 360;
      const candidate = searchBrandLightness(
        scheme,
        surfaceHex,
        seed.L,
        searchChroma,
        nudgedH,
      );
      if (candidate.C > best.C) best = { ...candidate, H: nudgedH };
    }
    if (best.H !== brandHue && best.C > brand.C) {
      brand = { hex: best.hex, L: best.L, C: best.C };
      brandHue = best.H;
      adjustments.push({
        role: "brand",
        scheme,
        message:
          "Your colour needed to move a little to stay readable at the " +
          "lightness buttons and links need. The hue was nudged slightly " +
          "rather than draining the colour out of it.",
      });
    }
  }

  const onBrand = pickAchromaticForeground(brand.hex);

  // Step 8 — ring := brand, verbatim. D4 closed structurally by the offset.
  const ringHex = brand.hex;

  // Step 9 — danger/on-danger/border/input-border/muted-surface untouched;
  // the D6 hue-distance check against the FINAL brand hue.
  const dangerHue = oklchOf(copyPlatform("danger")).H;
  const distance = hueDistanceDeg(brandHue, dangerHue);
  if (distance < MIN_BRAND_DANGER_HUE_DISTANCE_DEG) {
    adjustments.push({
      role: "danger",
      scheme,
      message:
        "Your colour sits close to the platform's alert colour. Buttons " +
        "and links still use your colour unchanged; the alert colour is " +
        "not derived from yours and stays fixed so Delete never looks " +
        "like Save.",
    });
  }

  return {
    surface: surfaceHex,
    "on-surface": onSurface,
    brand: brand.hex,
    "on-brand": onBrand,
    "brand-raw": brandRawHex,
    "on-brand-raw": onBrandRaw,
    "muted-surface": copyPlatform("muted-surface"),
    "on-muted-surface": copyPlatform("on-muted-surface"),
    accent: accentHex,
    "on-accent": onAccent,
    border: copyPlatform("border"),
    "input-border": copyPlatform("input-border"),
    ring: ringHex,
    danger: copyPlatform("danger"),
    "on-danger": copyPlatform("on-danger"),
  };
}

/* ---------------------------------------------------------------------------
 * Public entry point.
 * ------------------------------------------------------------------------ */

const SEED_HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Seed hex -> two independently-derived token sets + adjustments. Pure and
 * deterministic (D8): the same seed always produces the same output for a
 * given `BRAND_TOKEN_VERSION`.
 */
export function generateBrandTokens(seedHex: string): GeneratedBrand {
  if (!SEED_HEX_RE.test(seedHex)) {
    throw new Error(
      `generateBrandTokens: seed must be a 6-digit hex colour ` +
        `(#rrggbb), got ${JSON.stringify(seedHex)}.`,
    );
  }

  // Step 1 — parse and convert.
  const seed = oklchOf(seedHex);

  // Step 2 — classify near-grey.
  const isNearGrey = seed.C < NEAR_GREY_CHROMA_THRESHOLD;

  const adjustments: BrandAdjustment[] = [];
  const light = deriveScheme("light", seed, isNearGrey, adjustments);
  const dark = deriveScheme("dark", seed, isNearGrey, adjustments);

  // Sanity: every role produced for every scheme. Cheap and catches a typo
  // in either literal object above at the first call, not at a property-test
  // failure three files away.
  for (const role of BRAND_ROLES) {
    if (!(role in light) || !(role in dark)) {
      throw new Error(`generateBrandTokens: role "${role}" was not produced`);
    }
  }

  return {
    tokens: { version: BRAND_TOKEN_VERSION, light, dark },
    adjustments,
  };
}
