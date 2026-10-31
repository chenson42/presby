/**
 * T-1 twin (Community Increment 2b, Batch A2): THE ANTI-FORK TEST.
 * Every scenario of designation-parity.db.test.ts, accepted IN PLACE
 * (presby_accept_in_place, drizzle/0065 section 13c) by a proven account with
 * an enrolled and verified second factor, must leave exactly the rows the
 * committed golden (designation-parity.golden.json) records for the token
 * path. Both presentations call presby__accept_invitation_core, so a fork in
 * what a designation writes fails here (docs/work-log/2026-10-22-founding-
 * admin-directory.md, "Phase 3 amendment 2" section 8.3 T-1, edge case E-18).
 *
 * This file NEVER writes the golden: only the token-path suite may, and only
 * with a recorded ruling. The presentation-specific outcomes (dead,
 * needs_second_factor) are accept-in-place.db.test.ts's.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/designation-parity-in-place.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rowsOf, type InvitationFixture, type Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
// Each scenario runs two full designations plus fixtures over remote Neon;
// the 20 s default was exceeded once on a cold pool.
vi.setConfig({ testTimeout: 60_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const GOLDEN_PATH = path.join(__dirname, "designation-parity.golden.json");

/** A short, DNS-label-safe org label (organizations_slug_format; <= 63 chars with the fixture's stamp). */
function orgLabel(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `p${h.toString(36)}`;
}

type OrgType = "congregation" | "presbytery" | "synod" | "general_assembly" | "new_worshiping_community";

interface DesignationState {
  roles: Array<{ key: string; name: string; roleKind: string; isProtected: boolean; active: boolean; permissions: string[] }>;
  grants: Array<{ roleKey: string; principal: string; grantedBy: string; grantReason: string | null; startsOn: string; endsOn: string | null }>;
  designee: { firstName: string; lastName: string; linkedToAccount: boolean; merged: boolean };
  membership: { engagementStatus: string; currentRoll: string | null; endedOn: string | null };
}

describe.skipIf(!hasDb)("designation effect in place equals the token path's golden (T-1 twin)", () => {
  let fx: InvitationFixture;
  let operator: string;
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, DesignationState>;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("parip");
    operator = fx.actingUserId;
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  /**
   * The in-place presentation, through the presby_app connection: the account
   * is made proven (owner-path stamp) and enrolled (a user_totp row), and the
   * caller asserts a verified factor, so the founding-administrator and
   * treasurer second-factor gate passes.
   */
  async function acceptInPlace(invitationId: string, userId: string): Promise<Row> {
    await fx.q(sql`update users set email_verified = clock_timestamp() where id = ${userId}`);
    await fx.q(sql`insert into user_totp (user_id, secret_ciphertext, enrolled_at)
                   values (${userId}, 'fixture-ciphertext', now()) on conflict (user_id) do nothing`);
    return fx.appDb.transaction(async (tx) =>
      rowsOf(await tx.execute(sql`select * from presby_accept_in_place(${invitationId}::uuid, ${userId}::uuid, true)`))[0]!,
    );
  }

  /** Everything a designation writes at `org`, normalized (no ids, no timestamps). */
  async function stateOf(org: string, designee: string): Promise<DesignationState> {
    const roles = await fx.q(sql`
      select r.key, r.name, r.role_kind, r.is_protected, r.deactivated_at is null as active,
             coalesce((select array_agg(p.permission_key::text order by p.permission_key collate "C")
                         from app_role_permissions p where p.role_id = r.id), array[]::text[]) as permissions
        from app_roles r where r.organization_id = ${org}
       order by r.key collate "C"`);
    const grants = await fx.q(sql`
      select r.key as role_key,
             case when g.person_id = ${designee} then 'designee' when g.person_id is null then 'group' else 'other' end as principal,
             case when g.granted_by = ${operator} then 'operator' when g.granted_by is null then 'none' else 'other' end as granted_by,
             g.grant_reason,
             case when g.starts_on = current_date then 'today' else g.starts_on::text end as starts_on,
             g.ends_on::text as ends_on
        from role_grants g join app_roles r on r.id = g.role_id
       where g.organization_id = ${org}
       order by r.key collate "C", 2, 5, 6`);
    const [person] = await fx.q(sql`
      select first_name, last_name, user_id is not null as linked, merged_into_id is not null as merged
        from people where id = ${designee}`);
    const [membership] = await fx.q(sql`
      select engagement_status, current_roll, ended_on::text as ended_on
        from memberships where person_id = ${designee} and organization_id = ${org}`);
    return {
      roles: roles.map((r) => ({
        key: String(r.key),
        name: String(r.name),
        roleKind: String(r.role_kind),
        isProtected: Boolean(r.is_protected),
        active: Boolean(r.active),
        permissions: (r.permissions as string[]).map(String),
      })),
      grants: grants.map((g) => ({
        roleKey: String(g.role_key),
        principal: String(g.principal),
        grantedBy: String(g.granted_by),
        grantReason: (g.grant_reason as string | null) ?? null,
        startsOn: String(g.starts_on),
        endsOn: (g.ends_on as string | null) ?? null,
      })),
      designee: {
        firstName: String(person!.first_name),
        lastName: String(person!.last_name),
        linkedToAccount: Boolean(person!.linked),
        merged: Boolean(person!.merged),
      },
      membership: {
        engagementStatus: String(membership!.engagement_status),
        currentRoll: (membership!.current_roll as string | null) ?? null,
        endedOn: (membership!.ended_on as string | null) ?? null,
      },
    };
  }

  function pin(name: string, sqlState: DesignationState) {
    expect(golden[name], `${name}: no golden entry`).toBeDefined();
    expect(sqlState, `${name}: in place vs the token path's committed golden`).toEqual(golden[name]);
  }

  /** F109 precondition: a deactivated org role (no live grants) carrying one extra key. */
  async function preexistingRole(
    org: string,
    key: string,
    name: string,
    kind: string,
    isProtected: boolean,
    permissions: string[],
  ) {
    await fx.q(sql`
      insert into app_roles (organization_id, key, name, role_kind, is_protected, deactivated_at)
      values (${org}, ${key}, ${name}, ${kind}, ${isProtected}, now())`);
    for (const k of permissions) {
      await fx.q(sql`
        insert into app_role_permissions (role_id, permission_key)
        select id, ${k} from app_roles where organization_id = ${org} and key = ${key}`);
    }
  }

  // -------------------------------------------------------------------------
  // Founding administrator
  // -------------------------------------------------------------------------

  /**
   * One FA scenario through the real acceptance path (existing account).
   * `prepare` builds the org-side preconditions; `existingPerson` links the
   * designee's account to a person already at the org.
   */
  async function faScenario(
    name: string,
    type: OrgType,
    options: { existingPerson?: boolean; prepare?: (org: string) => Promise<void> } = {},
  ) {
    const org = await fx.makeOrg(orgLabel(name), { organizationType: type });
    await options.prepare?.(org);
    const email = fx.email(orgLabel(name));
    const user = await fx.makeUser(email, { name: "Marisol Quenby" });
    if (options.existingPerson) {
      const p = await fx.makePerson("Marisol", "Quenby");
      await fx.addMember(org, p);
      await fx.linkUser(p, user);
    }
    const inv = await fx.insertInvitation({
      organizationId: org, purpose: "founding_administrator", email, createdByUserId: operator,
      firstName: "Marisol", lastName: "Quenby",
    });
    const r = await acceptInPlace(inv.id, user);
    expect(r.outcome, `${name}: in-place outcome`).toBe("accepted");
    expect(r.person_mode, `${name}: person mode`).toBe(options.existingPerson ? "existing_person" : "created_person");

    pin(name, await stateOf(org, String(r.person_id)));
  }

  it.each(["congregation", "presbytery", "synod", "general_assembly", "new_worshiping_community"] as const)(
    "founding administrator, created person, %s",
    async (type) => {
      await faScenario(`fa-created-${type}`, type);
    },
  );

  it("founding administrator, the account's existing person at the org (congregation)", async () => {
    await faScenario("fa-existing-person-congregation", "congregation", { existingPerson: true });
  });

  it("founding administrator, F109 reuse-and-reactivate with an additive-only reconcile (congregation)", async () => {
    await faScenario("fa-f109-congregation", "congregation", {
      prepare: async (org) => {
        // Both roles exist deactivated; each carries a key the congregation
        // added (events.manage / directory.view) that must survive.
        await preexistingRole(org, "founding_administrator", "Founding Administrator", "custom", false, ["people.manage", "events.manage"]);
        await preexistingRole(org, "congregation_stated_clerk", "Clerk of Session", "custom", false, ["directory.view"]);
      },
    });
  });

  it("founding administrator, F109 reuse at a presbytery (the office role keeps its congregation-chosen name)", async () => {
    await faScenario("fa-f109-presbytery", "presbytery", {
      prepare: async (org) => {
        await preexistingRole(org, "presbytery_stated_clerk", "Stated Clerk (renamed)", "custom", false, []);
      },
    });
  });

  // -------------------------------------------------------------------------
  // Treasurer
  // -------------------------------------------------------------------------

  async function trScenario(name: string, type: "congregation" | "new_worshiping_community", prepare?: (org: string) => Promise<void>) {
    const org = await fx.makeOrg(orgLabel(name), { organizationType: type });
    await prepare?.(org);
    const person = await fx.makePerson("Odalys", "Pennick");
    await fx.addMember(org, person);
    const email = fx.email(orgLabel(name));
    const user = await fx.makeUser(email);
    await fx.linkUser(person, user);
    await fx.addEmail(person, email);
    const inv = await fx.insertInvitation({
      organizationId: org, purpose: "treasurer", email, createdByUserId: operator, personId: person,
    });
    const r = await acceptInPlace(inv.id, user);
    expect(r.outcome, `${name}: in-place outcome`).toBe("accepted");

    pin(name, await stateOf(org, person));
  }

  it.each(["congregation", "new_worshiping_community"] as const)("treasurer, %s", async (type) => {
    await trScenario(`tr-${type}`, type);
  });

  it("treasurer, F109 reuse-and-reactivate of both roles with an additive-only reconcile", async () => {
    await trScenario("tr-f109-congregation", "congregation", async (org) => {
      await preexistingRole(org, "treasurer", "Treasurer", "constitutional", true, ["directory.view"]);
      await preexistingRole(org, "giving_recorder", "Giving Recorder (ours)", "custom", false, []);
    });
  });

  it("the golden snapshot covers exactly the scenarios this file runs (no stale entries)", () => {
    expect(Object.keys(golden).sort()).toEqual(
      [
        "fa-created-congregation",
        "fa-created-general_assembly",
        "fa-created-new_worshiping_community",
        "fa-created-presbytery",
        "fa-created-synod",
        "fa-existing-person-congregation",
        "fa-f109-congregation",
        "fa-f109-presbytery",
        "tr-congregation",
        "tr-f109-congregation",
        "tr-new_worshiping_community",
      ].sort(),
    );
  });

});
