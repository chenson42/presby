/**
 * The seat-semantics pin (docs/work-log/2026-11-19-presbytery-committees.md,
 * Phase 2 R1.3 and Phase 3 "Test plan"; DECISION-354). `group_memberships.group_role`
 * now has seven values, but only TWO of them are seats: `presby_reimbursement__is_seat`
 * (drizzle/0073) and `presby_worship_leads_team` (drizzle/0085) match
 * `group_role in ('chair','leader')` exactly and fail closed. So a `vice_chair`, a
 * `clerk`, a `secretary` and an `ex_officio` row on a group that reimbursement or
 * worship reads confers NOTHING there, and a `member` row neither; chair and leader
 * still do. `scripts/committees/test-rls-90.sql` (c) pins the same property in SQL as
 * presby_app; this file is the vitest half, as the owner, with one person per role so
 * the answer cannot be borrowed from another row.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/committees/seat-semantics.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import { GROUP_ROLE_VALUES, SEAT_ROLES, TITLE_ONLY_ROLES } from "@/lib/group-roles";
import "@/lib/db/schema";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
};

describe.skipIf(!hasDb)("seat semantics: only chair and leader are seats (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let Q: string; // a congregation: the organization reimbursement and worship are about
  let committeeG: string; // a managed committee group (a "chargeable" group)
  let teamG: string; // a managed choir carrying a worship_teams row
  const personByRole = new Map<string, string>();
  const userIds: string[] = [];

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const isSeat = async (person: string) =>
    (await q(sql`select presby_reimbursement__is_seat(${Q}::uuid, ${person}::uuid, ${committeeG}::uuid) as v`))[0]!.v;
  const leadsTeam = async (person: string) =>
    (await q(sql`select presby_worship_leads_team(${Q}::uuid, ${person}::uuid, ${teamG}::uuid, current_date) as v`))[0]!.v;

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("seatsem");
    Q = await fx.makeOrg("Congregation");
    const group = async (typeKey: string, name: string) =>
      String(
        (
          await q(sql`insert into groups (organization_id, group_type_id, name)
                      values (${Q}, (select id from group_types where key = ${typeKey}), ${name}) returning id`)
        )[0]!.id,
      );
    committeeG = await group("committee", "Seat90 Property Committee");
    teamG = await group("choir", "Seat90 Choir");
    await q(sql`insert into worship_teams (group_id, organization_id, created_by) values (${teamG}, ${Q}, ${fx.actingUserId})`);

    const stamp = Date.now();
    for (const [i, role] of GROUP_ROLE_VALUES.entries()) {
      // An unmerged person with an active membership and an ACTIVE LOGIN: both functions require all three.
      const [user] = await q(sql`insert into users (email, name) values (${`seat90-${role}-${stamp}@example.invalid`}, ${`Seat ${role}`}) returning id`);
      userIds.push(String(user!.id));
      const person = await fx.makePerson(`Seat${i}`, `Role${stamp}`);
      await q(sql`update people set user_id = ${user!.id} where id = ${person}`);
      await fx.addMember(Q, person);
      for (const group of [committeeG, teamG]) {
        await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
                    values (${Q}, ${group}, ${person}, ${role}, 'managed', current_date - 30)`);
      }
      personByRole.set(role, person);
    }
  });

  afterAll(async () => {
    if (!fx) return;
    await fx.cleanup();
    for (const id of userIds) await q(sql`delete from users where id = ${id}`);
  });

  it("the fixture has one person per role, all seven", () => {
    expect([...personByRole.keys()].sort()).toEqual([...GROUP_ROLE_VALUES].sort());
  });

  it("reimbursement: chair and leader are seats; vice chair, clerk, secretary, ex officio and member are not", async () => {
    for (const role of GROUP_ROLE_VALUES) {
      const expected = (SEAT_ROLES as readonly string[]).includes(role);
      expect(await isSeat(personByRole.get(role)!), `presby_reimbursement__is_seat for ${role}`).toBe(expected);
    }
  });

  it("worship: chair and leader lead the team; the four titles and member do not", async () => {
    for (const role of GROUP_ROLE_VALUES) {
      const expected = (SEAT_ROLES as readonly string[]).includes(role);
      expect(await leadsTeam(personByRole.get(role)!), `presby_worship_leads_team for ${role}`).toBe(expected);
    }
  });

  it("each of the four title-only roles is false in BOTH functions (the vocabulary gained titles, not authority)", async () => {
    for (const role of TITLE_ONLY_ROLES) {
      const person = personByRole.get(role)!;
      expect(await isSeat(person), `reimbursement ${role}`).toBe(false);
      expect(await leadsTeam(person), `worship ${role}`).toBe(false);
    }
  });

  it("a title row that starts today and has no end is still not a seat (dates do not turn a title into authority)", async () => {
    const stamp = Date.now();
    const [user] = await q(sql`insert into users (email, name) values (${`seat90-fresh-${stamp}@example.invalid`}, 'Seat fresh') returning id`);
    userIds.push(String(user!.id));
    const person = await fx.makePerson("Fresh", `Title${stamp}`);
    await q(sql`update people set user_id = ${user!.id} where id = ${person}`);
    await fx.addMember(Q, person);
    for (const group of [committeeG, teamG]) {
      await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
                  values (${Q}, ${group}, ${person}, 'vice_chair', 'managed', current_date)`);
    }
    expect(await isSeat(person)).toBe(false);
    expect(await leadsTeam(person)).toBe(false);
    // The same person as a chair on the same day IS a seat: the contrast that makes the false above meaningful.
    await q(sql`update group_memberships set group_role = 'chair' where person_id = ${person}`);
    expect(await isSeat(person)).toBe(true);
    expect(await leadsTeam(person)).toBe(true);
  });
});
