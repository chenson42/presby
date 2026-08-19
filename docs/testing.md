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
npm run db:migrate     # or apply drizzle/00XX_presby_*.sql by hand — see the note below
npm run db:seed        # roles, features, flags — application catalog data
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql   # the synthetic congregation fixture
npm run dev
```

The **e2e fixtures** (the accounts in the table below) are provisioned by the
Playwright suite's `globalSetup`, not by `db:seed` — the suite owns its users
(DECISION-032). Running `npm run test:e2e` once creates them. There is no
separate command, deliberately: a second provisioning path is a second thing to
drift.

> **Local note.** `drizzle.__drizzle_migrations` on the dev database records only
> the first ten migrations; 0010–0015 were applied with `psql`. So `db:migrate`
> is not the local apply command on this branch — it would try to re-run 0010.

---

## Accounts

Password for every fixture: **`e2e-fixture-only-not-a-secret`**

| Sign in as | Who they are | Where sign-in lands them |
|---|---|---|
| `admin@presby.invalid` | Platform admin, no congregation | `/admin` |
| `member@presby.invalid` | Platform member, no congregation | `/no-organization` |
| `admin-2fa@presby.invalid` | Admin with 2FA required, **not enrolled** | `/totp` → `/account/2fa` to enrol |
| `org1@presby.invalid` | One congregation | straight into `/o/e2e-alpha` — no chooser |
| `org1-org2@presby.invalid` | A congregation **and** a presbytery | the chooser, two cards |
| `org3-unmanaged@presby.invalid` | Only an `unmanaged` congregation | `/no-organization` |
| `org2-ended@presby.invalid` | A relationship that **ended** 31 Mar 2026 | `/no-organization` |

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

## Two things that will bite you

**Rate limiting.** Sign-in is capped at 5/min per ip:email, and a blocked
attempt renders as "Wrong email or password" while leaving
`failed_login_attempts` at 0 — indistinguishable from a bad password. Set
`RATE_LIMIT_DISABLED=true` in `.env.local` when testing by hand. Never in
production.

**Cached sessions.** `e2e/support/.auth/` holds signed-in browser state for 12
hours. If a fixture's email ever changes, `rm -rf e2e/support/.auth/` or the
suite silently reuses a session carrying the old address.
