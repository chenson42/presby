/**
 * treasury/team.ts against a REAL Postgres connection - docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 P3-14 / F296 / EC31: the treasury team's
 * narrow delegation path on the REIMBURSEMENT surface (giving's own behavior is
 * pinned by src/lib/giving/team.db.test.ts, which exercises the same code
 * through the wrapper), and the pin between TREASURY_MODULES and the modules
 * that have F301 downward guards. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/treasury/team.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const SEVEN = [
  "giving.view", "giving.record", "giving.manage",
  "reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage",
];

describe.skipIf(!hasDb)("treasury/team.ts, reimbursement surface (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let team: typeof import("./team");
  let org: string;
  let otherOrg: string;
  let tess: { userId: string; personId: string }; // a treasurer: all seven keys
  let treasurerRole: string;
  let givingRecorderRole: string;
  let mixedRole: string;

  async function holds(personId: string, orgId: string, key: string): Promise<boolean> {
    const [r] = await fx.app(orgId, sql`select presby_has_permission(${personId}::uuid, ${orgId}::uuid, ${key}) as ok`);
    return r!.ok === true;
  }

  async function newMember(first: string, orgId = org) {
    return fx.member(orgId, first);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("treasury-team");
    team = await import("./team");

    org = await fx.makeOrg("a");
    otherOrg = await fx.makeOrg("b");
    treasurerRole = await fx.makeRole(org, "treasurer", SEVEN);
    givingRecorderRole = await fx.makeRole(org, "giving_recorder", ["giving.record"]);
    mixedRole = await fx.makeRole(org, "mixed", ["reimbursement.view", "directory.view"]);
    tess = await newMember("Tess");
    await fx.grant(org, treasurerRole, tess.personId);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  describe("grantTreasuryRole (F296: the treasurer names a second payer)", () => {
    it("hands the treasurer role to a successor, who then holds the pay key; the grant carries the surface's reason", async () => {
      const sam = await newMember("Sam");
      expect(await holds(sam.personId, org, "reimbursement.pay")).toBe(false);
      const result = await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, {
        roleId: treasurerRole, personId: sam.personId,
      });
      expect(result).toMatchObject({ kind: "ok" });
      if (result.kind !== "ok") return;
      const [row] = await fx.q(sql`select person_id, group_id, granted_by, grant_reason from role_grants where id = ${result.grantId}`);
      expect(row).toMatchObject({ person_id: sam.personId, group_id: null, granted_by: tess.userId, grant_reason: "reimbursement team" });
      expect(await holds(sam.personId, org, "reimbursement.pay")).toBe(true);
    });

    it("a second identical effective grant is already_granted, not a duplicate row", async () => {
      const pat = await newMember("Pat");
      const input = { roleId: treasurerRole, personId: pat.personId };
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, input)).toMatchObject({ kind: "ok" });
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, input)).toEqual({ kind: "already_granted" });
      expect(await fx.q(sql`select 1 from role_grants where role_id = ${treasurerRole} and person_id = ${pat.personId}`)).toHaveLength(1);
    });

    it("refuses a role carrying a key outside the treasury modules: not_treasury_only", async () => {
      const target = await newMember("Mixed");
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: mixedRole, personId: target.personId }))
        .toEqual({ kind: "not_treasury_only" });
    });

    it("refuses a treasury role with none of this surface's keys: it is the other surface's to grant", async () => {
      // A reimbursement.manage holder who ALSO holds giving.record must not be able
      // to hand out giving_recorder through the reimbursement gate.
      const target = await newMember("Other");
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: givingRecorderRole, personId: target.personId }))
        .toEqual({ kind: "invalid_role" });
      expect(await fx.q(sql`select 1 from role_grants where role_id = ${givingRecorderRole} and person_id = ${target.personId}`)).toHaveLength(0);
    });

    it("refuses another organization's role, an unknown role and a deactivated role: invalid_role", async () => {
      const target = await newMember("Elsewhere");
      const foreign = await fx.makeRole(otherOrg, "treasurer", SEVEN);
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: foreign, personId: target.personId })).toEqual({ kind: "invalid_role" });
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: "99999999-9999-4999-8999-999999999999", personId: target.personId })).toEqual({ kind: "invalid_role" });
      const retired = await fx.makeRole(org, "retired", ["reimbursement.view"]);
      await fx.q(sql`update app_roles set deactivated_at = now() where id = ${retired}`);
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: retired, personId: target.personId })).toEqual({ kind: "invalid_role" });
    });

    it("refuses a target with no current membership here: invalid_target", async () => {
      const elsewhere = await newMember("Away", otherOrg);
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: treasurerRole, personId: elsewhere.personId }))
        .toEqual({ kind: "invalid_target" });
      const ended = await newMember("Ended");
      await fx.q(sql`update memberships set ended_on = current_date - 1, ended_reason = 'test' where organization_id = ${org} and person_id = ${ended.personId}`);
      expect(await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: treasurerRole, personId: ended.personId }))
        .toEqual({ kind: "invalid_target" });
    });

    it("the subset rule runs unchanged: a manager without the other keys cannot hand out the treasurer role", async () => {
      const mgr = await newMember("Mgr");
      await fx.grant(org, await fx.makeRole(org, "manager_only", ["reimbursement.manage"]), mgr.personId);
      const target = await newMember("Target");
      const result = await team.grantTreasuryRole("reimbursement", mgr.personId, org, mgr.userId, { roleId: treasurerRole, personId: target.personId });
      expect(result).toMatchObject({ kind: "escalation_denied" });
      if (result.kind !== "escalation_denied") return;
      expect(result.missingPermissions.sort()).toEqual(SEVEN.filter((k) => k !== "reimbursement.manage").sort());
      expect(await holds(target.personId, org, "reimbursement.pay")).toBe(false);
    });

    it("needs reimbursement.manage on this surface: giving.manage alone, pay alone and a plain member are forbidden", async () => {
      const target = await newMember("Target2");
      const input = { roleId: treasurerRole, personId: target.personId };
      for (const [label, keys] of [
        ["giving manager", ["giving.manage"]],
        ["payer", ["reimbursement.pay"]],
        ["viewer", ["reimbursement.view"]],
      ] as const) {
        const actor = await newMember(label.replace(" ", ""));
        await fx.grant(org, await fx.makeRole(org, label.replace(" ", "_"), keys), actor.personId);
        expect(await team.grantTreasuryRole("reimbursement", actor.personId, org, actor.userId, input)).toEqual({ kind: "forbidden" });
      }
      const plain = await newMember("Plain");
      expect(await team.grantTreasuryRole("reimbursement", plain.personId, org, plain.userId, input)).toEqual({ kind: "forbidden" });
    });
  });

  describe("revokeTreasuryRole", () => {
    it("ends the grant (ends_on = today), never deletes it, and reports who and which role", async () => {
      const second = await newMember("Second");
      const granted = await team.grantTreasuryRole("reimbursement", tess.personId, org, tess.userId, { roleId: treasurerRole, personId: second.personId });
      if (granted.kind !== "ok") throw new Error("setup");
      const result = await team.revokeTreasuryRole("reimbursement", tess.personId, org, { grantId: granted.grantId });
      expect(result).toMatchObject({ kind: "ok", roleId: treasurerRole, personId: second.personId });
      const [row] = await fx.q(sql`select ends_on = current_date as today from role_grants where id = ${granted.grantId}`);
      expect(row!.today).toBe(true);
      expect(await holds(second.personId, org, "reimbursement.pay")).toBe(false);
      expect(await team.revokeTreasuryRole("reimbursement", tess.personId, org, { grantId: granted.grantId })).toEqual({ kind: "not_found" });
    });

    it("refuses to end the LAST effective reimbursement.manage grant, and allows it once another exists (EC31)", async () => {
      const lonelyOrg = await fx.makeOrg("lonely");
      const role = await fx.makeRole(lonelyOrg, "treasurer", SEVEN);
      const a = await newMember("Alone", lonelyOrg);
      const grantA = await fx.grant(lonelyOrg, role, a.personId);
      expect(await team.revokeTreasuryRole("reimbursement", a.personId, lonelyOrg, { grantId: grantA })).toEqual({ kind: "last_manager_blocked" });
      expect(await fx.q(sql`select 1 from role_grants where id = ${grantA} and ends_on is null`)).toHaveLength(1);
      const b = await newMember("Backup", lonelyOrg);
      await fx.grant(lonelyOrg, role, b.personId);
      expect(await team.revokeTreasuryRole("reimbursement", a.personId, lonelyOrg, { grantId: grantA })).toMatchObject({ kind: "ok" });
    });

    it("a group-arm grant or a mixed-key role can only be ended under Roles; a giving-only grant is not this surface's", async () => {
      const g = await fx.makeGroup(org, "Finance team");
      const [groupGrant] = await fx.q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${org}, ${treasurerRole}, ${g}, current_date - 1) returning id`);
      expect(await team.revokeTreasuryRole("reimbursement", tess.personId, org, { grantId: String(groupGrant!.id) })).toEqual({ kind: "not_treasury_only" });
      const mixedMember = await newMember("MixedMember");
      const mixedGrant = await fx.grant(org, mixedRole, mixedMember.personId);
      expect(await team.revokeTreasuryRole("reimbursement", tess.personId, org, { grantId: mixedGrant })).toEqual({ kind: "not_treasury_only" });
      const rec = await newMember("Recorder");
      const recGrant = await fx.grant(org, givingRecorderRole, rec.personId);
      expect(await team.revokeTreasuryRole("reimbursement", tess.personId, org, { grantId: recGrant })).toEqual({ kind: "not_found" });
    });

    it("never touches another organization's grant", async () => {
      const foreignRole = await fx.makeRole(otherOrg, "treasurer", SEVEN);
      const foreign = await newMember("Foreigner", otherOrg);
      const foreignGrant = await fx.grant(otherOrg, foreignRole, foreign.personId);
      expect(await team.revokeTreasuryRole("reimbursement", tess.personId, org, { grantId: foreignGrant })).toEqual({ kind: "not_found" });
    });
  });

  describe("listTreasuryTeam", () => {
    it("lists effective reimbursement grants, the assignable roles, current members and the missing templates; not giving-only roles", async () => {
      const listOrg = await fx.makeOrg("list");
      const role = await fx.makeRole(listOrg, "treasurer", SEVEN);
      const recorder = await fx.makeRole(listOrg, "giving_recorder", ["giving.record"]);
      const boss = await newMember("Lister", listOrg);
      await fx.grant(listOrg, role, boss.personId);
      const rec = await newMember("Rec", listOrg);
      await fx.grant(listOrg, recorder, rec.personId);

      const listed = await team.listTreasuryTeam("reimbursement", boss.personId, listOrg);
      expect(listed.kind).toBe("ok");
      if (listed.kind !== "ok") return;
      expect(listed.grants.map((g) => g.roleName)).toEqual(["treasurer"]);
      expect(listed.grants[0]).toMatchObject({ endableHere: true, ownKeys: ["reimbursement.manage", "reimbursement.pay", "reimbursement.request_for_others", "reimbursement.view"] });
      expect(listed.assignableRoles.map((r) => r.id)).toEqual([role]);
      // keyed on role.key, which the fixture suffixes: neither template key is "there" yet
      expect(listed.missingTemplates).toEqual(["treasurer", "reimbursement_clerk"]);
      expect(listed.people.map((p) => p.personId)).toContain(rec.personId);

      // and the giving surface lists the recorder but never the clerk template
      const givingView = await team.listTreasuryTeam("giving", boss.personId, listOrg);
      if (givingView.kind !== "ok") throw new Error("setup");
      expect(givingView.missingTemplates).toEqual(["treasurer", "giving_recorder"]);
      expect(givingView.grants.map((g) => g.roleName).sort()).toEqual(["giving_recorder", "treasurer"]);
    });

    it("is forbidden without reimbursement.manage", async () => {
      const plain = await newMember("Peeker");
      expect(await team.listTreasuryTeam("reimbursement", plain.personId, org)).toEqual({ kind: "forbidden" });
    });
  });

  describe("ensureTreasuryRole", () => {
    it("sets up the Reimbursement Clerk role from its template (custom, unprotected, that one key) because the treasurer holds it", async () => {
      const eOrg = await fx.makeOrg("ensure-clerk");
      const bossRole = await fx.makeRole(eOrg, "boss_role", SEVEN);
      const boss = await newMember("EnsClerk", eOrg);
      await fx.grant(eOrg, bossRole, boss.personId);
      const result = await team.ensureTreasuryRole("reimbursement", boss.personId, eOrg, { templateKey: "reimbursement_clerk" });
      expect(result).toMatchObject({ kind: "ok", roleKey: "reimbursement_clerk", created: true, reactivated: false, addedKeys: ["reimbursement.request_for_others"], skippedKeys: [] });
      if (result.kind !== "ok") return;
      const [role] = await fx.q(sql`select organization_id, role_kind, is_protected from app_roles where id = ${result.roleId}`);
      expect(role).toMatchObject({ organization_id: eOrg, role_kind: "custom", is_protected: false });
      // idempotent
      expect(await team.ensureTreasuryRole("reimbursement", boss.personId, eOrg, { templateKey: "reimbursement_clerk" }))
        .toMatchObject({ kind: "ok", created: false, reactivated: false, addedKeys: [], skippedKeys: [] });
      // and the clerk is now grantable to a member (a role of one key the treasurer holds)
      const clerk = await newMember("ClerkPerson", eOrg);
      expect(await team.grantTreasuryRole("reimbursement", boss.personId, eOrg, boss.userId, { roleId: result.roleId, personId: clerk.personId })).toMatchObject({ kind: "ok" });
      expect(await holds(clerk.personId, eOrg, "reimbursement.request_for_others")).toBe(true);
      expect(await holds(clerk.personId, eOrg, "reimbursement.pay")).toBe(false);
    });

    it("sets up the Treasurer role from its template (constitutional, protected, seven keys) only for an actor who holds all seven", async () => {
      const eOrg = await fx.makeOrg("ensure-treasurer");
      const bossRole = await fx.makeRole(eOrg, "boss_role", SEVEN);
      const boss = await newMember("EnsTreas", eOrg);
      await fx.grant(eOrg, bossRole, boss.personId);
      const made = await team.ensureTreasuryRole("reimbursement", boss.personId, eOrg, { templateKey: "treasurer" });
      expect(made).toMatchObject({ kind: "ok", created: true });
      if (made.kind !== "ok") return;
      const [role] = await fx.q(sql`select role_kind, is_protected from app_roles where id = ${made.roleId}`);
      expect(role).toMatchObject({ role_kind: "constitutional", is_protected: true });
      expect(made.addedKeys.sort()).toEqual([...SEVEN].sort());

      const lowOrg = await fx.makeOrg("ensure-low");
      const low = await newMember("EnsLow", lowOrg);
      await fx.grant(lowOrg, await fx.makeRole(lowOrg, "low", ["reimbursement.manage"]), low.personId);
      const denied = await team.ensureTreasuryRole("reimbursement", low.personId, lowOrg, { templateKey: "treasurer" });
      expect(denied.kind).toBe("escalation_denied");
      expect(await fx.q(sql`select 1 from app_roles where organization_id = ${lowOrg} and key = 'treasurer'`)).toHaveLength(0);
    });

    it("a manager who does not hold request_for_others cannot set up the clerk role (the subset rule)", async () => {
      const eOrg = await fx.makeOrg("ensure-noclerk");
      const low = await newMember("EnsNoClerk", eOrg);
      await fx.grant(eOrg, await fx.makeRole(eOrg, "low", ["reimbursement.manage"]), low.personId);
      expect(await team.ensureTreasuryRole("reimbursement", low.personId, eOrg, { templateKey: "reimbursement_clerk" }))
        .toEqual({ kind: "escalation_denied", missingPermissions: ["reimbursement.request_for_others"] });
    });

    it("reactivates a deactivated clerk role; will not revive an org role carrying a key outside the treasury modules", async () => {
      const eOrg = await fx.makeOrg("ensure-revive");
      const boss = await newMember("EnsRevive", eOrg);
      await fx.grant(eOrg, await fx.makeRole(eOrg, "boss_role", SEVEN), boss.personId);
      const [own] = await fx.q(sql`insert into app_roles (organization_id, key, name, role_kind, deactivated_at) values (${eOrg}, 'reimbursement_clerk', 'Reimbursement Clerk', 'custom', now()) returning id`);
      const result = await team.ensureTreasuryRole("reimbursement", boss.personId, eOrg, { templateKey: "reimbursement_clerk" });
      expect(result).toMatchObject({ kind: "ok", roleId: String(own!.id), created: false, reactivated: true, addedKeys: ["reimbursement.request_for_others"] });
      await fx.q(sql`insert into app_role_permissions (role_id, permission_key) values (${String(own!.id)}, 'directory.view')`);
      await fx.q(sql`update app_roles set deactivated_at = now() where id = ${String(own!.id)}`);
      expect(await team.ensureTreasuryRole("reimbursement", boss.personId, eOrg, { templateKey: "reimbursement_clerk" })).toEqual({ kind: "not_treasury_only" });
    });

    it("only the surface's own templates are reachable", async () => {
      expect(await team.ensureTreasuryRole("reimbursement", tess.personId, org, { templateKey: "giving_recorder" })).toEqual({ kind: "template_not_found" });
      expect(await team.ensureTreasuryRole("giving", tess.personId, org, { templateKey: "reimbursement_clerk" })).toEqual({ kind: "template_not_found" });
      expect(await team.ensureTreasuryRole("reimbursement", tess.personId, org, { templateKey: "committee_chair" })).toEqual({ kind: "template_not_found" });
      const plain = await newMember("EnsPlain");
      expect(await team.ensureTreasuryRole("reimbursement", plain.personId, org, { templateKey: "reimbursement_clerk" })).toEqual({ kind: "forbidden" });
    });
  });

  describe("residual 12 (Phase 3 amendment, ruling 4): the last-manager guard is per surface, so one surface's revoke can orphan the other module's manage key", () => {
    // CHARACTERIZATION. This pins a documented, accepted residual (paper, audited as
    // tenant.role.revoked, recoverable only through the platform operator, NOT
    // prevented). A future decision to add the stricter rule changes these tests on
    // purpose; until then they fail if the behaviour changes by accident.
    async function holders(orgId: string, key: string, people: string[]): Promise<string[]> {
      const out: string[] = [];
      for (const p of people) if (await holds(p, orgId, key)) out.push(p);
      return out;
    }

    it("ending the sole treasurer grant on the GIVING surface (another giving.manage holder remains) leaves reimbursement.manage with NO holder", async () => {
      const o = await fx.makeOrg("orphan-a");
      const sevenRole = await fx.makeRole(o, "treasurer", SEVEN);
      const givingManagerRole = await fx.makeRole(o, "giving_manager", ["giving.manage"]);
      const t = await newMember("Orphant", o);
      const g = await newMember("Givingmanager", o);
      const treasurerGrant = await fx.grant(o, sevenRole, t.personId);
      await fx.grant(o, givingManagerRole, g.personId);
      const everyone = [t.personId, g.personId];
      expect(await holders(o, "reimbursement.manage", everyone)).toEqual([t.personId]);

      // The giving surface only asks for ITS manage key: g still holds giving.manage after the revoke.
      const result = await team.revokeTreasuryRole("giving", g.personId, o, { grantId: treasurerGrant });
      expect(result).toMatchObject({ kind: "ok", roleKey: expect.stringContaining("treasurer"), personId: t.personId });

      expect(await holders(o, "reimbursement.manage", everyone)).toEqual([]);
      expect(await holders(o, "reimbursement.pay", everyone)).toEqual([]);
      expect(await holders(o, "giving.manage", everyone)).toEqual([g.personId]);
      // Nobody left can open the Treasury team page: the founder cannot repair it (F138).
      expect(await team.listTreasuryTeam("reimbursement", g.personId, o)).toEqual({ kind: "forbidden" });
      expect(await team.listTreasuryTeam("reimbursement", t.personId, o)).toEqual({ kind: "forbidden" });
      // The grant was ENDED, never deleted.
      const [row] = await fx.q(sql`select ends_on is not null as ended from role_grants where id = ${treasurerGrant}`);
      expect(row!.ended).toBe(true);
    });

    it("and the reverse: ending the sole treasurer grant on the REIMBURSEMENT surface (another reimbursement.manage holder remains) leaves giving.manage with NO holder", async () => {
      const o = await fx.makeOrg("orphan-b");
      const sevenRole = await fx.makeRole(o, "treasurer", SEVEN);
      const reimbManagerRole = await fx.makeRole(o, "reimb_manager", ["reimbursement.manage"]);
      const t = await newMember("Orphantwo", o);
      const m = await newMember("Reimbmanager", o);
      const treasurerGrant = await fx.grant(o, sevenRole, t.personId);
      await fx.grant(o, reimbManagerRole, m.personId);
      const everyone = [t.personId, m.personId];

      expect(await team.revokeTreasuryRole("reimbursement", m.personId, o, { grantId: treasurerGrant })).toMatchObject({ kind: "ok" });

      expect(await holders(o, "giving.manage", everyone)).toEqual([]);
      expect(await holders(o, "reimbursement.manage", everyone)).toEqual([m.personId]);
    });

    it("the guard still holds WITHIN a surface: with no other holder of the surface's own manage key the revoke is blocked", async () => {
      const o = await fx.makeOrg("orphan-c");
      const sevenRole = await fx.makeRole(o, "treasurer", SEVEN);
      const t = await newMember("Soleholder", o);
      const treasurerGrant = await fx.grant(o, sevenRole, t.personId);
      expect(await team.revokeTreasuryRole("giving", t.personId, o, { grantId: treasurerGrant })).toEqual({ kind: "last_manager_blocked" });
      expect(await team.revokeTreasuryRole("reimbursement", t.personId, o, { grantId: treasurerGrant })).toEqual({ kind: "last_manager_blocked" });
      expect(await holders(o, "reimbursement.manage", [t.personId])).toEqual([t.personId]);
    });
  });

  describe("the actions' template list is the library's", () => {
    it("TEAM_TEMPLATE_KEYS (pure, used by the Treasury team actions) equals TEAM_SURFACES.reimbursement.templateKeys", async () => {
      const { TEAM_TEMPLATE_KEYS } = await import("@/lib/reimbursement/keys");
      expect([...TEAM_TEMPLATE_KEYS]).toEqual([...team.TEAM_SURFACES.reimbursement.templateKeys]);
    });
  });

  describe("TREASURY_MODULES is pinned to the modules that have F301 downward guards (EC30)", () => {
    it("every module in the set has a presby_<module>_guard_downward_role function naming it, and no guarded module is missing", async () => {
      const { TREASURY_MODULES } = await import("./modules");
      const rows = await fx.q(sql`
        select proname, prosrc from pg_proc
         where proname ~ '^presby_[a-z_]+_guard_downward_role$'
           and pronamespace = 'public'::regnamespace`);
      const guarded = rows.map((r) => /^presby_([a-z_]+)_guard_downward_role$/.exec(String(r.proname))![1]!).sort();
      expect(guarded).toEqual([...TREASURY_MODULES].sort());
      for (const row of rows) {
        const guarded = /^presby_([a-z_]+)_guard_downward_role$/.exec(String(row.proname))![1]!;
        expect(String(row.prosrc)).toContain(`pm.module = '${guarded}'`);
      }
    });
  });
});
