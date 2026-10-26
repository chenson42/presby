# Two-factor enrolment secret race — Work Log

> **Slug:** `2026-10-26-totp-enroll-race`
> **Surface:** (account) `/account/2fa` enrolment, and the shared helper used by `/admin/2fa`
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
| 2 — Architectural review | architect | **Skipped** — fix is a conflict-safe insert plus re-select inside `getOrCreatePendingEnrollment`; no schema, dependency or invariant change (reopens if a migration, trigger or lock is proposed) | — | 2026-10-26 |
| 3 — Technical design | tech-lead | In progress | — | 2026-10-26 |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
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

## Summary

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| [gap or ruling] | [section, or deferred + who accepted] |

## Edge Cases & Risks

- [Thing that could fail or that needs special handling; each claim cites the test that pins it or says "unverified"]

## Copy

- [Every user-facing string, checked against the accepted residuals: copy may not deny a residual the record admits]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

Strings added or changed: [file:line each, or "none"]

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Copy Truthfulness

*(Every run whose diff adds or changes a user-facing string; write "no strings changed" otherwise. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role.)*

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

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
