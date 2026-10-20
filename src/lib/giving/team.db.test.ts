/**
 * team.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, Phase 2 R3 / F138, Phase 3 P3-18): the giving
 * team's narrow delegation path, and the two regression guards that prove the
 * ORDINARY paths still refuse what they always did (G2 self-grant; the
 * DECISION-106 delta rule). Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/team.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));
// role-grants.ts / role-definitions.ts do not import the audit module, but keep
// the harness symmetrical with the other suites that pull in org-features.
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("team.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let team: typeof import("./team");
  let roleGrants: typeof import("@/lib/role-grants");
  let roleDefs: typeof import("@/lib/role-definitions");

  let org: string;
  let otherOrg: string;
  let rosterTypeId: string;
  // org-owned roles
  let treasurerRole: string; // view + record + manage
  let recorderRole: string; // record
  let mixedRole: string; // giving.record + directory.view  (NOT giving-only)
  let emptyRole: string;
  // people
  let tess: { personId: string; userId: string }; // treasurer
  let recorderPerson: string;
  let plainMember: string;
  let endedMember: string;

  async function q(query: ReturnType<typeof sql>) {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  async function grantRow(roleId: string, personId: string): Promise<string> {
    const [r] = await q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on) values (${org}, ${roleId}, ${personId}, current_date - 5) returning id`);
    return String(r!.id);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("team-db-test");
    team = await import("./team");
    roleGrants = await import("@/lib/role-grants");
    roleDefs = await import("@/lib/role-definitions");

    org = await fx.makeOrg("a", { givingToggle: true });
    otherOrg = await fx.makeOrg("b", { givingToggle: true });
    const [rt] = await q(sql`select id from group_types where key = 'roster'`);
    rosterTypeId = String(rt!.id);

    treasurerRole = await fx.makeRole(org, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
    recorderRole = await fx.makeRole(org, "giving_recorder", ["giving.record"]);
    mixedRole = await fx.makeRole(org, "mixed_role", ["giving.record", "directory.view"]);
    const [empty] = await q(sql`insert into app_roles (organization_id, key, name, role_kind) values (${org}, 'empty_role', 'empty_role', 'custom') returning id`);
    emptyRole = String(empty!.id);

    const tessPerson = await fx.makePerson("Tess", "Treasurer");
    await fx.addMember(org, tessPerson);
    await fx.grant(org, treasurerRole, tessPerson);
    tess = { personId: tessPerson, userId: await fx.linkUser(tessPerson, "tess") };

    recorderPerson = await fx.makePerson("Rex", "Recorder");
    await fx.addMember(org, recorderPerson);
    plainMember = await fx.makePerson("Pia", "Plain");
    await fx.addMember(org, plainMember);
    endedMember = await fx.makePerson("Edna", "Ended");
    await fx.addMember(org, endedMember);
    await q(sql`update memberships set ended_on = current_date - 1, ended_reason = 'test' where organization_id = ${org} and person_id = ${endedMember}`);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  // -----------------------------------------------------------------------
  describe("grantGivingRole (F138)", () => {
    it("a giving.manage holder grants giving_recorder to a member; the grant is person-arm, started today, with provenance", async () => {
      const result = await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: recorderRole, personId: recorderPerson });
      expect(result).toMatchObject({ kind: "ok", roleKey: "giving_recorder" });
      if (result.kind !== "ok") return;
      const [row] = await q(sql`select person_id, group_id, starts_on = current_date as today, granted_by, grant_reason from role_grants where id = ${result.grantId}`);
      expect(row).toMatchObject({ person_id: recorderPerson, group_id: null, today: true, granted_by: tess.userId, grant_reason: "giving team" });
    });

    it("hands the treasurer role to a successor (the whole point of F138)", async () => {
      const successor = await fx.makePerson("Sam", "Successor");
      await fx.addMember(org, successor);
      const result = await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: treasurerRole, personId: successor });
      expect(result).toMatchObject({ kind: "ok", roleKey: "treasurer" });
    });

    it("a second identical effective grant is already_granted, not a duplicate row", async () => {
      const again = await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: recorderRole, personId: recorderPerson });
      expect(again).toEqual({ kind: "already_granted" });
      const rows = await q(sql`select 1 from role_grants where role_id = ${recorderRole} and person_id = ${recorderPerson}`);
      expect(rows).toHaveLength(1);
    });

    it("refuses a role with a non-giving key or no keys: not_giving_only (send it through Roles)", async () => {
      expect(await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: mixedRole, personId: plainMember })).toEqual({ kind: "not_giving_only" });
      expect(await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: emptyRole, personId: plainMember })).toEqual({ kind: "not_giving_only" });
    });

    it("refuses a role from another organization, a deactivated role, and an unknown role: invalid_role", async () => {
      const foreignRole = await fx.makeRole(otherOrg, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
      expect(await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: foreignRole, personId: plainMember })).toEqual({ kind: "invalid_role" });
      expect(await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: "99999999-9999-4999-8999-999999999999", personId: plainMember })).toEqual({ kind: "invalid_role" });
      const retired = await fx.makeRole(org, "retired_giving", ["giving.record"]);
      await q(sql`update app_roles set deactivated_at = now() where id = ${retired}`);
      expect(await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: retired, personId: plainMember })).toEqual({ kind: "invalid_role" });
    });

    it("refuses a target with no current membership here: someone elsewhere, someone whose membership ended", async () => {
      const elsewhere = await fx.makePerson("Else", "Where");
      await fx.addMember(otherOrg, elsewhere);
      expect(await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: recorderRole, personId: elsewhere })).toEqual({ kind: "invalid_target" });
      expect(await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: recorderRole, personId: endedMember })).toEqual({ kind: "invalid_target" });
    });

    it("the subset check runs unchanged: a giving.manage holder who lacks giving.record cannot hand it out (escalation_denied)", async () => {
      const managerPerson = await fx.makePerson("Mia", "Manager");
      await fx.addMember(org, managerPerson);
      const managerRole = await fx.makeRole(org, "manager_only", ["giving.manage"]);
      await fx.grant(org, managerRole, managerPerson);
      const result = await team.grantGivingRole(managerPerson, org, await fx.linkUser(managerPerson, "mia"), { roleId: recorderRole, personId: plainMember });
      expect(result).toEqual({ kind: "escalation_denied", missingPermissions: ["giving.record"] });
      expect(await q(sql`select 1 from role_grants where role_id = ${recorderRole} and person_id = ${plainMember}`)).toHaveLength(0);
    });

    it("needs giving.manage: a recorder, a viewer and a plain member are refused", async () => {
      const viewerPerson = await fx.makePerson("Vic", "Viewer");
      await fx.addMember(org, viewerPerson);
      const viewerRole = await fx.makeRole(org, "viewer_only", ["giving.view"]);
      await fx.grant(org, viewerRole, viewerPerson);
      for (const actor of [recorderPerson, viewerPerson, plainMember]) {
        expect(await team.grantGivingRole(actor, org, tess.userId, { roleId: recorderRole, personId: plainMember })).toEqual({ kind: "forbidden" });
      }
    });
  });

  // -----------------------------------------------------------------------
  describe("the ordinary paths still refuse (regressions for the F138 neighbourhood)", () => {
    it("G2: a roles.manage + role_grants.manage holder WITHOUT giving keys cannot grant a giving role through grantRole()", async () => {
      const admin = await fx.makePerson("Ada", "Admin");
      await fx.addMember(org, admin);
      const adminRole = await fx.makeRole(org, "plain_admin", ["roles.manage", "role_grants.manage"]);
      await fx.grant(org, adminRole, admin);
      const adminUser = await fx.linkUser(admin, "ada");
      const result = await roleGrants.grantRole(admin, org, adminUser, { roleId: treasurerRole, target: { kind: "person", personId: plainMember } });
      expect(result).toMatchObject({ kind: "escalation_denied" });
      if (result.kind === "escalation_denied") {
        expect(result.missingPermissions.sort()).toEqual(["giving.manage", "giving.record", "giving.view"]);
      }
    });

    it("DECISION-106 delta: a roles.manage holder without giving.view cannot ADD it to a role (setRolePermissions)", async () => {
      const admin = await fx.makePerson("Rae", "RolesAdmin");
      await fx.addMember(org, admin);
      const adminRole = await fx.makeRole(org, "roles_admin", ["roles.manage"]);
      await fx.grant(org, adminRole, admin);
      const customRole = await fx.makeRole(org, "custom_for_delta", ["directory.view"]);
      const result = await roleDefs.setRolePermissions(admin, org, customRole, ["directory.view", "giving.view"]);
      expect(result).toEqual({ kind: "escalation_denied", missingPermissions: ["giving.view"] });
      const keys = await q(sql`select permission_key from app_role_permissions where role_id = ${customRole}`);
      expect(keys.map((k) => k.permission_key)).toEqual(["directory.view"]);
    });

    it("a roles.manage holder who DOES hold the key may add it (the delta rule, not a blanket ban)", async () => {
      const result = await roleDefs.setRolePermissions(tess.personId, org, await fx.makeRole(org, "tess_target", ["directory.view"]), ["directory.view", "giving.view"]);
      // tess holds giving.view but not roles.manage -> forbidden at the gate, proving which gate fired
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  // -----------------------------------------------------------------------
  describe("revokeGivingRole", () => {
    it("ends the grant (ends_on = today), never deletes it, and reports who and which role", async () => {
      const person = await fx.makePerson("Ravi", "Revoked");
      await fx.addMember(org, person);
      const grant = await team.grantGivingRole(tess.personId, org, tess.userId, { roleId: recorderRole, personId: person });
      if (grant.kind !== "ok") throw new Error("setup");
      const result = await team.revokeGivingRole(tess.personId, org, { grantId: grant.grantId });
      expect(result).toEqual({ kind: "ok", roleId: recorderRole, roleKey: "giving_recorder", personId: person });
      const [row] = await q(sql`select ends_on = current_date as ended_today from role_grants where id = ${grant.grantId}`);
      expect(row!.ended_today).toBe(true);
      // the person lost the permission at once
      const { withOrgContext } = await import("@/lib/authz");
      const { givingKeysInTx } = await import("./keys");
      const held = await withOrgContext(person, org, (tx) => givingKeysInTx(tx, { personId: person, organizationId: org }));
      expect(held).toEqual({ view: false, record: false, manage: false });
      expect(await team.revokeGivingRole(tess.personId, org, { grantId: grant.grantId })).toEqual({ kind: "not_found" });
    });

    it("refuses to end the LAST effective giving.manage grant, but ends one of two", async () => {
      const lonely = await fx.makeOrg("lonely", { givingToggle: true });
      const lonelyTreasurer = await fx.makeRole(lonely, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
      const boss = await fx.makePerson("Lone", "Boss");
      await fx.addMember(lonely, boss);
      const [g1] = await q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on) values (${lonely}, ${lonelyTreasurer}, ${boss}, current_date - 1) returning id`);
      expect(await team.revokeGivingRole(boss, lonely, { grantId: String(g1!.id) })).toEqual({ kind: "last_manager_blocked" });
      expect((await q(sql`select ends_on from role_grants where id = ${String(g1!.id)}`))[0]!.ends_on).toBeNull();

      const second = await fx.makePerson("Second", "Boss");
      await fx.addMember(lonely, second);
      const [g2] = await q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on) values (${lonely}, ${lonelyTreasurer}, ${second}, current_date - 1) returning id`);
      // either may now be ended - even by themselves
      expect((await team.revokeGivingRole(boss, lonely, { grantId: String(g1!.id) })).kind).toBe("ok");
      // and the survivor is now the last
      expect(await team.revokeGivingRole(second, lonely, { grantId: String(g2!.id) })).toEqual({ kind: "last_manager_blocked" });
    });

    it("counts a GROUP-arm giving.manage holder as an effective manager", async () => {
      const gOrg = await fx.makeOrg("grouped", { givingToggle: true });
      const mgrRole = await fx.makeRole(gOrg, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
      const direct = await fx.makePerson("Dir", "Ect");
      await fx.addMember(gOrg, direct);
      const [dg] = await q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on) values (${gOrg}, ${mgrRole}, ${direct}, current_date - 1) returning id`);

      const viaGroup = await fx.makePerson("Via", "Group");
      await fx.addMember(gOrg, viaGroup);
      const [grp] = await q(sql`insert into groups (organization_id, group_type_id, name, membership_source) values (${gOrg}, ${rosterTypeId}, 'Finance Team', 'managed') returning id`);
      await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on) values (${gOrg}, ${String(grp!.id)}, ${viaGroup}, 'member', 'managed', current_date - 30)`);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${gOrg}, ${mgrRole}, ${String(grp!.id)}, current_date - 1)`);

      // the direct holder CAN be ended: the group's member still manages
      expect((await team.revokeGivingRole(direct, gOrg, { grantId: String(dg!.id) })).kind).toBe("ok");
    });

    it("a group-arm grant, or a role with non-giving keys, can only be ended under Roles: not_giving_only", async () => {
      const gOrg = await fx.makeOrg("grouped2", { givingToggle: true });
      const mgrRole = await fx.makeRole(gOrg, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
      const mixed = await fx.makeRole(gOrg, "mixed", ["giving.record", "directory.view"]);
      const mgr = await fx.makePerson("Grp", "Manager");
      await fx.addMember(gOrg, mgr);
      await fx.grant(gOrg, mgrRole, mgr);
      const other = await fx.makePerson("Oth", "Er");
      await fx.addMember(gOrg, other);
      const [mixedGrant] = await q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on) values (${gOrg}, ${mixed}, ${other}, current_date - 1) returning id`);
      expect(await team.revokeGivingRole(mgr, gOrg, { grantId: String(mixedGrant!.id) })).toEqual({ kind: "not_giving_only" });

      const [grp] = await q(sql`insert into groups (organization_id, group_type_id, name, membership_source) values (${gOrg}, ${rosterTypeId}, 'Some Group', 'managed') returning id`);
      const [groupGrant] = await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${gOrg}, ${mgrRole}, ${String(grp!.id)}, current_date - 1) returning id`);
      expect(await team.revokeGivingRole(mgr, gOrg, { grantId: String(groupGrant!.id) })).toEqual({ kind: "not_giving_only" });
    });

    it("needs giving.manage and never touches another organization's grant", async () => {
      const grant = await grantRow(recorderRole, plainMember);
      expect(await team.revokeGivingRole(recorderPerson, org, { grantId: grant })).toEqual({ kind: "forbidden" });
      const foreignRole = await fx.makeRole(otherOrg, "giving_recorder", ["giving.record"]);
      const foreignPerson = await fx.makePerson("For", "Eigner");
      await fx.addMember(otherOrg, foreignPerson);
      const [foreign] = await q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on) values (${otherOrg}, ${foreignRole}, ${foreignPerson}, current_date - 1) returning id`);
      expect(await team.revokeGivingRole(tess.personId, org, { grantId: String(foreign!.id) })).toEqual({ kind: "not_found" });
    });
  });

  // -----------------------------------------------------------------------
  describe("listGivingTeam", () => {
    it("shows effective giving grants, the assignable giving-only roles, current members and the templates still missing", async () => {
      const lOrg = await fx.makeOrg("listing", { givingToggle: true });
      const role = await fx.makeRole(lOrg, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
      await fx.makeRole(lOrg, "also_mixed", ["giving.record", "directory.view"]);
      const mgr = await fx.makePerson("Lis", "Manager");
      await fx.addMember(lOrg, mgr);
      await fx.grant(lOrg, role, mgr);
      const ended = await fx.makePerson("Lis", "Ended");
      await fx.addMember(lOrg, ended);
      await q(sql`update memberships set ended_on = current_date - 1, ended_reason = 'test' where organization_id = ${lOrg} and person_id = ${ended}`);

      const listed = await team.listGivingTeam(mgr, lOrg);
      if (listed.kind !== "ok") throw new Error("setup");
      expect(listed.grants.map((g) => g.roleKey)).toEqual(["treasurer"]);
      expect(listed.grants[0]).toMatchObject({ endableHere: true, givingKeys: ["giving.manage", "giving.record", "giving.view"] });
      expect(listed.assignableRoles.map((r) => r.key)).toEqual(["treasurer"]); // the mixed role is not assignable here
      expect(listed.people.map((p) => p.personId)).toEqual([mgr]); // the ended member is not offered
      expect(listed.missingTemplates).toEqual(["giving_recorder"]);

      expect(await team.listGivingTeam(plainMember, org)).toEqual({ kind: "forbidden" });
    });

    it("marks a mixed-role grant as managed under Roles (not endable here)", async () => {
      const mOrg = await fx.makeOrg("listing2", { givingToggle: true });
      const mgrRole = await fx.makeRole(mOrg, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
      const mixed = await fx.makeRole(mOrg, "mixed", ["giving.record", "directory.view"]);
      const a = await fx.makePerson("Mix", "Holder");
      const b = await fx.makePerson("Mix", "Manager");
      await fx.addMember(mOrg, a);
      await fx.addMember(mOrg, b);
      await fx.grant(mOrg, mgrRole, b);
      await fx.grant(mOrg, mixed, a);
      const listed = await team.listGivingTeam(b, mOrg);
      if (listed.kind !== "ok") throw new Error("setup");
      expect(listed.grants.find((g) => g.roleKey === "mixed")).toMatchObject({ endableHere: false });
    });
  });

  // -----------------------------------------------------------------------
  describe("ensureGivingRole (P3-18)", () => {
    it("creates the org's giving_recorder from its template when there is none (kind and protected flag copied)", async () => {
      const eOrg = await fx.makeOrg("ensure1", { givingToggle: true });
      const fullRole = await fx.makeRole(eOrg, "treasurer", ["giving.view", "giving.record", "giving.manage"]);
      const boss = await fx.makePerson("Ens", "Boss");
      await fx.addMember(eOrg, boss);
      await fx.grant(eOrg, fullRole, boss);

      const result = await team.ensureGivingRole(boss, eOrg, { templateKey: "giving_recorder" });
      expect(result).toMatchObject({ kind: "ok", roleKey: "giving_recorder", created: true, reactivated: false, addedKeys: ["giving.record"], skippedKeys: [] });
      if (result.kind !== "ok") return;
      const [role] = await q(sql`select organization_id, key, role_kind, is_protected, deactivated_at from app_roles where id = ${result.roleId}`);
      expect(role).toMatchObject({ organization_id: eOrg, key: "giving_recorder", role_kind: "custom", is_protected: false, deactivated_at: null });
      const keys = await q(sql`select permission_key from app_role_permissions where role_id = ${result.roleId}`);
      expect(keys.map((k) => k.permission_key)).toEqual(["giving.record"]);

      // idempotent: a second call changes nothing
      const again = await team.ensureGivingRole(boss, eOrg, { templateKey: "giving_recorder" });
      expect(again).toMatchObject({ kind: "ok", created: false, reactivated: false, addedKeys: [], skippedKeys: [] });
    });

    it("creates the treasurer role from its template too (constitutional, protected), when the actor holds all three keys", async () => {
      const eOrg = await fx.makeOrg("ensure2", { givingToggle: true });
      const fullRole = await fx.makeRole(eOrg, "boss_role", ["giving.view", "giving.record", "giving.manage"]);
      const boss = await fx.makePerson("Ens", "Two");
      await fx.addMember(eOrg, boss);
      await fx.grant(eOrg, fullRole, boss);
      const result = await team.ensureGivingRole(boss, eOrg, { templateKey: "treasurer" });
      expect(result).toMatchObject({ kind: "ok", created: true });
      if (result.kind !== "ok") return;
      const [role] = await q(sql`select role_kind, is_protected from app_roles where id = ${result.roleId}`);
      expect(role).toMatchObject({ role_kind: "constitutional", is_protected: true });
    });

    it("reactivates a deactivated role and reconciles ADDITIVELY, only with keys the actor holds", async () => {
      const eOrg = await fx.makeOrg("ensure3", { givingToggle: true });
      const bossRole = await fx.makeRole(eOrg, "boss_role", ["giving.manage", "giving.record"]); // no giving.view
      const boss = await fx.makePerson("Ens", "Three");
      await fx.addMember(eOrg, boss);
      await fx.grant(eOrg, bossRole, boss);
      // the church's own treasurer role: deactivated, missing keys
      const own = await fx.makeRole(eOrg, "treasurer", ["giving.record"]);
      await q(sql`update app_roles set deactivated_at = now() where id = ${own}`);

      const result = await team.ensureGivingRole(boss, eOrg, { templateKey: "treasurer" });
      expect(result).toMatchObject({ kind: "ok", roleId: own, created: false, reactivated: true, addedKeys: ["giving.manage"], skippedKeys: ["giving.view"] });
      const [role] = await q(sql`select deactivated_at from app_roles where id = ${own}`);
      expect(role!.deactivated_at).toBeNull();
      const keys = await q(sql`select permission_key from app_role_permissions where role_id = ${own} order by 1`);
      expect(keys.map((k) => k.permission_key)).toEqual(["giving.manage", "giving.record"]); // never removed, never over-granted
    });

    it("a NEW role cannot carry a key its creator lacks: escalation_denied", async () => {
      const eOrg = await fx.makeOrg("ensure4", { givingToggle: true });
      const mgrOnly = await fx.makeRole(eOrg, "mgr", ["giving.manage"]);
      const boss = await fx.makePerson("Ens", "Four");
      await fx.addMember(eOrg, boss);
      await fx.grant(eOrg, mgrOnly, boss);
      expect(await team.ensureGivingRole(boss, eOrg, { templateKey: "giving_recorder" })).toEqual({
        kind: "escalation_denied",
        missingPermissions: ["giving.record"],
      });
      expect(await q(sql`select 1 from app_roles where organization_id = ${eOrg} and key = 'giving_recorder'`)).toHaveLength(0);
    });

    it("will not revive an org role that carries a non-giving key: not_giving_only", async () => {
      const eOrg = await fx.makeOrg("ensure5", { givingToggle: true });
      const fullRole = await fx.makeRole(eOrg, "boss_role", ["giving.view", "giving.record", "giving.manage"]);
      const boss = await fx.makePerson("Ens", "Five");
      await fx.addMember(eOrg, boss);
      await fx.grant(eOrg, fullRole, boss);
      const tampered = await fx.makeRole(eOrg, "giving_recorder", ["giving.record", "directory.view"]);
      await q(sql`update app_roles set deactivated_at = now() where id = ${tampered}`);
      expect(await team.ensureGivingRole(boss, eOrg, { templateKey: "giving_recorder" })).toEqual({ kind: "not_giving_only" });
      const [still] = await q(sql`select deactivated_at is not null as off from app_roles where id = ${tampered}`);
      expect(still!.off).toBe(true);
    });

    it("only the two giving templates are reachable, and only by a giving.manage holder", async () => {
      expect(await team.ensureGivingRole(tess.personId, org, { templateKey: "committee_chair" as never })).toEqual({ kind: "template_not_found" });
      expect(await team.ensureGivingRole(recorderPerson, org, { templateKey: "giving_recorder" })).toEqual({ kind: "forbidden" });
    });
  });
});
