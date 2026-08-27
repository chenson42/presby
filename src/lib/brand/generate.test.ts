import { describe, it, expect } from "vitest";
import {
  LEGAL_PAIRS,
  MIN_BRAND_DANGER_HUE_DISTANCE_DEG,
  PLATFORM_TOKENS,
  BRAND_TOKEN_VERSION,
  BRAND_ROLES,
  type Scheme,
} from "./contract";
import { contrastRatio, relativeLuminance, parseColor } from "./contrast";
import { generateBrandTokens, oklchOf, type SchemeTokens } from "./generate";
import darkSchemeGolden from "./__fixtures__/dark-scheme-golden.json";

/**
 * The generator's own proof — the single highest-value artifact in this
 * slice (Phase 3 design, commit `b1`).
 *
 * A DETERMINISTIC grid, not a fuzzer (DECISION-057): every 5 degrees of hue
 * (72 values) crossed with four HSL saturation/lightness bands standing in
 * for "chroma bands," plus six named edge seeds Phase 1's Flow 3 and G2
 * called out by name — pure grey, near-black, near-white, a hue inside the
 * destructive band, gold, lime. A CI failure is reproducible by the printed
 * seed value alone, the same property DECISION-057 asks of it.
 *
 * Every seed is checked in BOTH schemes (D11) against EVERY `LEGAL_PAIRS`
 * entry, reading `min` FROM THE PAIR exactly as `contract.test.ts` does —
 * so DECISION-054's accent pair is exercised automatically, with no
 * restatement of D1-D6 here. Three more properties ride along per seed/
 * scheme: D7's near-white/near-dark background band, D6's "danger is
 * platform-fixed, never derived," and "hue-distance-from-danger clears the
 * floor OR an adjustment names it" (never a silent miss, never a forced
 * shift that would violate D10).
 */

const HUE_STEP_DEG = 5;
const HUES = Array.from({ length: 360 / HUE_STEP_DEG }, (_, i) => i * HUE_STEP_DEG);

/** Four bands standing in for "chroma": two mid-saturation, one vivid, one
 * deep/dark-vivid — chosen to cross the gamut's interesting regions rather
 * than to model OKLCH chroma numerically (the grid only needs diversity of
 * real sRGB seeds, not a specific colour-science parameterisation). */
const BANDS: ReadonlyArray<{ s: number; l: number; label: string }> = [
  { s: 0.4, l: 0.5, label: "muted-mid" },
  { s: 0.7, l: 0.5, label: "saturated-mid" },
  { s: 0.9, l: 0.65, label: "vivid-light" },
  { s: 0.95, l: 0.35, label: "vivid-deep" },
];

function hslToHex(hDeg: number, s: number, l: number): string {
  const h = ((hDeg % 360) + 360) % 360;
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
  const to255 = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

type GridSeed = { hex: string; label: string };

const GRID_SEEDS: GridSeed[] = HUES.flatMap((h) =>
  BANDS.map((band) => ({
    hex: hslToHex(h, band.s, band.l),
    label: `hue ${h} deg, ${band.label}`,
  })),
);

/** Named edge seeds from Phase 1's Flow 3 and G2, by name. */
const EDGE_SEEDS: GridSeed[] = [
  { hex: "#808080", label: "pure grey" },
  { hex: "#050505", label: "near-black" },
  { hex: "#fafafa", label: "near-white" },
  { hex: "#e63946", label: "hue inside the destructive band" },
  { hex: "#ffd700", label: "gold" },
  { hex: "#00ff00", label: "lime" },
];

const ALL_SEEDS: GridSeed[] = [...GRID_SEEDS, ...EDGE_SEEDS];

const SCHEMES: readonly Scheme[] = ["light", "dark"];

function hueDistanceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Key-order-independent stringify, for byte-identity comparisons against a
 * fixture serialized by a different process (JSON key insertion order is
 * not semantically meaningful and must not make an otherwise-identical
 * object fail an equality check).
 */
function stableStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = obj[key];
        return acc;
      }, {}),
  );
}

