# Review Log

The source of truth for periodic-review history. Claude reads this at session start to check whether any review is overdue against its slot's cadence (see `CLAUDE.md` → Periodic Reviews).

## Format

Newest first. One line per review:

```
YYYY-MM-DD | <type> | <one-line outcome>
```

Review types and their slots (consolidated 2026-07-11, DECISION-029):

- **Release slot** (cadence: 14 days, or each release if sooner): `test-coverage`, `retrospective`
- **Monthly health-check** (cadence: 30 days, run as one bundled session): `code`, `documentation`, `security`, `agent-instruction`, `dependencies`
- **Starter syncs**: `upstream-sync` (14 days — pull starter fixes into presby), `downstream-sync` (30 days — surface presby work that is starter-generic)

For substantial reviews, also write `docs/reviews/YYYY-MM-DD-<type>.md` with the details and link it:

```
2026-05-23 | security | 2 medium findings, 3 low; see 2026-05-23-security.md
```

For no-op reviews (a cycle genuinely produced no actionable findings): `nothing material`. If three retrospectives in a row produce nothing, the cadence itself is suspect — surface that to the user.

## Entries

<!-- newest entries go here, above the older ones -->

2026-09-25 | documentation | first real presby run (2026-08-19 was a baseline reset): 4 critical (README.md describes a pre-2026-08 project — wrong name, wrong status, Node 20.9+ vs engines>=22; docs/deployment.md has zero mention of the Node-22 Vercel deadline six days out; the DB-backed test invocation is undocumented anywhere, confirming the code review's C-1 from the docs side; schema-design.md §13 lacks the superseded banner §14 carries, so a required-reading doc still presents a dropped table as current), 10 notable (CLAUDE.md Post-Login Landing stale by a retired route in 4 places; Brand Is a Cascade Override missing DECISION-094's /signin exception; schema-design.md §17's cross-org-policy sentence wrong in both directions; functionality-map.md and architecture.md datelines stale; decisions.md's header still says "Claude Code Starter"; STATE.md is 67% session-handoff prose across four blocks, one contradicted by deployment.md; the external post-merge review practice is unnamed as a process; schema-design-2.md's seven review sections nearly outweigh the design; CLAUDE.md's Project Layout omits two component directories), 4 minor, 5 observations; see 2026-09-25-documentation.md

