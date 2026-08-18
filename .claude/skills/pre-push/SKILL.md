---
name: pre-push
description: Run pre-push verification — typecheck, build, schema/migration check, release notes, and a quick housekeeping sweep — before pushing to main
---

# Pre-Push Checks

When the user invokes `/pre-push`, run every verification step required before pushing to `main`. This skill never pushes — it only reports readiness.

## Step 0: Check for Open Test File (HARD STOP)

Before doing anything else, check whether an open pre-merge test file exists:

```bash
ls docs/pre-merge-tests-v*.md 2>/dev/null && echo "EXISTS" || echo "CLEAR"
```

If any such file exists: **STOP immediately.** Do not proceed to any further steps. Tell the user which file was found:

> `docs/pre-merge-tests-vX.Y.Z.md` is still open. Run `/test-results` to record the test results and close the file before pushing.

Only continue to Step 1 if no file is found.

## Step 1: Snapshot the Current State

Run, in parallel:

- `git status`
- `git log --oneline -10`
- `git branch --show-current`

Confirm:

- What branch we're on.
- What's staged and unstaged.
- What commits will be in the push.

**If there are uncommitted changes:** STOP. Ask the user whether to commit them first or abort.

## Step 2: Sync with `main` (if on a feature branch)

```bash
git fetch origin main
git log HEAD..origin/main --oneline
```

If `main` has new commits, ask the user whether to merge before continuing. Don't merge unilaterally — branch sync is an explicit user choice.

## Step 3: Type Check

```bash
npm run typecheck
```

`tsc --noEmit` runs against the same config the build uses. If it fails:

- Show the error output.
- Identify the failing file(s) and error type.
- Offer to fix the issues.

**Do not proceed if typecheck fails.**

## Step 3b: Audit-Coverage Tripwire

```bash
npm run check:audit
```

`scripts/check-audit-coverage.mjs` walks every `actions.ts` under `src/app/`, grep-lints for `db.insert/update/delete` without a corresponding `auditEvents` row, and fails if a security-sensitive mutation is missing its audit write. Add the `auditEvents` insert, or — if the mutation is genuinely not security-relevant — annotate the line above with `// audit-exempt: <reason>`.

**Do not proceed if the audit-coverage check fails.**

## Step 3c: sql<Date> Tripwire

```bash
npm run check:sql-date
```

`scripts/check-sql-date.mjs` walks every `.ts` and `.tsx` under `src/` and fails
if it finds `sql<Date` without an annotation. The Neon serverless driver returns
timestamps from computed expressions (COALESCE, date_trunc, etc.) as strings at
runtime — `sql<Date>` is a compile-time lie that TypeScript cannot detect. Fix by:
selecting real column(s) and converting in JS, using `.mapWith(Date)`, or annotating
with `// sql-date-ok: <reason>` when the expression is used only in WHERE/ORDER and
is never selected/returned to JS.

**Do not proceed if the sql-date check fails.**

## Step 3d: Unit Tests

```bash
npm test
```

Vitest runs every `*.test.ts` under `src/`. If a test fails, fix it before pushing — a broken test in the starter teaches every fork to ignore tests.

**Do not proceed if any test fails.**

## Step 4: Production Build

```bash
npm run build
```

`next build` does its own type pass and catches things `tsc --noEmit` alone won't (the Next.js plugin, route inference, etc.). If the build fails:

- Show the failing route or module.
- Offer to fix.

**Do not proceed if the build fails.**

## Step 5: Schema and Migration Check

The starter uses Drizzle Kit. `src/lib/db/schema.ts` is the source of truth.

1. Check whether `schema.ts` has changed since `main`:
   ```bash
   git diff main -- src/lib/db/schema.ts
   ```
2. If yes, check whether a corresponding generated migration is committed under `drizzle/`:
   ```bash
   git status drizzle/ | head
   git diff main -- drizzle/ | head -40
   ```
