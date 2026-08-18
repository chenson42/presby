# Commit Message Standards — Work Log

> **Slug:** `2026-05-18-commit-message-standards`
> **Surface:** instruction layer + git hook + reporting script
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small — medium
> **Pipeline mode:** Full pipeline (new feature)

## Context

User asked: "we should institute standards for commit messages. i'd like to be able to glean statistics from git as to how well we are doing. i'd think we need to discern between bugs caught by automated e2e or expanded coverage versus human found bugs or functional incorrectness. this would feed into retros."

The retrospective (7-day cadence, owned by tech-lead) currently has no quantitative input — it produces qualitative observations only. A commit-message standard gives the retrospective a numeric anchor: rolling escape rate (bugs that survived the pipeline), broken down by how they were eventually caught.

## Proposed shape (to be refined by analyst in Phase 1)

1. **Conventional Commits prefix** — `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `style:`, `perf:`, `build:`, `ci:`.
2. **Two new trailers on every commit that fixes a bug** (`fix:` prefix):
   - `Caught-By: automated-test | agent-review | human-review | production`
   - `Discovered-In: Phase-1..6 | post-merge | production`
3. **A `commit-msg` git hook** that validates the format and rejects malformed commits with a clear error message.
4. **A `npm run stats:escape` script** that reads `git log --format='%H %s%n%(trailers)'` for the rolling 30-day window and prints a breakdown — total fixes, share caught by each channel, mean time to fix per channel.
5. **A CLAUDE.md section** ("Commit Message Standards") documenting the format with one example per channel; cross-linked from the retrospective owner's agent file so tech-lead's weekly run pulls the stats automatically.

## Important subtlety surfaced before Phase 1

Most bugs in this pipeline get caught **during Phase 5 by QA** and never become commits (e.g., today's NaN guard — found and fixed inside the same Phase 5 the timezone fix was being verified in). Those won't show in `git log` at all.

Commit-message stats only catch the **escape rate** — bugs that survived the pipeline. The complementary number (in-pipeline catch rate) would have to be mined from the work-log's Phase 5 sections. Treating these as one number would mislead. Phase 1 should decide whether to scope this work-log to escape-rate only, or to include a second tool that mines work-logs for in-pipeline catches.

## Goal

A commit-message standard, machine-validatable, that produces meaningful retrospective inputs without adding meaningful per-commit friction.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-18 |
| 2 — Architectural review | architect | Complete | Approved | 2026-05-18 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-05-18 |
| 4 — Implementation | full-stack-developer | Complete | Gates pass | 2026-05-18 |
| 5 — Verification | qa | Complete | PASS | 2026-05-18 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-05-18 |

## References

- `.claude/agents/tech-lead.md` — retrospective is tech-lead's; the stats output lands in their hands.
- `docs/reviews/log.md` — the 7-day retrospective cadence and its history.
- `CLAUDE.md` → `## Periodic Reviews` table.
- Today's git log — natural training set; both v0.3.4 and v0.4.0 commits would be retro-categorized to verify the format works.

---

## Phase 1 — Functional Refinement — 2026-05-18

**Owner:** analyst
**Status:** complete

### Summary

This feature is an instruction-layer + tooling change, not a user-facing UI feature. The primary "users" are commit authors (Claude Code agents and humans) and the tech-lead reading retrospective stats. The core shape is sound, but four gaps require resolution before Phase 3 begins: hook delivery in forks, the grandfather policy for existing commits, the `Caught-By` classification boundary when automated tooling is invoked by a human agent, and whether MTTR computation is in or out of scope.

**Verdict: READY WITH NOTES**

**One-line take:** A well-scoped tooling feature that will give the retrospective a real number to reason from, provided the four gaps below are answered before implementation.

### User Verbs

Three commit authors; one stats consumer.

**Claude Code agents** (all phases): write a commit message on task completion → hook validates on commit → on failure, read the rejection message, revise the message, re-commit.

**Original author / fork-owner** (human): same commit flow as above; also runs `npm run stats:escape` at the start of each weekly retrospective.

**Fork teammates** (human, optional): same commit flow; no additional verbs unless they also run retrospectives.

**Tech-lead** (retrospective consumer): runs `npm run stats:escape` → reads breakdown (total fixes, per-channel share) → cites numbers in the retrospective work-log entry → if a pattern is visible, names a follow-up action.

No surface name maps cleanly to the starter's four user surfaces (anonymous / access-pending / member / admin) — this feature lives entirely in the developer toolchain.

### Flows

**Commit flow (happy path)**
Entry: agent or human invokes `git commit -m "..."` → `commit-msg` hook fires → message matches `<prefix>: <description>`; if `fix:`, trailers `Caught-By:` and `Discovered-In:` are present and valid → commit lands.

**Commit flow (failure)**
Same entry → hook rejects → prints the expected format and names the specific missing or malformed field → author revises and re-runs `git commit` → hook passes → commit lands. *Note: the failure message must name what is wrong, not just print the schema. "Missing Caught-By trailer" is useful; "invalid commit message" is not.*

**Retrospective stats flow**
Entry: tech-lead begins weekly retrospective → runs `npm run stats:escape` → script reads `git log` for 30-day window → prints per-channel breakdown → tech-lead copies numbers into the retrospective work-log section.

**Edge case: mixed commit**
A single commit that adds a feature and fixes a bug — is the prefix `feat:` or `fix:`? This is a Phase 3 design question. Phase 1 flags it: the recommendation to resolve it is "one commit, one prefix; split the commit if both apply" — but that rule needs to be explicit in the CLAUDE.md section, not left to interpretation.

### Permissions and Flags

