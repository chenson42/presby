# E2E Owns Its Test Users — Work Log

> **Slug:** `2026-08-18-e2e-owns-its-users`
> **Surface:** test infrastructure only (`e2e/`, CI workflow, `.env.example`)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Bug-fix variant — the defect is a suite that reports success
> without running. Phase 2 skipped (no app dependency, no app directory, no
> runtime boundary changed).

> **Agent note:** operator instruction in effect not to spawn subagents; phases
> executed inline.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (inline) | Complete | READY FOR DESIGN | 2026-08-18 |
| 2 — Architectural review | architect | Skipped — test infra only | — | 2026-08-18 |
| 3 — Technical design | tech-lead (inline) | Complete | — | 2026-08-18 |
| 4 — Implementation | full-stack-developer (inline) | Complete | — | 2026-08-18 |
| 5 — Verification | qa (inline) | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst (inline) | Complete | SHIP IT | 2026-08-18 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> `npm run test:e2e` exits 0 after running 6 of 48 specs when six environment
> variables are unset, so the suite that guards the auth path can pass without
> testing the auth path.

## The bug

Authenticated specs need a signed-in session. `globalSetup` acquires one per
role and caches it as `storageState`; the sign-in credentials came from
`SEED_ADMIN_EMAIL` / `SEED_MEMBER_EMAIL` / `SEED_MFA_ADMIN_EMAIL` and their
passwords. When those are unset:

1. `globalSetup` logs `Skipping "<role>": env vars not set.` and writes no session
2. every authenticated spec re-checks the same variables and calls `test.skip()`
3. Playwright counts skips as not-failures and exits **0**

Observed on this machine, 2026-08-18: `42 skipped, 6 passed`, exit 0.

**Why it matters here specifically.** CLAUDE.md's Phase 5 gate requires, for any
auth-touching change, an e2e run against a real dev server *including an
MFA-enrolled user*, and states that a deferred e2e check is `BLOCKED`, never
`PASS`. A suite that silently shrinks lets that gate be satisfied by a run in
which the auth specs never executed. The v0.7.0 notes cite "48/48"; the same
command today yields 6. The next work queued — the `next-auth` beta.32 upgrade
for two critical advisories — is precisely the change that depends on those
specs.

There is a second copy of the same failure mode in CI: the E2E workflow is
gated on `NEON_API_KEY` / `NEON_PROJECT_ID` and, without them, skips the
Playwright job while reporting **success**.

## The decision (operator, 2026-08-18)

> "for e2e i don't think we need environment variables for users. we should just
> hard code them into the tests as we setup the test data"

Correct, and it fixes the cause rather than the symptom: if the fixture owns its
users, there is no configuration to be missing, so there is nothing to skip.

## What "owns its data" means here, precisely

- **Test users are test data.** Identities and passwords become constants in
  `e2e/support/users.ts`, and the fixture provisions them into the database at
  the start of the run.
- **Roles and features are application catalog data**, and stay with
  `scripts/seed.ts`. The e2e seeder binds users to the `admin` / `member` roles;
  it does not invent the role catalog. If the roles are absent it fails with an
  actionable message rather than silently producing a user with no permissions.

That line matters: a fixture that also seeds the permission catalog would let a
spec pass against a catalog that does not match production.

## Safety, given a public repo

A committed test password is not a real credential, and the repo already
documents one (`docs/STATE.md` publishes the local dev sign-in). The guards that
keep it harmless:

- every fixture email ends in `@example.invalid` — the seeder **refuses** to
  write a user whose address does not, so this code can never touch a real
  account even if pointed at the wrong database
- the existing DB isolation guard still runs first (dedicated `E2E_DATABASE_URL`,
  or explicit `E2E_ALLOW_SHARED_DB=true`, or CI hard-block)

## Gaps the Request Didn't Address

- **The skip must become a failure.** Removing the env vars removes the *reason*
  to skip, but leaving `test.skip()` calls behind would let the pattern grow
  back. They are deleted, not rewired.
- **CI's own silent skip** is the same defect one layer up. Out of scope for this
  pipeline (it needs the Neon secrets decision) but recorded in `docs/TODO.md`.

## Out of Scope

- `scripts/seed.ts` keeps its `SEED_*` env-driven local-admin path. That exists so
  a human can log in locally; it is no longer load-bearing for e2e.

## Open Questions

None.

---

# Phase 2 — Architectural Review (architect)

**Skipped.** Test infrastructure only: no application dependency, no new app
directory, no runtime boundary moved, no schema change.

---

# Phase 3 — Technical Design (tech-lead)

## Files to Create

- `e2e/support/users.ts` — the fixture roster: role key, email, password, display
  name, role binding, and `twoFactorRequired`. Also the single
  `storageStatePath()` helper, currently copy-pasted into five specs.
- `e2e/support/seed-users.ts` — provisions the roster. Raw SQL over
  `@neondatabase/serverless` plus `bcryptjs`, matching the driver
  `cleanupTestFeedback` already uses, so `e2e/` never imports application modules.

## Files to Modify

- `e2e/support/global-setup.ts` — seed, then acquire all three sessions
  unconditionally; no env-var branch; feedback cleanup keyed off the roster
- 10 spec files — import the roster; delete every `test.skip()` credential guard
  and every `HAVE_*` constant
- `.github/workflows/e2e.yml` — drop the six generated `SEED_*` lines
- `.env.example` — reframe the `SEED_*` block as the optional local-human login

## Seeder Behavior

Per user, idempotent:

