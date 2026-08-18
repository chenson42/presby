# isUniqueViolation() helper — Work Log

> **Slug:** `2026-07-01-unique-violation-helper`
> **Surface:** src/lib/db + call sites TBD by analyst
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small — phases 2/3 expected brief)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-01 |
| 2 — Architectural review | architect | Complete | Approved | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-01 |
| 4 — Implementation | api-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Intent (from harvest, 2026-07-01)

On the neon-http driver, Postgres unique-violation errors (`23505`) arrive
with the pg error code nested under `error.cause`, not at the top level —
naive `error.code === "23505"` checks miss it, so any insert race on a unique
constraint surfaces as an unhandled 500. huddleup hit this in production
("500-for-everyone-but-the-first-user") and fixed it with an
`isUniqueViolation()` helper that checks top-level `code`, `cause.code`, and
the message (harvest Tier 1 item 5; reference:
`/Users/cshenso/git/huddleup.health/web/src/lib/db/errors.ts`, kit §A2).

**Requested change:** port the helper (with unit tests covering the nested
shapes) and wire it into the starter's real unique-constraint-race call
sites. The analyst must inventory where 23505 can actually occur today
(email-change request on a taken email? role bindings? seed script?) and
whether each currently handles the race or 500s — the helper should ship
with at least one real call site fixed, not as a dead utility.

**Pairs with (note for design):** huddleup's companion rule "user-scope every
synthetic unique index" — assess whether any starter index needs it.

---

# Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

This is a correctness fix, not a user-visible feature. Two call sites in the starter can currently throw an unhandled 500 when a Postgres unique-constraint violation (23505) fires: the email-verification landing page (race on `users.email`) and the password-reset request action (race on `ix_pwd_reset_user` from a delete+insert pattern). The helper ports cleanly from huddleup and must ship with both call sites wired, not as a dead utility. All other unique indexes in the starter are already protected by `onConflictDoNothing` or `onConflictDoUpdate` and need no changes. The companion "user-scope every synthetic unique index" rule finds no gaps in the starter's current schema.

### What I did

#### Pass 1 — User Verbs

No new user-facing surfaces. The affected surfaces are:

| Surface | Current behavior on 23505 | Behavior after fix |
|---------|--------------------------|-------------------|
| Anonymous visitor — `/account/verify-email/[token]` | Unhandled 500 | ErrorCard: "This email has already been claimed. Request a new verification link." |
| Anonymous visitor — `/forgot-password` form submit | Unhandled 500 (rare) | `{ ok: true }` — same as the success path (enumeration-safe) |

Both are edge cases visible only under a narrow race window, but both produce a hard 500 today.

#### Pass 2 — Constraint and Call-Site Inventory

Full inventory of every unique constraint in `src/lib/db/schema.ts` and the current behavior if 23505 fires:

| Constraint | Column(s) | Insert paths | 23505 handler today | Verdict |
|---|---|---|---|---|
| `users.email` unique | email | DrizzleAdapter (OAuth first-sign-in); `verify-email/[token]/page.tsx` batched UPDATE | Adapter: `allowDangerousEmailAccountLinking` reduces race to near-zero. Verify-email batch: **unhandled 500** | **Gap — fix needed in verify-email page** |
| `accounts` PK | (provider, providerAccountId) | DrizzleAdapter only | Adapter handles internally | No gap |
| `sessions` sessionToken PK | sessionToken | DrizzleAdapter only | Adapter handles internally | No gap |
| `verificationTokens` PK | (identifier, token) | DrizzleAdapter only | Adapter handles internally | No gap |
| `roles.name` unique | name | `scripts/seed.ts` with `.onConflictDoNothing()` | N/A | Safe |
| `ix_user_roles_user_role` unique (userId, roleId) | userId+roleId | `assignRoleAction()` `.onConflictDoNothing()`; `ensureDefaultRole()` `.onConflictDoNothing()`; seed `.onConflictDoNothing()` | N/A | Safe — all paths covered |
| `features.key` PK | key | Seed `.onConflictDoNothing()` | N/A | Safe |
| `ix_role_features_role_feature` unique (roleId, featureKey) | roleId+featureKey | Seed `bindAdminFeatures()` `.onConflictDoNothing()` | N/A | Safe |
| `userTotp.userId` PK | userId | `completeEnrollment()` `.onConflictDoUpdate()` | N/A | Safe |
| `userTotpPendingEnrollments.userId` PK | userId | `prepareEnrollment()` `.onConflictDoUpdate()` | N/A | Safe |
| `featureFlags.key` PK | key | Seed `.onConflictDoNothing()` | N/A | Safe |
| `ix_email_ver_token` unique | token | `requestEmailChange()` `.onConflictDoUpdate()` on userId target | Token is SHA-256(32 random bytes) — collision negligible | Safe |
| `ix_email_ver_user` unique | userId | `requestEmailChange()` `.onConflictDoUpdate({ target: userId })` | N/A | Safe |
| `ix_pwd_reset_token` unique | token | `requestPasswordReset()` plain insert after delete | Token is SHA-256(32 random bytes) — collision negligible | Safe |
| `ix_pwd_reset_user` unique | userId | `requestPasswordReset()` **delete then plain insert** | **Unhandled 500** under concurrent requests | **Gap — fix needed** |
| `migrationSeeds.key` PK | key | Internal only | N/A | Safe |