No `FEATURES` key required. No `feature_flags` entry required. The hook and the script are developer-toolchain artifacts that do not touch the app's permission or flag systems.

Hook installation: `.git/hooks/` is not committed (`.git/` is gitignored). This is the critical delivery gap — see Gaps below.

### Gaps the Request Didn't Address

**1. Hook delivery in forks.** `.git/hooks/` is not in version control. A fork owner who runs `git clone` will not get the hook. The standard solutions are (a) `husky` with a `prepare` npm lifecycle script, or (b) a `scripts/install-hooks.sh` invoked manually or via `prepare`. Phase 2 must pick one. The choice affects whether forks get enforcement automatically on `npm install` or only if they remember to run a script.

**2. Grandfather policy for existing commits.** Today's log uses `v0.3.3: follow-up sweep — ...` style throughout. Enforcement from a cutoff date avoids rewriting history but means `stats:escape` will silently undercount fixes made before the cutoff. The script must either (a) document the cutoff in its output header, or (b) warn when the 30-day window predates the cutoff. If the cutoff is not documented, the first retrospective will produce a number that looks misleadingly low.

**3. The `Caught-By: agent-review` boundary.** QA runs `npm run lint` as part of its Phase 5 sweep. The lint command is automated; the decision to run it is an agent. Today's v0.3.1 lint-regression example: the lint failure was surfaced by `npm run lint` (automated) executed by the QA agent (agent-review). Is that `automated-test` or `agent-review`? The distinction matters: `automated-test` signals the toolchain caught it; `agent-review` signals a human-equivalent decision was required. Suggest a rule: if the bug would have been caught by CI without any agent judgment, classify as `automated-test`; if an agent had to decide to run a non-mandatory check, classify as `agent-review`.

**4. MTTR computation scope.** The work-log proposes mean-time-to-fix per channel. Computing it requires knowing when the bug was introduced, which requires either a fourth trailer (`Fixes-Bug: <sha>`) or the author's manual attribution. A fourth trailer increases per-commit friction substantially. Recommend deferring MTTR to a follow-up (Phase 1 of a future work-log) and scoping this work-log to escape-rate breakdown only. If MTTR is retained, Phase 3 must define the exact trailer and the script's timestamp pair.

### Out of Scope (confirm with user)

- In-pipeline catch rate (bugs caught during Phase 5 before commit). The work-log's "important subtlety" section already surfaces this correctly. This work-log covers escape rate only; a second tool mining Phase 5 work-log sections is a separate feature.
- MTTR per channel (see Gap 4 above — recommending deferral).
- Backfilling / rewriting existing commit history.

### Open Questions

1. Hook delivery: `husky` + `prepare`, or `scripts/install-hooks.sh` + manual? Phase 2 decides.
2. Grandfather cutoff: what date, and should the script print it in its output header?
3. `Caught-By` boundary rule: adopt the "would CI have caught it without agent judgment?" heuristic, or a different rule?
4. MTTR: in scope for this work-log, or deferred?
5. Mixed commits: enforce "one prefix per commit, split if both apply" as an explicit rule in CLAUDE.md?

### Adversarial Pass

**Gaming the metric.** `Caught-By:` is entirely on the author's honor. There is no external anchor. A team under pressure to show a low escape rate will reclassify `production` bugs as `human-review`. Mitigation: the `stats:escape` script should also print the count of `fix:` commits with no trailers (hook-bypass indicator) and the count per channel alongside the percentage — a sudden shift in distribution without a corresponding change in total fix count is a legible signal in the retrospective.

**Hook bypass.** `git commit --no-verify` silently bypasses all hooks. CLAUDE.md already forbids this for Claude agents. For humans, the `stats:escape` script should emit a "commits missing required trailers: N" line so the bypass is visible in the next retrospective, not invisible.

### What I Did

- Read the full work-log context and the tech-lead agent file.
- Ran five-pass review adapted for a tooling/instruction-layer feature.
- Identified four gaps (hook delivery, grandfather policy, `Caught-By` boundary, MTTR scope) and two adversarial angles (metric gaming, hook bypass).
- Issued verdict and updated the per-phase status table.

### Outputs

- `docs/work-log/2026-05-18-commit-message-standards.md` — Phase 1 section appended; status table updated.

### Open Questions / Handoff Notes

Phase 2 (architect): resolve hook delivery mechanism (Gap 1) and confirm no `src/` file changes are required before Phase 3 begins. The four open questions above are inputs to that review.

---

## Phase 2 — Architectural Review — 2026-05-18

**Owner:** architect
**Status:** complete

### Summary

Approved. This feature is entirely in the developer-toolchain layer — no `src/` changes, no schema changes, no new app-runtime dependency. All four analyst gaps are resolved. The structural calls below are locked; tech-lead owns the remaining implementation decisions.

### What I did

**1. Hook delivery:** `scripts/install-hooks.sh` via npm `prepare` lifecycle. No new dependency. `husky` is well-known but the starter's "no unnecessary dependencies" policy is unambiguous — a short shell script accomplishes the identical result. `prepare` runs on `npm install` so forks get the hook automatically without a manual step.

**2. Validator script:** `scripts/commit-msg.mjs` (Node ESM), consistent with the `check-audit-coverage.mjs` precedent in `scripts/`. Node satisfies the error-message requirement (name the specific missing field) more reliably than bash regex. Parsing logic can be shared with `stats:escape` via a co-located helper.

**3. `stats:escape` placement and output:** `scripts/stats-escape.mjs`, stdout only. No file artifact. Consistent with `check-audit-coverage.mjs`. Tech-lead copies output into the retrospective work-log section manually.

**4. Grandfather cutoff:** 2026-05-18 (ship date). No grace period — solo repo, the standard starts when it ships. The cutoff is printed in the `stats:escape` output header on every run.

