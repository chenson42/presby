# Classification table + BLOCKED verdict + auth-touching gate — Work Log

> **Slug:** `2026-05-20-classification-and-blocked-gate`
> **Surface:** instructions only (`CLAUDE.md` + `.claude/agents/qa.md`); no application code
> **Roles:** all contributors (rules apply to every commit / every PR)
> **Estimated complexity:** small (instruction-layer edits)
> **Pipeline mode:** Accelerated — Polish-lane / process-improvement edits. Phase 2 skipped (no code, no deps, no architectural surface). Phase 3 collapsed into the edit plan. Ported from the npvitals fork where these changes were originally developed and proved out.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (collapsed) | Complete | READY — motivated by two real failures in the npvitals fork on 2026-05-20 | 2026-05-20 |
| 2 — Architectural review | architect | Skipped | No code change | 2026-05-20 |
| 3 — Technical design | tech-lead (collapsed) | Complete | Edit plan below | 2026-05-20 |
| 4 — Implementation | this PR | In progress | — | 2026-05-20 |
| 5 — Verification | qa | Pending — instruction-only; no test impact | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Phase 1 — Two motivating failures (downstream, npvitals fork, 2026-05-20)

1. **Workflow drift.** A visual-refresh spree edited multiple files and added new font dependencies *without* opening a work-log, invoking the analyst, the architect, or the tech-lead. The user noticed and asked whether `CLAUDE.md` needed adjusting. The pipeline trigger — "Every change flows through six phases" — was easy to skip in practice because there was no taxonomy explaining when each phase applies.

2. **MFA login bug retrospective.** Phase 5 (qa) issued a `PASS` verdict on a two-step-login feature while explicitly noting that the e2e check was "deferred to a pre-merge gate." That gate was never enforced. The bug — a dual-`@auth/core` `instanceof`-mismatch defect that unit tests physically could not catch — shipped to `main` and was caught post-merge by `human-review`. Detail in the originating retrospective (npvitals' `docs/reviews/2026-05-20-retrospective.md`).

Both failures share a root: **pipeline phases being treated as advisory when they should be blocking.** The fixes below remove the advisory grey zone — at the trigger layer (Classification) and at the verdict layer (BLOCKED).

## Phase 3 — Edit plan (executed)

### A. `CLAUDE.md` — Workflow-drift edits

1. Inserted `### Classification — Required Before Any Code Edit` subsection at the top of `## Development Pipeline`. Four classes: Trivial / Polish-refactor / Feature / Spike. "If ambiguous, default to Feature."
2. Rewrote the prose at the top of `### Cadence Check at Session Start` as a numbered 4-step checklist (read log, read latest work-log, classify, surface overdues).
3. Appended Workflow Rule #8: "**No code before the work-log.** If you are about to call Edit, Write, or `git checkout -b` for a non-trivial request and there is no work-log entry for it, stop and run `/new-feature` first."
4. Softened "Every change — new feature or bug fix — flows through six phases" → "Every non-trivial change flows through six phases" to match the new taxonomy.
5. Tightened the tech-lead trigger in the Agent Roster: "Before writing >50 lines" → "For any Feature / bug fix or Polish / visual / refactor class request (see Classification table)."

### B. `CLAUDE.md` — Auth-touching enforcement

6. Extended the Phase 4 **Gate** line to add: "For any feature that touches `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/`, a running-server e2e smoke covering the full login path (including MFA-enrolled user) is required before Phase 5 can begin."
7. Extended the Phase 5 **Gate** line to add: "On auth-touching features, a `PASS` verdict requires that the e2e suite was run against a real dev server. A deferred or skipped e2e check produces `BLOCKED`, not `PASS`."

### C. `.claude/agents/qa.md` — Auth-touching enforcement + BLOCKED verdict

8. Added a new sub-section `### Auth-Touching Features — Stricter Gate` between "Coverage on Critical Modules" and "Verdict." Cites the originating downstream incident (npvitals 2026-05-20) by date.
9. Replaced the existing "Verdict: PASS / FAIL" section with a three-verdict explanation: PASS / FAIL / BLOCKED. `BLOCKED` is the first-class way to say "the test environment couldn't run the verification." Phase 6 cannot start from `BLOCKED`.
10. Updated the `description:` YAML field on qa.md from "binary PASS / FAIL verdict" to the three-verdict form, so Claude surfaces `BLOCKED` as an option when deciding what the qa agent can produce.

## Out of scope

- The npvitals-specific bug detail (dual-`@auth/core` defect) is referenced as a case study but not catalogued in upstream's `docs/decisions.md`. Upstream may choose to add a DECISION entry; this PR doesn't.
- The npvitals-specific `e2e/login.spec.ts` regression test (PR #15 downstream) — upstream's auth files and e2e specs are different and any regression test would need to be authored against upstream's actual structure. Filed as a candidate follow-up.
- The `webServer` block in `playwright.config.ts` (PR #17 downstream) — separate concern.

## Notes on adaptation from npvitals (the originating fork)

- File path list in the auth-touching gate adapted to upstream layout: `src/auth.ts` (not `src/lib/auth.ts`), plus `src/lib/auth/` (a directory of helpers in upstream, not present downstream).
- Phase 4 / Phase 5 gate text uses upstream's existing wording (`The build passes`, `npm run check:audit reports zero violations`) — not the slightly different downstream variant.
- Tech-lead trigger wording uses the full "Polish / visual / refactor" instead of the abbreviated "Polish-refactor" that downstream initially shipped (we caught and fixed this drift in the 2026-05-20 documentation review).

---

## Phase 4 — Implementation

(In progress this PR.)

## Phase 5 — Verification

Instruction-only change. No code impact. `npm test` and `npm run lint` still run and still pass.

## Phase 6 — Shipped vs Intent

(Pending PR merge.)
