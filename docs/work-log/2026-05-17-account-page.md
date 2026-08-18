# Self-Serve Account Page — Work Log

> **Slug:** `2026-05-17-account-page`
> **Surface:** (auth) — authenticated users of all roles
> **Permission(s):** No new permission. Proxy `signIn` gate covers it.
> **Flag(s):** Not needed for MVP. See gaps for staged-rollout option.
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-17 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-05-17 |
| 3 — Technical design | tech-lead | Complete | — | 2026-05-17 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-05-17 |
| 5 — Verification | qa | Complete | PASS | 2026-05-17 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-05-17 |

---

# Phase 1 — Functional Refinement — 2026-05-17

**Owner:** analyst
**Status:** complete

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A self-serve `/account` page where every signed-in user can update their display name and (for Credentials users) change their password — four open decisions must be answered before Phase 2 starts.

---

## Pass 1 — User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member (any role) | Navigate to `/account` | On demand |
| Authenticated member (any role) | Read their display name and sign-in email (read-only) | On demand |
| Authenticated member (any role) | Edit display name and submit | On demand |
| Authenticated member (Credentials only) | Type current password, new password, confirm, and submit | On demand |
| Authenticated member (any role) | See their 2FA enrollment status (read-only or with link) | On demand |
| Admin (open question) | N/A — this page is self-serve, not admin-facing | — |

"The user" in the request means the **authenticated member** surface. No anonymous or access-pending interaction.

---

## Pass 2 — Flow Audit

**Flow 1 — Update display name**

Entry: User navigates to `/account` (direct URL or nav link).
Step 1: Page loads; name field is pre-populated from `session.user.name` (pulled from DB on page render, not stale JWT).
Step 2: User edits the name field and clicks "Save".
Step 3: Server action `updateProfileAction` re-checks session, validates non-empty string (max 100 chars), writes `users.name`, calls `revalidatePath("/account")`.
Outcome: `toast.success("Name updated.")`. Field shows new value immediately.

Failure — empty or whitespace-only name: `toast.error("Name cannot be blank.")` Client-side validation first; server action validates too.
Failure — DB error: Server action throws; Next.js surfaces an unhandled error page. Suggested: catch and return `{ ok: false, error: "Something went wrong. Try again." }`.

**Flow 2 — Change password (Credentials users only)**

Entry: User is on `/account`; password section is visible only if `users.password` is not null (detected at page-render time, not client-side).
Step 1: User fills "Current password", "New password", "Confirm new password" and clicks "Change password".
Step 2: Server action `changePasswordAction` re-checks session, loads `users.password` from DB (never from session), calls `bcrypt.compare(currentPassword, stored)`.
Step 3: On match, validates new password length (min 8 chars), runs `bcrypt.hash(newPassword, 10)`, writes `users.password`, inserts audit event `user.password_changed`, calls `revalidatePath("/account")`.
Outcome: `toast.success("Password updated.")`. All three fields are cleared.

Failure — wrong current password: `toast.error("Current password is incorrect.")`. No lockout in the starter (note this gap below).
Failure — new password too short: `toast.error("Password must be at least 8 characters.")`.
Failure — confirm mismatch: Client-side check before submit; server action also rejects if they differ.
Failure — DB error: return `{ ok: false, error: "Something went wrong. Try again." }`.

**Flow 3 — Google-OAuth user lands on `/account`**

Entry: OAuth user navigates to `/account`.
Outcome (one of three — user decision needed, see Gap 2): (a) password section is hidden; account section shows "Sign in with Google"; OR (b) password section shows a static message "Your account uses Google Sign-In. Password login is not available."; OR (c) a "Set a password" path is offered.
Recommendation: option (a) — hide the section. It is cleaner and requires no design for an uncommon path. Option (c) is significant additional scope.

**Flow 4 — 2FA status display**

Entry: User is on `/account`; 2FA section always renders.
Outcome: Section shows enrollment status. For enrolled users: "Two-factor authentication is active." For unenrolled users with `twoFactorRequired = true`: "Required — not yet set up." with a link to `/admin/2fa` (if the user has `admin.dashboard`) or to a new `/account/2fa` enrollment flow (if we expose it to all users — see Gap 3).
Note: The page server component reads `userTotp` to determine enrollment, same pattern as `fertilityluna/src/app/account/page.tsx` lines 13–14.

---

## Pass 3 — Permissions & Flags