**5. `Caught-By` boundary rule:** Adopted as stated. If CI would catch it without agent judgment, classify `automated-test`; if an agent had to decide to run a non-mandatory check, classify `agent-review`. This rule goes in the CLAUDE.md "Commit Message Standards" section.

**6. MTTR:** Deferred. No `Fixes-Bug:` trailer in this iteration. Escape-rate breakdown is the deliverable. Per-commit friction kept minimal.

**7. Invariant checks:** No app-runtime dependency added. `husky` ruled out. `prepare` script is a devDependency-free hook. Hook error messages must name the specific missing field — confirmed as a validator requirement. `docs/reviews/log.md` needs no new entry type (retrospective owns the stats run). `.claude/agents/tech-lead.md` needs a cross-link sentence in the Ownership / 7-day retrospective bullet. `pre-push` skill does not need a new check — `stats:escape` is a read path, not a gate.

**8. CLAUDE.md placement:** New top-level section "Commit Message Standards" — not a Workflow Rule (those are prohibitions/mandates), not a Key Invariant (those are runtime boundaries). A dedicated section is the right taxonomy slot; agents discover it by reading CLAUDE.md the same way they find "Periodic Reviews."

### Outputs

- `docs/decisions.md` — DECISION-010 appended (hook delivery, validator placement, `stats:escape` output, grandfather cutoff, MTTR deferral)
- `docs/work-log/2026-05-18-commit-message-standards.md` — Phase 2 section appended; status table updated

### Open questions / handoff notes

- Tech-lead (Phase 3): design the exact trailer grammar (`Caught-By:` and `Discovered-In:` allowed values, case sensitivity, order), the mixed-commit rule ("one prefix per commit; split if both apply"), the validator's error-message strings, and the `stats:escape` output format. Name the implementer — this spans `scripts/`, `package.json`, and `CLAUDE.md`, making full-stack-developer the natural fit for a small coupled change.
- The `prepare` hook install approach requires the shell script to be idempotent (safe to re-run on repeated `npm install`). Flag this for the implementer.

---

## Phase 3 — Technical Design — 2026-05-18

**Owner:** tech-lead
**Status:** complete

### Summary

This phase locks the exact grammar the validator enforces, the mixed-commit rule, the algorithm for each script, the `package.json` additions, the CLAUDE.md copy, the agent cross-link, and the test spec — so Phase 4 has no design decisions left to make. No `src/` files are touched. The implementer is **full-stack-developer**.

### What I did

#### 1. Commit Message Grammar

**First-line pattern (single regex):**
```
/^(feat|fix|chore|docs|test|refactor|style|perf|build|ci)(\([^)]+\))?: .{1,100}$/
```

The scope group `(\([^)]+\))?` is optional. Description must be 1–100 characters. Case is exact — all prefixes lowercase.

**Exemptions (pass through without further validation):**
```
/^(Merge |Revert |Release )/
```

If the first line matches any exemption prefix, the validator exits 0 immediately.

**`fix:` trailer requirements.** When the prefix is `fix:` (with or without scope), the commit body must contain both trailers. Trailers are parsed from the commit body — any line of the form `Key: value` after a blank line. Order does not matter; both must be present.

Allowed `Caught-By:` values (exact, case-sensitive):
- `automated-test` — the bug would have been caught by CI without agent judgment
- `agent-review` — an agent had to decide to run a non-mandatory check
- `human-review` — a human reviewer identified the defect
- `production` — the bug reached a deployed environment before detection

Allowed `Discovered-In:` values (exact, case-sensitive):
- `Phase-1`, `Phase-2`, `Phase-3`, `Phase-4`, `Phase-5`, `Phase-6` — pipeline phase where the defect was first identified
- `post-merge` — identified after the feature merged but before production
- `production` — identified in a deployed environment

**Worked examples (one per prefix):**

```
feat: add user export to CSV

chore: upgrade Drizzle to 0.41

docs: add Caught-By boundary rule to CLAUDE.md

test: add validator unit tests for fix trailer parsing

refactor: extract parseTrailers into shared helper

style: normalize import order in scripts/

perf: reduce stats-escape git log parse to single pass

build: add prepare script for hook installation

ci: pin Node version to 22 in GitHub Actions

fix: reject malformed Caught-By values at hook

Caught-By: automated-test
Discovered-In: Phase-5
```

#### 2. Mixed-Commit Rule

**Rule:** One commit, one prefix. If a commit adds a feature and also fixes a bug, it must be split into two commits before pushing. The validator enforces this passively (it accepts only one prefix per commit); the CLAUDE.md section states it explicitly so authors understand why splitting is required, not just that it is.

Rationale: allowing a compound prefix (e.g., `feat+fix:`) would make `stats:escape` require ambiguous parsing and undercount `fix:` commits. The split requirement is the smallest enforcement that keeps stats honest.

#### 3. `scripts/commit-msg.mjs` Algorithm

1. Read `process.argv[2]` — the path to the commit message file passed by git.
2. Read the file; take the first non-comment, non-empty line as the subject.
3. Test against the exemption set (`Merge `, `Revert `, `Release `). If matched, exit 0.
4. Test subject against the first-line regex. On failure, print:
   `Error: commit subject must match "<prefix>: <description>" (1-100 chars)`
   followed by the allowed prefix list. Exit 1.
