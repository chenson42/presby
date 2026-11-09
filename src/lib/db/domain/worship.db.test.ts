/**
 * drizzle/0085_presby_worship.sql on a REAL Postgres connection - the proofs
 * scripts/worship/test-rls-85.sql cannot make because it runs as presby_app
 * (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 Tests,
 * `worship.db.test.ts`; Phase 4 Batch 1):
 *
 *   - every guard firing on the OWNER path (getPlatformDb() is neondb_owner,
 *     which no grant binds - F44): stamps forced, identity immutable, the
 *     set-once columns, illegal transitions, the started-service refusal, and
 *     the delete guard on all nine tables;
 *   - the composite FKs that a BEFORE guard pre-empts on the tenant
 *     connection (worship_teams_group_fk and the five person FKs on
 *     worship_assignments), each proven with the guard disabled inside a
 *     rolled-back transaction;
 *   - the fixture-teardown cascade through every worship table;
 *   - the seat refused for a merged, deceased or ended-relationship leader,
 *     and the roster check refusing such a person;
 *   - the 50-live-blockout cap under two concurrent connections (the
 *     advisory lock);
 *   - the owner-only reminder claim (DECISION-325): windows, exclusions,
 *     once per kind, the batch clamp, the address resolved in SQL;
 *   - the founding-bundle function for every organization type, and the
 *     backfill re-run from the migration file's own text;
 *   - the date helpers' default zone pinned to DEFAULT_ORG_TIME_ZONE;
 *   - WORSHIP_GUARD_CODES equal to the codes the migration raises.
 *
 * Fixtures: synthetic names (No Real Data); organizations and people stamped
 * deletable_until at insert by createCalendarFixture; teardown deletes the
 * organizations, whose cascade removes every worship row (the delete guard
 * lets exactly that through).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/worship.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import { DEFAULT_ORG_TIME_ZONE } from "@/lib/shared/org-time";
// Enter the domain cycle through the canonical entry point first (the reason
// giving.schema.test.ts gives); ./worship is re-exported from ./index.ts only
// at integration (Rule 16).
import "../schema";
import { WORSHIP_GUARD_CODES } from "./worship";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
type Db = CalendarFixture["platform"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MIGRATION = readFileSync(path.join(__dirname, "../../../../drizzle/0085_presby_worship.sql"), "utf8");
const NINE = [
  "worship_teams",
  "worship_positions",
  "worship_position_qualifications",
  "worship_service_types",
  "worship_service_type_teams",
  "worship_services",
  "worship_service_teams",
  "worship_assignments",
  "worship_blockouts",
] as const;

class Rollback extends Error {}

function rowsOf(result: unknown): Row[] {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 6) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}
function pgField(err: unknown, field: string): string | undefined {
  for (const e of chain(err)) {
    const v = (e as Record<string, unknown>)[field];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/** Expect a raise with this SQLSTATE and (optionally) this CONSTRAINT field. */
