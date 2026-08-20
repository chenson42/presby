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
| 4 — Implementation | database-admin, api-developer, ux-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
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
