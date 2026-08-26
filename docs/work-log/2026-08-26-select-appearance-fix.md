# Status filter `<select>` read grey next to a white `<Input>` — Work Log

> **Slug:** `2026-08-26-select-appearance-fix`
> **Surface:** (org) — `/o/<slug>/directory`, `/o/<slug>/admin/members`
> **Permission(s):** none — presentation only
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator (live investigation) | Complete | Bug confirmed | 2026-08-26 |
| 2 — Architectural review | — | Skipped | No invariant touched — presentation-only CSS fix on an already-existing native `<select>` | 2026-08-26 |
| 3 — Technical design | — | Skipped | Root cause + fix are both one-line-scale; documented inline below | 2026-08-26 |
| 4 — Implementation | orchestrator | Complete | — | 2026-08-26 |
| 5 — Verification | orchestrator (live) | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | orchestrator | Complete | Confirmed live via Playwright screenshot + computed-style check | 2026-08-26 |

---

## Bug Report

Operator: "still have inconsistent input boxes across portal screens" → "dashboard has white and members and directory have gray."

## Root Cause

`directory-grid.tsx`'s and `members-list.tsx`'s status filters are native `<select>`s styled with the same `border-input bg-background px-3 py-2 text-sm` classes as the `<Input>` beside them (per `docs/ui-standards.md`'s existing Select & Combobox Patterns convention). Confirmed via Playwright `getComputedStyle` that all three controls (dashboard's find-a-person input, the directory search input, the status select) compute to the **exact same** `background-color: rgb(249, 255, 254)`. The visible difference is not the CSS background — it's that a native `<select>` without `appearance-none` still gets the browser/OS's own control chrome painted over top of that background, which on Chromium/macOS renders as a visibly heavier, greyer box than a plain bordered `<input>` right next to it in the same row. The dashboard has no `<select>` at all to compare against, which is why it read as uniformly "white."

## Fix

Added `appearance-none` plus a manually-positioned `lucide-react` `ChevronDown` (the native arrow disappears once `appearance-none` is set) to both status-filter selects. Corrected `docs/ui-standards.md`'s Select & Combobox Patterns recipe so future native selects don't reintroduce the same gap. The rest of the app's native selects (tickets, roles, officers forms, `(admin)` pages, `shared/feedback-form.tsx`) share the same underlying gap and were **not** retrofitted here — logged as a follow-up in `docs/TODO.md` rather than expanded into an unbounded sweep.

## Regression Test

`directory-grid.test.tsx`'s existing "renders Mail/Phone/MapPin icons inline before each present contact field" test scoped its `document.querySelectorAll("svg")` count check to the rendered `PersonCard`, since the page-level svg count now also includes the status filter's new chevron indicator. No dedicated new test was added for the `appearance-none` class itself — this is a CSS-rendering fix with no behavioral branch to assert on beyond what a visual/computed-style check (done live) already confirmed.

## Verification

- `npm run typecheck`: PASS
- `npm test`: 2272 passed, 0 failed (full suite)
- `npm run check` (all four tripwires): PASS
- Live: Playwright screenshot of `/o/fpcw/directory` before and after, confirming the select now visually matches the search input.

## Phase 6 — Shipped vs Intent

Matches: the operator's two follow-up reports ("dashboard has white and members and directory have gray") are both explained by the same root cause and both fixed by the same change, verified on both affected pages.

## Follow-up increment 2026-08-26 (same day) — retrofit the rest of the app

Operator reported the inconsistency was still visible elsewhere and asked for the deferred `docs/TODO.md` retrofit line to be done now, calling it a quick win. Extending this same work-log rather than opening a new one — same root cause, same fix, just the remaining call sites. Files retrofitted (every native `<select>` in the tree that lacked `appearance-none`, per a full-tree grep):

- `(org)`: `tickets/file-ticket-form.tsx`, `admin/branding/branding-form.tsx`, `admin/officers/add-officer-term-form.tsx`, `admin/officers/end-term-dialog.tsx`, `admin/roles/grant-role-form.tsx`, `admin/members/new/household-step.tsx`, `admin/members/new/roll-action-step.tsx`, `admin/members/[id]/edit/edit-person-form.tsx`
- `(admin)`: `organizations/new/create-organization-form.tsx`, `organizations/[id]/service-times-section.tsx`, `organizations/[id]/brand-form.tsx`, `admin/tickets/{area,status,classify,priority,assign}-control.tsx`, `admin/tickets/page.tsx`, `admin/feedback/feedback-status-control.tsx`, `admin/audit/page.tsx`, `admin/users/page.tsx`
- `shared/feedback-form.tsx`

Same fix as the original increment: `appearance-none` + a `pr-8` and a `pointer-events-none` absolutely-positioned `ChevronDown` in a `relative` wrapper. `docs/TODO.md`'s retrofit line closes with this increment.
