/**
 * drizzle/0066_presby_membership_standing.sql on a REAL database: the R51
 * matrix (T-M), Community Increment 3a, Batch A1
 * (docs/work-log/2026-10-22-founding-admin-directory-inc3.md, Phase 3 section
 * 6.3 as amended; DECISION-232, DECISION-233; F177 Option 1).
 *
 * WHAT A1 PROVES HERE (the database half of R51):
 *   - every matrix row M1 to M16: the SQL standing, member standing, the two
 *     derived rows, and the resolved directory.view / events.view, on an
 *     organization built by createOrganization() (so the `member` role and the
 *     groups come from provisioning, never a hand copy);
 *   - the standing transitions on one membership (gain opens with starts_on =
 *     today, loss closes at today, regain reopens, an unrelated update leaves a
 *     closed row's end date alone, a roll approval opens the member row through
 *     the presby_sync_current_roll definer path);
 *   - the SQL cross-product (presby_membership_is_member_standing ==
 *     presby_standing_is_member(presby_membership_standing));
 *   - the two delimited backfill blocks re-executed against a pre-0066 shape
 *     (an open member row and no all row for a visitor), and their idempotence;
 *     an existing org-owned calendar_viewer is never modified;
 *   - the seed include is byte-identical to the calendar block;
 *   - live-catalog scan 1 (the parts 0066 sections 1 to 8 and 10 own).
 *
 * WHAT BATCH A2 ADDED (0066 section 9, the three re-created 0065 bodies):
 *   - the "2b core, connect" column of M1 to M16: the standing core's
 *     refusal, standing and authority_bearing, and auto-connect's verdict for
 *     an authority-free person with a proven address, at the createOrganization()
 *     organization, where `member` (active_membership) and calendar_viewer
 *     (all_memberships) are both live: neither grant counts in T (EC-12, R49),
 *     and connect declines every standing that is not member standing (R55);
 *   - scan 1's section 9 part: the T exclusion list is the four kinds and not
 *     deacons_moderator (D10b), and `standing = 'visitor'` appears in no
 *     function body.
 *
 * WHAT BATCH B ADDED:
 *   - the TypeScript mirror: membershipStanding / isMemberStanding equal the
 *     SQL classifier across the cross-product (R51's one-definition pin, the
 *     database half; the pure half is membership-standing.test.ts);
 *   - the "in getDirectory" and "Community list" columns of M1 to M16, read
 *     through the real library functions as a people.manage viewer.
 *   Scans 2 and 3 (the source and writer scans) are DB-free and live in
 *   src/lib/membership-standing.source.test.ts.
 *
 * calendar_viewer: since Batch B createOrganization() seeds it (the plan binds
 * it to All Current Records), so the beforeAll re-execution of 0066's own
 * delimited backfill-calendar-viewer block (the documented repair for an
 * organization created by old code, EC-45) is a no-op for the matrix
 * organization. It stays, as the A2 hand-off asked: it is the proof that the
 * repair block is idempotent against a provisioned organization.
 *
 * SERIAL: the backfill blocks are global (they act on every organization),
 * and the harness disables triggers around teardown.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/membership-standing.db.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { MembershipStandingFixture } from "@/lib/testing/membership-standing-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });
// org-provisioning.ts -> org-features.ts -> @/lib/audit -> @/auth (next-auth),
// which this environment cannot load. Nothing here records an audit row.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

// Found by name, not number (the orchestrator may renumber at integration).
const M66_FILE = readdirSync(path.join(process.cwd(), "drizzle")).filter((f) =>
  /^\d{4}_presby_membership_standing\.sql$/.test(f),
);
if (M66_FILE.length !== 1) throw new Error(`expected one *_presby_membership_standing.sql, found ${M66_FILE.length}`);
const M66_TEXT = readFileSync(path.join(process.cwd(), "drizzle", M66_FILE[0]!), "utf8");
const SEED_INCLUDE = readFileSync(
  path.join(process.cwd(), "scripts", "membership-standing", "seed-dev-membership-standing.sql"),
  "utf8",
);

/** The SQL between `-- BEGIN <name>` and `-- END <name>` in 0066. */
function block(name: string): string {
  const start = M66_TEXT.indexOf(`-- BEGIN ${name}\n`);
  const end = M66_TEXT.indexOf(`-- END ${name}\n`);
  if (start < 0 || end < 0 || end < start) throw new Error(`block ${name} not found in 0066`);
  return M66_TEXT.slice(start + `-- BEGIN ${name}\n`.length, end);
}

