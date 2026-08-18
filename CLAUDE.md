# CLAUDE.md

Guidance for Claude Code when working in the **Claude Code Starter**.

## Project Overview

The **Claude Code Starter** is a fork-and-go Next.js template for new web apps, and a teaching artifact for how to work with Claude Code: every file under `.claude/`, every doc in `docs/`, and the conventions in this file are meant to be read, copied, and adapted.

Fork it, search-and-replace the project name, tune the brand colors in the `@theme` block of `src/app/globals.css`, fill in `.env.local`, and you have a deployable app with sign-in, an admin shell, roles and permissions, TOTP 2FA, feature flags, an audit log, and release notes — wired and ready to extend.

## Capability Map

The full feature catalog (with per-feature detail) lives in `README.md` → "What you get out of the box." The file-level jump-off map is `docs/product/functionality-map.md` — its short index is auto-printed at session start (`scripts/functionality-map.mjs` SessionStart hook), and **the full map is a required read before proposing, scoping, or designing any feature** so you never rebuild or conflict with something already shipped. Keeping it current is Workflow Rule 14. The operational summary:

- **Auth & accounts** — NextAuth 5 beta (Google OAuth + credentials; JWT sessions carry roles, features, 2FA state) · TOTP 2FA with QR enrolment, recovery codes, trusted-device cookie · self-serve `/account` (profile, email change + re-verification, password change, per-user 2FA at `/account/2fa`, delete skeleton) · forgot/reset-password flow · account lockout (5 failed passwords → 15-min lock; enumeration-safe, OAuth-exempt; admins clear locks on `/admin/users`) · Turnstile CAPTCHA on sign-in + forgot-password (no-op until keyed) · auth-mode flags `auth.local_login` and `auth.require_2fa` (both fail-open, toggled at `/admin/flags`).
- **Authorization** — roles ↔ features ↔ users permissions (`src/lib/permissions.ts`) and environment feature flags (`src/lib/flags.ts`). Two distinct concepts — see Key Invariants → Permissions vs Flags.
- **Admin shell** — `/admin` subpages: users, roles, flags, docs (release-notes viewer), 2FA, feedback triage, what's-new CRUD, email-queue viewer, audit viewer. Gated by `admin.dashboard`.
- **Member surface** — post-login landing `/home` with global nav (conditional Admin link) · what's-new changelog on `/home` and `/whats-new` · in-app feedback loop (daily prompt card on `/home`, permanent form on `/account`) with a SessionStart triage hook — see Key Invariants → Feedback and Dev-Loop Wiring.
- **Infrastructure** — append-only `audit_events` via `recordAudit()` in `src/lib/audit.ts` (captures actor, IP, user-agent) · durable email queue (persist-first, `CRON_SECRET`-gated Vercel cron retry, Resend delivery webhook, daily token-GC cron) · report-only CSP · edge route gate `src/proxy.ts` (auth + 2FA; Next 16 `proxy.ts` replaces deprecated `middleware.ts`) · in-memory rate limiting in `src/lib/rate-limit.ts` (Upstash env vars swap in Redis) · Sonner toasts; server actions return `ActionResult<T>` from `src/types/actions.ts` · `<FormattedDate>` for timezone-safe dates · seed script `scripts/seed.ts` · commit standards enforced by a git hook installed via `npm install`.

## How Claude Should Behave in This Repo

These rules apply regardless of who's forked the project or how they've configured Claude Code:

- **Re-render the deck whenever `deck/slides.md` changes.** Run `npm run deck` to refresh both outputs. `deck/slides.pdf` IS committed (so viewers can download it without installing Marp) — re-render *and re-commit it* in the same change as the source edit. `deck/slides.pptx` stays gitignored. If the render fails, fix the cause; don't leave stale outputs behind.
- **Be deliberate with destructive commands.** A wrong `git reset --hard` or `npm run db:push -- --force` is hard to undo. State what you're about to do before non-trivial commands so the user has a chance to interrupt.
- **Wait for explicit approval before committing or pushing.** Pre-commit and pre-push are user gestures, not background tasks.
- **Never push without going through `/pre-push`.** The checklist exists so the agent doesn't ship broken builds.