2026-09-25 | code | first real presby run (2026-08-19 was a baseline reset): 3 critical (DB-backed suite + test-rls.sql run nowhere in CI; check:audit sees 4 of 23 mutation-bearing files — its `db.`-only receiver regex misses every `tx.` write, so admin/tickets/actions.ts's five audit-exempt annotations are decorative; dev-docs.ts claims it cannot drift while MODULES is 20 of 63 domain tables stale and INVARIANTS omits Composite Tenant Keys), 9 notable (CLAUDE.md Post-Login Landing still documents the retired /orgs; 17 modules hand-roll the permission gate authz.ts never exported; isUniqueViolation duplicated at two cause depths; 4 starter-era admin pages unguarded incl. the one 05-17 N-5 named and 07-11 wrongly closed; rate-limit enforcement tests disabled by ambient env; people hard-delete guarded on one connection where its declared twin is guarded on both; changePassword rate limit open 3rd cycle; CI pins Node 20 against engines>=22; 23 test files hand-roll the disable-trigger teardown), 6 minor, 8 observations; Workflow Rule 16 analysed against the last pipeline's real 63-file footprint — 5 hot shared files missing from the list (two mandated by Rules 7 and 14), 181 absolute-count assertions couple test-rls.sql to seed-dev.sql, the 24-test-file fixture sweep is the largest collision surface; see 2026-09-25-code.md

2026-09-25 | security | app/auth half (api-developer): 2 HIGH (open-redirect regression via WHATWG backslash/tab bypass in sanitizeCallbackUrl; tier-3 disability data written verbatim into the platform audit log), 4 LOW unchanged 3rd cycle, 1 prior MEDIUM closed; forward review of the D16 endpoint and a dormant plaintext bearer token. Schema/data half (database-admin, live development catalog): 3 HIGH (F54–F58 guard layer on main but not yet on the database — round two in flight; app_role_permissions has no RLS and full tenant DML, 43 cross-tenant rows readable AND writable; F38's blanket grant closed for organizations only, still live on the auth/credential/audit shell and absent from drizzle/, so the posture is unreproducible), 4 MEDIUM (affiliation-tree helper granted to presby_app and arms its GUC before validation; 28/35 DEFINER functions lack SET search_path; six single-column tenant→tenant FKs incl. roll_actions.voids_action_id; group_types policy NULL-false), 6 LOW, 6 info; deletable_until verified; zero orphan fixture orgs; fpcw real-PII row confirmed; see 2026-09-25-security.md

2026-09-24 | agent-instruction | first real presby-specific run (2026-08-19 was a baseline reset): 2 critical (database-admin.md has no presby DDL/RLS guidance at all; full-stack-developer.md's schema instruction contradicts CLAUDE.md), 6 notable (tech-lead/architect/qa/pre-push lack a live-catalog/fixture verification step; no named migration-correction-in-place process; concurrency unaddressed), 3 minor, 3 observations; see 2026-09-24-agent-instruction.md

2026-09-24 | dependencies | 0 critical/high, 7 moderate unchanged (vitest chain now has a clean 4.1.11 fix; drizzle-kit/esbuild chain still has none); npm audit fix reify bug reproduced and root-caused (name packages explicitly as workaround); eslint 10 now unblocked; new time-sensitive item: Vercel deprecates Node 20 in Project Settings 2026-10-01, repo still pinned there; see 2026-09-24-dependencies.md

2026-09-24 | sibling-harvest (ad hoc, operator-requested) | FPCW replacement feature-match vs fpcw-directory @ e988e83 (v2.15.00-v2.15.52): scope confirmed as directory + groups/on-call + reimbursement + finance SoR + youth + mailchimp + kiosk + calendar/Google, cutover Jan 1 at fiscal-year boundary; 3 blockers found (custom domains absent and required day one, finance domain nonexistent, DECISION-060 missing FK gates Google sync); fpcw's service-account DWD model rejected as multitenant anti-pattern in favour of OAuth admin-consent; 11 tracks + 4 open questions; see 2026-09-23-fpcw-feature-match.md

**Reset 2026-08-19.** This file was carried over wholesale when presby was
scaffolded from `chenson42/claudecode-nextjs-starter` on 2026-08-17 — every
entry below the divider is that starter project's own review history, not
presby's. `docs/STATE.md` already says presby has no shared *git* history with
the starter, but this *doc* came along at scaffold time anyway, and its cadence
math was accordingly measuring elapsed time against reviews that were never
run on this codebase, on a repo that is two days old.

The lines below are explicit **baselines, not completed reviews** — no review
type has actually been run against presby's code yet. They exist so the
cadence check's clock starts counting from today rather than reporting a false
weeks-overdue count. The first *real* run of each type replaces its baseline
line the normal way (newest entry on top) and should read like any other
finding, not like this one.

2026-08-26 | portal-ux (ad hoc, operator-requested) | live-browser pass at 1280px+390px across every portal surface; 4 high (chevron-less selects on sensitive-info, roll-action select drift, no unsaved-changes guard anywhere, Parishes dead-end cards), 6 medium, 6 low; top-5 shortlist for operator; see 2026-08-26-portal-ux.md
2026-08-19 | dependencies | baseline (reset) — clock starts here, not a completed review
2026-08-19 | agent-instruction | baseline (reset) — clock starts here, not a completed review
2026-08-19 | security | baseline (reset) — clock starts here, not a completed review
2026-08-19 | documentation | baseline (reset) — clock starts here, not a completed review
2026-08-19 | code | baseline (reset) — clock starts here, not a completed review
2026-08-19 | retrospective | baseline (reset) — clock starts here, not a completed review
2026-08-19 | test-coverage | baseline (reset) — clock starts here, not a completed review

---

*Below this line: the starter template's own review history, kept for
reference only. Not presby's, and not counted toward presby's cadence.*

2026-08-09 | external-review | Fable 5 first pass (starter + process + AI-SDLC industry research): core finding "process knows things it doesn't enforce" — e2e absent from CI despite retro naming it sole defense; 8 enforcement gaps, commit↔work-log trailer missing, 5 efficiency cuts; escape-rate trailers judged industry-leading; see 2026-08-09-fable-external-review.md
2026-07-11 | retrospective | Pipeline healthy: all 6 edits from 05-17 landed; 1 formal loop-back across 25 pipelines (caught real hook defect); 0 trailer bypasses; risk: 57% of fixes found post-merge, 100% agent-review — e2e gate is sole defense for runtime/framework bug class; 8 punch items; see 2026-07-11-retrospective.md
2026-07-11 | security | 0 critical/high, 1 medium (new: admin/2fa actions lack independent hasFeature check, mitigated by proxy edge gate), 4 low, 3 informational; 6 of 10 prior findings fixed and verified; see 2026-07-11-security.md
2026-07-11 | code | 0 critical, 3 notable, 3 minor, 7 observations; 6/10 prior findings fixed, 2 still open (changePassword rate limit, recovery-code helper dup); new: dead prepareEnrollment reintroduces fixed 2FA bug if wired up; see 2026-07-11-code.md
2026-07-11 | dependencies | 7 moderate findings unchanged (esbuild/drizzle-kit dev-only, postcss/next transitive), both with RC/canary fixes pending stable cuts; eslint 10 now unblocked; TS target revised to 6.0; next-auth beta.31 unchanged 3mo; see 2026-07-11-dependencies.md
2026-07-11 | agent-instruction | Instruction-layer slim: 9 agent descriptions de-exampled, handoff template single-sourced to work-log _template, stale refs fixed (architect tree, qa /home landing, analyst /totp, recordAudit pattern); see 2026-07-11-agent-instruction.md
2026-07-11 | documentation | CLAUDE.md 451→~330 lines: feature catalog → README pointer + capability map, permissions-vs-flags single-sourced to Key Invariants, review cadences consolidated to two slots (DECISION-029); see 2026-07-11-agent-instruction.md
2026-07-01 | test-coverage | Phase 5 sweep (4 pipelines): 259/259 unit tests green; 24/24 e2e green; critical modules (permissions, two-factor, flags, audit, request-ip, errors) all 100% stmts; email/queue.ts 68.75% stmts (untested runtime paths acceptable); overall 62.29% stmts on covered files
2026-07-01 | agent-instruction | Harvest Tier 3 applied: qa feature-gate table + no-self-agreeing-mocks, deployment-engineer force-push guardrail (+ Workflow Rule 11), pre-push CVE step, database-admin onDelete rule, api-developer email-escape rule
2026-07-01 | test-coverage | Phase 5 sweep: 4 critical modules at 100% (permissions, two-factor, flags, safe-callback); overall 77.4% stmts; 175/175 unit tests green; 20/20 e2e tests green
2026-07-01 | downstream-sync-triage | 40 candidates triaged: 5 already done, 2 live bugs found (verify-email txn, 2FA RSC cookie), rest OPEN/PARTIAL/LOW — see 2026-07-01-starter-contribution-triage.md
2026-07-01 | sibling-harvest | 7 sibling repos scanned (wlions, fpcw, sagacraft, huddleup, explore.press, fertilityluna, npvitals): 6 must-pull bugs/gaps, 9 should-pull, docs/process batch; email queue gap confirmed x3 — see 2026-07-01-sibling-harvest.md
2026-05-18 | test-coverage | flags.ts and two-factor.ts brought to 100% coverage (6 + 28 tests); full suite 139/139 green; typecheck clean
2026-05-17 | retrospective | first run; 0 loop-backs across 6 features; top risks: test coverage debt (two-factor.ts/proxy.ts at 0%), 2 security findings survived all phases (open redirect, enrollment loop), CLAUDE.md 3 versions behind; 6 edits proposed; see 2026-05-17-retrospective.md
2026-05-17 | security | first run; 0 critical, 1 high, 4 medium, 3 low, 2 informational; top: open redirect (callbackUrl), email token plaintext, 2FA enrollment loop; see 2026-05-17-security.md
2026-05-17 | documentation | first run; 3 critical (CLAUDE.md missing v0.3 features, 2 missing commands, 3 missing route groups), 4 notable, 5 minor; see 2026-05-17-documentation.md
2026-05-17 | code | first run; 3 critical, 6 notable, 4 minor, 6 observations; top items: TOTP audit literals bypass catalog, isFlagEnabled never called, proxy /account fallthrough undocumented; see 2026-05-17-code.md
2026-05-17 | agent-instruction | first run; 0 critical, 3 notable, 5 minor, 4 observations; top items: qa.md description has stale "no test runner" caveat, api-developer description claims schema-change ownership (blurs database-admin boundary), deployment-engineer env-var table missing 6 variables; see 2026-05-17-agent-instruction.md
2026-05-17 | dependencies | first run; 0 urgent, 3 soon (@neondatabase/serverless major, typescript 6, eslint 10), 3 held (next-auth beta, drizzle-kit/esbuild CVE, next/postcss CVE); see 2026-05-17-dependencies.md
2026-05-16 | test-coverage | first run; 1 of 9 critical modules covered (permissions.ts 100%); two-factor.ts, flags.ts, proxy.ts all at 0%; 7-item punch-list; see 2026-05-16-test-coverage.md
2026-09-25 | test-coverage | first real presby run (2026-08-19 was a baseline reset): standing targets MET (permissions.ts 100, flags.ts 100, two-factor.ts 91.3) but overall FAIL — 5 critical (765 of 4005 tests + 412 test-rls.sql assertions run nowhere in CI, and the DB-backed run is red 4/4 on the rate-limit env trio so the CI job can't be added until that's fixed; src/auth.ts's jwt callback — 339 lines producing every session.user.features claim — has no test and no coverage row; F1/FORCE RLS asserted by hand-enumeration for 21 of ~50 tenant tables incl. no tier-3 table; presby_roll_cache_drift() is SECURITY DEFINER, unfiltered, no SET search_path, EXECUTE to PUBLIC — live-probed returning membership rows for an org presby_app cannot see, and it makes test-rls.sql:414-418 abort on any concurrent session (2 of 4 runs); the CI e2e job would still fail with NEON_API_KEY set — e2e.yml omits PLATFORM_DATABASE_URL and db:push emits none of the hand-written RLS/trigger migrations), 9 notable, 6 minor, 8 observations; this week's three owner-connection domain suites named as the template; 17-item punch-list; see 2026-09-25-test-coverage.md
2026-09-25 | retrospective | first real presby run: 68 pipelines, 0 trailer bypasses, 30% fix-commit escape share; central finding is one pipeline (lifecycle-affiliation-returns, 10 Phase 3 rulings, F47-F58 external post-merge) where Phase 5 correctly verified spec conformance but the spec itself had gaps a design principle discovered mid-pipeline (Ruling B3) wasn't re-applied backward to catch; Rule 16 written 2026-09-24, not followed 2026-09-25 (shared worktree/branch), reproducing the contamination it was meant to prevent; QA failing-first discipline 3-for-3 real catches; DB-backed suite + test-rls.sql confirmed absent from CI (C-1); see 2026-09-25-retrospective.md
