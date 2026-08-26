# Org-Provisioning Baseline Roles — Work Log

> **Slug:** `2026-08-26-org-provisioning-baseline-roles`
> **Surface:** platform admin only — `createOrganization()`'s provisioning transaction (`src/lib/org-provisioning.ts`), reached from `/admin/organizations/new`
> **Permission(s):** none new. Reuses the existing `member` role / `directory.view` permission / Active-Membership group precedent (F16, DECISION-063/065) — no new `permissions.key`, no new `FEATURES.*` key. `/admin/organizations/*` stays gated on the existing `FEATURES.ADMIN_ORGANIZATIONS`.
> **Flag(s):** not needed — mechanical provisioning logic, no gated surface, same posture as the F16 group seed it extends.
> **Estimated complexity:** small — one function, one existing transaction, no schema change, no new UI.
> **Pipeline mode:** Full, but a small one. Split out of `docs/work-log/2026-08-26-groups-and-officers.md` at Phase 2 (architect, 2026-08-26) — see that file's Phase 2 for the split reasoning. This file carries forward only the gap-2 slice of that pipeline's Phase 1, plus a completed Phase 2 (the architect ruled directly on the FK-collision and templating questions rather than deferring them to a second review pass).
> **Source — operator direction (2026-08-26):** originally scoped as half of "lets also plan groups and officers" (combined pipeline); split at Phase 2 per the architect's ruling in the sibling file.

