# Agent & Instruction Review — 2026-09-24

**Reviewer:** tech-lead
**Scope:** `CLAUDE.md`, all 10 `.claude/agents/` files, all 10 `.claude/skills/` (`SKILL.md`), the SessionStart/PreToolUse hooks under `scripts/`, `.claude/settings.json`.
**Primary evidence:** `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` (~3,900 lines; Per-Phase Status table, Phase 2 rulings, three Phase 3 amendments plus a fourth and fifth loop-back, three Phase 4 batches, two QA re-verifications, Phase 6) — the freshest, largest, and highest-stakes pipeline run to date, and the first schema-heavy pipeline this review type has had to judge instructions against.
**Status of this review type:** this is presby's **first real** agent-instruction review. The 2026-08-19 log line is an explicit baseline reset ("clock starts here, not a completed review"), not a completed prior run — there is no presby-specific punch-list to check for regressions against. The 2026-05-17 and 2026-07-11 detail files (read for format) are the starter's own pre-fork history.

---

## Summary

0 findings are cosmetic. Two are Critical: `database-admin.md`, the Phase 4 agent for exactly the kind of work this pipeline was, contains **zero** mention of `drizzle/00XX_presby_*.sql`, RLS, `SECURITY DEFINER`, or the `src/lib/db/domain/` directory — every technique that made this pipeline correct (checking the live Postgres catalog, treating `getPlatformDb()` as an ownership bypass, correcting a migration in place) was invented under time pressure, not instructed. `full-stack-developer.md` still tells an implementer that new tables "go in `src/lib/db/schema.ts` first," which is actively wrong for presby and contradicts a named CLAUDE.md invariant. Six Notable findings follow largely from the same root cause: tech-lead, architect, qa, and the `/pre-push` skill all lack an explicit "verify against the live database/fixtures, not just the design doc" step, despite that exact step producing this pipeline's most consequential catches on both sides (three tech-lead spec defects caught by the implementer; the false grant-model premise caught by the architect and the write-path-integrity hole caught by QA, both by reading `pg_class`/`aclexplode` directly), and the one concurrency finding notes that presby has no instructions for running pipelines in parallel, with the one mechanism built for it (per-feature Neon branches) unused even once in this single pipeline, which instead paid real cost cleaning up shared-branch fixture contamination from other sessions. Three Minor findings and three Observations round out the report; none are structural.

---

## Critical

### C1 — `database-admin.md` describes only the inherited starter's `schema.ts`/`db:push` world; it says nothing about presby's actual DDL practice

**File:** `.claude/agents/database-admin.md`

Grepping the file for `domain`, `RLS`, `SECURITY DEFINER`, `FORCE ROW`, `drizzle/00`, and `hand-writ` returns **zero matches**. Every section — "Schema Design" (UUID PKs, `createdAt` convention), "Migrations: `db:push` vs `db:generate`," "Indexes and Performance," "Seeds" — describes the platform-shell tables in `src/lib/db/schema.ts` only. But per `CLAUDE.md`'s own Project Layout, church-domain schema work (the *majority* of database-admin's actual workload — `src/lib/db/domain/`, one file per module, now 19 files) is hand-written SQL in `drizzle/00XX_presby_*.sql` that Drizzle Kit never emits (RLS policies, `FORCE ROW LEVEL SECURITY`, triggers, `SECURITY DEFINER` functions), verified against a live Neon catalog rather than generated from `schema.ts`.

This pipeline's database-admin agent handled that gap correctly, three separate times, entirely off its own initiative:

- Verified `PLATFORM_DATABASE_URL` connects as `neondb_owner` via `select current_user` before trusting any grant-based reasoning (batch B spec defect 3; elevated by tech-lead to "Ruling B3 — a standing fact for every future design").
- Found and fixed a real, pre-existing bug (`isUniqueViolation()` reading `err.code` off the wrong object in the Drizzle error's cause chain) while building an unrelated error-mapping path.
- Treated a merged-but-unapplied-to-production migration as correctable in place, same file and number, across four separate loop-backs, each time re-deriving the justification from scratch ("nothing has shipped to production, deploys do not auto-migrate").

None of this is exotic technique — it is exactly what the agent needs to do this class of work safely — but none of it is written down. An implementer with less initiative, or one under more time pressure, has no instruction telling it to check the live catalog before trusting a design's premise about what the database already grants.

**Proposed addition to `database-admin.md`** (new section, after "Migrations: `db:push` vs `db:generate`"):

> ## Presby Domain Schema (hand-written SQL, RLS)
>
> Church-domain tables do **not** go in `schema.ts` — they live in `src/lib/db/domain/*.ts` (Drizzle table definitions, for typing and queries) with the DDL hand-written in `drizzle/00XX_presby_*.sql` (RLS policies, `FORCE ROW LEVEL SECURITY`, triggers, `SECURITY DEFINER` functions, grants). Drizzle Kit does not emit any of this — `db:push`/`db:generate` apply to the inherited platform tables in `schema.ts` only. See `CLAUDE.md` → Project Layout and Key Invariants (F1, F26, F28) for the isolation model this is built to enforce.
>
> **Verify a design's premises against the live database before writing DDL against them**, not just `drizzle/`'s migration history: query `information_schema`, `pg_class` (`relforcerowsecurity`), `pg_trigger`, and `aclexplode(relacl)` on the actual Neon branch. A migration's cumulative grant history can be additive and out of sync with stated intent — this pipeline's central defect (F38/F44) was a design doc asserting `organizations` was `SELECT`-only, sourced from a correct read of `drizzle/`, that was false on the live database because of an earlier blanket grant nobody had traced.
>
> **`getPlatformDb()` connects as `neondb_owner`**, a member of both `presby_platform` and `presby_app` who holds every privilege on every table by ownership, independent of any `grant`/`revoke`. Any reasoning of the shape "X cannot happen because the grant forbids it" is false on that connection — the only real backstop there is a trigger. Narrowing a grant is still worth doing (it documents intent and binds the day a real, non-owner `presby_platform` login exists), but never treat it as sufficient by itself; pair every grant narrowing on a table `getPlatformDb()` can reach with a trigger that enforces the same rule.
>
> **Migration correction in place, vs. a new migration number:** a migration file merged to `main` but not yet applied to a shipped environment (check `docs/TODO.md`/`docs/STATE.md` for what's actually deployed) may be corrected in the same file, same number, when a later phase or an external review finds a defect. Once a migration has run against production, fix forward with a new, later-numbered migration instead — never edit a file that has already shipped.

### C2 — `full-stack-developer.md`'s schema guidance is wrong for presby and contradicts a named Key Invariant

**File:** `.claude/agents/full-stack-developer.md`

Current text: *"Schema — new tables/columns go in `src/lib/db/schema.ts` *first* (schema is the source of truth); follow database-admin's conventions and note `db:push` vs `db:generate` in the handoff."*

`CLAUDE.md` → Project Layout states plainly: *"`src/lib/db/schema.ts` — inherited platform tables (NextAuth adapter, roles, flags, audit, email queue). Church data does NOT go here."* A full-stack-developer pipeline following this file's literal instruction on any organization/people/roll/officer/group table would write church data into the platform schema file, apply it with `db:push`, and lose RLS, `FORCE ROW LEVEL SECURITY`, and every composite-tenant-key foreign key entirely — a direct violation of "Isolation Is a Database Property" and "Composite Tenant Keys." This is inherited, un-adapted starter text, not a presby decision.

**Proposed replacement:**

> **Schema** — platform-shell tables (users, roles, flags, audit, email queue) go in `src/lib/db/schema.ts` first, per database-admin's conventions, applied with Drizzle Kit. **Church-domain tables never go here** (see `CLAUDE.md` → Project Layout, "Church data does NOT go here," and `database-admin.md`'s Presby Domain Schema section) — any work touching `organizations`, `people`, the roll, officers, or groups is schema-only work that belongs to `database-admin`, not `full-stack-developer`, regardless of how small the feature otherwise is.

---

## Notable

### N1 — `tech-lead.md` has no build-feasibility pass against the live database and fixtures before naming the implementer

**File:** `.claude/agents/tech-lead.md`

Three of this pipeline's Phase 4 "loop-back candidates" were errors in the tech-lead's own Phase 3 spec, not deviations by the implementer, and all three were things a five-minute check against the live tree would have caught before Phase 4 opened:

1. `alter table organizations drop column status` was specified as dropping "the unused pre-provisioning status column." It is not unused — five shipped `SECURITY DEFINER` functions gate an anonymous public read on `o.status = 'active'`. Postgres records no column dependency inside a function body, so the `DROP` would have **succeeded**, and every public site would have started failing at request time.
2. `presby_transfer_affiliation()`'s specified signature placed `p_reason text default null` before `p_minute_reference text` with no default — not valid SQL; Postgres rejects a required parameter after a defaulted one.
3. The specified `presby_assert_council_authority(v_actor, subject)` call used a one-level-above rule that made the redistricting scenario D19 exists to enable — a synod acting on a congregation two levels below it — impossible to call correctly. This was "the most consequential correction in the batch," per the implementer's own framing.

A fourth instance surfaced later, from an external reviewer's proposed CHECK (`organization_affiliations_recorded_has_from`): it was refused because it directly contradicted three already-shipped fixtures (`scripts/seed-dev.sql`'s Quillhaven row, `scripts/test-rls.sql`'s F41 assertion, `lifecycle.test.ts`'s redistricting fixture) that all depend on a minuted act being allowed a null `effective_from`.

None of these are exotic catches. A `psql \df+` check of each new function's signature, an eye pass over which shipped functions reference a column being dropped, and a `grep` of the fixture files a new CHECK will now validate would have caught all four before Phase 4 started.

**Proposed addition to `tech-lead.md` §1** (after the Implementation Order bullet):

> **Feasibility check, against the live tree, before naming the implementer.** Verify each new function signature is valid SQL (parameter defaults trail every required parameter); for each `ALTER`/`DROP` against an object other code may depend on, check whether any `SECURITY DEFINER` function body references it (Postgres tracks no such dependency — a clean `DROP` can still break a caller silently) in addition to grepping application code; and read each new CHECK/trigger against `scripts/seed-dev.sql` and any fixture file it will now validate. A design that fails this pass on the implementer's first read isn't a Phase 4 deviation — it's a Phase 3 defect, and catching it here is one grep cheaper than a loop-back.

### N2 — `architect.md` and `qa.md` have no "verify against the live catalog" step, though both self-invented it to make this pipeline's decisive catches

**Files:** `.claude/agents/architect.md`, `.claude/agents/qa.md`

The architect's Phase 2 verdict states plainly: *"Four of the rulings exist because I read the live database, not just `drizzle/`. The most important finding in this review is that the grant model this design's central mechanism rests on does not currently hold in the database"* — reversing what a correct read of `drizzle/` alone had concluded in Phase 1. QA independently built a "Live catalog" subsection in **both** of its re-verification passes, explicitly reading `pg_class`/`pg_trigger`/`aclexplode(relacl)` on the owner connection rather than `information_schema` ("only shows grants involving the current role") or the Drizzle table file, and named this distinction as deliberate ("no self-agreeing mock in the loop"). Neither agent file instructs this; both agents did it anyway, under time pressure, because the alternative (trusting the migration text or the Drizzle types) had already been shown wrong once in the same pipeline.

**Proposed addition to `architect.md`**, under "Your Review Process":

> For anything touching schema, RLS, or grants: check the **live database catalog** on the relevant Neon branch (`pg_class.relforcerowsecurity`, `aclexplode(relacl)`, `pg_trigger`), not just the migration files in `drizzle/` — a grant history can be additive and drift out of sync with stated intent (F38).

**Proposed addition to `qa.md`**, under "Feature-Gate Audit" (or as its own short section immediately after):

