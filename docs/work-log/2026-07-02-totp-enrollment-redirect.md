# TOTP enrollment stranding fix — Work Log

> **Slug:** `2026-07-02-totp-enrollment-redirect`
> **Surface:** (auth)/totp + proxy flow
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small–medium (auth-touching — e2e gate applies)
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-07-02 |
| 2 — Architectural review | architect | complete | Approved | 2026-07-02 |
| 3 — Technical design | tech-lead | complete | — | 2026-07-02 |
| 4 — Implementation | full-stack-developer | complete | — | 2026-07-02 |
| 5 — Verification | qa | complete | PASS | 2026-07-02 |
| 6 — Shipped vs intent | analyst | complete | SHIP IT | 2026-07-02 |

---

## Intent (2026-07-02)

Pre-existing gap elevated by auth.require_2fa: the proxy sends
twoFactorRequired && !twoFactorVerified users to /totp (verification), but
a user with NO enrollment has nothing to verify — the /totp page currently
shows a static link to /account/2fa, leaving the admin-gated flow stranded
(and /account/2fa itself requires navigation the user may not find). Fix
direction for analyst to refine: /totp page already queries the enrollment
row — when absent, REDIRECT to /account/2fa?callbackUrl=<original> instead
of rendering the static hint (or auto-forward with the callback preserved
so post-enrollment lands back where they were going). Check /account/2fa's
enrollment completion flow for callbackUrl support; keep the proxy
unchanged (Edge, JWT-only). Auth-touching: e2e gate applies; the existing
mfa-admin fixture has NO enrollment — the e2e can assert the redirect.

---

## Phase 1 — Functional Refinement — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

When a user with `twoFactorRequired=true` and no enrolled TOTP secret is gated by the proxy to `/totp`, the verification page currently shows a static text hint with a bare link to `/account/2fa` — the original destination is lost and the user is stranded. The fix is a server-side redirect from `/totp` to `/account/2fa?callbackUrl=<original>` when no enrollment row exists. The `(account)/account/2fa` page and `TotpEnrollForm` need callbackUrl threading so the user lands back at their original destination after enrolling. The `(auth)/totp/page.tsx` already applies `sanitizeCallbackUrl` correctly; the same helper must be applied at the `/account/2fa` entry point.

### What I did

#### Pass 1 — User Verbs

- **Authenticated member/admin with `twoFactorRequired=true` and no enrollment:** arrives at `/totp?callbackUrl=/admin` → (after fix) is automatically forwarded to `/account/2fa?callbackUrl=/admin` → scans QR, enters code → sees recovery codes → clicks "Continue" → lands at `/admin`.
- **Authenticated member with enrollment (existing happy path):** arrives at `/totp`, enters their TOTP code, lands at callbackUrl. Unchanged.

#### Pass 2 — Flow Audit

**Flow 1 — No-enrollment redirect (the fix):**
entry: user accesses an admin or member-only URL while `twoFactorRequired=true, twoFactorVerified=false`
→ proxy redirects to `/totp?callbackUrl=<destination>` (proxy.ts lines 46–50, unchanged)
→ `/totp/page.tsx` queries `userTotp` for the user → no row found
→ server-side `redirect("/account/2fa?callbackUrl=" + encodeURIComponent(callbackUrl))` (callbackUrl already sanitized by `sanitizeCallbackUrl()`)
→ `/account/2fa/page.tsx` reads `searchParams.callbackUrl`, sanitizes again, passes to `TotpEnrollForm` as a prop
→ user scans QR, enters 6-digit code, submits `completeEnrollment` action
→ `completeEnrollment` succeeds (existing logic, unchanged)
→ `TotpEnrollForm` enters the enrolled state → shows recovery codes
→ enrolled state renders a "Continue" link using the callbackUrl prop (fallback: `/home`)
→ user clicks "Continue" → lands at original destination

