# BUG-2: 2FA pages mutate the fresh-recovery-codes cookie during RSC render — Work Log

> **Slug:** `2026-07-01-2fa-fresh-codes-rsc-cookie`
> **Surface:** mixed ((account)/account/2fa and (admin)/admin/2fa)
> **Permission(s):** none — no permission change
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-07-01 |
| 2 — Architectural review | architect | Skipped | — no new deps, no schema change, one new shared component following the existing server-action pattern, no invariant touched | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-01 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Bug Report (intake, 2026-07-01)

`src/app/(account)/account/2fa/page.tsx:24` calls
`jar.delete(FRESH_RECOVERY_CODES_COOKIE)` inside a Server Component render.
Its twin at `src/app/(admin)/admin/2fa/page.tsx:29` does the same. Next 16
forbids cookie mutations outside server actions and route handlers; in
production the delete silently no-ops, so freshly generated recovery codes
are re-displayed on every page reload instead of exactly once — a security
exposure (recovery codes linger on screen/refresh) as well as a correctness
bug.

**Discovery trail:**
- Flagged in `docs/reviews/2026-07-01-starter-contribution-triage.md` (BUG-2)
  and carried as a tracked follow-up in the Phase 6 close-out of
  `docs/work-log/2026-07-01-post-login-routing-and-e2e.md`.
- huddleup.health fixed the same defect: a small `"use client"`
  `fresh-recovery-codes` component whose `useEffect` fires a
  `clearFreshCodesCookieAction` server action after mount, with enrollment
  state carried via `?enrolled=true` (see
  `huddleup.health/web/src/components/shared/fresh-recovery-codes.tsx` and
  backport kit §B4; `docs/reviews/2026-07-01-sibling-harvest.md` Tier 1
  item 2).

**Candidate fix direction (for tech-lead to confirm):** adopt huddleup's
pattern — render the codes via a client island that clears the cookie through
a server action after first display. Both pages (account + admin twins) must
be fixed together.

**Regression-test requirement (bug-fix variant):** fails before / passes
after. At minimum, assert no `cookies().delete()`/`jar.delete()` occurs in an
RSC render path for these pages; ideally an e2e that reloads the page after
enrollment and asserts the codes are gone.

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Bug confirmed real. Both `(account)/account/2fa/page.tsx` and
`(admin)/admin/2fa/page.tsx` call `jar.delete(FRESH_RECOVERY_CODES_COOKIE)`
inside an `async` Server Component function (`consumeFreshCodesCookie`), which
Next 16 forbids. In production the delete silently no-ops, so the cookie
persists and the recovery codes re-display on every reload instead of exactly
once. The huddleup.health fix pattern directly addresses this and is
appropriate to backport. Both twin pages must be changed together.

### What I did

**Bug confirmed: yes.**

Evidence:
- `(account)/account/2fa/page.tsx` line 24 — `jar.delete(FRESH_RECOVERY_CODES_COOKIE)` called inside `consumeFreshCodesCookie()`, which executes during RSC render.
- `(admin)/admin/2fa/page.tsx` line 32 — identical pattern.
- Both are pure Server Component files with no `"use server"` / `"use client"` boundary; cookie mutation here is not in a server action or route handler and is therefore illegal under Next 16.

**Cookie lifecycle — complete map:**

| Operation | Where | Legal? |
|-----------|-------|--------|
| SET | `(account)/account/2fa/actions.ts` `setFreshRecoveryCodesCookie()` — called by enrollment and regeneration server actions | Yes — server action |
| SET | `(admin)/admin/2fa/actions.ts` `setFreshRecoveryCodesCookie()` — called by admin-side actions | Yes — server action |
| READ | Both pages, `jar.get(FRESH_RECOVERY_CODES_COOKIE)` in RSC render | Yes — reads are allowed in RSC |
| DELETE | Both pages, `jar.delete(FRESH_RECOVERY_CODES_COOKIE)` in RSC render | **No — mutation forbidden in RSC** |

The two cookies are path-scoped separately: account actions use `path: "/account/2fa"` and admin actions use `path: "/admin/2fa"`. They are independent; there is no cross-contamination. No other file reads or mutates this cookie.

