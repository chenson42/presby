# E2E auth infrastructure — cached storageState, role boundaries, DB isolation — Work Log

> **Slug:** `2026-07-01-e2e-auth-infra`
> **Surface:** e2e/ + playwright.config.ts (+ possibly scripts/seed.ts)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-01 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-01 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Intent (from harvest, 2026-07-01)

Every e2e spec currently drives the sign-in UI from scratch — slower, and
brittle. Harvest Tier 2 item 9 identified npvitals' e2e infrastructure as the
biggest available upgrade:

- **Cached-storageState auth** (`npvitals/e2e/support/global-setup.ts:43-95`):
  a Playwright `globalSetup` seeds role users, signs each in by POSTing
  `/api/auth/callback/credentials` (csrf token + credentials) instead of
  driving the UI, verifies the session via `/api/auth/session`, and caches
  per-role `storageState` with a 12h TTL refresh.
- **Role-boundary spec** (`npvitals/e2e/role-boundaries.spec.ts`): asserts
  each role can/can't reach protected routes, reusing the cached fixtures.
  Clever trick: POST intentionally invalid bodies — a `400` proves the
  permission gate passed, a `403`/redirect proves it blocked — testing
  authorization without writing fixture data.
- **Prod-DB isolation guard** (huddleup `web/e2e/global-setup.ts`, kit §D1):
  refuse to run when `DATABASE_URL` is a `*.neon.tech` host unless
  `E2E_DATABASE_URL` or `E2E_ALLOW_SHARED_DB=true` is set. The starter's
  suite can currently pollute a shared Neon DB silently.

**Known tension for the design (from the routing feature's DECISION/e2e
option (c)):** the starter deliberately avoids seeding a known TOTP secret,
so npvitals' live-TOTP-code sign-in (`mfa-enrolment.spec.ts`) cannot port
as-is. The analyst/tech-lead must reconcile: either keep option (c) scope
(routing-gate assertions only) with cached sessions for the non-MFA roles,
or revisit the seeded-secret decision explicitly (it was rejected for
security reasons — a fork shipping a predictable 2FA secret).

**Existing assets:** three seeded users (SEED_ADMIN_*, SEED_MEMBER_*,
SEED_MFA_ADMIN_*), 20 passing e2e tests across 5 spec files.

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

The feature replaces 17 per-test UI sign-ins across 5 spec files with 3 cached credential-API calls in a Playwright `globalSetup`, adds a `role-boundaries.spec.ts` using injected storageState, and adds a prod-DB isolation guard. The scope is well-defined. Five-pass review surfaces seven notes, three of which require explicit tech-lead decisions before implementation can start: (1) the DB guard's default posture when the developer's own dev DB is a Neon host — the huddleup guard would block current local runs immediately; (2) the NextAuth 5 beta.31 credentials endpoint compatibility, specifically whether `json: "true"` is still required and how the POST response is structured; and (3) what "role-boundary probe" means in a server-action-first architecture where the npvitals REST POST pattern does not apply. TOTP reconciliation is resolved: option (c) from the routing feature is confirmed correct — the mfa-admin storageState is intentionally `twoFactorVerified=false` and that is the right fixture state for the `/totp` redirect assertion. No new permissions, flags, or schema changes.

**Verdict: READY WITH NOTES**

**One-line take:** This is the right infrastructure upgrade — 17 UI sign-ins become 3 API calls and spec isolation improves dramatically — but the DB guard posture and two compatibility questions must be settled in Phase 3 before any implementation begins.

---

### Pass 1 — User Verbs

The "user" here is the developer or CI runner invoking the test suite, and the spec author who writes tests against the new fixtures.

**Developer — local run:**
- Runs `npm run test:e2e` (dev server already running on port 3000)
- Observes globalSetup console output: DB guard pass/warn/block, storageState fresh/refreshed
- Reads a clear error and fix instructions if the DB guard fires
- Sets `E2E_DATABASE_URL` or `E2E_ALLOW_SHARED_DB=true` in `.env.local` to satisfy the guard
- Deletes `e2e/.auth/` manually to force a full storageState refresh after credential changes

**Developer — spec authoring:**
- Writes `test.use({ storageState: storageStatePath("admin") })` at the describe level to inject admin session, no sign-in in the test body
- Writes `test.use({ storageState: storageStatePath("member") })` for member-gate assertions
- Writes `test.use({ storageState: storageStatePath("mfa-admin") })` to test the 2FA-pending state
- Writes `page.goto("/some-protected-route")` + pathname assertion; no form fill needed

**CI runner:**
- Sets `E2E_DATABASE_URL` (preferred — isolated Neon branch) or `E2E_ALLOW_SHARED_DB=true` in CI secrets
- `npm run test:e2e` runs globalSetup fresh on every build (no `.auth/` cache between runs)
- globalSetup makes exactly 3 API sign-in calls, saves storageState, then specs run

---

### Pass 2 — Flow Audit

**Flow A: globalSetup — first run (no cache, local dev)**

```
Entry: npm run test:e2e; no e2e/.auth/*.json files present
  → playwright.config.ts registers globalSetup via globalSetup: "./e2e/global-setup.ts"
  → DB guard:
      check E2E_DATABASE_URL → not set
      check DATABASE_URL → neon.tech host detected
      check CI env var → [DECISION — see Gap 1: warn vs block vs warn-locally/block-in-CI]
      check E2E_ALLOW_SHARED_DB → not set
  → mkdir e2e/.auth/ (recursive, no-op if exists)
  → for each role user in [admin, member, mfa-admin]:
      → stat(e2e/.auth/<role>.json) → ENOENT → isStorageStateFresh = false
      → chromium.launch()
      → page.goto("/signin") — establishes NextAuth cookie jar
      → GET /api/auth/csrf → { csrfToken }
      → POST /api/auth/callback/credentials
          { csrfToken, email, password }
          [NO totpCode — see Gap 2]
          [json: "true" field — see Gap 2]
      → if !callbackRes.ok() → throw Error with status + body (CI fails clearly)
      → GET /api/auth/session → { user: { email } }
      → if session.user.email !== user.email → throw Error with session dump
      → context.storageState({ path: e2e/.auth/<role>.json })
      → browser.close()
  → specs run; each spec with test.use({ storageState }) skips every UI sign-in
Outcome: all 20 existing tests pass without any sign-in form interaction;
  new role-boundaries spec runs with injected sessions
Failure A: DB guard throws → Playwright exits non-zero before any spec; fix instructions printed
Failure B: credentials POST returns non-2xx → Error thrown with status + response body
Failure C: /api/auth/session returns {} → Error thrown with session payload
```

**Flow B: globalSetup — cache hit (re-run within 12h TTL)**

```
Entry: npm run test:e2e; e2e/.auth/*.json files present and < 12h old
  → DB guard passes (same check)
  → for each role user: stat() → mtime within TTL → isStorageStateFresh = true → skip signInAndSave()
  → specs run immediately with cached cookies
Outcome: fast run; zero API calls; effectively instantaneous globalSetup
Failure: none expected; TTL logic uses clock, not content
```

**Flow C: role-boundary spec — member cannot reach /admin**

```
Entry: spec with test.use({ storageState: storageStatePath("member") })
  → Playwright injects member session cookies (no admin.dashboard in features)
  → page.goto("/admin")
  → proxy.ts: reads JWT, no admin.dashboard → redirect to /access-pending
  → assert pathname === "/access-pending"
Outcome: proves member cannot access admin area via proxy gate
Failure (gate broken): pathname === "/admin" → assertion fails; clear CI signal
```

**Flow D: role-boundary spec — MFA admin redirected to /totp**

```
Entry: spec with test.use({ storageState: storageStatePath("mfa-admin") })
  → cookies carry JWT with twoFactorRequired=true, twoFactorVerified=false
  → page.goto("/admin")
  → proxy.ts: sees twoFactorRequired=true && !twoFactorVerified → redirect to /totp
  → assert pathname === "/totp"
  → assert searchParams.get("callbackUrl") === "/admin"
Outcome: proves 2FA gate fires; option (c) posture confirmed
Note: this is the same assertion as member-home.spec.ts test 6, now driven
  without a UI sign-in in the test body
```

**Flow E: role-boundary spec — admin can reach /admin (positive case)**

```
Entry: spec with test.use({ storageState: storageStatePath("admin") })
  → admin session has admin.dashboard in features, twoFactorRequired=false
  → page.goto("/admin")
  → proxy.ts: gate passes → /admin loads
  → assert pathname === "/admin"
Outcome: proves admin storageState is valid and feature-complete
```

**Missing flow — REST API mutation probes:** The npvitals "POST invalid body → 400 proves gate passed" pattern has no direct equivalent here. See Gap 4.

---

### Pass 3 — Permissions and Flags

No new `FEATURES` keys. No new feature flags. No schema changes. `playwright.config.ts`, `e2e/global-setup.ts`, and `e2e/role-boundaries.spec.ts` are pure test infrastructure — zero changes to any production code path.

Existing key audit:
- `admin.dashboard` gates `/admin/*` — already confirmed in proxy.ts. The role-boundaries spec reads this gate via proxy redirect behavior; it does not check the key directly.
- No new key is needed.

