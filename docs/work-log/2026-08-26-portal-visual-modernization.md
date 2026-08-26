# Portal Visual Modernization — Work Log

> **Slug:** `2026-08-26-portal-visual-modernization`
> **Surface:** `(org)/o/[slug]` portal-chrome files only — color/shadow use, motion, `TYPE_SCALE` adoption, entirely within the existing brand-token cascade (DECISION-046)
> **Permission(s):** none.
> **Flag(s):** recommend one flag for the motion piece specifically (e.g. `org_portal.motion`); pure CSS shadow/type-scale changes carrying no behavioral branch need no flag.
> **Estimated complexity:** medium — presentation-only, no schema/permission surface, but real cross-browser/360px verification burden.
> **Pipeline mode:** Full. Split out of `docs/work-log/2026-08-26-portal-reorg-and-modernization.md` at Phase 2 (architect, 2026-08-26) — carries forward only Part B of that combined Phase 1.
> **Source — operator direction (2026-08-26):** "i really want it to feel super modern and new" → "bolder colors/shadows like the public site has, more motion/depth, a different type scale. this portal has to be super easy to use and not overwhelming also."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (carried forward, Part B slice) | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-102 | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | ux-developer | Complete | Implemented per Phase 3 | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS (after one loop-back) | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

*(Carried forward, Part B slice only — see `docs/work-log/2026-08-26-portal-reorg-and-modernization.md`'s own Phase 1 for the fuller original combined write-up.)*

## VERDICT

**READY WITH NOTES**

## Flow

**Flow 4** — cross-cutting visual delta on every existing portal flow, not a new flow of its own.
- Failure: if a scroll/reveal technique needs JS to become visible and that JS fails or is blocked, content must not stay invisible — CSS-only, `prefers-reduced-motion`-respecting techniques are the safe default.

## Gaps carried forward, already investigated, confirmed accurate and not stale

- The "244/97 `text-sm`/`text-xs`" figure in the original request was stale; the real re-count is **432**/**105** (excluding `.test.` files). Scope `TYPE_SCALE` adoption to the portal-chrome files this pipeline actually touches, not a whole-app migration.
- "Bolder colors/shadows like the public site" was checked against the actual reference (`presby-site-kit/src/styles.css`: 3 total `box-shadow` declarations, all subtle) — the real target is full-bleed saturated color blocks, a gradient scrim over hero photography, and heavy display-weight type, not a drop-shadow aesthetic.
- Elderly-skewing-membership tension: the codebase's own `MIN_MEMBER_FACING_PX = 14` and "legibility wins over character" type-pairing stance argues boldness belongs on CTAs/headings/chrome, never body text or information density.

## Out of Scope, confirmed

A full `TYPE_SCALE` migration site-wide; any change to `LEGAL_PAIRS` or the brandable/bounded/platform token partition; extending the pass beyond the portal tree.

## Open Question carried forward, resolved in Phase 2

Should this scope to `(org)` only, or extend to `(account)`/`(member)` too? **Resolved: `(org)` only.**

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.**

## Placement

- **Directory placement:** no new files/directories at the module level — this is an edit pass across existing portal-chrome component files under `(org)/o/[slug]/`, `src/components/shared/`, and possibly `src/lib/brand/contract.ts`'s already-declared (per Phase 1's own finding) but unmigrated `TYPE_SCALE` export, wiring it into the touched files rather than inventing a new scale.
- **Scope confirmed: `(org)` portal tree only, not `(account)`/`(member)`.** `(account)`/`(member)` render in the platform palette (DECISION-047 — not one of the two brandable groups), and the operator's stated ask was specifically about this portal in the context of a congregation's own branded experience. Extending a bolder/motion-forward pass to platform-chrome pages every organization sees identically is a different, unscoped ask; if wanted later, it needs its own Phase 1.
- **Server vs. client split:** CSS/Tailwind-class changes and `prefers-reduced-motion`-respecting transitions stay in existing Server Components wherever the touched component already is one — this pass should not *convert* a Server Component to a Client Component to add motion. Where a genuine reveal-on-scroll technique requires JS (e.g., an `IntersectionObserver`-driven fade), that specific interactive piece becomes `'use client'`, scoped narrowly to the smallest wrapping component (Component Rule 1) — not applied blanket across a page.
- **Dependencies: none new, confirmed.** Real motion is achievable with Tailwind's built-in transition utilities and plain CSS (`@media (prefers-reduced-motion: reduce)`, CSS transitions/animations, `IntersectionObserver` from the platform, no library). A motion library (Framer Motion or similar) fails the Dependency Evaluation Criteria's "already solved by an existing dependency" test before any bundle-size/Edge-runtime question is reached. If Phase 3 finds a *specific* technique CSS genuinely cannot express, that's a fresh dependency proposal requiring its own Phase 2 pass.

## Invariants Touched

- **The Brand Is a Cascade Override (DECISION-046)** — the one invariant genuinely live here, respected by construction as long as Phase 3 holds the line: every color/shadow/type change must route through the existing `--primary`/`--foreground`/etc. custom properties the cascade already declares (`bg-primary`, not a new hardcoded hex), so a congregation's brand still overrides the same tokens it always has. **Concrete Phase 3 obligation:** any new bold color-block treatment must be expressed as `bg-primary`/`bg-accent`-family utilities (or new *brandable*-partition tokens added to `src/lib/brand/contract.ts`'s closed classification, if a genuinely new token is needed), never a literal color value that bypasses the org override.
- **No hand-rolled button/table class strings (Component Rule 5 / C2)** — bolder chrome must still go through `Card`/`Button` primitives and their variants; a bold-CTA treatment should become a new `Button` variant if the existing ones don't cover it, not a one-off class string, or `check:brand-scope`'s C2 rule fails it.
- **Verify in a Browser** — the sharpest real risk here, and one this repo has already been bitten by three times by name (blocked dev assets killing hydration, `<summary>`/iOS, a disclosure that never opens). Motion is exactly this bug class. Non-negotiable Phase 4/5 gate: verified in an actual phone-viewport browser, not inferred from `next build` passing.

## Notes

1. **`TYPE_SCALE` adoption is scoped to the portal-chrome files this pipeline touches** — confirmed, not the 432/105-site whole-app migration. If a broader migration is wanted later, it's its own Polish-class or Feature-class pipeline with its own Phase 1.
2. **Boldness belongs on chrome/CTAs/headings, never body text or information density** — carried forward as a hard constraint, given the codebase's own `MIN_MEMBER_FACING_PX`/legibility-first stance and the operator's own "not overwhelming" qualifier.
3. **Flag the motion piece only.** Pure shadow/type-scale CSS changes with no behavioral branch don't need their own flag — matches this session's existing `org_portal.*` flag discipline of reserving flags for things that need independent rollback.
4. **`prefers-reduced-motion` is a hard requirement, not a nice-to-have**, given this repo's own documented history of motion-adjacent bugs.

## Implementer(s) Phase 3 should expect

**ux-developer**, likely single commit (or a small handful scoped by surface area) — no schema, no permission, no server-side change of any kind.

## Handoff

**Next: tech-lead (Phase 3), for this file only.** Carry forward: `(org)`-only scope (not `(account)`/`(member)`); no new dependency, Tailwind/CSS only, any deviation needs its own Phase 2; every color/shadow change must route through the existing brand-token cascade, never a hardcoded value; boldness on chrome/CTAs only, never body text/density; `prefers-reduced-motion` required; real-browser 360px verification is a Phase 4/5 gate, not optional.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

A scoped visual pass over the `(org)` portal-home and directory chrome that
replaces today's uniformly-neutral treatment with three concrete bold
touches — grounded in `presby-site-kit/src/styles.css`'s actual reference
(full-bleed saturated `--primary` fills, not drop-shadows): (1) the portal
home's `Greeting` gets a solid `bg-primary`/`text-primary-foreground` band,
the one hero-like surface on the page; (2) the home tile grid's tool tiles
convert from bordered-neutral cards to a new `Button` `tile` variant carrying
the same solid-fill treatment, mirroring site-kit's `data-variant="solid"`
feature-grid card; (3) the persistent portal nav's active link gets a
`border-primary` accent in place of a text-only distinction. Alongside this,
two genuine `TYPE_SCALE` violations found in the touched files (a `<p>`
description rendered at the `dense` role, which `TYPE_SCALE` itself forbids
for prose, in both `TileGrid` and `PortalFooter`) are corrected to the `body`
role. One small, explicitly-flagged motion addition — a CSS-only mount
fade-in on the greeting band, reusing the already-imported `tw-animate-css`
utilities with no new dependency — ships behind `org_portal.motion` (seeded
off) so it can be rolled back independently of everything else in this pass.
Everything else in the touched-file list (`PersonCard`, `HouseholdCard`,
`DeaconCard`, `DirectoryNav`/`ButtonGroup`, the `(org)/o/[slug]` layout shell)
is deliberately left unchanged, named below.

## Permissions & Flags

- Permission key(s): none — presentation-only, no new grant.
- Default role bindings: n/a.
- Feature flag(s): **one new flag**, `org_portal.motion` — gates only the
  greeting band's CSS mount fade-in (see Component/Page Plan and Edge Cases).
  Seeded `enabled: false` in `scripts/seed.ts`, following the exact
  comment/shape convention of the adjacent `org_portal.*` entries. Every other
  change in this design (the two bold color-block treatments, the
  `TYPE_SCALE` corrections, the active-nav accent) is pure CSS with no
  behavioral branch and needs no flag, per Phase 2 Note 3.

## API Contract

n/a — presentation only. The one new prop surface:

- `Greeting({ displayName, motionEnabled }: { displayName: string | null;
  motionEnabled: boolean })` — `motionEnabled` defaults to nothing (required,
  explicit at the one call site) rather than defaulting `true`/`false`
  inside the component, so a future second caller can't silently inherit a
  motion decision made for the home page.
- New `Button` `variant`: `"tile"` added to `buttonVariants`'s `variant`
  union in `src/components/ui/button.tsx` (cva entry, not a prop signature
  change — existing `variant?: "default" | "outline" | ... "tile"` callers
  are unaffected).

## Data Model

No schema changes required. One new **data** row (not a migration): the
`org_portal.motion` feature-flag row inserted by `scripts/seed.ts` into the
existing `feature_flags` table.

## Component / Page Plan

**Files to modify:**

- `src/components/ui/button.tsx` — add a `tile` variant to `buttonVariants`:
  a solid `bg-primary text-primary-foreground` fill (i.e. the *same* fill
  `default` already uses) plus the layout properties none of the existing
  five variants carry (`flex-col`, `items-start`, `h-auto`, `whitespace-normal`,
  `text-left`) so a multi-line tile (icon + heading + description) can sit
  inside a `Button`-based container instead of a hand-rolled `className`
  string (Component Rule 5 / C2). Hover treatment: `hover:brightness-105`,
  matching site-kit's own cited rule for its solid feature-grid tile
  (`styles.css:660-662`, `filter: brightness(1.05)` on hover) rather than
  `default`'s `hover:bg-primary/90` — a large full-bleed tile brightening
  slightly reads better than one darkening toward the page background.
  Document this as divergence **#4** in the file's own header comment block,
  matching its existing house style for hand-edits to a generated file.
- `src/components/org-portal/greeting.tsx` — wrap the existing `<h1>` in a
  `bg-primary text-primary-foreground rounded-lg px-6 py-8` band. The `<h1>`
  itself keeps its current `text-2xl font-semibold` (already exactly
  `TYPE_SCALE`'s `title` role — "the single `<h1>`" — no size change). Add
  the required `motionEnabled: boolean` prop; when `true`, add
  `animate-in fade-in-0 duration-700` to the band's wrapper (from
  `tw-animate-css`, already imported in `globals.css:2` and already used
  elsewhere in the tree — e.g. `dropdown-menu.tsx` — so this is not a new
  technique, just a new consumer). When `false` (including every render
  before this flag is turned on anywhere), the band still renders — the fill
  and padding are unconditional; only the entrance animation is gated.
- `src/app/(org)/o/[slug]/page.tsx` — inside the existing `homeV2Enabled`
  branch, read `isFlagEnabled("org_portal.motion")` alongside the
  already-present `getPortalHomeData()` call (same `Promise.all` shape the
  file already uses for its other flag reads), and pass the result as
  `motionEnabled` to `<Greeting>`.
- `src/components/org-portal/tile-grid.tsx` — each tile's `<Link
  className="...">` becomes `<Button asChild variant="tile" size="lg"
  className="h-auto w-full min-h-11 gap-2"><Link href={...}>...</Link>
  </Button>` (matches `ButtonGroup`'s own existing `Button asChild` +
  `<Link>` pattern for a real `GET` navigation, not a client action). Drop
  the current `hover:bg-accent hover:text-accent-foreground` (the neutral
  hover no longer applies once the resting state is already a solid fill).
  The description `<p>` moves from `text-sm text-muted-foreground` to
  `text-base text-primary-foreground/90` — both a `TYPE_SCALE` correction
  (`dense`/`text-sm` is explicitly "never a paragraph"; this is a paragraph,
  so it moves to `body`/`text-base`) and a color correction (the old
  `text-muted-foreground` has no defined contrast against the new
  `bg-primary` fill; `primary-foreground` does, per `LEGAL_PAIRS`). Add a
  trailing `ChevronRight` (`lucide-react`, already a dependency) pinned via
  `mt-auto self-end`, echoing site-kit's arrow-at-the-bottom convention
  (`styles.css:617-624`) with a real icon component instead of hand-rolled
  CSS pseudo-elements — there is no reason to reinvent what `lucide-react`
  already ships.
- `src/app/(org)/o/[slug]/portal-nav-links.tsx` — `linkClassName()` gains an
  unconditional `border-b-2` (base) plus `border-primary` when active /
  `border-transparent` when not (never omitted for either state — see Edge
  Cases for why omitting it on the inactive state would shift layout).
  Replaces no existing classes; `font-semibold text-foreground` for the
  active state stays, this is additive.
- `src/components/org-portal/portal-footer.tsx` — the `address` and `phone`
  lines move from the ambient `text-sm` (inherited from the wrapping `<div>`)
  to an explicit `text-base` (`TYPE_SCALE` `body`) override, for the same
  "this is a paragraph a member needs to read, not a label" reason as
  `TileGrid`'s description. The organization-name label, the footer nav
  recap, and the copyright line stay `text-sm` — legitimate label/metadata/
  legal-boilerplate uses `TYPE_SCALE`'s `dense` role explicitly permits.
- `scripts/seed.ts` — add the `org_portal.motion` row.

**Files explicitly NOT modified** (see Out of Scope for the full list and
rationale): `src/components/org-portal/yours-zone.tsx`,
`src/components/org-portal/find-person-form.tsx`,
`src/app/(org)/o/[slug]/directory/person-card.tsx`,
`src/app/(org)/o/[slug]/directory/household-card.tsx`,
`src/components/org-portal/deacon-card.tsx`,
`src/app/(org)/o/[slug]/directory/directory-nav.tsx`,
`src/components/shared/button-group.tsx`,
`src/app/(org)/o/[slug]/layout.tsx`, `src/app/(org)/o/[slug]/portal-nav.tsx`,
`src/lib/brand/contract.ts`, `src/app/globals.css`,
`src/lib/org-portal/tiles.ts`.

**Pages/components to create:** none — every change above is an edit to an
existing file.

## Implementation Order

1. `src/components/ui/button.tsx` — add the `tile` variant, document as
   divergence #4.
2. `scripts/seed.ts` — add the `org_portal.motion` row; run `npm run
   db:seed` on a dev database and confirm the row inserts (idempotent
   `onConflictDoNothing`, matching its siblings).
3. `src/components/org-portal/greeting.tsx` — the band + `motionEnabled` prop.
4. `src/app/(org)/o/[slug]/page.tsx` — read the flag, thread the prop.
5. `src/components/org-portal/tile-grid.tsx` — the `tile` variant adoption,
   description `TYPE_SCALE`/color correction, chevron icon.
6. `src/app/(org)/o/[slug]/portal-nav-links.tsx` — the active-state border.
7. `src/components/org-portal/portal-footer.tsx` — the address/phone
   `text-base` correction.
8. Update `src/components/org-portal/tile-grid.test.tsx`'s existing
   "applies the shadow-lift hover treatment alongside the existing accent
   color-shift" test (it asserts `hover:bg-accent`/`hover:text-accent-
   foreground`, both removed by step 5) to assert the new `tile`-variant
   classes instead. Add a `greeting.test.tsx` case asserting the fade-in
   class is present when `motionEnabled` is `true` and absent when `false`.
   No standalone `button.test.tsx` exists today; coverage for the new `tile`
   variant can live in `tile-grid.test.tsx`, its actual consumer.
9. `npm run check` (all four tripwires, including `check:brand-scope`'s C2
   rule against the new `Button`/`Link` composition), `npm run typecheck`,
   `npm run test`.
10. Real dev server, real phone-viewport (360px) browser pass — light
    scheme, dark scheme, OS-level `prefers-reduced-motion: reduce` on, and
    at least one org with a configured non-default brand seed (not just the
    platform default palette) — non-negotiable per Phase 2 and restated in
    Edge Cases below.
11. `npm run test:e2e` (full suite — these specs render `/o/<slug>` and
    would catch a hard crash even though none assert on the new classes
    directly).
12. At Phase 6 / ship time: `docs/product/functionality-map.md` and
    `docs/TODO.md` reconciliation (Rules 10/14), and a `/release-notes`
    judgment call on whether this presentation refresh warrants a
    `whats_new_entries` row (Rule 13 — advisory, not required).

## Edge Cases & Risks

- **Existing-test blast radius (the thing this repo's own retro flagged):**
  `src/components/org-portal/tile-grid.test.tsx`'s "applies the shadow-lift
  hover treatment alongside the existing accent color-shift" test hard-codes
  `hover:bg-accent`/`hover:text-accent-foreground` in its assertions — both
  are removed by the `tile`-variant conversion. This is a **known, named**
  break, not a discovered one; item 8 of Implementation Order is the fix.
  Grep confirmed no other unit test and no e2e spec (`post-login-
  routing.spec.ts`, `header-controls.spec.ts` — the two that navigate to
  `/o/<slug>`) assert on `greeting`/`tile-grid` class strings; they check
  pathname/URL and header controls only, so they're expected unaffected —
  but run the full suite (step 11) rather than trusting that expectation.
- **Alpha-composited text on a solid fill:** `text-primary-foreground/90` on
  the tile description is an alpha composite, and `button.tsx`'s own header
  comment already documents why `contrast.ts` refuses to check alpha
  notations against `LEGAL_PAIRS` ("an alpha-composited fill's rendered
  colour depends on what's behind it"). Here the backdrop is the *same*
  solid `bg-primary`, so the composite can only read as `primary-foreground`
  blended toward `primary` — strictly less contrast than the full-opacity,
  contract-guaranteed 4.5:1 pair, never more. The implementer must eyeball
  this in a real browser (step 10) against both the platform default and a
  real non-default org brand seed, and fall back to full-opacity
  `text-primary-foreground` (drop the `/90`) if it reads as marginal for
  any seed — the 90%-opacity echo of site-kit is cosmetic, not a
  requirement, and site-kit's own version of this treatment was never
  checked against a contrast floor at all (a deliberate choice documented
  in its own stylesheet for ITS reference-matching purpose, not one this
  member-facing chrome should silently inherit).
- **Why `bg-primary`, not `bg-brand-raw`:** `contract.ts` classifies
  `--brand-raw`/`--brand-raw-foreground` as `additive` — declared only by
  `<BrandTokens>` for an org that actually has a configured brand row, never
  in `globals.css`'s platform-default `:root`. A brand-new tenant with no
  brand row yet (`orgBrand === null`, `<BrandTokens>` renders `null`) would
  have `--brand-raw` fully undefined, and there is also no `--color-brand-
  raw` entry in `globals.css`'s `@theme inline` block today, so a
  `bg-brand-raw` Tailwind utility doesn't even exist yet. `--primary`/
  `--primary-foreground` have no such gap — both are declared unconditionally
  in `globals.css`'s `:root` *and* `.dark` blocks (the platform defaults) and
  already have the `@theme inline` mapping, so `bg-primary`/`text-primary-
  foreground` render correctly for every org, branded or not, in both
  schemes, with zero new plumbing. Wiring `--color-brand-raw` into Tailwind
  is a real, separable idea for a future pass (a "decorative, unbounded raw
  seed" surface distinct from the interactive `--primary`) — out of scope
  here (see Out of Scope).
- **`check:brand-scope` C2, post-edit:** the redesigned tile is a `<Button
  asChild variant="tile">` — the button-shape regex is expected to match
  inside `button.tsx` itself, which `PRIMITIVE_DIR` already exempts. Any
  *additional* per-instance className added at the `tile-grid.tsx` call site
  must not independently reconstruct a button/table shape outside
  `src/components/ui/`; run `npm run check:brand-scope` (via `npm run
  check`) after the edit and confirm zero new violations rather than
  assuming the exemption covers a composed call site too.
- **`prefers-reduced-motion`, verified not assumed:** `globals.css:218-227`
  already forces every `animation-duration`/`transition-duration` to
  `0.01ms` tree-wide under `prefers-reduced-motion: reduce` — in principle
  this neutralizes the new `animate-in fade-in-0` classes for free, with no
  new media query needed. This must be **confirmed in a real browser** with
  the OS setting on (step 10), not trusted from reading the CSS — `tw-
  animate-css`'s utilities are a third-party package and could in principle
  set animation timing through a custom property the blanket rule doesn't
  reach. This is exactly the class of assumption Key Invariants → Verify in
  a Browser exists to catch.
- **Layout shift on nav active-state:** the new `border-b-2` on
  `PortalNavLinks` must be applied **unconditionally** (transparent when
  inactive, `border-primary` when active) rather than only on the active
  item — an active-only border would shift every link's vertical position
  by 2px when its active state toggles, at both the desktop wrapped-row and
  mobile stacked-menu presentations.
- **Real-browser 360px verification is a Phase 4/5 gate, restated
  explicitly per this design's mandate:** the tile's icon+heading+
  description+chevron stack, the greeting band's padding, and the nav
  active-border must each be checked on an actual phone-viewport browser —
  not inferred from `next build`/`tsc` passing (Key Invariants → Verify in a
  Browser; three prior bugs in this project were exactly this class and
  invisible to those checks).
- **Flag interaction:** the greeting band and tile-grid changes only render
  at all when `org_portal.home_v2` is already on (the `OrgPortalStub`
  fallback is untouched); `org_portal.motion` only ever adds the entrance
  animation on top of that. No interaction risk with `chrome_v2`/`chrome_v3`,
  which independently govern the header/footer.

## Out of Scope

- `(account)`/`(member)` — untouched (DECISION-102, carried from Phase 2).
- Hero photography / gradient scrim over an image — no image-upload/hero-
  asset feature exists on the portal; introducing one is a materially larger
  feature than "a visual pass," so this design uses a solid-color band
  instead of replicating site-kit's photographic hero.
- Wiring `--brand-raw`/`--brand-raw-foreground` into Tailwind's `@theme` —
  a real future idea (see Edge Cases) but a new token-contract decision, not
  this one.
- `src/components/org-portal/yours-zone.tsx`,
  `src/components/org-portal/find-person-form.tsx` — left unmodified;
  neither is chrome or a CTA in the sense this pass targets.
- `src/app/(org)/o/[slug]/directory/person-card.tsx`,
  `household-card.tsx`, `src/components/org-portal/deacon-card.tsx` — left
  unmodified. These are information density (a directory listing), which
  Phase 2's constraint puts off-limits for boldness; their pre-existing
  `hover:shadow-md transition-shadow` (shipped under a prior pipeline) is
  untouched and not this design's to re-litigate.
- `src/app/(org)/o/[slug]/directory/directory-nav.tsx` /
  `src/components/shared/button-group.tsx` — no change; the active tab
  already renders `variant="default"` (`bg-primary`/`text-primary-
  foreground`), which is already the boldest treatment this design would
  otherwise be proposing.
- `src/app/(org)/o/[slug]/layout.tsx` — no change; the persistent-nav row's
  own background stays neutral (only its active *link* gets the new
  border-accent, in `portal-nav-links.tsx`), to avoid a second bold band
  competing with the greeting band for attention on every page.
- Scroll-triggered / `IntersectionObserver`-driven reveal — **explicitly
  recommended against.** Portal-home content (greeting, find-a-person,
  yours zone, tile grid) is short enough to mostly fit one or two screens
  even at 360px; a scroll-reveal would require converting a Server Component
  to a client leaf and introduces exactly the named risk from Phase 1's Flow
  4 ("if a scroll/reveal technique needs JS to become visible and that JS
  fails or is blocked, content must not stay invisible") for negligible
  benefit to an audience this codebase already treats as skewing older and
  wanting immediately-visible, not choreographed, content.
- A whole-app `TYPE_SCALE` migration (432 `text-sm` / 105 `text-xs` sites) —
  confirmed out of scope in Phase 1 and Phase 2; this design corrects
  exactly two concrete, in-file violations (`TileGrid`'s and `PortalFooter`'s
  paragraph text at the `dense` role) and touches nothing else.
- `docs/architecture.md` — not touched (Rule 15); this is a presentation
  pass, not a new subsystem or changed data flow.

## Implementer

**ux-developer.** No schema, no route/server-action surface, no permission
change — entirely React components, one generated-primitive edit, and one
seed-data row. Matches Phase 2's own expectation.

---

# Phase 4 — Implementation (ux-developer)

## Files Created

None — every change is an edit to an existing file, per Phase 3's own plan.

## Files Modified

- `src/components/ui/button.tsx` — added a `tile` `buttonVariants` entry:
  `bg-primary text-primary-foreground hover:brightness-105 flex-col
  items-start h-auto whitespace-normal text-left`. Documented as divergence
  #4 in the file's existing header-comment numbered list, matching the
  house style of divergences #1–#3.
- `src/components/org-portal/greeting.tsx` — wraps the `<h1>` in a
  `rounded-lg bg-primary px-6 py-8 text-primary-foreground` band. Added the
  required `motionEnabled: boolean` prop; when `true`, adds `animate-in
  fade-in-0 duration-700` (from `tw-animate-css`) to the band.
- `src/components/org-portal/greeting.test.tsx` — updated both existing
  cases to pass the now-required `motionEnabled` prop; added a band-fill
  assertion and a motion on/off assertion (fade-in class present only when
  `motionEnabled` is `true`).
- `src/app/(org)/o/[slug]/page.tsx` — reads `isFlagEnabled("org_portal.motion")`
  alongside the existing `getPortalHomeData()` call and threads it through
  as `<Greeting>`'s `motionEnabled` prop. (Note: the file uses sequential
  `await`s for its flag reads, not `Promise.all` — Phase 3's text described
  it as "the same `Promise.all` shape the file already uses," but no
  `Promise.all` actually exists in this file; the new read follows the
  file's real, sequential-await convention instead, which is functionally
  equivalent for this purpose.)
- `src/components/org-portal/tile-grid.tsx` — each tile is now `<Button
  asChild variant="tile" size="lg" className="h-auto w-full min-h-11
  gap-2"><Link href={...}>...</Link></Button>` in place of the hand-rolled
  `<Link className="...">`. The description moved from `text-sm
  text-muted-foreground` to `text-base text-primary-foreground/90` (the
  `TYPE_SCALE` `body`-role correction plus the contrast correction for the
  new solid fill). Added a trailing `ChevronRight` (`lucide-react`) pinned
  `mt-auto self-end`.
- `src/components/org-portal/tile-grid.test.tsx` — replaced the
  "shadow-lift hover treatment" assertions (asserted removed classes:
  `hover:shadow-md`, `hover:bg-accent`, `hover:text-accent-foreground`) with
  assertions on the new `tile`-variant classes (`bg-primary`,
  `text-primary-foreground`, `hover:brightness-105`); added a
  `TYPE_SCALE`-role assertion on the description and a two-icon (leading +
  chevron) assertion.
- `src/app/(org)/o/[slug]/portal-nav-links.tsx` — `linkClassName()` now adds
  an unconditional `border-b-2`, plus `border-primary` when active /
  `border-transparent` when not (present on both states, to avoid layout
  shift on toggle).
- `src/app/(org)/o/[slug]/portal-nav-links.test.tsx` — added a case
  asserting the border-accent classes on both the active and an inactive
  entry.
- `src/components/org-portal/portal-footer.tsx` — the address `<p>` and the
  phone `<a>` now carry an explicit `text-base` (overriding the wrapping
  div's ambient `text-sm`), the `TYPE_SCALE` `body`-role correction. The
  org-name label, nav recap, and copyright line are untouched (legitimate
  `dense`/`text-sm` uses).
- `src/components/org-portal/portal-footer.test.tsx` — added a case
  asserting `text-base` on the address paragraph and the phone link.
- `scripts/seed.ts` — added the `org_portal.motion` flag row (seeded
  `enabled: false`), appended after the existing `org_portal.branding`
  entry, matching every sibling `org_portal.*` entry's comment/shape
  convention.

**Files explicitly left untouched**, confirmed against Phase 3's own list:
`src/components/org-portal/yours-zone.tsx`,
`src/components/org-portal/find-person-form.tsx`,
`src/app/(org)/o/[slug]/directory/person-card.tsx`, `household-card.tsx`,
`src/components/org-portal/deacon-card.tsx`,
`src/app/(org)/o/[slug]/directory/directory-nav.tsx`,
`src/components/shared/button-group.tsx`,
`src/app/(org)/o/[slug]/layout.tsx`, `src/app/(org)/o/[slug]/portal-nav.tsx`,
`src/lib/brand/contract.ts`, `src/app/globals.css`,
`src/lib/org-portal/tiles.ts`. (The working tree also carries unrelated,
pre-existing uncommitted changes to `portal-nav.tsx`, `page.test.tsx`,
`tiles.ts`/`tiles.test.ts`, `docs/TODO.md`, `docs/decisions.md`, two other
work-logs, and a Drizzle migration — all from other in-flight pipelines
(portal-reorg-and-modernization, tenant-branding-permission, admin-hub).
None of those are this pipeline's edits; they were already present in the
working tree before this Phase 4 session started and are left exactly as
found.)

## Schema Changes

None. One new **data** row: `org_portal.motion` inserted into the existing
`feature_flags` table by `scripts/seed.ts`, confirmed by running `npm run
db:seed` against the dev database (flag count went from 19 → 20).

## Audit Events

None — presentation-only, no security-sensitive mutation.

## Implementer Notes

**Verification run (all green):**
- `npm run typecheck` — pass, no errors.
- `npm run build` — pass, all 60+ routes compiled, no errors.
- `npm run check` (all four tripwires) — `check:audit`, `check:sql-date`,
  `check:deps-drift`, and `check:brand-scope` all pass. `check:brand-scope`'s
  C2 rule specifically: the new `<Button asChild variant="tile">`
  composition at the `tile-grid.tsx` call site produced zero new
  violations.
- `npm run test` — 154 test files passed, 15 skipped; 2232 tests passed,
  304 skipped; 0 failures. (The `fatal: cannot change to
  '/nonexistent/path/for/this/test'` line is stderr noise from an unrelated
  pre-existing test exercising a missing-directory case; it is not a
  failure — the summary line confirms 0 failed.)
- Grepped `e2e/post-login-routing.spec.ts` and `e2e/header-controls.spec.ts`
  directly (not trusted from Phase 3's claim): both navigate to `/o/<slug>`
  but assert only on pathname/URL and header/org-switcher controls — zero
  assertions on `greeting`/`tile-grid`/`portal-nav-links` class strings.
  Phase 3's claim holds. Did not run the full Playwright e2e suite (this is
  not an auth-touching diff, so that gate doesn't apply, and the e2e
  fixture DB is a separate, isolated database from the one used for live
  verification below).

**Live-browser verification (mandatory, actually run against `localhost:3000`,
not inferred from source):** Signed in as `admin@presby.invalid` via the
real `/signin` form (Playwright-driven, not curl), flipped
`org_portal.motion` on directly in the dev DB's `feature_flags` table, and
viewed `/o/fpcw` (a real branded org — First Presbyterian Church of
Westerville) at 1280px and 360px, plus a `reducedMotion: 'reduce'` browser
context. Reverted the flag to its seeded `false` default afterward so the
dev DB is left as `db:seed` would leave it.

Findings:
- **Brand cascade confirmed, not assumed:** `fpcw`'s computed
  `background-color` on the greeting band and the tiles was `rgb(87, 158,
  152)` (a teal), NOT the platform default blue (`globals.css`'s
  `--primary: hsl(221 83% 53%)` ≈ `rgb(37, 99, 235)`). This confirms
  `bg-primary`/`text-primary-foreground` are consuming the org's own brand
  override through the cascade, not a hardcoded value — the class in the
  DOM is `bg-primary`, and its rendered color differs per-org as expected.
- **Tile solid fill, hover, and chevron confirmed:** tile background matches
  the band's `rgb(87, 158, 152)`; each tile renders exactly 2 `<svg>`s
  (leading tool icon + trailing chevron); hovering a tile animates
  `filter` from `brightness(1)` to `brightness(1.05)` (confirmed after
  waiting out the `transition-all` — an immediate read post-hover
  under-reports mid-transition).
- **Motion confirmed both ways:** with `org_portal.motion` on, the band's
  computed `animation-name` is `enter` with `animation-duration: 0.7s`
  (matching `duration-700`). Under a `reducedMotion: 'reduce'` browser
  context, the SAME band still carries the `animate-in fade-in-0` classes
  in its DOM `class` attribute, but computed `animation-duration` drops to
  `1e-05s` (0.01ms) — confirming `globals.css:218-227`'s existing tree-wide
  `prefers-reduced-motion` rule neutralizes `tw-animate-css`'s utility
  without any new media query, exactly as Phase 3's Edge Cases predicted,
  verified rather than assumed.
- **Nav accent confirmed on both desktop and mobile:** the active "Home"
  link's computed `border-bottom-color` is `rgb(87, 158, 152)`
  (`border-primary`) at both 1280px and 360px (menu opened via the
  hamburger toggle); an inactive entry's computed border-bottom-color is
  transparent — no visible layout shift on toggle, checked by screenshot.
- **Footer/tile text legibility confirmed:** the tile description's
  computed `font-size` is `16px` (`text-base`, `TYPE_SCALE`'s `body` role)
  and the footer address/phone lines are likewise `16px`, vs. `14px` for
  the still-`text-sm` org-name label/nav-recap/copyright lines — the
  `TYPE_SCALE` correction is real in the rendered DOM, not just in source.
- **One thing that did NOT look fully resolved and is worth naming rather
  than silently fixing:** the tile's actual computed padding is `0px`
  top/bottom and `16px` left/right — not the `24px`/`16px` (or `p-4`
  all-around) a plain reading of `size="lg"` (`px-6`) might suggest.
  Tracing it: the `lg` size variant's own `has-[>svg]:px-4` rule (written
  for a leading-icon-plus-text button) fires here too, because the tile's
  trailing `ChevronRight` ends up as a *direct child* of the composed
  `<Button asChild>`'s rendered `<a>` once Radix `Slot` merges the two
  elements — so horizontal padding drops from `px-6` to `px-4`, and there
  was never a vertical padding utility in Phase 3's specified call-site
  className (`"h-auto w-full min-h-11 gap-2"`) or in the new `tile` cva
  entry to begin with. In the actual screenshots (both 1280px and 360px)
  this reads as "a bit tighter than the old `p-4` treatment" rather than
  broken — line-height and the `gap-2` flex gap between the heading,
  description, and chevron supply enough visual breathing room that the
  tiles are legible and not cramped-looking — but it is a real,
  measurable divergence from what Phase 3's literal classNames would
  visually suggest. I implemented Phase 3's design exactly as specified
  (per this task's explicit instruction not to invent additional changes
  beyond the Component/Page Plan) rather than adding an unrequested
  padding override; flagging this for qa/analyst to weigh, and it's a
  one-line follow-up (e.g. adding explicit `py-4` to the `tile` variant) if
  Phase 6 wants it addressed.
- **Dark mode:** attempted via Playwright's `colorScheme: 'dark'` context
  option; the app did not visibly switch to its dark theme under that
  emulation alone (this app's dark mode appears to be a stored
  preference/toggle, not a bare `prefers-color-scheme` follow), so this
  did not exercise `globals.css`'s `.dark` block for `--primary`. Not
  treated as a gap specific to this change: `bg-primary`/
  `text-primary-foreground` is the same existing token pair `default`
  already uses everywhere (including in dark mode), so this pass
  introduces no new dark-mode risk — but it also means dark mode is not
  independently confirmed for this specific change, and a reviewer with
  access to the app's real theme toggle should spot-check it.

**Design deviations from Phase 3, both already noted above:** the
`Promise.all` shape referenced in Phase 3's page.tsx instruction doesn't
exist in the file (sequential `await`s used instead — functionally
identical); no vertical tile padding was specified and none was added.
Neither is a scope change — no additional classes, props, or files beyond
Phase 3's Component/Page Plan were introduced.

**Copy strings for a fork's branding pass:** none new — no user-facing text
was added or changed. All new content is layout/CSS/icon only (the
`org_portal.motion` flag's admin-only description string is not
member-facing).

**QA loop-back (2026-08-26) — added the missing org_portal.motion assertion
in page.test.tsx, no production code changed.** QA's Phase 5 FAIL named one
gap: the "ON" describe block never asserted `isFlagEnabled` was called with
`"org_portal.motion"`, nor that the rendered greeting reflects it, so a
future refactor dropping the read, swapping the key, or inverting the
boolean would ship with every existing test green. Fix, test-only:
- Extended the existing "renders the greeting, and passes the household
  through to the yours zone" case with `expect(isFlagEnabled)
  .toHaveBeenCalledWith("org_portal.motion")` plus a rendered-output check
  that the greeting band's class list does NOT carry `animate-in`/
  `fade-in-0` when the mock resolves `org_portal.motion` false (the
  existing mock in that test already only resolves `org_portal.home_v2`
  truthily, so this exercises the off path).
- Added a new case, "threads org_portal.motion ON to Greeting's
  motionEnabled prop," mocking both flags true and asserting the band's
  class list DOES carry `animate-in fade-in-0` — the on path, symmetric
  with the off assertion above.
- Verified: `npx vitest run "src/app/(org)/o/[slug]/page.test.tsx"` — 7/7
  passed (was 5). `npm run typecheck` — clean (the one error QA attributed
  to the concurrent `tenant-branding-permission` sibling pipeline is no
  longer present at this HEAD). `npm run test` — full suite, 158 files /
  2272 tests passed, 0 failed (16 files / 323 tests skipped) — the `fatal:
  cannot change to '/nonexistent/path/for/this/test'` stderr line is the
  same pre-existing unrelated noise QA and Phase 4 both already
  identified, not a failure.

## Handoff

**Next: qa (Phase 5).** Suggested manual click-through for QA: sign in as
the seeded admin, visit `/o/fpcw` with `org_portal.home_v2` on (already the
seeded/live default) and `org_portal.motion` toggled both ways at
`/admin/flags`, at both a desktop width and 360px, confirming the greeting
band, tile grid, nav accent, and footer text look as described above.
`npm run test` and `npm run check` are the automated gates; `npm run
test:e2e` is fair game per Phase 3's Implementation Order step 11 (grepped,
not run, in this session — no assertions on the changed classes were
found, so no regression is expected, but qa should still run the full
suite once for a real dev-server pass). The one open item worth a decision
before/at Phase 6: whether the tile's zero-vertical-padding (see
Implementer Notes) needs a follow-up now or can ship as-is.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check / Build

One error present at HEAD, attributed to a different, concurrently in-flight sibling pipeline (`tenant-branding-permission`'s `audit.ts`/`audit.test.ts` drift), confirmed via `git diff` not to touch any file in this pipeline's list — not blocking this verdict.

## Unit Tests

Full suite: 2244 passed / 323 skipped / 0 failed. Targeted files (`greeting.test.tsx`, `tile-grid.test.tsx`, `portal-nav-links.test.tsx`, `portal-footer.test.tsx`): 28/28 passed.

## Independent Verification Performed

- No literal color/arbitrary Tailwind value anywhere in the diff (grepped directly) — every fill routes through `bg-primary`/`text-primary-foreground`/`border-primary`.
- No new dependency (`package.json`/`package-lock.json` diff empty).
- `tile` variant added properly to `buttonVariants()`, not a call-site hack.
- **Motion gating verified live** against a real dev server: normal context shows `animationDuration: 0.7s`; `reducedMotion: 'reduce'` context shows the same classes present but `animationDuration: 1e-05s` (neutralized by the existing tree-wide rule) — confirmed, not assumed. Brand cascade confirmed live and per-org (fpcw renders real teal, not a hardcoded value). Flag reverted to off and confirmed via fresh page load.
- **Tile padding finding independently reproduced**: `padding-top`/`padding-bottom` computed to `0px` due to `has-[>svg]:px-4` firing on the trailing chevron via Radix `Slot` composition. Real, visually confirmable, but not a functional regression — no contrast/tap-target/brand violation, nothing clips. Recommended as a named `docs/TODO.md` follow-up, not a blocker.

## Regression Tests Added

New coverage added correctly for `greeting`, `tile-grid`, `portal-nav-links`, `portal-footer`. **Named gap, not covered anywhere**: `src/app/(org)/o/[slug]/page.tsx`'s own wiring — reading `isFlagEnabled("org_portal.motion")` and threading it to `Greeting`'s `motionEnabled` prop — has no assertion in `page.test.tsx`'s "ON" describe block. The block's `isFlagEnabled` mock only resolves `"org_portal.home_v2"` truthily; any other key (including `"org_portal.motion"`) silently falls through to `false`, and no test checks the call or the rendered output as a function of it. Production behavior is confirmed correct via live-browser verification, but nothing in CI protects it — a future refactor that drops the flag read, swaps the key, or inverts the boolean would ship with every existing test green.

## Feature-Gate Audit

No protected routes/actions touched — presentation-only change, confirmed by reading the Files-Modified list directly (zero `route.ts`, zero `"use server"` actions). `org_portal.motion` is a toggle with no permission semantics, correctly checked bare.

## Verdict

**FAIL** — one named, narrow coverage gap: `src/app/(org)/o/[slug]/page.test.tsx`'s "ON" describe block (around line 130) has no assertion that `isFlagEnabled` is called with `"org_portal.motion"` or that the result is correctly threaded to `Greeting`. Fix: one additional assertion following the exact pattern already established at `page.test.tsx:119` for `"org_portal.home_v2"`, plus a rendered-output check on the greeting band's class list. Everything else checked clean — were this gap not present, the verdict would have been PASS with the tile-padding item as a named, non-blocking follow-up.

**Handoff: back to the implementer (ux-developer), Phase 4 loop-back**, for the single missing test assertion. No production-code change implied; re-verification should be fast.

---

# Phase 5 — Verification (qa) — RE-VERIFICATION (supersedes the FAIL above)

**Date:** 2026-08-26
**Verified by:** qa (independent re-run)

## Type Check / Build

Clean, zero errors. The concurrent-pipeline error noted in the prior FAIL pass is no longer present at this HEAD.

## Unit Tests

Targeted: `page.test.tsx` → **7/7 passed** (was 5/5 at the prior FAIL). Full suite: **2272 passed / 323 skipped / 0 failed.**

## Gap Closure — Read Directly, Not Inferred

Read `page.test.tsx` in full. The named gap is closed: `page.test.tsx:155` asserts `isFlagEnabled` called with `"org_portal.motion"` in the OFF case, `:156-158` asserts the greeting band's class list lacks `animate-in`/`fade-in-0` in that case, and a new case at `:161-181` asserts both the call and the rendered `animate-in fade-in-0` classes in the ON case. Both halves of the prior gap (flag-key check, rendered-output check) are closed, symmetric on/off.

`git diff` confirms this loop-back is test-only (37 insertions/1 deletion, entirely in `page.test.tsx`) — no production file in this pipeline's list (`button.tsx`, `greeting.tsx`, `tile-grid.tsx`, `portal-nav-links.tsx`, `portal-footer.tsx`, `scripts/seed.ts`) changed since the prior FAIL pass.

## Everything Carried Forward From the Prior Pass, Re-Confirmed

No literal color/arbitrary Tailwind value; no new dependency; `tile` variant correctly in `buttonVariants()`; motion gating live-verified (normal vs. `prefers-reduced-motion` contexts); brand cascade confirmed live per-org. Tile zero-vertical-padding finding unchanged, still non-blocking.

## Verdict

**PASS.**

Non-blocking follow-up carried forward: the tile's `0px` vertical padding (`has-[>svg]:px-4` firing on the trailing chevron via Radix `Slot` composition) — real, visually confirmable, not a functional regression. Recommend a `docs/TODO.md` line at Phase 6, not a gate.

**Handoff: analyst (Phase 6).**

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A correctly-built, brand-cascade-honest, legibility-safe visual pass that delivers on "bolder color" and gives an honest, disclosed-not-hidden pass on "more motion/depth" and "a different type scale" — real but narrow — plus one real cosmetic CSS quirk and some ship-time housekeeping that isn't done yet.

## What's Working

- **The color story is exactly right, verified independently.** The greeting band and tile grid render `bg-primary`/`text-primary-foreground`, confirmed at source level and live-browser (`fpcw`'s computed background was the org's real teal, not the platform default). No arbitrary/hex color anywhere in this diff.
- **The `tile` `Button` variant is the right call, not a workaround** — goes through the primitive, documented as divergence #4 in `button.tsx`'s own header.
- **The legibility constraint is honored and improved, not just left alone.** Both `TYPE_SCALE` corrections move body-paragraph text from `dense`/14px to `body`/16px — a genuine legibility improvement, confirmed live. No information-density surface was touched.
- **The motion piece is disciplined** — one CSS-only mount fade-in, flagged, verified both ways live (normal vs. `prefers-reduced-motion`).
- **360px was actually exercised**, not inferred — greeting band, tiles, and nav active-border all checked live at both widths.

## Intent-vs-Shipped Diff

- Phase 1: "bolder colors/shadows... more motion/depth, a different type scale... super easy to use and not overwhelming." Shipped: bold color delivered solidly; motion and type-scale addressed narrowly and deliberately (one flagged micro-fade, two dense→body corrections, no heading-scale change). **Acceptable drift, disclosed throughout Phases 1-3, not a surprise here** — but worth saying plainly: this is Increment 1 of "modern and new," not the full realization. A member will see bolder color clearly; "more motion" and "a different type scale" are addressed at a genuinely conservative level, the right tradeoff for this audience but not the end of the ask.
- Phase 2/3: color must route through the brand cascade, never hardcoded. Shipped: confirmed independently, twice over. **Matches.**
- Phase 3: boldness on chrome/CTAs only, never body text/density. Shipped: exactly that. **Matches.**

## Correction to the what's-new premise

The color/type-scale changes carry no *new* flag of their own, but every component this pipeline touches is nested inside a pre-existing, already-seeded-off flag (`org_portal.home_v2`, `chrome_v2`, `chrome_v3`) — so none of this reaches a real member until an operator flips one of those, same gate every other in-flight portal increment is already waiting behind.

## Tile zero-vertical-padding — independently traced, not deferred to QA's framing

`size="lg"` is `h-10 rounded-md px-6 has-[>svg]:px-4` — it carries **no vertical padding utility at all**, even before the `has-[>svg]` override fires; the tile call site's `h-auto` removes the fixed-height floor that would otherwise supply visual height. Real, and slightly worse than "just the has-[>svg] interaction" — `lg` was never designed to carry standalone vertical padding since every other consumer is a single-line label. **Non-blocking** (no contrast/tap-target/brand violation, `min-h-11` preserved) but not "no action" — needs a `docs/TODO.md` line.

## Edge Cases

- Empty state / failure microcopy / permission gate / audit event: not applicable — presentation-only, no new failure path, no permission surface, no mutation.
- Mobile (360px): **pass**, well-evidenced — greeting band, tile grid, and nav accent each explicitly checked live at 360px.

## Follow-Ups (SHIP WITH NOTES)

1. **Tile zero-vertical-padding** — add explicit vertical padding (e.g. `py-4`) to the `tile` `Button` variant. `docs/TODO.md` line needed now.
2. **What's-new: do not publish now.** All visible surfaces sit behind pre-existing off flags (`home_v2`/`chrome_v2`/`chrome_v3`) — publish when one of those is first flipped on for a real congregation, folding `org_portal.motion` into that same entry rather than its own.
3. **A second, more ambitious visual increment is a real option, not implied closed off.** If the operator wants a bigger step change on motion/type-scale, that's a fresh Phase 1 — this pipeline's narrowing shouldn't read as the final word on "modern and new."

## Ship-time housekeeping still needed

- `docs/TODO.md`: Done line (this pipeline has no line yet) + the tile-padding follow-up line.
- `docs/product/functionality-map.md`: below Rule 14's threshold (presentation refinement on an already-documented surface, not a new capability/permission/data-flow) — optional small addendum noting `org_portal.motion` exists, not required.
- `docs/architecture.md`: correctly untouched (Rule 15 doesn't apply).
- Feedback row / what's-new: n/a / deferred, per above.

**Handoff:** pipeline closes here. Orchestrator to complete the housekeeping above in the landing commit.
