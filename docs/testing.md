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
| `admin-2fa@presby.invalid` | Admin with 2FA required, **not enrolled** | `/totp` → `/account/2fa` to enrol |
| `admin-2fa-enrolled@presby.invalid` | Admin with 2FA required, **already enrolled** (fixed test secret, see `e2e/support/totp-fixture.ts`) | `/totp`, and a real 6-digit code lands it on `/admin` |
| `org1@presby.invalid` | One congregation | straight into `/o/e2e-alpha` — no chooser |
| `org1-org2@presby.invalid` | A congregation **and** a presbytery | the chooser, two cards |
| `org3-unmanaged@presby.invalid` | Only an `unmanaged` congregation | `/no-organization` |
| `org2-ended@presby.invalid` | A relationship that **ended** 31 Mar 2026 | `/no-organization` |
| `clerk.fixture@example.invalid` | Tobias Renwick at Alder Creek — holds `stated_clerk` (`role_grants.manage`, and — groups-and-officers, 2026-08-26 — `officers.manage`) | `/o/alder-creek` — try `/o/alder-creek/admin/roles` (`org_portal.roles` flag permitting) and `/o/alder-creek/admin/officers` (`org_portal.officers` flag permitting) by hand |
| `elder.fixture@example.invalid` | Marguerite Ashcombe at Alder Creek — holds `support_contact` (`tickets.file`), support-tickets pipeline | `/o/alder-creek` — try `/o/alder-creek/tickets` and `/o/alder-creek/feedback` by hand, `org_portal.tickets` flag permitting |

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
- `/developer` — generated schema reference. Requires
  `users.is_platform_admin`, which **nothing currently seeds** — so it is
  unreachable by every fixture above until you set that column by hand.

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

`db-tests` deliberately does **not** set `RATE_LIMIT_DISABLED` — it is the
one place in this repo's test suites where the sign-in limiter is exercised
live, for real, under the standard config. `e2e` keeps `RATE_LIMIT_DISABLED=
true`, because its shared fixture user signs in far more than 5/min.

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

## Two things that will bite you

**Rate limiting.** Sign-in is capped at 5/min per ip:email, and a blocked
attempt renders as "Wrong email or password" while leaving
`failed_login_attempts` at 0 — indistinguishable from a bad password. Set
`RATE_LIMIT_DISABLED=true` in `.env.local` when testing by hand. Never in
production.

**Cached sessions.** `e2e/support/.auth/` holds signed-in browser state for 12
hours. If a fixture's email ever changes, `rm -rf e2e/support/.auth/` or the
suite silently reuses a session carrying the old address.
