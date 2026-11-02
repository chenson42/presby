/**
 * Font RESOLUTION for the four curated type pairings (`TYPE_PAIRINGS` in
 * `contract.ts`).
 *
 * This file is deliberately NOT `contract.ts`. `next/font/local` calls must
 * be static, module-top-level invocations — the Next.js compiler resolves
 * them at build time by static analysis, not at runtime, so a family cannot
 * be selected by a runtime variable, a function argument, or a switch keyed
 * on one. `contract.ts`'s zero-runtime-imports rule forbids a `next/font`
 * import outright, so the two constraints point at the same design: eight
 * `localFont` calls live here, at module scope, one per (pairing x
 * heading/body); `resolveTypePairing()` is a plain object lookup over
 * already-instantiated results, never a dynamic font call.
 *
 * `import type` only from `contract.ts` — the pairing-key type, nothing else.
 *
 * SELF-HOSTED, committed, never fetched (2026-11-01,
 * docs/work-log/2026-11-01-self-host-fonts.md). These faces used to come from
 * `next/font/google`, which makes the BUILD request Google Fonts once per
 * family. Google intermittently answers with an extensionless `/l/font?kit=`
 * URL, which Turbopack mis-parses ("next/font/google queries have exactly one
 * entry", vercel/next.js#99114), so builds failed at random and then
 * production deploys failed. The woff2 files now live in `font-files/<family>/`
 * beside this file (`next/font/local` resolves `src` relative to the calling
 * file), with each family's `OFL.txt`. No build and no member's browser ever
 * contacts Google: next/font serves the files from this origin.
 *
 * One file per family, FULL coverage: a single variable woff2 per family, cut
 * from that family's own upstream variable TTF (github.com/google/fonts
 * `ofl/<family>/`) and subsetted to the union of every unicode subset Google's
 * CSS2 API serves for THAT family (latin, latin-ext, vietnamese, cyrillic,
 * cyrillic-ext, greek, greek-ext, math, symbols and hebrew, each only where the
 * family has it: Karla has latin and latin-ext alone, Open Sans has hebrew).
 * That is the coverage `next/font/google` gave these faces: it emitted an
 * `@font-face` with `unicode-range` per subset. A latin-only file would let
 * Ł, ő, ș, ễ, Cyrillic, Greek and № fall back to Arial mid-word. The weight axis
 * is kept at the range declared below (`weight: "400 700"` and so on), so the
 * browser interpolates real weights; italic is not bundled (nothing asks for
 * it). The range is each face's old weight list: 400-700 for the heading faces,
 * 400-600 for the body faces (body copy never goes bold; 600 is
 * `font-semibold`, TYPE_SCALE's title/section/subhead roles), and 400-800 for
 * Montserrat. `font-files/README.md` records the exact rebuild command, source
 * commit and URLs; `font-coverage.test.ts` parses each woff2 and pins the
 * coverage and the weight range. Two things differ from the old setup, neither
 * visible: the CSS family name, which next/font/local derives from the
 * variable's identifier (`classicHeading`) rather than `Lora`, and the font's
 * internal name, which is "PP Classic Serif" / "PP Classic Sans" for the two
 * families whose licence reserves their name (see `font-files/README.md`).
 * Nothing in `src/` names a family literally.
 *
 * `adjustFontFallback` makes next/font/local generate a metric-matched
 * fallback from the metrics of the named local font (Arial, Times New Roman),
 * as `next/font/google` did from its own table, so the swap from fallback to
 * web font does not shift layout.
 *
 * `preload: false` on all eight faces, deliberately. next/font emits a preload
 * for every font file of every module a route imports, as an HTTP `Link`
 * header, and the (org) and public trees import this module for all four
 * pairings, so with preload on every `/o/*` and `/site/*` page fetched all
 * eight pairing faces (about 720 KB) to draw one. With it off the @font-face
 * rules are still emitted and the browser fetches a file only when text on the
 * page uses it. The platform face (Inter, `src/app/layout.tsx`) keeps its
 * preload. `fonts.test.ts` pins the split. See the work-log's QA run 2 section
 * for the measurements, including layout shift during the swap.
 *
 * `display: "swap"` on every face — the alternative (`block`/`auto`) risks
 * invisible text while the font loads, which a screenshot cannot catch and a
 * slow connection will.
 *
 * Validated per A10 / Edge Case (Phase 3, slice e) against the real UI at
 * 360px, both colour schemes, via `/admin/design-system`'s "Type pairings"
 * section and the visual-parity harness (`e2e/support/routes.ts`) — see the
 * `e1` work-log entry for the screenshot findings. The fourth pairing
 * (`contemporary`, Montserrat / Open Sans) got its own A10 pass at the same
 * route — see `docs/work-log/2026-08-24-custom-brand-fonts.md` Phase 4 for
 * that record.
 *
 * Design: docs/work-log/2026-08-19-brand-foundation.md, Phase 3 (re-run),
 * commit `e1`. `contemporary` added by
 * docs/work-log/2026-08-24-custom-brand-fonts.md, Phase 4.
 */

import localFont from "next/font/local";
import type { TypePairingKey } from "./contract";

/* -------------------------------------------------------------------------
 * classic — Lora / Source Sans 3
 * ---------------------------------------------------------------------- */

const classicHeading = localFont({
  src: "./font-files/lora/lora-variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-heading-classic",
  adjustFontFallback: "Times New Roman",
  fallback: ["serif"],
});

