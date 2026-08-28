# PresbyPortal Brand Kit v1.0 — Work Log

> **Slug:** `2026-08-27-presbyportal-brand-kit`
> **Surface:** mixed — platform chrome + marketing home, not per-org branding
> **Permission(s):** not needed
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Accelerated — Classification: Polish/visual (CSS/color/font/logo, no new deps, no schema change, no API surface change). Phases 1–3 skipped with notation below; self-implemented and self-verified, not routed through the agent pipeline (matches the house convention several other same-day pipelines have honestly flagged — see "Self-verification caveat" in Phase 6).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | skipped (notation below) | — | — | 2026-08-27 |
| 2 — Architectural review | skipped (notation below) | — | — | 2026-08-27 |
| 3 — Technical design | skipped (notation below) | — | — | 2026-08-27 |
| 4 — Implementation | self | Complete | — | 2026-08-27 |
| 5 — Verification | self | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | self | Complete | SHIP WITH NOTES | 2026-08-27 |

---

## Phases 1–3 — skipped, with notation

The operator supplied a finished asset deliverable (`presbyportal-branding.zip`: brand guidelines PDF, logo SVGs in three lockups + reverse, favicon.ico, an app-store icon, and design tokens as both `.css` and `.json`) and asked to apply it. There was no functional ambiguity to refine (Phase 1), no new directory/dependency/server-client split to review (Phase 2 — the work is entirely CSS custom-property values, static SVG/PNG/ICO assets, and one `next/font/google` import, all inside existing files/directories), and no API contract or data model to design (Phase 3). The design decisions that DID need making — which platform tokens the kit's palette maps onto, how to handle dark mode (the kit specifies one scheme only), and one deviation from the kit's literal `danger` hex — are recorded in Phase 4 below and in DECISION-127.

---

# Phase 4 — Implementation

## Files Created

- `public/brand/presbyportal-logo-{horizontal,horizontal-reverse,stacked}.svg`, `presbyportal-mark.svg` — brand kit assets, copied verbatim
- `public/brand/presbyportal-mark-reverse.svg` — white-arch cropped from the reverse wordmark's own mark (the kit ships no standalone reverse mark file); added same-day for the hero watermark below
- `src/components/brand/platform-mark.tsx` — `PlatformWordmark`/`PlatformMark`, the platform's own static logo components (distinct from `OrgMark`/`OrgWordmark`, which render an uploaded congregation's own logo)
- `src/app/favicon.ico`, `src/app/apple-icon.png` — brand kit assets (Next.js App Router static-icon convention). `favicon.ico` was replaced a second time same-day with a properly size-tuned version the operator supplied separately (`favoicon.zip`) — 48/32/16px each individually hand-composed (16px drops the gold threshold and enlarges the arch for legibility, per that package's own `favicon_contents.png` reference sheet), rather than one vector rendered down to each size. The first zip's flat `favicon.ico` (16/32px only, no per-size tuning) is superseded.

## Files Modified

- `src/lib/brand/contract.ts` — `PLATFORM_TOKENS.light`/`.dark` repainted to the PresbyPortal palette (navy/blue/gold); every legal pair re-verified against S16's floors (table in the file's own comment), not trusted from the kit's README claims
- `src/app/globals.css` — `:root`/`.dark` transcribed to match, per the existing dual-source-of-truth contract (`contract.test.ts` asserts equality both directions)
- `src/app/icon.svg` — square favicon composed from the kit's mark on a navy rounded-square canvas (same 32×32/rx=7 shape the placeholder icon used)
- `src/app/layout.tsx` — added `next/font/google` Inter at platform level (the kit specifies "Inter Display" for headings, which isn't a distinct Google Fonts family — plain Inter matches the kit's own fallback chain); metadata title/OG copy `"presby"` → `"PresbyPortal"` (DECISION-126 was already settled; this closes two places it hadn't reached yet)
- `src/components/shared/global-nav.tsx`, `src/app/page.tsx` — swapped the text "presby"/"PresbyPortal" wordmark for the real logo (`PlatformWordmark`)
- `src/app/(admin)/admin/layout.tsx`, `src/app/(org)/o/[slug]/layout.tsx` — two more literal `"presby"` text strings found in the same sweep (an admin-sidebar back-link the operator reported live, and a signed-out degraded-header fallback) → `"PresbyPortal"`
- `src/lib/brand/generate.test.ts` + `src/lib/brand/__fixtures__/dark-scheme-golden.json` — see "Ramp-generator interaction" below
- `src/components/shared/global-nav.test.tsx`, `src/app/page.test.tsx`, `src/app/(org)/o/[slug]/layout.test.tsx` — updated to match the new wordmark/text (see Phase 5)
- `src/components/brand/platform-mark.tsx` — `PlatformMark` gained `variant` (`default`/`reverse`) and `decorative` (drops the forced px height + `alt`, so `className` fully controls sizing/position for a background-texture use rather than a fixed-size logo instance)
- `src/app/page.tsx` — hero gained a large, low-opacity (`opacity-[0.07]`) reverse mark bled off the right edge as background texture, per an operator-supplied mockup showing this treatment (a superseded earlier draft of the brand kit itself, per that kit's own README — the mockup's logo/color/type choices were NOT adopted, only this one layout idea). Scoped deliberately narrow after confirming with the operator: the watermark only, not merging the top bar into the hero and not reintroducing the hero's own CTA-button row (both real parts of the mockup, both declined — the latter would have reversed a documented earlier decision to remove a redundant CTA next to the top bar's Sign in/Continue).