**Behavior contract to preserve:**

1. After enrollment or recovery-code regeneration, the user lands on the 2FA management page and sees the fresh codes displayed in the amber "Save these recovery codes" block.
2. On any subsequent reload, the codes must not reappear — the cookie must be consumed on first display.
3. The codes are hashed at rest; the cookie delivery is the only time plaintext is available to the user. The 5-minute `maxAge` is a safety net (natural expiry if the delete fails), not the primary mechanism.
4. The user must be able to copy the codes before navigating away. The component must not hide them prematurely.

**Fix direction assessment:**

The huddleup.health `FreshRecoveryCodes` client component at
`/Users/cshenso/git/huddleup.health/web/src/components/shared/fresh-recovery-codes.tsx`
is a clean, directly applicable pattern:
- Parent RSC reads the cookie (allowed) and passes codes as a prop — no change to the read path.
- A `"use client"` island receives `codes` and `onDisplayed` (a server action reference).
- `useEffect` with an empty dependency array fires `onDisplayed()` after mount — the delete now runs inside a server action, which is legal.
- Fire-and-forget is acceptable: the 5-minute `maxAge` remains the fallback; the codes are already visible when the effect fires.
- The reference component intentionally excludes `onDisplayed` from the `useEffect` dependency array to avoid double-firing under React StrictMode's double-invoke in development. This must be preserved (or the comment must explain the exception to the lint rule).

Each page needs its own `clearFreshCodesCookieAction` server action (or one
shared action that deletes the cookie, noting the path-scoped cookies will only
match from the correct origin page). Simplest approach: each actions file adds
a `clearFreshCodesCookieAction` that mirrors the existing `setFreshRecoveryCodesCookie`
path, or the pages can share a single action that deletes without a path
qualifier (the cookie will be matched by name on the originating path regardless).

### Outputs

- Files read: `src/app/(account)/account/2fa/page.tsx`, `src/app/(admin)/admin/2fa/page.tsx`, `src/app/(account)/account/2fa/actions.ts`, `src/app/(admin)/admin/2fa/actions.ts`, `src/lib/two-factor.ts` (cookie constant), `/Users/cshenso/git/huddleup.health/web/src/components/shared/fresh-recovery-codes.tsx`
- Work-log Phase 1 row updated to Complete / READY FOR DESIGN / 2026-07-01

### Open questions / handoff notes

- **Verdict: READY FOR DESIGN.** Bug is confirmed, fix direction is proven, both affected pages are identified, behavior contract is clear.
- For tech-lead (Phase 3): the path-scoped cookies (`/account/2fa` vs `/admin/2fa`) mean each page's clear action must either omit the `path` qualifier (safest) or match the exact path that was used at set time. Confirm which approach before implementation.
- For tech-lead: decide whether to create a shared `src/components/shared/fresh-recovery-codes.tsx` (mirrors huddleup exactly — a reusable island) or inline the `useEffect` directly in each page's enrolled branch. Given the two-surface requirement and the starter's teaching intent, the shared component is preferred.
- For QA (Phase 5): the regression test should assert that the cookie is absent on a second GET to the 2FA page after enrollment. An e2e test that completes enrollment and then reloads is the strongest form; a Vitest unit test asserting `jar.delete` is never called in an RSC context is weaker but acceptable as a complement.

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

The bug is an illegal cookie mutation inside an RSC render. Both
`(account)/account/2fa/page.tsx` and `(admin)/admin/2fa/page.tsx` define a
`consumeFreshCodesCookie()` helper that calls `jar.delete(…)` during the
server-component render pass. Next 16 forbids cookie mutations outside server
actions and route handlers; in production the delete silently no-ops, so the
fresh recovery codes re-appear on every page reload.

The fix moves the delete out of the render path and into a `"use server"`
action invoked client-side via a `useEffect` after first mount. The RSC
retains only the allowed read (`jar.get(…)`). A new shared `FreshRecoveryCodes`
client island owns the display and the post-display clear.

### Ruling A — Shared component vs inline

Confirmed: create `src/components/shared/fresh-recovery-codes.tsx`.

