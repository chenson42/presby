/**
 * drizzle/0066 on a REAL database: the derived-row guard (F240), the
 * derived-group guard (F245), the pair (D1, arch-A3), the shape of `groups`
 * (arch-A2, D9), the membership sync's raises, and the officer sync's catalog
 * contract (D10). Community Increment 3a, Batch A1, test file T-G
 * (docs/work-log/2026-10-22-founding-admin-directory-inc3.md, Phase 3
 * sections 4.4, 4.5 and 6.3; amendment A4.1, A4.3).
 *
 * The presby_app half of the same properties is also asserted in
 * scripts/membership-standing/test-rls-66.sql (blocks c, d, e, k). This file
 * adds what that suite cannot reach: the OWNER path (getPlatformDb() is the
 * table owner, which the owner test lets through), the stop-block replayed
 * against a scratch copy, the sync's missing-group raises, the officer sync's
 * `prosrc`, and the DerivedFromKey source pin (scan 4).
 *
 * Batch A2 added the handler-mapping test (EC-13; amendment D13 (a)): the
 * four shipped `has no derived group active_membership` handlers still map
 * the message 0066's sync raises for a missing Active Membership group, none
 * of them maps the All Current Records message, and the acceptance core,
 * driven end to end, fails loudly (and writes nothing) when only the second
 * group is missing.
 *
 * Not here, by design: T-G test 3 (groupSeedPlan lists all_memberships for
 * every type, and createOrganization binds calendar_viewer and throws when the
 * lookup misses) belongs to Batch B, which changed the plan. It landed in
 * `src/lib/org-provisioning.test.ts` (the pure plan and the real database) and
 * `src/lib/org-provisioning.plan.test.ts` (the throw-if-missing, with the
 * database faked so no production code has to be edited to prove it).
 *
 * Run with (serial):
 *   npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/db/domain/derived-group-guard.db.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rowsOf } from "@/lib/testing/invitation-fixture";
import type { MembershipStandingFixture } from "@/lib/testing/membership-standing-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const ROOT = process.cwd();
const drizzleFile = (pattern: RegExp, label: string): string => {
  const files = readdirSync(path.join(ROOT, "drizzle")).filter((f) => pattern.test(f));
  if (files.length !== 1) throw new Error(`expected one ${label}, found ${files.length}`);
  return readFileSync(path.join(ROOT, "drizzle", files[0]!), "utf8");
};
const M66_TEXT = drizzleFile(/^\d{4}_presby_membership_standing\.sql$/, "*_presby_membership_standing.sql");
const M68_TEXT = drizzleFile(/^\d{4}_presby_parishes\.sql$/, "*_presby_parishes.sql");
const DOMAIN_GROUPS = readFileSync(path.join(ROOT, "src/lib/db/domain/groups.ts"), "utf8");
const LIB_GROUPS = readFileSync(path.join(ROOT, "src/lib/groups.ts"), "utf8");
const PROVISIONING = readFileSync(path.join(ROOT, "src/lib/org-provisioning.ts"), "utf8");

const FIVE = ["active_membership", "all_memberships", "session", "diaconate", "deacons_moderator"];

function block(name: string): string {
  const start = M66_TEXT.indexOf(`-- BEGIN ${name}\n`);
  const end = M66_TEXT.indexOf(`-- END ${name}\n`);
  if (start < 0 || end < 0) throw new Error(`block ${name} not found in 0066`);
  return M66_TEXT.slice(start + `-- BEGIN ${name}\n`.length, end);
}

const quoted = (list: string) => [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
const unionMembers = (text: string) => [...text.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);

/** The five-kind list, from each of the texts scan 4 spans. */
export function kindLists(texts: { migration: string; domain: string; lib: string; provisioning: string }) {
  const mig = /groups_derived_kind_check\s+check \(derived_from is null or derived_from in \(([^)]*)\)\)/.exec(texts.migration);
  const dom = /"groups_derived_kind_check",\s*sql`\$\{t\.derivedFrom\} is null or \$\{t\.derivedFrom\} in \(([^)]*)\)`/.exec(texts.domain);
  const lib = /export type DerivedFromKey =([^;]*);/.exec(texts.lib);
  const plan = /function groupSeedPlan\([\s\S]*?derivedFrom: ([^;]*);/.exec(texts.provisioning);
  const bound = /boundToDerivedFrom: ([^;]*);/.exec(texts.provisioning);
  if (!mig || !dom || !lib || !plan || !bound) throw new Error("a kind list was not found");
  return {
    migration: quoted(mig[1]!),
    domain: quoted(dom[1]!),
    lib: unionMembers(lib[1]!),
    plan: unionMembers(plan[1]!),
    bound: unionMembers(bound[1]!),
  };
}

