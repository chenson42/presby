# Timezone-Safe Dates — Work Log

> **Slug:** `2026-05-18-timezone-safe-dates`
> **Surface:** mixed (admin + account)
> **Permission(s):** none — infrastructure / bug fix
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (one real user-facing bug + preventive infrastructure)

## Context

User encountered the classic SSR/client-timezone mismatch bug in a sibling project (`../westervillelions`). The starter has the same latent bug in **five** places where components call `Date.prototype.toLocale*()` directly (Phase 1 caught the fifth):

- `src/app/(admin)/admin/users/page.tsx:151` — server component, `lastLoginAt.toLocaleString()`
- `src/app/(account)/account/2fa/page.tsx:58, 60` — server component, `enrolledAt` / `lastUsedAt`
- `src/app/(admin)/admin/2fa/page.tsx:61, 63` — server component, same fields
- `src/app/(admin)/admin/users/[id]/page.tsx:67` — server component, `createdAt.toLocaleDateString()`
- `src/app/(admin)/admin/users/[id]/two-factor-card.tsx:92` — client component, hydration mismatch path

On Vercel that means timestamps SSR-render in UTC and either stay UTC (server components — wrong for the viewing user) or trigger React hydration warnings (client components).

## Goal

1. Ship a single client primitive `<FormattedDate value={...} />` so dates always format in the *viewer's* timezone, with the ISO string as the SSR fallback inside a `<time>` element.
2. Replace all five offending call sites.
3. Add an ESLint rule banning `toLocale{,Date,Time}String()` outside the primitive's file.
4. Record a new Key Invariant in `CLAUDE.md` and a one-liner in the `ux-developer` agent so this pattern doesn't regrow.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-18 |
| 2 — Architectural review | architect | Complete | Approved | 2026-05-18 |
| 3 — Technical design | tech-lead | Complete | Complete | 2026-05-18 |
| 4 — Implementation | ux-developer | Complete | Complete | 2026-05-18 |
| 5 — Verification | qa | Complete | PASS | 2026-05-18 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-05-18 |

---

## Phase 1 — Functional Refinement — 2026-05-18

**Owner:** analyst
**Status:** complete

### Summary

The bug is real and confirmed at all call sites. Five server components (not four — see gap below) call `toLocale*()` directly; on Vercel's UTC SSR environment, every viewer sees UTC timestamps regardless of their actual timezone. The `two-factor-card.tsx` client component additionally produces a React hydration mismatch when the client TZ differs from UTC. The proposed fix (a `<FormattedDate>` primitive + ESLint guard + CLAUDE.md invariant) is the right scope for a bug-fix-variant run.

**Verdict:** READY WITH NOTES

**One-line take:** Five SSR call sites render timestamps in server TZ (UTC on Vercel); one of them also triggers a hydration mismatch on the client.

### What I did

**Bug confirmed — five call sites, not four.** The work-log lists four; a grep finds a fifth:

- `src/app/(admin)/admin/users/page.tsx:151` — server component, `lastLoginAt.toLocaleString()`
- `src/app/(account)/account/2fa/page.tsx:58,60` — server component, `enrolledAt` / `lastUsedAt`
- `src/app/(admin)/admin/2fa/page.tsx:61,63` — server component, same fields
- `src/app/(admin)/admin/users/[id]/two-factor-card.tsx:92` — client component, hydration mismatch risk
- `src/app/(admin)/admin/users/[id]/page.tsx:67` — **missed in the work-log context**, server component, `createdAt.toLocaleDateString()`

**User verbs confirmed:** No user initiates these flows specifically to see timestamps — dates appear as incidental information on:

- Admin user list (authenticated admin) — last login column
- Admin user detail (authenticated admin) — account created date
- Admin 2FA page (authenticated admin) — enrolled on / last used
- Account 2FA page (authenticated member) — enrolled on / last used

None of these surfaces have a user verb that changes; the fix is transparent — the same text appears, just in the viewer's local TZ.

**Adversarial pass (brief):** No user-supplied input feeds into the date rendering. The `<FormattedDate>` primitive accepts a value prop from server data only. No redirect parameters, no enumeration risk, no self-targeting surface.

**Permissions and flags:** None needed. This is infrastructure. All five surfaces are already behind existing permission gates (`admin.dashboard` or authenticated session). No new flag.

