# Retrospective workflow-efficiency follow-ups — Work Log

> **Slug:** `2026-10-25-retro-workflow-efficiency`
> **Surface:** internal tooling (scripts, Playwright config, e2e support, docs/briefings)
> **Permission(s):** TBD in Phase 1/3
> **Flag(s):** none expected (operator: per-org toggles, not new platform flags, pre-live)
> **Estimated complexity:** small
> **Pipeline mode:** Full Feature (promoted at Phase 5 run 1, QA FAIL-1 traced to design Copy C8; was Accelerated, relabelled from Polish at Phase 1)
> **Numbers (pre-assigned 2026-10-25, Rule 16):** no migration; DECISION-231; F239; dev port 3480; no Neon branch until Phase 4 needs one

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; recommends relabel to Accelerated Feature; Phase 2 skippable, short Phase 3 | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Skipped (Accelerated Feature; see rulings) | — | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete (Accelerated tier; nine items, one commit each; Appendices A-D hold the parser reference, DECISION-231, F239 and the twelve briefings drafts) | Design complete; implementer named | 2026-10-25 |
| 3 — Technical design, amendment 1 | tech-lead | Complete (QA run 1 loop-back: FAIL-1 resolved by redefining Item 8 / Copy C8, keep and make removal depend on merged-with-own-commits and clean; FAIL-2, N1, N2 specified; N3 none; N4 TODO watch; implementer full-stack-developer; QA re-run scope named) | Amendment complete; implementer named | 2026-10-25 |
| 4 — Implementation | full-stack-developer | Complete (11 code commits plus 1 docs follow-up; failing-first recorded; gates green; ready for QA) | Phase 4 complete | 2026-10-25 |
| 4 — Implementation, loop-back 1 | full-stack-developer | Complete (amendment 1 implemented: 4 code/test commits plus this docs commit; failing-first recorded; gates green; ready for QA run 2) | Phase 4 complete | 2026-10-25 |
| 5 — Verification | qa | Run 1: FAIL-1 (design C8, promotes to full Feature) and FAIL-2 (implementation); everything else green | FAIL | 2026-10-25 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

Pipeline `2026-10-25-retro-workflow-efficiency`. This is a read-only brief. I wrote no files. I checked it against main `ce661d7`, the five sibling worktrees, `scripts/pre-push-gate.mjs`, `playwright.config.ts`, `e2e/support/*`, `scripts/briefings-check.mjs`, `docs/briefings.md`, `docs/decisions.md`, the 2026-10-24 retrospective and `docs/TODO.md`. I also ran the gate's matcher (`commandContainsGitPush`) in-process against hostile command strings, which wrote nothing.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Five small guardrails and a stale digest that cost this pipeline repeated turns, but the push-gate rule as written would block this pipeline's own commit messages and the retry rule as written would double-insert fixture rows, so Phase 3 has to settle those first.

## Classification

The work-log header says Polish. It meets the **Accelerated Feature** row (CLAUDE.md, DECISION-229) better:
- It adds **new refusal behavior** the operator and agents will meet, which is "new user-visible behavior".
- It crosses none of the excluded lines: no migration, no `src/auth.ts` / `src/proxy.ts` / `src/lib/authz.ts`, no flag or permission seed, no route, server action, `SECURITY DEFINER` function or dependency.
- I recommend the orchestrator relabel it Accelerated Feature. That keeps QA's copy-truthfulness check, which applies to the BLOCKED and throw strings and to the briefings prose. A Polish label would let those be skipped.

## User Verbs

The "users" are the operator and the agents. All surfaces are internal tooling. There is no member, admin or anonymous surface, no UI and no 360px check.

| Surface | Verb | Cadence |
|---|---|---|
| Agent (Bash hook) | Runs `git commit ... && git push` in one call and is refused with a message naming the fix | Each time an agent chains them |
| Agent (Bash hook) | Commits, runs `/pre-push`, pushes in a separate call, and is not blocked | Every push |
| Agent / QA | Runs `npx playwright test` from a linked worktree with the port unset or 3000, and is stopped with instructions | Each e2e run in a worktree |
| Agent / QA | Runs `psql ... -f scripts/ci/e2e-reset-flags.sql` against a pipeline branch before an e2e run | Each QA e2e run |
| Fixture code | Wraps DB calls in `withDbRetry()` during setup and teardown | Each spec file |
| Operator (SessionStart) | Reads the briefings banner and gets a true count | Each session |
| Operator | Reads about a dozen release-level briefing entries | One-time |
| Orchestrator / retro | Runs `stats:escape --since=...` | Each retrospective |

## Flows

**Flow 1 — Push gate refuses a HEAD-moving command**
- Path: the agent runs a command with a `git commit|merge|rebase|cherry-pick|am` segment and a `git push` segment, targeting presby's own repo. The hook exits 2 with "BLOCKED (Workflow Rule 5): this command moves HEAD and pushes in one call. Commit first, run /pre-push, then push in a separate call."
- The agent then runs the commit, runs `/pre-push` (which stamps the marker), and pushes. The push passes.
- Failure: a parse error still fails open (exit 0), unchanged.
- Ordering: the new check must sit **after** the target-repo resolution. Otherwise `git commit && git push` inside a `scratch/` checkout (site-kit work) would start being refused, and it is deliberately exempt today.

**Flow 2 — Playwright dev lane in a worktree**
- Path: `git rev-parse --git-dir` differs from `--git-common-dir`, the parsed port of `E2E_BASE_URL` (or the 3000 default) is 3000, and `PW_ALLOW_3000` is unset. Config load throws with the real remedy: start your own server on your assigned port and set `E2E_BASE_URL`, or set `PW_ALLOW_3000=1` to accept the shared-server risk.
- Main checkout: unchanged, `reuseExistingServer` stays.
- CI: not a linked worktree, so it never throws.
- Failure: if `git` is unavailable or errors, treat the checkout as the main one (do not throw).

**Flow 3 — QA resets flags then runs e2e**
- Path: QA runs `e2e-reset-flags.sql` on the pipeline Neon branch. Every `feature_flags` row goes to its `scripts/seed.ts` value, then `e2e-baseline-flags.sql` is applied. The existing assertion, 3 baseline flags enabled, fails loudly on drift.
- QA states in its verdict that it reset.
- Failure: a seeded key is missing from the table, so the file raises.

**Flow 4 — Connection drop during a fixture**
- Path: `withDbRetry` retries 5 times at 0.5, 1, 2 and 4 seconds, only on drop-shaped errors. A constraint error throws at once.
- Failure: after the fifth attempt it throws with the original error.

**Flow 5 — Operator starts a session**
- Path: `briefings-check` counts distinct recorded DECISION numbers above the marker. After the backlog write-up the banner is silent.

## Permissions & Flags

- **Permission(s):** none. No `FEATURES.*`, no route, no session claim.
- **Flag(s):** none. This is dev tooling and cannot be flagged. Rollback is `git revert` of the individual commit.
- **Audit:** not security-sensitive in the `audit_events` sense. The push gate is a Rule 5 control, so its change gets a test but no audit row.

## Gaps the Request Didn't Address

1. **G1 — The new gate rule would block this pipeline's own commits.** The splitter is quote-naive.
   - `git commit -m "a chained git commit && git push is refused"` already matches as a push.
   - So does a heredoc commit message that has a line starting with `git push`, which is the house commit style.
   - Today that false positive only bites when the marker is stale or missing, which is the normal state at commit time. After the change it would be refused even with a fresh marker.
   - The pipeline's own commit messages will describe this exact behavior and will trip it.
   - Resolution: strip quoted strings and heredoc bodies before splitting, and pin both directions in tests.
2. **G2 — Quote-awareness alone opens bypasses, and the gate already has some.** I ran these:
   - `bash -c "git commit -m x && git push"` returns false, because token 0 is `bash`.
   - `command git push` and `/usr/bin/git push origin main` return false.
   - `(git commit -m x; git push)` returns false, because the trailing `)` makes the token `push)`.
   - Stripping quotes would make wrapped forms worse, since the quote-naive scan currently catches some of them by accident.
   - Resolution: recurse into the string argument of `bash|sh|zsh -c` and `eval`. Strip trailing `)` and `}`. Match `git` by basename and skip `command` / `env` / `exec` prefixes. Anything beyond that (aliases such as `git ci`, variable indirection) is an **accepted residual**. The gate catches an agent's mistakes, not an adversary, per its own header and Rule 5's intent. Write that down in the gate's doc comment.
3. **G3 — The HEAD-mover list is incomplete.** `pull` (fetch plus merge/rebase), `revert` and `reset` also move HEAD before a chained push. Default: add `pull`, `revert` and `reset`, with the annoyance of a no-op `git pull --ff-only && git push` being refused stated in the message.
4. **G4 — The gate test cannot touch the real marker.** The marker path is derived from `REPO_ROOT`, so a hook-mode integration test that stamps a marker would overwrite the operator's real stamp. Export a pure decision function (command, cwd, marker, head, so it returns allow or block plus message) and test that. Do not spawn the hook against the live marker.
5. **G5 — "Use `withDbRetry` in every fixture's setup" is unsafe for plain INSERTs.**
   - A `fetch failed` on the HTTP driver can mean the statement committed and only the response was lost.
   - Retrying a non-idempotent INSERT then hits a unique violation, or silently duplicates a row where no constraint exists.
   - Teardown DELETEs and sweeps are idempotent. Setup INSERTs need `on conflict do nothing`, a check-then-insert, or no wrapper.
   - Scope is also large: about 13 files and 150-plus `sql` call sites.
   - Default: wrap all teardown and sweeps, and wrap setup only where the statement is idempotent or made so. List the fixtures touched. Do not touch call sites in a fixture a parallel pipeline is editing (see Rule 16 below).
6. **G6 — The existing `withDbRetry` has no test.** Its doc comment says "Exported for the unit test", and `grep` finds none. Two further problems:
   - Vitest's `include` covers only `src/**` and `scripts/**/*.test.mjs`.
   - Playwright's `testDir: ./e2e` would collect a `*.test.ts` placed under `e2e/`.
   - Default: put the test in `scripts/` as `.mjs` importing the `.ts`, which needs no `vitest.config.ts` edit. This also keeps clear of `presby-sess`, which edits `vitest.config.ts`.
7. **G7 — The retry regex and the TODO text disagree.** The current regex also matches `NeonDbError`, `EPIPE`, `socket hang up` and the bare word `timeout`, so a statement timeout is retried 5 times. The spec says "only fetch failed, Connection terminated, ECONNRESET, timeouts". Pin it with a test that a unique-violation `NeonDbError` throws immediately. Default: keep the broader drop set, but exclude statement and lock timeouts. The log prefix `[domains-ui-fixture]` becomes `[e2e-db]`, and `invitation-fixture.ts` stops importing from `domains-ui-fixture`.
8. **G8 — `e2e-reset-flags.sql` has two sources of truth.**
   - It duplicates `seed.ts`'s flag list in SQL (about 40 keys). A flag added later to `seed.ts` and missed in the SQL keeps its inherited value, which is the exact drift the file exists to end.
   - Default: SQL file, plus a vitest in `scripts/` that parses `seed.ts` (keys and `enabled`) and the SQL and fails on any difference. Do not restructure `seed.ts`; touching the flag seed would push this out of the Accelerated tier.
9. **G9 — The reset file is destructive if pointed at the wrong branch.** Run against `development`, it turns off flags the operator switched on for live demos. Default: the file refuses unless `-v pipeline_branch=1` is passed. The documented command uses `"$PLATFORM_DATABASE_URL"` and never echoes the value (retro item 15). It covers global `feature_flags` only. Per-org toggles are out of scope and recorded as a residual.
10. **G10 — The dev lane never passes the port to the server it spawns.** `command: "npm run dev"` binds :3000, or auto-increments, whatever `E2E_BASE_URL` says. So in a worktree with `E2E_BASE_URL=:3480` and no server running, Playwright spawns a server on the wrong port and times out waiting. The guard's message should say "start `npm run dev -- -p <port>` yourself". Optional improvement: derive `-p` from the base URL port. Include it only if Phase 4 verifies it with a real run on the assigned port. Unverified: whether `.env.local`'s `AUTH_URL=http://localhost:3000` affects sign-in on another port. The docs say :3100 and :3111 runs work, but that is unconfirmed here.
11. **G11 — The briefings marker is a high-water mark, and out-of-order decision numbers break it.**
    - Rule 16 pre-assigns numbers, so they land out of order. `presby-2b` has reserved DECISION-225 to 228 and 230, and `presby-sess` references 230. DECISION-229 is already recorded on main.
    - If the marker moves to 229, a late-landing 226 sits below it and the staleness check never sees it.
    - Default: count distinct recorded numbers above the marker **that `briefings.md` does not already name** (`DECISION-0*N\b`). The marker stays at the contiguous floor (224). A 12th entry names 229 and silences it. Late 225 to 228 and 230 are flagged correctly when they land.
12. **G12 — Pre-existing: `docs/TODO.md:431`** says `rate-limit.test.ts` fails 3/15 under `.env.local`. That is already fixed (`src/lib/rate-limit.test.ts:195-206` stubs `RATE_LIMIT_DISABLED=false`; the TODO line 210 item 1 is marked done). The line is stale and should be closed in the Rule 10 housekeeping commit.

## Briefings backlog: does the plan need re-scoping?

Partly. The marker is still `decision=167 commit=2761de8`.

- **The count.** The banner says 62 behind, but that is `229 - 167`. Distinct recorded numbers above 167 are **50**: 168-206 (39), 215-224 (10), and 229 (1). Numbers 207-214 are absent. 225-228 and 230 are reserved by open pipelines.
- **The plan's coverage still holds.** The retro's 11 entries cover 168-224 and the release groups (0.33.1 through 0.42.2). Nothing user-visible has shipped since 5f333eb. Commits after it are docs only (7ad8313, ce661d7).
- **Add a 12th entry** for DECISION-229 (the Accelerated Feature tier) and the retrospective punch list that landed on 2026-10-24. The set 168-224 plus 229 is 50, with 12 entries covering all of it.
- **Marker.** The marker commit should be the then-current main HEAD, not 5f333eb. The decision value is per G11: 224, or 229 if the check is not changed.
- **Truthfulness.** These entries make factual claims, for example "no user-visible change" and "a contact email authenticates nothing". Someone other than the drafter should read them against the work-logs.
  - The No Real Data invariant applies, so no real congregation names (the first customer included).
  - The reading load is real: 82 unread plus 12 new. Open question Q6 asks about a bulk tick.
- **Drafter.** The retro offered tech-lead to draft from the work-logs and `STATE.md`. This is the one non-code item and a separate `docs(briefings)` commit.

## Sweep: other efficiency items — IN or OUT

| Item | Call | Rationale |
|---|---|---|
| Push-gate commit+push refusal (1) | **IN** | Closes the Rule 5 hole. Needs G1 to G4. |
| Playwright worktree :3000 guard (2) | **IN** | Cost three discarded or contaminated QA runs. Pure function plus `--list` verification. |
| `withDbRetry` to `db.ts` (3) | **IN, scoped per G5** | Teardown-first, idempotent setup only. |
| `e2e-reset-flags.sql` (4) | **IN with G8 and G9** | Drift test and branch guard. |
| `briefings-check` distinct count (and G11) | **IN** | About 15 lines plus a test. |
| Briefings backlog write-up | **IN, own commit** | Prose, not code. Needs a non-author read. |
| `stats-escape.mjs --since=<git date>` | **IN** | TODO `:494`. The 30-day window double-counts against the 14-day retro cadence. Default stays 30 days. The window label in the output must follow the flag. Use `execFileSync` and validate the value, not interpolate argv into a shell string. About 20 lines plus a test. |
| Disk and worktree report script (new, report-only) | **IN, optional (cut first if slow)** | Prints free GiB on the data volume, per-worktree split (`node_modules` / `.next` / rest), whether the branch is merged into main, and suggested removal commands. It deletes nothing. Disk hit 1.9 GiB today, and the retro found ENOSPC read as a Neon `fetch failed` twice. |
| Close stale `TODO.md:431` | **IN** | Verified fixed, housekeeping only. |
| CI orphan Neon-branch janitor | **OUT** | New scheduled workflow with Neon API credentials and a destructive delete. It cannot be tested locally and needs a rule that never touches `production` or `development`. Own deployment-engineer pipeline. Stays a TODO line. |
| `rate-limit.test.ts` under `.env.local` | **OUT** | Already fixed (G12). |
| Stale `.next` / Turbopack font cache | **OUT** | The cause is `turbopack.root` in `next.config.ts` spanning sibling worktrees. The fix is a build-config change that needs a build verification of its own. The scratch-copy recipe in `docs/testing.md` stands. |
| `TODO.md:118` gate `cd`-tracking in a forked-agent context | **OUT** | Needs a repro in that execution context. Same file, but not reproducible here. G2's tests may incidentally cover the `cd` case. |
| Fixture-orphan sweeper (`TODO.md:165`, `:489`) | **OUT** | Needs a deletion-policy decision (the `deletable_until` guard). Not code-only. |
| DB-backed vitest suites timing out on Neon | **OUT** | `testTimeout` and `hookTimeout` are already widened. A vitest-side retry helper is a design question, not a small item. |
| Editing CLAUDE.md "Common Commands" for `--since` | **OUT** | CLAUDE.md edits need operator approval. Note the new flag in the script's header only. |

## Adversarial Pass

- **Self-targeting and bypass of the gate.** G1 and G2. In summary:
  - False positives on message text.
  - Wrapped invocations that already evade the push matcher.
  - A plain terminal is not gated, by design.
  - `git commit` and `git push` in different repos in one command: the check runs only for presby's own push target, so a `scratch/` commit paired with a presby push is not caught. That case is pathological and recorded as a residual.
- **Playwright guard.**
  - Port parsing: `http://localhost` with no port is 80, not 3000, so parse with `new URL`.
  - `127.0.0.1:3000` and `[::1]:3000` must also count.
  - Config reloads in each worker, so the throw repeats harmlessly there.
  - `PW_ALLOW_3000` is the documented escape and the message must name it.
  - The main checkout and CI paths must be proven non-throwing.
- **Retry.** G5 (double-insert) and G7 (constraint error retried). A timeout retried 5 times can turn a 20 s stall into more than 100 s.
- **Reset SQL.** G9. It is also a path by which QA "certifies" a spec against a flag state the SQL set. The final assertion (3 baseline flags on) stays.
- **`stats-escape --since`.** Argv reaching a shell string is injection. Use `execFileSync` with an argument array and an allowlist pattern for the date.
- **Briefings.** G11. The check reads `decisions.md` from `projectRoot`, which resolves correctly in a worktree.
- **Enumeration and redirect leaks:** not applicable.

## Rule 16: shared-file caution

It does matter, in three ways.

