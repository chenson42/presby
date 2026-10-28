# Backfill the baseline setup for pre-provisioning organizations — Work Log

> **Slug:** `2026-10-28-org-baseline-backfill`
> **Surface:** (admin) — the founding-administrator invitation on `/admin/organizations/<id>`
> **Permission(s):** existing keys cover this (no change)
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (production defect; migration `0082` applied to production before the pipeline closed, by the operator's approval)
> **Release:** 0.49.1 (patch)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (brief, recorded by implementer) | Done | Bug confirmed | 2026-10-28 |
| 2 — Architectural review | architect | Skipped | no new deps or structural change; no invariant touched | 2026-10-28 |
| 3 — Technical design | tech-lead | Skipped | root cause recorded below; the fix is one data-only migration | 2026-10-28 |
| 4 — Implementation | full-stack-developer | Done (Phase 5 run 1 fix applied) | — | 2026-10-28 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (brief, bug-fix variant)

## VERDICT

READY FOR DESIGN (bug confirmed; the fix preserves intended behaviour).

## ONE-LINE TAKE

> One presbytery, created before provisioning existed, could not be sent a founding-administrator invitation.

## What happened

The operator tried to send a founding-administrator invitation for the production
presbytery and got: "This organization is missing its baseline setup or a role
template — contact an engineer before sending an invitation." That string is the
`provisioning_incomplete` outcome of `createInvitation()`
(`src/lib/onboarding/issue.ts`).

**Bug is real:** the refusal is correct code reading incorrect data. The
invitation is the only way a presbytery gets its first administrator
(DECISION-183), so the organization was stranded until an engineer intervened.

**Intended behaviour preserved:** every organization created today gets a
derived, protected "Active Membership" roster group and a constitutional,
protected `member` role holding `directory.view` and `events.view`, granted to
that group (`groupSeedPlan()` and `baselineRoleSeedPlan()` in
`src/lib/org-provisioning.ts`). The fix adds exactly that, in that shape, to any
organization missing it, and changes no application code and no refusal.

# Phase 2 — Architectural Review

Skipped: no new dependency, no structural change, no invariant touched. The
migration inserts ordinary tenant rows an organization already receives at
creation, adds no table, column, function or grant, and the application code is
unchanged.

# Phase 3 — Technical Design

Skipped: the fix is a single data-only migration. Root cause and rulings below.

**Root cause.** One presbytery was created on 2026-08-31, before
`src/lib/org-provisioning.ts` seeded the derived `active_membership` group and
the baseline `member` role. The seeding runs at creation, so the organization
never received them, and `provisioningComplete()` in
`src/lib/onboarding/issue.ts` requires that group. Migrations `0062` and `0068`
backfilled the congregation-only seats (session, diaconate, deacons moderator)
but nothing backfilled the baseline for older organizations of other types.

**Operator approval to apply first.** The orchestrator put the question to the
operator, who answered "Yes, do it now". The migration was therefore applied to
production before this pipeline's code review, not at deploy. Recorded here so
the order is not read as a skipped gate.

# Phase 4 — Implementation

## What was applied, and in what order

1. `drizzle/0082_presby_backfill_org_baseline.sql` written by the orchestrator.
2. Rehearsed twice on a production-derived Neon branch: the first run added 1
   organization, the second added 0, and an existing already-provisioned
   organization was unchanged.
3. Production snapshot `snap-lingering-heart-axrxc9ch` taken first, then applied
   to production (with `-1`, as owner).
4. Applied to the shared `development` branch, where it added the member role to
   15 fixture organizations.
5. `scripts/test-rls.sql` run on `development` as `presby_app`: only the known
   drift at lines 219 and 7953.

No real organization is named in this log; the affected organization is "one
presbytery created before provisioning".

## What the migration does (read, not changed)

- A stop-block: refuses to run if an organization lacks the group but has live
  memberships (the derived roster would need syncing; done deliberately, not
  here). Production had none.
- Inserts the `Active Membership` roster group (derived, protected) for every
  organization without one (`on conflict (organization_id, derived_from) do
  nothing`).
- For each organization with that group and no org-owned `member` role: inserts
  the `member` role (constitutional, protected), its two permissions, and the
  grant to the group. An organization that already holds a `member` role is left
  alone (a migration never adds authority to a tenant-held role; 0068's rule).
- Idempotent.

## Files Created

- `drizzle/0082_presby_backfill_org_baseline.sql` — the backfill (the orchestrator's; committed here unchanged).
- `src/lib/db/domain/org-baseline-backfill.db.test.ts` — the regression test (below).
- `docs/work-log/2026-10-28-org-baseline-backfill.md` — this file.

## Files Modified

- `drizzle/meta/_journal.json` — idx 82 entry, shaped like idx 80 (`version "7"`, `breakpoints true`, `when` = the time of writing, after idx 80's). Idx 81 is unused, as the journal already skips numbers.
- `docs/TODO.md`, `docs/deployment.md`, `docs/release-notes/v0.49.md`, `docs/briefings.md`, `package.json`, `package-lock.json` — housekeeping and release 0.49.1 (second and third commits).

## Schema Changes

Data-only: no table, column, index, function, policy or grant is created or
altered. Applied via the hand-written file with `psql -1` as owner (production
and `development`), never Drizzle Kit. `npm run check:schema-parity` still
reports 0 failing (7 differences, all allowlisted, unchanged), and
`scripts/export-table-definitions.py` exports the file without error.

## Audit Events

None. The migration writes ordinary rows an organization receives at creation,
which write no audit row either; the operator's application of it is recorded
here and in `docs/deployment.md`.

## Regression test

`src/lib/db/domain/org-baseline-backfill.db.test.ts` (DB-backed, serial; the
migration is global, so it must not run beside another DB suite). Fixture:
`fx.makeBareOrg()`, an organization stamped `deletable_until` with no derived
group and no roles, the shape of a pre-provisioning organization. The migration
file is read and executed as owner in one transaction, as the apply was.

- **a pre-provisioning organization ... no longer refused** — before: zero
  group/role/permission/grant rows, and the real `createInvitation()` returns
  `provisioning_incomplete` and creates no invitation; after 0082: the group,
  the `member` role (constitutional, protected, `directory.view` and
  `events.view`) and the grant to that group exist, and the same
  `createInvitation()` returns `ok`.
- **a second run inserts nothing**, and an already-provisioned organization is
  unchanged.
- **a tenant-held `member` role is left alone** — the group is added, the role
  and its permissions are not touched, and no grant is added.
- **the stop-block** refuses an organization with a live membership and no group
  (built with the sync trigger off for the one insert, since 0017 now refuses
  that shape) and writes nothing.

**Red before, green after.** With the migration step commented out the first
three cases fail (the first at the missing group, the second at counts of 0
against 1, the third at 0 groups); with it restored all four pass. The
stop-block case does not depend on the step.

## Gates

- `npm run typecheck`: pass. `npm run lint` (max-warnings 0): pass. `npm run check`: all eight tripwires pass.
- `npm test` (unit): 701 files passed, 115 skipped (DB-backed, no `.env.local`); 10,785 tests passed, 3,198 skipped.
- Serial DB run, `src/lib/onboarding` plus the new test, with `--no-file-parallelism`: 32 files, 612 tests, all passed.
- `npm run check:schema-parity`: 0 failing.
- The `development` database holds no organization lacking the group and no leftover fixture from this suite after a run.

## Implementer Notes

- The test copies `.env.local` from the main checkout into this worktree for the run and the copy is removed at the end; nothing is printed or committed.
- `development` already had 0082 applied before the test ran, so the test
  creates its own bare organizations and the migration is a no-op for everything
  else there.
- The release note's non-engineer text, per the operator: a presbytery set up
  before automatic setup existed could not be sent a founding-administrator
  invitation; it now can; applied directly to production on 2026-10-28.

Strings added or changed: none (the existing `provisioning_incomplete` copy is unchanged and is still correct for a genuinely unprovisioned organization).

**Next agent:** qa (Phase 5). Nothing to test in a browser beyond the operator's own re-send of the invitation in production, which is theirs to do; the unit and DB suites above are the verification.

## Orchestrator ruling on Phase 5 run 1 (2026-10-28)

**In-place correction of 0082 is permitted, as a guard-only change.** 0082 is applied to production and development, so the normal rule is fix-forward; but a forward migration cannot help a fresh `db:migrate`, which stops at idx 82 before any 0083. The correction changes only the stop-blocks so they raise exactly where the file would otherwise do something wrong (an organization that needs the backfill and no `roster` type; an organization that needs the group and has any membership row at all). On every database that has already run 0082, the corrected file is a no-op exactly as before: no row it writes changes, so re-application and history are unaffected. Recorded as a decision at integration ("an applied migration may be corrected in place only when the change is guard-only and provably behaviour-neutral where it already ran").

# Phase 4 — Phase 5 run 1 fix

Implementer: full-stack-developer. Fixes the Phase 5 run 1 FAIL under the
orchestrator's guard-only in-place ruling above.

## The defect

As first applied, `0082`'s first stop-block raised `group type "roster" is
missing` unconditionally. `roster` is a global row seeded by `db:seed`, which
runs after `db:migrate`, so every fresh environment stopped at idx 82 (and
therefore before any later file). Production and `development` were unaffected
because they already had the row. QA advisory 1: the membership stop-block
looked only at live memberships (`ended_on is null`), though the sync trigger
writes a derived row for every membership. Advisory 2: the stop-block test left
the sync trigger disabled on the shared branch between statements.

## Files modified

- `drizzle/0082_presby_backfill_org_baseline.sql` — guards only, corrected in
  place (same file and number). The roster check now raises only when some
  organization lacks the `active_membership` group AND the roster type is absent
  (the 0062:236-237 / 0068:213-214 shape). The membership stop-block now refuses
  an organization lacking the group with ANY membership row (live, ended or
  future-ended); message and header comment updated. The group insert, the role,
  permission and grant inserts are untouched.
- `src/lib/db/domain/org-baseline-backfill.db.test.ts` — see Tests.
- `docs/deployment.md` — the "fresh environment" sentence now true and explained;
  the stop-block description widened; an in-place-correction note added.
- `docs/TODO.md` — "live memberships" to "any membership" in the Done line.

## Behaviour-neutral where it already ran

On `development` (0082 already applied), the corrected file run with
`psql -1 -f` as owner: row counts before and after identical (groups 50,
app_roles 67, app_role_permissions 221, role_grants 58; 0 organizations lacking
the group); `INSERT 0 0` and "baseline member role added for 0 organization(s)".
It writes no row anywhere the old file had already run. Production is the same
shape (the migration ran there; its only organization has the group).

## Fresh-database proof (real scratch database, `development` branch)

`create database scratch_0082` as owner; `drizzle-kit migrate` pointed at it by
`DATABASE_URL`/`MIGRATE_DATABASE_URL` in the environment (`.env.local` not
edited); dropped afterwards (confirmed absent from `pg_database`).

- **Before the fix (file as first applied):** `drizzle-kit migrate` exit 1 with
  70 of 71 journal entries applied; running the file by hand against that
  database reproduced `ERROR: 0082: group type "roster" is missing`.
- **After the fix:** `drizzle-kit migrate` exit 0, 71 of 71 applied
  (`organizations` and `group_types` both empty).

## Tests (`org-baseline-backfill.db.test.ts`)

- **Empty-catalog test** — `applies cleanly as a no-op on an empty catalog ... —
  regression for 0082 failing a fresh db:migrate`. A vitest case on the shared
  branch cannot create a database cheaply, so it simulates the empty catalog the
  way QA's probe did: inside a transaction that is always rolled back, each table
  the file touches is shadowed by an empty session-local temp copy
  (`create temp table ... (like public.<t> including all)`, search_path
  `pg_temp, public`); the file must raise nothing and leave nothing. A companion
  case seeds one organization into the shadow catalog with no roster type and
  asserts the `roster missing` raise still happens (the guard did not become
  inert). The real-database proof above is recorded here.
- **Stop-block** — now three cases (`it.each`): live, ENDED, and end-in-the-future
  memberships, each refused with the new message and each writing nothing.
- **Trigger window (advisory 2)** — each stop-block case does the
  `ALTER TABLE memberships DISABLE TRIGGER`, the membership insert, the
  `ENABLE TRIGGER` and the migration inside one transaction that always ends in a
  rollback; no other session sees the window or the row. The test asserts
  afterwards that no membership remains and `pg_trigger.tgenabled` is `O`. The
  case is no longer order-dependent, so the "last on purpose" ordering note is
  gone.

**Red before, green after.** With the file as first applied: the empty-catalog
case and the ENDED and FUTURE stop-block cases fail, and the live case fails on
the changed message (4 failed, 4 passed). With the corrected file: 8 passed.

## Gates

- `npm run typecheck`, `npm run lint` (max-warnings 0): pass. `npm run check`: all
  eight tripwires pass. `npm run check:schema-parity`: 0 failing (7 allowlisted,
  unchanged).
- Serial DB run (`--no-file-parallelism`) of the 0082 test and
  `src/lib/onboarding`: 32 files, 616 tests, all passed.
- `development` after the runs: no `org-baseline` fixture organization left, and
  `memberships_sync_derived_group` enabled.
- The temporary `.env.local` copy is removed; the scratch database is dropped;
  production untouched.

## Recommended decision text (for the orchestrator at integration)

"An applied migration may be corrected in place only when the change is
guard-only and provably behaviour-neutral where it already ran" — proof here:
zero-row re-run on `development`, same writes, guards only; the reason a forward
migration cannot serve is that `db:migrate` stops at the corrected idx.

**Next agent:** qa (Phase 5 run 2). Re-verify the red/green claim by restoring
the first-applied file (`git show 8a55565:drizzle/0082_presby_backfill_org_baseline.sql`)
over the working copy for one serial run, then restoring.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-28
**Verified by:** qa
**Worktree / HEAD:** `/Users/cshenso/git/presby-platform/presby-baseline`, `pipeline/org-baseline-backfill` at `a0311a7` (not pushed; no PR, so CI has not run on it)

**Scope run:** typecheck, lint, `npm run check` and the full unit suite. The new DB test and `src/lib/onboarding` ran serially on `development`. I mutated the migration and re-ran the test (below), ran `check:schema-parity`, ran the full `scripts/test-rls.sql` as `presby_app` on `development`, and did a catalog and fresh-database probe of 0082. **Not re-run:** the full DB-backed set. A migration in the diff would normally widen to it, but the orchestrator's brief narrowed it, the file is data-only, and it is already applied to `development`. The full set rests on the PR's CI, which this run shows will not get past its migrate step (see Verdict). No e2e was run, and none is owed: there is no route, auth, proxy, layout or UI change. Production was not touched. `.env.local` was copied in for the DB runs and has been removed. `git status` is clean, and `cmp` confirms the 0082 file and the test file are identical to HEAD.

## Diff scope

`git diff origin/main...HEAD --stat` covers 11 files, matching the work-log's Files Created/Modified exactly: 0082, the journal entry (idx 82, `when` later than idx 80's), the new DB test, the work-log, TODO, briefings, deployment.md, functionality-map, release notes v0.49, `package.json` and the lockfile (version only). No application code changed. `scripts/test-rls.sql` and the shared fixture `src/lib/testing/invitation-fixture.ts` did not change (`makeBareOrg` already existed on main).

## Migration 0082 compared with `org-provisioning.ts`

- **Group:** type `roster`, name `Active Membership`, `membership_source 'derived'`, `derived_from 'active_membership'`, `is_protected true`. This matches `groupSeedPlan()` and `createOrganization()` lines 441-453.
- **Role:** key `member`, name `Member`, `role_kind 'constitutional'`, `is_protected true`, permissions `directory.view` and `events.view`. The grant is group-arm only (`person_id` null), with `starts_on`, `granted_by` and `grant_reason` left to their defaults, just as `createOrganization()` lines 476-502 leave them. Matches `baselineRoleSeedPlan()`.
- **A tenant-held role is never altered:** the role loop skips any organization that already has an `app_roles` row with key `member`. The live catalog also has `app_roles_org_key UNIQUE (organization_id, key)`, so a second `member` row could not be inserted anyway. The mutation run below confirms this.
- **`ON CONFLICT (organization_id, derived_from)`** infers `groups_org_derived_key`, which is a full (non-partial) unique constraint in the live catalog. Correct.
- **Idempotent:** a second run is a no-op (test case 2 is green).
- **`-1` safety:** there are no transaction-control statements and no `CONCURRENTLY`. It is two `DO` blocks and one `INSERT`, safe in a single transaction on a populated database.
- **The stop-block is incorrect on an empty database. This is the FAIL, below.**

## Type Check

`npm run typecheck`: PASS (`tsc --noEmit` exits 0). `npm run lint` (max-warnings 0): PASS. `npm run check`: all eight tripwires pass.

## Unit Tests

Total: 13,983 | Passed: 10,785 | Failed: 0 | Skipped: 3,198 (115 files) | Duration: 35.0s
The 115 skipped files are the DB-backed suites behind `skipIf(!hasDb)` (the run had no DB env). They are not hidden skips: the relevant ones ran in the serial lane below, and the rest belong to CI.

**DB-backed (serial, `--no-file-parallelism`, `development`):** `src/lib/onboarding` plus `src/lib/db/domain/org-baseline-backfill.db.test.ts`: 32 files, 612 tests, 612 passed, 0 failed, 173.2s. Run verbosely, the new file's 4 cases all pass, including the second-run case and the stop-block case.

**Red before the fix, green after.** I did not edit the repo. Instead I ran vitest with `--root` set to the worktree and `cwd` set to a scratch directory, so the test's `process.cwd()/drizzle/0082…` read swapped in a scratch variant. Variants are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/{ctrl,nostep,noguard,nostop}/drizzle/`.

| Variant | Result |
|---|---|
| `ctrl` (byte-identical copy, confirmed with `cmp`) | 4/4 pass, so the harness is not the cause of any result below |
| `nostep` (lines 1-43 only: stop-block kept, both write steps removed) | 3 fail, 1 pass, exactly as the work-log claims: case 1 at the missing group, case 2 at `{groups:0…}` vs `{groups:1…}`, case 3 at `0` vs `1` groups. The stop-block case passes. |
| `nostop` (stop-block removed) | 1 fail: the stop-block case |
| `noguard` (the `not exists … key='member'` guard defeated) | 3 fail on `duplicate key … app_roles_org_key`. The guard is load-bearing, and the unique constraint backs it up. |

After the mutation runs, `development` had 0 organizations without the group, 0 with the group but no member role, 0 leftover fixtures and 0 `org-baseline-%` email rows, and every `memberships` trigger was enabled.

## End-to-End Tests

Not run, and not owed: no route, server action, auth path, proxy, layout or component changed. The PR's own `e2e.yml` lanes will fail at `npm run db:migrate` (see Verdict) before any spec runs.

## Schema / RLS

- `npm run check:schema-parity` (`development`): 86 domain tables, 7 differences, all 7 allowlisted, 0 failing.
- `scripts/test-rls.sql` as `presby_app` (`current_user` and `rolbypassrls = f` confirmed) on `development`, run with `psql -X` from a scratch copy with line 13's `ON_ERROR_STOP` removed. The 12 `\ir` include directories were copied from the worktree into a fresh scratch tree and `cmp`-checked. **A note on the first attempt:** the shared scratchpad held stale `giving/` and similar include files from an earlier session, which `\ir` picked up. I discarded that run and re-ran from the fresh tree. In the clean run, psql exited 0 and the run reached the last include (`test-rls-65`). There were 1,568 `pass` notices and exactly two FAILs: the known drift at `:219` ("presbytery: sees only its own members — expected 2, got 3") and `:7953` ("exactly ONE org-owned role holds statistics.publish — expected 1, got 2"). The other errors are the four aborted-transaction cascades at `:221`, `:222`, `:231` and `:233`, which follow from `:219`.
- Live catalog: there are no `groups` or `app_roles` triggers that 0082 could trip. `presby_sync_derived_membership_group` writes a `group_memberships` row for **every** membership, ended or not (see the advisory notes).

## Regression Tests Added

- `a pre-provisioning organization has no baseline and is refused; after 0082 …` (`src/lib/db/domain/org-baseline-backfill.db.test.ts:117`). Guards against the founding-administrator invitation returning `provisioning_incomplete` at an organization created before provisioning. Red without the step, green with it, verified above.
- `a second run inserts nothing, …` (`:166`). Guards idempotence and leaves a provisioned organization alone.
- `leaves a tenant-held member role alone …` (`:181`). Guards the rule that a migration never adds authority to a tenant role.
- `the stop-block refuses an organization that has live memberships and no group …` (`:201`).
- **Gap (FAIL):** no test or check shows that 0082 applies on a database with no organizations and no `group_types` rows, which is the state `db:migrate` produces before `db:seed`. Details below.

## Coverage on Critical Modules

n/a. `permissions.ts`, `two-factor.ts` and `flags.ts` are untouched, so coverage was not re-measured.

## Feature-Gate Audit

No protected routes touched. The diff adds no `route.ts` and no `"use server"` action.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| none | n/a | n/a | n/a |

## Copy Truthfulness

No UI strings changed: the `provisioning_incomplete` copy is unchanged and still correct for a genuinely unprovisioned organization. I read the release-note lines added to `docs/release-notes/v0.49.md`:
- [x] "it now can": the test's `createInvitation()` returns `ok` after 0082 (`:158`). The viewer is the platform administrator on `/admin/organizations/<id>`. The send path is unchanged, so the gate is unchanged.
- [x] "the same two things every organization gets when it is created today" matches `groupSeedPlan()` and `baselineRoleSeedPlan()` for a non-congregation.
- [ ] "no other organization in production was touched" rests on the operator's two rehearsals on a production-derived branch. I did not verify it, because production was out of scope. The `raise notice` count reports member roles only, not group inserts, so the rehearsal's "1 organization" alone does not rule out a group-only insert elsewhere. Analyst may want the rehearsal's group count too.
- [x] **FALSE today, fix with the migration:** `docs/deployment.md` (added section, "Nothing to run at deploy" bullet) says "A fresh environment gets the file from the journal (idx 82)". A fresh environment currently **fails** on that file (below).

## Verdict

**FAIL**: 0082 breaks `npm run db:migrate` on every fresh database, which is how CI builds every DB and e2e lane.

`drizzle/0082_presby_backfill_org_baseline.sql:31-33` raises unconditionally when `group_types` has no `roster` row:

```sql
  if not exists (select 1 from group_types where key = 'roster') then
    raise exception '0082: group type "roster" is missing';
```

No migration inserts into `group_types`. Only `scripts/seed.ts` (`seedGroupTypes()`, line 834) and `scripts/seed-dev.sql` do. All three CI jobs run `npm run db:migrate` **before** `npm run db:seed` on a database cloned from `template1`: `.github/workflows/db.yml:117/119` (four shards), `db.yml:197/199` (RLS job) and `e2e.yml:135/137`. So drizzle-kit reaches idx 82 with an empty `group_types` and the stop-block raises.

Proof, run on `development` in a rolled-back transaction using session-local, `on commit drop` temp tables to stand in for an empty database (`/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-0082-fresh/probe.sql`; the real `roster` row was still present afterwards):

```
--- 0068 guard shape (organizations-conditional):
NOTICE:  0068-shape guard: passes on an empty database
--- 0082 as committed:
psql:drizzle/0082_presby_backfill_org_baseline.sql:43: ERROR:  0082: group type "roster" is missing
psql exit 3
```

Migrations 0062 (`:236-237`) and 0068 (`:213-214`) avoid this by raising only when an organization that needs the group type exists. 0082's guard needs the same condition, for example raising only if some organization lacks the `active_membership` group and `roster` is missing. On production and `development`, which already ran the file, that change is behaviour-neutral.

**A ruling is needed, so the handoff copies tech-lead.** 0082 has been applied to production, so CLAUDE.md's rule is "fix forward". A forward migration cannot fix this, though: drizzle-kit on a fresh database runs 0082 and stops before any 0083. That leaves an in-place edit of the guard as the only fix. Tech-lead (or the operator) should rule on that exception and record it. The fix also needs a check that 0082 applies cleanly on an empty catalog: either a test case like the probe above, or a green `db.yml` and `e2e.yml` migrate step on the PR. It should also correct the `docs/deployment.md` sentence quoted under Copy Truthfulness.

**Advisory notes (not blocking):**
1. The stop-block predicate (`m.ended_on is null`, `0082:38-39`) is narrower than the sync trigger, which writes a derived row for every membership, including ended and future-dated ones. Take an organization with no group and only ended memberships: it would pass the stop-block and get a group with no historical rows. A membership with a future `ended_on` would not be counted at all. On `development` there are 0 future-ended memberships and 0 organizations without the group. On production the work-log says the affected organization has 0 memberships; I did not re-verify that.
2. The stop-block case (`org-baseline-backfill.db.test.ts:208-212`) runs `ALTER TABLE memberships DISABLE TRIGGER` outside a transaction. That takes effect for every session on the database, and the migration it applies is a global backfill. CI is unaffected because each shard has its own branch. On the shared `development` branch, though, a parallel pipeline's DB run could hit that window.
3. On `development`, 2 organizations lack `organization_settings` and event types, which `createOrganization()` also seeds. This is outside 0082's stated scope, noted only so Phase 6 does not read "exactly what creation seeds" too broadly.

No real organization is named anywhere in the diff: added lines contain no church, presbytery or synod names, domains or addresses, and the fixture names are invented.

---

**Per-Phase Status row:**

| 5 — Verification | qa | Done | FAIL (0082's stop-block raises on a fresh database, so CI's `db:migrate` fails; fix needs an in-place-edit ruling) | 2026-10-28 |

**Handoff:** back to **full-stack-developer** (Phase 4) to fix `drizzle/0082_presby_backfill_org_baseline.sql:31-33` and add the empty-catalog check. **Tech-lead** is copied for the ruling on editing an already-applied migration in place, since a fix-forward cannot reach a fresh `db:migrate`. After the fix, Phase 5 needs to re-run only the 0082 test, the empty-catalog check, `check:schema-parity`, and a confirmed migrate step on the PR's CI (or a local fresh-database migrate). Everything else above stands.

---

# Phase 5 — Verification (qa), run 2

**Date:** 2026-10-28
**Verified by:** qa
**Worktree / HEAD:** `/Users/cshenso/git/presby-platform/presby-baseline`, `pipeline/org-baseline-backfill` at `0d81c51` (not pushed, so CI has not run)

**Scope run:** This is the run 2 scope from the orchestrator's brief. Everything else stands on run 1.
- I checked the guard-only diff of 0082 and re-applied it on `development` with `psql -1`.
- I built a fresh scratch database and ran `drizzle-kit migrate`, then `check:schema-parity`, `seed.ts`, `seed-dev.sql`, and two re-applies of 0082. Then I dropped the database.
- I ran the 0082 test red against `a0311a7`'s file and green against HEAD's.
- Gates: typecheck, lint, `npm run check`, `check:schema-parity`, and a serial run of the 0082 test plus `src/lib/onboarding`.

**Not re-run:**
- The full unit suite (run 1: 10,785 passed, 0 failed; no application code changed since).
- `scripts/test-rls.sql` (run 1; 0082's writes are byte-identical and `development`'s row counts did not change).
- The full DB-backed set.
- e2e: none owed, because there is no route, auth, proxy, layout or UI change.

Production was not touched. I copied `.env.local` in for the DB work and have removed it. No value or connection string was printed, and every log was checked for zero `postgres://` matches. `git status` is clean, and `cmp` confirms 0082 matches HEAD. No repo file was edited and no stash was used.

## Diff scope (`git diff a0311a7..HEAD -- drizzle/0082*`)

- Only the header comment and the first `DO` block changed. `drizzle/meta/` is unchanged.
- The roster guard is now `if exists (org lacking the active_membership group) and not exists (roster) then raise`. The old version raised whenever `roster` was absent, so the new one raises in fewer cases.
- The membership stop-block dropped `and m.ended_on is null`, so it now refuses any membership row (a broader refusal). Its message changed from "live memberships" to "membership rows".
- **Every write statement is byte-identical.** I extracted everything after the first `end $$;` from the `a0311a7` and HEAD files and compared them: `cmp` reports identical, 40 lines each. That covers the group `INSERT … ON CONFLICT` and the role/permission/grant `DO` block.
- The work-log's handoff names `8a55565` as the first-applied file. `git diff 8a55565 a0311a7` on 0082 is empty, so the two baselines are the same file.

## Behaviour-neutral where it already ran (`development`)

I ran the corrected file with `psql -X -1 -v ON_ERROR_STOP=1` as `neondb_owner` on `neondb`: `DO`, `INSERT 0 0`, `NOTICE: … added for 0 organization(s)`, exit 0.

Row counts before and after were identical:
- orgs 17, groups 50, active_membership groups 17
- app_roles 67, app_role_permissions 221, role_grants 58, memberships 61
- 0 orgs lacking the group, 0 with the group but no `member` role

On production, the ledger records only the first ten migrations (`docs/deployment.md:145`), so 0082 is never re-run by `drizzle-kit` there.

## Fresh-database proof

1. **Create.** `create database scratch_qa_0082` on the `development` branch as owner. It started with 0 public tables.
2. **Migrate.** `npx drizzle-kit migrate` with the URLs swapped into the environment by a scratch wrapper (`.env.local` not edited): exit 0, "migrations applied successfully". `drizzle.__drizzle_migrations` holds 71 rows, which matches the journal's 71 entries. Its `max(created_at)` = `1793219058000` = idx 82's `when`. After migrate: 0 organizations, 0 groups, 0 `group_types`.
3. **Parity and seed.** `check:schema-parity` on the scratch DB (as CI runs it, between migrate and seed): 86 tables, 7 allowlisted, 0 failing. `scripts/seed.ts`: exit 0, "seeded 6 platform-wide group_types".
4. **Fixture.** `seed-dev.sql` with `ON_ERROR_STOP=1`: exit 0.
5. **Re-apply 0082 on the seeded DB.** Exit 0, and no stop-block raised. **It was not a no-op:** `INSERT 0 4` and "added for 11 organization(s)". Of the 12 fixture orgs, 4 lacked the group and 7 had the group but no `member` role. See the advisory below: this is correct backfill behaviour, not a defect.
6. **Second re-apply.** `INSERT 0 0`, 0 organizations, all counts unchanged. Idempotent.
7. **Drop.** `drop database scratch_qa_0082 with (force)`. `pg_database` now lists only `neondb`, `postgres`, `template0` and `template1`.

## Type Check

- `npm run typecheck`: PASS.
- `npm run lint` (max-warnings 0): PASS.
- `npm run check`: all eight tripwires pass.

## Unit Tests

The DB-backed run was serial (`--no-file-parallelism`, `development`) over `src/lib/db/domain/org-baseline-backfill.db.test.ts` and `src/lib/onboarding`.

Total: 616 | Passed: 616 | Failed: 0 | Skipped: 0 | Files: 32/32 | Duration: 177.7s

This matches the implementer's reported 32 files / 616 tests.

**Red before, green after.** I used the run 1 harness: vitest with `--root` set to the worktree and the working directory set to a scratch directory, so the test's `process.cwd()/drizzle/0082…` read takes the variant. Both variants were checked with `cmp` against `git show a0311a7:` and `git show HEAD:`.

| Case | `a0311a7` file | HEAD file |
|---|---|---|
| empty catalog no-op (`:309`) | **fail**: raised `group type "roster" is missing` | pass |
| stop-block, ENDED membership (`:219-223`) | **fail**: `refused` was `null`, so the old file did not refuse | pass |
| stop-block, FUTURE-ended membership | **fail**: `refused` was `null` | pass |
| stop-block, live membership | fail on the message only: the old text says "live memberships" | pass |
| `roster missing` still raised (`:315`) | pass (the old file raised unconditionally) | pass |
| the three original cases | pass | pass |
| **Total** | 4 failed, 4 passed (exit 1) | 8 passed (exit 0) |

This matches the implementer's claim. The ENDED and FUTURE cases fail because the old file did not refuse, which is the behaviour that matters, not just a wording mismatch. I confirmed that per case with the JSON reporter.

**Trigger window (run 1 advisory 2), resolved.** Each stop-block case (`:229-245`) runs `disable trigger`, the insert, `enable trigger` and the migration inside one `fx.platform.transaction` that always throws `RolledBack`. In Postgres the trigger change and its lock are transactional, so other sessions block on the lock rather than see the window, and the change is undone by the rollback.

After all three runs (red, green, serial), `pg_trigger` on `public.memberships` shows:

| Trigger | `tgenabled` |
|---|---|
| `memberships_guard_end` | `O` |
| `memberships_guard_insert` | `O` |
| `memberships_sync_derived_group` | `O` |

There are 0 leftover `org-baseline` organizations and 0 leftover `org-baseline-%` email rows, and the `development` row counts are identical to the pre-run counts above.

## End-to-End Tests

Not run and not owed: no route, action, auth path, proxy, layout or component changed.

## Regression Tests Added

- `applies cleanly as a no-op on an empty catalog (no organizations, no group types) — regression for 0082 failing a fresh db:migrate` (`src/lib/db/domain/org-baseline-backfill.db.test.ts:309`). It guards against 0082 stopping `db:migrate` on a fresh database, and it was red on `a0311a7`. It simulates the empty catalog with temp tables, so the real-database proof above is what backs it.
- `still raises roster missing when an organization needs the group and the roster type is absent` (`:315`). It guards against the corrected guard becoming inert. It cannot be red on the old file, by construction.
- `the stop-block refuses an organization that has %s and no group` (`:219`), three cases. The ENDED and FUTURE cases were red on `a0311a7` and close run 1 advisory 1.
- Minor, non-blocking: in the stop-block cases the "writes nothing" assertions (`:251-252`) are already guaranteed by the rollback. The `refused` match is what carries each case.

## Coverage on Critical Modules

n/a. `permissions.ts`, `two-factor.ts` and `flags.ts` are untouched.

## Feature-Gate Audit

No protected routes touched.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| none | n/a | n/a | n/a |

## Copy Truthfulness

No user-facing strings changed. I checked the changed doc lines:
- [x] `docs/deployment.md`, "A fresh environment gets the file from the journal (idx 82) and it is a no-op there … `db:migrate` completes through idx 82": **now true.** Proven above: exit 0, 71 of 71 applied, 0 organizations and 0 group rows afterwards.
- [x] "an organization that lacks the group and has ANY membership row … stops the file" and "roster missing only when some organization needs the group": both match the HEAD guards and the green cases.
- [x] "re-run with `-1` on `development`: zero rows inserted": reproduced.
- [x] `docs/TODO.md`: "live memberships" became "any membership", which is accurate.
- [ ] "it is a no-op on production" rests on the writes being byte-identical and on production's single affected organization already holding the group. I did not verify it against production, which was out of scope.

## Verdict

**PASS.** The guard-only correction is exactly that: every write is byte-identical, the guards raise in fewer cases (roster) or more cases (memberships), and nothing changes where 0082 already ran. A fresh `db:migrate` now completes through idx 82. The regression tests are red on the first-applied file and green on HEAD, and the trigger toggle is confined to a rolled-back transaction.

**Advisory, for the orchestrator and Phase 6 (not blocking): the brief's "re-applies as a no-op on the seeded database" did not hold, and that exposes fixture drift.**
- On a fresh database, 0082 runs at migrate time against an empty catalog. `seed-dev.sql` then creates 12 organizations, 4 without the Active Membership group and 7 with the group but no `member` role, because the fixture does not seed the baseline that `createOrganization()` does.
- A manual re-apply backfills them (4 groups, 11 roles), which is correct behaviour for 0082.
- **The consequence:** on `development`, 0082 ran after the fixture and gave 15 fixture organizations the baseline `member` role (`directory.view`, `events.view`). CI's fresh databases never get it.
- So `development` and CI now differ in which fixture members hold those two keys. A future DB or RLS test that depends on the difference will pass locally and fail in CI, or the reverse.
- Suggested TODO line: give `scripts/seed-dev.sql` the baseline group and `member` role for its organizations, or record the drift as accepted.
- Separately, the stop-block did not fire on the seeded fixture, so its 4 group-less organizations have no memberships.

Carried from run 1, unchanged: the production-touched claim ("no other organization in production was touched") rests on the operator's rehearsal, and 2 `development` organizations lack `organization_settings` and event types. Both are still for Phase 6 to weigh.

---

**Per-Phase Status row:**

| 5 — Verification | qa | Done | PASS (run 2: 0082 guard-only correction verified; fresh `db:migrate` exit 0 through idx 82; red on `a0311a7` 4/8, green on HEAD 8/8; serial 616/616) | 2026-10-28 |

**Handoff:** to **analyst** (Phase 6). The advisory above needs a ruling or a `docs/TODO.md` line: `development` and CI differ on the fixture `member` role because 0082 ran after `seed-dev.sql` on `development` but before it on every fresh database. At integration, the orchestrator records the "guard-only, behaviour-neutral in-place correction" decision proposed in the Phase 4 fix section.

Files:
- `/Users/cshenso/git/presby-platform/presby-baseline/drizzle/0082_presby_backfill_org_baseline.sql`
- `/Users/cshenso/git/presby-platform/presby-baseline/src/lib/db/domain/org-baseline-backfill.db.test.ts`
- `/Users/cshenso/git/presby-platform/presby-baseline/docs/deployment.md`
- `/Users/cshenso/git/presby-platform/presby-baseline/docs/work-log/2026-10-28-org-baseline-backfill.md`
- Scratch evidence (red and green logs, wrapper, count query): `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/run2/`

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-10-28. **Worktree and HEAD:** `/Users/cshenso/git/presby-platform/presby-baseline`, `pipeline/org-baseline-backfill` at `114dc01`.

**What I did.** I re-read the work-log in full: Phase 1, the production apply, QA runs 1 and 2, the in-place ruling and the fix. I read the corrected `drizzle/0082_presby_backfill_org_baseline.sql` and `provisioningComplete()` in `src/lib/onboarding/issue.ts:304`. I ran read-only `select` counts on `development`. I read the help pages in `/Users/cshenso/git/presby-platform/presby-help` and its `docs/release-notes/v0.50.md`. I did not touch production. I did not open a browser, because this role has no browser tool. I printed no `.env.local` value and no connection string.

## VERDICT

**SHIP WITH NOTES.** The bug is fixed for the user at the data level and in the real `createInvitation()` call. Four notes, below, become tracked follow-ups. The first (N1) is the operator's own walk in production, and I cannot do it from here.

## ONE-LINE TAKE

> The one presbytery that was refused its founding-administrator invitation now has the group the send check looks for, and a fresh database now migrates through the corrected file.

## What's Working

- **Cause and fix line up.** For `purpose = founding_administrator`, `provisioningComplete()` requires exactly one thing: an `active_membership` group in the organization (`issue.ts:310-316`). The "role template" half of the refusal string is checked only for treasurer invitations (`:317-325`). 0082 supplies the group, so no second missing prerequisite is hiding behind the first.
- **The user-level regression test is real.** `org-baseline-backfill.db.test.ts` builds a bare organization and calls the real `createInvitation()`. It returns `provisioning_incomplete` before 0082 and `ok` after. QA run 2 re-proved the red/green split against both file versions: 4 failed against `a0311a7`, 8 passed against HEAD.
- **The correction changed no rows.** QA's `cmp` shows the write statements are byte-identical (40 lines each). The guards changed only in when they raise. `development` row counts were identical before and after a re-run, and the fresh `db:migrate` exits 0 at 71 of 71 entries.
- **`development` today (my read-only counts).** There are 17 organizations. 0 lack the group, 0 have the group but no `member` role, and 0 `member` roles lack a grant to a group. The ledger holds 10 rows, as `deployment.md:145` says (hand-written files are applied by `psql`). The data is internally consistent.
- **Operator-facing clarity.** The refusal copy is unchanged and still correct for a genuinely unprovisioned organization. `deployment.md` explains the in-place correction in plain terms.

## Intent-vs-Shipped Diff

- **Phase 1 said:** an older presbytery can be sent the founding-administrator invitation, the fix preserves intended behaviour, and no application code changes. **Shipped:** exactly that. The only `src/` change is the new test file. **Verdict:** matches.
- **Phase 1 said:** the fix adds "exactly" what creation seeds. **Shipped:** the group, the `member` role, its two permissions and the grant. Creation also seeds `organization_settings` and event types, and 0082 does not. **Verdict:** acceptable drift. The scope was always the invitation's prerequisite, but the release note must not claim more than that (see N3 and the sentence check).
- **The order of events differed from the pipeline.** Production was changed before the code review, on the operator's explicit "Yes, do it now", with a snapshot and two rehearsals. The work-log records this plainly. **Verdict:** acceptable. The later in-place correction is now also on record.
- **Did the bug stop manifesting for the user?** Proven on `development`, and by the rehearsal on a production-derived branch and the production apply. Not yet witnessed by the operator in production (N1).

## Rulings

**1. Fixture drift (QA run 2 advisory).** I rule: **file a TODO line. Do not accept the drift silently.**
- **The facts.** `development` has the baseline `member` role on all 17 organizations, because 0082 ran after the fixture. A fresh CI database runs 0082 on an empty catalog, so the 11 later fixture organizations in `seed-dev.sql` keep no `member` role. `seed-dev.sql` seeds the baseline role only for the original fixture organizations (lines 391-395).
- **Why a TODO and not a fix now.** The drift is real. A future test that depends on who holds `directory.view` or `events.view` will pass locally and fail in CI. But `seed-dev.sql` and `test-rls.sql` carry hard-coded counts (the file says so itself at `:770-773`), and both are Rule 16 integration-only files. Editing them inside a bug-fix pipeline is the wrong place.
- **A second drift is already open.** Line 228 of `TODO.md` records `development` drift that stops `test-rls.sql`. This is a sibling of that item.

**2. The "no other production organization touched" claim.**
- **What the record supports.** The role-loop notice counts member roles only, and the rehearsal reported "1 organization added, then 0".
- **The gap.** A group-only insert elsewhere would need an organization that lacked the group but already held a tenant-owned `member` role. Migration 0017 and the stop-block make that shape unlikely, but nothing in the record excludes it.
- **Ruling.** The claim is probably true and is unverified for groups. Either of two fixes is acceptable.
  - Preferred: the operator runs one read-only count in production, `select count(*) from groups where derived_from='active_membership' and created_at >= <the apply time>`, and expects 1.
  - Otherwise: soften the sentence, as drafted below.
- Production was out of scope for me and for QA. This is N2.

**3. The two `development` organizations lacking `organization_settings` and event types.**
- They are `hollinbrook` and `saltmarsh`, both created 2026-10-26.
- They are deliberate fixtures, not a defect. `seed-dev.sql:776-777` says: "Neither gets an organization_settings row, so the 2FA-policy assertions in section 11 are untouched."
- No action is needed on `development`.
- **A production question remains, which QA's note did not reach.** The presbytery created on 2026-08-31 may also lack `organization_settings` and event types if those were seeded later. An absent settings row reads as "2FA not required", which is benign. Other readers of settings and event types may not be. This is a read-only count the operator can run (N3).

**4. Help impact: confirmed none.**
- The help branch has no page that mentions the refusal, the "baseline setup" string or "contact an engineer".
- The only relevant line is `roles-who-can-do-what.md:13` (the "Member" role goes to the "Active Membership" group). It is true and stays true.
- This change touches no `src/content/help/` file and no UI string. The help branch adds no migration, so there is no migration-number collision with idx 82.
- Merge friction is likely at integration. Help edits `TODO.md`, `briefings.md`, `functionality-map.md` and `docs/release-notes/v0.50.md`, and so does this branch.

**The Phase 6 walk.** The rule requires the walk as the person the path creates, on `development` at 360px. I did not do it. I have no browser, and no one has yet witnessed the accepted-invitation founding administrator for this presbytery.
- **What I could establish at the data level.** The `member` role is granted to the Active Membership group. That group is a derived roster, populated only by memberships. The presbytery has 0 memberships. So the baseline grant gives a newly seated founding administrator nothing on its own, and their reach comes from the founding-administrator bundle. 0082 therefore adds no authority to the person the path creates.
- **Why it stays a note.** This is a role grant on a production organization. The three 2026-10-23 escapes were found by exactly this walk, so I will not infer my way out of it (N1).

## Edge Cases

- **Empty state:** pass. On a fresh database 0082 is a no-op on an empty catalog (71 of 71, exit 0). For an organization with no members the invitation page is unchanged.
- **Failure microcopy:** pass. The `provisioning_incomplete` copy is unchanged. It still names "a baseline setup or a role template", which is true for a treasurer invitation. A stop-block failure is an engineer-facing migration error and is documented in `deployment.md`.
- **Permission gate:** pass. No route, action or permission key changed. The invitation is still gated as before.
- **Audit event:** not applicable. The rows are the same ones creation writes without audit. The apply is recorded in the work-log and `deployment.md`, and a platform-admin role grant is the audit-relevant act, which this change is not.
- **Mobile (360px):** not applicable to the diff (no UI). The operator's walk in N1 covers it.

## Draft: decision text

(Numbering is the orchestrator's. Insert at the top of `docs/decisions.md`.)

**DECISION-NNN — An applied migration may be corrected in place only when the change is guard-only and provably behaviour-neutral where it already ran; otherwise fix forward.**

**Status:** Accepted (operator or orchestrator ruling, 2026-10-28; Phase 6 SHIP WITH NOTES, `2026-10-28-org-baseline-backfill`) · **Date:** 2026-10-28

- **Rule.** CLAUDE.md's `drizzle/` line allows an in-place correction only before a migration reaches a shipped environment. This adds one exception for a file already applied to production or `development`. All of these must hold:
  - **(a)** The change touches only guards, meaning conditions on `RAISE`, `IF` and `WHEN`, plus comments. Every statement that writes, alters or grants is byte-identical.
  - **(b)** On every environment that already ran the file, the corrected file writes nothing. This is proven by a zero-row re-run with `psql -1` there, and the counts are recorded.
  - **(c)** A forward migration cannot serve. The test is that a fresh `db:migrate` stops at the defective index before any later file.
  - **(d)** The change has a regression test that is red on the as-applied file and green on the corrected one.
  - **(e)** The work-log, the migration header and `docs/deployment.md` each say that the file was corrected in place, and why.
- **Why.** `db:migrate` is the only path to a fresh environment. A defect in an applied file blocks every new environment, and nothing after it can run. A guard that is wrong on an empty catalog can only be fixed at its index.
- **Not covered.** Any change to a write, a grant, a policy or a function body; any renumbering; any change to the journal's `when`. Those fix forward.
- **Accepted residual (`paper`).**
  - A guard can be widened, so it refuses in more cases, as the membership stop-block did here. That is neutral on environments that applied the file only because the file is not run again. The re-run in (b) is the check, and nothing mechanical enforces it.
  - A hand-applied file's bytes are not hashed anywhere (the ledger holds ten rows), so nothing detects drift between "as applied" and "as in the repo" except this record.
- **First use.** `0082` (stop-blocks corrected before release; commit `421940c`).
- **Follow-through.** The operator should approve the matching amendment to the `drizzle/` line in CLAUDE.md. I have not edited it. Reword the `deployment.md` Rollback bullet ("never an edit of 0082 once shipped") to "except as DECISION-NNN permits".

## Draft: TODO lines

(Unticked, under Next Up or Open.)

- [ ] **`seed-dev.sql` seeds the baseline for only the original fixture organizations, so `development` and CI differ on who holds `directory.view` and `events.view`.** On `development`, 0082 ran after the fixture and gave all 17 organizations the `member` role. A fresh CI database runs 0082 on an empty catalog, so the 11 later fixture organizations have the Active Membership group missing or no `member` role. Give every fixture organization the derived group and the `member` role (as `groupSeedPlan()` and `baselineRoleSeedPlan()` do), as one deliberate count-edit pass over `seed-dev.sql` and `test-rls.sql` at integration (Rule 16). Do it before the first test that depends on the baseline role. Related to the `test-rls.sql`-does-not-run-clean line. — `docs/work-log/2026-10-28-org-baseline-backfill.md` Phase 5 run 2 / Phase 6
- [ ] **operator: read-only production counts after the 0082 apply.** (1) `select count(*) from groups where derived_from='active_membership' and created_at >= <apply time>` expects 1, which confirms no other organization was touched. (2) Organizations lacking an `organization_settings` row or any event type; the presbytery created 2026-08-31 may be one. A missing row is benign for the 2FA policy, but confirm what else reads it. If (2) is non-zero, file a backfill as its own bug-fix pipeline. — Phase 6
- [ ] **operator: walk the founding-administrator invitation for the presbytery in production, on a phone.** Send the invitation, accept it as the invitee, and list each page the account lands on at 360px. Record the result in this work-log. Workflow's Phase 6 walk requirement. — Phase 6

Also at ship time, per Rule 10, move the TODO Done line (`TODO.md:654`) to the 0.50.1 wording, and replace "no decision" with the new DECISION number.

## Release-note sentence check

The note is `docs/release-notes/v0.49.md`, the 0.49.1 entry.

| Sentence | Check | Action |
|---|---|---|
| "…it now can. Applied directly to production on 2026-10-28." | True. The test shows `ok`; the apply is recorded. | Keep. |
| "The same two things every organization gets when it is created today: its 'Active Membership' group and the ordinary 'Member' role…" | True for the group and the role. Creation also seeds settings and event types. "Two things" is accurate only because of the next sentence. | Keep, but see the next row. |
| "…Nothing else about the organization changed, and **no other organization in production was touched**." | The role-loop count excludes only role inserts. The group-insert count is unverified. | Soften unless N2 passes. Wording: "It was added to the one presbytery that lacked it; organizations that already had it were left as they were." Restore the original wording only after the operator's count returns 1. |
| "…lets members see the directory and the events calendar." | True of the keys. The events calendar also depends on the congregation's own events setting, as the existing N5 line shows. This presbytery has no members yet. | Change to "lets members see the directory and, where it is turned on, the events calendar." |
| Notes for the operator: "If an organization ever has members but no 'Active Membership' group, the migration stops…" | Now broader: any membership record, including ended ones. | Say "has membership records (current or past)". |
| "…already applied… so there is nothing to apply at deploy." | True. | Add: "A fresh environment migrates cleanly through it; the file was corrected before release so it does so." |
| **Technical:** "No decision recorded; no what's-new post." | No longer true. The in-place correction is the decision. | Replace with "DECISION-NNN (in-place correction of an applied migration); no what's-new post." Also mention the corrected guards. |

**Renumbering.** The entry is anchored `0.49.1` and sits in `v0.49.md`. It becomes `0.50.1` in `v0.50.md`, after the 0.50.0 help entry. Also bump the `TODO.md` Done line, the `briefings.md` entry (and its `covers` marker), `deployment.md` "v0.49.1", `functionality-map.md`, `package.json` and the lockfile. Do not draft a what's-new post, as instructed.

## Follow-Ups (SHIP WITH NOTES)

- **N1.** The operator walks the invitation in production: send, accept and land, on a phone at 360px. Record it in the work-log. This is the Phase 6 walk I could not do. TODO line above.
- **N2.** Confirm "no other organization touched" with the read-only production count, or ship the softened sentence. TODO line above.
- **N3.** File the fixture-drift TODO line and the production settings and event-type count. The two `development` organizations lacking settings are intended fixtures and need no action.
- **N4.** Record the in-place-correction decision, ask the operator to approve the CLAUDE.md `drizzle/` line amendment, reword the `deployment.md` Rollback bullet, apply the release-note edits above, and renumber to 0.50.1.

Workflow Rule 12: no feedback row originated this work. Rule 13: no member-visible behaviour change, no what's-new entry drafted. Rule 14: the functionality-map change is a version bump only. Rule 15: nothing architectural.

**Per-Phase Status row:**

| 6 — Shipped vs intent | analyst | Done | SHIP WITH NOTES (the bug no longer manifests on `development` or in the real `createInvitation()`; N1 to N4 filed, and N1 is the operator's own production walk) | 2026-10-28 |

**Handoff:** to the orchestrator. Write this section and the status row into the work-log. Record the decision and the TODO lines in the same commit as the release housekeeping, in the order Rule 10 asks for. Renumber to 0.50.1 after help 0.50.0 merges, and expect conflicts in `TODO.md`, `briefings.md` and `functionality-map.md`. The operator's confirmation of N1 and N2 closes the follow-ups.

Files:
- `/Users/cshenso/git/presby-platform/presby-baseline/docs/work-log/2026-10-28-org-baseline-backfill.md`
- `/Users/cshenso/git/presby-platform/presby-baseline/drizzle/0082_presby_backfill_org_baseline.sql`
- `/Users/cshenso/git/presby-platform/presby-baseline/docs/release-notes/v0.49.md`
- `/Users/cshenso/git/presby-platform/presby-baseline/docs/deployment.md`
- `/Users/cshenso/git/presby-platform/presby-help/docs/release-notes/v0.50.md`
- `/Users/cshenso/git/presby-platform/presby-help/src/content/help/roles-who-can-do-what.md`

## Orchestrator follow-up on Phase 6 (2026-10-28)

- **N2 closed:** read-only production count of `active_membership` groups created since 2026-10-28 20:00 UTC = **1** (the presbytery). No other organization was touched; the release note's original sentence stands.
- **N3 (production part) closed:** production organizations lacking an `organization_settings` row = 0; lacking any event type = 0.
- **N1 open:** the operator's own founding-administrator invitation walk in production.
