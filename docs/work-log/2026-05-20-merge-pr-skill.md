# `/merge-pr` skill — Work Log

> **Slug:** `2026-05-20-merge-pr-skill`
> **Surface:** instructions + a new skill (`.claude/skills/merge-pr/SKILL.md`) + one Workflow Rule in `CLAUDE.md`
> **Roles:** all contributors (anyone running `gh pr merge`)
> **Estimated complexity:** small
> **Pipeline mode:** Polish-lane — instruction-layer addition. Phase 2 skipped (no deps, no schema, no application code). Phase 3 collapsed into the skill design. Ported from the npvitals fork.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (collapsed) | Complete | READY — motivated by a real failure in the downstream npvitals fork on 2026-05-20 | 2026-05-20 |
| 2 — Architectural review | architect | Skipped | Instructions only | 2026-05-20 |
| 3 — Technical design | tech-lead (collapsed) | Complete | Skill body below | 2026-05-20 |
| 4 — Implementation | this PR | In progress | — | 2026-05-20 |
| 5 — Verification | qa | Pending — manual trace through the documented procedure | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Stack note:** This PR is stacked on `feat/classification-blocked-gate` (the Classification + BLOCKED gate port from the same downstream session). Workflow Rule 8 lands in that PR; this PR adds Rule 9. Merge order: that PR first.

---

## Phase 1 — The problem (downstream, npvitals fork)

In a single 2026-05-20 session, the npvitals fork merged 8 PRs across multiple stacks. Twice during that sequence, merging a base PR with `gh pr merge N --delete-branch` auto-closed the downstream PRs whose `baseRefName` pointed at the just-deleted branch. Each recovery required:

1. Push the deleted branch back to origin (`git push origin <sha>:refs/heads/<branch>`).
2. Reopen the closed PR (`gh pr reopen N`).
3. Retarget its base to `main` (`gh api repos/.../pulls/N -X PATCH -f base=main`).
4. Wait a beat for GitHub to recompute mergeability.
5. Merge.

A 5-step recovery for what should have been a single command. The fix is to retarget *before* the merge instead of after — and the safest way to remember that is to encode it as a skill.

The starter ships with `gh pr merge` mentioned implicitly via the `/pre-push` skill; nothing in the existing skill set guards against the auto-close trap. Adding `/merge-pr` to the starter means every fork inherits the safety net without re-learning the trap.

## Phase 3 — Design

**Skill name:** `/merge-pr` (singular — invoke once per PR you're about to merge).

**Inputs:** PR number.

**Behaviour:**
1. Look up the PR's `headRefName`.
2. Query for open PRs whose `baseRefName` equals that branch (`gh pr list --base <branch> --state open --json number,title`).
3. For each dependent PR, retarget its base to `main` via `gh api repos/{owner}/{repo}/pulls/<N> -X PATCH -f base=main --silent`. `{owner}` / `{repo}` are auto-substituted by `gh` from the current repo context — no hardcoded org/repo strings.
4. Merge the original PR with `gh pr merge <N> --merge --delete-branch`.
5. Verify state.

**Defaults:**
- Merge method: `--merge` (matches the starter's existing pattern of `Merge pull request #N from ...`).
- `--delete-branch`: enabled by default (the whole purpose of the safe-retarget dance).

**Override knobs:** the skill body documents how to swap merge method (`--squash` / `--rebase`) if needed.

**Workflow Rule 9:** a one-paragraph rule in `CLAUDE.md` Workflow Rules section pointing at the skill so it's discoverable.

## Out of scope

- A bulk `/merge-stack` that walks the chain from bottom to top automatically. The granular `/merge-pr` is composable — call it N times for a stack of N. Filed as a follow-up if the granular one proves tedious.
- Automated handling of merge conflicts in retargeted PRs. If a retarget produces a conflict, the skill surfaces it and stops — the user resolves and re-runs.
- Retargeting to a non-main destination. The skill always retargets to `main`. If a fork uses a different default branch, the skill would need a parameter.
- Recovery from already-closed PRs (the manual 5-step dance the downstream session went through). The skill *prevents* the trap; it doesn't *recover* from it.
- Configuring GitHub's repo-level "auto-delete head branches" setting (which is independent of `--delete-branch` and doesn't affect the trap mechanic).

---

## Phase 4 — Implementation

(In progress this PR.)

## Phase 5 — Verification

No live PRs to test against on this branch (in the upstream starter). The downstream fork already dogfooded this same skill to merge its own version safely. Verification on the upstream port is by trace:

- Skill body is internally consistent (each step's output is the next step's input).
- `gh api repos/{owner}/{repo}/pulls/N` substitution syntax verified against `gh api --help`.
- `gh pr list --base BRANCH --state open` confirmed via `gh pr list --help`.
- Defaults match the starter's existing merge convention (look at any `Merge pull request #N from ...` commit on `main`).

## Phase 6 — Shipped vs Intent

(Pending PR merge.)