## Schema Changes

None.

## Design decisions (would normally be Phase 2/3)

1. **Danger/`--destructive` deviates from the kit's literal `#B4232A`.** The per-org ramp generator (`src/lib/brand/generate.ts`) runs an exhaustive 288-seed property test checking every possible congregation brand hue against the platform's `danger` hue in OKLCH space (D6, `MIN_BRAND_DANGER_HUE_DISTANCE_DEG = 45°`) — a check this platform rebrand doesn't touch but must not break. `#B4232A`'s OKLCH hue (24.6°) sat close enough to one red-violet grid seed that the seed's brand hue (already nudged by the generator) missed the 45° floor by 0.1°. Nudged to `#B22B1E` (OKLCH hue 29.8°, back near the prior palette's pure-red hue of 27.2° that suite was already proven safe against) — same "brick red" visual family, same accessibility floor (6.45:1 white text vs the kit's own 6.53:1), zero change to the generator itself. Documented inline in `contract.ts`.
2. **Dark mode is my own derivation, not the kit's** — `presbyportal_tokens.css` ships one scheme. Followed the existing pattern this file's own history established (a lighter step of the brand hue for `--primary`, dark ink for its foreground, a darker/richer neutral for `--background`/`--card`): navy-900 background, navy-800 card/muted, blue-300 primary. Every pair re-verified against the D1–D4 floors (see `contract.ts` comment), not assumed from the light-scheme math.
3. **`--radius` untouched.** The kit's own token set (`presbyportal_tokens.css`) declares a different radius scale (`--pp-radius-*`) for whatever product surface it was originally speced for; this app's `--radius: 0.5rem` is a deliberate, load-bearing choice (DECISION-048, `globals.css`'s own comment: bumping it "moves all four [Tailwind radius steps] and repaints the app"). Out of scope for a brand-kit application; flagged, not silently overridden.
4. **`PlatformWordmark`'s dark-mode logo swap is CSS-only** (`dark:hidden` / `hidden dark:block` on two `<img>`s, matching the app's class-based — not `prefers-color-scheme` — dark-mode strategy), discovered live and fixed after the first screenshot pass showed the light-lockup's navy ink nearly invisible on the dark header. Both images carry `alt=""`/`aria-hidden`; the wrapping `<Link>` carries `aria-label="PresbyPortal"` instead — two `alt="PresbyPortal"` images in one link would concatenate to an accessible name of "PresbyPortal PresbyPortal" (accname computation sums every child's text alternative; a real browser excludes the CSS-hidden one from the a11y tree, but that's not something to rely on for the *other* one's name composition). See the component's own doc comment.

