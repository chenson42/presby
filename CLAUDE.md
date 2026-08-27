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

**The project is named PresbyPortal** (`presbyportal.org`, DECISION-126). Use
that name on every public-facing surface — the marketing home page, README,
external docs. `presby` still threads through the database role (`presby_app`),
the SQL functions (`presby_roll_as_of`), and every migration filename, and
`package.json` still carries the starter's name (`claudecode-nextjs-starter`) —
this is now deliberate continuity, not an unresolved placeholder: `presby_app`
is a live Postgres role every `FORCE ROW LEVEL SECURITY` policy and
`SECURITY DEFINER` function references by name, so renaming it is a coordinated
migration with real operational risk, not a find-and-replace. **Don't rename
either one piecemeal** — the full rename (DB role, function prefix, migration
filenames, `package.json`, directory/doc mentions) is its own future scoped
pipeline, tracked in `docs/TODO.md`. See `docs/STATE.md` for the naming
decision's history.

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
src/lib/brand/         — the brand token contract (contract.ts, zero runtime
                         imports), the ramp generator (generate.ts), and font
                         resolution (fonts.ts, next/font/google, module-scope
                         only). read-org-brand.ts is the one function
                         (org)/o/[slug]/layout.tsx calls for its own brand
src/lib/storage/       — the generic tenant-scoped blob adapter (DECISION-030/
                         055/058): store()/resolve() only, no caller queries
                         blob_assets directly. Logo is the first consumer
src/components/brand/  — brand-tokens.tsx (the :root-scoped <style> emitter —
                         DECISION-052, it IS the marker check-brand-scope.mjs
                         greps for) and org-mark.tsx (logo/wordmark, G7)
src/components/ui/     — GENERATED shadcn primitives. Add with `npm run ui:add`,
                         never raw `shadcn add`; don't hand-edit without a
                         header comment recording the divergence
