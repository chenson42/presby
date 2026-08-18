# auth.local_login + auth.require_2fa admin flags — Work Log

> **Slug:** `2026-07-01-auth-mode-flags`
> **Surface:** (auth) / src/lib/auth + seed + signin page
> **Permission(s):** none — these are feature FLAGS, not permissions
> **Flag(s):** two new flags: `auth.local_login`, `auth.require_2fa`
> **Estimated complexity:** small–medium (auth-touching — e2e gate applies)
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-01 |
| 2 — Architectural review | architect | Complete | Approved with notes | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-01 |
| 4 — Implementation | api-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Intent (harvest Tier 2 #13, 2026-07-01)

Port explore.press's two auth-mode flags (commit `5cba011`,
`/Users/cshenso/git/explore.press/src/auth.ts:24-42,106-110`):

1. **`auth.local_login`** — gates the Credentials `authorize()` itself, not
   just the sign-in form: when off, a direct POST to the credentials
   callback endpoint cannot bypass an OAuth-only deployment. The signin page
   hides the email/password form when off.
2. **`auth.require_2fa`** — a master switch: the jwt callback computes
   effective `twoFactorRequired = perUserColumn && flag`, so nobody is
   force-enrolled unless an admin turns it on. Enforcement reads the
   effective value off the session, so `proxy.ts` needs no flag check.

Both registered in `scripts/seed.ts` so they appear in `/admin/flags`.
Showcases the starter's own flags system on its most security-relevant
surface — a fork can go OAuth-only or disable forced 2FA without a
redeploy.

