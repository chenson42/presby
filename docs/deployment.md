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

> **Update 2026-10-19 (supersedes the account story below).** Operator access to
> the `community-collective` team was restored and the **legacy `presby-portal`
> project was deleted**. The `presby` project is now connected to GitHub: it
> **auto-deploys `main`** and serves `www.presbyportal.org`. **Preview builds are
> skipped** by the project's *Ignored Build Step* setting (a dashboard setting,
> not tracked in this repo), so no preview deployments are built and none exists
> to receive the provider variables below. The table in this section is
> **historical**. What the restoration does not resolve stays open in
> `docs/TODO.md`'s Deployment & production section, notably rotating the
> production `presby_app` password (still a dev-style string) and porting the
> legacy Neon project's data.

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
WordPress at its own existing domain — so the outage is acceptable, but
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
| `CRON_SECRET` | generated; the email-queue worker, the daily maintenance job and the giving worker (`/api/cron/giving`) all need it — each answers 503 without it |
| `NEXT_PUBLIC_PLATFORM_HOSTS` | **custom domains.** Comma list of the hosts that ARE the platform, e.g. `presbyportal.org,www.presbyportal.org`. **Build time** (`NEXT_PUBLIC_`, inlined into the proxy): set it in the Production scope **before** the build that ships custom domains; changing it needs a redeploy. `*.vercel.app` is always a platform host. Any other host the project serves is treated as a church's custom host and answers the neutral 404 until it is a verified, `live` domain. See "Custom domains" below. |
| `DOMAINS_PROVIDER` | **custom domains.** Unset (the production default) = *unconfigured*: attaching is "temporarily unavailable" and nothing can reach `live`. `vercel` = the Vercel REST adapter. **Production scope only.** Never `fake` (see below). |
| `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | **custom domains. PENDING: not created yet.** A token **scoped to the `presby` project only**, plus the project and team ids. Read only when `DOMAINS_PROVIDER=vercel` in Production; with the provider set and either of the first two missing, the sweep records a configuration error and alerts the operator (it does not fall back to "unconfigured"). Production scope only. |
| `STRIPE_SECRET_KEY` | **online giving only**, production only — a *restricted* key, never a full-access one. See "Online giving (Stripe)" below |
| `STRIPE_WEBHOOK_SECRET` | **online giving only** — the signing secret of the one webhook endpoint. See below |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | **deferred** — see below |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | **set 2026-10-19** (Production). The key belongs to PresbyPortal's **own Resend team** (its own Pro subscription), where `presbyportal.org` is the verified sending domain — never a team shared with other products, because the key is full-access (the Track F mail increment provisions church domains with it) and full access reaches every domain in its team. From: `PresbyPortal <noreply@presbyportal.org>`. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | **deliberately unset.** `.env.example` says this credentials-login bypass is not suitable for production |
| `SITES_INGEST_OIDC_AUDIENCE` / `GITHUB_SITES_ORG` | **set** (Production; corrected 2026-10-25). A site repo's `PRESBY_OIDC_AUDIENCE` repository variable must equal `SITES_INGEST_OIDC_AUDIENCE` exactly. `site-pasturechurch` carries both repository variables; `site-fpcw` carries neither, so its ingest still fails auth |
| *test/dev only, never in Vercel (build-asserted in Production):* `DOMAINS_PROVIDER=fake`, `DOMAINS_DNS_PROVIDER=fake` (`doh` is the default and the only production value), `DOMAINS_FAKE_STATE_FILE`, `DOMAINS_ALLOW_RESERVED_TLDS=1` | e2e and local development |

Optional: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`,
`UPSTASH_REDIS_REST_URL`/`_TOKEN` (falls back to in-memory rate limiting).

For online giving, `NEXT_PUBLIC_APP_URL` has a second job: it is the **only**
source of the URLs handed to Stripe (Checkout success/cancel, Connect
onboarding return/refresh) and must be the canonical `https` origin. Anything
else — unset, `http`, a malformed value — makes giving "unavailable" rather
than guessing from a request header.

---

## Online giving (Stripe)

