# Decisions Log

Architectural and implementation decisions for the Claude Code Starter. Newest first. Each decision is numbered; the number does not change once assigned.

---

## DECISION-029: Periodic reviews consolidated into two recurring slots; work-log template is the single handoff format

**Status:** Resolved
**Date:** 2026-07-11
**Feature:** `2026-07-11-instruction-layer-slim`

### Decision

**1. Review slots.** The eight independent review cadences are consolidated into two recurring slots: a **release slot** (14 days, or at each release if sooner: `test-coverage` + `retrospective`) and a **monthly health-check** (30 days, one bundled session: `code`, `documentation`, `security`, `agent-instruction`, `dependencies`). Fork-only syncs (`upstream-sync` 14 d, `downstream-sync` 30 d) are unchanged. Each review type keeps its own line in `docs/reviews/log.md`, preserving per-type history.

**Why:** eight weeks of log history showed the 7-day reviews ran once (2026-05-17) and the 30-day reviews were executed in batch sessions anyway (all on 05-17, again on 07-01). The independent cadences produced overdue-review noise at session start without producing more frequent reviews. Two slots match observed practice; the session-start cadence check now has two dates to evaluate instead of eight.

**2. Handoff format.** `docs/work-log/_template.md` is the single canonical per-phase handoff format. The generic "standard handoff template" previously duplicated in all nine agent files (and conflicting with the template's structured sections) is removed; agent files point at the template instead.

### Consequences

- `test-coverage` and `retrospective` cadence moves 7 d → 14 d (or per-release, whichever is sooner).
- CLAUDE.md → Periodic Reviews, `docs/reviews/log.md` header, and the qa / tech-lead agent files reflect the slots.
- If reviews start slipping under the bundled model (e.g., health-checks routinely >45 days), revisit — the slots are a floor, not a ceiling.

---

## DECISION-028: `api/webhooks/` subtree is the sanctioned location for inbound webhook handlers; disabled-when-unset returns 200 not 5xx

**Status:** Resolved
**Date:** 2026-07-02
**Feature:** `2026-07-02-email-observability`

### Decision

The first webhook handler in the starter (`/api/webhooks/resend`) establishes the following conventions for all subsequent webhook integrations:

**1. Placement:** All inbound webhook route handlers live under `src/app/api/webhooks/<provider>/route.ts`. No webhook handler belongs in `api/admin/` (admin requires auth; webhooks authenticate via signature) or at the top level of `api/` (flat namespace does not scale when multiple providers are integrated).

**2. Signature verification is the route handler's responsibility.** Each handler verifies its own provider signature before doing anything else. The proxy (`src/proxy.ts`) does not participate in webhook authentication — it bypasses the auth gate for `api/webhooks/*` paths, leaving signature verification entirely to the route handler body. This is correct because (a) the proxy cannot read the raw body without consuming it, and (b) each provider has a different signature scheme.

**3. Disabled-when-unset posture:** When the required env var (e.g., `RESEND_WEBHOOK_SECRET`) is absent, the handler returns **HTTP 200** with a JSON body indicating the webhook is not configured — **not 503 or 401**.

Rationale: 503 (Service Unavailable) is a retryable status code. Any webhook provider that delivers to an endpoint returning 503 will retry indefinitely. A missing env var is a permanent configuration state, not a transient failure. Returning 200 acknowledges the delivery and terminates it cleanly. The response body `{received: false, note: "Webhook not configured."}` distinguishes this case from a successful handled delivery `{received: true, handled: true}` in server logs.

401 is also wrong — it implies the caller could authenticate if it provided different credentials, which is not the case when the server has no secret to compare against.

**4. Unknown event types return 200.** A webhook handler must never return 4xx or 5xx for an event type it does not recognize. Providers retry on 4xx/5xx. Returning 200 with `{received: true, handled: false}` acknowledges the event without triggering a retry storm. This is the correct posture for forward-compatibility: the provider may introduce new event types that the starter does not handle yet.

**5. 500 is acceptable for transient DB errors.** A DB-unavailable condition during an otherwise-valid signed webhook event is a server-side transient failure. Returning 500 allows the provider to retry after the DB recovers. This is the one case where a 5xx is appropriate.

### Convention going forward

Any new webhook integration (Stripe, GitHub, etc.) placed in `src/app/api/webhooks/<provider>/route.ts` must:
- Check for its required env var and return 200 + `{received: false, note: "..."}` if absent
- Verify the provider signature before reading the event body (and return 400 on invalid signature — providers do NOT retry 400s, which is the correct behavior for a genuine bad-signature rejection)
- Return 200 + `{received: true, handled: false}` for unknown event types
- Return 200 + `{received: true, handled: true}` on successful processing
- Return 500 only for transient server errors (DB down, etc.)

The proxy `PUBLIC_PATHS` or equivalent `api/webhooks/*` bypass must be confirmed for each new provider path — the proxy must not redirect to sign-in before the handler can verify the signature.

### What is NOT changed

- `src/proxy.ts` route gating logic is unchanged. `api/webhooks/*` paths fall through the proxy without an auth redirect by virtue of being in the `api/` subtree (which the proxy does not redirect to sign-in). This must be verified in Phase 3 for any new webhook path.
- No new npm dependencies from this decision (the svix-vs-hand-rolled ruling is a Phase 4 implementation choice, not an architectural decision).

### Impact

- Establishes `src/app/api/webhooks/` as the canonical webhook handler location.
- `src/app/api/webhooks/resend/route.ts` is the first concrete instance.
- No existing files are changed by this decision.

---

## DECISION-027: Maintenance cron route is a sibling to the operational cron route; `vercel.json` carries both schedules

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-token-gc`

### Decision

Background maintenance tasks (token GC, data pruning, housekeeping sweeps) live in a dedicated `/api/cron/maintenance` route handler (`src/app/api/cron/maintenance/route.ts`), separate from operationally-critical background workers. The existing `/api/cron/email-queue` route's contract — "process pending outbound email" — is not extended with unrelated tasks.

Both routes share the `CRON_SECRET` environment variable for authentication. Both schedules live in `vercel.json` under `"crons"`. Schedules are independent: email-queue runs every 5 minutes; maintenance runs daily at 03:00 UTC (`"0 3 * * *"`).

### Rationale

1. **Separation of operational vs. maintenance concerns.** `/api/cron/email-queue` is an operational worker — a failure there delays email delivery for real users. `/api/cron/maintenance` is a housekeeping sweep — a failure there leaves stale rows in the database but does not affect user-facing flows. Coupling them forces maintenance failures to appear as email-queue failures (or vice versa) in logs, making incident triage harder.

2. **Independent schedules.** Email delivery requires a 5-minute cadence; token GC needs daily cadence at most. Running GC every 5 minutes is wasteful; running email processing once daily is dangerous. Separate routes allow independent scheduling without a branching dispatch table inside a single handler.

3. **Extensibility.** A dedicated `/api/cron/maintenance` route is the natural home for future maintenance tasks (email queue row pruning, audit_events archiving, etc.) that forks will add. A single handler with a clear "maintenance" contract is easier to extend than a mixed-concern email handler.

4. **Teaching artifact clarity.** A fork developer reading the project's cron configuration should immediately understand that there are two kinds of background work: operational (email-queue) and maintenance. Two named routes make this distinction obvious without reading the handler bodies.

### `vercel.json` shape (approved)

```json
{
  "crons": [
    { "path": "/api/cron/email-queue", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/maintenance", "schedule": "0 3 * * *" }
  ]
}
```

### Convention going forward

- New operational cron workers (e.g., a Stripe webhook reprocessor) get their own `/api/cron/<feature>` route with an appropriate schedule.
- Additional maintenance tasks (row pruning, archiving) are added to `/api/cron/maintenance` as additional DELETE statements in the same handler, not as new cron routes.
- `CRON_SECRET` is the single shared authentication mechanism for all cron routes. No new cron-specific env vars.

### What is NOT changed

- `/api/cron/email-queue` handler and schedule are unchanged.
- `CRON_SECRET` semantics are unchanged.
- No new npm dependencies.

### Impact

- Adds `src/app/api/cron/maintenance/route.ts`.
- `vercel.json`: adds second cron entry for the maintenance route.

---

## DECISION-026: Fail-open requirement for auth-critical feature flags; named wrapper pattern in `src/lib/auth/`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-auth-mode-flags`

### Decision

Feature flags that gate an authentication path (sign-in, credential validation) MUST use explicit fail-open handling at the check site. The standard `isFlagEnabled(key)` function is NOT safe to use directly for auth-critical flags because it returns `false` on a missing row or DB error — and `false` on a flag that means "allow this auth path" translates to "deny all sign-ins during a DB blip."

**Required pattern for auth-critical flags:**

```typescript
// Named helper in src/lib/auth/ with explicit fail-open semantics
export async function isLocalLoginEnabled(): Promise<boolean> {
  try {
    const row = await db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, "auth.local_login"),
    });
    // row undefined (flag not yet seeded) → treat as enabled (fail-open)
    // row.enabled false → explicitly disabled by an admin
    return row === undefined ? true : row.enabled;
  } catch {
    // DB unreachable → fail-open: never lock out credentials sign-in due to a DB blip
    return true;
  }
}
```

The helper is named, unit-testable (same DI pattern as `src/lib/auth/lockout.ts`), and documents the fail-open rationale in its own body.

### Classification rule

A flag is "auth-critical" if its `false` value prevents an authentication path from completing AND the flag is expected to be `true` in the vast majority of deployments.

`auth.local_login` meets both criteria. `auth.require_2fa` does NOT — its `false` value means "no forced 2FA," which is the safe and expected default; fail-closed on `false` is correct there.

### Standard `isFlagEnabled()` semantics (unchanged)

`isFlagEnabled(key)` returns `false` on a missing row. This is the correct default for feature-toggle flags (missing flag = feature is off). It must NOT be used for auth-blocking flags without a fail-open wrapper.

### Convention going forward

Any future flag whose `false` value blocks a sign-in or sign-up path must use an explicit fail-open wrapper, not `isFlagEnabled()` directly. The wrapper lives in `src/lib/auth/` and includes a `catch → true` block with a comment naming the blip-safety rationale.

### What is NOT changed

- `isFlagEnabled()` semantics are unchanged.
- `auth.require_2fa` uses standard `isFlagEnabled()` — its fail-closed-on-missing behavior is correct.
- No new npm dependencies.

### Impact

- Adds `src/lib/auth/local-login.ts` (or equivalent) with `isLocalLoginEnabled()` and a companion unit test.
- `src/auth.ts` `authorize()`: replaces any direct `isFlagEnabled("auth.local_login")` call with `isLocalLoginEnabled()`.
- `scripts/seed.ts`: registers `auth.local_login` with `enabled: true` and `auth.require_2fa` with `enabled: true`.

---

## DECISION-025: Per-account lockout state — two columns on `users`; logic in `src/lib/auth/lockout.ts`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-account-lockout`

Two architectural sub-decisions bundled because they answer the same question: where does lockout state and lockout logic live?

### Sub-decision 1 — Schema: two columns on `users`, not a separate table

`failedLoginAttempts` (integer, NOT NULL, default 0) and `lockedUntil` (timestamptz, nullable) are added directly to the `users` table in migration 0005.

**Rationale:**

1. `authorize()` already fetches the user row by email before any lockout check can fire. Adding two columns to that row eliminates a second roundtrip — no join, no separate fetch.
2. The `users` table already holds auth-state columns in this neighborhood (`isActive`, `lastLoginAt`, `twoFactorRequired`). Lockout state is logically a property of the user's authentication posture, not a separate entity.
3. A `user_lockout` separate table would force every lockout check through a join, complicating the `authorize()` read path with no benefit at the starter's scale.
4. The npvitals reference (`src/lib/auth.ts:8-9`) confirms two columns on `users` are sufficient.

**Index guidance:** No index on `failed_login_attempts` or `locked_until` is warranted. Both columns are accessed only on a row already retrieved by primary key.

**Width tradeoff acknowledged:** The `users` table grows to 13 columns. Forks with very wide `users` tables and tight row-width budgets can extract to a `user_lockout` table; this decision documents the starter's default.

### Sub-decision 2 — Logic: `src/lib/auth/lockout.ts`, DI'd pure helper

The lockout evaluation logic is extracted to `src/lib/auth/lockout.ts` following the exact shape of `src/lib/auth/sign-in-gate.ts` (DECISION-015 precedent): pure functions, injected dependencies, no direct `db` import inside the module. Actual DB writes stay in `authorize()` where `db` is in scope.

The helper exports:
- `checkLockout(user: { failedLoginAttempts: number; lockedUntil: Date | null }, now: Date): { locked: boolean; resetCounter: boolean }` — pure, synchronous. `resetCounter: true` when the lock window has expired (signals `authorize()` to reset the counter before bcrypt, giving the user a fresh window rather than immediately re-locking on next failure).
- `LOCKOUT_THRESHOLD = 5` — failure count that triggers a lock.
- `LOCKOUT_DURATION_SECONDS = 900` — fifteen minutes.

**Convention going forward:** Any future auth-adjacent guard logic that requires unit-testable evaluation without a real database follows the same DI'd pure-function pattern in `src/lib/auth/`. Helper evaluates state; caller handles persistence.

### What is NOT changed

- No new npm dependencies.
- No `src/proxy.ts` changes (lockout runs in Node runtime `authorize()`, not at the Edge).
- No admin UI for lockout state (out of scope for this iteration; tracked in `docs/TODO.md`).
- OAuth sign-ins are unaffected — `authorize()` is credentials-only; `evaluateSignIn()` is unchanged.

### Impact

- `src/lib/db/schema.ts`: add `failedLoginAttempts` and `lockedUntil` to `users`.
- `drizzle/0005_*.sql`: generated via `npm run db:generate`.
- Adds `src/lib/auth/lockout.ts` with `checkLockout()`, `LOCKOUT_THRESHOLD`, `LOCKOUT_DURATION_SECONDS`.
- Adds `src/lib/auth/lockout.test.ts` with unit tests (pure logic, no DB mock needed).
- `src/auth.ts` `authorize()`: insert lockout check + conditional-increment UPDATE + success-path reset.
- `src/lib/audit.ts` `AUDIT_ACTIONS`: add `USER_ACCOUNT_LOCKED: "user.account_locked"`.
- `src/app/(password-reset)/reset-password/` action: reset both lockout columns in the password-update batch.

---

## DECISION-024: Report-only CSP posture — starter ships `Content-Security-Policy-Report-Only`; enforced CSP deferred to forks

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-security-headers`

### Decision

The starter ships `Content-Security-Policy-Report-Only` — not an enforced `Content-Security-Policy`. An enforced CSP is explicitly deferred to forks as a follow-on hardening step.

### Rationale

1. **Static `next.config.ts` headers cannot generate nonces.** Enforced CSP with `'unsafe-inline'` in `script-src` or `style-src` provides minimal protection — an attacker who can inject a `<script>` tag can inject inline JS that the `'unsafe-inline'` directive permits. Real CSP security requires nonce-based or hash-based `script-src` that removes `'unsafe-inline'`. Nonce generation requires per-request middleware (the nonce must be injected into both the HTTP header and the `<script>` tag in the same request). That is out of scope for a `next.config.ts` static-header approach. Shipping an enforced `'unsafe-inline'` CSP would give the false impression of protection.

2. **Report-only is safe to start loose.** Violations surface in devtools and any connected `report-uri` endpoint without breaking the app. This gives fork developers visibility into what a tighter policy would catch before they commit to enforcement.

3. **The starter is a fork baseline, not a production app.** A CSP that is enforced prematurely and breaks a fork's first third-party integration is a worse outcome than a report-only posture that forks can gradually tighten.

### Fork-tightening path (to be documented in code comment)

1. Deploy report-only. Observe violations for several days in devtools or a `report-uri` aggregation endpoint (add `/api/csp-report` + a route handler).
2. Narrow directives based on observed violations. For any new external script or font, add the domain rather than keeping `'unsafe-inline'`.
3. Add nonce generation in `src/proxy.ts` (or a custom Next.js `middleware.ts`) and pass the nonce to `<Script>` components. Remove `'unsafe-inline'` from `script-src`.
4. Rename the header key from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.

### Convention going forward

`Content-Security-Policy-Report-Only` is the sanctioned CSP header key in this starter. No enforced `Content-Security-Policy` header is shipped. Any PR that adds an enforced CSP must go through the full pipeline with a Phase 2 ruling on nonce strategy.

### Directive set (approved for initial implementation)

```
default-src 'self'
script-src 'self' 'unsafe-inline'
style-src 'self' 'unsafe-inline'
img-src 'self' data: https://lh3.googleusercontent.com
font-src 'self'
connect-src 'self'
frame-src 'none'
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

### What is NOT changed

- No new npm dependencies.
- `next.config.ts` is the only file touched.
- No runtime code; headers are static strings.

### Impact

- `next.config.ts`: adds `Content-Security-Policy-Report-Only` to `securityHeaders`; drops `preload` from `Strict-Transport-Security`; adds `allowedDevOrigins: ["*.trycloudflare.com"]` to `nextConfig`.
- A comment in `next.config.ts` at the CSP entry documents the fork-tightening path.
- A comment at `Strict-Transport-Security` explains why `preload` is intentionally omitted.
- A comment at `allowedDevOrigins` identifies it as a dev tunnel accommodation; fork owners who do not use Cloudflare tunnels may remove it.

---

## DECISION-023: TZ posture (write-local / read-UTC) and APP_VERSION (JSON import at build time)

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-feedback-dev-loop`

Two implementation decisions bundled because they both answer "what does the client send to the server?" for the feedback form.

### Sub-decision 1 — TZ posture: write-local / read-UTC (option b)

The `feedbackPromptState` table stores `lastSnoozedDate` and `lastSubmittedDate` as `'YYYY-MM-DD'` text in the member's **local** timezone, derived from a client-provided `tzOffsetMinutes` field. The server-side `shouldShowFeedbackPrompt` check reads UTC "today" (`new Date().toISOString().slice(0, 10)`) to determine whether to suppress the prompt card.

This creates a known asymmetry: a member in UTC-8 who submits at 11 PM local time (7 AM next UTC day) will write `lastSubmittedDate = "YYYY-MM-DD"` (their local date), but the next server render will compare against UTC "today" — which may already be the following day. In practice this means the suppression could fail to trigger for a narrow midnight window. This is acceptable for a template — the alternative (option c, a `timezone` IANA column on `users`) requires schema work and a UI to set it, which is out of scope.

**Implementation rule:** `computeLocalDate(tzOffsetMinutes: number | null | undefined): string` is a private helper in `src/app/(member)/feedback/actions.ts`. It clamps `tzOffsetMinutes` to `[-720, +840]` (the full valid IANA range) and falls back to 0 (UTC) when the value is `null` or `undefined`. This handles the `429ed48` null-narrowing case from the huddleup reference.

```typescript
function computeLocalDate(tzOffsetMinutes: number | null | undefined): string {
  const offset = typeof tzOffsetMinutes === "number"
    ? Math.max(-720, Math.min(840, tzOffsetMinutes))
    : 0;
  const localMs = Date.now() - offset * 60_000;
  return new Date(localMs).toISOString().slice(0, 10);
}
```

The `tzOffsetMinutes` value is captured from `new Date().getTimezoneOffset()` at submit/snooze time (in the client component) and passed as part of the action payload. It is clamped server-side regardless of what the client sends.

**CLAUDE.md note:** the "Feedback and Dev-Loop Wiring" invariant subsection documents this asymmetry explicitly so fork developers understand it is intentional, not a bug.

### Sub-decision 2 — APP_VERSION: JSON import at build time via `src/lib/version.ts`

The feedback form's bug-category context block displays the current app version. The starter does not have a version utility. Options considered:

1. `next.config.ts` build env (`env: { NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version }`) — requires touching `next.config.ts` and adds a `NEXT_PUBLIC_` env that shows in the client bundle explicitly.
2. `import pkg from "../../package.json"` in a `src/lib/version.ts` module — `resolveJsonModule: true` is already in `tsconfig.json`; the import is resolved at compile time; the version string is a build-time constant included in the client bundle.
3. Drop appVersion from v1 — loses useful bug context.

**Decision: option 2** — `src/lib/version.ts` with a plain JSON module import.

```typescript
// src/lib/version.ts
// Build-time constant — resolved from package.json at compile time.
// No 'server-only' marker: FeedbackForm is a 'use client' component that imports this.
// The version string is not sensitive and safe in the client bundle.
import pkg from "../../package.json";
export const APP_VERSION: string = pkg.version;
```

The relative path from `src/lib/version.ts` to the project root is `../../package.json`. This resolves correctly. No new dependencies; no `next.config.ts` change. The string is baked in at build time — a rebuild is required for version changes (which is already required for any code change).

### What is NOT changed

- No new npm dependencies.
- No `next.config.ts` changes.
- No user-visible schema column for timezone (IANA string column deferred).

### Impact

- Adds `src/lib/version.ts`.
- `src/app/(member)/feedback/actions.ts`: contains `computeLocalDate` helper; `tzOffsetMinutes` is an optional nullable field in `submitFeedback` and `snoozeFeedbackPrompt` inputs.
- CLAUDE.md: "Feedback and Dev-Loop Wiring" Key Invariants subsection documents the UTC-read / local-write asymmetry.

---

## DECISION-022: SessionStart hook convention — `.mjs` with `@neondatabase/serverless`; registered in `.claude/settings.json`; prompt-injection boundary is count-only output

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-feedback-dev-loop`

### Decision

SessionStart hooks for this starter are written as Node ESM scripts (`scripts/*.mjs`) and registered in `.claude/settings.json` under the `hooks.SessionStart` array. The feedback hook specifically uses `@neondatabase/serverless` for a direct HTTP query rather than `tsx` + Drizzle.

**Implementation conventions derived from this decision:**

1. **Script extension:** `.mjs`, not `.ts`. Consistent with the existing `scripts/` convention (`check-audit-coverage.mjs`, `commit-msg.mjs`, `stats-escape.mjs`). No compile step, no tsx invocation — a hook must be fast and have zero friction on a fresh fork that has only run `npm install`.

2. **Query mechanism:** `@neondatabase/serverless`'s `neon(DATABASE_URL)` tagged-template SQL. This package is already a production dependency — it is always present after `npm install` without any additional installation. It makes a single HTTP request and returns the result. No ORM initialization, no schema import, no TypeScript compilation.

3. **Silent-skip invariant:** The script reads `DATABASE_URL` from `.env.local` in the project root (using `fs.readFileSync` in a try/catch). If the file is absent, the var is missing, or the DB query throws for any reason, the script exits 0 with no output. The hook is informational only; it must never block session startup.

4. **Prompt-injection boundary (non-negotiable):** The hook prints ONLY a count integer and static operator instructions authored in the script source. It NEVER fetches or prints any feedback body, category, submitter name, or any other member-supplied content. The query is always `SELECT count(*) FROM feedback WHERE status = 'new'` — a scalar integer. This boundary must be stated in the script's header comment and is enforced by code review.

5. **`.claude/settings.json` registration:**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/feedback-check.mjs"
          }
        ]
      }
    ]
  }
}
```

   The existing `permissions` key remains at the top level alongside `hooks`. Tech-lead should verify the exact hook format against Claude Code's hook documentation when implementing; the shape above matches the `update-config` skill's documented convention but Claude Code hook syntax evolves.

6. **Project-scoped (not user-scoped).** The hook lives in `.claude/settings.json` (checked into the repo), not in the user's `~/.claude/settings.json`. This means the hook fires for any Claude Code session in this project directory — for both the project author and any contributor who checks out the repo. This is the correct scope for the teaching-artifact and dev-loop posture.

### Rationale

**Why `.mjs` over `.ts`?** `tsx` is a devDependency present after `npm install`, so it IS available. But a SessionStart hook fires before any work has begun — before the dev server, before a build. Requiring tsx execution adds a compilation step, and any TypeScript error in the script (e.g., a missing type for an imported Drizzle schema that changed) could silently cause the hook to error. A `.mjs` with `@neondatabase/serverless` is simpler, faster, and cannot be broken by schema changes.

**Why `@neondatabase/serverless` over Neon MCP?** The hook must work on any fork — including forks that do not configure the Neon MCP. `@neondatabase/serverless` is a production dependency that every fork inherits by default. The huddleup implementation shelled out to `psql`; that approach requires psql installed locally and a `DATABASE_URL_UNPOOLED` var (direct connection, not pooled). The HTTP-based `neon()` client uses the standard `DATABASE_URL` (pooled is fine for a single query) and requires no local tooling beyond Node.

**Prompt-injection rationale.** Feedback body is user-supplied content. A malicious member could submit a body containing LLM instruction text designed to hijack the next Claude Code session that reads it. The only safe output from a hook that reads untrusted-user data is a count integer and literal strings from the script source. This is a hard security constraint documented here so it survives any future refactoring.

### What is NOT changed

- No new npm dependencies.
- No schema change.
- Existing `.claude/settings.json` `permissions` block is unchanged; `hooks` is a new top-level sibling.

### Impact

- Adds `scripts/feedback-check.mjs`.
- Adds `hooks.SessionStart` block to `.claude/settings.json`.
- CLAUDE.md: adds session-start checklist step (see CLAUDE.md changes enumerated in Phase 1 of the feedback work-log).

---

## DECISION-021: No `_components/` sub-convention in route groups; page-local interactive components colocated as named files; cross-route-group member actions in `(member)/<feature>/actions.ts`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-feedback-dev-loop`

