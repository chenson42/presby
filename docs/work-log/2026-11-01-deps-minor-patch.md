# Dependency update: the Dependabot minor-and-patch group (41 packages) — Work Log

> **Slug:** `2026-11-01-deps-minor-patch`
> **Surface:** mixed (every surface renders through the bumped runtime packages)
> **Permission(s):** not applicable
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Polish / refactor (CLAUDE.md → Classification): version bumps within existing dependencies, no new dependency, no schema, no API surface. It is **auth-touching by runtime** (`otplib`, `next`, `@neondatabase/serverless`), so Phase 4's running-server e2e smoke covering the full login path with an MFA-enrolled user applies.
> **Worktree / port / Neon:** `presby-deps`, port 3530, Neon `pipeline-deps-minor-patch` (`br-bold-block-axhjzt3u`, forked from `development`)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | — | 2026-11-01 |
| 2 — Architectural review | architect | Skipped | — | 2026-11-01 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-11-01 |
| 4 — Implementation | deployment-engineer | Complete (one package held back, one ruling needed) | — | 2026-11-01 |
| 5 — Verification | qa | Auth e2e 97/97 (MFA-enrolled), chromium 695/705 (all 6 failures identical on the 0.53.0 baseline), prod lane 109/109, DB 16,398 (failures environmental or pre-existing), no hang; audit high 3→2 | PASS | 2026-11-02 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Skips, stated:** Phases 1–3 are skipped because there is no new behaviour to refine or design. The versions are fixed by Dependabot PR #71, which the operator asked to merge on 2026-11-01. Any behaviour change a bump causes is a Phase 4 finding. A finding that needs a design decision promotes this to a Feature at that point.

## Why our own branch, not #71

- **#71's lockfile does not install.** Its CI failed at `npm ci` ("typecheck + build", step "Install dependencies", run 41243644413).
- **#71 can't be fully tested in CI.** Dependabot PRs receive no repository secrets, so its DB, `test-rls.sql` and Playwright jobs were all skipped.

This branch applies the same target versions, regenerates the lockfile, and runs every gate. CI on our own PR has the Neon secrets. #71 is closed in favour of this PR.

## Target versions (from #71)

*Correction (QA run 1): the caret ranges let the regenerated lockfile resolve four packages above #71's targets. The installed and tested versions are marked "resolved" below. `react-hook-form` is held at 7.86.0.*

`@hookform/resolvers` 5.9.2 · `@neondatabase/serverless` 1.2.0 · `@radix-ui/react-alert-dialog` 1.2.1 · `@radix-ui/react-avatar` 1.3.1 · `@radix-ui/react-dialog` 1.3.1 · `@radix-ui/react-dropdown-menu` 2.2.1 · `@radix-ui/react-label` 2.1.17 · `@radix-ui/react-slot` 1.5.0 · `@radix-ui/react-switch` 1.4.1 · `@upstash/ratelimit` 2.2.0 · `@upstash/redis` 1.40.0 · `drizzle-orm` 0.45.4 · `lucide-react` 1.63.0 (resolved 1.66.0) · `mermaid` 11.17.2 · `next` 16.4.3 · `otplib` 13.5.0 (resolved 13.6.0) · `react` / `react-dom` 19.3.1 · `@types/react` / `@types/react-dom` 19.3.0 · `react-hook-form` 7.91.0 · `resend` 6.35.0 (resolved 6.37.0) · `sonner` 2.0.8 · `stripe` 23.0.1 · `tailwind-merge` 3.7.0 · `ws` 8.22.0 (resolved 8.22.1) · `@types/ws` 8.18.2 · `@playwright/test` 1.64.1 · `@tailwindcss/postcss` 4.3.3 · `@tailwindcss/typography` 0.5.20 · `@testing-library/dom` 10.4.2 · `@testing-library/react` 16.3.3 · `@types/node` 20.19.43 · `@types/pdfkit` 0.17.7 · `@vitest/coverage-v8` / `vitest` 4.1.12 · `dotenv-cli` 11.1.0 · `drizzle-kit` 0.31.11 · `eslint-config-next` 16.4.3 · `tailwindcss` 4.3.3 · `tsx` 4.23.15

---

## Phase 4 — Implementation (deployment-engineer, 2026-11-01)

### Readiness

Build pass, typecheck pass, lint pass, `npm run check` 10/10 pass, `npm ci` from the new lockfile pass. **40 of the 41 bumps are applied. `react-hook-form` is held at 7.86.0 pending a ruling (below).** No migrations, no env-var changes. No push.