type Expect = {
  standing: string;
  member: boolean;
  allOpen: boolean;
  memberRow: "open" | "closed" | "none";
  directory?: boolean;
  events?: boolean;
};

describe.skipIf(!hasDb)("drizzle/0066 member standing: the R51 matrix (Postgres-backed)", () => {
  let fx: MembershipStandingFixture;
  let orgM: string; // createOrganization(), then the calendar block
  let today: string;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/membership-standing-fixture");
    fx = await mod.createMembershipStandingFixture("ms66");
    today = await fx.today();
    const { createOrganization } = await import("@/lib/org-provisioning");
    const result = await createOrganization({
      name: `Fixture matrix for ms66 ${fx.stamp}`,
      slug: `ms66-matrix-${fx.stamp}`,
      organizationType: "congregation",
      platformStatus: "managed",
    });
    if (result.kind !== "ok") throw new Error(`createOrganization: ${result.kind}`);
    orgM = result.organizationId;
    fx.trackOrg(orgM);
    // EC-45's repair. A no-op since Batch B (createOrganization() seeds
    // calendar_viewer itself); kept as the idempotence proof.
    await fx.platform.transaction(async (tx) => {
      await tx.execute(sql.raw(block("backfill-calendar-viewer")));
    });
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("premise: the matrix organization has the pair, `member` on active_membership and calendar_viewer on all_memberships", async () => {
    const rows = await fx.q(sql`
      select r.key, g.derived_from, array_agg(p.permission_key order by p.permission_key) as perms
        from app_roles r
        join role_grants rg on rg.role_id = r.id and rg.ends_on is null
        join groups g on g.id = rg.group_id
        join app_role_permissions p on p.role_id = r.id
       where r.organization_id = ${orgM} and r.key in ('member', 'calendar_viewer')
       group by r.key, g.derived_from order by r.key`);
    expect(rows).toEqual([
      { key: "calendar_viewer", derived_from: "all_memberships", perms: ["events.view"] },
      { key: "member", derived_from: "active_membership", perms: ["directory.view", "events.view"] },
    ]);
  });

  // M1 to M16 (Phase 3 section 6.3). `undefined` = not asserted in A1.
  const matrix: Array<[string, () => Promise<string>, Expect]> = [
    ["M1 active / regular", async () => m("active", "regular"), { standing: "listed", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M2 active / visitor (enrolled visitor)", async () => m("active", "visitor"), { standing: "listed", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M3 active / inactive", async () => m("active", "inactive"), { standing: "listed", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M4 other_participant / regular", async () => m("other_participant", "regular"), { standing: "listed", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M5 other_participant / visitor", async () => m("other_participant", "visitor"), { standing: "listed", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M6 null / regular", async () => m(null, "regular"), { standing: "listed", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M7 null / staff (DECISION-207: the anchor resolves directory.view)", async () => m(null, "staff"), { standing: "staff_anchor", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M8 null / visitor", async () => m(null, "visitor"), { standing: "visitor", member: false, allOpen: true, memberRow: "none", directory: false, events: true }],
    ["M9 null / inactive", async () => m(null, "inactive"), { standing: "inactive", member: false, allOpen: true, memberRow: "none", directory: false, events: true }],
    ["M10 null / moved_away", async () => m(null, "moved_away"), { standing: "inactive", member: false, allOpen: true, memberRow: "none", directory: false, events: true }],
    ["M11 unlisted roll / visitor (owner-path fixture)", async () => m("zzz", "visitor"), { standing: "visitor", member: false, allOpen: true, memberRow: "none", directory: false, events: true }],
    ["M12 unlisted roll / regular", async () => m("zzz", "regular"), { standing: "listed", member: true, allOpen: true, memberRow: "open", directory: true, events: true }],
    ["M13 regular, then ended", async () => {
      const id = await m(null, "regular");
      await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'moved away' where id = ${id}`);
      return id;
    }, { standing: "listed", member: true, allOpen: false, memberRow: "closed", directory: false, events: false }],
    ["M14 visitor, ended with the archive marker", async () => {
      const id = await m(null, "visitor");
      await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'community_archived' where id = ${id}`);
      return id;
    }, { standing: "visitor", member: false, allOpen: false, memberRow: "none", directory: false, events: false }],
    ["M15 regular, person deceased", async () => {
      const p = await fx.person("Deceased", { deceased: true });
      return fx.membership(orgM, p, null, "regular");
    }, { standing: "listed", member: true, allOpen: true, memberRow: "open" }],
    ["M16 regular, person merged", async () => {
      const survivor = await fx.person("Survivor");
      const p = await fx.person("Merged");
      const id = await fx.membership(orgM, p, null, "regular");
      await fx.q(sql`update people set merged_into_id = ${survivor} where id = ${p}`);
      return id;
    }, { standing: "listed", member: true, allOpen: true, memberRow: "open" }],
  ];

  async function m(roll: string | null, engagement: string): Promise<string> {
    const p = await fx.person();
    return fx.membership(orgM, p, roll, engagement);
  }

  it.each(matrix)("%s", async (_name, build, e) => {
    const membershipId = await build();
    const [row] = await fx.q(sql`
      select m.person_id,
             presby_membership_standing(m.current_roll, m.engagement_status) as standing,
             presby_membership_is_member_standing(m.current_roll, m.engagement_status) as member
        from memberships m where m.id = ${membershipId}`);
    expect(row!.standing, "SQL standing").toBe(e.standing);
    expect(row!.member, "member standing").toBe(e.member);

    const rows = await fx.derivedRows(membershipId);
    expect(rows.all_memberships, "all row exists for every membership").toBeDefined();
    expect(rows.all_memberships!.endsOn === null, "all row open").toBe(e.allOpen);
    if (e.memberRow === "none") expect(rows.active_membership, "no member row").toBeUndefined();
    else expect(rows.active_membership?.endsOn === null, "member row open").toBe(e.memberRow === "open");

    const personId = String(row!.person_id);
    if (e.directory !== undefined) expect(await fx.hasPermission(personId, orgM, "directory.view"), "directory.view").toBe(e.directory);
    if (e.events !== undefined) expect(await fx.hasPermission(personId, orgM, "events.view"), "events.view").toBe(e.events);
  });

  // The "2b core, connect" column (Phase 3 section 6.3; Batch A2). Each row
  // is built by the same builder as the matrix above, then given a main
  // address and a proven, unlinked account. connect runs as presby_app inside
  // a transaction that is always rolled back (it links on success).
  type Connect = { refusal: string | null; standing: string | null; verdict: "connected" | "declined" };
  const connectColumn: Record<string, Connect> = {
    "M1 active / regular": { refusal: null, standing: "listed", verdict: "connected" },
    "M2 active / visitor (enrolled visitor)": { refusal: null, standing: "listed", verdict: "connected" },
    "M3 active / inactive": { refusal: null, standing: "listed", verdict: "connected" },
    "M4 other_participant / regular": { refusal: null, standing: "listed", verdict: "connected" },
    "M5 other_participant / visitor": { refusal: null, standing: "listed", verdict: "connected" },
    "M6 null / regular": { refusal: null, standing: "listed", verdict: "connected" },
    "M7 null / staff (DECISION-207: the anchor resolves directory.view)": { refusal: null, standing: "staff_anchor", verdict: "connected" },
    "M8 null / visitor": { refusal: null, standing: "visitor", verdict: "declined" },
    "M9 null / inactive": { refusal: null, standing: "inactive", verdict: "declined" },
    "M10 null / moved_away": { refusal: null, standing: "inactive", verdict: "declined" },
    "M11 unlisted roll / visitor (owner-path fixture)": { refusal: null, standing: "visitor", verdict: "declined" },
    "M12 unlisted roll / regular": { refusal: null, standing: "listed", verdict: "connected" },
    "M13 regular, then ended": { refusal: "membership_ended", standing: null, verdict: "declined" },
    "M14 visitor, ended with the archive marker": { refusal: "membership_ended", standing: null, verdict: "declined" },
    "M15 regular, person deceased": { refusal: "person_deceased", standing: "listed", verdict: "declined" },
    "M16 regular, person merged": { refusal: "person_merged", standing: "listed", verdict: "declined" },
  };

  it("premise: every matrix row has a connect-column expectation, and the organization's auto-connect toggle is on", async () => {
    expect(Object.keys(connectColumn).sort()).toEqual(matrix.map(([name]) => name).sort());
    await fx.enableConnect(orgM);
  });

  it.each(matrix)("connect column, %s", async (name, build) => {
    const e = connectColumn[name]!;
    await fx.enableConnect(orgM);
    const membershipId = await build();
    const [mr] = await fx.q(sql`select person_id from memberships where id = ${membershipId}`);
    const personId = String(mr!.person_id);
    const userId = await fx.user(await fx.addEmail(personId));

    const [core] = await fx.q(sql`select * from presby__person_sign_in_standing(${personId}::uuid, ${orgM}::uuid)`);
    expect(core!.refusal ?? null, "core refusal").toBe(e.refusal);
    expect(core!.standing ?? null, "core standing").toBe(e.standing);
    expect(core!.authority_bearing, "member and calendar_viewer are outside T (EC-12)").toBe(false);
    expect(core!.role_keys, "no role in T").toEqual([]);

    let verdict: unknown;
    try {
      await fx.appDb.transaction(async (tx) => {
        const r = await tx.execute(sql`select outcome from presby_connect_signed_in_account(${userId}::uuid, false)`);
        verdict = ((r as unknown as { rows: Array<{ outcome: string }> }).rows)[0]!.outcome;
        throw new Error("rollback");
      });
    } catch (err) {
      if ((err as Error).message !== "rollback") throw err;
    }
    expect(verdict, "connect, no second factor").toBe(e.verdict);
  });

  // The "in getDirectory" and "Community list" columns (Batch B), through the
  // real library functions as a viewer who holds people.manage (the Community
  // lists) and, as a listed member of the organization, directory.view.
  const listsColumn: Record<string, { directory: boolean; list: "visitors" | "inactive" | "staff" | "former" | null }> = {
    "M1 active / regular": { directory: true, list: null },
    "M2 active / visitor (enrolled visitor)": { directory: true, list: null },
    "M3 active / inactive": { directory: true, list: null },
    "M4 other_participant / regular": { directory: true, list: null },
    "M5 other_participant / visitor": { directory: true, list: null },
    "M6 null / regular": { directory: true, list: null },
    "M7 null / staff (DECISION-207: the anchor resolves directory.view)": { directory: false, list: "staff" },
    "M8 null / visitor": { directory: false, list: "visitors" },
    "M9 null / inactive": { directory: false, list: "inactive" },
    "M10 null / moved_away": { directory: false, list: "inactive" },
    "M11 unlisted roll / visitor (owner-path fixture)": { directory: false, list: "visitors" },
    "M12 unlisted roll / regular": { directory: true, list: null },
    "M13 regular, then ended": { directory: false, list: null },
    "M14 visitor, ended with the archive marker": { directory: false, list: "former" },
    "M15 regular, person deceased": { directory: false, list: null },
    "M16 regular, person merged": { directory: false, list: null },
  };

  describe("the getDirectory and Community list columns (EC-1, EC-22)", () => {
    let viewer: string;

    beforeAll(async () => {
      viewer = await fx.person("Viewer");
      await fx.membership(orgM, viewer, null, "regular");
      const [role] = await fx.q(sql`
        insert into app_roles (organization_id, key, name, role_kind)
        values (${orgM}, 'ms66_manager', 'Standing fixture manager', 'custom') returning id`);
      await fx.q(sql`insert into app_role_permissions (role_id, permission_key) values (${String(role!.id)}, 'people.manage')`);
      await fx.q(sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on)
        values (${orgM}, ${String(role!.id)}, ${viewer}, date '2020-01-01')`);
    });

    it("premise: every matrix row has a lists-column expectation, and the viewer holds both keys", async () => {
      expect(Object.keys(listsColumn).sort()).toEqual(matrix.map(([name]) => name).sort());
      expect(await fx.hasPermission(viewer, orgM, "people.manage")).toBe(true);
      expect(await fx.hasPermission(viewer, orgM, "directory.view")).toBe(true);
    });

    it.each(matrix)("%s", async (name, build) => {
      const e = listsColumn[name]!;
      const membershipId = await build();
      const [mr] = await fx.q(sql`select person_id from memberships where id = ${membershipId}`);
      const personId = String(mr!.person_id);

      const { getDirectory } = await import("@/lib/directory");
      const { listVisitors, listInactive, listStaff, listFormer } = await import("@/lib/community");
      const directory = await getDirectory(viewer, orgM, { page: 1, pageSize: 500 });
      if (directory.kind !== "ok") throw new Error("directory not ok");
      expect(directory.entries.map((x) => x.personId).includes(personId), "in getDirectory").toBe(e.directory);

      const readers = { visitors: listVisitors, inactive: listInactive, staff: listStaff, former: listFormer };
      const found: string[] = [];
      for (const [list, reader] of Object.entries(readers)) {
        const result = await reader(viewer, orgM, { page: 1, pageSize: 500 });
        if (result.kind !== "ok") throw new Error(`${list} not ok`);
        if (result.rows.some((r) => r.personId === personId)) found.push(list);
      }
      expect(found, "Community lists").toEqual(e.list === null ? [] : [e.list]);
    });
  });

  describe("transitions on one membership (EC-3, EC-4)", () => {
    it("visitor -> regular opens (today); -> inactive closes (today), all row open; -> regular reopens", async () => {
      const id = await m(null, "visitor");
      expect((await fx.derivedRows(id)).active_membership).toBeUndefined();

      await fx.q(sql`update memberships set engagement_status = 'regular' where id = ${id}`);
      let rows = await fx.derivedRows(id);
      expect(rows.active_membership).toEqual({ startsOn: today, endsOn: null });

      await fx.q(sql`update memberships set engagement_status = 'inactive' where id = ${id}`);
      rows = await fx.derivedRows(id);
      expect(rows.active_membership).toEqual({ startsOn: today, endsOn: today });
      expect(rows.all_memberships!.endsOn).toBeNull();

      await fx.q(sql`update memberships set engagement_status = 'regular' where id = ${id}`);
      rows = await fx.derivedRows(id);
      expect(rows.active_membership).toEqual({ startsOn: today, endsOn: null });
    });

    it("an unrelated update (a household change) leaves a closed member row's end date alone", async () => {
      const id = await m(null, "regular");
      await fx.q(sql`update memberships set engagement_status = 'inactive' where id = ${id}`);
      // Backdate the closed row on the owner path (F240 lets the owner through),
      // so "unchanged" cannot be confused with "rewritten to today".
      await fx.q(sql`
        update group_memberships gm set ends_on = date '2025-01-01'
          from groups g where g.id = gm.group_id and g.derived_from = 'active_membership' and gm.membership_id = ${id}`);
      const [h] = await fx.q(sql`
        insert into households (organization_id, name) values (${orgM}, ${`Household ${fx.stamp}`}) returning id`);
      await fx.q(sql`update memberships set household_id = ${String(h!.id)} where id = ${id}`);
      expect((await fx.derivedRows(id)).active_membership!.endsOn).toBe("2025-01-01");
    });

    it("an approved roll action giving a visitor an active roll opens the member row, through presby_sync_current_roll", async () => {
      const id = await m(null, "visitor");
      const [mr] = await fx.q(sql`select person_id from memberships where id = ${id}`);
      await fx.q(sql`
        insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                                  approval_status, approved_on, minute_reference)
        values (${orgM}, ${String(mr!.person_id)}, 'profession_of_faith', current_date, 'active',
                'approved', current_date, 'Session fixture minute')`);
      const [after] = await fx.q(sql`select current_roll, engagement_status from memberships where id = ${id}`);
      expect(after).toEqual({ current_roll: "active", engagement_status: "visitor" });
      expect((await fx.derivedRows(id)).active_membership).toEqual({ startsOn: today, endsOn: null });
      expect(await fx.hasPermission(String(mr!.person_id), orgM, "directory.view")).toBe(true);
    });
  });

  it("cross-product (SQL): presby_membership_is_member_standing equals presby_standing_is_member(presby_membership_standing) everywhere", async () => {
    const rolls = ["active", "baptized", "affiliate", "other_participant", null, "removed", "zzz"];
    const engagements = ["visitor", "regular", "inactive", "moved_away", "staff", null, "unknown"];
    const rows = await fx.q(sql`
      select r, e, presby_membership_standing(r, e) as standing,
             presby_membership_is_member_standing(r, e) as composed,
             presby_standing_is_member(presby_membership_standing(r, e)) as direct
        from unnest(${sql.raw(`array[${rolls.map((r) => (r === null ? "null" : `'${r}'`)).join(",")}]::text[]`)}) r,
             unnest(${sql.raw(`array[${engagements.map((e) => (e === null ? "null" : `'${e}'`)).join(",")}]::text[]`)}) e`);
    expect(rows).toHaveLength(rolls.length * engagements.length);
    for (const row of rows) {
      expect(row.composed, `${row.r}/${row.e}`).toBe(row.direct);
      expect(row.composed, `${row.r}/${row.e}`).toBe(row.standing === "listed" || row.standing === "staff_anchor");
    }
    const [s] = await fx.q(sql`
      select presby_standing_is_member('listed') as l, presby_standing_is_member('staff_anchor') as s,
             presby_standing_is_member('visitor') as v, presby_standing_is_member('inactive') as i,
             presby_standing_is_member('unclassified') as u, presby_standing_is_member(null) as n`);
    expect(s).toEqual({ l: true, s: true, v: false, i: false, u: false, n: null });
  });

  it("cross-product (TypeScript mirror): membershipStanding, isMemberStanding and isMemberStandingFor equal the SQL classifier everywhere (R51)", async () => {
    const { ENGAGEMENT_STATUSES, LISTED_ROLLS, MEMBERSHIP_STANDINGS, isMemberStanding, isMemberStandingFor, membershipStanding } =
      await import("@/lib/membership-standing");
    const rolls = [...LISTED_ROLLS, null, "removed", "zzz", ""];
    const engagements = [...ENGAGEMENT_STATUSES, null, "unknown", ""];
    const lit = (v: string | null) => (v === null ? "null" : `'${v}'`);
    const rows = await fx.q(sql`
      select r, e, presby_membership_standing(r, e) as standing,
             presby_membership_is_member_standing(r, e) as member
        from unnest(${sql.raw(`array[${rolls.map(lit).join(",")}]::text[]`)}) r,
             unnest(${sql.raw(`array[${engagements.map(lit).join(",")}]::text[]`)}) e`);
    expect(rows).toHaveLength(rolls.length * engagements.length);
    const seen = new Set<string>();
    for (const row of rows) {
      const roll = (row.r as string | null) ?? null;
      const engagement = (row.e as string | null) ?? null;
      const standing = membershipStanding(roll, engagement);
      expect(standing, `${roll}/${engagement}`).toBe(row.standing);
      expect(isMemberStanding(standing), `${roll}/${engagement} member`).toBe(row.member);
      expect(isMemberStandingFor(roll, engagement), `${roll}/${engagement} composed`).toBe(row.member);
      seen.add(standing);
    }
    // The grid reaches every standing, including the fail-closed arm.
    expect([...seen].sort()).toEqual([...MEMBERSHIP_STANDINGS].sort());
    // The SQL classifier's own closed result is the TypeScript vocabulary.
    const [distinct] = await fx.q(sql`
      select array_agg(distinct presby_membership_standing(r, e) order by presby_membership_standing(r, e)) as standings
        from unnest(${sql.raw(`array[${rolls.map(lit).join(",")}]::text[]`)}) r,
             unnest(${sql.raw(`array[${engagements.map(lit).join(",")}]::text[]`)}) e`);
    expect((distinct!.standings as string[]).sort()).toEqual([...MEMBERSHIP_STANDINGS].sort());
  });

  describe("the delimited backfill blocks, re-executed (EC-2, EC-23, EC-41)", () => {
    it("backfill-standing on a pre-0066 shape: the visitor's open member row closes, an all row appears; a second run changes nothing", async () => {
      const orgP = await fx.org("pre66");
      const visitor = await fx.person("Visitor");
      const regular = await fx.person("Regular");
      // The pre-0066 shape: the old sync wrote ONE active_membership row for
      // every membership and no all row. Rebuilt on the owner path with the
      // new sync disabled (rolled back to enabled in finally).
      let vm = "";
      let rm = "";
      await fx.platform.execute(sql`alter table memberships disable trigger memberships_sync_derived_group`);
      try {
        vm = await fx.membership(orgP, visitor, null, "visitor");
        rm = await fx.membership(orgP, regular, null, "regular");
        await fx.q(sql`
          insert into group_memberships (organization_id, group_id, person_id, group_role, source, membership_id, starts_on)
          select m.organization_id, g.id, m.person_id, 'member', 'derived', m.id, date '2024-01-01'
            from memberships m join groups g on g.organization_id = m.organization_id and g.derived_from = 'active_membership'
           where m.id in (${vm}, ${rm})`);
      } finally {
        await fx.platform.execute(sql`alter table memberships enable trigger memberships_sync_derived_group`);
      }
      expect(await fx.derivedRows(vm)).toEqual({ active_membership: { startsOn: "2024-01-01", endsOn: null } });

      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql.raw(block("backfill-standing")));
      });
      expect(await fx.derivedRows(vm)).toEqual({
        active_membership: { startsOn: "2024-01-01", endsOn: today },
        all_memberships: { startsOn: today, endsOn: null },
      });
      expect(await fx.derivedRows(rm)).toEqual({
        active_membership: { startsOn: "2024-01-01", endsOn: null },
        all_memberships: { startsOn: today, endsOn: null },
      });

      const digest = async () =>
        fx.q(sql`select md5(string_agg(gm.id::text || gm.starts_on || coalesce(gm.ends_on::text, '-'), ',' order by gm.id)) as d,
                        count(*)::int as n from group_memberships gm`);
      const before = await digest();
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql.raw(block("backfill-standing")));
      });
      expect(await digest()).toEqual(before);
    });

    it("backfill-calendar-viewer: adds role, permission and grant once; a second run inserts nothing; an existing org-owned calendar_viewer is never modified", async () => {
      const orgC = await fx.org("cal");
      const orgK = await fx.org("keep");
      // orgK already holds an org-owned calendar_viewer carrying something else.
      const [kept] = await fx.q(sql`
        insert into app_roles (organization_id, key, name, role_kind, is_protected)
        values (${orgK}, 'calendar_viewer', 'Tenant calendar role', 'custom', false) returning id`);
      await fx.q(sql`insert into app_role_permissions (role_id, permission_key) values (${String(kept!.id)}, 'directory.view')`);

      const counts = async (orgId: string) => {
        const [row] = await fx.q(sql`
          select (select count(*)::int from app_roles where organization_id = ${orgId}) as roles,
                 (select count(*)::int from app_role_permissions p join app_roles r on r.id = p.role_id where r.organization_id = ${orgId}) as perms,
                 (select count(*)::int from role_grants where organization_id = ${orgId}) as grants`);
        return row!;
      };
      const keptBefore = await counts(orgK);
      expect(await counts(orgC)).toEqual({ roles: 0, perms: 0, grants: 0 });

      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql.raw(block("backfill-calendar-viewer")));
      });
      expect(await counts(orgC)).toEqual({ roles: 1, perms: 1, grants: 1 });
      const [shape] = await fx.q(sql`
        select r.name, r.role_kind, r.is_protected, p.permission_key, g.derived_from, rg.starts_on::text as starts_on,
               rg.granted_by, rg.grant_reason
          from app_roles r join app_role_permissions p on p.role_id = r.id
          join role_grants rg on rg.role_id = r.id join groups g on g.id = rg.group_id
         where r.organization_id = ${orgC} and r.key = 'calendar_viewer'`);
      expect(shape).toEqual({
        name: "Calendar viewer",
        role_kind: "constitutional",
        is_protected: true,
        permission_key: "events.view",
        derived_from: "all_memberships",
        starts_on: today,
        granted_by: null,
        grant_reason: "Baseline calendar role: events.view for everyone with a current record (drizzle/0066, DECISION-232)",
      });
      expect(await counts(orgK), "an existing org-owned calendar_viewer is never modified").toEqual(keptBefore);
      const [keptRole] = await fx.q(sql`select name, role_kind, is_protected from app_roles where id = ${String(kept!.id)}`);
      expect(keptRole).toEqual({ name: "Tenant calendar role", role_kind: "custom", is_protected: false });

      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql.raw(block("backfill-calendar-viewer")));
      });
      expect(await counts(orgC)).toEqual({ roles: 1, perms: 1, grants: 1 });
      expect(await counts(orgK)).toEqual(keptBefore);
    });

    it("an active_membership group inserted after 0066 (the 0082 shape) gets its sibling by trigger and no calendar_viewer until the block runs (EC-41)", async () => {
      const orgL = await fx.org("late");
      const [row] = await fx.q(sql`
        select (select count(*)::int from groups where organization_id = ${orgL} and derived_from = 'all_memberships') as siblings,
               (select count(*)::int from app_roles where organization_id = ${orgL} and key = 'calendar_viewer') as roles`);
      expect(row).toEqual({ siblings: 1, roles: 0 });
    });
  });

  it("the seed include's statement is byte-identical to 0066's backfill-calendar-viewer block", () => {
    const code = (text: string) =>
      text
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim();
    const seedStatement = SEED_INCLUDE.slice(SEED_INCLUDE.indexOf("begin;\n") + "begin;\n".length, SEED_INCLUDE.lastIndexOf("commit;"));
    expect(code(seedStatement)).toBe(code(block("backfill-calendar-viewer")));
  });

  describe("live catalog scan 1 (one definition of each list; A1's part)", () => {
    async function holders(fragment: string): Promise<string[]> {
      const rows = await fx.q(sql`
        select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and position(${fragment} in p.prosrc) > 0 order by 1`);
      return rows.map((r) => String(r.proname));
    }

    it("the four-roll list appears only in presby_membership_standing", async () => {
      expect(await holders("'active', 'baptized', 'affiliate', 'other_participant'")).toEqual(["presby_membership_standing"]);
    });

    it("the member-standing list appears only in presby_standing_is_member", async () => {
      expect(await holders("'listed', 'staff_anchor'")).toEqual(["presby_standing_is_member"]);
    });

    it("the closed derived-kind list of the set T appears only in presby__person_sign_in_standing", async () => {
      expect(await holders("derived_from in ('active_membership'")).toEqual(["presby__person_sign_in_standing"]);
    });

    it("section 9 (D10b): the T exclusion list is the four kinds, and deacons_moderator is not in it", async () => {
      const [row] = await fx.q(sql`select prosrc from pg_proc where oid = 'presby__person_sign_in_standing(uuid,uuid)'::regprocedure`);
      const body = String(row!.prosrc);
      expect(body).toContain("derived_from in ('active_membership', 'all_memberships', 'session', 'diaconate')");
      expect(body).not.toContain("deacons_moderator");
    });

    const VISITOR_COMPARISON = String.raw`standing\s*(=|<>|!=)\s*'visitor'|standing\s+(not\s+)?in\s*\([^)]*'visitor'`;

    it("section 9: `standing = 'visitor'` (or an IN list naming it) appears in no function body", async () => {
      const rows = await fx.q(sql`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosrc ~* ${VISITOR_COMPARISON} order by 1`);
      expect(rows.map((r) => String(r.proname))).toEqual([]);
    });

    it("the visitor-comparison scan can fail: a deliberately offending public function is seen (rolled back)", async () => {
      await fx.ownerRolledBack(async (tx) => {
        await tx.execute(sql.raw(`create function public.ms66_visitor_offender(p_standing text) returns boolean language plpgsql immutable as $$ begin return p_standing = 'visitor'; end $$`));
        const result = await tx.execute(sql`
          select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc ~* ${VISITOR_COMPARISON} order by 1`);
        // toContain, not toEqual: the sample proves the pattern can match,
        // independently of whether the real catalog is clean.
        expect(((result as unknown as { rows: Array<{ proname: string }> }).rows).map((r) => r.proname)).toContain("ms66_visitor_offender");
      });
    });

    it("the scan can fail: a deliberately offending public function is seen (rolled back)", async () => {
      await fx.ownerRolledBack(async (tx) => {
        await tx.execute(sql.raw(`create function public.ms66_offender(p text) returns boolean language sql immutable as $$ select p in ('listed', 'staff_anchor') $$`));
        const result = await tx.execute(sql`
          select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and position(${"'listed', 'staff_anchor'"} in p.prosrc) > 0 order by 1`);
        const names = ((result as unknown as { rows: Array<{ proname: string }> }).rows).map((r) => r.proname);
        expect(names).toEqual(["ms66_offender", "presby_standing_is_member"]);
      });
    });
  });
});
