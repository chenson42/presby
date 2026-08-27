# Input/Textarea primitives aligned to the bg-background standard — Work Log

> **Slug:** `2026-08-27-input-background-standard`
> **Surface:** app-wide (generated ui primitives + their call sites)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish class — Phases 2 & 3 skipped (CSS-only, no new deps, no schema, no API surface; the design IS docs/ui-standards.md's existing bg-background standard)
> **Source:** live operator report, 2026-08-27 — white input box on the portal home vs gray in other places. Root cause: generated shadcn Input/Textarea primitives kept upstream's bg-transparent default, so bare usages paint whatever surface they sit on (white inside bg-card panels) while hand-written controls and per-use overrides follow the documented bg-background standard.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped (brief, see below) | READY FOR DESIGN | 2026-08-27 |
| 2 — Architectural review | architect | Skipped — no new deps, no structural change, CSS-only | n/a | 2026-08-27 |
| 3 — Technical design | tech-lead | Skipped — design IS the existing docs/ui-standards.md standard | n/a | 2026-08-27 |
| 4 — Implementation | ux-developer | Complete | Done | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

**Skipped — brief, per Polish-class bug-fix variant.** Root-cause confirmed
during implementation: `src/components/ui/input.tsx` and
`src/components/ui/textarea.tsx` kept upstream shadcn's `bg-transparent` in
the light-mode base class string. A transparent control paints whatever
surface sits behind it — pure white inside a `bg-card` panel (edit-person,
new-event, credentials forms), tinted `--background` on a page-level form —
while every hand-written native `<select>` in the app already carries
`border-input bg-background` per docs/ui-standards.md, and two call sites
(members-list.tsx, directory-grid.tsx) had already patched the same gap
per-use. The fix is documented-standard-compliance, not new behavior: no
permission or flag surface, no schema, no API. Confirmed via computed-style
inspection in the browser (see Phase 4) that inputs/selects/textareas now
share one background value app-wide, matching intent.

## VERDICT

READY FOR DESIGN

---

# Phase 2 — Architectural Review (architect)

**Skipped — no new deps, no structural change, no invariant touched. CSS
class value in two already-existing generated files, plus removal of
redundant per-use overrides.** Notation only, per Polish-class rule.

---

# Phase 3 — Technical Design (tech-lead)

**Skipped — the design is docs/ui-standards.md's existing, already-documented
control standard (`border-input bg-background`, "border vs border-input"
section and native-select recipe).** No new design decision required; this
work-log's Phase 4 section documents the mechanical change and the sweep.

---

# Phase 4 — Implementation (ux-developer)

**Date:** 2026-08-27

## Files Created

- none

## Files Modified

- `src/components/ui/input.tsx` — light-mode base class changed
  `bg-transparent` → `bg-background` (line with `h-9 w-full min-w-0 rounded-md
  border border-input ...`); `dark:bg-input/30` untouched. Extended the
  existing GENERATED-FILE divergence header (previously recorded only the D4
  focus-ring-offset divergence) with a second numbered entry recording this
  change, the docs/ui-standards.md rationale, and the date.
- `src/components/ui/textarea.tsx` — same class swap
  (`bg-transparent` → `bg-background`), `dark:bg-input/30` untouched. This
  file had no prior divergence header, so a new one was added recording this
  single divergence.
- `src/app/(org)/o/[slug]/admin/members/members-list.tsx` — line 84: removed
  now-redundant `bg-background` from the search `<Input>`'s className
  (`"mt-1 min-h-11 bg-background"` → `"mt-1 min-h-11"`). The neighboring raw
  `<select>` on line 96 (`bg-background` as part of its explicit border/select
  styling) was left untouched — it is not the primitive being patched here.
- `src/app/(org)/o/[slug]/directory/directory-grid.tsx` — line 98: identical
  removal on the directory search `<Input>`. Line 110's raw `<select>` left
  untouched for the same reason.

## Sweep Method & Result

Grepped `src/` for every file containing `bg-background` (`grep -rl
"bg-background" src --include="*.tsx"`), then for each hit checked whether the
file also renders `<Input`/`<Textarea` and whether `bg-background` sits in an
actual `<Input`/`<Textarea` `className` (as opposed to a `SELECT_CLASSES`
constant applied to a raw `<select>`, or an unrelated decorative `<div>`/file
input pseudo-element). The only two matches were the members-list.tsx and
directory-grid.tsx search inputs listed above. Every other `bg-background`
occurrence near an `Input`/`Textarea` import in the codebase belongs to a
`SELECT_CLASSES`-style constant string used exclusively on a native
`<select>` (e.g. `add-officer-term-form.tsx`, `new-event-form.tsx`,
`sensitive-info-form.tsx`, the `(admin)/admin/tickets/*` controls) — those are
correct as-is and were left alone per the task scope (raw elements, not the
primitive).

## Schema Changes

- none

## Audit Events

- none (CSS-only, zero behavior change)

## Test Results

- `npm run typecheck` — PASS, zero errors.
- `npm test` (Vitest) — 209 files passed, 22 skipped; 2766 tests passed, 518
  skipped, 0 failed. No existing test pinned the `Input`/`Textarea` class
  string (checked `src/components/ui/` for a co-located test file — none
  exists for these two primitives), so no test needed updating. No new test
  was written: this is a pure class-value substitution behind an existing,
  already-tested design-token contract (`src/lib/brand/contract.ts` treats
  `background` as a bounded/platform token independent of the control that
  renders it), and CLAUDE.md's contract test already fails if `--background`
  is unclassified — there is no new invariant for a unit test to encode.
  QA should confirm this reasoning holds rather than treat it as a gap to
  fill with a placeholder test.

## Browser Verification

Playwright against the running dev server (`storageState: /tmp/state.json`,
admin@presby.invalid), viewport 1280×900, fpcw (a branded org):

- **`/o/fpcw/admin/members`** — search `<Input>` and the `Status` `<select>`
  now compute to the identical background color
  (`rgb(249, 255, 254)` — fpcw's brand-scoped `--background`), confirmed both
  visually (screenshot) and via `getComputedStyle` on both elements.
- **`/o/fpcw/admin/members/<id>/edit`** — every text `<Input>` inside the
  `Profile` card panel (first/last/middle/preferred name, suffix, email,
  phone, address, city, state, ZIP) and the `Household`/`Roll action`
  `<select>` elements all compute to the same `rgb(249, 255, 254)`, distinct
  from the pure-white `bg-card` panel behind them (`rgb(255, 255, 255)`). This
  is the exact symptom from the operator report — resolved. Note: the delta
  between card-white and background-tint is subtle to the eye at this org's
  current brand values (it's a near-white teal-tinted brand), so the
  screenshot alone under-communicates the fix; the computed-style comparison
  is the reliable evidence and is what I'd point a reviewer to over the pixel
  screenshot.
- **`/o/fpcw`** and **`/o/fpcw/directory`** — directory search `<Input>` and
  `Status` `<select>` likewise match (`rgb(249, 255, 254)` both). Find-a-person
  flow unaffected — no behavior change, layout unchanged.
- **`/admin/organizations`** (platform palette) — table-only page, no form
  controls to check on this route; used **`/admin/design-system`** instead
  (also platform palette, un-branded), whose "Form fields" section renders an
  `<Input>`, a `<Textarea>`, and a disabled `<Input>` side by side. All three
  render with the platform's neutral `bg-background` tint, consistent with
  the "bounded — background" swatch shown earlier on the same page. No visual
  regression outside `(org)`.
- Screenshots taken at 1280px for members list and the edit-person form;
  reviewed both full-page and via pixel/computed-style sampling. One false
  alarm during verification: an initial screenshot appeared to show the
  first-name input still pure white while the select showed the tint — this
  was a stale pre-hot-reload screenshot (Next dev server), not a real
  regression. A second screenshot plus `getComputedStyle` on the live DOM
  after the reload settled confirmed the match. Documenting this because a
  reviewer glancing only at a screenshot could reach the same false
  conclusion — check computed style, not just pixels, if re-verifying.

## Implementer Notes

- Scope was intentionally narrow: only the two generated primitives' base
  class and the two call sites with a literal `bg-background` override on an
  `<Input>`. Raw `<select>`/`<input>` elements with their own explicit
  `SELECT_CLASSES`-style strings were left untouched — they already conform
  to the standard and aren't the primitive this fix targets, and touching
  them would have expanded a Polish-class fix into a broader refactor with a
  much larger review surface.
- No new copy strings were introduced — this is CSS-only.
- No behavior changes: `dark:bg-input/30` is untouched in both files, so dark
  mode is unaffected by this change.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27

## Diff Verification

`git diff` on the four files matches Phase 4 exactly, nothing smuggled in: input.tsx class swap with the divergence header **extended** (existing D4 entry kept, new dated item added citing docs/ui-standards.md); textarea.tsx identical swap with a **new** header (had none); members-list.tsx:84 and directory-grid.tsx:98 each a one-line `bg-background` removal. `dark:bg-input/30` untouched in both primitives.

## Standard Conformance

docs/ui-standards.md:103's recipe is `border border-input bg-background` — both primitives now match.

## Sweep Completeness (independent re-run)

Two ways: (1) `bg-transparent` remains in src/components/ui/ only in divergence-header prose and in non-input controls (button/dialog/switch variants — correctly out of scope); (2) a structural scan of all 359 `.tsx` files parsing every `<Input`/`<Textarea` tag for `bg-` classes — **zero matches app-wide**. The two removed overrides were the only ones; no conflicting override exists anywhere.

## Type Check / Tests / Tripwires

Isolated from unrelated concurrent working-tree changes (the credentials-tile pipeline, in flight): typecheck **PASS** (0 errors), `npm test` **209 files / 2766 passed, 0 failed** (518 skips all pre-existing DB-backed `skipIf`s, unrelated files), `npm run check` **4/4 PASS**. No test pins the primitive class strings; no regression test owed (pure class-value swap; the `--background` token classification is already covered by contract.ts's own suite).

## Feature-Gate Audit

No protected routes touched — all four files presentational; confirmed by reading the diffs, not inferred.

## Browser Verification (independent Playwright pass)

- `/o/fpcw/admin/members`, `/o/fpcw/admin/members/<id>/edit` (10 Inputs + 2 selects), `/o/fpcw/directory`: every Input/select computes `rgb(249, 255, 254)`, distinct from `bg-card`'s `rgb(255, 255, 255)`. The reported symptom is resolved.
- `/admin/design-system` and `/account` (platform palette): uniform neutral backgrounds, no regression.
- **Dark mode:** Input computes `dark:bg-input/30` while the native select computes `bg-background` — **they do not match in dark mode. Pre-existing, not introduced, not fixed** (only the light-mode fallback changed; dark mode never reaches it). Tracked as a docs/TODO.md follow-up, outside this light-mode-only fix's scope.

## Process note

The shared working tree carried concurrent in-flight edits from the credentials-tile pipeline; qa isolated this feature's diff via a path-scoped `git stash`/restore. A transient stash-pop race with the live implementer was resolved by diffing (tree already matched byte-for-byte; stash dropped, nothing force-applied, nothing lost). Flagged as an orchestration hazard: two pipelines editing an uncommitted shared tree concurrently.

## Verdict

**PASS**

**Handoff:** analyst (Phase 6).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The two generated primitives now carry the documented `bg-background` standard natively instead of via per-use patches, and QA's independent structural sweep (all 359 `.tsx` files, zero `<Input>`/`<Textarea>` background overrides remaining) backs the claim that the operator's white-vs-gray inconsistency is gone everywhere, not just at the two examples cited.

## What's Working

- The root-cause framing holds against the operator's own examples: "portal home" search controls were **already correct** (raw `bg-background` styling); "other places" — form fields inside `bg-card` panels — were the actual white boxes, caused by the primitive's inherited `bg-transparent`. Phase 4's browser verification directly measured the edit-person card: every field now computes `rgb(249, 255, 254)` against the `rgb(255, 255, 255)` card behind it — the literal complaint, resolved and measured.
- QA re-derived the sweep independently (structural parse app-wide, not a grep of the touched files) — zero remaining overrides.
- Divergence headers extended/added on both primitives per convention, so a future `ui:add` regeneration won't silently revert this.
- Scope discipline: raw `<select>`s with their own class strings were correctly left alone.

## Intent-vs-Shipped Diff

- Align primitives to the existing standard, remove redundant per-use overrides, zero behavior change. Shipped: exactly that. **Verdict: matches.**

## Edge Cases

- Empty state / failure microcopy / permission gate / audit event: all not applicable (CSS-only; QA confirmed no protected-route surface by reading the diffs).
- Mobile (360px): not re-verified (both passes ran 1280px) — a background-token swap has no layout dimension, so noted, not a gap.

## Dropped Items Check

- Dark-mode mismatch: confirmed tracked honestly in docs/TODO.md (pre-existing, correctly attributed, cites Phase 5).
- Rule 12: n/a (live operator report, no feedback row). Rule 13: n/a (visual bug fix, not a new member-visible capability).

## Follow-Ups (SHIP WITH NOTES)

1. **docs/ui-standards.md doc gap:** the control recipe (~line 103) shows `border-input bg-background` only against a raw `<input>` and never states the generated primitives now bake it in — the exact reason two call sites had redundantly re-added the class before this fix. One added sentence near the recipe prevents a third recurrence. *(Closed at ship time by the orchestrator — sentence added in the same housekeeping pass; see the doc.)* The line-475 `appearance-none` retrofit note was checked and is NOT stale — it describes a different, still-pending gap.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |
