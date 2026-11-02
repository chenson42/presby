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
| 6 — Shipped vs intent | analyst | 40 of 41 shipped as tested; react-hook-form hold made durable (exact pin + Dependabot ignore, by the orchestrator); nothing a non-operator sees changes | SHIP WITH NOTES | 2026-11-02 |

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
| `7eaf03d` build(deps) | 40 of the 41 versions from #71 (`react-hook-form` held), caret/exact style kept; `package-lock.json` regenerated; `rm -rf node_modules && npm ci` verified clean. No dependency added or removed; `check:deps-drift` passes. |
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
- **Finding (record accuracy, not a defect).** Four direct dependencies resolve above #71's targets, because the caret ranges let the regenerated lock float. What ships is what this run tested, but the work-log's "40 of the 41 versions from #71 (`react-hook-form` held)" claim and its Target versions list do not match what is installed. The work-log and the PR body should name the resolved versions.

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


---

# Phase 6 — Shipped vs Intent (analyst)

I read the work-log (Phase 4 and QA run 1) and checked the shipped diff directly. `git diff af9d0be..HEAD` touches four files: `package.json`, `package-lock.json`, `src/lib/giving/providers/stripe/client.test.ts` and the work-log. I also read `.github/dependabot.yml`, `docs/TODO.md` and the 0.54 release-note format.

I did not start a dev server. The 360px walk below is QA's, and I judged its evidence rather than re-running it. The "walk as the person the path creates" requirement does not apply, because nothing here changes how an account connects, how a role is granted, or what a new account can reach.

## VERDICT

**SHIP WITH NOTES**

Conditions on the merge:

- **Held package must be pinned.** `react-hook-form` is still `^7.86.0`, so the hold is not yet durable. See Intent-vs-Shipped, item 3.
- **PR CI must be green on the reimbursement specs.** The PR's CI must be green on `e2e/reimbursement-member.spec.ts` and its four serial dependents. They did not run locally, and QA named CI as the authority.

## ONE-LINE TAKE

> 40 of the 41 Dependabot minor-and-patch bumps are installed and verified, 4 of them slightly above #71's targets. `react-hook-form` is held at 7.86.0, and nothing a member, congregation administrator or visitor can see changes. The one visible difference is a duplicate toast on dev servers, and `npm audit` high advisories drop from 3 to 2.

## What's Working

- **Evidence matches the claim.** This is a dependency update with no app source change, and the evidence is as heavy as the risk warrants:
  - clean `npm ci`, typecheck, lint and all ten tripwires;
  - 12,790 unit tests and a full serial DB suite (16,398 passed);
  - the auth e2e subset 97/97 with an MFA-enrolled user, the production lane 109/109, and the full chromium lane 695/705.
- **Failures were attributed, not waved through.** QA re-ran every failure against a baseline server on the same Neon branch.
- **The hold is honest about its evidence.** QA bisected `react-hook-form` per version, reproduced Phase 4's finding independently, and said what the prod-lane specs cannot show. No test was edited to make it pass.
- **Four drifted versions were caught.** The work-log's Target versions list now carries "resolved" marks for them.
- **No copy and no help diff.** `git diff -U0` over `.tsx` and `*-copy.ts` adds 0 lines, and `check:help` passes (29 entries, 24 published).
- **Stripe is unmoved.** The Stripe API version is unchanged (`2026-09-30.endive`) and only the pin test's patch literal moved.

## Intent-vs-Shipped Diff

1. **Intent: merge #71's group of 41.** Shipped: the same group on our own branch, with 40 applied and `react-hook-form` held. #71 fails `npm ci` and gets no secrets, so a branch of our own was right. Verdict: acceptable drift. The PR body and the release note must say "40 of 41", not "all 41". The work-log's Phase 4 "What changed" row still says "All 41 versions from #71", which Phase 4's text and the corrected target list contradict.
2. **Intent: the same versions as #71.** Shipped: four resolve higher, all in-range minor or patch, and all tested as installed:

   | Package | #71 target | Installed |
   |---|---|---|
   | `otplib` | 13.5.0 | 13.6.0 |
   | `resend` | 6.35.0 | 6.37.0 |
   | `lucide-react` | 1.63.0 | 1.66.0 |
   | `ws` | 8.22.0 | 8.22.1 |

   Verdict: acceptable drift. What ships is what was tested.
