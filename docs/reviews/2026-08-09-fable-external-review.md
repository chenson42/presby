# External Review — Fable 5 First Pass (starter + AI-SDLC research)

**Date:** 2026-08-09
**Reviewer:** Claude Fable 5 (first review of this repo by the Fable model)
**Scope:** (a) the repo as a starter template, (b) the process machinery as an AI-run SDLC, (c) deep research on how the industry manages AI-assisted SDLC for quality/traceability, and the gap analysis between (c) and (a)+(b).
**Method:** four parallel agents — process-machinery review, starter code review, industry AI-SDLC research (Spec Kit, Kiro, BMAD, Devin, Cursor, Copilot coding agent, Codex, Jules, Antigravity, DORA 2025, DX AI Measurement Framework, GitClear), and Claude Code native-capability research — synthesized by the main session with spot-verification of load-bearing claims.
**Context constraint:** this is a non-commercial stack for production-quality nonprofit (and some small-business) applications — recommendations favor free tiers and opt-in token spend; paid Team/Enterprise services (e.g., managed Code Review at $15–25/review) are out of scope.

---

## Verdict

Top-decile starter in documentation quality, security defaults, and process self-awareness. One genuine industry-leading capability: `Caught-By`/`Discovered-In` commit trailers + `stats:escape` do per-commit defect-channel attribution that no commercial metrics platform (DX, LinearB, Faros, GitClear) can. Retrospectives demonstrably close their loops.

Central weakness, one pattern everywhere: **the process knows things it doesn't enforce.** The 2026-07-11 retro found 57% of fixes caught post-merge, 100% by agent review, 0% by automated tests — the running-server e2e gate is the sole defense for the dominant bug class — yet e2e never runs in CI. The most ritual-dependent conventions (cadence check, TODO reconciliation, Rule 14) are the ones that fail when sessions pause, and at review time the repo was proving it: `docs/starter-contributions/` untracked while the uncommitted TODO claimed it "landed 2026-07-13"; tree dirty ~4 weeks; release-slot reviews 29–39 days past a 14-day cadence.

Fix direction: **move ~8 cheap checks from prose into hooks and CI; pay for it by shedding ceremony that isn't earning its keep.**

## Where the starter is ahead of the industry

Industry convergence (all major agent tools): persistent repo instruction file → human-approved plan artifact → sandboxed execution with tests → draft PR + session log as audit trail. Against that baseline:

- **Escape-rate instrumentation** — unique; no platform does per-commit defect-channel attribution. Showcase it.
- **Phase-preserving work-log handoffs** — the 2026 consensus (post Cognition's "Don't Build Multi-Agents") is that context loss at handoffs is *the* failure mode of role pipelines; the "don't summarize away prior phases" rule is the correct mitigation, articulated early.
- **Sequential role pipeline** — matches the synthesis (one context-owning orchestrator; parallel *writer* swarms remain fragile).
- **Session-start functionality map** — comparable to Devin's auto-wiki / Jules per-repo memory; almost no open template does it.
- **Tripwire philosophy** (`check:audit`, `check:sql-date`, `toLocale*` ESLint ban) — honest mechanization born from real bugs; the pattern to extend.

## Findings

### A. Enforcement gaps (highest leverage, mostly trivial)

| # | Gap | Fix |
|---|-----|-----|
| A1 | e2e not in CI (retro: "sole defense" for dominant bug class) | CI job on ephemeral Neon branch (create → push+seed → Playwright → delete); prereq `webServer` block in playwright.config.ts (also fixes local two-terminal dance) |
| A2 | `check:sql-date` not in CI (`ci.yml` runs only `check:audit`) | Run `npm run check` |
| A3 | Commit grammar client-side only (GitHub web edits bypass silently) | CI job running exported `validateCommitMessage()` over `git log origin/main..HEAD` |
| A4 | `npm audit` in `/pre-push` prose only | Add to CI |
| A5 | Cadence check = 6 manual steps; reviews 29–39 days overdue at review time | Port huddleup's `cadence-check.mjs` as third SessionStart hook (was already filed in TODO) |
| A6 | Rules 1/5/8 ("never push without /pre-push", "no code before work-log") are prose | PreToolUse hooks: block `git push` without a fresh pre-push marker; work-log presence check (warn-level) |
| A7 | Deck staleness unchecked | `git diff --name-only` check in pre-push Step 7 (slides.md changed but slides.pdf didn't) |
| A8 | No dependency automation (pinned NextAuth beta; monthly manual review is a complement, not substitute) | `.github/dependabot.yml` (npm weekly, actions monthly) |

### B. Traceability

- **B1 — Commits ↔ work-logs don't join.** No trailer ties a commit to its pipeline; the July retro hand-reconstructed the mapping across 25 work-logs. Add `Work-Log: YYYY-MM-DD-<slug>` trailer (format-validated; required for `feat:`/`fix:`); record merge hash in Phase 6.
- **B2 — No machine-checkable acceptance criteria.** Kiro (EARS: "WHEN X THE SYSTEM SHALL Y"), Spec Kit, BMAD all center a per-feature spec with testable criteria tasks trace to. Add an acceptance-criteria section to `_template.md` Phase 1 that Phase 5 checks off row-by-row and Phase 6 verifies (cf. Antigravity's Walkthrough-with-verification-steps).
- **B3 — No machine-readable pipeline state.** "Read the latest work-log" parses a table by eye — how two recent work-logs got stuck at Phase 6 "Pending" while TODO said Done. A ~20-line SessionStart script printing `slug | phase | status` for open work-logs.

### C. Claude Code platform features the process predates

- **C1 — PR-time AI review is table stakes** (CodeRabbit 2M+ repos; OpenAI runs Codex review on 100% of internal PRs). All current review here is in-session (same context, same blind spots as the author session). `anthropics/claude-code-action@v1` running `/code-review` on PRs is the native, cold-context layer the 57%-post-merge number begs for. Nonprofit posture: opt-in via secret, PR-open only, concurrency-cancel.
- **C2 — Plugin packaging.** The `.claude/` layer (9 agents, 11 skills, hooks) is exactly what the plugin system distributes: versioned `plugin.json`, marketplace-installable; forks could pull process updates without `upstream-sync` diffing. Arguably the modern form of this product.
- **C3 — Path-scoped rules** (`.claude/rules/*.md` with `paths:` frontmatter) — CLAUDE.md is at the practical load ceiling; auth/server-action rules could load only when matching files are touched.
- **C4 — AGENTS.md shim** — Linux Foundation standard, 20+ tools; a small AGENTS.md pointing at CLAUDE.md makes the starter usable by forks on Cursor/Codex/Jules.
- **C5 — Test-tampering ratchet** — Anthropic + OpenAI both recommend: write failing tests → *commit them* → implement with tests frozen. Bug-fix variant has failing-then-passing but not the committed checkpoint. Mutation testing is the emerging answer to coverage-gaming AI tests — a natural future `check:*` tripwire.

### D. Starter table-stakes gaps

- **D1 — No error monitoring/observability hook** — no `instrumentation.ts`, bare `console.error`. Ship a stub with a commented Sentry (free tier) wiring path, in the existing teaching-comment style; thin `src/lib/log.ts` wrapper.
- **D2 — No input-validation library; mixed action generations** — `assignRoleAction` (`src/app/(admin)/admin/users/actions.ts:30`) inserts unvalidated IDs, throws instead of `ActionResult`, at the top of a file forkers copy from. Migrate the two legacy actions; bless zod or a small parse helper.
- **D3 — README deployment gap** — env table omits `CRON_SECRET` (REQUIRED-in-production per `.env.example`; a fork deploying from the README gets a silently dead email queue); no Vercel/cron/migrate-on-deploy section.
- **D4 — `components/ui/` is one file** while CLAUDE.md says "shadcn primitives" and Rule 2 mandates a `Dialog` that doesn't exist. Ship the implied primitives or correct the docs.
- **D5 — Reasonable absences (don't add):** containerization, i18n, OpenAPI, Storybook. Nits: `functionality-map.mjs` / `check-audit-coverage.mjs` use `new URL(...).pathname` (Windows-broken; use `fileURLToPath` as feedback-check.mjs does); `stats-escape.mjs` 30-day window vs 14-day retro cadence double-counts overlap.

### E. Efficiency — ceremony not earning its keep

Industry's named over-process failure mode: full spec ceremony on small changes; accepted dial = ceremony proportional to blast radius (the Classification table already embodies this — extend it inward).

- **E1 — `/test` → `/test-results` manual QA bank**: third test layer with no recorded unique catch; its pre-push HARD STOP blocks even hotfixes. Make opt-in for release-class merges; soften stop to confirm.
- **E2 — Phase 6 near-constant gate**: 24 SHIP IT / 1 SHIP WITH NOTES / 0 NEEDS REWORK over 25 pipelines. Keep for Feature class; skippable-with-notation for Polish.
- **E3 — Four feature-describing doc surfaces** hand-synchronized. Demote CLAUDE.md capability map to a pointer; pre-push check that map version stamp matches `package.json`.
- **E4 — Legitimize "process-harvest mode"** — last two work-logs show main-session self-implementation with Phase 6 owner = "user", contradicting canon (analyst owns Phase 6). Document it in the Classification table; close status rows at commit time.
- **E5 — Agent definitions**: all nine `model: sonnet`, no `tools:` frontmatter — "analyst does not write code" is prose while analyst has Write/Edit/Bash. Tool-restrict analyst + qa (free enforcement); document or vary model tiering; full-stack-developer (14 uses) has outgrown its "~<150 lines" charter.

## Top five by effort-to-value

1. e2e in CI on a Neon branch + `webServer` in Playwright config (A1).
2. PreToolUse push gate + cadence-check SessionStart hook (A5, A6).
3. Opt-in claude-code-action PR review (C1).
4. `Work-Log:` trailer + acceptance-criteria template section (B1, B2).
5. Trivial CI batch: `npm run check`, commit-grammar validation, `npm audit`, dependabot (A2–A4, A8).

## Housekeeping flagged at review time

- Commit the 4-week-pending 2026-07-13 work (`docs/starter-contributions/` untracked; TODO/map link to it).
- 1 unread feedback row awaiting triage at `/admin/feedback`.
- Release-slot reviews overdue (test-coverage 39d, retrospective 29d vs 14d); monthly health-check due ~2026-08-10 — this review can seed its `code`/`documentation`/`agent-instruction` portions but does not replace the `security`/`dependencies` reviews.

## Key research sources

Spec Kit `spec-driven.md` · Kiro specs docs (EARS) · BMAD-Method · Cursor agent best practices · OpenAI Codex best practices / AGENTS.md · Google Jules + Antigravity artifacts docs · Cognition "Don't Build Multi-Agents" · DORA 2025 AI-assisted development report + AI Capabilities Model · DX AI Measurement Framework · GitClear AI code-quality research · Simon Willison "Vibe engineering" · Claude Code docs: hooks, plugins, GitHub Actions, agent teams, workflows, memory, checkpointing. (Full URL list in the session transcript; the durable ones are linked inline above by name.)