**Scope note, load-bearing:** this pipeline closes **only** the `member`/`directory.view`/Active-Membership half of the original gap-2 description. The `stated_clerk`-equivalent "founding administrator" bootstrap — granting the *first* real tenant role to a named person at a freshly provisioned, real (non-fixture) organization — is **out of scope here, and not deferred as a follow-up owned by this pipeline**. It is deferred wholesale to the already-queued **P2 (backbone and onboarding)** pipeline (`docs/STATE.md`'s pipeline queue), because it depends on person/membership creation, which itself does not exist as an in-app path for a fresh org today (see Phase 2 below). Do not re-scope this pipeline to include it without a fresh Phase 1.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (carried forward, gap-2 slice) | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-100 | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | api-developer | Complete | Implemented as designed | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

*(Carried forward from the combined `2026-08-26-groups-and-officers` Phase 1, gap-2 slice only. Verbatim where it applies; see that file's own Phase 1 for the full original combined write-up, including the gap-1 material that stays there.)*

## VERDICT

**READY WITH NOTES** — the gap is real and mechanically resolvable in part; the harder half (founding-administrator bootstrap) is structurally larger than "seed some rows" and may not be closeable inside `createOrganization()`'s current input shape at all.

## ONE-LINE TAKE

> Gap 2 splits cleanly into a trivial mechanical fix (seed `member`/`directory.view`/Active Membership — no new input, no UI) and a genuinely unsolved bootstrap problem (there is no in-app path, today, for anyone to grant the *first* tenant role — or even create the first person+membership — at any real, non-fixture organization).

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Platform admin | Create an organization at `/admin/organizations/new` (existing flow) | One-time per org |
| *(no end-user verb — pure backend)* | `createOrganization()` seeds a `member` app_role bound to `directory.view`, granted to the new org's `active_membership` group, in the same transaction as the F16 group seed | Automatic, every org creation |

## Flows

**Flow 4 — Provision an organization with a working baseline:** entry `/admin/organizations/new` (existing) → platform admin fills name/slug/type/status → submit → `createOrganization()`'s one transaction gains a new step: seed a `member` `app_role` (constitutional, protected) bound to `directory.view`, granted via `role_grants` to the just-created `active_membership` group — mechanical, no new admin input required, mirrors the F16 group-seed pattern exactly.
- Failure: existing branches (`slug_taken`/`reserved_slug`/`provisioning_incomplete`) unchanged.
- **The `stated_clerk`-equivalent half does not fit this flow as a same-transaction step**, and — per Phase 2's ruling — does not fit anywhere in this pipeline at all. See Phase 2 below.

## Permissions & Flags

- The `member`/`directory.view`/Active-Membership seed needs **no new permission and no flag** — unconditional provisioning logic, same as F16's group seed.
- The `stated_clerk`-equivalent bootstrap's permission question is moot for this pipeline — it isn't being built here (Phase 2).

## Gaps the Request Didn't Address

- **The FK collision.** "Seed baseline roles at provisioning" reads as a small backend fix; half of it (`member`) is — the other half (`stated_clerk`) cannot be done inside `createOrganization()`'s current shape without a person/membership to grant to, because `role_grants_person_fk` requires an existing `(person_id, organization_id)` row in `memberships`, and a brand-new org has zero people. **Resolved by Phase 2 below**: deferred to P2 (backbone and onboarding) in full, not built as a narrower escape hatch — tracing `/o/[slug]/admin/members` showed there is no in-app path to create the first person+membership either, so a "grant the first role" action alone wouldn't close the real gap.
- **Without closing at least the `member`/`directory.view` half, every future non-fixture organization inherits the exact bootstrap gap `fpcw` hit in dev** (2026-08-25) for the directory specifically. This pipeline closes that much.

## Out of Scope (confirmed by Phase 2)

- **The `stated_clerk`-equivalent bootstrap escape hatch — confirmed out of scope entirely**, not merely deferred as this pipeline's own follow-up. It belongs to P2 (backbone and onboarding) in full, including the person/membership creation it depends on. Do not build a partial version of it here.
- `app_roles.organizationTypeScope`/`organizationId IS NULL` "seed template" columns — confirmed to stay dormant for this pipeline's seed (Phase 2); extend the inline-plan pattern instead.
- Everything gap 1 covers (officer-terms admin UI) — lives in the sibling file, `docs/work-log/2026-08-26-groups-and-officers.md`.

## Open Questions (resolved by Phase 2, recorded here for the record)

- ~~Is the `stated_clerk`-equivalent bootstrap in scope for this pipeline at all?~~ **No — resolved, deferred to P2 in full.**
- ~~Should Phase 3 wire the dormant `organizationTypeScope` template columns, or extend the inline-plan pattern?~~ **Extend the inline pattern — resolved.**

## Handoff

**Next: tech-lead (Phase 3).** Carry forward Phase 2's full ruling below — especially that the seed targets the `role_grants` **group arm** (not the person arm), that no schema change is needed, and that the founding-administrator bootstrap is not this pipeline's to design even partially.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.**

## Placement

- **Directory placement:** no new files or directories required beyond an extension of `src/lib/org-provisioning.ts`'s existing `createOrganization()` and a `groupSeedPlan()`-sibling helper (`baselineRoleSeedPlan()`, see Notes). No new route, no new page, no new `db/domain/` file — every table involved (`app_roles`, `app_role_permissions`, `role_grants`) already exists with the exact shape needed.
- **Server vs. Client split:** N/A — entirely inside an existing `server-only` module (`org-provisioning.ts` already has `import "server-only"` at the top), invoked from the existing `createOrganizationAction` in `(admin)/admin/organizations/new/actions.ts`. No client code, no new component.
- **Dependencies:** none. No new package; the mechanism is three additional `INSERT`s (`app_roles`, `app_role_permissions`, `role_grants`) inside the transaction `createOrganization()` already opens, using Drizzle's existing table exports.

## Invariants Touched

- **No Role Carries a Wildcard** — the seeded `member` role is bound to exactly `directory.view`, mirroring the existing Alder Creek fixture's own `member` role exactly (`scripts/seed-dev.sql`'s Authorization block, DECISION-063/065/066) — no scope creep.
- **Composite Tenant Keys** — the `role_grants` insert must use the **group arm** (`groupId` = the freshly-inserted `active_membership` group's id from this same transaction, `personId` left null), never the person arm. Confirmed against `role_grants_principal_check` (`num_nonnulls(personId, groupId) = 1`) and `role_grants_group_fk` (composite, `groups(id, organization_id)`) — both satisfiable in-transaction because the group row is inserted two statements earlier in the same `tx`. This is the one detail Phase 3 must get exactly right — the person arm would immediately FK-violate, for the same structural reason the `stated_clerk`-equivalent bootstrap cannot be done this way.
- **Permissions vs. Flags** — no new permission key, no new flag. The seed is unconditional provisioning logic, identical in kind to the F16 group seed it sits beside.
- **Isolation Is a Database Property** — not implicated; all writes go through `getPlatformDb()`, already the correct connection for org-creation, same as the existing `organizations`/`groups` inserts in the same function.

## Notes

1. **FK-collision ruling (DECISION-100):** the `member`/`directory.view` seed is closeable now via the `role_grants` group arm — build it. The `stated_clerk`-equivalent founding-administrator bootstrap is **not** this pipeline's, in any form — deferred to P2 (backbone and onboarding) in full, because `/o/[slug]/admin/members` (the only in-app path to create a person+membership) is itself gated on `people.manage`, which nobody holds at a fresh org. Do not build a partial version "just for now."
2. **`app_roles` template-column ruling (DECISION-100):** do not wire `organizationTypeScope`/`organizationId IS NULL`. Add a `baselineRoleSeedPlan(organizationType)` helper sibling to `groupSeedPlan()`, returning the one uniform `member`/`directory.view` plan item for every organization type today — same inline-conditional shape, ready to branch later if a genuinely type-varying baseline role is ever proposed.
3. **Audit:** no new `AUDIT_ACTIONS` key needed. The baseline-role seed is a mechanical, automatic consequence of org creation — already covered by the existing `AUDIT_ACTIONS.ORG_CREATED` write in `(admin)/admin/organizations/new/actions.ts`. Phase 3 may enrich that event's metadata with the seeded `role_grants` id if useful, but a second audit write would duplicate the org-creation event for no new information.
4. **`docs/TODO.md` reconciliation, at whichever commit ships this (Rule 10):** narrow the existing "Org provisioning seeds derived groups but no baseline roles... Needs its own pipeline" line to reflect that the `member`/`directory.view` half is closed by this pipeline, and that the founding-administrator half is tracked under P2's own queue entry in `docs/STATE.md`, not as a new standalone TODO line implying an escape hatch is still owed.
5. **Test coverage:** `src/lib/org-provisioning.test.ts` already exists and already exercises `createOrganization()` directly — the new assertion is additive: after a successful `createOrganization()` call, a `member` `app_roles` row, its `app_role_permissions` row, and a group-arm `role_grants` row all exist at the returned `organizationId`, and a second organization's rows don't leak into the first (composite-key discipline, F2-style assertion at the unit level — `scripts/test-rls.sql` should also gain a small addition per its own existing per-pipeline pattern).

## Implementer(s) Phase 3 should expect

**api-developer**, single commit. No database-admin needed (no schema change, no migration); no ux-developer needed (no UI).

## Handoff

**Next: tech-lead (Phase 3), for this file only.** Carry forward: the group-arm-not-person-arm requirement (the single most load-bearing detail here), the `baselineRoleSeedPlan()` naming/shape, the "no new audit key" ruling, and the confirmed-out-of-scope founding-administrator bootstrap (do not let it creep back in during design). This pipeline is intentionally small — resist expanding it.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

`createOrganization()` seeds the F16 derived groups (Session, Board of Deacons,
Active Membership) but nothing else — every freshly provisioned org has
groups and zero working roles, so `directory.view` resolves for nobody and the
directory is unreachable until someone hand-seeds a role (the `fpcw` bug this
pipeline exists to close for good). This design extends `createOrganization()`'s
existing transaction with one more step: seed a constitutional `member` app
role bound to `directory.view`, granted through `role_grants`' **group arm** to
the org's own freshly-inserted `active_membership` group. The seeded rows are
byte-for-byte the same *shape* as the Alder Creek fixture's own `member` role
(`scripts/seed-dev.sql` lines 266–267, 303, 372–373) — same key, same name,
same `role_kind`/`is_protected`, same permission, same derived-group target —
so every organization created through the real admin flow from this commit
forward starts in the same working state the dev fixture has always modeled.
Nothing here reaches toward the `stated_clerk`-equivalent founding-administrator
bootstrap; that remains out of scope per DECISION-100 and Phase 2's ruling.

## Permissions & Flags

- Permission key(s): none new. The seed *grants* the existing `directory.view`
  key (global catalog row, seeded by migration `drizzle/0017_presby_membership_
  roster.sql`, not by an app-level seed script — see Edge Cases for why that
  distinction matters here) to a role. No `FEATURES.*` key changes;
  `/admin/organizations/*` keeps its existing `FEATURES.ADMIN_ORGANIZATIONS`
  gate, unmodified by this change.
- Default role bindings: the new `member` `app_roles` row is bound to
  `directory.view` only — no other permission, per "No Role Carries a
  Wildcard." It is granted to the org's `active_membership` **group** (not to
  any person — there are no people yet at a brand-new org).
- Feature flag(s): not needed. Unconditional provisioning logic, same posture
  as the F16 group seed it sits beside.

## API Contract

No route, no server action signature change. This is a private, internal
addition inside an existing `server-only` module. `createOrganization()`'s
public signature and `CreateOrganizationResult` union are **unchanged** — same
inputs, same four outcome kinds (`ok` / `invalid_input` / `slug_taken` /
`reserved_slug` / `provisioning_incomplete`). The one new internal symbol:

```ts
// sibling to groupSeedPlan(), same file, same export visibility (module-
// private — not re-exported, matching groupSeedPlan()'s own visibility today)
function baselineRoleSeedPlan(
  organizationType: OrganizationType,
): Array<{
  key: string;              // "member" — app_roles.key
  name: string;             // "Member" — app_roles.name
  permissionKey: string;    // "directory.view" — app_role_permissions.permission_key
  boundToDerivedFrom: "active_membership"; // which of THIS transaction's
                                           // already-inserted groups rows to
                                           // bind role_grants.group_id to
}>
```

Per Phase 2 Note 2 / DECISION-100: this returns the **same one-item plan for
every `organizationType`** today (congregation, presbytery, synod,
general_assembly, new_worshiping_community all get exactly `member` /
`directory.view` / `active_membership`). The `organizationType` parameter is
taken — and unused in the body — purely so the helper is call-compatible with
`groupSeedPlan()`'s shape and ready to branch the day a genuinely type-varying
baseline role is proposed, without a signature change at that point. Do not
add a conditional branch pre-emptively; Phase 2 was explicit that a real
future need, not speculation, is what earns the branch.

## Data Model

No schema changes required. `app_roles`, `app_role_permissions`, and
`role_grants` already have the exact shape needed (confirmed against
`src/lib/db/domain/authz.ts`):

- `app_roles` — insert one row: `organizationId` = the new org's id,
  `key` = `"member"`, `name` = `"Member"`, `roleKind` = `"constitutional"`,
  `isProtected` = `true`. (`organizationTypeScope` stays `null` — Phase 2's
  ruling against wiring the dormant template-column path.)
- `app_role_permissions` — insert one row: `roleId` = the row above's
  generated id, `permissionKey` = `"directory.view"`.
- `role_grants` — insert one row: `organizationId` = the new org's id,
  `roleId` = the `app_roles` row's id, **`groupId`** = the id of *this same
  transaction's* `active_membership` group row (the **group arm** —
  `personId` stays `null`), `startsOn` left to its column default
  (`defaultNow()` — the grant starts when the org itself starts, unlike the
  dev fixture's historical `'2000-01-01'`/`'2020-01-01'` backdates, which
  model a pre-existing congregation's history that a freshly provisioned org
  has none of).

