# presby

Church and council management for Presbyterian congregations, presbyteries, and synods — the roll, officers, directory, and the reports that derive from them, built so the database enforces the polity rather than trusting the application to remember it.

**Status: pre-release.** The domain schema, the isolation model, and the read paths exist and are tested. There is no church-facing UI yet. Not deployed anywhere. Not yet named — `presby` is a placeholder that runs through the database role, the SQL functions, and the migration filenames.

**Stack:** Next.js 16 · React 19 · TypeScript (strict) · Drizzle ORM · Neon Postgres · NextAuth 5 (Google + credentials + TOTP) · Tailwind 4 · Vitest · Playwright · Vercel

---

## No real data. Ever.

This repository is public-bound and **no real congregation, person, address, email, or credential enters it** — not in code, seeds, migrations, scripts, docs, work-logs, or commit messages. `scripts/seed-dev.sql` is the house style: invented names and `example.invalid` addresses.

`private/` and `scratch/` are gitignored **and** blocked by a pre-commit hook, because `.gitignore` is bypassable with `git add -f`, and an agent running `git add -A` is the real failure mode.

---

## What makes this different from a generic membership app

Four constraints come from Presbyterian polity, not from software taste. They are the reason the schema looks the way it does.

**The roll is the system of record.** `roll_actions` is append-only. An approved action is frozen by trigger and corrected by recording a `void`, never by an update. The directory is a *view* of the roll, the annual statistical report is a *projection* of it, per capita derives from it. The report asks for *changes over a year*, not a snapshot — which is why a status column cannot produce it, and why clerks hand-tally it every January.

**A person is global; membership is org-scoped.** Ministers of Word and Sacrament are members of the *presbytery* (G-2.0502) while ruling elders are members of the *congregation*, so one person's roll and their service routinely sit at different organizations. `people` holds the human; `memberships` carries roll status per org.

**The court is not a group.** Session and diaconate rosters are *materialized* from `officer_terms` by trigger and reject direct writes. If staff could add someone to the Session by hand, the court would be invalid and every action it minuted questionable. Ordination is lifelong; service is termed.

**Access flows up by publication, never down by inheritance.** A presbytery administers its own organization and gets nothing inside a member congregation except what that congregation publishes. The only downward paths are an administrative commission and a session-granted delegation — both time-boxed and minuted.

## Isolation is a database property

`presby_app` is `NOBYPASSRLS` and every tenant table is **`FORCE ROW LEVEL SECURITY`**. Without `FORCE`, Postgres exempts the table owner, row-level security is silently inert, and every naive test still passes.

There are **two connections**: `db` (RLS enforced — the application) and `getPlatformDb()` (bypasses RLS — platform admin pages only). `users.is_platform_admin` decides which *pages* are reachable, never whether a query is filtered.

RLS enforces *tenancy*, not authorization: the policy trusts whatever organization id it is handed, so `withOrgContext()` verifies membership **before** setting the org GUC. That transaction-scoped GUC is also why the driver is the WebSocket pool (`drizzle-orm/neon-serverless`) and not neon-http — neon-http has no session and no transaction support, so it cannot carry the setting at all. The isolation model chose the driver.

`scripts/test-rls.sql` holds 36 assertions and **must be run as `presby_app`**. Run as the owner it proves nothing.

---

## What's built

| Area | State |
|---|---|
| Domain schema | 37 tenant tables — organizations, people, memberships, roll actions, transfer certificates, ordinations, officer terms, derived groups, authorization, privacy/consent, statistical-report scaffold |
| Isolation | FORCE RLS on every tenant table, bespoke policies for the global person tables, two connections, 36 passing assertions |
| Authorization | `presby_effective_permissions(person, org, as_of)` — direct, group, commission, and delegation arms, each result carrying its provenance |
| Roll | `presby_roll_as_of`, `_counts_as_of`, `_changes`, a daily reconcile, and a cache-drift detector |
| Officers | `presby_officer_roster(org, office, as_of)` and `_history` |
| Schema reference | `/developer` — generated index, per-table pages, per-module ER diagrams. Descriptions live in Postgres `COMMENT ON`, so they cannot drift from the database |
| Platform shell | Auth (Google OAuth, credentials, TOTP 2FA, trusted device, lockout), roles + permissions, feature flags, audit log, email queue with retry, member feedback, what's-new |

**Not built:** any church-facing UI. The roll read path is complete and nothing surfaces it. Ledger and giving, events, worship, check-in, per-tenant websites, and the support-ticket loop are not designed yet.

---

## Quick start

