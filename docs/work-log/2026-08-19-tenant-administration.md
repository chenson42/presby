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
| 1 — Functional refinement | analyst | Pending | — | — |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |
