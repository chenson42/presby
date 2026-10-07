# Deploying PresbyPortal

Operational record of what is actually deployed, and what stands between here
and a real go-live. **Verified against Neon and Vercel on 2026-09-24.**

Steps marked **[YOU]** need a human with real credentials at a dashboard; steps
marked **[CLAUDE]** can be done directly once the `[YOU]` step before them is.

> **This file replaces an earlier version that was wrong in its central claim.**
> That version described production as a separate Neon project, `presby-production`
> (`withered-bird-71608444`), created because the session believed it had no
> access to the dev database's Neon account. That belief was mistaken, **and no
> such project exists** — a `list_projects` on 2026-09-24 does not return it.
> Nothing was ever deployed against it. The real production database is described
> below.

---

## The database — verified

**Production** is the `presby` Neon project's `production` branch. There is no
separate production project.

| | Value |
|---|---|
| Neon project | `presby` — `polished-snow-90038485` (aws-us-east-2, PG 18) |
| Production branch | `production` — `br-wild-band-ax96gv09` (default, primary) |
| Production endpoint | `ep-flat-hat-axx3qe5f` — **active**, serving live traffic |
| Development branch | `development` — `br-super-dawn-axfi55p6`, forked from production at `2026-08-31T15:47:32Z` |
| Development endpoint | `ep-lingering-meadow-axnarpsq` — **archived** since 2026-09-14 |

`.env.local` points at the **development** endpoint (`ep-lingering-meadow-axnarpsq`),
so local work does not touch the live database. That branch is archived; Neon
un-archives on connect, so expect a slow first connection rather than a failure.

Production holds exactly two organizations: `fpcw` (First Presbyterian Church of
Westerville) and `presbytery-of-scioto-valley`, with `fpcw` parented under it.
See `docs/STATE.md` for the 2026-08-31 cleanup that got it there.

### Legacy Neon project — do not delete

`presby-portal` (`silent-cloud-95940340`, ~39 MB, last compute active
2026-08-31) is **legacy but holds data the operator wants to port**. Leave it
alone until that port happens.

---

## ⚠️ Vercel — the account problem

The operator has **lost reliable access to the `community-collective` Vercel
team**, which holds every presby deployment to date. CLI read access still works;
administration should not be relied on.

Verified state inside that team:

| Project | Serves | Env vars |
|---|---|---|
| `presby` (`prj_7ycljGeqGm0voUu52XjcM5S6ky87`) | `presby.vercel.app`; **also has `presbyportal.org` + `www` attached**; this repo's `.vercel/project.json` links here | **zero** |
| `presby-portal` (legacy) | `presbyportal.org` + `www.presbyportal.org` | the working set |

Because `presby` has no environment variables and the live site returns 200 with
real content, **the legacy `presby-portal` project is what is actually serving
`www.presbyportal.org`.** `docs/STATE.md`'s account of resetting `DATABASE_URL`
et al. on `presby` does not match what is deployed.

`presbyportal.org` is registered at a **third-party registrar with GoDaddy
nameservers** (`ns07/ns08.domaincontrol.com`), so DNS is controlled independently
of the Vercel account. The apex 308-redirects to `www`; `www` is canonical.

### ⚠️ Security: the production `presby_app` password is a dev-style string

Found 2026-10-07 while migrating: the `presby_app` role on the `production`
branch authenticates with a `dev-only-…`-prefixed password, the shape the CI
composite action and the dev recipe mint for throwaway branches. It is the
live tenant-connection credential. Rotate it (Neon → Roles → reset password)
**after** the Vercel environment that holds it is under your control and can
be updated in the same change — rotating first takes the site down.

### ⚠️ Security: live credentials in an account we don't control

The legacy `presby-portal` deployment holds **valid `presby_app` credentials for
the live production database**, inside a team with impaired access.

**Remediation, in this order — the order matters:**

1. **[YOU]** Create a new Vercel project in a team you control
   (`personal-01ca24ed`, `kindwaynp`, or a fresh team — `vercel teams ls` lists
   them). `vercel link` this repo to it.
