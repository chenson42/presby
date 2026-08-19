# Functionality Map

A scannable inventory of everything built, so a session
knows what exists without re-reconning. **Version `0.10.0` · surveyed 2026-08-19.**

This is a MAP, not documentation — one line per capability, with the primary file as
a jump-off point. When it drifts from reality, fix it (Workflow Rule 14). Entries
marked **presby:** are this project's own domain; the rest is the platform shell
inherited from the starter.

---

## Index (short — for the session hook)

- **presby: schema** — 37 domain tables in `src/lib/db/domain/`: organizations (hierarchy, `platform_status`), people + memberships + identifiers, roll actions + transfer certificates, ordinations + officer terms, groups (derived session/diaconate), authorization (permissions, roles, grants, commissions, delegations), privacy/consent/demographics, SASR scaffold.
- **presby: isolation** — `presby_app` NOBYPASSRLS + FORCE RLS on every tenant table; bespoke policies for the global person tables; `withOrgContext()` verifies membership before setting the org GUC; two connections (`db` vs `getPlatformDb()`).
- **presby: authorization** — `presby_effective_permissions(person, org, as_of)` with four arms and provenance; `presby_user_organizations()` for the org list (filters nothing — policy lives in the `userOrganizations` / `availableOrganizations` wrappers); `presby_membership_is_active()` for `withOrgContext`'s pre-context gate; `presby_two_factor_required()` for per-church 2FA at sign-in (all SECURITY DEFINER, F26); `src/lib/authz.ts`.
- **presby: roll** — `presby_roll_as_of`, `_counts_as_of`, `_changes`, `presby_reconcile_current_roll`, `presby_roll_cache_drift`; officer registers `presby_officer_roster` / `_history`.
- **presby: developer reference** — `/developer` index, `/developer/tables/<name>`, `/developer/erd/<module>`, `/developer/schema.json`. Generated from the schema + Postgres `COMMENT ON`.
- **presby: NOT built** — no UI for any of the above; ledger/giving, events, worship, check-in, sites, tickets not designed.
- **presby: post-login routing** — `/launch` computes a nine-row destination matrix and forwards; `/orgs` chooser (never auto-forwards); `/no-organization`; `/o/<slug>` org shell in the `(org)` group. Slug is immutable, DNS-label constrained. Named access-denied that is byte-identical across platform statuses (DECISION-040/044).
- **presby: header controls** — avatar menu (identity: account, `/admin` and `/developer` when entitled, sign out) and organization switcher (context), split on Google's model. `src/components/shared/{avatar-menu,org-switcher,global-nav}.tsx`.
- **Design system** — `cn()`, `components.json`, four generated primitives (`button`, `card`, `badge`, `dropdown-menu`), expanded token set. Light mode fixed — `@theme` inside a media query had made every visitor see dark (v0.10.0).
- **Public / Auth** — landing page, sign-in (Google OAuth + credentials, Turnstile-guarded, lockout-aware), TOTP 2FA verify + trusted device, forgot/reset password, email-change verify landing, access-pending.
- **presby: post-login router** — `/launch` decides and redirects (nine-row matrix as a pure function), `/orgs` chooser (org cards + Platform block, never auto-forwards), `/no-organization` zero-org funnel, `/o/<slug>` org landing stub in the new `(org)` group with the four-way miss response (enter / ended / denied / 404).
- **Member** — `/home` platform shell (greeting, roles/features, what's-new card, daily feedback prompt) — no longer the landing target, `/whats-new` full list, feedback submit/snooze/opt-out actions.
- **Account (self-serve)** — profile name, email change + re-verification, password change, per-user TOTP enrolment/manage at `/account/2fa`, delete-account skeleton, permanent feedback form.
- **Admin (`/admin`)** — users + roles (+ lock badge/unlock, 2FA reset), feature flags, release-notes docs viewer, per-congregation 2FA policy, audit viewer, feedback triage, what's-new CRUD, email-queue viewer + retry.
- **Auth backend** — NextAuth 5 config, cached session, safe callbackUrl, lockout, sign-in gate, local-login flag, session projection; edge gate `src/proxy.ts` (admin + 2FA).
- **Platform lib** — permissions (`FEATURES` + `hasFeature`), flags (`isFlagEnabled`, cached), `recordAudit()`, TOTP crypto + pending enrolment, rate limiting, request-ip, Turnstile, email queue (persist-first + retry + Resend webhook) with `escapeHtml`.
- **API / Cron** — NextAuth routes, Resend delivery webhook, `CRON_SECRET`-gated email-queue worker + daily maintenance (token GC).
- **Flags** — `demo.new_dashboard`, `auth.local_login` (OAuth-only switch), `auth.require_2fa` (install-wide 2FA master switch; per-congregation policy is `organization_settings.require_two_factor`, not a flag) — both auth flags fail-open.
- **Dev-loop tooling** — SessionStart hooks (feedback count, functionality-map index, cadence check), pre-push PreToolUse gate, commit-msg hook (+ `Work-Log:` trailer) + escape-rate stats, `check:audit` + `check:sql-date` tripwires, CI (typecheck/build/tests/commit-grammar + secret-gated Neon-branch e2e + opt-in Claude PR review + dependabot), seed script, 11 e2e suites, fork-sync skills (`/upstream-sync` + `/downstream-sync`) + contribution-kit specs, `AGENTS.md` shim.

---

## Public / Auth

- Landing page — public marketing stub; never redirects a signed-in user (DECISION-034). `src/app/page.tsx`
- Post-login router — `/launch`, pure `computeDestination()` over nine rows. `src/app/launch/page.tsx`, `destination.ts`
- Organization chooser — `/orgs`, cards carry name and type only, no membership language (DECISION-039). `src/app/(member)/orgs/page.tsx`
- Not-connected page — `/no-organization`, copy differs for an org still being set up. `src/app/no-organization/page.tsx`
- Organization shell — `/o/<slug>`, `(org)` group; `withOrgContext` only, `getPlatformDb()` forbidden. `src/app/(org)/o/[slug]/`
- Sign-in — Google OAuth + credentials, Turnstile, lockout-aware, safe `callbackUrl` → `/launch`. `src/app/(auth)/signin/page.tsx`, `actions.ts`
- TOTP verify — code entry + trusted-device cookie; enrolment redirect two-hop (proxy → `/totp` → `/account/2fa`). `src/app/(auth)/totp/page.tsx`, `actions.ts`
- Forgot/reset password — request link + consume token (hashed at rest, enumeration-safe). `src/app/(password-reset)/forgot-password/page.tsx`, `reset-password/page.tsx`, `actions.ts`
- Email-change verify — token landing with error boundary. `src/app/(email-verify)/account/verify-email/[token]/page.tsx`
- Access-pending — authenticated, no roles; writes `ACCESS_DENIED` audit on bounce. `src/app/access-pending/page.tsx`

## Post-Login router

- `/launch` — the single post-authentication target. Reads the org list + `users.is_platform_admin`, calls `computeDestination()`, redirects; renders only the database-unreachable state. `src/app/launch/page.tsx`, `destination.ts`
- `/orgs` — the chooser: one card per enterable organization (name + type, **no membership language**), a separate Platform block (Admin / Developer), a notice for organizations still being set up. Never auto-forwards. `src/app/(member)/orgs/page.tsx`
- `/no-organization` — five-state zero-org funnel (already has access / being set up / not a tenant / access ended / never connected) plus two doors. `src/app/no-organization/page.tsx`
- `/o/<slug>` — org landing stub + the four-way miss response; `resolveOrgContext()` then `assertOrgAccess()`. `src/app/(org)/o/[slug]/page.tsx`, `org-states.tsx`, `error.tsx`, `not-found.tsx`

## Member

- Home — the platform shell, no longer the post-login destination (see Post-Login router). Greeting, roles/features summary, global nav (conditional Admin link), what's-new card, daily feedback prompt card (UTC-read/local-write, DECISION-023). `src/app/(member)/home/page.tsx`, `feedback-prompt-card.tsx`
- What's-new — full entry list, newest-first. `src/app/(member)/whats-new/page.tsx`
- Feedback actions — submit / snooze / opt-out (rate-limited; per-user prompt state, one column per upsert). `src/app/(member)/feedback/actions.ts`

## Account (self-serve)

- Account page — display name, email change (re-verify), password change, delete skeleton, permanent feedback form. `src/app/(account)/account/page.tsx`, `actions.ts`
- Per-user 2FA — QR enrolment, verify, recovery codes, disable. `src/app/(account)/account/2fa/page.tsx`, `actions.ts`

## Admin (`src/app/(admin)/admin/`)

- Dashboard — subpage links; `demo.new_dashboard` flag demo. `admin/page.tsx`
- Users — list + role assignment, lock badge + unlock (audited). `admin/users/page.tsx`, `users/[id]/page.tsx`, both `actions.ts`
- Feature flags — toggle + rollout percent. `admin/flags/page.tsx`, `actions.ts`
- Docs — release-notes markdown viewer (`docs/release-notes/vX.Y.md`). `admin/docs/page.tsx`
- 2FA policy — per-congregation `require_two_factor` toggles + "required but not enrolled" list; platform connection (RLS hides orgs from the tenant connection); gated on `admin.two_factor` (DECISION-033). `admin/2fa/page.tsx`, `actions.ts`, `policy-toggle.tsx`
- Audit viewer — filter by action/actor, pure RSC. `admin/audit/page.tsx`; helpers `src/lib/audit-page-helpers.ts`
- Feedback triage — status new→triaged→done/declined; renders bodies as plain text (hostile-content invariant). `admin/feedback/page.tsx`, `actions.ts`
- What's-new CRUD — list+create, edit, delete; HTML-reject validation. `admin/whats-new/page.tsx`, `[id]/page.tsx`, `actions.ts`
- Email-queue viewer — send status, delivery status, retry. `admin/email-queue/page.tsx`, `actions.ts`

## Auth backend & edge

- NextAuth 5 config — Google OAuth + credentials, JWT sessions with roles/features/2FA claims. `src/auth.ts`, `src/lib/auth/config.ts`, `session-projection.ts`
- Cached auth — `cache()`-wrapped `auth()`/flags (one SELECT per request). `src/lib/auth/cached-auth.ts`
- Safe callback — same-origin path check, `/launch` fallback (pure string function; it does not learn about org slugs). `src/lib/auth/safe-callback.ts`
- Lockout — 5 failures → 15-min DB lock, enumeration-safe, OAuth-exempt. `src/lib/auth/lockout.ts`
- Sign-in gate + local-login flag — credentials gating incl. `auth.local_login` OAuth-only mode. `src/lib/auth/sign-in-gate.ts`, `local-login.ts`
- Edge route gate — auth + active status everywhere, 2FA on `/admin/*` and `/o/*`; deliberately no membership check on `/o/*` (DECISION-035). Edge runtime; must not import `@/lib/db`. `src/proxy.ts`

## Platform lib (`src/lib/`)

- Permissions — `FEATURES` catalog (`admin.dashboard/users/flags/release_notes/feedback/audit/email_queue/whats_new`) + `hasFeature()`. `permissions.ts`
- Flags — `isFlagEnabled()` env toggles + rollout, request-cached. `flags.ts`
- Audit — `recordAudit()` (actor, IP, user-agent) + `AUDIT_ACTIONS` catalog. `audit.ts`; IP extraction `request-ip.ts`
- TOTP — AES-GCM encrypt/decrypt + verify (`AUTH_TOTP_ENCRYPTION_KEY`); pending-enrolment store. `two-factor.ts`, `totp-pending.ts`
- Rate limiting — in-memory sliding window (Upstash env swap-in). `rate-limit.ts`
- Turnstile — endpoint-level CAPTCHA verify, no-op until keyed. `turnstile.ts`; widget `src/components/shared/turnstile.tsx`
- Email — durable queue (persist-first, backoff retry, Resend delivery webhook), `escapeHtml()`. `email/queue.ts`, `send.ts`, `escape-html.ts`
- DB — Drizzle + Neon; schema is source of truth; unique-violation helper. `db/schema.ts`, `db/errors.ts`
- Shared UI — `<FormattedDate>` (TZ-safe, ESLint-enforced), `<FeedbackForm>`, global nav, fresh-recovery-codes. `src/components/shared/`

## API / Cron / Webhooks

- NextAuth handlers. `src/app/api/auth/[...nextauth]/route.ts`
- Resend delivery webhook — HMAC-verified (DECISION-028: webhooks verify own signatures under `api/webhooks/`). `src/app/api/webhooks/resend/route.ts`
- Email-queue worker — retry loop, `CRON_SECRET` Bearer. `src/app/api/cron/email-queue/route.ts`
- Daily maintenance — expired-token GC (password-reset, email-verify, pending TOTP). `src/app/api/cron/maintenance/route.ts`

## Feature flags (seeded)

- `demo.new_dashboard` — demo flag gating an admin dashboard element.
- `auth.local_login` — credentials on/off (OAuth-only mode); fail-open.
- `auth.require_2fa` — org-wide 2FA requirement; fail-open.

## Dev-loop tooling

- SessionStart hooks — feedback count (count only, never body content) + functionality-map short index + overdue-review cadence check. `scripts/feedback-check.mjs`, `scripts/functionality-map.mjs`, `scripts/cadence-check.mjs`
- Pre-push gate — PreToolUse hook blocks in-session `git push` unless `/pre-push` stamped a HEAD-keyed marker (Rule 5 mechanized). `scripts/pre-push-gate.mjs`
- Commit standards — prefix + `fix:` trailers + `Work-Log:` trailer on feat/fix, enforced by git hook locally and re-validated on PRs in CI; 30-day escape-rate report. `scripts/commit-msg.mjs`, `validate-commit-range.mjs`, `stats-escape.mjs`, `install-hooks.sh`
- Tripwires — audit coverage of mutations, `sql<Date>` ban. `scripts/check-audit-coverage.mjs`, `check-sql-date.mjs`
- CI — typecheck/lint/build/tripwires/`npm audit`/unit tests + commit-grammar job on PRs; e2e on an ephemeral Neon branch (secret-gated); opt-in Claude PR review (secret-gated); dependabot grouped updates. `.github/workflows/ci.yml`, `e2e.yml`, `claude-review.yml`, `.github/dependabot.yml`
- Cross-tool shim — `AGENTS.md` points non-Claude agents (Cursor/Codex/Jules) at CLAUDE.md and the must-honor rules. `AGENTS.md`
- Seed — roles, `FEATURE_CATALOG`, demo + auth flags, seed users (admin / member / MFA-admin). `scripts/seed.ts`
- E2E — 11 Playwright suites (auth, admin, member, security headers, TZ dates). Fixture users are hardcoded in `e2e/support/users.ts` and provisioned by globalSetup (DECISION-032) — no env vars, no conditional skips; cached storageState + DB isolation guard + rate-limiter precondition. `e2e/`
- Fork sync — `/upstream-sync` pulls starter changes into a fork (14 d cadence); `/downstream-sync` surfaces fork improvements to contribute back (30 d; self-detects the canonical repo and exits). `.claude/skills/upstream-sync/`, `.claude/skills/downstream-sync/`
- Contribution kit — ~40 origin→fix→verification specs contributed by the huddleup.health fork (PR #3); live status in the 2026-07-01 triage review. `docs/starter-contributions/README.md`

## Schema highlights (`src/lib/db/schema.ts`)

Auth/foundation: `users`, `accounts`, `sessions`, `roles`, `userRoles`, `features`, `roleFeatures`, `featureFlags`, `auditEvents`, TOTP tables (+ pending enrolments), `emailVerificationTokens`, `passwordResetTokens`, lockout state. Product/ops: `feedback`, `feedbackPromptState`, `whatsNewEntries`, `emailQueue`.
