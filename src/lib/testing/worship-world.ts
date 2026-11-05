/**
 * The throwaway world the worship DB-backed suites share (`store.*.db.test.ts`,
 * `reads.db.test.ts`, `notify.db.test.ts`, `sweep.db.test.ts`,
 * `states.db.test.ts`). TEST SUPPORT ONLY - never imported by application code.
 *
 * Built on `createCalendarFixture` (organizations and people stamped
 * `deletable_until`, so the `fixture-deletable` tripwire is satisfied and the
 * teardown cascade is the delete guard's one allowed path). Every database
 * module is imported INSIDE the functions, never at module scope: `@/lib/db`
 * constructs its pool at import time and throws without DATABASE_URL, so the
 * calling test file must keep this module's use behind its `hasDb` skip and
 * `vi.mock("server-only")` itself.
 *
 * F433: the assignment guards' actor check calls `presby_has_permission`,
 * whose resolver answers only for `presby_current_org()`. Every owner-path
 * write that names an actor therefore goes through `inOrg()`, which sets
 * `app.current_org_id` exactly as `withOrgContext()` does.
 *
 * Names are synthetic (`example.invalid` addresses, invented names): No Real
 * Data. Person ids are never compared with fixed values.
 */
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import type { WorshipViewer } from "@/lib/worship/access";

export type Row = Record<string, unknown>;
type Db = CalendarFixture["platform"];
export type OwnerTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];
}

export interface WorshipWorld {
  org: string;
  /** "Band" (a `team`), "Choir" (a `choir`). Both are worship teams. */
  band: string;
  choir: string;
  drums: string; // band, 1 slot
  vocals: string; // band, 2 slots
  soprano: string; // choir, 4 slots
  /** Services, each served by both teams. Start in about 7 days, 30 hours, 60 hours, 5 days. */
  sunday: string;
  soon: string;
  later: string;
  midweek: string;
  /** People, all with a live membership at `org`. */
  manager: string; // worship.manage
  planner: string; // worship.plan
  scheduler: string; // worship.schedule
  all: string; // all three keys
  groupsManager: string; // worship.manage + groups.manage
  plain: string; // a member with no key
  leader: string; // a live chair seat on the band
  choirLeader: string; // a live leader seat on the choir
  alice: string; // band + choir roster
  bob: string; // band roster
  child: string; // band roster, ten years old
}

