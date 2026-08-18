# BUG-1: verify-email uses `db.transaction()` on the neon-http driver — Work Log

> **Slug:** `2026-07-01-verify-email-neon-http-transaction`
> **Surface:** (email-verify)
> **Permission(s):** none — no permission change
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-07-01 |
| 2 — Architectural review | architect | Skipped (see notation) | N/A | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | Design ready | 2026-07-01 |
| 4 — Implementation | api-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Bug Report (intake, 2026-07-01)

`src/app/(email-verify)/account/verify-email/[token]/page.tsx:64` wraps the
email-swap mutation in `await db.transaction(...)`, but the DB connection
(`src/lib/db/index.ts`) uses `drizzle-orm/neon-http`, which does not support
interactive transactions. The call throws `No transactions support in
neon-http driver` at runtime — the email-change verification flow breaks the
moment a user clicks the link in their confirmation email.

**Why tests never caught it:** unit tests mock `db`, and the mock's
`transaction` happily succeeds. Only a real DB call surfaces it. This is a
known class of defect — the starter's own admin code documents and avoids the
constraint (`src/app/(admin)/admin/users/[id]/actions.ts:73-75`), so the
verify-email page is an internal inconsistency.

**Discovery trail:**
- Flagged in `docs/reviews/2026-07-01-starter-contribution-triage.md` (BUG-1)
  and carried as a tracked follow-up in the Phase 6 close-out of
  `docs/work-log/2026-07-01-post-login-routing-and-e2e.md`.
- Independently hit and fixed downstream: explore.press commit `d55a165`
  (Caught-By: human-review, Discovered-In: post-merge) replaced the
  transaction with `db.batch([...])`, which neon-http executes as a single
  atomic server-side transaction. huddleup's backport kit (§A3) instead uses
  sequential idempotent writes. See
  `docs/reviews/2026-07-01-sibling-harvest.md` Tier 1 item 1.

**Candidate fix direction (for tech-lead to confirm):** `db.batch([...])`,
matching explore.press's proven fix. Also sweep the codebase for any other
`db.transaction` usage on this driver.

**Regression-test requirement (bug-fix variant):** a test that fails before
the fix and passes after. Note the mocked-`db` limitation above — the test
must exercise the real driver constraint (or assert the code path no longer
calls `transaction`), not a mock that hides it.

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Bug confirmed real and scoped. `src/app/(email-verify)/account/verify-email/[token]/page.tsx:64`
calls `await db.transaction(async (tx) => { ... })` against the `drizzle-orm/neon-http` driver
(`src/lib/db/index.ts:1`), which does not support interactive transactions. This is a
hard runtime crash: every user who clicks their email-change verification link gets an
unhandled server error. Only one `db.transaction()` call site exists in the codebase;
the rest of the codebase already avoids this pattern. Replacing the transaction with
`db.batch([...])` preserves full atomicity and matches the proven fix in explore.press
commit `d55a165`.

### What I did

- Confirmed `src/lib/db/index.ts` uses `drizzle-orm/neon-http` (line 1) — no transaction support.
- Read `src/app/(email-verify)/account/verify-email/[token]/page.tsx` in full. The
  `db.transaction()` call is at line 64 and wraps exactly three writes (enumerated below).
- Read `src/app/(admin)/admin/users/[id]/actions.ts:73-75`. Lines 74-76 are a code comment
  that explicitly documents the neon-http constraint and explains why that file uses
  sequential writes instead — the claim is verified.
- Ran `grep -rn "db\.transaction" src/` — found exactly one actual call site (the
  verify-email page). The admin comment is not a call site.
- Inspected explore.press commit `d55a165` to understand the `db.batch()` pattern and
  confirmed it is a structural match for the three-write scenario here.
- Enumerated the three writes inside the transaction and verified none requires a
  mid-batch intermediate result, confirming `db.batch()` is viable.

### Outputs

**Bug confirmed real:** yes.
- `src/lib/db/index.ts` — driver is `drizzle-orm/neon-http`; `db.transaction()` throws at runtime.
- `src/app/(email-verify)/account/verify-email/[token]/page.tsx:64` — the sole call site.