### Decision

Two sub-decisions bundled because they answer the same question: where does interactive or shared code live when it doesn't clearly belong to a single page?

**1. `_components/` is NOT a convention in this starter.**

Some Next.js projects create `_components/` subdirectories within route groups (e.g., `(member)/home/_components/FeedbackPromptCard.tsx`). This starter does NOT use this pattern.

Reason: `_components/` is an ad-hoc local convention with no official Next.js meaning. Downstream forks that copy this pattern without understanding the precedent will apply it inconsistently — some routes get `_components/`, some don't, and the distinction between "local component" and "shared component" blurs. The starter's two-tier system is cleaner:

- **Colocated at page level:** components used only by one page live as named `.tsx` files alongside `page.tsx` in the same directory (e.g., `src/app/(admin)/admin/users/[id]/deactivate-card.tsx`, `src/app/(admin)/admin/users/[id]/two-factor-card.tsx`). This pattern is already established in the codebase.
- **`src/components/shared/`:** components used by more than one route group or page. No `src/components/admin/` directory has been created yet — colocated admin components handle that need. If the admin surface grows to a point where shared admin components accumulate, a `src/components/admin/` directory can be introduced via a separate DECISION.

For the feedback feature specifically:
- `FeedbackPromptCard` (client island, used only at `/home`) → `src/app/(member)/home/feedback-prompt-card.tsx`
- `FeedbackForm` (used at `/home` dialog AND `/account` form) → `src/components/shared/feedback-form.tsx`
- `FeedbackStatusControl` (admin triage client island, used only at `/admin/feedback`) → `src/app/(admin)/admin/feedback/feedback-status-control.tsx`