3. **Intent: `react-hook-form` held at 7.86.0.** Shipped: the lockfile and `node_modules` carry 7.86.0, but `package.json` still says `^7.86.0`. Verdict: **partly delivered, not yet durable.**
   - Any lockfile regeneration resolves to 7.91.x.
   - `.github/dependabot.yml` has no `ignore` for it, so Dependabot will re-propose 7.91 in next week's group and the hold gets lost.
   - 7.87 to 7.90 are also changed, per QA's bisection: 7.90 starts keeping a pre-hydration text edit.
   - Fix before merge, in one line each: change `package.json` to the exact `7.86.0` (the `stripe` pin is the precedent) and add a `react-hook-form` ignore to `dependabot.yml` with a comment pointing at the TODO line. The lockfile resolution does not change, so re-verification is `npm ci` plus `hydration-gate.test.tsx`.
4. **Intent: nothing visible changes.** Shipped: this holds in production. The one difference is the sonner 2.0.8 duplicate toast, which QA confirmed appears **in dev only**; production builds of both branch and baseline render exactly 1. Only people running a dev server see it. The cause is that 2.0.8 replays active toasts to a late-subscribing `<Toaster>`, and StrictMode's double effect doubles that. A baseline dev comparison was blocked by the reload-loop hazard, so "dev-only" rests on the production builds plus the changelog mechanism. I accept it. A line in the release note is enough, with no TODO.
5. **Intent: audit hygiene as a side benefit.** Shipped: high advisories 3 to 2 (`vite` cleared), total 31 to 27. CI's production-dependency gate passes. `npm audit --audit-level=moderate` still exits 1 because 2 high and 23 moderate transitives remain. That is outside a minor-and-patch bump, but the existing TODO line 188 is now stale (see TODO changes).

## Edge Cases

- **Empty state:** not applicable.
- **Failure microcopy:** not applicable, no strings changed. QA's walk of the loading and dialog states shows no new error surfaces.
- **Permission gate:** not applicable. No route, action or `FEATURES.*` change; the Feature-Gate Audit is empty by construction.
- **Audit event:** not applicable.
- **Mobile (360px):** pass, on QA's walk.
  - Light and dark showed zero horizontal overflow on `/home`, `/account`, `/admin`, `/developer/data-model` and the ERD.
  - The Radix dropdown, Dialog sheet and AlertDialog settle opaque with focus returning.
  - The lucide icons render, and mermaid renders the SVG themed in both schemes.
- **Help pages read as their reader:** no help impact, confirmed.
  - No help page has an entry `labels` string, a `[help:...]` token or a `limitationUntil` that this change touches.
  - No help page quotes toast behaviour.
  - No label, role, flag or email changed, and `check:help` passes.
  - Nothing to walk, and `verifiedIn` is not moved.
- **Auth path:** the Phase 4 gate is met. The e2e ran against a real dev server with the MFA-enrolled `admin-2fa-enrolled` user (97/97). The prod lane passed and the DB suite did not hang on `@neondatabase/serverless` 1.2.0 with `ws` 8.22.1.
- **Not run, accepted:** `scripts/test-rls.sql` (no migration, and it runs through `psql`, not the npm driver). There is no live resend send and no live Stripe call. This is the same coverage as before the bump, so it is not a regression.

## Phase 1 gaps

Phase 1 was skipped, so there are none. Every Phase 4 and QA finding is dispositioned below.

## QA's four possible TODO lines, plus the Neon cleanup

