# BUG-3: First-time Google OAuth sign-in gets AccessDenied — Work Log

> **Slug:** `2026-07-01-oauth-first-signin-accessdenied`
> **Surface:** (auth) / src/auth.ts
> **Permission(s):** none — no permission change
> **Flag(s):** not needed
> **Estimated complexity:** small–medium (auth-touching — e2e gate applies)
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-07-01 |
| 2 — Architectural review | architect | Skipped | Skipped — no new deps, no new directories, no invariant change. Explicit notation below. | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named (api-developer) | 2026-07-01 |
| 4 — Implementation | api-developer | Complete | E2E blocked-on-coordination (BUG-2 Phase 4 still Pending) | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Bug Report (intake, 2026-07-01)

The `signIn` callback in `src/auth.ts:122-138` checks whether the signing-in
user is active by looking up `where eq(users.id, user.id)` and returning
`false` when no row is found. On a brand-new Google OAuth sign-in, Auth.js
runs the `signIn` callback **before** the adapter creates the user row, and
`user.id` at that point is Google's `sub` claim — so the lookup always misses
and every first-time OAuth user is rejected with `AccessDenied`. Returning
OAuth users (row already exists, id matches) are unaffected, which is why the
bug hides in day-to-day use of an already-provisioned dev database.

**Discovery trail:** surfaced by the 2026-07-01 sibling harvest
(`docs/reviews/2026-07-01-sibling-harvest.md` Tier 1 item 3), confirmed
independently by two downstream forks:
- explore.press commit `5cba011` — re-keys the check off the verified email:
  block only an *existing but inactive* user; treat "no row" as a brand-new
  user the adapter is about to create. Google supplies a verified email, so
  email is a safe key.
