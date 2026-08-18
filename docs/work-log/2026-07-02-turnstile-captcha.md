# Cloudflare Turnstile (no-op until keyed) — Work Log

> **Slug:** `2026-07-02-turnstile-captcha`
> **Surface:** (auth)/signin + (password-reset)/forgot-password + server verification
> **Permission(s):** none
> **Flag(s):** TBD by analyst (env-keyed, not flag-gated, per reference)
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-07-02 |
| 2 — Architectural review | architect | complete | Approved with suggestions | 2026-07-02 |
| 3 — Technical design | tech-lead | complete | — | 2026-07-02 |
| 4 — Implementation | full-stack-developer | complete | — | 2026-07-02 |
| 5 — Verification | qa | complete | PASS | 2026-07-02 |
| 6 — Shipped vs intent | analyst | complete | SHIP IT | 2026-07-02 |

---

## Intent (2026-07-02)

Harvest Tier 2 #12 + the lockout-DoS paired mitigation. Port
fertilityluna's self-contained widget
(/Users/cshenso/git/fertilityluna/src/components/marketing/turnstile.tsx):
renders NOTHING and forms work unchanged unless NEXT_PUBLIC_TURNSTILE_SITE_KEY
is set. Scope: the widget component, server-side token verification
(siteverify call gated on TURNSTILE_SECRET_KEY — fail posture when the
verify service is down must be decided: fail-open for a starter, documented),
wiring into /signin credentials form and /forgot-password, .env.example
entries. Analyst: read the reference including its server verification if
present (or spec it fresh); interaction with rate limiting + lockout
(defense layers stack); e2e must stay green with no keys set (the no-op
path IS the starter default); auth-touching (signin page) — e2e gate.

---

## Phase 1 — Functional Refinement — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

Turnstile adds a Cloudflare bot-challenge widget to two unauthenticated forms — the credentials sign-in form and the forgot-password form — with a matching server-side token verification that is a complete no-op when no keys are configured. The critical placement decision is that verification must happen inside `authorize()` (credentials) and inside `requestPasswordReset()` (forgot-password), not only on the client form, to prevent direct POST bypass of the NextAuth credentials endpoint. The feature requires refactoring the credentials form section of the signin page from an inline Server Component server action into a `"use client"` form component to host the widget. The fail posture when siteverify is unreachable intentionally diverges from the fertilityluna reference: the starter chooses fail-open (allow through) so a Cloudflare outage never locks users out, with a one-line comment marking the fork point.

### What I did

**Pass 1 — User verbs**

Surface: Anonymous visitor (signin page + forgot-password page).

- Anonymous user fills in email + password on `/signin` (credentials form, only visible when `auth.local_login` flag is enabled)
- Turnstile widget renders below the password field (only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set)
- User completes the Turnstile challenge (typically invisible/automatic; manual challenge if Cloudflare deems it necessary)
- User submits the credentials form
- Anonymous user fills in email on `/forgot-password`
- Turnstile widget renders below the email field (only when key is set)
- User completes the Turnstile challenge
- User submits the forgot-password form

No admin surface. Google OAuth users are not challenged (Turnstile gates the credentials form only, not the OAuth redirect).

**Pass 2 — Flow audit**

Flow 1: Credentials sign-in with Turnstile enabled

- Entry: User arrives at `/signin`. `isLocalLoginEnabled()` returns true → credentials form renders. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set → widget renders below the password field.
- Step 1: Cloudflare script loads (async/defer); widget renders; challenge completes (usually automatic). Widget calls `onToken(token)` with the Cloudflare token. Hidden input in the form is populated.
- Step 2: User submits the form. Token travels with the form data.
- Step 3: Server action calls `signIn("credentials", { email, password, turnstileToken })` → NextAuth calls `authorize()`.
- Step 4 (inside `authorize()`): `verifyTurnstile(turnstileToken, ip)` → Cloudflare siteverify → returns true. Execution continues to rate limit → lockout → bcrypt.
- Success outcome: User is signed in and redirected.
- Failure (bad token / bot detected): `verifyTurnstile` returns false → `authorize()` returns null → NextAuth surfaces `CredentialsSignin` error → user sees "Wrong email or password." (existing error copy; same error as wrong password — no information leakage about why the check failed).
- Failure (widget not yet loaded / slow connection): Submit button should be disabled until token arrives. User waits for widget to fire, then submits.
- Failure (token expired before submit — user was idle ~5 min): Widget fires `expired-callback` → `onToken("")` → hidden input blanks → submit disables again → widget reloads automatically.

Flow 2: Credentials sign-in, no keys configured (e2e / default starter)

- Widget renders null. Form works exactly as today. `verifyTurnstile()` is never called (no secret key). No-op.

Flow 3: Forgot-password with Turnstile enabled

- Entry: User arrives at `/forgot-password`. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set → widget renders below the email field.
- Step 1: Widget loads and resolves token. Hidden input populated.
- Step 2: User submits. Client calls `requestPasswordReset({ email, turnstileToken })`.
- Step 3 (inside action): `verifyTurnstile(turnstileToken, ip)` → true → rate limit (5/hr by IP) → DB lookup → email send.
- Success outcome: "Check your email" view appears (existing copy, unchanged).
- Failure (bot detected): `verifyTurnstile` returns false → action returns `{ ok: false, error: "Verification failed. Please reload and try again." }` → toast error.
- Failure (siteverify unreachable while configured): fail-open → action proceeds normally.

**Pass 3 — Permissions and flags**

Permission: none. Turnstile is infrastructure, not a per-user gated feature. No new `FEATURES` key is added.

Flag: env-keyed only. The presence of `NEXT_PUBLIC_TURNSTILE_SITE_KEY` gates the client widget; the presence of `TURNSTILE_SECRET_KEY` gates server verification. Both must be set for the feature to activate. Neither key → complete no-op. One key without the other → misconfiguration that must be documented: if only the site key is set the widget renders but verification is a no-op; if only the secret is set the widget does not render (token is never present) and verification always receives an empty token, which the server treats as a pass-through when configured... actually this means the two-key dependency must be explicitly called out and both keys must be checked together. The tech-lead should rule on whether a missing-half-key case should produce a startup warning log.

Rollout plan: ship both env vars as blank in `.env.example`. Operators add keys to unlock the feature. No flag table row, no migration, no rollback action needed.

**Pass 4 — Edge cases the request didn't address**

