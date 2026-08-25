# 2FA Bypass via Server-Action Redirect Inlining — Bug-Fix Work Log

> **Slug:** `2026-08-24-totp-callback-bypass-fix`
> **Title:** Credentials sign-in silently bypasses the mandatory 2FA gate when `callbackUrl` points directly at a 2FA-gated route (`/admin` or `/o/*`) in one hop — the Server Action redirect is inlined by Next's action-redirect optimization (client soft-navigates via `history.pushState`, no network request), so `src/proxy.ts`'s Edge gate never runs and an unverified 2FA-required user reaches the gated page without seeing `/totp`.
> **Surface:** (auth) + Edge gate — core auth infrastructure
> **Permission(s):** none new
> **Flag(s):** none — a security fix does not ship behind an opt-in
> **Estimated complexity:** small-medium (fix is narrow; verification burden is high)
> **Pipeline mode:** Bug-fix variant. Auth-touching: full e2e login smoke incl. MFA-enrolled user is mandatory (Phase 4/5 gates).
> **Severity:** Sev-1 — defeats mandatory 2FA. Pre-existing in production paths today (`proxy.ts` sets `callbackUrl=pathname` on session-expiry bounces off `/o/*`).
> **Discovered:** 2026-08-24, while building `e2e/branded-signin.spec.ts`'s mandatory MFA smoke (see `docs/work-log/2026-08-24-branded-signin.md` Phase 4 and `docs/TODO.md`).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Bug confirmation (brief) | analyst | Complete | CONFIRMED REAL | 2026-08-24 |
| 2 — Architectural review | architect | **Skipped** (bug-fix variant; analyst Phase 1 recommendation) | — | 2026-08-24 |
| 3 — Root cause + fix design (brief) | tech-lead | Complete | — | 2026-08-24 |
| 4 — Fix + regression test | api-developer | Complete | — | 2026-08-24 |
| 5 — Verification (regression fails-before/passes-after) | qa | Complete | PASS (one tracked finding → fail-closed rework) | 2026-08-24 |
| 6 — Bug no longer manifests | analyst | Complete | SHIP IT | 2026-08-24 |

---

# Phase 1 — Bug Confirmation (analyst, brief)

## VERDICT: CONFIRMED REAL

## Reproduction Evidence

Playwright against the shared dev server, `E2E_USERS["mfa-enrolled"]` (real TOTP secret via `e2e/support/totp-fixture.ts`); scratch specs created, run, deleted (repo clean).

**Bypass path** — `GET /signin?callbackUrl=%2Fadmin` → credentials → submit:
- Network trace: only `POST /signin?callbackUrl=%2Fadmin` fires; **no `GET /admin` request ever appears** — the client soft-navigates via the inlined RSC payload.
- Final `page.url()`: `/admin`, no `/totp` hop.
- Session really unverified: a **fresh** `page.goto("/admin")` from the same session (forcing a real HTTP request) immediately redirected to `/totp?callbackUrl=%2Fadmin` — the Edge gate's logic is itself correct and would have caught this session had a request ever reached it.

**Control** — `GET /signin` with no callbackUrl → same credentials: lands on `/totp?callbackUrl=%2Fadmin` immediately, matching `totp-full-login.spec.ts`.

Root cause matches the documented account exactly: Next's Server-Action redirect-inlining optimization for a same-hop destination skips the network request the Edge gate depends on.

## Intended Behavior (fix must preserve)

Every `twoFactorRequired && !twoFactorVerified` user passes through `/totp` exactly once per session, regardless of entry path. Post-verification, the user lands on the originally intended destination (callbackUrl deep-link UX preserved).

## Flows the Fix Must Not Break

- **Google OAuth** — return trip is a genuine Route-Handler 302, not an action soft-nav; the inlining shouldn't apply, but no e2e coverage exists (no mock IdP) — tech-lead/QA must confirm the reasoning explicitly and note the gap.
- **Non-2FA users' direct callbackUrl landings** — must stay one hop, no spurious extra hop.
- **`/launch` default path** — proven safe (control); must stay untouched or re-verified.
- **Session-expiry re-auth mid-visit on `/o/*`** — the same vulnerable shape, already live in production; must be covered by the same fix and regression test.

## Notes for Tech-Lead

Likely shapes: force a full `window.location` navigation, or an intermediate real-HTTP hop, for credentials sign-in when the destination is 2FA-gated. The regression test must assert on **network requests observed**, not just final URL — that is the only assertion that would have caught this originally.

## Phase 2 — Skipped (documented)

Analyst recommendation, orchestrator concurs: the fix is a behavior change within existing files (`(auth)/signin` actions, possibly `src/proxy.ts`), no new directories/dependencies/schema; the Edge gate's contract keeps its shape — the fix is upstream of it. If Phase 3's design requires a new intermediate route or structural auth change, loop back to Phase 2 then.

---

# Phase 3 — Root Cause + Fix Design (tech-lead, brief)

## Root Cause

`src/app/(auth)/signin/signin-credentials-form.tsx` invokes the `signInWithCredentials` Server Action (`src/app/(auth)/signin/actions.ts`) from client code via `startTransition` — not a native `<form action>` POST. `signInWithCredentials` calls:

```ts
await signIn("credentials", { email, password, turnstileToken, redirectTo: input.callbackUrl });
```

`signIn()` (default `redirect: true`, `node_modules/next-auth/lib/actions.js:38-54`) sets the session cookie via `cookies().set()` and then itself calls `next/navigation`'s `redirect(redirectUrl)`, throwing `NEXT_REDIRECT`. For a Server-Action-triggered redirect reached via `fetch` (not a real browser-level form POST), Next's client action-handling machinery follows that redirect by rendering the **destination route's RSC payload inline, in the same response as the action call**, rather than issuing a second, separate browser-visible navigation request. Confirmed by Phase 1's network trace: `POST /signin?callbackUrl=%2Fadmin` fires once; no `GET /admin` ever appears, yet `page.url()` ends on `/admin`.