Analyst attention: default values (local_login must default ON or every
seeded-credentials fork breaks — including our own e2e suite; require_2fa
default? explore.press defaults both off — reconcile with the starter's
per-user twoFactorRequired semantics and the seeded MFA admin used by e2e);
flag reads are DB hits inside authorize()/jwt — weigh isFlagEnabled()
cache()-wrapping (separate backlog item #10 — note the interaction);
Edge-safety (jwt callback runs where? confirm isFlagEnabled is not pulled
into proxy.ts); e2e implications (auth-touching; the e2e suite's API
sign-in in global-setup uses credentials — flag default must keep it
green).

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Two feature flags — `auth.local_login` and `auth.require_2fa` — gate the
credentials provider and the org-level 2FA master switch respectively. The
feature is well-scoped and matches the explore.press reference closely. Key
positions locked in here: both flags seed ON (not OFF as explore.press did),
`auth.require_2fa` must seed ON to preserve the existing MFA admin e2e test,
both flag reads fail-open on DB error (different from the default behavior of
`isFlagEnabled` which implicitly fails closed). The per-request DB cost of
the require_2fa read in the jwt callback is acceptable for now but must be
flagged to the tech-lead for the design doc. proxy.ts needs no changes.

### What I did

**Pass 1 — User Verbs**

- Admin (via /admin/flags): enables or disables `auth.local_login`; enables
  or disables `auth.require_2fa`. Surface: `/admin/flags`.
- Anonymous visitor (/signin): sees or does not see the email+password form
  depending on `auth.local_login` (server-side read at page render). Surface:
  `/signin`.
- Anonymous visitor: submits credentials form (or bypasses form with a direct
  POST) — `authorize()` gates the actual credentials endpoint, not just the
  form. Surface: `/api/auth/callback/credentials` internal.
- Authenticated user (every request): effective `twoFactorRequired` in their
  JWT is computed as `dbUser.twoFactorRequired && isFlagEnabled("auth.require_2fa")`.
  No user-visible action; the result determines whether proxy.ts redirects
  them to /totp on admin routes.

The request does not mention "the user" without a surface — both flags are
admin-managed and the end-user effects are indirect.

**Pass 2 — Flow Audit**

Flow A — Local sign-in when auth.local_login=ON (happy path):
  Entry: user visits /signin
  Step 1: server component reads flag → renders Google button + credentials form
  Step 2: user submits email + password
  Step 3: authorize() calls isFlagEnabled("auth.local_login") → true → proceeds
    with rate-limit check, DB lookup, bcrypt compare
  Step 4: NextAuth issues JWT, jwt callback runs
  Success: user lands at callbackUrl (defaults to /home per post-login-routing
    work-log)
  Failure: wrong password → "Wrong email or password." message (existing copy)

Flow B — Credentials bypass attempt when auth.local_login=OFF:
  Entry: attacker POSTs directly to /api/auth/callback/credentials (form is
    hidden but endpoint is reachable)
  Step 1: authorize() calls isFlagEnabled("auth.local_login") → false →
    returns null immediately
  Step 2: NextAuth returns CredentialsSignin error
  Success (security): attacker receives a 302 to /signin?error=CredentialsSignin
  Failure path: none (this IS the intended locked-out state)

  Gap: the signin page currently renders "Wrong email or password." for
  CredentialsSignin regardless of the flag state. When local_login=OFF an
  attacker probing the endpoint still gets that message, confirming the endpoint
  exists. Low-risk but worth noting.

Flow C — 2FA gate when auth.require_2fa=ON and user.twoFactorRequired=true:
  Entry: user signs in (any method), jwt callback runs on Node runtime
  Step 1: jwt callback reads dbUser.twoFactorRequired=true → calls
    isFlagEnabled("auth.require_2fa") → true → token.twoFactorRequired=true
  Step 2: user navigates to /admin/*
  Step 3: proxy reads session.user.twoFactorRequired=true and
    twoFactorVerified=false → redirects to /totp?callbackUrl=/admin/...
  Success: user completes TOTP, proxy admits them
  Failure: user has no TOTP secret enrolled → /totp shows no valid codes →
    redirect loop (pre-existing gap, exacerbated by org-level enablement)

Flow D — 2FA gate when auth.require_2fa=OFF:
  Entry: user signs in, jwt callback runs
  Step 1: jwt callback reads dbUser.twoFactorRequired=true → calls
    isFlagEnabled("auth.require_2fa") → false → token.twoFactorRequired=false
  Step 2: all routes accessible without TOTP challenge regardless of per-user
    column
  Success: no TOTP gate for any user
  Failure path: N/A (this is the "disable enforcement" state)

Flow E — Admin toggles auth.local_login OFF:
  Entry: admin visits /admin/flags, finds auth.local_login row, toggles
  Step 1: flag row updated in DB to enabled=false
  Step 2: audit event written (this is already the existing behavior for flag
    toggles via the admin flags page — confirming in gaps below)
  Step 3: next credentials sign-in attempt hits authorize() → flag read → false
    → rejected
  In-flight sessions: unaffected (authorize() ran at sign-in; existing sessions
    keep their JWT)
  Success: credentials sign-in now blocked
  Failure: no explicit confirmation or warning on the flags page that this is
    a system-critical flag — see gaps

**Pass 3 — Permissions & Flags**

No new permission keys needed. The existing `admin.flags` feature
(FEATURES.ADMIN_FLAGS) already gates /admin/flags. Both new flags are managed
through that existing surface.

New flag keys:
- `auth.local_login`: seed `enabled: true`. See default-value position below.
  Rollback: toggle OFF in /admin/flags. Takes effect for new sign-in attempts
  immediately. Active sessions unaffected.
- `auth.require_2fa`: seed `enabled: true`. See default-value position below.
  Rollback: toggle OFF in /admin/flags. Takes effect for all users on next
  request (jwt callback recomputes from DB on every request). No JWT
  invalidation needed.

**Pass 4 — Edge Cases**

The following cases are not mentioned in the request and need resolution:

1. Schema default conflict: `users.twoFactorRequired` has a DB-level default
   of `true` (schema.ts line 27). Seeded users override this to `false`. New
   Google OAuth users get `true` from the schema default. If `auth.require_2fa`
   seeds ON, every new Google OAuth admin (via INITIAL_ADMIN_EMAILS) will be
   TOTP-gated on their first visit to /admin. This is probably intended
   (security-first) but creates a rough onboarding cliff for new forks — a
   fresh admin Google sign-in immediately hits the TOTP gate with no enrollment
   entry point in the gate flow.

2. Signin page server component failure: the page reads the flag via
   `isFlagEnabled("auth.local_login")` as a server component. If the DB is
   unreachable the page throws a 500. The user sees a server error, not a
   sign-in page. Need a try/catch with a sensible default (see failure posture
   below).

3. TOTP enrollment loop: the proxy gate redirects to /totp (verification), not
   to /account/2fa (enrollment). A user with `twoFactorRequired=true` and no
   enrolled secret is stuck. Pre-existing issue but org-level enablement
   elevates it from edge case to common case.

4. Hardcoded signin page microcopy: the current page shows "Continue with
   Google, or sign in with the seeded admin credentials for local testing." This
   copy leaks credentials info in a production deploy where local_login=OFF. The
   description text must be conditional on the flag or replaced with generic
   copy.

5. Cold-path vs warm-path flag reads: authorize() (cold path, fires only at
   sign-in) gets one extra SELECT for local_login — acceptable. The jwt callback
   (warm path, fires on every authenticated request) gets one extra SELECT for
   require_2fa whenever `dbUser.twoFactorRequired=true`. For all new Google
   OAuth users (schema default=true), this is one extra SELECT per request.
   The short-circuit `dbUser.twoFactorRequired && isFlagEnabled(...)` means the
   flag read is skipped for users with the column set to false (seeded admin,
   seeded member). The design doc must decide: accept this read or introduce a
   per-process TTL map. This is the intersection with backlog #10 — and because
   the jwt callback is not an RSC, React's `cache()` does not apply. A simple
   `Map<string, {value: boolean, expiresAt: number}>` with a 60s TTL is the
   lightest viable option. The tech-lead should take a position in the design
   doc.

6. Audit events for flag toggles: the admin flags page should already write
   audit events when flags are toggled (existing behavior). These two flags
   inherit that automatically. The design doc should confirm this assumption
   rather than taking it on faith — if the toggle action doesn't audit, it must
   be added.

**Pass 5 — Adversarial Pass**

- Direct POST bypass: a user can POST to /api/auth/callback/credentials even
  when the form is hidden. The gate is in authorize() returning null, which
  makes this a non-issue. The form hiding is pure UX. Correctly designed in the
  reference.

- JWT claim tampering: a user cannot forge twoFactorRequired=false in their JWT.
  (a) the JWT is signed with AUTH_SECRET, and (b) the jwt callback recomputes
  twoFactorRequired from the DB on every request, overwriting any tampered
  value. Defense-in-depth is already present.

- Flag state manipulation by non-admin: flags are stored server-side in the DB
  and writable only via /admin/flags (gated by FEATURES.ADMIN_FLAGS). A
  non-admin cannot toggle them.

- Race on flag toggle vs in-flight request: admin disables require_2fa at
  T=0. User's request at T=1ms uses the old cached JWT with
  twoFactorRequired=true. The jwt callback at T=1ms reads the flag (now false)
  → computes twoFactorRequired=false → new JWT issued → user gets through. No
  stale enforcement window longer than one request. Acceptable.

- Enumeration via CredentialsSignin when local_login=OFF: a direct POST to the
  credentials endpoint when local_login=OFF returns the same CredentialsSignin
  error as a wrong password when local_login=ON. This is intentional — an
  attacker cannot distinguish "flag is off" from "credentials wrong." Good.

- Self-targeting: an admin cannot grant themselves a role or permission via
  these flags. The flags affect sign-in method and 2FA enforcement, not
  authorization.

### Positions taken

**auth.local_login default: seed `enabled: true`**
Non-negotiable. The e2e globalSetup signs in via credentials for all three
seeded users (admin, member, mfa-admin). If this seeds OFF, all three fail at
the credentials POST step and the entire e2e suite fails at setup. Every fork
that uses the seeded admin for local dev also breaks.

**auth.require_2fa default: seed `enabled: true`**
This diverges from explore.press (which seeds both OFF). Reason: the starter's
seeded MFA admin (`twoFactorRequired=true` in the DB) exists specifically to
assert the /totp redirect fires in e2e. With the explore.press AND logic,
effective twoFactorRequired = `true && isFlagEnabled("auth.require_2fa")`.
If the flag seeds OFF, effective=false, the proxy gate does not fire, and the
MFA admin e2e test breaks. Seeding ON: effective = `true && true = true` →
gate fires → test passes. Seeded local admin and member (both have
`twoFactorRequired=false` in seed) are unaffected: `false && true = false`.

Implication: new Google OAuth users get `twoFactorRequired=true` (schema
default) and will be TOTP-gated on admin routes if they reach /admin. This is
security-first and probably correct for the starter's teaching purpose but
must be called out to the tech-lead.

**auth.local_login failure posture: fail-open (default true on DB error)**
If the DB is unreachable and `isFlagEnabled` throws inside authorize(), catch
the exception and return `true` (allow credentials to proceed). The user still
needs a valid password. Rate limiting still runs. Locking everyone out of
credentials because the flags table had a transient error is a worse outcome
than the marginal security cost of allowing credentials during an outage.

**auth.require_2fa failure posture: fail-open (default false on DB error)**
If the flag read throws inside the jwt callback, catch and default to
`dbUser.twoFactorRequired` as the raw column value (i.e., reproduce the
pre-feature behavior exactly). This avoids both failure modes: (a) suddenly
gating all twoFactorRequired=true users because the flags table is unreachable,
and (b) suddenly unblocking all users who should be gated.

Actually, defaulting to the raw column value IS the pre-feature behavior, which
is safe. The only real risk is that we don't get the master-switch benefit
during the outage, but that's acceptable during a DB incident.

**Where each flag is read:**
- `auth.local_login`: (1) in authorize() in src/auth.ts — gate the actual
  endpoint, not just the form. (2) in src/app/(auth)/signin/page.tsx as a
  server component read — hide/show the form. Both reads use isFlagEnabled
  with a try/catch wrapping.
- `auth.require_2fa`: in the jwt callback in src/auth.ts, short-circuited:
  `dbUser.twoFactorRequired && (await isFlagEnabled(REQUIRE_2FA_FLAG))`.
  Wrapped in try/catch, fallback to raw column value.
- proxy.ts: no change. It reads `session.user.twoFactorRequired` which is the
  effective value baked in by the jwt callback.

**Edge safety confirmed:**
proxy.ts only imports from @/lib/auth/config, which is edge-safe. The jwt
callback (which does the flag read) runs on Node via src/auth.ts. No isFlagEnabled
import reaches the Edge runtime.

### Outputs

Files to be changed in Phase 4 (not by analyst — for reference):
- `src/auth.ts` — authorize() gate for local_login; jwt callback for require_2fa
- `src/app/(auth)/signin/page.tsx` — conditional credentials form
- `scripts/seed.ts` — register both flags with enabled:true defaults
- Possibly `src/lib/flags.ts` — if tech-lead decides to add a try/catch wrapper
  variant for auth-critical paths (or the tech-lead handles this inline)

No new files expected. No schema changes. No new permissions.

### Open questions / handoff notes for architect and tech-lead

- Gap 1 (schema default conflict): the MFA-enrollment-on-first-admin-visit cliff
  is a pre-existing issue but is newly triggered by seeding require_2fa ON. Is
  the current /totp page behavior acceptable for a new Google admin who has never
  enrolled, or do we need a redirect-to-enrollment path from /totp?

- Gap 2 (signin page 500 on flag DB failure): should the try/catch default to
  showing the credentials form (fail-open) or hiding it (fail-closed)? My
  recommendation is fail-open (show form) because authorize() will reject it
  anyway if the DB returns for the flag read, and the user gets a clear error
  vs. an unrecoverable 500 page.

- Gap 3 (TOTP enrollment loop): pre-existing, but elevated by this feature.
  Not in scope for this work-log unless the tech-lead decides to fold in the
  enrollment redirect as part of this design.

- Gap 4 (signin page microcopy): the string "Continue with Google, or sign in
  with the seeded admin credentials for local testing" must not appear in
  production. Either gate it behind the flag (only show when local_login=ON) or
  replace with generic copy that doesn't reference credentials.

- Gap 5 (per-request flag read cost for require_2fa): the tech-lead design doc
  must take a position. Accept the read (1 extra SELECT per request for
  twoFactorRequired=true users) or add a per-process TTL map. React cache()
  does not apply here. The interaction with backlog #10 should be documented
  even if the full cache() wrapping is not implemented in this work item.

- Gap 6 (audit events for flag toggle): confirm that the existing admin flags
  toggle action already writes to audit_events. If not, add it in this work item.

- e2e: the auth-touching gate requires a running-server e2e smoke before Phase 5.
  The existing 28-test suite must remain green with both flags seeded ON. A
  "local_login=OFF" or "require_2fa=OFF" behavioral scenario is OUT OF SCOPE for
  e2e (requires mid-suite DB state mutation); unit-test the authorize() gate and
  jwt callback logic with mocked isFlagEnabled instead.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

Approved with notes. The structural shape is correct: two feature flags, both seeded, flag reads in Node-runtime-only callbacks, proxy untouched. One non-negotiable implementation ruling: `auth.local_login` requires explicit fail-open handling — the standard `isFlagEnabled()` (which returns `false` on a missing row or DB error) cannot be used directly for this flag, because `false` on the credential-gate flag means "deny all sign-ins," not "feature is off." A fail-open wrapper is mandatory. DECISION-026 logged establishing the fail-open convention for auth-critical flags.

### What I did

- Confirmed `isFlagEnabled()` is Node-runtime-only (`@/lib/db` import). The `jwt` callback and `authorize()` run in Node runtime. `proxy.ts` uses `edgeAuth` (Edge-safe JWT read only) and must NOT import `isFlagEnabled`. No change to `proxy.ts` required or permitted by this feature.
- Ruled on `auth.local_login` failure posture: fail-open is mandatory. Standard `isFlagEnabled()` returns `false` on a missing row — wrong behavior for a flag that gates sign-in. The implementer must use a fail-open variant: a named helper (`isLocalLoginEnabled()` following the `lockout.ts` DI pattern in `src/lib/auth/`) with explicit `catch → true` semantics, so a DB blip never locks out credentials sign-in. See DECISION-026.
- Ruled on `auth.require_2fa` failure posture: the analyst's "default to raw column value on error" posture is correct. Standard `isFlagEnabled()` returning `false` on a missing row is also acceptable here — missing flag = no enforcement = safe default. No special wrapper required.
- Endorsed seed registration: `auth.local_login` seeded `enabled: true` (safe default; required for e2e suite); `auth.require_2fa` seeded `enabled: true` (required to keep the MFA-admin e2e test green — the analyst's reasoning in Phase 1 is sound).
- Endorsed signin-page conditional form rendering as a server-side read in a Server Component (Node runtime). No Edge concern. The fail-open posture for this read (show form on DB error, since `authorize()` will still reject bad credentials) is the right UX decision.
- Confirmed `cache()` interaction (flag-caching backlog item #10): harmless in `authorize()` and `jwt()` callbacks — cache() is a no-op outside RSC render trees. No implementation-time accommodation needed.
- Confirmed the auth-touching e2e gate (CLAUDE.md Phase 4) applies: this feature touches `src/lib/auth/`, `src/auth.ts`, and `src/app/(auth)/`. A running-server e2e smoke covering the full sign-in path (including the MFA-enrolled user) is required before Phase 5 can begin.

### Outputs

- `docs/work-log/2026-07-01-auth-mode-flags.md` — Phase 2 section added; status updated
- DECISION-026 logged in `docs/decisions.md`

### Open questions / handoff notes

For tech-lead (Phase 3):
- Design the `isLocalLoginEnabled()` helper in `src/lib/auth/local-login.ts` (or equivalent). It should query `featureFlags` WHERE `key = "auth.local_login"`, return `true` if row is missing (fail-open), return `row.enabled` if row exists, and catch DB errors returning `true`. Companion unit test with a mocked DB call confirms the three branches.
- The effective `twoFactorRequired` override in `jwt()`: compute as `dbUser.twoFactorRequired && (await isFlagEnabled("auth.require_2fa"))` wrapped in try/catch that falls back to the raw column value. Standard `isFlagEnabled` is safe here.
- Signin page microcopy: the existing "Continue with Google, or sign in with the seeded admin credentials for local testing" string must be conditionally hidden (or replaced with generic copy) when `auth.local_login` is disabled. Gate its rendering on the flag read.
- Gap 5 (per-request flag read cost for require_2fa in jwt callback): the tech-lead must take a position in the design doc. Accept the extra SELECT (one per request for users with `twoFactorRequired=true`) or add a per-process TTL map. React `cache()` does not apply here (callbacks are not RSC context).
- Gap 1 (new Google OAuth admin hits TOTP gate on first visit): pre-existing issue, now elevated by seeding `require_2fa: true`. Document the known onboarding cliff in the design doc; do not attempt to fix it in this work item unless the tech-lead explicitly includes it in scope.

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

Two feature flags gate the credentials provider (`auth.local_login`) and the org-level 2FA master switch (`auth.require_2fa`). Both seed ON. The flag check inside `authorize()` is placed BEFORE the rate-limit check so that a disabled-flag rejection does not consume rate-limit budget. The jwt callback short-circuits the require_2fa read when the column is false. Gap 5 (per-request SELECT cost) is accepted without a TTL map; the flag-caching work (D) ships `cache(isFlagEnabled)` but that wrapper is a no-op in jwt/authorize context — acceptable overhead for a single flag-row SELECT per jwt callback invocation. Gap 6 confirmed: `FEATURE_FLAG_TOGGLED` already fires for every flag toggle in `toggleFlagAction` — no additional audit work. The /totp enrollment-stranding gap (Gap 2/3) is out of scope; a TODO Backlog entry is added below.

### What I did

**`src/lib/auth/local-login.ts` — new file**

Named helper following the lockout.ts DI pattern. No `db` import inside the module itself — the caller (authorize()) passes a `find` function for testability. Actually, for simplicity and because the db import is already in scope in src/auth.ts, the helper queries directly via `db` (same pattern as sign-in-gate.ts which also imports db). Three branches with explicit comments:

```typescript
// src/lib/auth/local-login.ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";

const FLAG_KEY = "auth.local_login";

/**
 * Fail-open helper for the auth-critical `auth.local_login` flag.
 *
 * Fail-open means: on DB error or missing row, return true (allow credentials).
 * Standard isFlagEnabled() returns false on missing row — WRONG for a flag
 * that gates sign-in itself. See DECISION-026.
 *
 * Three outcomes:
 *   row missing  → true  (flag not yet seeded; treat as enabled)
 *   row.enabled  → row.enabled (admin explicitly set it)
 *   DB error     → true  (never lock out credentials during a DB blip)
 */
export async function isLocalLoginEnabled(): Promise<boolean> {
  try {
    const row = await db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, FLAG_KEY),
    });
    return row === undefined ? true : row.enabled;
  } catch {
    return true;
  }
}
```

Unit tests in `src/lib/auth/local-login.test.ts`: mock `db.query.featureFlags.findFirst` for three cases: (1) returns undefined → true; (2) returns `{ enabled: true }` → true; (3) returns `{ enabled: false }` → false; (4) throws → true.

**`src/auth.ts` — `authorize()` changes**

Flag check is inserted FIRST, before the rate-limit check:

```typescript
// Step 1: flag check — BEFORE rate limit so a disabled-flag rejection
// does not consume rate-limit budget on a permanently-blocked code path.
const localLoginEnabled = await isLocalLoginEnabled();
if (!localLoginEnabled) return null;

