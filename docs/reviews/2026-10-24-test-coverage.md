# Test Coverage Review — 2026-10-24

**Reviewer:** qa (read-only; recorded verbatim by the orchestrator)
**Slot:** release (14 d) · **Last run:** 2026-09-25 (29 days — overdue)
**Tree:** `main` @ `5f333eb` (v0.42.2), clean working tree throughout.
**Window:** PRs #13–#49, releases 0.25.2 → 0.42.2 (giving, custom domains,
invitations, designation revoke, Community Increments 1–2, person emails, zod 4).

**Scope run here, and what was not re-run.**
- Run locally: the unit suite with coverage and no DB env, plus `typecheck`, `lint`
  and `npm run check`.
- One read-only `SELECT` of `feature_flags` on the shared development DB, inside a
  `begin read only` transaction.
- One scratch-only Vitest probe, outside the repo, driving the real NextAuth handlers
  with the DB mocked.
- Not run locally: the DB-backed suites, `test-rls.sql` and e2e. Running them against
  the shared development DB was out of bounds for this review. For those, the evidence
  is CI history: 20 `db.yml` runs and 21 `e2e.yml` runs since PR #41 turned CI green
  on 2026-10-23. Pass counts were read from the logs of six green e2e runs (12 jobs).

---

## What Was Measured

| Check | Result |
|---|---|
| `vitest run --coverage` (no DB env) | 542 files passed, 77 skipped · **8,322 tests passed, 2,442 skipped** (10,764) · 31 s · exit 0 |
| Coverage, all files | 63.09 % statements (14,602 / 23,142) over **796 files** |
| Coverage, pure-TS `src/lib` (excluding the 35 modules that only DB-backed specs reach) | **76.36 %** |
| `npm run typecheck` | PASS |
| `npm run lint` (`--max-warnings=0`) | PASS |
| `npm run check` (all eight tripwires) | PASS |
| CI `db.yml` since 2026-10-23 17:30 | 18 green, **2 red on `main`** (flakes, N-2), 1 cancelled |
| CI `e2e.yml` since then | Green apart from cancellations and 1 red (person-emails flag drift, fixed in `f4b9de4`). Sampled green runs: dev lane 514–515 passed, prod lane 76 passed, **0 flaky, 0 skipped** |

**Why the headline dropped from 81.51 % to 63.09 %.** Coverage now counts every
source file, not just the ones a test loads (prior N-4b is closed). The 2,442 skipped
tests are DB-gated. They run in the CI shards, but **the shards don't collect
coverage** (N-4).

| Standing target | Goal | Measured | |
|---|---|---|---|
| `src/lib/permissions.ts` | 100 % | 100 / 100 / 100 | met |
| `src/lib/flags.ts` | 100 % | 100 / 100 / 100 | met |
| `src/lib/two-factor.ts` | 90 %+ | 91.3 / 100 / 90 (`:35-39` still uncovered) | met |
| Pure-TS overall | 70 %+ | 76.36 % | met |

Other critical modules:
- `src/lib/authz.ts` 84.1 %
- `src/proxy.ts` 94 %
- `src/app/launch/destination.ts` 100 %
- `src/lib/audit.ts` 100 %
- `src/lib/contact-methods/*`: the pure parts are at 98–100 %. `store.ts`, `reader.ts` and
  `sql.ts` are 0 % here, but `store.db.test.ts`, `readers.db.test.ts` and `matrix.db.test.ts`
  plus `test-rls-64.sql` cover them in CI.
- Giving: the pure parts are at 86–100 %, and 14 `*.db.test.ts` suites plus
  `test-rls-46*.sql` cover the 0 % DB modules. The `check:giving-boundaries` tripwire has
  its own test file.
- The roll decide path has three layers:
  - `roll.test.ts` (97 tests, DB-backed; `selfApproved`/`selfTarget` at `:840`)
  - `test-rls-62.sql`
  - a source-scan proof in `decide-boundaries.test.ts`

  This is the best-covered path in the window.
- **`src/auth.ts` is 0 % (82 statements)**. See C-1.

---

## Critical

### C-1 — A password-only session can set its own `twoFactorVerified` (TOTP bypass), and nothing tests it

