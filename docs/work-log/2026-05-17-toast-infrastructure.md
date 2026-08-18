# Toast / Notification Infrastructure — Work Log

> **Slug:** `2026-05-17-toast-infrastructure`
> **Surface:** mixed (root layout + all authenticated surfaces; no anonymous-visible UI)
> **Permission(s):** not needed — infrastructure with no access gate
> **Flag(s):** not needed — no staged rollout required; entire value is internal to the component layer
> **Estimated complexity:** small
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-17 |
| 2 — Architectural review | architect | Complete | Approved | 2026-05-17 |
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

> Install Sonner, register one `<Toaster>` in the root layout, and migrate the one existing inline status message (`TwoFactorCard`) so every subsequent feature has a consistent, zero-setup feedback channel.

## User Verbs

This feature is infrastructure. The direct user-visible behaviors are narrow:

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin — user detail | sees a slide-in toast after toggling "Require 2FA" instead of the inline green/red banner | on demand |
| Admin — user detail | sees a slide-in toast after force-resetting 2FA enrollment | on demand |
| All authenticated surfaces (future) | sees a consistent toast for any action that calls `toast.success()` / `toast.error()` | per action |

There are no new pages, no new buttons, and no new forms for this feature alone. The user verbs become richer once the three consuming features (account page, forgot-password, rate limiting) ship.

## Flows

**Flow 1 — Admin triggers a 2FA action (migrated from inline status):**
Entry: Admin opens `/admin/users/[id]`, the `TwoFactorCard` is rendered.
Step 1: Admin toggles "Require 2FA" checkbox or clicks "Force-reset 2FA enrollment" and confirms.
Step 2: The server action resolves.
Outcome (success): A green toast slides in from the top-right corner reading the existing success message text. The inline `statusMessage` div is removed from the card.
Outcome (failure): A red toast slides in reading the existing error message text.
Dismissal: The toast auto-dismisses after Sonner's default duration (4 s), or the user clicks the close button.

Failure path: If the server action throws or returns `ok: false`, the `toast.error()` call fires. The user sees the red toast. No full-page error, no silent failure.

**Flow 2 — Future consumer calls `toast.success()` or `toast.error()`:**
Entry: Any client component in the app calls `import { toast } from "sonner"` and fires a toast.
Outcome: Sonner's singleton renders the message in the already-mounted `<Toaster>` without any additional setup by the feature author.
Failure path: If `<Toaster>` is missing from the layout (e.g., someone removes it), toasts are silently swallowed. This is a developer error, not a user-visible failure. The note below flags a mitigation.

## Permissions & Flags

- **Permission(s):** None. The `<Toaster>` is unconditionally mounted. Individual toast call sites inherit whatever permission gate guards the action they follow.
- **Default roles:** not applicable
- **Flag(s):** Not needed. Toast is not a rollout-gated feature; it is plumbing. Hiding it behind a flag would add complexity with no benefit.

## Gaps the Request Didn't Address

- **`next-themes` dependency.** The shadcn wrapper used in `fpcw-directory` (`src/components/ui/sonner.tsx`) calls `useTheme()` from `next-themes` to auto-match the toast theme to the app's color mode. The starter's `package.json` does not include `next-themes`. Two paths: (a) drop the theme-aware wrapper and import `<Toaster>` directly from `"sonner"` with a hardcoded `theme="system"`, or (b) add `next-themes` as a dependency and wire a `ThemeProvider`. The starter has no dark-mode toggle today, so option (a) is lower-drag. Architect should rule on this.

- **Migration scope.** The request says the `TwoFactorCard` inline status is "the seam this feature closes," implying it should be migrated. But the request does not say explicitly to migrate it — only that the toast layer closes the seam. If migration is in scope for Phase 4, the implementer removes `statusMessage` state and replaces the inline div with `toast.success()` / `toast.error()` calls. If migration is deferred to the account-page or forgot-password stories, Phase 4 only installs the library. Confirm with user which is intended.

