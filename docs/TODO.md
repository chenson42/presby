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

## Verification debt (DECISION-045)

Phases 5 and 6 deferred on the foundation pipelines, to be cleared in one
operator-led pass once the foundation is coherent. Each line names what has not
been independently verified.

- [ ] **P0 — post-login router** (`603f0a1`): qa Phase 5 and analyst Phase 6 both deferred. Mechanical gates all green — 505 unit, 63 e2e, 59 isolation assertions, build clean — and the operator walked the destination matrix by hand.
- [ ] **`drizzle/0015_presby_membership_probe.sql` — different in kind.** A SECURITY DEFINER probe fixing `withOrgContext()`, written by a ux-developer mid-UI-slice, third occurrence of the F26 pattern, touching the isolation model. Wants a database-admin read regardless of when the rest is verified.
- [ ] **Slice A's `db:push` finding**: drizzle-kit renders CHECK constraints table-qualified while Postgres renders them unqualified with a cast, so all three checks read as drift on every push — including two that predate this work. Verify by `drizzle-kit pull` + snapshot compare instead.

## In Flight

- [ ] **P0 — post-login router and org context** (`/launch`, `/orgs`, `/no-organization`, `/o/[slug]`, `presby_user_organizations`, slug CHECK, membership/position guard, shadcn init) — Phase 4 complete 2026-08-18 (slices A, B, C1, C2/C3); **next: qa (Phase 5)** — `docs/work-log/2026-08-18-backbone-and-org-sites.md`

## Next Up

- [ ] **P2 replaces `/no-organization`'s second door.** "Is your church not on presby?" currently links to `/` because there is no onboarding request form yet. When P2 ships one, point it there — the zero-org page is the funnel and a link to a marketing stub is the weakest part of it — `docs/work-log/2026-08-18-backbone-and-org-sites.md` Phase 4 slice C2
- [ ] **Adopt `forbidden()` for the org access-denied page when it leaves `experimental.authInterrupts`.** DECISION-044(3) renders it at HTTP 200 today; the byte-identical-copy property DECISION-040 protects is satisfied, the status code is not — `docs/work-log/2026-08-18-backbone-and-org-sites.md`
- [ ] **`npm run db:push` reports permanent phantom drift and cannot be used as the "schema.ts matches the migration" proof.** Three causes, none introduced by P0: push is interactive and refuses to run without a TTY; it proposes re-adding `memberships_person_org_key`, which demonstrably exists; and drizzle-kit renders CHECK constraints table-qualified while Postgres renders them unqualified with a cast, so all three checks in the schema read as drift on every push. `drizzle-kit pull` into a scratch directory is the comparison that does work — either wire that up as the check or drop the claim from the design template — `docs/work-log/2026-08-18-backbone-and-org-sites.md` Phase 4 slice A
- [ ] **`/developer` will not show `presby_membership_is_active` or the DECISION-039 triggers**, the same blindness already filed above for functions/triggers/policies — it is now three functions and three triggers behind, and one of them is the tenant gate

