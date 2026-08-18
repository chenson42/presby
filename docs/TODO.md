# TODO — Backlog & Follow-Ups

The single aggregation point for open work. Work-logs track *how* a piece of work
moves through the pipeline; this file tracks *what's open* across everything.

**Reconciliation rule (Workflow Rule 10):** any commit that ships, defers, or
discovers work must update this file *in the same commit*. Phase 6 follow-ups
land here. Review punch-list items that get accepted land here. Shipped items
move to Done with the date. Claude reads this file at session start alongside
the cadence check.

Format: one line per item — `- [ ] <item> — <source/link>`. Keep it lean;
detail lives in the linked doc, not here.

---

## In Flight

## Next Up

- [ ] **URGENT — next-auth `5.0.0-beta.31` → `beta.32`** via a proper auth pipeline (full e2e gate, MFA user): clears 2 critical + 1 high Auth.js advisories in `@auth/core` (GHSA-xmf8-cvqr-rfgj uncaught exception on malformed Bearer header, GHSA-7rqj-j65f-68wh email-normalizer homoglyph bypass, GHSA-x445-f3h2-j279 OAuth state/nonce/PKCE cookies not provider-bound). Outside the pinned range, so `npm audit fix` can't take it. Then remove `continue-on-error` from the CI audit step — found during 2026-08-09 pre-push
- [ ] Configure `NEON_API_KEY` + `NEON_PROJECT_ID` repo secrets to activate e2e CI (optional: `ANTHROPIC_API_KEY` for Claude PR review); watch the first live run of both workflows (pinned Neon action versions unverified until then) — enforcement batch residual

- [ ] Fable review D1: `src/instrumentation.ts` + Sentry (free-tier) stub + thin `src/lib/log.ts` wrapper, in teaching-comment style — `docs/reviews/2026-08-09-fable-external-review.md`
- [ ] Fable review D2: migrate legacy `assignRoleAction`/`removeRoleAction` to `ActionResult` + feature gate + validated IDs; bless zod (or small parse helper) as the validation pattern
- [ ] Fable review D3: README deployment section (Vercel setup, cron registration, `db:migrate` vs `db:push` on deploy) + add `CRON_SECRET`/Turnstile/seed vars to the README env table
- [ ] Fable review B2: acceptance-criteria section (EARS-style) in `docs/work-log/_template.md` Phase 1, checked off row-by-row in Phase 5, verified in Phase 6
- [ ] Fable review B3: SessionStart hook printing `slug | phase | status` for open work-logs (machine-readable pipeline state; would have caught the two stale-Pending Phase 6 rows)
- [ ] Fable review E1–E4 process batch: `/test` bank opt-in for release-class merges + soften pre-push HARD STOP to confirm · Phase 6 skippable-with-notation for Polish class · demote CLAUDE.md capability map to pointer + pre-push map-version-vs-package.json check · legitimize "process-harvest mode" in the Classification table
- [ ] Fable review E5: `tools:` frontmatter restrictions for analyst + qa agents; document (or vary) the all-sonnet model choice; widen full-stack-developer charter or push the split
- [ ] Fable review D4: reconcile `components/ui/` vs CLAUDE.md "shadcn primitives" claim + Rule 2's nonexistent `Dialog` — ship the implied primitives or correct the docs
- [ ] Security/code punch batch (small, one pipeline): add `hasFeature(ADMIN_DASHBOARD)` to all four exports in `(admin)/admin/2fa/actions.ts` (M5) · `escapeHtml()` on `newEmail` in `changeEmail` email body (L2) · `checkRateLimit` on `changePassword` (L1, open since 05-17) · UUID-validate `userId`/`roleId` in assign/removeRoleAction (L3) · `crypto.timingSafeEqual` for `CRON_SECRET` in both cron routes (L4) · delete dead `prepareEnrollment` + orphaned `PENDING_TTL_MINUTES` in `(account)/account/2fa/actions.ts` — sources: `docs/reviews/2026-07-11-security.md`, `2026-07-11-code.md`
- [ ] Unit test for `loadEnv()` in `scripts/feedback-check.mjs` — QA recommended it during the feedback-dev-loop loop-back but it was never filed — retro 2026-07-11 #5
- [ ] Bump `eslint` → 10.x + `eslint-config-next` → 16.2.10+ together (now unblocked); branch-test TypeScript 6.0 (not 7.x — typescript-eslint) — `docs/reviews/2026-07-11-dependencies.md`

## Backlog

