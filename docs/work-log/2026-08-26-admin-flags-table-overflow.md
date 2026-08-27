# Platform Feature Flags table pushed its Toggle column off-screen — Work Log

> **Slug:** `2026-08-26-admin-flags-table-overflow`
> **Surface:** (admin) — `/admin/flags`
> **Permission(s):** none — presentation only
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator (live investigation) | Complete | Bug confirmed | 2026-08-26 |
| 2 — Architectural review | — | Skipped | No invariant touched — layout-only CSS fix | 2026-08-26 |
| 3 — Technical design | — | Skipped | Root cause + fix are both one-line-scale | 2026-08-26 |
| 4 — Implementation | orchestrator | Complete | — | 2026-08-26 |
| 5 — Verification | orchestrator (live) | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | orchestrator | Complete | Confirmed live via Playwright measurement + screenshot | 2026-08-26 |

---

## Bug Report

Operator: "the feature flags won't turn on. they aren't clickable." Follow-up: "i click and it selects the button text." "it worked earlier today."

## Root Cause

`/admin/flags`'s Description `<TableCell>` had no `whitespace-normal` override, so it inherited the shared `TableCell` primitive's default `whitespace-nowrap` — every flag's (often multi-sentence) description rendered on one unbroken line. The table's own `overflow-x-auto` wrapper only takes effect if something constrains its parent's width; the admin layout's `<main className="p-8">` sets none, so instead of scrolling *inside* the table, the entire page grew horizontally to fit the widest row.

This was invisible earlier today because the flag catalog was short (a handful of short-description platform flags). Today's session added 20+ new `org_portal.*` flags, each with a long, deliberately-detailed description (documenting exactly what each flag gates) — pushing the table's rendered width to ~1700px, far past a normal browser window. The `Key`/`Status`/`Toggle` columns still rendered correctly at their normal position, but reaching the `Toggle` button required scrolling the whole page horizontally, which isn't an obvious or discoverable gesture. Clicking where "Toggle" used to be (before the table grew) instead landed on the Description column's own now-much-longer text, which is ordinary selectable prose — producing the reported "it selects the button text" symptom exactly.

Confirmed by measurement: at a 1280px viewport, the table container's `scrollWidth` was 1706px before the fix (`scrollWidth === clientWidth`, i.e. the container never actually contained its own overflow — the whole `<body>` scrolled instead, which CLAUDE.md's own UI standards name as the anti-pattern to avoid: "the page body must never scroll horizontally").

## Fix

`src/app/(admin)/admin/flags/page.tsx`: gave the Description cell `whitespace-normal max-w-md min-w-64` (wraps onto multiple lines within a bounded column width) and pinned the Key cell's `whitespace-nowrap` explicitly (it's a short `key` string, meant to stay on one line). Table container `scrollWidth` now measures 996px at a 1280px viewport — well within the visible page, no scroll needed at all, `Toggle` always reachable without any horizontal gesture.

## Verification

- `npm run typecheck`: PASS
- Live: Playwright measurement before/after (`scrollWidth`/`clientWidth` on the table container, and `document.body.scrollWidth`) confirms the page no longer needs horizontal scroll; screenshot confirms every row's `Toggle` button is visible without scrolling at a normal 1280px viewport.
- No automated regression test added — this is a real-layout-engine bug (`scrollWidth` overflow), which jsdom's layout stub cannot meaningfully reproduce; the live Playwright measurement above is the verification of record, same as several other CSS-layout fixes this session.

## Phase 6 — Shipped vs Intent

Matches: the operator's exact reported symptom ("click selects the button text") is explained precisely by the root cause (clicking where the button used to be, now landing on much-longer overflowing description text) and resolved by the fix (description now wraps, table fits the viewport, button always reachable without scrolling).

---

## Second bug, same live-testing session: "Administration" highlighted alongside whatever tile the viewer was actually on

Unrelated root cause, found and fixed in the same investigation burst — recorded here rather than a second work-log since both are small, same-day, live-testing-discovered fixes.

**Bug Report:** Operator: "i click groups in the menu it also highlight administration."

**Root Cause:** `PortalNavLinks`' active-state check (`src/app/(org)/o/[slug]/portal-nav-links.tsx`) let every entry decide independently whether it was "active" via `pathname === href || pathname.startsWith(href + "/")`. "Administration" (`/o/<slug>/admin`) is a literal string-prefix of every "operate"-category tile that happens to route through `/admin/*` — Groups (`/o/<slug>/admin/groups`), and latently Members/Officers too — even though none of those are Organization Administration hub destinations. On `/o/<slug>/admin/groups`, both "Groups" (exact match) and "Administration" (prefix match) satisfied the check, so both lit up.

**Fix:** resolve active-state to the single most-specific (longest-href) matching entry across the whole nav, not "every entry whose href happens to be a pathname prefix" — the same resolution algorithm most routers use for nested/overlapping routes. No per-tile special-casing needed in `tiles.ts` or the nav itself.

**Verification:** two new regression tests in `portal-nav-links.test.tsx` (Groups active + Administration not, on `/admin/groups`; Administration active + Groups not, on `/admin`'s own index) — both pass, along with the existing 7. Confirmed live via Playwright against a real dev server: `aria-current="page"` correctly appears on exactly one nav link at a time.