**Call-site sweep — every `db.transaction()` in src/:**

| File | Line | Type | Action |
|------|------|------|--------|
| `src/app/(email-verify)/account/verify-email/[token]/page.tsx` | 64 | actual call | fix with `db.batch()` |
| `src/app/(admin)/admin/users/[id]/actions.ts` | 75 | comment only | no change needed |

No other call sites found.

**What must stay atomic — the three writes inside the transaction:**

1. `UPDATE users SET email = newEmail WHERE id = tokenRow.userId` — applies the email change.
2. `DELETE FROM emailVerificationTokens WHERE id = tokenRow.id` — consumes the token (prevents replay).
3. `INSERT INTO auditEvents (...)` — records the old-to-new email swap.

The critical pair is writes 1 and 2. If the email updates but the token survives, the
same verification link can be replayed, applying the email change a second time or
causing confusion if the email was already changed. Write 3 (audit) must also be atomic:
a failed audit insert should not leave the email changed without a record.

All three input values (`tokenRow.userId`, `tokenRow.id`, `tokenRow.newEmail`, `oldEmail`)
are already in scope from the pre-reads above the transaction. No write depends on a
mid-batch result, so `db.batch([stmt1, stmt2, stmt3])` is a drop-in replacement that
Neon executes as a single server-side transaction.

**Intended user-visible behavior that must not change:**

- Valid, unexpired link: email changes, token consumed, redirect to `/account?emailChanged=1`. Audit row written.
- Invalid/already-used link: "invalid or already used" error card shown (the `findFirst` returns nothing — this path is unchanged).
- Expired link: "expired" error card shown, expired token deleted (the expiry-cleanup `DELETE` at line 44 runs before the transaction and is a plain single-row delete — unaffected).

**Verdict:** READY FOR DESIGN

### Open questions / handoff notes

- Tech-lead: confirm `db.batch()` type signature. The explore.press fix uses
  `statements as unknown as Parameters<typeof db.batch>[0]` as a type cast because
  Drizzle's batch type parameter is strict. The same cast is likely needed here.
- Tech-lead: decide whether to switch the driver to `drizzle-orm/neon-serverless`
  (which does support `db.transaction()`) as a longer-term alternative, or keep
  neon-http and document `db.batch()` as the project-wide convention. The
  architectural choice does not block this fix — `db.batch()` is correct either way.
- QA (Phase 5): the regression test must not mock `db`. Options: (a) assert the
  source file no longer contains a `db.transaction(` string (static assertion,
  fragile but simple), or (b) write an integration test against a real Neon branch.
  The mocked-db limitation is documented in the bug report above.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** Skipped (explicit notation — bug-fix variant)

**Skipping Phase 2 — no new deps, no new directories, no structural change, no invariant touched. This is a single-file server fix that replaces one API call with another within the same file. The driver question (neon-http vs. neon-serverless) is a potential architectural decision, but tech-lead has resolved it explicitly in DECISION-014 as an implementation-level call (keep neon-http; document db.batch() as the convention). No architect review required.**

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

`db.transaction()` is called at line 64 of `src/app/(email-verify)/account/verify-email/[token]/page.tsx` against the `drizzle-orm/neon-http` driver, which throws `No transactions support in neon-http driver` at runtime. The fix is a drop-in replacement with `db.batch([...])`, which the Neon HTTP driver executes as a single server-side transaction. All three writes stay atomic. No schema change, no new dependencies, no structural change. Driver stays on neon-http (DECISION-014).

### Root Cause

The neon-http driver (`drizzle-orm/neon-http`) does not support interactive transactions. `db.transaction(async (tx) => {...})` works against `drizzle-orm/neon-serverless` (WebSocket-based) but throws at runtime on neon-http. The constraint was already documented in the codebase (`src/app/(admin)/admin/users/[id]/actions.ts:74-76`) but was not applied when the verify-email page was written. Unit tests mock `db`, so `tx.update()` succeeds on the mock and the defect is invisible until a real DB call fires.