1. **Credentials POST bypass.** The NextAuth credentials endpoint at `/api/auth/callback/credentials` accepts POST requests directly — a bot that knows the endpoint can bypass the form and never present a Turnstile token. If `verifyTurnstile` only runs on the form submission path (e.g., in a wrapper server action before calling `signIn()`), bots can call the endpoint directly. Verification must be inside `authorize()` where it runs for every credential POST regardless of origin. This is the ruling for Phase 3.

2. **Token field in Credentials definition.** The `credentials` object in `src/auth.ts` must declare a `turnstileToken` field (even if hidden from NextAuth's own UI), so the value passes through to `authorize()`. This is a one-line schema addition in the Credentials provider definition.

3. **Submit disabled until token fires.** The credentials form is currently a Server Component with an inline server action. To host the `Turnstile` client component and manage the token state, the credentials form section must be extracted into a `"use client"` component (`SignInCredentialsForm`). This is a meaningful server/client boundary change: the outer `SignInPage` remains a Server Component (still calls `isLocalLoginEnabled()`) and passes `localLoginEnabled` and `callbackUrl` as props to the client component. Architect must rule on this.

4. **Forgot-password form already is a Client Component.** The widget slots in naturally. Token state is added alongside `email` state. The server action signature gains an optional `turnstileToken` field.

5. **`consumeResetToken` is not Turnstile-gated.** The reset-password form (second step: consume token, set new password) is protected by the URL token (single-use, expiring, SHA-256 hashed at rest). Turnstile here would only add friction — the URL token is already a bot-deterrent. Confirmed out of scope.

6. **2FA mid-enrollment gate.** The Turnstile check is on the sign-in entry point only. The `/totp` TOTP verification page is post-authentication and is unaffected.

7. **Audit event.** A Turnstile rejection is not currently written to `audit_events`. The existing `RATE_LIMIT_BLOCKED` event already captures IP-level bot signal. Turnstile rejections could be logged as a future enhancement. For the starter, no new audit action is added — the rejection is silent (same as wrong-password).

**Pass 5 — Adversarial pass**

- **Direct POST to `/api/auth/callback/credentials`**: Addressed by placing `verifyTurnstile` inside `authorize()`. A bot that bypasses the form is still gated.
- **Crafted `turnstileToken` in the POST body**: The siteverify call validates the token with Cloudflare's server. A forged or replayed token is rejected. Tokens are single-use at Cloudflare's side.
- **Missing token when keys are set**: `verifyTurnstile(null)` returns false when a secret key is configured. An empty form submission is rejected before rate-limit budget is consumed — this is intentional layering.
- **TURNSTILE_SECRET_KEY exposed**: This key is server-only (`TURNSTILE_SECRET_KEY`, not `NEXT_PUBLIC_*`). It must not appear in any `NEXT_PUBLIC_*` var or be returned to the client. The reference implementation correctly marks it `server-only`.
- **Redirect parameters**: No new redirect parameters introduced. The Turnstile feature does not alter the `callbackUrl` flow.
- **State-machine shortcut**: No new gated state is introduced. Turnstile does not create a new step in a multi-step flow; it is a transparent check inside an existing form submission.

### Outputs

- Files to be created/modified (by implementer, not by analyst):
  - `src/components/shared/turnstile.tsx` — port of fertilityluna's widget; lift verbatim with attribution comment
  - `src/lib/auth/turnstile.ts` — port of fertilityluna's `lib/turnstile.ts`; fail posture changed to fail-open; `import "server-only"` guard retained
  - `src/app/(auth)/signin/credentials-form.tsx` — new client component extracted from `signin/page.tsx`
  - `src/app/(auth)/signin/page.tsx` — simplified: renders `<CredentialsForm>` client island when `localLoginEnabled`
  - `src/auth.ts` — `authorize()` gains Turnstile verification as first step; `credentials` definition gains `turnstileToken` hidden field
  - `src/app/(password-reset)/actions.ts` — `requestPasswordReset()` gains `turnstileToken` input; calls `verifyTurnstile` before rate limit
  - `src/app/(password-reset)/forgot-password/page.tsx` — adds `Turnstile` widget and token state
  - `.env.example` — two new commented entries

### Open questions / handoff notes

- **Architect:** Rule on extracting the credentials form into a client component (`SignInCredentialsForm`). The outer Server Component (calling `isLocalLoginEnabled()`) is preserved; the inner form becomes a client island. Is there a cleaner pattern that avoids this refactor?
- **Architect:** Should a half-configured state (one key set, other missing) produce a server startup warning? Or is the doc-only note sufficient?
- **Tech-lead:** Confirm `verifyTurnstile` placement at the top of `authorize()`, before the rate-limit check. The intent is to avoid consuming rate-limit budget for bot traffic.
- **Tech-lead:** Confirm the fail-open divergence from the fertilityluna reference (fertilityluna is fail-closed on network error; starter should be fail-open). Document the rationale and the one-line flip point.
- **Tech-lead:** Confirm error copy for Turnstile rejection on the forgot-password form. Current proposal: "Verification failed. Please reload and try again." On the credentials form, the existing "Wrong email or password." copy is used (Turnstile rejection is indistinguishable from wrong credentials) — this is intentional to avoid leaking the reason.
- **e2e gate confirmed:** This feature touches `src/app/(auth)/signin/` and `src/auth.ts`. Phase 5 PASS requires e2e smoke against a real dev server including MFA-enrolled user.

---

## Phase 2 — Architectural Review — 2026-07-02

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The feature's overall shape is sound — widget in shared/, server helper in lib/, verify inside authorize(). One critical cross-feature integration the analyst missed: the current CSP in next.config.ts has `frame-src 'none'` and no entry for challenges.cloudflare.com in script-src. These must be added unconditionally before Phase 3 begins or every fork that tightens to enforced CSP will silently block the Turnstile iframe. The form extraction ruling is specific: a colocated actions.ts, not inline prop-passing. All other analyst rulings are confirmed.

### What I did

**Ruling 1 — Credentials form extraction (analyst's main flag)**

The outer `SignInPage` remains a Server Component. It calls `isLocalLoginEnabled()` (async, server-only), derives `callbackUrl` via `sanitizeCallbackUrl`, renders the Google form inline (no interactivity required), and conditionally renders `<SignInCredentialsForm callbackUrl={callbackUrl} />` when `localLoginEnabled` is true.

The inner credentials form becomes `src/app/(auth)/signin/signin-credentials-form.tsx` with `'use client'` at the top. This component manages `turnstileToken` state, enables/disables the submit button, renders the `<Turnstile>` widget, and fires the server action on submit.

The inline `"use server"` action **cannot** remain inline — a `'use server'` function definition inside a `'use client'` component is a compile error. Move it to `src/app/(auth)/signin/actions.ts` (top-level `'use server'`). Export `signInWithCredentials({ email, password, turnstileToken, callbackUrl }: SignInInput): Promise<void>`. The function calls `signIn("credentials", { email, password, turnstileToken, redirectTo: callbackUrl })`. The client component passes `callbackUrl` as a plain string parameter — no closure capture needed.

This is the colocated actions.ts pattern per DECISION-021. The TOTP flow (`src/app/(auth)/totp/actions.ts`) already follows this exact shape and is the precedent to match.

The prop-passing approach (page creates the server-action closure and passes it as a prop) is technically valid in Next.js 15+ but rejected here: the `callbackUrl` closure variable would silently serialize the URL into the action — non-obvious, hard to test, and diverges from the established pattern. Explicit parameter is always clearer.

**Ruling 2 — Turnstile widget placement and script loading**

`src/components/shared/turnstile.tsx` is confirmed. The widget is consumed by `(auth)/signin` and `(password-reset)/forgot-password` — two different route groups — which is the exact criterion that places a component in `src/components/shared/` (DECISION-021).

Script loading: use `next/script` with `strategy="lazyOnload"` (or `strategy="afterInteractive"`) pointing at `https://challenges.cloudflare.com/turnstile/v0/api.js`. No npm package. The `window.turnstile` API is available once the script loads; the component guards with an `onLoad` callback before calling `window.turnstile.render(...)`. This is how the fertilityluna reference works and requires zero new dependencies.

**Ruling 2b — CSP CRITICAL (cross-feature integration the analyst missed)**

The approved DECISION-024 directive set has:

```
script-src 'self' 'unsafe-inline'
frame-src 'none'
```

The Turnstile widget does two things that this CSP would report as violations:
1. Loads a script from `https://challenges.cloudflare.com` — not in `script-src`.
2. Renders a child iframe from `https://challenges.cloudflare.com` — blocked by `frame-src 'none'`.

Because the CSP is report-only (DECISION-024), these violations do not actually break the widget at runtime — the iframe loads, the challenge completes, and violations appear in devtools only. However:
- A fork operator running the report-only output through a CSP analyzer to tighten toward enforcement will see `frame-src` as `'none'` with no Cloudflare entry, and will enforce that value — silently breaking Turnstile on their fork.
- The starter ships with the CSP reflecting its actual dependency posture. An active Turnstile integration with `frame-src 'none'` is an inaccurate picture.

**Required change (Phase 4 implementer touches next.config.ts):** Add `https://challenges.cloudflare.com` to `script-src` and change `frame-src 'none'` to `https://challenges.cloudflare.com` in `next.config.ts`. Both changes are unconditional (same posture as `lh3.googleusercontent.com` already in `img-src` — present even when Google OAuth is unused). Add a comment: `# Cloudflare Turnstile: remove these entries if not using NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

This is an addendum to DECISION-024's approved directive set. It does not warrant a new DECISION number — the DECISION-024 body already documents that domain-specific entries are the correct narrowing path. A work-log note here is the correct record.

`connect-src` does NOT need updating. The Turnstile iframe's outbound fetches are governed by the iframe's own CSP (set by Cloudflare), not the parent page's connect-src. The parent page's JavaScript does not make direct XHR/fetch to Cloudflare.

**Ruling 3 — verifyTurnstile server helper placement and fail posture**

`src/lib/turnstile.ts` with `import "server-only"` at the top: confirmed and required. This module reads `process.env.TURNSTILE_SECRET_KEY` and makes an outbound fetch to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. Neither operation is safe in a client bundle. The `server-only` guard produces a build error if the module is ever accidentally imported on the client side.

Fail-open endorsed. DECISION-026 establishes the fail-open requirement for auth-critical checks: "A flag is auth-critical if its `false` value prevents an authentication path from completing AND the flag is expected to be `true` in the vast majority of deployments." `verifyTurnstile` fits this definition exactly — a `false` return on Cloudflare network error would lock all credentials sign-ins during a Cloudflare outage. The `catch → return true` pattern is the correct starter default. The one-line flip point for fail-closed is the `return true` inside the catch block; fork operators who need fail-closed change it to `return false` with a comment.

**Ruling 4 — authorize() credentials field threading**

The `credentials` object in `src/auth.ts` (lines 97-100) currently declares `email` and `password`. NextAuth 5 beta strips any field not declared in the `credentials` object before calling `authorize()` — undeclared fields are silently dropped. Add:

```typescript
turnstileToken: { label: "Turnstile Token", type: "text" },
```

This is a one-line addition to the credentials definition. The `authorize()` function then reads `credentials?.turnstileToken as string | undefined`. When no keys are configured, `verifyTurnstile(undefined)` returns `true` immediately (no-op path). When keys are configured and the form omits the token (impossible via the legitimate form but possible via direct POST), `verifyTurnstile("")` with a configured secret returns `false` — a bot POST with no token is correctly rejected.

**Ruling 5 — No new dependencies**

Confirmed. The Turnstile widget is a `<Script>` tag pointing at Cloudflare's CDN. The server-side verification is `fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", ...)`. Zero new npm packages. This aligns with the dependency evaluation criteria — the use case is fully covered by built-in `fetch` and Next.js's `next/script`.

**Ruling on half-key misconfiguration**

A `.env.example` comment explaining that both keys must be set together is sufficient. No startup warning in production code. Reason: the feature is opt-in; operators who set one key read the comments. A `console.warn` in a server action hot path would fire on every request in misconfigured environments and pollute logs in ways that are harder to notice than a one-time comment. If the tech-lead wants a startup check, it belongs in a `next.config.ts` `webpack` callback or an initialization module — but this is a Phase 3 decision, not a Phase 2 gate.

**Ruling 6 — E2E gate**

This feature touches `src/app/(auth)/signin/page.tsx` (refactored), `src/app/(auth)/signin/actions.ts` (new), and `src/auth.ts` (`credentials` definition + `authorize()` body). All three are in the auth-touching set defined in CLAUDE.md's Phase 4 gate. Phase 5 PASS requires a running-server e2e smoke covering the full login path including an MFA-enrolled user.

The "keyless no-op green" requirement is the primary gate: the e2e suite must pass with no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` set (the default starter configuration). This verifies the no-op path doesn't break existing sign-in flows. A keyed integration test is optional stretch work.

### Outputs

- Files touched by this phase: none (read-only review).
- Decisions logged: no new DECISION entry. The CSP addendum is recorded here; DECISION-024's directive set is the governing entry. DECISION-026 is cited as the fail-open precedent.

### Open questions / handoff notes

- **Tech-lead (Phase 3):** The `next.config.ts` CSP change (script-src + frame-src for challenges.cloudflare.com) is architecturally required before the feature ships; assign it to the Phase 4 implementer alongside the turnstile widget work. This is not optional — the starter must not ship a CSP that misrepresents its iframe posture.
- **Tech-lead (Phase 3):** Confirm `verifyTurnstile` runs as the first check in `authorize()`, before the rate-limit step. Rationale: Cloudflare tokens are single-use and already validated by Cloudflare; rejecting bots before consuming rate-limit budget is the correct ordering. Rate limit then lockout then bcrypt follows, as today.
- **Tech-lead (Phase 3):** Confirm the `signInWithCredentials` function signature in `actions.ts` and the prop interface for `SignInCredentialsForm`. The `callbackUrl` threading (page → prop → action parameter) is the ruling shape; document it clearly in Phase 3 so the ux-developer and api-developer don't diverge.
- **Implementer (Phase 4):** The `forgot-password` form is already a client component (the analyst confirmed this). The Turnstile widget slots in naturally alongside existing `email` state. No form extraction is needed there — just add `turnstileToken` state and the `<Turnstile>` widget.
- **e2e gate reminder:** Phase 5 BLOCKED if e2e is not run against a live dev server with an MFA-enrolled seeded user.

---

## Phase 3 — Technical Design — 2026-07-02

**Owner:** tech-lead
**Status:** complete

### Summary

This feature extracts the credentials sign-in form from an inline Server Component server action into a colocated `actions.ts` + `'use client'` form component, adds a shared Cloudflare Turnstile widget, adds a server-only `verifyTurnstile()` helper, wires verification into `authorize()` and `requestPasswordReset()`, and updates the CSP to accurately reflect the Cloudflare iframe and script dependency. The change is a complete no-op when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are absent — the starter default. All existing sign-in flows and e2e tests must pass unchanged with no keys set. AUTH-TOUCHING: Phase 5 PASS requires a running-server e2e smoke including MFA-enrolled user.

### Permissions & Flags

- Permission key(s): none. Turnstile is infrastructure, not a per-user permission.
- Feature flag(s): none. Activated by env-var presence only. Both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` must be set together; either alone is a misconfiguration documented in `.env.example`.

### API Contract

No new API routes. Two server actions:

**`signInWithCredentials(input: SignInInput): Promise<{ error: string } | undefined>`**
- Location: `src/app/(auth)/signin/actions.ts`
- `'use server'` file-level directive
- Input: `{ email: string; password: string; turnstileToken?: string; callbackUrl: string }`
- Calls `signIn("credentials", { email, password, turnstileToken, redirectTo: callbackUrl })`
- On `NEXT_REDIRECT` (success): re-throws — Next.js framework catches and follows redirect
- On `AuthError`: catches, returns `{ error: "Wrong email or password." }` — client shows inline error and resets the widget
- On any other error: re-throws

**`requestPasswordReset(input: { email: string; turnstileToken?: string }): Promise<ActionResult>`**
- Location: `src/app/(password-reset)/actions.ts` — modifies existing export
- Adds optional `turnstileToken` field to input type
- Calls `verifyTurnstile(input.turnstileToken, ip)` immediately after resolving `ip` but before `checkRateLimit` — see Implementation Order
- On `verifyTurnstile` returning `false`: returns `{ ok: false, error: "Verification failed. Please reload and try again." }` — the one exception to the always-`{ ok: true }` enumeration-safe pattern (Turnstile failure does not reveal email existence)
- Existing `checkRateLimit` and all downstream logic unchanged

### Data Model

No schema changes required.

### Component / Page Plan

**Files to create:**

- `src/lib/turnstile.ts` — server-only `verifyTurnstile` helper
- `src/components/shared/turnstile.tsx` — `'use client'` Turnstile widget component
- `src/app/(auth)/signin/actions.ts` — `signInWithCredentials` server action
- `src/app/(auth)/signin/signin-credentials-form.tsx` — `'use client'` credentials form component
- `src/lib/turnstile.test.ts` — unit tests for `verifyTurnstile`

**Files to modify:**

- `src/app/(auth)/signin/page.tsx` — recompose: remove inline `"use server"` credentials action, render `<SignInCredentialsForm callbackUrl={callbackUrl} />` when `localLoginEnabled`
- `src/auth.ts` — add `turnstileToken` to credentials definition; add step 0.5 in `authorize()`
- `src/app/(password-reset)/actions.ts` — `requestPasswordReset` gains optional `turnstileToken`; calls `verifyTurnstile` before rate limit
- `src/app/(password-reset)/forgot-password/page.tsx` — add `turnstileToken` state + `<Turnstile>` widget; disable submit while token is empty
- `next.config.ts` — CSP: add `https://challenges.cloudflare.com` to `script-src`; change `frame-src 'none'` to `frame-src https://challenges.cloudflare.com`
- `.env.example` — two new commented entries

---

### Detailed Specifications

#### 1. `src/lib/turnstile.ts`

```typescript
import "server-only";

/**
 * Verify a Cloudflare Turnstile token server-side.
 *
 * Returns true (no-op) when TURNSTILE_SECRET_KEY is not configured — the
 * starter default. Forms work unchanged with no keys set.
 *
 * Fail-open posture (DECISION-026): a Cloudflare outage returns true so users
 * are never locked out by a third-party infrastructure failure.
 * Fork operators who need fail-closed: change `return true` in the catch block
 * to `return false`.
 */
export async function verifyTurnstile(
  token: string | undefined | null,
  ip?: string | null,
): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) return true;      // no-op when unconfigured
  if (!token) return false;         // no token when configured = bot or bypass attempt

  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (ip) body.append("remoteip", ip);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch {
    // Fail-open: see DECISION-026. Change to `return false` for fail-closed.
    return true;
  }
}
```

Note: the Cloudflare siteverify API uses `{ success: boolean }` (not `{ ok: boolean }`) in its response. The unit tests should mock this shape.

#### 2. `src/components/shared/turnstile.tsx`

`'use client'` component. Renders null when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is not set (env var evaluated at module load time — safe in `'use client'`).

Interface:
```typescript
interface TurnstileProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  className?: string;
}
```

Implementation notes:
- Loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` via `next/script` with `strategy="lazyOnload"`.
- Renders a `<div ref={containerRef} />` as the widget mount point.
- In the script's `onLoad` callback: calls `window.turnstile.render(containerRef.current, { sitekey, callback, "expired-callback", "error-callback" })`. The widget id returned is stored in a ref.
- `expired-callback`: calls `props.onExpire?.()` then calls `props.onVerify("")` to blank the token (re-disables submit).
- `error-callback`: calls `props.onError?.()` then calls `props.onVerify("")`.
- `useEffect` cleanup: calls `window.turnstile?.remove(widgetId)` on unmount.
- The component does NOT render a hidden input — the token is managed as React state in the parent form component.
- Declare `window.turnstile` type stub in a `.d.ts` or inline cast to avoid TypeScript errors.

#### 3. `src/app/(auth)/signin/actions.ts`

New file with `'use server'` directive at top.

```typescript
"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export interface SignInInput {
  email: string;
  password: string;
  turnstileToken?: string;
  callbackUrl: string;
}

export async function signInWithCredentials(
  input: SignInInput,
): Promise<{ error: string } | undefined> {
  try {
    await signIn("credentials", {
      email: input.email,
      password: input.password,
      turnstileToken: input.turnstileToken ?? "",
      redirectTo: input.callbackUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // CredentialsSignin, etc. — return friendly error; do not re-throw.
      return { error: "Wrong email or password." };
    }
    // NEXT_REDIRECT and unknown errors must propagate.
    throw err;
  }
}
```

This is the same shape as `src/app/(auth)/totp/actions.ts` (the established precedent per Phase 2 Ruling 1).

#### 4. `src/app/(auth)/signin/signin-credentials-form.tsx`

`'use client'` component. Props: `{ callbackUrl: string }`.

State: `email`, `password`, `turnstileToken` (string, initially `""`), `error` (string | null), `isPending` (boolean via `useTransition`).

Submit handler: calls `signInWithCredentials({ email, password, turnstileToken, callbackUrl })`. If result has `error`, sets `error` state and calls the Turnstile component's reset path (by resetting `turnstileToken` to `""` and relying on the Turnstile widget's `onExpire`/`onError` to re-enable once a new token arrives — or implement a `resetRef` pattern if explicit reset is needed).

Submit button disabled when: `!email || !password || (siteKeySet && !turnstileToken) || isPending`.

`siteKeySet` is `!!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` — evaluated at module scope (accessible in `'use client'`).

Inline error paragraph (styled like existing `?error=CredentialsSignin` paragraph) replaces the URL-based error display for form submission errors. The page-level `{sp.error === "CredentialsSignin" && ...}` in `page.tsx` is retained for direct URL visits with error params (e.g., user bookmarked `/signin?error=CredentialsSignin`).

Place the `<Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken("")} onError={() => setTurnstileToken("")} />` below the password field and above the submit button.

The "Forgot password?" link and the "First time? Run db:seed" note move into this component.

#### 5. `src/app/(auth)/signin/page.tsx` — recomposition

The outer page remains a Server Component. Changes:
- Remove the inline `"use server"` credentials form action and the credentials `<form>` block entirely.
- Import `SignInCredentialsForm` from `./signin-credentials-form`.
- Where `{localLoginEnabled && (<> ... </>)}` currently renders the credentials form, render `<SignInCredentialsForm callbackUrl={callbackUrl} />` instead.
- The Google OAuth form (inline `"use server"` action) remains inline — no change.
- The `sp.error === "deactivated"` and `sp.error === "CredentialsSignin"` error blocks remain at the page level (they handle URL-based error params on page load, which is still a valid path for deactivated users and any tooling that links directly to `/signin?error=...`).

#### 6. `src/auth.ts` — credentials definition and `authorize()` changes

**Credentials definition** (lines 96–100): add one field:
```typescript
credentials: {
  email: { label: "Email", type: "email" },
  password: { label: "Password", type: "password" },
  turnstileToken: { label: "Turnstile Token", type: "text" },   // NEW
},
```
Without this declaration, NextAuth 5 beta silently drops `turnstileToken` from the object passed to `authorize()`.

**`authorize()` — new step 0.5:**

The full ordering after this change:
```
Step 0:   isLocalLoginEnabled() — flag check; return null if disabled (no budget consumed)
Step 0.5: verifyTurnstile(credentials?.turnstileToken, ip) — NEW; return null if false
          [ip is extracted here, shared with step 1]
Step 1:   checkRateLimit — consumes rate-limit budget only after bot is cleared
Step 2:   DB lookup + isActive check
Step 3:   lockout check
Step 4:   bcrypt compare
Step 4b:  on failure — increment failedLoginAttempts (conditionally set lockedUntil)
```

Implementation delta:
```typescript
// After: const localLoginEnabled = await isLocalLoginEnabled(); if (!localLoginEnabled) return null;

// Extract IP early — used by both verifyTurnstile (optional hint) and checkRateLimit (key)
const ip = getRequestIp(
  (request as Request | undefined)?.headers ?? new Headers(),
);

// Step 0.5: Turnstile verification — before rate limit so bot traffic does not consume budget.
// Fail-open when TURNSTILE_SECRET_KEY is unset (the starter default).
const turnstileOk = await verifyTurnstile(
  credentials?.turnstileToken as string | undefined,
  ip,
);
if (!turnstileOk) return null; // surfaces as CredentialsSignin — no leakage

// Rate limit: 5/min keyed by ip:email composite.
const limited = await checkRateLimit(
  `signin:${ip ?? "unknown"}:${email}`,
  ...
);
```

Remove the existing `const ip = getRequestIp(...)` line from just before `checkRateLimit` (it moves to before step 0.5).

Add import: `import { verifyTurnstile } from "@/lib/turnstile";`

#### 7. `src/app/(password-reset)/actions.ts` — `requestPasswordReset`

Input type change:
```typescript
export async function requestPasswordReset(input: {
  email: string;
  turnstileToken?: string;      // NEW — optional; absent when keys not configured
}): Promise<ActionResult>
```

Inside the action, immediately after resolving `ip`:
```typescript
// Turnstile check — before rate limit so bot traffic does not consume IP budget.
// Returns true (no-op) when TURNSTILE_SECRET_KEY is not configured.
const captchaOk = await verifyTurnstile(input.turnstileToken, ip);
if (!captchaOk) {
  return { ok: false, error: "Verification failed. Please reload and try again." };
}
```

Then the existing `checkRateLimit` call follows unchanged. All downstream logic (user lookup, token mint, email send, audit event) unchanged.

Add import: `import { verifyTurnstile } from "@/lib/turnstile";`

#### 8. `src/app/(password-reset)/forgot-password/page.tsx`

Already `'use client'` (confirmed from source). Changes:
- Add `const [turnstileToken, setTurnstileToken] = useState<string>("")`
- Import `Turnstile` from `@/components/shared/turnstile`
- Add `const siteKeySet = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` at module scope
- Add `<Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken("")} onError={() => setTurnstileToken("")} />` below the email input and above the submit button
- Disable submit: `disabled={isSubmitting || (siteKeySet && !turnstileToken)}`
- Pass `turnstileToken` to the action: `await requestPasswordReset({ email: email.trim(), turnstileToken })`
- After successful submit, reset token state (not needed — the success view renders instead of the form)
- After failed submit with Turnstile error (toast.error), reset `turnstileToken` to `""` so the widget refires

#### 9. `next.config.ts` — CSP

Modify the `Content-Security-Policy-Report-Only` value string (line 39). Two targeted changes:

1. In `script-src`: append `https://challenges.cloudflare.com` after `'unsafe-inline'`
2. Change `frame-src 'none'` to `frame-src https://challenges.cloudflare.com`

