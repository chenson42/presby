# Agent & Instruction Review — 2026-05-17

**Reviewer:** tech-lead
**Scope:** `.claude/agents/` (9 files), `.claude/skills/` (6 files), `.claude/settings.json`, `CLAUDE.md`
**First run** — no prior baseline.

---

## Summary

9 agents, 6 skills, 1 settings file reviewed. 0 critical findings, 3 notable, 5 minor, 4 observations. No agent file references a nonexistent file. The `personalize-starter` skill is correctly skill-only (no agent entry needed). All 9 agents were invoked across the 5 work-log entries examined (`database-admin` was not invoked because no work-log entry required schema-only work, which is expected, not a defect). The `pre-push` → `/release-notes` cross-reference resolves correctly.

---

## Findings

### Notable

**N1 — `qa.md` description still contains the "no test runner ships" caveat**

The agent's YAML `description` field (line 3) ends with: _"Note: the starter does not ship with a test runner configured — qa describes what to do when tests are added and what the right defaults are for this stack."_ This contradicts the body of the file (lines 12–14), which correctly states "The starter ships **both** test runners pre-configured." The caveat is stale — Vitest (`vitest.config.ts`) and Playwright (`playwright.config.ts`) both ship in the repo. The body is accurate; the description is not. Because the description is what Claude reads to decide when to invoke the agent, this discrepancy is user-visible.

**N2 — `api-developer.md` description lists "schema changes" as a primary responsibility, blurring the boundary with `database-admin`**

The YAML description (line 3) lists "database operations and queries, schema changes, seed script extensions" for the api-developer. In practice every work-log entry that touched schema delegated to `full-stack-developer` (which correctly calls out schema as needing `src/lib/db/schema.ts` first) or `database-admin`. The body of `api-developer.md` is correct (no DDL ownership claims). But the description is the signal Claude uses to route work — "schema changes" in the api-developer description will cause Claude to reach for api-developer when database-admin should be invoked instead.

**N3 — `deployment-engineer.md` env-var table is incomplete relative to `.env.example`**

The env-var table covers 6 variables. `.env.example` documents 9 app-level variables. Missing from the agent's table: `INITIAL_ADMIN_EMAILS`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `NEXT_PUBLIC_APP_URL`, `RESEND_FROM_EMAIL`, and the optional `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` pair (the latter two were added with the rate-limiting feature on 2026-05-17). A deployment-engineer running a pre-deploy check against this table will miss required variables.

---

### Minor

**M1 — `pre-push` skill step numbering has a gap: Step 3, Step 3b, Step 3c, Step 4…**

Steps 3b and 3c were added (audit-coverage tripwire and unit tests) without renumbering. Minor readability issue; no functional impact.

**M2 — `qa.md` Playwright note says "Playwright does NOT spawn the dev server" but the actual `playwright.config.ts` should be cross-checked**

The qa.md states the e2e runner assumes `npm run dev` is already up. If `playwright.config.ts` has a `webServer` block that auto-starts the dev server, this instruction is wrong and will mislead. (Verification: checked `playwright.config.ts` — it does not have a `webServer` block, so the instruction is accurate. This is a verification note for the next reviewer, not a current defect.)

**M3 — `add-permission` skill Step 6 says "Add a row to the feature inventory in `CLAUDE.md` if one is maintained there" — no such inventory exists in `CLAUDE.md`**

`CLAUDE.md` does not maintain a feature-permission inventory table. The conditional "if one is maintained" makes this harmless, but the reference is mildly confusing. Recommend removing or replacing with a concrete action (e.g., "update the release notes").

**M4 — `personalize-starter` skill Step 7 manual TODOs reference `INITIAL_ADMIN_EMAILS` (item 4) and `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (item 5) but does not mention `NEXT_PUBLIC_APP_URL` (item 6) is a separate variable from `AUTH_URL`**

Both are needed; they serve different purposes (`NEXT_PUBLIC_APP_URL` is used in email link construction on the client-observable side; `AUTH_URL` is used by NextAuth for callback routing). A forker following the TODO list will set `AUTH_URL` (item 6 of the todo calls it "Public origin") but may miss `NEXT_PUBLIC_APP_URL` as a distinct variable.

**M5 — `tech-lead.md` Project Context section still refers to "the middleware enforces the 2FA gate" (line 92)**

The comment reads: "TOTP 2FA — see `src/lib/two-factor.ts`; the middleware enforces the 2FA gate." The starter uses `proxy.ts`, not `middleware.ts` (the deployment-engineer correctly calls this out). The phrase "the middleware" is imprecise and could mislead a reader unfamiliar with Next 16's `proxy.ts` convention.

---

### Observations

**O1 — `database-admin` agent has never been the sole implementer in any work-log entry**

All 5 features / bugs in the work-log used `full-stack-developer` for Phase 4. This is expected — no work so far has been schema-only. Not a defect; worth noting if the roster needs trimming at a later cadence.

**O2 — `api-developer` agent has never been invoked as a solo implementer**

Same as O1. The features so far have been small enough for `full-stack-developer`. Expected. Monitor at next retrospective.

**O3 — `personalize-starter` skill is skill-only (no agent entry in CLAUDE.md Agent Roster table)**

Confirmed correct. The skill is invoked directly; it does not require a Phase 4 implementer agent. The Agent Roster table in `CLAUDE.md` is accurate as-is.

**O4 — `.claude/settings.json` allowlist is reasonable and contains no obviously stale entries**

All 22 allowed commands (`npm:*`, `git:*`, `gh:*`, `grep:*`, etc.) are used in regular workflow. No entries referencing removed tools or scripts.

---

## Files Reviewed

- `/Users/cshenso/git/claudecode/.claude/agents/analyst.md`
- `/Users/cshenso/git/claudecode/.claude/agents/architect.md`
- `/Users/cshenso/git/claudecode/.claude/agents/api-developer.md`
- `/Users/cshenso/git/claudecode/.claude/agents/database-admin.md`
- `/Users/cshenso/git/claudecode/.claude/agents/deployment-engineer.md`
- `/Users/cshenso/git/claudecode/.claude/agents/full-stack-developer.md`
- `/Users/cshenso/git/claudecode/.claude/agents/qa.md`
- `/Users/cshenso/git/claudecode/.claude/agents/tech-lead.md`
- `/Users/cshenso/git/claudecode/.claude/agents/ux-developer.md`
- `/Users/cshenso/git/claudecode/.claude/skills/add-permission/SKILL.md`
- `/Users/cshenso/git/claudecode/.claude/skills/neon-postgres/SKILL.md`
- `/Users/cshenso/git/claudecode/.claude/skills/new-feature/SKILL.md`
- `/Users/cshenso/git/claudecode/.claude/skills/personalize-starter/SKILL.md`
- `/Users/cshenso/git/claudecode/.claude/skills/pre-push/SKILL.md`
- `/Users/cshenso/git/claudecode/.claude/skills/release-notes/SKILL.md`
- `/Users/cshenso/git/claudecode/.claude/settings.json`
- `/Users/cshenso/git/claudecode/CLAUDE.md` (workflow sections)
- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-16-admin-signin-access-pending.md`
- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-16-per-user-2fa-bypass.md`
- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-17-account-page.md`
- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-17-forgot-password.md`
- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-17-rate-limiting.md`
- `/Users/cshenso/git/claudecode/docs/work-log/2026-05-17-toast-infrastructure.md`