### Exact Replacement Code

Replace lines 63-82 of `src/app/(email-verify)/account/verify-email/[token]/page.tsx` (the `// Apply the email change atomically` comment through the closing `});`) with:

```typescript
// Apply the email change atomically.
// The Neon HTTP driver has no interactive db.transaction(); db.batch()
// runs all three statements as a single server-side transaction.
// See docs/decisions.md DECISION-014.
await db.batch([
  db
    .update(users)
    .set({ email: newEmail })
    .where(eq(users.id, tokenRow.userId)),
  db
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.id, tokenRow.id)),
  db.insert(auditEvents).values({
    actorUserId: tokenRow.userId,
    actorEmail: newEmail,
    action: AUDIT_ACTIONS.USER_EMAIL_CHANGED,
    resourceType: "user",
    resourceId: tokenRow.userId,
    metadata: { oldEmail, newEmail },
  }),
] as unknown as Parameters<typeof db.batch>[0]);
```

The `as unknown as Parameters<typeof db.batch>[0]` cast is required because Drizzle's batch type parameter is strict about element types. The double-cast is the minimal workaround, matching explore.press commit `d55a165`. The inline tuple form is used here (not the push-to-array form explore.press used) because we have exactly three fixed statements, not a dynamic list — the inline form is cleaner for a fixed set.

No other changes to the file. The expiry-cleanup `DELETE` at line 44 is a standalone single-row delete that runs before any of the three batch statements and is unaffected.

### Driver Decision

Keep `drizzle-orm/neon-http`. Switching to `neon-serverless` is an architectural change (connection model, WebSocket vs. HTTP, cold-start profile) that deserves its own pipeline entry. It is out of scope for this bug fix. `db.batch()` is correct and atomic on neon-http. Decision logged as **DECISION-014** in `docs/decisions.md`.

### Regression-Test Strategy

**Recommendation: Vitest static source assertion.**

A static source assertion is appropriate for this class of defect because:
1. The bug is structural (the wrong API call is present in the source), not behavioral.
2. The mock limitation (`db.transaction` succeeds in mocks) makes a unit-behavioral test useless for catching this.
3. A real-DB integration test would require a seeded Neon branch and live credentials in CI — correct but disproportionate to the fix's scope.
4. The static assertion fails before the fix (the string `db.transaction(` is present) and passes after (it is not).

QA should add a Vitest test file, e.g., `src/app/(email-verify)/account/verify-email/[token]/page.no-db-transaction.test.ts`, with a single test:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

