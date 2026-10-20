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
| `SITES_INGEST_OIDC_AUDIENCE` / `GITHUB_SITES_ORG` | needed before a real `site-fpcw` content ingest can authenticate |
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

## Deferred by operator decision (2026-09-23)

These are **not** oversights.

- **Google OAuth** — presby will support it, but it is not a priority. Until
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set, and with the credentials-login
  bypass deliberately unseeded, **nobody can sign in to production, including the
  operator.** Accepted for now; production serves public pages only. Redirect URI
  when it happens: `https://<canonical host>/api/auth/callback/google`.
- **First real `site-fpcw` ingest** — `organization_sites.last_ingested_commit_sha`
  for `fpcw` is still a scratch placeholder, and the two OIDC variables above are
  unset, so an ingest would fail auth.

## Not applicable yet

**Church data import.** There is no import feature and, by decision, there will
not be a general one — onboarding imports are ad-hoc per congregation. FPCW's is a
three-source merge (Church360, Vanco, fpcw-directory) scheduled for the cutover.
See `docs/reviews/2026-09-23-fpcw-feature-match.md` Track K.

**Custom domains.** FPCW's public site must live at its own existing domain from
day one of cutover. Increment 1 of Track F (the mechanism) is in "Custom domains"
above; the cutover itself, and church email domains, are not built. Track F of
`docs/reviews/2026-09-23-fpcw-feature-match.md`.