## Component / Page Plan

- Pages to create: none.
- Components to create: none.
- Files to modify:
  - `src/lib/org-provisioning.ts` — add `baselineRoleSeedPlan()`; extend the
    `platformDb.transaction()` body in `createOrganization()` with the three
    new inserts described above, and add `.returning({ id: groups.id,
    derivedFrom: groups.derivedFrom })` to the existing `tx.insert(groups)`
    call (today it discards the inserted rows — the new step needs the
    `active_membership` group's generated id to bind `role_grants.group_id`
    to, found by `derivedFrom === "active_membership"`, not by array
    position).
  - `src/lib/org-provisioning.test.ts` — extend the existing "creates a
    congregation…" and "creates a presbytery…" tests with assertions for the
    new `member` `app_roles` row, its `app_role_permissions` row, and its
    group-arm `role_grants` row; add one cross-org assertion in the style of
    F2 (a `role_grants` query scoped to one test's `organizationId` must not
    return the other test's role/grant rows) — unit-level, complementing
    rather than duplicating the RLS-level proof below.
  - `scripts/test-rls.sql` — append one small section (after the existing
    final section) modeled exactly on section 15's (`690`) shape: assert the
    Alder Creek fixture's existing `member` role (`f0000000-…-004`) and its
    group-arm grant are visible under `:ALDER` and invisible (including by
    known-id lookup) under `:BRAMBLE`. This role/grant pair already exists in
    `scripts/seed-dev.sql` from an earlier pipeline (P1/G-A, DECISION-060/063)
    — it has never had its own isolation assertion, and it is now the exact
    shape `createOrganization()` will produce for every future org, so
    proving it here is directly on point. **No `scripts/seed-dev.sql` edits
    needed** — the fixture rows already exist.
  - `docs/TODO.md` — narrow the existing "Org provisioning seeds derived
    groups but no baseline roles…" line per Phase 2 Note 4: state the
    `member`/`directory.view` half is closed by this commit, and that the
    founding-administrator half is tracked under P2 (backbone and onboarding)
    in `docs/STATE.md`'s queue, not as a standalone TODO line.

## Implementation Order

1. No schema step — `app_roles`/`app_role_permissions`/`role_grants` are
   already live.
2. No `FEATURE_CATALOG` entry — no new permission or flag key.
3. `baselineRoleSeedPlan()` + the three-insert extension to
   `createOrganization()`'s transaction (`src/lib/org-provisioning.ts`).
4. No UI.
5. No new audit event — the existing `AUDIT_ACTIONS.ORG_CREATED` write in
   `(admin)/admin/organizations/new/actions.ts` already covers org creation as
   a whole; Phase 2 Note 3 explicitly rules out a second write for this.
6. Test coverage: extend `src/lib/org-provisioning.test.ts` and add the
   `scripts/test-rls.sql` section, both described above.
7. `docs/TODO.md` reconciliation, in the same commit (Workflow Rule 10).
8. Release notes: tech-lead's own follow-through at Phase 6 per this agent's
   ownership section, not the implementer's task — flagging now that this is
   likely a one-line internal/infra entry (it corrects an already-shipped
   admin flow's bootstrap gap; it introduces no new member-visible surface,
   so Workflow Rule 13's what's-new consideration and Rule 14's
   functionality-map bullet are both expected to be "no change needed," to be
   confirmed at Phase 6 rather than assumed here).

## Edge Cases & Risks

- **Group-insert ordering is load-bearing.** The `active_membership` group
  row must exist in the transaction *before* the `role_grants` insert
  attempts to reference it — already true today (group insert is the second
  statement in the transaction), but the implementer must find the group's
  id from the `.returning()` result **by `derivedFrom === "active_membership"`**,
  not by trusting `groupSeedPlan()`'s array position, since a congregation's
  plan has three rows and a non-congregation's plan has one, at different
  positions.
- **Group arm, never person arm — the single most important detail carried
  from Phase 2.** `role_grants_person_fk` requires an existing
  `(person_id, organization_id)` row in `memberships`; a brand-new org has
  none. Using the person arm here would FK-violate on every single org
  creation, not just intermittently — this would be caught immediately by
  the extended test in `org-provisioning.test.ts`, but it is exactly the
  mistake this design exists to prevent by being explicit about it twice.
- **Why `directory.view` needs no `provisioning_incomplete`-style guard,
  unlike `group_types`.** `createOrganization()` already fails closed
  (`provisioning_incomplete`) if the platform-wide `group_types` rows are
  missing, because those are seeded by `scripts/seed.ts` — an operational,
  app-level seed step that can genuinely lag a fresh database. `directory.
  view` is different: it's inserted by migration `0017`, which every
  environment capable of reaching `createOrganization()` at all has already
  applied (the `app_roles`/`app_role_permissions`/`role_grants` tables
  themselves don't exist before later migrations either). If this permission
  row were somehow missing, the `app_role_permissions` insert would raise a
  foreign-key violation (`23503`), the whole transaction would roll back
  (no partial org), and the existing `catch` block's `isUniqueViolation`
  check (`23505` only) would correctly *not* swallow it — it would rethrow
  raw, surfacing as a genuine 500 rather than a silently mis-mapped
  `slug_taken`. That's acceptable: it would mean a migration was skipped, an
  operational fault well outside this pipeline's scope to guard against.
- **Pre-existing `isUniqueViolation` catch is now shared by three inserts,
  not two.** The catch block maps *any* `23505` in the transaction to
  `slug_taken` — already true before this change (it covered the
  `organizations` and `groups` inserts) and unaffected by adding a third kind
  of insert, since `app_roles_org_key`'s unique constraint
  (`organization_id, key`) cannot collide for a brand-new org's first-ever
  `member` role. Naming this because it's a real, if theoretical, blind
  spot — not proposing a fix, which would be scope creep for this pipeline.
- **Existing-spec blast radius:** `src/lib/org-provisioning.test.ts`'s three
  `createOrganization()`-based tests assert exact `groups` row counts (3 for
  congregation, 1 for presbytery) but query the `groups` table only — adding
  rows to `app_roles`/`app_role_permissions`/`role_grants` does not touch
  those counts and does not break them. No other existing spec (unit or e2e)
  calls `createOrganization()` or asserts on `app_roles`/`role_grants` counts
  scoped to a freshly created org, so no further existing-spec blast radius
  beyond the file being extended. `scripts/test-rls.sql`'s existing sections
  (including section 15, whose shape this new section mirrors) are additive
  and unaffected — no existing assertion counts `app_roles`/`role_grants`
  rows in a way this new insert would change, since the new rows only exist
  at orgs created *through this code path*, and no existing test-rls.sql
  section creates an org through `createOrganization()` (that module runs
  under Node against `getPlatformDb()`, not inside `psql`).
- **Cross-org non-leak** is the one property worth naming as a genuine risk
  rather than a formality: composite-key discipline (F2) means a bug here
  would most likely be "the `role_grants` row points at the wrong org's
  group" (a copy-paste of the wrong id across two test orgs, or a stale
  variable reused across the congregation/presbytery test cases) rather than
  an RLS gap — this file's tests run against `getPlatformDb()`, which
  bypasses RLS entirely, so only the unit-level id-scoped assertion (not RLS)
  catches that particular mistake. The `scripts/test-rls.sql` addition proves
  the orthogonal claim (RLS actually filters these tables for these roles),
  which the unit test cannot.

## Implementer

**api-developer**, single commit — per Phase 2's ruling: no schema change (no
database-admin), no UI (no ux-developer). Carries forward from Phase 2
unchanged.

