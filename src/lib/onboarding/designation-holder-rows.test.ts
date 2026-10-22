/**
 * The pure holder-row assembly (docs/work-log/2026-10-22-designation-revoke.md,
 * Phase 3 "Plain props"). No database: every rule here is in
 * designation-holder-rows.ts. The DB-backed read is
 * designation-holders.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  buildHolderRows,
  type CompanionGrantRow,
  type HolderGrantRow,
  type RolePermissionRow,
} from "./designation-holder-rows";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const G1 = "00000000-0000-4000-8000-0000000000f1";
const G2 = "00000000-0000-4000-8000-0000000000f2";
const GRP = "00000000-0000-4000-8000-0000000000e1";
const GRP2 = "00000000-0000-4000-8000-0000000000e2";
const ROLE = "00000000-0000-4000-8000-0000000000d1";
const ROLE2 = "00000000-0000-4000-8000-0000000000d2";

function person(grantId: string, personId: string, overrides: Partial<HolderGrantRow> = {}): HolderGrantRow {
  return {
    grant_id: grantId,
    role_id: ROLE,
    role_key: "founding_administrator",
    role_name: "Founding Administrator",
    arm: "person",
    subject_person_id: personId,
    group_id: null,
    group_name: null,
    group_membership_source: null,
    holder_person_id: personId,
    grant_starts_on: "2026-10-01",
    grant_reason: "founding administrator designation",
    ...overrides,
  };
}

function groupMember(grantId: string, groupId: string, holder: string, overrides: Partial<HolderGrantRow> = {}): HolderGrantRow {
  return {
    grant_id: grantId,
    role_id: ROLE2,
    role_key: "office_manager",
    role_name: "Office Manager",
    arm: "group",
    subject_person_id: null,
    group_id: groupId,
    group_name: "Office Volunteers",
    group_membership_source: "managed",
    holder_person_id: holder,
    grant_starts_on: "2026-09-01",
    grant_reason: null,
    ...overrides,
  };
}

const names = new Map([
  [A, "Perpetua Ashgrove"],
  [B, "Barnaby Quill"],
]);

const perms: RolePermissionRow[] = [
  { role_id: ROLE, key: "roles.manage", description: "Create and edit roles" },
  { role_id: ROLE, key: "people.manage", description: "Manage people" },
  { role_id: ROLE2, key: "people.manage", description: "Manage people" },
];

function build(grants: HolderGrantRow[], companions: CompanionGrantRow[] = [], slot: "founding_administrator" | "treasurer" = "founding_administrator") {
  return buildHolderRows({ slot, grants, companions, names, rolePermissions: perms });
}

describe("buildHolderRows", () => {
  it("is empty and zero for no grants", () => {
    expect(build([])).toEqual({ holderPeopleCount: 0, rows: [] });
  });

  it("one person row: name, since, provenance, roles, permissions and the grant ids", () => {
    const { holderPeopleCount, rows } = build([person(G1, A)]);
    expect(holderPeopleCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      key: `person:${A}`,
      subjectKind: "person",
      subjectId: A,
      displayName: "Perpetua Ashgrove",
      holderPeopleCount: 1,
      since: "2026-10-01",
      provenance: "designation",
      roleNames: ["Founding Administrator"],
      companionRoleNames: [],
      permissions: [
        { key: "people.manage", description: "Manage people" },
        { key: "roles.manage", description: "Create and edit roles" },
      ],
      grantIds: [G1],
      alsoThroughGroupNames: [],
      leavesNoHolders: true,
      revocable: true,
      derivedGroupName: null,
    });
  });

  it("provenance is 'other' when no contributing grant carries the slot's designation reason", () => {
    const { rows } = build([person(G1, A, { grant_reason: "dev-seed: admin grant" })]);
    expect(rows[0]!.provenance).toBe("other");
    // The treasurer slot has its OWN reason string.
    const t = build([person(G1, A, { grant_reason: "founding administrator designation" })], [], "treasurer");
    expect(t.rows[0]!.provenance).toBe("other");
    const t2 = build([person(G1, A, { grant_reason: "treasurer designation" })], [], "treasurer");
    expect(t2.rows[0]!.provenance).toBe("designation");
  });

  it("the companion grant joins the expected set and the role names, and is never a holder row of its own", () => {
    const companion: CompanionGrantRow = {
      person_id: A,
      grant_id: G2,
      role_id: ROLE2,
      role_key: "congregation_stated_clerk",
      role_name: "Congregation Stated Clerk",
      grant_starts_on: "2026-10-01",
    };
    const { holderPeopleCount, rows } = build([person(G1, A)], [companion]);
    expect(holderPeopleCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companionRoleNames).toEqual(["Congregation Stated Clerk"]);
    expect(rows[0]!.grantIds).toEqual([G1, G2].sort());
    expect(rows[0]!.roleNames).toEqual(["Founding Administrator"]);
  });

  it("companions are ignored for the treasurer slot", () => {
    const companion: CompanionGrantRow = {
      person_id: A, grant_id: G2, role_id: ROLE2, role_key: "x", role_name: "X", grant_starts_on: "2026-10-01",
    };
    expect(build([person(G1, A)], [companion], "treasurer").rows[0]!.companionRoleNames).toEqual([]);
  });

  it("a managed group is ONE row with a people count and no member names", () => {
    const grants = [
      groupMember(G1, GRP, A),
      groupMember(G1, GRP, B),
      groupMember(G1, GRP, C),
    ];
    const { holderPeopleCount, rows } = build(grants);
    expect(holderPeopleCount).toBe(3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `group:${GRP}`,
      subjectKind: "group",
      displayName: "Office Volunteers",
      holderPeopleCount: 3,
      revocable: true,
      derivedGroupName: null,
      grantIds: [G1],
      leavesNoHolders: true,
    });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("Perpetua");
    expect(serialized).not.toContain("Barnaby");
    expect(serialized).not.toContain(A);
    expect(serialized).not.toContain(B);
  });

  it("a derived group is not revocable and names itself", () => {
    const { rows } = build([groupMember(G1, GRP, A, { group_name: "Session", group_membership_source: "derived" })]);
    expect(rows[0]).toMatchObject({ revocable: false, derivedGroupName: "Session", displayName: "Session" });
  });

  it("a person who also holds through a group lists it, and revoking them does not leave nobody", () => {
    const grants = [person(G1, A), groupMember(G2, GRP, A)];
    const { holderPeopleCount, rows } = build(grants);
    expect(holderPeopleCount).toBe(1);
    expect(rows).toHaveLength(2);
    const p = rows.find((r) => r.subjectKind === "person")!;
    expect(p.alsoThroughGroupNames).toEqual(["Office Volunteers"]);
    expect(p.leavesNoHolders).toBe(false);
    const g = rows.find((r) => r.subjectKind === "group")!;
    expect(g.leavesNoHolders).toBe(false);
  });

  it("leavesNoHolders is false when another person holds, true when this row is the only source", () => {
    const two = build([person(G1, A), person(G2, B)]);
    expect(two.rows.every((r) => r.leavesNoHolders === false)).toBe(true);
    expect(build([person(G1, A)]).rows[0]!.leavesNoHolders).toBe(true);
  });

  it("a person with two contributing grants is one row, both grant ids, the earliest start", () => {
    const { rows } = build([
      person(G1, A, { grant_starts_on: "2026-10-05" }),
      person(G2, A, { grant_starts_on: "2026-09-02", role_id: ROLE2, role_name: "Office Manager" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.since).toBe("2026-09-02");
    expect(rows[0]!.grantIds).toEqual([G1, G2].sort());
    expect(rows[0]!.roleNames).toEqual(["Founding Administrator", "Office Manager"]);
  });

  it("two groups are two rows; people rows come before group rows, each sorted by name", () => {
    const grants = [
      groupMember(G1, GRP2, A, { group_name: "Zeta Group" }),
      groupMember(G2, GRP, B, { group_name: "Alpha Group" }),
      person("00000000-0000-4000-8000-0000000000f3", C),
    ];
    const { rows } = build(grants);
    expect(rows.map((r) => r.displayName)).toEqual(["A person at this organization", "Alpha Group", "Zeta Group"]);
  });

  it("a row never has an email-shaped property or value", () => {
    const { rows } = build([person(G1, A), groupMember(G2, GRP, B)]);
    expect(JSON.stringify(rows)).not.toMatch(/@|email/i);
  });
});
