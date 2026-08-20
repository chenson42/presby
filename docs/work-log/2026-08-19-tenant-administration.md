# P9 — Tenant Administration Surface — Work Log

> **Slug:** `2026-08-19-tenant-administration`
> **Surface:** `(org)` — `/o/<slug>/admin/...`, per DECISION-043
> **Permission(s):** new tenant permission keys, TBD by Phase 1/3
> **Flag(s):** TBD by Phase 1
> **Estimated complexity:** large — first tenant-facing administration surface
> **Pipeline mode:** Full, run with agents

---

## Context carried forward

**DECISION-043** (`docs/decisions.md`, minted 2026-08-18) already rules on the
core architecture, before this pipeline's own Phase 1 has run:

> Church, presbytery, and synod administration are **one surface** at
> `/o/<slug>/admin/...`, gated by tenant permissions from
> `presby_effective_permissions()` — not three route trees, and not the
> inherited `(admin)` shell. Which sections render is a function of
> `(organization_type, effective permissions)`... Reuse happens at the
> component layer: P0.5 extracts shared admin chrome into
> `src/components/shared/`. New pipeline **P9 — Tenant administration
> surface**, depends on P1, own Phase 1.

**"What does a stated clerk actually do on a Tuesday" is explicitly named as
a Phase 1 question the architect refused to pre-answer** — this pipeline's
Phase 1 owns the actual feature scope, not just the placement.

**P1 (just shipped, `2026-08-19-tenant-permissions-portal.md`) explicitly
deferred several things to P9, now unblocked:**
- Tenant administration — granting roles, managing `role_grants` through a
  UI — is P9's job, not P1's. P1 seeded exactly one grant, by migration/seed,
  never through application code.
- `AUDIT_ACTIONS.TENANT_ROLE_GRANTED`/`TENANT_ROLE_REVOKED` don't exist yet —
  P9 is almost certainly the pipeline that first writes a person-targeted
  `role_grants` mutation and needs them (DECISION-062).
- `role_grants`' arm-1 (direct, `person_id`) cascade-on-membership-end gap is
  real and unfixed — P9 will be the first pipeline to write an arm-1 grant,
  so it inherits this gap live, not academically (DECISION-062).
- `org_access_requests` (the "ask your church administrator to add me" door
  on `/no-organization`) was deliberately NOT built in P1 because there was
  no tenant-admin recipient to notify. **P9 is that recipient.** Revisit
  whether to build it now that one exists.
- The organization switcher's own nav (`GlobalNav`) was deliberately kept as
  identity/switcher chrome only, not a tenant-content nav — "a real tenant
  nav is P9's job once there's more than one page to link" (P1 Phase 3).
  P9 will have several (roll, members, roles) — this is likely where a real
  in-portal nav gets built.

**A finding, checked before this Phase 1 starts, not assumed**: DECISION-043
says P0.5 extracts shared admin chrome into `src/components/shared/`. It
didn't — `src/components/shared/` today holds `avatar-menu`, `global-nav`,
`org-switcher`, `feedback-form`, `formatted-date`, `fresh-recovery-codes`,
`turnstile`, `organizations-unavailable`. No admin-chrome component exists.
Whatever P0.5 built for `(admin)` (nav array in `admin/layout.tsx`, the
generated primitives) was never extracted into a reusable, tenant-admin-ready
form. **This Phase 1 should treat that extraction as this pipeline's own job,
not a completed prerequisite** — name it as a gap rather than silently
assuming it's already done.

**Also relevant**: `docs/decisions.md` DECISION-042 (P8, staff/employment) is
a sibling pipeline, also depends on P1, not yet started — P9 should not
invent a staff-based administration surface if P8 hasn't defined the data
model yet. Don't block on P8, but don't duplicate its scope either.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES — bootstrap gap + 6 adversarial findings | 2026-08-19 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-066/067/068 | 2026-08-19 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-19 |
| 4 — Implementation | database-admin, api-developer, ux-developer | Complete (3/3) | — | 2026-08-19 |
| 5 — Verification | qa | Complete | PASS | 2026-08-19 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> `role_grants` and the resolver are fully built and already proven end-to-end
> by `directory.view` — but today, at every fixture congregation, **nobody
> can pass a permission check to administer anyone else's access**, since no
> permission key for "grant a role" exists in the seeded catalog. This
> pipeline's real first deliverable is naming and provisioning that
> capability, then building the narrowest CRUD around *existing* `role_grants`
> rows — explicitly not roll actions, not officer terms, not role/permission
> creation, and explicitly not the cross-org commission/delegation tables,
> which are a structurally different two-sided-consent problem.

## User verbs and the presbytery question

Role-grant management is **identical in shape at every organization_type** —
scoped entirely by `role_grants.organization_id`, nothing in the schema
special-cases a presbytery's own grants. What is NOT the same shape is
anything reaching into another org (`administrative_commissions`,
`org_delegations`) — those exist specifically because ordinary role-grant
CRUD must not be extended to cover them. "Presbytery admin = congregation
admin with a bigger permission set" is the trap; the real difference is a
separate flow this pipeline does not build.

## Recommended minimal scope: three flows

**Grant a role** (to a person or a group, scoped to this org's own
memberships and seeded roles) → **Revoke a role** (ends, never deletes —
the row is the audit trail) → **View who holds what** (read-only, surfaces
provenance via the existing `explainPermission()`) — a write-only feature
nobody can audit by eye is not acceptable to ship.

**Explicitly deferred, not silently dropped**: roll-action recording/approval
(the append-only/void-corrected model deserves its own Phase 1); officer-term
management; creating new `app_roles` or editing what permissions a role
carries (this is exactly where the wildcard-role-template temptation lives —
confining this cut to *existing* seeded roles removes the sharpest version of
that risk); household/member invitation and `org_access_requests` (still no
recipient-side flow to act on one); the cross-org commission/delegation UI.

## The bootstrap gap — this pipeline's G-A

`role_grants.manage` (or whatever key Phase 3 names) doesn't exist in the
seeded catalog, and nothing binds it to any role. Unlike `directory.view`,
this permission **cannot** bootstrap onto the `active_membership` derived
group — that would hand every member the power to grant roles to every other
member. Needs an explicit Phase 2/3 ruling on the first real binding
(candidate: extend `session_member`, or mint a new constitutional
`stated_clerk`/`administrator` role), seeded via migration the same way
`directory.view` got its one provable binding at Alder Creek.

## A second real gap: no tenant-facing audit surface exists

`TENANT_ROLE_GRANTED`/`REVOKED` will write real rows once this ships, but the
only audit viewer in the app is `/admin/audit` — platform-only. The
underlying `audit_events` table has no `organization_id` column and no RLS;
the brand pipeline's precedent (overloading `resourceId` with the org id)
was never load-tested as a tenant-initiated event, and there is still no page
letting a stated clerk read it. This pipeline creates the first
tenant-security-sensitive mutation a congregation has no way to see who
performed. **Needs an explicit build-or-defer ruling at Phase 2/3, not a
silent gap** — this pipeline is the one creating the stakes.

## The shared-admin-chrome assumption doesn't hold

Confirmed: `src/components/shared/` has no admin-chrome component;
DECISION-043's expectation that P0.5 would extract one didn't happen. Worse,
extracting `(admin)`'s own nav (keyed on the platform `FEATURES.*` axis)
into something shared with a tenant surface (keyed on `(organization_type,
effective_permissions)`) risks re-introducing the exact DECISION-035-shaped
bug DECISION-043 itself warned against. **Recommendation: build a new
`(org)/admin/layout.tsx` from the existing generated primitives, reuse only
at that layer** — not force a chrome extraction that was never actually
needed.

## Adversarial pass — six findings, all non-negotiable for Phase 3

1. **Self/other-escalation.** Must be server-side: before writing a grant,
   compute the granter's own effective permissions and reject any grant whose
   target role's permission set is not a subset of what the granter already
   holds. **A real sibling repo (`../fpcw-directory`) was checked and shows no
   such server-side check anywhere** — confirmed prior art of the exact
   anti-pattern to not copy.
