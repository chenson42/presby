/**
 * drizzle/0068_presby_parishes.sql, proven against a real database
 * (docs/work-log/2026-10-25-parish-management.md, Phase 3 "Edge Cases & Risks"
 * tag DB, Phase 4 Batch A; DECISION-242, DECISION-243; F258, F259, F260).
 *
 * The presby_app half (vocabulary, the target guard, every seat-guard arm, the
 * resolver's date boundary, isolation) is scripts/parishes/test-rls-68.sql.
 * This file proves what that suite cannot reach:
 *   - the OWNER path (`getPlatformDb()` is neondb_owner, which no grant binds,
 *     F44): the delete guard refuses, the fixture-teardown cascade still
 *     passes, and the target and seat guards fire there too;
 *   - the archive race, with two real connections: FOR SHARE is what makes a
 *     move wait for a concurrent archive and then see it (DECISION-243);
 *   - the migration's own sections replayed in rolled-back transactions: the
 *     whole file re-applies with no row change, the backfill's shape and skip
 *     rule, that no existing row gains authority, and every stop-block;
 *   - that the named constraints and refusal literals surface through the
 *     neon driver on the presby_app connection, which is what
 *     src/lib/parishes.ts maps (target_unavailable, not_found, name_taken).
 *
 * Fixtures: synthetic names, `example.invalid` (No Real Data); organizations
 * and people stamped `deletable_until` at insert. Teardown deletes the stamped
 * organizations, whose cascade removes their districts (the delete guard lets
 * exactly that through), households, memberships, terms, groups and roles;
 * group_memberships_reject_derived is disabled around it as every DB suite
 * does.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/parishes.db.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import { rowsOf, type Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

// `@/lib/audit` transitively imports `@/auth` (next-auth), which this test
// environment cannot resolve. Only the NFC companion (QA run 1, Finding 2)
// imports src/lib/parishes.ts; the keys are restated as in parishes.test.ts
// and pinned to audit.ts by audit.test.ts. The audit row itself is the real
// insertAuditRow in the define transaction.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled",
    DISTRICT_CREATED: "tenant.district.created",
    DISTRICT_RENAMED: "tenant.district.renamed",
    DISTRICT_ARCHIVED: "tenant.district.archived",
    DISTRICT_RESTORED: "tenant.district.restored",
    HOUSEHOLD_DISTRICT_CHANGED: "tenant.household.district_changed",
    HOUSEHOLD_DISTRICT_BULK_MOVED: "tenant.household.district_bulk_moved",
  },
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

// Found by name, not number: the orchestrator may renumber at integration.
const M68_FILE = readdirSync(path.join(process.cwd(), "drizzle")).filter((f) =>
  /^\d{4}_presby_parishes\.sql$/.test(f),
);
if (M68_FILE.length !== 1) throw new Error(`expected one *_presby_parishes.sql, found ${M68_FILE.length}`);
const M68 = path.join(process.cwd(), "drizzle", M68_FILE[0]!);
const M68_TEXT = readFileSync(M68, "utf8");

type Db = ReturnType<typeof import("@/lib/db").getPlatformDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class Rollback extends Error {}

function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 6) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}
function pgCode(err: unknown): string | undefined {
  for (const e of chain(err)) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}
function pgField(err: unknown, field: string): string | undefined {
  for (const e of chain(err)) {
    const v = (e as Record<string, unknown>)[field];
    if (typeof v === "string") return v;
  }
  return undefined;
}
function pgMessage(err: unknown): string | undefined {
  const withCode = chain(err).filter((e) => typeof (e as { code?: unknown }).code === "string");
  const last = withCode[withCode.length - 1];
  return last instanceof Error ? last.message : undefined;
}

/** The text of one numbered section of 0068 (`-- N. title` to the next). */
function section(n: number): string {
  const start = M68_TEXT.search(new RegExp(`^-- ${n}\\. `, "m"));
  const end = M68_TEXT.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0 || end < 0) throw new Error(`section ${n} not found in 0068`);
  return M68_TEXT.slice(start, end);
}

/** A SQL text with every `create or replace function ... end $$;` body removed. */
function withoutFunctionBodies(text: string): string {
  return text.replace(/create or replace function[\s\S]*?end \$\$;/g, "");
}