2. **[CLAUDE]** Set the environment variables (table below) on the new project.
3. **[YOU]** Repoint `presbyportal.org` DNS at the new project. The domain may
   first need releasing from `community-collective`, which needs access to that
   team — if that is impossible, a new hostname is the fallback.
4. **[CLAUDE]** Rotate the Neon `presby_app` password, invalidating the
   credentials held by the abandoned deployment.

**Do not rotate first.** Rotation breaks whatever is currently serving
`presbyportal.org`. That site is presently only a demo — FPCW's real site is still
WordPress at `westervillefirstpresbyterian.org` — so the outage is acceptable, but
it should be deliberate rather than a surprise.

### ⏰ [YOU] Before 2026-10-01: set this project's Node.js version to 22.x

Vercel disables Node 20 on its platform on that date, and this repo has been on
Node 22 since `11ab488` (`.nvmrc`, `package.json`'s `engines.node`). Set it in
Vercel Project Settings on whichever project ends up serving `presbyportal.org`
(see the account remediation above) — the dashboard setting is not tracked in
this repo, so only the operator can change it. Full tracking: `docs/TODO.md`'s
Deployment & production section.

---

## Migrations

**A Vercel deploy does not run database migrations.** Applying migrations to a
target database is a separate, deliberate step — run it by hand after a deploy,
never assume it happened as part of one.

**Production was migrated through `drizzle/0053` on 2026-10-07** (previously at
`0042`). How it was done, so the next one is a copy, not a rediscovery:

1. **Snapshot first.** A Neon snapshot of `production` was taken before any
   statement ran (`pre-migration-0043-0053-2026-10-07`,
   `snap-orange-math-axbat01u`); `restore_snapshot` is the rollback.
2. **Diff the live catalog against `development` before applying** — tables,
   views, functions, columns, triggers, policies. Production carried four
   leftovers development no longer had (`sasr_reports`,
   `congregation_statistics.supersedes_publication_id`,
   `group_types.organization_id`, `organization_settings.pcusa_pin`) and 843
   duplicate global `group_types` rows; every one is handled by a statement
   inside `0043`–`0053` (verified by grep before running), and the row counts
   on the objects being dropped were checked (all zero).
3. **Hand-apply with `psql`, not `drizzle-kit migrate`.** Production's
   `drizzle.__drizzle_migrations` ledger records only the first ten migrations
   (the same partial-ledger state `docs/testing.md` describes for the dev
   database), so `db:migrate` would try to re-run `0010`. Command, per file,
   strictly in journal order:
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -q -f drizzle/00XX_*.sql`
   — one transaction per file, **except `0047`, which carries its own
   `begin;`/`commit;` block and runs without `-1`**. None of `0043`–`0053`
   contains a statement that cannot run inside a transaction block (checked).
4. **Verify:** the catalog diff against `development` is empty; 61 tables carry
   `FORCE ROW LEVEL SECURITY` and none has RLS without FORCE;
   `MIGRATE_DATABASE_URL=<prod> npx tsx scripts/check-schema-parity.ts` reports
   0 failing; every pre-existing row count is unchanged (2 organizations, 395
   people, 68 users, 18 memberships, 628 audit events); the backfills landed
   (1 open affiliation, 2 name-history rows, 4 SASR form versions, 6 global
   `group_types`).
5. **Seed the catalogs:** `scripts/seed.ts` run with the production
   `DATABASE_URL` (`presby_app`) and `PLATFORM_DATABASE_URL` (owner) exported
   and every `SEED_*`/`INITIAL_ADMIN_EMAILS` variable empty — it is
   idempotent (`onConflictDoNothing`) and only added the two flag rows that
   post-dated production's last seed. It never flips an existing flag.

The ledger is still ten rows on both `development` and `production`. Until it
is reconciled (a small, separate task: insert the `0011`–`0053` rows with
drizzle's hash of each file), the apply command for either database stays the
`psql` form above; `db:migrate` remains the from-empty command CI uses.

---

## CI's database secrets

Two GitHub Actions workflows (`.github/workflows/db.yml`,
`.github/workflows/e2e.yml`) run the database-backed test suites — the 765+
`describe.skipIf(!hasDb)` tests, the 520-assertion `scripts/test-rls.sql`
isolation suite, and the Playwright e2e suite — against a per-run ephemeral
Neon branch. Both skip cleanly (a `::notice::`, reported as a skipped check,
never a green no-op) until two repository secrets exist:

| Secret | Where to find it |
|---|---|
| `NEON_API_KEY` | console.neon.tech → Account settings → API keys |
| `NEON_PROJECT_ID` | the `presby` Neon project → Settings → General |

**[YOU]** Add both under Settings → Secrets and variables → Actions on this
repository. Nothing else is required — both workflows generate every other
credential (AUTH_SECRET, the TOTP key, `presby_app`'s per-run password) fresh
on each run. Once both secrets exist, `db-tests` and `e2e` flip from skipped
to running on the next push or PR.

**The ephemeral branch always forks the pinned `development` branch, never
the implicit default.** An unpinned `parent:` on `create-branch-action` forks
the project's primary branch, which is `production` — the two real
congregations' data above, and (per "Migrations" below) not even migrated to
the current schema. Each workflow's `neon-ci-db` composite-action call writes
`parent: development` literally; see DECISION-150 and `docs/testing.md`'s
"Continuous integration" section for the full reasoning. The job creates a
fresh database inside that branch and never opens the parent's own `neondb`,
so no row that predates the CI run can appear in a log or an uploaded trace.

---

## Environment variables

| Variable | Source |
|---|---|
| `DATABASE_URL` | `production` branch, `presby_app`, pooled |
| `APP_DATABASE_URL` | same as `DATABASE_URL` (used by the RLS test script) |
| `PLATFORM_DATABASE_URL` | `production` branch, `neondb_owner`, pooled — corrected 2026-09-26; stale since DECISION-136 (2026-09-24) fixed `getPlatformDb()`'s actual role everywhere else. `presby_platform` is `rolcanlogin = false` and has never authenticated anywhere. |
| `MIGRATE_DATABASE_URL` | `production` branch, owner, direct |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TOTP_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `AUTH_URL` | the canonical `www` host — **not** the apex, which 308s and would bounce `/api/auth/*` |
| `NEXT_PUBLIC_APP_URL` | same as `AUTH_URL` |
| `INITIAL_ADMIN_EMAILS` | The operator's own sign-in address. Deliberately **not** written down here — this repo is public, and `npm run check:secrets` treats a real address in a tracked file as a finding. Read it from the deployed environment. |
| `CRON_SECRET` | generated; the email-queue worker needs it |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | **deferred** — see below |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | **deferred** — see below |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | **deliberately unset.** `.env.example` says this credentials-login bypass is not suitable for production |
| `SITES_INGEST_OIDC_AUDIENCE` / `GITHUB_SITES_ORG` | needed before a real `site-fpcw` content ingest can authenticate |

Optional: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`,
`UPSTASH_REDIS_REST_URL`/`_TOKEN` (falls back to in-memory rate limiting).

---

## Deferred by operator decision (2026-09-23)

These are **not** oversights.

- **Google OAuth** — presby will support it, but it is not a priority. Until
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set, and with the credentials-login
  bypass deliberately unseeded, **nobody can sign in to production, including the
  operator.** Accepted for now; production serves public pages only. Redirect URI
  when it happens: `https://<canonical host>/api/auth/callback/google`.
- **Resend** — deferred until go-live. Password-reset and verification mail will
  queue and not deliver until `RESEND_API_KEY` is set.
- **First real `site-fpcw` ingest** — `organization_sites.last_ingested_commit_sha`
  for `fpcw` is still a scratch placeholder, and the two OIDC variables above are
  unset, so an ingest would fail auth.

## Not applicable yet

**Church data import.** There is no import feature and, by decision, there will
not be a general one — onboarding imports are ad-hoc per congregation. FPCW's is a
three-source merge (Church360, Vanco, fpcw-directory) scheduled for the cutover.
See `docs/reviews/2026-09-23-fpcw-feature-match.md` Track K.

**Custom domains.** FPCW's public site must live at
`westervillefirstpresbyterian.org` from day one of cutover, and
`organization_sites` has no custom-domain support. Track F of the same document.
