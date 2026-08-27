# Control legibility: 16px controls, semibold buttons, home search-bar parity — Work Log

> **Slug:** `2026-08-27-control-legibility`
> **Surface:** app-wide (Button/Input/Textarea primitives, native-select class strings, home find-a-person)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish class — Phases 2 & 3 skipped (CSS/class-string only, no deps/schema/API; direction chosen by the operator from three live-page mockups). Phase 1 satisfied in-conversation.
> **Source:** live operator feedback, 2026-08-27 — (1) "i wonder if the font needs to be bigger or bolder on the buttons for older people?" — operator reviewed three mockups and chose 16px controls + semibold (600) buttons; (2) "buttons and input text boxes are rendered differently still" — measured root cause: the home find-a-person is a raw <input> missing the Input primitive's shadow-xs (the one remaining computed-style delta between home and members/directory search rows; everything else — font, height, radius, border, background — now identical).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done (in-conversation) | READY FOR DESIGN | 2026-08-27 |
| 2 — Architectural review | architect | Skipped | Skipped — CSS/class-string only, no deps/schema/API change (Polish class) | 2026-08-27 |
| 3 — Technical design | tech-lead | Skipped | Skipped — direction chosen by operator from three live mockups, no design doc needed | 2026-08-27 |
| 4 — Implementation | ux-developer | Done | Complete | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

[READY FOR DESIGN | READY WITH NOTES | NEEDS REWORK | NOT YET]

## ONE-LINE TAKE

> [The feature in one honest sentence.]

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| [admin / member / anonymous] | [verb] | [on demand / per session / one-time] |

## Flows

**Flow 1 — [name]:** [entry → step → step → outcome]
- Failure: [what the user sees if a step goes wrong]

**Flow 2 — [name]:** [...]

## Permissions & Flags

- **Permission(s):** [new `FEATURES.KEY`, or existing key reused]
- **Default roles:** [list]
- **Flag(s):** [new key + rollout plan, or "not needed"]

## Gaps the Request Didn't Address

- [Gap, why it matters, suggested resolution]

## Out of Scope (confirm with user)

