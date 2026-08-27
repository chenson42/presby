# Button modernization: action color with white text, depth, honest disabled state — Work Log

> **Slug:** `2026-08-27-button-modernization`
> **Surface:** app-wide (Button primitive, ButtonGroup, brand ramp generator)
> **Permission(s):** none
> **Flag(s):** not needed (brand tokens are already org-scoped; the generator change is versioned)
> **Estimated complexity:** medium
> **Pipeline mode:** Accelerated — Phase 1 satisfied in-conversation (operator reviewed two live-page mockups and chose direction B: deepen the brand primary on buttons until white text passes the 4.5:1 floor, derived per-org from the seed; plus shadow/depth on buttons and a cleaner disabled state). Phase 2 runs (brand contract + token versioning are touched).
> **Source:** live operator feedback, 2026-08-27 — "the group buttons and the search button... are flat and again are lacking that modern feel. not sure i like the black font on teal. and not sure i like the gray off color." Root observations: fpcw ramp emits --primary-foreground #000000 (white fails 4.5:1 on #579e98); default Button variant has no shadow; disabled = opacity-50 over teal reads as a muddy gray.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | operator (in-conversation mockup review) | Complete | Direction B chosen | 2026-08-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete | Design ready, implementer named | 2026-08-27 |
| 4 — Implementation | api-developer (commit 1) → ux-developer (commit 2) | Complete | generator white-floor + button depth/disabled; all suites green | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

**Satisfied in-conversation** (see Pipeline mode note in the metadata block): the operator reviewed two live-page mockups rendered on /o/fpcw/directory — (A) keep the brand teal, dark-ink text; (B) deepen the teal until white passes 4.5:1 — and chose **B**, plus the shadow/depth treatment on buttons and a cleaner disabled state. Root observations recorded in the Source block: fpcw's ramp emits `--primary-foreground: #000000` (white fails 4.5:1 on #579e98); the default Button variant has no shadow; `disabled:opacity-50` over the brand fill reads as a muddy gray.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

## Key rulings

1. **Contract legality — no contract change.** `LEGAL_PAIRS` already declares `{ fg: "on-brand", bg: "brand", min: 4.5, kind: "text", derives: "D2" }`; it is scheme-agnostic on which color satisfies it. What is wrong today is the *generator's stopping condition*: `searchBrandLightness` (generate.ts:320-340) stops the light-scheme darkening the instant D3 (≥3:1 vs surface) clears, never checking whether white specifically clears D2 at that lightness; `pickAchromaticForeground` then legitimately picks black. Fix = **tighten the light-scheme stopping condition** — continue darkening until `contrastRatio("#ffffff", brand) >= 4.5` also holds; then let the foreground pick run as today. Provably terminating (the luminance-gap proof already in generate.ts's header). **Never special-case emit #ffffff** — the token stays computed, per D2.
2. **Version propagation — regeneration is already unconditional.** `getOrgBrandForLayout()` calls `generateBrandTokens(row.seedHex)` on every request and never reads `brand_token_version` (stamped at save-time only). The moment the new generator deploys, fpcw's buttons change on the next page load — no migration, no re-save, no history row. **Still bump `BRAND_TOKEN_VERSION` to 2** (a materially different derivation warrants it) and record the read/write asymmetry in docs/TODO.md: a generator change silently re-renders every branded org before any stored version reflects it. Pre-existing property, not introduced here; qa should not expect a migration step.
3. **Scope of darkening — darken `--primary` itself, globally, per scheme; no second token.** A `--button-primary` would be a closed-partition contract addition and the "second styling system" DECISION-046 rejects. `--brand-raw` already preserves the congregation's unmodified color for decorative surfaces (D10). `ring := brand` (D4) is structurally untouched.
4. **Platform palette — untouched.** `PLATFORM_TOKENS.light` is already white-on-blue and floor-verified (DECISION-051). The generator change cannot ripple into platform-only route groups. The **primitive changes ripple everywhere by design** — shadow/depth/disabled-legibility are chrome properties, not brand tokens, and D5 is a floor for every surface (DECISION-105 precedent). Darkening the platform's own blue for stylistic parity is out of scope unless the operator explicitly asks.
5. **Button primitive** — shadow+hover and disabled restyle land as divergence #5 (+#6) in button.tsx's existing header. `disabled:opacity-50` **already violates D5** ("invisible to a 78-year-old") — replacing it closes a standing violation. Recommend `disabled:bg-muted disabled:text-muted-foreground` (platform-fixed pair, clears 7:1 for every seed, zero contract changes; "disabled" is a state, not an identity, same logic as D6's destructive). A brand-tinted disabled derivation would need a new LEGAL_PAIRS entry — flag that fork explicitly if ux wants it.
6. **Dark scheme — white-forcing is light-scheme ONLY.** Dark's search direction is lightening (toward the regime where white fails and black wins); the platform's own dark default already pairs a light blue with near-black text, floor-verified. Leave dark's step 6 and foreground pick exactly as-is (D11: schemes derived independently). Consequence: fpcw's dark-mode button may legitimately show dark text on a lighter teal. **The operator's approved mockup was light-mode; the asymmetry must be confirmed at Phase 6 with dark-mode screenshots, not discovered.**

## Implementer

**Two-commit split** (brand-foundation precedent): commit 1 — `generate.ts` + `generate.test.ts` + `BRAND_TOKEN_VERSION` bump (**api-developer**, pure TS + property tests); commit 2 — `button.tsx` (+ `button-group.tsx` only if it needs more than inheritance) (**ux-developer**). No database-admin (no schema change).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |

**Handoff:** tech-lead (Phase 3) — design doc must explicitly resolve: (a) light-scheme-only white-targeting, (b) version bump + TODO line for the read/write asymmetry, (c) disabled = muted pair unless a brand-tinted derivation is deliberately chosen, (d) the two-commit sequencing, (e) the dark-scheme asymmetry named as an operator-confirmation item for Phase 6.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Two independent, sequenced fixes riding one work-log. First, `generate.ts`'s
light-scheme `brand` search stops the instant D3 (brand-on-surface >=3:1)
clears, without ever checking whether *white text specifically* clears D2
(4.5:1) against that `brand` — so `pickAchromaticForeground` legitimately, and
wrongly for the operator's taste, resolves to black on a mid-lightness teal
like fpcw's. We tighten the light-scheme stopping condition to also require
white-on-brand >=4.5:1, so white becomes the button-text color for every light
seed without touching the contract, without special-casing `#ffffff`, and
without moving dark scheme's derivation at all. Second, the `Button` primitive
gets the depth and disabled-legibility treatment DECISION-105 already gave the
`tile` variant: a subtle rest shadow that lifts slightly on hover for
`default`/`outline`, and a disabled state that reads as *disabled* (muted
gray) rather than *the brand color gone translucent* (today's
`disabled:opacity-50`, a standing D5 violation). No schema, no new dependency,
no contract change — `LEGAL_PAIRS` already covers every pair this touches.