**Audit events:** Not applicable. No security-sensitive mutation.

### Outputs

- No files created in Phase 1 (analysis only)
- Gap documented: fifth call site at `src/app/(admin)/admin/users/[id]/page.tsx:67` must be added to Phase 3 implementation scope

### Open questions / handoff notes

- **Gap for Phase 3/4:** The implementation scope must include the fifth call site (`src/app/(admin)/admin/users/[id]/page.tsx:67`). Update the "Goal" section's item 2 from "four" to "five" before Phase 4 begins.
- **ESLint rule placement:** The proposed rule banning `toLocale*` outside the primitive's file will need a decision on whether it lives in `.eslintrc` as a custom rule or as a `no-restricted-syntax` pattern — tech-lead should call this in Phase 3.
- **SSR fallback format:** Phase 3 should specify what the ISO string fallback looks like in the `<time>` element (full ISO-8601 or a trimmed form like `YYYY-MM-DD`) so there is no flash of a raw timestamp string that differs significantly in length from the formatted result.

---

## Phase 2 — Architectural Review — 2026-05-18

**Owner:** architect
**Status:** complete

### Summary

Approved. The structural questions raised in Phase 1 are resolved: the primitive belongs in `src/components/shared/`, the ESLint guard uses an existing-config `no-restricted-syntax` pattern (no new dependency), and the SSR fallback is the ISO date slice with `suppressHydrationWarning`. No new npm package is needed. The server/client boundary invariant is satisfied — the primitive is a client component, server components that render it are unaffected. All three decisions are logged as DECISION-007.

**Verdict: Approved**

### What I did

- Confirmed `src/components/ui/` contains only `alert-dialog.tsx` (shadcn-generated); placing a hand-authored component there would violate the "auto-generated, don't hand-edit" rule.
- Confirmed `src/components/shared/` does not yet exist but is the correct home per CLAUDE.md's "cross-cutting components used by both surfaces" definition.
- Confirmed the repo uses a flat ESLint config at `eslint.config.mjs` (no `.eslintrc`); a `no-restricted-syntax` pattern with a `files` override exempting the primitive's path requires zero new packages and no plugin infrastructure.
- Confirmed no new npm dependency is needed: `Intl.DateTimeFormat` / `.toISOString()` are available in both Node 18+ (Vercel runtime) and all modern browsers.
- Confirmed the `'use client'` boundary is correct and does not violate any existing invariant — server components that import and render the primitive are unaffected because React handles the client-component island transparently.
- Confirmed the CLAUDE.md Key Invariant addition and the ux-developer one-liner do not conflict with existing content in either file.
- Logged the three sub-decisions (placement, ESLint shape, SSR fallback) as DECISION-007.

### Outputs

- `docs/work-log/2026-05-18-timezone-safe-dates.md` — this section appended; phase table row updated.
- `docs/decisions.md` — DECISION-007 logged (newest-first, above DECISION-006).

### Open questions / handoff notes

- Tech-lead (Phase 3): The fifth call site (`src/app/(admin)/admin/users/[id]/page.tsx:67`) must appear in the implementation scope — the analyst confirmed it but the Goal section still says "four". Update before handing to the implementer.
- Tech-lead (Phase 3): The `files` override in `eslint.config.mjs` that exempts the primitive's path should be scoped precisely — use the exact relative path `src/components/shared/formatted-date.tsx`, not a glob, to avoid accidentally exempting future files in the same directory.
- Tech-lead (Phase 3): Specify whether `<FormattedDate>` accepts a `Date`, an ISO string, or both as `value` — the five call sites pass `Date` objects from Drizzle, but the type surface should be explicit in the design doc.
- Implementer (Phase 4): `src/components/shared/` does not yet exist; create the directory when placing the primitive.

---

## Phase 3 — Technical Design — 2026-05-18

**Owner:** tech-lead
**Status:** complete

### Summary

Root cause: five server components call `toLocale*()` at render time; on Vercel's UTC SSR environment the viewer always sees UTC. One client component additionally produces a hydration mismatch. The fix is a single `<FormattedDate>` client primitive with an ISO SSR fallback, backed by an ESLint guard that makes the pattern impossible to regrow. No schema or API changes.

### What I did

