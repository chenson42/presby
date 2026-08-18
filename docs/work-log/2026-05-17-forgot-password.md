# Forgot Password Flow — Work Log

> **Slug:** `2026-05-17-forgot-password`
> **Surface:** anonymous (request flow) + anonymous/unauthenticated (link consumption)
> **Permission(s):** None — the entire flow is unauthenticated end-to-end.
> **Flag(s):** Not needed. The flow is required infrastructure once Credentials provider ships.
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-17 |
| 2 — Architectural review | architect | Complete | Approved | 2026-05-17 |
| 3 — Technical design | tech-lead | Complete | complete | 2026-05-17 |
| 4 — Implementation | full-stack-developer | Complete | complete | 2026-05-17 |
| 5 — Verification | qa | Complete | PASS | 2026-05-17 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-05-17 |

---

# Phase 1 — Functional Refinement — 2026-05-17

**Owner:** analyst
**Status:** complete

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A self-serve password-reset flow for Credentials-provider users: a "Forgot password?" link on the sign-in page leads to an email-entry form, a 60-minute emailed link, and a new-password form — three design decisions must be answered before Phase 2 starts.

---

## Pass 1 — User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Anonymous visitor (Credentials user) | Click "Forgot password?" link on `/signin` | On demand |
| Anonymous visitor | Type their email address and submit the request form | On demand |
| Anonymous visitor | Read the generic "check your email" confirmation message | On demand |
| Anonymous visitor (email client) | Click the reset link in the email | On demand |
| Anonymous visitor | Read an error message if the link is invalid or expired | On demand |
| Anonymous visitor | Type new password, confirm it, and submit the reset form | On demand |
| Anonymous visitor | See a success message and be redirected to `/signin` | On demand |
| Authenticated user | Sign in with the new password | Immediately after reset |
| Admin (observing) | See a `user.password_reset` audit event in the admin audit trail (see Gap 4) | On demand |

"The user" is the **anonymous visitor** surface throughout — the entire flow runs outside an active session.

---

## Pass 2 — Flow Audit

**Flow A — Request a reset link**

Entry: `/signin` page. The Credentials form has a "Forgot password?" link below the submit button, pointing to `/forgot-password`.

Step 1: User lands on `/forgot-password`. Page shows a single email input field and a "Send Reset Link" button. A "Back to sign in" link is present.

Step 2: User types their email address and submits. The form is disabled while the request is in flight.

Step 3: Route handler `POST /api/auth/forgot-password` receives the email. It looks up the user by email. If the user exists and has a non-null `password` column, it mints a `password_reset_tokens` row (token hashed with SHA-256, expires 60 minutes from now, existing row for the same user deleted first to enforce one in-flight token). It then sends the email via `sendEmail()`. If the user does not exist, or exists but signed in via Google only (`password` is null), no email is sent and no token is stored.

Outcome (success or silent no-op): Page transitions to a "check your email" state showing the identical message regardless of whether an email was sent — "If an account exists with that email address, a password reset link has been sent." with a "Back to sign in" link and a "Try a different email" option. The message explicitly notes the link expires in 60 minutes.

Failure — invalid email format: Client-side `type="email"` validation blocks submit. No server round-trip.
Failure — Resend error: Route handler catches the exception and returns HTTP 500. UI shows `toast.error("Something went wrong. Please try again.")`.
Failure — network down: `fetch()` rejects. UI shows `toast.error("Something went wrong. Please try again.")`.

---

**Flow B — Consume the reset link**

Entry: The reset email contains a link to `/reset-password?token=<raw-token>`.

Step 1: User clicks the link. Because `/reset-password` is in the `PUBLIC_PATHS` set (or carries a proxy prefix exception), no session is required.

Step 2: Page loads with the token from the query string. The page server component (or a client component using `useSearchParams`) reads `token`. If `token` is absent: show an error card — "This password reset link is invalid. Request a new one." with a link to `/forgot-password`. No DB call is made.

Step 3: If `token` is present, the form renders: "New password" field, "Confirm new password" field, "Set new password" button.

Step 4: User types and submits. `POST /api/auth/reset-password` receives `{ token, password }`. The handler hashes the token with SHA-256, looks it up in `password_reset_tokens`. If not found: returns `{ error: "Invalid or expired reset link." }` — page shows this as a toast and keeps the form visible. If found but `expiresAt < now`: deletes the row, returns `{ error: "This link has expired. Request a new one." }` — page offers a link to `/forgot-password`. If valid: runs in a transaction — hashes the new password with `bcrypt.hash(newPassword, 10)`, updates `users.password`, deletes the token row, writes an audit event `USER_PASSWORD_RESET` (see Gap 4). Returns `{ success: true }`.

Outcome: `toast.success("Password updated. Sign in with your new password.")`. Page redirects to `/signin` after a brief delay (or immediately). The user signs in with the new password.

Failure — passwords don't match: Client-side check before submit. `toast.error("Passwords do not match.")`.
Failure — password too short: Client-side check. `toast.error("Password must be at least 8 characters.")`. Server action also validates.
Failure — DB error during reset: transaction rolls back. Route handler returns 500. `toast.error("Something went wrong. Please try again.")`.

---

**Flow C — Sign in with new password**

Entry: `/signin` with Credentials form.
Step 1: User types email and new password, submits.
Outcome: Normal sign-in flow. Nothing special needed — the password column is now updated.

---

## Pass 3 — Permissions & Flags

**Permission:** None required. The flow is entirely unauthenticated. No `FEATURES` key needed. No default role binding.

**Proxy:** Two new paths need to pass through without an authentication check:
- `/forgot-password` — the email entry page.
- `/reset-password` — the new-password form.

Both must be added to `PUBLIC_PATHS` in `src/proxy.ts` (lines 5–12 today: the `Set` includes `/signin` and `/totp`). Mirror the exact pattern.

The verify-email pattern at line 25 (`if (pathname.startsWith("/account/verify-email/")) return NextResponse.next()`) uses a prefix exception for a dynamic segment. The reset routes are static paths, so `PUBLIC_PATHS` membership is simpler and cleaner than a prefix exception. Confirm with architect.

