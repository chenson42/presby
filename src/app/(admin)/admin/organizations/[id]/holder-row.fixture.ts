import type { HolderRow } from "@/lib/onboarding/designation-holder-types";

/** Test-support: one person `HolderRow` with every field defaulted (synthetic data only). */
export function holderRow(overrides: Partial<HolderRow> = {}): HolderRow {
  return {
    key: "person:00000000-0000-4000-8000-0000000000a1",
    subjectKind: "person",
    subjectId: "00000000-0000-4000-8000-0000000000a1",
    displayName: "Perpetua Ashgrove",
    holderPeopleCount: 1,
    since: "2026-10-01",
    provenance: "designation",
    roleNames: ["Founding Administrator"],
    companionRoleNames: ["Congregation Stated Clerk"],
    permissions: [
      { key: "people.manage", description: "Manage the congregation's people records" },
      { key: "roles.manage", description: "Create and edit roles" },
    ],
    grantIds: [
      "00000000-0000-4000-8000-0000000000b1",
      "00000000-0000-4000-8000-0000000000b2",
    ],
    alsoThroughGroupNames: [],
    leavesNoHolders: true,
    revocable: true,
    derivedGroupName: null,
    ...overrides,
  };
}

/** A managed-group `HolderRow`. */
export function groupHolderRow(overrides: Partial<HolderRow> = {}): HolderRow {
  return holderRow({
    key: "group:00000000-0000-4000-8000-0000000000c1",
    subjectKind: "group",
    subjectId: "00000000-0000-4000-8000-0000000000c1",
    displayName: "Office Volunteers",
    holderPeopleCount: 3,
    provenance: "other",
    roleNames: ["Office Manager"],
    companionRoleNames: [],
    grantIds: ["00000000-0000-4000-8000-0000000000b3"],
    ...overrides,
  });
}

/** A derived-group `HolderRow` (no Revoke). */
export function derivedGroupHolderRow(overrides: Partial<HolderRow> = {}): HolderRow {
  return groupHolderRow({
    key: "group:00000000-0000-4000-8000-0000000000c2",
    subjectId: "00000000-0000-4000-8000-0000000000c2",
    displayName: "Session",
    holderPeopleCount: 7,
    revocable: false,
    derivedGroupName: "Session",
    ...overrides,
  });
}
