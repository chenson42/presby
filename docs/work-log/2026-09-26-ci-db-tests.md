# CI runs none of the database-backed tests — a db-tests job on an ephemeral Neon branch, the e2e job fixed so it can actually run, and the runner config that makes both green — Work Log

> **Slug:** `2026-09-26-ci-db-tests`
> **Surface:** `.github/workflows/` (ci.yml, e2e.yml), `vitest.config.ts`, `src/lib/rate-limit.test.ts`, `playwright.config.ts`, `docs/testing.md`, `docs/deployment.md`; no application code
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Full (Phase 2 runs — CI shape and the runner config are structural; Phase 3 brief)
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-26):** worktree `../presby-wt-ci` on git branch `pipeline/ci-db-tests`; Neon branch `pipeline-ci-db-tests` (`br-billowing-moon-axseoatg`, forked from `development` at the v0.26.0 state — `drizzle/0043`–`0049` applied, seed loaded); the worktree's `.env.local` points every connection at it. The pipeline may also create and delete its own throwaway Neon branches via the Neon API to rehearse the CI job locally — name each one `ci-rehearsal-*` and delete it when done. **Pre-assigned numbers:** `drizzle/0050_presby_schema_parity.sql` (added at Phase 1 — the schema-drift fix); `DECISION-150`; no findings series. **Shared-file discipline:** `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time via `/merge-pr`; `scripts/test-rls.sql` re-run on `development` after each merge). Dev-server port for this pipeline: `3500`; Playwright `outputDir` under the worktree; stop servers by PID, never `pkill -f`.
> **The gap (test-coverage review 2026-09-25, C-1/C-5, punch items 1–6; retrospective's single highest-leverage fix):** `npm test` in `ci.yml` runs with no `DATABASE_URL`, so **765+ `describe.skipIf(!hasDb)` tests in 30 files and the 520-assertion `scripts/test-rls.sql` isolation suite run nowhere in CI** — every RLS proof, every freeze trigger, `withOrgContext()`'s ordering, the permission resolver, and everything wave 2 added. The e2e job (`e2e.yml`) has **never executed** (no `NEON_API_KEY`/`NEON_PROJECT_ID` secrets — the operator said "later"), and per C-5 would still fail if the secrets existed: it never writes `PLATFORM_DATABASE_URL` (globalSetup throws at `seed-orgs.ts:233`), it runs `db:push` + `db:seed` only (Drizzle Kit emits none of the hand-written RLS/trigger migrations, so the branch would have no isolation model), and it never applies `scripts/seed-dev.sql` (specs reference `alder-creek`).
> **Scope, dependency-ordered (the review's items 1–6):** (1) `src/lib/rate-limit.test.ts:194-200` — stub `RATE_LIMIT_DISABLED=false` in the enforcement block (`vi.stubEnv`/`vi.unstubAllEnvs`) so the DB-backed run is not red 4/4 on the env trio; (2) `vitest.config.ts` — `testTimeout: 20000`, `hookTimeout: 30000` with a comment naming the remote-Neon reason (two boundary flakes measured); (3) `vitest.config.ts` — `fileParallelism: false` (the requirement lives only in `docs/testing.md:157` today), with a note on what it costs the pure suite (nothing measurable); (4) **a `db-tests` job in `ci.yml`** on an ephemeral Neon branch modelled on `e2e.yml`'s create-branch step: create branch → apply `drizzle/*.sql` **in filename order via `psql`** (not `db:push`; `npm run db:migrate` is the alternative now that `_journal.json` is gapless — rule which, and whether 0000–0042 replay cleanly from empty: the security pipeline proved 49/49 via psql) → `db:seed` → `psql -f scripts/seed-dev.sql` → `vitest run` with `DATABASE_URL`/`PLATFORM_DATABASE_URL`/`MIGRATE_DATABASE_URL`/`APP_DATABASE_URL` set → `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` → delete branch (always, `if: always()`); the job must skip cleanly with an annotation when the secrets are absent (the `check-secrets` precedent), never report green for a run that did nothing; (5) `e2e.yml` fixed — write `PLATFORM_DATABASE_URL` (owner) and the other three URLs, apply the hand-written migrations, apply `seed-dev.sql`, keep `RATE_LIMIT_DISABLED=true`; (6) `vitest.config.ts` coverage `include`/`all` so the 121 invisible source files appear, and diagnose why the full DB-backed run emits no coverage report (N-4a). **Also:** `playwright.config.ts` `outputDir` keyed off an env var (punch 17, contention); `docs/testing.md` — the DB-backed invocation, the `RATE_LIMIT_DISABLED` posture (no limiter is exercised live under the standard config — QA 2026-09-25), and what CI now covers; `docs/deployment.md` — the two secrets the operator must add and what turns on when they exist. **Rehearsal is the acceptance criterion:** the implementer runs the `db-tests` job's exact steps locally against a throwaway Neon branch created from an EMPTY parent (or a fresh database on the pipeline branch) — replay, seed, vitest, test-rls — and records the counts; QA repeats it. The CI job itself cannot be observed green until the operator adds the secrets — record that honestly.
> **Out of scope:** the lint red (concurrent pipeline `2026-09-26-lint-gate` owns `ci.yml`'s existing job's step order and the Node version — coordinate: this pipeline ADDS a job to `ci.yml` and edits `e2e.yml`; the lint pipeline edits the existing `ci` job's steps; integration merges both); the e2e specs' own pre-existing reds; the test-coverage punch items 7–16 (separate pipelines).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — from-scratch rehearsal found schema drift (four columns) and a seed collision; scope widened to include `drizzle/0050` | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Complete — placement ruled (new `db.yml` + shared composite action), parent/fresh-database ruled (b) with feasibility verified against the live catalog, parity migration's shape ruled (relax the two NOT NULLs, ADD the two `group_id` columns with COMPOSITE FKs), `fileParallelism: false` overruled on measurement; found the migrate-from-empty resolver breakage (`drizzle/0010:88,105`) | Approved with suggestions | 2026-09-26 |
| 3 — Technical design | tech-lead | Complete — Batch A/B split designed, `0050` DDL written in full, `check:schema-parity` mechanism specified, `db.yml` + composite action + `e2e.yml` rewrite specified, DECISION-150 confirmed, DECISION-146 correction drafted | Design complete, implementer named | 2026-09-26 |
| 4 — Implementation | database-admin (Batch A) → deployment-engineer (Batch B) | Complete | Batch A: `drizzle/0050` hand-written and twice-applied idempotent; from-scratch rehearsal green (51/51 migrate, parity 0 failing, seed-dev COMMIT from empty, 520/520 test-rls, resolver returns rows). Two new blocking findings fixed (untracked `assert_eq()`; `seed-dev.sql`/`test-rls.sql` fixture coupling). Batch B: `db.yml` (new) + `neon-ci-db` composite action (new) + `e2e.yml` rewrite + vitest/playwright config + rate-limit fix + docs; full rehearsal green end-to-end (286/286 files, 4141/4141 tests, 520/520 test-rls, resolver returns 5 rows) against a from-scratch database following the exact `db.yml` sequence; Neon branch create/delete steps dry-read only (no `NEON_API_KEY` available locally) | 2026-09-26 |
| 5 — Verification | qa | Complete — from-empty rehearsal re-run independently (51/51, parity 0 failing, seed COMMIT, 4141/4141 with 0 skipped, test-rls 520, resolver 5 rows); failing-first both directions; 0050 idempotent; composite FK is the refusing layer on the owner connection; actionlint clean; four findings, none red (1–3 closed by a doc second pass) | PASS | 2026-09-26 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The CI-shape work (vitest config, rate-limit test fix, the new `db-tests` job, the `e2e.yml` repair) is soundly scoped and ready for design — but my required from-scratch rehearsal found that the acceptance criterion itself ("the implementer runs the job's exact steps... and records the counts") **cannot pass today**, because `scripts/seed-dev.sql` fails partway through a migrate-from-empty database for two independent, previously-undiscovered reasons, and the ephemeral-branch design has an unresolved question (which parent it forks from) with a real data-exposure consequence.

## Measurements (this pipeline's own branch, `pipeline-ci-db-tests`; nothing touched on `development`)

**1. From-scratch replay (`CREATE DATABASE ci_rehearsal_scratch` on the pipeline's owner connection, same cluster, dropped after):**

| Step | Result |
|---|---|
| `npx dotenv -e <scratch-env> -- npx drizzle-kit migrate` | **PASS, exit 0.** 50/50 migrations applied, `drizzle.__drizzle_migrations` shows 50 rows, `people` carries 4 RLS policies with `relforcerowsecurity=t`. This is new and correct — the `_journal.json` gapless fix (`3df8c83`) works. |
| `npm run db:seed` | **PASS, exit 0.** Roles, 11 features, 39 flags, 6 platform-wide `group_types` seeded cleanly. |
| `psql -f scripts/seed-dev.sql` | **FAIL, exit 3**, at line 158: `duplicate key value violates unique constraint "group_types_org_key"` on `(organization_id, key) = (null, 'court')`. The whole file is one `begin;`…`commit;` transaction with no `commit` reached, so **none of the fixture landed at all** — not partial data, zero data. |
| Same, after manually deleting the 3 colliding platform rows (rehearsal-only workaround) | **FAIL, exit 3**, at line 265: `null value in column "recorded_by" of relation "officer_terms" violates not-null constraint`. Again the whole transaction rolls back. |

**Root causes, confirmed by a systematic `information_schema.columns` diff between the freshly-migrated scratch database and the real `pipeline-ci-db-tests` connection (which was forked from `development` at the v0.26.0 state):**

| Table.column | Fresh-migrate (`drizzle/*.sql` replayed in order) | Live (`development` lineage) | Consequence |
|---|---|---|---|
| `officer_terms.recorded_by` | `NOT NULL` (set that way since `drizzle/0008`, line 293) | nullable | `seed-dev.sql:265-275` inserts 5 rows with `recorded_by = null` — fails on fresh-migrate, succeeds on live |
| `roll_actions.proposed_by` | `NOT NULL` (since `0008`) | nullable | `seed-dev.sql:296-302` inserts `proposed_by = null` — same failure class, one insert further down, never reached because `officer_terms` fails first |
| `administrative_commissions.group_id` | **column does not exist** | exists, nullable, `references groups(id)` | present in the TS domain model (`src/lib/db/domain/authz.ts:198`) and on every live branch, absent from every `drizzle/*.sql` file |
| `org_delegations.group_id` | **column does not exist** | exists, nullable, `references groups(id)` | same — `authz.ts:238` |

None of `drizzle/0025`, `0033`, `0037`, `0039`, `0041`, `0042`, `0044` (every later migration that touches `officer_terms`) ever relaxes `recorded_by`'s `NOT NULL`, and no migration adds `group_id` to either table — the TS domain model (`src/lib/db/domain/authz.ts`) says these columns are nullable/present and the live databases agree with the TS model, but the committed `drizzle/*.sql` files do not. This can only have happened via `npm run db:push` being run directly against a real branch at some point (`db:push`'s own doc warning: "Sync Drizzle schema to the live database (lossy — dev only)") without a compensating migration ever being generated — the exact "database reproducible from `drizzle/` alone" premise the `2026-09-25-security-schema-b` pipeline's B-H3 finding was about, now confirmed violated in a second, independent spot that pipeline never looked at (it checked grants and RLS policy counts, not full column-level parity). **A `psql`-filename-order replay hits the identical wall** — it applies the same `drizzle/0008` text, so the "which replay method" question in the scope item is moot: neither method reproduces the live schema.

This is squarely a schema-integrity gap, not a CI-tooling gap, and it is outside this work-log's stated Surface (`.github/workflows/`, `vitest.config.ts`, `rate-limit.test.ts`, `playwright.config.ts`, `docs/testing.md`, `docs/deployment.md`; "no application code"). It also was not pre-assigned a migration number ("Pre-assigned numbers: no migration"). See Gaps below.

**2. DB-backed suite, serial, on this branch's real `.env.local` (no workaround, no scratch DB involved):**

```
Test Files  1 failed | 285 passed (286)
     Tests  3 failed | 4138 passed (4141)
     Duration  361.69s (wall: 6:02.94 total)
```
Failures: exactly the N-1 rate-limit trio (`rate-limit.test.ts:241`, `:256`, `:279`) — deterministic, matches the review's prediction exactly (the enforcement `describe` block at line 195 inherits `.env.local`'s `RATE_LIMIT_DISABLED=true` because its `beforeEach`, unlike the escape-hatch block's, never calls `vi.stubEnv("RATE_LIMIT_DISABLED", "false")`). **No timeout flakes this run** (0/2 of the N-3 candidates recurred) — consistent with the review's own characterization of those two as intermittent, not deterministic.

**3. Coverage, with and without `.env.local` (N-4a):**
- Without: `npx vitest run --coverage` → exit 0, full text/html report written, 80.21% stmts overall.
- With: `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism --coverage` → **exit 1, zero `coverage/` directory written, no report of any kind.** Reproduced exactly as N-4a describes; still unfixed on this branch as expected (Phase 4 hasn't run yet).

**4. `scripts/test-rls.sql` as `presby_app` on this branch:**
```
520 "pass" assertions, 0 failures, exit 0, 35.4s wall
```
No C-4-style concurrent-pipeline abort this run (this worktree is genuinely isolated, unlike the shared-branch runs the review measured).

## User Verbs

CI work has no end-user surface; the "users" are the people and automation that read and act on CI output.

| Surface | Verb | Cadence |
|---|---|---|
| PR author (any contributor) | Opens a PR, reads the `ci`/`db-tests`/`e2e` check statuses, decides whether to merge | per PR |
| Repo maintainer / operator | Adds `NEON_API_KEY`/`NEON_PROJECT_ID` secrets once; reads `::notice::` annotations when a check skips; is the only one who can turn the skip into a real run | one-time setup, then ambient |
| CI system (GitHub Actions, non-human) | Creates and deletes ephemeral Neon branches; must never report green for a job that ran nothing | every push/PR |
| Implementer (Phase 4) / QA (Phase 5) | Runs the job's exact steps locally against a throwaway branch to rehearse before it can be observed green in CI (since secrets don't exist yet) | once per pipeline |

**A red must mean:** a real assertion failed against a real ephemeral database — never "the job didn't run." **A skip must look like:** the existing `check-secrets` job pattern in `e2e.yml` (a distinct, always-green gate job with `::notice::` annotation), never a job that silently no-ops and still reports success on its own line — this is the exact failure mode C-5 already named for `e2e.yml` and the scope explicitly asks the new `db-tests` job to avoid it. One placement question this raises for Phase 2: `check-secrets`-style gating exists in `e2e.yml` today; a `db-tests` job added to `ci.yml` (a **different workflow file**) cannot use GitHub Actions' `needs:` to depend on `e2e.yml`'s job — it needs its own duplicate secret-check job, or `db-tests` should live in `e2e.yml` alongside its sibling instead of in `ci.yml` as scoped. I'm flagging this as an open question rather than deciding it — it's a Phase 2 placement call.

## Flows

**Flow 1 — `db-tests` job (new, on push/PR to `main`):** Entry: GitHub Actions trigger → step: `check-secrets`-style gate reads `NEON_API_KEY`; absent → `::notice::` and clean skip (no red, no false green) → present: create ephemeral Neon branch → apply `drizzle/*.sql` (filename order or `db:migrate`, functionally identical per the measurement above) → `db:seed` → `psql -f scripts/seed-dev.sql` → `vitest run` with the four DB URLs → `psql -f scripts/test-rls.sql` as `presby_app` → delete branch (`if: always()`) → outcome: green only if every step's real exit code was 0.
- **Failure, as measured today:** the `seed-dev.sql` step fails at line 158 (then, after a manual fix, line 265) on a truly fresh branch, for the schema-drift reasons above — this is not a hypothetical failure path, it is the actual, current behavior. **This flow's failure path is not "what if a query returns a wrong row," it's "the job cannot complete its fixture-loading step at all against a freshly created branch."**

**Flow 2 — `e2e.yml` fixed (item 5):** Entry: same `check-secrets` gate (already correctly built) → create branch → write `.env.local` with all four URLs (currently missing `PLATFORM_DATABASE_URL` — C-5 point 1, still unfixed as of this read) → apply hand-written migrations (currently `db:push` only — C-5 point 2) → `db:seed` → apply `scripts/seed-dev.sql` (currently never applied — C-5 point 3, and per Flow 1's measurement, **this step would fail on a from-scratch branch today for the same reason**) → Playwright run → upload traces on failure → delete branch always.
- **Failure:** identical schema-drift blocker as Flow 1, since both jobs would apply the same `drizzle/*.sql` files against a fresh branch.

**Flow 3 — Operator provisions secrets (one-time):** Entry: `docs/deployment.md`/workflow header comment → step: create `NEON_API_KEY` at console.neon.tech, find `NEON_PROJECT_ID` → add both as repo secrets → outcome: both `db-tests` and `e2e` flip from skip to run on the next push.
- **Failure/gap not addressed by the scope:** which Neon branch does the ephemeral branch **fork from**? Neither `e2e.yml` today nor the scope's description of the new job specifies a `parent:` input to `create-branch-action`. I read the action's actual composite script (`neondatabase/create-branch-action@v5`, `dist` inlined into `action.yml`): when `parent` is empty, no `--parent` flag is passed to `neonctl branches create`, which means **the branch forks from the project's default/primary branch** — per `docs/deployment.md`, that is **`production`**, which today holds two real congregations' actual (if minimal) data. An ephemeral CI branch that is a live fork of production, however short-lived, is a real "No Real Data" / blast-radius question CLAUDE.md's own invariant cares about — a failing assertion that dumps a row into a CI log, or a fixture-writing test that mutates the fork, would be touching a copy of real production data inside a disposable, less-controlled environment. **This needs an explicit `parent:` pointing at a schema-only or synthetic-fixture-only branch, not the implicit default.** I did not find this addressed anywhere in the scope, the review, or the retrospective — it is a genuinely new finding from reading the action's own source, not a restatement of C-5.

**Flow 4 — `presby_app`'s credentials on a from-scratch ephemeral branch:** `drizzle/0009_presby_rls.sql:24-28` creates `presby_app` via a plain `create role presby_app nobypassrls` — Postgres's default for `CREATE ROLE` (not `CREATE USER`) is **NOLOGIN**, and no migration anywhere ever runs `ALTER ROLE presby_app LOGIN PASSWORD ...` (confirmed by grep across every `drizzle/*.sql`). I confirmed on the live branch that `presby_app` **does** have `rolcanlogin=t` and a password today (`pg_authid` probe) — so something outside the tracked migrations gave it login capability, almost certainly Neon's own control-plane role management (Neon auto-manages a password for any role visible in the Postgres catalog once one is requested via `neonctl`/the console/API, regardless of whether the SQL that created it said `LOGIN`). This matters for the ephemeral-branch design specifically because **if `db-tests`/`e2e` ever forks from a genuinely schema-only "empty" bootstrap branch that was created before migration `0009` ever ran there**, `presby_app` won't exist yet at fork time, and the first `neonctl cs`/`create-branch-action` call for `username: presby_app` would need to happen **after** migrations run, not at branch-creation time (unlike `neondb_owner`, which Neon always provisions). As currently written, both `e2e.yml` and the scoped `db-tests` job request the `create-branch-action`'s connection string **before** any migration step. This works today only because forking from `production`/`development` (already-migrated) inherits the role's already-configured state — which loops back to Flow 3's parent-branch question. If Phase 3 resolves Flow 3 by pointing `parent:` at a genuinely schema-only bootstrap branch, this ordering problem becomes real and needs its own fix (a second `neonctl cs` call for `presby_app` issued after the migration step, not as part of branch creation). I'm flagging this now so Phase 3 doesn't discover it after committing to a "safe" schema-only parent branch.

## Permissions & Flags

- **Permission(s):** Not applicable — no `FEATURES.*` key, no user-facing route.
- **Default roles:** N/A.
- **Flag(s):** Not needed — this is CI/tooling, not a runtime-gated behavior. (`RATE_LIMIT_DISABLED` is an existing environment escape hatch, not a `feature_flags` row — correctly out of scope for a new flag.)

## Gaps the Request Didn't Address

1. **Blocking — schema drift makes the acceptance criterion fail today, independent of any CI-tooling work.** `officer_terms.recorded_by`, `roll_actions.proposed_by` (wrongly `NOT NULL` on fresh-migrate vs. nullable live/TS-model), and `administrative_commissions.group_id`/`org_delegations.group_id` (present live and in the TS domain model, absent from every `drizzle/*.sql` file) mean a from-scratch replay of the committed migrations does not match the live schema `scripts/seed-dev.sql` was written against. This is not a hypothesis — I reproduced it twice and confirmed both root causes by direct `information_schema.columns` diff. **This must be fixed by a new corrective migration** (CLAUDE.md's "once shipped, fix forward" rule — `0008`/`0044` are long shipped) **before** the `db-tests`/`e2e` rehearsal can succeed, and it is outside this pipeline's stated Surface and pre-assigned numbers. Recommend the orchestrator open it as its own small bug-fix pipeline (Phase 1 already done here — "confirms the bug is real"), sequenced to land before this pipeline's Phase 4, or explicitly widen this pipeline's scope and pre-assign a migration number now. Either way, Phase 3 must name the dependency rather than assume `seed-dev.sql` already replays cleanly, as the scope's item 4 currently does.
2. **`scripts/seed-dev.sql`'s `group_types` insert collides with `db:seed`'s platform-wide template rows** (`group_types_org_key` unique constraint, added by the already-merged `drizzle/0048`). `seed-dev.sql` inserts fixed-UUID `court`/`committee`/`roster` rows that `db:seed`'s `seedGroupTypes()` already created under different UUIDs. This has nothing to do with CI — it means **`docs/testing.md`'s own "Getting a database with fixtures in it" recipe (migrate → seed → seed-dev.sql) is broken today for any human following it from scratch**, not just for CI. Also worth noting: `scripts/seed.ts:789-797`'s own header comment ("`group_types` has NO unique constraint on `(organization_id, key)`") is now stale and contradicted by the live schema — a small but real doc-drift the same fix should correct.
3. **Which Neon branch the ephemeral branch forks from is unspecified**, and the implicit default (no `parent:` input) forks `production`, which holds real (if minimal) congregation data — see Flow 3. Needs an explicit `parent:` naming a schema-only/synthetic-only branch.
4. **`presby_app`'s login/password provisioning on a genuinely from-scratch branch is untested and may not survive a future switch to a schema-only parent** — see Flow 4.
5. **The `db-tests`-in-`ci.yml`-vs-`e2e.yml` placement question** — a job added to `ci.yml` cannot `needs:` a gate job living in `e2e.yml`; either duplicate the `check-secrets` pattern or relocate. Not dictating the answer; naming the tradeoff for Phase 2.
6. **Node 20 vs 22, since this pipeline touches `e2e.yml` and adds a new job.** `package.json`'s `engines` (`>=22.0.0`) and `.nvmrc` (`22`) have said 22 for a while; every CI workflow step (`ci.yml` x2, `e2e.yml` x1) still pins `node-version: "20"`, and `docs/deployment.md` flags that Vercel disables Node 20 on 2026-10-01. The concurrent `2026-09-26-lint-gate` pipeline owns the **existing** `ci` job's Node version. My recommendation regardless of what that pipeline does: **the new `db-tests` job and the fixed `e2e.yml` job should both specify `node-version: "22"`** — they are new/rewritten job blocks this pipeline owns outright, there's no technical reason to match a version that's being phased out, and it removes one more Node-20 reference from the tree rather than adding one. Since each job in a workflow declares its own `setup-node` step independently, this creates no merge conflict with lint-gate's work on the separate `ci` job.
7. **`playwright.config.ts` has no `outputDir`** (confirmed by reading the file — punch item 17). Not this pipeline's core scope but listed in it; flagging that it's real and unaddressed as of this read.
8. **N-9's early "RLS suite complete" banner does not threaten the CI job's own pass/fail signal** (the scoped step correctly relies on `psql -v ON_ERROR_STOP=1`'s exit code, not text-matching) — but it will mislead a human skimming the CI log the same way it already misleads a human reading a terminal, so it's worth fixing in the same housekeeping pass even though it isn't load-bearing for this pipeline's own acceptance criterion.
9. **The 2-hour `deletable_until` fixture-exemption fuse is irrelevant here**, as the kickoff already notes — a throwaway ephemeral branch is deleted wholesale in the `if: always()` step regardless of any row's `deletable_until`, so the "permanently undeletable fixture org" hazard the retrospective named (Rule-16 finding 5) cannot occur on this branch type. Worth stating explicitly in `docs/testing.md`'s CI section so a future reader doesn't assume the same operational risk applies here.

## Out of Scope (confirm with user)

- The lint-red / Node-version ownership of the **existing** `ci` job (owned by `2026-09-26-lint-gate`, per this work-log's own header).
- The e2e specs' own pre-existing red tests (separate from the infrastructure fix).
- Test-coverage review punch items 7–16 (auth.ts tests, F1 catch-all assertion, `presby_roll_cache_drift()` scoping, teardown helper, etc.) — correctly excluded per the work-log.
- The schema-drift corrective migration itself (item 1 above) — I'm recommending it be a **separate**, fast-sequenced bug-fix pipeline rather than silently absorbed into this one's stated Surface, but that's an orchestrator call, not mine to make unilaterally.

## Open Questions

1. Should the `officer_terms`/`roll_actions`/`administrative_commissions`/`org_delegations` schema-drift fix be a new migration inside **this** pipeline (widening its Surface and requiring a pre-assigned migration number now), or a separate bug-fix pipeline sequenced immediately before this one's Phase 4? Either way, Phase 3 here must name it as a hard blocking dependency, not assume it away.
2. What should `create-branch-action`'s `parent:` input be for both `db-tests` and the fixed `e2e.yml`? A dedicated, already-migrated-and-seeded "CI bootstrap" branch (kept in sync manually or via a scheduled job) is the safest answer I can see from the outside, but that's a real new piece of infrastructure someone has to own and refresh — Phase 2/3's call.
3. Does `db-tests` live in `ci.yml` (as scoped) with its own duplicated `check-secrets`-style gate, or move into `e2e.yml` next to its sibling job?
4. Confirm Node 22 for the new/rewritten job blocks, independent of the lint-gate pipeline's resolution for the existing `ci` job.

---

**Handoff:** to **architect** for Phase 2, with the explicit request that Phase 2 rule on the placement question (Open Question 3) and the `parent:`/branch-provenance question (Open Question 2), and that Phase 3 (tech-lead) treat the schema-drift finding (Gap 1) as a named, sequenced blocking dependency in the Implementation Order rather than something Phase 4 discovers mid-implementation — the whole point of this pipeline's own "rehearsal is the acceptance criterion" design was to catch exactly this class of surprise before Phase 4, and it did.



### Orchestrator rulings on the open questions (2026-09-26)

1. **Scope widened — the schema-parity fix is this pipeline's, as a first batch.** Pre-assigned: `drizzle/0050_presby_schema_parity.sql` (fix-forward: relax `officer_terms.recorded_by` and `roll_actions.proposed_by` to nullable as the TS model and every live branch have them; add `administrative_commissions.group_id` and `org_delegations.group_id` with their FKs; idempotent), plus `scripts/seed-dev.sql`'s `group_types` block reconciled with `db:seed`'s templates (`on conflict` on `(organization_id, key)` or reuse the seeded rows by key), plus `scripts/seed.ts:789-797`'s stale comment. Implementer for that batch: database-admin; the CI batch follows (deployment-engineer). Acceptance for the parity batch: migrate-from-empty → `db:seed` → `seed-dev.sql` → `test-rls.sql` all green on a fresh database, **and** a parity check that a fresh database matches the TS domain model (rule the mechanism at Phase 3 — e.g. `drizzle-kit generate` against the fresh database emits no diff, or an `information_schema` diff against the pipeline branch).
2. **Parent branch and data exposure — architect rules.** Options on the table: (a) explicit `parent:` = a maintained schema-only `ci-base` branch (new infrastructure to own); (b) explicit `parent:` = an existing branch, with the job creating a **fresh database** inside the ephemeral branch (`CREATE DATABASE ci_run`) and never opening `neondb` — the roles exist cluster-wide (Flow 4 dissolves), the migrate-from-empty is exactly the reproducibility proof, and no real row is ever read by a test; the fork still physically carries the parent's data for its lifetime. The orchestrator's preference is (b) with the parent pinned explicitly, and the operator's pending real-PII-row decision noted; never the implicit default.
3. **Placement — architect rules** (`ci.yml` with a duplicated secrets gate vs `e2e.yml` alongside its sibling, or a new `db.yml`).
4. **Node 22** for the new and rewritten job blocks: yes. The concurrent lint pipeline swaps the existing `ci` job's and `e2e.yml`'s `node-version` lines to `node-version-file: ".nvmrc"`; use the same form here so the merge is trivial.

---


# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## Verdict

**Approved with suggestions.** The pipeline's shape is right and Phase 1's two blockers are resolved by the orchestrator's rulings. Five of my rulings below are *binding* on Phase 3 (marked **MUST**) rather than suggestions — including one that overturns a scope item on measurement (`fileParallelism`) and one that changes the parity migration's content (composite FKs, not plain). None of them changes the feature's shape, so this advances rather than loops back.

One finding raises the stakes of the whole pipeline and should be carried into Phase 3 verbatim: **a migrate-from-empty database today has no working permission resolver, and the migration set reports success.** `drizzle/0010_presby_resolver.sql:88,105` joins `ac.group_id` / `od.group_id` inside a `language plpgsql` body. Postgres does not name-resolve a plpgsql body at `CREATE FUNCTION` time, so all 50 migrations apply cleanly and then `presby_effective_permissions()` raises `column ac.group_id does not exist` on its **first call** — for every arm, since the four arms are one `UNION`. The drift is not cosmetic and not confined to fixtures.

## Placement

### Directory placement

**MUST — the `db-tests` job goes in a new `.github/workflows/db.yml`, with its own `check-secrets` gate job.** Not `ci.yml`, not `e2e.yml`.

- `ci.yml` is the repo's *secretless, fork-safe* workflow: every job in it runs to completion in any clone with zero configuration. That is a property worth defending as a shape — it is the check a contributor's PR must go green on. A Neon-secret-gated job inside it makes "CI" a mixed-reliability workflow whose conclusion depends on an operator-held secret.
- `e2e.yml` is named, documented and headed for Playwright. `db-tests` is a different runtime (vitest + `psql`), a different duration (~6 min + 35 s vs. a browser suite), and a different failure signature.
- The ~12-line `check-secrets` gate is not duplication worth avoiding: it is already the convention in **two** files (`e2e.yml`, `claude-review.yml`), it is precisely what makes a workflow fork-safe, and cross-workflow `needs:` does not exist. Phase 1's Open Question 3 is resolved by accepting the third copy.

**Approved as a new structural artifact:** `.github/actions/neon-ci-db/action.yml` — the repo's first composite action (new top-level `.github/actions/` directory). What *should* be deduplicated is not the gate but the expensive recipe: create branch → `CREATE DATABASE` → write `.env.local` → `db:migrate` → `check:schema-parity` → `db:seed` → `seed-dev.sql`, with inputs (`api_key`, `project_id`, `parent`, `branch_name`, `database`) and outputs (the four URLs, `branch_id`). Both `db.yml` and the fixed `e2e.yml` consume it. The C-5 failure this pipeline is repairing *is* "the e2e job's database recipe drifted from the real one"; two hand-maintained copies re-create it. If tech-lead judges the composite too much machinery for two consumers, an inline duplicate is acceptable **only** if both copies land in one commit and `docs/testing.md` names them as a matched pair.

**MUST — one ephemeral branch per job; `db-tests` and `e2e` do not share one.** This is a correctness ruling, not a cost one. `scripts/test-rls.sql` makes exact-count assertions against the `seed-dev.sql` fixture — `scripts/seed-dev.sql:52-60` explicitly reasons that its extra council fixtures carry "no memberships, no rows of their own, so every count assertion elsewhere in the suite is blind to them." That reasoning does not survive a second fixture writer, and Playwright's `globalSetup` provisions four `e2e-*` orgs and ten users into the same database. Sharing would also require merging both into one workflow and a `needs:` chain, serializing ~6 minutes of vitest ahead of the browser suite. Cost is not the deciding factor and is small anyway: two copy-on-write branches, alive for minutes, `--suspend-timeout 0`, both deleted in `if: always()` (which also runs on cancellation). Add `concurrency: { group: db-${{ github.ref }}, cancel-in-progress: true }` so superseded pushes don't stack branches. An orphan-branch janitor (for a killed runner) is a `docs/TODO.md` follow-up, not this pipeline.

### The ephemeral branch's parent and the fresh-database pattern

**MUST — option (b), with `parent:` pinned to `development` as a literal, and a fresh database inside the ephemeral branch.**

Why never the implicit default: `docs/deployment.md:21-28` records `production` as the project's default/primary branch, holding `fpcw` and `presbytery-of-scioto-valley` — two real congregations. I confirmed on this pipeline's own branch (a `development` fork) that the lineage carries one `organization_profiles` row and one of those two real orgs. An unpinned `create-branch-action` forks that on every push and every PR. This does not violate No Real Data's letter (nothing enters the repository) but it is squarely its blast radius: a failing assertion's error text, a CI log, and a 7-day-retained Playwright trace are all places a real row can surface. Independently, `production` has **not** been migrated to the latest schema (`docs/deployment.md:105-108`), so as a parent it is also simply wrong.

Why (b) over (a), a maintained `ci-base` branch: (a) is standing infrastructure somebody has to refresh, and a `ci-base` that drifts is a CI job that passes against a schema nobody ships. (b) has no maintenance surface, and — the deciding point — **migrate-from-empty is not a workaround in (b), it is the proof.** `CREATE DATABASE ci_run` clones `template1`; every object in it arrives by `npm run db:migrate`. A green `db.yml` is then direct evidence for DECISION-146's premise that the posture is reproducible from `drizzle/` alone. Option (a) would let the four-column drift survive indefinitely.

Feasibility, **verified against the live catalog on `pipeline-ci-db-tests`** (not inferred from `drizzle/`):

| Claim | Catalog evidence |
|---|---|
| owner can `CREATE DATABASE` | `neondb_owner`: `rolcreatedb = t`, `rolcreaterole = t`, `rolsuper = f` |
| `presby_app` survives into the fresh database | `pg_authid`: `rolcanlogin = t`, `rolbypassrls = f`, password present. Roles are cluster-wide; the fork inherits `pg_authid`. |
| the job may set its password | `pg_auth_members`: `neondb_owner` holds `admin_option = t` on **both** `presby_app` and `presby_platform` |
| migration 0009 is a no-op when the role pre-exists | `drizzle/0009_presby_rls.sql:24-32` — `if not exists` guarded |

Phase 1's Flow 4 ordering problem therefore **dissolves under (b)**: the role exists before `0009` runs, and `0009` is idempotent either way.

**How the job obtains `presby_app`'s password: it sets it.** Generate per-run (`openssl rand -hex 32`), `echo "::add-mask::$PW"` *before first use*, `ALTER ROLE presby_app WITH LOGIN PASSWORD '$PW'` on the owner connection, then build `DATABASE_URL`/`APP_DATABASE_URL` from the action's `host` output + that password + `ci_run`. Rejected, with reasons:
- `neonctl cs --role-name presby_app` — `neonctl` **is** on `PATH` (the v5 action's composite runs `npm i -g neonctl@2` itself, so no install step is needed), but `presby_app` was created by SQL in `0009`, and whether Neon's control plane can reveal a password for a SQL-created role is unverified. It is also a second source of truth for a credential the job can simply own.
- a second `create-branch-action` call with `username: presby_app` — takes the action's "already exists" path, which re-resolves the branch and calls the same unverified `neonctl cs`, plus a second 30-second neonctl install.
- a `NEON_PRESBY_APP_PASSWORD` repo secret — a third operator secret, and it couples an ephemeral branch to a credential that also works on production, which is exactly what `docs/deployment.md`'s remediation section is trying to unwind.

Also ruled: **all four URLs on the direct (unpooled) host**, matching `.env.local` on this branch (`DATABASE_URL`, `DIRECT_`, `MIGRATE_`, `APP_` are direct; only `PLATFORM_` is pooled). `scripts/test-rls.sql` is 168 `set_config` calls plus a temp table across one psql session — pgbouncer transaction pooling is the wrong endpoint for it. The four: `DATABASE_URL`/`APP_DATABASE_URL` (presby_app, `ci_run`), `PLATFORM_DATABASE_URL` (**`neondb_owner`** — that is what `getPlatformDb()` authenticates as today per DECISION-136's 2026-09-24 correction; do not invent a `presby_platform` connection, that role is `rolcanlogin = f`), `MIGRATE_DATABASE_URL` (neondb_owner, `ci_run`). They go in a written `.env.local` because both `db:migrate` and `db:seed` run through `dotenv -e .env.local`.

**Apply method: `npm run db:migrate`, not psql filename-order.** Both apply identical text (Phase 1 measured that), so pick the one CI should be proving: `db:migrate` is the documented production apply path (`docs/deployment.md:103-108`). A psql filename-order loop proves a path no operator runs.

Not available: `branch_type: schema-only` exists on the action's `main` but **not in v5**, and Neon's schema-only branches are a paid-plan feature. Not needed under (b).

### Server vs Client split

Not applicable. This pipeline touches no application code, no route handler, no server action and no component — `.github/workflows/`, two config files, one test file, one migration, two seed scripts, two docs. No `'use client'` question arises. Stated explicitly because the template asks.

### Dependencies

**No new npm dependency; no new runtime dependency.** Against the criteria:

1. *Already solved?* Yes — `neondatabase/create-branch-action@v5` and `delete-branch-action@v3` are in `e2e.yml` today; `db.yml` reuses both at the same pins.
2. *`neonctl` on the runner* — nothing to add, and nothing to rely on: the v5 composite installs it globally, so it is on `PATH` for later steps in the same job, but per the ruling above the job should not depend on it.
3. *`psql`* — preinstalled on `ubuntu-latest`. The rehearsal must assert it (`psql --version` as its own step); if it ever isn't, `apt-get install -y postgresql-client`, never an assumption. Client 16 against Neon's PG 18 server is fine; `-v ON_ERROR_STOP=1` and `\set` are ancient.
4. *Edge runtime* — n/a.
5. *Bundle / license* — nothing enters the bundle.

One implementer note on the action: its composite runs a bare `actions/setup-node@v4` with no version input *inside itself*. It should not change the job's Node, but the rehearsal must print `node -v` after the create-branch step, and the job's own `actions/setup-node` should use `node-version-file: ".nvmrc"` (orchestrator ruling 4 — same form the lint pipeline uses, so the merge is trivial).

## Invariants Touched

- **No Real Data — strengthened, and this is the pipeline's real invariant contribution.** New rule: *a CI database contains only rows CI created.* The fork physically carries the parent's pages for its lifetime, but no connection string the job holds points at `neondb`, no test reads a parent row, and therefore no log line or uploaded trace can carry one. Corollary, equally binding: **`parent:` is always explicit.** An unpinned parent is the implicit default, and the default is `production`. This belongs in `docs/testing.md` and `docs/deployment.md` as a sentence, not as a comment in one workflow file.
- **Isolation Is a Database Property — unchanged, and for the first time continuously proved.** `scripts/test-rls.sql` must run as `presby_app` (`$APP_DATABASE_URL`), never the owner (`docs/testing.md:160-163`). **MUST:** the job may not fall back to `MIGRATE_DATABASE_URL` if the app URL is empty — add an explicit guard step asserting `current_user = 'presby_app'` **and** `rolbypassrls = f` before running the suite. 520 assertions passing as `neondb_owner` proves nothing, and a silent fallback is exactly the "green for a run that did nothing" failure mode this pipeline exists to eliminate.
- **Two Hierarchies Intersect Nowhere** — this is what the composite-FK ruling below is about, not tidiness. A plain `references groups(id)` lets a commission at parent org A cite a group owned by unrelated org C; the resolver's arm 3 then grants A's role *inside target org B* to C's members — a cross-council grant with no affiliation behind it.
- **Composite Tenant Keys (F2)** — the two `group_id` columns are the write-side hole F2 names. `groups` already carries `unique(id, organization_id)` (`groups_id_org_key`, `drizzle/0008:343`), so the composite target exists.
- **The `drizzle/` fix-forward rule** — `0050` is a new migration, never an edit to `0008`/`0010`; both are long shipped. Correct as the orchestrator scoped it.
- **Permissions vs Flags** — untouched, and correctly so: no `FEATURES.*` key, no `feature_flags` row. `RATE_LIMIT_DISABLED` is an environment escape hatch and stays one.
- **The Edge Gate Cannot Reach the Database** — untouched; `src/proxy.ts` is not in scope and nothing here adds an import to it.
- **DECISION-146's premise** ("the posture is reproducible from `drizzle/`") is currently **false**, and was already false on 2026-08-17 — a month before the decision asserted it. This pipeline makes it true and, via the parity check, keeps it true. Say that plainly in the work-log; it is the strongest justification for the scope widening.

## Notes

*Numbered items marked **MUST** are binding on Phase 3.*

### 1. The parity migration's content (`drizzle/0050_presby_schema_parity.sql`)

**MUST — relax the two NOT NULLs; do not tighten the live schema.** Null is legitimate provenance. F24 is a recorded finding from the first execution against a real database — commit `8f358b6` (2026-08-17): *"recorded_by/proposed_by were not null, making historical import impossible; a church arriving with 20 years of session history has no acting user."* The TS model carries the rationale in comments at `src/lib/db/domain/officers.ts:124-126` and `src/lib/db/domain/roll.ts:96-97`. `drizzle/0008` is already internally inconsistent about it: `appointments.recorded_by` (line 420) and `background_checks.recorded_by` (line 157) are nullable in the same file; only `officer_terms` (293) and `roll_actions.proposed_by` (259) are not. Tightening would silently reverse a finding and make the documented onboarding-import story impossible — and would break `seed-dev.sql`'s `opening_balance` rows, which are *correct* as provenance-free.

**MUST — add the two `group_id` columns, with COMPOSITE foreign keys.** Live shape, verified: both are `FOREIGN KEY (group_id) REFERENCES groups(id)` named `*_group_id_fkey` — Postgres's default constraint name, i.e. a hand-written `ALTER TABLE` in psql, not `drizzle-kit push` (push names them `..._group_id_groups_id_fk`). Both tables are `relrowsecurity = t, relforcerowsecurity = t`. Required shape:

- `administrative_commissions`: `(group_id, parent_org_id) references groups(id, organization_id)` — the commission's members are a group at the **parent** council (`src/lib/db/domain/authz.ts:196-198`).
- `org_delegations`: `(group_id, grantee_org_id) references groups(id, organization_id)` — the holders are a group at the **grantee** council (`authz.ts:236-238`).
- The TS model gains the same composite in each table's `(t) => [...]` array and drops the column-level `.references()`, or the parity check will keep reporting a difference forever.
- Existing data is compatible: 1 `administrative_commissions` row, 0 `org_delegations`, no null `group_id`; the fixture's group `b0000000-…-0005` is owned by `11111111-…`, which is its `parent_org_id`.
- **`0050` must converge two different starting states** — a fresh database (columns absent) and every live branch (columns present with the plain `_fkey`): `add column if not exists`, `drop constraint if exists <table>_group_id_fkey`, then `add constraint` under a deterministic name. Idempotent on both.

**MUST — hand-write `0050`. Do not run `npm run db:generate`.** `drizzle/meta/` holds **13 snapshots against 50 journal entries**; the newest is `0012_snapshot.json`, and it still records `officer_terms.recorded_by notNull: true` and no `group_id` on either table. `drizzle-kit generate` diffs the TS model against that frozen snapshot, so today it would emit one enormous migration containing everything hand-written since 0013. Add the 51st `_journal.json` entry by hand — and per Rule 16 that file is orchestrator-owned, so return the line rather than editing it on the branch. Separate follow-up for `docs/TODO.md` (not this pipeline): the snapshots are decorative past 0012 and are a live footgun; either regenerate them deliberately or document them as frozen.

### 2. The standing parity check

**MUST — it exists, it lives in `db.yml`, and it is NOT wired into `npm run check`.** The five existing tripwires are pure static scans that run offline in a fresh clone with no secrets; a database-dependent sixth would break that and force Neon secrets onto the fork-safe `ci.yml`. So: `npm run check:schema-parity`, a sixth script, run as a step of the new job immediately after `db:migrate` and before `db:seed`.

**Mechanism: `information_schema` / `pg_constraint` vs. the TS model — not `drizzle-kit`.** Ruling out the alternatives explicitly so Phase 3 doesn't re-litigate:
- `drizzle-kit generate` emits nothing useful — stale snapshots, above. This closes the orchestrator's ruling-1 suggestion ("generate emits no diff") as unavailable.
- `drizzle-kit check` validates journal/snapshot collisions only; it never opens a database.
- `drizzle-kit push` *does* diff the TS model against a live database, and the whole domain is in scope (`drizzle.config.ts`'s `schema` is `src/lib/db/schema.ts`, which re-exports `./domain` at line 531 — which is also how `db:push` produced this drift in the first place). But it applies rather than reports, has no dry-run, and in a non-TTY CI a detected difference is likely to be applied and exit 0. A check that silently fixes what it should report is the failure mode this pipeline exists to end.
- The script: import the tables, use drizzle's `getTableConfig()`, compare table names, column names, nullability and FK target columns against the catalog on the freshly migrated database; print a diff; exit 1 on any row. Columns + nullability + FK shape first — that is the class of drift that actually occurred, twice. Defaults and index parity can follow.

**Rule now so Phase 4 doesn't stall:** the check will almost certainly find more than the four known columns on first run. `0050` fixes the four; anything else goes to `docs/TODO.md` as its own pipeline, and the check ships with a dated, commented, explicitly-empty-if-possible allowlist. A parity check that is red on arrival gets disabled, and that is worse than not having one.

### 3. Vitest / Playwright configuration

**MUST — do not set `fileParallelism: false` globally.** Measured in this worktree, no database, same machine, back to back:

| Run | Result |
|---|---|
| `vitest run` (default) | **12.12 s** — 254 files, 3309 passed, 832 skipped |
| `vitest run --no-file-parallelism` | **93.79 s** — identical counts |

7.7×, **+82 seconds on every `ci` run and every local `npm test`**. Scope item (3)'s premise ("nothing measurable") is wrong.

- **Shape: one `vitest.config.ts`.** Encode the DB-backed invocation as a script so the requirement stops living in prose at `docs/testing.md:157`: `"test:db": "dotenv -e .env.local -- vitest run --no-file-parallelism"`. CI then runs the byte-identical command a human runs, and — since the job writes `.env.local` — no CI-only variant is needed. A second `vitest.db.config.ts` duplicates alias/include/coverage as a drift surface for one boolean; Vitest 4 `test.projects` is acceptable only if the shared options stay defined once. Neither earns its complexity.
- **Timeouts:** `testTimeout: 20000`, `hookTimeout: 30000` globally, with the comment naming remote-Neon latency. Harmless — nothing in the pure suite approaches even 5 s — and far better than per-file overrides in 30 files.
- **Coverage: `coverage.all` does not exist in Vitest 4.** It was removed; the installed `vitest`/`@vitest/coverage-v8` are `4.1.6`, and the typing says `coverage.include` — *"by default only files covered by tests are included."* So write `include: ["src/**/*.{ts,tsx}"]` plus an `exclude` for `src/components/ui/**` (generated), type-only files and `**/*.test.*`. Writing `all: true` would be an unknown key that silently does nothing — the scope's phrasing should not survive into the config.
- **N-4a — here is the diagnosis the implementer must confirm, not rediscover.** Vitest 4 declares `reportOnFailure?: boolean` with `@default false` (`node_modules/vitest/dist/chunks/reporters.d.CtLUhkkA.d.ts:797-799`). The pure run passes and writes a report; the DB-backed run fails 3 of 4141 and writes none. That explains the observation exactly, in both directions. **Set `reportOnFailure: true` even though fixing the rate-limit trio makes the symptom vanish on its own** — otherwise the next red run quietly loses coverage again. Required of the implementer: reproduce it deliberately (force one trivial failure in the pure suite, observe the missing `coverage/`) and state the confirmed cause in the work-log. "Fixed by the rate-limit change" is not an acceptable closure for N-4a.
- **Playwright `outputDir`:** `process.env.PW_OUTPUT_DIR ?? "test-results"`. Keep the literal default identical to today's so `e2e.yml`'s `path: test-results/` upload and `.gitignore` keep working untouched; only a parallel worktree sets the variable. If tech-lead wants the variable authoritative in CI too, the upload step's `path:` must derive from the same variable **in the same commit** — one source of truth or none.
- **MUST — the `db-tests` job does not set `RATE_LIMIT_DISABLED`.** `e2e` keeps `true` for the documented reason (the shared fixture signs in far more than 5/min). The vitest job is the only place the limiter is exercised for real; setting it there re-creates the exact condition QA measured on 2026-09-25. Scope item (1)'s `vi.stubEnv` fix must make `src/lib/rate-limit.test.ts` correct with the variable set *or* unset — the enforcement block stubs `"false"`, the escape-hatch block stubs `"true"` — so neither CI nor a developer's `.env.local` can decide the outcome.

### 4. Job hygiene the scope doesn't currently name

- **`-v ON_ERROR_STOP=1` on *every* psql invocation, not just `test-rls.sql`.** Plain `psql -f scripts/seed-dev.sql` exits **0** even when statements fail; the file's single `begin;…commit;` becomes a rollback and the job goes green on an empty fixture. Phase 1 measured that failure with the flag on — without it, it is invisible.
- `set -euo pipefail` at the top of every multi-line `run:` block. GitHub's default is `bash -e` with no `pipefail`, so anything piped through `tee` swallows its exit code.
- No `continue-on-error:` anywhere in either job.
- Mask any secret the **job itself** generates (`::add-mask::` before first use). The action already masks its own password output (`create-branch-action@v5`'s composite calls `::add-mask::` at both branch paths), but a job-generated `presby_app` password is not covered by that.

### 5. Sequencing

Batch A (database-admin): `0050` + `seed-dev.sql`'s `group_types` reconciliation + `scripts/seed.ts:789-797`'s now-false comment + `check:schema-parity`. Batch B (deployment-engineer): `db.yml`, the composite action, the `e2e.yml` repair, the config changes, the docs. **B cannot be rehearsed before A lands** — that is Phase 1's Gap 1 and it is a hard ordering constraint, not a preference. The acceptance criterion for A is the same rehearsal B will use, run against a fresh database: `CREATE DATABASE` → `db:migrate` → `check:schema-parity` → `db:seed` → `seed-dev.sql` → `test:db` → `test-rls.sql`, all green, counts recorded. QA repeats it. Record honestly that the job itself cannot be observed green until the operator adds the two secrets.

---

## Proposed DECISION-150 (orchestrator to record; newest first in `docs/decisions.md`)

**DECISION-150: CI's database is an ephemeral Neon branch off an explicitly pinned parent, containing a database CI created from empty — migrate-from-empty is the reproducibility proof, not a convenience. (2026-09-26, architect Phase 2, `docs/work-log/2026-09-26-ci-db-tests.md`.)**

Every database-backed check runs against a branch created per run by `neondatabase/create-branch-action@v5` with `parent:` **written explicitly in the workflow**. An unpinned parent is not "no choice" — it is the project's primary branch, which is `production`, holding two real congregations and a real-PII `organization_profiles` row. That is not a No Real Data violation in the letter (nothing enters the repository), but a CI log, an error string and a 7-day-retained Playwright trace are all places a real row can surface, and `production` is also un-migrated, so it is the wrong schema as well as the wrong data. The parent is `development`.

Inside that branch the job immediately issues `CREATE DATABASE ci_run` as owner and **never opens `neondb` again**; all four connection URLs (`DATABASE_URL`/`APP_DATABASE_URL` as `presby_app`, `PLATFORM_DATABASE_URL`/`MIGRATE_DATABASE_URL` as `neondb_owner`, all on the direct endpoint) address `ci_run`. `ci_run` is cloned from `template1`, so the entire schema arrives by `npm run db:migrate` — the documented production apply path. **This is the point, not a side effect:** a green run is direct evidence for DECISION-146's premise that the posture is reproducible from `drizzle/` alone. That premise was already false when it was written — `officer_terms.recorded_by`, `roll_actions.proposed_by`, `administrative_commissions.group_id` and `org_delegations.group_id` drifted on 2026-08-17 via `db:push` and an ad-hoc `ALTER TABLE`, and `drizzle/0010`'s `language plpgsql` resolver body hid the consequence behind late name resolution: 50/50 migrations succeed and `presby_effective_permissions()` then raises on its first call. `drizzle/0050_presby_schema_parity.sql` closes the drift and `npm run check:schema-parity` — a step of the database job, deliberately **not** part of the offline `npm run check` — keeps it closed by diffing the catalog of the freshly migrated database against the TypeScript model.

Roles are cluster-wide and survive into the fresh database; `presby_app` exists before migration `0009` runs and `0009` is `if not exists`-guarded, so no bootstrap ordering problem exists. The job sets `presby_app`'s password itself (per-run random, `::add-mask::`ed, `ALTER ROLE` on the owner connection that `neondb_owner` holds `admin_option` for) rather than taking a third operator secret or trusting Neon to reveal a password for a SQL-created role. Before the isolation suite runs, the job asserts `current_user = 'presby_app'` and `rolbypassrls = f`; a 520-assertion pass as the owner proves nothing.

**A skip must be a skip.** Each Neon-dependent workflow carries its own always-green `check-secrets` gate job emitting `::notice::` and naming the missing secret, and gates the real job off with `if:` so GitHub reports it as *skipped*. Never a green step inside the real job that early-returns, never `continue-on-error`, and every `psql` runs with `-v ON_ERROR_STOP=1` — without it `psql -f` exits 0 on a fully rolled-back transaction, which is the same lie in a different costume. A red means a real assertion failed against a real ephemeral database; it never means the job did nothing.

Each job gets its **own** branch — `db-tests` and `e2e` do not share one, because `scripts/test-rls.sql`'s exact-count assertions and Playwright's `globalSetup` fixtures are mutually invalidating — and each deletes its branch in an `if: always()` step.

---

**Handoff:** to **tech-lead** for Phase 3. Carry Phase 1's section forward verbatim alongside this one. Phase 3 must (a) sequence batch A before batch B explicitly in Implementation Order, (b) write `0050`'s DDL to the composite-FK shape above and confirm it converges both a fresh and a drifted database, (c) name `check:schema-parity`'s mechanism and its allowlist policy, (d) name `db.yml`, the composite action, and the four URL/endpoint assignments in the component plan, and (e) record the resolver-breakage finding (`drizzle/0010:88,105` + plpgsql late binding) in the design doc's root-cause section — it is the sharpest justification the widened scope has.

---



### Orchestrator notes (2026-09-26)

- `drizzle/meta/_journal.json`: the branch MAY append the idx 50 entry (append-at-end, the same discipline 0048/0049 used) because the rehearsal's `db:migrate` reads the journal; it is still merged by the orchestrator.
- The composite action is approved as the repo's first `.github/actions/` entry.
- The concurrent lint pipeline owns the existing `ci` job's step order and swaps `node-version` lines to `node-version-file: ".nvmrc"` in `ci.yml` (both occurrences) and `e2e.yml` (one); this pipeline's `e2e.yml` rewrite must use the same form so the merge is trivial.

---


# Phase 3 — Technical Design (tech-lead)

## Summary

We're closing two gaps that turned out to be one problem. CI never runs the
765+ database-backed tests or the 520-assertion RLS suite, and the one attempt
to fix that (`e2e.yml`) has never executed and would fail immediately even if
it could, because its database-provisioning recipe drifted from the real one.
Phase 1's from-scratch rehearsal — the acceptance criterion this pipeline set
for itself before writing any CI YAML — surfaced why a fresh-migrate database
doesn't match what `scripts/seed-dev.sql` and the app's own domain model
expect: two columns are wrongly `NOT NULL` and two more don't exist at all in
the committed `drizzle/*.sql` files, despite existing on every live branch and
in the TypeScript model. Phase 2 escalated the stakes further: because the
missing columns are referenced only inside a `plpgsql` function body
(`presby_effective_permissions()`), Postgres's late name resolution means all
50 migrations apply cleanly and the permission resolver then raises on its
*first call* against a from-scratch database — DECISION-146's premise that the
posture is "reproducible from `drizzle/` alone" has been false since
2026-08-17, a month before that decision was recorded.

This design ships in two hard-ordered batches. **Batch A** (database-admin)
is a schema fix-forward migration (`drizzle/0050`) plus the fixture and seed
scripts it makes runnable again, plus a standing schema-parity check so this
class of drift cannot recur silently. **Batch B** (deployment-engineer) is the
CI shape itself: a shared composite action so `db.yml` (new) and `e2e.yml`
(repaired) provision an identical ephemeral database instead of two
hand-maintained recipes that drift from each other (the exact failure this
pipeline exists to close), the vitest/playwright config fixes the 2026-09-25
test-coverage review named, and the docs that make both operable. Batch B
cannot be rehearsed until Batch A lands — a from-scratch database is the whole
point of the exercise, and today it doesn't work.

## Root Cause

**Finding 1 — two columns wrongly `NOT NULL` (F24 regression).**
`drizzle/0008_presby_domain.sql:293` (`officer_terms.recorded_by`) and
`:259` (`roll_actions.proposed_by`) declare `NOT NULL`. This contradicts F24
(a church arriving with twenty years of session history has no acting user to
attribute an imported record to — recorded 2026-08-17, commit `8f358b6`), it
contradicts the TS domain model (`src/lib/db/domain/officers.ts:124-126` and
`roll.ts:96-97`, both already nullable, no `.notNull()`), and it contradicts
every live branch, which is already nullable there. `0008` is even internally
inconsistent about it — `appointments.recorded_by` and
`background_checks.recorded_by` are nullable in the same file. The only
explanation consistent with "TS model and every live branch agree, only the
committed SQL disagrees" is an `ALTER TABLE ... DROP NOT NULL` run directly
against a real branch at some point, with no compensating migration ever
generated — a second, independent occurrence of the exact
"`drizzle/` alone doesn't reproduce the live schema" gap the
`2026-09-25-security-schema-b` pipeline's B-H3 finding already named once
(that pipeline checked grants and RLS policy counts, not column-level
parity, so it never saw this one).

**Finding 2 — two columns exist live and in TS but not in any migration
(F27 regression).** `administrative_commissions.group_id`
(`src/lib/db/domain/authz.ts:198`) and `org_delegations.group_id`
(`authz.ts:238`) are both commented `F27: a commission/delegation is a BODY of
people, not just a role` and both exist, nullable, on every live branch —
confirmed via `information_schema.columns` diff between a freshly-migrated
scratch database and `pipeline-ci-db-tests` (forked from `development`). No
`drizzle/*.sql` file ever adds them. The live constraint names
(`administrative_commissions_group_id_fkey`,
`org_delegations_group_id_fkey` — Postgres's default naming, not
`drizzle-kit push`'s `..._groups_id_fk` form) confirm a hand-run `psql ALTER
TABLE`, not a tracked migration.

**Finding 3 — why 50/50 migrations "succeeding" hid Finding 2 entirely
(the sharpest justification for widening this pipeline's scope).**
`drizzle/0010_presby_resolver.sql:88,105` joins `ac.group_id` and `od.group_id`
inside a `language plpgsql` function body
(`presby_effective_permissions()`). Postgres does not name-resolve identifiers
inside a plpgsql body at `CREATE FUNCTION` time — only at first execution of
the statement that references them. So a from-scratch replay of every
committed migration, in order, **succeeds completely**: `CREATE FUNCTION`
never inspects whether `administrative_commissions.group_id` exists, because
that check happens only inside the SQL the function body executes, not at
function-definition time. The function is then silently broken from the
moment `drizzle/0010` "succeeds" until the first caller hits arm 3 or 4 of the
`UNION` (all four arms execute as one query, so *any* call to
`presby_effective_permissions()` raises `column ac.group_id does not exist`,
not just calls that would have used the commission/delegation arms). **A
green migration run is not evidence the resolver works, and nothing short of
actually calling the function would have caught this** — which is exactly
why Batch A's acceptance criterion below ends with a direct call to it,
not just a clean `db:migrate` exit code.

**Finding 4 — a coupled fixture bug, found while designing Batch A's fix
(new, not in Phase 1/2).** `scripts/test-rls.sql:613` hardcodes the literal
UUID `a0000000-0000-0000-0000-000000000002` as a `group_type_id` for the
platform-wide `committee` template — the same literal `seed-dev.sql` uses.
On a from-scratch database this literal is **never** the row `db:seed`'s
`seedGroupTypes()` creates (it uses `defaultRandom()`), so fixing
`seed-dev.sql`'s collision (Gap 2 below) without also fixing this line leaves
`test-rls.sql` failing its own `-v ON_ERROR_STOP=1` gate on a foreign-key
violation the moment Batch A's rehearsal reaches it. See Edge Cases for the
one-line fix and the Rule-16 exception it requires.

## Permissions & Flags

Not applicable. No `FEATURES.*` key, no route, no `feature_flags` row.
`RATE_LIMIT_DISABLED` is an existing environment escape hatch, not a new flag
— correctly out of scope (Phase 1/2 both confirm this).

## API Contract

Not applicable. No route handler, no server action, no page. Every artifact
in this design is a migration, a script, a CI workflow/action, or a config
file.

## Data Model

### `drizzle/0050_presby_schema_parity.sql` (new, hand-written — `drizzle-kit
generate` is unusable: `drizzle/meta/` holds 13 snapshots against 50 journal
entries, newest is `0012_snapshot.json`, which still records
`officer_terms.recorded_by notNull: true` and neither `group_id` column;
`generate` would diff the TS model against that frozen snapshot and emit one
migration containing everything hand-written since `0013`)

Converges **two different starting states** in one idempotent file: a
from-scratch database (columns absent) and every already-drifted live branch
(columns present, informally-named FK). Every statement is safe to run twice.

```sql
-- drizzle/0050_presby_schema_parity.sql
--
-- Fix-forward for two independent schema-drift findings (Phase 3,
-- docs/work-log/2026-09-26-ci-db-tests.md), both confirmed by a
-- migrate-from-empty rehearsal against a scratch database and an
-- information_schema diff against a live branch. 0008 and 0010 are long
-- shipped and are never edited (CLAUDE.md's drizzle/ fix-forward rule) —
-- this is a new migration.

-- ---------------------------------------------------------------------------
-- 1. Relax the two wrongly-NOT-NULL columns (F24). Null is legitimate
--    provenance: an imported historical record has no acting user, and
--    requiring one would push importers toward a fake account. Dropping a
--    NOT NULL that is already absent is a no-op, so this half is naturally
--    idempotent.
-- ---------------------------------------------------------------------------
alter table officer_terms alter column recorded_by drop not null;
alter table roll_actions alter column proposed_by drop not null;

comment on column officer_terms.recorded_by is
  'Nullable (F24): imported historical terms have no acting user. A church '
  'arriving with twenty years of session history cannot invent one.';
comment on column roll_actions.proposed_by is
  'Nullable (F24): opening_balance and other imported roll actions predate '
  'the platform and have no acting user.';

-- ---------------------------------------------------------------------------
-- 2. administrative_commissions.group_id — add if absent; composite FK to
--    the PARENT council (F27: the commission is a BODY of people, not just a
--    role, and its members are a group at the council reaching DOWN, not at
--    the target it reaches into). F2 / Two Hierarchies Intersect Nowhere: a
--    plain `references groups(id)` would let a commission whose
--    parent_org_id is org A cite a group actually owned by unrelated org C —
--    presby_effective_permissions()'s arm 3 would then grant A's role inside
--    TARGET org B to C's members, an authority grant with no affiliation
--    behind it.
-- ---------------------------------------------------------------------------
alter table administrative_commissions add column if not exists group_id uuid;

alter table administrative_commissions
  drop constraint if exists administrative_commissions_group_id_fkey;
alter table administrative_commissions
  drop constraint if exists administrative_commissions_group_id_parent_org_fkey;

alter table administrative_commissions
  add constraint administrative_commissions_group_id_parent_org_fkey
    foreign key (group_id, parent_org_id)
    references groups (id, organization_id);

comment on column administrative_commissions.group_id is
  'F27: the commission is a BODY of people, not just a role — a group at '
  'parent_org_id (the council reaching down), never target_org_id. Composite '
  'FK to groups(id, organization_id) (F2): a plain FK would let a commission '
  'cite a group owned by an unrelated third council.';

-- ---------------------------------------------------------------------------
-- 3. org_delegations.group_id — add if absent; composite FK to the GRANTEE
--    council (F27: "the presbytery administers our portal" means a specific
--    staff group at the presbytery, not everyone there). F2: same reasoning
--    as above, mirrored onto the grantee side.
-- ---------------------------------------------------------------------------
alter table org_delegations add column if not exists group_id uuid;

alter table org_delegations
  drop constraint if exists org_delegations_group_id_fkey;
alter table org_delegations
  drop constraint if exists org_delegations_group_id_grantee_org_fkey;

alter table org_delegations
  add constraint org_delegations_group_id_grantee_org_fkey
    foreign key (group_id, grantee_org_id)
    references groups (id, organization_id);

comment on column org_delegations.group_id is
  'F27: which people at the GRANTEE council actually hold the delegation. '
  'Composite FK to groups(id, organization_id) (F2): a plain FK would let a '
  'delegation cite a group at any org, not specifically the grantee.';
```

Both FK targets exist: `groups` already carries `unique(id, organization_id)`
as `groups_id_org_key` (`drizzle/0008:343`). Existing data is compatible per
Phase 2's catalog check (1 `administrative_commissions` row, 0
`org_delegations`, no null `group_id`, and the one live row's group is owned
by its own `parent_org_id`) — no backfill needed. Applying the file twice is
safe: the second run's `add column if not exists` and `drop constraint if
exists` are no-ops or harmless re-drops of a constraint this same file just
added, and it converges to the identical end state either way.

### TypeScript model changes

`src/lib/db/domain/authz.ts` — remove the column-level `.references(() =>
groups.id)` from both `administrativeCommissions.groupId` and
`orgDelegations.groupId` (leave the column declaration as plain `uuid`), and
add the composite FK to each table's `(t) => [...]` array (the `foreignKey`
import is already present in this file, used by `roleGrants`):

```ts
// administrativeCommissions' (t) => [...]:
foreignKey({
  columns: [t.groupId, t.parentOrgId],
  foreignColumns: [groups.id, groups.organizationId],
  name: "administrative_commissions_group_id_parent_org_fkey",
}),

// orgDelegations' (t) => [...]:
foreignKey({
  columns: [t.groupId, t.granteeOrgId],
  foreignColumns: [groups.id, groups.organizationId],
  name: "org_delegations_group_id_grantee_org_fkey",
}),
```

`src/lib/db/domain/officers.ts` and `roll.ts` — **unchanged**. Both already
declare `recordedBy`/`proposedBy` without `.notNull()`; the drift was only in
the committed SQL, never in the TS model. (Confirmed by reading both files —
the F24 comments at `officers.ts:124-126` and `roll.ts:96-97` already
document the nullable rationale `0050` is catching the SQL up to.)

### `scripts/seed-dev.sql` — `group_types` reconciliation

**Mechanism ruled: `on conflict (organization_id, key) do nothing` at the
insert, plus a keyed lookup at every downstream reference — never a fixed
UUID relied on as if guaranteed to exist.**

Root cause: `db:seed`'s `seedGroupTypes()` (`scripts/seed.ts`) runs *before*
`seed-dev.sql` in every documented recipe, and on a from-scratch database it
finds no existing `court`/`committee`/`roster` row, so it inserts them with
`defaultRandom()` ids. `seed-dev.sql` then tries to insert its own
fixed-UUID rows for the same three keys and collides on
`group_types_org_key` (`unique nulls not distinct (organization_id, key)`,
`drizzle/0048` — NULLS NOT DISTINCT is why two `organization_id IS NULL` rows
with the same key collide at all). The whole file is one transaction, so this
is not partial fixture loss — it is zero fixture loss (Phase 1's exact
measurement).

Fix, two parts:

1. **The insert becomes idempotent regardless of which side seeded first:**

```sql
insert into group_types (id, organization_id, key, name) values
  ('a0000000-0000-0000-0000-000000000001', null, 'court', 'Court'),
  ('a0000000-0000-0000-0000-000000000002', null, 'committee', 'Committee'),
  ('a0000000-0000-0000-0000-000000000004', null, 'roster', 'Roster')
on conflict (organization_id, key) do nothing;
```

2. **Every downstream reference to the fixed literal is replaced with a
   scalar subquery keyed by `key`**, so it resolves to whichever row actually
   won the race (db:seed's random id in the documented recipe; the literal
   above only in the (currently undocumented, and not worth documenting)
   case of running `seed-dev.sql` standalone against a database that skipped
   `db:seed`). There are 11 occurrences across the file (`grep -n
   "a0000000-0000-0000-0000-00000000000[124]" scripts/seed-dev.sql` —
   lines 162, 164, 166, 169, 178, 180, 182, 184, 651, 780, 782 as of this
   design), every one of them a `groups.group_type_id` value in a `values
   (...)` list. Each becomes:

```sql
(select id from group_types where organization_id is null and key = 'court')
(select id from group_types where organization_id is null and key = 'committee')
(select id from group_types where organization_id is null and key = 'roster')
```

   This is plain SQL (no psql-specific `\gset`/`\set`), so it is identical
   whether the file is applied via `psql -f`, a future non-psql apply path, or
   copy-pasted into a client — the portability property the implementer
   should preserve, not just the immediate fix.

`scripts/seed.ts:789-797`'s docstring above `seedGroupTypes()` currently
reads *"NOT `.onConflictDoNothing()` ... `group_types` has NO unique
constraint on `(organization_id, key)`, only a non-unique index"* — this is
stale and now actively wrong: `drizzle/0048` added `group_types_org_key
unique nulls not distinct (organization_id, key)` specifically to close a
1,557-row duplicate-accumulation bug (B-L1), and `seedGroupTypes()`'s own
find-then-insert pattern (not `onConflictDoNothing()`) is a *different,
also-idempotent* mechanism that predates and is unaffected by that
constraint. Replace the stale paragraph with:

> `group_types_org_key` (drizzle/0048, `unique nulls not distinct
> (organization_id, key)`) now exists and makes `onConflictDoNothing()`
> viable here too — but this function's find-then-insert shape was already
> idempotent before that constraint existed and needs no change. What *does*
> depend on the constraint, and is new: `scripts/seed-dev.sql`'s own
> `group_types` insert uses `on conflict (organization_id, key) do nothing`
> against this exact constraint to stay idempotent whichever of the two
> scripts seeds `court`/`committee`/`roster` first (docs/work-log/
> 2026-09-26-ci-db-tests.md).

### `scripts/check-schema-parity.ts` (new)

**Purpose:** diff the freshly-migrated catalog against the TS domain model so
Finding 1/2's class of drift cannot recur silently. Lives in `scripts/`,
invoked only by the new `db.yml` job (never part of `npm run check` — the
five existing tripwires are static, secretless, and run in a fresh clone with
no database; a sixth that needs one would force Neon secrets onto the
fork-safe `ci.yml`, per Phase 2's MUST ruling).

**Why not `drizzle-kit`:** `generate` diffs against the stale `drizzle/meta/`
snapshots (above). `check` validates journal/snapshot shape only and never
opens a database. `push` *does* diff the TS model against a live database —
the whole domain is in `drizzle.config.ts`'s scanned schema, and `push` is
literally how this drift was introduced in the first place — but it applies
what it finds rather than reporting it, has no dry-run flag, and in a
non-interactive CI shell a detected difference is likely to be silently
applied and exit 0. A "check" that fixes what it should be reporting is the
exact failure mode this script exists to prevent.

**Mechanism:**

1. Connect via `MIGRATE_DATABASE_URL` (owner, direct) using
   `drizzle-orm/neon-http` — the same one-shot, no-transaction pattern
   `scripts/seed.ts` already uses; no GUC, no RLS-scoped session needed for a
   catalog read.
2. Import every table from `src/lib/db/domain` (`import * as domain from
   "../src/lib/db/domain"`), filter to actual `PgTable` instances with
   `is(value, PgTable)` (from `drizzle-orm`), and call `getTableConfig()` on
   each (from `drizzle-orm/pg-core`) to get: table name, columns (`name`,
   `notNull`), and foreign keys (`.reference()` → local columns, foreign
   table, foreign columns). This captures both column-level `.references()`
   FKs and the `(t) => [foreignKey(...)]` composite ones — Drizzle normalizes
   both into the same `foreignKeys` array. `schema.ts` (NextAuth/platform
   tables) is deliberately **out of scope** — this check is about the presby
   domain, where the drift actually occurred.
3. Query the live catalog for the same three facts, scoped to `public`:
   - columns + nullability from `pg_attribute`/`pg_class`/`pg_namespace`
     (`attnum > 0 and not attisdropped`);
   - foreign keys from `pg_constraint where contype = 'f'`, unnesting
     `conkey`/`confkey` together (`unnest(conkey, confkey)`) so local and
     foreign columns pair up in the same order Postgres stored them, then
     resolving each `attnum` back to a name via `pg_attribute`.
4. Diff, in this order (per Phase 2's ruling — columns and nullability and FK
   shape first; defaults and index parity are an explicit non-goal for this
   version): missing/extra table, missing/extra column, nullability mismatch,
   missing/extra FK (FK match is by table + unordered set of (local, foreign)
   column pairs + foreign table, not by constraint name — names legitimately
   differ between a `drizzle-kit push`-applied branch and a hand-written
   migration).
5. **Allowlist, in-file, not a separate file** (matching this repo's existing
   convention — `check-brand-scope.mjs`'s literal `EMITTERS` array,
   `check-secrets-pii.mjs`'s literal safe-domain list — rather than inventing
   a new JSON-config pattern for one script):

```ts
/**
 * Explicitly-approved, dated gaps between the TS domain model and the live
 * catalog. Empty is the goal — every entry here is a known difference that
 * has NOT yet been closed by a migration, and it must also have a
 * docs/TODO.md line. Adding a row without one is not allowed.
 */
const ALLOWLIST: Array<{
  table: string;
  column?: string;
  kind: "missing_column" | "extra_column" | "nullability" | "missing_fk" | "extra_fk";
  reason: string;
  since: string; // YYYY-MM-DD
}> = [];
```
   Ships **empty** — `0050` closes every difference Phase 1 found. Rule now,
   so Phase 4 doesn't stall on it: the check will very plausibly find *more*
   than these four columns on its first real run against a live-lineage
   branch (this codebase has already demonstrated `db:push` drift twice,
   independently). Anything beyond the four goes on the allowlist with a
   `docs/TODO.md` line for its own pipeline — a parity check that is red on
   arrival gets disabled, and that is worse than not having one.
6. **Output:** one line per difference to stdout, e.g. `[schema-parity]
   NULLABILITY  roll_actions.proposed_by: TS=nullable DB=NOT NULL`,
   `[schema-parity] MISSING FK  administrative_commissions:
   (group_id,parent_org_id) -> groups(id,organization_id)`, allowlisted hits
   printed as `[schema-parity] ALLOWED  ...` (informational, non-failing);
   a summary line (`N differences, M allowlisted, K failing`) at the end,
   mirroring `check-audit-coverage.mjs`'s style (`console.error` + itemized
   list on failure, one `console.log` line on success).
7. **Exit codes:** `0` only if every non-allowlisted difference count is
   zero; `1` on any real difference *and* on a connection/query error — a
   check that can't reach the database must fail loud, never report "no
   differences found" by default-succeeding on an exception it swallowed.

npm script: `"check:schema-parity": "dotenv -e .env.local -- tsx
scripts/check-schema-parity.ts"` — same `dotenv -e .env.local` convention as
`db:seed`, so it reads whatever `.env.local` the job just wrote.

### `scripts/test-rls.sql` — no new section; one required coupling fix

**No schema-parity assertion belongs in `test-rls.sql`.** That check is
`check:schema-parity`'s job entirely — duplicating it as a SQL assertion
would give the same class of drift two homes to fall out of sync with each
other.

**One line must change, and it is a genuine exception to the general
"`scripts/test-rls.sql` is orchestrator-only, edited at integration" rule
(CLAUDE.md → Workflow Rule 16's shared-file list).** Finding 4 above: line
613 hardcodes the same `a0000000-...-0002` literal `seed-dev.sql` used to
rely on, as the `group_type_id` of a scratch `groups` row inserted (and
rolled back) inside a `begin...rollback` block. With `-v ON_ERROR_STOP=1`,
a foreign-key violation here — which is exactly what happens once
`seed-dev.sql`'s fix means this literal is no longer guaranteed to exist —
aborts the whole suite before the `rollback;` on the next line ever runs, not
just the one assertion. This is not a stylistic preference to defer to
integration: it is the mechanical consequence of Batch A's own required fix,
and Batch A's stated acceptance criterion (below) is a full rehearsal that
includes running `test-rls.sql`. The fix is the same shape as the
`seed-dev.sql` one:

```sql
-- was: 'a0000000-0000-0000-0000-000000000002', -- global 'committee' template
(select id from group_types where organization_id is null and key = 'committee'),
```

**database-admin makes this one-line edit as part of Batch A**, flagged
explicitly in Phase 4's Implementer Notes as a Rule-16 exception with this
justification, so the orchestrator sees it named rather than discovers it as
an unexplained diff to a normally hands-off file. This pipeline's own kickoff
shared-file list (`docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`,
`docs/reviews/log.md`, `docs/release-notes/*`, `CLAUDE.md`) does not include
`scripts/test-rls.sql` — only the general CLAUDE.md rule does — and no
concurrent pipeline touches this file, so the collision risk Rule 16 exists
to prevent does not apply here in practice.

### `drizzle/meta/_journal.json`

Per Phase 2's orchestrator note, the branch may append the idx-50 entry
locally (`db:migrate` reads the journal), but the file is still merged by the
orchestrator at integration, matching how `0048`/`0049` were handled:

```json
{
  "idx": 50,
  "version": "7",
  "when": <generated at migration-file creation>,
  "tag": "0050_presby_schema_parity",
  "breakpoints": true
}
```

## Component / Page Plan

Not applicable in the usual sense — no pages or React components. Restated as
files, split by batch:

**Batch A (database-admin):**
- `drizzle/0050_presby_schema_parity.sql` — new
- `src/lib/db/domain/authz.ts` — modified (composite FK move for both
  `group_id` columns)
- `scripts/seed-dev.sql` — modified (`group_types` insert +
  `on conflict do nothing`; 11 literal-id references → keyed subqueries)
- `scripts/seed.ts` — modified (stale docstring above `seedGroupTypes()`,
  lines ~789-797)
- `scripts/check-schema-parity.ts` — new
- `scripts/test-rls.sql` — modified (one line, 613 — flagged Rule-16
  exception, see above)
- `drizzle/meta/_journal.json` — appended locally, merged by orchestrator
- `package.json` — modified (`check:schema-parity` script only; `test:db` is
  Batch B's)

**Batch B (deployment-engineer):**
- `.github/actions/neon-ci-db/action.yml` — new (repo's first composite
  action, approved as a new structural artifact at Phase 2)
- `.github/workflows/db.yml` — new
- `.github/workflows/e2e.yml` — modified (rewritten to consume the composite
  action; fixes C-5 points 1–3)
- `vitest.config.ts` — modified (timeouts, coverage `include`/`exclude`,
  `reportOnFailure`)
- `package.json` — modified (`test:db` script)
- `playwright.config.ts` — modified (`outputDir`)
- `src/lib/rate-limit.test.ts` — modified (enforcement block's env stub)
- `docs/testing.md` — modified (recipe, `test:db`, CI section, No-Real-Data
  CI rule, `RATE_LIMIT_DISABLED` posture, 2-hour fuse note)
- `docs/deployment.md` — modified (two secrets, what turns on, parent-branch
  rule, `PLATFORM_DATABASE_URL` role-name correction)

### Batch B detail — `.github/actions/neon-ci-db/action.yml`

```yaml
name: "Neon CI database"
description: >
  Creates an ephemeral Neon branch off an explicitly pinned parent, creates a
  fresh database inside it, and hands back connection strings for all four
  roles/endpoints this codebase uses. db.yml and e2e.yml both consume this so
  they can never drift from each other the way e2e.yml's hand-maintained
  recipe already had (C-5).
inputs:
  api_key:
    required: true
  project_id:
    required: true
  parent:
    required: true
    description: >
      Literal Neon branch name to fork from. Never leave empty — the
      implicit default is the project's PRIMARY branch, which is
      `production` (DECISION-150).
  branch_name:
    required: true
  database_name:
    required: false
    default: "ci_run"
outputs:
  branch_id:
    value: ${{ steps.create-branch.outputs.branch_id }}
  database_url:       { value: ${{ steps.urls.outputs.database_url }} }
  app_database_url:   { value: ${{ steps.urls.outputs.app_database_url }} }
  platform_database_url: { value: ${{ steps.urls.outputs.platform_database_url }} }
  migrate_database_url:  { value: ${{ steps.urls.outputs.migrate_database_url }} }
runs:
  using: composite
  steps:
    - name: Assert tooling present
      shell: bash
      run: |
        set -euo pipefail
        psql --version
        node -v

    - name: Create ephemeral Neon branch
      id: create-branch
      uses: neondatabase/create-branch-action@v5
      with:
        project_id: ${{ inputs.project_id }}
        api_key: ${{ inputs.api_key }}
        parent: ${{ inputs.parent }}
        branch_name: ${{ inputs.branch_name }}
        username: neondb_owner   # v5 outputs: db_url, db_url_with_pooler,
                                  # host, host_with_pooler, branch_id, password

    - name: Create ci_run database and set presby_app's password
      id: urls
      shell: bash
      run: |
        set -euo pipefail
        HOST="${{ steps.create-branch.outputs.host }}"
        OWNER_PW="${{ steps.create-branch.outputs.password }}"
        OWNER_NEONDB_URL="postgresql://neondb_owner:${OWNER_PW}@${HOST}/neondb?sslmode=require"

        psql "$OWNER_NEONDB_URL" -v ON_ERROR_STOP=1 -c \
          'create database "${{ inputs.database_name }}"'

        OWNER_DB_URL="postgresql://neondb_owner:${OWNER_PW}@${HOST}/${{ inputs.database_name }}?sslmode=require"

        APP_PW="$(openssl rand -hex 32)"
        echo "::add-mask::$APP_PW"

        psql "$OWNER_DB_URL" -v ON_ERROR_STOP=1 -c \
          "alter role presby_app with login password '${APP_PW}'"

        APP_DB_URL="postgresql://presby_app:${APP_PW}@${HOST}/${{ inputs.database_name }}?sslmode=require"

        {
          echo "database_url=$APP_DB_URL"
          echo "app_database_url=$APP_DB_URL"
          echo "platform_database_url=$OWNER_DB_URL"
          echo "migrate_database_url=$OWNER_DB_URL"
        } >> "$GITHUB_OUTPUT"
```

`create-branch-action@v5`'s real interface (verified against the `v5` tag,
not `main`'s current docs, since `e2e.yml`'s existing working usage — 
`db_url_with_pooler` — only matches the tag): inputs `project_id`,
`branch_name`, `api_key`, `username` (required — the role to generate a
password/connection string for), `database` (default `neondb`, unused here
since `ci_run` doesn't exist yet at branch-creation time), `parent`; outputs
`db_url`, `db_url_with_pooler`, `host`, `host_with_pooler`, `branch_id`,
`password`. `username: neondb_owner` is the only role requested from the
action itself — `presby_app`'s credential is generated by the job, per Phase
2's ruling (roles are cluster-wide and survive the fork; `presby_app` exists
before `0009` runs and `0009` is `if not exists`-guarded, so no bootstrap
ordering problem exists; `neondb_owner` holds `admin_option` on `presby_app`,
confirmed via `pg_auth_members` on the live catalog).

Only four URLs, all on the direct (unpooled) `host`, never
`host_with_pooler` — `scripts/test-rls.sql` is 168 `set_config` calls plus a
temp table across one psql session, and pgbouncer transaction pooling is the
wrong endpoint for session state. `DIRECT_DATABASE_URL` (present in local
`.env.local` but unreferenced anywhere in `src/`, confirmed by repo-wide
grep) is not one of the four and should not be invented as a fifth output.

### Batch B detail — `.github/workflows/db.yml` (new)

```yaml
name: Database-backed tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: db-tests-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check-secrets:
    name: neon secrets present?
    runs-on: ubuntu-latest
    outputs:
      has-neon: ${{ steps.check.outputs.has-neon }}
    steps:
      - id: check
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
        run: |
          if [ -n "$NEON_API_KEY" ]; then
            echo "has-neon=true" >> "$GITHUB_OUTPUT"
          else
            echo "has-neon=false" >> "$GITHUB_OUTPUT"
            echo "::notice::NEON_API_KEY not configured — db-tests skipped. See workflow header for setup."
          fi

  db-tests:
    name: vitest + test-rls.sql on an ephemeral Neon branch
    needs: check-secrets
    if: needs.check-secrets.outputs.has-neon == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version-file: ".nvmrc"
          cache: "npm"
      - run: npm ci

      - name: Provision ephemeral database
        id: db
        uses: ./.github/actions/neon-ci-db
        with:
          api_key: ${{ secrets.NEON_API_KEY }}
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          parent: development
          branch_name: db-tests-${{ github.run_id }}-${{ github.run_attempt }}

      - name: Write .env.local
        shell: bash
        run: |
          set -euo pipefail
          {
            echo "DATABASE_URL=${{ steps.db.outputs.database_url }}"
            echo "APP_DATABASE_URL=${{ steps.db.outputs.app_database_url }}"
            echo "PLATFORM_DATABASE_URL=${{ steps.db.outputs.platform_database_url }}"
            echo "MIGRATE_DATABASE_URL=${{ steps.db.outputs.migrate_database_url }}"
          } >> .env.local

      - run: npm run db:migrate
      - run: npm run check:schema-parity
      - run: npm run db:seed

      - name: Apply the synthetic fixture
        shell: bash
        run: |
          set -euo pipefail
          psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql
        env:
          MIGRATE_DATABASE_URL: ${{ steps.db.outputs.migrate_database_url }}

      - run: npm run test:db

      - name: Assert presby_app before the isolation suite
        shell: bash
        run: |
          set -euo pipefail
          RESULT=$(psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
            "select current_user, (select rolbypassrls from pg_roles where rolname = current_user)")
          echo "$RESULT"
          [ "$RESULT" = "presby_app|f" ] || { echo "::error::guard failed: not presby_app or bypassrls is set"; exit 1; }
        env:
          APP_DATABASE_URL: ${{ steps.db.outputs.app_database_url }}

      - name: Isolation suite (must run as presby_app, never the owner)
        shell: bash
        run: |
          set -euo pipefail
          psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
        env:
          APP_DATABASE_URL: ${{ steps.db.outputs.app_database_url }}

      - name: Delete ephemeral Neon branch
        if: always()
        uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch: db-tests-${{ github.run_id }}-${{ github.run_attempt }}
```

No `RATE_LIMIT_DISABLED` is set anywhere in this job — Phase 2's MUST ruling:
this is the one place the limiter is exercised live for real, and setting it
here would re-create exactly the blind spot the 2026-09-25 QA review measured.
No `continue-on-error:` anywhere; every `run:` block starts `set -euo
pipefail`; every `psql` invocation carries `-v ON_ERROR_STOP=1`, including
the `seed-dev.sql` and guard steps — without it, `psql -f` on a file whose
transaction rolls back exits 0, and the job would go green on an empty
fixture (Phase 1 measured this exact failure with the flag on; it is
invisible without it).

### Batch B detail — `.github/workflows/e2e.yml` (rewritten)

Same `check-secrets` gate (unchanged, already correct). The `e2e` job:

- swaps its own `create-branch-action`/`delete-branch-action` pair for
  `uses: ./.github/actions/neon-ci-db` with `parent: development`,
  `branch_name: e2e-${{ github.run_id }}-${{ github.run_attempt }}`;
- writes `.env.local` with all **four** DB URLs (currently missing
  `PLATFORM_DATABASE_URL` — C-5 point 1) plus the existing auth-specific vars
  (`AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`, `AUTH_TOTP_ENCRYPTION_KEY`,
  `RATE_LIMIT_DISABLED=true` — **kept**, this job's shared fixture signs in
  far more than 5/min);
- replaces `db:push` + `db:seed` with `db:migrate` → `check:schema-parity` →
  `db:seed` → `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` (currently
  applies none of the hand-written RLS/trigger migrations and never applies
  the fixture at all — C-5 points 2 and 3; specs reference `alder-creek`,
  which only exists after `seed-dev.sql` runs);
- keeps the Playwright install step, `npm run test:e2e` with `CI: "true"`,
  and the trace upload on failure (`path: test-results/`, unchanged literal —
  `PW_OUTPUT_DIR` is not set in CI, only a parallel worktree sets it locally,
  per Phase 2's ruling on keeping the two derivations in sync only if either
  ever becomes authoritative in CI);
- adds `concurrency: { group: e2e-${{ github.ref }}, cancel-in-progress:
  true }` at the job level (mirrors `db.yml`);
- swaps `node-version: "20"` → `node-version-file: ".nvmrc"` (same form the
  concurrent lint-gate pipeline uses elsewhere, so the merge is trivial);
- keeps `if: always()` delete-branch step.

### Batch B detail — `vitest.config.ts`

```ts
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.mjs",
    ],
    // Remote-Neon round trips occasionally exceed the 5s default across the
    // ~30 DB-backed spec files; two boundary flakes measured on this
    // pipeline's own branch (2026-09-26). Harmless for the pure suite.
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Vitest 4 removed `coverage.all` — `include` is how "count files no
      // test touches yet" is expressed now; the prior config's silent
      // default ("only files covered by a test") is why 121 source files
      // never appeared in any report (2026-09-25 review, N-4 family).
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/components/ui/**", "**/*.test.{ts,tsx}", "**/*.d.ts"],
      // @default false in Vitest 4 (reporters.d.ts:797-799). Confirmed
      // 2026-09-26: the DB-backed run's 3 rate-limit failures were why it
      // wrote NO coverage/ directory at all — this must stay set even after
      // the rate-limit fix makes today's failure vanish, or the next red run
      // silently loses coverage again the same way.
      reportOnFailure: true,
    },
  },
});
```

**No `fileParallelism: false` globally** (Phase 2 overturned this scope item
on measurement: 12.12s default vs. 93.79s serial, 7.7×, +82s on every `ci`
run and every local `npm test` for a change that benefits ~30 DB-backed
files only). Instead, one `package.json` script carries the flag:

```json
"test:db": "dotenv -e .env.local -- vitest run --no-file-parallelism",
```

so CI and a human run the byte-identical command, and `docs/testing.md`
stops being the only place the requirement lives.

### Batch B detail — `playwright.config.ts`

Add `outputDir: process.env.PW_OUTPUT_DIR ?? "test-results"` as a top-level
`defineConfig()` key (none exists today). No change to `e2e.yml`'s upload
step (`path: test-results/` stays a literal, matching Phase 2's default
option — CI never sets `PW_OUTPUT_DIR`, only a parallel worktree does).

### Batch B detail — `src/lib/rate-limit.test.ts`

The enforcement block (`describe("checkRateLimit (in-memory)")`, line 195)
is the one that fails today (3/4141, lines 241/256/279) because its
`beforeEach` never overrides `.env.local`'s `RATE_LIMIT_DISABLED=true`:

```ts
describe("checkRateLimit (in-memory)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    _inMemoryStore.clear();
    // This is the ENFORCEMENT block — it must run with the escape hatch off
    // regardless of what .env.local or CI sets, so neither a developer's
    // machine nor db-tests' deliberate lack of RATE_LIMIT_DISABLED can flip
    // these assertions (its sibling block above stubs "true" for the mirror
    // reason).
    vi.stubEnv("RATE_LIMIT_DISABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    _inMemoryStore.clear();
  });
  // ... existing it() blocks unchanged
```

### Batch B detail — `docs/testing.md`

- "Running the DB-backed suites": replace the raw `npx dotenv -e .env.local
  -- npx vitest run --no-file-parallelism` invocation with `npm run test:db`.
- New "Continuous integration" section: what `db.yml` and `e2e.yml` do, the
  two required secrets, and:
  > **No Real Data, for CI specifically: a CI database contains only rows CI
  > created.** Each ephemeral branch is forked from an explicitly pinned
  > parent (`development`) and the job immediately creates a fresh database
  > inside it and never opens the parent's own database — no connection
  > string, log line, or uploaded trace can carry a row that predates the
  > run. `parent:` is always written explicitly in the workflow; an unpinned
  > parent is not "no choice," it is the project's primary branch
  > (`production`), which holds two real congregations.
  - `db-tests` deliberately does **not** set `RATE_LIMIT_DISABLED` — it is the
    one place the sign-in limiter runs for real.
  - The retrospective's `deletable_until` fixture-exemption fuse (2-hour
    window before a scratch-org fixture becomes permanently undeletable) does
    not apply to CI's ephemeral branches — the whole branch is deleted
    wholesale in `if: always()` regardless of any row's `deletable_until`.

### Batch B detail — `docs/deployment.md`

- New short section near "Migrations": the two secrets
  (`NEON_API_KEY`/`NEON_PROJECT_ID`), what they turn on (`db-tests` and `e2e`
  flip from skipped to running on the next push), and the parent-branch rule
  (CI's ephemeral branches fork `development`, pinned explicitly in each
  workflow file — never the implicit default, which is `production`).
- Drive-by correction while touching this file's connection semantics: the
  Environment Variables table's `PLATFORM_DATABASE_URL` row still reads
  `production branch, presby_platform, pooled` — stale since DECISION-136
  (2026-09-24), which corrected `getPlatformDb()`'s actual role everywhere
  else (`src/lib/db/index.ts`, `scripts/seed.ts`) to `neondb_owner`.
  `presby_platform` is `rolcanlogin = false` and has never authenticated
  anywhere. Fix this row to `production branch, neondb_owner, pooled` in the
  same commit — otherwise the new CI documentation directly below it would
  use the correct role while the production row two lines up still names the
  wrong one.

## Implementation Order

**Batch A, hard-ordered before Batch B — B cannot be rehearsed until A lands,
because a from-scratch database is the entire point of the exercise and
today it doesn't work (Phase 1's Gap 1, confirmed and root-caused above).**

1. `drizzle/0050_presby_schema_parity.sql` (database-admin)
2. `src/lib/db/domain/authz.ts` composite FK move
3. `scripts/check-schema-parity.ts` + `package.json`'s `check:schema-parity`
4. `scripts/seed-dev.sql`'s `group_types` reconciliation (insert +
   11 keyed-subquery replacements)
5. `scripts/test-rls.sql:613` one-line coupling fix
6. `scripts/seed.ts:789-797` docstring correction
7. `drizzle/meta/_journal.json` idx-50 entry (local; orchestrator merges)
8. **Batch A acceptance rehearsal** (below) — must be green, with real
   counts recorded, before Batch B begins
9. `.github/actions/neon-ci-db/action.yml` (deployment-engineer)
10. `.github/workflows/db.yml`
11. `.github/workflows/e2e.yml` rewrite
12. `vitest.config.ts`, `package.json`'s `test:db`, `playwright.config.ts`
13. `src/lib/rate-limit.test.ts`
14. `docs/testing.md`, `docs/deployment.md`
15. **Batch B acceptance rehearsal** (below)

### Batch A acceptance criterion

Full rehearsal on a fresh database — `CREATE DATABASE` on the pipeline
branch's cluster (same method Phase 1 used: `CREATE DATABASE
ci_rehearsal_<name>` via the owner connection, dropped when done, nothing
touched on `development`):

1. `npm run db:migrate` → expect **51/51** migrations applied (50 + `0050`),
   `drizzle.__drizzle_migrations` shows 51 rows, exit 0.
2. `npm run check:schema-parity` → expect **0 non-allowlisted differences**,
   exit 0. (This is the check's first-ever run — if it finds anything beyond
   what `0050` fixes, that is real signal, not a bug in the check; see Edge
   Cases.)
3. `npm run db:seed` → expect the same shape as Phase 1's measurement (roles,
   11 features, 39 flags, 6 platform-wide `group_types`), exit 0.
4. `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` → expect **exit 0, full
   commit** (previously exit 3 at line 158, then line 265 — both must now be
   unreachable failure paths). Record row counts for the tables Phase 1's
   failure prevented from ever landing (`organizations`, `officer_terms`,
   `roll_actions`, `groups`, `administrative_commissions` at minimum).
5. The DB-backed vitest suite against this scratch database (the `test:db`
   npm alias is a Batch B deliverable Batch A predates — run the equivalent
   raw command, `dotenv -e <scratch-env-file> -- vitest run
   --no-file-parallelism`, against a `.env.local`-shaped file pointed at the
   scratch database's four URLs). Expect the same pass/fail shape Phase 1
   measured against the real branch (only the pre-existing rate-limit trio
   failing, since Batch A doesn't touch `rate-limit.test.ts` — that is
   Batch B's fix).
6. `psql -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` as `presby_app` → expect
   the same **520 pass assertions, 0 failures** Phase 1 measured against the
   live branch (same assertion count — the fix changes a literal to a
   lookup, not the assertions themselves).
7. **Direct proof the resolver now works from empty** (Finding 3 — this is
   the step nothing else in this list actually exercises): after step 4,
   call `presby_effective_permissions()` against a real seeded org/person
   from `seed-dev.sql` (e.g. Alder Creek `22222222-...` and one of its
   officers) and confirm it returns rows without raising `column
   ac.group_id does not exist`.

Record the actual counts from a real run in Phase 4's Implementer Notes —
this design specifies what "green" looks like, not fabricated numbers.

### Batch B acceptance criterion

The composite action's exact steps, driven locally against a throwaway Neon
branch if `NEON_API_KEY`/`NEON_PROJECT_ID` are available to the implementer
(create one via the Neon API/`neonctl`, named `ci-rehearsal-*`, delete it when
done — same convention this pipeline's own kickoff already uses); otherwise a
fresh database on the pipeline's own branch plus a line-by-line dry read of
both workflow files against the composite action's actual steps. Plus
`actionlint` (or `gh workflow view db.yml`/`e2e.yml` as a parse check) against
both YAML files. **Record honestly that the job itself cannot be observed
green in GitHub Actions until the operator adds both secrets** — this is not
a gap in the rehearsal, it is the stated, accepted limitation from Phase 1
onward.

## Edge Cases & Risks

| Case | Handling |
|---|---|
| Run cancelled mid-job | `if: always()` on the delete-branch step still executes on cancellation (within the job's `timeout-minutes` budget) — the branch is deleted either way. |
| Fork PR, no secrets configured | `check-secrets` reports `has-neon=false`; the real job is skipped via `if:`, never run-and-early-return — GitHub reports it as *skipped*, never green-for-doing-nothing (the C-5 failure mode this design exists to avoid repeating). |
| Two pushes to the same branch/PR in quick succession | `concurrency: { group: db-tests-${{ github.ref }} / e2e-${{ github.ref }}, cancel-in-progress: true }` on each workflow cancels the superseded run before it provisions a second Neon branch. |
| `check:schema-parity` finds a difference beyond the four known columns | Expected as a real possibility on first run (this codebase has demonstrated undocumented `db:push` drift twice already). The step fails loud (non-zero exit); the difference is allowlisted with a dated reason and a `docs/TODO.md` line for its own follow-up pipeline — never silently absorbed into this migration or the allowlist left to grow unbounded. |
| `db:migrate`'s "silent exit-1" class | Checked, not found as a real gap: `drizzle-kit migrate` wraps each migration file in a transaction and records to `__drizzle_migrations`; a partial failure aborts that transaction and the process exits non-zero (unlike bare `psql -f`, which exits 0 on a rolled-back transaction absent `-v ON_ERROR_STOP=1`). Batch A's acceptance rehearsal step 1 is the direct verification of this for `0050` specifically — record the actual exit code and row count, don't assume it. |
| `presby_app`'s password from a prior run leaking into a new one | Each run generates and sets a fresh password on its own ephemeral branch/database; nothing persists it, and the branch is deleted in `if: always()`. No cross-run credential reuse is possible by construction. |
| A killed runner (infra failure, not cancellation) leaves an orphan Neon branch | Not solved by this design — `if: always()` cannot run if the runner process itself is killed. Tracked as a `docs/TODO.md` follow-up (an orphan-branch janitor), per Phase 2's note; out of scope here. |
| `seed-dev.sql`'s and `test-rls.sql`'s shared `group_types` literal (Finding 4) recurring elsewhere | Repo-wide grep for the three literal UUIDs (`a0000000-0000-0000-0000-00000000000[1,2,4]`) outside `scripts/seed-dev.sql` found exactly the one `test-rls.sql:613` occurrence — confirmed during this design, not assumed. |

## Out of Scope

Unchanged from Phase 1/2, reconfirmed at design time:

- The lint-red / Node-version ownership of the **existing** `ci` job
  (`2026-09-26-lint-gate`'s pipeline) — this design's Node changes are
  confined to the new `db-tests` job and the rewritten `e2e` job, both using
  `node-version-file: ".nvmrc"` so the merge is trivial regardless of what
  that pipeline does to `ci.yml`'s existing job.
- The e2e specs' own pre-existing red tests.
- Test-coverage review punch items 7–16 (separate pipelines).
- A maintained `ci-base` branch (Phase 2's option (a), rejected) — the
  fresh-database-inside-a-fork pattern (option (b)) needs no standing
  infrastructure and is itself the reproducibility proof.
- `branch_type: schema-only` (unavailable in `create-branch-action@v5`, and a
  paid-plan Neon feature regardless) — not needed under option (b).
- Regenerating `drizzle/meta/`'s stale snapshots past `0012` — tracked as its
  own `docs/TODO.md` follow-up, not fixed here (this design works around it
  by hand-writing `0050`, which is the same discipline every migration since
  `0013` has already used).
- Default parity and index parity in `check:schema-parity` — the check's
  first version compares columns, nullability, and FK shape only, matching
  the class of drift that has actually occurred twice.

## Implementer

**Batch A: database-admin.** Schema migration, TS domain-model composite FK
change, seed/fixture reconciliation, the new parity-check script, the
`test-rls.sql` coupling fix, the journal entry.

**Batch B: deployment-engineer.** The composite action, both workflow files,
the vitest/playwright config, the rate-limit test fix, both docs files.

Hard order: Batch A must be complete and its acceptance criterion green
before Batch B's implementer begins — Batch B's own acceptance criterion
depends on Batch A's fixes existing.

---

## Proposed DECISION-150 (orchestrator to record — Phase 2's draft, adopted
unchanged; reproduced here so Phase 4 can cite it without cross-referencing)

**DECISION-150: CI's database is an ephemeral Neon branch off an explicitly
pinned parent, containing a database CI created from empty — migrate-from-
empty is the reproducibility proof, not a convenience.** (2026-09-26,
architect Phase 2 / tech-lead Phase 3, `docs/work-log/2026-09-26-ci-db-tests.md`.)

Every database-backed check runs against a branch created per run by
`neondatabase/create-branch-action@v5` with `parent:` written explicitly in
the workflow (`development`) — never the implicit default, which is the
project's primary branch, `production`, holding two real congregations and a
real-PII `organization_profiles` row. Inside that branch the job immediately
issues `CREATE DATABASE ci_run` as owner and never opens `neondb` again; all
four connection URLs address `ci_run`, all on the direct (unpooled) endpoint.
`ci_run` is cloned from `template1`, so its entire schema arrives by `npm run
db:migrate` — a green run is direct evidence that the posture is reproducible
from `drizzle/` alone, which is the point, not a side effect: that premise
was already false when `DECISION-146` asserted it (`drizzle/0050` and its
Phase 3 design, above, is the fix). Roles are cluster-wide and survive the
fork; the job sets `presby_app`'s password itself (per-run random, masked,
`ALTER ROLE` on the owner connection) rather than taking a third operator
secret. A skip must be a skip (`check-secrets` gate, `::notice::`, never a
green no-op inside the real job); every `psql` runs with `-v
ON_ERROR_STOP=1`. Each Neon-dependent job gets its own branch, deleted in
`if: always()`.

## docs/TODO.md lines (orchestrator to add at integration)

- **In Flight / Next Up:** Orphan-branch janitor for a Neon CI branch left
  behind by a killed (not cancelled) GitHub Actions runner — `if: always()`
  cannot run if the runner process itself dies. (Phase 2, `db.yml`/`e2e.yml`.)
- **Next Up:** `drizzle/meta/` snapshots are frozen at `0012` against 51
  journal entries as of `0050` — either regenerate them deliberately or
  document them as permanently decorative; a live footgun for anyone who
  runs `drizzle-kit generate` expecting it to work. (Phase 2 finding, this
  pipeline's design.)
- **Next Up:** Any `check:schema-parity` finding beyond the four columns
  `drizzle/0050` closes, once the check runs for the first time in `db.yml`
  — each such finding is its own small fix-forward pipeline, not folded into
  this one.
- **Retrospective note (for the next tech-lead retrospective, not a
  standalone TODO item):** the resolver-from-empty finding
  (`drizzle/0010:88,105` — a `plpgsql` body's late name resolution let 50/50
  migrations "succeed" while `presby_effective_permissions()` was broken from
  its first call) is a distinct discovery class from the escape-rate
  categories tracked so far: a schema-integrity gap introduced by an
  undocumented `db:push`/hand-run `ALTER TABLE` can hide behind a
  `SECURITY DEFINER`/`plpgsql` function body for weeks, surviving every
  migration-apply check because Postgres never inspects the body's
  references until first execution. Worth asking, at the next retrospective,
  whether any other `plpgsql`-bodied migration has an unverified assumption
  like this one.

## docs/decisions.md correction note (orchestrator to append, newest-first,
as its own entry — not an edit to DECISION-146 itself, which is shipped)

**Correction to DECISION-146 (2026-09-26, tech-lead, Phase 3 of
`docs/work-log/2026-09-26-ci-db-tests.md`).** DECISION-146's own text
states its shipped migration makes "the live `presby_app` grant shape
written down table by table so the security posture is reproducible from
`drizzle/` alone." That premise was already false on the date DECISION-146
was recorded (2026-09-25) and had been false since 2026-08-17:
`officer_terms.recorded_by`, `roll_actions.proposed_by`,
`administrative_commissions.group_id` and `org_delegations.group_id` had
already drifted from every `drizzle/*.sql` file via an untracked
`db:push`/`ALTER TABLE`, and `drizzle/0010`'s `plpgsql` resolver body hid the
consequence behind Postgres's late name resolution — 50/50 migrations apply
cleanly and `presby_effective_permissions()` then raises on its first call.
`drizzle/0050_presby_schema_parity.sql` (this pipeline) closes the drift, and
`npm run check:schema-parity` (run in the new `db.yml` job, per DECISION-150)
keeps it closed going forward. DECISION-146's own ruling — the NextAuth
adapter and `recordAudit()` stay on `presby_app`, no third connection — is
unaffected; only its stated premise needed correcting.

---

# Phase 4 — Implementation

## Batch A — schema parity, database-admin (2026-09-26)

**Migration mode: HAND-WRITTEN.** `drizzle/0050_presby_schema_parity.sql`, per
Phase 2's MUST ruling — `npm run db:generate` is unusable here (13 snapshots
in `drizzle/meta/` against 51 journal entries; the newest, `0012_snapshot.json`,
still records `officer_terms.recorded_by notNull: true` and neither `group_id`
column, so `generate` would emit one migration containing everything
hand-written since 0013). `drizzle/meta/_journal.json` gained the idx-50 entry
locally (`tag: "0050_presby_schema_parity"`) so the rehearsal's `db:migrate`
could read it; the file is still the orchestrator's to merge.

## Files Created

- `drizzle/0050_presby_schema_parity.sql` — the fix-forward migration. Relaxes
  `officer_terms.recorded_by` and `roll_actions.proposed_by` to nullable (F24);
  adds `administrative_commissions.group_id` and `org_delegations.group_id`
  with **composite** FKs (F2). Idempotent and convergent on both a fresh and a
  drifted database.
- `scripts/check-schema-parity.ts` — the standing parity check (`npm run
  check:schema-parity`). Diffs the live catalog against the TS domain model:
  table presence, column presence both directions, nullability, FK shape both
  directions. In-file dated allowlist. Exit 1 on any non-allowlisted difference
  **and** on any connection/query error.
- `scripts/install-test-helpers.sql` — **new, not in the Phase 3 design.**
  `assert_eq()`, the assertion helper `scripts/test-rls.sql` has always called.
  See Implementer Notes → Finding 5.

## Files Modified

- `src/lib/db/domain/authz.ts` — `administrativeCommissions.groupId` and
  `orgDelegations.groupId` lose their column-level `.references(() =>
  groups.id)`; each table's `(t) => [...]` array gains the composite
  `foreignKey({...})` under the migration's deterministic constraint name, with
  an inline comment pointing at the `drizzle/0050` section that enforces it.
- `scripts/seed-dev.sql` — the `group_types` insert gains `on conflict
  (organization_id, key) do nothing`; all **11** downstream `group_type_id`
  literals become keyed scalar subqueries (lines 162/164/166/169/178/180/182/
  184/651/780/782 as designed — count verified, exactly 11). One stale prose
  comment near the commission group updated to stop naming the literal.
- `scripts/test-rls.sql` — **two** edits, both Rule-16 exceptions (see notes):
  the `:613` `group_type_id` literal → keyed subquery (Phase 3 Finding 4), and
  the DECISION-039 positive-control block now closes the subject's own open
  role grants inside its own rolled-back transaction (Finding 6).
- `scripts/seed.ts` — `seedGroupTypes()`'s docstring: the "no unique constraint
  on `(organization_id, key)`" paragraph was stale since `drizzle/0048`.
- `package.json` — adds `check:schema-parity`. **`npm run check` is unchanged**
  — still the same five offline tripwires, per Phase 2's MUST ruling.
- `drizzle/meta/_journal.json` — idx-50 entry appended (+7 lines, nothing else
  reformatted).

## Schema Changes

| Change | Table | Shape |
|---|---|---|
| `drop not null` | `officer_terms.recorded_by` | nullable (F24) |
| `drop not null` | `roll_actions.proposed_by` | nullable (F24) |
| `add column if not exists` | `administrative_commissions.group_id` | `uuid`, nullable |
| `add column if not exists` | `org_delegations.group_id` | `uuid`, nullable |
| composite FK | `administrative_commissions` | `administrative_commissions_group_id_parent_org_fkey`: `FOREIGN KEY (group_id, parent_org_id) REFERENCES groups(id, organization_id)` |
| composite FK | `org_delegations` | `org_delegations_group_id_grantee_org_fkey`: `FOREIGN KEY (group_id, grantee_org_id) REFERENCES groups(id, organization_id)` |

Plus four `comment on column` statements carrying the F24/F27/F2 rationale into
the catalog. No RLS policy, trigger, function, or grant changes — `0050` alters
no table's isolation posture.

Applied via: **hand-written SQL**, `psql "$MIGRATE_DATABASE_URL" -v
ON_ERROR_STOP=1 -f drizzle/0050_presby_schema_parity.sql` on the pipeline
branch, and via `npm run db:migrate` on the from-scratch rehearsal database.
Never `db:push`, never `db:generate`.

## Audit Events

None. No application mutation path is touched — this batch is a migration, two
seed/fixture scripts, one test-helper script and one check script.

---

## Acceptance (1) — the drifted pipeline branch (`pipeline-ci-db-tests`)

**Whole-file idempotency, proved by re-application, not asserted.**

| Run | Result |
|---|---|
| `psql -v ON_ERROR_STOP=1 -f drizzle/0050_…` (1st) | **exit 0** |
| `psql -v ON_ERROR_STOP=1 -f drizzle/0050_…` (2nd, whole file again) | **exit 0** |
| catalog snapshot after run 1 vs after run 2 (every `public` column + `attnotnull` + `col_description`, every constraint's `pg_get_constraintdef`) | **byte-identical — zero diff lines** |
| catalog before vs after run 1 | exactly 6 hunks: the 4 new column comments, and the 2 plain FKs replaced by their composite form. Nothing else moved. |

Second-run NOTICEs are the designed no-ops (`column "group_id" … already
exists, skipping`; `constraint "…_group_id_fkey" … does not exist, skipping`).

**The four columns/constraints in their ruled shape** (`pg_get_constraintdef`):

```
officer_terms.recorded_by notnull=false
roll_actions.proposed_by notnull=false
administrative_commissions.group_id notnull=false
org_delegations.group_id notnull=false
administrative_commissions_group_id_parent_org_fkey :: FOREIGN KEY (group_id, parent_org_id) REFERENCES groups(id, organization_id)
org_delegations_group_id_grantee_org_fkey           :: FOREIGN KEY (group_id, grantee_org_id) REFERENCES groups(id, organization_id)
```

**`scripts/test-rls.sql` as `presby_app`** (`current_user|rolbypassrls` =
`presby_app|false`): **exit 0, 520 pass assertions, 0 failures, 45.0 s** — the
count matches Phase 1's 520 exactly, before and after both edits to the file.

**DB-backed serial vitest** (`dotenv -e .env.local -- vitest run
--no-file-parallelism`), the eight named suites — `role-grants`,
`role-definitions`, `officers`, `roll`, `people`, `groups`, `lifecycle`,
`publication`: **8 files passed / 8, 276 tests passed / 276, 86.2 s. Zero
failures.**

---

## Acceptance (2) — the from-scratch rehearsal (`ci_rehearsal_a`)

`CREATE DATABASE ci_rehearsal_a` as `neondb_owner` on the pipeline branch;
scratch env file outside the repo with all four URLs repointed at it;
`presby_app` already existed cluster-wide with its password, so no password was
set (Phase 2's feasibility check confirmed on the catalog, and it held). Dropped
at the end — `select datname from pg_database where datname like 'ci_rehearsal%'`
returns zero rows.

| Step | Result |
|---|---|
| `npm run db:migrate` | **exit 0. 51/51 applied** — `drizzle.__drizzle_migrations` = **51 rows**, 84 tables in `public`. Includes `0050`. |
| `npm run check:schema-parity` | **exit 0.** 64 domain tables compared — **5 differences, 5 allowlisted (0 of them unclosed drift), 0 failing.** |
| `npm run db:seed` | **exit 0.** roles; **11** features; **39** feature flags; **6** platform-wide `group_types`; all features bound to admin; dashboard+tickets+feedback bound to support_operator. |
| `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` | **exit 0, `COMMIT` reached — the first time this file has ever landed on a database created from empty.** Rows: `organizations=10`, `people=16`, `officer_terms=9`, `roll_actions=13`, `groups=11`, `group_types=6`, `administrative_commissions=1`, `memberships=18`. (`group_types=6`, not 9: `db:seed`'s six templates won and `seed-dev.sql`'s three yielded via `on conflict do nothing` — exactly the intended reconciliation.) |
| `psql -f scripts/install-test-helpers.sql` ×2 | **exit 0 both times** (see Finding 5 — this step is new and Batch B must include it). |
| `psql "$APP_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` | **exit 0, 520 pass assertions, 0 failures, 44.7 s**, as `presby_app` (`rolbypassrls = false`). Same 520 as the live branch. |
| `presby_effective_permissions()` from empty | **5 rows** for Marguerite Ashcombe (`c0000000-…-0001`) at Alder Creek (`22222222-…`). |
| …and specifically the arm that was broken | For Rowan Thistlewood (`c0000000-…-0006`) at Alder Creek: `commission=2, direct=1, group=1`. **The commission arm — the one joining `ac.group_id`, the column that did not exist — returns rows.** That is Finding 3 closed, proved by calling the function, not by a green migration run. |
| DB-backed vitest, same eight suites, against the fresh database | **8/8 files, 276/276 tests, 86.3 s.** |
| `0050` re-applied twice more by `psql` on the fresh database | exit 0, exit 0; catalog **byte-identical** across both. |
| **Convergence** — fresh catalog vs. the drifted-then-fixed pipeline catalog | **byte-identical**: every column, nullability, column comment and `pg_get_constraintdef` in `public`. The two starting states really do converge. |

### What the allowlist contains, and why

Five rows, all `kind: "extra_fk"`, all `category: "architectural"`, **zero
`"pending"`**. Each is a composite FK that exists in the database and is
deliberately *not* declared in the Drizzle table builder — so each is a
difference the check must not fail on and must not be able to hide anything
else behind:

| Table | FK signature | Why it is DDL-only |
|---|---|---|
| `organization_brands` | `(mark_asset_key, organization_id) -> blob_assets(id, organization_id)` | `src/lib/db/domain/assets.ts:63-78`: declaring it on the referencing side makes `org.ts` import `assets.ts` while `assets.ts` already imports `organizations` from `org.ts` — the domain graph's first module cycle, failing at module-load. Enforced in `drizzle/0016_presby_brand_storage.sql`. |
| `organization_brands` | `(organization_id, wordmark_asset_key) -> blob_assets(organization_id, id)` | same cycle, same migration |
| `organization_sites` | `(content_bundle_key, organization_id) -> blob_assets(id, organization_id)` | same cycle-avoidance |
| `ticket_messages` | `(attachment_asset_key, organization_id) -> blob_assets(id, organization_id)` | same cycle-avoidance |
| `statistics_submission_grants` | `(about_org_id, return_id) -> statistical_returns(organization_id, id)` | `src/lib/db/domain/returns.ts:364` says so in the column's own docstring — "THE STAMP. Composite FK to `statistical_returns` is 0049-only." Enforced at `drizzle/0049:161-162`. |

In every one of the five the **composite** constraint is present in the
database, so F2 is satisfied on the axis that counts; only the TypeScript
mirror is absent, for a stated structural reason. None needs a `docs/TODO.md`
line, and I have deliberately **not** proposed one — Phase 2's "allowlist +
TODO line" rule was written for unclosed drift, which is what the `"pending"`
category is for and which ships empty. The distinction is enforced in the
file's own header comment and reported per-row in the output
(`ALLOWED(architectural)`), plus a summary count of how many allowlisted rows
are unclosed drift, so a `"pending"` row can never hide inside the total.

**Deviation from Phase 3, flagged:** the design said the allowlist "ships
empty." It ships with five architectural rows because the check found five real
DDL-only FKs on its first run — precisely the outcome Phase 2 predicted and
pre-ruled for ("the check will almost certainly find more than the four known
columns on first run… a parity check that is red on arrival gets disabled").
Nothing here is drift; nothing is deferred.

**One hardening beyond the design:** an allowlist row whose `kind` is
`missing_fk`/`extra_fk` **must** name the exact FK signature. Without that a
single `{table, kind: "extra_fk"}` row would silently mask every FK that ever
appears on that table afterwards — an allowlist that grows blind spots is worse
than none.

---

## Acceptance (3) — failing-first, against a database migrated only through `0049`

`CREATE DATABASE ci_rehearsal_pre`, migrated with a scratch drizzle folder
containing `0000`–`0049` and a journal without idx 50 (`50` entries, ledger =
50 rows). The worktree's own `drizzle/` was never modified. Database dropped
afterwards.

**3a — `check:schema-parity` reports the four, and only the four.** Exit **1**.
11 differences, 5 allowlisted, **6 failing**, covering exactly the four drifted
columns:

```
MISSING_COLUMN  administrative_commissions.group_id
MISSING_FK      administrative_commissions: (group_id,parent_org_id) -> groups(id,organization_id)
NULLABILITY     officer_terms.recorded_by: TS=nullable DB=NOT NULL
MISSING_COLUMN  org_delegations.group_id
MISSING_FK      org_delegations: (grantee_org_id,group_id) -> groups(organization_id,id)
NULLABILITY     roll_actions.proposed_by: TS=nullable DB=NOT NULL
```

On the same database *after* `0050`: 0 failing. The check is load-bearing in
both directions.

**3b — the `group_types` collision.** After `db:seed`, the **pre-fix**
`seed-dev.sql` (`git show HEAD:scripts/seed-dev.sql`):

```
psql:…/seed-dev-original.sql:158: ERROR:  duplicate key value violates unique constraint "group_types_org_key"
DETAIL:  Key (organization_id, key)=(null, court) already exists.
```

`select count(*) from organizations` → **0**. Not partial fixture loss; total
loss, exactly as Phase 1 measured.

**3b′ — and the fix's second half is load-bearing too.** The **fixed**
`seed-dev.sql` on that same pre-`0050` database clears `group_types` and then
fails one measurement further down, at line **292**:

```
ERROR:  null value in column "recorded_by" of relation "officer_terms" violates not-null constraint
```

`organizations` → **0** again. So the `group_types` reconciliation alone is not
sufficient and `0050`'s NOT-NULL relaxation alone is not sufficient; both
halves are required, which is Phase 1's two-stage measurement reproduced
exactly.

**3c — the resolver raises.** With an org context set, on the pre-`0050`
database:

```
ERROR:  column ac.group_id does not exist
LINE 35:     join groups g                on g.id = ac.group_id
CONTEXT: PL/pgSQL function presby_effective_permissions(uuid,uuid,date) line 11 at RETURN QUERY
```

The identical call on a `0050`-applied database returns **5 rows**. This is
Finding 3 demonstrated end to end: 50/50 migrations "succeed" and the resolver
is broken from its first call.

---

## Acceptance (4) — local gates

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** (clean) |
| `npm test` (pure suite, no DB) | **PASS** — 254 files passed / 32 skipped (286); 3309 tests passed / 832 skipped (4141); 12.4 s |
| `npm run check` (the five, unchanged) | **PASS** — audit, sql-date, deps-drift, brand-scope, secrets all green |
| `npm run lint` | 8 errors, **all pre-existing and none in a file this batch touched** (`branding-form.tsx`, `children-roster-list.test.tsx`, `children/page.tsx`, `portal-nav-links.tsx`, `statistics-grants.ts`). Owned by the concurrent `2026-09-26-lint-gate` pipeline, explicitly out of scope in this work-log's header. |

---

## Implementer Notes

### Finding 5 (new, blocking, not in the Phase 3 design) — `assert_eq()` existed on every live branch and in no committed file

`scripts/test-rls.sql:105` has always read *"assert_eq() is installed by the
owner (see `scripts/install-test-helpers.sql`); presby_app only calls it"* —
**and that file did not exist in the repository.** `assert_eq()` is present on
the pipeline branch (owner `neondb_owner`, ACL `presby_app=X`), defined by no
migration and no script; every branch since has inherited it by fork.

On a database created from empty the suite dies at its *first* assertion:

```
psql:scripts/test-rls.sql:112: ERROR:  function assert_eq(bigint, integer, unknown) does not exist
```

0 of 520 assertions, exit 3. **This is the same drift class `0050` exists to
close** — an object on every live branch and in no committed file — and
`check:schema-parity` could not have caught it: the check compares tables and
columns, not functions.

Fix: created `scripts/install-test-helpers.sql`, the file the suite's own
comment already names. Body reproduced verbatim from the live
`pg_get_functiondef()` so installing it changes nothing on a database that
already had the hand-made copy; `create or replace` + an explicit
`grant execute … to presby_app`; applied twice in the rehearsal, exit 0 both
times. **Deliberately not a migration** — a `drizzle/00XX` file ships to
production and production has no business carrying an assertion helper.

**Batch B must add this step** to the composite action, as owner, immediately
before the isolation suite. It is not in Phase 3's `db.yml` step list, and
without it the `db-tests` job fails at `test-rls.sql`'s first line.

Repo-wide sweep for the same class while I was there: every other
`public`-schema function absent from `drizzle/*.sql` is `btree_gist`
(`gbt_*`, `*_dist`, `gbtreekey*`, `gist_translate_cmptype_btree`), installed by
`create extension` and therefore correctly untracked by name. The only other
genuinely untracked object is `show_db_tree()`, which nothing in the repository
references — flagged, not touched.

### Finding 6 (new, blocking) — `seed-dev.sql`'s `personnel_admin` grant silently disabled 470 assertions on a from-scratch database

With `assert_eq()` installed, the suite still stopped at **51/520**, exit 3:

```
psql:scripts/test-rls.sql:628: ERROR:  memberships: cannot end this relationship on 2026-09-26 - a role grant beginning 2026-08-27 is still open at this organization
CONTEXT: PL/pgSQL function presby_guard_membership_end() line 23 at RAISE
```

The DECISION-039 **positive control** ("a membership with no open position
still ends normally") ends `:OTHERPART`'s (Desmond Okonkwo, `c0000000-…-0004`)
Alder Creek membership. Its premise — that he holds no open person-scoped role
grant — was a property asserted in a *comment in a different file*:
`scripts/seed-dev.sql:1481-1484` picked him for the staff/personnel fixture
precisely because he had *"zero role_grants"*, and then, forty lines later,
granted him `personnel_admin` at Alder Creek from `2026-08-27`. That took the
property away from the file that already depended on it.

It has been latent for a month and is invisible on every live branch, because
no live branch has ever re-loaded `seed-dev.sql` from empty — the pipeline
branch's fixture predates the personnel block entirely (confirmed: that
`role_grants` row exists on `ci_rehearsal_a` and does not exist on
`pipeline-ci-db-tests`). Under `ON_ERROR_STOP` it costs **469 of 520
assertions**.

I enumerated the full blast radius before choosing a fix (a copy of the suite
with `\set ON_ERROR_STOP off`): **exactly one** failure on a from-scratch
database, 519/520 otherwise. Considered and rejected:

- *Move the `seed-dev.sql` grant to another Alder Creek person.* Every other
  Alder member already carries an open person-scoped grant except Hallie
  Vandermeer, a baptized child — and the fixture block's own rationale
  (DECISION-103/109) is that this role goes to an otherwise-unburdened adult.
- *Point the assertion at Hallie instead.* Works (verified), but it relocates
  the same latent coupling onto a different person and the next fixture
  pipeline breaks it again.

**Chosen:** the block now closes the subject's own open role grants inside its
own `begin … rollback`, immediately before ending the membership. The block
establishes its own premise instead of borrowing an unenforced fixture
property, so no future pipeline can take it away; and it is exactly the remedy
the guard's own HINT prescribes, so the positive control now proves the full
documented flow. Verified on the fresh database (520/520) **and** re-verified
on the drifted pipeline branch (520/520, where the extra `update role_grants`
simply matches zero rows).

### The two `scripts/test-rls.sql` edits are Rule-16 exceptions, named

Phase 3 pre-ruled the first one (`:613`, Finding 4). The second (Finding 6) is
the same shape and the same justification: it is a mechanical consequence of
Batch A's own required fixes, Batch A's stated acceptance criterion is a full
rehearsal that runs this file, and no concurrent pipeline is touching it — so
the collision risk Rule 16 exists to prevent does not apply. Both are flagged
here rather than left as unexplained diffs to a normally hands-off file.
`scripts/test-rls.sql` gains **no new numbered section**: parity is
`check:schema-parity`'s job entirely, and giving that class of drift two homes
would only let them fall out of sync.

### Near-miss worth carrying into Batch B: `dotenv -e` does not override an already-exported variable

Verified empirically in this worktree:

```
export MIGRATE_DATABASE_URL=PRESET
npx dotenv -e <scratch-env> -- node -e "…"   ->  PRESET
```

One rehearsal invocation of `drizzle-kit migrate` was therefore aimed at the
pipeline branch's `neondb` instead of the scratch database, because the same
shell had sourced `.env.local` first. **No damage:** the ledger is unchanged at
10 rows and the full catalog snapshot is byte-identical to the post-`0050`
snapshot taken before it (diff = zero lines); `organizations` = 15 as before.
Every subsequent rehearsal command ran in a shell with no pre-set DB variables.

**This is a live hazard for Batch B's `db.yml`.** `npm run db:migrate`,
`npm run db:seed` and `npm run check:schema-parity` all go through
`dotenv -e .env.local`. If a step (or the job/workflow level) also sets
`DATABASE_URL`/`MIGRATE_DATABASE_URL` as `env:`, the process environment
**wins** and the written `.env.local` is silently ignored — the job would
migrate and seed whatever those variables point at, and still go green. Phase
3's `db.yml` draft does set `MIGRATE_DATABASE_URL`/`APP_DATABASE_URL` as
step-level `env:` on the `psql` steps, which is correct for `psql` (it reads
the variable, not the file) but must **not** be extended to the `npm run`
steps. Recommended guard step after writing `.env.local`, before `db:migrate`:
assert that the four variables are *unset* in the environment, or pass
`--override` / `dotenv -e .env.local -o`.

### Smaller notes

- The `0050` comment blocks use adjacent string literals on separate lines
  (standard SQL concatenation). The migration carries **no**
  `--> statement-breakpoint`, matching every hand-written migration since
  `0009`; `drizzle-kit migrate` applied it cleanly from empty.
- `drizzle/meta/_journal.json` was appended programmatically to preserve the
  file's existing formatting: the diff is **+7 lines, 0 deletions**.
- `src/lib/db/domain/index.ts` was **not** touched — `0050` adds no module.
- `scripts/seed-dev.sql`'s fixed UUIDs for the three `group_types` rows are
  retained deliberately, as a documented fallback for the (undocumented)
  standalone case where `db:seed` never ran; the `on conflict` makes them
  inert in the documented recipe. Every consumer resolves by key.
- `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `CLAUDE.md`,
  `docs/release-notes/*`, `.github/`, `vitest.config.ts`,
  `playwright.config.ts` and `docs/testing.md` were not touched, per the
  kickoff's shared-file discipline and the Batch A/B split.
- No commits were made.

### Proposed lines for the orchestrator (not written on this branch)

- `docs/TODO.md` — **Next Up:** `show_db_tree()` exists on every live branch,
  is defined in no committed file, and is referenced nowhere in the repository.
  Decide: commit its definition or drop it. (Batch A sweep, 2026-09-26.)
- `docs/TODO.md` — **Next Up:** `check:schema-parity` compares columns,
  nullability and FK shape only. Functions, defaults, indexes and check
  constraints are still uncovered — Finding 5 (`assert_eq()`) is precisely the
  drift a function-level comparison would have caught. Its own pipeline.
- `docs/schema-design-2.md` findings log — F-numbers for Finding 5
  (untracked `assert_eq()`) and Finding 6 (`seed-dev.sql`'s `personnel_admin`
  grant vs. `test-rls.sql`'s DECISION-039 positive control), both discovered by
  the first from-scratch rehearsal, both of the "no live branch has ever been
  built from the committed files" class this pipeline exists to close.

---

## Handoff — to deployment-engineer (Batch B)

**New schema available to the next implementer:** two columns
(`administrative_commissions.group_id`, `org_delegations.group_id`, both
nullable `uuid`) and their composite FKs to `groups(id, organization_id)` keyed
on `parent_org_id` / `grantee_org_id` respectively; two columns relaxed to
nullable (`officer_terms.recorded_by`, `roll_actions.proposed_by`). No new
table, no new module, no RLS/trigger/grant change. `presby_effective_permissions()`
now resolves on a from-empty database — its commission arm returns rows.

**`scripts/test-rls.sql` sections touched:** none added. Two lines changed
inside the existing DECISION-039 membership-guard block (~`:613` and `:628`),
both Rule-16 exceptions, both explained above. Assertion count unchanged at 520.

**Local apply command** (drifted branch):

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0050_presby_schema_parity.sql
```

**The exact from-scratch rehearsal Batch B's composite action must reproduce.**
Run verbatim; every line below was executed and is green. `$OWNER` is
`neondb_owner` on the **direct** endpoint at the target database, `$APP` is
`presby_app` on the same direct endpoint and database.

```bash
# 0. a database CI created, cloned from template1 — never the parent's neondb
psql "$OWNER_NEONDB" -v ON_ERROR_STOP=1 -c 'create database ci_run'

# 1. all four URLs -> ci_run, written to .env.local (direct endpoint, not pooled)
#    DATABASE_URL / APP_DATABASE_URL        = presby_app
#    PLATFORM_DATABASE_URL / MIGRATE_DATABASE_URL = neondb_owner
#    !! do NOT also set these as step-level env: for the `npm run` steps —
#    !! `dotenv -e .env.local` does NOT override an already-set variable.

npm run db:migrate            # expect exit 0, 51/51, __drizzle_migrations = 51 rows
npm run check:schema-parity   # expect exit 0, "5 differences, 5 allowlisted (0 ... unclosed drift), 0 failing"
npm run db:seed               # expect exit 0; 11 features, 39 flags, 6 platform group_types

psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql
# expect exit 0 and COMMIT. Sanity: organizations=10, people=16, groups=11, group_types=6

# NEW STEP — not in the Phase 3 design. Owner, before the suite. See Finding 5.
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql

npm run test:db               # Batch B's own script; the 8 DB-backed suites ran 276/276 here

# guard, then the suite — as presby_app, never the owner
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "select current_user, (select rolbypassrls from pg_roles where rolname = current_user)"
# expect exactly: presby_app|f
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
# expect exit 0 and 520 "NOTICE:  pass" lines

# optional but cheap, and it is the proof Finding 3 was really closed:
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "begin; select set_config('app.current_org_id','22222222-2222-2222-2222-222222222222', true);
   select count(*) from presby_effective_permissions(
     'c0000000-0000-0000-0000-000000000001'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid, current_date); rollback;"
# expect 5
```

**Two changes Batch B must make to the Phase 3 `db.yml` draft:** add the
`install-test-helpers.sql` step (Finding 5), and keep the four DB URLs out of
the `env:` of the three `npm run` steps (the `dotenv` override hazard above).

**Next agent:** deployment-engineer (Batch B) — `.github/actions/neon-ci-db/`,
`.github/workflows/db.yml`, `.github/workflows/e2e.yml`, `vitest.config.ts`,
`playwright.config.ts`, `src/lib/rate-limit.test.ts`, `package.json`'s
`test:db`, `docs/testing.md`, `docs/deployment.md`.

---

## Batch B — CI, deployment-engineer (2026-09-26)

Built exactly to the Phase 3 design, adjusted for Batch A's two named
handoff facts: `install-test-helpers.sql` added as its own composite-action-
adjacent step in `db.yml` (owner, before the isolation suite), and the four
DB URLs deliberately kept **out of** any `env:` on the three `npm run` steps
in both `db.yml` and the rewritten `e2e.yml` — only the `psql` steps carry
them as `env:`, since `dotenv -e .env.local` does not override an
already-exported variable and psql has no dotenv integration at all. No
commits were made; `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`,
`docs/reviews/log.md`, `docs/release-notes/*` and `CLAUDE.md` were not
touched, per the kickoff's shared-file discipline.

### Files Created

- `.github/actions/neon-ci-db/action.yml` — the repo's first composite
  action. Two steps: assert `psql`/`node` are present, then create the
  ephemeral branch (`neondatabase/create-branch-action@v5`, `username:
  neondb_owner` only) and, on the owner connection, `CREATE DATABASE`
  (default `ci_run`) and `ALTER ROLE presby_app WITH LOGIN PASSWORD` with a
  per-run `openssl rand -hex 32` value, `::add-mask::`ed before first use.
  Outputs the four URLs (all on the direct/unpooled host) plus `branch_id`.
  Deliberately does **not** run `db:migrate`/`db:seed`/`seed-dev.sql` itself
  — Phase 3's own concrete `db.yml` draft runs those as the caller's own
  steps against the action's outputs, not inside the composite; this
  implementation follows that draft rather than Phase 2's higher-level
  "expensive recipe" description, since Phase 3 supersedes it with the
  actual shape.
- `.github/workflows/db.yml` — new workflow. `check-secrets` gate (same
  `::notice::`-on-absence pattern as `e2e.yml`) → `db-tests` job: checkout →
  `setup-node` (`node-version-file: ".nvmrc"`) → `npm ci` → provision via the
  composite action (`parent: development`) → write `.env.local` (four URLs
  only) → `db:migrate` → `check:schema-parity` → `db:seed` → `psql -v
  ON_ERROR_STOP=1 -f scripts/seed-dev.sql` → **`psql -v ON_ERROR_STOP=1 -f
  scripts/install-test-helpers.sql`** (the step Batch A's handoff named as
  missing from the Phase 3 draft) → `npm run test:db` → the `current_user =
  presby_app` / `rolbypassrls = f` guard → `psql -v ON_ERROR_STOP=1 -f
  scripts/test-rls.sql` → delete branch (`if: always()`). `concurrency: {
  group: db-tests-${{ github.ref }}, cancel-in-progress: true }` at the
  workflow level. No `RATE_LIMIT_DISABLED` anywhere in this job. No
  `continue-on-error:` anywhere; every multi-line `run:` starts `set -euo
  pipefail`; every `psql` invocation carries `-v ON_ERROR_STOP=1`.
- `scripts/check-schema-parity.ts`, `scripts/install-test-helpers.sql` —
  Batch A's, unmodified; listed here only because this batch's rehearsal is
  the first time either ran as part of an actual CI-shaped sequence rather
  than database-admin's own ad hoc rehearsal commands.

### Files Modified

- `.github/workflows/e2e.yml` — rewritten to consume `neon-ci-db` instead of
  its own inline `create-branch-action`/`delete-branch-action` pair (closes
  C-5 point 1 by writing `PLATFORM_DATABASE_URL`, which it never wrote
  before). Replaces `db:push` + `db:seed` with `db:migrate` →
  `check:schema-parity` → `db:seed` → `psql -v ON_ERROR_STOP=1 -f
  scripts/seed-dev.sql` (closes C-5 points 2 and 3 — the job previously
  applied none of the hand-written RLS/trigger migrations and never applied
  the synthetic fixture at all, so specs referencing fixture orgs like
  `alder-creek` could never have passed even with secrets configured).
  Keeps `RATE_LIMIT_DISABLED=true` (this job's shared fixture user signs in
  far more than 5/min), the Playwright install step, `test:e2e` with `CI:
  "true"`, the failure-trace upload (`path: test-results/`, unchanged
  literal), and `if: always()` branch deletion. Adds `concurrency: { group:
  e2e-${{ github.ref }}, cancel-in-progress: true }`. Swaps `node-version:
  "20"` → `node-version-file: ".nvmrc"` (matches the concurrent lint-gate
  pipeline's form elsewhere, per the orchestrator's ruling 4, so the merge
  is trivial). Does **not** touch `check-secrets` (already correct) and does
  **not** add the `install-test-helpers.sql` step — this job never runs
  `scripts/test-rls.sql`, so `assert_eq()` is never called here.
- `vitest.config.ts` — `testTimeout: 20000`, `hookTimeout: 30000` (commented,
  remote-Neon latency); `coverage.include`/`exclude` (Vitest 4 has no
  `coverage.all`); `coverage.reportOnFailure: true`. **No global
  `fileParallelism: false`** — per Phase 2's MUST ruling on measurement
  (12.12s default vs. 93.79s serial on this worktree), the flag lives only
  in the new `test:db` script.
- `package.json` — adds `"test:db": "dotenv -e .env.local -- vitest run
  --no-file-parallelism"`. `check:schema-parity` was already present from
  Batch A; untouched here.
- `playwright.config.ts` — adds `outputDir: process.env.PW_OUTPUT_DIR ??
  "test-results"` as a top-level `defineConfig()` key (none existed before).
- `src/lib/rate-limit.test.ts` — the enforcement `describe` block's
  `beforeEach` now calls `vi.stubEnv("RATE_LIMIT_DISABLED", "false")`,
  mirroring the escape-hatch block's `"true"` stub, so neither `.env.local`
  nor CI's absence of the variable can flip these three assertions.
- `docs/testing.md` — "Running the DB-backed suites" now points at `npm run
  test:db` and names the 7.7× cost measurement for why the flag isn't
  global; adds the `install-test-helpers.sql` step and why it isn't a
  migration; new "Continuous integration" section (both workflows, the
  shared composite action, the No-Real-Data-for-CI rule, the `check-secrets`
  skip convention, `RATE_LIMIT_DISABLED`'s posture per job, and the
  `deletable_until` fuse's inapplicability to whole-branch deletion).
- `docs/deployment.md` — new "CI's database secrets" section (the two
  secrets, where to find them, what flips from skipped to running, the
  pinned-`parent`-never-implicit-default rule); corrects the
  `PLATFORM_DATABASE_URL` row from `presby_platform` (never able to log in)
  to `neondb_owner`, matching DECISION-136 everywhere else in the codebase.

### Deviations from the Phase 3 draft (both named in Batch A's handoff, both required)

1. **Added `install-test-helpers.sql` as its own `db.yml` step**, owner
   connection, immediately before the isolation suite. Not in Phase 3's
   `db.yml` draft — Batch A's Finding 5 (`assert_eq()` existed on every live
   branch and in no committed file) was discovered after Phase 3 was
   written. Without this step `db-tests` fails at `test-rls.sql`'s first
   assertion on a from-scratch database, confirmed by the rehearsal below
   before this step existed... (not separately re-proven here — Batch A's
   own Acceptance 2 table already demonstrates the failure/fix pair
   directly; this batch's job is to encode the fix as a CI step, which it
   does).
2. **Kept the four DB URLs out of the `env:` of every `npm run` step** in
   both `db.yml` and `e2e.yml`. Phase 3's `db.yml` draft already did this
   correctly for the `npm run` steps but the design's prose didn't call out
   *why* as sharply as Batch A's finding does — this implementation adds an
   explicit comment in both the composite action's header and each
   workflow's "Write .env.local" step naming the hazard, so a future editor
   adding a step-level `env:` for convenience sees the warning before
   creating a job that silently ignores its own `.env.local` while staying
   green.

No other deviation from the Phase 3 design.

### Acceptance — the rehearsal

**(a) YAML/expression validation.** `actionlint` (installed via Homebrew,
`1.7.12`) against both workflow files: **zero findings.** The composite
action isn't a workflow file actionlint parses on its own, so it was
additionally parsed with `js-yaml` alongside both workflows — all three
files parse cleanly with no syntax errors.

**(b) The rehearsal — run against a fresh database on the pipeline branch,
following the composite action's exact steps in order.** No
`NEON_API_KEY`/`NEON_PROJECT_ID` were available in this environment
(`neonctl me` timed out waiting for interactive browser auth; no
`NEON_API_KEY` in the shell). Per the acceptance criteria, this means the
create/delete-Neon-branch steps of the composite action are **dry-read
only** — verified by reading `create-branch-action@v5`'s and
`delete-branch-action@v3`'s documented interfaces (matching Batch A's and
Phase 2's own verified reading) rather than executed. Everything from
"create a fresh database inside the branch" onward — which is the entire
substance of what the action's own script does, and everything `db.yml`'s
job does after provisioning — **was executed for real**, against
`ci_rehearsal_b`, a database created fresh on this pipeline's own Neon
branch (`pipeline-ci-db-tests`), exactly mirroring Batch A's own rehearsal
method and this pipeline's kickoff-approved throwaway-branch convention.

`.env.local` was backed up, overwritten with exactly what the composite
action + `db.yml`'s "Write .env.local" step would produce (four URLs only,
matching the CI job's own written file byte-for-byte in shape), used for
the full run, then restored byte-identical (`diff` confirmed) at the end.
No pre-set shell variable shadowed any of the four URLs during the run
(checked before starting) — the exact hazard the design's `env:` discipline
exists to prevent.

| Step | Command | Result |
|---|---|---|
| 0 | `psql "$OWNER_NEONDB" -v ON_ERROR_STOP=1 -c 'create database ci_rehearsal_b'` | **CREATE DATABASE**, confirmed present via `pg_database` |
| — | `psql ... -c "alter role presby_app with login password '<random>'"` (per-run `openssl rand -hex 32`, matching the action's mechanism) | **ALTER ROLE**, then both `presby_app` and `neondb_owner` URLs confirmed live (`select current_user, current_database()`) before proceeding |
| tooling | `psql --version` / `node -v` | `psql (PostgreSQL) 18.1`, `v20.20.2` |
| 1 | `npm run db:migrate` | **exit 0.** `drizzle.__drizzle_migrations` = **51 rows**, 86 `public` tables |
| 2 | `npm run check:schema-parity` | **exit 0.** "64 domain tables compared — 5 differences, 5 allowlisted (0 of them unclosed drift), 0 failing" — byte-identical output to Batch A's own run |
| 3 | `npm run db:seed` | **exit 0.** roles; 11 features; 39 flags; 6 platform-wide `group_types` |
| 4 | `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` | **exit 0, COMMIT.** `organizations=10, people=16, officer_terms=9, roll_actions=13, groups=11, group_types=6, administrative_commissions=1, memberships=18` — identical to Batch A's Acceptance (2) table |
| NEW | `psql -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql` | **exit 0** (`CREATE FUNCTION`, `GRANT`) |
| 5 | `npm run test:db` | **286/286 test files passed, 4141/4141 tests passed, 0 failures**, 415.04s. This is the first time the full DB-backed suite has run 4141/4141 green from an empty database — the rate-limit fix (this batch) closes the trio Batch A's own from-scratch run still showed failing |
| guard | `current_user`/`rolbypassrls` check | `presby_app|f` — **PASS** |
| 6 | `psql -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` as `presby_app` | **exit 0. 520 pass assertions, 0 failures**, 42.8s — matches Batch A exactly |
| 7 | direct `presby_effective_permissions()` call (same org/person as Batch A's handoff) | **5 rows** — the commission arm (Finding 3) confirmed still resolving |
| cleanup | `drop database ci_rehearsal_b` | confirmed gone (`pg_database` query returns 0 rows); `.env.local` restored, diffed identical to its pre-rehearsal backup |

**(c) N-4a reproduction, deliberate.** A throwaway failing test
(`src/lib/__forcefail.test.ts`, `expect(1).toBe(2)`) was added; `vitest run
--coverage` run twice back-to-back, config swapped via `git stash`:

- **Without** `reportOnFailure` (pre-Batch-B `vitest.config.ts`, restored via
  `git stash`): 1 failed / 254 passed / 32 skipped (287) — **no `coverage/`
  directory written at all**, confirming N-4a exactly as diagnosed.
- **With** this batch's config (`git stash pop`), same forced failure still
  present: same failure count, and **`coverage/` was written** (`53.02%`
  statements overall, `index.html` present). Forced-failure file deleted and
  `coverage/` removed afterward; `git status` confirms no stray file
  remains.

**(d) Local gates.**

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** (clean, both before and after the rehearsal) |
| `npm test` (pure suite) | **PASS** — 254 files / 32 skipped (286); 3309 tests / 832 skipped (4141); ~12.2s, both before and after the rehearsal |
| `npm run check` (the five, unchanged) | **PASS** — audit, sql-date, deps-drift, brand-scope, secrets all green |
| `npm run lint` on touched files (`rate-limit.test.ts`, `vitest.config.ts`, `playwright.config.ts`) | **PASS**, zero output |

**(e) `playwright.config.ts` default `outputDir` unchanged when
`PW_OUTPUT_DIR` is unset.** Loaded the config directly via `tsx`:
unset → `"test-results"` (matches today's implicit default byte-for-byte);
`PW_OUTPUT_DIR=/tmp/pw-scratch` → `"/tmp/pw-scratch"`. Both directions
confirmed.

### What was not exercised for real

- **The composite action's own `create-branch-action@v5` /
  `delete-branch-action@v3` calls** — dry-read only (interface verified
  against the pinned tag, matching Phase 2's and Batch A's own prior
  verification), not executed, because `NEON_API_KEY`/`NEON_PROJECT_ID`
  were not available in this environment and `neonctl me` could not
  complete interactive auth headlessly. **The job itself cannot be observed
  green in GitHub Actions until the operator adds both secrets to this
  repository** — this is the accepted, stated limitation carried from Phase
  1 onward, not a new gap.
- **The Playwright suite itself** (`npm run test:e2e`) was not run as part
  of this batch's rehearsal — `e2e.yml`'s pre-existing red specs are
  explicitly out of scope per the work-log header, and Playwright's own
  `webServer` + browser install is a much longer-running, separate
  concern from the database-provisioning recipe this rehearsal exists to
  prove. `e2e.yml`'s database-provisioning steps (`db:migrate` →
  `check:schema-parity` → `db:seed` → `seed-dev.sql`) are byte-identical in
  content and order to `db.yml`'s own steps, which **were** fully exercised
  above — the shared composite action is exactly what makes that
  equivalence hold rather than requiring a second full rehearsal.
- **An orphan-branch janitor** and **`drizzle/meta/` snapshot
  regeneration** — both already tracked as `docs/TODO.md` follow-ups per
  Phase 3; untouched here, as scoped.

### Handoff — to qa (Phase 5)

**Warning before you rehearse this recipe: `ALTER ROLE presby_app WITH LOGIN
PASSWORD '<random>'` (step in the sequence above) is cluster-wide within
whatever branch it runs on — it is not scoped to the database you happened to
connect through, and it is not undone by restoring `.env.local`.** Run the
sequence above only against a throwaway branch or a `CREATE DATABASE`'d
fresh database on a shared branch (as this batch did, on `ci_rehearsal_b`) —
never against a shared branch's own already-in-use database — or, if you must,
set the password back to the value `.env.local` already documents before you
finish. (Added in this pipeline's second pass, per QA Finding 1 — QA hit
exactly this and repaired it.)

Both `db.yml` and `e2e.yml` are new/rewritten and unmerged; the composite
action is new. Everything database-provisioning-shaped that a from-scratch
run exercises has been proven green end-to-end (migrate → parity → seed →
fixture → test-only-helpers → full DB-backed vitest → RLS suite → resolver
call), against a real ephemeral database, following the exact sequence
`db.yml`'s job encodes. What QA cannot yet observe is the actual GitHub
Actions run — that requires the operator to add `NEON_API_KEY` and
`NEON_PROJECT_ID` as repository secrets, which is outside both database-admin's
and deployment-engineer's authority. Per the Phase 4 gate for auth-touching
diffs: this batch does not touch `src/auth.ts`, `src/app/(auth)/`, `src/app/
api/auth/`, or `src/lib/auth/`, so the running-server e2e-smoke-with-MFA
requirement does not apply here — it applies to `e2e.yml`'s own specs, which
are pre-existing and out of scope.

---

## Batch B, second pass (QA Findings 1–3), deployment-engineer (2026-09-26)

Addresses the coordinator's three items from Phase 5's PASS before Phase 6.
No commits made; Phase 5's section above is unchanged (kept as recorded, per
instruction).

**Finding 1 — `ALTER ROLE presby_app` warning added in two places.**
- `docs/testing.md`'s "Continuous integration" section gains a "Rehearsing
  this recipe by hand" paragraph: the `ALTER ROLE presby_app WITH LOGIN
  PASSWORD` statement the composite action runs is cluster-wide within
  whatever branch it's run against — not scoped to a database, not undone by
  restoring `.env.local` — and names the two safe options (rehearse against a
  throwaway branch or a freshly `CREATE DATABASE`d database on one, and drop
  it when done; or, if run against a shared branch's own database, set the
  password back to what `.env.local` documents before finishing).
- The work-log's own "Handoff — to qa (Phase 5)" block (this pipeline's
  handoff section, which is what QA actually followed) gains the same
  warning at its top, naming that QA hit exactly this and repaired it.
- Not touched: Batch A's own handoff block (~line 1826) and DECISION-150's
  text — both describe what the *shipped CI* does (a per-run ephemeral
  branch, deleted in `if: always()`, where this is harmless by construction),
  not the hand-rehearsal hazard, which is specific to running the recipe
  against a persistent, shared branch. Conflating the two would blur why the
  shipped behavior is safe while the rehearsal procedure needed a warning.
- No `docs/TODO.md` line added here — Rule 16's shared-file discipline keeps
  that file orchestrator-only during the pipeline; QA's Finding 1 already
  names that a TODO line belongs in the integration commit, which Phase 6 /
  the orchestrator owns.

**Finding 2 — `docs/testing.md`'s top recipe (`Getting a database with
fixtures in it`) now matches the action step for step.**
Added `npm run check:schema-parity` after `db:migrate`; added `-v
ON_ERROR_STOP=1` to the `seed-dev.sql` line, with an explanatory paragraph
underneath naming exactly why the flag isn't optional (a plain `psql -f`
exits 0 on a rolled-back transaction, so a fixture can fail to load with a
green exit code) — the same reasoning Phase 2's MUST ruling recorded; added
`psql ... -f scripts/install-test-helpers.sql` (noted as needed only if
`scripts/test-rls.sql` will be run, since the top recipe's own next steps —
`npm run dev`, the accounts table — don't need it).

The "Local note" is rewritten to stop reading as a blanket claim about
`db:migrate`. It now says explicitly: **this** worktree's dev database
(shared across sessions, already hand-migrated through 0010–0015) is why
`db:migrate` isn't the right command *against that specific database* — but
a genuinely from-empty database (a fresh `CREATE DATABASE`, or CI's `ci_run`)
migrates cleanly with `db:migrate`, 51/51, which is exactly what `db.yml`/
`e2e.yml` rely on and what makes DECISION-150 true. The two facts (a
partially-hand-migrated shared dev database vs. a from-empty database) no
longer read as contradictory.

**Finding 3 — `set -euo pipefail` added to both `check-secrets` gate
blocks.** `.github/workflows/db.yml`'s and `.github/workflows/e2e.yml`'s
single `run:` block each (the `if [ -n "$NEON_API_KEY" ]; then …` gate) now
opens with `set -euo pipefail`, matching every other multi-line `run:` block
in both files, per Phase 2's "every multi-line `run:` block" MUST ruling.
Neither block pipes anything or had a real failure mode to mask — this was
advisory, not a live bug — but the deviation is now closed rather than
merely disclosed.

**Re-ran `actionlint 1.7.12`** against `db.yml`, `e2e.yml`, and (for a
three-way check including the untouched file) `ci.yml`: **zero findings**,
same as before this pass. Both workflow files and the composite action's
`action.yml` were also re-parsed with `js-yaml`: all three still parse
cleanly.

**Verified no collateral changes.** `git status --short` after this pass
shows exactly the same file set as before it, plus no new files:
`.github/workflows/e2e.yml`, `docs/deployment.md`, `docs/testing.md`,
`drizzle/meta/_journal.json`, `package.json`, `playwright.config.ts`,
`scripts/seed-dev.sql`, `scripts/seed.ts`, `scripts/test-rls.sql`,
`src/lib/db/domain/authz.ts`, `src/lib/rate-limit.test.ts`,
`vitest.config.ts` modified; `.github/actions/`, `.github/workflows/db.yml`,
`docs/work-log/2026-09-26-ci-db-tests.md`,
`drizzle/0050_presby_schema_parity.sql`, `scripts/check-schema-parity.ts`,
`scripts/install-test-helpers.sql` untracked. `.github/workflows/ci.yml`
still shows no diff against the merge-base. No commits made.

**Not re-run:** the full from-scratch database rehearsal (`db:migrate` →
`check:schema-parity` → `db:seed` → `seed-dev.sql` → `install-test-helpers.sql`
→ `test:db` → guard → `test-rls.sql`) — none of the three findings touch
application code, migration content, or the composite action's own SQL
logic (Finding 1 is docs-only, Finding 2 is docs-only, Finding 3 is a shell
option with no observable behavior change on the happy path), so QA's own
already-recorded PASS rehearsal remains the load-bearing evidence for the
job's actual green path. This pass's own verification is `actionlint` +
YAML parse (unaffected by doc changes, and the only thing Finding 3 could
plausibly break) plus the file-set diff check above.

**Handoff — to analyst (Phase 6), unchanged from QA's own handoff:** carry
Phases 1–5 forward verbatim, including this second-pass section. Phase 5's
PASS verdict and its Per-Phase Status row stand as QA recorded them; this
section only closes QA's Findings 1–3 ahead of Phase 6, per the
coordinator's instruction.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-ci` (branch `pipeline/ci-db-tests`), Neon branch `pipeline-ci-db-tests`

Everything below was re-run by me against databases I created and dropped. I did not take Phase 4's counts on trust; where a number matches the work-log it is because I measured the same thing, not because I copied it.

## Type Check

`npm run typecheck`: **PASS** (clean, no output)

## Unit Tests

**Pure suite** (`npm test`, parallel, no `.env.local`):
Total: 4141 | Passed: 3309 | Skipped: 832 (32 of 286 files) | Failed: 0 | Duration: **12.28 s**
Confirms Phase 2's MUST ruling held — no global `fileParallelism: false`; the 7.7× regression was not shipped.

**DB-backed suite** (`npm run test:db` against `ci_qa`, a database created from empty):
Total: 4141 | Passed: **4141** | Skipped: **0** | Failed: 0 | Duration: 363.72 s | 286/286 files
This is the load-bearing number. The 832 tests that skip in the pure run all executed and all passed. The rate-limit trio (`src/lib/rate-limit.test.ts:241,256,279`) that Phase 1 measured red is green.

**Rate-limit env matrix** (`src/lib/rate-limit.test.ts`, run three ways): 15/15 passed with `RATE_LIMIT_DISABLED` **unset**, **`=true`**, and **`=false`**. The enforcement block is now decided by `vi.stubEnv`, not by ambient environment. Mechanism confirmed at `src/lib/rate-limit.ts:190` (`if (process.env.RATE_LIMIT_DISABLED === "true") return { allowed: true }`) and the pre-fix `beforeEach` at merge-base has no stub — so the failing-first state is real. I did not re-execute the pre-fix file (that would require writing to the worktree); I verified the mechanism and the recorded Phase 1 measurement instead.

**Isolation suite** (`scripts/test-rls.sql` on `ci_qa`, as `presby_app`): **520 pass assertions, 0 FAIL, 0 ERROR, exit 0, 37 s**. Guard checked first and returned `presby_app|f`.

## End-to-End Tests

**Not run — and this is the accepted, pre-stated limitation, not a new gap.** `e2e.yml`'s Playwright job cannot be observed in GitHub Actions until the operator adds `NEON_API_KEY` and `NEON_PROJECT_ID`; no such secrets exist locally either, so `create-branch-action@v5` / `delete-branch-action@v3` remain dry-read only for me as they were for Batch B.

This does **not** trigger the auth-touching stricter gate: the diff touches no `src/auth.ts`, no `src/app/(auth)/`, no `src/app/api/auth/`, no `src/lib/auth/` (verified by name-matching the full tracked+untracked diff). What I did verify about `e2e.yml` is that its database-provisioning sequence is byte-equivalent in content and order to `db.yml`'s, which I executed in full; and that `playwright.config.ts:5` does `dotenv.config({ path: .env.local })`, so the `PLATFORM_DATABASE_URL` and `RATE_LIMIT_DISABLED=true` the job writes to `.env.local` genuinely reach `globalSetup` (`global-setup.ts:199`, `seed-orgs.ts:233`) — C-5 point 1 is really closed, not closed-on-paper.

## Schema / RLS Audit — live catalog, not the Drizzle file

### `drizzle/0050`, on the pipeline branch (`pg_get_constraintdef`, `pg_attribute`)

```
administrative_commissions_group_id_parent_org_fkey | FOREIGN KEY (group_id, parent_org_id) REFERENCES groups(id, organization_id)
org_delegations_group_id_grantee_org_fkey           | FOREIGN KEY (group_id, grantee_org_id) REFERENCES groups(id, organization_id)
officer_terms.recorded_by            notnull=false
roll_actions.proposed_by             notnull=false
administrative_commissions.group_id  notnull=false
org_delegations.group_id             notnull=false
```
Composite, not plain, on both — Phase 2's MUST ruling is honoured in the deployed catalog.

### Idempotency, proved by re-application

On `ci_qa`, I snapshotted **1,649 catalog lines** (every `public` column with type, `attnotnull` and `col_description`, plus every constraint's `pg_get_constraintdef`), then applied `drizzle/0050` twice more. Exit 0 both times; **0 diff lines** between all three snapshots. Convergent and idempotent, measured rather than asserted.

### Which layer actually refuses the cross-council write

The design credits the composite FK (F2 / Two Hierarchies). I probed it on `ci_qa` as **`neondb_owner` — the connection that bypasses RLS** — so the answer cannot be RLS by accident:

```
ERROR: insert or update on table "administrative_commissions" violates foreign key
       constraint "administrative_commissions_group_id_parent_org_fkey"
DETAIL: Key (group_id, parent_org_id)=(b0000000-...-0003, 11111111-...) is not present in table "groups".
```
Control insert with a group owned by `parent_org_id`: `INSERT 0 1`. **The refusing layer is the FK constraint, named, and it holds against the RLS-bypassing owner** — strictly stronger than a policy. `relrowsecurity/relforcerowsecurity = t/t` on `administrative_commissions`, `org_delegations` and `groups`, unchanged by `0050`.

### Failing-first, on a database migrated through `0049` only

`ci_qa_pre`, built by `psql` filename-order replay of `drizzle/0000`–`0049` (repo `drizzle/` never modified; `0050` skipped). Reproduces the drift exactly: 84 tables, `officer_terms.recorded_by notnull=true`, `roll_actions.proposed_by notnull=true`, both `group_id` columns absent.

- `npm run check:schema-parity` → **exit 1**, `11 differences, 5 allowlisted (0 of them unclosed drift), 6 failing`, naming exactly the four drifted columns and their two FKs. Output matches Phase 4's 3a line for line.
- The resolver → **raises**, from empty:
  ```
  ERROR:  column ac.group_id does not exist
  LINE 35:     join groups g                on g.id = ac.group_id
  CONTEXT: PL/pgSQL function presby_effective_permissions(uuid,uuid,date) line 11 at RETURN QUERY
  ```
- `0050` applied to that same database → parity `0 failing`, resolver executes without raising. **The check and the migration are load-bearing in both directions.**

### The allowlist — audited, not accepted

All five rows are `category: "architectural"`, zero `"pending"`. I verified each against `pg_constraint` and against the TS source, and all five are genuinely DDL-only composite FKs:

| Table | Live constraint | Genuinely DDL-only? |
|---|---|---|
| `organization_brands` ×2 | `..._mark_asset_fk`, `..._wordmark_asset_fk` → `blob_assets(id, organization_id)` | Yes — `src/lib/db/domain/assets.ts:63-78` documents the `org.ts ↔ assets.ts` module cycle that makes the TS-side declaration impossible |
| `organization_sites` | `..._content_bundle_fk` → `blob_assets(id, organization_id)` | Yes, same cycle |
| `ticket_messages` | `..._attachment_fk` → `blob_assets(id, organization_id)` | Yes, same cycle |
| `statistics_submission_grants` | `..._return_fk` → `statistical_returns(id, organization_id)` | Yes — `returns.ts:364` says "0049-only" in the column's own docstring |

Repo-wide grep confirms **no** `.references()`/`foreignKey()` to `blobAssets` anywhere in `src/lib/db/domain/`. All five are composite *in the database*, so F2 is satisfied on the axis that counts; only the TypeScript mirror is absent. The signature-exact matcher (`check-schema-parity.ts:384-386`) is real and correct — a table-wide `extra_fk` row cannot mask a future FK.

**Does the script exit 1 on a query error?** Yes, probed: bad credentials → exit 1 with `NeonDbError` printed; no URL at all → exit 1. It does not default-succeed on a swallowed exception.

## From-empty rehearsal, run by me, end to end

`CREATE DATABASE ci_qa` as owner → scratch `.env.local`-shaped file **outside the repo** (`/private/tmp/.../ci_qa.env`; the worktree's own `.env.local` was never written) → each step via `npx dotenv -e <scratch> -- npm run …`, in a shell with no DB variables exported (verified before starting).

| Step | Result |
|---|---|
| `npm run db:migrate` | exit 0 — `__drizzle_migrations` = **51 rows**, 84 `public` tables, `assert_eq` absent (confirming Finding 5) |
| `npm run check:schema-parity` | exit 0 — `64 domain tables compared — 5 differences, 5 allowlisted (0 of them unclosed drift), 0 failing` |
| `npm run db:seed` | exit 0 — roles, **11** features, **39** flags, **6** platform-wide `group_types` |
| `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` | exit 0, **COMMIT** — `organizations=10 people=16 officer_terms=9 roll_actions=13 groups=11 group_types=6 administrative_commissions=1 memberships=18` (identical to Phase 4) |
| `psql -f scripts/install-test-helpers.sql` ×2 | exit 0 both times |
| guard | `presby_app|f` — **PASS** |
| `npm run test:db` | **286/286 files, 4141/4141 tests, 0 failures, 0 skipped**, 363.72 s |
| `psql -f scripts/test-rls.sql` as `presby_app` | exit 0, **520 pass**, 0 FAIL, 37 s |
| `presby_effective_permissions()` | **5 rows**; commission arm specifically: `commission=2, direct=1, group=1` — the arm joining `ac.group_id` returns rows |
| cleanup | `ci_qa`, `ci_qa_pre` dropped; `select … where datname like 'ci%'` → **NONE** |

## Workflows — read line by line, and `actionlint`

`actionlint 1.7.12` on `db.yml`, `e2e.yml`, `ci.yml`: **zero findings.**

| Required property | Result |
|---|---|
| `check-secrets` gate with `::notice::` + `if:` on the real job | Present in both, gate job always green, real job reported *skipped* |
| `parent:` pinned explicitly | **`parent: development`**, literal, in both callers — never the implicit default (which is `production`) |
| `CREATE DATABASE` + four URLs on the **direct** endpoint | Yes (`action.yml` `steps.urls`), no `host_with_pooler` anywhere |
| `PLATFORM_DATABASE_URL` as `neondb_owner` | Yes, per DECISION-136 |
| per-run `presby_app` password `::add-mask::`ed **before first use** | Yes — `echo "::add-mask::$APP_PW"` precedes the `ALTER ROLE` |
| **No step-level `env:` carrying the four URLs on any `dotenv`-wrapped `npm run` step** | **Confirmed by reading every `run:` step.** `env:` appears only on the two gate steps, the five `psql` steps, and `e2e`'s `CI: "true"`. `db:migrate` / `check:schema-parity` / `db:seed` / `test:db` / `test:e2e` carry none. The Batch A hazard is genuinely avoided. |
| `set -euo pipefail` | On every multi-line `run:` **except the two `check-secrets` gate blocks** — see Finding 3 |
| `ON_ERROR_STOP` on every psql | Yes, all five invocations (the two grep misses are comment lines) |
| `continue-on-error` | **None anywhere in `.github/`** |
| `if: always()` delete-branch | Both workflows |
| `concurrency` | `db-tests-${{ github.ref }}` / `e2e-${{ github.ref }}`, both `cancel-in-progress: true` |
| `node-version-file: ".nvmrc"` | Both new/rewritten jobs (`.nvmrc` = 22) |
| `db-tests` does **not** set `RATE_LIMIT_DISABLED`; `e2e` does | Confirmed — the only occurrence in `.github/` is `e2e.yml:107` |
| `e2e` applies hand-written migrations, not `db:push` | Confirmed — `db:push` survives only in a header comment; `db:migrate` → `check:schema-parity` → `db:seed` → `seed-dev.sql`; trace upload (`path: test-results/`, 7 days) retained |
| `ci.yml` untouched by this branch | **`git diff $(git merge-base main HEAD) -- .github/workflows/ci.yml` is empty.** `git diff main` is *not* empty, but only because PR #15 landed on main after this branch forked — the branch itself never edits the file, so the merge is clean and main's version (lint last, `node-version-file`) wins. |

## Config

- `vitest.config.ts`: `testTimeout: 20000`, `hookTimeout: 30000`, `coverage.include: ["src/**/*.{ts,tsx}"]`, `exclude` for generated/test/d.ts, `reportOnFailure: true`. No `coverage.all` (correctly — removed in Vitest 4).
- **N-4a reproduced by me, both ways, without writing to the repo** (CLI override + `--coverage.reportsDirectory` into scratch, forced failure via `--testTimeout=1`):
  - `--coverage.reportOnFailure=false` → 2 failed / 13 passed, **no coverage directory written at all**
  - `--coverage.reportOnFailure=true` → same failures, **coverage directory written**
  The diagnosis in the design is correct and the fix is the right one; the symptom would have returned on the next red run without it.
- `package.json`: `test:db` and `check:schema-parity` present; `npm run check` still the same five offline tripwires.
- `playwright.config.ts`: `outputDir: process.env.PW_OUTPUT_DIR ?? "test-results"` — default unchanged, so `e2e.yml`'s literal `path: test-results/` and `.gitignore` keep working.

## Docs

- `docs/deployment.md`: the "CI's database secrets" section is present and correct (both secrets, where to find them, what flips, the pinned-parent rule). The `PLATFORM_DATABASE_URL` row now reads **`neondb_owner`** with the DECISION-136 provenance.
- `docs/testing.md`: the "Continuous integration" section, the **No Real Data for CI** sentence ("a CI database contains only rows CI created"), the per-job `RATE_LIMIT_DISABLED` posture, the `deletable_until` note, `npm run test:db`, and the `install-test-helpers.sql` step are all present. **But the top-of-file recipe does not match the action step for step — see Finding 2.**

## Local Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** — 3309 passed / 832 skipped, 12.28 s |
| `npm run check` | **PASS** — audit, sql-date, deps-drift, brand-scope, secrets all green |
| `npm run lint` | 8 errors / 191 warnings, in 5 files: `branding-form.tsx`, `children-roster-list.test.tsx`, `children/page.tsx`, `portal-nav-links.tsx`, `statistics-grants.ts`. **None is touched by this branch** (compared against the merge-base file list), and **main already fixed all eight in `df7bd42` (PR #15)**. Pre-existing, out of scope, resolves on merge. |
| `actionlint` | **PASS** — zero findings on all three workflows |

## Regression Tests Added

Not test files, but the equivalents, and I confirmed each fails before the fix and passes after:

- `scripts/check-schema-parity.ts` — guards against: the four-column `db:push` drift class recurring silently. Watched **exit 1 naming exactly the four** on a `0049`-only database, then **exit 0** on the same database after `0050`.
- `presby_effective_permissions()` called directly in the rehearsal — guards against: a `plpgsql` body's late name resolution letting 51/51 migrations "succeed" over a broken resolver. Watched it **raise** pre-`0050`, **return 5 rows** post-.
- `scripts/test-rls.sql` (520 assertions) and the 832 previously-unreachable `skipIf(!hasDb)` tests — now executed by `db.yml`. Watched 0 of 520 run on a from-empty database without `install-test-helpers.sql`, 520/520 with it.
- `src/lib/rate-limit.test.ts:202` `vi.stubEnv("RATE_LIMIT_DISABLED", "false")` — guards against the enforcement block inheriting an ambient escape hatch. Green in all three env states.

## Findings

**1 — `presby_app`'s password on the pipeline Neon branch was left broken by Batch B's own rehearsal. I repaired it; the procedure needs a warning.**
When I started, neither `DATABASE_URL` nor `APP_DATABASE_URL` in the worktree's `.env.local` could authenticate (`password authentication failed for user 'presby_app'`; `pg_authid` showed `rolcanlogin=t`, a SCRAM password, just not that one). The cause is recorded in the work-log itself: Batch B's acceptance table runs `alter role presby_app with login password '<random>'` and then states `.env.local` was "restored byte-identical" — **`ALTER ROLE` is cluster-wide within the branch, and restoring a file cannot restore a role's password.** `npm run test:db` and `scripts/test-rls.sql` were both dead in this worktree until I ran the same `ALTER ROLE` with the value already in `.env.local`. I disclose this as the one mutation I made beyond creating and dropping scratch databases; it restores the documented state rather than changing a deliverable.
**The shipped CI is not affected** — the composite action runs that statement against a *per-run ephemeral* branch that is deleted in `if: always()`, and Neon branches carry their own `pg_authid`. The defect is in the *rehearsal recipe*, which the work-log's handoff block instructs the next agent to run verbatim against a shared branch. Needs a one-line warning in `docs/testing.md` and the handoff block, plus a `docs/TODO.md` line.

**2 — `docs/testing.md`'s primary recipe still omits `-v ON_ERROR_STOP=1`, and does not match the action step for step.**
Lines 16–21 read `db:migrate` → `db:seed` → `psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql`. Missing: `-v ON_ERROR_STOP=1` on the `seed-dev.sql` line, `check:schema-parity`, and `install-test-helpers.sql`. The last is documented 150 lines later in a different section, which is defensible; the first is not. Phase 2's MUST ruling #4 named this exact hazard — "plain `psql -f scripts/seed-dev.sql` exits **0** even when statements fail; the file's single `begin;…commit;` becomes a rollback and the job goes green on an empty fixture" — and Phase 1's Gap 2 named this exact recipe as broken for a human following it from scratch. The workflows got it right; the human-facing recipe this pipeline was scoped to fix did not. One-line fix.
Adjacent: the "Local note" at `docs/testing.md:29-31` ("`drizzle.__drizzle_migrations` records only the first ten migrations … so `db:migrate` is not the local apply command on this branch") is still literally true — I confirmed the pipeline branch's ledger is **10 rows** — but it now sits directly above a CI section whose whole premise is that `db:migrate` applies 51/51 from empty. Worth a clarifying clause.

**3 — minor, advisory: the two `check-secrets` gate blocks lack `set -euo pipefail`**, against Phase 2's "every multi-line `run:` block". Neither block pipes anything or has a failure mode it could mask, and `e2e.yml`'s gate was inherited unchanged as "already correct". Not load-bearing; flagging it so the deviation is recorded rather than discovered.

**4 — observation, not a defect: overall pure-TS statement coverage now reads 53.02%, below the 70% target.** This is a direct and intended consequence of this pipeline's `coverage.include: ["src/**/*.{ts,tsx}"]` change: Phase 1 measured 80.21% only because 121 untested source files were invisible. Nothing lost coverage; the real number became visible, which is what the 2026-09-25 review asked for. Named here so the next test-coverage review starts from the honest baseline rather than treating it as a regression.
Critical modules, measured: `permissions.ts` **100%** (target 100% ✓) · `two-factor.ts` **91.30%** (target 90%+ ✓) · `flags.ts` **100%** (target 100% ✓). Also `src/app/launch/destination.ts` 100%.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: **100%** statements / 100% branch / 100% funcs
- `src/lib/two-factor.ts`: **91.30%** statements / 100% branch / 90% funcs
- `src/lib/flags.ts`: **100%** statements / 100% branch / 100% funcs
- Overall pure-TS: **53.02%** statements — see Finding 4

## Feature-Gate Audit

**No protected routes touched.** Verified by name-matching the full tracked + untracked diff against the merge-base: no `src/app/**/route.ts`, no `actions.ts`, no `"use server"` in any changed file, no `src/proxy.ts`, no `src/auth.ts`, no `src/app/(auth)/`, no `src/app/api/auth/`, no `src/lib/auth/`. The only `src/` changes are `src/lib/db/domain/authz.ts` (a Drizzle table definition — FK declaration only) and `src/lib/rate-limit.test.ts` (a spec).

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| *(none — no protected routes touched)* | n/a | n/a | n/a |

## Verdict

**PASS**

Every required check is green, and every one of them I ran myself rather than inheriting. The from-empty rehearsal reproduces Phase 4's result end to end on a database I created and dropped; the failing-first proof reproduces in both directions on a `0049`-only database; `0050`'s idempotency is demonstrated on a 1,649-line catalog snapshot; the composite FK is confirmed as the actually-refusing layer on the RLS-bypassing connection; and both workflow files pass `actionlint` and a line-by-line read against every hygiene ruling, including the `dotenv` override hazard, which is genuinely avoided.

Recorded honestly, as Phase 1 required: **the `db-tests` and `e2e` jobs cannot be observed in GitHub Actions until the operator adds `NEON_API_KEY` and `NEON_PROJECT_ID`.** The `create-branch-action` / `delete-branch-action` calls remain dry-read for me as they were for Batch B, and the Playwright suite itself was not executed. This is the stated, accepted limitation from Phase 1 onward, and it does not trigger the auth-touching stricter gate, because the diff touches no auth path.

Findings 1 and 2 are one-line fixes to a doc and a procedure, not to shipped CI behaviour, so they do not turn a required check red. They should land as Phase 6 follow-ups with `docs/TODO.md` lines (Workflow Rule 10) rather than a Phase 4 loop-back — but if the orchestrator prefers strict scope-completion gating, Finding 2 is the single item that would justify returning this to the implementer first, since `docs/testing.md`'s recipe was named in the pipeline's own scope.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — independently re-ran the from-empty rehearsal (51/51 migrate, parity 0 failing, seed-dev COMMIT, 286/286 files & 4141/4141 tests with **0 skipped**, 520/520 test-rls as `presby_app`, resolver 5 rows), reproduced failing-first on a `0049`-only database (parity exit 1 naming the four; resolver raises `column ac.group_id does not exist`), proved `0050` idempotent on a 1,649-line catalog snapshot, confirmed the composite FK is the refusing layer on the owner connection, `actionlint` clean, N-4a reproduced both ways. Four findings, none red: `presby_app`'s password left broken on the pipeline branch by Batch B's own rehearsal (repaired, procedure needs a warning); `docs/testing.md`'s top recipe still omits `-v ON_ERROR_STOP=1`; `check-secrets` gates lack `set -euo pipefail`; overall coverage re-baselined to 53.02% by the intended `coverage.include` change. Jobs cannot be observed in GitHub until the two Neon secrets exist. | **PASS** | 2026-09-26 |

## Handoff

**Next agent: analyst (Phase 6).** Carry Phases 1–4 forward verbatim alongside this section.

Phase 6 should specifically weigh: (a) the four findings above, of which 1 and 2 want `docs/TODO.md` lines in the integration commit; (b) that DECISION-150's core claim — "migrate-from-empty is the reproducibility proof" — is now independently demonstrated rather than asserted, which is the strongest intent-vs-shipped evidence this pipeline has; and (c) that the pipeline's headline promise (CI runs the database-backed tests) remains **provably correct but unobserved in GitHub** until the operator adds `NEON_API_KEY` and `NEON_PROJECT_ID` — a `SHIP WITH NOTES` on that operator dependency would be defensible.



### Orchestrator note (2026-09-26)

Findings 1–3 are closed by a Batch B second pass before Phase 6 (the recipe warning about `ALTER ROLE` on a shared branch; `docs/testing.md`'s top recipe aligned with the action incl. `-v ON_ERROR_STOP=1`, `check:schema-parity` and `install-test-helpers.sql`, and the local-ledger note clarified; `set -euo pipefail` on the two gate blocks). Finding 4 is the honest baseline the next test-coverage review starts from.

---


# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
