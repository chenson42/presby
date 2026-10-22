# Remove the `npm run db:seed` hint from `/signin` — Work Log

> **Slug:** `2026-10-22-signin-seed-hint`
> **Surface:** (auth)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish — Phases 2 and 3 skipped (a four-line copy removal: no new dependency, no structural change, no schema or API change)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (carried) | READY WITH NOTES | 2026-10-21 |
| 2 — Architectural review | architect | Skipped | — | 2026-10-22 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-10-22 |
| 4 — Implementation | orchestrator | Complete | — | 2026-10-22 |
| 5 — Verification | qa | Complete | BLOCKED (stale node_modules), cleared by orchestrator re-run → PASS | 2026-10-22 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (carried)

Carried from `docs/work-log/2026-10-21-review-polish.md` Phase 1 gap 6 / Q11: the analyst found that `/signin` shows "First time? Run `npm run db:seed` to provision the seeded admin user." to every visitor whenever local login is on, production included, and asked the operator to rule rather than fix it silently. **Operator ruling (2026-10-22): remove it.** The other half of gap 6 (no message for OAuth failures such as `AccessDenied`) is not ruled and stays a `docs/TODO.md` line.

# Phase 2 — Skipped

Skipping Phase 2 — no new dependency, no new directory, no structural change, no invariant touched.

# Phase 3 — Skipped

Skipping Phase 3 — the change is the deletion of one `<p>` element; there is nothing to design.

# Phase 4 — Implementation (orchestrator)

- `src/app/(auth)/signin/page.tsx`: deleted the `<p>` carrying the `npm run db:seed` hint under `SignInCredentialsForm`. No test referenced the text.
- `docs/TODO.md`: the operator-decision line now carries only the OAuth-failure half; the review-polish checklist line drops the sender-name check (the operator confirmed the production sender name is PresbyPortal, 2026-10-22); a new Deployment line asks the operator to set `RESEND_WEBHOOK_SECRET` (the production endpoint answered "Webhook not configured" on 2026-10-22); a Done entry for this change.
- Operator rulings recorded in the same branch (2026-10-22, "go with recommendations"): keep the platform blue on the email button; keep Google's official button style; the "test organization" marker's defaults (see `docs/TODO.md`); `RESEND_WEBHOOK_SECRET` set in Vercel Production by the orchestrator from the value the operator supplied.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-22
**Verified by:** qa

## Type Check

`npm run typecheck`: **FAIL (environment, not the diff).** 7 errors, all `TS2307 Cannot find module 'stripe'` / `'pdfkit'` in `src/lib/giving/**`, plus one implicit-any that follows from those (`src/lib/giving/providers/stripe/client.ts:288`). `package.json` declares `stripe` 23.0.0, `pdfkit` 0.20.2 and `@types/pdfkit` 0.17.6, but none of them are in `node_modules`. The installed tree is older than the giving merge. The diff doesn't touch `package.json` or any giving file.

Lint: PASS (`--max-warnings=0`). `npm run check`: all eight tripwires PASS.

## Unit Tests

Total: 9225 | Passed: 7196 | Failed: 11 (plus 4 suites that would not load) | Skipped: 2018 | Duration: 23.7s
Failures: every one is `Cannot find package 'stripe'` or `'pdfkit'`:
- `src/lib/giving/statements/render-pdf.test.ts`: 11 tests
- `src/app/api/webhooks/stripe/route.test.ts`, `src/lib/giving/providers/stripe/client.test.ts`, `src/lib/giving/providers/stripe/testing/sign-event.test.ts`, `src/app/(org)/o/[slug]/admin/giving/statements/print/route.test.ts`: the suites would not load

The 2018 skips (67 files) are the DB-backed subset. `npx vitest run` skips them by design; they run under `npm run test:db`, which was not in scope here.

## End-to-End Tests

Total: 43 | Passed: 43 | Failed: 0 | Skipped: 0 | Duration: 2.2m

- **How it ran:** against a real dev server on `:3700` with `RATE_LIMIT_DISABLED=true`, the `DOMAINS_*` fakes, `CRON_SECRET` and `E2E_ALLOW_SHARED_DB=true`, on the shared `development` branch.
- **Fixtures:** globalSetup provisioned 11 fixture users, including the MFA-enrolled `admin-2fa-enrolled@presby.invalid`.
- **Specs:** `branded-signin`, `totp-full-login` (password, then TOTP with a wrong code rejected, then signed in), `totp-callback-bypass`, `totp-code-entry`, `totp-recovery-code`, `post-login-routing` and `hydration/totp-challenge`. No hydration spec targets `/signin` itself.
- **Rendered `/signin`:** the page from `:3700` has 0 matches for `db:seed`, `First time` or `seeded admin`. The credentials form (password field, Forgot link) and the Google button are still there.
- **Nothing else changed:** the source diff to `src/app/(auth)/signin/page.tsx` is 5 deleted lines (the `<p>` and the blank line before it), with nothing added.
- **Server shutdown:** stopped by PID (99775, 99792–99794, 99796–99797); port 3700 confirmed free.

## Regression Tests Added

None, and none needed: this is a polish change that removes copy, not a bug fix. No spec referenced the hint text. Optional hardening, not a gap: nothing asserts that the hint stays gone.

## Coverage on Critical Modules

Not measured. `permissions.ts`, `two-factor.ts` and `flags.ts` are untouched by this diff.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| no protected routes touched | n/a | n/a | n/a |

## Verdict

**BLOCKED.** The unmet prerequisite is installed dependencies: `node_modules` is missing `stripe`, `pdfkit` and `@types/pdfkit`. Because of that, `npm run typecheck`, the pure Vitest suite and `npm run build` all fail (Turbopack: `Can't resolve 'pdfkit'`, `Can't resolve 'stripe'`). None of those failures can come from this diff, but a typecheck or build that doesn't run can't be counted as a pass.

The auth gate itself is satisfied: real dev server, MFA-enrolled seeded user, full login path, 43 of 43 specs green.

**To clear it:** the orchestrator or operator runs `npm ci`, then re-runs `npm run typecheck`, `npx vitest run` and `npm run build`. If those pass, this becomes PASS with no further e2e work needed. If `npm ci` hits the npm 10.8.2 `edgesOut` bug recorded in memory, install the three packages by name.

---

**Per-Phase Status row:**

| 5 — Verification | qa | Blocked | BLOCKED (`node_modules` missing `stripe`/`pdfkit`; typecheck, vitest, build cannot pass) | 2026-10-22 |

**Handoff:** to the orchestrator/user to reinstall dependencies and re-run the three blocked checks. If they come back green, the verdict becomes PASS and the next agent is **analyst (Phase 6)**. If the diff is implicated after all, it goes back to the orchestrator as the Phase 4 implementer.

Logs are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/`: `tc.log`, `vitest.log`, `e2e.log`, `build.log`, `signin.html`.

## Orchestrator note: BLOCKED cleared (2026-10-22)

The block was the main checkout's stale `node_modules` (installed before the giving merge added `stripe`/`pdfkit`). `npm ci` in `/Users/cshenso/git/presby-platform/presby`, then: `npm run typecheck` PASS; `npx vitest run` 492 files passed, 67 skipped, 7263 tests passed, 0 failed; `npm run build` PASS. QA's own criterion ("If those pass, this becomes PASS with no further e2e work needed") is met. **Phase 5: PASS.**