3. If the schema changed but no migration was generated, ask the user whether they intended to:
   - Use `npm run db:push` (no migration file, applied directly) — fine for early development on a Neon branch.
   - Run `npm run db:generate` to produce a committed migration — required if forks of the starter need to replay the change.

If the seed (`scripts/seed.ts`) changed, suggest running `npm run db:seed` against a fresh Neon branch to verify it still applies cleanly.

## Step 6: Release Notes and Version Bump

**Required before every push to `main`.**

1. Read `package.json` to see the current version.
2. Read the most recent `docs/release-notes/vX.Y.md` to see the latest entry.
3. Run `git log origin/main..HEAD --oneline` to list the commits being pushed.
4. Invoke `/release-notes` to write or extend the entry and bump `package.json`.
5. Commit the release-notes change so it goes out with the push.

**Documentation-only changes don't need a version bump.** Bug fixes get a PATCH bump. New features get a MINOR. Breaking changes get a MAJOR.

## Step 7: Housekeeping Sweep

Treat these as advisory warnings, not hard blockers (unless the user decides otherwise):

- **`docs/TODO.md` reconciled?** (Workflow Rule 10.) If the outgoing commits ship, defer, or discover work, the corresponding TODO lines must move/appear in those same commits:
  ```bash
  git diff main...HEAD --name-only | grep -q "docs/TODO.md" || echo "WARN: no TODO.md change in this branch — verify nothing shipped/deferred/discovered"
  ```
- **New environment variables?** Documented in `CLAUDE.md` (and `.env.example` if present)?
- **New tables or columns?** Defined in `src/lib/db/schema.ts`?
- **New routes or actions?** Auth + feature gate present on every protected entry?
- **No stray debug logs?**
  ```bash
  grep -r "console.log" src/ --include="*.ts" --include="*.tsx" | grep -v "// " | head -10
  ```
- **No native browser dialogs?**
  ```bash
  grep -rE "alert\(|confirm\(|prompt\(" src/ --include="*.ts" --include="*.tsx"
  ```
- **No env files staged?**
  ```bash
  git diff --name-only | grep -E "\.env"
  ```
- **Deck re-rendered?** If `deck/slides.md` changed in this branch, `deck/slides.pdf` must change with it (CLAUDE.md → "Re-render the deck"):
  ```bash
  git diff main...HEAD --name-only | grep -q "deck/slides.md" && { git diff main...HEAD --name-only | grep -q "deck/slides.pdf" || echo "WARN: deck/slides.md changed but slides.pdf was not re-rendered — run npm run deck and commit the PDF"; }
  ```

## Step 7b: Dependency CVE Audit

```bash
npm audit --audit-level=moderate
```

Severity gate:
- **PASS** — no vulnerabilities, or `info`-level only.
- **WARN** — `moderate` vulnerabilities only; list the advisory IDs as informational. Not a hard blocker, but surface them in the summary so the user can decide.
- **FAIL** — one or more `high` or `critical` vulnerabilities; list the advisory IDs and ask the user whether to block the push.

If `npm audit` times out or the registry is unreachable, record `WARN (registry unreachable)` and continue — don't let a transient network failure block a clean push.

## Step 8: Summary

Report results:

- Type check: PASS / FAIL
- Production build: PASS / FAIL
- Schema and migrations: in sync / pending (with details)
- Release notes + version: updated / missing
- Dependency CVE audit: PASS / WARN / FAIL (advisory IDs if any)
- Housekeeping warnings: list them
- **Ready to push? yes / no**
- If no: list each item that must be resolved first

**If (and only if) the answer is yes**, stamp the pre-push marker so the push gate opens:

```bash
node scripts/pre-push-gate.mjs --stamp
```

A PreToolUse hook (`scripts/pre-push-gate.mjs`, registered in `.claude/settings.json`) blocks any in-session `git push` unless this marker exists and matches the current HEAD — committing anything after the stamp invalidates it, so re-run `/pre-push` after late commits (Workflow Rule 5, mechanized).

**Do not push.** The user pushes manually.
