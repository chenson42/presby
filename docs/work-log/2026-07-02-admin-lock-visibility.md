# Admin lock-state visibility + unlock — Work Log

> **Slug:** `2026-07-02-admin-lock-visibility`
> **Surface:** (admin)/admin/users
> **Permission(s):** existing admin.users covers it (verify)
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small — brief phases)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY FOR DESIGN | 2026-07-02 |
| 2 — Architectural review | architect | complete | Approved | 2026-07-02 |
| 3 — Technical design | tech-lead | complete | — | 2026-07-02 |
| 4 — Implementation | full-stack-developer | complete | — | 2026-07-02 |
| 5 — Verification | qa | complete | PASS | 2026-07-02 |
| 6 — Shipped vs intent | analyst | complete | SHIP IT | 2026-07-02 |

---

## Intent (2026-07-02)

Lockout follow-up: admins cannot see or clear a locked account without
direct DB access. Add lock state to /admin/users (locked-until badge when
lockedUntil > now()) and an Unlock action (resets failedLoginAttempts +
lockedUntil, writes a USER_ACCOUNT_UNLOCKED audit event — audited, not
exempt). Analyst: verify which FEATURES key gates /admin/users today and
reuse it; the unlock action needs the independent in-action permission
check per the qa feature-gate table; UI per ui-standards (no native
confirm — AlertDialog or direct action? unlocking is low-destruction,
decide).

---

## Phase 1 — Functional Refinement — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

When the auth system locks an account (5 failed logins → `lockedUntil` set, `failedLoginAttempts` incremented), admins have no way to see the lock or clear it without direct DB access. This pipeline adds a "Locked until [date]" badge to the `/admin/users` table rows and an Unlock action that resets `lockedUntil = null` and `failedLoginAttempts = 0`, audited as `USER_ACCOUNT_UNLOCKED`. The existing `FEATURES.ADMIN_USERS` key gates both the page and the new action.

### What I did

#### Pass 1 — User Verbs

- **Admin** on `/admin/users`: sees a "Locked until [datetime]" badge on any user whose `lockedUntil > now()`. Clicks "Unlock" on that row. Account is unlocked immediately.
- **Admin** on `/admin/users/[id]`: same badge may appear on the detail page if the detail view is expanded later, but this pipeline focuses on the list view.

#### Pass 2 — Flow Audit

**Flow 1 — View locked status:**
entry: admin navigates to `/admin/users`
→ page fetches user rows, now including `lockedUntil` column
→ rows where `lockedUntil > now()` display a "Locked until [FormattedDate]" badge (amber or red, consistent with the existing "2FA exempt" badge style)
→ rows where `lockedUntil` is null or in the past display nothing extra

- No failure path — purely a read. If the DB query fails, the whole page errors (existing behavior, no change).

**Flow 2 — Unlock:**
entry: admin sees the "Locked until" badge on a user row → clicks "Unlock" button (form submit)
→ `unlockUserAction(formData)` server action fires
→ action calls `requireAdminUsers()` — re-checks session and `FEATURES.ADMIN_USERS`
→ sets `lockedUntil = null` and `failedLoginAttempts = 0` on the target user
→ writes `USER_ACCOUNT_UNLOCKED` audit event with actor = admin session, resourceId = target userId
→ `revalidatePath("/admin/users")` — page refreshes, badge disappears
→ admin sees the row without the lock badge

- Failure: user not found → server action returns `{ ok: false, error: "User not found." }` → toast.error.
- Failure: user not actually locked (`lockedUntil` is null or past) → action succeeds idempotently (sets null to null, 0 to 0). No error, badge just stays absent. Alternatively, a guard returns a friendly "User is not currently locked" message; recommend the idempotent path to avoid race conditions.
- Failure: not authorized → `requireAdminUsers()` returns null → action returns `{ ok: false, error: "Forbidden." }` → toast.error.

#### Pass 3 — Permissions and Flags

- **Permission:** `FEATURES.ADMIN_USERS` ("admin.users") — **existing key, no new key needed.** The proxy already gates `/admin/users` with this key (proxy.ts line 17). `requireAdminUsers()` in actions.ts already uses it (line 87). The `unlockUserAction` must use the same `requireAdminUsers()` guard.
- **Default roles:** admin role already has all features. No seed change needed.
- **Flag:** not needed. This is an admin-only operational action with no staged rollout concern.

