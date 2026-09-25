# PresbyPortal

A multitenant platform for Presbyterian congregations, presbyteries, and
synods: church management (rolls, officers, directory, giving, events),
council operations, per-tenant websites, and a support-ticket loop worked
partly by AI — built so the database enforces the polity rather than trusting
the application to remember it.

The project is named **PresbyPortal** (`presbyportal.org`, DECISION-126).
`presby` still threads through the database role, the SQL function prefix, and
every migration filename — that's deliberate continuity, not an unresolved
placeholder, and its own future rename pipeline is tracked in `docs/TODO.md`.

**Status: pre-release.** The domain schema, isolation model, tenant portal,
public-site renderer, presbytery oversight surfaces, and the platform admin
shell all exist and are tested. Production is deployed and reachable at
[presbyportal.org](https://www.presbyportal.org) — but sign-in is currently
gated off there by operator decision (no OAuth provider or email delivery
configured yet), so it serves public pages only. See `docs/deployment.md` for
the current, verified state of what's live.

**Stack:** Next.js 16 · React 19 · TypeScript (strict) · Drizzle ORM · Neon
Postgres · NextAuth 5 (Google + credentials + TOTP) · Tailwind 4 · Vitest ·
Playwright · Vercel · **Node.js 22+**

---

## No real data. Ever.

This repository is public and **no real congregation, person, address, email,
or credential enters it** — not in code, seeds, migrations, scripts, docs,
work-logs, or commit messages. `scripts/seed-dev.sql` is the house style:
invented names and `example.invalid`/`.invalid` addresses.

`private/` and `scratch/` are gitignored **and** blocked by a pre-commit hook,
because `.gitignore` is bypassable with `git add -f`, and an agent running
`git add -A` is the real failure mode. A `check:secrets` tripwire scans every
tracked file on every push for key- and credential-shaped strings, off-allowlist
email addresses, and phone/SSN-shaped numbers.

---

## Running it locally

You need a [Neon](https://neon.tech) Postgres project and Node 22+.

```bash
npm install
cp .env.example .env.local     # fill it in — see docs/deployment.md for what each variable is

npm run db:migrate             # tables, RLS, triggers, functions
npm run db:seed                # roles, features, flags
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql   # synthetic congregation fixture

npm run dev                    # http://localhost:3000
```

Verify isolation actually works before trusting it — running it as the table
owner instead of the application role proves nothing:

```bash
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
```

**[`docs/testing.md`](docs/testing.md)** has the fixture accounts, the
hand-testing walkthrough, and how to run the DB-backed automated suites.
**[`docs/deployment.md`](docs/deployment.md)** is the operational record of
what's actually deployed and every environment variable it needs.

Common commands (`npm run dev`, `build`, `typecheck`, `lint`, `test`,
`test:e2e`, `db:push`/`db:generate`/`db:migrate`, `check`) are documented in
full in [`CLAUDE.md`](CLAUDE.md) → Common Commands.

---

## How this is built

Every feature runs through a six-phase pipeline — functional refinement,
architectural review, technical design, implementation, test verification, and
a shipped-vs-intent check — worked by named agents (analyst, architect,
tech-lead, database-admin/api-developer/ux-developer, qa) with a work-log per
feature in `docs/work-log/`. It's heavier than most projects need; it's in the
open because the reasoning is the interesting part. Full detail:
[`CLAUDE.md`](CLAUDE.md) → Development Pipeline.

A handful of invariants — properties the schema and RLS policies are meant to
enforce as database facts, not just application conventions — shape everything
else: isolation is a database property (`FORCE ROW LEVEL SECURITY` on every
tenant table, `NOBYPASSRLS` on the application role), the roll is an
append-only system of record that everything else projects from, the court
(Session/diaconate) is materialized rather than a group anyone can edit, access
flows up by publication and never down by inheritance, and no role — not even
an administrator's — carries a wildcard across sensitivity tiers. Full detail:
[`CLAUDE.md`](CLAUDE.md) → Key Invariants.

For a from-scratch read on what's being built and why, see
[`docs/architecture.md`](docs/architecture.md) (the in-repo version) or the
published architecture page at
[chenson42.github.io/presby](https://chenson42.github.io/presby/).

Two findings worth reading even if you never touch this codebase: **F1**,
where `FORCE ROW LEVEL SECURITY` was missing and every naive test still
passed, and **F26**, where a guard written to stop identity enumeration was
itself defeated by the RLS it was meant to complement — it read zero rows for
exactly the person it protected. Reading the schema found the design problems;
*running* it found the security problems. Full findings log:
[`docs/schema-design.md`](docs/schema-design.md).

Start here:

- **[`CLAUDE.md`](CLAUDE.md)** — how the pipeline, the invariants, and the
  review cadences actually work
- **[`docs/STATE.md`](docs/STATE.md)** — where the project stands right now
- **[`docs/product/functionality-map.md`](docs/product/functionality-map.md)**
  — a scannable inventory of everything built
- **[`docs/decisions.md`](docs/decisions.md)** — numbered decision log, newest
  first

---

## License

MIT. See [LICENSE](LICENSE).
