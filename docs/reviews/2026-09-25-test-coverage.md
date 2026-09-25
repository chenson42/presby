# Test Coverage Review — 2026-09-25

**Reviewer:** qa (read-only; recorded verbatim by the orchestrator)
**Slot:** release (14 d) · **Last run:** 2026-08-19 (baseline reset — this is presby's first real `test-coverage` run)
**Tree:** `main` @ `6d7b7c8`, plus the lifecycle/affiliation/returns pipeline's then-uncommitted final files (`drizzle/0043`–`0047`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/*`, `src/lib/presbytery.test.ts`), read as they were; those shipped as `933ec2e` (v0.25.2) while the review ran.
**Not run:** Playwright (a build/visual run was in flight elsewhere). E2E facts are taken from `docs/work-log/2026-09-25-e2e-red-on-main.md` Phase 1/Phase 5 and from reading `.github/workflows/e2e.yml` and `e2e/support/*`.

---

## What Was Measured

### 1. `npm test` (no env loaded) — the CI invocation

```
Test Files  246 passed | 29 skipped (275)
     Tests  3240 passed | 765 skipped (4005)     11.7 s     exit 0
```

**765 of 4005 tests (19.1%) do not execute.** 30 files carry `describe.skipIf(!hasDb)`; 29 skip wholly, `src/lib/tickets-labels.test.ts` skips 1 of 5. Skip census:

| Tests skipped | File |
|---|---|
| 82 | `src/lib/directory.test.ts` |
| 77 | `src/lib/sites.test.ts` |
| 43 | `src/lib/role-definitions.test.ts` · `src/lib/db/domain/lifecycle.test.ts` · `src/lib/db/domain/publication.test.ts` |
| 42 | `src/lib/groups.test.ts` |
| 36 | `src/lib/credentials.test.ts` |
| 34 | `src/lib/presbytery.test.ts` |
| 33 | `src/lib/officers.test.ts` · `src/lib/staff.test.ts` |
| 28 | `src/lib/events.test.ts` |
| 26 | `src/lib/person-sensitive.test.ts` |
| 25 | `src/lib/role-grants.test.ts` |
| 24 | `src/lib/children.test.ts` |
| 21 | `src/lib/tickets.test.ts` |
| 20 | `src/lib/roll.test.ts` · `src/app/api/sites/ingest/route.test.ts` |
| 19 | `src/lib/tenant-branding.test.ts` |
| 16 | `src/lib/org-feature-categories.test.ts` |
| 15 | `src/lib/people.test.ts` |
| 14 | `src/lib/org-features.test.ts` |
| 11 | `src/lib/db/domain/org-identifiers.test.ts` |
| 10 | `src/lib/people-update.test.ts` |
| 9 | `src/app/(org)/o/[slug]/admin/staff/actions.test.ts` |
| 7 | `src/lib/org-portal/find-person.test.ts` · `src/lib/storage/blob-store.test.ts` |
| 5 | `src/lib/brand/read-org-brand.test.ts` · `src/lib/org-portal/home-data.test.ts` |
| — | `src/lib/org-provisioning.test.ts`, `src/lib/tickets-labels.test.ts` (partial) |

### 2. DB-backed run — `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism`

Four full runs, 363–413 s each.

| Run | Files | Tests | Failures |
|---|---|---|---|
| 12:06 | 3 failed / 272 passed | 4 failed / 4001 passed | rate-limit ×3, `lifecycle.test.ts:983` timeout, `home-data.test.ts:141` hook timeout |
| 12:17 | 1 failed / 274 passed | 3 failed / 4002 passed | rate-limit ×3 |
| 12:24 | 1 failed / 274 passed | 3 failed / 4002 passed | rate-limit ×3 |
| 12:36 | 1 failed / 274 passed | 3 failed / 4002 passed | rate-limit ×3 · **exit 1** |

Deterministic (4/4 runs): `src/lib/rate-limit.test.ts:241`, `:256`, `:279` — the N-5 ambient-env failure, reproduced exactly.
Flakes (1/4 runs each): `src/lib/db/domain/lifecycle.test.ts:983`, `src/lib/org-portal/home-data.test.ts:141`. Re-run in isolation: **48/48 in 10.6 s**. Both are timeout-boundary, not logic.

### 3. `npx vitest run --coverage`

```
All files   81.51 % stmts · 78.07 % br · 69.59 % fn · 82.50 % lines   (5611/6883 statements)
```

| Target | Standing goal | Measured | |
|---|---|---|---|
| `src/lib/permissions.ts` | 100 % | **100 / 100 / 100** | ✅ |
| `src/lib/flags.ts` | 100 % | **100 / 100 / 100** | ✅ |
| `src/lib/two-factor.ts` | 90 %+ | **91.3 / 100 br / 90 fn** (uncovered `:35-39`) | ✅ |
| overall pure-TS | 70 %+ stmts | 81.51 % — **but see N-4** | ⚠️ |

Also at 100 %: `src/app/launch/destination.ts`, `src/lib/audit.ts`, `src/lib/db/errors.ts`, `src/lib/auth/sign-in-gate.ts`, `src/lib/brand/contract.ts`, `src/lib/brand/fonts.ts`, `src/lib/turnstile.ts`.

**The Track B reporter gap, explained.** It is *not* the missing `include`/`all`. Vitest 4.1.6's v8 **text reporter suppresses any file that is 100 % on all four metrics** — the 261-line table contains zero such rows. `permissions.ts` and `flags.ts` are absent because they are perfect. Confirmed by re-running with `--coverage.reporter=json-summary`, which reports both at 100/100/100. The `include`/`all` omission is a real but *different* defect (N-4).

### 4. `scripts/test-rls.sql` as `presby_app`

```
412 assertions, all pass, exit 0        # on a quiet database
```

Matches the stated 277 → 412 growth. **Two earlier runs of the same file aborted after 33 assertions** at `scripts/test-rls.sql:414-418` — see C-4.

### 5. Typecheck

`npm run typecheck` — **PASS**.

---

## Critical

### C-1 — The DB-backed layer and the RLS suite run nowhere in CI, and cannot be switched on today

Endorsing and quantifying `docs/reviews/2026-09-25-code.md` C-1. `.github/workflows/ci.yml:45-46` runs `npm test` with no `DATABASE_URL`; `ci.yml:34` sets one for the **build** step only. Result: **765 tests in 30 files** and **412 SQL assertions** are absent from every CI run. What never executes in CI includes every RLS-isolation proof, every freeze trigger, `withOrgContext()`'s check-before-`set_config` ordering, the permission resolver, and all three of this week's new owner-connection suites.

New, and the reason this stays critical rather than "already filed": **the punch item cannot be executed in its current order.** A `db-tests` job added today goes red immediately — the DB-backed run exits 1 on the rate-limit trio (N-1) in 4 of 4 runs — and flaky on top of it (2 timeout failures across 4 runs, C-1's own fix surface). Sequence is N-1 → N-3 → then the CI job, not the other way round.

### C-2 — `src/auth.ts` (339 lines) has no test file and does not appear in the coverage report at all

`src/auth.ts:238-335` is the `jwt` callback. It computes `token.features` — the `ADMIN_ROLE` → `FEATURE_KEYS` wildcard at `:322`, the role→feature join at `:325-331`, the empty-array fallback at `:333` — plus the deactivation bounce at `:288` and the `twoFactorVerified` merge at `:262-269`. There is no `src/auth.test.ts`, and because nothing ever imports the module under Vitest it is invisible in the coverage table rather than reported at 0 %.

`permissions.ts` is at 100 %. It is 100 % coverage of the *consumer* of an untested *producer*: `hasFeature(session.user.features, …)` is exhaustively tested, and the code that decides what `session.user.features` contains is tested nowhere. All 26 test files that touch auth do `vi.mock("@/auth")`. The only thing exercising this path end-to-end is the e2e suite — which has never run in CI (C-5).

This is the same failure shape the 2026-05-16 baseline flagged as punch item 4 and which has never been closed.

### C-3 — F1 (`FORCE ROW LEVEL SECURITY`) is verified by hand-enumeration for 21 tables; the live catalog has ~50

`scripts/test-rls.sql` asserts `relforcerowsecurity` at 13 sites (`:779, :879, :978, :1191, :1848, :2062, :2126, :2522, :2651, :2754, :3243, :3862, :3866`), naming 21 tables positively and 2 negatively. Live catalog probe as `neondb_owner`:

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='r'
   and exists (select 1 from pg_attribute a
                where a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped);
-- 49 rows FORCE-enabled, 1 deliberate exception (organization_identifiers), plus `people`
-- (org-scoped via memberships, no organization_id column)
```

**28+ tenant tables have no F1 assertion**, including `people`, `memberships`, `roll_actions`, `officer_terms`, `group_memberships`, `role_grants`, `org_units`, `households` — and every tier-3 table: `person_medical`, `person_notes`, `person_disabilities`, `person_demographics`, `background_checks`, `consents`.

This gap is specifically invisible to behavioural testing. FORCE governs the **table owner**; `presby_app` does not own these tables, so every `presby_app` behavioural assertion in the suite passes identically whether FORCE is set or not. That is F1's own stated failure mode ("RLS is silently inert while every naive test still passes") reproduced inside the suite written to prevent it. Today the catalog is clean — I probed it — but nothing catches the 51st table.

There is no catch-all query. `organization_identifiers` is a legitimate, well-argued exception (`drizzle/0043_presby_org_identifiers.sql:51-95`, D24/F47/DECISION-140 — identity data about a public org-tree entry, presby_app narrowed to SELECT, writes via `presby_set_organization_identifier()` and the `organization_identifiers_guard` trigger on every connection including the owner), so a catch-all needs an explicit allow-list, not a blanket assertion.

### C-4 — `presby_roll_cache_drift()` returns other organizations' membership rows to `presby_app`, and makes the RLS suite abort on any concurrent session

Probed live on the connection that matters (`$APP_DATABASE_URL`, `presby_app`):

```sql
select set_config('app.current_org_id','22222222-…-2222', false);   -- Alder Creek
select * from presby_roll_cache_drift();
--  organization_id                      | person_id                            | cached | actual
--  34362706-8c4d-4536-b8b0-fb276da28cbb | 88132090-…                           | active |
--  34362706-8c4d-4536-b8b0-fb276da28cbb | 395a9d23-…                           | active |
select 1 from organizations where id='34362706-…';   -- 0 rows: presby_app cannot see this org
```

The deployed definition (`drizzle/0012_presby_roll_read.sql:273-286`, confirmed against `pg_proc`):

```sql
CREATE OR REPLACE FUNCTION public.presby_roll_cache_drift()
 RETURNS TABLE(organization_id uuid, person_id uuid, cached text, actual text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  select m.organization_id, m.person_id, m.current_roll,
         presby_roll_as_of(m.person_id, m.organization_id)
    from memberships m
   where m.current_roll is distinct from presby_roll_as_of(m.person_id, m.organization_id);
$function$
```

**Which layer refuses, and which does not:** nothing refuses. It is `SECURITY DEFINER` with **no org predicate**, **no `SET search_path`**, and `aclexplode(proacl)` shows `EXECUTE` granted to **PUBLIC** *and* `presby_app`. `presby_app` is `NOBYPASSRLS` and `memberships` is `FORCE` — and both are irrelevant, because the function runs as its owner. A tenant connection can enumerate organization ids, person ids and roll status for every congregation in the database. The org ids it returns are ones the same connection provably cannot read from `organizations`.

Two consequences, both in scope for this review:

1. **Coverage gap.** `scripts/test-rls.sql` has no assertion that a `SECURITY DEFINER` helper granted to `presby_app` respects `presby_current_org()`. It tests the tables; it does not test the functions that read them with the tables' protections switched off. 28 of 35 DEFINER functions also lack `SET search_path` per the 2026-09-25 security review — same class.
2. **Suite fragility.** `scripts/test-rls.sql:414-418` asserts `count(*) from presby_roll_cache_drift() = 0`. Because the function is unfiltered, that is a **global** assertion over every organization in the database. Two of my four runs aborted there — `FAIL roll: cache agrees with replay — expected 0, got 2` — after 33 of 412 assertions, with `ON_ERROR_STOP=1` killing the remaining 379. The rows belonged to a concurrent pipeline's fixture organization that was created and cascade-deleted while my suite ran; the owner connection saw zero drift and zero orphans a minute later. This is R16-2's coupling hazard, sharper than described: the suite is coupled not to `seed-dev.sql`'s contents but to **every other session in the database**.

Hand-off: the leak itself is database-admin / security work, not a test change. The missing assertion class is the implementer's.

### C-5 — The CI e2e job would still fail if `NEON_API_KEY` were configured tomorrow

The work-log correctly establishes the job has never executed. Reading it as written, configuring the secrets is necessary but not sufficient:

1. **`e2e.yml:71-84` never writes `PLATFORM_DATABASE_URL`.** `e2e/support/global-setup.ts:223-226` falls back to `""`, hands that to `seedE2EOrgs()`, and `e2e/support/seed-orgs.ts:233` throws `"[seed-orgs] No platform database URL"`. globalSetup dies before a single spec runs. The new `e2e/support/assert-fixture-invariants.ts:44-50` has the same dependency and would fail the three `beforeAll` hooks at `admin-login.spec.ts:11`, `member-home.spec.ts:16`, `post-login-routing.spec.ts:30` for the same reason.
2. **`e2e.yml:86-89` runs `db:push` + `db:seed` only.** Per CLAUDE.md, Drizzle Kit emits none of `drizzle/00XX_presby_*.sql` — no RLS policies, no FORCE, no freeze triggers, no `SECURITY DEFINER` functions. The ephemeral branch would be a schema with the entire isolation model missing. Any spec that depends on a policy or trigger would pass *for the wrong reason*.
3. **`scripts/seed-dev.sql` is never applied**, yet `e2e/branded-signin.spec.ts` and `e2e/public-sites.spec.ts` reference `alder-creek`.

So: a green E2E check today means "the job was skipped"; a green E2E check after wiring the secrets would still not mean "the invariants hold", because the branch would not have them. Fix the job before advertising it as the gate.

---

## Notable

### N-1 — `rate-limit.test.ts` is red on every DB-backed run; it is the single blocker to a CI `db-tests` job

`src/lib/rate-limit.test.ts:241`, `:256`, `:279`. The escape-hatch block at `:62-76` calls `vi.stubEnv("RATE_LIMIT_DISABLED", "true")`; the enforcement block at `:194-200` stubs nothing, so it inherits `.env.local`'s `RATE_LIMIT_DISABLED=true` and the limiter no-ops. Reproduced in 4 of 4 runs. Fix is two lines: `vi.stubEnv("RATE_LIMIT_DISABLED", "false")` in that block's `beforeEach`, `vi.unstubAllEnvs()` in its `afterEach`. Root-caused 2026-08-20 (`docs/TODO.md`); four Phase 5 records now end "3 failed — pre-existing", which is how a red suite becomes background noise.

### N-2 — Two specs re-implement their subject and test the copy

- **`src/lib/totp-pending.test.ts`** — 8 tests, all green, in every CI run. It defines `shouldReuseRow()` at `:32-34` as a "pure replica of the predicate inside `getOrCreatePendingEnrollment`" and never imports `src/lib/totp-pending.ts` (77 lines), which is correspondingly **absent from the coverage report**. Change `>` to `>=` in the real module and all 8 stay green. The H2 block at `:107-127` asserts the same expression twice, and its own comment says the property is "structurally guaranteed" — i.e. it asserts nothing at all.
- **`src/app/(admin)/admin/users/[id]/actions.test.ts`** — same shape, and the header at `:26-29` says so explicitly: *"Both are extracted as inline pure functions that mirror the action's guard logic exactly. If the implementation diverges from these predicates, the test will surface the gap."* It will not. The subject is absent from the coverage report.

Both predate presby (starter-inherited). I scanned all 275 specs; these are the only two where the subject exists, the spec runs unconditionally, and the subject is never loaded. `fonts.test.ts`, `turnstile.test.ts` and `sites-ingest-auth.test.ts` flagged on the same heuristic but resolve clean (dynamic import; 100 %, 100 %, 95.5 %).

Related but distinct: **26 spec files `vi.mock("@/lib/db")`.** Most are legitimate. The sharpest residue is `src/app/(admin)/admin/tickets/actions.ts` — 90.09 % covered, five mutations via `tx.` at `:152, :204, :239, :274, :309`, verified against a mock that echoes the implementation's column names, with **no DB-backed twin** and (per code review C-2) invisible to `check:audit`. That is the sagacraft `dfe7add` shape exactly. `src/app/(admin)/admin/users/actions.ts` (186 lines, the role-assignment and deactivation mutations that write `audit_events`) sits at **22.72 %**.

### N-3 — No `testTimeout`/`hookTimeout` configured against a remote Neon database

`vitest.config.ts` sets `environment`, `include` and `coverage` only, so the defaults apply: 5000 ms / 10000 ms. In the 12:06 run, `src/lib/db/domain/lifecycle.test.ts:983` timed out at 5000 ms while its siblings in the same describe took 4113 ms and 3742 ms — it is sitting on the boundary, not over it. `src/lib/org-portal/home-data.test.ts:141`'s `afterAll` timed out at 10000 ms. Both pass in isolation. With every DB-backed suite talking to a shared, network-latency-bound branch, these will recur and will read as logic failures. `testTimeout: 20000, hookTimeout: 30000` with a header comment.

### N-4 — Coverage cannot be measured on the run that matters, and 121 source files are invisible on the run that can

Two separate defects with one effect.

**(a) The DB-backed run produces no coverage at all.** `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism --coverage` completed three times, exit 1 with the expected 3 failures, and emitted **no text table, no `coverage/` directory, and no JSON** — it deletes the pre-existing report directory at start and never writes a replacement. Reproduced with `--coverage.reporter=json-summary` alone. It works fine on single files (`permissions.test.ts` with dotenv ✅, with `--no-file-parallelism` ✅, `org-identifiers.test.ts` with dotenv ✅), so it is the full-suite combination. Practical consequence: **every coverage number ever recorded in a presby Phase 5 report — including the ones in this review's own table — is measured on the run that excludes 765 tests and 30 modules.** Nobody has ever seen a coverage figure for the church domain.

**(b) `vitest.config.ts` coverage has no `include`/`all`.** 436 non-test source files exist; 322 appear in the report; **121 never appear**. Not at 0 % — absent. The list is led by `src/auth.ts` (339 lines, C-2), `src/lib/dev-docs.ts` (412), `src/lib/tickets-notifications.ts` (291), `src/lib/db/index.ts` (75), `src/lib/totp-pending.ts` (77, N-2), `src/lib/email/send.ts` (69), `src/lib/storage/sniff.ts` (63), `src/lib/nav-data.ts` (47), `src/lib/auth/sign-out-action.ts` (38), and the 16 DB-gated domain modules whose specs skip. The 81.51 % headline is therefore an average over the files that happened to load, and it moves in the *wrong direction* when someone adds an untested module.

### N-5 — The e2e suite has essentially zero coverage of the church domain

21 spec files, 121 `test()` calls (120 excluding the `visual` project). Grepping every `/o/…` path any spec navigates to yields exactly three: `/o/e2e-alpha` (the landing stub), `/o/alder-creek/tickets`, and `/o/no-such-congregation`. Nothing touches roll, directory, officers, groups, staff, credentials, org-admin roles, org-admin features, or org branding — the surfaces the last six months of pipelines built. Those modules are covered by DB-backed unit suites, which run nowhere in CI (C-1). So the church domain has **no coverage in CI by either mechanism.**

Combined with the last verified run being **38/40 across 7 of 21 spec files** (work-log Phase 5, isolated clone), the honest statement is: 80 of 120 e2e tests have no recorded result this cycle.

### N-6 — Three of the five tripwires have no fixture tests, and the untested ones are where the bugs are

`scripts/check-brand-scope.test.mjs` (423 lines) and `scripts/check-secrets-pii.test.mjs` (283) exist. `check-audit-coverage.mjs`, `check-sql-date.mjs` and `check-deps-drift.mjs` have none. The one code review C-2 proved is scanning 4 of 23 mutation-bearing files is precisely the one with no fixtures. The correlation is not a coincidence and the fix is the precedent that already exists in the repo.

### N-7 — 23 test files hand-roll the same disable-trigger teardown

Confirming code review N-9 by count: **41 `alter table … disable trigger` statements across 23 files and 6 triggers** — `group_memberships_reject_derived` ×31, `memberships_guard_end` ×5, `roll_actions_freeze` ×2, `statistical_returns_freeze`, `publications_freeze`, `congregation_statistics_freeze` ×1 each. Worst offenders `src/lib/groups.test.ts` (7), `src/lib/sites.test.ts` (4), `src/lib/presbytery.test.ts` (4). Two regressions already recorded in `docs/TODO.md`. `src/lib/db/fixture-deletable.ts` solved the insert half well; the teardown half is still copy-paste. This is also R16-4's largest Rule-16 collision surface.

### N-8 — `--no-file-parallelism` is load-bearing and lives only in prose

`package.json:24` is `"test": "vitest run"`. `vitest.config.ts` sets no `fileParallelism`. The requirement appears once in `docs/testing.md:157` and 14 times across work-logs. Anyone who runs `npm test` with `.env.local` loaded — the obvious thing to try — gets teardown races. Put `fileParallelism: false` in `vitest.config.ts` with a header comment explaining why; it costs the pure suite nothing measurable (11.7 s parallel; the serial run's 365 s is DB round-trips, not scheduling).

### N-9 — `test-rls.sql` prints "suite complete" 4,460 lines before it is complete

`scripts/test-rls.sql:403-406` emits the `RLS suite complete. Every assertion above must say "pass"` banner, then continues for another 4,460 lines and ~380 assertions. A reader scanning output — or an agent grepping for the banner as a success signal — will conclude the suite passed when a third of it may not have run. Move the banner to the end, or have it print the assertion count so a truncated run is self-evident.

---

## Minor

- **`src/lib/two-factor.ts:35-39`** — the only gap between 91.3 % and 100 % is the `catch` branch of `isTotpConfigured()`, i.e. the misconfigured-key path the function's own docblock (`:28-33`) says it was written for. One test with `vi.stubEnv("AUTH_TOTP_ENCRYPTION_KEY", "")` closes it.
- **`src/lib/tickets-labels.test.ts`** carries 1 permanently-skipped test with no DB gate. A skipped spec is not a passing spec; either delete it or explain it inline.
- **`playwright.config.ts`** sets no `outputDir`, so every concurrent run in the tree writes to the same `test-results/`. With `webServer.url` defaulting to `:3000` and one `.next/dev/lock`, the two contention hazards QA has reported repeatedly this week are both config-level and both fixable (`outputDir: process.env.PW_OUT ?? "test-results"`).
- **`organization_identifiers` is empty (0 rows) on the dev branch.** `drizzle/0043`'s second change — moving `organization_settings.pcusa_pin` into it — therefore moved nothing, and the data-move path has never executed against real rows. Its 11 tests build their own fixtures. Worth one assertion in the migration's own suite that the move is idempotent on a non-empty table.
- **`scripts/pre-push-gate.test.mjs:111`** shells `cd /nonexistent/path/for/this/test && git push`, printing `fatal: cannot change to …` to the suite's stderr on every run. Harmless, but it is noise in exactly the output an agent scans for real failures. Redirect it.
- **`package.json` moved 0.25.1 → 0.25.2 mid-review**, along with `src/app/globals.css` and two release-notes files (the `2026-09-25-platform-radius` pipeline). The measurements span a moving tree — see Observations.

---

## Observations

1. **This week's three new domain suites are the best test work in the repo and should be the template.** `src/lib/db/domain/lifecycle.test.ts:1-33` states, before any code, exactly why an owner-connection suite must exist *alongside* `test-rls.sql`: `BYPASSRLS` exempts a role from policies but never from triggers, so `presby_freeze_lifecycle_event()`'s rejection is only demonstrable on the owner connection; and the `parent_id`-cache-vs-`presby_org_affiliated()` agreement has a global form that `presby_app` structurally cannot count. Every assertion runs in a rolled-back transaction. 43 + 43 + 11 tests, all green, all real. That is the "which invariants are tested on only one connection" question being answered *by the implementer, in advance*, and it is the discipline C-3 and C-4 are missing everywhere else.

2. **`scripts/test-rls.sql` grew 277 → 412 assertions (+49 %)** in one pipeline, on a file that was already the single densest verification artifact in the repo. Confirmed by a clean run.

3. **57 test names carry `— regression for …`.** Regression discipline is real and visible; I did not find a case of a regression test landing without one.

4. **`src/app/launch/destination.test.ts:201-271`** pins CLAUDE.md's Post-Login Landing table row-for-row, and the prior pipeline proved it load-bearing by mutating `destination.ts:123` and `:136`. I verified CLAUDE.md on disk is that table, with row 5 → `/home`. (The copy of CLAUDE.md injected into my own session context said `/orgs` — a stale snapshot, not a repo defect, but it is a live demonstration that a doc-pinned test is only as good as which copy of the doc you are holding. Consider asserting against a constant the doc *includes*, rather than a transcription of it.)

5. **`presby_app` cannot see `organization_identifiers` rows for other orgs today only because the table is empty.** The design deliberately grants it unfiltered `SELECT` (`drizzle/0043:93-95`), which is correct per D24 — but the live probe returning `0|0` proves nothing about the design, and a future reader may mistake it for evidence. Worth an explicit positive assertion: seed two orgs' identifiers and assert `presby_app` sees both, so the intentional non-isolation is *tested as intentional* rather than accidentally unobservable.

6. **The local runner is Node v20.20.2** against `engines: ">=22.0.0"` and `.nvmrc: 22`. Code review N-8 flagged the three CI workflows; the developer machine is off-version too.

7. **Vitest exits 1 correctly on failure** (verified). Nothing in the runner configuration is hiding red — the red is hidden by not running the suite.

8. **`npm test` at 11.7 s is excellent.** The 365 s serial DB run is the one people will avoid. Once it is in CI on an ephemeral branch that cost stops being a human's problem, which is a second argument for C-1 beyond correctness.

---

## Punch-List

Ordered by dependency, not by severity.

| # | Item | Owner | Blocks |
|---|---|---|---|
| 1 | `vi.stubEnv("RATE_LIMIT_DISABLED","false")` / `vi.unstubAllEnvs()` around `src/lib/rate-limit.test.ts:194-200` | api-developer | #4 |
| 2 | `testTimeout: 20000`, `hookTimeout: 30000` in `vitest.config.ts`, with a comment naming the remote-DB reason | api-developer | #4 |
| 3 | `fileParallelism: false` in `vitest.config.ts` (not in `package.json`), comment referencing `docs/testing.md:157` | api-developer | #4 |
| 4 | **CI `db-tests` job** on an ephemeral Neon branch, modelled on `e2e.yml:62-69`: create branch → apply `drizzle/00XX_presby_*.sql` (**not** `db:push` alone) → `db:seed` → `psql -f scripts/seed-dev.sql` → `vitest run` → `psql -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` → delete branch | deployment-engineer | — |
| 5 | Fix `e2e.yml:71-84`: add `PLATFORM_DATABASE_URL`, apply the hand-written migrations, apply `seed-dev.sql`. Then `NEON_API_KEY` / `NEON_PROJECT_ID` (operator) | deployment-engineer + operator | — |
| 6 | `coverage: { all: true, include: ["src/**/*.{ts,tsx}"], exclude: [...] }` in `vitest.config.ts`; and diagnose why the full DB-backed run emits no report (N-4a) | api-developer | honest numbers |
| 7 | `src/auth.test.ts` — jwt callback: `ADMIN_ROLE` → all keys; role→feature join; unknown role → `[]`; `isActive=false` → empty token; `twoFactorVerified` merge on `trigger === "update"` | api-developer | C-2 |
| 8 | Catch-all F1 assertion in `test-rls.sql` over `pg_class` with an explicit allow-list (`organization_identifiers`, `sasr_form_versions`), replacing the 13 hand-written sites | database-admin | C-3 |
| 9 | Scope `presby_roll_cache_drift()` to `presby_current_org()` (or revoke from `presby_app`/PUBLIC and move the caller to the platform connection); add `SET search_path`. Then make `test-rls.sql:414-418` baseline-relative | database-admin | C-4 |
| 10 | Make `test-rls.sql`'s 181 absolute fixture counts baseline-relative (compute in section 0, assert deltas) — R16-2 | database-admin | parallel pipelines |
| 11 | `src/lib/db/test-support/teardown.ts` exporting `deleteFixtureOrg()` + `createFixtureOrg()` over one `FREEZE_TRIGGERS` array; retire the 41 hand-rolled statements in 23 files | api-developer | N-7, R16-4 |
| 12 | Delete `src/lib/totp-pending.test.ts`'s replica and test the real `getOrCreatePendingEnrollment`; same for `src/app/(admin)/admin/users/[id]/actions.test.ts` | api-developer | N-2 |
| 13 | `scripts/check-audit-coverage.test.mjs`, `check-sql-date.test.mjs`, `check-deps-drift.test.mjs` fixtures | api-developer | N-6 |
| 14 | E2E specs for the org portal: roll read, directory privacy tiers, officer terms, group derivation, a `role_grants` gate. Start with one per surface | ux-developer | N-5 |
| 15 | `two-factor.ts:35-39` — one test stubbing an empty `AUTH_TOTP_ENCRYPTION_KEY` → 100 % | api-developer | target |
| 16 | Move `test-rls.sql`'s completion banner to the end and have it print the assertion count | database-admin | N-9 |
| 17 | `outputDir` in `playwright.config.ts` keyed off an env var | ux-developer | contention |

---

## Verdict

**FAIL against the review's own standard**, with the three standing module targets **met**.

The targets pass: `permissions.ts` 100 %, `flags.ts` 100 %, `two-factor.ts` 91.3 %. That is genuine progress from the 2026-05-16 baseline and the coverage bar has been cleared for three cycles.

The bar is no longer measuring the right thing. Four findings say so independently and all point the same way: **the tests that encode presby's actual invariants do not run where anyone is watching.** 765 tests and 412 SQL assertions are absent from CI (C-1); the module that produces every permission claim has no test and no coverage row (C-2); the single invariant the whole isolation model rests on is verified for 21 of ~50 tables by hand-enumeration, in a way that behavioural tests structurally cannot backstop (C-3); a `SECURITY DEFINER` helper granted to PUBLIC returns cross-tenant membership rows to the tenant connection and nothing in the suite was shaped to notice (C-4); and the e2e job that the 2026-07-11 retrospective named the sole defence for the dominant bug class would still fail on its first real execution (C-5).

Coverage is 81.51 % on 322 of 436 files, unmeasurable on the suite that matters, and the number moves the wrong way when untested code is added.

None of this is a regression — it is the first honest measurement. The work is well-tested by unusually careful people; it is under-*verified* by the machine. Items 1–5 change that in roughly a day and are the whole of the recommendation.

---

## Handoff

By item: **api-developer** (1, 2, 3, 6, 7, 11, 12, 13, 15) · **database-admin** (8, 9, 10, 16) · **deployment-engineer** (4, 5) · **ux-developer** (14, 17) · **operator** (the `NEON_API_KEY` / `NEON_PROJECT_ID` half of 5).

Item 9 (`presby_roll_cache_drift()`) should be routed to the in-flight schema/security round rather than opened cold — it is a live cross-tenant read, adjacent to the `app_role_permissions` finding in `docs/reviews/2026-09-25-security.md`, and it wants the same pipeline's live-catalog verification step.
