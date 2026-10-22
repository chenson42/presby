import type { DesignationSlot, HolderRow } from "./designation-holder-types";

/**
 * Pure assembly of the `HolderRow[]` the two designation sections list, from
 * the rows the owner-only SQL functions return (drizzle/0060). Split from
 * `designation-holders.ts` (server-only, holds the owner connection) so every
 * rule below is unit-tested without a database. No imports but the pure types:
 * it can never reach a connection, and it can never carry an email (the input
 * rows have no contact column, and a group's members are never name-resolved,
 * DECISION-195).
 *
 * The holder list is the single source (F169): `holderPeopleCount` and every
 * `leavesNoHolders` come from the SAME rows, so "N people hold this" and "N
 * rows to act on" cannot drift.
 */

/** One row of `presby_{founding_administrator|giving_manage}_holder_grants(org)`. */
export interface HolderGrantRow {
  grant_id: string;
  role_id: string;
  role_key: string;
  role_name: string;
  arm: "person" | "group";
  subject_person_id: string | null;
  group_id: string | null;
  group_name: string | null;
  group_membership_source: string | null;
  holder_person_id: string;
  grant_starts_on: string;
  grant_reason: string | null;
}

/** One row of `presby_founding_administrator_companion_grants(org, person)`, with its person. */
export interface CompanionGrantRow {
  person_id: string;
  grant_id: string;
  role_id: string;
  role_key: string;
  role_name: string;
  grant_starts_on: string;
}

export interface RolePermissionRow {
  role_id: string;
  key: string;
  description: string;
}

export const DESIGNATION_REASON: Record<DesignationSlot, string> = {
  founding_administrator: "founding administrator designation",
  treasurer: "treasurer designation",
};

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function buildHolderRows(input: {
  slot: DesignationSlot;
  grants: HolderGrantRow[];
  companions: CompanionGrantRow[];
  /** person id -> display name, for the person-arm subjects only. */
  names: ReadonlyMap<string, string>;
  rolePermissions: RolePermissionRow[];
}): { holderPeopleCount: number; rows: HolderRow[] } {
  const { slot, grants, companions, names, rolePermissions } = input;
  const holderPeopleCount = new Set(grants.map((g) => g.holder_person_id)).size;

  // Group the list rows by subject.
  const personSubjects = new Map<string, HolderGrantRow[]>();
  const groupSubjects = new Map<string, HolderGrantRow[]>();
  for (const g of grants) {
    if (g.arm === "person" && g.subject_person_id) {
      const bucket = personSubjects.get(g.subject_person_id) ?? [];
      bucket.push(g);
      personSubjects.set(g.subject_person_id, bucket);
    } else if (g.arm === "group" && g.group_id) {
      const bucket = groupSubjects.get(g.group_id) ?? [];
      bucket.push(g);
      groupSubjects.set(g.group_id, bucket);
    }
  }

  // The groups each person holds through (any group, derived or managed).
  const groupsByHolder = new Map<string, Set<string>>();
  for (const g of grants) {
    if (g.arm === "group" && g.group_name) {
      const set = groupsByHolder.get(g.holder_person_id) ?? new Set<string>();
      set.add(g.group_name);
      groupsByHolder.set(g.holder_person_id, set);
    }
  }

  const companionsByPerson = new Map<string, CompanionGrantRow[]>();
  for (const c of companions) {
    const bucket = companionsByPerson.get(c.person_id) ?? [];
    bucket.push(c);
    companionsByPerson.set(c.person_id, bucket);
  }

  const permissionsByRole = new Map<string, RolePermissionRow[]>();
  for (const p of rolePermissions) {
    const bucket = permissionsByRole.get(p.role_id) ?? [];
    bucket.push(p);
    permissionsByRole.set(p.role_id, bucket);
  }

  const designationReason = DESIGNATION_REASON[slot];

  function finish(args: {
    subjectKind: "person" | "group";
    subjectId: string;
    displayName: string;
    subjectRows: HolderGrantRow[];
    companionRows: CompanionGrantRow[];
    alsoThroughGroupNames: string[];
    derived: boolean;
  }): HolderRow {
    const contributingIds = new Set(args.subjectRows.map((r) => r.grant_id));
    const roleIds = new Set([
      ...args.subjectRows.map((r) => r.role_id),
      ...args.companionRows.map((r) => r.role_id),
    ]);
    const permissionByKey = new Map<string, string>();
    for (const roleId of roleIds) {
      for (const p of permissionsByRole.get(roleId) ?? []) permissionByKey.set(p.key, p.description);
    }
    const others = new Set(
      grants.filter((g) => !contributingIds.has(g.grant_id)).map((g) => g.holder_person_id),
    );
    const holders = new Set(args.subjectRows.map((r) => r.holder_person_id));
    const since = args.subjectRows.map((r) => r.grant_starts_on).sort()[0] ?? "";
    return {
      key: `${args.subjectKind}:${args.subjectId}`,
      subjectKind: args.subjectKind,
      subjectId: args.subjectId,
      displayName: args.displayName,
      holderPeopleCount: args.subjectKind === "person" ? 1 : holders.size,
      since,
      provenance: args.subjectRows.some((r) => r.grant_reason === designationReason) ? "designation" : "other",
      roleNames: sortedUnique(args.subjectRows.map((r) => r.role_name)),
      companionRoleNames: sortedUnique(args.companionRows.map((r) => r.role_name)),
      permissions: [...permissionByKey.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, description]) => ({ key, description })),
      grantIds: sortedUnique([...contributingIds, ...args.companionRows.map((r) => r.grant_id)]),
      alsoThroughGroupNames: args.alsoThroughGroupNames,
      leavesNoHolders: others.size === 0,
      revocable: !args.derived,
      derivedGroupName: args.derived ? args.displayName : null,
    };
  }

  const personRows: HolderRow[] = [...personSubjects.entries()].map(([personId, subjectRows]) =>
    finish({
      subjectKind: "person",
      subjectId: personId,
      displayName: names.get(personId) ?? "A person at this organization",
      subjectRows,
      companionRows: slot === "founding_administrator" ? (companionsByPerson.get(personId) ?? []) : [],
      alsoThroughGroupNames: [...(groupsByHolder.get(personId) ?? [])].sort(),
      derived: false,
    }),
  );

  const groupRows: HolderRow[] = [...groupSubjects.entries()].map(([groupId, subjectRows]) =>
    finish({
      subjectKind: "group",
      subjectId: groupId,
      displayName: subjectRows[0]?.group_name ?? "A group",
      subjectRows,
      companionRows: [],
      alsoThroughGroupNames: [],
      derived: subjectRows.some((r) => r.group_membership_source === "derived"),
    }),
  );

  const byName = (a: HolderRow, b: HolderRow) =>
    a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : a.key < b.key ? -1 : 1;
  personRows.sort(byName);
  groupRows.sort(byName);

  return { holderPeopleCount, rows: [...personRows, ...groupRows] };
}
