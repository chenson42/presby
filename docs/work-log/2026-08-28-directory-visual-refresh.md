# Directory visual refresh (avatars, sub-tabs, nav) — Work Log

> **Slug:** `2026-08-28-directory-visual-refresh`
> **Surface:** `(org)` — shared `GlobalNav`, the Directory sub-tab control, and directory/member card avatars (also reachable from other admin pages that reuse the same avatar treatment)
> **Permission(s):** none — pure presentation
> **Flag(s):** none — pure presentation
> **Estimated complexity:** medium — three related but distinct visual changes; one (nav) touches a shared, app-wide component
> **Pipeline mode:** Accelerated — Classification: Polish/visual (CSS/component restructuring, no new deps, no schema change, no API surface change). Phases 1–3 skipped with notation below; implemented by ux-developer with live-browser verification against a concrete external reference, then a real QA pass given the nav component's blast radius.
> **Source:** operator, 2026-08-28, live screenshot comparison against `../fpcw-directory`'s own Directory page — three concrete, specific gaps named and prioritized directly by the operator: (1) avatar color variation, (2) a segmented-control tray for the Members/Households/Parishes sub-tabs, (3) icon + active-pill treatment on the top nav. A fourth, separate finding (missing export/print/vCard/map-link features, with an explicit information-leakage concern about ungated printing) was logged directly to `docs/TODO.md` as a future feature-class pipeline, not part of this visual-only work.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | skipped (notation below) | — | — | 2026-08-28 |
| 2 — Architectural review | skipped (notation below) | — | — | 2026-08-28 |
| 3 — Technical design | skipped (notation below) | — | — | 2026-08-28 |
| 4 — Implementation | ux-developer | Complete | — | 2026-08-28 |
| 5 — Verification | qa | Complete | PASS | 2026-08-28 |
| 6 — Shipped vs intent | self | Complete | SHIP IT | 2026-08-28 |

---

## Phases 1–3 — skipped, with notation

Operator-driven visual comparison against a concrete, named reference app, not a functional feature request — no ambiguity to refine (Phase 1), no new directory/dependency/server-client split to review (Phase 2 — these are CSS/component-structure changes to already-existing, already-shared components), and no API contract or data model to design (Phase 3). The reference screenshots and the operator's own scoping (which of several identified gaps to build now vs. defer) stand in for Phase 1's flow/gap analysis. The concrete design decisions and their rationale are recorded in Phase 4 below.

## Reference comparison (for the implementer — no direct access to the operator's screenshots)

Two screenshots were compared directly: `../fpcw-directory`'s own `/directory` (Members) page, and presby's own `/o/fpcw/directory` page, both at desktop width, both signed in as an admin-equivalent role. Structurally the two pages are already close (same card grid shape, same field set per card, same general layout) — the gaps are specific, not a wholesale redesign:

1. **Avatars.** fpcw-directory varies each person's circular avatar background color across a small rotating palette (and mixes in real photos where available), so the grid of cards reads as varied/human. Presby's avatars are ALL one identical flat light-lavender circle with initials, no color variation at all (photos are a separate, already-tracked, larger gap — `people.photo_key` is unwired — and explicitly NOT part of this pipeline). **Ask:** derive a deterministic per-person background color from a small palette (e.g. hash the person's id or full name into an index over 5-6 muted, brand-adjacent hues), applied wherever this avatar treatment is used (directory cards at minimum; check for other reuse sites — household/member-list rows, admin members roster, etc. — before deciding whether this is one shared component or several independent call sites needing the same treatment applied consistently).
2. **Sub-tab segmented control.** fpcw-directory's Members/Households/Parishes tabs sit inside a rounded, light-gray "tray" container, with the currently-active tab rendered as a raised white pill with a subtle shadow inside that tray (an iOS-style segmented control). Presby's equivalent renders the active tab as a solid teal filled button sitting directly on the page background, with the inactive tabs as plain bordered buttons beside it — no shared tray container. **Ask:** find this component (likely near `src/app/(org)/o/[slug]/directory/` or a shared tab/segmented-control primitive), restructure to the tray-plus-raised-active-pill treatment. Do NOT invent a new one-off implementation if a shadcn `Tabs`-based primitive already exists in this codebase that produces this exact visual shape — check `src/components/ui/` first (`npm run ui:add` is the only supported way to add a new shadcn primitive if one is genuinely needed, never hand-rolled).
3. **Global nav.** fpcw-directory's top nav pairs a small icon with every label (Directory, Sign Up, Groups, Insights, MAP, Youth, Worship, Admin) and gives the active tab a filled, rounded pill background. Presby's `GlobalNav` (`src/components/shared/global-nav.tsx`) renders plain text labels with only an underline on the active tab — no icons, no pill fill. **Ask:** add a small icon per top-level nav category (this repo already has per-tile icon maps for the portal tile grid — `src/components/org-portal/tile-icons.tsx` — check whether the SAME icon-per-domain mapping can be reused here for visual consistency between the nav and the tile grid, rather than inventing a second, possibly-inconsistent icon choice per category) and change the active-tab treatment from underline to a filled rounded-pill background. **This is the highest-blast-radius change of the three** — `GlobalNav` is shared across the whole `(org)` tree (and possibly other route groups — check its actual usage sites before assuming scope) — budget real verification time here: check every surface that renders this nav, at both desktop and mobile widths, and re-run this repo's existing nav test file(s) before considering this done.

## Explicitly out of scope for this pipeline

- Photo upload / `people.photo_key` wiring (separate, already-tracked, larger gap — `docs/TODO.md`).
- The four missing directory export/output features (PDF, vCard, photo management, map-links) and their permission-gating — filed as its own future feature-class pipeline in `docs/TODO.md`, not touched here.
- A full redesign of the portal-home tile grid (already touched once, `docs/work-log/2026-08-27-portal-tile-contrast-and-coming-soon.md`) — this pipeline is scoped to the three named items only.

---

# Phase 4 — Implementation

**Date:** 2026-08-28
**Implementer:** ux-developer

## Files Created

- None — every change landed inside existing files. (`NAV_DOMAIN_ICONS` is a new export added to the existing `tile-icons.tsx`, not a new file.)

## Files Modified

**Item 1 — avatar colour variation**

- `src/app/(org)/o/[slug]/directory/person-avatar.tsx` — added `AVATAR_PALETTE` (6 muted Tailwind colour-family classes, each with a light/dark pair, e.g. `bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200`), a local `avatarPaletteClassName(seed)` DJB2-style hash (`hash = hash*31 + charCode`, `>>> 0`, `% 6`), and a required `seed: string` prop on `PersonAvatarProps` applied to `<AvatarFallback>`'s `className`.
- `src/app/(org)/o/[slug]/directory/person-card.tsx` — passes `seed={entry.personId}`.
- `src/app/(org)/o/[slug]/directory/[personId]/page.tsx` — the page's own top-of-page avatar passes `seed={entry.personId}` (the `<PersonCard>`s it renders for household members already get their seed from `person-card.tsx` itself).
- `src/components/org-portal/deacon-card.tsx` — passes `seed={deaconName}` (documented exception — no `personId` reaches this card; see the prop's own doc comment).
- `src/app/(org)/o/[slug]/directory/person-avatar.test.tsx` — added `seed` to every existing fixture, a palette-class-format assertion, and a new determinism `describe` block (same-seed stability across many calls, different seeds spread across buckets, id-not-name sensitivity, and "always one of the six declared classes").

**Item 2 — segmented-control tray**

- `src/components/shared/button-group.tsx` — restyled the ONE existing consumer (`directory-nav.tsx`'s Members/Households/Parishes row is the only real caller) from a connected, no-gap, `bg-primary`-active row into a `rounded-full bg-muted p-1` tray holding `ghost`-variant segments, with the active segment getting `bg-background text-foreground shadow-sm` (the raised pill). Checked `src/components/ui/` first per Component Rule 5 — no generated `Tabs` primitive exists, and a real shadcn `Tabs` would impose Radix's panel-swapping state model onto what is deliberately real `<Link>` navigation (documented in the file's own header), so restyling the existing `Button`-based component was correct over generating a new primitive.
- `src/components/shared/button-group.test.tsx` — replaced the two now-obsolete "outline/default shadow suppression" tests with tray/pill assertions (rounded tray + `bg-muted`, active pill `bg-background`+`shadow-sm`, inactive segment flat) and one for the single-row/overflow fix below.

**Item 3 — nav icons + active pill**

- `src/components/org-portal/tile-icons.tsx` — added `NAV_DOMAIN_ICONS: Record<PortalDomain, LucideIcon>`, reusing existing `TILE_ICONS` values per-domain (documented reasoning per domain in the export's own comment) rather than inventing a second icon vocabulary.
- `src/app/(org)/o/[slug]/portal-nav.tsx` — `PortalNavEntry.icon` is now populated with a STRING KEY (`"home"`, the `PortalDomain` string itself, or `"administration"`), not an icon component — see the bug note below.
- `src/app/(org)/o/[slug]/portal-nav-links.tsx` — `PortalNavEntry.icon?: "home" | PortalDomain`; a local `ICON_BY_KEY` map (built from `NAV_DOMAIN_ICONS` + `Home`) resolves the key to a real icon component ON THE CLIENT SIDE, rendered before the label. Replaced the `border-b-2`/`border-primary` underline active-state with a filled `bg-primary text-primary-foreground` rounded pill; inactive entries are transparent with `hover:bg-accent`.
- `src/app/(org)/o/[slug]/portal-nav.test.tsx`, `portal-nav-links.test.tsx` — updated every exact-object `toHaveBeenCalledWith`/fixture to the new icon-key shape; replaced the border-class test with pill/icon-rendering tests; added a dedicated test asserting every domain (plus Home/Administration) resolves to the correct icon key.

## Schema Changes

None.

## Audit Events

None — pure presentation, no mutations.

## Implementer Notes

**A real bug this pipeline's own "verify in a browser" rule caught, not `tsc`/`next build`.** The first pass of item 3 had `PortalNav` (a Server Component) build `PortalNavEntry.icon` as the actual Lucide icon COMPONENT reference and hand it straight to `PortalNavLinks` (`"use client"`). That is a genuine RSC serialization violation — a `lucide-react` icon is `React.forwardRef(...)`, an object with methods, and Next's RSC payload serializer rejects it: *"Only plain objects can be passed to Client Components from Server Components."* `tsc` and `next build` both stayed green through this (the type is structurally a function-shaped value at compile time); it only surfaced as a real 500 on `/o/<slug>` and every directory page once loaded in an actual browser with the dev server. Fixed by threading a plain **string key** (`"home"` / the domain string / `"administration"`) across the boundary and resolving it to the real icon component locally inside the client file, importing the same `NAV_DOMAIN_ICONS` map so there's still exactly one source of truth for "which icon means which domain." This is the single most important thing for QA to re-confirm independently — re-render every nav-bearing page in a real browser, not just typecheck/build, given this defect was invisible to both.

**Also caught live, not in review:** the segmented tray's first pass used `flex-wrap` on a `rounded-full` container. At 375px, Members/Households/Parishes (with icons) don't fit one row, and a `rounded-full` container wrapping to two rows draws a tall, lopsided stadium shape around both lines — worse than the treatment it replaced. Fixed to `flex-nowrap overflow-x-auto` (segments `shrink-0`) so the tray always stays a single, correctly-shaped stadium and the user can horizontally scroll to reach an overflowing segment. Verified via a real Playwright screenshot at 375px both before (ugly two-row blob) and after (clean single row with a partially-visible "Paris…" affordance) the fix.

**Deviation from the task's own file pointer:** the task named `src/components/shared/global-nav.tsx` for item 3's icon/pill work. That file (the top header — wordmark, org switcher, avatar menu) has no tabs and no underline at all. The actual "plain text labels with only an underline on the active tab" component is `src/app/(org)/o/[slug]/portal-nav-links.tsx` (rendered via `portal-nav.tsx`), a sibling component stacked directly beneath `GlobalNav` in `(org)/o/[slug]/layout.tsx`. Confirmed by reading `layout.tsx` and grepping every `GlobalNav` usage site before writing any code, per the task's own "find every actual usage site before assuming scope" instruction. `GlobalNav` itself was left untouched — there was nothing in it to change.

**Avatar palette design choice.** Did NOT add new brand tokens to `src/lib/brand/contract.ts`/`globals.css` — `TOKEN_POLICY` is a closed partition specifically over what `globals.css` declares in `:root`, and adding `--avatar-N` custom properties there is schema-shaped work `contract.test.ts`'s closure assertion would immediately flag, well outside this Polish-classified pipeline's scope. Instead reused the SAME idiom this codebase already has for decorative, non-brand colour-coding: literal Tailwind colour-family classes with light/dark pairs, exactly like `(admin)/admin/feedback/page.tsx`'s `CATEGORY_BADGE`/`STATUS_BADGE` maps. Chose 6 hues (slate, teal, indigo, violet, fuchsia, cyan) that avoid every colour this app already uses semantically (red/rose = destructive, amber/yellow = warning, green = the reserved `--success` token) so an avatar never accidentally reads as a status pill. Both directory pages this renders on live inside `(org)/o/[slug]`, a brandable route group, so nothing here needed to dodge `check:brand-scope` either (plain Tailwind utilities, not `*-brand[-*]` classes).

**Avatar seed choice for `DeaconCard`.** The one call site that can't seed on `person.id` — `deriveDeaconsByOrgUnit()` (`src/lib/directory.ts`) returns a deacon's name only, no `personId`. Extending that query's return shape is schema/query work outside this pipeline's scope, so `DeaconCard` seeds on `deaconName` instead, with the tradeoff documented directly on `PersonAvatarProps.seed`'s own doc comment — acceptable because that card renders at most one avatar per page render, never a grid where two same-named people could be seen side by side.

**No shared avatar-colour utility file created.** Per the task's own instruction to check for ≥2 real call sites before extracting: every caller renders `<PersonAvatar>`, never the hash function directly, so it stays a local, non-exported helper inside `person-avatar.tsx` (exported once, under a `__ForTest` suffix, purely so the test file can assert determinism directly rather than through DOM class-string matching).

## Live-Browser Verification (all via Playwright/`playwright-core`, cached `admin.json` storageState, against the running dev server)

**Orgs used:** `fpcw` (First Presbyterian Church of Westerville — real custom brand, teal/green, "light mode only") for the branded case; `northern-reach` (Presbytery of the Northern Reach — default platform palette) for the unbranded case. Both are orgs the seeded e2e admin fixture actually belongs to (confirmed via `/orgs` before picking them — `alder-creek`, first tried, 403'd: the fixture user has no relationship there).

**Desktop (1280px), both orgs:**
- `/o/<slug>/directory` — avatar grid: `fpcw`'s 17-person grid showed clearly distinct colours (pink, teal, gray, indigo, violet, cyan recurring) with the household-card/person-detail treatments unaffected; the segmented tray renders as a rounded grey tray with "Members" as a raised white pill, `Users`/`Home`/`MapPin` icons visible per segment.
- `/o/<slug>` (portal home) — the "Home" nav entry renders as a filled, rounded pill: solid platform blue with white text/icon on `northern-reach`, solid FPCW teal with white text/icon on `fpcw` — confirming `bg-primary`/`text-primary-foreground` clears contrast at both a default and a real custom seed (this is the same pair `Button`'s own `default` variant relies on, so this is expected, but confirmed rather than assumed).
- Every top-level category (People & Membership, Worship & Events, Giving & Finance, Governance & Courts, Reports & Insights, Communications, Administration) renders its own icon, matching `NAV_DOMAIN_ICONS`.

**Mobile (375px), both orgs:**
- Directory grid collapses to one column; avatars and the tray render identically in miniature. The tray's horizontal-scroll fix confirmed: "Members"/"Households" fit, "Parishes" partially visible at the trailing edge as a scroll affordance, single correctly-rounded stadium shape (not the two-row blob the first pass produced).
- The top nav collapses to the pre-existing hamburger ("Menu" + toggle button) — UNCHANGED by this work. Opened the overlay menu on both orgs: every entry shows its icon, "Home" renders full-width as the filled pill in the correct brand colour, the stacked list is otherwise identical in structure to before.

**Dark mode** (`colorScheme: "dark"` in the Playwright context, `northern-reach` — `fpcw` is a light-mode-only brand and correctly stayed light even with a dark system preference, a pre-existing mechanism unrelated to this pipeline, itself worth noting as still working): avatar fallbacks kept distinct, legible colours (`dark:bg-teal-900 dark:text-teal-200` etc.), the tray's `bg-muted`/active `bg-background` distinction still reads, and the nav's active pill (`bg-primary` resolves to the lighter dark-scheme blue, `text-primary-foreground` to the dark navy) stayed clearly legible.

**Existing/updated test files re-run:** `person-avatar.test.tsx`, `person-card.test.tsx`, `[personId]/page.test.tsx`, `deacon-card.test.tsx`, `button-group.test.tsx`, `portal-nav.test.tsx`, `portal-nav-links.test.tsx` — all pass. Full suite (`npm run test`): 3107 passed, 619 skipped (pre-existing skips, unrelated to this work), 0 failed. `npm run typecheck`, `npm run build`, and `npm run check` (all four tripwires) all pass clean.

**What a reviewer should click through:** `/o/fpcw/directory` and `/o/northern-reach/directory` at both 1280px and ~375px (browser devtools device toolbar), toggling Members/Households/Parishes to see the tray; `/o/fpcw` and `/o/northern-reach` portal home at both widths, opening the mobile hamburger menu, to see the nav icons and the "Home" active pill in both a branded and an unbranded palette; toggle OS/browser dark mode on `/o/northern-reach` for the same surfaces.

**Copy strings for a fork's branding pass:** none introduced — no new user-visible text, only colour/shape/icon changes to existing labels.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-28
**Verified by:** qa

All checks re-run fresh, independently, against the live dev server and real dev database — not inferred from the implementer's report.

## Type Check

`npm run typecheck`: **PASS**, clean.

## Unit Tests

Total: 3726 | Passed: 3107 | Failed: 0 | Skipped: 619 | Duration: 17.67s. Matches the implementer's claimed numbers exactly. Zero skips among the four touched test files (confirmed by grep); ran those four in isolation as an extra check: 4 files, 50 tests, 0 failed, 0 skipped.

## End-to-End Tests

Not applicable via `npm run test:e2e` — this diff touches no auth-path file, so CLAUDE.md's mandatory-e2e clause doesn't apply. In its place, QA independently drove the real running dev server with Playwright (cached `admin.json` storageState): `/orgs`, `/o/fpcw`, `/o/fpcw/directory` (+ households view), `/o/northern-reach`, `/o/northern-reach/directory` (+ households view) — all at 1280px, all at 375px including opening the mobile hamburger, and `northern-reach` again under `colorScheme: 'dark'`. Every case: HTTP 200, zero `pageerror` events, zero ≥500 responses. Screenshots captured and visually inspected for each.

**Independent confirmation of the eight specific risk points:**
1. **RSC-serialization bug absence** — confirmed by reading `portal-nav.tsx` (no `lucide-react` import, icon values are string literals) AND by live rendering (all nav pages 200, zero page errors, correct icons visible on screenshots).
2. **Avatar color determinism** — extracted the actual rendered `[data-slot="avatar-fallback"]` class for all 17 cards on `/o/fpcw/directory`, reloaded, re-extracted: zero mismatches. Cross-checked the same person's color matches between the directory card and their own detail page. Genuinely varied (fuchsia/teal/slate/indigo/violet/cyan all present).
3. **Segmented-control tray** — confirmed live at 1280px and 375px on both orgs: rounded `bg-muted` tray, raised white active pill; at 375px the tray stays one row with a scroll affordance (the `flex-nowrap`/`overflow-x-auto` fix holds — no two-row lopsided shape).
4. **Nav icon + pill** — every top-level category renders its icon on both `fpcw` (branded, teal) and `northern-reach` (default palette); active entry renders as a filled rounded pill with clean contrast on both.
5. **Dark mode** — avatar palette and nav pill both confirmed legible via a real dark-mode screenshot on `northern-reach`.
6. **Full suite re-run** — typecheck/test/build/check all pass fresh, matching claims.
7. **Touched test files read in full** — all four assert genuine behavior (color-determinism buckets, tray/pill class assertions, a named `flex-nowrap` regression test, and a string-vs-component icon-key contract test that would fail against the pre-fix shape) rather than render-without-crashing. Noted honestly: a jsdom unit test cannot itself reproduce Next's RSC payload-serialization rejection — the live-browser check above is what actually re-verifies the runtime claim; the unit test pins the type contract that prevents regressing back to it.
8. **No permission/flag side effects** — `git diff HEAD` on every touched file shows only the intended additive change (a `seed` prop, an icon key, a class-name restructure); pre-existing `hasPermission`/`isFlagEnabled` calls in `[personId]/page.tsx`, `directory-nav.tsx`, and `portal-nav.tsx` are untouched.

## Regression Tests Added

- `src/components/shared/button-group.test.tsx:79` — stays a single row (`flex-nowrap` + `overflow-x-auto`, never `flex-wrap`) — guards against the two-row lopsided tray at 375px found during Phase 4's own browser verification.
- `src/app/(org)/o/[slug]/portal-nav.test.tsx:243` — asserts each nav entry carries an icon **key** (string), not the icon component itself — guards against regressing back into the RSC-serialization bug found and fixed during Phase 4.
- `src/app/(org)/o/[slug]/directory/person-avatar.test.tsx:131-182` — same-seed stability, cross-seed bucket spread, id-vs-name sensitivity.

## Coverage on Critical Modules

Not applicable — this pipeline touches none of `src/lib/permissions.ts`, `src/lib/two-factor.ts`, or `src/lib/flags.ts`.

## Feature-Gate Audit

Confirmed by reading route/action bodies and diffing against `HEAD`, not by inferring from green tests. **No protected routes or server actions touched** — this is pure presentation. No file in scope adds, removes, or alters an `auth()`/`hasFeature()`/`hasPermission()` call.

## Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (self)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> All three operator-named gaps against `../fpcw-directory` — flat identical avatars, a button-styled sub-tab control, and a plain-text underlined nav — are closed with independently re-verified, real-browser-confirmed changes, and the operator confirmed the result directly ("i like it") before this was recorded.

## What's Working

- Avatar color variation lands exactly as scoped: deterministic per-person, confirmed stable across reload and across two different entry points (directory card vs. person detail page), with no new shared utility invented where only one real call site existed (Component Rule 5 respected).
- The segmented-control tray reuses the existing `ButtonGroup` primitive rather than hand-rolling a new one or reaching for a `Tabs` primitive that would have wrongly implied panel-swapping over real navigation — a correct read of when NOT to generate a new shadcn primitive.
- The nav icon/pill treatment reuses the portal tile grid's own existing per-domain icon map (`tile-icons.tsx`) instead of inventing a second, possibly-inconsistent icon choice for the same category — visual consistency between the nav and the tile grid was a real design goal even though nobody had to ask for it explicitly.
- A genuine, non-cosmetic bug (RSC-serialization crash from passing a Lucide component across the server/client boundary) was caught by live-browser verification during implementation, not shipped and discovered later — exactly the discipline this project's "Verify in a Browser" invariant exists to enforce, and QA independently re-confirmed the fix holds at runtime rather than trusting the implementer's fix claim.

## Intent-vs-Shipped Diff

- Operator said: vary avatar colors so the directory grid doesn't read as identical/sterile. Shipped: a 6-hue deterministic palette, verified stable and varied live. **Matches.**
- Operator said: give the Members/Households/Parishes sub-tabs a softer, tray-plus-raised-pill treatment matching the reference. Shipped: exactly that, via the existing `ButtonGroup` primitive, with a mobile-overflow bug found and fixed before handoff. **Matches.**
- Operator said: give the top nav icons and a filled active-pill treatment matching the reference. Shipped: exactly that, reusing the existing tile-icon map; verified on both a branded and a default-palette org, in dark mode, at both viewport widths. **Matches.**
- Not part of this pipeline, named and correctly deferred rather than silently skipped: photo upload (`people.photo_key`, larger pre-existing gap) and the four missing export/print/vCard/map-link features (own future pipeline, `docs/TODO.md`, with the print information-leakage concern already flagged there).

## Edge Cases

- Empty state: not applicable — no new empty-state surface introduced.
- Failure microcopy: not applicable — pure presentation, no new failure path.
- Permission gate: pass — confirmed by QA's Phase 5 audit that no auth/permission logic was touched.
- Audit event: not applicable — no security-sensitive mutation in this pipeline.
- Mobile (360-390px): pass — confirmed live for all three changes, including a real bug (tray two-row wrap) found and fixed before this verdict.

## Follow-Ups (none blocking)

- None. This closes cleanly with no deferred debt beyond what was already out-of-scope and tracked elsewhere (`docs/TODO.md`).

No feedback row to mark (operator live screenshot comparison, not an in-app submission). No what's-new entry warranted (internal visual polish to an already-shipped surface, not a new capability).

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
