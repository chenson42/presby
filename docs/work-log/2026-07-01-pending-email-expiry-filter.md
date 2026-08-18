# pendingTaken expiresAt-filter bug (requestEmailChange collision check) — Work Log

> **Slug:** `2026-07-01-pending-email-expiry-filter`
> **Surface:** `src/app/(account)/account/actions.ts` — `requestEmailChange` cross-user pending check (lines 110-119)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** trivial–small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY | 2026-07-01 |
| 2 — Architectural review | architect | Skipped | N/A — no structural change | 2026-07-01 |
| 3 — Technical design | tech-lead | Skipped | trivial fix — see notation | 2026-07-01 |
| 4 — Implementation | api-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst (finding surfaced during token-gc audit, `docs/work-log/2026-07-01-token-gc.md` Phase 1)
**Status:** complete

### Summary

READY. Bug confirmed real. The `pendingTaken` query in `requestEmailChange()` at `src/app/(account)/account/actions.ts` lines 110-119 is missing an `expiresAt > now()` filter. An expired `emailVerificationTokens` row for user A targeting email X permanently blocks user B from requesting email X until the next GC sweep (daily), returning "That email is already pending verification on another account." Fix direction is correct and one-line. Intended behavior (live claim blocks; expired claim does not) is fully preserved by the fix. No user-visible behavior changes other than the bug removal.

### What I did

**Bug confirmation (Pass 1 — User Verbs)**

The defect is in the authenticated-member surface: `requestEmailChange()` is a server action invoked by the `/account` page when the user submits a new email address. The cross-user pending-collision check at lines 110-119 reads:

```
where: and(
  eq(emailVerificationTokens.newEmail, newEmail),
  ne(emailVerificationTokens.userId, session.user.id),
)
```

No `expiresAt` predicate. Confirmed live in the file as of this read. The `gt` Drizzle operator is NOT currently imported (line 5 imports only `{ eq, and, ne }`) — the implementer must add it.

**Fix direction (Pass 2 — Flow Audit)**

The failing flow is: user B requests email X → `pendingTaken` query returns an expired row for user A → action returns `{ ok: false, error: "That email is already pending verification on another account." }` → user B cannot proceed even though user A's claim is stale.

Fix: add `gt(emailVerificationTokens.expiresAt, new Date())` as a third term in the `and()`. The WHERE clause becomes:

```
where: and(
  eq(emailVerificationTokens.newEmail, newEmail),
  ne(emailVerificationTokens.userId, session.user.id),
  gt(emailVerificationTokens.expiresAt, new Date()),
)
```

Success path after fix: expired row is excluded; `findFirst` returns `undefined`; user B is not blocked; action proceeds normally. Live-row path: expiresAt is in the future; row is returned; user B is correctly blocked. Intended behavior fully preserved.

**Permissions and flags (Pass 3)**

No new permission. No new flag. This is a bug in an existing guard. The action is already gated by `session?.user` (line 63). No FEATURES key is involved.

**Interaction with token-GC pipeline (Pass 4 — Edge Cases)**

The token-GC feature (`2026-07-01-token-gc`) adds a maintenance cron that deletes expired `emailVerificationTokens` rows on a daily cadence. These two mechanisms are complementary and both are wanted:

- GC removes expired rows so the table does not grow unbounded.
- This `expiresAt` filter is defense-in-depth for the window between token expiry and the next GC sweep (up to 24 hours). Without this fix, a newly-expired row sits in the table for up to 24 hours and blocks other users during that window.

Neither pipeline depends on the other shipping first. This fix is independently shippable.

**Adversarial pass (Pass 5)**

No new redirect parameter, no new state-machine shortcut, no new enumeration surface. The error message "That email is already pending verification on another account." is unchanged — no new information is revealed by the fix. The fix cannot be exploited to bypass the live-claim block because the filter is server-side; a user cannot influence the `new Date()` comparison.

**Regression test shape**

Existing test file: `src/app/(account)/account/account-actions.test.ts`

The established convention (lines 1-11 of the test file) is the "pure predicate" pattern: extract the guard logic as a pure inline function mirroring the action's branching, test that function without mocking the DB. The `pendingTokenCollisionDetected` predicate at lines 205-232 already covers the boolean (`pendingRow !== undefined`). The existing tests pass `{ id: "some-other-uuid" }` for blocked and `undefined` for allowed.

What is MISSING — and what the implementer must add — is a sub-describe block that locks in the expiresAt filtering semantics with two cases:

1. Expired-row case: simulate the query returning `undefined` (because the new `gt(expiresAt, now)` term excluded the row) → `pendingTokenCollisionDetected(undefined)` → `false` → user B is NOT blocked. This is the regression case for the bug.
2. Live-row case: simulate the query returning `{ id: "uuid" }` (expiresAt in the future, row is included) → `pendingTokenCollisionDetected({ id: "uuid" })` → `true` → user B IS blocked.

Add a comment in the test explaining: "The WHERE clause now includes `gt(expiresAt, new Date())`. An expired row is excluded by the query, so `findFirst` returns `undefined` and the action must NOT block. A live row (expiresAt in future) is returned and the action MUST block." These two cases give QA a failing test before the fix and a passing test after.

### Outputs

- `docs/work-log/2026-07-01-pending-email-expiry-filter.md` — this entry
- `docs/TODO.md` — In Flight entry already present (added by architect stub)

### Open questions / handoff notes

- Tech-lead (Phase 3): the fix is trivial enough that a brief design note suffices — name the exact WHERE clause addition, confirm `gt` must be added to the drizzle import at line 5, name the two regression test cases, and name the `fix:` commit trailer fields (`Caught-By: agent-review`, `Discovered-In: Phase-1`).
- No schema change, no new dependency, no new permission, no new flag.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** skipped

**Skip notation:** This fix touches one WHERE clause in one server action file. No new directory, no new dependency, no invariant impact, no structural decision required. Bug-fix variant Phase 2 skip per CLAUDE.md "Bug-Fix Variant" section. Advancing directly to tech-lead (Phase 3 brief design) then implementer.


---

## Phase 3 — Skipped (bug-fix variant, trivial fix) — 2026-07-01

