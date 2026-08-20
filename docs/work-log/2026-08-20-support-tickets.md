# Support Tickets — Work Log

> **Slug:** `2026-08-20-support-tickets`
> **Surface:** mixed — member/tenant-facing (file a ticket), admin-facing (triage/work a ticket), partly AI-worked
> **Permission(s):** TBD by Phase 1
> **Flag(s):** TBD by Phase 1
> **Estimated complexity:** large — new domain, new tables, an AI-eligibility model, both tenant and platform surfaces
> **Pipeline mode:** Full, run with agents

---

## Context carried forward

**Why this pipeline exists, in the project's own words** (`docs/STATE.md`,
`docs/decisions.md` D8, `docs/schema-design.md` §11/§15):

> **No custom fields (D8).** Tags are the only tenant-extensible attribute.
> A new need is a support ticket and, if real, becomes a feature for every
> church. This makes the ticket loop load-bearing, so it cannot be built
> last.

D8 was **reversed after review** specifically because of this consequence —
custom fields are what every surveyed ChMS does, but a per-church field
nobody designed has no validation, no reporting, no enforced sensitivity
tier, and fragments the reusable-component thesis the whole schema depends
on. Choosing tags-only was only survivable by pulling ticketing forward, not
building it last (`docs/schema-design.md` §11's own honest cost: "without a
pressure-relief valve, low-stakes requests land in the ticket queue too...
survivable only if the loop is fast").

**A schema sketch already exists** (`docs/schema-design.md` §15, "Section
L — Tickets (sketch)" — sketched, not decided, because "their shape
constrains Phase 0 decisions," per §1's own framing):

```
tickets         (organization_id, submitter_person_id, category, change_class, status, assignee_kind)
ticket_messages (ticket_id, author_kind, body, created_at)
ticket_actions  (ticket_id, action, audit_event_id, applied_at)
```

**`change_class` is named as the load-bearing column**: `content | config |
theme | bug | feature`. The first three change tenant data and (per the
sketch) an AI worker may ship them continuously with no deploy; the last
two touch shared code and route to the human pipeline. "This must be a
column, not prose, so automation eligibility is a query" — Phase 1 should
treat this as the central design question, not assume it.

**Project overview** (`docs/STATE.md`) describes "a support-ticket loop
worked partly by AI" as one of the platform's core pillars, alongside
church management and council operations — this is not a minor admin
utility, it's named infrastructure.

**Prior art**: none of the four sibling repos (`fpcw-directory`,
`westervillelions`, `psvonline-portal`, `synod-portal`) are named in
CLAUDE.md's prior-art table as owning ticket-related requirements — Phase 1
should check them directly rather than assume nothing is there, but this
is likely closer to greenfield than P1/P9 were.

**Explicitly NOT yet answered by anything on record** — genuinely Phase 1's
job, not pre-decided: who can file a ticket (any tenant member? only a
`stated_clerk`-equivalent? both, with different categories?); what
"assignee_kind" actually resolves to (a human platform operator, an AI
worker, both with a handoff); what the AI worker's actual mechanism is
(does it have write access to tenant data for `content`/`config`/`theme`
tickets, and if so, through what guardrail — this touches the same
isolation invariants P1/P9 spent real effort on); how a ticket's resolution
relates to `docs/TODO.md`'s existing backlog-aggregator role (a `feature`-
class ticket becoming a tracked platform feature is explicitly the D8
consequence — does that mean writing to `docs/TODO.md`, or something else
entirely at runtime, since `docs/TODO.md` is a committed file the running
app has no access to).

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