## Handoff

**Next: api-developer (Phase 4).** Carry forward, in priority order: (1) the
group-arm-not-person-arm requirement — get this wrong and every org creation
FK-violates; (2) find the `active_membership` group's id from the `groups`
`.returning()` result by `derivedFrom`, not by array position, since the
congregation and non-congregation plans have different lengths; (3)
`baselineRoleSeedPlan()` takes `organizationType` but returns the same
one-item plan for all of them today — do not add branching speculatively; (4)
no new audit key, no new permission key, no new flag, no schema change, no UI
— this stays a single small commit touching
`src/lib/org-provisioning.ts`, `src/lib/org-provisioning.test.ts`,
`scripts/test-rls.sql`, and `docs/TODO.md`; (5) the `docs/TODO.md` line
narrowing (Phase 2 Note 4) ships in the same commit per Workflow Rule 10.

---

# Phase 4 — Implementation

**Date:** 2026-08-26
**Implementer:** api-developer

## Files Created

- none

## Files Modified

- `src/lib/org-provisioning.ts` — imported `appRoles`, `appRolePermissions`,
  `roleGrants` from `@/lib/db/domain/authz`. Added `baselineRoleSeedPlan(organizationType)`,
  sibling to `groupSeedPlan()`, same module-private visibility, same
  inline-conditional shape — returns the one uniform plan item
  (`key: "member"`, `name: "Member"`, `permissionKey: "directory.view"`,
  `boundToDerivedFrom: "active_membership"`) for every `organizationType`
  today; the parameter is accepted and unused, kept only for call-compatible
  symmetry with `groupSeedPlan()` per Phase 3/DECISION-100. Extended
  `createOrganization()`'s existing `platformDb.transaction()`: (1) added
  `.returning({ id: groups.id, derivedFrom: groups.derivedFrom })` to the
  existing `tx.insert(groups)` call; (2) after the group insert, loop over
  `baselineRoleSeedPlan()`'s plan items, for each one finding its bound group
  by `derivedFrom` (never array position — a congregation's plan has three
  groups, a non-congregation's plan has one, at different positions), then
  inserting one `app_roles` row (`roleKind: "constitutional"`, `isProtected:
  true`, `organizationTypeScope` left null per DECISION-100), one
  `app_role_permissions` row binding it to the existing `directory.view`
  permission key, and one `role_grants` row using the **group arm only**
  (`groupId` = the bound group's id, `personId` left implicit/null,
  `startsOn` left to its column default). Throws (rolling back the whole
  transaction) if the plan names a `derivedFrom` group that wasn't seeded —
  defensive/unreachable today, named in Phase 3's Edge Cases.
  `createOrganization()`'s public signature and `CreateOrganizationResult`
  union are unchanged.
- `src/lib/org-provisioning.test.ts` — imported `appRoles`,
  `appRolePermissions`, `roleGrants` alongside the existing dynamic-import
  harness. Extended the congregation test with assertions on the seeded
  `member` `app_roles` row (key/name/roleKind/isProtected), its single
  `app_role_permissions` row (`directory.view`), and its single `role_grants`
  row (group arm — `personId` null, `groupId` equal to the org's own
  `active_membership` group's id, found by `derivedFrom`). Extended the
  presbytery test with the same role/grant assertions (lighter — no group
  row-count/name repetition since section covers that already). Added a new
  test, "does not leak one organization's baseline role/grant rows into
  another's (composite-key discipline, F2-style)": creates two organizations,
  asserts each has exactly one `app_roles` row and one `role_grants` row
  scoped to its own `organizationId`, that the two roles' and two grants'
  ids/group-ids never cross, and that neither org's query returns the
  other's row.
- `scripts/test-rls.sql` — added `\set MEMBER_ROLE` and
  `\set ALDER_ACTIVE_MEMBERSHIP_GROUP` alongside the existing section-15
  role-catalog `\set`s. Appended a new "21. Org-provisioning baseline roles"
  section, modeled exactly on section 15's shape: under `:ALDER`, asserts the
  existing Alder Creek fixture's `member` role (`f0000000-…-004`) and its
  group-arm grant (`role_id = MEMBER_ROLE`, `group_id =
  ALDER_ACTIVE_MEMBERSHIP_GROUP`, `person_id is null`) are visible; under
  `:BRAMBLE`, asserts both are invisible by filter and by known-id lookup
  (role by id, and the group itself by id) — six assertions total. No
  `scripts/seed-dev.sql` edits — the fixture rows already existed from an
  earlier pipeline (P1/G-A, DECISION-060/063) and had never had their own
  isolation assertion until now.
- `docs/TODO.md` — moved the "Org provisioning seeds derived groups but no
  baseline roles" line from **Next Up** to **Done** (2026-08-26), narrowed to
  state that the `member`/`directory.view` half is closed by this pipeline
  and that the founding-administrator half is tracked under the queued P2
  (backbone and onboarding) pipeline per DECISION-100 — not re-added as a new
  standalone Next-Up line.

## Schema Changes

- none — `app_roles`, `app_role_permissions`, and `role_grants` already had
  the exact shape needed; no migration, no `db:push`.

## Audit Events

- none — the existing `AUDIT_ACTIONS.ORG_CREATED` write in
  `src/app/(admin)/admin/organizations/new/actions.ts` already covers org
  creation as a whole (Phase 2 Note 3 / Phase 3 explicitly ruled out a second
  write for this mechanical, unconditional seed).

## Implementer Notes

- Implemented exactly per Phase 3's design — no deviation in shape. One
  small internal choice within the spec's latitude: `baselineRoleSeedPlan()`
  items carry `boundToDerivedFrom` and the transaction loop looks up each
  plan item's bound group by that field (rather than hoisting a single
  `activeMembershipGroup` constant before the loop) — functionally identical
  for today's one-item plan, but keeps the lookup honest per-role for the day
  a second plan item with a different `boundToDerivedFrom` is added, matching
  the helper's own stated future-branch intent without requiring a second
  code change at that point.
- Added one defensive `throw` (transaction-aborting) if a plan item's
  `boundToDerivedFrom` group isn't found in the just-inserted `groups` rows.
  This is unreachable in practice today (`groupSeedPlan()` always includes
  `active_membership` for every `organizationType`), but Phase 3's Edge Cases
  named getting the group lookup right as the single most load-bearing
  detail in this pipeline, so failing loudly (whole-org-creation rollback)
  rather than silently skipping the role seed felt like the correct
  conservative default, not scope creep.
- Removed an `eslint-disable-next-line` I initially added over the unused
  `organizationType` parameter — `npx eslint` reported it as an unused
  directive (this repo's flat config doesn't flag unused function
  parameters), so a plain comment carries the intent instead.
- `npm run check` (the four-tripwire bundle) reports one pre-existing
  failure unrelated to this change: `check:brand-scope` flags two
  button-shaped class strings in `src/components/shared/pagination.tsx`.
  Confirmed pre-existing by `git stash`-ing this pipeline's diff and
  re-running the same check — it fails identically with none of this
  pipeline's changes applied. (The working tree also currently has
  substantial unrelated in-flight changes from sibling pipelines — e.g.
  `docs/work-log/2026-08-26-portal-fpcw-directory-ux.md`,
  `docs/work-log/2026-08-26-groups-and-officers.md` — not touched or
  reviewed here.) `check:audit`, `check:sql-date`, and `check:deps-drift` all
  pass clean.
