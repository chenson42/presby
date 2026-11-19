# Presbytery committees Increment 1 — committees — Work Log

> **Slug:** `2026-11-19-presbytery-committees-inc1`
> **Surface:** (org) — the presbytery's Committees & Commissions pages (`/o/<presbytery-slug>/admin/committees/...`), presbytery type only; the public committee directory's role titles; `/help`
> **Permission(s):** existing `groups.manage` (tier 1). No new key, no change to the founding-administrator bundle. Never `FEATURES.*`.
> **Flag(s):** none new. Rides the existing global `org_portal.committees` (on in production; the page goes live on the 0.63.0 deploy).
> **Estimated complexity:** large
> **Pipeline mode:** Full (schema change: migration 0090, which also holds Increment 2's commission tables)
> **Release:** 0.63.0 (`package.json` bump and `docs/release-notes/v0.63.md` after Phase 6 SHIP IT, through `/release-notes`)
> **Parent:** `docs/work-log/2026-11-19-presbytery-committees.md` (Phases 1 to 3: the analyst's brief and the orchestrator rulings Q1 to Q7, the architect's R1 to R6 and DECISION-352 to 356, and the one Phase 3 design for both increments). **Do not restate or summarize them here.**
> **Numbers (pre-assigned, Rule 16):** migration 0090 (applied in this increment; 0088 stays reserved for Learn 1b); DECISION-352 to 356 (architect), 357 to 359 used by Phase 3, 360 next; F456 to F458 (architect), F459 and F460 used by Phase 3, F461 next; dev port 3101 (`PW_PROD_PORT=3801` for the production hydration lane); e2e ids `00000000-0000-4090-8000-` (people), `-9000-` (roles), `-9001-` (organizations); dev-seed ids `b0900000-…`, `c0900000-…`, `d0900000-…`, `e0900000-…`; Neon branch `br-calm-rice-ax2zn9jw` (`pipeline/presbytery-committees`, endpoint ep-odd-hall-ax6wtzf0); worktree `../presby-committees`, branch `pipeline/presbytery-committees`
> **Source:** operator decisions A–G, 2026-11-17 (B: a committee is a group with a required / standing / ad hoc label plus dated roles); operator 2026-11-19: "start committees and take it to production"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent) | READY WITH NOTES | 2026-11-19 |
| 2 — Architectural review | architect | Complete (parent; R1–R6) | Approved with suggestions | 2026-11-19 |
| 3 — Technical design | tech-lead | Complete (parent; this log carries the increment slice below) | Design complete | 2026-11-19 |
| 4 — Implementation | database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

See the parent log. Recorded there verbatim; not copied.

# Phase 3 — Technical Design (tech-lead): the Increment 1 slice

The design is in the parent's Phase 3. Sections an implementer of this increment reads: "Design rulings" (T1 to T17), "Permissions & Flags", "Feasibility check", "Data Model" (**all of 0090, sections 0 to 7, including the commission tables Increment 2 will use**), "Commission member role vocabulary", "Module and file plan", "API Contract" (Increment 1 actions and the nine audit keys), "Component / Page Plan", "Implementation Order — Increment 1", "Deploy checklist", "Copy" C1 to C14, "Test plan", "Carry-forward", "Edge Cases & Risks".

**Scope.** Migration 0090 (the group-role CHECK, `committee_details`, `commission_records` and `commission_record_members`, their guards, RLS and grants, and the public committee roster fix-forward); `src/lib/group-roles.ts`; the additive `groups.ts` primitives and the presbytery exclusion; `role-grants.ts#readGroupRoleGrantsInTx`; `src/lib/committees/` (`contract`, `validate`, `copy`, `derive`, `store`, `reads`, `action-gate`, the boundaries and audit tests); `gateCommitteesPage`; the committee list, committee page, create and edit, add member, change role, end term and dissolve; the role titles on the public committee directory; the tile graduating out of "coming soon"; the groups admin's pointer at a presbytery; the `presbytery-committees` help page (replacing the `presbytery-tools` placeholder) and two help edits; the dev seed; the founding-administrator walk. **No commission pages** (Increment 2): 0090 creates the commission tables because it cannot be corrected after this increment ships (DECISION-298), and **nothing in this increment writes them**.

