import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BRAND_ROLES,
  PLATFORM_TOKENS,
  ROLE_TO_TOKEN,
  type PlatformTokenName,
  type Scheme,
} from "@/lib/brand/contract";
import type { SchemeTokens } from "@/lib/brand/generate";

/**
 * The `(admin)` operator's live brand preview — P0.5 slice c, commit `c3`.
 *
 * THE C1 TRAP (named three times in this pipeline's design; this file is the
 * reason): `(admin)` sits OUTSIDE `BRANDABLE_PREFIXES` in
 * `scripts/check-brand-scope.mjs`, so a `bg-brand-*`/`text-brand-*` utility
 * class here would resolve to nothing or the platform default — misleading
 * the operator about what is actually about to save. Every colour in this
 * component is therefore an INLINE `style={{ backgroundColor, color }}` built
 * from `generateBrandTokens()`'s already-parsed numbers (A7: never echo a
 * user string; DECISION-047's "logo-as-content is legal wherever the caller
 * is authorized," extended here to a colour swatch). No brand utility class
 * appears anywhere below — grep for `-brand` in this file if that is ever in
 * doubt.
 *
 * Renders a small set of REPRESENTATIVE surfaces, not the whole app (Flow 2:
 * "live preview of three real surfaces"): a masthead band on `brand-raw` (the
 * church's own unmodified colour, D10), a primary action on the derived
 * `brand` fill, body copy on `surface`, and a selected/hover chip on
 * `accent`. Every fill still goes through the real `<Button>`/`<Badge>`
 * primitives (inline `style` wins the cascade over their own `bg-primary`
 * class regardless of specificity) rather than hand-rolled markup, so this
 * file stays clear of `check-brand-scope.mjs`'s C2 rule too.
 */

export interface BrandPreviewSwatchProps {
  tokens: SchemeTokens;
  scheme: Scheme;
  /** Shown in the masthead band — never a real congregation name in a test
   * fixture or a story; callers pass the org's actual name in production. */
  organizationName: string;
  className?: string;
}

export function BrandPreviewSwatch({
  tokens,
  scheme,
  organizationName,
  className,
}: BrandPreviewSwatchProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800",
        className,
      )}
      style={{ backgroundColor: tokens.surface, color: tokens["on-surface"] }}
    >
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">
          {scheme} preview
        </span>
      </div>

      {/* Masthead band — brand-raw, the seed UNMODIFIED (D10). This is how
          the congregation still sees their own colour, not a derived one. */}
      <div
        className="px-4 py-3 text-sm font-semibold"
        style={{
          backgroundColor: tokens["brand-raw"],
          color: tokens["on-brand-raw"],
        }}
      >
        {organizationName}
      </div>

      <div className="space-y-3 p-4">
        <p className="text-sm leading-relaxed">
          Body copy sits on the surface colour and is never brand-tinted —
          this is the AAA (7:1) pair that stays readable at every seed.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            tabIndex={-1}
            className="pointer-events-none"
            style={{ backgroundColor: tokens.brand, color: tokens["on-brand"] }}
          >
            Primary action
          </Button>

          <Badge
            style={{
              backgroundColor: tokens.accent,
              color: tokens["on-accent"],
            }}
          >
            Selected
          </Badge>
        </div>
      </div>
    </div>
  );
}

/**
 * The platform default, expressed in the same `SchemeTokens` shape the
 * generator produces — so an un-branded organization's "current brand" can
 * be rendered through the identical `<BrandPreviewSwatch>` rather than a
 * second bespoke "no branding configured" block (G10: show the default AS IT
 * ACTUALLY RENDERS, not a placeholder sentence).
 */
export function platformSchemeTokens(scheme: Scheme): SchemeTokens {
  const platform = PLATFORM_TOKENS[scheme];
  const entries = BRAND_ROLES.map((role) => {
    const tokenName = ROLE_TO_TOKEN[role] as PlatformTokenName;
    return [role, platform[tokenName]] as const;
  });
  return Object.fromEntries(entries) as SchemeTokens;
}