Confirmed: no permission catalog change, no flag table change.

---

### Pass 4 — Edge Cases the Request Didn't Address

**UI sign-in count — what is being eliminated:**
Across the 5 existing spec files there are 17 full UI sign-in calls today:
- `account-page.spec.ts`: 5 (one per test in the signed-in describe)
- `admin-login.spec.ts`: 3 (one per test)
- `forgot-password.spec.ts`: 0 (navigates to /signin but clicks away to /forgot-password; never completes a sign-in)
- `member-home.spec.ts`: 6 (tests 2–7; test 1 is unauthenticated)
- `timezone-safe-dates.spec.ts`: 3 (test 1 once; test 2 creates 2 browser contexts each signing in)

The 12 existing tests that sign in as admin are immediate candidates for storageState conversion. The member-home tests are already written with per-test inline sign-ins; they stay as-is (they prove the full flow end-to-end) while the new `role-boundaries.spec.ts` exercises gate logic via injected state only.

**Empty state (no `.auth/` dir, first run):** globalSetup creates the dir via `mkdir({ recursive: true })`. Handled gracefully.

**globalSetup failure leaves partial `.auth/` state:** If globalSetup completes admin and member but fails on mfa-admin, `e2e/.auth/admin.json` and `e2e/.auth/member.json` exist but `e2e/.auth/mfa-admin.json` does not. On the next run, globalSetup will call `isStorageStateFresh("admin")` → true (file exists and is fresh) → skip. Then attempt mfa-admin again. This is correct behavior — partial state is safe.

**2FA gate scope confirmation:** The member layout (`src/app/(member)/layout.tsx`) explicitly omits the 2FA gate (documented in code and CLAUDE.md). The mfa-admin storageState produces a session that passes the member layout auth gate (session exists) but hits the proxy's 2FA gate when navigating to `/admin`. This is intentional and confirmed from the routing feature's Phase 6.

---

### Pass 5 — Adversarial Pass

**A — Stale storageState after reseed: session survives password rotation.**
When `npm run db:seed` runs, it rotates the seeded users' passwords. This does NOT invalidate existing JWT session cookies. The starter's JWT callback (`src/auth.ts:192–202`) checks `dbUser.isActive` and `dbUser.twoFactorRequired`, not the password. The `AUTH_SECRET` is unchanged. Therefore a cached `e2e/.auth/admin.json` from before a reseed is still valid after the reseed — the proxy will accept it on the next request.

This is safe for the common case (same email, same role). The risk surfaces if a developer changes `SEED_ADMIN_EMAIL` to a new value: the old storageState carries a JWT for the old email, and the JWT callback will fail to find the user (or find a different user). The `session.user.email !== user.email` guard in signInAndSave does not fire on subsequent requests — it only fires when globalSetup creates the state. **Flag for tech-lead: document that developers must `rm -rf e2e/.auth/` after changing any `SEED_*_EMAIL` env var.** The 12h TTL helps on long CI runs but does not catch same-session-hour reseed with credential changes.

**B — Parallel workers sharing storageState files: safe.**
`storageState` files are written once (by globalSetup, before any spec) and read-only during spec execution. Multiple workers reading the same `.auth/admin.json` simultaneously have no race condition. Safe when `workers > 1`.

**C — 12h TTL on CI fresh runners: degrades gracefully.**
CI runners start with no `.auth/` directory. `isStorageStateFresh()` calls `stat()` → ENOENT → returns false → `signInAndSave()` runs. The 12h TTL check is a skip optimization; the absence of the file always triggers a fresh sign-in. No configuration needed. Safe.

**D — Rate limiter interference: three different emails, three different buckets.**
The in-memory rate limiter in `authorize()` is keyed by `ip:email`. globalSetup signs in as three different users (admin, member, mfa-admin) — three separate email buckets. No per-email conflict even if all three calls happen within seconds. However, if globalSetup is cancelled and retried within 1 minute for the same email (e.g., the mfa-admin call fails and is retried), the second attempt for that email from the same IP hits the bucket. Mitigation: `RATE_LIMIT_DISABLED=true` in `.env.local`. This is already documented in the routing work-log Phase 4 notes; the design doc for this feature must extend it to CI env secrets and mention globalSetup explicitly.

**E — Role-boundary "POST invalid body → mutate data if gate is broken": not applicable to server actions.**
The npvitals guarantee is: the POST body is invalid by construction so no data is written even if the gate accidentally passes. In the starter, admin mutations are server actions — they cannot be hit via `page.request.post()` to a static URL. The proxy is the only gate that can be probed via raw page navigation. Gate-broken mutations via the proxy are not possible (the proxy can only redirect or allow; mutations happen inside server actions that have their own internal permission checks). The risk class npvitals was guarding against does not exist in the starter's architecture. This finding frees the role-boundary spec from needing to construct invalid bodies.

**F — `callbackUrl` in the credentials POST body: low risk.**
The npvitals globalSetup sets `callbackUrl: \`${baseURL}/dashboard\``. For the starter this should be `callbackUrl: \`${baseURL}/home\``. NextAuth 5 validates the `callbackUrl` on the server side before redirecting. Since globalSetup doesn't follow the redirect (it confirms the session via `/api/auth/session`), the exact `callbackUrl` value doesn't affect correctness. It should still be set to `/home` for clarity and to avoid NextAuth rejecting an unexpected origin URL in strict mode.

**G — CSRF fetch fails silently: low risk but worth a guard.**
If page.goto("/signin") fails (dev server not running), the CSRF fetch will also fail. The `callbackRes.ok()` check catches the post-failure, but the CSRF fetch failure itself produces a confusing JSON parse error. Consider asserting `csrfRes.ok()` before destructuring `{ csrfToken }`, or wrapping in a try-catch with a "Is the dev server running on port 3000?" hint in the error message.

---

### Gaps the request didn't address

**Gap 1 — DB guard default posture: the developer's own dev DB is a Neon host (tech-lead decision required).**
The `.env.example` confirms `DATABASE_URL` points at `*.neon.tech`. Porting the huddleup guard as-is (block when neon.tech without `E2E_DATABASE_URL` or `E2E_ALLOW_SHARED_DB=true`) immediately breaks `npm run test:e2e` for all developers without one of those overrides. Three options:

- **(A) Warn always, never block:** guard is advisory only. No developer friction but no enforcement in CI. Weakest.
- **(B) Warn locally, block in CI:** when `CI` env var is not set, print a warning and proceed. When `CI=true` and DATABASE_URL is Neon without the override, throw and refuse. Developers keep their current flow with a visible warning; CI enforces isolation strictly. Recommended.
- **(C) Always block (huddleup posture):** maximum safety; all local runs immediately require `E2E_ALLOW_SHARED_DB=true` in `.env.local`. Hardest to adopt but clearest semantics.

Recommendation to tech-lead: option (B). The 20 currently passing tests run against the dev Neon DB and should not be broken on day 1. The fix-instructions error message must include all three escape hatches: `E2E_DATABASE_URL`, `E2E_ALLOW_SHARED_DB=true`, and a note that CI is required to use one of the two. Document the choice as a DECISION entry.

**Gap 2 — NextAuth 5 beta.31 credentials endpoint: `json: "true"` field and POST response format (tech-lead investigation required).**
The npvitals globalSetup sends `json: "true"` in the POST form data (`/api/auth/callback/credentials`). This is a NextAuth 4 convention that returns a JSON response instead of following the redirect. In NextAuth 5 beta.31, this behavior is not confirmed in the starter's codebase. The endpoint is registered via `export const { GET, POST } = handlers` from `src/app/api/auth/[...nextauth]/route.ts`.

Two risks:
1. If NextAuth 5 ignores `json: "true"` and responds with a redirect (3xx), `callbackRes.ok()` returns false and globalSetup throws a misleading error.
2. If NextAuth 5 expects a different form field or response parsing than NextAuth 4, the sign-in appears to succeed at the POST but the session is not issued.

The `GET /api/auth/session` check is the safety net — it confirms the session regardless of POST response format. But the globalSetup should be written to handle NextAuth 5's actual response (2xx JSON or 3xx redirect) rather than assuming NextAuth 4 behavior. **Tech-lead must confirm the POST response format and whether `json: "true"` is needed in NextAuth 5 beta.31, either by reading the Auth.js beta.31 source or by running a local probe against the dev server.** The probe must be documented in the design doc.

Also confirm: the starter's `authorize()` declares only `email` and `password` in the credentials schema. The globalSetup must NOT send `totpCode`. Sending undeclared fields is silently dropped by NextAuth, but including it creates misleading code.

**Gap 3 — Rate limiter: globalSetup must document `RATE_LIMIT_DISABLED=true`.**
The routing feature Phase 4 added `RATE_LIMIT_DISABLED=true` to `.env.local` and noted it prevents rate-limit accumulation during e2e runs. The globalSetup design doc and `.env.example` comment must be updated to explicitly state this is required for globalSetup sign-in calls (not just spec-body sign-ins). CI must set it in CI secrets. Without it, a globalSetup retry within the same minute for a given email would be rate-limited and fail with a non-obvious error.