New full value:
```
"default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
```

Add an inline comment on the `connect-src` line (or in the block comment) explaining why `connect-src` does NOT include Cloudflare: the Turnstile iframe's outbound fetch is governed by the iframe's own CSP (set by Cloudflare), not the parent page's `connect-src`. Parent JS does not XHR to Cloudflare directly.

Add the removable-if-unused comment per Phase 2 Ruling 2b:
```
// Cloudflare Turnstile: remove https://challenges.cloudflare.com from script-src
// and restore frame-src 'none' if not using NEXT_PUBLIC_TURNSTILE_SITE_KEY.
```

#### 10. `.env.example` entries

Add near the auth section:
```
# Cloudflare Turnstile (optional — bot challenge widget on /signin and /forgot-password)
# Both keys must be set together. Leave blank to keep forms working with no challenge (starter default).
# Get keys at https://dash.cloudflare.com/ → Turnstile. Use "localhost" as allowed origin for dev.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

### Implementation Order

1. `src/lib/turnstile.ts` — server helper; standalone; testable immediately
2. `src/lib/turnstile.test.ts` — unit tests (see Tests section below); run before wiring
3. `src/components/shared/turnstile.tsx` — widget component
4. `src/app/(auth)/signin/actions.ts` — server action (depends on nothing new)
5. `src/app/(auth)/signin/signin-credentials-form.tsx` — client form (depends on actions.ts + widget)
6. `src/app/(auth)/signin/page.tsx` — recompose (depends on client form)
7. `src/auth.ts` — add `turnstileToken` credential field + step 0.5 (depends on turnstile.ts)
8. `src/app/(password-reset)/actions.ts` — add `turnstileToken` param + call (depends on turnstile.ts)
9. `src/app/(password-reset)/forgot-password/page.tsx` — add widget + token state
10. `next.config.ts` — CSP update (independent; can be done at any point)
11. `.env.example` — new entries
12. Verify: `npm run typecheck` + `npm run test` (unit tests green) + `npm run test:e2e` (keyless no-op green)

### Edge Cases & Risks

- **NEXT_REDIRECT handling in `signInWithCredentials`:** `NEXT_REDIRECT` is not an `instanceof AuthError` — it must propagate via `throw err` in the catch clause. If this is accidentally caught and swallowed, redirects break silently. The implementation must re-throw anything that is not an `AuthError`.

- **`turnstileToken` credential field and NextAuth's own UI:** NextAuth 5 beta may render an auto-generated sign-in form that shows the `turnstileToken` field as a text input. This is acceptable since the starter does not use the NextAuth auto-form. If the auto-form becomes visible for any reason (e.g., `/api/auth/signin`), this field appears — add `type: "hidden"` to the credential definition to suppress it in the auto-form.

- **One-key misconfiguration:** If only `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set: widget renders and fires a token, but `verifyTurnstile()` returns `true` (no secret key → no-op). If only `TURNSTILE_SECRET_KEY` is set: widget renders null, token is never sent, `verifyTurnstile(undefined)` returns `false` when a secret key is configured — credentials sign-in is broken. The `.env.example` comment addresses this, but a startup warning is not added (Phase 2 Ruling).