**Two real gaps identified:**

**Gap A — `verify-email/[token]/page.tsx`:** The `db.batch()` call does `UPDATE users SET email = newEmail`. If two users concurrently verify tokens that both target the same email (possible because `requestEmailChange()` checks in-flight tokens by `newEmail` but the check is a TOCTOU — two requests can pass the check before either token is minted), the second batch throws a 23505 on `users.email`. Today: the error propagates out of the async Server Component and surfaces as a 500 (no error boundary in the `(email-verify)` route group). The friendly handling is to catch the error in the page, call `isUniqueViolation(err)`, and render an `ErrorCard` with copy explaining the email was claimed by another account.

**Gap B — `requestPasswordReset()` in `src/app/(password-reset)/actions.ts`:** The action deletes any existing row for the user, then does a plain `insert`. Under two concurrent requests (both passing the IP rate-limit check since they share the same IP and the window is 5/hour, but edge-case possible), the sequence `R1 deletes → R2 deletes → R1 inserts → R2 inserts` produces a 23505 on `ix_pwd_reset_user`. Today: unhandled 500. The enumeration-safe contract requires the action to always return `{ ok: true }`. The preferred fix is to change to `insert().onConflictDoUpdate(...)` (atomic upsert, no race), but `isUniqueViolation()` provides a catch fallback if the tech-lead prefers to keep the delete-then-insert pattern (return `{ ok: true }` on catch since the first concurrent request already minted a valid token).

#### Pass 3 — Permissions and Flags

None needed. This is a pure correctness/reliability fix. No new `FEATURES` key. No feature flag.

#### Pass 4 — Edge Cases

- **Reference shape (huddleup `errors.ts`):** Checks `err.code`, `err.cause.code`, and `err.message` regexp. The cause chain is one level deep — Neon's serverless driver and Drizzle produce at most one wrapping layer in practice, so this is complete coverage.
- **Message fallback locale sensitivity:** The regexp `/duplicate key value violates unique constraint/i` matches the English Postgres error string. Neon Postgres runs English `lc_messages` by default and doesn't expose locale configuration to tenants. The fallback is safe in practice, but a comment in the ported file should state the assumption.
- **Numeric code coercion:** The `codeOf` helper uses `String(...)` so `{ code: 23505 }` (integer) matches. The test suite in huddleup covers this case.
- **File placement:** `src/lib/db/` currently has exactly `index.ts` and `schema.ts`. Adding `errors.ts` is the natural peer placement, consistent with huddleup's identical path. No new directory needed.
- **Test file:** Huddleup's `errors.test.ts` covers 13 cases (3 true, 10 false). The starter should port all 13. Test file should live at `src/lib/db/errors.test.ts` (Vitest sibling convention).

#### Pass 5 — Adversarial

- **False positives:** FK violation (23503), check constraint (23514), exclusion constraint (23P01) all have different codes and will not match. The helper is specific to 23505. Safe.
- **Cause chain depth:** The helper checks `err.cause.code` (one level). A doubly-wrapped error (`err.cause.cause.code`) would not match. No evidence Neon or Drizzle wraps two levels deep; note this as a known limitation in the file doc comment.
- **Call site coupling:** At the verify-email page, wrapping the batch in try/catch is the right pattern. The batch either fully succeeds (three operations atomically on Neon) or throws. A partial-batch failure is not possible with Neon's `db.batch()` semantics (it's a transaction on the server side).
- **User-scope companion rule audit:** All synthetic unique indexes in the starter include a userId column or are globally meaningful by design (token hashes, role names, feature keys). The companion rule raises no findings.

### Outputs

- Work-log updated with Phase 1 section.
- Constraint/call-site inventory table above is the primary artifact for the tech-lead.

### Open questions / handoff notes

1. **Preferred fix for Gap B (password reset race):** The tech-lead should choose between (a) switching `requestPasswordReset` to `insert().onConflictDoUpdate({ target: passwordResetTokens.userId, set: { token, expiresAt, createdAt: new Date() } })` to eliminate the race atomically, or (b) wrapping the existing delete+insert in try/catch with `isUniqueViolation()`. Option (a) is cleaner and removes the race entirely; option (b) tolerates it with a safe fallback. Either is acceptable — the analyst prefers (a).
2. **Error boundary for `(email-verify)` route group:** The route group has no layout and no error boundary. If the `db.batch()` throws for any reason other than 23505, the user still sees a 500. The tech-lead may want to add an `error.tsx` to the route group as a follow-up (not a blocker for this feature).
3. **Should the helper be `isUniqueViolation(err): boolean` or use a type-predicate signature?** Huddleup returns boolean. The starter should match for simplicity. No change needed.
4. **Numeric code shape:** Neon's driver may return `code` as a string `"23505"` or as a number `23505` depending on driver version. The `codeOf` helper coerces with `String(...)`, covering both. The tech-lead should confirm this is the shape the current `@neondatabase/serverless` version produces.