## Permissions & Flags

- Permission key(s): none — this is a shared-primitive/generator change, not a
  new user-facing capability.
- Default role bindings: n/a.
- Feature flag(s): not needed. The generator is unconditionally invoked on
  every request (`getOrgBrandForLayout()` never reads `brand_token_version` —
  see architect ruling #2 and (b) below), so there is no rollout lever to
  build; the change ships live the moment it deploys, for every branded org,
  on next page load. This is a pre-existing property of the read path, not
  something this pipeline is introducing or could flag-gate without a larger
  change out of scope here.

## API Contract

No new routes or server actions. One internal function signature is
unchanged in shape but changed in behavior:

- `searchBrandLightness(scheme, surfaceHex, startL, C, H): { hex, L, C }` —
  same signature, same two call sites (steps 6 and 7 of `deriveScheme`). Only
  its **stopping condition** changes, and only for `scheme === "light"`. See
  (a) below for the exact diff.
- `generateBrandTokens(seedHex): GeneratedBrand` — signature and return shape
  unchanged. For a given seed, `tokens.light.brand` may now be a darker hex
  than it was under version 1, and `tokens.light["on-brand"]` will resolve to
  `"#ffffff"` for every seed (previously it could be `"#000000"`).
  `tokens.dark` is asserted unchanged (see (d)).

## Data Model

No schema changes required. `organization_brands.brand_token_version` (or
equivalent stored column) is written at save-time only and is not touched by
this pipeline — see (b) for the read/write asymmetry this surfaces (not
introduces).

## Component / Page Plan

- Pages to create: none.
- Components to create: none.
- Files to modify:
  - `src/lib/brand/generate.ts` — `searchBrandLightness`'s stopping condition.
  - `src/lib/brand/generate.test.ts` — new property-test assertions (see (d)).
  - `src/lib/brand/contract.ts` — `BRAND_TOKEN_VERSION` 1 → 2.
  - `src/components/ui/button.tsx` — shadow/hover on `default`/`outline`;
    disabled restyle on the shared `base` string; two new numbered divergence
    entries (#5, #6) in the file's existing header comment.
  - `src/components/shared/button-group.tsx` — shadow suppression on its
    per-item `className` override (see the ButtonGroup ruling below).
  - `src/components/ui/button.test.tsx` — new file (none exists today).
  - `docs/TODO.md` — the read/write-asymmetry line, verbatim text in (b).

## (a) Light-scheme-only white-targeting search

**Exact stopping-condition change**, in `searchBrandLightness`
(`src/lib/brand/generate.ts:320-340`):

```ts
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
    const clearsD3 = contrastRatio(hex, surfaceHex) >= 3;
    // Light scheme only (architect ruling #6, D11): D3 alone is not
    // sufficient for this scheme's chosen text color to be white. Keep
    // darkening until white ALSO clears D2 (4.5:1) against `brand`, so
    // `pickAchromaticForeground` legitimately resolves to white rather than
    // black. Dark scheme's condition is UNCHANGED — `clearsWhiteFloor`
    // short-circuits to `true` for "dark", so the expression reduces
    // algebraically to today's `clearsD3` alone.
    const clearsWhiteFloor =
      scheme === "dark" || contrastRatio("#ffffff", hex) >= 4.5;
    if (clearsD3 && clearsWhiteFloor) return { hex, L, C: usedC };
    L += direction * BRAND_LIGHTNESS_STEP;
    if (L <= 0 || L >= 1) break;
  }

  const fallbackL = direction === -1 ? 0.02 : 0.98;
  const { hex, C: usedC } = oklchToHexClamped(fallbackL, C, H);
  return { hex, L: fallbackL, C: usedC };
}
```

**Terminating-search argument.** For `scheme === "light"`, `L` walks down
from `startL` toward 0 in fixed `BRAND_LIGHTNESS_STEP` (0.01) decrements —
the same loop bound already in place (100 steps covers the full [0,1] range
from any `startL` <= 0.99). As `L -> 0`, the candidate `hex`'s relative
luminance approaches 0, so `contrastRatio("#ffffff", hex)` approaches its
maximum (~21:1) — it must cross 4.5:1 at some `L` strictly greater than 0
(the header's own luminance-gap proof: white clears 4.5:1 whenever
`relLum(bg) <= 0.1833`, a threshold every hue reaches well before `L=0` under
`oklchToHexClamped`'s monotone-in-L construction). Since D3 (brand-on-surface
>=3:1, `surfaceHex` near-white at `SURFACE_L.light = 0.995`) requires only
`relLum(brand) <= ~0.283` — a *lighter* threshold than the white floor's
`0.1833` — `clearsD3` is already true by the time `clearsWhiteFloor` becomes
true for the overwhelming majority of seeds, so the combined condition fires
within the existing 100-iteration bound without needing more steps. No
iteration-count change is required. The unreachable-fallback finding
`generate.test.ts` already records for the hue-nudge safety net (step 7) is
the same shape of argument extended one clause further; Phase 4 should note
in that same test file whether the numeric fallback (lines 337-339) still
never fires under the tightened condition.

**No-op case — a seed already darker than the white floor.** If a seed's own
starting lightness (`startL`) already satisfies both `clearsD3` and
`clearsWhiteFloor` at `i = 0` — a genuinely dark/deep seed, e.g. a navy or a
deep maroon — the loop returns on its first iteration exactly as it does
today. That branch's output is byte-identical before and after this change:
the new clause is additive, never subtractive, and a seed that already
cleared the tighter bar was never touched by the looser one either. This is
the concrete "no-op for seeds already dark enough" case referenced in the
Phase 2 handoff.

**Never emit `#ffffff` as a special case.** The token stays computed by
`pickAchromaticForeground`, per D2 — this change only moves where `brand`'s
search stops, never hard-codes the foreground. `pickAchromaticForeground`
itself is untouched.

## (b) `BRAND_TOKEN_VERSION` -> 2, and the read/write asymmetry

`src/lib/brand/contract.ts:38`:

```ts
export const BRAND_TOKEN_VERSION = 2;
```

A materially different derivation (the light-scheme stopping condition is a
real algorithmic change, not a bugfix-in-place) warrants the bump per D8's own
intent, even though — per architect ruling #2 — **no migration step follows
from it today**: `getOrgBrandForLayout()` calls `generateBrandTokens(row.seedHex)`
unconditionally on every request and never reads the stored version column, so
every already-branded org's buttons change on next page load with no re-save,
no history row, and no version-column update. This is a pre-existing property
of the read path (not introduced by this pipeline), and qa should not expect
or look for a migration step in Phase 5.

**Exact `docs/TODO.md` line** (implementer adds verbatim, under "Next Up",
same commit as the `contract.ts`/`generate.ts` change per Workflow Rule 10):

```
- [ ] **Brand-token read/write asymmetry.** `getOrgBrandForLayout()` calls `generateBrandTokens(row.seedHex)` on every request and never reads `organization_brands`' stored `brand_token_version` — a generator change (e.g. `BRAND_TOKEN_VERSION` 1→2, this pipeline) silently re-renders every branded org's live tokens on next page load, with no migration step and no history row recording the change. Pre-existing property (architect ruling, Phase 2), surfaced again rather than fixed here. Needs a product/architectural decision: pin the read path to the org's stored version and require an explicit re-save to adopt a new one, or accept unconditional regeneration as the design and document it as such so it stops being independently rediscovered. — docs/work-log/2026-08-27-button-modernization.md Phase 2/3
```

## (c) Disabled state

**Confirmed: the muted pair, no fork.** Replace the shared `base` string's
`disabled:opacity-50` with `disabled:bg-muted disabled:text-muted-foreground`
(keep `disabled:pointer-events-none`). This is a `cva` `base`-level change, so
it applies uniformly to every variant, not per-variant — consistent with how
`disabled:opacity-50` already applied uniformly today. `muted-surface` /
`on-muted-surface` (`--muted` / `--muted-foreground`) is already a
platform-fixed pair in `LEGAL_PAIRS` at 7:1 (`derives: D1`) — **zero contract
changes**, the pair is already proven for every seed by the existing property
grid. No new `LEGAL_PAIRS` entry, no brand-tinted derivation: disabled is a
state, not an identity, the same reasoning D6 already applies to `destructive`.

**Expected visual scope, named so it isn't a surprise in Phase 5/6:** because
this lands at `base`, every variant's disabled state gains a muted fill, not
just `default`. `outline`/`ghost`/`tile` previously had no solid disabled fill
(just 50% opacity over whatever was already there — border, transparent, or
card); they will now show a flat `bg-muted` box. `link`'s disabled state
similarly gains a filled rectangle behind its text where today it has none.
This is the intended, uniform fix for D5 legibility across the primitive, not
a scope creep — call it out explicitly in the Phase 4/5 browser pass rather
than treating it as an unplanned side effect.

## (d) Two-commit split, sequencing, and required tests

**Commit 1 — api-developer.** `src/lib/brand/generate.ts` (the stopping
condition in (a)) + `src/lib/brand/generate.test.ts` (new assertions below) +
`src/lib/brand/contract.ts` (`BRAND_TOKEN_VERSION` -> 2) + the `docs/TODO.md`
line in (b), all in one commit (schema-free, pure TS + tests — the
brand-foundation precedent).

Required test additions to `generate.test.ts`, riding the existing
`ALL_SEEDS` / `SCHEMES` grid rather than a parallel one:

1. **Light-scheme white-vs-brand floor, every seed.** New assertion (either
   folded into the existing per-seed `it` block or its own `describe`):
   `contrastRatio("#ffffff", generated.tokens.light.brand) >= 4.5` for every
   entry in `ALL_SEEDS`. This is the direct, mechanism-independent statement
   of the fix — distinct from the existing generic `LEGAL_PAIRS` loop, which
   only proves *some* on-brand/brand pair clears 4.5:1 and would pass whether
   the resolved foreground were black or white.
2. **Light-scheme foreground always resolves to white.** New assertion:
   `generated.tokens.light["on-brand"] === "#ffffff"` for every entry in
   `ALL_SEEDS`. Together with (1) this pins both halves of the operator-visible
   fix: the color computed and the color chosen.
3. **Dark scheme unchanged — prefer a golden-fixture byte-identity check.**
   Before editing `generate.ts`, capture `generateBrandTokens(seed.hex).tokens.dark`
   for every `ALL_SEEDS` entry against the CURRENT (pre-change) code — either
   as a committed JSON fixture or an inline literal in the test file — then
   after the edit, assert the post-change `tokens.dark` for every seed
   matches the captured value byte-for-byte (`JSON.stringify` equality, same
   discipline as the existing D8 determinism test). This is the strongest
   available proof that dark's derivation was not touched, and it is feasible
   here: the pre-change code is on disk before commit 1 starts.
   **Minimum acceptable fallback** if the golden-fixture capture is skipped:
   (i) the existing `LEGAL_PAIRS` property loop already re-runs against
   `tokens.dark` for every seed/scheme and must still pass unmodified — that
   proves D2/D3 floors still hold; AND (ii) add one assertion proving
   white-forcing did not leak into dark: identify (by running today's
   generator before editing) at least one `EDGE_SEEDS` entry whose
   `tokens.dark["on-brand"]` currently resolves to `"#000000"`, and assert it
   is still `"#000000"` post-change. A dark scheme where every edge seed's
   on-brand had already been white before this change would make (ii)
   unfalsifiable — if that turns out to be the case, fall back to the golden
   fixture instead; do not ship commit 1 with dark coverage that couldn't
   have caught a white-forcing regression.
4. Existing tests (property grid, D10 near-grey, D8 determinism, D11
   independence, `ring := brand`, malformed input, hue-nudge safety net) must
   all still pass unmodified — no existing assertion should need editing to
   accommodate this change; if one does, that is a signal the change reached
   further than (a) specifies and Phase 4 should stop and flag it rather than
   loosen the assertion.

**Commit 2 — ux-developer.** `src/components/ui/button.tsx` (shadow/hover on
`default`/`outline`, the disabled restyle from (c), two new header divergence
entries) + `src/components/shared/button-group.tsx` (shadow suppression,
below) + new `src/components/ui/button.test.tsx`.

**Shadow/hover treatment — concrete classes.** DECISION-105's tile language
("subtle rest shadow, slightly raised hover") scaled down one Tailwind shadow
step for a control this much smaller than a tile (`tile` jumps `shadow-sm` ->
`hover:shadow-lg` plus a translate; a button doing the same would look
garish at this size):

- `default`: add `shadow-xs hover:shadow-sm` (alongside the existing
  `bg-primary text-primary-foreground hover:bg-primary/90`).
- `outline`: add `hover:shadow-sm` (it already carries `shadow-xs` today —
  only the hover step is new).
- No shadow change to `destructive`, `secondary`, `ghost`, `link`, or `tile`
  — out of scope; the operator's feedback named the default/group buttons and
  the search button specifically (all `default`/`outline`), and `tile` already
  has its own DECISION-105 elevation treatment.

**ButtonGroup — needs its own change, not just inheritance.** Its inactive
segments render `variant="outline"` with `className="min-h-11 rounded-none
border-0"` (plus a conditional `border-l`). Once `outline` gains
`hover:shadow-sm`, every inactive segment in a connected row would
independently float on hover, breaking the "one control, no gaps" look the
component's own header comment describes — `cn()`'s `twMerge` lets the later
class win only if the group explicitly says so; nothing today suppresses
shadow. Add `shadow-none hover:shadow-none` to `button-group.tsx`'s per-item
`className` (same mechanism the file already uses to zero out `border`
before re-adding `border-l`). This is the one required change beyond
`button.tsx` itself — everything else about `ButtonGroup`'s look (disabled
restyle, since it renders no disabled items today; `default`-variant shadow
for the active segment, since `rounded-none border-0` already flattens its
edges the same way) is correctly inherited with no further edit.

**Required test additions:**

- `src/components/ui/button.test.tsx` (new): render `default` and `outline`
  and assert `shadow-xs` is present on both and `hover:shadow-sm` is present
  on both (className string assertion, `@vitest-environment jsdom`, same
  render/screen pattern as `button-group.test.tsx`); render a `disabled`
  button and assert `disabled:bg-muted` and `disabled:text-muted-foreground`
  are present and `disabled:opacity-50` is absent from the rendered
  className, for at least `default` and `outline` variants (proving the
  base-level replacement actually reaches every variant, per (c)'s scope
  note).
- `src/components/shared/button-group.test.tsx` (extend): assert an inactive
  (outline) segment's className includes `shadow-none` and `hover:shadow-none`
  and does not include a bare `shadow-xs`/`hover:shadow-sm` that would
  survive `twMerge` — i.e., pin that the group's suppression actually wins,
  not just that it was added to the source string.

## (e) Dark-scheme asymmetry — explicit Phase 6 item

Dark's search direction lightens (toward the regime where white eventually
fails and black wins); (a) never touches it. Consequence, named now so it is
confirmed rather than discovered: **fpcw's dark-mode default/outline buttons
may legitimately show dark text on a lighter teal**, the mirror image of the
light-scheme problem this pipeline fixes. The operator's approved mockup
(Phase 1) was light-mode only. **Phase 6 (analyst) must include dark-mode
screenshots of the same fpcw pages the light-mode mockup was reviewed
against, and an explicit operator confirmation that dark's asymmetric
result (possibly dark ink on a light teal button) is acceptable** — not a
verdict inferred from the light-mode screenshots or from the property tests
passing. If the operator wants dark-scheme white-forcing too, that is a new
Phase 1 (a symmetric but independently-reasoned change to dark's own
stopping condition, likely trading away D3's cheaper clearance the same way
light now does) — out of scope here.

