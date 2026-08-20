# Functionality Map

A scannable inventory of everything built, so a session
knows what exists without re-reconning. **Version `0.10.0` · surveyed 2026-08-19.**

This is a MAP, not documentation — one line per capability, with the primary file as
a jump-off point. When it drifts from reality, fix it (Workflow Rule 14). Entries
marked **presby:** are this project's own domain; the rest is the platform shell
inherited from the starter.

---

## Index (short — for the session hook)

- **presby: schema** — 41 domain tables in `src/lib/db/domain/`: organizations (hierarchy, `platform_status`), people + memberships + identifiers, roll actions + transfer certificates, ordinations + officer terms, groups (derived session/diaconate), authorization (permissions, roles, grants, commissions, delegations), privacy/consent/demographics, SASR scaffold.
- **presby: isolation** — `presby_app` NOBYPASSRLS + FORCE RLS on every tenant table; bespoke policies for the global person tables; `withOrgContext()` verifies membership before setting the org GUC; two connections (`db` vs `getPlatformDb()`).
- **presby: authorization** — `presby_effective_permissions(person, org, as_of)` with four arms and provenance; `presby_user_organizations()` for the org list (filters nothing — policy lives in the `userOrganizations` / `availableOrganizations` wrappers); `presby_membership_is_active()` for `withOrgContext`'s pre-context gate; `presby_two_factor_required()` for per-church 2FA at sign-in (all SECURITY DEFINER, F26); `src/lib/authz.ts`.
- **presby: org portal** — `/o/<slug>` tenant-facing pages beyond the landing stub: directory (`/o/<slug>/directory`, `directory.view` permission, privacy-filtered, gated `org_portal.directory`), role administration (`/o/<slug>/admin/roles`, `role_grants.manage` permission, gated `org_portal.roles`) — grant/revoke/view *existing* `role_grants` rows against *existing* `app_roles`, creates neither — and support tickets (`/o/<slug>/tickets*`, `/o/<slug>/feedback`, `tickets.file` permission, gated `org_portal.tickets`). All three flags seeded off. First tenant-facing capabilities a congregation's own staff — not a platform admin — can act on. `src/lib/directory.ts`, `src/lib/role-grants.ts`, `src/lib/tickets.ts`, `src/app/(org)/o/[slug]/{directory,admin/roles,tickets,feedback}/`.
- **presby: roll** — `presby_roll_as_of`, `_counts_as_of`, `_changes`, `presby_reconcile_current_roll`, `presby_roll_cache_drift`; officer registers `presby_officer_roster` / `_history`.
- **presby: developer reference** — `/developer` index, `/developer/tables/<name>`, `/developer/erd/<module>`, `/developer/schema.json`. Generated from the schema + Postgres `COMMENT ON`.
- **presby: public sites** — `/site/<slug>` (P3, SHIP WITH NOTES) — anonymous, git-staged per-congregation websites. Content lives in a private `site-<slug>` GitHub repo per congregation; CI (inherited from the public `presby-site-kit` dependency) validates and stages a structured bundle, then POSTs it to `POST /api/sites/ingest`, authenticated via GitHub Actions OIDC (hardcoded RSA-SHA256 verification, no callout to GitHub at request time). `organization_sites` has no `presby_app` grant at all — reachable only through `presby_published_site()` (SECURITY DEFINER), which collapses never-provisioned/suspended/nonexistent/inactive into one indistinguishable zero-row 404. `site_contact_messages` — anonymous submissions, honeypot + IP/slug rate limit, surfaced on the existing `/o/<slug>/tickets` page gated `tickets.file`. Gated `sites.public_render`, **seeded off — no real congregation site is provisioned yet**; the mechanism is fully built and tested (unit, real-Postgres integration, e2e), not the rollout. `src/lib/sites.ts`, `src/app/api/sites/ingest/route.ts`, `src/app/(public)/site/[slug]/`, `docs/work-log/2026-08-20-public-sites.md`.
- **presby: NOT built** — ledger/giving, events, worship, check-in. Within schema/authorization: roll UI (read path complete, unsurfaced), officer-term management, new-role/new-permission creation, the cross-org commission/delegation UI, and a tenant-facing audit reader (DECISION-067, deferred pending a FORCE-RLS `audit_events` projection) remain unbuilt.
- **presby: post-login routing** — `/launch` computes a nine-row destination matrix and forwards; `/orgs` chooser (never auto-forwards); `/no-organization`; `/o/<slug>` org shell in the `(org)` group. Slug is immutable, DNS-label constrained. Named access-denied that is byte-identical across platform statuses (DECISION-040/044).
- **presby: header controls** — avatar menu (identity: account, `/admin` and `/developer` when entitled, sign out) and organization switcher (context), split on Google's model. `src/components/shared/{avatar-menu,org-switcher,global-nav}.tsx`.
- **Design system** — `cn()`, `components.json`, generated primitives (button/card/badge/dropdown-menu/table/input/label/textarea/alert-dialog), closed token contract, `.dark` class scheme (not media-query). **Per-organization branding is live in `(org)`** (P0.5, gated `ui.brand_theming`): operator sets a congregation's colour/logo/type pairing at `/admin/organizations`; `(org)` emits it as a `:root`-scoped `<style>` reaching Radix portals; DECISION-040 denial pages and every other route stay platform-default by construction. `(public)/site/<slug>` (anonymous) emission is live but flag-gated off (`sites.public_render`) — see presby: public sites.
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