const asSet = (xs: string[]) => [...new Set(xs)].sort();

describe("scan 4: the derived-kind list is one closed set (arch-A2, D9, amendment A4.1 item 4)", () => {
  const texts = { migration: M66_TEXT, domain: DOMAIN_GROUPS, lib: LIB_GROUPS, provisioning: PROVISIONING };

  it("the 0066 CHECK lists exactly the five, in the decided order", () => {
    expect(kindLists(texts).migration).toEqual(FIVE);
  });

  it("the Drizzle CHECK, DerivedFromKey and groupSeedPlan's union equal it as sets; boundToDerivedFrom is a subset", () => {
    const k = kindLists(texts);
    expect(asSet(k.domain)).toEqual(asSet(k.migration));
    expect(asSet(k.lib)).toEqual(asSet(k.migration));
    expect(asSet(k.plan)).toEqual(asSet(k.migration));
    for (const key of k.bound) expect(k.migration).toContain(key);
  });

  it("0066's stop-block lists the same five", () => {
    const pre = block("preconditions");
    const m = /derived_from not in \(([^)]*)\)/.exec(pre);
    expect(m && quoted(m[1]!)).toEqual(FIVE);
  });

  it("0068's inserted seat kind is inside the list", () => {
    expect(M68_TEXT).toMatch(/'deacons_moderator'/);
    expect(FIVE).toContain("deacons_moderator");
  });

  it("the pin can fail: a sixth key in DerivedFromKey breaks set equality", () => {
    const offending = LIB_GROUPS.replace('| "all_memberships";', '| "all_memberships"\n  | "fixture_sixth_kind";');
    expect(offending).not.toBe(LIB_GROUPS);
    const k = kindLists({ ...texts, lib: offending });
    expect(asSet(k.lib)).not.toEqual(asSet(k.migration));
  });
});

