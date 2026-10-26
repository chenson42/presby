/**
 * Orchestration tests for the Treasury-team server actions (docs/work-log/
 * 2026-10-25-treasury-inc1.md, P3-14, F296, EC31): reimbursement.manage,
 * validation, the library vocabulary mapped to Copy, and audit events that REUSE
 * the existing role keys with `path: "reimbursement_team"` (the giving team's
 * shape). The logic under them is `src/lib/treasury/team.ts`, tested against a
 * real database in `team.db.test.ts` and `role-bundle.db.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/gate", () => ({ gateReimbursementAction: (...a: unknown[]) => gate(...a) }));
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TENANT_ROLE_GRANTED: "tenant.role.granted",
    TENANT_ROLE_REVOKED: "tenant.role.revoked",
    ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE: "tenant.role_definition.adopted_from_template",
  },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const lib = vi.hoisted(() => ({ grant: vi.fn(), revoke: vi.fn(), ensure: vi.fn() }));
vi.mock("@/lib/treasury/team", () => ({
  grantTreasuryRole: lib.grant,
  revokeTreasuryRole: lib.revoke,
  ensureTreasuryRole: lib.ensure,
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { ensureTreasuryRoleAction, grantTreasuryRoleAction, revokeTreasuryRoleAction } from "./actions";

const IDENTITY = { ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", has: { view: true, pay: true, manage: true, requestForOthers: true } };
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
  it("every team action asks for reimbursement.manage and stops at a refusal", async () => {
    gate.mockResolvedValue({ ok: false, error: "nope" });
    for (const call of [
      () => grantTreasuryRoleAction("s", { roleId: ROLE, personId: PERSON }),
      () => revokeTreasuryRoleAction("s", { grantId: GRANT }),
      () => ensureTreasuryRoleAction("s", { templateKey: "reimbursement_clerk" }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: "nope" });
    }
    expect(gate).toHaveBeenCalledTimes(3);
    for (const call of gate.mock.calls) expect(call).toEqual(["s", { anyOf: ["manage"] }]);
    for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("grantTreasuryRoleAction", () => {
  it("there is NO group parameter: a group target is not a shape the action accepts", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await grantTreasuryRoleAction("s", { roleId: ROLE, groupId: PERSON })).toMatchObject({ ok: false, fieldErrors: { personId: expect.any(String) } });
    expect(lib.grant).not.toHaveBeenCalled();
  });

  it("grants on the reimbursement SURFACE with the actor from the gate, never the input, and audits path: reimbursement_team", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.grant.mockResolvedValue({ kind: "ok", grantId: GRANT, roleKey: "treasurer", roleName: "Treasurer" });
    expect(await grantTreasuryRoleAction("alder", { roleId: ROLE, personId: PERSON, organizationId: "org-evil", actorPersonId: "x" })).toEqual({
      ok: true, data: { grantId: GRANT },
    });
    expect(lib.grant).toHaveBeenCalledWith("reimbursement", "person-1", "org-1", "user-1", { roleId: ROLE, personId: PERSON });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.role.granted", resourceType: "role_grant", resourceId: GRANT,
      metadata: { organizationId: "org-1", roleId: ROLE, roleKey: "treasurer", granteeType: "person", granteeId: PERSON, path: "reimbursement_team" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder/admin/reimbursements/team");
  });

  it.each([
    [{ kind: "forbidden" }, "You don't have permission to manage the treasury team."],
    [{ kind: "invalid_role" }, "That role isn't available at this organization."],
    [{ kind: "invalid_target" }, "That person doesn't have a current membership here."],
    [{ kind: "not_treasury_only" }, "That role includes permissions outside Giving and Reimbursements. An administrator can grant it from Roles."],
    [{ kind: "escalation_denied", missingPermissions: ["reimbursement.pay", "reimbursement.view"] }, "You can't grant permissions you don't hold yourself: reimbursement.pay, reimbursement.view."],
    [{ kind: "already_granted" }, "That person already has this role."],
  ])("maps %j to its Copy sentence, with no audit", async (libResult, error) => {
    gate.mockResolvedValue(IDENTITY);
    lib.grant.mockResolvedValue(libResult);
    expect(await grantTreasuryRoleAction("s", { roleId: ROLE, personId: PERSON })).toEqual({ ok: false, error });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revokeTreasuryRoleAction", () => {
  it("audits TENANT_ROLE_REVOKED with the role and the person, path: reimbursement_team", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.revoke.mockResolvedValue({ kind: "ok", roleId: ROLE, roleKey: "treasurer", personId: PERSON });
    expect(await revokeTreasuryRoleAction("s", { grantId: GRANT })).toEqual({ ok: true, data: undefined });
    expect(lib.revoke).toHaveBeenCalledWith("reimbursement", "person-1", "org-1", { grantId: GRANT });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.role.revoked", resourceType: "role_grant", resourceId: GRANT,
      metadata: { organizationId: "org-1", roleId: ROLE, roleKey: "treasurer", granteeType: "person", granteeId: PERSON, path: "reimbursement_team" },
    });
  });

  it.each([
    [{ kind: "forbidden" }, "You don't have permission to manage the treasury team."],
    [{ kind: "not_found" }, "That role assignment has already ended."],
    [{ kind: "not_treasury_only" }, "That assignment can only be ended from Roles."],
    [{ kind: "last_manager_blocked" }, "That would leave no one able to manage reimbursements. Give the role to someone else first."],
  ])("maps %j to its sentence, with no audit", async (libResult, error) => {
    gate.mockResolvedValue(IDENTITY);
    lib.revoke.mockResolvedValue(libResult);
    expect(await revokeTreasuryRoleAction("s", { grantId: GRANT })).toEqual({ ok: false, error });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("ensureTreasuryRoleAction", () => {
  it("accepts only the two reimbursement templates", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await ensureTreasuryRoleAction("s", { templateKey: "giving_recorder" })).toMatchObject({ ok: false });
    expect(await ensureTreasuryRoleAction("s", { templateKey: "committee_chair" })).toMatchObject({ ok: false });
    expect(lib.ensure).not.toHaveBeenCalled();
  });

  it("audits the adoption (path: reimbursement_team) when it created or changed something, and passes the skipped keys back", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.ensure.mockResolvedValue({ kind: "ok", roleId: ROLE, roleKey: "reimbursement_clerk", templateRoleId: "t-1", created: true, reactivated: false, addedKeys: [], skippedKeys: ["reimbursement.pay"] });
    expect(await ensureTreasuryRoleAction("s", { templateKey: "reimbursement_clerk" })).toEqual({
      ok: true, data: { roleId: ROLE, skippedKeys: ["reimbursement.pay"] },
    });
    expect(lib.ensure).toHaveBeenCalledWith("reimbursement", "person-1", "org-1", { templateKey: "reimbursement_clerk" });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.role_definition.adopted_from_template", resourceType: "app_role", resourceId: ROLE,
      metadata: { organizationId: "org-1", roleKey: "reimbursement_clerk", templateRoleId: "t-1", templateKey: "reimbursement_clerk", created: true, reactivated: false, path: "reimbursement_team" },
    });
  });

  it("an unchanged role writes no audit row", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.ensure.mockResolvedValue({ kind: "ok", roleId: ROLE, roleKey: "treasurer", templateRoleId: "t-1", created: false, reactivated: false, addedKeys: [], skippedKeys: [] });
    expect(await ensureTreasuryRoleAction("s", { templateKey: "treasurer" })).toMatchObject({ ok: true });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "forbidden" }, "You don't have permission to manage the treasury team."],
    [{ kind: "template_not_found" }, "That role isn't available to set up. Contact support."],
    [{ kind: "not_treasury_only" }, "That role already exists with permissions outside Giving and Reimbursements. An administrator can fix it under Roles."],
    [{ kind: "escalation_denied", missingPermissions: ["reimbursement.manage"] }, "You can't set up a role with permissions you don't hold yourself: reimbursement.manage."],
  ])("maps %j to its sentence", async (libResult, error) => {
    gate.mockResolvedValue(IDENTITY);
    lib.ensure.mockResolvedValue(libResult);
    expect(await ensureTreasuryRoleAction("s", { templateKey: "treasurer" })).toEqual({ ok: false, error });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