2. **Cross-org write.** `organization_id` must derive from the server-resolved
   route slug, never a client-supplied field — name as an explicit acceptance
   test (attempt a grant against a manipulated org id, confirm rejection).
3. **The wildcard-role-template temptation**, flagged pre-emptively for
   whenever role creation is eventually built: no "select all" checkbox, no
   stock "Church Administrator" role pre-bound to the full catalog.
4. **The arm-1 cascade gap, inherited live.** This is the first pipeline to
   write a direct (`person_id`) grant — the role-grant list should join
   `memberships.ended_on` and visibly flag a grant held by someone whose
   membership has ended, so the gap is visible even though it isn't fixed.
5. **Enumeration via the global `people` table.** Any person-search must query
   through `memberships` scoped to this org, never `people` directly — the
   same shape as the hole F21 already closed once, applied to a new query.
6. **Self-lockout.** Revoking the *last* standing `role_grants.manage`-holder
   at an org is a congregation-wide footgun, not just personal — recommend a
   hard block or a double-confirm, with the support-ticket loop as the
   documented recovery path.

## Handoff

**Next: architect (Phase 2).** Carry forward the bootstrap-permission
question (this pipeline's G-A), the tenant-audit-surface build-or-defer
ruling, and the shared-admin-chrome finding. All six adversarial findings are
non-negotiable acceptance criteria for Phase 3's design, not optional
polish. The out-of-scope list must not silently re-enter through Phase 3.

*Recorded by the orchestrator from the read-only analyst agent's report.*

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** Nothing returns to Phase 1. Three decisions
minted (DECISION-066/067/068).

## Task 1 — the bootstrap permission: `stated_clerk`, not an extension of `session_member`

**Ruling: a new constitutional role, `stated_clerk`, holding a new permission
`role_grants.manage`, granted by a direct (`person_id`) `role_grants` row —
never bound to a derived group.** Extending `session_member` was rejected:
its existing binding (`roll.approve`, granted to the whole derived Session
group) is doing real polity work — G-2.0401 makes roll actions a collective
decision — and handing every sitting elder the power to grant/revoke
administrative access simultaneously, with no individual act of designation,
is wildly out of proportion. PC(USA) polity already draws this exact line:
**G-3.0104's Stated Clerk** is a designated administrative office at every
council, elected by the body but exercising its records/execution duty
individually — maps directly onto "who clicks the grant-role button."
Exact seed shape given (mirrors `session_member`/`property_chair`/`member`'s
existing form), fixture-scoped to Alder Creek, `organizationTypeScope`
templating deferred to real org provisioning (G-B, still unbuilt). Named
consequence: this is the first arm-1 grant the codebase seeds, so
DECISION-062's flagged cascade gap goes live the moment it lands —
inherited, not introduced. **DECISION-066.**

## Task 2 — the tenant audit surface: defer the reader; write path stays unconditional

**Confirmed worse than Phase 1 suspected**: `audit_events` isn't merely
missing an `organization_id` column — it's **absent from `drizzle/0009`'s
`tenant_tables` array entirely**, so it has no RLS policy of any kind.
`presby_app` can read every row regardless of org context. The brand
pipeline's `resourceId`-overload convention is safe today only because its
one reader is platform-only; a tenant-facing reader on the same table has no
such backstop and repeats the exact enumeration-oracle shape DECISION-049
already rejected once for `organization_brands`. **Ruling: defer the reader**
— building it safely needs a dedicated FORCE-RLS projection or a
narrowly-scoped SECURITY DEFINER function, real schema work this pipeline's
Phase 1 scope didn't ask for. The write path (`TENANT_ROLE_GRANTED`/`REVOKED`)
ships unconditionally regardless (Rule 7; no reader exists yet to leak to),
with `organization_id` recorded explicitly in `metadata` so a future reader
isn't guessing at convention. Flow 3 ("who holds what," already in scope,
already RLS-correct via the resolver) is a genuinely better answer to
current-state questions but does not cover history — the gap stays open,
named, tracked. **DECISION-067.**

## Task 3 — shared-admin-chrome: confirmed, one constraint added

Confirmed directly against the code: `(admin)`'s nav is a flat array with no
`FEATURES.*` filtering in the layout itself, nothing shaped for reuse across
the `(organization_type, effective_permissions)` axis. Build a new
`(org)/o/[slug]/admin/layout.tsx` from the generated primitives. **One
constraint for tech-lead**: the new layout must NOT itself render
`<BrandTokens>` — `check-brand-scope.mjs`'s E1/E3 rules restrict the marker
to exactly the two files in `EMITTERS`, and this layout sits beneath
`[slug]/layout.tsx` in the tree and inherits the emitted cascade for free.
Not a new decision — DECISION-043/047/052 applying without incident.

## Task 4 — all six adversarial findings achievable inside the existing pattern

All six confirmed as server-side logic inside a `withOrgContext()`-scoped
mutation, mirroring `directory.ts`'s shape — no new resolver arm, no new
tenant table. The highest-stakes one (self/other-escalation) gets its own
ruling: the subset check is two ordinary, already-org-scoped reads
(`effectivePermissions()` for the granter, a plain `SELECT` over the global
`app_role_permissions`/`permissions` catalog for the target role) inside the
mutation's own transaction — **not a new privileged SQL function**, since
neither read crosses an org boundary and `presby_effective_permissions()`
already self-guards against exactly the risk a second DEFINER function would
reintroduce. **DECISION-068.** The remaining five are implementation-level
reuses of already-established shapes (the `(org)` contract's resolution
order, `directory.ts`'s `memberships`-scoped person search, a join on
`memberships.ended_on` for the visible-not-fixed cascade flag, a
subset-aware self-lockout guard).

## Documentation hygiene, caught in passing

`docs/decisions.md` carried duplicate decision numbers (063/064/065, each
minted twice across two work-log recording passes) — confirmed neither
duplicate pair conflicted with this ruling, but flagged for cleanup.
**Fixed by the orchestrator immediately, before minting 066–068**: merged or
deduplicated all three, confirmed zero duplicate numbers remain anywhere in
the file (`ea073b0`).

## Handoff

**Next: tech-lead (Phase 3).** Carry forward: the `stated_clerk` seed shape
(DECISION-066) as the literal binding to design against; the audit-defer
ruling (DECISION-067) — Flow 3 in scope, a reader is not, both TODO lines
land in the same commit (Rule 10); the subset-check placement (DECISION-068)
as `src/lib/role-grants.ts`'s concrete shape; the brand-scope constraint on
the new admin layout; all six adversarial findings as non-negotiable
acceptance criteria. The out-of-scope list must not silently re-enter.