**Gap 4 — Role-boundary "POST probe" pattern doesn't apply: design must define the proxy-only scope (tech-lead decision required).**
The npvitals role-boundary spec POSTs invalid bodies to REST endpoints: `400` proves the gate passed, `403` proves it blocked. The starter has no standalone REST API endpoints for admin mutations — they are all Next.js server actions called from React forms. `page.request.post()` to a server action URL does not work the same way.

The role-boundary spec for the starter must be scoped to **proxy-level gate enforcement** (page navigation → assert redirect). This covers: "member cannot reach /admin," "unauthenticated user cannot reach /home," "MFA-pending admin is redirected to /totp." What it does NOT cover: "server action rejects a mutation from an unauthorized caller" — that must remain in unit tests (api-developer's domain).

**The tech-lead must state this scope boundary explicitly in the design doc so future spec authors don't attempt to POST to server action URLs.** The role-boundary spec's guarantee ("a 403/redirect proves it was rejected; a 400 would prove the gate passed") translates to the starter as: "a redirect to /access-pending or /totp proves the proxy blocked; a 200 on the destination proves the proxy allowed."

**Gap 5 — `.auth/` directory must be gitignored.**
storageState files contain NextAuth session cookies. These must not be committed to git. The `.gitignore` at the repo root must include `e2e/.auth/`. Verify the `AUTH_DIR` path in globalSetup (npvitals uses `path.resolve(__dirname, "..", ".auth")` — relative to `e2e/support/`, so `e2e/.auth/`). The starter's globalSetup would live at `e2e/global-setup.ts` — `AUTH_DIR` should be `path.resolve(__dirname, ".auth")` → `e2e/.auth/`. **Add `e2e/.auth/` to `.gitignore`. This is a security requirement.**

**Gap 6 — MFA-admin storageState is intentionally incomplete: must be documented in fixtures.**
The cached mfa-admin session has `twoFactorRequired=true, twoFactorVerified=false`. A spec using `storageState: storageStatePath("mfa-admin")` and navigating to ANY `/admin/*` route will be redirected to `/totp`. This is correct for role-boundary tests but would confuse a spec author expecting normal admin access. The `storageStatePath` helper (or a co-located comment) must state: "This session is intentionally not TOTP-verified. Use it to assert the /totp redirect gate fires. Do not use it to test /admin content or any admin server action."

**Gap 7 — Credential-change reseed does not invalidate cached storageState.**
Changing `SEED_ADMIN_EMAIL` to a different value and re-seeding leaves `e2e/.auth/admin.json` pointing at a JWT for the old email. globalSetup's TTL check sees a fresh file and skips re-signing-in. The spec then uses stale cookies, and the JWT callback either rejects them (user not found) or accepts them for the wrong user. The design doc must document: **delete `e2e/.auth/` after changing any `SEED_*_EMAIL` env var.** A comment in globalSetup and a note in `.env.example` are sufficient; no code change is needed.

---

### TOTP Reconciliation

**Recommendation: keep option (c). Confirmed correct.**

The routing feature's option (c) decision is fully compatible with the globalSetup pattern. The mfa-admin globalSetup flow is:

1. POST email+password to `/api/auth/callback/credentials` (no TOTP code needed — the starter's `authorize()` does not check TOTP)
2. JWT is issued with `twoFactorRequired=true, twoFactorVerified=false` (set in `src/auth.ts:155`)
3. `GET /api/auth/session` confirms `session.user.email === mfaAdminEmail` → session valid
4. storageState saved with this intentionally-incomplete JWT state
5. Role-boundary spec uses this storageState to assert `/admin` → `/totp` redirect

This is exactly what the existing `member-home.spec.ts` test 6 already proves via a full UI sign-in. The globalSetup simply removes the UI sign-in from the assertion — the gate behavior and the fixture state are identical.

**Do NOT recommend seeding a TOTP secret.** The security rationale from the routing feature stands: a starter template with a predictable `SEED_TOTP_SECRET` would ship that secret into every fork's dev environment. Any developer who left the seed vars in production would have a known, exploitable TOTP secret. Option (c) provides the test coverage that matters (the gate fires) without that risk.

---

### Out of scope (confirm with user)

- Converting all 12 existing sign-in tests in `account-page.spec.ts`, `admin-login.spec.ts`, and `timezone-safe-dates.spec.ts` to use storageState. The globalSetup makes this possible, but migrating existing passing tests is a follow-on refactor. The new `role-boundaries.spec.ts` uses storageState from day 1. This scope question should be confirmed with the user — if they want the migration now, scope grows.
- Increasing `workers` beyond 1 in `playwright.config.ts`. storageState is compatible with parallel workers, but enabling parallelism changes test isolation assumptions and is a separate concern.
- Neon e2e branch creation as part of CI pipeline setup. The guard recommends `E2E_DATABASE_URL`; creating the Neon branch and wiring the CI secret is a deployment-engineer task outside this feature's scope.

### Open questions for the user

1. Do you want the existing 12 sign-in tests in `account-page`, `admin-login`, and `timezone-safe-dates` converted to use storageState in this same feature, or is that a follow-on refactor? The migration is straightforward (replace `signIn(page)` calls with `test.use({ storageState })`) but changes the character of those tests slightly (they no longer exercise the sign-in flow; they only exercise the page content).
2. DB guard posture preference: option (A) warn-always, (B) warn-local/block-CI (recommended), or (C) always-block? This affects how much immediate friction developers face on day 1.

---

### What I did

- Read `playwright.config.ts` — confirmed no `globalSetup`, no projects with storageState, `workers: 1`, `fullyParallel: false`, `baseURL` from env.
- Read all 5 spec files (`account-page.spec.ts`, `admin-login.spec.ts`, `forgot-password.spec.ts`, `member-home.spec.ts`, `timezone-safe-dates.spec.ts`) — counted 17 UI sign-in calls.
- Read `npvitals/e2e/support/global-setup.ts:1-112` — examined the full globalSetup pattern including `json: "true"` form field, CSRF acquisition, session verification, TTL logic, and the TOTP code generation (not needed for the starter).
- Read `npvitals/e2e/role-boundaries.spec.ts` — confirmed the REST POST probe pattern.
- Read `huddleup.health/web/e2e/global-setup.ts` — read the DB guard in full: E2E_DATABASE_URL → pass; neon.tech without E2E_ALLOW_SHARED_DB → throw; otherwise pass.
- Read `src/lib/auth/config.ts` (edge auth, providers: []) and `src/auth.ts` (full auth with Credentials provider, `authorize()` taking email+password only, no TOTP, JWT callback with DB hit on every request).
- Read `src/app/api/auth/[...nextauth]/route.ts` — confirmed `handlers` are exported as `GET, POST`.
- Read `.env.example` — confirmed `DATABASE_URL` is `*.neon.tech`; confirmed `RATE_LIMIT_DISABLED` is documented but without globalSetup mention.
- Read `docs/work-log/2026-07-01-post-login-routing-and-e2e.md` Phases 1–6 — confirmed option (c) rationale, confirmed three seed users exist, confirmed `safe-callback.ts` and `member-home.spec.ts` are shipped.
- Ran five-pass review. Confirmed no new FEATURES keys or flags needed.
- Confirmed TOTP reconciliation: option (c) is correct and the mfa-admin storageState state (`twoFactorVerified=false`) is the right fixture for the proxy redirect test.

### Outputs

- `docs/work-log/2026-07-01-e2e-auth-infra.md` — Phase 1 section written; Per-Phase Status updated to Complete / READY WITH NOTES / 2026-07-01.

### Open questions / handoff notes

For Phase 2 (architect):
- Is `e2e/global-setup.ts` the right placement, or does a `e2e/support/` subdirectory (mirroring npvitals) make more sense for starter conventions? The starter has no `e2e/support/` today. If `globalSetup` is a single file, top-level `e2e/global-setup.ts` is simpler. Phase 2 owns the directory decision.
- Is the `AUTH_DIR` path (`e2e/.auth/`) the right choice? Confirm it is gitignored at the project level.
- Are there any new npm dependencies (e.g., `otplib` for TOTP generation)? Answer: NO — the starter's globalSetup does NOT generate TOTP codes (option (c)). Confirm no new deps in Phase 2.

For Phase 3 (tech-lead):
- **Decision required (Gap 1):** DB guard default posture — option (A), (B), or (C). Recommendation is (B). Log as a DECISION entry.
- **Investigation required (Gap 2):** Confirm NextAuth 5 beta.31 behavior of POST `/api/auth/callback/credentials` — specifically whether `json: "true"` is needed, whether the endpoint returns JSON or a 3xx redirect on success, and whether `callbackRes.ok()` is a reliable success signal. Run a local probe against the dev server and document the finding in the design doc.
- **Scope definition required (Gap 4):** Define what "role-boundary probe" means in a server-action architecture. State explicitly that the spec covers proxy-level gate enforcement only, not server-action permission checks.
- **Rate limiter (Gap 3):** Update `.env.example` comment for `RATE_LIMIT_DISABLED=true` to mention globalSetup.
- **gitignore (Gap 5):** Add `e2e/.auth/` to `.gitignore` — security item.
- **MFA-admin fixture doc (Gap 6):** Document the intentionally-incomplete state in a comment.
- **Stale storageState (Gap 7):** Add `rm -rf e2e/.auth/` instruction to the design doc for credential-change reseed scenarios.
- **Spec migration scope (open question 1):** Decide whether to convert existing 12 sign-in tests now or defer.
- **Implementation order:** The globalSetup + DB guard + `.gitignore` entry must land before any spec that uses `test.use({ storageState })`. The `role-boundaries.spec.ts` is the only new spec; existing specs can coexist with the old inline sign-in pattern indefinitely.

For Phase 5 (qa):
- This feature touches `playwright.config.ts` and adds a `globalSetup` that calls `/api/auth/callback/credentials` — it is auth-touching per CLAUDE.md. PASS verdict requires an e2e run against a real dev server. The globalSetup itself must be observed to complete without error (storageState files created, no DB guard throw).
- If the existing 12 sign-in tests are migrated to storageState, QA must verify those tests still assert the same behavior (same navigation, same outcomes) after the migration.
- The `role-boundaries.spec.ts` tests must cover at minimum: member blocked from /admin, admin passes to /admin, mfa-admin redirected to /totp.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The feature's scope is structurally sound: no new npm dependencies, no schema changes, no changes to any production code path. All work lives in `e2e/` and `playwright.config.ts`. Seven rulings follow; the most consequential are the directory shape (use `e2e/support/`), the per-spec `test.use()` approach over per-role Playwright projects, and the DB guard posture (warn-locally / hard-block-in-CI, endorsing analyst option B). DECISION-019 logged.

### What I did

- Read all 5 existing spec files in `e2e/` and counted sign-in call distribution (17 total UI sign-ins across 5 files).
- Read `playwright.config.ts` — confirmed: single Chromium project, `workers: 1`, no `globalSetup`, no storageState.
- Read `scripts/seed.ts` MFA admin section — confirmed `twoFactorRequired=true`, no TOTP enrollment record created.
- Read `.env.example` — confirmed `DATABASE_URL` is `*.neon.tech`; confirmed `RATE_LIMIT_DISABLED` is documented without globalSetup mention; confirmed no `E2E_ALLOW_SHARED_DB` entry exists yet.
- Read `docs/TODO.md` — confirmed no TOTP enrolment e2e item in backlog; added one.
- Read `docs/decisions.md` — confirmed highest number was DECISION-018; logged DECISION-019.
- Issued seven architectural rulings (below).

### Rulings

**Ruling 1 — Directory shape: `e2e/support/` APPROVED**

`e2e/support/global-setup.ts` is the correct home for globalSetup and any future e2e infrastructure (fixtures, page objects, auth helpers). Spec files remain flat in `e2e/`. Teaching-artifact rationale: the `e2e/support/` separation is the pattern downstream forks copy. A flat structure that mixes spec and infrastructure files forces forks to invent the separation themselves. The current 5-file flat layout is spec-only and does not need to absorb infrastructure files. If the support module grows, `e2e/support/auth-helpers.ts` is the named extraction point.

**Ruling 2 — `playwright.config.ts` shape: per-spec `test.use()` APPROVED; per-role Playwright projects REJECTED**

`playwright.config.ts` gains exactly one change: `globalSetup: './e2e/support/global-setup.ts'`. The existing single Chromium project is not restructured into per-role projects. Per-role projects would require splitting every multi-role spec file (e.g., `member-home.spec.ts` which tests admin, member, and mfa-admin in a single file) and reworking all 20 existing tests. That churn is disproportionate to the benefit at this scale. Per-spec `test.use({ storageState: 'e2e/support/.auth/<role>.json' })` achieves the same caching with zero changes to existing tests and a clear incremental migration path. Existing tests continue to drive the sign-in UI; new specs and `role-boundaries.spec.ts` use storageState from day 1. The existing tests are not broken and need not be migrated in this feature.

**Ruling 3 — API sign-in approach: ENDORSED; stale-state posture is fail-loudly**

The API sign-in via `POST /api/auth/callback/credentials` + CSRF + `/api/auth/session` verification is the correct mechanism for globalSetup. The sign-in helper lives inside `e2e/support/global-setup.ts` (no separate helper file needed at this scale). Stale-state posture: when credentials env vars are set and the API sign-in produces a session mismatch or no session, `globalSetup` must throw — not print a warning and continue. In CI, a silently degraded storageState is worse than a hard build failure. When credentials vars are absent, per-spec `test.skip(!SEED_*)` guards continue unchanged. Note for tech-lead: the tech-lead must confirm NextAuth 5 beta.31's actual credentials POST response (whether `json: "true"` form field is needed; whether the endpoint returns a 2xx JSON body or a 3xx redirect on success). The Phase 1 analyst correctly flagged this as Gap 2 — the design doc must resolve it with a local probe before implementation starts.

**Ruling 4 — DB isolation guard posture: analyst option (B) ENDORSED with one adjustment**

The guard checks if `DATABASE_URL` matches `*.neon.tech`. Posture:
- No `CI` env var (local dev): print a prominent stderr warning and continue. The author's dev DB is a Neon host; a hard block would be the first thing removed by any developer.
- `CI=true` AND `*.neon.tech` AND neither `E2E_DATABASE_URL` nor `E2E_ALLOW_SHARED_DB=true` is set: throw with an actionable error message listing all three escape hatches.
- `E2E_ALLOW_SHARED_DB=true`: skip the guard in both local and CI. Teams that intentionally share a DB own the risk.

Adjustment to analyst's recommendation: the analyst said "something between warn and block." The ruling is precise: warn locally, hard-block in CI. "Between" is not a posture. This posture must not be softened in implementation — a guard that warns in CI is no guard at all.

**Ruling 5 — MFA-admin cached-state: CONFIRMED; option (c) stands**

The `globalSetup` signs in as `SEED_MFA_ADMIN_*` via the credentials API. The resulting storageState has `twoFactorRequired=true, twoFactorVerified=false`. This is not a defect — it is the correct fixture state for testing the `/totp` redirect gate. No TOTP secret is seeded. The security rationale from the routing feature (DECISION-013 work-log) stands: a starter shipping a predictable TOTP seed ships a backdoor into every fork. The `role-boundaries.spec.ts` proxy-gate assertion works correctly with this fixture because the proxy reads the JWT's `twoFactorVerified` claim, which is `false` in the cached state. Tech-lead must include a comment at the `storageStatePath("mfa-admin")` usage site: "session is intentionally not TOTP-verified — use only to assert /totp redirect; do not use to test admin page content."

**Ruling 6 — Dependencies and seed changes: NO NEW DEPS; NO SEED CHANGES**

Playwright is already present in `package.json`. The API sign-in uses `fetch` via `page.context().request` — Playwright's built-in HTTP client. No new npm packages. The seed script already creates the three role users with the correct attributes (`twoFactorRequired`, no TOTP enrollment record for mfa-admin, correct roles). No seed changes are needed for this feature. No schema changes.

**Ruling 7 — TOTP enrolment e2e: OUT OF SCOPE; TODO Backlog item added**

Full TOTP enrolment e2e (signing in as a fully-verified TOTP user and exercising post-2FA admin flows) is not in scope for this feature. Option (c) is confirmed: the `role-boundaries.spec.ts` exercises the gate redirect, not the gate completion. Added the following item to `docs/TODO.md` Backlog: "TOTP enrolment e2e — requires either a seeded deterministic TOTP secret (security risk — see routing feature option (c) rationale) or external authenticator integration; deferred until a safe pattern is designed."

### Outputs

- `docs/decisions.md` — DECISION-019 appended (new highest number).
- `docs/work-log/2026-07-01-e2e-auth-infra.md` — Phase 2 section added; status row updated to Complete / Approved with suggestions / 2026-07-01.
- `docs/TODO.md` — TOTP enrolment e2e Backlog item added.

### Open questions / handoff notes

For Phase 3 (tech-lead):

- **Investigate (Gap 2):** Run a local probe against the dev server to confirm NextAuth 5 beta.31's credentials endpoint response. Does it return 2xx JSON, 3xx redirect, or something else when `json: "true"` is or is not included? Document the confirmed behavior in the design doc. This is a prerequisite before writing `global-setup.ts`.
- **Define proxy-gate scope (Gap 4):** The role-boundary spec covers proxy-level navigation gates only. State explicitly in the design doc that server-action permission checks are NOT tested via page navigation and remain in unit tests. Future spec authors must not attempt to POST to server action URLs to probe authorization.
- **DB guard error message:** The throw in CI mode must name all three escape hatches: `E2E_DATABASE_URL`, `E2E_ALLOW_SHARED_DB=true`, and an instruction to set either in CI secrets. The message must also name which guard condition fired.
- **Rate limiter (Gap 3):** Update the `.env.example` `RATE_LIMIT_DISABLED` comment to explicitly mention globalSetup sign-in calls in addition to spec-body sign-ins.
- **gitignore (Gap 5 — security item):** `e2e/support/.auth/` must be added to `.gitignore` before any `global-setup.ts` is committed. storageState files contain session cookies.
- **Stale storageState (Gap 7):** The design doc must document: delete `e2e/support/.auth/` after changing any `SEED_*_EMAIL` env var. Include as a comment in `global-setup.ts` and a note in `.env.example`.
- **Spec migration scope (open question 1 from Phase 1):** Confirm with user whether the existing 12 sign-in tests in `account-page.spec.ts`, `admin-login.spec.ts`, and `timezone-safe-dates.spec.ts` should be converted to `storageState` in this feature or deferred. Architect ruling: defer — converting existing passing tests adds churn with no new coverage. The new `role-boundaries.spec.ts` uses storageState from day 1; that is sufficient to teach the pattern.
- **Implementer:** `full-stack-developer` (all work is in `e2e/` and `playwright.config.ts` — no production src/ changes; no server/client split needed; the feature is small and self-contained).

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

Mandatory probe against the live NextAuth 5 beta.31 credentials endpoint was conducted first (port 3100, SEED_ADMIN credentials). Key finding: the credentials POST **always returns HTTP 302**, not 2xx — `json=true` makes no difference and `callbackRes.ok()` must NOT be used as the success check. The session cookie is issued on the 302 response; the session is verified separately via `/api/auth/session`. All seven Phase 1 gaps and all Phase 2 handoff items are resolved below. Implementer: `full-stack-developer`.

---

### Live Probe Results (Gap 2 — mandatory prerequisite)

**Dev server:** `npm run dev -- -p 3100`. Server ready in <30s. `RATE_LIMIT_DISABLED=true` confirmed set in `.env.local` — no rate-limit interference.

**Step 1 — GET /api/auth/csrf**
- Status: `200 OK`
- Response body: `{"csrfToken":"<hex>"}`
- Set-Cookie: `authjs.csrf-token=...; authjs.callback-url=...`
- CSRF token successfully extracted.

**Step 2a — POST /api/auth/callback/credentials (without `json=true`)**
- Status: `302 Found`
- Body: empty
- `location: http://localhost:3000` (AUTH_URL from `.env.local`, NOT the probe port 3100 — this is expected; NextAuth derives the redirect location from `AUTH_URL`, not the request host)
- `set-cookie: authjs.session-token=<JWE>; Path=/; Expires=...; HttpOnly; SameSite=Lax`
- Session cookie IS issued on the 302 response.

**Step 2b — POST /api/auth/callback/credentials (with `json=true`)**
- Status: `302 Found` (identical to without `json=true`)
- `json=true` has **no effect** in NextAuth 5 beta.31. The endpoint is not a JSON-returning API in this version; it always redirects.
- Session cookie IS issued identically.

**Confirmed findings for implementation:**
1. `callbackRes.ok()` returns `false` for a 302 — **do not use it**. The success check is `callbackRes.status() < 400`.
2. Do NOT include `json=true` in the form data — it does nothing and adds misleading code.
3. Do NOT include `totpCode` — the starter's `authorize()` accepts only `email` and `password`.
4. `callbackUrl` in the POST form: set to `${baseURL}/home` (starter's post-login landing).
5. The Location header in the 302 points at AUTH_URL (port 3000), not the probe server (port 3100). globalSetup must NOT follow the redirect — use `failOnStatusCode: false` in Playwright.

**Step 3 — GET /api/auth/session (with session cookie from Step 2a)**
- Status: `200 OK`
- Response body (full, confirmed):
  ```json
  {
    "user": {
      "name": "Local Admin",
      "email": "admin@claudecode.info",
      "image": null,
      "id": "<uuid>",
      "roles": ["admin"],
      "features": ["admin.dashboard","admin.users","admin.flags","admin.release_notes"],
      "isActive": true,
      "twoFactorRequired": false,
      "twoFactorVerified": false
    },
    "expires": "2026-08-01T00:01:28.696Z"
  }
  ```
- Session fields available: `user.email`, `user.roles`, `user.features`, `user.twoFactorRequired`, `user.twoFactorVerified`.
- The `twoFactorVerified` field is `false` for the admin user (not enrolled). For the mfa-admin, globalSetup will call the same endpoint and get `twoFactorRequired: true, twoFactorVerified: false` — this is the correct fixture state for the proxy-gate test.

**Rate limiter:** `RATE_LIMIT_DISABLED=true` must be set in `.env.local` and in CI secrets. Without it, a globalSetup retry within the same in-memory window for the same email would be blocked. The `.env.example` comment for `RATE_LIMIT_DISABLED` must mention globalSetup sign-in calls explicitly.

---

## Technical Design: E2E Auth Infrastructure (globalSetup + Role Boundaries + DB Guard)

### Summary

Pure test-infrastructure change. No production `src/` files touched. Adds:
- `e2e/support/global-setup.ts` — API-based sign-in, 12h TTL cache, DB isolation guard
- `e2e/role-boundaries.spec.ts` — proxy-gate navigation assertions using injected storageState
- `playwright.config.ts` — one-line `globalSetup` registration
- `.gitignore` — `e2e/support/.auth/` (security item, step 1)
- `.env.example` — E2E isolation vars + stale-state note + `RATE_LIMIT_DISABLED` globalSetup mention

### Permissions & Flags

None. No `FEATURES` key, no feature flag.

### Data Model

No schema changes.

### 1 — `e2e/support/global-setup.ts` — full specification

**Location:** `e2e/support/global-setup.ts`

**File header comment (required):**
```
/**
 * global-setup.ts — Playwright globalSetup for cached per-role storageState.
 *
 * Acquires sessions for admin, member, and mfa-admin via the NextAuth
 * credentials API (GET /api/auth/csrf → POST /api/auth/callback/credentials
 * → GET /api/auth/session), then writes storageState to e2e/support/.auth/.
 *
 * IMPORTANT: Delete e2e/support/.auth/ after changing any SEED_*_EMAIL env
 * var. The 12h TTL check skips re-acquisition for fresh files, so a stale
 * storageState carrying the old email's JWT will be reused silently. Just
 * `rm -rf e2e/support/.auth/` and re-run.
 *
 * RATE_LIMIT_DISABLED=true must be set in .env.local and in CI secrets.
 * Without it, a globalSetup retry for the same email within the in-memory
 * rate-limit window will be blocked and globalSetup will throw a misleading
 * credentials error.
 */
```

**Imports:** `chromium` and `FullConfig` from `@playwright/test`; `fs`, `path` from `node:`.

**AUTH_DIR constant:** `path.resolve(__dirname, '.auth')` → resolves to `e2e/support/.auth/`.

**TTL constant:** `const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;`

**`isStorageStateFresh(filePath: string): boolean`**
```
try { return Date.now() - fs.statSync(filePath).mtimeMs < TWELVE_HOURS_MS; }
catch { return false; }
```

**DB isolation guard (runs FIRST in `globalSetup`, before any sign-in):**

```
Priority order:
1. If E2E_DATABASE_URL is set → guard passes (user has dedicated e2e DB).
2. Parse DATABASE_URL hostname. If parsing fails → skip guard (not a URL we understand).
3. If hostname ends with '.neon.tech':
   a. If E2E_ALLOW_SHARED_DB === 'true' → guard passes (user explicitly accepted risk).
   b. If process.env.CI is truthy → throw with actionable error message.
   c. Else → console.warn to stderr and continue.
4. Otherwise → guard passes (non-Neon host, no shared-DB concern).
```

**Actionable error message text (for CI throw):**
```
[globalSetup] DATABASE_URL points at a Neon shared database (*.neon.tech).
Running e2e tests against a shared database may pollute production or staging data.
To fix, choose one option:
  A) Set E2E_DATABASE_URL to a dedicated Neon branch connection string (recommended for CI).
     Create a branch at console.neon.tech, copy its connection string, and add it to CI secrets.
  B) Set E2E_ALLOW_SHARED_DB=true to acknowledge the risk and continue.
     This is only appropriate if the database is disposable or isolated by other means.
See docs/work-log/2026-07-01-e2e-auth-infra.md for rationale (DECISION-019).
```

**Local warning text:** Same text prefixed with a severity marker, e.g. `console.warn('\n[globalSetup] WARNING: ' + message + '\n')`.

**Per-role acquisition loop (runs after DB guard):**

```
fs.mkdirSync(AUTH_DIR, { recursive: true });

const roles = [
  { role: 'admin',     email: process.env.SEED_ADMIN_EMAIL,     password: process.env.SEED_ADMIN_PASSWORD },
  { role: 'member',    email: process.env.SEED_MEMBER_EMAIL,    password: process.env.SEED_MEMBER_PASSWORD },
  { role: 'mfa-admin', email: process.env.SEED_MFA_ADMIN_EMAIL, password: process.env.SEED_MFA_ADMIN_PASSWORD },
];

for (const { role, email, password } of roles) {
  if (!email || !password) {
    console.warn(`[globalSetup] Skipping "${role}": env vars not set.`);
    continue;
  }
  const filePath = path.join(AUTH_DIR, `${role}.json`);
  if (isStorageStateFresh(filePath)) {
    console.log(`[globalSetup] "${role}": storageState is fresh (<12h), skipping sign-in.`);
    continue;
  }
  console.log(`[globalSetup] "${role}": acquiring storageState for ${email}...`);
  await signInAndSave(config, email, password, filePath);
  console.log(`[globalSetup] "${role}": saved to ${filePath}`);
}
```

**`signInAndSave(config, email, password, filePath)` — exact request sequence:**

```typescript
const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3000';
const browser = await chromium.launch();
try {
  const context = await browser.newContext();

  // Step 1: CSRF token
  const csrfRes = await context.request.get(`${baseURL}/api/auth/csrf`);
  if (!csrfRes.ok()) {
    throw new Error(
      `[globalSetup] CSRF fetch failed (HTTP ${csrfRes.status()}) for ${email}. ` +
      `Is the dev server running on ${baseURL}? ` +
      `(Tip: run \`npm run dev\` first, then \`npm run test:e2e\`)`
    );
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // Step 2: Credentials POST
  // NextAuth 5 beta.31 ALWAYS returns HTTP 302, not 2xx.
  // Do NOT use callbackRes.ok() — it returns false on 302.
  // Do NOT include json=true — it has no effect in beta.31.
  // The session cookie is issued in the Set-Cookie of the 302 response.
  const callbackRes = await context.request.post(
    `${baseURL}/api/auth/callback/credentials`,
    {
      form: {
        csrfToken,
        email,
        password,
        callbackUrl: `${baseURL}/home`,
      },
      // Playwright follows redirects by default; the 302 Location points at
      // AUTH_URL which may be a different host/port. Stop at the first response.
      maxRedirects: 0,
    }
  );
  if (callbackRes.status() >= 400) {
    const body = await callbackRes.text().catch(() => '(unreadable)');
    throw new Error(
      `[globalSetup] Credentials POST returned HTTP ${callbackRes.status()} for ${email}. Body: ${body}`
    );
  }

  // Step 3: Session verification
  const sessionRes = await context.request.get(`${baseURL}/api/auth/session`);
  const session = (await sessionRes.json()) as {
    user?: { email: string; twoFactorRequired: boolean; twoFactorVerified: boolean };
  };
  if (!session?.user?.email) {
    throw new Error(
      `[globalSetup] /api/auth/session returned no user after sign-in for ${email}. ` +
      `Session payload: ${JSON.stringify(session)}`
    );
  }
  if (session.user.email !== email) {
    throw new Error(
      `[globalSetup] Session email mismatch: expected "${email}", got "${session.user.email}". ` +
      `Session payload: ${JSON.stringify(session)}`
    );
  }

  // Save storageState (cookies + localStorage)
  await context.storageState({ path: filePath });
} finally {
  await browser.close();
}
```

**Note on `maxRedirects: 0`:** Playwright's `request.post` follows redirects by default. The 302 Location points at `AUTH_URL` (e.g. `http://localhost:3000`) which may differ from the probe server. Setting `maxRedirects: 0` stops at the first 302, capturing the session cookie before any redirect. The `/api/auth/session` call in Step 3 confirms session validity independently.

### 2 — .gitignore addition

Add `e2e/support/.auth/` to `.gitignore`. This is implementation **step 1** — it must land in the same commit as `global-setup.ts`. storageState files contain live NextAuth session cookies and must never be committed.

### 3 — playwright.config.ts change

Add exactly one line inside `defineConfig({})`:

```typescript
globalSetup: './e2e/support/global-setup.ts',
```

No other changes to `playwright.config.ts`.

### 4 — `e2e/role-boundaries.spec.ts` — full test enumeration

**File header comment (required):**
```
/**
 * role-boundaries.spec.ts — Proxy-gate enforcement using injected storageState.
 *
 * Scope: navigation-and-redirect assertions only. These tests probe proxy.ts
 * gate behavior (redirect on access denial). They do NOT probe server-action
 * permission checks — server actions are not accessible via page.request.post()
 * to a static URL in the starter's architecture, and their authorization is
 * covered by unit tests (api-developer domain). Future spec authors must not
 * attempt to POST to server action URLs here.
 *
 * storageState for each role is produced by e2e/support/global-setup.ts.
 * The mfa-admin storageState is intentionally NOT TOTP-verified
 * (twoFactorRequired=true, twoFactorVerified=false). Use it ONLY to assert
 * the /totp redirect fires. Do not use it to test /admin page content.
 *
 * Delete e2e/support/.auth/ after changing any SEED_*_EMAIL env var.
 */
```

**Imports:** `test`, `expect` from `@playwright/test`; `path` from `node:path`.

**`storageStatePath` helper:**
```typescript
function storageStatePath(role: 'admin' | 'member' | 'mfa-admin'): string {
  return path.resolve(__dirname, 'support', '.auth', `${role}.json`);
}
```

**Skip guards (module-level constants):**
```typescript
const HAVE_ADMIN     = !!(process.env.SEED_ADMIN_EMAIL     && process.env.SEED_ADMIN_PASSWORD);
const HAVE_MEMBER    = !!(process.env.SEED_MEMBER_EMAIL    && process.env.SEED_MEMBER_PASSWORD);
const HAVE_MFA_ADMIN = !!(process.env.SEED_MFA_ADMIN_EMAIL && process.env.SEED_MFA_ADMIN_PASSWORD);
```

**Test cases:**

| # | describe block | storageState | test description | assertion |
|---|---|---|---|---|
| 1 | Unauthenticated | none | unauthenticated visit to /home redirects to /signin | `page.goto('/home')` → pathname `/signin`, `searchParams.callbackUrl === '/home'` |
| 2 | Member — /admin blocked | `storageStatePath('member')` | member navigating to /admin is redirected to /access-pending | `page.goto('/admin')` → pathname `/access-pending`; skip if `!HAVE_MEMBER` |
| 3 | MFA-admin — /totp gate | `storageStatePath('mfa-admin')` | mfa-admin navigating to /admin is redirected to /totp with callbackUrl | `page.goto('/admin')` → pathname `/totp`, `searchParams.callbackUrl === '/admin'`; skip if `!HAVE_MFA_ADMIN` |
| 4 | Admin — positive gate | `storageStatePath('admin')` | admin navigating to /admin reaches the admin dashboard | `page.goto('/admin')` → pathname starts with `/admin`; skip if `!HAVE_ADMIN` |

Each describe block declares `test.use({ storageState })` at the block level. Skip guards use `test.skip(!HAVE_ROLE, 'SEED_*_EMAIL/PASSWORD not set')` inside a `beforeEach` or via `test.skip` at the describe level.

### 5 — DB isolation guard: exact logic

```
Function: runDbIsolationGuard()

Step A: if (process.env.E2E_DATABASE_URL) → return (dedicated E2E database, guard passes)
Step B: parse DATABASE_URL; if URL parse throws → return (cannot determine host, skip guard)
Step C: if (hostname does NOT end with '.neon.tech') → return (not Neon, guard passes)
Step D: if (process.env.E2E_ALLOW_SHARED_DB === 'true') → return (user accepted risk, guard passes)
Step E: if (process.env.CI) → throw new Error(ACTIONABLE_MESSAGE)
Step F: console.warn('\n' + ACTIONABLE_MESSAGE + '\n') → return (local dev: warn and continue)
```

Escape hatches listed in the error message:
- `E2E_DATABASE_URL` — set to an isolated Neon branch connection string
- `E2E_ALLOW_SHARED_DB=true` — explicit risk acceptance
- Implicit: `CI` env var not set → guard only warns, never blocks (local dev path)

### 6 — .env.example additions and stale-state note

**Add after the existing `SEED_MFA_ADMIN_*` block:**
```
# --- E2E database isolation -------------------------------------------------
# By default, globalSetup warns locally and hard-blocks in CI if DATABASE_URL
# points at a Neon shared database (*.neon.tech). Set one of these to satisfy
# the isolation guard.
#
# Option A (recommended for CI): point at a dedicated Neon branch.
# Create a branch at console.neon.tech, copy its connection string here.
# E2E_DATABASE_URL=
#
# Option B: explicitly accept the shared-database risk.
# E2E_ALLOW_SHARED_DB=true
```

**Update the existing `RATE_LIMIT_DISABLED` comment** to mention globalSetup:
```
# Escape hatch — short-circuits every checkRateLimit() to "allowed". Set this
# in local .env.local and in CI secrets when running e2e tests: both the
# globalSetup sign-in calls and any spec-body sign-ins accumulate rate-limit
# state against the in-memory limiter. A globalSetup retry for the same email
# within the rate-limit window will fail with a credentials error without this.
# NEVER set in production — defeats the whole point.
# RATE_LIMIT_DISABLED=true
```

**Stale storageState note** — add near the SEED_* vars block:
```
# IMPORTANT: Delete e2e/support/.auth/ after changing any SEED_*_EMAIL value.
# The 12h TTL cache in globalSetup skips re-acquisition for fresh files; a
# stale storageState carrying the old email's JWT will be reused silently.
# Fix: rm -rf e2e/support/.auth/
```

The same instruction lives in the `global-setup.ts` file header comment (see above).

### 7 — Phase 5 test plan

This feature touches no `src/` files — no auth routes, no `src/auth.ts`, no `src/lib/auth/`, no `src/app/(auth)/`, no `src/app/api/auth/`. It is NOT auth-touching per CLAUDE.md's gate list.

The full e2e suite run IS the verification mechanism — it exercises the globalSetup itself (storageState acquisition, DB guard, session verification) and the new role-boundary tests.

**Phase 5 PASS requires:**

1. `npm run dev` running on port 3000 with all three seed users provisioned (`npm run db:seed` after `SEED_MEMBER_EMAIL`, `SEED_MEMBER_PASSWORD`, `SEED_MFA_ADMIN_EMAIL`, `SEED_MFA_ADMIN_PASSWORD` are set in `.env.local`).
2. `npm run test:e2e` completes with all tests passing:
   - Existing 20 tests (5 spec files) — must continue to pass without storageState
   - New 4 role-boundary tests in `e2e/role-boundaries.spec.ts`
3. Console output from `globalSetup` must show storageState files created for all three roles (no DB guard throw, no credentials error).
4. `e2e/support/.auth/admin.json`, `e2e/support/.auth/member.json`, `e2e/support/.auth/mfa-admin.json` must exist after the run (confirming storageState was written).
5. `npm run typecheck` passes.
6. `npm run build` passes.

No e2e prerequisite under the CLAUDE.md auth-touching gate — but the run itself is required to verify the feature works.

### 8 — Implementer and sequencing

**Implementer:** `full-stack-developer` (Phase 2 ruling 2 and handoff notes confirmed; all work is in `e2e/`, `playwright.config.ts`, `.gitignore`, `.env.example` — no production `src/` changes, no server/client split).

**Implementation order:**
1. `.gitignore` — add `e2e/support/.auth/` (security item; lands before any other file)
2. `e2e/support/` directory — create (currently does not exist)
3. `e2e/support/global-setup.ts` — write the full implementation per section 1 above
4. `playwright.config.ts` — add `globalSetup: './e2e/support/global-setup.ts'`
5. `e2e/role-boundaries.spec.ts` — write per section 4 above
6. `.env.example` — add E2E isolation vars + update `RATE_LIMIT_DISABLED` comment + stale-state note

**Sequencing notes:**
- This feature touches only `e2e/`, `playwright.config.ts`, `.gitignore`, `.env.example`. No `src/` changes.
- `.env.example` is also touched by the email-queue pipeline (Phase 3 next for that pipeline). When both features are being committed, compose the `.env.example` changes carefully to avoid merge conflicts. The email-queue additions belong in the Email section; the e2e additions belong in a new E2E section near the bottom.
- Phase 4 can begin immediately — no dependency on `recordAudit` Phase 4 (which touches `src/` only). Port 3000 is needed for `npm run test:e2e` in Phase 5, not during implementation. Check that no other running dev server is occupying port 3000 at Phase 5 time.
- Existing spec migration (existing 12 UI sign-in tests) is deferred per Phase 2 Ruling 2. Phase 4 does not touch existing spec files except to add `role-boundaries.spec.ts`.

**DECISION-020** (logged in `docs/decisions.md`): NextAuth 5 beta.31 credentials endpoint always returns HTTP 302; `json=true` has no effect; success check is `status < 400`, not `ok()`.

### Edge Cases & Risks

1. **`maxRedirects: 0` on Playwright request:** Playwright's `APIRequestContext.post()` follows redirects by default. Without `maxRedirects: 0`, Playwright follows the 302 to `AUTH_URL` (port 3000) and loses the session cookie from the original response. The `maxRedirects: 0` option prevents this.
2. **AUTH_URL mismatch:** The 302 Location is derived from `AUTH_URL` in `.env.local` (currently `http://localhost:3000`). If `AUTH_URL` differs from `baseURL` used by Playwright, the redirect location will differ. `maxRedirects: 0` makes this a non-issue.
3. **Parallel workers reading the same `.auth/*.json`:** Safe. storageState files are read-only during spec execution. Workers ≥ 1 do not race on reads.
4. **globalSetup partial failure:** If globalSetup writes `admin.json` and `member.json` but throws on `mfa-admin.json`, the next run re-checks freshness for all three. Fresh files for admin and member are skipped; mfa-admin is retried. Safe behavior.
5. **CSRF token expiry:** Each `signInAndSave` call fetches a fresh CSRF token immediately before use. No sharing of CSRF tokens between roles. Safe.

### Out of Scope

- Converting existing 12 UI sign-in tests to storageState (deferred per Phase 2 Ruling 2).
- Increasing `workers` beyond 1 (separate concern).
- Neon e2e branch creation in CI pipeline (deployment-engineer task outside this feature's scope).

---

## Phase 4 — Implementation (full-stack) — 2026-07-01

**Owner:** full-stack-developer
**Status:** complete

### Summary

All five implementation items landed in order. TypeScript typecheck and ESLint pass clean. Full e2e suite (24 tests: 20 existing + 4 new) passed on port 3000 in 25.8 s. globalSetup ran successfully: DB guard issued the expected local warning (shared Neon DB), then acquired all three storageState files. `e2e/support/.auth/` does not appear in `git status` — gitignore confirmed working.

### What I did

- Added `e2e/support/.auth/` to `.gitignore` (security item; landed first).
- Created `e2e/support/` directory.
- Created `e2e/support/global-setup.ts`: DB isolation guard (warn-locally / hard-block-in-CI per DECISION-019), per-role acquisition loop (admin, member, mfa-admin), 12h TTL skip logic, `signInAndSave()` with CSRF → credentials POST (`maxRedirects: 0`, `status < 400` per DECISION-020) → session verification → storageState write.
- Added `globalSetup: './e2e/support/global-setup.ts'` to `playwright.config.ts` (one-line change).
- Created `e2e/role-boundaries.spec.ts`: 4 tests (unauthenticated/member/mfa-admin/admin) with proxy-gate-only scope comment, `storageStatePath()` helper, skip guards matching env-var conventions.
- Updated `.env.example`: expanded `RATE_LIMIT_DISABLED` comment to mention globalSetup; added E2E isolation section (E2E_DATABASE_URL, E2E_ALLOW_SHARED_DB, stale-state note) at end of file.

### Outputs

- `.gitignore` — added `e2e/support/.auth/`
- `e2e/support/global-setup.ts` — new file; implements globalSetup with DB guard + per-role API sign-in + 12h TTL cache
- `playwright.config.ts` — added `globalSetup` line
- `e2e/role-boundaries.spec.ts` — new file; 4 proxy-gate tests
- `.env.example` — updated `RATE_LIMIT_DISABLED` comment; added E2E section at end

### E2E verification

- Port: 3000 (record-audit Phase 4 was complete)
- Command: `npx playwright test`
- Results: **24 passed (25.8s)** — 20 existing + 4 new role-boundary tests
- globalSetup output observed:
  - DB guard: printed local warning (Neon shared DB, CI not set → warn and continue)
  - `"admin"`: acquired storageState for admin@claudecode.info → saved to `.auth/admin.json`
  - `"member"`: acquired storageState for member@claudecode.info → saved to `.auth/member.json`
  - `"mfa-admin"`: acquired storageState for mfaadmin@claudecode.info → saved to `.auth/mfa-admin.json`
- `.auth/` files: all three present with mtime 2026-07-01 ~20:10:16-18 (within seconds of each other)
- TTL check: not run on first pass (files were absent); a second run would skip all three (`isStorageStateFresh` returns true for fresh files)
- Gitignore: `e2e/support/.auth/` does NOT appear in `git status` — confirmed

### Open questions / handoff notes

For Phase 5 (qa):

- This feature does NOT touch any `src/` files — it is not auth-touching per CLAUDE.md's gate list (no `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/` changes). PASS verdict does not require a separate e2e gate beyond the run already performed in Phase 4.
- The Phase 4 e2e run itself serves as the primary verification: globalSetup was observed to complete without error, all three `.auth/*.json` files were created, and all 24 tests passed.
- QA should confirm: `npm run typecheck` and `npm run build` pass (typecheck already confirmed clean in Phase 4; build should be verified separately).
- The existing 12 UI sign-in tests (in `account-page.spec.ts`, `admin-login.spec.ts`, `timezone-safe-dates.spec.ts`) still drive the sign-in UI directly — no change to them. Migration to storageState is deferred per Phase 2 Ruling 2.
- No new env vars to document beyond what is in `.env.example` (E2E_DATABASE_URL, E2E_ALLOW_SHARED_DB).

---

### What I Did

- Read Phase 1 (complete / READY WITH NOTES) and Phase 2 (complete / Approved with suggestions / DECISION-019) of this work-log.
- Read `playwright.config.ts` — confirmed no `globalSetup`, `baseURL` from `E2E_BASE_URL ?? "http://localhost:3000"`.
- Read `.env.local` — confirmed `SEED_ADMIN_EMAIL=admin@claudecode.info`, `SEED_ADMIN_PASSWORD=<redacted>`, `RATE_LIMIT_DISABLED=true`.
- Read `docs/decisions.md` — confirmed DECISION-019 is the highest number.
- Read `docs/TODO.md` — confirmed In Flight entry for this feature.
- **Ran mandatory live probe** on port 3100 (separate from any active port 3000 pipeline):
  - GET `/api/auth/csrf` → 200 OK, JSON `{csrfToken}`, sets `authjs.csrf-token` + `authjs.callback-url` cookies.
  - POST `/api/auth/callback/credentials` (without `json=true`) → **302 Found**, session cookie set, Location: `http://localhost:3000`.
  - POST `/api/auth/callback/credentials` (with `json=true`) → identical 302, same session cookie. `json=true` has **no effect** in NextAuth 5 beta.31.
  - GET `/api/auth/session` → 200 OK, confirmed session shape with `user.email`, `user.roles`, `user.features`, `user.twoFactorRequired`, `user.twoFactorVerified`.
- Killed dev server on port 3100.
- Authored complete design for all 8 Phase 3 required items.
- Logged DECISION-020 in `docs/decisions.md`.
- Updated Per-Phase Status (Phase 3 Complete, Phase 4 owner: full-stack-developer).
- Updated `docs/TODO.md` In Flight entry.

### Outputs

- `docs/work-log/2026-07-01-e2e-auth-infra.md` — Phase 3 section written; Per-Phase Status updated.
- `docs/decisions.md` — DECISION-020 logged.
- `docs/TODO.md` — In Flight entry updated.

### Open Questions / Handoff Notes

For Phase 4 (`full-stack-developer`):

- **Step 1 is `.gitignore`** — add `e2e/support/.auth/` before creating the directory or any `.json` file.
- **`maxRedirects: 0`** — required on the credentials POST. Without it, Playwright follows the 302 to `AUTH_URL` and loses the session cookie.
- **Session check**: `session.user.email !== email` is the fail-loudly guard. Also check `!session?.user?.email` for the unauthenticated-session case (returns `{}` or `{expires: "..."}`).
- **DB guard** runs first, before any `chromium.launch()`. Keep that order.
- **Spec file header comment** must state the proxy-gate-only scope. Do not omit it — it prevents future spec authors from attempting server-action POST probes.
- **mfa-admin fixture comment** must appear in the spec's `describe` block for that role. See section 4 above.
- **`.env.example` compose-carefully note:** the email-queue pipeline will also touch `.env.example`. Put the E2E isolation block at the very end of the file (after Rate limiting section) to minimize merge conflicts.
- No `src/` files are touched. `npm run check:audit` is not relevant to this feature.
- After implementation: `npm run typecheck`, `npm run build`, `npm run test:e2e` (dev server must be running). Phase 5 requires observing the globalSetup console output and confirming all three `.auth/*.json` files were created.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. This feature is NOT auth-touching per CLAUDE.md (no `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/` changes). The full e2e suite run is the primary verification. 24/24 Playwright tests passed in 22.3 seconds, including all 4 new role-boundary tests. globalSetup produced the expected DB guard warning (shared Neon DB, CI not set → warn), confirmed all three storageState files were fresh (TTL cache hit — files written during Phase 4). `e2e/support/.auth/` is gitignored and absent from `git status`.

### What I did

- Ran `npm run typecheck` — clean (0 errors).
- Ran `npm run lint` — clean (0 warnings).
- Ran `npm run test` — 259 passed (23 test files; no test files added by this pipeline).
- Ran `npm run build` — clean (20 routes).
- Ran `npx playwright test` on port 3000 — **24/24 passed (22.3s)**. globalSetup output confirmed:
  - DB guard issued local warning (`.neon.tech` detected, `CI` not set → warn and continue).
  - `"admin"`: storageState is fresh (<12h), skipping sign-in.
  - `"member"`: storageState is fresh (<12h), skipping sign-in.
  - `"mfa-admin"`: storageState is fresh (<12h), skipping sign-in.
- Confirmed `e2e/support/.auth/admin.json`, `member.json`, `mfa-admin.json` exist (present from Phase 4 acquisition).
- Confirmed `e2e/support/.auth/` does NOT appear in `git status` — gitignore entry at line 34 of `.gitignore` is effective.
- Confirmed `global-setup.ts` header comment includes the stale-state and rate-limit notes per spec.
- Confirmed mfa-admin comment is present in the roles array (line 167: "session is intentionally NOT TOTP-verified").
- Confirmed `role-boundaries.spec.ts` header comment states the proxy-gate-only scope and the `storageStatePath()` helper returns `path.resolve(__dirname, 'support', '.auth', '<role>.json')`.
- Confirmed DECISION-020 comment is at the credentials POST call: `status < 400` guard instead of `ok()`, `maxRedirects: 0`.
- Confirmed 4 role-boundary tests: unauthenticated → /signin, member → /access-pending, mfa-admin → /totp (with callbackUrl), admin → /admin (positive gate).

### Feature-Gate Audit

No production `src/` files were touched. No protected routes or server actions added. Feature-gate audit: not applicable.

### Outputs

- `docs/work-log/2026-07-01-e2e-auth-infra.md` — Phase 5 section added; Per-Phase Status row updated.
- `docs/TODO.md` — In Flight entry updated to Phase 6 next.

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6 shipped-vs-intent review.
- The existing 12 UI sign-in tests are not converted to storageState (deferred per Phase 2 Ruling 2). This is intentional and documented.
- TOTP enrolment e2e is out of scope and tracked in `docs/TODO.md` Backlog.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The shipped e2e infrastructure matches every Phase 1 intent: role-cached storageState via the NextAuth API eliminates per-test UI sign-ins for new specs, role-boundary tests exercise a genuine non-admin denial (member → /access-pending) and the 2FA gate (mfa-admin → /totp), the DB isolation guard warns locally and hard-blocks in CI, no TOTP secret is seeded, and storageState files are gitignored. DECISION-020 (NextAuth 5 beta.31 always returns 302; maxRedirects: 0 required) is correctly applied in the shipped implementation.

### What I did

- Verified `e2e/support/global-setup.ts`: DB isolation guard (`runDbIsolationGuard()`) runs before any browser launch; posture matches option B exactly (E2E_DATABASE_URL skips; non-Neon skips; E2E_ALLOW_SHARED_DB=true skips; CI → throw; local dev → console.warn). DECISION-020 applied: `callbackRes.status() >= 400` guard (not ok()); `maxRedirects: 0` on credentials POST. Session email mismatch guard present. Three roles looped with per-role TTL check.
- Verified `e2e/role-boundaries.spec.ts`: 4 tests with correct scope — unauthenticated → /signin (with callbackUrl), member → /access-pending, mfa-admin → /totp (with callbackUrl=/admin), admin → /admin positive gate. `storageStatePath()` helper correctly resolves to `e2e/support/.auth/<role>.json` (matching AUTH_DIR in global-setup). Header comment states proxy-gate-only scope and server-action POST prohibition.
- Verified mfa-admin comment in global-setup.ts roles array: "session is intentionally NOT TOTP-verified (twoFactorRequired=true, twoFactorVerified=false). Use it ONLY to assert the /totp redirect gate fires."
- Verified `.gitignore` entry: `e2e/support/.auth/` gitignored; QA confirmed files absent from git status.
- Verified `.env.example`: E2E_DATABASE_URL and E2E_ALLOW_SHARED_DB documented; RATE_LIMIT_DISABLED comment updated to mention globalSetup sign-in calls; stale-state note present.
- Verified `playwright.config.ts`: one-line addition `globalSetup: './e2e/support/global-setup.ts'`; no other changes.
- Confirmed no production src/ files were touched by this feature.

### Outputs

- `docs/work-log/2026-07-01-e2e-auth-infra.md` — Phase 6 section added; Per-Phase Status row updated to Complete / SHIP IT / 2026-07-01.
- `docs/TODO.md` — In Flight line moved to Done.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Role-cached auth via NextAuth API (no UI sign-in tax for new specs) | globalSetup: CSRF → POST (maxRedirects: 0, status < 400) → session verify → storageState write | matches |
| Role-boundary coverage that exercises a non-admin denial | member → /access-pending assertion in role-boundaries.spec.ts | matches |
| Prod-DB isolation guard: warn locally / hard-block in CI | runDbIsolationGuard() in global-setup.ts; exact posture confirmed | matches |
| No seeded TOTP secret | mfa-admin storageState is twoFactorVerified=false; no TOTP record seeded | matches |
| No session cookies in git | e2e/support/.auth/ gitignored; absent from git status | matches |
| NextAuth 5 always returns 302 (Gap 2) | DECISION-020 applied: maxRedirects: 0; status < 400 guard; no json=true in form | matches |
| Stale-state delete instruction documented | In global-setup.ts header comment and .env.example near SEED_* block | matches |
| mfa-admin fixture state documented as intentionally incomplete | Comment in roles array at mfa-admin entry and in role-boundaries.spec.ts describe block | matches |
| Spec file header states proxy-gate-only scope | Header comment present prohibiting server-action POST probes | matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state | pass — first run with no .auth/ dir: mkdirSync creates it, fresh acquisition runs; second run within 12h: TTL skip |
| Failure microcopy | pass — CSRF failure, credentials POST failure, session mismatch all produce clear error messages with actionable fix instructions; DB guard throw in CI names all three escape hatches |
| Permission gate | not applicable — test infrastructure only; no production gates |
| Audit event | not applicable — no security-sensitive mutations |
| Mobile | not applicable |

### Open questions / handoff notes

- Existing 12 UI sign-in tests in account-page, admin-login, and timezone-safe-dates specs are not converted to storageState (deferred per Phase 2 Ruling 2). No follow-up item needed — these tests continue to pass and provide end-to-end sign-in coverage.
- TOTP enrolment e2e remains in `docs/TODO.md` Backlog — tracked.
- No open blockers. Pipeline closed.