**2. Cross-route-group member server actions live in `(member)/<feature>/actions.ts`.**

When a server action is needed from two different route groups (e.g., `submitFeedback()` is called from both `(member)/home` and `(account)/account`), the action lives in a named subdirectory under the primary route group that owns the feature: `src/app/(member)/feedback/actions.ts`.

Why not `src/lib/`? `src/lib/` is for pure server-side utilities, ORM helpers, and cross-cutting infrastructure — not for product-level mutations with auth checks and rate limits. Putting `submitFeedback()` in `src/lib/` would break the separation between "library code" and "application code that happens to be shared."

Why not colocated with the home page? `src/app/(member)/home/actions.ts` would force the account page to import from the home page's directory, which is semantically wrong (the account page doesn't "belong" to the home page's module). A sibling directory `(member)/feedback/` is semantically correct: it's a feature module within the member route group.

Cross-group import: `import { submitFeedback } from "@/app/(member)/feedback/actions"` from `(account)/account/page.tsx` is allowed. Next.js route groups are organizational and do not create module isolation boundaries — the parentheses affect URL structure only, not module resolution.

### Convention going forward

- No new `_components/` directories.
- Page-local interactive components: named `.tsx` colocated with `page.tsx`.
- Shared cross-route-group components: `src/components/shared/`.
- Member-facing server actions used from multiple route groups: `src/app/(member)/<feature>/actions.ts`.
- Admin-only server actions: colocated `actions.ts` in the admin page directory.

### What is NOT changed

- `src/components/shared/` and `src/components/ui/` are unchanged.
- Existing colocated admin components (deactivate-card.tsx, two-factor-card.tsx) are unchanged and confirmed as the precedent.
- No new npm dependencies. No schema change.

### Impact

- `src/app/(member)/feedback/actions.ts` — new module (Phase 4: api-developer)
- `src/app/(member)/home/feedback-prompt-card.tsx` — new colocated client island (Phase 4: ux-developer)
- `src/components/shared/feedback-form.tsx` — new shared component (Phase 4: ux-developer)
- `src/app/(admin)/admin/feedback/feedback-status-control.tsx` — new colocated admin client island (Phase 4: ux-developer)

---

## DECISION-020: NextAuth 5 beta.31 credentials endpoint always returns HTTP 302; `json=true` is a no-op; success check is `status < 400`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-e2e-auth-infra`