Rationale: two independent surfaces (account + admin) both need the exact same
component behaviour. The huddleup reference is production-proven and well
commented. Duplicating the `useEffect` + lint-disable into two separate page
files would diverge on the next edit. The starter's teaching intent makes the
shared component the better specimen. File placement in `src/components/shared/`
matches the DECISION-007 precedent (`FormattedDate` lives there for the same
reason: hand-authored, cross-cutting, `"use client"`).

### Ruling B — Clear-action shape and path qualifier

**Two separate `clearFreshCodesCookieAction` exports, one in each `actions.ts`
file, each specifying the matching `path` qualifier.**

Overrule: the analyst recommended deleting without a path qualifier as
"safest". That is incorrect. Browser cookie-jar semantics treat a cookie set
with `Path=/account/2fa` and a `Set-Cookie` deletion sent with `Path=/` (the
default when no path is specified) as two different entries — the path-scoped
cookie is not cleared. The production bug would silently persist.

Correct shape:

```typescript
// in (account)/account/2fa/actions.ts
export async function clearFreshCodesCookieAction() {
  const jar = await cookies();
  jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/account/2fa" });
}

// in (admin)/admin/2fa/actions.ts
export async function clearFreshCodesCookieAction() {
  const jar = await cookies();
  jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/admin/2fa" });
}
```

No shared action. No path parameter on the component. The path concern is an
implementation detail of each surface's action layer; the shared component
stays path-agnostic by accepting `onDisplayed` as a prop.

The `"use server"` directive is already at the top of both `actions.ts` files,
so new exports are legal server actions without any additional boilerplate.

### Ruling C — useEffect dependency array and StrictMode

Adopt the huddleup shape exactly, including the lint-disable comment:

```typescript
useEffect(() => {
  // Fire-and-forget: clear the cookie now that the codes are visible to the
  // user. We do not await or handle errors — if the delete fails the cookie
  // will expire naturally via its maxAge (5 minutes). The codes are already
  // rendered so the user has seen them regardless.
  void onDisplayed();
  // onDisplayed is a Server Action reference; it is stable across renders and
  // must not be included in the dependency array to avoid double-firing on
  // StrictMode's double-invoke in development.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Reasoning: the empty dep array ensures the effect fires once on mount. In
React StrictMode (dev only), the double-invoke causes the action to fire twice.
The second call finds an already-absent cookie and no-ops — this is acceptable.
The 5-minute `maxAge` remains the last-resort fallback. Including `onDisplayed`
in the dep array would produce identical behaviour (the reference is stable) but
would silence the lint rule with false justification. The comment is the honest
explanation of the exemption.

### Component Specification

**`src/components/shared/fresh-recovery-codes.tsx`** — client island

```typescript
"use client";
import { useEffect } from "react";

interface FreshRecoveryCodesProps {
  codes: string[];
  /**
   * Server Action to call immediately after the codes are rendered.
   * Must delete the one-time fresh-codes cookie so the codes do not
   * re-display on subsequent page reloads.
   */
  onDisplayed: () => Promise<void>;
}

export function FreshRecoveryCodes({ codes, onDisplayed }: FreshRecoveryCodesProps) {
  useEffect(() => {
    void onDisplayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
      <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-300">
        Save these recovery codes
      </h2>
      <p className="mt-1 text-xs">
        Each code lets you sign in once if you lose your authenticator.
        We hash codes at rest — this is the only time you&apos;ll see them in plaintext.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="rounded bg-background px-2 py-1">{c}</li>
        ))}
      </ul>
    </div>
  );
}
```

Both pages change from:
```typescript
// RSC (forbidden) — to be removed
jar.delete(FRESH_RECOVERY_CODES_COOKIE);
// …then render inline amber div
```
to:
```typescript
// RSC: read only (allowed)
const raw = jar.get(FRESH_RECOVERY_CODES_COOKIE)?.value ?? null;
const freshCodes = raw ? JSON.parse(raw) : null;

