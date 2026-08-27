import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { getPlatformDb, type db } from "@/lib/db";
import { groupMemberships, groups, groupTypes } from "@/lib/db/domain/groups";
import { memberships, people } from "@/lib/db/domain/people";

/**
 * Groups administration — docs/work-log/2026-08-26-groups-admin.md, Phase 3
 * design, Phase 4 commit 2 (full-stack-developer). Create/edit a `managed`
 * group (committee / small_group / choir / team) and add/end its members.
 *
 * SAME SHAPE AS `src/lib/officers.ts` (Phase 2's own instruction): one
 * `withOrgContext()` transaction per exported function, the `groups.manage`
 * gate checked FIRST inside every one of them via the private
 * `hasGroupsManage` helper, typed `GroupsResult` variants instead of thrown
 * exceptions for every expected/denied outcome.
 *
 * THIS MODULE NEVER TOUCHES A DERIVED GROUP. "The Court Is Not a Group"
 * (CLAUDE.md) — Session, Board of Deacons, and Active Membership are
 * populated only by the `officer_terms`/`memberships` triggers
 * (`drizzle/0009_presby_rls.sql`, `drizzle/0017`). Every read here filters to
 * `membership_source = 'managed'` at the query layer — not just at the UI
 * layer — and every write re-loads its target scoped the same way before
 * mutating it, closing Flow 2/4's guard in application code as the first of
 * two enforcement layers. The second layer is the database: `drizzle/
 * 0033_presby_groups_administration.sql`'s `groups_reject_derived_edit`
 * trigger and the widened `presby_reject_derived_group_write()` DELETE
 * branch. Neither layer is a substitute for the other (DECISION-110 ruling
 * 3) — this module's own checks are defense in depth, not the only gate.
 *
 * `groups.group_type_id` ALWAYS RESOLVES TO THE PLATFORM-WIDE TEMPLATE ROW
 * (DECISION-110 ruling 1) — no per-org custom group types. `createGroup`
 * validates the chosen `groupTypeId` is a platform-template row
 * (`organization_id is null`) whose `key` is in `MANAGEABLE_GROUP_TYPE_KEYS`
 * — never trusting the client `<select>`'s own filtering alone (Phase 3's
 * Edge Cases & Risks, named load-bearing).
 *
 * OVERLAP CHECK IS APP-LEVEL, NOT A GIST EXCLUSION (DECISION-110 ruling 4) —
 * `addGroupMember` checks for an existing OPEN (`ends_on is null`) row for
 * the same `(organizationId, groupId, personId)` before inserting, returning
 * `{ kind: "overlap" }` naming both the person and the group. Intentionally
 * narrow: it does not detect two historical, date-overlapping stints entered
 * out of order — accepted scope, a committee roster carries none of officer
 * terms' quorum/minute-validity stakes.
 *
 * NO DELETE, EVER, FOR MEMBERSHIP ENDS (DECISION-110 ruling 5, matching
 * `officers.ts`'s own no-delete discipline) — `endGroupMembership` only ever
 * sets `ends_on` on the existing row. No group deletion/archival exists in
 * v1 either; there is deliberately no `deleteGroup`/`archiveGroup` export.
 *
 * READING `group_types` PLATFORM-TEMPLATE ROWS REQUIRES `getPlatformDb()`, A
 * GAP PHASE 3'S DESIGN DID NOT NAME AND THIS COMMIT DISCOVERED BY RUNNING THE
 * INTEGRATION SUITE AGAINST A REAL DATABASE, NOT BY READING THE SQL. `group_
 * types`' `tenant_isolation` RLS policy (`drizzle/0009_presby_rls.sql`) is
 * the standard `organization_id = presby_current_org()` predicate with no
 * NULL-organization_id exception — under `presby_app` (the connection
 * `withOrgContext()`/`tx` uses), a platform-template row
 * (`organization_id IS NULL`) is INVISIBLE, full stop: `NULL = <anything>`
 * evaluates to NULL, never true, regardless of which org's context is set.
 * `scripts/seed.ts`'s own `seedGroupTypes()` header names this exact
 * property to explain why it seeds through `platformDb`, and
 * `src/lib/org-provisioning.ts`'s `createOrganization()` already reads these
 * same rows through `getPlatformDb()` for the identical reason — this
 * module's two group-type reads (`getGroupFormOptions`, `createGroup`'s own
 * re-validation) follow that exact, already-sanctioned precedent, never the
 * `tx` this function otherwise uses for every tenant-scoped read/write.
 * Confirmed safe: both queries hard-filter to `organization_id is null` in
 * the query itself, so no tenant-scoped row can ever be returned by a
 * platform-bypassing connection here — the same shape `presby_has_permission`
 * (a `SECURITY DEFINER` function, a different mechanism for the same
 * "correctly needs to see past RLS" problem) exists to solve.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS_MANAGE = "groups.manage";

export const MANAGEABLE_GROUP_TYPE_KEYS = [
  "committee",
  "small_group",
  "choir",
  "team",
] as const;
export type ManageableGroupTypeKey = (typeof MANAGEABLE_GROUP_TYPE_KEYS)[number];

export const GROUP_ROLES = ["chair", "leader", "member"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

function isGroupRole(value: string): value is GroupRole {
  return (GROUP_ROLES as readonly string[]).includes(value);
}

/**
 * The single-permission gate every exported function in this module checks
 * FIRST — not exported, same discipline `hasOfficersManage` documents.
 */