- **Permission:** No new `FEATURES` key required. The proxy already redirects unauthenticated requests. `/account` is not admin-gated. Authenticated users of any role reach it.
- **Default roles:** All roles (including users with no roles — they land on `/access-pending`, but if the proxy is extended to allow `/account` for no-role users that is a separate decision; for now, treat `/account` as requiring at least one role, which the proxy's existing "authenticated = proceed" logic already handles for non-admin routes).
- **Feature flag:** Not needed for a self-serve page that ships complete. If staged rollout is desired, a `account_page` flag can be added — but the feature is small enough that a flag is probably overkill.
- **Audit events:** `user.password_changed` is a new key that must be added to `AUDIT_ACTIONS` in `src/lib/audit.ts`. Name-change is not security-sensitive; no audit event needed for it. (Compare: `AUDIT_ACTIONS.USER_ROLE_ASSIGNED` follows the `resource.verb` pattern; the new key should be `USER_PASSWORD_CHANGED: "user.password_changed"`.)

---

## Pass 4 — Gaps the Request Didn't Address

**Gap 1 — Email change in scope?**
`users.email` is the identity anchor for NextAuth adapter lookups and the seed admin check (`scripts/seed.ts`). For Google-OAuth users it is the Google account email; changing it would orphan the OAuth link in `accounts`. Changing it also typically requires re-verification (send a code to the new address before committing). Recommendation: **punt email change to a follow-up** and render the current email as read-only with a note like "Contact an admin to change your sign-in email." This matches `westervillelions/src/app/members/profile/page.tsx` line 44 ("Sign-in email: read-only") and `fertilityluna/src/app/portal/account/page.tsx` lines 52–58 (email displayed but not editable). If the user wants email change, it needs its own design with verification flow, which is at least a medium-sized follow-on feature.

**Gap 2 — Password section for Google-only users**
A user who signed in exclusively via Google has `users.password = null`. Three options: (a) hide the section, (b) show "sign in with Google" callout, (c) offer to set a password. Options (b) and (a) are low-cost. Option (c) requires a new code path where a Credentials provider-less user sets a password — the `users.password` column exists and is nullable so the DB allows it, but NextAuth would need to be tested to confirm the Credentials provider accepts a user who initially had no password. Recommendation: **ask the user which of (a) or (b) they want; defer (c) as future scope.**

**Gap 3 — 2FA enrollment for non-admin users**
Today, TOTP enrollment lives at `/admin/2fa`, gated by `admin.dashboard`. A non-admin user with `twoFactorRequired = true` is pushed to `/totp` for verification but has no self-serve way to enroll. The `/account` page is the natural place to surface enrollment for all users. However, reusing the `/admin/2fa` enrollment UI requires either moving it or duplicating it at `/account/2fa`. The fertilityluna sibling handles this cleanly: `src/app/account/2fa/setup/` is a standalone enrollment flow at `/account/2fa/setup` (see `src/app/account/2fa/setup/actions.ts`), separate from any admin shell. The actions pattern there (server action `completeEnrollment` returning `EnrollResult`, writing to `userTwoFactor`, generating recovery codes) is directly adaptable. **Ask the user: should `/account` expose TOTP enrollment for all users, or only link to `/admin/2fa` for users who have the `admin.dashboard` feature?**

**Gap 4 — Delete account**
The request doesn't mention it, but sibling pattern suggests it's a common ask. Deleting a user in this schema cascades to `accounts`, `sessions`, `user_roles`, `userTotp`, `userTotpRecoveryCodes`, `userTotpPendingEnrollments` via `onDelete: "cascade"`. It requires a confirmation dialog (shadcn `AlertDialog`, per the no-native-dialogs invariant), an audit event, a sign-out + redirect, and a decision on what happens to a deactivated-vs-deleted user's audit trail (`actorUserId` is nullable in `auditEvents` with `onDelete: "set null"`, so historical events survive). As a starter, a "delete account" button that does soft-deactivate (`isActive = false`) rather than hard-delete is safer and preserves the audit trail. **Ask the user: in scope for v1, deferred, or skeleton-only?**

**Gap 5 — Rate limiting on password change**
No lockout after failed current-password attempts. An attacker with a session token (stolen or XSS) could brute-force the current password. The starter has no rate-limiting library today. For the starter, a note in the server action comment is the minimum; real protection requires either a rate-limit library (e.g. `@upstash/ratelimit`) or a failed-attempt counter. **Surface this as a known gap in the implementation notes; do not block Phase 2 on it.**

**Gap 6 — Mid-enrollment 2FA gate**
If a user has `twoFactorRequired = true` and is mid-enrollment (a pending row exists in `user_totp_pending_enrollments` but no completed row in `user_totp`), the proxy pushes them to `/totp`. `/totp` requires a verified secret, which they don't have yet, and redirects them to `/admin/2fa`. They cannot reach `/account`. If `/account` is the new self-serve enrollment surface (see Gap 3), this circular redirect needs to be resolved: `/account` must be passable for a user in the mid-enrollment state. The proxy currently only special-cases admin routes for the 2FA check (line 40: `const isAdminRoute = pathname.startsWith("/admin")`), so `/account` would already be reachable mid-enrollment — but this should be verified explicitly and documented.

---

## Out of Scope (confirm with user)

- Avatar / profile photo upload (westervillelions has this at `/api/members/profile-picture/route.ts`; it requires storage — out of scope for the starter).
- Email change with re-verification flow (see Gap 1).
- Setting a password for Google-only users to enable dual sign-in (see Gap 2, option c).
- Notification preferences.
- Session management (list active sessions, revoke others).

---

## Open Questions

1. **Email change** — Read-only with "contact admin" note, or in scope for v1?
2. **Google-user password section** — Hide entirely (a), or show "uses Google Sign-In" callout (b)?
3. **2FA enrollment on `/account`** — Expose self-serve TOTP enrollment for all users (new `/account/2fa` flow, modeled on fertilityluna), or show a status-only badge that links to `/admin/2fa` for admin users and is informational-only for non-admins?
4. **Delete account** — In scope, deferred, or skeleton-only button?

---

## Sibling Prior Art

**westervillelions** — `src/app/members/profile/page.tsx` (lines 41–47): renders sign-in email and role as read-only fields, then delegates to a `ProfileForm` client component for editable fields. Password change is handled via a separate reset-token flow (`src/lib/auth/password-reset.ts`), not an inline current-password form — the sibling does not have the "prove you know the current password" pattern, so it is less applicable here.

**fertilityluna** — `src/app/account/page.tsx` (lines 13–14): reads 2FA enrollment status via `isEnrolled(session.user.id)` and displays a card linking to `/account/2fa`. `src/app/account/2fa/setup/actions.ts` (lines 38–101): `completeEnrollment` server action — verifies 6-digit code, encrypts and stores the TOTP secret, generates + hashes 10 recovery codes in a DB transaction, optionally sets a trusted-device cookie. This is the direct model for a non-admin TOTP enrollment flow.

**Pattern for password change (not found in siblings as an inline form):** The canonical bcrypt pattern is in `westervillelions/src/lib/auth/password-reset.ts` (lines 103–108): `bcrypt.hash(newPassword, 10)` then `db.update(users).set({ password: hashedPassword })`. For self-serve change, the server action must additionally call `bcrypt.compare(currentPassword, storedHash)` before hashing the new value — this step is absent from the siblings' reset flows (they use a token instead of current-password verification) and must be written fresh.

---

### What I Did

- Read `src/proxy.ts`, `src/lib/permissions.ts`, `src/lib/db/schema.ts`, `src/lib/audit.ts`, `src/types/actions.ts`, and admin actions for the audit + `ActionResult` patterns.
- Read `westervillelions/src/app/members/profile/page.tsx`, `westervillelions/src/lib/auth/password-reset.ts`, and `westervillelions/src/app/api/auth/register/route.ts` for the bcrypt pattern.
- Read `fertilityluna/src/app/account/page.tsx`, `fertilityluna/src/app/account/2fa/setup/actions.ts`, and `fertilityluna/src/app/portal/account/page.tsx` for the account + TOTP enrollment structure.
- Ran four-pass review: user verbs, flow audit, permissions/flags, gaps.

### Outputs

- `docs/work-log/2026-05-17-account-page.md` (this file)

### Open Questions / Handoff Notes

Four decisions block Phase 2 start (see Open Questions above). Once the user answers, Phase 2 (architect) should note:

- Whether `/account` needs a layout wrapper (likely yes — same nav shell as the rest of the authenticated app).
- Whether a `/account/2fa` sub-route is created (depends on Gap 3 answer).
- The `USER_PASSWORD_CHANGED` audit action key must be added to `src/lib/audit.ts` before Phase 4 starts.
- The proxy does not gate `/account` with a 2FA check today; this is correct behavior — `/account` should remain reachable mid-enrollment so users can complete enrollment there (if Gap 3 answer is "yes, expose self-serve TOTP on /account").

---

## Phase 2 — Architectural Review — 2026-05-17

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The route group, server/client split, and dependency footprint are all clean. The one structural decision that needs a firm ruling before Phase 3 starts is email-verification token storage: use the new `email_verification_tokens` table (option b), not the NextAuth `verification_tokens` table. The verificationTokens table has a composite PK on `(identifier, token)` and no `userId` FK — reusing it would require identifier-hacking and break the NextAuth adapter contract. PR split (three PRs) is strongly recommended.

### What I Did

- Read `docs/work-log/2026-05-17-account-page.md` — Phase 1 output and user decisions.
- Read `src/lib/db/schema.ts` — confirmed existing TOTP columns, `verificationTokens` shape, and `users` columns.
- Read `src/proxy.ts` — confirmed protection model, `PUBLIC_PATHS`, and the admin 2FA gate logic.
- Evaluated email-verification token storage options against the existing schema.
- Assessed proxy invariants for `/account/*` and `/account/verify-email/[token]`.
- Assessed PR sizing.

### Outputs

- `docs/work-log/2026-05-17-account-page.md` (this file, Phase 2 section added).
- No `docs/decisions.md` entry required — the decisions below are implementation-level, not architectural-level structural changes. The new route group and new table are straightforward extensions that follow established starter patterns.

---

### 1. Directory Placement

`src/app/(account)/account/` — confirmed. Mirrors `(admin)/admin/` exactly. Sub-routes follow:

```
src/app/(account)/
  layout.tsx                          — shared layout for /account surface
  account/
    page.tsx                          — profile + password + 2FA status + delete skeleton
    actions.ts                        — updateProfile, changePassword, deleteAccount (stub)
    2fa/
      page.tsx                        — TOTP enrollment flow
      actions.ts                      — startEnrollment, completeEnrollment (adapted from fertilityluna)
    verify-email/
      [token]/
        page.tsx                      — email-change confirmation landing page
```

### 2. Email Re-Verification Token Storage

**Decision: New `email_verification_tokens` table (option b).** Do not reuse `verificationTokens`.

Reasons:
- `verificationTokens` has a composite PK on `(identifier, token)` with no `userId` FK. The NextAuth adapter owns it; overlapping its rows with application data is an adapter-contract violation.
- A dedicated table allows a proper `userId` FK (cascade on delete), a `newEmail` column, an explicit `expiresAt`, and a unique index on `token` alone — none of which fit the `verificationTokens` shape.
- Only one in-flight email-change token per user is needed (the action upserts by `userId`).

Schema for the new table:

```typescript
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),          // crypto.randomBytes(32).toString("hex")
    newEmail: text("new_email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ix_email_ver_token").on(t.token),
    uniqueIndex("ix_email_ver_user").on(t.userId),   // one pending change per user
  ],
);
```

No new columns are added to `users`. The `users.email` field is updated only when the token is consumed.

### 3. Schema Changes Summary

New table (above): `email_verification_tokens`.

Existing columns confirmed present (no additions needed):
- `users.password` — nullable, supports hide-if-null pattern.
- `users.isActive` — supports delete-skeleton soft-deactivation.
- `userTotp`, `userTotpPendingEnrollments`, `userTotpRecoveryCodes` — all present and correct for self-serve enrollment.

New `AUDIT_ACTIONS` keys needed (added to `src/lib/audit.ts` in Phase 4):
- `USER_EMAIL_CHANGE_REQUESTED: "user.email_change_requested"`
- `USER_EMAIL_CHANGED: "user.email_changed"`
- `USER_PASSWORD_CHANGED: "user.password_changed"`
- `USER_ACCOUNT_DELETED: "user.account_deleted"` (even for the skeleton stub — write the event shape now so the catalog is complete)

### 4. Server vs Client Split

| Route | Pattern | Rationale |
|-------|---------|-----------|
| `(account)/layout.tsx` | Server Component | Session read + nav render; no interactivity |
| `account/page.tsx` | Server Component | Reads DB for name, password-null check, 2FA status; passes props down |
| `ProfileForm` component | Client Component | Controlled input + submit handler |
| `PasswordForm` component | Client Component | Three controlled inputs + submit handler |
| `DeleteAccountButton` component | Client Component | AlertDialog requires browser state |
| `account/2fa/page.tsx` | Server Component | Reads pending enrollment state; delegates to client form |
| `TotpEnrollForm` component | Client Component | QR display, OTP input, submit |
| `account/verify-email/[token]/page.tsx` | Server Component | Reads token from DB, performs verification server-side, redirects |

All server actions marked `'use server'` in co-located `actions.ts` files. Actions re-check session and validate inputs server-side regardless of client-side validation.

### 5. Dependencies

No new dependencies needed. All required capabilities are present:
- `crypto` — Node built-in for `randomBytes(32)` token generation.
- `bcryptjs` — already in `package.json` for password compare/hash.
- `otplib`, `qrcode` — already present for TOTP.
- Sonner — confirm it is already installed (used in admin shell); if not, it is the one addition needed.

**Check:** Verify `sonner` is in `package.json` before Phase 4. If absent, it is a justified addition (replaces non-existent toast infrastructure; no Edge constraint).

### 6. Invariant Rulings

**Proxy — `/account/*` authentication gate.**
The proxy already handles this correctly. Any path not in `PUBLIC_PATHS` and not under `/api/` redirects unauthenticated users to `/signin`. `/account` is not in `PUBLIC_PATHS` and not under `/api/`, so the existing unauthenticated redirect fires without any change to `proxy.ts`.

**Proxy — `/account/verify-email/[token]` must be reachable unauthenticated.**
A user clicks the verification link in a different browser session. This path must be added to `PUBLIC_PATHS`:

```typescript
"/account/verify-email",   // prefix match won't work — add the token route differently
```

Because `PUBLIC_PATHS` uses `Set.has()` (exact match), the proxy must be changed to also allow paths that *start with* `/account/verify-email/`. The cleanest change: add a prefix check before the `PUBLIC_PATHS.has()` call, or add the dynamic segment to the public-path logic. Phase 3 (tech-lead) should specify the exact proxy change. This is a small, targeted proxy edit — it does not affect `PROTECTION_RULES`.

**Proxy — 2FA mid-enrollment and `/account`.**
The 2FA gate in the proxy fires only for `isAdminRoute` (`pathname.startsWith("/admin")`). `/account/*` paths are not admin routes, so a user who has `twoFactorRequired = true` but has not yet enrolled can reach `/account/2fa` freely. This is the correct behavior — it resolves Phase 1 Gap 6 without any proxy change.

**Password change — no other sign-in method guard.**
If a user has `users.password` set and no OAuth `accounts` row, blanking the password would lock them out. The server action must verify `password IS NOT NULL` before allowing the change (it already will because the section is hidden when `password` is null), and must not offer a "clear password" path. The stub delete action must not set `password = null` as part of cleanup without also checking OAuth providers.

**Email uniqueness.**
The `changeEmailAction` must check that `newEmail` is not already present in `users.email` before inserting the token row. It must also check that `newEmail` is not already in a pending `email_verification_tokens` row for *another* user. The uniqueIndex on `(userId)` enforces one in-flight change per user but not cross-user uniqueness on `newEmail` — the action must do that check explicitly in SQL.

**Delete account — skeleton behavior.**
The stub action must: sign the user out (invalidate sessions), write the `USER_ACCOUNT_DELETED` audit event with `actorUserId` and `actorEmail` captured *before* deletion, then redirect to `/`. The TODO comment must state clearly that hard-delete cascade and soft-deactivation are fork choices.

### 7. PR Sizing — Recommended Split (three PRs)

**Recommended: Split A — three PRs.**

| PR | Scope | Schema change? | New routes |
|----|-------|---------------|------------|
| PR 1 | `/account` index — profile name edit, password change, 2FA status pill, delete skeleton | No | `(account)/account/page.tsx` + actions |
| PR 2 | `/account/2fa` — self-serve TOTP enrollment | No | `account/2fa/` sub-route |
| PR 3 | Email re-verification — editable email field + token table + verify route + proxy patch | Yes (`email_verification_tokens`) | `account/verify-email/[token]/` + proxy change |

Rationale: PR 3 is the only one that touches the schema and the proxy. Keeping it isolated means PRs 1 and 2 can be reviewed and deployed before the most structurally complex piece lands. If PR 3 reveals issues (token expiry UX, email provider integration), it can be revised without blocking the simpler flows. PR 1 and PR 2 are independent and can be authored in parallel once the tech-lead's design is complete.

Each PR gets its own work-log slug; this work-log tracks the full feature intent and the split decision.

### Open Questions / Handoff Notes

- **Tech-lead (Phase 3):** Specify the exact proxy change for `/account/verify-email/[token]` public access. Prefix-match addition is the path of least resistance.
- **Tech-lead (Phase 3):** Confirm `sonner` is installed; if not, add it and log it as a dependency decision.
- **Tech-lead (Phase 3):** The `emailVerificationTokens` table needs to be added to `src/lib/db/schema.ts` and a migration generated (`npm run db:generate`) before Phase 4 work on PR 3 starts.
- **Implementer (Phase 4, PR 1):** Add the four `AUDIT_ACTIONS` keys to `src/lib/audit.ts` at the start of implementation, before the actions that reference them.
- **Implementer (Phase 4, PR 2):** Adapt fertilityluna's `completeEnrollment` action verbatim where the DB writes match; the `trusted-device cookie` step is optional for the starter (include it for parity).
- **All phases:** The `(account)/layout.tsx` should reuse the same nav/shell pattern as `(admin)/admin/layout.tsx` — confirm with the UX developer what shared nav component to use.

---

## Decisions from User — 2026-05-17

1. **Email change:** Editable with re-verification flow. New email is held pending until the user clicks a verification link sent to it; only then is `users.email` updated.
2. **Google-user password section:** Hide entirely. A user with no `password` row has no password section rendered.
3. **2FA self-serve:** Add `/account/2fa` for every signed-in user. Adapt fertilityluna's enrollment server actions.
4. **Delete account:** Ship the skeleton — button + AlertDialog confirm + stub server action with a TODO comment explaining "cascade-delete is fork-specific."

Editable email is the scope expander. Architect should reassess sizing and decide whether this stays one PR or splits.

## Phase 2.5 — Scope Decision (post-architect)

Architect recommended three PRs (index + 2FA, then email re-verification). Bundling into **one PR** for v0.3 to keep the user-facing feature count at four (matching the user's "top 4" ask). The schema addition (new `email_verification_tokens` table) and the proxy prefix-match change are both small and additive — bundling is acceptable. If implementation balloons past ~600 LOC the tech-lead may re-split per architect's plan.

---

## Phase 3 — Technical Design — 2026-05-17

**Owner:** tech-lead
**Status:** complete

### Summary

One PR ships four user-facing capabilities under a new `(account)` route group: profile name edit, email change with re-verification, password change (Credentials users only), TOTP self-enrollment, delete-account skeleton, and a 2FA status pill. The schema gains one new table (`email_verification_tokens`). The proxy gains one prefix-match exception. No new npm dependencies.

---

### 1. Diff Plan — Every File Created or Modified

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/db/schema.ts` | Modify | Add `emailVerificationTokens` table + relation to `users` |
| `drizzle/0001_email_verification_tokens.sql` | Create | Versioned migration for the new table |
| `src/lib/audit.ts` | Modify | Add 4 new `AUDIT_ACTIONS` keys |
| `src/proxy.ts` | Modify | Prefix-match exception for `/account/verify-email/` |
| `src/app/(account)/layout.tsx` | Create | Shared nav shell for `/account` surface |
| `src/app/(account)/account/page.tsx` | Create | Main account page (Server Component) |
| `src/app/(account)/account/actions.ts` | Create | `updateProfile`, `requestEmailChange`, `changePassword`, `requestAccountDeletion` |
| `src/app/(account)/account/profile-form.tsx` | Create | Client component — name field + submit |
| `src/app/(account)/account/email-form.tsx` | Create | Client component — new email field + submit |
| `src/app/(account)/account/password-form.tsx` | Create | Client component — current + new + confirm fields |
| `src/app/(account)/account/delete-button.tsx` | Create | Client component — AlertDialog confirm + stub action call |
| `src/app/(account)/account/2fa-status.tsx` | Create | Client component — enrollment status pill + enroll link |
| `src/app/(account)/account/2fa/page.tsx` | Create | TOTP enrollment page (Server Component) |
| `src/app/(account)/account/2fa/actions.ts` | Create | `startEnrollment`, `completeEnrollment`, `regenerateRecoveryCodes` |
| `src/app/(account)/account/2fa/totp-enroll-form.tsx` | Create | Client component — QR display + OTP input |
| `src/app/(account)/account/verify-email/[token]/page.tsx` | Create | Email verification landing (Server Component — runs verifyEmailChange server-side and redirects) |

**No other source files are modified.**

---

### 2. Schema Change

#### New table — `emailVerificationTokens`

Add to `src/lib/db/schema.ts` after the `verificationTokens` table:

```typescript
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),         // crypto.randomBytes(32).toString("hex")
    newEmail: text("new_email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ix_email_ver_token").on(t.token),   // lookup by token; ensures one-shot
    uniqueIndex("ix_email_ver_user").on(t.userId),   // one pending change per user
  ],
);
```

Also add the relation to `usersRelations`:

```typescript
emailVerificationTokens: many(emailVerificationTokens),
```

And a standalone relation export:

```typescript
export const emailVerificationTokensRelations = relations(
  emailVerificationTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [emailVerificationTokens.userId],
      references: [users.id],
    }),
  }),
);
```

#### Indexes

- `ix_email_ver_token` (unique) — fast token lookup on verification; uniqueness enforces one-shot use after delete.
- `ix_email_ver_user` (unique) — enforces one in-flight change per user; upsert pattern replaces old pending row.

#### Migration strategy

`drizzle/0000_initial.sql` already exists, so the project is in versioned-migration mode. Use `npm run db:generate` to produce `drizzle/0001_email_verification_tokens.sql`. Do not use `db:push` — that would be lossy. The implementer runs `db:generate` after editing `schema.ts`, reviews the generated SQL, commits both files together, then applies with `npm run db:migrate` (or the Neon branch process via the `neon-postgres` skill).

---

### 3. Server-Action Signatures

All actions live in `'use server'` files. Every action re-checks the session at the top and returns early with `{ ok: false, error: "..." }` on auth failure. No action trusts client-supplied user IDs.

#### `src/app/(account)/account/actions.ts`

```typescript
// All actions return ActionResult<T> from "@/types/actions"