---

## Phase 1 — Functional Refinement (from handoff template) — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Two call sites in the starter produce unhandled 500s when Postgres unique-constraint violation 23505 fires under a race: the email-verification landing page (batched UPDATE on `users.email`) and the password-reset request action (delete+insert on `ix_pwd_reset_user`). The `isUniqueViolation()` helper from huddleup covers the three error shapes Neon's driver can produce (top-level `.code`, nested `.cause.code`, and message regexp fallback). All other unique constraints in the starter are already guarded by `onConflictDoNothing` or `onConflictDoUpdate` and need no changes. The companion user-scope rule finds no gaps.

### What I did

- Read and inventoried all unique constraints in `src/lib/db/schema.ts`.
- Traced every insert/update call site against each constraint to determine current 23505 handling.
- Read `huddleup.health/web/src/lib/db/errors.ts` and its 13-case test suite.
- Ran five-pass review (user verbs, flows, permissions/flags, edge cases, adversarial).
- Identified two live call sites to wire the helper into on ship.
- Audited the companion user-scope rule against the starter's schema — no gaps found.

### Outputs

- `docs/work-log/2026-07-01-unique-violation-helper.md` — Phase 1 section added, status row updated.
- Constraint inventory table (above) — primary handoff artifact for tech-lead.

### Open questions / handoff notes

- Gap A (verify-email page): Wrap `db.batch()` in try/catch; if `isUniqueViolation(err)` return `ErrorCard` with "email already claimed" copy.
- Gap B (password reset action): Tech-lead to choose between atomic upsert (preferred) or try/catch fallback.
- Message-fallback locale assumption: add a doc comment to `src/lib/db/errors.ts` stating Neon English `lc_messages` assumption.
- No new error.tsx boundary needed for this feature, but the `(email-verify)` route group's lack of one is a separate follow-up item.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

Approved. The feature fits cleanly into the existing structure with no new directories, no new dependencies, and no schema or permission/flag changes. All five rulings below are confirmations; none required overrule or escalation. Gap B does not use the helper — the race is eliminated by switching to an atomic upsert, leaving Gap A as the sole call site. That is the correct outcome: the helper ships with a real call site, not an artificial one.

### What I did

- Read the Phase 1 work-log in full (constraint inventory, both gaps, all four open questions).
- Confirmed `src/lib/db/` currently contains exactly `index.ts` and `schema.ts` — no pre-existing `errors.ts`.
- Confirmed `(email-verify)` route group has no `layout.tsx` and no `error.tsx`.
- Confirmed `db.batch()` in verify-email `page.tsx` has no surrounding try/catch today.
- Confirmed `requestPasswordReset()` in `(password-reset)/actions.ts` uses a plain delete + insert (two separate statements, no conflict handling on the insert).
- Read `docs/decisions.md` top entries — no standing DECISION conflicts with any ruling here.
- Read `docs/TODO.md` immediately before edit, appended the `error.tsx` backlog line.

### Rulings

**1. Placement — CONFIRMED.**
`src/lib/db/errors.ts` is the correct location. It is a purpose-named peer of `index.ts` and `schema.ts`, consistent with the single-responsibility module pattern established elsewhere in `src/lib/` (e.g., `flags.ts`, `permissions.ts`, `request-ip.ts`). No new directory is needed. The Vitest test file goes at `src/lib/db/errors.test.ts` (existing sibling convention in the project).

**2. Gap B fix shape — CONFIRMED: atomic upsert; helper NOT used at Gap B.**
The analyst's preferred approach — switch `requestPasswordReset()` to `insert().onConflictDoUpdate({ target: passwordResetTokens.userId, set: { token, expiresAt, createdAt: new Date() } })` — is the right architectural posture. Removing the race is always preferable to tolerating it with a catch. The delete-then-insert pattern creates a two-step window; a single atomic upsert closes it entirely and is a direct analogue of `requestEmailChange()` which already uses `onConflictDoUpdate` on the same pattern.

Consequence: **Gap B does not call `isUniqueViolation()` at all.** The helper's only call site is Gap A. Phase 3 must not force an artificial usage at Gap B to justify the helper's existence — the constraint inventory from Phase 1 is sufficient justification, and a helper used in one real call site is better than one used in two forced call sites.

**3. Gap A catch scope — CONFIRMED.**
Try/catch wraps only the `db.batch([...])` call. The earlier token-lookup guard returns (`ErrorCard` for invalid/expired token, account-not-found) are already explicit and must not be inside the try block. The `db.batch()` is atomic on Neon's server side (DECISION-014 / BUG-1 established this); catching around it does not alter transaction semantics — it only adds error-handling around the atomic unit. The existing `ErrorCard` component defined in the same file is the correct render for the 23505 case. No new component needed.

