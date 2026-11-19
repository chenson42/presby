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
| 4 — Implementation | database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4) | In progress: B1 complete; B2 next | — | 2026-11-19 |
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

## B1 — database-admin (2026-11-19)

Feasibility check re-run first: `origin/main` still `21fa4b68`; the live `presby_public_committee_roster` prosrc md5 on `br-calm-rice-ax2zn9jw` was `08030577cd5b93e3700dca822781811a` (the architect's value; the 0078 body); live `group_role` values `chair` (1), `member` (132). Deploy-day counts on the pipeline branch before apply: 2 distinct `group_role` values, 0 `public_listed` rows.

### Files Created

- `drizzle/0090_presby_committees.sql` — sections 0 to 7 as designed: guards (0045, 0078, the three FK target constraints, any `group_role` outside the seven, named in the error); `group_memberships_group_role_check`; `committee_details` + `presby_committee_details_guard`; `commission_records`, `commission_record_members`, the 0045 about-org trigger under `WHEN (new.about_org_id is not null)`, `presby_commission_guard_write`, `presby_commission_live_guard`; RLS (ENABLE + FORCE, organization-only `tenant_isolation`) and grants (presby_app SELECT + INSERT + column-limited UPDATE, no DELETE; presby_platform nothing); the `presby_public_committee_roster` fix-forward; comments; closing assertions. Does not name the founding-administrator bundle function anywhere, and does not touch `administrative_commissions`, `org_delegations`, `role_grants` or any `role_id`.
- `src/lib/db/domain/committees.ts` — Drizzle mirror of the three tables, plus `COMMITTEE_DETAIL_KINDS`, `COMMISSION_MEMBER_ROLES`, `COMMISSION_LIMITS` and `COMMITTEES_GUARD_CODES` (the CONSTRAINT name each guard refusal carries, for the store to map). The header names every mechanism the builder cannot express and the 0090 section that enforces it.
- `src/lib/db/domain/committees.schema.test.ts` — D1 (26 tests).
- `src/lib/db/domain/committees.db.test.ts` — D2 (28 tests).
- `scripts/committees/test-rls-90.sql` — sections (a) to (j), 120 assertions, run as presby_app.
- `scripts/committees/test-0090-migration.sh` — D6.
- `scripts/committees/seed-dev-committees.sql` — the pipeline-local dev seed (T16).
- `scripts/committees/_journal.json.integration.patch` (idx 90, tag `0090_presby_committees`, `when` 1793911500000, one day after 0089's), `domain-index.ts.integration.patch` (`export * from "./committees"`), `dev-docs.ts.integration.patch` (the three tables as `"W. Presbytery committees"`; `npm run docs:erd` after applying it), `seed-dev.sql.integration.patch` (one `\ir committees/seed-dev-committees.sql`), `test-rls.sql.integration.patch` (one `\ir committees/test-rls-90.sql`, plus the presbytery people and memberships counts at lines 225 and 228 bumped 3 to 19 for the seed's 16 people). Each was produced by `git diff` against the live file, which was then restored with `git checkout`. None of the Rule 16 shared files is modified on this branch.

### Files Modified

- `src/lib/db/domain/groups.ts` — `check("group_memberships_group_role_check", …)` mirrored on `groupMemberships`; the stale `// chair | leader | member` comment replaced with the seven-value note (DECISION-354).

### Schema Changes

- `group_memberships`: new CHECK `group_memberships_group_role_check` (`chair, leader, member, vice_chair, clerk, secretary, ex_officio`). No column change.
- New `committee_details` (1:1 with a managed committee group at a presbytery: `kind`, the dissolved trio, stamps); new `commission_records` and `commission_record_members` (no `role_id`, `group_id` or `public_listed` on either).
- `presby_public_committee_roster(text, text, boolean)` re-created with the same signature and projection; the body differs from 0078's only by the designed predicates (D6 diffs the two prosrc texts line by line).
- Applied via **hand-written migration** `drizzle/0090_presby_committees.sql`, not `db:push`/`db:generate`. Apply: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0090_presby_committees.sql` (owner, direct endpoint). Seed after it: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/committees/seed-dev-committees.sql`.
- **Idempotence proof, pipeline branch:** apply 1 and a whole-file apply 2, both exit 0. The catalog fingerprint (functions, constraints, policies, table and column ACLs, FORCE, triggers, indexes, comments) was `2eba1dc526606058337efb367e08fe9a` after both. Row counts (details/records/members/seats/admin commissions) were `0/0/0/133/1` before and after. The seed applied twice leaves identical counts. After every failing-first mutation below, the restore was a whole-file re-apply, and the fingerprint came back to the same value.
- `_journal.json` entry: in `scripts/committees/_journal.json.integration.patch` (Rule 16; the orchestrator applies it and sets the order against 0088).

### Audit Events

- None. A migration is provisioning (the 0071/0085/0089 precedent); B2's store audits every write in its own transaction.

### Gates

| Gate | Result |
|---|---|
| `test-rls-90.sql` as presby_app, pipeline branch | exit 0, 120 passes; same with `seed-dev-committees.sql` applied (it tolerates the seed) |
| Failing-first, `test-rls-90.sql` (break, run, restore by re-apply) | M1 FORCE off → 90a:246; M2 permissive policy → 90a:257; M3 details guard neutered → 90d:490 (42501 instead of `committee_details_target`); M4 commission write guard neutered → 90g:661; M5 live guard neutered → 90g:762; M6 about-org trigger without WHEN → 90a:280; M7 role CHECK dropped → 90a:286; M8 roster back to the 0078 body → 90h:825 (FutureStart listed, PlannedEnd hidden); M9 DELETE granted → 90b:318; M10 one-open index dropped → 90g:689; M11 extra UPDATE column → 90b:324; M12 commission role CHECK dropped → 90g:699. All restored; suite green again (120) |
| D1 `committees.schema.test.ts` | 26 passed; failing-first: the person index and the role CHECK removed from the mirror → 3 failed |
| D2 `committees.db.test.ts` | 28 passed; failing-first: write guard neutered → 4 failed; live guard → 3 (incl. the two-connection FOR SHARE race); roster back to 0078 → 1; details guard → 6. Fixture rows cleaned (0 `cmt90-*` orgs or users left) |
| The pinned public-roster and groups tests (`blob-audience.schema`, `public-roster-photo.db`, `storage/public-asset.db`, `groups.test`, `groups.primitives.db`) | 128 passed, **no fixture edits needed** |
| `scripts/giving/test-rls-46.sql` (46k), `scripts/parishes/test-rls-68.sql` (68e), `scripts/treasury/test-rls-73.sql` (73f) as presby_app | all exit 0 (266, 65, 62 passes), before and after the committees seed; also 72, 78, 85, 89 exit 0 |
| `scripts/test-rls.sql` as presby_app, pipeline branch | **halts at line 225, "presbytery: sees only its own members — expected 3, got 4": the known pre-existing drift, reported, not fixed.** A throwaway copy with only 225/228 adjusted then halts at line 6265 (`presby_submit_granted_return: grant not usable`): the long-lived branch's seeded statistics-submission grant expired 2026-11-06, and its freeze trigger refuses even an owner extension. That is a second pre-existing, time-based drift, unrelated to 0090. Both are absent on a fresh seed: see D6 step 5 |
| D6 `test-0090-migration.sh` on `scratch_0090` (pipeline branch compute; dropped afterwards) | **D6 PASS**, from empty: (1) before 0078, 0090 refused naming 0078, nothing left; (2) with 0045's function dropped in a rolled-back transaction, refused naming 0045; a seeded `'president'` role refused, named, nothing left; (3) apply 1, fingerprint `2eba1dc5…`, **the same as the pipeline branch's**; the roster body differs from 0078's by exactly one removed and nine added lines; (4) seed applied twice, whole-file apply 2 leaves the same fingerprint, rows and counts (6/2/5/135/38/1/46/49); (5) `test-rls-90.sql` 120 passes, and **the whole integrated `scripts/test-rls.sql` (both patches) exits 0**; (6) `drizzle-kit migrate` with the patch's idx-90 entry: 80 ledger entries, FP1 and rows unchanged |
| Directory-scanning tests (`dev-docs`, `officer-offices`, `membership-standing`, `onboarding/*`, the boundaries tests, `derived-group-guard.db`, `parishes.db` and 9 more; 21 files) | 626 passed, 1 failed: `dev-docs.test.ts` "sees the same tables in the exports as are declared in the schema files". **Expected until integration** (the worship and oversight precedent): `committees.ts` declares tables that `domain/index.ts` exports only once its patch lands. With `domain-index.ts` and `dev-docs.ts` patches applied the file is 15/15; reverted |
| Full unit suite, no DB credentials | 924 files passed, 161 skipped; 15,202 tests passed; 1 failed: the same expected `dev-docs.test.ts` |
| `git apply --check` of all five integration patches | all apply cleanly to the branch |
| `npm run typecheck`, eslint on the new files | clean |
| `npm run check` (all ten tripwires, new files staged so `check:secrets` sees them) | 10/10 passed |

### Implementer Notes

Deviations from the design (none touches an invariant):

1. **One extra index**: `commission_record_members_person_idx (person_id, organization_id)`, the person FK's column index (the B-L6 rule). Mirrored and pinned by D1.
2. **Constraint names the design left implicit**: `committee_details_dissolved_floor`, `commission_records_ended_minute_length` and `commission_record_members_starts_floor`.
3. **Frozen means no UPDATE at all.** A dissolved details row and a removed commission record refuse every UPDATE, including a no-op, as 0089's removal rule does. The design's wording was "any change".
4. **`commission_guard_insert_closed`** also refuses a tenant insert that carries `ended_minute_reference` (it is part of the end state; otherwise a tenant could insert an open record that still had an ending minute).
5. **test-rls-90 (h)** runs at Fernwood (a congregation with a live site), not a presbytery. presby_app holds no grant on `organization_sites`, so it cannot stand up a live presbytery site. Three items moved to D2, which runs as the owner at a throwaway presbytery with a live site: the dissolved-committee scenario, the commission member being absent, and the asset door for an unlisted member's photo. test-rls-90 (h) pins the commission absence structurally instead: the roster body reads group rows only.
6. **test-rls-90 (c), reimbursement**: `presby_reimbursement__is_seat` is owner-only, so it is exercised through its public caller. Tobias's Property Committee seat is cycled through six roles, a draft is submitted for each, and the route is `seat` exactly for chair and leader (`nobody` for the four titles).
7. **test-rls-90 (d)**: "the platform role reads none" is proven by `aclexplode` in (b), since presby_app cannot `SET ROLE presby_platform`. (e): naming another organization's group is refused first by the details guard (`committee_details_target`), because the guard checks the same pair the FK does. D2 proves the FK itself with the guard disabled inside a rolled-back transaction.
8. **test-rls-90 (i)**: at the presbytery, a plain member already holds the derived membership group's baseline keys. The assertion is therefore that a commission record adds nothing to an otherwise identical member, and that no source is `commission`. A sensitivity control is included: the same person, put on the dev commission's committee group, does gain keys at Alder Creek.
9. **The F362 source scan** is also in D1 ("never names the founding-administrator bundle function, not even in a comment"), in addition to B2's planned `contract.test.ts`.
10. **Seed accounts**: no seeded fixture account held `groups.manage` at the Northern Reach (checked on the branch), so both designed accounts are new. The ended presbytery membership uses `ended_reason = 'community_archived'` (Community's vocabulary).
11. **After integration on `development`**, lines 225 and 228 will read 20 against 19: the same +1 pre-existing drift, moved by the seed's 16 people.

Strings added or changed: none user-facing. The guards' exception messages are database text; the store maps refusals by CONSTRAINT name (`COMMITTEES_GUARD_CODES`) and never shows them.

**Handoff to B2 (api-developer).** Import the mirror directly from `@/lib/db/domain/committees` until integration (the `export *` is a patch).

- **Available now:**
  - `committee_details`: `kind`, the dissolved trio, stamps. 1:1 by `group_id`. Create the row lazily.
  - `commission_records` and `commission_record_members`: Increment 2's.
  - Seven-value `group_role`.
- **Guard refusals the store can see**: SQLSTATE 23514 with these CONSTRAINT names:
  - `committee_details_target`
  - `committee_details_insert_dissolved`
  - `committee_details_dissolved_final`
  - `commission_guard_insert_closed`
  - `commission_removal_final`
  - `commission_ended_final`
  - `commission_record_closed`
- **Refused on presby_app by the column grant** (42501): the immutable columns.
- **What the database does not enforce**: adding a member to a dissolved committee, committee-name uniqueness and seat interval overlap are the store's alone (R2.4, R5.3, R5.4).
- **Local apply**: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0090_presby_committees.sql`, then `scripts/committees/seed-dev-committees.sql`.
- **RLS sections**: `scripts/committees/test-rls-90.sql` (a) to (j) is new. `scripts/test-rls.sql` is touched only through the integration patch.

---

# Phase 5 — Verification (qa)

Pending.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