5. If prefix is `fix`, read the full message; parse all `Key: value` lines from the body (after the first blank line).
6. If `Caught-By` trailer is absent: print `Error: fix commits require a "Caught-By: <value>" trailer`. Exit 1.
7. If `Caught-By` value is not in the allowed set: print `Error: Caught-By value "<value>" is not valid. Allowed: automated-test, agent-review, human-review, production`. Exit 1.
8. If `Discovered-In` trailer is absent: print `Error: fix commits require a "Discovered-In: <value>" trailer`. Exit 1.
9. If `Discovered-In` value is not in the allowed set: print the analogous error with the allowed list. Exit 1.
10. Exit 0.

#### 4. `scripts/install-hooks.sh` Algorithm

1. Detect `.git/` presence. If absent (deployed environment, CI with shallow clone, no git dir), print `No .git directory found — skipping hook installation` and exit 0. This makes `prepare` a no-op in production.
2. If `.git/hooks/commit-msg` already exists and was not installed by this script: back up the existing file to `.git/hooks/commit-msg.bak` before overwriting. Print `Backed up existing commit-msg hook to .git/hooks/commit-msg.bak`. The backup step is unconditional on overwrite — simpler than fingerprinting.
3. Copy `scripts/commit-msg.mjs` invocation into `.git/hooks/commit-msg` as a one-line shell wrapper: `#!/bin/sh\nnode "$(git rev-parse --show-toplevel)/scripts/commit-msg.mjs" "$1"`.
4. `chmod +x .git/hooks/commit-msg`.
5. Print `commit-msg hook installed.`. Exit 0.

Idempotency: repeating the script overwrites the hook each time with the same content. The backup is also overwritten each time. This is safe; a fresh `npm install` on an already-initialized repo is a no-op in effect.

#### 5. `scripts/stats-escape.mjs` Algorithm and Output Format

1. Run `git log --since="30 days ago" --format="%H%n%s%n%b%n---END---"` and split on `---END---`.
2. For each commit entry: extract subject (second line), parse body for `Caught-By:` and `Discovered-In:` trailer values.
3. Count: total commits, total `fix:` commits, `fix:` commits with valid trailers (post-cutoff), `fix:` commits missing trailers (bypass indicator), and per-channel counts for `Caught-By`.
4. Print to stdout:

```
Escape-Rate Report — 30-day window
Grandfather cutoff: 2026-05-18 (commits before this date lacked trailers by design)

Total commits (30d):        42
fix: commits (30d):          7
  With trailers:             5
  Missing trailers (bypass): 2   ← hook bypassed or pre-cutoff

Caught-By breakdown (5 tagged fix: commits):
  automated-test   3  (60%)
  agent-review     1  (20%)
  human-review     1  (20%)
  production       0   (0%)

Discovered-In breakdown:
  Phase-5          3  (60%)
  Phase-4          1  (20%)
  post-merge       1  (20%)
```

The "Missing trailers" line is always printed, even when 0, so the absence of bypass is legible.

#### 6. `package.json` Script Entries

```json
"prepare": "node -e \"if(require('fs').existsSync('.git'))require('child_process').execSync('bash scripts/install-hooks.sh',{stdio:'inherit'})\"",
"stats:escape": "node scripts/stats-escape.mjs"
```

The `prepare` entry uses an inline Node guard rather than `bash scripts/install-hooks.sh` directly, because `npm install` in a deployed environment may not have bash on the path. The shell script itself still does the `.git` check, but the Node guard avoids a bash-not-found error on Windows or minimal containers. Implementer note: confirm this approach on the target platforms; swap to `cross-env` if needed (but do not add it without checking that it is already a dep).

#### 7. CLAUDE.md Section Copy

```markdown
## Commit Message Standards

Every commit must follow this format on the first line:

    <prefix>(<optional-scope>): <description (1–100 chars)>

Allowed prefixes: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`, `build`, `ci`.

Merge commits (`Merge ...`), revert commits (`Revert ...`), and release commits (`Release ...`) are exempt from validation.

**Bug-fix trailers.** Every `fix:` commit must include both trailers in the commit body (after a blank line):

    Caught-By: automated-test | agent-review | human-review | production
    Discovered-In: Phase-1 | Phase-2 | Phase-3 | Phase-4 | Phase-5 | Phase-6 | post-merge | production

`Caught-By` classification rule: if CI would have caught the bug without any agent judgment, use `automated-test`. If an agent had to decide to run a non-mandatory check, use `agent-review`.

**Mixed-commit rule.** One commit, one prefix. A commit that adds a feature and also fixes a bug must be split into two separate commits. The validator accepts only one prefix per subject line; there is no compound prefix.

**Hook bypass.** Never use `git commit --no-verify`. If the hook rejects a valid commit, fix the hook, not the bypass. The `npm run stats:escape` report shows a "Missing trailers (bypass)" count — this number should be zero in every retrospective.

**Running the stats.** `npm run stats:escape` prints a 30-day escape-rate breakdown. The tech-lead runs this at the start of each weekly retrospective and copies the output into the retrospective work-log section.
```

#### 8. `.claude/agents/tech-lead.md` Cross-Link

In the `## Ownership` section, append to the **7-day retrospective** bullet:

> Before synthesizing agent briefs, run `npm run stats:escape` and include the 30-day escape-rate numbers in the retrospective work-log section. The "Missing trailers (bypass)" count should be called out if non-zero.

#### 9. `/pre-push` Skill Update

**Option B: skip.** `stats:escape` is a read-only reporting tool, not a gate. Adding it to `/pre-push` would surface trailer-missing commits at push time when the author can no longer easily amend them (commits are already made). The better signal is the weekly retrospective, where a non-zero bypass count triggers a retrospective action item. Revisit if bypass rates are persistently non-zero after three retrospectives.

#### 10. Implementer

**full-stack-developer.** The work spans `scripts/`, `package.json`, `CLAUDE.md`, and `.claude/agents/` — no app code, no schema, no route handlers. All files are tightly coupled to a single delivery. Splitting across database-admin or api-developer adds overhead with no benefit.

