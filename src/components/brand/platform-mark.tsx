/**
 * The platform's own logo — PresbyPortal Brand Guidelines v1.0
 * (docs/work-log/2026-08-27-presbyportal-brand-kit.md, DECISION-127). Static
 * SVG assets in public/brand/, never per-org data — distinct from
 * OrgMark/OrgWordmark (./org-mark.tsx), which render an uploaded
 * congregation's own logo. This is the platform's own identity: it renders
 * everywhere, platform chrome and marketing alike, and is NOT subject to
 * DECISION-047's two-route-group brand-scope split (that split gates the
 * per-org `<BrandTokens>` cascade, not the platform's own fixed mark).
 *
 * Plain `<img src>`, matching OrgMark's own convention — no next/image
 * benefit for a small static SVG, and it keeps this file dependency-free.
 */

import { cn } from "@/lib/utils";

const SOURCES = {
  horizontal: "/brand/presbyportal-logo-horizontal.svg",
  "horizontal-reverse": "/brand/presbyportal-logo-horizontal-reverse.svg",
  stacked: "/brand/presbyportal-logo-stacked.svg",
} as const;

export type PlatformWordmarkVariant = keyof typeof SOURCES;

export interface PlatformWordmarkProps {
  /** `horizontal` (default, light backgrounds) · `horizontal-reverse` (navy
   * or other dark backgrounds — the mark and wordmark render in white) ·
   * `stacked` (narrow spaces, per the brand kit's own guidance). */
  variant?: PlatformWordmarkVariant;
  /** Pixel height; width follows the asset's own aspect ratio. */
  heightPx?: number;
  className?: string;
}

/**
 * Rendered on plain `bg-background`, which flips from near-white to
 * near-black navy under `.dark` (P0.5 slice a) — the light-background
 * lockup's navy/blue ink reads as nearly invisible on that dark surface.
 * `variant="horizontal"` (the default) therefore renders BOTH the light and
 * reverse images, toggled by Tailwind's `dark:` class (matching the theming
 * system's own class-based, not `prefers-color-scheme`, strategy) — only
 * `horizontal` has a reverse counterpart in the kit, so `stacked` renders a
 * single image and does not dark-swap.
 *
 * Both images carry `alt=""`/`aria-hidden` rather than the visible name:
 * a link wrapping this component with two `alt="PresbyPortal"` images would
 * get an accessible name of "PresbyPortal PresbyPortal" (accname
 * concatenates every child's text alternative — CSS `display:none` removes
 * an element from the a11y tree in a real browser, but jsdom/vitest doesn't
 * execute compiled Tailwind, so both would also appear "visible" to a test).
 * Callers MUST put `aria-label="PresbyPortal"` on the wrapping link/element
 * instead.
 */
export function PlatformWordmark({
  variant = "horizontal",
  heightPx = 24,
  className,
}: PlatformWordmarkProps) {
  const style = { height: heightPx, width: "auto" } as const;

  if (variant === "horizontal") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, same convention as OrgMark/OrgWordmark */}
        <img
          src={SOURCES.horizontal}
          alt=""
          aria-hidden="true"
          height={heightPx}
          style={style}
          className={cn(className, "dark:hidden")}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, same convention as OrgMark/OrgWordmark */}
        <img
          src={SOURCES["horizontal-reverse"]}
          alt=""
          aria-hidden="true"
          height={heightPx}
          style={style}
          className={cn(className, "hidden dark:block")}
        />
      </>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset, same convention as OrgMark/OrgWordmark
    <img
      src={SOURCES[variant]}
      alt="PresbyPortal"
      height={heightPx}
      style={style}
      className={className}
    />
  );
}

const MARK_SOURCES = {
  default: "/brand/presbyportal-mark.svg",
  reverse: "/brand/presbyportal-mark-reverse.svg",
} as const;

export interface PlatformMarkProps {
  /** `default` (navy arch, light backgrounds) · `reverse` (white arch, dark
   * or coloured backgrounds — cropped straight from the reverse wordmark's
   * own mark, since the kit ships no standalone reverse mark file). */
  variant?: keyof typeof MARK_SOURCES;
  /** Pixel height; omit (with `decorative`) to size purely via `className`. */
  heightPx?: number;
  /**
   * Purely decorative background texture (e.g. the marketing hero's
   * watermark) rather than a logo instance: `alt=""` + `aria-hidden`, no
   * forced inline height — `className` controls sizing/position entirely.
   */
  decorative?: boolean;
  className?: string;
}

/** Square mark only — the arch/threshold glyph, no wordmark text. */
export function PlatformMark({
  variant = "default",
  heightPx = 24,
  decorative = false,
  className,
}: PlatformMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset, same convention as OrgMark/OrgWordmark
    <img
      src={MARK_SOURCES[variant]}
      alt={decorative ? "" : "PresbyPortal"}
      aria-hidden={decorative ? "true" : undefined}
      height={decorative ? undefined : heightPx}
      style={decorative ? undefined : { height: heightPx, width: "auto" }}
      className={className}
    />
  );
}