**What happens.** `src/auth.ts:261-264`, inside the `jwt` callback:

    if (trigger === "update" && session?.user) {
      if (typeof session.user.twoFactorVerified === "boolean") {
        token.twoFactorVerified = session.user.twoFactorVerified;
      }

The server action calls `unstable_update()` (`src/app/(auth)/totp/actions.ts:85`,
`:129`), and that is not the only way into this branch. In `@auth/core` 0.41.3,
`POST /api/auth/session` goes to `actions.session(…, isUpdate=true,
request.body?.data)`, which calls `callbacks.jwt({ trigger: "update", session:
<request body> })`. See `node_modules/@auth/core/lib/index.js:57-59` and
`lib/actions/session.js:28-31`.

The only check is CSRF. That check compares two copies of a token the signed-in
browser already holds (`GET /api/auth/csrf`), so it stops other sites, not the
person whose session it is.

**What is safe.** Roles and features in the same payload are overwritten. Line `:306`
forces `needsRoleRefresh` on `trigger === "update"`, and `:308-334` reload both from
the DB. `twoFactorVerified` is never reloaded.

**What relies on that one claim.** Every 2FA check reads only the JWT claim:
- the proxy gate on `/admin` and `/o/*` (`src/proxy.ts:144-154`)
- `src/app/(admin)/admin/layout.tsx:13`
- the invitation accept check (`src/app/(invite)/actions.ts:225`)
- the giving gate (`src/lib/giving/access-pure.ts:55`)

**Probe.** A scratch Vitest file, outside the repo:
- It loads the real `src/auth.ts` and drives the real `handlers.GET` (`/api/auth/csrf`)
  and `handlers.POST` (`/api/auth/session`).
- The DB is mocked to "active user, 2FA required".
- It starts from a JWT as it exists right after password sign-in
  (`twoFactorVerified: false`).

Results:

    POST {csrfToken, data:{user:{twoFactorVerified:true, roles:["admin"], features:["admin.dashboard"]}}}
    → 200; reissued token {"twoFactorVerified":true,"roles":["member"],"features":[]}
    control (same POST, no csrfToken) → 400, no cookie reissued

The forged admin role and feature were dropped, as described above. The 2FA claim was
accepted.

**Who is exposed.** Anyone who has an account's password, or its Google sign-in, can
skip that account's TOTP for `/admin` and every tenant page. That is exactly the case
2FA exists for.

**How long.** The code arrived with the starter import (`54f3935`, 2026-08-17), so the
starter and its forks very likely carry it too.

**Why tests never caught it:**
- This is the 2026-09-25 review's C-2 still open: no `src/auth.test.ts`, and all 70 spec
  files that touch auth use `vi.mock("@/auth")`.
- The e2e TOTP specs check that the real flow works, not that a forged session update
  fails.
- The 2026-05-16 baseline asked for a test that "`twoFactorVerified` merges correctly on
  `trigger === "update"`". Written as worded, that test would have locked the bug in.

**Fix direction (tech-lead's decision).** Stop reading `twoFactorVerified` from the
update payload. Derive it from something only the server can produce. Examples:
- a verification record the TOTP action writes, which the callback reads back
- a short-lived proof signed with `AUTH_SECRET`

Server-side `unstable_update` and a client POST go through the same callback, so the
callback can't tell them apart by `trigger`.

**Recommended tests** (the implementer writes them; each must fail before the fix):
1. `src/auth.test.ts`, driving `handlers` as the probe does:
   - `should not set twoFactorVerified when a client posts a session update — regression for client-settable 2FA claim`
   - `should set twoFactorVerified only after a server-verified TOTP code`
   - and the rest of the old punch item 7: `ADMIN_ROLE` gets every key; role→feature
     join; no roles → `[]`; inactive user → `{}`; roles and features in an update
     payload are replaced from the DB.
2. `e2e/totp-session-update-bypass.spec.ts`:
   - MFA-enrolled fixture user signs in with password only
   - `GET /api/auth/csrf`
   - `POST /api/auth/session` with `{csrfToken, data:{user:{twoFactorVerified:true}}}`
   - assert `/admin` and `/o/e2e-alpha` still redirect to `/totp`

   This is auth-touching, so it falls under the stricter Phase 5 gate.

TODO: `- [ ] **SECURITY: a password-only session can set its own twoFactorVerified via POST /api/auth/session (src/auth.ts:261-264).** Bug-fix pipeline now; failing-first unit + e2e regression; notify the starter and sibling forks via downstream-sync. — docs/reviews/2026-10-24-test-coverage.md C-1`

### C-2 — The Rule 7 platform-admin mutations have no test that runs the real code

CLAUDE.md Rule 7 lists role changes, flag toggles, TOTP reset and deactivations as
mutations that must write an audit row. All of them write to the DB directly from
their action file, and none is run against a real DB or in a browser:

| File | Mutations | Coverage | Test |
|---|---|---|---|
| `src/app/(admin)/admin/users/actions.ts:30-186` | assign/remove role, deactivate, reactivate, unlock | 22.72 % | `actions.test.ts`, 3 tests, mocked DB |
| `src/app/(admin)/admin/users/[id]/actions.ts:26,79` | `setTwoFactorRequired`, `forceResetTwoFactor` | **0 %** | copy-the-logic spec (N-3) |
| `src/app/(admin)/admin/flags/actions.ts:11` | `toggleFlagAction` | **0 %** | none |
| `src/app/(password-reset)/actions.ts:134-207` | `consumeResetToken` (atomic claim, password write, audit) | **0 %** | copy-the-logic spec (N-3); `e2e/forgot-password.spec.ts` covers the request side only |
| `src/app/(account)/account/actions.ts:24-284` | email change, password change, deletion request | **0 %** | copy-the-logic spec (N-3) |

`grep` over `e2e/` finds no deactivate, unlock, role-assign, TOTP-reset or flag-toggle
flow. The only hit is a filter smoke test at `admin-audit.spec.ts:86`. Two flows in
qa.md's "high-value e2e" list are absent:
- a flag toggle gating behaviour on the next request
- a security-sensitive mutation writing an audit row (designation revoke is the only one
  covered)

What is covered: `totp/actions.ts` is 0 % in units, but the real verify and
recovery-code paths run in e2e (`totp-full-login`, `totp-recovery-code`,
`totp-code-entry`).

**Recommended tests.** One DB-backed suite per row, on the
`src/lib/onboarding/designation-holders.db.test.ts` pattern: real DB, real column
contract, the audit row checked by `action`. Plus two e2e specs:
- an admin deactivates a fixture user, that user's next request is bounced, and one
  `user.deactivated` audit row exists
- toggling a flag at `/admin/flags` changes a gated page on the next request

TODO: `- [ ] **Real-DB tests for the platform-admin audited mutations** (users/actions.ts, users/[id]/actions.ts, flags/actions.ts, password-reset consume, account actions) + e2e for deactivate→bounce and flag-toggle→next-request. — docs/reviews/2026-10-24-test-coverage.md C-2`

---

## Notable

### N-1 — CI's flags differ from dev's, so two specs pass vacuously in CI

- **Shared development DB** (read-only SELECT): 33 of 39 flags are on.
- **CI's fresh DB:** the seed defaults (7 on, `scripts/seed.ts`) plus 3 set by
  `scripts/ci/e2e-baseline-flags.sql`, so 10 on.
- **Difference:** about 23 flags are on in dev and off in CI, including `org_portal.roles`,
  `.features`, `.directory(_v2)`, `.officers`, `.staff`, `.admin_hub`,
  `.chrome_v2/_v3`, `.members_create` and `ui.branded_signin`.

The person-emails `:270` failure was this class, surfacing as a failure. Here it is
surfacing as false passes:

- **`e2e/invitation-new-account.spec.ts:218-220`.** It expects `<h1>Roles</h1>` and no
  "don't have permission" text. With `org_portal.roles` off,
  `src/app/(org)/o/[slug]/admin/roles/page.tsx:84-86` renders `RolesFlagOff`
  (`roles-states.tsx:23-32`), which is exactly that heading and no such text. In CI the
  test passes without proving the invited administrator can manage roles.
- **`e2e/custom-domains/domains-platform.spec.ts:86-93`.** Its own comment at `:90` calls
  it "a positive control: the page rendered its list". With `org_portal.features` off,
  `features/page.tsx:91-93` renders `FeaturesFlagOff` (`<h1>Features</h1>`), and the
  checks at `:91-92` that "Website domain" is absent pass trivially. Compare
  `e2e/giving-admin.spec.ts:75,108`, which captures and sets this same flag correctly.
- **Every `/o/*` spec renders a different portal shell in CI.** `chrome_v2`/`chrome_v3`
  pick the `(org)` layout (`src/app/(org)/o/[slug]/layout.tsx:108-109`). Both are seeded
  off and not in the CI baseline, while `e2e/header-controls.spec.ts:170` states
  "org_portal.chrome_v2 is fully rolled out". So CI checks a shell that dev doesn't use,
  and that the codebase itself describes as fully replaced.

**Recommended:**
1. Each spec captures and sets every flag whose page it asserts on
   (`e2e/support/flags.ts`), as `person-emails.spec.ts:80-81` now does. Positive controls
   must check something only the flag-on page renders.
2. Decide which flag set CI runs against: production's, or a stated rollout manifest.
   Then add a unit test that fails when `e2e-baseline-flags.sql` drifts from it.
3. Optionally, a tripwire over `e2e/` that maps each gated route to its flag.

TODO: `- [ ] **e2e flag drift: invitation-new-account.spec.ts:218 and domains-platform.spec.ts:86 pass vacuously in CI (flag off renders the same heading)** — set flags per spec, real positive controls, and pin e2e-baseline-flags.sql to a declared manifest (chrome_v2/v3 included). — docs/reviews/2026-10-24-test-coverage.md N-1`

### N-2 — Two DB-test flakes turned `main` red in 2 of 20 runs since CI went green

Neither is a "Neon dropped the connection" failure. Both are flaws in the tests
themselves:

**(a) `src/lib/giving/statements.db.test.ts:497`, CI run 40076015690.**
`expect(part).not.toContain("123")` is meant to catch the 123.45 gift amount. The same
body must contain `/o/<slug>/giving` (`:500`), and fixture slugs carry
`${Date.now()}${random 0–999}` (`src/lib/testing/calendar-fixture.ts:54,92`). That
string contains "123" in roughly 1.4 % of runs, whatever the code does. Fix: use an
amount whose rendered forms can't appear in a timestamp or slug (for example
`98765` → check `987.65` / `987,65`), or strip URLs before checking.
`src/lib/giving/ingest/process.test.ts:314` (`"5000"`) uses fixed inputs and is fine.

**(b) `src/lib/org-features.test.ts:529-549`, CI run 40066582633.** One `it.each` case
loops 2 axes × 3 category rows × 3 toggles = 18 combinations, about 8 round trips each,
inside the 20 s budget. It timed out. Vitest doesn't cancel the promise of a timed-out
test, so the loop kept running: deleting toggles and flipping the global
`org_portal.feature_categories` flag through `setCategoryAxisFlag` while the next case
(`org_portal.calendar`) ran. That second failure is fallout from the first. Fix: one
`it` per combination (`it.each` over the 18), or a per-test timeout with an abort.

Separately, a test that flips a **global** `feature_flags` row is safe in CI (each shard
has its own branch). Run locally against the shared development DB, it flips the flag
for every concurrent developer and pipeline (Rule 16).

TODO: `- [ ] **DB flakes on main:** statements.db.test.ts:497 ("123" vs timestamped slug, ~1.4%/run) and org-features.test.ts:529 (18-combination loop in one it → timeout → leftover loop breaks the next case; also flips a global flag). — docs/reviews/2026-10-24-test-coverage.md N-2`

### N-3 — Four copy-the-logic spec files (64 tests); the prior review counted two

These specs copy the action's logic into the test file and test the copy, so the real
action never runs. All four arrived with the starter import (`54f3935`), and their
subjects are at 0 %:

| Spec | Tests | Subject |
|---|---|---|
| `src/app/(account)/account/account-actions.test.ts` | 25 | email change, password change, deletion |
| `src/app/(password-reset)/password-reset-actions.test.ts` | 22 | `consumeResetToken` single-use and expiry (its header at `:16-25` describes the copy pattern) |
| `src/app/(admin)/admin/users/[id]/actions.test.ts` | 9 | `forceResetTwoFactor`, `setTwoFactorRequired` |
| `src/lib/totp-pending.test.ts` | 8 | `getOrCreatePendingEnrollment` |

The first two were missed last time because their filenames don't follow the
`actions.test.ts` convention. Every subject is security-sensitive, so this overlaps C-2.
Replace each with a test that imports the real module, preferably DB-backed. Then delete
the copies, so the green count stops overstating coverage.

TODO: `- [ ] **Replace the 4 copy-the-logic specs (64 tests) with tests of the real modules** — account-actions, password-reset-actions, admin/users/[id]/actions, totp-pending. — docs/reviews/2026-10-24-test-coverage.md N-3`

### N-4 — Church-domain coverage has still never been measured

`reportOnFailure: true` fixed the local "no report on a red run" problem. But the four
`db.yml` shards run `npm run test:db -- --shard=N/4` without `--coverage`. So the 35
`src/lib` modules that only DB-backed specs reach (for example `domains/service.ts` at
749 statements, `roll.ts` 322, `giving/statements.ts` 301, `onboarding/issue.ts` 220,
`credentials.ts` 99) have no measured figure anywhere.

Recommended: run each shard with `--coverage --reporter=blob`, then add a merge job
(`vitest --merge-reports`) that uploads `json-summary`. This is diagnostic only; don't
gate on it yet.

TODO: `- [ ] **Collect coverage from the db.yml shards** (blob reporter + merge-reports job) so the church domain has a measured number. — docs/reviews/2026-10-24-test-coverage.md N-4`

### N-5 — e2e gaps in the window

e2e grew from 21 spec files / 120 tests to **62 spec files / 515 dev-lane + 76
prod-lane tests**, so prior N-5 is largely closed. What remains:

- **Increment 2 bootstrap chain.** No single spec walks: founding administrator records
  themselves as an elder → Pending approvals enters decide mode → they approve their own
  proposal → the audit row carries `selfRecorded`/`selfApproved`. The behaviour is proven
  in the DB tier (`roll.test.ts:840`, `test-rls-62.sql`) and by one manual walk. It is
  already tracked at `docs/TODO.md:291` and still open.
- **Surfaces with no spec at all:**
  - Officers (`/admin/officers`), which is also the bootstrap's first step
  - Branding (`/admin/branding`)
  - the tier-3 sensitive-information editor (`/admin/community/[id]/edit/sensitive`)

  The sensitive-information editor is the highest-tier data in the product. Its action
  test mocks the DB; `person-sensitive.test.ts` covers the lib in CI.

TODO: `- [ ] **e2e: officers roster and the tier-3 sensitive-info editor (who can see and save it)**; the bootstrap spec is already TODO:291. — docs/reviews/2026-10-24-test-coverage.md N-5`

### N-6 — The hand-rolled trigger-disable teardown has nearly doubled

Prior N-7 counted 41 `alter table … disable trigger` statements in 23 files. There are
now **75 in 34 files**. There is still no `src/lib/db/test-support/` helper, and every
new suite in the window copied the pattern.

TODO: `- [ ] **Shared fixture-teardown helper (one FREEZE_TRIGGERS list)** to retire 75 hand-rolled trigger-disable statements in 34 files. — docs/reviews/2026-10-24-test-coverage.md N-6`

### N-7 — The original three tripwires still have no fixture tests

The three tripwires added in the window all shipped with fixture tests:
`check-giving-boundaries`, `check-hydration-gate` and `check-proxy-imports`. The three
older ones still have none: `check-audit-coverage.mjs`, `check-sql-date.mjs` and
`check-deps-drift.mjs`.

TODO: `- [ ] **Fixture tests for check-audit-coverage, check-sql-date, check-deps-drift.** — docs/reviews/2026-10-24-test-coverage.md N-7`

---

## Minor

- **`src/lib/two-factor.ts:35-39`.** The `catch` path of `isTotpConfigured()` is still
  uncovered (91.3 %). One test with an empty `AUTH_TOTP_ENCRYPTION_KEY` closes it.
- **`scripts/test-rls.sql:449`** prints "RLS suite complete" at line 449 of 8,655. Since
  then, sections 59–64 have been appended via `\ir`. Move the banner to the end and print
  the assertion count.
- **Regression suffix.** 14 of the 36 `fix:` commits since 2026-09-25 added a
  `regression for` test name. All 3 fixes caught in production did. The rest mostly
  *have* real regression tests under other names: `5421fb4` uses "(H-new-1 regression,
  …)", `ac61c9d` names its leak "H-new-2", `03d6459` uses plain behavioural names.
  99 names carry the suffix in total (93 with an em dash, 6 with a hyphen). The
  convention is about being findable by grep, and coverage isn't missing. Either accept
  `regression for` with any dash, or have the commit-msg hook warn on a `fix:` with no
  suffixed test name in the diff.
