# Pre-Push Gate Was Blind to Which Repo It Was Gating — Work Log

> **Slug:** `2026-08-26-pre-push-gate-target-repo`
> **Surface:** tooling — `scripts/pre-push-gate.mjs` (the PreToolUse hook that blocks `git push` without a fresh `/pre-push` stamp)
> **Permission(s)/Flag(s):** none — dev tooling, not app code
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant, brief (self-contained scripts + test change, no app-facing behavior, no schema/permission/flag surface)

---

## Bug

`currentHead()` always resolved presby's own `REPO_ROOT`'s `HEAD`, regardless of what repository the actual `git push` command targeted. Discovered when pushing to `scratch/presby-site-kit` and `scratch/site-fpcw` — separately-owned, gitignored, external repos worked on in this same session (`docs/STATE.md`'s fpcw recreation work) — and getting a stale-marker rejection about presby's own HEAD, which has nothing to do with those repos' own commit history or the freshness of their own `/pre-push`-equivalent state (they don't even use this hook's marker file).

## Root cause

The hook has no concept of "which repo is this push actually for." It parses the `git push` command for safety purposes but never resolved the working directory the command would actually execute in — `cd`/`git -C` in the shell command line, or the hook's own `cwd` payload — before deciding whether to gate.

## Fix

`resolvePushTargetRepoRoot(command, cwd)`: walks `cd` and `git -C` occurrences in the shell command to resolve the actual target directory, then walks up to that directory's real git root. The hook now only gates when this resolves to presby's own `REPO_ROOT` — a push aimed anywhere else (a scratch/ sub-repo, or any other repo worked on from within a `cd`'d subshell) passes through untouched. Resolution failure (nonexistent path, git not found) still gates conservatively rather than silently passing.

Six new tests in `scripts/pre-push-gate.test.mjs`: same-repo (still gates), a push from a subdirectory of presby (still gates), `cd`-into-an-unrelated-repo-then-push (does NOT gate), an inline `git -C <other-repo> push` (does NOT gate), a nonexistent path (gates — fail closed), and a command with no `push` in it at all (no-op).

## Verification

`npx vitest run scripts/pre-push-gate.test.mjs` — 17/17 pass (11 pre-existing + 6 new). Live-verified this session: `git -C scratch/presby-site-kit push origin main` succeeded after the fix, where it had been rejected before.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1–3 | — | Skipped | Trivial bug-fix variant — self-contained scripts/tests, no app surface, no invariant touched | 2026-08-26 |
| 4 | (implemented inline) | Complete | Fix + 6 regression tests | 2026-08-26 |
| 5 | (self-verified) | Complete | 17/17 pass, live-verified against a real scratch-repo push | 2026-08-26 |
| 6 | — | N/A | Dev tooling, not a user-facing feature | — |