describe("verify-email page — neon-http constraint", () => {
  it("does not call db.transaction() (unsupported on neon-http driver)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(email-verify)/account/verify-email/[token]/page.tsx"),
      "utf8",
    );
    expect(src).not.toContain("db.transaction(");
  });
});
```

This test fails before the fix and passes after. It will also catch any future regression where someone reintroduces `db.transaction()` on this page.

A real-DB integration test (verifying a token is consumed and email updated atomically) is the gold standard and is appropriate as a follow-on task, but is not required for the bug-fix regression gate.

### Edge Cases

- **Expiry cleanup (line 44):** The `await db.delete(...).where(eq(emailVerificationTokens.id, tokenRow.id))` that runs on an expired token is a standalone single-row delete outside the batch. It is unaffected by this change.
- **Token not found (line 38):** The `findFirst` null-return path is unaffected.
- **User not found (line 56):** The `userRow` null-return path is unaffected.
- **Partial batch failure:** If any statement in `db.batch()` fails, Neon rolls back all three. This is equivalent to the transaction behavior that was intended.
- **`revalidatePath` and `redirect` (lines 84-87):** These are called after the batch and are unaffected.

### What I Did

- Read `src/app/(email-verify)/account/verify-email/[token]/page.tsx` in full.
- Read `src/lib/db/index.ts` — confirmed `drizzle-orm/neon-http`, `drizzle-orm: ^0.45.2`.
- Inspected explore.press commit `d55a165` — read the full diff to confirm the `db.batch()` pattern and the exact type cast needed.
- Resolved analyst's two handoff questions: type cast confirmed, driver decision made.
- Added DECISION-014 to `docs/decisions.md`.

### Outputs

- `docs/decisions.md` — DECISION-014 added (neon-http kept; `db.batch()` documented as project convention).
- `docs/work-log/2026-07-01-verify-email-neon-http-transaction.md` — Phase 2 skip and Phase 3 design recorded.

### Open Questions / Handoff Notes

- **Implementer: api-developer.** This is a pure server-side fix on one file with no UI changes. The api-developer agent is the natural owner.
- api-developer: replace lines 63-82 of `src/app/(email-verify)/account/verify-email/[token]/page.tsx` with the `db.batch()` call above. The `as unknown as Parameters<typeof db.batch>[0]` cast is required — do not omit it or the TypeScript compiler will reject the call.
- api-developer: also add a comment cross-referencing DECISION-014 to the existing `db.transaction` comment at `src/app/(admin)/admin/users/[id]/actions.ts:74-76`, so the two reference each other. (One-line comment addition, not a separate commit — batch it with the main fix.)
- qa: write the static source assertion test described above. It should be in a file the `npm run test` suite picks up (Vitest will pick up any `*.test.ts` file next to source).

---

## Phase 4 — Implementation (API) — 2026-07-01

**Owner:** api-developer
**Status:** complete

### Summary

Replaced the `db.transaction()` call in the verify-email page with `db.batch()`, matching the Phase 3 design exactly. Wrote the static regression test (which first confirmed FAIL against the unfixed file, then confirmed PASS after the fix). Added the DECISION-014 cross-reference to the existing constraint comment in `actions.ts`. All five verification gates passed.

### What I did

- Read the Phase 3 design and confirmed field values in the existing transaction matched the design's `db.batch()` snippet.
- Wrote the regression test at `src/app/(email-verify)/account/verify-email/[token]/page.no-db-transaction.test.ts`. Initial assertion was `not.toContain("db.transaction(")`. Ran it against the unfixed file — FAILED (exit code 1).
- Applied the fix: replaced lines 63-82 of `src/app/(email-verify)/account/verify-email/[token]/page.tsx` with the three-statement `db.batch()` call, with the `as unknown as Parameters<typeof db.batch>[0]` cast and the four-line comment referencing DECISION-014.
- Refined the regression test assertion to `not.toContain("await db.transaction(")` because the new comment body (`// The Neon HTTP driver has no interactive db.transaction(); db.batch()`) contains the bare substring `db.transaction(` — the `await ` prefix uniquely identifies an actual call site and is the correct discriminator. The original unfixed file also contained `await db.transaction(`, so the fail-before-fix evidence is preserved with equivalent strength.
- Ran the refined test against the fixed file — PASSED.
- Added one-line cross-reference to DECISION-014 in `src/app/(admin)/admin/users/[id]/actions.ts` at the existing constraint comment block (after line 76, making it line 77).

### Regression Evidence (fail-then-pass)

| Run | File state | Assertion | Result |
|-----|-----------|-----------|--------|
| 1 | Unfixed (`db.transaction(` at line 64) | `not.toContain("db.transaction(")` | **FAIL** — AssertionError confirmed |
| 2 (post-fix) | Fixed (`db.batch(`) | `not.toContain("db.transaction(")` | **FAIL** — false match on comment text `// ... db.transaction(); db.batch()` |
| 3 (post-assertion-refinement) | Fixed (`db.batch(`) | `not.toContain("await db.transaction(")` | **PASS** — 1 test, 1 passed |

Note: Run 2 is not a regression — it revealed that the Phase 3 comment text itself contains `db.transaction(` as a substring. The refined assertion is strictly more correct: it matches invocations (which must be awaited) and ignores comment references to the function name.

### Verification Results

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS — no output, exit 0 |
| `npm run lint` | PASS — no warnings, no errors, exit 0 |
| `npm run check:audit` | PASS — "Audit-coverage check passed." |
| `npm run test` | PASS — 16 test files, 176 tests all passed |
| `npm run build` | PASS — 17/17 pages generated, no errors |