// Step 2: Rate limit (existing)
const limited = await checkRateLimit(...);
if (!limited.allowed) return null;
```

No other changes to authorize() are needed. The existing lockout check and bcrypt compare follow unchanged.

**`src/auth.ts` — `jwt` callback changes**

After the existing Tier-A SELECT that reads `dbUser.twoFactorRequired`, insert the effective-twoFactorRequired computation:

```typescript
// Short-circuit: if column is false, skip the flag read entirely.
// If column is true, read the flag — fail-open to raw column on error.
let effectiveTwoFactorRequired = dbUser.twoFactorRequired;
if (dbUser.twoFactorRequired) {
  try {
    const flagEnabled = await isFlagEnabled("auth.require_2fa");
    effectiveTwoFactorRequired = flagEnabled;
  } catch {
    // DB blip: fall back to raw column value — pre-feature behavior.
    effectiveTwoFactorRequired = dbUser.twoFactorRequired;
  }
}
token.twoFactorRequired = effectiveTwoFactorRequired;
```

Replace the current single-line `token.twoFactorRequired = dbUser.twoFactorRequired;` with the above block. Standard `isFlagEnabled` (not the fail-open variant) is correct here — missing row → false → no enforcement → safe default.

**Gap 5 position (per-request SELECT cost): ACCEPTED**

The `auth.require_2fa` read fires once per jwt() callback invocation for users with `twoFactorRequired=true`. Before the flag-caching work ships, that is 2× per request at /home and /admin (layout + page each call `auth()`). After flag-caching ships `cachedAuth`, it drops to 1× per request. Both are acceptable overhead for a single indexed flag-row SELECT. A per-process TTL map adds ~30 lines of state management with edge cases (process restart, flag-toggle propagation delay) that are not worth it at starter scale. Documented here; revisit if a fork runs at scale where per-request DB queries are budget-constrained.

**Gap 6 confirmation: DONE — no work needed**

Reading `src/app/(admin)/admin/flags/actions.ts`: `toggleFlagAction` calls `recordAudit({ action: AUDIT_ACTIONS.FEATURE_FLAG_TOGGLED, ... })` after every toggle. Both new flags inherit this automatically. No additional audit work required.

**`src/app/(auth)/signin/page.tsx` — conditional form + microcopy**

The page is a Server Component. Read `isLocalLoginEnabled()` at render time. Two changes:
1. Replace the hardcoded description paragraph with generic copy: "Sign in to your account." (no mention of seeded credentials — that text is test-specific and wrong in production).
2. Conditionally render the divider (`or` separator) and the credentials form block (email/password inputs + "Sign in with email" button + "Forgot password?" link + "First time? Run `npm run db:seed`..." hint) only when `localLoginEnabled === true`.

The Google form is always rendered regardless of the flag.

**`scripts/seed.ts` — two new flag entries in `seedFlags()`**

```typescript
{
  key: "auth.local_login",
  description:
    // ON: credentials sign-in (email + password) is available. Seed ON — required
    // for e2e global-setup (all three seeded users authenticate via credentials).
    // Turn OFF to make this deployment Google-OAuth-only (authorize() rejects
    // the credentials endpoint even if a POST is crafted directly).
    "Enable email + password sign-in. OFF = OAuth-only; credentials endpoint is blocked.",
  enabled: true,
},
{
  key: "auth.require_2fa",
  description:
    // ON: effective twoFactorRequired = dbUser.twoFactorRequired AND this flag.
    // Seed ON — required to keep the seeded MFA admin e2e test green (that user
    // has twoFactorRequired=true in DB; without this flag the proxy gate doesn't fire).
    // Turn OFF to globally disable forced 2FA regardless of per-user column.
    "Org-level 2FA master switch. OFF = no user is TOTP-gated regardless of per-user column.",
  enabled: true,
},
```

Both entries use `onConflictDoNothing()` (existing pattern) so re-running seed is idempotent.

**Unit test for require_2fa=OFF (analyst open question 1 — endorsed)**

In `src/lib/auth/local-login.test.ts` or a new `src/auth.test.ts`: mock `isFlagEnabled` to return false for `"auth.require_2fa"` and confirm that the jwt callback sets `token.twoFactorRequired = false` for a user with `dbUser.twoFactorRequired = true`. This is the critical behavioral assertion.

**Out-of-scope items**

Gap 1 (new Google OAuth admin hits TOTP gate without enrollment): pre-existing onboarding cliff. Documented here; not fixed in this work item. The flow: new admin signs in → jwt callback sets `twoFactorRequired = true` (from schema default) AND `require_2fa` flag is ON → proxy redirects to /totp → no enrolled secret → /totp cannot complete. Forks should either set `twoFactorRequired: false` as the DB default for new OAuth users or provide an enrollment redirect in the /totp gate. Tracked in Backlog.

Gap 2/3 (enrollment stranding): see TODO Backlog.

### Outputs

- Files to create: `src/lib/auth/local-login.ts`, `src/lib/auth/local-login.test.ts`
- Files to modify: `src/auth.ts` (authorize + jwt), `src/app/(auth)/signin/page.tsx`, `scripts/seed.ts`
- No schema changes. No new permissions.
- No new DECISION entries (DECISION-026 already covers the fail-open convention).

### Open questions / handoff notes

For **api-developer** (Phase 4 implementer):
- Implement exactly as designed above. Auth-touching e2e gate applies — run the full e2e suite against a live dev server before handing off to qa.
- Unit test the jwt callback's effective-twoFactorRequired computation with `isFlagEnabled` mocked to false — this is the most important behavioral assertion.
- The `sql<number>` at `src/app/(admin)/admin/flags/actions.ts:24` (`sql\`now()\``) has no type parameter — the check:audit tripwire does not apply to this route handler (it scans only actions.ts files, and this IS an actions.ts, but no mutation in the flag check occurs — the toggleFlagAction already has recordAudit; no change needed).
- Do NOT attempt to fix the enrollment-stranding gap in this work item.