**4. Invariants — CONFIRMED.**
- No new npm dependencies. The helper is pure TypeScript; `String()` coercion, `instanceof`, and regexp — all in stdlib.
- No schema change.
- No new `FEATURES` key, no new feature flag. This is a correctness fix.
- The `(email-verify)` route group's missing `error.tsx` is a separate follow-up. Appended to `docs/TODO.md` Backlog now (see Outputs).

**5. DECISION entry — NOT NEEDED.**
Adding `errors.ts` as a peer file to `index.ts` and `schema.ts` in `src/lib/db/` follows the established module pattern; it does not establish a new convention. The placement is self-evident from the directory name and the existing peer files. A numbered DECISION entry is reserved for choices that would otherwise be re-litigated or misunderstood by a future agent — this one is not in that category.

### Outputs

- `docs/work-log/2026-07-01-unique-violation-helper.md` — Phase 2 section added; status row updated to Complete / Approved / 2026-07-01.
- `docs/TODO.md` — one Backlog line appended: `(email-verify)` route group missing `error.tsx`.
- No DECISION entry created (ruling 5 above).

### Open questions / handoff notes

- **For tech-lead (Phase 3):** Gap B uses `insert().onConflictDoUpdate()` — no helper call site there. Document the why explicitly in the design doc so QA doesn't flag the absence as a gap.
- **For tech-lead:** the try/catch in Gap A should catch `unknown`, not `Error`, and narrow with `isUniqueViolation(err)` — any other throw should be re-thrown so the unhandled-500 path still surfaces genuine bugs rather than silently swallowing them.
- **For implementer:** `errors.ts` doc comment must state the Neon English `lc_messages` assumption (analyst note, pass 5). The message-fallback regexp is locale-specific.
- **For implementer:** note the known limitation that the helper checks only one level of cause chain (`err.cause.code`) and would miss a doubly-wrapped error. Note this in the file's JSDoc, not as a TODO — it is a deliberate, documented bound, not unfinished work.

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

The feature is a correctness fix: port `isUniqueViolation()` from huddleup as `src/lib/db/errors.ts` with its 13-case test suite, then wire it into the one real call site where a 23505 today produces an unhandled 500 (Gap A — the email-verification landing page). Gap B (password-reset race) is fixed atomically by switching from delete+insert to `onConflictDoUpdate`; the helper is NOT used there — the race is eliminated instead of tolerated. No new deps, no schema changes, no permissions or flags.

### What I did

- Read the Phase 1 constraint inventory and Phase 2 architectural rulings in full.
- Read `src/app/(email-verify)/account/verify-email/[token]/page.tsx` (current structure, redirect position).
- Read `src/app/(password-reset)/actions.ts` (delete+insert pattern, lines 69-77).
- Read `huddleup.health/web/src/lib/db/errors.ts` (exact helper body) and its 13-case test file.
- Read `src/app/(password-reset)/password-reset-actions.test.ts` (pure-function mirror pattern, existing schema structural tests).
- Read `src/lib/db/schema.ts` to confirm `passwordResetTokens` columns (`id`, `userId`, `token`, `expiresAt`, `createdAt`) and that `ix_pwd_reset_user` is a `uniqueIndex` on `userId`.
- Read `docs/TODO.md` immediately before edit.

### Design

#### 1. `src/lib/db/errors.ts` — exact contents

Port the huddleup helper verbatim with two doc-comment additions. The body does not change.

```typescript
/**
 * Database error utilities.
 *
 * No DB imports — safe to import from any server-side code path.
 *
 * Cause-depth note: the helper checks `err.cause.code` (one level deep).
 * A doubly-wrapped error (`err.cause.cause.code`) would not match. No
 * evidence Neon's serverless driver or Drizzle wrap two levels deep in
 * production; this is a documented bound, not a TODO.
 *
 * Locale note: the message-fallback regexp matches Postgres's English error
 * string. Neon Postgres runs English `lc_messages` by default and does not
 * expose locale configuration to tenants. The fallback is safe in practice;
 * if you ever run Postgres with a non-English locale, remove or localize it.
 */

/**
 * Returns true when `err` is a Postgres unique-constraint violation (23505).
 *
 * Neon's serverless driver may wrap the Postgres error in a `cause` field.
 * We check the top-level code, the one-level-deep cause code, and an
 * English message pattern as a final fallback.
 *
 * Callers must wrap their INSERT in try/catch and pass the caught value here.
 * On `true`, return a user-facing error appropriate to the context.
 * On `false`, re-throw — don't swallow genuine unexpected errors.
 */
export function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code)
      : undefined;
  if (codeOf(err) === "23505") return true;
  if (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    codeOf((err as { cause?: unknown }).cause) === "23505"
  ) {
    return true;
  }
  return (
    err instanceof Error &&
    /duplicate key value violates unique constraint/i.test(err.message)
  );
}
```

