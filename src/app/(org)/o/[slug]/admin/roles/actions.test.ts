/**
 * Orchestration tests for grantRoleAction / revokeRoleAction.
 *
 * Mocked at the `@/lib/role-grants` boundary — same principle as
 * `src/app/(org)/o/[slug]/directory/page.test.tsx`: the SQL correctness
 * (the escalation subset check, the arm-1 cascade visibility, the
 * self-lockout guard) is already proven by `role-grants.test.ts` against a
 * real Postgres connection. What this file exists to pin is the CONTRACT
 * this actions.ts layer owns and nothing else does:
 *
 *   1. `organizationId` comes from a FRESH `resolveOrgContext(session.user.id,
 *      slug)` call, never from client-supplied input — there is no
 *      `organizationId` field anywhere in either action's input type, so the
 *      only way to prove this is to assert `resolveOrgContext` was called
 *      with the session's own `userId` and the `slug` argument, and that its
 *      resolved `organizationId`/`personId` are what reached `grantRole`/
 *      `revokeRole`.
 *   2. `grantRole`/`revokeRole` receive `identity.personId` (a `people.id`)
 *      for authorization and `identity.userId` (a `users.id`, from
 *      `session.user.id`) for `granted_by` — never the same value for both.
 *   3. Every `GrantResult`/`RevokeResult` kind maps to the correct
 *      `ActionResult` shape, and `recordAudit()` fires ONLY on `{ kind: "ok"
 *      }` — never on a denial, and never before the mutation succeeds.
 *   4. `revalidatePath` fires only after a successful mutation.
 *
 * vi.mock() calls are hoisted before imports by Vitest's transform; every
 * mock factory referencing an outer `vi.fn()` uses `vi.hoisted()`.
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
    TENANT_ROLE_GRANTED: "tenant.role.granted",
    TENANT_ROLE_REVOKED: "tenant.role.revoked",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockGrantRole = vi.hoisted(() => vi.fn());
const mockRevokeRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/role-grants", () => ({
  grantRole: (...args: unknown[]) => mockGrantRole(...args),
  revokeRole: (...args: unknown[]) => mockRevokeRole(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grantRoleAction, revokeRoleAction } from "./actions";

const SESSION = {
  user: { id: "user-platform-id-1", email: "clerk@example.invalid" },
};

const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Identity resolution — the contract this file owns
// ---------------------------------------------------------------------------

describe("identity resolution — organizationId never comes from client input", () => {
  it("grantRoleAction: not signed in returns an error without calling resolveOrgContext", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockGrantRole).not.toHaveBeenCalled();
  });

  it("grantRoleAction: calls resolveOrgContext with session.user.id and the slug argument", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockGrantRole.mockResolvedValueOnce({
      kind: "ok",
      grantId: "grant-1",
      roleKey: "viewer",
    });

    await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });

    expect(mockResolveOrgContext).toHaveBeenCalledWith(
      "user-platform-id-1",
      "alder-creek",
    );
  });

  it("grantRoleAction: a non-'ok' resolution returns an error without calling grantRole", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const result = await grantRoleAction("bramblewood", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockGrantRole).not.toHaveBeenCalled();
  });

  it("grantRoleAction: passes resolved personId/organizationId AND session.user.id (users.id) as the separate granterUserId", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockGrantRole.mockResolvedValueOnce({
      kind: "ok",
      grantId: "grant-1",
      roleKey: "viewer",
    });

    await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
      startsOn: "2026-01-01",
    });

    // (granterPersonId, organizationId, granterUserId, input)
    expect(mockGrantRole).toHaveBeenCalledWith(
      "person-1", // resolved.org.personId — a people.id
      "org-1", // resolved.org.organizationId
      "user-platform-id-1", // session.user.id — a users.id, NEVER personId
      {
        roleId: "role-1",
        target: { kind: "person", personId: "target-1" },
        startsOn: "2026-01-01",
      },
    );
  });

  it("revokeRoleAction: passes resolved personId/organizationId to revokeRole", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockRevokeRole.mockResolvedValueOnce({ kind: "ok" });

    await revokeRoleAction("alder-creek", {
      grantId: "grant-1",
      roleId: "role-1",
      roleKey: "viewer",
      granteeType: "person",
      granteeId: "target-1",
    });

    expect(mockRevokeRole).toHaveBeenCalledWith("person-1", "org-1", "grant-1");
  });
});

// ---------------------------------------------------------------------------
// grantRoleAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("grantRoleAction — GrantResult → ActionResult mapping", () => {
  beforeEachGrant();

  it("forbidden → ok:false, no audit, no revalidate", async () => {
    mockGrantRole.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });
    expect(result.ok).toBe(false);
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_role → ok:false, no audit", async () => {
    mockGrantRole.mockResolvedValueOnce({ kind: "invalid_role" });
    const result = await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });
    expect(result.ok).toBe(false);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target (person) → names the person case", async () => {
    mockGrantRole.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });
    expect(result).toEqual({
      ok: false,
      error:
        "That person doesn't have a current membership at this organization.",
    });
  });

  it("invalid_target (group) → names the group case", async () => {
    mockGrantRole.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "group", groupId: "group-1" },
    });
    expect(result).toEqual({
      ok: false,
      error: "That group doesn't exist at this organization.",
    });
  });

  it("escalation_denied → names every missing permission, no audit", async () => {
    mockGrantRole.mockResolvedValueOnce({
      kind: "escalation_denied",
      missingPermissions: ["role_grants.manage", "financial.approve"],
    });
    const result = await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("role_grants.manage");
      expect(result.error).toContain("financial.approve");
    }
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok → returns ok:true with grantId, records audit with full metadata, revalidates", async () => {
    mockGrantRole.mockResolvedValueOnce({
      kind: "ok",
      grantId: "grant-99",
      roleKey: "stated_clerk",
    });

    const result = await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "target-1" },
    });

    expect(result).toEqual({ ok: true, data: { grantId: "grant-99" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.role.granted",
      resourceType: "role_grant",
      resourceId: "grant-99",
      metadata: {
        organizationId: "org-1",
        roleId: "role-1",
        roleKey: "stated_clerk",
        granteeType: "person",
        granteeId: "target-1",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/roles",
    );
  });

  it("ok, group target → metadata.granteeType/granteeId reflect the group", async () => {
    mockGrantRole.mockResolvedValueOnce({
      kind: "ok",
      grantId: "grant-100",
      roleKey: "viewer",
    });

    await grantRoleAction("alder-creek", {
      roleId: "role-1",
      target: { kind: "group", groupId: "group-42" },
    });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          granteeType: "group",
          granteeId: "group-42",
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// revokeRoleAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("revokeRoleAction — RevokeResult → ActionResult mapping", () => {
  beforeEachRevoke();

  it("forbidden → ok:false, no audit", async () => {
    mockRevokeRole.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await revokeRoleAction("alder-creek", revokeInput());
    expect(result.ok).toBe(false);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("not_found → ok:false, no audit", async () => {
    mockRevokeRole.mockResolvedValueOnce({ kind: "not_found" });
    const result = await revokeRoleAction("alder-creek", revokeInput());
    expect(result).toEqual({
      ok: false,
      error: "That role grant no longer exists.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("self_lockout_blocked → ok:false, names the risk, no audit", async () => {
    mockRevokeRole.mockResolvedValueOnce({ kind: "self_lockout_blocked" });
    const result = await revokeRoleAction("alder-creek", revokeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/nobody able to grant or revoke/i);
    }
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("ok → returns ok:true, records audit with caller-supplied metadata, revalidates", async () => {
    mockRevokeRole.mockResolvedValueOnce({ kind: "ok" });
    const input = revokeInput();

    const result = await revokeRoleAction("alder-creek", input);

    expect(result).toEqual({ ok: true });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.role.revoked",
      resourceType: "role_grant",
      resourceId: input.grantId,
      metadata: {
        organizationId: "org-1",
        roleId: input.roleId,
        roleKey: input.roleKey,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/roles",
    );
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function beforeEachGrant() {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });
}

function beforeEachRevoke() {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });
}

function revokeInput() {
  return {
    grantId: "grant-5",
    roleId: "role-5",
    roleKey: "viewer",
    granteeType: "person" as const,
    granteeId: "target-5",
  };
}