## Ramp-generator interaction (found running the full suite, not anticipated in advance)

`generate.test.ts`'s dark-scheme golden-fixture test (`dark-scheme-golden.json`, captured for an unrelated prior pipeline — button-modernization — to prove a light-scheme-only change didn't leak into dark) failed for every seed on `border`/`danger`/`input-border`/`muted-surface`/`on-danger`/`on-muted-surface`: expected, since dark-scheme derivation copies those straight from `PLATFORM_TOKENS.dark` (`copyPlatform()`, Step 9) and this pipeline intentionally changed them. Regenerated the fixture from the current generator for every entry in `ALL_SEEDS` (temporary in-test `fs.writeFileSync`, removed after running once) rather than hand-editing 288×2 JSON blocks. Every OTHER field (seed-derived: `surface`/`brand`/`on-brand`/etc.) is byte-identical to before, which is itself confirmation the derivation logic wasn't touched — only its platform-fixed inputs were. Documented inline in the test file.

## Audit Events

Not applicable — no mutation, no security-sensitive surface.

## Implementer Notes

Scope held to platform chrome (`GlobalNav`, the marketing home `/`, `(admin)`'s sidebar, `(org)`'s degraded fallback header) and the two Next.js icon conventions. Explicitly NOT touched: per-org branding (`organization_brands`, the ramp generator's *derivation logic*, `/admin/design-system`'s own sign-off page — a natural next stop but a separate, deliberate look given it exists specifically to sanity-check the full token set at once), `/developer`'s "presby schema" copy (left alone — it's describing the actual Postgres schema name, which CLAUDE.md keeps as deliberate continuity, not stale branding), and the DB-role/SQL-function rename (already tracked in `docs/TODO.md` as its own future pipeline).

---

# Phase 5 — Verification (self)

**Date:** 2026-08-27
**Verified by:** self (not routed through `qa` — see the Phase 6 self-verification caveat)

## Type Check

`npm run typecheck`: PASS

## Unit Tests

Total: 3529 | Passed: 2977 | Skipped: 552 | Failed: 0 | Duration: ~10.5s
Two real failures surfaced and fixed during the pass (both in `src/lib/brand/generate.test.ts`, both traced to the intentional platform-token change, neither a pre-existing gap): the OKLCH hue-distance near-miss (fixed by nudging `danger`, see Phase 4) and the stale dark-scheme golden fixture (regenerated). No other test file in the 251-file suite was affected by the palette/token change — the closed three-way `TOKEN_POLICY` partition and `contract.test.ts`'s bidirectional transcription check did their job.

## Regression Tests Added

None new — existing coverage (`contract.test.ts`'s 58 pair/transcription assertions, `generate.test.ts`'s 288-seed property grid + golden fixture) already exercises exactly this surface and is what caught both real issues above.

## Lint