- Pinned the component contract (props, value type, mode enum, default behavior).
- Derived the exact ESLint config block to drop into `eslint.config.mjs`.
- Drafted the CLAUDE.md Key Invariant entry text.
- Located the correct insertion point in `ux-developer.md` for the one-liner reminder.
- Mapped every call site to its exact replacement expression.

### 1. Component Contract

```typescript
// src/components/shared/formatted-date.tsx
type FormattedDateProps = {
  value: Date | string | number;   // normalized internally via new Date(value)
  mode?: "date" | "datetime";      // default: "datetime"
  className?: string;
};
```

`value` accepts `Date | string | number` because Drizzle returns `Date` objects from server queries, but those become ISO strings the moment they cross a server-component-to-client-component boundary over the wire. The body does `new Date(value)` unconditionally so callers need not normalize.

`mode` covers the two formatting patterns found across all five call sites:
- `"date"` — `toLocaleDateString()` equivalent (date only, no time)
- `"datetime"` — `toLocaleString()` equivalent (date + time), and the default

No `Intl.DateTimeFormatOptions` escape hatch in Phase 4 — all five call sites fit `mode`; add the escape hatch only when a future caller needs it.

SSR output: `<time dateTime={isoString} suppressHydrationWarning>{isoString.slice(0, 10)}</time>`. Client `useEffect` replaces the inner text with `toLocaleDateString()` or `toLocaleString()` using `undefined` locale (browser default). No layout shift because `slice(0,10)` (`YYYY-MM-DD`) and the formatted date are similar width.

### 2. Exact ESLint Config Block

The block lands at the end of the `config` array in `eslint.config.mjs`, before the closing `]`. Two objects: the broad ban, then the narrow exemption.

```js
// Ban toLocale* everywhere …
{
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]",
        message:
          "Use <FormattedDate> from src/components/shared/formatted-date.tsx instead of toLocale*() to avoid SSR timezone mismatches.",
      },
    ],
  },
},
// … except inside the primitive itself
{
  files: ["src/components/shared/formatted-date.tsx"],
  rules: { "no-restricted-syntax": "off" },
},
```

The `files` override uses the exact path (not a glob) per the architect's instruction.

Note: `nextConfig` (spread at the top of `eslint.config.mjs`) may already set `no-restricted-syntax`; if a conflict arises, wrap both entries in a single config object that merges the rule arrays rather than overwriting them. The implementer should check after adding.

### 3. CLAUDE.md Key Invariants Entry

Add immediately after the "No Secrets in Committed Files" invariant:

```
### Timezone-Safe Date Rendering

Never call `toLocaleString()`, `toLocaleDateString()`, or `toLocaleTimeString()` directly in components. On Vercel (UTC), server-rendered timestamps always show UTC to the viewer. Use `<FormattedDate value={...} mode="date|datetime" />` from `src/components/shared/formatted-date.tsx` instead — it SSR-renders an ISO fallback and swaps in the viewer's local timezone after mount. An ESLint rule enforces this; the primitive file is the only exemption.
```

### 4. ux-developer.md One-Liner

Add as item 7 under **Component Conventions** (after item 6 "Forms use React 19 Actions"):

```
7. **Timezone-safe dates.** Never call `toLocale*()` directly. Use `<FormattedDate value={...} mode="date|datetime" />` from `src/components/shared/formatted-date.tsx`; the ESLint rule will catch violations.
```

### 5. Per-Call-Site Replacement Map

| File | Line | Before | After |
|------|------|--------|-------|
| `src/app/(admin)/admin/users/page.tsx` | 151 | `new Date(u.lastLoginAt).toLocaleString()` | `<FormattedDate value={u.lastLoginAt} mode="datetime" />` |
| `src/app/(account)/account/2fa/page.tsx` | 58 | `new Date(existing.enrolledAt).toLocaleDateString()` | `<FormattedDate value={existing.enrolledAt} mode="date" />` |
| `src/app/(account)/account/2fa/page.tsx` | 60 | `new Date(existing.lastUsedAt).toLocaleString()` | `<FormattedDate value={existing.lastUsedAt} mode="datetime" />` |
| `src/app/(admin)/admin/2fa/page.tsx` | 61 | `new Date(existing.enrolledAt).toLocaleDateString()` | `<FormattedDate value={existing.enrolledAt} mode="date" />` |
| `src/app/(admin)/admin/2fa/page.tsx` | 63 | `new Date(existing.lastUsedAt).toLocaleString()` | `<FormattedDate value={existing.lastUsedAt} mode="datetime" />` |
| `src/app/(admin)/admin/users/[id]/page.tsx` | 67 | `new Date(user.createdAt).toLocaleDateString()` | `<FormattedDate value={user.createdAt} mode="date" />` |
| `src/app/(admin)/admin/users/[id]/two-factor-card.tsx` | 92 | `new Date(enrolledAt).toLocaleDateString()` | `<FormattedDate value={enrolledAt} mode="date" />` |

