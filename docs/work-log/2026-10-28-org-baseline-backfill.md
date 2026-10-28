# Backfill the baseline setup for pre-provisioning organizations — Work Log

> **Slug:** `2026-10-28-org-baseline-backfill`
> **Surface:** (admin) — the founding-administrator invitation on `/admin/organizations/<id>`
> **Permission(s):** existing keys cover this (no change)
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (production defect; migration `0082` applied to production before the pipeline closed, by the operator's approval)
> **Release:** 0.49.1 (patch)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (brief, recorded by implementer) | Done | Bug confirmed | 2026-10-28 |
| 2 — Architectural review | architect | Skipped | no new deps or structural change; no invariant touched | 2026-10-28 |
| 3 — Technical design | tech-lead | Skipped | root cause recorded below; the fix is one data-only migration | 2026-10-28 |
| 4 — Implementation | full-stack-developer | Done | — | 2026-10-28 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (brief, bug-fix variant)

## VERDICT

READY FOR DESIGN (bug confirmed; the fix preserves intended behaviour).

## ONE-LINE TAKE

> One presbytery, created before provisioning existed, could not be sent a founding-administrator invitation.

## What happened

The operator tried to send a founding-administrator invitation for the production
presbytery and got: "This organization is missing its baseline setup or a role
template — contact an engineer before sending an invitation." That string is the
`provisioning_incomplete` outcome of `createInvitation()`
(`src/lib/onboarding/issue.ts`).

**Bug is real:** the refusal is correct code reading incorrect data. The
invitation is the only way a presbytery gets its first administrator
(DECISION-183), so the organization was stranded until an engineer intervened.

**Intended behaviour preserved:** every organization created today gets a
derived, protected "Active Membership" roster group and a constitutional,
protected `member` role holding `directory.view` and `events.view`, granted to
that group (`groupSeedPlan()` and `baselineRoleSeedPlan()` in
`src/lib/org-provisioning.ts`). The fix adds exactly that, in that shape, to any
organization missing it, and changes no application code and no refusal.

# Phase 2 — Architectural Review

Skipped: no new dependency, no structural change, no invariant touched. The
migration inserts ordinary tenant rows an organization already receives at
creation, adds no table, column, function or grant, and the application code is
unchanged.

# Phase 3 — Technical Design

Skipped: the fix is a single data-only migration. Root cause and rulings below.

**Root cause.** One presbytery was created on 2026-08-31, before
`src/lib/org-provisioning.ts` seeded the derived `active_membership` group and
the baseline `member` role. The seeding runs at creation, so the organization
never received them, and `provisioningComplete()` in
`src/lib/onboarding/issue.ts` requires that group. Migrations `0062` and `0068`
backfilled the congregation-only seats (session, diaconate, deacons moderator)
but nothing backfilled the baseline for older organizations of other types.

**Operator approval to apply first.** The orchestrator put the question to the
operator, who answered "Yes, do it now". The migration was therefore applied to
production before this pipeline's code review, not at deploy. Recorded here so
the order is not read as a skipped gate.

# Phase 4 — Implementation

## What was applied, and in what order

1. `drizzle/0082_presby_backfill_org_baseline.sql` written by the orchestrator.
2. Rehearsed twice on a production-derived Neon branch: the first run added 1
   organization, the second added 0, and an existing already-provisioned
   organization was unchanged.
3. Production snapshot `snap-lingering-heart-axrxc9ch` taken first, then applied
   to production (with `-1`, as owner).
4. Applied to the shared `development` branch, where it added the member role to
   15 fixture organizations.
5. `scripts/test-rls.sql` run on `development` as `presby_app`: only the known
   drift at lines 219 and 7953.

No real organization is named in this log; the affected organization is "one
presbytery created before provisioning".

## What the migration does (read, not changed)

- A stop-block: refuses to run if an organization lacks the group but has live
  memberships (the derived roster would need syncing; done deliberately, not
  here). Production had none.
- Inserts the `Active Membership` roster group (derived, protected) for every
  organization without one (`on conflict (organization_id, derived_from) do
  nothing`).
- For each organization with that group and no org-owned `member` role: inserts
  the `member` role (constitutional, protected), its two permissions, and the
  grant to the group. An organization that already holds a `member` role is left
  alone (a migration never adds authority to a tenant-held role; 0068's rule).
- Idempotent.

## Files Created

- `drizzle/0082_presby_backfill_org_baseline.sql` — the backfill (the orchestrator's; committed here unchanged).
- `src/lib/db/domain/org-baseline-backfill.db.test.ts` — the regression test (below).
- `docs/work-log/2026-10-28-org-baseline-backfill.md` — this file.

## Files Modified

- `drizzle/meta/_journal.json` — idx 82 entry, shaped like idx 80 (`version "7"`, `breakpoints true`, `when` = the time of writing, after idx 80's). Idx 81 is unused, as the journal already skips numbers.
- `docs/TODO.md`, `docs/deployment.md`, `docs/release-notes/v0.49.md`, `docs/briefings.md`, `package.json`, `package-lock.json` — housekeeping and release 0.49.1 (second and third commits).

## Schema Changes

Data-only: no table, column, index, function, policy or grant is created or
altered. Applied via the hand-written file with `psql -1` as owner (production
and `development`), never Drizzle Kit. `npm run check:schema-parity` still
reports 0 failing (7 differences, all allowlisted, unchanged), and
`scripts/export-table-definitions.py` exports the file without error.

## Audit Events

None. The migration writes ordinary rows an organization receives at creation,
which write no audit row either; the operator's application of it is recorded
here and in `docs/deployment.md`.

## Regression test

`src/lib/db/domain/org-baseline-backfill.db.test.ts` (DB-backed, serial; the
migration is global, so it must not run beside another DB suite). Fixture:
`fx.makeBareOrg()`, an organization stamped `deletable_until` with no derived
group and no roles, the shape of a pre-provisioning organization. The migration
file is read and executed as owner in one transaction, as the apply was.

- **a pre-provisioning organization ... no longer refused** — before: zero
  group/role/permission/grant rows, and the real `createInvitation()` returns
  `provisioning_incomplete` and creates no invitation; after 0082: the group,
  the `member` role (constitutional, protected, `directory.view` and
  `events.view`) and the grant to that group exist, and the same
  `createInvitation()` returns `ok`.
- **a second run inserts nothing**, and an already-provisioned organization is
  unchanged.
- **a tenant-held `member` role is left alone** — the group is added, the role
  and its permissions are not touched, and no grant is added.
- **the stop-block** refuses an organization with a live membership and no group
  (built with the sync trigger off for the one insert, since 0017 now refuses
  that shape) and writes nothing.

**Red before, green after.** With the migration step commented out the first
three cases fail (the first at the missing group, the second at counts of 0
against 1, the third at 0 groups); with it restored all four pass. The
stop-block case does not depend on the step.

## Gates

- `npm run typecheck`: pass. `npm run lint` (max-warnings 0): pass. `npm run check`: all eight tripwires pass.
- `npm test` (unit): 701 files passed, 115 skipped (DB-backed, no `.env.local`); 10,785 tests passed, 3,198 skipped.
- Serial DB run, `src/lib/onboarding` plus the new test, with `--no-file-parallelism`: 32 files, 612 tests, all passed.
- `npm run check:schema-parity`: 0 failing.
- The `development` database holds no organization lacking the group and no leftover fixture from this suite after a run.

## Implementer Notes

- The test copies `.env.local` from the main checkout into this worktree for the run and the copy is removed at the end; nothing is printed or committed.
- `development` already had 0082 applied before the test ran, so the test
  creates its own bare organizations and the migration is a no-op for everything
  else there.
- The release note's non-engineer text, per the operator: a presbytery set up
  before automatic setup existed could not be sent a founding-administrator
  invitation; it now can; applied directly to production on 2026-10-28.

Strings added or changed: none (the existing `provisioning_incomplete` copy is unchanged and is still correct for a genuinely unprovisioned organization).

**Next agent:** qa (Phase 5). Nothing to test in a browser beyond the operator's own re-send of the invitation in production, which is theirs to do; the unit and DB suites above are the verification.
