/**
 * drizzle/0060_presby_designation_revoke.sql on a REAL Postgres connection
 * (docs/work-log/2026-10-22-designation-revoke.md, Phase 3 Test Plan,
 * Batch A; DECISION-194/195/196, F169/F170/F171).
 *
 * What this proves, on the OWNER connection (getPlatformDb() is neondb_owner;
 * every 0060 function is owner only):
 *   - F169, single source: for both slots, the holder count equals
 *     count(distinct holder_person_id) of its list over every holder shape
 *     (group arm with an ended membership, a future-dated group membership, a
 *     merged person, a founding-administrator companion grant, a person
 *     holding through both arms, a member-less group grant, a role carrying
 *     both manage keys). The founding-administrator asymmetry is pinned as
 *     LISTED, not only counted.
 *   - Every revoke outcome (revoked | already_removed | changed |
 *     not_a_holder | derived_group_refused | not_applicable |
 *     no_organization) and the programmer-error raises; no write on any
 *     non-revoked outcome.
 *   - F171, the membership-end clamp, through the REAL
 *     role_grants_needs_membership guard (a ghost holder is built inside a
 *     rolled-back transaction with memberships_guard_end disabled).
 *   - The designation's two grants end together; unrelated grants of the same
 *     person are untouched; zero is reachable and the invitation gate reopens;
 *     open invitations are left open.
 *   - Races on two connections: revoke vs accept (org-row lock, both
 *     directions) and revoke vs a concurrent org-side end of a grant.
 *   - ACL and shape: SECURITY DEFINER, search_path pinned, owner only, and the
 *     revoke body writes role_grants and nothing else.
 *
 * The existing count pin in invitations.db.test.ts is NOT edited: it passing
 * against 0060's derived bodies is the behaviour-preservation proof (D1).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/designation-revoke.db.test.ts
 *
 * Names are synthetic and every address is example.invalid (No Real Data).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Slot = "founding_administrator" | "treasurer";
type Kind = "person" | "group";

const NEW_FUNCTIONS = [
  "presby_founding_administrator_holder_grants(uuid)",
  "presby_giving_manage_holder_grants(uuid)",
  "presby_founding_administrator_companion_grants(uuid,uuid)",
  "presby_revoke_designation_holder(uuid,text,text,uuid,uuid[])",
  "presby_founding_administrator_holder_count(uuid)",
  "presby_giving_manage_holder_count(uuid)",
];

class Rollback extends Error {}

describe.skipIf(!hasDb)("drizzle/0060 designation revoke (Postgres-backed)", () => {
  let fx: InvitationFixture;
  let FAKE_BCRYPT: string;
  let operator: string;
  let rosterTypeId: string;
  let today: string;
  const mergedPeople: string[] = [];

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  /** Drizzle wraps the Postgres error - match the whole cause chain. */
  async function expectRaise(p: Promise<unknown>, pattern: RegExp) {
    let caught: unknown = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected a raise matching ${pattern}`).not.toBeNull();
    const parts: string[] = [];
    for (let e = caught as { message?: string; code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
      parts.push(String(e.message ?? e), String(e.code ?? ""));
    }
    expect(parts.join(" | ")).toMatch(pattern);
  }

  function uuidArray(ids: readonly string[]): string {
    return `{${ids.join(",")}}`;
  }

  async function makeGroup(org: string, name: string, derivedFrom?: "session" | "diaconate"): Promise<string> {
    const [g] = await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${org}, ${rosterTypeId}, ${name}, ${derivedFrom ? "derived" : "managed"}, ${derivedFrom ?? null}, ${Boolean(derivedFrom)})
      returning id`);
    return String(g!.id);
  }

  async function activeMembershipGroup(org: string): Promise<string> {
    const [g] = await q(sql`select id from groups where organization_id = ${org} and derived_from = 'active_membership'`);
    return String(g!.id);
  }

  async function addToGroup(
    org: string,
    group: string,
    person: string,
    options: { startsOn?: SQL; endsOn?: SQL; source?: "managed" | "derived" } = {},
  ): Promise<void> {
    await q(sql`
      insert into group_memberships (organization_id, group_id, person_id, source, starts_on, ends_on)
      values (${org}, ${group}, ${person}, ${options.source ?? "managed"},
              ${options.startsOn ?? sql`current_date`}, ${options.endsOn ?? null})`);
  }

  async function grant(
    org: string,
    roleId: string,
    subject: { personId?: string; groupId?: string },
    options: { startsOn?: SQL; reason?: string | null } = {},
  ): Promise<string> {
    const [g] = await q(sql`
      insert into role_grants (organization_id, role_id, person_id, group_id, starts_on, granted_by, grant_reason)
      values (${org}, ${roleId}, ${subject.personId ?? null}, ${subject.groupId ?? null},
              ${options.startsOn ?? sql`'2020-01-01'::date`}, ${operator}, ${options.reason ?? null})
      returning id`);
    return String(g!.id);
  }

  let roleCounter = 0;
  async function role(org: string, keys: readonly string[]): Promise<string> {
    roleCounter += 1;
    return fx.makeRole(org, `dr_role_${roleCounter}`, keys);
  }

  async function member(org: string, first: string, last: string): Promise<string> {
    const p = await fx.makePerson(first, last);
    await fx.addMember(org, p);
    return p;
  }

  async function list(org: string, slot: Slot): Promise<Row[]> {
    const fn = slot === "founding_administrator" ? sql`presby_founding_administrator_holder_grants` : sql`presby_giving_manage_holder_grants`;
    return q(sql`
      select grant_id::text, role_key, arm, subject_person_id::text, group_id::text, group_name,
             group_membership_source, holder_person_id::text, grant_starts_on::text, grant_reason
        from ${fn}(${org}::uuid)
       order by grant_id, holder_person_id`);
  }

  async function counts(org: string): Promise<{ fa: number; gm: number }> {
    const [r] = await q(sql`select presby_founding_administrator_holder_count(${org}) as fa,
                                   presby_giving_manage_holder_count(${org}) as gm`);
    return { fa: Number(r!.fa), gm: Number(r!.gm) };
  }

  /** F169: the count IS count(distinct holder_person_id) of the list, for both slots. */
  async function expectListEqualsCount(org: string): Promise<{ fa: number; gm: number }> {
    const c = await counts(org);
    const fa = new Set((await list(org, "founding_administrator")).map((r) => r.holder_person_id)).size;
    const gm = new Set((await list(org, "treasurer")).map((r) => r.holder_person_id)).size;
    expect({ fa, gm }).toEqual(c);
    return c;
  }

  async function companions(org: string, person: string): Promise<Row[]> {
    return q(sql`select grant_id::text, role_key from presby_founding_administrator_companion_grants(${org}::uuid, ${person}::uuid)`);
  }

  function revokeQuery(org: string, slot: string, kind: string, subject: string, expected: readonly string[] | null): SQL {
    return sql`
      select outcome, grant_ids::text[] as grant_ids, role_keys, applied_ends_on::text[] as applied_ends_on,
             clamped_to_membership_end, companion_grant_ids::text[] as companion_grant_ids,
             revoked_holder_person_ids::text[] as revoked_holder_person_ids,
             holder_count_before, holder_count_after, open_invitation_ids::text[] as open_invitation_ids
        from presby_revoke_designation_holder(${org}::uuid, ${slot}::text, ${kind}::text, ${subject}::uuid,
             ${expected === null ? null : uuidArray(expected)}::uuid[])`;
  }

  async function revoke(org: string, slot: Slot, kind: Kind, subject: string, expected: readonly string[]): Promise<Row> {
    const [r] = await q(revokeQuery(org, slot, kind, subject, expected));
    return r!;
  }

  async function grantsAt(org: string): Promise<Row[]> {
    return q(sql`select id::text, ends_on::text from role_grants where organization_id = ${org} order by id`);
  }

  async function endsOn(grantId: string): Promise<string | null> {
    const [r] = await q(sql`select ends_on::text as e from role_grants where id = ${grantId}`);
    return (r!.e as string | null) ?? null;
  }

  function expectNoDetail(r: Row) {
    const { outcome: _o, ...rest } = r;
    for (const v of Object.values(rest)) expect(v).toBeNull();
  }

  /** A real founding-administrator designation through presby_accept_invitation (bundle + companion). */
  async function designate(org: string): Promise<{ person: string; user: string; address: string }> {
    const address = fx.email("fa");
    const inv = await fx.insertInvitation({
      organizationId: org, purpose: "founding_administrator", email: address,
      createdByUserId: operator, firstName: "Perpetua", lastName: "Ashgrove",
    });
    const r = await fx.accept(inv.token, { passwordHash: FAKE_BCRYPT, firstName: "Perpetua", lastName: "Ashgrove" });
    expect(r.outcome).toBe("accepted");
    return { person: String(r.person_id), user: String(r.user_id), address };
  }

  async function personGrantIds(org: string, person: string): Promise<string[]> {
    const rows = await q(sql`
      select id::text from role_grants where organization_id = ${org} and person_id = ${person}
         and starts_on <= current_date and (ends_on is null or ends_on > current_date) order by id`);
    return rows.map((r) => String(r.id));
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    FAKE_BCRYPT = mod.FAKE_BCRYPT;
    fx = await mod.createInvitationFixture("dr-db");
    operator = fx.actingUserId;
    const [t] = await q(sql`select id from group_types where key = 'roster'`);
    rosterTypeId = String(t!.id);
    const [d] = await q(sql`select current_date::text as d`);
    today = String(d!.d);
  });

  afterAll(async () => {
    if (!fx) return;
    // A merge chain would order the people teardown; the fixture rows are
    // un-merged first (test rows only, stamped deletable_until at insert).
    for (const id of mergedPeople) {
      await q(sql`update people set merged_into_id = null where id = ${id}`);
    }
    await fx.cleanup();
  });

  // =========================================================================
  // F169: list = count, over every holder shape
  // =========================================================================
  describe("single source (F169): the counts are derived from the lists", () => {
    it("list = count for both slots across every holder shape; the founding-administrator asymmetry is LISTED, not only counted", async () => {
      const org = await fx.makeOrg("shapes");
      expect(await expectListEqualsCount(org)).toEqual({ fa: 0, gm: 0 });

      const manage = await role(org, ["roles.manage"]);
      const both = await role(org, ["roles.manage", "role_grants.manage"]);
      const giving = await role(org, ["giving.manage"]);

      // A person-arm holder of a role carrying BOTH manage keys: one row, not two.
      const alpha = await member(org, "Ansel", "Brightwater");
      const gAlpha = await grant(org, both, { personId: alpha });
      let fa = await list(org, "founding_administrator");
      expect(fa).toEqual([expect.objectContaining({ grant_id: gAlpha, arm: "person", subject_person_id: alpha, holder_person_id: alpha })]);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 1, gm: 0 });

      // A managed group: an open member, a member whose group row ended, a
      // future-dated member, and a member whose MEMBERSHIP ended (group row open).
      const grp = await makeGroup(org, "Stewardship Circle");
      const open = await member(org, "Beatrix", "Ollerton");
      const leftGroup = await member(org, "Cosmo", "Fairweather");
      const future = await member(org, "Delphine", "Marchbank");
      const ghost = await member(org, "Evander", "Pellow");
      await addToGroup(org, grp, open);
      await addToGroup(org, grp, leftGroup, { startsOn: sql`'2021-01-01'::date`, endsOn: sql`'2022-01-01'::date` });
      await addToGroup(org, grp, future, { startsOn: sql`current_date + 30` });
      await addToGroup(org, grp, ghost);
      await q(sql`update memberships set ended_on = current_date - 1 where organization_id = ${org} and person_id = ${ghost}`);
      const gGrpFa = await grant(org, manage, { groupId: grp });
      const gGrpGm = await grant(org, giving, { groupId: grp });

      fa = await list(org, "founding_administrator");
      const faGroupHolders = fa.filter((r) => r.grant_id === gGrpFa).map((r) => r.holder_person_id).sort();
      // FA group arm: no gm.starts_on check, no memberships join (the asymmetry, kept).
      expect(faGroupHolders).toEqual([open, future, ghost].sort());
      expect(fa.find((r) => r.grant_id === gGrpFa)).toMatchObject({
        arm: "group", group_id: grp, group_name: "Stewardship Circle", group_membership_source: "managed", subject_person_id: null,
      });
      // Treasurer group arm: window-checked and membership-aware.
      const tr = await list(org, "treasurer");
      expect(tr.filter((r) => r.grant_id === gGrpGm).map((r) => r.holder_person_id)).toEqual([open]);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 4, gm: 1 });

      // A person holding through BOTH arms: one holder, two rows.
      const gOpenPerson = await grant(org, manage, { personId: open });
      fa = await list(org, "founding_administrator");
      expect(fa.filter((r) => r.holder_person_id === open).map((r) => r.arm).sort()).toEqual(["group", "person"]);
      expect(fa.some((r) => r.grant_id === gOpenPerson)).toBe(true);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 4, gm: 1 });

      // A group grant with no attributable member: no row, no holder.
      const empty = await makeGroup(org, "Empty Committee");
      const gEmpty = await grant(org, manage, { groupId: empty });
      expect((await list(org, "founding_administrator")).some((r) => r.grant_id === gEmpty)).toBe(false);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 4, gm: 1 });

      // A merged person: counted and listed by the founding-administrator
      // slot, neither by the treasurer slot.
      const survivor = await member(org, "Fenella", "Quayle");
      const merged = await member(org, "Fenella", "Quayle-Dup");
      const gMergedFa = await grant(org, manage, { personId: merged });
      const gMergedGm = await grant(org, giving, { personId: merged });
      await q(sql`update people set merged_into_id = ${survivor} where id = ${merged}`);
      mergedPeople.push(merged);
      expect((await list(org, "founding_administrator")).some((r) => r.grant_id === gMergedFa)).toBe(true);
      expect((await list(org, "treasurer")).some((r) => r.grant_id === gMergedGm)).toBe(false);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 5, gm: 1 });

      // A future-dated grant is not a holder (not listed, not counted).
      const late = await member(org, "Gideon", "Thrale");
      const gLate = await grant(org, manage, { personId: late }, { startsOn: sql`current_date + 10` });
      expect((await list(org, "founding_administrator")).some((r) => r.grant_id === gLate)).toBe(false);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 5, gm: 1 });
    });

    it("a founding-administrator companion grant is absent from the list and the count, and present in the companion function", async () => {
      const org = await fx.makeOrg("companion");
      const d = await designate(org);
      const fa = await list(org, "founding_administrator");
      expect(fa.map((r) => r.role_key)).toEqual(["founding_administrator"]);
      expect(fa[0]).toMatchObject({ arm: "person", holder_person_id: d.person, grant_reason: "founding administrator designation" });
      const comp = await companions(org, d.person);
      expect(comp.map((r) => r.role_key)).toEqual(["congregation_stated_clerk"]);
      expect(fa.some((r) => r.grant_id === comp[0]!.grant_id)).toBe(false);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 1, gm: 0 });

      // A clerk role that DOES carry role_grants.manage is contributing, never
      // also a companion: the sets are disjoint.
      await q(sql`
        insert into app_role_permissions (role_id, permission_key)
        select r.id, 'role_grants.manage' from app_roles r
         where r.organization_id = ${org} and r.key = 'congregation_stated_clerk'`);
      expect((await list(org, "founding_administrator")).map((r) => r.role_key).sort())
        .toEqual(["congregation_stated_clerk", "founding_administrator"]);
      expect(await companions(org, d.person)).toEqual([]);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 1, gm: 0 });
    });
  });

  // =========================================================================
  // Outcomes
  // =========================================================================
  describe("revoke outcomes", () => {
    it("revoked (person): ends_on = today, unclamped, counts before/after, holder ids; the second identical call is already_removed and writes nothing", async () => {
      const org = await fx.makeOrg("rv-person");
      const a = await member(org, "Hesper", "Lowndes");
      const b = await member(org, "Ivo", "Carrick");
      const manage = await role(org, ["roles.manage"]);
      const ga = await grant(org, manage, { personId: a });
      await grant(org, manage, { personId: b });

      const r = await revoke(org, "founding_administrator", "person", a, [ga]);
      expect(r).toEqual({
        outcome: "revoked", grant_ids: [ga], role_keys: [expect.stringMatching(/^dr_role_/)],
        applied_ends_on: [today], clamped_to_membership_end: false, companion_grant_ids: [],
        revoked_holder_person_ids: [a], holder_count_before: 2, holder_count_after: 1, open_invitation_ids: [],
      });
      expect(await endsOn(ga)).toBe(today);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 1, gm: 0 });

      const before = await grantsAt(org);
      const again = await revoke(org, "founding_administrator", "person", a, [ga]);
      expect(again.outcome).toBe("already_removed");
      expectNoDetail(again);
      expect(await grantsAt(org)).toEqual(before);
    });

    it("revoked (managed group): the group's grant ends; the group and its members are not changed", async () => {
      const org = await fx.makeOrg("rv-group");
      const grp = await makeGroup(org, "Finance Committee");
      const x = await member(org, "Jessamy", "Hartigan");
      const y = await member(org, "Kit", "Ambrose");
      await addToGroup(org, grp, x);
      await addToGroup(org, grp, y);
      const giving = await role(org, ["giving.manage"]);
      const gg = await grant(org, giving, { groupId: grp });
      const gmBefore = await q(sql`select id::text, ends_on from group_memberships where group_id = ${grp} order by id`);

      const r = await revoke(org, "treasurer", "group", grp, [gg]);
      expect(r).toMatchObject({
        outcome: "revoked", grant_ids: [gg], applied_ends_on: [today], clamped_to_membership_end: false,
        holder_count_before: 2, holder_count_after: 0,
      });
      expect((r.revoked_holder_person_ids as string[]).sort()).toEqual([x, y].sort());
      expect(await q(sql`select id::text, ends_on from group_memberships where group_id = ${grp} order by id`)).toEqual(gmBefore);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 0, gm: 0 });
    });

    it("already_removed: a grant ended by the org-side path between render and submit; no write", async () => {
      const org = await fx.makeOrg("rv-orgside");
      const a = await member(org, "Linnea", "Garside");
      const g = await grant(org, await role(org, ["role_grants.manage"]), { personId: a });
      // What revokeRole() does on the tenant side.
      await q(sql`update role_grants set ends_on = current_date where id = ${g}`);
      const before = await grantsAt(org);
      const r = await revoke(org, "founding_administrator", "person", a, [g]);
      expect(r.outcome).toBe("already_removed");
      expect(await grantsAt(org)).toEqual(before);
    });

    it("changed: an expected id missing, an extra contributing grant appeared, the companion omitted; no write", async () => {
      const org = await fx.makeOrg("rv-changed");
      const a = await member(org, "Mabyn", "Trevose");
      const r1 = await role(org, ["roles.manage"]);
      const r2 = await role(org, ["role_grants.manage"]);
      const g1 = await grant(org, r1, { personId: a });
      const g2 = await grant(org, r2, { personId: a });
      let before = await grantsAt(org);
      expect((await revoke(org, "founding_administrator", "person", a, [g1])).outcome).toBe("changed");
      expect(await grantsAt(org)).toEqual(before);

      // The dialog rendered [g1, g2]; a third contributing grant appeared since.
      const g3 = await grant(org, await role(org, ["roles.manage"]), { personId: a });
      before = await grantsAt(org);
      const r = await revoke(org, "founding_administrator", "person", a, [g1, g2]);
      expect(r.outcome).toBe("changed");
      expectNoDetail(r);
      expect(await grantsAt(org)).toEqual(before);
      // Order and duplicates in the expected list do not matter (compared as sets).
      expect((await revoke(org, "founding_administrator", "person", a, [g3, g1, g2, g1])).outcome).toBe("revoked");

      // The companion must have been displayed.
      const org2 = await fx.makeOrg("rv-changed-comp");
      const d = await designate(org2);
      const contributing = (await list(org2, "founding_administrator")).map((x) => String(x.grant_id));
      before = await grantsAt(org2);
      expect((await revoke(org2, "founding_administrator", "person", d.person, contributing)).outcome).toBe("changed");
      expect(await grantsAt(org2)).toEqual(before);
    });

    it("not_a_holder: a person who holds nothing, a cross-org subject, another org's grant id - the same neutral outcome, no write", async () => {
      const orgA = await fx.makeOrg("rv-nah-a");
      const orgB = await fx.makeOrg("rv-nah-b");
      const nobody = await member(orgA, "Nerys", "Penhallow");
      const holderB = await member(orgB, "Oswin", "Kellow");
      const gB = await grant(orgB, await role(orgB, ["roles.manage"]), { personId: holderB });
      const beforeA = await grantsAt(orgA);
      const beforeB = await grantsAt(orgB);

      const r1 = await revoke(orgA, "founding_administrator", "person", nobody, [randomUUID()]);
      expect(r1.outcome).toBe("not_a_holder");
      expectNoDetail(r1);
      // orgB's holder and grant named against orgA.
      expect((await revoke(orgA, "founding_administrator", "person", holderB, [gB])).outcome).toBe("not_a_holder");
      // Another org's ENDED grant id never reads as already_removed here.
      await q(sql`update role_grants set ends_on = current_date where id = ${gB}`);
      expect((await revoke(orgA, "founding_administrator", "person", holderB, [gB])).outcome).toBe("not_a_holder");
      expect((await revoke(orgA, "founding_administrator", "person", nobody, [gB])).outcome).toBe("not_a_holder");
      expect(await grantsAt(orgA)).toEqual(beforeA);
      expect((await grantsAt(orgB)).map((g) => g.id)).toEqual(beforeB.map((g) => g.id));
    });

    it("a companion grant alone never makes a subject revocable (no general end-any-grant path)", async () => {
      const org = await fx.makeOrg("rv-comp-alone");
      const d = await designate(org);
      const [bundle] = await list(org, "founding_administrator");
      // The congregation ends the bundle itself; the companion stays open.
      await q(sql`update role_grants set ends_on = current_date where id = ${String(bundle!.grant_id)}`);
      const open = await personGrantIds(org, d.person);
      expect(open).toHaveLength(1);
      const r = await revoke(org, "founding_administrator", "person", d.person, open);
      expect(r.outcome).toBe("not_a_holder");
      expect(await personGrantIds(org, d.person)).toEqual(open);
    });

    it("derived_group_refused for session, diaconate and active_membership; no grant row changes", async () => {
      const org = await fx.makeOrg("rv-derived");
      const elder = await member(org, "Petroc", "Vosper");
      const deacon = await member(org, "Quenella", "Rosewarne");
      const session = await makeGroup(org, "Session", "session");
      const diaconate = await makeGroup(org, "Board of Deacons", "diaconate");
      await addToGroup(org, session, elder, { source: "derived" });
      await addToGroup(org, diaconate, deacon, { source: "derived" });
      const active = await activeMembershipGroup(org);
      const manage = await role(org, ["roles.manage"]);
      const giving = await role(org, ["giving.manage"]);
      const gs = await grant(org, manage, { groupId: session });
      const gd = await grant(org, manage, { groupId: diaconate });
      const ga = await grant(org, giving, { groupId: active });
      // They are listed (D6: shown, with no Revoke) ...
      expect((await list(org, "founding_administrator")).filter((r) => r.group_membership_source === "derived")).toHaveLength(2);
      expect((await list(org, "treasurer")).map((r) => r.group_membership_source)).toEqual(["derived", "derived"]);
      const before = await grantsAt(org);
      // ... and the function itself refuses them, whatever the caller displays.
      for (const [slot, grp, g] of [
        ["founding_administrator", session, gs], ["founding_administrator", diaconate, gd], ["treasurer", active, ga],
      ] as const) {
        const r = await revoke(org, slot, "group", grp, [g]);
        expect({ grp, outcome: r.outcome }).toEqual({ grp, outcome: "derived_group_refused" });
        expectNoDetail(r);
      }
      expect(await grantsAt(org)).toEqual(before);
    });

    it("not_applicable (treasurer at a presbytery), no_organization (unknown org id)", async () => {
      const pres = await fx.makeOrg("rv-pres", { organizationType: "presbytery" });
      const p = await member(pres, "Rozenn", "Tregear");
      const g = await grant(pres, await role(pres, ["giving.manage"]), { personId: p });
      const r = await revoke(pres, "treasurer", "person", p, [g]);
      expect(r.outcome).toBe("not_applicable");
      expectNoDetail(r);
      expect(await endsOn(g)).toBeNull();
      const n = await revoke(randomUUID(), "founding_administrator", "person", p, [g]);
      expect(n.outcome).toBe("no_organization");
      expectNoDetail(n);
    });

    it("programmer errors raise invalid_parameter_value: unknown slot or kind, null or empty expected list, a null element", async () => {
      const org = await fx.makeOrg("rv-errors");
      const p = await member(org, "Sennen", "Udy");
      const id = randomUUID();
      await expectRaise(q(revokeQuery(org, "elder", "person", p, [id])), /unknown slot|22023/);
      await expectRaise(q(revokeQuery(org, "treasurer", "household", p, [id])), /unknown subject kind|22023/);
      await expectRaise(q(revokeQuery(org, "treasurer", "person", p, null)), /displayed grant ids are required|22023/);
      await expectRaise(q(revokeQuery(org, "treasurer", "person", p, [])), /displayed grant ids are required|22023/);
      await expectRaise(
        q(sql`select * from presby_revoke_designation_holder(${org}::uuid, 'treasurer', 'person', ${p}::uuid, array[null]::uuid[])`),
        /displayed grant ids are required|22023/,
      );
    });
  });

  // =========================================================================
  // F171: the membership-end clamp, through the real guard
  // =========================================================================
  describe("membership-end clamp (F171, D4)", () => {
    it("a ghost holder (membership already ended, grant open): ends_on = membership end, clamped, no check_violation; and a grant that started after the membership ended still writes", async () => {
      const org = await fx.makeOrg("clamp");
      const ghost = await member(org, "Tamsin", "Jory");
      const manage = await role(org, ["roles.manage"]);
      const gOld = await grant(org, manage, { personId: ghost }, { startsOn: sql`'2020-01-01'::date` });
      const gLate = await grant(org, manage, { personId: ghost }, { startsOn: sql`'2025-06-01'::date` });

      let seen: Row | null = null;
      let after: Row[] = [];
      let guardRefusesToday = "";
      await expect(
        fx.platform.transaction(async (tx) => {
          // Data written around the DECISION-039 guards (the only way a
          // person-arm ghost exists): owner, rolled back.
          await tx.execute(sql`alter table memberships disable trigger memberships_guard_end`);
          await tx.execute(sql`update memberships set ended_on = '2025-01-01' where organization_id = ${org} and person_id = ${ghost}`);
          await tx.execute(sql`alter table memberships enable trigger memberships_guard_end`);

          // Positive control: ending to TODAY is exactly what the guard refuses.
          await tx.execute(sql`savepoint s1`);
          try {
            await tx.execute(sql`update role_grants set ends_on = current_date where id = ${gOld}`);
          } catch (err) {
            guardRefusesToday = String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message);
          }
          await tx.execute(sql`rollback to savepoint s1`);

          const res = await tx.execute(revokeQuery(org, "founding_administrator", "person", ghost, [gOld, gLate]));
          seen = ((res as unknown as { rows: Row[] }).rows ?? [])[0]!;
          after = ((await tx.execute(sql`
            select id::text, ends_on::text from role_grants where id in (${gOld}, ${gLate}) order by id`)) as unknown as { rows: Row[] }).rows;
          const hc = ((await tx.execute(sql`select presby_founding_administrator_holder_count(${org}) as n`)) as unknown as { rows: Row[] }).rows;
          expect(Number(hc[0]!.n)).toBe(0);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);

      expect(guardRefusesToday).toMatch(/cannot open a position at an organization where the membership ended/);
      expect(seen).toMatchObject({
        outcome: "revoked", clamped_to_membership_end: true, applied_ends_on: ["2025-01-01", "2025-01-01"],
        holder_count_before: 1, holder_count_after: 0,
      });
      expect(after.map((r) => r.ends_on)).toEqual(["2025-01-01", "2025-01-01"]);
      // Rolled back: the grants are open again and the membership is open.
      expect(await endsOn(gOld)).toBeNull();
      const [m] = await q(sql`select ended_on from memberships where organization_id = ${org} and person_id = ${ghost}`);
      expect(m!.ended_on).toBeNull();
    });
  });

  // =========================================================================
  // The designation's grants, zero, open invitations
  // =========================================================================
  describe("designation grants, zero holders, open invitations", () => {
    it("bundle + companion end together; the same person's unrelated session role, group membership and treasurer grant are untouched", async () => {
      const org = await fx.makeOrg("two-grants");
      const d = await designate(org);
      const [bundle] = await list(org, "founding_administrator");
      const [comp] = await companions(org, d.person);
      // Unrelated: a session-member role through a managed group, and a treasurer grant.
      const grp = await makeGroup(org, "Worship Team");
      await addToGroup(org, grp, d.person);
      const unrelated = await grant(org, await role(org, ["directory.view"]), { groupId: grp });
      const tr = await grant(org, await role(org, ["giving.manage"]), { personId: d.person });

      const expected = [String(bundle!.grant_id), String(comp!.grant_id)];
      const r = await revoke(org, "founding_administrator", "person", d.person, expected);
      expect(r).toMatchObject({
        outcome: "revoked", grant_ids: [...expected].sort(), companion_grant_ids: [String(comp!.grant_id)],
        applied_ends_on: [today, today], revoked_holder_person_ids: [d.person], holder_count_before: 1, holder_count_after: 0,
      });
      const keys = new Map((r.grant_ids as string[]).map((id, i) => [id, (r.role_keys as string[])[i]]));
      expect(keys.get(String(bundle!.grant_id))).toBe("founding_administrator");
      expect(keys.get(String(comp!.grant_id))).toBe("congregation_stated_clerk");
      expect(await endsOn(unrelated)).toBeNull();
      expect(await endsOn(tr)).toBeNull();
      const [gm] = await q(sql`select count(*)::int as n from group_memberships where group_id = ${grp} and ends_on is null`);
      expect(gm!.n).toBe(1);
      expect(await counts(org)).toEqual({ fa: 0, gm: 1 });
    });

    it("zero is reachable (no self_lockout_blocked), and the invitation gate then opens: a new designation accepts", async () => {
      const org = await fx.makeOrg("zero");
      const d = await designate(org);
      const ids = await personGrantIds(org, d.person);
      const r = await revoke(org, "founding_administrator", "person", d.person, ids);
      expect(r).toMatchObject({ outcome: "revoked", holder_count_after: 0 });
      const replacement = await designate(org);
      expect(replacement.person).not.toBe(d.person);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 1, gm: 0 });
    });

    it("open invitations for the slot are LEFT OPEN and reported; other purposes and terminal rows are not reported", async () => {
      const org = await fx.makeOrg("open-inv");
      const a = await member(org, "Ulla", "Penrose");
      const g = await grant(org, await role(org, ["roles.manage"]), { personId: a });
      const openInv = await fx.insertInvitation({
        organizationId: org, purpose: "founding_administrator", email: fx.email("open"),
        createdByUserId: operator, firstName: "Veryan", lastName: "Hosking",
      });
      const tp = await member(org, "Wenna", "Polglase");
      const trInv = await fx.insertInvitation({
        organizationId: org, purpose: "treasurer", email: fx.email("tr"), createdByUserId: operator, personId: tp,
      });
      const r = await revoke(org, "founding_administrator", "person", a, [g]);
      expect(r).toMatchObject({ outcome: "revoked", open_invitation_ids: [openInv.id] });
      const row = await fx.invitation(openInv.id);
      expect([row.accepted_at, row.revoked_at, row.superseded_at, row.blocked_at]).toEqual([null, null, null, null]);
      expect((r.open_invitation_ids as string[]).includes(trInv.id)).toBe(false);
    });
  });

  // =========================================================================
  // Races, on two connections
  // =========================================================================
  describe("concurrency", () => {
    it("revoke holding the org lock: a concurrent accept WAITS for it, then sees zero holders and accepts", async () => {
      const org = await fx.makeOrg("race-accept");
      const h = await member(org, "Xanthe", "Bolitho");
      const g = await grant(org, await role(org, ["roles.manage"]), { personId: h });
      const inv = await fx.insertInvitation({
        organizationId: org, purpose: "founding_administrator", email: fx.email("race"),
        createdByUserId: operator, firstName: "Yestin", lastName: "Carne",
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let revokeOutcome = "";
      const revokeTx = fx.platform.transaction(async (tx) => {
        const res = await tx.execute(revokeQuery(org, "founding_administrator", "person", h, [g]));
        revokeOutcome = String(((res as unknown as { rows: Row[] }).rows)[0]!.outcome);
        await gate;
      });
      await new Promise((r) => setTimeout(r, 400));
      let acceptDone = false;
      const acceptP = fx.accept(inv.token, { passwordHash: FAKE_BCRYPT, firstName: "Yestin", lastName: "Carne" })
        .then((row) => { acceptDone = true; return row; });
      await new Promise((r) => setTimeout(r, 700));
      expect(acceptDone).toBe(false);
      release();
      await revokeTx;
      const accepted = await acceptP;
      expect(revokeOutcome).toBe("revoked");
      // Without the serialization the accept would have read h as a holder.
      expect(accepted.outcome).toBe("accepted");
      expect(await endsOn(g)).toBe(today);
      expect(await expectListEqualsCount(org)).toEqual({ fa: 1, gm: 0 });
    });

    it("accept holding the org lock: a concurrent revoke WAITS, then sees the new grants and, with a stale expected set, returns changed", async () => {
      const org = await fx.makeOrg("race-revoke");
      const address = fx.email("existing");
      const user = await fx.makeUser(address);
      const p = await member(org, "Zennor", "Angove");
      await fx.linkUser(p, user);
      const inv = await fx.insertInvitation({
        organizationId: org, purpose: "founding_administrator", email: address,
        createdByUserId: operator, firstName: "Zennor", lastName: "Angove",
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let acceptOutcome = "";
      const acceptTx = fx.platform.transaction(async (tx) => {
        const res = await tx.execute(sql`select * from presby_accept_invitation(${inv.token}::text, ${user}::uuid, null, null, null)`);
        acceptOutcome = String(((res as unknown as { rows: Row[] }).rows)[0]!.outcome);
        await gate;
      });
      await new Promise((r) => setTimeout(r, 400));
      let revokeDone = false;
      const stale = randomUUID();
      const revokeP = revoke(org, "founding_administrator", "person", p, [stale]).then((row) => { revokeDone = true; return row; });
      await new Promise((r) => setTimeout(r, 700));
      expect(revokeDone).toBe(false);
      release();
      await acceptTx;
      expect(acceptOutcome).toBe("accepted");
      // Had it not waited it would have read "not_a_holder".
      expect((await revokeP).outcome).toBe("changed");
      expect(await personGrantIds(org, p)).toHaveLength(2);
    });

    it("revoke vs a concurrent org-side end of one grant (row lock): changed, no double write, no deadlock; of every grant: already_removed", async () => {
      const org = await fx.makeOrg("race-orgside");
      const a = await member(org, "Aelwen", "Treloar");
      const g1 = await grant(org, await role(org, ["roles.manage"]), { personId: a });
      const g2 = await grant(org, await role(org, ["role_grants.manage"]), { personId: a });

      async function race(endIds: string[]): Promise<Row> {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const orgSide = fx.platform.transaction(async (tx) => {
          for (const id of endIds) await tx.execute(sql`update role_grants set ends_on = current_date where id = ${id}`);
          await gate;
        });
        await new Promise((r) => setTimeout(r, 400));
        let done = false;
        const revokeP = revoke(org, "founding_administrator", "person", a, [g1, g2]).then((row) => { done = true; return row; });
        await new Promise((r) => setTimeout(r, 700));
        expect(done).toBe(false); // blocked on the grant row lock
        release();
        await orgSide;
        return revokeP;
      }

      const r1 = await race([g1]);
      expect(r1.outcome).toBe("changed");
      expect(await endsOn(g1)).toBe(today);
      expect(await endsOn(g2)).toBeNull();

      const org2 = await fx.makeOrg("race-orgside-all");
      const b = await member(org2, "Bryok", "Hendra");
      const h1 = await grant(org2, await role(org2, ["roles.manage"]), { personId: b });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const orgSide = fx.platform.transaction(async (tx) => {
        await tx.execute(sql`update role_grants set ends_on = current_date where id = ${h1}`);
        await gate;
      });
      await new Promise((r) => setTimeout(r, 400));
      const revokeP = revoke(org2, "founding_administrator", "person", b, [h1]);
      await new Promise((r) => setTimeout(r, 700));
      release();
      await orgSide;
      const r2 = await revokeP;
      // Derived before the org side committed, dropped by the re-check under the lock.
      expect(r2.outcome).toBe("already_removed");
      expectNoDetail(r2);
    });
  });

  // =========================================================================
  // ACL and shape
  // =========================================================================
  describe("ACL and shape", () => {
    it("every 0060 function is SECURITY DEFINER, owned by neondb_owner, search_path = public, pg_temp, and executable by nobody else", async () => {
      for (const fn of NEW_FUNCTIONS) {
        const [r] = await q(sql`
          select p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig,
                 has_function_privilege('presby_app', p.oid, 'EXECUTE') as app,
                 has_function_privilege('presby_platform', p.oid, 'EXECUTE') as platform,
                 exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as public_exec
            from pg_proc p where p.oid = ${fn}::regprocedure`);
        expect({ fn, ...r }).toEqual({
          fn, prosecdef: true, owner: "neondb_owner", proconfig: ["search_path=public, pg_temp"],
          app: false, platform: false, public_exec: false,
        });
      }
    });

    it("through the presby_app connection every 0060 function is refused", async () => {
      const id = randomUUID();
      await expectRaise(fx.appDb.execute(sql`select * from presby_founding_administrator_holder_grants(${id}::uuid)`), /permission denied/);
      await expectRaise(fx.appDb.execute(sql`select * from presby_giving_manage_holder_grants(${id}::uuid)`), /permission denied/);
      await expectRaise(fx.appDb.execute(sql`select * from presby_founding_administrator_companion_grants(${id}::uuid, ${id}::uuid)`), /permission denied/);
      await expectRaise(
        fx.appDb.execute(sql`select * from presby_revoke_designation_holder(${id}::uuid, 'treasurer', 'person', ${id}::uuid, ${uuidArray([id])}::uuid[])`),
        /permission denied/,
      );
    });

    it("the revoke body writes role_grants and nothing else; the list, count and companion bodies write nothing", async () => {
      const [r] = await q(sql`select pg_get_functiondef('presby_revoke_designation_holder(uuid,text,text,uuid,uuid[])'::regprocedure) as def`);
      const body = String(r!.def).toLowerCase().replace(/--[^\n]*/g, "");
      const targets = [...body.matchAll(/\b(update|insert\s+into|delete\s+from|truncate)\s+([a-z_]+)/g)].map((m) => m[2]);
      expect(targets.length).toBeGreaterThan(0);
      expect(new Set(targets)).toEqual(new Set(["role_grants"]));
      for (const fn of NEW_FUNCTIONS.filter((f) => !f.startsWith("presby_revoke_"))) {
        const [d] = await q(sql`select pg_get_functiondef(${fn}::regprocedure) as def, p.provolatile from pg_proc p where p.oid = ${fn}::regprocedure`);
        expect({ fn, volatile: d!.provolatile }).toEqual({ fn, volatile: "s" });
        expect(String(d!.def).toLowerCase()).not.toMatch(/\b(update|insert\s+into|delete\s+from|truncate)\s/);
      }
    });
  });
});