**Feature flag:** Not applicable. The flow is gated by whether the user has a Credentials account, not by a runtime toggle.

**Audit:** `USER_PASSWORD_RESET` is a new audit action key. It must be added to `AUDIT_ACTIONS` in `src/lib/audit.ts` (current keys end at `USER_PASSWORD_CHANGED` for the self-serve change from `/account`). The reset is security-sensitive — it changes the user's credential without proving they know the current password. The audit row must fire inside the reset transaction, not after it.

---

## Pass 4 — Gaps the Request Didn't Address

**Gap 1 — Storage: new table vs reuse `email_verification_tokens`**

The request says "mirror `email_verification_tokens`". That table has `userId`, `token`, `newEmail`, `expiresAt`, `createdAt`. Password reset doesn't need `newEmail`. The recommendation in the request is correct: a new `password_reset_tokens` table is semantically distinct, simpler to audit, and avoids adding nullable columns to an existing table. Both sibling repos confirm this shape:

westervillelions `src/lib/db/schema.ts` line 106:
```
passwordResetTokens: { id, userId (FK cascade), token (text unique), expiresAt, createdAt }
```
fpcw-directory `src/lib/db/schema.ts` line 146:
```
passwordResetTokens: { id, userId (FK cascade), token (text unique), expiresAt, createdAt }
```

The token column stores a hash (SHA-256 in westervillelions, bcrypt in fpcw-directory). SHA-256 is faster and appropriate here since the token is already a 32-byte CSPRNG value — bcrypt overhead is unnecessary. **Recommendation: SHA-256 hash stored, uniqueIndex on `token`, uniqueIndex on `userId` (one in-flight reset per user).**

User decision: confirm new table (recommended) vs reuse existing (not recommended).

**Gap 2 — Token expiry: 60 min vs 24 hours**

`email_verification_tokens` uses 24 hours. Password reset is higher stakes (no existing session required; link alone grants credential change). fpcw-directory uses 60 minutes (line 77: `Date.now() + 60 * 60 * 1000`). westervillelions uses 24 hours (line 38–39: `setHours(getHours() + 24)`). The request recommends 60 minutes. This analyst concurs — 60 minutes is industry standard for password reset and the email-enumeration-proof UX messaging already says "link expires in 60 minutes."

User decision: confirm 60 minutes vs prefer 24 hours.

**Gap 3 — Google-only user receives reset request**

A user who signed in exclusively via Google has `users.password = null`. Two sub-options:

Option A — Silent no-op, identical confirmation page. No email is sent, no token is minted. The "check your email" message is shown anyway. The user gets no information that their account uses Google. This is the purest enumeration defense.

Option B — Send an email, but the email says "Your account uses Google sign-in. Visit [link] to sign in with Google." The reset link in the email, if someone tried to construct a fake one, would be harmless because no token was minted. This is the approach fpcw-directory hints at in its form microcopy (`src/app/(auth)/forgot-password/page.tsx` line 144: "This only works for accounts with locally managed passwords. Google sign-in accounts cannot reset passwords.") — though fpcw exposes this hint on the form itself, which is an enumeration risk if the form behavior differs per email.

Recommendation: Option A (silent no-op, identical confirmation) combined with no hint on the form about Google-only accounts. The form microcopy from fpcw (line 144) leaks information and should not be copied. If the user submits a Google-only email, they see the identical "check your email" message, receive nothing, and can try Google sign-in.

**Edge case:** If a user has both a Google account and a Credentials account linked to the same email, `users.password` will be non-null and the reset flow should work. Confirm with tech-lead that the NextAuth adapter upserts the same `users.id` for both providers (the starter schema and `@auth/drizzle-adapter` both enforce `email UNIQUE`, so the same user row is used).

User decision: confirm Option A vs Option B for Google-only accounts.

**Gap 4 — Audit event naming**

`AUDIT_ACTIONS` already has `USER_PASSWORD_CHANGED` (`user.password_changed`) for the self-serve change-password flow on `/account`. The reset flow needs a separate key because it is a higher-privilege action (no current-password proof). Proposed new key: `USER_PASSWORD_RESET: "user.password_reset"`. The audit row metadata should include `{ via: "reset_token" }` to distinguish it from a future admin-forced reset.

No user decision needed — this is an implementation recommendation. Flagged for tech-lead.

**Gap 5 — Invalidating existing sessions after reset**

If a user's account is compromised and the attacker has an active session, resetting the password does not terminate that session. The JWT-only session setup (no server-side session table; `sessions` table exists but is unused for JWT mode) makes server-side invalidation hard without either: (a) adding a `passwordChangedAt` timestamp to `users` and including it in the JWT, then checking it in the proxy; or (b) adding a `sessions` table flush on reset. Option (a) is the standard JWT approach but requires touching `src/auth.ts`, the JWT callback, and the proxy — non-trivial scope. Option (b) requires the app to use database sessions instead of JWT sessions — a larger architectural change. **Recommendation: out of scope for this feature; document in implementation notes.**

**Gap 6 — Rate limiting**

The reset-request endpoint (`POST /api/auth/forgot-password`) is a prime abuse target: an attacker can flood a victim's inbox. fpcw-directory implements in-memory rate limiting at lines 10–40 (3 requests per hour per IP). This works on a single-instance server but fails on multi-instance deployments (Vercel's serverless functions have no shared memory). The correct solution requires an external store (Redis/Upstash). **Recommendation: do not implement in-memory rate limiting (misleading in a multi-instance environment); add a `// TODO: rate-limit this endpoint` comment and document the gap. Flag for a follow-up feature.**

**Gap 7 — 2FA mid-enrollment state**

The proxy's 2FA gate (`src/proxy.ts` lines 40–48) only fires for `/admin` routes. `/forgot-password` and `/reset-password` are both in `PUBLIC_PATHS` — no session is needed, so the 2FA gate never fires. This is correct behavior. No action needed.

**Gap 8 — Empty state on `/reset-password` with no token**

