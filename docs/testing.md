# Testing presby by hand

How to sign in and exercise what exists. For the automated suites see
`CLAUDE.md` → Common Commands.

**Everything here is synthetic.** Every address is on the reserved `.invalid`
TLD (RFC 2606), which can never resolve, so a fixture can never receive mail
even if something is misconfigured. `e2e/support/seed-users.ts` **refuses** to
provision an address that does not end in `.invalid` — that guard is what makes
the shared password below safe to keep in the repository.

---

## Getting a database with fixtures in it

```bash
npm run db:migrate                    # or apply drizzle/00XX_presby_*.sql by hand — see the note below
npm run check:schema-parity           # confirms the migrated catalog matches the TS domain model
npm run db:seed                       # roles, features, flags — application catalog data
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql   # the synthetic congregation fixture
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql   # assert_eq(), needed only if you'll run scripts/test-rls.sql
npm run dev
```

**`-v ON_ERROR_STOP=1` on the `seed-dev.sql` line is not optional.** Plain
`psql -f` exits **0** even when a statement inside fails — the file is one
`begin;…commit;` transaction, so a failure anywhere rolls the whole thing back
and you get an empty fixture with a green exit code and no error on screen
(Phase 2 MUST ruling, `docs/work-log/2026-09-26-ci-db-tests.md`). The flag is
what turns that into a visible, non-zero failure.

The **e2e fixtures** (the accounts in the table below) are provisioned by the
Playwright suite's `globalSetup`, not by `db:seed` — the suite owns its users
(DECISION-032). Running `npm run test:e2e` once creates them. There is no
separate command, deliberately: a second provisioning path is a second thing to
drift.

