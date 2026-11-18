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
| 4 — Implementation | database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4) | In progress (B1 complete; next B2) | — | 2026-11-18 |
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

## B1 — Schema (database-admin, 2026-11-18)

### Files Created

- `drizzle/0089_presby_oversight_records.sql` — sections 0 to 9: guard (0072), the `congregation_oversight.finance` permission, the bundle re-created from the live 0085 body plus the finance key, the backfill (notice), the six tables, the eight indexes, the two guard functions and 12 triggers, RLS + grants, comments, and the closing assertions.
- `src/lib/db/domain/oversight.ts` — the Drizzle mirror of all six tables; the closed vocabularies, `OVERSIGHT_MONEY_MAX_CENTS` and `OVERSIGHT_GUARD_CODES` (the CONSTRAINT names the guards raise) for B2.
- `src/lib/db/domain/oversight.schema.test.ts` — D1: names parsed from 0089 against `getTableConfig` (both directions), FK shapes, vocabularies against the CHECK text, drop-then-add CHECKs, the bundle body, no DELETE/`presby_platform` grant; and, Postgres-backed, columns + nullability and constraint/index names against the live catalog.
- `src/lib/db/domain/oversight.db.test.ts` — D2 (22 tests): CHECK boundaries, partial uniques, the three-column FK, removal one-way, the building-live guard and the about-org trigger on BOTH connections; owner-only immutables and import allowances; R9 departure; the FOR SHARE race under two connections; the door with a live site; grants; teardown order; bundle = `foundingAdministratorPlan()`; the backfill re-run from the migration text.
- `scripts/oversight/test-rls-89.sql` — sections (a) to (i), standalone as `presby_app`, own world, every block rolled back, tolerates the oversight seed.
- `scripts/oversight/test-0089-migration.sh` — D6 (steps 1 to 7 in its header).
- `scripts/oversight/seed-dev-oversight.sql` — the fixture (below).
- `scripts/oversight/{domain-index.ts,_journal.json,test-rls.sql,seed-dev.sql,dev-docs.ts}.integration.patch` — the five Rule 16 patches; each passes `git apply --check` on this branch.

### Files Modified

- `src/lib/onboarding/founding-administrator.ts` — presbytery arm `[manage, finance]` (U11).
- `src/lib/onboarding/designation-parity.golden.json` — both presbytery blocks gain the finance key.
- `src/lib/onboarding/founding-administrator.test.ts` — 13 keys, order pin, and a new case: no other type carries the finance key.
- `src/lib/db/domain/invitations.db.test.ts` — presbytery designation carries the finance key; synod does not.
- `src/lib/db/domain/two-factor-default.db.test.ts` — nine flagged keys become ten.
- `src/lib/db/domain/worship.db.test.ts` — its presbytery-bundle pin now reads the last two keys (not in the Feasibility list; it pinned `.at(-1)`).
- `scripts/giving/test-rls-46.sql` — 46j nine becomes ten, plus a tier-2 line for the finance key.
- `scripts/assets/test-rls-72.sql` — 72b's FK count into `blob_assets` moves from eight to ten (the two photo FKs). Not in the Feasibility list; found by the from-empty run.
- `scripts/check-schema-parity.ts` — two `architectural` allowlist rows for the DDL-only photo blob FKs (the person-photos precedent). Not a Rule 16 file.

### Schema Changes

