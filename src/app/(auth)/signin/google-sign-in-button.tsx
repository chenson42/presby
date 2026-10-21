import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";

/**
 * Google's own sign-in button (DECISION-190). This file is the SOLE exemption
 * from the palette-literal ban in docs/ui-standards.md: these are a third
 * party's published brand colours, not PresbyPortal design tokens, so they
 * live here as one typed constant and are applied as element-scoped `--gsi-*`
 * custom properties. They are never declared in `globals.css` and never added
 * to `TOKEN_POLICY` (src/lib/brand/contract.ts), and an org's brand cannot
 * repaint them, because a brand re-declares `--primary`/`--ring`, never these.
 *
 * Source: https://developers.google.com/identity/branding-guidelines, re-read
 * 2026-10-21 when this was written. Published values (light / dark):
 * fill #FFFFFF / #131314, 1px inside stroke #747775 / #8E918F, label
 * #1F1F1F / #E3E3E3. The page publishes no hover/pressed/disabled colours,
 * so those are Material state layers (8% hover, 12% pressed, 12% fill and 38%
 * label for disabled) pre-composited onto the fill to opaque hex, because
 * contrast.ts cannot read alpha.
 *
 * Recorded departure: Google asks for Google Sans Medium. We load no font and
 * use the platform sans (DECISION-190).
 */
export const GOOGLE_BUTTON = {
  light: {
    fill: "#FFFFFF",
    stroke: "#747775",
    text: "#1F1F1F",
    hover: "#EEEEEE",
    pressed: "#E6E6E6",
    disabledFill: "#E4E4E4",
    disabledStroke: "#E4E4E4",
    disabledText: "#999999",
  },
  dark: {
    fill: "#131314",
    stroke: "#8E918F",
    text: "#E3E3E3",
    hover: "#242425",
    pressed: "#2C2C2D",
    disabledFill: "#131314",
    disabledStroke: "#222223",
    disabledText: "#626263",
  },
  mark: {
    red: "#EA4335",
    blue: "#4285F4",
    yellow: "#FBBC05",
    green: "#34A853",
  },
} as const;

const L = GOOGLE_BUTTON.light;
const D = GOOGLE_BUTTON.dark;

/** The element-scoped custom properties; exported so the test can read them. */
export const GSI_STYLE = {
  "--gsi-fill": L.fill,
  "--gsi-stroke": L.stroke,
  "--gsi-text": L.text,
  "--gsi-hover": L.hover,
  "--gsi-pressed": L.pressed,
  "--gsi-disabled-fill": L.disabledFill,
  "--gsi-disabled-stroke": L.disabledStroke,
  "--gsi-disabled-text": L.disabledText,
  "--gsi-fill-dark": D.fill,
  "--gsi-stroke-dark": D.stroke,
  "--gsi-text-dark": D.text,
  "--gsi-hover-dark": D.hover,
  "--gsi-pressed-dark": D.pressed,
  "--gsi-disabled-fill-dark": D.disabledFill,
  "--gsi-disabled-stroke-dark": D.disabledStroke,
  "--gsi-disabled-text-dark": D.disabledText,
} as CSSProperties;

/**
 * Every class carries the `color:` type hint so tailwind-merge in `cn()`
 * recognises it as the same group as the primitive's own `bg-` / `border-` /
 * `text-` colour classes and REPLACES them (a bare `bg-[var(--x)]` is
 * ambiguous and would coexist). e2e/branded-signin.spec.ts asserts the
 * computed colour in both schemes.
 */
const COLOR_CLASSES = [
  "bg-[color:var(--gsi-fill)] border-[color:var(--gsi-stroke)] text-[color:var(--gsi-text)]",
  "hover:bg-[color:var(--gsi-hover)] hover:text-[color:var(--gsi-text)]",
  "active:bg-[color:var(--gsi-pressed)]",
  "disabled:bg-[color:var(--gsi-disabled-fill)] disabled:border-[color:var(--gsi-disabled-stroke)] disabled:text-[color:var(--gsi-disabled-text)]",
  "dark:bg-[color:var(--gsi-fill-dark)] dark:border-[color:var(--gsi-stroke-dark)] dark:text-[color:var(--gsi-text-dark)]",
  "dark:hover:bg-[color:var(--gsi-hover-dark)] dark:hover:text-[color:var(--gsi-text-dark)]",
  "dark:active:bg-[color:var(--gsi-pressed-dark)]",
  "dark:disabled:bg-[color:var(--gsi-disabled-fill-dark)] dark:disabled:border-[color:var(--gsi-disabled-stroke-dark)] dark:disabled:text-[color:var(--gsi-disabled-text-dark)]",
].join(" ");

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 48 48"
      className="size-[18px] shrink-0"
    >
      <path
        fill={GOOGLE_BUTTON.mark.red}
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill={GOOGLE_BUTTON.mark.blue}
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill={GOOGLE_BUTTON.mark.yellow}
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill={GOOGLE_BUTTON.mark.green}
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** A submit button for use inside the server-action `<form>` in page.tsx. */
export function GoogleSignInButton() {
  return (
    <Button
      type="submit"
      variant="outline"
      style={GSI_STYLE}
      className={`min-h-[44px] w-full gap-3 ${COLOR_CLASSES}`}
    >
      <GoogleMark />
      Sign in with Google
    </Button>
  );
}