#### 11. Unit Test Spec for Phase 5

All tests in a new file `scripts/commit-msg.test.mjs` (or `.test.ts` if the implementer imports the parsing logic into a TS helper). Tests exercise the parsing logic directly — do not test the hook installation.

| Test name | Input | Expected outcome |
|-----------|-------|-----------------|
| valid feat | `feat: add CSV export` | pass |
| valid fix with trailers | `fix: reject bad Caught-By\n\nCaught-By: automated-test\nDiscovered-In: Phase-5` | pass |
| missing prefix | `add CSV export` | fail, "must match" error |
| invalid prefix | `bugfix: something` | fail, "must match" error |
| description too long | `feat: ` + 101 chars | fail, "must match" error |
| fix missing both trailers | `fix: something` | fail, "Missing Caught-By trailer" |
| fix missing Discovered-In | `fix: something\n\nCaught-By: automated-test` | fail, "Missing Discovered-In trailer" |
| fix invalid Caught-By value | `fix: something\n\nCaught-By: ci-bot\nDiscovered-In: Phase-5` | fail, "Caught-By value \\"ci-bot\\" is not valid" |
| fix invalid Discovered-In value | `fix: something\n\nCaught-By: automated-test\nDiscovered-In: Phase-7` | fail, "Discovered-In value \\"Phase-7\\" is not valid" |
| Merge exemption | `Merge branch 'main' into feature/x` | pass (exempt) |
| Revert exemption | `Revert "feat: add CSV export"` | pass (exempt) |
| Release exemption | `Release v0.4.0` | pass (exempt) |
| optional scope | `feat(admin): add flag toggle` | pass |

Shell-script test for `install-hooks.sh` is overkill — Phase 5 verifies it manually by running `npm install` in a fresh checkout and confirming `.git/hooks/commit-msg` exists and is executable.

### Outputs

- `docs/work-log/2026-05-18-commit-message-standards.md` — Phase 3 section appended; status table updated
- No new decisions required — all implementation decisions are derivations of DECISION-010

### Open Questions / Handoff Notes

Use the **full-stack-developer** agent for Phase 4. Inputs are fully specified above; no design decisions remain.

Key implementer notes:
- `install-hooks.sh` must be idempotent and safe when `.git/` is absent
- The `prepare` entry must not fail in deployed/CI environments where `.git/` may not exist
- Confirm the `package.json` `prepare` inline Node guard works on Windows before landing — if not, document the limitation in a comment rather than adding a new dep
- The CLAUDE.md section is literal copy — do not paraphrase
- The tech-lead agent cross-link goes in the existing 7-day retrospective bullet, not as a new bullet

---

## Phase 4 — Implementation (full-stack) — 2026-05-18

**Owner:** full-stack-developer
**Status:** complete

### Summary

All four new script files are created, `package.json` has the two new entries, `CLAUDE.md` has the new section and updated nav, and `tech-lead.md` has the cross-link sentence. The 13 new Vitest tests pass alongside the existing 154 (167 total). All four gates pass: typecheck, lint, check:audit, and the new test run. The hook is installed and confirmed executable in `.git/hooks/`. The stats reporter runs cleanly against today's 30-day window.

### What I did

- Read the work-log top-to-bottom; read `scripts/check-audit-coverage.mjs` to lock the voice and style conventions.
- Read `vitest.config.ts` — discovered it only includes `src/**/*.test.ts`. Updated it to also include `scripts/**/*.test.mjs` so the new tests are picked up by `npm test`.
- Created `scripts/commit-msg.mjs` — exports `parseTrailers()` and `validateCommitMessage()` as named exports for testing; runs as a hook entry point when invoked directly via `process.argv[2]`. Follows the exact 10-step algorithm from Phase 3.
- Created `scripts/commit-msg.test.mjs` — 13 Vitest tests covering all Phase 3 test cases, testing `validateCommitMessage()` directly without the file-reading wrapper.
- Created `scripts/install-hooks.sh` — bash, idempotent, safe-on-no-git (uses `git rev-parse --show-toplevel`), backs up existing hook before overwrite, writes a one-line `#!/bin/sh` wrapper, `chmod +x`s the result.
- Created `scripts/stats-escape.mjs` — imports `parseTrailers` from `commit-msg.mjs` (single parse path), reads 30-day git log with `---END---` delimiter, prints the Phase 3 output format including the grandfather-cutoff header and always-printed bypass count.
- Edited `package.json` — added `prepare` (inline Node guard per Phase 3) and `stats:escape`.
- Edited `CLAUDE.md` — added the literal Phase 3 "Commit Message Standards" section text between "Workflow Rules" and "Common Commands"; updated the nav `**Sections:**` line to include the new anchor.
- Edited `.claude/agents/tech-lead.md` — appended the Phase 3 cross-link sentence to the 7-day retrospective bullet in `## Ownership`.
- Ran `bash scripts/install-hooks.sh` twice to confirm idempotency; confirmed `.git/hooks/commit-msg` is present and executable (`-rwxr-xr-x`). Second run produced the backup message as expected.
- Ran four synthetic validator inputs and captured outputs (see Implementer Notes).
- Ran all gates: typecheck (pass), lint (pass), check:audit (pass), `npm run test` (167 pass), `npm run stats:escape` (clean output, no crash).

### Outputs

**Files created:**
- `/Users/cshenso/git/claudecode/scripts/commit-msg.mjs` — validator + hook entry point; exports `parseTrailers`, `validateCommitMessage`
- `/Users/cshenso/git/claudecode/scripts/commit-msg.test.mjs` — 13 Vitest unit tests
- `/Users/cshenso/git/claudecode/scripts/install-hooks.sh` — idempotent hook installer (ships executable)
- `/Users/cshenso/git/claudecode/scripts/stats-escape.mjs` — 30-day escape-rate reporter