export async function updateProfile(
  input: { name: string }
): Promise<ActionResult>
// Validates: name non-empty, max 100 chars (trim whitespace).
// Writes: db.update(users).set({ name: trimmed }).where(eq(users.id, session.user.id))
// After: revalidatePath("/account")
// Audit: none — not security-sensitive.
// Session: name is NOT currently refreshed by the JWT callback (jwt() only reads
//   email, isActive, twoFactorRequired from dbUser). The page re-renders via
//   revalidatePath and reads name fresh from DB — but the JWT token still holds
//   the old name. This is acceptable for the starter. Log it as a known gap;
//   do NOT call unstable_update just for a display name change.

export async function requestEmailChange(
  input: { newEmail: string }
): Promise<ActionResult>
// Validates: valid email format, not equal to current email (case-insensitive).
// Collision check: SELECT 1 FROM users WHERE email = newEmail (if found: reject
//   with "That email is already in use.").
// Pending-token check: upsert — DELETE FROM email_verification_tokens WHERE
//   userId = session.user.id, then INSERT new row.
//   (uniqueIndex on userId means a plain INSERT ON CONFLICT UPDATE is fine too.)
// Token: crypto.randomBytes(32).toString("hex") — 64 hex chars, 256 bits.
// Expiry: new Date(Date.now() + 24 * 60 * 60 * 1000)
// Sends: sendEmail({ to: newEmail, subject: ..., html: ... }) — see §5 below.
// Audit: AUDIT_ACTIONS.USER_EMAIL_CHANGE_REQUESTED, metadata: { newEmail }
// Returns: { ok: true } — toast "Check your new inbox for a verification link."