- **`<Toaster>` placement: root vs admin layout.** `fertilityluna` puts `<Toaster>` in the root layout (one mount, covers everything). `fpcw-directory` puts it in the dashboard layout (scoped). For this starter, root layout is the right call — forthcoming features (account page, forgot-password) are not under `/admin`. However, the root `src/app/layout.tsx` is a Server Component today and `<Toaster>` from Sonner is a client component. The pattern works fine — Next.js renders client leaves inside server trees. The architect should confirm the placement is correct given the server/client boundary invariant.

- **Position and `richColors`.** `fertilityluna` uses `position="top-right" richColors closeButton`. `fpcw-directory` uses the same. The starter has no strong opinion. This is a one-liner decision the implementer can make, but the tech-lead should document it so forks don't have to re-discover it.

- **Empty state.** Not applicable — there is no "no toasts" UI. Sonner renders nothing until a toast is triggered.

- **Mobile.** Sonner is responsive by default at 360px. No layout work required, but QA should verify the toast doesn't overlap the admin sidebar at narrow widths on the admin pages.

- **2FA gate.** `<Toaster>` in the root layout is always mounted regardless of auth state. That's correct — it is pure presentation with no data access. No concern here.

- **Audit events.** Not applicable — the library registration itself is not security-sensitive. The actions that call `toast.success/error()` (e.g., force-resetting 2FA) already write audit events. No new audit work is required for this feature.

## Out of Scope (confirm with user)

- Adding a `<ThemeProvider>` from `next-themes`. The starter has no dark-mode toggle; adding one here would scope-creep this feature. Recommend deferring unless the architect decides the shadcn wrapper requires it.
- Migrating other feedback patterns beyond `TwoFactorCard` (e.g., if the flag-toggle page or user-deactivation flows have inline feedback). Only `TwoFactorCard` was cited as the seam.
- A `useToast()` hook or a project-local wrapper re-export. The sibling pattern is a direct `import { toast } from "sonner"` — no wrapper needed.

## Open Questions

1. **Migration in scope?** Should Phase 4 migrate the `TwoFactorCard` inline status message to `toast()` calls, or is that migration deferred to the consuming features?
2. **Theme-aware wrapper or direct import?** Use the `next-themes`-dependent shadcn wrapper (adds a dependency) or import `<Toaster>` directly from `"sonner"` with `theme="system"` (no new dep)?

---

### Summary

Install Sonner (^2.0.7, matching both siblings), register `<Toaster>` once in `src/app/layout.tsx`, and optionally migrate the `TwoFactorCard` inline status pattern to toast calls. No schema changes, no permissions, no flags. The feature is pure client-side plumbing; its value is realized by the three v0.3 features that follow.

Two notes that must be resolved in Phase 2/3: (a) whether `next-themes` is added, and (b) whether the `TwoFactorCard` migration is in scope for this story or deferred.

### What I did

- Read `src/app/layout.tsx` and `src/app/(admin)/admin/layout.tsx` to understand the existing layout tree.
- Read `src/app/(admin)/admin/users/[id]/two-factor-card.tsx` to document the existing inline `statusMessage` pattern.
- Read `src/lib/permissions.ts` (no new keys needed) and `package.json` (confirmed `sonner` and `next-themes` are absent).
- Read both sibling implementations: `fpcw-directory` uses a shadcn wrapper + `next-themes`, `fertilityluna` imports `<Toaster>` from `"sonner"` directly. Both use `^2.0.7`.
- Ran four-pass review (user verbs, flow audit, permissions/flags, gaps).

### Outputs

- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-17-toast-infrastructure.md` — this file

### Open questions / handoff notes

- **Phase 2 (architect):** Rule on `<Toaster>` placement (root layout confirmed by this review; please affirm or redirect) and on whether `next-themes` must be added or the direct-import path is acceptable.
- **Phase 3 (tech-lead):** Confirm migration scope for `TwoFactorCard`. Document the chosen `position` and `richColors` values so forks have a reference.
- **Phase 5 (qa):** Verify toasts render correctly at 360px width on the admin pages — the admin shell uses a fixed 220px sidebar that could clip a top-right toast at very narrow widths.

---

# Phase 2 — Architectural Review — 2026-05-17

**Owner:** architect
**Status:** complete

## Verdict

**Approved.**

No structural objections. The locked decisions are sound. Three invariant call-outs for tech-lead to carry forward.

## Placement

- **`<Toaster>` mounts in `src/app/layout.tsx` (root layout).** Confirmed correct. The root layout is the only placement that covers all three future consumers (admin shell, account page, forgot-password). Scoping to `src/app/(admin)/admin/layout.tsx` would require a second mount for non-admin surfaces and is wrong.
- **Server vs Client split:** `src/app/layout.tsx` is today a Server Component with no `'use client'` directive, and it must stay that way — it sets `<html lang="en">` and exports `metadata`. `<Toaster>` from Sonner is a client component, but Next.js App Router permits client-component leaves inside a server-component tree without any special handling. The implementer adds `<Toaster>` as a direct child of `<body>` in the existing server layout. No `'use client'` is added to `layout.tsx` itself. This is the standard Next.js interleaving pattern; no invariant is broken.
- **`TwoFactorCard` migration:** Already has `'use client'` at the top. The `statusMessage` state removal and replacement with `toast()` calls is purely within the existing client boundary. No server/client split change needed.

## Dependencies

- **Sonner `^2.0.7` — approved.** One new runtime dep. ~3 kB gzipped (within the "earns its keep" bar for an admin app). MIT licensed. Actively maintained. Does not touch the Edge runtime (Sonner is UI only; `src/proxy.ts` is unaffected). Replaces hand-rolled `useState` feedback patterns going forward.
- **`next-themes` — not added (locked decision).** Direct `import { toast } from "sonner"` with `<Toaster theme="system" richColors />` requires no additional dep. Confirmed correct for the starter's current single-theme state.

## Invariants Touched

- **Server / Client Boundary.** Respected. `<Toaster>` is a client leaf inside the server root layout. `layout.tsx` acquires no `'use client'` marker.
- **No native browser dialogs.** This feature is the positive implementation of that invariant — `toast.success()` / `toast.error()` is the designated replacement for any `alert()` pattern. Callers must use this, not `alert()`. Tech-lead should document this in the design doc.
- **Server actions cannot call `toast()` directly.** `toast()` is a browser-side imperative call. Server actions in this starter return `{ ok: true } | { ok: false; error: string }`. The client component receives that result and calls `toast()`. This split is already how `TwoFactorCard` works today; the migration preserves the contract exactly. Tech-lead must document this pattern so future implementers don't try to fire toasts inside `'use server'` functions.

## Notes for Phase 3

1. `<Toaster>` goes in `<body>` in `src/app/layout.tsx`. Props: `theme="system" richColors` at minimum; add `closeButton` for consistency with siblings. Do not add `'use client'` to `layout.tsx`.
2. Document the server-action return contract: actions return `{ ok, error? }`; the client component reads the result and calls `toast.success()` or `toast.error()`. This is the canonical pattern for all future action-driven toasts in the starter.
3. `TwoFactorCard` migration is in scope for Phase 4: remove the `statusMessage` useState, remove the conditional div at line 117–127 of `two-factor-card.tsx`, replace with `toast.success()` / `toast.error()` calls in the two `startTransition` callbacks. The existing message strings are preserved verbatim.
4. No new `FEATURES` key, no new `feature_flags` row, no schema change, no audit events from this feature itself.

---

# Phase 3 — Technical Design — 2026-05-17

**Owner:** tech-lead
**Status:** complete

## Summary

Install Sonner ^2.0.7, mount one `<Toaster theme="system" richColors closeButton />` in the server-component root layout, and migrate `TwoFactorCard` from its hand-rolled `statusMessage` useState to `toast.success()` / `toast.error()` calls. No schema, no permissions, no flags. The value of this PR is threefold: it removes a brittle inline feedback pattern, establishes a zero-setup toast channel for every subsequent feature author, and documents the server-action → client-toast contract so the account-page, forgot-password, and rate-limiting stories don't have to re-discover it.

## Permissions & Flags

- Permission key(s): not needed
- Default role bindings: not applicable
- Feature flag(s): not needed

## API Contract

No new route handlers or server actions. The existing server actions already return `{ ok: true } | { ok: false; error: string }`. This PR formalizes that shape as the canonical contract for the starter:

```typescript
// Canonical server-action return type — all actions in this starter
// that are called from a client component MUST return this shape.
// The client component reads the result and calls toast(), never the action itself.
type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
```

Rules for implementers:
- Server actions `throw` only for truly unexpected errors (DB unavailable, etc.). Expected failures — bad input, permission denied, conflict — are returned as `{ ok: false, error: "human-readable message" }`.
- The client component is always the one that calls `toast.success()` or `toast.error()`. `toast()` must never appear inside a `'use server'` function; it is a browser-only imperative.
- The `error` string is end-user-visible. Keep it short and non-technical.

The two actions already used by `TwoFactorCard` conform to this shape and need no changes:
- `setTwoFactorRequired({ userId, required })` → `ActionResult`
- `forceResetTwoFactor({ userId })` → `ActionResult`

## Data Model

No schema changes required.

## Component / Page Plan

### Files to create

None.

### Files to modify

| File | Change |
|------|--------|
| `package.json` | Add `"sonner": "^2.0.7"` to `dependencies` |
| `src/app/layout.tsx` | Import `Toaster` from `"sonner"`; add `<Toaster>` as the last child of `<body>`; add pattern comment |
| `src/app/(admin)/admin/users/[id]/two-factor-card.tsx` | Remove `statusMessage` state; remove inline status div (lines 117–127); add `import { toast } from "sonner"`; replace `setStatusMessage` calls with `toast.success()` / `toast.error()` |

### Exact diff — `src/app/layout.tsx`

Add after the existing `import "./globals.css"`:
```typescript
import { Toaster } from "sonner";
```

Replace `<body className="min-h-screen antialiased">{children}</body>` with:
```tsx
<body className="min-h-screen antialiased">
  {children}
  {/*
   * pattern: server-action → client toast
   * Server actions return { ok, error? }. Client components read the result
   * and call toast.success() / toast.error() here in the Toaster singleton.
   * Never call toast() inside a 'use server' function — it is browser-only.
   * Do not add 'use client' to this file; <Toaster> is a client leaf in a
   * server tree, which Next.js App Router supports without any special handling.
   */}
  <Toaster theme="system" richColors closeButton position="top-right" />