## Org portal (`(org)` group, tenant-facing content)

- Directory — `/o/<slug>/directory`, membership-scoped, privacy-filtered read (`person_privacy` field-level hides applied in SQL). Gated `org_portal.directory` flag + `directory.view` permission. `src/lib/directory.ts`, `src/app/(org)/o/[slug]/directory/page.tsx`
- Role administration — `/o/<slug>/admin/roles`, grant/revoke/view existing `role_grants` rows for existing `app_roles`; no role or permission creation. Self/other-escalation subset check + self-lockout guard on revoke, both server-side inside one transaction. Gated `org_portal.roles` flag + `role_grants.manage` permission (bootstrap role `stated_clerk`, DECISION-066). `src/lib/role-grants.ts`, `src/app/(org)/o/[slug]/admin/roles/`
- Support tickets — `/o/<slug>/tickets*`, `/o/<slug>/feedback`; file/track/reply on a ticket, baseline-member feedback on-ramp promotable into a ticket by the `tickets.file` role-holder. Categories (`change_class`) + area + priority, PNG/JPEG/WEBP/PDF attachments (10MB, magic-byte sniffed), five email-notification triggers. Gated `org_portal.tickets` flag (one flag, both surfaces) + `tickets.file` permission (bootstrap role `support_contact`, DECISION-080). No autonomous AI actor — resolution is an ordinary human-plus-Claude-Code engineering task. `src/lib/tickets.ts`, `src/lib/tickets-notifications.ts`, `src/app/(org)/o/[slug]/{tickets,feedback}/`.

## Brand / per-organization theming (P0.5)