### Decision

`POST /api/auth/callback/credentials` in NextAuth 5 beta.31 (Auth.js beta) **always** returns HTTP 302, regardless of whether `json=true` is included in the form body. It never returns a 2xx JSON response. The session cookie is issued in the `Set-Cookie` header of the 302 response. The redirect `Location` is derived from `AUTH_URL` (the env var), not the request host — so it may point at a different port than the test server.

**Implementation rules derived from this finding:**

1. Do NOT use `callbackRes.ok()` to check for sign-in success — it returns `false` on 302.
2. Do NOT include `json=true` in the credentials POST form data — it has no effect and adds misleading code (it was a NextAuth v4 convention that is not honored in v5 beta.31).
3. Do NOT include `totpCode` — the starter's `authorize()` accepts `email` and `password` only; undeclared fields are silently dropped.
4. Success check: `callbackRes.status() < 400`. Any 4xx or 5xx is a hard failure; 3xx is the expected success response.
5. Use `maxRedirects: 0` on the Playwright `request.post()` call to prevent Playwright from following the 302 to `AUTH_URL` (which may be a different host/port). The session cookie is captured from the first response.
6. Verify session by calling `GET /api/auth/session` with the captured cookies and asserting `session.user.email === expectedEmail`.

### Evidence

Live probe run against `npm run dev -- -p 3100` with `SEED_ADMIN_EMAIL=admin@claudecode.info` credentials (2026-07-01):
- GET `/api/auth/csrf` → 200 OK, `{"csrfToken":"..."}`, sets `authjs.csrf-token` cookie.
- POST `/api/auth/callback/credentials` (without `json=true`) → 302, `location: http://localhost:3000`, `set-cookie: authjs.session-token=<JWE>`.
- POST `/api/auth/callback/credentials` (with `json=true`) → identical 302, identical session cookie.
- GET `/api/auth/session` with session cookie → 200 OK, full session JSON with `user.email`, `user.roles`, `user.features`, `user.twoFactorRequired`, `user.twoFactorVerified`.

### What is NOT changed

- The NextAuth sign-in flow for users in the browser is unaffected — this decision applies only to programmatic API calls in `globalSetup`.
- The `callbackUrl` form field should be set to `${baseURL}/home` for clarity and to satisfy any future strict-origin validation.

---

## DECISION-019: E2E testing conventions — `e2e/support/` directory, API sign-in for storageState, DB isolation guard posture, per-spec `test.use()`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-e2e-auth-infra`

### Decision

Four sub-decisions bundled because they form one cohesive e2e testing convention layer:

**1. `e2e/support/` for non-spec infrastructure.**
All Playwright infrastructure that is not a test file belongs in `e2e/support/`. At minimum: `e2e/support/global-setup.ts`. If the module grows to warrant splitting (e.g., a reusable auth-helper extracted from setup), `e2e/support/auth-helpers.ts` is the correct destination. Spec files remain flat in `e2e/`. This mirrors the npvitals pattern and is the convention downstream forks copy.

**2. Per-spec `test.use({ storageState })`, not per-role Playwright projects.**
`playwright.config.ts` gains one addition: `globalSetup: './e2e/support/global-setup.ts'`. The existing single Chromium project and flat spec structure are otherwise unchanged. New specs and the role-boundaries spec opt in to cached auth via `test.use({ storageState: 'e2e/support/.auth/admin.json' })` at the describe-block level. Existing tests continue to drive the sign-in UI without breaking — adoption is incremental. Per-role Playwright projects (one project per auth role, each project pre-sets storageState) are rejected because they would require splitting existing multi-role spec files and restructuring the 20 passing tests — too much churn for the benefit at the starter's current scale.

**3. API sign-in in globalSetup; fail loudly on acquisition failure.**
The `globalSetup` acquires per-role sessions by POSTing to NextAuth's credentials endpoint (`/api/auth/callback/credentials` with a fresh CSRF token from `/api/auth/csrf`, then verifying via `/api/auth/session`) rather than driving the sign-in UI. Saved `.json` files live under `e2e/support/.auth/` (gitignored). Refresh logic: re-acquire if the file is absent or older than 12 h.

Stale-state posture: when credentials env vars are set and the API sign-in fails or returns an unauthenticated session, `globalSetup` throws. In CI, a stale or invalid storageState that goes undetected is worse than a hard build failure. When credentials vars are absent, `globalSetup` skips that role's acquisition; per-spec `test.skip(!SEED_*)` guards continue to gate those tests as before.

**4. DB isolation guard: warn locally, hard-block in CI.**
`globalSetup` inspects `DATABASE_URL`. If the host matches `*.neon.tech`:
- **Local dev (no `CI` env var):** print a prominent stderr warning naming the risk and continue. The author's own dev runs are against a Neon dev DB; blocking here would break them immediately.
- **CI (`CI=true`):** throw with an actionable message unless `E2E_DATABASE_URL` (a separate isolated DB URL) or `E2E_ALLOW_SHARED_DB=true` (explicit opt-out) is set. This protects fork CI pipelines from silently polluting a shared Neon database.
- `E2E_ALLOW_SHARED_DB=true` overrides the CI hard-fail in both local and CI; teams that intentionally share a DB own the risk.

### Rationale

1. **Teaching-artifact lens on directory shape.** The `e2e/support/` separation is the natural Playwright home for infrastructure that is not a spec. Showing it explicitly — rather than a flat helpers.ts alongside spec files — is the pattern downstream forks are most likely to copy and extend correctly. A flat structure that mixes spec files and infrastructure requires forks to invent the separation themselves.

2. **Minimal churn over optimal shape.** The per-role Playwright project split is architecturally cleaner but requires restructuring the existing 20 tests. At the starter's current scale, the churn is disproportionate to the benefit. Per-spec `test.use()` achieves the same caching with zero changes to existing specs and a clear incremental migration path.

3. **API sign-in is faster and more durable for setup.** UI sign-in is the right thing to test in specs — it exercises the sign-in page, form, and NextAuth redirect. For globalSetup (acquiring a session that dozens of specs reuse), the UI path is brittle: a rendering delay or selector change fails the acquisition for all specs. The API path is a direct, stable contract with NextAuth.

4. **DB guard protects forks without breaking the author's workflow.** The author's `DATABASE_URL` is a Neon dev database. A hard block at any posture would make the guard the first thing a fork owner removes. The warn-locally / block-in-CI split makes the guard meaningful for the audience that matters most (fork CI pipelines) while leaving the author's workflow intact.

### Convention going forward

- Any new e2e infrastructure file (fixtures, page objects, setup utilities) lives in `e2e/support/`.
- Spec files that need authenticated sessions call `test.use({ storageState: 'e2e/support/.auth/<role>.json' })` at the describe-block level. They do NOT sign in via UI in `beforeEach`.
- `e2e/support/.auth/` is gitignored. CI re-acquires fresh state on each run via `globalSetup`.
- The DB isolation guard posture must not be weakened without an explicit decision revision here.

### What is NOT changed

- No new npm dependencies. Playwright is already present.
- No schema changes.
- Seed script: no changes required. The three seeded users already exist with the correct attributes.
- TOTP enrolment e2e is explicitly out of scope (tracked as a Backlog item in `docs/TODO.md`).

### Impact

- Adds `e2e/support/global-setup.ts`.
- Adds `e2e/support/.auth/` directory pattern (gitignored).
- `playwright.config.ts`: adds `globalSetup: './e2e/support/global-setup.ts'`.
- Adds `e2e/role-boundaries.spec.ts`.
- `.env.example`: adds commented `E2E_ALLOW_SHARED_DB` entry.
- `docs/TODO.md`: adds "TOTP enrolment e2e" to Backlog.

---