**Files modified:**
- `/Users/cshenso/git/claudecode/package.json` — added `prepare` and `stats:escape` scripts
- `/Users/cshenso/git/claudecode/vitest.config.ts` — added `scripts/**/*.test.mjs` to the `include` array
- `/Users/cshenso/git/claudecode/CLAUDE.md` — added `## Commit Message Standards` section; updated `**Sections:**` nav
- `/Users/cshenso/git/claudecode/.claude/agents/tech-lead.md` — appended cross-link sentence to the 7-day retrospective bullet

**No schema changes. No new npm dependencies. No new FEATURES keys. No audit events (toolchain feature, no DB mutations).**

### Implementer Notes

**Divergences from Phase 3:**

1. `vitest.config.ts` update — Phase 3 did not explicitly mention updating the Vitest include pattern, but the config only covered `src/**/*.test.ts`. The `scripts/commit-msg.test.mjs` file would be silently ignored without this change. Updated the include array to add `scripts/**/*.test.mjs`. This is the minimal change needed; it does not affect any existing test.

2. `isMain` detection — Phase 3 said "read `process.argv[2]`" as the hook entry point with no guard on `isMain`. Since the test file imports `validateCommitMessage` directly, the file-reading block runs only when `process.argv[2]` is present. Added an explicit `isMain` guard using `import.meta.url` comparison to make the intent clear and avoid any side-effects during test imports.

3. `stats-escape.mjs` Discovered-In output — Phase 3's sample output only printed `Discovered-In` values with non-zero counts. Implemented the same behavior (skip zero-count rows in the Discovered-In section) while always printing all Caught-By rows for consistency. The zero-count `Caught-By` rows are always shown so the absence of e.g. `production` bugs is legible.

4. `stats-escape.mjs` when no `fix:` commits — Phase 3's sample output assumed at least some tagged commits. Added a branch for the zero-tagged-fix case that still prints all channel rows at 0% so the output format is consistent.

**Windows compatibility note (from Phase 3):** The `prepare` inline Node guard uses `bash scripts/install-hooks.sh`. On Windows without Git Bash or WSL, `bash` may not be on the PATH. This is documented here rather than adding a dependency. The shell script itself handles the `.git`-absent case cleanly; the Node guard's `fs.existsSync('.git')` check prevents bash from being invoked at all in deployed/CI environments that lack `.git/`.

**Synthetic validator outputs:**

| Input | Exit | stderr |
|-------|------|--------|
| `feat: add upstream-sync skill` | 0 | (none) |
| `fix: empty trailers` | 1 | `Error: fix commits require a "Caught-By: <value>" trailer\nAllowed: automated-test, agent-review, human-review, production` |
| `Merge branch 'main'` | 0 | (none) |
| `random text` | 1 | `Error: commit subject must match "<prefix>: <description>" (1-100 chars)\nAllowed prefixes: feat, fix, chore, docs, test, refactor, style, perf, build, ci\nOptional scope: feat(admin): description\nGot: random text` |

**install-hooks.sh smoke test:**
- First run: `commit-msg hook installed.` — `.git/hooks/commit-msg` exists, `-rwxr-xr-x`.
- Second run (idempotency): `Backed up existing commit-msg hook to .git/hooks/commit-msg.bak` followed by `commit-msg hook installed.` — confirms backup + overwrite path works.

**stats:escape output against today's 30-day log:**
```
Escape-Rate Report — 30-day window
Grandfather cutoff: 2026-05-18 (commits before this date lacked trailers by design)

Total commits (30d):        15
fix: commits (30d):          0
  With trailers:             0
  Missing trailers (bypass): 0   ← hook bypassed or pre-cutoff

Caught-By breakdown (no tagged fix: commits in the last 30 days)
  automated-test   0   (0%)
  agent-review     0   (0%)
  human-review     0   (0%)
  production       0   (0%)
```
The 15 commits in the window all use the old `v0.X.Y: ...` style — none use `fix:` prefix — so `Missing trailers: 0` is correct (no bypasses; these are pre-standard commits, not post-cutoff hook bypasses). The cutoff header makes this legible.

### Open questions / handoff notes