## Batches

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B1** | database-admin | `drizzle/0090_presby_committees.sql` (sections 0 to 7), `src/lib/db/domain/committees.ts`, the role CHECK in `src/lib/db/domain/groups.ts`, `committees.schema.test.ts` (D1), `committees.db.test.ts` (D2), `scripts/committees/test-rls-90.sql` (sections a to j), `test-0090-migration.sh` (D6), `seed-dev-committees.sql`, the five `*.integration.patch` files, the pins in the Feasibility check (the three public-roster DB tests and three RLS scripts run first). **Re-runs the Feasibility check first if `main` moved.** Applied to the pipeline Neon branch. | 0090 applied twice with identical digest; `test-rls-90.sql` and the patched `test-rls.sql` pass as `presby_app`; each mechanism proven failing-first; the three public-roster DB tests, `groups.test.ts` and `groups.primitives.db.test.ts` green; typecheck |
| **B2** | api-developer | `group-roles.ts`; the `groups.ts` additions and presbytery exclusion; `readGroupRoleGrantsInTx`; `committees/` `contract`, `validate`, `copy` (**Increment 1 strings from the parent's Copy section only**), `derive`, `store`, `reads`, `action-gate`; `gateCommitteesPage` and `gate.test.ts`; the nine audit keys and `audit.test.ts`; `sites.ts` and `committee-directory.tsx` label map and test; the `actions.ts` files; `boundaries.test.ts` (U5, with the downward-table and `admin/groups` rules from day one), `audit-coverage.test.ts` (U6), `store.db.test.ts` (D3), `reads.db.test.ts` (D4), `groups.committees.db.test.ts` (D5), U1 to U4, U7, U11 | `npm run check` zero; the DB files above; failing-first for the audit-in-transaction rollback, the atomic role change and the concurrency cases; the existing groups and worship suites green and **unmodified** |
| **B3** | ux-developer | the list, committee page, every form page and component, the three forms' tests (U8, U9, U10), the tile (`comingSoon` removed), the groups admin pointer and empty state, **the help page and the two help edits written from the screens at 360px**, registry, allowlist and pin (12 to 11). **First walk Community at a presbytery** and word the "person not yet recorded" paragraph from the screen. | typecheck, build, `check:hydration-gate`, `check:help`, a 360px walk of every page and state in a real browser, light and dark |
| **B4** | full-stack-developer | `e2e/support/committees-fixture.ts` (new file only), `committees-roster`, `committees-gates` and `hydration/committees-forms` specs, the `docs/deployment.md` "Pre-deploy runbook: 0090", then run the founding-administrator walk for real | own server on 3101 (`E2E_BASE_URL`); the new specs green; production hydration lane (`PW_PROD_PORT=3801`) green |

Order: B1 merges to the pipeline branch before B2 (B2 imports the Drizzle mirror); B2 before B3 (B3 imports `reads`, `copy`, `contract`); B4 starts when B3's pages exist.

## Gates (every batch)

- `npm run check` (all ten tripwires) reports zero violations; typecheck, lint and build pass; no native browser dialogs; no `console.log` in production paths; audit rows for every write (the in-transaction `insertAuditRow`, proven by D3).
- Every form root is inside `HydrationGate`; every page is walked at 360px in a real browser.
- Tests are written by the implementer; QA runs them and authors none.
- Never `git stash` in a worktree; never `pkill -f next`; every server started sets its own `E2E_BASE_URL` and is stopped by PID.
- Shared files (`domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/dev-docs.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/schema-design-2.md`, existing `e2e/support/*`) are **not edited mid-pipeline**: write `scripts/committees/*.integration.patch` files instead (the `scripts/oversight/` precedent).
- **Nothing in this pipeline writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`** (U5 pins it; test-rls-90 (i) and (j) pin the database side).
- A string that is not in the parent's Copy section stops for a ruling.

## Increment-specific notes

**Handoff.** Next agent: **database-admin** (B1), after the orchestrator records DECISION-357 to 359 and F459, F460 (and the architect's 352 to 356, F456 to F458). Read the parent's Phase 3 first.

- **Deploy order:** apply 0090 to an environment *before* the code that reads it (parent "Deploy checklist"). Record the deploy-day counts here: distinct `group_role` values, `public_listed` rows, and the committee-roster function's md5 before applying.
- **Operator actions:** none required (`org_portal.committees` is already on, so the page goes live with the deploy; rollback is the flag).
- **Phase 6 walks:** the founding-administrator path (the person the invitation path creates), a member with no key, Community at a presbytery, the public committee list, and the named help pages read as their reader.
- **Release notes:** the C14 lines through the `/release-notes` skill after SHIP IT, with the deploy-day `public_listed` count deciding the "nobody was listed yet" sentence. Also the functionality-map line (Rule 14), the TODO reconciliation (Rule 10) and the removal of `[help:presbytery-tools]` from TODO line 29 (parent, C12).

---

# Phase 4 — Implementation

Pending.

---

# Phase 5 — Verification (qa)

Pending.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