- Failure at redirect: if `sanitizeCallbackUrl` returns `/home` (malformed callbackUrl), the user ends up at `/home` after enrollment. Acceptable. No infinite loop.
- Failure at enrollment (wrong code): existing toast.error("That code did not match. Try again.") — unchanged.
- Failure at enrollment (expired pending): existing toast.error("Enrollment session expired. Reload the page to start over.") — unchanged.

**Flow 2 — Has enrollment, needs verification (existing, unchanged):**
entry: `/totp?callbackUrl=<destination>` → enrollment row found → render TOTP form → user enters code → verify action → redirect to callbackUrl. No changes.

**Flow 3 — Post-enrollment but not yet TOTP-verified (state machine):**
After `completeEnrollment` succeeds, the session JWT still has `twoFactorVerified=false` (the enrollment action does not call `unstable_update`). The user's "Continue" link sends them to e.g. `/admin`. The proxy will then redirect them to `/totp?callbackUrl=/admin` again — but now there IS an enrollment row, so the verification form renders. The user enters their TOTP code, `verifyTotpAction` fires, sets `twoFactorVerified=true` in the session, and they land at `/admin`.

This is the correct two-step flow: enroll → then verify. The user sees two screens (enroll, then verify) before reaching their destination. The recovery-codes screen acts as a natural break between steps. The "Continue" CTA on the enrolled state must be labeled to set expectations — "Continue to sign in with your code" or simply "Continue" — not "Go to [destination]" because there's one more step.

#### Pass 3 — Permissions and Flags