- `scripts/test-rls.sql` could not be run to completion end-to-end against
  the dev database: section 10 (pre-existing, line ~324/331, "roll: cache
  agrees with replay") fails under `ON_ERROR_STOP=1` before execution ever
  reaches the new section 21 — `memberships.current_roll` cache drift is a
  documented, dated property of this system (CLAUDE.md → "The Roll Is the
  System of Record" — the daily reconcile and `presby_roll_cache_drift()`
  exist for exactly this), not something this pipeline's change touches.
  Confirmed unrelated the same way as the brand-scope finding above:
  `git stash` and re-run reproduces the identical failure at the identical
  line with none of this pipeline's changes applied. To verify section 21
  itself, I extracted just its six assertions (same `\set` variables, same
  bodies) into a standalone scratch file and ran it directly against the
  live dev database with `psql "$APP_DATABASE_URL"` — all six passed
  ("alder: sees its own member role", "alder: sees its own member role's
  group-arm grant, person_id null", and the four Bramblewood
  no-visibility/no-cross-org-by-known-id assertions). The section as
  committed in `scripts/test-rls.sql` is byte-identical to what was run this
  way. QA should re-run the full file once the pre-existing section-10 drift
  is independently resolved (out of scope here) to get the mechanical
  end-to-end confirmation; until then, this note plus the isolated run is
  the evidence available.

**Test/check output actually run (2026-08-26):**

```
$ npm run typecheck
> tsc --noEmit
(clean, no output)

$ npm run build
...
Route (app)  [37 routes, all compiled successfully]

$ npm run check
✓ check:audit — Audit-coverage check passed.
✓ check:sql-date — sql<Date> guard passed.
✓ check:deps-drift — Dependency-drift check passed.
✗ check:brand-scope — FAILED, pre-existing (see note above), unrelated to
  this pipeline's files.

$ npx dotenv -e .env.local -- vitest run src/lib/org-provisioning.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ npm run test   (full unit suite)
 Test Files  143 passed | 14 skipped (157)
      Tests  2104 passed | 279 skipped (2383)

$ psql "$APP_DATABASE_URL" -f <scratch section-21-only file>
pass  alder: sees its own member role (1)
pass  alder: sees its own member role's group-arm grant, person_id null (1)
pass  bramblewood: does not see alder's member role (0)
pass  bramblewood: sees no grants for alder's member role (0)
pass  bramblewood: cross-org read of alder's member role by known id returns zero (0)
pass  bramblewood: cross-org read of alder's active_membership group by known id returns zero (0)
```

## Handoff

**Next: qa (Phase 5).** No route/action/UI touched, so the feature-gate audit
table should read "no protected routes touched" (the change is entirely
internal to `createOrganization()`, invoked from the existing, unmodified
`/admin/organizations/new` action, itself already gated on
`FEATURES.ADMIN_ORGANIZATIONS`). Not an auth-touching diff (`src/auth.ts`,
`src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/` all untouched), so the
mandatory e2e-smoke gate does not apply. Please independently re-run
`scripts/test-rls.sql`'s new section 21 (and, time permitting, investigate
whether the pre-existing section-10 roll-cache-drift failure is something
worth flagging separately — it predates this pipeline and blocks the full
file from completing in one `ON_ERROR_STOP=1` run).

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS** — clean, re-run twice.