- [ ] **URGENT — next-auth `5.0.0-beta.31` → `beta.32`** via a proper auth pipeline (full e2e gate, MFA user): clears 2 critical + 1 high Auth.js advisories in `@auth/core` (GHSA-xmf8-cvqr-rfgj uncaught exception on malformed Bearer header, GHSA-7rqj-j65f-68wh email-normalizer homoglyph bypass, GHSA-x445-f3h2-j279 OAuth state/nonce/PKCE cookies not provider-bound). Outside the pinned range, so `npm audit fix` can't take it. Then remove `continue-on-error` from the CI audit step — found during 2026-08-09 pre-push
- [ ] **Emailed one-time code as an alternative second factor** — the operator's actual "super simple" ask. TOTP is exactly what older members struggle with; the durable email queue already exists, so this needs no new dependency. Design question: per-user choice, or per-congregation? — `docs/work-log/2026-08-18-two-factor-policy.md` Phase 6
- [ ] Move the per-congregation 2FA toggle out of the platform admin shell into the congregation's own settings page, once any church-facing admin UI exists — same work-log
- [ ] **P0.5 — Design foundation + per-organization brand architecture** (operator: foundational, sooner rather than later). Merges the deferred design work with S12–S14: a brand token contract where a congregation's real colour is derived into contrast-safe ramps (never painted raw), curated type pairings, logo handling with a dark variant, and the un-brandable surface list. Also carries P0.5's original scope — migrate 7 hand-rolled tables and 8 hand-rolled buttons to primitives, regenerate `alert-dialog.tsx`, rule on the `radius` remap and the shadcn-registry `radix-ui` umbrella import (F-B1), decide dark-mode strategy, and reconcile `docs/ui-standards.md`'s 562 lines against real primitives. **Needs its own Phase 1** — accessibility depth and a real design direction, neither of which an architect should invent. **Blocks P1 and P3** — `docs/work-log/2026-08-18-backbone-and-org-sites.md` S12–S14
- [ ] **P11 — Restructure `/developer` as a real internal portal** (operator, 2026-08-19: **internal only**, and **after the design foundation**). Today it is three stacked sections behind `is_platform_admin`, with its own `developer.css` that imports none of the app's tokens. Rebuild it as a portal shell — sidebar navigation, search, guides sitting alongside the generated reference — keeping the gate exactly where it is, because a schema browser plus a permission catalog is a map of the application. First real content is the material that already exists: data model, isolation model, the invariants, how to run it.
  **Folded in — the page is blind to half the schema.** Structure comes from `getTableConfig()` at request time and descriptions from `pg_description` live, so both auto-update; but Drizzle knows nothing about functions, triggers, or RLS policies, and the page never queries `pg_proc` / `pg_trigger` / `pg_policies`. For presby that is the half carrying the invariants — 13 `presby_*` functions, every FORCE RLS policy, the roll-freeze and derived-roster triggers. Reading them live in the same pattern `loadDescriptions()` already uses would let the page **show** which functions are `SECURITY DEFINER` (`pg_proc.prosecdef`) — exactly the F26 property — and derive most of the hand-maintained invariants array at `src/lib/dev-docs.ts:320` instead of maintaining it.
  **Also:** `docs/schema-design.md`'s ER diagrams are a committed copy needing `npm run docs:erd`, unlike `/developer/erd` which is live — belongs in the ship-time housekeeping cluster (Rule 14). **Depends on P0.5** (the portal is a large new surface and `developer.css` is already orphaned from the token contract). **A public developer portal — docs, guides, API reference — is deliberately NOT this pipeline**: there is no public API today (only NextAuth, the Resend webhook, and two `CRON_SECRET` cron routes), and public docs sitting behind a login is the wrong trust boundary. It becomes its own pipeline when an API and an audience exist.
