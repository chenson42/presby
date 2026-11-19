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
| 4 — Implementation | database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4) | Complete (B1 to B4; see the Phase 4 completion summary) | Ready for Phase 5 | 2026-11-19 |
| 5 — Verification | qa | Complete (run 1; G1, C1, R1 and copy rulings open) | PASS | 2026-11-19 |
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

## B2 — api-developer (2026-11-19)

Scope as the batch table: `group-roles.ts`; the additive `groups.ts` primitives and the presbytery exclusion; `readGroupRoleGrantsInTx`; the `committees/` module (`contract`, `validate`, `copy`, `derive`, `reads`, `store`, `action-gate`); `gateCommitteesPage`; the nine audit keys; the label map on the public committee directory; the two `actions.ts` files; and every test the batch table names. **No page, component, tile, help or Rule 16 shared file is touched.** B1's migration was not changed.

### Files Created

- `src/lib/group-roles.ts` (+ `group-roles.test.ts`): the seven-value vocabulary, the total label map, `GROUP_ADMIN_ROLES`, `COMMITTEE_ROLES` (display order), `SEAT_ROLES`, `TITLE_ONLY_ROLES`, `groupRoleSortRank`. No imports.
- `src/lib/committees/contract.ts`: flag and key constants, `COMMITTEE_KINDS`, `LIMITS`, `CHANGED_FIELDS`, the viewer/ctx/`Outcome`/`Refusal`/read/action-result types. Its only runtime import is `@/lib/group-roles`.
- `src/lib/committees/validate.ts`: `parseCommittee`, `parseSeat`, `parseChangeRole`, `parseEndSeat`, `parseDissolve` (each takes the form's string values and an injected `{ today }`) and the five thin zod wrappers (`committeeSchema()`, `seatSchema(env)`, `changeRoleSchema(env, seat?)`, `endSeatSchema(env, seat?)`, `dissolveSchema(env)`).
- `src/lib/committees/copy.ts`: Increment 1 strings only (C1, C3 to C9 as the module produces them: refusals, validator messages, the titles note, the carries note, warning and dissolve sentence, status badges, seat date lines, the end-control labels, toasts, the C1 page states).
- `src/lib/committees/derive.ts`: `classifySeat`, `seatsOverlap`, `orderSeats`, `splitRoster`, `chairNames`, `seatDatesText`, `groupCommittees`, `personStatus`, `addYears`, `compareNames`.
- `src/lib/committees/reads.ts`: `readCommitteeList`, `readCommittee`, `readCommitteeFormDefaults`, `readSeatFormOptions`, `readSeat`.
- `src/lib/committees/store.ts`: `createCommittee`, `updateCommittee`, `dissolveCommittee`, `addCommitteeSeat`, `changeCommitteeSeatRole`, `endCommitteeSeat`, `setCommitteeSeatPublicListed`. The only writer of `committee_details`.
- `src/lib/committees/action-gate.ts`: `resolveCommitteesActor`, `finish`, `invalidResult`, `tamperedResult`, `serverEnv`.
- `src/app/(org)/o/[slug]/admin/committees/new/actions.ts` and `[committeeId]/actions.ts`.
- Tests: `committees/{validate,derive,copy,contract,boundaries,audit-coverage,action-gate}.test.ts`, `committees/{store,reads,seat-semantics}.db.test.ts`, `admin/committees/actions.test.ts`, `src/lib/groups.committees.db.test.ts`.

### Files Modified

- `src/lib/groups.ts`: additive. `addManagedGroupSeatInTx(tx, org, { groupId, personId, groupRole, startsOn, endsOn? }, { allowedRoles, overlap: "open_row" | "caller" })` and `setManagedMembershipPublicListedInTx(tx, org, actingUserId, { groupMembershipId, publicListed })` are new exports (no permission check, no audit); the private roster-row helper gained two opt-in extras and its two existing callers are untouched; `setGroupMembershipPublicListed` now calls the InTx body with identical behaviour; `GroupRosterEntry.groupRole` widened to `GroupRoleValue` (type only). **The presbytery exclusion** is in the nine gated functions only: `listGroups` and `getGroup` filter in SQL, `getGroupFormOptions` omits the `committee` type, `createGroup` returns `invalid_input` with the C10 sentence, the other five return `invalid_target`. The `*InTx` primitives are not restricted.
- `src/lib/role-grants.ts`: `readGroupRoleGrantsInTx(tx, org, groupId, asOf)`, returning `{ carriedRoles: Array<{ id, name }> }`. No permission check, no audit.
- `src/lib/audit.ts`, `audit.test.ts`: the nine `tenant.committee.*` keys (an appended block with the metadata allowlist in a comment).
- `src/lib/presbytery-reports/contract.ts` (`COMMITTEES_FLAG`), `gate.ts` (`gateCommitteesPage` over the private core), `gate.test.ts` (8 cases, U7).
- `src/lib/sites.ts`: `PublicCommitteeRosterEntry.groupRole` and the row type take `GroupRoleValue`.
- `src/app/(public)/site/[slug]/committee-directory.tsx` (+ test): the label map is now `PUBLIC_ROLE_TITLES: Record<GroupRoleValue, string | undefined>` (Chair, Leader, Vice chair, Clerk, Secretary, Ex officio; Member renders none), exported so the test can fail on a missing value.
- `src/app/(org)/o/[slug]/admin/groups/group-type-labels.ts`: `GROUP_ROLE_LABELS` is a re-export of the total map (F458 closed); the form's offer set `GROUP_ROLES` is unchanged. Needed in B2 because widening `GroupRosterEntry.groupRole` otherwise breaks the groups roster page's typecheck.

### API contract (the next agent consumes this)

No route handler. Every mutation is a Server Action, a plain object of strings (never `FormData`), returning `CommitteesActionResult` (`{ ok: true, data?: { id, unchanged?, seatsEnded?, cancelled?, publicListed? } } | { ok: false, error, field?, kind? }`, a superset of `ActionResult<{ id: string }>`); `error` is always one fixed `copy.ts` string. The key everywhere is `groups.manage`, the flag `org_portal.committees`. Auth and gate on every action, in this order: `assertOrgSession(await auth())` (stale second factor gets the signed-out string), `resolveOrgContext(userId, slug)` (the organization and actor come from the slug and the session; `organizationId` is never a parameter), a UUID check on every id (`not_found` string before any SQL), the pure parse (invalid returns before a transaction opens), then the store, which re-checks key, organization type and committee in its own transaction and writes ONE audit row in the same transaction.

| Action (file) | Values | Audit key and metadata |
|---|---|---|
| `createCommitteeAction(slug, v)` (`new/actions.ts`) | `name, kind, purpose, meetsWhen` | `COMMITTEE_CREATED` `{ organizationId, committeeId, kind }` |
| `updateCommitteeAction(slug, v)` (`[committeeId]/actions.ts`) | `committeeId, name, kind, purpose, meetsWhen` | `COMMITTEE_UPDATED` `{ …, committeeId, changed }` and/or `COMMITTEE_LABELLED` `{ …, committeeId, kind, previousKind }`; nothing changed writes and audits nothing (`unchanged: true`) |
| `dissolveCommitteeAction(slug, v)` | `committeeId, dissolvedOn` | `COMMITTEE_DISSOLVED` `{ …, committeeId, dissolvedOn, seatsEnded, carriesRole }`; returns `data.seatsEnded` |
| `addCommitteeSeatAction(slug, v)` | `committeeId, personId, role, startsOn, endsOn` | `COMMITTEE_MEMBER_ADDED` `{ …, committeeId, membershipId, personId, role, startsOn, endsOn, grantsRole, roleIds? }` |
| `changeCommitteeSeatRoleAction(slug, v)` | `committeeId, membershipId, expectedRole, newRole, effectiveOn` | `COMMITTEE_MEMBER_ROLE_CHANGED` `{ …, committeeId, membershipId, newMembershipId, personId, fromRole, toRole, effectiveOn, grantsRole, publicListed }` (one row) |
| `endCommitteeSeatAction(slug, v)` | `committeeId, membershipId, endsOn` (empty is allowed for a seat that has not started) | `COMMITTEE_MEMBER_ENDED` `{ …, committeeId, membershipId, personId, role, endsOn, cancelled }`; returns `data.cancelled` |
| `setCommitteeSeatPublicListedAction(slug, v)` | `committeeId, membershipId, publicListed: boolean` | `COMMITTEE_MEMBER_LISTED` / `_UNLISTED` `{ …, committeeId, membershipId, personId }`; a non-boolean is refused as tampered |

Refusal kinds a form can read from `result.kind`: `unauthenticated`, `two_factor_required`, `forbidden`, `not_found`, `seat_not_found`, `invalid` (with `field`), `duplicate_name`, `overlap`, `not_a_member`, `committee_dissolved`, `already_dissolved`, `already_ended`, `same_role`, `date_before_start`, `stale`, `save_failed`. A client toasts `result.error` and puts an `invalid` message under `result.field`.

**Readers** (`reads.ts`, each its own transaction; the key and then the organization type are checked first, inside it): `readCommitteeList(viewer, { showDissolved? }, now?)` returns `{ today, committees: [{ id, name, meetsWhen, kind | null, dissolvedOn | null, chairNames[], servingCount }], dissolvedCount, showDissolved }` in five queries whatever the committee count; `readCommittee(viewer, committeeId)` returns `{ committee, seats[], carriedRoles[], today }` (each seat has `membershipId, personId, displayName, role, startsOn, endsOn, publicListed, connected, deceased`; split it with `splitRoster` from `derive.ts`); `readCommitteeFormDefaults(viewer, committeeId?)`; `readSeatFormOptions(viewer, committeeId)` (people with `alreadyServes`, `carriedRoles`); `readSeat(viewer, committeeId, membershipId)`. Each returns `{ kind: "ok", data } | { kind: "forbidden" } | { kind: "not_found" }`; the two form readers also return `{ kind: "committee_dissolved" }`. `viewer` is `{ personId, organizationId }` from the gate's identity.

**Page gate:** `gateCommitteesPage({ slug, path })` from `@/lib/presbytery-reports/gate` (signed in, `assertOrgSession`, the four-way org miss, `assertOrgAccess`, `org_portal.committees`, then presbytery type; returns `ReportPageGate` like its siblings). **Form validation:** the five `xSchema(env)` wrappers in `validate.ts` (inject the organization's local date from a reader's `today`); the form components pass the seat to `changeRoleSchema`/`endSeatSchema` so the form agrees with the store. **Strings:** everything the module produces is in `copy.ts`; B3's page chrome that is not there goes through the Copy section.

No seed, `FEATURES` or flag changes. No new dependency.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`) | clean |
| `npm run check` (all ten tripwires, new files staged) | 10/10 passed |
| New and changed unit tests (no database) | 305 passed across the 13 touched or new unit files (validate 27, derive 19, copy 15, contract 9, boundaries 35, audit-coverage 11, action-gate 10, actions 17, group-roles 8, gate 40 (+8), committee-directory 13 (+2), audit 20, page 9 unchanged) |
| New DB suites (serial, pipeline branch) | `groups.committees.db` 25, `store.db` 49, `reads.db` 18, `seat-semantics.db` 5: all green |
| Existing suites, **unmodified** | `groups.test.ts`, `groups.primitives.db.test.ts` and the `admin/groups` page and component tests: 17 files, 191 passed |
| `scripts/committees/test-rls-90.sql` as presby_app | green after B2 (it needs no change) |
| Full unit suite, no DB credentials (`npx vitest run`) | 933 files passed, 165 skipped, 1 failed; 15,363 tests passed, 4,433 skipped, 1 failed: `dev-docs.test.ts` "sees the same tables in the exports as are declared in the schema files", **the expected red until integration** (`committees.ts` declares tables that `domain/index.ts` exports only once B1's patch lands) |
| **Full serial suite, DB included** (`npm run test:db`, pipeline Neon branch, 8,082 s) | 1,099 files: 1,098 passed, 1 failed (the same `dev-docs.test.ts`); 19,797 tests: 19,795 passed, 1 failed, 1 skipped. No fixture rows left behind (0 organizations, users or people from the four new DB suites) |

**Failing-first.** Each mechanism was proven by a deliberate break (originals restored from a copy, verified byte-identical, no mutation text left in `src/`): the audit made best-effort (a swallowed insert failure) turned both sabotage cases red (2 failed: `fail_before` and `fail_after`); a one-day gap between the old seat's end and the new seat's start turned the three atomic-role-change tests red; removing the names lock and the seat lock turned the three concurrency tests red (two creates of one name, two adds of one person, a dissolve racing an add); removing the presbytery exclusion from `listGroups` and the group check turned three D5 tests red; reading "today" in UTC instead of the organization's zone turned the Kiritimati/Pago Pago test red; and in `boundaries.test.ts` a `roleGrants` name, a direct `tx.update(groupMemberships)` and a store write with its `gate` removed each turned their rule red on the real tree (3 failed). Every boundary rule also has a failing sample.

### Implementer Notes

Deviations from the design (none touches an invariant or a string):

1. **`seat_not_found` is a Refusal kind.** C9 has two `not_found` strings ("That committee could not be found." and "That member could not be found."); the second needs its own kind to be a `copy.ts` entry, and the two are pinned as the only strings that differ by object.
2. **`RefusalDetail.during: "edit"`** selects C4's sentence ("…kept as history and isn't edited here.") for an edit of a dissolved committee, and C5's for an add. Both strings are in the Copy section.
3. **Dissolved committee and seat actions.** Change role and end term on a seat of a dissolved committee answer `already_ended` (every such seat is ended), not `committee_dissolved`, whose string says "so no one can be added".
4. **Field-level rules that need the stored seat are `invalid` outcomes with a field** (change-role date before the seat's start or not before its planned end; end date before the start; dissolve date in the future), using the C6, C7, C8 strings as the Copy section words them. `date_before_start` is used only for dissolve ("A member started on {date}…"). The dissolve future-date rule is re-checked in the store against the organization's own day (the action's parse uses the server's UTC day, as designed).
5. **Two extra locks, same order.** `updateCommittee` takes the seat lock after the names lock (a rename racing a dissolve), and `setCommitteeSeatPublicListed` takes the seat lock (it must not interleave with a role change, which carries the listing). The order is always names then seats, so no cycle exists. Setting the listing to its current value is `unchanged` (no write, no audit), which the design did not say.
6. **Blank dates.** A blank "Effective on" has no Copy string and reads "That date isn't valid."; a blank end date parses to `null` (the cancel-planned-term path ignores the field) and the store refuses it for a seat that is serving.
7. **Reader query count is 5** (access key, organization type, organization zone, committees, grouped serving seats), not the design's three; the property pinned is that it is fixed for 2 and for 30 committees.
8. **Same-transaction audit rows share a `created_at`** (`now()` is the transaction's start), so a test or a future audit view must not order the two `updateCommittee` rows by time.
9. **Action values carry their ids** (`(slug, v)` with `committeeId` and `membershipId` inside `v`), as the API Contract table words it, not as separate arguments.
10. **`boundaries.test.ts` has one self-expiring exemption:** `admin/committees/page.tsx` is allowed to lack `gateCommitteesPage` only while its text still renders `ComingSoon`. B3 replaces that page; the exemption disappears with the placeholder and cannot hide a page that forgot the gate. The real-tree page rule is already enforced for every other page.
11. **`PUBLIC_ROLE_TITLES` is a new export of `committee-directory.tsx`**, and `copy.ts` imports the pure `formatDateUTC` (the one place a date inside a message is formatted outside JSX).

Strings: no string was added outside the Copy section. Two cross-checks the Copy section does not fully spell out and B3 should know: the add form's role helper, person helper and the empty-state text (C5) and the date fields' helper text (C5 to C8) are page chrome, not in `copy.ts`; B3 puts them where the oversight forms put theirs.

**Handoff to B3 (ux-developer).** Import `reads`, `copy`, `contract`, `derive`, `validate` as above; pages call `gateCommitteesPage` then `isUuid` on every id segment (404 before any read) then the readers with `Promise.all`; a reader's `forbidden` renders `CommitteesForbidden` (`PAGE_STATE.forbidden(name)`), `not_found` renders `notFound()`, a throw renders the section load error (`PAGE_STATE.sectionError` / `tryAgain`), and an `OrgAccessError` is rethrown. Replace the placeholder `admin/committees/page.tsx` and its `page.test.tsx` (the boundaries exemption then expires). Forms call the actions above and use the zod wrappers with the reader's `today`; each root needs `HydrationGate`. `splitRoster(seats, today)`, `seatDatesText(seat, today)`, `chairNames`, `groupCommittees` and `personStatus` are the derivations; `carriesNote`, `carriesWarning`, `TITLES_NOTE`, `STATUS_BADGE`, `END_CONTROL`, `seatDateLineText` are the strings. The public-listing switch is a copy of the groups admin's control with `setCommitteeSeatPublicListedAction` passed in as a prop (the committees tree imports nothing from `admin/groups/`). The `groups` admin pointer (C10) needs `resolved.org.organizationType`; the exclusion itself is already in `groups.ts`.

## B3 — ux-developer (2026-11-19)

Scope as the batch table: the list, committee page and every form page; the components, forms and dialogs; the three forms' tests (U8, U9, U10); the tile graduating; the groups admin pointer and empty state; the help page, its registry entry, allowlist and pin, and the three other help edits. Community at a presbytery was walked first and the "person not yet recorded" paragraph worded from the screen. No `loading.tsx` and no `route.ts` under `admin/committees/**`. No schema, server-module or Rule 16 shared file was touched (see the two non-design edits under Implementer Notes).

### Files Created

- Pages under `src/app/(org)/o/[slug]/admin/committees/`: `page.tsx` (replaces the `ComingSoon` placeholder; the boundaries exemption has expired with it), `new/page.tsx`, `[committeeId]/page.tsx`, `[committeeId]/edit/page.tsx`, `[committeeId]/members/new/page.tsx`, `[committeeId]/members/[membershipId]/role/page.tsx`, `committee-gate-state.tsx`. Each page: `gateCommitteesPage`, then `isUuid` on every id segment (404 before any read), then its reader; `forbidden` renders `CommitteesForbidden`, `not_found` is `notFound()`, a throw is the load error with "Try again", an `OrgAccessError` is rethrown. `?show` is read as the fixed enum `dissolved`.
- `src/components/committees/` (server unless marked): `committees-list`, `committees-section`, `committee-card`, `kind-badge`, `role-badge`, `roster` (+ `seat-card`, `seat-actions`, `seat-badges`, `seat-dates`), `carries-role-note`, `titles-note`, `committee-states` (forbidden, load error, section error, form-unavailable, guided empty), `back-link`, `form-page-frame`, `form-field`, `text-field`, `select-field`, `select-classes`; **client:** `committee-form`, `add-member-form`, `change-role-form` (the three `useForm` roots, each in `HydrationGate`, each with `useUnsavedChangesGuard`), `end-term-dialog`, `dissolve-dialog` (AlertDialog, plain controlled date input, no `useForm`), `public-listing-toggle` (a copy of the groups admin's control, the action passed in as a prop), `form-failure.ts` (field versus toast).
- `src/lib/committees/ui-copy.ts`: the page chrome (C2 to C8, C10), pure, one file, pinned by `ui-copy.test.ts`.
- `src/app/(org)/o/[slug]/admin/groups/committees-pointer.tsx`.
- `src/content/help/presbytery-committees.md` (published, text only, no screenshots).
- Tests: `committees/pages.test.tsx` (50, U8), `components/committees/committee-forms.test.tsx` (31, U9), `components/committees/committee-views.test.tsx` (11), `lib/committees/ui-copy.test.ts`.

### Files Modified

- `src/lib/org-portal/tiles.ts`: `comingSoon` removed, description "The presbytery's committees and who serves on them." (C11); `tiles.test.ts` gains a pin.
- `admin/groups/page.tsx`, `groups-list.tsx` (+ the two tests, additive): the one-line pointer and "No groups yet" at a presbytery only (`atPresbytery` from `resolved.org.organizationType`); a congregation's page is unchanged and the new test pins it.
- `src/lib/committees/copy.ts`: one new export, `seatDateLinePrefix` (the "Since", "Starts"... words a page puts before a `FormattedDate`); no string changed.
- Help: `registry.ts` (the `presbytery-tools` placeholder deleted, `presbytery-committees` published with `replaces: ["presbytery-tools"]`, `covers: ["tile:committees"]`, `verifiedIn: "0.62.0"` for the release commit to set), `slug-history.ts`, `coverage-allowlist.ts` (`tile:committees` removed, "11 entries", the covering page named), `coverage.test.ts` (pin 12 to 11, `tile:committees` leaves the still-listed array); `roles-who-can-do-what.md`, `why-cant-i-see-this.md` (labels gain "Committees & Commissions" and "Congregation Oversight") and `privacy-policy.md` as C13 words them.
- `docs/product/functionality-map.md`: one sentence appended to the portal-IA bullet (see Implementer Notes 8).
- Deleted: `admin/committees/page.test.tsx` (the placeholder's test).

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`) | clean |
| `npm run check` (all ten, new files staged) | 10/10 passed, including `check:hydration-gate` (the three new roots) and `check:help` ("Help check passed", 34 entries, 31 published) |
| `npm run build` | passes |
| New unit tests | 93 across the four new files; the committees boundaries test (35, with the placeholder exemption expired) and every help, tile and groups test green |
| Full unit suite, no DB credentials | 936 files passed, 165 skipped, 1 failed: `dev-docs.test.ts` "sees the same tables in the exports as are declared in the schema files", **the expected red until integration** (B1/B2's note) |
| DB, serial, pipeline branch | `reads.db`, `store.db`, `groups.committees.db`: 92 passed (B3 changed no server module; this is the regression run) |
| Tap targets | measured in a real browser at 360px on every page and dialog: nothing of this feature is under 44px. The only sub-44px elements are the platform shell's "PresbyPortal" and "Back to portal" links and sonner's close button (not this feature's) |
| No horizontal scroll at 360px | `scrollWidth == clientWidth` on every page, a 200-character committee name (list, committee page, end dialog) included |

No failing-first mutation runs for B3: it is presentation over B2's proven server layer. One test did fail before the code was right and found a real defect: the "Change role for {name}" link read "Change rolefor {name}" to a screen reader because the sr-only suffix carried its own leading space; the space now lives in the parent (also fixed on the end control).

### Browser walk (own server on port 3101, `E2E_BASE_URL` set, stopped by PID 31942 and its wrapper 31925; Chromium, invented data only)

360px, light, unless stated. Signed in as `committees.clerk@example.invalid` (`groups.manage` only) and the dev seed's other accounts.

| State | Result |
|---|---|
| List | five sections in order, the unlabelled prompt, "Show dissolved committees (1)", cards below `sm` and the table at desktop; dissolved shown with "Dissolved {date}" |
| Empty list | walked at the fixture presbytery `e2e-presbytery` (a temporary role holding only `groups.manage`, removed afterwards): "No committees yet", the body and "Create your first committee" |
| Create | the C4 errors on the fields; a duplicate ("committee on ministry") refused under the name field with the stored spelling, values kept; a 200-character name created |
| Edit | "Edit {name}", values loaded, kind changed, saved |
| Add member | errors; 20 options; a person already serving disabled "(already serves)"; added as chair; a later start shows under "Starting later" |
| Change role | "Now Chair, since {date}."; the empty select refused with "Choose a different role."; changed to Clerk; the old chair row is in Past members "Ended the day it started" |
| End term | a date before the start refused in the dialog under the field; ended with a planned end; "Change end date" dialog title; "Cancel planned term" dialog without a date field |
| Public listing | the consent dialog opens on the switch with the groups admin's text (not confirmed, to leave no public listing) |
| Dissolve | dialog text, date capped at today; dissolved; the page shows the dissolved note and no write control; edit and add pages for it show the C4 and C5 sentences |
| Add member, no one selectable | walked at `e2e-presbytery` after adding everyone: the guided empty state naming Community and Features |
| Denied | `committees.plain@example.invalid`: the C1 permission sentence naming the presbytery, on the list and on `/new` |
| Flag off | `org_portal.committees` flipped off and back: "Committees & Commissions isn't turned on for {name} yet." |
| Wrong org type | `org1@presby.invalid` at a congregation: the not-available sentence; that user at the presbytery gets the org denial |
| 404s | a non-UUID, an unknown UUID and a bad seat segment: 404 |
| Groups admin at a presbytery | (with `org_portal.groups` temporarily on) the pointer line, "No groups yet", no "Committee" in the type select, and the old committee-type group's id is a 404; a congregation's groups page unchanged |
| Portal | the tile sits under "Governance & Courts" with no "Coming soon" pill (Communications keeps its own) |
| Dark | list, committee page and an end dialog: badges, borders and the destructive button legible |
| Desktop 1280px | list, committee page, new and add forms |

Community at a presbytery (walked with `people.manage` and the global `org_portal.members_create` flag and the organization's toggle temporarily on, restored after): the Community page is "Member management isn't turned on for {name} yet." with a "How features are turned on" link until both are on. With them on, "Add person" opens a six-step wizard whose fifth step, "How is this person connected?", offers "Visitor" and, for someone who can propose roll actions, "Participant" and "Member"; a person who can only manage people is offered Visitor alone. That is the help paragraph's wording.

### Implementer Notes

Deviations from the design:

1. **`ui-copy.ts` is new.** The design had no file for the page chrome; B2 pointed it to "where the oversight forms put theirs". One pure file, so the copy has one place, pinned byte for byte by `ui-copy.test.ts`.
2. **One string outside the Copy section, for a ruling:** the empty first option of the change-role "New role" select reads "Choose a different role" (C6 has only the error "Choose a different role." and gives no placeholder). The alternative, preselecting the first role, risks a wrong change. Add form: the Role select has no placeholder, Member is preselected (C5 gives none and the groups form does the same).
3. **The help page could not say "Cancel planned term" or "planned end".** `check:help` H8 bans "planned" in prose even inside a quoted label, so the design's draft failed (its "banned phrases: none" line was wrong). The label left the registry `labels`, and the page says "a term with an end date already set shows 'Change end date' instead, and a term that has not started yet has a button that cancels it". The button itself still reads "Cancel planned term" (C3). If the ruling is to keep the label in the help, H8 needs an exemption for labels (tech-lead).
4. **The Community paragraph (†) is from the screen, not the draft:** "Add person", the step "How is this person connected?", "Visitor", or "Participant" only for someone able to propose roll actions; and "If 'Community' says it isn't turned on" instead of "is off". The draft said "as a participant or visitor".
5. **Contact line:** `[Contact the team](/help/contact)`, the sibling pages' form, instead of `{{contactAdmin}}`.
6. **Two other test pins moved by the placeholder's redirect** (a published page that `replaces` a planned slug adds `/help/planned/<slug>` to `helpRedirects()`): `src/lib/help/next-config-wiring.test.ts` and `src/lib/giving/csp.test.ts` list the redirects exactly. Neither was in the design's pin list.
7. **`slug-history.ts` appended** (H3 requires every published slug).
8. **`docs/product/functionality-map.md` edited** (one sentence): `check:help` H15 fails without a `/help/presbytery-committees` mention, so the Rule 14 line could not wait for ship time. The orchestrator can rewrite it at integration.
9. **Both layouts rendered.** The roster and the list render a card list (`sm:hidden`) and a table (`hidden sm:block`); CSS shows one, so the hidden one is out of the tab order and the accessibility tree. Ids and accessible names are made unique by an `idPrefix`. A test that counts controls sees each one twice for that reason.
10. **The dialogs use a plain `Button` for the confirm, not `AlertDialogAction`,** so the dialog stays open and shows the error under the date field on a refusal.
11. **A planned seat's change-role subtitle** reads "{Role}. Starts {date}." (the C6 "Now {Role}, since {date}." would say "since" a future date).
12. **The edit and add pages for a dissolved committee link "Back to committees"** (the list), since the reader returns no committee name in that case.
13. **Walk residue on the pipeline Neon branch:** "Walk Test Committee" (dissolved) with a few seats at the Northern Reach, and "Solo Committee" with the three people of `e2e-presbytery` seated. The temporary roles, grants and toggles used to walk were removed or restored (`org_portal.committees` true, `org_portal.groups` false, `org_portal.members_create` false and its toggle off). B4's fixtures use their own organizations.

**TODO edit for the orchestrator (not made here).** `check:help` passes with `[help:presbytery-tools]` still on `docs/TODO.md` line 29 (H12 passes a token no entry uses), so nothing blocks. At integration, still remove that token from line 29, as the design's C12 rules, then `grep -n "\[help:" docs/TODO.md`.

Strings added: none beyond the Copy section, except the one in note 2. New copy a fork's branding pass should review: none brand-specific.

**Handoff to B4 (full-stack-developer).** The pages and forms are real. Selectors worth pinning in the specs: fields by label ("Committee name", "Kind", "Person", "Role", "Starts on", "Ends on (optional)", "New role", "Effective on"); the dialogs are `alertdialog` with "Ends on" and "Dissolved on"; the roster controls are named "Change role for {name}" and "End term for {name}" (duplicated: a card and a table row, one hidden by CSS, so scope with `:visible` or a viewport); the carries note has `data-testid="carries-role-note"`; the toggle's switch name is "List {name} publicly on {committee}'s public roster, currently on|off". `reads.today` is the organization's local day. Not in the unit tests and left for the e2e: the production-lane hydration spec and the audit rows.

## B4 — full-stack-developer (2026-11-19)

Scope as the batch table: the e2e fixture (a new file only), the roster and gates specs, the hydration spec for both lanes, the `docs/deployment.md` "Pre-deploy runbook: 0090", the founding-administrator walk, and the regression of the specs that touch the same surfaces. No source file under `src/`, no migration and no Rule 16 shared file was touched, and **no defect was found in B1 to B3's code** (every failure while writing the specs was the spec's own: a column that does not exist, a strict-mode locator, an animation-time measurement; all recorded below).

### Files Created

- `e2e/support/committees-fixture.ts`: **a new file; nothing under `e2e/support/` was edited** (Rule 16). Throwaway presbytery A (no committee at the start, so the guided empty state is real) with a managed and an unmanaged member congregation, a `choir` group and the derived Active Membership group for the wrong-kind 404s, a congregation's `committee` group, and a second presbytery B with one real committee. Accounts: `founder` (Corwin Peabody, minted through the real definer `presby_apply_founding_administrator`, MFA enrolled, no other grant), `clerk` (a custom role holding only `groups.manage`, no MFA), `plain` (a presbytery member with no role) and `congClerk` (`groups.manage` at the managed congregation). Eight people without accounts for the rosters: five ordinary, one with a 120-character name (`Bartholomew` plus a 108-character unbroken last name), one whose presbytery membership has ended and one recorded as deceased. Ids: people `00000000-0000-4090-8000-`, roles `-9000-`, organizations `-9001-` (unique per run). Seeding helpers (`seedCommittee`, `seedSeat`, `bindRoleToCommittee`, `retireSeatablePeople`, `makePresbyterySiteLive`), readers (`seatsOf`, `committeeByName`, `committeesAudit`, `publicRoster`) and browser helpers (`signedInContext`, `smallControls`, `expectNoSidewaysScroll`; `newPhonePage`, `noSidewaysScroll` and `waitHydrated` re-exported from the worship fixture). Teardown is the owner delete of the congregations then the presbyteries, which cascades the committees and seats (B1's D2 pins it), plus the fixture's live-site rows, people and users; the sweep takes any `e2e-cmt*-<digits>` council a crashed run left. Verified after the runs: 0 `e2e-cmt%` organizations, 0 fixture users, 0 fixture people.
- `e2e/committees-roster.spec.ts` (16 tests, serial). Founder: portal tile with the C11 description and no "Coming soon" pill; the guided empty state; create (both required fields refused on their fields; a created committee shows kind, purpose, meeting time; a duplicate in any case or spacing is refused under the name field naming the stored spelling, values kept, nothing written); add members (the two required fields, an end on or before the start refused on its field, a person already serving is a disabled "(already serves)" option, a later start under "Starting later"); **change role** (the current role is not offered, an empty choice refused, the database shows two rows with the old `ends_on` equal to the new `starts_on` and the new one open, one `member_role_changed` audit row, the old row in Past members); end term, change end date and **cancel planned term** each through its own dialog (a date before the start refused in the dialog, "Go back" writes nothing, a `page.on("dialog")` listener proves no native dialog opened, three `member_ended` rows); the two status badges ("No longer connected to this presbytery", "Recorded as deceased"); the **carries-role note** on the page, in the end dialog and as the add-form warning; the **public listing switch** (the consent dialog, cancel writes nothing, an audit row, and `presby_public_committee_roster` then returns the member with the title Chair, and nothing after switching off); dissolve (a future date refused under the field, every seat ended on the day, the dissolved note, no write control, the add and edit pages' one sentence, "Show dissolved committees (n)" and back); the list's section order and the unlabelled prompt, and an edit that labels an unlabelled committee. The **clerk** (no two-factor key) creates a committee and adds a member and is never sent to `/totp`, the audit row names the clerk's user. The **keyless member** gets the one C1 sentence on the list, `/new`, a committee and `/members/new`, sees no committee, member or form, and a direct hit writes nothing (seat rows and audit count unchanged). **One answer for eight misses**: a non-UUID, another presbytery's committee, a choir, a derived group, a congregation's committee group, a nonexistent id, and two deeper pages all return 404 with one identical body that names none of the objects; a seat of another committee under this committee's role path is also 404. **Every audit row** carries only ids, roles and dates: eight action keys all present, and none of the three free-text sentinels, the committee names, any person's name or the actors' names appears in any row. **360px**: a 200-character committee name and a 120-character person name on the list, the committee page, edit, add and role pages and the open end dialog, with no sideways scroll, every control at least 44px, no `callbackUrl` or `next` parameter in any link, a "Back to committees" link, and role and dates visible on the card (the roster never hides them). **1280px**: the table with Name, Role, Dates and Actions.
- `e2e/committees-gates.spec.ts` (5 tests, serial; sets `org_portal.committees` and `org_portal.groups`). The flag off: every page (list, new, committee, add) says "Committees & Commissions isn't turned on for {name} yet." and shows no committee and no form, and the tile is not a live link; a congregation's `/admin/committees` and `/new` give the not-available sentence, and that congregation-only person at the presbytery's path gets the org denial and nothing about committees; the groups admin at a presbytery shows the pointer (its link goes to Committees & Commissions), lists the choir, offers no "Committee" type in `#new-group-type`; a committee id typed into `/admin/groups/<id>` and `/edit` is 404, and the unlabelled committee appears under Committees as "Not yet labelled"; **the congregation's groups admin is unchanged** (no pointer, "Committee" still offered, its own committee group's page still 200).
- `e2e/hydration/committees-forms.spec.ts` (3 tests): scripts held, load at `domcontentloaded`, every control inside the gate disabled, release, wait for the gate to open, pick non-default values, and assert the **persisted row**. The new-committee form (name, an Ad hoc kind, purpose, meets), the add-member form (person, Secretary, a start ten days back, an end 200 days ahead) and the change-role form (Clerk); the design named two forms and the third `useForm` root is covered too.

### Files Modified

- `docs/deployment.md`: a new section "Presbytery committees (0090)" with "Pre-deploy runbook: 0090, then the code" after the 0089 section (see below). Nothing else.
- `docs/work-log/2026-11-19-presbytery-committees-inc1.md`: this section, the completion summary, the status row.

### The runbook (`docs/deployment.md`, "Pre-deploy runbook: 0090, then the code")

Shaped like 0089's: order (counts, snapshot `production`, apply with `-1`, apply again, verify, then merge and deploy in the same sitting, 0090 before the code); the read-only counts (distinct `group_role` values, with the stop condition if any value is outside the seven, `public_listed` rows with the release-note consequence if not 0, the md5 of the live roster body against `08030577cd5b93e3700dca822781811a` with a stop if it differs, the two prerequisite functions, and the F456/F459 `aclexplode` read for the orchestrator to record); the Neon snapshot `pre-migration-0090-<date>`; the apply as owner on the direct endpoint with `-1`; the second apply; the catalog verification (3 forced tables, 3 policies, 0 DELETE or TRUNCATE for `presby_app` and `presby_platform`, 0 grants to `presby_platform`, the role CHECK validated, the three tables empty, the roster body is the new one and still `SECURITY DEFINER`); merge and deploy; the operator's step (the page goes live with the deploy, the rollback is switching `org_portal.committees` off, confirm `org_portal.groups`); development after merge (the five integration patches, the apply, the seed, `test-rls-90.sql` standalone, `test-rls.sql`); the founding-administrator walk on the deployed environment; and the rollback (a forward migration, never an edit). It records that 0090 has no founding-administrator-bundle step (the F362 hazard that 0085 and 0089 carry does not apply), no backfill notice and no audit row. **Every read-only query in it was run against the pipeline branch and returned what the text says.** The md5 constant was recomputed independently from the function body in `drizzle/0078_presby_person_photos.sql` and matches the architect's value. The section's header says "Not yet applied to production"; the orchestrator fills the production counts and date at apply.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`) | clean (the new e2e files are type-checked) |
| `npm run check` (new files staged so `check:secrets` sees them) | exit 0, all ten tripwires |
| New specs, own dev server on **3101** (`E2E_BASE_URL=http://localhost:3101`, `E2E_ALLOW_SHARED_DB=true`) | `committees-roster` **16/16**, `committees-gates` **5/5**, `hydration/committees-forms` **3/3**: **24 passed** in one run (2.7 min) |
| Production hydration lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3801`, `--project=prod-build`, no `E2E_BASE_URL`; Playwright ran `npm run build && npm run start -- --port 3801` and stopped it) | `hydration/committees-forms` **3/3** passed (55.6 s including the build) |
| Regression, same server: `presbytery-dashboard`, `portal-footer-sitemap`, `portal-home-cards`, `presbytery-credentials`, `presbytery-oversight`, `role-boundaries`, `visitor-access`, `oversight-founder` | **60 passed**, 0 failed (the Insights tile assertions, the portal footer and the presbytery pages are unaffected by the tile graduating) |
| Failing-first (do the new specs fail when the thing they guard breaks?) | two source mutations, both reverted by `git checkout --` (no stash): the add-member form's `<HydrationGate>` removed, so the hydration add-member test failed on `aria-busy`; `CarriesRoleNote` made to render nothing when it has text, so spec 7 failed on the note. Both specs red, both files restored, clean `git status` |
| Unit tests touched | none (no `src/` change). The one expected red, `dev-docs.test.ts`, is B1's and unchanged |
| Rule 16 shared files edited | none. `scripts/ci/e2e-baseline-flags.sql` unchanged: `org_portal.committees` (true) and `org_portal.groups` (false) are already rows in `e2e-reset-flags.sql` and the seed, and each spec captures and restores what it sets (verified: after the runs `org_portal.committees` is true and `org_portal.groups` false, as before) |
| Servers | the dev server was PID 43420 (started by this batch, stopped by that PID); the production server was Playwright's own and is gone; nothing was started or touched on :3000; nothing listens on 3101 or 3801 |

### The founding-administrator walk

**Run as a script, in a real Chromium at 360px, as the person the definer creates.** `committees-roster` tests 1 to 10 and 14 to 16 are the walk: the founder is minted by `presby_apply_founding_administrator` (the call the invitation path and the platform operator's designation both make), signs in with a password and answers the real `/totp` challenge, holds no grant beyond the minted bundle (asserted: `groups.manage` is in the bundle and the clerk's custom role is not among her grants), opens Committees & Commissions from the portal tile, and does every Increment 1 action the page offers. It passed with no extra grant, so the bundle is enough. **What this is not:** the walk the design assigns to Phase 6 (a real invitation on `development`, at 360px, light and dark, read against the help page). That needs the deployed environment and was out of this batch's reach (it works only on the pipeline's own Neon branch). The walk through the real invitation UI is unchanged and still Phase 6's.

### Implementer Notes

Deviations from the design (none touches an invariant):

1. **The fixture has a fourth account, `congClerk`** (`groups.manage` at the managed congregation), which the design listed only for Increment 2 ("a congregation administrator"). The gates spec needs a congregation-side person to prove the not-available sentence and that the congregation's groups admin is unchanged. It is not the administrator bundle: **B7 still adds the congregation administrator** for the byte-identical denial at a commission record.
2. **The hydration spec covers three forms, not two** (the change-role form too), so all three Increment 1 `useForm` roots have a held-chunks test.
3. **Some seats are seeded by the owner** (Casey from 2020, Devon and Emery from 2024, the status-badge and listing seats) where the test is about what follows, not about the add form (the add form itself is driven through the page in spec 3 and by the clerk in spec 11). The public-listing test seeds a live public site for the presbytery as the owner because `presby_app` has no grant on `organization_sites`; the row is removed with the fixture.
4. **The end dialog's tap targets are measured by layout size** (`offsetHeight`), not a bounding box: a dialog opens with a 95 percent scale animation, and a box taken mid-animation read 41.95px for a 44px button. Nothing is under 44px.
5. **The "carries-role" and "public listing" cases use committees seeded by the owner**; the committee made through the page carries no role, and spec 2 and spec 3 assert that no note renders for it.
6. **Fixture bug found and fixed on the first run:** `group_memberships` has no `created_at`; the seat ordering uses `starts_on, ends_on nulls last, id`.
7. **`e2e/support/committees-fixture.ts` sweeps and removes only `e2e-cmt*` organizations, `e2e-cmt-*@presby.invalid` users and `00000000-0000-4090-8000-*` people.** It does not touch the B3 walk residue on the pipeline branch (a dissolved "Walk Test Committee" and "Solo Committee" at the Northern Reach, noted in B3's note 13), which stays.
8. **The public committee directory page is not browser-tested here**, as the design rules (DB and unit tests; no flag needed). The e2e reads the same definer the page calls and asserts what it returns.
9. **Dark mode, and the real invitation path, are Phase 6's.**

Strings added: none. New copy a fork's branding pass should review: none.

**Handoff.** Next agent: **qa** (Phase 5). See the Phase 4 completion summary below for what to run.

## Phase 4 completion summary (Increment 1)

| Batch | Implementer | Commit | Delivered |
|---|---|---|---|
| B1 | database-admin | `cfa90b7f` | migration 0090 (both increments' schema), the Drizzle mirror, D1, D2, `test-rls-90.sql` (120 assertions), D6, the dev seed, the five integration patches |
| B2 | api-developer | `996d41a3` | `group-roles.ts`, the `groups.ts` additions and presbytery exclusion, `src/lib/committees/` (contract, validate, copy, derive, store, reads, action-gate), `gateCommitteesPage`, nine audit keys, the actions, the boundaries and audit-coverage tests, D3 to D5 |
| B3 | ux-developer | `530012d4` | every page, form and dialog, the tile, the groups admin pointer, the help page and edits, 93 component and page tests, the 360px browser walk |
| B4 | full-stack-developer | (this commit) | the e2e fixture and three specs (24 tests), both hydration lanes, the 0090 runbook, the regression of 60 related e2e tests |

**What exists and is tested:** the schema (applied to the pipeline Neon branch only), the server layer, the pages, the help page, the e2e specs and the runbook. **Commission pages (Increment 2) are not built**; 0090 holds their tables and nothing in this increment writes them.

**Gates at the end of Phase 4:** `npx tsc --noEmit`, `npm run lint` and `npm run check` (ten tripwires) clean; `npm run build` passes (B3, and the production lane's build in B4); the committees unit tests pass; the DB suites (D1 to D5) pass on the pipeline branch (B1 to B3's records); `test-rls-90.sql` exits 0 (120 assertions) and the whole integrated `test-rls.sql` exits 0 from empty (D6, B1's record); e2e: 24 new specs green on the dev lane, 3 on the production hydration lane, 60 regression. **The one expected red** in the full unit suite is `dev-docs.test.ts` "sees the same tables in the exports as are declared in the schema files": it turns green when the orchestrator applies `scripts/committees/domain-index.ts.integration.patch` and `dev-docs.ts.integration.patch`.

**Open for the orchestrator at integration (not done here; Rule 16):**
1. Apply the five integration patches under `scripts/committees/` (`domain-index.ts`, `_journal.json`, `dev-docs.ts`, `seed-dev.sql`, `test-rls.sql`), then `npm run docs:erd`; re-run `test-rls.sql` as `presby_app` against merged `development`.
2. Record DECISION-357 to 359 and F459, F460 (and 352 to 356, F456 to F458), the CLAUDE.md layout lines, and the TODO line for F456 and F459 with the production grant read the runbook asks for.
3. Remove `[help:presbytery-tools]` from `docs/TODO.md` line 29 (B3's note), then `grep -n "\[help:" docs/TODO.md`; `verifiedIn: "0.62.0"` on the new help page is for the release commit to set; rewrite the functionality-map sentence B3 appended if wanted (Rule 14).
4. A ruling for tech-lead: B3's note 3 (the banned "planned" in help labels, H8) and note 2 (the one string outside Copy, "Choose a different role").
5. The deploy: the runbook in `docs/deployment.md` (0090 before the code).

**For Phase 5 (qa), what to run.** Everything on the pipeline's own server and branch: `npm run check`; `npx tsc --noEmit`; `npm run lint`; the unit suite (expect only `dev-docs.test.ts` red); the DB suites serially (`npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/committees.db.test.ts src/lib/db/domain/committees.schema.test.ts src/lib/committees/store.db.test.ts src/lib/committees/reads.db.test.ts src/lib/committees/seat-semantics.db.test.ts src/lib/groups.committees.db.test.ts`); `scripts/committees/test-rls-90.sql` as `presby_app`; `scripts/committees/test-0090-migration.sh` (needs a scratch database); then, with your own server on its own port and `E2E_BASE_URL` set and `E2E_ALLOW_SHARED_DB=true`: `npx playwright test e2e/committees-roster.spec.ts e2e/committees-gates.spec.ts e2e/hydration/committees-forms.spec.ts`; and the production hydration lane: `PW_PROD_BUILD=1 PW_PROD_PORT=3801 npx playwright test --project=prod-build e2e/hydration/committees-forms.spec.ts` (no `E2E_BASE_URL`). Phase 5's copy-truthfulness check covers the help diff (`presbytery-committees`, `roles-who-can-do-what`, `why-cant-i-see-this`, `privacy-policy`) and the runbook's claims; the 360px check is already in the specs. **Phase 6 walks** (the real invitation path on `development`, dark mode, the public committee list, the named help pages read as their reader) are the analyst's, per the Deploy checklist.

---

# Phase 5 — Verification (qa)
I ran everything the orchestrator listed. The verdict is **PASS**. Four findings follow; none is a defect in what ships, but two need a tech-lead ruling and one needs a read on production before the deploy.

# Phase 5 — Verification (qa)

**Date:** 2026-11-19
**Verified by:** qa
**Tree:** worktree `/Users/cshenso/git/presby-platform/presby-committees`, branch `pipeline/presbytery-committees`, HEAD `1fadad5f` (the integration commit). `git status` was clean at the start and at the end. I wrote no files to the repository.
**Database:** the pipeline Neon branch `br-calm-rice-ax2zn9jw` (endpoint ep-odd-hall-ax6wtzf0). I checked environment variables by length only and printed none.

## Scope run

- **In full:**
  - `npm run typecheck`, `npm run lint`, `npm run check` (ten tripwires).
  - The unit suite, with no database credentials.
  - `npm run build`.
- **Database-backed, run serially:**
  - The six committees files from the Phase 4 paragraph.
  - Eleven neighbouring files: the three public-roster pins, `groups.test`, `groups.primitives.db`, `dev-docs.test`, `worship/store.db`, `reimbursement/config.db`, `db/domain/reimbursement.db`, `role-grants.test`, `sites.test`.
- **Not re-run:**
  - The whole database-backed set rests on B2's full serial run: 1,098 of 1,099 files. Its one red, `dev-docs.test.ts`, is green now that the patches are integrated.
  - Nothing after B2 changed a server module or a database test.
- **RLS:**
  - `test-rls-90.sql` as `presby_app`.
  - The whole `scripts/test-rls.sql` as `presby_app` on the branch.
  - D6 (`test-0090-migration.sh`) from empty on a scratch database. I created `scratch_0090qa` on the pipeline branch's compute and dropped it afterwards; it is confirmed gone.
- **e2e:**
  - Before the runs I reset the branch's global flags to the CI baseline (`scripts/ci/e2e-reset-flags.sql`, 38 flags set to their seed values). This switched `org_portal.admin_hub` and `org_portal.features` from on to off, which differs from what B3's walk saw.
  - Server: my own dev server on 3101, started with the env the orchestrator gave. It was PID 53589, with children 53608 and 53609, and I stopped it by those PIDs.
  - Specs: the three new ones, plus 15 blast-radius specs. I did not run the full chromium suite: the only `e2e/support/` change is a new file that only the new specs import, and no layout, proxy, auth or shared component changed.
  - Then the production hydration lane on 3801. Nothing touched :3000, and nothing listens on 3101 or 3801 afterwards.
  - After the runs: `org_portal.committees` is on, `org_portal.groups` is off. No `e2e-cmt*` organizations, fixture users or `4090` fixture people are left behind.

## Type Check

`npm run typecheck`: **PASS**. `npm run lint` (`--max-warnings=0`): **PASS**. `npm run check`: **PASS**, all ten tripwires (Help check: 34 entries, 31 published, 7 images). `npm run build`: **PASS**, with six committees routes in the route table.

## Unit Tests

- **Without database credentials:**
  - 937 files passed, 165 skipped. The skipped files are the database-backed ones, skipped without credentials and covered by the serial runs below.
  - 15,458 tests passed, 4,433 skipped, 0 failed, in 41.7 s.
  - `dev-docs.test.ts`, the one expected red in Phase 4, is green after integration.
- **Committees database suites, serial:**
  - Files: `committees.db`, `committees.schema`, `store.db`, `reads.db`, `seat-semantics.db`, `groups.committees.db`.
  - 6 of 6 files, **151 of 151 tests passed, 0 skipped**, in 322 s.
  - The count matches Phase 4's per-file totals (26 + 28 + 49 + 18 + 5 + 25).
- **Neighbouring database suites, serial:** 11 of 11 files, **347 of 347 tests passed**, in 552 s.
- **Coverage:**
  - `permissions.ts`, `flags.ts`, `committees/contract.ts` and `group-roles.ts` are at 100%.
  - `two-factor.ts` is at 91.1% statements.
  - The committees pure files are at 98.95% statements, 93.8% branches.

Failures: none.

## End-to-End Tests

| Run | Result |
|---|---|
| New specs, dev lane, own server on 3101 (`committees-roster` 16, `committees-gates` 5, `hydration/committees-forms` 3) | **24 passed**, 0 failed, 0 skipped, 0 retries (2.7 min) |
| Blast radius, same server: `presbytery-dashboard`, `portal-footer-sitemap`, `portal-home-cards`, `presbytery-credentials`, `presbytery-oversight`, `oversight-founder`, `presbytery-reports`, `role-boundaries`, `visitor-access`, `help`, `help-gates`, `help-404`, `reimbursement-role-bundle`, `reimbursement-treasurer-ui`, `parishes` | **157 passed**, 0 failed, 0 skipped (9.5 min) |
| Production hydration lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3801`, `--project=prod-build`, no `E2E_BASE_URL`; it builds and starts its own server) | **3 passed** (51 s) |

**Not an auth-touching diff.** Nothing under `src/auth.ts`, `src/proxy.ts`, `(auth)`, `api/auth` or `lib/auth` changed, so the stricter gate does not apply. Even so, roster test 1 signs the MFA-enrolled founder in through the real `/totp` challenge.

**My own 360px walk** (Chromium, 360×740, as `committees.clerk@example.invalid` on the dev seed's Northern Reach):
- Pages: the portal, the list, the list with `?show=dissolved`, six committee pages, edit, add member, change role, and the open dissolve and end dialogs (closed without confirming).
- No page scrolls sideways.
- 27 of the 31 help `labels` were on screen. The other four only appear in other states:
  - "Create your first committee" (the empty list) and "Create committee" (the new form) are shown on screen by roster tests 1 and 2 in this run.
  - "Features" (no one available to add) and "Try again" (a load error) are proven only by component tests: `pages.test.tsx:322` and `pages.test.tsx:161`. B3's own browser walk saw the empty state.
- Dark mode is Phase 6's.

## Schema/RLS Audit (live catalog, pipeline branch)

- **Isolation:**
  - All three new tables are `relrowsecurity` and `relforcerowsecurity` true.
  - Each has one `tenant_isolation` policy: `ALL`, permissive, `organization_id = presby_current_org()` for both USING and WITH CHECK.
- **Table grants (`aclexplode`):**
  - `presby_app` holds SELECT and INSERT only on all three.
  - It holds no DELETE or TRUNCATE.
  - `presby_platform` and PUBLIC hold nothing.
- **Column grants:** UPDATE only on the designed columns: `committee_details` 6, `commission_records` 13, `commission_record_members` 5.
- **Triggers:**
  - Five triggers, all enabled, running four functions: the three new SECURITY INVOKER guards and 0045's `presby_check_about_org_affiliated`.
  - The about-org trigger carries its `WHEN` clause.
- **Role CHECK:** `group_memberships_group_role_check` is validated and holds the seven values.
- **Fingerprint:** the branch's catalog fingerprint is `2eba1dc526606058337efb367e08fe9a`, identical to D6's from-empty apply 1, apply 2 and runner apply.
- **Public roster function:** SECURITY DEFINER. The body adds start, end, active membership, death, merge and dissolved predicates to 0078's.
- **Which layer refuses each claimed protection:** `test-rls-90.sql` proves each one on `presby_app`, 120 passes. B1's failing-first record attributes each refusal to its layer: FORCE, policy, details guard, write guard, live guard, WHEN, CHECK, roster body, grant, index (M1 to M12). I did not re-run those mutations (see Regression Tests).
- **Shared-file drift F456 and F459, re-confirmed:**
  - `presby_app` and `presby_platform` hold DELETE on `administrative_commissions`, `org_delegations`, `groups` and `group_memberships`.
  - This is tracked in the integration commit's TODO lines and not changed by 0090.

**`scripts/test-rls.sql` on the branch** halts at two places. Both are pre-existing and unrelated to 0090:

1. **Line 232 (the old 225): "expected 19, got 20".**
   - The presbytery's memberships are 3 rows with the stock `c0000000` prefix, 1 with the oversight `c0890000` prefix, and 16 with the committees `c0900000` prefix.
   - The extra row has a stock-seed prefix: the untracked third presbytery membership the file's own comment and `docs/TODO.md:295` describe. The committees seed added exactly the 16 the patch counts for.
2. **Line 6272: "presby_submit_granted_return: grant not usable".**
   - I re-ran the file from stdin with only the two counts set to 20. It then halts here after 487 passes.
   - The only unsubmitted, unrevoked `statistics_submission_grants` row expired on 2026-11-06. That is time-based drift, recorded in `docs/TODO.md:295`, on a table 0090 does not touch.

**D6 from empty: PASS.**
- 0090 is refused without 0078 and without 0045, and refused when a role outside the seven exists.
- Applied twice, the catalog fingerprint and the rows are identical.
- `test-rls-90.sql` gives 120 passes.
- **The whole integrated `scripts/test-rls.sql` exits 0**, section 90 included.
- The `drizzle-kit migrate` runner path gives the same fingerprint.

`test-rls-90.sql` on the branch exits 0 with 120 passes.

## Regression Tests Added

I am read-only, so I did not re-run the catalog and source mutations. Failing-first rests on the implementers' records: B1 M1 to M12 and D1/D2 sabotage; B2's audit, atomic-change, lock, exclusion and time-zone sabotage; B4's two hydration and carries sabotages. Where a test sabotages its own mechanism every run, I confirmed it exists and passed in this run.

- **Audit is written in the same transaction:**
  - `src/lib/committees/store.db.test.ts:855` sabotages the audit write in-test.
  - `store.db.test.ts:894` is the non-vacuity control.
  - Guards against the audit becoming best-effort.
- **Atomic role change, no gap and no double:**
  - `store.db.test.ts:570`, `:599`, `:613`.
  - `:613` makes a failure after both writes leave neither.
- **Listing carried to the new row:** `store.db.test.ts:681`.
- **Concurrency:**
  - `store.db.test.ts:927` (two creates of one name), `:937` (two adds of one person).
  - `:949` (a dissolve racing an add), `:965` (a role change racing an end term).
- **One `not_found` answer:** `store.db.test.ts:422`, and e2e `committees-roster.spec.ts:537`.
- **The organization's local day:** `reads.db.test.ts:272` (Kiritimati against Pago Pago). **A fixed number of queries:** `reads.db.test.ts:307`.
- **Presbytery exclusion in groups:**
  - All nine gated functions: `groups.committees.db.test.ts:152` to `:253`.
  - The primitives stay unrestricted: `:263`.
- **The four titles carry no authority:** `seat-semantics.db.test.ts:101`.
- **Public roster's seven scenarios and column list:** `committees.db.test.ts:596`, and `test-rls-90` (h).
- **Live guard waits, then refuses:** `committees.db.test.ts:547`.
- **No grant drift on the new tables:** `committees.db.test.ts:670`.
- **Every role has a public title:** `committee-directory.test.tsx:170` fails on a missing role title.
- **No "Last day" or "the day before" in date copy:** `copy.test.ts:160`.
- **Source rules:** `boundaries.test.ts:410` runs a failing sample for every rule.
- **Hydration on both lanes:** `e2e/hydration/committees-forms.spec.ts:77`, `:99`, `:121`.
- **Not pinned, observation only:**
  - B2's two extra locks have no dedicated race test: rename against dissolve in `updateCommittee`, and listing against role change in `setCommitteeSeatPublicListed`.
  - They are additions beyond the design, so this is not a gap against the design.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (unchanged by this diff)
- `src/lib/two-factor.ts`: 91.1% statements (unchanged by this diff)
- `src/lib/flags.ts`: 100% (unchanged by this diff)
- `src/lib/committees/` pure files: contract 100%, derive 100%, validate 100%, copy 95.5%, ui-copy 96.2% statements. `src/lib/group-roles.ts`: 100%.

## Feature-Gate Audit

I verified this by reading each page and action body. The key is the tenant permission `groups.manage`, checked by `holdsPermissions` (`presby_has_permission`) inside the reader's or the store's own `withOrgContext` transaction. It is never a `FEATURES.*` key. No `route.ts` and no `loading.tsx` exist under `admin/committees/**`.

| Route or action | Signed in + second factor | Organization from the slug | Flag `org_portal.committees` | Presbytery type | `groups.manage` |
|---|---|---|---|---|---|
| `/o/[slug]/admin/committees` (`page.tsx:33`), `/new`, `/[committeeId]`, `/edit`, `/members/new`, `/members/[membershipId]/role` | yes: `gateCommitteesPage` (`cachedAuth` + `assertOrgSession`) | yes: `resolveOrgContext` + `assertOrgAccess` | **yes**, in the gate before the type check (`gate.ts:134`) | yes, in the gate, and again in the reader's transaction (`reads.ts:150`) | yes, in the reader's transaction (`reads.ts:244`); `isUuid` on every id segment runs before any read |
| `createCommitteeAction` (`new/actions.ts:16`) | yes: `resolveCommitteesActor` (`auth()` + `assertOrgSession`) | yes | **no** | yes, `store.ts:172` `gate()` in the transaction | yes, `store.ts:173` |
| `updateCommitteeAction` (`[committeeId]/actions.ts:46`), `dissolveCommitteeAction` (`:59`), `addCommitteeSeatAction` (`:76`), `changeCommitteeSeatRoleAction` (`:89`), `endCommitteeSeatAction` (`:111`), `setCommitteeSeatPublicListedAction` (`:128`) | yes | yes; UUID check on every id | **no** | yes, all seven store writers call `gate(tx)` | yes |
| `/admin/groups` at a presbytery (nine gated `groups.ts` functions) | unchanged | unchanged | `org_portal.groups`, unchanged | the exclusion applies after the key (`groups.committees.db.test.ts:253`) | unchanged |
| Public committee directory (anonymous SECURITY DEFINER read) | n/a | n/a | `sites.public_committee_directory`, unchanged | n/a | n/a (opt-in per seat) |

**Finding G1, for tech-lead: the actions do not check `org_portal.committees`.**
- What the code does: pages check flag, then type, then key. Actions and readers check type and key inside their transaction, but no action checks the flag.
- Why it is not a FAIL:
  - It is not an authorization gap. Every action checks the session, the second factor, the organization, the type and the key.
  - It matches the design's own API Contract "common body", which lists no flag.
  - It matches the repo: 43 of the 50 `(org)` `actions.ts` files check no flag.
  - `docs/TODO.md:368` already holds the same open project-wide decision for Community.
- Where it contradicts the design:
  - Phase 3 Permissions & Flags (parent log line 652) says "Order, on every page, reader and action: flag, then organization type, then `groups.manage`".
  - Phase 2's placement says `action-gate.ts` "checks flag, then org type, then permission".
  - Phase 3's rollback sentence says that with the flag off "a presbytery's committees cannot be edited at all". That is true of the UI only: a `groups.manage` holder can still call a Server Action directly while the flag is off.
- The runbook's wording ("hides every page", `docs/deployment.md:1846`) is accurate.
- Tech-lead should either rule that the flag stays page-only (and correct line 652 and the rollback sentence), or add it to `resolveCommitteesActor`.

## Copy Truthfulness

- [x] **Every added or changed string is in the design's Copy table**, except these. All of them are truthful; they are recorded for a ruling, not as defects:
  - `src/lib/committees/ui-copy.ts:100` "Choose a different role": the empty option of the "New role" select. B3 note 2 asked for a ruling; none is recorded in the integration commit or `docs/decisions.md`.
  - `ui-copy.ts:54`: the roster table headings "Name", "Role", "Dates", "Actions". These are not in C3; only the list's headings are in C2. B3 did not flag them.
  - "Saving…": the pending label, the house pattern already used in `admin/groups/public-listing-toggle.tsx:146`. Acceptable.
  - B3 note 3 is also unruled: H8 bans "planned", so "Cancel planned term" is not among the help `labels`. The help paraphrases it truthfully at `presbytery-committees.md:39`.
  - Viewer for all of these: `groups.manage` holders.
- [x] **I opened the query behind each claim.**
  - **Public website section of the help:** the 0090 roster body checks start, end, `m.ended_on is null`, `date_of_death`, `merged_into_id` and dissolved. It reads `current_date` (UTC), and the help says so.
  - **"Each shows its chair, how many people serve now":** `readCommitteeList` against the organization's local day.
  - **"Two active committees cannot have the same name, ignoring capital letters":** the store's trimmed, case-insensitive check among non-dissolved committees. It is application-only, stated as a refusal, not a guarantee.
  - **"The people you can choose are the presbytery's own records":** `readSeatFormOptions`, which reads `memberships.ended_on is null` at the presbytery. Visitors are membership rows (0066).
  - **"No longer connected" and "Recorded as deceased":** `memberships.ended_on` at this presbytery, and `people.date_of_death`.
  - **The quoted permission description** matches the live `permissions` row exactly. `groups.manage` is in the presbytery founding-administrator bundle (live function), with `requires_two_factor = f`.
  - **"Committees & Commissions" and "Congregation Oversight" are switched on platform-wide:** both are global `feature_flags` rows.
  - **Privacy bullet:** a person appears only when `public_listed` is set.
- [ ] **Each instruction traced to a role that can do it: unproven against production (finding C1).**
  - **Which instructions:**
    - "create a role that includes it under 'Roles'" (`presbytery-committees.md:7`).
    - The Community, "Add person" and "Features" path (`:21`), and its twin in the add-member empty state (C5, `ui-copy.ts` `ADD.emptyBody`).
  - **What they need:** the global flags `org_portal.roles`, `org_portal.members_create` and `org_portal.features` / `org_portal.admin_hub` to be on. All four are off on the pipeline branch at the CI baseline, so on this branch the instructions are not doable. Production state for these four is not recorded anywhere I could find.
  - **Why it is not a FAIL:** the published neighbours `adding-people.md:6`, `first-day-as-administrator.md:31` and `:57`, and `roles-who-can-do-what.md` (the oversight paragraph) already rely on the same flags.
  - **The gap:** the runbook's operator step (`docs/deployment.md:1846`) confirms only `org_portal.groups`, the same gap the careers Phase 6 found (`docs/TODO.md:99`, `:394`).
  - **Before the deploy:** the orchestrator reads these four flags on production (read-only). If any is off, the help and the empty-state wording are false for a presbytery's founding administrator.
- [x] **Older strings grepped; none is made false.**
  - The `presbytery-tools` placeholder and its "There is no committees-and-commissions module" are deleted, and `/help/planned/presbytery-tools` answers 308 to `/help/presbytery-committees`.
  - The tile description and the coming-soon pill are gone.
  - `coverage-allowlist.ts` lost `tile:committees` (11 entries).
  - `first-day-as-administrator.md:34` ("Groups": committees…) is congregation-scoped, so still true. `what-presbyportal-does.md:11` is still true.
  - `[help:presbytery-tools]` is gone from `docs/TODO.md`.
- [x] **Help diff covered.**
  - Labels on screen: as listed in the 360px walk under End-to-End Tests.
  - Claims walked: at 360px on the dev server against the shipped screens.
  - Images: none committed; the help is text only, as designed, and I confirmed `src/content/help/images/` gained nothing.
- **Runbook truthfulness (`docs/deployment.md`, 0090 section), finding R1, minor:**
  - **Point 2:** every read-only query in it ran on the branch and returned what the text says. Two values differ from the production values the text quotes, as expected on a dev branch: six `group_role` values and 1 `public_listed` row.
  - **Line 1802, "three guard functions behind five triggers":** the five triggers run four functions (three new, plus 0045's about-org function).
  - **Point 6 (`:1836`, `:1839`):** it checks DELETE, TRUNCATE and `presby_platform` grants through `information_schema.role_table_grants`, not `aclexplode`. Both agree here (0), because it runs as the owner who granted them, but `aclexplode`, which point 2 already uses, is the authoritative source.
  - **Point 9:** it tells the orchestrator to "apply the five integration patches" on `development` after merge. They are already applied in `1fadad5f`; after merge, applying them again would fail. It should read "apply 0090, then the seed".

## Verdict

**PASS.**
- Every required check is green: typecheck, lint, ten tripwires, unit, the database suites in scope, `test-rls-90`, D6 including the whole integrated `test-rls.sql` from empty, e2e on both lanes with blast radius, build, 360px, the live-catalog RLS audit, and the gate audit.
- The `test-rls.sql` halts on the branch are pre-existing, with evidence above.

Before Phase 6 closes or the deploy happens:
1. **G1:** tech-lead rules on the flag in actions, and corrects the parent log's line 652 or the code.
2. **C1:** the orchestrator reads `org_portal.roles`, `org_portal.members_create`, `org_portal.features` and `org_portal.admin_hub` on production, and the runbook's operator step names them.
3. **Copy:** tech-lead rules on B3 notes 2 and 3 and on the roster table headings.
4. **R1:** fix the runbook wording (four functions, `aclexplode`, point 9).

None of these is a defect in the shipped behaviour. The implementer has no failing test to fix.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (unit 15,458/0 failed; DB 151 + 347/0; test-rls-90 120; D6 PASS incl. whole test-rls.sql; e2e 24 + 157 + prod 3/0; build; gate and live-catalog audits; G1, C1, R1 and the copy rulings open for tech-lead/orchestrator) | PASS | 2026-11-19 |

## Handoff

The next agent is **analyst (Phase 6)**, for the walks the design assigns:
- The real founding-administrator invitation on `development`, at 360px, light and dark.
- A member with no key.
- Community at a presbytery.
- The public committee list.
- Each named help page, read as its reader.

In parallel:
- The **orchestrator** does C1 (the production flag read) and R1.
- **tech-lead** rules on G1 and the three copy items.

Phase 6 should read the C1 answer before judging the "Who can use it" and "Adding a member" paragraphs of `/help/presbytery-committees`.

Files referenced:
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/action-gate.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/store.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/reads.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/ui-copy.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/presbytery-reports/gate.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/app/(org)/o/[slug]/admin/committees/new/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/app/(org)/o/[slug]/admin/committees/[committeeId]/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/content/help/presbytery-committees.md`
- `/Users/cshenso/git/presby-platform/presby-committees/docs/deployment.md`
- `/Users/cshenso/git/presby-platform/presby-committees/scripts/test-rls.sql`
- `/Users/cshenso/git/presby-platform/presby-committees/docs/work-log/2026-11-19-presbytery-committees.md`

---

## Orchestrator rulings after QA run 1 (2026-11-19)

- **G1:** the flag is checked in the actions too, as the design says (parent Phase 3, flag, then org type, then `groups.manage` on every page, reader and action). Add `org_portal.committees` to `resolveCommitteesActor`, with a failing-first test. With the flag off, an action answers the same refusal as the page's "isn't turned on yet" state. The rollback sentence then stays true.
- **C1:** production, read-only, 2026-11-19: `org_portal.roles`, `org_portal.members_create`, `org_portal.features` and `org_portal.admin_hub` are all **on**. The help's Roles and Community instructions are doable for a presbytery's founding administrator. The runbook's operator step names the four flags.
- **Copy:** "Choose a different role" (B3 note 2) is accepted. The roster table headings "Name", "Role", "Dates", "Actions" are accepted. The help's paraphrase of "Cancel planned term" (B3 note 3, the H8 ban) is accepted as written.
- **R1:** runbook wording fixes:
  - "four functions behind five triggers";
  - use `aclexplode` for the grant checks in point 6;
  - point 9 reads "apply 0090, then the seed", because the patches are already integrated.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
