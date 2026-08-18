# Test Coverage Review — 2026-05-16

**Reviewer:** qa
**Cadence:** 7-day (first run — full codebase audit)

## Coverage Headline

Only one test file exists: `src/lib/permissions.test.ts`. Coverage numbers therefore
reflect only that file's surface; every other critical module has 0% coverage.

```
Overall (coverage-v8 report):
  Statements : 100% (5/5)   — permissions.ts only
  Branches   : 100% (2/2)
  Functions  : 100% (1/1)
  Lines      : 100% (5/5)
```

All 7 unit tests in `permissions.test.ts` pass.

## Module Inventory

| Module | Tests | Coverage | Notes |
|---|---|---|---|
| `src/lib/permissions.ts` | Yes — 7 tests | 100% | `hasFeature`, `FEATURES`, `FEATURE_CATALOG` all covered |
| `src/lib/flags.ts` | None | 0% | Pure async fn; DB-dependent; needs mock |
| `src/lib/two-factor.ts` | None | 0% | 7 exported functions; pure crypto; no DB dependency |
| `src/auth.ts` | None | 0% | JWT callbacks, role-refresh, `ensureDefaultRole` |
| `src/proxy.ts` | None | 0% | Edge route guard; pure logic over a mock session |
| `src/app/(admin)/admin/users/actions.ts` | None | 0% | Writes `auditEvents`; role mutation |
| `src/app/(admin)/admin/flags/actions.ts` | None | 0% | Writes `auditEvents`; flag toggle |
| `src/app/(auth)/totp/actions.ts` | None | 0% | TOTP enrol + verify + recovery codes |
| `src/app/(admin)/admin/2fa/actions.ts` | None | 0% | Admin TOTP reset; writes `auditEvents` |
| `src/lib/db/schema.ts` | None | n/a | Schema source-of-truth; tested implicitly via typecheck |

## Punch-List (Priority Order)

### 1. `src/lib/two-factor.ts` — no tests
- **Missing:** encrypt/decrypt round-trip; `verifyToken` accepts valid code and rejects
  expired code; `generateRecoveryCodes` format; `normalizeRecoveryCode` edge cases;
  `hashRecoveryCode` determinism.
- **Risk:** HIGH. AES-GCM encrypt/decrypt is the only protection for TOTP secrets at
  rest. A regression here silently breaks 2FA enrolment for every user. The functions
  are pure (no DB, no env other than `AUTH_TOTP_ENCRYPTION_KEY`) — cheapest high-value
  tests in the codebase.
- **Effort:** ~2 hours. Set `process.env.AUTH_TOTP_ENCRYPTION_KEY` in the test; pin
  time with otplib's `totp.options` to test valid/expired token rejection.

### 2. `src/proxy.ts` — no tests
- **Missing:** Unauthenticated request redirects to `/signin`; deactivated user
  redirects to `/signin?error=deactivated`; admin-route without 2FA redirects to
  `/totp`; user without `admin.dashboard` redirects to `/access-pending`; user with
  `admin.dashboard` but without `admin.users` is blocked from `/admin/users`; public
  paths pass through.
- **Risk:** HIGH. The proxy is the only auth enforcement at the edge. A broken rule
  silently opens or breaks routes for all users. Logic is pure over a mock session —
  no real NextAuth or DB needed.
- **Effort:** ~3 hours. Mock `edgeAuth` to return controlled session shapes; assert
  redirect URLs and `NextResponse.next()` outcomes.

### 3. `src/lib/flags.ts` — no tests
- **Missing:** `isFlagEnabled` returns `false` for a missing flag; returns the
  `enabled` field for a present flag; handles a `null`/`undefined` DB result gracefully.
- **Risk:** MEDIUM-HIGH. Flag checks gate in-progress features; a silent regression
  that always returns `false` (or always `true`) would either hide or expose features
  for every environment.
- **Effort:** ~1 hour. Mock `db.query.featureFlags.findFirst` with `vi.mock`; no real
  DB needed.

### 4. `src/auth.ts` JWT callbacks — no tests
- **Missing:** `ensureDefaultRole` is idempotent; deactivated user returns empty token;
  admin user receives all FEATURE_KEYS; member user receives only their role's features;
  `twoFactorVerified` merges correctly on `trigger === "update"`.
- **Risk:** MEDIUM-HIGH. The JWT callback is the single source of truth for every
  permission check downstream. The `ensureDefaultRole` race condition was the subject
  of the most recent bug fix (commit `9fd9df6`) — a regression test is warranted.
- **Effort:** ~4 hours. Requires mocking Drizzle queries and `db.update`; isolate
  `ensureDefaultRole` and the JWT callback separately.

### 5. `src/app/(admin)/admin/users/actions.ts` — no tests
- **Missing:** Role assignment writes an `auditEvents` row; role removal writes a row;
  deactivation blocks further sign-in; re-activation allows it.
- **Risk:** MEDIUM. The audit log is an append-only compliance artifact. If it silently
  stops writing, security events are lost with no observable signal.
- **Effort:** ~3 hours. Requires mocking `db.insert` / `db.update`; assert both the
  mutation and the audit write happen in the same call.

### 6. `src/app/(auth)/totp/actions.ts` — no tests
- **Missing:** Valid token completes enrolment; invalid token rejects; recovery code
  bypasses TOTP and invalidates the used code; `FRESH_RECOVERY_CODES_COOKIE` is set
  correctly on enrolment.
- **Risk:** MEDIUM. A regression in the TOTP verify path locks users out of 2FA-
  protected routes silently.
- **Effort:** ~3 hours. Pin `verifyToken` via `vi.mock('@/lib/two-factor')`; mock DB.

### 7. `src/app/(admin)/admin/flags/actions.ts` — no tests
- **Missing:** Toggle writes an `auditEvents` row; toggle updates the `enabled` column;
  a non-admin cannot call the action (session check).
- **Risk:** LOW-MEDIUM. Flag-toggle audit events are required by the invariants section
  of CLAUDE.md.
- **Effort:** ~1 hour. Small file (36 lines); straightforward mock pattern.

## Coverage Targets vs Current State

| Module | Target | Current |
|---|---|---|
| `src/lib/permissions.ts` | 100% | 100% |
| `src/lib/two-factor.ts` | 90%+ | 0% |
| `src/lib/flags.ts` | 100% | 0% |
| `src/proxy.ts` | 80%+ | 0% |
| Overall pure-TS | 70%+ | ~5% (only permissions counted) |

## Recommended Test Stack

Vitest is already wired. The following are not yet installed and are needed for item 2
(proxy) and item 6 (TOTP actions):

- `@testing-library/react` — if component-level testing is added later.
- No additional packages are needed for items 1, 3, 4, 5, 7 — `vi.mock` covers all
  DB and env dependencies.

For proxy tests specifically, `next/server` types are available at test time via the
existing `@types/node`; `NextRequest` can be constructed directly in Vitest.

## Verdict

FAIL against coverage targets. `src/lib/two-factor.ts` and `src/lib/flags.ts` are
at 0% against their 90%+ and 100% targets. The overall pure-TS statement coverage is
effectively 5% (one tiny module covered; six untouched). No regression tests exist for
the bug fixed in commit `9fd9df6`.
