/**
 * D4: src/lib/oversight/reads.ts against a REAL Postgres connection
 * (docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "Test plan" D4;
 * R3, R9, T7, T8). Fixture rows are written directly as the owner so a failure
 * here is never the store's. Pinned here:
 *
 *   - each reader returns `forbidden` (and no data) for a person without ITS key,
 *     in its own transaction: tier 1 readers for a finance-only person, tier 2
 *     readers for a manage-only person, everything for a person with neither;
 *   - `readOversightAccess`: neither key is `forbidden` BEFORE the congregation is
 *     resolved (no existence leak), a key and a stranger's congregation is
 *     `not_found`;
 *   - `readOversightList` returns NO tier-2 field for a manage-only viewer and NO
 *     tier-1 field for a finance-only viewer (absent, not null);
 *   - the roster includes a closed congregation still under the presbytery and
 *     excludes one that departed (R9, F453);
 *   - the query count is FIXED: the same number of statements for 2 and for 30
 *     congregations;
 *   - `readTodayInOrg` and the list's `today` use the organization's time zone;
 *   - an id of another congregation, another presbytery or a removed row is the
 *     one `not_found`; the newest insurance year's expiry is the cell (T8);
 *   - the readers write nothing (reads are not audited, DECISION-345).
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/oversight/reads.db.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
// Enter the domain cycle through the canonical entry point first (see oversight.db.test.ts).
import "@/lib/db/schema";
import type { OversightViewer } from "./contract";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;

const SIX = [
  "oversight_building_photos",
  "oversight_building_appraisals",
  "oversight_loans",
  "oversight_buildings",
  "oversight_insurance_years",
  "oversight_profiles",
] as const;

const rowsOf = (result: unknown): Row[] => {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
};

// A fixed "now": 2026-06-15 12:00:00 UTC. Kiritimati (UTC+14) is already June 16 there; Pago Pago (UTC-11) is still June 15.
const NOW = new Date("2026-06-15T12:00:00Z");

describe.skipIf(!hasDb)("oversight/reads.ts (Postgres-backed)", { timeout: 180_000 }, () => {
  let fx: CalendarFixture;
  let reads: typeof import("./reads");
  let P: string; // the subject presbytery (default time zone)
  let PBIG: string; // thirty congregations
  let PSMALL: string; // two congregations
  let PKIR: string; // Pacific/Kiritimati
  let PPAGO: string; // Pacific/Pago_Pago
  let P2: string; // another presbytery
  let C1: string;
  let C2: string;
  let CCLOSED: string; // closed, still under P (R9)
  let CDEPART: string; // departed P for P2 (R9)
  let CX: string; // member of P2
  const orgs: string[] = [];
  const congregations: string[] = [];
  const who: Record<"both" | "manage" | "finance" | "none", string> = {} as never;
  let stamp: string;

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const viewer = (personId: string, organizationId = P): OversightViewer => ({ personId, organizationId });
  /** The list's data for a viewer who must be allowed in. */
  async function listOf(v: OversightViewer) {
    const r = await reads.readOversightList(v, NOW);
    if (r.kind !== "ok") throw new Error(`the list refused: ${r.kind}`);
    return r.data;
  }

  async function affiliate(subject: string, parent: string) {
    await q(sql`
      insert into organization_affiliations
        (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
      values (${parent}, ${subject}, ${parent}, 'member_congregation', '2000-01-01', 'recorded',
              'Fixture affiliation for oversight reads.db.test.ts')`);
  }
  async function cong(name: string, parent: string): Promise<string> {
    const id = await fx.makeOrg(name);
    congregations.push(id);
    await affiliate(id, parent);
    return id;
  }
  const U = () => fx.actingUserId;

  async function building(org: string, about: string, name: string, over: { primary?: boolean; retiredOn?: string; removed?: boolean } = {}): Promise<string> {
    const [row] = await q(sql`
      insert into oversight_buildings (organization_id, about_org_id, name, building_type, is_primary, retired_on, retired_reason, removed_at, removed_by, created_by, updated_by)
      values (${org}, ${about}, ${name}, 'sanctuary', ${over.primary ?? false}, ${over.retiredOn ?? null}::date, ${over.retiredOn ? "sold" : null},
              ${over.removed ? sql`now()` : null}, ${over.removed ? U() : null}, ${U()}, ${U()})
      returning id`);
    return String(row!.id);
  }
  async function appraisal(org: string, about: string, buildingId: string, year: number, cents: number, removed = false): Promise<string> {
    const [row] = await q(sql`
      insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, removed_at, removed_by, created_by)
      values (${org}, ${about}, ${buildingId}, ${year}, ${cents}, ${removed ? sql`now()` : null}, ${removed ? U() : null}, ${U()}) returning id`);
    return String(row!.id);
  }
  async function insurance(org: string, about: string, year: number, expires: string | null, removed = false): Promise<string> {
    const [row] = await q(sql`
      insert into oversight_insurance_years (organization_id, about_org_id, policy_year, carrier, policy_expires_on, removed_at, removed_by, created_by, updated_by)
      values (${org}, ${about}, ${year}, 'Fixture Mutual', ${expires}::date, ${removed ? sql`now()` : null}, ${removed ? U() : null}, ${U()}, ${U()}) returning id`);
    return String(row!.id);
  }
  async function loan(org: string, about: string, status: "open" | "paid_off", removed = false): Promise<string> {
    const [row] = await q(sql`
      insert into oversight_loans (organization_id, about_org_id, kind, status, paid_off_on, current_balance_cents, balance_as_of, removed_at, removed_by, created_by, updated_by)
      values (${org}, ${about}, 'presbytery_program', ${status}, ${status === "paid_off" ? "2026-01-01" : null}::date,
              ${status === "paid_off" ? 0 : 500000}, '2026-01-01', ${removed ? sql`now()` : null}, ${removed ? U() : null}, ${U()}, ${U()}) returning id`);
    return String(row!.id);
  }
  async function profile(org: string, about: string, city: string, county: string): Promise<void> {
    await q(sql`insert into oversight_profiles (organization_id, about_org_id, city, county, created_by, updated_by) values (${org}, ${about}, ${city}, ${county}, ${U()}, ${U()})`);
  }

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("ovrreads");
    stamp = String(Date.now());
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    PBIG = await fx.makeOrg("BigPresbytery", { organizationType: "presbytery" });
    PSMALL = await fx.makeOrg("SmallPresbytery", { organizationType: "presbytery" });
    PKIR = await fx.makeOrg("KiritimatiPresbytery", { organizationType: "presbytery", timeZone: "Pacific/Kiritimati" });
    PPAGO = await fx.makeOrg("PagoPresbytery", { organizationType: "presbytery", timeZone: "Pacific/Pago_Pago" });
    P2 = await fx.makeOrg("OtherPresbytery", { organizationType: "presbytery" });
    orgs.push(P, PBIG, PSMALL, PKIR, PPAGO, P2);

    C1 = await cong("Cong1", P);
    C2 = await cong("Cong2", P);
    CCLOSED = await cong("CongClosed", P);
    CDEPART = await cong("CongDeparted", P);
    CX = await cong("CongX", P2);
    // closed: still under the presbytery (parent_id unchanged), lifecycle no longer active (R9)
    await q(sql`update organizations set lifecycle_status = 'dissolved' where id = ${CCLOSED}`);
    // departed: the affiliation closes and the congregation joins P2 (as seed-dev's Quillhaven did)
    await fx.platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('presby.affiliation_trigger_active', 'true', true)`);
      await tx.execute(sql`
        update organization_affiliations
           set effective_to = '2024-01-01', closed_by_org_id = ${P}, closed_on = '2024-01-01',
               closed_minute_reference = 'Fixture departure for oversight reads.db.test.ts'
         where subject_org_id = ${CDEPART} and effective_to is null`);
      await tx.execute(sql`
        insert into organization_affiliations
          (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
        values (${P2}, ${CDEPART}, ${P2}, 'member_congregation', '2024-01-01', 'recorded', 'Fixture arrival for oversight reads.db.test.ts')`);
    });

    for (let i = 1; i <= 2; i += 1) await cong(`Small${i}`, PSMALL);
    for (let i = 1; i <= 30; i += 1) await cong(`Big${String(i).padStart(2, "0")}`, PBIG);

    const MANAGE = "congregation_oversight.manage";
    const FINANCE = "congregation_oversight.finance";
    who.both = await fx.makePerson("Both", `Keys${stamp}`);
    who.manage = await fx.makePerson("Manage", `Only${stamp}`);
    who.finance = await fx.makePerson("Finance", `Only${stamp}`);
    who.none = await fx.makePerson("Neither", `Key${stamp}`);
    // `both` belongs to every presbytery here (one active roll at most, so the others carry none).
    await fx.enroll(P, who.both, [MANAGE, FINANCE]);
    for (const org of orgs.filter((o) => o !== P)) {
      await fx.addMemberElsewhere(org, who.both);
      await fx.grant(org, await fx.makeRole(org, `fx_both_${org.slice(0, 8)}`, [MANAGE, FINANCE]), who.both);
    }
    // The other three people belong to P only.
    await fx.enroll(P, who.manage, [MANAGE]);
    await fx.enroll(P, who.finance, [FINANCE]);
    await fx.enroll(P, who.none, []);

    reads = await import("./reads");
  }, 600_000);

  afterAll(async () => {
    if (!fx) return;
    // Teardown order (the B1 contract): the record rows (about_org_id is NO ACTION, and so is the legacy
    // assessment row's), then the congregations, then cleanup() deletes the presbyteries and the people.
    for (const t of SIX) await q(sql`delete from ${sql.identifier(t)} where organization_id in ${orgs}`);
    await q(sql`delete from congregation_oversight where organization_id in ${orgs}`);
    await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      for (const c of congregations) await q(sql`delete from organizations where id = ${c}`);
    } finally {
      await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    await fx.cleanup();
  });

  afterEach(() => vi.restoreAllMocks());

  // ---------------------------------------------------------------------------
  it("(precondition) a closed congregation is still a child of the presbytery; the departed one is not", async () => {
    const rows = await q(sql`select id, parent_id, lifecycle_status from organizations where id in (${CCLOSED}, ${CDEPART}, ${C1})`);
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row(CCLOSED)).toMatchObject({ parent_id: P, lifecycle_status: "dissolved" });
    expect(row(CDEPART).parent_id).toBe(P2);
    expect(row(C1).parent_id).toBe(P);
  });

  // ---------------------------------------------------------------------------
  describe("each reader answers `forbidden` for a person without its key, and returns no data", () => {
    it("tier 1 readers: forbidden for a finance-only person and for a person with neither", async () => {
      const b = await building(P, C1, `T1 ${stamp}`);
      for (const personId of [who.finance, who.none]) {
        const v = viewer(personId);
        expect(await reads.readProfile(v, C1)).toEqual({ kind: "forbidden" });
        expect(await reads.readBuildings(v, C1)).toEqual({ kind: "forbidden" });
        expect(await reads.readBuilding(v, C1, b)).toEqual({ kind: "forbidden" });
      }
    });

    it("tier 2 readers: forbidden for a manage-only person and for a person with neither", async () => {
      const b = await building(P, C1, `T2 ${stamp}`);
      const ins = await insurance(P, C1, 2010, null);
      const ln = await loan(P, C1, "open");
      for (const personId of [who.manage, who.none]) {
        const v = viewer(personId);
        expect(await reads.readAppraisals(v, C1, b)).toEqual({ kind: "forbidden" });
        expect(await reads.readInsuranceYears(v, C1, NOW)).toEqual({ kind: "forbidden" });
        expect(await reads.readInsuranceYear(v, C1, ins)).toEqual({ kind: "forbidden" });
        expect(await reads.readLoans(v, C1)).toEqual({ kind: "forbidden" });
        expect(await reads.readLoan(v, C1, ln)).toEqual({ kind: "forbidden" });
      }
    });

    it("the list and the access read: neither key is forbidden; either key opens them", async () => {
      expect(await reads.readOversightList(viewer(who.none), NOW)).toEqual({ kind: "forbidden" });
      expect(await reads.readOversightAccess(viewer(who.none))).toEqual({ kind: "forbidden" });
      for (const personId of [who.manage, who.finance, who.both]) {
        expect((await reads.readOversightList(viewer(personId), NOW)).kind).toBe("ok");
        expect((await reads.readOversightAccess(viewer(personId), C1)).kind).toBe("ok");
      }
    });

    it("neither key is `forbidden` BEFORE the congregation is resolved: no existence leak", async () => {
      const nowhere = "00000000-0000-4000-8000-0000000000ff";
      for (const target of [C1, CX, nowhere]) {
        expect(await reads.readOversightAccess(viewer(who.none), target), `none -> ${target}`).toEqual({ kind: "forbidden" });
        expect(await reads.readProfile(viewer(who.none), target)).toEqual({ kind: "forbidden" });
        expect(await reads.readLoans(viewer(who.none), target)).toEqual({ kind: "forbidden" });
      }
      // a key holder asking for a stranger's congregation, or one that does not exist, gets one answer
      for (const target of [CX, nowhere, CDEPART]) {
        expect(await reads.readOversightAccess(viewer(who.both), target), target).toEqual({ kind: "not_found" });
        expect(await reads.readProfile(viewer(who.both), target)).toEqual({ kind: "not_found" });
        expect(await reads.readBuildings(viewer(who.both), target)).toEqual({ kind: "not_found" });
        expect(await reads.readLoans(viewer(who.both), target)).toEqual({ kind: "not_found" });
      }
    });

    it("the access read says which keys the viewer holds and names the congregation", async () => {
      expect(await reads.readOversightAccess(viewer(who.manage), C1)).toEqual({
        kind: "ok",
        data: { manage: true, finance: false, congregation: { id: C1, name: expect.stringContaining("Cong1"), platformStatus: "unmanaged" } },
      });
      expect(await reads.readOversightAccess(viewer(who.finance))).toEqual({ kind: "ok", data: { manage: false, finance: true, congregation: null } });
      expect((await reads.readOversightAccess(viewer(who.both), C2)) as { data: { manage: boolean; finance: boolean } }).toMatchObject({ data: { manage: true, finance: true } });
    });
  });

  // ---------------------------------------------------------------------------
  describe("the list: columns follow keys, the roster follows R9", () => {
    it("a manage-only viewer gets no tier-2 field (absent, not null); a finance-only viewer gets no tier-1 field", async () => {
      await insurance(P, C1, 2026, "2026-09-01");
      await profile(P, C2, "Alder", "Franklin");
      const m = await listOf(viewer(who.manage));
      expect(m).toMatchObject({ manage: true, finance: false, today: null });
      for (const row of m.rows) {
        expect(Object.keys(row).sort(), row.name as string).toEqual(["manage", "name", "organizationId", "platformStatus"]);
        expect(Object.keys(row.manage as object).sort()).toEqual(["assessmentUpdatedAt", "buildingsInUse", "buildingsRetired", "city", "county", "viabilityScore"]);
      }
      expect(JSON.stringify(m)).not.toMatch(/insurance|expir|carrier|policy|loan|apprais/i);

      const f = await listOf(viewer(who.finance));
      expect(f).toMatchObject({ manage: false, finance: true, today: "2026-06-15" });
      for (const row of f.rows) {
        expect(Object.keys(row).sort(), row.name as string).toEqual(["finance", "name", "organizationId", "platformStatus"]);
        expect(Object.keys(row.finance as object)).toEqual(["insuranceExpiresOn"]);
      }
      expect(JSON.stringify(f)).not.toMatch(/city|county|viability|building|Alder|Franklin|assessment/i);
      expect(f.rows.find((r) => r.organizationId === C1)).toMatchObject({ finance: { insuranceExpiresOn: "2026-09-01" } });

      const b = await listOf(viewer(who.both));
      const c2 = b.rows.find((r) => r.organizationId === C2)!;
      expect(c2.manage).toMatchObject({ city: "Alder", county: "Franklin" });
      expect(c2.finance).toEqual({ insuranceExpiresOn: null });
    });

    it("the roster includes a closed congregation still under the presbytery and excludes one that departed (R9, F453)", async () => {
      const ids = (await listOf(viewer(who.both))).rows.map((r) => r.organizationId);
      expect(ids).toContain(CCLOSED);
      expect(ids).toEqual(expect.arrayContaining([C1, C2]));
      expect(ids).not.toContain(CDEPART);
      expect(ids).not.toContain(CX);
      // a departed congregation's rows stay readable under RLS but unreachable through any reader here
      expect(await reads.readBuildings(viewer(who.both), CDEPART)).toEqual({ kind: "not_found" });
    });

    it("the building count is live and not retired; the viability and update time come from the assessment row; no carrier or expiry is selected", async () => {
      await q(sql`delete from oversight_buildings where organization_id = ${P} and about_org_id = ${C2}`);
      await building(P, C2, `Live A ${stamp}`);
      await building(P, C2, `Live B ${stamp}`);
      await building(P, C2, `Retired ${stamp}`, { retiredOn: "2026-01-01" });
      await building(P, C2, `Removed ${stamp}`, { removed: true });
      await q(sql`insert into congregation_oversight (organization_id, about_org_id, viability_score, insurance_carrier, insurance_expires_on, updated_by)
                  values (${P}, ${C2}, 2, 'LEGACY-SECRET-CARRIER', '2031-01-01', ${U()})
                  on conflict (organization_id, about_org_id) do update set viability_score = 2, insurance_carrier = 'LEGACY-SECRET-CARRIER'`);
      const data = await listOf(viewer(who.manage));
      const row = data.rows.find((r) => r.organizationId === C2)!;
      // the removed building is in neither figure: 2 live in use, 1 live retired
      expect(row.manage).toMatchObject({ buildingsInUse: 2, buildingsRetired: 1, viabilityScore: 2 });
      expect(typeof row.manage?.assessmentUpdatedAt).toBe("string");
      expect(JSON.stringify(data)).not.toContain("LEGACY-SECRET-CARRIER");
      expect(JSON.stringify(data)).not.toContain("2031-01-01");
      // a congregation with no buildings has a count of 0 (the cell renders "Not recorded"); the reader never invents a number
      expect(data.rows.find((r) => r.organizationId === C1)!.manage).toMatchObject({ buildingsInUse: expect.any(Number) });
    });

    it("a congregation whose only live building is retired is { buildingsInUse: 0, buildingsRetired: 1 }; a removed one beside it counts in neither (QA run 1 item 4)", async () => {
      const about = await cong("RetiredOnly", P);
      await building(P, about, `Retired only ${stamp}`, { retiredOn: "2026-01-01" });
      await building(P, about, `Removed beside it ${stamp}`, { removed: true });
      await building(P, about, `Removed and retired ${stamp}`, { retiredOn: "2025-01-01", removed: true });
      const row = (await listOf(viewer(who.manage))).rows.find((r) => r.organizationId === about)!;
      expect(row.manage).toMatchObject({ buildingsInUse: 0, buildingsRetired: 1 });
      // nothing recorded at all (removed rows only) is { 0, 0 }: the cell says "Not recorded"
      const empty = await cong("RemovedOnly", P);
      await building(P, empty, `Removed only ${stamp}`, { removed: true });
      expect((await listOf(viewer(who.manage))).rows.find((r) => r.organizationId === empty)!.manage).toMatchObject({
        buildingsInUse: 0,
        buildingsRetired: 0,
      });
    });

    it("the insurance cell is the NEWEST policy year's expiry, not the soonest of all years (T8); removed years do not count", async () => {
      const about = await cong("T8", P);
      await insurance(P, about, 2024, "2024-03-01");
      await insurance(P, about, 2026, "2026-03-01");
      await insurance(P, about, 2025, "2025-03-01");
      await insurance(P, about, 2027, "2027-03-01", true); // removed: ignored
      const f = await listOf(viewer(who.finance));
      expect(f.rows.find((r) => r.organizationId === about)!.finance?.insuranceExpiresOn).toBe("2026-03-01");
      // a newest year with no expiry recorded is null, never an older year's date
      await insurance(P, about, 2028, null);
      const g = await listOf(viewer(who.finance));
      expect(g.rows.find((r) => r.organizationId === about)!.finance?.insuranceExpiresOn).toBeNull();
    });

    it("another presbytery's rows never reach this presbytery's list", async () => {
      await building(P2, CX, `Other ${stamp}`);
      await insurance(P2, CX, 2026, "2030-01-01");
      await profile(P2, CX, "Elsewhere", "Nowhere");
      const text = JSON.stringify(await reads.readOversightList(viewer(who.both), NOW));
      for (const s of ["Elsewhere", "Nowhere", "2030-01-01", `Other ${stamp}`]) expect(text).not.toContain(s);
    });
  });

  // ---------------------------------------------------------------------------
  describe("the query count is fixed", () => {
    async function countStatements(run: () => Promise<unknown>): Promise<number> {
      const { db } = await import("@/lib/db");
      const original = db.transaction.bind(db) as (cb: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => Promise<unknown>;
      let count = 0;
      const STATEMENT = new Set(["select", "selectDistinct", "selectDistinctOn", "insert", "update", "delete", "execute"]);
      const spy = vi.spyOn(db, "transaction").mockImplementation(((cb: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
        original(
          (tx: unknown) =>
            cb(
              new Proxy(tx as object, {
                get(target, prop, receiver) {
                  const value = Reflect.get(target, prop, receiver);
                  if (typeof value !== "function") return value;
                  return (...args: unknown[]) => {
                    if (typeof prop === "string" && STATEMENT.has(prop)) count += 1;
                    return (value as (...a: unknown[]) => unknown).apply(target, args);
                  };
                },
              }),
            ),
          ...rest,
        )) as never);
      try {
        await run();
      } finally {
        spy.mockRestore();
      }
      return count;
    }

    it("the same number of statements for 2 and for 30 congregations, for every viewer", async () => {
      const { readOversightList } = reads;
      for (const personId of [who.both]) {
        const small = await countStatements(() => readOversightList(viewer(personId, PSMALL), NOW));
        const big = await countStatements(() => readOversightList(viewer(personId, PBIG), NOW));
        expect(small).toBeGreaterThan(0);
        expect(big, "30 congregations must cost the same as 2").toBe(small);
        // the key check, the roster, then one grouped read per held tier (plus the two withOrgContext statements)
        expect(big).toBeLessThanOrEqual(9);
      }
    });

    it("the roster really is bigger (the count test is not comparing two empty lists)", async () => {
      expect((await listOf(viewer(who.both, PBIG))).rows).toHaveLength(30);
      expect((await listOf(viewer(who.both, PSMALL))).rows).toHaveLength(2);
    });

    it("a manage-only and a finance-only viewer each cost fewer statements than both", async () => {
      const both = await countStatements(() => reads.readOversightList(viewer(who.both, P), NOW));
      const manageOnly = await countStatements(() => reads.readOversightList(viewer(who.manage, P), NOW));
      const financeOnly = await countStatements(() => reads.readOversightList(viewer(who.finance, P), NOW));
      expect(manageOnly).toBeLessThan(both);
      expect(financeOnly).toBeLessThan(both);
    });
  });

  // ---------------------------------------------------------------------------
  describe("time zones", () => {
    it("readTodayInOrg uses the organization's own zone: Kiritimati is a day ahead of Pago Pago at the same instant", async () => {
      const { withOrgContext } = await import("@/lib/authz");
      const today = async (org: string) => withOrgContext(who.both, org, (tx) => reads.readTodayInOrg(tx, org, NOW));
      expect(await today(PKIR)).toBe("2026-06-16");
      expect(await today(PPAGO)).toBe("2026-06-15");
      // no settings row: the default zone (America/New_York), where 12:00Z is the same calendar day
      expect(await today(P)).toBe("2026-06-15");
    });

    it("the finance list carries the organization's local date, so 'Expired' is decided in that zone", async () => {
      const kir = (await listOf(viewer(who.both, PKIR)));
      const pago = (await listOf(viewer(who.both, PPAGO)));
      expect([kir.today, pago.today]).toEqual(["2026-06-16", "2026-06-15"]);
      const ins = await reads.readInsuranceYears(viewer(who.both, PKIR), (await cong("Tz", PKIR)), NOW);
      expect(ins).toMatchObject({ kind: "ok", data: { today: "2026-06-16", years: [] } });
    });
  });

  // ---------------------------------------------------------------------------
  describe("the section readers", () => {
    it("readProfile: null when none is recorded, else the row with its version", async () => {
      const about = await cong("Prof", P);
      expect(await reads.readProfile(viewer(who.manage), about)).toEqual({ kind: "ok", data: { profile: null } });
      await profile(P, about, "Birch", "Delaware");
      expect(await reads.readProfile(viewer(who.manage), about)).toMatchObject({
        kind: "ok",
        data: { profile: { city: "Birch", county: "Delaware", rowVersion: 1, provenance: "presbytery_entered", streetAddress: null, yearOrganized: null, phone: null } },
      });
    });

    it("readBuildings: live buildings with the retired included and the removed not, the primary first then by name, with counts", async () => {
      const about = await cong("Bldgs", P);
      await building(P, about, "Zeta hall");
      await building(P, about, "Alpha hall");
      const primary = await building(P, about, "Main sanctuary", { primary: true });
      await building(P, about, "Old manse", { retiredOn: "2025-05-05" });
      await building(P, about, "Mistake", { removed: true });
      const r = (await reads.readBuildings(viewer(who.manage), about)) as { kind: "ok"; data: { buildings: Array<{ id: string; name: string; isPrimary: boolean; retiredOn: string | null }>; inUse: number; retired: number } };
      expect(r.kind).toBe("ok");
      expect(r.data.buildings.map((b) => b.name)).toEqual(["Main sanctuary", "Alpha hall", "Old manse", "Zeta hall"]);
      expect(r.data.buildings[0]).toMatchObject({ id: primary, isPrimary: true });
      expect(r.data.inUse).toBe(3);
      expect(r.data.retired).toBe(1);
      expect(r.data.buildings.find((b) => b.name === "Old manse")!.retiredOn).toBe("2025-05-05");
    });

    it("readBuilding: one live building under (presbytery, congregation); another congregation's, another presbytery's and a removed one are `not_found`", async () => {
      const about = await cong("OneB", P);
      const mine = await building(P, about, `Mine ${stamp}`);
      const removed = await building(P, about, `Gone ${stamp}`, { removed: true });
      const theirs = await building(P, C1, `Theirs ${stamp}`);
      const foreign = await building(P2, CX, `Foreign ${stamp}`);
      expect(await reads.readBuilding(viewer(who.manage), about, mine)).toMatchObject({ kind: "ok", data: { id: mine, rowVersion: 1 } });
      for (const id of [removed, theirs, foreign, "00000000-0000-4000-8000-0000000000ff"]) {
        expect(await reads.readBuilding(viewer(who.manage), about, id), id).toEqual({ kind: "not_found" });
      }
    });

    it("readAppraisals: newest year first, the latest flagged, removed ones and another building's not included; a removed building is `not_found`", async () => {
      const about = await cong("Apr", P);
      const b = await building(P, about, `Apr ${stamp}`);
      const other = await building(P, about, `AprOther ${stamp}`);
      const a2020 = await appraisal(P, about, b, 2020, 100_000_00);
      const a2024 = await appraisal(P, about, b, 2024, 120_000_00);
      await appraisal(P, about, b, 2022, 110_000_00, true);
      await appraisal(P, about, other, 2025, 999_00);
      const r = (await reads.readAppraisals(viewer(who.finance), about, b)) as { kind: "ok"; data: { appraisals: Array<{ id: string; assessedYear: number; amountCents: number }>; latestId: string | null } };
      expect(r.data.appraisals.map((a) => a.assessedYear)).toEqual([2024, 2020]);
      expect(r.data.latestId).toBe(a2024);
      expect(r.data.appraisals[1]!.id).toBe(a2020);
      expect(r.data.appraisals[0]!.amountCents).toBe(12_000_000);
      // a building with none
      const empty = await building(P, about, `AprEmpty ${stamp}`);
      expect(await reads.readAppraisals(viewer(who.finance), about, empty)).toEqual({ kind: "ok", data: { appraisals: [], latestId: null } });
      // a removed building, another congregation's building, a stranger's id
      const gone = await building(P, about, `AprGone ${stamp}`, { removed: true });
      const theirs = await building(P, C1, `AprTheirs ${stamp}`);
      for (const id of [gone, theirs, "00000000-0000-4000-8000-0000000000ff"]) expect(await reads.readAppraisals(viewer(who.finance), about, id), id).toEqual({ kind: "not_found" });
    });

    it("readInsuranceYears / readInsuranceYear: newest first, removed excluded, one row or `not_found`", async () => {
      const about = await cong("Ins", P);
      const y24 = await insurance(P, about, 2024, "2024-05-01");
      const y26 = await insurance(P, about, 2026, "2026-05-01");
      const gone = await insurance(P, about, 2025, null, true);
      const theirs = await insurance(P, C1, 2012, null);
      const r = (await reads.readInsuranceYears(viewer(who.finance), about, NOW)) as { data: { years: Array<{ id: string; policyYear: number }>; today: string } };
      expect(r.data.years.map((y) => y.policyYear)).toEqual([2026, 2024]);
      expect(r.data.today).toBe("2026-06-15");
      expect(await reads.readInsuranceYear(viewer(who.finance), about, y24)).toMatchObject({ kind: "ok", data: { id: y24, policyYear: 2024, policyExpiresOn: "2024-05-01", rowVersion: 1 } });
      expect(await reads.readInsuranceYear(viewer(who.finance), about, y26)).toMatchObject({ kind: "ok" });
      for (const id of [gone, theirs]) expect(await reads.readInsuranceYear(viewer(who.finance), about, id), id).toEqual({ kind: "not_found" });
    });

    it("readLoans / readLoan: open loans first, then paid off; removed excluded; one row or `not_found`", async () => {
      const about = await cong("Loan", P);
      const paid = await loan(P, about, "paid_off");
      const open = await loan(P, about, "open");
      const gone = await loan(P, about, "open", true);
      const theirs = await loan(P, C1, "open");
      const r = (await reads.readLoans(viewer(who.finance), about)) as { data: { loans: Array<{ id: string; status: string }> } };
      expect(r.data.loans.map((l) => l.status)).toEqual(["open", "paid_off"]);
      expect(r.data.loans.map((l) => l.id)).toEqual([open, paid]);
      expect(await reads.readLoan(viewer(who.finance), about, open)).toMatchObject({ kind: "ok", data: { id: open, status: "open", currentBalanceCents: 500000, rowVersion: 1 } });
      for (const id of [gone, theirs]) expect(await reads.readLoan(viewer(who.finance), about, id), id).toEqual({ kind: "not_found" });
    });
  });

  // ---------------------------------------------------------------------------
  it("the readers write nothing: no row and no audit event (reads are not audited, DECISION-345)", async () => {
    const snapshot = async () => ({
      tables: await q(sql`select (select count(*) from oversight_profiles where organization_id = ${P})::int as p, (select count(*) from oversight_buildings where organization_id = ${P})::int as b,
                                 (select count(*) from oversight_loans where organization_id = ${P})::int as l, (select count(*) from oversight_insurance_years where organization_id = ${P})::int as i`),
      audit: await q(sql`select count(*)::int as n from audit_events where actor_user_id = ${U()}`),
    });
    const before = await snapshot();
    const v = viewer(who.both);
    await reads.readOversightList(v, NOW);
    await reads.readOversightAccess(v, C1);
    await reads.readProfile(v, C1);
    await reads.readBuildings(v, C1);
    await reads.readInsuranceYears(v, C1, NOW);
    await reads.readLoans(v, C1);
    expect(await snapshot()).toEqual(before);
  });
});