- [Thing the request implies but isn't in scope]

## Open Questions

- [Question for the user]

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation

**Implementer:** ux-developer
**Date:** 2026-08-27

## Files Created

- `src/components/ui/input.test.tsx` — pins `<Input>` at `text-base` with no `md:text-sm` downshift (no prior test file existed for this primitive)
- `src/components/ui/textarea.test.tsx` — same, for `<Textarea>`

## Files Modified

### A1 — Button primitive (16px, semibold)

- `src/components/ui/button.tsx` — base cva string: `text-sm` → `text-base`, `font-medium` → `font-semibold`. Extended the divergence header with item #7 documenting the change and the finding that none of the `sm`/`lg`/`icon` size variants declare their own text-size utility, so all three inherit the new 16px/600 unchanged — no proportional-bump decision was needed.
- `src/components/ui/button.test.tsx` — extended header comment; added a `describe` block asserting every variant (`default`/`destructive`/`outline`/`secondary`/`ghost`/`link`/`tile`) carries `text-base`+`font-semibold` and never `text-sm`/`font-medium`, plus a size-variant loop (`default`/`sm`/`lg`/`icon`) confirming none override the base text size.

### A2 — Input / Textarea primitives (16px everywhere, drop the `md:` downshift)

- `src/components/ui/input.tsx` — removed `md:text-sm` from the base class string (was `text-base ... md:text-sm`, i.e. 16px mobile / 14px desktop). Extended divergence header with item #3.
- `src/components/ui/textarea.tsx` — same removal, extended header.
- `src/components/ui/input.test.tsx`, `src/components/ui/textarea.test.tsx` — new, see above.

### A3/A4 — Native `<select>` and raw `<input>` recipe sweep (`text-sm` → `text-base`, select/input controls only)

Every file below had exactly one `text-sm` on the line matched, verified by count before editing so no unrelated `text-sm` (labels, hints, table cells) was touched:

**`SELECT_CLASSES`-style constants (18 files):**
- `src/app/(org)/o/[slug]/tickets/file-ticket-form.tsx`
- `src/app/(org)/o/[slug]/admin/officers/add-officer-term-form.tsx`
- `src/app/(org)/o/[slug]/admin/officers/end-term-dialog.tsx`
- `src/app/(org)/o/[slug]/admin/roles/grant-role-form.tsx`
- `src/app/(org)/o/[slug]/admin/roles/new/create-role-form.tsx`
- `src/app/(org)/o/[slug]/admin/groups/new-group-form.tsx`
- `src/app/(org)/o/[slug]/admin/groups/add-group-member-form.tsx`
- `src/app/(org)/o/[slug]/admin/members/new/household-step.tsx`
- `src/app/(org)/o/[slug]/admin/members/new/roll-action-step.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/record-roll-action-form.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/edit-person-form.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/guardians/guardian-link-form.tsx`
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/sensitive-info-form.tsx`
- `src/app/(org)/o/[slug]/admin/events/extend-series-form.tsx`
- `src/app/(org)/o/[slug]/admin/events/new-event-form.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/record-ordination-form.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/record-appointment-form.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/change-status-dialog.tsx`

**Inline (non-const) select recipes (14 files, one had two occurrences):**
- `src/app/(org)/o/[slug]/admin/members/members-list.tsx`
- `src/app/(org)/o/[slug]/directory/directory-grid.tsx`
- `src/app/(org)/o/[slug]/admin/branding/branding-form.tsx`
- `src/components/shared/feedback-form.tsx`
- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` (2 occurrences)
- `src/app/(admin)/admin/organizations/[id]/brand-form.tsx`
- `src/app/(admin)/admin/organizations/[id]/service-times-section.tsx`
- `src/app/(admin)/admin/tickets/area-control.tsx`
- `src/app/(admin)/admin/tickets/classify-control.tsx`
- `src/app/(admin)/admin/tickets/assign-control.tsx`
- `src/app/(admin)/admin/tickets/status-control.tsx`
- `src/app/(admin)/admin/tickets/page.tsx` (3 occurrences)
- `src/app/(admin)/admin/tickets/priority-control.tsx`
- `src/app/(admin)/admin/audit/page.tsx`

**Found but deliberately NOT changed (out of instruction scope):** `src/app/(admin)/admin/feedback/feedback-status-control.tsx` and the users table select in `src/app/(admin)/admin/users/page.tsx` carry `text-xs`, not `text-sm` — the instruction was to change `text-sm` select recipes only; bumping a `text-xs` dense-table control to `text-base` is a size decision beyond what was scoped here and is left for a follow-up if the operator wants it.

- `docs/ui-standards.md` — three examples updated `text-sm` → `text-base` with a one-line note each: the raw-`<input>` recipe in "Colour and Tokens" (~line 103), the form-pattern example's `<input>` (~line 356), and the native-`<select>` recipe (~line 464/`Select & Combobox Patterns`).

### B — Home search-bar parity

- `src/components/org-portal/find-person-form.tsx` — replaced the raw `<input>` with the `<Input>` primitive (`className="mt-1 min-h-11"`), preserving `id`/`type="search"`/`value`/`onChange`/`placeholder`/`disabled` and the existing `<Label htmlFor>` wiring. Removes the duplicated focus-ring/disabled/border/background class string in favor of the primitive.
- `src/components/org-portal/find-person-form.test.tsx` — extended header; added a regression test asserting the query field carries `shadow-xs` and `min-h-11` (the primitive's box-shadow, proving it's no longer a hand-rolled `<input>`), suffixed as a regression test for the home/members parity delta.

## Schema Changes

None.

## Audit Events

None — no security-sensitive mutation touched.

## Implementer Notes

- Scope discipline: `src/lib/org-portal/tiles.ts`, `src/components/shared/button-group.tsx`, `src/app/globals.css`, `src/lib/brand/*`, and the new `admin/{committees,communications,giving,insights,oversight,reports,worship}/` placeholders were left untouched — those are a concurrent pipeline's in-flight work (confirmed via `git status` before starting and again via a scoped `git stash`/typecheck/`stash pop` round-trip). A pre-existing typecheck failure in `src/components/org-portal/{portal-footer,tile-grid}.test.tsx` (missing `domain` property on `PortalTile` fixtures) belongs to that other pipeline; typecheck is clean when those files are set aside, confirming this feature introduces zero new type errors.
- No proportional bump was needed on the button `size` variants (`sm`/`lg`/`icon`) — none declared their own `text-*` utility, so all three simply inherit `base`'s new `text-base`/`font-semibold`.
- Left the button-group segmented-control override untouched (owned by the concurrent button-modernization pipeline); it doesn't set its own text size so it also inherits the new base typography automatically.
- Copy: no new user-facing strings were introduced. The `docs/ui-standards.md` notes are documentation-only, not shipped copy.

### Verification

**Typecheck:** `npm run typecheck` — clean for all files this pipeline touched. (One pre-existing failure from a concurrent pipeline's `PortalTile.domain` addition is unrelated — confirmed by stashing that pipeline's files and re-running: 0 errors.)

**Unit tests:** `npm test` — 219 files / 2857 tests passed, 22 files / 518 skipped (pre-existing skips), 0 failed.

**`npm run check`:** all four tripwires pass (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`).

**Browser verification (Playwright against the running dev server, `storageState: /tmp/state.json`):**

| Surface | Viewport | Element | font-size | font-weight | box-shadow |
|---|---|---|---|---|---|
| `/o/fpcw` (home) | 1280px | search `<Input>` | 16px | 400 | `0 1px 2px rgba(0,0,0,.05)` (shadow-xs) |
| `/o/fpcw` (home) | 1280px | Search `<Button>` | 16px | 600 | — |
| `/o/fpcw/admin/members` | 1280px | search `<Input>` | 16px | 400 | `0 1px 2px rgba(0,0,0,.05)` (shadow-xs) — **identical to home**, closing the measured delta |
| `/o/fpcw/admin/members` | 1280px | Status `<select>` | 16px | 400 | — |
| `/o/fpcw/admin/members` | 1280px | Search `<Button>` | 16px | 600 | — |
| `/account` (platform page) | 1280px | form `<Button>`s (Save name / Request email change / Change password / Send feedback / Delete account) | 16px | 600 | — |
| `/account` (platform page) | 1280px | text `<Input>`s | 16px | 400 | — |

360px spot-check (`/o/fpcw` and `/o/fpcw/admin/members`): `document.documentElement.scrollWidth > clientWidth` is `false` on both — the larger control text does not cause horizontal overflow, and the search rows/nav render without wrapping or clipping (screenshots below).

**Screenshots** (scratchpad):
- `legibility-home.png` — home search row + tool tiles, 1280px
- `legibility-members.png` — members search row (input + status select + Search button), 1280px
- `legibility-home-360.png`, `legibility-members-360.png` — 360px spot-check, no overflow
- `legibility-account.png` — platform `/account` page sanity check, 1280px

## New copy strings for a fork's branding pass

None. This is a class-string/typography change only; no user-visible copy changed.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27 · Verification-only, no git-state mutation; concurrent-pipeline churn attributed only after independent diff confirmation.

## Runs

- `npm run typecheck`: PASS, 0 errors (no `PortalTile.domain` failure present — the concurrent pipeline's transient issue resolved).
- `npm test`: 220 files / 2866 passed, 518 skipped (pre-existing baseline), 0 failed. This pipeline's suites standalone: 4 files / 13 tests, 0 failed.
- `npm run check`: 4/4 tripwires.

## Diff Verification

- Primitives exactly as described (button base text-base/font-semibold, no size variant declares its own text utility; input/textarea md:text-sm removed).
- find-person-form: raw input → `<Input className="mt-1 min-h-11">`, all attributes preserved; old className provably lacked shadow-xs.
- Sweep: 6 random diffs read (zero collateral) + per-file diff-line counts match claimed occurrences exactly + **independent completeness grep: zero `appearance-none`+`text-sm` pairings remain in src/**. The two excluded files confirmed text-xs.
- One out-of-scope observation: `children-roster-list.tsx:79` — a Link styled as an outline control still text-sm; not in this sweep's target set, named as possible follow-up.

## Doc Consistency

TYPE_SCALE's `dense` role keeps form labels at text-sm — confirmed labels untouched (spot-checks). The three updated ui-standards examples carry the decision note and are internally consistent.

## Live Browser (computed styles)

Home + members search inputs: 16px/400 with **byte-identical box-shadow strings** (the parity fix confirmed programmatically). Search buttons both pages + /account: 16px/600. Members select: 16px/400. 360px: scrollWidth === clientWidth on both org pages, clean rows. `min-h-11` computes 44px at the new size; focus indicator present and now identical between home and members (same primitive).

## Regression Tests

button.test.tsx legibility describe (every variant+size text-base/font-semibold, never text-sm/font-medium); new input/textarea tests (text-base present, md:text-sm absent); find-person-form parity regression (shadow-xs pinned — fail-before inferred from the diff, not witnessed; the old className verifiably lacked the substring).

## Feature-Gate Audit

No protected routes touched — every change a single-line class-string edit, confirmed by diff-line counts.

## Verdict

**PASS**

**Handoff:** analyst (Phase 6).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The primitive sweep does exactly what the operator asked — bigger, bolder buttons and byte-identical search rows between home and members/directory — but two loose ends (a missed link-styled control, and four raw-button doc snippets now contradicting the updated recipes in the same file) should be tracked, not silently absorbed.

## Live verification (analyst's own)

- Ask 1 (bigger/bolder): verified live on /account and /o/fpcw/admin/members — visibly semibold, 16px/600 across variants/sizes/surfaces.
- Ask 2 (parity — the operator's actual test "i still see no difference"): home vs members search rows visually identical at 1280 and 360px; QA's byte-identical box-shadow confirms the root-caused delta closed, not approximated.
- Mobile: clean stacking, no overflow. Concurrent IA domain-section drift visible on home, expected, not this pipeline's doing.
- TYPE_SCALE check: 14px labels above 16px fields read as a standard, coherent hierarchy — no follow-up needed.

## Residuals ruled

1. Fail-before-inferred (parity regression test): acceptable for Polish class; process note that a root-caused visual defect inside a Polish batch is better served by witnessed red→green next time. No TODO line.
2. `children-roster-list.tsx:79` — a Link styled as a bordered control, now a visibly smaller/lighter outlier beside 16px/600 buttons. **TODO-worthy**: bump to text-base font-semibold or convert to the Button primitive via asChild.

## Housekeeping

- Release notes: Enhancement entry at next cut (app-wide control type change).
- ui-standards.md: the three updated recipes verified — but **four raw `<button>` snippets (Action Bar ~181, Four-State ~555, Empty States ×2 ~587) still teach text-sm font-medium**, contradicting the new default three sections away. TODO: update to text-base font-semibold or replace with Button-primitive usage.
- Rule 12 n/a (live conversation). Rule 13 defer (no real congregations). Functionality map: no stale sizing claims.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

**Pipeline closed.** Follow-ups landed in docs/TODO.md at close (Rule 10); release-notes entry at next cut.