## Implementation Order

1. `src/lib/brand/generate.ts` — tighten `searchBrandLightness`'s light-scheme
   stopping condition (a).
2. `src/lib/brand/contract.ts` — `BRAND_TOKEN_VERSION` 1 -> 2 (b).
3. `src/lib/brand/generate.test.ts` — new property-test assertions (d);
   confirm all pre-existing assertions still pass unmodified.
4. `docs/TODO.md` — the read/write-asymmetry line (b), same commit as 1-3.
5. Commit 1 lands (api-developer). `npm run typecheck && npm run test` green.
6. `src/components/ui/button.tsx` — shadow/hover on `default`/`outline`,
   disabled restyle on `base`, two new header divergence entries (c).
7. `src/components/shared/button-group.tsx` — shadow suppression.
8. New `src/components/ui/button.test.tsx`; extend
   `src/components/shared/button-group.test.tsx` (d).
9. Commit 2 lands (ux-developer).
10. Browser verification, both commits together (matrix below) — Phase 4/5.
11. No audit events (no security-sensitive mutation touched).
12. Release notes entry + `docs/TODO.md` reconciliation (move the item once
    shipped) at Phase 6 SHIP IT, per tech-lead ownership.

## Browser-verification matrix (Phase 4/5)

Required combinations — a passing build/typecheck is not evidence any of
this renders correctly (CLAUDE.md → Verify in a Browser):

| Org / page | Scheme | Viewport |
|---|---|---|
| fpcw (branded, teal seed) — `/o/fpcw/directory` (search button) and any admin page with the default action row | light | 1280px |
| fpcw — same pages | dark | 1280px |
| fpcw — same pages | light | 360px |
| fpcw — same pages | dark | 360px |
| Platform palette (unbranded page, e.g. `/admin`) | light | 1280px |
| Platform palette | light | 360px |

Platform-palette dark is not required — architect ruling #4 confirms
`PLATFORM_TOKENS` is untouched and already floor-verified; include it only if
time permits, not as a gate.

## Edge Cases & Risks

- **A seed already darker than the white floor** (e.g. a deep navy/maroon
  seed) — no visible change; see the no-op case in (a). Verify with at least
  one such seed in the property grid (an `EDGE_SEEDS` entry or a grid seed
  from the `vivid-deep` band) producing byte-identical `light.brand` before
  and after.
- **`light_only` orgs** (if any organizations opt out of a dark set) —
  unaffected either way: dark tokens are still generated (the generator has
  no `light_only` branch; it always derives both schemes), simply never
  applied by such an org's CSS. No special-casing needed.
- **Live brand preview in the admin/tenant brand forms.** Both
  `src/app/(org)/o/[slug]/admin/branding/branding-form.tsx` and
  `src/app/(admin)/admin/organizations/[id]/brand-form.tsx` call
  `generateBrandTokens(seedHex)` client-side on every hex-input change to
  drive `<BrandPreviewSwatch>` — this is the same unconditional-regeneration
  path (b) describes, just invoked from the browser instead of
  `getOrgBrandForLayout()`. No code change needed there: the moment commit 1
  ships, both forms' live preview will show the deepened light-scheme color
  and white text for any seed being edited, which is the correct and
  desired behavior (what-you-preview-is-what-you-get) — call this out in the
  Phase 4/5 verification pass rather than treating a preview-color shift as a
  bug.