- **`scripts/session-approval/test-rls.sql.integration.patch`** is committed to git,
  apparently left over from integration.
- **Local Node is v20.20.2** against `engines >=22` / `.nvmrc 22` (still).
- **Playwright `retries: 1` under CI** (`playwright.config.ts:112`). There were 0 flaky
  tests in the 12 sampled jobs, but a retried pass leaves the job green. Have
  `/pre-push` or the release note surface the "flaky" count.

TODO: `- [ ] **Minor test hygiene:** two-factor.ts:35-39 test; move the test-rls.sql banner to the end with a count; settle the regression-suffix form; remove the committed .integration.patch. — docs/reviews/2026-10-24-test-coverage.md Minor`

---

## Prior Review (2026-09-25) — Item Status

| # | Item | Status |
|---|---|---|
| 1 | rate-limit env stub | **Closed** — `src/lib/rate-limit.test.ts:206-210` |
| 2 | test/hook timeouts | **Closed** — `vitest.config.ts` (20 s / 30 s) |
| 3 | serial file execution | **Closed another way** — `test:db` carries `--no-file-parallelism` (`package.json:25`); plain `npm test` loads no env, so it can't race |
| 4 | CI `db-tests` job | **Closed** — `db.yml`: 4 shards plus a separate `test-rls.sql` job as `presby_app`, each on a fresh branch built by `db:migrate` + `check:schema-parity` |
| 5 | fix `e2e.yml` | **Closed** — migrate, `seed-dev.sql`, `PLATFORM_DATABASE_URL`, dev and prod lanes |
| 6 | coverage `include` / report on failure | **Closed** — but coverage is never collected in CI (N-4) |
| 7 | `src/auth.test.ts` | **Open, now critical** — C-1 |
| 8 | catch-all FORCE assertion | **Closed** — `test-rls.sql:5651-5689`, with a staleness check on the allow-list |
| 9 | `presby_roll_cache_drift()` leak | **Closed** — `drizzle/0048:385` revokes it; `test-rls.sql:5817` replaces the global assertion |
| 10 | baseline-relative fixture counts | **Mitigated** — the CI job runs on its own branch; local runs against development are still coupled |
| 11 | teardown helper | **Open, worse** — N-6 |
| 12 | copy-the-logic specs | **Open, undercounted** — N-3 |
| 13 | tripwire fixtures | **Partial** — N-7 |
| 14 | org-portal e2e | **Largely closed** — N-5 residue |
| 15 | `two-factor.ts:35-39` | **Open** — Minor |
| 16 | test-rls banner | **Open** — Minor |
| 17 | Playwright `outputDir` | **Closed** — `playwright.config.ts:109` (`PW_OUTPUT_DIR`) |

