---
name: downstream-sync
description: The mirror of upstream-sync. Surface changes THIS fork has made that are starter-generic (reusable by any fork) and produce a classified punch-list of backport candidates for the canonical starter — new skills/agents, workflow/process strengthenings, reusable features, and structural ideas. Never opens a PR itself; produces a review artifact the owner acts on. The canonical starter detects itself and exits immediately (N/A — skill is for forks).
---

# Downstream Sync

When the user invokes `/downstream-sync`, do the reverse of `/upstream-sync`: instead of
"what did the starter ship that I should pull," answer **"what have I built that the starter
should adopt."** Walk this fork's *starter-generic* surfaces, compare them against the canonical
starter, classify each divergence, and produce a punch-list of backport candidates. This skill
**never opens a PR and never pushes** — it produces the review artifact; the owner decides what to
contribute.

Direction: **fork → canonical starter** (`https://github.com/chenson42/claudecode-nextjs-starter`).

**Pairing with `/upstream-sync`.** The two skills are mirrors. `/upstream-sync` runs every 14 days
to pull starter improvements INTO this fork. `/downstream-sync` runs every 30 days (or after shipping
generic tooling) to surface fork improvements that should flow BACK to the starter. Together they
close the two-way contribution loop that a fork-and-go architecture depends on.

**Why this exists.** Forks accrete genuinely reusable improvements — new skills, new agents,
hardened workflow rules, reusable subsystems — that would benefit *every* fork if they flowed back.
Without a deliberate pass they never do, because the day-to-day incentive is always app-forward.
This is the deliberate pass. (It is itself a backport candidate: a starter that ships
`downstream-sync` teaches every fork to contribute back.)

---

## When to Invoke

- On a rolling cadence (suggested **30 days**), logged as `downstream-sync` in `docs/reviews/log.md`.
- After shipping generic tooling / infra / process improvements.
- Any time the owner asks "what could we contribute back to the starter?"
- Immediately useful right after a retrospective that flagged "starter-upstream candidates."

---

## Known Untested Paths (read this first)

Ported from a derived fork (huddleup.health) where it was proven against a real project; the port
strips monorepo path-mapping and product-specific seed values. Not yet exercised against a real
fork ↔ canonical pair from this codebase: the `gh api .../contents/.claude/skills` diffing calls,
the classification heuristic on real divergences, the punch-list/contribution-kit rendering, and
the state-file update from a flat-layout fork. **If you are the first fork-owner running this
skill, you are the first real test** — if something fails, open an issue at
`github.com/chenson42/claudecode-nextjs-starter`.

---

## Pre-flight Checks

Run all three before doing any work. Exit cleanly on any failure — do NOT write a log entry for a
failed run.

### Check 1 — Canonical self-detection

```bash
git remote get-url origin 2>/dev/null
```

Strip a trailing `.git` from the result. Compare to:

```
CANONICAL_URL = "https://github.com/chenson42/claudecode-nextjs-starter"
```

If `origin` matches, print:

> `downstream-sync: this IS the canonical starter — this skill is for forks, not the canonical repo (N/A).`

Stop here. Do not write a log entry. Do not write or read the state file.

### Check 2 — Tooling

```bash
command -v gh >/dev/null 2>&1 && gh auth status
```

`gh` is **required** — the skill diffs the fork against the starter via the GitHub API (there may be
no shared git history to `git diff` against for a scaffolded copy). If `gh` is unavailable, go to
**Failure mode A**.

### Check 3 — State file

Read `.claude/downstream-state.json` (schema in the **State File Schema** section below). If
missing or unparseable, go to **Step 1 — First-Run Bootstrap**. Otherwise extract `starterUrl`,
`lastCheckedDate`, `proposed` (paths already surfaced/handled), and `appSpecificPaths` (the
skip-list). Proceed to **Step 2**.

---

## Step 1 — First-Run Bootstrap

Print `No .claude/downstream-state.json found. Running first-time setup.`

Write `.claude/downstream-state.json`:

```json
{
  "starterUrl": "https://github.com/chenson42/claudecode-nextjs-starter",
  "lastCheckedDate": "<today YYYY-MM-DD>",
  "proposed": [],
  "appSpecificPaths": []
}
```

`appSpecificPaths` is the skip-list of product-specific paths that should never surface as backport
candidates. Seed it with your app's product surfaces right after first run — for example:

```json
"appSpecificPaths": [
  "src/app/(app)/",
  "src/lib/<your-product>/",
  "src/lib/<your-domain>/"
]
```

The list is intentionally empty at bootstrap so nothing is silently dropped on the first run;
the owner extends it as the product grows.

---

## Step 2 — Enumerate Candidate Surfaces

Walk ONLY the starter-generic surfaces of the fork (never the product surfaces in
`appSpecificPaths`). For each surface, fetch the canonical starter's equivalent via `gh api` and
diff.

**Path note for flat-layout forks.** The canonical starter is single-root (`src/`, `.claude/`,
`docs/` all at repo root). A fork that is also single-root has no path remapping — fork paths and
starter paths are identical. If your fork restructured the layout (e.g. added a `web/` subdirectory
or a monorepo root), you must mentally map your fork paths to starter paths before classifying;
document your mapping at the top of the generated punch-list.

Starter-generic surfaces, by category:

1. **Skills** — `.claude/skills/*/`. A skill the fork has that the starter lacks is a candidate
   (fetch the starter's list via
   `gh api repos/chenson42/claudecode-nextjs-starter/contents/.claude/skills --jq '.[].name'`).
   A skill that exists in both but diverged is a potential improvement.

2. **Agents** — `.claude/agents/*.md`. Same fetch pattern
   (`gh api repos/chenson42/claudecode-nextjs-starter/contents/.claude/agents --jq '.[].name'`).
   New agents are candidates; modified agents may contain hardened guidance worth backporting.

3. **Workflow / process** — `CLAUDE.md`. The *generic* sections (Development Pipeline, Workflow
   Rules, Periodic Reviews, phase gates, Key Invariants that are not product-specific). Diff
   against the starter's `CLAUDE.md` via
   `gh api repos/chenson42/claudecode-nextjs-starter/contents/CLAUDE.md --jq '.content' | base64 -d`.
   Flag hardened rules (new phase gates, new workflow rules, QA gates, session-start cadence
   additions) as `needs-generalization` if they reference product copy, `backport-ready` if they
   are already generic.

4. **Generic infra** — `src/lib/` (auth helpers, rate-limit, permissions, flags, db plumbing,
   generic utilities), `src/proxy.ts`, `e2e/`, `playwright.config.ts`, `.github/workflows/`,
   root config (`tsconfig.json`, `.eslintrc*`, `next.config.*`, `package.json` scripts). Diff
   against canonical equivalents. A new generic helper or a hardened config value is a candidate.

