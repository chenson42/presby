# Starter Contribution Kit — Triage (PR #3)

**Date:** 2026-07-01
**Source:** `docs/starter-contributions/README.md` (from PR #3, mined from the Huddle Up fork)
**Method:** each of the ~40 candidates audited against the current single-root starter. Status assigned; two candidates surfaced **real latent bugs already present in the starter**.

## Status legend

- ✅ **DONE** — already shipped in the starter; prune from the kit.
- 🐞 **BUG** — the footgun the item describes is *live in the starter right now*. Fix first.
- 🔴 **OPEN** — genuinely missing; a real backport candidate.
- 🟡 **PARTIAL** — pattern exists but not the generalized primitive/rule the item proposes.
- ⚪ **LOW / N/A** — structural, niche, or not meaningful for a single-root starter.

---

## 🐞 Bugs found during triage (highest priority — these are not hypothetical)

| # | Kit item | Location | Problem |
|---|----------|----------|---------|
| **BUG-1** | A3 | `src/app/(email-verify)/account/verify-email/[token]/page.tsx:64` | Calls `db.transaction(...)` on the **neon-http** driver, which does not support transactions (the codebase documents this exact gap in `admin/users/[id]/actions.ts:75`). The email-change confirmation will **throw at runtime in production**. Fix = rewrite as sequential idempotent writes, per A3. |
| **BUG-2** | B4 | `src/app/(account)/account/2fa/page.tsx:24` (and the `(admin)/admin/2fa` twin) | Calls `jar.delete(FRESH_RECOVERY_CODES_COOKIE)` **during a Server Component render**. Next 16 forbids cookie mutation in RSC render → fresh recovery codes re-display on every reload (or throw). Fix = split read (RSC-safe) from mutation (client-fired Server Action), per B4. |

Both are `fix:` candidates and want a regression test (Phase-4/5 of the bug-fix pipeline variant).

---

## ✅ Already done — prune these from the kit

| Kit item | Evidence |
|----------|----------|
| **E1** timezone-safe `<FormattedDate>` + ESLint ban | `src/components/shared/formatted-date.tsx` + test + CLAUDE.md Key Invariant |
| **C2** `check:audit` tripwire | `scripts/check-audit-coverage.mjs`, `check:audit` npm script |
| **C5** auth-touching e2e login smoke gate | CLAUDE.md Phase-4 & Phase-5 gates |
| **C6** escape-rate telemetry (`fix:` trailers + hook + stats) | `scripts/commit-msg.mjs`, `scripts/stats-escape.mjs`, CLAUDE.md Commit Standards |
| **B2** `session-projection.ts` seam | `src/lib/auth/session-projection.ts` present |

---

## Full candidate table

### §A — Database

| # | Status | Notes |
|---|--------|-------|
| A1 `check:sql-date` tripwire | 🔴 OPEN | No `scripts/check-sql-date.mjs`. Backport-ready. Pairs with BUG-1's root cause (neon-http type lies). |
| A2 `isUniqueViolation()` + user-scope rule | 🔴 OPEN | No `src/lib/db/errors.ts`. Backport-ready helper + process-doc rule. |
| A3 neon-http gotchas (no txn; `sql<boolean>` string) | 🐞 BUG-1 + 🔴 | Bug live (above). Also wants the "Neon HTTP driver" doc section. |
| A4 `tokens.ts` + per-purpose `crypto.ts` | 🟡 PARTIAL | sha256 hashing is inlined (e.g. account-actions test); `two-factor.ts key()` is bound to one env var. No shared primitive. |
| A5 modeling doctrine (text+allowlist, dedicated tables, soft caps, first-write-wins) | 🟡 PARTIAL | Schema already uses no `pgEnum` (follows text convention) — but undocumented. Low-value process-doc. |
| A6 `xmax` net-new upsert count | ⚪ LOW | Niche snippet doc. |
| A7 migrate-before-deploy + don't-delete-flag-rows | 🔴 OPEN | Not in deployment agent/docs. Process-doc; ties to BUG-1 class of incidents. |
| A8 build-step migration (atomic deploy) | 🔴 OPEN | needs-generalization; no `vercel.json` yet. |

### §B — Auth / session

| # | Status | Notes |
|---|--------|-------|
| B1 `cachedAuth` (`cache(auth)`) + `cache()`-wrapped flags | 🔴 OPEN | No `cached-auth.ts`. Backport-ready perf win (removes duplicate `SELECT users` per render). |
| B2 stale-JWT re-read + `session-projection` seam | ✅ DONE | Primitive present; invariant doc could be reinforced. |
| B3 provider-aware `signInGate` | 🟡 PARTIAL | Starter DOES ship Google **+ Credentials** (`src/auth.ts`), with linking logic inline in `auth.ts`. Extracting a DI-testable `sign-in-gate.ts` is a real needs-generalization item. |
| B4 2FA fresh-codes cookie-out-of-RSC | 🐞 BUG-2 | Bug live (above). |
| B5 signed single-use OAuth state token | ⚪ LOW | Mainly needed for native/cross-jar OAuth. Defer until G1. |
| B6 native-shell Credentials provider | ⚪ LOW | Pairs with the mobile/monorepo structural work. |

### §C — QA / process gates

| # | Status | Notes |
|---|--------|-------|
| C1 cadence-check SessionStart hook | 🔴 OPEN | `.claude/settings.json` has **no hooks**. High leverage — makes the periodic-review framework self-enforcing. |
| C2 `check:audit` tripwire | ✅ DONE | — |
| C3 rendered-page smoke gate | 🔴 OPEN | `qa.md` has a generic "manual smoke when runner can't run" note, but not the binding Phase-5 gate (skip → BLOCKED). |
| C4 cross-user unique-constraint fixture gate | 🔴 OPEN | Not in qa.md/pipeline. Directly guards the A2 outage class. |
| C5 auth-touching e2e login smoke | ✅ DONE | — |
| C6 escape-rate telemetry | ✅ DONE | — |
| C7 ship-live-by-default + flag-debt audit | 🔴 OPEN | No Workflow Rule 13, no flag-debt periodic review. Process-doc bundle. |
| C8 dead-code / unused-dep sweep playbook | 🔴 OPEN | Process-doc; optional `check:deadcode` helper. |

### §D — Tooling / CI / infra

| # | Status | Notes |
|---|--------|-------|
| D1 e2e prod-DB isolation guard | 🔴 OPEN | No `e2e/global-setup.ts`, no `globalSetup` in playwright config. Backport-ready; prerequisite for a safe C5 fixture. |
| D2 DB-sync GitHub Action | 🔴 OPEN | No `.github/workflows/db-sync.yml`. needs-generalization (secret-presence guard for forks). |
| D3 Vercel cron convention (GET, auth-first) | 🔴 OPEN | No `api/cron/` or `vercel.json`. Backport-ready example + doc. |
| D4 app-wide CSP header | 🟡 PARTIAL | `next.config.ts` ships several security headers but **no `Content-Security-Policy`**. needs-generalization. |

### §E — UI primitives

| # | Status | Notes |
|---|--------|-------|
| E1 `<FormattedDate>` + ESLint ban | ✅ DONE | — |
| E2 overlay rule + centered Dialog primitive | 🟡 PARTIAL | Only `alert-dialog.tsx` ships. **CLAUDE.md Rule 2 tells devs to "use shadcn `Dialog`" but no `dialog.tsx` exists** — a live doc/primitive inconsistency. |
| E3 `useOptimisticToggle` hook | 🔴 OPEN | Missing. needs-generalization. |
| E4 `Button` (+ `Pill`) | 🔴 OPEN | **No `button.tsx`** — kit is correct. Backport-ready `Button`; every fork hand-rolls without it. |
| E5 `EmojiPicker` | ⚪ LOW | Product-ish; needs-generalization. |
| E6 responsive admin shell | 🔴 OPEN | Both `(admin)` and `(account)` layouts use `grid-cols-[220px_1fr]` with no breakpoint → overflow < ~400px. Backport-ready. |
| E7 branded, client-safe email template | 🔴 OPEN | No `email-template.ts`; **`email.ts` has no `escapeHtml`** (injection surface). needs-generalization. |

### §F — Reusable features (larger, opt-in)

| # | Status | Notes |
|---|--------|-------|
| F1 What's New member changelog | 🔴 OPEN | needs-generalization. Full subsystem. |
| F2 usage heartbeat + `/admin/usage` | 🔴 OPEN | needs-generalization. |
| F3 in-app feedback capture | 🔴 OPEN | needs-generalization. |

### §G — Structural

| # | Status | Notes |
|---|--------|-------|
| G1 monorepo `web/` + `mobile/` split | ⚪ LOW | Big lift; only if native shells become a starter goal. |
| G2 `mobile-developer` agent | ⚪ LOW | Pairs with G1. |
| G3 `downstream-sync` skill | 🔴 OPEN | This is literally what PR #3 adds. Backport-ready; self-no-ops in canonical. |

---

## Recommended execution order (post-triage)

1. **Fix the two live bugs** — BUG-1 (transaction crash) and BUG-2 (2FA cookie in RSC). Bug-fix pipeline + regression tests.
2. **Safety guards** — C1 (cadence hook), C3 + C4 (QA gates), A1 (`check:sql-date`), A2 (`isUniqueViolation`).
3. **Drop-in wins** — E4 `Button` + E2 `dialog.tsx` (closes the Rule-2 inconsistency), B1 `cachedAuth`, E6 responsive admin shell.
4. **Test/deploy safety** — D1 e2e isolation, A7 deploy ordering doc, D4 CSP.
5. **Merge PR #3** — lands the `downstream-sync` skill (G3) + this kit doc.
6. **Opt-in, larger** — A4/A8, C7/C8, D2/D3, E3/E5/E7, F1–F3.
7. **Defer** — A5/A6, B3/B5/B6, G1/G2.
