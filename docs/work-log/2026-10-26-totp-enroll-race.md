# Two-factor enrolment secret race — Work Log

> **Slug:** `2026-10-26-totp-enroll-race`
> **Surface:** (account) `/account/2fa` enrolment; `getOrCreatePendingEnrollment` has that page as its only caller (`/admin/2fa` does not use it)
> **Permission(s):** existing (none new)
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Numbers (pre-assigned):** F342; DECISION-290 if a decision results; no migration expected (0080 reserved if one is needed); dev port 3630
> **Worktree:** `/Users/cshenso/git/presby-platform/presby-enroll`, branch `pipeline/totp-enroll-race`, from `main` at 0.45.0; Neon branch `pipeline-totp-enroll-race` (`br-summer-breeze-ax9axs8a`, `ep-broad-smoke`)
> **Found by:** Community 2b Batch D (2026-10-26), while chasing an `invitation-new-account` e2e flake. The browser fetches `/account/2fa` twice in the same millisecond on arrival; `getOrCreatePendingEnrollment` (`src/lib/totp-pending.ts`) is find-then-upsert, so two concurrent first renders each mint a secret and the last write wins. The page can show the losing secret; a correct code for it is refused ("That code did not match. Try again."). Observed ~1 in 20. A reload fixes it for the person. Full notes: `presby-2b` work-log `docs/work-log/2026-10-22-founding-admin-directory.md` ~lines 8230-8240.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-26 |
| 2 — Architectural review | architect | **Skipped** — fix is a conflict-safe conditional upsert plus re-select inside `getOrCreatePendingEnrollment` (Phase 3 chose the conditional upsert; the same conditions hold); no schema, dependency or invariant change (reopens if a migration, trigger or lock is proposed) | — | 2026-10-26 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named (full-stack-developer) | 2026-10-26 |
| 4 — Implementation | full-stack-developer | Complete | Gate met: typecheck, lint, check, unit, DB-backed totp specs, running-server e2e (probe, login-path specs, 40/40) | 2026-10-26 |
| 5 — Verification | qa | Complete; failing-first reproduced (6 specs red ×3, probe red 3/3); HEAD 40/40 DB ×5, auth e2e 31/31 ×2, invitation-new-account 40/40, full chromium 463/463, prod hydration 1/1 | PASS | 2026-10-26 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES.** The bug is real and the fix has a clear shape. The notes below are Phase 3 inputs. Phase 2 can be skipped on stated conditions.

## ONE-LINE TAKE

> `getOrCreatePendingEnrollment` is find-then-upsert, so two concurrent first renders of `/account/2fa` each mint a secret and the last write wins. The fix makes the database hold exactly one secret per pending enrolment, and the page always shows what the database holds.

## Bug confirmed from code (`src/lib/totp-pending.ts`)

1. The helper does `findFirst` (no row, or expired). It then mints `generateSecret()` in memory, then runs `insert … onConflictDoUpdate({ set: { secretCiphertext, expiresAt, createdAt } })`.
2. `user_id` is the primary key of `user_totp_pending_enrollments` (`src/lib/db/schema.ts:154`), so the conflict target exists. The `do update` is unconditional: it overwrites a row that was just minted and is still fresh.
3. The interleave is two renders, A and B. Both find nothing. A inserts SA, then B overwrites with SB. A's render returns SA and B's returns SB, but the database holds SB.
4. If the browser keeps A's response, the QR code and manual key show SA. The user's authenticator produces correct codes for SA. `completeEnrollment` decrypts the stored SB and answers "That code did not match. Try again." A reload shows SB and works. That matches the observed ~1 in 20 and the probe's `sameSecret=false`.
5. The same flaw applies to the expired case. The `do update` also fires for an expired row, so two concurrent renders after expiry race identically.

**Correction to the request's premise.** The work-log header and the helper's docstring say the helper is shared with `/admin/2fa`. That is stale. `src/app/(admin)/admin/2fa/page.tsx` is now a policy and stranded-users page and does not call the helper. The only caller of `getOrCreatePendingEnrollment` is `src/app/(account)/account/2fa/page.tsx:118`. There is no separate invitation-enrolment path. An invitee reaches the same page through the `/totp` to `/account/2fa` redirect. Phase 3 should fix the docstring. The "latent on `/admin/2fa`" claim should be dropped.

Other readers and writers of the table:
- `completeEnrollment` in `src/app/(account)/account/2fa/actions.ts` reads the row, verifies the code, copies the ciphertext into `user_totp`, then deletes the pending row.
- The admin reset in `src/app/(admin)/admin/users/[id]/actions.ts:102` deletes the user's pending row.
- The maintenance cron in `src/app/api/cron/maintenance/route.ts` garbage-collects expired rows.

## What the fix must preserve