1. assert the email ends in `@example.invalid`, else throw
2. upsert on the unique `email`: bcrypt password, `email_verified = now()`,
   `is_active = true`, `two_factor_required` per the roster, and reset
   `failed_login_attempts` / `locked_until` (a lockout from a previous run must
   not leak into this one)
3. bind the role via `user_roles ... ON CONFLICT DO NOTHING`
4. for `mfa-admin`, delete any `user_totp` and pending-enrolment rows so the
   "redirect to enrol" assertion is deterministic

## Edge Cases & Risks

- **Stale `storageState`.** The 12-hour freshness cache is kept, but a re-seed
  now happens every run; passwords are constant, so a cached session stays valid.
- **Rate limiting.** Three sign-ins per cold run still need `RATE_LIMIT_DISABLED=true`
  locally; unchanged from today.
- **Lockout bleed.** Explicitly cleared in step 2 — previously a failed spec could
  lock the shared admin and poison the next run.

## Implementer

full-stack-developer (inline).

---

# Phase 4 — Implementation

## Files Created

- `e2e/support/users.ts` — the fixture roster plus the shared `storageStatePath()`
  helper that five specs had each copy-pasted
- `e2e/support/seed-users.ts` — provisioning, idempotent, raw SQL + bcryptjs

## Files Modified

- `e2e/support/global-setup.ts` — seeds, then acquires all three sessions with no
  conditional branch; feedback cleanup keyed off the roster; new rate-limiter
  precondition (below)
- 10 spec files — roster imports; every `test.skip()` credential guard and every
  `HAVE_*` constant deleted
- `playwright.config.ts` — `webServer.env` sets `RATE_LIMIT_DISABLED`
- `.github/workflows/e2e.yml` — six generated `SEED_*` lines removed
- `.env.example` — member and MFA seed blocks removed (nothing reads them now);
  the admin block reframed as the optional local human login

## Two defects found by running it

Neither was in scope; both were only visible once the specs actually executed.

**1. The rate limiter makes a blocked sign-in look like a wrong password.**
`src/auth.ts:136` caps credentials sign-in at 5/min per `ip:email` and returns
`null` when exceeded — before the password check. The UI renders "Wrong email or
password" and `failed_login_attempts` stays at **0**. Six specs failed this way,
and the on-screen error actively misdescribed the cause. Two mitigations:
`playwright.config.ts` now sets `RATE_LIMIT_DISABLED` for a server Playwright
starts, and `globalSetup` refuses to run without it, naming the symptom so nobody
else debugs a phantom credential problem.

**2. Both 2FA pages crash when `AUTH_TOTP_ENCRYPTION_KEY` is unset.**
`/account/2fa` and `/admin/2fa` throw `AUTH_TOTP_ENCRYPTION_KEY is not set` as an
unhandled runtime error. Every other optional integration in this codebase
degrades gracefully — Turnstile no-ops without keys, Resend logs to stdout — but
this one takes the page down. Logged to `docs/TODO.md`; it belongs to the 2FA
work, not here.

## Local environment changes (operator's machine, not the repo)

`.env.local` is gitignored; two lines were added to make the suite runnable:
`RATE_LIMIT_DISABLED=true` and a freshly generated `AUTH_TOTP_ENCRYPTION_KEY`.
Generating the key was safe because nothing could have been enrolled without one
— encryption would have thrown.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-18
**Verified by:** qa (inline)

## Type Check / Lint

`npm run typecheck`: PASS · `npx eslint e2e/`: PASS

## Unit Tests

424 passed, 0 failed.

## End-to-End Tests

**48 passed, 0 failed, 0 skipped** (40.9s), against a real dev server, with **no
`SEED_*` variables set** — the exact condition that produced 6-passed/42-skipped
before this change.

Progression across the session, all with the same empty configuration:

| Run | Result |
|---|---|
| Before the change | 6 passed, **42 skipped**, exit 0 |
| After, missing role catalog | **hard failure** naming `npm run db:seed` |
| After, rate limiter on | 42 passed, 6 failed |
| After, missing TOTP key | 46 passed, 2 failed |
| Final | **48 passed** |

The second row is the point of the whole change: a missing prerequisite now
stops the run and says what to do, instead of quietly shrinking the suite.

## Regression Coverage

The change *is* the regression coverage — 42 specs that could previously
self-disable now cannot. There is no configuration left to omit.

## Feature-Gate Audit

No protected routes touched. No route handler, server action, or permission
check was modified.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> The suite provisions its own users and runs all 48 specs from a clean checkout
> with no configuration, and every prerequisite it still has now fails loudly
> and says what to do.

## Intent-vs-Shipped Diff

- Phase 1 said: hardcode the users, seed them in the fixture, delete the skips.
  Shipped: that, plus a rate-limiter precondition and a `playwright.config.ts`
  change that Phase 1 did not anticipate — both forced by defects that only
  appeared once the specs actually ran. Verdict: acceptable drift, and the
  drift is the evidence the change was worth making.

## Edge Cases

- Missing role catalog: hard failure with the fix named — verified
- Missing rate-limit flag: hard failure with the symptom explained — verified
- Re-run with warm cache: storageState reused, no re-seed drift — verified
- Fixture email guard: `@example.invalid` enforced in `seed-users.ts` — unit of
  code read, not exercised (it would require deliberately breaking the roster)

## Follow-Ups

- `AUTH_TOTP_ENCRYPTION_KEY` crash → `docs/TODO.md`, for the 2FA work
- CI's own silent skip (E2E workflow reports success when the Neon secrets are
  absent) → already tracked in `docs/TODO.md`
