/**
 * Orchestration tests for the seat-only-key refusal in createRoleAction and
 * adoptTemplateAction (DECISION-242, F260). Mocked at the `@/lib/role-definitions`
 * boundary: the typed refusal itself is proven against a real Postgres in
 * `role-definitions.test.ts`; this file pins that the action maps it to its copy
 * (design C8) and writes no audit row and revalidates nothing.
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
    ROLE_DEFINITION_CREATED: "tenant.role_definition.created",
    ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE: "tenant.role_definition.adopted_from_template",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockCreateRole = vi.hoisted(() => vi.fn());
const mockAdoptTemplate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/role-definitions", () => ({
  createRole: (...args: unknown[]) => mockCreateRole(...args),
  adoptTemplate: (...args: unknown[]) => mockAdoptTemplate(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptTemplateAction, createRoleAction } from "./actions";

const SEAT_KEY_COPY =
  "That permission is held through a recorded seat and can't be added to a role.";

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

describe("seat_only_key", () => {
  it("createRoleAction maps it to the seat copy, with no audit and no revalidate", async () => {
    mockCreateRole.mockResolvedValueOnce({ kind: "seat_only_key" });
    const result = await createRoleAction("alder-creek", {
      key: "x",
      name: "X",
      permissionKeys: ["parishes.assign"],
    });
    expect(result).toEqual({ ok: false, error: SEAT_KEY_COPY });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("adoptTemplateAction maps it to the same copy", async () => {
    mockAdoptTemplate.mockResolvedValueOnce({ kind: "seat_only_key" });
    const result = await adoptTemplateAction("alder-creek", { templateRoleId: "t-1" });
    expect(result).toEqual({ ok: false, error: SEAT_KEY_COPY });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
