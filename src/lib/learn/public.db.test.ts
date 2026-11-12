/**
 * T6 - drizzle/0087's presby_public_learn() and presby_learn_enabled() against a
 * real database (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 Tests T6;
 * DECISION-331). scripts/learn/test-rls-87.sql (as presby_app) carries the
 * SQL-level grant and gate assertions; this file holds what needs the owner to
 * build: every organization type, the category axis flag MISSING, an
 * organization that is not active, a suspended site, and the whole matrix.
 *
 * The owner (`getPlatformDb()`) writes the fixtures and calls the owner-only
 * predicate; the definer runs on `db` (presby_app, NO org GUC), exactly as the
 * anonymous route calls it.
 *
 * The matrix: organization type (all five) x category axis flag (on, off,
 * missing) x `learn` category row (on, off, missing) x toggle row (on, off,
 * missing) = 135 combinations (a superset of the design's 18 + 4). For every
 * one, the definer's availability equals the owner-side predicate and the
 * stated rule (Data Model item 2), and, once the catalog carries the entry,
 * `orgFeatureEnabledInTx`.
 *
 * BATCH 2 (landed): the catalog entry and `readPublicLearn` now exist, so the
 * `orgFeatureEnabledInTx` comparison runs on all 135 combinations, the "pending"
 * guard asserts the entry is present, and the gates test also asserts the REAL
 * reader (`readPublicLearn`, src/lib/learn/public.ts) returns the same answers
 * as the bare definer statement for every cause.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/learn/public.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import { SPOT_THE_SCAM_FEATURE_KEY } from "./contract";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));
vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];
}

/** A Postgres error field (code, constraint) through the driver's `cause` chain. */
function pgField(err: unknown, field: string): string | undefined {
  let cur: unknown = err;
  for (let i = 0; cur && i < 6; i += 1) {
    const v = (cur as Record<string, unknown>)[field];
    if (typeof v === "string" && v !== "") return v;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

type Tri = "on" | "off" | "missing";
const TRI: Tri[] = ["on", "off", "missing"];
const TYPES = ["congregation", "new_worshiping_community", "presbytery", "synod", "general_assembly"] as const;
const AXIS_FLAG = "org_portal.feature_categories";
const KEY = SPOT_THE_SCAM_FEATURE_KEY;

describe.skipIf(!hasDb)("presby_public_learn and presby_learn_enabled (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let app: { execute(query: SQL): Promise<unknown>; transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> };

  const owner = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));

  /** The anonymous read, on presby_app with no org GUC: every row it returns. */
  const callDefiner = async (slug: string | null, key: string | null): Promise<Row[]> =>
    rowsOf(await app.execute(sql`select * from presby_public_learn(${slug}::text, ${key}::text)`));

  /** The same call, whole row as text (for byte-identity). */
  const definerText = async (slug: string | null, key: string | null): Promise<string[]> =>
    rowsOf(await app.execute(sql`select (x.*)::text as r from presby_public_learn(${slug}::text, ${key}::text) x`)).map(
      (r) => String(r.r),
    );

  /** The owner-only predicate, called as the owner (the only role that may). */
  const callPredicate = async (org: string, key: string | null): Promise<boolean> => {
    const [row] = await owner(sql`select presby_learn_enabled(${org}::uuid, ${key}::text) as enabled`);
    return row!.enabled === true;
  };

  /** A fixture organization of `type` with an organization_sites row in `site` status (null = no row). */
  async function org(name: string, type: (typeof TYPES)[number] = "congregation", site: "live" | "provisioning" | "suspended" | null = "live") {
    const id = await fx.makeOrg(name, { organizationType: type });
    const [row] = await owner(sql`select slug from organizations where id = ${id}`);
    if (site) {
      await owner(sql`insert into organization_sites (organization_id, repo, status) values (${id}, ${`fixture/learn-${id}`}, ${site})`);
    }
    return { id, slug: String(row!.slug) };
  }

  const setToggle = async (orgId: string, key: string, s: Tri) => {
    await owner(sql`delete from organization_feature_toggles where organization_id = ${orgId} and feature_key = ${key}`);
    if (s !== "missing")
      await owner(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${orgId}, ${key}, ${s === "on"})`);
  };
  const setCategory = async (orgId: string, s: Tri) => {
    await owner(sql`delete from organization_feature_categories where organization_id = ${orgId}`);
    if (s !== "missing")
      await owner(sql`insert into organization_feature_categories (organization_id, category, enabled) values (${orgId}, 'learn', ${s === "on"})`);
  };

  let originalAxis: boolean | null = null;
  const setAxis = async (s: Tri) => {
    if (s === "missing") await owner(sql`delete from feature_flags where key = ${AXIS_FLAG}`);
    else
      await owner(sql`insert into feature_flags (key, enabled) values (${AXIS_FLAG}, ${s === "on"})
                       on conflict (key) do update set enabled = excluded.enabled`);
  };

  beforeAll(async () => {
    ({ db: app } = (await import("@/lib/db")) as unknown as { db: typeof app });
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("learn87");
    const [flag] = await owner(sql`select enabled from feature_flags where key = ${AXIS_FLAG}`);
    originalAxis = flag ? flag.enabled === true : null;
  });

  afterAll(async () => {
    if (fx) {
      // The axis flag is global: restore exactly what was there, row or no row.
      await setAxis(originalAxis === null ? "missing" : originalAxis ? "on" : "off");
      await fx.cleanup();
    }
  });

  it("the matrix: 5 types x axis x category x toggle = 135; the definer equals the predicate and the stated rule (and orgFeatureEnabledInTx once the catalog carries the key)", async () => {
    const { ORG_FEATURE_CATALOG, orgFeatureEnabledInTx, isCategoryAxisOn } = await import("@/lib/org-features");
    const entryPresent = ORG_FEATURE_CATALOG.some((e) => (e.key as string) === KEY);

    const orgs = new Map<(typeof TYPES)[number], { id: string; slug: string }>();
    for (const [i, type] of TYPES.entries()) orgs.set(type, await org(`m${i}`, type));

    const viaTs = (orgId: string, axisOn: boolean) =>
      app.transaction(async (tx) => {
        await (tx as { execute(q: SQL): Promise<unknown> }).execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
        return orgFeatureEnabledInTx(tx as Parameters<typeof orgFeatureEnabledInTx>[0], orgId, KEY, axisOn);
      });

    let compared = 0;
    let tsCompared = 0;
    let available = 0;
    const availableTypes = new Set<string>();
    try {
      for (const axis of TRI) {
        await setAxis(axis);
        const axisOn = await isCategoryAxisOn(); // the application's own read of the flag
        expect(axisOn, `axis ${axis}`).toBe(axis === "on");
        for (const type of TYPES) {
          const o = orgs.get(type)!;
          for (const category of TRI) {
            await setCategory(o.id, category);
            for (const toggle of TRI) {
              await setToggle(o.id, KEY, toggle);
              const label = `type=${type} axis=${axis} category=${category} toggle=${toggle}`;
              // The stated rule (0087 section 2): every type is admitted; axis off
              // (or missing) or category not off; toggle on.
              const rule = (axis !== "on" || category !== "off") && toggle === "on";

              const rows = await callDefiner(o.slug, KEY);
              expect(rows, `${label}: exactly one row`).toHaveLength(1);
              const isAvailable = rows[0]!.state === "available";
              expect(rows[0]!.state, label).toBe(rule ? "available" : "unavailable");
              expect(await callPredicate(o.id, KEY), `${label}: predicate`).toBe(isAvailable);
              if (entryPresent) {
                expect(await viaTs(o.id, axisOn), `${label}: orgFeatureEnabledInTx`).toBe(isAvailable);
                tsCompared += 1;
              }
              if (isAvailable) {
                available += 1;
                availableTypes.add(type);
              }
              compared += 1;
            }
          }
        }
      }
    } finally {
      await setAxis(originalAxis === null ? "missing" : originalAxis ? "on" : "off");
    }
    expect(compared).toBe(135);
    expect(entryPresent).toBe(true); // Batch 2: the catalog carries the key, so the TS half always runs
    expect(tsCompared).toBe(135);
    // Both outcomes are exercised: per type, axis off or missing (2 x 3 category
    // states) plus axis on with category on or missing (2) = 8 available.
    expect(available).toBe(8 * TYPES.length);
    // `orgTypes: null`: every organization type can have it.
    expect([...availableTypes].sort()).toEqual([...TYPES].sort());
  });

  it("the catalog carries the Learn entry and `learn` is in DOMAIN_ORDER (the two move together: the matrix's orgFeatureEnabledInTx half depends on both)", async () => {
    const { ORG_FEATURE_CATALOG } = await import("@/lib/org-features");
    const { DOMAIN_ORDER } = await import("@/lib/org-portal/tiles");
    expect(ORG_FEATURE_CATALOG.some((e) => (e.key as string) === KEY)).toBe(true);
    expect(DOMAIN_ORDER as readonly string[]).toContain("learn");
  });

  it("the key list is closed: a non-Learn key whose toggle is ON, an unknown key and a null key are unavailable and false", async () => {
    const o = await org("keys");
    await setToggle(o.id, KEY, "on");
    expect(await callDefiner(o.slug, KEY)).toEqual([{ state: "available" }]); // control
    for (const other of ["org_portal.careers", "org_portal.giving", "org_portal.calendar", "org_portal.worship"]) {
      await setToggle(o.id, other, "on");
      expect(await callDefiner(o.slug, other), other).toEqual([{ state: "unavailable" }]);
      expect(await callPredicate(o.id, other), other).toBe(false);
    }
    for (const unknown of ["org_portal.spot_the_scam_v2", "learn", "", null]) {
      expect(await callDefiner(o.slug, unknown), String(unknown)).toEqual([{ state: "unavailable" }]);
      expect(await callPredicate(o.id, unknown), String(unknown)).toBe(false);
    }
  });

  it("the real reader follows the toggle row, the category row and the axis: on is available, off and missing are unavailable, category off with the axis on is unavailable", async () => {
    const { readPublicLearn } = await import("./public");
    const o = await org("reader");
    await setCategory(o.id, "missing");
    await setAxis("on");
    try {
      await setToggle(o.id, KEY, "missing");
      expect(await readPublicLearn(o.slug, KEY), "toggle missing").toEqual({ state: "unavailable" });
      await setToggle(o.id, KEY, "off");
      expect(await readPublicLearn(o.slug, KEY), "toggle off").toEqual({ state: "unavailable" });
      await setToggle(o.id, KEY, "on");
      expect(await readPublicLearn(o.slug, KEY), "toggle on, category missing").toEqual({ state: "available" });
      await setCategory(o.id, "off");
      expect(await readPublicLearn(o.slug, KEY), "toggle on, category off, axis on").toEqual({ state: "unavailable" });
      await setAxis("off");
      expect(await readPublicLearn(o.slug, KEY), "toggle on, category off, axis off").toEqual({ state: "available" });
    } finally {
      await setAxis(originalAxis === null ? "missing" : originalAxis ? "on" : "off");
    }
  });

  it("an unknown organization is false in the predicate", async () => {
    const [row] = await owner(sql`select gen_random_uuid() as id`);
    expect(await callPredicate(String(row!.id), KEY)).toBe(false);
  });

  it("the gates: unknown or null slug, an organization not active, a site provisioning, suspended or absent are ONE byte-identical row", async () => {
    const live = await org("gate-live");
    const provisioning = await org("gate-prov", "congregation", "provisioning");
    const suspended = await org("gate-susp", "presbytery", "suspended");
    const noSite = await org("gate-nosite", "synod", null);
    for (const o of [live, provisioning, suspended, noSite]) await setToggle(o.id, KEY, "on");
    await setAxis("off");
    try {
      expect(await callDefiner(live.slug, KEY)).toEqual([{ state: "available" }]); // control

      const causes: Array<[string, string[]]> = [];
      causes.push(["unknown slug", await definerText("no-such-congregation-learn87", KEY)]);
      causes.push(["null slug", await definerText(null, KEY)]);
      causes.push(["site provisioning", await definerText(provisioning.slug, KEY)]);
      causes.push(["site suspended", await definerText(suspended.slug, KEY)]);
      causes.push(["no site row", await definerText(noSite.slug, KEY)]);
      await owner(sql`update organizations set status = 'inactive' where id = ${live.id}`);
      causes.push(["organization not active", await definerText(live.slug, KEY)]);
      await owner(sql`update organizations set status = 'active' where id = ${live.id}`);
      expect(await callDefiner(live.slug, KEY)).toEqual([{ state: "available" }]); // and back

      for (const [cause, rows] of causes) expect(rows, cause).toEqual(["unavailable"]);

      // The REAL reader (what the route, the slot and the leader panel call) answers
      // exactly as the bare definer does, for the control and for every cause above.
      const { readPublicLearn } = await import("./public");
      expect(await readPublicLearn(live.slug, SPOT_THE_SCAM_FEATURE_KEY), "reader: control").toEqual({ state: "available" });
      for (const o of [provisioning, suspended, noSite]) {
        expect(await readPublicLearn(o.slug, SPOT_THE_SCAM_FEATURE_KEY), `reader: ${o.slug}`).toEqual({ state: "unavailable" });
      }
      expect(await readPublicLearn("no-such-congregation-learn87", SPOT_THE_SCAM_FEATURE_KEY), "reader: unknown slug").toEqual({ state: "unavailable" });
      await owner(sql`update organizations set status = 'inactive' where id = ${live.id}`);
      expect(await readPublicLearn(live.slug, SPOT_THE_SCAM_FEATURE_KEY), "reader: organization not active").toEqual({ state: "unavailable" });
      await owner(sql`update organizations set status = 'active' where id = ${live.id}`);
    } finally {
      await setAxis(originalAxis === null ? "missing" : originalAxis ? "on" : "off");
    }
  });

  it("the definer answers the same whatever org GUC the caller holds (it is not reading through the caller's RLS)", async () => {
    const a = await org("guc-a");
    const b = await org("guc-b");
    await setToggle(a.id, KEY, "on");
    const answer = await app.transaction(async (tx) => {
      const t = tx as { execute(q: SQL): Promise<unknown> };
      await t.execute(sql`select set_config('app.current_org_id', ${b.id}, true)`);
      return rowsOf(await t.execute(sql`select * from presby_public_learn(${a.slug}::text, ${KEY}::text)`));
    });
    expect(answer).toEqual([{ state: "available" }]);
  });

  it("presby_app calling presby_learn_enabled directly is insufficient_privilege (owner-only)", async () => {
    const o = await org("direct");
    await setToggle(o.id, KEY, "on");
    let code: string | undefined;
    try {
      await app.execute(sql`select presby_learn_enabled(${o.id}::uuid, ${KEY}::text)`);
    } catch (err) {
      code = pgField(err, "code");
    }
    expect(code).toBe("42501");
  });

  it("the category CHECK admits `learn` and still refuses `administration`, on the owner path too", async () => {
    const o = await org("check");
    await owner(sql`insert into organization_feature_categories (organization_id, category, enabled) values (${o.id}, 'learn', true)`);
    const [row] = await owner(sql`select count(*)::int as n from organization_feature_categories where organization_id = ${o.id} and category = 'learn'`);
    expect(row!.n).toBe(1);
    let refused: { code?: string; constraint?: string } = {};
    try {
      await owner(sql`insert into organization_feature_categories (organization_id, category, enabled) values (${o.id}, 'administration', true)`);
    } catch (err) {
      refused = { code: pgField(err, "code"), constraint: pgField(err, "constraint") };
    }
    expect(refused).toEqual({ code: "23514", constraint: "organization_feature_categories_category_check" });
  });
});