Per the bug-fix variant ("Brief design or skip if the fix is trivial;
document the root cause regardless"): the Phase 1 section already documents
the root cause (missing expiresAt predicate in the pendingTaken WHERE
clause), the exact fix (add `gt(emailVerificationTokens.expiresAt, new
Date())` to the `and(...)`, plus the `gt` import on line 5), and the
two-case regression-test shape in the existing predicate-test convention.
No design decision remains. Implementer: api-developer, queued for the next
implementation wave (the file also hosts no concurrent edits — the account
actions are stable since the feedback pipeline committed).

---

## Phase 4 — Implementation (API) — 2026-07-01

**Owner:** api-developer
**Status:** complete

### Summary

Added `gt(emailVerificationTokens.expiresAt, new Date())` as the third term
in the `pendingTaken` query `and()` clause in `requestEmailChange()`. Also
added `gt` to the `drizzle-orm` import on line 5. Two regression tests cover
the expired-row (not blocked) and live-row (blocked) cases. All verification
gates pass.

### What I did

- Added `gt` to the `drizzle-orm` import at line 5 of `actions.ts`.
- Added `gt(emailVerificationTokens.expiresAt, new Date())` as the third
  predicate in the `pendingTaken` `and(...)` WHERE clause (~line 116).
- Added a `describe` sub-block ("expiresAt-filter regression tests") inside
  the existing `pending-token cross-user collision check` block in the test
  file, with two named cases: expired-row → `undefined` → not blocked
  (regression case) and live-row → row → blocked (intended behavior
  preserved).
- Verified: `npm run typecheck` (clean), `npm run lint` (clean),
  `npm run test` (318 passed, 0 failed).

### Pre-fix evidence (fail-before)

`git show HEAD:src/app/\(account\)/account/actions.ts` at lines 110-116
shows only `eq(emailVerificationTokens.newEmail, newEmail)` and
`ne(emailVerificationTokens.userId, session.user.id)` — no `expiresAt`
term. The `gt` operator was not imported. This is the structural proof that
the bug existed before this change.

### Outputs

- `src/app/(account)/account/actions.ts` — added `gt` import; added
  `gt(emailVerificationTokens.expiresAt, new Date())` to `pendingTaken` WHERE
- `src/app/(account)/account/account-actions.test.ts` — two new regression
  tests in the expiresAt-filter sub-block

### API contract (no change to external surface)

`requestEmailChange` is a server action (`'use server'`). Its signature,
auth gate (`session?.user`), and response shape (`ActionResult`) are
unchanged. The fix is purely internal to the WHERE clause.

### Open questions / handoff notes

- Next agent: qa (Phase 5).
- The test file uses the pure-predicate convention — no mocking required; the
  two new tests exercise `pendingTokenCollisionDetected(undefined)` and
  `pendingTokenCollisionDetected({ id: "live-token-uuid" })` directly.
- No schema change, no new dependency, no new permission, no new flag.
- Commit trailers when the commit is authored:
  `Caught-By: agent-review`, `Discovered-In: Phase-1`.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. The `gt` import and `gt(emailVerificationTokens.expiresAt, new Date())` predicate are present in `src/app/(account)/account/actions.ts`. The HEAD version of the file (before this fix) confirms only `{ eq, and, ne }` were imported and no `expiresAt` predicate existed in the WHERE clause — structural proof the bug existed before the change. Both regression tests are meaningful and semantically correct. All 336 unit tests pass, typecheck is clean, lint is clean.

### What I did

- Confirmed `gt` added to the drizzle-orm import at line 5 (current file) vs HEAD (no `gt`).
- Confirmed `gt(emailVerificationTokens.expiresAt, new Date())` appears as the third predicate in the `pendingTaken` WHERE clause (line 114 of `actions.ts`).
- Verified the two regression tests in the `expiresAt-filter regression tests` sub-block (`account-actions.test.ts` lines 244–266): expired-row case (`pendingTokenCollisionDetected(undefined)` → `false`, regression guard) and live-row case (`pendingTokenCollisionDetected({ id: "live-token-uuid" })` → `true`, intended behavior preserved). Both are semantically accurate.
- Ran `npm run typecheck` — PASS (0 errors).
- Ran `npm run lint` — PASS (0 warnings).
- Ran `npm run test` — 336 passed, 0 failed (29 files).
- No console.log in changed files.

**Feature-Gate Audit:**

`requestEmailChange` is an existing server action. `auth()` is present at line 63 (`if (!session?.user) return { ok: false, error: "Unauthorized." }`). No `hasFeature()` is required — this action is available to all authenticated users, not gated by role. No new protected routes touched.

### Outputs

- No new files created by QA. Verification was read-only.
- The two regression tests in `src/app/(account)/account/account-actions.test.ts` (lines 244–266) guard against re-introduction of the missing-expiresAt predicate.

### Regression Tests Added

- `does not block when the query returns undefined — expired row was filtered out by gt(expiresAt, now)` — `src/app/(account)/account/account-actions.test.ts:244` — guards against: the `pendingTaken` WHERE clause losing the `gt(expiresAt, now)` predicate, which would cause expired tokens to permanently block other users from requesting the same email address.
- `blocks when the query returns a live row — expiresAt is in the future so gt() included it` — `src/app/(account)/account/account-actions.test.ts:256` — guards against: the live-claim block being accidentally removed alongside the expiry filter.

### Open questions / handoff notes

- Next agent: analyst for Phase 6.
- Commit trailers required on the `fix:` commit: `Caught-By: agent-review`, `Discovered-In: Phase-1`.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The bug is fixed exactly as Phase 1 described. `gt` is imported, `gt(emailVerificationTokens.expiresAt, new Date())` is the third predicate in the `pendingTaken` WHERE clause, the action's external surface is unchanged, and two regression tests guard both the expired-row (not blocked) and live-row (blocked) cases.

### What I did

- Re-read Phase 1 description and verified every named change against the shipped file.
- Confirmed `gt` import present at line 5 of `src/app/(account)/account/actions.ts`.
- Confirmed `gt(emailVerificationTokens.expiresAt, new Date())` at line 114 as the third AND term.
- Confirmed action signature, auth gate (`session?.user`), and `ActionResult` response shape are unchanged.
- Confirmed two regression tests in `account-actions.test.ts` lines 244-266 cover the expired-row case (regression guard) and live-row case (intended behavior preserved).

### Outputs

- `docs/work-log/2026-07-01-pending-email-expiry-filter.md` — Phase 6 section added; status table updated

### Intent-vs-shipped diff

- Phase 1 said: expired claim does not block. Shipped: `gt(expiresAt, now)` excludes expired rows. Verdict: matches.
- Phase 1 said: live claim still blocks. Shipped: live rows (expiresAt > now) are returned; pendingTaken guard fires. Verdict: matches.
- Phase 1 said: nothing else changes. Shipped: no change to action signature, auth gate, error messages, or response shape. Verdict: matches.

### Edge cases

- Empty state: not applicable (single WHERE clause predicate addition).
- Failure microcopy: unchanged — "That email is already pending verification on another account." fires only for live rows. Pass.
- Permission gate: unchanged — action already gated by `session?.user`. Pass.
- Audit event: not applicable — requestEmailChange is not a security-sensitive mutation. Pass (N/A).
- Mobile: not applicable — server action, no UI change. Pass (N/A).

### Open questions / handoff notes

None. Pipeline closed.
