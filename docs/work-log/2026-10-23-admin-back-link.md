# Admin sidebar back link leaves to the public site — Work Log

> **Slug:** `2026-10-23-admin-back-link`
> **Surface:** (admin) — `/admin` layout
> **Permission(s):** existing, unchanged
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Source:** operator, production, 2026-10-23: going from presbyportal.org → Continue → Admin, the sidebar's back link returns to presbyportal.org when it should go to the signed-in dashboard, `/home`.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator | Complete (brief: bug confirmed) | — | 2026-10-23 |
| 2 — Architectural review | — | Skipped: one href, no invariant touched | — | 2026-10-23 |
| 3 — Technical design | — | Skipped: trivial fix; root cause below | — | 2026-10-23 |
| 4 — Implementation | orchestrator | Complete | — | 2026-10-23 |
| 5 — Verification | orchestrator | Regression test fails before, passes after | — | 2026-10-23 |
| 6 — Shipped vs intent | operator | Pending (operator confirms in production) | — | — |

## Root cause

`src/app/(admin)/admin/layout.tsx` hard-coded the sidebar's "← PresbyPortal" link to `/`, the public front page. That predates `/home` becoming the landing target (DECISION-124/125, CLAUDE.md → Post-Login Landing). `/home` is where a signed-in person chooses between their organizations and the admin and developer areas, so it is the right way back.

## Fix

The link's `href` is now `/home`. The label is unchanged.

## Regression test

`src/app/(admin)/admin/layout.test.tsx` renders the layout with a signed-in session and asserts the back link's `href`. It failed with the old `/` link (watched) and passes with `/home`.