- **Turnstile script + React StrictMode double-render:** In development, React StrictMode runs effects twice. The widget's `useEffect` may call `window.turnstile.render()` twice. Guard with `if (widgetIdRef.current) return;` before the render call, and clean up with `window.turnstile?.remove(widgetIdRef.current)` in the cleanup function.

- **`form-action 'self'` and Turnstile iframes:** The Turnstile iframe submits to Cloudflare's servers, not to `'self'`. `form-action` governs where `<form>` tags on the parent page can submit — it does not apply to forms inside child iframes. No change to `form-action` is needed.

### Tests

**Unit tests — `src/lib/turnstile.test.ts`:**

Uses `vi.stubGlobal("fetch", ...)` or `vi.fn()` to mock global fetch. Note Cloudflare siteverify returns `{ success: boolean }` (not `{ ok: boolean }`).

| Test | Setup | Expected |
|------|-------|----------|
| No secret key, token undefined | `delete process.env.TURNSTILE_SECRET_KEY` | `true` (no-op) |
| No secret key, token provided | `delete process.env.TURNSTILE_SECRET_KEY` | `true` (no-op) |
| Secret key set, token undefined | `process.env.TURNSTILE_SECRET_KEY = "s"` | `false` (no token = bot) |
| Secret key set, token empty string | `process.env.TURNSTILE_SECRET_KEY = "s"` | `false` |
| Secret key set, siteverify returns `{ success: true }` | mock fetch | `true` |
| Secret key set, siteverify returns `{ success: false }` | mock fetch | `false` |
| Secret key set, fetch throws | mock fetch to throw | `true` (fail-open) |
| With IP hint | mock fetch, check `remoteip` in URLSearchParams | `true` + `remoteip` sent |