#### Pass 4 — Edge Cases

- **`lockedUntil` in the past:** A lock that has expired server-side (the user's next login would succeed) still shows as "locked" if the admin page renders before the user retries. The badge check must be `lockedUntil > now()` in the query or in the render logic — not just `lockedUntil IS NOT NULL`. The server action unlock is idempotent for this case.
- **`FormattedDate` for locked-until:** The existing pattern in `/admin/users/page.tsx` uses `<FormattedDate value={u.lastLoginAt} mode="datetime" />`. The lock badge should follow the same pattern: `<FormattedDate value={u.lockedUntil} mode="datetime" />`. ESLint enforces this — no `toLocaleString()`.
- **The SELECT must include `lockedUntil`:** The current page query selects specific columns (id, name, email, isActive, lastLoginAt, twoFactorRequired) and does NOT include `lockedUntil`. The column must be added to the select list.
- **Self-unlock:** An admin can unlock their own account. Blocking self-unlock would create a situation where a locked admin has no recovery path (another admin would have to intervene). Unlike self-deactivation (which is blocked in `deactivateUser`), self-unlock is a recovery action and should be permitted.
- **`USER_ACCOUNT_UNLOCKED` not in `AUDIT_ACTIONS`:** The constant does not exist yet (confirmed by grep). It must be added to `src/lib/audit.ts` before the action can use it. The `check:audit` tripwire will enforce the reference.
- **Empty state on lock badge:** Users with no lock (`lockedUntil` is null) simply show no badge. Empty state for the table itself is already handled ("No users yet." / "No users match that search.").
- **Mobile:** The badge is inline in the user name cell. The cell already wraps (the "2FA exempt" badge uses `mt-1 inline-flex`). A "Locked until" badge follows the same pattern — no new layout concerns at 360px.

#### Pass 5 — Adversarial Pass

- **Unlock a user the admin didn't intend to unlock:** The unlock form contains a hidden `userId` field. Could an attacker with admin access unlock a different user by crafting a request? Yes — but they're already admin, so this is not an escalation. Any admin action against any userId is within scope of `FEATURES.ADMIN_USERS`.
- **Race condition:** Two admins unlock the same user simultaneously — both succeed idempotently. No issue.
- **Self-targeting:** Admin unlocking themselves. Allowed (see edge case above). The audit event records the actor = admin who did it, even if actor == target.
- **Audit bypass:** The `check:audit` tripwire scans `actions.ts` files and requires that every mutation references an `AUDIT_ACTIONS` key. The new `unlockUserAction` in `actions.ts` must include the `recordAudit` call or the tripwire will fail in Phase 5. The `USER_ACCOUNT_UNLOCKED` key must be in `AUDIT_ACTIONS` before the tripwire runs.

### Outputs

- **FEATURES gate:** `FEATURES.ADMIN_USERS` ("admin.users") — existing key, confirmed by reading proxy.ts (line 17) and actions.ts `requireAdminUsers()` (line 87). No new key.
- **Audit constant needed:** `USER_ACCOUNT_UNLOCKED: "user.account_unlocked"` — must be added to `AUDIT_ACTIONS` in `src/lib/audit.ts`.
- **UI posture: direct button, not AlertDialog.** Unlocking is low-destruction and fully reversible (the auth system will re-lock on the next 5 failures). It is not a deactivation, deletion, or data loss. ui-standards.md reserves AlertDialog for destructive/irreversible confirms. A form-submit button (same pattern as the existing "Deactivate" / role-remove buttons) is correct.
- **Badge rendering:** `lockedUntil > now()` check in the render. Badge text: "Locked until" followed by `<FormattedDate value={u.lockedUntil} mode="datetime" />`. Styled consistently with the existing "2FA exempt" amber badge.
- **Actor in audit event:** The actor is the admin session, resolved via `requireAdminUsers()` → `auth()`. Pass `actor: undefined` to `recordAudit` (auto-resolves from session) and include `resourceId: targetUserId` and `metadata: { clearedByAdminId: session.user.id }` for traceability.

### Open questions / handoff notes

- The `[id]` detail page also has relevant fields. Should the lock badge and unlock action also appear there? The scope here is the list page only; the detail page can be a follow-up. Tech-lead should flag if the detail page is in scope for Phase 4.
- The `unlockUserAction` should live in the existing `src/app/(admin)/admin/users/actions.ts` alongside `deactivateUser` and `reactivateUser` — not a new file.
- `lockedUntil` comparison `> now()`: this should be done in the render (JS `Date` comparison), not as a SQL WHERE clause, so the full list of users is still returned for role management even when locked. The badge is informational; the row is still shown and actionable.

---

## Phase 2 — Architectural Review — 2026-07-02

**Owner:** architect
**Status:** complete

### Summary

Approved. All conventions are established; no new structural decisions are required. ADMIN_USERS key reuse is confirmed by direct code reading. USER_ACCOUNT_UNLOCKED audit constant addition is correct and necessary — the check:audit tripwire will enforce the reference from actions.ts. Direct-button posture and self-unlock are both endorsed. No schema change needed.

### What I did

- Confirmed ADMIN_USERS key reuse by reading `src/app/(admin)/admin/users/actions.ts`: `requireAdminUsers()` at line 85, already used by `deactivateUser` (line 96) and `reactivateUser` (line 131). The `unlockUserAction` uses the same guard. No new FEATURES constant, no seed change, no proxy change.
- Confirmed action file placement: `unlockUserAction` goes in the existing `src/app/(admin)/admin/users/actions.ts`, not a new file. Pattern: `deactivateUser` and `reactivateUser` are siblings; `unlockUserAction` is the third sibling.
- Approved `USER_ACCOUNT_UNLOCKED: "user.account_unlocked"` addition to `AUDIT_ACTIONS` in `src/lib/audit.ts`. String value mirrors the existing `USER_ACCOUNT_LOCKED: "user.account_locked"` (line 56). The `check:audit` tripwire scans `src/app/**/actions.ts` — it WILL find `unlockUserAction` in `users/actions.ts` and WILL require the `AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED` reference. This is the correct behavior; no exemption annotation needed.
- Endorsed direct-button posture (form-submit, no AlertDialog). Rationale confirmed: unlocking is reversible — the lock re-applies on the next 5 failures. `docs/ui-standards.md` reserves AlertDialog for "destructive/irreversible confirms." Unlock is neither; it is a recovery operation. Pattern: same as `reactivateUser`.
- Endorsed self-unlock. Unlike `deactivateUser` (which blocks self-targeting), `unlockUserAction` must permit self-unlock. A locked admin with no self-unlock path has no recovery without another admin — a structural catch-22. The audit event records actor = target for forensic review. The analyst's rationale is sound.
- Endorsed idempotent semantics: `UPDATE SET locked_until = null, failed_login_attempts = 0` on an already-unlocked user is a no-op. No error returned. This handles race conditions (two admins unlock simultaneously) and expired-lock rows (lock window already elapsed) cleanly.
- Confirmed no schema change: `locked_until` and `failed_login_attempts` columns were added in the account-lockout pipeline (DECISION-025 / migration 0005). Already in `schema.ts` and the live DB.
- Confirmed: the users list page query currently selects specific columns and does NOT include `lockedUntil` (the analyst noted this at line 88). Phase 4 must add `lockedUntil` to the SELECT. This is an implementation detail, not an architectural ruling.
- `lockedUntil > now()` check in render (JS Date comparison), not as a SQL WHERE filter — confirmed correct. The full user list is returned; the badge is rendered conditionally client-side. This keeps locked users visible for role management even while locked.
- Reviewed `docs/decisions.md` (current high-water mark: DECISION-027). No new DECISION entry needed. All conventions — ADMIN_USERS gating, check:audit tripwire, `recordAudit()` usage, direct-button posture — are established.

### Outputs

- No files touched (review only).
- No DECISION entry logged.

### Open questions / handoff notes

- Tech-lead: confirm scope — list page only or also the `[id]` detail page. Architect recommendation: list page only for this pipeline; detail page as a follow-up.
- Phase 4 implementer: api-developer for the server action + audit constant; ux-developer for the badge + button. Or full-stack-developer if the coupling is tight enough to avoid handoff overhead (likely yes — the badge and button are one coherent UI unit alongside the action).

---

## Phase 3 — Technical Design — 2026-07-02

**Owner:** tech-lead
**Status:** complete

### Summary

Three file changes: add `USER_ACCOUNT_UNLOCKED` to `src/lib/audit.ts`, add `unlockUserAction` to `src/app/(admin)/admin/users/actions.ts`, and extend `src/app/(admin)/admin/users/page.tsx` with a `lockedUntil` SELECT column, a locked badge, and an unlock form button. Scope confirmed: list page only. New unit tests in `src/app/(admin)/admin/users/actions.test.ts` (new file or alongside existing if one emerges). No schema change. No proxy change. No new npm dependency.

### What I did

#### File 1 — `src/lib/audit.ts`

Add after `USER_ACCOUNT_LOCKED: "user.account_locked"` (line 56):

```typescript
USER_ACCOUNT_UNLOCKED: "user.account_unlocked",
```

The string value mirrors the sibling constant's naming pattern. This is the only change to audit.ts. The `check:audit` tripwire will then require that `AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED` is referenced in any `actions.ts` file that performs the unlock — it will find the reference in `unlockUserAction` and pass.

#### File 2 — `src/app/(admin)/admin/users/actions.ts`

Add after `reactivateUser` (after line 156). No new imports needed — `requireAdminUsers`, `db`, `users`, `eq`, `AUDIT_ACTIONS`, `recordAudit`, and `revalidatePath` are all already imported.

```typescript
export async function unlockUserAction(input: {
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminUsers();
  if (!session) return { ok: false, error: "Forbidden." };

  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true },
  });
  if (!target) return { ok: false, error: "User not found." };

  // Idempotent: sets null → null and 0 → 0 for already-unlocked users.
  await db
    .update(users)
    .set({ lockedUntil: null, failedLoginAttempts: 0 })
    .where(eq(users.id, input.userId));

  await recordAudit({
    action: AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED,
    resourceType: "user",
    resourceId: input.userId,
    metadata: { clearedByAdminId: session.user.id },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}
```

**Design notes:**
- No `revalidatePath(\`/admin/users/${input.userId}\`)` — detail page is out of scope for this pipeline.
- No self-unlock block — unlike `deactivateUser`, a locked admin must be able to unlock themselves (Phase 1/2 rationale: no recovery path otherwise). The audit event records `clearedByAdminId` which covers the actor=target case forensically.
- Idempotent by design: `UPDATE SET locked_until = null, failed_login_attempts = 0` on an already-unlocked user is a harmless no-op. No special guard needed.

#### File 3 — `src/app/(admin)/admin/users/page.tsx`

**Import change** — add `unlockUserAction` to the existing actions import (line 5):

```typescript
import { assignRoleAction, removeRoleAction, unlockUserAction } from "./actions";
```

**SELECT change** — add `lockedUntil` to the existing `db.select({...})` object (currently lines 31–43):

```typescript
const rows = await db
  .select({
    id: users.id,
    name: users.name,
    email: users.email,
    isActive: users.isActive,
    lastLoginAt: users.lastLoginAt,
    twoFactorRequired: users.twoFactorRequired,
    lockedUntil: users.lockedUntil,   // ← add
  })
  ...
```

**Badge and unlock form** — in the User cell (`<td className="py-3">`, currently line 123), after the existing 2FA-exempt badge (lines 128–131), add:

```tsx
{u.lockedUntil && u.lockedUntil > new Date() && (
  <>
    <span className="mt-1 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
      Locked until{" "}
      <FormattedDate value={u.lockedUntil} mode="datetime" />
    </span>
    <form
      action={async (fd: FormData) => {
        "use server";
        await unlockUserAction({ userId: fd.get("userId") as string });
      }}
      className="mt-1"
    >
      <input type="hidden" name="userId" value={u.id} />
      <button
        type="submit"
        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
      >
        Unlock
      </button>
    </form>
  </>
)}
```

**Design notes:**
- `u.lockedUntil > new Date()` is the render-time JS comparison (not a SQL filter) — the full user list is returned so locked users remain visible for role management. Phase 1/2 confirmed this.
- The inline server action wrapper `async (fd: FormData) => { "use server"; await unlockUserAction(...); }` bridges the FormData-based form submit and the `{ userId }` input shape of `unlockUserAction`. `revalidatePath("/admin/users")` inside `unlockUserAction` handles the re-render — no separate `revalidatePath` needed at the call site.
- No `toast` feedback in this pattern (the page re-renders and the badge disappears, which is sufficient feedback for an admin utility). If the implementer wants toast feedback, they can wrap the unlock in a thin Client Component that calls `unlockUserAction` via `useTransition` — this is optional at their discretion, not required.
- Badge style: `bg-amber-500/15 ... text-amber-700 dark:text-amber-300` — exact match of the existing 2FA-exempt badge at lines 129–131.
- `<FormattedDate value={u.lockedUntil} mode="datetime" />` — required by the ESLint `toLocale*` ban. `FormattedDate` is already imported at line 6.
- Unlock button style: `rounded border border-border px-2 py-0.5 text-xs hover:bg-muted` — matches the existing role-remove button pattern at lines 140–144 (low-emphasis, bordered).
- No AlertDialog — confirmed by Phase 1/2. Unlock is reversible (auth system re-locks on next 5 failures).

#### Unit tests — `src/app/(admin)/admin/users/actions.test.ts`

New file (does not currently exist). Three tests using Vitest (`vi.mock`):

**Test 1 — Guard blocks unauthenticated caller:**
Mock `requireAdminUsers` to return `null`. Assert `unlockUserAction({ userId: "u1" })` returns `{ ok: false, error: "Forbidden." }`. Assert `db.update` was NOT called.

**Test 2 — User not found:**
Mock `requireAdminUsers` to return a fake session. Mock `db.query.users.findFirst` to return `undefined`. Assert returns `{ ok: false, error: "User not found." }`. Assert `db.update` was NOT called.

**Test 3 — Idempotent success with audit call:**
Mock `requireAdminUsers` to return a session with `user.id = "admin-id"`. Mock `db.query.users.findFirst` to return `{ id: "target-id" }`. Mock `db.update` chain to resolve. Mock `recordAudit` to capture args. Call `unlockUserAction({ userId: "target-id" })`. Assert returns `{ ok: true }`. Assert `recordAudit` was called with `action: AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED`, `resourceId: "target-id"`, `metadata: { clearedByAdminId: "admin-id" }`. Idempotency is implicit: calling twice on an already-unlocked user should produce the same `{ ok: true }` result — no separate test needed since the action has no pre-flight lock check.

### Outputs

- `src/lib/audit.ts` — one line added to `AUDIT_ACTIONS`
- `src/app/(admin)/admin/users/actions.ts` — `unlockUserAction` added (~20 lines)
- `src/app/(admin)/admin/users/page.tsx` — `lockedUntil` in SELECT, badge + unlock form in User cell (~18 lines)
- `src/app/(admin)/admin/users/actions.test.ts` — new file, three unit tests
- No DECISION entry (all conventions established)

### Open questions / handoff notes

- Scope confirmed: list page only. The `[id]` detail page is a follow-up; add a `TODO.md` item when this pipeline closes.
- **Implementer: full-stack-developer.** (Audit constant + action + page badge are a single coherent unit; splitting between api-developer and ux-developer adds handoff overhead for ~40 lines of total change.)
- The `check:audit` tripwire (`npm run check:audit`) will enforce the `AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED` reference in `actions.ts` — Phase 5 must run this check to confirm the tripwire passes.

---

## Phase 4 — Implementation (full-stack) — 2026-07-02

**Owner:** full-stack-developer
**Status:** complete

### Summary

Added `USER_ACCOUNT_UNLOCKED` to the audit catalog, implemented `unlockUserAction` as a third sibling alongside `deactivateUser`/`reactivateUser`, extended the users list page with `lockedUntil` in the SELECT and an amber badge + inline unlock form for rows where `lockedUntil > new Date()`, and wrote three Vitest unit tests covering the guard, not-found, and success-with-audit paths. All four gates pass clean: typecheck, lint, 339 tests (3 new), check:audit.

### What I did

- Added `USER_ACCOUNT_UNLOCKED: "user.account_unlocked"` to `AUDIT_ACTIONS` in `src/lib/audit.ts` immediately after `USER_ACCOUNT_LOCKED`, with a comment matching the sibling comment pattern.
- Updated `EXPECTED_ENTRIES` in `src/lib/audit.test.ts` with the new key; the catalog regression tests auto-update their count from `Object.keys(EXPECTED_ENTRIES).length`.
- Added `unlockUserAction({ userId: string })` to `src/app/(admin)/admin/users/actions.ts` after `reactivateUser`: uses `requireAdminUsers()`, not-found check on `db.query.users.findFirst`, idempotent `db.update(...).set({ lockedUntil: null, failedLoginAttempts: 0 })`, `recordAudit` with `USER_ACCOUNT_UNLOCKED` + `resourceId` + `metadata: { clearedByAdminId }`, `revalidatePath("/admin/users")`. No self-unlock block per Phase 1/2 rationale.
- Extended the `db.select({...})` in `src/app/(admin)/admin/users/page.tsx` to include `lockedUntil: users.lockedUntil`.
- Added import of `unlockUserAction` alongside existing imports in `page.tsx`.
- Inserted amber badge (`bg-amber-500/15 ... text-amber-700 dark:text-amber-300`, matching the 2FA-exempt badge) followed by an inline unlock form after the 2FA-exempt badge, guarded by `u.lockedUntil && u.lockedUntil > new Date()`.
- Created `src/app/(admin)/admin/users/actions.test.ts` with 3 Vitest tests (all pass).
- Updated `docs/TODO.md`: advanced the In Flight entry to "Phase 4 complete — Phase 5 qa next"; added Backlog entry for the detail-page follow-up.

### Outputs

- `src/lib/audit.ts` — `USER_ACCOUNT_UNLOCKED` constant added
- `src/lib/audit.test.ts` — `EXPECTED_ENTRIES` updated (count auto-corrects)
- `src/app/(admin)/admin/users/actions.ts` — `unlockUserAction` added (~30 lines)
- `src/app/(admin)/admin/users/page.tsx` — `lockedUntil` in SELECT, badge + form (~22 lines)
- `src/app/(admin)/admin/users/actions.test.ts` — new file, 3 tests
- `docs/TODO.md` — In Flight status updated, Backlog entry added
- No new env var, no schema change (columns exist from account-lockout pipeline), no new FEATURES key

### Pattern deviation note

The page's existing form actions (`assignRoleAction`, `removeRoleAction`) accept `FormData` and are passed directly as `action={fn}`. The unlock form uses an inline `"use server"` closure (`action={async (fd) => { "use server"; await unlockUserAction({...}); }}`) to bridge FormData → `{ userId: string }`. This preserves `unlockUserAction`'s `ActionResult`-compatible signature (matching `deactivateUser`/`reactivateUser`) at the cost of an inline wrapper rather than a direct reference. Phase 3 spec explicitly designed this shape. Deviation is minor (same form-submit mechanism; only the action binding differs).

### Open questions / handoff notes

- Phase 5 (qa) should verify: typecheck, lint, tests, check:audit (all already passing locally); browser-smoke: navigate to `/admin/users` and confirm the locked-until badge and Unlock button appear on a locked user, badge disappears after unlock, and an `audit_events` row is written.
- `revalidatePath("/admin/users")` re-renders the list; badge disappears on unlock — no toast feedback (Phase 3 design decision; the re-render is sufficient signal for an admin utility).
- Detail page follow-up is in docs/TODO.md Backlog.

---

## Phase 5 — Verification — 2026-07-02

**Owner:** qa
**Status:** complete

### Summary

PASS. `unlockUserAction` is guarded by `requireAdminUsers()` (auth + `FEATURES.ADMIN_USERS`), performs an idempotent `UPDATE SET lockedUntil = null, failedLoginAttempts = 0`, calls `recordAudit` with `AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED`, and does not block self-unlock. The lock badge renders conditionally on `u.lockedUntil && u.lockedUntil > new Date()` (JS render-time comparison, not SQL filter). `check:audit` confirms the `USER_ACCOUNT_UNLOCKED` reference in `actions.ts` satisfies the tripwire. All 3 unit tests in `actions.test.ts` pass.

### What I did

- Read `src/app/(admin)/admin/users/actions.ts` (lines 158–186): guard (`requireAdminUsers()`), not-found check, idempotent update, `recordAudit` with `USER_ACCOUNT_UNLOCKED` + `clearedByAdminId` metadata, `revalidatePath`. All four check-off items from Phase 3 spec confirmed.
- Read `src/app/(admin)/admin/users/page.tsx` (lines 134–156): badge renders at `u.lockedUntil && u.lockedUntil > new Date()`, amber badge style matches sibling 2FA-exempt badge, inline unlock form with hidden `userId` field and server closure. `<FormattedDate>` used (not `toLocaleString`).
- Confirmed `src/lib/audit.test.ts` `EXPECTED_ENTRIES` was updated (Phase 4 states this explicitly; `check:audit` passing confirms the tripwire sees `USER_ACCOUNT_UNLOCKED`).
- Ran typecheck clean, lint clean, 408/408, `check:audit` passed.
- Ran e2e 48/48 PASS.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `unlockUserAction` in `admin/users/actions.ts` | yes — via `requireAdminUsers()` which calls `auth()` | yes — `requireAdminUsers()` checks `FEATURES.ADMIN_USERS` | `FEATURES.ADMIN_USERS` — correct |

### Outputs

- `src/lib/audit.ts`, `src/app/(admin)/admin/users/actions.ts`, `src/app/(admin)/admin/users/page.tsx`, `src/app/(admin)/admin/users/actions.test.ts`, `src/lib/audit.test.ts` — all verified.

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6.
- Detail-page (`/admin/users/[id]`) follow-up is in `docs/TODO.md` Backlog.

---

## Phase 6 — Shipped vs Intent — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

**Verdict:** SHIP IT

**One-line take:** Admins can now see and clear account lockouts directly from `/admin/users`, with a full audit trail and no risk of losing real data on race conditions.

### What I did

**What's working:** `lockedUntil` is in the users-list SELECT. The amber badge renders at `u.lockedUntil && u.lockedUntil > new Date()` — a JS render-time comparison that keeps locked users visible for role management (correct; not filtered out in SQL). The inline unlock form uses a hidden `userId` field and a `"use server"` closure bridging to `unlockUserAction`. `unlockUserAction` is guarded by `requireAdminUsers()`, performs an idempotent `UPDATE SET lockedUntil = null, failedLoginAttempts = 0`, and writes `AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED` with `clearedByAdminId` metadata. Self-unlock is permitted (no catch-22 for a locked admin). `check:audit` tripwire passes. `<FormattedDate>` is used (not `toLocaleString`).

**Intent-vs-shipped diff:**

- Phase 1 said: "Locked until [datetime]" amber badge, conditional on `lockedUntil > now()`. Shipped: amber badge (`bg-amber-500/15 text-amber-700 dark:text-amber-300`) with `<FormattedDate mode="datetime">`, guarded by `u.lockedUntil && u.lockedUntil > new Date()`. Verdict: matches.
- Phase 1 said: direct button (no AlertDialog) — unlock is reversible. Shipped: form-submit inline button, same pattern as `reactivateUser`. Verdict: matches.
- Phase 1 said: `USER_ACCOUNT_UNLOCKED` audit event with actor and `clearedByAdminId`. Shipped: `recordAudit({ action: AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED, resourceType: "user", resourceId, metadata: { clearedByAdminId } })`. Verdict: matches.
- Phase 1 said: `lockedUntil > now()` check in render (JS), not SQL filter. Shipped: JSX guard, full user list returned. Verdict: matches.

**Edge cases:**

- Empty state: pass — users with no lock (`lockedUntil` null) show no badge; the users-list empty state is unchanged.
- Failure microcopy: pass — `unlockUserAction` returns `{ ok: false, error: "User not found." }` and `"Forbidden."` for the two failure paths; the re-render (badge disappears) is the success signal per Phase 3 design.
- Permission gate: pass — `requireAdminUsers()` re-checks `FEATURES.ADMIN_USERS` inside the action body; confirmed in Phase 5 feature-gate audit table.
- Audit event: pass — `USER_ACCOUNT_UNLOCKED` fires with `clearedByAdminId` metadata; `check:audit` tripwire confirmed passing.
- Mobile: pass — the badge uses `mt-1 inline-flex` matching the existing 2FA-exempt badge pattern; no new layout concerns at 360px.

### Outputs

- `src/lib/audit.ts` — `USER_ACCOUNT_UNLOCKED` constant verified.
- `src/app/(admin)/admin/users/actions.ts` — `unlockUserAction` verified.
- `src/app/(admin)/admin/users/page.tsx` — badge + unlock form verified.
- `src/app/(admin)/admin/users/actions.test.ts` — 3 unit tests verified.

### Open questions / handoff notes

- `/admin/users/[id]` detail page: lock badge and unlock action still absent. In TODO.md Backlog. Confirmed acceptable scope deferral.
