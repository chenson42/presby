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
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Skips, stated:** Phases 1–3 are skipped because there is no new behaviour to refine or design. The versions are fixed by Dependabot PR #71, which the operator asked to merge on 2026-11-01. Any behaviour change a bump causes is a Phase 4 finding. A finding that needs a design decision promotes this to a Feature at that point.

## Why our own branch, not #71

- **#71's lockfile does not install.** Its CI failed at `npm ci` ("typecheck + build", step "Install dependencies", run 41243644413).
- **#71 can't be fully tested in CI.** Dependabot PRs receive no repository secrets, so its DB, `test-rls.sql` and Playwright jobs were all skipped.

This branch applies the same target versions, regenerates the lockfile, and runs every gate. CI on our own PR has the Neon secrets. #71 is closed in favour of this PR.

## Target versions (from #71)

`@hookform/resolvers` 5.9.2 · `@neondatabase/serverless` 1.2.0 · `@radix-ui/react-alert-dialog` 1.2.1 · `@radix-ui/react-avatar` 1.3.1 · `@radix-ui/react-dialog` 1.3.1 · `@radix-ui/react-dropdown-menu` 2.2.1 · `@radix-ui/react-label` 2.1.17 · `@radix-ui/react-slot` 1.5.0 · `@radix-ui/react-switch` 1.4.1 · `@upstash/ratelimit` 2.2.0 · `@upstash/redis` 1.40.0 · `drizzle-orm` 0.45.4 · `lucide-react` 1.63.0 · `mermaid` 11.17.2 · `next` 16.4.3 · `otplib` 13.5.0 · `react` / `react-dom` 19.3.1 · `@types/react` / `@types/react-dom` 19.3.0 · `react-hook-form` 7.91.0 · `resend` 6.35.0 · `sonner` 2.0.8 · `stripe` 23.0.1 · `tailwind-merge` 3.7.0 · `ws` 8.22.0 · `@types/ws` 8.18.2 · `@playwright/test` 1.64.1 · `@tailwindcss/postcss` 4.3.3 · `@tailwindcss/typography` 0.5.20 · `@testing-library/dom` 10.4.2 · `@testing-library/react` 16.3.3 · `@types/node` 20.19.43 · `@types/pdfkit` 0.17.7 · `@vitest/coverage-v8` / `vitest` 4.1.12 · `dotenv-cli` 11.1.0 · `drizzle-kit` 0.31.11 · `eslint-config-next` 16.4.3 · `tailwindcss` 4.3.3 · `tsx` 4.23.15

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

Also seen: the first `test:db` attempt stalled for 35 minutes with no output (the build was running in parallel on the same machine); I killed it by PID and the second, serial-only run completed. Treat that as environment, but if QA sees a hang, suspect `@neondatabase/serverless` 1.2.0 / `ws` 8.22.0.

### Audit

`npm audit` high advisories, before to after: **3 to 2**.
- Before: `brace-expansion`, `undici`, `vite`. Total 31 (2 low, 26 moderate, 3 high).
- After: `brace-expansion`, `undici`. Total 27 (2 low, 23 moderate, 2 high). `vite` cleared by the vitest bump.
- `npm audit --audit-level=moderate` still exits non-zero (the 2 high and 23 moderate remain, transitive). Resolving them is outside a minor-and-patch bump.

### For QA: riskiest surfaces

1. **The `react-hook-form` hold** and the ruling it needs; do not mark the hydration twin as a pass by editing it.
2. **Auth by runtime**: `otplib` 13.5 (TOTP verify, enrol, recovery), `next` 16.4.3 (proxy, 2FA claim), `@neondatabase/serverless` 1.2.0 with `ws` 8.22.0 (the WebSocket pool and the transaction-scoped RLS GUC).
3. **Radix dialogs, alert dialogs, dropdowns, switches, avatars** on a phone viewport (360 px); the e2e suite is desktop chromium.
4. **Reimbursement CSV export** timing (re-run alone).
5. **Email**: `resend` 6.35 (queue send and the invitation emails) has no live-send test here.
6. **Stripe 23.0.1** only through unit and fake-provider specs; no live API call.
7. **`mermaid` 11.17.2** on `/developer/data-model` (ER diagrams) and **`lucide-react`** icons, which only a browser look confirms.
8. The two pre-existing failures (community degrade copy, timezone-safe dates) are not caused by this branch and may deserve their own TODO lines.