**TODO Backlog item added (enrollment stranding):** "TOTP enrollment-stranding gap — user with `twoFactorRequired=true` and no enrolled secret is redirected to /totp (verification), not /account/2fa (enrollment), and gets stuck in a redirect loop. Pre-existing but elevated by seeding `require_2fa: true`. Needs: either a redirect-to-enrollment path from the /totp page when no secret is enrolled, or a pre-enrollment check in the proxy gate — `docs/work-log/2026-07-01-auth-mode-flags.md` Phase 3."

---

## Phase 4 — Implementation (API) — 2026-07-01

**Owner:** api-developer
**Status:** complete

### Summary

Implemented `auth.local_login` and `auth.require_2fa` flags per the Phase 3 design exactly. Two new helpers in `src/lib/auth/local-login.ts` encapsulate both flag reads in testable, named functions. The authorize() gate now rejects credentials before consuming rate-limit budget when the flag is off. The jwt callback now writes the effective twoFactorRequired value (flag AND column) rather than the raw column. All 30 e2e tests pass with both flags seeded ON.

### What I did

- Created `src/lib/auth/local-login.ts` with two helpers:
  - `isLocalLoginEnabled()` — fail-open DB read; missing row or DB error returns `true` (DECISION-026)
  - `computeEffectiveTwoFactor(rawRequired)` — short-circuits when false; reads `auth.require_2fa` via `isFlagEnabled` when true; falls back to raw column on error