// JSX: delegate display + clear to the client island
{freshCodes && (
  <FreshRecoveryCodes codes={freshCodes} onDisplayed={clearFreshCodesCookieAction} />
)}
```

### File List

| File | Change |
|------|--------|
| `src/components/shared/fresh-recovery-codes.tsx` | **New** — shared client island |
| `src/app/(account)/account/2fa/page.tsx` | Modify — remove `consumeFreshCodesCookie()`, replace inline amber block with `<FreshRecoveryCodes>` |
| `src/app/(admin)/admin/2fa/page.tsx` | Modify — same as above |
| `src/app/(account)/account/2fa/actions.ts` | Modify — add `clearFreshCodesCookieAction` export |
| `src/app/(admin)/admin/2fa/actions.ts` | Modify — add `clearFreshCodesCookieAction` export |
| `src/components/shared/fresh-recovery-codes.test.tsx` | **New** — Vitest test |
| `src/app/(account)/account/2fa/actions.test.ts` | **New** (or extend if exists) — Vitest test for clear action |

### Implementation Order

1. Add `clearFreshCodesCookieAction` to `(account)/account/2fa/actions.ts`
2. Add `clearFreshCodesCookieAction` to `(admin)/admin/2fa/actions.ts`
3. Create `src/components/shared/fresh-recovery-codes.tsx`
4. Update `(account)/account/2fa/page.tsx` — remove `consumeFreshCodesCookie()`, replace inline block
5. Update `(admin)/admin/2fa/page.tsx` — same
6. Add regression tests (see below)
7. Typecheck + build — both must be clean

### Regression Test Strategy

Full enrollment e2e is out of scope: completing a real TOTP challenge is
deliberately excluded from the starter's e2e strategy (the challenge requires a
live TOTP seed to generate a valid token, which cannot be reproduced
deterministically in a Playwright run without seeding the TOTP secret into the
database and knowing the current TOTP window — too invasive for this fix).

**Required tests (ship-blocking):**

1. `src/components/shared/fresh-recovery-codes.test.tsx` — Vitest + jsdom:
   - Renders the amber block with the provided codes
   - Asserts `onDisplayed` is called exactly once after mount (mock the prop)
   - Verifies `onDisplayed` is NOT called on re-render with same props

2. `src/app/(account)/account/2fa/actions.test.ts` (new, or extend) — Vitest:
   - Mocks `cookies()` from `next/headers`
   - Calls `clearFreshCodesCookieAction()`
   - Asserts `jar.delete` was called with `{ name: FRESH_RECOVERY_CODES_COOKIE, path: "/account/2fa" }`
   - Same pattern for `(admin)/admin/2fa/actions.ts` with `path: "/admin/2fa"`

These two suites together prove: (a) the component fires the action on mount,
and (b) the action deletes the cookie with the correct path. The e2e gap is
mitigated by the 5-minute `maxAge` fallback being the only remaining failure
mode — and that is unchanged behaviour.

### Edge Cases

- **JS disabled**: the `maxAge` fallback ensures the cookie expires in 5 minutes.
  The codes remain visible until expiry or until the browser closes. This is
  acceptable and pre-existing behaviour — no regression.
- **User navigates away before effect fires**: the codes have been rendered in
  the browser and the effect fires synchronously after paint. The window between
  render and `useEffect` execution is typically <100 ms. If the user closes the
  tab before the effect runs, the maxAge fallback covers it.
- **Server action network failure**: the `void onDisplayed()` call ignores
  errors. If the action fails, the cookie persists and will be cleared by
  `maxAge` in 5 minutes. Acceptable.
- **Double-fire in StrictMode**: the action is called twice; the second call
  finds no cookie and no-ops. No error is thrown. Acceptable.
- **Admin page renders `consumeFreshCodesCookie()` only inside the `if (existing)` branch**: the admin page already conditionally calls the function.
  After the fix, the read (`jar.get`) should remain inside the same branch;
  the `<FreshRecoveryCodes>` component is only rendered for enrolled users
  anyway, so the prop can be `null`-coalesced or the JSX remains conditional
  as it is today.

### Out of Scope

- Changing the cookie `path` from path-scoped to `"/"` — the current scoping
  is a deliberate security choice (minimise the cookie's browser-visible path)
  and is not part of this fix.
- Changing the cookie `maxAge` — 5 minutes is correct.
- Any changes to the enrollment flow, TOTP verification, or recovery-code
  generation logic.
- A full e2e enrollment test — deferred; requires TOTP seed infrastructure
  not available in the current Playwright setup.

### What I did

- Read both affected page files, both actions files, and the huddleup reference
- Verified that `jar.delete()` without a `path` option sends `Path=/` in the
  `Set-Cookie` deletion response, which does not clear a cookie originally set
  with `path: "/account/2fa"` or `path: "/admin/2fa"` — overruled the analyst's
  path-qualifier recommendation
- Confirmed the StrictMode double-fire is benign
- Confirmed shared component placement in `src/components/shared/` matches
  DECISION-007 precedent
- Named full-stack-developer as implementer

### Outputs

- Work-log Phase 2 row updated: Skipped (with notation)
- Work-log Phase 3 row updated: Complete / 2026-07-01
- No entry added to `docs/decisions.md` — this is a bug fix with a clear,
  singular implementation path; the ruling on path qualifier is documented here
  rather than as a standalone decision entry (it is implementation-level
  guidance, not an architectural decision)

### Open questions / handoff notes for full-stack-developer

- Implement in the order listed above (actions first, then component, then
  pages, then tests)
- The `cookies().delete()` call shape: use `jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/account/2fa" })` for the account action and `path: "/admin/2fa"` for the admin action — do not use the single-string overload, as that defaults to `Path=/` and would silently fail
- Both page files can drop the `consumeFreshCodesCookie()` function entirely;
  the read logic inline (`jar.get(…)?.value`) can stay in the page body
