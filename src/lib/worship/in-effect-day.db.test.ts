/**
 * F434 - regression for "a just-minted founder is refused on a US evening"
 * (docs/work-log/2026-11-04-worship-inc1.md, "Phase 3 amendment 2 (F434)",
 * DECISION-328). Worship compares every `role_grants` and `group_memberships`
 * date against its IN-EFFECT day, `presby_worship_in_effect_day(org)` =
 * greatest(organization day, UTC day), never against the organization's
 * service day: the platform stamps (and revokes) grants on the UTC day, and
 * between UTC midnight and the organization's midnight west of UTC the
 * organization's day is still yesterday.
 *
 *   1. The helper at FIXED instants through its `p_now` seam: deterministic,
 *      any hour. Fails before the fix by absence of the function. Plus the
 *      pin of its fallback zone literal to DEFAULT_ORG_TIME_ZONE (the literal
 *      is not observable by behaviour: greatest(New York day, UTC day) is
 *      always the UTC day, so the pin reads the function's own text).
 *   2. The guards WITHOUT a seam, on the presby_app connection (RLS and the
 *      0085 triggers live): the organization's zone is chosen at run time so
 *      its calendar day differs from the UTC day (Etc/GMT+12 before UTC noon,
 *      otherwise Etc/GMT-14), then a grant, a leader seat and a roster row
 *      stamped on the in-effect day place a draft; a grant, a seat and a
 *      roster row ended on `current_date` (the platform's revoke) do not; a
 *      grant or seat stamped one day ahead does not.
 *      HONEST LIMIT: the fix changes behaviour only when the organization is
 *      behind UTC on the calendar, which a real zone can be only before UTC
 *      noon. So part 2 fails before the fix only in that window (Etc/GMT+12
 *      is chosen then); after UTC noon it runs Etc/GMT-14, where the old and
 *      new rules agree, and it is a non-regression check, not a proof. Part 1
 *      and the source scan in boundaries.test.ts carry the always-failing
 *      proof. A run straddling UTC midnight or noon could see the precondition
 *      assertion fail; re-run.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/in-effect-day.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { DEFAULT_ORG_TIME_ZONE } from "@/lib/shared/org-time";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
type TenantTx = { execute(query: SQL): Promise<unknown> };
type TenantDb = { transaction<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> };

class Rollback extends Error {}

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];
}

function pgField(err: unknown, field: string): string | undefined {
  let cur: unknown = err;
  for (let i = 0; cur && i < 6; i += 1) {
    const v = (cur as Record<string, unknown>)[field];
    if (typeof v === "string" && v !== "") return v;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

describe.skipIf(!hasDb)("F434: worship's in-effect day (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let db: TenantDb;

  /** One statement on the presby_app connection with the organization context set. */
  async function tenantOne(org: string, query: SQL): Promise<Row> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return rowsOf(await tx.execute(query))[0]!;
    });
  }

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("winfx");
    db = (await import("@/lib/db")).db as unknown as TenantDb;
  });
  afterAll(async () => {
    if (t) await t.fx.cleanup();
  });

  // -------------------------------------------------------------------------
  describe("the helper at fixed instants (the p_now seam; any hour)", () => {
    const at = (org: string, instant: string) =>
      tenantOne(org, sql`select presby_worship_in_effect_day(${org}::uuid, ${instant}::timestamptz)::text as d,
                                (${instant}::timestamptz at time zone 'UTC')::date::text as utc`);

    it("the F434 instant: 21:35 in New York on 4 November is already 5 November in UTC - the in-effect day is the 5th", async () => {
      const ny = await t.fx.makeOrg("ny", { timeZone: "America/New_York" });
      expect(await at(ny, "2026-11-05 02:35+00")).toEqual({ d: "2026-11-05", utc: "2026-11-05" });
    });

    it("an organization with no settings row falls back to New York and gives the same answer", async () => {
      const plain = await t.fx.makeOrg("plain", { timeZone: null });
      expect((await at(plain, "2026-11-05 02:35+00")).d).toBe("2026-11-05");
    });

    it("an organization ahead of UTC (Auckland, 11:00 on the 5th) is in effect on its own day, the 5th, while UTC is the 4th", async () => {
      const akl = await t.fx.makeOrg("akl", { timeZone: "Pacific/Auckland" });
      expect(await at(akl, "2026-11-04 22:00+00")).toEqual({ d: "2026-11-05", utc: "2026-11-04" });
    });

    it("mid-afternoon UTC, New York and UTC agree: the 4th", async () => {
      const ny = await t.fx.makeOrg("ny2", { timeZone: "America/New_York" });
      expect((await at(ny, "2026-11-04 15:00+00")).d).toBe("2026-11-04");
    });

    it("its fallback zone literal equals DEFAULT_ORG_TIME_ZONE (the same pin as presby_worship_org_today)", async () => {
      expect(DEFAULT_ORG_TIME_ZONE).toBe("America/New_York");
      const r = await t.one(sql`select pg_get_functiondef('presby_worship_in_effect_day(uuid, timestamptz)'::regprocedure) as def`);
      const literals = [...String(r.def).matchAll(/organization_id = p_org\),\s*'([^']+)'\)/g)].map((m) => m[1]);
      expect(literals).toEqual([DEFAULT_ORG_TIME_ZONE]);
    });
  });

  // -------------------------------------------------------------------------
  describe("the guards without a seam (presby_app; the zone chosen so the organization's day differs from UTC's)", () => {
    // Etc/GMT+12 is UTC-12 (POSIX sign): behind UTC's calendar day before UTC
    // noon. Etc/GMT-14 is UTC+14: ahead of it from 10:00 UTC on.
    const zone = new Date().getUTCHours() < 12 ? "Etc/GMT+12" : "Etc/GMT-14";
    let w: WorshipWorld;
    let role: string;
    let day: { utc: string; org: string; eff: string; ahead: string };

    /** Places `personId` on the band's drums as `by`, on presby_app, ALWAYS rolled back. "ok" or the guard's constraint. */
    async function place(by: string, personId: string): Promise<string> {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.current_org_id', ${w.org}, true)`);
          await tx.execute(sql`insert into worship_assignments
                                 (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
                               values (${w.org}, ${w.sunday}, ${w.band}, ${w.drums}, ${personId}, ${by})`);
          throw new Rollback();
        });
      } catch (err) {
        if (err instanceof Rollback) return "ok";
        return pgField(err, "constraint") ?? `sqlstate ${pgField(err, "code") ?? "?"}: ${String(err)}`;
      }
      throw new Error("unreachable: the placement transaction neither rolled back nor raised");
    }

    async function grantKey(personId: string, startsOn: string, endsOn: string | null = null) {
      await t.q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on, ends_on, granted_by)
                    values (${w.org}, ${role}, ${personId}, ${startsOn}::date, ${endsOn}::date, ${t.fx.actingUserId})`);
    }
    async function seat(personId: string, startsOn: string, endsOn: string | null = null, role_: "leader" | "member" = "leader") {
      await t.q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on, ends_on)
                    values (${w.org}, ${w.band}, ${personId}, ${role_}, ${startsOn}::date, ${endsOn}::date)`);
    }

    beforeAll(async () => {
      w = await t.build("f434", { timeZone: zone });
      role = await t.fx.makeRole(w.org, "f434_scheduler", ["worship.schedule"]);
      const r = await t.one(sql`select current_date::text as utc,
                                       (now() at time zone 'UTC')::date::text as utc_now,
                                       (now() at time zone ${zone})::date::text as org,
                                       greatest(current_date, (now() at time zone ${zone})::date)::text as eff,
                                       (greatest(current_date, (now() at time zone ${zone})::date) + 1)::text as ahead`);
      // current_date is the session's day; the platform's stamps rely on it being UTC's.
      expect(r.utc, "the database session's current_date is the UTC day").toBe(r.utc_now);
      day = { utc: String(r.utc), org: String(r.org), eff: String(r.eff), ahead: String(r.ahead) };
    });

    it(`precondition: in ${zone} the organization's day differs from the UTC day`, () => {
      expect(day.org, `UTC ${day.utc}, ${zone} ${day.org} - a run straddling UTC midnight or noon; re-run`).not.toBe(day.utc);
    });

    it("(a) a worship.schedule grant stamped on the in-effect day (the definers' UTC stamp, west of UTC) places a draft", async () => {
      const k = await t.person(w.org, "Kestrel");
      await grantKey(k, day.eff);
      expect(await place(k, w.alice)).toBe("ok");
    });

    it("(b) a leader seat stamped on the in-effect day places a draft on its team", async () => {
      const l = await t.person(w.org, "Linden");
      await seat(l, day.eff);
      expect(await place(l, w.alice)).toBe("ok");
    });

    it("(b) a roster row stamped on the in-effect day is on the team now", async () => {
      const r = await t.person(w.org, "Rowan");
      await seat(r, day.eff, null, "member");
      expect(await place(w.scheduler, r)).toBe("ok");
    });

    it("(b) a seat and a roster row both stamped on the in-effect day", async () => {
      const l = await t.person(w.org, "Larch");
      const r = await t.person(w.org, "Rush");
      await seat(l, day.eff);
      await seat(r, day.eff, null, "member");
      expect(await place(l, r)).toBe("ok");
    });

    it("(c) a grant the platform ended today (ends_on = current_date) is ended at the trigger: not_authorized", async () => {
      const k = await t.person(w.org, "Kite");
      await grantKey(k, "2020-01-01", day.utc);
      expect(await place(k, w.alice)).toBe("worship_guard_not_authorized");
    });

    it("(c) a leader seat ended on current_date schedules nothing", async () => {
      const l = await t.person(w.org, "Lark");
      await seat(l, "2020-01-01", day.utc);
      expect(await place(l, w.alice)).toBe("worship_guard_not_authorized");
    });

    it("(c) a roster row ended on current_date is not on the team: not_on_roster", async () => {
      const r = await t.person(w.org, "Reed");
      await seat(r, "2020-01-01", day.utc, "member");
      expect(await place(w.scheduler, r)).toBe("worship_guard_not_on_roster");
    });

    it("a grant or a seat stamped one day after the in-effect day is not yet in effect", async () => {
      const k = await t.person(w.org, "Kerria");
      await grantKey(k, day.ahead);
      expect(await place(k, w.alice)).toBe("worship_guard_not_authorized");
      const l = await t.person(w.org, "Lupin");
      await seat(l, day.ahead);
      expect(await place(l, w.alice)).toBe("worship_guard_not_authorized");
    });

    it("presby_worship_in_effect_day agrees with the independently computed greatest(org day, UTC day)", async () => {
      expect((await tenantOne(w.org, sql`select presby_worship_in_effect_day(${w.org}::uuid)::text as d`)).d).toBe(day.eff);
    });
  });
});