(Seven replacements across five files — the two 2FA pages each have two call sites.)

Each wrapping `{u.lastLoginAt ? ... : "—"}` null-guard stays in place; only the inner expression changes.

### 6. Implementer

**ux-developer.** This is pure UI work: one new client component plus mechanical JSX replacements in existing pages. No route handler or server action is touched.

### 7. Tests Phase 5 Will Need

- Unit test (`src/components/shared/formatted-date.test.tsx`): renders a `<time>` element with correct `dateTime` ISO attribute; accepts `Date`, `string`, and `number` values without throwing; `mode="date"` and `mode="datetime"` both render without error; SSR fallback is the `YYYY-MM-DD` slice (render to string, assert no full ISO-8601 leaks through).
- ESLint smoke test: confirm `npm run lint` exits non-zero on a file containing a bare `toLocaleString()` call (can be a manual check noted in the QA report, not a committed test file).
- No new e2e test required — the visual output change (UTC → local TZ) is untestable in a headless CI environment where TZ is fixed. QA should note the manual verification step: load `/admin/users` in a browser set to a non-UTC timezone and confirm the last-login timestamp is not UTC.

### Outputs

- `docs/work-log/2026-05-18-timezone-safe-dates.md` — this section appended; phase table row updated.
- No source files modified (Phase 4's job).

### Open questions / handoff notes

- **Implementer is ux-developer.**
- Create `src/components/shared/` directory when placing the primitive.
- After adding the ESLint block, run `npm run lint` to confirm no conflict with `nextConfig`'s existing `no-restricted-syntax` entries (if any). If there is a conflict, merge the rule arrays into one object rather than shadowing.
- The null-guard wrappers (`u.lastLoginAt ? ... : "—"`) at each call site are unchanged — only the inner expression is replaced.
- Phase 5 (qa): manual timezone verification step required (see Tests section above); headless CI cannot assert local-TZ rendering.

---

## Phase 4 — Implementation (UI) — 2026-05-18

**Owner:** ux-developer
**Status:** complete

### Summary

Created the `<FormattedDate>` client primitive with ISO SSR fallback and post-hydration local-TZ swap, replaced all seven call sites across five files, and hardened the codebase with an ESLint `no-restricted-syntax` rule that bans `toLocale*()` everywhere except the primitive's own file. Updated `CLAUDE.md` with a new Key Invariant and the `ux-developer` agent with a one-liner reminder. All automated gates pass (lint, typecheck, audit check). The production build fails due to a pre-existing Node 18 environment constraint (Next.js 16 requires Node >=20.9.0) — confirmed by `git stash` round-trip; my changes are not the cause.

### What I did

- Created `src/components/shared/` directory (did not exist before).
- Created `src/components/shared/formatted-date.tsx` implementing the Phase 3 contract exactly: `value: Date | string | number`, `mode?: "date" | "datetime"` (default `"datetime"`), `className?: string`. SSR renders `<time dateTime={iso} suppressHydrationWarning>{YYYY-MM-DD}</time>`; `useEffect` replaces inner text with `toLocaleDateString()` or `toLocaleString()` after mount.
- Applied seven call-site replacements across five files, adding a `FormattedDate` import to each file's import block. Null-guard wrappers left intact per Phase 3 instruction.
- Added two config objects to `eslint.config.mjs`: the `no-restricted-syntax` ban on `toLocale(String|DateString|TimeString)` calls, and the path-scoped `"off"` override for `src/components/shared/formatted-date.tsx`.
- During lint, encountered `react-hooks/set-state-in-effect` rule firing on the `setFormatted` calls inside `useEffect`. This is an intentional pattern (post-hydration TZ swap is the canonical use case). Added `/* eslint-disable/enable react-hooks/set-state-in-effect */` block with an explanatory comment inside the effect. Also confirmed the Phase 3-specified `no-restricted-syntax` ESLint block did not conflict with `nextConfig`'s existing rule entries — it coexists cleanly as a separate config object.
- Added the "Timezone-Safe Date Rendering" Key Invariant to `CLAUDE.md` immediately after "No Secrets in Committed Files".
- Added item 7 "Timezone-safe dates" to Component Conventions in `.claude/agents/ux-developer.md`.

### Outputs

- `src/components/shared/formatted-date.tsx` — created (new file, new directory)
- `src/app/(admin)/admin/users/page.tsx` — added `FormattedDate` import; replaced `new Date(u.lastLoginAt).toLocaleString()` at line 151
- `src/app/(account)/account/2fa/page.tsx` — added `FormattedDate` import; replaced `enrolledAt` (`toLocaleDateString`) and `lastUsedAt` (`toLocaleString`) at lines 58 and 60
- `src/app/(admin)/admin/2fa/page.tsx` — added `FormattedDate` import; replaced `enrolledAt` and `lastUsedAt` at lines 61 and 63
- `src/app/(admin)/admin/users/[id]/page.tsx` — added `FormattedDate` import; replaced `createdAt.toLocaleDateString()` at line 67
- `src/app/(admin)/admin/users/[id]/two-factor-card.tsx` — added `FormattedDate` import; replaced `enrolledAt.toLocaleDateString()` at line 92
- `eslint.config.mjs` — added `no-restricted-syntax` ban + path-scoped exemption for the primitive
- `CLAUDE.md` — added "Timezone-Safe Date Rendering" Key Invariant
- `.claude/agents/ux-developer.md` — added item 7 to Component Conventions
- Schema changes: none
- Audit events: not applicable

### Implementer notes — divergences from Phase 3 design

**One divergence:** The Phase 3 design did not anticipate the `react-hooks/set-state-in-effect` lint rule (it only mentioned the `exhaustive-deps` disable comment). The fix was an inline `eslint-disable/enable` block with an explanatory comment — this is preferable to turning the rule off globally and does not change the component's behavior or contract.

**Manual browser verification:** The dev server was already running on port 3000 when Phase 4 started. Confirmed the app is serving (HTTP 307 redirects correctly for unauthenticated access to `/admin/users`; the landing page returned valid HTML). Full interactive verification (sign in, navigate to `/admin/users`, 2FA pages, user detail page) requires a browser session and is the manual step described in Phase 3's "Tests Phase 5 Will Need" section. QA should perform this with a non-UTC browser timezone (e.g. US/Eastern or US/Pacific) and confirm: (a) timestamps render in local TZ, not UTC; (b) no hydration warnings appear in the browser console. The dev server is at `http://localhost:3000`.

### Open questions / handoff notes

- **QA (Phase 5) browser check:** Navigate to `/admin/users` (last-login column), `/admin/users/[id]` (created date + 2FA card enrolled-on), `/admin/2fa` (enrolled-on + last-used), and `/account/2fa` (enrolled-on + last-used). In each case, the timestamp should render in your local TZ, not UTC. No React hydration warnings should appear in the browser console.
- **QA (Phase 5) ESLint smoke test:** Temporarily add `new Date().toLocaleString()` to any non-exempt file and confirm `npm run lint` exits non-zero, then revert.
- **QA (Phase 5) unit tests to write:** See Phase 3's "Tests Phase 5 Will Need" section — a Vitest test for `<FormattedDate>` should cover: `<time>` element with correct `dateTime` ISO attribute; `Date`, `string`, and `number` value types; `mode="date"` and `mode="datetime"` both render without error; SSR fallback is `YYYY-MM-DD`.
- **Copy note:** The text around the date fragments ("You enrolled on", "Last used:", "Account created") is existing copy; no new strings were introduced.
- **Build environment note for QA/deployment-engineer:** `npm run build` fails with `Node.js 18.19.0` vs the >=20.9.0 requirement. This is pre-existing and not caused by this change. Verified by `git stash` round-trip.
- Next agent: **qa** for Phase 5.

---

## Phase 5 — Verification — 2026-05-18

**Owner:** qa
**Status:** complete

### Summary

PASS. All automated gates pass on Node 20.19.6 (the required runtime). The Phase 4 implementation is correct with one bug found and fixed during verification: the `<FormattedDate>` primitive lacked a NaN guard, causing it to throw `RangeError: Invalid time value` on empty-string or malformed-date inputs. The fix was applied during this phase (unconditional `isNaN` check before `toISOString()`, hooks call order preserved). The ESLint guard is wired correctly and fires on any `toLocale*()` call outside the primitive. All 7 call-site replacements are present and verified. Critical module coverage is 100% across all four targeted files.

### What I did

**Type check:** `npm run typecheck` — PASS. No errors.

**Lint:** `npm run lint --max-warnings=0` — PASS. Lint passes with the Phase 4 ESLint blocks in place.

**ESLint guard smoke test:** Temporarily placed a file containing `new Date().toLocaleString()` under `src/` and ran `npm run lint`. The `no-restricted-syntax` rule fired with exit code 1 and the correct message ("Use `<FormattedDate>` from src/components/shared/formatted-date.tsx instead of toLocale*() to avoid SSR timezone mismatches."). File was removed; lint returned to clean.

**ESLint-disable audit:** The `/* eslint-disable react-hooks/set-state-in-effect */` block in `formatted-date.tsx` is scoped narrowly — it wraps only the two `setFormatted()` calls inside the effect body (lines 36–46), not the file or function. The explanatory comment is accurate: `setState` inside `useEffect` is the canonical post-hydration TZ swap pattern. The disable is justified, not masking a real bug.

**Unit tests:** Ran on Node 20.19.6 (Node 18.19.0 cannot run Vitest 4.x — pre-existing constraint, confirmed by stash round-trip). Installed `@testing-library/react` and `jsdom` as dev dependencies (required for React component testing in jsdom).

Wrote `src/components/shared/formatted-date.test.tsx` covering:
- SSR fallback: `<time>` element present; `dateTime` attribute is full ISO string; visible text is `YYYY-MM-DD` slice; accepts `Date`, ISO string, and epoch number values; `className` is passed through.
- Client mount (after `useEffect` flushes via `act()`): text content is non-empty after mount; `mode="date"` and `mode="datetime"` produce different-length output (datetime includes time, date does not); all three value types mount without throwing.
- Invalid input regression: empty string and malformed-date string render without throwing — see regression section below.

**Bug found and fixed during Phase 5:** The component called `new Date(value).toISOString()` unconditionally. `new Date("").toISOString()` throws `RangeError: Invalid time value`. Fixed by computing `isValid = !isNaN(date.getTime())` before any hooks and using it to produce a safe `isoString` (`""`) and `ssrFallback` (`"—"`) for the invalid case. The effect guards against `setFormatted` on invalid input with `if (!isValid) return`. Hooks call order is unconditional (Rules of Hooks satisfied). Regression tests confirm: invalid inputs render the dash fallback without throwing.

**Unit test totals (Node 20.19.6):**
- Total: 154 | Passed: 154 | Failed: 0
- Duration: ~445ms
- Test files: 13

**End-to-end tests:** 10 failed, 1 passed — identical to HEAD before Phase 4 (confirmed by stash round-trip). Failures are pre-existing: the local dev server returns HTTP 500 because the database and OAuth environment variables are not configured for this sandbox. Phase 4 introduced zero new e2e failures.

**Manual browser verification:** Blocked. The sandbox runs Node 18.19.0; Next.js 16 requires >=20.9.0; `npm run build` fails (pre-existing). The dev server at `http://localhost:3000` returns 500 due to missing environment variables, not the Phase 4 changes. Manual verification (sign-in as seeded admin, `/admin/users`, `/admin/users/[id]`, `/admin/2fa`, `/account/2fa`, confirm local-TZ timestamps and no hydration warnings) is required in a properly-configured environment. Analyst should decide in Phase 6 whether this blocks SHIP IT or can be accepted as a pre-existing sandbox limitation.

**Call-site audit:** `grep` confirms zero remaining `toLocale*()` calls in `src/` outside `formatted-date.tsx`. All 7 replacements (5 files) are present with correct `mode` props and `FormattedDate` imports.

**Coverage on critical modules (Node 20.19.6, `--coverage.all`):**
- `src/lib/permissions.ts`: 100% statements / 100% branches / 100% functions / 100% lines
- `src/lib/two-factor.ts`: 100% / 100% / 100% / 100%
- `src/lib/flags.ts`: 100% / 100% / 100% / 100%
- `src/components/shared/formatted-date.tsx`: 100% / 100% / 100% / 100%
- Overall pure-TS modules (full suite): 76.37% statements (above 70% floor)

### Outputs

- `src/components/shared/formatted-date.tsx` — NaN guard added (bug fix applied in Phase 5)
- `src/components/shared/formatted-date.test.tsx` — created (new file, 12 tests across 3 describe blocks)
- `package.json` / `package-lock.json` — `@testing-library/react`, `@testing-library/dom`, `jsdom` added as devDependencies (required for React component unit tests in jsdom environment)
- `docs/work-log/2026-05-18-timezone-safe-dates.md` — this section appended; phase table row updated

### Regression tests added

- `does not throw when value is an empty string — renders a fallback dash` — `src/components/shared/formatted-date.test.tsx` — guards against missing NaN guard causing `RangeError: Invalid time value` on `new Date("").toISOString()`
- `does not throw when value is an invalid date string — renders a fallback dash` — `src/components/shared/formatted-date.test.tsx` — same guard, malformed ISO string path
- `FormattedDate renders <time dateTime> + hydrates without hydration warnings` — `e2e/timezone-safe-dates.spec.ts` — signs in as admin, asserts every `<time>` on `/admin/users` has a valid ISO `dateTime` attribute and a post-hydration visible text that is **not** the SSR `YYYY-MM-DD` fallback; asserts no console errors matching `/hydrat/i`.
- `same timestamp renders differently in different viewer timezones` — `e2e/timezone-safe-dates.spec.ts` — runs the same signed-in `/admin/users` page in two browser contexts (`America/Los_Angeles` and `Asia/Tokyo`); asserts each visible string equals what `toLocaleString()` produces in that context's TZ **and** that the two contexts produce different visible strings. This is the canonical browser-level proof that the bug class is fixed.

### Manual / browser verification

Closed by the new `e2e/timezone-safe-dates.spec.ts` regression spec. Verified end-to-end against a fresh dev server (Node 20.20.2, `AUTH_URL` overridden to match the test port) — both tests passed in 4.3s. The two-TZ test is the deterministic proof that any reviewer with `SEED_ADMIN_*` configured can re-run with `npm run test:e2e`; no human-in-the-loop step remains.

### Open questions / handoff notes

- **Node version discrepancy.** The project default is Node 18.19.0 but Vitest 4.x and Next.js 16 both require >=20.9.0. `nvm` has Node 20.19.6 / 20.20.2 available. Flag to deployment-engineer that `.nvmrc` / `engines` in `package.json` should be tightened to document the >=20.9.0 requirement and to fail fast on Node 18.
- **e2e port collision footgun.** While verifying, port 3000 was occupied by a sibling project (`westervillelions`) and the starter's dev fell back to 3001. Because `AUTH_URL` in `.env.local` pointed to localhost:3000, NextAuth's post-signin redirect crossed to the wrong app and cookies dropped. Worth documenting in the e2e README or in the `pre-push` skill: when running e2e, either ensure port 3000 is free or run with `AUTH_URL=http://localhost:<PORT> PORT=<PORT> npm run dev` + matching `E2E_BASE_URL`. Not a code bug — a developer-experience footgun the next reviewer will hit.
- **Next agent: analyst** for Phase 6 — Shipped vs Intent. Browser verification is no longer a blocker.

---

## Phase 6 — Shipped vs Intent — 2026-05-18

**Owner:** analyst
**Status:** complete

### Summary

SHIP WITH NOTES. The primary intent is fully delivered: the bug class is dead at all seven call sites, the primitive is correct and hardened, the ESLint rule is precise and verified, the CLAUDE.md invariant lands in the right section with the right tone, and the ux-developer agent reminder is in the Component Conventions section where a Phase 4 implementer will actually read it. The e2e spec proves the bug class is fixed with a real two-timezone visible-string comparison, which is exactly what Phase 1 wanted. Three follow-ups carry over from Phases 4 and 5; none block shipping.

### What I did

**Check 1 — Zero remaining toLocale* calls in src/.** Grep confirms zero hits outside `formatted-date.tsx`. All seven expressions replaced across five files. Pass.

**Check 2 — ESLint guard.** The rule in `eslint.config.mjs` targets all three methods via the regex `toLocale(String|DateString|TimeString)`. The exemption is a separate config object scoped to `files: ["src/components/shared/formatted-date.tsx"]` — the exact path, not a glob. The message names the primitive and explains the SSR risk. Phase 5 smoke-tested the rule live. Pass.

**Check 3 — CLAUDE.md invariant placement.** The entry is the last item under `## Key Invariants`, immediately after "No Secrets in Committed Files". Shape and tone match the neighbors. Pass.

**Check 4 — ux-developer agent reminder placement.** Item 7 under `## Component Conventions` — the numbered list that every Phase 4 implementer reads before touching a component. Not buried at the bottom of the file. Pass.

**Check 5 — e2e spec strength.** `e2e/timezone-safe-dates.spec.ts` contains the two-timezone test. It opens two browser contexts (`America/Los_Angeles`, `Asia/Tokyo`), hydrates the page in each, reads the first `<time>` element's visible text, and independently computes `new Date(iso).toLocaleString()` in each context via `page.evaluate`. The assertion is `visible === localized` per context AND `visible[LA] !== visible[Tokyo]`. That is the canonical proof — it compares visible strings, not just dateTime attributes, and the inequality between the two contexts is the precise refutation of the bug class. Pass.

**Check 6 — Adversarial pass.** The ESLint rule catches `toLocale*()` method calls. Three bypass vectors the rule does not cover:
- `Intl.DateTimeFormat` instantiated directly — the rule's AST selector does not match `new Intl.DateTimeFormat(...).format(date)`.
- `new Date().toString()` — not a `toLocale*` call; produces locale-agnostic UTC-offset strings but can still appear wrong in some timezones.
- Server-side date-string concatenation (template literals building a human-readable date from `date.getFullYear()`, `date.getMonth()` etc.) — entirely outside the rule's scope.

These are real gaps but they require deliberate workarounds, not accidents. Flagging as a low-priority follow-up rather than a blocker.

**Intent-vs-shipped diff:**

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Kill the bug at all five call sites (seven expressions) | Seven call sites replaced, zero remaining in src/ | Matches |
| `<FormattedDate>` client primitive with ISO SSR fallback | Delivered; NaN guard added during Phase 5 | Acceptable drift (improvement) |
| ESLint rule banning toLocale* outside the primitive | Delivered; path-scoped exemption; smoke-tested | Matches |
| CLAUDE.md Key Invariant | Delivered under Key Invariants, correct placement | Matches |
| ux-developer agent one-liner | Delivered at item 7 of Component Conventions | Matches |
| Vitest unit suite | 12 tests, 100% coverage on the primitive | Matches |
| e2e regression (Phase 3 originally said not needed; Phase 5 added it) | Two-TZ visible-string comparison; canonical proof | Better than Phase 1 intent |

**Edge cases:**
- Empty state: not applicable (primitive is not a page)
- Failure microcopy: invalid inputs render "—" dash fallback without throwing — pass
- Permission gate: not applicable (no new permission)
- Audit event: not applicable (no security-sensitive mutation)
- Mobile: primitive renders a `<time>` element; no layout concerns; not applicable as a distinct check

### Outputs

- `docs/work-log/2026-05-18-timezone-safe-dates.md` — Phase 6 section appended; phase table row updated to SHIP WITH NOTES

### Open questions / handoff notes (follow-ups)

Three items from Phases 4 and 5 become tracked follow-ups. None block shipping.

1. **Node engine floor** — deployment-engineer: add `"engines": {"node": ">=20.9.0"}` to `package.json` and a `.nvmrc` set to `20`. Without this, a developer on the default Node 18 path hits cryptic Vitest/Next.js failures with no clear error message. Spawn a new work-log entry.
2. **e2e port-collision footgun** — tech-lead or deployment-engineer: document in the e2e README (or the `pre-push` skill) that `AUTH_URL` must match the actual dev-server port; add a one-liner reminder to the e2e runner setup. Spawn a new work-log entry.
3. **ESLint blind spots for Intl.DateTimeFormat, toString(), and manual date assembly** — tech-lead: evaluate whether adding `Intl.DateTimeFormat` to the `no-restricted-syntax` selector is worth the false-positive risk (legitimate uses exist). Low priority; document the gap in `docs/decisions.md` rather than shipping a rule change without review.
