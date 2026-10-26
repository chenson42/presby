# Developer portal, Increment 2: The developer role — Work Log

> **Slug:** `2026-10-25-developer-portal-inc2`
> **Parent:** `2026-10-25-developer-portal` (Phase 1 and Phase 2 live there, verbatim; the Increment 1 child, `2026-10-25-developer-portal-inc1`, records the Phase 3 conventions every increment inherits)
> **Surface:** (admin) `/developer`
> **Permission(s):** a new platform-axis key `developer.portal` declared in `src/lib/permissions.ts` OUTSIDE `FEATURES` and `FEATURE_CATALOG` (Phase 2 Ruling 1), bound to a new system role `developer`
> **Flag(s):** none (operator: no new platform flags pre-live)
> **Estimated complexity:** TBD in Phase 3
> **Pipeline mode:** Full
> **Numbers:** DECISION-259 (amends DECISION-044); F286, F287 (A1 is recorded under F287); no migration (0071 released, Ruling 6); dev port 3570; e2e person-id range `00000000-0000-4258-`. **Auth-touching by ruling (Ruling 3d): the MFA e2e gate applies, and the Phase 6 walk is as an MFA-enrolled developer.**

**Status: PENDING. Created 2026-10-25 as a header only; Phase 3 for this increment has not been written.**

Scope as recorded at the parent: `DEVELOPER_ROLE` and `DEVELOPER_PORTAL_KEY` constants; `readCanAccessDeveloper` in `src/lib/platform-admin.ts` (is_platform_admin OR a role bound to the key, read live, throws on error; `readIsPlatformAdmin` becomes module-private); the one-line swap inside Increment 1's `guard.ts` and the layout; `/launch` matrix (`isPlatformAdmin` renamed `canAccessDeveloper`, full truth table, Ruling 5); avatar menu and `/home` card prop rename and the card description; `scripts/seed.ts` (`seedRoles` adds `developer`, new `seedDeveloperCapability`, `bindAdminFeatures` untouched) and the `docs/deployment.md` pre-deploy runbook entry with its verification query; `assignRoleAction` records `roleName` and `selfTargeted`; one line of `/admin/users` copy; the DB-backed tests (admin-role user without the column or the role gets false, a revoke mid-session gets false, an injected error throws, the only `role_features` row for the key belongs to `developer`); the scan that `src/lib/authz.ts` and `src/lib/db/domain/**` never name the developer constants; e2e fixtures for a developer-role user (with and without MFA, zero organizations and one organization). The wording of the Increment 1 forbidden page ("Ask a platform administrator") becomes literally executable here.

**Notes carried from Increment 1's design:** (1) Increment 1's gate, layout and `schema.json` read the predicate at exactly two seams in `guard.ts` (`readEntitled`, `readEntitledUncached`) plus `cachedIsPlatformAdmin` in `src/lib/nav-data.ts`; Increment 2 swaps those, nothing else. (2) The Increment 1 `/home` card description is the interim text; Increment 3 sets the final one. (3) Increment 1 uses no person rows, so the `00000000-0000-4258-` range is entirely Increment 2's.

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

Pending. Use the Phase 3 section of `docs/work-log/_template.md`, plus the Copy four-check, Carry-forward and e2e blast-radius requirements in the tech-lead agent file. Re-run the feasibility check against the live tree first (the earlier increments will have merged). The Increment 1 child's Carry-forward table lists every Phase 1 gap, Phase 2 ruling and open question that names this increment; start from those rows.
