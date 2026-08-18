# CLAUDE.md

Guidance for Claude Code when working in **presby**.

## Read first

1. **`docs/STATE.md`** — where the project stands, the decisions, the findings
   worth remembering, and what is next. Start here in every new session.
2. `docs/schema-design.md` — schema rationale, decisions D1–D9, and the full
   review-findings log (F1–F29). Required before proposing or designing schema.
3. The newest file in `docs/work-log/` — in-flight work and its pipeline phase.

## Project Overview

**presby** is a multitenant platform for Presbyterian congregations,
presbyteries, and synods: church management (rolls, officers, directory, giving,
events), council operations, per-tenant websites, and a support-ticket loop
worked partly by AI.

Open source. **No real congregation, person, or credential ever enters the
repository** — see Key Invariants → No Real Data.

**The project is not named yet**, so every identifier still says `presby` —
package name, database roles (`presby_app`), SQL functions (`presby_roll_as_of`),
migration filenames. That is deliberate placeholder, not a naming decision; don't
"fix" it. Candidates are tracked in `docs/STATE.md`.

Seeded from `chenson42/claudecode-nextjs-starter`, which is why the platform
shell (auth, flags, audit, feedback, what's-new) arrived pre-built and the
church domain did not. `/upstream-sync` and `/downstream-sync` keep the two in
touch — see Periodic Reviews.

## Prior art

Four sibling repos are the requirements source. Read before designing a feature
that overlaps one:

| Repo | What to take |
|---|---|
| `../fpcw-directory` | Church portal: 69 tables, per-field privacy (`src/lib/members/visibility.ts`), Android kiosk under `white-binder/` |
| `../westervillelions` | Fund accounting (24 ledger tables). Also `docs/reviews/2026-08-12-pii-scrub.md` — the cost of real data in a public repo |
| `../psvonline-portal` | Presbytery operations, already org-scoped |
| `../synod-portal` | Public learn layer, AI spend gate |

## How Claude Should Behave in This Repo

- **Run commands directly.** This repo is worked with `--dangerously-skip-permissions`, so dev servers, builds, typechecks, watchers, log tails, and db pushes are yours to run without asking. The exception is genuinely interactive commands (e.g. `gcloud auth login`), which bounce back to the user with the `! ` prefix hint.
- **Be deliberate with destructive commands.** A wrong `git reset --hard` or `npm run db:push -- --force` is hard to undo. State what you're about to do before non-trivial commands so the user has a chance to interrupt.
- **Wait for explicit approval before committing or pushing.** Skipped permissions are not permission to skip the user's review of the diff. Pre-commit and pre-push are user gestures, not background tasks.
- **Never push without going through `/pre-push`.** The checklist exists so the agent doesn't ship broken builds.
- **Verify UI in a browser, on a phone viewport.** See Key Invariants → Verify in a Browser. `next build` passing is not evidence a page works.
- **Re-render the deck whenever `deck/slides.md` changes.** Run `npm run deck` to refresh both outputs. `deck/slides.pdf` IS committed (so viewers can download it without installing Marp) — re-render *and re-commit it* in the same change as the source edit. `deck/slides.pptx` stays gitignored. If the render fails, fix the cause; don't leave stale outputs behind.

## Stack

- **Next.js 16** App Router, **React 19**, **TypeScript** strict
- **Drizzle ORM** + **Neon Postgres**, driven through the **WebSocket pool**
  (`drizzle-orm/neon-serverless`). Not neon-http: it has no session or
  transaction support, so it cannot carry the transaction-scoped GUC that RLS
  depends on (F28). The isolation model dictates the driver.
- **NextAuth 5 beta** · Tailwind + Radix · Resend · Vitest + Playwright
- **Vercel** target deployment

## Project Layout

```
src/lib/db/domain/     — the presby schema, one file per module (org, people,
                         roll, officers, groups, authz, privacy, reporting)
src/lib/db/schema.ts   — inherited platform tables (NextAuth adapter, roles,
                         flags, audit, email queue). Church data does NOT go here
src/lib/db/index.ts    — TWO connections: db (presby_app, RLS enforced) and
                         getPlatformDb() (bypasses RLS, platform pages only)
src/lib/authz.ts       — tenant authorization: withOrgContext, the resolver
src/lib/permissions.ts — platform admin shell only. FROZEN; nothing church-facing
src/proxy.ts           — Edge gate (admin + 2FA). Edge runtime: never import
                         @/lib/db here
src/app/(admin)/developer/ — generated schema reference
drizzle/00XX_presby_*.sql  — hand-written: RLS, triggers, functions. Drizzle Kit
                             does not emit any of these
scripts/seed-dev.sql   — synthetic fixture, shaped to exercise the findings
scripts/test-rls.sql   — isolation suite. MUST run as presby_app
docs/STATE.md          — start here
docs/schema-design.md  — rationale + findings log
docs/TODO.md           — the single backlog aggregator (Workflow Rule 10)
docs/ui-standards.md   — UI conventions; read before building a page or form
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

Reviews are bundled into two recurring slots plus the starter syncs (consolidated 2026-07-11, DECISION-029 — eight weeks of history showed the previous eight independent cadences ran in batch sessions anyway). Each review type still gets its own line in `docs/reviews/log.md`, so per-type history is preserved. What each review covers is defined in the owner's agent file.

| Slot | Cadence | Review types (log each separately) |
|------|---------|------------------------------------|
| **Release slot** | 14 d, or at each release if sooner | `test-coverage` (qa) · `retrospective` (tech-lead synthesizes all agents; opens with `npm run stats:escape`) |
| **Monthly health-check** | 30 d, run as one bundled session | `code` (architect) · `documentation` (tech-lead) · `security` (api-developer + database-admin) · `agent-instruction` (tech-lead) · `dependencies` (deployment-engineer) |
| **Starter syncs** | 14 d / 30 d | `upstream-sync` (pull starter fixes into presby) / `downstream-sync` (surface presby work that's starter-generic, staged in `docs/starter-contributions/`), both via the skills (tech-lead). presby has no shared git history with the starter — the skills handle that scaffold case. |

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
9. **Use `/merge-pr` for any PR merged with `--delete-branch`.** Before deleting the head branch, the skill retargets open PRs based on that branch to `main` — otherwise GitHub auto-closes every downstream PR (this bit a sibling repo twice in one session). Invoke once per PR, bottom-up, when merging a stack. Plain `gh pr merge` is only safe when the PR has no dependents *and* you're not deleting the branch.
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
npm run check:sql-date # Tripwire: bans unannotated sql<Date> (the Neon driver returns computed
                       # date expressions as STRINGS — no column OID to map against)
npm run check        # Both tripwires in sequence
npm run stats:escape # 30-day escape-rate report (per-channel fix breakdown for the retrospective)
npm run docs:erd     # Regenerate the /developer ER diagrams from the schema
npm run deck         # Render deck/slides.md → slides.pptx + slides.pdf
npm run deck:pptx    # PowerPoint only
npm run deck:pdf     # PDF only
npm run deck:html    # Live-reload HTML preview
```

Generate an `AUTH_SECRET` with `openssl rand -base64 32`.

## Key Invariants

These are the properties the system exists to enforce. `/developer` marks each
one `database`, `trigger`, or `paper` — **paper means the schema permits a
violation and only review will catch it.**

### No Real Data

This repository is public. No real congregation name, person, address, email, or
credential — not in code, seeds, migrations, scripts, docs, work-logs, or commit
messages. `scripts/seed-dev.sql` is the house style: invented names,
`example.invalid` addresses.

`private/` and `scratch/` are gitignored **and** hard-blocked by a pre-commit
hook, because `.gitignore` is bypassable with `git add -f` and an agent running
`git add -A` is the real failure mode. They are untracked scratch only —
anything needing version control belongs in a separate private repo.

### Isolation Is a Database Property

`presby_app` is `NOBYPASSRLS`. Every tenant table is **`FORCE ROW LEVEL
SECURITY`** — without `FORCE` the table owner bypasses every policy and RLS is
silently inert while every naive test still passes (F1).

`users.is_platform_admin` decides which *pages* are reachable, never whether a
query is filtered. That is what the second connection is for.

**RLS enforces tenancy, not authorization.** The policy trusts whatever org id
it is handed. Verify membership *before* calling `set_config` — that is what
`withOrgContext()` does.

**A trigger that must see across orgs needs `SECURITY DEFINER`.** Otherwise its
own queries are filtered by the RLS it exists to complement, and it silently
reads zero rows for exactly the case it guards (F26).

### Two Hierarchies Intersect Nowhere

Ecclesiastical (congregation → presbytery → synod → GA) and platform (tenant
user → tenant admin → platform admin) are different axes. A platform admin is
not above a national admin.

Access flows **up by publication**, never down by inheritance. A presbytery
admin administers the presbytery's own org and gets nothing inside a member
congregation. The only downward paths are an administrative commission and a
session-granted delegation, both time-boxed and minuted.

### The Roll Is the System of Record

`roll_actions` is append-only; an approved action is frozen by trigger and
corrected by recording a `void`, never by update. The directory is a *view* of
the roll, the SASR is a *projection* of it, per capita derives from it.

`memberships.current_roll` is a **cache** and cannot answer historical
questions — reports replay through `presby_roll_as_of()`. It also drifts with
the passage of time, because future-dated actions take effect on a day with no
corresponding write (F29); the daily reconcile and `presby_roll_cache_drift()`
exist for that.

### The Court Is Not a Group

Session and diaconate rosters are **materialized** from `officer_terms` by
trigger and reject direct writes. Materialized rather than a view because the
permission resolver reads `group_memberships` — a view would be invisible to it
and a role granted to the Session group would resolve to nobody (F3).

Ordination is lifelong; service is termed. Dates are authoritative; `class_year`
is a display label.

### No Role Carries a Wildcard

Not even administrator roles. A Church Administrator does not read tier 2 or
tier 3 by default. Tiers: **1** directory, **2** financial, **3** pastoral,
demographic, medical — pastoral notes sit *above* financial data.

*Known violation:* the inherited `ADMIN_ROLE` in `src/lib/permissions.ts` is
still a wildcard. It is bounded (platform shell only, and the tenant connection
cannot bypass RLS) but not removed.

### Permissions vs Flags

Two mechanisms, never merged (DECISION-003). A **permission** answers *may this
user do this?* — `hasFeature(session.user.features, FEATURES.KEY)`, catalog in
`src/lib/permissions.ts`. A **flag** answers *is this behavior on at all?* —
`isFlagEnabled(key)` against `feature_flags`. A flag never grants access; a
permission never stages a rollout. A gated feature asks both questions.

`isFlagEnabled()` returns `false` on a missing row or a DB error — right for a
toggle, wrong for a flag that gates an auth path, where `false` means "deny
every sign-in during a DB blip." Auth-critical flags (`auth.local_login`,
`auth.require_2fa`) go through named fail-open wrappers in `src/lib/auth/`
(DECISION-026), never through the bare helper.

### The Edge Gate Cannot Reach the Database

`src/proxy.ts` runs on the Edge runtime. It imports `edgeAuth` and the
permission constants and nothing else — importing `@/lib/db` (or anything that
transitively pulls the Neon pool) breaks the build or the runtime, and the
failure surfaces at request time, not at `tsc`.

### Composite Tenant Keys

Every tenant table declares `unique (id, organization_id)`, and foreign keys
between tenant tables are composite. A plain `references people(id)` lets a row
in org B point at a person in org A — RLS filters reads, and that is a bad
*write* (F2).

### Never Hard-Delete a Person

PC(USA) records are permanent. `delete` is revoked on `people`; use
`merged_into_id`.

### Extensibility Goes Through Support

No custom fields (D8). Tags are the only tenant-extensible attribute. A new need
is a support ticket and, if real, becomes a feature for every church. This makes
the ticket loop load-bearing, so it cannot be built last.

### Verify in a Browser

Three bugs in this project were phone-only and invisible to `curl`, `tsc`, and
`next build`: blocked dev assets killing hydration, `display` on a `<summary>`
breaking `<details>` on iOS, and a disclosure that never opened. A page that
returns 200 is not a page that works.