- `FreshRecoveryCodes` test must use `vitest-jsdom` or the project's existing
  jsdom test config — check the Vitest config for the current `environment` setting
- After implementation: `npm run typecheck && npm run build` must be clean;
  `npm run test` must show the new tests passing
- Hand off to qa after Phase 4 is complete

---

## Phase 4 — Implementation (full-stack) — 2026-07-01

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the fix for BUG-2 in both the account and admin 2FA surfaces.
Removed the illegal `jar.delete()` calls from RSC render paths, moved the
cookie deletion into dedicated server actions (`clearFreshCodesCookieAction`),
and extracted the display logic into a new shared `FreshRecoveryCodes` client
island that fires the action via `useEffect` after mount. All five verification
commands pass clean.

### Fail-before / pass-after evidence

**Before evidence (captured by grep before any file edits):**

```
grep -n "jar.delete" src/app/(account)/account/2fa/page.tsx src/app/(admin)/admin/2fa/page.tsx

src/app/(account)/account/2fa/page.tsx:24:  jar.delete(FRESH_RECOVERY_CODES_COOKIE);
src/app/(admin)/admin/2fa/page.tsx:32:  jar.delete(FRESH_RECOVERY_CODES_COOKIE);
```

Both lines were inside `consumeFreshCodesCookie()`, a plain `async` function
called during RSC render — the illegal mutation path.

**After evidence:**

```
grep -n "jar.delete" ... → NOT FOUND (exit 1 — zero matches)
```

The static assertion tests in both `actions.test.ts` files would FAIL against
the pre-fix page files (they assert `pageSource` does not contain `jar.delete`
or `consumeFreshCodesCookie`). They now PASS.

**Component test (new code — no before/after applicable, but validates contract):**
`onDisplayed` is called exactly once after mount; not again on re-render. This
is the mechanism that ensures the server action fires once and the cookie is
cleared.

### What I did

1. Added `clearFreshCodesCookieAction` to `src/app/(account)/account/2fa/actions.ts`
   with `jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/account/2fa" })`.

2. Added `clearFreshCodesCookieAction` to `src/app/(admin)/admin/2fa/actions.ts`
   with `jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/admin/2fa" })`.

3. Created `src/components/shared/fresh-recovery-codes.tsx` — `"use client"` island
   matching the huddleup.health reference and the Phase 3 spec exactly, including
   the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment with the
   explanatory note about StrictMode double-fire.

4. Updated `src/app/(account)/account/2fa/page.tsx`:
   - Removed `consumeFreshCodesCookie()` helper entirely
   - Replaced inline amber block with `<FreshRecoveryCodes codes={freshCodes} onDisplayed={clearFreshCodesCookieAction} />`
   - Cookie read (`jar.get(…)?.value`) retained inline — reads are legal in RSC
   - Cleaned up a pre-existing unused import of `regenerateRecoveryCodes` (that
     function is imported by `RegenerateCodesForm` directly, never by the page)