- **One stored secret per pending enrolment.** The primary key on `user_id` stays. No schema change, no migration, so 0080 is not needed.
- **Always return what is stored.** The page must display the secret read back from the stored row, never a locally minted one that may have lost. A losing renderer returns the winner's decrypted secret. This is the heart of the fix.
- **A fresh row is never overwritten.** Within the TTL, a second render, a reload, or a second tab gets the same secret. The QR code stays stable for the authenticator the user already scanned (the helper's stated contract).
- **Expiry.** A row with `expires_at <= now` is replaced by a new secret and a new 10-minute TTL (`PENDING_TTL_MINUTES = 10`). The replacement must itself be conflict-safe: two concurrent renders after expiry must converge on one new secret. A conditional upsert (`do update … where expires_at <= now()`) does this, because Postgres re-evaluates the `where` against the committed winner under READ COMMITTED.
- **Fresh secret after completion.** Completion deletes the pending row, so a later enrolment (for example after an admin reset) mints a new one. The enrolled user's `/account/2fa` shows the management view and never calls the helper. This ordering in `page.tsx` is preserved.
- **No secret leaks.**
  - Ciphertext stays in the database. The plaintext goes only to the one `TotpEnrollForm` as `secret` and `uri`, which is today's behaviour.
  - No logging of the secret, the ciphertext, or the URI. This includes error paths and any "lost the race, retrying" diagnostic.
  - No new client-visible channel.
  - The re-select must not leak across users (always keyed on `userId` from the session).
- **Re-enrol and reset path unchanged.** Admin reset deletes `user_totp`, the recovery codes and the pending row. The next render mints fresh.
- **Not in this fix.** The `completeEnrollment` rate-limit gap (TODO "Gap 6", `docs/TODO.md:413`) stays tracked there. Do not bundle it, and do not add `checkRateLimit` here.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member, newly invited or 2FA-required but not enrolled | Opens `/account/2fa` (arrives by redirect, so the browser may fetch it twice) | One-time per enrolment |
| Same | Scans the QR code or types the manual key | One-time |
| Same | Types six digits (auto-submits on the last digit, DECISION-257) | One-time, repeats on failure |
| Same | Reloads or opens a second tab | Occasional |
| Admin | Resets another user's 2FA at `/admin/users/<id>` | Rare |

## Flows

**Flow 1 — First enrolment.** Entry: the `/totp` or `/launch` redirect to `/account/2fa?callbackUrl=…`. The page renders, the helper returns the stored secret, the user scans it and enters a code, `completeEnrollment` verifies it, the recovery codes are shown, and Continue goes to `callbackUrl`.
- Failure (today): the shown secret differs from the stored one, so a correct code is refused. The fix removes this.
- Failure (kept): a wrong code gives the toast "That code did not match. Try again." and the boxes clear.

**Flow 2 — Reload or second tab within 10 minutes.** The same secret is shown and the already-scanned authenticator keeps working.

**Flow 3 — Return after expiry.** `completeEnrollment` says "Enrollment session expired. Reload the page to start over." and deletes the row. The reload mints a new secret, and the old authenticator entry no longer works. This is the existing copy and behaviour. Keep it.

**Flow 4 — Admin reset mid-enrolment.** The user's open form holds secret S and the pending row is deleted. Submitting gives "No pending enrollment found. Reload the page to start over." A reload mints a fresh secret. Preserved as is.

## Permissions & Flags

- **Permission(s):** none new. `/account/2fa` is auth-only with no `FEATURES` gate. It sits in the proxy's authenticated-only account subtree.
- **Flag(s):** not needed. A flag would not help a race fix. The rollback plan is a plain revert, since there is no schema change.
- **Audit:** no new audit event. Minting a pending secret is not audited today, and enrolment (`TOTP_ENROLLED`) and reset are already audited.

## Gaps the Request Didn't Address

1. **Empty re-select.** With insert-do-nothing plus re-select, the re-select can return no row. This happens when an admin reset or the cron GC deletes the winner between the two statements. The design needs a bounded retry (one or two attempts), then a defined failure. Do not loop unbounded, and do not fall back to returning a locally minted secret that was never stored. That would reintroduce the bug.
2. **Test quality.** `src/lib/totp-pending.test.ts` is a "replica" spec: it re-implements the predicate and never imports the subject (TODO #12, test-coverage review). A regression test of that kind cannot fail before the fix. Bug-fix variant rule: the implementer writes a DB-backed test that fails before and passes after. For example, N parallel calls for one user (say 10 to 20, to make the interleave likely) must all return the same secret, and that secret must decrypt from the stored row. Add cases for the expiry race (expired row, concurrent calls, one winner), for a reload within the TTL, and for a fresh secret after the row is deleted. The test needs `AUTH_TOTP_ENCRYPTION_KEY` and the serial DB-backed run (`docs/testing.md`).
3. **Adjacent race, not this fix.** `completeEnrollment` is read, verify, upsert `user_totp`, delete pending, then `replaceRecoveryCodes` (delete then insert), with no transaction. Two tabs submitting at once could produce interleaved recovery codes. The client's `inFlight` guard covers a single tab only. File it as a TODO follow-up; do not fix it here.
4. **Key rotation.** A pending row encrypted under a rotated key makes `decryptSecret` throw in the render until the row expires (up to 10 minutes). That is pre-existing and documented ("Rotating it invalidates every existing enrolment"). Don't change it. The fix must not make it worse: a decrypt failure still surfaces and never silently re-mints over a fresh row.
5. **Stale docstring and work-log header.** Both say "shared with `/admin/2fa`". Correct them (see above).
6. **Visual-parity note.** The existing TODO (`docs/TODO.md:482`) already marks `/account/2fa` as time-sensitive because the QR repaints. No new impact.

## Adversarial pass

- **Redirects.** `callbackUrl` is already passed through `sanitizeCallbackUrl()` in the page. The fix doesn't touch it. Confirm it stays untouched.
- **Cross-user.** The helper takes `userId` from `session.user.id`, never from input. The conflict target and the re-select must both key on that `userId`. A test with two users must show distinct secrets.
- **State-machine shortcut.** `completeEnrollment` ignores the page and reads only the stored pending row, so a user cannot enrol a secret of their choosing. The fix keeps the stored row as the only source of truth.
- **Already enrolled.** If the user is already enrolled, the page never calls the helper. A direct `completeEnrollment` call finds no pending row and refuses. The stale-tab case (enrolled in tab A, tab B still open) gets "No pending enrollment found", because completion deletes the row.
- **Input boundaries and enumeration.** No new inputs and no new responses that differ by account state.

## Is this auth-touching? Does the MFA smoke apply?

Strictly, `src/lib/totp-pending.ts` and `src/app/(account)/account/2fa/` are not in the Phase 4 gate's listed paths (`src/auth.ts`, `src/proxy.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`). Functionally it is the enrolment leg of the login path: a new invitee or 2FA-required user cannot get past `/totp` without it. **Recommendation: treat it as auth-touching.** The Phase 4 gate should require a running-server e2e smoke on the pipeline's own port (3630), and QA should return BLOCKED, not PASS, if it is deferred. The smoke should cover:
- `invitation-new-account` repeated enough runs to show the ~1 in 20 flake is gone (for example 40 or more consecutive runs, or a stress loop that fetches `/account/2fa` twice at once).
- `totp-full-login` with the MFA-enrolled seeded user.
- A new e2e (or probe) that fires two concurrent requests for a fresh user and asserts both pages carry the same secret, plus a reload showing the same secret.
- A 360px check of the enrol page. The page markup is unchanged, but the bug-fix variant still wants the phone viewport check.

## Can Phase 2 be skipped?

**Yes, with explicit notation**, on these conditions:
- The fix stays inside `getOrCreatePendingEnrollment`, as conflict-safe insert plus re-select (or a conditional upsert with `returning` plus a re-select fallback).
- There is no migration, no new dependency, and no new directory.
- No change to `user_totp_pending_enrollments` constraints, to `presby_app` grants (it already has full CRUD on this table, per 0048), or to any invariant.
- No transaction or advisory-lock design is introduced.

If tech-lead reaches for a migration (a unique index, a trigger) or a lock, reopen Phase 2. DECISION-290 is reserved only if a durable ruling results. A decision is not otherwise needed, though a one-line note on "the page shows what the database holds" would help later readers. DECISION-192, DECISION-193 and DECISION-257 govern the code-entry UI (six boxes, auto-submit on the sixth digit, `HydrationGate`) and are untouched. No UI change.

## Out of Scope (confirm with user)

- The `completeEnrollment` rate limit (TODO Gap 6).
- The `completeEnrollment` non-transactional recovery-code replacement (adjacent race, gap 3).
- Replacing the other "replica" specs (TODO #12 and its siblings). Only the `totp-pending` regression test must become real.
- Any change to the TTL, the enrol-page copy or the `/admin/2fa` policy page.
- Changing the `invitation-new-account` spec's `enrolOnPage` reload-and-retry workaround in 2b. That workaround can be removed after this lands and merges.

## Open Questions

None blocking. Tech-lead should decide bounded-retry versus a single conditional-upsert-with-returning design (gap 1).

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-26 |

## Handoff

Next: **Phase 2 may be skipped** with the notation "Skipping Phase 2 — fix is a conflict-safe insert plus re-select inside `getOrCreatePendingEnrollment`; no schema, dependency or invariant change", provided the conditions above hold. Hand to **tech-lead** (Phase 3). Phase 3 inputs:
- Gaps 1 and 2: the bounded retry, and a DB-backed regression test that fails before the fix.
- The MFA running-server smoke as a Phase 4 gate.
- The stale docstring and work-log header (the helper has one caller, `/account/2fa`).
- File gap 3 (the non-transactional recovery codes) as a TODO follow-up.
- Keep Gap 6 (the rate limit) in its existing TODO line.

Files read:
- `/Users/cshenso/git/presby-platform/presby-enroll/src/lib/totp-pending.ts`
- `/Users/cshenso/git/presby-platform/presby-enroll/src/lib/totp-pending.test.ts`
- `/Users/cshenso/git/presby-platform/presby-enroll/src/lib/db/schema.ts` (lines 154-166)
- `/Users/cshenso/git/presby-platform/presby-enroll/src/app/(account)/account/2fa/page.tsx`
- `/Users/cshenso/git/presby-platform/presby-enroll/src/app/(account)/account/2fa/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-enroll/src/app/(account)/account/2fa/totp-enroll-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-enroll/src/app/(admin)/admin/2fa/page.tsx`
- `/Users/cshenso/git/presby-platform/presby-enroll/src/app/(admin)/admin/users/[id]/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-enroll/drizzle/0048_presby_security_b.sql`
- `/Users/cshenso/git/presby-platform/presby-enroll/docs/work-log/2026-10-26-totp-enroll-race.md`
- `/Users/cshenso/git/presby-platform/presby-2b/docs/work-log/2026-10-22-founding-admin-directory.md` (around lines 8225-8240)

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

Bug-fix variant, brief design. Phase 2 stays skipped: every condition in the Phase 1 skip notation holds (no migration, trigger, lock, advisory lock, transaction, dependency, new directory, grant or constraint change, invariant change). If the implementer finds the fix needs any of those, stop and reopen Phase 2.

## Summary

Root cause: `getOrCreatePendingEnrollment` (`src/lib/totp-pending.ts:46-77`) is a check-then-act sequence across three separate round trips (`findFirst`, mint in memory, `insert … on conflict do update`). The upsert is unconditional, so it overwrites a row another render committed a moment earlier, and each caller returns the secret *it minted*, not the secret the database ended up holding. Two concurrent first renders of `/account/2fa` (the browser double-fetches on the `/totp` redirect) both see no row, both mint, the last write wins, and one page shows a secret the database no longer holds; `completeEnrollment` verifies against the stored one and refuses a correct code. The expired-row case races identically because the same unconditional `do update` replaces it.

Fix: one atomic conditional upsert that only ever writes when there is no row or the row is expired, followed, for the loser, by a read of what the winner stored. The function never returns a secret it minted unless the database confirmed, in the same statement, that its own ciphertext is the stored one, and it always derives the returned value by decrypting the stored ciphertext.

## Permissions & Flags

- Permission key(s): none new. `/account/2fa` stays auth-only (no `FEATURES` gate), unchanged.
- Default role bindings: none.
- Feature flag(s): not needed. Rollback is a plain revert (no schema change).
- Audit: no new event (minting a pending secret is not audited today; `TOTP_ENROLLED` and the admin reset already are).

## API Contract

No route or action changes. The one signature is unchanged:

`getOrCreatePendingEnrollment(userId: string, email: string): Promise<{ secret: string; uri: string }>`

New behaviour: on exhausting its attempts it rejects with `new Error("Pending two-factor enrolment could not be established")` (a constant string; it carries no user id, secret, ciphertext or URI). A decrypt failure (rotated key) still rejects from `decryptSecret` and is not caught.

### The shape of the fix (for the implementer)

Inside `getOrCreatePendingEnrollment`, replace the body with a loop of at most `MAX_ATTEMPTS = 3` (module constant, not exported), each attempt two autocommit statements, no transaction:

1. **Read a fresh row.** `db.select({ secretCiphertext }).from(userTotpPendingEnrollments).where(and(eq(userId, userId), gt(expiresAt, sql\`now()\`))).limit(1)`. If a row comes back: `decryptSecret(row.secretCiphertext)`, return `{ secret, uri: otpauthUrl(email, secret) }`. This is the reload path and writes nothing.
2. **Insert, or replace only if expired, in one statement.**
   ```
   insert into user_totp_pending_enrollments (user_id, secret_ciphertext, expires_at)
   values ($user, $fresh_ciphertext, now() + make_interval(mins => 10))
   on conflict (user_id) do update
     set secret_ciphertext = excluded.secret_ciphertext,
         expires_at        = excluded.expires_at,
         created_at        = now()
     where user_totp_pending_enrollments.expires_at <= now()
   returning secret_ciphertext
   ```
   In Drizzle: `.insert().values({ userId, secretCiphertext: ct, expiresAt: sql\`…\` }).onConflictDoUpdate({ target: userId, set: {…}, setWhere: sql\`${table.expiresAt} <= now()\` }).returning({ secretCiphertext })`. `PENDING_TTL_MINUTES` is bound as the interval parameter, not string-built. Mint with `encryptSecret(generateSecret())` inside the attempt; a lost attempt's ciphertext is simply discarded. If `returning` yields a row, this call wrote the row (inserted, or replaced an expired one): decrypt *that returned ciphertext* and return it (one code path: the page always shows what was read back from the database). If it yields no row, another caller holds a fresh row: go round again; step 1 of the next attempt reads the winner's secret.
3. **Exhaustion.** After `MAX_ATTEMPTS` with no return, throw the constant error above. Never return the locally minted secret.

The expiry clock moves from the app (`new Date()`) to the database (`now()`) for every comparison *inside the helper*, so the freshness test and the write that follows it cannot disagree across two machines' clocks. `completeEnrollment`'s own `pending.expiresAt < new Date()` (`actions.ts:88`) is left alone; the skew between the app and Neon is sub-second against a 10-minute window (unverified in tests; named as a residual in Edge Cases).

### Why this shape (READ COMMITTED)

The connection is autocommit READ COMMITTED, each statement taking its own snapshot, so the safety has to live in one statement, not across two.

- `INSERT … ON CONFLICT DO UPDATE` is an atomic insert-or-update. If another session has inserted the row but not yet committed, the second insert blocks on that transaction's outcome; when it commits, the second statement locks the committed row and evaluates the `DO UPDATE … WHERE` against the *latest committed version* of it. The winner's row has `expires_at` in the future, the predicate is false, the row is neither updated nor returned. That is documented behaviour: only rows actually inserted or updated appear in `RETURNING`. So exactly one concurrent statement writes per (user, expired-or-absent state), for first render and expiry alike, and a loser learns it lost from the empty `RETURNING`, not from a guess.
- The loser's next statement starts after the winner committed (the loser was blocked on that very commit, or the row was already committed), so its fresh snapshot contains the winner's row. READ COMMITTED gives that read-your-predecessor guarantee for free; no retry-for-visibility is needed. The bounded retry exists for the other cause of an empty read, a row *deleted* between the two statements (admin reset, or the maintenance cron's expired-row GC). The next attempt then finds no row and inserts.
- Rejected, option A: `on conflict do nothing` + re-select. It does not replace an expired row (the conflicting expired row is left in place), so it would need a separate `delete … where expires_at <= now()` first: two statements to make the expiry case correct, against one for the conditional upsert. It also gives a loser no way to tell "lost to a fresh row" from "row was expired" without the re-select. The conditional upsert subsumes it.
- Rejected: a transaction with `SELECT … FOR UPDATE`, an advisory lock, or a unique index/trigger. They would reopen Phase 2 and the primary key on `user_id` already provides the arbiter.
- Cost: a reload within the TTL is one indexed read and no write (today it is also one read). First render and post-expiry render are one read plus one write (today: one read plus one write). No extra latency on the common path.

Logging: the function logs nothing. No `console.*`, no error `cause`, no interpolation of secret, ciphertext, URI, or even the user id into a message. A unit test pins this for the failure path (T8).

## Data Model

No schema changes required. No migration (0080 stays unused), no new constraint, no grant change (`presby_app` already has full CRUD on `user_totp_pending_enrollments`, 0048; `ON CONFLICT DO UPDATE … WHERE` and `RETURNING` need only the SELECT and UPDATE it already holds). `schema.ts` untouched.

## Component / Page Plan

- Pages to create: none. Components to create: none. UI unchanged.
- Files to modify:
  - `src/lib/totp-pending.ts` — the fix above; correct the docstring (see below).
  - `src/lib/totp-pending.test.ts` — replaced wholesale (see Test plan).
  - `src/app/(account)/account/2fa/page.tsx:113-116` — the comment ("reuse the pending row if it's still valid, otherwise mint a new one") stays true; add one clause: "the page shows what the database holds". Optional, comment only.
- Files to create: `src/lib/totp-pending.exhaustion.test.ts` (mocked-db unit spec, runs in plain `npm test`); `e2e/totp-enrol-concurrency.spec.ts` (the concurrent-fetch probe).
- Docstring correction (`totp-pending.ts:1-18, 39-45`): delete "used by the admin /admin/2fa and account /account/2fa pages" and the "previously duplicated … in admin/2fa/page.tsx" paragraph. State instead: sole caller is `src/app/(account)/account/2fa/page.tsx`; `/admin/2fa` is a policy and stranded-users page and does not call it; the contract is "one stored secret per pending enrolment, the page always shows what the database holds, a fresh row is never overwritten, an expired row is replaced atomically". Replace "makes it straightforward to unit-test by mocking the DB" with "tested against the real database (`totp-pending.test.ts`)". Fix the work-log header's Surface line to match (done in this commit).

## Test plan (Phase 4 writes these; tests land first and are shown red)

Order: the implementer writes the two spec files, runs them against the **unfixed** helper (red), commits that as a WIP commit or keeps a scratch copy of the old file for comparison (never `git stash`: worktrees share one stash list), then applies the fix and shows green. The Phase 5 QA check is "T1, T2 and T9 fail on the old helper".

**`src/lib/totp-pending.test.ts` (DB-backed, replaces the replica spec).** Harness per `credentials.test.ts`: `describe.skipIf(!hasDb)`, dynamic imports in `beforeAll`, Fixture: throwaway `users` rows (`@example.invalid` addresses, random UUIDs) created through `getPlatformDb()`, removed in `afterAll` (the FK cascade removes pending rows; fixture teardown only, the application code never hard-deletes users). Needs `AUTH_TOTP_ENCRYPTION_KEY` (present in `.env.local`, `db.yml`, `ci.yml`); a missing key makes the helper throw, which is a loud failure and not a skip. Run with `npm run test:db`; the pool is 10, so N = 16 parallel calls still interleave heavily.

| # | Case | Assertion | Red on old helper? |
|---|---|---|---|
| T1 | Concurrent first render: 16 parallel `getOrCreatePendingEnrollment(u, email)` for a user with no row | exactly 1 distinct `secret` across the 16 results; exactly 1 row in the table; `decryptSecret(row.secretCiphertext)` equals that secret; every `uri` contains it | yes (loser returns its own minted secret) |
| T2 | Expiry race: seed an expired row (known S0, `expires_at` an hour ago), then 16 parallel calls | 1 distinct secret, not S0; stored row decrypts to it; stored `expires_at` is more than 9 minutes in the future (read with `expires_at > now() + interval '9 minutes'` in SQL, no JS clock) | yes |
| T3 | Reload within TTL: two sequential calls | same secret; stored ciphertext, `created_at` and `expires_at` byte-identical before and after the second call (a fresh row is never rewritten) | no (pins preserved behaviour) |
| T4 | Fresh row under concurrency: seed a fresh row with known secret S, 16 parallel calls | all equal S; row unchanged | no (pin) |
| T5 | Fresh after delete: call, `delete` the user's pending row (the admin-reset shape), call again | second secret differs from the first; row decrypts to the second | no (pin) |
| T6 | Two users: 16 interleaved parallel calls (8 per user) | one distinct secret per user, the two differ, each stored row is keyed to its own user | no on a quiet DB, yes with the race; pin |
| T7 | Rotated key: fresh row with an undecryptable ciphertext | the call rejects, and the row is untouched (not re-minted over a fresh row, Phase 1 gap 4) | no (pin) |

**`src/lib/totp-pending.exhaustion.test.ts` (no DB; mocks `@/lib/db`, imports the real subject and the real `two-factor`).** The mocked builder chain records the `ciphertext` passed to `.values()`.
- T8 (exhaustion): `select` always yields `[]` and `returning` always yields `[]`. The call rejects with the constant message; `insert` was called exactly 3 times; the rejection message, and everything written to `console.*` spies during the call, contains neither any recorded ciphertext nor its decrypted secret; no value is returned.
- T9 (loser returns the winner's secret): attempt 1 `select` yields `[]`, `returning` yields `[]`; attempt 2 `select` yields a row whose ciphertext is `encryptSecret("WINNERSECRETWINNER")`. The call resolves to that secret and `uri`, and not to the secret it minted in attempt 1 (red on the old helper, which returns its local mint).
- T9b (bounded retry recovers): attempt 1 empty/empty, attempt 2 `select` empty and `returning` yields the row it wrote → resolves on attempt 2 with the decrypted returned ciphertext.

The old replica predicate tests (`shouldReuseRow`) are deleted: they never imported the subject.

## Implementation Order

1. Tests first (T1-T9b), run red against the unfixed helper; capture the failing output in the Phase 4 notes.
2. `totp-pending.ts` fix and docstring; tests green; `npm run typecheck`, `npm run lint`, `npm run check` (zero violations; `check:sql-date` does not apply, no `sql<Date>`; `check:audit` unaffected, no actions file touched).
3. The e2e probe and the running-server gate below.
4. Work-log Phase 4 record; docs reconciliation (TODO lines and DECISION-290, below, are integration-time edits to shared files, applied by the orchestrator at merge per Rule 16).
5. Release notes after Phase 6 SHIP IT via `/release-notes`.

No schema, `FEATURE_CATALOG`, seed binding, route, action, UI or audit step applies.

## e2e blast radius and the Phase 4 gate (treated as auth-touching)

Specs that visit `/account/2fa` and could be affected by any change to enrolment: `invitation-new-account.spec.ts` (reads the secret at line 195 and enrols; the flake's origin), `invitation-existing-account.spec.ts`, `account-page.spec.ts`, `post-login-routing.spec.ts`, `member-home.spec.ts`, `role-boundaries.spec.ts`, `giving-shell.spec.ts`, and `visual-parity.spec.ts` via `e2e/support/routes.ts` (the QR repaints; already a documented time-sensitive route, TODO line 482, no new impact). None asserts a behaviour the fix alters: the page markup, copy, TTL and the secret's lifetime are the same; only the cause of a mismatch between the shown and stored secret disappears. `totp-full-login`, `totp-code-entry`, `totp-recovery-code` use an already-enrolled user and never call the helper; they are run as the login-path smoke.

Flags the gate depends on: none beyond the committed baseline. The new probe reads `/account/2fa` as a signed-in, unenrolled throwaway user and sets no flag, so it adds nothing to `scripts/ci/e2e-baseline-flags.sql`. `invitation-new-account` sets no flag itself (its throwaway org carries `require_two_factor`). If the implementer finds the probe needs `auth.require_2fa` to reach the page, the probe sets it through `e2e/support/flags.ts` with capture-then-restore, and says so in the Phase 4 notes.

Gate (all against the worktree's own dev server, `E2E_BASE_URL=http://localhost:3630`, started by the implementer, stopped by PID; a run that attached to :3000 is discarded):

1. `invitation-new-account` with `--repeat-each=40 --workers=1`: 40 of 40 pass, no retries counted as passes. This is corroborating evidence only (at a 1-in-20 rate, 40 clean runs is about 87% confidence); the deterministic gate is item 3.
2. `totp-full-login` (MFA-enrolled seeded user), plus `totp-code-entry` and `totp-recovery-code`.
3. New `e2e/totp-enrol-concurrency.spec.ts`: for a fresh unenrolled user signed in through the real form, fire 8 concurrent `GET /account/2fa` requests through the page's authenticated request context (`Promise.all`), parse the manual-key `<pre>` from each response, and assert all 8 secrets are identical; then reload in the browser and assert the same secret; repeat for three fresh users. On the old helper this fails with near certainty. (Implementer verifies the secret is present in the server-rendered HTML; if `HydrationGate` defers it, drive 8 parallel pages with `Promise.all(page.goto)` in separate pages of one context instead.)
4. A 360px look at the enrolment page (`/account/2fa` as the unenrolled user): QR code and manual key visible, no horizontal scroll, Playwright screenshot saved to the Phase 4 notes. The markup is unchanged, so this is a regression look, not a design review.
5. Standard: `npm run typecheck`, `npm run lint`, `npm run check`, `npm run test`, `npm run test:db` (at least `totp-pending.test.ts` and the unit suite), `next build`.

QA returns BLOCKED, not PASS, if items 1-3 are deferred.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| Gap 1: empty re-select needs a bounded retry and a defined failure | Addressed: shape of the fix, `MAX_ATTEMPTS = 3`, constant error, never returns an unstored secret; pinned by T8, T9b |
| Gap 2: replica spec cannot fail before the fix; DB-backed regression test | Addressed: Test plan T1-T7 (DB-backed, T1/T2 red on the old helper) and T8-T9b; the replica spec is deleted |
| Gap 3: non-transactional `replaceRecoveryCodes` in `completeEnrollment` | *Deferred* — out of scope as confirmed in Phase 1; filed as a TODO line (below) |
| Gap 4: rotated key must not worsen, never silently re-mint over a fresh row | Addressed: decrypt is outside any catch; T7 pins that the row is untouched |
| Gap 5: stale docstring and header ("shared with `/admin/2fa`") | Addressed: docstring correction under Component / Page Plan; header Surface line corrected |
| Gap 6 (TODO.md:413): `completeEnrollment` has no rate limit | *Deferred* — stays in its existing TODO line; no `checkRateLimit` is added here (Phase 1 ruling) |
| Visual-parity note (TODO.md:482) | Addressed: no new impact; named in the e2e blast radius |
| Must preserve: one stored secret per pending enrolment | Addressed: primary key unchanged; T1, T6 |
| Must preserve: always return what is stored | Addressed: both return paths decrypt a ciphertext read back from the database; T1, T9 |
| Must preserve: a fresh row is never overwritten | Addressed: `do update … where expires_at <= now()`; T3, T4 |
| Must preserve: expiry replacement is itself conflict-safe | Addressed: the same conditional upsert; T2 |
| Must preserve: fresh secret after completion or reset | Addressed: completion and admin reset still delete the row, the next call inserts; T5 |
| Must preserve: no secret leaks, no logging, keyed on session `userId`, no new client channel | Addressed: no logging, constant error message, key on `userId` in both statements; T8, T6 |
| Must preserve: `callbackUrl` sanitising and the `isTotpConfigured` / already-enrolled ordering in `page.tsx` | Addressed: `page.tsx` code is not edited (comment only) |
| Auth-touching treatment: MFA smoke on port 3630, BLOCKED if deferred | Addressed: the e2e gate above |
| Phase 2 skip conditions (no migration, trigger, lock, dependency, invariant) | Addressed: all hold; no transaction, lock or advisory design is used; stop and reopen Phase 2 if that changes |
| Out of scope: other replica specs, TTL, copy, `/admin/2fa`, the 2b `enrolOnPage` workaround | *Deferred* — Phase 1 out-of-scope list, accepted by the user at Phase 1; the workaround removal gets a TODO line |

## Edge Cases & Risks

- Concurrent first render converges on one secret — pinned by T1 (DB). Expiry race converges — T2. Reload within the TTL does not rewrite the row — T3. A fresh row survives a burst — T4. A deleted row yields a new secret — T5. Cross-user isolation — T6. Rotated key surfaces and does not re-mint — T7. Bounded failure with no leak — T8. Loser returns the winner's secret — T9.
- Two tabs, or the double-fetch, in the same millisecond: covered end to end by the concurrent probe (e2e gate item 3).
- A pending row deleted by an admin reset or the cron GC between the read and the upsert: handled by the loop (the next attempt inserts); the deterministic mocked path is T9b; a live deletion race is unverified (not worth a flaky test).
- A decrypt failure inside the loop on a *just written* row cannot occur with a consistent key, because the helper encrypted it a statement earlier; if it did, it rejects (no catch), same as a rotated key.
- Clock: freshness and the TTL now use the database clock inside the helper, while `completeEnrollment` (`actions.ts:88`) compares `expires_at` to the app clock. The skew is far below the 10-minute window and only moves the expiry edge by that skew; unverified, accepted, no test.
- A thrown `Pending two-factor enrolment could not be established` (three consecutive lost attempts, expected only under sustained deletes) falls to Next's default error page; there is no new string, no `error.tsx` is added (the same fall-through as a rotated-key decrypt failure today). Unverified in a browser.
- Neon pool: statements are autocommit and independent; no statement relies on connection affinity. The Drizzle `setWhere` rendering of the column reference (qualified vs bare) must be checked in the generated SQL by the implementer; both are valid in `ON CONFLICT DO UPDATE … WHERE`. T2 would fail loudly if it were not.

## Copy

No user-facing string is added or changed in the product: page text, buttons, toasts and errors are untouched. The constant thrown message is an internal error that is never rendered to the person (Next's default error page shows no message in production), and it is not new product copy.

One release-note line is user-facing and is written here, so it gets the four checks now. Proposed text for the next patch (final wording belongs to `/release-notes` at ship, held to these checks):

> Fixed an occasional problem when setting up two-factor sign-in for the first time: the code from your authenticator app could be refused even though it was correct. The setup page now always shows the key that was saved, so the first code you enter works.

1. *Residuals.* It denies no accepted residual and no Phase 1 ruling: it makes no claim about the unfixed rate limit (Gap 6), the recovery-code replacement (Gap 3) or key rotation; it says "occasional" and "could be", and promises only the stated case (a first-time setup where two requests overlapped).
2. *Source of truth.* The claim that "the page shows the key that was saved" is established by the helper reading the stored `secret_ciphertext` (T1, T9). The line makes no claim about a person's account state or date.
3. *Audience.* Release notes are read by members and administrators; the line asks nobody to do anything.
4. *Neighbours.* Greps of `src/` for `Reload the page`, `did not match` and enrolment copy: `actions.ts:80-92` ("No pending enrollment found. Reload the page to start over.", "Enrollment session expired. Reload the page to start over.", "That code did not match. Try again.") all stay true after the fix (a wrong code or an expired or reset session still produces them); none becomes stale. No file is a modify target for copy.

## Proposed docs reconciliation (integration time, by the orchestrator; shared files)

TODO.md:
- Add: `- [ ] **completeEnrollment: non-transactional recovery-code replacement (adjacent race).** It reads the pending row, verifies, upserts user_totp, deletes the pending row, then replaceRecoveryCodes (delete then insert) with no transaction, so two tabs submitting at once can interleave recovery codes; the client's inFlight guard covers one tab only. Fix with one transaction, with the rate limit (Gap 6) in the same edit. — docs/work-log/2026-10-26-totp-enroll-race.md Phase 1 gap 3`
- Keep the Gap 6 line (`docs/TODO.md:413`) unchanged.
- Amend item (12) of the test-coverage punch list (`docs/TODO.md:213`): `totp-pending.test.ts` is now a real DB-backed spec; only `admin/users/[id]/actions.test.ts` remains a replica.
- Add: `- [ ] **Remove the invitation-new-account enrolOnPage reload-and-retry workaround (Community 2b) once the totp-enroll-race fix is merged.**`
- Move the pipeline's own line to Done at ship.

decisions.md, DECISION-290 (implementation entry, newest first): "A pending two-factor secret is created by one conditional upsert (`on conflict (user_id) do update … where expires_at <= now() returning`), never by find-then-write, and the page shows only a ciphertext read back from the database. Rejected: `do nothing` + re-select (does not replace an expired row), and a lock or transaction (reopens Phase 2, unneeded under READ COMMITTED). Bounded to 3 attempts, then a constant error; never returns an unstored secret."

## Implementer

**full-stack-developer** (small, coupled: one helper, two spec files and one e2e probe; no schema, route or UI work). Release: **the next patch** after the current queue (0.46.0 developer portal, 0.46.1 F289, 0.46.2 ingest, 0.47.0 careers).

---

# Phase 4 — Implementation

Implementer: full-stack-developer. Two commits: the tests first (red), then the fix.

## Files Created

- `src/lib/totp-pending.exhaustion.test.ts` — scripted-database spec (T8, T9, T9b); runs in plain `npm test`.
- `e2e/totp-enrol-concurrency.spec.ts` — the concurrent-fetch probe (three fresh throwaway users; the third at 360px).

## Files Modified

- `src/lib/totp-pending.ts` — find-then-upsert replaced by the bounded conditional-upsert loop (`MAX_ATTEMPTS = 3`); docstring corrected (sole caller is `/account/2fa`; contract stated).
- `src/lib/totp-pending.test.ts` — replaced wholesale: the replica spec is deleted; now a DB-backed spec, T1-T7.
- `src/app/(account)/account/2fa/page.tsx` — comment only ("the page shows what the database holds").

## Schema Changes

None. No migration (0080 unused), no grant, no constraint. `schema.ts` untouched.

## Audit Events

None (minting a pending secret is not audited; `TOTP_ENROLLED` and the admin reset already are). No new env var, `FEATURES` entry or flag.

## Phase 4 open items, resolved

1. **`setWhere` SQL** (inspected with `.toSQL()`): `insert into "user_totp_pending_enrollments" ("user_id", "secret_ciphertext", "expires_at", "created_at") values ($1, $2, now() + make_interval(mins => $3), default) on conflict ("user_id") do update set "secret_ciphertext" = excluded.secret_ciphertext, "expires_at" = excluded.expires_at, "created_at" = now() where "user_totp_pending_enrollments"."expires_at" <= now() returning "secret_ciphertext"`; params `[userId, ciphertext, 10]`. Valid; the column is table-qualified, which is legal in `ON CONFLICT DO UPDATE ... WHERE`. T2 and T4 run it against Neon.
2. **The secret is in the server-rendered HTML.** The probe parses the `<details> ... <pre>` of the raw `GET /account/2fa` response bodies (no hydration involved), so no alternative probe design was needed.

## Red then green

- Tests-first commit `264af63` was run against the unfixed helper: **6 of 10 failed** — T1 (16 distinct secrets from 16 parallel calls), T2 (16), T6 (7 and 8 distinct for the two users across runs), T8 (resolved instead of rejecting), T9 (returned its own minted secret `2BRAZGR2...`, not `WINNERSECRETWINNER`), T9b (1 insert, expected 2). T3, T4, T5, T7 passed on the old helper as the design predicted (pins). After the fix: 10 of 10, run 5 consecutive times, green every time.
- The e2e probe against the unfixed helper (the old file restored in the working tree, dev server hot-reloaded): **3 of 3 failed**, "eight concurrent renders showed 3 different keys" (user c; a and b similar). After the fix: 3 of 3 pass, repeated in a second run.

## Gates (own dev server :3630, own Neon branch `pipeline-totp-enroll-race`; stopped by PID 81478; prod lane :3631 stopped by Playwright)

- `npm run typecheck`, `npm run lint`: clean. `npm run check`: exit 0 (brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports and the rest all passed).
- `npm run test`: 610 files passed, 84 skipped (DB-backed); 9253 tests passed.
- `npm run test:db` on `totp-pending.test.ts`, `totp-pending.exhaustion.test.ts` and `two-factor*`: 3 files, 40 tests passed.
- Full serial `npm run test:db` (about 30 minutes, run twice). Run 1 as the worktree's `.env.local` stands: 689 of 694 files passed, 5 failed, all environment: this worktree's `.env.local` sets `NEXT_PUBLIC_APP_URL=http://localhost:3630` while `issue.db.test.ts`, `(member)/feedback/actions.test.ts` and `(org)/o/[slug]/tickets/actions.test.ts` assert an absolute link on `http://localhost:3000` (those 16 files that mention `localhost:3000` pass 338 of 338 with `NEXT_PUBLIC_APP_URL=http://localhost:3000`). Run 2 with that override: **693 of 694 files, 11860 of 11862 tests passed (1 skipped)**; the single failure is `src/proxy.test.ts > the platform-host set (R2) > treats loopback as the platform outside a production deployment`, which also fails when run alone with `.env.local` loaded and passes in the plain `npm run test` run (no `.env.local`; it is in the 610 passed files): the same worktree-env cause, in a file this change does not touch or import. No test touching `totp-pending` failed in either run.
- Running-server e2e (`E2E_BASE_URL=http://localhost:3630`, `AUTH_URL` the same, `RATE_LIMIT_DISABLED`, `DOMAINS_*` fakes, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `E2E_ALLOW_SHARED_DB`; nothing ran against :3000): `totp-enrol-concurrency` 3/3, `totp-full-login` (MFA-enrolled user), `totp-code-entry` (all 17), `totp-recovery-code` 2/2, `totp-callback-bypass` 7/7: **31 of 31 passed**.
- `invitation-new-account --repeat-each=40 --workers=1` (no retries): **40 of 40 passed** (4.7 minutes).
- Hydration lane on the production build, :3631 (`PW_PROD_BUILD=1 PW_PROD_PORT=3631`): `hydration/totp-challenge.spec.ts` 1/1. No hydration spec covers `/account/2fa` itself; none was added (markup unchanged).
- 360px look: the probe's third user runs at 360x740 and asserts `scrollWidth - clientWidth <= 0`, the QR code and the manual key visible. Screenshot looked at: heading, steps, QR, key, six boxes and the confirm button all inside the viewport, no horizontal scroll (the circle at the left is the Next dev indicator). Saved at `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/enrol-360.png`.

## Implementer Notes

- Deviations from the design: none in behaviour. Two small points. (a) The scripted-database spec's mock also answers the pre-fix `db.query...findFirst`, so the same file can run red against the old helper for the right reason; harmless against the new one. (b) The probe signs in through the real form and then deletes the row the sign-in navigation created before firing the eight GETs, so the render is a true first render; the first user also enrols with a code computed from the shown key, which proves shown equals stored from the person's side.
- The probe creates its own throwaway `e2e-enrol-<stamp>-<tag>@example.invalid` users (deleted in `afterAll`; stale ones swept by prefix and age at start), so it adds nothing to `e2e-baseline-flags.sql` and touches no roster user.
- Concurrency evidence on the DB is the 16-way parallel calls on a pool of 10; the READ COMMITTED argument (loser re-evaluates the WHERE against the winner's committed row) is what T1/T2/T4 exercise, not a mock.
- Rule 16 files not edited. Proposed TODO / DECISION-290 / TODO #12 amendment text is already in the Phase 3 "Proposed docs reconciliation" and stands unchanged; the orchestrator applies it at integration.
- Residuals unchanged from Phase 3 (app clock vs DB clock at `completeEnrollment`; a live delete-between-statements race is covered only by the scripted T9b).

Strings added or changed: none.

# Phase 5 — Verification (qa)

**Date:** 2026-10-26
**Verified by:** qa

I ran everything myself on worktree `/Users/cshenso/git/presby-platform/presby-enroll` at HEAD `d35630c`, Neon branch `pipeline-totp-enroll-race` (`ep-broad-smoke`, confirmed by host before any write). Servers ran on my own :3630 (dev) and :3631 (prod lane), and nothing touched :3000. Both dev servers were started by hand with `.next/dev` cleared, and each was stopped by PID. The old-helper server was PIDs 41670/41701/41721/41741, serving from the scratch copy (cwd confirmed with `lsof`). The HEAD server was PIDs 42352/42368/42369/42370/42446, serving from the worktree. Playwright started and stopped the prod-lane server itself. Both ports are free and `git status` is clean.

**Flag state:** before any e2e run I reset global flags to the CI baseline with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`. It ran against this worktree's `PLATFORM_DATABASE_URL` only, after a guard that refused unless the host was `ep-broad-smoke`. It committed, and I listed the flag states afterwards.

**Disk:** 560 GiB free, so ENOSPC was not a factor.

**Scope run:**
- **In full:** typecheck, lint, `npm run check`, the unit suite, and the full `--project=chromium` e2e suite (at the orchestrator's request).
- **DB-backed:** only `totp-pending.test.ts`, `totp-pending.exhaustion.test.ts` and `two-factor*`. I did not re-run the full serial `npm run test:db`. That result rests on the implementer's run (693 of 694 files with the `NEXT_PUBLIC_APP_URL` override; the one failure is diagnosed below).
- **Prod lane:** only `e2e/hydration/totp-challenge.spec.ts`.
- **Not run:** the `custom-hosts` and `prod-custom-hosts` projects (the diff touches nothing on host routing). The PR's CI covers them.

## Type Check

`npm run typecheck`: **PASS** (exit 0). `npm run lint`: **PASS** (exit 0, `--max-warnings=0`). `npm run check`: **PASS**, exit 0, all eight tripwires passed (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports).

## Unit Tests

Total: 11862 | Passed: 9253 | Failed: 0 | Skipped: 2609 | Duration: 32.8s
- Files: 610 passed, 84 skipped. The 84 are the DB-backed files, which `describe.skipIf(!hasDb)` skips when `.env.local` is not loaded. The skip is by design, not a finding. I ran the files that matter to this change under `test:db` below.

**DB-backed, serial (`npm run test:db`):** `totp-pending.test.ts`, `totp-pending.exhaustion.test.ts`, `two-factor*`: **40 of 40, five consecutive runs, green every time.**

**Failing first, reproduced independently.** I built a `git archive HEAD` copy under the scratchpad (since deleted by literal path) and restored `src/lib/totp-pending.ts` from `264af63^`. The spec files were byte-identical to HEAD. I ran it three times, and all three gave the same result: **6 failed, 4 passed.**

| Spec | Result on the old helper (runs 1/2/3) |
|---|---|
| T1 | 16 distinct secrets from 16 parallel calls (16/16/16) |
| T2 | 16/16/15 distinct |
| T6 | 8 distinct for one user |
| T8 | resolved instead of rejecting |
| T9 | returned its own minted secret, not `WINNERSECRETWINNER` |
| T9b | 1 insert, expected 2 |
| T3, T4, T5, T7 | passed on the old helper, as the design predicted (they pin preserved behaviour) |

This confirms the red-then-green claim for T1, T2, T6, T8, T9 and T9b.

**Is it the property or the fix's logic?** T1, T2 and T6 assert the property: every caller gets the one stored secret, and it decrypts from the stored row. Any find-then-write variant in the same class would fail them, not just the literal old code. T8's `insertCalls === 3` encodes the design's `MAX_ATTEMPTS` constant. That is acceptable, because the bound is itself a design requirement.

## End-to-End Tests

All runs used my own servers at `E2E_BASE_URL`/`AUTH_URL` = `http://localhost:3630`, with `RATE_LIMIT_DISABLED=true`, the `DOMAINS_*` fakes, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET` and `E2E_ALLOW_SHARED_DB=true`. `--retries=0` was used where it applies.

| Run | Server | Result |
|---|---|---|
| `totp-enrol-concurrency.spec.ts` | old helper (scratch copy) | **3 of 3 failed**: "eight concurrent renders showed 2 / 5 / 3 different keys" (users a/b/c) |
| `totp-enrol-concurrency` + `totp-full-login` + `totp-code-entry` + `totp-recovery-code` + `totp-callback-bypass` | HEAD | **31 of 31 passed**, run twice (41.2s, 37.6s) |
| `invitation-new-account --repeat-each=40 --workers=1` | HEAD | **40 of 40 passed** (4.4m) |
| full `--project=chromium` | HEAD | **463 passed, 0 failed, 0 skipped** (16.0m) |
| `totp-enrol-concurrency` (for the 360px screenshot) | HEAD | 3 of 3 passed |
| `hydration/totp-challenge.spec.ts`, prod build | :3631 (`PW_PROD_BUILD=1 PW_PROD_PORT=3631`) | **1 of 1 passed** |

- `totp-full-login` uses `E2E_USERS["mfa-enrolled"]` and walks password → `/totp` (a wrong code is refused, then the real code is accepted) → the post-login landing. That meets the auth-touching gate.
- The 40 repeat runs are meaningful: this branch's `invitation-new-account.spec.ts` has no `enrolOnPage` reload-and-retry workaround. Its only `reload` calls are in the invitation preview step, lines 80-83.
- **360px:** I looked at the screenshot myself, saved at `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-enroll-pw-360/totp-enrol-concurrency-con-14322-hows-it-again-fresh-user-c--chromium/enrol-360.png`. The heading, steps, QR code, manual key, six boxes and Confirm button all sit inside the 360px viewport. The spec also asserts `scrollWidth - clientWidth <= 0`.

**`src/proxy.test.ts` loopback case: environmental, pre-existing, not this pipeline.**
- **Where:** `src/proxy.test.ts:429-440` ("treats loopback as the platform outside a production deployment…") fails at line 435: `expected undefined to be '/site/localhost/signin'`.
- **Cause:** the platform-host set includes the host of `NEXT_PUBLIC_APP_URL` (`src/lib/domains/host.ts:131`). The test pins only `NEXT_PUBLIC_PLATFORM_HOSTS` (line 42) and never stubs `NEXT_PUBLIC_APP_URL`. So any loopback `NEXT_PUBLIC_APP_URL` puts `localhost` into the set, and the `VERCEL_ENV=production` half of the test sees loopback as the platform.
- **Evidence:**
  - With `.env.local` loaded, it fails with `NEXT_PUBLIC_APP_URL` at `localhost:3630` and also at `localhost:3000`.
  - With `NEXT_PUBLIC_APP_URL=https://portal.example.invalid` over `.env.local`, all 41 pass.
  - Without `.env.local` at all, all 41 pass.
- **CI is unaffected:** neither `db.yml` nor `ci.yml` sets `NEXT_PUBLIC_APP_URL`.
- **Not caused by this diff:** it touches nothing in `src/proxy*` or `src/lib/domains/`.
- **Correction to Phase 4:** the cause is any loopback app URL, not port 3630 specifically.
- **Suggested follow-up (test hermeticity):** stub `NEXT_PUBLIC_APP_URL` in that `describe`.

## Regression Tests Added

- `T1 concurrent first render: every caller gets the one stored secret — regression for F342 enrolment secret race` — `src/lib/totp-pending.test.ts:97`. Guards against concurrent first renders returning secrets the database does not hold. Red on the old helper (confirmed above).
- `T2 expiry race: concurrent callers replace an expired row with one new secret — regression for F342 enrolment secret race` — `src/lib/totp-pending.test.ts:113`. Guards against the same race when an expired row is replaced. Red on the old helper.
- `T6 two users interleaved…` — `src/lib/totp-pending.test.ts:177`. Guards one secret per user and cross-user separation. Red on the old helper.
- `T8 exhaustion…` / `T9 the loser returns the winner's stored secret…` / `T9b a row deleted between the statements…` — `src/lib/totp-pending.exhaustion.test.ts:85`, `:112`, `:124`. These guard the bounded attempts, the absence of any leak, and that a losing caller returns the winner's stored secret. All red on the old helper.
- T3, T4, T5 and T7 (`totp-pending.test.ts:136`, `:148`, `:163`, `:197`) pin preserved behaviour: no rewrite of a fresh row, survival of a fresh row under a burst, a new secret after a reset, and no re-mint over an undecryptable row.
- `e2e/totp-enrol-concurrency.spec.ts:91` runs end to end: 8 concurrent GETs show one key, a reload shows it again, there is one pending row, a code computed from the shown key enrols (user a), and the page is checked at 360px (user c). Red on the old helper (confirmed above).

None of the six red tests carries the `— regression for …` name suffix except T1 and T2. That is minor, not a FAIL: the suffix rule names the primary regression test, and those two carry it.

**Helper review (`src/lib/totp-pending.ts`):**
- **No leaks:** there is no `console.*`, logger or `cause` in the file. The single thrown message is the constant `"Pending two-factor enrolment could not be established"` (line 111), with no user id, secret, ciphertext or URI. T8 pins the message, the stack and every console channel.
- **Database clock:** the freshness read uses `gt(expiresAt, sql\`now()\`)`, and the TTL is `now() + make_interval(mins => $3)`. There is no `new Date()` in the helper.
- **`setWhere` SQL, checked independently.** I ran the real HEAD helper against a capturing `drizzle-orm/pg-proxy` driver in the scratch copy, exhausting all attempts. It emitted 6 statements (3 × select + upsert):
  ```
  select "secret_ciphertext" from "user_totp_pending_enrollments" where ("user_totp_pending_enrollments"."user_id" = $1 and "user_totp_pending_enrollments"."expires_at" > now()) limit $2
  insert into "user_totp_pending_enrollments" (...) values ($1, $2, now() + make_interval(mins => $3), default) on conflict ("user_id") do update set "secret_ciphertext" = excluded.secret_ciphertext, "expires_at" = excluded.expires_at, "created_at" = now() where "user_totp_pending_enrollments"."expires_at" <= now() returning "secret_ciphertext"
  ```
  The params are `[userId, <ciphertext>, 10]`, so the TTL is bound as a parameter, not built into the string. The live behaviour of this SQL is exercised by T2 and T4 against Neon.
- **Bounded attempts:** exactly 3 passes and then the throw, confirmed both by the capture above and by T8.
- **Cross-user isolation:** `getOrCreatePendingEnrollment` has one caller, `src/app/(account)/account/2fa/page.tsx:120`, which passes `session.user.id`. Both statements key on `user_id = $1`, and the conflict target is `user_id`.
  - **Live catalog, probed as `presby_app`** (`rolbypassrls = f`) on the app connection:
    - `user_totp_pending_enrollments` has `relrowsecurity = f` and `relforcerowsecurity = f`, with no policies and no triggers.
    - `aclexplode(relacl)` gives `presby_app` SELECT/INSERT/UPDATE/DELETE. That is sufficient for `ON CONFLICT DO UPDATE … RETURNING`.
    - The PK is `(user_id)` and the FK to `users(id)` is `ON DELETE CASCADE`.
    - `transaction_isolation` is `read committed`, which the design's argument depends on.
  - So isolation on this platform table rests on the query keys, not RLS. That posture predates this change, which alters no schema. T6 demonstrates it on the live database.

## Coverage on Critical Modules

Measured with `vitest --coverage` (v8) under `test:db` over the totp-pending, two-factor, permissions and flags specs:
- `src/lib/permissions.ts`: 100% statements / 100% branches (target 100%, met)
- `src/lib/two-factor.ts`: 91.3% statements / 100% branches (target 90%+, met)
- `src/lib/flags.ts`: 100% / 100% (target 100%, met)
- `src/lib/totp-pending.ts` (changed module): 100% statements / 100% branches / 100% functions

## Feature-Gate Audit

**No protected routes touched.** The diff adds or changes no `route.ts` and no `"use server"` action. `src/app/(account)/account/2fa/page.tsx` changes by a comment only (lines 117-119). Its existing `auth()` check and redirect (lines 30-31) and `sanitizeCallbackUrl` (line 34) are unchanged. `/account/2fa` is auth-only by design, with no `FEATURES` gate.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `/account/2fa` page (comment-only change) | yes (unchanged, `page.tsx:30`) | n/a (auth-only by design) | n/a |

## Copy Truthfulness

**No strings changed.** `git diff -U0 origin/main...HEAD` over `.tsx`, `*-copy.ts`, email templates and release notes adds only the three-line code comment in `page.tsx`, which is not rendered. The one future user-facing string is the release-note line drafted in Phase 3. It is not in this diff and gets its four checks at `/release-notes` time.

- [x] Every added or changed string is in the design's Copy table (none added)
- [x] The query behind each claim was opened (n/a: no claims)
- [x] Each instruction was traced to its role (n/a: no instructions)
- [x] Older strings about the same subject were grepped, and none is made false. `actions.ts`'s "No pending enrollment found…", "Enrollment session expired…" and "That code did not match…" all stay true.

## Verdict

**PASS**

This is treated as auth-touching under the Phase 1/3 ruling. I ran the e2e myself against a real dev server with the MFA-enrolled seeded user (`totp-full-login`: password → TOTP → landing). Every spec I ran passed with none skipped:
- the probe and login-path specs, 31 of 31, twice
- `invitation-new-account`, 40 of 40
- the full chromium project, 463 of 463
- the prod-lane `totp-challenge`, 1 of 1

The failing-first property is independently confirmed on two levels:
- **Unit and DB specs:** T1, T2, T6, T8, T9 and T9b were red on the old helper in 3 of 3 runs and green on HEAD in 5 of 5.
- **e2e:** the concurrency probe was 3 of 3 red on an old-helper server and green on HEAD.

Residuals I did not verify, all already named in Phase 3:
- the app clock (`completeEnrollment`, `actions.ts:88`) versus the database clock
- a live delete-between-statements race, which only the scripted T9b covers
- the exhaustion error reaching Next's default error page, not looked at in a browser

Non-blocking follow-up for the orchestrator's TODO: `src/proxy.test.ts:429` should stub `NEXT_PUBLIC_APP_URL` so that a loopback app URL in a worktree's `.env.local` cannot fail it.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete | PASS | 2026-10-26 |

## Handoff

Next: **analyst (Phase 6, shipped vs intent).**

Evidence logs are all in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/`:
- `qa-enroll-unit.log`
- `qa-enroll-inv40.log`
- `qa-enroll-full.log`
- `qa-enroll-prod.log`
- `qa-enroll-sql.txt`
- `qa-enroll-dev-old.log`
- `qa-enroll-dev-head.log`
- `qa-typecheck.log`
- `qa-lint.log`
- `qa-check.log`

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
