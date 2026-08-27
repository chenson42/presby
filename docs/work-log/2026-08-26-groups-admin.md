# Groups Administration — Work Log

> **Slug:** `2026-08-26-groups-admin`
> **Surface:** (org) — new admin surface, likely `/o/<slug>/admin/groups`
> **Permission(s):** TBD Phase 1/3 — likely a new `groups.manage`
> **Flag(s):** TBD Phase 3 — likely a new `org_portal.groups`, seeded off, following every other admin-hub tile's precedent
> **Estimated complexity:** medium
> **Pipeline mode:** Full — via `/new-feature`

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | database-admin, then full-stack-developer | Complete | — | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> "Let's start on groups" resolves to a well-precedented CRUD surface (create/edit a `managed` group, add/remove/end its members) that must go nowhere near the already-correct `session`/`diaconate` derived-group machinery — but two concrete things stand between this and a clean build: production has no seeded `group_types` rows for `committee`/`small_group`/`choir`/`team` (only `court`/`roster` exist outside fixtures), and the database provides zero protection against a naive UI editing a derived group's `name`/`description` or deleting a derived `group_memberships` row directly — both are "paper" invariants today, enforced only by this pipeline choosing to enforce them in application code.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member holding the new `groups.manage` permission (tenant admin) | Create a `managed` group: pick a group type (committee / small_group / choir / team — never `court`, which is derived-reserved), name, optional description/`meets_when` | On demand, low frequency (a handful of committees per congregation) |
| Same surface | Edit a `managed` group's name/description/`meets_when` | On demand |
| Same surface | Add a person to a group: pick a person (scoped to this org's own `memberships`, the same F21 shape officers/members use), set `group_role` (chair/leader/member), `starts_on` | On demand, clustered around annual committee assignments |
| Same surface | Remove/end a person's group membership: set `ends_on` (soft — never delete a settled row, matching the officers precedent) | On demand |
| Same surface | View a group's roster and a person's group memberships | On demand |
| *(no end-user verb)* | Derived groups (Session, Board of Deacons, Active Membership) continue to be created only by `createOrganization()` and populated only by the `officer_terms`/`memberships` triggers — this pipeline adds zero new writes to that path | Automatic, unchanged |

The request ("let's start on groups") named no surface at all. Resolved to `(org)/o/<slug>/admin/groups`, gated by a new tenant permission — not "the user" generically.

## Flows

**Flow 1 — Create a managed group:** entry `/o/<slug>/admin/groups` → "New group" → form: group-type `<select>` restricted to the manageable subset (`committee`/`small_group`/`choir`/`team` — `court` and `roster` excluded, both reserved for derived groups) → name, optional description/`meets_when` → submit → server re-validates the group type is in the manageable subset (never trust the client-side filter alone) → insert `groups` row (`membership_source='managed'`, `derived_from=null`, `is_protected=false`) → success: appears in the list.
- Failure: empty/overlong name → inline + server validation. Chosen group-type id belongs to another org, or is `court`/`roster` → invalid_input, not a raw constraint error. DB/network failure → generic "couldn't save that — try again," never a stack trace.

**Flow 2 — Edit a managed group:** entry: group list row → "Edit" → change name/description/`meets_when` → submit.
- Guard, load-bearing: derived groups (Session, Board of Deacons, Active Membership) must never render an edit form at all, and the server action must independently re-check `membership_source !== 'managed'` before executing the UPDATE — the database enforces none of this for the `groups` row itself (see Gaps). Failure: attempting to reach a derived group's edit form directly (typed URL) → forbidden/redirect, not a silently-succeeding edit.

**Flow 3 — Add a person to a group:** entry: group detail page → "Add member" → person `<select>` scoped through this org's `memberships` (F21 shape) → `group_role` `<select>` (chair/leader/member) → `starts_on` (default today) → submit → insert `group_memberships` row, `source='managed'` → success: appears on roster.
- Failure: DB/network → generic copy. No overlap protection exists (unlike `officer_terms_no_overlap`'s GIST exclusion) — nothing stops the same person being added to the same group twice with overlapping dates. Needs an explicit Phase 3 ruling (schema constraint vs. app-level pre-check).

**Flow 4 — Remove/end a group membership:** entry: roster row → "End membership" → `AlertDialog` confirm naming the person and group (Workflow Rule 2, no native `confirm()`) → set `ends_on` → submit.
- Guard, load-bearing: the server action must filter its own query to `group_memberships.source = 'managed'` only, and refuse to act on a row belonging to a derived group even if reached — the DB's `group_memberships_reject_derived` trigger does not block this (see Gaps: it only blocks converting a derived row's `source`, not deleting/updating one that's already `derived`). Failure: generic copy on DB/network error.

**Flow 5 — View a group's roster / a person's group memberships:** read-only.
- Failure/empty: brand-new org has zero `managed` groups (only the three seeded derived ones) → "No committees or groups yet — add your first one," not a blank table.

## Permissions & Flags

- **Permission(s):** new `groups.manage` (module `groups`, tier 1 — committee membership is public-register-adjacent information, not tier 2/3). One permission covers create/edit/membership-add/membership-end, unlike role-permissions-admin's definition-vs-assignment split — there is no analogous "who defines a group type vs. who assigns membership" question here because `group_types` is a small, effectively platform-fixed taxonomy (5 keys total, 2 of them derived-reserved), not a tenant-extensible catalog. Flag this reasoning explicitly at Phase 2/3 rather than silently importing the roles-admin split.
- **Default roles:** recommend not auto-binding to `stated_clerk` by default — apply DECISION-078's test the way `roles.manage`/`branding.manage` did (DECISION-101/106 declined the auto-bind): no single PC(USA) office is *the* keeper of committee rosters the way the Stated Clerk is of session's official acts. Lean toward fixture/seed-granted only in v1, an explicit Phase 3 call either way.
- **Flag(s):** new `org_portal.groups`, seeded off — matches `org_portal.officers`/`org_portal.roles`/`org_portal.members_create`'s exact precedent.
- **Portal-tile category:** take a position — `operate`, not `administer`. Per DECISION-105 (this session's own operator correction moving Members and Officers to `operate` as "routine congregational work, not org setup"), maintaining a committee/small-group/choir roster is the same kind of routine, ongoing ministry work, not org setup like Roles/Features/Branding. Recommend Phase 2 confirm this placement rather than defaulting to `administer` just because the route lives under `/admin/`.

## Gaps the Request Didn't Address

- **Production has no seeded `group_types` template rows for `committee`/`small_group`/`choir`/`team`.** `scripts/seed.ts`'s `seedGroupTypes()` seeds only `court` and `roster` platform-wide, with an explicit comment that `committee` is deliberately not seeded because no admin surface creates one yet — that admin surface is exactly what this pipeline builds. `scripts/seed-dev.sql`'s fixture already has both a platform-wide AND a separate org-scoped `committee` `group_types` row — that duplication looks like unresolved design churn, not a deliberate pattern; Phase 2/3 must rule on whether `groups.group_type_id` should reference the platform template directly (matching how `court`/`roster` work) or whether per-org custom group types are a real, separate feature.
- **`is_protected`/derived-group protection on the `groups` table itself is "paper," not enforced.** Confirmed by reading `presby_reject_derived_group_write()` directly: it guards `group_memberships` INSERT/UPDATE/DELETE against converting a row's `source` away from `'derived'`, but nothing anywhere guards the `groups` row's own `name`/`description`/`meets_when` from a direct UPDATE. This pipeline's edit action must check `membership_source`/`is_protected` itself — name this as an explicit Phase 4 acceptance test, not something the UI's absence of a button is trusted to prevent alone.
- **The same trigger does not block DELETING an existing derived `group_memberships` row.** For a DELETE of an already-derived row, `old.source='derived'`, so the trigger's condition (checking whether `source` is being converted AWAY from derived) is false and the delete proceeds unblocked. A "remove member" action built without an explicit `source='managed'` filter could silently corrupt the Session/Diaconate roster with no accompanying `officer_terms` change and no error — same invariant-violation risk class as F22, a different door. Phase 4's acceptance criteria must include a regression test proving the new action cannot touch a derived-source row.
- **No overlap/uniqueness constraint on `group_memberships`** for (group, person, active window) — unlike `officer_terms_no_overlap`'s GIST exclusion, nothing stops a duplicate active membership. Phase 3 must decide: new constraint, or app-level check-before-insert.
- **Group dissolution/archival has no schema story.** No `archived_at`/`is_active` column, no defined behavior for deleting a `groups` row. Recommend v1 ships create + edit + membership add/end only — no group deletion/archival — name this explicitly as deferred, not silently absent.
- **`group_role` (`chair`/`leader`/`member`) is purely descriptive and grants nothing.** Same unlinked-systems shape the officers pipeline found between `officer_terms.office` and the `stated_clerk` role — marking someone "chair" does not grant any permission. UI copy should say so plainly.
- **Audit story:** `role_grants.group_id` can bind a role to any group, managed or derived — adding/removing a person from a managed group that happens to carry a role grant is a de facto access change. Recommend new `AUDIT_ACTIONS` (`GROUP_MEMBER_ADDED`/`GROUP_MEMBER_ENDED`, `GROUP_CREATED`/`GROUP_UPDATED`), mirroring `OFFICER_TERM_STARTED`/`ENDED`'s shape, applied uniformly.
- **`group_memberships.officer_term_id`'s missing FK (also tracked in `docs/TODO.md`) is out of scope for this pipeline** — it only ever populates on `source='derived'` rows written by the `officer_terms` trigger; every row this pipeline creates has it null. Does not block this pipeline.
- **Mobile:** roster views are wide-column — use `Table`, not cards, matching the officers/roles precedent.
- **2FA gate:** ordinary `(org)` admin page, standard Edge gate applies uniformly.

## Out of Scope (confirm with user)

- The `session`/`diaconate` derived-group write path — untouched, confirmed by design, not just by omission.
- A per-group delegation model (e.g., a committee's own chair managing that committee's roster without org-wide `groups.manage`) — a real future refinement, not this pipeline's.
- Making the public site's Committees page render live from `groups`/`group_memberships` data — the prior `groups-and-officers` pipeline's addendum already ruled this out of scope, deferred to the queued P7 ("data-bound blocks"); this pipeline is a prerequisite for that future work, not the thing that wires the renderer to them.
- Defining new `group_types` keys beyond the five the schema already names — this pipeline seeds the missing platform templates for existing keys, it does not add a sixth.
- A tenant-facing audit-event reader for the new events (same deferred-reader posture established elsewhere).

## Open Questions

- Should `groups.group_type_id` reference the platform-wide template row directly for every org (matching `court`/`roster`'s existing pattern), or does the fixture's org-scoped duplicate `committee` row reflect an intended "per-org custom group types" feature this pipeline should also build? Materially changes the Phase 3 data-model story.
- Is `groups.manage` fixture/seed-granted only in v1 (no default role binding), matching `roles.manage`/`branding.manage`'s posture, or does the operator want a default binding to an existing role?
- New constraint or app-level check for the missing overlap protection on `group_memberships`?
- Confirm the `operate` portal-tile category placement (recommended above) rather than defaulting to `administer` on route-path assumption alone.

**Handoff:** architect (Phase 2). Carry forward, unresolved and load-bearing: the `group_types` production-seed gap; the two "paper" trigger gaps (derived-group edit protection and derived-membership delete protection) as required Phase 4 regression tests, not optional hardening; the org-scoped-vs-platform-template `group_types` open question; the missing overlap constraint; the no-deletion/no-archival-in-v1 scoping decision; the `operate`-category recommendation; and the `groups.manage`-single-permission reasoning.

---

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions

## Placement

- Directory: `/o/[slug]/admin/groups/` — mirror the members tree shape (list + `new/` + `[groupId]/` + `[groupId]/edit/`), not officers' single-roster shape, since groups need real create/edit CRUD on top of roster management. Membership add/end is handled via dialogs/forms on `[groupId]/page.tsx` (mirroring officers' `add-officer-term-form.tsx`/`end-term-dialog.tsx` pattern), not separate routes.
- New module: `src/lib/groups.ts`, shaped exactly like `src/lib/officers.ts` — one `withOrgContext()` transaction per export, a single `hasGroupsManage` gate checked first, typed `GroupsResult<T>` (`ok | forbidden | invalid_target | invalid_input | overlap`), no delete-only-end discipline for `group_memberships`.
- Server actions co-located in `groups/actions.ts`, `'use server'`.
- Server vs Client: `page.tsx`s are Server Components reading through `src/lib/groups.ts`; group-type `<select>` (server-filtered to the manageable subset regardless of client rendering), new/edit group forms, add-member form, and the end-membership `AlertDialog` are `'use client'` — standard RSC + client-form split, no exception.
- Dependencies: none. `react-hook-form`/`zod` cover form validation; nothing else is needed.

## Invariants Touched

- **The Court Is Not a Group.** This pipeline adds zero new writes to `session`/`diaconate` — confirmed by reading `officer_terms_sync_derived` and `presby_reject_derived_group_write()` directly. But it is the first application code that can reach a `groups`/`group_memberships` row through arbitrary user input at all. This invariant is classified `trigger` at `/developer`, and its trigger currently has two real gaps (see Rulings, item 3).
- **Permissions vs Flags.** New `groups.manage` permission, new `org_portal.groups` flag — kept separate, no merge.
- **No Real Data / Composite Tenant Keys.** Unaffected; `group_memberships`' existing composite FKs already cover this table correctly (the `officer_term_id` gap is DECISION-060's pre-existing, separately tracked finding, not this pipeline's).
- **D8 (no custom fields, tags are the only tenant-extensible attribute).** Load-bearing for the `group_type_id` ruling below — a per-org custom-group-types feature would open a second extensibility door D8 was written to close.

## Rulings (recorded in full as DECISION-110 — see docs/decisions.md)

1. **`groups.group_type_id` — platform template only, no per-org custom types.** Traced via `git log -S`: the platform-wide `committee` row was seeded in the very first schema commit alongside `court`/`roster`; the org-scoped duplicate was added later, bundled into an unrelated commit purely to satisfy one fixture, with no comment justifying the duplication. No requirements signal for real per-org custom group types, and D8 argues against building one. Every `groups.group_type_id` write resolves against the platform-wide template row. Phase 4 must: (a) extend `seedGroupTypes()` to also seed `committee`/`small_group`/`choir`/`team` platform-wide (the real production gap), and (b) fix `scripts/seed-dev.sql`'s org-scoped row to reference the platform template instead of duplicating it.
2. **`groups.manage` — single permission, confirmed.** No definition/assignment split needed — `group_role` grants nothing, `group_types` isn't tenant-extensible. Module `groups`, tier 1. Default binding: fixture/seed-granted only, no auto-bind — DECISION-078's test applied directly: no PC(USA) office is the constitutional keeper of committee rosters, and `stated_clerk` already carries seven accumulated permissions per DECISION-106.
3. **Both trigger gaps confirmed by direct read — Phase 4 must fix the trigger, not just the app layer.** `presby_reject_derived_group_write()`'s guard is false for a DELETE of an already-derived `group_memberships` row (only catches an UPDATE converting `source` away from `'derived'`). No trigger at all exists on `groups` — nothing stops a direct `UPDATE groups SET name = ...` on a derived row. Because this invariant is classified `trigger`, not `paper`, leaving these app-only is not accepting a known gap, it's letting a `trigger`-class invariant silently degrade. Phase 3's design must include a migration: widen the DELETE branch, and add a new `before update on groups` trigger rejecting name/description/meets_when changes when `membership_source = 'derived'`. Application-layer checks stay too, as defense-in-depth, not a substitute. Mandatory SQL-layer regression tests, mirroring `scripts/test-rls.sql`'s style.
4. **Overlap on `group_memberships` — app-level check-before-insert, not a GIST exclusion.** A duplicate managed-group membership carries none of officer terms' quorum/minute-validity stakes; a DB exclusion constraint here is disproportionate. App-level check-before-insert in `src/lib/groups.ts`.
5. **No group deletion/archival in v1 — confirmed.** Create + edit + membership add/end only.
6. **Portal-tile category: `operate` — confirmed.** Same reasoning as DECISION-105 for Members/Officers.
7-9. Directory structure, split, dependencies, flag confirmed as above; no new dependency; `org_portal.groups`, seeded off.

## Notes

- Phase 3 must name the exact SQL for both trigger fixes and the migration filename — not optional cleanup, load-bearing for the invariant's stated enforcement class.
- Phase 3 must spec the `seedGroupTypes()` extension and `seed-dev.sql` fixture fix as part of the same migration/seed commit.
- New `AUDIT_ACTIONS`: `GROUP_CREATED`, `GROUP_UPDATED`, `GROUP_MEMBER_ADDED`, `GROUP_MEMBER_ENDED`, mirroring `OFFICER_TERM_STARTED`/`ENDED`'s shape.
- Carry forward to Phase 3: exact wording for the group-type dropdown's manageable-subset filter, and the form-options query shape (F21-style, matching `getOfficerFormOptions`).

**Verdict: Approved with suggestions.** Handoff: tech-lead (Phase 3).

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We are building `/o/<slug>/admin/groups`, a create/edit/roster-management surface for the four manageable group types (`committee`/`small_group`/`choir`/`team`) — the last piece the `2026-08-26-groups-and-officers` pipeline scoped out. A new `groups.manage` permission gates a new `src/lib/groups.ts` domain module (shaped exactly like `src/lib/officers.ts`) and a full CRUD route tree that mirrors `admin/members`'s list/new/[id]/edit shape. Because this is the first application code able to write arbitrary user input into `groups`/`group_memberships`, the design includes a mandatory migration closing two real trigger gaps against the derived Session/Diaconate rosters (DECISION-110), not just application-layer checks. `group_type_id` always resolves to the platform-wide template row, matching `court`/`roster`'s existing pattern — no per-org custom group types.

## Permissions & Flags

- Permission key: `groups.manage` — new row in the tenant `permissions` catalog (module `groups`, `sensitivity_tier` 1), seeded via the migration (parallel to `officers.manage`'s row in `drizzle/0029_presby_officers_permission.sql` — `permissions` carries no `organization_id`, so it is seeded once, globally, in the schema migration, not in `scripts/seed.ts`).
- Default role bindings: **none.** Fixture/seed-granted only (DECISION-110 ruling 2 — DECISION-078's test fails every existing office). `scripts/seed-dev.sql` grants it to an existing fixture person's existing role via a new `app_role_permissions` row — no new `role_grants` row, same "an existing office picks up the new key for free" shape `officers.manage`/`demographics.manage` already used. Not `stated_clerk` (already carries eight permissions per DECISION-106/108's own accounting) — grant it to `property_chair` (Tobias Renwick already holds it and it is the closest existing "runs a committee" office on the fixture) is rejected for the identical over-concentration reason DECISION-103/108/109 keep naming; grant it instead to the existing `support_contact` role held by Marguerite Ashcombe — also rejected, same reasoning. **Ruling:** mint no new role either — `role_grants` already lets any `roles.manage` holder bind `groups.manage` to whichever existing or future role an organization actually uses for committee administration; the fixture grants it directly to `stated_clerk` anyway *for test-reachability only*, with an explicit code comment that this is a fixture convenience, not a recommended production binding (mirrors how several `sensitive-info` permissions' fixture bindings are commented). This keeps the permission itself unopinionated the way DECISION-110 intends, while giving `scripts/test-rls.sql` a real holder to exercise Phase 4's regression tests against.
- Feature flag: new `org_portal.groups`, seeded OFF, checked bare (no DECISION-026 fail-open wrapper — a toggle, not an auth path), same "ships dark until the page lands" reasoning as `org_portal.officers`. No per-org `organization_feature_toggles` row — Phase 1/2 never asked for one, and `officers`/`roles` (the two closest precedents) don't carry one either; `members_create`'s toggle is the exception, not the rule.
- Portal tile: new `PORTAL_TILES` entry in `src/lib/org-portal/tiles.ts` — `key: "groups"`, `href: (slug) => \`/o/${slug}/admin/groups\``, `flagKey: "org_portal.groups"`, `category: "operate"` (DECISION-110 ruling 6 / DECISION-105's own reasoning).

## API Contract

All mutation/read logic lives in `src/lib/groups.ts` — one `withOrgContext()` transaction per export, `hasGroupsManage(tx, personId, organizationId)` (private, calls `presby_has_permission(..., 'groups.manage')`) checked first in every export, identical placement to `hasOfficersManage`. `GroupsResult<T> = { kind: "ok"; data: T } | { kind: "forbidden" } | { kind: "invalid_target" } | { kind: "invalid_input"; message: string } | { kind: "overlap"; personName: string; groupName: string }`.

- `listGroups(viewerPersonId, organizationId): Promise<GroupsResult<GroupListEntry[]>>` — every `membership_source = 'managed'` group for this org, with a member count. **Derived groups (Session, Board of Deacons, Active Membership) are never returned by this module at all** — they already have a dedicated read surface (`admin/officers`'s roster), and excluding them here at the query layer (`where membership_source = 'managed'`) is the first of two enforcement layers protecting Flow 2/4's guard, not just a UI omission.
- `getGroup(viewerPersonId, organizationId, groupId): Promise<GroupsResult<GroupDetail>>` — one managed group's own fields (name, description, meetsWhen, group type name) plus its current + ended roster (person name, `groupRole`, `startsOn`, `endsOn`). Query is scoped `and(eq(groups.id, groupId), eq(groups.organizationId, organizationId), eq(groups.membershipSource, "managed"))` — a derived group's id (typed directly into the URL) resolves `invalid_target`, same as a nonexistent one. This is the application-layer half of Flow 2's guard; the migration's new `groups` UPDATE trigger is the database-layer half.
- `getGroupFormOptions(viewerPersonId, organizationId): Promise<GroupsResult<GroupFormOptions>>` — `groupTypes: Array<{ id, key, name }>` restricted server-side to the platform-template rows (`organizationId is null`) whose `key` is in `MANAGEABLE_GROUP_TYPE_KEYS = ["committee","small_group","choir","team"] as const` (`court`/`roster` never appear in this list, regardless of client rendering); `people: Array<{ personId, displayName }>` — the identical F21 current-membership shape `getOfficerFormOptions` uses.
- `createGroup(viewerPersonId, organizationId, input: { groupTypeId; name; description?; meetsWhen? }): Promise<GroupsResult<{ groupId: string }>>` — validates `groupTypeId` resolves to a platform-template row (`organizationId is null`) whose `key` is in the manageable subset (`invalid_input` naming the rule, never trusting the client-side `<select>` filter alone); inserts with `membershipSource: "managed"`, `derivedFrom: null`, `isProtected: false`.
- `updateGroup(viewerPersonId, organizationId, input: { groupId; name; description?; meetsWhen? }): Promise<GroupsResult<{ groupId: string }>>` — re-loads the group scoped to `membership_source = 'managed'` (`invalid_target` otherwise, closing the exact gap named in Flow 2), then updates. The new `groups` UPDATE trigger (migration) is the backstop if this check is ever bypassed.
- `addGroupMember(viewerPersonId, organizationId, actingUserId, input: { groupId; personId; groupRole; startsOn }): Promise<GroupsResult<{ groupMembershipId: string }>>` — group must resolve `membership_source = 'managed'` (`invalid_target`); `personId` must be a CURRENT membership at this org (F21 shape, `invalid_target` otherwise); **app-level overlap check (DECISION-110 ruling 4, no GIST exclusion):** query `group_memberships` for an existing row on `(organizationId, groupId, personId)` with `endsOn is null` — if found, return `{ kind: "overlap", personName, groupName }` naming both, before any insert is attempted. Insert with `source: "managed"`.
- `endGroupMembership(viewerPersonId, organizationId, input: { groupMembershipId; endsOn }): Promise<GroupsResult<{ groupMembershipId: string }>>` — loads the row scoped to this org AND `source = 'managed'` (`invalid_target` if missing or derived — mirrors `officers.ts`'s discipline exactly, and is the application-layer half of Flow 4's guard; the migration's widened DELETE-branch trigger is the database-layer half, though this function never issues a DELETE at all). Validates `endsOn >= startsOn`. Sets `endsOn` — **never a delete**, matching officers' "no delete-only-end" discipline for the identical reason (an unconstrained history column elsewhere in the schema would otherwise silently orphan).

Server actions (`src/app/(org)/o/[slug]/admin/groups/actions.ts`, one file, `'use server'`, mirrors `officers/actions.ts`'s single-file shape per Phase 2): `createGroupAction(slug, input)`, `updateGroupAction(slug, input)`, `addGroupMemberAction(slug, input)`, `endGroupMembershipAction(slug, input & { personId; groupName })` (the caller already has these from the page it rendered, same shape `endOfficerTermAction` takes `personId`/`office` for audit metadata without a second read). Each: `resolveActingIdentity(slug)` (verbatim copy of `officers/actions.ts`'s helper) → call the matching `src/lib/groups.ts` export → map `forbidden`/`invalid_target`/`invalid_input`/`overlap` to copy → `recordAudit()` on `ok` → `revalidatePath(\`/o/${slug}/admin/groups\`)` (and the `[groupId]` path for member actions) → return `ActionResult<T>`.

## Data Model

No new tables or columns — `groups`/`group_memberships`/`group_types` already carry everything this feature writes. Two SQL-layer behavior changes, both in the migration (see Implementation Order):

1. `presby_reject_derived_group_write()` (`drizzle/0009_presby_rls.sql`) is widened. **Confirmed by direct read of the current function body:** its guard is `if src = 'derived' and coalesce(new.source, old.source) <> 'derived' then raise ...` — for a `DELETE` of an already-derived row, `new` is null so `coalesce(new.source, old.source)` evaluates to `old.source`, which is `'derived'`, so `'derived' <> 'derived'` is `false` and the row deletes unblocked. The fix special-cases `tg_op = 'delete'`: if `old.source = 'derived'`, raise `check_violation` unconditionally, before ever consulting `groups.membership_source`; every other branch (`insert`/`update`) keeps the existing logic verbatim.
2. A new trigger, `groups_reject_derived_edit`, `before update on groups for each row execute function presby_reject_derived_group_edit()` — raises `check_violation` if `old.membership_source = 'derived'` and any of `name`/`description`/`meets_when` is `is distinct from` its old value. No trigger of any kind exists on `groups` today; this is wholly new, not a widened existing one.

`groups.group_type_id` continues to reference whatever row `scripts/seed.ts`'s `seedGroupTypes()` and `createOrganization()`'s lookup already establish — no FK/column change. The seed-side fix (below) is a data correction, not a schema change.

## Component / Page Plan

- **Pages to create** (`src/app/(org)/o/[slug]/admin/groups/`):
  - `page.tsx` — list of managed groups (`Table`, mirrors `members-list.tsx`'s shape: name, group-type label, member count), "New group" button gated on `groups.manage` (via `listGroups`'s own `forbidden` result, same pattern `admin/members/page.tsx` uses for `people.manage`/`canCreate`).
  - `new/page.tsx` — loads `getGroupFormOptions`, renders `new-group-form.tsx`.
  - `[groupId]/page.tsx` — group detail: name/description/meetsWhen header, roster `Table` (person, `groupRole`, dates), "Add member" form (`add-group-member-form.tsx`, mirrors `add-officer-term-form.tsx`) and a per-row "End membership" `AlertDialog` (`end-group-membership-dialog.tsx`, mirrors `end-term-dialog.tsx`, names the person and group per Workflow Rule 2), "Edit group" link.
  - `[groupId]/edit/page.tsx` — loads `getGroup`, renders `edit-group-form.tsx`; **redirects/404s (via `getGroup`'s `invalid_target`) if the group is derived**, never renders an edit form for one, closing Flow 2's guard at the route level too.
- **Components to create:** `groups-list.tsx`, `new-group-form.tsx`, `edit-group-form.tsx`, `add-group-member-form.tsx`, `end-group-membership-dialog.tsx`, `group-schema.ts` (zod: `createGroupSchema`, `editGroupSchema`, `addGroupMemberSchema`, `endGroupMembershipSchema` — one file, mirrors `officer-term-schema.ts`'s single-file shape), `group-type-labels.ts` (display labels for the four manageable keys, mirrors `office-labels.ts`), `groups-states.tsx` (`GroupsFlagOff`/`GroupsForbidden`/`GroupsLoadError`, mirrors `officers-states.tsx`).
- **Files to modify:**
  - `scripts/seed.ts` — `seedGroupTypes()`'s `defs` array grows from `[court, roster]` to `[court, roster, committee, small_group, choir, team]`. Same find-or-create-by-`(organizationId IS NULL, key)` idempotency discipline, no `.onConflictDoNothing()` (the function's own header comment explains why — no unique constraint to conflict on).
  - `scripts/seed-dev.sql` — remove the org-scoped duplicate `group_types` insert at the presbytery (`a0000000-…-0003`, lines ~530–531) and repoint the "Commission on Alder Creek" `groups` insert (lines ~532–534) to the platform template row `a0000000-…-0002` instead. Confirmed safe: `scripts/test-rls.sql` has no reference to the org-scoped id anywhere, and already inserts a *different* scratch group against the platform template id directly (line 536), so this is a pure dedup with zero blast radius on the existing suite.
  - `src/lib/audit.ts` — four new `AUDIT_ACTIONS`: `GROUP_CREATED: "tenant.group.created"`, `GROUP_UPDATED: "tenant.group.updated"`, `GROUP_MEMBER_ADDED: "tenant.group_membership.added"`, `GROUP_MEMBER_ENDED: "tenant.group_membership.ended"` — same `tenant.*` actor-axis prefix as `OFFICER_TERM_STARTED`/`ENDED`.
  - `src/lib/org-portal/tiles.ts` — new `PORTAL_TILES` entry (see Permissions & Flags). `tiles.test.ts`'s hard-coded seed-list snapshot needs the new flag key added too (implementer's job, not a design change).
  - `scripts/test-rls.sql` — two new numbered sections (25, 26 — the file's last section is 24), mirroring section 6's `do $$ ... exception when check_violation ...` style exactly: (25) DELETE of an already-derived `group_memberships` row raises; (26) UPDATE of a derived group's `name` raises. Both run against the existing Session fixture rows (`b0000000-…-0001`) already seeded in section 6's own transaction scope — no new fixture rows needed.

## Implementation Order

1. **Schema (mandatory, not optional — DECISION-110 ruling 3):** new migration `drizzle/0033_presby_groups_administration.sql` (next free index — `drizzle/meta/_journal.json`'s newest committed entry is `0030`, but `0031`/`0032` are already claimed on disk by two other concurrent pipelines today; re-verified fresh against `ls drizzle/` at design time, not trusted from an earlier session). Contents: the widened `presby_reject_derived_group_write()`, the new `presby_reject_derived_group_edit()` function + `groups_reject_derived_edit` trigger, and the `groups.manage` `permissions` catalog row (parallel to `0029`'s `officers.manage` row — hand-written, idempotent, per this repo's `db:generate`-is-broken convention noted in `0029`'s own header).
2. `scripts/seed.ts`'s `seedGroupTypes()` extension + `scripts/seed-dev.sql`'s dedup fix, in the same commit as the migration (Phase 2's own instruction) + `scripts/test-rls.sql`'s two new regression sections, proven failing-before/passing-after the migration.
3. `org_portal.groups` flag row in `scripts/seed.ts`'s flag list; `groups.manage`'s fixture `app_role_permissions` grant in `scripts/seed-dev.sql`.
4. `src/lib/groups.ts` (the domain module) + `src/app/(org)/o/[slug]/admin/groups/actions.ts` (server actions).
5. UI: the four pages + six components listed above, plus the `PORTAL_TILES` entry.
6. Audit events (already specified inline in each action above — not a separate pass).
7. Release notes entry (tech-lead, at Phase 6 SHIP IT) + `docs/product/functionality-map.md` update (Rule 14).

## Edge Cases & Risks

- **The migration is the load-bearing item, not the UI.** If Phase 4 ships the UI without the migration, "The Court Is Not a Group" silently degrades from `trigger`-class to `paper`-class the moment this pipeline's own code goes live — QA's Phase 5 gate must fail closed on this (regression tests proving both trigger fixes, not just application-layer tests) rather than accept "the app never calls delete/edit on a derived row" as sufficient.
- **Overlap check is intentionally narrow (DECISION-110 ruling 4).** `addGroupMember`'s pre-check only catches an existing *open* (`endsOn is null`) membership for the same (group, person) — it does not detect two *closed*, date-overlapping memberships (e.g., two historical stints with overlapping ranges entered out of order). Accepted scope, named explicitly: officer terms' GIST exclusion solves the general case because quorum/minute-validity is at stake there; a committee roster is not.
- **`groups.manage`'s fixture binding is a test-reachability convenience, not a recommendation** (see Permissions & Flags) — Phase 6 should confirm this reads honestly in the work-log and isn't mistaken for a real default-role ruling.
- **Existing e2e blast radius:** none identified. No existing Playwright spec drives `/o/[slug]/admin/groups` (the route doesn't exist yet), and the migration's two trigger changes only *narrow* previously-permitted operations (a DELETE and a `groups` UPDATE that were unintentionally allowed) — no existing spec depends on either succeeding. `admin/officers`'s e2e coverage (if any) reads Session/Diaconate rosters but performs no writes this migration would block. Flagged as the retro-relevant check per the 2026-07-11 loop-back finding: if Phase 5 discovers an existing spec that *does* directly UPDATE/DELETE a derived-group row (unlikely, but not verified by grep alone), it returns to Phase 3, not a silent QA workaround.
- **Group-type dropdown must be server-filtered, not just client-hidden** — `getGroupFormOptions` restricting to the manageable-subset keys is the actual gate; `createGroup`'s own re-validation of `groupTypeId` is the second, independent layer (never trust the `<select>` alone).
- **`[groupId]/edit/page.tsx` reachability on a derived id** must resolve through `getGroup`'s `invalid_target` (→ 404/redirect), not a client-side "no edit button" omission — this is Flow 2's load-bearing guard, named again here so Phase 4 doesn't treat it as optional polish.
- **No group deletion/archival in v1** (DECISION-110 ruling 5) — confirmed, no `archived_at` column, no delete button anywhere in this UI.

## Implementer

**Two implementers in sequence**, not one full-stack pass — justified by scope and by direct precedent: the sibling `2026-08-26-groups-and-officers` pipeline this one completes split identically (schema commit, then server+UI), and this feature's non-schema half is a full CRUD tree (list/new/[id]/edit) plus two dialog-driven membership flows and a six-export domain module — materially larger than the "small enough that splitting adds overhead" bar the selection table sets for `full-stack-developer`.

1. **`database-admin`** — `drizzle/0033_presby_groups_administration.sql` (both trigger fixes, the `groups.manage` permissions-catalog row), `scripts/seed.ts`'s `seedGroupTypes()` extension, `scripts/seed-dev.sql`'s dedup fix + fixture permission grant, and `scripts/test-rls.sql`'s two new regression sections (25, 26) proven failing-before/passing-after against the new migration.
2. **`full-stack-developer`** — `src/lib/groups.ts`, `groups/actions.ts`, and the full UI tree (four pages, six components, the `PORTAL_TILES`/flag-seed wiring, and this module's own unit + component tests) — one implementer for the server+client half because, unlike the schema half, no invariant-enforcement boundary separates them the way it does for the migration; `officers.ts` + its actions + its UI were themselves split across two implementers historically, but that reflected the original `groups-and-officers` pipeline's larger combined scope (two domains, three commits), not a rule that server and client must always be separate agents here. `api-developer`/`ux-developer` in sequence is the alternative and is not wrong, but adds a handoff for a surface this pipeline has already fully specified end-to-end (exact function signatures, exact result variants, exact component list) — the design doc itself is the coordination artifact a second handoff would otherwise exist to carry.

---

# Phase 4 — Implementation

## Phase 4 commit 1 (database-admin)

**Date:** 2026-08-26
**Scope:** schema only, per Phase 3's Implementer list item 1. No application
code (`src/lib/groups.ts`, `src/app/` pages/forms, `actions.ts`) touched —
that is `full-stack-developer`'s commit, next.

### Files Created

- `drizzle/0033_presby_groups_administration.sql` — hand-written, idempotent.
  Widens `presby_reject_derived_group_write()`'s DELETE branch (special-cases
  `tg_op = 'DELETE'` on an already-`derived` row, raising `check_violation`
  unconditionally); adds a wholly new `presby_reject_derived_group_edit()`
  function + `groups_reject_derived_edit` (`before update on groups`) trigger
  rejecting `name`/`description`/`meets_when` changes when
  `membership_source = 'derived'`; seeds the `groups.manage` permission-catalog
  row (module `groups`, `sensitivity_tier` 1). Verified next-free against
  `ls drizzle/*.sql` at write time (0031/0032 were claimed by other concurrent
  pipelines today) and against `drizzle/meta/_journal.json`'s own trailing
  entry — added the `idx: 33` journal entry myself in the same commit
  (Rule: two earlier pipelines missed this today; not repeated here).

### Files Modified

- `scripts/seed.ts` — `seedGroupTypes()`'s `defs` array extended from
  `[court, roster]` to also seed `committee`/`small_group`/`choir`/`team`
  platform-wide (find-or-create, no `.onConflictDoNothing()`, matching the
  function's existing idempotency discipline — no unique constraint to
  conflict on).
- `scripts/seed-dev.sql` — removed the org-scoped duplicate `committee`
  `group_types` row (`a0000000-...-0003`, presbytery-scoped) and repointed
  "Commission on Alder Creek" (`groups` row `b0000000-...-0005`) to the
  platform template row (`a0000000-...-0002`) instead, per DECISION-110
  ruling 1. Added one new `app_role_permissions` row binding `groups.manage`
  to `stated_clerk` (`f0000000-...-0005`) — a labeled test-reachability
  convenience only (Phase 3's own wording), not a recommended production
  default; no new role minted, no new `role_grants` row (Tobias Renwick's
  existing direct grant carries it for free).
- `scripts/test-rls.sql` — two new numbered sections (25, 26), plus three new
  `\set` fixture-id variables (`SESSION_DERIVED_TERM`, `ALDER_SESSION_GROUP`,
  `ALDER_MANAGED_GROUP`). Section 25: `groups.manage` catalog-row + fixture
  binding proof, plus the DELETE-of-an-already-derived-`group_memberships`-row
  regression (setup assertion → attempted delete inside a `do $$ ... exception
  when check_violation$$` block → confirms the row still exists after
  rollback). Section 26: the `groups` UPDATE-guard regression against the
  Session fixture row's `name` and `description`, plus a fourth assertion
  proving the new trigger is NOT overbroad — an ordinary managed group
  (Property Committee) can still be renamed.

### Schema Changes

- No new tables or columns. Two SQL-layer behavior changes (widened trigger
  function + one wholly new trigger) and one new `permissions` catalog row —
  all as `drizzle/0033_presby_groups_administration.sql` above.
- Applied via: `npm run db:migrate` in production/staging; for this session,
  applied directly with `psql "$MIGRATE_DATABASE_URL" -f
  drizzle/0033_presby_groups_administration.sql` against the shared Neon dev
  branch already in use by this session's other concurrent pipelines (no
  dedicated branch cut for this commit — schema-only, low risk, and the
  fixture drift was ordinary "several pipelines editing the same seed script
  today," not a structural conflict). `db:generate` remains broken on the
  pre-existing snapshot collision tracked in `docs/TODO.md`, so this is
  hand-authored per the established post-0012 convention.

### Audit Events

- None — this commit is schema/permissions/seed only. `GROUP_CREATED`/
  `GROUP_UPDATED`/`GROUP_MEMBER_ADDED`/`GROUP_MEMBER_ENDED` are
  `full-stack-developer`'s to add to `src/lib/audit.ts` and wire into
  `groups/actions.ts`, per Phase 3's Component/Page Plan.

### Implementer Notes

- **Bug found and fixed during this commit's own live verification, not by
  review:** the first draft of the widened
  `presby_reject_derived_group_write()` compared `tg_op = 'delete'`
  (lowercase). `TG_OP` is populated uppercase (`'INSERT'`/`'UPDATE'`/
  `'DELETE'`/`'TRUNCATE'`) — the lowercase literal silently never matched, and
  the DELETE fell through unrejected. Caught by running the new section-25
  regression test against a live database (it failed with "FAIL invariant 5 —
  an already-derived group_memberships row was deleted directly" instead of
  producing the expected `check_violation`), fixed to `tg_op = 'DELETE'`,
  re-applied, re-tested — passes. Left an inline comment in the migration
  naming this so a future reader doesn't reintroduce it. Same "caught by
  running it, not by reading a raw SQL predicate" discipline this file's own
  F26/DECISION-109 findings already established — a second instance of it.
- **Live-DB verification method:** ran the full `scripts/test-rls.sql` suite
  first; it fails at an EARLIER, unrelated section (section 2, membership
  count) even on a clean `git stash` of the working tree with no changes of
  mine applied — confirmed this is pre-existing drift from other concurrent
  pipelines' fixture edits sharing the same live Neon dev branch today, not
  something this commit introduced. Isolated sections 25/26 (with their
  `\set` preamble) into a scratch file and ran them standalone against the
  live `APP_DATABASE_URL` connection (`presby_app`, not the owner) — all 8
  assertions pass. The migration itself was applied for real against
  `MIGRATE_DATABASE_URL`; the `seed-dev.sql` fixture fix (dedup + permission
  grant) was applied by hand via equivalent `UPDATE`/`DELETE`/`INSERT`
  statements against the already-loaded live fixture, since `seed-dev.sql`
  itself is a one-shot, non-idempotent load script not safe to re-run against
  a DB it already populated — the hand-applied statements are the exact
  net effect the corrected script produces on a fresh load, confirmed by
  re-querying the affected rows after.
- `npm run typecheck` and `npm run check:sql-date` both pass clean with no
  application-code changes in this commit.

**Handoff:** `full-stack-developer` (Phase 4 commit 2) — `src/lib/groups.ts`,
`src/app/(org)/o/[slug]/admin/groups/actions.ts`, and the full UI tree (four
pages, six components, `PORTAL_TILES`/`org_portal.groups` flag-seed wiring,
this module's own unit + component tests), per Phase 3's exact function
signatures and result-variant shapes. New surfaces available: `groups.manage`
permission key (seeded, unbound by default beyond the `stated_clerk`
test-reachability fixture grant); `org_portal.groups` flag key still needs
seeding in `scripts/seed.ts`'s flag list (not this commit's scope — Phase 3
assigned it to the next implementer alongside the `PORTAL_TILES` entry);
`groups`/`group_types`/`group_memberships` now enforce derived-group
protection at the database layer on both the read-adjacent write paths this
pipeline's UI will exercise. Local apply: `npm run db:migrate` (or `psql -f
drizzle/0033_presby_groups_administration.sql` against a dev branch), then
`npm run db:seed` (seed changed — `seedGroupTypes()`'s new four entries).

---

## Phase 4 commit 2 (full-stack-developer)

**Date:** 2026-08-26
**Scope:** server + UI, per Phase 3's Implementer list item 2 — `src/lib/
groups.ts`, `src/app/(org)/o/[slug]/admin/groups/actions.ts`, the four pages,
the six-plus components, `AUDIT_ACTIONS`, `PORTAL_TILES`, and the
`org_portal.groups` flag seed. No further schema/migration work — commit 1's
migration was already applied.

### Files Created

- `src/lib/groups.ts` — the domain module: `hasGroupsManage` gate (checked
  first in every export), `GroupsResult<T>` union, and all six exports
  (`listGroups`, `getGroup`, `getGroupFormOptions`, `createGroup`,
  `updateGroup`, `addGroupMember`, `endGroupMembership`), shaped like
  `officers.ts` per Phase 2/3. `MANAGEABLE_GROUP_TYPE_KEYS`/`GROUP_ROLES`
  exported as the source-of-truth arrays/types.
- `src/lib/groups.test.ts` — integration suite against a real Postgres
  connection (`hasDb` skip-guard, same harness as `officers.test.ts`): 30
  tests covering the permission gate, `createGroup`'s server-side
  manageable-subset re-validation, cross-org isolation, the
  **derived-group-guard regression** (`getGroup`/`updateGroup`/
  `addGroupMember`/`endGroupMembership` all treat Session/Board of
  Deacons/Active Membership exactly as nonexistent — `invalid_target`, never
  a successful read or write, proven against a directly-inserted `source:
  'derived'` row for the `endGroupMembership` case), the **overlap
  regression** (`addGroupMember` returns `{ kind: "overlap" }` naming both
  people/group and inserts nothing; a subsequent, non-overlapping re-add
  after the first ends is allowed), and thrown-exception paths for malformed
  input.
- `src/app/(org)/o/[slug]/admin/groups/actions.ts` (+ `actions.test.ts`) —
  `createGroupAction`/`updateGroupAction`/`addGroupMemberAction`/
  `endGroupMembershipAction`, mirroring `officers/actions.ts`'s
  `resolveActingIdentity()` shape, error-copy mapping, and
  audit-on-ok-only/revalidate-on-ok-only discipline.
- Four pages: `groups/page.tsx` (list), `groups/new/page.tsx`,
  `groups/[groupId]/page.tsx` (detail + roster + add-member form +
  end-membership dialogs), `groups/[groupId]/edit/page.tsx` — each with its
  own `page.test.tsx` repeating the officers/roles auth-ordering contract
  (flag-before-permission, `OrgAccessError` re-thrown not swallowed, the
  shared four-way miss response).
- Six-plus components (+ tests): `groups-list.tsx`, `new-group-form.tsx`,
  `edit-group-form.tsx`, `add-group-member-form.tsx`,
  `end-group-membership-dialog.tsx` (`AlertDialog`, never `confirm()`, names
  both the person and the group), `group-schema.ts` (the four zod schemas),
  `group-type-labels.ts` (the UI-safe duplicate of
  `MANAGEABLE_GROUP_TYPE_KEYS`/`GROUP_ROLES`, mirroring `office-labels.ts`'s
  `server-only`-avoidance reasoning), `groups-states.tsx`
  (`GroupsFlagOff`/`GroupsForbidden`/`GroupsLoadError`).

### Files Modified

- `src/lib/audit.ts` — four new `AUDIT_ACTIONS`: `GROUP_CREATED:
  "tenant.group.created"`, `GROUP_UPDATED: "tenant.group.updated"`,
  `GROUP_MEMBER_ADDED: "tenant.group_membership.added"`, `GROUP_MEMBER_ENDED:
  "tenant.group_membership.ended"`.
- `src/lib/audit.test.ts` — the hard-coded `EXPECTED_ENTRIES` snapshot grew
  the same four keys (this test would otherwise fail on any new
  `AUDIT_ACTIONS` entry — it did, and was updated).
- `src/lib/org-portal/tiles.ts` — new `PORTAL_TILES` entry, `key: "groups"`,
  `category: "operate"` (DECISION-110 ruling 6), `flagKey:
  "org_portal.groups"`.
- `src/lib/org-portal/tiles.test.ts` — `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS`
  gained `org_portal.groups`; the declaration-order/category snapshot tests
  and the independent-filtering test suite gained the `groups` tile.
- `scripts/seed.ts` — `org_portal.groups` flag added to `seedFlags()`'s
  defaults list, seeded OFF. Also corrected a now-stale doc comment above
  `seedGroupTypes()` that still said "committee is deliberately not seeded"
  — commit 1 already extended the `defs` array; the comment was one line out
  of step with the code beneath it.
- `docs/TODO.md` — one new **In Flight** entry (see Implementer Notes below).

### Schema Changes

None — Phase 3/commit 1 already covered the full schema/permission/trigger
surface. `npm run db:push` was attempted to confirm this session's local
Drizzle types are current; it surfaced an unrelated, pre-existing
`blob_assets_org_hash_key` interactive prompt (drizzle-kit wants to
optionally truncate a 109-row table) that has nothing to do with this
pipeline's schema — correctly refused to answer that prompt non-interactively
rather than force a destructive truncate. `npm run typecheck` (the actual
signal that local types match this session's `src/lib/db/domain/groups.ts`,
unchanged) is clean.

### Audit Events

`GROUP_CREATED`/`GROUP_UPDATED`/`GROUP_MEMBER_ADDED`/`GROUP_MEMBER_ENDED`,
written from `groups/actions.ts` on the `ok` branch only, metadata shapes
documented inline in `audit.ts`'s own comments (mirrors
`OFFICER_TERM_STARTED`/`ENDED`'s `tenant.*` actor-axis convention).

### Feature Gates

- `org_portal.groups` — checked bare (no per-org toggle, matching
  `officers`/`roles`), gates whether `/o/<slug>/admin/groups` exists at all.
- `groups.manage` — checked first inside every `src/lib/groups.ts` export via
  `hasGroupsManage`; never re-implemented at the action or page layer.

### Implementer Notes — two real bugs found by RUNNING the suite against a live database, not by reading the SQL

1. **`group_types` platform-template rows are invisible to the tenant
   (`presby_app`) connection — Phase 3's design did not name this, and it
   broke `createGroup`/`getGroupFormOptions`/`listGroups`/`getGroup` in their
   first draft.** `group_types`' RLS policy (`drizzle/0009_presby_rls.sql`)
   is the standard `organization_id = presby_current_org()` predicate with no
   NULL exception. Under `withOrgContext()`'s `tx` (which every prior export
   in this module correctly uses for tenant-scoped tables), a
   platform-template row (`organization_id IS NULL`) is filtered out
   entirely — `NULL = <anything>` is never true. `scripts/seed.ts`'s own
   `seedGroupTypes()` header and `src/lib/org-provisioning.ts`'s
   `createOrganization()` already name and work around this exact property by
   reading through `getPlatformDb()` instead; this module's two group-type
   reads (`getGroupFormOptions`'s dropdown options, `createGroup`'s
   manageable-subset re-validation) now do the same, and `listGroups`/
   `getGroup` resolve the display name via a small batched `getPlatformDb()`
   lookup (`groupTypeNamesByIds()`) rather than joining `group_types` under
   `tx` at all. Caught by `groups.test.ts`'s own `createGroup` test failing
   with `invalid_input` instead of `ok` against a real database — the mocked
   unit tests for `actions.ts`/the pages never would have caught this, since
   they mock `@/lib/groups` entirely. Fixed; documented at length in
   `groups.ts`'s own module header so a future reader doesn't reintroduce a
   plain `tx` join to `group_types`.
2. **`drizzle/0033`'s widened DELETE-branch trigger blocks an org's own
   cascade-delete, not just a direct row delete — found by this module's own
   test teardown, not a design flaw in this commit's code.** Deleting an
   organization cascades (`group_memberships.organization_id`'s own direct
   `ON DELETE CASCADE` FK) through every live derived `group_memberships`
   row that org's memberships/officer terms created — exactly the
   `source = 'derived'` DELETE case the widened trigger now correctly
   rejects, but a cascade cannot tell itself apart from a direct delete.
   Confirmed with a minimal, reproducible, isolated repro (insert an org + a
   derived group + one `officer_terms` row, then `delete from
   organizations` — fails every time). `groups.test.ts`'s own `afterAll` now
   disables the trigger around its org-delete teardown step (teardown-only,
   never application code, same technique already used elsewhere in this
   file and in `officers.test.ts` for the `memberships_guard_end` trigger).
   `officers.test.ts` was NOT modified (out of this pipeline's scope) even
   though it has the identical exposure (its F22 regression test's `term2`
   stays open by design) — it reproduced the same failure at least once this
   session but not consistently on repeat runs, an unexplained second factor
   this pipeline did not chase further. Flagged as a new **In Flight** entry
   in `docs/TODO.md` for database-admin, per Workflow Rule 10 — this is a
   genuine cross-cutting regression in commit 1's migration, not something
   this commit's own code can or should fix (the migration file is outside
   this implementer's assigned scope).

### Mobile (360px) verification, done for real in a browser

Signed in as `clerk.fixture@example.invalid` (Tobias Renwick, holds
`stated_clerk`, which commit 1's fixture bound `groups.manage` to) against
the running dev server (`localhost:3000`), via Playwright driving real
Chromium at a 360×800 viewport — not an assumption that this tree inherits
officers'/members' already-verified conventions. Walked: sign-in → groups
list (an existing seed-dev.sql fixture group, "Property Committee", rendered
correctly with its platform-template type name "Committee" and a 0 member
count — this alone proved finding 1 above was actually fixed, not just
passing in isolation) → new-group form → create → detail/roster page → edit
form → add a member → the overlap toast firing correctly on a repeat add →
the end-membership `AlertDialog` (names both person and group) → confirm →
roster updates. **Found and fixed one real mobile defect this way**: the
roster `Table` on `[groupId]/page.tsx` rendered Person/Role/Since/Ends/
Actions unconditionally and, at 360px, silently scrolled `Ends` and the
"End membership" button off-screen inside the table's own horizontal-scroll
wrapper — the exact failure mode `officer-roster.tsx`'s own header already
documents finding and fixing for the officers roster. Fixed with the
identical `hidden sm:table-cell` treatment on `Role`/`Since`, keeping
Person/Ends/Actions always reachable without scrolling. Re-verified visually
after the fix. **Housekeeping, fully reverted after verification**: this
walkthrough required temporarily flipping `org_portal.groups` on and
`auth.require_2fa` off (Alder Creek's own `organization_settings.
require_two_factor` is `true`, and `clerk.fixture` carries no TOTP
enrolment) directly via SQL against the shared dev branch — both flags were
restored to their seeded values (`false`/`true` respectively) immediately
after, and the two throwaway "Property Committee (browser check)" groups
this walkthrough created (plus their `group_memberships` rows) were deleted;
no seed-dev.sql fixture row was touched.

### Test Results

- `npm run typecheck` — clean.
- `npm test` (mocked suite) — 182/182 test files, 2486/2486 tests passing (19
  files / 419 tests skipped — the real-DB-backed suites, correctly gated by
  `hasDb`).
- `npx dotenv -e .env.local -- vitest run src/lib/groups.test.ts` — 30/30
  passing against the real shared dev database, clean teardown.
- `npm run build` — clean; all four new routes
  (`/o/[slug]/admin/groups{,/new,/[groupId],/[groupId]/edit}`) appear in the
  route manifest.
- `npm run check` (all four tripwires) — clean.

### Divergences from Phase 3's Design

- **`addGroupMember`'s signature dropped the `actingUserId` parameter Phase
  3's API contract named.** `group_memberships` carries no `recorded_by`-
  equivalent column (unlike `officer_terms.recorded_by`, which
  `startOfficerTerm` genuinely needs `actingUserId` for) — there is nowhere
  to put it. `groups/actions.ts`'s own `recordAudit()` call already captures
  the actor via the session, so no information is lost; this is a smaller
  surface than specified, not a behavior change.
- **The two "Implementer Notes" findings above** (the `group_types` RLS
  read-path bug, the cascade-delete/trigger interaction) are both new
  information Phase 3's design did not and could not have named — the first
  is a correctness fix inside this commit's own scope; the second is
  out-of-scope (commit 1's migration) and tracked in `docs/TODO.md` instead
  of fixed here.
- **`groups-list.tsx` renders as a `Table`,** which Phase 3's Component/Page
  Plan literally described as "mirrors `members-list.tsx`'s shape" even
  though `members-list.tsx` itself is a single-column `Card` list, not a
  table — read as Phase 3 intending "reuse the empty-state/structural
  conventions members-list.tsx already established" rather than "use the
  same component," since a `Table` (mirroring `officer-roster.tsx`'s
  precedent, and per Phase 1's own explicit "roster views are wide-column —
  use Table, not cards" note) is the correct shape for three genuinely
  columnar fields (name/type/member count). Verified at 360px in a real
  browser: fits cleanly with no breakpoint-gated column needed at this width.

**Handoff:** `qa` (Phase 5). What to test in the browser: the four pages at
360px and at a desktop width; the group-type dropdown only ever offering the
manageable subset; the derived-group guard (`/o/<slug>/admin/groups/<a
Session or Active-Membership group's real id>` and its `/edit` route both
404); the overlap toast; the end-membership `AlertDialog` naming both person
and group; the flag-off/forbidden/load-error states (`org_portal.groups` off,
a viewer with no `groups.manage`, and a simulated load failure). New surfaces
available: `groups.manage` permission (seeded, bound only to the
test-reachability fixture grant), `org_portal.groups` flag (seeded OFF),
`/o/<slug>/admin/groups` route tree. The `docs/TODO.md` In Flight entry above
(the cascade-delete/trigger interaction) is a real, if narrow, gap QA should
be aware of but is not this pipeline's own regression to fix.

---

## Phase 4 addendum (database-admin) — loop-back from QA's Phase 5 FAIL

**Date:** 2026-08-26
**Scope:** `src/lib/roll.test.ts` teardown fix only, plus a broader re-audit.
Not touching Phase 5's section — QA re-verifies next.

QA's Phase 5 FAIL (above) found that the earlier same-day cross-pipeline fix
(`docs/TODO.md`'s "Cross-pipeline test-teardown hazard... fixed" entry) missed
`src/lib/roll.test.ts` itself. Root cause: `roll.test.ts` already carried a
trigger-disable wrap for the unrelated `roll_actions_freeze` trigger (its own
pre-existing, legitimate reason — approved `roll_actions` rows can never be
deleted, by design), which was used as the *template* for the other 13 fixes,
but that same presence caused the original grep-based "does this file already
have a disable-trigger pattern" check to wrongly mark `roll.test.ts` as
already-fixed. It needed the *new* `group_memberships_reject_derived` trigger
disabled too — a second, independent gap, not a duplicate of the first.

### Fix

Added a second disable/enable block, distinct from the existing
`roll_actions_freeze` wrap, around `roll.test.ts`'s
`platform.delete(organizations).where(eq(organizations.id, orgA))` call:

```ts
await platform.execute(
  sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
);
try {
  await platform.delete(organizations).where(eq(organizations.id, orgA));
} finally {
  await platform.execute(
    sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
  );
}
```

The two triggers don't compose into one block — they guard different tables
(`roll_actions` vs. `group_memberships`) for different reasons, and the
`roll_actions` wrap already completes (and re-enables) before the
`organizations` delete runs. Same exact syntax as the 14 already-fixed files
(e.g. `people-update.test.ts`).

### Re-audit (more thorough than the original grep pass, per QA's instruction)

Rather than trusting "does this file appear in the already-fixed list" or
"does this file already have *a* disable-trigger pattern," checked every
DB-backed test file against the actual mechanism: does its fixture populate a
`group_memberships` row for a derived group (via `memberships.currentRoll`
triggering the `active_membership` sync, or an `officer_terms` insert
triggering the `session`/`diaconate` sync — not just a literal `group_memberships`
table reference in test source, which a trigger-populated row wouldn't show up
in), AND does its teardown cascade-delete an organization?

- Cross-referenced three independent greps: files disabling
  `group_memberships_reject_derived` by name (15 files — the 13 from the
  original fix + `groups.test.ts` + `person-sensitive.test.ts`, both already
  correct); files referencing `group_memberships` at all (15 — same set);
  files setting `memberships.currentRoll` or inserting `officerTerms` (10
  files, all already in the 15-file set, plus `roll.test.ts` itself — the one
  gap).
- Three additional candidates surfaced by a broader `delete(organizations)`
  grep and checked individually: `org-provisioning.test.ts` (creates derived
  `groups` rows via `createOrganization()` but never inserts a `people`/
  `memberships`/`officer_terms` row, so no `group_memberships` row for a
  derived group ever exists to be cascade-deleted — confirmed safe by reading
  its fixture in full), `src/app/api/sites/ingest/route.test.ts` and
  `src/lib/storage/blob-store.test.ts` (neither creates a `people`/
  `memberships` fixture at all — confirmed safe by grep for zero hits).
- **No other gaps found.** `roll.test.ts` was the only file affected beyond
  the original 13.

### Verification

- `npx dotenv -e .env.local -- npx vitest run src/lib/roll.test.ts` — 1 file
  passed, 20/20 tests passed, clean teardown (no thrown error), run twice in a
  row for stability.
- `npm run typecheck` — clean.
- `npm run check` (all four tripwires) — clean.
- Cleaned up orphaned debris from `roll.test.ts`'s pre-fix failed teardown
  runs earlier today: queried the live dev DB directly (owner connection).
  Zero `roll-test`-prefixed organizations or users remained (QA's own two
  reproductions had already been cleaned up, per its Phase 5 note). Found and
  removed 12 orphaned `people` rows and 6 orphaned `users` rows from two
  earlier stamps (`1787788152320`, `1787788210119`) whose parent organization
  had already been deleted but whose people/user rows survived the pre-fix
  throw — confirmed zero remaining FK references (`memberships`,
  `roll_actions`) before deleting. A broader scan turned up unrelated
  stamped-name debris from other pipelines' own test files (different name
  pools — `Castellan`/`Ferrers`/`Applewhite`/etc., none of which appear in
  `roll.test.ts`) — left untouched, out of this addendum's scope.

### Migration mode

No schema change in this addendum — test-file-only fix. N/A.

**Handoff:** `qa` (Phase 5, re-verification).

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS

## Unit Tests

Mocked run (`npm test`, no DB env): 182/182 files, 2486/2486 tests passing, 19 files/419 tests skipped (correctly gated `hasDb`).

**FAIL → PASS history:** the first Phase 5 pass (2026-08-26) found `src/lib/roll.test.ts` failing deterministically on teardown — its cascade delete hit `drizzle/0033_presby_groups_administration.sql`'s widened DELETE-branch trigger via the fixture's `active_membership`-derived `group_memberships` row, because the file already had a trigger-disable wrap for the *unrelated* `roll_actions_freeze` trigger and was wrongly treated as "already fixed" by an earlier same-day cross-pipeline pass. Returned to the implementer, who added a second, independent disable/re-enable block for `group_memberships_reject_derived`. QA re-verified independently: read `roll.test.ts:307-352` and confirmed both blocks are `try`/`finally`-scoped, sequential, and non-interfering; ran the file twice against the real dev DB (20/20 passed, clean teardown both times, zero orphaned rows after). Also independently re-checked the implementer's broadened re-audit of three additional candidate files (`org-provisioning.test.ts`, `src/app/api/sites/ingest/route.test.ts`, `blob-store.test.ts`) — confirmed none creates a `people`/`memberships`/`officer_terms` fixture that could produce a derived `group_memberships` row. A combined real-DB run of all 16 files touching `group_memberships_reject_derived` (twice) showed no cross-fix interaction effects.

`src/lib/rate-limit.test.ts`: 3 failures reproduced in isolation, caused by `RATE_LIMIT_DISABLED=true` (required for e2e) short-circuiting in-memory-map assertions — pre-existing environmental artifact of loading `.env.local`, unrelated to this pipeline, not counted against this verdict.

## SQL-Layer Regression Tests (`scripts/test-rls.sql` sections 25/26)

Ran standalone against the real dev DB — all 8 assertions pass: `groups.manage` permission-catalog row exists; DELETE of an already-derived `group_memberships` row is rejected (confirms the `TG_OP = 'DELETE'` uppercase fix genuinely works, not just typechecks); UPDATE of a derived group's name/description is rejected; an ordinary managed group can still be renamed (the new trigger is not overbroad).

## Regression Tests Added

- `src/lib/groups.test.ts`'s "derived-group guard" suite — `getGroup`/`listGroups`/`updateGroup`/`addGroupMember`/`endGroupMembership` all return `invalid_target` against Session/Active-Membership derived rows. Confirmed genuine.
- `src/lib/groups.test.ts`'s "addGroupMember — overlap regression" suite — confirmed genuine, matches DECISION-110 ruling 4.
- `scripts/test-rls.sql` sections 25/26 — confirmed failing-before/passing-after, independently re-run.
- **Gap named, not present:** no regression test (unit or SQL) exists proving the migration's DELETE-branch widening doesn't break an existing DB-backed fixture's teardown — this exact gap is what let `roll.test.ts` regress silently.

## Coverage on Critical Modules

Not applicable (`permissions.ts`/`two-factor.ts`/`flags.ts` untouched). `src/lib/groups.ts` — 30/30 real-DB tests passing, all five `GroupsResult` variants exercised.

## Feature-Gate Audit

No `src/app/api/**/route.ts` added or changed.

| Route or action | `auth()`/session present? | Tenant-permission gate present? | Correct key? |
|---|---|---|---|
| `groups/page.tsx` | yes | yes — `listGroups()`'s own gate | `groups.manage` |
| `groups/new/page.tsx` | yes | yes — `getGroupFormOptions()` | `groups.manage` |
| `groups/[groupId]/page.tsx` | yes | yes — `getGroup()` | `groups.manage` |
| `groups/[groupId]/edit/page.tsx` | yes | yes — `invalid_target` (derived or nonexistent) → `notFound()`, never renders the form | `groups.manage` |
| `createGroupAction` | yes | yes | `groups.manage` |
| `updateGroupAction` | yes | yes — re-loads scoped `membership_source='managed'` before mutating | `groups.manage` |
| `addGroupMemberAction` | yes | yes | `groups.manage` |
| `endGroupMembershipAction` | yes | yes — re-loads scoped `source='managed'` | `groups.manage` |

`organizationId` is never client-supplied in any action. `getPlatformDb()` scoping verified line-by-line in `src/lib/groups.ts` — every call hard-filters `isNull(groupTypes.organizationId)` or is keyed only on ids already resolved under tenant-scoped `tx` — no path lets a tenant read another org's own rows through the platform connection.

## Other Verification Items

- Application-layer guards confirmed independent of the trigger: `updateGroup`/`endGroupMembership` both re-load scoped to `managed` before acting, not relying on the trigger to fail closed.
- Cascade-delete: no production org-deletion code path exists (confirmed by grep) — genuinely a test-fixture-only concern, now fully remediated.
- No group deletion/archival anywhere in shipped code — confirmed.
- `org_portal.groups` confirmed seeded OFF in the live DB; no lingering flag-on state from the implementer's browser walkthrough.

## Verdict

**PASS**

This pipeline's own migration is correct and both invariant fixes are genuinely enforced at the database layer, verified directly. Application-layer guards, feature gates, overlap handling, and `getPlatformDb()` scoping are all correctly implemented. The one blocking defect from the prior FAIL — the migration's trigger regressing `roll.test.ts`'s teardown — is genuinely fixed and independently re-verified (read directly, confirmed correctly scoped, run twice against the real DB with clean teardown both times). Full suite, typecheck, build, and all four tripwires clean; a combined real-DB run of all 16 affected files shows no cross-fix interaction effects.

**Handoff:** analyst (Phase 6 — Shipped vs Intent).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The feature itself — create/edit a managed committee, add/end members, view a roster, with a derived group genuinely unreachable at both the trigger and route layer — is shipped correctly and matches Phase 1's flows exactly; what's missing is entirely housekeeping (release notes, functionality map, TODO's own Done line, a what's-new call) that Rule 10/14 assign to this phase and that hasn't happened yet.

## What's Working

- The derived-group guard is real, not decorative: `[groupId]/edit/page.tsx`'s `getGroup()` `invalid_target` resolves to `notFound()` — a typed-in Session/Board-of-Deacons id 404s exactly like a nonexistent one, closing the guard at the route layer. The database layer backs it independently (two enforcement layers, neither trusting the other), confirmed both by direct code read and QA's independent re-run of `scripts/test-rls.sql` sections 25/26.
- Permission-then-flag ordering is consistent across all four pages, with three distinct copy blocks that don't collapse a permission denial into a generic error.
- Failure microcopy is human; empty state is genuinely helpful ("No members yet" next to the add-member form, not just blank).
- No native dialogs — `AlertDialog` throughout, names both person and group.
- Audit wired correctly on all four mutations.
- The `groups.manage` fixture-binding framing ("a labeled test-reachability convenience only, not a recommended production default") reads honestly and is carried verbatim from Phase 3 through Phase 4's implementer notes — nothing downstream mistakes it for a real default-role ruling.
- Both live-testing bugs (the `group_types` RLS-invisibility fix, the cascade-delete/derived-trigger interaction) are documented, not silently absorbed.
- The cross-pipeline test-teardown hazard this pipeline caused is now fully resolved, not half-fixed — the original 13-file fix plus its `roll.test.ts` correction both read as accurate, appended-in-place records.
- Mobile (360px) verified live in a real browser; one real defect (a roster-table column scrolling the End-membership action off-screen) found and fixed the same session, re-verified after.

## Intent-vs-Shipped Diff

- Phase 1 said: create a managed group restricted to `committee`/`small_group`/`choir`/`team`. Shipped: server-side restriction + independent re-validation on create. **Matches.**
- Phase 1 said: edit name/description/`meets_when` for managed groups only, derived groups never render an edit form. Shipped: exactly this, at both the route and database layer. **Matches.**
- Phase 1 said: add/end members with `group_role` and dates, soft-end only. Shipped: exactly this, no delete path anywhere. **Matches.**
- Phase 3 named this pipeline's own release-notes entry and functionality-map update as Phase 6 ownership. Shipped: neither exists — `docs/release-notes/v0.16.md` covers five other same-day features but not this one; `docs/product/functionality-map.md` has no bullet for the new surface, the two trigger hardening fixes, or the `group_types` seed extension. **Gap**, matching a pattern two earlier same-day pipelines already hit.
- Rule 10 said: shipping something moves its Done line into `docs/TODO.md` in the same commit. Shipped: Done lines exist for the teardown-hazard bug this pipeline caused, but not for the feature itself. **Gap.**

## Edge Cases

- Empty state: pass.
- Failure microcopy: pass.
- Permission gate: pass — confirmed route-by-route via QA's feature-gate audit.
- Audit event: pass — all four mutations wired.
- Mobile (360px): pass — verified live, one real defect found and fixed.

## Follow-Ups (SHIP WITH NOTES)

- Add the `docs/release-notes/v0.16.md` entry for groups administration.
- Add the `docs/product/functionality-map.md` bullet for `/o/<slug>/admin/groups` (managed-group CRUD, `groups.manage` permission, `org_portal.groups` flag) plus the two invariant-hardening trigger fixes and the `group_types` platform-seed extension.
- Add this feature's own Done line to `docs/TODO.md`.
- What's-new advisory (Rule 13): defer, don't publish yet, matching the officer-terms precedent — `org_portal.groups` ships seeded OFF, so no real congregation can reach this surface yet.
- The cascade-delete/derived-trigger interaction (`docs/TODO.md`) stays open and correctly unowned by this pipeline.
- Rule 12 does not apply — no Source block, not originated from in-app feedback.

## Red Flags (if NEEDS REWORK)

- Not applicable — verdict is SHIP WITH NOTES, not NEEDS REWORK.
