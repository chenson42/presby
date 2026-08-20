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
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-20 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Three of the six permissions in the catalog have zero holders anywhere
> in the fixture — this fixes `ledger.approve` and `pastoral.notes.view`
> with real PC(USA) offices already anticipated in the schema (Treasurer,
> the installed pastor), gives `tickets.file` its own honestly-non-
> constitutional role instead of a third grant piled onto `stated_clerk`,
> and confirms the platform Support Operator bundle needs nothing beyond
> `FEATURES.ADMIN_TICKETS` — while surfacing a fourth zero-holder
> permission (`roll.propose`) nobody had named yet.

## RESOLUTION — unblocks support-tickets Phase 4

**`tickets.file` binds to a new, deliberately non-polity-branded, custom
role — not a new constitutional office, not a repurposed `property_chair`.**
There is no PC(USA) office for "point of contact with outside software
support" — inventing one would repeat the exact "churchy name for a
software convenience" DECISION-066's own bar exists to rule out.
`property_chair`'s *shape* is the right template though: `role_kind:
'custom'`, `is_protected: false`, direct-granted to one named person, no
group binding — already a proven pattern in the fixture, not a new one.

Recommended for Phase 3 to ratify: a new `app_roles` row at Alder Creek
(name candidate "Support Contact," Phase 3's call), `role_kind: 'custom'`,
`is_protected: false`, holding exactly `tickets.file`. Granted to
**Marguerite Ashcombe** (`c0000000-...001`), deliberately *not* Tobias
Renwick — he already holds `property_chair` and `stated_clerk`; a third
grant to the same person would visually recreate the "one person, every
capability" pattern this pipeline exists to interrupt, even though each
individual grant is independently justified.

**Self-lockout: confirmed unneeded, and the cost of splitting off
`stated_clerk` named explicitly.** `revokeRole()`'s guard checks one
hardcoded permission key (`role_grants.manage`) — a role holding only
`tickets.file` never triggers it, confirmed by reading the source. But
DECISION-072 named piggybacking on `stated_clerk` as buying an *emergent*
protection (a congregation could never organically reach zero `tickets.
file` holders, because it could never reach zero `role_grants.manage`
holders) — splitting the role off deliberately gives that up.
`property_chair` already lives with the identical exposure today and
nobody's treated it as blocking, so this is acceptable, but it needs a
correction appended to DECISION-072 (append-only) and a `docs/TODO.md`
line, not a silent trade.

## User Verbs

This pipeline ships no new UI and no new user-visible verb — `/o/<slug>/
admin/roles` and `/admin/users` already grant/revoke any role generically.
What changes is which roles a congregation admin can select, not a new
screen.

| Surface | Verb | Cadence |
|---|---|---|
| Existing `role_grants.manage` holder at `/o/<slug>/admin/roles` | Grant the new Treasurer / pastoral / Support Contact role to a named person | rare, one-time per office change |
| Platform admin at `/admin/users` | Assign the new platform "Support Operator" role bundle | rare |

**Named explicitly because it's easy to miss**: `ledger.approve` and
`pastoral.notes.view` gate nothing live in the running app today — no
route or action anywhere checks either permission. Seeding a holder makes
the fixture polity-honest and unblocks a future feature's own Phase 1; it
produces no new user-observable behavior by itself.

## Flows

**Flow 1 — Grant a new role, via the existing UI, unchanged:**
`grantRole()`'s existing DECISION-068 subset check applies as-is — a
`stated_clerk` holder (only `role_grants.manage`) cannot grant the
Treasurer role unless they also separately hold `ledger.approve`. Correct,
already enforced — means Phase 4's fixture rows go in via the seed script
directly, the same way `stated_clerk`'s own grant was seeded rather than
clicked through the UI.

**Flow 2 — Revoke the sole `tickets.file` holder — no failure path, by
design, and that is the finding.** `revokeRole()` finds the role doesn't
carry `role_grants.manage`, skips the holder-count check, succeeds
unconditionally. Revoking the sole holder silently leaves the org with
nobody who can file a ticket — no warning UI exists, no DB guard applies.
This is DECISION-072's named consequence, newly *live* the moment this
pipeline ships, not a new mechanism.

## Permissions & Flags

- **No new `permissions.key` or `FEATURES.*` values** — all four
  permissions this pipeline binds already exist in the catalog.
- **New fixture-only `app_roles` rows** (`scripts/seed-dev.sql`, per
  DECISION-063's standing non-answer — no code provisions a real org
  yet): Treasurer (constitutional, protected, `ledger.approve`); a
  pastoral role, name TBD Phase 3 (constitutional, protected, `pastoral.
  notes.view`); Support Contact (custom, not protected, `tickets.file`).
  All Alder Creek only.
- **All three direct-granted (arm 1)** — confirmed by reading the
  derived-group sync trigger: only `office = 'ruling_elder'`/`'deacon'`
  project into a materialized roster; nothing analogous exists for
  Treasurer/pastor/Support Contact, so direct grant is the only mechanism
  that reaches them today, not a stylistic choice.
- **Flags:** none needed — fixture data only, no new gated surface.

## Gaps the Request Didn't Address

- **`roll.propose` (tier 1) also has zero holders** — confirmed by reading
  the fixture's `app_role_permissions` block directly; only `roll.approve`
  is bound anywhere. The natural proposer is the Clerk of Session —
  `stated_clerk`'s own office — but binding it there reopens the
  concentration concern this pipeline exists to interrupt, this time on
  genuine polity grounds rather than expediency. Flagged for Phase 3 to
  weigh explicitly, not silently resolved either direction.
- **No `officer_terms` row exists for Treasurer or the pastoral role at
  any fixture org.** Nothing FK-requires one (unlike `session_member`'s
  group projection), but omitting it would leave the fixture polity-
  inconsistent — a "Treasurer" with software access and no record of
  holding the office, the opposite of `stated_clerk`'s own precedent
  (which dated its grant to match the `clerk_of_session` term's start
  date). Recommend Phase 4 add both `officer_terms` rows, not skip them.
- **Presbytery/synod pastoral care has no clean answer, and none is
  invented here.** `pastoral.notes.view`/`person_notes` model individual
  member care, a congregation-level concept by its own schema shape; no
  `committee_on_ministry` table or presbytery-level care concept exists
  anywhere in the schema. Recommend deferring explicitly rather than
  forcing a congregation-shaped concept onto a body it doesn't fit.
- **The two new tier-2/3 permissions still gate nothing live** — restated
  from User Verbs because it's the kind of gap easy to read past.
- **`docs/TODO.md` doesn't yet carry the "`tickets.file` loses its
  emergent lockout protection" line** DECISION-072 itself anticipated —
  should land in the commit that splits the role off (Rule 10), as a
  newly-live consequence, not a deferred one.

## Out of Scope (confirmed)

- Redesigning `role_grants`/`app_roles`/the resolver — nothing here needs
  a schema or mechanism change.
- New UI at `/o/<slug>/admin/roles` or `/admin/users` — both already
  handle any role generically.
- Presbytery/synod-specific pastoral-care role variants — no analogous
  schema concept was found to require distinguishing them.
- A `committee_on_ministry`/care-of-ministers concept at the presbytery
  level — real, plausible, genuinely absent from the schema, but a new
  domain concept, not a role-catalog binding. Named, not solved.

## Open Questions (for Phase 3, not the user)

- Exact role `key`/`name` strings for Treasurer and the pastoral role
  (`installed_pastor` vs `pastor` vs `moderator` — the last is
  polity-imprecise per the reasoning above, likely avoid it).
- Whether `roll.propose` gets resolved now (onto `stated_clerk`, accepting
  further concentration) or explicitly deferred with its own TODO line.
- Whether Treasurer should be `organizationTypeScope`-templated now or
  stay Alder-Creek-only per DECISION-063's existing non-answer (recommend
  the latter — no code provisions a real org yet).
- The DECISION-072 correction's exact wording — Phase 6 of *this* pipeline
  should draft it, since it's the pipeline that triggers the consequence.

## Handoff

**Next: architect (Phase 2).** The tickets-blocking resolution above is
the load-bearing output — the sibling tickets pipeline is waiting on it
and can proceed once architect confirms nothing here touches an
invariant. The broader catalog work is schema-free (fixture inserts plus
two new `officer_terms` rows) — architect should confirm this stays
fixture-only per DECISION-063's standing scope. Flag for Phase 3: pick
exact role names, decide `roll.propose`, draft the DECISION-072
correction.

*Recorded by the orchestrator from the read-only analyst agent's report.*

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