export async function changePassword(
  input: { currentPassword: string; newPassword: string; confirmPassword: string }
): Promise<ActionResult>
// Guard: fetch users.password from DB. If null, return { ok: false, error: "No password set." }
// Validates: currentPassword matches stored hash via bcrypt.compare.
//   If not: { ok: false, error: "Current password is incorrect." }
// Validates: newPassword.length >= 8. confirmPassword === newPassword (server re-check).
// Writes: bcrypt.hash(newPassword, 10) → db.update(users).set({ password: hash })
// Audit: AUDIT_ACTIONS.USER_PASSWORD_CHANGED
// After: revalidatePath("/account")

export async function requestAccountDeletion(): Promise<ActionResult>
// Stub. Does NOT delete or deactivate the user row.
// Audit: AUDIT_ACTIONS.USER_ACCOUNT_DELETED, metadata: { stub: true }
// Returns: { ok: true } — toast "Account deletion is not yet implemented. Contact support."
// TODO comment: "Replace stub with either hard-delete cascade or isActive=false
//   soft-deactivation. Hard-delete: sign out first (signOut()), capture actorEmail
//   before delete, then db.delete(users). Soft-deactivate: set isActive=false,
//   sign out. auditEvents rows survive either way (actorUserId set null by cascade)."
```

#### `src/app/(account)/account/2fa/actions.ts`

```typescript
export async function startEnrollment(): Promise<ActionResult<{ uri: string; secret: string }>>
// Mirrors fertilityluna pattern.
// Generates otplib secret, encrypts with encryptSecret(), inserts/replaces row in
//   userTotpPendingEnrollments (expiresAt = now + 10 min).
// Returns: { ok: true, data: { uri: generateURI(secret, email, issuer), secret } }
// The QR code is rendered client-side from `uri` using the `qrcode` package
//   (import QRCode from "qrcode"; QRCode.toDataURL(uri) in a useEffect).

export async function completeEnrollment(
  input: { code: string }
): Promise<ActionResult<{ recoveryCodes: string[] }>>
// Fetches pending row; rejects if expired.
// Decrypts ciphertext → verifySync(code, secret).
// On success (in a DB transaction):
//   1. Insert into userTotp (secretCiphertext, enrolledAt).
//   2. Generate 10 recovery codes: crypto.randomBytes(5).toString("hex") each
//      (10 hex chars = 40 bits of entropy, matching fertilityluna pattern).
//   3. Hash each code: createHash("sha256").update(code).digest("hex").
//   4. Insert 10 rows into userTotpRecoveryCodes.
//   5. Delete pending row.
// Sets trusted-device cookie (optional parity with fertilityluna — include it).
// Audit: AUDIT_ACTIONS.TOTP_ENROLLED
// Returns: { ok: true, data: { recoveryCodes } } — show codes once, no DB store of plaintext.

