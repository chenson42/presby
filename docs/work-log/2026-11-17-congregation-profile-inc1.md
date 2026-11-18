# Congregation profile Increment 1 — records — Work Log

> **Slug:** `2026-11-17-congregation-profile-inc1`
> **Surface:** (org) — the presbytery's per-congregation pages (`/o/<presbytery-slug>/admin/oversight/...`), presbytery type only; `/help`
> **Permission(s):** `congregation_oversight.manage` (existing, tier 1) and the new `congregation_oversight.finance` (tier 2, two-factor; in the presbytery founding-administrator bundle, DECISION-345). Never `FEATURES.*`.
> **Flag(s):** none new. Rides the existing global `org_portal.oversight`.
> **Estimated complexity:** large
> **Pipeline mode:** Full (schema change: migration 0089)
> **Release:** 0.61.0 (`package.json` bump and `docs/release-notes/v0.61.md` after Phase 6 SHIP IT, through `/release-notes`)
> **Parent:** `docs/work-log/2026-11-17-congregation-profile.md` (Phases 1 to 3: the analyst's brief and the orchestrator rulings, the architect's R1 to R10 and DECISION-344 to 348, and the one Phase 3 design for both increments). **Do not restate or summarize them here.**
> **Numbers (pre-assigned, Rule 16):** migration 0089; DECISION-344 to 352 (349 to 351 used by Phase 3); F450 to F455 used, F456+ free; dev port 3102 (3103 for the production hydration lane); e2e ids `00000000-0000-4089-8000-` (people), `-9000-` (roles), `-9001-` (organizations); Neon branch `br-spring-bonus-axifozcw` (`pipeline-congregation-profile`); worktree `../presby-profile`, branch `pipeline/congregation-profile`
> **Source:** operator decisions A to G, 2026-11-17 ("take congregation profiles all the way to the end (pushed to production)")

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent) | READY WITH NOTES | 2026-11-17 |
| 2 — Architectural review | architect | Complete (parent; R1–R10) | Approved with suggestions | 2026-11-17 |
| 3 — Technical design | tech-lead | Complete (parent; this log carries the increment slice below) | Design complete | 2026-11-17 |
| 4 — Implementation | database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

See the parent log. Recorded there verbatim; not copied.

# Phase 3 — Technical Design (tech-lead): the Increment 1 slice

The design is in the parent's Phase 3. Sections an implementer of this increment reads: "Design rulings" (T1 to T12), "Permissions & Flags", "Feasibility check", "Data Model", "Import contract", "Module and file plan", "API Contract", "Component / Page Plan", "Implementation Order — Increment 1", "Deploy checklist", "Copy" C1 to C13, "Test plan", "Carry-forward", "Edge Cases & Risks".

**Scope.** Migration 0089 (all six tables, the permission, the founding-administrator bundle change and its backfill); `src/lib/oversight/` (`contract`, `validate`, `copy`, `derive`, `store`, `reads`); `gateOversightPage`; the reworked list and record pages; profile, assessment (moved route), buildings, appraisals, insurance and loans; the `congregation-records` help page and four help edits; the founding-administrator walk. **No photo UI and no reports.**

## Batches

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B1** | database-admin | `drizzle/0089_presby_oversight_records.sql` (sections 0 to 9), `src/lib/db/domain/oversight.ts`, `oversight.schema.test.ts` (D1), `oversight.db.test.ts` (D2), `scripts/oversight/test-rls-89.sql`, the five integration patches and `seed-dev-oversight.sql`, the bundle TypeScript mirror (`founding-administrator.ts`, golden, `founding-administrator.test.ts`, `invitations.db.test.ts`), the pins listed in the Feasibility check, `scripts/oversight/test-0089-migration.sh` (D6). Applied to the pipeline Neon branch. | 0089 applied twice with identical digest; test-rls-89 and the patched test-rls pass as `presby_app`; each mechanism proven failing-first; typecheck |
| **B2** | api-developer | `contract`, `validate`, `copy` (strings from the parent's Copy section only), `derive`, `store`, `reads`; the 14 audit keys; `gateOversightPage`; the six `actions.ts` files and the moved assessment action; the `presbytery.ts` changes (F451, F454); `boundaries.test.ts` (U5), `audit-coverage.test.ts` (U6), `store.db.test.ts` (D3), `reads.db.test.ts` (D4), U1 to U4, U7, U10 | `npm run check` zero; the DB files above; failing-first for the audit-in-transaction rollback and the concurrency cases |
| **B3** | ux-developer | the list, record page, every form page and component, the moved assessment form, the states, the tile description, the `founding-administrator-section.tsx` label, page and form tests (U8, U9); **the help page and the four help edits, written from the screens at 360px**; registry, allowlist and pin (12) | typecheck, build, `check:hydration-gate`, `check:help`, a 360px walk of every page in a real browser, light and dark |
| **B4** | full-stack-developer | `e2e/support/oversight-fixture.ts` (new file only), `oversight-records`, `oversight-finance`, `oversight-founder` and `hydration/oversight-forms` specs, the edits to `presbytery-oversight.spec.ts` and `presbytery-map/map.spec.ts` (the new assessment URL; carrier and expiry fields removed), the `docs/deployment.md` "Pre-deploy runbook: 0089", then run the founding-administrator walk for real | own server on 3102 (`E2E_BASE_URL`); the new and touched specs green; prod hydration lane (3103) green |

Order: B1 merges to the pipeline branch before B2 (B2 imports the Drizzle mirror); B2 before B3; B4 starts when B3's pages exist.

## Gates (every batch)

- `npm run check` (all ten tripwires) reports zero violations; typecheck, lint and build pass; no native browser dialogs; no `console.log` in production paths; audit rows for every write (the in-transaction `insertAuditRow`, proven by D3).
- Every form root is inside `HydrationGate`; every page is walked at 360px in a real browser.
- Tests are written by the implementer; QA runs them and authors none.
- Never `git stash` in a worktree; never `pkill -f next`; every server started sets its own `E2E_BASE_URL` and is stopped by PID.
- Shared files (`domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/dev-docs.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, existing `e2e/support/*`) are **not edited mid-pipeline**: write `scripts/oversight/*.integration.patch` files instead (the `scripts/worship/` precedent).

## Increment-specific notes

**Handoff.** Next agent: **database-admin** (B1). Read the parent's Phase 3 first.

- **Deploy order:** apply 0089 to an environment before the code that reads it (parent "Deploy checklist"). Record the apply-time notice count (founding-administrator roles topped up) and the deploy-day counts here: legacy carrier/expiry rows (R8) and "newly required, not enrolled" (R2).
- **Operator actions:** switch `org_portal.oversight` on in production; confirm `org_portal.reports` and `org_portal.insights`.
- **Phase 6 walks:** the founding-administrator path (R2) and every page at 360px as the people each path creates; the five help pages read as their reader.
- **Release notes:** the C13 lines, through the `/release-notes` skill after SHIP IT, with the deploy-day count deciding the "nothing had been entered" sentence. Also the functionality-map line (Rule 14) and TODO reconciliation (Rule 10).

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

Strings added or changed: [file:line each, or "none"]

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Copy Truthfulness

*(Every run whose diff adds or changes a user-facing string; write "no strings changed" otherwise. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role.)*

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false
- [ ] Help diff covered: every labels string is on screen, every claim walked at 360px, every committed image opened

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]
- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