5. Updated `src/app/(admin)/admin/2fa/page.tsx` — same pattern; the `freshCodes`
   read is inside the `if (existing)` branch where it was before.

6. Created regression tests:
   - `src/components/shared/fresh-recovery-codes.test.tsx` — jsdom; 3 tests
   - `src/app/(account)/account/2fa/actions.test.ts` — node; 5 tests (3 mock-based
     action assertions + 2 static page.tsx content assertions)
   - `src/app/(admin)/admin/2fa/actions.test.ts` — node; 5 tests (same pattern,
     `/admin/2fa` path)

### Outputs

**Files created:**
- `/Users/cshenso/git/claudecode/src/components/shared/fresh-recovery-codes.tsx`
- `/Users/cshenso/git/claudecode/src/components/shared/fresh-recovery-codes.test.tsx`
- `/Users/cshenso/git/claudecode/src/app/(account)/account/2fa/actions.test.ts`
- `/Users/cshenso/git/claudecode/src/app/(admin)/admin/2fa/actions.test.ts`

**Files modified:**
- `/Users/cshenso/git/claudecode/src/app/(account)/account/2fa/actions.ts` — added `clearFreshCodesCookieAction` export
- `/Users/cshenso/git/claudecode/src/app/(admin)/admin/2fa/actions.ts` — added `clearFreshCodesCookieAction` export
- `/Users/cshenso/git/claudecode/src/app/(account)/account/2fa/page.tsx` — removed illegal RSC mutation, replaced with `<FreshRecoveryCodes>`
- `/Users/cshenso/git/claudecode/src/app/(admin)/admin/2fa/page.tsx` — same

**Server actions added:**
- `clearFreshCodesCookieAction()` in `(account)/account/2fa/actions.ts` — no auth gate (deleting a user's own cookie after they've already seen their codes is harmless; the 5-minute maxAge is the fallback anyway)
- `clearFreshCodesCookieAction()` in `(admin)/admin/2fa/actions.ts` — same reasoning

**No schema change, no new env vars, no new FEATURES entry.**

### Verification results

| Command | Result |
|---------|--------|
| `npm run test` | 195 passed (20 test files) — includes 13 new tests |
| `npm run typecheck` | Clean (0 errors) |
| `npm run lint` | Clean (0 warnings) |
| `npm run build` | Clean — all 19 routes compiled |
| `npm run check:audit` | Audit-coverage check passed |

### Open questions / handoff notes

- **e2e deferred**: this fix is not auth-touching per CLAUDE.md's Phase 4 gate
  list (`src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`
  are the gated paths). The 2FA management pages are behind auth but are not in
  the auth critical path. e2e is deferred to a coordinated Phase 5.
- **Two other bug fixes are concurrently in-flight** on this working tree
  (email-verify and admin/users surfaces). QA Phase 5 should run all three
  together once all are complete.
- **Manual smoke to verify in browser**: after enrollment or `regenerateRecoveryCodes`,
  the fresh codes amber block appears on first load, then is absent on reload
  (cookie cleared). Confirm both `/account/2fa` and `/admin/2fa` surfaces.
- **Next agent**: qa (Phase 5 — coordinated after the other two bug fixes land).

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. The illegal RSC cookie mutations are gone from both 2FA pages. Pre-fix HEAD confirmed `jar.delete(FRESH_RECOVERY_CODES_COOKIE)` at account page:24 and admin page:32. Post-fix grep of both page files returns zero matches. Both `clearFreshCodesCookieAction` exports use the exact path qualifiers (`"/account/2fa"` and `"/admin/2fa"`) matching the `setFreshRecoveryCodesCookie` SET paths. The `FreshRecoveryCodes` client island fires `onDisplayed` exactly once on mount (confirmed by jsdom test). The visual codes block is prop-fed from the RSC cookie read in both pages. All 13 new tests pass. The shared e2e suite (20/20) ran against the live dev server with no regressions.

### What I did

