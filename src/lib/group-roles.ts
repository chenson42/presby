/**
 * The one closed `group_role` vocabulary (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 2 R1 and Phase 3 "Module and file plan"; DECISION-354).
 * PURE: no imports, so `groups.ts`, `committees/contract.ts`, `sites.ts`, the
 * public committee directory, the groups admin's label map and a client form can
 * all read it. `contract.test.ts` pins `GROUP_ROLE_VALUES` against the
 * `group_memberships_group_role_check` list parsed out of
 * `drizzle/0090_presby_committees.sql`, and `group-roles.test.ts` pins the rest.
 *
 * SEVEN VALUES. Three are the original vocabulary (chair, leader, member); four
 * are TITLES that carry no authority (vice chair, clerk, secretary, ex officio).
 * `presby_reimbursement__is_seat` (0073) and `presby_worship_leads_team` (0085)
 * match `group_role in ('chair','leader')` exactly and fail closed, so a title
 * confers nothing there: `SEAT_ROLES` is that exact-match set and
 * `TITLE_ONLY_ROLES` is disjoint from it by test.
 *
 * TWO OFFER SETS. The groups admin keeps offering `GROUP_ADMIN_ROLES` (chair,
 * leader, member), unchanged. The committees surface offers `COMMITTEE_ROLES`
 * (six, no `leader`, which is the legacy seat word). Their union is the whole
 * vocabulary, so a legacy `leader` row still renders a label (read-only) and a
 * role change on it offers the six.
 */

/** Equal, as a set, to `group_memberships_group_role_check` (drizzle/0090 section 1). */
export const GROUP_ROLE_VALUES = [
  "chair",
  "leader",
  "member",
  "vice_chair",
  "clerk",
  "secretary",
  "ex_officio",
] as const;
export type GroupRoleValue = (typeof GROUP_ROLE_VALUES)[number];

/** Total: every value has a label (the F458 failure shape was a blank title). */
export const GROUP_ROLE_LABELS: Record<GroupRoleValue, string> = {
  chair: "Chair",
  leader: "Leader",
  member: "Member",
  vice_chair: "Vice chair",
  clerk: "Clerk",
  secretary: "Secretary",
  ex_officio: "Ex officio",
};

/** What `/admin/groups` offers (unchanged by DECISION-354). */
export const GROUP_ADMIN_ROLES = ["chair", "leader", "member"] as const satisfies readonly GroupRoleValue[];

/** What committees (and, in Increment 2, commissions) offer, in display order. */
export const COMMITTEE_ROLES = [
  "chair",
  "vice_chair",
  "clerk",
  "secretary",
  "ex_officio",
  "member",
] as const satisfies readonly GroupRoleValue[];
export type CommitteeRole = (typeof COMMITTEE_ROLES)[number];

/** The roles 0073 and 0085 read as seats (exact match, fail closed). */
export const SEAT_ROLES = ["chair", "leader"] as const satisfies readonly GroupRoleValue[];

/** Titles only: they carry no authority anywhere. */
export const TITLE_ONLY_ROLES = [
  "vice_chair",
  "clerk",
  "secretary",
  "ex_officio",
] as const satisfies readonly GroupRoleValue[];

const SORT_RANK: Record<GroupRoleValue, number> = {
  chair: 0,
  leader: 1,
  vice_chair: 2,
  clerk: 3,
  secretary: 4,
  ex_officio: 5,
  member: 6,
};

/** Roster order: chair, leader, vice chair, clerk, secretary, ex officio, member. */
export function groupRoleSortRank(role: GroupRoleValue): number {
  return SORT_RANK[role];
}

export function isGroupRoleValue(value: unknown): value is GroupRoleValue {
  return typeof value === "string" && (GROUP_ROLE_VALUES as readonly string[]).includes(value);
}

export function isCommitteeRole(value: unknown): value is CommitteeRole {
  return typeof value === "string" && (COMMITTEE_ROLES as readonly string[]).includes(value);
}