QA (Phase 5) should verify:
- `npm run test` produces 167 passing tests (154 original + 13 new) on Node 22.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm run check:audit` passes.
- `npm run stats:escape` produces the cutoff header and non-crashing output.
- `.git/hooks/commit-msg` is present and executable after running `bash scripts/install-hooks.sh`.
- Manually write a commit message file and run `node scripts/commit-msg.mjs <path>` directly to confirm the hook would fire correctly. A valid `feat:` message exits 0; a `fix:` message without trailers exits 1 with the specific field named.
- The `prepare` script does not crash on `npm install`.

Note: Node 22 is required to run the test suite (the existing Vitest dependency has a transitive `rolldown` dep that requires `node:util`'s `styleText`, added in Node 20.12). This is a pre-existing condition, not introduced by this implementation.

---

## Phase 5 — Verification — 2026-05-18

**Owner:** qa
**Status:** complete

### Summary

All four gates pass. 167/167 tests pass (13 new + 154 pre-existing). The commit-message validator correctly enforces the Phase 3 grammar on all hostile inputs tested. The hook installer is idempotent, backs up pre-existing hooks, and is no-op-safe when `.git/` is absent. The stats reporter runs clean. Verdict: **PASS**.

### What I did

**Type Check:** `npm run typecheck` — PASS (zero errors)

**Lint:** `npm run lint` — PASS (zero warnings)

**Audit:** `npm run check:audit` — PASS

**Unit Tests:** 167/167 pass. Duration ~460ms. Run with Node 22 via nvm (Node 18 in default PATH triggers a pre-existing rolldown startup error; Node 22 is documented in Phase 4's implementer notes).

**`npm run stats:escape`:** Runs clean. Header includes grandfather cutoff `2026-05-18`. Missing-trailers line printed (shows 0 — correct, as all 15 commits in the 30-day window predate the standard and use `v0.X.Y:` format, none are `fix:` prefix). Discovered-In zero-rows are printed when no tagged `fix:` commits exist (zero-fix branch path), consistent with Phase 4's documented divergence.

**Algorithm audit — `scripts/commit-msg.mjs`:** Walked all 10 steps against Phase 3.
- Subject regex matches exactly: `feat|fix|chore|docs|test|refactor|style|perf|build|ci`, optional scope `(\([^)]+\))?`, requires `": "` (colon-space), 1-100 char description. Correct.
- Exemption set `Merge |Revert |Release ` tested via regex. Correct.
- `fix:` trailer check is prefix-only (step 5 uses `/^(fix)(\([^)]+\))?:/`). Both trailers validated independently (steps 6-9). Correct.
- Four allowed `Caught-By` values and nine allowed `Discovered-In` values match Phase 3 exactly. Correct.
- Error messages name the specific missing/invalid field in every branch. No generic "invalid commit message" text present. Correct.
- Exit 0 on success, exit 1 on any failure. Correct.

**Test file audit — `scripts/commit-msg.test.mjs`:** 13 distinct named cases covering all Phase 3 spec entries. Every failing case asserts both `.ok === false` and a content-specific `.toMatch()` pattern. No trivially-passing assertions. Minor note: the `fix missing both trailers` and `fix missing Discovered-In` tests use a regex OR pattern (`Missing Caught-By trailer|require.*Caught-By`) that accommodates either phrasing — this is loose but not wrong; the actual error text does match.

**Hostile-input tests (9 cases piped directly to validator):**

| Input | Exit | Result |
|-------|------|--------|
| Empty file | 1 | "Commit message is empty." — specific |
| Only whitespace | 1 | "Commit message is empty." — specific |
| 101-char description | 1 | "must match" error with `Got:` — specific |
| `feat:` no space after colon | 1 | "must match" error — correct |
| `FEAT:` uppercase prefix | 1 | "must match" error — correct (rejects, as designed) |
| `fix:` with `Caught-By: invalid-value` | 1 | Names `"invalid-value"` and lists allowed set — specific |
| `fix:` with `Discovered-In: Phase-7` | 1 | Names `"Phase-7"` and lists allowed set — specific |
| `fix:` trailers after extra blank lines | 0 | Passes — trailer parser scans all body lines; deliberate |
| Multi-line subject | 0 | First line `feat: add CSV` is valid; second line treated as body — deliberate |

**Hook integration test:** `.git/hooks/commit-msg` is present and executable (`-rwxr-xr-x`). Invalid message (`no prefix here`) exits 1 with the field-specific error. Valid message (`test: hook smoke`) exits 0.

**install-hooks.sh audit:**
- Uses `git rev-parse --show-toplevel` — confirmed, not CWD assumption.
- No-op when `.git/` absent — tested in a temp directory; prints informational message and exits 0.
- Backs up pre-existing hook to `.git/hooks/commit-msg.bak` before overwriting — tested with a seeded fake hook; backup content confirmed correct.
- `chmod +x` applied — confirmed `-rwxr-xr-x`.

**CLAUDE.md audit:** Section "Commit Message Standards" appears between "Workflow Rules" and "Common Commands" (lines 282-303). Navigation `**Sections:**` header includes `[Commit Message Standards](#commit-message-standards)`. All 10 example commit messages (one per prefix) pass through the validator at exit 0. Grammar summary is self-contained. `Caught-By` boundary rule stated. Mixed-commit rule stated. `--no-verify` prohibition stated.

**tech-lead.md audit:** Cross-link sentence confirmed appended to the 7-day retrospective bullet in `## Ownership`. Names `npm run stats:escape` and the bypass-count callout.

**vitest.config.ts audit:** `include` array contains `"src/**/*.test.ts"`, `"src/**/*.test.tsx"`, and `"scripts/**/*.test.mjs"`. No over-inclusion. Existing src test discovery unaffected (confirmed: 154 pre-existing tests all pass).

**Coverage on critical modules (v8 suppresses 100%-covered files):**
- `src/lib/permissions.ts`: 100% (not in coverage table — fully covered)
- `src/lib/two-factor.ts`: 100% (not in coverage table — fully covered)
- `src/lib/flags.ts`: 100% (not in coverage table — fully covered)
- `scripts/commit-msg.mjs`: 79.62% stmts — uncovered lines are 90 (empty-subject branch, exercised but branch variant uncovered) and 170-184 (the `isMain` hook entry block, intentionally not exercised by unit tests)
- Overall: 77.11% statements across all instrumented files — above 70% target

**Self-consistency check (Phase 3 vs Phase 4):** Two divergences, both documented by Phase 4:
1. `vitest.config.ts` update (not in Phase 3 spec) — necessary, minimal, no design implication.
2. `isMain` guard added — Phase 3 algorithm said "read `process.argv[2]`" with no guard; guard was needed to prevent side-effects during imports. Correct implementation choice.
3. `stats-escape.mjs` Discovered-In: skips zero-count rows when tagged fixes exist (differs from Phase 3 sample which showed all rows). Zero-count rows are still shown in the all-zero case. Minor divergence, documented, not a defect.

No additional undocumented divergences found.

### Outputs

- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-18-commit-message-standards.md` — Phase 5 section appended; status table updated to PASS

### Open questions / handoff notes

- Nominate **analyst** for Phase 6 (shipped-vs-intent review).
- The `isMain` detection uses two conditions (`import.meta.url` comparison OR `process.argv[1]?.endsWith("commit-msg.mjs")`). The second condition is broad — any script named `commit-msg.mjs` anywhere on argv[1] would be treated as main. Not a defect in practice (this is a hook script, not a library), but worth noting.
- The `prepare` script's inline Node guard (`fs.existsSync('.git')`) prevents bash invocation in deployed environments, but the Windows compatibility gap (bash may not be on PATH) remains documented and accepted per Phase 3's explicit decision. No action required unless the project gains Windows contributors.

---

## Phase 6 — Shipped vs Intent — 2026-05-18

**Owner:** analyst
**Status:** complete

### Summary

Verdict: **SHIP IT.** Every Phase 1 commitment is present in the shipped code, confirmed by reading files and running the live script. Four Phase 1 gaps were all resolved in Phases 2-3 and correctly implemented. Three minor follow-ups surface below — none block ship.

**One-line take:** The commit-message standard shipped exactly as specified: a grammar-enforcing hook, a self-explanatory stats reporter, and CLAUDE.md documentation that gives an agent or human enough to act on without reading the work-log.

### What I did

- Read `scripts/commit-msg.mjs`, `scripts/stats-escape.mjs`, `CLAUDE.md` §"Commit Message Standards", and `.claude/agents/tech-lead.md` §"Ownership".
- Ran `npm run stats:escape` live.
- Piped a deliberately mixed prefix (`feat+fix: ...`) through `node scripts/commit-msg.mjs` directly.
- Confirmed git log visibility of the two real post-cutoff commits.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Validator rejects messages missing `Caught-By` / `Discovered-In` trailers and names the specific field | Error strings explicitly name the absent trailer and list the allowed set — no generic fallback present | matches |
| Grandfather cutoff printed in `stats:escape` output header | Line 2 of output: `Grandfather cutoff: 2026-05-18 (commits before this date lacked trailers by design)` | matches |
| Bypass count printed always, even when zero | "Missing trailers (bypass): 0" is always emitted — confirmed in live output and in the zero-fix branch of `printReport()` | matches |
| Mixed-commit validator passively rejects (one prefix) + CLAUDE.md documents why | `feat+fix: ...` exits 1 with "must match" error; CLAUDE.md states "One commit, one prefix" and explains "there is no compound prefix" | matches |
| `Caught-By` boundary rule actionable without ambiguity | CLAUDE.md: "if CI would have caught the bug without any agent judgment, use `automated-test`. If an agent had to decide to run a non-mandatory check, use `agent-review`." — two distinct conditions, no overlap, self-contained | matches |
| Stats reporter cross-linked in tech-lead retrospective bullet | `tech-lead.md` line 82: "Before synthesizing agent briefs, run `npm run stats:escape` and include the 30-day escape-rate numbers..." — in the correct ownership bullet | matches |
| MTTR deferred | No `Fixes-Bug:` trailer, no timestamp pair in the reporter | matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state — first retrospective with zero `fix:` commits | Output is self-explanatory: cutoff is in the header, all Caught-By rows show 0%, zero missing-trailers count is printed with the "pre-cutoff" annotation. A consumer reading this cold will not conclude the script is broken. | pass |
| Bypass visibility | "Missing trailers (bypass): 0" printed in every run. Non-zero would be legible immediately. | pass |
| Adversarial: gaming detection | Stats output always shows per-channel counts alongside percentages and a total fix count. A sudden shift in distribution without a corresponding rise in total `fix:` commits is a detectable signal for the tech-lead. Not foolproof, but the design acknowledged this and accepted the honor-system tradeoff. | pass |
| Adversarial: agent self-bypass via Edit+push | Phase 3 deliberately deferred pre-push integration. The failure mode (agent edits files, commits without hook firing) is mitigated by CLAUDE.md's explicit `--no-verify` prohibition and the bypass counter's visibility at retrospective time. This is the right call: adding `stats:escape` to pre-push would surface trailer gaps at push time when amending is no longer easy. The risk is low in a solo repo. | pass (accepted) |
| v0.3.4 and v0.4.0 commits visible in 30-day window | Both appear in `git log --since="30 days ago"`. Neither uses `fix:` prefix, so `fix: commits (30d): 0` and `Missing trailers: 0` are both correct. | pass |
| Permission gate | Not applicable — toolchain feature, no FEATURES key. | n/a |
| Audit events | Not applicable — no DB mutations. | n/a |
| Mobile | Not applicable — no UI surface. | n/a |

### Follow-ups (SHIP WITH NOTES — none; SHIP IT)

Three items are noted but none require follow-up action before ship:

1. **79.62% coverage on `commit-msg.mjs`** — uncovered lines are the `isMain` hook entry block (lines 170-184), which is intentionally untested by unit tests and was tested manually in Phase 5. Acceptable for a hook entry point. No action required.
2. **`isMain` second condition breadth** — `process.argv[1]?.endsWith("commit-msg.mjs")` is broad. Not a defect in practice; surfaced by QA. No action required unless the script is ever used as a library by another script with a similar name.
3. **Windows compatibility** — `bash` may not be on PATH in Windows environments without Git Bash or WSL. Documented in Phase 3 and Phase 4. No action required unless the project gains Windows contributors.

### Outputs

- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-18-commit-message-standards.md` — Phase 6 section appended; per-phase status table updated to SHIP IT.

### Open questions / handoff notes

None. Pipeline closed.