export async function regenerateRecoveryCodes(): Promise<ActionResult<{ recoveryCodes: string[] }>>
// Requires completed enrollment (userTotp row must exist).
// In a transaction: DELETE all existing recovery codes for userId, INSERT 10 new ones.
// Audit: AUDIT_ACTIONS.TOTP_RECOVERY_CODES_REGENERATED
// Returns: { ok: true, data: { recoveryCodes } }
```

#### Email verification — `src/app/(account)/account/verify-email/[token]/page.tsx`

This is a **Server Component** that runs the verification inline (no separate action file). The page:

1. Reads `token` from params.
2. Queries `email_verification_tokens` by token.
3. If not found or expired: renders an error card ("Link invalid or expired.").
4. If valid: in a transaction — `UPDATE users SET email = newEmail WHERE id = userId`, `DELETE FROM email_verification_tokens WHERE id = rowId`.
5. Writes audit event `AUDIT_ACTIONS.USER_EMAIL_CHANGED`, metadata `{ oldEmail, newEmail }`.
6. Calls `revalidatePath("/account")`.
7. Redirects to `/account?emailChanged=1` (the account page reads this param and shows a success toast via a client-side `useSearchParams` in a small `SearchParamToast` wrapper component).

The JWT callback already reads `dbUser.email` on every request, so the new email takes effect on the very next authenticated request. No `unstable_update` call needed.

**Unauthenticated access:** this page is reachable without a session (see proxy change below). The page must NOT call `auth()` in a way that throws — it must tolerate a null session.

---

### 4. Proxy Change

In `src/proxy.ts`, add a prefix check **before** the `PUBLIC_PATHS.has(pathname)` check:

```typescript
if (pathname.startsWith("/account/verify-email/")) return NextResponse.next();
```

Place it after the `/api/` check and before the `PUBLIC_PATHS.has()` check. This is the smallest possible change — one line, no impact on any other route.

---

### 5. Email Template

`requestEmailChange` calls `sendEmail` from `src/lib/email.ts` with:

```typescript
await sendEmail({
  to: input.newEmail,
  subject: "Confirm your new email address",
  html: `
    <p>Hi,</p>
    <p>You requested to change your email address to <strong>${input.newEmail}</strong>.</p>
    <p>Click the link below to confirm. The link expires in 24 hours.</p>
    <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    <p>If you did not request this change, you can ignore this email.</p>
  `,
  text: `Confirm your email change: ${verifyUrl}\n\nExpires in 24 hours. If you did not request this, ignore this email.`,
});
```

Where `verifyUrl` is constructed as:

```typescript
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const verifyUrl = `${baseUrl}/account/verify-email/${token}`;
```

`NEXT_PUBLIC_APP_URL` must be set in production (add it to `.env.example` with a comment). In dev it falls back to localhost — the existing `sendEmail` no-op already handles the missing Resend key.

---

### 6. Page Composition — `/account/page.tsx`

This is a **Server Component**. It:

- Calls `auth()` and redirects to `/signin` if no session (belt-and-suspenders; proxy already does this).
- Fetches from DB: `users` row for `{ name, email, password }`, `userTotp` row to determine enrollment.
- Derives: `hasPassword = user.password !== null`, `isEnrolled = !!totp`.
- Renders four cards in order:

```
Card 1 — Profile
  Read-only: email (with "pending change" note if a token row exists for this user)
  <ProfileForm name={user.name} /> — client component

Card 2 — Email
  <EmailForm currentEmail={user.email} /> — client component

Card 3 — Password  (rendered only if hasPassword === true)
  <PasswordForm /> — client component

Card 4 — Two-Factor Authentication
  <TwoFactorStatusPill isEnrolled={isEnrolled} /> — client component
  Enrolled: green pill "Active" + link to /account/2fa (to regenerate codes)
  Not enrolled: amber pill "Not set up" + Link to /account/2fa

Card 5 — Delete Account
  <DeleteAccountButton /> — client component (AlertDialog)
```

**`/account/2fa/page.tsx`** — Server Component. Reads `userTotp` and `userTotpPendingEnrollments` to determine state:
- No pending, no enrolled: calls `startEnrollment()` as a server action *on load* (or exposes a "Begin setup" button that calls it). Renders `<TotpEnrollForm>` with QR + code input.
- Pending (not expired): renders `<TotpEnrollForm>` — allows re-submission.
- Enrolled: renders current status + "Regenerate recovery codes" button.

The cleanest pattern is: page loads, server checks for pending row, if none calls `startEnrollment()` server-side (not as an action but as a direct function call), passes `{ uri, secret }` as props to `<TotpEnrollForm>`. This avoids a client-side round-trip to show the QR code.

**`(account)/layout.tsx`** — Server Component, mirrors admin layout:
- Calls `auth()`, redirects if no session.
- Does NOT enforce the 2FA gate (intentional — user must be able to reach `/account/2fa` to enroll).
- Nav links: "Account" → `/account`, "Two-Factor Auth" → `/account/2fa`.
- Sign-out button (inline server action pattern, same as admin layout).

---

### 7. Edge Cases

**Google user / email change:** A Google user who changes their display email via this flow updates `users.email`. Their `accounts.providerAccountId` remains the Google sub ID — unchanged. Future Google sign-ins still work because `allowDangerousEmailAccountLinking: true` links by email AND the adapter checks `accounts` by provider + providerAccountId first. However: if the user changes to an email that belongs to a *different* Google account, their next Google sign-in (with the new Google account) would link to this user row. This is an acceptable edge-case in the starter — document it in a TODO comment in `requestEmailChange`.

**Pending email-change collision (cross-user):** `requestEmailChange` must run this check before inserting the token:

```typescript
const taken = await db.query.users.findFirst({
  where: eq(users.email, input.newEmail),
  columns: { id: true },
});
if (taken) return { ok: false, error: "That email is already in use." };
```

The uniqueIndex on `users.email` is the DB-level backstop; this check gives a friendly message before hitting it.

**Token expiry / replay:** `verifyEmailChange` (in the page) checks `row.expiresAt > new Date()`. On success it deletes the row immediately — a second browser tab clicking the same link gets "Link invalid or expired." The transaction ensures atomicity.

**`name` in JWT:** The JWT callback currently does NOT refresh `users.name` on each request (it only reads `email`, `isActive`, `twoFactorRequired`). `updateProfile` calls `revalidatePath("/account")` so the server-rendered page re-fetches from DB. The JWT token holds the stale name until the user signs out and back in. This is a known, documented gap — do not call `unstable_update` for name changes; the display name in the nav shell will lag the DB until re-login. Add a TODO comment to the action noting this.

**Pending email note:** On page load, the server queries `email_verification_tokens` for the current `userId`. If a pending row exists, render a small callout under the email field: "Pending change to [newEmail] — check your inbox. [Cancel]". "Cancel" calls a `cancelEmailChange` action that deletes the pending token. This is a small UX detail — include it; it prevents confusing states where a user changes their mind.

---

### 8. Implementation Order

1. **Schema + migration.** Edit `schema.ts` (add table + relations). Run `npm run db:generate`. Review `drizzle/0001_...sql`. Apply on Neon dev branch.
2. **Audit actions.** Add 4 keys to `src/lib/audit.ts`.
3. **Proxy change.** One-line prefix exception in `src/proxy.ts`.
4. **Layout.** `src/app/(account)/layout.tsx`.
5. **Account actions** (`account/actions.ts`) — `updateProfile`, `requestEmailChange`, `changePassword`, `requestAccountDeletion`, `cancelEmailChange`.
6. **Account page + client components** — `account/page.tsx`, `profile-form.tsx`, `email-form.tsx`, `password-form.tsx`, `delete-button.tsx`, `2fa-status.tsx`.
7. **2FA actions** (`account/2fa/actions.ts`) — `startEnrollment`, `completeEnrollment`, `regenerateRecoveryCodes`.
8. **2FA page + client component** — `account/2fa/page.tsx`, `totp-enroll-form.tsx`.
9. **Verify-email page** — `account/verify-email/[token]/page.tsx`.
10. **Add `NEXT_PUBLIC_APP_URL` to `.env.example`** with comment.
11. **Typecheck + build** — `npm run typecheck && npm run build`.

---

### What I Did

- Read the full work-log (Phases 1, 2, 2.5 and user decisions).
- Read `src/lib/db/schema.ts`, `src/auth.ts`, `src/proxy.ts`, `src/lib/audit.ts`, `src/lib/email.ts`, `src/types/actions.ts`, `src/app/(admin)/admin/layout.tsx`.
- Confirmed `sonner` is installed (`"sonner": "^2.0.7"` in `package.json`).
- Confirmed `drizzle/0000_initial.sql` exists — versioned migration mode is active.
- Confirmed JWT callback already refreshes `email` from DB on every request; `name` is not refreshed (documented gap).
- Authored full design doc above.

### Outputs

- `docs/work-log/2026-05-17-account-page.md` (this file, Phase 3 section added)

### Open Questions / Handoff Notes

- **Implementer: `full-stack-developer`.** This spans schema, server actions, and React components but is small and tightly coupled — splitting implementers adds overhead.
- Start with step 1 (schema + migration) so the table exists before any action references it.
- `cancelEmailChange` is a small addition not listed in the original action spec — include it; it's one DB delete and completes the email-change UX.
- The `startEnrollment` function in `account/2fa/page.tsx` should be called as a **direct function** (not via a client-side action) so the QR URI is available for server-side rendering. Import the underlying logic from `account/2fa/actions.ts` into the page without the `'use server'` boundary crossing.
- Do NOT add `unstable_update` calls for name changes. Document the JWT lag gap with a TODO comment.
- The `NEXT_PUBLIC_APP_URL` env var must be added to `.env.example` before this ships — the verify link is broken in production without it.

---

## Phase 4 — Implementation (full-stack) — 2026-05-17

**Owner:** full-stack-developer
**Status:** complete

### Summary

Built the complete self-serve account page bundle in one PR as per the Phase 2.5 bundling decision. Three sub-surfaces ship together: `/account` (profile, email change, password, 2FA status, delete skeleton), `/account/2fa` (self-serve TOTP enrollment and code regeneration), and `/account/verify-email/[token]` (unauthenticated email verification landing). Schema gained one new table. All 5 gate checks pass.

### What I Did

- Added `emailVerificationTokens` table and relations to `src/lib/db/schema.ts`.
- Ran `npm run db:generate` — produced `drizzle/0001_rapid_thor_girl.sql`.
- Added 6 new `AUDIT_ACTIONS` keys to `src/lib/audit.ts` and updated the regression test.
- Added prefix-match proxy exception for `/account/verify-email/` in `src/proxy.ts`.
- Created `(account)` route group with shared layout (no 2FA gate, per design).
- Wrote all server actions: `updateProfile`, `requestEmailChange`, `cancelEmailChange`, `changePassword`, `requestAccountDeletion` in `account/actions.ts`; `prepareEnrollment`, `completeEnrollment`, `regenerateRecoveryCodes` in `account/2fa/actions.ts`.
- Built 8 client components: `ProfileForm`, `EmailForm`, `PasswordForm`, `DeleteAccountButton`, `TwoFactorStatusPill`, `SearchParamToast`, `TotpEnrollForm`, `RegenerateCodesForm`.
- Created minimal `AlertDialog` component at `src/components/ui/alert-dialog.tsx` using `@radix-ui/react-dialog` (already in package.json — no new dep).
- Verify-email page runs the DB transaction server-side and redirects to `/account?emailChanged=1`; `SearchParamToast` fires the success toast client-side via `useSearchParams`.
- Added `NEXT_PUBLIC_APP_URL` to `.env.example` with comment.

### Outputs

**Schema:**
- `src/lib/db/schema.ts` — `emailVerificationTokens` table + relation
- `drizzle/0001_rapid_thor_girl.sql` — migration file (apply with `npm run db:migrate` or Neon branch)

**Infra:**
- `src/lib/audit.ts` — 6 new AUDIT_ACTIONS keys
- `src/proxy.ts` — 1-line prefix exception for `/account/verify-email/`
- `src/lib/audit.test.ts` — updated regression guard (8 → 14 entries)
- `.env.example` — `NEXT_PUBLIC_APP_URL` entry
- `src/components/ui/alert-dialog.tsx` — new minimal AlertDialog (no new npm dep)

**`/account` sub-surface:**
- `src/app/(account)/layout.tsx`
- `src/app/(account)/account/page.tsx`
- `src/app/(account)/account/actions.ts` — `updateProfile`, `requestEmailChange`, `cancelEmailChange`, `changePassword`, `requestAccountDeletion`
- `src/app/(account)/account/profile-form.tsx`
- `src/app/(account)/account/email-form.tsx`
- `src/app/(account)/account/password-form.tsx`
- `src/app/(account)/account/delete-button.tsx`
- `src/app/(account)/account/2fa-status.tsx`
- `src/app/(account)/account/search-param-toast.tsx`

**`/account/2fa` sub-surface:**
- `src/app/(account)/account/2fa/page.tsx`
- `src/app/(account)/account/2fa/actions.ts` — `prepareEnrollment`, `completeEnrollment`, `regenerateRecoveryCodes`
- `src/app/(account)/account/2fa/totp-enroll-form.tsx`
- `src/app/(account)/account/2fa/regenerate-codes-form.tsx`

**`/account/verify-email` sub-surface:**
- `src/app/(account)/account/verify-email/[token]/page.tsx`

**Audit events written:**
- `USER_EMAIL_CHANGE_REQUESTED` — in `requestEmailChange`
- `USER_EMAIL_CHANGE_CANCELLED` — in `cancelEmailChange`
- `USER_EMAIL_CHANGED` — in verify-email page (DB transaction)
- `USER_PASSWORD_CHANGED` — in `changePassword`
- `USER_DELETION_REQUESTED` — in `requestAccountDeletion` (stub)
- `TOTP_ENROLLED` — in `completeEnrollment`
- `TOTP_RECOVERY_CODES_REGENERATED` — in `regenerateRecoveryCodes`

**New env var:** `NEXT_PUBLIC_APP_URL` — must be set in production for email verify links. Falls back to `http://localhost:3000` in dev.

