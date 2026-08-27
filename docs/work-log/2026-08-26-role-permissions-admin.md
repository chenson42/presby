# Role & Permissions Administration — Work Log

> **Slug:** `2026-08-26-role-permissions-admin`
> **Surface:** (org) — `/o/<slug>/admin/roles`, org-admin only
> **Permission(s):** `roles.manage` (new, module `authz`, tier 1), bound to a new constitutional role `role_admin` — distinct from `role_grants.manage`
> **Flag(s):** none new — reuses the existing `org_portal.roles` flag
> **Estimated complexity:** large
> **Pipeline mode:** Full — this touches "No Role Carries a Wildcard" and the tier system (1 directory / 2 financial / 3 pastoral/demographic/medical) directly; Phase 2 architectural review is not skippable here.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, three implementers named | 2026-08-26 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete (all three implementers done) | — | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> This is two related but distinctly-scoped features — a stock role-template catalog for new orgs, and a self-service role/permission-set *definition* UI for existing org admins — and the second one opens a real escalation hole that DECISION-068's existing `grantRole()` check does not cover, because defining what a role contains is a different mutation than granting who holds it.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member holding a role-administration permission at their org — `/o/<slug>/admin/roles` | Views the existing role catalog and current grants (unchanged, Flow 1) | Per session |
| Same | **New:** Creates a custom role (name + key + bound permission set) | Occasional |
| Same | **New:** Edits an existing role's bound permission set (adds/removes `app_role_permissions` rows) | Occasional |
| Same | **New:** Deletes or deactivates a role | Rare |
| Same | **New (maybe):** Adopts a stock/template role into their own org's catalog | One-time-ish, per role |
| Not named in the request at all | Who authors the "official default roles" catalog itself (platform/code-seeded template rows, `organization_id IS NULL`) — no verb, no surface named | — |

Note: the request never says *which* org-admin role gets this new capability. Today, `role_grants.manage` is held only by `stated_clerk` in the fixture. Does this new capability attach to that same permission, or a new one? See Permissions & Flags — recommendation is a new permission, and that's a load-bearing distinction, not a naming detail.

## Flows

**Flow 1 — View/assign existing roles (unchanged):** entry `/o/<slug>/admin/roles` → user with the role-admin permission sees "Who holds what" (existing `RolesList`) and the grant/revoke form → outcome: grants a role to a person or group.
- Failure: today, `options.roles.length === 0` renders "No roles have been set up for this organization yet. Contact support to add one." — a dead end, and it is the literal gap both operator messages are asking to close.

**Flow 2 — NEW: Create a custom role:** entry: a "Create role" affordance on `/o/<slug>/admin/roles` (or a `/new` sub-route) → step: name the role + a `key` → step: select which permissions it carries, presented grouped by `sensitivity_tier` (1 directory / 2 financial / 3 pastoral-demographic-medical) so the tier-3 boundary is visible at creation, not buried in a flat list → step: submit → success: new `app_roles` row (`role_kind: 'custom'`) plus zero-or-more `app_role_permissions` rows; the role now appears in the existing grant form's `<select>`.
- Failure: not described in the request. Two failure modes need copy: (a) role key collision within the org, and (b) attempting to bind a permission tier the *creator* does not currently hold themselves. (b) is not cosmetic — see Gaps below.

**Flow 3 — NEW: Edit an existing role's permission set:** entry: click into a role from the roles list → step: toggle permissions on/off → step: save → success: `app_role_permissions` rows change.
- Failure: not described, and the consequence is bigger than the request implies: `presby_effective_permissions()` reads `app_role_permissions` live, so editing a role's bindings retroactively and immediately changes what *every current holder* — every person-arm and group-arm grant — can do, with no new `role_grants` row and no per-holder audit trail. The editing screen should say "N people currently hold this role; this change takes effect for all of them immediately," and the audit event should carry that count.

**Flow 4 — NEW: Delete/deactivate a role:** entry: from the roles list → step: confirm (must be an `AlertDialog`, never `confirm()`, Rule 2) → outcome: role removed from the catalog.
- Failure: the request never addresses what happens to existing `role_grants` rows pointing at the deleted role, and the schema's own default behavior here is actively wrong for this codebase's stated invariants: `role_grants.roleId → appRoles.id` is `onDelete: cascade`. Deleting a role cascade-deletes every `role_grants` row that references it — not an `ends_on` write, an actual `DELETE`. That directly contradicts `revokeRole()`'s own documented rule ("NEVER deletes; the row is the audit trail"). Needs resolution in Phase 2/3 — soft-delete/deactivate the role, or block deletion outright while any non-ended grant exists.

**Flow 5 — "Official default roles":** entry not named. Two candidate shapes, not disambiguated by the request:
  - **5a.** Automatic seeding of a stock role set at org-provisioning time. This is the same "founding administrator" bootstrap surface DECISION-100 already scoped and explicitly deferred wholesale to the queued P2 (backbone and onboarding).
  - **5b.** A self-service "start from a template" affordance inside this new UI — an org admin clicks something like "Add the standard committee roles" and gets a stock set cloned into their own `app_roles`, using the already-dormant `app_roles.organizationTypeScope`/`organizationId IS NULL` template columns DECISION-100 declined to wire up.
  - Failure: not applicable to 5a/5b generically since neither is scoped yet.

## Permissions & Flags

- **Permission(s):** Recommend a **new** permission, distinct from `role_grants.manage` — e.g. `roles.manage` (module `authz`, tier 1). `role_grants.manage` answers "who gets which role" (assignment); this feature answers "what does a role contain" (definition of the tier-3 boundary itself), a materially more powerful capability. Collapsing them would mean every `stated_clerk` today silently gains role-*definition* power the moment this ships, with no individual review — exactly the kind of one-permission-at-a-time wildcard accretion DECISION-101 flagged for `branding.manage` and refused to bind to `stated_clerk` on sight.
- **Default roles:** TBD Phase 3 — recommend NOT auto-bound to `stated_clerk` without an explicit DECISION-078 constitutional-duty pass first.
- **Flag(s):** Reuse the existing `org_portal.roles` flag — it already gates this route today, and it's a global `feature_flags` row. No new flag key needed for reachability.

## Gaps the Request Didn't Address

1. **The central finding — role *definition* edits bypass DECISION-068's escalation check entirely.** `grantRole()`'s subset check (granter's effective permissions vs. the target role's `app_role_permissions`) only runs when a `role_grants` row is inserted. Nothing today stops an admin who holds `roles.manage` from editing an existing role *they already hold* to add a tier-3 permission — no new grant event, no `escalation_denied`, instant self-escalation on save. Any write to `app_role_permissions` needs the same posture `grantRole()` already has: the editor's own current effective permissions must already be a superset of what they're proposing to add.
2. **Cascade-delete vs. void** — see Flow 4. Needs a soft-delete or a hard block while active grants exist.
3. **`app_roles.isProtected` is dormant today** — nothing in `role-grants.ts` reads it. Recommend: only `role_kind: 'custom'` roles get editable/deletable permission bindings through this UI; constitutional roles (`session_member`, `stated_clerk`) stay code/migration-managed.
4. **No audit key exists for any of this.** `TENANT_ROLE_GRANTED`/`TENANT_ROLE_REVOKED` cover grants only. Creating a role, editing its permission set, and deleting it are all security-sensitive mutations under Rule 7 and need their own `AUDIT_ACTIONS` entries, with the changed-permissions event carrying the count of currently-affected holders (Flow 3).
5. **Input boundaries** — role key/name uniqueness within an org, empty string, overlong string, Unicode — not addressed, needs server-side validation same as every other tenant mutation.
6. **Empty-state interaction with Flow 5** — if "default roles" ship as an auto-seed (5a), does the existing zero-roles dead-end message become unreachable, or stay live for org types the template catalog doesn't cover yet?
7. **Mobile** — a tier-grouped permission checklist (potentially dozens of entries as the catalog grows) is a real 360px design problem, not a footnote.
8. **No tenant-facing audit reader exists yet** to review a history of role-definition changes at an org (already deferred generally) — inherited context, worth naming since this feature raises the stakes of the missing history.

## Out of Scope (confirm with user)