- Closed token contract — brandable/bounded/platform partition, legal contrast pairs (D1–D6), type scale, curated type pairings; zero runtime imports. `src/lib/brand/contract.ts`
- Ramp generator — seed hex → independently-derived light + dark token sets + `adjustments[]`, property-tested against every OKLCH seed, versioned (`BRAND_TOKEN_VERSION`). `src/lib/brand/generate.ts`
- Storage — `organization_brands` (one row per org, FORCE RLS, no public grant ever) + `organization_brand_history`; set/neutralise by the platform operator only (`org.branding`'s tenant-facing editor is still P1-blocked). `src/lib/db/domain/org.ts`
- `(org)` emission — **live**, gated by `ui.brand_theming`. `(org)/o/[slug]/layout.tsx` resolves the caller's own membership, reads the org's brand (null-safe: flag off / not a member / never branded all render the platform default), and `<BrandTokens>` emits both colour schemes as one `:root`-scoped `<style>` element — reaches Radix portals, not just the layout's own DOM subtree. `src/lib/brand/read-org-brand.ts`, `src/components/brand/brand-tokens.tsx`
- Un-brandable by construction — the DECISION-040 access-denied/ended/404 pages and every route outside `(org)`/`(public)/site/<slug>` never receive brand tokens; enforced by `scripts/check-brand-scope.mjs` (E1–E3, C1–C2 all live tree-wide as of `a8`/`c4`).
- Font pairing — per-org heading/body face resolved to self-hosted `next/font/google` faces; applied to `(org)`'s body text today (heading-face differentiation not yet wired — see `docs/TODO.md`). `src/lib/brand/fonts.ts`
- `(public)/site/<slug>` emission (anonymous visitors) is **live but flag-gated off** — see Public websites (P3) below.

## Public websites (P3)

- `/site/<slug>` — anonymous per-congregation website, gated `sites.public_render` (seeded off; no real congregation site provisioned yet). `getPublishedSite()` reads through `presby_published_site()` (SECURITY DEFINER) — the only tenant-connection path to `organization_sites`, which carries no `presby_app` grant at all. Enumeration-safe: never-provisioned, suspended, nonexistent, and inactive-org all collapse to the same zero-row 404, proven at the SQL, unit, integration, and e2e layers. `src/app/(public)/site/[slug]/`, `src/lib/sites.ts`.
- `presby-site-kit` (`github.com/chenson42/presby-site-kit`, public, `v0.0.1-stub`) — the shared rendering shell, pinned by git tag in `package.json`. Renders staged pages via `renderSiteBundle()`; a component allowlist (no arbitrary JS from content repos) is the enforced boundary.
- Ingest — `POST /api/sites/ingest`, called by a content repo's own CI on push to `main`. GitHub Actions OIDC only (hardcoded RSA-SHA256, `iss`/`aud`/`repository_owner`/`ref`/`job_workflow_ref` all checked, never trusts the token's declared `alg`), then the `sites.public_render` flag (503 if off — checked *after* auth, so a stolen token can't probe the flag), then bundle validation + per-image magic-byte sniffing, idempotent on commit sha. `src/app/api/sites/ingest/route.ts`, `src/lib/sites-ingest-auth.ts`.
- Contact form — anonymous `site_contact_messages` (FORCE RLS, composite tenant key), honeypot + IP/slug rate limit, read side on the existing `/o/<slug>/tickets` page gated `tickets.file` (DECISION-089). `src/lib/sites.ts`.
- Admin — `/admin/sites` provisions a site (repo string, `FEATURES.ADMIN_ORGANIZATIONS`) and sets status (provisioning/live/suspended).
- Open before real rollout: `site-<slug>` content-repo visibility (public vs. private) is undecided and matters for the enumeration-safety guarantee once real repos exist; Vercel build-sandbox and payload-size verification for the git dependency are unverified — `docs/TODO.md`.

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
- Organizations — list + "still on default palette" (OQ4) filter, detail page sets/previews/neutralises a congregation's brand (seed colour, logo, type pairing), audited (`ORG_BRAND_SET`/`ORG_BRAND_NEUTRALIZED`). `admin/organizations/page.tsx`, `[id]/page.tsx`, `[id]/actions.ts`, `[id]/brand-form.tsx`
- Support-ticket triage — `/admin/tickets`, cross-org queue filterable by status/area/priority, status state machine, assign/reclassify/area/priority controls, operator reply. Reads via `getPlatformDb()` (tickets is FORCE RLS, unlike `feedback`). Gated `FEATURES.ADMIN_TICKETS`. `admin/tickets/page.tsx`, `[id]/page.tsx`, `actions.ts`

## Auth backend & edge

- NextAuth 5 config — Google OAuth + credentials, JWT sessions with roles/features/2FA claims. `src/auth.ts`, `src/lib/auth/config.ts`, `session-projection.ts`
- Cached auth — `cache()`-wrapped `auth()`/flags (one SELECT per request). `src/lib/auth/cached-auth.ts`
- Safe callback — same-origin path check, `/launch` fallback (pure string function; it does not learn about org slugs). `src/lib/auth/safe-callback.ts`
- Lockout — 5 failures → 15-min DB lock, enumeration-safe, OAuth-exempt. `src/lib/auth/lockout.ts`
- Sign-in gate + local-login flag — credentials gating incl. `auth.local_login` OAuth-only mode. `src/lib/auth/sign-in-gate.ts`, `local-login.ts`
- Edge route gate — auth + active status everywhere, 2FA on `/admin/*` and `/o/*`; deliberately no membership check on `/o/*` (DECISION-035). Edge runtime; must not import `@/lib/db`. `src/proxy.ts`

## Platform lib (`src/lib/`)

- Permissions — `FEATURES` catalog (`admin.dashboard/users/flags/release_notes/feedback/audit/email_queue/whats_new/organizations/two_factor/tickets`) + `hasFeature()`; `SUPPORT_OPERATOR_ROLE` bundle (`admin.tickets`+`admin.feedback`, narrower than admin, DECISION-080). `permissions.ts`
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