---

## Observations

1. **The machine now checks what the tests encode.** On 2026-09-25 the verdict was "the
   tests that encode presby's invariants do not run where anyone is watching". Every PR
   now runs about 8.3k unit tests, the full DB-backed tier in 4 shards, `test-rls.sql`
   as `presby_app` on a branch built from `drizzle/` alone, and 591 e2e tests across two
   lanes. CI was green on 18 of 20 recent DB runs and every sampled e2e run, with 0
   skipped and 0 flaky. Five of the old punch items fixed the biggest problem in a month.
2. **Test volume:** Vitest went from 4,005 to 10,764 tests, e2e from 120 to 591. Pure-TS
   coverage is 76.4 % measured honestly over all files.
3. **The best test work this window:**
   - the roll decide path's three layers (`decide-boundaries.test.ts`'s source scan is
     what keeps `drizzle/0063`'s UPDATE/DELETE revoke safe)
   - the designation-revoke spec (8 tests, including the second-tab no-double-audit case)
   - the giving tier (14 DB suites, a boundary tripwire with its own fixtures, `test-rls-46`)
4. **Lesson from C-1:** a test that pins behaviour must pin the *intended* property. The
   2026-05-16 punch item described the code's behaviour ("merges correctly") rather than
   the security property ("only a server-verified code can set it"). A future
   `src/auth.test.ts` written from that old wording would have passed and enshrined the
   bypass.
5. **The probe for C-1 mocks the DB**, but the vulnerable branch doesn't touch the DB.
   Confirm against a running server on a pipeline Neon branch as the fix's
   failing-first e2e (stricter auth gate).

---

## Verdict

**FAIL.** The four standing targets are met, and the infrastructure findings that drove
the last FAIL are closed. The FAIL is driven by C-1: a client-settable 2FA claim, live
in v0.42.2, in the one module that has had no test since the baseline. C-2 sits beside
it: every Rule 7 audited platform mutation lacks a test that runs the real code.

## Handoff

- **C-1:** route now as a security bug-fix pipeline. tech-lead designs the server-only
  verification signal; api-developer implements it with the failing-first unit and e2e
  tests. qa verifies under the stricter auth gate. Then raise a downstream-sync note for
  the starter and sibling forks.
- **C-2, N-3, N-4, N-6, N-7, Minor:** api-developer (N-4 jointly with
  deployment-engineer).
- **N-1, N-5:** ux-developer, plus tech-lead for the flag-manifest decision.
- **N-2:** api-developer.
- The test-rls banner (Minor): database-admin.