## DECISION-018: Email module splits into `src/lib/email/` directory; queue stores rendered HTML at rest

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-email-queue`

### Sub-decision 1 — Directory split

`src/lib/email.ts` (single file, currently 61 lines) is promoted to `src/lib/email/` with three files:

- `send.ts` — the existing `sendEmail()` low-level transport + `sendPasswordResetEmail()` template function.
- `queue.ts` — `enqueueEmail()`, the atomic claim function, the process/retry loop, and dev intercept/redirect env-var handling.
- `index.ts` — barrel that re-exports `sendEmail`, `sendPasswordResetEmail`, and `enqueueEmail`. Existing call sites at `@/lib/email` continue to work without path changes.

**Rationale:**

1. **Readability threshold.** The queue module adds an enqueue function, a single-statement CTE claim query, a process/retry loop with exponential backoff, and dev-intercept/redirect handling — roughly 150–200 lines. Combined with the existing 61 lines, a single file would exceed 220 lines of mixed concerns (transport + persistence + scheduling). The starter's mandate is a "small, opinionated baseline that stays readable." A 220-line file with two unrelated concerns (send vs. queue) is not single-pass readable for a fork developer.

2. **Distinct concerns.** `send.ts` answers "how do I send an email now?" `queue.ts` answers "how do I persist an email so it's sent reliably later?" These are different enough that coupling them in one file would mislead fork developers about which part to edit when adding a new template (send.ts) vs. tuning retry policy (queue.ts).

3. **`src/lib/auth/` precedent.** The auth module was a single `auth.ts` before it outgrew a single concern; it now lives in `src/lib/auth/` with `config.ts`, `safe-callback.ts`, `sign-in-gate.ts`, and a request-ip module extracted alongside it. The same progression applies here. A directory is the right structure once the module has two meaningfully separate responsibilities.

4. **Zero import-path churn at existing call sites.** The barrel re-export at `index.ts` means `import { sendEmail } from "@/lib/email"` continues to resolve exactly as before. No call site needs updating.

**What is NOT a directory split:**

Smaller modules with one concern stay as single files. `flags.ts`, `permissions.ts`, `two-factor.ts`, `rate-limit.ts` are all single-file because each has one primary responsibility. The rule is: a directory when there are two meaningfully distinct concerns that a fork developer would want to find and edit independently.

### Sub-decision 2 — Store rendered HTML at rest

The `email_queue` table stores the **fully rendered HTML body** (and plain-text body) in columns on the row, not a template key + JSON params.

**Rationale:**

1. **Matches the existing `SendEmailInput` interface.** `sendEmail()` already accepts `{ to, subject, html, text? }`. `enqueueEmail()` wraps `sendEmail()`'s input — it would accept the same shape. Storing what the transport already receives requires no re-render step and no template registry in the queue.

2. **Simpler to implement and teach.** A template-key + JSON-params approach requires the queue processor to know how to invoke each template function by name, maintain a template registry, and re-render on every retry. That's a non-trivial indirection that adds complexity without benefiting the starter's primary audience.

3. **Retries are safe without re-rendering.** The rendered HTML and resolved reset/verify URLs are correct at enqueue time. Retrying the same rendered row is safe — the link was already generated and the recipient is already determined. Template-at-send-time re-rendering would re-resolve relative timestamps, which could behave differently on the 4th retry.

4. **Tradeoff documented for forks.** Storing rendered HTML does persist more data (full HTML, including any user-supplied name or email address rendered into the template). Forks with strict data-minimization requirements should store template key + JSON params and re-render at send time. This architectural note belongs in a comment at the `emailQueue` table definition in `schema.ts`.

### Convention going forward

Any future email send site: call `enqueueEmail({ to, subject, html, text? })`. Do not call `sendEmail()` directly from server actions or pages — the queue is the only sanctioned path for outbound email. `sendEmail()` is an internal transport function called only by the queue processor. This invariant prevents silent-drop regressions if the queue is bypassed.

### Impact

- `src/lib/email.ts` is deleted; replaced by `src/lib/email/send.ts`, `src/lib/email/queue.ts`, `src/lib/email/index.ts`.
- All existing `import ... from "@/lib/email"` call sites continue to work via the barrel.
- New `emailQueue` table in `src/lib/db/schema.ts` with columns: `id`, `to` (recipient email, text), `subject`, `html`, `text` (nullable), `status` (text: `'queued' | 'processing' | 'sent' | 'failed'`), `attemptCount`, `maxAttempts`, `nextRetryAt` (timestamp with timezone), `claimedAt` (timestamp with timezone, nullable), `sentAt` (timestamp with timezone, nullable), `lastError` (text, nullable), `providerMessageId` (text, nullable), `createdAt`, `updatedAt`.
- Composite index on `(status, nextRetryAt)` for the claim query.
- `import "server-only"` in both `send.ts` and `queue.ts`.

---

## DECISION-017: `getRequestIp()` extracted to `src/lib/request-ip.ts`; canonical IP-extraction precedence established

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-record-audit-helper`

### Decision

IP extraction is extracted from `src/lib/rate-limit.ts` into a new shared module at `src/lib/request-ip.ts`. Both `rate-limit.ts` (which previously owned the implementation) and the new `recordAudit()` helper in `src/lib/audit.ts` import `getRequestIp()` from there.

The canonical IP-extraction precedence for this starter is:

1. `cf-connecting-ip` — if present, unconditionally trusted. Cloudflare sets this at the network edge; it cannot be injected by clients on Cloudflare-fronted deployments. If Cloudflare is not in the path, the header is absent (Vercel strips unrecognized headers), so there is no spoofing risk.
2. `x-forwarded-for` (first value) — consulted only when `TRUST_PROXY_HEADERS=true`. Explicitly opt-in because XFF is trivially spoofable without a controlled proxy chain.
3. `x-real-ip` — the Vercel-set fallback. Reliable on Vercel without any env-var configuration; absent in local dev.

### Rationale

1. **Avoid coupling two unrelated modules.** Before this decision, `getRequestIp()` lived in `src/lib/rate-limit.ts`, a rate-limiting module. Having `src/lib/audit.ts` import from `rate-limit.ts` just to get an IP would be a backwards dependency: auditing would depend on rate-limiting infrastructure. Extracting the function removes that coupling entirely.

2. **Single source of truth.** The starter previously had no `cf-connecting-ip` handling in rate limiting and would have had a different precedence in auditing if the fertilityluna reference were copied verbatim. Two different IP-extraction implementations in the same request path (rate limiting sees one IP; audit log sees another) defeat the forensic purpose of the audit log. A shared module ensures both subsystems see the same client IP for the same request.

3. **Correct precedence.** The original `getRequestIp()` never checked `cf-connecting-ip`. This is fixed in the extracted version. Any fork running behind Cloudflare now gets consistent, correct IP attribution in both rate-limit keys and audit rows.

4. **Teaching artifact clarity.** `src/lib/request-ip.ts` is a purpose-named, single-function module — analogous to `src/lib/flags.ts` and `src/lib/permissions.ts`. A fork developer looking for "where does IP extraction live?" has one obvious answer.

### Convention going forward

Any future module that needs the client IP (e.g., geo-gating, abuse detection) imports `getRequestIp()` from `@/lib/request-ip`. Do not re-implement inline.

### What is NOT changed

- The behavior of `TRUST_PROXY_HEADERS` is unchanged; the env-var semantics are identical to the prior implementation.
- `rate-limit.ts` behavior is unchanged; it now delegates to `request-ip.ts` instead of housing the implementation.
- No schema change, no permission change, no feature flag.

### Impact

- Adds `src/lib/request-ip.ts` with `getRequestIp(hdrs)` implementing the three-tier precedence above.
- `src/lib/rate-limit.ts`: remove local `getRequestIp` function; add `import { getRequestIp } from "@/lib/request-ip"`.
- `src/lib/audit.ts`: import `getRequestIp` from `@/lib/request-ip`; use in `recordAudit()`.

---

## DECISION-016: `trustHost: true` set in code, not env-only

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-nextauth-trusthost` (BUG-4)

### Decision

Add `trustHost: true` directly to the `authConfig` object in `src/lib/auth/config.ts`, not as a deployment-time env var requirement.

### Placement: `config.ts`, not `auth.ts`

`trustHost` is placed in `authConfig` (rather than in the `NextAuth({...})` options object in `src/auth.ts`) for one concrete reason: `authConfig` is a directly importable TypeScript object, so `config.test.ts` can assert `authConfig.trustHost === true` with zero mocking. `src/auth.ts` exports only the NextAuth result (`handlers`, `auth`, `signIn`, `signOut`, `unstable_update`), not the raw config — there is no testable surface there without reaching into NextAuth internals.

The edge-runtime note in `config.ts` is unaffected: `trustHost` is a declarative property with no node-only import, so it is safe on the Edge runtime. The edge proxy (`proxy.ts`) doesn't execute OAuth callbacks and is indifferent to the flag — it is present because `authConfig` is the shared base, not because the proxy needs it.

### Code vs Env rationale

| Factor | Code (`trustHost: true`) | Env (`AUTH_TRUST_HOST=true`) |
|--------|--------------------------|------------------------------|
| Fork-and-go audience | Works with zero env config | Requires deployer to discover and set the var before the production failure |
| fpcw production incident | Proven fix (`e47322a`) | Would have required the deployer to know the var existed |
| Security posture | Same as Vercel's auto-trust via `VERCEL` env | Same — Vercel doesn't require the deployer to opt in either |
| Proxy hygiene assumption | Must set Host header correctly | Identical assumption |
| Env override available | Yes — `AUTH_URL` or `AUTH_TRUST_HOST` still work as alternatives | N/A |

The starter's explicit goal is "fork-and-go." An env-only fix requires deployers to read the right docs section before shipping — the fpcw incident proves that does not happen reliably. The code-level fix mirrors the security posture Vercel itself accepts (auto-trusting via an env signal the platform sets, not one the deployer sets).

### Deployment assumption

The reverse proxy terminating TLS must set the `Host` header from the public hostname. This is standard behaviour for nginx, Caddy, Cloudflare (proxy and Tunnel), Kinsta, Railway, Fly.io, Render, and any other well-configured proxy. A misconfigured proxy that passes the internal hostname creates a host-header injection risk — but that same misconfiguration breaks OAuth URL construction regardless of this flag. The code comment at the config site names this assumption explicitly.

### What is NOT changed

- No permission, flag, schema, or session/JWT semantic change.
- No new npm dependency.
- The `AUTH_URL` env var continues to act as an independent `trustHost` signal — deployers who set `AUTH_URL=https://myapp.com` in production get the same effect via NextAuth's env detection. The `.env.example` comment is strengthened to make this explicit.

### Alternatives rejected

- **`AUTH_TRUST_HOST=true` env-only:** Rejected. Requires deployer awareness before the production failure. Contradicts the fork-and-go goal.
- **`AUTH_URL` comment strengthening only:** Partial mitigation. Covers deployers who correctly set `AUTH_URL`; does not cover those who leave it at the default (common since v4 `NEXTAUTH_URL` muscle memory).
- **Placing `trustHost` in `src/auth.ts`:** Rejected. No testable surface without mocking NextAuth internals.

### Impact

- `src/lib/auth/config.ts`: add `trustHost: true` with a multi-line comment naming the off-Vercel rationale and the security assumption.
- `src/lib/auth/config.test.ts`: add one assertion — `expect(authConfig.trustHost).toBe(true)`.
- `.env.example`: strengthen the `AUTH_URL` comment; add a commented `AUTH_TRUST_HOST` line documenting the env-only alternative.

---