- **`member` grant at `e2e-alpha` on `development`:** right to track. Its cause is not established, which the line states. It may be the 0.54.0 work or operator testing. Per the "all deletes are soft" rule, the remedy is to end-date the grant, not delete it, and only once its origin is known. It relates to F133 (line 200 of `docs/TODO.md`, `events.view` and `member` roles).
- **`reimbursement-member:871`:** right to track. The cause is not identified, only that it fails the same way on baseline. The 4 dependents are unverified locally, so the line carries the PR-CI condition.
- **Dev-server reload loop:** right to track as a `docs/testing.md` note. It reproduces on baseline, so it is not caused by the bump.
- **`reimbursement-csv:316`:** right to track, but worded carefully.
  - It passed alone twice on the branch and failed alone on the baseline, so it is timing-dependent and not tied to this change.
  - Phase 4's "not proven unrelated" is closed by QA's baseline failure.
- **Neon branch deletion:** correct, and standing authorization covers it. This is a cleanup action rather than a backlog item. The branch now carries 28 undeletable fixture rows from the killed Phase 4 `test:db` run, so every future run there fails the `fixture-deletable` canary. Do it at cleanup and drop the line if done the same session.

## Missed by QA

Phase 4 flagged these two failures as possibly deserving their own lines, and QA's list omitted them. Both are already in `docs/TODO.md`, so the right action is to update those lines, not add new ones:

- **`community-participants.spec.ts:305`** is already F172 (line 155). It now reads `:305` and was seen failing on baseline.
- **`timezone-safe-dates.spec.ts:36` and `:71`** are in the "unclassified until run on an isolated branch" clause of line 213. They have now been run on an isolated pipeline branch and fail identically on the baseline.

## TODO changes (for the orchestrator, same commit as the work, Rule 10)

**Add, verbatim:**

```
- [ ] **react-hook-form 7.91 ruling (held at 7.86.0 in the 2026-11 minor-and-patch update).** Dependabot #71's group wanted 7.91.0. `src/components/shared/hydration-gate.test.tsx` "WITHOUT the gate a pre-hydration pick and edit are overwritten (F116/F122 in jsdom)" fails under 7.91 ("expected 'b' to be 'a'"). QA bisected it in jsdom with a pre-hydration edit on an ungated form: 7.86 to 7.89 revert `<select>`, text and checkbox/radio; 7.90 keeps text; 7.91 keeps `<select>` and text; checkbox/radio revert at every version; DOM, `getValues()` and the submitted value agreed at every version (no F121-style split seen). The premise of DECISION-159 therefore still holds for checkbox/radio, and a form where some field types survive and others revert is a partial-loss hazard of its own. jsdom is not a browser, and the prod-lane hydration specs only exercise gated forms, so they cannot answer this (they passed 109/109 on 7.86.0 only). Tech-lead and the operator rule. Suggested steps: (1) keep `HydrationGate` on every `useForm` root either way; (2) rewrite the characterisation twin to pin the per-type behaviour rather than delete it; (3) run a real-browser production-lane negative control on an ungated form under 7.91 (`docs/testing.md` step 6), checking that the DOM and the persisted value agree for a `<select>`; (4) only then lift the hold. Until the ruling, `package.json` pins `react-hook-form` exactly and `.github/dependabot.yml` ignores it, so Dependabot does not re-propose it weekly. — `docs/work-log/2026-11-01-deps-minor-patch.md` Phase 4 / Phase 5 / Phase 6
- [ ] **`member-calendar.spec.ts:64` fails on every branch forked from `development`.** A live grant of the `member` role (it carries `events.view`) to the "Active Membership" group at `e2e-alpha`, created 2026-10-28, falsifies the spec's "no grant" premise; it fails identically on baseline, and CI on a fresh database is green. Its origin is not established. Find out who or what created it (the 0.54.0 Visitors work or operator testing), then end-date it (removals are soft) or make the spec set up and tear down its own premise. Related to F133. — `docs/work-log/2026-11-01-deps-minor-patch.md` Phase 5
- [ ] **`reimbursement-member.spec.ts:871` fails on the shared `development` branch state** ("You don't have permission to do that." on receipt add; the same failure on the pre-bump baseline, CI green on a fresh database). Cause not identified. Its 4 serial dependents did not run locally on either side, so they rest on CI. Find what in the branch state removes the permission and either fix the data or make the spec self-sufficient. — `docs/work-log/2026-11-01-deps-minor-patch.md` Phase 5
- [ ] **`docs/testing.md`: dev-server reload loop after a restart in a copy that has already run tests.** `/totp` keeps reloading and its first digit box never enables (the log shows hundreds of `Compiled in 0ms` lines). It reproduces on Next 16.4.2 as well as 16.4.3, so it is not a bump. Fix: restart with `test-results/` moved out of the copy; a fresh restart then logs 0 recompiles. Add the symptom and the fix to the e2e troubleshooting section. — `docs/work-log/2026-11-01-deps-minor-patch.md` Phase 5
- [ ] **`reimbursement-csv.spec.ts:316` (the 20,000-row export, 120 s request timeout) is timing-dependent.** It failed in the full run, passed alone twice on the bumped branch, and failed alone on the pre-bump baseline, so it is a slow export under local load, not a regression. Either measure the export (server time for 20,000 rows) or give the test a budget that fits CI and a laptop. — `docs/work-log/2026-11-01-deps-minor-patch.md` Phase 4 / Phase 5
- [ ] **Delete the Neon branch `pipeline-deps-minor-patch` (`br-bold-block-axhjzt3u`) at cleanup** (standing authorization; never `production` or `development`). It carries 28 permanently undeletable fixture rows (26 people, 2 organizations, label `cn65`, from the killed `test:db` run), so every further `test:db` there fails the `fixture-deletable` canary. Drop this line if it is done in the same session. — `docs/work-log/2026-11-01-deps-minor-patch.md` Phase 5
```

