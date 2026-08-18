# Sibling-Project Harvest — 2026-07-01

Seven sibling repos scanned for back-portable improvements to the starter:
`westervillelions`, `fpcw-directory`, `sagacraft`, `huddleup.health`, `explore.press`, `fertilityluna`, `npvitals`.

Method: one read-only scout per repo, briefed on the starter's current feature set (including the
`/home` member-home work shipped 2026-07-01), asked for bug fixes in shared-pattern code, reusable
utilities, better patterns, and `.claude/` convention improvements — domain content excluded.
Findings below are deduplicated and re-classified across all seven reports. A "×N" marker means N
repos independently hit the same gap — the strongest possible signal.

**Read first:** `huddleup.health/docs/starter-contributions/README.md` is a ready-made 303-line
backport kit (~40 candidates in executable-spec form, mined from huddleup's own reviews and
work-logs). Several items below reference its section numbers.

---

## Tier 1 — Must-pull: bugs the starter has *today*

| # | Finding | Source(s) | Where it bites |
|---|---------|-----------|----------------|
| 1 | **BUG-1: `db.transaction()` throws on the neon-http driver.** Proven fix: `db.batch([...])` (atomic on neon-http). Unit tests can't catch it — mocked `db` "supports" transactions. | explore.press `d55a165`; huddleup kit §A3 | `src/app/(email-verify)/account/verify-email/[token]/page.tsx:64` — throws the moment a user confirms an email change. Already tracked; needs its bug-fix work-log. |
| 2 | **BUG-2: `cookies().delete()` during RSC render** (forbidden in Next 16; fresh recovery codes re-display every reload in prod). Fix: client component + `useEffect` firing a clear-cookie server action. | huddleup `fresh-recovery-codes.tsx`, kit §B4 | `src/app/(account)/account/2fa/page.tsx:24` and `src/app/(admin)/admin/2fa/page.tsx:29`. Already tracked; needs its bug-fix work-log. |
| 3 | **New Google OAuth user gets AccessDenied.** ×2. The `signIn` callback keys the active-user check off `user.id`, which is Google's `sub` before the adapter row exists → lookup misses → `return false` for every first-time OAuth user. Fixes: key off verified email (explore.press `5cba011`) or the fuller provider-aware `sign-in-gate.ts` (huddleup kit §B3, DI'd for unit tests, also solves OAuth↔credentials linking). | explore.press; huddleup | `src/auth.ts:122-138` |
| 4 | **`trustHost: true` missing from NextAuth config.** NextAuth 5 beta only auto-trusts the host on Vercel; behind any other proxy it derives the internal hostname for OAuth callbacks → state-verification failures and redirect loops (fpcw hit this in production, worst on older mobile Safari). One line + an `AUTH_TRUST_HOST` note in `.env.example`. | fpcw `e47322a`, `src/lib/auth/index.ts:18` | `src/auth.ts` — any off-Vercel deployment |
| 5 | **`isUniqueViolation()` helper.** Neon nests the pg `23505` code under `error.cause`; naive checks miss it and any signup/insert race 500s (caused a real "500-for-everyone-but-first-user" outage at huddleup). | huddleup `web/src/lib/db/errors.ts`, kit §A2 | Any unique-constraint race on the neon-http driver |
| 6 | **Audit `ip`/`user_agent` columns are defined but never populated.** `recordAudit()` helper resolves actor from `auth()`, pulls ip (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`) + UA from `headers()`, swallows failures, supports `actor: null`. Collapses 8+ duplicated `db.insert(auditEvents)` call sites. | fertilityluna `src/lib/audit/record.ts` | `src/lib/db/schema.ts:205-206` columns are always NULL today |

## Tier 2 — Should-pull: robustness and infrastructure

| # | Finding | Source(s) | Notes |
|---|---------|-----------|-------|
| 7 | **Durable email queue with retry.** ×3 — the most independently reinvented fix in the fleet. Starter's `src/lib/email.ts` is fire-and-forget: a transient Resend blip silently drops a password-reset email. Best synthesis: fertilityluna's persist-first `enqueueEmail()` (inline first attempt, exponential backoff 1m→1h, `maxAttempts`) + fpcw's atomic multi-instance claim (`FOR UPDATE SKIP LOCKED`), driven by a Vercel cron route using fertilityluna's `CRON_SECRET` pattern (503 when unset — never ships an accidentally-public worker). NOT fpcw's in-process node-cron (doesn't fit serverless). Standalone lifts even without the queue: `EMAIL_DEV_INTERCEPT` and `EMAIL_DEV_REDIRECT_TO` env patterns for safe local/e2e email testing; optional Svix-verified Resend webhook for delivery/bounce tracking. | westervillelions, fpcw, fertilityluna | Single biggest robustness gap |
| 8 | **Per-account login lockout.** `failedLoginAttempts` + `lockedUntil` on the user row (5 fails → 15-min lock, reset on success). Complementary to the starter's IP rate limiting — defends a targeted account against rotating-IP brute force. Two columns + authorize-callback logic. | npvitals `src/lib/auth.ts:8-9,36-47` | Leaning must for a security starter |
| 9 | **E2E infra: cached-storageState auth via the NextAuth API.** Playwright `globalSetup` signs each role in once by POSTing `/api/auth/callback/credentials` (csrf + live TOTP), verifies via `/api/auth/session`, caches per-role `storageState` (12h TTL). Starter drives the sign-in UI in every test — slower and brittle. Unlocks two companion specs worth mirroring: role-boundary denial tests (400-proves-passed / 403-proves-blocked trick) and a full TOTP-enrolment e2e. Pair with huddleup's prod-DB isolation guard (kit §D1: refuse to run against `*.neon.tech` unless `E2E_DATABASE_URL`/`E2E_ALLOW_SHARED_DB` set). | npvitals `e2e/support/global-setup.ts`, `role-boundaries.spec.ts`, `mfa-enrolment.spec.ts`; huddleup `web/e2e/global-setup.ts` | Biggest e2e-infra upgrade available |
| 10 | **`cache()`-wrap `isFlagEnabled` (and audit `auth()` call paths).** huddleup wraps both (`cachedAuth = cache(auth)` with a don't-use-in-actions doc-block); starter's `src/lib/flags.ts` has no `cache()`, and the per-request stale-check runs multiple times per authenticated render. Directly relevant now that `(member)/layout.tsx` + `home/page.tsx` both call `auth()`. Verify actual duplicate-query behavior before/after. | huddleup kit §B1 | Drop-in, near-zero risk |
| 11 | **Security headers: report-only CSP + drop HSTS `preload`.** Starter ships HSTS/nosniff/frame-options but no CSP; `Content-Security-Policy-Report-Only` + `frame-ancestors`/`base-uri`/`form-action` surfaces violations without breaking anything. Separately: starter's HSTS includes `preload` — a footgun for fresh forks (hard to undo); fertilityluna deliberately drops it. | fertilityluna `next.config.ts:3-40` | |
| 12 | **Cloudflare Turnstile component (no-op until keyed).** Renders nothing unless `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set; forms work unchanged. Matches the starter's own open "CAPTCHA on /signin" security TODO; covers `/signin` + `/forgot-password` abuse surface. | fertilityluna `src/components/marketing/turnstile.tsx` | |
| 13 | **`auth.local_login` + `auth.require_2fa` admin flags.** `local_login` gates Credentials `authorize()` itself (a direct POST can't bypass an OAuth-only deployment); `require_2fa` is a master switch computed into effective `twoFactorRequired` at JWT time, so `proxy.ts` needs no flag check. Registered in seed so they appear in `/admin/flags`. | explore.press `5cba011` | Showcases the starter's own flags system |
| 14 | **`check:sql-date` tripwire.** Bans the `sql<Date>` compile-time lie (neon-http returns strings for COALESCE'd dates → prod `.getTime()` crash). Script + npm/pre-push wiring + `// sql-date-ok:` escape hatch. | huddleup `web/scripts/check-sql-date.mjs`, kit §A1 | Same driver, same bug class |
| 15 | **Opportunistic expired-token GC.** Starter only deletes the requesting user's reset token; expired reset + email-verification tokens accumulate forever (no scheduled job). One-line sweep on mint. | westervillelions `src/lib/auth/password-reset.ts:41,123` | Or fold into the cron route from #7 |

## Tier 3 — Process, docs, and `.claude/` conventions

| # | Finding | Source(s) |
|---|---------|-----------|
| 16 | **`docs/ui-standards.md` convention doc.** ×3 — every mature fork wrote one, always *after* paying retrofit cost (fpcw: ~20 `fix:` commits). Codifies page layout, action-bar order, validated `?from=` back-nav, RHF+zod a11y attrs, combobox `"none"` sentinel, toast conventions, loading/error segments, four-state design + empty/loading/error microcopy, and a checkbox pre-merge UX audit QA can reference in Phase 5. Timely: the starter just grew `/home` + a global nav. Synthesize from fpcw + fertilityluna `docs/ui-standards.md` + sagacraft `docs/design/ux-guardrails.md`. |
| 17 | **`downstream-sync` skill** — the contribute-*back* counterpart to the starter's `upstream-sync`; it's the tool that generated huddleup's backport kit. Every fork inherits a repeatable "surface backport candidates" pass. | huddleup `.claude/skills/downstream-sync/` |
| 18 | **QA feature-gate audit gate** — mandatory-before-PASS table of every protected route/action a feature touched and its gate. Would have caught westervillelions' real `roles.includes("admin")` vs `hasFeature()` inconsistency. Add to `.claude/agents/qa.md`. | westervillelions `.claude/agents/qa.md:146` |
| 19 | **Force-push / external-system guardrail** — "same commit, different deploy result ⇒ the external system changed, not your code; don't amend/force-push to chase it." Add to CLAUDE.md + deployment-engineer agent. | westervillelions `CLAUDE.md:548` |
| 20 | **Dependency CVE audit step in `/pre-push`** — a PASS/FAIL report line. | westervillelions `.claude/skills/pre-push/SKILL.md:178` |
| 21 | **`/test` + `/test-results` skills** — versioned pre-merge manual-QA bank with sign-off, folded into release notes, archived. If pulled, mirror fpcw's `e65f966` glob fix in pre-push. | fpcw `.claude/skills/test/`, `test-results/` |
| 22 | **`docs/KNOWN-ISSUES.md` ledger** — Outstanding/Resolved tables with stable `KI-###` IDs cross-linked to release notes. Gives deferred bugs (like BUG-1/BUG-2 were) a durable home. | fpcw |
| 23 | **Agent-instruction lessons** (one-liners for the relevant agent files): audit every `onDelete` in schema review — `set null` only with a real orphan-recovery surface (sagacraft `3ba436c`); never test DB code with mocks that echo the code's own column names — cover the real column contract (sagacraft `dfe7add`); HTML-escape any user-controlled string interpolated into email HTML (westervillelions `2d3a2c5`, huddleup kit §E7); audit "who tried but bounced" — add `ACCESS_DENIED`/`ACCESS_GRANTED` audit events to the access-pending flow (sagacraft `e4a0762`). |

## Tier 4 — Optional utilities (pull when the need lands)

- **`csvCellSafe()`** — CSV/formula-injection escaping (westervillelions `src/lib/csv-safe.ts:18`); correct primitive the moment any admin CSV export exists.
- **SSRF-safe fetcher** — DNS pre-resolution rejecting RFC1918/IMDS, redirect cap, size/type caps, typed errors (explore.press `src/lib/ssrf-guard.ts`); for any future user-supplied-URL feature.
- **`validateMagicBytes()`** — file-signature upload validation (westervillelions `src/lib/receipt-magic-bytes.ts:30`); for any future upload feature.
- **`maskEmail()`** — PII-safe email display (explore.press `src/lib/mask-email.ts`); admin lists, audit views.
- **Typed `app_settings` store** — `getSettingString/Int`, `setSetting` returning previous value for from→to audit events (explore.press `src/lib/settings.ts`).
- **`ConfirmDialog` wrapper** — ×2 (westervillelions, npvitals); prop-driven API over the compound `alert-dialog` primitives. Plus npvitals' `page-header` and (with caveats) its pure-presentational `data-table` — but NOT `use-crud`, which competes with the `ActionResult<T>` server-action convention.
- **`iconKey` nav pattern** — nav items carry `iconKey: string` resolved through a shared map, avoiding a server→client serialization crash (fertilityluna `7b97b17`). Preemptive: bites the moment the new global nav grows a client mobile menu with icons.
- **`cf-connecting-ip` precedence** in `getRequestIp` behind the existing `TRUST_PROXY_HEADERS` gate (fertilityluna).
- **Route-table 2FA gate** — key the proxy 2FA check off `PROTECTION_RULES` instead of the hardcoded `/admin` prefix (explore.press).
- **IP/CIDR allowlist middleware** — lock a whole deployment to office/VPN ranges (npvitals `src/proxy.ts:10-42`).
- **Signed single-use OAuth state token** — for OAuth flows crossing cookie jars (huddleup kit §B5).
- **Vercel cron must export `GET` not `POST`** — silent-405 gotcha (huddleup kit §D3).
- **Dev-only test-helper route** — `NODE_ENV`-guarded `app/api/test/*` for resetting rate-limit/admin state so e2e specs are order-independent (sagacraft `server/test-router.ts`).
- **`docs/task.md` reconcile-in-same-commit rule** — persistent outstanding-work ledger verified at pre-push (fertilityluna `CLAUDE.md:17-21`).

## Explicitly not pulling (starter is ahead)

- Rate limiter — starter's two-tier Upstash/in-memory + audit + `TRUST_PROXY_HEADERS` version beats every sibling's.
- `@auth/core` dedup / `CredentialsSignin` import fix (npvitals' worst bug) — starter already single-versioned.
- westervillelions' proxy, password-reset, and auth module layout; fpcw's auth/session/2FA internals and single-tier limiter; sagacraft's Express/hash-router auth constructs; explore.press's pre-`safe-callback` callback handling — all behind the starter's current code.
- npvitals' `use-crud` (competing data-fetching lane) and CSRF origin-check (starter's server-action model covers it).

## Suggested sequencing

1. **Bug-fix work-logs now:** items 1–3 (BUG-1, BUG-2, OAuth AccessDenied) — real defects, proven fixes, bug-fix pipeline variant each.
2. **One-liners next:** items 4–5 (`trustHost`, `isUniqueViolation`) — small, high-value, low-risk.
3. **Two feature pipelines:** item 7 (email queue — the fleet's #1 repeated gap) and item 9 (e2e infra).
4. **Docs/process batch:** items 16–23 — doc-only, no pipeline, immediate benefit to every future fork.
5. **Everything else on demand.**
