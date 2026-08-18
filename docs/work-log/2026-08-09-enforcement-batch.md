# Enforcement Batch (Fable external review) — Work Log

> **Slug:** `2026-08-09-enforcement-batch`
> **Surface:** dev-loop tooling (CI, hooks, scripts, skills) — no app-code surface
> **Permission(s):** none — no app behavior change
> **Flag(s):** not needed
> **Estimated complexity:** medium (many small independent pieces)
> **Pipeline mode:** Accelerated, process-harvest style — Phases 1–3 satisfied by the external review itself (`docs/reviews/2026-08-09-fable-external-review.md` findings A1–A8, B1, C1, C4 are the functional refinement, architectural ruling, and design); implementation by main session inline. Phase 2 skip rationale: no new app dependencies, no schema change, no `src/` behavior change — additions are CI workflows, hook scripts, and skill-text edits. E4 of the same review recommends legitimizing this mode in the Classification table (tracked in TODO).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | Fable external review | Complete | READY FOR DESIGN (review findings) | 2026-08-09 |
| 2 — Architectural review | — | Skipped (no deps/schema/src behavior; notated above) | — | 2026-08-09 |
| 3 — Technical design | Fable external review (per-item Fix column) | Complete | — | 2026-08-09 |
| 4 — Implementation | main session (inline) | Complete | — | 2026-08-09 |
| 5 — Verification | main session (inline) | Complete | PASS | 2026-08-09 |
| 6 — Shipped vs intent | user (diff review at commit approval) | Complete | SHIP IT | 2026-08-09 |

---

# Scope (from review findings)

| Item | Finding | What ships |
|------|---------|-----------|
| 1 | A2, A4 | `ci.yml`: `check:audit` → `npm run check` (both tripwires); `npm audit --omit=dev` step |
| 2 | A3 | `ci.yml`: commit-grammar job validating PR commits via exported `validateCommitMessage()` |
| 3 | A8 | `.github/dependabot.yml` — npm weekly, github-actions monthly |
| 4 | A1 | `playwright.config.ts` `webServer` block; `.github/workflows/e2e.yml` on ephemeral Neon branch, secret-guarded (skips cleanly on forks without secrets) |
| 5 | A5 | `scripts/cadence-check.mjs` (harvested from huddleup.health) as third SessionStart hook |
| 6 | A6 | `/pre-push` writes a HEAD-keyed marker; `scripts/pre-push-gate.mjs` PreToolUse hook blocks `git push` without a fresh marker |
| 7 | A7 | Deck-staleness check added to the pre-push housekeeping sweep |
| 8 | B1 | `Work-Log:` trailer in commit grammar — format-validated whenever present, REQUIRED on `feat:`/`fix:` (Rule 8 means those classes always have a work-log); CLAUDE.md § Commit Message Standards updated |
| 9 | C4 | `AGENTS.md` portability shim at repo root |
| 10 | C1 | `.github/workflows/claude-review.yml` — opt-in (secret-gated) PR review, cost-conscious triggers (nonprofit budget) |

Out of scope (filed in `docs/TODO.md` Next Up / Backlog): instrumentation stub (D1), zod migration (D2), README deploy section (D3), template acceptance criteria (B2), pipeline-state hook (B3), process-efficiency batch (E1–E5), plugin packaging (C2), path-scoped rules (C3), ratchet/mutation testing (C5).

---

# Phase 4 — Implementation

## Files Created

- `.github/dependabot.yml` — npm weekly + github-actions monthly update PRs
- `.github/workflows/e2e.yml` — Playwright on an ephemeral Neon branch; secret-guarded
- `.github/workflows/claude-review.yml` — opt-in claude-code-action PR review
- `scripts/cadence-check.mjs` — SessionStart hook computing overdue reviews from `docs/reviews/log.md`
- `scripts/pre-push-gate.mjs` — PreToolUse hook gating `git push` on a fresh `/pre-push` marker
- `AGENTS.md` — cross-tool shim pointing at CLAUDE.md