- [ ] Public-readiness furniture before flipping the repo open: `SECURITY.md` (vulnerability reporting), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` — none exist; LICENSE (MIT) does
- [ ] Configure `NEON_API_KEY` + `NEON_PROJECT_ID` repo secrets to activate e2e CI (optional: `ANTHROPIC_API_KEY` for Claude PR review); watch the first live run of both workflows (pinned Neon action versions unverified until then) — enforcement batch residual

- [ ] Fable review D1: `src/instrumentation.ts` + Sentry (free-tier) stub + thin `src/lib/log.ts` wrapper, in teaching-comment style — `docs/reviews/2026-08-09-fable-external-review.md`
- [ ] Fable review D2: migrate legacy `assignRoleAction`/`removeRoleAction` to `ActionResult` + feature gate + validated IDs; bless zod (or small parse helper) as the validation pattern
- [ ] Fable review D3: README deployment section (Vercel setup, cron registration, `db:migrate` vs `db:push` on deploy) + add `CRON_SECRET`/Turnstile/seed vars to the README env table
- [ ] Fable review B2: acceptance-criteria section (EARS-style) in `docs/work-log/_template.md` Phase 1, checked off row-by-row in Phase 5, verified in Phase 6
- [ ] Fable review B3: SessionStart hook printing `slug | phase | status` for open work-logs (machine-readable pipeline state; would have caught the two stale-Pending Phase 6 rows)
- [ ] Fable review E1–E4 process batch: `/test` bank opt-in for release-class merges + soften pre-push HARD STOP to confirm · Phase 6 skippable-with-notation for Polish class · demote CLAUDE.md capability map to pointer + pre-push map-version-vs-package.json check · legitimize "process-harvest mode" in the Classification table
- [ ] Fable review E5 **(partly closed 2026-08-18)**: `tools:` frontmatter now declared on all nine agents — analyst/architect/qa read-only, implementers keep write (`docs/work-log/2026-08-18-agent-tool-restrictions.md`). Still open: document or vary the all-sonnet model choice (adversarial phases are the candidates for a stronger tier); widen full-stack-developer's charter or push the split
- [ ] Fable review D4: reconcile `components/ui/` vs CLAUDE.md "shadcn primitives" claim + Rule 2's nonexistent `Dialog` — ship the implied primitives or correct the docs
- [ ] **P0.5 design-foundation carry-overs from P0 slice B** — decide once whether to adopt the `radix-ui` umbrella package (the current shadcn registry emits `import { Slot } from "radix-ui"`; P0 hand-rewrote it to `@radix-ui/react-slot` to keep "zero new runtime deps", and every future `shadcn add` will do the same); whether to remap Tailwind's `rounded-sm/md/lg/xl` onto `--radius` (deliberately skipped in P0 — it would resize every existing page); regenerate the hand-written `alert-dialog.tsx`; rewrite `docs/ui-standards.md`'s hand-rolled button examples against `<Button>` — `docs/work-log/2026-08-18-backbone-and-org-sites.md` Phase 4 slice B, findings F-B1/F-B2
- [ ] Security/code punch batch (small, one pipeline): `escapeHtml()` on `newEmail` in `changeEmail` email body (L2) · `checkRateLimit` on `changePassword` (L1, open since 05-17) · UUID-validate `userId`/`roleId` in assign/removeRoleAction (L3) · `crypto.timingSafeEqual` for `CRON_SECRET` in both cron routes (L4) · delete dead `prepareEnrollment` + orphaned `PENDING_TTL_MINUTES` in `(account)/account/2fa/actions.ts` — sources: `docs/reviews/2026-07-11-security.md`, `2026-07-11-code.md` — **M5 closed 2026-08-18**: those four exports were deleted with the duplicate self-enrolment surface; the replacement action is gated on `ADMIN_TWO_FACTOR` with an M5 regression test
- [ ] Unit test for `loadEnv()` in `scripts/feedback-check.mjs` — QA recommended it during the feedback-dev-loop loop-back but it was never filed — retro 2026-07-11 #5
- [ ] Bump `eslint` → 10.x + `eslint-config-next` → 16.2.10+ together (now unblocked); branch-test TypeScript 6.0 (not 7.x — typescript-eslint) — `docs/reviews/2026-07-11-dependencies.md`

## Backlog

- [ ] Fable review C2: package the `.claude/` process layer as a Claude Code plugin (versioned `plugin.json`, marketplace-installable) — candidate successor to fork-and-copy + `upstream-sync` diffing
- [ ] Fable review C3: move auth/server-action rules into path-scoped `.claude/rules/*.md` to relieve CLAUDE.md load
- [ ] Fable review C5: test-tampering ratchet (commit failing tests before implementation, tests frozen during Phase 4) + evaluate mutation testing as a future `check:*` tripwire
- [ ] Fable review D5 nits: `fileURLToPath` in `functionality-map.mjs`/`check-audit-coverage.mjs` (Windows) · parameterize `stats-escape.mjs` `--since` (30d window vs 14d retro cadence double-counts)
- [ ] Fable review F8: escape-rate alarm sentence in tech-lead.md (post-merge % rising two retros running → propose a named tripwire) · state branch-protection/PR-required posture for `main` in CLAUDE.md · one-line-per-decision index atop `docs/decisions.md` · add deployment-engineer's "Pre-Deploy" section stub to `_template.md`
- [ ] Batch-bump routine low-risk deps (Radix, Tailwind patch, React types, Resend, otplib, lucide, tsx, Playwright, Vitest) in one PR — deps 2026-07-11
- [ ] Watch for `drizzle-kit@1.0.0` stable (resolves esbuild GHSA-67mh-4wv8-2f99; treat as major-version project with Neon branch smoke) — deps 2026-07-11; Next 16.3.0 taken 2026-08-09 (resolved the bundled-postcss CVEs; 48/48 e2e)
- [ ] Consider a `db.transaction(`-with-neon-http grep tripwire (mirror of check:sql-date) — the BUG-1 class; retro 2026-07-11 #2. **Largely moot for the app connection since the F28 driver switch** (neon-serverless supports transactions); close deliberately or re-scope to any remaining neon-http call sites — `docs/work-log/2026-08-18-stale-test-guards.md`
- [ ] Schema comment on `emailQueue` pointing at `RawQueueRow`/`fromRaw()` in `src/lib/email/queue.ts` so future columns don't silently skip the atomic-claim path — code 2026-07-11
- [ ] ADR for the "text, not pgEnum" status-column convention (or add DB CHECK constraints) — security 2026-07-11 (observational)
- [ ] Next release slot: run a standalone test-coverage sweep (don't rely on incidental Phase 5 numbers) — retro 2026-07-11 #6
- [ ] Harvest candidate: huddleup's `scripts/cadence-check.mjs` — SessionStart hook that computes overdue reviews and prints only the delta, replacing the manual read-log-and-compute ritual at session start — spotted during the 2026-07-12 functionality-map harvest
- [ ] Remaining OPEN items from the starter-contribution triage (C3/C4 QA gates, C7/C8 process docs, A7/A8 deploy ordering, D2/D3 CI+cron, E2 `dialog.tsx` + E3/E4 primitives, F2 usage heartbeat, …) — work via `docs/reviews/2026-07-01-starter-contribution-triage.md`; specs in `docs/starter-contributions/README.md`

- [ ] Reconcile `.env.example` as the canonical env-var inventory — `DATABASE_URL_UNPOOLED`, `AUTH_TRUST_HOST`, `UPSTASH_REDIS_REST_URL/TOKEN`, `TRUST_PROXY_HEADERS`, `RATE_LIMIT_DISABLED` referenced elsewhere but absent from it; verify each against actual `process.env` usage — follow-up from `docs/reviews/2026-07-11-agent-instruction.md`

- [ ] Admin lock-state detail page — add lock badge + unlock action to `/admin/users/[id]` — follow-up from `docs/work-log/2026-07-02-admin-lock-visibility.md` Phase 3 scope decision
- [ ] `(password-reset)` error boundary — same gap as `(email-verify)`; unauthenticated token-lookup route, no error.tsx — tracked from `docs/work-log/2026-07-02-email-verify-error-boundary.md` Phase 1 Pass 5
- [ ] Tier 4 utilities on demand (csvCellSafe, ssrf-guard, magic-bytes, maskEmail, settings store, ConfirmDialog, iconKey nav, cf-connecting-ip, route-table 2FA gate, …) — harvest Tier 4
- [ ] TOTP enrolment e2e — requires either a seeded deterministic TOTP secret (security risk — see routing feature option (c) rationale, e2e-auth-infra work-log Phase 2 Ruling 7) or external authenticator integration; deferred until a safe pattern is designed

## Done

- [x] 2026-08-18 — Stale test replica retired: `(auth)/totp/actions.test.ts` deleted with the `/home` → `/launch` fallback change; its javascript:/data:/protocol-relative assertions now live in `src/lib/auth/safe-callback.test.ts` against the real function — `docs/work-log/2026-08-18-backbone-and-org-sites.md` (P0 slice C1)
- [x] 2026-08-18 — Agent tool grants: `tools:` on all nine agents; analyst/architect/qa read-only and return their section for the orchestrator to record; QA re-chartered verification-only (test authorship → implementers); stale e2e briefing in `qa.md` corrected — SHIP IT — `docs/work-log/2026-08-18-agent-tool-restrictions.md`
- [x] 2026-08-18 — 2FA: duplicate self-enrolment surface at `/admin/2fa` replaced by a per-congregation policy page; `organization_settings.require_two_factor` + `presby_two_factor_required()` (SECURITY DEFINER, F26); M5 closed by deletion; dead `prepareEnrollment` removed; TOTP config crash made graceful — 39 RLS assertions, 434 unit, 49 e2e — SHIP IT — `docs/work-log/2026-08-18-two-factor-policy.md`
- [x] 2026-08-18 — E2E owns its test users (DECISION-032): fixtures hardcoded in `e2e/support/users.ts` and provisioned by globalSetup; all `SEED_*` vars and every `test.skip()` credential guard deleted; **48/48 now run with zero configuration** (was 6 passed / 42 silently skipped) — SHIP IT — `docs/work-log/2026-08-18-e2e-owns-its-users.md`
- [x] 2026-08-18 — Deck removed (DECISION-031, supersedes D005): `deck/` deleted with its four npm scripts, the CLAUDE.md re-render rule, and the `/pre-push` staleness check — SHIP IT — `docs/work-log/2026-08-18-remove-deck.md`
- [x] 2026-08-18 — Identity pass: README rewritten for presby; landing page, global nav, admin shell, email From, and TOTP issuer de-startered; `.env.example` gained the three missing required connection strings + `DEV_ALLOWED_ORIGINS`; 9 agent files re-pointed — SHIP IT — `docs/work-log/2026-08-18-identity-pass.md`
- [x] 2026-08-18 — Stale test guards repaired: deleted the obsolete neon-http `db.transaction()` guard (moot since the F28 driver switch) and re-pointed the cron-maintenance assertion at the F29 roll reconcile instead of a bare call count; suite green again at 424 — SHIP IT — `docs/work-log/2026-08-18-stale-test-guards.md`
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

## presby — In Flight

Full context in `docs/STATE.md`. Findings referenced as F<n> live in
`docs/schema-design.md` §17–19.

### Next
- [ ] Roll UI — the read path is complete and nothing surfaces it
- [ ] Playwright in the loop — three bugs were phone-only and invisible to
      `curl` + `tsc` + `next build`
- [ ] `ltree` on `organizations.path` (still `text`) + ancestry trigger
- [ ] Seed derived groups at org creation (F16) — the officer trigger raises
      until this exists
- [ ] Remove the `ADMIN_ROLE` wildcard (invariant 6). Bounded, not removed
- [ ] Photo storage service + database-backed blob table for `people.photo_key`
      (DECISION-030): tenant-scoped blob table with the composite key, an
      adapter interface, and a review rule that no page/action reads the blob
      table directly. Cloud-storage adapter deferred until scale demands it (F13
      accepted knowingly)
- [ ] Household-grouped transfer claim flow (F20)

### Decisions open for the user
- [ ] The name. `/personalize-starter` is un-run; the DB role, SQL functions and
      migrations say `presby`, `package.json` still says `claudecode-nextjs-starter`
- [ ] D9 sequencing — **deferred 2026-08-18: congregation (Phase 1) and
      presbytery (Phase 2) are both important; neither is subordinate.** Nothing
      is live yet, so there is no forcing function. Revisit when the Roll UI has
      to pick an audience — that is the first build that cannot stay neutral
- [ ] A separate private repo for versioned private material. `private/` is
      untracked scratch only

### Not designed yet
Ledger and giving (requirements pass needed — `../westervillelions` is the
starting point, not the answer), events, worship, check-in, sites, tickets.
Meetings/dockets/minutes deferred (D3); `minute_reference` is free text until
then.
