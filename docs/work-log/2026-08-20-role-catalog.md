# Role Catalog Expansion — Work Log

> **Slug:** `2026-08-20-role-catalog`
> **Surface:** mixed — tenant role seeding (`scripts/seed-dev.sql`, no new UI expected), platform role seeding (`scripts/seed.ts`)
> **Permission(s):** none new expected — this pipeline is about which EXISTING permissions get a role to carry them, not new permission keys
> **Flag(s):** not needed
> **Estimated complexity:** medium — no new schema/mechanism, but real polity/product judgment across several roles
> **Pipeline mode:** Full, run with agents

---

## Context carried forward

**Why this pipeline exists.** While designing the support-ticket pipeline
(`docs/work-log/2026-08-20-support-tickets.md`), `tickets.file` was
piggybacked onto the existing `stated_clerk` role (DECISION-072) purely
for expediency — it's the only designated tenant office that exists in the
fixture. The user flagged the resulting pattern directly: every new tenant
capability landing on `stated_clerk` risks it becoming a wildcard admin
role one layer down, even though each individual grant was independently
justified. Asked to think about what other roles are actually needed, at
both the platform and organization level, before continuing to default
everything onto one office.

**Two concrete gaps, confirmed by reading the fixture directly, not
inferred**: `docs/db/domain/authz.ts`'s permission catalog has carried
`ledger.approve` (module `ledger`, tier 2) and `pastoral.notes.view`
(module `pastoral`, tier 3) since P1 (`scripts/seed-dev.sql` lines
226-227) — **nobody, at any fixture organization, holds either
permission.** No role is bound to them; no `role_grants` row grants them.
A congregation today has no one who can approve a disbursement or read a
pastoral note, in the fixture that's supposed to exercise the schema.

**Immediate, priority sub-question — unblocks tickets Phase 4**: the user
also decided `tickets.file` should move off `stated_clerk` onto its own
role, rather than staying piggybacked. This pipeline's Phase 1 should
resolve that specific question first (what the new role is called, what
it holds, how it's granted) so the tickets pipeline can proceed without
inventing a role in isolation that this pipeline might then reach a
different answer for. **A load-bearing fact for that sub-question**: the
self-lockout guard `revokeRole()` enforces (`src/lib/role-grants.ts`) is
hardcoded to `role_grants.manage` specifically — `ROLE_GRANTS_MANAGE` is
the one permission key it checks for before blocking a revoke. `tickets.
file` was never subject to that risk; splitting it off `stated_clerk`
does not need new self-lockout machinery, because a `role_grants.manage`
holder (`stated_clerk` or whoever holds it) can always re-grant `tickets.
file` to someone through the already-shipped `/o/<slug>/admin/roles` UI.
This significantly simplifies that half of the question — don't let
Phase 1 or Phase 2 invent lockout protection this permission never
needed.

**What already exists, to build on, not duplicate:**
- `src/lib/role-grants.ts` + `/o/<slug>/admin/roles` (P9) — the entire
  grant/revoke/view mechanism is generic over any `app_roles` row; a new
  tenant role needs zero new application code, only a new `app_roles` row,
  its `app_role_permissions` bindings, and a fixture `role_grants` row.
- The platform side's `roles`/`userRoles`/`roleFeatures` tables
  (`src/lib/db/schema.ts`) already bundle `FEATURES.*` keys into named
  roles, assignable at `/admin/users` — a "Support Operator" bundle is
  seed data, not new mechanism, same as the tenant side.
- DECISION-066 (`stated_clerk`'s own minting) is the direct precedent for
  how a new constitutional role gets justified against PC(USA) polity
  (G-3.0104) rather than invented from nothing — any new tenant role this
  pipeline proposes should hold itself to the same bar: a real office,
  not a software convenience with a churchy-sounding name.

**Explicitly not a request to change the tickets pipeline's shape** — its
Phase 1/2/3 (three phases, six decisions) stand. Only the role binding
`tickets.file` attaches to changes, via a correction appended to
DECISION-072 once this pipeline's relevant piece resolves — decisions are
append-only, never edited in place.

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