## Files Modified

- `.github/workflows/ci.yml` — `npm run check`, `npm audit`, commit-grammar job
- `playwright.config.ts` — `webServer` block (CI reuse-safe)
- `scripts/commit-msg.mjs` + `scripts/commit-msg.test.mjs` — `Work-Log:` trailer validation
- `.claude/settings.json` — cadence-check SessionStart hook + PreToolUse push gate
- `.claude/skills/pre-push/SKILL.md` — marker write on success + deck-staleness housekeeping check
- `.gitignore` — pre-push marker file

## Schema Changes

- none

## Audit Events

- n/a — no app mutations

## Implementer Notes

- **Two push-gate false positives were caught live during this session** — worth preserving as a case study in mechanizing rules:
  1. The first matcher (substring scan for `git … push`) blocked a command that merely *mentioned* "git push" inside an `echo` string — the hook fired on its own smoke test.
  2. The second matcher (`\bpush\b` on segments) would have blocked `git commit -m "… pre-push …"` — hyphen is a word boundary, so any commit message naming the gate would trip it, including this batch's own commit.
  Final design tokenizes each shell segment and requires `git` at command position with `push` as the resolved subcommand. Residual accepted FP: quote-naive splitting means a quoted string containing `&& git push` still blocks (fails closed, clear message).
- `npm audit` in CI is scoped `--omit=dev --audit-level=high` — the known moderate dev-only findings (esbuild/drizzle-kit, per the 2026-07-11 dependencies review) must not perma-fail CI; `/pre-push` Step 7b keeps the broader moderate-level advisory view.
- dependabot ignores semver-major and `next-auth` entirely — the pinned beta line is a judgment call owned by the monthly dependencies review, not an auto-PR.
- e2e workflow generates ALL credentials per-run (openssl rand) against a branch deleted in `always()` — no live secrets beyond `NEON_API_KEY`/`NEON_PROJECT_ID`.
- `validateCommitMessage` now checks `Work-Log:` before `Caught-By:`/`Discovered-In:` — a bare `fix:` errors on Work-Log first (tests updated accordingly).
- Historical commits don't carry `Work-Log:`; the CI grammar job validates PR ranges only, so history is unaffected.
- New scripts use `fileURLToPath` (not `URL.pathname`) per review D5's Windows note.

---

# Phase 5 — Verification (main session, inline)

**Date:** 2026-08-09

- `npm run typecheck`: PASS
- `npm test`: PASS — 36 files, 425 tests (was 35/414 pre-batch; +11 new: commit-msg Work-Log cases + pre-push-gate matcher suite)
- `npm run check`: PASS (both tripwires)
- Push-gate hook: 10/10 behavioral cases (real/flagged/compound/`-C` pushes blocked; status/echo/grep/`--grep=push`/commit-msg-mentioning-pre-push/malformed-payload pass through) — plus one live in-session firing that blocked a real Bash call as designed
- `scripts/cadence-check.mjs` live run: correctly reports test-coverage 25d overdue, retrospective 15d overdue
- `scripts/validate-commit-range.mjs` live run on `HEAD~1..HEAD`: correctly fails the historical `feat(dx)` commit for its missing `Work-Log:` trailer (expected — CI applies to new PR ranges only)
- Feature-gate audit: no protected routes touched (no `src/` app-code changes)
- **Residual risk:** `e2e.yml` and `claude-review.yml` are YAML-reviewed but cannot execute until pushed with secrets configured — first live run should be watched. Neon action versions (`create-branch-action@v5`, `delete-branch-action@v3`) to be confirmed on first run.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (user)

## VERDICT

SHIP IT — user approved the batch and its commit plan on 2026-08-09 after reviewing the summary against the review's Top-Five list. Status row closed at commit time (per review E4 guidance). Residual risk tracked in TODO: first live run of `e2e.yml`/`claude-review.yml` needs secrets and observation.