**E2e gate:** Existing e2e suite (`npm run test:e2e`) must pass with no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` set. This is the primary Phase 5 gate for this feature. A keyed integration test (real Cloudflare test keys) is out of scope for the starter.

### Outputs

- New files: `src/lib/turnstile.ts`, `src/lib/turnstile.test.ts`, `src/components/shared/turnstile.tsx`, `src/app/(auth)/signin/actions.ts`, `src/app/(auth)/signin/signin-credentials-form.tsx`
- Modified files: `src/app/(auth)/signin/page.tsx`, `src/auth.ts`, `src/app/(password-reset)/actions.ts`, `src/app/(password-reset)/forgot-password/page.tsx`, `next.config.ts`, `.env.example`
- Decisions: no new DECISION entry. DECISION-026 (fail-open) is the governing entry for `verifyTurnstile`'s catch-block posture. The CSP change is an addendum to DECISION-024's directive set.

### Open questions / handoff notes

- Implementer: **full-stack-developer** — this feature spans server lib, client widget, server actions, RSC recomposition, and config. Splitting would create unnecessary handoff.
- AUTH-TOUCHING: Phase 5 PASS requires `npm run test:e2e` against a live dev server with an MFA-enrolled seeded user. A keyless-no-op green result is the required gate.
- The `signInWithCredentials` catch clause must re-throw non-`AuthError` errors (especially `NEXT_REDIRECT`). The implementer should verify this with a sign-in happy-path test first.
- The Turnstile widget's `window.turnstile` global is not typed by default. Add a minimal `.d.ts` stub (`interface Window { turnstile?: { render(...): string; remove(id: string): void } }`) or cast with `as any` in the widget component. Prefer the stub.

---

## Phase 4 — Implementation (full-stack) — 2026-07-02

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented all Phase 3 deliverables in order: server-only `verifyTurnstile()`, `Turnstile` client widget, `signInWithCredentials` server action, `SignInCredentialsForm` client component, signin page recomposition, `auth.ts` credentials field + step 0.5, `requestPasswordReset` turnstile param, forgot-password widget wiring, CSP update, and `.env.example` entries. One lint deviation from Phase 3: the "latest value ref" pattern (`ref.current = value` during render) is banned by the project's `react-hooks/refs` ESLint rule; resolved by syncing refs via `useEffect`. All 9 unit tests and 34 e2e tests pass with no keys configured.

### What I did

- Created `src/lib/turnstile.ts` — server-only `verifyTurnstile(token, ip?)` with fail-open posture (DECISION-026); returns true immediately when `TURNSTILE_SECRET_KEY` is unset; returns false for missing token when key is set; catches fetch errors and returns true.
- Created `src/lib/turnstile.test.ts` — 9 unit tests covering: no-key/undefined, no-key/token, keyed/undefined, keyed/null, keyed/empty, keyed/success, keyed/false, keyed/throw (fail-open), IP hint threading via URLSearchParams assertion.
- Created `src/components/shared/turnstile.tsx` — `'use client'` widget using `next/script` with `strategy="lazyOnload"`; explicit render via `window.turnstile.render()`; StrictMode-safe `widgetIdRef`; prop refs synced via `useEffect` (not during render per ESLint rule); cleanup on unmount.
- Created `src/app/(auth)/signin/actions.ts` — `signInWithCredentials` server action following totp/actions.ts precedent; re-throws `NEXT_REDIRECT`, returns `{ error }` on `AuthError`.
- Created `src/app/(auth)/signin/signin-credentials-form.tsx` — `'use client'` form with `email`/`password`/`turnstileToken` state and `useTransition`; embeds `<Turnstile>`; submit disabled until token fires (when `siteKeySet`); inline error paragraph on auth failure.
- Modified `src/app/(auth)/signin/page.tsx` — removed inline `"use server"` credentials action; renders `<SignInCredentialsForm callbackUrl={callbackUrl} />`; Google form and URL-error paragraphs unchanged.
- Modified `src/auth.ts` — added `turnstileToken: { label: "Turnstile Token", type: "hidden" }` to credentials definition; moved IP extraction before rate limit; added step 0.5 `verifyTurnstile` call after `isLocalLoginEnabled` and before `checkRateLimit`; added `import { verifyTurnstile }` from `@/lib/turnstile`.
- Modified `src/app/(password-reset)/actions.ts` — `requestPasswordReset` gains optional `turnstileToken`; calls `verifyTurnstile` before `checkRateLimit`; returns `{ ok: false, error: "Verification failed. Please reload and try again." }` on rejection.
- Modified `src/app/(password-reset)/forgot-password/page.tsx` — added `turnstileToken` state; added `<Turnstile>` widget below email input; submit disabled when `siteKeySet && !turnstileToken`; token reset on failed submit.
- Modified `next.config.ts` — added `https://challenges.cloudflare.com` to `script-src`; changed `frame-src 'none'` to `frame-src https://challenges.cloudflare.com`; added removal comment and connect-src rationale comment.
- Modified `.env.example` — added both Turnstile keys with both-or-neither note.