### Gate Results

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test` (24 unit tests) | PASS |
| `npm run test:e2e` (3 tests) | PASS |
| `npm run check:audit` | PASS |
| No console.log in new code | PASS |
| No native dialogs | PASS (AlertDialog used) |
| Migration file exists in drizzle/ | PASS |

---

### Loop-back fixes (2026-05-17)

**Bug 1 — verify-email moved out of `(account)` route group**
- Created `src/app/(email-verify)/account/verify-email/[token]/page.tsx` — identical logic, no auth layout wrapper.
- Deleted `src/app/(account)/account/verify-email/[token]/` (and its contents).
- Updated `.next/types/validator.ts` stale reference (generated file; Next.js rebuild will regenerate).
- `e2e/account-page.spec.ts:99` now passes — unauthenticated verify-email request stays on path instead of redirecting to `/signin`.

**Bug 2 — pending-token cross-user collision check added**
- `src/app/(account)/account/actions.ts` — added `pendingTaken` query after the existing `taken` check in `requestEmailChange`. Uses `and(eq(emailVerificationTokens.newEmail, newEmail), ne(emailVerificationTokens.userId, session.user.id))`. Returns `{ ok: false, error: "That email is already pending verification on another account." }` if found.
- `src/app/(account)/account/account-actions.test.ts` — replaced "KNOWN GAP" placeholder with two real guard tests for `pendingTokenCollisionDetected`.

**Minor — USER_PROFILE_UPDATED wired into updateProfile**
- `src/app/(account)/account/actions.ts` — added `db.insert(auditEvents)` call with `AUDIT_ACTIONS.USER_PROFILE_UPDATED` in `updateProfile`. No catalog or test changes needed (both already reference the key).

**Bonus — e2e type error fixed**
- `e2e/account-page.spec.ts` — changed `Parameters<Parameters<typeof test>[1]>[0]["page"]` to `Page` (imported from `@playwright/test`). This was a pre-existing type error introduced when QA created the file; the complex expression resolved to `never` under the installed Playwright types.

**Gate results after loop-back:**

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run test` (43 unit tests) | PASS |
| `npm run build` | PASS |
| `npm run test:e2e` (9 tests — all pass incl. line 99) | PASS |
| `npm run check:audit` | PASS |

---

### Open Questions / Handoff Notes

**For QA (Phase 5):**
- Apply migration to dev DB before testing: `npm run db:migrate` or use Neon branch.
- The email verification flow requires `NEXT_PUBLIC_APP_URL` set in `.env.local` (or the local fallback `http://localhost:3000` works for manual testing).
- The delete-account stub fires an audit event but does NOT deactivate or delete the user — verify the toast message is clear about this.
- The JWT name-lag gap: after updating display name, the nav shell still shows the old name until re-login. This is documented in the action with a TODO. QA should note this as a known gap, not a bug.
- The `regenerateRecoveryCodes` action on `/account/2fa` now returns codes inline via client state (not the cookie path), making it React-controlled. The cookie path is still used by the server-side enrollment on `/account/2fa` page load. Both need to be tested.
- Cross-browser test: verify `/account/verify-email/[token]` works without an active session (proxy exception must fire before the auth redirect).
- **Next agent: qa**

---

## Phase 5 — Verification (qa) — 2026-05-17

**Owner:** qa
**Status:** complete

### Summary

FAIL — 2 blocking bugs returned to implementer (Phase 4). First, a structural bug: `account/verify-email/[token]/page.tsx` is inside the `(account)` route group whose `layout.tsx` enforces authentication, so unauthenticated email verification links redirect to `/signin` instead of rendering the error/success page — directly contradicting the Phase 3 proxy design. Second, a security gap: `requestEmailChange` checks `users.email` for collisions but does not check `email_verification_tokens.newEmail`, allowing two users to simultaneously claim the same new email. All other security and correctness checks passed. Typecheck, build, and 42 unit tests are green.