async function expectPg(p: Promise<unknown>, code: string, constraint?: string): Promise<void> {
  let caught: unknown = null;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected SQLSTATE ${code} ${constraint ?? ""}`).not.toBeNull();
  if (caught instanceof Rollback) throw new Error(`expected SQLSTATE ${code}, but the statements succeeded`);
  expect(pgField(caught, "code")).toBe(code);
  if (constraint) expect(pgField(caught, "constraint")).toBe(constraint);
}

describe.skipIf(!hasDb)("drizzle/0085 worship (Postgres-backed, owner path)", () => {
  let fx: CalendarFixture;
  let typeTeam: string;
  let typeChoir: string;

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  /**
   * The owner connection with app.current_org_id set for one transaction. The
   * assignment guards' actor check calls presby_has_permission, whose resolver
   * refuses any organization but the current context (0010's anti-fishing
   * guard), so an owner-path writer that places, sends, records or removes
   * sets the context exactly as withOrgContext() does on the tenant path.
   */
  async function setOrg(tx: Tx, org: string | undefined) {
    if (org) await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
  }

  async function inOrg<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fx.platform.transaction(async (tx) => {
      await setOrg(tx, org);
      return fn(tx);
    });
  }

  /** Runs `fn` in an owner transaction that is ALWAYS rolled back. */
  async function rolledBack(fn: (tx: Tx) => Promise<void>, org?: string): Promise<void> {
    try {
      await fx.platform.transaction(async (tx) => {
        await setOrg(tx, org);
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** The statements must raise; the transaction is rolled back either way. */
  async function mustRaise(stmts: (tx: Tx) => Promise<void>, code: string, constraint?: string, org?: string) {
    await expectPg(
      fx.platform.transaction(async (tx) => {
        await setOrg(tx, org);
        await stmts(tx);
        throw new Rollback();
      }),
      code,
      constraint,
    );
  }

  async function one(query: SQL): Promise<Row> {
    const [r] = await q(query);
    return r!;
  }

  interface World {
    org: string;
    band: string;
    choir: string;
    drums: string;
    soprano: string;
    e1: string;
    eSoon: string;
    eLater: string;
    eFar: string;
    scheduler: string;
    leader: string;
    member: string;
    child: string;
  }

  async function group(org: string, typeId: string, name: string): Promise<string> {
    const r = await one(sql`insert into groups (organization_id, group_type_id, name)
                            values (${org}, ${typeId}, ${name}) returning id`);
    return String(r.id);
  }

  async function event(org: string, title: string, hoursFromNow: number): Promise<string> {
    const r = await one(sql`insert into events (organization_id, title, starts_at)
                            values (${org}, ${title}, presby_worship_org_now(${org}) + make_interval(hours => ${hoursFromNow}))
                            returning id`);
    const id = String(r.id);
    await q(sql`insert into worship_services (event_id, organization_id) values (${id}, ${org})`);
    return id;
  }

  async function person(org: string, first: string): Promise<string> {
    const id = await fx.makePerson(first, "Worshiptest");
    await fx.addMember(org, id);
    return id;
  }

  async function onRoster(org: string, groupId: string, personId: string, role = "member") {
    await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on)
                values (${org}, ${groupId}, ${personId}, ${role}, '2020-01-01')`);
  }

  async function email(personId: string, value: string, doNotContact = false) {
    await q(sql`insert into contact_methods (person_id, kind, value, is_primary, do_not_contact)
                values (${personId}, 'email', ${value}, true, ${doNotContact})`);
  }

  async function buildWorld(tag: string, opts: { toggle?: boolean } = {}): Promise<World> {
    const org = await fx.makeOrg(tag);
    if (opts.toggle) {
      await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled)
                  values (${org}, 'org_portal.worship', true)`);
    }
    const band = await group(org, typeTeam, "Band");
    const choir = await group(org, typeChoir, "Choir");
    await q(sql`insert into worship_teams (group_id, organization_id) values (${band}, ${org}), (${choir}, ${org})`);
    const drums = String((await one(sql`insert into worship_positions (organization_id, group_id, name)
                                        values (${org}, ${band}, 'Drums') returning id`)).id);
    const soprano = String((await one(sql`insert into worship_positions (organization_id, group_id, name, slots)
                                          values (${org}, ${choir}, 'Soprano', 4) returning id`)).id);
    const e1 = await event(org, "Service one", 24 * 7);
    const eSoon = await event(org, "Service soon", 30);
    const eLater = await event(org, "Service later", 60);
    const eFar = await event(org, "Service far", 24 * 5);
    for (const e of [e1, eSoon, eLater, eFar]) {
      await q(sql`insert into worship_service_teams (organization_id, event_id, group_id)
                  values (${org}, ${e}, ${band}), (${org}, ${e}, ${choir})`);
    }
    const scheduler = await fx.makePerson("Scheduler", "Worshiptest");
    await fx.enroll(org, scheduler, ["worship.schedule"]);
    const leader = await person(org, "Leader");
    const member = await person(org, "Member");
    const child = await person(org, "Child");
    await q(sql`update people set date_of_birth = current_date - interval '10 years' where id = ${child}`);
    await onRoster(org, band, leader, "leader");
    await onRoster(org, band, member);
    await onRoster(org, choir, member);
    await onRoster(org, band, child);
    return { org, band, choir, drums, soprano, e1, eSoon, eLater, eFar, scheduler, leader, member, child };
  }

  async function draft(w: World, personId: string, eventId: string, by = w.scheduler): Promise<string> {
    return inOrg(w.org, async (tx) => {
      const [r] = rowsOf(
        await tx.execute(sql`insert into worship_assignments
                               (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
                             values (${w.org}, ${eventId}, ${w.band}, ${w.drums}, ${personId}, ${by})
                             returning id`),
      );
      return String(r!.id);
    });
  }

  let A: World;
  let B: World;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("worship-db");
    typeTeam = String((await one(sql`select id from group_types where key = 'team'`)).id);
    typeChoir = String((await one(sql`select id from group_types where key = 'choir'`)).id);
    A = await buildWorld("wa");
    B = await buildWorld("wb");
    // One row in each table the world does not already fill, so every delete
    // probe below has something to refuse.
    const st = await one(sql`insert into worship_service_types (organization_id, name, start_time)
                             values (${A.org}, 'Delete probe', '09:00') returning id`);
    await q(sql`insert into worship_service_type_teams (organization_id, service_type_id, group_id)
                values (${A.org}, ${st.id}, ${A.band})`);
    await q(sql`insert into worship_position_qualifications (organization_id, group_id, position_id, person_id)
                values (${A.org}, ${A.band}, ${A.drums}, ${A.member})`);
    await q(sql`insert into worship_blockouts (organization_id, person_id, starts_on, ends_on)
                values (${A.org}, ${A.member}, current_date + 1, current_date + 2)`);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  // -------------------------------------------------------------------------
  describe("every guard binds the OWNER connection (F44)", () => {
    it("an assignment is born a draft with the trigger-owned stamps forced null, even when the owner supplies them", async () => {
      const r = await inOrg(A.org, async (tx) => rowsOf(await tx.execute(sql`insert into worship_assignments
                                (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id,
                                 requested_at, withdrawn_at, reminded_at, unanswered_reminded_at)
                              values (${A.org}, ${A.e1}, ${A.band}, ${A.drums}, ${A.member}, ${A.scheduler},
                                      now(), now(), now(), now())
                              returning status, requested_at, withdrawn_at, reminded_at, unanswered_reminded_at, responded_at`))[0]!);
      expect(r).toMatchObject({
        status: "draft",
        requested_at: null,
        withdrawn_at: null,
        reminded_at: null,
        unanswered_reminded_at: null,
        responded_at: null,
      });
    });

    it("with no organization context the actor check fails closed (the resolver's anti-fishing guard, 0010)", async () => {
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${A.child}, ${A.scheduler})`);
        },
        "42501",
      );
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${A.child}, ${A.scheduler})`);
        },
        "42501",
        undefined,
        B.org,
      );
    });

    it("a person's row cannot be born confirmed, and the placer must hold the key or the seat", async () => {
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id, status)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${A.member}, ${A.scheduler}, 'confirmed')`);
        },
        "23514",
        "worship_guard_illegal_transition",
        A.org,
      );
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${A.child}, ${A.member})`);
        },
        "23514",
        "worship_guard_not_authorized",
        A.org,
      );
    });

    it("identity columns are immutable and an owner-supplied requested_at is ignored", async () => {
      const id = await draft(A, A.child, A.eFar);
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`update worship_assignments set event_id = ${A.e1} where id = ${id}`);
        },
        "23514",
        "worship_guard_immutable",
      );
      await q(sql`update worship_assignments set requested_at = now() - interval '3 days' where id = ${id}`);
      expect((await one(sql`select requested_at from worship_assignments where id = ${id}`)).requested_at).toBeNull();
    });

    it("the reminder stamps are set once (and stamped now()), and nothing returns to draft", async () => {
      const id = await draft(A, A.member, A.eFar);
      await inOrg(A.org, (tx) =>
        tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${A.scheduler},
                         notice_outcome = 'emailed' where id = ${id}`),
      );
      await q(sql`update worship_assignments set reminded_at = '2001-01-01' where id = ${id}`);
      const r = await one(sql`select reminded_at > now() - interval '1 minute' as fresh from worship_assignments where id = ${id}`);
      expect(r.fresh).toBe(true);
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`update worship_assignments set reminded_at = clock_timestamp() where id = ${id}`);
        },
        "23514",
        "worship_guard_set_once",
      );
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`update worship_assignments set status = 'draft' where id = ${id}`);
        },
        "23514",
        "worship_guard_illegal_transition",
      );
    });

    it("a send is refused once the service has started (the owner moved the event into the past)", async () => {
      await rolledBack(async (tx) => {
        const [r] = rowsOf(
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.e1}, ${A.choir}, ${A.soprano}, ${A.member}, ${A.scheduler}) returning id`),
        );
        await tx.execute(sql`update events set starts_at = presby_worship_org_now(${A.org}) - interval '1 hour'
                              where id = ${A.e1}`);
        await expectPg(
          tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${A.scheduler},
                           notice_outcome = 'emailed' where id = ${r!.id}`),
          "23514",
          "worship_guard_service_started",
        );
      }, A.org);
    });

    it("the generic guard: free columns change, set-once columns stay, everything else is immutable", async () => {
      await q(sql`update worship_positions set name = 'Drum kit', slots = 2 where id = ${A.drums}`);
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`update worship_positions set group_id = ${A.choir} where id = ${A.drums}`);
        },
        "23514",
        "worship_guard_immutable",
      );
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`update worship_teams set created_by = ${fx.actingUserId} where group_id = ${A.band}`);
        },
        "23514",
        "worship_guard_immutable",
      );
      await rolledBack(async (tx) => {
        await tx.execute(sql`update worship_teams set retired_at = now() where group_id = ${A.choir}`);
        await expectPg(
          tx.execute(sql`update worship_teams set retired_at = null where group_id = ${A.choir}`),
          "23514",
          "worship_guard_set_once",
        );
      });
      const before = await one(sql`select updated_at from worship_services where event_id = ${A.e1}`);
      await q(sql`update worship_services set updated_by = ${fx.actingUserId} where event_id = ${A.e1}`);
      const after = await one(sql`select updated_at from worship_services where event_id = ${A.e1}`);
      expect(new Date(String(after.updated_at)).getTime()).toBeGreaterThanOrEqual(new Date(String(before.updated_at)).getTime());
      const st = await one(sql`insert into worship_service_types (organization_id, name, start_time)
                               values (${A.org}, 'Sunday', '09:00') returning id`);
      await q(sql`update worship_service_types set name = 'Sunday worship', start_time = '10:30', duration_minutes = 75,
                    location = 'Sanctuary' where id = ${st.id}`);
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`update worship_services set service_type_id = ${st.id} where event_id = ${A.e1}`);
        },
        "23514",
        "worship_guard_immutable",
      );
    });

    it.each(NINE.map((t) => [t]))("%s: the owner cannot delete a row (insufficient_privilege)", async (table) => {
      await mustRaise(
        async (tx) => {
          await tx.execute(sql.raw(`delete from ${table} where organization_id = '${A.org}'`));
        },
        "42501",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("composite FKs a guard pre-empts on the tenant connection (guard disabled, rolled back)", () => {
    it("worship_teams_group_fk refuses another organization's group", async () => {
      const bGroup = await group(B.org, typeTeam, "Unadopted");
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`alter table worship_teams disable trigger worship_teams_guard_insert`);
          await tx.execute(sql`insert into worship_teams (group_id, organization_id) values (${bGroup}, ${A.org})`);
        },
        "23503",
        "worship_teams_group_fk",
      );
    });

    it("worship_assignments_person_fk and _assigned_by_fk refuse a person with no record here", async () => {
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`alter table worship_assignments disable trigger worship_assignments_guard_insert`);
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${B.member}, ${A.scheduler})`);
        },
        "23503",
        "worship_assignments_person_fk",
      );
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`alter table worship_assignments disable trigger worship_assignments_guard_insert`);
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${A.leader}, ${B.scheduler})`);
        },
        "23503",
        "worship_assignments_assigned_by_fk",
      );
    });

    it.each([
      ["sent_by_person_id", "status = 'requested', notice_outcome = 'emailed', requested_at = now(), ", "worship_assignments_sent_by_fk"],
      ["responded_by_person_id", "status = 'confirmed', response_source = 'on_behalf', responded_at = now(), ", "worship_assignments_responded_by_fk"],
      ["withdrawn_by_person_id", "status = 'withdrawn', withdrawn_reason = 'removed', withdrawn_at = now(), ", "worship_assignments_withdrawn_by_fk"],
    ])("%s refuses a person with no record here (%s)", async (column, extra, fk) => {
      const id = await draft(A, A.child, A.e1);
      await mustRaise(
        async (tx) => {
          await tx.execute(sql`alter table worship_assignments disable trigger worship_assignments_guard_update`);
          await tx.execute(
            sql.raw(`update worship_assignments set ${extra} ${column} = '${B.scheduler}' where id = '${id}'`),
          );
        },
        "23503",
        fk,
      );
      // The draft is untouched (the transaction rolled back).
      expect((await one(sql`select status from worship_assignments where id = ${id}`)).status).toBe("draft");
      await inOrg(A.org, (tx) =>
        tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_reason = 'removed',
                         withdrawn_by_person_id = ${A.scheduler} where id = ${id}`),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("the seat and the roster on the owner path (R7)", () => {
    it.each([
      ["merged", (w: World, other: string) => sql`update people set merged_into_id = ${other} where id = ${w.leader}`],
      ["deceased", (w: World) => sql`update people set date_of_death = current_date - 1 where id = ${w.leader}`],
      [
        "relationship ended",
        (w: World) =>
          sql`update memberships set ended_on = current_date - 1, ended_reason = 'moved'
               where person_id = ${w.leader} and organization_id = ${w.org}`,
      ],
    ])("a %s leader holds no seat and places nobody", async (_label, change) => {
      expect((await one(sql`select presby_worship_leads_team(${A.org}, ${A.leader}, ${A.band}, presby_worship_org_today(${A.org})) as v`)).v).toBe(true);
      await rolledBack(async (tx) => {
        await tx.execute(change(A, A.member));
        const [r] = rowsOf(
          await tx.execute(sql`select presby_worship_leads_team(${A.org}, ${A.leader}, ${A.band}, presby_worship_org_today(${A.org})) as v`),
        );
        expect(r!.v).toBe(false);
        await expectPg(
          tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${A.child}, ${A.leader})`),
          "23514",
          "worship_guard_not_authorized",
        );
      }, A.org);
    });

    it.each([
      ["merged", (w: World) => sql`update people set merged_into_id = ${w.leader} where id = ${w.child}`],
      ["deceased", (w: World) => sql`update people set date_of_death = current_date - 1 where id = ${w.child}`],
      [
        "off the roster since yesterday",
        (w: World) =>
          sql`update group_memberships set ends_on = presby_worship_org_today(${w.org})
               where group_id = ${w.band} and person_id = ${w.child}`,
      ],
    ])("a %s person cannot be placed", async (_label, change) => {
      await rolledBack(async (tx) => {
        await tx.execute(change(A));
        await expectPg(
          tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
            values (${A.org}, ${A.eFar}, ${A.band}, ${A.drums}, ${A.child}, ${A.scheduler})`),
          "23514",
          "worship_guard_not_on_roster",
        );
      }, A.org);
    });
  });

  // -------------------------------------------------------------------------
  describe("blockouts", () => {
    it("two concurrent saves cannot both take the 50th place (the advisory lock)", async () => {
      const p = await person(B.org, "Busy");
      await q(sql`insert into worship_blockouts (organization_id, person_id, starts_on, ends_on)
                  select ${B.org}, ${p}, current_date + g, current_date + g from generate_series(1, 49) g`);
      const results = await Promise.allSettled([
        fx.platform.transaction(async (tx) => {
          await tx.execute(sql`insert into worship_blockouts (organization_id, person_id, starts_on, ends_on)
                                values (${B.org}, ${p}, current_date + 100, current_date + 100)`);
          await tx.execute(sql`select pg_sleep(1.5)`);
        }),
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return fx.platform.transaction(async (tx) => {
            await tx.execute(sql`insert into worship_blockouts (organization_id, person_id, starts_on, ends_on)
                                  values (${B.org}, ${p}, current_date + 101, current_date + 101)`);
          });
        })(),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      await expectPg(Promise.reject(rejected[0]!.reason), "23514", "worship_guard_blockout_cap");
      expect((await one(sql`select count(*)::int as n from worship_blockouts
                             where person_id = ${p} and ended_at is null`)).n).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  describe("the reminder claim (owner-only, DECISION-325)", () => {
    it("claims exactly the due rows, once per kind, with the address resolved in SQL", async () => {
      const C = await buildWorld("wc", { toggle: true });
      const D = await buildWorld("wd", { toggle: false });
      const people: Record<string, string> = {};
      for (const k of ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"]) {
        people[k] = await person(C.org, k.toUpperCase());
        await onRoster(C.org, C.band, people[k]!);
        if (k !== "m8") await email(people[k]!, `worship-${k}-${Date.now()}@example.invalid`, k === "m7");
      }
      await email(C.child, `worship-child-${Date.now()}@example.invalid`);
      const dOff = await person(D.org, "Doff");
      await onRoster(D.org, D.band, dOff);
      await email(dOff, `worship-doff-${Date.now()}@example.invalid`);
      const cancelled = await event(C.org, "Service cancelled", 30);
      await q(sql`insert into worship_service_teams (organization_id, event_id, group_id) values (${C.org}, ${cancelled}, ${C.band})`);

      await rolledBack(async (tx) => {
        // Build the states with the guards off (requested_at must be back-dated,
        // which no connection can do through the guard), then turn them on
        // again: the claim's own update passes through the guard.
        await tx.execute(sql`alter table worship_assignments disable trigger worship_assignments_guard_insert`);
        await tx.execute(sql`alter table worship_assignments disable trigger worship_assignments_guard_update`);
        const ins = async (w: World, who: string, ev: string, status: string, requestedHoursAgo: number | null) => {
          const [r] = rowsOf(
            await tx.execute(sql`insert into worship_assignments
                (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id, status,
                 sent_by_person_id, requested_at, notice_outcome, responded_by_person_id, response_source, responded_at,
                 decline_reason)
              values (${w.org}, ${ev}, ${w.band}, ${w.drums}, ${who}, ${w.scheduler}, ${status},
                      ${requestedHoursAgo === null ? null : w.scheduler},
                      ${requestedHoursAgo === null ? null : sql`now() - make_interval(hours => ${requestedHoursAgo})`},
                      ${requestedHoursAgo === null ? null : "emailed"},
                      ${status === "requested" ? null : who}, ${status === "requested" ? null : "self"},
                      ${status === "requested" ? null : sql`now()`},
                      ${status === "declined" ? "away" : null})
              returning id`),
          );
          return String(r!.id);
        };
        const id: Record<string, string> = {};
        id.m1 = await ins(C, people.m1!, C.eSoon, "requested", 25); //   due: unanswered (30h out, asked 25h ago)
        id.m2 = await ins(C, people.m2!, C.eSoon, "confirmed", 25); //   due: confirmed (30h <= 48h)
        id.m3 = await ins(C, people.m3!, C.eLater, "requested", 25); //  due: unanswered (60h <= 72h)
        id.m4 = await ins(C, people.m4!, C.eLater, "confirmed", 25); //  not: confirmed but 60h > 48h
        id.m5 = await ins(C, people.m5!, C.eSoon, "requested", 2); //    not: asked under 24h ago
        id.m6 = await ins(C, people.m6!, C.eSoon, "declined", 25); //    not: declined
        id.m7 = await ins(C, people.m7!, C.eSoon, "requested", 25); //   not: do-not-contact address
        id.m8 = await ins(C, people.m8!, C.eSoon, "requested", 25); //   not: no address
        id.m9 = await ins(C, people.m9!, C.eFar, "requested", 25); //    not: 5 days out
        id.m10 = await ins(C, people.m10!, cancelled, "requested", 25); // not: service cancelled
        id.m11 = await ins(C, people.m11!, C.eSoon, "requested", 25); // not: relationship ended
        id.m12 = await ins(C, people.m12!, C.eSoon, "confirmed", 25); // not: merged
        id.child = await ins(C, C.child, C.eSoon, "requested", 25); //    not: presumed minor
        id.doff = await ins(D, dOff, D.eSoon, "requested", 25); //        not: toggle off at D
        await tx.execute(sql`alter table worship_assignments enable trigger worship_assignments_guard_insert`);
        await tx.execute(sql`alter table worship_assignments enable trigger worship_assignments_guard_update`);
        await tx.execute(sql`update events set cancelled_at = now() where id = ${cancelled}`);
        await tx.execute(sql`update memberships set ended_on = current_date - 1, ended_reason = 'moved'
                              where person_id = ${people.m11!} and organization_id = ${C.org}`);
        await tx.execute(sql`update people set merged_into_id = ${people.m1!} where id = ${people.m12!}`);
        // A guest row is never claimed either.
        await tx.execute(sql`insert into worship_assignments
            (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id, status,
             response_source, responded_by_person_id)
          values (${C.org}, ${C.eSoon}, ${C.choir}, ${C.soprano}, 'Visiting Singer', ${C.scheduler}, 'confirmed',
                  'on_behalf', ${C.scheduler})`);

        const mine = (rows: Row[]) =>
          rows
            .filter((r) => r.organization_id === C.org || r.organization_id === D.org)
            .map((r) => `${String(r.kind)}:${String(r.assignment_id)}`)
            .sort();
        const first = rowsOf(await tx.execute(sql`select * from presby_worship_claim_reminders(500)`));
        expect(mine(first)).toEqual(
          [`unanswered:${id.m1}`, `confirmed:${id.m2}`, `unanswered:${id.m3}`].sort(),
        );
        const m1 = first.find((r) => r.assignment_id === id.m1)!;
        expect(m1.person_id).toBe(people.m1);
        expect(m1.event_id).toBe(C.eSoon);
        expect(String(m1.address)).toMatch(/^worship-m1-\d+@example\.invalid$/);
        const [stamps] = rowsOf(
          await tx.execute(sql`select
              (select unanswered_reminded_at is not null and reminded_at is null from worship_assignments where id = ${id.m1}) as m1,
              (select reminded_at is not null and unanswered_reminded_at is null from worship_assignments where id = ${id.m2}) as m2,
              (select reminded_at is null and unanswered_reminded_at is null from worship_assignments where id = ${id.m4}) as m4`),
        );
        expect(stamps).toEqual({ m1: true, m2: true, m4: true });

        const second = rowsOf(await tx.execute(sql`select * from presby_worship_claim_reminders(500)`));
        expect(mine(second), "each kind is claimed once").toEqual([]);

        // m1 confirms after its unanswered reminder: now due for the confirmed kind, once.
        await tx.execute(sql`update worship_assignments set status = 'confirmed', response_source = 'self',
                               responded_by_person_id = ${people.m1!} where id = ${id.m1}`);
        const third = rowsOf(await tx.execute(sql`select * from presby_worship_claim_reminders(500)`));
        expect(mine(third)).toEqual([`confirmed:${id.m1}`]);
      }, C.org);
    });

    it("the batch is clamped (1 claims at most one row; 0 and null are treated as 1 and 500)", async () => {
      const E = await buildWorld("we", { toggle: true });
      const ps = [await person(E.org, "Q1"), await person(E.org, "Q2")];
      for (const p of ps) {
        await onRoster(E.org, E.band, p);
        await email(p, `worship-q-${p}@example.invalid`);
      }
      await rolledBack(async (tx) => {
        for (const p of ps) {
          await tx.execute(sql`insert into worship_assignments
              (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id, status,
               response_source, responded_by_person_id)
            select ${E.org}, ${E.eSoon}, ${E.band}, ${E.drums}, ${p}, ${E.scheduler}, 'draft', null, null`);
          await tx.execute(sql`update worship_assignments set status = 'confirmed', response_source = 'on_behalf',
                                 responded_by_person_id = ${E.scheduler} where person_id = ${p}`);
        }
        const one1 = rowsOf(await tx.execute(sql`select * from presby_worship_claim_reminders(1)`));
        expect(one1.length).toBe(1);
        const zero = rowsOf(await tx.execute(sql`select * from presby_worship_claim_reminders(0)`));
        expect(zero.length).toBeLessThanOrEqual(1);
        const rest = rowsOf(await tx.execute(sql`select * from presby_worship_claim_reminders(null)`));
        const claimedHere = [...one1, ...zero, ...rest].filter((r) => r.organization_id === E.org);
        expect(claimedHere.length).toBe(2);
      }, E.org);
    });
  });

  // -------------------------------------------------------------------------
  describe("the teardown cascade (D10)", () => {
    it("deleting a fixture organization removes its rows from all nine tables", async () => {
      const T = await buildWorld("wt", { toggle: true });
      const st = await one(sql`insert into worship_service_types (organization_id, name, start_time)
                               values (${T.org}, 'Teardown', '09:00') returning id`);
      await q(sql`insert into worship_service_type_teams (organization_id, service_type_id, group_id)
                  values (${T.org}, ${st.id}, ${T.band})`);
      await q(sql`insert into worship_position_qualifications (organization_id, group_id, position_id, person_id)
                  values (${T.org}, ${T.band}, ${T.drums}, ${T.member})`);
      await q(sql`insert into worship_blockouts (organization_id, person_id, starts_on, ends_on)
                  values (${T.org}, ${T.member}, current_date + 1, current_date + 3)`);
      await draft(T, T.member, T.e1);
      for (const t of NINE) {
        const r = await one(sql.raw(`select count(*)::int as n from ${t} where organization_id = '${T.org}'`));
        expect(r.n, t).toBeGreaterThan(0);
      }
      await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
      try {
        await q(sql`delete from organizations where id = ${T.org}`);
      } finally {
        await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
      }
      for (const t of NINE) {
        const r = await one(sql.raw(`select count(*)::int as n from ${t} where organization_id = '${T.org}'`));
        expect(r.n, t).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("the founding bundle and the backfill (F421, DECISION-319)", () => {
    const WORSHIP = ["worship.manage", "worship.plan", "worship.schedule"];

    it("the bundle carries the worship keys for congregations and new worshiping communities only, in order", async () => {
      const rows = await q(sql`select t, presby_founding_administrator_permission_keys(t) as keys
                                 from unnest(array['congregation', 'new_worshiping_community', 'presbytery',
                                                   'synod', 'general_assembly']) t`);
      const byType = Object.fromEntries(rows.map((r) => [String(r.t), r.keys as string[]]));
      for (const t of ["congregation", "new_worshiping_community"]) {
        expect(byType[t]!.slice(-3), t).toEqual(WORSHIP);
        expect(byType[t]!.slice(0, 11)).toEqual(byType.synod);
      }
      for (const t of ["presbytery", "synod", "general_assembly"]) {
        expect(byType[t]!.some((k) => k.startsWith("worship.")), t).toBe(false);
      }
      expect(byType.presbytery!.at(-1)).toBe("congregation_oversight.manage");
      expect(byType.synod).toHaveLength(11);
    });

    it("section 3, re-run from the migration text, tops up an in-scope founding role and leaves a presbytery's alone", async () => {
      const start = MIGRATION.indexOf("-- 3. backfill");
      const doStart = MIGRATION.indexOf("do $$", start);
      const doEnd = MIGRATION.indexOf("end $$;", doStart) + "end $$;".length;
      const backfill = MIGRATION.slice(doStart, doEnd);
      expect(backfill).toMatch(/o\.organization_type in \('congregation', 'new_worshiping_community'\)/);
      const cong = await fx.makeOrg("bf-cong");
      const nwc = await fx.makeOrg("bf-nwc", { organizationType: "new_worshiping_community" });
      const pres = await fx.makeOrg("bf-pres", { organizationType: "presbytery" });
      const roles: Record<string, string> = {};
      for (const [k, org] of [["cong", cong], ["nwc", nwc], ["pres", pres]] as const) {
        roles[k] = await fx.makeRole(org, "founding_administrator", ["people.manage"]);
      }
      await rolledBack(async (tx) => {
        await tx.execute(sql.raw(backfill));
        const [r] = rowsOf(
          await tx.execute(sql`select
              (select count(*)::int from app_role_permissions where role_id = ${roles.cong} and permission_key like 'worship.%') as cong,
              (select count(*)::int from app_role_permissions where role_id = ${roles.nwc} and permission_key like 'worship.%') as nwc,
              (select count(*)::int from app_role_permissions where role_id = ${roles.pres} and permission_key like 'worship.%') as pres`),
        );
        expect(r).toEqual({ cong: 3, nwc: 3, pres: 0 });
        // Idempotent: a second run adds nothing.
        await tx.execute(sql.raw(backfill));
        const [r2] = rowsOf(
          await tx.execute(sql`select count(*)::int as n from app_role_permissions
                                where role_id in (${roles.cong}, ${roles.nwc}, ${roles.pres})`),
        );
        expect(r2!.n).toBe(4 + 4 + 1);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("helpers and vocabulary", () => {
    it("the date helpers default to DEFAULT_ORG_TIME_ZONE and honour a settings zone", async () => {
      expect(DEFAULT_ORG_TIME_ZONE).toBe("America/New_York");
      const plain = await fx.makeOrg("tz-default");
      const hono = await fx.makeOrg("tz-hono", { timeZone: "Pacific/Honolulu" });
      const r = await one(sql`select
          presby_worship_org_today(${plain}) = (now() at time zone ${DEFAULT_ORG_TIME_ZONE})::date as d_today,
          abs(extract(epoch from presby_worship_org_now(${plain}) - (now() at time zone ${DEFAULT_ORG_TIME_ZONE}))) < 1 as d_now,
          presby_worship_org_today(${hono}) = (now() at time zone 'Pacific/Honolulu')::date as h_today,
          abs(extract(epoch from presby_worship_org_now(${hono}) - (now() at time zone 'Pacific/Honolulu'))) < 1 as h_now`);
      expect(r).toEqual({ d_today: true, d_now: true, h_today: true, h_now: true });
    });

    it("WORSHIP_GUARD_CODES is exactly the set of codes the migration raises", () => {
      const raised = new Set([...MIGRATION.matchAll(/constraint = '(worship_guard_[a-z_]+)'/g)].map((m) => m[1]!));
      expect([...raised].sort()).toEqual([...WORSHIP_GUARD_CODES].sort());
    });
  });
});