### Outputs

- `src/lib/turnstile.ts` — `export async function verifyTurnstile(token, ip?): Promise<boolean>`; no auth/feature gate (server-only guard)
- `src/lib/turnstile.test.ts` — 9 tests, all passing
- `src/components/shared/turnstile.tsx` — `export function Turnstile({ onVerify, onExpire?, onError?, className? })`
- `src/app/(auth)/signin/actions.ts` — `export async function signInWithCredentials(input: SignInInput): Promise<{ error: string } | undefined>`; no explicit auth gate (unauthenticated path); Turnstile verification happens inside `authorize()` in `src/auth.ts`
- `src/app/(auth)/signin/signin-credentials-form.tsx` — client form component
- `src/app/(auth)/signin/page.tsx` — recomposed Server Component
- `src/auth.ts` — `turnstileToken` credential field; step 0.5 Turnstile check
- `src/app/(password-reset)/actions.ts` — `requestPasswordReset` gains `turnstileToken?: string`
- `src/app/(password-reset)/forgot-password/page.tsx` — Turnstile widget wired
- `next.config.ts` — CSP addendum for Cloudflare Turnstile
- `.env.example` — `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`
- Env vars added: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`

### Open questions / handoff notes

- E2E gate cleared: `npm run test:e2e` ran against live dev server, 34/34 passed with no keys configured. Keyless no-op path is green.
- Lint deviation: `react-hooks/refs` rule prohibits `ref.current = value` during render (the "latest value ref" pattern). Resolved via `useEffect` sync. The resulting behavior is equivalent for the Turnstile widget use case (refs are read only in event callbacks that fire after mount).
- Phase 5 qa: verify build, unit tests (361 pass), and e2e (34/34). No MFA-enrolled user interaction was changed; the TOTP flow and mfa-admin routing specs all passed.
- Next agent: **qa** for Phase 5 verification.
- Not committed per CLAUDE.md Workflow Rule 1.

---

## Phase 5 — Verification — 2026-07-02

**Owner:** qa
**Status:** complete

### Summary

PASS — AUTH-TOUCHING gate satisfied. The keyless no-op path is verified green: `verifyTurnstile` returns `true` immediately when `TURNSTILE_SECRET_KEY` is unset. All 9 unit tests for `verifyTurnstile` pass covering: no-key/no-token, no-key/token, keyed/undefined, keyed/null, keyed/empty, success, failure, fail-open (catch→true), and IP hint. Step 0.5 ordering in `authorize()` is correct (after `isLocalLoginEnabled`, before `checkRateLimit`). CSP updated to include `https://challenges.cloudflare.com` in `script-src` and `frame-src`. Sign-in page recomposition confirmed: Google form remains inline, credentials form is `<SignInCredentialsForm callbackUrl={callbackUrl} />` conditionally under `localLoginEnabled`. The e2e suite ran 48/48 with fresh auth state and an MFA-enrolled seeded admin user.