describe(`property grid: ${GRID_SEEDS.length} grid seeds (${HUES.length} hues x ${BANDS.length} bands) + ${EDGE_SEEDS.length} named edge seeds, x ${SCHEMES.length} schemes`, () => {
  for (const seed of ALL_SEEDS) {
    for (const scheme of SCHEMES) {
      it(`${seed.hex} (${seed.label}), ${scheme}: every legal pair, D7, D6, hue-distance-or-adjustment`, () => {
        const generated = generateBrandTokens(seed.hex);
        const tokens: SchemeTokens = generated.tokens[scheme];

        // Every LEGAL_PAIRS entry clears ITS OWN floor, min read from the
        // pair — same discipline as contract.test.ts, so DECISION-054's
        // accent pair needs no separate assertion.
        for (const pair of LEGAL_PAIRS) {
          const fg = tokens[pair.fg];
          const bg = tokens[pair.bg];
          const ratio = contrastRatio(fg, bg);
          expect(
            ratio,
            `seed ${seed.hex} (${seed.label}) ${scheme}: ${pair.fg} (${fg}) ` +
              `on ${pair.bg} (${bg}) is ${ratio.toFixed(2)}:1, floor ${pair.min}:1 (${pair.derives})`,
          ).toBeGreaterThanOrEqual(pair.min);
        }

        // D7: background stays inside the near-white / near-dark band.
        const bgLum = relativeLuminance(parseColor(tokens.surface));
        if (scheme === "light") {
          expect(
            bgLum,
            `seed ${seed.hex} light surface ${tokens.surface} has relative luminance ${bgLum.toFixed(3)}, expected near-white (D7)`,
          ).toBeGreaterThanOrEqual(0.85);
        } else {
          expect(
            bgLum,
            `seed ${seed.hex} dark surface ${tokens.surface} has relative luminance ${bgLum.toFixed(3)}, expected near-dark (D7)`,
          ).toBeLessThanOrEqual(0.1);
        }

        // D6: danger/on-danger untouched from PLATFORM_TOKENS, for every seed.
        expect(tokens.danger).toBe(PLATFORM_TOKENS[scheme]["--destructive"]);
        expect(tokens["on-danger"]).toBe(
          PLATFORM_TOKENS[scheme]["--destructive-foreground"],
        );

        // D6/D10: hue-distance-from-danger clears the minimum, OR an
        // adjustment names it — never a silent miss, never a forced shift.
        const brandHue = oklchOf(tokens.brand).H;
        const dangerHue = oklchOf(tokens.danger).H;
        const distance = hueDistanceDeg(brandHue, dangerHue);
        const named = generated.adjustments.some(
          (a) => a.role === "danger" && (a.scheme === scheme || a.scheme === "both"),
        );
        expect(
          distance >= MIN_BRAND_DANGER_HUE_DISTANCE_DEG || named,
          `seed ${seed.hex} ${scheme}: brand hue ${brandHue.toFixed(1)} is ` +
            `${distance.toFixed(1)} deg from danger hue ${dangerHue.toFixed(1)} ` +
            `(floor ${MIN_BRAND_DANGER_HUE_DISTANCE_DEG}), and no adjustment names it`,
        ).toBe(true);

        // Button-modernization (docs/work-log/2026-08-27-button-
        // modernization.md, Phase 3(d)(1)(2)): light scheme ONLY —
        // searchBrandLightness's tightened stopping condition means white
        // text must clear D2 (4.5:1) against `brand`, and
        // pickAchromaticForeground must legitimately resolve to white, not
        // merely "some achromatic colour clears 4.5:1" (which the generic
        // LEGAL_PAIRS loop above already proves, but does not distinguish
        // black from white). Dark scheme is untouched by this change — see
        // the separate golden-fixture byte-identity describe block below.
        if (scheme === "light") {
          const whiteRatio = contrastRatio("#ffffff", tokens.brand);
          expect(
            whiteRatio,
            `seed ${seed.hex} (${seed.label}) light: white-on-brand (${tokens.brand}) ` +
              `is ${whiteRatio.toFixed(2)}:1, expected >=4.5 (D2, button-modernization)`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            tokens["on-brand"],
            `seed ${seed.hex} (${seed.label}) light: on-brand resolved to ` +
              `${tokens["on-brand"]}, expected "#ffffff"`,
          ).toBe("#ffffff");
        }
      });
    }
  }
});

describe("D10: a near-grey seed does not let brand collapse into muted-surface's chroma range", () => {
  const nearGreySeeds = ["#808080", "#050505", "#fafafa", "#7a7a7a", "#8c8c8c"];

  for (const seed of nearGreySeeds) {
    for (const scheme of SCHEMES) {
      it(`${seed}, ${scheme}: brand carries more chroma than muted-surface`, () => {
        const generated = generateBrandTokens(seed);
        const tokens = generated.tokens[scheme];
        const brandChroma = oklchOf(tokens.brand).C;
        const mutedChroma = oklchOf(tokens["muted-surface"]).C;

        expect(
          brandChroma,
          `seed ${seed} ${scheme}: brand chroma ${brandChroma.toFixed(4)} did not exceed ` +
            `muted-surface's ${mutedChroma.toFixed(4)} — links would be indistinguishable from body text`,
        ).toBeGreaterThan(mutedChroma);

        // And the generator must have said so — D12, non-empty adjustments
        // surfaced before save.
        expect(
          generated.adjustments.some(
            (a) => a.role === "brand" && a.scheme === scheme,
          ),
        ).toBe(true);
      });
    }
  }
});

