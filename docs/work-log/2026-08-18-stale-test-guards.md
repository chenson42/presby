# Stale Test Guards from the Driver Switch and the Roll Read Path — Work Log

> **Slug:** `2026-08-18-stale-test-guards`
> **Surface:** none (test files only)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — Phase 2 skipped (no invariant touched, no
> dependency, no structural change); Phase 3 folded into Phase 1 (root cause is
> the whole design)

> **Agent note:** this session runs under an operator instruction not to spawn
> subagents. Every phase below was executed inline by the main session rather
> than by its named agent. The phase content is unchanged; only the executor is.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (inline) | Complete | READY FOR DESIGN | 2026-08-18 |
| 2 — Architectural review | architect | Skipped — no invariant, dep, or structural change | — | 2026-08-18 |
| 3 — Technical design | tech-lead (inline) | Complete (brief) | — | 2026-08-18 |
| 4 — Implementation | full-stack-developer (inline) | Complete | — | 2026-08-18 |
| 5 — Verification | qa (inline) | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst (inline) | Complete | SHIP IT | 2026-08-18 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> Two unit tests encode constraints that stopped being true — one when the
> driver changed, one when the roll read path landed — so `npm test` is red on
> `main` and the pre-push gate will not stamp.

## The bug is real

`npm test` on `aa0028f`: **2 failed | 423 passed (425)**. Both failures are the
tests, not the code under test.

**Failure 1 — `src/app/(email-verify)/account/verify-email/[token]/page.no-db-transaction.test.ts`**

The test greps the page source and asserts it never contains
`await db.transaction(`. That guard was written for BUG-1
(`docs/work-log/2026-07-01-verify-email-neon-http-transaction.md`), when the app
ran on the **neon-http** driver, where `db.transaction()` throws *"No
transactions support in neon-http driver"* at runtime — a failure TypeScript
cannot see.

presby has since moved to the **neon-serverless WebSocket pool**
(`src/lib/db/index.ts:2`), and the move was not optional: F28 established that
neon-http cannot carry a transaction-scoped GUC, so it cannot carry the org id
that every RLS policy reads. The isolation model chose the driver. On that
driver `db.transaction()` is supported, and the page now uses one deliberately
— `page.tsx:74` carries the comment *"A real transaction, not db.batch(): batch
was a neon-http affordance."*

So the code is correct and the test asserts a constraint the project has
explicitly left behind.

**Failure 2 — `src/app/api/cron/maintenance/route.test.ts:93`**

Asserts `db.execute` is called exactly 3 times. The route made 3 parallel
`DELETE`s when the test was written. `ad5dbb7` ("feat(roll): complete the roll
read path") added a fourth call — `presby_reconcile_current_roll()` at
`route.ts:72` — which is the F29 drift remedy and is supposed to be there. The
route is right; the number is stale.

## Why this matters beyond a red suite

Neither failure is a product defect, but both are the *same* defect in the
process: a commit changed behavior and left a test asserting the old behavior.
The v0.7.0 release notes claim "425 unit tests" passing, so the suite went red
somewhere between that release and now without anyone noticing — which is
exactly what CI on push is meant to catch, and CI has never run because the
repo has no remote.

## Gaps the Request Didn't Address

- **Deleting a test reduces coverage.** For failure 1 the honest answer is that
  the thing being guarded can no longer happen, so the guard is not coverage —
  it is a tripwire for a driver the project does not use. Removing it is
  correct; weakening it to "assert nothing" would be worse.
- **A bare call-count assertion is fragile by construction.** Failure 2 will
  recur the next time the route gains a statement. The fix should assert *what*
  runs, not only *how many*.

## Out of Scope

- The `next-auth` beta.32 upgrade (2 critical advisories). Tracked separately in
  `docs/TODO.md`; needs its own auth pipeline with a running-server e2e gate.
- The TODO backlog item "consider a `db.transaction(`-with-neon-http grep
  tripwire". That item predates the driver switch and is now moot for the app
  connection; left in place for a future reviewer to close deliberately.

## Open Questions

None.

---

# Phase 2 — Architectural Review (architect)

**Skipped.** Test-only change: no new dependency, no directory added, no
server/client boundary moved, no invariant touched. Recorded per CLAUDE.md
("Skipping a phase requires explicit notation in the work-log").

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Delete the obsolete driver guard; make the cron-route assertion describe the
route's actual contract instead of counting calls.

## Data Model

No schema changes required.

## Files to Modify

- **Delete** `src/app/(email-verify)/account/verify-email/[token]/page.no-db-transaction.test.ts`
- **Modify** `src/app/api/cron/maintenance/route.test.ts` — assert 4 statements
  and identify the fourth as the roll reconcile; assert the summary carries
  `rollCacheRolledForward`

## Edge Cases & Risks

- The 200-counts test stubs three `mockResolvedValueOnce` values; the fourth
  call falls through to the default `{ rows: [] }`, so `rollCacheRolledForward`
  resolves to `0` via the `?? 0` fallback. Stub the fourth explicitly so the
  test proves the roll count is read, not that it defaults.

## Implementer

full-stack-developer (executed inline).

---

# Phase 4 — Implementation

## Files Deleted

- `src/app/(email-verify)/account/verify-email/[token]/page.no-db-transaction.test.ts`
  — guarded a neon-http constraint that no longer applies (F28 driver switch)

## Files Modified

- `src/app/api/cron/maintenance/route.test.ts` — call-count 3 → 4; the count
  assertion now also asserts the fourth statement is
  `presby_reconcile_current_roll`; the 200-counts test stubs the reconcile
  return and asserts `rollCacheRolledForward` is read from it

## Schema Changes

None.

## Audit Events

None — no mutation touched.

## Implementer Notes

The count assertion was kept (a dropped statement should still fail) but is no
longer the only thing asserted, so the next added statement fails with a message
that says which statement is missing rather than "expected 3, got 4".

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-18
**Verified by:** qa (inline)

## Type Check

`npm run typecheck`: PASS

## Unit Tests

Total: 424 | Passed: 424 | Failed: 0 | Duration: ~0.9s

(425 → 424 because the obsolete driver-guard test was deleted, not replaced.)

Before the fix (`aa0028f`): 2 failed | 423 passed (425) —
`route.test.ts:93` and `page.no-db-transaction.test.ts:13`.

## Regression Tests Added

- `route.test.ts` — "runs the roll-cache reconcile as the fourth statement"
  guards against: the F29 reconcile being dropped from the maintenance cron, and
  against the assertion going stale on the next added statement.

## End-to-End Tests

Not run — no route behavior, no auth path, and no UI changed. This diff touches
test files only.

## Feature-Gate Audit

No protected routes touched.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> The suite is green again, and the one assertion worth keeping now describes
> the route's contract instead of counting its statements.

## Intent-vs-Shipped Diff

- Phase 1 said: remove a guard that cannot fire and correct a stale count.
  Shipped: exactly that, plus the count assertion strengthened to name the
  fourth statement. Verdict: matches.

## Edge Cases

- Empty state: not applicable
- Failure microcopy: not applicable
- Permission gate: not applicable
- Audit event: not applicable
- Mobile (360px): not applicable

## Follow-Ups

None. The two out-of-scope items in Phase 1 are already tracked in
`docs/TODO.md`.