### What I did

- Verified `src/lib/turnstile.ts`: `import "server-only"`, returns `true` when no `TURNSTILE_SECRET_KEY`, returns `false` for missing/empty token when key set, fail-open catch block. All 9 unit tests confirmed passing.
- Verified `src/auth.ts` step 0.5 ordering: `isLocalLoginEnabled` (step 0) → `getRequestIp` extract → `verifyTurnstile` (step 0.5) → `checkRateLimit` (step 1). Confirmed `turnstileToken: { label: "Turnstile Token", type: "hidden" }` in credentials definition.
- Verified `next.config.ts` CSP: `https://challenges.cloudflare.com` in `script-src`, `frame-src https://challenges.cloudflare.com` (not `'none'`), removal comment present.
- Verified `src/app/(auth)/signin/page.tsx`: Google form inline server action preserved, `{localLoginEnabled && ... <SignInCredentialsForm callbackUrl={callbackUrl} /> ...}` conditional, URL-level error paragraphs retained at page level.
- Verified `src/app/(password-reset)/actions.ts`: `verifyTurnstile` called before `checkRateLimit` in `requestPasswordReset`.
- Ran typecheck clean, lint clean, 408/408, check:audit passed.
- Auth-touching e2e gate: deleted `.auth/` first, fresh acquisitions, 48/48 PASS with no Turnstile keys configured.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `signInWithCredentials` in `(auth)/signin/actions.ts` | no — unauthenticated sign-in action; Turnstile verification is the bot gate inside `authorize()` | no — not permission-gated | n/a — infrastructure gate |
| `requestPasswordReset` in `(password-reset)/actions.ts` | no — unauthenticated; IP-based rate limit and Turnstile are the gates | no | n/a — infrastructure gate |