## Original Author's Setup (informational)

The author (`chenson42@gmail.com`) runs Claude Code with `--dangerously-skip-permissions` and expects Claude to **run frequent commands directly** — dev servers, builds, typechecks, watchers, log tails, db pushes. The exception is genuinely interactive commands (e.g. `gcloud auth login`), which bounce back to the user with the `! ` prefix hint.

If you've forked this starter and run Claude Code with default permission prompts, ignore the above — prompt-before-acting is right for you. The "Behave in This Repo" rules are the universal ones.

## Stack

- **Next.js 16** App Router, **React 19**, **TypeScript** strict
- **Drizzle ORM** + **Neon Postgres** (serverless, with branching)
- **NextAuth 5 beta** — Google OAuth, JWT-backed sessions
- **Tailwind CSS** + shadcn-style primitives via **Radix UI**
- **otplib** + **qrcode** for TOTP 2FA
- **Resend** for transactional email (`src/lib/email.ts`)
- **react-markdown** + **remark-gfm** for the admin docs viewer
- **Vitest** for unit tests (`*.test.ts` next to source); **Playwright** + chromium for e2e tests under `e2e/`
- **Vercel** target deployment (the starter is platform-agnostic but ships Vercel-ready)

## Project Layout

This tree is the canonical map of the repo — agent files point here rather than maintaining their own copies.

```
src/
├── app/
│   ├── (account)/account/          — Self-serve account page (profile, email, password, delete)
│   │   └── 2fa/                    — Per-user TOTP enrollment + management
│   ├── (admin)/admin/              — Admin shell (users, flags, docs, 2fa subpages)
│   │   ├── feedback/               — Admin feedback triage page, status control, actions
│   │   └── whats-new/              — Admin CRUD for What's-new entries (list+create, edit, delete)
│   ├── (member)/home/              — Post-login member home (greeting, roles, features, global nav)
│   │   └── feedback-prompt-card.tsx  — Daily prompt card (client island)
│   ├── (member)/whats-new/         — Member full What's-new list (all entries, newest-first)
│   ├── (member)/feedback/          — Member server actions (submit, snooze, opt-out)
│   ├── (auth)/signin/              — Sign-in (Google OAuth)
│   ├── (auth)/totp/                — TOTP enrolment + verification
│   ├── (email-verify)/account/verify-email/[token]/  — Email-change verification landing
│   ├── (password-reset)/forgot-password/             — Request a password-reset link
│   ├── (password-reset)/reset-password/              — Consume token + set new password
│   ├── access-pending/      — Landing for authenticated users with no roles
│   ├── api/                 — Route handlers (auth callbacks, admin APIs, api/webhooks/<provider>)
│   ├── page.tsx             — Public landing page
│   └── layout.tsx           — Root layout
├── lib/
│   ├── db/                  — Drizzle connection + schema
│   ├── auth/                — NextAuth config
│   ├── permissions.ts       — FEATURES catalog + hasFeature()
│   ├── flags.ts             — isFlagEnabled()
│   ├── audit.ts             — recordAudit() helper (actor, IP, user-agent)
│   └── two-factor.ts        — TOTP encrypt/decrypt + verify
├── components/
│   ├── ui/                  — shadcn primitives (auto-generated; don't hand-edit)
│   └── shared/              — Cross-cutting components (e.g., <FormattedDate>, <FeedbackForm>)
├── auth.ts                  — NextAuth entry (re-exported across the app)
├── proxy.ts                 — Next 16 route gate (admin + 2FA enforcement)
└── types/                   — Ambient type declarations
scripts/
├── seed.ts                  — Roles + features + demo flag seed
├── feedback-check.mjs       — SessionStart hook: counts status='new' rows; count only
└── functionality-map.mjs    — SessionStart hook: prints the functionality map's short index
docs/
├── TODO.md                  — Backlog & follow-up ledger (reconcile in the same commit as the work)
├── product/functionality-map.md — Living what-exists map (Rule 14; required read before scope work)
├── ui-standards.md          — UI conventions + pre-merge UX audit checklist (Phase 5 reference)
├── decisions.md             — ADR-style decision log
├── work-log/                — Per-feature pipeline tracking (_template.md is the canonical format)
├── reviews/                 — Review log + detail files
└── release-notes/           — vX.Y.md files surfaced in admin docs
.claude/
├── agents/                  — Agent definitions
├── skills/                  — Slash-command skills
└── settings.json            — Permission allowlist
```