5. **Reusable features** — subsystems any app would want that are cleanly separable (e.g. a
   changelog/what's-new system, a notifications spine, a structured audit-log viewer). These span
   schema + API + UI + admin, so they are `needs-generalization` proposals, not direct drops.

Cap at 50 candidate files per run (same as upstream-sync). If there are more, note the truncation
and process the first 50 — the next run catches the rest.

---

## Step 3 — Classify Each Candidate

First match wins.

| Class | Signal |
|-------|--------|
| `structural-proposal` | Not a file drop — an architecture idea spanning many files or a whole tree (a monorepo split, a multi-file subsystem, a new subdomain). Review as a unit. |
| `backport-ready` | A NEW generic file/skill/agent addable upstream nearly as-is; only repo-name / product-name references need stripping. |
| `needs-generalization` | Generic value but entangled with app-specific code (imports product modules, references product tables/routes, hardcodes product copy). Must be extracted/generalized first. |
| `skip` | Path is under `appSpecificPaths`, or the change is pure product logic with no reusable kernel. |

For every non-`skip` candidate, record **what must be stripped or generalized** before it can go
upstream (repo URL, product names, product-specific imports, hardcoded copy).

---

## Step 4 — Build the Punch-List

Output the punch-list as Markdown before writing anything to disk. Show it to the user.

```markdown
## Downstream Sync Punch-list — YYYY-MM-DD
Starter: https://github.com/chenson42/claudecode-nextjs-starter
Last checked: <lastCheckedDate>

| # | Candidate | Fork path | Starter path | Class | Strip / generalize | Notes |
|---|-----------|-----------|--------------|---------|--------------------|-------|
| 1 | downstream-sync skill | `.claude/skills/downstream-sync/` | `.claude/skills/downstream-sync/` | backport-ready | none (repo-agnostic) | the tool itself |
| 2 | New workflow rule N | `CLAUDE.md` | `CLAUDE.md` | needs-generalization | strip product references | strengthened phase gate |
| 3 | Generic rate-limit helper | `src/lib/rate-limit-<variant>.ts` | `src/lib/rate-limit-<variant>.ts` | backport-ready | remove product import | useful to every fork |
| 4 | Reusable notification system | `src/app/(notifications)/` (+ schema) | `src/app/(notifications)/` | needs-generalization | strip domain copy; keep spine | any app wants this |
```

**If nothing has changed** (nothing generic diverged since `lastCheckedDate`): print

> `Nothing new to contribute since <lastCheckedDate>. Log entry written.`

and go directly to Step 6.

---

## Step 5 — Author the Contribution Kit

The highest-value contribution is NOT a raw code drop — it is a set of **implementation specs the
starter's own Claude can run through and build itself.** The starter is a different repo with its own
conventions; a spec it can execute travels better than a patch that assumes this fork's layout.

For each non-`skip` candidate, author a self-contained spec:

**`docs/starter-contributions/README.md`** — an index: the candidate table from Step 4, a suggested
PR order (backport-ready first, then needs-generalization, then structural-proposal), and a note that
these are proposals for `chenson42/claudecode-nextjs-starter`, authored by and battle-tested in this
fork.

**`docs/starter-contributions/NN-<slug>.md`** — one spec per candidate, structured as:

- **Origin** — name this fork and the file(s) / DECISION / work-log / retro where the improvement
  was proven, and the concrete problem it solved (e.g. "prevented a production escape on
  YYYY-MM-DD"). Credit travels; it also gives the starter's Claude context to judge fit.
- **What & why** — the generic problem any fork hits, and the fix.
- **Applies to the starter as** — the mapped target paths in the starter and what to STRIP (product
  names / copies / imports).
- **Implementation steps** — numbered, executable by the starter's Claude: files to add/edit, the
  exact tripwire/npm-script/CI wiring, schema/migration if any, the docs/CLAUDE.md paragraph to add.
- **Verification** — how the starter confirms it works (a Vitest test, a check script, a Playwright
  e2e, a `tsc --noEmit`).
- **Classification + risk** — backport-ready / needs-generalization / structural-proposal; blast radius.

Only if the owner explicitly asks, additionally draft a branch in a starter clone applying the
`backport-ready` specs. Otherwise the kit (the specs) IS the deliverable — the owner opens a PR
pointing the starter at `docs/starter-contributions/`, or copies the specs into starter issues.

**Never push, never open a PR unprompted.** `needs-generalization` and `structural-proposal` items
ship as specs only — never auto-applied.

---

## Step 6 — Log Results

Append one line to `docs/reviews/log.md` (newest-first, same format as all other reviews):

```
YYYY-MM-DD | downstream-sync | N candidates (X backport-ready, Y needs-generalization, Z structural)
```

or, for an empty run:

```
YYYY-MM-DD | downstream-sync | nothing new to contribute
```

For N > 0, also write `docs/reviews/YYYY-MM-DD-downstream-sync.md` with the full punch-list.

Update `.claude/downstream-state.json`: set `lastCheckedDate` to today; append handled paths to
`proposed` so they do not re-surface every run (an item stays out until it diverges again).

**On any failure before Step 2: write NOTHING.**

---

## Failure Modes

**Mode A — No `gh`:**

> `Cannot diff against the starter. Install and authenticate the GitHub CLI (gh), then retry /downstream-sync.`

**Mode B — GitHub API unreachable:**

> `GitHub API unreachable (HTTP <status> or network error). No log entry written. Retry when the network is available.`

---

## State File Schema

`.claude/downstream-state.json` — committed to the fork's repo (not gitignored).

```json
{
  "starterUrl": "https://github.com/chenson42/claudecode-nextjs-starter",
  "lastCheckedDate": "YYYY-MM-DD",
  "proposed": ["<fork paths already surfaced and handled>"],
  "appSpecificPaths": ["<product surfaces to always skip — extend as the product grows>"]
}
```

The file is written by this skill (Step 1 for first-run, Step 6 for updates). It is never written on
a failed run.

---

## Output Summary

| Outcome | Log entry written | State file updated | Detail file written |
|---------|-------------------|--------------------|---------------------|
| Canonical repo (self-detection) | No | No | No |
| Tooling failure (no gh) | No | No | No |
| Candidates found | Yes | Yes | Yes |
| Nothing new since last check | Yes | Yes (date) | No |
| Any failure before Step 2 | No | No | No |