</body>
```

No `'use client'` directive is added to `layout.tsx`. The `metadata` export and the `<html lang="en">` root must remain in a server component; `<Toaster>` as a client leaf inside that server tree is the standard Next.js interleaving pattern.

### Exact diff — `two-factor-card.tsx`

**Remove from imports (line 3):** `useState` (no longer needed once `statusMessage` is gone; `useTransition` stays)

**Remove state declaration (lines 25–28):**
```typescript
const [statusMessage, setStatusMessage] = useState<{
  type: "success" | "error";
  text: string;
} | null>(null);
```

**Remove inline status div (lines 117–127):**
```tsx
{statusMessage && (
  <div
    className={`mt-4 rounded-md px-3 py-2 text-sm ${
      statusMessage.type === "success"
        ? "bg-green-500/10 text-green-700 dark:text-green-300"
        : "bg-red-500/10 text-red-700 dark:text-red-300"
    }`}
  >
    {statusMessage.text}
  </div>
)}
```

**Remove all `setStatusMessage(null)` calls** (lines 32 and 53).

**Replace `setStatusMessage({ type: "success", text: ... })` and `setStatusMessage({ type: "error", text: ... })`** with `toast.success(...)` and `toast.error(...)` respectively. Message strings are preserved verbatim.

**Add import:**
```typescript
import { toast } from "sonner";
```

The `toast()` calls live inside the `startTransition` callbacks. This is correct — `toast()` is not a state update and does not need to be outside `startTransition`. Sonner's internal state is managed by Sonner, not React's transition mechanism. No change to the `useTransition` usage is needed.

## Implementation Order

1. `npm install sonner@^2.0.7`
2. Add `<Toaster>` to `src/app/layout.tsx` with pattern comment
3. Migrate `TwoFactorCard` — remove `statusMessage` state and inline div, wire `toast()`
4. `npm run typecheck` — verify no type errors introduced
5. `npm run build` — verify production build passes
6. Release notes entry (tech-lead writes after Phase 5 PASS)

## Edge Cases & Risks

- **`toast()` inside `startTransition`:** Confirmed safe. `toast()` is an imperative call to Sonner's internal store, not a React state update. It does not need to be outside the transition callback. The existing `useTransition` wiring in `TwoFactorCard` is unchanged.
- **`richColors` and the starter's neutral palette:** `richColors` applies Sonner's built-in semantic colors (green for success, red for error). These are distinct from the app's Tailwind theme tokens and will look slightly richer than the rest of the UI. This is acceptable — toast feedback is intentionally visually distinct. If a fork wants to match brand colors exactly, they can remove `richColors` and rely on CSS variables.
- **`<Toaster>` removed by future refactor:** If someone removes `<Toaster>` from `layout.tsx`, all `toast()` calls silently no-op — no error thrown, no user feedback shown. The pattern comment in `layout.tsx` is the only mitigation; a future integration test could verify the element mounts, but that is out of scope here.
- **Multiple `<Toaster>` mounts:** If a page or layout accidentally mounts a second `<Toaster>`, Sonner deduplicates by default in v2. Not a concern for this PR, but worth knowing if the admin layout is ever restructured.
- **`useState` removal:** After removing `statusMessage`, the only remaining state in `TwoFactorCard` is `resetDialogOpen`. Confirm the import line drops `useState` but keeps `useTransition`.

## Implementer

**full-stack-developer** — the entire change spans `package.json`, one root layout file, and one client component. There is no schema work and no new route handler. Splitting across agents would add more overhead than it saves.

---

### Open questions / handoff notes

- Hand off to **full-stack-developer** for Phase 4.
- The `ActionResult<T>` type defined in this design doc should be placed in `src/types/` or inlined as a JSDoc comment in a shared actions file — implementer's call; either is fine for a starter. A dedicated `src/types/actions.ts` is the cleaner option and avoids repeating the shape in every actions file.
- QA (Phase 5): verify the toast renders at 360px on the admin shell without being clipped by the 220px sidebar. `position="top-right"` on a 360px viewport puts the toast at the right edge — Sonner adds `margin-right` by default which should keep it clear, but confirm visually.

---

# Phase 4 — Implementation (full-stack) — 2026-05-17

**Owner:** full-stack-developer
**Status:** complete

## Summary

Installed Sonner ^2.0.7, mounted `<Toaster theme="system" richColors closeButton position="top-right" />` as a client leaf in the server-component root layout, created the canonical `ActionResult<T>` type in `src/types/actions.ts`, and migrated `TwoFactorCard` from its hand-rolled `statusMessage` useState to `toast.success()` / `toast.error()` calls. All gate checks pass.

## What I did

- Ran `npm install sonner@^2.0.7` — 1 new runtime dep added.
- Created `src/types/actions.ts` with the `ActionResult<T>` type and a pattern comment documenting the server-action → client-toast contract.
- Modified `src/app/layout.tsx`: added `import { Toaster } from "sonner"` and `<Toaster theme="system" richColors closeButton position="top-right" />` as the last child of `<body>`. Added the pattern comment from the tech-lead's design. File stays a server component — no `'use client'` added.
- Modified `src/app/(admin)/admin/users/[id]/two-factor-card.tsx`: added `import { toast } from "sonner"`, removed the `statusMessage` useState declaration, removed all `setStatusMessage()` calls, removed the inline status div (lines 117–127 of original), replaced with `toast.success()` / `toast.error()` in both transition callbacks. `useState` import retained (still used by `resetDialogOpen`).

## Outputs

- `src/types/actions.ts` — created; defines `ActionResult<T>` with JSDoc pattern comment
- `src/app/layout.tsx` — modified; added Toaster import and mount with pattern comment
- `src/app/(admin)/admin/users/[id]/two-factor-card.tsx` — modified; statusMessage state removed, toast wired
- `package.json` + `package-lock.json` — updated by npm install (sonner ^2.0.7 added)

## Schema Changes

- None
- No `db:push` or `db:generate` required

## Audit Events

- None — the library registration itself is not security-sensitive; existing actions already write audit events

## Gate Results

- `npm run typecheck`: PASS (clean, no output)
- `npm run build`: PASS (all 11 routes compiled)
- `npm run test`: PASS (19/19 unit tests)
- `npm run test:e2e`: PASS (3/3 E2E tests including admin-login spec)

## Open questions / handoff notes

- QA (Phase 5): verify the toast renders correctly at 360px width on admin pages — the 220px sidebar + `position="top-right"` may clip at very narrow widths. Sonner adds `margin-right` by default which should keep it clear; confirm visually.
- QA: verify toast appears after toggling "Require 2FA" and after clicking "Force-reset 2FA enrollment" — the inline status div is gone, so toast is the only feedback channel now.
- The `ActionResult<T>` type in `src/types/actions.ts` is new but not yet adopted by the existing action files (out of scope per tech-lead). Future implementers should import it from there rather than redeclaring inline.

---

# Phase 5 — Verification (qa) — 2026-05-17

**Owner:** qa
**Status:** complete

## Summary

All four verification gates pass. Typecheck clean, 24/24 unit tests pass (up from 19 — one new regression test file added), 3/3 e2e pass. `<Toaster>` is mounted exactly once in the root layout, the root layout is still a server component, `statusMessage` state is fully removed from `TwoFactorCard`, and both toast paths (`toast.success` / `toast.error`) are present in both action callbacks. No native dialogs, no `console.log`, no unused imports. Verdict: **PASS**.

### What I did

- Re-ran `npm run typecheck` independently — clean, no output.
- Re-ran `npm run test` (19 pre-existing unit tests) — all passed.
- Re-ran `npm run test:e2e` (3 Playwright specs) — all passed; admin-login spec covers TwoFactorCard render path.
- Grepped `src/app/**/layout.tsx` for `<Toaster` — exactly one mount, in `src/app/layout.tsx` line 28. No duplicates.
- Confirmed `src/app/layout.tsx` has no `'use client'` directive — server component boundary intact.
- Confirmed `statusMessage` and `setStatusMessage` do not appear in `two-factor-card.tsx`.
- Confirmed `useState` is retained (used by `resetDialogOpen` at line 26).
- Confirmed `toast.success` and `toast.error` are both called in `handleToggleRequired` (lines 35, 41) and in `handleForceReset` (lines 51, 55).
- Confirmed no `console.log`, `alert()`, `confirm()`, or `prompt()` in any of the three touched files.
- Created `src/types/actions.test.ts` — 5 type-level regression tests for the `ActionResult<T>` discriminated union.

## Type Check

`npm run typecheck`: PASS (clean, no output)

## Unit Tests

Total: 24 | Passed: 24 | Failed: 0 | Duration: 0.2s
Failures: none

## End-to-End Tests

Total: 3 | Passed: 3 | Failed: 0 | Duration: 4.2s
Failures: none

## Regression Tests Added

- `ActionResult<T> — success branch has ok: true and an optional data field` — `src/types/actions.test.ts:13` — guards against: removal of the success arm's `data` field
- `ActionResult<T> — success branch works without the optional data field (void default)` — `src/types/actions.test.ts:22` — guards against: making `data` required on the success arm
- `ActionResult<T> — failure branch has ok: false and a required error string` — `src/types/actions.test.ts:30` — guards against: making `error` optional on the failure arm
- `ActionResult<T> — type-narrows correctly in a discriminated-union if/else — regression for broken discriminant` — `src/types/actions.test.ts:38` — guards against: changing the discriminant away from boolean `ok`, which breaks every client-component narrowing in the app
- `ActionResult<T> — failure branch does not allow data field — guards against union collapse` — `src/types/actions.test.ts:63` — guards against: collapsing the two union arms into a single object type with optional fields

## Coverage on Critical Modules

Coverage tool does not include `src/lib/` in its `include` list (vitest.config.ts has no `coverage.include`), so v8 only reports on files imported by the test files themselves. The three critical modules are exercised by existing tests:

- `src/lib/permissions.ts`: covered by `src/lib/permissions.test.ts` (7 tests — empty list, missing key, present key, FEATURE_CATALOG integrity)
- `src/lib/two-factor.ts`: no dedicated test file — pre-existing gap, not introduced by this feature
- `src/lib/flags.ts`: no dedicated test file — pre-existing gap, not introduced by this feature

## Verdict

PASS

## Outputs

- `src/types/actions.test.ts` — created; 5 regression tests for the `ActionResult<T>` discriminated union

## Open questions / handoff notes

- Next agent: **analyst** for Phase 6.
- Pre-existing: `src/lib/two-factor.ts` and `src/lib/flags.ts` have no unit tests. Both are DB-dependent or time-dependent; mocking `db` and `otplib` would be the approach. Flag for the next 7-day coverage review.
- The 360px / sidebar overlap note from Phase 1 and Phase 3 was not verified with a Playwright assertion (toast e2e assertions are flaky). Manual smoke recommended: open `/admin/users/[id]` at 360px viewport, toggle the "Require 2FA" checkbox, confirm the top-right toast does not clip behind the 220px sidebar.

---

# Phase 6 — Shipped vs Intent — 2026-05-17

**Owner:** analyst
**Status:** complete

### Summary

Sonner is installed, `<Toaster>` is mounted exactly once as a client leaf in the server-component root layout, `TwoFactorCard` has had its `statusMessage` state fully removed, and both action callbacks fire `toast.success()` / `toast.error()` with the original message strings verbatim. A canonical `ActionResult<T>` type lands in `src/types/actions.ts` with a pattern comment that will govern every future action-driven toast in the app. Every item from Phase 1 was addressed. QA added five regression tests guarding the discriminated union. The one unverified item — 360px sidebar overlap — is a manual smoke check; no Playwright assertion covers it.

## VERDICT

SHIP IT

## ONE-LINE TAKE

> Sonner lands correctly as a singleton client leaf in the server root layout, the TwoFactorCard inline status pattern is fully replaced with toast calls, and the canonical ActionResult contract is documented and tested.

## What's Working

- `<Toaster theme="system" richColors closeButton position="top-right" />` is the last child of `<body>` in `src/app/layout.tsx`. The file has no `'use client'` directive, the `metadata` export and `<html lang="en">` root are intact. The server/client boundary invariant is clean.
- `TwoFactorCard` imports `toast` from `"sonner"` directly (no wrapper), calls `toast.success()` in the success branch and `toast.error(result.error)` in the failure branch for both actions. The `statusMessage` state, all `setStatusMessage` calls, and the conditional inline div are gone. `useState` stays because `resetDialogOpen` still uses it.
- `src/types/actions.ts` defines `ActionResult<T>` as a discriminated union with a JSDoc comment that explains the server-action → client-toast contract. The comment is specific enough that a future implementer reading it knows exactly where `toast()` must not go.
- Five type-level regression tests in `src/types/actions.test.ts` guard the discriminant, the optional `data` field, the required `error` string, and union collapse. These would catch the most likely refactor accidents.

## Intent-vs-Shipped Diff

- Phase 1 said: `<Toaster>` registered once in the root layout, no `'use client'` on `layout.tsx`. Shipped: exactly that. Verdict: **matches**.
- Phase 1 said: direct `import { toast } from "sonner"` from client components, no wrapper. Shipped: exactly that. Verdict: **matches**.
- Phase 1 said: `TwoFactorCard` inline `statusMessage` replaced with toast calls in this PR, message strings preserved verbatim. Shipped: removed state, removed div, replaced with `toast.success()` / `toast.error()`. Message strings are verbatim. Verdict: **matches**.
- Phase 1 said: no `next-themes`, no dark-mode toggle. Shipped: `next-themes` is not in `package.json`, `ThemeProvider` is not in the layout tree. Verdict: **matches**.
- Phase 1 noted: a `src/types/actions.ts` file was tech-lead's call, not Phase 1's requirement. Shipped: the file exists and is documented and tested. Verdict: **acceptable drift — additive only, no intent violated**.
- Phase 1 noted: `closeButton` and `richColors` were undecided; architect and tech-lead locked them in. Shipped: both props present. Verdict: **matches architect/tech-lead decision, no regression from Phase 1 intent**.

## Edge Cases

- Empty state: not applicable — Sonner renders nothing until a toast fires; no "no toasts" UI to audit.
- Failure microcopy: pass — `toast.error(result.error)` surfaces the server action's human-readable error string directly. The contract in `src/types/actions.ts` requires the `error` field to be "short and non-technical."
- Permission gate: not applicable — `<Toaster>` is unconditionally mounted; no access gate on the infrastructure itself. The actions it surfaces remain behind the existing admin permission gate.
- Audit event: not applicable — the library registration is not security-sensitive; the underlying 2FA actions already write audit events, unchanged.
- Mobile (360px): not verified by automated test — QA noted Playwright toast assertions are flaky and deferred to manual smoke. The implementation uses Sonner's default `margin-right` behavior which should prevent clipping, but this has not been visually confirmed. Tracked below as a follow-up.

## Follow-Ups

- Manual smoke: open `/admin/users/[id]` at 360px viewport, toggle "Require 2FA," confirm the top-right toast is fully visible and not clipped by the 220px admin sidebar. If it clips, switch `position` to `"bottom-center"` for narrow viewports or add a Sonner `offset` prop. No new work-log entry needed — this is a one-line config change if it fails.

### What I did

- Read `src/types/actions.ts`, `src/app/layout.tsx`, and `src/app/(admin)/admin/users/[id]/two-factor-card.tsx` against the Phase 1 description, the two locked decisions, and the Phase 2/3 design.
- Verified the server/client boundary invariant: `layout.tsx` has no `'use client'`, `<Toaster>` is a client leaf.
- Verified `statusMessage` state is fully removed from `TwoFactorCard`.
- Verified both toast paths are wired and that `toast` is imported directly from `"sonner"` with no wrapper.
- Verified `ActionResult<T>` shape and pattern comment match the tech-lead's design.
- Checked QA's regression-test descriptions against the union shape in `actions.ts`.
- Confirmed `next-themes` is absent per the locked decision.

### Outputs

- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-17-toast-infrastructure.md` — Phase 6 section added; per-phase status row updated to Complete / SHIP IT / 2026-05-17.

### Open questions / handoff notes

- One manual smoke check remains: 360px viewport toast visibility on `/admin/users/[id]`. Low risk; Sonner's default margin behavior should cover it. If it fails, `position="bottom-center"` or a numeric `offset` prop is the fix.