## Agent Roster

Agents live in `.claude/agents/`. Spawn the right one for the phase.

| Agent | Pipeline phase | When to invoke |
|-------|---------------|---------------|
| **analyst** | Phase 1 & 6 | Functional refinement before design; shipped-vs-intent review after QA. |
| **architect** | Phase 2 | New subdirectories, npm dependencies, structural changes. |
| **tech-lead** | Phase 3 | Any Feature / bug-fix or Polish-class request (see Classification); authors the design doc. |
| **database-admin** | Phase 4 (schema) | `schema.ts` changes, Drizzle Kit work, indexes. |
| **api-developer** | Phase 4 (server) | Route handlers, server actions, business logic. |
| **ux-developer** | Phase 4 (client) | React components, admin pages, forms. |
| **full-stack-developer** | Phase 4 (small/coupled) | Features small enough that splitting adds overhead. |
| **deployment-engineer** | Pre-deploy | Production build verification, env vars, build failures. |
| **qa** | Phase 5 | Test verification, typecheck, regression tests. |

**Every feature flows through the six-phase pipeline below. Work is not complete until analyst issues SHIP IT in Phase 6.**

When handing off between phases, preserve the prior phase's full output in the work-log. Do not summarize away the analyst's gaps or the architect's invariant rulings.

## Development Pipeline

### Classification — Required Before Any Code Edit

Before editing a file, creating a branch, or invoking an implementer agent, classify the incoming request:

| Class | Definition | Pipeline |
|-------|-----------|----------|
| **Trivial** | Typo fix, single-line config edit, doc-only change, answering a question, running existing tests | No work-log, no pipeline. |
| **Polish / visual / refactor** | CSS edits, font/color changes, renaming, restructuring — no new deps, no schema change, no API surface change | Work-log entry required. Phases 2 & 3 may be skipped with explicit notation ("Skipping Phase 2 — no new deps or structural change"). |
| **Feature / bug fix** | Touches >1 non-trivially related file, adds a dependency, changes the schema, or introduces new user-visible behavior | Full pipeline via `/new-feature`. |
| **Spike** | Exploratory, time-boxed; no production code committed | Document findings in `docs/decisions.md` if a decision results. |

If the request is ambiguous, default to **Feature**. Do not invent a lower classification to avoid the pipeline.

Phases run 1 → 2 → 3 → 4 → 5 → 6. Loop-backs are expected, and a loop-back from any later phase returns to the **earliest** phase where the failure originated, not just the previous phase.

### Phase 1 — Functional Refinement (analyst)

**Trigger:** New feature request or bug report.
**Output:** Five-pass review (user verbs, flow audit, permissions/flags, gaps, adversarial pass).
**Gate:** Verdict must be `READY FOR DESIGN` or `READY WITH NOTES`.
**Loop-back:** `NEEDS REWORK` or `NOT YET` returns to the user. Pipeline pauses.

### Phase 2 — Architectural Review (architect)

**Trigger:** Phase 1 advanced.
**Output:** Verdict on directory placement, server/client split, dependency requirements, invariant compliance.
**Gate:** `Approved` or `Approved with suggestions`.
**Loop-back:** `Needs revision` returns to Phase 1 if the feature shape is wrong; otherwise the architect documents the resolution and advances.

### Phase 3 — Technical Design (tech-lead)

**Trigger:** Architect approved Phase 2.
**Output:** Design doc covering permissions/flags, API contract, data model, component plan, implementation order, edge cases.
**Gate:** Design complete and the implementer is named.
**Loop-back:** Architectural concern returns to Phase 2. Functional inconsistency returns to Phase 1.

### Phase 4 — Implementation

**Trigger:** Tech-lead's design is complete.
**Implementer selection:**