const classicBody = localFont({
  src: "./font-files/source-sans-3/source-sans-3-variable.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-body-classic",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "sans-serif"],
});

/* -------------------------------------------------------------------------
 * modern — Libre Franklin / Public Sans
 * ---------------------------------------------------------------------- */

const modernHeading = localFont({
  src: "./font-files/libre-franklin/libre-franklin-variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-heading-modern",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "sans-serif"],
});

const modernBody = localFont({
  src: "./font-files/public-sans/public-sans-variable.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-body-modern",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "sans-serif"],
});

/* -------------------------------------------------------------------------
 * warm — Bitter / Karla
 * ---------------------------------------------------------------------- */

const warmHeading = localFont({
  src: "./font-files/bitter/bitter-variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-heading-warm",
  adjustFontFallback: "Times New Roman",
  fallback: ["serif"],
});

const warmBody = localFont({
  src: "./font-files/karla/karla-variable.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-body-warm",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "sans-serif"],
});

/* -------------------------------------------------------------------------
 * contemporary — Montserrat / Open Sans
 * ---------------------------------------------------------------------- */

const contemporaryHeading = localFont({
  src: "./font-files/montserrat/montserrat-variable.woff2",
  weight: "400 800",
  style: "normal",
  // 800 included (unlike the other three pairings' heading faces): the
  // reference site this pairing recreates sets its h1s at weight 800, and
  // without the real cut the browser would fake-bold 700 — visibly lighter
  // and rounder than the genuine ExtraBold. site-kit's hero h1 asks for
  // 800 with a 700 fallback for the other pairings.
  display: "swap",
  preload: false,
  variable: "--font-heading-contemporary",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "sans-serif"],
});

const contemporaryBody = localFont({
  src: "./font-files/open-sans/open-sans-variable.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-body-contemporary",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "sans-serif"],
});

/* -------------------------------------------------------------------------
 * Resolution
 * ---------------------------------------------------------------------- */

export type ResolvedTypePairing = {
  /** Apply to the element (or an ancestor) that sets the heading face. */
  readonly headingClassName: string;
  /** Apply to the element (or an ancestor) that sets the body face. */
  readonly bodyClassName: string;
  /** The CSS custom property this pairing's heading face is bound to. */
  readonly headingVariable: string;
  /** The CSS custom property this pairing's body face is bound to. */
  readonly bodyVariable: string;
  /**
   * `next/font`'s own `.variable` class. Applying it to a DOM node DEFINES
   * `headingVariable` on that node (and its descendants) with the real,
   * self-hosted font-stack value — the piece that was missing (DECISION-143).
   * `headingVariable`/`bodyVariable` above are unchanged: they still just
   * name the property.
   */
  readonly headingVariableClassName: string;
  readonly bodyVariableClassName: string;
  /**
   * The static alias class in `globals.css` (`.pairing-<key>`) that maps the
   * generic `--font-heading`/`--font-body` properties onto this pairing's
   * specific ones. String, not a lookup, because the caller already has the
   * resolved pairing and would otherwise need the raw `TypePairingKey` for
   * this alone.
   */
  readonly pairingClassName: string;
};

/**
 * Built once at module scope from the already-instantiated `next/font`
 * results above — never re-derived per call, and never a dynamic font
 * invocation. `satisfies` over `TypePairingKey` keeps this exhaustive: adding
 * a fourth entry to `TYPE_PAIRINGS` without adding it here is a type error,
 * not a silent runtime `undefined`.
 */
const RESOLVED_PAIRINGS = {
  classic: {
    headingClassName: classicHeading.className,
    bodyClassName: classicBody.className,
    headingVariable: "--font-heading-classic",
    bodyVariable: "--font-body-classic",
    headingVariableClassName: classicHeading.variable,
    bodyVariableClassName: classicBody.variable,
    pairingClassName: "pairing-classic",
  },
  modern: {
    headingClassName: modernHeading.className,
    bodyClassName: modernBody.className,
    headingVariable: "--font-heading-modern",
    bodyVariable: "--font-body-modern",
    headingVariableClassName: modernHeading.variable,
    bodyVariableClassName: modernBody.variable,
    pairingClassName: "pairing-modern",
  },
  warm: {
    headingClassName: warmHeading.className,
    bodyClassName: warmBody.className,
    headingVariable: "--font-heading-warm",
    bodyVariable: "--font-body-warm",
    headingVariableClassName: warmHeading.variable,
    bodyVariableClassName: warmBody.variable,
    pairingClassName: "pairing-warm",
  },
  contemporary: {
    headingClassName: contemporaryHeading.className,
    bodyClassName: contemporaryBody.className,
    headingVariable: "--font-heading-contemporary",
    bodyVariable: "--font-body-contemporary",
    headingVariableClassName: contemporaryHeading.variable,
    bodyVariableClassName: contemporaryBody.variable,
    pairingClassName: "pairing-contemporary",
  },
} as const satisfies Record<TypePairingKey, ResolvedTypePairing>;

/**
 * Resolve a curated pairing key to its pre-instantiated `next/font` result.
 * A plain object lookup — every `localFont` call already happened at
 * module load, above, so this function performs no font resolution of its
 * own and is safe to call from anywhere `TypePairingKey` is available
 * (server component, the emitter in slice c4, the preview in `/admin/design-system`).
 */
export function resolveTypePairing(key: TypePairingKey): ResolvedTypePairing {
  return RESOLVED_PAIRINGS[key];
}
