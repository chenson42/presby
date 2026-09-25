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

**A Vercel deploy does not run database migrations.** `npm run db:migrate`
against a target database is a separate, deliberate step — run it by hand
after a deploy, never assume it happened as part of one. As of this writing,
`production` has **not** been migrated to the latest schema; `development` has.

---

## Environment variables

| Variable | Source |
|---|---|
| `DATABASE_URL` | `production` branch, `presby_app`, pooled |
| `APP_DATABASE_URL` | same as `DATABASE_URL` (used by the RLS test script) |
| `PLATFORM_DATABASE_URL` | `production` branch, `presby_platform`, pooled |
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