- No new `FEATURES` key. The `/account/2fa` path is auth-only (proxy falls through for `/account/*`), so the unenrolled user can reach it regardless of role.
- No feature flag. This is a correctness fix in the auth flow.
- Proxy: unchanged. The proxy already passes `/account/2fa` through (it's not an admin route and matches the auth-only fall-through).

#### Pass 4 — Edge Cases

- **`sanitizeCallbackUrl` applied twice:** `/totp/page.tsx` already sanitizes (line 18). The `/account/2fa` page must also sanitize before passing to `TotpEnrollForm`. Double-sanitization is harmless and ensures no open-redirect if someone constructs a direct `/account/2fa?callbackUrl=//evil.com` URL.
- **Recovery codes — must be shown before navigation:** The user must see and acknowledge recovery codes before being navigated to the callbackUrl. The enrolled state in `TotpEnrollForm` must NOT auto-redirect — it must render the codes and a "Continue" CTA. The user clicks Continue.
- **`completeEnrollment` does not call `unstable_update`:** Correct — the session still reflects `twoFactorVerified=false`. The user must complete the TOTP verification step at `/totp` after enrollment. This is intentional: enrollment proves they set up the secret; verification proves they can use it right now.
- **mfa-admin fixture has NO enrollment by design** (global-setup.ts line 167–171). The e2e for this fixture can assert: navigate to `/admin` → expect URL to eventually contain `/account/2fa?callbackUrl=%2Fadmin` (after the redirect chain proxy → `/totp` → `/account/2fa`). The fixture cannot complete enrollment (no seeded deterministic secret), so the e2e asserts the redirect landing, not the full flow.
- **Empty callbackUrl:** If somehow the user reaches `/totp` without a callbackUrl param (e.g., navigated directly), `sanitizeCallbackUrl(undefined)` returns `/home`. The redirect becomes `/account/2fa?callbackUrl=%2Fhome`. After enrollment, they land at `/totp?callbackUrl=%2Fhome`, verify, land at `/home`. Fine.

#### Pass 5 — Adversarial Pass

- **callbackUrl open redirect:** Already addressed by `sanitizeCallbackUrl`. It rejects any value not starting with `/` or starting with `//`. Applied at both intake points (`/totp/page.tsx` already; `/account/2fa/page.tsx` must add it). The `TotpEnrollForm` receives the already-sanitized string — no second call needed inside the client component.
- **State-machine skip:** Can the user skip the verification step by navigating directly to the admin URL after enrollment? No — the proxy still sees `twoFactorVerified=false` in the JWT (enrollment does not call `unstable_update`). They are re-routed to `/totp` for verification.
- **Self-enrollment by a non-2FA-required user:** `/account/2fa` is accessible to any authenticated user. A user with `twoFactorRequired=false` could navigate directly to `/account/2fa?callbackUrl=/admin` and enroll. This is fine — enrollment is always allowed. The callbackUrl would send them to `/admin` after the recovery-codes screen, then to `/totp` for verification (since enrollment doesn't auto-verify). But admins with `twoFactorRequired=false` skip the TOTP gate in the proxy (line 44–50 of proxy.ts checks `twoFactorRequired &&`). So they'd land at `/admin` without a second step. Correct behavior.

### Outputs

- **Fix mechanism: server-side `redirect()` from `/totp/page.tsx`** when no enrollment row is found, not auto-forward (meta-refresh) or a hint link. The redirect is immediate and preserves the callbackUrl already in the page's searchParams.
- **callbackUrl threading required in three places:**
  1. `/totp/page.tsx` — add `redirect("/account/2fa?callbackUrl=" + encodeURIComponent(callbackUrl))` in the no-enrollment branch (replacing the current static hint paragraph). The `callbackUrl` is already sanitized on line 18 before use here.
  2. `/account/2fa/page.tsx` — add `searchParams: Promise<{ callbackUrl?: string }>` prop, call `sanitizeCallbackUrl`, pass to `TotpEnrollForm`.
  3. `TotpEnrollForm` — add `callbackUrl?: string` prop; in the enrolled state, render a "Continue" link pointing to `callbackUrl ?? "/home"` instead of the hardcoded `/account/2fa` href.
- **Files to touch:** `src/app/(auth)/totp/page.tsx`, `src/app/(account)/account/2fa/page.tsx`, `src/app/(account)/account/2fa/totp-enroll-form.tsx`. No proxy changes. No schema changes.
- **e2e assertion shape (mfa-admin fixture):** `page.goto("/admin")` → `page.waitForURL(/\/account\/2fa\?callbackUrl=/)` with a reasonable timeout. The fixture cannot complete enrollment, so the test stops at the redirect assertion.

### Open questions / handoff notes

- The "Continue" CTA label on the enrolled state: recommend "Continue" (generic) rather than "Go to [destination]" because there is still a verification step at `/totp` between here and the final destination. Tech-lead should confirm the CTA label.
- AUTH-TOUCHING: this feature touches `src/app/(auth)/totp/page.tsx`. The Phase 4 e2e gate applies — a running-server e2e smoke covering the full login path (including an MFA-enrolled user) is required before Phase 5.
- The mfa-admin fixture (no enrollment by design, per global-setup.ts comment) is the correct fixture for asserting the redirect. The test should NOT attempt to complete enrollment — that requires a real TOTP device and is deferred (see TOTP enrolment e2e backlog item).

---

## Phase 2 — Architectural Review — 2026-07-02

**Owner:** architect
**Status:** complete

### Summary

Approved. The three-file design is correct and minimal. All invariants are maintained: proxy untouched, sanitizeCallbackUrl applied at both intake points, no schema change. One correction to the analyst's TotpEnrollForm ruling: the enrolled-state CTA must change from the existing `<a href="/account/2fa">View 2FA settings</a>` to `<a href={callbackUrl ?? "/home"}>Continue</a>` — read the actual source before Phase 4. The e2e assertion belongs in `role-boundaries.spec.ts` (Test 3 updated in-place, not duplicated), and existing Test 3 will fail after this fix if left unchanged.

### What I did

- Confirmed the three-file redirect design: `/totp/page.tsx` (server redirect), `/account/2fa/page.tsx` (add searchParams prop), `TotpEnrollForm` (add callbackUrl prop, update enrolled-state CTA). No other files needed.
- Confirmed Next 16 Promise pattern: `searchParams: Promise<{ callbackUrl?: string }>` on `AccountTwoFactorPage`. The existing page has no `searchParams` prop at all (confirmed by reading `src/app/(account)/account/2fa/page.tsx` — the function signature is `async function AccountTwoFactorPage()` with no params). Adding the Promise searchParams prop follows the established pattern from `/totp/page.tsx` line 12–13.
- Confirmed `sanitizeCallbackUrl` applied at both intake points: `/totp/page.tsx` already sanitizes on line 18; `/account/2fa/page.tsx` must add `sanitizeCallbackUrl(sp.callbackUrl)` before passing to `TotpEnrollForm`. The `TotpEnrollForm` receives the already-sanitized string — no second call inside the client component.
- Read `src/app/(account)/account/2fa/totp-enroll-form.tsx`: the enrolled state (line 55–86) currently renders `<a href="/account/2fa">View 2FA settings</a>`. **This link must change.** The CTA label should be "Continue" (not "View 2FA settings") because enrollment does not complete the auth flow — the user must still complete TOTP verification at `/totp`. Link target: `callbackUrl ?? "/home"`. Tech-lead should note this deviation from the Phase 1 output which says `callbackUrl ?? "/home"` — the fallback should be `/home`, not `/account/2fa`.
- Confirmed proxy untouched. The Edge invariant is maintained. The proxy only inspects JWT claims; all logic changes are in Node.js server components.
- Confirmed auth-touching gate applies: Phase 4 must include a running-server e2e smoke covering the full login path with an MFA-enrolled user before Phase 5.
- Ruled on e2e assertion placement: **`role-boundaries.spec.ts`, Test 3, updated in-place — no new spec file.** The existing Test 3 (`mfa-admin navigating to /admin is redirected to /totp with callbackUrl`) will break after this fix: the mfa-admin (no enrollment) is now redirected from `/totp` to `/account/2fa?callbackUrl=%2Fadmin`. Test 3 must be updated to assert the new end-state URL (`/account/2fa` + `callbackUrl` param). A new spec file is not warranted — `role-boundaries.spec.ts` is the correct home for redirect-chain assertions, and the mfa-admin fixture is already wired. The describe block comment should be updated to note the two-hop chain (proxy → /totp → /account/2fa) so future maintainers understand the assertion scope.
- Confirmed no schema change. userTotp table and sanitizeCallbackUrl already exist.
- Reviewed `docs/decisions.md` (current high-water mark: DECISION-027). No new DECISION entry needed — all patterns used are established (Next 16 searchParams, sanitizeCallbackUrl from existing usage, server redirect from next/navigation).

### Outputs

- No files touched (review only).
- No DECISION entry logged.

### Open questions / handoff notes

- Tech-lead: the enrolled-state CTA in `TotpEnrollForm` currently hardcodes `href="/account/2fa"` with text "View 2FA settings". It must change to `href={callbackUrl ?? "/home"}` with text "Continue". Confirm this in Phase 3 design.
- Tech-lead: update `role-boundaries.spec.ts` Test 3 describe block comment to document the two-hop redirect chain. The test assertion changes from `/totp` to `/account/2fa?callbackUrl=` — this is a breaking change to the existing test that Phase 4 must handle.
- Phase 4 implementer: full-stack-developer (three files span server component + client component; small enough to avoid splitting).

---

## Phase 3 — Technical Design — 2026-07-02

**Owner:** tech-lead
**Status:** complete

### Summary

Four file changes: `(auth)/totp/page.tsx` (early redirect), `(account)/account/2fa/page.tsx` (searchParams + sanitize), `(account)/account/2fa/totp-enroll-form.tsx` (callbackUrl prop + CTA), and `e2e/role-boundaries.spec.ts` (Test 3 in-place update). No schema change. No proxy change. No new dependencies. Auth-touching: e2e gate applies at Phase 4 and Phase 5.

### What I did

#### File 1 — `src/app/(auth)/totp/page.tsx`

`redirect` is already imported at line 1. `sanitizeCallbackUrl` is already imported at line 6 and applied at line 18. No new imports needed.

**Change:** Replace the `!enrollment` ternary branch inside the return JSX with an early-exit imperative redirect before the return. Specifically, after the enrollment query (line 20–23) and before `return`, add:

```tsx
if (!enrollment) {
  redirect(
    "/account/2fa?callbackUrl=" + encodeURIComponent(callbackUrl)
  );
}
```

`callbackUrl` is already the sanitized value from line 18 — it is safe to encode and embed. The redirect is unconditional when no enrollment row is found; `encodeURIComponent` handles any path characters in the callbackUrl.

**Simplify the return:** Remove the ternary. The return now renders only the verification form (the `!enrollment` paragraph is gone):

```tsx
return (
  <main className="mx-auto max-w-sm px-6 py-24">
    <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
    <form action={verifyTotpAction} className="mt-6 space-y-3">
      {/* ... existing form body unchanged ... */}
    </form>
  </main>
);
```

Net diff: ~8 lines removed (the `!enrollment` `<p>` branch), ~4 lines added (the `if (!enrollment) redirect(...)` block).

#### File 2 — `src/app/(account)/account/2fa/page.tsx`

**New import** — add at the top (after existing imports):

```typescript
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";
```

**Function signature change** — the current signature `async function AccountTwoFactorPage()` has no params. Change to:

```tsx
export default async function AccountTwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
```

**Resolve and sanitize** — after `const session = await auth(); if (!session?.user) redirect(...)` (line 23), add:

```tsx
const sp = await searchParams;
const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl);
```

**Pass to TotpEnrollForm** — the existing call at lines 89–95 passes `uri`, `secret`, `pendingTtlMinutes`. Add `callbackUrl`:

```tsx
<TotpEnrollForm
  uri={enrollData.uri}
  secret={enrollData.secret}
  pendingTtlMinutes={PENDING_TTL_MINUTES}
  callbackUrl={callbackUrl}
/>
```

`sanitizeCallbackUrl(undefined)` returns `"/home"`, so when a user navigates directly to `/account/2fa` without a callbackUrl param, the Continue CTA in the enrolled state will link to `/home`. This is the correct fallback.

#### File 3 — `src/app/(account)/account/2fa/totp-enroll-form.tsx`

**Interface change** (lines 7–11) — add `callbackUrl` prop:

```tsx
interface TotpEnrollFormProps {
  uri: string;
  secret: string;
  pendingTtlMinutes: number;
  callbackUrl?: string;   // ← add
}
```

**Destructure** — add `callbackUrl` to the function parameter destructure (line 14–18).

**Enrolled-state CTA** (lines 78–83) — change from:

```tsx
<a
  href="/account/2fa"
  className="mt-6 inline-block text-sm underline underline-offset-2"
>
  View 2FA settings
</a>
```

to:

```tsx
<a
  href={callbackUrl ?? "/home"}
  className="mt-6 inline-block text-sm underline underline-offset-2"
>
  Continue
</a>
```

Label "Continue" (not "Go to [destination]") because the user must still complete one more step at `/totp` before reaching their original destination — the enrolled state is not the final screen. This was confirmed by Phase 1 and Phase 2.

#### File 4 — `e2e/role-boundaries.spec.ts` — Test 3 in-place update

**Describe block header comment** (lines 10–14) — add a note after the existing mfa-admin storageState comment:

```
// After the fix in 2026-07-02-totp-enrollment-redirect: the mfa-admin (no
// enrollment) is now redirected from /totp → /account/2fa. Test 3 asserts
// the two-hop chain (proxy → /totp → /account/2fa) and stops there — the
// fixture cannot complete enrollment.
```

**Test 3 describe block** (lines 62–76) — three in-place changes:

1. Describe label: `"MFA-admin — /totp gate"` → `"MFA-admin — two-hop redirect gate"`
2. Test name: `"mfa-admin navigating to /admin is redirected to /totp with callbackUrl"` → `"mfa-admin navigating to /admin is redirected to /account/2fa with callbackUrl (proxy → /totp → /account/2fa)"`
3. URL assertion: `await expect(page).toHaveURL(/\/totp/)` → `await expect(page).toHaveURL(/\/account\/2fa/)`
4. callbackUrl assertion stays: `expect(url.searchParams.get("callbackUrl")).toBe("/admin")` — the mfa-admin lands at `/account/2fa?callbackUrl=%2Fadmin`, so `searchParams.get("callbackUrl")` is still `"/admin"`. No change needed.

The `page.waitForURL` timeout should be generous enough to cover both hops (proxy → /totp → /account/2fa). `await expect(page).toHaveURL(...)` has Playwright's default retry, which is sufficient for two server-side redirects.

#### Unit tests

The redirect in `totp/page.tsx` is a Next.js RSC-level `redirect()` call — it cannot be exercised by Vitest (requires a running server context). `sanitizeCallbackUrl` already has unit tests at `src/lib/auth/safe-callback.test.ts`. `TotpEnrollForm` prop change is a TypeScript interface delta — typecheck catches missing prop wiring. No new Vitest tests are required for this pipeline; the e2e gate is the correct coverage vehicle.

#### Auth-touching e2e gate

This pipeline touches `src/app/(auth)/totp/page.tsx`. Per CLAUDE.md Phase 4 gate: a running-server e2e smoke covering the full login path (including an MFA-enrolled user) is required before Phase 5 can begin. The role-boundaries.spec.ts Test 3 update (mfa-admin → `/account/2fa`) is part of the required e2e suite for this gate.

### Outputs

- `src/app/(auth)/totp/page.tsx` — early redirect replaces `!enrollment` ternary (~4 lines net change)
- `src/app/(account)/account/2fa/page.tsx` — searchParams prop, sanitize, callbackUrl pass-through (~6 lines)
- `src/app/(account)/account/2fa/totp-enroll-form.tsx` — callbackUrl prop, CTA change (~5 lines)
- `e2e/role-boundaries.spec.ts` — Test 3 in-place update (describe label, test name, URL assertion)
- No DECISION entry (all patterns established)

### Open questions / handoff notes

- No open questions. Exact diffs are specified above.
- **Implementer: full-stack-developer.**
- **Auth-touching e2e gate applies at Phase 4.** The mfa-admin fixture (no enrollment by design) is the correct fixture for asserting the redirect chain. The test stops at the `/account/2fa?callbackUrl=` landing — do not attempt to complete enrollment in the test.
- Phase 5 QA verdict on this pipeline is `BLOCKED` (not `PASS`) if the e2e suite was not run against a live dev server with an MFA-enrolled seeded user.

---

## Phase 4 — Implementation (full-stack) — 2026-07-02

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the four-file change set from Phase 3 exactly as specified. The `/totp` page now redirects unenrolled users to `/account/2fa?callbackUrl=<original>` before rendering. The `/account/2fa` page threads the callbackUrl through to `TotpEnrollForm`. The enrolled-state CTA in `TotpEnrollForm` now links to `callbackUrl ?? "/home"` with the label "Continue". A fifth file (`e2e/member-home.spec.ts` test 6) required an update not anticipated in the Phase 3 spec — it asserted the old `/totp` endpoint and failed once the two-hop redirect was in place. Updated it in-place to match the new behavior, mirroring the same pattern applied to `role-boundaries.spec.ts` Test 3. All checks pass; e2e gate cleared at 30/30.

### What I did

- Added early-exit `if (!enrollment) { redirect("/account/2fa?callbackUrl=" + encodeURIComponent(callbackUrl)); }` in `/totp/page.tsx` before the return; removed the `!enrollment` ternary from JSX.
- Added `sanitizeCallbackUrl` import and `searchParams: Promise<{ callbackUrl?: string }>` prop to `AccountTwoFactorPage`; resolved, sanitized, and passed `callbackUrl` to `TotpEnrollForm`.
- Added `callbackUrl?: string` to `TotpEnrollFormProps` and destructure; changed enrolled-state CTA from `href="/account/2fa"` / "View 2FA settings" to `href={callbackUrl ?? "/home"}` / "Continue".
- Updated `role-boundaries.spec.ts` Test 3 in-place: describe label, test name, URL assertion (`/\/account\/2fa/`), two-hop comment; callbackUrl assertion unchanged.
- Updated `member-home.spec.ts` test 6 in-place (not named in Phase 3 spec — discovered during e2e run): same behavioral change, same fix pattern.
- Ran `npm run typecheck` (clean), `npm run lint` (clean), `npm run test` (339/339), `npm run check:audit` (0 violations).
- E2e gate: killed stale server processes, ran `npm run dev`, waited for HTTP 200, ran `npx playwright test` → 30/30 passed including Test 24 (role-boundaries Test 3) and Test 20 (member-home test 6).

### Outputs

- `src/app/(auth)/totp/page.tsx` — early redirect replaces `!enrollment` ternary
- `src/app/(account)/account/2fa/page.tsx` — searchParams prop, `sanitizeCallbackUrl`, `callbackUrl` passed to `TotpEnrollForm`
- `src/app/(account)/account/2fa/totp-enroll-form.tsx` — `callbackUrl?` prop, CTA updated
- `e2e/role-boundaries.spec.ts` — Test 3 in-place update (describe label, test name, URL assertion, two-hop comment)
- `e2e/member-home.spec.ts` — test 6 in-place update (same behavioral update; not named in Phase 3 spec but required for 30/30)
- No schema change. No new env vars. No new FEATURES entries. No DECISION log entry (all patterns established).

### Open questions / handoff notes

- Phase 5 QA (`qa` agent): e2e gate is satisfied — 30/30 against a live dev server, including Test 24 (the two-hop storageState path) and Test 20 (full sign-in path). An MFA-enrolled seeded user (`admin` fixture) was present throughout the run. Recommend QA verify the enrolled-state "Continue" CTA renders correctly in the browser against `/account/2fa?callbackUrl=%2Fadmin`.
- The `member-home.spec.ts` test 6 update should be noted as a Phase 3 oversight for the Phase 6 analyst review — the spec should have named both e2e files.

---

## Phase 5 — Verification — 2026-07-02

**Owner:** qa
**Status:** complete

### Summary

PASS — AUTH-TOUCHING gate satisfied. The two-hop redirect chain (proxy → `/totp` → `/account/2fa?callbackUrl=`) is implemented correctly: `/totp/page.tsx` does an early server-side `redirect()` when no enrollment row exists, `callbackUrl` is sanitized before encoding, `/account/2fa/page.tsx` threads `callbackUrl` through to `TotpEnrollForm`, and the enrolled-state CTA is `href={callbackUrl ?? "/home"}` with label "Continue". The e2e suite ran 48/48 against a live dev server with the MFA-enrolled seeded admin present throughout; test 33 (`role-boundaries.spec.ts` Test 3, now asserting `/\/account\/2fa/`) and test 29 (`member-home.spec.ts` test 6) both pass.

### What I did

- Read `src/app/(auth)/totp/page.tsx`: confirmed `if (!enrollment) { redirect("/account/2fa?callbackUrl=" + encodeURIComponent(callbackUrl)); }` before the return, with `callbackUrl` already sanitized by `sanitizeCallbackUrl(sp.callbackUrl)` on line 18. The `!enrollment` ternary JSX branch is gone.
- Read `src/app/(account)/account/2fa/totp-enroll-form.tsx`: confirmed `callbackUrl?: string` in `TotpEnrollFormProps`, destructured in function signature, enrolled-state CTA is `<a href={callbackUrl ?? "/home"}>Continue</a>`.
- Confirmed `member-home.spec.ts` test 6 updated to `/\/account\/2fa/` with callbackUrl assertion.
- Ran full shared checks: typecheck clean, lint clean, 408/408, check:audit passed.
- Auth-touching e2e gate: deleted `.auth/` first, fresh acquisitions for all three roles, 48/48 PASS including test 33 (role-boundaries two-hop) and test 29 (member-home test 6).

### Feature-Gate Audit

No new protected routes. `/totp/page.tsx` requires an authenticated session (existing `if (!session?.user) redirect("/signin")`). The redirect logic fires before any rendering and does not change the auth requirement. No `FEATURES` key is needed for this fix (auth-only gate, not permission-gated).

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /totp` | yes — `redirect("/signin")` if no session | n/a — auth-only path | n/a |
| `GET /account/2fa` | yes — existing auth check | n/a — auth-only path | n/a |

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6.
- Phase 3 oversight (both e2e files changed but only `role-boundaries.spec.ts` named in spec): flag for analyst at Phase 6.

---

## Phase 6 — Shipped vs Intent — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

**Verdict:** SHIP IT

**One-line take:** An unenrolled user with 2FA required is now forwarded through enrollment and back to their original destination; the stranding defect is gone.

### What I did

**What's working:** `/totp/page.tsx` has an early-exit `if (!enrollment) { redirect("/account/2fa?callbackUrl=" + encodeURIComponent(callbackUrl)); }` before the return, using the already-sanitized `callbackUrl`. `/account/2fa/page.tsx` reads, sanitizes, and passes `callbackUrl` to `TotpEnrollForm`. The enrolled-state CTA is `href={callbackUrl ?? "/home"}` with label "Continue" — correctly communicating that one more verification step follows. The `mfa-admin` e2e fixture (no enrollment by design) now asserts the two-hop chain landing at `/account/2fa?callbackUrl=/admin`. Auth-touching gate cleared: 48/48 e2e against a live dev server with an MFA-enrolled seeded admin.

**Intent-vs-shipped diff:**

- Phase 1 said: server-side redirect from `/totp` to `/account/2fa?callbackUrl=<original>` when no enrollment row. Shipped: exactly that; `sanitizeCallbackUrl` applied before encoding. Verdict: matches.
- Phase 1 said: "Continue" CTA label (there is still a verification step between enrollment and the final destination). Shipped: "Continue". Verdict: matches.
- Phase 1 said: e2e assertion stops at the `/account/2fa?callbackUrl=` landing; fixture cannot complete enrollment. Shipped: role-boundaries Test 3 asserts `/\/account\/2fa/` + `callbackUrl` param. Verdict: matches.
- Phase 3 spec named only `role-boundaries.spec.ts`; Phase 4 also updated `member-home.spec.ts` test 6. Verdict: acceptable drift — Phase 4 discovered a second spec broken by the behavioral change; fixing it was correct and necessary for 48/48 green. The Phase 3 spec oversight is noted here for the record.

**Edge cases:**

- Empty state: pass — `sanitizeCallbackUrl(undefined)` returns `/home`; a user who reaches `/totp` without a callbackUrl param is redirected to `/account/2fa?callbackUrl=%2Fhome` and lands at `/home` after enrollment + verification.
- Failure microcopy: pass — enrollment errors (wrong code, expired session) use existing `toast.error` copy; unchanged.
- Permission gate: pass — `/totp/page.tsx` still requires an authenticated session (`redirect("/signin")` if none); the enrollment-redirect fires after the auth check.
- Audit event: not applicable — this is a correctness fix in the auth navigation flow; no new security-sensitive mutation.
- Mobile: pass — no new components added; the account/2fa page was verified at 360px in the mobile-360-pass pipeline.

### Outputs

- `src/app/(auth)/totp/page.tsx` — enrollment-redirect verified.
- `src/app/(account)/account/2fa/page.tsx` — `callbackUrl` threading verified.
- `src/app/(account)/account/2fa/totp-enroll-form.tsx` — "Continue" CTA and `callbackUrl ?? "/home"` href verified.
- `e2e/role-boundaries.spec.ts` — Test 3 updated in-place; verified.
- `e2e/member-home.spec.ts` — test 6 updated in-place (Phase 3 oversight caught in Phase 4).

### Open questions / handoff notes

- Phase 3 spec oversight (member-home.spec.ts not named): noted for the tech-lead's next retrospective pass on spec thoroughness. Not a recurring pattern; no action item required.