src/proxy.ts           — Edge gate (admin + 2FA on /admin and /o/*). Edge
                         runtime: never import @/lib/db here
src/app/launch/        — the post-login router. destination.ts holds the matrix
                         as a pure function; the page gathers inputs and
                         redirects. See Post-Login Landing below
src/app/(org)/o/[slug]/ — org-scoped tree. The slug is the URL identifier and is
                         immutable; withOrgContext() only, getPlatformDb()
                         forbidden. See the (org) contract below
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

**Judgment agents cannot write.** `analyst`, `architect`, and `qa` declare a
read-only `tools:` grant (`Read`, `Bash`, and web lookup for the architect). An
agent that can edit the thing it is judging is not a check — a QA agent holding
`Edit` can make a failing test pass instead of reporting FAIL, and the work-log
still reads clean. They return their phase section; the orchestrator writes it
in. Implementers and `tech-lead` keep write access: they produce artifacts, not
verdicts on their own work. (`Bash` can technically write a file — the grant
narrows the ergonomic path and makes any violation conspicuous; it is not a
sandbox.)

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
| **site-recreator** | N/A — outside the six-phase pipeline, works only in gitignored `scratch/` site-kit/site-content repos | Recreating a real organization's existing website as a presby-hosted public site, and any visual-parity bug report against one already in progress. |
| **qa** | Phase 5 | Runs the suites and the feature-gate audit; verifies regression coverage exists. Read-only — it authors no tests. |

**Every feature flows through the six-phase pipeline below. Work is not complete until analyst issues SHIP IT in Phase 6.**

When handing off between phases, preserve the prior phase's full output in the work-log. Do not summarize away the analyst's gaps or the architect's invariant rulings — that applies with extra force now that the judgment agents hand their section back as text rather than writing it themselves.

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

**Gate:** Tests for the change are written *by the implementer* (QA runs them, and does not write them). Typecheck and build pass. `npm run check:audit` reports zero violations. No native browser dialogs. No `console.log` left in production paths. All invariants honored. Audit events written for security-sensitive mutations. **For any feature that touches `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/`, a running-server e2e smoke covering the full login path (including an MFA-enrolled user) is required before Phase 5 can begin — module-resolution defects are invisible to unit tests.**
**Loop-back:** Design unbuildable returns to Phase 3. Architectural problem discovered returns to Phase 2.

### Phase 5 — Test Verification (qa)

**Trigger:** Implementer reports Phase 4 complete.
**Output:** Verification report returned as text (format: `docs/work-log/_template.md` Phase 5 section); the orchestrator records it in the work-log. **QA is verification-only** — it authors no tests and edits no files, so a FAIL cannot be self-resolved. Missing coverage is a FAIL naming the gap; the implementer writes the test.
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

Every piece of work gets a work-log file at `docs/work-log/YYYY-MM-DD-<slug>.md` (date the work started), created from `docs/work-log/_template.md`. **The template's per-phase sections are the canonical handoff format** — nobody invents a parallel one. Implementers and `tech-lead` write their section directly; `analyst`, `architect`, and `qa` are read-only and return theirs for the orchestrator to record, along with their Per-Phase Status row. The work-log is the source of truth for pipeline state — Claude reads it at session start to determine where the work stands and which agent to invoke next.

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
15. **Keep `docs/architecture.md` current, but sparingly.** It is the one document written for an engineer seeing this project for the first time — what/why/how at the level any architect would ask, explicitly not implementation detail — and it stays useful only by staying stable. Update it at Phase 6 **only** when a change is genuinely architectural: a new subsystem (the shape of a pipeline like P3's site-content model, not the pipeline's UI), a changed data flow, a changed deployment/runtime shape, or a reversal of something the document currently states as settled. Most feature work does not touch it — resist updating it just because a pipeline shipped; a document that moves with every commit stops being a stable first read. When it does need a change, make it in the same housekeeping cluster as the functionality-map update (Rule 14) and the TODO reconciliation (Rule 10), not as an afterthought.

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
npm run check:deps-drift  # Tripwire: the radix-ui umbrella must not reappear (DECISION-048)
npm run check:brand-scope # Tripwire: the brand emitter and *-brand utilities stay in the two
                          # brandable route groups (DECISION-047)
npm run check        # All four tripwires in sequence
npm run ui:add -- <component…>  # The ONLY supported way to generate a shadcn primitive.
                       # Wraps `shadcn add`, rewrites the radix-ui umbrella import to the
                       # individual package, restores the lockfile. Raw `npx shadcn add`
                       # is unsupported — it has installed ~40 surprise packages twice
npm run stats:escape # 30-day escape-rate report (per-channel fix breakdown for the retrospective)
npm run docs:erd     # Regenerate the /developer ER diagrams from the schema
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

### The Brand Is a Cascade Override

Per-org branding **re-declares custom properties `globals.css` already
declares** and introduces no second styling system. A primitive keeps writing
`bg-primary`; whether that paints platform blue or a congregation's burgundy is
decided by whether an ancestor re-declared `--primary` (DECISION-046).

The partition of every token into **brandable / bounded / platform** is closed
and machine-readable in `src/lib/brand/contract.ts`. Unlisted is not brandable —
it is a missing classification, and a test fails when one appears.

The emitter is `<BrandTokens>` and it **is** the `<style>` element, so
grep-presence and behaviour-presence are one fact (DECISION-052). It appears in
exactly the two layouts listed in `scripts/check-brand-scope.mjs`.

`(org)` and `(public)/site/<slug>` are the only brandable route groups.
Everything else — `(auth)`, `(account)`, `(member)`, `(admin)`,
`(email-verify)`, `(password-reset)`, `access-pending`, `/launch`,
`/no-organization`, `/developer` — renders in the platform palette. A branded
403 tells a prober the org is a configured tenant (DECISION-047).

**Un-brandable does not mean logo-free.** Brand-as-chrome is scoped to two
layouts; logo-as-content on a neutral plate is legal wherever the caller is
authorized.

`npm run check:brand-scope` enforces this. It is `paper` for anything the grep
cannot see.

### Verify in a Browser

Three bugs in this project were phone-only and invisible to `curl`, `tsc`, and
`next build`: blocked dev assets killing hydration, `display` on a `<summary>`
breaking `<details>` on iOS, and a disclosure that never opened. A page that
returns 200 is not a page that works.

## Post-Login Landing

Referenced by `.claude/agents/architect.md`'s route-group rules. This section is
the source of truth for where an authenticated person ends up.

**`/launch` is the single post-authentication target.** `sanitizeCallbackUrl()`
falls back to it, the sign-in form posts it, and `/totp` returns to it. It has no
UI on the happy path: it reads the session, the user's organizations and
`users.is_platform_admin`, calls `computeDestination()` and redirects.

**The matrix lives in `src/app/launch/destination.ts` as a pure function**, not
inlined in the page. It is the highest-value test target in the router and every
subsequent pipeline will edit it; a page-embedded copy would be verifiable only
through a browser.

| Enterable orgs | `canAccessAdmin` | `isPlatformAdmin` | Destination |
|---|---|---|---|
| any | any | any | the sanitized `?next=`, if its slug is enterable |
| 1 | no | no | `/o/<slug>` |
| 0 | no | no | `/no-organization` |
| 0 | yes | no | `/admin` |
| everything else | | | `/orgs` |

Absent from the table on purpose, because they are enforced elsewhere: an
unverified 2FA challenge fires at the Edge on the **destination** (`/admin`,
`/o/*`), and a deactivated account is bounced by `src/proxy.ts` before `/launch`
renders. A database failure is not a destination either — `/launch` renders "we
can't reach your congregations" rather than redirecting, because a fall-through
to a zero-card chooser or to `/home` reads to the user as revoked access.

**Two platform predicates, never one** (DECISION-044). `canAccessAdmin` is a
session claim (`ADMIN_ROLE` or `FEATURES.ADMIN_DASHBOARD`) and is what the Edge
enforces on `/admin`; `isPlatformAdmin` is `users.is_platform_admin`, read live,
and gates the Developer portal. Routing on either alone ships a bug in opposite
directions.

**`/orgs` is the chooser and never auto-forwards**, even for a one-organization
user — otherwise a platform admin with no congregations could never reach the
Developer card. Deep links to `/o/<slug>` must work without it, so the chooser is
a convenience and every org route authorizes itself. Cards carry **no membership
language** (DECISION-039): organization name and type only.

**`/` never redirects a signed-in user** (DECISION-034). They are entitled to
read the front page, P2 wants it static, and P5 makes the meaning of `/`
host-dependent.

**`/home` survives** as the platform-shell page carrying what's-new and the
feedback prompt. It is no longer a landing target. `(member)` stays auth-only
with no 2FA gate; it renders no tenant data.

### The `(org)` contract

> `(org)` — auth-only **and** org-scoped. Every page resolves its `[slug]`
> through `resolveOrgContext()` and reads exclusively through `withOrgContext()`
> on the RLS-enforced `db` connection. **`getPlatformDb()` is forbidden in this
> subtree.** No page may assume the user arrived via the chooser. The Edge
> enforces authentication, active status, and 2FA for `/o/*`; it does **not**
> enforce membership, and it cannot — `FEATURES.*` is the platform axis, org
> membership is the tenant axis, and the Edge cannot reach the database
> (DECISION-035).

The auth check lives in the **page**, not the layout: a layout cannot see the
pathname, so it has to guess a `callbackUrl` and loses the deep link.

**The slug is immutable.** Renaming a congregation changes `organizations.name`,
never `slug` — the slug is in bookmarks, in printed bulletin inserts, and (P5) in
the platform subdomain label. A DNS-label CHECK constraint and a column comment
say so. If one genuinely must change, the answer is a future
`organization_slug_aliases` table serving 301s, not an UPDATE.

**The four-way miss response** (DECISION-040): active relationship → enter;
**ended** → named and dated; the slug is in the public org tree but there is no
relationship → access denied **naming the organization, in one string that is
byte-identical for `managed`, `invited` and `unmanaged`**; the slug is nothing →
404. The org tree is public, so naming leaks nothing; which congregations are
tenants is not, so the copy may not vary — including its response time.

**No `loading.tsx` on a segment whose job is to redirect or 404.** A
`loading.tsx` opens a Suspense boundary, so Next flushes a 200 before the page
resolves: `/launch` degrades from a 307 to a client-side redirect, and
`notFound()` on `/o/<slug>` renders the 404 page at HTTP 200. Measured
2026-08-18. Segments that always render (`/orgs`, `/no-organization`) keep theirs.