- New tables (all `organization_id` = the presbytery, `about_org_id` = the congregation, FORCE RLS, `tenant_isolation`, `unique (id, organization_id)`): `oversight_profiles`, `oversight_buildings` (+ `unique (id, organization_id, about_org_id)`), `oversight_building_photos`, `oversight_building_appraisals`, `oversight_insurance_years`, `oversight_loans`. Children reference buildings by the three-column key.
- New permission `congregation_oversight.finance` (module `presbytery`, tier 2, `requires_two_factor`); presbytery founding bundle carries it; backfill of existing presbytery founding roles.
- Comment-only: `congregation_oversight.insurance_carrier`/`insurance_expires_on` (superseded), `.buildings_notes`, `permissions.requires_two_factor`, `presby_two_factor_required` (restated from the live text).
- Applied via: **hand-written migration**, `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0089_presby_oversight_records.sql` on `br-spring-bonus-axifozcw` (pipeline-congregation-profile). Applied twice there, both exit 0 (apply-time notice: 0 roles topped up, this branch has no presbytery founding role). `_journal.json` entry `{ idx: 89, tag: "0089_presby_oversight_records", when: 1793825100000 }` is in the integration patch (the orchestrator's ordering against 0088). `scripts/oversight/seed-dev-oversight.sql` applied twice to the branch, exit 0, row counts unchanged.

### Audit Events

- None in B1 (a migration is provisioning; B2's `store.ts` writes the 14 keys).

### Gate evidence

- **Idempotence (D6, `scripts/oversight/test-0089-migration.sh`, from empty, a `scratch_0089` database on the pipeline branch's compute, dropped after): `D6 PASS`.** 0089 without 0072 refused by its first statement, nothing left behind; apply 1 exit 0, backfill notice **1** (a synthetic pre-0089 presbytery founding role); whole-file apply 2 exit 0, notice **0**, catalog fingerprint identical (`6f9f19d4940d4a07efa9dc2bd23c5e90`), seeded rows byte-identical, row counts unchanged (1/2/1/1/1/96/42); test-rls-89 162 passes; the integrated `test-rls.sql` exit 0; `drizzle-kit migrate` with the patch's idx-89 journal entry: ledger complete (79 entries), fingerprint still the same. The fingerprint names objects rather than OIDs, so it is portable: the pipeline branch, after every failing-first cycle and re-apply, reads the same `6f9f19d4...`.
- **test-rls-89 as `presby_app`** on the pipeline branch, with and without the oversight seed: exit 0, 161 assertions.
- **The integrated `test-rls.sql` as `presby_app`, from empty** (migrations, `seed.ts`, `seed-dev.sql` + the oversight seed, helpers, both patches applied): exit 0, section 89 complete. Two pins moved to get there, both mechanical: the presbytery member count 2 to 3 (in the test-rls patch, the new finance holder) and 72b's FK count 8 to 10 (direct edit). The pipeline branch's own copy of the full suite fails at line 219 on a pre-existing operator membership at the Northern Reach (the live-drift case that line's comment already describes); the from-empty run is the gate.
- **Vitest (pipeline branch, serial):** D1 32/32, D2 22/22, `founding-administrator.test.ts` + schema 73/73, `invitations` + `worship` + `designation-parity` + `designation-parity-in-place` + D2 151/151, `two-factor-default` 4/4.
- **Failing-first** (sabotage on the pipeline branch as owner, the named test red, re-apply 0089, green; harness in the session scratchpad):

  | Mechanism | Sabotage | Red (first failure) |
  |---|---|---|
  | FORCE RLS | `no force` on loans | 89a "all six ... ENABLED and FORCED", expected 6 got 5 |
  | policy USING | `using (true)` on buildings | 89d (alone) "from the Western Basin, no oversight row ... is visible" |
  | policy WITH CHECK | `with check (true)` on buildings | 89d (alone) "an insert stamped with the Northern Reach's id is refused by RLS WITH CHECK" |
  | no DELETE | `grant delete` on loans | 89c "neither presby_app nor presby_platform holds DELETE", got 1; and 0089 section 9 alone raises "presby_app holds DELETE or TRUNCATE" |
  | column grants | `grant update (provenance)` on profiles | 89c (alone) "UPDATE lists are exactly the design's six", got 5 |
  | about-org trigger | dropped on profiles | 89a trigger count 12 to 11; 89f (alone) "the Western Basin cannot record a profile about Alder Creek" |
  | removal guard | dropped on buildings | D2 "removal is one-way" (both connections): expected 23514 `oversight_guard_removal_final`, statement succeeded |
  | immutable columns | guard's column loop emptied | D2 "every immutable column is refused": expected `oversight_guard_immutable` |
  | building-live guard | dropped on appraisals | D2 "removal is one-way" (both): expected `oversight_guard_building_removed` |
  | FOR SHARE | `for share` removed | D2 race: "the appraisal insert waited on the removal's row lock", expected false got true |
  | three-column FK | appraisal FK narrowed to two columns | D2 three-column FK (both connections) and 89e (alone) |
  | partial unique | live-name index dropped | D2 "partial uniques" (both): expected 23505 `oversight_buildings_live_name_idx` |
  | bundle | reverted to the 0085 body | D2 bundle = plan ("presbytery: expected 11 ... to equal 12") and 89b (alone) |

- **CHECK and trigger logic restated (self-verification):** a building is never both primary and retired; retired date and reason come together; removal time and remover come together; a loan balance is always dated and a date always has a balance; a loan is paid off exactly when it has a paid-off date; an addition is never before what it extends (first after built, second after first and after built, each only when both are recorded); money is 0 to $1,000,000,000 inclusive. The write guard: a tenant cannot insert a removed row and its created_at is the server clock; a removed row never changes again; the listed identity columns never change, on every connection. The building-live guard: no new photo or appraisal, and no new loan link, on a removed building, serialized with the removal. The about-org trigger: a new row must be about a congregation affiliated with the presbytery today; an edit that does not move the congregation passes. Each restatement matches the design.
- `npm run typecheck` clean; `npm run check` all ten pass; eslint clean on the changed TypeScript.

### Implementer Notes

Deviations and things the next phases need:

1. **Teardown: the presbytery cascade is never reachable while records exist (D2's "teardown cascade" claim, and B4).** Every one of the six tables carries `about_org_id` as a NO ACTION FK, and an affiliation's `parent_org_id` blocks the presbytery delete until the congregation is gone, so a congregation with records about it cannot be deleted and the presbytery cannot be deleted before it. The only order that works, pinned in D2: delete the six tables' rows as the owner (children first: photos, appraisals, loans, then buildings, insurance years, profiles), then the congregations, then the presbytery. **B4's `oversight-fixture.ts` should tear down in that order.** The design's fallback (affiliation rows first, then the presbytery, whose `organization_id` cascade would then remove all six tables' rows, then the congregations) needs `presby.affiliation_trigger_active` set in the transaction, because the affiliation guard refuses a bare delete; it is plausible but untested here. Making `about_org_id` `on delete cascade` would allow it, but the design (and `congregation_oversight`) keep it plain; not changed.
2. **`policy_year` is in the insurance guard's immutable list.** The design's table listed only the identity columns for insurance years; the API contract says the year is not editable. On `presby_app` the column grant already refuses it; adding it to the guard makes it hold on the owner path too (an import correction removes and re-records). Strictly stronger; revert by deleting one word if ruled otherwise.
3. **No Western Basin row in the seed.** The Western Basin has no member congregation in `seed-dev.sql`, and adding an organization moves several test-rls invariants (one canonical name row per organization, the backfill completeness counts). Cross-presbytery checks build their own: test-rls-89 uses the Western Basin, the Southern Fields (Quillhaven departed in 1995) and the Synod (a row about the Tidewater) as they are; D2 mints throwaway councils.
4. **Seed fixture ids** (chosen here, not at integration; grepped free): person `c0890000-0000-4000-8000-000000000001` (Linnea Harrowgate), user `e0890000-...-0001` (`finance.fixture@example.invalid`, shared fixture password), role `f0890000-...-0001` ("Oversight Finance", custom, finance key only), rows `b0890000-...-0001` to `-0006`. She is a staff member of the Northern Reach with no roll, so the presbytery member count in test-rls moves 2 to 3 (in the patch). She holds a flagged key, so her first sign-in asks for two-factor enrolment. The clerk role `f...00e` is untouched (manage only).
5. **Guard refusals carry a CONSTRAINT name** (`oversight_guard_insert_removed`, `_removal_final`, `_immutable`, `_building_removed`; SQLSTATE 23514), exported as `OVERSIGHT_GUARD_CODES` for B2's `store.ts` mapping. The about-org refusal is SQLSTATE 42501 with the message "was not affiliated with this council" (0045's deny helper); a column-grant refusal is also 42501 ("permission denied"), and an RLS WITH CHECK refusal too ("row-level security"), so B2 maps by message or, better, never reaches them.
6. **For a ruling (not changed):** a tenant (`presby_app`) insert may set `provenance = 'imported'`; the design reserves `imported` for the owner-run import but neither grants nor the guard enforce it. One line in the guard's INSERT arm would (non-owner insert must be `presbytery_entered` where the column exists). Low risk either way; B2's store never sets it.
7. **Correction in place, one caution:** FKs and unique keys are inline in `create table if not exists`, so a corrected FK or unique would not reach a database that already ran 0089 (CHECKs are drop-then-add and would). The 0078/0085 files share this; only matters if an in-place correction touches a key.
8. The F362 hazard paragraph is in the header; no open branch carries F362 (Phase 3), so 0089 lands first.

Handoff to **api-developer (B2)**: import `@/lib/db/domain/oversight` directly (re-exported from `index.ts` only at integration). Local apply: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0089_presby_oversight_records.sql`, then `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/oversight/seed-dev-oversight.sql`. test-rls sections added: 89 (new file), 44a (one assertion, in the patch), the presbytery member count (in the patch), 46j, 72b.

Strings added or changed: none user-facing (the permission description is the design's verbatim Roles-screen label, `drizzle/0089_presby_oversight_records.sql` section 1).

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