async function hasGroupsManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${GROUPS_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// Shared result / entry types
// ---------------------------------------------------------------------------

export interface GroupListEntry {
  groupId: string;
  name: string;
  groupTypeName: string;
  memberCount: number;
}

export interface GroupRosterEntry {
  groupMembershipId: string;
  personId: string;
  displayName: string;
  groupRole: GroupRole;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  /** 'YYYY-MM-DD', or null (current). */
  endsOn: string | null;
}

export interface GroupDetail {
  groupId: string;
  name: string;
  description: string | null;
  meetsWhen: string | null;
  groupTypeName: string;
  roster: GroupRosterEntry[];
}

export interface GroupFormOptions {
  groupTypes: Array<{ id: string; key: ManageableGroupTypeKey; name: string }>;
  people: Array<{ personId: string; displayName: string }>;
}

export type GroupsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string }
  | { kind: "overlap"; personName: string; groupName: string };

function displayName(row: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return `${row.preferredName ?? row.firstName} ${row.lastName}`;
}

// ---------------------------------------------------------------------------
// listGroups
// ---------------------------------------------------------------------------

interface GroupListRow {
  group_id: string;
  name: string;
  group_type_id: string;
  member_count: string;
}

/**
 * Every `membership_source = 'managed'` group at this org, with a CURRENT
 * (`ends_on is null`) member count. Derived groups (Session, Board of
 * Deacons, Active Membership) are NEVER returned by this module at all —
 * they already have a dedicated read surface (`admin/officers`'s roster) —
 * excluded here at the query layer, the first of the two enforcement layers
 * protecting Flow 2/4's guard.
 *
 * DOES NOT JOIN `group_types` UNDER `tx` — every group's `group_type_id`
 * resolves to a platform-template row (`organization_id is null`,
 * DECISION-110 ruling 1), and `group_types`' RLS policy is the standard
 * `organization_id = presby_current_org()` predicate with no NULL exception
 * (this file's header). An `inner join` to `group_types` under `tx` would
 * silently drop every one of these rows from the result — caught by running
 * this module's own integration suite against a real database, not by
 * reading the SQL. Names are resolved with a SEPARATE `getPlatformDb()`
 * lookup instead, keyed on the (small, bounded) set of distinct
 * `group_type_id`s this org's groups actually use.
 */