1. **`e2e/support/*` is on the shared list and this pipeline edits it mid-pipeline.** Rule 16 says those files are edited only at integration, by the orchestrator. I read the sibling worktrees. As of now, none of `presby-2b`, `presby-cal`, `presby-inc3`, `presby-parish` or `presby-sess` has a diff against main in `e2e/support/*`, `playwright.config.ts` or `scripts/`.
2. **The "none is in Phase 4" statement is not quite right.** `presby-sess` (`pipeline/session-update-hardening`) is **Phase 4 complete**, awaiting QA (commit 4a3396f). It touches `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, a new e2e spec and `vitest.config.ts` (+5 lines). It does not touch `e2e/support/*`. So the conflicts to avoid are:
   - Do not edit `vitest.config.ts` (G6).
   - Do not edit `src/auth.ts`.
3. **The pipelines most likely to touch fixtures are `cal`, `inc3`, `parish` and `2b`.** All four are pre-Phase 4. Land this pipeline early, have those four merge main up before their QA (as they already do), and keep the `e2e/support/*` change to `db.ts` plus teardown edits. Per-file edits to fixtures a sibling will extend (`calendar-fixture`, `community-fixture`) go last, or wait for those pipelines. `docs/TODO.md` and `docs/decisions.md` (DECISION-231) are edited at integration by the orchestrator.

## Environment prerequisite for Phase 4 and 5

- `df -h /System/Volumes/Data` shows **1.9 GiB free**. The new-feature checklist requires 20 GiB.
- `presby-wf` has no `node_modules` (36 MB total). A normal clone is about 885 MB. Use a **hardlinked** copy (`cp -al`) for roughly zero extra bytes.
- Regenerable `.next` directories are the quick wins: about 721 MB in the main checkout and 776 MB in `presby-sess`.
- The orchestrator should do this housekeeping before Phase 4, or the unit gates themselves may hit ENOSPC.
- No Neon branch is needed until Phase 5 runs `e2e-reset-flags.sql` against a real database. Everything else (gate tests, retry tests, drift test, `playwright test --list` from the worktree) is DB-free.

## Phases 2 and 3

**Phase 2 may be skipped. Suggested notation:**
> Skipping Phase 2 — no new dependency, no new directory or structural change, no invariant touched. `e2e/support/db.ts` and `scripts/` are existing homes; no `src/` code is added. Rule 16's shared-file list is noted and handled in Phase 1.

**Phase 3 should not be skipped.** A short design is warranted, not a full one. Several items have a real decision hiding under the one-line TODO text:
- Quote-aware parsing against fail-closed (G1, G2).
- Idempotence of setup retries (G5).
- The briefings counting rule (G11).
- A reset-file safety guard (G9).

Required content:
- **Edge Cases:** each claim cites its pinning test.
- **Copy:** exact text of the BLOCKED message, the Playwright throw, the reset-file refusal and the briefings banner line. QA reads these against what the mechanism does.
- **Carry-forward:** G1 to G12 and the IN/OUT table, per the template.

## Out of Scope (confirm with the operator)

- The janitor workflow, the Turbopack root fix, the fixture-orphan sweeper, vitest-side DB retry, and the `TODO.md:118` repro. Each becomes a TODO line.
- Per-org toggle reset in `e2e-reset-flags.sql`.
- Alias and variable-indirection coverage in the push gate (accepted residual).
- Editing CLAUDE.md, agent files or skills. The punch list landed those on 2026-10-24.

## Open Questions (each with a default)

1. **Relabel Polish as Accelerated Feature?** Default: yes.
2. **Gate parsing: quote/heredoc-aware split with recursion into `bash -c` / `eval`?** Default: yes, as in G1 and G2.
3. **Extend the HEAD-mover list with `pull`, `revert` and `reset`?** Default: yes.
4. **Setup retry scope.** Default per G5: teardown and sweeps always; setup only where idempotent. Do not wrap plain INSERTs.
5. **Briefings counting.** Default per G11: distinct recorded numbers above the marker not named in the file; marker at 224; 12 entries.
6. **Bulk-tick the 82 old unread entries?** This is the operator's call. Default: leave them, and write the 12 new entries short and release-level.
7. **Pass `-p <port>` to the dev lane (G10)?** Default: only if Phase 4 verifies it on the assigned port 3480. Otherwise the guard message carries the instruction.
8. **Include the disk-report script?** Default: yes, report-only, first to cut.
9. **Where the `withDbRetry` and flag-drift tests live.** Default: `scripts/*.test.mjs`, with no `vitest.config.ts` change.

## Suggested implementer

**full-stack-developer.** The work is coupled (`scripts/`, `e2e/support/`, `playwright.config.ts`, SQL). It spans no schema or UI.
- Commit per item, one prefix each, each with the `Work-Log: 2026-10-25-retro-workflow-efficiency` trailer.
- `docs(briefings)` is a separate commit, drafted by tech-lead and committed by the orchestrator.
- A QA FAIL that traces to a design claim, or a discovery that this crosses an excluded line, promotes the pipeline to a full Feature.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-25 |

## Handoff

- **Phase 2:** skip with the notation above.
- **Next agent:** **tech-lead** for the short Phase 3 design.
  - Carry G1 to G12 forward in the Carry-forward table.
  - Resolve open questions 1 to 9 as defaults unless the operator answers otherwise.
  - Note the disk prerequisite for the orchestrator.

Files referenced, all under `/Users/cshenso/git/presby-platform/presby-wf` (this worktree):
- `scripts/pre-push-gate.mjs`
- `scripts/pre-push-gate.test.mjs`
- `scripts/briefings-check.mjs`
- `scripts/stats-escape.mjs`
- `playwright.config.ts`
- `e2e/support/db.ts`
- `e2e/support/domains-ui-fixture.ts` (`withDbRetry` is at line 76)
- `e2e/support/invitation-fixture.ts` (imports it at line 39)
- `scripts/ci/e2e-baseline-flags.sql`
- `scripts/seed.ts`
- `docs/briefings.md`
- `docs/reviews/2026-10-24-retrospective.md`
- `docs/TODO.md` (lines 211, 431, 494)

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

**Author:** tech-lead, 2026-10-25. **Tier:** Accelerated Feature (DECISION-229); Phase 2 skipped per the orchestrator ruling. **Checked against:** the live tree of this worktree at `ce661d7` (gate, tests, `playwright.config.ts`, `e2e/support/*`, `scripts/seed.ts`, `docs/briefings.md`, `docs/decisions.md`, `docs/release-notes/v0.33`-`v0.42`), the installed `next@16.4.2` generator in the main checkout's `node_modules`, and a 150-line throwaway prototype of the gate parser (Appendix A) run against 32 command strings (all 32 behaved as specified below).

**Live evidence for G1, found while writing this design:** the old gate refused one of the author's own scratch commands because a heredoc body contained the words of a chained push. Anyone committing item 1 with the old gate still active must put the commit message in a file written with the Write tool and commit with `git commit -F <file>` (the Edge Cases list repeats this).

## Summary

Eight small guardrails and one stale digest, each a separate commit. (1) The push gate is rebuilt on a real shell tokenizer and refuses a single command that moves HEAD and then pushes, which today passes on a marker stamped at the pre-commit HEAD. (2) `AGENTS.md` is committed in the form `next dev` writes, so a dev-server start stops dirtying every worktree. (3) `briefings-check` counts recorded decisions the digest does not yet name, instead of `max - marker`. (4) `stats-escape` takes `--since`. (5) `scripts/ci/e2e-reset-flags.sql` resets global flags to the seed, behind a branch guard, with a drift test against `scripts/seed.ts`. (6) Playwright refuses port 3000 from a linked worktree. (7) `withDbRetry` moves to `e2e/support/db.ts`, stops retrying constraint errors and statement timeouts, and is applied to teardown, sweeps, reads and statements that are idempotent by construction (never to plain INSERTs or read-then-write captures). (8) An optional report-only disk and worktree script. Everything is dev tooling: no migration, route, action, `SECURITY DEFINER` function, dependency, flag or permission, so the Accelerated tier holds. A separate `docs(briefings)` commit (orchestrator, at integration) writes the twelve backlog entries drafted in Appendix D.

## Permissions & Flags

- Permission key(s): none. No `FEATURES.*`, no session claim.
- Default role bindings: none.
- Feature flag(s): not needed, and none is touched. `e2e-reset-flags.sql` writes the global `feature_flags` table on a pipeline branch; it adds no key. The e2e flag dependencies of new or changed specs: **there are no new or changed specs**, so no key is added to `scripts/ci/e2e-baseline-flags.sql` (its header comment changes only).

## API Contract

No HTTP routes or server actions. The contract is the exported surface of each script, all pure and unit-tested:

- `scripts/pre-push-gate.mjs`: `commandContainsGitPush(command): boolean` (unchanged signature); `resolvePushTargetRepoRoot(command, cwd): string | null` (unchanged); new `analyzeGitInvocations(command, cwd): GitInvocation[]` where `GitInvocation = { sub: string | undefined, dir: string, index: number }` (`dir` is the absolute effective directory after `cd` tracking and `git -C`); new `HEAD_MOVERS: ReadonlySet<string>`; new `decideHook(input): { exit: 0 } | { exit: 2, message: string }` with `input = { command, cwd, repoRoot, marker: { head?: string } | null, head: string | null, toplevelOf?: (dir: string) => string | null }` (default `toplevelOf` runs `git -C <dir> rev-parse --show-toplevel` through `execFileSync` and returns `null` on any error). `hook()` becomes: read stdin, read marker file (read only), read HEAD, call `decideHook`, print, exit. `stamp()` is unchanged and is the only writer.
- `e2e/support/dev-port-guard.ts` (new): `resolveDevPort(baseUrl: string | undefined): { port: number; origin: string; loopback: boolean } | null`; `isLinkedWorktree(dir: string, git?: (args: string[], cwd: string) => string): boolean`; `devLaneGuardMessage(opts): string | null`; `assertDevLaneAllowed(opts?): void`.
- `e2e/support/db.ts`: `isDbDrop(err: unknown): boolean`; `withDbRetry<T>(label: string, step: () => Promise<T>, opts?: { attempts?: number; baseMs?: number }): Promise<T>`.
- `scripts/briefings-check.mjs`: `recordedDecisions(text): number[]` (distinct, sorted); `namedDecisions(text): Set<number>`; `unnamedAboveFloor(recorded, named, floor): number[]`; `renderBehindLine(unnamed, commits): string | null`. `main()` runs only when invoked directly.
- `scripts/stats-escape.mjs`: `parseSinceArg(argv): { since: string | null } | { error: string }`; `gitLogArgs(since): string[]`; `windowLabel(since): { title: string; tag: string }`; `printReport(stats, label)`. The report runs only when invoked directly.
- `scripts/worktree-report.mjs` (optional): `parseWorktreePorcelain(text)`, `shellQuote(path)`, `removalSuggestions(entries)`, `formatReport(model)`.

## Data Model

No schema changes required. No migration number is consumed. The only database writes are `e2e-reset-flags.sql` on a throwaway pipeline Neon branch and the (already existing) fixture teardown, now retried.

## Component / Page Plan

No pages or components, no 360px check (nothing renders). Files:

- **Create:** `e2e/support/dev-port-guard.ts`; `scripts/ci/e2e-reset-flags.sql`; `scripts/dev-port-guard.test.mjs`; `scripts/with-db-retry.test.mjs`; `scripts/e2e-reset-flags.test.mjs`; `scripts/briefings-check.test.mjs`; `scripts/stats-escape.test.mjs`; `scripts/agents-md.test.mjs`; `scripts/worktree-report.mjs` and `scripts/worktree-report.test.mjs` (item 8, optional).
- **Modify:** `scripts/pre-push-gate.mjs`, `scripts/pre-push-gate.test.mjs`, `.claude/skills/pre-push/SKILL.md:245`, `AGENTS.md:17`, `scripts/briefings-check.mjs`, `docs/briefings.md:18-21` (explanatory paragraph only, not entries or marker), `scripts/stats-escape.mjs`, `playwright.config.ts`, `e2e/support/db.ts`, `e2e/support/domains-ui-fixture.ts`, `e2e/support/invitation-fixture.ts`, the fixtures in the call-site table below, `e2e/support/global-setup.ts`, `scripts/ci/e2e-baseline-flags.sql` (header comment only), `docs/testing.md` (new section "Running Playwright from a worktree"; one sentence at `:385-390` for the reset file; one paragraph for `withDbRetry`; one line for `--since`), `package.json` (one `scripts` line, item 8 only).
- **Not touched (constraints):** `vitest.config.ts`, `src/auth.ts`, `CLAUDE.md`, `.claude/agents/*`, `scripts/seed.ts`. Tests live in `scripts/*.test.mjs` (already inside vitest's `include`), importing `.ts` where needed, so no config change.

## Per-item design

### Item 1 — Push gate refuses a command that moves HEAD and pushes (`fix(hooks)`)

**Why a tokenizer.** The current splitter (`command.split(/[;&|\n]+/)`) is quote-naive. Adding the new rule on top of it would refuse this pipeline's own commit messages (G1) and would still miss wrapped forms (G2). So the splitter is replaced; the rule sits on top.

**Lexer** (Appendix A is a validated reference; the implementer may restructure it but must keep every behavior in the test table). It turns a command string into simple commands `{ words: string[], heredocs: string[] }` and never throws:
- Outside quotes: space/tab ends a word; newline ends a command and then reads any pending heredoc bodies; `;`, `&`, `|`, `(`, `)` and the backtick each end a command; `#` at the start of a word is a comment to end of line; backslash-newline is a line continuation, backslash-char appends the char; standalone `{` and `}` words are dropped (so `{ a; b; }` works).
- Single quotes: literal. Double quotes: backslash escapes, and `$(` ... `)` and backtick spans inside the quotes are **lexed as nested command lists** (their simple commands are emitted ahead of the enclosing command, because they run first) and replaced by a placeholder in the word. This is what makes the house commit style (`-m "$(cat <<'EOF' ... EOF)"`) transparent: the heredoc body is consumed and discarded, `"` characters inside it cannot end the outer quote early.
- Heredocs: `<<`, `<<-`, quoted or unquoted delimiter, body consumed to a line equal to the delimiter (leading tabs stripped for `<<-`); the body is kept on the command (`heredocs`) because a shell reading it executes it.

**Analysis** over the simple commands, in execution order, recursing to depth 6 (deeper fails open, see residuals):
- Strip prefixes: `NAME=value` words, and `env` (with its `-flags`), `command`, `exec`, `builtin`, `time`, `nohup`, `nice`, `!`.
- Program by `path.basename`, so `/usr/bin/git` is `git`.
- `bash|sh|zsh|dash` with a `-c`-bearing flag (`-c`, `-lc`, `-ec`): recurse into the next word. Without `-c`: recurse into each heredoc body. `eval`: recurse into the remaining words joined by spaces.
- `cd <arg>`: tracked for the directory. `git`: global flags skipped exactly as today (`-C <p>` accumulates onto the directory; `-c`, `--git-dir`, `--work-tree`, `--namespace` consume a value; other `-x` flags are single), then the first non-flag word is the subcommand.
- `cd` tracking flattens subshell scope (a `cd` inside `( ... )` or `bash -c` is treated as persisting). That is the existing behavior; it is conservative toward gating.

**The rule.** `HEAD_MOVERS = { commit, merge, rebase, cherry-pick, am, pull, revert, reset }` (Q3 default: `pull`, `revert`, `reset` added). `decideHook`, in this order:
1. `analyzeGitInvocations` inside `try`; any exception returns `{ exit: 0 }` (fail open, as today).
2. No `push` subcommand in the command: allow.
3. For each push, `toplevelOf(dir)`; a push counts as ours when the toplevel is `null` (undeterminable) or equals `repoRoot`. None of ours: allow. **This step comes before the HEAD-mover check**, so a `scratch/` checkout's `commit && push` stays exempt (analyst Flow 1).
4. Find the first of our pushes. If any HEAD-mover invocation **earlier in the command** also has toplevel `null` or `repoRoot`, return `{ exit: 2, message: chainedMessage(sub) }`. A mover after the push, or in another repository, does not block. This applies even when the marker is fresh; that is the hole.
5. Existing marker checks, unchanged text: missing marker blocks; `marker.head !== head` blocks; `head === null` (git unavailable) allows.

Memoize `toplevelOf` per directory inside one `decideHook` call. It runs only when a push is present, so ordinary Bash calls cost nothing extra.

**Doc comment.** The header comment of the gate gets the rule and an explicit **Accepted residuals** list (the gate catches an agent's mistakes, not an adversary): aliases and git config aliases; variable indirection (`$G push`); wrappers other than the shells above (`xargs`, `find -exec`, `ssh`, `watch`, `python -c`, `node -e`, `make`); `git checkout` and `git switch` (they move HEAD but a branch-creating one-liner is common and legitimate); more than 6 levels of nested shells; a plain terminal (never gated, by design). The "Splitting is quote-naive ... fails closed" sentence is deleted because it is no longer true.

**Skill text.** `.claude/skills/pre-push/SKILL.md:245` currently ends "...blocks any in-session `git push` unless this marker exists and matches the current HEAD". Append: " It also refuses one command that both moves HEAD (commit, merge, rebase, cherry-pick, am, pull, revert, reset) and pushes; run the commit in its own call, then `/pre-push`, then the push." (Skill text is editable; CLAUDE.md is not and already says "two separate Bash calls".)

**Tests** (`scripts/pre-push-gate.test.mjs`, extended; the 17 existing tests stay green):
- `commandContainsGitPush › quoting`: a commit message containing "a chained git commit && git push is refused" is false; the house heredoc-in-`$()`-in-quotes message whose body has a line `git push is refused` and a `"quoted"` word is false; `git commit -F - <<'EOF'` with such a body is false; `git status # then git push` is false; `echo "$(git push)"` and `` echo `git push` `` are true.
- `commandContainsGitPush › wrapped forms`: `bash -c "..."`, `sh -c '...'`, `eval "..."`, `(a; b)`, `{ a; b; }`, `command git push`, `/usr/bin/git push origin main`, `env GIT_X=1 git push`, `FOO=1 git push` are true; `bash <<'EOF' ... EOF` with a body push is true.
- `decideHook › chained`: with a **fresh matching marker**, `git commit -m x && git push`, `...; git push`, newline-separated, `||`-separated, `bash -c "git commit -m x && git push"`, `eval`, `(git commit -m x; git push)`, `git pull --ff-only && git push`, and the house heredoc commit followed by `&& git push` all return exit 2 with the Copy-table message. `git push && git commit -m x` and a lone `git push` with a fresh marker return exit 0.
- `decideHook › target repo`: with a fake `toplevelOf`, a mover and a push both in another repository: exit 0; mover in presby and push elsewhere: exit 0; mover elsewhere (`git -C scratch/x commit && git push` with presby as the push target): reaches the marker check, not the chained refusal; `toplevelOf` returning `null` for both: refusal.
- `decideHook › fail-open`: `head: null` allows; a table of hostile strings (unterminated quote, lone `$(`, 20 nested `bash -c`, a NUL byte, 100 KB of `(`) never throws from the lexer and returns exit 0 or a normal decision.
- `hook mode (spawn)`: one `node scripts/pre-push-gate.mjs` spawn with the chained command and `cwd` = the repo root: exit 2, stderr contains the first Copy line. The test reads the marker file's bytes before and after and asserts equal. It never spawns `--stamp` and never writes the marker (G4).

### Item 2 — `AGENTS.md` in the generator's own form (`fix(docs)`)

Cause (verified): `next@16.4.2`'s `generate-agent-files.js` writes the managed block between `<!-- BEGIN:nextjs-agent-rules -->` markers with a `##` heading; the tracked file has a `#` heading, so `hasCurrentAgentRules()` is false and every `next dev` started under an agent rewrites it. A scratch copy of `AGENTS.md` run through the generator's own `writeAgentFiles()` differs from the tracked file by exactly one line (`# This is NOT...` becomes `## This is NOT...`). Choice: **commit the generator's form** (one-character change at `AGENTS.md:17`). The alternative, `agentRules: false` in `next.config.ts`, would delete the block (guidance non-Claude agents rely on) and is a build-config edit; out of scope.

Drift guard: `scripts/agents-md.test.mjs` loads `next/dist/server/lib/generate-agent-files` through `createRequire` and asserts `hasCurrentAgentRules(repoRoot)`. After a Next upgrade it fails with the Copy-table message, and the fix is the one command it prints. The test fails (does not skip) if the module path disappears, with a message saying Next moved it and the test needs updating.

Phase 4 verification (manual, recorded in the work-log): start `npm run dev -- -p 3480` from the worktree with the agent environment present, wait for "Ready", run `git status --porcelain`, expect empty, stop the server by PID.

### Item 3 — `briefings-check` counts unnamed decisions (`fix(briefings)`)

Rule (G11): `recorded` = distinct numbers from `^(?:## |\*\*)DECISION-(\d+)` in `docs/decisions.md` (both heading styles, as today). `named` = every number in `docs/briefings.md` matched by `DECISION-0*(\d+)`, plus ranges written `DECISION-215–219` or `DECISION-215-219` (en dash or hyphen, optional second `DECISION-`, expanded inclusively, ignored when reversed or wider than 60). `unnamed` = recorded numbers **greater than the marker's decision** and not in `named`. The marker stays the contiguous floor (224 at the backlog commit). Behavior this buys: 207-214 (never assigned) cost nothing; a late-landing DECISION-226 under a marker at 224 is counted the day it lands even when 229 is already recorded; naming a number in any entry silences it.

Banner (Copy table): decisions and commits are two clauses; the commit clause is unchanged. Everything else in `main()` stays. `main()` is guarded so the module can be imported.

Neighbours updated in the same commit: the script's header comment (`:13-18`, `:74-95`: "the decision half" now says "decisions it does not name") and `docs/briefings.md:18-21` (the paragraph that says the check "says at session start if decisions or feat/fix commits have landed since").

Tests (`scripts/briefings-check.test.mjs`): the 2026-10-24 case (decisions 168-206, 215-224, 229; marker 167) yields 50, not 62; with marker 224 and 229 named: 0; a late 226 with marker 224 and 229 named: `[226]`; naming 226 silences it; a range names every member; a reversed or over-wide range names nothing; `## DECISION-` and `**DECISION-` headings both count; duplicates count once; a number at or below the marker is never reported; no recorded decisions: no line; `renderBehindLine` for 1, 2, 5 and 6 numbers, with and without commits.

### Item 4 — `stats-escape --since` (`feat(stats)`)

`--since=<value>` (also `--since <value>`). Allowlist before use: `^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$` (and `new Date(value)` must be valid, so `2026-13-45` is refused) or `^\d{1,3} (day|days|week|weeks) ago$`. Anything else: Copy-table error, exit 2. The git call is `execFileSync("git", ["log", \`--since=${value}\`, "--format=%H%n%s%n%b%n---END---"])` (an argument array, no shell). Default stays `30 days ago`, and the **default output is byte-identical to today's** (the retrospective copies it verbatim). With the flag, the title and the `(30d)` tags become `since <value>`. Header comment notes: git's `--since` compares the **committer** date (so a rebased or amended commit counts by when it was rewritten), a bare date means local midnight, and `CLAUDE.md`'s "30-day" wording stays true for the default (CLAUDE.md is not edited).

Tests: allowlist accepts the four shapes and refuses `2026-01-01; rm -rf x`, `--output=x`, `$(x)`, `2026-13-45`, `1000 days ago`, the empty string; `gitLogArgs` returns an array whose single option element is exactly `--since=<value>`; default report text equals a recorded golden string; flagged report carries the label and no `30d`.

### Item 5 — `e2e-reset-flags.sql` (`feat(e2e)`)

Shape: one transaction.
1. `\if :{?pipeline_branch}` / `\else \set pipeline_branch ''` / `\endif`, then `begin;`.
2. `select set_config('presby.e2e_reset_confirmed', :'pipeline_branch', true);` then a `do` block that raises the Copy-table refusal unless that setting is `'1'`. The transaction is then aborted, every later statement errors, and `commit` rolls back: **nothing is applied even if the caller forgot `ON_ERROR_STOP`** (G9).
3. `create temp table _seed_flags (key text primary key, enabled boolean not null) on commit drop; insert into _seed_flags values (...)` between `-- BEGIN seed flags` and `-- END seed flags` markers, one row per `scripts/seed.ts` flag (39 today, parsed list in the drift test).
4. `do` block: raise if any seeded key is missing from `feature_flags` (names them); `update feature_flags f set enabled = s.enabled from _seed_flags s where f.key = s.key`; `raise notice` listing table keys that are not in the seed and were left as found.
5. `\ir e2e-baseline-flags.sql` (its own assertion that 3 baseline flags are on runs inside the transaction).
6. `select key from feature_flags where enabled order by key;` (evidence QA pastes into its verdict), `\echo` of the per-org line, `commit;`.

Scope notes written in the file header: global `feature_flags.enabled` only; `rollout_percent`, `description` and per-organization toggles (`organization_feature_toggles`) are not touched (recorded residual). Run command (documented in `docs/testing.md`, never echoing the value): `npx dotenv -e .env.local -- sh -c 'psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -v pipeline_branch=1 -f scripts/ci/e2e-reset-flags.sql'`. It must be run with `-f` (so `\ir` resolves) and by a client that understands `\if`, i.e. `psql`; the Neon MCP `run_sql` tool cannot run it, which is intended.

Drift test (`scripts/e2e-reset-flags.test.mjs`, G8, `seed.ts` untouched): extract from `scripts/seed.ts` the body of `seedFlags()` (39 keys today), strip `//` comments first (a comment may contain the text `enabled: true`), split at each `key: "..."`, and for each entry read the first literal `enabled: true|false` before the next key; an entry with a non-literal `enabled` fails the test naming the key. Parse the `values (...)` rows between the SQL markers. Assert: same key set, same booleans (the failure lists the differences), at least 30 keys parsed (a silent empty match fails), and every key in `e2e-baseline-flags.sql`'s `in (...)` list exists in the seed. Structure pins: `begin;` precedes the first `update`; the refusal `raise exception` precedes it; the file ends with `commit;`; the file contains no `\quit`.

Phase 4/5 real-database check (needs the pipeline Neon branch the orchestrator creates at Phase 4 start): run once **without** `-v pipeline_branch=1`: expect the refusal and an unchanged ON-count; run **with** it: expect success, the 3 baseline keys on, and the "not in seed" notice. Record both counts.

### Item 6 — Playwright worktree guard (`feat(e2e)`)

`e2e/support/dev-port-guard.ts`, imported by `playwright.config.ts` (TS, so tests import it directly). Call: `if (!isProdBuildRun) assertDevLaneAllowed({ baseUrl: process.env.E2E_BASE_URL, projectDir: __dirname })`, placed after the prod-lane validation block and before `baseURL` is used. It applies to the dev lane and the visual run (both start or reuse a dev server) and never to the production lane (which already rejects `E2E_BASE_URL` and port 3000).

`assertDevLaneAllowed` throws the Copy-table error when **all** hold: `CI` unset; `PW_ALLOW_3000` is not exactly `"1"`; `resolveDevPort(baseUrl)` (default `http://localhost:3000`) is loopback (`localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`) with port 3000; `isLinkedWorktree(projectDir)`. `resolveDevPort` uses `new URL`; an absent port is 80 for `http:` and 443 for `https:` (so `http://localhost` is port 80, not 3000); an unparsable URL returns `null` and the guard does not throw (Playwright reports the bad URL itself). `isLinkedWorktree` compares `path.resolve(dir, <git rev-parse --git-dir>)` with `path.resolve(dir, <--git-common-dir>)` via `realpath`; any git failure returns `false` (treated as the main checkout, never throws). The config reloads in each worker, so the check repeats harmlessly. Main checkout and CI behavior are unchanged (`reuseExistingServer` stays).

**G10 / Q7 decision.** The dev lane's `command: "npm run dev"` is **not** changed to pass `-p` this pipeline. Reason: whether a server on another port also needs `AUTH_URL` set (the prod lane overrides it, with a comment that Auth.js rewrites request origins to `AUTH_URL`) can only be proven by a real sign-in run on :3480, and Phase 5's run is the first one that will make it. The guard message and the new `docs/testing.md` section carry the instruction; if Phase 5 shows sign-in bounces to :3000, QA reports it and the new docs line is corrected.

Docs: new section **Running Playwright from a worktree** in `docs/testing.md` (start `RATE_LIMIT_DISABLED=true AUTH_URL=http://localhost:<port> ... npx next dev -p <port> &`, the test fakes line pointing at the existing "Custom domains" and "Online giving" sections, `E2E_BASE_URL`, `PW_ALLOW_3000`, stop by PID). The `AUTH_URL` clause is written as "set it if sign-in redirects to :3000" until Phase 5 confirms.

Tests (`scripts/dev-port-guard.test.mjs`): port table (`http://localhost`, `https://x`, `127.0.0.1:3000`, `[::1]:3000`, `0.0.0.0:3000`, `http://staging.example:3000` not loopback, `http://localhost:3480`, garbage -> `null`); throws only for worktree + 3000 + `PW_ALLOW_3000` unset; main checkout, `CI=1`, `PW_ALLOW_3000=1`, port 3480, git failing: no throw; `PW_ALLOW_3000=0` and `true` still throw; the message contains the resolved origin, `PW_ALLOW_3000=1`, and `E2E_BASE_URL`; a real-git test builds a temp repo plus `git worktree add` and asserts `isLinkedWorktree` true for the worktree, false for the main repo; a source-scan pin that `playwright.config.ts` calls `assertDevLaneAllowed(` inside a `!isProdBuildRun` branch. Manual Phase 4 gate with `npx playwright test --list` from this worktree: (a) no env: throws; (b) `E2E_BASE_URL=http://localhost:3480`: lists; (c) `PW_ALLOW_3000=1`: lists; (d) from the main checkout, no env: lists.

### Item 7 — `withDbRetry` in `e2e/support/db.ts` (three commits)

**7a `refactor(e2e)`: move.** `withDbRetry` and its regex move from `domains-ui-fixture.ts` into `db.ts`; the log prefix becomes `[e2e-db]`; `domains-ui-fixture.ts` imports it and stops exporting it; `invitation-fixture.ts:39` imports from `./db`. No behavior change except the prefix. The comment "Exported for the unit test" becomes true in 7b.

**7b `fix(e2e)`: classify honestly (G7).** `isDbDrop(err)`, in this order:
1. Text = `message` + the `cause`'s message + `sourceError`'s message (the Neon driver's `NeonDbError` carries the SQLSTATE in `code` and the underlying error in `sourceError`, per its `index.d.ts`; a `fetch failed` arrives wrapped, with no `code`). If it matches `/statement timeout|lock timeout|canceling statement|idle-in-transaction/i`: **not** a drop.
2. If `err.code` is a SQLSTATE (`/^(?=.*\d)[0-9A-Z]{5}$/`; the digit requirement keeps Node's `EPIPE` out): a drop only for class `08` (connection exception), `57P01`, `57P02`, `57P03` and `53300`. Every other SQLSTATE (23505 unique violation, 42P01 missing table, 57014 query cancelled) is **not**.
3. Otherwise a drop iff the text matches `/fetch failed|Connection terminated|terminating connection|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|UND_ERR_(CONNECT_TIMEOUT|SOCKET)|Connect Timeout Error/i`. The bare word `timeout` and the bare class name `NeonDbError` no longer retry anything.
Five attempts, 0.5/1/2/4 s (7.5 s of sleeping at most), original error rethrown after the last. **Nesting:** an `AsyncLocalStorage` flag makes a `withDbRetry` called inside another run its step once; only the outermost retries, so wrapping a composite and its parts never multiplies attempts.

**7c `feat(e2e)`: apply it, two commits.** The rule (written in `db.ts`'s header and in `docs/testing.md`):
- R1 A step may be wrapped only if running it again after "it committed but the reply was lost" leaves the same end state (a `fetch failed` can mean the statement landed).
- R2 Wrap whole units: a disable-trigger / work / enable-trigger sequence is one step with the re-enable in `finally` (the `domains-ui` shape), never one statement of it.
- R3 Safe by shape: reads; `delete`; `update ... set x = <constant>`; `insert ... on conflict ... do nothing|update`; `insert ... where not exists`; a `delete`-then-`insert` pair that re-clears first.
- R4 **Never wrap a unit that reads a value and then overwrites it, if the read is kept as "prior state".** A retry after the overwrite committed would capture the new value as "prior" and teardown would restore the wrong thing, polluting the branch. Wrap the read and the write as two separate steps.
- R5 Never wrap a plain `insert` (duplicate row or unique violation on retry), or a state-machine edge (`update ... set state = '<next>'`), whose trigger may reject a repeat.
- R6 Wrap inside the fixture function, so no spec changes.

Call sites (function granularity; T = wrap the whole function as one step, either a teardown or a function whose every statement is guarded; S = wrap each statement or read separately; U = one step containing a trigger toggle unit or a delete-then-insert pair; N = not wrapped). The implementer reads each body; a function holding a statement the rules do not cover joins N and the Phase 4 section says so. The `insert into` scan I ran (any insert lacking `on conflict`/`not exists` within its statement) found plain inserts only in the N functions below.

| File | Wrap | Not wrapped (reason) |
|---|---|---|
| `flags.ts` | S: `getFlag`, `setFlag` (covers `captureFlags().restore()`) | |
| `global-setup.ts` | T at the call sites: `seedE2EUsers`, `seedE2EOrgs` (both re-run on every start against a populated database, header says idempotent), `cleanupTestFeedback`'s delete (its try/catch warn stays) | |
| `totp-fixture.ts` | U: `seedRecoveryCode` (delete then insert); T: `seedTotpEnrollment` (upsert plus the unit) | |
| `statistics-fixture.ts` | S: the `do` block `sql.query`, the belt `alter table`, the verification select | |
| `sasr-fixture.ts` | S: `assertE2EOrg` read, the `do` block, the three belt statements, verification | `stagePublishedReturn` (unread; unverified, so left alone) |
| `assert-fixture-invariants.ts` | S: its reads | |
| `custom-hosts.ts` | S: `setDomainsToggle`, `setSiteStatus`, `setOrgStatus`, `setPublicRenderFlag`, `getPublicRenderFlag`, `setBrand`, `setHold`, `actingUserId`; T: `removeSiteOrg`, `removeStaleSiteOrgs`, `teardownWorld` | `insertBundle`, `insertImage`, `createSiteOrg`, `addDomain`, `addExpiredClaim`, `walkDomain`, `stepDomain` (plain insert / state edge), `buildWorld` |
| `domains-ui-fixture.ts` | already wrapped (now imports `./db`) | `setupDomainsUiFixture`, `setDomainsRole` (plain insert) |
| `invitation-fixture.ts` | already wrapped (imports `./db`) | `setupInviteOrg`, `addRosterPerson`, `createThrowawayUser`, `seedInvitation` |
| `giving-fixture.ts` | T: `removeStaleGivingFixtures`, `removeGivingFixtureById`, `removeGivingFixture`, `clearConnections`, `removeSite` (delete-only; confirm on read); S: `setGivingToggle`; U: `setGivingRole` (delete then insert); T for functions whose inserts are all `on conflict do nothing` (`addActiveMonthlyGift`, `offerFundOnline`, `addGivingSettings`, `linkDonorToMember`; confirm each on read) | `setupGivingFixture`, `addForeignEntry`, `setConnection`, `addLiveSite`, `seedReturnIntent`, `addDonor`, `addOfflineGift`, `addLiveOnlineGift`, `addRefund`, `addUnsettledOnlineGift`, `addSettlement`, `addInboxEvent` |
| `person-emails-fixture.ts` | T: `removeEmailExtras`, `sweepEmailExtras`; S: `emailRows`, `dbNow`, `emailAudit` | `addContactEmail`, `addOpenStaffPosition` |
| **commit 7c-B (last; siblings extend these)** | | |
| `calendar-fixture.ts` | T: `removeCalendarFixture`; S: `setCalendarToggle`, `revokeCalendarRole`; T: `ensureRole`, `grantCalendarRole` (guarded inserts) | `setupCalendarFixture` (read-then-insert of the fallback type) |
| `community-fixture.ts` | T: `sweepCommunityPeople`, `removeCommunityFixture`, `removeApproverRole`, `removeSessionGroup`; S: `setRollApprove`, `setDirectoryView` | `setupCommunityFixture` (the `groups` insert and the prior-flag captures, R4), `createParticipantViaSql`, `createStaffAnchorViaSql`, `createProposalViaSql` |
| `home-cards-fixture.ts` | T: `removeHomeFixture`; S: `setCalendarToggle`; T: `ensureRole`, `grant` | `setupHomeFixture` (prior-state captures, plain inserts) |

Spec files' inline SQL (36 spec files have an `afterAll`) is **out of scope**; the fix for those is to route them through fixture functions, tracked as a TODO line, not done here.

Tests (`scripts/with-db-retry.test.mjs`, imports `../e2e/support/db.ts`, `baseMs: 1`, `console.warn` stubbed): returns the value; succeeds on the third try after two `fetch failed` (step ran 3 times); a `NeonDbError` with code `23505` runs once and throws; a statement timeout (`57014`, "canceling statement due to statement timeout") runs once; the bare message "timeout" runs once; `ETIMEDOUT` and `ECONNRESET` found only on `cause` retry; SQLSTATE `08006` and `57P01` retry; `EPIPE` (a 5-letter code without a digit) is read as a Node error, not a SQLSTATE; five attempts then the **same error object** is rethrown (step ran 5 times); nesting runs an inner step once per outer attempt; a source scan asserts `withDbRetry` is defined only in `db.ts` and `invitation-fixture.ts` imports `./db`. 7c itself is verified by typecheck, a read of each diff against the table, and Phase 5 running the specs that use the touched fixtures (domains, invitation, giving, community, calendar, home). That a wrapped teardown actually survives a real drop is **unverified**: a drop cannot be induced on demand; the retry path is pinned by the injected-failure tests and the idempotence of each step rests on the table's reading.

### Item 8 — Disk and worktree report (optional; first to cut) (`feat(tooling)`)

> **Superseded by "Phase 3 amendment 1" (end of this file) after QA run 1 FAIL-1.** The "merged" predicate and the removal suggestion below are replaced; kept as the record.

`scripts/worktree-report.mjs`, `npm run worktrees:report`. Report-only: it prints and deletes nothing. Reads: `fs.statfsSync(repoRoot)` for free GiB (no shell); `git worktree list --porcelain` (path, branch, HEAD) via `execFileSync`; `du -sk` via `execFileSync` for `node_modules`, `.next` and the whole worktree (rest = total minus the two); `git merge-base --is-ancestor <HEAD> origin/main` (falling back to `main`) via `execFileSync`, exit code only. `--no-sizes` skips `du`. Always exits 0. A hardlinked `node_modules` is counted in full in each worktree, and the output says so; a branch merged by squash would show as not merged (the project merges with merge commits). Suggestions are text only: `git worktree remove '<path>'` for a merged worktree other than the main checkout, `rm -rf '<path>/.next'` (regenerable) for any other, with `shellQuote` handling spaces and single quotes. Tests: porcelain parsing (detached HEAD, bare entry, main entry), quoting (`a b`, `it's`), the merged/not-merged suggestion split, the low-disk line below 20 GiB (the new-feature checklist's threshold, `.claude/skills/new-feature/SKILL.md:54`), and that the main checkout never gets a removal suggestion.

### Item 9 — Housekeeping and the briefings commit (orchestrator, at integration)

- **Rule 10 TODO edits.** Move `docs/TODO.md:211` to Done with the date. Close `:431` (verified fixed: `src/lib/rate-limit.test.ts:195-206` stubs `RATE_LIMIT_DISABLED=false` in the enforcement block, shipped by `2026-09-26-ci-db-tests`; `:208` and `:210` item 1 already record it). Strike the `--since` half of `:494` and keep its `fileURLToPath` half. Add new lines: the Neon orphan-branch janitor (deployment-engineer); the Turbopack `turbopack.root` worktree flake; the fixture-orphan sweeper (needs a deletion-policy decision); the `TODO.md:118` gate `cd`-tracking repro; spec-inline `afterAll` SQL routed through fixtures; `stepDomain`/`walkDomain`/setup INSERT retry (needs idempotent forms); mention `--since` and `worktrees:report` in CLAUDE.md "Common Commands" (needs operator approval); the stale `AGENTS.md` shim bullets ("Edge proxy can't import `@/lib/db`" against DECISION-177; "`schema.ts` is the schema source of truth" against CLAUDE.md, where church data is in `src/lib/db/domain/`); per-org toggle reset; `rollout_percent` reset; `git checkout`/`git switch` in the gate.
- **DECISION-231** and **F239**: Appendix B and C text; the orchestrator writes `docs/decisions.md` and `docs/STATE.md`.
- **Briefings backlog:** one `docs(briefings)` commit, written by the orchestrator from Appendix D (drafted by tech-lead). Before the commit, a reader other than the drafter (Phase 6 analyst, or QA) reads all twelve entries against the work-logs they cite; the orchestrator resolves the three `[CONFIRM AT INTEGRATION]` marks. Marker: `<!-- covers: decision=224 commit=<sha> -->` where `<sha>` is the newest commit whose `feat`/`fix` commits are all described: run `git log --format='%h %s' ce661d7..HEAD | grep -E ' (feat|fix)'` and require every line to be this pipeline's (entry 12 covers them) or to have its own entry. Release notes and what's-new: none (nothing member-visible). Functionality map and `docs/architecture.md`: not product surfaces, no change.

## Implementation Order

One commit per item, one prefix each, each carrying `Work-Log: 2026-10-25-retro-workflow-efficiency`; each `fix` also carries `Caught-By: agent-review` and `Discovered-In: post-merge` (found by the 2026-10-24 retrospective, a Phase 1 reproduction, and another pipeline's Phase 5; the defects live on `main`). Each commit includes its test (failing first for the `fix` commits; the implementer records the red run in Phase 4) and its docs lines. Commit 1 first because it protects every later chained command. Fixtures siblings extend go last.

1. `fix(hooks): refuse one command that moves HEAD and pushes, and read quoted text as text` (item 1)
2. `fix(docs): commit AGENTS.md in the form next dev writes, with a drift test` (item 2)
3. `fix(briefings): count decisions the digest does not name, not max minus marker` (item 3)
4. `feat(stats): add --since to stats:escape` (item 4)
5. `feat(e2e): add the guarded flag reset and its seed drift test` (item 5)
6. `feat(e2e): refuse port 3000 from a linked worktree` (item 6)
7. `refactor(e2e): move withDbRetry into db.ts` (7a)
8. `fix(e2e): retry connection drops only, not constraint errors or statement timeouts` (7b)
9. `feat(e2e): retry teardown and idempotent fixture steps on connection drops` (7c-A)
10. `feat(e2e): retry teardown in the calendar, community and home fixtures` (7c-B)
11. `feat(tooling): add a report-only disk and worktree report` (item 8; cut first)
12. Orchestrator, at integration: `docs(briefings): write up releases 0.33.1 to 0.42.2 and the workflow decisions` and the Rule 10 housekeeping commit.

Phase 4 gates: `npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires), `npm test` for the new `scripts/*.test.mjs` (no database needed), the manual checks named in items 2, 5 and 6, and no `console.log` left. Shared-file caution (Rule 16): this pipeline edits `e2e/support/*` mid-pipeline by the Phase 1 ruling; no sibling worktree currently diffs those files; `vitest.config.ts` and `src/auth.ts` stay untouched.

## Carry-forward

| Phase 1 gap / ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| G1 gate false positives on quoted and heredoc text | Item 1 lexer; tests `commandContainsGitPush › quoting` |
| G2 wrapped invocations and bypasses | Item 1 analysis (`bash -c`, `eval`, subshell, braces, basename, prefixes); residuals written in the gate's header (aliases, indirection, `xargs`-style wrappers, depth > 6) as *accepted residual*, per the analyst's own wording |
| G3 HEAD-mover list | Item 1: `pull`, `revert`, `reset` added; the message states the no-op `pull` annoyance. `checkout`/`switch` *deferred* (TODO line; orchestrator to accept) |
| G4 test cannot touch the real marker | Item 1: pure `decideHook`; one read-only spawn that asserts the marker bytes unchanged |
| G5 unsafe setup retries | Item 7 rules R1-R6 and the call-site table; plain INSERTs unwrapped |
| G6 `withDbRetry` untested, test location | Item 7b: `scripts/with-db-retry.test.mjs`, no `vitest.config.ts` edit |
| G7 retry regex vs spec | Item 7b `isDbDrop`; prefix `[e2e-db]`; `invitation-fixture` imports `./db` |
| G8 reset file has two sources of truth | Item 5 drift test; `seed.ts` untouched |
| G9 reset file destructive on the wrong branch | Item 5 transaction plus `-v pipeline_branch=1`; per-org toggles recorded as residual |
| G10 dev lane never passes the port | Item 6: **deferred** `-p`/`AUTH_URL` change to the dev lane until a real run proves it (orchestrator ruling Q7 default); guard message and docs carry the instruction |
| G11 briefings high-water mark | Item 3 unnamed-above-floor rule, marker 224, 12 entries |
| G12 stale `TODO.md:431` | Item 9 |
| Q1 relabel to Accelerated | Done (orchestrator) |
| Q2 quote/heredoc-aware split with recursion | Item 1 |
| Q3 extend the mover list | Item 1 |
| Q4 setup retry scope | Item 7 |
| Q5 briefings counting | Item 3 |
| Q6 bulk-tick the 82 old entries | *Deferred*: operator's call; default is leave them, entries written short (Appendix D) |
| Q7 pass `-p` to the dev lane | Deferred as above |
| Q8 disk script | Item 8 (optional, first to cut) |
| Q9 test locations | `scripts/*.test.mjs` throughout |
| Orchestrator: AGENTS.md rewrite | Item 2 |
| Orchestrator: `qa.md` names `e2e-reset-flags.sql` | Item 5 makes the reference true; the run command is in `docs/testing.md` (the agent file is not edited) |
| Analyst IN/OUT: stats-escape `--since` | Item 4 |
| Analyst OUT list (janitor, Turbopack root, `TODO.md:118`, fixture-orphan sweeper, vitest-side retry, CLAUDE.md `--since` edit, rate-limit test) | *Deferred* as TODO lines (Item 9); accepted by the analyst's table and the orchestrator ruling |
| Analyst Rule 16 notes (shared files, `vitest.config.ts`, `src/auth.ts`, sibling fixtures last) | Implementation Order; Component / Page Plan |
| Disk prerequisite | Cleared by the orchestrator (541 GiB free) |
| Briefings truthfulness (non-author read, no real names) | Item 9 and Appendix D |
| Per-org toggle reset; alias coverage in the gate | *Deferred* residuals, analyst "Out of Scope" |

## Edge Cases & Risks

Gate (item 1):
- Chained commit and push is refused even with a fresh marker. [test: `pre-push-gate.test.mjs › decideHook › chained`]
- A commit message that talks about a chained push, in quotes or a heredoc, is not refused. [test: `commandContainsGitPush › quoting`] **Until commit 1 lands, the old gate refuses such a command** (observed while writing this design); commit with `git commit -F <file>` written by the Write tool. [unverified beyond that observation]
- A `scratch/` checkout's `commit && push` stays exempt; a presby push preceded by a commit made elsewhere is judged by its own marker. [test: `decideHook › target repo`]
- An undeterminable target keeps today's conservative behavior (gated). [test: `decideHook › target repo`, null case]
- A lexer failure or more than 6 nested shells fails **open**, as every gate error does. [test: `decideHook › fail-open`]
- `git pull --ff-only && git push` is refused even when the pull is a no-op; the message says so. [test: `decideHook › chained`]
- Wrapped forms and a push inside `$()` or backticks are seen. [test: `wrapped forms`]
- Accepted residuals (written in the gate header): aliases, variable indirection, non-shell wrappers, `checkout`/`switch`, depth > 6, plain terminals. The gate catches an agent's mistakes, not an adversary.
- `hook()` itself (stdin parsing, process exit) is covered only by the one read-only spawn; the marker-write path is `stamp()`, unchanged and untested here.

AGENTS.md (item 2): a Next upgrade changes the block again; the drift test fails with the one-line remedy instead of the tree silently going dirty. [test: `agents-md.test.mjs`] The dev-start check is manual (recorded in Phase 4).

Briefings (item 3): a number named in passing ("builds on DECISION-226") silences it although nothing describes it; accepted, the check measures naming, not prose. Moving the commit marker past someone else's `feat`/`fix` commit silently "covers" it; the Item 9 procedure (`git log ... | grep`) is the guard and is a human step. [unverified; procedural]

stats-escape (item 4): `--since` uses committer date; the output header says "since <value>", not "commits authored since". [test: label]; injection attempts are refused before git runs. [test: allowlist]

Reset file (item 5): wrong-branch run is refused and rolled back [test: structure pins; real run in Phase 4/5]; a flag in `seed.ts` but not in the SQL fails `npm test` [test: drift]; a seeded key missing from the table raises and rolls back [real run only; unverified in CI]; a flag present in the table but absent from the seed is left as found and named in a notice. The reset can let QA certify a spec against a flag state the SQL set; the verdict must say the reset ran (the qa agent file already requires it), and the 3-baseline-flags assertion stays.

Playwright guard (item 6): `http://localhost` with no port is 80 [test: port table]; main checkout, CI, git failure never throw [test]; the same module loads in each worker and throws the same way [unverified; Playwright behavior]. Whether a non-3000 dev server needs `AUTH_URL` is **unverified until Phase 5**.

withDbRetry (item 7): a dropped reply after a committed plain INSERT is the double-insert hazard, so plain INSERTs stay unwrapped [rules R1-R5; call-site table]. A statement timeout is no longer retried, so a 20 s stall cannot become 100 s [test: `statement timeout runs once`]. Nested wrappers do not multiply attempts [test: nesting]. Teardown survival of a real drop is unverified (above). **E2E blast radius:** no existing spec asserts on the gate, the config guard, the retry set, the reset file or the log prefix (`rg '\[domains-ui-fixture\]'` finds only the line being renamed); `invitation-fixture-sweep.spec.ts` and the custom-domains UI specs exercise the already-wrapped teardown and keep the same behavior apart from no longer retrying a bare `timeout`. Specs run in Phase 5 (they touch the 7c fixtures): `e2e/custom-domains/domains-admin.spec.ts`, `domains-platform.spec.ts`, `serving.spec.ts`, `e2e/hydration/domains-claim-form.spec.ts`, `e2e/invitation-*.spec.ts`, `e2e/giving-*.spec.ts`, `e2e/community-*.spec.ts`, the calendar and home-card specs, `e2e/presbytery-*.spec.ts`, `e2e/statistics-submit.spec.ts`, `e2e/person-emails.spec.ts`. Flags those specs depend on: unchanged from today; the reset file is run once before them.

Worktree report (item 8): hardlinked `node_modules` appear full-size per worktree (stated in the output); squash-merged branches show as not merged. [tests: porcelain, quoting, suggestions]

Cross-cutting: commits 9 and 10 touch `e2e/support/*` that a sibling pipeline may extend; they land last and the sibling merges main up before its QA. Promotion to a full Feature: any QA FAIL that traces to a design claim above, or a discovery that this touches `src/auth.ts`, `src/proxy.ts`, `src/lib/authz.ts`, a flag seed, a route, an action or a dependency.

## Copy

Every string below is a developer or operator surface (stderr, a thrown error, psql output, a banner, a test failure, docs prose). The four checks are one line per group.

**C1. Chained-command refusal** (`pre-push-gate.mjs`, stderr, exit 2):

> BLOCKED (Workflow Rule 5): this command moves HEAD and pushes in one call.
> Commit first, run /pre-push, then push in a separate call.
> Found: git `<sub>` before git push. Any of commit, merge, rebase, cherry-pick, am, pull, revert or reset counts, even when it changes nothing; run it in its own call.

The existing missing-marker and stale-marker messages are unchanged.
- Residuals: names no coverage claim; does not deny the accepted residuals (aliases, checkout/switch) because it says only what was found.
- Source of truth: `<sub>` is the subcommand the tokenizer read at command position, drawn from the closed `HEAD_MOVERS` set; "even when it changes nothing" is true for a no-op `pull`.
- Audience: the agent whose Bash call was refused (and the operator reading the transcript); both can commit, run `/pre-push` and push in a separate call.
- Neighbours: `.claude/skills/pre-push/SKILL.md:245` becomes incomplete, modify target (item 1); `CLAUDE.md:327` (Rule 5, "two separate Bash calls") stays true; `pre-push-gate.mjs` header sentence "Splitting is quote-naive... fails closed" becomes false, deleted.

**C2. Playwright worktree refusal** (thrown from `playwright.config.ts`):

> Refusing to run Playwright from a linked git worktree against `<origin>` (port 3000).
> Port 3000 is the shared dev-server port; anything already listening there is probably another checkout's server, so this run would test the wrong code against the wrong database.
> Start your own server on your assigned port and set E2E_BASE_URL to it (docs/testing.md, "Running Playwright from a worktree").
> To use port 3000 anyway, set PW_ALLOW_3000=1.

- Residuals: none contradicted; "probably" because the guard does not read the port's listener.
- Source of truth: "linked worktree" is `git rev-parse --git-dir` differing from `--git-common-dir`; `<origin>` is the resolved `E2E_BASE_URL` or the default; it does not read whether anything is listening.
- Audience: an agent or developer running Playwright in a worktree, who can start a server and set the variable.
- Neighbours: `docs/testing.md:269` ("port 3000 may belong to another checkout; start yours on another port and set `E2E_BASE_URL`") stays true; `CLAUDE.md:338` (Rule 16, "a run that attached to :3000 is discarded") stays true and is now enforced.

**C3. Reset-file refusal and notices** (`e2e-reset-flags.sql`, psql):

> e2e-reset-flags.sql: refusing to run. It sets every global feature flag back to its scripts/seed.ts value, which switches off flags an operator may have turned on. Run it only against a pipeline Neon branch, and say so with -v pipeline_branch=1. Nothing was changed.

Success notices: `e2e-reset-flags.sql: set <N> seeded flags to their seed values.` and, when any: `Flags in the table but not in scripts/seed.ts were left as found: <keys>.` and `Per-organization toggles (organization_feature_toggles) were not touched.` Missing key: `e2e-reset-flags.sql: seeded flag(s) missing from feature_flags: <keys>. Nothing was changed.`
- Residuals: the last notice states the per-org residual rather than denying it.
- Source of truth: `<N>` is the row count of `_seed_flags`, each confirmed present; "Nothing was changed" is true because the whole file is one transaction that the exception aborts.
- Audience: QA or the operator at a psql prompt; both can add the variable or choose another branch.
- Neighbours: `.claude/agents/qa.md:64` (names the file, says reset before e2e and say so in the verdict) becomes true, not edited; `scripts/ci/e2e-baseline-flags.sql` header "Applied by e2e.yml only" becomes incomplete, modify target; `docs/testing.md:385-390` gains a sentence.

**C4. Briefings banner** (`briefings-check.mjs`, session start): the unread line is unchanged. The behind line, with `n` unnamed decisions and `c` commits:

> briefings are BEHIND by `<d>` and `<c>` feat/fix commit(s) — write them up and name each DECISION in an entry, then move the covers: marker

where `<d>` is `n decision(s) not yet named (DECISION-226, DECISION-228)` for n up to 5, and `n decisions not yet named (newest DECISION-NNN)` above 5; either clause alone drops the "and".
- Residuals: does not claim an entry describes a decision, only that the number is not named (the passing-mention residual is in Edge Cases).
- Source of truth: `n` is recorded `DECISION-NNN` headings in `docs/decisions.md` above the marker's number and not matched by `DECISION-0*N` (or a range) in `docs/briefings.md`; `c` is `git log <marker commit>..HEAD` subjects starting `feat`/`fix`. It reads nothing about the entries' content.
- Audience: the operator and the orchestrator at session start; tech-lead drafts, the orchestrator commits.
- Neighbours: `docs/briefings.md:18-21` and `scripts/briefings-check.mjs:13-18, 74-95` describe the old measure, modify targets (item 3).

**C5. `stats-escape`**: default output byte-identical (`Escape-Rate Report — 30-day window`, `(30d)` labels). With the flag: `Escape-Rate Report — since 2026-09-25` and `(since 2026-09-25)` in place of `(30d)`; the empty-case line becomes `(no tagged fix: commits in this window)` for the flag only. Refusal (stderr, exit 2): `stats-escape: --since expects YYYY-MM-DD, YYYY-MM-DD HH:MM, or "N days|weeks ago" (got "<value>").`
- Residuals: none. Source of truth: committer date via `git log --since`; the label says "since", not "authored". Audience: tech-lead at the retrospective. Neighbours: `CLAUDE.md:401,447` say "30-day" and stay true for the default (CLAUDE.md not edited; TODO line); `.claude/agents/tech-lead.md:59` says "Open with `npm run stats:escape`", still true.

**C6. `withDbRetry` log and docs**: `[e2e-db] <label>: connection dropped, retry <n>/<m>`. Docs prose (R1-R6 in `docs/testing.md` and the `db.ts` header) is written to the table above.
- Residuals: the prose says plain INSERTs and spec-inline SQL are not covered. Source of truth: the log fires only when `isDbDrop` is true. Audience: fixture authors. Neighbours: `e2e/support/domains-ui-fixture.ts:23, 73-90` (prefix, "Exported for the unit test", "every caller passes an IDEMPOTENT step") are modify targets; `docs/reviews/2026-10-24-retrospective.md:156` is historical and untouched.

**C7. `AGENTS.md` drift test failure**: `AGENTS.md does not match the block this version of Next writes on next dev. Run: node -e "require('next/dist/server/lib/generate-agent-files').writeAgentFiles('.')" and commit AGENTS.md.` and, when the module is gone, `Next no longer exports generate-agent-files at this path; update scripts/agents-md.test.mjs.`
- Source of truth: `hasCurrentAgentRules(repoRoot)`. Audience: the developer after a Next upgrade. Neighbours: the block's own sentence "Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean" is Next's text, kept verbatim; the two stale shim bullets are a TODO line.

**C8. Worktree report** (stdout). *Superseded by Phase 3 amendment 1 (QA run 1 FAIL-1); kept as the record.*
`Disk: <x.x> GiB free on the volume holding <repo root> (checklist minimum 20 GiB: OK)`, or `...: BELOW the 20 GiB the new-feature checklist asks for. A full disk has surfaced as a Neon "fetch failed" before; free space before running suites.` Per worktree: `<path>  <branch or detached>  <merged into main | not merged>  node_modules <x.x> GiB, .next <x.x> GiB, rest <x.x> GiB`. Footer: `Hardlinked node_modules are counted in full for each worktree. A branch merged by squash shows as "not merged". This report deletes nothing; the commands below are suggestions for you to run.`
- Residuals: the squash and hardlink caveats are stated. Source of truth: `statfsSync`, `git worktree list`, `du -sk`, `merge-base --is-ancestor` (exit code). Audience: the orchestrator and operator, who own worktree cleanup. Neighbours: `.claude/skills/new-feature/SKILL.md:54` (the 20 GiB rule and cleanup) stays true.

**C9. `docs/testing.md` additions** (prose): new section "Running Playwright from a worktree"; one sentence at `:385-390` ("`scripts/ci/e2e-reset-flags.sql` resets the global flags to the seed and then applies the baseline; run it on a pipeline branch before a QA e2e run"); one `--since` line; the R1-R6 paragraph.
- Source of truth: each statement is checked against the shipped script. Audience: agents and operator. Neighbours: `:269` and `:291` (the existing "start yours on another port" recipes) stay true.

**Release-note lines:** none (no member-visible behavior). **What's-new:** none. An implementer who needs a string not listed here stops for a ruling.

## Implementer

**full-stack-developer** (the work is coupled across `scripts/`, `e2e/support/`, `playwright.config.ts`, SQL and docs; no schema, no UI). Phase 4 starts after the orchestrator creates the pipeline Neon branch (needed only for the item 5 real-run check and Phase 5), the hardlinked `node_modules`, `.env.local`, and the dev port 3480.

---

### Appendix A — Reference parser prototype (validated, not committed)

A 150-line prototype lexed and analyzed all 32 strings of the test table in item 1 as specified (house heredoc-in-`$()`-in-quotes commit: allowed; chained forms: refused; wrapped forms: seen; unterminated quote and empty string: no throw). The implementer may use it as a starting point; it is the shape described in item 1, not a required structure.

```js
import path from "node:path";

const SEP = new Set([";", "&", "|", "(", ")", "`"]);
const MAX_DEPTH = 6;

/** Lex `src` into simple commands: [{ words: string[], heredocs: string[] }]. Never throws. */
export function lex(src) {
  let i = 0;
  const out = [];
  function list(stopAtParen) {
    let cmd = { words: [], heredocs: [] };
    let buf = "";
    let inWord = false;
    const pending = [];
    const endWord = () => { if (inWord) { cmd.words.push(buf); buf = ""; inWord = false; } };
    const endCmd = () => {
      endWord();
      if (cmd.words.length || cmd.heredocs.length || pending.some((p) => p.cmd === cmd)) out.push(cmd);
      cmd = { words: [], heredocs: [] };
    };
    const readHeredocBodies = () => {
      for (const p of pending.splice(0)) {
        let body = "";
        while (i < src.length) {
          let j = src.indexOf("\n", i);
          if (j === -1) j = src.length;
          const line = src.slice(i, j);
          i = Math.min(j + 1, src.length);
          if ((p.strip ? line.replace(/^\t+/, "") : line) === p.delim) break;
          body += line + "\n";
        }
        p.cmd.heredocs.push(body);
      }
    };
    while (i < src.length) {
      const c = src[i];
      if (c === " " || c === "\t") { endWord(); i++; continue; }
      if (c === "\n") { endCmd(); i++; if (pending.length) readHeredocBodies(); continue; }
      if (c === "\\") {
        if (src[i + 1] === "\n") { i += 2; continue; }
        buf += src[i + 1] ?? ""; inWord = true; i += 2; continue;
      }
      if (c === "#" && !inWord) { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "'") {
        const j = src.indexOf("'", i + 1); const e = j === -1 ? src.length : j;
        buf += src.slice(i + 1, e); inWord = true; i = e + 1; continue;
      }
      if (c === '"') {
        i++; inWord = true;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === "\\" && i + 1 < src.length) { buf += src[i + 1]; i += 2; continue; }
          if (src[i] === "$" && src[i + 1] === "(") { i += 2; list(true); buf += "_"; continue; }
          if (src[i] === "`") {
            i++; const j = src.indexOf("`", i);
            out.push(...lex(src.slice(i, j === -1 ? src.length : j)));
            i = j === -1 ? src.length : j + 1; buf += "_"; continue;
          }
          buf += src[i++];
        }
        i++; continue;
      }
      if (c === "<" && src[i + 1] === "<" && src[i + 2] !== "<") {
        i += 2; let strip = false;
        if (src[i] === "-") { strip = true; i++; }
        while (src[i] === " " || src[i] === "\t") i++;
        let delim = "";
        while (i < src.length && !/[\s;&|()<>]/.test(src[i])) {
          if (src[i] === "'" || src[i] === '"') {
            const q = src[i]; const j = src.indexOf(q, i + 1); const e = j === -1 ? src.length : j;
            delim += src.slice(i + 1, e); i = e + 1;
          } else if (src[i] === "\\") { delim += src[i + 1] ?? ""; i += 2; }
          else delim += src[i++];
        }
        endWord(); pending.push({ delim, strip, cmd }); continue;
      }
      if (c === ")") { endCmd(); i++; if (stopAtParen) return; continue; }
      if (SEP.has(c)) { endCmd(); i++; continue; }
      buf += c; inWord = true; i++;
    }
    endCmd();
  }
  list(false);
  return out
    .filter((c) => c.words.length || c.heredocs.length)
    .map((c) => ({ ...c, words: c.words[0] === "{" || c.words[0] === "}" ? c.words.slice(1) : c.words }));
}

