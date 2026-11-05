/**
 * The CONFIGURATION half of `store.ts` against a REAL Postgres connection -
 * teams, positions, qualifications, roster rows and service types
 * (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 Tests, `store.db.test.ts`;
 * Phase 4 Batch 2). Every export runs on the `presby_app` connection with an
 * organization context (`withOrgContext`), so RLS, the 0085 guards and the
 * CHECKs are live.
 *
 *   - the gate order on every kind of export: the organization type, then the
 *     toggle, then the key; plan-only and schedule-only holders are refused;
 *   - createTeam / adoptTeam / updateTeam / retireTeam, including the
 *     in-use refusal with the upcoming-service count;
 *   - positions: duplicate names (case-insensitive), the 40-position cap, the
 *     slot and name limits, retire-in-use; two simultaneous adds of one name;
 *   - qualifications: replace-set, a person who left the team, a position of
 *     another team;
 *   - the roster: member rows only, role-bound refusal, ending a seat refused,
 *     no write for a person already on the team;
 *   - service types: limits, duplicate names, default teams, re-adding a team.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/store.config.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { ACTION_COPY, TEAMS_COPY } from "./copy";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("worship/store.ts configuration exports (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let store: typeof import("./store");
  let reads: typeof import("./reads");
  let A: WorshipWorld;
  let B: WorshipWorld;
  let PRES: WorshipWorld;

  const v = (personId: string, w: WorshipWorld = A) => t.viewer(personId, w.org, "congregation");

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wcfg");
    store = await import("./store");
    reads = await import("./reads");
    A = await t.build("a");
    B = await t.build("b");
    // A presbytery with the keys but no worship toggle semantics: outside the allow-list.
    PRES = await t.build("pres", { organizationType: "presbytery", toggle: true });
  });

  afterAll(async () => {
    if (t) await t.fx.cleanup();
  });

  const teamRow = async (groupId: string) =>
    t.one(sql`select wt.group_id::text as group_id, wt.created_by::text as created_by, wt.retired_at,
                     g.name, g.membership_source, gt.key as kind, g.meets_when, g.description
                from worship_teams wt join groups g on g.id = wt.group_id join group_types gt on gt.id = g.group_type_id
               where wt.group_id = ${groupId}`);
  const positions = (groupId: string) =>
    t.q(sql`select id::text as id, name, slots::int as slots, sort_order::int as sort_order, retired_at
              from worship_positions where group_id = ${groupId} order by sort_order, name`);

  // -------------------------------------------------------------------------
  describe("the gate: type, then toggle, then key (every export repeats it)", () => {
    it("a presbytery is not_applicable even for a person who holds the key", async () => {
      const r = await store.createTeam(t.viewer(PRES.manager, PRES.org, "presbytery"), { name: "Nope", kind: "team" });
      expect(r).toEqual({ kind: "not_applicable" });
    });

    it("toggle off: toggle_off for a key holder, and nothing is written", async () => {
      const off = await t.build("off", { toggle: false });
      const before = await t.q(sql`select count(*)::int as n from worship_teams where organization_id = ${off.org}`);
      const r = await store.createTeam(v(off.manager, off), { name: "Band two", kind: "team" });
      expect(r).toEqual({ kind: "toggle_off" });
      const after = await t.q(sql`select count(*)::int as n from worship_teams where organization_id = ${off.org}`);
      expect(after[0]!.n).toBe(before[0]!.n);
      for (const call of [
        () => store.addPosition(v(off.manager, off), { groupId: off.band, name: "X", slots: 1 }),
        () => store.createServiceType(v(off.manager, off), { name: "X", startTime: "09:00" }),
        () => store.addTeamMember(v(off.manager, off), { groupId: off.band, personId: off.plain }),
        () => reads.getTeamsAdmin(v(off.manager, off)),
      ]) {
        expect(await call()).toEqual({ kind: "toggle_off" });
      }
    });

    it("a category-axis 'off' for the worship category turns it off too (the fourth axis)", async () => {
      const cat = await t.build("cat");
      const [original] = await t.q(sql`select enabled from feature_flags where key = 'org_portal.feature_categories'`);
      try {
        await t.q(sql`insert into feature_flags (key, enabled) values ('org_portal.feature_categories', true)
                      on conflict (key) do update set enabled = true`);
        await t.q(sql`insert into organization_feature_categories (organization_id, category, enabled) values (${cat.org}, 'worship', false)
                      on conflict (organization_id, category) do update set enabled = false`);
        expect(await store.createTeam(v(cat.manager, cat), { name: "Band two", kind: "team" })).toEqual({ kind: "toggle_off" });
      } finally {
        if (original) await t.q(sql`update feature_flags set enabled = ${original.enabled} where key = 'org_portal.feature_categories'`);
        else await t.q(sql`delete from feature_flags where key = 'org_portal.feature_categories'`);
      }
    });

    it("plan-only, schedule-only and no-key holders are forbidden from every manage export; a leader's seat is not manage either", async () => {
      for (const who of [A.planner, A.scheduler, A.plain, A.leader]) {
        const viewer = v(who);
        expect(await store.createTeam(viewer, { name: "Nope", kind: "team" }), "createTeam").toEqual({ kind: "forbidden" });
        expect(await store.addPosition(viewer, { groupId: A.band, name: "Nope", slots: 1 }), "addPosition").toEqual({ kind: "forbidden" });
        expect(await store.retireTeam(viewer, { groupId: A.band }), "retireTeam").toEqual({ kind: "forbidden" });
        expect(await store.addTeamMember(viewer, { groupId: A.band, personId: A.plain }), "addTeamMember").toEqual({ kind: "forbidden" });
        expect(await store.createServiceType(viewer, { name: "Nope", startTime: "09:00" }), "createServiceType").toEqual({ kind: "forbidden" });
        expect(await reads.getTeamsAdmin(viewer), "getTeamsAdmin").toEqual({ kind: "forbidden" });
      }
    });

    it("a person with no membership at the organization cannot even open the transaction (OrgAccessError, not a result)", async () => {
      const stranger = await t.fx.makePerson("Stranger", "Worshiptest");
      await expect(store.createTeam(v(stranger), { name: "Nope", kind: "team" })).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe("createTeam", () => {
    it("creates a managed team group, its worship_teams row, the starter positions in order, and records the actor", async () => {
      const r = await store.createTeam(v(A.manager), { name: "  Praise Crew  ", kind: "team", starter: "praise_band", description: "Sundays" });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      const row = await teamRow(r.data.groupId);
      expect(row).toMatchObject({ name: "Praise Crew", membership_source: "managed", kind: "team", description: "Sundays", created_by: t.fx.actingUserId });
      expect(row.retired_at).toBeNull();
      const ps = await positions(r.data.groupId);
      expect(ps.map((p) => p.name)).toEqual(["Worship leader", "Vocals", "Acoustic guitar", "Electric guitar", "Bass", "Drums", "Keys"]);
      expect(ps.map((p) => p.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(ps.find((p) => p.name === "Vocals")!.slots).toBe(2);
      expect(r.data.positionIds).toHaveLength(7);
    });

    it("a choir team gets the choir group type, and 'none' creates no positions", async () => {
      const r = await store.createTeam(v(A.manager), { name: "Chancel", kind: "choir", starter: "none" });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect((await teamRow(r.data.groupId)).kind).toBe("choir");
      expect(await positions(r.data.groupId)).toEqual([]);
    });

    it("refuses a blank name, an 81-character name, a control character, a bad kind and a bad starter - with the Copy sentences, and creates nothing", async () => {
      const before = await t.one(sql`select count(*)::int as n from groups where organization_id = ${A.org}`);
      const blank = await store.createTeam(v(A.manager), { name: "   ", kind: "team" });
      expect(blank).toEqual({ kind: "invalid_input", message: TEAMS_COPY.validation.nameRequired });
      const long = await store.createTeam(v(A.manager), { name: "x".repeat(81), kind: "team" });
      expect(long).toEqual({ kind: "invalid_input", message: TEAMS_COPY.validation.nameTooLong });
      expect((await store.createTeam(v(A.manager), { name: "a\nb", kind: "team" })).kind).toBe("invalid_input");
      expect((await store.createTeam(v(A.manager), { name: "ok", kind: "orchestra" as never })).kind).toBe("invalid_input");
      expect((await store.createTeam(v(A.manager), { name: "ok", kind: "team", starter: "kazoos" as never })).kind).toBe("invalid_input");
      expect((await store.createTeam(v(A.manager), { name: "x".repeat(80), kind: "team" })).kind).toBe("ok");
      const after = await t.one(sql`select count(*)::int as n from groups where organization_id = ${A.org}`);
      expect(after.n).toBe(Number(before.n) + 1);
    });
  });

  // -------------------------------------------------------------------------
  describe("adoptTeam", () => {
    it("needs groups.manage as well as worship.manage", async () => {
      const g = await t.group(A.org, "team", "Existing greeters");
      expect(await store.adoptTeam(v(A.manager), { groupId: g })).toEqual({ kind: "forbidden" });
      expect(await store.adoptTeam(v(A.groupsManager), { groupId: g })).toEqual({ kind: "ok", data: { groupId: g } });
      expect((await teamRow(g)).name).toBe("Existing greeters");
    });

    it("refuses a group already a team, a committee, the court, another organization's group and an unknown id", async () => {
      const committee = await t.group(A.org, "committee", "Finance");
      const court = await t.group(A.org, "court", "Court-like");
      const elsewhere = await t.group(B.org, "team", "Other org team");
      const taken = await t.group(A.org, "choir", "Already one");
      await t.q(sql`insert into worship_teams (group_id, organization_id) values (${taken}, ${A.org})`);
      for (const groupId of [taken, committee, court]) {
        expect((await store.adoptTeam(v(A.groupsManager), { groupId })).kind, groupId).toBe("invalid_input");
      }
      expect(await store.adoptTeam(v(A.groupsManager), { groupId: elsewhere })).toEqual({ kind: "not_found" });
      expect(await store.adoptTeam(v(A.groupsManager), { groupId: "00000000-0000-4000-8000-000000000000" })).toEqual({ kind: "not_found" });
      expect(await store.adoptTeam(v(A.groupsManager), { groupId: "not-a-uuid" })).toEqual({ kind: "not_found" });
    });

    it("refuses a derived group (the Active Membership roster)", async () => {
      const [derived] = await t.q(sql`select id::text as id from groups where organization_id = ${A.org} and membership_source = 'derived' limit 1`);
      expect((await store.adoptTeam(v(A.groupsManager), { groupId: String(derived!.id) })).kind).toBe("invalid_input");
    });
  });

  // -------------------------------------------------------------------------
  describe("updateTeam", () => {
    it("renames and describes a team and keeps the group's own 'meets when'", async () => {
      const g = await t.team(A.org, "team", "Ushers old");
      await t.q(sql`update groups set meets_when = 'Sundays at 8' where id = ${g}`);
      expect(await store.updateTeam(v(A.manager), { groupId: g, name: " Ushers ", description: "Doors" })).toEqual({ kind: "ok", data: { groupId: g } });
      expect(await teamRow(g)).toMatchObject({ name: "Ushers", description: "Doors", meets_when: "Sundays at 8" });
    });

    it("refuses a blank name, and answers not_found for another organization's team", async () => {
      expect(await store.updateTeam(v(A.manager), { groupId: A.band, name: "" })).toEqual({ kind: "invalid_input", message: TEAMS_COPY.validation.nameRequired });
      expect(await store.updateTeam(v(A.manager), { groupId: B.band, name: "Hijack" })).toEqual({ kind: "not_found" });
      expect((await teamRow(B.band)).name).toBe("Band");
    });
  });

  // -------------------------------------------------------------------------
  describe("retireTeam and retirePosition (refused while anyone is live on an upcoming service)", () => {
    it("a team with a live assignment on an upcoming, uncancelled service is in_use with the number of services", async () => {
      const w = await t.build("ret1");
      await t.draft(w, w.alice, w.sunday);
      await t.draft(w, w.bob, w.midweek);
      const r = await store.retireTeam(v(w.manager, w), { groupId: w.band });
      expect(r).toEqual({ kind: "conflict", reason: "in_use", message: ACTION_COPY.inUse("Band", 2) });
      expect((await teamRow(w.band)).retired_at).toBeNull();
    });

    it("a position is in_use on the services it is scheduled for, and a cancelled service does not count", async () => {
      const w = await t.build("ret2");
      await t.draft(w, w.alice, w.sunday);
      expect(await store.retirePosition(v(w.manager, w), { positionId: w.drums })).toEqual({
        kind: "conflict",
        reason: "in_use",
        message: ACTION_COPY.inUse("Drums", 1),
      });
      expect((await store.retirePosition(v(w.manager, w), { positionId: w.vocals })).kind).toBe("ok");
      await t.q(sql`update events set cancelled_at = now() where id = ${w.sunday}`);
      expect((await store.retirePosition(v(w.manager, w), { positionId: w.drums })).kind).toBe("ok");
    });

    it("retires once the live assignments are gone (withdrawn rows and a started service do not block), and retiring twice is a no-op", async () => {
      const w = await t.build("ret3");
      const a = await t.draft(w, w.alice, w.sunday);
      await t.inOrg(w.org, (tx) =>
        tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed' where id = ${a}`),
      );
      expect(await store.retireTeam(v(w.manager, w), { groupId: w.band })).toEqual({ kind: "ok", data: { groupId: w.band } });
      const first = (await teamRow(w.band)).retired_at;
      expect(first).not.toBeNull();
      expect((await store.retireTeam(v(w.manager, w), { groupId: w.band })).kind).toBe("ok");
      expect(String((await teamRow(w.band)).retired_at)).toBe(String(first));
    });

    it("a retired team takes no new position and no roster row", async () => {
      const w = await t.build("ret4");
      expect((await store.retireTeam(v(w.manager, w), { groupId: w.choir })).kind).toBe("ok");
      expect(await store.addPosition(v(w.manager, w), { groupId: w.choir, name: "Tenor", slots: 1 })).toEqual({
        kind: "conflict",
        reason: "not_open",
        message: ACTION_COPY.teamRetired("Choir"),
      });
      const r = await store.addTeamMember(v(w.manager, w), { groupId: w.choir, personId: w.bob });
      expect(r).toEqual({ kind: "conflict", reason: "not_open", message: ACTION_COPY.teamRetired("Choir") });
    });
  });

  // -------------------------------------------------------------------------
  describe("positions", () => {
    it("adds in order, trims, and refuses a duplicate name case-insensitively with the Copy sentence", async () => {
      const w = await t.build("pos1");
      const a = await store.addPosition(v(w.manager, w), { groupId: w.band, name: "  Bass guitar ", slots: 2 });
      const b = await store.addPosition(v(w.manager, w), { groupId: w.band, name: "Keys", slots: 1 });
      expect(a.kind).toBe("ok");
      expect(b.kind).toBe("ok");
      const names = (await positions(w.band)).map((p) => p.name);
      expect(names.slice(-2)).toEqual(["Bass guitar", "Keys"]);
      const dup = await store.addPosition(v(w.manager, w), { groupId: w.band, name: "bass GUITAR", slots: 1 });
      expect(dup).toEqual({ kind: "conflict", reason: "duplicate_name", message: TEAMS_COPY.validation.positionDuplicate("bass GUITAR") });
    });

    it("the same name on a different team, or after the first is retired, is fine", async () => {
      const w = await t.build("pos2");
      expect((await store.addPosition(v(w.manager, w), { groupId: w.choir, name: "Drums", slots: 1 })).kind).toBe("ok");
      expect((await store.retirePosition(v(w.manager, w), { positionId: w.drums })).kind).toBe("ok");
      expect((await store.addPosition(v(w.manager, w), { groupId: w.band, name: "drums", slots: 1 })).kind).toBe("ok");
    });

    it("limits: name 60, slots 1 to 20 and whole, at most 40 live positions", async () => {
      const w = await t.build("pos3");
      expect(await store.addPosition(v(w.manager, w), { groupId: w.band, name: "x".repeat(61), slots: 1 })).toEqual({
        kind: "invalid_input",
        message: TEAMS_COPY.validation.positionNameTooLong,
      });
      expect((await store.addPosition(v(w.manager, w), { groupId: w.band, name: "x".repeat(60), slots: 1 })).kind).toBe("ok");
      for (const slots of [0, 21, 1.5, Number.NaN, -1]) {
        expect(await store.addPosition(v(w.manager, w), { groupId: w.band, name: `s${slots}`, slots }), String(slots)).toEqual({
          kind: "invalid_input",
          message: TEAMS_COPY.validation.slotsRange,
        });
      }
      expect((await store.addPosition(v(w.manager, w), { groupId: w.band, name: "twenty", slots: 20 })).kind).toBe("ok");
      // The band has Drums, Vocals, the 60-character one and "twenty": 4 live. Fill to 40, then refuse the 41st.
      for (let i = 0; i < 36; i += 1) {
        expect((await store.addPosition(v(w.manager, w), { groupId: w.band, name: `Filler ${i}`, slots: 1 })).kind, `filler ${i}`).toBe("ok");
      }
      expect(await store.addPosition(v(w.manager, w), { groupId: w.band, name: "One too many", slots: 1 })).toEqual({
        kind: "conflict",
        reason: "over_cap",
        message: TEAMS_COPY.validation.positionLimit,
      });
      // Retiring one frees a place.
      const [filler] = await t.q(sql`select id::text as id from worship_positions where group_id = ${w.band} and name = 'Filler 0'`);
      expect((await store.retirePosition(v(w.manager, w), { positionId: String(filler!.id) })).kind).toBe("ok");
      expect((await store.addPosition(v(w.manager, w), { groupId: w.band, name: "Now fits", slots: 1 })).kind).toBe("ok");
    });

    it("two simultaneous adds of one name: one succeeds, one is the duplicate (the advisory lock)", async () => {
      const w = await t.build("pos4");
      const [x, y] = await Promise.all([
        store.addPosition(v(w.manager, w), { groupId: w.band, name: "Banjo", slots: 1 }),
        store.addPosition(v(w.manager, w), { groupId: w.band, name: "Banjo", slots: 1 }),
      ]);
      expect([x.kind, y.kind].sort()).toEqual(["conflict", "ok"]);
      const live = await t.q(sql`select 1 from worship_positions where group_id = ${w.band} and lower(name) = 'banjo' and retired_at is null`);
      expect(live).toHaveLength(1);
    });

    it("updatePosition renames and resizes; a name clash and a retired position are refused; another organization's id is not_found", async () => {
      const w = await t.build("pos5");
      expect(await store.updatePosition(v(w.manager, w), { positionId: w.drums, name: "Drum kit", slots: 3 })).toEqual({ kind: "ok", data: { positionId: w.drums } });
      expect((await positions(w.band)).find((p) => p.id === w.drums)).toMatchObject({ name: "Drum kit", slots: 3 });
      expect((await store.updatePosition(v(w.manager, w), { positionId: w.drums, name: "VOCALS", slots: 1 })).kind).toBe("conflict");
      expect((await store.updatePosition(v(w.manager, w), { positionId: w.drums, name: "Drum kit", slots: 0 })).kind).toBe("invalid_input");
      expect((await store.retirePosition(v(w.manager, w), { positionId: w.vocals })).kind).toBe("ok");
      expect(await store.updatePosition(v(w.manager, w), { positionId: w.vocals, name: "Back vocals", slots: 2 })).toMatchObject({ kind: "conflict", reason: "not_open" });
      expect(await store.updatePosition(v(w.manager, w), { positionId: B.drums, name: "Hijack", slots: 1 })).toEqual({ kind: "not_found" });
      expect((await positions(B.band)).find((p) => p.id === B.drums)!.name).toBe("Drums");
    });

    it("lowering slots below the people already placed leaves them placed", async () => {
      const w = await t.build("pos6");
      await t.draft(w, w.alice, w.sunday, w.vocals);
      await t.draft(w, w.bob, w.sunday, w.vocals);
      expect((await store.updatePosition(v(w.manager, w), { positionId: w.vocals, name: "Vocals", slots: 1 })).kind).toBe("ok");
      const live = await t.q(sql`select 1 from worship_assignments where position_id = ${w.vocals} and status = 'draft'`);
      expect(live).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  describe("setQualifications", () => {
    it("replace-set: adds the new, ends the removed, leaves the kept, and a repeat changes nothing", async () => {
      const w = await t.build("q1");
      const r1 = await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [w.drums, w.vocals] });
      expect(r1).toEqual({ kind: "ok", data: { added: 2, ended: 0 } });
      const r2 = await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [w.vocals] });
      expect(r2).toEqual({ kind: "ok", data: { added: 0, ended: 1 } });
      const r3 = await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [w.vocals, w.vocals] });
      expect(r3).toEqual({ kind: "ok", data: { added: 0, ended: 0 } });
      const live = await t.q(sql`select position_id::text as p from worship_position_qualifications where person_id = ${w.alice} and ended_at is null`);
      expect(live.map((r) => r.p)).toEqual([w.vocals]);
      const history = await t.q(sql`select 1 from worship_position_qualifications where person_id = ${w.alice}`);
      expect(history).toHaveLength(2);
      // Marking someone again after ending is a fresh row, not a revival.
      expect(await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [w.drums, w.vocals] })).toEqual({ kind: "ok", data: { added: 1, ended: 0 } });
      expect(await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [] })).toEqual({ kind: "ok", data: { added: 0, ended: 2 } });
    });

    it("a person who is not on the team's roster now is refused by name; a position of another team or a retired one is refused", async () => {
      const w = await t.build("q2");
      const refused = await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.plain, positionIds: [w.drums] });
      expect(refused).toEqual({ kind: "conflict", reason: "not_open", message: ACTION_COPY.notOnTeam("Plain Worshiptest") });
      expect((await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [w.soprano] })).kind).toBe("invalid_input");
      expect((await store.retirePosition(v(w.manager, w), { positionId: w.vocals })).kind).toBe("ok");
      expect((await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [w.vocals] })).kind).toBe("invalid_input");
      expect((await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: ["nope"] })).kind).toBe("invalid_input");
    });

    it("another organization's team or person is not_found, and nothing is written", async () => {
      expect(await store.setQualifications(v(A.manager), { groupId: B.band, personId: B.alice, positionIds: [B.drums] })).toEqual({ kind: "not_found" });
      expect(await store.setQualifications(v(A.manager), { groupId: A.band, personId: B.alice, positionIds: [A.drums] })).toEqual({ kind: "not_found" });
      expect(await t.q(sql`select 1 from worship_position_qualifications where organization_id = ${B.org}`)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("the roster: member rows only, through the groups.ts primitives", () => {
    it("adds a member starting today, is a no-op for someone already on the team, and records the change", async () => {
      const w = await t.build("r1");
      expect(await store.addTeamMember(v(w.manager, w), { groupId: w.choir, personId: w.bob })).toEqual({ kind: "ok", data: { changed: true } });
      const row = await t.one(sql`select group_role, source, starts_on::text as starts_on, ends_on from group_memberships
                                   where group_id = ${w.choir} and person_id = ${w.bob}`);
      const today = await t.one(sql`select presby_worship_org_today(${w.org})::text as d`);
      expect(row).toMatchObject({ group_role: "member", source: "managed", starts_on: today.d, ends_on: null });
      expect(await store.addTeamMember(v(w.manager, w), { groupId: w.choir, personId: w.bob })).toEqual({ kind: "ok", data: { changed: false } });
      // A chair is already on the team: also no write, and no second (member) row.
      expect(await store.addTeamMember(v(w.manager, w), { groupId: w.band, personId: w.leader })).toEqual({ kind: "ok", data: { changed: false } });
      expect(await t.q(sql`select 1 from group_memberships where group_id = ${w.band} and person_id = ${w.leader}`)).toHaveLength(1);
    });

    it("refuses a person with no current record at the organization, with the Copy sentence; the roster never takes a chair or leader row", async () => {
      const w = await t.build("r2");
      const stranger = await t.fx.makePerson("Stranger", "Worshiptest");
      const r = await store.addTeamMember(v(w.manager, w), { groupId: w.choir, personId: stranger });
      expect(r.kind).toBe("invalid_input");
      expect(r).toMatchObject({ message: TEAMS_COPY.validation.notOnRoll(`Fixture r2 for wcfg`) });
      // The input has no role parameter at all: every new row is a member row.
      await store.addTeamMember(v(w.manager, w), { groupId: w.choir, personId: w.child });
      const roles = await t.q(sql`select group_role from group_memberships where group_id = ${w.choir} and person_id = ${w.child}`);
      expect(roles.map((x) => x.group_role)).toEqual(["member"]);
    });

    it("a group that carries a live role grant is role_bound for add and for end, and an ended grant is not", async () => {
      const w = await t.build("r3");
      const roleId = await t.fx.makeRole(w.org, "bound_role", ["directory.view"]);
      await t.q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${w.org}, ${roleId}, ${w.band}, '2020-01-01')`);
      const bound = { kind: "conflict", reason: "role_bound", message: ACTION_COPY.roleBound };
      expect(await store.addTeamMember(v(w.manager, w), { groupId: w.band, personId: w.plain })).toEqual(bound);
      const [bobRow] = await t.q(sql`select id::text as id from group_memberships where group_id = ${w.band} and person_id = ${w.bob}`);
      expect(await store.endTeamMember(v(w.manager, w), { groupId: w.band, groupMembershipId: String(bobRow!.id) })).toEqual(bound);
      await t.q(sql`update role_grants set ends_on = '2021-01-01' where group_id = ${w.band}`);
      expect((await store.addTeamMember(v(w.manager, w), { groupId: w.band, personId: w.plain })).kind).toBe("ok");
    });

    it("ends a member row (end-dated to today, never deleted), refuses a chair or leader row, and a repeat is a no-op", async () => {
      const w = await t.build("r4");
      const [bobRow] = await t.q(sql`select id::text as id from group_memberships where group_id = ${w.band} and person_id = ${w.bob}`);
      const id = String(bobRow!.id);
      expect(await store.endTeamMember(v(w.manager, w), { groupId: w.band, groupMembershipId: id })).toEqual({ kind: "ok", data: { changed: true } });
      const ended = await t.one(sql`select ends_on::text as ends_on from group_memberships where id = ${id}`);
      const today = await t.one(sql`select presby_worship_org_today(${w.org})::text as d`);
      expect(ended.ends_on).toBe(today.d);
      expect(await store.endTeamMember(v(w.manager, w), { groupId: w.band, groupMembershipId: id })).toEqual({ kind: "ok", data: { changed: false } });
      const [seat] = await t.q(sql`select id::text as id from group_memberships where group_id = ${w.band} and person_id = ${w.leader}`);
      expect(await store.endTeamMember(v(w.manager, w), { groupId: w.band, groupMembershipId: String(seat!.id) })).toEqual({
        kind: "invalid_input",
        message: TEAMS_COPY.validation.seatsUnderGroups,
      });
      expect((await t.one(sql`select ends_on from group_memberships where id = ${String(seat!.id)}`)).ends_on).toBeNull();
      expect(await t.q(sql`select 1 from group_memberships where id = ${id}`)).toHaveLength(1);
    });

    it("another team's or another organization's membership id is not_found", async () => {
      const [other] = await t.q(sql`select id::text as id from group_memberships where group_id = ${B.band} and person_id = ${B.bob}`);
      expect(await store.endTeamMember(v(A.manager), { groupId: A.band, groupMembershipId: String(other!.id) })).toEqual({ kind: "not_found" });
      const [aliceChoir] = await t.q(sql`select id::text as id from group_memberships where group_id = ${A.choir} and person_id = ${A.alice}`);
      expect(await store.endTeamMember(v(A.manager), { groupId: A.band, groupMembershipId: String(aliceChoir!.id) })).toEqual({ kind: "not_found" });
    });
  });

  // -------------------------------------------------------------------------
  describe("service types", () => {
    it("creates a type with default teams, trims, stores HH:MM as a time, and lists it", async () => {
      const w = await t.build("st1");
      const r = await store.createServiceType(v(w.manager, w), {
        name: " Sunday worship ",
        startTime: "09:30",
        durationMinutes: 75,
        location: " Sanctuary ",
        groupIds: [w.band, w.choir, w.band],
      });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      const list = await reads.getServiceTypes(v(w.manager, w));
      expect(list.kind).toBe("ok");
      if (list.kind !== "ok") return;
      expect(list.data).toEqual([
        {
          id: r.data.serviceTypeId,
          name: "Sunday worship",
          startTime: "09:30",
          durationMinutes: 75,
          location: "Sanctuary",
          retired: false,
          teamIds: [w.band, w.choir].sort(),
        },
      ]);
    });

    it("refuses bad input: name length, duplicate (case-insensitive), time, duration, location, a retired or foreign team", async () => {
      const w = await t.build("st2");
      const ok = await store.createServiceType(v(w.manager, w), { name: "Evening prayer", startTime: "18:00" });
      expect(ok.kind).toBe("ok");
      expect(await store.createServiceType(v(w.manager, w), { name: "evening PRAYER", startTime: "18:00" })).toEqual({
        kind: "conflict",
        reason: "duplicate_name",
        message: "You already have a service type called evening PRAYER.",
      });
      expect((await store.createServiceType(v(w.manager, w), { name: "  ", startTime: "09:00" })).kind).toBe("invalid_input");
      expect((await store.createServiceType(v(w.manager, w), { name: "x".repeat(81), startTime: "09:00" })).kind).toBe("invalid_input");
      for (const startTime of ["9:00", "24:00", "09:60", "09:00:00", "noon", ""]) {
        expect((await store.createServiceType(v(w.manager, w), { name: `T ${startTime}`, startTime })).kind, startTime).toBe("invalid_input");
      }
      for (const durationMinutes of [14, 481, 30.5]) {
        expect((await store.createServiceType(v(w.manager, w), { name: `D ${durationMinutes}`, startTime: "09:00", durationMinutes })).kind, String(durationMinutes)).toBe("invalid_input");
      }
      expect((await store.createServiceType(v(w.manager, w), { name: "D15", startTime: "09:00", durationMinutes: 15 })).kind).toBe("ok");
      expect((await store.createServiceType(v(w.manager, w), { name: "D480", startTime: "09:00", durationMinutes: 480 })).kind).toBe("ok");
      expect((await store.createServiceType(v(w.manager, w), { name: "L201", startTime: "09:00", location: "l".repeat(201) })).kind).toBe("invalid_input");
      expect((await store.createServiceType(v(w.manager, w), { name: "Foreign", startTime: "09:00", groupIds: [B.band] })).kind).toBe("invalid_input");
      expect((await store.retireTeam(v(w.manager, w), { groupId: w.choir })).kind).toBe("ok");
      expect((await store.createServiceType(v(w.manager, w), { name: "Retired team", startTime: "09:00", groupIds: [w.choir] })).kind).toBe("invalid_input");
    });

    it("update changes the fields and, when groupIds is given, replaces the default teams in the same transaction; a retired type is refused", async () => {
      const w = await t.build("st3");
      const made = await store.createServiceType(v(w.manager, w), { name: "Usual", startTime: "10:00", groupIds: [w.band] });
      if (made.kind !== "ok") throw new Error("setup");
      const id = made.data.serviceTypeId;
      expect(await store.updateServiceType(v(w.manager, w), { serviceTypeId: id, name: "Usual Sunday", startTime: "10:30", durationMinutes: null, location: null, groupIds: [w.choir] })).toEqual({ kind: "ok", data: { serviceTypeId: id } });
      const got = await reads.getServiceType(v(w.manager, w), { serviceTypeId: id });
      expect(got).toMatchObject({ kind: "ok", data: { name: "Usual Sunday", startTime: "10:30", durationMinutes: null, location: null, teamIds: [w.choir] } });
      // Omitting groupIds leaves the teams alone.
      await store.updateServiceType(v(w.manager, w), { serviceTypeId: id, name: "Usual Sunday", startTime: "10:30" });
      expect(await reads.getServiceType(v(w.manager, w), { serviceTypeId: id })).toMatchObject({ data: { teamIds: [w.choir] } });
      expect((await store.retireServiceType(v(w.manager, w), { serviceTypeId: id })).kind).toBe("ok");
      expect(await store.updateServiceType(v(w.manager, w), { serviceTypeId: id, name: "Again", startTime: "10:30" })).toMatchObject({ kind: "conflict", reason: "not_open" });
      expect(await store.setServiceTypeTeams(v(w.manager, w), { serviceTypeId: id, groupIds: [] })).toMatchObject({ kind: "conflict", reason: "not_open" });
      // Retiring again is a no-op, and a retired type's name is free again.
      expect((await store.retireServiceType(v(w.manager, w), { serviceTypeId: id })).kind).toBe("ok");
      expect((await store.createServiceType(v(w.manager, w), { name: "Usual Sunday", startTime: "09:00" })).kind).toBe("ok");
    });

    it("setServiceTypeTeams removes, keeps and re-adds a team (the removed row is cleared, not duplicated)", async () => {
      const w = await t.build("st4");
      const made = await store.createServiceType(v(w.manager, w), { name: "Mix", startTime: "09:00", groupIds: [w.band, w.choir] });
      if (made.kind !== "ok") throw new Error("setup");
      const id = made.data.serviceTypeId;
      expect((await store.setServiceTypeTeams(v(w.manager, w), { serviceTypeId: id, groupIds: [w.band] })).kind).toBe("ok");
      expect(await reads.getServiceType(v(w.manager, w), { serviceTypeId: id })).toMatchObject({ data: { teamIds: [w.band] } });
      expect((await store.setServiceTypeTeams(v(w.manager, w), { serviceTypeId: id, groupIds: [w.band, w.choir] })).kind).toBe("ok");
      expect(await reads.getServiceType(v(w.manager, w), { serviceTypeId: id })).toMatchObject({ data: { teamIds: [w.band, w.choir].sort() } });
      expect(await t.q(sql`select 1 from worship_service_type_teams where service_type_id = ${id}`)).toHaveLength(2);
      expect((await store.setServiceTypeTeams(v(w.manager, w), { serviceTypeId: id, groupIds: ["nope"] })).kind).toBe("invalid_input");
    });

    it("another organization's type is not_found; a plan-only holder can read the list and the form options but not write", async () => {
      const w = await t.build("st5");
      const made = await store.createServiceType(v(B.manager, B), { name: "Theirs", startTime: "09:00" });
      if (made.kind !== "ok") throw new Error("setup");
      expect(await store.retireServiceType(v(w.manager, w), { serviceTypeId: made.data.serviceTypeId })).toEqual({ kind: "not_found" });
      expect(await reads.getServiceType(v(w.manager, w), { serviceTypeId: made.data.serviceTypeId })).toEqual({ kind: "not_found" });
      expect((await reads.getServiceTypes(v(w.planner, w))).kind).toBe("ok");
      expect((await reads.getServiceFormOptions(v(w.planner, w))).kind).toBe("ok");
      expect(await reads.getServiceType(v(w.planner, w), { serviceTypeId: made.data.serviceTypeId })).toEqual({ kind: "forbidden" });
      expect(await store.createServiceType(v(w.planner, w), { name: "Nope", startTime: "09:00" })).toEqual({ kind: "forbidden" });
      expect(await reads.getServiceFormOptions(v(w.scheduler, w))).toEqual({ kind: "forbidden" });
    });
  });

  // -------------------------------------------------------------------------
  describe("configuration reads", () => {
    it("getTeamsAdmin: names, kinds, counts, retired last, only this organization", async () => {
      const w = await t.build("rd1");
      await store.createTeam(v(w.manager, w), { name: "Ushers", kind: "team", starter: "ushers" });
      expect((await store.retireTeam(v(w.manager, w), { groupId: w.choir })).kind).toBe("ok");
      const r = await reads.getTeamsAdmin(v(w.manager, w));
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.data.map((x) => x.name)).toEqual(["Band", "Ushers", "Choir"]);
      const band = r.data.find((x) => x.name === "Band")!;
      expect(band).toMatchObject({ kind: "team", retired: false, positionCount: 2, peopleCount: 4 });
      expect(r.data.find((x) => x.name === "Choir")).toMatchObject({ kind: "choir", retired: true });
      expect(r.data.find((x) => x.name === "Ushers")).toMatchObject({ positionCount: 2, peopleCount: 0 });
      expect(r.data.map((x) => x.groupId)).not.toContain(B.band);
    });

    it("getTeamAdmin: positions, the roster with seats first, each person's qualifications, no contact details; other organizations are not_found", async () => {
      const w = await t.build("rd2");
      await store.setQualifications(v(w.manager, w), { groupId: w.band, personId: w.alice, positionIds: [w.drums, w.vocals] });
      await t.email(w.alice, "alice@example.invalid");
      const r = await reads.getTeamAdmin(v(w.manager, w), { groupId: w.band });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.data.positions.map((p) => p.name)).toEqual(["Drums", "Vocals"]);
      expect(r.data.people[0]).toMatchObject({ displayName: "Leader Worshiptest", role: "chair" });
      const alice = r.data.people.find((p) => p.personId === w.alice)!;
      expect(alice.positionIds.sort()).toEqual([w.drums, w.vocals].sort());
      expect(JSON.stringify(r.data)).not.toContain("example.invalid");
      expect(r.data.roleBound).toBe(false);
      expect(await reads.getTeamAdmin(v(w.manager, w), { groupId: B.band })).toEqual({ kind: "not_found" });
      expect(await reads.getTeamAdmin(v(w.manager, w), { groupId: "nope" })).toEqual({ kind: "not_found" });
    });

    it("a person who left the team, was merged, died or whose relationship ended is not on the roster read", async () => {
      const w = await t.build("rd3");
      const [aliceBand] = await t.q(sql`select id::text as id from group_memberships where group_id = ${w.band} and person_id = ${w.alice}`);
      await store.endTeamMember(v(w.manager, w), { groupId: w.band, groupMembershipId: String(aliceBand!.id) });
      await t.q(sql`update people set date_of_death = current_date - 1 where id = ${w.bob}`);
      const r = await reads.getTeamAdmin(v(w.manager, w), { groupId: w.band });
      if (r.kind !== "ok") throw new Error("read");
      expect(r.data.people.map((p) => p.personId).sort()).toEqual([w.leader, w.child].sort());
    });

    it("searchRosterCandidates: at least two characters, current members only, not already on the team, literal LIKE, names only, at most 20", async () => {
      const w = await t.build("rd4");
      expect(await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.choir, q: "b" })).toEqual({ kind: "ok", data: [] });
      const bob = await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.choir, q: "bo" });
      expect(bob).toEqual({ kind: "ok", data: [{ personId: w.bob, displayName: "Bob Worshiptest" }] });
      // Alice is already on the choir; Bob is on the band, so the band search drops him.
      expect(await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.choir, q: "alice" })).toEqual({ kind: "ok", data: [] });
      expect(await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.band, q: "bob" })).toEqual({ kind: "ok", data: [] });
      // A LIKE wildcard is a literal character.
      expect(await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.choir, q: "%%" })).toEqual({ kind: "ok", data: [] });
      expect(await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.choir, q: "__" })).toEqual({ kind: "ok", data: [] });
      // A person in no relationship with the organization is never offered.
      const stranger = await t.fx.makePerson("Zelda", "Elsewhere");
      expect(await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.choir, q: "zelda" })).toEqual({ kind: "ok", data: [] });
      expect(stranger).toBeTruthy();
      // The cap.
      for (let i = 0; i < 25; i += 1) await t.person(w.org, `Zed${String(i).padStart(2, "0")}`);
      const many = await reads.searchRosterCandidates(v(w.manager, w), { groupId: w.choir, q: "zed" });
      expect(many.kind === "ok" && many.data.length).toBe(20);
      expect(await reads.searchRosterCandidates(v(w.manager, w), { groupId: B.band, q: "alice" })).toEqual({ kind: "not_found" });
      const names = JSON.stringify(many);
      expect(names).not.toMatch(/@|example/);
    });

    it("getAdoptableGroups: managed choir and team groups that are not yet teams, groups.manage required", async () => {
      const w = await t.build("rd5");
      const plain = await t.group(w.org, "team", "Free group");
      await t.group(w.org, "committee", "Not a candidate");
      expect(await reads.getAdoptableGroups(v(w.manager, w))).toEqual({ kind: "forbidden" });
      const r = await reads.getAdoptableGroups(v(w.groupsManager, w));
      expect(r).toEqual({ kind: "ok", data: [{ groupId: plain, name: "Free group", kind: "team" }] });
    });

    it("getServiceFormOptions: live types with their live teams and the live teams; none from another organization", async () => {
      const w = await t.build("rd6");
      await store.createServiceType(v(w.manager, w), { name: "Usual", startTime: "09:00", groupIds: [w.band] });
      const gone = await store.createServiceType(v(w.manager, w), { name: "Gone", startTime: "09:00" });
      if (gone.kind === "ok") await store.retireServiceType(v(w.manager, w), { serviceTypeId: gone.data.serviceTypeId });
      await store.retireTeam(v(w.manager, w), { groupId: w.choir });
      const r = await reads.getServiceFormOptions(v(w.planner, w));
      if (r.kind !== "ok") throw new Error("read");
      expect(r.data.types.map((x) => x.name)).toEqual(["Usual"]);
      expect(r.data.teams).toEqual([{ groupId: w.band, name: "Band" }]);
    });
  });

  describe("getWorshipContext", () => {
    it("answers ok with the three keys, toggle_off with the Features link flag, and not_applicable", async () => {
      expect(await reads.getWorshipContext(v(A.all))).toEqual({ kind: "ok", has: { manage: true, plan: true, schedule: true } });
      expect(await reads.getWorshipContext(v(A.plain))).toEqual({ kind: "ok", has: { manage: false, plan: false, schedule: false } });
      expect(await reads.getWorshipContext(v(A.planner))).toEqual({ kind: "ok", has: { manage: false, plan: true, schedule: false } });
      const off = await t.build("ctxoff", { toggle: false });
      const featureManager = await t.person(off.org, "Featmgr", ["org_features.manage"]);
      expect(await reads.getWorshipContext(v(off.plain, off))).toEqual({ kind: "toggle_off", canManageFeatures: false });
      expect(await reads.getWorshipContext(v(featureManager, off))).toEqual({ kind: "toggle_off", canManageFeatures: true });
      expect(await reads.getWorshipContext(t.viewer(PRES.manager, PRES.org, "presbytery"))).toEqual({ kind: "not_applicable" });
    });
  });
});