`src/proxy.ts`'s 2FA gate (`isTwoFactorGated && session.user.twoFactorRequired && !session.user.twoFactorVerified` → redirect to `/totp`) is Edge middleware keyed on `req.nextUrl.pathname` of each **inbound HTTP request**. The inbound request here is `POST /signin` — `/signin` is in `PUBLIC_PATHS`, so `proxy.ts` returns `NextResponse.next()` immediately and never evaluates the 2FA predicate at all. The *logical* destination (`/admin`) never generates its own inbound request for `proxy.ts` to inspect, because Next embedded its content in the POST's own response. The gate isn't defeated — it is architecturally unreachable for this one hop. This is not 2FA-specific; it is "the first hop after any Server-Action-redirect from `/signin` never passes through `proxy.ts`, no matter what checks live there," and it has been live in production since `callbackUrl`-carrying deep links (proxy.ts's own unauthenticated/session-expiry bounce off `/o/*` sets `callbackUrl=pathname`) started reaching `/signin`.

`/launch` is unaffected by the same mechanism for a structurally different reason, not because it's exempt from the optimization: `/launch` has no renderable content on the happy path (`docs/architecture` / `src/app/launch/page.tsx`'s own doc comment: "IT HAS NO UI ON THE HAPPY PATH") — every code path through it ends in `redirect()`. When the Server-Action-triggered inline-render of `/launch`'s RSC payload itself hits a nested `redirect()` mid-render, Next cannot synthesize an inlined payload for an infinitely-deferred destination and falls back to a real HTTP redirect response, which forces the client to issue a genuine follow-up request — the one `proxy.ts` sees and gates correctly. This is exactly Phase 1's proven control (`totp-full-login.spec.ts`, no explicit `callbackUrl`): `signIn` redirects to `/launch`, `/launch` redirects to `/admin`, and *that* redirect is a real request `proxy.ts` intercepts.

## Chosen Fix — (a), narrowed

Move the 2FA predicate into `signInWithCredentials` itself, evaluated with `redirect: false` so the action controls its own final `redirect()` call instead of letting `signIn()`'s internal one fire blind:

```ts
// src/app/(auth)/signin/actions.ts
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { AuthError } from "next-auth";

export async function signInWithCredentials(
  input: SignInInput,
): Promise<{ error: string } | undefined> {
  try {
    await signIn("credentials", {
      email: input.email,
      password: input.password,
      turnstileToken: input.turnstileToken ?? "",
      redirectTo: input.callbackUrl,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Wrong email or password." };
    }
    throw err;
  }

  // signIn({redirect:false}) already wrote the session cookie via cookies()
  // within this same action invocation (node_modules/next-auth/lib/actions.js:44-47)
  // — auth() reads it fresh, no separate request needed. Mirrors src/proxy.ts's
  // own predicate exactly (the ONE place it is duplicated, and only because
  // proxy.ts is provably unreachable for this hop — see Root Cause above).
  const session = await auth();
  if (session?.user?.twoFactorRequired && !session.user.twoFactorVerified) {
    redirect(
      `/totp?${new URLSearchParams({ callbackUrl: input.callbackUrl }).toString()}`,
    );
  }
  redirect(input.callbackUrl);
}
```

Confirmed viable by reading `node_modules/next-auth/lib/actions.js:6-55`: with `redirect: false`, `signIn()` still writes cookies via the Server Action's `cookies()` jar (line 45-47) and *returns* the resolved URL string instead of throwing `NEXT_REDIRECT` (line 52-54) — it does not need Edge-runtime anything; this is plain Node.js Server Action code, same runtime `verifyTotpAction` already runs in with its own `auth()` + `unstable_update()` + `redirect()` sequence (`src/app/(auth)/totp/actions.ts`), so the pattern is not new to this codebase.

**No trusted-device cookie exists to reconcile.** Grepped the auth surface (`src/auth.ts`, `src/lib/auth/`, `src/proxy.ts`) for `trustedDevice`/`remember device`/similar — none. `twoFactorVerified` is a per-JWT-session boolean only, reset to `false` on every fresh sign-in (`src/auth.ts:244`). The complication option (a) was flagged to address doesn't exist in this codebase; noted so a future reviewer doesn't go looking for it.

**Why this closes the exact hole without re-introducing the general risk of hand-rolling proxy.ts's full ruleset:** the action still only needs `input.callbackUrl` (already sanitized by `sanitizeCallbackUrl()` upstream in `signin/page.tsx`) — it does not need to resolve what that path ultimately means. Exactly like `proxy.ts` itself, it gates on "the immediate next hop," not the final destination: for `callbackUrl=/admin` it now correctly lands on `/totp?callbackUrl=/admin`; for the default `callbackUrl=/launch` (Phase 1's control, `totp-full-login.spec.ts`) it lands on `/totp?callbackUrl=/launch`, and after verification `redirect(callbackUrl)` in `totp/actions.ts` sends the user to `/launch`, which then independently recomputes `/admin` and redirects there again — one extra invisible hop *after* verification only, not before, and the final destination and existing spec assertions are unchanged (confirmed by tracing `totp-full-login.spec.ts`'s assertions below).

## Rejected Alternatives

**(b) Route ALL credentials sign-ins through `/launch`.** Rejected on Phase 1's own explicit constraint: "Non-2FA users' direct callbackUrl landings — must stay one hop, no spurious extra hop." Forcing every sign-in through `/launch` (even encoding the real destination as `?next=`) adds a redirect hop for the entire non-2FA-required population — most of the user base — to fix a problem that only exists for the 2FA-required-and-unverified subset. A "smart" version that only routes through `/launch` when 2FA is actually required would first have to check `twoFactorRequired` server-side before deciding — which is (a) in different clothing, with an extra hop layered on for no benefit. (b) is also strictly less precise than (a): it doesn't ever evaluate 2FA state itself, it just gets lucky that `/launch`'s own redirect-with-no-content structurally forces a real request; it would still work, but (a) is the more minimal, more legible fix and doesn't lean on an unrelated page's incidental structural property as its safety mechanism.

**(c) Client-side `window.location` navigation after the action returns.** Rejected: it moves a security-relevant decision (should this browser be allowed to render the destination without a server round trip?) into client-controlled code, which is the same class of bug this pipeline exists to close — the *initial* form-submission approach was already "trust the client's post-action behavior to eventually hit the server," and it silently didn't. `signin-credentials-form.tsx`'s `handleSubmit` already runs entirely client-side up to the `startTransition` call; wiring `window.location.href = destination` after `signInWithCredentials` resolves would work operationally (a `window.location` assignment is always a real top-level navigation, unaffected by RSC inlining) but requires the action to *return* the destination to the client instead of redirecting itself, which means a JS-disabled or script-blocked browser silently authenticates and then does nothing — a worse failure mode than today's — and it still requires the server to have computed the *correct* destination first (i.e., still needs (a)'s predicate), so it would be (a) plus an unnecessary, weaker delivery mechanism for the same information.