- Ran shared verification suite (see Shared Verification Results — run once for all three concurrent fixes).
- Confirmed `git show HEAD:` on both page files contained `jar.delete(FRESH_RECOVERY_CODES_COOKIE)` — account page line 24, admin page line 32 — proving the static assertion tests would have FAILED before the fix.
- Grep of both fixed page files for `jar.delete` returned zero matches (no output, exit 0).
- Read `src/app/(account)/account/2fa/actions.ts:56-67` — `clearFreshCodesCookieAction` calls `jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/account/2fa" })`. The SET path at line 37 is also `"/account/2fa"` — paths match.
- Read `src/app/(admin)/admin/2fa/actions.ts:52-63` — `clearFreshCodesCookieAction` calls `jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/admin/2fa" })`. The SET path at line 33 is also `"/admin/2fa"` — paths match.
- Read `src/components/shared/fresh-recovery-codes.tsx` — `useEffect(() => { void onDisplayed(); }, [])` with the lint-disable comment and the explanatory note about StrictMode double-fire. Matches Phase 3 spec exactly.
- Read `src/components/shared/fresh-recovery-codes.test.tsx` — 3 tests: renders amber block with codes, `onDisplayed` called exactly once after mount (regression for BUG-2), `onDisplayed` not called on re-render. Tests are meaningful (not vacuous): the mount-once test asserts `toHaveBeenCalledTimes(1)` and the re-render test asserts the count remains 1 after a second render with same props.
- Read both page files to confirm visual codes block is prop-fed: RSC reads `jar.get(FRESH_RECOVERY_CODES_COOKIE)?.value` (read allowed), parses to `freshCodes`, then renders `<FreshRecoveryCodes codes={freshCodes} onDisplayed={clearFreshCodesCookieAction} />` — no cookie mutation anywhere in the RSC render path.
- Read `src/app/(account)/account/2fa/actions.test.ts` — 5 tests: 3 mock-based assertions on `jar.delete` call shape (correct name, correct path, combined object), 2 static assertions on page source (no `jar.delete`, no `consumeFreshCodesCookie`). Tests are meaningful and directly guard the BUG-2 regression.
- Verified no stray `console.log`, native browser dialogs, or `toLocale*` calls in any changed file.
- Adversarial cross-check: the 2FA page and action files are touched only by this fix, no overlap with BUG-A or BUG-C files.

### Shared Verification Results (run once for all three fixes)

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 warnings |
| `npm run test` | PASS — 20 test files, 195 tests, 476ms |
| `npm run build` | PASS — 17/17 pages generated |
| `npm run check:audit` | PASS — "Audit-coverage check passed." |
| `npm run test:e2e` | PASS — 20/20 tests, 21.2s (no regressions) |

### Regression Tests Added

- `src/components/shared/fresh-recovery-codes.test.tsx:46` — "calls onDisplayed exactly once after mount — regression for BUG-2: cookie not cleared on first display" — guards against the useEffect dep-array being changed to re-fire on re-render or being removed entirely.
- `src/app/(account)/account/2fa/actions.test.ts:131` — "calls jar.delete with the exact { name, path } object shape — combined regression" — guards against re-introducing the path-less deletion that silently fails.
- `src/app/(account)/account/2fa/actions.test.ts:167` — "page.tsx does not contain jar.delete — illegal RSC cookie mutation removed" — static guard against reintroducing the mutation.
- `src/app/(admin)/admin/2fa/actions.test.ts` — parallel tests for the admin surface with `"/admin/2fa"` path.

### Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/two-factor.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/lib/flags.ts`: 100% (absent from coverage table — no uncovered lines)
- `src/components/shared/fresh-recovery-codes.tsx`: 100% (all branches exercised by the 3-test jsdom suite)

### Outputs

- `docs/work-log/2026-07-01-2fa-fresh-codes-rsc-cookie.md` — Phase 5 section added; Per-Phase Status Phase 5 row updated.

### Open questions / handoff notes

