/**
 * D2: drizzle/0090_presby_committees.sql on a REAL Postgres connection
 * (docs/work-log/2026-11-19-presbytery-committees.md, Phase 3 "Test plan" D2;
 * DECISION-353, 354, 355, 356, 358; F44, F457).
 *
 * scripts/committees/test-rls-90.sql proves the presby_app half against the
 * stock seed. This file proves, on throwaway fixtures, what that suite cannot
 * reach, and re-proves the shared rules on BOTH connections:
 *
 *   - both connections (presby_app via `db` with the org GUC set, and the
 *     owner via getPlatformDb(), which no grant binds - F44): every CHECK
 *     boundary; the committee_details guard (a choir, a derived group, a
 *     congregation's committee, the 1:1, frozen after dissolve); the
 *     commission guards (one-way end and removal, the WHEN null congregation,
 *     the about-org refusal); the live guard on a removed record; the
 *     one-open-seat unique;
 *   - the OWNER path's own rules: the immutable-column refusals (on
 *     presby_app the column grant refuses first), the history allowances (a
 *     dissolved details row, an ended record, a member of an ended record);
 *   - the composite FK behind the details guard, with the guard disabled
 *     inside a rolled-back transaction;
 *   - R9: after a congregation departs, an edit of a record about it that
 *     does not move about_org_id passes and a new record about it is refused;
 *   - the FOR SHARE serialization of a member add (presby_app) against a
 *     concurrent end of the record (owner), under two connections;
 *   - presby_public_committee_roster() at a PRESBYTERY with a live site: the
 *     seven scenarios (planned end listed; future start, ended seat, ended
 *     membership, death and a dissolved committee not; a commission member
 *     structurally absent), its four-column projection, and the asset door
 *     (presby_public_site_asset) serving a listed member's photo and not an
 *     unlisted or dissolved-committee member's;
 *   - grants by aclexplode (no DELETE or TRUNCATE for presby_app, nothing for
 *     presby_platform);
 *   - the teardown order: a congregation a commission record is about cannot
 *     be deleted until the record goes; deleting the presbytery cascades its
 *     committee_details, groups and seats.
 *
 * Fixtures: synthetic names (No Real Data); organizations and people stamped
 * deletable_until at insert by createCalendarFixture.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/committees.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
// Enter the domain cycle through the canonical entry point first (the reason
// giving.schema.test.ts gives); ./committees is re-exported from ./index.ts
// only at integration (Rule 16).
import "../schema";
import { COMMITTEES_GUARD_CODES as CODES } from "./committees";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
type Db = CalendarFixture["platform"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const THREE = ["committee_details", "commission_records", "commission_record_members"] as const;

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

describe.skipIf(!hasDb)("drizzle/0090 presbytery committees (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let appDb: Db;
  let P: string; // the presbytery (live site)
  let P2: string; // another presbytery
  let C1: string; // member congregation of P
  let C2: string; // member congregation of P (departs in R9)
  let CX: string; // congregation of P2
  let U: string; // the acting user
  let G: string; // a managed committee group at P
  let G2: string; // a second managed committee group at P
  let GCH: string; // a choir at P
  let GDER: string; // P's derived Active Membership group
  let GC1: string; // a committee group at the congregation C1
  let GP2: string; // a committee group at P2
  let A: string; // a person with a membership at P
  let B: string; // a person with a membership at P
  let X: string; // a person with a membership at C1 only
  let slugP: string;
  const congregations: string[] = [];

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  type Conn = "owner" | "app";

  /** Runs `fn` on the chosen connection, in `org`'s context (default P), ALWAYS rolled back. */
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

  async function details(tx: Tx, group: string, org = P): Promise<string> {
    return String(
      (
        await one(
          tx,
          sql`insert into committee_details (organization_id, group_id, kind, created_by, updated_by)
              values (${org}, ${group}, 'standing', ${U}, ${U}) returning id`,
        )
      ).id,
    );
  }

  async function record(tx: Tx, about: string | null, title = "C90 Commission"): Promise<string> {
    return String(
      (
        await one(
          tx,
          sql`insert into commission_records (organization_id, about_org_id, title, appointed_on, created_by, updated_by)
              values (${P}, ${about}, ${title}, current_date - 10, ${U}, ${U}) returning id`,
        )
      ).id,
    );
  }

  async function member(tx: Tx, rec: string, person: string, role = "member"): Promise<string> {
    return String(
      (
        await one(
          tx,
          sql`insert into commission_record_members (organization_id, commission_record_id, person_id, role, starts_on, created_by, updated_by)
              values (${P}, ${rec}, ${person}, ${role}, current_date - 5, ${U}, ${U}) returning id`,
        )
      ).id,
    );
  }

  async function affiliate(subject: string, parent: string) {
    await q(sql`
      insert into organization_affiliations
        (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
      values (${parent}, ${subject}, ${parent}, 'member_congregation', '2000-01-01', 'recorded',
              'Fixture affiliation for committees.db.test.ts')`);
  }

  async function group(org: string, typeKey: string, name: string): Promise<string> {
    const [r] = await q(sql`
      insert into groups (organization_id, group_type_id, name)
      values (${org}, (select id from group_types where key = ${typeKey}), ${name}) returning id`);
    return String(r!.id);
  }

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("cmt90");
    appDb = (await import("@/lib/db")).db as unknown as Db;
    U = fx.actingUserId;
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    P2 = await fx.makeOrg("OtherPresbytery", { organizationType: "presbytery" });
    C1 = await fx.makeOrg("Cong1");
    C2 = await fx.makeOrg("Cong2");
    CX = await fx.makeOrg("CongX");
    congregations.push(C1, C2, CX);
    await affiliate(C1, P);
    await affiliate(C2, P);
    await affiliate(CX, P2);
    G = await group(P, "committee", "C90 Committee on Ministry");
    G2 = await group(P, "committee", "C90 Finance Committee");
    GCH = await group(P, "choir", "C90 Choir");
    GC1 = await group(C1, "committee", "C90 Congregation Committee");
    GP2 = await group(P2, "committee", "C90 Other Presbytery Committee");
    const [d] = await q(sql`select id from groups where organization_id = ${P} and derived_from = 'active_membership'`);
    GDER = String(d!.id);
    A = await fx.makePerson("Avery", "Committeeson");
    await fx.addMember(P, A, { roll: null });
    B = await fx.makePerson("Blair", "Commissioner");
    await fx.addMember(P, B, { roll: null });
    X = await fx.makePerson("Casey", "Congregant");
    await fx.addMember(C1, X);
    const [o] = await q(sql`select slug from organizations where id = ${P}`);
    slugP = String(o!.slug);
  });

  afterAll(async () => {
    if (!fx) return;
    const orgs = [P, P2].filter(Boolean);
    // The teardown order the last describe pins: commission rows first (the
    // about-org FK has no cascade), then the site and the congregations
    // (each delete cascades its own affiliation rows), then cleanup() deletes
    // the presbyteries, whose cascade takes committee_details, groups, seats.
    await q(sql`delete from commission_record_members where organization_id in ${orgs}`);
    await q(sql`delete from commission_records where organization_id in ${orgs}`);
    await q(sql`delete from organization_sites where organization_id in ${orgs}`);
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

    it("CHECK boundaries: kinds, roles, lengths, date floors, pairs and trios", async () => {
      await rolledBack(conn, async (tx) => {
        const d = await details(tx, G);
        const r = await record(tx, null);
        const m = await member(tx, r, A);
        const cases: Array<[SQL, string | null]> = [
          [sql`update committee_details set kind = 'other' where id = ${d}`, "committee_details_kind_check"],
          [sql`update committee_details set kind = null where id = ${d}`, null],
          [sql`update committee_details set dissolved_on = current_date where id = ${d}`, "committee_details_dissolved_trio"],
          [
            sql`update committee_details set dissolved_on = '1899-12-31', dissolved_by = ${U}, dissolved_at = now() where id = ${d}`,
            "committee_details_dissolved_floor",
          ],
          [sql`update commission_records set title = ' ' where id = ${r}`, "commission_records_title_length"],
          [sql`update commission_records set title = repeat('t', 200) where id = ${r}`, null],
          [sql`update commission_records set title = repeat('t', 201) where id = ${r}`, "commission_records_title_length"],
          [sql`update commission_records set charge = repeat('c', 500) where id = ${r}`, null],
          [sql`update commission_records set charge = repeat('c', 501) where id = ${r}`, "commission_records_charge_length"],
          [sql`update commission_records set minute_reference = repeat('m', 200) where id = ${r}`, null],
          [sql`update commission_records set minute_reference = repeat('m', 201) where id = ${r}`, "commission_records_minute_length"],
          [sql`update commission_records set appointed_on = '1899-12-31' where id = ${r}`, "commission_records_appointed_floor"],
          [sql`update commission_records set appointed_on = '1900-01-01' where id = ${r}`, null],
          [sql`update commission_records set ended_minute_reference = 'x' where id = ${r}`, "commission_records_ended_minute_needs_end"],
          [sql`update commission_records set ended_on = current_date where id = ${r}`, "commission_records_ended_trio"],
          [sql`update commission_records set removed_by = ${U} where id = ${r}`, "commission_records_removed_pair"],
          [
            sql`update commission_records set appointed_on = current_date, ended_on = current_date - 1, ended_by = ${U}, ended_at = now() where id = ${r}`,
            "commission_records_ended_after_appointed",
          ],
          [
            sql`update commission_records set ended_on = current_date, ended_by = ${U}, ended_at = now(), ended_minute_reference = repeat('e', 201) where id = ${r}`,
            "commission_records_ended_minute_length",
          ],
          [sql`update commission_record_members set role = 'leader' where id = ${m}`, "commission_record_members_role_check"],
          [sql`update commission_record_members set role = 'ex_officio' where id = ${m}`, null],
          [sql`update commission_record_members set starts_on = '1899-12-31' where id = ${m}`, "commission_record_members_starts_floor"],
          [sql`update commission_record_members set ends_on = starts_on - 1 where id = ${m}`, "commission_record_members_end_after_start"],
          [sql`update commission_record_members set ends_on = starts_on where id = ${m}`, null],
        ];
        for (const [stmt, constraint] of cases) {
          if (constraint) await refused(tx, stmt, "23514", constraint);
          else await tx.execute(stmt);
        }
      });
    });

    it("the details guard: a choir, a derived group and a congregation's committee are refused; one row per committee", async () => {
      await rolledBack(conn, async (tx) => {
        await refused(
          tx,
          sql`insert into committee_details (organization_id, group_id, created_by, updated_by) values (${P}, ${GCH}, ${U}, ${U})`,
          "23514",
          CODES.detailsTarget,
        );
        await refused(
          tx,
          sql`insert into committee_details (organization_id, group_id, created_by, updated_by) values (${P}, ${GDER}, ${U}, ${U})`,
          "23514",
          CODES.detailsTarget,
        );
        await details(tx, G);
        await refused(
          tx,
          sql`insert into committee_details (organization_id, group_id, created_by, updated_by) values (${P}, ${G}, ${U}, ${U})`,
          "23505",
          "committee_details_group_key",
        );
      });
      await rolledBack(
        conn,
        async (tx) => {
          await refused(
            tx,
            sql`insert into committee_details (organization_id, group_id, created_by, updated_by) values (${C1}, ${GC1}, ${U}, ${U})`,
            "23514",
            CODES.detailsTarget,
          );
        },
        C1,
      );
    });

    it("dissolution is one-way: a dissolved row never changes again", async () => {
      await rolledBack(conn, async (tx) => {
        const d = await details(tx, G);
        await tx.execute(sql`update committee_details set dissolved_on = current_date, dissolved_by = ${U}, dissolved_at = now() where id = ${d}`);
        await refused(tx, sql`update committee_details set kind = 'required' where id = ${d}`, "23514", CODES.detailsDissolvedFinal);
        await refused(
          tx,
          sql`update committee_details set dissolved_on = null, dissolved_by = null, dissolved_at = null where id = ${d}`,
          "23514",
          CODES.detailsDissolvedFinal,
        );
      });
    });

    it("a dissolved details insert: refused off the owner path, accepted on it (history)", async () => {
      await rolledBack(conn, async (tx) => {
        const stmt = sql`insert into committee_details (organization_id, group_id, kind, dissolved_on, dissolved_by, dissolved_at, created_at, created_by, updated_by)
                         values (${P}, ${G}, 'ad_hoc', '2025-05-01', ${U}, '2025-05-01 12:00+00', '2025-01-01 12:00+00', ${U}, ${U})`;
        if (conn === "app") {
          await refused(tx, stmt, "23514", CODES.detailsInsertDissolved);
          // ...and a tenant insert's created_at is the server's clock.
          await tx.execute(sql`insert into committee_details (organization_id, group_id, created_at, created_by, updated_by) values (${P}, ${G}, '2000-01-01', ${U}, ${U})`);
          const r = await one(tx, sql`select created_at > now() - interval '1 hour' as fresh from committee_details where group_id = ${G}`);
          expect(r.fresh).toBe(true);
        } else {
          await tx.execute(stmt);
          const r = await one(tx, sql`select created_at::date::text as c, dissolved_on::text as d from committee_details where group_id = ${G}`);
          expect(r).toEqual({ c: "2025-01-01", d: "2025-05-01" });
        }
      });
    });

    it("identity columns: the column grant refuses on presby_app, the guard on the owner path (F44)", async () => {
      await rolledBack(conn, async (tx) => {
        const d = await details(tx, G);
        const r = await record(tx, null);
        const m = await member(tx, r, A);
        const r2 = await record(tx, null, "C90 Another");
        const code = conn === "app" ? "42501" : "23514";
        await refused(tx, sql`update committee_details set group_id = ${G2} where id = ${d}`, code, conn === "app" ? undefined : CODES.detailsImmutable);
        await refused(tx, sql`update committee_details set created_by = ${U}, created_at = now() - interval '1 day' where id = ${d}`, code, conn === "app" ? undefined : CODES.detailsImmutable);
        await refused(tx, sql`update commission_records set created_at = now() - interval '1 day' where id = ${r}`, code, conn === "app" ? undefined : CODES.commissionImmutable);
        await refused(tx, sql`update commission_record_members set person_id = ${B} where id = ${m}`, code, conn === "app" ? undefined : CODES.commissionImmutable);
        await refused(tx, sql`update commission_record_members set commission_record_id = ${r2} where id = ${m}`, code, conn === "app" ? undefined : CODES.commissionImmutable);
      });
    });

    it("commission records: the WHEN admits no congregation; an unaffiliated congregation is refused; end and removal are one-way", async () => {
      await rolledBack(conn, async (tx) => {
        const r0 = await record(tx, null, "C90 About nobody");
        await record(tx, C1, "C90 About Cong1");
        await refused(
          tx,
          sql`insert into commission_records (organization_id, about_org_id, title, appointed_on, created_by, updated_by) values (${P}, ${CX}, 'C90 X', current_date, ${U}, ${U})`,
          "42501",
        );
        await tx.execute(sql`update commission_records set ended_on = current_date, ended_by = ${U}, ended_at = now() where id = ${r0}`);
        await refused(tx, sql`update commission_records set ended_on = current_date + 1 where id = ${r0}`, "23514", CODES.commissionEndedFinal);
        await refused(
          tx,
          sql`update commission_records set ended_on = null, ended_by = null, ended_at = null where id = ${r0}`,
          "23514",
          CODES.commissionEndedFinal,
        );
        await tx.execute(sql`update commission_records set title = 'C90 Ended, renamed', row_version = row_version + 1 where id = ${r0}`);
        await tx.execute(sql`update commission_records set removed_at = now(), removed_by = ${U} where id = ${r0}`);
        await refused(tx, sql`update commission_records set title = 'C90 After' where id = ${r0}`, "23514", CODES.commissionRemovalFinal);
        await refused(tx, sql`update commission_records set removed_at = null, removed_by = null where id = ${r0}`, "23514", CODES.commissionRemovalFinal);
      });
    });

    it("an already-closed record on insert: refused off the owner path, accepted on it (history import)", async () => {
      await rolledBack(conn, async (tx) => {
        const ended = sql`insert into commission_records (organization_id, title, appointed_on, ended_on, ended_by, ended_at, ended_minute_reference, created_by, updated_by)
                          values (${P}, 'C90 Ended', '2025-01-01', '2025-06-30', ${U}, now(), 'C90 minute', ${U}, ${U}) returning id`;
        if (conn === "app") {
          await refused(tx, ended, "23514", CODES.commissionInsertClosed);
          await refused(
            tx,
            sql`insert into commission_records (organization_id, title, appointed_on, removed_at, removed_by, created_by, updated_by) values (${P}, 'C90 Removed', current_date, now(), ${U}, ${U}, ${U})`,
            "23514",
            CODES.commissionInsertClosed,
          );
        } else {
          const r = String((await one(tx, ended)).id);
          // The owner may add a member to an ENDED record (history).
          await member(tx, r, A);
        }
      });
    });

    it("the live guard: no member of a removed record (every connection), nor of an ended one off the owner path", async () => {
      await rolledBack(conn, async (tx) => {
        const r = await record(tx, null);
        await tx.execute(sql`update commission_records set ended_on = current_date, ended_by = ${U}, ended_at = now() where id = ${r}`);
        if (conn === "app") {
          await refused(
            tx,
            sql`insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (${P}, ${r}, ${A}, current_date, ${U}, ${U})`,
            "23514",
            CODES.commissionRecordClosed,
          );
        } else {
          await member(tx, r, A);
        }
        await tx.execute(sql`update commission_records set removed_at = now(), removed_by = ${U} where id = ${r}`);
        await refused(
          tx,
          sql`insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (${P}, ${r}, ${B}, current_date, ${U}, ${U})`,
          "23514",
          CODES.commissionRecordClosed,
        );
      });
    });

    it("one OPEN seat per person per record; an ended earlier seat is history", async () => {
      await rolledBack(conn, async (tx) => {
        const r = await record(tx, null);
        await member(tx, r, A, "chair");
        await refused(
          tx,
          sql`insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (${P}, ${r}, ${A}, current_date, ${U}, ${U})`,
          "23505",
          "commission_record_members_one_open_idx",
        );
        await tx.execute(
          sql`insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, ends_on, created_by, updated_by) values (${P}, ${r}, ${A}, current_date - 100, current_date - 50, ${U}, ${U})`,
        );
      });
    });

    it("composite keys: a member with no membership at the presbytery, and a record that is not this presbytery's, are refused by the FKs", async () => {
      await rolledBack(conn, async (tx) => {
        const r = await record(tx, null);
        await refused(
          tx,
          sql`insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (${P}, ${r}, ${X}, current_date, ${U}, ${U})`,
          "23503",
          "commission_record_members_person_fk",
        );
        await refused(
          tx,
          sql`insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (${P}, gen_random_uuid(), ${A}, current_date, ${U}, ${U})`,
          "23503",
          "commission_record_members_record_fk",
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("the composite FK behind the details guard (owner, guard disabled in a rolled-back transaction)", () => {
    it("details naming another organization's group are refused by committee_details_group_fk itself", async () => {
      await rolledBack("owner", async (tx) => {
        await tx.execute(sql`alter table committee_details disable trigger committee_details_guard`);
        await refused(
          tx,
          sql`insert into committee_details (organization_id, group_id, created_by, updated_by) values (${P}, ${GP2}, ${U}, ${U})`,
          "23503",
          "committee_details_group_fk",
        );
      });
      const [t] = await q(sql`select tgenabled from pg_trigger where tgname = 'committee_details_guard'`);
      expect(t!.tgenabled, "the rollback restored the guard").toBe("O");
    });
  });

  // -------------------------------------------------------------------------
  describe("R9: a congregation that departs", () => {
    it("an edit of a record about it that does not move about_org_id passes; a new record about it is refused", async () => {
      await rolledBack("owner", async (tx) => {
        const r = await record(tx, C2, "C90 About departing");
        await tx.execute(sql`select set_config('presby.affiliation_trigger_active', 'true', true)`);
        await tx.execute(sql`
          update organization_affiliations
             set effective_to = current_date, closed_by_org_id = ${P}, closed_on = current_date,
                 closed_minute_reference = 'Fixture departure for committees.db.test.ts'
           where subject_org_id = ${C2} and effective_to is null`);
        await tx.execute(sql`select set_config('presby.affiliation_trigger_active', '', true)`);
        const [aff] = rowsOf(await tx.execute(sql`select presby_org_affiliated(${C2}, ${P}, current_date) as ok`));
        expect(aff!.ok).toBe(false);
        await tx.execute(sql`update commission_records set charge = 'still ours', row_version = row_version + 1 where id = ${r}`);
        await tx.execute(sql`update commission_records set ended_on = current_date, ended_by = ${U}, ended_at = now() where id = ${r}`);
        await refused(
          tx,
          sql`insert into commission_records (organization_id, about_org_id, title, appointed_on, created_by, updated_by) values (${P}, ${C2}, 'C90 New', current_date, ${U}, ${U})`,
          "42501",
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("FOR SHARE: a member add and a record end serialize (two connections)", () => {
    it("a presby_app add started while the record's end is uncommitted waits, then is refused", async () => {
      const [row] = await q(sql`
        insert into commission_records (organization_id, title, appointed_on, created_by, updated_by)
        values (${P}, ${"C90 Race " + Date.now()}, current_date - 10, ${U}, ${U}) returning id`);
      const r = String(row!.id);

      let release!: () => void;
      const gate = new Promise<void>((res) => (release = res));
      let endLocked!: () => void;
      const locked = new Promise<void>((res) => (endLocked = res));

      const ender = fx.platform.transaction(async (tx) => {
        await tx.execute(sql`update commission_records set ended_on = current_date, ended_by = ${U}, ended_at = now() where id = ${r}`);
        endLocked();
        await gate;
      });
      await locked;

      let settled = false;
      const adder = appDb
        .transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.current_org_id', ${P}, true)`);
          await tx.execute(sql`
            insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by)
            values (${P}, ${r}, ${A}, current_date, ${U}, ${U})`);
        })
        .finally(() => {
          settled = true;
        });
      const outcome = adder.then(
        () => null,
        (e: unknown) => e,
      );
      await new Promise((res) => setTimeout(res, 1500));
      // Read, then ALWAYS release before asserting: a failed assertion that
      // left the end open would hold its row lock past the teardown.
      const settledBeforeCommit = settled;
      release();
      await ender;
      const err = await outcome;
      expect(settledBeforeCommit, "the member add waited on the end's row lock").toBe(false);
      await expectPg(err ? Promise.reject(err) : Promise.resolve(), "23514", CODES.commissionRecordClosed);
      const [n] = await q(sql`select count(*)::int as n from commission_record_members where commission_record_id = ${r}`);
      expect(n!.n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("presby_public_committee_roster at a presbytery with a live site (DECISION-356, F457)", () => {
    it("lists a serving seat and a planned end; not a future start, an ended seat, an ended membership, a death, a dissolved committee, or a commission member; the door follows", async () => {
      const { seedPersonPhoto, setPersonPhotosToggle } = await import("@/lib/testing/person-photo-fixture");
      await rolledBack("owner", async (tx) => {
        await tx.execute(sql`insert into organization_sites (organization_id, repo, status) values (${P}, ${`presby-fixtures/site-${slugP}`}, 'live')`);
        await setPersonPhotosToggle(tx, P, true);
        const d2 = await details(tx, G2);
        const person = async (label: string): Promise<string> => {
          const id = String((await one(tx, sql`insert into people (first_name, last_name) values ('C90', ${label}) returning id`)).id);
          await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${P}, ${id}, 'regular')`);
          return id;
        };
        const seat = async (g: string, p: string, role: string, starts: SQL, ends: SQL, listed = true) =>
          tx.execute(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on, ends_on, public_listed, public_listed_by, public_listed_at)
                         values (${P}, ${g}, ${p}, ${role}, ${starts}, ${ends}, ${listed}, ${listed ? U : null}, ${listed ? sql`now()` : sql`null`})`);
        const serving = await person("Serving");
        const planned = await person("PlannedEnd");
        const future = await person("FutureStart");
        const endedSeat = await person("EndedSeat");
        const endedMember = await person("EndedMember");
        const deceased = await person("Deceased");
        const unlisted = await person("Unlisted");
        const dissolvedMember = await person("DissolvedMember");
        const commissioner = await person("Commissioner");
        await seat(G, serving, "chair", sql`current_date - 10`, sql`null`);
        await seat(G, planned, "vice_chair", sql`current_date - 10`, sql`current_date + 30`);
        await seat(G, future, "clerk", sql`current_date + 5`, sql`null`);
        await seat(G, endedSeat, "secretary", sql`current_date - 30`, sql`current_date`);
        await seat(G, endedMember, "member", sql`current_date - 30`, sql`null`);
        await seat(G, deceased, "ex_officio", sql`current_date - 30`, sql`null`);
        await seat(G, unlisted, "member", sql`current_date - 30`, sql`null`, false);
        await seat(G2, dissolvedMember, "chair", sql`current_date - 30`, sql`null`);
        const rec = await record(tx, C1, "C90 Listed Commission");
        await member(tx, rec, commissioner, "chair");

        const photos: Record<string, string> = {};
        for (const [k, id] of Object.entries({ serving, unlisted, dissolvedMember })) {
          photos[k] = (await seedPersonPhoto(tx, { organizationId: P, personId: id, userId: U, purposes: ["website"] })).imageKey;
        }
        const roster = async () =>
          rowsOf(await tx.execute(sql`select group_name, group_role, display_name, photo_key from presby_public_committee_roster(${slugP})`));
        const door = async (key: string) =>
          rowsOf(await tx.execute(sql`select cache_class from presby_public_site_asset(${P}, ${key})`)).length;

        // Before the membership end, the death and the dissolution.
        expect((await roster()).map((r) => `${r.display_name}/${r.group_role}`).sort()).toEqual(
          ["C90 Deceased/ex_officio", "C90 DissolvedMember/chair", "C90 EndedMember/member", "C90 PlannedEnd/vice_chair", "C90 Serving/chair"].sort(),
        );
        expect(await door(photos.dissolvedMember!)).toBe(1);

        await tx.execute(sql`update memberships set ended_on = current_date - 1 where organization_id = ${P} and person_id = ${endedMember}`);
        await tx.execute(sql`update people set date_of_death = current_date - 1 where id = ${deceased}`);
        await tx.execute(sql`update committee_details set dissolved_on = current_date, dissolved_by = ${U}, dissolved_at = now() where id = ${d2}`);

        const rows = await roster();
        expect(rows.map((r) => `${r.display_name}/${r.group_role}`).sort()).toEqual(["C90 PlannedEnd/vice_chair", "C90 Serving/chair"]);
        expect(Object.keys(rows[0]!).sort()).toEqual(["display_name", "group_name", "group_role", "photo_key"]);
        expect(rows.find((r) => r.display_name === "C90 Serving")!.photo_key).toBe(photos.serving);
        expect(rows.some((r) => r.display_name === "C90 Commissioner")).toBe(false);

        // The asset door narrows with the roster.
        expect(await door(photos.serving!), "a listed member's photo is served (positive control)").toBe(1);
        expect(await door(photos.unlisted!), "an unlisted member's photo is not served").toBe(0);
        expect(await door(photos.dissolvedMember!), "a dissolved committee member's photo is no longer served").toBe(0);

        const [res] = rowsOf(
          await tx.execute(sql`select pg_get_function_result('presby_public_committee_roster(text, text, boolean)'::regprocedure) as r`),
        );
        expect(res!.r).toBe("TABLE(group_name text, group_role text, display_name text, photo_key text)");
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("grants (aclexplode, F38)", () => {
    it("presby_app holds SELECT and INSERT only (no DELETE or TRUNCATE), presby_platform nothing, on all three", async () => {
      const rows = await q(sql`
        select c.relname, a.grantee::regrole::text as g, a.privilege_type as p
          from pg_class c, lateral aclexplode(c.relacl) a
         where c.relname in ${THREE} and c.relkind = 'r'
           and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)`);
      expect(rows.filter((r) => r.g === "presby_platform")).toEqual([]);
      expect(rows.filter((r) => ["DELETE", "TRUNCATE", "UPDATE"].includes(String(r.p)))).toEqual([]);
      expect(rows).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  describe("teardown order (the about-org FK has no cascade)", () => {
    it("a congregation a record is about cannot be deleted; after the commission rows go, the congregations can, and the presbytery's cascade takes its committees", async () => {
      await rolledBack("owner", async (tx) => {
        await details(tx, G);
        await tx.execute(sql`insert into group_memberships (organization_id, group_id, person_id, group_role) values (${P}, ${G}, ${A}, 'chair')`);
        const r = await record(tx, C1, "C90 Teardown");
        await member(tx, r, B);
        await tx.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
        await refused(tx, sql`delete from organizations where id = ${C1}`, "23503");
        // The B4 contract: commission members, records, then the
        // congregations, then the presbytery.
        await tx.execute(sql`delete from commission_record_members where organization_id = ${P}`);
        await tx.execute(sql`delete from commission_records where organization_id = ${P}`);
        await tx.execute(sql`delete from organization_sites where organization_id = ${P}`);
        for (const c of [C1, C2]) await tx.execute(sql`delete from organizations where id = ${c}`);
        await tx.execute(sql`delete from organizations where id = ${P}`);
        const [n] = rowsOf(
          await tx.execute(sql`
            select (select count(*) from committee_details where organization_id = ${P})::int
                 + (select count(*) from groups where organization_id = ${P})::int
                 + (select count(*) from group_memberships where organization_id = ${P})::int as n`),
        );
        expect(n!.n).toBe(0);
      });
    });
  });
});
