# Bug fix: admin 2FA page remints secret on every render

**Slug:** admin-2fa-remint
**Started:** 2026-05-18
**Source:** Code review finding N-3 (docs/reviews/2026-05-17-code.md)

---

## Phase 1 — Functional Refinement (brief, bug-fix variant) — 2026-05-18

**Owner:** analyst (brief)
**Status:** complete

Bug confirmed real: `src/app/(admin)/admin/2fa/page.tsx` lines 131-149 ran
`generateSecret() → encryptSecret() → db.insert(...).onConflictDoUpdate()`
unconditionally on every server render, overwriting the pending row with a new
secret every time the page loaded.  A user who scanned the QR code then
reloaded (e.g. on a slow network or after a browser back/forward) would receive
a new secret in the DB while their authenticator still had the old one — causing
the confirm step to fail indefinitely.

The account page (`src/app/(account)/account/2fa/page.tsx`) already handled
this correctly: it queries for an unexpired pending row first and only mints
fresh when necessary.

Fix preserves intended behavior: expired rows still get replaced, the TTL
semantics are unchanged, and the confirm action continues to read from the DB.

**Verdict:** READY FOR IMPLEMENTATION (trivial bug — no architectural impact)

---

## Phase 2 — Architectural Review — 2026-05-18

**Owner:** architect
**Status:** skipped (documented)

Fix touches no invariants: no new tables, no new dependencies, no server/client
boundary changes, no middleware impact.  The fix is a pure consolidation of
existing DB + crypto logic into a shared helper.  Phase 2 skipped per CLAUDE.md
bug-fix variant rules.

---

## Phase 3 — Technical Design (brief) — 2026-05-18

**Owner:** tech-lead (brief)
**Status:** complete

Root cause: the always-mint path on the admin page was copied from an earlier
version of the account page before the "check-then-reuse" logic was added.
The account page was then fixed; the admin page was not.

Fix shape: extract a shared helper `getOrCreatePendingEnrollment(userId, email)`
into `src/lib/totp-pending.ts`.  Both pages delegate to the helper.  This is
the DRY approach — it makes a future divergence structurally impossible.

Alternatives considered:
- Duplicate the if/else block from the account page into the admin page: simpler
  but leaves two copies to maintain.
- Move `prepareEnrollment` from `account/2fa/actions.ts` to the shared lib:
  that function is a server action wrapper and carries `"use server"` semantics;
  mixing it into a plain lib module would be confusing.

Decision: new `src/lib/totp-pending.ts` with no Next.js imports — pure DB +
crypto — makes it straightforward to unit-test without mocking server internals.

---

## Phase 4 — Implementation (full-stack) — 2026-05-18

**Owner:** full-stack-developer
**Status:** complete

### Summary

Extracted `getOrCreatePendingEnrollment` as a shared helper in
`src/lib/totp-pending.ts`.  Both enrollment pages now call the helper, ensuring
identical "reuse-or-mint" behavior.  A regression test verifies the reuse
predicate correctly returns `true` for multiple calls within the TTL window.

### What I did

- Created `src/lib/totp-pending.ts` with `getOrCreatePendingEnrollment` and
  the exported `PENDING_TTL_MINUTES` constant.
- Fixed `src/app/(admin)/admin/2fa/page.tsx`: replaced the always-mint block
  (lines 131-152 before this fix) with a call to `getOrCreatePendingEnrollment`.
  Removed local `PENDING_TTL_MINUTES` constant and unused imports
  (`encryptSecret`, `generateSecret`, `otpauthUrl`, `userTotpPendingEnrollments`).
- Updated `src/app/(account)/account/2fa/page.tsx`: replaced the inline
  check-then-reuse block and its dynamic `import("@/lib/two-factor")` call with
  a call to `getOrCreatePendingEnrollment`.  Removed now-unused
  `prepareEnrollment` import and local `PENDING_TTL_MINUTES` constant.
- Created `src/lib/totp-pending.test.ts` with 9 tests covering:
  - H1: stable-secret guarantee — `shouldReuseRow` returns `true` for both
    first and second render within the TTL window (the exact regression case).
  - H2: both pages use identical logic — verified the predicate produces the
    same answer regardless of which call path exercises it.

### Outputs

- `src/lib/totp-pending.ts` — new shared helper (created)
- `src/lib/totp-pending.test.ts` — regression tests (created)
- `src/app/(admin)/admin/2fa/page.tsx` — bug fix applied (modified)
- `src/app/(account)/account/2fa/page.tsx` — migrated to shared helper (modified)

No schema changes.  No new env vars.  No new FEATURES entries.

### Gate results

- `npm run typecheck`: 2 pre-existing errors in `src/lib/two-factor.test.ts`
  (unrelated to this fix, present on `main` before these changes); no new errors.
- `npm run build`: clean, all 18 routes compile.
- `npx vitest run`: 139/139 passing (test count grew with this fix's 9 new tests).

### Open questions / handoff notes

- Browser smoke test: sign in as an admin user without 2FA enrolled, load
  `/admin/2fa`, scan the QR code, reload the page, verify the QR code is
  identical (same secret shown in the manual-entry `<details>`).  Confirm the
  code from the authenticator app still verifies after the reload.
- The account page (`/account/2fa`) has the same behavior and should be tested
  the same way.
- The pre-existing typecheck errors in `src/lib/two-factor.test.ts` (otplib
  `OTPGenerateOptions.type`) should be addressed in a separate cleanup — they
  are not related to this fix.
- Next agent: **qa** (Phase 5).

---

## Phase 5 — Test Verification (qa) — pending

## Phase 6 — Shipped vs Intent (analyst) — pending