You need a [Neon](https://neon.tech) Postgres project and Node 20.9+.

```bash
npm install
cp .env.example .env.local     # then fill it in — see below

npm run db:migrate             # apply drizzle/0000–0012: tables, RLS, triggers, functions
npm run db:seed                # roles, features, demo flag
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql   # synthetic church fixture

npm run dev                    # http://localhost:3000
```

Verify isolation actually works before trusting it:

```bash
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
```

Use `db:migrate`, not `db:push`, for the initial setup. The four `drizzle/00XX_presby_*.sql` migrations are hand-written — row-level security, triggers, and functions are **not** emitted by Drizzle Kit — so `npm run db:push` alone gives you tables with no isolation, no frozen roll actions, and no derived rosters. `db:push` is for iterating on table shape once the rest is applied.

### Four connection strings, and the difference matters

| Variable | Role | Used by |
|---|---|---|
| `DATABASE_URL` | `presby_app`, pooled, RLS **enforced** | The application |
| `PLATFORM_DATABASE_URL` | Bypasses RLS | Platform admin pages only |
| `MIGRATE_DATABASE_URL` | Owner, direct (unpooled) endpoint | DDL and migrations |
| `APP_DATABASE_URL` | `presby_app` with login | The RLS test suite |

Pointing the app at the owner role makes every isolation guarantee in this repo silently false while every test still passes.

---

## Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run test           # Vitest unit tests
npm run test:e2e       # Playwright (needs a dev server)
npm run db:push        # sync schema to the database (lossy — dev only)
npm run db:generate    # generate a versioned SQL migration
npm run db:migrate     # apply committed migrations (use this in staging/prod)
npm run db:seed        # roles, features, demo flag
npm run check          # both tripwires: audit coverage + sql<Date> guard
npm run docs:erd       # regenerate the /developer ER diagrams
```

Testing on a phone over your LAN? Set `DEV_ALLOWED_ORIGINS` to your machine's LAN IP, or Next blocks `/_next/*` and the page renders but never hydrates.

## Environment variables

Copy `.env.example` → `.env.local`. Never commit `.env.local`.

| Variable | What it is | Required? |
| --- | --- | --- |
| `DATABASE_URL` | `presby_app` pooled connection — the app's RLS-enforced connection | Yes |
| `PLATFORM_DATABASE_URL` | RLS-bypassing connection for platform admin pages | Yes |
| `MIGRATE_DATABASE_URL` | Owner role on the direct endpoint, for DDL | Yes (for schema work) |
| `APP_DATABASE_URL` | `presby_app` with login, for `scripts/test-rls.sql` | Yes (for the RLS suite) |
| `AUTH_SECRET` | NextAuth session signing key — `openssl rand -base64 32` | Yes |
| `AUTH_URL` | Public origin, e.g. `http://localhost:3000` | Yes |
| `NEXT_PUBLIC_APP_URL` | Public origin used to build links in emails | Yes |
| `AUTH_TOTP_ENCRYPTION_KEY` | 32-byte base64 key encrypting 2FA secrets. **Rotating it invalidates every enrolment.** | Yes |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth credentials | For Google sign-in |
| `INITIAL_ADMIN_EMAILS` | Comma-separated emails auto-granted the `admin` role on first sign-in | Recommended |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Local credentials admin. Delete before any deploy. | Optional |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Resend key + sender. Without them, email logs to stdout in dev. | Optional |
| `CRON_SECRET` | Bearer token guarding the cron routes (email queue, daily maintenance) | Production |
| `DEV_ALLOWED_ORIGINS` | Comma-separated origins allowed to fetch dev assets (LAN phone testing) | Dev only |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Distributed rate limiter | Optional |

---

## How this repo is built

Every feature runs through a six-phase pipeline — functional refinement, architectural review, technical design, implementation, test verification, and a shipped-vs-intent check — worked by named agents in `.claude/agents/`, with a work-log per feature in `docs/work-log/`. It is heavier than most projects need. It is in the open because the reasoning is the interesting part.

Start here:

- **[`CLAUDE.md`](CLAUDE.md)** — how the pipeline, the invariants, and the review cadences actually work
- **[`docs/STATE.md`](docs/STATE.md)** — where the project stands right now
- **[`docs/schema-design.md`](docs/schema-design.md)** — the schema rationale, decisions D1–D9, and all 29 review findings, including the ones that would have shipped
- **[`docs/decisions.md`](docs/decisions.md)** — numbered decision log, newest first

Two findings worth reading even if you never touch this codebase: **F1**, where `FORCE ROW LEVEL SECURITY` was missing and every naive test still passed, and **F26**, where a guard written to stop identity enumeration was itself defeated by the RLS it was meant to complement — it read zero rows for exactly the person it protected. Reading the schema found the design problems; *running* it found the security problems.

---

## License

MIT. See [LICENSE](LICENSE).