## Defense-in-Depth Ruling

Explicitly considered and **rejected**: no page- or layout-level re-check of `twoFactorVerified` is added on top of the Edge gate. Grepped every 2FA-gated surface (`/admin/**`, `/o/[slug]/**`) — zero page or layout currently re-checks `twoFactorVerified`; `src/proxy.ts` is architecturally the single, exclusive enforcement point (CLAUDE.md's Edge Gate section, DECISION-037), and the `(org)` contract's page-level auth check is scoped to *membership*, not 2FA — it explicitly delegates 2FA to the Edge. Duplicating the predicate into every gated page/layout would (1) violate that documented single-gate design, (2) require plumbing the current pathname into layouts that don't have it today (the exact problem the `(org)` contract cites for why *membership* checks live in the page, not the layout — 2FA would inherit the same awkwardness), and (3) create N copies of a security predicate that can silently drift, which is a worse standing risk than the one hop this fix closes. The durable defense against a *future* soft-nav path reopening this hole is the regression e2e below, made a standing, mandatory part of the auth e2e gate (CLAUDE.md Phase 4) — a network-observable assertion, re-run on every subsequent `(auth)/` change, is the right shape of protection here, not a second in-app runtime check. Phase 2's skip rationale already said the fix is upstream of the gate; this ruling keeps that true.

## Google OAuth — confirmed unaffected by code reading

`signin/page.tsx`'s Google button is also a `'use server'` form action (`signIn("google", { redirectTo: callbackUrl })`), but the mechanism differs structurally, not incidentally:

1. The **first** hop redirects to `accounts.google.com` — an external origin. Next's Server-Action redirect-inlining only applies to same-origin App Router destinations it can render as RSC; a redirect to an external URL forces a real top-level browser navigation (`window.location`-equivalent) regardless.
2. Google's callback lands on `GET /api/auth/callback/google` (`src/app/api/auth/[...nextauth]/route.ts`, `export const { GET, POST } = handlers`) — an ordinary Next.js **Route Handler**, not a Server Action. `src/proxy.ts` exempts `/api/*` from the gate outright (line 26), and the Route Handler's own subsequent redirect to `callbackUrl` is a genuine HTTP `Location` header on a `Response` object, which the browser follows as a real top-level navigation — the exact "real HTTP redirect" mechanism the Server-Action path lacks. That follow-up request **does** hit `proxy.ts`.

No e2e coverage exists for this today (no mock IdP, per Phase 1) — the reasoning above is code-reading only, matching Phase 1's ask; not something this pipeline can close by adding a test.

## Exact Files to Change

- `src/app/(auth)/signin/actions.ts` — the only production file. Add `redirect` (from `next/navigation`) and `auth` (from `@/auth`) imports; change the `signIn()` call to `redirect: false`; add the 2FA predicate and the two `redirect()` calls, replacing the current bare `redirectTo`-driven auto-redirect.
- No change to `src/proxy.ts`, `src/lib/auth/safe-callback.ts`, `src/app/(auth)/totp/actions.ts`, `src/app/(auth)/totp/page.tsx`, `src/app/launch/destination.ts`, `src/app/launch/page.tsx`, or `signin/page.tsx` / `signin-credentials-form.tsx` — all confirmed correct and untouched by tracing the flow end to end above.
- New: `src/app/(auth)/signin/actions.test.ts` — unit test, `vi.mock("@/auth")` (`signIn`, `auth`) and `vi.mock("next/navigation")` (`redirect`), asserting (1) `twoFactorRequired: true, twoFactorVerified: false` → `redirect("/totp?callbackUrl=" + encodeURIComponent(input.callbackUrl))` is called and the raw `redirect(input.callbackUrl)` is NOT; (2) `twoFactorRequired: false` → `redirect(input.callbackUrl)` is called directly with no `/totp` hop; (3) `AuthError` from `signIn()` still returns `{ error }` and calls no `redirect()`. Fast, deterministic coverage of the exact predicate without a server.
- New: `e2e/totp-callback-bypass.spec.ts` — the regression, see below.

## Regression E2E Plan

File: `e2e/totp-callback-bypass.spec.ts`, fixture `E2E_USERS["mfa-enrolled"]` (real, decryptable secret via `e2e/support/totp-fixture.ts`, matching `totp-full-login.spec.ts`'s precedent).

**Test 1 — the bypass path now lands on `/totp`, proven at the network level, not by trusting `page.url()` alone.**
1. Attach `page.on("request", r => requests.push(r.url()))` before navigating.
2. `page.goto("/signin?callbackUrl=%2Fadmin")`, fill `mfa-enrolled` credentials, submit.
3. `await page.waitForURL(/\/totp/, { timeout: 10_000 })`.
4. **DOM assertion** (the actual security property): `expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible()` AND `expect(page.getByRole("heading", { name: /welcome/i })).not.toBeVisible()` — the protected `/admin` content is never rendered, whether or not a discrete `GET /admin` ever appears in `requests` (Next's Server-Action redirect-inlining may legitimately apply to the *new*, safe `/totp` destination too — see Root Cause — so "no `GET /admin` in the trace" alone proves nothing; DOM content is the property that actually matters).
5. **Network-forced re-verification** (reproduces Phase 1's own diagnostic exactly, and is the network-request assertion this test is built around): from the *same* browser context/session, `const resp = await page.goto("/admin")` — an unambiguous, real top-level navigation Playwright observes directly — and assert `page.url()` (or `resp?.url()`) resolves to `/totp?callbackUrl=%2Fadmin`. This proves, via an actually-observed request/response pair (not an inference from the initial soft-navigated landing), that the session the browser is holding is genuinely 2FA-unverified and that `proxy.ts` independently rejects it — closing exactly the gap a final-URL-only assertion would have left open.
6. Enter the real TOTP code (`generateSync({ secret: E2E_TOTP_TEST_SECRET })`) on the `/totp` page reached in step 5, submit, assert final landing on `/admin` (mirrors `totp-full-login.spec.ts`'s existing positive path).

**Test 2 — session-expiry / mid-visit re-auth on `/o/*` is the same vulnerable shape and is covered by the same fix.** `mfa-enrolled` carries no organizations, so this doesn't need a new org-membership fixture — `proxy.ts`'s 2FA gate fires unconditionally on any `/o/*` pathname *before* any membership resolution happens (membership is resolved later, in the RSC page, per the `(org)` contract). Repeat Test 1's steps 1-5 with `callbackUrl=%2Fo%2Fe2e-alpha` in place of `%2Fadmin`, asserting the forced re-navigation in step 5 lands on `/totp?callbackUrl=%2Fo%2Fe2e-alpha`. No need to complete verification or assert a final org-page landing — the point is proving the gate fires for `/o/*`, not exercising org access (already covered elsewhere).

**Test 3 — control: `/launch` stays green.** Reproduce `totp-full-login.spec.ts`'s existing scenario verbatim (`page.goto("/signin")` with **no** `callbackUrl`) inside this same spec file as an explicit regression anchor, asserting landing on `/totp?callbackUrl=%2Flaunch` (not `%2Fadmin` — see Chosen Fix's note on the extra post-verification hop through `/launch`) and, after verification, final landing on `/admin`. This is deliberately redundant with `totp-full-login.spec.ts` — it's the negative control proving the fix didn't regress the already-safe path, kept next to the new assertions so a future reader sees bug/control side by side.

**Test 4 — non-2FA users get no spurious extra hop.** Using a credentials-capable fixture with `twoFactorRequired: false` (`clerk.fixture` per `docs/TODO.md`'s existing P9 precedent, or an equivalent non-2FA credentials fixture already in `e2e/support/users.ts`), submit with `callbackUrl=%2Fadmin`-shaped input appropriate to that fixture's actual accessible destination, and assert via the `requests` trace collected in step 1 that **no `/totp` URL ever appears** and the landing is immediate — proving the fix adds zero hops for the unaffected population, per Phase 1's explicit constraint.

## Full Auth-Touching E2E Blast Radius (must re-run, per CLAUDE.md's mandatory Phase 4 gate)

Every spec that submits real credentials through the `/signin` form (as opposed to injecting cached `storageState`) exercises the changed code path directly and must be re-run, not just the new spec:

- `e2e/totp-full-login.spec.ts` — the existing control this fix must not regress (traced above, confirmed still green by design).
- `e2e/admin-login.spec.ts`
- `e2e/branded-signin.spec.ts`
- `e2e/post-login-routing.spec.ts` — explicitly signs in via the form "rather than injecting storageState" for exactly this reason (own doc comment).
- `e2e/member-home.spec.ts`
- `e2e/account-page.spec.ts`
- `e2e/forgot-password.spec.ts` (exercises the `/signin` page shell, not the credentials submit path itself, but shares the page — cheap to include)
- `e2e/timezone-safe-dates.spec.ts`
- `e2e/public-sites.spec.ts` (the `elder.fixture` real-form sign-in helper for `/o/alder-creek/tickets`)

Not in the blast radius — these inject cached `storageState` produced by `e2e/support/global-setup.ts`, which provisions sessions directly rather than through the `/signin` form (confirmed by grep — no `/signin` reference in `global-setup.ts`), so they never touch `signInWithCredentials`: `e2e/role-boundaries.spec.ts`, `e2e/header-controls.spec.ts`, `e2e/whats-new.spec.ts`. Full suite still runs per the standard Phase 4/5 gate; called out here only to scope *risk*, not to justify skipping any of them.

## Permissions & Flags

Not needed — no new `FEATURES.*` key, no default role binding change, no flag. This is a fix to an existing enforcement path's reachability, not new access surface.

## API Contract

`signInWithCredentials(input: SignInInput): Promise<{ error: string } | undefined>` — signature unchanged. Internal behavior only: on success, it now redirects to `/totp?callbackUrl=<input.callbackUrl>` when `twoFactorRequired && !twoFactorVerified`, else to `input.callbackUrl` directly (previously: always directly to `input.callbackUrl` via `signIn()`'s own internal redirect).

## Data Model

No schema changes required.

## Implementation Order

1. `src/app/(auth)/signin/actions.ts` fix.
2. `src/app/(auth)/signin/actions.test.ts` unit test (fails before the fix on a hand-rollback, passes after — bug-fix variant's Phase 4/5 requirement).
3. `e2e/totp-callback-bypass.spec.ts` — all four tests; confirm Test 1/2 fail against `git stash`'d pre-fix code, pass after (qa's Phase 5 fails-before/passes-after check).
4. Re-run the full blast-radius list above plus the general suite.
5. No audit event needed — this is a read-path correction to an existing gate, not a new mutation; no new `AUDIT_ACTIONS` key.
6. `docs/TODO.md` — move the SECURITY line from Next Up to Done in the same commit that ships the fix (Workflow Rule 10); note the residual PROTECTION_RULES/feature-gate variant of this same root cause (see Edge Cases below) as a new Next Up line if not fixed here.

## Edge Cases & Risks

- **Residual, out-of-scope risk of the identical mechanism:** the same Server-Action-redirect-inlining defeats `proxy.ts`'s `PROTECTION_RULES` feature-gate checks (e.g. `FEATURES.ADMIN_USERS`), not just the 2FA gate, for a *non-2FA-required* user landing on a feature-gated `/admin/*` path directly via `callbackUrl`. Phase 1 confirmed only the 2FA case; this fix does not touch it (fixing it would mean duplicating `PROTECTION_RULES` into the action too, materially larger scope than a "brief" bug-fix design). Flagging explicitly so it isn't lost — recommend adding as its own `docs/TODO.md` line at Phase 6 if not folded into this pipeline; worth its own Phase 1 given it's a distinct (if related) finding, not a re-statement of this bug.
- **The `/totp?callbackUrl=/launch` intermediate hop after fix, before verification, for the default (no-`callbackUrl`) path:** cosmetic only — confirmed by trace that the *final* destination and every existing assertion in `totp-full-login.spec.ts` are unchanged; called out so a future reader doesn't mistake the URL bar's `callbackUrl=%2Flaunch` (post-fix) vs `callbackUrl=%2Fadmin` (pre-fix, today) for a behavior change.
- **`redirect: false` failure mode:** if `signIn()` ever throws something other than `AuthError` with `redirect: false` (e.g. a network/DB error mid-authorize), the existing `throw err` re-throw path is unchanged and still propagates to Next's error boundary — no new failure mode introduced.
- **Rate limiting / Turnstile:** untouched — both already run inside `signIn()`'s `authorize()` callback, before this fix's new code executes.

## Implementer

**api-developer.** The entire change is server-action/business-logic (`src/app/(auth)/signin/actions.ts`), touches no component, form, or page markup — `signin-credentials-form.tsx` and `signin/page.tsx` are unmodified. Matches the selection table's "Route handlers, server actions, server logic" row.

---

# Phase 4 — Implementation (api-developer)

## Files Created

- `e2e/totp-callback-bypass.spec.ts` — the regression, all 4 tests per the Phase 3 plan (bypass path proven at network+DOM level, `/o/*` session-expiry shape, the `/launch` control, the non-2FA no-extra-hop control).
- `src/app/(auth)/signin/actions.test.ts` — unit coverage of the predicate `signInWithCredentials` now evaluates itself.

## Files Modified

- `src/app/(auth)/signin/actions.ts` — the fix (see Implementer Notes for the one substantive divergence from the Phase 3 design's mechanism).
- `e2e/member-home.spec.ts` — test 6 ("user with twoFactorRequired=true navigating to /admin is redirected to /account/2fa via two-hop chain"): updated the `callbackUrl` assertion at the `/account/2fa` hop from `/admin` to `/launch`. Confirmed via `git stash` that this test passed pre-fix and fails post-fix with the assertion unchanged — a real, benign behavior change caused by the fix (see Implementer Notes).
- `e2e/post-login-routing.spec.ts` — test 3 ("an MFA-required user is walked from /admin into enrolment"): the same `callbackUrl` assertion update, same root cause, confirmed the same way.
- `docs/TODO.md` — annotated the existing SECURITY line as fixed by this work-log (left for Phase 6 to move to Done, since this pipeline is not committing); added a new Next Up line for the residual `PROTECTION_RULES`/feature-gate variant of the same redirect-inlining mechanism, per the Phase 3 design's Edge Cases instruction.

## Schema Changes

None.

## Audit Events

None. Per the Phase 3 design ("No audit event needed — this is a read-path correction to an existing gate, not a new mutation") — confirmed at implementation time: the fix adds no new mutation, only corrects which redirect a successful sign-in issues.

## Implementer Notes

### Divergence from the Phase 3 design's chosen mechanism (technical correction, same intent)

The design's exact code sample called `auth()` immediately after `signIn("credentials", { redirect: false })` inside the same action invocation, reasoning that `signIn()`'s `cookies().set()` call would make the freshly-issued session cookie visible to that same-invocation `auth()` read ("`signIn({redirect:false})` already wrote the session cookie via `cookies()` within this same action invocation — `auth()` reads it fresh, no separate request needed").

**Verified false at runtime.** Implemented the design's code verbatim first, ran the new e2e spec against it, and all three 2FA-relevant tests (1, 2, 3) still failed exactly as they had against the unfixed baseline — the bypass was still live. Added a temporary debug probe (`fs.appendFileSync` writing `JSON.stringify(session)` to a scratchpad file, removed before the final diff) and confirmed: `auth()` returned `session=null` immediately after a successful `signIn({ redirect: false })` in the same invocation.

Root cause of the discrepancy, traced through `node_modules/next-auth/lib/index.js`'s `initAuth` (zero-arg branch, used by both RSC and Server Actions): `auth()` resolves the session via `next/headers`'s **`headers()`** — the raw, immutable Cookie header of the *incoming* request — not via `next/headers`'s **`cookies()`**, which is the API Next.js actually synchronizes with a same-request `.set()` call. `signIn()` writes the new session cookie via `(await cookies()).set(...)` (`node_modules/next-auth/lib/actions.js:45-47`); a subsequent `cookies().get(...)` in the same action would see it, but a subsequent `headers().get("cookie")` — what `auth()` uses — never does. This is a real, verifiable limitation of NextAuth 5 beta's zero-arg `auth()`, not a mistake in how the design's sample was transcribed.

**Fix actually shipped:** rather than hand-decoding the session JWT from `cookies()` ourselves (rejected — `@auth/core/jwt.js`'s `encode`/`decode` module carries the header comment "This module *will* be refactored/changed. We do not recommend relying on it right now," and correctly picking the cookie name/`__Secure-` prefix and the `salt` value duplicates fragile internals for no real benefit), the action now:

1. Looks up the user by (lowercased) email via `db.query.users.findFirst()` — cheap, and `signIn()` above already proved this email/password pair is valid, so the row is expected to exist.
2. Calls `computeEffectiveTwoFactor(user.twoFactorRequired, user.id)` — the exact shared helper `src/auth.ts`'s own `jwt()` callback calls, so "is 2FA required" is computed identically to how the session's own claim would have been computed, with zero new logic invented.
3. Never reads `twoFactorVerified` at all: `src/auth.ts`'s `jwt()` callback unconditionally sets `token.twoFactorVerified = false` on every fresh sign-in (the `user?.id` branch, ~line 244) — a session this action itself just created can never carry `true`, so the predicate collapses to just "is 2FA required."

This preserves the design's full intent (evaluate the real 2FA requirement inside the same invocation that created the session, redirect to `/totp` first when required, no separate request needed) while fixing the one technical claim that didn't hold up under a runtime check. Full reasoning is now the "IMPLEMENTATION NOTE" doc comment in `actions.ts` itself, so a future reader hitting the same `auth()`-after-`signIn()` idea finds the answer in the code, not just here.

### Divergence in pre-existing test assertions (expected consequence of the fix, not a new bug)

Two pre-existing e2e assertions checked the `callbackUrl` query param at the `/account/2fa` hop for an unenrolled 2FA-required user signing in with **no explicit `callbackUrl` on `/signin`** (`mfa-admin` fixture): `member-home.spec.ts` test 6 and `post-login-routing.spec.ts` test 3. Both expected `/admin`; both now observe `/launch`.

Confirmed via `git stash` (stashing only `actions.ts`, re-running against the unmodified dev server) that **both assertions passed against the pre-fix code** — this is a genuine behavior change caused by the fix, not latent flakiness. Trace:

- **Pre-fix:** `signInWithCredentials` always let `signIn()` redirect internally to `input.callbackUrl` (`/launch`, the `sanitizeCallbackUrl()` default when nothing is on the query string). That redirect target has no UI on its happy path, so it forces a real second HTTP request (Root Cause section above); `/launch` computes the destination (`/admin` for this fixture) and issues its *own* `redirect("/admin")` — a real request `proxy.ts` intercepts, setting `callbackUrl=/admin` when it bounces to `/totp`. `/totp` forwards that value on to `/account/2fa` unenrolled. `/admin` is baked in by the time `/account/2fa` is reached.
- **Post-fix:** `signInWithCredentials` evaluates the 2FA predicate itself and redirects straight to `/totp` using the **raw `input.callbackUrl` value it received** (`/launch` — nothing has computed `/admin` yet, because `/launch` is never reached before `/totp`). `/totp` forwards that same `/launch` value to `/account/2fa`.

Not a security regression — this is exactly the "cosmetic" divergence the Phase 3 design's own Edge Cases section pre-approved ("the `/totp?callbackUrl=/launch` intermediate hop after fix... confirmed by trace that the final destination... [is] unchanged"), just with a wider footprint than the design anticipated: it assumed the extra `/launch`-shaped hop only showed up *after* verification (the `totp-full-login.spec.ts` case, which doesn't check the intermediate URL strictly), not also in this unenrolled dead-end case that never reaches verification within the test. Once the user actually completes enrolment and verification at `/account/2fa` → `/totp`, `redirect(callbackUrl)` sends them to `/launch`, which independently recomputes `/admin` — one extra hop, same final destination, no gap. Updated both assertions to expect `/launch` with an inline comment explaining why, rather than leaving them red or loosening them to a regex that would hide a real future regression.

### Confirmed pre-existing, unrelated failures (not touched)

Three e2e failures in the blast-radius run reproduce **identically** against the pre-fix code (`git stash` verified for the first two; the third is unrelated to auth entirely):

- `member-home.spec.ts` — "seeded admin signs in and lands on /admin" (gets `/orgs` instead) — the `admin@presby.invalid` dev-DB-pollution issue already documented for `post-login-routing.spec.ts` test 1 (real org memberships accumulated on the shared dev database's admin fixture — see `docs/work-log/2026-08-24-portal-home-directory.md`).
- `post-login-routing.spec.ts` test 1 ("a platform admin with no congregations lands on /admin") — the exact, named pre-existing failure the task brief called out in advance.
- `public-sites.spec.ts` test 2 ("flag on + live site -> 200, and the staged content actually renders") — a missing/stale content-seed row unrelated to sign-in; fails identically pre-fix. Tests 3-7 in the same file report "did not run" both before and after the fix (the file's own header documents `afterAll`-only cleanup semantics when an earlier test fails).

None of these three are touched by this fix and none are new.

## Red → Green Evidence (bug-fix variant requirement)

### RED — `e2e/totp-callback-bypass.spec.ts` against the unfixed code

Written and run first, against the pre-fix `signInWithCredentials`, on the shared dev server (`:3000`, `reuseExistingServer`):

```
Running 4 tests using 1 worker

✘  1 … 1 — /admin callbackUrl: the bypass path now lands on /totp, … (10.8s)
✘  2 … 2 — /o/e2e-alpha callbackUrl: session-expiry / mid-visit re-auth on /o/* … (10.4s)
✘  3 … 3 — control: no callbackUrl still lands on /totp?callbackUrl=/launch … (1.4s)
✓  4 … 4 — a non-2FA user's direct callbackUrl landing stays one hop, no spurious /totp detour (1.0s)

  1) …totp-callback-bypass.spec.ts:39:7 › … 1 — /admin callbackUrl …

    TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
    =========================== logs ===========================
    waiting for navigation until "load"
      navigated to "http://localhost:3000/admin"
    ============================================================
      46 |
      47 |     // The soft-navigated landing must be /totp, not the protected page.
    > 48 |     await page.waitForURL(/\/totp/, { timeout: 10_000 });
         |                ^

  2) …totp-callback-bypass.spec.ts:82:7 › … 2 — /o/e2e-alpha callbackUrl …

    TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
    =========================== logs ===========================
    waiting for navigation until "load"
      navigated to "http://localhost:3000/o/e2e-alpha"
    ============================================================
      93 |     await signInWithCallback(page, "mfa-enrolled", "/o/e2e-alpha");
      94 |
    > 95 |     await page.waitForURL(/\/totp/, { timeout: 10_000 });
         |                ^

  3) …totp-callback-bypass.spec.ts:107:7 › … 3 — control: no callbackUrl …

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "/launch"
    Received: "/admin"

      118 |
      119 |     await page.waitForURL(/\/totp/, { timeout: 10_000 });
    > 120 |     expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(
          |                                                                 ^
      121 |       "/launch",
      122 |     );

  3 failed
  1 passed (30.4s)
```

Test 1's failure IS the bypass itself, network- and time-observed: `page.waitForURL(/\/totp/)` times out because the browser landed directly on `/admin` and never navigated to `/totp` at all (visible in the log line `navigated to "http://localhost:3000/admin"` — the soft-nav destination). Test 2 shows the identical shape for `/o/e2e-alpha`. Test 3's failure is the pre-fix code's *different* (but not itself vulnerable) intermediate `callbackUrl` value, exactly as anticipated in the Phase 3 design's Edge Cases note — not a false negative. Test 4 (non-2FA control) passes pre-fix as expected, since it's unaffected by the bug either way.

### GREEN — same spec, same dev server, after the fix

```
Running 4 tests using 1 worker

✓  1 … 1 — /admin callbackUrl: the bypass path now lands on /totp, proven at the network + DOM level, and the real code still completes sign-in (2.0s)
✓  2 … 2 — /o/e2e-alpha callbackUrl: session-expiry / mid-visit re-auth on /o/* is the same vulnerable shape and is covered by the same fix (1.2s)
✓  3 … 3 — control: no callbackUrl still lands on /totp?callbackUrl=/launch and completes to /admin (must not regress totp-full-login.spec.ts's already-safe path) (1.7s)
✓  4 … 4 — a non-2FA user's direct callbackUrl landing stays one hop, no spurious /totp detour (936ms)

  4 passed (8.9s)
```

Re-confirmed green a second time after `npm run build` (to rule out `.next` corruption invalidating the dev server):

```
Running 4 tests using 1 worker
✓  1 … (2.2s)
✓  2 … (1.2s)
✓  3 … (2.1s)
✓  4 … (920ms)
  4 passed (9.7s)
```

### Unit tests — `src/app/(auth)/signin/actions.test.ts`

```
 RUN  v4.1.6 /Users/cshenso/git/presby
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

All 5 cases pass: 2FA-required → `/totp?callbackUrl=...`, not-required → straight to `callbackUrl`, user-row-not-found race → treated as not-required (documented), `AuthError` → `{ error }` with no DB lookup or redirect, non-`AuthError` → re-thrown with no DB lookup or redirect.

## Blast-Radius Results

Full list from the Phase 3 design, run against the shared dev server after the fix:

| Spec | Result |
|---|---|
| `e2e/totp-full-login.spec.ts` | PASS |
| `e2e/admin-login.spec.ts` | PASS (4/4) |
| `e2e/branded-signin.spec.ts` | PASS (4/4) |
| `e2e/post-login-routing.spec.ts` | 10/12 PASS — test 1 (pre-existing DB pollution, named in advance) and test 3 (expected assertion update, see Implementer Notes) accounted for |
| `e2e/member-home.spec.ts` | 6/8 PASS — test 2 (pre-existing DB pollution) and test 6 (expected assertion update) accounted for |
| `e2e/account-page.spec.ts` | PASS (6/6, plus the verify-email regression) |
| `e2e/forgot-password.spec.ts` | PASS (2/2) |
| `e2e/timezone-safe-dates.spec.ts` | PASS (2/2) |
| `e2e/public-sites.spec.ts` | 2/7 PASS — test 2 pre-existing/unrelated content-seed failure (confirmed identical pre-fix), tests 3-7 report "did not run" per the file's own documented `afterAll`-only-cleanup behavior when an earlier test fails |

46 tests total in this combined run: 38 passed, 5 failed (all three failure causes independently confirmed pre-existing or an expected, documented, benign consequence of the fix — none newly broken), 5 did not run (downstream of the one pre-existing `public-sites.spec.ts` failure).

## Gates

- `npm run typecheck` — PASS (one fixup needed in the new unit test: `redirect: (...args: unknown[]) => redirectMock(...args)` didn't satisfy TS2556 against the mock's narrower `(url: string) => never` signature; changed to `redirect: (url: string) => redirectMock(url)`).
- `npm run test` — PASS, 1912 passed / 218 skipped across 121 files (full existing suite, no regressions).
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope) — all 4 tripwires PASS. No new `AUDIT_ACTIONS` needed (no mutation added).
- `npm run build` — PASS, clean production build, all routes compiled including `/signin` and `/totp`. Dev server (`:3000`) continued serving correctly afterward — no `.next` corruption observed, confirmed by re-running the full regression spec post-build (see Red → Green Evidence above).

No `console.log` left in the shipped diff (the debug probe used to diagnose the `auth()` staleness issue was removed before the final implementation). No npm install performed.

## Next Agent

**qa** — Phase 5 verification. This is an auth-touching change (`src/app/(auth)/signin/actions.ts`), so per CLAUDE.md's Phase 5 gate, `PASS` requires the e2e suite to have run against a real dev server with an MFA-enrolled seeded user — already satisfied above (`totp-full-login.spec.ts` and `totp-callback-bypass.spec.ts` both exercise `mfa-enrolled`), but QA should independently confirm rather than take this write-up's word for it. QA should also independently verify the "confirmed pre-existing" claims for the three unrelated failures (the `git stash` comparisons are reproducible: `git stash push -- "src/app/(auth)/signin/actions.ts"`, restart nothing since Next hot-reloads, re-run, `git stash pop`).


---

# Phase 5 — Test Verification (qa)

**Date:** 2026-08-24 · **Verdict: PASS** (one non-blocking finding, resolved by a follow-up rework below)

## Regression Discipline — verified by QA's own execution

The fix hunk confirmed to be the entire uncommitted change to `actions.ts`; QA saved the fixed file (MD5-recorded), restored the pre-fix version via `git checkout HEAD --`, and ran the new spec: **RED reproduced** (tests 1–2 timeout with the browser landing directly on `/admin` / `/o/e2e-alpha`, test 3 failing the `/launch` intermediate assertion, test 4 passing) — matching Phase 4's evidence exactly. Fixed file restored byte-identically (MD5 match), spec re-run: **4/4 GREEN**, re-confirmed green again after `npm run build`.

## Auth Blast Radius (real dev server, MFA-enrolled fixture)

38 passed / 3 failed / 5 did-not-run — every failure independently matched to a documented pre-existing cause (dev-DB pollution ×2, content-seed ×1 with its 5 downstream skips). The two Phase 4 assertion updates verified to change only the expected intermediate `callbackUrl` value, not weaken assertions. `totp-full-login`, `admin-login`, `branded-signin` (incl. full TOTP scenario), `account-page`, `forgot-password`, `timezone-safe-dates` all clean.

## Other Gates

typecheck PASS · unit 1912/1912 (new `actions.test.ts` 5/5, zero skips) · `npm run check` PASS ×4 · build PASS, dev server healthy after.

## Fix Diff Review

Predicate mirrors `src/auth.ts`'s own `computeEffectiveTwoFactor()`; `twoFactorVerified` correctly not read (always false on a fresh sign-in). Error-mapping (lockout/deactivated/wrong-password → `CredentialsSignin`) compared pre-vs-post-fix: identical. No open redirect: both `redirect()` calls use only the already-`sanitizeCallbackUrl`-ed value threaded from the page. No secrets/console.log. Google OAuth reasoning confirmed by code reading (`/api/*` exempt at the Edge; the OAuth return is a real 302 whose *next* hop hits the gate) — no e2e possible without a mock IdP.

## Finding (non-blocking, must not close silently)

`actions.ts:93-96`'s doc comment claims any failure propagates ("a DB blip must not become a silent gate bypass") — but a successful query returning **zero rows** falls through to `required = false` (fail-open for that one render; a thrown exception genuinely does propagate). Mitigated by `src/auth.ts`'s stale-JWT re-derivation on the next real request, asserted by the implementer's own unit test under an accurate title, and reachable only in a delete-between-two-lookups race — but the comment misdescribes security-critical code. QA's recommendation: fail closed on a row miss, or correct the comment. **Orchestrator resolution: loop-back rework to fail closed (the stronger option), with scoped re-verification.**

## Feature-Gate Audit

`signInWithCredentials` creates the session — upstream of any `FEATURES.*` surface; no protected routes touched (diff scope confirmed: the action, two e2e spec assertion updates, two new test files, TODO). `proxy.ts` unmodified.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete | PASS | 2026-08-24 |

---

# Phase 4 — Rework (fail-closed fallback)

**Owner:** api-developer · **Date:** 2026-08-24

Addresses QA's Phase 5 finding directly (orchestrator chose the stronger of QA's two offered resolutions): the "user row not found" fallback in `src/app/(auth)/signin/actions.ts` fell through to `required = false` — fail **open** — while the doc comment above it claimed all failures propagate. A thrown exception genuinely does propagate (unchanged); a *successful* query returning zero rows was the actual gap.

## Change

`src/app/(auth)/signin/actions.ts`: `const required = user ? await computeEffectiveTwoFactor(...) : false;` → `... : true;`. A row miss now routes the user through `/totp` instead of straight to `callbackUrl`. Doc comment above the lookup rewritten to describe the real behavior: thrown exception → propagates (unchanged); successful zero-row result → fails **closed** to `required = true` (harmless extra TOTP prompt on a session with nothing left to protect; a genuine 2FA-required user is never waved through by a transient no-row result).

`src/app/(auth)/signin/actions.test.ts`: the test that locked in the old fail-open behavior (`"treats a not-found user row as not-2FA-required..."`, ~line 130) renamed and rewritten to `"fails CLOSED (routes through /totp) on a not-found user row — documented residual race, worst case is one harmless TOTP prompt on a vanished session"` — asserts `redirect()` is called with `/totp?callbackUrl=<callbackUrl>`, not the raw `callbackUrl`.

No other files touched. No `docs/TODO.md` change, no commit (per task scope).

## Test Evidence

**Unit** — `npx vitest run "src/app/(auth)/signin"`: 2 files, 15 tests, all passed (up from 5 in `actions.test.ts` alone; unchanged count, just the one case rewritten).

```
 Test Files  2 passed (2)
      Tests  15 passed (15)
```

**Typecheck** — `npm run typecheck`: clean, no errors.

**E2E regression** — `npx playwright test e2e/totp-callback-bypass.spec.ts --project=chromium`, run once against the shared dev server (`:3000`, not restarted):

```
Running 4 tests using 1 worker
  ✓  1 … /admin callbackUrl: the bypass path now lands on /totp … (1.7s)
  ✓  2 … /o/e2e-alpha callbackUrl: session-expiry / mid-visit re-auth on /o/* … (1.1s)
  ✓  3 … control: no callbackUrl still lands on /totp?callbackUrl=/launch and completes to /admin (1.8s)
  ✓  4 … a non-2FA user's direct callbackUrl landing stays one hop, no spurious /totp detour (1.0s)
  4 passed (8.6s)
```

Stayed 4/4 as expected — the row-miss branch isn't reachable by any of these four scenarios (all use real, present fixture rows), so this is confirmation of no-behavior-change on the normal paths, not new coverage of the fixed branch itself (that's the rewritten unit test's job).

## Next Agent

**qa** — re-verify the finding is closed: confirm the doc comment now accurately describes the fail-closed/propagate split, confirm the rewritten unit test asserts the correct redirect target, and re-confirm the e2e blast radius is unaffected (scoped re-check, not a full Phase 5 re-run — no e2e-reachable path changed).


---

# Phase 6 — Shipped vs Intent (analyst, bug-fix variant)

## VERDICT: SHIP IT

## Reproduction Evidence (analyst's own, shared dev server)

- `e2e/totp-callback-bypass.spec.ts` re-run: 4/4. `mfa-enrolled` + `callbackUrl=%2Fadmin` now lands on `/totp` (DOM-verified), the TOTP code verifies, final landing `/admin` — deep-link preserved. Same shape confirmed for `/o/e2e-alpha`. Control path unchanged.
- Independent non-2FA control: throwaway spec (deleted after; repo clean) as `org-single` (twoFactorRequired: false) with an org callbackUrl — one hop, no `/totp` request in the network trace. The bug no longer manifests for either population.

## Intent Check

- Phase 1's promise confirmed both directions (2FA users always pass `/totp` once; non-2FA users stay one hop).
- QA's doc-comment finding genuinely resolved: comment, code (`user ? ... : true`), and the renamed fail-closed unit test now agree.
- Google OAuth remains a code-reading-only assurance (no mock IdP) — a named, accepted gap.

## Housekeeping

- Residual `PROTECTION_RULES` follow-up present in TODO (its own future Phase 1).
- SECURITY line moved to Done (2026-08-24) by the orchestrator at close-out (Rule 10; lands in the shipping commit).
- Rules 12/13: N/A (internally discovered; not member-visible).

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Bug no longer manifests | analyst | Complete | SHIP IT | 2026-08-24 |

**Pipeline closed.** Commits await user review per Workflow Rule 1.
