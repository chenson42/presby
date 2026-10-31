/**
 * The 2FA agreement matrix (R4, DECISION-170/175, F140).
 *
 * drizzle/0055 section 18 gives presby_two_factor_required() an arm B that
 * re-implements presby_effective_permissions()'s four arms INLINE (the
 * resolver needs an org context sign-in does not have). This is the writeable
 * form of "agrees on every arm": for each scenario, the predicate's answer must
 * equal what the REAL resolver says - called on the presby_app connection
 * under each of the user's active memberships - OR'd with the org policy
 * (arm A).
 *
 * Arms 3 (administrative commission) and 4 (delegation) cannot carry a giving
 * key at all - DECISION-175's triggers refuse it - so they are exercised with
 * a throwaway NON-giving key that this suite marks requires_two_factor for its
 * own lifetime. That is exactly the scenario F140 worries about: a future
 * tier-3 extension (S2) would put such keys on those arms.
 *
 * F343 (DECISION-291, S1) adds scenarios with the three REAL administration keys
 * 0080 flagged (roles.manage direct, role_grants.manage on a commission,
 * domains.manage on a delegation and through a group), so the agreement is
 * proven for the keys that matter in production and not only the temporary one.
 *
 * Every number here is asserted twice: against the resolver (agreement) and
 * against the scenario's known answer (so the matrix cannot pass vacuously).
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/two-factor-agreement.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;

describe.skipIf(!hasDb)("presby_two_factor_required() arm B agrees with presby_effective_permissions()", () => {
  let fx: GivingFixture;
  let appDb: typeof import("@/lib/db").db;
  const tempKey = `fx2fa.agreement_${Date.now()}`;

  let orgT: string; // the congregation (target / grantor)
  let orgP: string; // the presbytery (commission parent / delegation grantee)
  let orgPolicy: string; // a congregation with require_two_factor on
  let rosterTypeId: string;

  const scenarios: Array<{ name: string; userId: string; expected: boolean }> = [];

  async function q(query: ReturnType<typeof sql>): Promise<Row[]> {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  async function role(org: string, key: string, permissionKeys: string[]): Promise<string> {
    return fx.makeRole(org, `${key}_${Date.now()}${Math.floor(Math.random() * 1000)}`, permissionKeys);
  }

  async function group(org: string, name: string): Promise<string> {
    const [g] = await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source)
      values (${org}, ${rosterTypeId}, ${name}, 'managed') returning id`);
    return String(g!.id);
  }

  // membership_id stays NULL: it is unique, and it is the derived Active
  // Membership row's link (drizzle/0017). group_memberships_person_fk still
  // requires the person to hold a membership at the group's org.
  async function joinGroup(org: string, groupId: string, personId: string, opts: { endsOn?: string } = {}) {
    await q(sql`
      insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on, ends_on)
      values (${org}, ${groupId}, ${personId}, 'member', 'managed', current_date - 30, ${opts.endsOn ?? null})`);
  }

  /** A person's SECOND membership goes through the claim GUC presby_guard_membership_insert() checks. */
  async function addAnotherMembership(org: string, personId: string) {
    await fx.platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.person_claim_authorized', ${personId}, true)`);
      await tx.execute(sql`
        insert into memberships (organization_id, person_id, engagement_status)
        values (${org}, ${personId}, 'regular')`); // no current_roll: one active roll per person (memberships_one_active_roll_idx)
    });
  }

  async function personWithUser(first: string, last: string): Promise<{ personId: string; userId: string }> {
    const personId = await fx.makePerson(first, last);
    const userId = await fx.linkUser(personId, last.toLowerCase());
    return { personId, userId };
  }

  async function directGrant(org: string, roleId: string, personId: string, startsOn: string, endsOn: string | null) {
    await q(sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, ends_on)
      values (${org}, ${roleId}, ${personId}, ${startsOn}::date, ${endsOn}::date)`);
  }

  /** The predicate, on the tenant connection with NO org context (as at sign-in). */
  async function predicate(userId: string): Promise<boolean> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', '', true)`);
      const [r] = fx.rowsOf(await tx.execute(sql`select presby_two_factor_required(${userId}) as v`));
      return Boolean(r!.v);
    });
  }

  /** The REAL resolver, per active membership, plus arm A's org policy. */
  async function resolverSays(userId: string): Promise<boolean> {
    return appDb.transaction(async (tx) => {
      const orgs = fx.rowsOf(
        await tx.execute(sql`select organization_id::text as org, person_id::text as person
                               from presby_user_organizations(${userId}) where ended_on is null`),
      );
      let required = false;
      for (const { org, person } of orgs) {
        await tx.execute(sql`select set_config('app.current_org_id', ${String(org)}, true)`);
        const [r] = fx.rowsOf(
          await tx.execute(sql`
            select exists (select 1 from presby_effective_permissions(${String(person)}::uuid, ${String(org)}::uuid) e
                             join permissions pm on pm.key = e.permission_key and pm.requires_two_factor)
                or coalesce((select s.require_two_factor from organization_settings s
                              where s.organization_id = ${String(org)}::uuid), false) as v`),
        );
        required = required || Boolean(r!.v);
      }
      return required;
    });
  }

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    const { createGivingFixture } = await import("@/lib/testing/giving-fixture");
    fx = await createGivingFixture("tfa-agreement");
    await q(sql`insert into permissions (key, module, description, sensitivity_tier, requires_two_factor)
                values (${tempKey}, 'fx2fa', 'Two-factor agreement test key (temporary)', 1, true)`);
    const [rt] = await q(sql`select id from group_types where key = 'roster'`);
    rosterTypeId = String(rt!.id);

    orgT = await fx.makeOrg("t", { timeZone: "America/New_York" });
    orgP = await fx.makeOrg("p", { organizationType: "presbytery", timeZone: "America/New_York" });
    orgPolicy = await fx.makeOrg("policy", { timeZone: "America/New_York" });
    await q(sql`update organization_settings set require_two_factor = true where organization_id = ${orgPolicy}`);

    const givingRole = await role(orgT, "fx_treasurer", ["giving.view", "giving.record", "giving.manage"]);
    const plainRole = await role(orgT, "fx_plain", ["events.view"]);
    const add = (name: string, userId: string, expected: boolean) => scenarios.push({ name, userId, expected });

    // Arm 1: direct.
    {
      const s = await personWithUser("Direct", "Current");
      await fx.addMember(orgT, s.personId);
      await directGrant(orgT, givingRole, s.personId, "2020-01-01", null);
      add("direct grant, current", s.userId, true);
    }
    {
      const s = await personWithUser("Direct", "Expired");
      await fx.addMember(orgT, s.personId);
      await directGrant(orgT, givingRole, s.personId, "2020-01-01", "2021-01-01");
      add("direct grant, expired", s.userId, false);
    }
    {
      const s = await personWithUser("Direct", "Future");
      await fx.addMember(orgT, s.personId);
      await directGrant(orgT, givingRole, s.personId, "2999-01-01", null);
      add("direct grant, future-dated", s.userId, false);
    }
    {
      const s = await personWithUser("Direct", "Ends Today");
      await fx.addMember(orgT, s.personId);
      const [today] = await q(sql`select current_date::text as d`);
      await directGrant(orgT, givingRole, s.personId, "2020-01-01", String(today!.d));
      add("direct grant ending today (ends_on is exclusive)", s.userId, false);
    }
    {
      const s = await personWithUser("Direct", "Nongiving");
      await fx.addMember(orgT, s.personId);
      await directGrant(orgT, plainRole, s.personId, "2020-01-01", null);
      add("direct grant of a non-2FA key only", s.userId, false);
    }

    // Arm 2: via group.
    {
      const g = await group(orgT, "Giving Team");
      const s = await personWithUser("Group", "Current");
      await fx.addMember(orgT, s.personId);
      await joinGroup(orgT, g, s.personId);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${orgT}, ${givingRole}, ${g}, '2020-01-01')`);
      add("group arm, current", s.userId, true);

      const ended = await personWithUser("Group", "Left Group");
      await fx.addMember(orgT, ended.personId);
      await joinGroup(orgT, g, ended.personId, { endsOn: "2021-01-01" });
      add("group arm, group membership ended", ended.userId, false);
    }
    {
      const g = await group(orgT, "Old Giving Team");
      const s = await personWithUser("Group", "Grant Expired");
      await fx.addMember(orgT, s.personId);
      await joinGroup(orgT, g, s.personId);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on, ends_on)
                  values (${orgT}, ${givingRole}, ${g}, '2020-01-01', '2021-01-01')`);
      add("group arm, grant expired", s.userId, false);
    }

    // Arm 3: administrative commission (a NON-giving 2FA key; giving keys are refused there - DECISION-175).
    {
      const commissionRole = await role(orgP, "fx_commission", [tempKey]);
      const g = await group(orgP, "Administrative Commission");
      const s = await personWithUser("Commission", "Current");
      await fx.addMember(orgT, s.personId);
      await addAnotherMembership(orgP, s.personId);
      await joinGroup(orgP, g, s.personId);
      await q(sql`insert into administrative_commissions (parent_org_id, target_org_id, scope, role_id, starts_on, group_id)
                  values (${orgP}, ${orgT}, 'full', ${commissionRole}, '2020-01-01', ${g})`);
      add("commission arm, current", s.userId, true);

      const g2 = await group(orgP, "Old Commission");
      const old = await personWithUser("Commission", "Expired");
      await fx.addMember(orgT, old.personId);
      await addAnotherMembership(orgP, old.personId);
      await joinGroup(orgP, g2, old.personId);
      await q(sql`insert into administrative_commissions (parent_org_id, target_org_id, scope, role_id, starts_on, ends_on, group_id)
                  values (${orgP}, ${orgT}, 'full', ${commissionRole}, '2020-01-01', '2021-01-01', ${g2})`);
      add("commission arm, expired", old.userId, false);
    }

    // Arm 4: delegation (grantor = the congregation, group at the grantee).
    {
      const delegationRole = await role(orgP, "fx_delegation", [tempKey]);
      const g = await group(orgP, "Delegated Admins");
      const s = await personWithUser("Delegation", "Current");
      await fx.addMember(orgT, s.personId);
      await addAnotherMembership(orgP, s.personId);
      await joinGroup(orgP, g, s.personId);
      await q(sql`insert into org_delegations (grantor_org_id, grantee_org_id, role_id, starts_on, group_id)
                  values (${orgT}, ${orgP}, ${delegationRole}, '2020-01-01', ${g})`);
      add("delegation arm, current", s.userId, true);

      const g2 = await group(orgP, "Revoked Delegates");
      const r = await personWithUser("Delegation", "Revoked");
      await fx.addMember(orgT, r.personId);
      await addAnotherMembership(orgP, r.personId);
      await joinGroup(orgP, g2, r.personId);
      await q(sql`insert into org_delegations (grantor_org_id, grantee_org_id, role_id, starts_on, group_id, revoked_at)
                  values (${orgT}, ${orgP}, ${delegationRole}, '2020-01-01', ${g2}, now())`);
      add("delegation arm, revoked", r.userId, false);
    }

    // F343 / DECISION-291 (S1): the same arms with REAL flagged keys - the three
    // administration keys 0080 marks requires_two_factor - not only the throwaway
    // key above. Arms 3 and 4 refuse giving keys (DECISION-175) but not these.
    {
      const s = await personWithUser("Roles", "Manager");
      await fx.addMember(orgT, s.personId);
      const rolesRole = await role(orgT, "fx_roles_manage", ["roles.manage"]);
      await directGrant(orgT, rolesRole, s.personId, "2020-01-01", null);
      add("real key: direct roles.manage", s.userId, true);
    }
    {
      const commissionRole = await role(orgP, "fx_commission_real", ["role_grants.manage"]);
      const g = await group(orgP, "Real-Key Commission");
      const s = await personWithUser("RealCommission", "Current");
      await fx.addMember(orgT, s.personId);
      await addAnotherMembership(orgP, s.personId);
      await joinGroup(orgP, g, s.personId);
      await q(sql`insert into administrative_commissions (parent_org_id, target_org_id, scope, role_id, starts_on, group_id)
                  values (${orgP}, ${orgT}, 'full', ${commissionRole}, '2020-01-01', ${g})`);
      add("real key: commission arm carrying role_grants.manage", s.userId, true);
    }
    {
      const delegationRole = await role(orgP, "fx_delegation_real", ["domains.manage"]);
      const g = await group(orgP, "Real-Key Delegates");
      const s = await personWithUser("RealDelegation", "Current");
      await fx.addMember(orgT, s.personId);
      await addAnotherMembership(orgP, s.personId);
      await joinGroup(orgP, g, s.personId);
      await q(sql`insert into org_delegations (grantor_org_id, grantee_org_id, role_id, starts_on, group_id)
                  values (${orgT}, ${orgP}, ${delegationRole}, '2020-01-01', ${g})`);
      add("real key: delegation arm carrying domains.manage", s.userId, true);
    }
    {
      const g = await group(orgT, "Domain Managers");
      const domainsRole = await role(orgT, "fx_domains_manage", ["domains.manage"]);
      const s = await personWithUser("Domains", "ViaGroup");
      await fx.addMember(orgT, s.personId);
      await joinGroup(orgT, g, s.personId);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${orgT}, ${domainsRole}, ${g}, '2020-01-01')`);
      add("real key: group arm carrying domains.manage", s.userId, true);
    }

    // Membership-level cases.
    {
      const g = await group(orgT, "Ended Members Team");
      const s = await personWithUser("Membership", "Ended");
      await fx.addMember(orgT, s.personId);
      await joinGroup(orgT, g, s.personId);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${orgT}, ${givingRole}, ${g}, '2020-01-01')`);
      await q(sql`update memberships set ended_on = current_date - 1, ended_reason = 'moved'
                  where organization_id = ${orgT} and person_id = ${s.personId}`);
      add("membership ended (the group grant still resolves, but not at an active membership)", s.userId, false);
    }
    {
      // Tombstone FIRST: the fixture deletes people in creation order, and the
      // tombstone's merged_into_id must be gone before its survivor is.
      const s = await personWithUser("Merge", "Tombstone");
      const survivor = await fx.makePerson("Merge", "Survivor");
      await fx.addMember(orgT, s.personId);
      await directGrant(orgT, givingRole, s.personId, "2020-01-01", null);
      await q(sql`update people set merged_into_id = ${survivor} where id = ${s.personId}`);
      add("merged person (a tombstone signs in as nobody)", s.userId, false);
    }
    {
      const orgSecond = await fx.makeOrg("second", { timeZone: "America/New_York" });
      const secondRole = await role(orgSecond, "fx_second", ["giving.view"]);
      const s = await personWithUser("Two", "Memberships");
      await fx.addMember(orgT, s.personId);
      await addAnotherMembership(orgSecond, s.personId);
      await directGrant(orgSecond, secondRole, s.personId, "2020-01-01", null);
      add("two memberships, the key held at the second", s.userId, true);
    }
    {
      const s = await personWithUser("Policy", "Only");
      await fx.addMember(orgPolicy, s.personId);
      add("arm A only (org policy on, no keys)", s.userId, true);
    }
    {
      const s = await personWithUser("Nobody", "Required");
      await fx.addMember(orgT, s.personId);
      add("no policy, no keys", s.userId, false);
    }
  }, 120_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
    if (fx) await q(sql`delete from permissions where key = ${tempKey}`);
  }, 120_000);

  it("covers every resolver arm with a current and a lapsed case", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(21);
    expect(scenarios.filter((s) => s.expected).length).toBeGreaterThanOrEqual(10);
  });

  it("each scenario: the predicate equals the scenario's known answer AND the real resolver's", async () => {
    const results: Array<{ name: string; predicate: boolean; resolver: boolean; expected: boolean }> = [];
    for (const s of scenarios) {
      results.push({
        name: s.name,
        predicate: await predicate(s.userId),
        resolver: await resolverSays(s.userId),
        expected: s.expected,
      });
    }
    for (const r of results) {
      expect({ name: r.name, value: r.predicate }).toEqual({ name: r.name, value: r.expected });
      expect({ name: r.name, value: r.resolver }).toEqual({ name: r.name, value: r.predicate });
    }
  });

  it("every seed-dev fixture user agrees too (no fixture sign-in changes meaning unexpectedly)", async () => {
    const users = await q(sql`
      select distinct p.user_id::text as id from people p
       where p.user_id is not null and p.merged_into_id is null and p.deletable_until is null`);
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      const id = String(u.id);
      expect({ id, value: await predicate(id) }).toEqual({ id, value: await resolverSays(id) });
    }
  });
});