`npm run lint`: 7 pre-existing errors (already tracked in `docs/TODO.md` Papercuts — `branding-form.tsx`, `portal-nav-links.tsx`, three children's-roster files), zero new. Confirmed by diffing the error file list against files this pipeline touched.

## Build

`npm run build`: PASS, zero errors/warnings. Confirmed `/icon.svg`, `/favicon.ico`, `/apple-icon.png` all built as static routes.

## Brand-Scope Tripwire

`npm run check:brand-scope`: PASS.

## Verify in a Browser (CLAUDE.md invariant)

Real dev server (`npm run dev`), real Chromium via Playwright (already a devDependency) — not just `curl`/build success. Screenshotted `/` at desktop 1280px (light + dark) and mobile 375px (light). Caught and fixed one real bug this way: the platform wordmark's navy/blue ink was nearly invisible against the dark-mode header before the CSS dark-swap (Phase 4, decision 4) — exactly the class of defect CLAUDE.md's own "Verify in a Browser" section exists to catch, and it would have shipped invisible to `tsc`/`next build`/the test suite (jsdom doesn't execute compiled Tailwind, so the two-image swap tests green in vitest regardless of which image is CSS-visible). Also screenshotted `/icon.svg` standalone to confirm the favicon composition renders as a clean, centered, legible mark at small size.

Re-screenshotted (same three viewports) after the hero watermark addition: reads as a subtle background texture, not a competing second logo, in both schemes; no horizontal-scroll/overflow introduced (`overflow-hidden` on the section clips the bled-off edge); on mobile it's cropped mostly out of frame, which is an acceptable desktop-emphasis flourish, not a defect.

## Feature-Gate Audit

Not applicable — no protected routes touched; every change is either an unauthenticated static asset or copy/color on already-existing (already-gated where relevant) pages.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (self)

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The platform now has a real, applied visual identity — navy/blue/gold palette, a real logo instead of "presby" text, Inter, and the app's own favicon — everywhere except the one deliberately-scoped-out surface (per-org branding, untouched).

## What's Working

- Every WCAG pair the app's own contract enforces (D1–D4, S16) was re-verified against the actual new hex values, not assumed from the kit's README — caught nothing wrong there, but it would have.
- The ramp generator's exhaustive 288-seed property test caught a real, narrow (0.1°) hue-distance regression from the kit's literal `danger` value before it shipped — exactly the kind of thing that class of test exists to catch, and exactly why it wasn't skipped even though this pipeline "isn't touching the generator."
- A real dark-mode contrast bug (the wordmark, not a token) was caught by actually looking at a screenshot, not by any automated gate — none of typecheck, lint, the full test suite, or the production build would have caught it.

## Intent-vs-Shipped Diff

- Operator said: "let's apply some branding!" (open-ended). Shipped: platform chrome + marketing home fully repainted, favicon/app-icon replaced, Inter added, every literal "presby" text string found in a full-tree sweep fixed (including one live-reported bug, the admin sidebar back-link). Verdict: matches the evident intent of "apply the kit," went slightly further than a minimal reading by also sweeping stray un-rebranded text the kit itself didn't ship assets for — acceptable, since CLAUDE.md's DECISION-126 already settled that "PresbyPortal" is the correct public-facing name everywhere.
- Two deliberate deviations from the kit's literal deliverable (danger hex nudge, dark mode is invented not supplied) are both documented inline in code, not just here, so a future reader of `contract.ts` doesn't have to find this work-log to understand why the platform doesn't exactly match the kit's own `presbyportal_tokens.css`.

## Edge Cases

- Empty state: n/a
- Failure microcopy: n/a
- Permission gate: n/a — no gate touched
- Audit event: n/a
- Mobile (360px): pass — screenshotted at 375px, header/hero/logo all fit
- Dark mode: pass, after the mid-pipeline fix documented above

## Follow-Ups (SHIP WITH NOTES)

- **`/admin/design-system` (the token sign-off page) wasn't independently re-screenshotted against the new palette.** It's a natural next stop — it exists specifically to show every brand token at once — but wasn't in this pipeline's scope; worth a quick look next time it's touched.
- **This pipeline was self-implemented and self-verified, not routed through the six-phase agent pipeline** (Classification: Polish, and the deliverable was a finished asset kit rather than an ambiguous feature request) — matching several other same-day pipelines' own honest self-verification caveat. A genuinely independent look (architect on the token/contrast math, qa on the browser verification) would be the fuller version of this if the palette proves to need another pass.
- **`presbyportal_logo_stacked.svg` and the square `PlatformMark` are shipped as components but have no live call site yet** — narrow-space and icon-only treatments the kit provides for, unused today. Fine to leave unused; note it so it isn't mistaken for dead code.
- Both filed in `docs/TODO.md`.
