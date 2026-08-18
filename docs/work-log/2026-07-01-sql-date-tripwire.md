# check:sql-date tripwire — Work Log

> **Slug:** `2026-07-01-sql-date-tripwire`
> **Surface:** scripts/ + package.json (+ pre-push skill wiring)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small — phases expected brief)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-01 |
| 2 — Architectural review | architect | Complete | Approved | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-01 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Port huddleup's `check-sql-date.mjs` static tripwire into the starter as `scripts/check-sql-date.mjs`, wire it as `npm run check:sql-date` in `package.json`, and add it as Step 3c in the pre-push skill (unit tests become 3d). The starter currently has zero `sql<Date>` occurrences, so the scan is a clean no-op on install. The email-queue's raw-SQL claim pattern (`db.execute(sql\`...\`)` + `RawQueueRow` typed as strings + `fromRaw()` mapper) is safe and will NOT false-positive — it is the recommended pattern the tripwire protects.

**Verdict:** READY WITH NOTES

**One-line take:** A tight static scan that catches a real class of runtime crash; the starter has no current violations and the one borderline pattern (email-queue raw SQL) is already correct and won't be flagged.

### What I did

#### Pass 1 — User Verbs

Surface: developer tooling (no end-user surface).

- Developer runs `npm run check:sql-date` (directly or via pre-push)
- Developer reads "sql<Date> guard passed." (exit 0) or a violation report with file:line, explanation, and fix options (exit 1)
- Developer adds `// sql-date-ok: <reason>` to suppress a known-safe occurrence

No anonymous visitor, member, or admin flows. This feature has no UI surface.

#### Pass 2 — Flow Audit

**Happy path:** `npm run check:sql-date` → walks `src/**/*.{ts,tsx}` → no `sql<Date` pattern found → prints "sql<Date> guard passed." → exit 0.

**Violation path:** scan finds `sql<Date` on a non-comment line with no `// sql-date-ok:` annotation on that line or the line above → prints file:line + offending text + explanation + three fix options → exit 1. Pre-push stops at Step 3c; developer must fix before proceeding.

**Escape-hatch path:** developer knows the expression is WHERE/ORDER-only and never selected/returned → adds `// sql-date-ok: SQL-side only (WHERE/ORDER); never selected/returned to JS` on the same line or the line directly above → scan passes.

No failure microcopy gaps: the violation output is self-explanatory (file, line, why it matters, three fix options).

#### Pass 3 — Permissions and Flags

No permission entry in FEATURES. No feature flag needed. This is a developer-tool script; it does not touch the runtime permission or flag system.

#### Pass 4 — Current codebase scan results (the key deliverable)

Scanned `src/**/*.{ts,tsx}` for `sql<` patterns:

| File | Pattern | Would tripwire fire? | Assessment |
|------|---------|---------------------|------------|
| `src/app/(admin)/admin/users/page.tsx:25` | `sql<number>\`count(*)::int\`` | No — regex is `/sql<\s*Date\b/`; `number` does not match | Safe. `::int` cast returns a Postgres integer; the `Number()` wrapper on line 28 is redundant but harmless. No annotation needed. |
| `src/lib/email/queue.ts:243` | `db.execute(sql\`...CTE...\`)` — no generic | No — no `<Date>` type parameter at all | Safe. `RawQueueRow` types all timestamp fields as `string \| null`. `fromRaw()` calls `new Date(string)`. This IS the correct pattern; the tripwire exists precisely to ban the alternative (`sql<Date>` on the raw execute). |
| `src/app/(member)/feedback/actions.ts:169,244,284` | `sql\`excluded.*\`` — no generic | No | Safe (upsert conflict resolution, no type parameter). |
| `src/app/(admin)/admin/flags/actions.ts:24` | `sql\`now()\`` — no generic | No | Safe (timestamp default in SET clause, no type parameter). |
| `src/lib/db/schema.ts:204` | `sql\`'{}'::jsonb\`` — no generic | No | Safe (column default, no type parameter). |

