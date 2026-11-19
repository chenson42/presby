/**
 * U11 (docs/work-log/2026-11-19-presbytery-committees.md, Test plan): the group
 * role vocabulary. Pure; no database. The migration-side equality (the CHECK
 * list parsed out of drizzle/0090) is in `committees/contract.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  COMMITTEE_ROLES,
  GROUP_ADMIN_ROLES,
  GROUP_ROLE_LABELS,
  GROUP_ROLE_VALUES,
  SEAT_ROLES,
  TITLE_ONLY_ROLES,
  groupRoleSortRank,
  isCommitteeRole,
  isGroupRoleValue,
} from "./group-roles";

describe("group-roles (DECISION-354)", () => {
  it("has seven values", () => {
    expect([...GROUP_ROLE_VALUES].sort()).toEqual(
      ["chair", "clerk", "ex_officio", "leader", "member", "secretary", "vice_chair"].sort(),
    );
  });

  it("the union of the two offer sets is the whole vocabulary", () => {
    expect([...new Set([...GROUP_ADMIN_ROLES, ...COMMITTEE_ROLES])].sort()).toEqual([...GROUP_ROLE_VALUES].sort());
  });

  it("the committee offer set never offers leader, and the groups admin offer is unchanged", () => {
    expect(COMMITTEE_ROLES).not.toContain("leader");
    expect([...GROUP_ADMIN_ROLES]).toEqual(["chair", "leader", "member"]);
    expect(COMMITTEE_ROLES).toHaveLength(6);
  });

  it("the seat roles and the title-only roles are disjoint, and together are not the whole vocabulary (member is neither)", () => {
    for (const role of TITLE_ONLY_ROLES) expect(SEAT_ROLES as readonly string[]).not.toContain(role);
    expect([...SEAT_ROLES]).toEqual(["chair", "leader"]);
    expect([...TITLE_ONLY_ROLES].sort()).toEqual(["clerk", "ex_officio", "secretary", "vice_chair"]);
  });

  it("every value has a non-empty label and a sort rank, ranks all different", () => {
    const ranks = new Set<number>();
    for (const role of GROUP_ROLE_VALUES) {
      expect(GROUP_ROLE_LABELS[role], role).toBeTruthy();
      ranks.add(groupRoleSortRank(role));
    }
    expect(ranks.size).toBe(GROUP_ROLE_VALUES.length);
  });

  it("labels are the Copy section's (C3)", () => {
    expect(GROUP_ROLE_LABELS).toEqual({
      chair: "Chair",
      leader: "Leader",
      member: "Member",
      vice_chair: "Vice chair",
      clerk: "Clerk",
      secretary: "Secretary",
      ex_officio: "Ex officio",
    });
  });

  it("sorts chair, leader, vice chair, clerk, secretary, ex officio, member", () => {
    const sorted = [...GROUP_ROLE_VALUES].sort((a, b) => groupRoleSortRank(a) - groupRoleSortRank(b));
    expect(sorted).toEqual(["chair", "leader", "vice_chair", "clerk", "secretary", "ex_officio", "member"]);
  });

  it("the guards reject anything outside the vocabulary", () => {
    expect(isGroupRoleValue("boss")).toBe(false);
    expect(isGroupRoleValue(undefined)).toBe(false);
    expect(isGroupRoleValue("clerk")).toBe(true);
    expect(isCommitteeRole("leader")).toBe(false);
    expect(isCommitteeRole("ex_officio")).toBe(true);
  });
});
