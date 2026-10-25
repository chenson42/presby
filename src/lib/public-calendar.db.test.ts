/**
 * drizzle/0067's presby_public_events_calendar(), proven against a real
 * database (docs/work-log/2026-10-25-public-events-calendar.md, Phase 3 T1,
 * T2, T4; Phase 4 Batch 1; DECISION-238, DECISION-241).
 *
 * scripts/public-calendar/test-rls-67.sql (as presby_app) carries most of T1.
 * This file holds what that psql suite cannot set up, because presby_app has
 * no grant to do it: a second LIVE site (organization_sites), an inactive
 * organization (organizations), a contact phone (organization_profiles needs
 * a users row), hundreds of rows for the cap, organizations in other zones,
 * and the CHECK dropped (DDL). The owner (`getPlatformDb()`) writes the
 * fixtures; the definer is then called on `db` (presby_app, RLS enforced, no
 * org GUC) exactly as the anonymous public page will call it, so EXECUTE is
 * exercised on the real application role. The one exception is T2, which
 * must call the definer inside the owner transaction that dropped the CHECK
 * (uncommitted DDL is invisible to, and would block, another connection);
 * the property there is the definer's own WHERE clause, not the grant.
 *
 * NOT HERE, on purpose: T3 (the differential test against
 * orgFeatureEnabledInTx over axis x category x toggle) needs the
 * `org_portal.public_calendar` catalog entry, which is Batch 2's; it joins
 * this file in Batch 2. T5's literal pins live in public-calendar.test.ts.
 *
 * Fixtures: throwaway organizations stamped `deletable_until` by
 * createCalendarFixture(); every site, toggle, profile, type and event row
 * here cascades with them. Synthetic names, no people (No Real Data).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/public-calendar.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
const ALLOWED_KEYS = [
  "description",
  "ends_at",
  "location",
  "starts_at",
  "title",
  "type_color",
  "type_name",
];

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

class Rollback extends Error {}

/** 'YYYY-MM-DD' for "now" in an IANA zone, independent of the process zone. */
function todayIn(zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.now());
}