/** The code of a SQL text with whole-line comments removed. */
function code(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

describe.skipIf(!hasDb)("drizzle/0068 parishes (Postgres-backed)", () => {
  let platform: Db;
  let appDb: typeof import("@/lib/db").db;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let counter = 0;
  const orgIds: string[] = [];
  const personIds: string[] = [];
  const userIds: string[] = [];

  let rosterTypeId: string;
  let courtTypeId: string;

  let orgA: string; // a congregation, provisioned as createOrganization() will
  let orgP: string; // a presbytery: no Board of Deacons, no seat
  let seatRoleA: string;
  let personA: string; // an active member at orgA

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await platform.execute(query));
  }

  async function makeOrg(type: "congregation" | "presbytery", tag: string): Promise<string> {
    counter += 1;
    const slug = `par-${tag}-${stamp}-${counter}`;
    const [row] = await q(sql`
      insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
      values (${type}::organization_type, ${`Fixture ${tag} for parishes`}, ${slug},
              ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
      returning id`);
    const id = String(row!.id);
    orgIds.push(id);
    await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${id}, ${rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
    return id;
  }

  /** The groupSeedPlan()/baselineRoleSeedPlan() seat shape (0068 sections 8c and 9). */
  async function provisionSeat(org: string): Promise<string> {
    await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${org}, ${courtTypeId}, 'Board of Deacons', 'derived', 'diaconate', true),
             (${org}, ${rosterTypeId}, 'Board of Deacons Moderator', 'derived', 'deacons_moderator', true)`);
    const [role] = await q(sql`
      insert into app_roles (organization_id, key, name, role_kind, is_protected)
      values (${org}, 'deacons_moderator', 'Moderator of the Board of Deacons', 'constitutional', true)
      returning id`);
    await q(sql`insert into app_role_permissions (role_id, permission_key) values (${role!.id}, 'parishes.assign')`);
    await q(sql`
      insert into role_grants (organization_id, role_id, group_id, starts_on)
      select ${org}, ${role!.id}, g.id, '2000-01-01' from groups g
       where g.organization_id = ${org} and g.derived_from = 'deacons_moderator'`);
    return String(role!.id);
  }

  async function makePerson(first: string): Promise<string> {
    counter += 1;
    const [row] = await q(sql`
      insert into people (first_name, last_name, deletable_until)
      values (${first}, ${`Parrow${stamp}${counter}`}, ${fixtureDeletableUntil()})
      returning id`);
    personIds.push(String(row!.id));
    return String(row!.id);
  }

  async function member(org: string, first = "Member"): Promise<string> {
    const person = await makePerson(first);
    await q(sql`
      insert into memberships (organization_id, person_id, engagement_status)
      values (${org}, ${person}, 'regular')`);
    return person;
  }

  async function district(org: string, name: string, opts: { type?: string; archived?: boolean } = {}) {
    const [row] = await q(sql`
      insert into org_units (organization_id, unit_type, name)
      values (${org}, ${opts.type ?? "district"}, ${name}) returning id`);
    const id = String(row!.id);
    if (opts.archived) await q(sql`update org_units set archived_at = now() where id = ${id}`);
    return id;
  }

  async function household(org: string, name: string, unit: string | null = null): Promise<string> {
    const [row] = await q(sql`
      insert into households (organization_id, name, org_unit_id)
      values (${org}, ${name}, ${unit}::uuid) returning id`);
    return String(row!.id);
  }

  async function asApp<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  }

  async function inRolledBackOwnerTx(fn: (tx: Tx) => Promise<void>) {
    try {
      await platform.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** Runs `query` in a savepoint and returns its error (the outer tx stays usable). */
  async function rejected(tx: Tx, query: SQL) {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(query);
      });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error("expected the statement to be rejected");
    return { code: pgCode(caught), message: pgMessage(caught), constraint: pgField(caught, "constraint") };
  }

  /** Awaits a promise and returns its rejection (or null). */
  async function settle(p: Promise<unknown>): Promise<unknown> {
    try {
      await p;
      return null;
    } catch (err) {
      return err;
    }
  }

  /** Polls until some backend is waiting on a lock while running `fragment`. */
  async function sawLockWait(fragment: string, timeoutMs = 15_000): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const [row] = await q(sql`
        select count(*)::int as n from pg_stat_activity
         where wait_event_type = 'Lock' and query ilike ${`%${fragment}%`}`);
      if (Number(row!.n) > 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function snapshot(tx: Tx): Promise<Row> {
    const [row] = rowsOf(await tx.execute(sql`
      select (select count(*)::int from groups) as groups,
             (select count(*)::int from app_roles) as roles,
             (select count(*)::int from app_role_permissions) as role_permissions,
             (select count(*)::int from role_grants) as grants,
             (select count(*)::int from permissions) as permissions,
             (select count(*)::int from group_memberships) as group_memberships,
             (select count(*)::int from officer_terms) as officer_terms,
             (select count(*)::int from org_units) as org_units,
             (select count(*)::int from org_units where archived_at is not null) as archived,
             (select count(*)::int from households) as households,
             (select count(*)::int from households where org_unit_id is not null) as assigned`));
    return row!;
  }

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    platform = dbModule.getPlatformDb();
    appDb = dbModule.db;

    await q(sql`insert into group_types (key, name) values ('roster', 'Roster'), ('court', 'Court') on conflict do nothing`);
    const types = await q(sql`select id, key from group_types where key in ('roster', 'court')`);
    rosterTypeId = String(types.find((t) => t.key === "roster")!.id);
    courtTypeId = String(types.find((t) => t.key === "court")!.id);

    orgA = await makeOrg("congregation", "a");
    seatRoleA = await provisionSeat(orgA);
    orgP = await makeOrg("presbytery", "p");
    personA = await member(orgA, "Alma");
  });

  afterAll(async () => {
    if (!platform) return;
    await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      for (const id of orgIds) {
        await platform.execute(sql`delete from organizations where id = ${id}`);
      }
    } finally {
      await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    for (const id of personIds) {
      await platform.execute(sql`delete from people where id = ${id}`);
    }
    for (const id of userIds) {
      await platform.execute(sql`delete from audit_events where actor_user_id = ${id}`);
      await platform.execute(sql`delete from users where id = ${id}`);
    }
  });

  describe("the owner path (neondb_owner: no grant binds it, triggers do; F44)", () => {
    it("R2: an owner DELETE of a district is refused while its organization exists", async () => {
      const unit = await district(orgA, `Permanent ${stamp}`);
      let caught: unknown;
      try {
        await q(sql`delete from org_units where id = ${unit}`);
      } catch (err) {
        caught = err;
      }
      expect(pgCode(caught)).toBe("42501");
      expect(pgField(caught, "constraint")).toBe("org_units_permanent");
      expect(pgMessage(caught)).toBe("org_units: districts are permanent; archive them instead");
      const [row] = await q(sql`select count(*)::int as n from org_units where id = ${unit}`);
      expect(row!.n).toBe(1);
    });

    it("the fixture-teardown cascade still removes districts with their households and deacon terms", async () => {
      const org = await makeOrg("congregation", "cascade");
      await provisionSeat(org);
      const unit = await district(org, "Cascade District");
      const archivedUnit = await district(org, "Cascade Archived", { archived: true });
      await household(org, "Cascade Household", unit);
      const deacon = await member(org, "Cascadia");
      await q(sql`
        insert into officer_terms (organization_id, person_id, office, org_unit_id, starts_on)
        values (${org}, ${deacon}, 'deacon', ${unit}, '2024-01-01')`);
      await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
      try {
        await q(sql`delete from organizations where id = ${org}`);
      } finally {
        await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
      }
      const [row] = await q(sql`
        select (select count(*)::int from org_units where id in (${unit}, ${archivedUnit})) as units,
               (select count(*)::int from households where organization_id = ${org}) as households`);
      expect(row).toEqual({ units: 0, households: 0 });
    });

    it("the target guard fires on the owner connection too", async () => {
      const unit = await district(orgA, `Owner Archived ${stamp}`, { archived: true });
      const hh = await household(orgA, "Owner Path Household");
      await inRolledBackOwnerTx(async (tx) => {
        const r = await rejected(tx, sql`update households set org_unit_id = ${unit} where id = ${hh}`);
        expect(r).toMatchObject({ code: "23514", constraint: "org_unit_target_archived" });
      });
    });

    it("a seat guard fires on the owner connection too: the seat role cannot be granted to a person", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const r = await rejected(tx, sql`
          insert into role_grants (organization_id, role_id, person_id, starts_on)
          values (${orgA}, ${seatRoleA}, ${personA}, current_date)`);
        expect(r).toMatchObject({ code: "42501", constraint: "seat_key_grant" });
      });
    });
  });

  describe("the archive race, two connections (DECISION-243: FOR SHARE, not the FK's FOR KEY SHARE)", () => {
    it("archive first: a concurrent move waits for the archive's row lock, then sees it and is refused", async () => {
      const unit = await district(orgA, `Race One ${stamp}`);
      const hh = await household(orgA, "Race One Household");

      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let archivedSignal!: () => void;
      const archivedReady = new Promise<void>((r) => (archivedSignal = r));

      const archive = asApp(orgA, async (tx) => {
        await tx.execute(sql`update org_units set archived_at = now() where id = ${unit}`);
        archivedSignal();
        await held;
      });
      await archivedReady;
      const move = settle(
        asApp(orgA, (tx) => tx.execute(sql`update households set org_unit_id = ${unit} where id = ${hh}`)),
      );
      const waited = await sawLockWait("update households set org_unit_id");
      release();
      await archive;
      const err = await move;

      expect(waited, "the move never waited on the archive's row lock").toBe(true);
      expect(pgCode(err)).toBe("23514");
      expect(pgField(err, "constraint")).toBe("org_unit_target_archived");
      const [row] = await q(sql`select org_unit_id from households where id = ${hh}`);
      expect(row!.org_unit_id).toBeNull();
    });

    it("move first: the archive waits for the move to commit, then both stand (an archive may hold households)", async () => {
      const unit = await district(orgA, `Race Two ${stamp}`);
      const hh = await household(orgA, "Race Two Household");

      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let movedSignal!: () => void;
      const movedReady = new Promise<void>((r) => (movedSignal = r));

      const move = asApp(orgA, async (tx) => {
        await tx.execute(sql`update households set org_unit_id = ${unit} where id = ${hh}`);
        movedSignal();
        await held;
      });
      await movedReady;
      const archive = settle(
        asApp(orgA, (tx) => tx.execute(sql`update org_units set archived_at = now() where id = ${unit}`)),
      );
      const waited = await sawLockWait("update org_units set archived_at");
      release();
      await move;
      expect(await archive).toBeNull();

      expect(waited, "the archive never waited on the move's FOR SHARE lock").toBe(true);
      const [row] = await q(sql`
        select h.org_unit_id, (u.archived_at is not null) as archived
          from households h join org_units u on u.id = h.org_unit_id where h.id = ${hh}`);
      expect(row).toEqual({ org_unit_id: unit, archived: true });
    });
  });

  describe("the migration replayed (rolled back)", () => {
    it("the whole file re-applies with no row change (idempotent)", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const before = await snapshot(tx);
        await tx.execute(sql.raw(M68_TEXT));
        expect(await snapshot(tx)).toEqual(before);
      });
    });

    it("re-applies even after an archived district shares its name with an active one (section 1 counts active rows only)", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`
          insert into org_units (organization_id, unit_type, name, archived_at)
          values (${orgA}, 'district', ${`Twin ${stamp}`}, now())`);
        await tx.execute(sql`
          insert into org_units (organization_id, unit_type, name)
          values (${orgA}, 'district', ${`twin ${stamp}`})`);
        await tx.execute(sql.raw(section(1)));
      });
    });

    it("sections 8 and 9 provision an unprovisioned congregation exactly once, and give a presbytery nothing", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        counter += 1;
        const slug = `par-bf-${stamp}-${counter}`;
        const [org] = rowsOf(await tx.execute(sql`
          insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
          values ('congregation', 'Fixture backfill for parishes', ${slug}, ${slug.replace(/-/g, "_")},
                  'managed', ${fixtureDeletableUntil()}) returning id`));
        const id = String(org!.id);

        const shape = async (o: string) => rowsOf(await tx.execute(sql`
          select g.name as group_name, g.membership_source, g.is_protected as group_protected, gt.key as group_type,
                 r.name as role_name, r.role_kind, r.is_protected as role_protected,
                 (select array_agg(rp.permission_key order by rp.permission_key)
                    from app_role_permissions rp where rp.role_id = r.id) as permissions,
                 (select count(*)::int from role_grants rg where rg.role_id = r.id) as grants,
                 (select count(*)::int from role_grants rg
                   where rg.role_id = r.id and rg.group_id = g.id and rg.person_id is null
                     and rg.starts_on = current_date and rg.granted_by is null) as seat_group_grants
            from groups g
            join group_types gt on gt.id = g.group_type_id
            left join app_roles r on r.organization_id = g.organization_id and r.key = 'deacons_moderator'
           where g.organization_id = ${o} and g.derived_from = 'deacons_moderator'`));

        expect(await shape(id)).toEqual([]);
        await tx.execute(sql.raw(section(8)));
        await tx.execute(sql.raw(section(9)));
        const once = await shape(id);
        expect(once).toEqual([{
          group_name: "Board of Deacons Moderator", membership_source: "derived", group_protected: true,
          group_type: "roster", role_name: "Moderator of the Board of Deacons", role_kind: "constitutional",
          role_protected: true, permissions: ["parishes.assign"], grants: 1, seat_group_grants: 1,
        }]);

        await tx.execute(sql.raw(section(8)));
        await tx.execute(sql.raw(section(9)));
        expect(await shape(id)).toEqual(once);
        expect(await shape(orgP)).toEqual([]);
      });
    });

    it("an org-owned deacons_moderator role a congregation already holds is never modified (0052 note 5)", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        counter += 1;
        const slug = `par-skip-${stamp}-${counter}`;
        const [org] = rowsOf(await tx.execute(sql`
          insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
          values ('congregation', 'Fixture skip for parishes', ${slug}, ${slug.replace(/-/g, "_")},
                  'managed', ${fixtureDeletableUntil()}) returning id`));
        const id = String(org!.id);
        const [role] = rowsOf(await tx.execute(sql`
          insert into app_roles (organization_id, key, name, role_kind)
          values (${id}, 'deacons_moderator', 'Their own role', 'custom') returning id`));
        await tx.execute(sql`insert into app_role_permissions (role_id, permission_key) values (${role!.id}, 'directory.view')`);

        await tx.execute(sql.raw(section(8)));
        await tx.execute(sql.raw(section(9)));

        const rows = rowsOf(await tx.execute(sql`
          select r.id, r.name, r.role_kind,
                 (select array_agg(rp.permission_key) from app_role_permissions rp where rp.role_id = r.id) as permissions,
                 (select count(*)::int from role_grants rg where rg.role_id = r.id) as grants
            from app_roles r where r.organization_id = ${id}`));
        expect(rows).toEqual([{ id: role!.id, name: "Their own role", role_kind: "custom", permissions: ["directory.view"], grants: 0 }]);
      });
    });

    it("no existing row gains authority: sections 8-9 touch no officer term or group membership, and a moderator holds nothing new", async () => {
      // Statements the migration itself runs (a trigger function's body runs
      // only when a term is later recorded, so it is excluded).
      for (const n of [8, 9]) {
        const statements = withoutFunctionBodies(code(section(n)));
        expect(statements).not.toMatch(/\bupdate\s+officer_terms\b/i);
        expect(statements).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+group_memberships\b/i);
      }
      expect(withoutFunctionBodies(code(section(8)))).not.toMatch(/create or replace function/);
      const moderator = await member(orgA, "Modesta");
      await q(sql`insert into officer_terms (organization_id, person_id, office, starts_on) values (${orgA}, ${moderator}, 'moderator', '2024-01-01')`);
      await inRolledBackOwnerTx(async (tx) => {
        const before = await snapshot(tx);
        await tx.execute(sql.raw(section(8)));
        await tx.execute(sql.raw(section(9)));
        const after = await snapshot(tx);
        expect(after.group_memberships).toBe(before.group_memberships);
        expect(after.officer_terms).toBe(before.officer_terms);
      });
      const held = await asApp(orgA, async (tx) => rowsOf(await tx.execute(sql`
        select presby_has_permission(${moderator}, ${orgA}, 'parishes.assign', current_date) as held`)));
      expect(held[0]!.held).toBe(false);
    });

    it("neither the migration nor a backfill deletes or truncates anything", () => {
      expect(code(M68_TEXT)).not.toMatch(/\bdelete\s+from\b/i);
      expect(code(M68_TEXT)).not.toMatch(/\btruncate\b/i);
    });

    describe("section 1 stop-blocks (each raises with a count, never a name)", () => {
      const cases: { name: string; setup: (tx: Tx) => Promise<void>; message: RegExp; code: string }[] = [
        {
          name: "unit_type outside the vocabulary",
          setup: async (tx) => {
            await tx.execute(sql`alter table org_units drop constraint org_units_unit_type_check`);
            await tx.execute(sql`insert into org_units (organization_id, unit_type, name) values (${orgA}, 'region', ${`Region ${stamp}`})`);
          },
          message: /^0068: 1 org_units row\(s\) carry a unit_type outside/,
          code: "23514",
        },
        {
          name: "a mis-shaped name",
          setup: async (tx) => {
            await tx.execute(sql`alter table org_units drop constraint org_units_name_shape`);
            await tx.execute(sql`insert into org_units (organization_id, unit_type, name) values (${orgA}, 'district', ${` Padded ${stamp}`})`);
          },
          message: /^0068: 1 org_units name\(s\) are untrimmed/,
          code: "23514",
        },
        {
          name: "two active names differing only in case",
          setup: async (tx) => {
            await tx.execute(sql`drop index org_units_active_name_idx`);
            await tx.execute(sql`insert into org_units (organization_id, unit_type, name) values (${orgA}, 'district', ${`Dup ${stamp}`}), (${orgA}, 'district', ${`DUP ${stamp}`})`);
          },
          message: /^0068: 1 organization\(s\) have two org_units whose names differ only in case/,
          code: "23514",
        },
        {
          name: "a household at a campus",
          setup: async (tx) => {
            await tx.execute(sql`alter table households disable trigger households_org_unit_target_guard`);
            const [u] = rowsOf(await tx.execute(sql`insert into org_units (organization_id, unit_type, name) values (${orgA}, 'campus', ${`Campus ${stamp}`}) returning id`));
            await tx.execute(sql`insert into households (organization_id, name, org_unit_id) values (${orgA}, 'Campus Household', ${u!.id})`);
          },
          message: /^0068: 1 household\(s\) point at a campus/,
          code: "23514",
        },
        {
          name: "an open deacon term at a campus",
          setup: async (tx) => {
            await tx.execute(sql`alter table officer_terms disable trigger officer_terms_org_unit_target_guard`);
            const [u] = rowsOf(await tx.execute(sql`insert into org_units (organization_id, unit_type, name) values (${orgA}, 'campus', ${`Campus T ${stamp}`}) returning id`));
            await tx.execute(sql`insert into officer_terms (organization_id, person_id, office, org_unit_id, starts_on) values (${orgA}, ${personA}, 'deacon', ${u!.id}, '2024-01-01')`);
          },
          message: /^0068: 1 open deacon term\(s\) point at a campus/,
          code: "23514",
        },
        {
          name: "the roster group type missing",
          setup: async (tx) => {
            await tx.execute(sql`update group_types set key = ${`roster_moved_${stamp}`} where key = 'roster'`);
          },
          message: /^0068: the global group type 'roster' is missing/,
          code: "23503",
        },
      ];

      for (const c of cases) {
        it(`stops on ${c.name}`, async () => {
          await inRolledBackOwnerTx(async (tx) => {
            await c.setup(tx);
            const r = await rejected(tx, sql.raw(section(1)));
            expect(r.code).toBe(c.code);
            expect(r.message).toMatch(c.message);
          });
        });
      }

      it("passes on the live branch as it stands (positive control)", async () => {
        await inRolledBackOwnerTx(async (tx) => {
          await tx.execute(sql.raw(section(1)));
        });
      });
    });
  });

  describe("the seat term materialises into the seat group (0068 section 8a)", () => {
    it("records into the derived deacons_moderator group with the term's dates, and ending it ends the membership", async () => {
      const holder = await member(orgA, "Seatholder");
      const [t] = await q(sql`
        insert into officer_terms (organization_id, person_id, office, starts_on)
        values (${orgA}, ${holder}, 'deacons_moderator', '2026-09-01') returning id`);
      const read = async () => q(sql`
        select g.derived_from, gm.starts_on::text as starts_on, gm.ends_on::text as ends_on, gm.group_role
          from group_memberships gm join groups g on g.id = gm.group_id where gm.officer_term_id = ${t!.id}`);
      expect(await read()).toEqual([{ derived_from: "deacons_moderator", starts_on: "2026-09-01", ends_on: null, group_role: "member" }]);
      await q(sql`update officer_terms set ends_on = '2026-12-31', end_reason = 'completed' where id = ${t!.id}`);
      expect(await read()).toEqual([{ derived_from: "deacons_moderator", starts_on: "2026-09-01", ends_on: "2026-12-31", group_role: "member" }]);
    });

    it("at a presbytery (no seat group) the term is refused by the sync trigger's missing-group error", async () => {
      const p = await member(orgP, "Presbyter");
      await inRolledBackOwnerTx(async (tx) => {
        const r = await rejected(tx, sql`
          insert into officer_terms (organization_id, person_id, office, starts_on)
          values (${orgP}, ${p}, 'deacons_moderator', '2026-09-01')`);
        expect(r.code).toBe("23503");
        expect(r.message).toBe(`organization ${orgP} has no derived group deacons_moderator; seed derived groups at org creation`);
      });
    });
  });

  describe("what src/lib/parishes.ts maps: codes, constraint names and literals through the driver, as presby_app", () => {
    async function appRefusal(query: SQL) {
      return asApp(orgA, (tx) => rejected(tx, query));
    }

    it("archived, campus and missing targets", async () => {
      const archivedUnit = await district(orgA, `Map Archived ${stamp}`, { archived: true });
      const campus = await district(orgA, `Map Campus ${stamp}`, { type: "campus" });
      const hh = await household(orgA, "Map Household");
      expect(await appRefusal(sql`update households set org_unit_id = ${archivedUnit} where id = ${hh}`)).toEqual({
        code: "23514", constraint: "org_unit_target_archived",
        message: "households: that district is archived; nothing can be moved into it",
      });
      expect(await appRefusal(sql`update households set org_unit_id = ${campus} where id = ${hh}`)).toEqual({
        code: "23514", constraint: "org_unit_target_campus",
        message: "households: a campus is not a deacon district",
      });
      expect(await appRefusal(sql`update households set org_unit_id = gen_random_uuid() where id = ${hh}`)).toEqual({
        code: "23503", constraint: "org_unit_target_missing",
        message: "households: that district does not exist at this organization",
      });
    });

    it("a restore into a taken active name is a unique_violation on org_units_active_name_idx", async () => {
      const name = `Map Twin ${stamp}`;
      const old = await district(orgA, name, { archived: true });
      await district(orgA, name.toUpperCase());
      const r = await appRefusal(sql`update org_units set archived_at = null where id = ${old}`);
      expect(r.code).toBe("23505");
      expect(r.constraint).toBe("org_units_active_name_idx");
    });

    it("the seat guards' designed refusals, never 'permission denied for function'", async () => {
      const r = await appRefusal(sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on)
        values (${orgA}, ${seatRoleA}, ${personA}, current_date)`);
      expect(r).toEqual({
        code: "42501", constraint: "seat_key_grant",
        message: "role_grants: this role is held through a recorded seat and can be granted only to that seat's group (DECISION-242)",
      });
      const custom = await asApp(orgA, async (tx) => rowsOf(await tx.execute(sql`
        insert into app_roles (organization_id, key, name, role_kind)
        values (${orgA}, ${`par_custom_${stamp}`}, 'Parish custom', 'custom') returning id`)));
      const b = await appRefusal(sql`
        insert into app_role_permissions (role_id, permission_key) values (${custom[0]!.id}, 'parishes.assign')`);
      expect(b).toEqual({
        code: "42501", constraint: "seat_key_binding",
        message: "app_role_permissions: parishes.assign is held only through a recorded seat and cannot be added to this role (DECISION-242)",
      });
    });

    it("DELETE on org_units is a plain permission refusal for presby_app (R2)", async () => {
      const unit = await district(orgA, `Map Delete ${stamp}`);
      const r = await appRefusal(sql`delete from org_units where id = ${unit}`);
      expect(r.code).toBe("42501");
      expect(r.message).toBe("permission denied for table org_units");
    });
  });

  // Phase 3 amendment 1, ruling 1.3 (QA run 1, Finding 1). 0066 (Community 3a,
  // DECISION-236) makes this function SECURITY DEFINER because its owner-only
  // derived-row guard refuses any non-owner derived write. `create or replace`
  // resets every attribute, so if 0068 re-created it as invoker, a fresh
  // database applying 0066 then 0068 would refuse every officer term that
  // materialises a roster row. 0068 must therefore be correct in either order.
  describe("presby_sync_derived_group() stays a pinned SECURITY DEFINER (amendment 1.3)", () => {
    it("the catalog: prosecdef, search_path pinned, owned by neondb_owner, no EXECUTE for either application role", async () => {
      const rows = await q(sql`
        select p.prosecdef,
               p.proconfig,
               pg_get_userbyid(p.proowner) as owner,
               has_function_privilege('presby_app', p.oid, 'EXECUTE') as app_execute,
               has_function_privilege('presby_platform', p.oid, 'EXECUTE') as platform_execute
          from pg_proc p
         where p.proname = 'presby_sync_derived_group' and p.pronamespace = 'public'::regnamespace`);
      expect(rows).toEqual([{
        prosecdef: true,
        proconfig: ["search_path=public, pg_temp"],
        owner: "neondb_owner",
        app_execute: false,
        platform_execute: false,
      }]);
    });

    it("the source: 0068's definition header carries `security definer` and the pinned search_path, and the file revokes EXECUTE", () => {
      const src = code(M68_TEXT);
      const lead = "create or replace function presby_sync_derived_group()";
      const start = src.indexOf(lead);
      expect(start, "0068 no longer re-creates presby_sync_derived_group()").toBeGreaterThanOrEqual(0);
      const header = src.slice(start, src.indexOf("as $$", start));
      expect(header).toMatch(/\bsecurity\s+definer\b/i);
      expect(header).toMatch(/\bset\s+search_path\s*=\s*public,\s*pg_temp\b/i);
      expect(src).toMatch(
        /revoke\s+all\s+on\s+function\s+presby_sync_derived_group\(\)\s+from\s+public,\s*presby_app,\s*presby_platform\s*;/i,
      );
    });

    it("a presby_app officer-term insert still materialises the seat row through the definer (no EXECUTE needed to fire a trigger)", async () => {
      const holder = await member(orgA, "Definerseat");
      const rows = await asApp(orgA, async (tx) => {
        const [t] = rowsOf(await tx.execute(sql`
          insert into officer_terms (organization_id, person_id, office, starts_on)
          values (${orgA}, ${holder}, 'deacons_moderator', '2026-09-01') returning id`));
        return rowsOf(await tx.execute(sql`
          select g.derived_from, gm.source from group_memberships gm
            join groups g on g.id = gm.group_id where gm.officer_term_id = ${t!.id}`));
      });
      expect(rows).toEqual([{ derived_from: "deacons_moderator", source: "derived" }]);
    });
  });

  // Phase 3 amendment 1, Finding 2's database companion: the normaliser is the
  // single guard in front of org_units_name_shape (`name is nfc normalized`).
  // Stripping a zero-width character that separated a base letter from a
  // combining mark must leave NFC text, or the CHECK refuses the insert with a
  // 23514 that src/lib/parishes.ts deliberately does not map.
  describe("a district name is stored NFC after stripping (QA run 1, Finding 2)", () => {
    it("defineDistrict as presby_app accepts 'Cafe<ZWSP><combining acute> District' and stores 'Café District'", async () => {
      const P = await import("@/lib/parishes");
      const org = await makeOrg("congregation", "nfc");
      await q(sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled)
        values (${org}, 'org_portal.parishes', true)
        on conflict (organization_id, feature_key) do update set enabled = true`);
      await q(sql`
        insert into permissions (key, module, description, sensitivity_tier)
        values ('officers.manage', 'officers', 'officers.manage (fixture)', 1) on conflict do nothing`);
      const definer = await member(org, "Definer");
      const [role] = await q(sql`
        insert into app_roles (organization_id, key, name, role_kind, is_protected)
        values (${org}, ${`par_nfc_${stamp}`}, 'Fixture district definer', 'custom', false) returning id`);
      await q(sql`insert into app_role_permissions (role_id, permission_key) values (${role!.id}, 'officers.manage')`);
      await q(sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on)
        values (${org}, ${role!.id}, ${definer}, '2020-01-01')`);
      const [user] = await q(sql`
        insert into users (email, name)
        values (${`parishes-db-nfc-${stamp}@example.invalid`}, 'Parishes DB NFC Actor') returning id`);
      userIds.push(String(user!.id));

      const raw = "Cafe​́ District";
      const result = await P.defineDistrict(definer, org, { userId: String(user!.id), email: null }, { name: raw });

      expect(result).toMatchObject({ kind: "ok", name: "Café District" });
      const stored = await q(sql`
        select name, name is nfc normalized as nfc from org_units
         where organization_id = ${org} and unit_type = 'district'`);
      expect(stored).toEqual([{ name: "Café District", nfc: true }]);
    });
  });
});
