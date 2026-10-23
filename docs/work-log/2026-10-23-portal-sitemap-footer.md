# Portal menu and site-map footer from one structure — Work Log

> **Slug:** `2026-10-23-portal-sitemap-footer`
> **Surface:** (org) — the portal nav (`portal-nav.tsx`) and footer (`src/components/org-portal/portal-footer.tsx`)
> **Permission(s):** existing; tiles keep their own gates
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small; Phase 2 may be skipped with notation if no structural change)
> **Source:** operator, 2026-10-23: "the portal footer doesn't match the menu. on the menu i think we should have Community instead of people and membership as the menu title. i like the site map footers most website have with menu and submenu laid out in columns. maybe we can do something like that. also wondering if where the setup of features is per organization? feels like the menu should be driven off some data structure. right now it probably isn't simply because i see different titles."
> **What exists (orchestrator):** `src/lib/org-portal/tiles.ts` is the data structure. Each tile has a label, href, permission gate, `category` (operate | administer) and `domain`. `DOMAIN_LABELS` names the domains ("People & Membership", …), and `visiblePortalTiles()` filters tiles by the org's per-organization feature toggles and by the viewer's permissions. The nav shows domain labels computed from operate tiles. The footer shows operate tiles flat, by tile label, so the two read the same structure differently. Administer tiles never reach the footer. Features are per organization (`org_features` toggles on the portal's Features page).
> **Requested change:** rename the `people` domain label to "Community"; make the footer a site map with one column per domain, the visible tiles listed under each, and an Administration column for viewers with administer tiles; nav and footer both derive from the same structure.
> **Pre-assigned numbers (Rule 16):** DECISION-220–222 · F220–F224 · no migration expected · worktree `presby-nav` · Neon branch: none needed unless Phase 3 says so (shares `pipeline-person-emails` read-only for tests)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | In progress | — | — |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