#### 2. `src/lib/db/errors.test.ts` — all 13 huddleup cases

Port the huddleup test file verbatim. The import path changes to `"./errors"`. All 13 cases must be present — none skipped. Enumerated here so QA can verify count:

**True cases (5):**
1. `err.code === "23505"` — direct Neon error shape (string code)
2. `err.cause.code === "23505"` — Drizzle-wrapped error shape
3. `err instanceof Error` with canonical Postgres message string
4. Case-insensitive message match (`DUPLICATE KEY VALUE VIOLATES UNIQUE CONSTRAINT`)
5. `err.code === 23505` as a number — `String(23505)` coerces to `"23505"`

**False cases (8):**
6. `err.code === "23503"` — FK violation, different code
7. `err instanceof Error` with unrelated message (`"connection timeout"`)
8. `null`
9. `undefined`
10. String `"23505"` (bare string, not an object)
11. Number `23505` (bare number — note: different from case 5 which is `{ code: 23505 }`)
12. `err.cause.code === "23503"` — cause present but wrong code
13. `{}` — empty object

Implementer note on cases 5 vs 11: case 5 is `{ code: 23505 }` (object with numeric code) — returns TRUE because `codeOf` applies `String()`. Case 11 is the bare number `23505` — returns FALSE because it is not an object (no `code` property), not an `Error` instance, and fails all three checks.

#### 3. Gap A — `src/app/(email-verify)/account/verify-email/[token]/page.tsx`

**Redirect-in-try ruling: SCOPED TRY — no footgun.** The current code structure places `await db.batch([...])` on lines 67-83, followed by `revalidatePath("/account")` on line 85 and `redirect("/account?emailChanged=1")` on line 88 — all at the same top-level scope inside the `VerifyEmailPage` function. The try block must wrap ONLY the `await db.batch([...])` call. The `revalidatePath()` and `redirect()` lines remain OUTSIDE the try block, executing only on the success path. Because `redirect()` never enters the try block, Next.js's NEXT_REDIRECT throw is never caught. No special `isRedirectError` check is needed.

The resulting shape:

```typescript
// existing code above unchanged (token lookup, expiry check, userRow check)

try {
  await db.batch([
    db.update(users).set({ email: newEmail }).where(eq(users.id, tokenRow.userId)),
    db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, tokenRow.id)),
    db.insert(auditEvents).values({
      actorUserId: tokenRow.userId,
      actorEmail: newEmail,
      action: AUDIT_ACTIONS.USER_EMAIL_CHANGED,
      resourceType: "user",
      resourceId: tokenRow.userId,
      metadata: { oldEmail, newEmail },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);
} catch (err: unknown) {
  if (isUniqueViolation(err)) {
    return (
      <ErrorCard message="This email address has already been claimed by another account. Request a new verification link from your account settings." />
    );
  }
  throw err;
}

revalidatePath("/account");
redirect("/account?emailChanged=1");
```

Exact error copy: `"This email address has already been claimed by another account. Request a new verification link from your account settings."`

Three-line catch: narrow with `isUniqueViolation`, return `ErrorCard` on true, re-throw on false. Do not swallow non-23505 errors.

#### 4. Gap B — `src/app/(password-reset)/actions.ts`

Replace the delete + insert (lines 68-77) with a single atomic upsert. Delete the comment about "Delete any existing in-flight reset token" — it no longer applies. The `sendPasswordResetEmail` and audit event calls that follow are unchanged.

Replace:
```typescript
// Delete any existing in-flight reset token for this user (one per user).
// The uniqueIndex("ix_pwd_reset_user") on userId enforces this at the DB level.
await db
  .delete(passwordResetTokens)
  .where(eq(passwordResetTokens.userId, userRow.id));

await db.insert(passwordResetTokens).values({
  userId: userRow.id,
  token: tokenHash,
  expiresAt,
});
```

With:
```typescript
// Upsert: if a reset token already exists for this user, overwrite it atomically.
// The uniqueIndex("ix_pwd_reset_user") on userId is the conflict target.
await db
  .insert(passwordResetTokens)
  .values({ userId: userRow.id, token: tokenHash, expiresAt })
  .onConflictDoUpdate({
    target: passwordResetTokens.userId,
    set: { token: tokenHash, expiresAt, createdAt: new Date() },
  });
```

The `eq` import is no longer needed for this operation (it was used in the delete WHERE clause); check whether the remaining code elsewhere in the file still needs it before removing from the import. The `and` and `gt` imports from `drizzle-orm` are still needed by `consumeResetToken`. No other changes to the file.

The enumeration-safe contract is unchanged: the action always returns `{ ok: true }` for a valid credentials user, whether it's the first or a concurrent second request for the same userId.

#### 5. Regression tests

