// @vitest-environment jsdom
/**
 * Tests for <RolesList> — P9 commit 3/3.
 *
 * `./actions` and `sonner` are mocked purely so `<RevokeDialog>` (rendered
 * per row) can mount without pulling `@/lib/role-grants` into the module
 * graph — see `grant-role-form.test.tsx`'s header for the full reasoning.
 * `<RevokeDialog>`'s OWN behaviour (confirmation copy, submit, error
 * surfacing) is covered by `revoke-dialog.test.tsx`; this file only asserts
 * that a "Revoke" trigger exists per row.
 *
 * What this file exists to pin, per the Phase 3 design and this pipeline's
 * brief:
 *   - the empty state, when there are zero grants;
 *   - the table's columns render role, grantee, granted-by, since;
 *   - Finding 4, the arm-1 cascade gap SURFACED NOT FIXED: a person-arm
 *     grant with a non-null `membershipEnded` gets a visible "Membership
 *     ended" badge; a grant with `membershipEnded: null` does not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  grantRoleAction: vi.fn(),
  revokeRoleAction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RolesList } from "./roles-list";
import type { GrantListEntry } from "@/lib/role-grants";

afterEach(cleanup);

const PERSON_GRANT: GrantListEntry = {
  grantId: "grant-1",
  roleId: "role-1",
  roleKey: "stated_clerk",
  roleName: "Stated Clerk",
  grantee: {
    kind: "person",
    personId: "person-1",
    displayName: "Tobias Renwick",
    membershipEnded: null,
  },
  startsOn: "2023-01-08",
  grantedByEmail: "clerk@example.invalid",
  grantReason: null,
};

const LAPSED_PERSON_GRANT: GrantListEntry = {
  grantId: "grant-2",
  roleId: "role-2",
  roleKey: "property_chair",
  roleName: "Property Committee Chair",
  grantee: {
    kind: "person",
    personId: "person-2",
    displayName: "Marguerite Ashcombe",
    membershipEnded: "2026-02-01",
  },
  startsOn: "2024-01-01",
  grantedByEmail: null,
  grantReason: null,
};

const GROUP_GRANT: GrantListEntry = {
  grantId: "grant-3",
  roleId: "role-3",
  roleKey: "session_member",
  roleName: "Session Member",
  grantee: { kind: "group", groupId: "group-1", groupName: "Session" },
  startsOn: "2020-01-01",
  grantedByEmail: "clerk@example.invalid",
  grantReason: null,
};

describe("RolesList — empty state", () => {
  it("renders a designed empty state, not a blank table, when there are zero grants", () => {
    render(<RolesList grants={[]} slug="alder-creek" />);
    expect(screen.getByText(/no roles are granted yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("RolesList — table columns", () => {
  it("renders role name, grantee name, granted-by email, and a Revoke trigger per row", () => {
    render(<RolesList grants={[PERSON_GRANT]} slug="alder-creek" />);
    expect(screen.getByText("Stated Clerk")).toBeTruthy();
    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
    expect(screen.getByText("clerk@example.invalid")).toBeTruthy();
    expect(screen.getByRole("button", { name: /revoke/i })).toBeTruthy();
  });

  it("renders an em dash when granted-by is null, rather than a blank cell", () => {
    render(<RolesList grants={[LAPSED_PERSON_GRANT]} slug="alder-creek" />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders the group name and a (group) marker for a group-arm grant", () => {
    render(<RolesList grants={[GROUP_GRANT]} slug="alder-creek" />);
    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("(group)")).toBeTruthy();
  });
});

describe("RolesList — finding 4: the arm-1 cascade gap, surfaced not fixed", () => {
  it("shows a 'Membership ended' badge for a person-arm grant with a non-null membershipEnded", () => {
    render(<RolesList grants={[LAPSED_PERSON_GRANT]} slug="alder-creek" />);
    expect(screen.getByText(/membership ended/i)).toBeTruthy();
    // The row is NOT filtered out and the grantee is still named.
    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();
  });

  it("shows no 'Membership ended' badge for a person-arm grant with membershipEnded: null", () => {
    render(<RolesList grants={[PERSON_GRANT]} slug="alder-creek" />);
    expect(screen.queryByText(/membership ended/i)).toBeNull();
  });

  it("shows no 'Membership ended' badge for a group-arm grant (the field does not apply)", () => {
    render(<RolesList grants={[GROUP_GRANT]} slug="alder-creek" />);
    expect(screen.queryByText(/membership ended/i)).toBeNull();
  });
});