### Outputs

- `src/app/(email-verify)/account/verify-email/[token]/page.tsx` — `db.transaction()` block (lines 63-82) replaced with `db.batch()` equivalent. No other logic changed.
- `src/app/(email-verify)/account/verify-email/[token]/page.no-db-transaction.test.ts` — new regression test (static source assertion).
- `src/app/(admin)/admin/users/[id]/actions.ts` — one-line cross-reference to DECISION-014 appended to existing constraint comment.

### Open questions / handoff notes

- Next agent: **qa** (Phase 5 — Test Verification). All unit tests pass. This fix is NOT auth-touching, so no e2e gate is required at Phase 4. However, concurrent auth-touching work in this working tree (touching `src/auth.ts`, `src/lib/auth/`, `src/app/(auth)/`, `src/app/(account)/account/2fa/`, `src/app/(admin)/admin/2fa/`) makes a live dev-server e2e run unreliable right now. Phase 5 coordination should decide whether to run e2e against the combined working tree or defer to a clean branch.
- A real-DB integration test (verifying a token is consumed and the email updated atomically on a seeded Neon branch) remains the gold standard for this flow. The Phase 3 design notes this as a follow-on task. Not a blocker for PASS.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. The regression test exists, is meaningful, and exercises the correct discriminator. The pre-fix HEAD file contains `await db.transaction(` at line 64 (confirmed via `git show HEAD:`), proving the test would have failed before the fix. The fixed file uses `db.batch([...])` with all three writes preserved and the required type cast. The DECISION-014 cross-reference landed in `actions.ts:77`. All shared verification commands pass. The shared e2e suite (20/20 tests, run against the live dev server satisfying the BUG-C auth-touching gate) also ran — no regressions from this change.

### What I did

- Ran shared verification suite (see Shared Verification Results below — run once across all three concurrent bug fixes).
- Confirmed `git show HEAD:src/app/(email-verify)/account/verify-email/[token]/page.tsx` contains `await db.transaction(` at line 64, proving the regression test would FAIL against the pre-fix tree.
- Read the fixed page to confirm: (a) `db.batch([...])` replaces the transaction, (b) all three writes are present (UPDATE users, DELETE emailVerificationTokens, INSERT auditEvents) with correct column/value bindings, (c) the `as unknown as Parameters<typeof db.batch>[0]` cast is in place, (d) the four-line comment references DECISION-014.
- Read `src/app/(admin)/admin/users/[id]/actions.ts:70-78` to confirm the DECISION-014 cross-reference comment at line 77.
- Read the regression test `page.no-db-transaction.test.ts` — the assertion is `not.toContain("await db.transaction(")`, which correctly targets an invocation (not comment text) and is the discriminator refined from the Phase 4 run-2 false positive.
- Verified no stray `console.log`, native browser dialogs, or `toLocale*` calls in any changed file.
- Adversarial cross-check: `src/app/(email-verify)/account/verify-email/[token]/page.tsx` and `src/app/(admin)/admin/users/[id]/actions.ts` are touched only by this fix, no overlap with BUG-B or BUG-C files.

### Shared Verification Results (run once for all three fixes)

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 warnings |
| `npm run test` | PASS — 20 test files, 195 tests, 476ms |
| `npm run build` | PASS — 17/17 pages generated |
| `npm run check:audit` | PASS — "Audit-coverage check passed." |
| `npm run test:e2e` | PASS — 20/20 tests, 21.2s (satisfies BUG-C auth-touching gate; no regressions for A or B) |

### Regression Tests Added

- `src/app/(email-verify)/account/verify-email/[token]/page.no-db-transaction.test.ts:13` — "does not call db.transaction() (unsupported on neon-http driver)" — guards against reintroduction of `await db.transaction(` in the verify-email page.

### Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/two-factor.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/flags.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/auth/sign-in-gate.ts`: 100% (absent from coverage table — no uncovered lines)
- Overall: 58.92% statements (reduced by action files with heavy DB mock overhead)

### Outputs