### What I Did

- Read the full work-log (Phases 1 through 4).
- Verified all 17 new files are present in `src/app/(account)/`.
- Applied the migration (`drizzle/0001_rapid_thor_girl.sql`) via `npm run db:migrate` — it had not been applied to the dev DB before Phase 5 started.
- Gate 1 — `npm run typecheck`: PASS.
- Gate 2 — `npm run build`: PASS. Route table shows `/account`, `/account/2fa`, `/account/verify-email/[token]`.
- Gate 3 — `npm run test`: 42 unit tests (6 files) — PASS. Added 18 new tests in `src/app/(account)/account/account-actions.test.ts`.
- Gate 4 — `npm run test:e2e`: 9 tests total — 8 PASS, 1 FAIL (the intentional regression anchor for Bug 1). Added 6 new e2e tests in `e2e/account-page.spec.ts`.
- Gate 5 — `npm run check:audit`: PASS.
- Gate 6 — security/correctness checks via code read:
  - `changePassword` verifies current password via `bcrypt.compare` before writing — PASS (`actions.ts:169`).
  - `changePassword` rejects when `users.password` is null — PASS (`actions.ts:165-167`).
  - `requestEmailChange` rejects when target email is already in `users.email` — PASS (`actions.ts:70-74`).
  - `requestEmailChange` rejects when target email is in a pending token for another user — **FAIL** (Bug 2, missing check).
  - `verifyEmailChange` deletes the pending-token row on success inside a transaction — PASS (`verify-email/[token]/page.tsx:50-68`).
  - `verifyEmailChange` checks `expiresAt` and rejects expired tokens — PASS (`page.tsx:28`).
  - Email-change token expiry is 24 hours — PASS (`actions.ts:77`).
  - 2FA enrollment actions gate by signed-in user — PASS (all three call `auth()` at top).
  - `completeEnrollment` verifies TOTP code before persisting — PASS (`2fa/actions.ts:113`).
  - Delete-account stub writes audit event — PASS (`actions.ts:213-220`).
  - Audit catalog: 14 entries, 6 new keys present and used — PASS (minor: `USER_PROFILE_UPDATED` declared but unused).
  - `emailVerificationTokens` unique indexes on `token` and `userId` — PASS (`schema.ts:243-246`).
  - Proxy prefix exception code is correct (`proxy.ts:25`) — runtime FAIL because layout auth gate fires after proxy (Bug 1).
  - No `console.log` in new code — PASS.
  - No native dialogs — PASS (AlertDialog used in `delete-button.tsx`).

### Bugs Found

**Bug 1 — FAIL — verify-email unauthenticated access broken**
`src/app/(account)/account/verify-email/[token]/page.tsx` is inside the `(account)` route group. The shared layout at `src/app/(account)/layout.tsx:15` calls `auth()` and redirects to `/signin` when there is no session. This fires *after* the proxy passes the request through, making `proxy.ts:25` ineffective at runtime. A user clicking a verification link in a fresh browser session is redirected to `/signin`.
Fix: move the verify-email page outside the `(account)` route group (e.g., a new `(email-verify)` route group with no auth layout).
Regression test: `e2e/account-page.spec.ts:99` — currently fails, documents the bug.

**Bug 2 — FAIL — requestEmailChange does not block cross-user pending-token collision**
Phase 3 design (work-log line 314) required: "It must also check that `newEmail` is not already in a pending `email_verification_tokens` row for another user." The implementation at `src/app/(account)/account/actions.ts:70-74` only queries `users.email`. Two users can simultaneously request a change to the same address; the second gets a DB unique-constraint error at verification time rather than a friendly rejection at request time.
Fix: add `SELECT 1 FROM email_verification_tokens WHERE new_email = $1 AND user_id != $2` after the existing collision check. Reject with "That email is already in use." if found.
Regression anchor: `src/app/(account)/account/account-actions.test.ts` — "pending-token cross-user collision — KNOWN GAP" block.

**Minor — USER_PROFILE_UPDATED orphan entry**
`AUDIT_ACTIONS.USER_PROFILE_UPDATED` is in `src/lib/audit.ts:17` and frozen in the regression test but never written by any action. Not a FAIL trigger — resolve in the same pass as Bug 1/2 (either use it in `updateProfile` or remove from catalog and test).

### Outputs

- `src/app/(account)/account/account-actions.test.ts` — 18 new unit tests
- `e2e/account-page.spec.ts` — 6 new e2e tests (5 pass, 1 regression anchor)
- `docs/work-log/2026-05-17-account-page.md` — Phase 5 section added; phase table updated to FAIL

### Type Check
`npm run typecheck`: PASS

### Unit Tests
Total: 42 | Passed: 42 | Failed: 0 | Duration: ~0.3s

### End-to-End Tests
Total: 9 | Passed: 8 | Failed: 1 | Duration: ~10s
Failures:
- `e2e/account-page.spec.ts:99` — layout auth gate blocks unauthenticated verify-email (Bug 1 regression anchor)

### Regression Tests Added
- `changePassword — no-password guard (Google-only)` — `account-actions.test.ts:44` — guards against Google-only users bypassing the null-password check
- `changePassword — new password too short` — `account-actions.test.ts:66` — guards against the 8-char minimum being removed
- `changePassword — confirm password mismatch` — `account-actions.test.ts:80` — guards against the server-side mismatch check being removed
- `requestEmailChange — same-as-current check` — `account-actions.test.ts:105` — guards against a no-op email change succeeding
- `requestEmailChange — email format validation` — `account-actions.test.ts:126` — guards against malformed emails passing
- `requestEmailChange — pending-token cross-user collision KNOWN GAP` — `account-actions.test.ts:145` — regression anchor for Bug 2
- `emailVerificationTokens schema exports` — `account-actions.test.ts:171` — guards against the table being renamed or removed
- `verify-email layout auth gate` — `e2e/account-page.spec.ts:99` — regression anchor for Bug 1 (currently failing; must pass after fix)

### Verdict: FAIL

Two blocking issues at `src/app/(account)/layout.tsx:15` (Bug 1) and `src/app/(account)/account/actions.ts:70-74` (Bug 2). Return to **full-stack-developer** (Phase 4). Re-run QA after fixes.

### Open Questions / Handoff Notes

- **Implementer (Bug 1):** Move `verify-email/[token]/page.tsx` outside the `(account)` route group. Simplest: create a new `(email-verify)` route group at `src/app/(email-verify)/account/verify-email/[token]/page.tsx` with no auth layout (or a minimal public layout). The proxy prefix exception in `proxy.ts:25` is correct — only the route group nesting needs to change.
- **Implementer (Bug 2):** Add a cross-user pending-token check in `requestEmailChange` after the existing `users.email` check. One query: `db.query.emailVerificationTokens.findFirst({ where: and(eq(emailVerificationTokens.newEmail, newEmail), ne(emailVerificationTokens.userId, session.user.id)) })`. Reject if found.
- **Implementer (minor):** Resolve `USER_PROFILE_UPDATED` — either write it in `updateProfile` or remove it from `src/lib/audit.ts` and `src/lib/audit.test.ts`.
- **Implementer:** Document the `npm run db:migrate` step in the PR description. The migration was not applied before QA, causing an initial 500 on `/account`.
- **Next agent after fixes: qa** (re-verify that `e2e/account-page.spec.ts:99` passes and Bug 2 fix has a proper guard test).

---

## Phase 5 Re-pass — Verification — 2026-05-17

**Owner:** qa
**Status:** complete

### Summary

PASS. Both blockers are resolved and independently verified. Bug 1 (verify-email behind auth gate) is fixed: the page now lives at `src/app/(email-verify)/account/verify-email/[token]/page.tsx`, the old path under `(account)` is gone, and `e2e/account-page.spec.ts:99` passes clean. Bug 2 (cross-user pending-token collision) is fixed: `requestEmailChange` now queries `emailVerificationTokens.newEmail` with `ne(userId)` after the `users.email` check, and the formerly-KNOWN-GAP unit tests assert real behavior. The minor (`USER_PROFILE_UPDATED`) is wired into `updateProfile` with a full audit insert. All four gates are green.

### What I Did

