/**
 * Font RESOLUTION for the four curated type pairings (`TYPE_PAIRINGS` in
 * `contract.ts`).
 *
 * This file is deliberately NOT `contract.ts`. `next/font/google` calls must
 * be static, module-top-level invocations — the Next.js compiler resolves
 * them at build time by static analysis, not at runtime, so a family cannot
 * be selected by a runtime variable, a function argument, or a switch keyed
 * on one. `contract.ts`'s zero-runtime-imports rule forbids a `next/font`
 * import outright, so the two constraints point at the same design: eight
 * `next/font/google` calls live here, at module scope, one per (pairing x
 * heading/body); `resolveTypePairing()` is a plain object lookup over
 * already-instantiated results, never a dynamic font call.
 *
 * `import type` only from `contract.ts` — the pairing-key type, nothing else.
 * Self-hosted at build time (next/font/google downloads and serves the font
 * files from this origin); no runtime request to Google Fonts ever leaves a
 * member's browser (A8 in Phase 1's adversarial pass — font as a payload).
 *
 * Weight selection, per family, chosen narrow rather than "variable" to keep
 * the self-hosted byte budget down (slice e's own acceptance criterion) while
 * covering the two weights the type scale actually uses: 400 (body/most
 * headings) and 600 (`font-semibold`, TYPE_SCALE's title/section/subhead
 * roles). 700 is kept on each heading face for an explicit bold a future
 * surface may want; body stays at 400/600 since body copy never goes bold.
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

import {
  Lora,
  Source_Sans_3,
  Libre_Franklin,
  Public_Sans,
  Bitter,
  Karla,
  Montserrat,
  Open_Sans,
} from "next/font/google";
import type { TypePairingKey } from "./contract";

/* -------------------------------------------------------------------------
 * classic — Lora / Source Sans 3
 * ---------------------------------------------------------------------- */

const classicHeading = Lora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-heading-classic",
});

const classicBody = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-body-classic",
});

/* -------------------------------------------------------------------------
 * modern — Libre Franklin / Public Sans
 * ---------------------------------------------------------------------- */

const modernHeading = Libre_Franklin({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-heading-modern",
});

const modernBody = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-body-modern",
});

/* -------------------------------------------------------------------------
 * warm — Bitter / Karla
 * ---------------------------------------------------------------------- */

const warmHeading = Bitter({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-heading-warm",
});

const warmBody = Karla({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-body-warm",
});

/* -------------------------------------------------------------------------
 * contemporary — Montserrat / Open Sans
 * ---------------------------------------------------------------------- */

const contemporaryHeading = Montserrat({
  subsets: ["latin"],
  // 800 included (unlike the other three pairings' heading faces): the
  // reference site this pairing recreates sets its h1s at weight 800, and
  // without the real cut the browser would fake-bold 700 — visibly lighter
  // and rounder than the genuine ExtraBold. site-kit's hero h1 asks for
  // 800 with a 700 fallback for the other pairings.
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--font-heading-contemporary",
});

const contemporaryBody = Open_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-body-contemporary",
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
  },
  modern: {
    headingClassName: modernHeading.className,
    bodyClassName: modernBody.className,
    headingVariable: "--font-heading-modern",
    bodyVariable: "--font-body-modern",
  },
  warm: {
    headingClassName: warmHeading.className,
    bodyClassName: warmBody.className,
    headingVariable: "--font-heading-warm",
    bodyVariable: "--font-body-warm",
  },
  contemporary: {
    headingClassName: contemporaryHeading.className,
    bodyClassName: contemporaryBody.className,
    headingVariable: "--font-heading-contemporary",
    bodyVariable: "--font-body-contemporary",
  },
} as const satisfies Record<TypePairingKey, ResolvedTypePairing>;

/**
 * Resolve a curated pairing key to its pre-instantiated `next/font` result.
 * A plain object lookup — every `next/font/google` call already happened at
 * module load, above, so this function performs no font resolution of its
 * own and is safe to call from anywhere `TypePairingKey` is available
 * (server component, the emitter in slice c4, the preview in `/admin/design-system`).
 */
export function resolveTypePairing(key: TypePairingKey): ResolvedTypePairing {
  return RESOLVED_PAIRINGS[key];
}