- [ ] Fable review C2: package the `.claude/` process layer as a Claude Code plugin (versioned `plugin.json`, marketplace-installable) — candidate successor to fork-and-copy + `upstream-sync` diffing
- [ ] Fable review C3: move auth/server-action rules into path-scoped `.claude/rules/*.md` to relieve CLAUDE.md load
- [ ] Fable review C5: test-tampering ratchet (commit failing tests before implementation, tests frozen during Phase 4) + evaluate mutation testing as a future `check:*` tripwire
- [ ] Fable review D5 nits: `fileURLToPath` in `functionality-map.mjs`/`check-audit-coverage.mjs` (Windows) · parameterize `stats-escape.mjs` `--since` (30d window vs 14d retro cadence double-counts)
- [ ] Fable review F8: escape-rate alarm sentence in tech-lead.md (post-merge % rising two retros running → propose a named tripwire) · state branch-protection/PR-required posture for `main` in CLAUDE.md · one-line-per-decision index atop `docs/decisions.md` · add deployment-engineer's "Pre-Deploy" section stub to `_template.md`
- [ ] Extract duplicated recovery-codes helpers (`(admin)/admin/2fa/actions.ts` ↔ `(account)/account/2fa/actions.ts`) into `src/lib/` — carried since 05-17; longer-term, consider consolidating the two 2FA surfaces into one implementation (product decision) — code + security 2026-07-11
- [ ] Batch-bump routine low-risk deps (Radix, Tailwind patch, React types, Resend, otplib, lucide, tsx, Playwright, Vitest) in one PR — deps 2026-07-11
- [ ] Watch for `drizzle-kit@1.0.0` stable (resolves esbuild GHSA-67mh-4wv8-2f99; treat as major-version project with Neon branch smoke) — deps 2026-07-11; Next 16.3.0 taken 2026-08-09 (resolved the bundled-postcss CVEs; 48/48 e2e)
- [ ] Consider a `db.transaction(`-with-neon-http grep tripwire (mirror of check:sql-date) — the BUG-1 class; retro 2026-07-11 #2
- [ ] Schema comment on `emailQueue` pointing at `RawQueueRow`/`fromRaw()` in `src/lib/email/queue.ts` so future columns don't silently skip the atomic-claim path — code 2026-07-11
- [ ] ADR for the "text, not pgEnum" status-column convention (or add DB CHECK constraints) — security 2026-07-11 (observational)
- [ ] Next release slot: run a standalone test-coverage sweep (don't rely on incidental Phase 5 numbers) — retro 2026-07-11 #6
- [ ] Harvest candidate: huddleup's `scripts/cadence-check.mjs` — SessionStart hook that computes overdue reviews and prints only the delta, replacing the manual read-log-and-compute ritual at session start — spotted during the 2026-07-12 functionality-map harvest
- [ ] Remaining OPEN items from the starter-contribution triage (C3/C4 QA gates, C7/C8 process docs, A7/A8 deploy ordering, D2/D3 CI+cron, E2 `dialog.tsx` + E3/E4 primitives, F2 usage heartbeat, …) — work via `docs/reviews/2026-07-01-starter-contribution-triage.md`; specs in `docs/starter-contributions/README.md`

- [ ] Reconcile `.env.example` as the canonical env-var inventory — `DATABASE_URL_UNPOOLED`, `AUTH_TRUST_HOST`, `UPSTASH_REDIS_REST_URL/TOKEN`, `TRUST_PROXY_HEADERS`, `RATE_LIMIT_DISABLED` referenced elsewhere but absent from it; verify each against actual `process.env` usage — follow-up from `docs/reviews/2026-07-11-agent-instruction.md`
- [ ] Deck: check whether the review-cadence slide needs updating for the two-slot consolidation (DECISION-029) at the next `deck/slides.md` edit
- [ ] Stale test replica: (auth)/totp/actions.test.ts tests a local copy of the pre-extraction sanitizeCallbackUrl (old /admin fallback) — retire or point at safe-callback.test.ts coverage

- [ ] Admin lock-state detail page — add lock badge + unlock action to `/admin/users/[id]` — follow-up from `docs/work-log/2026-07-02-admin-lock-visibility.md` Phase 3 scope decision
- [ ] `(password-reset)` error boundary — same gap as `(email-verify)`; unauthenticated token-lookup route, no error.tsx — tracked from `docs/work-log/2026-07-02-email-verify-error-boundary.md` Phase 1 Pass 5
- [ ] Tier 4 utilities on demand (csvCellSafe, ssrf-guard, magic-bytes, maskEmail, settings store, ConfirmDialog, iconKey nav, cf-connecting-ip, route-table 2FA gate, …) — harvest Tier 4
- [ ] TOTP enrolment e2e — requires either a seeded deterministic TOTP secret (security risk — see routing feature option (c) rationale, e2e-auth-infra work-log Phase 2 Ruling 7) or external authenticator integration; deferred until a safe pattern is designed

## Done

- [x] 2026-08-09 — Enforcement batch from the Fable external review: CI runs both tripwires + `npm audit` + commit-grammar job; dependabot; e2e-in-CI on ephemeral Neon branch + playwright `webServer`; cadence-check SessionStart hook; pre-push PreToolUse gate (Rule 5 mechanized); `Work-Log:` commit trailer (required on feat/fix); `AGENTS.md` shim; opt-in Claude PR review — `docs/work-log/2026-08-09-enforcement-batch.md`
- [x] 2026-07-13 — PR #3 closed as superseded (its skill copy was the pre-generalization fork variant; main's port from 20fb316 stands); contribution kit landed as `docs/starter-contributions/README.md` with a live-status banner (stale "dormant" caveat + top-down PR order removed); fork-sync skills + kit added to the functionality map
- [x] 2026-07-12 — Functionality map harvested from huddleup.health: `docs/product/functionality-map.md` + SessionStart index hook + Workflow Rule 14 + release-notes/personalize-starter wiring — `docs/work-log/2026-07-12-functionality-map.md`
- [x] 2026-07-11 — Instruction-layer slim: CLAUDE.md 451→~330 lines, 9 agents de-duplicated + de-drifted, handoff format single-sourced to work-log template, review cadences consolidated to two slots (DECISION-029) — `docs/work-log/2026-07-11-instruction-layer-slim.md`
- [x] 2026-07-02 — v0.6.0 shipped: PR #4 merged to main (30 commits — member home, feedback dev-loop, admin ops suite, email reliability, security batch, 6 fixes, tooling); branch deleted via /merge-pr
- [x] 2026-07-01 — `/test` + `/test-results` skills ported (commit 4afcc36)

- [x] 2026-07-02 — E2E feedback test-data cleanup — globalSetup preflight sweep scoped to seed-user emails; 9 stale rows swept on first run — SHIP IT — `docs/work-log/2026-07-02-e2e-feedback-cleanup.md`
- [x] 2026-07-02 — `(email-verify)` error boundary — `error.tsx` added at group level; ui-standards.md rule written — SHIP IT — `docs/work-log/2026-07-02-email-verify-error-boundary.md`
- [x] 2026-07-02 — TOTP enrollment-stranding fix — two-hop redirect chain (proxy → /totp → /account/2fa?callbackUrl=) implemented; "Continue" CTA; auth e2e gate cleared 48/48 — SHIP IT — `docs/work-log/2026-07-02-totp-enrollment-redirect.md`
- [x] 2026-07-02 — Admin lock-state visibility + unlock — amber badge + inline unlock form; `USER_ACCOUNT_UNLOCKED` audit event; check:audit passes — SHIP IT — `docs/work-log/2026-07-02-admin-lock-visibility.md`
- [x] 2026-07-02 — Turnstile CAPTCHA (no-op until keyed) — endpoint-level verification in authorize(); fail-open; CSP updated; 48/48 e2e with no keys — SHIP IT — `docs/work-log/2026-07-02-turnstile-captcha.md`
- [x] 2026-07-02 — Email queue admin viewer + Resend delivery webhook — migration 0006; hand-rolled HMAC (3 Phase 2 mandates); /admin/email-queue viewer + retry; 48/48 e2e — SHIP IT — `docs/work-log/2026-07-02-email-observability.md`
- [x] 2026-07-02 — Member-visible what's-new — migration 0007; validateWhatsNewEntry (HTML-reject, spread emoji check); admin CRUD; member /home card + /whats-new; Rule 13 advisory; 48/48 e2e — SHIP IT — `docs/work-log/2026-07-02-whats-new.md`
- [x] 2026-07-02 — Audit log viewer at `/admin/audit` — pure RSC; input guards with 13 unit tests; grouped action select; admin.audit permission; SOC 2 fork note; 48/48 e2e — SHIP IT — `docs/work-log/2026-07-02-audit-log-viewer.md`
- [x] 2026-07-01 — Process batch: `docs/ui-standards.md`, `downstream-sync` skill, QA feature-gate table + no-self-agreeing-mocks, force-push guardrail (Rule 11 + deployment-engineer), `/pre-push` CVE step, database-admin `onDelete` rule, api-developer email-escape rule, TODO ledger (Rule 10) — harvest Tier 3 #16-20, #23 (instructions)
- [x] 2026-07-01 — BUG-1: verify-email `db.transaction()` on neon-http → `db.batch()` — SHIP IT — `docs/work-log/2026-07-01-verify-email-neon-http-transaction.md`
- [x] 2026-07-01 — BUG-2: 2FA fresh-recovery-codes cookie deleted during RSC render — SHIP IT — `docs/work-log/2026-07-01-2fa-fresh-codes-rsc-cookie.md`
- [x] 2026-07-01 — BUG-3: first-time Google OAuth sign-in gets AccessDenied — SHIP IT — `docs/work-log/2026-07-01-oauth-first-signin-accessdenied.md`
- [x] 2026-07-01 — BUG-4: NextAuth `trustHost` unset — OAuth hard-blocked off-Vercel — SHIP IT — `docs/work-log/2026-07-01-nextauth-trusthost.md`
- [x] 2026-07-01 — Post-login routing + member home + global nav + e2e hardening — SHIP IT, committed `18f04a7`
- [x] 2026-07-01 — Sibling harvest of 7 fork repos → classified punch-list — committed `4c54e4f`
- [x] 2026-07-01 — recordAudit() helper (audit ip/user_agent, request-ip.ts shared module, logAttempt elimination) — SHIP IT — `docs/work-log/2026-07-01-record-audit-helper.md`
- [x] 2026-07-01 — isUniqueViolation() helper (verify-email ErrorCard, password-reset atomic upsert) — SHIP IT — `docs/work-log/2026-07-01-unique-violation-helper.md`
- [x] 2026-07-02 — Mobile (360px) visual pass — account+admin sidebar layout, global nav crowding — CSS-only, batch QA covers regression — `docs/work-log/2026-07-02-mobile-360-pass.md`
- [x] 2026-07-01 — E2E auth infra (cached storageState, role boundaries, DB isolation guard) — SHIP IT — `docs/work-log/2026-07-01-e2e-auth-infra.md`
- [x] 2026-07-01 — Durable email queue with retry (persist-first enqueue, cron worker, vercel.json) — SHIP IT — `docs/work-log/2026-07-01-email-queue.md`
- [x] 2026-07-01 — In-app feedback + dev-loop triage wiring — SHIP WITH NOTES (FU-1: e2e test-data hygiene) — `docs/work-log/2026-07-01-feedback-dev-loop.md`
- [x] 2026-07-01 — Report-only CSP + HSTS preload removal — SHIP IT — `docs/work-log/2026-07-01-security-headers.md`
- [x] 2026-07-01 — ACCESS_DENIED audit event on /access-pending bounce — SHIP IT — `docs/work-log/2026-07-01-access-denied-audit.md`
- [x] 2026-07-01 — Per-account login lockout (5-failure → 15-min DB-persisted lock, npvitals bug fix, Gap 2–4 fixes) — SHIP IT — `docs/work-log/2026-07-01-account-lockout.md`
- [x] 2026-07-01 — pendingTaken expiresAt-filter bug (requestEmailChange cross-user collision check) — SHIP IT — `docs/work-log/2026-07-01-pending-email-expiry-filter.md`
- [x] 2026-07-01 — check:sql-date tripwire (catch sql<Date> compile-time lie; umbrella check script; pre-push Step 3c) — SHIP IT — `docs/work-log/2026-07-01-sql-date-tripwire.md`
- [x] 2026-07-01 — Opportunistic expired-token GC (daily /api/cron/maintenance; passwordResetTokens + emailVerificationTokens + userTotpPendingEnrollments) — SHIP IT — `docs/work-log/2026-07-01-token-gc.md`
- [x] 2026-07-01 — cache()-wrap isFlagEnabled + cachedAuth (Scope 1+2; eliminates 2× Tier-A SELECT per request; corrects false framework comment) — SHIP IT — `docs/work-log/2026-07-01-flag-caching.md`
- [x] 2026-07-01 — auth.local_login + auth.require_2fa admin flags (OAuth-only endpoint gate, org 2FA master switch, fail-open postures, e2e green) — SHIP IT — `docs/work-log/2026-07-01-auth-mode-flags.md`
