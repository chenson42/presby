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