export async function createWorshipWorld(label: string) {
  const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
  const fx = await createCalendarFixture(label);

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const one = async (query: SQL): Promise<Row> => {
    const [r] = await q(query);
    return r!;
  };

  /** The owner connection with `app.current_org_id` set for one transaction (F433). */
  async function inOrg<T>(org: string, fn: (tx: OwnerTx) => Promise<T>): Promise<T> {
    return fx.platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return fn(tx);
    });
  }

  const typeIds = new Map<string, string>();
  async function groupType(key: "team" | "choir" | "committee" | "court"): Promise<string> {
    const cached = typeIds.get(key);
    if (cached) return cached;
    await q(sql`insert into group_types (key, name) values (${key}, ${key}) on conflict (key) do nothing`);
    const id = String((await one(sql`select id from group_types where key = ${key}`)).id);
    typeIds.set(key, id);
    return id;
  }

  async function group(org: string, type: "team" | "choir" | "committee" | "court", name: string): Promise<string> {
    const r = await one(sql`insert into groups (organization_id, group_type_id, name)
                            values (${org}, ${await groupType(type)}, ${name}) returning id`);
    return String(r.id);
  }

  async function team(org: string, type: "team" | "choir", name: string): Promise<string> {
    const id = await group(org, type, name);
    await q(sql`insert into worship_teams (group_id, organization_id) values (${id}, ${org})`);
    return id;
  }

  async function position(org: string, groupId: string, name: string, slots = 1): Promise<string> {
    const r = await one(sql`insert into worship_positions (organization_id, group_id, name, slots)
                            values (${org}, ${groupId}, ${name}, ${slots}) returning id`);
    return String(r.id);
  }

  /** A worship service: an event `hoursFromNow` ahead of the organization's wall-clock now, plus its extension. */
  async function service(org: string, title: string, hoursFromNow: number, teams: string[]): Promise<string> {
    const r = await one(sql`insert into events (organization_id, title, starts_at)
                            values (${org}, ${title}, presby_worship_org_now(${org}) + make_interval(hours => ${hoursFromNow}))
                            returning id`);
    const id = String(r.id);
    await q(sql`insert into worship_services (event_id, organization_id) values (${id}, ${org})`);
    for (const t of teams) {
      await q(sql`insert into worship_service_teams (organization_id, event_id, group_id) values (${org}, ${id}, ${t})`);
    }
    return id;
  }

  async function onRoster(org: string, groupId: string, personId: string, role: "member" | "chair" | "leader" = "member") {
    await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on)
                values (${org}, ${groupId}, ${personId}, ${role}, '2020-01-01')`);
  }

  /** A work address (the address `person:role` mail uses). */
  async function email(personId: string, value: string, opts: { doNotContact?: boolean; subtype?: string } = {}) {
    await q(sql`insert into contact_methods (person_id, kind, subtype, value, is_primary, do_not_contact)
                values (${personId}, 'email', ${opts.subtype ?? "work"}, ${value}, true, ${opts.doNotContact ?? false})`);
  }

  async function person(org: string, first: string, keys: readonly string[] = []): Promise<string> {
    const id = await fx.makePerson(first, "Worshiptest");
    if (keys.length > 0) await fx.enroll(org, id, keys);
    else await fx.addMember(org, id);
    return id;
  }

  async function build(
    tag: string,
    opts: { toggle?: boolean; organizationType?: "congregation" | "new_worshiping_community" | "presbytery"; timeZone?: string } = {},
  ): Promise<WorshipWorld> {
    const org = await fx.makeOrg(tag, { organizationType: opts.organizationType ?? "congregation", timeZone: opts.timeZone ?? null });
    if (opts.toggle !== false) {
      await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled)
                  values (${org}, 'org_portal.worship', true)`);
    }
    const band = await team(org, "team", "Band");
    const choir = await team(org, "choir", "Choir");
    const drums = await position(org, band, "Drums", 1);
    const vocals = await position(org, band, "Vocals", 2);
    const soprano = await position(org, choir, "Soprano", 4);
    const sunday = await service(org, "Sunday worship", 24 * 7, [band, choir]);
    const soon = await service(org, "Soon service", 30, [band, choir]);
    const later = await service(org, "Later service", 60, [band, choir]);
    const midweek = await service(org, "Midweek service", 24 * 5, [band, choir]);

    const manager = await person(org, "Manager", ["worship.manage"]);
    const planner = await person(org, "Planner", ["worship.plan"]);
    const scheduler = await person(org, "Scheduler", ["worship.schedule"]);
    const all = await person(org, "Allkeys", ["worship.manage", "worship.plan", "worship.schedule"]);
    const groupsManager = await person(org, "Groupsmgr", ["worship.manage", "groups.manage"]);
    const plain = await person(org, "Plain");
    const leader = await person(org, "Leader");
    const choirLeader = await person(org, "Choirlead");
    const alice = await person(org, "Alice");
    const bob = await person(org, "Bob");
    const child = await person(org, "Child");
    await q(sql`update people set date_of_birth = current_date - interval '10 years' where id = ${child}`);

    await onRoster(org, band, leader, "chair");
    await onRoster(org, choir, choirLeader, "leader");
    await onRoster(org, band, alice);
    await onRoster(org, choir, alice);
    await onRoster(org, band, bob);
    await onRoster(org, band, child);

    return {
      org, band, choir, drums, vocals, soprano, sunday, soon, later, midweek,
      manager, planner, scheduler, all, groupsManager, plain, leader, choirLeader, alice, bob, child,
    };
  }

  /** The viewer the store takes: always derived from a person, never from a request value. */
  function viewer(
    personId: string,
    organizationId: string,
    organizationType: WorshipViewer["organizationType"] = "congregation",
  ): WorshipViewer {
    return { personId, organizationId, organizationType, userId: fx.actingUserId, email: "actor@example.invalid" };
  }

  /** An owner-path draft (the world's own `all` person places it), for tests that need a row to exist. */
  async function draft(w: WorshipWorld, personId: string, eventId: string, positionId = w.drums, groupId = w.band): Promise<string> {
    return inOrg(w.org, async (tx) => {
      const [r] = rowsOf(
        await tx.execute(sql`insert into worship_assignments
                               (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
                             values (${w.org}, ${eventId}, ${groupId}, ${positionId}, ${personId}, ${w.scheduler})
                             returning id`),
      );
      return String(r!.id);
    });
  }

  return { fx, q, one, inOrg, group, team, position, service, onRoster, email, person, build, viewer, draft };
}

export type WorshipTestWorld = Awaited<ReturnType<typeof createWorshipWorld>>;