- Created `src/lib/auth/local-login.test.ts` — 10 unit tests covering all four branches of `isLocalLoginEnabled` and all five cases of `computeEffectiveTwoFactor` (including the critical "flag OFF → false even when column=true" assertion the design required)
- Modified `src/auth.ts`:
  - Added import for `isLocalLoginEnabled`, `computeEffectiveTwoFactor`
  - `authorize()`: inserted Step 0 local_login check before rate-limit (does not consume budget on permanently-blocked path)
  - `jwt()`: replaced single `token.twoFactorRequired = dbUser.twoFactorRequired` line with `await computeEffectiveTwoFactor(dbUser.twoFactorRequired)` call with comment citing DECISION-026
- Modified `src/app/(auth)/signin/page.tsx`:
  - Added `isLocalLoginEnabled()` call at render time (safe — helper is fail-open)
  - Replaced hardcoded "Continue with Google, or sign in with the seeded admin credentials for local testing." with "Sign in to your account."
  - Wrapped divider, credentials form, and "First time? Run db:seed" hint in `{localLoginEnabled && (...)}`; Google button always renders
- Modified `scripts/seed.ts` — added `auth.local_login` (enabled: true) and `auth.require_2fa` (enabled: true) to `seedFlags()` with WHY comments; both use `onConflictDoNothing()` (idempotent)
- Ran `npm run db:seed` — confirmed "seeded 3 feature flags" (up from 1)