**Edit existing lines:**

- **Line 188 (dev-dependency advisories).** Replace the opening with "`npm audit` reports 2 high (`undici`, `brace-expansion`; `vite` cleared by the 2026-11 vitest bump) and 23 moderate, 2 low; 27 in total, down from 31". The rest stands. Note that `npm audit fix` is no longer a bump-only job; take it as its own small `chore(deps)` change.
- **Line 155 (F172).** Append "Seen again 2026-11-02 at `:305` on the deps branch; it fails identically on the pre-bump baseline, so it is not a bump effect."
- **Line 213.** Append "`timezone-safe-dates.spec.ts:36,71` now run on an isolated pipeline branch (2026-11-02): both fail identically on the pre-bump baseline, so they are classified pre-existing and not environmental."
- **Line 659 (batch-bump routine low-risk deps).** Move to Done: "2026-11-02 — 40 of 41 minor-and-patch bumps (v0.54.3, `docs/work-log/2026-11-01-deps-minor-patch.md`); `react-hook-form` held, see the ruling line."

## Other housekeeping

- **Release numbering.** `main` is at 0.54.0 (`package.json`, `docs/release-notes/v0.54.md`), and this branch forked at 0.53.0.
  - The 0.54.3 label assumes 0.54.1 and 0.54.2 land first. If they have not, take the next free number.
  - Merge `main` before the PR. `main` changed only the `package.json` version and four lines at the head of `package-lock.json`, so conflicts should be trivial.
- **#71.** Close it with a comment naming this PR and the `react-hook-form` hold.
- **Rules 12, 13, 14, 15.** No feedback row, no what's-new (and the standing operator preference is to keep what's-new out of the to-dos), no functionality-map change, no architecture change.
- **Rule 17.** No help impact, as above.

## Follow-Ups (SHIP WITH NOTES)