## DECISION-015: `signIn` callback — drop credentials belt-and-suspenders lookup; OAuth gate uses email key

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-oauth-first-signin-accessdenied` (BUG-3)

### Decision

Two sub-decisions bundled because they shape the same extracted gate function:

**1. Drop the credentials double-check in `signIn`.**
The current `signIn` callback performs a `db.query.users.findFirst({ where: eq(users.id, user.id) })` for all providers, including credentials. For credentials sign-ins this is redundant: `authorize()` already looks up the user by email, checks `!user.isActive`, and returns `null` (causing NextAuth to short-circuit before calling `signIn`) if the user is inactive. By the time `signIn` is invoked for a credentials user, `authorize()` has already validated the user and returned their real DB UUID as `user.id`. The extra lookup adds a round-trip that produces no new information. The gate function for the credentials branch returns `true` unconditionally.

Defense-in-depth is preserved by two other mechanisms: (a) `authorize()` itself checks `isActive` before returning; (b) the stale-JWT check in the `jwt` callback re-reads `isActive` on every subsequent request and returns `{}` (signout) if the row has been deactivated.

**2. OAuth branch uses verified email as the lookup key.**
Auth.js v5 runs the `signIn` callback before the adapter creates a new user row. On a first-time Google sign-in, `user.id` is Google's `sub` string (not a DB UUID), so an id-keyed lookup always misses. The fix keys the OAuth lookup off `user.email` (which Google verifies at token issuance). Logic: no row → allow (adapter will create); row with `isActive = true` → allow; row with `isActive = false` → deny.

The extracted gate function (`src/lib/auth/sign-in-gate.ts`) takes the provider name and an injected `findUserByEmail` dependency so all four branches are unit-testable without a real database.

### Deletion strategy constraint

The email-keyed gate is only sound as long as deactivated user rows remain in the database. The starter's mandated deletion strategy is **soft deactivation (`isActive = false`)** — hard-delete is prohibited. The delete-account stub (`src/app/(account)/account/actions.ts:279`) must document this constraint when it is implemented. If a future implementer chooses hard-delete, an additional guard (e.g. a `deleted_emails` blocklist) is required alongside the email-keyed check.

### Alternatives rejected

- **Keep the credentials double-check:** Rejected because it is a dead round-trip with no safety benefit beyond what `authorize()` and the JWT stale check already provide. "Belt and suspenders" is not a free call on every credentials sign-in.
- **Inline fix in `src/auth.ts` (explore.press minimal approach):** Viable but not unit-testable without mocking the Drizzle `db` object directly, which is fragile. The extracted DI'd gate follows the `safe-callback.ts` precedent already established in `src/lib/auth/`.

### Impact

- Adds `src/lib/auth/sign-in-gate.ts` with `evaluateSignIn(provider, user, findUserByEmail)`.
- Adds `src/lib/auth/sign-in-gate.test.ts` with four unit tests.
- `src/auth.ts` `signIn` callback: replace the current 8-line id-keyed lookup with a single `evaluateSignIn(...)` call.

---

## DECISION-014: Keep `drizzle-orm/neon-http`; `db.batch()` is the project convention for atomic multi-write

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-verify-email-neon-http-transaction` (BUG-1)

### Decision

The DB connection (`src/lib/db/index.ts`) stays on `drizzle-orm/neon-http`. The fix for the `db.transaction()` call in the verify-email page uses `db.batch([...])`, and `db.batch()` is codified as the project-wide convention for any group of writes that must be atomic.

### Rationale

1. **Switching drivers is an architectural decision, not a bug fix.** Migrating from `neon-http` to `neon-serverless` would enable `db.transaction()`, but it changes the connection model (WebSocket vs. HTTP), affects cold-start latency, and requires a separate pooling configuration review. That work belongs in its own pipeline entry, not inside a bug fix for a single page.

2. **`db.batch()` is a correct and proven solution.** Neon executes all statements in a `db.batch()` call as a single server-side transaction — atomicity is fully preserved. The explore.press fork resolved an identical class of defect with `db.batch()` in commit `d55a165` and the fix has been running in production since 2026-06-19.

3. **`neon-http` is the right default for the starter's serverless target.** The starter ships Vercel-ready. HTTP-based connections work without WebSocket support (which some edge runtimes restrict) and need no persistent connection management. The serverless driver is the correct pick for the majority of fork deployments.

4. **Documenting the constraint as a convention prevents recurrence.** The admin actions file (`src/app/(admin)/admin/users/[id]/actions.ts:74-76`) already contains a prose comment about the constraint. Adding it to `docs/decisions.md` elevates it from a local comment to a searchable project rule.

### Convention going forward

When two or more writes must be atomic and no write depends on a mid-batch intermediate result, use:

```typescript
await db.batch([
  db.update(table).set({ ... }).where(...),
  db.delete(otherTable).where(...),
  db.insert(auditEvents).values({ ... }),
] as unknown as Parameters<typeof db.batch>[0]);
```

The `as unknown as Parameters<typeof db.batch>[0]` cast is required because Drizzle's batch type parameter is strict about element types; the double-cast is the minimal workaround consistent with explore.press's proven pattern. If a future Drizzle version relaxes the type, the cast can be removed without functional change.

When the batch list is dynamic (variable length at runtime), build the array first then cast on the `await` call — identical pattern, same cast.

### When `db.batch()` is NOT sufficient

If write N depends on a value produced by write N-1 (e.g., an insert that returns a generated ID needed by the next insert), `db.batch()` cannot be used because a batch cannot consume its own intermediate results. In that case either: (a) pre-read the needed value before the batch, or (b) switch to `neon-serverless` for that action file. Document the exception in the action file comment.

### Alternatives Rejected