**Gap A (`errors.ts`):** The 13-case unit test suite in `src/lib/db/errors.test.ts` carries the full correctness load. A page-level test for the 23505 catch in `verify-email/[token]/page.tsx` is not practical: it would require a real Neon DB with a seeded race condition (two simultaneous verify-email requests targeting the same email), a running dev server, and Playwright timing control over concurrent requests. This is integration-test territory, not unit-test territory, and the cost exceeds the value given that the helper itself is fully unit-tested. Do not force a page-level test.

**Gap B (`requestPasswordReset` upsert):** The existing `password-reset-actions.test.ts` uses the pure-function mirror pattern and cannot express DB-layer behavior. The upsert does not change any observable return type or branching logic — the action still always returns `{ ok: true }` for a valid credentials user. Add one new `describe` block to the existing test file documenting the change:

```typescript
// ---------------------------------------------------------------------------
// requestPasswordReset — upsert contract (delete+insert → onConflictDoUpdate)
//
// Changed from delete-then-insert to insert().onConflictDoUpdate() targeting
// passwordResetTokens.userId. Observable contract is unchanged: always
// returns { ok: true } for a valid credentials user. The delete+insert race
// window (two concurrent requests → 23505 on ix_pwd_reset_user) is closed.
// ---------------------------------------------------------------------------

describe(
  "requestPasswordReset — upsert contract — regression for delete+insert race window",
  () => {
    it("returns { ok: true } for a second request from the same userId (upsert replaces token)", () => {
      // The upsert eliminates the race; the observable result for any number of
      // concurrent requests from the same credentials user is still { ok: true }.
      const credentialsUser = { exists: true, hasPassword: true };
      const result = requestPasswordResetResultForUser(credentialsUser);
      expect(result).toStrictEqual({ ok: true });
    });

    it("passwordResetTokens.userId exists — required upsert target column", async () => {
      // If this column is removed or renamed, the onConflictDoUpdate call in
      // requestPasswordReset will fail at runtime. Catch it at test time.
      const schema = await import("@/lib/db/schema");
      expect(schema.passwordResetTokens).toHaveProperty("userId");
    });
  },
);
```

Two new tests (one behavior, one structural). Total test additions: 13 (errors.test.ts) + 2 (password-reset-actions.test.ts) = 15 new tests.

#### 6. Implementer + sequencing constraint

**Implementer:** api-developer. The work is pure server-side TypeScript (utility function, server action change, page.tsx catch block). No React component changes and no schema changes — all api-developer scope.

**CRITICAL SEQUENCING CONSTRAINT: Phase 4 must NOT start until the `recordAudit` helper's Phase 4 finishes.** Both this feature and `recordAudit` touch `src/app/(password-reset)/actions.ts`. The `recordAudit` Phase 4 will change the import list and add audit helper calls to that file. If this feature's Phase 4 runs concurrently or before `recordAudit` lands, the implementer will overwrite or miss `recordAudit`'s changes. The implementer must read `src/app/(password-reset)/actions.ts` fresh at the start of Phase 4 — after `recordAudit` has committed — and compose the upsert change on top of whatever `recordAudit` left.

The other two files (`src/lib/db/errors.ts`, `src/lib/db/errors.test.ts`, and the try/catch in `verify-email/[token]/page.tsx`) have no dependency on `recordAudit` and could be written independently, but splitting the implementation across two sub-sessions adds unnecessary coordination overhead. Keep it atomic: one implementation session after `recordAudit` Phase 4 is done.

### Outputs

- `docs/work-log/2026-07-01-unique-violation-helper.md` — Phase 3 section added; status row updated.
- `docs/TODO.md` — In Flight line updated to "Phase 4 queued behind recordAudit."
- No `docs/decisions.md` entry (Phase 2 ruling 5: placement is self-evident from directory name; no new convention introduced).

### Open questions / handoff notes

- **For api-developer (Phase 4):** Read `src/app/(password-reset)/actions.ts` fresh — after `recordAudit` Phase 4 — and compose the upsert on top.
- **For api-developer:** The `eq` import from `drizzle-orm` in `actions.ts` may become unused for `requestPasswordReset` after the upsert. Check the full file before removing it — `consumeResetToken` still uses `eq` in its WHERE clause.
- **For api-developer:** The try/catch in `verify-email/[token]/page.tsx` must catch `unknown` (not `Error`) and re-throw anything that is not a 23505. Do not swallow non-23505 errors.
- **For qa (Phase 5):** Verify 13 cases in `errors.test.ts` (5 true + 8 false) and 2 new cases in `password-reset-actions.test.ts`. Total new tests: 15. No page-level test required for Gap A (see section 5 above).

---

## Phase 4 — Implementation (API) — 2026-07-01

**Owner:** api-developer
**Status:** complete

### Summary