describe("D8: determinism and versioning", () => {
  it("the same seed produces byte-identical output every time", () => {
    const a = generateBrandTokens("#2563eb");
    const b = generateBrandTokens("#2563eb");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("stamps the current BRAND_TOKEN_VERSION", () => {
    const g = generateBrandTokens("#2563eb");
    expect(g.tokens.version).toBe(BRAND_TOKEN_VERSION);
  });

  it("two different seeds produce different output", () => {
    const a = generateBrandTokens("#2563eb");
    const b = generateBrandTokens("#e63946");
    expect(a.tokens.light.brand).not.toBe(b.tokens.light.brand);
  });
});

describe("D11: both schemes are derived independently, not a CSS inversion", () => {
  it("light and dark surfaces are not simple photographic negatives", () => {
    const g = generateBrandTokens("#2563eb");
    const light = parseColor(g.tokens.light.surface);
    const dark = parseColor(g.tokens.dark.surface);
    // An inversion would put dark's channels near (255-light). Assert the
    // opposite holds: dark is a genuinely independent near-black tint of
    // the SAME seed hue, not light's arithmetic complement.
    const inverted = { r: 255 - light.r, g: 255 - light.g, b: 255 - light.b };
    const distance = Math.hypot(
      dark.r - inverted.r,
      dark.g - inverted.g,
      dark.b - inverted.b,
    );
    expect(distance).toBeGreaterThan(20);
  });

  it("brand is derived per scheme, not shared", () => {
    // For most seeds the two schemes' brand values differ (light darkens
    // toward the seed's own lightness, dark lightens); this is not asserted
    // as a strict inequality for every seed because a very dark seed can
    // legitimately need little adjustment in the light scheme while needing
    // real adjustment in dark — checked instead across the full edge set.
    let anyDiffer = false;
    for (const seed of EDGE_SEEDS) {
      const g = generateBrandTokens(seed.hex);
      if (g.tokens.light.brand !== g.tokens.dark.brand) anyDiffer = true;
    }
    expect(anyDiffer).toBe(true);
  });
});

describe("ring := brand, verbatim (D4 is structural, not a second search)", () => {
  for (const seed of EDGE_SEEDS) {
    for (const scheme of SCHEMES) {
      it(`${seed.hex} ${scheme}`, () => {
        const g = generateBrandTokens(seed.hex);
        expect(g.tokens[scheme].ring).toBe(g.tokens[scheme].brand);
      });
    }
  }
});

describe("every generated scheme covers the full closed role vocabulary", () => {
  it("BRAND_ROLES is total over both schemes", () => {
    const g = generateBrandTokens("#2563eb");
    for (const role of BRAND_ROLES) {
      for (const scheme of SCHEMES) {
        expect(typeof g.tokens[scheme][role]).toBe("string");
        expect(g.tokens[scheme][role].length).toBeGreaterThan(0);
      }
    }
  });
});

describe("D12: adjustments are data, not a UI nicety", () => {
  it("returns an empty array for a seed with no findings", () => {
    // A well-separated, already-legible blue: no near-grey, no danger-hue
    // collision, no gamut-forced hue nudge expected.
    const g = generateBrandTokens("#2563eb");
    expect(g.adjustments).toEqual([]);
  });

  it("every adjustment names a role from the closed vocabulary and a real scheme", () => {
    const g = generateBrandTokens("#808080");
    expect(g.adjustments.length).toBeGreaterThan(0);
    for (const adj of g.adjustments) {
      expect(BRAND_ROLES).toContain(adj.role);
      expect(["light", "dark", "both"]).toContain(adj.scheme);
      expect(adj.message.length).toBeGreaterThan(20);
    }
  });
});

describe("malformed input", () => {
  it("throws on a seed that is not a 6-digit hex colour", () => {
    expect(() => generateBrandTokens("blue")).toThrow();
    expect(() => generateBrandTokens("#fff")).toThrow();
    expect(() => generateBrandTokens("rgb(1,2,3)")).toThrow();
    expect(() => generateBrandTokens("#gggggg")).toThrow();
  });
});

describe("button-modernization (docs/work-log/2026-08-27-button-modernization.md): dark scheme untouched", () => {
  /**
   * Golden-fixture byte-identity check, per Phase 3(d)(3) — the strongest
   * available proof that the light-scheme-only stopping-condition change in
   * `searchBrandLightness` did not leak into dark. `dark-scheme-golden.json`
   * was captured from the PRE-change generator (git HEAD at the start of
   * this commit) for every entry in `ALL_SEEDS`, before the stopping
   * condition was tightened. A regression that accidentally applied
   * white-forcing (or anything else) to dark would change at least one
   * seed's `tokens.dark` and fail this loop.
   */
  it("every seed's tokens.dark is byte-identical to the pre-change golden fixture", () => {
    for (const seed of ALL_SEEDS) {
      const generated = generateBrandTokens(seed.hex);
      const golden = (darkSchemeGolden as Record<string, SchemeTokens>)[
        seed.hex
      ];
      expect(
        golden,
        `seed ${seed.hex} (${seed.label}) has no golden fixture entry — ` +
          `dark-scheme-golden.json and ALL_SEEDS have drifted apart`,
      ).toBeDefined();
      expect(
        stableStringify(generated.tokens.dark),
        `seed ${seed.hex} (${seed.label}): tokens.dark differs from the ` +
          `pre-change golden fixture — the light-scheme-only stopping ` +
          `condition change leaked into dark`,
      ).toBe(stableStringify(golden));
    }
  });

  /**
   * Fallback-condition sanity check (Phase 3(d)(3)(ii)): confirm the dark
   * golden fixture itself is falsifiable — i.e. it is NOT the case that
   * every edge seed's dark on-brand already resolved to white before this
   * change (which would make a naive "dark still resolves white sometimes"
   * check unable to catch a white-forcing regression). At least one edge
   * seed's dark on-brand is black in the golden fixture.
   */
  it("the golden fixture is falsifiable: at least one edge seed's dark on-brand is black", () => {
    const anyBlack = EDGE_SEEDS.some(
      (seed) =>
        (darkSchemeGolden as Record<string, SchemeTokens>)[seed.hex][
          "on-brand"
        ] === "#000000",
    );
    expect(anyBlack).toBe(true);
  });
});

describe("button-modernization: no-op case for a seed already darker than the white floor", () => {
  /**
   * Phase 3(a)'s "no-op case" argument, made concrete: hue 240 vivid-deep
   * (#0404ae, a GRID_SEEDS entry) already clears both D3 and the white
   * floor at its OWN starting lightness pre-change (white-on-brand measured
   * ~12.85:1 against the pre-change generator) — `searchBrandLightness`
   * returns on its first iteration (i=0, L=startL) both before and after
   * this change, so `tokens.light.brand` is untouched and byte-identical to
   * the seed's own raw hex (recomputed through the same OKLCH round-trip,
   * not merely echoed).
   */
  it("#0404ae (hue 240, vivid-deep): light.brand is unchanged — zero-iteration return", () => {
    const g = generateBrandTokens("#0404ae");
    expect(g.tokens.light.brand).toBe("#0404ae");
    expect(g.tokens.light["brand-raw"]).toBe("#0404ae");
  });
});

describe("the hue-nudge safety net (step 7) — finding, recorded", () => {
  /**
   * Across the full grid above (294 seeds x 2 schemes = 588 derivations),
   * the bounded hue-nudge fallback never actually fired: gamut clipping at
   * the lightness D3's search settles on never collapsed a non-near-grey
   * seed's chroma below MIN_BRAND_CHROMA. This is not a coincidence the
   * design predicted casually — see the WCAG luminance-gap proof in
   * `generate.ts`'s header: D2 (4.5:1) is always closeable by moving TEXT
   * alone, and D7's near-white/near-dark bound is what keeps D3's own
   * search from ever needing more than a lightness move at the seed's own
   * hue. The assertion below keeps that finding honest — if a future
   * palette or a wider grid ever exercises the nudge, this test names it
   * rather than letting the safety net go silently unverified.
   */
  it("never fires across the full property grid (documented, not required)", () => {
    let nudged = 0;
    for (const seed of ALL_SEEDS) {
      const g = generateBrandTokens(seed.hex);
      if (g.adjustments.some((a) => a.message.includes("nudged"))) nudged++;
    }
    // Not a correctness requirement — a future palette IS allowed to hit
    // this path. Recorded as an explicit expectation so a change in this
    // number is a deliberate, reviewed diff rather than a silent drift.
    expect(nudged).toBe(0);
  });
});