**Result: zero current violations. The tripwire is a clean no-op on the existing codebase.**

#### Pass 5 — Adversarial pass

- **Escape-hatch abuse:** A developer could annotate every `sql<Date>` violation with `// sql-date-ok:` and write anything after the colon. Mitigation: the 30-day security review is the backstop (same pattern as `// audit-exempt:`). The required reason string documents the decision.
- **Comment-only-line bypass:** A JSDoc block that mentions `sql<Date>` would be skipped (correct behavior). The `line.trim().startsWith("//")` guard handles this. Multiline `/* */` comments are NOT explicitly handled — a `sql<Date>` inside a `/* */` block would be flagged. This is acceptable (conservative) behavior.
- **Type alias bypass:** `type MyDate = Date; sql<MyDate>` — NOT caught. This is a known gap in the huddleup reference implementation as well; the script is a tripwire, not a proof. Acceptable.
- **Test file false positives:** If a Vitest test constructs a `sql<Date>` expression to test the query layer, the tripwire fires on test files too (they're under `src/`). Escape hatch handles it.

### Outputs

- Work-log updated (this section)
- `docs/TODO.md` — `check:sql-date` entry moved from Backlog to In Flight (see below)

### Open questions / handoff notes

Notes for tech-lead (Phase 3):

1. **Pre-push step numbering.** Current pre-push SKILL.md steps: 3 (typecheck), 3b (audit tripwire), 3c (unit tests), 4 (build). The new tripwire slots as **Step 3c** alongside the audit tripwire; current 3c (unit tests) becomes **Step 3d**. Confirm this renaming before editing the skill file.

2. **Scan scope.** The huddleup reference scans only `src/`. The starter also has `e2e/` (Playwright tests, TypeScript). Playwright tests do not use Drizzle's `sql<>` tag; scanning `e2e/` adds noise risk for no gain. Recommendation: scope to `src/` only, matching the reference.

3. **Script root resolution.** The huddleup script uses `path.resolve(new URL("..", import.meta.url).pathname)` to get the repo root from `scripts/` parent. This works correctly in the starter's identical layout — verify during implementation.

4. **The `sql<number>` occurrence.** `src/app/(admin)/admin/users/page.tsx:25` uses `sql<number>\`count(*)::int\``. The tripwire regex `/sql<\s*Date\b/` does NOT match it. No annotation is needed and none should be added — adding `// sql-date-ok:` there would be misleading (the type is `number`, not `Date`). Document this in the design doc so the implementer doesn't over-annotate.

5. **Combined `npm run check` script.** Huddleup has `check:audit` and `check:sql-date` as independent scripts. The starter could add a `"check": "npm run check:audit && npm run check:sql-date"` umbrella. Optional; leave to tech-lead to decide whether the pre-push skill calling both separately is sufficient.

6. **No CI.** Confirmed: the starter has no `.github/workflows/`, no CircleCI, no GitLab CI. `vercel.json` contains only a cron entry (email-queue). The tripwire runs only in pre-push and via direct `npm run check:sql-date`. This is the right posture for a fork-and-go starter — forks wire their own CI.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

Approved. This is a developer-tooling addition that follows every established pattern: `scripts/*.mjs` placement, `npm run check:*` naming, pre-push wiring. Zero structural concerns. One additive ruling: ship the `npm run check` umbrella script to call both tripwires under a single command.

### What I did

- Confirmed `scripts/check-sql-date.mjs` placement against existing precedent: `commit-msg.mjs`, `check-audit-coverage.mjs`, `stats-escape.mjs`. All `.mjs`, all in `scripts/`. Correct.
- Endorsed pre-push step renumbering: current Step 3c (unit tests) becomes Step 3d; new Step 3c is `npm run check:sql-date`. Tech-lead edits `.claude/skills/pre-push/SKILL.md` in Phase 3.
- Ruled on `npm run check` umbrella: SHIP IT. Add `"check": "npm run check:audit && npm run check:sql-date"` to `package.json`. Provides a single entry point for all static tripwires. Low risk; no structural coupling; consistent with how sibling repos organize check scripts.
- Confirmed scan scope `src/` only. No `e2e/` scanning needed — Playwright tests do not use Drizzle's `sql<>` tag and adding `e2e/` would create noise risk for no gain.
- No new DECISION entry warranted. This follows the established `scripts/` convention without introducing a new architectural pattern.

### Outputs

- `docs/work-log/2026-07-01-sql-date-tripwire.md` — Phase 2 section added; status updated
- No DECISION entry (follows existing `scripts/*.mjs` pattern)

### Open questions / handoff notes

For tech-lead (Phase 3):
- Add `"check": "npm run check:audit && npm run check:sql-date"` to `package.json` scripts. Decide whether pre-push calls `npm run check` (cleaner step output) or calls both scripts individually (finer-grained progress reporting). Either is fine architecturally.
- Update `.claude/skills/pre-push/SKILL.md`: Step 3c → sql-date tripwire (`npm run check:sql-date`), Step 3d → unit tests (`npm run test`). Verify the full step list is renumbered consistently throughout the skill file.
- The `sql<number>` occurrence at `src/app/(admin)/admin/users/page.tsx:25` must NOT receive a `// sql-date-ok:` annotation — the regex matches `sql<\s*Date\b` only; `number` does not match. Document this explicitly in the design doc so the implementer does not over-annotate.
- Implementer: `full-stack-developer` (script + `package.json` + pre-push skill edit — small, no server/client split needed).

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

Port `check-sql-date.mjs` from `huddleup.health/web/scripts/` nearly verbatim, adapting the header comment to reference the starter's codebase (remove the huddleup motivating-incident reference or replace with a general one), add `check:sql-date` and `check` scripts to `package.json`, and insert the new Step 3c into `.claude/skills/pre-push/SKILL.md` (renaming current Step 3c → 3d). The existing `src/` scan is clean — zero violations expected on first run. Verification: run it (expect pass), then add a deliberate `sql<Date>` to a scratch file, confirm exit 1, remove.

### What I did

**`scripts/check-sql-date.mjs` — new file**

Port directly from `/Users/cshenso/git/huddleup.health/web/scripts/check-sql-date.mjs`. The structure matches `scripts/check-audit-coverage.mjs` style: `#!/usr/bin/env node`, JSDoc header explaining the invariant and escape hatch, `ROOT` + `SRC` constants using `path.resolve(new URL("..", import.meta.url).pathname)`, async generator `walk()` with `.ts`/`.tsx` filter, violation collection, exit 1 with per-violation report or exit 0 with pass message.

Adapt the header:
- Remove the huddleup-specific incident reference (REGRESSION-2026-06-28 and /me/eat crash). Replace with: "Motivating incident: a `sql<Date>` on a COALESCE expression typed the value as Date at compile time but returned a string at runtime; calling `.getTime()` on it threw TypeError at runtime. tsc cannot catch this."
- Update the scan-path comment from `web/src/**` to `src/**`.

Do NOT change the regex (`/sql<\s*Date\b/`), annotation format (`// sql-date-ok: <reason>`), or violation output structure — they are correct as-is.

**`package.json` — two new scripts**

```json
"check:sql-date": "node scripts/check-sql-date.mjs",
"check": "npm run check:audit && npm run check:sql-date"
```

Add both. Ordering in the `scripts` block: place alongside `check:audit`. The `check` umbrella provides a single entry point for all static tripwires while keeping the named scripts individually callable for targeted runs.

**`.claude/skills/pre-push/SKILL.md` — Step 3c insertion + 3c→3d renumber**

Current state:
- Step 3b: Audit-Coverage Tripwire (`npm run check:audit`)
- Step 3c: Unit Tests (`npm test`)
- Step 4: Production Build

New state:
- Step 3b: Audit-Coverage Tripwire (`npm run check:audit`)
- Step 3c: sql<Date> Tripwire (`npm run check:sql-date`) — new
- Step 3d: Unit Tests (`npm test`) — renamed from 3c
- Step 4: Production Build — unchanged

Step 3c content (to insert between 3b and old 3c):

```markdown
## Step 3c: sql<Date> Tripwire

\```bash
npm run check:sql-date
\```

`scripts/check-sql-date.mjs` walks every `.ts` and `.tsx` under `src/` and fails
if it finds `sql<Date` without an annotation. The Neon serverless driver returns
timestamps from computed expressions (COALESCE, date_trunc, etc.) as strings at
runtime — `sql<Date>` is a compile-time lie that TypeScript cannot detect. Fix by:
selecting real column(s) and converting in JS, using `.mapWith(Date)`, or annotating
with `// sql-date-ok: <reason>` when the expression is used only in WHERE/ORDER and
is never selected/returned to JS.

**Do not proceed if the sql-date check fails.**
```

**The `sql<number>` occurrence: no annotation needed**

`src/app/(admin)/admin/users/page.tsx` has `sql<number>\`count(*)::int\``. The regex is `/sql<\s*Date\b/` — `number` does not match. Do not add `// sql-date-ok:` there; it would be misleading (the type is `number`, not `Date`). Document this in a code comment in the script if helpful, but no file-level annotation is needed.

**Verification steps (required before Phase 5)**

Implementer must run both:
1. `npm run check:sql-date` → expect exit 0, output "sql<Date> guard passed."
2. Deliberate-violation smoke: add `sql<Date>\`now()\`` (no annotation) to a scratch `.ts` file under `src/`, run `npm run check:sql-date`, confirm exit 1 with the file:line violation report, then DELETE the scratch file and confirm exit 0 again. This proves the script actually catches violations and is not silently passing.

Also run `npm run check` to verify the umbrella calls both tripwires in sequence.

### Outputs

- Files to create: `scripts/check-sql-date.mjs`
- Files to modify: `package.json` (two new scripts), `.claude/skills/pre-push/SKILL.md` (insert 3c, rename 3c→3d)
- No schema changes. No permissions. No runtime code.

### Open questions / handoff notes

For **full-stack-developer** (Phase 4 implementer):
- Port the script, run the verification smoke (both pass and deliberate-fail), confirm the SKILL.md step numbering is consistent throughout the file (check that no prose references "Step 3c" meaning unit tests after the edit).
- The `check` umbrella should be tested end-to-end: `npm run check` → both scripts pass.
- This is not auth-touching; e2e gate does not apply.

---

## Phase 4 — Implementation (full-stack) — 2026-07-01

**Owner:** full-stack-developer
**Status:** complete

### Summary

Ported `scripts/check-sql-date.mjs` from the huddleup reference implementation with adapted header (replaced the huddleup-specific incident reference with a general one; updated scan-path comment from `web/src/**` to `src/**`). Added `check:sql-date` and `check` scripts to `package.json`. Inserted new Step 3c (sql-date tripwire) into `.claude/skills/pre-push/SKILL.md` and renamed the old Step 3c (unit tests) to Step 3d. All verification steps passed.

### What I did

- Created `scripts/check-sql-date.mjs`: port of the huddleup reference, style-matched to `scripts/check-audit-coverage.mjs`. Regex `/sql<\s*Date\b/`, annotation `// sql-date-ok: <reason>`, skips comment-only lines, reports file:line + three fix options on violation. Scans `src/**/*.{ts,tsx}` only (not `e2e/`).
- Updated `package.json`: added `"check:sql-date": "node scripts/check-sql-date.mjs"` and `"check": "npm run check:audit && npm run check:sql-date"` immediately after `check:audit`.
- Updated `.claude/skills/pre-push/SKILL.md`: inserted Step 3c (sql-date tripwire) between Step 3b and old Step 3c; renamed old Step 3c to Step 3d. No other step numbers changed; Step 8 summary prose does not reference step numbers and needed no edit.

### Outputs

- `scripts/check-sql-date.mjs` — new file
- `package.json` — two new scripts (`check:sql-date`, `check`)
- `.claude/skills/pre-push/SKILL.md` — Step 3c inserted, former 3c renamed to 3d

**Smoke evidence:**

```
# Clean pass (exit 0):
$ npm run check:sql-date
sql<Date> guard passed.

# Deliberate violation (src/_sql_date_smoke_test.ts with sql<Date>`now()`):
$ node scripts/check-sql-date.mjs
sql<Date> guard FAILED — unannotated occurrence(s):

  src/_sql_date_smoke_test.ts:3
  > const x = sql<Date>`now()`;

  Why this matters: sql<Date> on a computed expression (e.g. COALESCE,
  date_trunc) returns a STRING at runtime (Neon). tsc cannot catch this.

  Fix options:
    1. Select the real timestamp columns; compute the Date in JS.
    2. Use .mapWith(Date) on the column expression.
    3. If this sql<Date> is used ONLY in WHERE/ORDER and is never
       selected or returned to JS, annotate it with:
         // sql-date-ok: SQL-side only (WHERE/ORDER); never selected/returned to JS

EXIT:1

# After removing scratch file — clean again (exit 0):
$ node scripts/check-sql-date.mjs
sql<Date> guard passed.

# Umbrella (exit 0):
$ npm run check
Audit-coverage check passed.
sql<Date> guard passed.

# typecheck: EXIT 0
# lint: EXIT 0
# test: 26 test files, 318 tests passed
```

### Open questions / handoff notes

- No auth-touching; e2e gate does not apply.
- For qa (Phase 5): verify `npm run check:sql-date` (pass), `npm run check` (umbrella), typecheck, lint, and unit tests all pass. No new unit tests needed for a developer-tooling script; the smoke evidence above documents deliberate-fail behavior.
- The `sql<number>` at `src/app/(admin)/admin/users/page.tsx:25` was confirmed not flagged (regex is `/sql<\s*Date\b/`; `number` does not match). No annotation was added there.
- Nominate **qa** for Phase 5.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. `check-sql-date.mjs` catches violations (QA ran its own deliberate-violation smoke: scratch file with `const x = sql<Date>\`now()\`` → exit 1 with correct per-violation report; scratch file removed → exit 0). The pre-push step numbering is correct (3b: audit, 3c: sql-date, 3d: unit tests; Steps 0, 4, 7, 7b, 8 intact). `npm run check` umbrella calls both tripwires in sequence and exits 0. All 336 unit tests pass, typecheck is clean, lint is clean.

### What I did

- Ran `npm run check:sql-date` — PASS ("sql\<Date\> guard passed.").
- Ran deliberate-violation smoke independently: wrote `const x = sql<Date>\`now()\`;` to `src/_qa_smoke_test.ts`, confirmed exit 1 with `src/_qa_smoke_test.ts:1` violation report and correct three fix options, removed the file, confirmed exit 0 again.
- Ran `npm run check` (umbrella) — PASS (both `check:audit` and `check:sql-date` pass in sequence).
- Confirmed pre-push SKILL.md step numbering: Step 3b is audit tripwire, Step 3c is sql-date tripwire (new), Step 3d is unit tests (renamed). Steps 0 (open-test-file check), 4 (build), 7 (housekeeping), 7b (CVE audit), and 8 (summary) are all intact.
- Confirmed `sql<number>` at `src/app/(admin)/admin/users/page.tsx:25` has no annotation — correct, regex is `/sql<\s*Date\b/` and `number` does not match.
- Ran `npm run typecheck` — PASS. Ran `npm run lint` — PASS. Ran `npm run test` — 336 passed.

**Feature-Gate Audit:** no protected routes or server actions touched. No feature-gate audit applies.

### Outputs

- No new files created by QA. Verification was read-only.
- No new tests added (developer-tooling script; deliberate-fail behavior is documented by the smoke evidence and confirmed by QA's independent run).

### Open questions / handoff notes

- Next agent: analyst for Phase 6.
- No auth-touching; e2e gate does not apply.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. `check-sql-date.mjs` is implemented correctly (correct regex, escape hatch, violation output, comment-line skip), wired as `check:sql-date` and included in the `check` umbrella, and inserted as Step 3c in the pre-push skill with Step 3d renaming of unit tests. Zero current violations confirmed.

### What I did

- Read `scripts/check-sql-date.mjs`: regex `/sql<\s*Date\b/`, `// sql-date-ok:` escape hatch, `src/` scope only, violation report with three fix options, comment-line skip. Matches Phase 3 design exactly.
- Confirmed `package.json` contains `"check:sql-date": "node scripts/check-sql-date.mjs"` and `"check": "npm run check:audit && npm run check:sql-date"`.
- Confirmed pre-push SKILL.md Step 3c is the sql-date tripwire and Step 3d is unit tests — renaming is consistent.
- Confirmed `src/app/(admin)/admin/users/page.tsx` has no `// sql-date-ok:` annotation (the `sql<number>` occurrence is not flagged by the regex — correct, per Phase 1 and 2 ruling).
- Phase 1 noted the multiline `/* */` comment gap and the type-alias bypass gap as acceptable known limitations — both are documented in the script header as "not a proof; just a tripwire." No action needed.

### Outputs

- `docs/work-log/2026-07-01-sql-date-tripwire.md` — Phase 6 section added; status table updated

### Intent-vs-shipped diff

- Phase 1 said: catch `sql<Date` mechanically pre-push. Shipped: script catches it with deliberate-fail smoke confirmed by both implementer and QA independently. Verdict: matches.
- Phase 1 said: `// sql-date-ok:` escape hatch. Shipped: present and tested. Verdict: matches.
- Phase 1 said: zero current violations. Shipped: `npm run check:sql-date` exits 0. Verdict: matches.
- Phase 1 said: umbrella `check` script. Shipped: `npm run check` calls both tripwires in sequence. Verdict: matches.
- Phase 2 said: Step 3c insertion + 3c→3d renumber. Shipped: SKILL.md reflects this. Verdict: matches.

### Edge cases

- Empty state / failure microcopy: developer-tooling script — per-violation output is file:line + explanation + three fix options. Pass.
- Permission gate: not applicable (developer tooling). Pass (N/A).
- Audit event: not applicable. Pass (N/A).
- Mobile: not applicable. Pass (N/A).

### Open questions / handoff notes

None. Pipeline closed.

## Intent (harvest Tier 2 #14, 2026-07-01)

Port huddleup's `check:sql-date` tripwire
(`/Users/cshenso/git/huddleup.health/web/scripts/check-sql-date.mjs`,
kit §A1): bans the `sql<Date>` compile-time lie — the neon-http driver
returns STRINGS for raw-SQL date expressions (e.g. COALESCE'd timestamps),
so `sql<Date>` typings produce runtime `.getTime()` crashes that typecheck
cleanly (caused a real prod render crash at huddleup). Script scans for the
pattern, npm script `check:sql-date`, `// sql-date-ok:` escape hatch,
wired into the pre-push checklist.

Analyst attention: does the starter currently have ANY `sql<Date>`
occurrences (grep — including the new email-queue claim SQL which returns
raw rows; the fromRaw mapper handles strings correctly — confirm the
tripwire wouldn't false-positive on it); exact pattern(s) the scan matches
(sql<Date> only, or sql<...Date...> generics); where it wires in (package
.json script + pre-push SKILL.md step — note pre-push has recent edits);
CI posture.
