import {
  BRAND_ROLES,
  BRAND_SCOPE_SELECTOR,
  BRAND_SCOPE_SELECTOR_DARK,
  ROLE_TO_TOKEN,
  TOKEN_POLICY,
  type PlatformTokenName,
} from "@/lib/brand/contract";
import type { BrandTokenSet, SchemeTokens } from "@/lib/brand/generate";

/**
 * THE brand-scope marker (DECISION-052). This component IS the `:root`-scoped
 * `<style>` element — not a wrapper `<div>` and not a `data-brand-scope`
 * attribute on one. That is the whole point: a wrapper div does nothing for
 * anything Radix renders into a portal (`DropdownMenu.Portal`, `Dialog.Portal`,
 * `<Toaster>` in the root layout), all of which land outside any element this
 * layout could wrap. A `:root`-scoped rule reaches them; a scoped class on a
 * div does not. Making the emitting component the grep target also collapses
 * "the marker is present" and "the brand actually renders" into one fact —
 * `scripts/check-brand-scope.mjs`'s E1/E2/E3 rules grep for `<BrandTokens`
 * and for a stray `<style` or `dangerouslySetInnerHTML` outside this
 * directory, and both checks are true exactly when the real behaviour is.
 *
 * P0.5 slice c, commit `c4` — first real consumer. Design:
 * docs/work-log/2026-08-19-brand-foundation.md, Phase 3 §"Server-side
 * emission with no client theme provider" (0/a) and Phase 3 (re-run) commit
 * `c4` (b/c/e).
 *
 * NULL RENDERS NULL. This is the mechanism that keeps the DECISION-040
 * access-denied / ended / 404 pages un-branded: `read-org-brand.ts` returns
 * `null` for a non-member (and for the flag being off, and for an org with no
 * brand row), and this component never gates or redirects on its own — it
 * simply has nothing to emit. A branded 403 would tell a prober the org is a
 * configured tenant; DECISION-040's byte-identical-copy guarantee never has
 * to know this component exists.
 *
 * BOTH SCHEMES, ONE ELEMENT (DECISION-050). `brand.light` populates
 * `:root:root` and `brand.dark` populates `:root:root.dark` in the SAME
 * `<style>` tag, because `next-themes` selects between them with a class —
 * emitting only the "current" scheme server-side would force a re-render on
 * toggle and reintroduce exactly the flash next-themes exists to prevent.
 *
 * `:root:root` / `:root:root.dark` rather than plain `:root`/`.dark`:
 * specificity (0,2,0 and 0,2,1 respectively) beats `globals.css`'s `:root`
 * regardless of where React actually places this `<style>` tag in the
 * document relative to the stylesheet — source-order dependence is exactly
 * the kind of defect that passes `tsc`, `next build`, and a page screenshot.
 *
 * PLAIN STRING CHILD, NEVER `dangerouslySetInnerHTML`. React 19 renders a
 * text child of `<style>` verbatim, and every value here is a colour string
 * produced by `generateBrandTokens()` from PARSED numbers (A7) — never the
 * organization's raw input echoed back — so it never contains `<` or `&`.
 * `scripts/check-brand-scope.mjs`'s E3 rule enforces that no second emitter
 * exists anywhere else in the tree.
 *
 * ONLY THE RE-DECLARABLE TOKENS ARE EMITTED. `generateBrandTokens()` returns
 * a value for every `BrandRole`, including the six roles PLATFORM-FIXES
 * verbatim (`muted-surface`, `border`, `danger`, and their pairs — D6, and
 * the closed token partition in `contract.ts`'s `TOKEN_POLICY`). Re-emitting
 * those would be a harmless no-op today (the values are copied from
 * `PLATFORM_TOKENS` unchanged) but it would also be the first crack in the
 * "never re-declarable" rule — a future generator change that stops copying
 * verbatim would silently start branding the roll table's zebra stripe. The
 * filter below is DERIVED from `TOKEN_POLICY` rather than a second
 * hand-maintained list, so the two can never drift.
 */

const REDECLARABLE_TOKENS = new Set<string>(
  TOKEN_POLICY.filter((entry) => entry.policy !== "platform").map(
    (entry) => entry.token,
  ),
);

function declarationBlock(tokens: SchemeTokens): string {
  return BRAND_ROLES.map(
    (role) => [role, ROLE_TO_TOKEN[role] as PlatformTokenName] as const,
  )
    .filter(([, token]) => REDECLARABLE_TOKENS.has(token))
    .map(([role, token]) => `  ${token}: ${tokens[role]};`)
    .join("\n");
}

export interface BrandTokensProps {
  /** `null` renders `null`. THIS is how the 403/ended/404 pages, an
   * unbranded organization, and the flag being off all stay un-branded — by
   * the caller having nothing to pass, never by this component branching on
   * who the caller is. */
  brand: BrandTokenSet | null;
  /** DECISION-024 forward constraint: report-only CSP today, so this is
   * unused until a fork enforces it — but nonce-able from day one means that
   * fork does not have to touch this file to add one. */
  nonce?: string;
}

export function BrandTokens({
  brand,
  nonce,
}: BrandTokensProps): React.ReactElement | null {
  if (!brand) return null;

  const cssText =
    `${BRAND_SCOPE_SELECTOR} {\n${declarationBlock(brand.light)}\n}\n` +
    `${BRAND_SCOPE_SELECTOR_DARK} {\n${declarationBlock(brand.dark)}\n}`;

  return <style nonce={nonce}>{cssText}</style>;
}