### Coverage on Critical Modules

- `src/lib/turnstile.ts`: 100% (absent from coverage text report = no uncovered lines; 9 tests cover every branch)

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6.
- Keyed integration test (real Cloudflare test-mode keys) remains out of scope per Phase 3 spec; unit test suite covers all code paths.

---

## Phase 6 — Shipped vs Intent — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

**Verdict:** SHIP IT

**One-line take:** Cloudflare Turnstile can be enabled on sign-in and forgot-password by setting two env vars, with zero behavior change and green e2e when unset; verification is endpoint-level, and the lockout-DoS pairing is closed.

### What I did

**What's working:** `verifyTurnstile()` in `src/lib/turnstile.ts` has `import "server-only"`, fail-open posture per DECISION-026, and an immediate `return true` when `TURNSTILE_SECRET_KEY` is absent. Step 0.5 in `authorize()` fires after `isLocalLoginEnabled` and before `checkRateLimit` — bot traffic does not consume rate-limit budget. `requestPasswordReset` calls `verifyTurnstile` before `checkRateLimit` for the same reason. The sign-in page recomposition (Google form inline, credentials form extracted to `SignInCredentialsForm` client island in colocated `actions.ts`) matches the established TOTP precedent. CSP in `next.config.ts` now includes `https://challenges.cloudflare.com` in `script-src` and `frame-src`. `.env.example` has both keys with a "both or neither" note. 9 unit tests for `verifyTurnstile` cover all branches. 48/48 e2e with no keys configured.

**Intent-vs-shipped diff:**

- Phase 1 said: verification is endpoint-level inside `authorize()`, not form-level only (POST bypass-proof). Shipped: `verifyTurnstile` at step 0.5 inside `authorize()`. Verdict: matches.
- Phase 1 said: zero effect when env vars unset; e2e stays green. Shipped: `if (!secretKey) return true` (immediate no-op); 48/48 e2e with no keys. Verdict: matches.
- Phase 1 said: lockout-DoS pairing closed — Turnstile fires before rate limit. Shipped: step 0.5 (Turnstile) before step 1 (rate limit). Verdict: matches.
- Phase 2 said: CSP update required (frame-src from `'none'` + script-src). Shipped: both updated; removal comment and connect-src rationale comment present. Verdict: matches.
- Phase 3 said: lint deviation (`react-hooks/refs` rule) required resolving the latest-value-ref pattern via `useEffect` instead. Shipped: `useEffect` sync as documented. Verdict: acceptable drift (lint compliance, equivalent behavior for this use case).

**Edge cases:**

- Empty state: not applicable — no data surface.
- Failure microcopy: pass — Turnstile rejection on credentials form returns `"Wrong email or password."` (indistinguishable from wrong password; no leakage). Turnstile rejection on forgot-password returns `"Verification failed. Please reload and try again."` Both match Phase 1/3 spec.
- Permission gate: not applicable — unauthenticated infrastructure gate; no `FEATURES` key needed or added.
- Audit event: not applicable — Phase 1 confirmed audit events for Turnstile rejection are deferred; `RATE_LIMIT_BLOCKED` captures IP-level signal.
- Mobile: pass — `SignInCredentialsForm` is a client component hosting the Turnstile widget; the signin page was verified functional in the mobile-360-pass pipeline.

**One-key misconfiguration note:** If only `TURNSTILE_SECRET_KEY` is set (no site key), the widget does not render, the token is never sent, and `verifyTurnstile(undefined)` with a configured secret returns `false` — credentials sign-in is broken. This is documented in `.env.example` and Phase 3. Not a runtime bug in normal (zero-key or two-key) configurations; acceptable for a starter.

### Outputs

- `src/lib/turnstile.ts` — `verifyTurnstile()` verified (server-only, fail-open, no-op without secret).
- `src/auth.ts` — step 0.5 ordering, `turnstileToken` credential field verified.
- `src/app/(auth)/signin/page.tsx` — recomposition verified.
- `next.config.ts` — CSP Cloudflare entries verified.
- `src/lib/turnstile.test.ts` — 9 unit tests verified.

### Open questions / handoff notes

- Keyed integration test (real Cloudflare test-mode keys) remains deferred; unit tests cover all code paths. No action item needed.