### Verification results

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 warnings) |
| `npm run test` | PASS — 336 tests, 29 test files (10 new from local-login.test.ts) |
| `npm run check:audit` | PASS |
| `npm run check:sql-date` | PASS |
| `npm run build` | PASS (clean Turbopack build, 22 routes) |
| `npm run db:seed` | PASS — 3 flags registered |
| HTTP 200 on /signin | PASS |
| `npx playwright test` | PASS — **30/30** (including MFA-admin redirect test #20 and #24) |

### Outputs

- `src/lib/auth/local-login.ts` — new file
- `src/lib/auth/local-login.test.ts` — new file
- `src/auth.ts` — authorize() Step 0 gate; jwt() effective twoFactorRequired
- `src/app/(auth)/signin/page.tsx` — conditional credentials form, generic microcopy
- `scripts/seed.ts` — two new flag entries

**API contract consumed by next agents (no new routes):**
- `isLocalLoginEnabled(): Promise<boolean>` — importable from `@/lib/auth/local-login`; fail-open
- `computeEffectiveTwoFactor(rawRequired: boolean): Promise<boolean>` — importable from `@/lib/auth/local-login`
- Both flags now visible in `/admin/flags` (seeded via `npm run db:seed`)
- No schema changes; no migrations needed

### Deviations from Phase 3 design

- Extracted `computeEffectiveTwoFactor()` into `src/lib/auth/local-login.ts` rather than inlining it in the jwt callback. This allowed direct unit testing of the require_2fa fallback logic without mocking NextAuth callback machinery. Functionally identical to the inline design.

### Open questions / handoff notes

Next agent: **qa**

- The 10 new unit tests in `src/lib/auth/local-login.test.ts` cover all branches of both helpers. The test for "require_2fa OFF with column=true → false" (test #3 in `computeEffectiveTwoFactor`) is the critical behavioral assertion the design flagged.
- E2e gate satisfied: all 30 Playwright tests passed against live dev server with both flags seeded ON. MFA-admin redirect test (test #20 and role-boundaries #24) confirms `require_2fa=ON` + `twoFactorRequired=true` still fires the proxy gate correctly.
- No further implementation work needed before qa Phase 5. The enrollment-stranding backlog item (TOTP → /totp with no enrolled secret) remains out of scope.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS (AUTH-TOUCHING — e2e gate satisfied). QA ran the full Playwright suite (30/30) against a live dev server with both `auth.local_login` and `auth.require_2fa` seeded ON. Tests 20 and 24 confirm the MFA-admin proxy gate fires correctly with `require_2fa=ON` and `twoFactorRequired=true`. All fail-open semantics verified by reading (missing row → true, DB error → true for local_login; throws → rawRequired fallback for require_2fa). `authorize()` Step 0 is before rate-limit (line 110-111 in `auth.ts`). Sign-in page is Google-always, credentials-conditional. All 336 unit tests pass, typecheck is clean, lint is clean.

### What I did

- **e2e gate (AUTH-TOUCHING):** killed stale port-3000 processes (none present), started `npm run dev`, waited for HTTP 200, ran `npx playwright test` → 30/30 passed in 29.8s. Killed server.
- Verified `src/lib/auth/local-login.ts` fail-open semantics:
  - `isLocalLoginEnabled()`: `row == null ? true : row.enabled` (missing row → true) and `catch { return true }` (DB error → true). ✓
  - `computeEffectiveTwoFactor()`: `if (!rawRequired) return false` (short-circuit); `catch { return rawRequired }` (DB error → raw column, pre-feature behavior). ✓
- Verified `src/auth.ts` `authorize()`: Step 0 local_login flag check (`await isLocalLoginEnabled()` + `if (!localLoginEnabled) return null`) appears before rate-limit check at lines 110-111. Does not consume rate-limit budget on permanently-blocked path. ✓
- Verified `src/auth.ts` `jwt()`: `token.twoFactorRequired = await computeEffectiveTwoFactor(dbUser.twoFactorRequired)` at lines 282-284. Comment cites DECISION-026 and explains short-circuit and fallback. ✓
- Verified `src/app/(auth)/signin/page.tsx`: Google form always rendered (outside the `localLoginEnabled &&` block). Credentials form, divider, forgot-password link, and `npm run db:seed` hint are all inside `{localLoginEnabled && (...)}`. Microcopy is "Sign in to your account." (no credentials reference). ✓
- Verified `scripts/seed.ts`: both `auth.local_login` (enabled: true) and `auth.require_2fa` (enabled: true) entries present in `seedFlags()`, both with WHY comments, both using `onConflictDoNothing()`. ✓
- Confirmed `isFlagEnabled` used in `computeEffectiveTwoFactor` is the `cache()`-wrapped version from Pipeline D (`src/lib/flags.ts`). In jwt/authorize context `cache()` is a no-op — harmless, confirmed by both pipelines' docs. ✓
- Confirmed enumeration surface unchanged: `local_login=OFF` rejection goes through `return null` in `authorize()` → NextAuth surfaces the same `CredentialsSignin` error as a wrong password. Attacker cannot distinguish "flag off" from "wrong credentials." ✓
- Ran `npm run typecheck` — PASS. `npm run lint` — PASS. `npm run test` — 336 passed (29 files, 10 new tests in `local-login.test.ts`).

**Feature-Gate Audit:** no new user-facing protected routes or server actions. `src/app/(auth)/signin/page.tsx` is a public page (no auth gate applies — it is the sign-in surface). The new `src/lib/auth/local-login.ts` is a utility module with no route exposure. The flag reads in `authorize()` and `jwt()` are internal to NextAuth callbacks, not route-level gates.

### Coverage on Critical Modules (all five pipelines)

| Module | Statements | Branches | Functions |
|--------|-----------|----------|-----------|
| `src/lib/permissions.ts` | 100% (5/5) | 100% (2/2) | 100% (1/1) |
| `src/lib/two-factor.ts` | 100% (42/42) | 100% (9/9) | 100% (9/9) |
| `src/lib/flags.ts` | 100% (3/3) | 100% (2/2) | 100% (1/1) |
| `src/lib/auth/local-login.ts` | 100% (11/11) | 100% (4/4) | 100% (2/2) |
| `src/lib/auth/cached-auth.ts` | 100% (1/1) | n/a | n/a |

### Regression Tests Added

- 10 tests in `src/lib/auth/local-login.test.ts` covering all branches of `isLocalLoginEnabled` (4 branches + 1 call-count) and `computeEffectiveTwoFactor` (5 cases). The critical behavioral assertion is test 3 of `computeEffectiveTwoFactor`: "rawRequired = true, flag OFF → false — master switch disables enforcement."

### Shared Verification Results (all five pipelines)

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 warnings) |
| `npm run test` | PASS — 336 tests, 29 files, 0 failed |
| `npm run check:audit` | PASS |
| `npm run check:sql-date` | PASS |
| `npm run check` (umbrella) | PASS |
| `npx playwright test` (30 tests) | PASS — 30/30 |
| Maintenance route curl (no CRON_SECRET) | HTTP 503 (correct) |

### Open questions / handoff notes

- Next agent: analyst for Phase 6.
- E2e gate satisfied per AUTH-TOUCHING rule: suite ran against live dev server, MFA-enrolled user (mfa-admin storageState) exercised by tests 20 and 24.
- TOTP enrollment-stranding gap (Backlog item in `docs/TODO.md`) remains out of scope. `require_2fa=ON` with a new Google OAuth user who has never enrolled will hit `/totp` with no enrolled secret — pre-existing issue. Tracked in Backlog.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. Both flags are implemented at the endpoint level (not just form-hiding), with fail-open postures that prevent lockout during DB blips, defaults (both ON) that keep the e2e suite green and preserve the existing MFA-admin test, and no new enumeration surface. The TOTP enrollment-stranding gap is correctly tracked in Backlog and out of scope.

### What I did

- Read `src/lib/auth/local-login.ts`: `isLocalLoginEnabled()` returns `true` on missing row (`row == null ? true : row.enabled`) and `true` on DB error (`catch { return true }`). Matches DECISION-026 fail-open requirement exactly.
- Read `src/lib/auth/local-login.ts`: `computeEffectiveTwoFactor()` short-circuits when `rawRequired` is false; reads `auth.require_2fa` via `isFlagEnabled` when true; catches DB errors and falls back to `rawRequired` (pre-feature behavior). Correct.
- Read `src/auth.ts` lines 106-111: Step 0 local_login flag check is before the rate-limit call at line 113. A disabled-flag rejection does not consume rate-limit budget. Matches Phase 3 design.
- Read `src/auth.ts` line 282: `token.twoFactorRequired = await computeEffectiveTwoFactor(dbUser.twoFactorRequired)`. Matches Phase 3 design.
- Read `src/app/(auth)/signin/page.tsx`: Google form (`<form action={signIn("google")}>`) is outside the `{localLoginEnabled && (...)}` block and always renders. Credentials form, divider, forgot-password link, and db:seed hint are all inside the conditional. Microcopy is "Sign in to your account." with no reference to seeded credentials.
- Confirmed `scripts/seed.ts` lines 60 and 71: `auth.local_login` (enabled: true) and `auth.require_2fa` (enabled: true) present with WHY comments and `onConflictDoNothing()`.
- Phase 1 Gap 4 (signin page microcopy leaking credentials): fixed — description paragraph changed; the email input placeholder `admin@claudecode.info` is pre-existing, inside the `localLoginEnabled` conditional (invisible when OAuth-only), and not the same concern. Acceptable.
- Phase 1 Gap 3 (TOTP enrollment-stranding): out of scope per Phase 3 design; tracked in `docs/TODO.md` Backlog. Verdict: correctly deferred.
- Phase 1 Gap 6 (audit events for flag toggle): confirmed `toggleFlagAction` already writes `FEATURE_FLAG_TOGGLED`. Both new flags inherit this automatically. No work needed.
- Auth-touching e2e gate: 30/30 Playwright tests including tests 20 and 24 (MFA-admin redirect and role-boundary checks).

### Outputs

- `docs/work-log/2026-07-01-auth-mode-flags.md` — Phase 6 section added; status table updated

### Intent-vs-shipped diff

- Phase 1 said: OAuth-only at endpoint level (not just form-hiding). Shipped: `authorize()` calls `isLocalLoginEnabled()` and returns `null` before rate-limit when off; form hiding is UX only. Verdict: matches.
- Phase 1 said: fail-open for local_login (DB error → allow credentials). Shipped: `catch { return true }` in `isLocalLoginEnabled()`. Verdict: matches.
- Phase 1 said: fail-open for require_2fa (DB error → raw column value). Shipped: `catch { return rawRequired }` in `computeEffectiveTwoFactor()`. Verdict: matches.
- Phase 1 said: both flags seed ON to keep e2e green. Shipped: both seeded `enabled: true`. Verdict: matches.
- Phase 1 said: no new enumeration surface. Shipped: `return null` in `authorize()` when flag is off → same `CredentialsSignin` error as wrong password; attacker cannot distinguish. Verdict: matches.
- Phase 1 said: no changes to proxy.ts. Shipped: proxy.ts reads `session.user.twoFactorRequired` (effective value baked by jwt callback). No proxy.ts change. Verdict: matches.

### Edge cases

- Empty state (flag row missing before seed): `isLocalLoginEnabled()` returns `true` (fail-open) — credentials remain available. `isFlagEnabled("auth.require_2fa")` returns `false` (no row) → no 2FA enforcement. Both safe defaults for a fresh fork. Pass.
- Failure microcopy: "Sign in to your account." for all users; "Wrong email or password." for credentials failure regardless of flag state. No credentials reference in production copy. Pass.
- Permission gate: `authorize()` Step 0 is before rate-limit — correct ordering. `jwt()` computes effective twoFactorRequired before writing to token — proxy reads the already-computed value. Pass.
- Audit event: flag toggles via `/admin/flags` already write `FEATURE_FLAG_TOGGLED` — both new flags inherit this. Pass.
- Mobile: signin page is server-rendered HTML with Tailwind; no new layout introduced. Not in scope for this feature but no regression introduced. Pass (N/A for new work).

### Open questions / handoff notes

No follow-ups from this pipeline. The TOTP enrollment-stranding gap (Backlog) predates this work and is tracked separately. Pipeline closed.