describe.skipIf(!hasDb)("presby_public_events_calendar (drizzle/0067, Postgres-backed)", () => {
  let fx: CalendarFixture;
  let app: { execute(query: SQL): Promise<unknown> };
  const slugs = new Map<string, string>();

  async function owner(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  /** The anonymous call: presby_app, no org GUC, the DB-returned slug. */
  async function readAsApp(slug: string): Promise<Row[]> {
    return rowsOf(await app.execute(sql`select * from presby_public_events_calendar(${slug}::text)`));
  }

  /** The whole row as Postgres prints it, for byte-identical comparisons. */
  async function rowTextAsApp(slug: string): Promise<string[]> {
    const rows = rowsOf(
      await app.execute(sql`select (c)::text as t from presby_public_events_calendar(${slug}::text) c`),
    );
    return rows.map((r) => String(r.t));
  }

  /** A congregation with a LIVE site, the public-calendar toggle on and a fallback type. */
  async function liveOrg(name: string, zone = "America/New_York"): Promise<string> {
    const id = await fx.makeOrg(name, { timeZone: zone, calendarToggle: true });
    const [org] = await owner(sql`select slug from organizations where id = ${id}`);
    slugs.set(id, String(org!.slug));
    await owner(sql`
      insert into organization_sites (organization_id, repo, status)
      values (${id}, ${`fixture/public-calendar-${id}`}, 'live')`);
    await owner(sql`
      insert into organization_feature_toggles (organization_id, feature_key, enabled)
      values (${id}, 'org_portal.public_calendar', true)`);
    await owner(sql`
      insert into event_types (organization_id, name, color, icon, is_fallback)
      values (${id}, 'General', 'neutral', 'CalendarDays', true)`);
    return id;
  }

  /** One listed, open-to-everyone event `days` into the org's current month. */
  async function listed(org: string, title: string, days = 5, zone = "America/New_York") {
    await owner(sql`
      insert into events (organization_id, title, starts_at, is_public, website_listed)
      values (${org}, ${title},
              date_trunc('month', now() at time zone ${zone}) + ${days} * interval '1 day' + interval '10 hours',
              true, true)`);
  }

  function titles(row: Row | undefined): string[] {
    const events = row?.events_json;
    if (!Array.isArray(events)) throw new Error("events_json is not an array");
    return events.map((e) => String((e as Row).title));
  }

  let orgA: string;
  let orgB: string;
  let UNAVAILABLE: string;

  beforeAll(async () => {
    ({ db: app } = (await import("@/lib/db")) as unknown as {
      db: { execute(query: SQL): Promise<unknown> };
    });
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("pubcal");

    orgA = await liveOrg("alpha");
    orgB = await liveOrg("beta");
    await listed(orgA, "Alpha harvest supper");
    await listed(orgB, "Beta hymn sing");

    [UNAVAILABLE] = await rowTextAsApp("no-such-congregation-pubcal");
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("an unknown slug is exactly one unavailable row with every other column null", async () => {
    const rows = await readAsApp("no-such-congregation-pubcal");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      state: "unavailable",
      org_today: null,
      first_month: null,
      last_month: null,
      truncated: null,
      member_calendar_on: null,
      contact_phone: null,
      events_json: null,
    });
    expect(UNAVAILABLE).toBe("(unavailable,,,,,,,)");
  });

  it("the live driver returns events_json as a parsed array of allow-listed objects (T4)", async () => {
    const rows = await readAsApp(slugs.get(orgA)!);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.state).toBe("available");
    expect(Array.isArray(row.events_json)).toBe(true);
    for (const e of row.events_json as Row[]) {
      expect(Object.keys(e).sort()).toEqual(ALLOWED_KEYS);
    }
    expect(JSON.stringify(row)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(typeof row.org_today).toBe("string");
    expect(typeof row.truncated).toBe("boolean");
  });

  it("cross-tenant, both directions with two LIVE sites: each slug shows only its own listed events", async () => {
    const a = titles((await readAsApp(slugs.get(orgA)!))[0]);
    const b = titles((await readAsApp(slugs.get(orgB)!))[0]);
    expect(a).toContain("Alpha harvest supper");
    expect(a).not.toContain("Beta hymn sing");
    expect(b).toContain("Beta hymn sing");
    expect(b).not.toContain("Alpha harvest supper");
  });

  it("an organization that is not active returns the identical unavailable row (gate 1)", async () => {
    const org = await liveOrg("inactive");
    await listed(org, "Inactive org listed event");
    const before = await readAsApp(slugs.get(org)!);
    expect(before[0]!.state).toBe("available");

    await owner(sql`update organizations set status = 'suspended' where id = ${org}`);
    expect(await rowTextAsApp(slugs.get(org)!)).toEqual([UNAVAILABLE]);
  });

  it("a suspended site returns the identical unavailable row (gate 2)", async () => {
    const org = await liveOrg("suspended-site");
    await listed(org, "Suspended site listed event");
    await owner(sql`update organization_sites set status = 'suspended' where organization_id = ${org}`);
    expect(await rowTextAsApp(slugs.get(org)!)).toEqual([UNAVAILABLE]);
  });

  it("contact_phone is the organization profile's phone", async () => {
    const org = await liveOrg("phone");
    expect((await readAsApp(slugs.get(org)!))[0]!.contact_phone).toBeNull();
    await owner(sql`
      insert into organization_profiles (organization_id, phone, updated_by)
      values (${org}, '555-0167', ${fx.actingUserId})`);
    expect((await readAsApp(slugs.get(org)!))[0]!.contact_phone).toBe("555-0167");
  });

  it("T2: the read-time is_public filter holds with the CHECK dropped (three independent conditions)", async () => {
    const slug = slugs.get(orgA)!;
    let seen: string[] = [];
    try {
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`alter table events drop constraint events_website_requires_public`);
        await tx.execute(sql`
          insert into events (organization_id, title, starts_at, is_public, website_listed)
          values (${orgA}, 'T2 listed members-only',
                  date_trunc('month', now() at time zone 'America/New_York') + interval '7 days', false, true)`);
        const [row] = rowsOf(
          await tx.execute(sql`select * from presby_public_events_calendar(${slug}::text)`),
        );
        seen = titles(row);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    expect(seen).toContain("Alpha harvest supper"); // the read itself worked
    expect(seen).not.toContain("T2 listed members-only");

    const [check] = await owner(sql`
      select count(*)::int as n from pg_constraint
       where conrelid = 'events'::regclass and conname = 'events_website_requires_public' and convalidated`);
    expect(check!.n).toBe(1); // restored by the rollback
  });

  describe("T4: the 400-row cap", () => {
    /** 'YYYY-MM' of the NY current month plus `offset` months, computed by Postgres. */
    async function monthKey(offset: number): Promise<string> {
      const [r] = await owner(sql`
        select to_char(date_trunc('month', now() at time zone 'America/New_York')
                       + ${offset} * interval '1 month', 'YYYY-MM') as m`);
      return String(r!.m);
    }

    /** `count` listed events, one an hour, from the start of current month + `offset`. */
    async function bulk(org: string, offset: number, count: number, from = 1) {
      await owner(sql`
        insert into events (organization_id, title, starts_at, is_public, website_listed)
        select ${org}, 'Bulk ' || g,
               date_trunc('month', now() at time zone 'America/New_York')
                 + ${offset} * interval '1 month' + g * interval '1 hour',
               true, true
          from generate_series(${from}::int, ${from + count - 1}::int) g`);
    }

    it("exactly 400 listed rows in the window: not truncated, all 400, full window", async () => {
      const org = await liveOrg("cap-exact");
      await bulk(org, 0, 200);
      await bulk(org, 1, 200, 201);
      const [row] = await readAsApp(slugs.get(org)!);
      expect(row!.state).toBe("available");
      expect(row!.truncated).toBe(false);
      expect((row!.events_json as Row[]).length).toBe(400);
      expect(row!.first_month).toBe(await monthKey(-1));
      expect(row!.last_month).toBe(await monthKey(12));
    });

    it("405 listed rows: truncated, the window ends the month before row 401's month, nothing in or after it", async () => {
      const org = await liveOrg("cap-over");
      await bulk(org, 0, 150);
      await bulk(org, 1, 150, 151);
      await bulk(org, 2, 105, 301); // row 401 falls here
      const [row] = await readAsApp(slugs.get(org)!);
      const cutMonth = await monthKey(2);
      expect(row!.state).toBe("available");
      expect(row!.truncated).toBe(true);
      expect(row!.first_month).toBe(await monthKey(-1));
      expect(row!.last_month).toBe(await monthKey(1));
      const events = row!.events_json as Row[];
      expect(events.length).toBe(300);
      expect(events.length).toBeLessThanOrEqual(400);
      for (const e of events) {
        expect(String(e.starts_at).slice(0, 7) < cutMonth).toBe(true);
      }
    });

    it("a cut inside the first month leaves no complete month: the identical unavailable row", async () => {
      const org = await liveOrg("cap-first");
      // The previous month (the window's first): 401 rows, one every 90 minutes.
      await owner(sql`
        insert into events (organization_id, title, starts_at, is_public, website_listed)
        select ${org}, 'Early ' || g,
               date_trunc('month', now() at time zone 'America/New_York')
                 - interval '1 month' + g * interval '90 minutes',
               true, true
          from generate_series(1, 401) g`);
      expect(await rowTextAsApp(slugs.get(org)!)).toEqual([UNAVAILABLE]);
    });
  });

  describe("T4: 'today' and the window come from the organization's zone", () => {
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      it(`${zone}: org_today is that zone's date and the window is built around it`, async () => {
        const org = await liveOrg(`zone-${zone.split("/")[1]!.toLowerCase().replace(/[^a-z0-9]/g, "-")}`, zone);
        await listed(org, `Zone event ${zone}`, 3, zone);
        const before = todayIn(zone);
        const [row] = await readAsApp(slugs.get(org)!);
        const after = todayIn(zone);
        expect(row!.state).toBe("available");
        expect([before, after]).toContain(row!.org_today);

        const [expected] = await owner(sql`
          select to_char(date_trunc('month', ${String(row!.org_today)}::date) - interval '1 month', 'YYYY-MM') as f,
                 to_char(date_trunc('month', ${String(row!.org_today)}::date) + interval '12 months', 'YYYY-MM') as l`);
        expect(row!.first_month).toBe(expected!.f);
        expect(row!.last_month).toBe(expected!.l);
        expect(titles(row)).toContain(`Zone event ${zone}`);
      });
    }

    // Either zone alone can share New York's date at some hours of the day
    // (a mutation reading "today" in the default zone passed the two cases
    // above between 07:00 and 10:00 New York time). These two are UTC+14 and
    // UTC-11, 25 hours apart, so their dates differ at EVERY instant; a
    // definer that ignored the org zone would return the same date for both.
    it("two organizations 25 hours apart (Kiritimati, Pago Pago) never share an org_today", async () => {
      const east = await liveOrg("zone-east", "Pacific/Kiritimati");
      const west = await liveOrg("zone-west", "Pacific/Pago_Pago");
      const [e] = await readAsApp(slugs.get(east)!);
      const [w] = await readAsApp(slugs.get(west)!);
      expect(e!.state).toBe("available");
      expect(w!.state).toBe("available");
      expect(e!.org_today).not.toBe(w!.org_today);
      expect(String(e!.org_today) > String(w!.org_today)).toBe(true);
    });
  });
});