Written in Batch 3a of `docs/work-log/2026-10-15-online-giving.md`. Everything
here is **operator work that cannot be done from the repository**: the code is
finished and tested against signed fixture bodies (`docs/testing.md` → "The
signed-event replay harness"), but no Stripe account has ever been involved.
The "test-mode smoke" below is the first time real Stripe objects meet this
code, and it is yours to run.

### What presby holds, and what that is worth

One **platform** Stripe account with Connect enabled; each congregation owns its
own connected account (Accounts v2, full Dashboard, Stripe collects fees and
carries losses — presby takes no application fee and no liability). Presby
stores only the connected account's `acct_…` id. The **platform API key** is the
one secret of consequence: it can act on every connected account, so it is a
*restricted* key limited to the calls `src/lib/giving/providers/stripe/client.ts`
makes, set in the **production** environment only — never in CI, a preview, or
`.env.local` on a machine that touches the production database.

The webhook signing secret is lower-stakes (it can forge events, not move money)
but is still production-only; the replay harness uses the non-key-shaped
literal `giving-e2e-signing-secret`.

### Restricted-key permissions (the production key contract)

Create the key at Dashboard → Developers → API keys → *Create restricted key*.
Each permission below is the *exact* set; grant nothing else. For the four rows
marked **Connect**, the key-creation flow has a separate per-permission choice
for "when accessing connected accounts" (restricted-api-keys docs, step 4) — it
must be set for those rows.

| Call (in `client.ts`) | Endpoint | Permission | Pattern |
|---|---|---|---|
| `createConnectedAccount` | `POST /v2/core/accounts` | `v2_account_storer_write` | platform's own account |
| `createOnboardingLink` | `POST /v2/core/account_links` | `v2_account_storer_write` | platform's own account |
| `retrieveConnectedAccount` | `GET /v2/core/accounts/{id}` | `v2_account_storer_read` | platform's own account |
| `createCheckoutSession` | `POST /v1/checkout/sessions` | `checkout_session_write` | **Connect** (`Stripe-Account`) |
| `retrieveBalanceTransaction`, `listBalanceTransactionsForPayout` | `GET /v1/balance_transactions` | `balance_read` | **Connect** |
| `retrieveEvent` (replay of a purged body) | `GET /v1/events/{id}` | `event_read` | **Connect** |
| `retrieveInvoiceForPayment` (renewals) | `GET /v1/invoices/{id}` | `invoice_read` | **Connect** |

**Not granted, deliberately:** Customers, Charges, Payment Intents,
Subscriptions, the Customer portal, Webhook endpoints, Refunds, Payouts,
Transfers, and anything in the v1 `connected_account_*` family. A test pins that
`client.ts` reaches exactly the six SDK resources the table covers.

*Unconfirmed until the smoke:* whether the v2 account endpoints accept a
restricted key in practice. If Stripe refuses it, run production on an
unrestricted key, log it as a finding, and leave `client.ts` as it is — the
allowlist module is the control either way.

### Creating the webhook endpoint

Dashboard → Developers → Webhooks → *Add destination*, once per mode (a live
destination and a test/sandbox destination have different secrets):

1. **Events from: Connected accounts.** *Not* "Your account" — presby consumes
   events about the congregations' accounts, whose top-level `account` field says
   which congregation. (Accounts v2 also emits "thin" v2 events on the *Your
   account* scope; presby does not subscribe to them and needs no second
   destination.)
2. **API version: `2026-09-30.endive`.** Pin it when creating the destination. A
   body at any other version is dead-lettered (`normalize_api_version`) rather
   than parsed, because the field layouts differ.
3. **URL:** `https://<canonical host>/api/webhooks/stripe` (the same host as
   `NEXT_PUBLIC_APP_URL`).
4. **Events — exactly these eighteen, nothing else:**
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `invoice_payment.paid`, `charge.succeeded`, `refund.created`,
   `refund.updated`, `charge.dispute.created`,
   `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`,
   `charge.dispute.closed`, `customer.subscription.deleted`,
   `invoice.payment_failed`, `payout.paid`, `payout.failed`,
   `account.updated`, `account.application.deauthorized`.
   Any other type is acknowledged and dropped before storage, so subscribing to
   more costs bandwidth for nothing. (`constants.test.ts` fails if this list and
   `HANDLED_EVENT_TYPES` ever differ.)
5. Copy the destination's **signing secret** into `STRIPE_WEBHOOK_SECRET` in
   Vercel (production environment only) and redeploy.

The route answers **503** while `STRIPE_WEBHOOK_SECRET` is unset (Stripe keeps
retrying, so nothing is lost while you finish), **400** for a bad or stale
signature, **500** if the database is down (Stripe retries), and one identical
**200** for everything else — including an account presby doesn't know, which is
deliberately indistinguishable from success.

`vercel.json` runs `/api/cron/giving` every five minutes with `CRON_SECRET`. It
processes events whose in-request processing was cut off, retries events that
were parked (a refund that arrived before its gift), purges stored bodies 90 days
after they finish, and expires abandoned checkout intents.

### Key rotation

*API key (`STRIPE_SECRET_KEY`).* Create a new restricted key with the table
above → set it in Vercel production → redeploy → verify (a connected
congregation's *Refresh status* succeeds, or `GET /api/cron/giving` shows no new
`stripe_*` failures) → revoke the old key in the Dashboard. Between the redeploy
and the revoke both keys work, so there is no outage. If the old key may have
leaked, revoke it first and accept a short window in which gifts cannot start
(donors see "temporarily unavailable"; nothing already paid is affected).

*Webhook secret (`STRIPE_WEBHOOK_SECRET`).* In the destination, *Roll secret*
with an expiry of 24 hours: for that window Stripe signs each delivery with both
secrets and the SDK accepts a match on either. Set the new secret in Vercel,
redeploy, and let the old one expire. If it leaked, roll with immediate expiry
and accept that deliveries fail (Stripe retries them) until the redeploy lands.

### Operator test-mode smoke — blocked on the platform account

**Prerequisite (Operator Q1):** a test-mode (sandbox) platform Stripe account with
Connect enabled. None exists yet; everything below is unverified until it does.
Run against `development` or a preview, never production data.

1. Set `STRIPE_SECRET_KEY` (a *test* restricted key built from the table) and
   `STRIPE_WEBHOOK_SECRET` (from a test-mode destination created as above) and
   `NEXT_PUBLIC_APP_URL`. Turn `org_portal.giving` on for a fixture congregation;
   have a user holding `giving.manage` complete 2FA.
2. **Connect:** *Connect Stripe* → onboarding on `accounts.stripe.com` with Stripe's
   test data → return page. Expected: the status reads `active` after *Refresh
   status*. Confirm in the logs that `account.updated` **reached the Connect
   endpoint** for a v2 account (if not, the manual refresh is the fallback and
   this is a finding).
3. **Things the code assumed from the SDK's typings and that this step proves:**
   (a) the account create body is accepted exactly as sent;
   (b) the onboarding link is accepted **without** a `configurations` list — the
   Phase 3 research read it off a docs page, but stripe-node 23.0.0's CHANGELOG
   records it as removed in this API version. If Stripe answers
   `configs_must_match_to_use_account_links`, add the field in
   `providers/stripe/onboarding.ts` (one place, with a test);
   (c) Checkout accepts `allowed_payment_method_types` (the pinned version
   removed `payment_method_types`) and an `expires_at` 31 minutes out;
   (d) a restricted key with only the table above can do all of the above.
4. **Gifts:** a one-time card gift (`4242 4242 4242 4242`), a one-time ACH gift
   (Stripe's test bank, including the delayed-success and failure test
   accounts), a monthly gift, a refund and a dispute raised from the Dashboard,
   and a payout. Each should end `applied` on the platform health page; a gift
   shows its fee after `charge.succeeded`; the refund/dispute appear as
   reversals; the payout appears as a settlement.
5. **Capture one real response:** `GET /v2/core/accounts/{id}` for the connected
   account, sanitize it (invented names, `example.invalid` addresses, fake ids),
   and commit it under `src/lib/giving/providers/stripe/testing/fixtures/` with
   a case in `status.test.ts`. That closes the "payouts-enabled path and the
   requirements shape" question that Phase 3 left open. Run `npm run
   check:secrets` over the new file first (the script scans tracked files; stage
   it, or call `checkSecretsPii()` on its path).
6. **Billing-portal probe (Stripe confirmation 3):** attempt a
   `POST /v1/billing_portal/sessions` for a direct-charge customer with the
   `Stripe-Account` header. Record the result in the work-log. v1 builds no
   portal either way; if it works, a follow-up can add it for confirmed-linked
   members.
7. **Disputes:** one dispute is one reversal, keyed on the dispute's id. Money
   leaving is recorded by whichever of `charge.dispute.created` (any status but
   a `warning_*` inquiry) or `charge.dispute.funds_withdrawn` arrives first; the
   other changes nothing. An inquiry records nothing until it escalates and the
   funds are withdrawn. Money coming back is recorded by whichever of
   `charge.dispute.funds_reinstated` or `charge.dispute.closed` with status
   `won` arrives first, the same way; a lost dispute leaves the reversal in
   place. In the smoke, raise a test dispute, confirm exactly one reversal
   appears whichever event lands first, then close it as won and confirm one
   reinstatement.

8. **Give (Batch 4):** with the connection `active`, one fund offered online,
   payouts attested and the give page turned on, open `/site/<slug>/give` and,
   signed in as a plain member with no giving key, `/o/<slug>/giving/give`.
   - A one-time $25 card gift: the browser lands on `checkout.stripe.com` (the
     client re-asserts the host); Checkout shows the fund's online name; the
     return page reads *confirming* and then *received* once the webhook has
     applied it. In the database the intent goes `created` → `open` →
     `completed`.
   - *Cover the fees* on a card gift: Checkout's line says it includes the fee,
     and the total equals the page's preview to the cent (the TS and SQL
     formulas are pinned together, but only Stripe's own number proves the
     fee the congregation actually pays).
   - A bank (ACH) gift ends on *bank pending* until Stripe reports the debit;
     a monthly gift creates a subscription and the return page says so.
   - Submit the same form twice quickly (or double-click): one intent, one
     session; the second is told it was already started.
   - **`NEXT_PUBLIC_APP_URL` decides where Checkout sends the donor back.** Set
     it to the canonical origin and confirm the cancel link returns to the give
     page. (A request's `Host` header is never used.)
   - Look at the response headers on the give routes: `Content-Security-Policy`
     (enforced) as well as the report-only one, with no console violation.
     Production emits no `'unsafe-eval'`; development adds it for React.

### Pre-deploy runbook: the giving migrations and turning giving on

Added at integration (v0.34.0). Production is at `0053` as of 2026-10-07.

1. **Order.** `0054` first (the calendar migration, with its F133 pre-ship
   count), then `0055_presby_giving` and `0056_presby_giving_statements`, each
   hand-applied with the `psql ... -1` form in "Migrations" above, strictly in
   journal order. The journal entries for 55 and 56 are in the branch.
   Integrate on `development` first and run `scripts/test-rls.sql` there as
   `presby_app` (expect **927** passes). Snapshot production before applying.
2. **What `0055` does to existing data.** It deletes the `org_portal.giving`
   `feature_flags` row (ON in production behind an inert placeholder), so the
   placeholder tile disappears for everyone at deploy. That is intended; giving
   is now a per-organization toggle, congregations and new worshiping
   communities only, off by default.
3. **Turn giving on per organization, only where wanted**, from
   `/o/<slug>/admin/features`, and **designate the treasurer in the same step**
   (`/admin/organizations/[id]`): until the operator designates one, nobody holds
   a giving key and the admin pages are a dead end. Once a treasurer exists,
   offline gift recording is fully live and real donor data goes into tier-2
   tables, so tell the treasurer that no statement can be issued in production
   until `GIVING_STATEMENTS_ENABLED=1` is set after the CPA review (and before
   January 2027 for 2026 gifts).
4. **The `/give` go-live residual.** Before turning giving on for a congregation,
   check whether its published site already has its own page at `/give`. While
   giving is not live that page renders exactly as before. The moment giving
   goes live, the platform's give page replaces it (and it comes back if giving
   is taken offline). Tell the congregation, and move that content to a
   `/give/<x>` page or to the giving live slot if they want to keep it. A bundle
   page at exactly `/give/return` is always the platform's.
5. **Nothing takes money without keys.** With `STRIPE_SECRET_KEY` unset, the
   treasurer panel says online giving is not enabled on this installation and the
   public and member give forms are unreachable; with `STRIPE_WEBHOOK_SECRET`
   unset the webhook answers 503.

### Go-live checklist (enforced by humans)

- `STRIPE_SECRET_KEY` (restricted, per the table) and `STRIPE_WEBHOOK_SECRET`
  set in **production only**; the webhook destination is *Connected accounts*,
  version `2026-09-30.endive`, the exact eighteen events.
- The restricted key carries **`balance_read` with the "when accessing connected
  accounts" choice set**. Payout reconciliation (Batch 6) reads balance
  transactions on the congregation's account; without the scope every automatic
  payout retries and then dead-letters, and its Payouts row never fills.
- `NEXT_PUBLIC_APP_URL` is the canonical `https` origin; `CRON_SECRET` is set and
  the giving cron shows 200s in the Vercel cron dashboard.
- Upstash (`UPSTASH_REDIS_REST_URL`/`_TOKEN`) and Turnstile configured: the
  in-memory rate limiter is per-instance on Vercel, so the public give form's
  limits are only real with Upstash.
- `auth.require_2fa` is on. (Holding any giving key already forces 2FA through
  the permission, but the platform flag is the backstop for everyone else.)
- The enforced `Content-Security-Policy` header is verified **in a browser** on
  `/site/<slug>/give`, `/site/<slug>/give/return` and the member equivalents,
  with a clean console (Batch 4 ships it; `next.config.ts`, same string as the
  report-only policy, no Stripe origin - `check:giving-boundaries` B7).
- Each congregation's Stripe **payouts are automatic** (attested in-app; manual
  payouts cannot be reconciled), and its Stripe statement descriptor shows the
  congregation's name.
- `GIVING_STATEMENTS_ENABLED` is **unset** until the CPA has ruled on statement
  wording (Batch 5). Nothing issues a statement in production without it.
- Privacy copy discloses the platform account's technical reach at Stripe.
- This section's key-rotation procedure has been read by whoever holds the key.

### When something looks wrong

- *Stripe shows delivery failures with 503:* `STRIPE_WEBHOOK_SECRET` is unset in
  that environment. *With 400:* the secret differs from the destination's, or the
  endpoint's clock/body was altered by a proxy (the route needs the raw body).
- *Events stay `parked`:* normal for a few minutes (a refund before its gift);
  a parked `no_gift`/`no_subscription` event gives up quietly after 24 hours
  (a payment for something other than a gift). Any other parked code is retried
  with back-off and dead-letters after eight attempts.
- *Dead letters* appear as a count on the congregation's giving overview and in
  the platform health page. The code (`over_reversal`, `amount_mismatch`,
  `normalize_api_version`, …) says why; the body is never shown. Replay is an
  operator act and is audited.

---

## Custom domains (Track F, Increment 1: web)

A congregation proves it controls a domain with a TXT record, and the platform
serves its public site there. **Increment 1 ships the mechanism, not the
cutover**, and church email domains (Increment 2) are not built. Design:
`docs/work-log/2026-10-19-custom-domains.md`; decisions 176-182.

### Configuration (Production scope only)

- **Build-time assertion.** A production build **fails loudly** (leaving the
  previous deployment serving) unless `NEXT_PUBLIC_APP_URL` is an `https` URL
  whose host is in the platform-host set, every `NEXT_PUBLIC_PLATFORM_HOSTS` entry
  is a hostname, and none of `DOMAINS_PROVIDER=fake`, `DOMAINS_DNS_PROVIDER=fake`,
  `DOMAINS_FAKE_STATE_FILE` or `DOMAINS_ALLOW_RESERVED_TLDS` is set.
- **`DOMAINS_PROVIDER` semantics.** Unset or any other value: *unconfigured*. A
  church can claim a domain and prove it, but attach waits as "Connecting is
  temporarily unavailable. Your DNS changes are safe to make." and nothing reaches
  `live`. `vercel`: honoured only in the Production environment (a Preview
  deployment can never attach production domains with the shared token) and never
  under `NODE_ENV=test`. **Leave it unset until the acceptance pass below.**
- **Provider variables are Production-only.** Never add `DOMAINS_PROVIDER`,
  `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` or `VERCEL_TEAM_ID` to the Preview or
  Development scopes. Also keep "Expose system environment variables" on, so
  `VERCEL_ENV` is available.
- **No new secret for the liveness probe:** its HMAC is derived from `AUTH_SECRET`.
- **`CRON_SECRET` must be set.** A fourth cron, `/api/cron/domains`, runs every five
  minutes (`vercel.json`); it is trivial on an empty table.
- **Nothing else may be attached to the `presby` project.** Any domain on the
  project other than `presbyportal.org`, `www.presbyportal.org` and the
  `*.vercel.app` URL is a custom host and returns the neutral 404 until verified.
  List the project's domains before the merge deploy.

### The cron host-class log

Each cron (`email-queue`, `maintenance`, `giving`, `domains`) logs one line per run
with `hostClass: platform | custom | invalid` for the host Vercel invoked it on
(the `domains` line is `[cron/domains] {"hostClass": ...}`). Vercel's docs do not say
whether a cron can arrive on a custom domain; the proxy has an exact-path,
bearer-keyed pass-through for the four cron paths so one cannot silently 404, and
the acceptance pass records the class for at least two scheduled runs of each.

### Reattach runbook (the platform moves to a different Vercel project)

Set `VERCEL_API_TOKEN` (scoped to the new project), `VERCEL_PROJECT_ID` and
`VERCEL_TEAM_ID` for it, then run
`npx dotenv -e .env.local -- tsx scripts/domains/reattach.ts` (a dry run that lists
the hosts) and the same with `--apply`. It re-adds every attached, live, lapsed and
parked host idempotently, writes nothing to the database, and stops if the provider
refuses the credentials. Expect a short TLS gap per host; the sweep's probe
re-confirms each within a few ticks. Confirm in `/admin/organizations/domains` that
every host is `live` again.

### Pre-deploy runbook: 0057

Added at integration (v0.35.0). Production is at `0056` once the giving migrations
have been applied; confirm that first (`select to_regclass('giving_funds'),
to_regclass('giving_statements')` both non-null), else apply `0054`-`0056` first.

1. **Apply 0057 before the merge deploys.** Old code tolerates the new column on
   `sites`' published-site read; new code needs it.
2. **Snapshot `production` first** (Neon).
3. **Apply WITHOUT `-1`:**
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0057_presby_org_domains.sql`.
   The file carries its own top-level `begin;` ... `commit;` (around the `DROP` and
   `CREATE` of `presby_published_site`, as `0047` does); under `-1` the inner
   `commit` would end the outer transaction early. It is idempotent, and a failed run
   can simply be repeated.
4. **Verify:** `organization_domains` has RLS **and** FORCE with one
   `tenant_isolation` policy; `presby_published_site` has `search_path = public,
   pg_temp` and an ACL of owner plus `presby_app` only (no PUBLIC);
   `presby_org_serving_canonical_host` is not executable by `presby_app`;
   `domains.manage` is a tier-1 key; existing row counts are unchanged. **Do not run
   `scripts/domains/test-rls-47.sql` on production** (it needs the test helpers);
   run it on `development` as `presby_app` after integration.
5. **Vercel, before the merge build:** `NEXT_PUBLIC_PLATFORM_HOSTS` and an `https`
   `NEXT_PUBLIC_APP_URL` set in Production; `CRON_SECRET` set; none of the
   test-only variables present; the project's domain list checked (above);
   `DOMAINS_PROVIDER` left unset.
6. **After the deploy,** the regression smoke on the platform host: `/`, `/signin`,
   an MFA login through `/launch`, `/home`; `Strict-Transport-Security` includes
   `includeSubDomains` on `presbyportal.org`, `www.presbyportal.org` and the
   `.vercel.app` URL; `/orgs` 308s to `/home`; a published site, a sub-page, an
   image, the sitemap and the contact form still work and still name the platform
   origin.
7. **Org onboarding order** (everything is off per organization by default):
   designate the founding administrator, then a platform admin turns on
   `org_portal.domains` at `/admin/organizations/[id]`, then the claim. Production's
   existing organizations have no founding administrator, so `0057` backfills the
   `domains.manage` key to nobody; the platform admin's on-behalf web claim covers a
   slipped designation.

### Go-live gate (not satisfied)

Increment 1 does **not** make a real church domain safe to point at the platform.
Do not point any real A/CNAME record at Vercel until the acceptance pass has run:
an unattached host would serve Vercel's own error page. The pass needs
`DOMAINS_PROVIDER=vercel` and the project-scoped token above, and an
operator-owned throwaway domain; the steps and what to record are the "Track F
acceptance pass" line in `docs/TODO.md`. The legacy-URL redirect map for the first
cutover is a separate, unbuilt pipeline.

---

## Account invitations (Increment 1)

A platform operator invites an organization's founding administrator or first
treasurer by email; the recipient proves the mailbox with a single-use link and
creates an account or signs in to one. Design:
`docs/work-log/2026-10-21-invitations.md`; decisions 183-189.

### Configuration

Each missing item changes what an invitation can do:

- **`NEXT_PUBLIC_APP_URL`** must be the production `https` origin. The link is
  built only from the platform origin; without it a send refuses
  (`link_origin_unavailable`).
- **`AUTH_TOTP_ENCRYPTION_KEY`** must be set; without it a send is refused, since
  the invitee could not enrol in two-factor.
- **`RESEND_WEBHOOK_SECRET`** must be set, or an invitation stays "Sent" forever and
  never shows "Delivered" or "Bounced".
- **`auth.local_login`** must be on for the invitation page to offer a password
  form (it is read through `isLocalLoginEnabled()`, which fails open).

### Pre-deploy runbook: 0059

Added at integration (v0.37.0). Production is at `0057`; `0058` (Track F mail) is
reserved and unbuilt, so the gap in the numbering is expected. Confirm first:
`select to_regclass('organization_domains')` is non-null and
`select to_regclass('account_invitations')` is null.

1. **Apply 0059 before the merge deploys.** New code reads `account_invitations`
   and calls the two functions; old code ignores them.
2. **Snapshot `production` first** (Neon).
3. **Apply WITH `-1`:**
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0059_presby_account_invitations.sql`.
   Unlike `0057`, this file has **no** top-level `begin;`/`commit;`, so `-1` is what
   makes it atomic. It is idempotent (QA re-applied it twice with only the expected
   "already exists, skipping" notices).
4. **Verify:** `account_invitations` has RLS **and** FORCE with one
   `tenant_isolation` policy; `has_table_privilege('presby_app',
   'account_invitations', p)` is false for SELECT, INSERT, UPDATE and DELETE;
   `presby_app` holds EXECUTE on `presby_preview_invitation(text,uuid)` and
   `presby_accept_invitation(text,uuid,text,text,text)` only, with no PUBLIC
   EXECUTE; the seven functions are `SECURITY DEFINER` with
   `search_path = public, pg_temp`; the three guard triggers are enabled; existing
   row counts are unchanged. **Do not run `scripts/invitations/test-rls-59.sql` or
   `scripts/invitations/seed-dev-invitations.sql` on production** (test helpers and
   fixture tokens); run them on `development` after integration.
5. **On `development`:** apply 0059 the same way, then apply only
   `scripts/invitations/seed-dev-invitations.sql` (the whole `seed-dev.sql` is not
   re-runnable on an already-seeded database: duplicate organization key). Done
   2026-10-21. `scripts/test-rls.sql` as `presby_app` on `development` still stops
   in section 3 at "presbytery: sees only its own members" (3, not 2) because of
   the 2026-10-14 demo-account membership, pre-existing environment drift that the
   comment at that assertion already names. The gate is a from-empty database (the
   `db.yml` recipe: `CREATE DATABASE` on a throwaway branch, `db:migrate`,
   `db:seed`, `seed-dev.sql`, test helpers): **1092 passes, exit 0** (2026-10-21,
   §59 contributing 36). Also run `src/lib/db/fixture-deletable.test.ts` against
   `development`.
6. **After the deploy,** the regression smoke on the platform host (`/signin`, an
   MFA login through `/launch`, `/home`, `/admin/organizations/[id]`), then the
   operator's invitations checklist. Test on a congregation made for testing:
   accepting creates people, memberships and role grants that cannot be deleted,
   and an accepted founding administrator or treasurer blocks a later real
   designation until removed through the role tools. Each recipient address takes
   at most 3 invitations a day across all organizations, so use plus-addresses.

---

## Session approval (Community Increment 2)

Added at integration (v0.41.0). Migrations `0062` and `0063`. Design:
`docs/work-log/2026-10-22-founding-admin-directory.md` (Increment 2);
DECISION-202–206. Production is at `0061`; `0064` went to person emails (below) and Increment 2b
took `0065` (below, "Sign-in invitations and connect at sign-in (0065)").
Confirm first: `select to_regclass('roll_actions')` is non-null and
`select count(*) from information_schema.columns where table_name = 'roll_actions'
and column_name = 'decided_by'` is 0.

### Pre-deploy runbook: 0062, the code, then 0063

1. **Order is the reverse of 0061: `0062`, deploy the code, then `0063`.**
   - Code before `0062` calls functions that do not exist yet.
   - `0063` before the code makes the old approve and deny fail on the removed
     privilege.
   - A code rollback alone does not undo `0063`; use the rollback statements in
     its header (`grant update, delete on roll_actions to presby_app;` and the
     re-created 0061 policy).
2. **Snapshot `production` first** (Neon).
3. **Re-measure before applying.** The design's 2026-10-22 counts predate real
   use, and Increment 1 has been live since 2026-10-23 with the operator testing
   in production. Count, and stop if any of the first two is non-zero:
   - people with more than one pending proposal (`0062` stop-block);
   - `officer_terms` offices outside the nine-value vocabulary (`0062`
     stop-block);
   - congregations without a `session` or `diaconate` group (`0062` seeds them);
   - org-owned `session_member` roles (`0062` leaves an existing one alone);
   - denied or withdrawn `roll_actions` rows lacking `decided_by` or `decided_at`
     (`0063` stop-block).
4. **A duplicate pending proposal has no in-app remedy before this release.** The
   stop-block says "withdraw or deny the extras", but neither exists in
   production before this release and no one holds `roll.approve`. If the
   pre-flight finds one, stop. Resolve it on the owner connection as a minuted
   act, and expect to stamp `decided_by` and `decided_at` by hand before `0063`,
   because no audit row will exist to backfill from.
5. **Apply `0062` WITH `-1`:**
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0062_presby_session_approval.sql`.
   It has no top-level `begin;`/`commit;` (its `begin` lines are `DO` blocks) and
   is idempotent. Then **deploy the code.**
6. **Apply `0063` after the deploy, WITH `-1`:**
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0063_presby_roll_decide_lockdown.sql`.
7. **Verify.**
   - After `0062`: `presby_decide_roll_action` and `presby_withdraw_roll_action`
     are `SECURITY DEFINER` with `search_path = public, pg_temp`, `presby_app`
     holds EXECUTE and PUBLIC does not; the triggers `roll_actions_freeze`,
     `officer_terms_pastor_no_roll` and `group_memberships_reject_derived` are
     enabled; every congregation has a `session` and a `diaconate` group and one
     org-owned `session_member` role.
   - After `0063`: `has_table_privilege('presby_app', 'roll_actions', 'UPDATE')`
     and `'DELETE'` are false, `'SELECT'` and `'INSERT'` true; the insert policy
     `roll_actions_insert_pending_only` allows only pending rows of the seven
     approvable kinds.
   - Existing row counts are unchanged.
   - **Do not run `scripts/session-approval/test-rls-62.sql` on production**
     (test helpers); run `scripts/test-rls.sql` as `presby_app` on merged
     `development` with both migrations applied. Expect only the four
     pre-existing failures noted in the work-log (presbytery members 3 not 2,
     the 2FA definer, the DECISION-152 count, and `46i`); section 62 reports 53
     passes and section 61 reports 34.
8. **After `0062`, the first congregation has the role and an empty Session.**
   Nobody can approve until its administrator records themselves (or a ruling
   elder or pastor) under Officers. Existing waiting proposals then become
   approvable. An elder needs a PresbyPortal account to approve until Increment
   2b ships. Test on a congregation made for testing: decided rows cannot be
   changed or deleted afterward.
9. **Before release, one manual walk on `development` at 360px:** an
   administrator records themselves as a ruling elder starting today, Pending
   approvals flips to decide mode, they approve their own proposal, and the audit
   row carries `selfRecorded` and `selfApproved`; then repeat the read-mode view
   with a propose-only clerk (work-log ship condition 10).

---

## Person emails (several addresses per person)

Added at integration (v0.42.0). Migration `0064`. Design:
`docs/work-log/2026-10-23-person-emails.md`; DECISION-215–219. Production is at
`0063` (v0.41.0 live). Confirm first: `select to_regclass('contact_methods')` is
non-null, and `select count(*) from information_schema.columns where
table_name = 'contact_methods' and column_name in ('created_at', 'ended_at')`
is 0.

### Pre-deploy runbook: 0064, then the code

1. **Order: `0064` first, then deploy the code (ER2c).** The new code reads
   `created_at` and `ended_at`, so code before the schema breaks every Community
   and directory page. In the window between the two, the OLD code against the
   NEW schema fails closed: a mixed-case insert fails the value-shape CHECK, an
   in-place value update is refused by the guard trigger, and a blank-field
   delete fails the revoke. No row is corrupted, and production has no
   `contact_methods` rows at the time of writing. Saving a person's contact
   details can fail for a few minutes in that window.
2. **Snapshot `production` first** (Neon).
3. **Pre-flight, read-only, on production.** Re-count; `0064`'s own stop-block
   re-counts and refuses to run on any violation, and never prints a value.
   Expect 0 for each: bad kind, bad email or phone shape, untrimmed or
   mixed-case emails, unknown subtype, several primaries for one person and
   kind, duplicate address within a person, a person with active email rows and
   no primary. Also record `select count(*) from contact_methods`.
4. **ER2a, on `development` only, BEFORE `0064` runs there.** `0064` re-creates
   `presby_preview_invitation` and `presby_accept_invitation` from the live
   definitions. Diff `pg_get_functiondef` of both on `development` against the
   merged branch's pre-0064 definitions (the `0059` text, as re-created by
   nothing since). They must be identical, or the re-creation would silently
   revert someone else's change. Record the result in the work-log.
5. **Apply `0064` WITH `-1`:**
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0064_presby_person_emails.sql`.
   It has no top-level `begin;`/`commit;` (its `begin` lines are `DO` and
   function bodies) and is idempotent. Then **deploy the code.**
6. **Verify.**
   - `contact_methods` has `created_at` (default `clock_timestamp()`) and
     `ended_at`; the four CHECKs (`contact_methods_kind_check`,
     `contact_methods_subtype_check`, `contact_methods_value_shape`,
     `contact_methods_ended_not_primary`) exist and are validated.
   - Three partial indexes: `contact_methods_one_primary_uq`,
     `contact_methods_person_email_uq`, `contact_methods_email_norm_idx`; the old
     `contact_methods_value_idx` is gone.
   - Both triggers are enabled: `contact_methods_guard_write` and
     `contact_methods_primary_required` (the latter `deferrable initially
     deferred`).
   - `has_table_privilege('presby_app', 'contact_methods', 'DELETE')` and the
     same for `presby_platform` are false.
   - `presby_app` holds EXECUTE on `presby_person_email(uuid, text)` and PUBLIC
     does not; the function is security invoker.
   - `presby_preview_invitation` and `presby_accept_invitation` are still
     `SECURITY DEFINER` with `search_path = public, pg_temp` and their ACLs
     intact (EXECUTE for `presby_app`, none for PUBLIC).
   - Row counts unchanged from step 3.
7. **On `development`** (after step 4): apply `0064`, then
   `scripts/person-emails/seed-dev-person-emails.sql` (also reached through
   `scripts/seed-dev.sql`), then run `scripts/test-rls.sql` as `presby_app`.
   Section 64 is `scripts/person-emails/test-rls-64.sql`. **Do not run the seed
   or the suite on production** (test helpers and fixture people).
8. **Down-path.** There is no rollback file: the migration only adds structure
   and tightens constraints, and the code does not need the old schema. If the
   code must be rolled back, the old code fails closed as in step 1 until it is
   redeployed; do not drop the columns or the guards.

---

## Public events calendar (0067)

Added at integration (v0.44.0). Migration `0067`. Design:
`docs/work-log/2026-10-25-public-events-calendar.md`; DECISION-238-241; findings
F250-F256 (`docs/schema-design-2.md` §2ab). Confirm first, on production:
`select count(*) from information_schema.columns where table_name = 'events'
and column_name = 'website_listed'` is 0. The migration is independent of
`0065` and `0066` (Community 2b and 3a): apply it in whatever order the
branches merge. The journal skips idx 66 on purpose (idx 65 is Community 2b's); do not renumber.

### Pre-deploy runbook: 0067, then the code

1. **Order: `0067` first, then merge and deploy the code.** Every merge to
   `main` auto-deploys production. The new code's `EVENT_COLUMNS` selects
   `events.website_listed`, so with the code live and the column missing every
   events admin page errors. The OLD code against the NEW schema is unaffected
   (it never names the column, the column defaults to false, and the CHECK only
   binds a row that is listed). The migration is additive: one default-false
   column, one CHECK and one `SECURITY DEFINER` function. No table, policy or
   table grant is added. A code rollback is safe.
2. **Snapshot `production` first** (Neon).
3. **Apply `0067` WITH `-1`, as the owner, on the direct endpoint:**
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0067_presby_public_events_calendar.sql`.
   The file is idempotent and has no top-level `begin;`/`commit;` (its `begin`
   is inside the function body).
4. **Verify against the catalog, not the DDL, and diff against `development`.**
   - `events.website_listed` is `boolean`, `NOT NULL`, default `false`; the row
     count and `select count(*) from events where website_listed` (expect 0)
     are unchanged by the migration.
   - `events_website_requires_public` exists, `convalidated` is true, and
     `pg_get_constraintdef` reads `CHECK (((NOT website_listed) OR is_public))`.
   - `presby_public_events_calendar(text)` has `prosecdef` true, `provolatile`
     `s`, `proconfig` `search_path=public, pg_temp`, and owner `neondb_owner`.
   - `proacl` of the function names only the owner and `presby_app`
     (`{neondb_owner=X/neondb_owner,presby_app=X/neondb_owner}`):
     `has_function_privilege` is false for `public` and `presby_platform` and
     true for `presby_app`.
   - `events` still has `relrowsecurity` and `relforcerowsecurity` true and its
     one `tenant_isolation` policy. Table grants are unchanged.
5. **Merge and deploy.** Smoke the events admin page (`/o/<slug>/admin/events`
   for an organization with `org_portal.events` on, or the new-event form) and
   one anonymous public-site page. No `org_portal.public_calendar` row exists in
   any organization, no event has the box ticked and no site carries the slot,
   so merging exposes nothing.
6. **On `development`:** apply `0067`, then
   `scripts/public-calendar/seed-dev-public-calendar.sql` (also reached through
   `scripts/seed-dev.sql`), then run the full `scripts/test-rls.sql` as
   `presby_app`. Section 67 is `scripts/public-calendar/test-rls-67.sql` and
   adds 58 passes; the three known drift failures at lines 217, 516 and 7927 are
   pre-existing. **Do not run the seed or the suite on production** (test
   helpers and a fixture site).
7. **Turning it on for a congregation is a separate, later step** (the toggle
   at `/o/<slug>/admin/features`, the slot placed on a page by the site's
   maintainer, an event marked). The public-site integration for the first
   customer is a `docs/TODO.md` line with its own preconditions and a
   real-iPhone check.
8. **Down-path.** There is no rollback file. The fastest way back is the toggle
   off for the organization, then unmark the events, then `sites.public_render`.
   Do not drop the column or the CHECK; the code needs them.

---

## Public asset audience (0072)

Added by the public-asset allowlist pipeline (F289; DECISION-277; F297 and F298
closed). Migration `0072`. Design and rulings:
`docs/work-log/2026-10-25-public-asset-allowlist.md`. The public asset route
(`/site/<slug>/assets/<key>`, and `/assets/<key>` on a church's own domain)
used to serve ANY `blob_assets` row of the organization by uuid. It now serves a
key only through one database function, `presby_public_site_asset()`: a
`public_site` image, or the photo of a person a public roster currently lists.
Everything else, including a statement PDF, a ticket screenshot and the content
bundle, answers the one neutral 404. **`0072` must be live in production before
`GIVING_STATEMENTS_ENABLED` is set** (before January), and treasury's `0073`
targets the constraint `blob_assets_id_org_audience_key` that `0072` creates.

### Pre-deploy runbook: 0072, then the code, in ONE release

Apply `0072` and promote the code together, in this order, then verify.
`GIVING_STATEMENTS_ENABLED` stays unset until step 6 is complete.

0. **Preconditions (read-only, on production).**
   `select to_regclass('giving_statements'), to_regclass('ticket_messages'), to_regclass('person_privacy'), to_regclass('organization_sites'), to_regprocedure('presby_public_staff_roster(text,text,boolean)'), to_regprocedure('presby_public_committee_roster(text,text,boolean)')`
   returns six non-null values. Re-read the counts that justify the flip set
   (the 2026-10-25 read was: blobs 107 / images 82 / json 25 / pdf 0; tickets
   with an attachment 0; statements 0; people with a `photo_key` 0; brand marks
   1; wordmarks 0; sites with a bundle 1, live 1) and compute the expected flip
   with the V1 query below run BEFORE the migration (it returns the same rows
   with `public_ok = 0`). A non-zero ticket, statement or photo count that
   overlaps the flip set makes the migration raise, by design.
1. **Snapshot** the Neon `production` branch (`pre-0072-<date>`).
2. **No site-repo push, no logo upload and no ticket attachment between steps 3
   and 4.**
3. **Apply with `-1`, as the owner, on the direct endpoint:**
   `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0072_presby_blob_audience.sql`.
   `-1` is mandatory: the file has no transaction of its own and uses a temp
   table. It is idempotent, so a failed run can be repeated whole. Record the
   `0072: flipped N blob(s) to public_site` notice. Expected: `N` = the brand
   mark plus the live bundle's distinct images (one less if the mark is also a
   bundle image). The one designed failure is the pre-flip assertion
   (`0072: N blob(s) are both published ... and used by a private consumer`);
   it rolls back whole and names the count.
   Rehearsed 2026-10-26 on a throwaway Neon branch created from `production`:
   exit 0, `0072: flipped 81 blob(s) to public_site` (80 distinct bundle images
   plus the mark), and V1 to V4 below all as expected. Re-run the rehearsal if
   production changes before the apply.
4. **Promote the code** (merge; Vercel builds). Old code and the new schema
   coexist briefly: an old `store()` insert omits `audience` and lands
   `private` (the column default is permanent and fails closed), so an image
   ingested by old code shows as a broken image until the next ingest, a logo
   uploaded by old code is a `private` mark, and an old dedup lookup ignores
   audience, so a ticket upload byte-identical to a `public_site` image fails
   the new foreign key (rare, and loud). If a site-repo push did happen in the
   window, push a NEW commit: a repeat of the same sha short-circuits ingest as
   `already_current` and heals nothing. A logo uploaded in the window is
   uploaded again after this step. Statements cannot be affected
   (`GIVING_STATEMENTS_ENABLED` is off).
5. **Verify** (all six):
   - **V1.** Every current mark and every `imageKeys` value of every bundle
     resolves to a `public_site` image row. Expect `kind = 'mark'`
     `expected = 1 public_ok = 1 dangling = 0`, and `kind = 'bundle_image'`
     `expected = N public_ok = N dangling = 0`.

     ```sql
     with marks as (
       select ob.organization_id, ob.mark_asset_key as id, 'mark' as kind
         from organization_brands ob where ob.mark_asset_key is not null),
     bundles as (
       select s.organization_id, convert_from(b.bytes, 'UTF8')::jsonb as j
         from organization_sites s
         join blob_assets b on b.id = s.content_bundle_key and b.organization_id = s.organization_id
        where b.content_type = 'application/json'),
     imgs as (
       select bu.organization_id, k.value::uuid as id, 'bundle_image' as kind
         from bundles bu, jsonb_each_text(bu.j -> 'imageKeys') k),
     want as (select * from marks union select * from imgs)
     select w.kind, count(*) as expected,
            count(*) filter (where b.audience = 'public_site' and b.content_type in ('image/png','image/jpeg','image/webp')) as public_ok,
            count(*) filter (where b.id is null) as dangling
       from want w left join blob_assets b on b.id = w.id and b.organization_id = w.organization_id
      group by w.kind;
     ```
   - **V2.** `select audience, content_type, count(*) from blob_assets group by 1, 2 order by 1, 2;`
     The `public_site` rows are images only and total the flip notice count;
     every `application/json` row is `private`.
   - **V3.** `select conname, convalidated, confdeltype, confupdtype, pg_get_constraintdef(oid) from pg_constraint where conname in ('ticket_messages_attachment_fk','giving_statements_blob_fk')`:
     three columns each, `confdeltype` and `confupdtype` both `a` (NO ACTION),
     validated.
   - **V4.** `select proname, prosecdef, proconfig, proacl from pg_proc where proname in ('presby_public_site_asset','presby_public_staff_roster','presby_public_committee_roster')`:
     all three `prosecdef`, `search_path=public, pg_temp`, and an ACL naming
     only the owner and `presby_app`.
   - **V5.** On the live site, `curl -sI https://<platform-host>/site/<slug>/assets/<an imageKeys value>`
     returns 200, `cache-control: public, max-age=31536000, immutable` and
     `x-content-type-options: nosniff` (once, not doubled). **Record the
     `x-vercel-cache` header** (F297's "must be checked": Vercel's docs say a
     function response is held at the edge only with `s-maxage`, so expect no
     `HIT`). Then `curl -s` the bundle JSON's own id, a random uuid and
     `not-a-uuid`: all three are an identical `404`, body
     `{"error":"Not found"}`, `cache-control: no-store`.
   - **V6.** The live home page on a phone: the logo and the page images load
     (a natural width above zero), and nothing scrolls sideways.
6. **Then, and only then,** `GIVING_STATEMENTS_ENABLED` may be set.
7. **Rollback.** Revert the code and redeploy. The schema is additive and
   compatible with old code, so no schema rollback is needed (fix forward). A
   code revert restores the old route, that is the original gap, not an outage.
   If the migration itself fails it rolls back whole (`-1`).

**Known residuals (DECISION-277).** There is no takedown: a `public_site` image
stays fetchable by its uuid after it drops out of a bundle (a tracked
follow-up). Copies already in a browser, search engine or web archive cannot be
recalled. A listed person's photo is served under `private, max-age=86400` and
is fetchable by its exact uuid while the directory flag is off. A person who
hides their photo in the directory is withheld from every public roster.

---

## Site ingest: the staged transport (DECISION-279, F324)

A content repo's CI publishes through presby-site-kit's `ingest.yml`. Vercel refuses
any function request body over 4.5 MB before route code runs (a plain-text 413), so
the ingest has two transports and the client chooses:

- **Legacy, one request:** `POST /api/sites/ingest` with the whole bundle (pages and
  base64 images). Used when the exact serialized body is at most **4,000,000 bytes**.
  Unchanged apart from the limit and an added `code` on errors.
- **Staged:** `POST /api/sites/ingest/plan` (which image sha256 digests the platform
  still lacks), `/images` (one image's raw bytes per request) and `/commit` (the pages
  plus `{ manifestKey, sha256 }` per image). Every request carries its own fresh GitHub
  OIDC token and the header `x-presby-ingest-protocol: 1`. The server derives every blob
  key itself, and the site changes only at the commit.

The app enforces the 4,000,000-byte per-request limit itself on all four routes (413
`request_too_large`, after authentication), so a local server behaves like production.
There are no new environment variables, flags or migrations. The routes need
`sites.public_render` on and 0072 applied, like the legacy one.

**Rollout order is fixed: the server before the client.**

1. Apply 0072 and promote F289 (see "Public asset audience (0072)"), then promote the
   release carrying this change. Verify with an unauthenticated `POST` to each of
   `/api/sites/ingest/plan`, `/images` and `/commit` on the production platform host:
   each answers **401 with the JSON body** (`{"status":"error","code":"unauthorized",...}`).
   A 404 means the route did not deploy.
2. Read-only prediction for `fpcw` (counts only): after 0072, count its `blob_assets`
   rows with `audience = 'public_site'` and compare the distinct hashes of
   `site-fpcw/images/`. A hash held only as `private` is reported missing, so the first
   publish uploads exactly the ones not held as site images; do not promise it uploads
   nothing. Also confirm in `/admin` that `sites.public_render` is on in production and
   that `fpcw`'s site is not `suspended` (a suspended site is ingested but never shown).
3. Merge presby-site-kit's `fix/staged-ingest` (v4.1.0) to its `main` and tag `v4.1.0`
   on the branch tip `ea9e78a` (not `ad109b1`: that commit still prints "Published commit").
   This takes effect for every site's next push (the workflow file comes from `@main`;
   the scripts come from `site_kit_ref`). A site that pins `site_kit_ref` to a tag older
   than v4.1.0 is unsupported by the new workflow and fails with a readable line.
4. Not a gate (Phase 6 ruling: FPCW's own run proves the same in the same sitting, and this
   site has no images; it costs two publishes of a live customer's site). Only if a real
   need appears, and the operator's call, on a live customer repository: add `transport: staged`
   to `site-pasturechurch`'s calling workflow for one push and read the log (Built,
   "Staged ingest was requested", "This site has no images to send.", Publishing,
   "Sent commit ...; the platform has ingested it."), then remove it. It proves OIDC, the three routes and Vercel's real
   behavior; it does **not** prove an upload (that site has no images).
5. The first real `site-fpcw` ingest (see "Deferred by operator decision"). Trigger it with a
   push to `site-fpcw` `main`; do not re-run the old failed run 40251133138 (a re-run may
   resolve the old workflow reference; unverified). Expected log
   shape: `Built 14 page(s) and 81 image(s): 80 distinct, 28.3 MB.` · `The site is 37.8 MB
   as one request, over the 4.0 MB limit, so images are sent one at a time.` ·
   `Checking which of the 80 distinct image(s) the platform still needs.` ·
   `<R> already on the platform; <M> to upload.` (or `All 80 image(s) are already on the
   platform; nothing to upload.`) · one `Uploaded i of M` line per image · `Publishing ...`
   · `Sent commit <sha7> to "<slug>" (<n> page(s)); the platform has ingested it.` · `Sent <M> new image(s); <R> already on the
   platform.` A previously masked failure is possible (the 413 hid everything after it):
   the client prints a named cause and hint for each (401 variable mismatch, 404
   unprovisioned repository, 503 flag off or unreadable); fix it and re-run, every step is
   safe to repeat and a repeat of an ingested sha says so.

**Rollback.** Client: revert the v4.1.0 change on presby-site-kit `main` (both commits, or
the merge commit with `git revert -m 1`; large sites then fail as before; small ones are
unaffected). Server: revert the presby release; a staged
client then gets a non-JSON 404 on `/plan` and prints "the platform does not support
staged ingest yet". Neither needs a database action.

**Unverified until production.** The plan and commit on Vercel's real stack; whether
`getIDToken` tolerates about 80 calls in a run; the timing of one upload on a cold
function; the actual `exp` of a GitHub OIDC token (irrelevant by design, every request
mints a new one). The first `site-fpcw` run is the evidence; the in-process bridge run
(real client, real handlers) is the pre-production proxy.

**Accepted residuals.** Images uploaded by a run that never published remain as
`public_site` rows no bundle uses (fetchable only by uuid, which no ingest response
discloses; no takedown until F289 Tier 2). Re-running an older failed run after a newer
one succeeded republishes the older content: re-run only the latest.

---

## Careers (0071)

Added at integration (v0.47.0). Migration `0071`. Design and rulings:
`docs/work-log/2026-10-25-careers-inc1.md` (Phase 3 and Phase 6) and the parent
`docs/work-log/2026-10-25-careers.md`; DECISION-264, 265, 266 and 278; findings
F290, F292 to F295 and F311 to F320 (`docs/schema-design-2.md` section 2ah).
Increment 1 only: job postings, the staff pages, the public list and posting
pages and the `careers` slot. **Nothing here accepts an application**; that is
Increment 2 (migration `0075`), which has its own runbook and a stricter rule
about production data (point 8). Confirm first, on production:
`select count(*) from information_schema.tables where table_name = 'job_postings'`
is 0 and `select count(*) from permissions where key like 'careers.%'` is 0.
The journal has no idx 69 or 70 (the number is the migration's own, as for 0072);
do not renumber.

### Pre-deploy runbook: 0071, then the code

1. **Order and method: `0071` first, then merge and deploy the code.** Apply it
   as the owner, on the direct endpoint, by hand, in one transaction:
   `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0071_presby_careers.sql`.
   `db:migrate` stopped tracking past idx 9, so the journal entry (idx 71) is a
   record, not an applier. The file is idempotent (every statement is `if not
   exists`, `on conflict do nothing`, `where not exists`, drop-then-add,
   `create or replace` or revoke-then-grant) and was applied twice in full on the
   pipeline branch. It shares no object with `0068` (parishes) or `0072` (asset
   audience), so the three may be applied in either order; each has its own
   conditions in its own section. **Snapshot `production` first** (Neon). Code
   before schema is the wrong order: the staff and public pages and the daily
   sweep call objects that do not exist yet. With the toggle off everywhere
   (the default) no page is reachable, and the sweep step would only log a
   counts-only failure, with the token pruning unaffected. Old code against the
   new schema is safe: the schema is additive, and the one behavioural change is
   point 2.
2. **Re-read the live `presby_founding_administrator_permission_keys()` at merge,
   before applying.** `0071` re-creates it with two more keys. If another
   migration has re-created it since this branch was cut, the second `create or
   replace` silently drops the first one's keys, and Postgres records no
   dependency to warn you. Today the live body is `0059`'s, nine keys
   (`people.manage`, `roles.manage`, `role_grants.manage`, `groups.manage`,
   `officers.manage`, `org_features.manage`, `tickets.file`, `staff.manage`,
   `domains.manage`) plus `congregation_oversight.manage` for a presbytery;
   `0061` and `0068` say they do not touch it. Check with
   `select pg_get_functiondef('presby_founding_administrator_permission_keys(text)'::regprocedure)`;
   if the array is anything other than those nine, stop and merge the new keys
   into `0071`'s array by hand (and the TypeScript plan, the designation golden
   and `invitations.db.test.ts` with them). The test that catches a mismatch is
   `src/lib/db/domain/invitations.db.test.ts` (the SQL-equals-TypeScript parity
   case, around line 571).
3. **Count the backfill, read-only, before applying, and tell the operator the
   number.** `0071` tops up every existing org-owned `founding_administrator`
   role with both keys, **including `careers.applicants`, a tier-3 key**, so
   every existing founding administrator holds it from the moment the migration
   runs. It reads nothing until Increment 2. The count:
   `select count(*) from app_roles where key = 'founding_administrator' and organization_id is not null`
   and, for who holds them,
   `select count(*) from role_grants g join app_roles r on r.id = g.role_id where r.key = 'founding_administrator' and r.organization_id is not null and g.ends_on is null`.
   Production held zero such roles on 2026-10-25; re-measure. Residual, as
   `0057`: a re-apply re-adds a key a tenant removed from a designation-minted
   role. The release note says "existing and new founding administrators".
4. **Reserved-path check, read-only, immediately before deploy.** Careers
   reserves `/careers/<anything>` on every site (the bare `/careers` stays a
   bundle page). A live bundle with a page under it would be stored and never
   shown. Expected 0 rows (0 on 2026-10-25; the query's syntax was verified on
   the pipeline branch with a positive control):
   ```sql
   select o.slug, p->>'path' as path
     from organization_sites s
     join organizations o on o.id = s.organization_id
     join blob_assets b on b.id = s.content_bundle_key
    cross join lateral jsonb_array_elements(convert_from(b.bytes, 'UTF8')::jsonb -> 'pages') p
    where lower(p->>'path') like '/careers/%';
   ```
   A row means rename that page in the site's repository before deploying. Ingest
   refuses new ones by name (and the percent-encoded spellings) from this release.
5. **Verify against the catalog, not the DDL, and diff against `development`.**
   - `permissions` holds `careers.manage` at tier 1 and `careers.applicants` at
     tier 3, module `careers`.
   - `job_postings` has `relrowsecurity` and `relforcerowsecurity` true, one
     `tenant_isolation` policy, and **no** `DELETE` grant to `presby_app`; its
     column-limited `INSERT` and `UPDATE` grants omit `version`, `posted_on`,
     `first_published_at`, `closed_at` and `updated_at`. The three guard triggers
     (`job_postings_guard_insert`, `_update`, `_delete`) are present and enabled.
   - `presby_public_careers(text, text)` and `presby_careers_org_today(uuid)`
     have `prosecdef` true, `search_path=public, pg_temp`, and execute for
     `presby_app` only; `presby_careers_sweep(integer)` and
     `presby_founding_administrator_permission_keys(text)` are executable by
     neither `public`, `presby_app` nor `presby_platform`
     (`has_function_privilege` false for all three).
   - The founding function's array now ends `…, 'domains.manage', 'careers.manage',
     'careers.applicants'`; the template role `hiring_committee` exists with
     `organization_id is null` and exactly those two keys; the template count is
     seven.
   - The founding-administrator role count from point 3 is unchanged, and each of
     those roles now has both keys.
6. **On `development`, after merge:** apply `0071`, then run
   `scripts/careers/seed-dev-careers.sql` (reached through `scripts/seed-dev.sql`)
   and the full `scripts/test-rls.sql` as `presby_app`. Section 71 is
   `scripts/careers/test-rls-71.sql`. Two patches are needed in the shared files
   (`scripts/careers/*.integration.patch`): the template count goes from 6 to 7
   at `scripts/test-rls.sql` (`DECISION-152` assertion) and the seed includes the
   careers fixture (two live sites). Known failures that are not careers: the
   drift at `scripts/test-rls.sql` lines 217, 516 and 7927, and section 67's seed
   missing on a pipeline branch. **Do not run the seed or the suite on
   production** (test helpers and fixture sites).
7. **Flag prerequisites for the committee role, then the toggle.** The toggle
   `org_portal.careers` is per organization, off by default, with no row, and is
   switched on by a founding administrator at `/o/<slug>/admin/features`
   ("Job openings"). Setting up the hiring committee needs **two global flags
   that must be on in production**: `org_portal.roles` (Roles, where the "Hiring
   Committee" template is adopted) and `org_portal.admin_hub` (the Administration
   hub). Without them `/admin/roles` says "Role administration isn't turned on"
   and the hub says "Organization administration isn't turned on", and the
   template cannot be adopted. Check both in `/admin/flags` before telling a
   congregation to set up a committee. The committee path, as built and walked:
   the founding administrator adopts "Hiring Committee" at Roles, New role,
   then grants the role to the committee's group, so membership drives access.
   Until Increment 2 the committee role grants two keys that read nothing.
8. **Defaults, rollback, and the production-branch rule.** Defaults: the
   toggle is off for every organization, `job_postings` is empty, and no site
   carries the `careers` slot, so merging exposes nothing. There is no rollback
   file and no data to roll back. The fastest way back is, in this order: the
   toggle off for the organization (the public pages 404 and the slot shows the
   one "unavailable" notice), then close the postings, then
   `sites.public_render`. Do not drop `job_postings`, the function or the
   permission rows; the code needs them, and a posting is never deleted. **Never
   branch production for pipeline work**: this increment stores no personal data
   of an applicant, but Increment 2 does, and a Neon branch of production would
   be a copy of it outside the retention clock.

**What to tell the operator after merging.** The Employment page for the first
customer's site is a new content file in its private repository, not part of
this release and not to be added until the toggle is on and a posting is
published (otherwise the menu page shows the unavailable notice). The steps are
the "Post-ship steps" in the Increment 1 work-log; the posting import is Track K.

---

## Sign-in invitations and connect at sign-in (0065)

Added at integration (v0.48.0). Migration `0065`. Design and rulings:
`docs/work-log/2026-10-22-founding-admin-directory.md` (Increment 2b, Phase 3
amendment 2 and Phase 6); DECISION-207, 208 (amended) and 225 to 228; findings
F186, F187, F192 to F198 and F230 to F233 (`docs/schema-design-2.md` section
2ai). The journal entry is idx 65 (the number is the migration's own, as for
0072); idx 66 is reserved for Increment 3a. **Operator ruling 2026-10-26: the
release ships, but real sign-in invitations are held until F166 (recovery codes
and landing on first enrolment) ships.** Deploying 0065 and the code sends
nothing by itself; an invitation goes out only when a person with `people.manage`
presses Send, so the hold is a promise to keep, not a switch. The one thing the
code does on its own is connect at sign-in (point 4, `org_portal.sign_in_connect`).

### Confirm first (read-only, on production)

- `select to_regprocedure('presby_person_email(uuid,text)')` is non-null (0064
  applied).
- `select to_regprocedure('presby_connect_signed_in_account(uuid,boolean)')` is
  null (0065 not yet applied).
- `select to_regclass('public.user_totp')` is non-null (the file's own
  precondition, and the second-factor rule reads it).
- The shipped code is at least v0.42.3 and v0.42.4 (DECISION-230 and 246: the
  session-claim fix and the unverified-Google-email refusal). Main already has
  both. Do not apply 0065 under older code.

### Pre-deploy runbook: snapshot, 0065, then merge and deploy

1. **Order: snapshot `production`, apply `0065`, then merge and deploy.** Every
   merge to `main` auto-deploys production. The new code calls functions that do
   not exist before `0065`, so code first is the wrong order. **Old code against
   the new schema keeps working** (the file's header and design section 4):
   verify-email's `update users set email` is allowed and the new trigger clears
   the unread stamp; the NextAuth adapter's insert carries a null
   `email_verified`, which is allowed; founding-administrator and treasurer
   acceptance is byte-identical; no old code writes `people.user_id`. So the
   window between the apply and the deploy is safe.
2. **Pre-reads, counts only (never a value, never an address), re-run just before
   the apply** (read-only session, `default_transaction_read_only = on`). The
   queries are Phase 3's section 3.2 (P1 to P8); expected values are from
   production on 2026-10-25.
   - **P1, case-duplicate `lower(users.email)` groups. Expect 0.** The file stops
     on any (`users_email_lower_uq` could not be built). Repair the data, never
     edit the migration.
   - **P2, stamped users with a `user.email_changed` audit row. Expect 0.** The
     file clears those stamps and prints a count. If non-zero, those people lose
     address proof until they sign in with Google (a stamp at password reset,
     S11, was declined), so they cannot connect or accept in place and use the
     emailed link; tell the operator before deploy.
   - **P6, open invitations of any purpose. Expect 0.** The file drops and
     re-adds the `account_invitations` CHECKs and re-predicates
     `account_invitations_open_address_uq`; any open row is unaffected in
     content but you want to know the number.
   - **P8, the deploy-day wave: proven, active, unlinked users with exactly one
     eligible candidate person. Expect 0.** If both "will connect" columns are 0
     the release note says nothing about a wave (it does not). If either is
     non-zero, the note must say people "may be connected the next time they sign
     in" before the release goes out, and the operator should read the count.
   - The count of `organizations` and of `organization_feature_toggles` rows
     (11 toggle rows over 2 organizations on 2026-10-25). Section 8 seeds one
     `org_portal.sign_in_connect` row per existing organization.
   - The Google-account count: `select count(*) from accounts where provider =
     'google'` (0 on 2026-10-25). It decides how much the one-time Google check
     in point 7 matters.
   - `select count(*) from audit_events` (661 on 2026-10-25). The new partial
     index `audit_events_sign_in_connected_ix` builds under a brief write lock;
     at this size it is instant.
3. **Apply `0065` WITH `-1`, as the owner, on the direct endpoint:**
   `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0065_presby_sign_in_and_connect.sql`.
   `db:migrate` stopped tracking past idx 9, so the journal entry is a record,
   not an applier. The file is idempotent (count-only stop-blocks, an update
   whose predicate stops matching, drop-then-add constraints, `create or
   replace` functions, drop-then-create triggers, `on conflict do nothing` for
   the seed, revoke-then-grant); a second run changes nothing. It shares no
   object with 0067, 0068, 0071 or 0072, so those may be applied in either order
   relative to it. Then **merge and deploy the code.**
4. **What deploy turns on by itself.** `org_portal.sign_in_connect` ("Connect
   people when they sign in") is seeded **on** for every existing organization
   and written on for every new one. From the first request after deploy, an
   account whose proven address sits on exactly one eligible record at a managed
   congregation is connected at its next sign-in (a record that holds a role or a
   seat only after a confirmed two-factor sign-in). The wave is P8's number. To
   hold even that, turn the toggle off per organization at
   `/o/<slug>/admin/features` (it stops new connections only, and disconnects
   nobody). There is no global flag, by the operator's standing rule.
5. **Verify against the catalog, not the DDL, and diff against `development`.**
   - Both guard triggers are present and enabled: `users_guard_email_proof` on
     `users` and `people_guard_user_link` on `people`.
   - Indexes present: `users_email_lower_uq`,
     `account_invitations_open_sign_in_person_uq`, the re-predicated
     `account_invitations_open_address_uq` (it excludes the `sign_in` purpose),
     and `audit_events_sign_in_connected_ix`.
   - `presby_app` has no privilege on `account_invitations` (`aclexplode`).
   - `presby_app` holds EXECUTE on exactly the 15 callables and on none of the
     five internals (`presby__accept_invitation_core`, `presby__actor_person`,
     `presby__bind_person_account`, `presby__person_sign_in_standing`,
     `presby_sign_in__check`); `presby_platform` holds none; PUBLIC holds none.
   - Every definer is owned by the owner role and has `search_path = public,
     pg_temp`.
   - `org_portal.sign_in_connect` toggle rows equal the organization count, all
     enabled.
   - Row counts are unchanged from point 2, apart from the section-2 clean-up
     (P2) and the toggle seed.
6. **On `development`, after merge:** apply `0065`, then
   `scripts/sign-in-invitations/seed-dev-sign-in.sql` (reached through
   `scripts/seed-dev.sql`, last) and the full `scripts/test-rls.sql` as
   `presby_app`. Section 65 is `scripts/sign-in-invitations/test-rls-65.sql`.
   Section 44's `presby_app` link writes were converted in the same integration
   (F186). The e2e suite needs the owner connection to seed its users since this
   migration (`e2e/support/global-setup.ts`, patched at integration): CI's seed
   step must run as the owner. **Do not run the seed or either test file on
   production** (test helpers and fixture people).
7. **After deploy: the operator walks the real path, and does the one-time
   Google check.**
   - On a congregation made for testing, with plus-addresses (3 invitations per
     address per day): send an invitation from a person's edit page, accept it as
     a new account, and enrol two-factor. **Until F166 ships, do this only as the
     operator**; a new-account invitee is left on the enrolment page with no
     recovery codes shown and no Continue link.
   - **The Google check.** The Google proof path is the one path no automated test
     exercises (it needs a real Google ID token). Sign in with Google on an address
     that sits on exactly one eligible record, then confirm the connection and the
     `user.email_proof_recorded` audit row (metadata `source: google`).
8. **Down-path.** There is no rollback file. A code rollback is safe: old code
   works against the new schema (point 1). The widened vocabulary CHECKs on
   `account_invitations` cannot be narrowed once a `sign_in` row exists (rows are
   never deleted), and production has none before this file, so the only
   forward-only edge appears after the first invitation is sent. Do not drop the
   guards, the triggers or the toggle rows.
9. **Never run** `scripts/sign-in-invitations/seed-dev-sign-in.sql` or
   `scripts/sign-in-invitations/test-rls-65.sql` on production.

**What to tell the operator after merging.** Real sign-in invitations wait for
F166. The what's-new entry is published after F166, not at this release
(`docs/TODO.md`). F232 (a `people.manage` holder can address an authority-bearing
record to a mailbox they control; detected by audit, not prevented) is an
accepted open residual and is named in the release note.

---

## Deferred by operator decision (2026-09-23)

These are **not** oversights.

- **Google OAuth** — presby will support it, but it is not a priority. Until
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set, and with the credentials-login
  bypass deliberately unseeded, Google sign-in is unavailable. Accepted for now.
  *(Corrected 2026-10-26: this used to say nobody can sign in to production, including
  the operator. The operator does sign in, with an MFA-enrolled account (the 0.42.3 smoke
  passed 2026-10-25), and is `fpcw`'s founding administrator.)* Redirect URI
  when it happens: `https://<canonical host>/api/auth/callback/google`.
- **First real `site-fpcw` ingest** — `organization_sites.last_ingested_commit_sha`
  for `fpcw` is still a scratch placeholder. The two Production OIDC variables
  above now exist (corrected 2026-10-25); what is missing is `site-fpcw`'s own
  repository variables, `PRESBY_INGEST_URL` and `PRESBY_OIDC_AUDIENCE`, and the
  run history shows every ingest attempt failed (the five newest, 2026-08-26 to
  2026-08-28; the logs have expired, so the cause is an inference). The first
  ingest publishes the whole migrated site and needs the operator's explicit go;
  see the public events calendar line in `docs/TODO.md`.

## Not applicable yet

**Church data import.** There is no import feature and, by decision, there will
not be a general one — onboarding imports are ad-hoc per congregation. FPCW's is a
three-source merge (Church360, Vanco, fpcw-directory) scheduled for the cutover.
See `docs/reviews/2026-09-23-fpcw-feature-match.md` Track K.

**Custom domains.** FPCW's public site must live at its own existing domain from
day one of cutover. Increment 1 of Track F (the mechanism) is in "Custom domains"
above; the cutover itself, and church email domains, are not built. Track F of
`docs/reviews/2026-09-23-fpcw-feature-match.md`.