- Next agent: **analyst** (Phase 6 — Shipped vs Intent).
- Manual smoke recommended before merge: after enrollment or `regenerateRecoveryCodes`, confirm the amber codes block appears on first load of `/account/2fa` and `/admin/2fa`, then disappears on reload. The unit tests cover the mechanism; a browser pass confirms the end-to-end timing.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. Both 2FA surfaces (account and admin) have the illegal RSC cookie mutations removed and replaced with a `FreshRecoveryCodes` client island that fires `clearFreshCodesCookieAction` via `useEffect` on mount. The visual codes block is preserved and prop-fed from the RSC read in both pages. Both `clearFreshCodesCookieAction` exports use the path qualifiers that exactly match their respective SET paths. The 5-minute maxAge fallback is intact. The mechanism is sound.

### What I did

- Re-read Phase 1 behavior contract: codes display on first render, cookie consumed on first display, 5-minute maxAge fallback, user can copy before navigating.
- Read `src/app/(account)/account/2fa/page.tsx` in full — confirmed no `jar.delete()` in RSC path; `jar.get(FRESH_RECOVERY_CODES_COOKIE)?.value` read at line 26 (allowed); `<FreshRecoveryCodes codes={freshCodes} onDisplayed={clearFreshCodesCookieAction} />` rendered inside `if (existing)` at lines 62-67.
- Read `src/app/(admin)/admin/2fa/page.tsx` in full — confirmed identical pattern; `jar.get()` read at line 40 inside the `if (existing)` branch; `<FreshRecoveryCodes ... />` at lines 64-69.
- Read `src/app/(account)/account/2fa/actions.ts:62-68` — `jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/account/2fa" })`; path matches SET at line 37 exactly.
- Read `src/app/(admin)/admin/2fa/actions.ts:58-64` — `jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/admin/2fa" })`; path matches SET at line 33 exactly.
- Read `src/components/shared/fresh-recovery-codes.tsx` — `"use client"`, `useEffect(() => { void onDisplayed(); }, [])`, eslint-disable comment with explanatory note, amber div with `codes.map(...)` — matches Phase 3 spec exactly.
- Confirmed account page reads cookie before the `existing` check (line 26) while admin page reads inside `if (existing)` (line 40). This structural difference has no behavioral impact: the cookie only exists after enrollment/regeneration, so `freshCodes` is null for unenrolled users and the component is never rendered.

### Outputs

- `docs/work-log/2026-07-01-2fa-fresh-codes-rsc-cookie.md` — Phase 6 section added; Per-Phase Status Phase 6 row updated to SHIP IT / 2026-07-01.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Codes display on first render after enrollment/regeneration | RSC reads cookie, passes `codes` prop to `FreshRecoveryCodes`; amber block renders on first page load | Matches |
| Cookie consumed on first display | `useEffect` fires `clearFreshCodesCookieAction` after mount; action calls `jar.delete({name, path})` with matching path | Matches |
| 5-minute maxAge safety net remains | `FRESH_COOKIE_TTL_SECONDS = 300` at line 28 (account) and line 24 (admin) — unchanged | Matches |
| Both account and admin surfaces fixed together | Both pages updated; both actions files updated; shared `FreshRecoveryCodes` component serves both | Matches |
| Path-qualified delete to match path-qualified set | Account: `path: "/account/2fa"` matches in both set and delete; Admin: `path: "/admin/2fa"` matches in both | Matches |
| Visual block preserved | Amber div with `Save these recovery codes` heading, `codes.map(...)` list, identical to the pre-fix inline block | Matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state | N/A — codes block only renders when `freshCodes !== null`, which only occurs post-enrollment |
| Failure microcopy | No UI text changes in this fix |
| Permission gate | 2FA pages are already behind session gate; no permission change in this fix |
| Audit event | Enrollment and regeneration actions already write audit events; no change needed |
| Mobile | Component uses responsive grid (`grid-cols-2`) matching the pre-fix inline block |
| JS-disabled fallback | 5-minute maxAge still provides natural expiry; codes visible until expiry or tab close |
| StrictMode double-fire | Second call finds no cookie, no-ops; acceptable as documented in component comment |

### Open questions / handoff notes

- Manual browser smoke before merge remains the recommended step (Phase 5 recommendation): enroll or regenerate on `/account/2fa` and `/admin/2fa`, confirm codes appear once, absent on reload.