## Unit Tests

- `src/lib/org-provisioning.test.ts` (real DB, `dotenv -e .env.local`): 8/8 passed, ~3.6–3.9s. Confirmed non-vacuous — the same file with no `.env.local` shows all 8 skipped via the `hasDb` gate.
- Full suite (`npm run test`, standard invocation): 2104 passed / 279 skipped / 0 failed, 143 files passed, 14 skipped, ~5.5s.
- QA-initiated extra check (full suite with `.env.local` loaded): 2380 passed / 3 failed — all 3 in `rate-limit.test.ts` (untouched by this diff, last changed `54f3935`), caused by `.env.local`'s `RATE_LIMIT_DISABLED=true` short-circuiting that file's own assumption that rate limiting is active. An artifact of QA's own non-standard invocation, not a regression from this pipeline.

## End-to-End Tests

n/a — no `src/auth.ts`/`(auth)`/`api/auth`/`src/lib/auth/` touched; no route/action/UI added or changed. `createOrganization()` is a private `server-only` function; its one caller (`createOrganizationAction`) is pre-existing and unmodified. The stricter auth-touching e2e gate does not apply.

## Regression Tests Added

- `src/lib/org-provisioning.test.ts` — congregation test extended: asserts the seeded `member` `app_roles` row (key/name/roleKind/isProtected), its `app_role_permissions` row bound to `directory.view`, and its group-arm `role_grants` row (`personId` null, `groupId` = `active_membership`'s id). Guards against: a freshly provisioned congregation shipping with zero working roles (the `fpcw` dev bug this pipeline closes).
- `src/lib/org-provisioning.test.ts` — presbytery (non-congregation) test extended with the same assertions. Guards against: the seed being congregation-only by accident, given `groupSeedPlan()`'s differently-shaped non-congregation branch.
- `src/lib/org-provisioning.test.ts` — new test: two organizations created, each has exactly one `app_roles`/`role_grants` row scoped to its own `organizationId`, no cross-org leakage. Guards against: a copy-paste of the wrong org's id when binding `role_grants` inside the transaction.
- `scripts/test-rls.sql` §21 (lines 1286–1326) — 6 assertions as `presby_app`: Alder Creek sees its own seeded role + group-arm grant; Bramblewood sees neither by filter nor by known-id lookup. Guards against: no database-level isolation proof existing for this new seed shape. QA independently extracted and ran this section standalone against the live dev DB (not trusting the implementer's own run) — all 6 pass.

**Honesty note carried into the verdict:** QA verified these assertions only in their final, already-green state — it did not personally witness a failing-then-passing transition. The risk they cover (person-arm vs. group-arm FK) was independently confirmed real by reading the constraints, so the assertions are non-vacuous, but this is inference from the final state, not a witnessed red→green sequence.

## Coverage on Critical Modules

n/a — this diff touches none of `src/lib/permissions.ts`, `src/lib/two-factor.ts`, `src/lib/flags.ts`.

## Independent Verification of Two Pre-Existing-Failure Claims (both confirmed via `git stash`, not taken on faith)

1. **`check:brand-scope` failure on `src/components/shared/pagination.tsx`** — confirmed pre-existing (file untouched by this diff, last changed `9e2a69f`; failed identically against clean `HEAD` with this diff stashed out). **Since resolved** — fixed directly by the orchestrator during this session (converted to `<Button asChild>`/`disabled`, preserving touch targets), unrelated to this pipeline's own diff either way. `check:brand-scope` passes tree-wide as of the final run.
2. **`scripts/test-rls.sql` full-file halt at section 10** — confirmed pre-existing (fails identically against clean `HEAD` with this diff stashed out; a live dev-database roll-cache-drift condition, `memberships.current_roll`, documented in CLAUDE.md). Still open as a standing operational nuisance, unrelated to this diff. Section 21 (this pipeline's own addition) passes 6/6 when extracted and run standalone.

## Feature-Gate Audit

Verified by reading file bodies directly, not inferred from green tests.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `createOrganizationAction` (`src/app/(admin)/admin/organizations/new/actions.ts`) — sole caller of `createOrganization()` | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` — correct, unchanged by this diff |

No protected routes/actions were touched by this diff itself — `createOrganization()` has no route/action surface of its own; the one reachable entry point is pre-existing, unmodified, and its gate is intact.

## Verdict

**PASS**

Typecheck clean, build clean (37 routes), all four `check:*` tripwires pass, target unit test 8/8 against real DB (non-vacuous, confirmed), full suite clean under standard invocation, `test-rls.sql` §21's 6 isolation assertions independently re-run and passing. No new protected surface, no gate weakened. Not an auth-touching diff — e2e gate correctly n/a. Both flagged pre-existing failures independently confirmed via `git stash` rather than taken on faith.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> The `fpcw` bootstrap bug is closed exactly as scoped — every organization created through `/admin/organizations/new` from this commit forward gets a working `member`/`directory.view` grant via the `role_grants` group arm, nothing more and nothing less than Phase 2 approved.

## What's Working

- **The real bug is closed, not just modeled.** `createOrganization()` now inserts `app_roles` (`member`, constitutional, protected) → `app_role_permissions` (`directory.view`) → `role_grants` (group arm, bound to `active_membership` found by `derivedFrom`, not array position) inside the same transaction as the F16 group seed — exactly the gap `fpcw` hit in dev on 2026-08-25.
- **Group-arm discipline held all the way through** — the single most load-bearing detail in this pipeline. Verified directly in the code: no `personId` on the `role_grants` insert, `boundGroup` found via `derivedFrom` match, not array position.
- **The `stated_clerk`-equivalent bootstrap is correctly, verifiably absent** — no person/membership creation, no partial escape hatch. DECISION-100 and the `docs/TODO.md` reconciliation both correctly attribute that half to the queued P2 pipeline.
- **`app_roles.organizationTypeScope` stayed dormant as ruled** — `baselineRoleSeedPlan()` takes `organizationType` and ignores it, per DECISION-100's anti-premature-abstraction call.
- **Isolation independently proven, not asserted on faith** — `scripts/test-rls.sql` §21's 6 assertions were independently re-extracted and re-run by both the implementer and QA, not trusted from a single source.
- **`docs/TODO.md` and DECISION-100 both remain accurate** against what actually shipped, confirmed by direct comparison.

## Intent-vs-Shipped Diff

- Phase 1: close the mechanical half inside the existing transaction, no new input/UI. **Shipped:** exactly that. **Matches.**
- Phase 2: founding-administrator bootstrap fully out of scope, deferred to P2. **Shipped:** no trace of it. **Matches** — absence is intended.
- Phase 2/3: `role_grants` must use the group arm, found by `derivedFrom`. **Shipped:** verified in code. **Matches.**
- Phase 2/3: no new audit key, existing `ORG_CREATED` covers it. **Shipped:** confirmed. **Matches.**
- Phase 3: `docs/TODO.md` + DECISION-100 in the same commit. **Shipped:** both present and accurate. **Matches.**
- No member-visible surface introduced (no UI, route, or permission/flag reaching an end user) — Rules 13/14 (what's-new, functionality-map) correctly don't apply.

## Edge Cases

- Empty state: not applicable — no UI.
- Failure microcopy: not applicable directly — pre-existing failure branches unchanged. One honest residual: a missing `directory.view` catalog row would surface as a raw FK-violation 500 rather than mapped copy — Phase 3 named this and ruled it an acceptable operational-fault boundary, not this pipeline's to guard against. Agreed.
- Permission gate: pass — no new permission/flag; existing `FEATURES.ADMIN_ORGANIZATIONS` gate on `/admin/organizations/*` untouched, verified by QA's feature-gate audit.
- Audit event: not applicable, correctly — folded into the existing `ORG_CREATED` event since this is a deterministic system default, not a human access decision.
- Mobile (360px): not applicable — no UI surface.

No follow-ups needed; this closes clean.

---

**Pipeline closed.** Per Rule 12: no in-app feedback source, no row to mark done. Per Rule 13: no what's-new entry (no member-visible surface). Per Rule 14: no functionality-map change (no surface added/changed/removed). Per Rule 15: no `docs/architecture.md` update (bug-scoped extension of an existing transaction, not a new subsystem or data-flow change).