- huddleup.health — fuller provider-aware `sign-in-gate.ts` (103 lines,
  DI'd deps for unit tests): credentials look up by DB id, OAuth by
  verified-lowercased-email; also solves OAuth↔credentials account linking
  (first Google sign-in on an existing credentials email currently hits the
  same id-based miss). Backport kit §B3.

**Caveat to weigh in design:** the starter's id-based check was guarding
against a hard-deleted user re-creating themselves via OAuth. The starter's
delete-account is currently a stub (no hard delete), so that risk is
hypothetical today — but the fix should keep soft-deactivation
(`isActive=false`) as the block mechanism so the email-keyed check still
denies deactivated users.

**Auth-touching gate:** this fix modifies `src/auth.ts`. Per CLAUDE.md, Phase
4 cannot hand off to Phase 5 without a running-server e2e smoke covering the
full login path (including an MFA-enrolled user), and QA's PASS requires the
e2e suite against a real dev server. The seeded users from the
post-login-routing feature (`SEED_ADMIN_*`, `SEED_MEMBER_*`,
`SEED_MFA_ADMIN_*`) are available. Note: e2e cannot easily drive real Google
OAuth — the tech-lead must choose a strategy (unit-test the callback logic
with a DI'd or mocked lookup + e2e the credentials paths for regression, per
the huddleup pattern) and document it.

**Regression-test requirement (bug-fix variant):** a unit test of the signIn
callback that fails before the fix (new OAuth user → rejected) and passes
after (new OAuth user → allowed; deactivated user → still blocked).

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Bug confirmed real. The `signIn` callback in `src/auth.ts` performs a DB lookup keyed on `user.id`, but on a first-time Google OAuth sign-in Auth.js passes the raw Google profile whose `id` is the provider `sub` string — not a database UUID. The lookup misses, `!dbUser` is true, and the callback returns `false`, producing `AccessDenied` for every new OAuth user. The safe fix is to key the OAuth branch of the check off the verified email instead. Credentials sign-in is not affected.

### Bug Confirmed Real

**Callback-order evidence.** Auth.js v5 resolves an existing account link with `getUserByAccount` before invoking the `signIn` callback. If an account link already exists the adapter returns the linked DB user (UUID id) and the callback sees the correct id — this is why returning Google users are unaffected. When no account link exists (first sign-in), Auth.js passes the raw provider profile object directly to `signIn`, where `user.id` is Google's `sub` claim (e.g., `"117483729384657382910"`) — a string that will never match the UUID column. The lookup at `src/auth.ts:132–135` finds no row, hits `if (!dbUser) return false` at line 136, and rejects the user.

The inline guard at line 131 (`if (!user.id) return true;`) does not rescue the situation: Google always provides a `sub`, so `user.id` is always truthy for Google sign-ins. The comment ("brand-new OAuth user; adapter will create") names the right intent but the predicate does not express it.

**Credentials path.** The credentials `authorize()` function at lines 89–122 looks up the user by email and rejects if `!user.isActive` at line 111. The returned object carries the real DB UUID (`user.id = user.id`). When `signIn` is then called, `user.id` is that UUID, the DB lookup succeeds, and `dbUser.isActive` is `true` (since `authorize` already enforced it). The credentials path is not affected by this bug and does not need a fix.

### Behavior Contract

**(a) Deactivated users must be blocked on both providers.**
For credentials this is already enforced in `authorize()` before `signIn` is reached. For Google OAuth the email-keyed fix must still gate on `dbUser.isActive`: if a row exists at that email with `isActive = false`, return `false`. The fix does not weaken the deactivation block.

**(b) Brand-new OAuth users must be allowed through so the adapter can create them.**
An email-keyed lookup that returns no row (`dbUser = null`) means no prior user exists for this email. Return `true` and let the adapter create the row. This replaces the current `!dbUser → false` logic.

**(c) The "hard-deleted user re-creating via OAuth" risk is hypothetical.**
The delete-account action in `src/app/(account)/account/actions.ts` at line 279 is a confirmed stub: it writes an audit event and returns `ok: true` but performs no actual DB delete or deactivation. No user row is ever hard-deleted in the current codebase. The original comment in `signIn` framing `!dbUser → false` as a "privilege bypass" guard was therefore written against a risk that does not exist today. Soft deactivation (`isActive = false`) is the live mechanism and must be preserved.

### Scope Ruling: OAuth-to-Credentials Account Linking

`allowDangerousEmailAccountLinking: true` is already set on the Google provider (line 81). When a credentials-registered user signs in with Google for the first time, Auth.js will call `getUserByEmail`, find the existing row, then call `linkAccount` to attach the OAuth account. The email-keyed fix in `signIn` correctly allows this: it finds the existing active row by email and returns `true`. If the credentials user is deactivated it returns `false` — correct behavior.

Account linking is therefore in scope to the extent that the email-keyed fix must not break it, and it does not. There is no separate follow-up needed for the linking case; it is handled by the existing `allowDangerousEmailAccountLinking` setting and the email-keyed lookup.

### E2E Gate Note

This fix modifies `src/auth.ts`. Per CLAUDE.md, Phase 4 requires a running-server e2e smoke covering the full login path (including an MFA-enrolled user) before Phase 5 can begin, and QA's PASS requires that e2e suite to have run against a real dev server. Real Google OAuth cannot be driven by Playwright. The tech-lead must document the chosen test strategy. The recommended shape, validated by the huddleup reference implementation, is:

- Extract the `signIn` callback gate into a pure, DI'd function (takes a `findUser(email)` injected dependency). Unit-test all branches: new OAuth user allowed, deactivated OAuth user blocked, credentials user (by-id) allowed, credentials user deactivated (by-id) blocked.
- E2e covers the credentials login path (which is fully automatable) as the regression smoke.
- The Google OAuth path is covered by the unit tests on the extracted gate function.

### What I Did

- Read `src/auth.ts` in full and traced callback execution order for both providers.
- Confirmed the guard at line 131 does not protect against the bug (Google always provides a sub).
- Read `explore.press/src/auth.ts` lines 148–163 (commit 5cba011) for the email-keyed reference fix.
- Read `huddleup.health/web/src/lib/auth/sign-in-gate.ts` (103 lines) for the DI'd provider-aware reference fix.
- Read `src/app/(account)/account/actions.ts` lines 270–291 to confirm the delete-account stub (no hard delete implemented).
- Confirmed credentials path is unaffected by reading the `authorize()` flow end-to-end.

### Outputs

- `/Users/cshenso/git/claudecode/docs/work-log/2026-07-01-oauth-first-signin-accessdenied.md` — this Phase 1 section added; Per-Phase Status updated.

### Open Questions / Handoff Notes

Resolved in Phase 3 — see Phase 3 section below.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** Skipped
**Verdict:** Skipped with explicit notation

### Skip Justification

The fix adds one new file (`src/lib/auth/sign-in-gate.ts`) to a directory that already exists (`src/lib/auth/`) and adds one co-located test file. No new npm dependencies. No new route groups, no new schema tables, no new top-level directories, no changes to invariants defined in `CLAUDE.md`. The precedent for this pattern is `safe-callback.ts` (added in DECISION-013, Phase 3 only, no architect involvement). The fix is a behavior correction that modifies an existing callback and extracts its logic to a pure helper following an established `src/lib/auth/` pattern. Phase 2 is skipped.

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

The `signIn` callback in `src/auth.ts` (lines 127–138) uses an id-keyed DB lookup to block inactive users. On first-time Google OAuth sign-in, Auth.js passes the raw provider profile as `user`, where `user.id` is Google's `sub` string — never a DB UUID — so the lookup always misses and returns `false`. The fix extracts the gate logic into a pure, DI'd function (`src/lib/auth/sign-in-gate.ts`) that: for OAuth, looks up by verified email (allow on no row, block on inactive row); for credentials, returns `true` immediately (authorize() already enforced isActive). The `signIn` callback is reduced to a single call to `evaluateSignIn(...)`.

### What I Did

- Read `src/auth.ts` in full; confirmed exact line numbers of the bug (132–136).
- Read `src/lib/auth/` directory; noted the `safe-callback.ts` + `safe-callback.test.ts` DI'd-helper precedent.
- Read `docs/decisions.md`; confirmed highest decision is DECISION-014; appended DECISION-015.
- Chose huddleup DI'd shape over explore.press minimal inline shape (unit testability of OAuth branch).
- Ruled to drop the credentials belt-and-suspenders lookup (redundant with `authorize()`).
- Documented the soft-deactivation mandate and its constraint on the delete-account stub.
- Updated Per-Phase Status rows for Phases 2 and 3.

### Fix Shape

**New file: `src/lib/auth/sign-in-gate.ts`**

```typescript
export type GateUser = {
  id?: string | null;
  email?: string | null;
};

export type FindUserByEmail = (
  email: string
) => Promise<{ isActive: boolean } | null>;

/**
 * Gate function for the NextAuth signIn callback.
 *
 * OAuth branch (provider !== "credentials"):
 *   - no row (new user)   → true   (adapter will create the row)
 *   - row, isActive=true  → true
 *   - row, isActive=false → false  (deactivated; block)
 *   - no email from provider → false (fail-safe)
 *
 * Credentials branch:
 *   - returns true unconditionally.
 *   authorize() has already verified isActive and returned null if the user
 *   was inactive; NextAuth would not have called signIn if authorize()
 *   returned null. A second lookup here is a dead round-trip.
 *
 * @param provider        NextAuth provider id ("google", "credentials", etc.)
 * @param user            The user object from the signIn callback
 * @param findUserByEmail Injected DB lookup — takes lowercased email,
 *                        returns { isActive } or null
 */
export async function evaluateSignIn(
  provider: string,
  user: GateUser,
  findUserByEmail: FindUserByEmail,
): Promise<boolean> {
  if (provider === "credentials") {
    return true;
  }
  // OAuth path
  if (!user.email) return false; // fail-safe: no email, cannot key lookup
  const email = user.email.toLowerCase();
  const row = await findUserByEmail(email);
  if (row === null) return true;   // new user — let adapter create
  return row.isActive;             // existing user — honour isActive
}
```

**Modified: `src/auth.ts` — signIn callback**

Replace lines 127–138:
```typescript
async signIn({ user, account }) {
  return evaluateSignIn(
    account?.provider ?? "credentials",
    user,
    (email) =>
      db.query.users.findFirst({
        where: eq(users.email, email),
        columns: { isActive: true },
      }) ?? null,
  );
},
```

Note: `account?.provider` is the correct discriminator; NextAuth passes `account` as the second destructured prop in the `signIn` callback. The `eq(users.email, email)` lookup uses the already-lowercased email from `evaluateSignIn`. The `?? null` coercion handles `undefined` returns from `findFirst`.

### Credentials Redundancy Ruling

**Drop it.** The existing id-keyed check for credentials in `signIn` is redundant with `authorize()`. The `authorize()` function at lines 108–111 queries by email, returns `null` if `!user.isActive`, and only returns a user object with the real DB UUID on success. When `authorize()` returns `null`, NextAuth never calls `signIn` — it short-circuits with `CredentialsSignin`. Therefore a deactivated credentials user cannot reach `signIn`. The extra lookup adds a DB round-trip with no safety value. Belt-and-suspenders here trades latency for false reassurance; the stale-JWT defense in the `jwt` callback (`lines 186–195`) already re-checks `isActive` on every subsequent request and evicts the token if the row is gone or deactivated. See DECISION-015.

### Deletion Strategy Statement

The starter's mandated deletion strategy is **soft deactivation via `isActive = false`**. Hard-deleting a user row is prohibited. The delete-account stub in `src/app/(account)/account/actions.ts` (line 279) must set `isActive = false` (not `DELETE`) when it is implemented. This constraint is load-bearing for the email-keyed gate: a deactivated user who attempts to re-register via Google OAuth will be blocked because their email row still exists with `isActive = false`. If a future implementer breaks this constraint and hard-deletes rows, the gate must be supplemented with a blocklist (e.g., a `deleted_emails` table). This constraint must be documented in the delete-account action comment when it is implemented.

### Test Strategy

**Unit tests — `src/lib/auth/sign-in-gate.test.ts`**

Four branches, using a mock `findUserByEmail`:

1. **New OAuth user (no row):** `evaluateSignIn("google", { email: "new@example.com" }, () => Promise.resolve(null))` → `true`. This is the regression test that FAILS before the fix (current code returns `false`) and PASSES after.
2. **Deactivated OAuth user:** `evaluateSignIn("google", { email: "dead@example.com" }, () => Promise.resolve({ isActive: false }))` → `false`. Confirms the deactivation gate is not weakened.
3. **Active credentials user:** `evaluateSignIn("credentials", { id: "some-uuid" }, neverCalled)` → `true`. Confirms no DB call is made for credentials.
4. **OAuth user with no email:** `evaluateSignIn("google", {}, () => Promise.resolve(null))` → `false`. Confirms fail-safe behavior on missing email.

The `findUserByEmail` mock for test 3 should be a `vi.fn()` that `expect(...).not.toHaveBeenCalled()` to prove the credentials branch skips the DB.

**E2e tests (auth-touching gate)**

This fix modifies `src/auth.ts`. Per CLAUDE.md, Phase 4 cannot hand off to Phase 5 without a running-server e2e smoke covering the full login path including an MFA-enrolled user. The implementer must run `npm run test:e2e` against a live dev server seeded with the three standard test users (`SEED_ADMIN_*`, `SEED_MEMBER_*`, `SEED_MFA_ADMIN_*`) before declaring Phase 4 complete. QA's PASS verdict requires the same.

Real Google OAuth cannot be driven by Playwright; the OAuth code paths are covered by the unit tests above. The e2e suite covers credentials login (admin path, member path) and MFA-enrolled user login as the regression smoke. This is the accepted test strategy per the huddleup reference pattern.

### Implementation Order

1. Add `src/lib/auth/sign-in-gate.ts` with `evaluateSignIn` and the two exported types.
2. Add `src/lib/auth/sign-in-gate.test.ts` with all four branches. Verify test 1 FAILS against current `src/auth.ts` (not strictly required since we're adding a new extracted function, but the implementer should confirm the new-OAuth-user branch would have returned false under the old logic via a comment or a test of the old predicate).
3. Modify `src/auth.ts` `signIn` callback to call `evaluateSignIn`.
4. Run `npm run typecheck` — must pass.
5. Run `npm run test` — all unit tests must pass including the four new gate tests.
6. Run `npm run test:e2e` against a live dev server with seeded users — must pass.

### Outputs

- `docs/decisions.md` — DECISION-015 appended (credentials redundancy ruling + email-keyed gate + deletion strategy constraint).
- `docs/work-log/2026-07-01-oauth-first-signin-accessdenied.md` — Phase 2 skip + Phase 3 section added; Per-Phase Status updated.

### Open Questions / Handoff Notes for api-developer

- The `account?.provider` prop is available in the `signIn` callback as `async signIn({ user, account })`. Confirm this compiles cleanly with the current NextAuth 5 beta type for the callback.
- The `findFirst` return type from Drizzle is `T | undefined`, not `T | null`. The injected `FindUserByEmail` type returns `{ isActive: boolean } | null`. The inline adapter passed to `evaluateSignIn` in `src/auth.ts` needs `?? null` to normalize `undefined → null`. The implementer should verify this does not cause a TypeScript narrowing issue with the `columns: { isActive: true }` projection (the projected type should be `{ isActive: boolean }`).
- Add a comment to the delete-account stub in `src/app/(account)/account/actions.ts` noting the soft-deactivation mandate and DECISION-015. This is not a code change — it is a comment addition — but it is required to close the constraint documentation loop. The implementer should handle it in the same commit.
- Use the **api-developer** agent for implementation.

---

## Phase 4 — Implementation (API) — 2026-07-01

**Owner:** api-developer
**Status:** complete (e2e blocked-on-coordination — see below)

### Summary

Created `src/lib/auth/sign-in-gate.ts` containing `evaluateSignIn(provider, user, findUserByEmail)` per the Phase 3 design: credentials path returns `true` immediately; OAuth path looks up by lowercased email, allows on no row, blocks on `isActive=false`, and fails-safe when no email is present. Rewrote the `signIn` callback in `src/auth.ts` to a single `evaluateSignIn(...)` call, removing the id-keyed check per DECISION-015. Added the soft-deactivation mandate comment to the delete-account stub in `src/app/(account)/account/actions.ts`. All verification commands pass.

### Fail-Then-Pass Evidence

The test file `src/lib/auth/sign-in-gate.test.ts` encodes the OLD id-keyed logic in `simulateOldLogic()` (a faithful extraction of the pre-fix callback at `src/auth.ts:127-138`). Test 1 "OLD LOGIC" calls `simulateOldLogic` with a Google sub string as `userId` and a `findById` mock that returns `null` (no row). It asserts `result === false` — confirming the bug: the old code rejected every brand-new OAuth user. Test 1 "NEW LOGIC" calls the new `evaluateSignIn` with the same inputs and asserts `result === true`. Both tests pass in the same run:

```
 Test Files  17 passed (17)
      Tests  182 passed (182)
   Duration  449ms
```

(5 new tests in sign-in-gate.test.ts: old-logic regression, new-logic pass, deactivated block, credentials no-DB-call, no-email fail-safe, email case-insensitivity)

### What I Did

- Created `src/lib/auth/sign-in-gate.ts` with `evaluateSignIn`, `GateUser`, and `FindUserByEmail` types; doc comment explains WHY the check is email-keyed and references DECISION-015.
- Created `src/lib/auth/sign-in-gate.test.ts` with 5 tests (4 branches from design + email case-insensitivity), including the OLD LOGIC regression demonstration in test 1.
- Modified `src/auth.ts`: added import of `evaluateSignIn`; changed `async signIn({ user })` to `async signIn({ user, account })`; replaced the 10-line id-keyed block with a single `evaluateSignIn(...)` call using `.then((row) => row ?? null)` to normalize Drizzle's `undefined` return to `null` (TypeScript narrowing confirmed clean — typecheck passes).
- Added soft-deactivation mandate + DECISION-015 reference comment to the delete-account stub at `src/app/(account)/account/actions.ts:279`.

### Outputs

- `/Users/cshenso/git/claudecode/src/lib/auth/sign-in-gate.ts` — new file
- `/Users/cshenso/git/claudecode/src/lib/auth/sign-in-gate.test.ts` — new file
- `/Users/cshenso/git/claudecode/src/auth.ts` — signIn callback rewritten; import added
- `/Users/cshenso/git/claudecode/src/app/(account)/account/actions.ts` — delete-account stub comment updated

**API contract for qa / next phase:**

No new external endpoints or server actions. The gate is an internal library function consumed only by `src/auth.ts`. The change is transparent to callers: the NextAuth `signIn` callback signature is unchanged.

**Verification results:**

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass (0 errors) |
| `npm run lint` | Pass (0 warnings) |
| `npm run test` | Pass (17 test files, 182 tests) |
| `npm run build` | Pass (all 19 routes built) |
| `npm run check:audit` | Pass (0 violations) |

**E2E gate (auth-touching gate — BLOCKED on coordination):**

This fix modifies `src/auth.ts`, triggering the auth-touching e2e gate per CLAUDE.md Phase 4. The gate requires all concurrent Phase 4s to be Complete before running the dev server. At the time this verification completed:

- `2026-07-01-verify-email-neon-http-transaction` Phase 4: **Complete**
- `2026-07-01-2fa-fresh-codes-rsc-cookie` Phase 4: **Pending**

E2e is blocked until BUG-2 Phase 4 completes. Once it does, the qa agent should run `npm run dev` (background), confirm HTTP 200, run `npm run test:e2e` (all 20 tests expected to pass — credentials login paths are the required smoke; Google OAuth paths are covered by the unit tests in sign-in-gate.test.ts), and record the result before issuing a PASS verdict.

### Open Questions / Handoff Notes

- **Next agent: qa** — Phase 5 verification. The e2e gate is blocked-on-coordination (BUG-2 Phase 4 still Pending at time of writing). qa should poll the BUG-2 work-log before starting e2e. Unit tests and all other verification are clean; the only outstanding item is the e2e run.
- The `account?.provider ?? "credentials"` fallback in `src/auth.ts` is defensive — `account` is never `null` for OAuth providers in practice, but the fallback is safe because the credentials branch is a no-op that returns `true` immediately.
- The `.then((row) => row ?? null)` pattern in the inline `findUserByEmail` adapter normalizes Drizzle's `T | undefined` return to `T | null` to satisfy the `FindUserByEmail` type. This is the correct place for the coercion; the gate function itself uses strict `null` checks.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. This is an auth-touching fix (modifies `src/auth.ts`) and satisfies the full auth-touching gate: the e2e suite ran against a real dev server seeded with `SEED_ADMIN_*`, `SEED_MEMBER_*`, and `SEED_MFA_ADMIN_*` users — all 20 tests passed (21.2s). The old-logic regression demonstration in `simulateOldLogic` is faithful to the pre-fix callback at `src/auth.ts` HEAD lines 127–136. The new callback normalizes Drizzle's `undefined` to `null` via `.then((row) => row ?? null)`. No other call sites depend on the removed id-keyed behavior. Deactivated-user blocking holds on both credentials (via `authorize()`) and OAuth (via `evaluateSignIn` returning `row.isActive`). All 5 unit tests in `sign-in-gate.test.ts` pass, including the fail-before / pass-after demonstration in the nested `"new OAuth user"` describe block.

### Auth-Touching Gate — SATISFIED

This fix modifies `src/auth.ts`. Per CLAUDE.md Phase 5 gate and the "Auth-Touching Features — Stricter Gate" rule in the QA agent definition:

- e2e suite run: YES — against live `npm run dev` server (port 3000, HTTP 200 confirmed before run)
- Seeded users present: YES — `.env.local` contains `SEED_ADMIN_*`, `SEED_MEMBER_*`, `SEED_MFA_ADMIN_*`; tests 7–9 (admin login + dashboard), 13–16 (member routing + admin gate), and 17 (MFA-enrolled user redirected to /totp) all exercised the credentials login path
- Full login path covered: YES — credentials sign-in → session → post-login landing; MFA-enrolled user → /totp redirect
- Result: 20/20 PASS, 21.2s
- Google OAuth path: covered by unit tests in `sign-in-gate.test.ts` (cannot drive real OAuth in Playwright; this is the accepted strategy per Phase 3 design and CLAUDE.md note on the huddleup pattern)

### What I did

- Ran shared verification suite (see Shared Verification Results — run once for all three concurrent fixes).
- Killed stale process on port 3000 before starting dev server.
- Started `npm run dev` in background; confirmed HTTP 200 on `http://localhost:3000`.
- Ran `npm run test:e2e` — 20/20 tests passed. Killed dev server after.
- Verified `simulateOldLogic` faithfulness: compared it line-by-line against `git show HEAD:src/auth.ts` lines 127–136. Match is exact: `if (!user.id) return true` → `if (!userId) return true`; `db.query.users.findFirst({ where: eq(users.id, user.id) })` → `findById(userId)`; `if (!dbUser) return false` → `if (!dbUser) return false`; `return dbUser.isActive` → `return dbUser.isActive`. The simulation is faithful.
- Read fixed `src/auth.ts:128-145` — signIn callback now calls `evaluateSignIn(account?.provider ?? "credentials", user, (email) => db.query.users.findFirst(...).then((row) => row ?? null))`. The `?? null` normalization is in place.
- Checked for other call sites reading the signIn callback's removed id-keyed behavior: no other file imports or re-implements the old id-keyed check. The only consumer of signIn callback logic is `src/auth.ts` itself.
- Confirmed deactivated-user blocking for credentials: `src/auth.ts:authorize()` at lines 108–111 queries by email, returns `null` if `!user.isActive` (line 111), which causes NextAuth to short-circuit before `signIn` is called. Belt-and-suspenders was removed per DECISION-015; the `jwt` callback re-checks `isActive` on every subsequent request.
- Confirmed deactivated-user blocking for OAuth: `evaluateSignIn` returns `row.isActive` when a row exists; `false` for `isActive=false`.
- Confirmed delete-account stub comment at `src/app/(account)/account/actions.ts:279-293` references DECISION-015 and documents the soft-deactivation mandate with the implementation shape.
- Verified no stray `console.log`, native browser dialogs, or `toLocale*` calls in any changed file.
- Adversarial cross-check: `src/auth.ts` and `src/app/(account)/account/actions.ts` are touched only by this fix, no overlap with BUG-A or BUG-B files.

### Shared Verification Results (run once for all three fixes)

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 warnings |
| `npm run test` | PASS — 20 test files, 195 tests, 476ms |
| `npm run build` | PASS — 17/17 pages generated |
| `npm run check:audit` | PASS — "Audit-coverage check passed." |
| `npm run test:e2e` | PASS — 20/20 tests, 21.2s — auth-touching gate SATISFIED |

### Regression Tests Added

- `src/lib/auth/sign-in-gate.test.ts:53` — "OLD LOGIC — returns false (bug: new OAuth user is rejected)" — demonstrates the pre-fix behavior; confirms `simulateOldLogic` (faithful encoding of the old callback) returns `false` for a new OAuth user, which is the bug.
- `src/lib/auth/sign-in-gate.test.ts:62` — "NEW LOGIC — returns true (fix: new OAuth user is allowed through) — regression for BUG-3: first-time Google OAuth returns AccessDenied" — the primary regression test; passes only with the email-keyed gate.
- `src/lib/auth/sign-in-gate.test.ts:77` — "deactivated OAuth user — returns false" — confirms the soft-deactivation gate is not weakened by the fix.
- `src/lib/auth/sign-in-gate.test.ts:96` — "credentials provider — returns true and does not call findUserByEmail" — confirms credentials path takes no DB round-trip.
- `src/lib/auth/sign-in-gate.test.ts:112` — "OAuth user with no email — returns false (fail-safe)".

### Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/two-factor.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/flags.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/auth/sign-in-gate.ts`: 100% (all 4 branches covered: credentials, OAuth no email, OAuth no row, OAuth existing row isActive)

### Outputs

- `docs/work-log/2026-07-01-oauth-first-signin-accessdenied.md` — Phase 5 section added; Per-Phase Status Phase 5 row updated.

### Open questions / handoff notes

- Next agent: **analyst** (Phase 6 — Shipped vs Intent).
- The `account?.provider ?? "credentials"` fallback is defensive and safe; `account` is never null for real OAuth in practice.
- The deletion-strategy constraint documented in the delete-account stub and DECISION-015 must be enforced when the stub is implemented. A future implementer must not add a hard-delete path without also adding a blocklist.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. All three behavioral contracts from Phase 1 are met: (a) deactivated users are blocked on both providers, (b) brand-new OAuth users are allowed through so the adapter can create them, (c) DECISION-015's soft-deactivation mandate is documented in the delete-account stub. The extracted `evaluateSignIn` gate is clean, DI'd, and fully unit-tested including a faithful encoding of the old (broken) logic that proves the bug manifested. The `signIn` callback in `src/auth.ts` is reduced to a single delegation call. DECISION-015 is in `docs/decisions.md`.

### What I did

- Re-read Phase 1 behavior contract (a), (b), (c) and the scope ruling on account linking.
- Read `src/lib/auth/sign-in-gate.ts` in full — four branches present: credentials returns true, OAuth no-email returns false, OAuth no-row returns true, OAuth existing row returns `row.isActive`. Doc comment references DECISION-015.
- Read `src/auth.ts:128-146` — `async signIn({ user, account })` delegates to `evaluateSignIn(account?.provider ?? "credentials", user, (email) => db.query.users.findFirst(...).then((row) => row ?? null))`. The `.then((row) => row ?? null)` normalizes Drizzle's `T | undefined` to `T | null`. Comment explains all four branches. `columns: { isActive: true }` projection confirmed.
- Verified credentials deactivation path: `authorize()` at line 112 returns `null` on `!user.isActive`, which causes NextAuth to short-circuit before `signIn` is called. `evaluateSignIn` for credentials returns `true` unconditionally — correct, since the check has already been done.
- Verified `jwt` stale-JWT defense at lines 194-203: re-reads `isActive` on every request; returns `{}` (signout) if row missing or deactivated. Belt-and-suspenders defense preserved at the JWT layer.
- Read `src/app/(account)/account/actions.ts:279-299` — DECISION-015 constraint comment present: mandates soft-deactivation, explains the email-keyed gate dependency, gives the implementation shape, notes the proxy enforcement.
- Read `src/lib/auth/sign-in-gate.test.ts` — 6 tests (2 in the nested `new OAuth user` describe, 4 standalone). The nested `OLD LOGIC` test encodes `simulateOldLogic` as a faithful extract of the pre-fix callback and asserts `result === false` — confirms the bug was real. `NEW LOGIC` asserts `result === true` — the fix.
- Account-linking scope ruling: `allowDangerousEmailAccountLinking: true` is at line 82 of `src/auth.ts`; the email-keyed `evaluateSignIn` correctly allows an existing active credentials user to link their Google account on first OAuth sign-in.

### Outputs

- `docs/work-log/2026-07-01-oauth-first-signin-accessdenied.md` — Phase 6 section added; Per-Phase Status Phase 6 row updated to SHIP IT / 2026-07-01.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| (a) Deactivated users blocked on both providers | Credentials: `authorize()` returns null on `!user.isActive`; OAuth: `evaluateSignIn` returns `row.isActive` (false blocks); `jwt` stale-check evicts deactivated sessions | Matches |
| (b) Brand-new OAuth users allowed through | `row === null → return true` in `evaluateSignIn`; adapter creates row after callback | Matches |
| (c) Soft-deactivation mandate documented in delete-account stub | DECISION-015 constraint comment at `src/app/(account)/account/actions.ts:279-294` | Matches |
| Credentials path short-circuits without DB call | `if (provider === "credentials") return true` at `sign-in-gate.ts:55` — no `findUserByEmail` call | Matches |
| Fail-safe on missing email | `if (!user.email) return false` at `sign-in-gate.ts:60` | Matches |
| Unit tests including fail-before/pass-after | `simulateOldLogic` in `sign-in-gate.test.ts` asserts OLD = false (the bug); NEW = true (the fix) | Matches |
| E2e smoke against real dev server (auth-touching gate) | 20/20 e2e tests passed; credentials login path + MFA-enrolled user exercised | Matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state | N/A — signIn callback, not a page |
| Failure microcopy | N/A — auth callback; AccessDenied page is provided by NextAuth |
| Permission gate | Deactivated OAuth gate: pass (tested by unit test 2); deactivated credentials gate: pass (via authorize()) |
| Audit event | No new audit event on signIn was in scope; `jwt` callback handles post-sign-in session eviction |
| Mobile | N/A |
| Account linking (OAuth → existing credentials user) | `allowDangerousEmailAccountLinking: true` + email-keyed lookup finds existing active row → true; linking proceeds | Pass |

### Open questions / handoff notes

- The deletion-strategy constraint in the delete-account stub comment must be honored when that stub is implemented. If a future implementer uses hard-delete, a `deleted_emails` blocklist is required alongside the email-keyed gate.
