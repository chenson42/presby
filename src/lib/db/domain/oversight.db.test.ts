/**
 * D2: drizzle/0089_presby_oversight_records.sql on a REAL Postgres
 * connection (docs/work-log/2026-11-17-congregation-profile.md, Phase 3
 * "Test plan" D2; DECISION-344, 345, 349; F44, F450).
 *
 * scripts/oversight/test-rls-89.sql proves the presby_app half against the
 * stock seed. This file proves, on throwaway fixtures, what that suite
 * cannot reach, and re-proves the shared rules on BOTH connections:
 *
 *   - both connections (presby_app via `db` with the org GUC set, and the
 *     owner via getPlatformDb(), which no grant binds - F44): every CHECK
 *     boundary, every partial unique (a removed name or year is reusable, a
 *     second live one is refused), the three-column FK, removal one-way, the
 *     building-live guard, the about-org trigger;
 *   - the OWNER path only: the immutable-column rule of
 *     presby_oversight_guard_write (on presby_app the column grant refuses
 *     first), the owner's import allowances (a removed row and a supplied
 *     created_at), the photo blob FKs against a public_site blob;
 *   - R9: after a congregation departs, a new row about it is refused and an
 *     edit of an existing row that does not move about_org_id is accepted;
 *   - the FOR SHARE serialization of a child insert against a concurrent
 *     building removal, under two connections;
 *   - presby_public_site_asset() against a presbytery with a LIVE site: a
 *     public_site blob is served (positive control), a building photo's
 *     blobs are not;
 *   - grants by aclexplode (no DELETE or TRUNCATE for presby_app, nothing
 *     for presby_platform);
 *   - the teardown order (F-none; Phase 3 "verify the cascade in B1's first
 *     hour"): about_org_id is NO ACTION, so a congregation with records about
 *     it cannot be deleted; the rows go first, then the congregation, then
 *     the presbytery, whose organization_id cascade is then free;
 *   - the bundle function equals foundingAdministratorPlan() for every
 *     organization type, and section 3 (the backfill), re-run from the
 *     migration file's own text, tops up a fixture presbytery founding role
 *     and leaves a congregation's alone.
 *
 * Fixtures: synthetic names (No Real Data); organizations and people stamped
 * deletable_until at insert by createCalendarFixture.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/oversight.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
// Enter the domain cycle through the canonical entry point first (the reason
// giving.schema.test.ts gives); ./oversight is re-exported from ./index.ts
// only at integration (Rule 16).
import "../schema";
import { OVERSIGHT_GUARD_CODES, OVERSIGHT_MONEY_MAX_CENTS } from "./oversight";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
type Db = CalendarFixture["platform"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MIGRATION = readFileSync(path.join(__dirname, "../../../../drizzle/0089_presby_oversight_records.sql"), "utf8");
const SIX = [
  "oversight_profiles",
  "oversight_buildings",
  "oversight_building_photos",
  "oversight_building_appraisals",
  "oversight_insurance_years",
  "oversight_loans",
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
  expect(pgField(caught, "code"), String(pgField(caught, "message"))).toBe(code);
  if (constraint) expect(pgField(caught, "constraint"), String(pgField(caught, "message"))).toBe(constraint);
}

describe.skipIf(!hasDb)("drizzle/0089 congregation records (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let appDb: Db;
  let P: string; // the presbytery
  let P2: string; // another presbytery, no members
  let C1: string; // member congregation
  let C2: string; // member congregation
  let C3: string; // member congregation that departs (R9)
  let CX: string; // a congregation of P2, for the bundle/backfill cases
  let U: string; // the acting user (created_by)
  const congregations: string[] = [];

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  type Conn = "owner" | "app";

  /** Runs `fn` on the chosen connection, in P's org context, ALWAYS rolled back. */
  async function rolledBack(conn: Conn, fn: (tx: Tx) => Promise<void>, org?: string): Promise<void> {
    const dbh = conn === "owner" ? fx.platform : appDb;
    try {
      await dbh.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${org ?? P}, true)`);
        await fn(tx as Tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** Expect `stmt` to raise, in a savepoint so the surrounding transaction survives. */
  async function refused(tx: Tx, stmt: SQL, code: string, constraint?: string): Promise<void> {
    await expectPg(
      tx.transaction(async (sp) => {
        await sp.execute(stmt);
      }),
      code,
      constraint,
    );
  }

  async function one(tx: Tx, stmt: SQL): Promise<Row> {
    const rows = rowsOf(await tx.execute(stmt));
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function building(tx: Tx, about: string, name: string): Promise<string> {
    const r = await one(
      tx,
      sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by)
          values (${P}, ${about}, ${name}, 'other', ${U}, ${U}) returning id`,
    );
    return String(r.id);
  }

  async function blob(tx: Tx, org: string, audience: "private" | "public_site"): Promise<string> {
    const r = await one(
      tx,
      sql`insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
          values (${org}, md5(random()::text) || md5(clock_timestamp()::text), 'image/webp', 4, '\\x52494646'::bytea, ${audience})
          returning id`,
    );
    return String(r.id);
  }

  async function affiliate(subject: string, parent: string) {
    await q(sql`
      insert into organization_affiliations
        (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
      values (${parent}, ${subject}, ${parent}, 'member_congregation', '2000-01-01', 'recorded',
              'Fixture affiliation for oversight.db.test.ts')`);
  }

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("ovr89");
    appDb = (await import("@/lib/db")).db as unknown as Db;
    U = fx.actingUserId;
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    P2 = await fx.makeOrg("OtherPresbytery", { organizationType: "presbytery" });
    C1 = await fx.makeOrg("Cong1");
    C2 = await fx.makeOrg("Cong2");
    C3 = await fx.makeOrg("Cong3");
    CX = await fx.makeOrg("CongX");
    congregations.push(C1, C2, C3, CX);
    await affiliate(C1, P);
    await affiliate(C2, P);
    await affiliate(C3, P);
    await affiliate(CX, P2);
  });

  afterAll(async () => {
    if (!fx) return;
    // The teardown order this file's last describe pins: the six tables'
    // rows first (about_org_id is NO ACTION), children before buildings, then
    // the congregations (each delete cascades its own affiliation rows), then
    // cleanup() deletes the presbyteries and the people.
    const orgs = [P, P2].filter(Boolean);
    for (const t of [
      "oversight_building_photos",
      "oversight_building_appraisals",
      "oversight_loans",
      "oversight_buildings",
      "oversight_insurance_years",
      "oversight_profiles",
    ]) {
      await q(sql`delete from ${sql.identifier(t)} where organization_id in ${orgs}`);
    }
    await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      for (const c of congregations) await q(sql`delete from organizations where id = ${c}`);
    } finally {
      await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    await fx.cleanup();
  });

  // -------------------------------------------------------------------------
  describe.each(["app", "owner"] as const)("on the %s connection", (conn) => {
    it("(precondition) the connection is who it claims to be", async () => {
      await rolledBack(conn, async (tx) => {
        const r = await one(tx, sql`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as b`);
        if (conn === "app") expect(r).toEqual({ u: "presby_app", b: false });
        else expect(r.u).not.toBe("presby_app");
      });
    });

    it("CHECK boundaries: years, money, square feet, lengths, closed lists and pairs", async () => {
      await rolledBack(conn, async (tx) => {
        const b = await building(tx, C1, "B89 Boundary");
        const loan = String(
          (
            await one(
              tx,
              sql`insert into oversight_loans (organization_id, about_org_id, kind, created_by, updated_by)
                  values (${P}, ${C1}, 'other', ${U}, ${U}) returning id`,
            )
          ).id,
        );
        const cases: Array<[SQL, string | null]> = [
          [sql`update oversight_buildings set year_built = 1599 where id = ${b}`, "oversight_buildings_year_built_range"],
          [sql`update oversight_buildings set year_built = 1600 where id = ${b}`, null],
          [sql`update oversight_buildings set year_built = 2100 where id = ${b}`, null],
          [sql`update oversight_buildings set year_built = 2101 where id = ${b}`, "oversight_buildings_year_built_range"],
          [sql`update oversight_buildings set year_built = 1950, first_addition_year = 1949 where id = ${b}`, "oversight_buildings_first_addition_order"],
          [sql`update oversight_buildings set year_built = 1950, second_addition_year = 1949 where id = ${b}`, "oversight_buildings_second_addition_after_built"],
          [sql`update oversight_buildings set square_feet = 0 where id = ${b}`, "oversight_buildings_square_feet_range"],
          [sql`update oversight_buildings set square_feet = 5000000 where id = ${b}`, null],
          [sql`update oversight_buildings set square_feet = 5000001 where id = ${b}`, "oversight_buildings_square_feet_range"],
          [sql`update oversight_buildings set name = '' where id = ${b}`, "oversight_buildings_name_length"],
          [sql`update oversight_buildings set name = repeat('n', 121) where id = ${b}`, "oversight_buildings_name_length"],
          [sql`update oversight_buildings set boiler_condition = 'bad' where id = ${b}`, "oversight_buildings_boiler_condition"],
          [sql`update oversight_buildings set retired_reason = 'sold' where id = ${b}`, "oversight_buildings_retired_pair"],
          [sql`update oversight_loans set original_amount_cents = ${OVERSIGHT_MONEY_MAX_CENTS} where id = ${loan}`, null],
          [sql`update oversight_loans set original_amount_cents = ${OVERSIGHT_MONEY_MAX_CENTS + 1} where id = ${loan}`, "oversight_loans_original_amount_range"],
          [sql`update oversight_loans set grants_amount_cents = -1 where id = ${loan}`, "oversight_loans_grants_amount_range"],
          [sql`update oversight_loans set current_balance_cents = 5 where id = ${loan}`, "oversight_loans_balance_pair"],
          [sql`update oversight_loans set status = 'paid_off' where id = ${loan}`, "oversight_loans_paid_off_pair"],
          [sql`update oversight_loans set lender = repeat('x', 201) where id = ${loan}`, "oversight_loans_lender_length"],
          [
            sql`insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (${P}, ${C1}, 1899, ${U}, ${U})`,
            "oversight_insurance_years_policy_year_range",
          ],
          [
            sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (${P}, ${C1}, ${b}, 2000, ${OVERSIGHT_MONEY_MAX_CENTS + 1}, ${U})`,
            "oversight_building_appraisals_amount_range",
          ],
          [
            sql`insert into oversight_profiles (organization_id, about_org_id, year_organized, created_by, updated_by) values (${P}, ${C2}, 2101, ${U}, ${U})`,
            "oversight_profiles_year_organized_range",
          ],
          [
            sql`insert into oversight_profiles (organization_id, about_org_id, phone, created_by, updated_by) values (${P}, ${C2}, repeat('5', 41), ${U}, ${U})`,
            "oversight_profiles_phone_length",
          ],
        ];
        for (const [stmt, constraint] of cases) {
          if (constraint) await refused(tx, stmt, "23514", constraint);
          else await tx.execute(stmt);
        }
      });
    });

    it("partial uniques: a second live one is refused, a removed one is reusable", async () => {
      await rolledBack(conn, async (tx) => {
        const b1 = await building(tx, C1, "B89 Hall");
        await refused(
          tx,
          sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (${P}, ${C1}, 'b89 HALL', 'other', ${U}, ${U})`,
          "23505",
          "oversight_buildings_live_name_idx",
        );
        await tx.execute(sql`update oversight_buildings set removed_at = now(), removed_by = ${U} where id = ${b1}`);
        const b2 = await building(tx, C1, "B89 Hall");
        await tx.execute(sql`update oversight_buildings set is_primary = true where id = ${b2}`);
        const b3 = await building(tx, C1, "B89 Annex");
        await refused(tx, sql`update oversight_buildings set is_primary = true where id = ${b3}`, "23505", "oversight_buildings_one_primary_idx");
        await tx.execute(sql`insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (${P}, ${C1}, 2025, ${U}, ${U})`);
        await refused(
          tx,
          sql`insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (${P}, ${C1}, 2025, ${U}, ${U})`,
          "23505",
          "oversight_insurance_years_live_year_idx",
        );
        await tx.execute(sql`update oversight_insurance_years set removed_at = now(), removed_by = ${U} where about_org_id = ${C1} and policy_year = 2025`);
        await tx.execute(sql`insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (${P}, ${C1}, 2025, ${U}, ${U})`);
        await tx.execute(sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (${P}, ${C1}, ${b2}, 2024, 100, ${U})`);
        await refused(
          tx,
          sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (${P}, ${C1}, ${b2}, 2024, 200, ${U})`,
          "23505",
          "oversight_building_appraisals_live_year_idx",
        );
        const img = await blob(tx, P, "private");
        const th = await blob(tx, P, "private");
        await tx.execute(sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, is_cover, created_by) values (${P}, ${C1}, ${b2}, ${img}, ${th}, 10, 10, true, ${U})`);
        await refused(
          tx,
          sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, is_cover, created_by) values (${P}, ${C1}, ${b2}, ${await blob(tx, P, "private")}, ${await blob(tx, P, "private")}, 10, 10, true, ${U})`,
          "23505",
          "oversight_building_photos_one_cover_idx",
        );
        await refused(
          tx,
          sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (${P}, ${C1}, ${b2}, ${img}, ${await blob(tx, P, "private")}, 10, 10, ${U})`,
          "23505",
          "oversight_building_photos_live_image_idx",
        );
      });
    });

    it("the three-column FK refuses a child naming another congregation's building", async () => {
      await rolledBack(conn, async (tx) => {
        const b = await building(tx, C1, "B89 Sanctuary");
        await refused(
          tx,
          sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (${P}, ${C2}, ${b}, 2024, 1, ${U})`,
          "23503",
          "oversight_building_appraisals_building_fk",
        );
        await refused(
          tx,
          sql`insert into oversight_loans (organization_id, about_org_id, building_id, kind, created_by, updated_by) values (${P}, ${C2}, ${b}, 'other', ${U}, ${U})`,
          "23503",
          "oversight_loans_building_fk",
        );
        await refused(
          tx,
          sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (${P}, ${C2}, ${b}, ${await blob(tx, P, "private")}, ${await blob(tx, P, "private")}, 10, 10, ${U})`,
          "23503",
          "oversight_building_photos_building_fk",
        );
      });
    });

    it("removal is one-way, and nothing new is added to a removed building", async () => {
      await rolledBack(conn, async (tx) => {
        const b = await building(tx, C1, "B89 Removed");
        await tx.execute(sql`update oversight_buildings set removed_at = now(), removed_by = ${U} where id = ${b}`);
        await refused(tx, sql`update oversight_buildings set notes = 'x' where id = ${b}`, "23514", OVERSIGHT_GUARD_CODES.removalFinal);
        await refused(
          tx,
          sql`update oversight_buildings set removed_at = null, removed_by = null where id = ${b}`,
          "23514",
          OVERSIGHT_GUARD_CODES.removalFinal,
        );
        await refused(
          tx,
          sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (${P}, ${C1}, ${b}, 2024, 1, ${U})`,
          "23514",
          OVERSIGHT_GUARD_CODES.buildingRemoved,
        );
        await refused(
          tx,
          sql`insert into oversight_loans (organization_id, about_org_id, building_id, kind, created_by, updated_by) values (${P}, ${C1}, ${b}, 'other', ${U}, ${U})`,
          "23514",
          OVERSIGHT_GUARD_CODES.buildingRemoved,
        );
        await refused(
          tx,
          sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (${P}, ${C1}, ${b}, ${await blob(tx, P, "private")}, ${await blob(tx, P, "private")}, 10, 10, ${U})`,
          "23514",
          OVERSIGHT_GUARD_CODES.buildingRemoved,
        );
        // A loan already linked keeps its link; only a NEW link is refused.
        const live = await building(tx, C1, "B89 Live");
        const loan = String(
          (
            await one(
              tx,
              sql`insert into oversight_loans (organization_id, about_org_id, building_id, kind, created_by, updated_by) values (${P}, ${C1}, ${live}, 'other', ${U}, ${U}) returning id`,
            )
          ).id,
        );
        await tx.execute(sql`update oversight_buildings set removed_at = now(), removed_by = ${U} where id = ${live}`);
        await tx.execute(sql`update oversight_loans set lender = 'kept' where id = ${loan}`);
        await refused(tx, sql`update oversight_loans set building_id = ${b} where id = ${loan}`, "23514", OVERSIGHT_GUARD_CODES.buildingRemoved);
      });
    });

    it("the about-org trigger: a never-affiliated congregation and the presbytery itself are refused", async () => {
      await rolledBack(conn, async (tx) => {
        await refused(
          tx,
          sql`insert into oversight_profiles (organization_id, about_org_id, created_by, updated_by) values (${P}, ${CX}, ${U}, ${U})`,
          "42501",
        );
        await refused(
          tx,
          sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (${P}, ${P}, 'B89 Self', 'other', ${U}, ${U})`,
          "42501",
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("the owner path only (F44: no grant binds neondb_owner, the guards do)", () => {
    it("every immutable column is refused on every guarded table, including provenance (an imported row stays imported)", async () => {
      await rolledBack("owner", async (tx) => {
        const b = await building(tx, C1, "B89 Immutable");
        const other = await building(tx, C2, "B89 Other");
        const ins = String(
          (await one(tx, sql`insert into oversight_insurance_years (organization_id, about_org_id, policy_year, provenance, created_by, updated_by) values (${P}, ${C1}, 2024, 'imported', ${U}, ${U}) returning id`)).id,
        );
        const loan = String(
          (await one(tx, sql`insert into oversight_loans (organization_id, about_org_id, kind, created_by, updated_by) values (${P}, ${C1}, 'other', ${U}, ${U}) returning id`)).id,
        );
        const ap = String(
          (await one(tx, sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, notes, created_by) values (${P}, ${C1}, ${b}, 2024, 100, 'n', ${U}) returning id`)).id,
        );
        const ph = String(
          (await one(tx, sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (${P}, ${C1}, ${b}, ${await blob(tx, P, "private")}, ${await blob(tx, P, "private")}, 10, 10, ${U}) returning id`)).id,
        );
        const imm = OVERSIGHT_GUARD_CODES.immutable;
        const cases: SQL[] = [
          sql`update oversight_buildings set provenance = 'imported' where id = ${b}`,
          sql`update oversight_buildings set about_org_id = ${C2} where id = ${b}`,
          sql`update oversight_buildings set created_at = now() - interval '1 day' where id = ${b}`,
          sql`update oversight_buildings set created_by = null where id = ${b}`,
          sql`update oversight_buildings set organization_id = ${P2} where id = ${b}`,
          sql`update oversight_buildings set id = gen_random_uuid() where id = ${b}`,
          sql`update oversight_insurance_years set provenance = 'presbytery_entered' where id = ${ins}`,
          sql`update oversight_insurance_years set policy_year = 2023 where id = ${ins}`,
          sql`update oversight_loans set about_org_id = ${C2} where id = ${loan}`,
          sql`update oversight_loans set provenance = 'imported' where id = ${loan}`,
          sql`update oversight_building_appraisals set amount_cents = 1 where id = ${ap}`,
          sql`update oversight_building_appraisals set assessed_year = 2023 where id = ${ap}`,
          sql`update oversight_building_appraisals set notes = 'edited' where id = ${ap}`,
          sql`update oversight_building_appraisals set building_id = ${other} where id = ${ap}`,
          sql`update oversight_building_photos set width = 20 where id = ${ph}`,
          sql`update oversight_building_photos set image_asset_key = ${await blob(tx, P, "private")} where id = ${ph}`,
          sql`update oversight_building_photos set building_id = ${other} where id = ${ph}`,
        ];
        for (const stmt of cases) await refused(tx, stmt, "23514", imm);
        // What may change, does.
        await tx.execute(sql`update oversight_loans set building_id = ${b}, lender = 'L' where id = ${loan}`);
        await tx.execute(sql`update oversight_building_photos set caption = 'c', is_cover = true where id = ${ph}`);
        await tx.execute(sql`update oversight_insurance_years set carrier = 'C', row_version = row_version + 1 where id = ${ins}`);
      });
    });

    it("the owner may insert a removed row and keep a supplied created_at (the import session); a tenant may do neither", async () => {
      await rolledBack("owner", async (tx) => {
        const r = await one(
          tx,
          sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_at, created_by, updated_by, removed_at, removed_by, provenance)
              values (${P}, ${C1}, 'B89 Imported', 'other', '2001-02-03T00:00:00Z', ${U}, ${U}, now(), ${U}, 'imported')
              returning created_at, provenance`,
        );
        expect(new Date(String(r.created_at)).toISOString()).toBe("2001-02-03T00:00:00.000Z");
        expect(r.provenance).toBe("imported");
      });
      await rolledBack("app", async (tx) => {
        await refused(
          tx,
          sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by, removed_at, removed_by) values (${P}, ${C1}, 'B89 Born removed', 'other', ${U}, ${U}, now(), ${U})`,
          "23514",
          OVERSIGHT_GUARD_CODES.insertRemoved,
        );
        const r = await one(
          tx,
          sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_at, created_by, updated_by)
              values (${P}, ${C1}, 'B89 Clock', 'other', '2001-02-03T00:00:00Z', ${U}, ${U}) returning created_at`,
        );
        expect(Date.now() - new Date(String(r.created_at)).getTime()).toBeLessThan(3_600_000);
      });
    });

    it("'imported' is the owner-run import's alone: a tenant insert of it is refused on all five tables; an unknown value is the CHECK's", async () => {
      await rolledBack("app", async (tx) => {
        const b = await building(tx, C1, "B89 Prov");
        const code = OVERSIGHT_GUARD_CODES.provenance;
        const cases: SQL[] = [
          sql`insert into oversight_profiles (organization_id, about_org_id, provenance, created_by, updated_by) values (${P}, ${C2}, 'imported', ${U}, ${U})`,
          sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, provenance, created_by, updated_by) values (${P}, ${C1}, 'B89 Imp', 'other', 'imported', ${U}, ${U})`,
          sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, provenance, created_by) values (${P}, ${C1}, ${b}, 2020, 1, 'imported', ${U})`,
          sql`insert into oversight_insurance_years (organization_id, about_org_id, policy_year, provenance, created_by, updated_by) values (${P}, ${C1}, 2020, 'imported', ${U}, ${U})`,
          sql`insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (${P}, ${C1}, 'other', 'imported', ${U}, ${U})`,
        ];
        for (const stmt of cases) await refused(tx, stmt, "23514", code);
        await tx.execute(
          sql`insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (${P}, ${C1}, 'other', 'presbytery_entered', ${U}, ${U})`,
        );
      });
      await rolledBack("owner", async (tx) => {
        await tx.execute(
          sql`insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (${P}, ${C1}, 'other', 'imported', ${U}, ${U})`,
        );
        await tx.execute(
          sql`insert into oversight_profiles (organization_id, about_org_id, provenance, created_by, updated_by) values (${P}, ${C2}, 'imported', ${U}, ${U})`,
        );
        await refused(
          tx,
          sql`insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (${P}, ${C1}, 'other', 'guessed', ${U}, ${U})`,
          "23514",
          "oversight_loans_provenance",
        );
      });
    });

    it("an imported row stays imported through a tenant edit, and a tenant cannot change its provenance", async () => {
      const [row] = await q(sql`
        insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by)
        values (${P}, ${C1}, 'other', 'imported', ${U}, ${U}) returning id`);
      const loan = String(row!.id);
      await rolledBack("app", async (tx) => {
        await tx.execute(sql`update oversight_loans set lender = 'Edited', row_version = row_version + 1 where id = ${loan}`);
        const r = await one(tx, sql`select provenance, lender from oversight_loans where id = ${loan}`);
        expect(r).toEqual({ provenance: "imported", lender: "Edited" });
        await refused(tx, sql`update oversight_loans set provenance = 'presbytery_entered' where id = ${loan}`, "42501");
      });
    });

    it("a building photo cannot point at a public_site blob, even as the owner", async () => {
      await rolledBack("owner", async (tx) => {
        const b = await building(tx, C1, "B89 Photo");
        const pub = await blob(tx, P, "public_site");
        await refused(
          tx,
          sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (${P}, ${C1}, ${b}, ${pub}, ${await blob(tx, P, "private")}, 10, 10, ${U})`,
          "23503",
          "oversight_building_photos_image_fk",
        );
        await refused(
          tx,
          sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, asset_audience, width, height, created_by) values (${P}, ${C1}, ${b}, ${pub}, ${await blob(tx, P, "public_site")}, 'public_site', 10, 10, ${U})`,
          "23514",
          "oversight_building_photos_audience_private",
        );
        // Another organization's private blob is refused too (the org column is in the FK).
        await refused(
          tx,
          sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (${P}, ${C1}, ${b}, ${await blob(tx, P2, "private")}, ${await blob(tx, P, "private")}, 10, 10, ${U})`,
          "23503",
          "oversight_building_photos_image_fk",
        );
      });
    });

    it("presby_public_site_asset() with a LIVE site: serves a public_site blob (control), never a building photo's blobs", async () => {
      await rolledBack("owner", async (tx) => {
        await tx.execute(sql`insert into organization_sites (organization_id, repo, status) values (${P}, 'fixture/ovr89', 'live')`);
        const pub = await blob(tx, P, "public_site");
        const b = await building(tx, C1, "B89 Door");
        const img = await blob(tx, P, "private");
        const th = await blob(tx, P, "private");
        await tx.execute(sql`insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (${P}, ${C1}, ${b}, ${img}, ${th}, 10, 10, ${U})`);
        const served = async (key: string) =>
          rowsOf(await tx.execute(sql`select count(*)::int as n from presby_public_site_asset(${P}, ${key})`))[0]!.n;
        expect(await served(pub)).toBe(1);
        expect(await served(img)).toBe(0);
        expect(await served(th)).toBe(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("R9: a congregation that departs", () => {
    it("keeps its rows: an edit that does not move about_org_id is accepted, a new row about it is refused", async () => {
      await rolledBack("owner", async (tx) => {
        const b = await building(tx, C3, "B89 Departing");
        const ins = String(
          (await one(tx, sql`insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (${P}, ${C3}, 2025, ${U}, ${U}) returning id`)).id,
        );
        // Close the affiliation as presby_transfer_affiliation would (the guard's GUC), effective today.
        await tx.execute(sql`select set_config('presby.affiliation_trigger_active', 'true', true)`);
        await tx.execute(sql`
          update organization_affiliations
             set effective_to = current_date, closed_by_org_id = ${P}, closed_on = current_date,
                 closed_minute_reference = 'Fixture departure for oversight.db.test.ts'
           where subject_org_id = ${C3} and effective_to is null`);
        await tx.execute(sql`select set_config('presby.affiliation_trigger_active', '', true)`);
        const [aff] = rowsOf(await tx.execute(sql`select presby_org_affiliated(${C3}, ${P}, current_date) as ok`));
        expect(aff!.ok).toBe(false);
        // Edits of existing rows pass.
        await tx.execute(sql`update oversight_buildings set notes = 'still ours', row_version = row_version + 1 where id = ${b}`);
        await tx.execute(sql`update oversight_insurance_years set carrier = 'Still recorded' where id = ${ins}`);
        await tx.execute(sql`update oversight_buildings set removed_at = now(), removed_by = ${U} where id = ${b}`);
        // New top-level rows are refused.
        await refused(
          tx,
          sql`insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (${P}, ${C3}, 'B89 New', 'other', ${U}, ${U})`,
          "42501",
        );
        await refused(
          tx,
          sql`insert into oversight_loans (organization_id, about_org_id, kind, created_by, updated_by) values (${P}, ${C3}, 'other', ${U}, ${U})`,
          "42501",
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("FOR SHARE: a child insert and a building removal serialize (two connections)", () => {
    it("an appraisal started while the building's removal is uncommitted waits, then is refused", async () => {
      // Committed setup (cleaned by afterAll).
      const [row] = await q(sql`
        insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by)
        values (${P}, ${C2}, ${"B89 Race " + Date.now()}, 'other', ${U}, ${U}) returning id`);
      const b = String(row!.id);

      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let removedLocked!: () => void;
      const locked = new Promise<void>((r) => (removedLocked = r));

      const remover = fx.platform.transaction(async (tx) => {
        await tx.execute(sql`update oversight_buildings set removed_at = now(), removed_by = ${U} where id = ${b}`);
        removedLocked();
        await gate;
      });
      await locked;

      let settled = false;
      const appraiser = fx.platform
        .transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.current_org_id', ${P}, true)`);
          await tx.execute(sql`
            insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by)
            values (${P}, ${C2}, ${b}, 2024, 1, ${U})`);
        })
        .finally(() => {
          settled = true;
        });
      // Handled from the start, so its rejection is never briefly unhandled.
      const outcome = appraiser.then(
        () => null,
        (e: unknown) => e,
      );
      await new Promise((r) => setTimeout(r, 1500));
      // Read, then ALWAYS release before asserting: a failed assertion that
      // left the removal open would hold its row lock past the teardown.
      const settledBeforeCommit = settled;
      release();
      await remover;
      const err = await outcome;
      expect(settledBeforeCommit, "the appraisal insert waited on the removal's row lock").toBe(false);
      await expectPg(err ? Promise.reject(err) : Promise.resolve(), "23514", OVERSIGHT_GUARD_CODES.buildingRemoved);
      const [n] = await q(sql`select count(*)::int as n from oversight_building_appraisals where building_id = ${b}`);
      expect(n!.n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("grants (aclexplode, F38)", () => {
    it("presby_app holds no DELETE or TRUNCATE, presby_platform nothing, on all six", async () => {
      const rows = await q(sql`
        select c.relname, a.grantee::regrole::text as g, a.privilege_type as p
          from pg_class c, lateral aclexplode(c.relacl) a
         where c.relname in ${SIX} and c.relkind = 'r'
           and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)`);
      expect(rows.filter((r) => r.g === "presby_platform")).toEqual([]);
      expect(rows.filter((r) => ["DELETE", "TRUNCATE"].includes(String(r.p)))).toEqual([]);
      expect(rows).toHaveLength(12);
    });
  });

  // -------------------------------------------------------------------------
  describe("teardown order (the about-org FK has no cascade)", () => {
    it("a congregation with records about it cannot be deleted; after the rows go, it can, and then the presbytery's cascade is free", async () => {
      await rolledBack("owner", async (tx) => {
        const b = await building(tx, C1, "B89 Teardown");
        await tx.execute(sql`insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (${P}, ${C1}, ${b}, 2024, 1, ${U})`);
        await tx.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
        await refused(tx, sql`delete from organizations where id = ${C1}`, "23503");
        // The B4 contract: all six tables, children before buildings (committed
        // rows of earlier tests included), then the congregations, then the presbytery.
        for (const t of [
          "oversight_building_photos",
          "oversight_building_appraisals",
          "oversight_loans",
          "oversight_buildings",
          "oversight_insurance_years",
          "oversight_profiles",
        ]) {
          await tx.execute(sql`delete from ${sql.identifier(t)} where organization_id = ${P}`);
        }
        for (const c of [C1, C2, C3]) await tx.execute(sql`delete from organizations where id = ${c}`);
        await tx.execute(sql`delete from organizations where id = ${P}`);
        const [n] = rowsOf(
          await tx.execute(sql`select (select count(*) from oversight_buildings where organization_id = ${P})::int as n`),
        );
        expect(n!.n).toBe(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("the founding bundle and the backfill (R2, DECISION-345, F450)", () => {
    it("presby_founding_administrator_permission_keys() equals foundingAdministratorPlan() for every organization type", async () => {
      const { foundingAdministratorPlan } = await import("@/lib/onboarding/founding-administrator");
      const types = await q(sql`select unnest(enum_range(null::organization_type))::text as t`);
      expect(types.length).toBeGreaterThanOrEqual(5);
      for (const { t } of types) {
        const [r] = await q(sql`select presby_founding_administrator_permission_keys(${t}) as keys`);
        expect(r!.keys, String(t)).toEqual(
          foundingAdministratorPlan(t as Parameters<typeof foundingAdministratorPlan>[0]).administration.permissionKeys,
        );
      }
      const [pr] = await q(sql`select presby_founding_administrator_permission_keys('presbytery') as keys`);
      expect((pr!.keys as string[]).slice(-2)).toEqual(["congregation_oversight.manage", "congregation_oversight.finance"]);
    });

    it("section 3, re-run from the migration text, tops up a presbytery founding role and leaves a congregation's alone", async () => {
      const start = MIGRATION.indexOf("-- 3. Backfill");
      const doStart = MIGRATION.indexOf("do $$", start);
      const doEnd = MIGRATION.indexOf("end $$;", doStart) + "end $$;".length;
      const backfill = MIGRATION.slice(doStart, doEnd);
      expect(backfill).toMatch(/o\.organization_type = 'presbytery'/);
      await rolledBack("owner", async (tx) => {
        const role = async (org: string) =>
          String(
            (
              await one(
                tx,
                sql`insert into app_roles (organization_id, key, name, role_kind) values (${org}, 'founding_administrator', 'Founding Administrator', 'custom') returning id`,
              )
            ).id,
          );
        const pr = await role(P);
        const cr = await role(C1);
        await tx.execute(sql`insert into app_role_permissions (role_id, permission_key) values (${pr}, 'roles.manage'), (${cr}, 'roles.manage')`);
        await tx.execute(sql.raw(backfill));
        const held = async (r: string) =>
          rowsOf(await tx.execute(sql`select count(*)::int as n from app_role_permissions where role_id = ${r} and permission_key = 'congregation_oversight.finance'`))[0]!.n;
        expect(await held(pr)).toBe(1);
        expect(await held(cr)).toBe(0);
        // A re-run is a no-op (on conflict do nothing).
        await tx.execute(sql.raw(backfill));
        expect(await held(pr)).toBe(1);
      });
    });
  });
});