> **For schema/RLS changes, verify grants and trigger posture against the live catalog** — `pg_class`, `pg_trigger`, `aclexplode(relacl)` on the actual connection(s) in question — not `information_schema` (which only reports grants involving the current role) and not the Drizzle table file (it can silently disagree with what's actually deployed). This is the schema-work analog of "No self-agreeing DB mocks" above: don't verify a grant claim against the same source that might be wrong.

### N3 — `database-admin.md` should carry "`getPlatformDb()` is the owner connection; only a trigger binds it" as a standing operating rule

**File:** `.claude/agents/database-admin.md`

Folded into C1's proposed text above, but worth naming separately: `docs/TODO.md` already has a line asking the *documentation* review to add this fact to `CLAUDE.md`'s Key Invariants (a statement of fact, for every future designer). That is complementary, not redundant, with putting the operational corollary in `database-admin.md` — a rule the agent that writes DDL follows every time it's tempted to reason "the grant already prevents this." Both edits are needed; neither substitutes for the other.

### N4 — No named process for a post-merge external review of an unreleased migration

**Files:** `CLAUDE.md` (Project Layout, `drizzle/` entry), `.claude/agents/database-admin.md`

This pipeline invented, then repeatedly re-cited, its own precedent for exactly this scenario — "migration correction in place, same file, same number, matching the convention [prior ruling] established" — four separate times across one pipeline (a self-correction before batch B; QA's Finding 1/F46; an external reviewer's F47–F52; the resulting hardening-pass ratification), each time re-deriving the justification ("nothing has shipped to production, deploys do not auto-migrate") because there is nowhere to point instead. Recommend naming it once (see C1's proposed database-admin.md text) and cross-referencing it from `CLAUDE.md`'s Project Layout line for `drizzle/00XX_presby_*.sql`, so the next pipeline that gets an external review on unreleased DDL doesn't have to reconstruct the rule from a chain of "matching this pipeline's own precedent" citations.

### N5 — Concurrency: no instructions exist for running pipelines in parallel, and the one mechanism built for it went unused even in this single pipeline

**Files:** `CLAUDE.md` (Workflow Rules, Periodic Reviews), `.claude/skills/neon-postgres/SKILL.md`, `.claude/skills/merge-pr/SKILL.md`, `docs/decisions.md`, `docs/TODO.md`

`neon-postgres/SKILL.md`'s documented pattern for schema work is a dedicated Neon branch per feature, deleted when the feature ships. This pipeline — five migration increments plus two external-review passes, in one session — ran entirely against the single shared `development` branch instead, and every batch's Implementer Notes had to spend real, itemized effort disentangling ambient contamination left by *other* sessions before its own suite would even run clean: a stray person and memberships from 2026-08-27, a `personnel_admin` grant nobody seeded, an `organization_profiles` row with real PII, 48 orphaned `-<13-digit-timestamp>` test organizations, and a stale `presby_roll_cache_drift()` row. None of that is this pipeline's fault, but it is the predictable cost of schema work never actually using the branch-per-pipeline pattern the skill documents.

If the operator wants pipelines to run concurrently across functional domains, the instruction changes needed are:

- **A Neon branch per pipeline, actually enforced.** Add a line to CLAUDE.md's Phase 4 gate: schema pipelines create/use a dedicated branch per `neon-postgres`, not the shared `development` branch, unless a documented reason requires the shared one. Today's practice (evidenced by this pipeline) is that it doesn't happen even for a single large pipeline.
- **Pre-assigned migration/DECISION/F-number ranges.** `docs/decisions.md` states "the number does not change once assigned" and is edited newest-first by a single writer; this pipeline alone claimed one DECISION number (140, plus corrections) and six F-numbers (F44/F47–F52) in a single session. Two pipelines claiming numbers concurrently, with no reservation mechanism, will collide. A short line in `docs/TODO.md`'s In Flight section (or a small `docs/numbering-ledger.md`) reserving "next migration / next DECISION / next F" per active pipeline at Phase 3 kickoff would close this.
- **Serialized integration via `/merge-pr`, explicitly for this case.** `merge-pr/SKILL.md` already documents bottom-up serialization for stacked, dependent PRs. Workflow Rule 9 should say explicitly that concurrent pipelines merge one at a time through this skill even when their branches have no direct dependency — because the collision risk here is shared *files*, not shared *code*.
- **One shared-file owner per merge window.** `docs/decisions.md`, `docs/TODO.md`, `docs/reviews/log.md`, and `docs/schema-design*.md` are all newest-first, hand-edited, single-source files with no merge-conflict-resistant structure. A silently-bad three-way merge on `docs/decisions.md` (renumbering or dropping a decision) is worse than a visible Git conflict marker on a numbered list.

This is closer to an architectural question (should presby run parallel pipelines at all, given a single production database and no branch discipline in current practice) than a small instruction edit — recommend routing the "should we" half to the architect/user, and treating the mechanics above as what would need to exist first if the answer is yes.

### N6 — `/pre-push`'s Step 5 ("Schema and Migration Check") is also written only for `schema.ts`/`db:push`/`db:generate`

**File:** `.claude/skills/pre-push/SKILL.md`

Step 5 opens *"The starter uses Drizzle Kit. `src/lib/db/schema.ts` is the source of truth"* and only checks `git diff main -- src/lib/db/schema.ts` and whether a `db:generate` migration was committed alongside it. It has no check for a new or corrected `drizzle/00XX_presby_*.sql` file — no verification that its number is the next unused one, that `scripts/test-rls.sql` still passes against it, or that it's a *new* file rather than an edit to one already applied in a shipped environment (the exact distinction N4/C1 name). This pipeline's five migration files and two in-place corrections would sail through this step's checks today with nothing but the generic "schema.ts changed?" question, which is always "no" for hand-written presby DDL.

**Proposed addition to Step 5** (as a second numbered sub-check, parallel to the existing `schema.ts` one):

> **Hand-written presby migrations:** `git diff main --name-only -- drizzle/` for any `00XX_presby_*.sql` files. For each new file, confirm its number is the next unused one in `drizzle/` (catches the collision `database-admin.md`'s numbering-check note warns about); for each *modified* file, confirm via `docs/TODO.md`/`docs/STATE.md` that it has not yet been applied to a shipped environment (a migration correction in place is fine pre-release, wrong post-release). Either way, confirm `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql` was run and is green — this skill doesn't run it itself (it's a live-DB check, not a build-time one), but the summary should say so explicitly rather than silently skip it.

---

## Minor

### M1 — No structure/length guidance for a work-log this large

**Files:** `CLAUDE.md` (Per-Feature Tracking), `docs/work-log/_template.md`

`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` grew to ~3,900 lines across six phases, three Phase 3 amendments (plus a fourth and fifth loop-back), three Phase 4 batches, and two QA re-verifications — exactly what CLAUDE.md's "preserve the prior phase's full output... do not summarize away" instruction requires, and that instruction should not be softened. But there is no guidance for the file's *navigability* once it reaches this size; reviewing it required `grep -n "^#"` to build a table of contents that doesn't exist in the file itself. The pipeline already did the complementary right thing well — pushing durable rationale into `docs/schema-design-2.md` as "design authority" and keeping the work-log's amendment sections as rulings that reference it rather than restate it — so the gap is purely navigational.

**Proposed addition**, to `docs/work-log/_template.md`'s header or CLAUDE.md's Per-Feature Tracking section:

> A work-log that accumulates more than two Phase 3 amendments or Phase 4 batches should carry a short "Contents" list under the Per-Phase Status table, one line per amendment/batch section with its heading — the file stays the single source of truth; the list only helps a reader (or the next agent) jump to the relevant section instead of reading linearly.

### M2 — `new-feature` skill's "Large" guidance doesn't match how a large pipeline is actually run

**File:** `.claude/skills/new-feature/SKILL.md`

Step 3 says: *"Large — full pipeline, and break the work into multiple work-log entries (one per phase or per shipping increment)."* This large, five-increment pipeline did the opposite and, per M1 above, correctly so per CLAUDE.md's own preservation rule: one work-log, sequential Phase 4 "batches," Phase 3 "amendments" after each. Either the skill's guidance is aspirational text nobody follows, or there's a real distinction between "increments of one design" (stay in one work-log) and "genuinely separable features" (split) that the skill doesn't currently draw.

**Proposed replacement:**

> **Large** — full pipeline. A large feature with multiple shipping increments (e.g., a multi-migration schema pipeline) usually stays in **one** work-log, with each increment as its own Phase 4 "batch" subsection, per the Per-Feature Tracking discipline — split into separate work-log entries only when the increments are independently shippable features in their own right, not stages of one design.

### M3 — `CLAUDE.md`'s domain-file list is stale

**File:** `CLAUDE.md` (Project Layout)

The line *"`src/lib/db/domain/` — the presby schema, one file per module (org, people, roll, officers, groups, authz, privacy, reporting)"* names a `reporting` module that does not exist (`ls src/lib/db/domain/` returns no `reporting.ts`) and omits roughly a dozen files that do exist today — `lifecycle.ts`, `publication.ts`, `returns.ts`, `presbytery.ts`, `staff.ts`, `sites.ts`, `assets.ts`, `events.ts`, `support.ts`, `person-ext.ts`, `org-identifiers.ts`, `org-features.ts`, `org-feature-categories.ts` — five of which shipped in this very pipeline. This is squarely documentation-review territory, but the drift is large enough, and was made newly visible by this pipeline, that it's worth flagging here rather than waiting for the next monthly documentation pass. Recommend either an exhaustive, actively-maintained list or dropping the parenthetical in favor of "see the directory for the current module list."

---

## Observations

- `docs/TODO.md` already carries two items this review would otherwise raise fresh: the `getPlatformDb()`/`neondb_owner` CLAUDE.md Key Invariants note (owned by the documentation review) and the stale `../fpcw-directory`/`../westervillelions` prior-art paths in CLAUDE.md's table. Both are correctly tracked already — not duplicated here, just confirmed present.
- This is presby's first real agent-instruction review; there is no presby-specific prior punch-list to check for regressions. The starter's own 2026-05-17 findings (qa.md's stale test-runner caveat, api-developer's schema-boundary blur, the incomplete env-var table) were already resolved by the starter's own 2026-07-11 pass, before the fork — none of them recurred here.
- The pipeline's process discipline is worth stating plainly, since a punch-list-only report reads as if everything was broken: the judgment agents (analyst, architect, qa) stayed read-only and returned text for the orchestrator to record verbatim, exactly as CLAUDE.md requires; every deviation, spec defect, and loop-back candidate was named rather than silently reconciled, including ones that made the same agent's own prior work look wrong (tech-lead's Ruling B1 — "the five was wrong from round 3 forward" — was tech-lead correcting its own earlier document; QA's Finding 1 was QA finding a real hole in a design QA had just helped verify was buildable). The gaps above are about instructions not yet catching up to a working practice, not about the practice itself being unsound.
- `qa.md`'s existing "No self-agreeing DB mocks" principle already anticipates the spirit of N2's live-catalog step — extending it from "don't mock the column contract with the implementation's own column names" to "don't verify a grant claim against `information_schema` or the Drizzle file either" is a small, consistent extension of a rule already in the file, not a new philosophy.

---

## Files Reviewed

- `/Users/cshenso/git/presby-platform/presby/CLAUDE.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/analyst.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/architect.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/tech-lead.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/database-admin.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/api-developer.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/ux-developer.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/full-stack-developer.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/deployment-engineer.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/qa.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/agents/site-recreator.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/add-permission/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/downstream-sync/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/merge-pr/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/neon-postgres/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/new-feature/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/personalize-starter/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/pre-push/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/release-notes/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/test/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/skills/upstream-sync/SKILL.md`
- `/Users/cshenso/git/presby-platform/presby/.claude/settings.json` (SessionStart/PreToolUse hook wiring, allowlist)
- `/Users/cshenso/git/presby-platform/presby/docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` (primary evidence)
- `/Users/cshenso/git/presby-platform/presby/docs/work-log/_template.md`
- `/Users/cshenso/git/presby-platform/presby/docs/reviews/log.md`
- `/Users/cshenso/git/presby-platform/presby/docs/reviews/2026-05-17-agent-instruction.md` (format/precedent)
- `/Users/cshenso/git/presby-platform/presby/docs/reviews/2026-07-11-agent-instruction.md` (format/precedent)
- `/Users/cshenso/git/presby-platform/presby/docs/TODO.md`
- `/Users/cshenso/git/presby-platform/presby/docs/decisions.md` (DECISION-140 and its corrections)
