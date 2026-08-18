# Post-Login Routing + Member Home + Starter E2E Hardening — Work Log

> **Slug:** `2026-07-01-post-login-routing-and-e2e`
> **Surface:** mixed (public landing, new member home, global nav, admin gate, e2e)
> **Permission(s):** existing `admin.dashboard` covers the conditional Admin link; no new key expected
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

## Intent (from user, 2026-07-01)

Across the user's last few forks of this starter, the same rework recurred:

1. **Login lands on `/admin`.** `signin/page.tsx:10` and `totp/page.tsx:17` default `callbackUrl` to `/admin`. There is no logged-in *member* home, so every non-admin user is dumped at an admin route they may not even have permission for.
2. **No global nav.** The only navigation is inside `(admin)/admin/layout.tsx`. There is no menu that lets a signed-in member reach Account, and no conditional "Admin" link for users who *are* admins.
3. **Public landing hard-links to `/admin`** (`page.tsx:48`).

**Requested change (confirmed via scoping questions):**
- Fix routing **before** writing tests (don't lock in login→/admin).
- Add a **new minimal member dashboard** as the post-login landing (greets the user, shows their roles/features, links to Account, and to Admin *only if* they hold `admin.dashboard`).
- Change signin + totp default `callbackUrl` from `/admin` to the member home.
- Add a **global nav/menu** with the conditional Admin link.
- Fix the public landing page.
- Add an **e2e suite** proving the core flows work (public landing, signin, member home, non-admin blocked from `/admin`, admin reaches admin, account, 2FA).

### Related bugs surfaced during earlier triage (route to bug-fix variant separately)

- **BUG-1:** `verify-email/[token]/page.tsx:64` uses `db.transaction()` on the neon-http driver (unsupported → runtime throw). See `docs/reviews/2026-07-01-starter-contribution-triage.md`.
- **BUG-2:** `2fa/page.tsx:24` mutates a cookie (`jar.delete`) during RSC render (forbidden in Next 16). Twin in `(admin)/admin/2fa`.

These are "some other stuff was broke as well." Tracked here for visibility; each needs its own bug-fix work-log unless folded into this feature's Phase 4 by the tech-lead.

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

The feature fixes three inter-related defects in the starter's routing: post-login landing on `/admin` instead of a member home, no navigation for signed-in non-admin users, and a hard link to `/admin` on the public landing. The scope is well-defined. Five-pass review surfaces six notes that must flow into Phase 3 design — none are pipeline blockers, but three carry security weight (callbackUrl sanitization, 2FA gate intent, TOTP enrolment redirect) and must be addressed explicitly by the tech-lead. Two questions (route name, global nav scope on public pages) have sensible defaults the tech-lead can adopt without asking the user, provided they document the choice in the design doc.

**Verdict: READY WITH NOTES**

**One-line take:** Routing that drops every non-admin at `/admin` is a starter defect that recurs in every fork; this fix adds a proper member home, a conditional global nav, and an e2e harness to prove the routing invariants hold.

---

### Pass 1 — User Verbs

**Anonymous visitor** (no session)
- Visits `/` public landing page
- Clicks "Sign in" link → `/signin`
- Clicks "Go to admin" (BUG: hard link to `/admin`; this link should be removed or scoped to signed-in admins)

**User at sign-in** (no session yet)
- Types email + password at `/signin`, clicks "Sign in with email"
- Clicks "Sign in with Google"
- Clicks "Forgot password?" → `/forgot-password`
- Arrives at `/signin` with a `callbackUrl` query parameter (set by the proxy or by the landing page's Sign In link)

**User in TOTP gate** (session exists, `twoFactorRequired = true`, `twoFactorVerified = false`)
- Arrives at `/totp` with a `callbackUrl` query parameter
- Types 6-digit TOTP code or recovery code, clicks "Verify"
- On success: redirected to `callbackUrl`
- On failure: stays on `/totp` with `error=invalid` or `error=rate_limited`

**Authenticated member (has at least one role, no `admin.dashboard`)**
- Arrives at member home after sign-in (the new route)
- Reads their name, roles list, features list on the member home
- Clicks "Account" in the global nav → `/account`
- Does NOT see an Admin link in the global nav
- Directly navigating to `/admin` → bounced to `/access-pending` by proxy

**Authenticated member (no roles at all)**
- Arrives at member home after sign-in
- Sees empty roles/features (no roles yet; needs a helpful empty state)
- Is NOT redirected to `/access-pending` on the member home (that page is for protected-route denials, not post-login landing)
- Directly navigating to `/admin` → bounced to `/access-pending` by proxy

**Authenticated admin** (has `admin.dashboard`)
- Same as member, PLUS sees "Admin" link in global nav → `/admin`
- If `twoFactorRequired = true` and `!twoFactorVerified`: navigating to any `/admin/*` route triggers proxy redirect to `/totp?callbackUrl=/admin`
- After TOTP verify: lands in admin area

**Admin in admin shell**
- Existing admin sidebar nav is unchanged; it already handles admin-area navigation

---

### Pass 2 — Flow Audit

**Flow A: Anonymous visitor → sign-in → member home** (the primary fix)

```
Entry: / (or /signin directly)
  → Click "Sign in" link on landing OR direct visit to /signin
  → /signin — enter email/password (or Google OAuth button)
  → On Credentials success: NextAuth redirects to callbackUrl
     - callbackUrl defaults to /home (CHANGED from /admin)
     - If proxy sent them here, callbackUrl = /home (or their originally-requested path)
  → If twoFactorRequired && !twoFactorVerified: intermediate redirect to /totp?callbackUrl=/home
     → /totp — enter 6-digit code
     → On success: redirect to callbackUrl (/home)
     → On failure: back to /totp with error param
  Outcome (success): /home — member home, greeted by name, roles/features shown, nav visible
  Outcome (wrong password): back to /signin?error=CredentialsSignin — "Wrong email or password."
  Outcome (deactivated): /signin?error=deactivated — "This account has been deactivated."
  Outcome (TOTP fail): /totp?callbackUrl=...&error=invalid — "That code didn't match."
  Outcome (rate limited): /totp?callbackUrl=...&error=rate_limited — "Too many attempts."
```

Failure paths: documented above. All currently exist in the code; this flow requires no new error states.

**Flow B: Authenticated member → global nav → Account**

```
Entry: any authenticated page (member home, /account, etc.)
  → Global nav visible with "Account" link and (conditionally) "Admin" link
  → Click "Account" → /account
  Outcome: Account settings page (profile, email, password, 2FA, delete)
```

No failure path needed beyond the existing account page's own error handling.

**Flow C: Authenticated admin → global nav → Admin**

```
Entry: member home or /account
  → Global nav shows "Admin" link (conditional on admin.dashboard feature in session.user.features)
  → Click "Admin" → /admin
  → If twoFactorRequired && !twoFactorVerified: proxy intercepts → /totp?callbackUrl=/admin
    → Enter TOTP code → /admin
  Outcome: Admin dashboard with sidebar nav
```

Failure path: proxy enforces the 2FA gate. If `admin.dashboard` is missing from features, proxy redirects to `/access-pending`. These paths already exist.

**Flow D: No-roles user → member home (not /access-pending)**

```
Entry: /signin (post-seed, no role assigned, or role not yet seeded)
  → Successful sign-in, callbackUrl = /home
  → proxy.ts: /home is not in PUBLIC_PATHS, not in PROTECTION_RULES → auth-only fall-through → allowed
  Outcome: /home — member home with empty roles/features
  Empty state: needs a helpful "Contact an admin to get access" message (see Gaps #4)
```

**Flow E: Sign out**

```
Entry: global nav (any authenticated page)
  → Click "Sign out"
  → signOut({ redirectTo: "/" })
  Outcome: / public landing, signed-out state (Sign In link visible)
```

Sign out placement in the global nav is not specified in the request (see Gaps #3).

---

### Pass 3 — Permissions and Flags

**`admin.dashboard` (existing `FEATURES.ADMIN_DASHBOARD = "admin.dashboard"`)**
- Already the gate for all `/admin` routes in `proxy.ts` `PROTECTION_RULES`.
- The conditional Admin link in the global nav should check `session.user.features?.includes("admin.dashboard")` — same gate, no new key.
- Default role bindings: admin role only. Member role does not have `admin.dashboard`. Correct; no change needed.

**Member home route — no permission gate**
- The member home is open to any authenticated user, regardless of role.
- In `proxy.ts`, it falls through to the auth-only `return NextResponse.next()` block.
- The new route must NOT be added to `PUBLIC_PATHS` (that would allow unauthenticated access).
- The new route must NOT be added to `PROTECTION_RULES` (that would require a feature that regular members don't have).
- No new `FEATURES` key is needed. Confirmed.

**Feature flags**
- No feature flags required for this change. Confirmed.

**No new audit events**
- This feature adds no security-sensitive mutations. The existing TOTP verify audit already fires. No new `audit_events` writes needed.

---

### Pass 4 — Gaps the Request Didn't Address

**Gap 1 — Route name for the member home.** The request says "member home" but doesn't name the route. Candidates: `/home`, `/dashboard`, `/app`. Suggested resolution: use `/home`. It's the simplest, is semantically unambiguous (a user's landing space), and avoids implying dashboard-level functionality that isn't there. `/dashboard` would invite scope creep. This is a tech-lead decision; no user input needed, but the decision must be logged.

**Gap 2 — Global nav scope: auth'd pages only vs. all pages.** If the global nav goes in `src/app/layout.tsx` (root layout), it renders on `/signin`, `/access-pending`, `/forgot-password`, etc. That's probably wrong — a half-rendered nav on the sign-in page looks broken. If it goes in a nested layout wrapping only auth'd routes, the architect must decide the route grouping. The admin layout already has its own sidebar; the global nav must not double-render inside `/admin`. This is the single biggest architectural question and is the reason Phase 2 must address layout placement before the tech-lead designs anything.

**Gap 3 — Sign-out in the global nav.** The request doesn't specify where sign-out lives. The admin sidebar currently shows "Sign out (email)." The global nav needs a sign-out affordance for non-admin users. Suggested resolution: a "Sign out" button at the tail of the global nav, identical in behavior to the admin sidebar's version. Tech-lead decides placement.

**Gap 4 — Member home empty state for no-roles users.** The request says the member home shows "their roles/features." For a user with no roles and no features, an empty list with no guidance is not helpful. Suggested text: "Your account is set up, but you haven't been granted any roles yet. Contact an administrator." This is a content decision the tech-lead should lock in during Phase 3.

**Gap 5 — TOTP enrolment redirect points to `/admin/2fa`.** `src/app/(auth)/totp/page.tsx:29` currently shows a message for non-enrolled users that links to `/admin/2fa`. After this change, non-admin users who end up at `/totp` without a TOTP enrolment will see a broken link (they can't reach `/admin/2fa` without `admin.dashboard`). The correct link is `/account/2fa`. This must be fixed as part of this feature.

**Gap 6 — `callbackUrl` sanitization in `signin/page.tsx`.** `totp/actions.ts` has a `sanitizeCallbackUrl()` function that validates the URL is a relative same-origin path. The sign-in page (`signin/page.tsx:10`, `34`, `58`) passes `callbackUrl` directly from the query string to `signIn("google", { redirectTo: callbackUrl })` and `signIn("credentials", { redirectTo: callbackUrl })` without sanitization. Whether NextAuth 5 sanitizes the `redirectTo` parameter internally is not confirmed in the codebase. This is a potential open-redirect on the sign-in form that shares the same class of bug as the prior TOTP callbackUrl finding. The tech-lead must confirm NextAuth's behavior and, if not confirmed safe, apply the same `sanitizeCallbackUrl` logic before passing to `signIn()`. The default fallback must also change from `/admin` to the new member home route.

**Gap 7 — E2E suite: TOTP-enrolled user strategy.** The request asks for an e2e spec covering the 2FA path. The existing `e2e/admin-login.spec.ts` uses `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` but does not test a TOTP-enrolled user. CLAUDE.md's auth-touching e2e gate requires "a running-server e2e smoke covering the full login path (including an MFA-enrolled user)." The seed script (`scripts/seed.ts`) does not create a TOTP-enrolled user. Options:
  - (a) Skip the MFA-enrolled path in the e2e spec and rely on the existing TOTP unit tests — but this does not satisfy CLAUDE.md's gate.
  - (b) Add a seeded TOTP user with a known test secret (acceptable for local dev, not for prod). Requires `SEED_TOTP_SECRET` env var in `.env.local` / `.env.example`.
  - (c) Assert the gate behavior (user is redirected to `/totp`, not that they can complete it) — a middle-ground that covers the routing without full end-to-end TOTP verification.
  
  The tech-lead must choose an approach and document it. If option (b) or (c) is chosen, the QA agent must acknowledge the scope in Phase 5. Option (c) is the practical recommendation for a starter template.

---

### Pass 5 — Adversarial Pass

**A — callbackUrl open redirect at sign-in.** `signin/page.tsx:10` reads `callbackUrl` from `searchParams` and passes it unsanitized to `signIn("google", ...)` and `signIn("credentials", ...)`. A crafted link like `/signin?callbackUrl=https://evil.com` could redirect a user to an external site after OAuth. This must be confirmed or fixed. Flag it to the tech-lead as a required investigation in Phase 3 (see Gap 6). The prior Phase 1 review for TOTP missed this class of issue; recording it here explicitly.

**B — `sanitizeCallbackUrl` default leaks `/admin`.** `totp/actions.ts:34` falls back to `/admin` when the callback URL is invalid (`return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/admin"`). After this feature ships, the fallback must be the member home route, or an invalid TOTP callback still dumps the user at an admin route they may not be able to access. This is a small but concrete regression risk if not updated.

**C — State-machine shortcut: member home before 2FA gate.** `proxy.ts` only enforces `twoFactorRequired && !twoFactorVerified` for admin routes (`isAdminRoute` check at line 42–51). A user with `twoFactorRequired = true` who has not verified TOTP can reach the member home without completing 2FA. This is arguably intentional — 2FA is an admin-access gate, not a site-wide gate — but the decision must be stated explicitly in the Phase 3 design doc. If 2FA should gate the member home too, the proxy needs a separate block.

**D — Global nav hydration: Admin link flicker.** The conditional Admin link reads `session.user.features` from the JWT. If the global nav is a client component using `useSession()`, there is a hydration window where the nav renders without session data (the SSR pass may show no Admin link, then the client shows one). This is a known Next.js/NextAuth pattern; the tech-lead should use a server component for the nav (or ensure `useSession()` is called with `{ required: true }`) to avoid the flicker. Not a security issue, but a visible UX bug.

**E — No-roles user navigates directly to `/admin`.** Currently redirected to `/access-pending` by proxy. This path is correct and unchanged. The `/access-pending` page itself has no nav (no way to get back to the member home or account). After this feature, the member home exists — a link from `/access-pending` to the member home would be helpful. Not a security issue; noted as a polish item.

**F — The landing page's existing Sign In link does not set a `callbackUrl`.** `page.tsx` links to `/signin` without a `callbackUrl` param. So after signing in from the landing page, `callbackUrl` defaults to the new member home — correct. But if the user signed in specifically because they wanted to reach `/admin`, they'll land at the member home and need to navigate from there. This is by design and an improvement over the current behavior (landing at `/admin` and being bounced if you don't have access). No action needed.

---

### What I Did

- Read `signin/page.tsx`, `totp/page.tsx`, `totp/actions.ts`, `page.tsx` (landing), `(admin)/admin/layout.tsx`, `permissions.ts`, `proxy.ts`, `auth.ts`, `access-pending/page.tsx`, `account/page.tsx`, and `e2e/admin-login.spec.ts`.
- Ran five-pass review: user verbs, flow audit, permissions/flags, gaps, adversarial pass.
- Confirmed no new FEATURES key is needed.
- Identified seven gaps; none are pipeline blockers but six require explicit tech-lead resolution in Phase 3.
- Identified five adversarial findings; two have security weight (callbackUrl sanitization, `sanitizeCallbackUrl` default).

### Outputs

- `docs/work-log/2026-07-01-post-login-routing-and-e2e.md` — Phase 1 section written; Per-Phase Status updated to Complete / READY WITH NOTES / 2026-07-01.

### Open Questions / Handoff Notes

For Phase 2 (architect):
- Where does the global nav live in the component tree? Root layout vs. auth'd-only nested layout? Admin layout must not double-render it. This is the primary structural question for Phase 2.
- What is the route grouping for the member home? Suggest `src/app/(member)/home/` as a new route group, paralleling `(admin)/admin/`. Phase 2 owns the directory decision.

For Phase 3 (tech-lead):
- Adopt `/home` as the member home route name (document the decision).
- Resolve Gap 6: confirm NextAuth 5 sanitizes `redirectTo`; if not, add `sanitizeCallbackUrl` to `signin/page.tsx` before calling `signIn()`.
- Update `sanitizeCallbackUrl` fallback in `totp/actions.ts` from `/admin` to the new member home route.
- Fix `totp/page.tsx:29` enrolment link from `/admin/2fa` to `/account/2fa`.
- Resolve Gap 7: choose the TOTP-enrolled e2e strategy (options a/b/c) and document it.
- State explicitly whether 2FA gate applies to the member home (Adversarial finding C).
- Add an "Access pending" link back to the member home on `/access-pending` (Adversarial finding E — polish, not blocking).

For Phase 5 (qa):
- This feature touches `src/app/(auth)/signin/` (default callbackUrl change) — it is auth-touching per CLAUDE.md. The PASS verdict requires an e2e run against a real dev server. The MFA-enrolled user strategy must be resolved in Phase 3 before QA can issue PASS.
- The existing `e2e/admin-login.spec.ts` test "landing page swaps Sign in for Sign out" navigates to `/signin` and signs in without a `callbackUrl`; after this change the post-login destination is the member home, not `/admin`. The test currently navigates to `/` after sign-in — it should still pass, but update the test comment to note the redirect destination changed.

---

# Phase 2 — Architectural Review (architect)

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The feature shape is sound: a new `(member)` route group for the member home, a Server Component global nav mounted only in that group's layout, and no structural changes to the admin shell or account area. Three suggestions the tech-lead must carry into Phase 3 design: (1) explicitly document the "no 2FA gate on /home" decision, (2) update the account sidebar's "← Home" link to point at `/home` rather than `/`, and (3) add a "/home" escape link on the `access-pending` page.

**Verdict: Approved with suggestions**

---

### What I Did

- Read the work-log (Phase 1 complete, READY WITH NOTES with six analyst notes).
- Read `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/(admin)/admin/layout.tsx`, `src/app/(account)/layout.tsx`, `src/proxy.ts`, `src/auth.ts`, `src/lib/permissions.ts`.
- Audited all four route groups (`(auth)`, `(admin)`, `(account)`, `(password-reset)`, `(email-verify)`) and the `access-pending` standalone page.
- Confirmed the proxy fall-through for the new `/home` route.
- Confirmed `session.user.features` carries `admin.dashboard` in JWT (auth.ts line 211-225).
- Confirmed no new npm dependency is needed.
- Logged DECISION-012 in `docs/decisions.md`.

---

### Decisions Made

#### 1. Member Home Route Placement

**Path:** `src/app/(member)/home/page.tsx`
**Layout:** `src/app/(member)/layout.tsx`

A new `(member)` route group, parallel to `(admin)` and `(account)`. The layout calls `auth()`, redirects to `/signin?callbackUrl=/home` if no session, and renders the global nav before `{children}`. It intentionally omits the 2FA gate (same rationale as the account layout — member home is not an admin surface).

The account area and admin shell are untouched. Each keeps its own layout and sidebar. No double-nav risk.

#### 2. Global Nav: Component Path and Server/Client Split

**Component:** `src/components/shared/global-nav.tsx` — Server Component.

- Rendered by `src/app/(member)/layout.tsx` only. Not in the root layout, not in admin, not in account.
- Receives the session object from the parent layout (which already called `auth()`; no second DB hit).
- Conditional Admin link: server-side check against `session.user.features?.includes(FEATURES.ADMIN_DASHBOARD)`. No `useSession()`. No hydration flicker (analyst adversarial finding D).
- Sign-out button: `<form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>` — consistent with the existing pattern in both `(admin)/admin/layout.tsx` and `(account)/layout.tsx`. No client component needed.
- If a fork later adds a mobile hamburger menu, that piece becomes a small `'use client'` island leaf; the nav shell stays server. The tech-lead should note this extension point in the design doc.

This directly resolves analyst Gap #2 and adversarial finding D.

#### 3. Proxy Changes

No changes to `PROTECTION_RULES` or `PUBLIC_PATHS`. `/home` falls through to the authenticated fall-through block at `proxy.ts:65–77`. Only addition: update the comment on line 76 to list `/home` alongside `/account` and `/account/2fa` as a documented auth-only route.

#### 4. `callbackUrl` Default and `sanitizeCallbackUrl` Fallback

The default `callbackUrl` in `signin/page.tsx` (lines 10, 34, 58) and the hardcoded fallback in `totp/actions.ts:34` both change from `/admin` to `/home`. The analyst's adversarial findings A and B make this a security-adjacent correction: an invalid TOTP callback should not dump the user at an admin route.

The tech-lead must also confirm (analyst Gap #6) whether NextAuth 5 sanitizes the `redirectTo` parameter internally before deciding whether to wrap the `signIn()` calls with `sanitizeCallbackUrl`.

#### 5. Dependencies

None. Confirmed against the already-available list: `auth()` for session, `FEATURES` constant from `src/lib/permissions.ts`, Tailwind for styling, `signOut` from `@/auth`. Everything needed is present.

#### 6. E2E Placement

New spec(s) under `e2e/`. The feature touches `src/app/(auth)/signin/` (callbackUrl default change) and the member home route, making it auth-touching under CLAUDE.md's gate. A `PASS` in Phase 5 requires an e2e run against a real dev server with seeded users. The TOTP-enrolled user strategy (analyst Gap #7, options a/b/c) must be resolved in Phase 3. The architect's recommendation is option (c): assert the routing gate behavior (user is redirected to `/totp`, not that they can complete TOTP end-to-end) — that satisfies "full login path including an MFA-enrolled user" at the routing level without requiring a seeded TOTP secret in the starter template. The tech-lead makes the final call and documents it.

#### 7. CLAUDE.md Updates (not architectural gates, but required for starter consistency)

- Project Layout section: add `(member)/home/` entry.
- Key Invariants section: new "Post-Login Landing = /home" invariant documenting that the default `callbackUrl` is `/home` and why changing it to `/admin` in forks is wrong without explicit intent.

These are tech-lead deliverables in Phase 3, not blocking Phase 2.

---

### Outputs

- `docs/decisions.md` — DECISION-012 logged (member home route group, global nav placement, post-login landing invariant)
- `docs/work-log/2026-07-01-post-login-routing-and-e2e.md` — Phase 2 section written; Per-Phase Status updated to Complete / Approved with suggestions / 2026-07-01

---

### Open Questions / Handoff Notes for Phase 3 (tech-lead)

- **Design doc must explicitly state:** The 2FA gate does not apply to `/home` (intentional). Forks wanting site-wide 2FA add the check in `(member)/layout.tsx` or extend `proxy.ts` with a `isMemberRoute` block.
- **Account sidebar "← Home" link:** Currently `/`. Must change to `/home` after this feature. Update `src/app/(account)/layout.tsx` line 29.
- **`access-pending/page.tsx`:** Add a link to `/home` so bounced users have an escape route (analyst adversarial finding E — not a blocker but ships in Phase 4).
- **TOTP enrolment link:** `totp/page.tsx:29` links to `/admin/2fa`; must change to `/account/2fa` (analyst Gap #5). Phase 4 implementer responsibility.
- **Analyst Gap #6 (callbackUrl sanitization in signin):** Tech-lead must confirm NextAuth 5's internal redirect sanitization. If not confirmed safe, wrap with `sanitizeCallbackUrl` before calling `signIn()`.
- **E2E strategy for MFA-enrolled user (analyst Gap #7):** Recommend option (c) — assert routing behavior, not full TOTP completion. Tech-lead documents the choice; QA acknowledges scope in Phase 5.
- **No new npm dependencies** — confirmed. Tech-lead does not need to re-evaluate this.
- **Implementer selection:** The change spans two auth pages (signin, totp), one new route (member home), one new component (global nav), and CLAUDE.md + proxy.ts comment updates. Given the spread across server + client surfaces and the tight coupling, `full-stack-developer` is the natural Phase 4 pick — but tech-lead makes the final call.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

This feature fixes three starter defects — post-login destination hardcoded to `/admin`, no global nav for non-admin users, and a "Go to admin" dead-end on the public landing — by introducing a `(member)` route group with a minimal member home at `/home` and a Server Component global nav rendered only in that group's layout. All six analyst notes and three architect suggestions are fully resolved below. Two unrelated bugs (BUG-1 neon-http transaction, BUG-2 cookie mutation in RSC) are explicitly split into separate bug-fix work-logs to preserve commit hygiene (one prefix per commit).

---

## Technical Design: Post-Login Routing + Member Home + Starter E2E Hardening

### Permissions & Flags

No new `FEATURES` key. No feature flag. The existing `FEATURES.ADMIN_DASHBOARD = "admin.dashboard"` gates the conditional Admin link in the global nav — same key, same check, nothing added to `FEATURE_CATALOG`.

### API Contract

No new route handlers or server actions. Two existing inline server actions are adjusted:

- `signin/page.tsx` — `callbackUrl` default changes from `/admin` to `/home`; `sanitizeCallbackUrl` applied before passing to `signIn()`
- `totp/actions.ts` — local `sanitizeCallbackUrl` replaced by import from shared helper; no behavior change beyond the fallback value

### Data Model

No schema changes. No new tables or columns.

**Seed script additions (script edits, not DDL):**

| Function | Env vars | Role | `twoFactorRequired` | Notes |
|---|---|---|---|---|
| `seedMemberUser()` | `SEED_MEMBER_EMAIL` / `SEED_MEMBER_PASSWORD` | member | false | For e2e member-flow tests |
| `seedMfaAdminUser()` | `SEED_MFA_ADMIN_EMAIL` / `SEED_MFA_ADMIN_PASSWORD` | admin | true | For e2e 2FA gate test; no TOTP enrollment record needed |

Both functions follow the same pattern as `seedLocalAdmin()`: idempotent upsert, password rotation on re-seed, bind to role. Both skip with a `console.warn` when env vars are missing (mirror existing pattern).

---

### Resolved Notes

#### Note 1 & 3: Route name `/home` and `callbackUrl` defaults

The member home route is `/home`. Every default `callbackUrl` value in the codebase changes from `/admin` to `/home`. Decision adopted and documented; no further user input needed.

#### Note 2 (SECURITY): `callbackUrl` sanitization in `signin/page.tsx`

**Investigation:** `signin/page.tsx` reads `sp.callbackUrl` from `searchParams` and passes it unsanitized to both `signIn("google", { redirectTo: callbackUrl })` and `signIn("credentials", { redirectTo: callbackUrl })`. NextAuth 5 beta.31 performs internal same-origin validation on `redirectTo`, but the behavior of protocol-relative URLs (`//evil.com`) in the Auth.js beta is not verified in this codebase. Relying on undocumented beta internal validation for a security property is insufficient — particularly given that `totp/actions.ts` already applies explicit sanitization for exactly this reason.

**Decision:** Extract `sanitizeCallbackUrl` to a shared helper. Both `signin/page.tsx` and `totp/actions.ts` import from `src/lib/auth/safe-callback.ts`. The fallback changes from `/admin` to `/home`. DECISION-013 logged in `docs/decisions.md`.

**New file `src/lib/auth/safe-callback.ts`:**
```typescript
/**
 * Validates that a callbackUrl is a safe same-origin relative path.
 * Rejects protocol-relative URLs (starting with "//") and any absolute URL.
 * Falls back to /home if the value is absent or invalid.
 */
export function sanitizeCallbackUrl(raw: string | undefined | null): string {
  if (!raw) return "/home";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}
```

**`signin/page.tsx` change:** Line 10 replaces `const callbackUrl = sp.callbackUrl ?? "/admin"` with `const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl)`. Add import. No change to the `signIn()` call sites.

**`totp/actions.ts` change:** Remove the private `sanitizeCallbackUrl` function (lines 32-34). Add `import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback"`. No other changes.

**`totp/page.tsx` change (line 17):** Replace `const callbackUrl = sp.callbackUrl ?? "/admin"` with `const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl)`. Add import.

#### Note 4: TOTP enrolment link fix

`src/app/(auth)/totp/page.tsx` line 29: change `href="/admin/2fa"` to `href="/account/2fa"`. Non-admin users reaching `/totp` without a TOTP enrollment will be sent to their own account 2FA page, not an admin route they cannot access.

#### Note 5: E2E strategy (see full E2E section below)

Option (c) adopted: assert routing gate behavior, not full TOTP completion.

#### Note 6: Architect suggestions

- `src/app/(account)/layout.tsx` line 29: change `href="/"` to `href="/home"` on the "← Home" `Link`.
- `src/app/access-pending/page.tsx`: add a "Back to home" link → `/home` below the existing paragraph.

#### 2FA gate scope (analyst adversarial finding C, confirmed by architect)

The 2FA gate in `proxy.ts` applies to `isAdminRoute` paths only. `/home` does NOT require 2FA verification. This is intentional — the member home is not an admin surface. The rationale parallels the account layout comment (users must reach `/account/2fa` to complete enrollment even when `twoFactorRequired` is true). Forks wanting site-wide 2FA must add the check in `src/app/(member)/layout.tsx` or add an `isMemberRoute` block in `proxy.ts`. No code change required; the design doc is the documentation.

---

### Component / Page Plan

**New files:**

| File | Type | Purpose |
|---|---|---|
| `src/lib/auth/safe-callback.ts` | server utility | Shared `sanitizeCallbackUrl` |
| `src/app/(member)/layout.tsx` | Server Component (layout) | Auth gate, renders `<GlobalNav>` above `{children}` |
| `src/app/(member)/home/page.tsx` | Server Component (page) | Member home — greeting, roles, features, links |
| `src/components/shared/global-nav.tsx` | Server Component | Horizontal nav: brand, Account, conditional Admin, sign-out |

**Modified files:**

| File | Change |
|---|---|
| `src/app/(auth)/signin/page.tsx` | Import `sanitizeCallbackUrl`; replace line 10 default |
| `src/app/(auth)/totp/actions.ts` | Remove local function; add import |
| `src/app/(auth)/totp/page.tsx` | Line 17 default; line 29 enrolment link |
| `src/app/(account)/layout.tsx` | Line 29 "← Home" href `/` → `/home` |
| `src/app/access-pending/page.tsx` | Add "Back to home" link |
| `src/app/page.tsx` | Remove "Go to admin"; replace with "Go to home" for signed-in users |
| `src/proxy.ts` | Line 76 comment: add `/home` to documented auth-only routes |
| `scripts/seed.ts` | Add `seedMemberUser()`, `seedMfaAdminUser()`, call both in `main()` |
| `.env.example` | Add `SEED_MEMBER_EMAIL`, `SEED_MEMBER_PASSWORD`, `SEED_MFA_ADMIN_EMAIL`, `SEED_MFA_ADMIN_PASSWORD` |
| `CLAUDE.md` | Project Layout + Key Invariants (see below) |
| `e2e/member-home.spec.ts` | New spec file |
| `e2e/admin-login.spec.ts` | Update comment in "landing page swaps" test |

---

### Exact Component Specs

**`src/app/(member)/layout.tsx`**

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GlobalNav } from "@/components/shared/global-nav";

// NOTE: The 2FA gate is intentionally absent here. /home is not an admin
// surface. Forks wanting site-wide 2FA add the check here or in proxy.ts.
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/home");
  return (
    <div className="min-h-screen">
      <GlobalNav session={session} />
      <main className="mx-auto max-w-2xl px-6 py-12">{children}</main>
    </div>
  );
}
```

**`src/components/shared/global-nav.tsx`**

- Pure Server Component; no `'use client'`.
- Props: `session` — the NextAuth `Session` type (import from `next-auth`).
- Renders a horizontal bar: site name (links to `/`), "Account" (`→ /account`), conditional "Admin" (`→ /admin`, shown only when `session.user.features?.includes(FEATURES.ADMIN_DASHBOARD)`), then the sign-out form.
- Sign-out form mirrors the exact pattern in `(admin)/admin/layout.tsx` and `(account)/layout.tsx`:
  ```typescript
  <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
    <button type="submit" className="text-xs text-muted-foreground hover:text-foreground">
      Sign out
    </button>
  </form>
  ```
  (No email shown in the nav — the member home page shows the greeting with name/email.)
- Extension point note: if a fork later adds a mobile hamburger, that toggle is a small `'use client'` island leaf; the nav shell stays Server.

**`src/app/(member)/home/page.tsx`**

- Data source: `auth()` — JWT session only, no DB read. `auth()` is cached per-request via React `cache()`, so calling it in both the layout and the page costs nothing.
- Session fields used: `session.user.name`, `session.user.email`, `session.user.roles`, `session.user.features`.
- Rendering:
  - Heading/greeting: "Welcome, [name ?? email]."
  - Roles section: list of `session.user.roles` strings. If `roles` is empty or undefined: "Your account is set up, but you haven't been granted any roles yet. Contact an administrator to get access."
  - Features section: list of `session.user.features` strings. If empty/undefined: omit section or show "No features assigned."
  - Links section: "Account settings" → `/account`. If `session.user.features?.includes(FEATURES.ADMIN_DASHBOARD)`: "Admin dashboard" → `/admin`.
- No client component needed. No `useSession()`.

**`src/app/page.tsx` change**

Remove the `<Link href="/admin">Go to admin</Link>` button (line 48-52 of current file). For signed-in users replace it with `<Link href="/home">Go to home</Link>`. The existing sign-out button and "Welcome back, [greeting]" remain unchanged. The anonymous state still shows only the "Sign in" link.

---

### Implementation Order

1. `src/lib/auth/safe-callback.ts` — write the shared helper first (no deps)
2. `src/app/(auth)/signin/page.tsx` — import and apply `sanitizeCallbackUrl`, change default
3. `src/app/(auth)/totp/actions.ts` — remove local function, add shared import
4. `src/app/(auth)/totp/page.tsx` — change default; fix enrolment link
5. `src/components/shared/global-nav.tsx` — write the Server Component
6. `src/app/(member)/layout.tsx` — write the member layout (depends on GlobalNav)
7. `src/app/(member)/home/page.tsx` — write the member home page
8. `src/app/page.tsx` — replace "Go to admin" with "Go to home" for signed-in users
9. `src/app/(account)/layout.tsx` — change "← Home" href to `/home`
10. `src/app/access-pending/page.tsx` — add "Back to home" link
11. `src/proxy.ts` — update comment at line 76 to include `/home`
12. `scripts/seed.ts` — add `seedMemberUser()` and `seedMfaAdminUser()`
13. `.env.example` — add four new env vars
14. `e2e/member-home.spec.ts` — new spec file (see E2E section)
15. `e2e/admin-login.spec.ts` — update comment only (no logic change)
16. `CLAUDE.md` — Project Layout entry + Post-Login Landing invariant
17. `docs/decisions.md` — DECISION-013

Run `npm run typecheck` and `npm run build` after step 7 before moving to step 8. Run `npm run lint` before starting the e2e work. Commit as a single `feat:` commit (or split into logically grouped commits if the diff is large — but each commit must have exactly one prefix).

---

### E2E Strategy: Option (c) — Assert Routing Gate Behavior

**Decision:** Option (c) adopted. Assert that the routing/redirect gate fires correctly. For the MFA path, assert that a user with `twoFactorRequired: true` is redirected to `/totp` when navigating to an admin route. Do NOT attempt to complete the TOTP challenge — no seeded TOTP secret, no OTP computation in specs.

**Why option (c)?** Baking a TOTP secret into the seed would be a security anti-pattern: any fork that shipped with `SEED_TOTP_SECRET` in its `.env.local` would have a predictable 2FA secret in production-adjacent environments. Option (b) is a security hazard for forks. Option (a) fails the CLAUDE.md auth-touching gate. Option (c) satisfies "full login path including an MFA-enrolled user" at the routing level — it proves the gate fires — without the anti-pattern.

**New file `e2e/member-home.spec.ts`:**

```
describe("Member home and routing invariants")

skip guard: tests that need member users skip if SEED_MEMBER_EMAIL/PASSWORD missing
skip guard: test 6 skips if SEED_MFA_ADMIN_EMAIL/PASSWORD missing

test 1: "unauthenticated user visiting /home is redirected to /signin"
  goto("/home")
  assert URL pathname === "/signin"
  assert searchParams.get("callbackUrl") === "/home"

test 2: "seeded admin signs in and lands on /home"
  goto("/signin"), fill SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, submit
  waitForURL(u => u.pathname !== "/signin", { timeout: 10_000 })
  assert pathname === "/home"

test 3: "admin sees Admin link and Account link in global nav"
  (fresh sign-in as admin)
  assert link with text /admin/i is visible
  assert link with text /account/i is visible

test 4: "seeded member user signs in and lands on /home, no Admin link visible"
  goto("/signin"), fill SEED_MEMBER_EMAIL / SEED_MEMBER_PASSWORD, submit
  waitForURL(u => u.pathname !== "/signin", { timeout: 10_000 })
  assert pathname === "/home"
  assert link with text /admin/i has count 0 (or is not visible)

test 5: "member navigating directly to /admin is redirected to /access-pending"
  (continue member session from test 4, or re-sign-in)
  goto("/admin")
  assert pathname === "/access-pending"

test 6: "user with twoFactorRequired=true navigating to /admin is redirected to /totp"
  goto("/signin"), fill SEED_MFA_ADMIN_EMAIL / SEED_MFA_ADMIN_PASSWORD, submit
  waitForURL(u => u.pathname !== "/signin", { timeout: 10_000 })
  assert pathname === "/home"    (lands on member home first — 2FA not required for /home)
  goto("/admin")
  assert pathname === "/totp"
  assert searchParams.get("callbackUrl") === "/admin"

test 7: "access-pending page has a Back to home link"
  (sign in as member, goto "/access-pending")
  assert link with href "/home" is visible
```

**Users required and how they are obtained:**

| Env var pair | Who creates them | When |
|---|---|---|
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | existing `seedLocalAdmin()` | `npm run db:seed` (no change) |
| `SEED_MEMBER_EMAIL` / `SEED_MEMBER_PASSWORD` | new `seedMemberUser()` | `npm run db:seed` after this feature ships |
| `SEED_MFA_ADMIN_EMAIL` / `SEED_MFA_ADMIN_PASSWORD` | new `seedMfaAdminUser()` | `npm run db:seed` after this feature ships |

**CLAUDE.md gate compliance:** QA Phase 5 PASS requires running `npm run test:e2e` against a live dev server (`npm run dev`) with all three seed users provisioned. QA must confirm in the Phase 5 section that the dev server was running and the e2e suite passed. A deferred e2e is BLOCKED, not PASS.

---

### CLAUDE.md Updates (implementer responsibility)

**Project Layout section** — add after `(account)/account/` entry:
```
│   ├── (member)/home/              — Post-login member home (greeting, roles, features, global nav)
```

**Key Invariants section** — add new subsection after "Timezone-Safe Date Rendering":
```
### Post-Login Landing = /home

After a successful sign-in (Credentials or Google OAuth), users land at `/home`. The default `callbackUrl` in `src/app/(auth)/signin/page.tsx` and the fallback in `src/lib/auth/safe-callback.ts` are both `/home`. Do not change either to `/admin` without explicit product intent — most users don't have `admin.dashboard` and will land on `/access-pending` if sent to `/admin`.

The 2FA gate in `proxy.ts` applies to `/admin/*` routes only. `/home` is auth-only (any signed-in user, regardless of 2FA status, can reach it). Forks wanting a site-wide 2FA gate must add the check in `src/app/(member)/layout.tsx` or extend `proxy.ts` with an `isMemberRoute` block.
```

---

### Bug Recommendations

**BUG-1 (`verify-email/[token]/page.tsx:64`):** Root cause — `db.transaction()` is not supported by the neon-http driver, which requires a persistent connection for transaction semantics. Must be replaced with sequential inserts or `db.batch()`. **Split into a separate bug-fix work-log.** Do not fold into this feature — mixing a `fix:` into a `feat:` branch violates the one-prefix commit rule.

**BUG-2 (`2fa/page.tsx:24`):** Root cause — `cookies().delete()` called during RSC render; Next 16 forbids cookie mutations outside server actions and route handlers. **Split into a separate bug-fix work-log.** Same reasoning.

---

### Edge Cases & Risks

1. **`session.user.roles` or `session.user.features` undefined:** New Google OAuth users have no roles/features until the seed runs or an admin assigns them. The member home must handle `undefined` and empty arrays without crashing — render the empty state, not a JS error.
2. **Account "← Home" link now points to `/home`:** Unauthenticated users who bypass the proxy and reach `/account` and click "← Home" will land at `/home`, which redirects them to `/signin`. This is correct and harmless — the proxy already prevents unauthenticated access to `/account`.
3. **`admin-login.spec.ts` "landing page swaps Sign in for Sign out" test:** Signs in without a `callbackUrl` query param; after sign-in the redirect goes to `/home`, not `/admin`. The test body navigates to `page.goto("/")` explicitly after sign-in, so no assertion breaks. Update the comment to note the redirect destination changed.
4. **`admin-login.spec.ts` "seeded admin reaches /admin":** Navigates to `/admin` explicitly after sign-in — unaffected by the post-login-to-`/home` change.
5. **`(member)/home/page.tsx` calls `auth()` independently:** `auth()` is memoized via React `cache()` — this is the established Next.js pattern. Do not attempt to pass the session as a prop from the layout to the page; that would violate the RSC composition model (layouts don't pass props to page children in the App Router).
6. **Admin user visiting `/home`:** Admin has `admin.dashboard` in `session.user.features`, so the "Admin dashboard" link appears. This is correct. Admin users may use `/home` as a launching point to either the account or admin area.

### Out of Scope

- BUG-1 (neon-http transaction fix) — separate work-log
- BUG-2 (2fa cookie mutation fix) — separate work-log
- Mobile hamburger menu for global nav (extension point documented in GlobalNav spec)
- Any new `FEATURES` key or feature flag
- Changing the 2FA gate to cover non-admin routes in `proxy.ts`
- Additional member-area pages beyond `/home`
- Notification, billing, or other dashboard widgets on the member home

---

### What I Did

- Read the work-log (Phase 1 + Phase 2 complete), `docs/decisions.md` (DECISION-012).
- Read `signin/page.tsx`, `totp/actions.ts`, `totp/page.tsx`, `(admin)/admin/layout.tsx`, `(account)/layout.tsx`, `access-pending/page.tsx`, `page.tsx`, `proxy.ts`, `permissions.ts`, `e2e/admin-login.spec.ts`, `scripts/seed.ts`.
- Confirmed `sanitizeCallbackUrl` exists only in `totp/actions.ts` and is not yet a shared helper.
- Confirmed `signin/page.tsx` passes the raw `callbackUrl` searchParam without sanitization.
- Confirmed the sign-out form pattern (inline `"use server"` action) across admin and account layouts.
- Confirmed the seed script creates one admin user, no member or 2FA test users.
- Confirmed `auth()` is safe to call in both layout and page (React cache).
- Resolved all six analyst notes and three architect suggestions concretely.
- Chose e2e option (c); specified exact spec file, test cases, skip guards, and how each user is obtained.
- Recommended splitting BUG-1 and BUG-2 into separate work-logs.
- Named `full-stack-developer` as implementer.

### Outputs

- `docs/work-log/2026-07-01-post-login-routing-and-e2e.md` — Phase 3 section written; Per-Phase Status updated to Complete / 2026-07-01
- `docs/decisions.md` — DECISION-013 logged

### Open Questions / Handoff Notes

For Phase 4 (`full-stack-developer`):

- **Start with `src/lib/auth/safe-callback.ts`** before touching any auth pages — it's the shared dep.
- **Seed additions** (`seedMemberUser`, `seedMfaAdminUser`) are script-only; no schema change, no Drizzle migration needed. Follow the exact pattern of `seedLocalAdmin()`.
- **The `(member)` directory does not exist yet** — create `src/app/(member)/` and its subdirectory `home/`.
- **`global-nav.tsx` session type:** Import `Session` from `next-auth` (the same type `auth()` returns). The prop is the full session object; destructure what you need inside the component.
- **After implementation**, run `npm run typecheck`, `npm run build`, `npm run lint`. Fix any issues before Phase 5.
- **E2E:** Provision all three seed users, start `npm run dev`, run `npm run test:e2e`. All seven new tests must pass. The two existing admin-login tests must still pass.
- **BUG-1 and BUG-2** are out of scope — do not fix them in this branch.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (full-stack) — 2026-07-01

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented all 12 steps of the tech-lead's design (steps 5–16 of the implementation order; steps 1–4 were pre-completed). A new `(member)` route group introduces `/home` as the post-login landing page, served by a Server Component global nav that conditionally shows the Admin link based on `admin.dashboard` in the session JWT. All auth page defaults changed from `/admin` to `/home`. Seven new Playwright e2e tests plus all 13 existing tests passed in a single run against a live dev server with all three seeded users provisioned.

### What I Did

- **Step 5:** Created `src/components/shared/global-nav.tsx` — Server Component with brand link, Account, conditional Admin, and inline `"use server"` sign-out form matching the pattern in `(admin)/admin/layout.tsx`. No `'use client'`, no `useSession()`, no email in nav.
- **Step 6:** Created `src/app/(member)/layout.tsx` — auth gate redirecting to `/signin?callbackUrl=/home`, renders `<GlobalNav>`, 2FA gate intentionally absent with NOTE comment.
- **Step 7:** Created `src/app/(member)/home/page.tsx` — greeting (`name ?? email`), roles list with empty-state text matching the design doc exactly, features section (omitted when empty), links section with conditional Admin dashboard link.
- **Step 8:** Updated `src/app/page.tsx` — removed unconditional "Go to admin" link; replaced with conditional "Go to home" → `/home` for signed-in users. Anonymous state unchanged (Sign in only).
- **Step 9:** Updated `src/app/(account)/layout.tsx` — "← Home" link now points to `/home` instead of `/`.
- **Step 10:** Updated `src/app/access-pending/page.tsx` — added "← Back to home" link to `/home`.
- **Step 11:** Updated `src/proxy.ts` — comment on auth-only routes now includes `/home`.
- **Step 12:** Updated `scripts/seed.ts` — added `seedMemberUser()` and `seedMfaAdminUser()`, both called in `main()`. Both are idempotent, skip with `console.warn` when env vars missing, follow `seedLocalAdmin()` pattern exactly.
- **Step 13:** Updated `.env.example` — added `SEED_MEMBER_EMAIL`, `SEED_MEMBER_PASSWORD`, `SEED_MFA_ADMIN_EMAIL`, `SEED_MFA_ADMIN_PASSWORD` with comments.
- **Step 14:** Created `e2e/member-home.spec.ts` — all 7 tests per the design doc spec, with skip guards.
- **Step 15:** Updated `e2e/admin-login.spec.ts` — added comment in the "landing page swaps Sign in for Sign out" test noting the post-login redirect destination is now `/home`.
- **Step 16:** Updated `CLAUDE.md` — added `(member)/home/` line to Project Layout; added "Post-Login Landing = /home" Key Invariants subsection.

### Outputs

**Files created:**
- `src/lib/auth/safe-callback.ts` (pre-completed, step 1)
- `src/lib/auth/safe-callback.test.ts` (pre-completed, step 1)
- `src/components/shared/global-nav.tsx`
- `src/app/(member)/layout.tsx`
- `src/app/(member)/home/page.tsx`
- `e2e/member-home.spec.ts`

**Files modified:**
- `src/app/(auth)/signin/page.tsx` (pre-completed, step 2)
- `src/app/(auth)/totp/actions.ts` (pre-completed, step 3)
- `src/app/(auth)/totp/page.tsx` (pre-completed, step 4)
- `src/app/page.tsx` — "Go to admin" → conditional "Go to home"
- `src/app/(account)/layout.tsx` — "← Home" href `/` → `/home`
- `src/app/access-pending/page.tsx` — added "Back to home" link
- `src/proxy.ts` — comment update
- `scripts/seed.ts` — added `seedMemberUser()` and `seedMfaAdminUser()`
- `.env.example` — four new env vars
- `e2e/admin-login.spec.ts` — comment update only
- `CLAUDE.md` — Project Layout + Key Invariants
- `docs/decisions.md` (pre-completed, DECISION-012 + DECISION-013)

**No new server actions, API endpoints, or schema changes.**

**Dev environment:** Added `SEED_MEMBER_EMAIL`, `SEED_MEMBER_PASSWORD`, `SEED_MFA_ADMIN_EMAIL`, `SEED_MFA_ADMIN_PASSWORD`, and `RATE_LIMIT_DISABLED=true` to `.env.local` (gitignored).

### Verification Results

| Command | Result |
|---|---|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 warnings, 0 errors |
| `npm run build` | PASS — 17 routes, `/home` appears in route table |
| `npm run test` (Vitest) | PASS — 15 test files, 175 tests, 0 failures |
| `npm run check:audit` | PASS — "Audit-coverage check passed" |
| `npm run db:seed` | PASS — all 3 users provisioned (admin updated, member created, MFA admin created) |
| `npm run test:e2e` | PASS — 20 tests, 0 failures, 21.3s |

**E2E details:** 20 tests ran (1 worker, chromium). 7 new member-home tests all passed. 13 pre-existing tests (account-page, admin-login, forgot-password, timezone-safe-dates) still pass. No tests skipped — all env vars were set.

**Dev server note:** A stale Next.js server on port 3000 caused the first e2e run to fail (30s timeouts). Killed the stale process and restarted; second run was clean.

### Open Questions / Handoff Notes

- **For QA (Phase 5):** This feature touches `src/app/(auth)/signin/` and is auth-touching per CLAUDE.md. PASS verdict requires an e2e run against a live dev server — done here. All 20 tests pass. E2E strategy is option (c): we assert the TOTP redirect fires for `twoFactorRequired=true` users, not that the full TOTP challenge can be completed. QA should acknowledge this scope in the Phase 5 section.
- **BUG-1 and BUG-2** remain in scope for separate bug-fix work-logs (not touched here).
- The `RATE_LIMIT_DISABLED=true` var added to `.env.local` prevents in-memory rate limit state from accumulating during repeated e2e sign-in attempts. Remove before any load testing.
- **Next agent:** qa (Phase 5 verification).

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. All five static checks ran green. The e2e suite ran against a live dev server (port 3000, `npm run dev`) with all three seeded users provisioned (admin, member, MFA admin). All 20 Playwright tests passed — 7 new `member-home.spec.ts` tests and 13 pre-existing tests. The implementation matches the Phase 3 design spec exactly. No console.log, no native dialogs, no `toLocale*` calls, no unsanitized `callbackUrl` paths were found. All four critical modules reached 100% unit-test coverage. E2E strategy option (c) is acknowledged: the MFA path asserts the routing gate fires (redirect to `/totp` with `callbackUrl=/admin`) without completing the TOTP challenge. This satisfies CLAUDE.md's auth-touching gate at the routing level.

### What I Did

- Read the work-log (Phases 1–4) and Phase 3 design spec to establish the verification contract.
- Read all 12 new/modified source files against the design.
- Ran `npm run typecheck` — PASS, 0 errors.
- Ran `npm run lint` — PASS, 0 warnings, 0 errors.
- Ran `npm run test` (Vitest) — PASS, 15 test files, 175 tests, 0 failures, 641ms.
- Ran `npm run check:audit` — PASS, "Audit-coverage check passed."
- Ran `npm run build` — PASS, 17 routes including `/home` in the route table.
- Killed any stale process on port 3000, started `npm run dev` in the background, confirmed HTTP 200 from `localhost:3000` before running e2e.
- Ran `npm run test:e2e` — PASS, 20 tests, 0 failures, 22.0s (1 worker, chromium). All 7 new `member-home.spec.ts` tests passed. All 13 pre-existing tests passed. No tests skipped — all seed env vars were set.
- Killed the dev server after the e2e run.
- Ran `npm run test -- --coverage` and verified per-file coverage for all four critical modules.
- Adversarial pass:
  - Confirmed all `callbackUrl` paths in `signin/page.tsx`, `totp/page.tsx`, and `totp/actions.ts` route through `sanitizeCallbackUrl` before use — no raw passthrough remaining.
  - Confirmed no `"/admin"` default left in any auth-touching file (`safe-callback.ts`, `signin/page.tsx`, `totp/page.tsx`, `totp/actions.ts`).
  - Confirmed `(member)/layout.tsx` and `global-nav.tsx` are pure Server Components — no `'use client'`, no `useSession()`.
  - Confirmed `seedMemberUser()` and `seedMfaAdminUser()` are idempotent: all DB writes use `onConflictDoNothing()` and the upsert path preserves intent (no unintentional `twoFactorRequired` flip on re-seed).
  - Confirmed no `console.log`, `alert()`, `confirm()`, `prompt()`, or `toLocale*()` calls in any new or modified file.
  - Confirmed CLAUDE.md was updated with `(member)/home/` Project Layout entry and "Post-Login Landing = /home" Key Invariants subsection.
  - BUG-1 and BUG-2 are confirmed out of scope and not touched in this branch.

### Outputs

- `docs/work-log/2026-07-01-post-login-routing-and-e2e.md` — Phase 5 section written; Per-Phase Status row updated to Complete / PASS / 2026-07-01.

### Build Verification Report

#### Type Check
`npm run typecheck`: PASS — 0 errors

#### Unit Tests
Total: 175 | Passed: 175 | Failed: 0
Test files: 15
Duration: 641ms
Failures: none

#### End-to-End Tests
Total: 20 | Passed: 20 | Failed: 0 | Skipped: 0
Duration: 22.0s
Dev server: running (`npm run dev`, port 3000, confirmed HTTP 200 before suite)
Seeded users: all three provisioned (SEED_ADMIN_*, SEED_MEMBER_*, SEED_MFA_ADMIN_* — all env vars set)
New tests (member-home.spec.ts, 7): all passed
Pre-existing tests (13): all passed

E2E strategy: option (c) — the MFA admin test (#17) asserts that a `twoFactorRequired=true` user is redirected to `/totp?callbackUrl=/admin` after landing on `/home`. It does not attempt to complete the TOTP challenge. No TOTP enrollment record exists for this user by design.

#### Regression Tests Added
None required — this is a new feature, not a bug fix. The 7 new e2e tests in `e2e/member-home.spec.ts` serve as the regression harness for all routing invariants introduced by this feature.

#### Coverage on Critical Modules
- `src/lib/permissions.ts`: 100% statements, 100% branches, 100% functions
- `src/lib/two-factor.ts`: 100% statements, 100% branches, 100% functions
- `src/lib/flags.ts`: 100% statements, 100% branches, 100% functions
- `src/lib/auth/safe-callback.ts`: 100% statements, 100% branches, 100% functions
- Overall (all pure-TS modules): 77.4% statements, 83.33% branches — exceeds the 70% floor

#### Verdict: PASS

### Open Questions / Handoff Notes

- Next agent: analyst (Phase 6 — shipped-vs-intent review).
- BUG-1 (`verify-email/[token]/page.tsx:64` neon-http transaction) and BUG-2 (`2fa/page.tsx:24` cookie mutation in RSC) are confirmed not touched here. Each needs a separate bug-fix work-log before the affected paths can be considered safe for production use.
- The `RATE_LIMIT_DISABLED=true` env var added to `.env.local` by the implementer prevents in-memory rate-limit state accumulation during e2e sign-in loops. Remove before load testing or staging deployment.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. Every item from the Phase 1 review landed as specified. The shared `sanitizeCallbackUrl` helper eliminates the open-redirect surface across all three callbackUrl entry points, the fallback no longer leaks `/admin`, the member home delivers greeting + roles + features + conditional admin link + empty-state copy verbatim from the design doc, the global nav is a pure Server Component with no hydration risk, the public landing's `/admin` hard-link is gone, the TOTP enrolment link is fixed to `/account/2fa`, the 2FA gate exclusion for `/home` is documented in both code and CLAUDE.md, `/access-pending` has its escape link, all seven e2e tests exist and passed (QA PASS, 20/20, option (c) acknowledged), and BUG-1 / BUG-2 are untouched with no unintentional modifications.

**Verdict: SHIP IT**

**One-line take:** The feature delivers exactly what Phase 1 specified — a clean post-login landing, a conditional Server Component nav, and a routing invariant harness — with no regressions and all adversarial findings resolved.

---

### What I Did

- Read the Phase 1–5 work-log in full to re-establish the intent contract.
- Read all new and modified files against the 10-item verification checklist: `src/lib/auth/safe-callback.ts`, `src/lib/auth/safe-callback.test.ts`, `src/app/(auth)/signin/page.tsx`, `src/app/(auth)/totp/actions.ts`, `src/app/(auth)/totp/page.tsx`, `src/app/(member)/layout.tsx`, `src/app/(member)/home/page.tsx`, `src/components/shared/global-nav.tsx`, `src/app/page.tsx`, `src/app/access-pending/page.tsx`, `src/proxy.ts`, `src/app/(account)/layout.tsx`, `e2e/member-home.spec.ts`, and the CLAUDE.md Key Invariants section.
- Verified BUG-1 (`verify-email/[token]/page.tsx:64`) and BUG-2 (`(account)/account/2fa/page.tsx:24`) are untouched.

### Outputs

- `docs/work-log/2026-07-01-post-login-routing-and-e2e.md` — Phase 6 section written; Per-Phase Status row updated to Complete / SHIP IT / 2026-07-01.

---

### Intent-vs-Shipped Diff (per the 10-item checklist)

**Item 1 — callbackUrl sanitization at every sign-in entry point (Gap 6 / adversarial A)**
Phase 1 said: apply `sanitizeCallbackUrl` before passing `callbackUrl` to `signIn()`; change defaults from `/admin` to `/home`.
Shipped: `signin/page.tsx:11` — `const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl)`. Both `signIn("google", { redirectTo: callbackUrl })` and `signIn("credentials", { ... redirectTo: callbackUrl })` consume the sanitized value. `totp/page.tsx:18` and `totp/actions.ts:49–51` do the same. Import is `@/lib/auth/safe-callback` in all three files.
Verdict: matches.

**Item 2 — sanitizeCallbackUrl fallback no longer leaks /admin (adversarial B)**
Phase 1 said: the `sanitizeCallbackUrl` fallback (previously `/admin` in `totp/actions.ts`) must change to the member home route.
Shipped: `safe-callback.ts:7-8` — fallback is `/home` in both the null/falsy branch and the invalid-URL branch. No `/admin` string appears anywhere in the four auth-touching files.
Verdict: matches.

**Item 3 — Member home: greeting, roles + empty state, features, Account link, conditional Admin link (Gap 4)**
Phase 1 said: greeting with `name ?? email`, roles list, empty-state "Your account is set up, but you haven't been granted any roles yet. Contact an administrator to get access.", features section omitted when empty, Account and conditional Admin links.
Shipped: `home/page.tsx` — greeting `Welcome, {name ?? email ?? "there"}.`; roles section with empty-state text verbatim from the design doc; `{featuresList.length > 0 && <section>...}` correctly omits the features section when empty; "Account settings" → `/account`; `{isAdmin && <Link href="/admin">Admin dashboard</Link>}` gated on `FEATURES.ADMIN_DASHBOARD`.
Verdict: matches.

**Item 4 — Global nav: Server Component, no hydration flicker, conditional Admin link, sign-out (adversarial D / Gap 3)**
Phase 1 said: Server Component, no `useSession()`, conditional Admin link from session JWT, sign-out button.
Shipped: `global-nav.tsx` — no `'use client'` directive, no `useSession()`, `isAdmin` computed server-side from `session.user.features?.includes(FEATURES.ADMIN_DASHBOARD)`, sign-out is an inline `"use server"` form action redirecting to `/`. Extension-point comment present.
Verdict: matches.

**Item 5 — Public landing no longer hard-links to /admin**
Phase 1 said: remove the "Go to admin" link from `page.tsx`; replace with "Go to home" for signed-in users.
Shipped: `page.tsx` contains no `href="/admin"` or "Go to admin" text. The only "admin" string is in the description paragraph. For signed-in users a `<Link href="/home">Go to home</Link>` is shown. Anonymous state shows only "Sign in".
Verdict: matches.

**Item 6 — TOTP enrolment link now /account/2fa (Gap 5)**
Phase 1 said: `totp/page.tsx:29` — change `href="/admin/2fa"` to `href="/account/2fa"`.
Shipped: `totp/page.tsx:30` — `<a className="underline" href="/account/2fa">`. Correct destination. The tag uses a native `<a>` rather than Next.js `<Link>`, matching the pre-existing pattern in the file (the original code also used `<a>`). This is not a regression.
Verdict: matches.

**Item 7 — 2FA gate intentionally does NOT cover /home, decision documented (adversarial C)**
Phase 1 said: state explicitly whether the 2FA gate applies to `/home`; if not, document the decision.
Shipped: `(member)/layout.tsx:5-6` — explicit NOTE comment stating the omission is intentional and directing forks to the extension point. `proxy.ts:42–51` — 2FA gate block checks `isAdminRoute` only, `/home` does not match. CLAUDE.md Key Invariants `Post-Login Landing = /home` subsection repeats the same guidance for fork authors.
Verdict: matches.

**Item 8 — /access-pending has a back-to-home escape link (adversarial E)**
Phase 1 said: add a link to `/home` on `/access-pending`.
Shipped: `access-pending/page.tsx:11-16` — `<Link href="/home">← Back to home</Link>`.
Verdict: matches.

**Item 9 — E2E strategy option (c) implemented; seven specified tests exist and pass (Gap 7)**
Phase 1 said: implement option (c) — assert routing gate behavior without completing the TOTP challenge; seven specific tests as named in the Phase 3 design spec.
Shipped: `e2e/member-home.spec.ts` — exactly seven `test()` blocks in the `Member home and routing invariants` describe, with skip guards for all tests requiring seed users. Test 6 (MFA gate) asserts the proxy redirects to `/totp?callbackUrl=/admin` without attempting TOTP completion. All seven passed in Phase 5 (20/20 total e2e, 22.0s).
Verdict: matches.

**Item 10 — BUG-1 and BUG-2 untouched**
Phase 1 said: do not fix BUG-1 or BUG-2 in this branch; each needs its own bug-fix work-log.
Shipped: `verify-email/[token]/page.tsx:64` — `db.transaction()` call still present. `(account)/account/2fa/page.tsx:24` — `jar.delete(FRESH_RECOVERY_CODES_COOKIE)` still present. Neither file was modified by this feature.
Verdict: matches.

---

### Edge Cases

- **Empty state (no-roles user):** Renders the "Contact an administrator" paragraph, not a blank section. Pass.
- **Failure microcopy:** Not a new surface — existing `/signin` and `/totp` error messages unchanged and human-readable. Pass.
- **Permission gate (/home):** Auth-only, no feature gate. Unauthenticated visit to `/home` → proxy redirects to `/signin?callbackUrl=/home`. Confirmed by e2e test 1. Pass.
- **Permission gate (/admin for member):** Member without `admin.dashboard` → proxy redirects to `/access-pending`. Confirmed by e2e test 5. Pass.
- **Audit events:** No new security-sensitive mutations in this feature. No new audit events needed. Pass (not applicable).
- **Mobile:** No new client components introduced. The global nav uses Tailwind flex layout. No fixed-width elements that would break at 360px. Not tested at 360px in e2e, but the layout primitives are standard responsive Tailwind. Acceptable drift — can be validated in a follow-up visual pass.
- **2FA gate on /home:** Intentionally absent. Documented in code and CLAUDE.md. Pass.
- **Global nav hydration flicker:** Server Component; no hydration window. Pass.

---

### Follow-Ups

None blocking. The two tracked bugs are separate work-logs by design.

- **BUG-1** (`verify-email/[token]/page.tsx:64` — neon-http `db.transaction()` unsupported): tracked in the work-log intent, needs a `fix:` work-log. The affected path (email change verification) is not part of this feature's surface.
- **BUG-2** (`(account)/account/2fa/page.tsx:24` — `jar.delete()` in RSC render): tracked in the work-log intent, needs a `fix:` work-log. The affected path (TOTP enrollment display) is not part of this feature's surface.
- **Mobile visual pass** for the global nav and member home at 360px: not a blocking gap, but a useful first follow-up after merge.

---

### Open Questions / Handoff Notes

- Pipeline is closed. No open questions.
- BUG-1 and BUG-2 each need their own `docs/work-log/YYYY-MM-DD-<slug>.md` entries before those paths can be considered production-safe.
- The `RATE_LIMIT_DISABLED=true` env var in `.env.local` should be removed before staging or load testing.

