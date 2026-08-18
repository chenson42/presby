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