1. Pin `react-hook-form` exactly and add the Dependabot ignore, before merge (item 3 above).
2. PR CI must be green on `reimbursement-member` and its four serial dependents before merge (the QA handoff).
3. The six new TODO lines, four line edits and the Done move above.
4. The PR body and release note say "40 of 41" and name the four resolved versions.
5. Merge `main` in and close #71 with an explanatory comment.

## Release-note draft (add to `docs/release-notes/v0.54.md`)

Table row:

| [0.54.3](#0.54.3) | 2026-11-02 | Maintenance | Routine software updates under the hood; nothing you see changes. One update is deliberately held back |

Entry:

```
<a name="0.54.3"></a>
## 0.54.3 — 2026-11-02

### Maintenance: Routine software updates

**Value:** PresbyPortal is built on open-source libraries, and their authors publish fixes and small improvements every week. This release takes 40 of the 41 updates that were waiting. Nothing about how the portal looks or works changes for you.

#### What's New

**For members, administrators and visitors.** Nothing. No screens, wording, emails, permissions or settings changed, and no help page needed an edit. Pages, dialogs, menus, icons and the sign-in process (including two-factor sign-in) were checked at phone width in light and dark mode.

**For the operator.**
- **Security advisories.** The count of high-severity advisories in our tooling dropped from 3 to 2 (the testing tool `vite` is no longer flagged). The remaining 2 high and 23 moderate are in supporting tools that do not ship to the live site, and they need updates that cannot be taken safely in a routine release. They are tracked in the backlog.
- **One update held back on purpose.** The form library (`react-hook-form`) stays at 7.86.0. Its newer version changes how a form behaves if someone edits it before the page has finished loading. That behaviour is the reason every form is locked until the page is ready. It is not clear that the lock is no longer needed, so we left the library where it is and put the question to a ruling. It is pinned so it cannot move on its own.
- **The automatic update pull request (#71) was closed.** Its package list did not install cleanly, and it could not be fully tested. The same updates were applied here and run through the full test suites instead. Four packages (`otplib`, `resend`, `lucide-react`, `ws`) installed one patch or minor version newer than that pull request named, and were tested as installed.
- **For anyone running the portal locally in developer mode.** A confirmation message now appears twice (for example, after changing an email address). It still appears once on the live site. This is a side effect of the notification library's update and is harmless.

#### Known Limitations

- 2 high and 23 moderate advisories remain in supporting tools.
- The form library is held at 7.86.0 until the ruling above.
```

## Per-Phase Status row

| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-11-02 |

## Handoff

The orchestrator:

1. Pins `react-hook-form` exactly and adds the Dependabot ignore.
2. Re-runs `npm ci` and `hydration-gate.test.tsx`.
3. Writes the TODO changes, the release note and this section into the work-log.
4. Merges `main`, opens the PR, and gets CI green.
5. Closes #71, and at cleanup deletes the Neon branch.

If the pin changes more than `package.json` and the lockfile's root entry, send it back to QA.

Files: `/Users/cshenso/git/presby-platform/presby-deps/docs/work-log/2026-11-01-deps-minor-patch.md`, `/Users/cshenso/git/presby-platform/presby-deps/package.json` (line 80), `/Users/cshenso/git/presby-platform/presby-deps/.github/dependabot.yml`, `/Users/cshenso/git/presby-platform/presby-deps/docs/TODO.md` (lines 155, 188, 213, 659), `/Users/cshenso/git/presby-platform/presby/docs/release-notes/v0.54.md`.

### Orchestrator: follow-up 1 applied (2026-11-02)

`package.json` pins `react-hook-form` to exactly `7.86.0`. The lockfile changes only its root entry, one line, edited by hand: a `--package-lock-only` regeneration added about 60 unrelated optional entries and was discarded. `.github/dependabot.yml` ignores `react-hook-form`, with a comment pointing at the TODO ruling line. Verified with a clean `npm ci` (resolves 7.86.0), `npm ls --all` exit 0, and `hydration-gate.test.tsx` 10/10. TODO lines, the release note and the main merge come at integration, after 0.54.1 and 0.54.2 land.
