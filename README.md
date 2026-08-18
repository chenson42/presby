# Claude Code Starter

Two things in one repo:

1. **A fork-and-go Next.js starter** for small-to-medium web apps that need login, an admin shell, roles + permissions, 2FA, feature flags, audit logging, and a self-serve account page on day one.
2. **A working example of how to use [Claude Code](https://claude.ai/code) to build web software** — agent roles, a 6-phase pipeline, work-log discipline, periodic reviews, slash-command skills, and project memory. Every artifact is real and in the repo; nothing is mocked.

**Stack:** Next.js 16 · React 19 · TypeScript · Drizzle ORM · Neon Postgres · NextAuth 5 (Google + Credentials) · Resend · Tailwind 4 · Vitest · Playwright · Vercel

**Workflow:** [`CLAUDE.md`](CLAUDE.md) — the 6-phase pipeline, review cadence, agents, skills, and invariants Claude follows when working in this repo.

---

## Start with the deck

The fastest way in is the **training deck** — a 48-slide walkthrough of the stack, the agent SDLC workflow, and the day-to-day patterns I use with Claude Code.

> **[`deck/slides.pdf`](deck/slides.pdf)** — committed to the repo so you can read it without installing anything. **Source:** [`deck/slides.md`](deck/slides.md) (Marp markdown).
>
> Topics covered: the stack and why each piece earns its keep · GitHub workflow for non-engineers · what to commit vs. never commit · `.env.example` discipline · `CLAUDE.md` as project memory · the agent roster and the 6-phase pipeline · skills, memory, and `--dangerously-skip-permissions` · plan mode · Cloudflare tunnel for sharing your laptop · the periodic-review cadence and why each one exists · the deck pipeline itself.

Render locally with `npm run deck` — Marp produces both PDF and PPTX outputs.

---

## Is this a good fit for your project?

**Good for**

- Internal tools, ops dashboards, admin-heavy apps
- Small SaaS or B2B web apps where you need real users, roles, audit logs, and 2FA before you ship anything else
- Side projects you want to look professional from day one
- Client / demo work where you'd otherwise hand-roll auth + admin every time
- Teaching or learning agent-led SDLC patterns on a non-trivial codebase

**Not the right fit for**

- High-traffic consumer apps (the default rate limiter is in-memory; sessions are JWT-only — see v0.3 release notes for the Upstash upgrade path)
- Apps with a heavy domain data model — the starter ships auth + admin + flags + audit; **your data tables and your business logic are still yours to build**
- Static marketing sites (overkill)
- Mobile apps (this is a Next.js web app)

---

## What you get out of the box

**Authentication & accounts**

- Google OAuth and email + password (NextAuth 5 beta, JWT sessions)
- TOTP 2FA with QR-code enrollment, recovery codes, encrypted at rest
- Self-serve `/account` page — profile, email change with re-verification, password change, 2FA enrollment for any user, delete-account skeleton
- Forgot-password flow with one-shot tokens stored hashed at rest, enumeration-defended

**Admin shell at `/admin`**

- Users list with role assignment + per-user detail page
- Per-user 2FA bypass + force-reset for demo/test accounts
- Feature flag toggles
- Release-notes viewer that reads `docs/release-notes/vX.Y.md`
- TOTP admin tools

**Security infrastructure**

- Roles ↔ features permission model (`FEATURES` catalog + `hasFeature()`)
- Environment feature flags, separate from permissions (`isFlagEnabled()`)
- Append-only audit log with a typed `AUDIT_ACTIONS` catalog
- Edge route gate (`src/proxy.ts`) for auth + 2FA enforcement before any page renders
- Rate limiting on signin, password-reset, email-change, and TOTP verify (in-memory default, optional Upstash Redis)

**Developer infrastructure**

- Vitest unit tests + Playwright e2e (chromium) wired and configured
- Drizzle-Kit migrations with a committed initial migration
- Resend wired for transactional email
- Seed script that bootstraps roles, features, and a local-credentials admin
- Marp deck pipeline (`npm run deck`)

---

## The SDLC bit — agents, pipeline, work-logs

If you only want the starter, skip this section. If you want a concrete example of building real software with Claude Code, this is the part to read.

The repo is structured around a six-phase pipeline that every feature flows through:

```
analyst → architect → tech-lead → implementer → qa → analyst
  (intent)   (shape)    (design)    (build)     (verify)  (ship)
```

Each phase is owned by a specific **agent** (a markdown file under [`.claude/agents/`](.claude/agents/) that defines a role and its triggers). The full roster: `analyst`, `architect`, `tech-lead`, `api-developer`, `ux-developer`, `full-stack-developer`, `database-admin`, `deployment-engineer`, `qa`.

For every feature or bug fix, a **work-log entry** at [`docs/work-log/`](docs/work-log/) tracks the feature through all six phases — verdicts, design decisions, file changes, test results, ship-vs-intent diff. Real examples to read:

- [`2026-05-16-per-user-2fa-bypass.md`](docs/work-log/2026-05-16-per-user-2fa-bypass.md) — a multi-decision feature with scope expansion
- [`2026-05-16-admin-signin-access-pending.md`](docs/work-log/2026-05-16-admin-signin-access-pending.md) — a bug-fix variant where the e2e test uncovered the bug
- [`2026-05-17-account-page.md`](docs/work-log/2026-05-17-account-page.md) — a bundle that bumped against an architect's suggested split

Seven **periodic reviews** with their own cadences (test coverage, retrospective, code, docs, security, agents, dependencies) keep the codebase honest over time. [`docs/reviews/log.md`](docs/reviews/log.md) is the source of truth.

**Slash-command skills** under [`.claude/skills/`](.claude/skills/) automate the repetitive bits: `/pre-push`, `/release-notes`, `/new-feature`, `/security-review`, `/review`. These are real Claude Code skills that run in this repo today.

The whole approach is documented in [`CLAUDE.md`](CLAUDE.md). Fork it, trim it, replace it — but read it first.

---

## Quick start

```bash
# 1. Clone + install
gh repo clone chenson42/claudecode-nextjs-starter my-app
cd my-app
npm install

# 2. Copy env template + fill in values (see below)
cp .env.example .env.local

# 3. Apply schema migrations to your Neon database
npm run db:push    # quick & lossy — fine for a fresh DB
# (or: npm run db:migrate to apply the committed SQL migrations)

# 4. Seed roles, features, demo flag, and (optionally) a local admin
npm run db:seed

# 5. Run
npm run dev
```

**Sign in via Google:** any email listed in `INITIAL_ADMIN_EMAILS` (comma-separated) receives the `admin` role automatically on first sign-in.

**Sign in without Google:** set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` in `.env.local` before running `npm run db:seed` — that provisions a Credentials-login admin with 2FA disabled, ideal for local development and demos.

Then enroll in 2FA at `/account/2fa` (or `/admin/2fa`), and everything in `/admin` is yours.

---

## Common commands

```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run test         # Vitest unit tests (run once)
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Playwright e2e (dev server must be running)
npm run db:push      # Sync Drizzle schema → DB (lossy; dev only)
npm run db:generate  # Generate a SQL migration (use once you have real data)
npm run db:migrate   # Apply committed migrations (production-safe)
npm run db:seed      # Seed roles + features + demo flag + local admin
npm run check:audit  # Tripwire: every action mutation must have an audit row
npm run deck         # Render the training deck → slides.pptx + slides.pdf
```

---

## Environment variables

Copy `.env.example` → `.env.local` and fill these in:

| Variable | What it is | Required? |
| --- | --- | --- |
| `DATABASE_URL` | Neon Postgres connection string (pooled) | Yes |
| `AUTH_SECRET` | NextAuth session signing key — `openssl rand -base64 32` | Yes |
| `AUTH_URL` | Public origin, e.g. `http://localhost:3000` | Yes |
| `NEXT_PUBLIC_APP_URL` | Public origin used to build email links | Yes |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth credentials | Yes (for Google sign-in) |
| `AUTH_TOTP_ENCRYPTION_KEY` | 32-byte base64 key for encrypting 2FA secrets — `openssl rand -base64 32`. **Rotating it invalidates every enrolled secret.** | Yes |
| `INITIAL_ADMIN_EMAILS` | Comma-separated emails that auto-receive the `admin` role on first sign-in | Recommended |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Credentials-login admin for local development | Optional |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Resend API key + sender (`Name <noreply@yourdomain.com>`). Emails log to stdout in dev if absent. | Optional |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Activates the distributed rate limiter. Recommended for production deployments. | Optional |
| `RATE_LIMIT_DISABLED` | Set to `true` in `.env.local` to bypass rate-limits during e2e iteration. **Never set in production.** | Optional |

Never commit `.env.local`. `.gitignore` enforces this.

---

## Forking notes

- **Run `/personalize-starter` first.** It walks you through identity, branding, and the three strategic docs (product vision, business plan, branding) in one pass, then does every find-replace across the codebase. Saves you from finding "Claude Code Starter" hardcoded in a sign-in heading three months from now.
- The `.claude/agents/`, `.claude/skills/`, and `CLAUDE.md` describe my own workflow opinions. Rewrite them as you go — they're meant to be replaced, not preserved verbatim.
- The 6-phase pipeline in `CLAUDE.md` is heavy. Trim it to whatever you actually use. The whole point is to make the discipline *visible*, not to make every fork follow it.
- The author runs Claude Code with `--dangerously-skip-permissions` — if you don't, ignore the "Original Author's Setup" section of `CLAUDE.md`. Everything in "How Claude Should Behave in This Repo" still applies.
- New `*.test.ts` files live next to the source they test. New e2e specs live under `e2e/`. Both runners are already wired — just write tests.

### Heads-up on dependencies

- **NextAuth is on `5.0.0-beta.31`.** v5 is still in beta as of v0.3.x. Stable is expected but unscheduled. If you ship to production on this starter you ship on a beta auth library — that's the deliberate tradeoff for the Next 16 / App Router story to work cleanly. Watch the [next-auth releases](https://github.com/nextauthjs/next-auth/releases) and bump to stable when it lands.
- **`@neondatabase/serverless` v1.x** is the current line as of v0.3.3.
- **Tailwind v4 + `@tailwindcss/typography`** — the typography plugin is wired in `globals.css` via `@plugin "@tailwindcss/typography"`. If you swap to Tailwind v3, you'll need to revert to a plugin-array config.

---

## License

MIT. Take what's useful, ignore the rest.