export async function listGroups(
  viewerPersonId: string,
  organizationId: string,
): Promise<GroupsResult<GroupListEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasGroupsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select g.id as group_id,
             g.name as name,
             g.group_type_id as group_type_id,
             count(gm.id) filter (where gm.ends_on is null) as member_count
        from groups g
        left join group_memberships gm
          on gm.group_id = g.id and gm.organization_id = g.organization_id
       where g.organization_id = ${organizationId}
         and g.membership_source = 'managed'
       group by g.id, g.name, g.group_type_id
       order by g.name
    `);

    const rows = (result as unknown as { rows?: GroupListRow[] }).rows ?? [];
    const groupTypeNames = await groupTypeNamesByIds(
      rows.map((row) => row.group_type_id),
    );

    const data: GroupListEntry[] = rows.map((row) => ({
      groupId: row.group_id,
      name: row.name,
      groupTypeName: groupTypeNames.get(row.group_type_id) ?? "Group",
      memberCount: Number(row.member_count),
    }));

    return { kind: "ok", data };
  });
}

/**
 * Batched `getPlatformDb()` lookup backing `listGroups`/`getGroup`'s
 * group-type display name — see `listGroups`'s own header for why this
 * cannot be a plain join under `tx`.
 */
async function groupTypeNamesByIds(
  ids: string[],
): Promise<Map<string, string>> {
  const distinctIds = Array.from(new Set(ids));
  if (distinctIds.length === 0) {
    return new Map();
  }
  const rows = await getPlatformDb()
    .select({ id: groupTypes.id, name: groupTypes.name })
    .from(groupTypes)
    .where(inArray(groupTypes.id, distinctIds));
  return new Map(rows.map((row) => [row.id, row.name]));
}

// ---------------------------------------------------------------------------
// getGroup
// ---------------------------------------------------------------------------

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  meets_when: string | null;
  group_type_id: string;
}

interface RosterRow {
  group_membership_id: string;
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  group_role: string;
  starts_on: string;
  ends_on: string | null;
}

/**
 * One managed group's own fields plus its current + ended roster. Query is
 * scoped `and(eq(groups.id, groupId), eq(groups.organizationId,
 * organizationId), eq(groups.membershipSource, "managed"))` — a derived
 * group's id (typed directly into the URL) resolves `invalid_target`, same
 * as a nonexistent one. This is the application-layer half of Flow 2's
 * guard (`[groupId]/edit/page.tsx` relies on this same function to 404/
 * redirect a derived group's id, not on a client-side "no edit button"
 * omission) — the migration's `groups` UPDATE trigger is the database-layer
 * half.
 */
export async function getGroup(
  viewerPersonId: string,
  organizationId: string,
  groupId: string,
): Promise<GroupsResult<GroupDetail>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasGroupsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const groupResult = await tx.execute(sql`
      select g.id, g.name, g.description, g.meets_when, g.group_type_id
        from groups g
       where g.id = ${groupId}
         and g.organization_id = ${organizationId}
         and g.membership_source = 'managed'
       limit 1
    `);
    const groupRow = (
      groupResult as unknown as { rows?: GroupRow[] }
    ).rows?.[0];
    if (!groupRow) {
      return { kind: "invalid_target" };
    }

    const groupTypeNames = await groupTypeNamesByIds([groupRow.group_type_id]);

    const rosterResult = await tx.execute(sql`
      select gm.id as group_membership_id,
             gm.person_id,
             p.first_name,
             p.last_name,
             p.preferred_name,
             gm.group_role,
             gm.starts_on::text as starts_on,
             gm.ends_on::text as ends_on
        from group_memberships gm
        join people p on p.id = gm.person_id
       where gm.group_id = ${groupId}
         and gm.organization_id = ${organizationId}
       order by (gm.ends_on is null) desc, gm.starts_on desc
    `);
    const rosterRows =
      (rosterResult as unknown as { rows?: RosterRow[] }).rows ?? [];

    return {
      kind: "ok",
      data: {
        groupId: groupRow.id,
        name: groupRow.name,
        description: groupRow.description,
        meetsWhen: groupRow.meets_when,
        groupTypeName: groupTypeNames.get(groupRow.group_type_id) ?? "Group",
        roster: rosterRows.map((row) => ({
          groupMembershipId: row.group_membership_id,
          personId: row.person_id,
          displayName: displayName({
            firstName: row.first_name,
            lastName: row.last_name,
            preferredName: row.preferred_name,
          }),
          groupRole: row.group_role as GroupRole,
          startsOn: row.starts_on,
          endsOn: row.ends_on,
        })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// getGroupFormOptions
// ---------------------------------------------------------------------------

/**
 * The new/edit-group and add-member forms' own data.
 *
 * `groupTypes` IS THE SERVER-SIDE FILTER, NOT JUST THE CLIENT `<select>`'s
 * OWN RENDERING (Phase 3's Edge Cases & Risks, named load-bearing) — restricted
 * to platform-template rows (`organization_id is null`) whose `key` is in
 * `MANAGEABLE_GROUP_TYPE_KEYS`; `court`/`roster` never appear here regardless
 * of what a hand-crafted request sends. `createGroup` independently
 * re-validates the chosen id server-side too — never trust this list alone.
 * Read through `getPlatformDb()`, not `tx` — see this file's header for why.
 *
 * `people` is the identical F21 current-membership shape
 * `getOfficerFormOptions` uses — never a bare `select * from people`.
 */
export async function getGroupFormOptions(
  viewerPersonId: string,
  organizationId: string,
): Promise<GroupsResult<GroupFormOptions>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasGroupsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const groupTypeRows = await getPlatformDb()
      .select({ id: groupTypes.id, key: groupTypes.key, name: groupTypes.name })
      .from(groupTypes)
      .where(
        and(
          isNull(groupTypes.organizationId),
          inArray(groupTypes.key, MANAGEABLE_GROUP_TYPE_KEYS),
        ),
      )
      .orderBy(groupTypes.name);

    const peopleRows = await tx
      .select({
        personId: memberships.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          isNull(memberships.endedOn),
        ),
      )
      .orderBy(people.lastName, people.firstName);

    return {
      kind: "ok",
      data: {
        groupTypes: groupTypeRows.map((row) => ({
          id: row.id,
          key: row.key as ManageableGroupTypeKey,
          name: row.name,
        })),
        people: peopleRows.map((row) => ({
          personId: row.personId,
          displayName: displayName(row),
        })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------

export interface CreateGroupInput {
  groupTypeId: string;
  name: string;
  description?: string;
  meetsWhen?: string;
}

/**
 * Creates a new `managed` group. Validates `groupTypeId` resolves to a
 * platform-template row whose `key` is in the manageable subset — the
 * SECOND of the two independent layers named in Phase 3's Edge Cases & Risks
 * (the first is `getGroupFormOptions`'s own query filter) — `invalid_input`
 * naming the rule, never a raw constraint error.
 */
export async function createGroup(
  viewerPersonId: string,
  organizationId: string,
  input: CreateGroupInput,
): Promise<GroupsResult<{ groupId: string }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasGroupsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const name = input.name.trim();
    if (name.length === 0) {
      return { kind: "invalid_input", message: "Name is required." };
    }
    if (name.length > 200) {
      return {
        kind: "invalid_input",
        message: "Name must be 200 characters or fewer.",
      };
    }

    // Read through getPlatformDb(), not tx — see this file's header for why
    // `tx` (presby_app, RLS-enforced) can never see a platform-template row.
    const [groupType] = await getPlatformDb()
      .select({ id: groupTypes.id, key: groupTypes.key })
      .from(groupTypes)
      .where(
        and(
          eq(groupTypes.id, input.groupTypeId),
          isNull(groupTypes.organizationId),
        ),
      )
      .limit(1);
    if (
      !groupType ||
      !(MANAGEABLE_GROUP_TYPE_KEYS as readonly string[]).includes(
        groupType.key,
      )
    ) {
      return {
        kind: "invalid_input",
        message:
          "Choose a valid group type — committee, small group, choir, or team.",
      };
    }

    const [inserted] = await tx
      .insert(groups)
      .values({
        organizationId,
        groupTypeId: groupType.id,
        name,
        description: input.description?.trim() || null,
        meetsWhen: input.meetsWhen?.trim() || null,
        membershipSource: "managed",
        derivedFrom: null,
        isProtected: false,
      })
      .returning({ id: groups.id });

    return { kind: "ok", data: { groupId: inserted!.id } };
  });
}

// ---------------------------------------------------------------------------
// updateGroup
// ---------------------------------------------------------------------------

export interface UpdateGroupInput {
  groupId: string;
  name: string;
  description?: string;
  meetsWhen?: string;
}

/**
 * Edits an existing `managed` group's name/description/meeting schedule.
 * Re-loads the group scoped to `membership_source = 'managed'`
 * (`invalid_target` otherwise, closing the exact gap Flow 2 names) BEFORE
 * updating — the migration's `groups_reject_derived_edit` trigger is the
 * backstop if this check is ever bypassed, not a substitute for it.
 */
export async function updateGroup(
  viewerPersonId: string,
  organizationId: string,
  input: UpdateGroupInput,
): Promise<GroupsResult<{ groupId: string }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasGroupsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [existing] = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.id, input.groupId),
          eq(groups.organizationId, organizationId),
          eq(groups.membershipSource, "managed"),
        ),
      )
      .limit(1);
    if (!existing) {
      return { kind: "invalid_target" };
    }

    const name = input.name.trim();
    if (name.length === 0) {
      return { kind: "invalid_input", message: "Name is required." };
    }
    if (name.length > 200) {
      return {
        kind: "invalid_input",
        message: "Name must be 200 characters or fewer.",
      };
    }

    await tx
      .update(groups)
      .set({
        name,
        description: input.description?.trim() || null,
        meetsWhen: input.meetsWhen?.trim() || null,
      })
      .where(eq(groups.id, input.groupId));

    return { kind: "ok", data: { groupId: input.groupId } };
  });
}

// ---------------------------------------------------------------------------
// addGroupMember
// ---------------------------------------------------------------------------

export interface AddGroupMemberInput {
  groupId: string;
  personId: string;
  groupRole: GroupRole;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
}

/**
 * Adds a person to a managed group's roster.
 *
 * ORDER OF OPERATIONS, mirroring `startOfficerTerm`'s documented order:
 *   1. `groups.manage` gate.
 *   2. `startsOn`/`groupRole` shape validation — thrown, a genuine call-shape
 *      defect (the UI `<select>` only ever offers `GROUP_ROLES`' three
 *      values), not a user-facing denial.
 *   3. The group must resolve `membership_source = 'managed'` —
 *      `invalid_target` otherwise (closes Flow 4's guard for the add side
 *      too: a derived group's id can never receive a new member here).
 *   4. `personId` must be a CURRENT membership at this org (F21 shape) —
 *      `invalid_target`.
 *   5. App-level overlap check (DECISION-110 ruling 4, no GIST exclusion):
 *      an existing OPEN (`ends_on is null`) row for this exact
 *      `(organizationId, groupId, personId)` — `{ kind: "overlap" }` naming
 *      both the person and the group, checked BEFORE any insert.
 *   6. Insert with `source: "managed"`.
 */
export async function addGroupMember(
  viewerPersonId: string,
  organizationId: string,
  input: AddGroupMemberInput,
): Promise<GroupsResult<{ groupMembershipId: string }>> {
  if (!DATE_RE.test(input.startsOn)) {
    throw new Error(
      `addGroupMember: startsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.startsOn)}`,
    );
  }
  if (!isGroupRole(input.groupRole)) {
    throw new Error(
      `addGroupMember: unrecognized groupRole ${JSON.stringify(input.groupRole)}`,
    );
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasGroupsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [group] = await tx
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(
        and(
          eq(groups.id, input.groupId),
          eq(groups.organizationId, organizationId),
          eq(groups.membershipSource, "managed"),
        ),
      )
      .limit(1);
    if (!group) {
      return { kind: "invalid_target" };
    }

    const [membership] = await tx
      .select({
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(
        and(
          eq(memberships.personId, input.personId),
          eq(memberships.organizationId, organizationId),
          isNull(memberships.endedOn),
        ),
      )
      .limit(1);
    if (!membership) {
      return { kind: "invalid_target" };
    }
    const personName = displayName(membership);

    const [existingOpen] = await tx
      .select({ id: groupMemberships.id })
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.organizationId, organizationId),
          eq(groupMemberships.groupId, input.groupId),
          eq(groupMemberships.personId, input.personId),
          isNull(groupMemberships.endsOn),
        ),
      )
      .limit(1);
    if (existingOpen) {
      return { kind: "overlap", personName, groupName: group.name };
    }

    const [inserted] = await tx
      .insert(groupMemberships)
      .values({
        organizationId,
        groupId: input.groupId,
        personId: input.personId,
        groupRole: input.groupRole,
        source: "managed",
        startsOn: input.startsOn,
      })
      .returning({ id: groupMemberships.id });

    return { kind: "ok", data: { groupMembershipId: inserted!.id } };
  });
}

// ---------------------------------------------------------------------------
// endGroupMembership
// ---------------------------------------------------------------------------

export interface EndGroupMembershipInput {
  groupMembershipId: string;
  /** 'YYYY-MM-DD'. */
  endsOn: string;
}

/**
 * Ends `input.groupMembershipId` (`ends_on` on the EXISTING row) — NEVER a
 * delete, same discipline `officers.ts`'s `endOfficerTerm` documents.
 *
 * Loads the row scoped to this org AND `source = 'managed'` —
 * `invalid_target` if missing OR derived. This is the application-layer half
 * of Flow 4's guard: a derived `group_memberships` row (Session/Diaconate)
 * can never be ended through this function, even if its id is reached
 * directly. The migration's widened DELETE-branch trigger is the
 * database-layer half, though this function never issues a DELETE at all.
 */
export async function endGroupMembership(
  viewerPersonId: string,
  organizationId: string,
  input: EndGroupMembershipInput,
): Promise<GroupsResult<{ groupMembershipId: string }>> {
  if (!DATE_RE.test(input.endsOn)) {
    throw new Error(
      `endGroupMembership: endsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.endsOn)}`,
    );
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasGroupsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({ id: groupMemberships.id, startsOn: groupMemberships.startsOn })
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.id, input.groupMembershipId),
          eq(groupMemberships.organizationId, organizationId),
          eq(groupMemberships.source, "managed"),
        ),
      )
      .limit(1);
    if (!row) {
      return { kind: "invalid_target" };
    }

    if (input.endsOn < row.startsOn) {
      return {
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      };
    }

    await tx
      .update(groupMemberships)
      .set({ endsOn: input.endsOn })
      .where(eq(groupMemberships.id, input.groupMembershipId));

    return { kind: "ok", data: { groupMembershipId: input.groupMembershipId } };
  });
}
