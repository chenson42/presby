/**
 * The seat-only-key refusal in setRolePermissionsAction (DECISION-242, F260).
 * Mocked at the `@/lib/role-definitions` boundary; the refusal itself is proven
 * against a real Postgres in `role-definitions.test.ts`.
 */
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ROLE_DEFINITION_PERMISSIONS_CHANGED: "tenant.role_definition.permissions_changed",
    ROLE_DEFINITION_DEACTIVATED: "tenant.role_definition.deactivated",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockSetRolePermissions = vi.hoisted(() => vi.fn());
const mockDeactivateRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/role-definitions", () => ({
  setRolePermissions: (...args: unknown[]) => mockSetRolePermissions(...args),
  deactivateRole: (...args: unknown[]) => mockDeactivateRole(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRolePermissionsAction } from "./actions";

beforeEach(() => {
  mockAuth.mockResolvedValue({ user: { id: "user-1", email: "a@example.invalid" } });
  mockResolveOrgContext.mockResolvedValue({
    kind: "ok",
    org: { organizationId: "org-1", personId: "person-1" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setRolePermissionsAction - seat_only_key", () => {
  it("maps it to the seat copy, with no audit and no revalidate", async () => {
    mockSetRolePermissions.mockResolvedValueOnce({ kind: "seat_only_key" });
    const result = await setRolePermissionsAction("alder-creek", "role-1", ["parishes.assign"]);
    expect(result).toEqual({
      ok: false,
      error: "That permission is held through a recorded seat and can't be added to a role.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
