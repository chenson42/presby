# Platform admin redesign, Increment 2: Organization tier — Work Log

> **Slug:** `2026-10-25-platform-admin-redesign-inc2`
> **Parent:** `2026-10-25-platform-admin-redesign` (Phase 1 and Phase 2 live there, verbatim; the Increment 1 child records the Phase 3 conventions every increment inherits)
> **Surface:** (admin)
> **Permission(s):** existing `FEATURES.ADMIN_*` keys only (no new key)
> **Flag(s):** none (operator: no new platform flags pre-live)
> **Estimated complexity:** TBD in Phase 3
> **Pipeline mode:** Full
> **Numbers:** DECISION-254; F277, F278, F279, F280; migration none (R3); dev port 3530.

**Status: PENDING. Created 2026-10-25 as a header only; Phase 3 for this increment has not been written.**

Scope as recorded at the parent: Workspace context bar and section routes under `/admin/organizations/[id]/**` (requireWorkspaceOrg, revalidateWorkspace), Overview and setup checklist, Features view with effective state (G12, pure resolver + parity test), per-organization health, `?org=` filters on tickets and domains (G11), `?from=` validator (G24), org-list badges, dashboard cards 1 and 2 (waiting for a first administrator, invitations; G14). Carries DECISION-254, F277-F280, R3 and R8.

Notes carried from Increment 1's design: Phase 3 must budget for e2e churn: `designation-revoke`, `admin-organizations`, `giving-admin` and `custom-domains/*` all drive the single detail page today.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | See parent (shared) | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | See parent (shared) | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 3 — Technical Design (tech-lead)

Pending. Use the Phase 3 section of `docs/work-log/_template.md`, plus the Copy four-check, Carry-forward and e2e blast-radius requirements in the tech-lead agent file. Re-run the feasibility check against the live tree first (Increment 1 will have merged).

# Phase 4 — Implementation

Pending.

# Phase 5 — Verification (qa)

Pending.

# Phase 6 — Shipped vs Intent (analyst)

Pending.