describe.skipIf(!hasDb)("drizzle/0066 derived-row and derived-group guards (Postgres-backed)", () => {
  let fx: MembershipStandingFixture;
  let orgA: string; // the pair and the courts
  let orgB: string; // the pair
  let personA: string;
  let membershipA: string;
  let managedGroupA: string;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/membership-standing-fixture");
    fx = await mod.createMembershipStandingFixture("dg66");
    orgA = await fx.org("a", { courts: true });
    orgB = await fx.org("b");
    personA = await fx.person("Alma");
    membershipA = await fx.membership(orgA, personA, null, "regular");
    const [g] = await fx.q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source)
      values (${orgA}, ${fx.committeeTypeId}, ${`Managed ${fx.stamp}`}, 'managed') returning id`);
    managedGroupA = String(g!.id);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  const groupId = async (orgId: string, kind: string) => {
    const [row] = await fx.q(sql`select id from groups where organization_id = ${orgId} and derived_from = ${kind}`);
    return String(row!.id);
  };
  const derivedRowId = async (membershipId: string, kind: string) => {
    const [row] = await fx.q(sql`
      select gm.id from group_memberships gm join groups g on g.id = gm.group_id
       where gm.membership_id = ${membershipId} and g.derived_from = ${kind}`);
    return String(row!.id);
  };

  describe("T-G 1 and 2: the pair", () => {
    it("a presby_app insert of a derived active_membership group creates exactly one sibling, at its own organization, and no role, permission or grant", async () => {
      const orgN = await fx.bareOrg("pair");
      const [before] = await fx.q(sql`
        select (select count(*)::int from app_roles) as roles, (select count(*)::int from app_role_permissions) as perms,
               (select count(*)::int from role_grants) as grants,
               (select count(*)::int from groups where derived_from = 'all_memberships' and organization_id <> ${orgN}) as elsewhere`);
      await fx.asApp(orgN, async (tx) => {
        await tx.execute(sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
          values (${orgN}, ${fx.rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
      });
      const siblings = await fx.q(sql`
        select name, membership_source, is_protected, group_type_id::text as type
          from groups where organization_id = ${orgN} and derived_from = 'all_memberships'`);
      expect(siblings).toEqual([{ name: "All Current Records", membership_source: "derived", is_protected: true, type: fx.rosterTypeId }]);
      const [after] = await fx.q(sql`
        select (select count(*)::int from app_roles) as roles, (select count(*)::int from app_role_permissions) as perms,
               (select count(*)::int from role_grants) as grants,
               (select count(*)::int from groups where derived_from = 'all_memberships' and organization_id <> ${orgN}) as elsewhere`);
      expect(after).toEqual(before);
      expect((await fx.q(sql`select count(*)::int as n from groups where organization_id = ${orgB} and derived_from = 'all_memberships'`))[0]!.n).toBe(1);
    });

    it("neither application role may execute the pair, sync or guard functions", async () => {
      const rows = await fx.q(sql`
        select f, r, has_function_privilege(r, f, 'execute') as ok
          from unnest(array['presby_pair_derived_groups()', 'presby_sync_derived_membership_group()', 'presby_sync_derived_group()',
                            'presby_reject_derived_group_write()', 'presby_reject_derived_group_edit()',
                            'presby_memberships_guard_engagement()', 'presby_memberships_guard_roll_cache()']) f,
               unnest(array['presby_app', 'presby_platform']) r`);
      expect(rows).toHaveLength(14);
      expect(rows.filter((r) => r.ok)).toEqual([]);
    });

    it("T-G 6: a separate-statement fixture insert of all_memberships with on conflict do nothing adds no second row", async () => {
      await fx.q(sql`
        insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
        values (${orgB}, ${fx.rosterTypeId}, 'All Current Records', 'derived', 'all_memberships', true)
        on conflict (organization_id, derived_from) do nothing`);
      expect((await fx.q(sql`select count(*)::int as n from groups where organization_id = ${orgB} and derived_from = 'all_memberships'`))[0]!.n).toBe(1);
    });
  });

  describe("F240: group_memberships", () => {
    it("as presby_app: a self-labelled derived INSERT, an INSERT into a derived group, and ends_on / group_id / source UPDATEs of a derived row are refused", async () => {
      const amA = await groupId(orgA, "active_membership");
      const rowId = await derivedRowId(membershipA, "active_membership");
      await fx.appRolledBack(orgA, async (tx) => {
        const cases = [
          sql`insert into group_memberships (organization_id, group_id, person_id, source) values (${orgA}, ${managedGroupA}, ${personA}, 'derived')`,
          sql`insert into group_memberships (organization_id, group_id, person_id, source) values (${orgA}, ${amA}, ${personA}, 'derived')`,
          sql`update group_memberships set ends_on = current_date where id = ${rowId}`,
          sql`update group_memberships set group_id = ${managedGroupA}, source = 'managed' where id = ${rowId}`,
          sql`update group_memberships set starts_on = date '2000-01-01' where id = ${rowId}`,
          sql`update group_memberships set group_role = 'chair' where id = ${rowId}`,
        ];
        for (const c of cases) {
          const r = await fx.refused(tx, c);
          expect(r.code).toBe("23514");
          expect(r.message).toMatch(/^group_memberships: .*\(drizzle\/0066, F240\)$|^group_memberships: .* is a derived group; its roster projects from officer_terms$/);
        }
        // The first two have only the 0066 arm to refuse them.
        const self = await fx.refused(tx, cases[0]!);
        expect(self.message).toContain("F240");
        const into = await fx.refused(tx, cases[1]!);
        expect(into.message).toContain("F240");
      });
    });

    it("as presby_app: the four public-listing columns of a derived row stay writable; a managed row is untouched by the guard", async () => {
      const rowId = await derivedRowId(membershipA, "active_membership");
      await fx.appRolledBack(orgA, async (tx) => {
        const r = await tx.execute(sql`update group_memberships set public_display_order = 3, public_listed = false where id = ${rowId} returning id`);
        expect(rowsOf(r)).toHaveLength(1);
        await tx.execute(sql`insert into group_memberships (organization_id, group_id, person_id, source) values (${orgA}, ${managedGroupA}, ${personA}, 'managed')`);
        const u = await tx.execute(sql`update group_memberships set group_role = 'chair' where group_id = ${managedGroupA} and person_id = ${personA} returning id`);
        expect(rowsOf(u)).toHaveLength(1);
      });
    });

    it("the shipped DELETE refusal binds every role, the owner included (unchanged)", async () => {
      const rowId = await derivedRowId(membershipA, "all_memberships");
      await fx.appRolledBack(orgA, async (tx) => {
        const r = await fx.refused(tx, sql`delete from group_memberships where id = ${rowId}`);
        expect(r.message).toMatch(/cannot be deleted directly$/);
      });
      await fx.ownerRolledBack(async (tx) => {
        const r = await fx.refused(tx, sql`delete from group_memberships where id = ${rowId}`);
        expect(r.message).toMatch(/cannot be deleted directly$/);
      });
    });

    it("the OWNER path passes the new arm (the guard is an owner test, not a role list)", async () => {
      const rowId = await derivedRowId(membershipA, "active_membership");
      await fx.ownerRolledBack(async (tx) => {
        const r = await tx.execute(sql`update group_memberships set ends_on = current_date where id = ${rowId} returning id`);
        expect(rowsOf(r)).toHaveLength(1);
      });
    });

    it("both sync triggers' own writes pass when presby_app fires them (membership insert; Session and Board of Deacons terms)", async () => {
      await fx.appRolledBack(orgA, async (tx) => {
        const pid = (await fx.q(sql`select gen_random_uuid()::text as id`))[0]!.id as string;
        await tx.execute(sql`insert into people (id, first_name, last_name) values (${pid}, 'Fixture', ${`Synced${fx.stamp}`})`);
        await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgA}, ${pid}, 'regular')`);
        const rows = rowsOf(await tx.execute(sql`
          select g.derived_from from group_memberships gm join groups g on g.id = gm.group_id
           where gm.person_id = ${pid} and gm.ends_on is null order by 1`));
        expect(rows.map((r) => r.derived_from)).toEqual(["active_membership", "all_memberships"]);
        for (const [office, kind] of [["ruling_elder", "session"], ["deacon", "diaconate"]] as const) {
          await tx.execute(sql`insert into officer_terms (organization_id, person_id, office, starts_on) values (${orgA}, ${pid}, ${office}, date '2024-01-01')`);
          const seated = rowsOf(await tx.execute(sql`
            select count(*)::int as n from group_memberships gm join groups g on g.id = gm.group_id
             where gm.person_id = ${pid} and g.derived_from = ${kind} and gm.source = 'derived'`));
          expect(seated[0]!.n, `${office} materializes into ${kind}`).toBe(1);
        }
      });
    });
  });

  describe("F245: groups (T-G 4)", () => {
    it("as presby_app: no column of a derived group may change, and a managed group cannot become derived", async () => {
      const session = await groupId(orgA, "session");
      const am = await groupId(orgA, "active_membership");
      const all = await groupId(orgA, "all_memberships");
      await fx.appRolledBack(orgA, async (tx) => {
        const cases = [
          sql`update groups set membership_source = 'managed', derived_from = null where id = ${session}`,
          sql`update groups set derived_from = 'diaconate' where id = ${am}`,
          sql`update groups set is_protected = false where id = ${all}`,
          sql`update groups set group_type_id = ${fx.committeeTypeId} where id = ${all}`,
          sql`update groups set organization_id = ${orgB} where id = ${all}`,
          sql`update groups set membership_source = 'derived', derived_from = 'all_memberships' where id = ${managedGroupA}`,
        ];
        for (const c of cases) {
          const r = await fx.refused(tx, c);
          expect(r.code).toBe("23514");
          expect(r.message).toBe("groups: a derived group's identity is fixed; only the officer and membership records shape it (drizzle/0066, F245)");
        }
        // The shipped rename refusal binds unchanged.
        const rename = await fx.refused(tx, sql`update groups set name = 'Renamed' where id = ${session}`);
        expect(rename.message).toMatch(/its name, description, and meeting schedule are not editable directly$/);
        // A managed-group rename is allowed.
        const ok = await tx.execute(sql`update groups set name = ${`Renamed ${fx.stamp}`} where id = ${managedGroupA} returning id`);
        expect(rowsOf(ok)).toHaveLength(1);
      });
    });

    it("the OWNER may change a derived group's non-name columns (owner path); the name refusal still binds the owner", async () => {
      const all = await groupId(orgB, "all_memberships");
      await fx.ownerRolledBack(async (tx) => {
        const ok = await tx.execute(sql`update groups set is_protected = false, group_type_id = ${fx.committeeTypeId} where id = ${all} returning id`);
        expect(rowsOf(ok)).toHaveLength(1);
        const rename = await fx.refused(tx, sql`update groups set name = 'Renamed' where id = ${all}`);
        expect(rename.message).toMatch(/not editable directly$/);
      });
    });
  });

  describe("the shape of groups (T-G 5, EC-34, EC-37)", () => {
    it("a managed group with a derived_from, a derived group without one, and a sixth kind are refused by the CHECKs, on the owner path too", async () => {
      const orgS = await fx.bareOrg("shape");
      await fx.ownerRolledBack(async (tx) => {
        const managed = await fx.refused(tx, sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
          values (${orgS}, ${fx.committeeTypeId}, 'x', 'managed', 'session')`);
        expect([managed.code, managed.constraint]).toEqual(["23514", "groups_derived_pairing_check"]);
        const derived = await fx.refused(tx, sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
          values (${orgS}, ${fx.rosterTypeId}, 'x', 'derived', null)`);
        expect(derived.code).toBe("23514");
        expect(["groups_derived_pairing_check", "groups_derived_check"]).toContain(derived.constraint);
        const sixth = await fx.refused(tx, sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
          values (${orgS}, ${fx.rosterTypeId}, 'x', 'derived', 'fixture_sixth_kind')`);
        expect([sixth.code, sixth.constraint]).toEqual(["23514", "groups_derived_kind_check"]);
        // EC-37: the seat kind 0068 inserts is inside the list.
        const seat = await tx.execute(sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
          values (${orgS}, ${fx.rosterTypeId}, 'Board of Deacons Moderator', 'derived', 'deacons_moderator', true) returning id`);
        expect(rowsOf(seat)).toHaveLength(1);
      });
    });

    it("the stop-block raises with a count and no value when such a row exists (scratch copy, rolled back)", async () => {
      const orgS = await fx.bareOrg("stop");
      await fx.ownerRolledBack(async (tx) => {
        await tx.execute(sql`alter table groups drop constraint groups_derived_kind_check`);
        await tx.execute(sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
          values (${orgS}, ${fx.rosterTypeId}, 'x', 'derived', 'fixture_secret_kind')`);
        const r = await fx.refused(tx, sql.raw(block("preconditions")));
        expect(r.message).toBe("0066: 1 group(s) fall outside the derived-group shape; correct them before this migration can apply");
        expect(r.message).not.toContain("fixture_secret_kind");
      });
      // Rolled back: the CHECK is still there.
      expect((await fx.q(sql`select count(*)::int as n from pg_constraint where conname = 'groups_derived_kind_check' and convalidated`))[0]!.n).toBe(1);
    });
  });

  describe("the membership sync's raises (EC-13)", () => {
    it("with no groups at all, a membership write raises the SHIPPED active_membership message first (the four handlers still map it)", async () => {
      const orgZ = await fx.bareOrg("nogroups");
      const p = await fx.person("Nobody");
      await fx.ownerRolledBack(async (tx) => {
        const r = await fx.refused(tx, sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgZ}, ${p}, 'regular')`);
        expect(r.code).toBe("23503");
        expect(r.message).toBe(`organization ${orgZ} has no derived group active_membership; seed derived groups at org creation`);
      });
    });

    it("with active_membership but no all_memberships (pair trigger disabled), the write raises naming all_memberships", async () => {
      const orgY = await fx.bareOrg("halfpair");
      const p = await fx.person("Half");
      await fx.ownerRolledBack(async (tx) => {
        await tx.execute(sql`alter table groups disable trigger groups_pair_derived`);
        await tx.execute(sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
          values (${orgY}, ${fx.rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
        const r = await fx.refused(tx, sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgY}, ${p}, 'regular')`);
        expect(r.code).toBe("23503");
        expect(r.message).toBe(`organization ${orgY} has no derived group all_memberships; seed derived groups at org creation`);
        expect(r.message).not.toMatch(/has no derived group active_membership/);
      });
      expect((await fx.q(sql`select tgenabled from pg_trigger where tgname = 'groups_pair_derived'`))[0]!.tgenabled).toBe("O");
    });
  });

  describe("the four handlers keep mapping the common state, and nothing maps the new one (EC-13, D13 a; Batch A2)", () => {
    // The live handlers (amendment A2 row 4): the acceptance core (0065; the
    // token wrapper presby_accept_invitation only calls it), the two 0061
    // participant functions and 0062's decision. The sync raises the message.
    const HANDLERS = [
      "presby__accept_invitation_core",
      "presby_decide_roll_action",
      "presby_record_participant_action",
      "presby_void_participant_action",
    ];

    async function raised(setup: (orgId: string, tx: Parameters<Parameters<MembershipStandingFixture["ownerRolledBack"]>[0]>[0]) => Promise<void>, tag: string) {
      const orgId = await fx.bareOrg(tag);
      const p = await fx.person(tag);
      let message = "";
      await fx.ownerRolledBack(async (tx) => {
        await setup(orgId, tx);
        const r = await fx.refused(tx, sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgId}, ${p}, 'regular')`);
        expect(r.code).toBe("23503");
        message = r.message!;
      });
      return message;
    }

    it("exactly the four handlers and the sync name the shipped message in the live catalog", async () => {
      const rows = await fx.q(sql`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and position('has no derived group active_membership' in p.prosrc) > 0 order by 1`);
      expect(rows.map((r) => String(r.proname))).toEqual([...HANDLERS, "presby_sync_derived_membership_group"].sort());
    });

    it("each handler's LIKE pattern matches the message for a missing active_membership, and none matches the all_memberships message", async () => {
      const missingAm = await raised(async () => {}, "map-am");
      const missingAll = await raised(async (orgId, tx) => {
        await tx.execute(sql`alter table groups disable trigger groups_pair_derived`);
        await tx.execute(sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
          values (${orgId}, ${fx.rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
      }, "map-all");
      expect(missingAm).toMatch(/has no derived group active_membership/);
      expect(missingAll).toMatch(/has no derived group all_memberships/);

      for (const name of HANDLERS) {
        const [row] = await fx.q(sql`select prosrc from pg_proc where proname = ${name}`);
        const patterns = [...String(row!.prosrc).matchAll(/like '([^']*has no derived group active_membership[^']*)'/g)].map((m) => m[1]!);
        expect(patterns.length, `${name} has a handler`).toBeGreaterThan(0);
        for (const pattern of patterns) {
          const [m] = await fx.q(sql`select ${missingAm} like ${pattern} as am, ${missingAll} like ${pattern} as allm`);
          expect(m, `${name}: '${pattern}'`).toEqual({ am: true, allm: false });
        }
      }
    });

    it("end to end through the acceptance core: active_membership present, all_memberships missing -> the acceptance fails loudly (23503) and writes nothing", async () => {
      const { createInvitationFixture, FAKE_BCRYPT } = await import("@/lib/testing/invitation-fixture");
      const { pgCode, pgMessage } = await import("@/lib/testing/membership-standing-fixture");
      const inv = await createInvitationFixture("dg66h");
      try {
        const org = await inv.makeBareOrg("halfpair");
        // A committed half pair: the pair trigger is off only around this one
        // insert (serial suite), and back on in finally.
        await fx.platform.execute(sql`alter table groups disable trigger groups_pair_derived`);
        try {
          await fx.q(sql`
            insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
            values (${org}, ${fx.rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
        } finally {
          await fx.platform.execute(sql`alter table groups enable trigger groups_pair_derived`);
        }
        const operator = await inv.makeUser(inv.email("operator"));
        const address = inv.email("halfpair");
        const invitation = await inv.insertInvitation({ organizationId: org, purpose: "founding_administrator", email: address, createdByUserId: operator });
        const before = await inv.snapshot(org, address);

        let caught: unknown;
        try {
          await inv.accept(invitation.token, { passwordHash: FAKE_BCRYPT, firstName: "Marisol", lastName: "Quenby" });
        } catch (err) {
          caught = err;
        }
        expect(caught, "the acceptance must not succeed or map the state").toBeDefined();
        expect(pgCode(caught)).toBe("23503");
        expect(pgMessage(caught)).toBe(`organization ${org} has no derived group all_memberships; seed derived groups at org creation`);
        expect(await inv.snapshot(org, address)).toEqual(before);
        expect((await inv.invitation(invitation.id)).accepted_at).toBeNull();
      } finally {
        await inv.cleanup();
      }
      expect((await fx.q(sql`select tgenabled from pg_trigger where tgname = 'groups_pair_derived'`))[0]!.tgenabled).toBe("O");
    });
  });

  describe("the officer sync, altered never re-created (D10, EC-38; amendment A4.3)", () => {
    it("presby_sync_derived_group() is SECURITY DEFINER, search_path pinned, no arguments, and still carries 0068's deacons_moderator arm", async () => {
      const [row] = await fx.q(sql`
        select p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args, p.prosrc
          from pg_proc p where p.oid = 'presby_sync_derived_group()'::regprocedure`);
      expect(row!.prosecdef).toBe(true);
      expect(row!.proconfig).toEqual(["search_path=public, pg_temp"]);
      expect(row!.args).toBe("");
      expect(String(row!.prosrc)).toContain("when 'deacons_moderator' then 'deacons_moderator'");
    });

    it("0066 never re-creates it (create or replace would reset attributes and could drop 0068's arm)", () => {
      expect(M66_TEXT).not.toMatch(/create or replace function presby_sync_derived_group\b/);
      expect(M66_TEXT).toMatch(/alter function presby_sync_derived_group\(\) security definer set search_path = public, pg_temp;/);
    });
  });
});
