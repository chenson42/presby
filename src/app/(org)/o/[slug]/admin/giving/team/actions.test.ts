/**
 * Orchestration tests for the giving-team server actions (docs/work-log/
 * 2026-10-15-online-giving.md, R3 / F138, P3-18): giving.manage, validation,
 * the library vocabulary mapped to plain language, and audit events that REUSE
 * the existing role keys with `path: "giving_team"`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/action-gate", async () => {
  const { zodFieldErrors } = await import("@/lib/giving/field-errors");
  return {
    gateGivingAction: (...a: unknown[]) => gate(...a),
    invalidInput: (e: import("zod").ZodError) => ({ ok: false, error: "Check the highlighted fields and try again.", fieldErrors: zodFieldErrors(e) }),
  };
});
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TENANT_ROLE_GRANTED: "tenant.role.granted",
    TENANT_ROLE_REVOKED: "tenant.role.revoked",
    ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE: "tenant.role_definition.adopted_from_template",
  },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const lib = vi.hoisted(() => ({ grantGivingRole: vi.fn(), revokeGivingRole: vi.fn(), ensureGivingRole: vi.fn() }));
vi.mock("@/lib/giving/team", () => ({ ...lib, GIVING_TEMPLATE_KEYS: ["treasurer", "giving_recorder"] }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { ensureGivingRoleAction, grantGivingRoleAction, revokeGivingRoleAction } from "./actions";

const IDENTITY = { ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", has: { view: true, record: true, manage: true } };
const ROLE = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const GRANT = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  gate.mockReset();
  recordAudit.mockClear();
  revalidatePath.mockReset();
  for (const fn of Object.values(lib)) fn.mockReset();
});

describe("the gate", () => {
  it("every team action asks for giving.manage and stops at a refusal", async () => {
    gate.mockResolvedValue({ ok: false, error: "nope" });
    for (const call of [
      () => grantGivingRoleAction("s", { roleId: ROLE, personId: PERSON }),
      () => revokeGivingRoleAction("s", { grantId: GRANT }),
      () => ensureGivingRoleAction("s", { templateKey: "giving_recorder" }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: "nope" });
    }
    expect(gate).toHaveBeenCalledWith("s", ["manage"]);
    for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("grantGivingRoleAction", () => {
  it("there is NO group parameter: a group target is not even a shape the action accepts", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await grantGivingRoleAction("s", { roleId: ROLE, groupId: PERSON })).toMatchObject({ ok: false, fieldErrors: { personId: expect.any(String) } });
    expect(lib.grantGivingRole).not.toHaveBeenCalled();
  });

  it("audits TENANT_ROLE_GRANTED with path: giving_team (a person-arm grant)", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.grantGivingRole.mockResolvedValue({ kind: "ok", grantId: GRANT, roleKey: "giving_recorder", roleName: "Giving Recorder" });
    expect(await grantGivingRoleAction("alder-creek", { roleId: ROLE, personId: PERSON })).toEqual({ ok: true, data: { grantId: GRANT } });
    expect(lib.grantGivingRole).toHaveBeenCalledWith("person-1", "org-1", "user-1", { roleId: ROLE, personId: PERSON });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.role.granted", resourceType: "role_grant", resourceId: GRANT,
      metadata: { organizationId: "org-1", roleId: ROLE, roleKey: "giving_recorder", granteeType: "person", granteeId: PERSON, path: "giving_team" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/giving/team");
  });

  it.each([
    [{ kind: "invalid_role" }, /isn't available/],
    [{ kind: "invalid_target" }, /current membership/],
    [{ kind: "not_giving_only" }, /Grant it from Roles/],
    [{ kind: "escalation_denied", missingPermissions: ["giving.record"] }, /giving\.record/],
    [{ kind: "already_granted" }, /already has/],
    [{ kind: "forbidden" }, /permission/],
  ])("maps %j with no audit", async (libResult, pattern) => {
    gate.mockResolvedValue(IDENTITY);
    lib.grantGivingRole.mockResolvedValue(libResult);
    expect(((await grantGivingRoleAction("s", { roleId: ROLE, personId: PERSON })) as { error: string }).error).toMatch(pattern);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("revokeGivingRoleAction", () => {
  it("audits TENANT_ROLE_REVOKED with the role and the person, path: giving_team", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.revokeGivingRole.mockResolvedValue({ kind: "ok", roleId: ROLE, roleKey: "treasurer", personId: PERSON });
    expect(await revokeGivingRoleAction("s", { grantId: GRANT })).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.role.revoked", resourceType: "role_grant", resourceId: GRANT,
      metadata: { organizationId: "org-1", roleId: ROLE, roleKey: "treasurer", granteeType: "person", granteeId: PERSON, path: "giving_team" },
    });
  });

  it("the last-manager block says what to do next", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.revokeGivingRole.mockResolvedValue({ kind: "last_manager_blocked" });
    expect(await revokeGivingRoleAction("s", { grantId: GRANT })).toMatchObject({ ok: false, error: expect.stringMatching(/Give the role to someone else first/) });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("ensureGivingRoleAction", () => {
  it("accepts only the two giving templates", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await ensureGivingRoleAction("s", { templateKey: "committee_chair" })).toMatchObject({ ok: false });
    expect(lib.ensureGivingRole).not.toHaveBeenCalled();
  });

  it("audits the adoption (path: giving_team) when it created or changed something, and passes the skipped keys back", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.ensureGivingRole.mockResolvedValue({ kind: "ok", roleId: ROLE, roleKey: "treasurer", templateRoleId: "tpl", created: false, reactivated: true, addedKeys: ["giving.manage"], skippedKeys: ["giving.view"] });
    expect(await ensureGivingRoleAction("s", { templateKey: "treasurer" })).toEqual({ ok: true, data: { roleId: ROLE, skippedKeys: ["giving.view"] } });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "tenant.role_definition.adopted_from_template",
      resourceId: ROLE,
      metadata: expect.objectContaining({ path: "giving_team", templateKey: "treasurer", reactivated: true, created: false }),
    }));
  });

  it("a no-op ensure writes no audit row", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.ensureGivingRole.mockResolvedValue({ kind: "ok", roleId: ROLE, roleKey: "giving_recorder", templateRoleId: "tpl", created: false, reactivated: false, addedKeys: [], skippedKeys: [] });
    expect(await ensureGivingRoleAction("s", { templateKey: "giving_recorder" })).toMatchObject({ ok: true });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "template_not_found" }, /Contact support/],
    [{ kind: "not_giving_only" }, /outside Giving/],
    [{ kind: "escalation_denied", missingPermissions: ["giving.record"] }, /giving\.record/],
  ])("maps %j", async (libResult, pattern) => {
    gate.mockResolvedValue(IDENTITY);
    lib.ensureGivingRole.mockResolvedValue(libResult);
    expect(((await ensureGivingRoleAction("s", { templateKey: "giving_recorder" })) as { error: string }).error).toMatch(pattern);
  });
});