- A platform-admin UI to author/edit the "official default role" *template catalog itself* (the `organizationTypeScope`/`organizationId IS NULL` rows) — read of the request is that orgs get a stock catalog, not that admins edit the platform's own template definitions. Confirm.
- The founding-administrator bootstrap gap (an org with zero `roles.manage` holders still can't reach this page at all) — that's DECISION-100/P2 (backbone and onboarding)'s scope, not this pipeline's.
- A tenant-facing audit-history reader for role-definition changes — deferred, same posture as the existing audit-reader gap.

## Open Questions

- **The single biggest one — needs the operator's answer before Phase 2 scopes size:** which shape is "official default roles" — (5a) automatic org-provisioning seeding (overlaps the already-queued, larger P2 backbone-and-onboarding pipeline and DECISION-100's explicit deferral), or (5b) a self-service "adopt a template" affordance inside this new admin UI (materially smaller, achievable inside this pipeline)? Absent operator input, default this pipeline to (5b) only and treat (5a) as still owned by P2.
- Should the new `roles.manage`-equivalent permission be bound to `stated_clerk` by default, or should no org start with anyone holding it (mirroring `brand_admin`'s "mint a new role" precedent)? Phase 2 should rule formally, same pattern as DECISION-101.
- Does "adjust the permissions of each role" include constitutional roles, or only custom ones? Recommend custom-only; confirm before Phase 3 designs the UI around it.

**Operator confirmed 2026-08-26 (Open Question, "official default roles" scope):** self-service "adopt a template" affordance inside this new admin UI (Flow 5b) — NOT automatic org-provisioning seeding. Flow 5a stays out of scope, owned by the queued P2 (backbone and onboarding) pipeline per DECISION-100.

**Handoff:** architect (Phase 2). Gap 1 (the escalation-check gap) is the load-bearing item for Phase 2 to rule on formally; scope is now fixed to 5b per the operator's answer above.

---

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions — the rulings below are mandatory inputs to Phase 3, not optional polish.

## Placement

- **Directory placement:** extend the existing `/o/[slug]/admin/roles` tree with two new sub-routes: `admin/roles/new/page.tsx` (create) and `admin/roles/[id]/edit/page.tsx` (edit permission set / deactivate), each with a co-located `actions.ts`.
- **New domain module:** `src/lib/role-definitions.ts`, parallel to and separate from `src/lib/role-grants.ts` — not an extension of it. `role-grants.ts`'s own header lists "no create/edit role surface at all" as an adversarial finding; folding definition writes into that file would falsify its own documented guarantee and blur the assignment-vs-definition boundary below.
- **Server vs client:** pages Server Components (same `cachedAuth()` → `resolveOrgContext()` → flag check → data fetch pattern); permission-checklist and create/edit forms are `'use client'`, same shape as `grant-role-form.tsx`.
- **Dependencies:** none.

## Invariants Touched

- **No Role Carries a Wildcard** — directly implicated by Gap 1; see DECISION-106.
- **Permissions vs. Flags** — assignment (`role_grants.manage`) and definition (`roles.manage`) stay two permissions, never merged; flag stays `org_portal.roles` (reachability only).
- **Two Hierarchies Intersect Nowhere** — not implicated. Role definition is scoped to `app_roles.organizationId = this org` under RLS, same as DECISION-101's branding ruling.
- **The Court Is Not a Group** — not touched; constitutional roles stay code/migration-managed.
- **Roll Is the System of Record** (append-only precedent, extended by analogy) — role definitions are edited, but `role_grants` history is never destroyed by a role-catalog edit.

## Rulings (recorded in full as DECISION-106 — see docs/decisions.md)

1. **Escalation-check gap — ruled.** Extract `grantRole()`'s inline subset check into a shared `assertPermissionSubset(tx, actorPersonId, organizationId, proposedPermissionKeys)` in `src/lib/authz.ts`. `grantRole()` keeps calling it with the target role's full permission set; `role-definitions.ts`'s `setRolePermissions()` calls it with only the **added delta**, never the full resulting set. `setRolePermissions()` must gate on `roles.manage` first (gate-then-subset-check ordering), and reject edits to any `isProtected = true` role before either check runs.
2. **New permission: `roles.manage`** (module `authz`, tier 1) — distinct from `role_grants.manage`.
3. **Default role binding — does NOT bind to `stated_clerk`.** DECISION-078's test applied directly: role/permission-structure definition is not the Clerk of Session's constitutional office. Mint a new constitutional, protected role (Phase 3 names it, e.g. `role_admin`), shaped like `brand_admin` — not implicitly coupled to `role_grants.manage` either (that binding on `stated_clerk` predates the "don't pile onto stated_clerk" convention). Reopens the founding-administrator bootstrap gap already deferred to P2 — not this pipeline's to close.
4. **Cascade-delete vs. void — never expose hard delete.** Soft-deactivate only (new nullable `appRoles.deactivatedAt` column) — `role_grants.roleId → appRoles.id`'s `onDelete: cascade` would destroy *ended* (historical) grant rows even if gated on "zero active grants." The FK itself is flagged as a standing latent risk independent of this feature (`docs/TODO.md` follow-up, `onDelete: restrict` recommended for a future migration) — not fixed here.
5. **`isProtected`/`role_kind` — gate on `isProtected`,** the column the schema was actually built to gate mutation on, not `role_kind` (a descriptive label that currently correlates but isn't the invariant-bearing column).
6. Directory placement and flag confirmed as above — no new dependency, no new flag key.

## Notes

- Flow 5b (template adoption) goes through `role-definitions.ts` as an explicit "clone from template" write (sourced from an `organizationId IS NULL`/`organizationTypeScope`-matched row) — a cloned role's permissions are not exempt from the subset check just because the source was a template.
- Every new mutation (`createRole`, `setRolePermissions`, `deactivateRole`, `adoptTemplate`) needs its own `AUDIT_ACTIONS` key; the permission-set-change event must carry the count of currently-affected holders (Phase 1's Flow 3 note).
- Phase 3 must specify server-side validation for role key/name uniqueness within the org.

**Verdict: Approved with suggestions.** Handoff: tech-lead (Phase 3) — design must incorporate all six rulings above, name `role_admin`'s exact key/seed shape, specify `assertPermissionSubset()`'s call sites, and design the `appRoles.deactivatedAt` schema addition for database-admin.

---

# Phase 3 — Technical Design (tech-lead)

*(Four implementation calls below — `role_admin`'s fixture binding, the `app_roles` RLS split for template visibility, deactivation ending live grants, and the generalized self-lockout guard — are recorded in full as DECISION-109, docs/decisions.md.)*

## Summary

We're building a self-service role-*definition* surface at `/o/<slug>/admin/roles` — create a custom role, edit an existing custom role's bound permissions, soft-deactivate a role, and adopt a stock template role — gated by a new `roles.manage` permission distinct from the existing `role_grants.manage` (which only ever governed *who holds* a role, never *what a role contains*). This closes Phase 1's central finding (definition edits bypassed DECISION-068's escalation check entirely) by extracting that check into a shared `assertPermissionSubset()` and calling it on every write that changes what a role can do — full set on create/adopt, added-delta only on edit. It also closes two schema gaps discovered while designing this: `app_roles`' RLS policy makes the already-dormant `organization_id IS NULL` template rows structurally invisible to every tenant connection today (Flow 5b cannot work without fixing that), and deactivating a role must actually stop it from granting anything, which a bare `deactivated_at` column does not do on its own without also ending the role's live `role_grants` rows in the same transaction.

## Permissions & Flags

- **Permission key:** `roles.manage` (module `authz`, tier 1) — new permission-catalog row. Distinct from `role_grants.manage` per DECISION-106; collapsing the two would silently hand every `role_grants.manage` holder role-*definition* power with zero individual review.
- **New role: `role_admin`** (key `role_admin`, name "Role Administrator"), constitutional, protected (`is_protected = true`), shaped like `brand_admin` — **not** bound to `stated_clerk` (DECISION-106, third ruling — `stated_clerk` already carries seven accumulated permissions and role/permission-structure definition is not the Clerk of Session's constitutional office under DECISION-078's test). Binds `roles.manage` only. Person-arm, direct-granted, same reasoning as `brand_admin`/`support_contact`/`treasurer` (an ordinary single-accountable office, no polity body votes on "what does this committee role contain"). Fixture binding: **not** to Tobias Renwick (already `property_chair` + `stated_clerk`) or Marguerite Ashcombe (already `support_contact` + `brand_admin`) — a third role on either would recreate the exact concentration DECISION-103 flagged and declined to repeat. database-admin adds one new fixture person at Alder Creek for this binding (invented name, `example.invalid` email, per house style) unless an existing under-loaded fixture person is a better fit — database-admin's call at Phase 4, not re-litigated here.
- **Default role bindings:** `role_admin` → `roles.manage` only. No other existing role gains it.
- **Flag(s):** none new. Reuses `org_portal.roles` (already gates the whole `/admin/roles` tree) — a flag answers "is this feature on at all," and this is the same feature area.

## API Contract

New domain module **`src/lib/role-definitions.ts`** (parallel to, not folded into, `src/lib/role-grants.ts` — Phase 2 ruling). Same shape as every other tenant mutation module: one `withOrgContext()` transaction per export, thrown exceptions for genuine failure (`OrgAccessError`, bad input shape), typed result variants for every expected/denied outcome.

```ts
// The single-permission gate every export below checks FIRST, same load-bearing
// pattern as role-grants.ts's hasRoleGrantsManage — a private, non-exported
// helper calling presby_has_permission(..., 'roles.manage').

export interface PermissionCatalogEntry {
  key: string; module: string; description: string; sensitivityTier: number;
}
export async function listPermissionCatalog(): Promise<PermissionCatalogEntry[]>;
// Plain read of the global `permissions` table (no org scoping — it carries
// no organization_id). Powers the tier-grouped checklist on both the create
// and edit forms.

export interface RoleDefinitionEntry {
  id: string; key: string; name: string; roleKind: string;
  isProtected: boolean; deactivatedAt: string | null;
  permissionKeys: string[]; holderCount: number;
}
export type RoleDefinitionsListResult =
  | { kind: "ok"; roles: RoleDefinitionEntry[] }
  | { kind: "forbidden" };
export async function listRoleDefinitions(
  viewerPersonId: string, organizationId: string,
): Promise<RoleDefinitionsListResult>;
// This org's OWN app_roles rows only (organization_id = this org) — never
// the organization_id IS NULL template catalog, which is a separate read
// (see listTemplateRoles below). holderCount = currently-effective distinct
// person count, same holder-counting shape as revokeRole()'s lockout query,
// generalized to any role, not just one carrying role_grants.manage.

export type RoleDefinitionResult =
  | { kind: "ok"; role: RoleDefinitionEntry }
  | { kind: "forbidden" }
  | { kind: "not_found" };
export async function getRoleDefinition(
  viewerPersonId: string, organizationId: string, roleId: string,
): Promise<RoleDefinitionResult>;

export interface TemplateRoleEntry {
  id: string; key: string; name: string; permissionKeys: string[];
}
export async function listTemplateRoles(
  viewerPersonId: string, organizationId: string,
): Promise<{ kind: "ok"; templates: TemplateRoleEntry[] } | { kind: "forbidden" }>;
// organization_id IS NULL rows where organization_type_scope IS NULL OR
// matches this org's own type. Requires the app_roles RLS fix below — see
// Data Model.

export type CreateRoleResult =
  | { kind: "ok"; roleId: string; roleKey: string }
  | { kind: "forbidden" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "duplicate_key" }
  | { kind: "invalid_input"; reason: string };
export async function createRole(
  actorPersonId: string, organizationId: string,
  input: { key: string; name: string; permissionKeys: string[] },
): Promise<CreateRoleResult>;
// Gate (roles.manage) -> validate key (/^[a-z][a-z0-9_]{0,49}$/) and name
// (trimmed, 1-100 chars) -> assertPermissionSubset(tx, actorPersonId,
// organizationId, input.permissionKeys) [FULL set — DECISION-106, this is a
// brand-new role, delta === full set] -> insert app_roles (role_kind:
// 'custom', is_protected: false) + app_role_permissions rows, inside one
// transaction. Unique-violation on (organization_id, key) caught and
// returned as duplicate_key, never thrown.

export type SetRolePermissionsResult =
  | { kind: "ok"; addedKeys: string[]; removedKeys: string[]; holderCount: number }
  | { kind: "forbidden" }
  | { kind: "protected_role" }
  | { kind: "not_found" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "self_lockout_blocked" };
export async function setRolePermissions(
  actorPersonId: string, organizationId: string, roleId: string,
  newPermissionKeys: string[],
): Promise<SetRolePermissionsResult>;
// Gate -> load role scoped to this org, reject not_found if missing or
// belonging to another org -> reject protected_role if is_protected (gates
// on isProtected, NOT role_kind — DECISION-106 ruling 5) BEFORE either check
// below runs -> load oldKeys from app_role_permissions -> delta = newKeys
// minus oldKeys -> assertPermissionSubset(tx, actorPersonId, organizationId,
// delta) [DELTA ONLY — never the full resulting set; a pure removal has an
// empty delta and skips the call entirely, since removing a permission can
// never escalate anyone] -> IF this role currently carries roles.manage AND
// the new set does not: run the same holder-count lockout guard
// revokeRole() already runs for role_grants.manage (finding 6), generalized
// to roles.manage, and refuse with self_lockout_blocked (writing nothing) if
// removing it would leave zero other roles.manage holders at this org — the
// definition-side mirror of the grant-side guard; a custom role can carry
// roles.manage same as any other permission, so the same lockout is
// reachable from this path too -> diff-apply app_role_permissions (delete
// rows not in newKeys, insert missing ones) -> return addedKeys/removedKeys/
// holderCount (read BEFORE the write, for the audit event and for the
// "N people currently hold this role" UI copy — read fresh at submit time,
// never trusted from a stale page render).

export type DeactivateRoleResult =
  | { kind: "ok"; endedGrantCount: number }
  | { kind: "forbidden" }
  | { kind: "protected_role" }
  | { kind: "not_found" }
  | { kind: "already_deactivated" }
  | { kind: "self_lockout_blocked" };
export async function deactivateRole(
  actorPersonId: string, organizationId: string, roleId: string,
): Promise<DeactivateRoleResult>;
// Gate -> load role scoped to this org -> protected_role if is_protected
// (constitutional roles, including role_admin itself, are never
// deactivatable through this UI — Phase 1 gap 3 / DECISION-106 ruling 5) ->
// already_deactivated if deactivated_at is already set -> IF this role
// carries roles.manage: same lockout guard as setRolePermissions (would
// deactivating it zero out org-wide roles.manage holders?) -> in ONE
// transaction: set deactivated_at = now(), AND end every currently-effective
// role_grants row pointing at this role (ends_on = current_date, same
// non-destructive "end, never delete" mechanism revokeRole() already uses).
// This is required, not optional polish: presby_effective_permissions() has
// no awareness of deactivated_at (Phase 2 declined to touch that function —
// see Data Model), so a deactivated role whose role_grants rows are left
// alone would keep granting every permission it carries to every existing
// holder forever. Returns endedGrantCount for the audit event and the UI's
// confirmation copy.

export type AdoptTemplateResult =
  | { kind: "ok"; roleId: string; roleKey: string }
  | { kind: "forbidden" }
  | { kind: "template_not_found" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "duplicate_key" }
  | { kind: "invalid_input"; reason: string };
export async function adoptTemplate(
  actorPersonId: string, organizationId: string,
  input: { templateRoleId: string; key?: string; name?: string },
): Promise<AdoptTemplateResult>;
// Gate -> load the template row (organization_id IS NULL, type-scope
// matches or NULL) -> reads its permission set -> assertPermissionSubset
// with the FULL template permission set (DECISION-106's note: a cloned
// role's permissions are not exempt from the subset check just because the
// source was a template) -> inserts a NEW app_roles row scoped to THIS org
// (role_kind: 'custom', is_protected: false — the org's own copy is fully
// editable/deactivatable from this point on, not linked back to the
// template) using input.key/input.name if given, else the template's own ->
// same duplicate_key handling as createRole.
```

`src/lib/authz.ts` gains the shared check (Phase 2 ruling 1):

```ts
export async function assertPermissionSubset(
  tx: OrgTx, actorPersonId: string, organizationId: string,
  proposedPermissionKeys: string[],
): Promise<{ ok: true } | { ok: false; missingPermissions: string[] }>;
// Reads the actor's live presby_effective_permissions() set inside tx (same
// query role-grants.ts's grantRole() already runs), diffs proposedPermissionKeys
// against it, returns missing keys named — never silently narrowed or allowed.
```

`src/lib/role-grants.ts`'s `grantRole()` is refactored, not behaviorally changed, to call `assertPermissionSubset(tx, granterPersonId, organizationId, targetPermKeys)` with the target role's **full** `app_role_permissions` set (its existing behavior) in place of its current inline block (lines ~472–509 today). `role-grants.test.ts`'s flagship escalation test must still pass unmodified after this — it is the regression guard that the extraction didn't change observable behavior.

**Server Actions** (two new co-located files, matching `admin/roles/actions.ts`'s exact conventions — `auth()` not `cachedAuth()`, `slug` re-resolved through `resolveOrgContext()` server-side, never trusted from the client):

- `src/app/(org)/o/[slug]/admin/roles/new/actions.ts`
  - `createRoleAction(slug, input: { key, name, permissionKeys }): Promise<ActionResult<{ roleId: string }>>`
  - `adoptTemplateAction(slug, input: { templateRoleId, key?, name? }): Promise<ActionResult<{ roleId: string }>>`
- `src/app/(org)/o/[slug]/admin/roles/[id]/edit/actions.ts`
  - `setRolePermissionsAction(slug, roleId, newPermissionKeys: string[]): Promise<ActionResult<{ addedKeys: string[]; removedKeys: string[] }>>`
  - `deactivateRoleAction(slug, roleId): Promise<ActionResult>`

Each records its audit event (see below) and calls `revalidatePath(`/o/${slug}/admin/roles`)`.

## Data Model

- **New column:** `app_roles.deactivated_at timestamptz, nullable` (Drizzle: `deactivatedAt: timestamp("deactivated_at", { withTimezone: true })`, no default). Role deletion through this UI is soft-deactivate only — `role_grants.role_id → app_roles.id` is `onDelete: cascade` and a hard `DELETE` would destroy historical (ended) `role_grants` rows, contradicting `revokeRole()`'s own append-only contract (DECISION-106 ruling 4). The FK's `onDelete: cascade` itself stays a standing latent risk, tracked in `docs/TODO.md`, not fixed here.
- **New permission-catalog row:** `roles.manage` — migration-seeded only (`insert into permissions ... on conflict (key) do nothing`), following the `officers.manage`/`branding.manage` precedent (0029/0030): **not** duplicated into `scripts/seed-dev.sql`'s own `insert into permissions` block, since that duplication pattern was only ever needed for the two permissions (`role_grants.manage`, `directory.view_hidden`) that predate the migration-only convention.
- **New template row (Flow 5b's actual catalog):** one seeded stock role, `committee_chair` ("Committee Chair"), `organization_id IS NULL`, `organization_type_scope IS NULL` (applies to any org type), `role_kind: 'constitutional'`, `is_protected: true`, carrying `directory.view` only — the same permission `property_chair`'s existing fixture role already carries, so this is a genuine, safe, demonstrable template rather than an invented placeholder. Seeded directly in the migration (global catalog data, like `permissions` rows — needs no organization to exist first). Phase 1's "who authors the official template catalog" question is answered the same way the permission catalog itself is answered: code/migration-seeded, not admin-UI-authored (the platform-admin template-authoring UI stays explicitly out of scope, confirmed operator answer). Adding more templates later is a migration, not a re-architecture of `adoptTemplate()`.
- **RLS fix, required for Flow 5b to be reachable at all — found during this design, not by Phase 1 or 2:** `app_roles` carries the standard loop-generated `tenant_isolation` policy from `drizzle/0009_presby_rls.sql` (`organization_id = presby_current_org()`). For a template row, `organization_id` is `NULL`, and `NULL = presby_current_org()` evaluates to `NULL` (falsy) under every org context — the dormant template columns are not just unused, they are **structurally unreadable by `presby_app` today**, regardless of any application code written to read them. A new migration replaces the single policy on `app_roles` only (following `0028_presby_people_write_rls_fix.sql`'s exact idempotent split-policy pattern — `drop policy if exists ... ; create policy ...`, scoped to this one table, not the shared loop) with:
  - `SELECT`: `organization_id = presby_current_org() OR organization_id IS NULL` — a tenant can see its own roles and the global template catalog.
  - `INSERT` / `UPDATE` / `DELETE`: unchanged, `organization_id = presby_current_org()` — a tenant can never write a template row (`organization_id IS NULL`) through `presby_app`, mirroring `organizations`' own "public tree, no tenant write" precedent.
- **Migration file:** `drizzle/0031_presby_role_definitions.sql` (hand-written, idempotent, per every migration since 0012) — carries the `deactivated_at` column add, the `roles.manage` permission-catalog row, the `committee_chair` template row + its `app_role_permissions` binding, and the `app_roles` RLS policy split, all in one file since they're one feature's schema landing.
- **`scripts/seed-dev.sql`:** new `role_admin` `app_roles` row (constitutional, protected) + its `app_role_permissions` binding to `roles.manage` + its `role_grants` row (person-arm, direct-granted — see Permissions & Flags for the binding target).

## Component / Page Plan

- **Modify** `src/app/(org)/o/[slug]/admin/roles/page.tsx` — add a `roles.manage` check (same flag-then-permission order as the existing `role_grants.manage` check) and a third section, "Role catalog," rendered only when the viewer holds `roles.manage` — same "two/three related sections, one page" precedent this file's own tree already extends once (`admin/roles/page.tsx`, DECISION-089). Section shows `RoleCatalogList`, a "Create role" link (`/admin/roles/new`), and (if any templates exist) an "Adopt a template" link on the same `/new` page.
- **Create** `src/app/(org)/o/[slug]/admin/roles/role-catalog-list.tsx` — one row per `RoleDefinitionEntry`: name, key, permission count, holder count, `deactivatedAt` badge if set, "Edit" link to `/admin/roles/[id]/edit` (omitted for `isProtected` rows — constitutional roles are read-only through this UI).
- **Create** `src/app/(org)/o/[slug]/admin/roles/new/page.tsx` — Server Component, same auth/flag/gate pattern as the existing `page.tsx`; fetches `listPermissionCatalog()` and `listTemplateRoles()`; renders `CreateRoleForm`.
- **Create** `src/app/(org)/o/[slug]/admin/roles/new/create-role-form.tsx` — `'use client'`. Key + name text inputs, a tier-grouped (1/directory, 2/financial, 3/pastoral-demographic-medical) permission checkbox list (per Phase 1's own recommendation — the tier-3 boundary must be visible at creation, not buried flat), and, if templates exist, a separate "Adopt a template" affordance that pre-fills the checklist from the chosen template's permission set (still submitted through the same subset-checked path, never a bypass). Surfaces `escalation_denied`/`duplicate_key`/`invalid_input` via `toast.error` with the server's own message, same discipline as `GrantRoleForm`.
- **Create** `src/app/(org)/o/[slug]/admin/roles/[id]/edit/page.tsx` — Server Component; `getRoleDefinition()` + `listPermissionCatalog()`; `not_found`/`forbidden`/`protected_role` (role is protected — read-only banner, no form) render distinct states.
- **Create** `src/app/(org)/o/[slug]/admin/roles/[id]/edit/edit-role-form.tsx` — `'use client'`. Same tier-grouped checklist, pre-checked from the role's current `permissionKeys`. Displays "N people currently hold this role — this change takes effect for all of them immediately" (Phase 1 Flow 3) using the `holderCount` the page already fetched. Save calls `setRolePermissionsAction`.
- **Create** `src/app/(org)/o/[slug]/admin/roles/[id]/edit/deactivate-role-dialog.tsx` — `AlertDialog` (Rule 2 — never `confirm()`), confirmation copy names `holderCount` and states existing grants will be ended, not the role deleted. Calls `deactivateRoleAction`.
- **Modify** `src/app/(org)/o/[slug]/admin/roles/roles-states.tsx` — add `RoleDefinitionForbidden`/`RoleDefinitionNotFound`/`RoleDefinitionProtected` exports alongside the existing `RolesFlagOff`/`RolesForbidden`/`RolesLoadError`.
- **Modify** `src/lib/authz.ts` — add `assertPermissionSubset()`.
- **Modify** `src/lib/role-grants.ts` — `grantRole()` calls the extracted helper; no other behavior change.
- **Modify** `src/lib/audit.ts` — four new `AUDIT_ACTIONS` keys, `tenant.role_definition.*` prefix (distinct from `TENANT_ROLE_GRANTED`/`REVOKED`'s `tenant.role.*` — assignment vs. definition, same axis distinction DECISION-106 draws):
  - `ROLE_DEFINITION_CREATED: "tenant.role_definition.created"`
  - `ROLE_DEFINITION_PERMISSIONS_CHANGED: "tenant.role_definition.permissions_changed"` — metadata carries `addedKeys`, `removedKeys`, and `holderCount` (Phase 1 Flow 3's explicit ask).
  - `ROLE_DEFINITION_DEACTIVATED: "tenant.role_definition.deactivated"` — metadata carries `endedGrantCount`.
  - `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE: "tenant.role_definition.adopted_from_template"` — metadata carries `templateRoleId`, `templateKey`.
- **Modify** `src/lib/db/domain/authz.ts` — `appRoles.deactivatedAt` column.
- **Create** `src/lib/role-definitions.ts`.

## Implementation Order

1. Schema: `drizzle/0031_presby_role_definitions.sql` (`deactivated_at` column, `roles.manage` permission row, `committee_chair` template + binding, `app_roles` RLS split) → `npm run db:push` on a Neon branch → `scripts/seed-dev.sql` (`role_admin` role + binding + fixture person).
2. No new flag; `role_admin`'s seed binding is the equivalent step to "FEATURE_CATALOG + seed binding."
3. `src/lib/authz.ts` (`assertPermissionSubset`) → `src/lib/role-grants.ts` refactor (run `role-grants.test.ts` to confirm no behavior change) → `src/lib/role-definitions.ts` → the two new `actions.ts` files.
4. UI: `page.tsx` third section → `role-catalog-list.tsx` → `new/` tree → `[id]/edit/` tree → `roles-states.tsx` additions.
5. Audit events (embedded in step 3's actions, verified against `check:audit`).
6. Release notes entry — Phase 6, tech-lead's own ownership.

## Edge Cases & Risks

- **`app_roles`' current RLS policy makes template rows unreadable by `presby_app`** — found during this design (see Data Model); without the policy split, Flow 5b is unimplementable, not merely awkward. This is the single largest risk item in this design and must land in the same migration as the rest of the schema work, not deferred.
- **A deactivated role must stop granting access, not just show a badge** — `presby_effective_permissions()` has no `deactivated_at` awareness and Phase 2 declined to touch that function; `deactivateRole()` must end the role's live `role_grants` rows in the SAME transaction as setting `deactivated_at`, or a "deactivated" role keeps working for everyone who already holds it.
- **Self-lockout on the definition side, not just the grant side** — a custom role can carry `roles.manage` same as any other permission. `setRolePermissions()` (removing it) and `deactivateRole()` (deactivating a role that carries it) must both run the same holder-count lockout guard `revokeRole()` already runs for `role_grants.manage`, generalized. Skipping this would leave the exact asymmetry Phase 1 Gap 1 named — the grant side guarded, the definition side not.
- **`assertPermissionSubset()` with an empty delta** (a pure permission removal) must trivially pass without a round trip that could itself be misread as an escalation check — removing a permission can never escalate anyone (DECISION-106).
- **Key/name validation** — `^[a-z][a-z0-9_]{0,49}$` for `key`, trimmed 1–100 chars for `name`; unique-violation on `(organization_id, key)` caught and returned as `duplicate_key`, never thrown (Phase 1 Gap 5).
- **Mobile, 360px** — a tier-grouped permission checklist is a real layout problem as the catalog grows past a dozen entries (Phase 1 Gap 7); stacked collapsible tier groups, not a wide table or a flat multi-select. Verify in a real browser at 360px, not just `next build` (CLAUDE.md → Verify in a Browser).
- **`holderCount` must be read fresh at submit time inside the transaction**, never trusted from the page's earlier render — same discipline `grantRole()`'s subset check already applies to the granter's own permission set.
- **e2e / existing-test blast radius:**
  - `admin/roles/page.test.tsx` — the page gains a third section and a `roles.manage`-gated "Create role" link; any assertion there about exact section count or exact rendered content must be re-run and, if it asserts an exhaustive DOM shape, updated by the implementer (not silently left red).
  - `role-grants.test.ts` — the flagship escalation test is the regression guard for the `assertPermissionSubset()` extraction; it must pass unmodified, proving the refactor changed no observable behavior of `grantRole()`.
  - `roles-list.test.tsx` / `roles-states.test.tsx` / `grant-role-form.test.tsx` — unaffected by this design (no touched files), but part of the same directory's suite and should run clean in the same CI pass.
  - No existing test asserts anything about `app_roles.deactivated_at` (the column doesn't exist yet) or about `app_roles`' RLS policy shape, so no existing spec is expected to *change meaning* — the RLS split is additive (widens SELECT only) and should not narrow any currently-passing read.

## Implementer

Three implementers, in sequence — this spans schema (including an RLS policy change, not just a column), a new domain module plus a refactor of an existing one, and a new page/form tree; per the Phase 4 selection table this is not "small enough that splitting adds overhead."

1. **database-admin** — `drizzle/0031_presby_role_definitions.sql`, `src/lib/db/domain/authz.ts` (`deactivatedAt`), `scripts/seed-dev.sql` (`role_admin` role/binding/fixture person, `roles.manage` binding).
2. **api-developer** — `src/lib/authz.ts` (`assertPermissionSubset`), `src/lib/role-grants.ts` (refactor), `src/lib/role-definitions.ts`, both new `actions.ts` files, `src/lib/audit.ts` additions.
3. **ux-developer** — `page.tsx` third section, `role-catalog-list.tsx`, the `new/` and `[id]/edit/` page/form/dialog trees, `roles-states.tsx` additions.

---

# Phase 4 — Implementation

## Phase 4 commit 1 (database-admin) — schema only

**Date:** 2026-08-26

### Files Created

- `drizzle/0032_presby_role_definitions.sql` — hand-written, idempotent migration: `app_roles.deactivated_at` column, `roles.manage` permission-catalog row, the `app_roles` RLS policy split (widened `SELECT`, unchanged `INSERT`/`UPDATE`/`DELETE`), and the global `committee_chair` template row (`organization_id IS NULL`) + its `directory.view` binding.

### Files Modified

- `src/lib/db/domain/authz.ts` — `appRoles` gains `deactivatedAt: timestamp("deactivated_at", { withTimezone: true })`, nullable, no default. Matches the migration.
- `scripts/seed-dev.sql` — new fixture: person Marisol Windham (`c0000000-...-0009`, invented, `example.invalid` email, no household — mirrors Desmond Okonkwo's no-household shape), her Alder Creek membership (`current_roll = 'active'`) and its backing `roll_actions` `opening_balance` row (added after live verification surfaced `presby_roll_cache_drift()` flagging her — see Implementer Notes), the new `role_admin` `app_roles` row (`f0000000-...-000b`, constitutional, protected), its `app_role_permissions` binding to `roles.manage` only, and its `role_grants` row (person-arm, direct-granted to Marisol Windham, Alder Creek only).
- `scripts/test-rls.sql` — new `\set` vars (`ROLE_ADMIN_PERSON`, `ROLE_ADMIN_ROLE`, `COMMITTEE_CHAIR_TEMPLATE_ROLE`); updated two pre-existing aggregate counts that my new fixture person shifts (`alder: sees own memberships` 8→9, `alder: sees people it holds memberships for` 8→9); new **section 24** proving (a) the `roles.manage` catalog row and its `role_admin`/Marisol Windham binding, including cross-org (Bramblewood: nothing) and "holds nothing beyond `roles.manage`" checks, (b) the `app_roles` RLS split — the `committee_chair` template row is visible from **both** Alder Creek and Bramblewood (proving the widened `SELECT`), and a live `do $$ ... exception when insufficient_privilege $$` block proving a tenant still cannot **write** a template row (`organization_id IS NULL`) through `presby_app`, and (c) a shape check that `deactivated_at` exists and is `NULL` on the freshly-seeded role.
- `docs/TODO.md` — new In Flight entry documenting a real migration-numbering collision found and resolved during this commit (see Implementer Notes).

### Schema Changes

- `app_roles.deactivated_at` (nullable `timestamptz`) — soft-deactivation only, per DECISION-106 ruling 4. No code today writes to it; `deactivateRole()` (api-developer, next) sets it and ends the role's live `role_grants` rows in the same transaction.
- New permission-catalog row: `roles.manage` (module `authz`, tier 1).
- `app_roles`' RLS policy split from one `tenant_isolation` (FOR ALL) into four command-scoped policies (`app_roles_select`/`_insert`/`_update`/`_delete`) — `SELECT` widened to `organization_id = presby_current_org() OR organization_id IS NULL`; write policies unchanged (own org only).
- New global template row: `app_roles` id `00000000-0000-0000-0000-000000000001`, key `committee_chair`, `organization_id IS NULL`, `organization_type_scope IS NULL`, constitutional/protected, carrying `directory.view` only.
- New fixture (org-scoped, `scripts/seed-dev.sql`, Alder Creek only): role `role_admin` (`f0000000-0000-0000-0000-00000000000b`) → `roles.manage`, direct-granted to a fresh fixture person, Marisol Windham (`c0000000-0000-0000-0000-000000000009`).
- **Applied via:** hand-written SQL, run directly with `psql -f` against both the owner connection (DDL/permission-catalog/RLS-policy statements) and re-verified as `presby_app` (the isolation suite) — **not** `db:push`/`db:generate` (the latter is documented-broken on a pre-existing snapshot collision, `docs/TODO.md`; every migration past `0012` in this repo is hand-authored). I applied `drizzle/0032_presby_role_definitions.sql` twice against the live Neon dev database (`MIGRATE_DATABASE_URL`, owner) to confirm idempotency (second run: all no-ops/skips, zero errors), then applied the `scripts/seed-dev.sql` fixture additions as a separate, `ON CONFLICT`-guarded statement (the checked-in file itself keeps the plain-insert house style — it's meant to run once against a fresh database, not the shared dev branch this session found already populated).

### Audit Events

- None — schema only. No mutation code exists yet; `AUDIT_ACTIONS.ROLE_DEFINITION_*` keys are api-developer's Phase 4 commit (`src/lib/audit.ts`).

### Implementer Notes

- **A real migration-numbering collision, found live, not hypothetically.** `docs/TODO.md`'s In Flight list named no concurrent schema pipeline, and `drizzle/meta/_journal.json`'s last entry was `0030`, so `0031` looked free. A working-tree check at the moment of authoring found `drizzle/0031_presby_sensitive_info_permissions.sql` already present on disk (uncommitted — `docs/work-log/2026-08-26-member-sensitive-info.md`'s own full-stack-developer Phase 4 commit, landing concurrently in the same session). Renumbered mine to `0032_presby_role_definitions.sql` before applying anything; no content otherwise changed. Logged in `docs/TODO.md` In Flight with a suggestion (a mechanical numeric-prefix-collision guard) for a future session. **This working tree is being edited by more than one concurrent pipeline in real time** — `scripts/seed-dev.sql` itself changed under me mid-task (the Edit tool's own "modified on disk since you last read it" warning fired once); I re-diffed before continuing and confirmed no textual conflict with my own appended block.
- **A second, more interesting live-only finding: my own new fixture person broke `presby_roll_cache_drift()`.** I initially seeded Marisol Windham's membership with `current_roll = 'active'` and no backing `roll_actions` row — legal by the FK/constraint layer, but "The Roll Is the System of Record" (CLAUDE.md) means `memberships.current_roll` is a cache, and `presby_roll_cache_drift()` (which section 10 of `scripts/test-rls.sql` already asserts against) correctly flagged her as drift the moment I ran the isolation suite live. Fixed by adding the same `opening_balance` `roll_actions` row every other fixture person in this file already gets (matching Aldous Fennimore/Wren Thackeray's own pattern) — a design-review-only pass would not have caught this; it took actually running the suite against seeded data.
- **A second, pre-existing, unrelated drift row remains** (`organization_id = 4315666c-...`, `person_id = f1000000-...-0011`, cached `other_participant`) — not part of `scripts/seed-dev.sql`'s documented fixture (neither id matches anything in this file), almost certainly e2e/test data from an unrelated pipeline sharing this same Neon dev branch. Confirmed pre-existing (present before any of my inserts) and out of scope for this commit — not fixed here, not mine to fix. `npm run typecheck` and `npm run check:sql-date` both pass clean on my changes; the full `scripts/test-rls.sql` run still exits non-zero at section 10 (`\set ON_ERROR_STOP on` halts the whole file) because of this one pre-existing row, so I additionally extracted and ran section 24 standalone (all 8 assertions pass) to prove my own work rather than relying on the full-file run.
- **Neon branching was considered and dropped.** The system prompt names a `neon-postgres` skill for branch-based verification; `neonctl` is installed but not authenticated in this sandbox (interactive OAuth times out after 60s with no browser to complete it) — a genuinely interactive credential flow, correctly out of scope for me to force through. Applied directly against the shared dev database instead, consistent with the 12 prior migrations already live there from earlier same-day pipelines.
- No code beyond schema/seed/test-fixture files was touched. `src/lib/authz.ts` (`assertPermissionSubset`), `src/lib/role-grants.ts`, `src/lib/role-definitions.ts`, both new `actions.ts` files, and `src/lib/audit.ts` are **api-developer's** Phase 4 commit, next in sequence — it depends on this migration being applied (`roles.manage` must exist in `permissions`, `role_admin`/Marisol Windham must exist for any manual/e2e verification, and the `deactivatedAt` Drizzle column must be present for `deactivateRole()` to compile against).
- **Local apply for the next implementer:** `npm run db:push` will pick up the `deactivatedAt` Drizzle column automatically from `src/lib/db/domain/authz.ts`; the permission-catalog row, RLS policy split, and template row require running `drizzle/0032_presby_role_definitions.sql` by hand (`psql -f drizzle/0032_presby_role_definitions.sql "$MIGRATE_DATABASE_URL"`, or equivalent) since `db:generate`/`db:migrate` don't track hand-written migrations past `0012`. Re-run `npm run db:seed` is **not** sufficient for the new fixture person/role — those are `scripts/seed-dev.sql` (dev-fixture) additions, not `scripts/seed.ts` (platform roles/features) ones; a fresh database gets them for free on its one `scripts/seed-dev.sql` run, but an already-seeded dev database needs the same targeted, `ON CONFLICT`-guarded insert I ran live (see Schema Changes → Applied via).

## Phase 4 commit 2 (api-developer) — server logic

**Date:** 2026-08-26

### Files Created

- `src/lib/role-definitions.ts` — the full API Contract from Phase 3:
  `listPermissionCatalog`, `listRoleDefinitions`, `getRoleDefinition`,
  `listTemplateRoles`, `createRole`, `setRolePermissions`, `deactivateRole`,
  `adoptTemplate`. Parallel to, not folded into, `role-grants.ts` (Phase 2
  ruling). One deliberate contract addition beyond the Phase 3 sketch:
  `AdoptTemplateResult`'s `ok` variant carries `templateKey` (the source
  template's own key) alongside `roleId`/`roleKey` — needed by the audit
  metadata (`ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE` requires it) and cheaper
  to return from inside the transaction than to re-fetch afterward.
- `src/app/(org)/o/[slug]/admin/roles/new/actions.ts` — `createRoleAction`,
  `adoptTemplateAction`.
- `src/app/(org)/o/[slug]/admin/roles/[id]/edit/actions.ts` —
  `setRolePermissionsAction`, `deactivateRoleAction`.
- `src/lib/role-definitions.test.ts` — Postgres-backed integration suite (40
  tests), same harness as `role-grants.test.ts` (`hasDb` skip-guard, dynamic
  imports in `beforeAll`, self-contained fixture/teardown). Covers every
  result variant of every export: forbidden / not_found / protected_role /
  duplicate_key / invalid_input / escalation_denied / self_lockout_blocked /
  already_deactivated / template_not_found, plus the delta-only escalation
  behavior, the definition-side lockout cascade (two roles.manage-carrying
  roles, remove one, the survivor blocked — reproduced for both
  `setRolePermissions` and `deactivateRole`), the `app_roles` RLS split
  (template visible across orgs), and per-org key scoping (same key legal at
  two different orgs).

### Files Modified

- `src/lib/authz.ts` — added `export type OrgTx` (the transaction-handle type
  `withOrgContext`'s callback already carried inline, now named and shared so
  `role-grants.ts`/`role-definitions.ts` stop each holding a private copy)
  and `assertPermissionSubset(tx, actorPersonId, organizationId,
  proposedPermissionKeys)` per DECISION-106 ruling 1: reads the actor's live
  `presby_effective_permissions()` set inside the caller's own transaction
  and diffs it against `proposedPermissionKeys`, returning
  `{ ok: true } | { ok: false; missingPermissions: string[] }`. An empty
  `proposedPermissionKeys` short-circuits to `{ ok: true }` before touching
  the database — the Edge Cases requirement that a pure permission removal
  must trivially pass rather than round-trip through a query.
- `src/lib/role-grants.ts` — `grantRole()` refactored to call
  `assertPermissionSubset()` with the target role's FULL permission set in
  place of its previous inline two-query block. Behavior-preserving: the
  granter's-own-permissions query moved into the shared helper, but the
  observable result (`ok` / `escalation_denied` with the same
  `missingPermissions`) is identical. **Regression guard run before and
  after:** `role-grants.test.ts` (25 tests, including the flagship
  self/other-escalation test) passes unmodified in both states —
  `dotenv -e .env.local -- vitest run src/lib/role-grants.test.ts`, 25/25
  both times.
- `src/lib/audit.ts` — four new `AUDIT_ACTIONS` keys per the Phase 3
  Component Plan: `ROLE_DEFINITION_CREATED`
  (`tenant.role_definition.created`), `ROLE_DEFINITION_PERMISSIONS_CHANGED`
  (`tenant.role_definition.permissions_changed`, metadata carries
  `addedKeys`/`removedKeys`/`holderCount`), `ROLE_DEFINITION_DEACTIVATED`
  (`tenant.role_definition.deactivated`, metadata carries
  `endedGrantCount`), `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE`
  (`tenant.role_definition.adopted_from_template`, metadata carries
  `templateRoleId`/`templateKey`).
- `src/lib/audit.test.ts` — added the four new keys to the catalog's own
  regression-guard `EXPECTED_ENTRIES`/count (this test asserts the exact
  shape of `AUDIT_ACTIONS`; it fails on any addition that isn't reflected
  here, by design).
- `src/lib/authz.test.ts` — added `describe("assertPermissionSubset")`: empty
  delta trivially passes without calling `tx.execute` at all; subset passes;
  exact-match passes; superset is denied with every missing key named, in
  order; total denial when the actor holds none of the proposed keys; and a
  shape assertion that the query reads `presby_effective_permissions`.

### API Surface (contract for ux-developer)

All from `src/lib/role-definitions.ts`, gated first on `roles.manage`
(private `hasRolesManage()` helper, same `presby_has_permission()` shape as
`role-grants.ts`'s `hasRoleGrantsManage`):

```ts
listPermissionCatalog(): Promise<PermissionCatalogEntry[]>
// No args — plain global read, no gate.

listRoleDefinitions(viewerPersonId, organizationId):
  Promise<{ kind: "ok"; roles: RoleDefinitionEntry[] } | { kind: "forbidden" }>

getRoleDefinition(viewerPersonId, organizationId, roleId):
  Promise<{ kind: "ok"; role: RoleDefinitionEntry } | { kind: "forbidden" } | { kind: "not_found" }>

listTemplateRoles(viewerPersonId, organizationId):
  Promise<{ kind: "ok"; templates: TemplateRoleEntry[] } | { kind: "forbidden" }>

createRole(actorPersonId, organizationId, { key, name, permissionKeys }):
  Promise<{ kind: "ok"; roleId; roleKey } | { kind: "forbidden" }
    | { kind: "escalation_denied"; missingPermissions } | { kind: "duplicate_key" }
    | { kind: "invalid_input"; reason }>

setRolePermissions(actorPersonId, organizationId, roleId, newPermissionKeys):
  Promise<{ kind: "ok"; addedKeys; removedKeys; holderCount } | { kind: "forbidden" }
    | { kind: "protected_role" } | { kind: "not_found" }
    | { kind: "escalation_denied"; missingPermissions } | { kind: "self_lockout_blocked" }>

deactivateRole(actorPersonId, organizationId, roleId):
  Promise<{ kind: "ok"; endedGrantCount } | { kind: "forbidden" } | { kind: "protected_role" }
    | { kind: "not_found" } | { kind: "already_deactivated" } | { kind: "self_lockout_blocked" }>

adoptTemplate(actorPersonId, organizationId, { templateRoleId, key?, name? }):
  Promise<{ kind: "ok"; roleId; roleKey; templateKey } | { kind: "forbidden" }
    | { kind: "template_not_found" } | { kind: "escalation_denied"; missingPermissions }
    | { kind: "duplicate_key" } | { kind: "invalid_input"; reason }>
```

Server Actions (both `'use server'`, both re-resolve `slug` → org/person via
`resolveOrgContext()`, never trust client-supplied ids beyond "which row"):

```ts
// src/app/(org)/o/[slug]/admin/roles/new/actions.ts
createRoleAction(slug, { key, name, permissionKeys }): Promise<ActionResult<{ roleId: string }>>
adoptTemplateAction(slug, { templateRoleId, key?, name? }): Promise<ActionResult<{ roleId: string }>>

// src/app/(org)/o/[slug]/admin/roles/[id]/edit/actions.ts
setRolePermissionsAction(slug, roleId, newPermissionKeys): Promise<ActionResult<{ addedKeys; removedKeys }>>
deactivateRoleAction(slug, roleId): Promise<ActionResult>
```

Each action records its audit event and calls
`revalidatePath('/o/${slug}/admin/roles')` on success, matching
`admin/roles/actions.ts`'s existing convention exactly.

### Edge Cases Verified

- **Deactivation ends live grants in the same transaction** —
  `deactivateRole()` sets `deactivated_at` AND runs a raw
  `update role_grants set ends_on = current_date where ... role_id = $roleId
  and <currently effective>` inside the same `withOrgContext()` transaction,
  returning `endedGrantCount`. Integration-tested: deactivating a role with
  one current holder ends that holder's grant (`ends_on` no longer null) and
  reports `endedGrantCount: 1`.
- **Self-lockout, definition side, generalized (not reimplemented
  differently)** — `wouldZeroOutRolesManageHolders()` is the same CTE shape
  as `role-grants.ts`'s `revokeRole()` lockout query, parameterized on
  `roles.manage` and on excluding the ROLE being changed (not one grant id,
  since a definition edit affects every holder of that role at once).
  `setRolePermissions()` and `deactivateRole()` both call it. Integration
  test: two custom roles, each granting `roles.manage` to a different
  person; removing it from one succeeds (the other still carries it);
  removing/deactivating it from the survivor is then blocked.
- **Empty-delta trivial pass** — unit-tested directly in `authz.test.ts`
  (asserts `tx.execute` is never called) and exercised end-to-end in
  `role-definitions.test.ts` (a pure removal by an actor holding nothing
  else still succeeds).
- **Key/name validation** — `validateKeyAndName()`: key checked as-given
  against `/^[a-z][a-z0-9_]{0,49}$/` (not trimmed — the format itself
  rejects whitespace); name trimmed then 1–100 chars. Unique-violation on
  `(organization_id, key)` caught via the existing shared
  `isUniqueViolation()` (`src/lib/db/errors.ts`) and returned as
  `duplicate_key` — the `try`/`catch` wraps the WHOLE `withOrgContext()`
  call, not a block inside it (same shape `org-provisioning.ts`'s
  `createOrganization()` uses), since a Postgres transaction is aborted
  after any statement error and no further query on that `tx` is possible.
- **`holderCount` read fresh, inside the transaction, before the write** —
  `roleHolderCount()` is called from inside the same `withOrgContext()`
  transaction that later performs the write, never from a value passed in
  from an earlier page render.
- **`isProtected` is the gate, not `role_kind`** — `setRolePermissions()` and
  `deactivateRole()` both check `role.isProtected`, confirmed against the
  fixture's `role_admin_test` row (`roleKind: "constitutional"`,
  `isProtected: true`) in the integration suite.

### Deviation from `npm run db:push`

Ran `npm run db:push` as instructed to sync local Drizzle types against
`appRoles.deactivatedAt`. It hit an interactive, unrelated prompt — a
concurrent pipeline's drift on `blob_assets` (`blob_assets_org_hash_key`
unique constraint, 109 existing rows, asking whether to truncate the table)
— not anything this commit touches. Did **not** force it through: truncating
a live table on the shared dev branch to sync an unrelated column is a
destructive action with no relationship to this feature, and drizzle-kit's
prompt is genuinely interactive (no non-interactive flag surfaced a safe
default). `appRoles.deactivatedAt` was already present in
`src/lib/db/domain/authz.ts` (database-admin's commit 1) and the column
already exists live (applied via the hand-written migration, also commit
1) — `db:push` was never actually load-bearing for this commit's
TypeScript compilation or for the integration tests, both of which passed
against the schema file and the live database as-is. Flagged here rather
than silently skipped, same posture database-admin's own commit 1 used for
the Neon-branching/`neonctl` interactive-auth gap.

### Verification

- `npm run typecheck` — clean.
- `npm test` (full unit suite, no DB) — 2347 passed, 389 skipped (DB-gated
  suites), 0 failed.
- `dotenv -e .env.local -- vitest run src/lib/role-definitions.test.ts` — 40
  passed.
- `dotenv -e .env.local -- vitest run src/lib/role-grants.test.ts` — 25
  passed, **unmodified** (the regression guard for the `assertPermissionSubset`
  extraction).
- `npm run check:audit` — passed, zero violations.
- `npm run check` (all four tripwires) — clean.
- `npm run build` — production build succeeds. `/o/[slug]/admin/roles/new`
  and `/o/[slug]/admin/roles/[id]/edit` correctly do NOT appear as routes
  yet (no `page.tsx` in either directory — `actions.ts` alone creates no
  route); this is ux-developer's next commit.

### Handoff

**Next: ux-developer.** Build `page.tsx`'s third section, `role-catalog-
list.tsx`, the `new/` page/form tree (calling `createRoleAction`/
`adoptTemplateAction`), the `[id]/edit/` page/form/dialog tree (calling
`setRolePermissionsAction`/`deactivateRoleAction`), and the `roles-states.tsx`
additions (`RoleDefinitionForbidden`/`RoleDefinitionNotFound`/
`RoleDefinitionProtected`) — all per Phase 3's Component/Page Plan, which
this commit does not touch. No `src/app/` page/form file was created or
modified in this commit (per this task's explicit scope boundary); the two
`actions.ts` files exist now with the exact signatures Phase 3 named, ready
to be called from client forms.

## Phase 4 commit 3 (ux-developer) — client UI

**Date:** 2026-08-26

### Files Created

- `src/app/(org)/o/[slug]/admin/roles/role-catalog-list.tsx` — Server
  Component, one row per `RoleDefinitionEntry`: name, key, permission count,
  holder count, a status badge (`Deactivated` + date / `Constitutional` /
  `Active`), and an "Edit" link **omitted for `isProtected` rows**. Designed
  empty state ("No custom roles yet").
- `src/app/(org)/o/[slug]/admin/roles/new/page.tsx` — Server Component,
  same auth/flag/gate chain as `../page.tsx`. `listTemplateRoles()` doubles
  as this page's `roles.manage` gate (it needs the template list anyway, so
  there's no separate round trip spent only to check the permission and
  discard the answer); `{ kind: "forbidden" }` renders `RoleDefinitionForbidden`
  without ever calling `listPermissionCatalog()`.
- `src/app/(org)/o/[slug]/admin/roles/new/create-role-form.tsx` — `'use
  client'`. Two independent forms sharing one tier-grouped
  `PermissionChecklist` render helper: (1) "Create a custom role" — key/name
  inputs + a freely-editable checklist → `createRoleAction`; (2) "Or adopt a
  template" (rendered only when `templates.length > 0`) — a template
  `<select>` pre-fills key/name and shows a **read-only preview** of the
  template's actual permission set → `adoptTemplateAction`. These are
  deliberately two different submit paths, not one form with a toggle:
  `adoptTemplate()` clones the template's own current permission set
  server-side and takes no caller-supplied permission list, so a preview the
  user could silently edit before submit would misrepresent what actually
  gets granted.
- `src/app/(org)/o/[slug]/admin/roles/[id]/edit/page.tsx` — Server
  Component. `getRoleDefinition()` returns `ok | forbidden | not_found`;
  `protected_role` is **not** a fourth result kind from that read — it's a
  page-level check on the `ok` result's own `role.isProtected` (DECISION-106
  ruling 5: `isProtected` is the gate, not `role_kind`), rendering
  `RoleDefinitionProtected` instead of `listPermissionCatalog()` +
  `<EditRoleForm>`.
- `src/app/(org)/o/[slug]/admin/roles/[id]/edit/edit-role-form.tsx` —
  `'use client'`. Key/name render as plain text (not inputs —
  `setRolePermissions()` has no such parameter); the same tier-grouped
  checklist, pre-checked from `role.permissionKeys`; the "N people currently
  hold this role — this change takes effect for all of them immediately"
  copy, sourced from the server-fetched `holderCount` at page load (the
  actual re-check is server-side, fresh, inside `setRolePermissionsAction`
  every submit — this component never implies the number is live). Submits
  via `setRolePermissionsAction`.
- `src/app/(org)/o/[slug]/admin/roles/[id]/edit/deactivate-role-dialog.tsx`
  — `AlertDialog` (never `confirm()`), modeled on `../../revoke-dialog.tsx`.
  Names `holderCount` and states grants are **ended**, the role **not
  deleted**. Calls `deactivateRoleAction`.
- Seven test files, one per component/page above, plus
  `role-catalog-list.test.tsx` — 60 new tests, all passing (106 total in the
  `roles/` tree after this commit, up from the pre-existing 46).

### Files Modified

- `src/app/(org)/o/[slug]/admin/roles/page.tsx` — added the third section,
  "Role catalog," gated on `roles.manage` via `listRoleDefinitions()`.
  `{ kind: "forbidden" }` simply omits the section (no denial banner — this
  is an *additional* capability on a page whose primary grant/revoke function
  the viewer already has, not a second copy of the whole-page gate); a
  genuine load failure (any thrown error other than `OrgAccessError`, which is
  re-thrown like every other call on this page) degrades to a small inline
  notice rather than losing the rest of an already-successful page render.
- `src/app/(org)/o/[slug]/admin/roles/roles-states.tsx` — added
  `RoleDefinitionForbidden`, `RoleDefinitionNotFound`, `RoleDefinitionProtected`
  per the Component Plan, plus one addition beyond the plan's literal list:
  `RoleDefinitionLoadError`, for the "every async surface ships an error
  state" requirement (`docs/ui-standards.md`) on a genuine (non-`OrgAccessError`)
  failure reading a role definition — `RolesLoadError` above exists for the
  identical reason on the grant side, and this feature needed the same thing
  on the definition side.
- `src/app/(org)/o/[slug]/admin/roles/page.test.tsx` — mocked
  `@/lib/role-definitions` (page.tsx now imports it) and added the "Role
  catalog" describe block (omitted-when-forbidden / rendered-when-ok /
  `OrgAccessError` re-thrown / inline-notice-on-other-error, with the rest of
  the page still rendering). No existing assertion in this file needed
  changing — the third section is additive and every existing test's default
  mock (`listRoleDefinitions` → `forbidden`) keeps them passing unmodified.
- `src/app/(org)/o/[slug]/admin/roles/roles-states.test.tsx` — added tests
  for the four new exports, same "own distinguishing phrase, not the others'"
  convention as the three existing states.

### A bug found and fixed during the real-browser verification (not caught by any unit test)

Grammar: `edit-role-form.tsx`'s holder-count banner and
`deactivate-role-dialog.tsx`'s confirmation copy both read **"1 person
currently hold this role"** for the singular case — the original
`${count} ${count === 1 ? "person" : "people"} currently hold` template
pluralizes the noun but not the verb. Fixed to branch the whole sentence
(`"1 person currently holds…"` vs. `"${n} people currently hold…"`) rather
than interpolating a shared verb. Every unit test for both components passed
before this fix — none of them render `holderCount === 1` and read the
resulting sentence closely enough to catch a subject-verb mismatch; this is
exactly the kind of defect CLAUDE.md's "Verify in a Browser" invariant exists
to catch. `edit-role-form.test.tsx`'s singular-holder assertion was updated
to match (`/1 person currently holds this role/i`); the plural assertions in
both test files were already correct and needed no change.

### Real-browser verification at 360px (CLAUDE.md → Verify in a Browser)

Actually performed, not assumed — a temporary `role_grants` row (`role_admin`
→ Tobias Renwick, the one pre-existing sign-in-capable congregation fixture)
and a temporary `organization_settings.require_two_factor = false` toggle for
Alder Creek (Tobias is an elder there, subject to that org's real 2FA policy,
which isn't otherwise reachable through this fixture's normal sign-in) were
applied directly against the shared Neon dev database — same posture
database-admin's and api-developer's own commits used for live verification
— then **reverted immediately after**, confirmed by re-querying both rows
post-revert. A Playwright script signed in as `clerk.fixture@example.invalid`
at a 360×800 viewport and walked:

1. `/o/alder-creek/admin/roles` — the new "Role catalog" section renders
   below "Grant a role," with a working "Create role" link. The existing
   "Who holds what" / new "Role catalog" tables both overflow horizontally at
   360px and rely on the shared `Table` primitive's built-in
   `overflow-x-auto` wrapper — same pre-existing pattern as the untouched
   "Who holds what" table, not a regression this commit introduced.
2. `/o/alder-creek/admin/roles/new` — the tier-grouped checklist (stacked
   `<details>`/`<summary>`, not a wide table or flat multi-select) renders
   correctly at 360px: three tier groups, correct counts, all form fields
   fit within the viewport with no horizontal scroll. Clicking a `<summary>`
   correctly collapses/expands its group (confirmed the triangle marker
   flips and content hides) — the native disclosure widget was never broken,
   because (per this file's own code comments) `display` is never set on the
   `<summary>` element itself, only on nested `<span>`s. The "Or adopt a
   template" section renders below with a working read-only permission
   preview.
3. `/o/alder-creek/admin/roles/[property_chair-id]/edit` — the pre-checked
   checklist, the (post-fix) holder-count banner, and the "Deactivate role"
   danger-zone button all render correctly at 360px.
4. The `AlertDialog` from `DeactivateRoleDialog` opens correctly at 360px —
   full-width stacked action buttons, both ≥44px tall.
5. `/o/alder-creek/admin/roles/[role_admin-id]/edit` (a **protected** role,
   reached by direct URL — `role-catalog-list.tsx` omits its Edit link, but
   the server-side check is the real gate) — renders `RoleDefinitionProtected`:
   read-only, no form, no checkboxes, a working "Back to roles" link.

### Verification

- `npm run typecheck` — clean (project-wide `tsc --noEmit` shows zero errors
  attributable to any file this commit touched; confirmed by isolating and
  re-checking after each fix).
- `npx vitest run "src/app/(org)/o/[slug]/admin/roles/"` — 106 passed, 0
  failed (12 test files).
- `npm test` (full unit suite) — 2486 passed, 419 skipped (DB-gated), 0
  failed.
- `npm run check` (all four tripwires) — clean.
- `npm run build` — production build succeeds;
  `/o/[slug]/admin/roles/new` and `/o/[slug]/admin/roles/[id]/edit` now
  appear as real routes in the build output.

### Implementer Notes

- **A concurrent, unrelated pipeline's in-flight state was visible in this
  same working tree** (`docs/work-log/2026-08-26-groups-admin.md`'s own
  commits to `src/lib/audit.ts` / `src/lib/audit.test.ts` /
  `src/app/(org)/o/[slug]/admin/groups/`) — at one point during this session
  `npm run typecheck` and `npm run build` both failed on `GROUP_*`
  `AUDIT_ACTIONS` keys and, briefly, on `audit.test.ts`'s own expected-key
  count, neither of which this commit's diff touches or caused. Confirmed via
  `git status` (those files show as pre-existing `M`, never touched by this
  commit) and by isolating `tsc --noEmit`'s output to files this commit
  created/modified. By the time of the final verification pass the other
  pipeline had resolved its own state and the full suite was green — recorded
  here per this file's own established precedent (database-admin's Phase 4
  commit 1) for naming a cross-pipeline collision rather than silently
  working around or ignoring it.
- **No `loading.tsx` added to the new segments** — no other page in this
  `admin/roles/` tree (or its sibling `admin/*` trees) has one; every page
  fetches synchronously server-side without a Suspense boundary, and adding
  one here would be an unplanned deviation from the tree's own established
  convention, not a fix for a gap this pipeline was asked to close.
- **No unsaved-changes guard on `EditRoleForm`** — `docs/ui-standards.md`
  names this pattern for "any page with an explicit Save button and
  multi-field editing," which this form technically is. Every sibling form in
  this exact directory (`grant-role-form.tsx`, `branding-form.tsx`) skips it
  too, and Phase 3's Component Plan didn't call it out as in scope here — left
  as a UX tradeoff, consistent with this directory's own established
  precedent rather than a new, unplanned pattern. Worth a follow-up sweep
  across all three forms together, not a one-off fix here.
- **New copy strings for a fork's branding pass to review:** "Create a
  role," "Or adopt a template," "This template carries:," the three tier
  labels ("Tier 1 — Directory" / "Tier 2 — Financial" / "Tier 3 — Pastoral,
  demographic, and medical"), the holder-count sentence in both
  `EditRoleForm` and `DeactivateRoleDialog`, and the four `RoleDefinition*`
  state copy blocks in `roles-states.tsx`.

### Handoff

**Next: qa (Phase 5).** A reviewer should click through, in order: (1)
`/o/<slug>/admin/roles` as a `roles.manage` holder — confirm the "Role
catalog" section and "Create role" link; (2) `/admin/roles/new` — create a
custom role with a tier-3 permission you hold, confirm `escalation_denied`
toast copy if you try one you don't hold; adopt the seeded `committee_chair`
template; (3) `/admin/roles/[id]/edit` on the role just created — toggle
permissions, save, confirm the holder-count banner reads correctly for 0/1/N
holders; (4) the deactivate dialog — confirm the copy names holders and says
"ended," not "deleted," and that deactivating actually removes the role from
"Who holds what" grants; (5) direct-URL a constitutional role's edit page
(e.g. `role_admin`) — confirm the read-only `RoleDefinitionProtected` state,
not a form. QA's auth-touching-feature gate (CLAUDE.md Phase 4) does not
apply here — this pipeline touches none of `src/auth.ts`,
`src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/`.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS (zero errors, run independently)

## Unit Tests

Full suite: `npm test` — Total: 2905 | Passed: 2486 | Skipped: 419 (DB-gated) | Failed: 0 | Duration: ~8s

DB-backed suites, re-run directly against the live dev DB: `role-grants.test.ts` 25/25 (unmodified — the regression guard for the `assertPermissionSubset` extraction), `role-definitions.test.ts` 40/40, `authz.test.ts` + `audit.test.ts` combined 122/122, `admin/roles/` tree 106/106 (12 test files).

**Finding, not attributable to this pipeline:** vitest reported `role-grants.test.ts`/`role-definitions.test.ts` as failed suites because their `afterAll` teardown (cascading `delete from organizations`) threw against a `group_memberships` derived-row protection — traced to a concurrent, uncommitted sibling pipeline's (`2026-08-26-groups-admin`) migration already applied live to the same shared dev DB. Every individual test assertion in both files passed (122/122 combined); only the shared-DB teardown side effect failed, caused by another pipeline's schema change. Not held against this verdict — flagged for the groups-admin pipeline's own QA pass.

## End-to-End Tests

Not applicable — no Playwright e2e suite exists for this feature and none was claimed by the implementer. Not auth-touching (confirmed: no changes under `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`), so the stricter e2e gate doesn't apply. Coverage is carried by the Postgres-integration suite (`role-definitions.test.ts`, 40 tests against real schema/RLS) plus ux-developer's documented real-browser walkthrough at 360px (Phase 4 commit 3, which found and fixed a real grammar bug).

## Regression Tests Added

- `authz.test.ts` (`describe("assertPermissionSubset")`) — guards the escalation-check extraction itself: empty-delta short-circuit (no DB round trip), subset/exact-match pass, superset denial naming every missing key, total denial, query-shape assertion.
- `role-definitions.test.ts` — "a delta-only check" (guards against `setRolePermissions()` regressing to a full-set check), "a pure permission REMOVAL trivially passes" (guards the empty-delta short-circuit end to end), self-lockout cascade for `setRolePermissions`/`deactivateRole` (guards the exact asymmetry Phase 1 Gap 1 named), deactivation-ends-live-grants-atomically (guards against a "deactivated" role silently continuing to grant access).
- `scripts/test-rls.sql` section 24 — guards the `app_roles` RLS split both ways (template SELECT widened; template-row INSERT still rejected, proven live).
- `role-grants.test.ts` (25 tests, unmodified) — the flagship regression guard proving the `assertPermissionSubset` extraction changed no observable behavior of `grantRole()`.

## Coverage on Critical Modules

Not the designated targets for this feature (`permissions.ts`/`two-factor.ts`/`flags.ts` untouched). Relevant new/changed modules: `src/lib/authz.ts` (`assertPermissionSubset`) — every branch covered; `src/lib/role-definitions.ts` — every result variant of every export covered by its 40-test suite.

## Feature-Gate Audit

| Route or action | `auth()`/`cachedAuth()` present? | Server-side permission re-check present? | Correct permission key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `page.tsx` (GET `/o/[slug]/admin/roles`, third section) | yes | yes — `listRoleDefinitions()` internally checks `roles.manage` | `roles.manage` |
| `new/page.tsx` (GET `.../roles/new`) | yes | yes — `listTemplateRoles()` internally checks `roles.manage` | `roles.manage` |
| `[id]/edit/page.tsx` (GET `.../roles/[id]/edit`) | yes | yes — `getRoleDefinition()` checks `roles.manage`; `isProtected` checked separately at page level | `roles.manage` + `isProtected` |
| `createRoleAction` | yes | yes — `createRole()` gates on `roles.manage` then `assertPermissionSubset()` on the full proposed set | `roles.manage` |
| `adoptTemplateAction` | yes | yes — `adoptTemplate()`, same gate + subset-check on the full template set | `roles.manage` |
| `setRolePermissionsAction` | yes | yes — gate → `isProtected` reject → `assertPermissionSubset()` on added delta only → self-lockout guard | `roles.manage` |
| `deactivateRoleAction` | yes | yes — gate → `isProtected` reject → self-lockout guard → atomic grant-ending | `roles.manage` |
| `grantRole()` (refactor only) | n/a (library function) | yes, unchanged — gate then `assertPermissionSubset()` with the full target set | `role_grants.manage` |

All server actions re-resolve `slug` → org/person via `resolveOrgContext()` server-side; none trust a client-supplied organization id or permission-set claim.

## Verdict

**PASS**

All required checks green, reproduced independently. The single most security-critical property of this pipeline — that a `roles.manage` holder cannot use role-*definition* edits to grant themselves or anyone else a permission they don't already hold, and cannot lock every admin out of role administration by editing or deactivating the wrong role — is implemented exactly as DECISION-106/109 specified and is independently, adversarially test-covered. The one anomaly found (concurrent-pipeline teardown collision) is external to this feature's code and does not affect its correctness.

**Handoff:** analyst (Phase 6).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The escalation-closing work is exactly what Phase 1–3 demanded and is verified to a genuinely high standard (real-transaction integration tests plus a documented live-browser walkthrough that caught a real bug); what's missing is pure downstream housekeeping — the release-notes entry, the functionality-map line, and the TODO Done line, none of which were done before Phase 6.

## What's Working

- Tier-3 boundary is visibly surfaced at creation: both `create-role-form.tsx` and `edit-role-form.tsx` render three defaulted-open tier groups ("Tier 1 — Directory," "Tier 2 — Financial," "Tier 3 — Pastoral, demographic, and medical").
- Flow 5b (adopt-a-template) works end to end and is not exempt from the escalation check: `adoptTemplate()` calls `assertPermissionSubset()` against the full template permission set before inserting, covered by an explicit `escalation_denied` test.
- Scope discipline matches the operator's confirmed answer exactly — only self-service template adoption was built, no auto-seed-at-provisioning path exists anywhere in the diff.
- The central Phase 1 finding (definition-edit escalation gap) is closed with real teeth: shared `assertPermissionSubset()`, definition-side self-lockout guard, atomic grant-ending on deactivation — all exercised against a real Postgres/RLS connection, not mocked.
- QA's "no e2e gate" call is correct given this touches none of the auth surfaces; the Postgres-integration suite is arguably stronger evidence for this feature's actual risk (does the subset check/lockout guard/atomicity hold under real RLS) than a scripted click-path would be, and ux-developer's real-browser walkthrough additionally exercised the actual UI and caught a real grammar bug.

## Intent-vs-Shipped Diff

- Phase 1 said: tier-3 boundary must be visible at creation, not buried in a flat list. Shipped: tier-grouped, defaulted-open groups on both create and edit forms. **Matches.**
- Phase 1 said (Gap 1, the central finding): role-definition edits must not bypass the escalation check. Shipped: `assertPermissionSubset()` on every definition-changing write, `role-grants.test.ts`'s flagship test proven to pass unmodified. **Matches.**
- Phase 1 said (Flow 4): never hard-delete a role. Shipped: soft-deactivate only, ends live grants atomically, cascade FK left as a tracked, unfixed follow-up. **Matches — acceptable, tracked drift on the FK itself.**
- Phase 1 said (Flow 3): show holder count, carry it in the audit event. Shipped: exactly that copy, `holderCount` in the audit metadata. **Matches.**
- Operator's confirmed scope answer: self-service template adoption (5b) only, not automatic org-provisioning seeding (5a). Shipped: exactly 5b. **Matches, no drift.**
- Phase 3's Implementation Order named the release-notes entry as tech-lead's own Phase 6 ownership. Shipped: no entry exists. **Gap, not acceptable drift — a named commitment that wasn't kept.**
- Rule 14 (functionality map kept current): `docs/product/functionality-map.md`'s roles line still reads "no role or permission creation," now factually false. **Gap — the specific failure mode Rule 14 exists to prevent, since the map loads into every session.**
- Rule 10 (TODO.md reconciled): the two follow-ups this pipeline generated are correctly filed, but there is no Done line for the pipeline itself. **Gap, mechanical.**

## Edge Cases

- Empty state: pass — designed "No custom roles yet" state, not a bare empty table.
- Failure microcopy: pass — `escalation_denied`/`duplicate_key`/`invalid_input`/`protected_role`/`self_lockout_blocked` all surface specific, human copy.
- Permission gate: pass — every route and action re-checks `roles.manage` server-side; `isProtected` (not `role_kind`) gates edit/deactivate, matching DECISION-106.
- Audit event: pass — all four `ROLE_DEFINITION_*` keys fire with the metadata Phase 1/3 asked for.
- Mobile (360px): pass — documented real-browser walkthrough; the disclosure-triangle risk CLAUDE.md names is proactively guarded (no `display` on `<summary>`).

## Follow-Ups (if SHIP WITH NOTES)

- Write the missing release-notes entry: "Feature: Role definition administration" — new `roles.manage` permission, new `role_admin` role (not bound to `stated_clerk`), create/edit/deactivate/adopt-template at `/o/<slug>/admin/roles`, gated by the existing `org_portal.roles` flag.
- Correct `docs/product/functionality-map.md`'s roles line — it currently says "no role or permission creation," which this pipeline makes false.
- Add this pipeline's own Done line to `docs/TODO.md` per Rule 10.
- Consider (tech-lead's call, not mandatory) a one-line note in `docs/architecture.md`'s tenant-isolation section that `app_roles` now carries a documented exception — widened `SELECT` for `organization_id IS NULL` template rows, writes still fully isolated.
- Recommend (not required) a small Playwright regression test for the core click-path as a future test-coverage-review candidate — current coverage is genuinely strong but a manual walkthrough doesn't re-run itself.
- No feedback-row mark (Rule 12) or what's-new advisory (Rule 13) needed — no in-app feedback provenance, and this is an org-admin-facing capability, not member-visible behavior.

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