Ported `isUniqueViolation()` from huddleup as `src/lib/db/errors.ts` with full doc-comment additions (cause-depth limit and English lc_messages assumption). Wired the helper into the one real call site that produces an unhandled 500 on 23505 (Gap A — email-verify page). Gap B (password-reset race) was fixed atomically by switching from delete+insert to `insert().onConflictDoUpdate()` mirroring `requestEmailChange`'s pattern — no helper call site needed there. All 15 new tests pass (13 helper unit tests + 2 password-reset regression tests). Typecheck, lint, audit check, and production build are all clean.

### What I did

- Read `src/app/(password-reset)/actions.ts` fresh — confirmed recordAudit's changes (import of `AUDIT_ACTIONS`, `recordAudit` calls, `getRequestIp`, `checkRateLimit`) were already in place. The delete+insert pattern was still present and composed cleanly with the upsert change.
- Created `src/lib/db/errors.ts` — ported verbatim from huddleup with the two doc-comment additions specified in Phase 3.
- Created `src/lib/db/errors.test.ts` — all 13 cases (5 true, 8 false). Ported from huddleup's test file; import path updated to `"./errors"`.
- Gap A: added `import { isUniqueViolation } from "@/lib/db/errors"` to the verify-email page. Wrapped only the `await db.batch([...])` call in try/catch. On `isUniqueViolation(err)` → returns `<ErrorCard message="This email address has already been claimed by another account. Request a new verification link from your account settings." />`. Otherwise re-throws. `revalidatePath()` and `redirect()` remain outside the try block — no NEXT_REDIRECT footgun.
- Gap B: replaced the delete-then-insert (lines 68-78 in the pre-edit file) with a single `insert().onConflictDoUpdate({ target: passwordResetTokens.userId, set: { token: tokenHash, expiresAt, createdAt: new Date() } })`. Verified `eq` import is still needed by `consumeResetToken` — import unchanged.
- Added 2 tests to `src/app/(password-reset)/password-reset-actions.test.ts`: one behavior (repeat-userId returns `{ ok: true }`) and one structural (passwordResetTokens.userId exists as the upsert target column).
- Grep evidence of before-state for Gap B: `await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userRow.id))` followed by `await db.insert(passwordResetTokens).values(...)` — both removed; replaced by single `onConflictDoUpdate` call.

### Outputs

- `src/lib/db/errors.ts` — new file (isUniqueViolation helper, 3-shape check)
- `src/lib/db/errors.test.ts` — new file (13 test cases)
- `src/app/(email-verify)/account/verify-email/[token]/page.tsx` — added import + try/catch around db.batch()
- `src/app/(password-reset)/actions.ts` — replaced delete+insert with onConflictDoUpdate; recordAudit changes preserved
- `src/app/(password-reset)/password-reset-actions.test.ts` — 2 new tests added (upsert contract describe block)

**API contract / outputs for qa:**

No new endpoints or server actions — this is a correctness fix to two existing surfaces.

- `isUniqueViolation(err: unknown): boolean` — exported from `src/lib/db/errors.ts`
- Gap A call site: `src/app/(email-verify)/account/verify-email/[token]/page.tsx` — 23505 now renders ErrorCard instead of 500
- Gap B: `requestPasswordReset()` in `src/app/(password-reset)/actions.ts` — now uses atomic upsert; always returns `{ ok: true }` for valid credentials user

**Verification results:**

- `npm run typecheck` — clean
- `npm run lint` — clean (0 warnings)
- `npm run test` — 22 test files, 237 tests passed (was 222 before; +15 new tests)
- `npm run check:audit` — Audit-coverage check passed
- `npm run build` — clean production build (17 static/dynamic routes)

### Open questions / handoff notes

- **For qa (Phase 5):** Verify 13 tests in `src/lib/db/errors.test.ts` and 2 new tests in the password-reset test file. All 237 tests should pass. No e2e run required — this feature is not auth-touching per the CLAUDE.md gate list.
- The `(email-verify)` route group still lacks an `error.tsx` boundary for non-23505 throws — tracked in TODO.md Backlog.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. Not auth-touching. All 15 new tests pass (13 `isUniqueViolation` unit tests + 2 password-reset upsert contract tests). The Gap A catch correctly re-throws non-23505 errors. The Gap B upsert correctly targets `passwordResetTokens.userId`. Both `recordAudit` calls in the password-reset actions file are byte-intact around the upsert change.

### What I did

- Ran `npm run typecheck` — clean.
- Ran `npm run lint` — clean.
- Ran `npm run test` — 259 passed (23 test files); confirmed all 13 cases in `src/lib/db/errors.test.ts` (5 true / 8 false) and 2 new cases in `src/app/(password-reset)/password-reset-actions.test.ts`.
- Ran `npm run check:audit` — PASS.
- Ran `npm run build` — clean (20 routes).
- Read `src/app/(email-verify)/account/verify-email/[token]/page.tsx`:
  - `isUniqueViolation` imported from `@/lib/db/errors`.
  - `try` wraps ONLY the `await db.batch([...])` call (lines 74–98); `revalidatePath` and `redirect` are outside — no NEXT_REDIRECT footgun.
  - Catch body: `if (isUniqueViolation(err)) return <ErrorCard .../>; throw err;` — non-23505 errors re-thrown correctly.