> **Local note.** `drizzle.__drizzle_migrations` on **this dev database** (the
> one `.env.local` in this worktree points at, shared across sessions) records
> only the first ten migrations; 0010–0015 were applied with `psql`. So
> `npm run db:migrate` is not the local apply command **against that specific,
> already-migrated-by-hand database** — it would try to re-run 0010. This does
> **not** describe every database: a genuinely from-empty database (a fresh
> `CREATE DATABASE`, or an ephemeral CI branch's `ci_run`) migrates cleanly with
> `npm run db:migrate` — 51/51 applied, no hand intervention — which is exactly
> what `db.yml`/`e2e.yml` rely on and what makes DECISION-150's reproducibility
> claim true. If you're building a fixture database from scratch, use
> `db:migrate`; only reach for hand-applying individual `drizzle/00XX_*.sql`
> files if you're specifically working against this worktree's pre-existing,
> partially-hand-migrated dev database.

---

## Accounts

Password for every fixture: **`e2e-fixture-only-not-a-secret`**

| Sign in as | Who they are | Where sign-in lands them |
|---|---|---|
| `admin@presby.invalid` | Platform admin, no congregation | `/admin` |
| `member@presby.invalid` | Platform member, no congregation | `/no-organization` |
| `admin-2fa@presby.invalid` | Admin with 2FA required, **not enrolled** | `/totp` → `/account/2fa` to enrol (the shared fixture: specs that actually ENROL use a throwaway user, below) |
| `admin-2fa-enrolled@presby.invalid` | Admin with 2FA required, **already enrolled** (fixed test secret, see `e2e/support/totp-fixture.ts`) | `/totp`, and a real 6-digit code lands it on `/admin` |

**Enrolling in a spec (F166, DECISION-292).** Finishing enrolment ends in a **verified** session (the confirmation is a possession proof and marks the session through the same grant `/totp` uses), keeps the ten recovery codes on screen until the person chooses Continue, and never sets a recovery-code cookie. So a spec that enrols does not answer a second `/totp` challenge afterwards, and it must not use the shared `mfa-admin` / `mfa-enrolled` fixtures (a spec that enrols or regenerates would poison every sign-in after it): it mints a throwaway `.invalid` user with `e2e/support/enrolment-fixture.ts` (`createThrowawayUser`, `sweepStaleUsers`, `deleteThrowawayUsers`, `signInViaApi` to reset a session's claim, `typeEnrolmentCode` to read the manual key and type a real code, `expectPanelSurvives` to prove the codes outlive the post-enrolment re-render, `recordUrls` for a "no `/totp` hop" assertion, `expectNoFreshCodesCookie`). Specs: `e2e/hydration/totp-enrol-handoff.spec.ts` (the codes survive the re-render, session verified, in **both lanes**: the `chromium` dev server and the `prod-build` production lane, because the property belongs to the built app), `e2e/totp-first-enrolment.spec.ts` (administrator via `/admin`, voluntary, reload, hostile `callbackUrl`), `e2e/totp-regenerate-gate.spec.ts` (F344: regenerating needs a verified session; a stale tab is refused), the two-tab case in `e2e/totp-enrol-concurrency.spec.ts`, and the new-invitee and treasurer walks in `e2e/invitation-new-account.spec.ts` / `e2e/invitation-existing-account.spec.ts`. Recovery codes are shown from client memory only, so a spec that wants to prove "a reload does not show them again" reloads and asserts none of the earlier strings is in `page.content()`.

**Entering a code on `/totp`.** The challenge is six digit boxes in a named group with a toggle to one recovery-code field, so specs never locate it by placeholder. Use `e2e/support/totp-page.ts`: `enterTotpCode(page, code)` (waits for box 1 to be enabled, which also waits out the `HydrationGate`, then types through the keyboard and relies on auto-advance), `enterRecoveryCode(page, code)` (presses the toggle, then fills the field), `waitForTotpVerified(page, destination?)`, and the locators `totpGroup`, `totpBox`, `verifyButton`, `recoveryToggle`, `recoveryField`. Typing the sixth digit submits the code (DECISION-257), so `enterTotpCode` is the whole act: no helper presses Verify and a caller must not click it (a click on the "Verifying…" button waits 30 seconds and fails); wait for the outcome with `waitForTotpVerified` or the URL the spec expects. Recovery mode and a paste that drops a digit (an over-long one, or a short one that overflows the remaining boxes) still need the button. The fixture seeds one unused recovery code for the enrolled user (`E2E_RECOVERY_CODE` in `totp-fixture.ts`); it is single-use, so a spec that consumes it calls `seedRecoveryCode()` in `beforeEach`. `e2e/totp-code-entry.spec.ts` covers focus, advance, Backspace/Delete, paste and autofill, the auto-submit (once per code, re-arm after a failure, the pending state) and the 360px layout; `e2e/totp-recovery-code.spec.ts` covers the recovery path (F164).
| `org1@presby.invalid` | One congregation | straight into `/o/e2e-alpha` — no chooser |
| `org1-org2@presby.invalid` | A congregation **and** a presbytery | the chooser, two cards |
| `org3-unmanaged@presby.invalid` | Only an `unmanaged` congregation | `/no-organization` |
| `org2-ended@presby.invalid` | A relationship that **ended** 31 Mar 2026 | `/no-organization` |
| `clerk.fixture@example.invalid` | Tobias Renwick at Alder Creek — holds `stated_clerk` (`role_grants.manage`, and — groups-and-officers, 2026-08-26 — `officers.manage`) | `/o/alder-creek` — try `/o/alder-creek/admin/roles` (`org_portal.roles` flag permitting) and `/o/alder-creek/admin/officers` (`org_portal.officers` flag permitting) by hand |
| `elder.fixture@example.invalid` | Marguerite Ashcombe at Alder Creek — holds `support_contact` (`tickets.file`), support-tickets pipeline | `/o/alder-creek` — try `/o/alder-creek/tickets` and `/o/alder-creek/feedback` by hand, `org_portal.tickets` flag permitting |
| `presbytery-clerk@presby.invalid` | Perpetua Winlock, e2e-presbytery — holds `e2e_presbytery_clerk` (`congregation_oversight.manage`, `per_capita.manage`, `credentials.manage`, `statistics.manage`) | `/o/e2e-presbytery` — try `/o/e2e-presbytery/admin/oversight`, `/admin/reports`, `/admin/credentials` by hand |
| `presbytery-nogrant@presby.invalid` | Cassius Brightwell, e2e-presbytery — a relationship with NO grant, the "state 3" denial fixture for oversight/reports/credentials at once | `/o/e2e-presbytery` |
| `congregation-clerk@presby.invalid` | Ottoline Fairweather, e2e-alpha — holds `e2e_statistics_publish` (`statistics.publish`) | `/o/e2e-alpha` — try `/o/e2e-alpha/admin/filings` by hand |
| `founding.fixture@example.invalid` | **No person row and no organization at all** — the pre-designation state. Designate this address as an organization's founding administrator at `/admin/organizations/<id>` to exercise the `created_person` branch (a `people` row is created and linked live) | `/no-organization` before the designation; `/o/<slug>` for the newly-handed-over organization after it |

`clerk.fixture` and `elder.fixture` are provisioned by `scripts/seed-dev.sql`
(not the Playwright roster) and use the same shared fixture password below.
`clerk.fixture` exists so the P9 role-administration surface can be walked
through as the one seeded person who actually holds `role_grants.manage`.
`elder.fixture` originally existed ONLY for `scripts/test-rls.sql`'s SQL-level
`presby_two_factor_required()` assertion (password-less, could not sign in) —
the support-tickets pipeline upgraded it to sign-in-capable, since Marguerite
Ashcombe (the person it's linked to) is the one fixture person holding
`tickets.file`, and there was no other way to walk the tickets/feedback
surfaces through a real browser session as the person they were built for.

`founding.fixture` is deliberately linked to no person: it is the only
seeded account that can exercise the founding-administrator create-person branch
(the other three are already linked and would resolve to existing_person).
Designating it consumes it, so re-run `scripts/seed-dev.sql` on a fresh
database before rehearsing the handoff again.

`org1-org2` is the ruling elder who serves on a presbytery committee — one
person, two organizations, which is how PC(USA) service actually works.

The roster is defined in `e2e/support/users.ts` and their relationships in
`e2e/support/seed-orgs.ts`. Those two files are the source of truth; this table
is a convenience and can drift, so trust the code if they disagree.

---

## Organizations

| Slug | Name | Type | Platform status |
|---|---|---|---|
| `e2e-alpha` | Wrenfield Presbyterian Church | congregation | managed |
| `e2e-beta` | Thistledown Presbyterian Church | congregation | managed |
| `e2e-gamma` | Halloway Presbyterian Church | congregation | **unmanaged** |
| `e2e-presbytery` | Presbytery of the Eastern Fells | presbytery | managed |
| `alder-creek` | Alder Creek Presbyterian Church | congregation | managed |
| `bramblewood` | Bramblewood Presbyterian Church | congregation | managed |
| `fernwood` | Fernwood Presbyterian Church | congregation | managed |
| `marrowbone` | Marrowbone Presbyterian Church | congregation | **invited** |
| `quillhaven` | Quillhaven Presbyterian Church | congregation | **unmanaged** |
| `northern-reach` | Presbytery of the Northern Reach | presbytery | managed |

`e2e-*` orgs belong to the Playwright suite. The rest come from
`scripts/seed-dev.sql`, which is shaped to exercise specific findings — Alder
Creek carries the officer-term history that F22 broke, and Quillhaven is the D9
case of a congregation the presbytery holds records about without it being a
tenant.

**Nothing is inside an organization yet.** `/o/<slug>` is a deliberate landing
stub: P0 built the routing, P1 builds the portal.

**DECISION-157** governs which fixtures an e2e spec may mutate: any seeded
row may be READ, but only Playwright-owned rows (`e2e-*` slugs,
`@presby.invalid` emails, SASR report years 2090–2099, `app_roles` keyed
`e2e_*`) may be created, mutated, or deleted. `scripts/seed-dev.sql`'s own
fixtures (Alder Creek, Northern Reach, etc.) are shaped to exercise specific
findings and `scripts/test-rls.sql` assertions — mutating them from a spec
has broken the isolation suite once already. The one documented exception is
`public-sites.spec.ts`, tracked as a migration follow-up in `docs/TODO.md`,
not treated as precedent.

---

## What to walk through today (P0)

Sign in and confirm where you land — that is the whole of P0.

1. **`org1@presby.invalid`** → straight into Wrenfield. No chooser, because one
   organization needs no choosing.
2. **`org1-org2@presby.invalid`** → the chooser, two cards, showing organization
   name and type only. No "member of" language anywhere: a card is a
   *relationship*, and the church secretary who worships elsewhere is not a
   member of the church she works for.
3. **`admin@presby.invalid`** → `/admin` directly. Then visit `/orgs` by hand:
   the Platform block is still reachable, with no empty "Your organizations"
   heading above it.
4. **`org3-unmanaged@presby.invalid`** → "not connected to a congregation yet."
   Their church is in the records but is not a tenant, so there is nothing to
   enter.

Then, signed in as **`org2-ended@presby.invalid`**, type these three URLs:

| URL | Expected |
|---|---|
| `/o/e2e-beta` | Named and dated: "…ended on 3/31/2026". **The 31st in every timezone** — it rendered as the 30th west of the deployment until it was fixed. |
| `/o/e2e-gamma` | "You don't have access to Halloway Presbyterian Church" |
| `/o/nope` | A real 404 |

The middle two are DECISION-040 and they are the subtle one: an **unmanaged**
congregation and a **managed** one produce byte-identical copy. PC(USA)
publishes which congregations exist; it does not publish which ones bought this
software, and the response must not leak that.

Also worth clicking: **Organizations** in the header returns you to the chooser
from anywhere — the chooser is a convenience, never a gate, so every
organization page enforces access independently. The proper avatar-and-switcher
menu is P1.

---

## Other surfaces that already work

- `/signin` — Google OAuth (needs keys), credentials, Turnstile-guarded, lockout
  after 5 failures
- `/account` — profile, email change with re-verification, password change
- `/account/2fa` — TOTP enrolment, recovery codes
- `/admin` — users and roles, feature flags, audit log, feedback triage,
  what's-new, email queue, **2FA policy** (per-congregation, DECISION-033)
- `/developer` — the developer portal (home, data model, documentation).
  Requires `users.is_platform_admin`, which **nothing currently seeds** — so it
  is unreachable by every fixture above until you set that column by hand.
  `e2e/developer-portal.spec.ts` and `e2e/developer-2fa-gate.spec.ts` create
  their own throwaway administrators (`example.invalid`) and remove them
  afterwards.

---

## Running the DB-backed suites

Most Vitest suites are pure unit tests and `npm run test` covers them. A
subset (~30 files) talks to the real `development` database and needs
`.env.local` loaded and `--no-file-parallelism`, or teardown races between
suites produce spurious failures. This is `npm run test:db` — a real script
now, not just prose here, so CI and a human run the byte-identical command:

```bash
npm run test:db
```

(Equivalent to `dotenv -e .env.local -- vitest run --no-file-parallelism`, if
you need the raw form for some reason.) Note `fileParallelism: false` is
**not** the global Vitest default — it costs 7.7x on the full suite (12s vs
94s, measured 2026-09-26) for a requirement only these ~30 files have, so it
lives in this one script instead of `vitest.config.ts`.

Separately, `scripts/test-rls.sql` is the isolation suite — it **must** run as
`presby_app` (`$APP_DATABASE_URL`), never as the owner (`$MIGRATE_DATABASE_URL`):
`neondb_owner` has `rolbypassrls = t`, so running it as the owner proves
nothing, no matter how many assertions pass. It also depends on
`assert_eq()`, a test-only helper function that is **not** part of any
migration (production has no business carrying a test assertion helper) —
install it once per database with `scripts/install-test-helpers.sql` before
the first run against a fresh database:

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
```

---

## Pre-hydration specs and the production-build lane

A form that is operable before it hydrates can lose what a user does to it (DECISION-159). Specs for that live in `e2e/hydration/` and are deterministic: they hold every `/_next/static/**.js` request with `page.route` behind a promise, `goto` with `waitUntil: "domcontentloaded"` (Next's scripts are `async`, so the page parses fully with no JavaScript), assert the pre-hydration state, release the scripts, and use **control enablement** (`toBeEnabled()`) as the hydration signal. Do not synchronize with throttling, `waitForTimeout`, or `networkidle` — they race, and `networkidle` is how this class of bug was masked for a month. Assert **persisted** state with `platformSql`, not just the DOM, and mint your own fixture rows (DECISION-157; the statistics spec uses report year 2096). `hydration/totp-challenge.spec.ts` is the example for a form with no `useForm`: it holds the scripts on `/totp`, asserts the boxes and the toggle are disabled, and then asserts that no `totp.verify_failed` audit row was written (DECISION-192).

These specs run in the normal `npm run test:e2e` (the `chromium` project, dev server) **and** in a second lane against a production build:

```bash
npm run test:e2e:prod     # PW_PROD_BUILD=1: npm run build && npm run start -- --port 3800, hydration specs only
```

The lane always starts its own server (`reuseExistingServer: false`, port 3800, `PW_PROD_PORT` to override), rejects `E2E_BASE_URL`, and `globalSetup` fails if the server on that port is not a production build. It coexists with a dev server in the same checkout (`next build` preserves `.next/dev`). **From a worktree** the build can fail intermittently with `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` (the committed `turbopack.root` is the repo's parent directory, shared with every sibling worktree); build in a scratch copy outside `~/git/presby-platform/` with a **hardlinked** `node_modules`:

```bash
# 1. Nothing exported may beat .env.local; nothing may hold the port.
env | grep -E '^(DATABASE_URL|PLATFORM_DATABASE_URL|APP_DATABASE_URL)='   # must print nothing
lsof -nP -iTCP:3800 -sTCP:LISTEN                                          # must print nothing
grep RATE_LIMIT_DISABLED .env.local                                       # must be =true
# 2-4. Own parent directory, so turbopack.root contains only the copy.
SCRATCH=/private/tmp/presby-select-prod; rm -rf "$SCRATCH"; mkdir -p "$SCRATCH/app"
rsync -a --exclude .git --exclude .next --exclude node_modules \
  --exclude test-results --exclude test-results-prod ./ "$SCRATCH/app/"   # keeps .env.local
cp -al node_modules "$SCRATCH/app/node_modules"   # hardlink, never a symlink; same filesystem
# 5. Builds, starts on 3800, runs e2e/hydration/ only, tears the server down.
(cd "$SCRATCH/app" && npm run test:e2e:prod 2>&1 | tee "$SCRATCH/lane.log")
# 6. Negative control: revert the form under test in the COPY, expect red, restore, expect green.
git show <pre-gate-sha>:"src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx" \
  > "$SCRATCH/app/src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx"
# 7. Clean up.
cd /; rm -rf "$SCRATCH"; lsof -nP -iTCP:3800 -sTCP:LISTEN   # nothing listening
```

If the build ever flakes anyway, `rm -rf "$SCRATCH/app/.next"` and retry. A negative control is part of the job: with the form under test reverted to its pre-gate version, the spec must go red at the pre-release `toBeDisabled()`.

---

## Running Playwright from a worktree

Workflow Rule 16: a pipeline starts its own server on its assigned port and never
attaches to `:3000`, which belongs to the main checkout (or to whichever sibling
started a server there first). `playwright.config.ts` now enforces it: from a
linked git worktree, with the resolved base URL on a loopback host at port 3000
and `PW_ALLOW_3000` unset, loading the config throws with the remedy. The main
checkout and CI are unaffected, and the production-build lane
(`npm run test:e2e:prod`) has its own stricter checks.

```bash
# 1. Your own server, on the port the orchestrator assigned (here 3480), with the
#    fakes the specs expect. The config injects these only into a server IT starts;
#    one you start yourself needs them in its own environment. Note the pid.
# <!-- leak-ok: non-key-shaped test literals, not credentials -->
export CRON_SECRET=giving-e2e-cron-secret STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret
RATE_LIMIT_DISABLED=true DOMAINS_ALLOW_RESERVED_TLDS=1 DOMAINS_PROVIDER=fake \
  DOMAINS_DNS_PROVIDER=fake DOMAINS_FAKE_STATE_FILE="$PWD/.tmp/domains-fake-state.json" \
  npx next dev -p 3480 &

# 2. Point Playwright at it.
E2E_BASE_URL=http://localhost:3480 npx playwright test e2e/admin-login.spec.ts --project=chromium

# 3. Stop it by pid (never `pkill -f next`: that kills your siblings' servers).
kill <pid>
```

The config's own `webServer` entry runs `npm run dev`, which binds `:3000`, so do
not rely on it to start a server on another port: start yours first, as above.
A sign-in run on `:3480` worked without setting `AUTH_URL` when `.env.local` does
not define one; if yours sets `AUTH_URL=http://localhost:3000` and sign-in bounces
to `:3000`, start the server with `AUTH_URL=http://localhost:3480` as well.
`PW_ALLOW_3000=1` accepts the shared-server risk knowingly (for example, the only
checkout running anything). The giving and custom-domain recipes below list the
extra variables those specs need.

---

## Custom domains: real hosts without real domains (Track F)

`e2e/custom-domains/` proves that a church's own domain serves that church and nothing else, with no real domain, DNS or Vercel call. The Playwright project **`custom-hosts`** launches Chromium with `--host-resolver-rules=MAP *.invalid 127.0.0.1`, so `http://www.church-one.invalid:<port>/` is a real page load with that name in `Host` (`.invalid` is reserved by RFC 2606: it can never resolve publicly, and No Real Data holds). A test that needs a request that *lies* about its `Host` sets the header explicitly on the `request` fixture (`rawGet` in `e2e/support/custom-hosts.ts`). Non-production treats loopback as a platform host and `*.invalid` as a custom host; `next.config.ts` allows `**.invalid` in `allowedDevOrigins` so the dev server hydrates there.

```bash
E2E_BASE_URL=http://localhost:3111 npx playwright test --project=custom-hosts     # all five specs, dev server
npm run test:e2e:prod     # now ALSO runs project prod-custom-hosts (headers, lockdown, serving) on the production build
```

- **The first test of `serving.spec.ts` is a canary**: an unknown `*.invalid` host must reach OUR server and get OUR neutral 404 (not a DNS error), so a later failure is a real defect and not a mis-mapped host.
- **The server must have the test fakes.** `playwright.config.ts` sets `CRON_SECRET`, `DOMAINS_ALLOW_RESERVED_TLDS=1`, `DOMAINS_PROVIDER=fake`, `DOMAINS_DNS_PROVIDER=fake` and `DOMAINS_FAKE_STATE_FILE=.tmp/domains-fake-state.json` for a server *it* starts. A dev server you started yourself (port 3000 may belong to another checkout; start yours on another port and set `E2E_BASE_URL`) needs the same in its own environment; `globalSetup` fails with instructions when `CRON_SECRET` is missing. These variables are refused by a Vercel production build (`assertPlatformHostConfig`).
- **Fixtures are SQL on the owner connection, by walking legal edges** (`e2e/support/custom-hosts.ts`, `buildWorld`): three throwaway congregations (`e2e-domains-*`, `deletable_until`), each with a live site and bundle, and domain rows walked `pending -> verified -> attach_pending -> attached -> live`. Domain rows are never deleted by name; deleting the fixture organization is the one thing the delete guard allows, and teardown confirms by SELECT. Rows get `next_check_at` five hours out so the cron sweep specs never lease them.
- **Comparing "byte-identical" 404s.** Next echoes the requested host and path into the streamed payload (and, in dev, into an error template and the `x-middleware-rewrite` header). `snapshot(res, host)` replaces the requested host and normalizes that header, so two states of one host compare exactly (status, body, every non-volatile header); `shape()` compares what a visitor *sees* when the paths differ.
- The specs flip the global `sites.public_render` flag; each restores it in `afterAll` and asserts the restoration. Do not run them concurrently with `sites.test.ts`, which does the same.

---

## Online giving: the signed-event replay harness

Online giving's riskiest code is the webhook, and there is no Stripe account in
CI. So the webhook is tested the way Stripe would drive it: fixture event bodies
(`src/lib/giving/providers/stripe/testing/fixtures/*.json`, one per handled event
type, all invented data) are **signed with the real scheme** and POSTed to the
**real route** of a running dev server, against the real database.

```bash
# The server needs the two secrets this spec signs with. NON-key-shaped literals:
# the SDK only needs HMAC bytes, and a key-shaped string in a public repo is a
# check:secrets finding. STRIPE_SECRET_KEY stays UNSET - the webhook verifies with
# the SDK's static helper, and that is part of what is proved.
# <!-- leak-ok: non-key-shaped test literals, not credentials -->
STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret CRON_SECRET=giving-e2e-cron-secret \
  RATE_LIMIT_DISABLED=true npx next dev -p 3100 &
E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/giving-webhook.spec.ts
```

`playwright.config.ts` passes both secrets to a server *it* starts, so
`npm run test:e2e` needs nothing extra; a server you started yourself needs them
in its environment, and the spec's first test says so in words rather than
failing every case with a 503. Stop only the server you started.

What the spec proves, end to end: a bad signature is a 400 and writes nothing; a
good one is a 200 and the gift is applied from presby's own intent (a body naming
a foreign fund changes nothing); a byte-identical replay is a no-op; an unknown
account and a `livemode` mismatch get the **same 200** and write nothing; a refund
that arrives *before* its gift parks and then applies exactly once after the gift
(the cron retries it); an over-reversal dead-letters and shows on the
congregation's giving overview as a **count only**; `account.application.deauthorized`
disconnects and is audited as a system act; a wrong API version dead-letters with
its code. The secret-unset 503 is a unit test (`route.test.ts`): a running dev
server's environment cannot change per request.

The fixture signer is `testing/sign-event.ts` (`node:crypto`, so Playwright and
the tripwire-restricted tree can import it); `sign-event.test.ts` proves its
header is byte-for-byte what the Stripe SDK's own `generateTestHeaderString`
produces and that `Stripe.webhooks.constructEvent` accepts it.

The rest of the batch is covered by layers that need no server:

| Layer | Where | Run |
|---|---|---|
| Pure: `normalize` (a fixture per event type, anomalies), `status` (v1/v2 agreement table), origin assertions (look-alike hosts, userinfo, ports), request builders, outcome aggregation + audit planning | `src/lib/giving/providers/stripe/*.test.ts`, `src/lib/giving/ingest/outcome.test.ts` | `npm run test` |
| The allowlist: exact export set, forbidden-method grep, SDK-pinned API version, a failure whose message contains the secret never leaks it | `client.test.ts`, `client.sdk.test.ts` (fake SDK) | `npm run test` |
| Processor orchestration with mocked database and client; routes with mocked ingest | `ingest/process.test.ts`, `src/app/api/**/route.test.ts` | `npm run test` |
| The SECURITY DEFINER apply functions, inbox lifecycle (back-off, ageing, dead letters), the processor against the real database with a mocked Stripe client, the connection library, the owner-only health reader | `ingest/*.db.test.ts`, `connection.db.test.ts`, `src/lib/admin/giving-ingest-health.db.test.ts` | `npm run test:db` |

**Starting a gift (Batch 4a: the give actions).** Same rule, one layer up: nothing
calls Stripe and `STRIPE_SECRET_KEY` stays **unset** in e2e.

| Layer | Where | Run |
|---|---|---|
| Form contract: amount strings (`10.999`, `1e3`, `-5`, `٣٠`), every field's refusal, the first-wrong-field order | `src/lib/giving/give-input.test.ts` | `npm run test` |
| The action orchestration with the limiter, Turnstile, database and Stripe allowlist mocked: honeypot spends no budget, the three limiter keys in order, every `GiveResult` arm, `Host`/`X-Forwarded-Host` spoofing cannot move `success_url`; the member gate order, the toggle-only check, the viewer's own `membership_id` | `src/app/(public)/site/[slug]/give/actions.test.ts`, `src/app/(org)/o/[slug]/giving/give/actions.test.ts`, `src/lib/giving/give-session.test.ts` | `npm run test` |
| The real `presby_giving_create_intent_*`, `attach_session`, `fail_intent`, `presby_public_giving_config` and `presby_giving_return_state` behind the wrappers: the refusals as `GiveResult`s, a Stripe failure leaving a `failed` row, a repeat key never minting a second session, the flood cap, the five return panels, the byte-identical `absent` | `src/lib/giving/give-session.db.test.ts` (the TS/SQL gross-up grid is `money.db.test.ts`) | `npm run test:db` |
| The enforced CSP on the give routes: `next.config.ts` `headers()` (unit) and over HTTP (present on `/site/<slug>/give[/...]` and `/o/<slug>/giving/give[/...]`, absent on every neighbour) | `src/lib/giving/csp.test.ts`, `e2e/security-headers.spec.ts` | `npm run test`; Playwright on a dev server |

With Stripe unset the give action writes the intent, marks it `failed` and
answers `unavailable` - that is the e2e path, and the persisted row is what a
spec asserts. **Restart the dev server after any `next.config.ts` change**
(including a temporary mutation to prove a test fails): Next reloads the config
mid-run and a server left on a half-edited file serves the wrong headers.

**Not covered, and why.** Nothing here calls Stripe: not the account create, the
onboarding link, Checkout, the balance-transaction or invoice reads, or a real
`account.updated` for a v2 account. Those need the operator's test-mode platform
account and are the smoke checklist in `docs/deployment.md` → "Online giving
(Stripe)". Automating Stripe-hosted Checkout is out of scope permanently.

---

## Continuous integration

Two workflows run the database-backed suites on an ephemeral Neon branch:
`.github/workflows/db.yml` (`npm run test:db` + `scripts/test-rls.sql`) and
`.github/workflows/e2e.yml` (Playwright, running-server). Both consume the
same `.github/actions/neon-ci-db` composite action so they can never drift
from each other's database-provisioning recipe — a hand-maintained duplicate
recipe is exactly how `e2e.yml` went a month without ever having run
successfully (test-coverage review 2026-09-25, C-5). Each gets its **own**
branch and deletes it in an `if: always()` step; they never share one, because
`scripts/test-rls.sql`'s exact-count assertions and Playwright's fixture
users would otherwise invalidate each other.

**No Real Data, for CI specifically: a CI database contains only rows CI
created.** Each ephemeral branch is forked from an explicitly pinned parent
(`development`) — never the implicit default, which is the project's primary
branch, `production`, holding two real congregations — and the job
immediately creates a fresh database inside the branch and never opens the
parent's own `neondb` again. No connection string, log line, or uploaded
Playwright trace can therefore carry a row that predates the run. See
DECISION-150.

Both workflows carry a `check-secrets` gate job that reports `::notice::` and
skips cleanly (not a green no-op) when `NEON_API_KEY`/`NEON_PROJECT_ID` are
absent — see `docs/deployment.md` for what adding them turns on.

**Shape of the runs (2026-10-23).** `db.yml` runs `npm run test:db` as four
`--shard=i/4` jobs, each on its own ephemeral branch (so no two shards share a
database), plus one `rls` job that runs `scripts/test-rls.sql` as `presby_app`
on a fresh branch of its own. `e2e.yml` runs a `dev` lane (Playwright against
`next dev`) and a `prod` lane (the hydration specs against `next build &&
next start`) as parallel jobs, again one branch each. The composite action's
`compute_cu` input fixes the branch's compute size after creation (the Neon
create-branch action has no such input); a branch is born at the project
default, 0.25-8 CU autoscaling. Measured wall times: db shards 5-15 min, rls
4 min, e2e dev lane 23 min, prod lane 5 min. Two files hold state a from-empty
database lacks and the suites assume: `scripts/ci/e2e-baseline-flags.sql`
(global flags the e2e specs expect ON, applied by e2e.yml only) and
`scripts/ci/db-baseline.sql` (one active platform admin, applied by the db
shards only, never the rls job). A spec that asserts against a flag it does not
set belongs in the first file.

**Before a QA e2e run on a pipeline branch**, reset the global flags: a branch
inherits `development`'s flags plus whatever earlier runs left, so a spec can pass
there that CI's from-empty database fails. `scripts/ci/e2e-reset-flags.sql` sets
every `feature_flags` row to its `scripts/seed.ts` value and then applies the
baseline, in one transaction. It refuses unless you pass `-v pipeline_branch=1`
(it would switch off flags an operator turned on for a demo if run against
`development`), and `scripts/e2e-reset-flags.test.mjs` fails `npm test` if its
list drifts from the seed. Run it with `psql -f` (so `\ir` resolves), keeping
the connection string in the environment:

```bash
npx dotenv -e .env.local -- sh -c 'psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -v pipeline_branch=1 -f scripts/ci/e2e-reset-flags.sql'
```

It resets global `feature_flags.enabled` only; `rollout_percent` and the
per-organization toggles are not touched. State in the verdict that you ran it.

`db-tests` deliberately does **not** set `RATE_LIMIT_DISABLED` — it is the
one place in this repo's test suites where the sign-in limiter is exercised
live, for real, under the standard config. `e2e` keeps `RATE_LIMIT_DISABLED=
true`, because its shared fixture user signs in far more than 5/min.

`e2e.yml` runs the production lane as a second step of the same job (`if: ${{ !cancelled() }}`, traces in `test-results-prod/`); like the rest of that job it is paper until `NEON_API_KEY` is added, so the local lane run is the gate until then.

The retrospective's `deletable_until` fixture-exemption fuse (a 2-hour window
before a scratch-org fixture becomes permanently undeletable, Rule-16 finding
5) does not apply to CI's ephemeral branches — the whole branch is deleted
wholesale in `if: always()` regardless of any row's `deletable_until`.

**Rehearsing this recipe by hand — never against a shared branch's own
database.** The composite action's provisioning step runs `ALTER ROLE
presby_app WITH LOGIN PASSWORD '<random>'` on whichever database it's pointed
at. That statement is **cluster-wide within the branch it runs on** — it
changes the role's actual password, not something scoped to a database or
undoable by restoring a file. If you rehearse this recipe against a shared,
persistent branch (e.g. this repo's own dev/pipeline branches) instead of a
throwaway branch or a freshly `CREATE DATABASE`d database on one, you will
leave `presby_app`'s password different from whatever `.env.local` still
documents when you're done — restoring `.env.local` cannot undo it (this
happened once, QA repaired it, 2026-09-26). Either (a) rehearse against a
`CREATE DATABASE`'d fresh database and drop it when done — the password
change is harmless because nothing else authenticates against that database
— or, if you must run the statement against a shared branch's existing
database for some reason, (b) set the password back to the exact value
`.env.local` already documents before you finish.

---

## Fixture database calls: `withDbRetry`

Fixtures talk to Neon over its HTTP driver, which now and then answers `fetch failed`
or `Connection terminated`. `withDbRetry(label, step)` in `e2e/support/db.ts` retries
a step five times (0.5, 1, 2, 4 s) **only** for a dropped connection (SQLSTATE class
08, `57P01`-`57P03`, `53300`, or a reset/refused/connect-timeout message); a unique
violation, a missing table, a statement or lock timeout, or a bug throws at once, and
the original error is rethrown after the last attempt. Only the outermost call retries.

The catch: a dropped reply can mean the statement **landed**, so a step may be wrapped
only if repeating it ends in the same state.

- **R1** Wrap a step only if a repeat after "committed but the reply was lost" leaves the same end state.
- **R2** Wrap whole units: disable-trigger / work / enable-trigger is one step with the re-enable in `finally`.
- **R3** Safe by shape: reads, `delete`, `update ... set x = <constant>`, `insert ... on conflict ... do nothing|update`, `insert ... where not exists`, a `delete`-then-`insert` that re-clears first.
- **R4** Never wrap a unit that reads a value and overwrites it when the read is kept as "prior state" (the retry would capture the new value); wrap the read and the write separately.
- **R5** Never wrap a plain `insert` or a state-machine edge (`set state = '<next>'`).
- **R6** Wrap inside the fixture function so no spec changes. Spec-inline `afterAll` SQL is not covered.

Teardown and sweeps are wrapped in every fixture; setup is wrapped only where the
rules allow, so setup functions that insert plainly (`setupGivingFixture`,
`setupInviteOrg`, `buildWorld` ...) are deliberately not. A real drop cannot be
induced on demand, so the retry path is pinned by injected-failure tests
(`scripts/with-db-retry.test.mjs`) and each wrapped step's idempotence rests on this reading.

---

## Reports for the retrospective

`npm run stats:escape` prints the escape-rate breakdown for the last 30 days.
The retrospective cadence is 14 days, so `npm run stats:escape -- --since=<date>`
(or `"N days ago"`) counts from the last retrospective instead of double-counting
the overlap; the header then reads "since <date>". git compares the committer
date, so an amended or rebased commit counts from when it was rewritten.

`npm run worktrees:report` prints the free disk space and, for each git worktree,
its branch, whether it has commits of its own and, if so, whether all of them are
on `origin/main` ("merged"), whether it has uncommitted or untracked files, and
its `node_modules` / `.next` sizes, with suggested cleanup commands. It suggests
`git worktree remove` only for a merged, clean worktree: never for a new pipeline
worktree, a squash-merged or fast-forwarded one, or one with changes. It deletes
nothing (`--no-sizes` skips the slow `du`). Below 20 GiB free it says so: a full
disk has surfaced as a Neon `fetch failed`.

---

## Two things that will bite you

**Rate limiting.** Sign-in is capped at 5/min per ip:email, and a blocked
attempt renders as "Wrong email or password" while leaving
`failed_login_attempts` at 0 — indistinguishable from a bad password. Set
`RATE_LIMIT_DISABLED=true` in `.env.local` when testing by hand. Never in
production.

**Cached sessions.** `e2e/support/.auth/` holds signed-in browser state for 12
hours. If a fixture's email ever changes, `rm -rf e2e/support/.auth/` or the
suite silently reuses a session carrying the old address.