### What changed

| Commit | Content |
|---|---|
| `7eaf03d` build(deps) | All 41 versions from #71, caret/exact style kept; `package-lock.json` regenerated; `rm -rf node_modules && npm ci` verified clean. No dependency added or removed; `check:deps-drift` passes. |
| build(deps): hold react-hook-form | `react-hook-form` back to `^7.86.0` (lock resolves 7.86.0). |
| test(giving) | `src/lib/giving/providers/stripe/client.test.ts` exact-pin literal `23.0.0` to `23.0.1`. `STRIPE_API_VERSION` is unchanged (`2026-09-30.endive`; the SDK's own `Stripe.API_VERSION` matches), so no giving behaviour moved. The test exists so "a human decides" on a version move; the decision here is only the patch literal. |

No application source changed.

### Breaks and fixes

1. **Stripe pin test** (above): mechanical, fixed.
2. **HELD BACK, needs a ruling: `react-hook-form` 7.91.0.** `src/components/shared/hydration-gate.test.tsx` "WITHOUT the gate a pre-hydration pick and edit are overwritten (F116/F122 in jsdom)" goes red: the pre-hydration pick now survives the hydration commit (`expected 'b' to be 'a'`). Bisected by swapping one package at a time: react/react-dom 19.2.6 with RHF 7.91 still fails; RHF 7.86.0 with React 19.3.1 passes. So RHF 7.87-7.91 changed how `defaultValues` are applied at mount. The gated cases all pass. This is the premise of DECISION-159 (the `HydrationGate` on every `useForm` root), and the test's own comment says to re-read DECISION-159 before touching it. Whether the gate's premise changed in a real browser (the jsdom twin may not match), whether the twin should be inverted or deleted, and whether to take 7.91 are design decisions, so I held the package and changed no test. The prod-lane hydration specs (real browser, production build) pass against the held-back 7.86.0 only; **they were not run against 7.91.** Suggested follow-up: a TODO line and a ruling; the gate is harmless if the bug is gone.
3. No other breaks: no React 19.3 type errors, no lucide icon removals (typecheck covers named imports), no Radix, resend, otplib, Playwright, neon-serverless or drizzle breakage surfaced in any gate.

### Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | pass |
| `npm run check` | exit 0, all ten tripwires |
| `npm test` (CI shape) | 820 files passed, 137 skipped; 12,790 tests passed, 3,616 skipped, 0 failed |
| Production build (scratch copy outside `~/git/presby-platform/`, since deleted) | pass, exit 0, no warnings |
| `npm run test:db` (serial, pipeline Neon branch) | 956 files passed, 1 failed; 16,404 tests passed, 1 failed, 1 skipped. The one failure is the known parishes idempotence case (`parishes.db.test.ts`, "the whole file re-applies with no row change"). The fixture-deletable canary did not fail. Wall time about 52 min. |
| Playwright, `e2e-reset-flags.sql` run first with `pipeline_branch=1`, own dev server on 3530 | Auth subset (admin-login, forgot-password, invitation new and existing account, post-login-routing, developer-2fa-gate, hydration): 58/58. Full chromium project: 701 passed, 4 failed, ~38 min. |
| `npm run test:e2e:prod` (scratch build copy, port 3800) | 109 passed, 0 failed. Run with RHF held at 7.86.0. |

The full chromium run includes `totp-full-login`, `totp-first-enrolment`, `totp-recovery-code`, `two-factor-role-based` and the other MFA specs, all green, so the login path with an MFA-enrolled seeded user is covered.

**The four chromium failures**, each re-run in isolation, and the first three checked against a scratch copy of the pre-bump commit (`c0d2a76`, old `node_modules`, same Neon branch, port 3531, since deleted):
- `community-participants.spec.ts:305` (degrade copy "the directory.view permission") fails identically on the baseline. Pre-existing.
- `timezone-safe-dates.spec.ts:36` and `:71` (30 s `waitForFunction` timeouts) fail identically on the baseline. Pre-existing on this branch lineage.
- `reimbursement-csv.spec.ts:316` (20,000-row export, 120 s request timeout) failed once in the full run and once in a three-file batch, then passed twice when the file ran alone (6/6, 6/6). Load flake on a slow export, but I did not run it against the baseline under the same concurrent load, so it is not proven unrelated to the bump. QA should re-run it alone.

Also seen: the first `test:db` attempt stalled for 35 minutes with no output (the build was running in parallel on the same machine); I killed it by PID and the second, serial-only run completed. Treat that as environment, but if QA sees a hang, suspect `@neondatabase/serverless` 1.2.0 / `ws` 8.22.0 (resolved 8.22.1).

### Audit

`npm audit` high advisories, before to after: **3 to 2**.
- Before: `brace-expansion`, `undici`, `vite`. Total 31 (2 low, 26 moderate, 3 high).
- After: `brace-expansion`, `undici`. Total 27 (2 low, 23 moderate, 2 high). `vite` cleared by the vitest bump.
- `npm audit --audit-level=moderate` still exits non-zero (the 2 high and 23 moderate remain, transitive). Resolving them is outside a minor-and-patch bump.

### For QA: riskiest surfaces

1. **The `react-hook-form` hold** and the ruling it needs; do not mark the hydration twin as a pass by editing it.
2. **Auth by runtime**: `otplib` 13.5 (TOTP verify, enrol, recovery), `next` 16.4.3 (proxy, 2FA claim), `@neondatabase/serverless` 1.2.0 with `ws` 8.22.0 (resolved 8.22.1) (the WebSocket pool and the transaction-scoped RLS GUC).
3. **Radix dialogs, alert dialogs, dropdowns, switches, avatars** on a phone viewport (360 px); the e2e suite is desktop chromium.
4. **Reimbursement CSV export** timing (re-run alone).
5. **Email**: `resend` 6.35 (queue send and the invitation emails) has no live-send test here.
6. **Stripe 23.0.1** only through unit and fake-provider specs; no live API call.
7. **`mermaid` 11.17.2** on `/developer/data-model` (ER diagrams) and **`lucide-react`** icons, which only a browser look confirms.
8. The two pre-existing failures (community degrade copy, timezone-safe dates) are not caused by this branch and may deserve their own TODO lines.


---

# Phase 5 — Verification (qa), run 1

**Date:** 2026-11-02
**Verified by:** qa
**Branch / HEAD:** `pipeline/deps-minor-patch` at `4af5689e`. Worktree unmodified (`git status` clean). Baseline for attribution: `af9d0be` (main 0.53.0, pre-bump lockfile).

**Scope run.** Everything was run in full except the attribution re-runs, which were single files.
- Clean `npm ci`, typecheck, lint, all ten tripwires, `check:deps-drift`.
- The unit suite in CI shape.
- The full DB-backed suite, serial.
- Three production builds.
- The auth e2e subset, the full `--project=chromium` dev lane, and the production lane.
- A 360px walk in light and dark.
- `npm audit` before and after.

**Not run:** `scripts/test-rls.sql`. There is no migration, and it runs through `psql` as `presby_app`, so the npm driver is not on its path.

**Environment.**
- **Node:** 22.23.1, the `.nvmrc` and CI version. The shell default is 20.20.2, which Phase 4 probably used.
- **Servers:** run from scratch copies outside `~/git/presby-platform/`, each in its own parent directory (`turbopack.root` is the parent). Dev on 3590, prod on 3820. Stopped by PID; nothing is listening now.
- **Browsers:** a private `PLAYWRIGHT_BROWSERS_PATH`.
- **Flags:** global flags were reset to the CI baseline on the pipeline branch (`scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`) before the auth subset, again before the full chromium run, and again before the prod lane.
- **Env values:** connection strings were checked by length only, never printed.

## Install and lockfile

- `npm ci` from clean: exit 0, 849 packages. `npm ls --all`: exit 0. The worktree's `node_modules` matches the lockfile (0 mismatches).
- `react-hook-form` is **7.86.0** in `package.json` (`^7.86.0`), in the lockfile and as installed. `@hookform/resolvers` 5.9.2 dedupes to it.
- **Finding (record accuracy, not a defect).** Four direct dependencies resolve above #71's targets, because the caret ranges let the regenerated lock float. What ships is what this run tested, but the work-log's "All 41 versions from #71" claim and its Target versions list do not match what is installed. The work-log and the PR body should name the resolved versions.

| Package | #71 target | Installed |
|---|---|---|
| `otplib` | 13.5.0 | 13.6.0 |
| `resend` | 6.35.0 | 6.37.0 |
| `lucide-react` | 1.63.0 | 1.66.0 (from 1.16.0 at baseline) |
| `ws` | 8.22.0 | 8.22.1 |

## Type Check

`npm run typecheck`: **PASS**

- `npm run lint` (`--max-warnings=0`): PASS
- `npm run check`: PASS, all ten tripwires. `check:help` reports 29 entries, 24 published, 7 images.
- `npm run check:deps-drift`: PASS

## Unit Tests

CI shape: DB variables unset, `CI=true`, run in the worktree.

Total: 16,406 | Passed: 12,790 | Failed: 0 | Skipped: 3,616 | Duration: 40 s

- Files: 820 passed, 137 skipped. This matches Phase 4 exactly.
- The 137 skipped files are the env-gated DB set; every one of them ran in the DB suite below.

**DB-backed suite** (`npm run test:db`, serial, pipeline Neon branch, scratch copy):

Total: 16,406 | Passed: 16,398 | Failed: 7 (4 files) | Skipped: 1 | Duration: 56.6 min

- **No hang.** It ran with nothing else on the machine, and workers cycled throughout. `@neondatabase/serverless` 1.2.0 with `ws` 8.22.1 completed the run.
- Every DB file that exercises `withOrgContext` and the transaction-scoped GUC passed.
- None of the seven failures is attributable to the bump:
  1. **`scripts/pre-push-gate.test.mjs:77`, `:81` and `scripts/stats-escape.test.mjs:129`.** These need a git repository, and the scratch copy has no `.git`. Re-run in the worktree: 106 of 106 pass.
  2. **`src/lib/db/domain/parishes.db.test.ts:443`** (re-apply idempotence: groups and grants 62 vs 60). It fails identically on the baseline. CI `db.yml` on main was green at both `af9d0be` and `d530c41`, so this is pre-existing state on this branch.
  3. **`src/lib/db/fixture-deletable.test.ts:199`, `:224`, `:271`.** The canary found 26 people and 2 organizations stamped at 2026-11-01 21:59 UTC by `src/lib/db/domain/connect.db.test.ts` (fixture label `cn65`). Their deletion window closed at 23:59 UTC, so they can no longer be deleted. That timing fits the Phase 4 `test:db` run that was killed mid-file. It fails identically on the baseline. In this run `connect.db.test.ts` passed and cleaned up after itself. **Every future `test:db` on this Neon branch will fail this canary.** Delete the branch at cleanup; that is standing authorization.

## End-to-End Tests

**Auth subset** (dev server, real MFA-enrolled seeded user), 19 spec files:
- **Sign-in and session:** admin-login, post-login-routing, developer-2fa-gate, session-claim-integrity, forgot-password, sign-in-connect-smoke.
- **TOTP:** totp-full-login, totp-first-enrolment, totp-recovery-code, totp-code-entry, totp-callback-bypass, totp-enrol-concurrency, totp-regenerate-gate, two-factor-role-based.
- **Invitations:** invitation-new-account, invitation-existing-account, community-sign-in-invite.
- **Hydration:** hydration/totp-challenge, hydration/totp-enrol-handoff.

Total: 97 | Passed: 97 | Failed: 0 | Skipped: 0 | Duration: 6.0 min

This covers password, then TOTP, then landing; the full login with `admin-2fa-enrolled`; enrolment; the recovery code; and invitation acceptance for both new and existing accounts. **The auth-touching gate is met.**

**Full chromium dev lane:**

Total: 705 | Passed: 695 | Failed: 6 | Did not run: 4 | Skipped: 0 | Duration: 38.2 min

The 705 total matches Phase 4. Each failure was re-run, alone where noted, and checked against the baseline server (same Neon branch, Next 16.4.2, old `node_modules`). CI `e2e.yml` on main at `af9d0be` was green on a fresh database.

| Failure | Branch | Baseline | Attribution |
|---|---|---|---|
| `e2e/community-participants.spec.ts:305` | fail | fail, same assertion `:310` | Pre-existing (as Phase 4 found) |
| `e2e/timezone-safe-dates.spec.ts:36`, `:71` | fail (30 s `waitForFunction`) | fail, same | Pre-existing (as Phase 4 found) |
| `e2e/reimbursement-csv.spec.ts:316` (20k-row 413, 120 s timeout) | fail in full run; **pass alone twice** (6/6, 6/6) | **fail alone** (same timeout at `:323`) | Not caused by the bump: a slow export that also fails on baseline code |
| `e2e/member-calendar.spec.ts:64` (**new vs Phase 4**) | fail twice (full run and alone) | fail, same `:68` | Branch state. A live grant of the `member` role, which carries `events.view`, to the "Active Membership" group at `e2e-alpha`, created 2026-10-28 and inherited from `development`. That falsifies the spec's "no grant" premise. |
| `e2e/reimbursement-member.spec.ts:871` (**new vs Phase 4**) | fail twice ("You don't have permission to do that." on receipt add) | fail, same `:897` | Branch state (baseline identical; CI green). Its 4 serial dependents did not run on either side, so they are **not verified locally**; they rest on the PR's CI run. |

**Harness note (not part of the bump).** Two `reimbursement-csv` re-runs failed at `:147`: `/totp` kept reloading and its first digit box never enabled. The cause was a restarted dev server in a copy that had already run tests, which logged 380 `✓ Compiled in 0ms` lines. A fresh restart with `test-results/` moved out logged 0 recompiles and passed. The same reload loop reproduces on the baseline (Next 16.4.2). I discarded those two runs; the first and baseline server instances logged 0 recompiles, so every attribution above is valid. This would be worth a line in `docs/testing.md`.

**Production lane** (`npm run test:e2e:prod`, `PW_PROD_PORT=3820`, scratch copy):

Total: 109 | Passed: 109 | Failed: 0 | Skipped: 0 | Duration: 4.3 min

**Production builds** (all exit 0, no warnings):
- Plain `npm run build`: 28 s.
- `CI=1 npm run build`: 27 s. Its only notice is "No build cache found", which is expected.
- An exact CI-shape build (no `.env.local`, `ci.yml`'s four placeholder values).
- A baseline build hit the documented `@vercel/turbopack-next/internal/font/google/font` flake once and passed on retry after clearing `.next`.

## 360px walk, light and dark

I used scratch specs in the scratch copy; no project file was touched. A throwaway platform admin `e2e-qawalk-*@example.invalid` was created and deleted (0 remain), plus the fixture `admin` storage state.

- **Theme:** `<html>` class is `light` or `dark` as emulated. Horizontal overflow is 0 on `/home`, `/account`, `/admin`, `/developer/data-model` and the ERD. No page errors and no console errors.
- **Radix:**
  - The avatar dropdown (`@radix-ui/react-dropdown-menu` 2.2.1, avatar 1.3.1) settles at opacity 1, `data-state="open"`, transform none.
  - The admin console phone menu, a Dialog sheet (1.3.1), settles the same way.
  - The "Delete account" AlertDialog (1.2.1) and its overlay settle the same way. Escape closes it and focus returns to the trigger.
  - First screenshots caught the open animation half-transparent; after awaiting `getAnimations()` everything is opaque. I read the screenshots.
- **Features switches and archive dialogs on the org side:** covered by the chromium lane's own 360px specs (`reimbursement-toggle`, which drives switches and an alertdialog; `parishes`; `community-participants` at 360px), all green except the attributed failures above.
- **lucide-react 1.66.0:** the Menu, Landmark, chevron and alert-triangle icons all render, in both schemes.
- **sonner 2.0.8:** the toast is visible at 360px in both schemes. A dev server renders 2 identical toasts for `/account?emailChanged=1`. The **production builds of both branch and baseline render exactly 1**, so nothing changes for users.
  - The cause is a 2.0.8 change: it now replays active toasts to a late-subscribing `<Toaster>`. Combined with StrictMode's double effect, that gives two toasts in dev only.
  - A baseline dev comparison was blocked by the reload-loop hazard above.
- **mermaid 11.17.2:** `/developer/erd/d-rolls` renders the SVG (7 nodes) themed for light and for dark, with 0 page overflow.
- **resend 6.37.0 and stripe 23.0.1:** their unit and DB tests passed in the two suites above. The Stripe SDK's `ApiVersion` is `2026-09-30.endive`, equal to `STRIPE_API_VERSION`. There is no live-send or live-API test, as Phase 4 already stated.

## react-hook-form hold (opinion for the record, not a ruling)

- **Hold confirmed:** 7.86.0 in the lockfile, and the existing `hydration-gate.test.tsx` passes 10 of 10 on it. Under 7.91.0, in an isolated scratch probe, it fails 1 of 10 (`expected 'b' to be 'a'`), which reproduces Phase 4's finding.
- **What changed, bisected in jsdom** (pre-hydration edit on an **ungated** form, then hydrate, then submit):

| Version | `<select>` | text input | checkbox / radio | DOM = `getValues()` = submitted? |
|---|---|---|---|---|
| 7.86.0 to 7.89.0 | reverted to default | reverted | reverted | yes |
| 7.90.0 | reverted | **kept** | reverted | yes |
| 7.91.0 | **kept** | **kept** | reverted | yes |

- **Opinion.** At 7.91 a pre-hydration select or text edit now survives in jsdom, and form state adopts it. I saw no F121-style split where the screen shows one value and the submit sends another. But the premise of DECISION-159 still holds for checkbox and radio. A form where some field types survive and others silently revert is a partial-loss hazard of its own. And jsdom is not a browser.
- **What I would want before any ruling:**
  1. Keep `HydrationGate` either way. It is cheap and still needed.
  2. Rewrite the characterisation twin to pin the per-type behaviour rather than delete it.
  3. Run a real-browser, production-lane negative control on an ungated form under 7.91 (the `docs/testing.md` step 6 procedure), checking DOM and persisted state agree for a `<select>`.

  The prod-lane hydration specs alone cannot answer this, because they only exercise gated forms.

## npm audit

`npm audit --audit-level=moderate` exits 1 both before and after.

| | low | moderate | high | total |
|---|---|---|---|---|
| Before (`af9d0be`) | 2 | 26 | 3 (`brace-expansion`, `undici`, `vite`) | 31 |
| After | 2 | 23 | 2 (`brace-expansion`, `undici`) | 27 |

- No new advisory.
- Cleared: `vite`, `vitest`, `@vitest/mocker`, `@vitest/coverage-v8`.
- CI's gate (`node scripts/ci/audit-prod.mjs`, production dependencies, high and above) passes on both.

## Regression Tests Added

None; this is a dependency update. `src/lib/giving/providers/stripe/client.test.ts:81` moves the exact pin literal from 23.0.0 to 23.0.1. It is a "human decides" pin test, not a regression test.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (target 100%)
- `src/lib/two-factor.ts`: 91.1% statements (target 90%+)
- `src/lib/flags.ts`: 100% (target 100%)

## Feature-Gate Audit

No protected routes touched. The diff is `package.json`, `package-lock.json`, the work-log and one test literal. No route handler, server action or `src/` source changed.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| no protected routes touched | n/a | n/a | n/a |

**Schema/RLS:** no schema change. The driver bump's RLS path (transaction-scoped GUC through `withOrgContext`) was exercised by the DB-backed suite on the real branch and passed.

## Copy Truthfulness

No strings changed: `git diff -U0 af9d0be..HEAD` over `.tsx` and `*-copy.ts` adds 0 lines. There is no help diff.

- [x] Every added or changed string is in the design's Copy table (none added)
- [x] The query behind each claim was opened (n/a)
- [x] Each instruction was traced to the role that sees it (n/a)
- [x] Older strings about the same subject were grepped for (n/a)
- [x] Help diff covered (no help diff)

## Verdict

**PASS**

Every required check is green, or its failure was attributed with baseline evidence to state on this pipeline branch or to the scratch environment. None traces to a bumped package. The auth-touching gate is met: e2e ran against a real dev server with an MFA-enrolled seeded user (97 of 97), the production lane passed 109 of 109, and the DB suite completed with no hang.

**Follow-ups for the orchestrator** (none blocks this PASS):
1. **Correct the version record** in the work-log and PR body: `otplib` 13.6.0, `resend` 6.37.0, `lucide-react` 1.66.0, `ws` 8.22.1.
2. **Neon branch `pipeline-deps-minor-patch`** now carries 28 permanently undeletable fixture rows. Delete the branch at cleanup.
3. **Possible TODO lines:**
   - The `member` role granted to "Active Membership" at `e2e-alpha` on `development`, which breaks `member-calendar.spec.ts:64` on every branch forked from it.
   - `reimbursement-member.spec.ts:871` on branch state.
   - The dev-server restart reload loop, as a `docs/testing.md` note.
   - The `reimbursement-csv:316` export timing, which also fails on the baseline.
4. **The `react-hook-form` 7.91 ruling** stays with tech-lead and the operator; the evidence is above.

**Per-Phase Status row:**

| 5 — Verification | qa | Complete | PASS | 2026-11-02 |

**Handoff:** analyst, for Phase 6 (shipped vs intent). The CI run on this branch's PR is the authority for the 4 `reimbursement-member` dependents that did not run locally.

Scratch evidence (logs, screenshots, probes) is under `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/`. The key files are `logs/db.log`, `logs/e2e-auth.log`, `logs/e2e-full.log`, `logs/e2e-prod.log`, `shots-qa5/` and `rhf791/src/components/shared/probe.test.tsx`.