| Scope | Implementer |
|-------|-------------|
| Schema only | **database-admin** |
| Route handlers, server actions, server logic | **api-developer** |
| React components, pages, forms | **ux-developer** |
| Spans server + client and is small | **full-stack-developer** |

**Gate:** Typecheck and build pass. `npm run check:audit` reports zero violations. No native browser dialogs. No `console.log` left in production paths. All invariants honored. Audit events written for security-sensitive mutations. **For any feature that touches `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/`, a running-server e2e smoke covering the full login path (including an MFA-enrolled user) is required before Phase 5 can begin — module-resolution defects are invisible to unit tests.**
**Loop-back:** Design unbuildable returns to Phase 3. Architectural problem discovered returns to Phase 2.

### Phase 5 — Test Verification (qa)

**Trigger:** Implementer reports Phase 4 complete.
**Output:** Verification report in the work-log (format: `docs/work-log/_template.md` Phase 5 section).
**Gate:** Verdict must be `PASS` or `BLOCKED`. **On auth-touching features (see Phase 4 gate), `PASS` requires the e2e suite ran against a real dev server with an MFA-enrolled seeded user. A deferred or skipped e2e check produces `BLOCKED`, not `PASS` — a deferred advisory is not a green light.**
**Loop-back:** `FAIL` returns to the implementer (Phase 4) with failing tests cited `file:line`. `BLOCKED` returns to the user with the unmet prerequisite named. If a failure reveals a design flaw, escalate to Phase 3.

### Phase 6 — Shipped vs Intent (analyst)

**Trigger:** QA's PASS.
**Output:** Final verdict comparing the shipped feature to the Phase 1 description.
**Gate:** Verdict must be `SHIP IT`. **No other verdict closes the pipeline.**
**Loop-back:** `SHIP WITH NOTES` ships, but each note becomes a tracked follow-up. `NEEDS REWORK` returns to Phase 3 or 4 depending on the issue.

### Bug-Fix Variant

| Phase | Bug-fix behavior |
|-------|-----------------|
| 1 (analyst) | Brief — confirms the bug is real and that the fix preserves intended behavior. |
| 2 (architect) | Skip if the fix doesn't touch invariants; document the skip in the work-log. |
| 3 (tech-lead) | Brief design or skip if the fix is trivial; document the root cause regardless. |
| 4 (implementer) | Writes the fix and a failing-then-passing regression test. |
| 5 (qa) | Verifies the regression test fails before the fix and passes after. |
| 6 (analyst) | Confirms the bug no longer manifests for the user. |

**Skipping a phase requires explicit notation in the work-log. No silent skips.**

### Per-Feature Tracking

Every piece of work gets a work-log file at `docs/work-log/YYYY-MM-DD-<slug>.md` (date the work started), created from `docs/work-log/_template.md`. **The template's per-phase sections are the canonical handoff format** — agents fill in their phase's section and update the Per-Phase Status table; they do not invent parallel formats. The work-log is the source of truth for pipeline state — Claude reads it at session start to determine where the work stands and which agent to invoke next.

## Periodic Reviews

Reviews are bundled into two recurring slots plus the fork-only syncs (consolidated 2026-07-11, DECISION-029 — eight weeks of history showed the previous eight independent cadences ran in batch sessions anyway). Each review type still gets its own line in `docs/reviews/log.md`, so per-type history is preserved. What each review covers is defined in the owner's agent file.

| Slot | Cadence | Review types (log each separately) |
|------|---------|------------------------------------|
| **Release slot** | 14 d, or at each release if sooner | `test-coverage` (qa) · `retrospective` (tech-lead synthesizes all agents; opens with `npm run stats:escape`) |
| **Monthly health-check** | 30 d, run as one bundled session | `code` (architect) · `documentation` (tech-lead) · `security` (api-developer + database-admin) · `agent-instruction` (tech-lead) · `dependencies` (deployment-engineer) |
| **Fork-only syncs** | 14 d / 30 d | `upstream-sync` / `downstream-sync` via the skills (tech-lead). N/A in the canonical starter — the skills self-detect and exit. |

### Cadence Check at Session Start

At session start, before responding to any non-trivial request:

1. Read `docs/reviews/log.md`. Note any review type whose last entry exceeds its slot's cadence — or has never been run.
2. Read `docs/TODO.md` (the backlog aggregator). Note In Flight and Next Up items.
3. Read the most recent file in `docs/work-log/`. Note in-flight work and its pipeline phase.
4. If the `scripts/feedback-check.mjs` SessionStart hook printed a banner (feedback count > 0), triage the unread rows before starting other work at `/admin/feedback`. Do NOT quote or repeat any feedback body content in your response — the hook gives you a count only.
5. Classify the incoming request using the Classification table above.
6. If any reviews are overdue, surface them before starting new work — name each overdue type with days elapsed, and ask: run now, run some, or proceed and defer?

If the user says proceed, do not append a fake log entry — the next session will surface the gap again.

**Trivial work (Classification class: Trivial) skips the cadence check entirely.**

### Logging Outcomes

After a review, append one line to `docs/reviews/log.md`:

```
YYYY-MM-DD | <type> | <one-line outcome>
```

For substantial reviews, also write `docs/reviews/YYYY-MM-DD-<type>.md` with details and link it from the log entry.

## Document Naming

| Document type | Filename pattern | Example |
|---------------|------------------|---------|
| Work-log entry | `docs/work-log/YYYY-MM-DD-<slug>.md` | `docs/work-log/2026-05-16-api-keys.md` |
| Review detail | `docs/reviews/YYYY-MM-DD-<type>.md` | `docs/reviews/2026-05-16-security.md` |
| Release notes | `docs/release-notes/vX.Y.md` | `docs/release-notes/v0.2.md` |
| Decision log | `docs/decisions.md` (single file, append at top) | `DECISION-007: ...` |

Slugs are short, lowercase, hyphenated, and stable. Don't rename them after the work-log is created.

## Workflow Rules