- `docs/work-log/2026-07-01-verify-email-neon-http-transaction.md` — Phase 5 section added; Per-Phase Status Phase 5 row updated.

### Open questions / handoff notes

- Next agent: **analyst** (Phase 6 — Shipped vs Intent).
- A real-DB integration test for the atomic email + token + audit batch remains the gold standard (Phase 3 follow-on). The static source assertion is the accepted regression gate for now.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The shipped code matches Phase 1 intent exactly. The `db.batch([...])` call at `src/app/(email-verify)/account/verify-email/[token]/page.tsx:67-83` preserves all three original writes with identical field values, the DECISION-014 comment is in place, the success redirect is unchanged, all three error cards are preserved, and token replay is still prevented because the DELETE is inside the batch. The regression test is meaningful and correctly discriminates invocations from comment text.

### What I did

- Re-read the Phase 1 behavior contract: three writes atomic, success path to `/account?emailChanged=1`, three error cards unchanged, token replay prevented.
- Read the fixed `page.tsx` in full and verified against the contract line by line.
- Verified `db.batch([...])` contains exactly: `db.update(users).set({ email: newEmail }).where(eq(users.id, tokenRow.userId))`, `db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, tokenRow.id))`, `db.insert(auditEvents).values({ actorUserId: tokenRow.userId, actorEmail: newEmail, action: AUDIT_ACTIONS.USER_EMAIL_CHANGED, ... metadata: { oldEmail, newEmail } })` — all field values match the Phase 1 enumeration exactly.
- Confirmed `as unknown as Parameters<typeof db.batch>[0]` cast is present.
- Confirmed `revalidatePath("/account")` and `redirect("/account?emailChanged=1")` are at lines 85 and 88 — success path unchanged.
- Confirmed three error cards: "invalid or already used" (line 39), "expired" with expiry-cleanup DELETE (lines 43-47), "Account not found" (line 57) — all unchanged from Phase 1 description.
- Confirmed expiry-cleanup DELETE at line 44 is outside the batch, as before.
- Read `page.no-db-transaction.test.ts` — assertion is `not.toContain("await db.transaction(")` which correctly targets invocations only (the comment text `// ... db.transaction(); db.batch()` does not contain the `await ` prefix and is not a false match).
- Confirmed DECISION-014 cross-reference landed in `src/app/(admin)/admin/users/[id]/actions.ts:77`.

### Outputs

- `docs/work-log/2026-07-01-verify-email-neon-http-transaction.md` — Phase 6 section added; Per-Phase Status Phase 6 row updated to SHIP IT / 2026-07-01.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Valid link: email changes, token consumed, audit written, redirect to `/account?emailChanged=1` | `db.batch([update, delete, insert auditEvent])` → `revalidatePath` → `redirect("/account?emailChanged=1")` | Matches |
| Invalid/used link: error card "invalid or already used" | `<ErrorCard message="This verification link is invalid or has already been used." />` at line 39 | Matches |
| Expired link: error card "expired", token deleted | Expiry check at line 42, `db.delete(...)` at line 44, `<ErrorCard>` at line 47 | Matches |
| Token replay prevented (delete in batch) | DELETE inside `db.batch` at index 1 — runs atomically with email update | Matches |
| Three writes enumerated: UPDATE users, DELETE emailVerificationTokens, INSERT auditEvents | All three present with correct table, column, and value bindings | Matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state | N/A — page requires a token parameter; no "empty" state |
| Failure microcopy | Three error cards present; all human-readable, no stack traces |
| Permission gate | N/A — no permission change; page intentionally reachable without session |
| Audit event | `AUDIT_ACTIONS.USER_EMAIL_CHANGED` with `{ oldEmail, newEmail }` metadata — fires in batch |
| Mobile | Card layout uses `flex min-h-screen items-center justify-center p-4` — responsive |
| Regression test meaningful | Yes — assertion targets `await db.transaction(` (invocation discriminator), not bare substring |

### Open questions / handoff notes

- Real-DB integration test (verify token consumed + email updated atomically on a seeded Neon branch) is the gold standard; deferred from Phase 3. Track in Backlog if desired.