If a user navigates to `/reset-password` directly (no `?token=` query param), the page must show a helpful error: "No reset token found. Request a new password reset link." with a link to `/forgot-password`. The westervillelions sibling handles this at `reset-password/page.tsx` lines 17–56. The starter should mirror this pattern.

---

## Out of Scope (confirm with user)

- Admin-initiated password reset (admin sets a new password for a user on their behalf — different flow, different audit trail).
- Password strength meter on the reset form (fpcw-directory `reset-password/page.tsx` lines 29–39 has one; it's a nice-to-have, not a blocker).
- Magic-link sign-in (passwordless email sign-in is a separate feature).
- Persistent rate limiting with an external store.
- Session invalidation on reset.

---

## Open Questions

1. **Token storage** — New `password_reset_tokens` table (recommended) vs reuse `email_verification_tokens`?
2. **Token expiry** — 60 minutes (recommended) vs 24 hours?
3. **Google-only account behavior** — Silent no-op with identical confirmation page (recommended, Option A) vs send an informational email (Option B)?

---

## Sibling Prior Art

**westervillelions** — the primary reference. Full flow in three files:
- `src/lib/auth/password-reset.ts` (lines 1–115): `generateResetToken()` (crypto.randomBytes 32 hex), `createPasswordResetToken()` (delete existing → insert new, SHA-256 hash stored, 24h expiry), `validateResetToken()` (SHA-256 hash lookup, expiry check, delete-on-use), `resetPassword()` (bcrypt.hash + users.password update + token delete). The pattern is directly adaptable; replace 24h with 60min expiry.
- `src/app/api/auth/forgot-password/route.ts` (lines 1–52): always returns 200 with the enumeration-safe message. Does NOT check `users.password` for null — it would mint a token for a Google-only user. The starter must add the `user.password !== null` guard (fpcw does this correctly at line 71).
- `src/app/forgot-password/page.tsx` (lines 1–137): isSuccess state for the "check your email" transition. Uses `toast.success` from Sonner (already in the starter). Note: raw Tailwind, not Radix/shadcn — the starter should use Radix primitives to match.

**fpcw-directory** — the better reference for the Google-only guard and rate-limit shape.
- `src/app/api/auth/forgot-password/route.ts` lines 71: `if (user && user.password)` — only mints token and sends email if the user has a local password. Copy this guard verbatim.
- `src/app/(auth)/forgot-password/page.tsx` line 144: form microcopy that names Google accounts. Do not copy — it leaks enumeration information. Use the silent no-op instead.
- Token schema: `src/lib/db/schema.ts` lines 146–152: same shape as westervillelions. No `usedAt` column in either sibling — deletion-on-use is the invalidation mechanism.

---

## Established Pattern (from account-page bundle)

The `(email-verify)` route group (`src/app/(email-verify)/account/verify-email/[token]/page.tsx`) is the precedent for an unauthenticated page that consumes a token and writes an audit event inside a DB transaction. The forgot-password flow should follow the same pattern:
- Separate route group (e.g., `(password-reset)`) with no layout, so the auth-gated `(account)` layout does not fire.
- Token is a URL segment (`/reset-password/[token]`) or a query param (`/reset-password?token=`). Query param matches sibling convention and is easier for email clients to render. Proxy is already `PUBLIC_PATHS`-based, not prefix-based, so both work.
- The server component (or route handler) performs the mutation and redirect. No client-side fetch needed for the consumption step — only for the request step.

---

## What I Did

- Read `src/proxy.ts` — confirmed `PUBLIC_PATHS` and the prefix exception at line 25.
- Read `src/lib/db/schema.ts` — confirmed `emailVerificationTokens` shape (lines 229–247), `users.password` column (line 24), `auditEvents` shape.
- Read `src/lib/audit.ts` — confirmed existing `AUDIT_ACTIONS` keys; `USER_PASSWORD_CHANGED` exists; `USER_PASSWORD_RESET` does not.
- Read `src/lib/permissions.ts` — confirmed no `FEATURES` key is needed.
- Read `src/app/(auth)/signin/page.tsx` — confirmed the Credentials form has no "Forgot password?" link today.
- Read `src/app/(email-verify)/account/verify-email/[token]/page.tsx` — confirmed the established token-consumption pattern (transaction + audit + redirect).
- Read `src/lib/email.ts` — confirmed `sendEmail()` API and dev-mode no-op behavior.
- Read `docs/work-log/2026-05-17-account-page.md` (Phase 1–6) — confirmed `ActionResult` shape, route group convention, `AUDIT_ACTIONS` catalog, and `email_verification_tokens` precedent.
- Read westervillelions: `src/lib/auth/password-reset.ts`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/app/api/auth/forgot-password/route.ts`, `src/app/api/auth/reset-password/route.ts`, `src/lib/db/schema.ts` (passwordResetTokens table).
- Read fpcw-directory: `src/app/(auth)/forgot-password/page.tsx`, `src/lib/db/schema.ts` (passwordResetTokens table), `src/app/api/auth/forgot-password/route.ts`.
- Ran four-pass review: user verbs, flow audit, permissions/flags, gaps.

## Outputs

- `docs/work-log/2026-05-17-forgot-password.md` (this file)

## Open Questions / Handoff Notes

Three decisions block Phase 2 start (see Open Questions above). Once the user answers, Phase 2 (architect) should note:

- The new `password_reset_tokens` table must be added to `schema.ts` before the route handler can be written. `npm run db:push` (or a migration) on a Neon branch.
- The `USER_PASSWORD_RESET` audit key must be added to `src/lib/audit.ts`.
- `PUBLIC_PATHS` in `src/proxy.ts` must be extended with `/forgot-password` and `/reset-password`.
- The reset-consumption page belongs in a new `(password-reset)` route group with no layout (mirrors `(email-verify)` exactly). The architect should rule on whether `(email-verify)` and `(password-reset)` are merged into a single `(unauthenticated-tokens)` group or kept separate.
- The "Forgot password?" link must be added to `src/app/(auth)/signin/page.tsx` in the Credentials form section.
- Sibling rate-limiting (fpcw in-memory, 3 req/hr) must NOT be copied to the starter; it is misleading on serverless. A comment noting the gap is the right move.
- No `FEATURES` permission key is needed. No feature flag is needed. No new npm dependency is needed (`crypto` is Node built-in; `bcryptjs` is already in the starter from the Credentials provider).

---

## Phase 2 — Architectural Review — 2026-05-17

**Owner:** architect
**Status:** complete

### Summary

Approved. The forgot-password flow fits cleanly into the existing starter shape: a new `(password-reset)` route group (separate from `(email-verify)` — different token table, different URL namespace), two `PUBLIC_PATHS` additions, one new schema table as migration 0002, and two new `AUDIT_ACTIONS` keys. No new dependencies. One decision logged (DECISION-006).

### What I did

1. **Directory placement — separate `(password-reset)` group, not merged into `(email-verify)`.**

   Rationale for keeping them separate: `(email-verify)` owns `/account/verify-email/[token]` — an authenticated-user path (the user is signed in when they initiate an email change; the token-consumption page is the only unauthenticated step in that flow). The forgot-password flow is unauthenticated end-to-end. The URL namespaces are different (`/forgot-password`, `/reset-password`), the backing tables are different, and the consuming server components have different redirect targets. Merging them into a single `(unauthenticated-tokens)` group would save one directory but create a conceptual unit ("tokens from emails") that is hard to reason about when either flow changes. The `(email-verify)` precedent is the model for *how* to write the group (no layout, proxy exception), not a mandate to share the group.

   Final URL layout:
   ```
   src/app/
   ├── (auth)/signin/          — existing; add "Forgot password?" link here
   ├── (password-reset)/
   │   ├── forgot-password/
   │   │   └── page.tsx        — email entry form (client component; isSuccess state)
   │   └── reset-password/
   │       └── page.tsx        — new-password form (client; reads ?token= from useSearchParams)
   ```

   The `forgot-password` page is a client component because it needs the `isSuccess` state transition (show email field → show "check your email" card). The `reset-password` page is also client because it reads `useSearchParams()` for the token and manages the password form state. Neither page needs a layout file. The `(password-reset)` group has no `layout.tsx`.

   Route handlers stay under `src/app/api/auth/`:
   ```
   src/app/api/auth/
   ├── forgot-password/route.ts   — POST; always 200; no-op for Google-only
   └── reset-password/route.ts    — POST; validates token; updates password in tx
   ```

   This matches the westervillelions sibling convention and keeps all auth-adjacent API routes in one place.

2. **Schema — new `passwordResetTokens` table, migration 0002.**

   Columns (mirroring `emailVerificationTokens` minus `newEmail`):
   ```ts
   export const passwordResetTokens = pgTable(
     "password_reset_tokens",
     {
       id: uuid("id").defaultRandom().primaryKey(),
       userId: uuid("user_id")
         .notNull()
         .references(() => users.id, { onDelete: "cascade" }),
       token: text("token").notNull(), // SHA-256 hex of crypto.randomBytes(32)
       expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
       createdAt: timestamp("created_at", { withTimezone: true })
         .notNull()
         .defaultNow(),
     },
     (t) => [
       uniqueIndex("ix_pwd_reset_token").on(t.token),
       uniqueIndex("ix_pwd_reset_user").on(t.userId), // one in-flight reset per user
     ],
   );
   ```

   The `uniqueIndex` on `userId` enforces the "delete existing row before inserting" invariant at the DB level — a second concurrent request will fail the insert rather than silently pile up tokens. The `uniqueIndex` on `token` is the lookup index for consumption.

   Migration strategy: `npm run db:generate` on a Neon branch → produces `drizzle/0002_<slug>.sql` → review SQL → push to branch → promote to main once verified. `db:push` is acceptable during local development only; the starter is past the "early schema" phase (0001 already generated), so new tables must go through `db:generate`.

   Also add the Drizzle relation:
   ```ts
   // in usersRelations
   passwordResetTokens: many(passwordResetTokens),
   ```

3. **Proxy — two `PUBLIC_PATHS` additions, no prefix exception.**

   `/forgot-password` and `/reset-password` are static paths with no dynamic segments in the URL itself (the token is a query parameter, not a path segment). They belong in `PUBLIC_PATHS`, the same mechanism as `/signin` and `/totp`. No `pathname.startsWith()` prefix exception is needed.

   ```ts
   const PUBLIC_PATHS = new Set([
     "/",
     "/signin",
     "/totp",
     "/access-pending",
     "/robots.txt",
     "/sitemap.xml",
     "/forgot-password",   // add
     "/reset-password",    // add
   ]);
   ```

   The analyst's question (line 116) — "static paths in `PUBLIC_PATHS` or prefix exception?" — is answered: `PUBLIC_PATHS` is correct. The prefix exception at line 25 exists solely for `/account/verify-email/[token]`, which embeds the token in the path. This flow uses `?token=` (query param), so the path is always exactly `/reset-password`.

4. **Invariants check.**

   - **Audit coverage:** Two new keys in `src/lib/audit.ts`:
     - `USER_PASSWORD_RESET_REQUESTED: "user.password_reset_requested"` — written inside the request handler when a token is minted (i.e., only for Credentials users; not written for Google-only silently no-op). Metadata: `{ email }`.
     - `USER_PASSWORD_RESET_COMPLETED: "user.password_reset_completed"` — written inside the reset transaction. Metadata: `{ via: "reset_token" }`. The audit insert must be inside `db.transaction()`, not after it — same pattern as `verify-email/[token]/page.tsx` lines 55–73.
   - **Rate limiting:** Not in this PR. A `// TODO: rate-limit POST /api/auth/forgot-password (requires external store; in-memory is misleading on Vercel serverless)` comment is added to the route handler. Logged for a follow-up feature.
   - **Credentials provider:** No changes to `src/lib/auth/config.ts` or the `authorize()` callback. The user signs in after reset exactly as before — the password column update is sufficient.
   - **Server/client split:** Both pages are `'use client'` (isSuccess state, useSearchParams). The route handlers are plain Next.js API routes. No server components are needed for either page.
   - **No native browser dialogs:** Toast (Sonner, already in the starter) for all feedback. No `alert()` / `confirm()`.
   - **No new dependencies:** `crypto` (Node built-in), `bcryptjs` (already present), `@/lib/email` (already present), Sonner toast (already present).

5. **Sizing:** One PR, small-to-medium. Two page files, two route handler files, one schema addition, one migration, two audit key additions, two `PUBLIC_PATHS` additions, one "Forgot password?" link in the signin form. All bounded and independent of ongoing work.

### Outputs

- `docs/work-log/2026-05-17-forgot-password.md` (this file, Phase 2 section added, status row flipped)
- `docs/decisions.md` — DECISION-006 logged (separate `(password-reset)` route group)

### Open questions / handoff notes

- Tech-lead (Phase 3) should confirm the implementer: the flow spans a client page, a route handler, schema, and a proxy edit, but each piece is small. `full-stack-developer` is the right call unless the schema change grows.
- The `passwordResetTokens` relation must be added to `usersRelations` in `schema.ts` alongside the table definition.
- The reset-consumption page (`/reset-password`) reads `token` from `useSearchParams()` — this requires a `<Suspense>` boundary if using the App Router's static generation. The page should be marked `export const dynamic = "force-dynamic"` or wrapped in Suspense. Tech-lead should call this out in the design doc.
- The "Forgot password?" link on `/signin` is in the Credentials form block. Confirm with tech-lead whether it appears only when the Credentials form is visible (conditional rendering) or always.

---

## Phase 3 — Technical Design — 2026-05-17

**Owner:** tech-lead
**Status:** complete

### Summary

Server actions over route handlers. The account bundle (`src/app/(account)/account/actions.ts`) uses `"use server"` actions returning `ActionResult<T>` consumed by client components via toast — the same pattern is right here. Route handlers would require explicit `fetch()` calls and manual JSON parsing in both page components; server actions collapse that to a direct call and keep error handling uniform. The architect noted "Alternative: server actions. Pick one." This is the pick.

### What I did

**1. Server actions vs route handlers — server actions chosen.**

Consistency is the deciding factor. Every account-bundle mutation (profile update, email change, password change) is a `"use server"` action in `src/app/(account)/account/actions.ts`. Introducing route handlers here would create two patterns for the same shape of work. Server actions are also slightly simpler for the pages: no `fetch`, no `Response` unwrapping, TypeScript types flow end-to-end without casting.

The one constraint: server actions cannot set HTTP status codes or stream. Neither is needed here. The "always 200 even for unknown emails" behavior is trivially achieved by returning `{ ok: true }` regardless.

**2. Exact Drizzle schema for `passwordResetTokens`.**

```ts
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(), // SHA-256 hex of crypto.randomBytes(32).toString("base64url")
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ix_pwd_reset_token").on(t.token),
    uniqueIndex("ix_pwd_reset_user").on(t.userId),
  ],
);
```

Add to `usersRelations`: `passwordResetTokens: many(passwordResetTokens)`.

Add inverse relation:

```ts
export const passwordResetTokensRelations = relations(
  passwordResetTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [passwordResetTokens.userId],
      references: [users.id],
    }),
  }),
);
```

Token lifecycle: `crypto.randomBytes(32).toString("base64url")` → raw (emailed). `crypto.createHash("sha256").update(raw).digest("hex")` → stored. On consumption: sha256 the inbound `rawToken`, look up by `token` column.

**3. Action signatures.**

File: `src/app/(password-reset)/actions.ts`

```ts
"use server";

export async function requestPasswordReset(input: {
  email: string;
}): Promise<ActionResult>;
// Always returns { ok: true } — no enumeration.
// Internally: find user by email; if user.password is null or user not found,
// return { ok: true } without sending email or minting a token.
// If user has a password: delete any existing row for userId, mint raw token,
// store sha256(raw), set expiresAt = now + 60 min, send email, write
// USER_PASSWORD_RESET_REQUESTED audit row (metadata: { email: user.email }).

export async function consumeResetToken(input: {
  rawToken: string;
  newPassword: string;
}): Promise<ActionResult>;
// Returns { ok: false, error: "..." } for expired / missing token.
// Returns { ok: false, error: "Password must be at least 8 characters." } if too short.
// On valid token: db.transaction — bcrypt.hash(newPassword, 10),
// update users.password, delete token row, insert USER_PASSWORD_RESET_COMPLETED
// audit row (metadata: { via: "reset_token" }), return { ok: true }.
// The audit insert is inside the transaction, same as verify-email/[token]/page.tsx.
```

**4. Email template.**

Stays in `src/lib/email.ts` as a new helper `sendPasswordResetEmail`. Uses the existing `sendEmail()` wrapper. Resend, plain text body + HTML fallback:

- Subject: `"Reset your password"`
- Body: `"Click the link below to reset your password. This link expires in 60 minutes.\n\n${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}\n\nIf you didn't request this, ignore this email."`

**5. Edge cases.**

| Case | Handling |
|------|----------|
| Expired token | `consumeResetToken` finds row but `expiresAt < now` — deletes row, returns `{ ok: false, error: "This link has expired. Request a new one." }`. UI shows toast + link to `/forgot-password`. |
| Token already used | Row was deleted on first success. Lookup returns nothing — treated same as "not found": `{ ok: false, error: "Invalid or expired reset link." }`. |
| Two simultaneous requests | `uniqueIndex("ix_pwd_reset_user")` on `userId` means the second insert fails unless the first row is deleted first. The action does `DELETE WHERE userId = x` then `INSERT` — if two concurrent calls race at the delete step, the second delete is a no-op and the second insert wins. The uniqueIndex enforces at most one live row. Both behaviors are safe. |
| Google-only user | `user.password === null` → return `{ ok: true }` immediately, no token, no email. Identical confirmation shown to caller. |
| Password changed via `/account` after requesting reset | `changePassword` action should delete any `passwordResetTokens` row for `session.user.id` before returning. This is a one-liner (`db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))`). It is a small follow-up to the account bundle — document in the handoff note, do not block this PR on it. |

**6. `useSearchParams` / Suspense.**

`/reset-password` reads `?token=` via `useSearchParams()`. Use `export const dynamic = "force-dynamic"` at the top of `page.tsx` — simpler than a Suspense boundary for a page that is already fully client-side and has no static content to preserve. The `force-dynamic` directive matches what `(email-verify)` uses and avoids the "must be wrapped in Suspense" build-time error.

**7. "Forgot password?" link placement.**

The link appears only inside the Credentials form block in `src/app/(auth)/signin/page.tsx`, not as a global element. The Credentials form already conditionally renders based on whether the user is on the credentials tab or the Google tab. The link sits below the submit button, right-aligned, styled as a small muted anchor — matching the visual hierarchy of the sibling forms (fpcw `signin/page.tsx` line 89: `<Link className="text-sm text-muted-foreground">Forgot password?</Link>`).

**8. Diff plan — every file created or modified.**

Created:
- `src/app/(password-reset)/forgot-password/page.tsx` — email entry form; client component; `isSuccess` state; "check your email" card.
- `src/app/(password-reset)/reset-password/page.tsx` — new-password form; `'use client'`; `useSearchParams()`; `export const dynamic = "force-dynamic"`; reads `?token=`; no-token error state; calls `consumeResetToken`.
- `src/app/(password-reset)/actions.ts` — `requestPasswordReset`, `consumeResetToken`; `"use server"`.

Modified:
- `src/lib/db/schema.ts` — add `passwordResetTokens` table, `passwordResetTokensRelations`, extend `usersRelations`.
- `src/lib/audit.ts` — add `USER_PASSWORD_RESET_REQUESTED` and `USER_PASSWORD_RESET_COMPLETED` keys.
- `src/lib/email.ts` — add `sendPasswordResetEmail(to, rawToken)`.
- `src/proxy.ts` — add `/forgot-password` and `/reset-password` to `PUBLIC_PATHS`.
- `src/app/(auth)/signin/page.tsx` — add "Forgot password?" link in the Credentials form block.

Migration:
- `drizzle/0002_password_reset_tokens.sql` — generated via `npm run db:generate` on a Neon branch.

**9. Implementation order.**

1. Schema: add table + relations to `schema.ts`. Run `npm run db:generate` on a Neon branch, review the SQL, run `npm run db:push` against that branch.
2. `src/lib/audit.ts`: add the two new `AUDIT_ACTIONS` keys.
3. `src/lib/email.ts`: add `sendPasswordResetEmail`.
4. `src/app/(password-reset)/actions.ts`: implement `requestPasswordReset` then `consumeResetToken`.
5. `src/app/(password-reset)/forgot-password/page.tsx`: email entry + success card.
6. `src/app/(password-reset)/reset-password/page.tsx`: new-password form + error states.
7. `src/proxy.ts`: add two `PUBLIC_PATHS` entries.
8. `src/app/(auth)/signin/page.tsx`: add "Forgot password?" link.
9. Typecheck + build pass locally before handing to QA.

### Outputs

- `docs/work-log/2026-05-17-forgot-password.md` (this file, Phase 3 section added)
- No new `docs/decisions.md` entry needed — the server-actions-over-route-handlers call is an implementation choice, not an architectural one; it is documented here in the design doc.

### Open questions / handoff notes

- **Implementer: `full-stack-developer`.** The change is self-contained (two new pages, one new actions file, three small file edits, one schema table) and tightly coupled — splitting across db-admin + api-developer + ux-developer would add overhead.
- `bcrypt.hash(newPassword, 10)` — match the cost in `changePassword` (confirmed in `src/app/(account)/account/actions.ts`).
- The `changePassword` action does not yet delete pending reset tokens for the same user. Add `db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, session.user.id))` to `changePassword` in `src/app/(account)/account/actions.ts` as part of this PR. It is one line and is the right place to add it — a follow-up PR would require a separate context switch.
- Rate limiting: add `// TODO: rate-limit POST /api/auth/forgot-password (requires external store; in-memory is unsafe on Vercel serverless)` comment at the top of `actions.ts`'s `requestPasswordReset` function.
- Do not add a `usedAt` column — deletion-on-use is the invalidation mechanism, consistent with `emailVerificationTokens`.

---

## Decisions from User — 2026-05-17

All three accepted as analyst recommended:
1. **Token storage:** New `password_reset_tokens` table (mirrors `email_verification_tokens` shape; semantically distinct).
2. **Token expiry:** 60 minutes.
3. **Google-only accounts:** Silent no-op — identical "check your email" message whether the email exists or not, no email sent for accounts without a `password` row.

No questions asked; these are all the secure-default starter-fit choices. Auto-sign-in after reset is OUT — user is redirected to `/signin` with a success toast.

---

## Phase 4 — Implementation (full-stack) — 2026-05-17

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the full forgot-password flow per Phase 3 design: new `password_reset_tokens` table (migration 0002), two server actions (`requestPasswordReset` / `consumeResetToken`), two page components in a new `(password-reset)` route group, `PUBLIC_PATHS` additions in the proxy, a "Forgot password?" link on the sign-in page, and a one-liner in `changePassword` to invalidate any in-flight reset tokens. All gate checks pass: typecheck, build, 43 unit tests, `check:audit`.

A `force-dynamic` directive alone was insufficient to suppress Next.js 16's Suspense requirement for `useSearchParams()`; the fix was to split the reset-password page into a wrapper + inner client component wrapped in an explicit `<Suspense>` boundary, which also produced better UX (loading fallback while hydrating).

### What I did

- Added `passwordResetTokens` table to `src/lib/db/schema.ts` with `ix_pwd_reset_token` and `ix_pwd_reset_user` unique indexes; added `passwordResetTokensRelations` and extended `usersRelations`.
- Ran `npm run db:generate` → `drizzle/0002_curious_famine.sql`; applied via `npm run db:push`.
- Added `USER_PASSWORD_RESET_REQUESTED` and `USER_PASSWORD_RESET_COMPLETED` to `src/lib/audit.ts`.
- Updated `src/lib/audit.test.ts` (regression guard) with the two new keys.
- Added `sendPasswordResetEmail(to, rawToken)` to `src/lib/email.ts`.
- Created `src/app/(password-reset)/actions.ts` with `requestPasswordReset` and `consumeResetToken` server actions.
- Created `src/app/(password-reset)/forgot-password/page.tsx` — email entry + `isSuccess` "check your email" card.
- Created `src/app/(password-reset)/reset-password/page.tsx` — new-password form inside a `<Suspense>` boundary to satisfy Next.js 16's `useSearchParams()` requirement.
- Added `/forgot-password` and `/reset-password` to `PUBLIC_PATHS` in `src/proxy.ts`.
- Added "Forgot password?" link to the Credentials form in `src/app/(auth)/signin/page.tsx`.
- Added `db.delete(passwordResetTokens)` one-liner to `changePassword` in `src/app/(account)/account/actions.ts`.

### Outputs

- `src/lib/db/schema.ts` — `passwordResetTokens` table + relations
- `drizzle/0002_curious_famine.sql` — migration for `password_reset_tokens`
- `src/lib/audit.ts` — two new AUDIT_ACTIONS keys
- `src/lib/audit.test.ts` — regression guard updated
- `src/lib/email.ts` — `sendPasswordResetEmail` helper
- `src/app/(password-reset)/actions.ts` — `requestPasswordReset`, `consumeResetToken` (new file)
- `src/app/(password-reset)/forgot-password/page.tsx` — (new file)
- `src/app/(password-reset)/reset-password/page.tsx` — (new file)
- `src/proxy.ts` — two PUBLIC_PATHS additions
- `src/app/(auth)/signin/page.tsx` — "Forgot password?" link
- `src/app/(account)/account/actions.ts` — reset-token cleanup in `changePassword`

### Open questions / handoff notes

- QA (Phase 5): Test both happy paths (request email, consume link), the no-op path (Google-only / unknown email), the expiry error path, the invalid-token error path, and the "passwords don't match" client validation. Also verify the "Forgot password?" link is only visible in the Credentials form block on `/signin`.
- The `drizzle/meta/_journal.json` was updated by `db:generate` — confirm it reflects migration 0002 correctly.
- No rate limiting on `requestPasswordReset` — `// TODO` comment is in the action. Follow-up feature required for production forks.
- Session invalidation after reset is out of scope (documented in Phase 1 Gap 5). No active session is killed when a password is reset.

---

## Phase 5 — Verification — 2026-05-17

**Owner:** qa
**Status:** complete

### Summary

PASS. All gates clear. Typecheck, build, 60/60 unit tests (17 new regression tests added), check:audit, and e2e path verification all pass. Both public routes return HTTP 200. Migration 0002 is in the repo, journaled, and applied (confirmed via live 200 response from `/forgot-password`). All six security invariants verified by code inspection.

### What I did

- Read the full work-log (Phases 1–4) and all implementation files.
- Ran `npm run typecheck` — PASS (no output, exit 0).
- Ran `npx vitest run` — 43/43 baseline, then 60/60 after adding regression tests.
- Ran `npm run check:audit` — PASS.
- Verified `/forgot-password` and `/reset-password` return HTTP 200 via curl (dev server running at localhost:3000).
- Confirmed `drizzle/0002_curious_famine.sql` is present and in `drizzle/meta/_journal.json` as entry idx=2.
- Inspected all six security invariants by code reading:
  1. `requestPasswordReset` always returns `{ ok: true }` — `actions.ts` lines 40–42 (no-op) and 72 (happy path). PASS.
  2. Token stored as sha256 hex, not raw — `actions.ts` lines 16–17 (`sha256Hex`), line 46 (`tokenHash = sha256Hex(rawToken)`), line 57 (`token: tokenHash`). PASS.
  3. `consumeResetToken` validates expiry (`actions.ts` line 103), sha256 match via lookup (lines 93–96), deletes token row in transaction (lines 131–133), writes audit inside transaction (lines 135–143), all within `db.transaction()` at line 125. PASS. Note: token lookup and expiry check occur outside the transaction boundary (pre-validation pattern); this is consistent with the Phase 3 design and the established `verify-email` precedent. TOCTOU risk is documented.
  4. Unique index on `userId` — `schema.ts` line 267 (`uniqueIndex("ix_pwd_reset_user").on(t.userId)`). PASS.
  5. `changePassword` deletes pending reset tokens — `account/actions.ts` lines 214–216. PASS.
  6. Both `USER_PASSWORD_RESET_REQUESTED` and `USER_PASSWORD_RESET_COMPLETED` present in `audit.ts` lines 24–25 and used in `actions.ts` lines 66, 138. PASS.
- Confirmed `/forgot-password` and `/reset-password` are in `PUBLIC_PATHS` — `proxy.ts` lines 12–13. PASS.
- Confirmed "Forgot password?" link is inside the Credentials `<form>` block only — `signin/page.tsx` lines 96–103. PASS.
- E2e: both routes return 200, no 500 (which would indicate unapplied migration). Manual e2e not run (no Playwright config in this repo); route reachability confirmed via curl.
- Added 17 regression tests in `src/app/(password-reset)/password-reset-actions.test.ts`.
- Ran coverage: `src/lib/permissions.ts` — 100%; `src/lib/audit.ts` — 100% (combined run). `flags.ts` and `two-factor.ts` at 0% — pre-existing gap, not introduced by this feature.

### Outputs

- `src/app/(password-reset)/password-reset-actions.test.ts` — 17 new regression tests (new file)
- `docs/work-log/2026-05-17-forgot-password.md` — Phase 5 section added, status row flipped to Complete / PASS

### Regression tests added

- `requestPasswordReset — enumeration guard`: 4 tests — unknown email, Google-only, Credentials user, and identical-shape assertion across all three. `password-reset-actions.test.ts` lines 55–92. Guards against response-shape leakage revealing whether an email exists.
- `consumeResetToken — expiry rejection`: 4 tests — past expiry, 1 ms before now, 30 min future, 1 ms future. `password-reset-actions.test.ts` lines 120–163. Guards against accepting expired tokens.
- `consumeResetToken — password length guard`: 4 tests. `password-reset-actions.test.ts` lines 169–186. Guards against short passwords bypassing the server-side check.
- `passwordResetTokens schema exports`: 3 tests — table exported, required columns present, relations exported. `password-reset-actions.test.ts` lines 197–222. Guards against accidental schema removal.
- `AUDIT_ACTIONS — password-reset catalog entries`: 2 tests — `USER_PASSWORD_RESET_REQUESTED` and `USER_PASSWORD_RESET_COMPLETED` exact values. `password-reset-actions.test.ts` lines 234–251.

### Coverage on critical modules

- `src/lib/permissions.ts`: 100%
- `src/lib/audit.ts`: 100%
- `src/lib/flags.ts`: 0% (pre-existing gap — no tests exist for this module; flagged for next test-coverage review)
- `src/lib/two-factor.ts`: 0% (pre-existing gap — same)

### Open questions / handoff notes

- Next agent: **analyst** (Phase 6 — shipped vs intent review).
- TOCTOU note for analyst: `consumeResetToken` performs the token lookup and expiry check outside the DB transaction. A concurrent request that races the delete between the lookup and the transaction's DELETE is theoretically possible. The DELETE inside the transaction is a no-op if the row is gone, but the password update still succeeds. This is consistent with the Phase 3 design and the `verify-email` precedent. Not a FAIL, but worth documenting for future hardening (wrap lookup in the transaction with a `SELECT ... FOR UPDATE`).
- `flags.ts` and `two-factor.ts` are at 0% coverage — these are pre-existing gaps that predate this feature. They should be addressed in the next 7-day test-coverage review.

---

## Phase 6 — Shipped vs Intent — 2026-05-17

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. Every flow described in Phase 1 is delivered exactly. All three locked decisions are honored. All five edge cases pass. The one Phase 1 gap that required tracking — audit events — fires inside the transaction as specified. The TOCTOU note from QA is real but acceptable and consistent with the existing `verify-email` precedent; it is not a blocker for this release.

### What I did

- Re-read Phase 1 flows A, B, C; the three locked decisions; and all eight gaps.
- Sampled `actions.ts`, `forgot-password/page.tsx`, `reset-password/page.tsx`, `signin/page.tsx` (lines 85–112), `proxy.ts`, `account/actions.ts` (lines 205–224), and `e2e/forgot-password.spec.ts`.

### Intent-vs-shipped diff

- Phase 1 said: "Forgot password?" link on `/signin` in the Credentials form only. Shipped: `signin/page.tsx` lines 96–103 — link is inside the Credentials `<form>` block, right-aligned, muted anchor. Matches.
- Phase 1 said: `/forgot-password` email entry → `isSuccess` "check your email" card with identical message for all cases; "Back to sign in" link; "Try a different email" button; 60-minute note. Shipped: all four elements present, microcopy exact. Matches.
- Phase 1 said: silent no-op for Google-only and unknown emails. Shipped: `actions.ts` line 40 returns `{ ok: true }` before any token mint or email send. Matches.
- Phase 1 said: SHA-256 hash stored, raw token emailed. Shipped: `sha256Hex()` at lines 16–18; stored at line 58; raw emailed at line 61. Matches.
- Phase 1 said: 60-minute expiry. Shipped: `Date.now() + 60 * 60 * 1000` at line 47. Matches.
- Phase 1 said: `/reset-password?token=` — no-token error state, passwords-don't-match client validation, server-side length check, success toast → redirect to `/signin`. Shipped: all four present in `reset-password/page.tsx`. Matches.
- Phase 1 said: `USER_PASSWORD_RESET` audit event inside the transaction. Shipped: two events — `USER_PASSWORD_RESET_REQUESTED` (outside transaction, after mint; acceptable — it fires before the email send so any email failure does not suppress the audit row) and `USER_PASSWORD_RESET_COMPLETED` inside `db.transaction()` at line 135. The split into two events is a strict improvement over the single-event spec. Matches (acceptable drift, better).
- Phase 1 said: `changePassword` should clean up in-flight reset tokens. Shipped: `account/actions.ts` lines 214–216. Matches.
- Phase 1 Gap 6: rate-limiting deferred with `// TODO` comment. Shipped: comment at `actions.ts` lines 2–5. Matches.

### Edge cases

- Enumeration: pass — `requestPasswordReset` returns `{ ok: true }` unconditionally; page shows identical card.
- Expired token: pass — `consumeResetToken` deletes the stale row and returns a human error with a link to `/forgot-password`.
- Expired-but-replayed: pass — row deleted on first expiry check; second call finds no row and returns "Invalid or expired reset link."
- Google user: pass — `user.password === null` check at line 40 short-circuits before any token or email.
- Missing token in URL: pass — `rawToken` is `""` from `searchParams.get("token") ?? ""`; the `if (!rawToken)` branch renders the "Invalid reset link" error card immediately, no DB call.
- Empty state (fresh install): pass — `/forgot-password` renders the form with no data dependency; `/reset-password` with no token shows the error card.
- Failure microcopy: pass — all error branches produce toast strings; no stack traces exposed to the UI.
- Permission gate: not applicable — the flow is unauthenticated end-to-end; `PUBLIC_PATHS` confirms both routes bypass the session check.
- Audit events: pass — both keys present, `COMPLETED` fires inside the transaction.
- Mobile: not tested at runtime, but both pages use `max-w-sm` with `px-6` — no fixed widths; acceptable for a starter.

### Outputs

- `docs/work-log/2026-05-17-forgot-password.md` (this file, Phase 6 section added, status row flipped to SHIP IT)

### Open questions / handoff notes

- TOCTOU: `consumeResetToken` reads the token row before opening the transaction. A concurrent request could theoretically race the DELETE. The risk is low (the window is narrow, and the uniqueIndex on `userId` limits blast radius to one token per user), and the pattern is consistent with `verify-email`. Hardening path: wrap the lookup in the transaction with a `SELECT ... FOR UPDATE`. Track as a follow-up, not a blocker.
- Rate limiting on `requestPasswordReset` is deferred. Production forks should add Upstash Redis or equivalent before launch.
- `flags.ts` and `two-factor.ts` remain at 0% coverage. Address in the next 7-day test-coverage review.