- Verified new verify-email path exists: `src/app/(email-verify)/account/verify-email/[token]/page.tsx` (directory confirmed).
- Verified old path is absent: `src/app/(account)/account/` contains no `verify-email/` subdirectory.
- Verified email template in `actions.ts` still points to `/account/verify-email/${token}` — path is unchanged, only the route group changed (`actions.ts:119`).
- Read `src/app/(account)/account/actions.ts` in full — confirmed `pendingTaken` query at lines 89-98 using `and(eq(emailVerificationTokens.newEmail, newEmail), ne(emailVerificationTokens.userId, session.user.id))`.
- Confirmed the KNOWN GAP anchor is replaced at `account-actions.test.ts:192-232` with two real guard assertions (`pendingTokenCollisionDetected` true/false cases).
- Confirmed `updateProfile` writes `AUDIT_ACTIONS.USER_PROFILE_UPDATED` audit row at `actions.ts:34-41`.
- Gate 1 — `npm run typecheck`: PASS (exit 0, no errors).
- Gate 2 — `npm run build`: PASS. Route table shows `/account/verify-email/[token]` correctly.
- Gate 3 — `npm run test`: 43 tests (6 files) — PASS. Duration: 131ms.
- Gate 4 — `npm run test:e2e`: 9/9 PASS including `e2e/account-page.spec.ts:99` (previously failing). Duration: 9.8s.
- Gate 5 — `npm run check:audit`: PASS.
- Note: test runner required Node 20+ (`styleText` in rolldown). Used Node v20.20.2 via nvm. Node 18 (system default at session start) fails at vitest startup — this is a pre-existing environment mismatch, not a code defect. The project `engines` field already declares `"node": ">=20.9.0"`.

### Outputs

- `docs/work-log/2026-05-17-account-page.md` — Phase 5 re-pass section added; Per-Phase Status row updated to PASS.

### Type Check
`npm run typecheck`: PASS

### Unit Tests
Total: 43 | Passed: 43 | Failed: 0 | Duration: 131ms

### End-to-End Tests
Total: 9 | Passed: 9 | Failed: 0 | Duration: 9.8s

### Regression Tests Confirmed Passing
- `e2e/account-page.spec.ts:99` — layout auth gate blocking unauthenticated verify-email — now PASS
- `account-actions.test.ts:211` — pending-token cross-user collision detected (true case) — PASS
- `account-actions.test.ts:222` — pending-token no collision (false case) — PASS

### Coverage on Critical Modules
Coverage not re-run (no new modules; unit suite is green and stable at 43 tests across 6 files).

### Verdict: PASS

### Open Questions / Handoff Notes

- **Next agent: analyst** (Phase 6 — Shipped vs Intent).
- Node 20 required to run `npm run test`. The system shell defaults to Node 18. Add `.nvmrc` or `package.json` `volta` pin as a follow-up so contributors get the right version automatically.
- The JWT name-lag gap (display name in nav shell lags DB until re-login) is documented in `actions.ts:43-47` — confirmed known gap, not a bug.

---

## Phase 6 — Shipped vs Intent — 2026-05-17

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. Every flow described in Phase 1 shipped and works as agreed. The two bugs caught in Phase 5 (verify-email behind auth gate; missing cross-user pending-token collision check) were corrected before re-pass; both regression tests confirm the fixes. One known gap (JWT name lag in nav shell) is documented in code and is accepted scope. One follow-up (Node version pin) is recorded below.

### What I Did

- Re-read Phase 1 review: user verbs, flows, gaps, decisions.
- Read all 17 shipped files: `account/page.tsx`, `account/actions.ts`, all 7 client components, `account/2fa/page.tsx`, `account/2fa/actions.ts`, `totp-enroll-form.tsx`, `regenerate-codes-form.tsx`, `(email-verify)/account/verify-email/[token]/page.tsx`, `(account)/layout.tsx`, `src/lib/audit.ts`, `src/proxy.ts`.
- Checked every Phase 1 user verb against shipped code.
- Verified each edge case: empty state (Google-only user), failure microcopy, permission gate, audit event coverage, mobile layout eyeball, unauthenticated verify-email path.

### Outputs

- `docs/work-log/2026-05-17-account-page.md` — Phase 6 section added; per-phase status row flipped to Complete / SHIP IT.

### Intent-vs-Shipped Diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| `/account` with profile edit, editable email (re-verification), password change (hidden if no password), 2FA status, delete skeleton | All five cards present and correct | matches |
| `/account/2fa` self-serve TOTP enrollment for any signed-in user | Ships at `(account)/account/2fa/page.tsx`; accessible from nav | matches |
| Email re-verification with Resend link | `requestEmailChange` sends link; `verify-email/[token]` consumes it atomically | matches |
| Cancel-email-change action | `cancelEmailChange` in `actions.ts`, wired to Cancel button in `EmailForm` with pending-change callout | matches |
| Toast feedback via sonner, `ActionResult` shape | All actions return `ActionResult`; all forms call `toast.success` / `toast.error` | matches |
| `AUDIT_ACTIONS` catalog entries for new actions | 6 new keys present in `audit.ts`; every mutation writes an audit row | matches |
| Delete-account = skeleton (button + dialog + stub action that writes audit, does NOT delete) | `DeleteAccountButton` uses `AlertDialog`; `requestAccountDeletion` writes `USER_DELETION_REQUESTED` with `stub: true` and returns informational toast | matches |
| Phase 3 added `cancelEmailChange` and `USER_EMAIL_CHANGE_CANCELLED` | Both present | matches |
| Phase 3 added `USER_PROFILE_UPDATED` (later wired in loop-back) | Wired in `updateProfile`; confirmed in QA re-pass | acceptable drift — resolved by loop-back |
| Proxy prefix exception for `/account/verify-email/` | `proxy.ts:25` — one-line `pathname.startsWith` check | matches |
| verify-email page reachable unauthenticated | Moved to `(email-verify)` route group with no auth layout (Bug 1 fix) | matches |
| Cross-user pending-token collision check | `requestEmailChange` queries `emailVerificationTokens.newEmail` with `ne(userId)` (Bug 2 fix) | matches |

### Edge Cases

| Check | Result | Notes |
|---|---|---|
| Empty state — Google-only user (no password) | pass | Password card is absent when `hasPassword === false`; tested by QA (`account-actions.test.ts:44`) |
| Failure microcopy — email collision | pass | "That email is already in use." (users table check); "That email is already pending verification on another account." (token table check) — both human-readable |
| Failure microcopy — wrong current password | pass | "Current password is incorrect." — clear |
| Failure microcopy — expired verify link | pass | "This verification link has expired. Request a new one from your account settings." with Back to account settings link |
| Failure microcopy — invalid verify link | pass | "This verification link is invalid or has already been used." |
| Permission gate — `/account` requires sign-in | pass | Proxy redirects unauthenticated; layout also redirects as belt-and-suspenders |
| Permission gate — `/account` reachable by any role | pass | No `PROTECTION_RULES` entry for `/account`; proxy falls through to `NextResponse.next()` |
| Permission gate — `/account/verify-email/` reachable unauthenticated | pass | `proxy.ts:25` prefix exception; `(email-verify)` group has no auth layout |
| Audit event — every security-sensitive mutation | pass | `updateProfile` (profile_updated), `requestEmailChange` (change_requested), `cancelEmailChange` (change_cancelled), verify-email page (email_changed), `changePassword` (password_changed), `requestAccountDeletion` (deletion_requested — stub), `completeEnrollment` (totp.enrolled), `regenerateRecoveryCodes` (totp.recovery_codes.regenerated) |
| Mobile — form layouts at 360px | pass | `max-w-xl` container with `w-full` inputs; all cards are single-column; no horizontal overflow expected |
| Mid-enrollment 2FA gate | pass | Layout has no 2FA gate (noted in comment at `layout.tsx:7`); user mid-enrollment can reach `/account/2fa` |
| JWT name lag | known gap | Documented in `actions.ts:43-47`; accepted in Phase 3 design. Nav shell shows stale name until re-login. Not a regression. |

### Follow-Ups (each becomes a tracked item)

1. **Node version pin** — The test suite requires Node 20; the system shell defaults to Node 18. Add `.nvmrc` (or `volta` pin in `package.json`) so contributors get the right version without a manual `nvm use`. Low priority; does not block shipping.

### Open Questions / Handoff Notes

- No open questions. Pipeline is closed.
- The delete-account stub is intentionally incomplete. The TODO comment in `requestAccountDeletion` (`actions.ts:247-253`) explains the fork-specific choices (hard-delete vs soft-deactivate). Any implementer picking this up should read that comment before writing the real flow.