- **`disabled:bg-muted` reaching `outline`/`ghost`/`link`/`tile`** — see the
  explicit scope note in (c); expected, not a regression.
- **`shadow-xs`/`hover:shadow-sm` inside `ButtonGroup`** — must be verified
  suppressed in an actual rendered/screenshotted group, not just asserted in
  the unit test's className string, since `twMerge`'s conflict resolution is
  the kind of thing that silently misbehaves with class ordering (see
  `check:brand-scope`'s own "paper" caveat for the same class of risk).
- **e2e blast radius.** No existing Playwright spec asserts button shadow,
  disabled className, or a specific `on-brand`/`brand` hex — grep confirms no
  `.toHaveClass(/shadow/)` or `opacity-50` assertions against `Button` in
  `e2e/`. The likeliest collateral spec is anything using
  `getByRole("button", { name: ... })` with a `toBeDisabled()` check followed
  by a screenshot/visual assertion — none found in a repo-wide grep for
  `toMatchSnapshot` scoped to buttons, so this pipeline's blast radius on
  *existing* e2e specs is assessed as none, but the implementer should
  re-grep at Phase 4 time (specs are added daily) rather than trust this
  finding stale by even a day.

## Implementer

**Two commits, two implementers**, per architect's Phase 2 handoff:

- **Commit 1 — api-developer**: `src/lib/brand/generate.ts`,
  `src/lib/brand/generate.test.ts`, `src/lib/brand/contract.ts`,
  `docs/TODO.md`.
- **Commit 2 — ux-developer**: `src/components/ui/button.tsx`,
  `src/components/ui/button.test.tsx`, `src/components/shared/button-group.tsx`,
  `src/components/shared/button-group.test.tsx`.

No database-admin (no schema change). No full-stack-developer (the two
halves are independently testable and independently reviewable — pure TS
math/tests vs. a client component's classNames — the coupling is one shared
visual outcome, not shared code).

**Handoff:** api-developer for commit 1 (Phase 4), then ux-developer for
commit 2 (Phase 4), both against this design; qa runs Phase 5 once against
the combined result per the browser-verification matrix above.

---

# Phase 4 — Implementation

## Commit 1 (api-developer) — `generate.ts` stopping condition, property tests, version bump

**Date:** 2026-08-27
**Implementer:** api-developer

### Files Created

- `src/lib/brand/__fixtures__/dark-scheme-golden.json` — the pre-change
  `tokens.dark` output of `generateBrandTokens()` for every entry in
  `ALL_SEEDS` (294 seeds: 288 grid + 6 named edge seeds), captured from the
  generator at git `HEAD` (commit-1's starting point, before the stopping
  condition was edited) via a throwaway `tsx` script run against a copy of
  `generate.ts`/`contract.ts`/`contrast.ts` in the scratchpad (not committed).
  Consumed by the new golden-fixture byte-identity test in
  `generate.test.ts` — the strongest available proof that dark's derivation
  was not touched (Phase 3(d)(3)).

### Files Modified

- `src/lib/brand/generate.ts` — `searchBrandLightness`'s stopping condition
  now requires, for `scheme === "light"` only, that
  `pickAchromaticForeground(hex)` would actually resolve to `"#ffffff"` for
  the candidate `hex`, in addition to D3 (`brand` on `surface` >= 3:1).
  Header docstring updated: step 6's description in the nine-step list, the
  "one property worth stating once" section (new paragraph explaining the
  distinction between "white clears 4.5:1" and "white is the one
  `pickAchromaticForeground` actually picks"), and an inline comment on the
  new `clearsWhiteFloor` local documenting the deviation from Phase 3's
  exact code sample (see Implementer Notes below). `pickAchromaticForeground`
  itself is untouched — no special-casing of `#ffffff` anywhere.
- `src/lib/brand/generate.test.ts` — four additions, all riding the existing
  `ALL_SEEDS`/`SCHEMES` grid rather than a parallel one:
  1. Folded into the existing per-seed/per-scheme property-grid `it` block
     (light-scheme branch only): `contrastRatio("#ffffff", tokens.brand) >=
     4.5` and `tokens["on-brand"] === "#ffffff"`, for every one of the 294
     `ALL_SEEDS` entries in the light scheme.
  2. New `describe("button-modernization ... dark scheme untouched")` with
     two tests: (a) `tokens.dark` for every `ALL_SEEDS` entry is
     byte-identical (key-order-independent `stableStringify` comparison) to
     the golden fixture; (b) the fixture itself is falsifiable — at least
     one `EDGE_SEEDS` entry's dark `on-brand` is `"#000000"` in the fixture,
     so a white-forcing regression leaking into dark would actually be
     caught, not vacuously pass.
  3. New `describe("button-modernization ... no-op case")`: `#0404ae` (hue
     240, vivid-deep grid seed) already clears both D3 and the tightened
     white-floor condition at its own starting lightness — its
     `tokens.light.brand`/`brand-raw` are asserted to equal the seed's own
     hex verbatim, proving `searchBrandLightness` returned on its first
     iteration (i=0), unchanged by this edit.
  4. Ran the full pre-existing suite unmodified — no existing assertion
     needed editing (property grid, D10 near-grey, D8 determinism, D11
     independence, `ring := brand`, malformed input, hue-nudge safety net all
     pass as before).
- `src/lib/brand/contract.ts` — `BRAND_TOKEN_VERSION` 1 -> 2, with a comment
  recording why (materially different derivation) and the read/write
  asymmetry this bump does NOT resolve (per architect ruling, Phase 2 #2).
  Nothing else in `contract.ts` touched — no `TOKEN_POLICY`/`LEGAL_PAIRS`
  edits.
- `docs/TODO.md` — added the exact read/write-asymmetry line from Phase
  3(b), verbatim, under "Next Up."

### Schema Changes

- None.

### Audit Events

- None — no security-sensitive mutation in this commit (pure derivation
  function + tests + a version constant).

### Test Results

- `npm run typecheck`: clean, 0 errors.
- `npx vitest run src/lib/brand/`: **3 passed, 1 skipped test file (DB-backed,
  skips without `DATABASE_URL`); 687 tests passed, 5 skipped, 0 failed.**
- `npm test` (full `vitest run`): **209 passed, 22 skipped test files; 2782
  tests passed, 518 skipped (DB-backed, no `DATABASE_URL` in this shell), 0
  failed.**
- `npm run check` (all four tripwires — `check:audit`, `check:sql-date`,
  `check:deps-drift`, `check:brand-scope`): all four passed.

### fpcw sanity check (real seed, real effect)

Queried the dev DB directly (`psql "$MIGRATE_DATABASE_URL"`) rather than
guessing: `organization_brands.seed_hex` for `slug = 'fpcw'` is `#60a7a1` —
not `#579e98` as literally quoted in this work-log's Source block (the
operator's quoted problem output was itself `generateBrandTokens('#60a7a1')`'s
PRE-change *derived* `light.brand`, one step downstream of the seed; the seed
itself was always `#60a7a1`). Ran `generateBrandTokens('#60a7a1')` through
both the pre-change generator (a scratch copy at git `HEAD`) and the
post-change generator in this working tree:

| | `light.brand` (`--primary`) | `light["on-brand"]` (`--primary-foreground`) | white-on-brand ratio |
|---|---|---|---|
| **Pre-change** | `#579e98` | `#000000` | (fails 4.5:1 — this is the operator's reported bug) |
| **Post-change** | `#377f7a` | `#ffffff` | **4.69:1** |

Dark scheme, post-change (unchanged from pre-change, confirmed by the golden
fixture test): `dark.brand = #60a7a1` (the raw seed itself — dark's search
direction lightens, and D3 already clears at the seed's own lightness),
`dark["on-brand"] = #000000`. This is exactly the asymmetry Phase 3(e) named
in advance: fpcw's dark-mode button legitimately shows dark text on the raw
teal. `generated.adjustments` is `[]` for this seed in both schemes — no
near-grey/hue-nudge/danger-hue finding.

### Implementer Notes

**One deviation from Phase 3's exact code sample**, found by the new
property tests themselves rather than assumed correct because the design
doc said so: the Phase 3(a) sample used
`contrastRatio("#ffffff", hex) >= 4.5` as `clearsWhiteFloor`. Running the new
`ALL_SEEDS`-wide light-scheme assertion against that literal condition failed
for 87 of 294 seeds — `on-brand` resolved to `"#000000"` even though white's
own ratio had cleared 4.5:1. Root cause: the WCAG luminance-gap proof this
module's own header already states shows the two *failure* conditions
(`contrast(black,bg)<4.5` and `contrast(white,bg)<4.5`) are mutually
exclusive, but it never claimed the two *pass* conditions are — there is a
narrow background-luminance band (`relLum(bg)` in roughly `[0.175, 0.1833)`)
where **both** black and white clear 4.5:1 simultaneously, and
`pickAchromaticForeground`'s `white > black ? white : black` comparison picks
black there because black's ratio is marginally larger. The design's exact
sample would stop the search on that band's leading edge — a real bug the
sample code would have shipped: white passing D2 without being the *chosen*
foreground, exactly repeating the bug this pipeline exists to fix, just
moved to a smaller footprint. Fixed by testing the actual selector directly:
`clearsWhiteFloor = scheme === "dark" || pickAchromaticForeground(hex) ===
"#ffffff"`. This is a smaller, more direct diff than the design's sample, not
a larger one — no new helper, no new threshold constant, `pickAchromaticForeground`
untouched — and the terminating-search argument in Phase 3(a) still holds
unchanged (the true crossover luminance ~0.179 is only marginally tighter
than 0.1833, still comfortably reached before `L` approaches 0 for every
seed in the grid; confirmed by the full suite passing with zero fallback-path
firings beyond what the pre-existing hue-nudge test already tracks). Documented
inline in `generate.ts` at the point of the change; not a design-doc edit
(Phase 3's text is left as tech-lead authored it) since this is an
implementation-level correction discovered by the very tests Phase 3
prescribed, not a change in intent — flagging it here per Phase 4's own gate
("loop-back to Phase 3 if the design is unbuildable") for awareness, though
the fix is a strict correction of the sample's code, not a functional or
architectural change: same stopping semantics ("keep darkening until white
is legitimately the chosen text color"), same signature, same call sites,
same dark-scheme no-op.

No other deviation from Phase 3. `docs/TODO.md` line added verbatim as
specified. `BRAND_TOKEN_VERSION` bump has no accompanying migration, per
architect ruling — not an oversight.

### Deferred to commit 2 (ux-developer)

`src/components/ui/button.tsx`, `src/components/ui/button.test.tsx`,
`src/components/shared/button-group.tsx`,
`src/components/shared/button-group.test.tsx` — untouched by this commit, as
scoped.

---

## Commit 2 (ux-developer) — `button.tsx` depth/disabled treatment, `button-group.tsx` shadow suppression, tests

**Date:** 2026-08-27
**Implementer:** ux-developer

### Files Modified

- `src/components/ui/button.tsx`:
  - `default` variant: added `shadow-xs hover:shadow-sm` alongside its
    existing `bg-primary text-primary-foreground hover:bg-primary/90`.
  - `outline` variant: added `hover:shadow-sm` (it already carried
    `shadow-xs`).
  - No change to `destructive`, `secondary`, `ghost`, `link`, `tile` — matches
    Phase 3(d) scope exactly.
  - Base `cva` string: replaced `disabled:opacity-50` with `disabled:bg-muted
    disabled:text-muted-foreground`, keeping `disabled:pointer-events-none`
    as-is. This is a `base`-level change, so it reaches every variant.
    Confirmed Phase 3(c) does **not** call for a `disabled:shadow-none`
    addition (re-checked the design doc directly — only `bg-muted` and
    `text-muted-foreground` are specified) and did not add one.
  - Added header divergence entries **#5** (shadow/hover treatment, scoped to
    `default`/`outline`, cross-referencing `button-group.tsx`'s suppression)
    and **#6** (the disabled restyle, naming the D5 rationale and the
    every-variant scope), following entries 1–4's existing style.
- `src/components/shared/button-group.tsx`: added `shadow-none
  hover:shadow-none` to the per-item `className` override (alongside the
  existing `min-h-11 rounded-none border-0`), plus a new paragraph in the
  file's header docstring explaining why (once `outline` gained
  `hover:shadow-sm`, every inactive segment in a connected row would
  independently float on hover). Verified `twMerge`'s conflict resolution
  actually lets the later classes win (not just present in the source
  string) — see the new button-group test below and the live screenshots.

### Files Created

- `src/components/ui/button.test.tsx` (new file, none existed before):
  - Asserts `shadow-xs`/`hover:shadow-sm` present on rendered `default` and
    `outline` buttons.
  - Asserts a disabled `default`/`outline` button's className contains
    `disabled:bg-muted` and `disabled:text-muted-foreground`, and does **not**
    contain `disabled:opacity-50`.
  - Loops all seven variants (`default`, `destructive`, `outline`,
    `secondary`, `ghost`, `link`, `tile`) rendered disabled and asserts none
    of their classNames contain `opacity-50` anywhere — pins that the `base`
    replacement is the *only* source of disabled styling left in the file.
- `src/components/shared/button-group.test.tsx` (extended): two new tests —
  one on the inactive ("Households", `variant="outline"`) segment and one on
  the active ("Members", `variant="default"`) segment, each asserting the
  rendered className contains `shadow-none`/`hover:shadow-none` and does
  **not** contain a bare `shadow-xs` or `hover:shadow-sm` that would mean the
  suppression lost the `twMerge` conflict.

### Schema Changes

- None.

### Audit Events

- None — no security-sensitive mutation (client-visible styling only).

### Test Results

- `npm run typecheck`: clean, 0 errors.
- `npx vitest run src/components/ui/button.test.tsx
  src/components/shared/button-group.test.tsx`: **2 test files passed, 13
  tests passed, 0 failed** (6 new in `button.test.tsx`, 2 new + 5 pre-existing
  in `button-group.test.tsx`).
- `npm test` (full `vitest run`): **210 passed, 22 skipped test files (up
  from 209 passed in commit 1); 2789 passed, 518 skipped tests, 0 failed**
  (up from 2782 passed — the +7 net matches the new assertions above).
- `npm run check` (all four tripwires — `check:audit`, `check:sql-date`,
  `check:deps-drift`, `check:brand-scope`): all four passed.

### Browser Verification (Phase 3's matrix, against the running dev server, Playwright + `/tmp/state.json` storage state)

All four required combinations plus one supporting screenshot were captured.
Screenshots saved to the scratchpad
(`/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/5dcc57c0-623c-4d05-8b0b-2b964647334a/scratchpad/`):

- **`btn2-fpcw-light.png`** — `/o/fpcw/directory`, light, 1280px. The Search
  button renders deep teal (`#377f7a`) with white text and a visible subtle
  rest shadow; the Members/Households/Parishes `ButtonGroup` renders as one
  connected pill with the active "Members" segment deep teal + white text
  and **no independent shadow on any segment** — the suppression holds in a
  real render, not just in the unit test's className string.
- **`btn2-fpcw-disabled-search.png`** (supporting, not one of the four named
  files but directly answering Phase 3's disabled-state instruction) —
  `/o/fpcw` home page, light, 1280px, search field empty. The "Search" button
  next to "Find a person" is disabled (per
  `find-person-form.tsx:63`, `disabled={trimmed === "" || isPending}`) and
  renders as a flat light-gray box with muted-gray text — legible as "this
  control is off," not a washed-out/translucent teal. This is the concrete,
  operator-visible proof of the D5 fix. (The directory page's own Search
  button is never disabled — it accepts an empty query — so the home page
  was the correct place to find this state, per the task's own hint.)
- **`btn2-fpcw-dark.png`** — same page, `colorScheme: dark`, 1280px. **Renders
  visually identical to the light screenshot** — teal `#377f7a` fill, white
  text, same background. This is NOT the Phase 3(e)/commit-1 "dark shows dark
  text on a lighter teal" asymmetry showing up; I traced why before writing
  this up (see Dark-Mode Finding below): fpcw's `organization_brands` row has
  `light_only = true`, which makes `<BrandTokens>` re-declare `brand.light`'s
  values (and force every platform-fixed token to its light value) inside the
  `:root:root.dark` block — confirmed by reading `--background`/`--primary`/
  `--primary-foreground` computed styles in the actual dark-mode page context
  (`#f9fffe` / `#377f7a` / `#ffffff` — all light-scheme values, even with
  `.dark` present on `<html>`). Captured anyway per the instruction ("capture
  for the operator's Phase 6 review, do not fix") and flagged as its own
  finding rather than silently treated as "the asymmetry didn't reproduce."
- **`btn2-fpcw-360.png`** — same directory page, light, 360px. No clipping or
  horizontal overflow; the button group and Search button both remain full
  touch-target height and legible at this width.
- **`btn2-platform.png`** — `/account` (platform palette, unbranded route
  group), light, 1280px. "Save name" / "Request email change" / "Change
  password" all render platform blue with white text, now carrying the
  subtle shadow — no regression. "Send feedback" renders disabled/muted-gray
  (textarea empty) using the same new disabled treatment; "Delete account"
  (`destructive`) is unchanged, still solid red — confirms the disabled/shadow
  changes did not leak into `destructive`.

### Dark-Mode Finding (flagged for Phase 6, not fixed here — out of this commit's scope)

fpcw is the one organization the operator's Phase 1 mockup review and this
work-log's dark-mode verification instruction were both written against, and
it happens to have `light_only = true` in `organization_brands` (a pre-existing
setting, unrelated to this pipeline — see `docs/work-log/
2026-08-24-light-only-brand.md`). Consequence: **the Phase 3(e)/commit-1
dark-scheme asymmetry (`dark.brand = #60a7a1`, `dark["on-brand"] = "#000000"`,
confirmed in commit 1's own fpcw sanity check) is never actually reachable in
fpcw's live rendering**, because `light_only` substitutes the light scheme's
re-declarable tokens into the `:root:root.dark` block regardless of the
`.dark` class on `<html>`. The generator-level asymmetry Phase 3(e) asked
Phase 6 to confirm with the operator is real (it is what commit 1's tests and
sanity check pin), but a dark-mode screenshot of fpcw specifically cannot
demonstrate it — `btn2-fpcw-dark.png` legitimately shows no visible
difference from light mode, and that is correct behavior for a `light_only`
org, not a rendering bug in this commit.

The one other seeded branded org, `e2e-presbytery` (seed `#7a1f2b`,
`light_only: false`), would actually exhibit the asymmetry in its dark-mode
rendering — I did not screenshot it because it is outside this commit's
scoped browser-verification matrix (fpcw + platform only), but naming it here
so Phase 6 has a path to a live demonstration if the operator wants one
before signing off on the asymmetry, rather than relying solely on the
generator's computed hex values from commit 1's sanity check.

### Implementer Notes

- No deviation from Phase 3(d)'s exact class strings for the shadow/hover
  treatment or the `ButtonGroup` suppression.
- One clarification made explicit above rather than assumed: Phase 3(c)'s
  text specifies only `disabled:bg-muted disabled:text-muted-foreground` (no
  `disabled:shadow-none`); the task brief that kicked off this commit flagged
  a possible `disabled:shadow-none` addition as "likely" but deferred to
  "follow the doc" — the doc does not call for it, so it was not added.
- No new dependency. No native dialogs touched. No `console.log` added.
  `generate.ts`/`contract.ts` (commit 1's files) untouched.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27

## Runs (independently reproduced)

- `npm run typecheck`: PASS, 0 errors.
- `npx vitest run src/lib/brand/`: 687 passed / 5 skipped / 0 failed — matches implementer exactly.
- `npm test`: 2789 passed / 518 skipped / 0 failed (210 passed files) — matches exactly; +7 over pre-commit-2 baseline, exactly the new assertions; no skip inflation.
- `npm run check`: 4/4 tripwires.

## Diff Verification — nothing smuggled

All six files + fixture read directly: contract.ts diff is ONLY the version bump + comment (TOKEN_POLICY/LEGAL_PAIRS untouched); generate.ts header + `clearsD3`/`clearsWhiteFloor` change with the deviation inline-documented; generate.test.ts **109 insertions, 0 deletions** (no assertion weakened); the 294-entry golden fixture is real and non-tautological (static JSON compared against current-code dark output, backed by a falsifiability assertion that at least one edge seed's dark on-brand is black); button.tsx exactly as described (default shadow-xs hover:shadow-sm; outline +hover:shadow-sm; base disabled → muted pair; divergence entries #5/#6; other variants untouched); button-group.tsx shadow suppression + docstring; no console.log/dialogs/deps; generate.ts imports only ./contract + ./contrast. Concurrent working-tree files from sibling pipelines (globals.css autofill, IA work-log) identified and excluded as expected, not findings.

## Commit-1 Deviation Review

`clearsWhiteFloor = scheme === "dark" || pickAchromaticForeground(hex) === "#ffffff"` vs Phase 3's literal ratio check: (i) documented inline and in the work-log; (ii) logically sound — a strictly TIGHTER condition (the selector returns white only when white already clears 4.5:1, and excludes the [0.175, 0.1833) band where black wins despite white clearing — the 87/294-seed failure of the literal sample); (iii) still provably terminating (crossover ~0.179 vs the header proof's ~0.1833, same fixed-step loop/bound; all 294 seeds pass empirically). **Legitimate implementation-level correction, not a design deviation requiring loop-back.**

## Live Browser Verification (computed styles, not screenshots alone)

- /o/fpcw/directory Search: rgb(55,127,122) / white / box-shadow present. ButtonGroup segments: no independent shadow.
- /o/fpcw disabled Search: rgb(241,245,249) / rgb(71,82,98) — the muted pair, not translucent teal.
- /account (platform): blue + white + new shadow; destructive unaffected.
- Dark + light_only: fpcw computed tokens stay light values in .dark (#f9fffe/#377f7a/#ffffff); `organization_brands.light_only = t` and `e2e-presbytery.light_only = f` both confirmed against the real DB.
- Disabled shadow-retention judgment: the retained shadow-xs (1px/2px/5% alpha) is visually indistinguishable from none; following Phase 3's literal text was defensible. **No finding.**

## Feature-Gate Audit

No routes or server actions in either commit — confirmed from the full file list, not inferred.

## Verdict

**PASS**

**Note carried to Phase 6:** the dark-scheme asymmetry evidence (golden fixture + generator sanity values + light_only trace) supports the operator conversation; a live dark screenshot required an org without light_only.

## Post-QA addendum (orchestrator, 2026-08-27)

The live dark evidence was produced without touching memberships (avoiding the test-rls fixture-count drift class): fpcw's `light_only` was flipped false for one screenshot capture — dark Search button rendered rgb(96,167,161)/#60a7a1 with black text, the exact designed asymmetry — then restored to true (verified). **The operator reviewed both the light set and the dark screenshot and ACCEPTED the asymmetry** ("Accept — each scheme computes its own correct pairing"). Phase 3(e)'s operator-confirmation requirement is satisfied ahead of Phase 6.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> The operator asked for buttons that look modern and read correctly, and got exactly that — deep teal with white text at 4.69:1, a real rest shadow on default/outline, a disabled state that reads as "off" instead of "washed-out teal" — verified live against a running dev server, not just from the work-log's claims.

## Live verification (analyst's own, independent of QA)

- /o/fpcw/directory Search: rgb(55,127,122) / white / real box-shadow; ButtonGroup renders one connected pill, no per-segment shadow (the twMerge suppression holds in a real render).
- All three named complaints resolved live: flat→shadow present; black-on-teal→white at 4.69:1; "gray off color"→disabled reads as honestly off (muted pair).
- /account (platform): blue + white + shadow; destructive untouched. /o/fpcw/admin tile variant untouched per DECISION-105.
- BRAND_TOKEN_VERSION comment read directly — honest about not gating a migration, points at the TODO asymmetry line.

## Intent-vs-Shipped

- Deepen primary until white passes, light-only, no contract change: shipped exactly (#579e98→#377f7a; dark byte-identical via golden fixture; light_only masks it on fpcw). **Matches.**
- Disabled = muted pair at base, reaching every variant: shipped as designed. **Matches.**
- Phase 3(e) operator confirmation of the dark asymmetry: obtained on the record (post-QA addendum — live dark screenshot reviewed, accepted). **Matches.**
- Commit-1 deviation: the operator asked for white text visibly on the button, not "white is mathematically legal" — the selector-based condition is MORE faithful to intent and the smaller diff. No loop-back.

## Edge cases

Empty state / microcopy / permission gate / audit: all n/a (pure styling+generator). Mobile 360px: pass per Phase 4's screenshot.

## Housekeeping

- docs/TODO.md asymmetry line present verbatim. Functionality map: no stale color-specific claims — no update needed.
- **Release notes: no entry yet — add at next cut (Enhancement class, every branded org affected).**
- Rule 12: n/a (live conversation). Rule 13: deferred by design to flag-flip time (no real congregation live).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-27 |

**Pipeline closed.** Remaining action: the release-notes entry at the next /release-notes pass.