- **Switch to `drizzle-orm/neon-serverless` now:** Deferred. Correct long-term option for teams that need interactive transactions with mid-write reads, but an architectural change that deserves its own pipeline entry.
- **Sequential writes (huddleup's idempotent approach):** Viable only if each write is independently safe to retry. The verify-email page's three writes are not idempotent in the same way — a second email-update after token deletion would silently succeed. `db.batch()` is strictly safer.

### Impact

- `src/app/(email-verify)/account/verify-email/[token]/page.tsx`: `db.transaction()` → `db.batch()`.
- `src/app/(admin)/admin/users/[id]/actions.ts`: comment stays as-is (it documents why NOT to use `db.transaction()`; now also references this decision by number).

---

## DECISION-013: `sanitizeCallbackUrl` extracted to shared helper; fallback changed to `/home`

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-post-login-routing-and-e2e`

### Decision

`sanitizeCallbackUrl` was a private function in `src/app/(auth)/totp/actions.ts`. With the post-login routing feature, the same validation is needed in `src/app/(auth)/signin/page.tsx` (which was passing the raw `callbackUrl` searchParam unsanitized to `signIn()`). The function is extracted to `src/lib/auth/safe-callback.ts` so both callers share a single implementation.

The fallback return value changes from `/admin` to `/home` throughout (the new post-login landing). All existing callers that previously relied on `?? "/admin"` are updated to pass through `sanitizeCallbackUrl(raw)` with no manual fallback.

Function contract:
```typescript
// src/lib/auth/safe-callback.ts
export function sanitizeCallbackUrl(raw: string | undefined | null): string {
  if (!raw) return "/home";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}
```

### Rationale

1. **`signin/page.tsx` was unsanitized.** The sign-in page read `sp.callbackUrl` from the URL query string and passed it directly to `signIn("google", { redirectTo: ... })` and `signIn("credentials", { redirectTo: ... })`. NextAuth 5 beta.31 performs internal same-origin validation, but relying on undocumented beta internals for a security property is insufficient — particularly when the codebase already has an explicit sanitization function for exactly this class of attack.

2. **DRY over duplication.** The validation logic (reject `//` prefix, reject non-`/` prefix, fallback) would otherwise be duplicated across two callers. A shared helper is the obvious canonical location.

3. **Fallback to `/home` not `/admin`.** After this feature ships, the correct post-login landing is `/home`. A fallback to `/admin` is wrong for most users (who lack `admin.dashboard`) and would send them to `/access-pending` on an invalid callback. `/home` is the correct safe default.

### Alternatives Rejected

- **Leave `signin/page.tsx` unsanitized and rely on NextAuth's `redirectTo` validation:** Rejected because NextAuth 5 beta behavior is not specified in its changelog and may change between beta versions. Explicit sanitization is the safer and more consistent choice.
- **Inline the check in each caller:** Rejected because duplicated logic with independent fallback values would diverge on the next change.

### Impact

- Adds `src/lib/auth/safe-callback.ts`.
- `src/app/(auth)/signin/page.tsx`: import `sanitizeCallbackUrl`; replace `sp.callbackUrl ?? "/admin"` with `sanitizeCallbackUrl(sp.callbackUrl)`.
- `src/app/(auth)/totp/actions.ts`: remove local `sanitizeCallbackUrl` function; add import from shared location.
- `src/app/(auth)/totp/page.tsx`: replace `sp.callbackUrl ?? "/admin"` with `sanitizeCallbackUrl(sp.callbackUrl)`; add import.

---

## DECISION-012: Member home route group, global nav placement, and post-login landing invariant

**Status:** Resolved
**Date:** 2026-07-01
**Feature:** `2026-07-01-post-login-routing-and-e2e`

### Decisions

**1. Member home route:** `src/app/(member)/home/page.tsx` with a group-level layout at `src/app/(member)/layout.tsx`.

The `(member)` route group is the home for authenticated member-facing pages that are not part of the admin shell or the account settings area. `/home` is the only route in the group initially; the group name signals that future member-facing pages (a notifications page, a billing summary, etc.) belong here rather than in `(admin)` or `(account)`.

Alternatives rejected:
- Top-level `src/app/home/page.tsx` with no route group: possible but provides no layout seam to attach the global nav without the nav bleeding into unrelated routes.
- `(app)` as the group name: rejected — "app" is ambiguous in a Next.js context (`src/app/` already IS the app directory). `(member)` is explicit about the audience.

**2. Global nav component:** `src/components/shared/global-nav.tsx` — a Server Component.

Rendered only inside `src/app/(member)/layout.tsx`. It does NOT appear in:
- The root layout (`src/app/layout.tsx`) — that would bleed into signin, access-pending, and public pages.
- The admin shell layout (`src/app/(admin)/admin/layout.tsx`) — admin has its own sidebar nav; double-nav is wrong.
- The account layout (`src/app/(account)/layout.tsx`) — account has its own sidebar nav.

Server/client split: the global nav is a pure Server Component. It receives the session object from the parent layout (which calls `auth()`) and renders the conditional Admin link server-side by checking `session.user.features?.includes(FEATURES.ADMIN_DASHBOARD)`. No `useSession()` needed. No client component needed. Sign-out is implemented as an inline `"use server"` form action, identical to the pattern already used in `(admin)/admin/layout.tsx` and `(account)/layout.tsx`.

**3. `proxy.ts` changes:** None required for route protection. `/home` is not in `PUBLIC_PATHS` and not in `PROTECTION_RULES`, so it falls through to the auth-only block (line 65-77 of `proxy.ts`). Only change: update the comment at line 76 to include `/home` in the list of documented auth-only routes.

**4. Post-login landing invariant:** The default `callbackUrl` in `src/app/(auth)/signin/page.tsx` and the fallback in `src/app/(auth)/totp/actions.ts` must both change from `/admin` to `/home`. This is a load-bearing invariant: any future code that hard-codes `/admin` as a post-auth destination is wrong unless the user specifically requested the admin area. Documenting as an explicit starter invariant in CLAUDE.md.

**5. `(account)/layout.tsx` sidebar:** The "← Home" link currently points to `/`. After this feature, it should point to `/home` (the post-login landing). Tech-lead must update this link.

**6. `access-pending/page.tsx`:** Should gain a link back to `/home` after this feature ships, so users who are bounced to access-pending have an escape route. Not a blocker but must be addressed in Phase 4.

### Invariants not changed

- No new npm dependencies. Confirmed unnecessary.
- No schema change.
- The 2FA gate does not apply to `/home`. This is intentional — `proxy.ts` only enforces `twoFactorRequired && !twoFactorVerified` for `isAdminRoute` paths. The decision to NOT gate the member home behind 2FA must be stated explicitly in the Phase 3 design doc so forks that want site-wide 2FA know where to add the check.

### CLAUDE.md updates (tech-lead must carry into Phase 3)

- Project Layout section: add `(member)/home/` entry.
- Key Invariants section: add "Post-Login Landing = /home" invariant, including the proxy fall-through note.

---

## DECISION-011: Repository renamed from `claudecode` to `claudecode-nextjs-starter`

**Status:** Resolved
**Date:** 2026-05-19

**Decision:** Renamed the canonical repository from `github.com/chenson42/claudecode` to `github.com/chenson42/claudecode-nextjs-starter`.

**Rationale:** The original name had three problems:

1. **Trademark adjacency.** "Claude Code" is Anthropic's product name. A repo called `claudecode` reads as either official or as squatting — neither is intended. The new name contextualizes the brand-signal as "Next.js starter for Claude Code workflows" rather than "is Claude Code."
2. **Opacity.** A user landing on `chenson42/claudecode` had no idea what the artifact is. The new name describes it.
3. **Aging.** If Anthropic renames its product, the old repo name becomes stale; the new name still reads sensibly because "Next.js starter" carries the artifact identity.

**Alternatives considered:** `agent-sdlc-starter`, `phase-gate-starter`, `agent-pipeline-starter` — all rejected because they buried the "Claude Code" signal entirely, which would hurt discoverability for the intended audience (people searching for Claude Code workflows in a Next.js context). The chosen name balances keeping the searchable brand-signal while no longer reading as a product-name claim.

**Impact:**

- All in-repo references to `chenson42/claudecode` updated to `chenson42/claudecode-nextjs-starter` (skills, decisions, work-logs, README, deck, package.json `name`).
- `package.json` `name` field changes from `claudecode-starter` to `claudecode-nextjs-starter`. The `personalize-starter` skill's "is this still the canonical starter?" marker is updated accordingly.
- `DECISION-009`'s hardcoded `CANONICAL_URL` constant is updated; the architectural call from `DECISION-009` (hardcode rather than read from `package.json`) is unchanged.
- GitHub auto-redirects `chenson42/claudecode` → `chenson42/claudecode-nextjs-starter` forever, so existing clones, commit references, and external links keep working. The repo rename itself is a separate manual operation (via `gh repo rename` or GitHub web UI) that the user runs.

**Tradeoff:** Any future Anthropic product rename re-opens the question. The hedge is that the artifact identity ("Next.js starter") doesn't depend on the brand-signal, so a future rename would be a smaller delta than this one.

---

## DECISION-010: Commit-message standard — hook delivery, script placement, grandfather cutoff, MTTR scope

**Status:** Resolved
**Date:** 2026-05-18

Four sub-decisions bundled because they are interdependent:

1. **Hook delivery:** `scripts/install-hooks.sh` invoked via the `prepare` npm lifecycle script — no new dependency. The starter's strong preference against unnecessary packages rules out `husky` when a 10-line shell script achieves the same result. `prepare` runs on `npm install`, giving forks automatic installation on clone. The shell script is committed to `scripts/` and symlinks (or copies) the hook into `.git/hooks/commit-msg`.

2. **Hook validator placement:** `scripts/commit-msg.mjs` — a Node ESM script matching the `check-audit-coverage.mjs` precedent already in `scripts/`. This allows the validator and `stats:escape` to share a common message-parsing helper in the same file or a co-located `scripts/commit-msg-parse.mjs`. Inline shell validation is rejected: regex in bash is brittle and the error-message requirements (name the specific missing field) are easier to satisfy in Node.

3. **`stats:escape` output:** stdout only. `scripts/stats-escape.mjs` prints to stdout; the tech-lead pipes it into the work-log manually. A file output (`docs/reviews/stats-escape-latest.md`) would need cleanup logic, a gitignore entry, or a commit every retrospective. Stdout is simpler and consistent with `check-audit-coverage.mjs`.

4. **Grandfather cutoff:** the date the feature ships (2026-05-18). No grace period. The cutoff is printed in the output header on every `stats:escape` run so the first retrospective number is honest. **MTTR deferred** to a follow-up work-log. No `Fixes-Bug:` trailer in this iteration; the escape-rate breakdown is the deliverable.

**Impact:** Adds `scripts/commit-msg.mjs`, `scripts/install-hooks.sh`, `scripts/stats-escape.mjs`. Adds `prepare` entry to `package.json`. Adds "Commit Message Standards" section to `CLAUDE.md`. Adds a cross-link to `.claude/agents/tech-lead.md`. Updates per-phase status in work-log.

---

## DECISION-009: Upstream-sync canonical URL — hardcoded in skill, not read from package.json

**Status:** Resolved
**Date:** 2026-05-18

**Decision:** The canonical starter URL (`https://github.com/chenson42/claudecode-nextjs-starter`) is hardcoded as a constant inside `.claude/skills/upstream-sync/SKILL.md`. It is NOT read from `package.json`.

**Rationale:** `package.json` in this project has no `repository` field (confirmed by grep). Requiring forks to populate `package.json` to make fork-detection work would be a silent failure mode — most forks won't know to add it. The hardcoded URL is inspectable inside the skill file itself, and a fork that deliberately wants to change the upstream target would edit the skill anyway. The alternative (reading from some config field) adds a new convention that nothing else in the project uses.

**Tradeoff:** If the canonical repo ever moves (org rename, repo rename), every fork's skill file would need to be updated. This is acceptable because repo moves are rare and the skill is the one file you'd update anyway.

**Impact:** Phase 4 sets `CANONICAL_URL = "https://github.com/chenson42/claudecode-nextjs-starter"` in the skill's pre-flight section. Trailing `.git` is stripped from `git remote get-url origin` output before comparison.

---

## DECISION-008: Upstream-sync review — skill placement, state file, cadence, and agent owner

**Status:** Resolved
**Date:** 2026-05-18

**Decision:** Four sub-decisions bundled here because they are all inter-dependent:

1. **Skill body:** `.claude/skills/upstream-sync/SKILL.md` — matches the single-file-per-skill convention already established by every other skill in `.claude/skills/`.

2. **State file:** `.claude/upstream-state.json` — flat, machine-readable, committed to the fork's repo (not gitignored). Shape (sketch): `{ "upstreamUrl": "...", "forkPointSha": "...", "lastSyncedSha": "...", "lastSyncedDate": "..." }`. This is simpler than parsing prose from `docs/reviews/log.md` and survives log re-formatting. No `.claude/state/` subdirectory created — a single file is sufficient and the "state directory for future files" risk is over-engineering.

3. **Cadence:** **14 days.** The two existing 7-day reviews are high-frequency by design (test coverage, retrospective). The five 30-day reviews are for slower-moving surfaces. Security patches from upstream can sit 30 days in a fork without notice; 14 days halves that exposure without adding session-start noise. `upstream-sync` is added to `docs/reviews/log.md` as `upstream-sync` (cadence: 14 days).

4. **Agent owner:** **tech-lead.** Already owns the retrospective (7-day) and documentation review (30-day). The upstream-sync review is instruction-layer work — reading release notes and commit classifications — which is directly analogous to the documentation review. A new section is appended to `tech-lead.md` under `## Ownership`. No new agent.

**Rationale summary:** Smallest footprint, consistent with existing conventions, 14-day cadence chosen for security-fix latency rather than convenience.

**Impact:** Adds `.claude/skills/upstream-sync/SKILL.md` (in Phase 4). Adds `.claude/upstream-state.json` (created by the skill on first run). Edits `docs/reviews/log.md` header bullet list (add `upstream-sync`). Edits `CLAUDE.md` `## Periodic Reviews` table (add 8th row) and changes "Seven reviews" to "Eight reviews". Edits `.claude/agents/tech-lead.md` `## Ownership` section (add upstream-sync paragraph).

---

## DECISION-007: `<FormattedDate>` lives in `src/components/shared/`, not `src/components/ui/`

**Status:** Resolved
**Date:** 2026-05-18

**Decision:** The timezone-safe date primitive is placed at `src/components/shared/formatted-date.tsx`, not inside `src/components/ui/`. The ESLint guard banning `toLocale*` outside that file uses a `no-restricted-syntax` pattern in `eslint.config.mjs` with a targeted `files` override that exempts the primitive's own path. The SSR fallback rendered inside `<time dateTime={iso}>` is the date portion of the ISO string (`YYYY-MM-DD`), marked `suppressHydrationWarning`.

**Rationale:**

1. **Placement.** `src/components/ui/` is reserved for generated shadcn/Radix primitives — the project instructions say "auto-generated; don't hand-edit." `<FormattedDate>` is hand-authored, cross-cutting (used by both `(admin)` and `(account)` surfaces), and requires `'use client'`. It belongs in `src/components/shared/`, which CLAUDE.md defines as "cross-cutting components used by both surfaces." No new top-level directory is needed.

2. **ESLint rule.** A `no-restricted-syntax` pattern in the existing `eslint.config.mjs` requires zero new dependencies and no plugin infrastructure. The pattern targets the `MemberExpression` where the property name matches `toLocaleString|toLocaleDateString|toLocaleTimeString`. A `files` override block in the same flat config exempts `src/components/shared/formatted-date.tsx`. This is the simplest mechanism consistent with the project's strong preference against new dependencies and custom infrastructure.

3. **SSR fallback.** The ISO-8601 string from the database (e.g., `2026-05-18T14:32:00.000Z`) is available server-side. Rendering the date portion (`YYYY-MM-DD`, extracted with `.toISOString().slice(0, 10)` — not a locale call) inside `<time>` gives the SSR output a stable, unambiguous placeholder that is close in character length to most formatted results. On hydration the client replaces it with the viewer's local format. `suppressHydrationWarning` is set on the `<time>` element to prevent the React warning caused by the intentional mismatch. Rendering nothing (empty string) would cause a jarring layout shift; rendering the full ISO timestamp would be confusing to end users if JS were slow.

**Impact:** Adds `src/components/shared/formatted-date.tsx`. Adds one `no-restricted-syntax` config block plus one `files` override to `eslint.config.mjs`. No new npm packages. All five call sites in `(admin)` and `(account)` switch from direct `toLocale*` calls to `<FormattedDate>`. A new Key Invariant is added to `CLAUDE.md` and a one-liner is added to `.claude/agents/ux-developer.md`.

---

## DECISION-006: Forgot-password flow uses a separate `(password-reset)` route group

**Status:** Resolved
**Date:** 2026-05-17

**Decision:** The forgot-password flow (`/forgot-password`, `/reset-password`) lives in a new `src/app/(password-reset)/` route group rather than being merged into the existing `(email-verify)` group. The two public paths are added to `PUBLIC_PATHS` in `src/proxy.ts` (no prefix exception needed — the token is a query parameter, not a path segment).

**Rationale:** `(email-verify)` owns `/account/verify-email/[token]` — an authenticated-user flow where the token-consumption page is the only unauthenticated step. The forgot-password flow is unauthenticated end-to-end, lives in a different URL namespace, and writes to a different token table. Merging them into a shared "unauthenticated tokens" group would create a brittle grouping that conflates two unrelated concerns. The `(email-verify)` group is the pattern precedent (no layout, proxy bypass) but not a shared container.

**Impact:** Adds `src/app/(password-reset)/forgot-password/page.tsx` and `src/app/(password-reset)/reset-password/page.tsx`. The `(password-reset)` group has no `layout.tsx`. Two `PUBLIC_PATHS` entries added to `src/proxy.ts`. API route handlers under `src/app/api/auth/forgot-password/route.ts` and `src/app/api/auth/reset-password/route.ts` follow the existing pattern for auth-adjacent handlers.

---

## DECISION-005: Rendered deck PDF is committed to the repo

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** `deck/slides.pdf` is checked into git and re-committed every time `deck/slides.md` changes. `deck/slides.pptx` stays gitignored.

**Rationale:** A teaching artifact needs to be downloadable from the GitHub UI by anyone — including viewers who don't have Marp installed and don't want to run a build step. PDF is the lowest-common-denominator format; PPTX is large (~7 MB), Office-specific, and easily re-rendered from the source.

**Impact:** The repo will accumulate one PDF blob per non-trivial slide edit. At ~360 KB per snapshot, this is acceptable for the first few years of the project but will need revisiting later — `git lfs` migration, periodic squash, or moving the PDF to GitHub Releases are all viable when the history gets noisy. Flag this for review at the next 30-day documentation review.

---

## DECISION-004: Track the freshest sibling project (fertilityluna) for framework versions

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** When choosing major versions for Next.js, React, NextAuth, Drizzle, Tailwind, ESLint config, and TypeScript, the starter pins to whatever the most recently active sibling project (currently `~/git/fertilityluna`) is running. That means: Next.js 16.2, React 19.2, NextAuth 5.0.0-beta.31, Drizzle 0.45.2, Tailwind v4, ESLint config Next 16.2, TypeScript 5.9, otplib v13.

**Rationale:** A starter that drifts behind the freshest production project becomes a worse template than the production project itself. By policy-aligning to fertilityluna's versions, the starter benefits from the upgrade work already done there — Tailwind v4 migration, otplib v13's repackaged API, React 19.2's compiler-friendly patterns — without the starter's author having to re-litigate each bump in isolation. This also makes onboarding from fertilityluna (or any sibling) to a new fork trivial: the dependency graphs match.

**Impact:** Tailwind config moved from `tailwind.config.ts` to CSS-based config in `src/app/globals.css` (via the `@theme` block). PostCSS now uses `@tailwindcss/postcss` instead of the v3 plugin + autoprefixer stack. The starter no longer ships a JS Tailwind config file. Periodically re-check the sibling-project versions at the 30-day dependency review and bump accordingly.

---

## DECISION-003: Permissions are distinct from feature flags

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** Maintain two separate concepts in the starter — *permissions* (per-user authorization) and *feature flags* (per-environment toggles) — backed by separate schema, separate runtime helpers, and separate admin surfaces. They will never be merged into a single mechanism.

- Permissions live in the `features` table, are bound to roles via `role_features`, and are checked at runtime with `hasFeature(session.user.features, FEATURES.KEY)`. The static catalog is `FEATURE_CATALOG` in `src/lib/permissions.ts`.
- Flags live in the `feature_flags` table and are checked with `isFlagEnabled(key)` in `src/lib/flags.ts`.

**Rationale:** The two concepts answer different questions. "Is this *user* allowed to do X?" requires per-user state and changes as users gain or lose roles. "Is feature X *turned on* for this environment?" requires environment-level state and is the right unit for staged rollouts, dark-launches, and kill switches. Conflating them — common in starters that ship only one — forces every fork to either re-implement the missing concept or distort one mechanism to do both jobs badly. Keeping them distinct from day one means downstream forks inherit a model that scales.

**Impact:** Every new gated feature in this starter (and in forks) asks both questions independently. Forks that don't need flags can ignore the flag table; forks that don't need granular permissions can use the single `admin.dashboard` feature as a coarse admin gate. Neither concept hides inside the other.

---

## DECISION-002: TOTP 2FA over WebAuthn for the starter's default factor

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** Ship TOTP (time-based one-time passwords via RFC 6238) as the second factor in the starter, with the secret encrypted at rest under `AUTH_TOTP_ENCRYPTION_KEY`, recovery codes hashed, and a trusted-device cookie for the "remember this browser" affordance. WebAuthn is *not* included in the starter.

**Rationale:** TOTP works on every device a fork's users already own (Google Authenticator, 1Password, Authy, Bitwarden, the iCloud Keychain). It requires no platform-specific UI, no attestation logic, no FIDO server. The implementation is small enough to read top-to-bottom (`src/lib/two-factor.ts`) and the admin can reset a user's enrolment with one click when a phone is lost. WebAuthn is the better second factor in the abstract, but it adds platform-specific authenticator handling, attestation policy, and a more complicated reset path that most forks don't need on day one. Forks that need WebAuthn can add it as an additional factor alongside TOTP without rewriting the starter's auth flow.

**Impact:** New users land on `/signin/totp` after their first password (or first OAuth sign-in if the user has `twoFactorRequired = true`). The TOTP secret is generated server-side, displayed once as a QR code, and stored AES-GCM-encrypted. Recovery codes are issued in the same step. The middleware enforces the 2FA gate at the edge for any route that requires it.

---

## DECISION-001: Neon Postgres with Drizzle ORM

**Status:** Resolved
**Date:** 2026-05-16

**Decision:** Use Neon as the Postgres host and Drizzle ORM as the query layer for the starter. App connections use the pooled host (`-pooler` suffix) via `@neondatabase/serverless`; Drizzle Kit uses the direct (unpooled) host for DDL.

**Rationale:** Neon's branching is the killer feature for an SDLC-focused starter — every schema change can happen on a disposable branch, tested with the seed script, and only promoted to `main` when the shape is right. Scale-to-zero keeps the cost-of-ownership for a fresh fork at effectively zero until it has traffic. The serverless driver fits Next.js route handlers, server actions, and the Edge runtime constraints without separate connection pooling code. Drizzle ORM was chosen over Prisma for three reasons: (1) the generated query layer is a thin TypeScript wrapper rather than an out-of-process binary, which means no separate `prisma generate` step in the fork's build; (2) `schema.ts` is the source of truth and is reviewed as code, not as a separate `.prisma` DSL; (3) `db:push` makes early development on a branch fast, while `db:generate` produces reviewable SQL once the schema stabilizes.

**Impact:** The fork needs two environment variables (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). The schema in `src/lib/db/schema.ts` covers NextAuth's adapter tables plus the starter's own surface (roles, features, role bindings, TOTP, recovery codes, trusted devices, feature flags, audit events, migration seeds). Migrations during early development run via `db:push`; once a fork is in production, `db:generate` + committed SQL becomes the right path.
