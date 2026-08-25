import {
  BRAND_ROLES,
  BRAND_SCOPE_SELECTOR,
  BRAND_SCOPE_SELECTOR_DARK,
  PLATFORM_TOKENS,
  ROLE_TO_TOKEN,
  TOKEN_POLICY,
  type PlatformTokenName,
  type Scheme,
  type TokenEntry,
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

/**
 * The colour tokens `globals.css`'s bare `.dark` selector controls, that
 * `<BrandTokens>` NEVER re-declares under ordinary circumstances (D6, the
 * closed platform partition) — `--card`, `--popover`, `--muted`,
 * `--secondary`, `--destructive`, `--border`, `--input`, plus their
 * `-foreground` pairs. `light_only` mode (below) is the one narrow,
 * DECISION-050-compatible exception: derived from `TOKEN_POLICY` rather
 * than hand-maintained a second time, so this list can never drift from
 * the one `REDECLARABLE_TOKENS` above is filtered from — excludes
 * `--radius` (`nonColour`, DECISION-048, never brand-driven) and the
 * reserved `--success`/`--warning`/`--info` pairs (not live tokens yet).
 */
const PLATFORM_COLOR_TOKENS: readonly PlatformTokenName[] = (
  TOKEN_POLICY as readonly TokenEntry[]
)
  .filter((entry) => entry.policy === "platform" && !entry.nonColour && !entry.reserved)
  .map((entry) => entry.token as PlatformTokenName);

function declarationBlock(tokens: SchemeTokens): string {
  return BRAND_ROLES.map(
    (role) => [role, ROLE_TO_TOKEN[role] as PlatformTokenName] as const,
  )
    .filter(([, token]) => REDECLARABLE_TOKENS.has(token))
    .map(([role, token]) => `  ${token}: ${tokens[role]};`)
    .join("\n");
}

/**
 * Re-declares every platform-fixed colour token at its LIGHT
 * `PLATFORM_TOKENS` value — the piece `light_only` mode needs beyond
 * simply not generating a dark ramp (see `sites.ts`/`read-org-brand.ts`'s
 * own light-only handling): even a brand with an identical light/dark
 * ramp still composites against `globals.css`'s bare `.dark` selector for
 * these twelve tokens, since `<BrandTokens>` never touches them under
 * `TOKEN_POLICY`'s closed partition. This is that one narrow, explicit
 * exception — see this file's own header and DECISION-050.
 */
function platformLightOverrideBlock(): string {
  return PLATFORM_COLOR_TOKENS.map(
    (token) => `  ${token}: ${PLATFORM_TOKENS.light[token]};`,
  ).join("\n");
}

/**
 * `[data-brand-neutral]` — the reusable "neutral plate for chrome, not just
 * images" cascade property the P0.5 brand-foundation work-log sketched
 * (docs/work-log/2026-08-19-brand-foundation.md, "A sealed section inside a
 * branded page": "the reset must be a cascade property … not a convention" —
 * that increment never shipped a consumer, this is the first one).
 *
 * `OrgMark`'s `NEUTRAL_PLATE` solves this for a logo image with a handful of
 * literal Tailwind classes (`border-zinc-200 bg-white`), which works because
 * an `<img>` never reads `--primary` in the first place. It does not help a
 * shadcn primitive like the Google `<Button variant="default">` on
 * `/signin`, which is `bg-primary text-primary-foreground` and MUST be
 * immune to the surrounding brand cascade (Google's own brand guidelines
 * forbid recolouring their button; Phase 3's design: "brand wraps the form,
 * never restyles it" — docs/work-log/2026-08-24-branded-signin.md).
 *
 * Any descendant of an element carrying `data-brand-neutral` gets `--primary`
 * / `--primary-foreground` / `--ring` re-declared to the PLATFORM value
 * (never a literal duplicated from `globals.css` — sourced from
 * `PLATFORM_TOKENS`, the one place both `globals.css` and this file already
 * derive from) for BOTH schemes, overriding whatever `:root:root`/
 * `:root:root.dark` above it declared. This works without any specificity
 * contest: a CSS custom property's value at a given element is whatever that
 * element's own rule set (if any), full stop — the ancestor's higher-
 * specificity `:root:root` rule targets `<html>`, not this element, so it
 * only supplies the INHERITED value, which the element's own declaration
 * here simply shadows.
 *
 * Scoped to exactly the three tokens the default `<Button>` variant reads
 * (`bg-primary`, `text-primary-foreground`, `focus-visible:border-ring` /
 * `ring-ring`) rather than the full `REDECLARABLE_TOKENS` set — the
 * credentials-form submit button is explicitly allowed to carry the org
 * brand (matches the public site's own look), so this is a narrow escape
 * hatch, not a second "platform mode" for a whole subtree.
 *
 * Emitted unconditionally alongside the two existing blocks (not gated on a
 * prop) — harmless when nothing on the page carries the attribute, and it
 * means every current and future `<BrandTokens>` call site (org layout, site
 * layout, signin page) gets the escape hatch for free rather than each
 * caller having to opt in to a new prop.
 */
const NEUTRAL_RESET_TOKENS: readonly PlatformTokenName[] = [
  "--primary",
  "--primary-foreground",
  "--ring",
];

function neutralResetBlock(scheme: Scheme): string {
  return NEUTRAL_RESET_TOKENS.map(
    (token) => `  ${token}: ${PLATFORM_TOKENS[scheme][token]};`,
  ).join("\n");
}

export interface BrandTokensProps {
  /** `null` renders `null`. THIS is how the 403/ended/404 pages, an
   * unbranded organization, and the flag being off all stay un-branded — by
   * the caller having nothing to pass, never by this component branching on
   * who the caller is. */
  brand: BrandTokenSet | null;
  /**
   * Per-organization opt-out of the dark ramp entirely (`organization_
   * brands.light_only` — docs/work-log/2026-08-24-light-only-brand.md).
   * When true, the `:root:root.dark` block gets `brand.light`'s own
   * re-declarable values (not `brand.dark`'s) PLUS every platform-fixed
   * colour token forced to its light `PLATFORM_TOKENS` value — the org
   * never presents a dark canvas regardless of `.dark` being present on
   * `<html>`. Defaults to `false` (today's unconditional both-ramps
   * behaviour, DECISION-050) when omitted.
   */
  lightOnly?: boolean;
  /** DECISION-024 forward constraint: report-only CSP today, so this is
   * unused until a fork enforces it — but nonce-able from day one means that
   * fork does not have to touch this file to add one. */
  nonce?: string;
}

export function BrandTokens({
  brand,
  lightOnly = false,
  nonce,
}: BrandTokensProps): React.ReactElement | null {
  if (!brand) return null;

  const darkBlock = lightOnly
    ? `${declarationBlock(brand.light)}\n${platformLightOverrideBlock()}`
    : declarationBlock(brand.dark);

  const cssText =
    `${BRAND_SCOPE_SELECTOR} {\n${declarationBlock(brand.light)}\n}\n` +
    `${BRAND_SCOPE_SELECTOR_DARK} {\n${darkBlock}\n}\n` +
    // The `[data-brand-neutral]` escape hatch (see the block comment above
    // `NEUTRAL_RESET_TOKENS`) — emitted unconditionally, harmless when no
    // element on the page carries the attribute. The dark rule's higher
    // specificity (`:root:root.dark [data-brand-neutral]`) beats the plain
    // `[data-brand-neutral]` rule at the SAME marked element once `.dark` is
    // present on `<html>`; neither rule competes with `BRAND_SCOPE_SELECTOR`
    // above, which targets `<html>` itself, not the marked descendant.
    `[data-brand-neutral] {\n${neutralResetBlock("light")}\n}\n` +
    `:root:root.dark [data-brand-neutral] {\n${neutralResetBlock("dark")}\n}`;

  return <style nonce={nonce}>{cssText}</style>;
}