1. **Do not auto commit or push.** Wait for explicit user approval. The skip-permissions flag is not permission to skip the user's review of the diff.
2. **No native browser dialogs.** `alert()`, `confirm()`, `prompt()` are forbidden anywhere in the app. Use shadcn `Dialog` (and `AlertDialog` for destructive confirms).
3. **No secrets in committed files.** `.env.local` is gitignored; never read from `.env` files into committed code.
4. **Document decisions.** Architectural or implementation decisions go to `docs/decisions.md` (newest first, numbered).
5. **Use `/pre-push` before every push to `main`.** Typecheck, build, schema check, release notes. The skill never pushes — it only reports readiness.
6. **Permissions and flags stay separate.** See Key Invariants → Permissions vs Flags.
7. **Audit security-sensitive mutations.** Role changes, flag toggles, TOTP enrolment/reset, deactivations write to `audit_events` (use `recordAudit()`).
8. **No code before the work-log.** If you are about to call Edit, Write, or `git checkout -b` for a non-trivial request and there is no work-log entry for it, stop and run `/new-feature` first. The Classification table defines "non-trivial."
9. **Use `/merge-pr` for any PR merged with `--delete-branch`.** Before deleting the head branch, the skill retargets open PRs based on that branch to `main` — otherwise GitHub auto-closes every downstream PR (this bit the npvitals fork twice in one session). Invoke once per PR, bottom-up, when merging a stack. Plain `gh pr merge` is only safe when the PR has no dependents *and* you're not deleting the branch.
10. **Keep `docs/TODO.md` reconciled in the same commit as the work.** Shipping something? Move its line to Done (with date) in that commit. Deferring, discovering a follow-up, or accepting a review punch-list item? Add a line in that commit. Phase 6 `SHIP WITH NOTES` follow-ups land here, not just in the work-log. A commit that changes what's open without touching `docs/TODO.md` is incomplete — `/pre-push` flags it.
11. **Never amend or force-push to diagnose an external-system failure.** When the same commit suddenly yields a different deploy or CI result, the external system changed — not your code. Get ground truth from the failing service's dashboard before touching git history.
12. **Mark feedback rows at delivery.** When Phase 6 closes a feature that originated from in-app member feedback, update the `feedback` row from `triaged` to `done` (the work-log's Source block records the row UUID). Not before Phase 6 — the row stays `triaged` while in flight.
13. **What's-new advisory at SHIP IT.** At Phase 6, if the shipped feature introduces member-visible behavior, consider publishing a `whats_new_entries` entry (admin CRUD at `/admin/whats-new`). Not required for internal admin tooling, infrastructure, or bug fixes.
14. **Keep the functionality map current.** When a feature is added, materially changed, or removed, update its line in `docs/product/functionality-map.md` — both the short Index (if a whole surface/area shifts) and the full-map bullet — **at ship time**, in the same housekeeping cluster as the release-notes entry and the TODO reconciliation (Rule 10); the `/release-notes` skill is the natural place. The map's index is loaded into every session by the SessionStart hook, so a stale map actively misleads. The documentation review is the backstop, not the place to defer a change you just shipped.

## Commit Message Standards

Every commit's first line:

    <prefix>(<optional-scope>): <description (1–100 chars)>

Allowed prefixes: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`, `build`, `ci`. Merge, revert, and release commits are exempt from validation.

**Bug-fix trailers.** Every `fix:` commit must include both trailers in the body (after a blank line):

    Caught-By: automated-test | agent-review | human-review | production
    Discovered-In: Phase-1 | Phase-2 | Phase-3 | Phase-4 | Phase-5 | Phase-6 | post-merge | production

`Caught-By` rule: if CI would have caught the bug without any agent judgment, use `automated-test`; if an agent had to decide to run a non-mandatory check, use `agent-review`. Bugs discovered by cross-repo review (sibling harvest, upstream/downstream sync) are `agent-review` — name the harvest in the commit body so the cross-repo provenance isn't lost.

**Work-Log trailer.** Every `feat:` and `fix:` commit must also carry a `Work-Log:` trailer naming its pipeline's work-log slug (the `docs/work-log/` filename without `.md`), and any commit may carry one:

    Work-Log: YYYY-MM-DD-<slug>

This joins commits to pipelines mechanically — the retrospective and `stats:escape`-style tooling can map commit → work-log without hand-reconstruction. Feature and bug-fix classes always have a work-log (Rule 8), so the trailer is never missing by design; batch work references the batch's slug. Enforced by the commit-msg hook locally and the commit-grammar CI job on PRs.

**Mixed-commit rule.** One commit, one prefix. A commit that adds a feature and fixes a bug must be split — there is no compound prefix.

**Hook bypass.** Never use `git commit --no-verify`. If the hook rejects a valid commit, fix the hook. The `npm run stats:escape` "Missing trailers (bypass)" count should be zero in every retrospective.

**Running the stats.** `npm run stats:escape` prints a 30-day escape-rate breakdown. Tech-lead runs it at the start of each retrospective and copies the output into the retrospective detail file.

## Common Commands

```bash
npm run dev          # Start the Next.js dev server
npm run build        # Production build
npm run start        # Run the production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test         # Vitest unit tests (run once)
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Playwright end-to-end tests (needs the dev server running)
npm run db:push      # Sync Drizzle schema to the live database (lossy — dev only)
npm run db:generate  # Generate a versioned SQL migration in drizzle/ (use this once you have data you care about)
npm run db:migrate   # Apply committed SQL migrations (production-safe; use instead of db:push in staging/prod)
npm run db:seed      # Seed roles, features, and the demo flag
npm run check:audit  # Tripwire: every mutation in actions.ts files must reference an AUDIT_ACTIONS key
npm run check:sql-date # Tripwire: bans sql<Date> typings (neon-http returns strings for raw-SQL dates)
npm run check        # Both tripwires in sequence
npm run stats:escape # 30-day escape-rate report (per-channel fix breakdown for the retrospective)
npm run deck         # Render deck/slides.md → slides.pptx + slides.pdf
npm run deck:pptx    # PowerPoint only
npm run deck:pdf     # PDF only
npm run deck:html    # Live-reload HTML preview
```

Generate an `AUTH_SECRET` with `openssl rand -base64 32`.

## Key Invariants

### Server / Client Boundary

Next.js Server Components are the default. Add `'use client'` only when you need event handlers, hooks, refs, or browser APIs. Server actions are marked `'use server'`; they never trust inputs without validation and always re-check session and permissions inside the action body.

### The Proxy Cannot Import `@/lib/db`

`src/proxy.ts` runs on the Edge runtime and cannot import node-only modules. Keep DB access in route handlers and server actions; the proxy checks JWT claims only.

### Schema Is the Source of Truth

`src/lib/db/schema.ts` is canonical. Anything in the live database that isn't in `schema.ts` will be dropped on the next `npm run db:push`. Add a new table to `schema.ts` *first*, then push or generate the migration.

### Permissions vs Flags

| Concept | Mechanism | Question it answers |
|---------|-----------|---------------------|
| Permission | `FEATURES` + `hasFeature()` | "Is this *user* allowed to do X?" |
| Flag | `feature_flags` + `isFlagEnabled()` | "Is feature X *turned on* for this environment?" |

Not interchangeable. A new admin action almost always needs a new permission. A new in-progress feature usually needs a flag. Many features need both. This section is the single source for this rule — agent files point here.

### TOTP Encryption Key

`AUTH_TOTP_ENCRYPTION_KEY` is a 32-byte secret that AES-GCM-encrypts TOTP seeds at rest. **Rotating it invalidates every enrolled TOTP secret in the database.** Do not rotate it casually.

### No Secrets in Committed Files

`.env.local`, OAuth keys, `AUTH_SECRET`, the TOTP key — none belong in git. `.gitignore` excludes `.env*` except `.env.example`. Don't work around it. `.env.example` is the canonical inventory of environment variables.

### Timezone-Safe Date Rendering

Never call `toLocaleString()` / `toLocaleDateString()` / `toLocaleTimeString()` directly in components — on Vercel (UTC), server-rendered timestamps show UTC to every viewer. Use `<FormattedDate value={...} mode="date|datetime" />` from `src/components/shared/formatted-date.tsx` (SSR-renders an ISO fallback, swaps in the viewer's timezone after mount). An ESLint rule enforces this; the primitive file is the only exemption.

### Post-Login Landing = /home

After a successful sign-in (Credentials or Google OAuth), users land at `/home`. The default `callbackUrl` in `src/app/(auth)/signin/page.tsx` and the fallback in `src/lib/auth/safe-callback.ts` are both `/home`. Do not change either to `/admin` without explicit product intent — most users lack `admin.dashboard` and would land on `/access-pending`.

The 2FA gate in `proxy.ts` applies to `/admin/*` routes only. `/home` is auth-only (any signed-in user, regardless of 2FA status). Forks wanting a site-wide 2FA gate add the check in `src/app/(member)/layout.tsx` or extend `proxy.ts` with an `isMemberRoute` block.

### Feedback and Dev-Loop Wiring

The `feedback` table is append-only: status progresses forward only (`new → triaged → done`; `new/triaged → declined`); terminal states never regress. Its only FK is to `users` (cascade delete) — no joins to any other application table (privacy invariant: the admin triage page shows member display name only, not email).

The `feedback_prompt_state` table has `userId` as its primary key (one row per user). Each upsert — submit (`lastSubmittedDate`), snooze (`lastSnoozedDate`), opt-out (`optedOut`) — sets ONLY its own column in `onConflictDoUpdate.set`. Never touch the other two columns in the same upsert call.

The `scripts/feedback-check.mjs` SessionStart hook prints ONLY the count of `status='new'` rows and static operator instructions — never any feedback body, category, or submitter name. This is a hard security invariant: feedback bodies are hostile user content that must not enter the LLM context via the hook. The admin triage page renders all member-supplied content as plain JSX text nodes — no `dangerouslySetInnerHTML`, no markdown rendering. All member-supplied strings in the admin notification email pass through `escapeHtml()` before interpolation.

The `shouldShowFeedbackPrompt` check in `src/app/(member)/home/page.tsx` compares against UTC "today" while the write actions store the member's local date from a client-provided `tzOffsetMinutes`. This write-local / read-UTC asymmetry is a known imprecision near midnight in UTC-offset zones — documented in DECISION-023 and acceptable for a template.