*Recorded by the orchestrator from the read-only architect agent's report.*

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Three flows over tables that already exist — `role_grants`, `app_roles`,
`app_role_permissions` need no schema change. The only data-model work is
provisioning what DECISION-066 named: the `role_grants.manage` permission row
(migration-seeded, `drizzle/0018_presby_role_administration.sql`, idempotent
`on conflict do nothing`) and the `stated_clerk` role/binding/direct-grant
(fixture-seeded in `scripts/seed-dev.sql`, mirroring `session_member` /
`property_chair` / `member`'s exact shape — bound to Tobias Renwick at Alder
Creek, matching his existing `clerk_of_session` officer term's start date;
Bramblewood and Quillhaven deliberately get no grant, same "prove the
mechanism once" reasoning DECISION-063 used for `directory.view`). All
mutation logic lives in a new `src/lib/role-grants.ts`, built to
`directory.ts`'s exact shape: one `withOrgContext()` transaction per exported
function, thrown exceptions for genuine failure, typed result variants for
every expected outcome. New flag `org_portal.roles`, seeded off, checked bare
(a toggle, not an auth path — same reasoning as `org_portal.directory`).

## Permissions & flags

- `role_grants.manage` — module `authz`, tier 1 (the row itself exposes
  nothing in tiers 2/3; a granted role *carrying* a tier-2/3 permission is the
  subset check's job at grant time, not this row's classification).
- `stated_clerk` — `role_kind: 'constitutional'`, `is_protected: true`,
  fixture-seeded (no code provisions a real organization yet — G-B).
- `org_portal.roles` flag, seeded off, added to `scripts/seed.ts` next to
  `org_portal.directory`. Never substitutes for the permission check — flag
  off means nobody reaches the page; flag on with no grant means an honest
  in-shell denial.
- New audit keys `TENANT_ROLE_GRANTED` / `TENANT_ROLE_REVOKED` in
  `src/lib/audit.ts`, `organization_id` recorded explicitly in `metadata`
  (DECISION-067's convention — a future reader shouldn't have to guess).

## API contract — `src/lib/role-grants.ts`

`listGrants(viewerPersonId, organizationId)` → who holds what, joining
`memberships.ended_on` so an arm-1 grant on a lapsed membership stays
**visible, not silently continuing and not auto-ended** — finding 4 made
visible without being fixed, per DECISION-062's own framing.

`getGrantFormOptions(...)` → roles/people/groups for the grant form; people
queried through `memberships` scoped to this org, never a bare `people` scan
(finding 5, the F21 shape re-applied).

`grantRole(granterPersonId, organizationId, { roleId, target, startsOn? })` →
validates the role and target belong to this org (closes finding 2's
"supply an ID from another org" variant), then runs DECISION-068's subset
check — the granter's `effectivePermissions()` against the target role's
`app_role_permissions`, inside the same transaction, no new SQL function —
and rejects with the missing keys named if the grant would exceed the
granter's own permissions (finding 1). One real implementation caveat the
design calls out explicitly rather than leaving for Phase 4 to trip over:
`role_grants.granted_by` is a `users.id` FK, not `people.id` — the function
takes `granterPersonId` for the permission/membership checks, but the Server
Action layer must pass the session's `users.id` separately for that column;
conflating the two would violate the FK.

`revokeRole(granterPersonId, organizationId, grantId)` → ends (never
deletes — the row is the audit trail), and before ending a grant that itself
carries `role_grants.manage`, counts every *other* currently-effective
holder (expanding a group grant to its live membership) and blocks with
`self_lockout_blocked` if the count would hit zero (finding 6).

## Component / page plan

`(org)/o/[slug]/admin/layout.tsx` — minimal chrome, no auth of its own (the
`(org)` contract's rule: auth lives in the page, which can see the
pathname), does **not** render `<BrandTokens>` (inherits the cascade from
the ancestor layout — the Phase 2 constraint). One back-link, no nav array —
building a real tenant nav is deliberately deferred to whichever future page
makes a second link exist to navigate between.

`admin/roles/page.tsx` — repeats the `(org)` auth pattern in full, structured
identically to `directory/page.tsx`: session → `resolveOrgContext` four-way
switch → `assertOrgAccess` → flag check *before* any data fetch → `listGrants`
→ `getGrantFormOptions`. `roles-states.tsx` (flag-off / forbidden /
load-error, matching `directory-states.tsx`'s copy register), `roles-list.tsx`
(a `Table`, not cards — this page is genuinely wide-column, the opposite of
the directory's card rationale), `grant-role-form.tsx` (a client-side inline
form, not a `Dialog` — no `Dialog` primitive exists yet and generating one is
out of scope; native `<select>`s per `docs/ui-standards.md`, radio-toggled
between a person target and a group target), `revoke-dialog.tsx` (an
`AlertDialog` naming both the person/group *and* the role, modeled directly
on `neutralize-dialog.tsx`; a `self_lockout_blocked` result surfaces inline
via `toast.error`, not a silent dialog close), `actions.ts` (Server Actions
`grantRoleAction` / `revokeRoleAction` — `organizationId` always comes from a
fresh `resolveOrgContext()` call, never from client-supplied form data; both
call `recordAudit()` on success, satisfying `check:audit`).

`OrgPortalStub` gains an "Administration →" link, gated on the flag alone,
never on the viewer's own grant — the destination page stays the sole
authority on the viewer's own permission, matching `directoryEnabled`'s
existing rule.

## Implementation order

1. **database-admin** — `drizzle/0018_presby_role_administration.sql` (the
   permission catalog row) + the `scripts/seed-dev.sql` additions
   (`stated_clerk` role/binding/direct grant).
2. **api-developer** — `src/lib/role-grants.ts` + `role-grants.test.ts`
   (real-Postgres integration tests, `directory.test.ts`'s harness), the
   `granted_by`/`granterPersonId` FK caveat resolved as part of this commit,
   `src/lib/audit.ts` additions, `scripts/seed.ts` flag, `admin/roles/
   actions.ts` + its test.
3. **ux-developer** — `admin/layout.tsx`, `admin/roles/page.tsx`, the three
   supporting components + their tests, the `OrgPortalStub`/`page.tsx` link,
   plus a real-browser phone-viewport walkthrough (CLAUDE.md → Verify in a
   Browser) including a **live** self-lockout check through the actual UI,
   not just the unit test.

## Edge cases — the six adversarial findings, each given a concrete test

Self/other-escalation (a role bound only to `directory.view` cannot grant one
that also carries `role_grants.manage`); cross-org write (a person with no
active membership at the target org throws `OrgAccessError` before permission
logic runs, plus a code-review check that `actions.ts` never reads
`organizationId` from `formData`); no wildcard template (the role `<select>`
renders exactly `options.roles.length` entries, no "select all"); the arm-1
cascade gap surfaced not fixed (ending a person's membership without
touching their `role_grants` row leaves the grant listed, with
`membershipEnded` set, not filtered out and not auto-ended); no enumeration
via bare `people` (a person with a membership only at another org is absent
from `getGrantFormOptions`, verified against a raw `people` count showing
more rows exist than are offered); self-lockout (single-holder org blocks a
self-revoke; two-holder org allows one revoke then blocks the survivor's).
Plus the flag-off/empty-list states matching the directory page's precedent.

## Out of scope (reaffirmed, not re-litigated)

Roll-action recording/approval, officer-term management, creating new
`app_roles` or editing what permissions a role carries (the wildcard-role-
template risk), household/member invitation and `org_access_requests`, the
cross-org commission/delegation UI, a tenant-facing audit reader
(DECISION-067), a real `Select`/`Command` primitive, a tenant nav beyond the
one new link.

## E2E blast radius

Checked directly: no existing spec touches `/o/<slug>/directory`,
`/o/<slug>/admin/*`, `role_grants`, or the platform `admin/users` role
flow. **Zero existing specs need updating.** This feature doesn't touch
`src/auth.ts`/`(auth)`/`api/auth`/`lib/auth`, so it doesn't trigger the
mandatory auth-touching e2e-smoke gate. New e2e coverage for the route itself
is named as a `docs/TODO.md` follow-up, not silently skipped.

## Acceptance criteria

Real-Postgres integration tests for all six adversarial findings; typecheck,
build, and all four `check` tripwires clean; a real-browser 360px walkthrough
of both grant flows, the escalation-denied error, the revoke confirmation,
and the flag-off state; the self-lockout guard exercised live through the UI,
not only unit-tested; `docs/product/functionality-map.md` updated at ship
time (Rule 14) — this is the first tenant-facing capability a congregation's
own staff can act on, not internal admin tooling, so Phase 6 should weigh a
`whats_new_entries` post (Rule 13).

## Handoff

**Next: Phase 4 implementation**, database-admin first (schema/seed is the
dependency every other commit needs), then api-developer, then ux-developer —
sequential, not parallel, since each layer consumes the prior one's concrete
contract. No new decisions minted this phase; DECISION-066/067/068 stand as
written.

*Recorded by the orchestrator from the tech-lead agent's full design doc.*

---

# Phase 4 — Implementation (commit 1 of 3: database-admin, schema/seed)

## Files Created

- `drizzle/0018_presby_role_administration.sql` — the global `role_grants.manage`
  permission-catalog row, idempotent (`on conflict (key) do nothing`), matching
  `0017`'s header-comment and hand-authored style (DECISION-063's precedent:
  `permissions` needs no org to exist first, so the migration is the right
  home, not `scripts/seed.ts`).

## Files Modified

- `drizzle/meta/_journal.json` — registered `0018_presby_role_administration`
  at `idx: 18`, same shape as `0017`'s entry (`"version": "7"`, incrementing
  `when`, `breakpoints: true`).
- `scripts/seed-dev.sql` — Authorization fixture block (originally ~lines
  219–271, now ~219–290 after the additions):
  - Added `role_grants.manage` to the existing `permissions` catalog insert
    (module `authz`, tier 1), duplicating the migration's own row — same
    "both use `on conflict do nothing`" pattern `directory.view` already
    established between `0017` and this file.
  - New `app_roles` row: `stated_clerk` (`f0000000-0000-0000-0000-000000000005`
    — `...0003` was already taken at Fernwood, `55555555-...`, so `0005` was
    the next free suffix in the Alder Creek series), Alder Creek
    (`22222222-...`), `role_kind: 'constitutional'`, `is_protected: true`.
  - New `app_role_permissions` row: `stated_clerk` → `role_grants.manage`.
  - New direct (`person_id`) `role_grants` row: `stated_clerk` granted to
    Tobias Renwick (`c0000000-0000-0000-0000-000000000002`) at Alder Creek,
    `starts_on: 2023-01-08` — matches his existing `clerk_of_session`
    `officer_terms` row (`e0000000-0000-0000-0000-000000000005`) exactly; no
    discrepancy from the design doc's stated id/date.
  - Deliberately **no** `stated_clerk` role or grant at Bramblewood
    (`33333333-...`) or Quillhaven (`44444444-...`) — same "prove the
    mechanism once" reasoning DECISION-063 used for `directory.view`; verified
    empty by direct query.
  - One-line comments above each addition citing P9/DECISION-066, matching the
    file's existing comment density.

## Schema Changes

- No `pgTable` changes — `role_grants`, `app_roles`, `app_role_permissions`
  already support this shape; only catalog/fixture data changed.
- Applied via **`npm run db:generate`... not used** (see Implementer Notes —
  `db:generate` is broken repo-wide, hand-authored per the standing house
  note). The migration was applied directly with `psql "$MIGRATE_DATABASE_URL"
  -f drizzle/0018_presby_role_administration.sql` against the dev database
  (same connection `db:migrate` targets), run twice to prove idempotency
  (`INSERT 0 1` then `INSERT 0 0`). The `scripts/seed-dev.sql` fixture delta
  (the four new statements) was applied the same way, once, against the
  already-loaded dev fixture — the full file is not idempotent
  end-to-end (no `ON CONFLICT` on `organizations`/`people`/etc.), so it cannot
  be safely re-run wholesale against a DB it's already loaded into; the delta
  alone is what a fresh load of the now-edited file would additionally insert.

## Audit Events

- None — this commit is schema/seed only, no application mutation path.
  `TENANT_ROLE_GRANTED`/`TENANT_ROLE_REVOKED` are commit 2's job
  (`src/lib/audit.ts`, per the Phase 3 design and DECISION-062/067).

## Implementer Notes

**`npm run db:migrate` does not work in this environment — confirmed
pre-existing, not introduced by this change.** Running it (with or without
`0018` present — verified via `git stash`) exits 1 with no stderr, and the
`__drizzle_migrations` tracking table stops at `idx 9` (`0009_presby_rls`):
drizzle-kit's own migration runner has not successfully applied anything past
`0009` in this database, consistent with `docs/TODO.md`'s existing open item
("`db:generate` is broken repo-wide... Migrations `0013`–`0017` have all been
hand-authored... as a workaround") — evidently the workaround extends to
`db:migrate` itself failing silently on this hand-authored chain, not only
`db:generate`. I applied and verified `0018` (and the `seed-dev.sql` delta)
directly via `psql` instead, which is the same mechanism the migration's own
header cites (`docs/testing.md`'s documented load path) and is how `0013`–
`0017` were evidently gotten into this database in the first place. This is
worth a `docs/TODO.md` line of its own (added below) rather than silently
working around it a second time with no trace.

Verification run directly against the dev database (`psql
"$MIGRATE_DATABASE_URL"` / `"$APP_DATABASE_URL"`):

- `role_grants.manage` exists in `permissions` exactly once (`module: authz`,
  `sensitivity_tier: 1`).
- `stated_clerk` exists in `app_roles` exactly once, at Alder Creek only.
- The direct grant to Tobias Renwick exists with `starts_on: 2023-01-08`,
  matching `officer_terms.e0000000-...005`'s own `starts_on` exactly.
- Zero `stated_clerk` roles or grants at Bramblewood or Quillhaven.
- Deliberately violated `role_grants_principal_check` (both `person_id` and
  `group_id` null) — rejected as expected.
- Deliberately violated `role_grants_person_fk` (Tobias Renwick has no
  `memberships` row at Bramblewood) — rejected as expected.
- `npm run typecheck` — clean, no errors (SQL-only change, as expected).
- `npm run check` — all four tripwires pass (`check:audit`, `check:sql-date`,
  `check:deps-drift`, `check:brand-scope`).
- `scripts/test-rls.sql` run as `presby_app` (`psql "$APP_DATABASE_URL" -v
  ON_ERROR_STOP=1 -f scripts/test-rls.sql`) — exit 0, 61 `NOTICE: pass` lines,
  zero occurrences of "fail" in the full log. Nothing broke; this commit
  touches no trigger, matching the design doc's own note.

**Handoff to api-developer (commit 2 of 3):** `role_grants.manage`
(`module: authz`, tier 1) and `stated_clerk` (`f0000000-0000-0000-0000-000000000005`,
constitutional, protected, Alder Creek only) are live in the dev database and
in `scripts/seed-dev.sql` for any fresh load. Tobias Renwick
(`c0000000-0000-0000-0000-000000000002`) holds the grant at Alder Creek from
`2023-01-08`; no grant exists at Bramblewood or Quillhaven (clean
"no grant, forbidden" fixtures per the Phase 3 design). To apply locally:
`psql "$MIGRATE_DATABASE_URL" -f drizzle/0018_presby_role_administration.sql`
(idempotent, safe to re-run) and, for a **fresh** database only, `psql
"$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql` (not safe to re-run against
an already-seeded database — see above). No `npm run db:seed` change was
needed this commit; the design doc's `org_portal.roles` flag addition to
`scripts/seed.ts` is commit 2's job. `src/lib/role-grants.ts`'s subset check
(DECISION-068) can now read `app_role_permissions` for `stated_clerk`'s row
directly — the catalog binding it depends on exists.

---

# Phase 4 — Implementation (commit 2 of 3: api-developer, server)

## Files Created

- `src/lib/role-grants.ts` — the mutation-layer module: `listGrants`,
  `getGrantFormOptions`, `grantRole`, `revokeRole`, plus a private
  `hasRoleGrantsManage` helper. Same shape as `directory.ts`: one
  `withOrgContext()` transaction per exported function, thrown exceptions
  for genuine failure, typed result variants for every expected outcome.
- `src/lib/role-grants.test.ts` — real-Postgres integration tests
  (`directory.test.ts`'s harness: `hasDb` skip-guard, dynamic imports in
  `beforeAll`, a self-contained fixture across four organizations, torn
  down in `afterAll`). 25 tests (one added by the orchestrator's fix below).
- `src/app/(org)/o/[slug]/admin/roles/actions.ts` — `grantRoleAction`,
  `revokeRoleAction`. Auth-in-the-action-body plumbing and the audit write
  only; all SQL correctness lives in and is proven by `role-grants.ts`.
- `src/app/(org)/o/[slug]/admin/roles/actions.test.ts` — mocked at the
  `@/lib/role-grants` boundary (matching `directory/page.test.tsx`'s
  mocking style, applied to a Server Action). 16 tests.

## Files Modified

- `src/lib/audit.ts` — two new `AUDIT_ACTIONS` keys, `TENANT_ROLE_GRANTED`
  (`"tenant.role.granted"`) and `TENANT_ROLE_REVOKED`
  (`"tenant.role.revoked"`), placed after `ORG_BRAND_NEUTRALIZED` with a
  comment citing DECISION-067's explicit-`organization_id`-in-metadata
  convention.
- `src/lib/audit.test.ts` — the file's own `EXPECTED_ENTRIES` drift-guard
  object needed the same two keys added, or `npm run typecheck` fails
  (`Record<..., string>` is missing properties) — caught immediately by
  running typecheck, not discovered later.
- `scripts/seed.ts` — new flag `org_portal.roles`, `enabled: false`, added
  immediately after `org_portal.directory`, matching its comment shape and
  "flag is a toggle, permission is the real gate" framing exactly.

## Schema Changes

None — this commit is server logic only, consuming database-admin's
commit 1 (`role_grants.manage`, `stated_clerk`) unchanged.

## Audit Events

- `TENANT_ROLE_GRANTED` — written by `grantRoleAction` on `{ kind: "ok" }`
  only. `resourceType: "role_grant"`, `resourceId` the new grant id,
  `metadata: { organizationId, roleId, roleKey, granteeType, granteeId }`.
- `TENANT_ROLE_REVOKED` — written by `revokeRoleAction` on `{ kind: "ok" }`
  only, same `metadata` shape, supplied by the caller (the page already
  has this data from its own `listGrants()` read — `revokeRole()` itself
  returns only a result kind, not row detail).
- Both actions checked by `npm run check:audit` — in practice the
  tripwire's `MUTATION_RE` (`db.insert|update|delete`) never fires on
  this `actions.ts` file at all, since it delegates every mutation to
  `role-grants.ts` rather than calling `db` directly; the tripwire passes
  trivially rather than by matching an `AUDIT_ACTIONS` reference. Noted
  rather than silently relied on — the coverage is real (both actions do
  call `recordAudit()`), just not exercised by this specific heuristic.

## A design tension found — and the implementer's resolution reverted, by the orchestrator, before commit

api-developer found a real inconsistency: the Phase 3 design's own edge-case
wording ("a role bound only to `directory.view` cannot grant a role that
also carries `role_grants.manage` → `escalation_denied`") only makes sense
if the granter reaches the subset check WITHOUT holding `role_grants.manage`
first — which is only possible if `grantRole` has no primary
`hasRoleGrantsManage` gate at all. api-developer resolved the tension by
removing the gate from `grantRole` and keeping it on the other three
functions, reasoning that the subset check alone was sufficient "by
construction" since granting a role carrying `role_grants.manage` itself
requires already holding it.

**That resolution was wrong, and the orchestrator caught it in independent
review before commit, not in a later phase.** Removing the primary gate
means it is sufficient by construction *only* for roles that themselves
carry `role_grants.manage` — not for any other role. Concretely: `narrowPerson`
(holding nothing but `directory.view`, the baseline every `active_membership`
member has via the `member` role) could call `grantRole` for `viewer`
(bound only to `directory.view`) and succeed, since the subset check alone
— {directory.view} ⊆ {directory.view} — has nothing to say about whether
the granter is authorized to use the feature *at all*. This directly
recreates the exact failure mode DECISION-066 minted `stated_clerk`
specifically to avoid: "that would hand every member the power to grant
roles to every other member." An ordinary member with zero administrative
standing could write `role_grants` rows for any role at or below their own
permission tier — a real authorization bypass, not a cosmetic gap, even
though today's seeded roles keep its immediate blast radius to
`member`/`property_chair`/`viewer`-tier grants.

**Fixed directly** (`src/lib/role-grants.ts`): restored the
`hasRoleGrantsManage` gate as `grantRole`'s first check, matching the other
three functions — the gate answers "may this person administer role grants
at all," the subset check is an independent second layer answering "even
granted that, can they hand out something they don't personally hold,"
never a substitute for the gate. The flagship escalation test needed a
different fixture to stay meaningful under the corrected model: a person
holding `role_grants.manage` and *nothing else* (`bareClerkPerson`,
new in the fixture) attempting to grant a role that requires an additional
permission they lack (`directory.view`) — that is the scenario the subset
check actually exists to catch; testing a granter who never clears the gate
was never a meaningful test of it. Added a second, explicit regression test
for the vulnerability itself: `narrowPerson` attempting to grant `viewer` —
a role entirely within their own permission subset — now correctly returns
`forbidden`, not `ok`. Both `role-grants.ts`'s module header and the
`grantRole` docstring were rewritten to state the two-layer model plainly.
Re-verified: `npm run typecheck`, `npm run check` (all four tripwires),
`npm test` (1370 passed / 43 skipped), the real-Postgres suite (**25/25
passed**, up from 24 — the new regression test), `actions.test.ts` (16/16),
and `scripts/test-rls.sql` as `presby_app` (61 pass, 0 fail) — all clean
after the fix.

The one accepted, narrow residue noted by the original draft still stands
and is unaffected by this fix: a role with zero `app_role_permissions` rows
could be granted by anyone holding `role_grants.manage`, regardless of the
subset check, since the subset of nothing is always satisfied — not a
privilege-escalation risk (an empty-permission role grants no capability),
just a data-quality one. No seeded role is empty today.

## A significant discovery: the "arm-1 cascade gap" is already closed by a pre-existing trigger, contradicting DECISION-062/066

Writing `role-grants.test.ts`'s finding-4 fixture (end a membership without
touching its `role_grants` row) failed against the real dev database:
`drizzle/0014_presby_org_router.sql` already installs
`presby_guard_membership_end()`, a `BEFORE UPDATE OF ended_on` trigger that
raises `check_violation` — "cannot end this relationship on % - a role
grant beginning % is still open at this organization" — for precisely this
case, in both directions (ending a membership under an open grant is
rejected; opening a grant at an already-ended membership is separately
rejected by its sibling `presby_guard_position_needs_membership()`).
`scripts/test-rls.sql` (lines 468–484) already asserts this exact
behavior, with a comment naming it explicitly: "the role_grants half of
the trigger." Migration `0014` predates this pipeline's own `0018` and
even P1's `0017`/permission-portal work chronologically (by migration
number), yet DECISION-062 (P1 Phase 2) states the cascade gap is "real but
untouched," and DECISION-066/the Phase 3 design both build on that framing,
asking this commit to surface a state that the database already refuses to
create via any ordinary application mutation path. This looks like a
genuine research gap in P1's Phase 2 review — the trigger existed and was
already tested — rather than a new development in this commit.

**What I did about it:** kept `listGrants()`'s `membershipEnded` LEFT
JOIN/COALESCE exactly as designed — it is correct, harmless defensive code
regardless of whether the state is reachable through the app today, and it
is the right answer for the one path that CAN still produce it (a direct
historical-data import, or a future migration that relaxes the guard).
`role-grants.test.ts`'s finding-4 fixture now constructs the state via a
narrowly-scoped, `try`/`finally`-guarded `ALTER TABLE memberships DISABLE
TRIGGER memberships_guard_end` around the one `UPDATE`, immediately
re-enabled — simulating imported/legacy data, never done in application
code, only in the test fixture. **Did not** touch the trigger itself,
`drizzle/`, or `docs/decisions.md` — those are out of this commit's scope
per the brief and belong to database-admin / the analyst's Phase 6 review.
Flagging this explicitly for the orchestrator to decide whether
DECISION-062/066 need a correcting note and whether `docs/TODO.md`'s
"arm-1 cascade gap, unfixed" line (if one exists) needs updating to say
"guarded since `0014`, for the ordinary mutation path" instead.

## Implementer Notes

- `role_grants.granted_by` FK caveat: resolved by giving `grantRole` a
  fourth parameter, `granterUserId: string` (a `users.id`), separate from
  `granterPersonId: string` (a `people.id` used for the membership/
  permission checks). `admin/roles/actions.ts` is the layer that has both
  at once — `session.user.id` from `auth()` and `resolved.org.personId`
  from `resolveOrgContext()` — and passes both in rather than either
  function re-deriving one from the other. Documented at both the
  `grantRole()` call site and the `actions.ts` header, citing
  `src/lib/brand/read-org-brand.ts`'s header as the precedent for the same
  bug class (P0.5).
- Divergence from the brief: `actions.ts` uses `auth()` directly, not
  `cachedAuth()`. `src/lib/auth/cached-auth.ts`'s own header says
  `cachedAuth()` is for Server Component render trees only and is
  misleading in a Server Action, where `cache()` is a no-op — every other
  `actions.ts` in the tree (`account/actions.ts`, `account/2fa/actions.ts`,
  `admin/organizations/[id]/actions.ts`) already follows this. Noted
  explicitly rather than silently deviating.
- `effectivePermissions()` (the exported wrapper in `src/lib/authz.ts`)
  was NOT called from inside `grantRole`'s subset check, even though
  DECISION-068 names it — calling it would open a SECOND `withOrgContext()`
  transaction nested inside the one `grantRole` already has open, which
  contradicts DECISION-068's own text ("both reads happen inside the ONE
  transaction the mutation already opens"). Instead, `grantRole` calls
  `presby_effective_permissions()` directly via `tx.execute()`, the same
  underlying SQL `effectivePermissions()` itself runs — same guarantee,
  no nested transaction, no redundant membership re-check.

## Verification

- `npm run typecheck` — clean.
- `npm run check` (all four tripwires) — clean.
- `npm test` (the real CI command, no `DATABASE_URL`) — 1370 passed, 42
  skipped (role-grants.test.ts correctly among the skipped set), 0 failed.
- `dotenv -e .env.local -- vitest run src/lib/role-grants.test.ts` — **24
  passed, 0 failed, 0 skipped** — confirmed running against real Postgres
  (the `hasDb` guard was true; a deliberate `not-a-uuid` input threw a real
  Postgres `22P02` cast error, not a mocked result, in the "genuine
  failures propagate" describe block).
- `vitest run "src/app/(org)/o/[slug]/admin/roles/actions.test.ts"` — 16
  passed, 0 failed.
- `scripts/test-rls.sql` run as `presby_app` (`psql "$APP_DATABASE_URL" -v
  ON_ERROR_STOP=1 -f scripts/test-rls.sql`) — exit 0, 61 `NOTICE: pass`
  lines, zero occurrences of "fail". Nothing broken.
- Pre-existing, unrelated flake noted and NOT touched: `npm run test`
  under `dotenv -e .env.local` (only) fails 3 `rate-limit.test.ts` tests
  that pass cleanly without `.env.local`'s vars loaded — confirmed via
  `git stash` that this reproduces identically on a clean tree with zero
  changes from this commit. Not investigated further (out of scope); the
  actual CI invocation (`npm run test`, no dotenv) is fully green.

## Handoff to ux-developer (commit 3 of 3)

`src/lib/role-grants.ts` exports `listGrants(viewerPersonId, organizationId)
→ GrantListResult`, `getGrantFormOptions(viewerPersonId, organizationId) →
GrantFormOptionsResult`, `grantRole(granterPersonId, organizationId,
granterUserId, input: GrantRoleInput) → GrantResult` — note the FOUR
parameters, `granterUserId` is new relative to the Phase 3 design's literal
signature — and `revokeRole(granterPersonId, organizationId, grantId) →
RevokeResult`. `src/app/(org)/o/[slug]/admin/roles/actions.ts` exports
`grantRoleAction(slug, { roleId, target, startsOn? }) →
ActionResult<{ grantId }>` and `revokeRoleAction(slug, { grantId, roleId,
roleKey, granteeType, granteeId }) → ActionResult` — `revokeRoleAction`
needs the grant's role/grantee detail as input because `revokeRole()`
itself doesn't return it; the page already has this from its own
`listGrants()` read and should pass the row's own fields straight through
when building the revoke confirmation. New flag `org_portal.roles`
(`scripts/seed.ts`), seeded off — the page must check it before rendering
anything, same as `directory/page.tsx`'s `org_portal.directory` check.
`GrantListEntry.grantee` (person arm) carries `membershipEnded: string |
null` — per the "significant discovery" note above, expect this to be
`null` in virtually every real-world case going forward (the DB guard
prevents new occurrences); render it as a visible warning when non-null
rather than assuming it's dead code. No `Dialog`/`Select` primitive exists
yet (per the Phase 3 design, out of scope to add) — `grant-role-form.tsx`
needs native `<select>`s and `revoke-dialog.tsx` needs `AlertDialog`
(already generated, used by `neutralize-dialog.tsx`). Also owed: a real
browser, 360px-viewport walkthrough of both flows including a **live**
self-lockout check (CLAUDE.md → Verify in a Browser; the Phase 3 design's
own acceptance criteria), and `docs/product/functionality-map.md` /
`docs/TODO.md` updates at Phase 6 ship time, not this commit.

*Recorded by api-developer.*

---

# Phase 4 — Implementation (commit 3 of 3: ux-developer, client)

## Files Created

- `src/app/(org)/o/[slug]/admin/layout.tsx` — minimal chrome: a back link to
  `/o/<slug>`, no auth of its own, no `<BrandTokens>` emission, no nav array
  (Phase 3 design, DECISION-043/047/052 applying without incident).
- `src/app/(org)/o/[slug]/admin/roles/page.tsx` — repeats the `(org)` auth
  pattern from `directory/page.tsx` line for line: `cachedAuth()` → four-way
  `resolveOrgContext()` switch → `assertOrgAccess()` → flag check
  (`org_portal.roles`) BEFORE `listGrants()`/`getGrantFormOptions()` are ever
  called → renders the roles table and the grant form.
- `src/app/(org)/o/[slug]/admin/roles/roles-states.tsx` — `RolesFlagOff`,
  `RolesForbidden`, `RolesLoadError`, three genuinely distinct copy blocks
  matching `directory-states.tsx`'s register.
- `src/app/(org)/o/[slug]/admin/roles/roles-list.tsx` — a `Table` (wide-column
  data, the directory's card rationale does not apply here). Columns: role,
  granted-to, granted-by, since, a per-row `RevokeDialog` trigger. Finding 4
  (the arm-1 cascade gap) is surfaced via a `Badge` reading "Membership ended
  {date}" next to a person-arm grantee whose `membershipEnded` is non-null —
  not filtered, not fixed.
- `src/app/(org)/o/[slug]/admin/roles/grant-role-form.tsx` — `"use client"`.
  A radio toggle between a person and a group target (only the relevant
  native `<select>` visible at a time, per docs/ui-standards.md's Select &
  Combobox Patterns — no `Select`/`Command` primitive exists yet), a role
  `<select>` rendering exactly `options.roles.length` entries (no wildcard —
  finding 3), a submit button disabled with inline copy when the selected
  target kind's list is empty, and the zero-roles sentence when
  `options.roles.length === 0`. `escalation_denied`/`forbidden` surface via
  `toast.error(result.error)` verbatim.
- `src/app/(org)/o/[slug]/admin/roles/revoke-dialog.tsx` — `AlertDialog`
  modeled directly on `neutralize-dialog.tsx`. Confirmation title names both
  the grantee and the role ("Revoke Stated Clerk from Tobias Renwick?"), never
  a generic confirm. `self_lockout_blocked` (and any other denial) surfaces
  via `toast.error` with the server's own message.
- Five test files, one per new component (`page.test.tsx`,
  `roles-states.test.tsx`, `roles-list.test.tsx`, `grant-role-form.test.tsx`,
  `revoke-dialog.test.tsx`) — 45 tests total, mocked at the `@/lib/role-grants`
  and `./actions` boundaries, matching `directory/page.test.tsx`'s style. At
  minimum: flag-off renders before `listGrants()` is ever called; forbidden
  renders on `{ kind: "forbidden" }`; the grant form renders zero `<option>`s
  beyond `options.roles.length` (no "select all"); the empty-roles sentence
  renders when `options.roles.length === 0`; the arm-1 badge renders only when
  `membershipEnded !== null`; the self-lockout error surfaces via
  `toast.error`, verbatim.

## Files Modified

- `src/app/(org)/o/[slug]/org-states.tsx` — `OrgPortalStub` gains a
  `rolesEnabled: boolean` prop and an "Administration →" link, threaded
  through exactly the way `directoryEnabled` already is: gated on
  `org_portal.roles` alone, never on the viewer's own `role_grants.manage`
  grant — `/o/<slug>/admin/roles` stays the sole authority on the viewer's
  own permission.
- `src/app/(org)/o/[slug]/page.tsx` — reads `org_portal.roles` via
  `isFlagEnabled()` alongside the existing `org_portal.directory` read, passes
  `rolesEnabled` to `OrgPortalStub`.
- `src/app/(org)/o/[slug]/org-states.test.tsx` — existing `OrgPortalStub`
  tests updated to pass the new required `rolesEnabled` prop; new describe
  block covers the Administration link's on/off/both-links-independently
  cases.
- `scripts/seed-dev.sql` — one additive block (see "Fixture gap" below); the
  existing DECISION-066 authorization fixture block (permissions,
  `stated_clerk`, the three `role_grants` rows) is untouched, per the brief.
- `docs/testing.md` — added `clerk.fixture@example.invalid` to the Accounts
  table with a one-paragraph note on why it exists.

## Schema Changes

None.

## Audit Events

None — this commit adds no `db.insert/update/delete` calls; both mutations
route through the already-shipped `grantRoleAction`/`revokeRoleAction`
(commit 2), which already write `TENANT_ROLE_GRANTED`/`TENANT_ROLE_REVOKED`.

## The fixture gap (CLAUDE.md → Verify in a Browser) — resolved by adding a real login

Per the brief: neither existing platform user linked to an Alder Creek person
could actually sign in. `elder.fixture@example.invalid` (linked to Marguerite
Ashcombe) is deliberately password-less — its own header comment says so — and
no user was linked to Tobias Renwick, the one person holding `stated_clerk`.
The e2e Playwright roster (`e2e/support/users.ts`) doesn't reach Alder Creek
either; it only provisions `e2e-alpha`/`e2e-beta`/`e2e-gamma`/`e2e-presbytery`.

**Resolution taken: added a second, real, sign-in-capable platform user**
(`clerk.fixture@example.invalid`, id `e0000000-0000-0000-0000-0000000000f3`)
to `scripts/seed-dev.sql`, linked to Tobias Renwick
(`c0000000-0000-0000-0000-000000000002`). Unlike `elder.fixture`, it carries a
real bcrypt hash of the same shared fixture password documented in
`docs/testing.md` (`e2e-fixture-only-not-a-secret`), `is_active = true`, and
`two_factor_required` explicitly `false` (the `users` column default is
`true`, which would otherwise force a TOTP-enrolment detour before the roles
page was ever reachable). This is a lasting, additive fixture, not a
throwaway — it's now in `scripts/seed-dev.sql` for any future browser
verification of this surface. Applied to the dev database directly via
`psql` (same mechanism database-admin's commit 1 used, since `db:migrate`
doesn't apply past migration `0009` in this environment) and verified with a
`select` confirming the password hash, `is_active`, and the `people.user_id`
link.

**Chose this over the scratch/rolled-back alternative** because a permanent,
reusable login is more valuable to whichever agent (most likely qa, per the
Phase 3 design's "self-lockout guard exercised live through the UI" acceptance
criterion) needs to repeat this walkthrough later — a scratch grant would need
reconstructing from scratch every time.

## A second, unrelated fixture surprise found live: Alder Creek requires 2FA

Signing in as `clerk.fixture` first landed on `/totp`, not `/launch` →
`/o/alder-creek`. `organization_settings.require_two_factor = true` for Alder
Creek (pre-existing fixture data, not something this commit touches), combined
with the platform `auth.require_2fa` flag being enabled in this dev database,
forces 2FA for every Alder Creek sign-in — matching `computeEffectiveTwoFactor()`'s
documented behavior exactly, not a bug. **Handled as a temporary, rolled-back
scratch toggle**: set `organization_settings.require_two_factor = false` for
Alder Creek only, for the duration of the browser walkthrough, then restored
it to `true` afterward (verified by a `select` after restoration). Building
real TOTP enrolment for a new fixture user was judged out of scope for this
commit — `clerk.fixture` is deliberately *not* 2FA-required going forward
(`two_factor_required = false` on the user row itself), so this one-time org
policy interaction won't recur for this specific account on future sign-ins.

## A real defect found and fixed during the live walkthrough: the list did not refresh after a mutation

Per the brief's own instruction to "check whether the page needs
`router.refresh()` too by testing this live" — it does. `grantRoleAction`/
`revokeRoleAction` already call `revalidatePath()` server-side (commit 2), but
that only marks the route's cache stale; it does not re-render an
already-mounted client tree. Confirmed live: granting a role showed the
"Role granted." toast, but the table below stayed on its pre-grant snapshot
until a manual reload. **Fixed**: both `grant-role-form.tsx` and
`revoke-dialog.tsx` now call `router.refresh()` (from `next/navigation`) on
`{ ok: true }`, immediately after the success toast. Re-verified live after
the fix — grants and revocations now appear in the table without a manual
reload. All five component test files updated to mock `next/navigation`'s
`useRouter` (no prior precedent for this in the codebase; added a plain
`{ refresh: vi.fn() }` mock, asserted `router.refresh()` fires on the
`{ ok: true }` branch in both `grant-role-form.test.tsx` and
`revoke-dialog.test.tsx`).

## Real-browser verification actually performed (not assumed)

Playwright, headless Chromium, 360×800 viewport, against the real dev server
and real dev database (scratch script, not committed — `scratch/` is
gitignored and hard-blocked by the pre-commit hook per CLAUDE.md, deleted
after use). Signed in as `clerk.fixture@example.invalid`:

- **Sign-in → `/launch` → `/o/alder-creek`** (single-org fast path, no
  chooser) — confirmed.
- **Portal stub**: "Administration →" link present (flag on), correctly
  absent when the flag is off (unit-tested; not re-verified live since it's
  the same conditional already proven for `directoryEnabled`).
- **`/o/alder-creek/admin/roles`**: heading, "Who holds what" table (the four
  seeded grants: `member`→Active Membership group, `property_chair`→Tobias,
  `session_member`→Session group, `stated_clerk`→Tobias), "Grant a role" form
  below it. Layout intact at 360px — the table's own `overflow-x-auto`
  wrapper (from the generated `<Table>` primitive) scrolls horizontally
  rather than breaking the page.
- **Grant flow, person target**: granted Property Committee Chair to
  Marguerite Ashcombe — succeeded, toast, new row appeared after the
  `router.refresh()` fix, with `grantedByEmail` correctly showing
  `clerk.fixture@example.invalid` (not `—`, confirming the `granted_by`
  `users.id` FK is wired correctly end to end from the Server Action layer).
- **Grant flow, group target**: granted Property Committee Chair to the
  "Board of Deacons" derived group — succeeded, row showed the group name
  with a "(group)" marker.
- **Escalation-denied, constructed live**: Tobias's effective permission set
  (`role_grants.manage`, `roll.approve`, `directory.view`, via `stated_clerk`
  + `session_member` + `member`) turned out to be a superset of every
  *seeded* role's permissions at Alder Creek — there is no seeded role today
  he could legitimately be denied. Per the brief's own allowance
  ("construct the scenario"), temporarily inserted one scratch `app_roles`
  row (`scratch_overreach`, bound to `pastoral.notes.view`, a tier-3
  permission no seeded role carries) directly in the dev database, attempted
  the grant through the real UI, observed the exact server message rendered
  as a visible toast — **"You can't grant permissions you don't hold
  yourself: pastoral.notes.view."** — then deleted the scratch role and its
  `app_role_permissions` row afterward (verified gone).
- **Revoke confirmation copy**: opened the dialog for Tobias's own
  `stated_clerk` grant — title read exactly **"Revoke Stated Clerk from
  Tobias Renwick?"**, naming both, never "Are you sure?".
- **Self-lockout, live, not just unit-tested**: confirmed the revoke of
  Tobias's `stated_clerk` grant (the only holder at Alder Creek) — the
  dialog did not silently close; a visible toast read **"Revoking this would
  leave nobody able to grant or revoke roles at this organization. Contact
  support if you need to change this."** The grant remained in the table
  afterward (confirmed by re-reading the row), proving nothing was written.
- **Keyboard/focus**: tabbed through the page; the "Back to portal" link
  showed a visible, offset focus ring.

**Dev database left exactly as found**: the scratch role, the extra test
`role_grants` rows created by the walkthrough's grant flows, the temporarily
loosened 2FA policy, and the `org_portal.roles` flag (flipped on for testing)
were all reverted/deleted after verification — confirmed by re-querying the
same four original fixture grants, `require_two_factor = true`, and
`org_portal.roles.enabled = false` (its shipped default). The one intentional,
lasting change is `clerk.fixture`'s row in `scripts/seed-dev.sql` and the dev
database, added via the same idempotent `insert ... on conflict (id) do
nothing` pattern `elder.fixture` already uses.

## Implementer Notes

- Divergence from the brief: the brief's Build step 4 said RolesList's
  columns are "role name, grantee (person or group name), granted-by email,
  since (startsOn)" with a per-row Revoke button — built exactly as
  specified, plus an accessible `sr-only` header for the actions column
  (no visible label needed; the button's own "Revoke" text is the label).
- `roles/page.tsx`'s two-call sequence (`listGrants()` then, only on
  `{ kind: "ok" }`, `getGrantFormOptions()`) matches the brief's ordering
  exactly; a defensive `{ kind: "forbidden" }` branch on
  `getGrantFormOptions()`'s own result is unreachable in practice (both calls
  share the identical `hasRoleGrantsManage` gate) but handled rather than
  assumed, since the two are separate transactions.
- Used `cachedAuth()` in `page.tsx` (a Server Component), matching
  `directory/page.tsx` exactly — this is unrelated to commit 2's documented
  `auth()`-not-`cachedAuth()` divergence in `actions.ts`, which is a Server
  Action and a different rule (`cachedAuth()`'s own header: for Server
  Component render trees only).
- Did not touch `src/lib/role-grants.ts`, `admin/roles/actions.ts`, or the
  existing DECISION-066 fixture block in `scripts/seed-dev.sql`, per the
  brief.

## Verification

- `npm run typecheck` — clean.
- `npm run check` (all four tripwires, `check:brand-scope` specifically for
  the new `(org)/admin/layout.tsx`) — clean; dormant note for
  `(public)/site/[slug]/layout.tsx` unchanged (still doesn't exist).
- `npm run lint` — clean, zero warnings.
- `npm test` (the real CI command) — 1409 passed, 43 skipped, 0 failed (up
  from 1370/42 at commit 2's handoff — 39 new tests: 45 new across the five
  new roles-surface test files, minus a few shared assertions folded into
  existing describe blocks, plus 3 new `org-states.test.tsx` cases for the
  Administration link).
- `npm run build` — full production build, clean; `/o/[slug]/admin/roles`
  registered as a dynamic route (`ƒ`) alongside `/o/[slug]/directory`.
- Real-browser walkthrough — see above, actually performed against a running
  dev server and the real dev database, not assumed from passing unit tests.

## Handoff to qa (Phase 5)

All three P9 commits are complete. What a reviewer should click through: sign
in as `clerk.fixture@example.invalid` / `e2e-fixture-only-not-a-secret`
(docs/testing.md), flip `org_portal.roles` on, visit `/o/alder-creek` → click
"Administration →" → `/o/alder-creek/admin/roles`. New copy strings a fork's
branding pass should review: "Roles", "Who holds what", "Grant a role", the
three `roles-states.tsx` denial/error messages, and the revoke confirmation's
"Revoke {role} from {grantee}?" pattern — none reference PC(USA)-specific
polity language directly in this commit (unlike `stated_clerk` itself, which
is commit 1's fixture data). UX tradeoffs: no `Dialog`/`Select` primitive
(Phase 3 design, out of scope); the grant form is a single inline form rather
than a two-step wizard, matching the "narrowest CRUD" framing from Phase 1.
The self-lockout guard, the escalation-denied path, and the arm-1 cascade
badge are all real-Postgres-tested in `role-grants.test.ts` (commit 2) *and*
now confirmed live through the actual UI (this commit) — qa's Phase 5
auth-touching-e2e gate does not apply here (this feature doesn't touch
`src/auth.ts`/`(auth)`/`api/auth`/`lib/auth`, per the Phase 3 design's E2E
blast-radius note), but qa should still exercise the flows above with a real
signed-in session, not only the mocked component tests, given how much this
commit's own walkthrough surfaced (the `router.refresh()` gap) that no unit
test caught. `docs/product/functionality-map.md` and `docs/TODO.md` updates
are Phase 6 ship-time work (Rule 10/14), not this commit's.

*Recorded by ux-developer.*

---

# Phase 5 — Test Verification (qa)

## Verdict

**PASS**

## Summary

Independently re-ran everything rather than trusting the implementers'
recorded numbers: the real-Postgres suite (25/25, including both halves of
the corrected escalation model — a non-holder of `role_grants.manage`
blocked at the gate, and a genuine holder blocked at the subset check for a
permission they don't personally hold), a live 360px browser walkthrough
signed in as `clerk.fixture@example.invalid` (grant by person, grant by
group, the revoke dialog naming both grantee and role, a live self-lockout
block with the exact toast copy, a constructed escalation-denied case with a
scratch tier-3 role, the flag-off state, and the audit trail written
correctly for every successful mutation and skipped for the denied one),
`e2e/post-login-routing.spec.ts` (12/12, confirming zero regression to
DECISION-040's four-way miss response or the existing directory/portal
routes), and all mechanical gates (typecheck, all four tripwires, full
build, full test suite, `test-rls.sql` — 61 pass / 0 fail).

**Specifically re-derived, not assumed: the gate-bug fix from Phase 4
commit 2 is correct and complete.** Traced `grantRole`'s corrected order of
operations directly and confirmed the two-layer model actually closes the
vulnerability — a member with zero `role_grants.manage` cannot reach the
subset check at all now, regardless of what they'd otherwise qualify for by
permission-subset alone.

All temporary state created during the live walkthrough (scratch role
grants, the scratch tier-3 role, the flag toggle, the 2FA setting) was
restored and independently re-verified as restored; the `audit_events` rows
the walkthrough generated were deliberately left in place as genuine history
of real mutations against synthetic fixture data (audit is append-only by
design).

## Findings that don't rise to FAIL

- DECISION-062/066's text calling the arm-1 cascade gap "real and unfixed"
  is stale — already logged as a `docs/TODO.md` line by the implementer,
  needs a Phase 6 ruling: correct the decision text, or downgrade the TODO
  line to "closed, defensive code retained."
- A sub-3-second `router.refresh()` timing window observed only via
  automated polling, never via actual click-driven interaction — not a
  regression of the fix, noted for whenever e2e coverage lands on this
  route (already a named follow-up).

## Handoff

**Next: analyst (Phase 6).** Carry forward: every adversarial finding
independently re-verified against real Postgres and a real browser; the
gate-bug fix re-derived as correct, not merely trusted; the
DECISION-062/066 documentation-correction item awaiting a ruling;
`docs/product/functionality-map.md`, `docs/TODO.md` reconciliation, and a
`whats_new_entries` consideration (Rule 13 — this is tenant-staff-usable,
not internal tooling) all still outstanding as Phase 6 ship-time work.

*Recorded by the orchestrator from the read-only qa agent's report.*
