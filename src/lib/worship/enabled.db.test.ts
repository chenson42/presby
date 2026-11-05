/**
 * `presby_worship_enabled()` (drizzle/0085) equals `orgFeatureEnabledInTx` over
 * the WHOLE matrix: organization type (all five) x category-axis flag
 * (on, off, missing) x worship category row (on, off, missing) x toggle row
 * (on, off, missing) = 135 combinations (docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 Tests, `enabled.db.test.ts`). Both sides run on the presby_app
 * connection with the organization context set, exactly as the store and the
 * reminder claim's callers do (the SQL function is an invoker: RLS applies to
 * its reads).
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/enabled.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Tri = "on" | "off" | "missing";
const TRI: Tri[] = ["on", "off", "missing"];
const TYPES = ["congregation", "new_worshiping_community", "presbytery", "synod", "general_assembly"] as const;
const AXIS_FLAG = "org_portal.feature_categories";
const KEY = "org_portal.worship";

describe.skipIf(!hasDb)("presby_worship_enabled() equals orgFeatureEnabledInTx (Postgres-backed)", () => {
  let fx: CalendarFixture;

  const q = async (query: SQL) => fx.platform.execute(query);

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("wenabled");
  });
  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("agrees on all 135 combinations, and both outcomes are exercised", async () => {
    const { db } = await import("@/lib/db");
    const { orgFeatureEnabledInTx, isCategoryAxisOn } = await import("@/lib/org-features");

    const orgs = new Map<(typeof TYPES)[number], string>();
    for (const [index, type] of TYPES.entries()) orgs.set(type, await fx.makeOrg(`m${index}`, { organizationType: type }));

    const [original] = ((await q(sql`select enabled from feature_flags where key = ${AXIS_FLAG}`)) as unknown as {
      rows: Array<{ enabled: boolean }>;
    }).rows;
    const setAxis = async (s: Tri) => {
      if (s === "missing") await q(sql`delete from feature_flags where key = ${AXIS_FLAG}`);
      else
        await q(sql`insert into feature_flags (key, enabled) values (${AXIS_FLAG}, ${s === "on"})
                      on conflict (key) do update set enabled = excluded.enabled`);
    };
    const setCategory = async (org: string, s: Tri) => {
      await q(sql`delete from organization_feature_categories where organization_id = ${org}`);
      if (s !== "missing")
        await q(sql`insert into organization_feature_categories (organization_id, category, enabled) values (${org}, 'worship', ${s === "on"})`);
    };
    const setToggle = async (org: string, s: Tri) => {
      await q(sql`delete from organization_feature_toggles where organization_id = ${org} and feature_key = ${KEY}`);
      if (s !== "missing")
        await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${org}, ${KEY}, ${s === "on"})`);
    };

    type Tx = { execute(query: SQL): Promise<unknown> };
    const inOrg = <T,>(org: string, fn: (tx: Tx) => Promise<T>) =>
      (db as unknown as { transaction<T2>(f: (tx: unknown) => Promise<T2>): Promise<T2> }).transaction(async (tx) => {
        await (tx as Tx).execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        return fn(tx as Tx);
      });
    const viaSql = (org: string) =>
      inOrg(org, async (tx) => {
        const result = (await tx.execute(sql`select presby_worship_enabled(${org}::uuid) as enabled`)) as { rows: Array<{ enabled: boolean }> };
        return result.rows[0]!.enabled;
      });
    const viaTs = (org: string, axisOn: boolean) =>
      inOrg(org, (tx) => orgFeatureEnabledInTx(tx as unknown as Parameters<typeof orgFeatureEnabledInTx>[0], org, KEY, axisOn));

    let compared = 0;
    let enabled = 0;
    let disabled = 0;
    const enabledTypes = new Set<string>();
    try {
      for (const axis of TRI) {
        await setAxis(axis);
        const axisOn = await isCategoryAxisOn();
        expect(axisOn, `axis ${axis}`).toBe(axis === "on");
        for (const type of TYPES) {
          const org = orgs.get(type)!;
          for (const category of TRI) {
            await setCategory(org, category);
            for (const toggle of TRI) {
              await setToggle(org, toggle);
              const label = `type=${type} axis=${axis} category=${category} toggle=${toggle}`;
              const fromSql = await viaSql(org);
              expect(fromSql, label).toBe(await viaTs(org, axisOn));
              if (fromSql) {
                enabled += 1;
                enabledTypes.add(type);
              } else disabled += 1;
              compared += 1;
            }
          }
        }
      }
    } finally {
      if (original) await setAxis(original.enabled ? "on" : "off");
      else await setAxis("missing");
    }
    expect(compared).toBe(135);
    expect(enabled).toBeGreaterThan(0);
    expect(disabled).toBeGreaterThan(0);
    // Only the two types the catalog entry lists are ever on.
    expect([...enabledTypes].sort()).toEqual(["congregation", "new_worshiping_community"]);
  });

  it("an organization the connection cannot see reads as off (the invoker's RLS: another organization's toggle row is invisible)", async () => {
    const { db } = await import("@/lib/db");
    const here = await fx.makeOrg("see-here");
    const there = await fx.makeOrg("see-there");
    await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${there}, ${KEY}, true)
                on conflict (organization_id, feature_key) do update set enabled = true`);
    const answer = await (db as unknown as { transaction<T>(f: (tx: { execute(q: SQL): Promise<unknown> }) => Promise<T>): Promise<T> }).transaction(
      async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${here}, true)`);
        const result = (await tx.execute(sql`select presby_worship_enabled(${there}::uuid) as enabled`)) as { rows: Array<{ enabled: boolean }> };
        return result.rows[0]!.enabled;
      },
    );
    expect(answer).toBe(false);
  });
});