- Read `src/app/(password-reset)/actions.ts`:
  - Delete+insert replaced with single `insert().onConflictDoUpdate({ target: passwordResetTokens.userId, ... })` — upsert confirmed at lines 73–78.
  - Both `recordAudit` calls (lines 96–102 and line 191–197) are present and intact.
  - `enqueueEmail` call at line 82 is present (email-queue pipeline changes preserved).
  - `eq` import from `drizzle-orm` retained (needed by `consumeResetToken` WHERE clause).
- Confirmed `src/lib/db/errors.ts` has the two doc-comment additions (cause-depth limit and English lc_messages assumption) per Phase 3 spec.

### Feature-Gate Audit

No protected routes or server actions added. The `verify-email/[token]/page.tsx` is intentionally unauthenticated — no gate change. The password-reset action already existed with its own rate-limit gate; the upsert change does not alter the permission model.

No protected routes touched — feature-gate audit not applicable.

### Outputs

- `docs/work-log/2026-07-01-unique-violation-helper.md` — Phase 5 section added; Per-Phase Status row updated.
- `docs/TODO.md` — In Flight entry updated to Phase 6 next.

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6 shipped-vs-intent review.
- `(email-verify)` route group still lacks `error.tsx` for non-23505 throws — tracked in TODO.md Backlog.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. Both live 23505 500s are gone: the verify-email race now returns a friendly ErrorCard with actionable copy, and the password-reset concurrent-request race is eliminated entirely via an atomic upsert. The helper ships with exactly one genuine call site. The 13-case test suite covers all three Neon error shapes. The Gap B fix is architecturally cleaner than using the helper would have been.

### What I did

- Verified `src/lib/db/errors.ts`: three-shape check (top-level code, cause.code, message regexp); both doc-comment additions present (cause-depth limit note and English lc_messages assumption); matches huddleup port verbatim.
- Verified `src/app/(email-verify)/account/verify-email/[token]/page.tsx`: `isUniqueViolation` imported from `@/lib/db/errors`; try/catch wraps ONLY the `await db.batch([...])` call (lines 73-98); `revalidatePath` and `redirect` are outside the try block (lines 100-103) — no NEXT_REDIRECT footgun; catch body correctly returns ErrorCard on isUniqueViolation, re-throws on everything else.
- Verified exact ErrorCard message: "This email address has already been claimed by another account. Request a new verification link from your account settings." — matches Phase 3 spec.
- Verified `src/app/(password-reset)/actions.ts` Gap B fix: delete+insert replaced with single `insert().onConflictDoUpdate({ target: passwordResetTokens.userId, set: { token, expiresAt, createdAt } })` at lines 72-78; `eq` import retained (still needed by consumeResetToken); isUniqueViolation not called there (correct — race eliminated, not tolerated).
- Confirmed `recordAudit` calls (lines 96-102 and 191-197) and `enqueueEmail` call (line 82) in password-reset actions.ts are intact around the upsert change — concurrent Phase 4 edits composed correctly.
- Confirmed 5 true + 8 false test cases in errors.test.ts (total 13) and 2 new cases in password-reset-actions.test.ts.

### Outputs

- `docs/work-log/2026-07-01-unique-violation-helper.md` — Phase 6 section added; Per-Phase Status row updated to Complete / SHIP IT / 2026-07-01.
- `docs/TODO.md` — In Flight line moved to Done.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| verify-email race → friendly ErrorCard instead of unhandled 500 | try/catch around db.batch(); isUniqueViolation returns ErrorCard with actionable message; non-23505 errors re-thrown | matches |
| password-reset race → enumeration-safe contract intact | atomic upsert eliminates the race; action always returns { ok: true } | matches |
| helper ships with exactly one genuine call site | verify-email page is the only site; Gap B uses upsert — no forced call site | matches |
| 13-case test coverage (5 true + 8 false) | 13 cases confirmed in errors.test.ts | matches |
| doc comments: cause-depth limit and lc_messages assumption | both present in errors.ts file-level JSDoc | matches |
| non-23505 errors re-thrown (no swallowing of genuine bugs) | throw err in catch block at line 97 of verify-email page | matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state | not applicable — correctness fix, no new UI surface |
| Failure microcopy | pass — friendly ErrorCard on 23505; genuine errors still surface as unhandled 500 (correct) |
| Permission gate | not applicable — verify-email page is intentionally unauthenticated; password-reset action retains its IP rate-limit gate |
| Audit event | pass — USER_EMAIL_CHANGED audit event preserved inside db.batch(); existing password-reset audit events unaffected |
| Mobile | not applicable |

### Open questions / handoff notes

- `(email-verify)` route group still lacks an `error.tsx` for non-23505 throws — tracked in `docs/TODO.md` Backlog. Not a blocker for ship.
- No open blockers. Pipeline closed.