const WRAPPERS = new Set(["env", "command", "exec", "builtin", "time", "nohup", "nice", "!"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const GIT_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** Flattened, execution-ordered git/cd invocations. The real version also tracks the effective directory. */
export function invocations(command, depth = 0) {
  const res = [];
  for (const c of lex(command)) {
    const w = c.words.slice();
    while (w.length && (WRAPPERS.has(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
      const head = w.shift();
      if (head === "env") while (w[0]?.startsWith("-")) w.shift();
    }
    if (!w.length) continue;
    const prog = path.basename(w[0]);
    if (SHELLS.has(prog)) {
      if (depth >= MAX_DEPTH) continue;
      const ci = w.findIndex((x, k) => k > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(x));
      if (ci !== -1 && w[ci + 1] !== undefined) res.push(...invocations(w[ci + 1], depth + 1));
      else for (const h of c.heredocs) res.push(...invocations(h, depth + 1));
    } else if (prog === "eval") {
      if (depth < MAX_DEPTH) res.push(...invocations(w.slice(1).join(" "), depth + 1));
    } else if (prog === "cd") res.push({ kind: "cd", arg: w[1] });
    else if (prog === "git") {
      let dirFlag = null; let k = 1;
      while (k < w.length) {
        const t = w[k];
        if (t === "-C" && w[k + 1] !== undefined) { dirFlag = w[k + 1]; k += 2; continue; }
        if (GIT_VALUE_FLAGS.has(t)) { k += 2; continue; }
        if (t.startsWith("-")) { k++; continue; }
        break;
      }
      res.push({ kind: "git", sub: w[k], dirFlag });
    }
  }
  return res;
}
```

### Appendix B — DECISION-231 (draft; orchestrator writes `docs/decisions.md` at integration)

**DECISION-231 — Workflow guardrails: the push gate parses commands instead of scanning them and refuses a command that moves HEAD and pushes; Playwright refuses port 3000 from a worktree; `withDbRetry` is one shared helper whose scope is idempotence; the flag reset is a guarded SQL file checked against the seed.**

**Status:** Resolved (tech-lead, implementation; operator rulings Q1-Q9 on the analyst's defaults, 2026-10-25) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-retro-workflow-efficiency` (Phase 3)

- **Gate.** `scripts/pre-push-gate.mjs` tokenizes the command (quotes, `$()` and backticks, heredocs, comments, `bash -c`/`eval` recursion to depth 6, `command`/`env`/path prefixes) and refuses one command in which a HEAD mover (`commit`, `merge`, `rebase`, `cherry-pick`, `am`, `pull`, `revert`, `reset`) precedes a push that targets this repository, even with a fresh marker. The target-repository check comes first so `scratch/` checkouts stay exempt. **Accepted residuals:** aliases, variable indirection, non-shell wrappers, `checkout`/`switch`, depth over 6. The gate catches an agent's mistakes, not an adversary.
- **Playwright.** A dev-lane config load in a linked worktree with the resolved loopback port 3000 throws, unless `PW_ALLOW_3000=1`; never in CI or the main checkout. The dev lane does not yet pass `-p`/`AUTH_URL` (unproven; revisit when a Phase 5 run on a non-3000 port settles it).
- **Retry.** `withDbRetry` lives in `e2e/support/db.ts`. A step may be wrapped only if repeating it after a lost reply leaves the same end state; plain INSERTs, state-machine edges and read-then-overwrite "prior state" captures are never wrapped. Only connection drops retry: SQLSTATE class 08 and 57P01-57P03/53300, or a `fetch failed`/reset/connect-timeout text; constraint errors and statement/lock timeouts throw at once. Nested wrappers run once (outermost retries).
- **Reset.** `scripts/ci/e2e-reset-flags.sql` is one transaction that refuses unless `-v pipeline_branch=1`, sets every seeded global flag to its `scripts/seed.ts` value, applies the baseline file, and is checked against `seed.ts` by a unit test. **Accepted residual:** per-organization toggles and `rollout_percent` are not reset.
- **Briefings.** `briefings-check` counts recorded decisions above the marker that `docs/briefings.md` does not name (ranges expanded); the marker stays the contiguous floor. A number mentioned in passing silences it (accepted).
- **AGENTS.md.** Committed in the form `next dev` writes, guarded by a test against the installed generator, rather than disabling `agentRules` (which would delete the block).
- **Revisit if** Next changes the agent-file generator's path, a Phase 5 run shows a non-3000 dev server needs more than `-p` and `AUTH_URL`, or the gate's residuals produce a real unchecked push.

### Appendix C — F239 (draft)

**F239 — The pre-push matcher read quoted and heredoc text as commands and missed wrapped pushes.** Found at Phase 1 (G1, G2) and reproduced again while drafting this design. The quote-naive splitter matched `git push` inside commit-message text (a false refusal whenever the marker was stale, the normal state at commit time) and missed `bash -c "..."`, `command git push`, `/usr/bin/git push`, `(git push)`, which could have pushed without the marker check. Severity: process control, `paper`-class (an agent mistake, not an exploit). **Closed by** item 1 except the residuals listed in DECISION-231.

### Appendix D — Briefings backlog drafts (tech-lead drafts; orchestrator commits; non-author reads before the commit)

Newest first, in the file's voice, release-level, no real congregation names (the operator's first congregation is "your first test congregation"). Each claim was checked against the release note and decision it cites (sources are listed after the block). Marks `[CONFIRM AT INTEGRATION]` are claims about the shipped state of this pipeline or of a sibling that cannot be known until then. New marker: `<!-- covers: decision=224 commit=<sha per Item 9> -->`. The twelve entries cover 168-206 (39), 215-224 (10) and 229, 231; 207-214 were never assigned.

```markdown
## 2026-10-25

- [ ] **`decision` · Low-risk work now has a faster lane, and the workflow has new guardrails (DECISION-229, DECISION-231).** On 2026-10-24 you ruled "Adopt it": a change that adds no migration, route, server action or dependency, and touches none of sign-in, the proxy, the authorization core, the permission catalog or a flag seed, now skips the architecture review and the separate design step. **What it never skips:** QA, the check that every sentence a person reads is true, the 360px phone check, a regression test that fails first, and `npm run check`; a QA failure that traces to a design claim, or any discovery that the change crosses one of those lines, promotes it to the full process. The same day's retrospective edits to the agent instructions, CLAUDE.md and skills landed. **[CONFIRM AT INTEGRATION: this part describes the workflow-efficiency pipeline as shipped.]** That pipeline adds: the push gate now refuses a single command that commits and pushes (the checks used to be satisfied by the commit before it); Playwright refuses port 3000 from a worktree; fixtures share one database-retry helper that retries connection drops only; QA has a guarded script that resets feature flags to their seeded values before the browser run; the briefings count now measures decisions this file does not name; `stats:escape` takes `--since`; and the dev server stops rewriting `AGENTS.md`.

## 2026-10-24

- [ ] **`finding` · A security update to the library that checks form input shipped with no visible change (0.42.2; DECISION-223, DECISION-224).** CI's dependency audit flagged a published high-severity weakness in zod: a request both unusually large and shaped one particular way could make the server use far more memory than it should. The only place that accepted a list of that kind was a platform-administrator screen, so exposure was narrow. The upgrade to zod 4 closes it and removes the exception CI had been carrying. Forms and their messages are meant to be unchanged; the caveat is that a request not made through the app's own pages may see slightly different wording. Two rules came out of it: ids are checked with a looser "looks like an id" rule because some fixed ids in shipped migrations are not strictly standard UUIDs, and the old compatibility mode was refused because it would have kept the unfixed code where the audit cannot see it. A real email row being refused on save was caught by a guard test while merging, before anything deployed. 0.42.1 the same day changed the invitation confirmation to say whose acceptance makes the role official.

- [ ] **`finding` · Three security advisories against software the platform ships landed in five days, and CI's dependency audit is what caught each (0.33.1 on 10-19, 0.38.0 on 10-22, 0.42.2 on 10-24).** First Next.js (image handling and caching) with the image library `sharp` and `source-map-js`; then Next.js again (three critical advisories, one a remote-code-execution flaw in the image optimizer when SVG files are used) with DOMPurify; then zod (above). All were patch-level or contained upgrades and none changed what a person sees; the 0.38.0 ones applied to production as well. Two low advisories remain in documentation-diagram tooling (katex through mermaid); they are not part of the congregation-facing platform and need a breaking upgrade. **What to take from it:** a red dependency-audit job on every pull request means a fresh advisory, not a flaky build, and it is also a pre-deploy prerequisite.

## 2026-10-23

- [ ] **`decision` · A person can now have several email addresses with one main, and the platform has one place that decides which address a message uses (0.42.0; DECISION-215 to DECISION-219).** Up to ten per person, labelled Personal, Work or Other, one marked main; removing an address ends it and keeps a record, and if the main goes the oldest remaining becomes main. **The rule worth remembering:** a contact email authenticates nothing. Sign-in, password reset and account emails still use the account's own address; an invitation to an address shared by two people is refused unless the invitee accepts while signed in as that person; giving statements still use the address on the donor's giving record. A person in two congregations has one set of addresses, so someone who can manage people at one can change an address the other also uses (audited with the congregation that made the change): an accepted limit (DECISION-218). Directory search now matches only what a card shows. **Deploy order:** database change `0064` first, then the code, snapshot first; between the two, saving contact details can fail.

- [ ] **`decision` · A congregation's Session can now approve new members, and a mistaken entry can be withdrawn (0.41.0; DECISION-202 to DECISION-206).** Every congregation gets a "Session member" role that goes to the people recorded on its Session under Officers: ruling elders and, on your ruling ("Yes, include them"), installed pastors, co-pastors and associate pastors (DECISION-206). Approving needs a PresbyPortal account, and recording an elder does not create one; inviting elders was still to come at release, and the Pending approvals page says plainly when nobody can approve yet. **The thing to know:** a new congregation's founding administrator can record themselves as an elder or pastor and then approve entries. That is allowed on purpose, because otherwise a new congregation is stuck; it is stamped "self-recorded" and "self-approved" on the record and not blocked, and it is a named open residual. Approve, deny and withdraw are the only ways to decide an entry, up to 50 can be approved at once with one minute reference (each recorded separately), and decided entries can no longer be changed or deleted by the application; the database refuses it. **Deploy order:** `0062`, then the code, then `0063`, snapshot first.

- [ ] **`decision` · The portal footer is now a site map built from the same list as the menu, and "People & Membership" is now "Community" (0.40.0; DECISION-220 to DECISION-222).** Menu and footer cannot disagree any more because both come from one structure; each menu section is a footer column with its tools beneath it, two across on a phone. The section is called Community in the menu, the home page, the footer and the Features page. The Administration link follows one rule: it appears, in both places, only when the congregation has at least one administration tool switched on (the menu used to show it whenever the administration area was on, even if empty), and what a person can open is still decided on the page behind it. On the portal home page the Community menu item scrolls to the section while the Community card opens the Community page; that is expected. No schema change.

- [ ] **`decision` · "Members" administration became Community, with visitors, participants recorded on the spot, and member proposals (0.39.0 to 0.39.2; DECISION-197 to DECISION-201).** A new congregation's first administrator used to land on a forbidden Members page; Community shows the page whenever someone can manage people and names any missing permission. Visitors and participants take effect immediately; a member is only proposed, and at 0.39.0 nobody could approve one (0.41.0, above, fixed that). Old Members links redirect permanently. **Two defects you found in production on 2026-10-23, both fixed in 0.39.2:** a person who joined by accepting a founding-administrator or treasurer invitation appeared in none of Community's six lists (they now appear under Staff, "No position yet" if they have none), and the "not connected yet" page told people that someone at their church could add them by email, which is false: an address on a record never connects an account, only accepting an invitation does. A test now fails if any kind of live membership lands in no view. **Deploy order:** code first, then `0061`.

## 2026-10-22

- [ ] **`decision` · A platform operator can now see who holds a congregation's founding-administrator and treasurer roles, and end their access when recovery needs it (0.38.0; DECISION-194 to DECISION-196).** Until now a leftover test account could hold a role with no way to tell, which blocked a real congregation from getting its first administrator. The page shows names only, with the date and how each was granted; ending access needs a reason of 10 to 500 characters and a confirmation that warns if nobody would be left to manage roles or giving, and it is written to the audit log with the reason. It is for recovery only: it never ends a role held through the Session or Diaconate, never touches membership or officer terms, and emails nobody yet. **A limit you ruled to accept ("No block, audit only", 2026-10-22):** an operator can end a role and then invite themselves into it. The audit log records the chain (revoked, then a self-addressed invitation, then acceptance) but nothing prevents it; it is written into CLAUDE.md as an accepted residual.

- [ ] **`finding` · On 2026-10-22 the production database was cleaned up out of band, at your instruction, and no audit rows were written.** Done in SQL by the orchestrator, each step after a Neon snapshot: the 68 test accounts on the reserved `.invalid` domain were deactivated and stripped of platform roles, two-step sign-in and platform-admin; the August synthetic data was purged (395 fixture people with their memberships, roll entries and households, two districts, 183 queued test emails), so your first test congregation has a clean roster; only your two real accounts remain active. **One slip, fixed:** the purge deleted that congregation's baseline member grant because its reason began `dev-seed:`; it was restored, and the lesson is recorded (never classify a grant by its reason prefix). **Still waiting on you:** whether to backfill audit rows for these changes, and an OK to delete the Neon branch `purge-rehearsal-2026-10-22`.

- [ ] **`decision` · A platform operator can invite a congregation's first administrator or treasurer by email, and every email the platform sends is now one branded layout (0.36.0 to 0.37.1; DECISION-183 to DECISION-193).** The invitation link is the only credential: it works once, for 7 days, never appears in a web address or the audit log, and opening it changes nothing until the person presses Accept; resending kills the old link. Limits are 3 invitations a day to one address, 10 per organization and 20 per operator. Once an invitation email is delivered, failed or cancelled, the stored copy is replaced with a note so the link is not kept. The operator may invite themselves; it is audited and shown as "Self-designated". Also in 0.36.0: Google's official sign-in button, a six-box two-step code entry, and a searchable organizations tree. **Known at release, and still open on `main` as of this entry [CONFIRM AT INTEGRATION: open unless session-update-hardening has merged]:** first-time two-step setup shows recovery codes for about a second and then asks for one extra code; the fix is built on a pipeline branch awaiting QA. **Deploy order:** `0059` by hand before the release.

## 2026-10-20

- [ ] **`decision` · A congregation can now prove it owns a domain name and have its public site served there, but at release nothing was connected to a real domain (0.35.0; DECISION-176 to DECISION-182).** The rule to remember: a church's own domain is a lookup key into the one public-site tree, never an identity. A host the platform does not own is routed to that church's public site and nothing else: no sign-in, no admin, no member portal, no cookies; any name that is unproven, paused, lapsed or released shows the same plain "page not found" as a name nobody ever claimed. Proof comes first: the verification record must be seen before the hosting provider is ever contacted; an unproven claim expires after 7 days, a congregation can hold up to three web domains, and a lapsed domain stays dark for 30 days before it is released. Outbound mail now goes through a closed sender registry (DECISION-182). **At release this was unverified against the real hosting provider, Cloudflare or real DNS, the hosting connection was deliberately not configured in production, and church email on a church's own domain was not part of it.**

## 2026-10-19

- [ ] **`decision` · Online giving, a treasurer's gift desk and year-end statements are built, but were never run against a real Stripe account (0.33.1 to 0.34.0; DECISION-168 to DECISION-175).** Each congregation connects its own Stripe account and gifts go straight to it: Stripe Connect with direct charges and no application fee for the platform, donors sent to Stripe's own page so card details never touch ours. A gift is corrected only by a new refund, return or dispute line, never an edit; an issued statement is a frozen snapshot plus its PDF, and a correction is a new version. Giving is off for every congregation until the platform operator switches it on, one at a time, and the first treasurer is named by the operator. **Before real money:** a test-mode walkthrough with a real Stripe test account; Stripe keys must be set (without them nothing takes money); statements stay off in production until an accountant reviews the wording; and there is no privacy notice page yet. **Caught at the final review:** the platform's own `/give` page would have silently replaced a congregation's existing `/give` page after deploy; it was fixed so the old page keeps working until giving is switched on.
```

Claims checked (drafter): zod/looser id rule/compat refusal/CI exception (DECISION-223, 224; `docs/work-log/2026-10-23-zod-4.md`); advisory sequence (`2026-10-19-dependency-advisories.md`, `2026-10-22-designation-revoke.md` Phase 4, v0.38 and v0.42 notes); person emails (v0.42.0 note, DECISION-215-219, CLAUDE.md "a contact email authenticates nothing"); Session approval (v0.41.0 note, DECISION-202-206 with the operator quote at DECISION-206); footer (v0.40.0 note); Community (v0.39.x notes, `2026-10-23-community-staff-anchor.md` Source blocks); designation revoke (DECISION-194, v0.38.0 note); production clean-up (`docs/TODO.md:80-81`, `docs/STATE.md:132-135`); invitations (v0.36.0, v0.37.0, v0.37.1 notes, DECISION-187/189/191); custom domains (v0.35.0 note, CLAUDE.md "A Custom Host Is a Key"); giving (v0.34.0 note, DECISION-168/170/173, online-giving work-log Phase 6 row). Not checked and flagged for the reader: the three `[CONFIRM AT INTEGRATION]` claims, and whether the 0.33.1 advisories applied to production (the entry says only that the 0.38.0 ones did, from the designation-revoke work-log).

---

# Phase 4 — Implementation

**Implementer:** full-stack-developer, 2026-10-25. Branch `pipeline/retro-workflow-efficiency`, base `ce661d7`. No push. `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, the briefings entries (Appendix D), `vitest.config.ts`, `src/auth.ts`, `CLAUDE.md`, `.claude/agents/*` and `scripts/seed.ts` untouched.

## Commits

Every commit carries `Work-Log: 2026-10-25-retro-workflow-efficiency` and the `Co-Authored-By` line; the three `fix:` commits that fix defects on `main` carry `Caught-By: agent-review` and `Discovered-In: post-merge`.

| # | SHA | Commit |
|---|-----|--------|
| 0 | `b8e5e6d` | `docs(work-log)`: the pipeline through Phase 3 (tree starts clean) |
| 1 | `e3cebb1` | `fix(hooks)`: refuse one command that moves HEAD and pushes, and read quoted text as text |
| 2 | `069ba1d` | `fix(docs)`: commit AGENTS.md in the form next dev writes, with a drift test |
| 3 | `5ef2ec8` | `fix(briefings)`: count decisions the digest does not name, not max minus marker |
| 4 | `8fcdf60` | `feat(stats)`: add --since to stats:escape |
| 5 | `f3cf3cd` | `feat(e2e)`: add the guarded flag reset and its seed drift test |
| 6 | `b09229f` | `feat(e2e)`: refuse port 3000 from a linked worktree |
| 7a | `da8af6e` | `refactor(e2e)`: move withDbRetry into db.ts |
| 7b | `0f1dda2` | `fix(e2e)`: retry connection drops only, not constraint errors or statement timeouts |
| 7c-A | `fe72689` | `feat(e2e)`: retry teardown and idempotent fixture steps on connection drops |
| 7c-B | `8465dc4` | `feat(e2e)`: retry teardown in the calendar, community and home fixtures |
| 8 | `d6da996` | `feat(tooling)`: add a report-only disk and worktree report |
| 9 | `b7a8b1d` | `docs(testing)`: document worktrees:report and annotate the worktree recipe's test literals (not in the design's list; see Implementer Notes) |

The Phase 4 work-log update itself is committed after this section (`docs(work-log)`).

## Files Created

- `scripts/agents-md.test.mjs`, `scripts/briefings-check.test.mjs`, `scripts/stats-escape.test.mjs`, `scripts/e2e-reset-flags.test.mjs`, `scripts/dev-port-guard.test.mjs`, `scripts/with-db-retry.test.mjs`, `scripts/worktree-report.test.mjs` - the new unit tests (all under vitest's existing `scripts/**/*.test.mjs` include; no config change).
- `scripts/ci/e2e-reset-flags.sql` - the guarded flag reset (39 seeded flags, one transaction).
- `e2e/support/dev-port-guard.ts` - `resolveDevPort`, `isLinkedWorktree`, `devLaneGuardMessage`, `assertDevLaneAllowed`.
- `scripts/worktree-report.mjs` - report-only disk and worktree script; `npm run worktrees:report`.

## Files Modified

- `scripts/pre-push-gate.mjs` (lexer, `analyzeGitInvocations`, `HEAD_MOVERS`, `decideHook`; header rewritten with the accepted residuals), `scripts/pre-push-gate.test.mjs` (17 existing tests kept, 58 added), `.claude/skills/pre-push/SKILL.md` (one sentence).
- `AGENTS.md` (line 17, `#` to `##`).
- `scripts/briefings-check.mjs` (exports, unnamed-above-floor counting, `main()` guarded; `execSync` to `execFileSync`), `docs/briefings.md` (explanatory paragraph only; no entries, no marker).
- `scripts/stats-escape.mjs` (`--since`, `execFileSync` with an argument array, exports, `main` guarded).
- `scripts/ci/e2e-baseline-flags.sql` (header comment only), `playwright.config.ts` (import and one guarded call), `docs/testing.md` (sections: Running Playwright from a worktree; Fixture database calls: withDbRetry; Reports for the retrospective; one paragraph at the CI baseline-flags text for the reset file and its run command), `package.json` (one `scripts` line).
- `e2e/support/db.ts` (`isDbDrop`, `withDbRetry` with nesting, rules R1-R6 in a header comment), `domains-ui-fixture.ts` and `invitation-fixture.ts` (import from `./db`), and the wrapped fixtures: `flags.ts`, `global-setup.ts`, `totp-fixture.ts`, `statistics-fixture.ts`, `sasr-fixture.ts`, `assert-fixture-invariants.ts`, `custom-hosts.ts`, `giving-fixture.ts`, `person-emails-fixture.ts` (7c-A); `calendar-fixture.ts`, `community-fixture.ts`, `home-cards-fixture.ts` (7c-B).

## Schema Changes

None. No migration, route, server action, `SECURITY DEFINER` function, dependency, flag or permission. The only database writes are `e2e-reset-flags.sql` against the pipeline Neon branch and fixture teardown, now retried.

## Audit Events

None (dev tooling; the push gate is a Rule 5 control with a test, not an `audit_events` writer).

## Failing-First Record

- Commit 1: the new `scripts/pre-push-gate.test.mjs` was run against the old gate (stashed): **51 failed of 75** (quoting and wrapped-form cases, the chained refusals, target-repo and fail-open cases, and the hook spawn, which got the old "no pre-push marker" message). Against the new gate: **75 passed**.
- Commit 2: `agents-md.test.mjs` failed (`AGENTS.md does not match the block this version of Next writes`) before the one-character fix, passed after.
- Commit 3: `briefings-check.test.mjs` could not import the new exports (no tests ran) before the change; 22 pass after. Real repo: the banner went from "62 decisions" to "50 decisions not yet named".
- Commit 4: `stats-escape.test.mjs` run with the old script stashed: **26 failed**. Default output compared byte-for-byte (`cmp`) against the old script on the real log and by two golden strings captured from the old script: identical.
- Commit 5: no red phase for the drift test (SQL generated from the seed afterward); instead the structure pins and the real-database refusal runs below. Parser self-checks prove the test can fail (comment containing `enabled: true`, non-literal `enabled`).
- Commit 8 (7b): `with-db-retry.test.mjs` run against the moved helper before the fix: **32 failed of 39** (constraint error and statement timeout were retried five times, bare `timeout` and `NeonDbError` matched, no `isDbDrop`).
- Commits 6, 7a, 7c-A, 7c-B, 9: no bug-fix claim; tested by their unit tests (dev-port-guard 25), typecheck, `--list` runs and e2e runs below. 7c itself is verified by e2e, not by a red test: a real connection drop cannot be induced on demand, and the retry path is pinned only by the injected-failure tests in `with-db-retry.test.mjs`.

## Gates

- `npm run typecheck`: clean. `npm run lint`: clean. `npm run check`: all eight tripwires passed (the first run caught one `check:secrets` soft finding in the new docs recipe; fixed and annotated in commit 9).
- Plain `npm test`: **549 files passed | 77 skipped (DB-backed, no `.env` loaded); 8520 tests passed | 2442 skipped; 0 failed.** The new script tests: pre-push-gate 75, agents-md 1, briefings-check 22, stats-escape 26, e2e-reset-flags 11, dev-port-guard 25, with-db-retry 39, worktree-report 16.
- `npx playwright test --list` from this worktree: no environment -> refused with the Copy-table message; `PW_ALLOW_3000=0` -> refused (only exactly `1` allows); `E2E_BASE_URL=http://localhost:3480` -> lists 515 tests in 61 files; `PW_ALLOW_3000=1` -> lists; `PW_PROD_BUILD=1` -> lists 76 tests in 12 files (production lane untouched). Main-checkout behavior (design check (d)): the main checkout does not contain the new config, so verified through the module instead: `isLinkedWorktree('/Users/.../presby')` is false, this worktree true, `devLaneGuardMessage` for the main path with the default port is null; the unit test builds a real temp repo plus `git worktree add` and asserts the same.
- Flag reset against **this pipeline's Neon branch only** (`pipeline-retro-workflow-efficiency`, endpoint ep-fancy-credit-axnbpmku; never `development`): (a) without `-v pipeline_branch=1`, with `ON_ERROR_STOP`: refused, 35 of 39 flags still on; (b) without the variable and without `ON_ERROR_STOP`: every later statement errored, `ROLLBACK`, still 35 on; (c) with the variable: `UPDATE 3` for the baseline, notices "set 39 seeded flags", "Per-organization toggles ... were not touched", ends with 10 flags on (the 7 seed-ON flags plus the 3 baseline flags), `COMMIT`; (d) with a deleted seeded key (`auth.local_login`, restored after): raised "seeded flag(s) missing from feature_flags: auth.local_login. Nothing was changed."; (e) with an extra table-only key `zzz.extra` (deleted after): left as found and named in the notice. Both temporary rows were restored/removed; the branch is back to 10 on of 39.
- Real e2e runs against my own server on :3480 (`npx next dev -p 3480`, `E2E_BASE_URL=http://localhost:3480`, test fakes and `RATE_LIMIT_DISABLED=true` set on the server, no `AUTH_URL`): `admin-login` 4 passed (sign-in works on a non-3000 port with no `AUTH_URL` when `.env.local` defines none, which settles the G10 doubt for this setup); 7c-A set 69 passed (`giving-admin`, `giving-connect`, `invitation-fixture-sweep`, `statistics-submit`, `presbytery-reports`, `totp-recovery-code`, `custom-domains/domains-admin`: covers giving, invitation, statistics, sasr, totp, domains-ui, custom-hosts' toggle/site-org helpers, flags and global-setup); 7c-B set 86 passed (`member-calendar`, `portal-home-cards`, `community-approval`, `community-participants`, `person-emails`, `custom-domains/serving`: covers calendar, home-cards, community, person-emails, custom-hosts' world/teardown). 155 e2e tests, 0 failed. The server was stopped by PID.
- AGENTS.md: a `next dev` start under the agent environment (and the later full e2e runs) leaves `git status` clean; the only AGENTS.md diff was the intended `#` -> `##`. No `console.log` added in production paths (`console.warn` stays in `withDbRetry`, as before).

## Implementer Notes

Deviations from the design, each small:

1. **`DECISION-A to DECISION-B` ranges in `briefings-check`.** The design expands hyphen and en-dash ranges only, but Appendix D's own entries write "DECISION-215 to DECISION-219", "DECISION-202 to DECISION-206", "DECISION-194 to DECISION-196", "DECISION-183 to DECISION-193", "DECISION-176 to DECISION-182", "DECISION-168 to DECISION-175" and "DECISION-197 to DECISION-201"; with dash-only the interior numbers would stay "not yet named" after the orchestrator commits the entries, and the banner would not go silent. I also accept `to`. A reversed or wider-than-60 range expands to nothing (its first number, and its second when written with its own `DECISION-`, still count as plain mentions).
2. **Commit 9, `docs(testing)`** (not in the design's commit list): the `worktrees:report` line in `docs/testing.md` and the `check:secrets` annotation for the recipe's two test literals (the gate caught them on the first `npm run check`). Kept out of commit 11 so the docs line and the annotation are one reviewable change.
3. **Gate lexer.** Based on Appendix A with three changes: a here-string (`<<<`) is not a heredoc; a literal `(`/`)` pair inside a `$(...)` no longer ends the substitution early (paren depth); a `cd -` or bare `cd` leaves the tracked directory unchanged. `commandContainsGitPush` resolves relative to `process.cwd()` since its signature takes no cwd.
4. **`e2e-reset-flags.sql`:** the flag update only touches rows whose value differs and sets `updated_at = now()`; the final evidence select prints the keys that are on. The "refusing to run" notice also prints a blank `set_config` row from the confirmation `select` (harmless).
5. **`withDbRetry` text** also reads the `cause`'s `code` (a wrapped `UND_ERR_*` or `ECONNRESET`), not only its message; the SQLSTATE test needs a digit so Node's `EPIPE` is read as a Node error.
6. **7c scope calls**: `sweepCommunityPeople` and `removeSessionGroup` and the giving `removeGivingFixtureById` get the domains-ui shape (one retried unit, plus a `finally` that re-enables the trigger, with its own retry); `sweepCommunityPeople`'s `update people set deletable_until` moved inside the retried unit so a retry re-stamps. Not wrapped, per the table: `setupGivingFixture`, `addForeignEntry`, `setConnection`, `addLiveSite`, `seedReturnIntent`, `addDonor`, `addOfflineGift`, `addLiveOnlineGift`, `addRefund`, `addUnsettledOnlineGift`, `addSettlement`, `addInboxEvent`, `addContactEmail`, `addOpenStaffPosition`, `stagePublishedReturn`, `setupCalendarFixture`, `setupCommunityFixture`, `setupHomeFixture`, `createParticipantViaSql`, `createStaffAnchorViaSql`, `createProposalViaSql`, `setupDomainsUiFixture`, `setDomainsRole`, `setupInviteOrg`, `addRosterPerson`, `createThrowawayUser`, `seedInvitation`, and in `custom-hosts.ts` `insertBundle`, `insertImage`, `createSiteOrg`, `addDomain`, `addExpiredClaim`, `walkDomain`, `stepDomain`, `buildWorld`. Spec-inline `afterAll` SQL remains uncovered (TODO line is the orchestrator's).
7. **The worktree report's "merged" is true for a brand-new pipeline worktree whose HEAD equals main** (nothing committed yet), so it would suggest `git worktree remove` for it. The output says it deletes nothing and the footer says the commands are suggestions; a one-clause caveat in the footer was not added because the Copy table fixes that sentence. Noted for QA.
8. **G10 / Q7:** the dev lane's `command: "npm run dev"` is unchanged (no `-p`). The new docs section says to start your own server first.

Unverified: that a wrapped teardown survives a real Neon drop (cannot be induced; the retry classification is covered by injected-failure tests, the idempotence of each step by reading against R1-R6); that `reuseExistingServer` plus the guard behave identically in each Playwright worker (the config reloads per worker and the throw repeats; not observed under a real failing worker).

Strings added or changed (all in the Copy table): `scripts/pre-push-gate.mjs` `CHAINED_MESSAGE` (C1); `e2e/support/dev-port-guard.ts` `devLaneGuardMessage` (C2); `scripts/ci/e2e-reset-flags.sql` refusal, missing-key and three notice lines (C3); `scripts/briefings-check.mjs` `renderBehindLine` (C4); `scripts/stats-escape.mjs` `parseSinceArg` error, `windowLabel`, "in this window" line (C5); `e2e/support/db.ts` `[e2e-db] <label>: connection dropped, retry n/m` (C6); `scripts/agents-md.test.mjs` failure messages (C7); `scripts/worktree-report.mjs` disk lines and footer (C8); `docs/testing.md` additions (C9).

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-25
**Verified by:** qa (read-only; I wrote no tests and edited no files). The worktree `/Users/cshenso/git/presby-platform/presby-wf` is clean at `0f9f3ee`. The main checkout is clean and its pre-push marker is byte-unchanged (sha256 prefix `3a7141414b5bcfb0` before and after). No marker was created in the worktree.

**Scope run:** typecheck, lint, `npm run check` and plain `npm test`, all in full. Each of the 8 new or changed test files was run on its own. Failing-first was re-run for all four `fix` commits and for `--since`, in a scratch copy made with `git archive`. The gate was tested in `decideHook` and in hook mode, and the Playwright guard in both directions. The reset file was refused and then applied, on the pipeline branch only. Also checked: the briefings count (live, and simulated after the backlog commit), `stats:escape` byte-identity, `AGENTS.md` under `next dev`, and `worktrees:report` against the real worktree list.

e2e ran as the **full `--project=chromium` suite**, not the requested sample. My Run Scope rule requires the full suite because the diff touches `e2e/support/` and `playwright.config.ts`. It ran against my own server on :3480. Not re-run: the `custom-hosts` project (`domains-admin`, `serving`, 155 tests together with Phase 4's other specs) rests on the implementer's Phase 4 run. No DB-backed vitest suites ran: no migration, `authz.ts`, `src/lib/db/` or shared vitest fixture is in the diff.

**Prerequisites:**
- Disk: 573 GiB free.
- `.env.local`: all three URLs point at endpoint `ep-fancy-credit-axnbpmku`, the pipeline branch per Phase 4. The main checkout points at `ep-lingering-meadow-axnarpsq`. Endpoint IDs were extracted; no URL was printed.
- **Flag reset:** I ran `scripts/ci/e2e-reset-flags.sql` with the documented command before the e2e run. Result: 10 of 39 flags on, and the 3 baseline flags on.

## Type Check

`npm run typecheck`: PASS. `npm run lint`: PASS (0 warnings). `npm run check`: PASS, all eight tripwires.

## Unit Tests

Plain `npm test`: 626 files, 549 passed, 77 skipped. 10,962 tests, 8,520 passed, 2,442 skipped, 0 failed, 25.3 s.

The 77 skipped files are the DB-backed suites, which skip when no `.env` is loaded. None of them is in this diff.

The eight files for this pipeline, run alone with `--reporter=verbose`, give **215 passed, 0 skipped**:

| File | Tests |
|---|---|
| pre-push-gate | 75 |
| agents-md | 1 |
| briefings-check | 22 |
| stats-escape | 26 |
| e2e-reset-flags | 11 |
| dev-port-guard | 25 |
| with-db-retry | 39 |
| worktree-report | 16 |

These match Phase 4's numbers exactly.

**Failing-first.** Each new test was run against the pre-change source, swapped in from `<sha>^`, in a scratch copy at `.../scratchpad/wf/ff`:

| Commit | Claimed | Reproduced | Behavioural or import-only |
|---|---|---|---|
| `e3cebb1` gate | 51 of 75 fail | **51 of 75 fail** | Behavioural for every quoting and wrapped-form test, because the old `commandContainsGitPush` existed. The 33 `decideHook` tests fail on import. The hole itself is shown below. |
| `069ba1d` AGENTS.md | red | **red**, with the exact C7 message | Behavioural |
| `5ef2ec8` briefings | import failure | **`recordedDecisions is not a function`, no tests ran** | Import-only. Behavioural evidence comes from the live banner (see C4). |
| `8fcdf60` `--since` (feat) | 26 fail | **26 of 26 fail** | Import-only. The real property, default byte-identity, is verified separately below. |
| `0f1dda2` withDbRetry | 32 of 39 fail | **32 of 39 fail** | Behavioural for "a statement timeout runs once" and "the bare message 'timeout' runs once". See N1. |

**The chained-push hole, shown behaviourally.** I stamped a marker inside the scratch copy's own `.claude/`, never the real one, then spawned the gate in hook mode with `git commit -m x && git <push>`. The old gate returned **exit 0**. The new gate returned **exit 2** with C1.

## End-to-End Tests

The server was started per `docs/testing.md` "Running Playwright from a worktree": `npx next dev -p 3480` with the test fakes, **no `AUTH_URL`**, `E2E_BASE_URL=http://localhost:3480`. Afterwards I stopped it by its recorded PID. Killing the `npx` PID took down the listener, so the docs' "kill <pid>" is accurate.

Full `--project=chromium`: 412 tests, **411 passed, 1 failed, 16.7 min**.

- Failure: `e2e/invitation-new-account.spec.ts:66`, at `:204`. It waited 20 s for "you enrolled on". The snapshot shows all six TOTP digits entered and the page still on "Enroll in two-factor authentication".
- **Re-run of the single file: 1 passed (8.1 s).** Under the timeout rule this is intermittent, not a FAIL.
- It is unrelated to the diff: the spec is untouched, and the only change on its path is `invitation-fixture.ts`'s import (`withDbRetry, type Sql` from `./db`).
- G10 is settled for this setup: sign-in, TOTP and admin specs pass on :3480 with no `AUTH_URL`, so that docs sentence is accurate.

After the run the flag state was back to 10 of 39 on.

The 360px check does not apply: nothing renders, and the diff has no `src/` change.

## Regression Tests Added

- `commandContainsGitPush › quoting`, `scripts/pre-push-gate.test.mjs:145`. Guards against commit-message, heredoc and comment text being read as a push (G1).
- `commandContainsGitPush › wrapped forms`, `:183`. Guards against `bash -c`, `eval`, subshells and prefixes hiding a push (G2).
- `decideHook › chained`, `:220`; `› target repo`, `:270`; `› fail-open`, `:322`; hook spawn (read-only marker), around `:350`. Guard against the commit-then-push hole, wrongly gating `scratch/` checkouts, and the gate bricking Bash.
- `scripts/agents-md.test.mjs:20`. Guards against `next dev` dirtying `AGENTS.md` after a Next upgrade.
- `scripts/briefings-check.test.mjs:88` ("50, not 62"). Guards against high-water-mark counting. It uses synthetic input, so it does not see the real-file defect in C4.
- `scripts/stats-escape.test.mjs:98`. Guards against default output drift. I also confirmed byte-identity myself: old and new produce the same 676 bytes, directly and through `npm run`.
- `scripts/e2e-reset-flags.test.mjs:65,70`. Guards against the reset list drifting from `seed.ts`.
- `scripts/dev-port-guard.test.mjs:110,140`. Guards against a worktree attaching to :3000.
- `scripts/with-db-retry.test.mjs:100,107,119,141`. Guard against constraint errors and timeouts being retried, and against nested wrappers multiplying attempts.

## Coverage on Critical Modules

None of these is touched by the diff; this is a smoke reading.

- `src/lib/permissions.ts`: 100%
- `src/lib/two-factor.ts`: 91.3% statements (lines 35 to 39; this gap predates the pipeline)
- `src/lib/flags.ts`: 100%

## Feature-Gate Audit

No protected routes touched. The diff has 0 files under `src/` and 0 under `drizzle/`, and no route, action, auth, proxy, authz, seed or permissions path. Schema/RLS audit: not applicable.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| none | n/a | n/a | n/a |

## Copy Truthfulness

- [x] Every added or changed string is in the design's Copy table. C1 to C9 match the code. C1 and C2 match their thrown or printed output byte-for-byte.
- [x] The query behind each claim was opened. Two claims are false; see FAIL-1 and FAIL-2.
- [x] Each instruction was traced to the role that sees it, and that role can follow it. For C2, I started my own server and set `E2E_BASE_URL`, and the run then listed and ran. For C3, the documented command works. For C1, a commit, then `/pre-push`, then a push works.
- [x] Older strings were grepped. None is made false, apart from FAIL-2's Phase 4 record. `qa.md:64` is now accurate. The remaining `[domains-ui-fixture]` lines (`domains-ui-fixture.ts:59,64,177,179`) are that fixture's own refusal errors and are still accurate.

**C1, gate (`scripts/pre-push-gate.mjs:399-402`): PASS.**
- Hook-mode stderr matches the Copy table exactly.
- Refused with a fresh marker (34 cases): every separator (`&&`, `;`, newline, `||`, `|`, `&`, no spaces); all 8 HEAD movers; `bash -c`, `sh -lc` nested in `bash -c`, `eval`, subshell, braces, `bash <<EOF`; the `-C`, `-c`, `/usr/bin/git`, `command`, `env` and `FOO=1` prefixes; escaped (`g\it`) and quoted `"git"`; line continuation; the house heredoc commit followed by a push; and an unresolvable `cd`.
- Allowed (13 false-positive strings): the house heredoc commit, `-m` text describing a chained push, a `-F -` heredoc body, a comment, a `gh pr --body` heredoc, single-quoted `echo`, `grep "git push"`, a here-string, and other-repo commit-and-push (both `cd` and `-C`).
- "even when it changes nothing" is accurate for a no-op `pull`.

**Live G1 evidence on `main`:** the main checkout's current gate refused one of my own probe commands because its heredoc text contained a chained push. This is the defect this pipeline fixes.

**C2, Playwright guard: PASS.**

| Run | Result |
|---|---|
| Worktree, no env | throws |
| `127.0.0.1:3000` | throws |
| `PW_ALLOW_3000=true` | throws |
| `:3480` | lists 515 |
| `PW_ALLOW_3000=1` | lists |
| `CI=1` | lists |
| Production lane | lists 76 |
| Plain (non-worktree) scratch checkout | no throw |
| Linked worktree I added to the scratch repo | throws |

**C3, reset file: PASS.** Before the runs I turned on one seed-OFF flag (`org_portal.staff`), giving 11 of 39 on.

| Run | Result |
|---|---|
| No variable, `ON_ERROR_STOP` | refused, still 11 on |
| No variable, no `ON_ERROR_STOP` | refused, every later statement errors, `ROLLBACK`, still 11 on |
| `pipeline_branch=0` | refused, still 11 on |
| Documented command | "set 39 seeded flags…", baseline `UPDATE 3`, per-org notice, `COMMIT`; 10 on, `org_portal.staff=false` |

"Nothing was changed." is accurate. The missing-key path rests on Phase 4's run and on reading the code: the raise comes before the update in the same block.

**C4, briefings banner: `copy truthfulness: FAIL`.** See FAIL-2.

**C5, `stats:escape`: PASS.**
- The default output is byte-identical to the old script.
- With the flag, the title and labels read "since <value>" and no `30d` remains.
- The empty-window line is shown.
- 6 bad values are refused with the C5 message and exit 2: `2026-13-45`, `;rm`, `$(id)`, `1000 days ago`, the empty string and `--output=x`.
- The script uses `execFileSync` with an argument array.

**C6** (`db.ts:128`) and **C7** (`agents-md.test.mjs:26,31,36`): PASS. **C9 (docs):** PASS. The recipe, the reset command, R1 to R6 and the AUTH_URL sentence were all checked against the running system.

**C8, worktree report: `copy truthfulness: FAIL`.** See FAIL-1.

**AGENTS.md:** with the agent environment present (`CLAUDECODE`, `AI_AGENT`), a `next dev -p 3480` start plus requests and the whole e2e run left `git status` empty.

**Briefings count now and after the planned commit:**
- **Now**, from the worktree, the banner reads: `82 unread briefings — docs/briefings.md` and `briefings are BEHIND by 45 decisions not yet named (newest DECISION-229) and 67 feat/fix commits — …`.
- **After** Appendix D's twelve entries, marker `decision=224`, and DECISION-231 recorded (simulated in scratch): only `94 unread briefings — docs/briefings.md`. There is no behind line, and the entries name every number from 168 to 224 (excluding 207 to 214), plus 229 and 231.

### FAIL-1: worktree report calls in-flight worktrees "merged into main" and suggests removing them

`scripts/worktree-report.mjs:98` (label), `:69` (suggestion), `:133-144` (`isMerged`), `:106` (footer). Affects the orchestrator and operator.

"merged into main" is computed as `merge-base --is-ancestor HEAD origin/main`. A worktree with no commits of its own passes that check. Against today's real worktrees, `npm run worktrees:report` labels **`presby-cal`, `presby-inc3` and `presby-parish`** "merged into main" and prints `git worktree remove '<path>'` for each. All three are live pipelines with 0 commits beyond `origin/main` and an uncommitted work-log.

Git refuses those three because of the untracked file. But a fresh worktree holding only ignored files is **deleted silently with exit 0**; I reproduced this in a scratch repo. That is the state right after `/new-feature` creates it: `.env.local` and `node_modules`. The footer states the squash caveat but not this case.

**This traces to a design claim:** Copy C8 and Item 8 define the label and its source. Phase 4 flagged it as deviation 7 and was bound by the Copy table. So it goes to **tech-lead (Phase 3)** for a ruling. Item 8 is designated "first to cut", so cutting it is one option. The other is to separate "no commits of its own" (for example, HEAD on `origin/main`'s first-parent line) from "merged", never suggest removal for a worktree with changes, and amend C8. Per CLAUDE.md's Accelerated Feature row, a QA FAIL that traces to a design claim promotes the pipeline to a full Feature at that point. The orchestrator should record that.

### FAIL-2: briefings banner undercounts by five

`docs/briefings.md:21`, read by `scripts/briefings-check.mjs:76-91`. Affects the operator at session start.

The new explanatory paragraph's example, `` range like `DECISION-215–219` ``, is itself parsed as naming DECISION-215 to 219. The live banner therefore says **45** decisions not yet named, when 50 recorded decisions above the marker are named by no entry. I decomposed the count: the five "named" numbers above 167 are exactly 215 to 219.

Phase 4's record ("the banner went from 62 to 50") is false at HEAD. The test at `:88` uses synthetic input and cannot see this.

The effect disappears once the backlog commit moves the marker to 224, but until then it steers whoever writes the entries away from 215 to 219, and it remains a trap in the file. This traces to implementation, not a design claim. Fix: use a placeholder that contains no digits (for example `DECISION-NNN–MMM`). Add a test that the real `docs/briefings.md`, outside its dated entries, names no recorded decision. Correct the Phase 4 line.

### Non-blocking notes (fix opportunistically)

- **N1.** The 7b claim is partly overstated. The old helper tested only `message` and `cause`, and the Neon driver sets `name = "NeonDbError"` while keeping the server's text as `message`. So a unique violation was not being retried: `withDbRetry › a unique violation runs once and throws` passed against the old helper. The timeout retry was real. The same overstatement appears in the header of `scripts/with-db-retry.test.mjs:3-5` and in the body of commit `0f1dda2`.
- **N2.** Two gate residuals are missing from the header list. Neither is a regression; the old gate missed both.
  - `git push $(git commit -m x)`: an unquoted `$()` is ordered after its enclosing command, so with a fresh marker this is allowed.
  - Prefixes that carry flags (`nice -n 5`, `time -p`, `command -p`) hide the push entirely, so it is allowed even with no marker. Header lines 38-39 say these prefixes are followed.
- **N3.** The design's claim that `rg '\[domains-ui-fixture\]'` finds only the renamed line is inaccurate; four refusal lines remain, correctly named. No action.
- **N4.** The intermittent `invitation-new-account.spec.ts:66` failure (above) is worth watching. A prior session's logs in this scratchpad show a similar one-off on `invitation-existing-account.spec.ts`.

## Verdict

**FAIL.** Two copy-truthfulness defects. FAIL-1 traces to design Copy C8, so it goes to tech-lead and, per the Accelerated rule, the pipeline is promoted to a full Feature. FAIL-2 is an implementation fix in `docs/briefings.md:21` plus a guard test. Everything else passed: gates, the 215 new tests, failing-first, the gate's behaviour, the Playwright guard, the reset file, `stats:escape` byte-identity, `AGENTS.md`, and full-chromium e2e (411 of 412, with the single failure passing on re-run).

Not auth-touching, so the stricter gate does not apply.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. FAIL-1 traces to design C8, so Accelerated promotes to a full Feature (orchestrator to record). FAIL-2 is implementation. Flag reset ran on the pipeline branch. | FAIL | 2026-10-25 |

## Handoff

- **FAIL-1 → tech-lead (Phase 3):** a ruling on Copy C8 and Item 8, either cut item 8 or redefine "merged" and the removal suggestion. Then the implementer.
- **FAIL-2 → full-stack-developer (Phase 4):** `docs/briefings.md:21` placeholder, a real-file guard test, and the correction to the Phase 4 record. N1 (the test header comment) can go in the same commit.
- **Then QA re-runs:** `briefings-check` and `worktree-report` tests, the live banner, `worktrees:report` against the real worktree list, and `npm test` / `npm run check`. Everything else stands on this run unless those files change.

Evidence logs are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/wf/`: `e2e-chromium.log`, `e2e-rerun.log`, `unit.log`, `check.log`, `newtests.log`, `probe-gate.mjs`, `probe-hook.mjs`, `stats-old.txt` and `stats-new.txt`.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]

## Orchestrator rulings on the Phase 1 defaults (2026-10-25)

- **Relabelled Accelerated Feature** (Q1). **Skipping Phase 2 — no new dependency, no new directory or structural change, no invariant touched. `e2e/support/db.ts` and `scripts/` are existing homes; no `src/` code is added. Rule 16's shared-file list is noted and handled in Phase 1.**
- Q2–Q9 on the analyst's defaults. The disk prerequisite is cleared (541 GiB free at 2026-10-25).
- **Added to scope from QA (session-update-hardening, Phase 5 run 1):** Next 16 rewrites the tracked `AGENTS.md` heading on every dev-server start, dirtying every worktree; fix it (commit the generator's form, or disable the generator) — Phase 3 picks, verified by a dev start leaving `git status` clean. The qa agent file names `scripts/ci/e2e-reset-flags.sql`, which this pipeline creates, so that reference becomes correct.

## Orchestrator: QA run 1 FAIL — loop-back (2026-10-25)

- **Promoted to a full Feature** (CLAUDE.md Accelerated row: a QA FAIL tracing to a design claim). FAIL-1 traces to Copy C8 / Item 8; Phase 2 stays skipped for this loop-back (the change is to a report script's copy and predicate, no structural question).
- **FAIL-1 → tech-lead** for a Phase 3 amendment on C8/Item 8. **FAIL-2 → full-stack-developer** after the amendment (briefings.md:21 placeholder, real-file guard test, Phase 4 record correction, N1 test-header wording).

---

# Phase 3 amendment 1 (tech-lead) — QA run 1 loop-back

**Author:** tech-lead, 2026-10-25. **Pipeline mode:** Full Feature (promoted by the orchestrator; Phase 2 stays skipped for this loop-back, no structural question). **Checked against:** the live tree of this worktree at `0f9f3ee`: `scripts/worktree-report.mjs` and its test, `docs/briefings.md:10-26`, `scripts/briefings-check.mjs`, `scripts/pre-push-gate.mjs:1-66`, `docs/testing.md:512-518`, and the real worktree list (`git worktree list --porcelain`, the classification below run by hand against every entry). Scope: Item 8 and Copy C8 are re-specified; FAIL-2, N1 and N2 are specified; N3 and N4 are dispositioned. Nothing else in Phase 3 changes. **Item 8 / C8 above are superseded by this amendment; the original text is kept as the record.**

## Rulings

**FAIL-1: keep Item 8 and redefine it.** Cutting would drop the disk-and-size report that exists because a full disk was read as a Neon "fetch failed" twice; the defect is only the predicate and the suggestion, which are small to fix. The root cause is one conflation: `git merge-base --is-ancestor HEAD origin/main` is also true for a worktree that has no commits at all (HEAD *is* a commit on main). "Is an ancestor" answers "are this HEAD's commits on main", not "has this branch been merged". The amended report therefore separates four facts and bases its one destructive-looking suggestion on all of them:

1. **has commits of its own**: HEAD is not on `origin/main`'s first-parent line. A branch merged by a merge commit (this project's merge style, `Merge pull request #N`) has its tip as the *second* parent of that merge, so it is off the first-parent line; a fresh pipeline worktree, whose HEAD is some commit that main itself reached, is on it.
2. **all of them are on `origin/main`**: HEAD is an ancestor of `origin/main` (the old test, kept).
3. **clean**: `git --no-optional-locks status --porcelain` (tracked changes and untracked files, not ignored files) prints nothing. The flag keeps the report from refreshing any worktree's index; the script stays read-only.
4. **a named branch**: a detached HEAD is never classified.

`git worktree remove` is suggested **only when 1, 2, 3 and 4 all hold**. Everything else, including "no commits of its own", "not merged", detached, unknown, and dirty-or-unknown, gets no removal suggestion. The only remaining suggestion for those is `rm -rf '<path>/.next'`, and only when `.next` exists.

Against the real worktrees (run by hand with the rules above): `presby-cal`, `presby-inc3`, `presby-parish` are on the first-parent line and dirty, so "no commits of its own (new or unused)" and "uncommitted or untracked files", no removal; `presby-2b`, `presby-gauth`, `presby-sess` and this worktree are not ancestors, so "not merged". Nobody currently qualifies for removal, which is the correct output today.

**Known and accepted classification residuals (stated in the footer, not hidden):** a fast-forwarded branch looks like "no commits of its own"; a squash-merged branch looks like "not merged" (the old caveat); a branch deliberately created from a commit that is itself off main's first-parent line (the tip of an already-merged feature branch) would read as "merged" while having no work of its own. For that last case the removal still needs a clean tree, the suggestion is text, and the suggestions header names what `git worktree remove` deletes. All three err toward *not* suggesting removal except the last, which is a rare operator action. [unverified: no test pins the last one; it is a deliberate-branching case.]

## Item 8 (amended) — Disk and worktree report (`fix(tooling)`)

`scripts/worktree-report.mjs` stays report-only: it prints and deletes nothing, always exits 0. Changed surface, all pure except the gatherers, all exported for tests:

- `worktreeState(facts): "merged" | "none" | "unmerged" | null` with `facts = { detached: boolean, ancestor: boolean | null, onFirstParent: boolean | null }`. `detached` or `ancestor === null` gives `null`; `ancestor === false` gives `"unmerged"`; `onFirstParent === null` gives `null`; `onFirstParent === true` gives `"none"`; otherwise `"merged"`.
- `resolveBase(cwd): string | null` runs `git rev-parse --verify --quiet refs/remotes/origin/main^{commit}`. There is **no fallback to a local `main`**: a local main can be ahead of what was published, and "merged" is a statement about `origin/main`. Missing gives `null` and every state is `null`.
- `firstParentLine(base, cwd): Set<string> | null` runs `git rev-list --first-parent <base>` once per report (301 entries today) with a raised `maxBuffer`; `null` on failure.
- `worktreeFacts(head, base, line, cwd)`: `ancestor` from `git merge-base --is-ancestor` exit code (0 true, 1 false, anything else `null`); `onFirstParent` is `line.has(head)`.
- `isDirty(worktreePath): boolean | null` runs `git --no-optional-locks status --porcelain` in that path; non-empty output is `true`, empty `false`, error `null`. Not computed for the main checkout or a bare entry (`null`).
- `buildModel(repoRoot, { sizes }): Model` assembles the model (extracted from `main()` so the regression test can run the real gatherers against a temp repo): `{ repoRoot, freeGiB, baseFound, worktrees: [{ path, branch, detached, isMain, bare, state, dirty, nextExists, sizes }] }`. `nextExists` is `existsSync(<path>/.next)`.
- `removalSuggestions(entries)`: skip main and bare. `git worktree remove '<path>'` iff `state === "merged" && dirty === false`. Otherwise `rm -rf '<path>/.next'` iff `nextExists`. Nothing else, ever. (Signature unchanged; the entry shape gains `state`, `dirty`, `nextExists` and loses `merged`.)
- `formatReport(model)`: the strings of amended C8 below.

Unchanged: `--no-sizes`, `shellQuote`, `parseWorktreePorcelain`, the 20 GiB line, `du -sk`, `statfsSync`. The header comment (lines 3-17) and the file's caveat sentence are rewritten to the new definition (they say "whether its HEAD is already merged into main").

**Tests** (extend `scripts/worktree-report.test.mjs`; the existing 16 are updated for the new entry shape, not deleted):

- `worktreeState › truth table`: each of the nine fact combinations, including `detached`, `ancestor: null`, `onFirstParent: null`.
- `worktreeFacts` and `buildModel` against **real temporary git repositories** (as `scripts/dev-port-guard.test.mjs` does for `git worktree add`; `GIT_CONFIG_GLOBAL` and identity set so no user config leaks; `refs/remotes/origin/main` made with `git update-ref` to stand in for a fetch):
  1. a fresh worktree on a new branch at the main tip, holding only an ignored `.env.local` and a `node_modules/` directory, gives state `none`, `dirty === false`, and **`formatReport` contains no `git worktree remove` line for it** (the FAIL-1 reproduction; red on the shipped `d6da996`).
  2. the same with an untracked work-log file gives `dirty === true`.
  3. a branch with its own commit, merged into main with `merge --no-ff`, then `origin/main` updated, gives `merged`; clean gives `git worktree remove '<path>'`; with one untracked file added, no `worktree remove` line and a `.next` removal only if `.next` exists.
  4. a branch with its own commit, not merged, gives `unmerged` and no removal line.
  5. a branch fast-forwarded into main gives `none`; a squash-merged branch gives `unmerged`; neither gets a removal line.
  6. a detached worktree gives `null` state and no removal line, whatever its ancestry.
  7. no `refs/remotes/origin/main` gives `baseFound === false`, all states `null`, no removal line, and the "Merge state is not shown" line.
  8. the main checkout never gets a state, a dirty flag or a suggestion.
- `removalSuggestions › table`: merged and clean gives remove; merged and dirty gives no remove; merged and `dirty: null` gives no remove; each of `none`, `unmerged`, `null` gives no remove; `.next` removal only when `nextExists`; a path with a space or a single quote is quoted; main and bare never appear.
- `formatReport › exact strings`: every line of amended C8 pinned (state labels, dirty label, footer, both suggestion header lines, the base-missing line, the OK and BELOW disk lines), and the suggestion headers appear only when their kind of suggestion is present.
- `worktree-report › reads and never writes`: a source scan of `scripts/worktree-report.mjs` that every `git(...)`/`execFileSync("git"` call names one of `worktree list`, `rev-parse`, `rev-list`, `merge-base`, `status` (and `status` carries `--no-optional-locks`), and that no call names `remove`, `prune`, `clean`, `checkout`, `switch`, `reset`, `rm` or `mv`.

**Docs:** `docs/testing.md:512-518` is rewritten (see C8 Neighbours). The `package.json` script line is unchanged.

## Copy C8 (amended) — worktree report (stdout)

Disk lines unchanged:
`Disk: <x.x> GiB free on the volume holding <repo root> (checklist minimum 20 GiB: OK)`, or `Disk: <x.x> GiB free on the volume holding <repo root>: BELOW the 20 GiB the new-feature checklist asks for. A full disk has surfaced as a Neon "fetch failed" before; free space before running suites.`

Per worktree, one line, segments separated by two spaces, a segment omitted when it does not apply:
`<path>  <branch | detached | bare | unknown>  <state>  <changes>  node_modules <x.x> GiB, .next <x.x> GiB, rest <x.x> GiB`

- `<state>` is exactly one of: `merged into origin/main` · `no commits of its own (new or unused)` · `not merged`. Omitted for the main checkout, a bare entry, a detached HEAD and an unknown state.
- `<changes>` is exactly `uncommitted or untracked files`, shown when `dirty === true`; omitted otherwise (and for the main checkout).

When `origin/main` is not found, after the worktree lines:
`Merge state is not shown: origin/main was not found in this repository.`

Footer (one paragraph, after a blank line):
`Hardlinked node_modules are counted in full for each worktree. "merged into origin/main" means the branch has commits of its own and every one of them is on origin/main as of your last fetch. A branch that was squash-merged or fast-forwarded cannot be told from an unmerged or an unused one, so no worktree removal is suggested for it. This report deletes nothing.`

Suggestions, only when there is at least one, after a blank line:
`Suggestions for you to run (nothing here has been run):`
then, only when a `git worktree remove` is listed:
`"git worktree remove" also deletes the ignored files in that worktree, such as .env.local and node_modules; the branch is kept.`
then, only when an `rm -rf .../.next` is listed:
`".next" is regenerable; stop that worktree's dev server before removing it.`
then the commands, each indented two spaces.

The four checks:

- **Residuals.** The footer states the squash and fast-forward limits and the hardlink counting. The third accepted residual (a branch started from an already-merged feature tip) is not stated in the output; it is in the amendment and the script header, and it cannot produce a removal line without a clean tree. It denies no Phase 2 ruling (Phase 2 was skipped) and no accepted residual in the Phase 1 record.
- **Source of truth.** `merged into origin/main`: `refs/remotes/origin/main` resolved by `rev-parse`; `merge-base --is-ancestor` exit code; membership of HEAD in the set from `rev-list --first-parent origin/main`. `no commits of its own`: HEAD on that first-parent set and an ancestor. `not merged`: not an ancestor. `uncommitted or untracked files`: `git --no-optional-locks status --porcelain` output non-empty. "as of your last fetch": the claim reads a remote-tracking ref, which is only as fresh as the last fetch. "the branch is kept": `git worktree remove` does not touch refs. "nothing here has been run": true, the script has no mutating call (pinned by the source-scan test). Free GiB: `statfsSync` of the repo root; sizes: `du -sk`.
- **Audience.** The orchestrator and the operator, who own worktree cleanup (`.claude/skills/new-feature/SKILL.md:54`); both can run the printed commands and stop a dev server. The surface's default reader is the orchestrator at a retrospective or before a new pipeline.
- **Neighbours.** Grepped the live tree for `worktrees:report`, `worktree-report`, "merged into main", "merged", "worktree remove": modify targets are `scripts/worktree-report.mjs:3-17` (header: "whether its HEAD is already merged into main" and the squash caveat), `scripts/worktree-report.test.mjs` (header comment and the footer and label assertions), and `docs/testing.md:512-518` ("whether it is merged into main" becomes: "whether it has commits of its own and, if so, whether all of them are on `origin/main` ('merged'), whether it has uncommitted or untracked files, ..., with suggested cleanup commands. It suggests `git worktree remove` only for a merged, clean worktree: never for a new pipeline worktree, a squash-merged or fast-forwarded one, or one with changes."). `.claude/skills/new-feature/SKILL.md:54` ("At cleanup: remove the worktree...") stays true and is not edited. The original C8 and the Phase 4 Implementer Notes item 7 are superseded by this amendment (pointer lines added above).

## FAIL-2 (implementation) — the briefings paragraph

Root cause: `docs/briefings.md:21` gives its example as a range of real recorded numbers (`DECISION-215–219`), and `namedDecisions` reads the whole file, so the example names five decisions no entry describes.

- **Fix.** Reword the paragraph at `docs/briefings.md:18-24` so it contains no `DECISION-<digits>` token: `(write `DECISION-NNN`, or a range like `DECISION-NNN to DECISION-MMM`, in the entry)`. The letters N and M never match `DECISION-0*(\d+)`. No other word of the paragraph changes; no entry and not the marker is touched (Rule 16 shared-file list does not name `docs/briefings.md`, and the orchestrator's backlog commit lands after this one).
- **Guard test** in `scripts/briefings-check.test.mjs`: `real docs/briefings.md › the explanatory preamble names no decision`. It reads the real `docs/briefings.md`, takes the text before the first line matching `^## \d{4}-\d{2}-\d{2}` (asserts that heading exists and is not at index 0, so the test cannot pass vacuously), and expects `namedDecisions(preamble).size === 0`. Self-check (in the same file, synthetic): the old paragraph text fed through the same function fails the same assertion, so the test is shown able to fail.
- **Phase 4 record correction** (the implementer appends this to the work-log as a Phase 4 amendment, it does not edit the old section): the `Gates`/`Failing-First Record` line "the banner went from '62 decisions' to '50 decisions not yet named'" was false at HEAD; the live banner read 45 because of this paragraph. After the fix, the banner reads **50 decisions not yet named (newest DECISION-229)**, which the implementer confirms by running `node scripts/briefings-check.mjs` and records with the commit count shown.
- **Copy (C4 re-check).** The banner string is unchanged; its Source-of-truth claim ("not matched by `DECISION-0*N` ... in `docs/briefings.md`") was true of the file as written but not of what the operator means by "named in an entry"; the guard test now makes the two the same for the preamble. Neighbours: `docs/briefings.md:18-24` is the one modify target; `scripts/briefings-check.mjs:13-18` describes the measure and stays true.

## N1, N2, N3, N4

- **N1 (`fix(e2e)` 7b claim, accept QA's reading).** The old helper tested only `message` and the `cause`'s message; the Neon driver puts the class name in `name`, not `message`, so a unique violation was not being retried by the old code. The behavioural fixes are the bare word "timeout" and a cancelled statement ("canceling statement due to statement timeout"). Replace the header of `scripts/with-db-retry.test.mjs` (lines 2-9) with: `Unit tests for withDbRetry / isDbDrop (e2e/support/db.ts). The helper retries a fixture step ONLY on a dropped connection. The old pattern also matched the bare word "timeout", so a statement timeout was retried five times (a 20 s stall became 100 s+). A unique violation was already not retried by accident (the driver puts the class name in name, not message); this pins that as a rule, with the timeout cases. The spec was always "fetch failed, Connection terminated, ECONNRESET, connection timeouts". This pins the classification, the schedule, the rethrow of the ORIGINAL error, and that nested wrappers do not multiply attempts.` Commit `0f1dda2`'s body and Phase 3 Item 7b/Summary say "constraint errors" were retried; that cannot be amended (history), so the implementer's Phase 4 amendment records the correction, and the Phase 4 `Failing-First Record` line for commit 8 is read as: 32 failed because `isDbDrop` did not exist and two behaviours were real fixes (statement timeout, bare "timeout"). DECISION-231 (Appendix B) says only that constraint errors and timeouts "throw at once", which is true; no edit.
- **N2 (`test(hooks)`).** Two accepted residuals, neither a regression. (a) `git push $(git commit -m x)`: an unquoted `$()` is ordered after the command that encloses it, so the commit is not seen as preceding the push; with a fresh marker it is allowed. (b) Prefixes that carry flags of their own (`nice -n 5`, `time -p`, `command -p`): the flag is read as the command, so the push behind it is not seen at all, allowed even with no marker. Add both to the `ACCEPTED RESIDUALS` list in `scripts/pre-push-gate.mjs`, and change the sentence at lines 38-39 to say the prefixes are followed **when they carry no flags of their own**. Pin both in `scripts/pre-push-gate.test.mjs` as `commandContainsGitPush › accepted residuals`: the test asserts today's behaviour (a) `decideHook` allows with a fresh marker, (b) the gate sees no push, each with a comment "accepted residual: remove this test only when the gate is changed to catch it". The implementer first reproduces both against the live gate; if either does not reproduce, they stop and report rather than write the header sentence. DECISION-231's residual list (Appendix B, "Accepted residuals: aliases, ...") gains the same two items when the orchestrator writes `docs/decisions.md`. TODO lines (orchestrator, Item 9): the two residuals, each as a gate follow-up.
- **N3.** No action (design claim `rg '\[domains-ui-fixture\]'` was inexact; the four remaining lines are that fixture's own correct refusals).
- **N4.** Watch item, no code change. TODO line (orchestrator, Item 9): `invitation-new-account.spec.ts:66` failed once in the full chromium run and passed alone, and a similar one-off was seen on `invitation-existing-account.spec.ts`; if it recurs, investigate the enrolment step's wait.

## Retroactive check (the rule discovered here)

The rule from FAIL-1 is: *a label that names a state must be computed from the facts that distinguish that state from its look-alikes, and a suggestion that deletes anything must require every fact that makes it safe.* Re-read against every string and table already specified: C1 to C3, C5 to C7 and C9 name no state derived from a predicate with a look-alike (C3's "Nothing was changed" is backed by the single transaction and was exercised by QA; C2's "probably another checkout's server" already hedges); C4's "named" had the look-alike found as FAIL-2 and is fixed above; Item 7's R1 to R6 are rules about not repeating non-idempotent steps and were reviewed against that principle in the original design; the push-gate messages name only what the tokenizer read. No further string changes.

## Edge Cases (amended, each cites its test)

- A fresh pipeline worktree (only ignored files) is never offered for removal. [test: `buildModel › fresh worktree with ignored files`]
- A worktree with an untracked file is never offered for removal, merged or not. [test: `buildModel › merged but dirty`]
- Merged by merge commit and clean is offered, with the ignored-files warning. [test: `buildModel › merged and clean`; `formatReport › suggestion headers`]
- Squash-merged, fast-forwarded, unmerged, detached, no `origin/main`, main and bare: no removal line. [tests: items 4-8 above]
- `git status` does not refresh any index. [unverified beyond the flag; the source scan pins that the flag is present, not that git honours it]
- A stale `origin/main` (no fetch) can call a just-merged branch "not merged" or miss a recent merge; safe direction; the footer says "as of your last fetch". [test: footer string]
- A branch created from a merged feature tip reads as "merged" with no work of its own. [unverified; accepted residual above]
- The briefings preamble never again names a decision. [test: `real docs/briefings.md`]
- **E2E blast radius:** none. No file under `e2e/`, `playwright.config.ts` or `src/` changes in this amendment, and no spec depends on `worktree-report`, `briefings-check`, the gate header, or the retry-test header. No feature flag is named or changed.

## Carry-forward (amendment)

| Item | Addressed here, or deferred (who accepted) |
|---|---|
| QA FAIL-1 worktree report | Item 8 amended; C8 amended; tests above |
| QA FAIL-2 briefings banner | Specified above (paragraph reword, guard test, Phase 4 record correction) |
| QA N1 withDbRetry claim | Specified above (test header; Phase 4 amendment records the commit-body correction) |
| QA N2 two gate residuals | Header list, pinned tests, DECISION-231 list, TODO lines |
| QA N3 | No action |
| QA N4 intermittent invitation spec | Deferred: TODO watch line (orchestrator) |
| Phase 4 deviation 7 | Superseded by this amendment |
| Phase 4 deviations 1-6, 8 | Unchanged; accepted by this tech-lead in this amendment (the `to` range form, commit 9 docs, lexer changes, reset-file details, retry text, 7c scope, G10) |
| All earlier Phase 1 gaps and rulings, Q1-Q9 | Unchanged from the Phase 3 table above |

## Commits (the implementer's list, in order)

Each carries `Work-Log: 2026-10-25-retro-workflow-efficiency` and the `Co-Authored-By` line; each `fix` also carries `Caught-By: agent-review` and `Discovered-In: Phase-5` (found by QA run 1 before merge).

1. `fix(tooling): suggest removing only a merged, clean worktree and say when one has no commits of its own` (FAIL-1: script, tests, header, `docs/testing.md` paragraph). Failing-first: the new tests run against `d6da996`'s script, red recorded.
2. `fix(briefings): keep the explanatory paragraph from naming a decision, and test the real file` (FAIL-2). Failing-first: the guard test against the current `docs/briefings.md`, red recorded.
3. `test(hooks): pin two accepted gate residuals and list them in the header` (N2).
4. `test(e2e): correct the withDbRetry test header` (N1).
5. `docs(work-log): record the Phase 4 amendment` (corrected lines for the 62-to-50 claim, deviation 7, and the 7b claim).

No migration, route, action, dependency, flag or permission: the full Feature classification is the QA-FAIL promotion, not new surface.

## Item 9 additions (orchestrator, at integration)

TODO lines to add: the two gate residuals (N2); the intermittent `invitation-new-account.spec.ts:66` watch (N4); "worktree report cannot see squash-merged or fast-forwarded branches (would need the PR list)". Appendix B (DECISION-231) gains the two residuals. Nothing else in Item 9 changes. The briefings marker procedure is unchanged; the guard test removes the need for a human to notice the paragraph.

## Implementer

**full-stack-developer**, in this worktree, branch `pipeline/retro-workflow-efficiency`, no push. Feasibility check done against the live tree: `git rev-list --first-parent origin/main` and `git --no-optional-locks status --porcelain` run by hand across all eight worktrees; `removalSuggestions` and `formatReport` have no callers other than `main()` and the test file; the changed signatures involve no SQL.

### Exact QA re-run scope

Run:

1. `npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires), plain `npm test` in full.
2. The four changed test files alone, verbose: `scripts/worktree-report.test.mjs`, `scripts/briefings-check.test.mjs`, `scripts/pre-push-gate.test.mjs`, `scripts/with-db-retry.test.mjs`; the count for each against the implementer's report.
3. Failing-first, in a scratch copy: the new `worktree-report` tests against `scripts/worktree-report.mjs` from `d6da996` (the fresh-worktree test must fail, as the old label was "merged"); the new real-file briefings test against `docs/briefings.md` from `0f9f3ee` (must fail); the two residual pins are green on the current gate (they document behaviour).
4. Live: `npm run worktrees:report` from this worktree. Expect `presby-cal`, `presby-inc3` and `presby-parish` to read `no commits of its own (new or unused)` and `uncommitted or untracked files` with no `git worktree remove` line for any worktree; `presby-2b`, `presby-gauth`, `presby-sess` and `presby-wf` to read `not merged`; the main checkout with no state. Before and after the run, `git worktree list --porcelain`, each worktree's `git status --porcelain` output, and the mtime of each worktree's index must be identical (read-only property); the main checkout's pre-push marker must be byte-unchanged.
5. Scratch-repo reproduction of the incident: a fresh worktree holding only `.env.local` and `node_modules`: no removal line. A merged-by-merge-commit clean worktree: a `git worktree remove` line preceded by the ignored-files sentence; add an untracked file and the line disappears. Squash-merged and fast-forwarded: no removal line.
6. Live: `node scripts/briefings-check.mjs`: the decision half must read `50 decisions not yet named (newest DECISION-229)` (not 45); the commit count must equal the current `git log --format=%s <marker commit>..HEAD` feat/fix count. Simulation as in run 1: with Appendix D's twelve entries, marker 224 and DECISION-231 recorded, the behind line is silent.
7. Copy truthfulness re-check of amended C8 (every string above, the four checks, against the runs in 4 and 5) and of C4. Confirm N1 by reading the new header against QA's own probe of `0f1dda2^` (unique violation not retried by the old helper; timeout was), and N2 by reading the gate header against `decideHook` for the two strings.
8. `git diff --stat 0f9f3ee..HEAD` must show only: `scripts/worktree-report.mjs`, `scripts/worktree-report.test.mjs`, `docs/testing.md`, `docs/briefings.md`, `scripts/briefings-check.test.mjs`, `scripts/pre-push-gate.mjs`, `scripts/pre-push-gate.test.mjs`, `scripts/with-db-retry.test.mjs` and the work-log.

Not re-run, standing on QA run 1: the gate's behaviour apart from the two residual pins, the Playwright guard, the reset file, `stats:escape`, `AGENTS.md` under `next dev`, the full chromium e2e (411 of 412; N4 watch). **If the diff in step 8 shows any file under `e2e/`, `playwright.config.ts`, `src/` or `scripts/ci/`, the full `--project=chromium` run is required again** (qa Run Scope rule), after the flag reset.

---

# Phase 4 — loop-back 1 (full-stack-developer)

**Implemented:** Phase 3 amendment 1, in this worktree, branch `pipeline/retro-workflow-efficiency`, no push. Base for the diff: `0f9f3ee`. The amendment section above was uncommitted at the start and is committed with this record.

## Commits

| # | SHA | Subject | Covers |
|---|-----|---------|--------|
| 1 | `df03301` | `fix(tooling): suggest removing only a merged, clean worktree and say when one has no commits of its own` | FAIL-1 |
| 2 | `7ebc5d3` | `fix(briefings): keep the explanatory paragraph from naming a decision, and test the real file` | FAIL-2 |
| 3 | `d3a9927` | `test(hooks): pin two accepted gate residuals and list them in the header` | N2 |
| 4 | `d18b2cc` | `test(e2e): correct the withDbRetry test header` | N1 |
| 5 | this commit | `docs(work-log): record the Phase 4 loop-back` | amendment text, corrections below |

Trailers on 1 and 2: `Caught-By: agent-review`, `Discovered-In: Phase-5`. All five: `Work-Log: 2026-10-25-retro-workflow-efficiency`, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No hook was bypassed. Nothing pushed.

## FAIL-1 — worktree report

- Implemented as specified: `worktreeState` (truth table), `resolveBase` (`refs/remotes/origin/main^{commit}`, no local-main fallback), `firstParentLine` (one `rev-list --first-parent` per report), `worktreeFacts`, `isDirty`, `buildModel`, the new `removalSuggestions` (`git worktree remove` iff `state === "merged" && dirty === false`; `rm -rf .next` iff `.next` exists; main and bare skipped), `formatReport` with the amended C8 strings, header comment and footer rewritten. `docs/testing.md` paragraph rewritten as specified.
- **Small additions beyond the amendment text, all in the safe direction:** (a) `isDirty` passes `--untracked-files=normal`, so a user's `status.showUntrackedFiles=no` cannot turn an untracked file into "clean"; the amendment's source scan still holds (the call is `status` with `--no-optional-locks`). (b) All git spawning goes through one never-throwing helper, `gitRun`, so the source scan is "exactly one `execFileSync("git"`" plus an allow-list over every `gitRun([...])` call. (c) `buildModel` also returns `listFailed` so `main()` keeps the old "git worktree list failed; showing disk only" line.
- **Failing-first.** The new test file was written first and run against the committed `d6da996` script: `38 failed | 16 passed (54)` (the 16 are the unchanged parse and quote tests); failures are `worktreeState` / `buildModel` / `worktreeFacts is not a function` and the old report strings. The incident itself was reproduced with the OLD script run as a CLI in a scratch repo (a fresh worktree holding only `.env.local` and `node_modules`): it printed `fresh  merged into main` and the line `git worktree remove '<path>'`. The same scratch scenario with the new script prints `fresh  no commits of its own (new or unused)` and no suggestion. After the implementation: `54 passed (54)`. Mutation check: forcing `worktreeState` to return `"merged"` for an ancestor made 5 tests fail (truth table, the incident, the dirty-fresh case, fast-forward, detached), restored afterward.
- **Live run** (`npm run worktrees:report`, read-only; `git worktree list --porcelain`, every worktree's `git status --porcelain`, and every index mtime compared before and after: identical, apart from one untracked `e2e/zz-scratch.spec.ts` that appeared in `presby-inc3` during the run, created by another session working in that checkout, not by the report; the main checkout's `.claude/pre-push-ok.json` sha1 `69d24137...` is unchanged):
  - `presby-cal` and `presby-parish`: `no commits of its own (new or unused)  uncommitted or untracked files`.
  - `presby-2b`: `not merged  uncommitted or untracked files`; `presby-gauth`, `presby-sess`: `not merged`; `presby-wf`: `not merged  uncommitted or untracked files`; main checkout: no state.
  - **`presby-inc3` reads `not merged  uncommitted or untracked files`, not `no commits of its own` as the amendment's hand classification and QA step 4 predict.** Checked by hand: its HEAD `14f3a4e` is not an ancestor of `origin/main`, so `not merged` is the correct output of the stated rules; the amendment's prediction for that one worktree was wrong, the script was not. QA should expect `presby-inc3` as `not merged`.
  - No `git worktree remove` line anywhere; the suggestions are four `rm -rf '<path>/.next'` lines (gauth, inc3, sess, wf) under the regenerable-`.next` note only.
- Not tested and stated: the "branch created from a merged feature tip" residual (the amendment marks it unverified).

## FAIL-2 — briefings

- `docs/briefings.md` preamble reworded to `DECISION-NNN to DECISION-MMM`; nothing else in the file touched (paragraph reflowed to 80 columns).
- Guard test `real docs/briefings.md › the explanatory preamble names no decision` (reads the real file, preamble = text before the first `## YYYY-MM-DD` heading, asserts the heading exists and is not at index 0, and that the marker text is in the preamble). Failing-first: against the committed file it failed with `expected [ 215, 216, 217, 218, 219 ] to deeply equal []`. Self-check tests in the same file: the old paragraph fed through the same path names exactly 215-219; the replacement names none. `25 passed (25)`.
- **Phase 4 record correction (supersedes the earlier line).** The Phase 4 Gates / Failing-First Record statement that the banner "went from '62 decisions' to '50 decisions not yet named'" was false at `0f9f3ee`: the live banner read **45** because the preamble named 215-219. After this fix `node scripts/briefings-check.mjs` reads **`50 decisions not yet named (newest DECISION-229)`**, with **69** feat/fix commits since the marker commit `2761de8` (the count shown equals `git log --format=%s 2761de8..HEAD | grep -cE '^(feat|fix)'` = 69, which includes the two `fix` commits of this loop-back).

## N1 — withDbRetry header

Header of `scripts/with-db-retry.test.mjs` replaced as specified; comment-only, `39 passed (39)`. **Phase 4 record correction:** commit `0f1dda2`'s body and Phase 3 Item 7b say "constraint errors" were retried by the old helper. They were not: the old helper tested only `message` and the `cause`'s message, and the Neon driver puts the class name in `name`, so a unique violation was never matched. Read the Failing-First line for that commit as: 32 failed because `isDbDrop` did not exist, and two behaviours were real fixes (statement timeout, bare "timeout"). History is not amended.

## N2 — gate residuals

Both reproduced against the live gate before anything was written: `decideHook` on `git push $(git commit -m x)` with a fresh marker returns `exit 0` (with no marker, `2`); `commandContainsGitPush` is `false` for `nice -n 5 git push`, `time -p git push` and `command -p git push`, and `decideHook` returns `exit 0` with no marker. Header: ACCEPTED RESIDUALS gained both, and the prefix sentence now says the prefixes are followed when they carry no flags of their own. **One precision beyond the amendment text:** `env` also skips bare flags (`env -i git push` is seen), and `env -u NAME` / `exec -a NAME` (flags with arguments) hide the push, so the header says "`env` also skips bare flags such as `-i`" and the residual lists those too. Tests: `commandContainsGitPush › accepted residuals` (the `$()` case, three flagged prefixes, and the unflagged-prefix control), each commented "remove this test only when the gate is changed to catch it". They pass on the unchanged gate by design; the reproduction above is the failing-first evidence. `80 passed (80)`.

## Gates

- `npm run typecheck`: clean. `npm run lint`: clean. `npm run check`: all eight tripwires pass.
- `npm test` (full): `549 passed | 77 skipped` files, `8566 passed | 2442 skipped` tests, 0 failed.
- The four changed files alone: `worktree-report` 54, `briefings-check` 25, `pre-push-gate` 80, `with-db-retry` 39 (198 total), all passing.
- `git diff --stat 0f9f3ee..HEAD` (before this docs commit) touches only `docs/briefings.md`, `docs/testing.md`, `scripts/briefings-check.test.mjs`, `scripts/pre-push-gate.mjs`, `scripts/pre-push-gate.test.mjs`, `scripts/with-db-retry.test.mjs`, `scripts/worktree-report.mjs`, `scripts/worktree-report.test.mjs`: 8 files, 664 insertions, 106 deletions. Nothing under `e2e/`, `playwright.config.ts`, `src/` or `scripts/ci/`, so the full chromium run is not required again. No server was started in this loop-back (no port used).

## Handoff

Next: qa (Phase 5, run 2) per the "Exact QA re-run scope" above, with the `presby-inc3` expectation corrected to `not merged`. Orchestrator at integration: Item 9 additions (TODO lines, DECISION-231 residual list) as the amendment states; the second `Phase 4 deviation 7` is superseded.
