/**
 * D3: src/lib/oversight/store.ts against a REAL Postgres connection
 * (docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "Test plan" D3 and
 * "Edge Cases"). Every write runs on the `presby_app` connection with an
 * organization context (`withOrgContext`), so RLS, the 0089 guards, the partial
 * uniques and the CHECKs are all live. Pinned here:
 *
 *   - each write: a missing key (the other tier's, or none) writes nothing and
 *     audits nothing; success writes EXACTLY ONE audit row with exactly the
 *     allowlisted metadata; no audit row carries a value (sentinels in every
 *     free-text and money field are found in none);
 *   - the audit is IN THE SAME TRANSACTION: an audit insert that fails leaves the
 *     data unchanged, and an audit insert that succeeded and then has the
 *     transaction fail leaves NO audit row (the two sabotages that each catches:
 *     an after-commit audit, and an audit on another connection);
 *   - optimistic concurrency by `row_version`: a stale edit writes nothing; two
 *     simultaneous edits of one version end with one write and one `stale`;
 *   - an unchanged edit writes and audits nothing;
 *   - a congregation of another presbytery, another congregation's building and a
 *     removed building are all the one `not_found`; the about-org trigger's
 *     refusal maps to `not_found`;
 *   - concurrency: two creates of one name (one row, one `duplicate_name`); two
 *     "make primary" on different buildings (exactly one primary, no error); two
 *     records for one insurance year or one appraisal year (one wins); two first
 *     saves of the profile (one `stale`);
 *   - removing or retiring a primary clears the mark in the same UPDATE; paid off
 *     writes the balance 0 and the date together; reopen clears the date.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/oversight/store.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
// Enter the domain cycle through the canonical entry point first (see
// oversight.db.test.ts); ./oversight is re-exported from domain/index.ts only at
// integration (Rule 16).
import "@/lib/db/schema";
import type { OversightCtx } from "./contract";
import {
  parseAppraisal,
  parseBuilding,
  parseInsurance,
  parseLoan,
  parseProfile,
  type AppraisalValues,
  type BuildingValues,
  type InsuranceValues,
  type LoanValues,
  type ProfileValues,
} from "./validate";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// A switch in front of the real audit insert.
const hooks = vi.hoisted(() => ({
  mode: "ok" as "ok" | "fail_before" | "fail_after",
  /** An organization the stand-in `resolveMemberCongregation` pretends is a member (the about-org trigger case). */
  pretendMember: null as null | string,
}));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (hooks.mode === "fail_before") throw new Error("audit store unavailable");
      await actual.insertAuditRow(...args);
      // The audit insert SUCCEEDED; now the transaction fails. In the same transaction both roll back.
      if (hooks.mode === "fail_after") throw new Error("transaction failed after the audit insert");
    },
  };
});
vi.mock("@/lib/presbytery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presbytery")>();
  return {
    ...actual,
    resolveMemberCongregation: async (...args: Parameters<typeof actual.resolveMemberCongregation>) =>
      hooks.pretendMember && args[2] === hooks.pretendMember
        ? { id: hooks.pretendMember, name: "Pretend member", platformStatus: "unmanaged" }
        : actual.resolveMemberCongregation(...args),
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;
const ENV = { year: 2026, today: "2026-06-15" };

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

// ── Input builders: the REAL parsers, so a test submits what an action would ──

const profileValues = (over: Partial<ProfileValues> = {}): ProfileValues => ({
  streetAddress: "",
  city: "",
  county: "",
  yearOrganized: "",
  phone: "",
  ...over,
});
const buildingValues = (over: Partial<BuildingValues> = {}): BuildingValues => ({
  name: "Main sanctuary",
  buildingType: "sanctuary",
  primary: false,
  yearBuilt: "",
  firstAdditionYear: "",
  secondAdditionYear: "",
  squareFeet: "",
  roofCondition: "",
  plumbingCondition: "",
  hvacCondition: "",
  boilerCondition: "",
  hasSprinklers: "",
  hasFireAlarm: "",
  hasSecuritySystem: "",
  notes: "",
  ...over,
});
const appraisalValues = (over: Partial<AppraisalValues> = {}): AppraisalValues => ({ assessedYear: "2024", amount: "1250000", notes: "", ...over });
const insuranceValues = (over: Partial<InsuranceValues> = {}): InsuranceValues => ({
  policyYear: "2026",
  carrier: "",
  policyNumber: "",
  policyExpiresOn: "",
  recentClaims: "",
  poolInterest: "",
  notes: "",
  ...over,
});
const loanValues = (over: Partial<LoanValues> = {}): LoanValues => ({
  kind: "presbytery_program",
  lender: "",
  originalAmount: "",
  currentBalance: "",
  balanceAsOf: "",
  grantsAmount: "",
  guaranteeNote: "",
  notes: "",
  status: "open",
  ...over,
});
function ok<T>(parsed: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!parsed.ok) throw new Error(`fixture input did not parse: ${parsed.message}`);
  return parsed.value;
}
const profileIn = (over?: Partial<ProfileValues>) => ok(parseProfile(profileValues(over), ENV));
const buildingIn = (over?: Partial<BuildingValues>) => ok(parseBuilding(buildingValues(over), ENV));
const appraisalIn = (over?: Partial<AppraisalValues>) => ok(parseAppraisal(appraisalValues(over), ENV));
const insuranceIn = (over?: Partial<InsuranceValues>, mode: "create" | "edit" = "create") => ok(parseInsurance(insuranceValues(over), ENV, mode));
const loanIn = (over?: Partial<LoanValues>) => ok(parseLoan(loanValues(over), ENV));

describe.skipIf(!hasDb)("oversight/store.ts (Postgres-backed)", { timeout: 180_000 }, () => {
  let fx: CalendarFixture;
  let store: typeof import("./store");
  let P: string; // the presbytery
  let P2: string; // another presbytery
  let C1: string; // member congregation of P
  let C2: string; // member congregation of P
  let CX: string; // member congregation of P2
  let CN: string; // a congregation that was never affiliated with anyone (the about-org trigger case)
  const congregations: string[] = [];
  const person: Record<"both" | "manage" | "finance" | "none" | "other", string> = {} as never;
  let stamp: string;
  let counter = 0;
  let yearCounter = 2027;

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const ctxFor = (personId: string, organizationId = P): OversightCtx => ({
    personId,
    organizationId,
    actor: { userId: fx.actingUserId, email: "records-test@example.invalid" },
  });
  const both = () => ctxFor(person.both);

  async function affiliate(subject: string, parent: string) {
    await q(sql`
      insert into organization_affiliations
        (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
      values (${parent}, ${subject}, ${parent}, 'member_congregation', '2000-01-01', 'recorded',
              'Fixture affiliation for oversight store.db.test.ts')`);
  }

  /** A fingerprint of every record row of both presbyteries, plus the oversight audit rows about them. */
  async function snapshot(): Promise<unknown> {
    const tables: Row[] = [];
    for (const t of SIX) {
      tables.push(
        ...(await q(
          sql`select ${t}::text as t, count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x.id)), '') as h
                from ${sql.identifier(t)} x where x.organization_id in (${P}, ${P2})`,
        )),
      );
    }
    const audit = await q(
      sql`select count(*)::int as n from audit_events where action like 'tenant.oversight_%' and metadata->>'organizationId' in (${P}, ${P2})`,
    );
    return { tables, audit };
  }
  const auditRows = (resourceId: string) =>
    q(sql`select action, resource_type, resource_id, actor_user_id, metadata from audit_events where resource_id = ${resourceId} order by created_at, id`);
  const auditCount = async () =>
    Number((await q(sql`select count(*)::int as n from audit_events where action like 'tenant.oversight_%' and metadata->>'organizationId' = ${P}`))[0]!.n);
  const one = async (table: string, id: string): Promise<Row> => {
    const rows = await q(sql`select * from ${sql.identifier(table)} where id = ${id}`);
    expect(rows, `${table} ${id}`).toHaveLength(1);
    return rows[0]!;
  };

  /** A new member congregation of P (profiles are one per congregation, so each profile test takes its own). */
  async function freshCong(label = "Fresh"): Promise<string> {
    const id = await fx.makeOrg(`${label}${(counter += 1)}`);
    congregations.push(id);
    await affiliate(id, P);
    return id;
  }

  /** Creates a building as `both` and returns its id. */
  async function makeBuilding(about = C1, over?: Partial<BuildingValues>): Promise<string> {
    counter += 1;
    const r = await store.createBuilding(both(), about, buildingIn({ name: `Hall ${stamp}-${counter}`, ...over }));
    if (r.kind !== "ok") throw new Error(`createBuilding fixture refused: ${JSON.stringify(r)}`);
    return r.data.id;
  }
  async function makeInsurance(year = yearCounter--, over?: Partial<InsuranceValues>): Promise<string> {
    const r = await store.recordInsurance(both(), C1, insuranceIn({ policyYear: String(year), ...over }));
    if (r.kind !== "ok") throw new Error(`recordInsurance fixture refused: ${JSON.stringify(r)}`);
    return r.data.id;
  }
  async function makeLoan(over?: Partial<LoanValues>): Promise<string> {
    const r = await store.recordLoan(both(), C1, loanIn(over));
    if (r.kind !== "ok") throw new Error(`recordLoan fixture refused: ${JSON.stringify(r)}`);
    return r.data.id;
  }

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("ovrstore");
    stamp = String(Date.now());
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    P2 = await fx.makeOrg("OtherPresbytery", { organizationType: "presbytery" });
    C1 = await fx.makeOrg("Cong1");
    C2 = await fx.makeOrg("Cong2");
    CX = await fx.makeOrg("CongX");
    CN = await fx.makeOrg("CongNever");
    congregations.push(C1, C2, CX, CN);
    await affiliate(C1, P);
    await affiliate(C2, P);
    await affiliate(CX, P2);

    const MANAGE = "congregation_oversight.manage";
    const FINANCE = "congregation_oversight.finance";
    person.both = await fx.makePerson("Both", `Keys${stamp}`);
    person.manage = await fx.makePerson("Manage", `Only${stamp}`);
    person.finance = await fx.makePerson("Finance", `Only${stamp}`);
    person.none = await fx.makePerson("Neither", `Key${stamp}`);
    person.other = await fx.makePerson("Other", `Presbytery${stamp}`);
    await fx.enroll(P, person.both, [MANAGE, FINANCE]);
    await fx.enroll(P, person.manage, [MANAGE]);
    await fx.enroll(P, person.finance, [FINANCE]);
    await fx.enroll(P, person.none, []);
    await fx.enroll(P2, person.other, [MANAGE, FINANCE]);

    store = await import("./store");
  });

  afterAll(async () => {
    if (!fx) return;
    // The teardown order the B1 contract pins (about_org_id is NO ACTION): the six tables' rows first,
    // children before buildings, then the congregations, then cleanup() deletes the presbyteries and people.
    for (const t of SIX) await q(sql`delete from ${sql.identifier(t)} where organization_id in (${P}, ${P2})`);
    await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      for (const c of congregations) await q(sql`delete from organizations where id = ${c}`);
    } finally {
      await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    await fx.cleanup();
  });

  beforeEach(() => {
    hooks.mode = "ok";
    hooks.pretendMember = null;
  });
  afterEach(() => vi.restoreAllMocks());

  // ---------------------------------------------------------------------------
  it("(precondition) the member congregations are children of the presbytery and the writer is presby_app", async () => {
    const rows = await q(sql`select id, parent_id from organizations where id in (${C1}, ${C2}, ${CX}, ${CN})`);
    const parent = (id: string) => rows.find((r) => r.id === id)?.parent_id;
    expect(parent(C1)).toBe(P);
    expect(parent(C2)).toBe(P);
    expect(parent(CX)).toBe(P2);
    expect(parent(CN) ?? null).toBeNull();
    const { db } = await import("@/lib/db");
    const who = await db.transaction(async (tx) => rowsOf(await tx.execute(sql`select current_user as u`)));
    expect(who[0]).toEqual({ u: "presby_app" });
  });

  // ---------------------------------------------------------------------------
  describe("a missing key writes nothing and audits nothing", () => {
    type Call = (ctx: OversightCtx) => Promise<{ kind: string }>;

    it("every write refuses `forbidden` for the wrong key, and for no key at all", async () => {
      const b = await makeBuilding();
      const ap = String(
        ((await store.recordAppraisal(both(), C1, b, appraisalIn())) as { data: { id: string } }).data.id,
      );
      const ins = await makeInsurance();
      const loan = await makeLoan();

      const tier1: Array<[string, Call]> = [
        ["setProfile (update)", (c) => store.setProfile(c, C1, profileIn({ city: "Birch" }), 1)],
        ["createBuilding", (c) => store.createBuilding(c, C1, buildingIn({ name: `x ${stamp}` }))],
        ["updateBuilding", (c) => store.updateBuilding(c, C1, b, buildingIn({ name: `renamed ${stamp}` }), 1)],
        ["retireBuilding", (c) => store.retireBuilding(c, C1, b, { reason: "sold", retiredOn: "2026-01-01" })],
        ["reinstateBuilding", (c) => store.reinstateBuilding(c, C1, b)],
        ["removeBuilding", (c) => store.removeBuilding(c, C1, b)],
      ];
      const tier2: Array<[string, Call]> = [
        ["recordAppraisal", (c) => store.recordAppraisal(c, C1, b, appraisalIn({ assessedYear: "2020" }))],
        ["removeAppraisal", (c) => store.removeAppraisal(c, C1, b, ap)],
        ["recordInsurance", (c) => store.recordInsurance(c, C1, insuranceIn({ policyYear: "2001" }))],
        ["updateInsurance", (c) => store.updateInsurance(c, C1, ins, insuranceIn({ carrier: "Nope" }, "edit"), 1)],
        ["removeInsurance", (c) => store.removeInsurance(c, C1, ins)],
        ["recordLoan", (c) => store.recordLoan(c, C1, loanIn())],
        ["updateLoan", (c) => store.updateLoan(c, C1, loan, loanIn({ lender: "Nope" }), 1)],
        ["markLoanPaidOff", (c) => store.markLoanPaidOff(c, C1, loan, { paidOffOn: "2026-01-01" })],
        ["removeLoan", (c) => store.removeLoan(c, C1, loan)],
      ];

      const before = await snapshot();
      for (const [name, call] of tier1) {
        for (const who of ["finance", "none"] as const) {
          expect(await call(ctxFor(person[who])), `${name} as ${who}`).toEqual({ kind: "refused", reason: "forbidden" });
        }
      }
      for (const [name, call] of tier2) {
        for (const who of ["manage", "none"] as const) {
          expect(await call(ctxFor(person[who])), `${name} as ${who}`).toEqual({ kind: "refused", reason: "forbidden" });
        }
      }
      expect(await snapshot()).toEqual(before);
    });

    it("a person with no membership at the presbytery is refused `forbidden` (OrgAccessError), and nothing is written", async () => {
      const before = await snapshot();
      const stranger = await fx.makePerson("Stranger", `NoMember${stamp}`);
      const r = await store.createBuilding(ctxFor(stranger), C1, buildingIn({ name: `s ${stamp}` }));
      expect(r).toEqual({ kind: "refused", reason: "forbidden" });
      expect(await snapshot()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------
  describe("each write: one audit row, allowlisted metadata, in the same transaction", () => {
    async function expectOneAudit(resourceId: string, action: string, resourceType: string, keys: string[], extra: Partial<Record<string, unknown>> = {}) {
      const rows = (await auditRows(resourceId)).filter((r) => r.action === action);
      expect(rows, `${action} rows for ${resourceId}`).toHaveLength(1);
      const row = rows[0]!;
      expect(row.resource_type).toBe(resourceType);
      expect(row.actor_user_id).toBe(fx.actingUserId);
      const metadata = row.metadata as Record<string, unknown>;
      expect(Object.keys(metadata).sort()).toEqual(["aboutOrgId", "organizationId", ...keys].sort());
      expect(metadata.organizationId).toBe(P);
      expect(metadata.aboutOrgId).toBe(C1);
      for (const [k, v] of Object.entries(extra)) expect(metadata[k], k).toEqual(v);
      return metadata;
    }

    it("setProfile: create then edit, then an unchanged save writes and audits nothing", async () => {
      const cong = await freshCong();
      const first = await store.setProfile(both(), cong, profileIn({ city: "Alder Creek", county: "Franklin", yearOrganized: "1850" }), null);
      expect(first).toMatchObject({ kind: "ok", data: { created: true } });
      const id = (first as { data: { id: string } }).data.id;
      const [row] = await q(sql`select * from oversight_profiles where id = ${id}`);
      expect(row).toMatchObject({ city: "Alder Creek", county: "Franklin", year_organized: 1850, row_version: 1, provenance: "presbytery_entered", created_by: fx.actingUserId });
      const created = (await auditRows(id))[0]!;
      expect(created.action).toBe("tenant.oversight_profile.set");
      expect(Object.keys(created.metadata as object).sort()).toEqual(["aboutOrgId", "changed", "created", "organizationId"]);
      expect((created.metadata as { created: boolean }).created).toBe(true);
      expect((created.metadata as { changed: string[] }).changed.sort()).toEqual(["city", "county", "yearOrganized"]);

      const edited = await store.setProfile(both(), cong, profileIn({ city: "Alder Creek", county: "Delaware", yearOrganized: "1850", phone: "614-555-0100" }), 1);
      expect(edited).toMatchObject({ kind: "ok", data: { id, created: false } });
      expect(await one("oversight_profiles", id)).toMatchObject({ county: "Delaware", phone: "614-555-0100", row_version: 2, updated_by: fx.actingUserId });
      const audit = (await auditRows(id)).filter((r) => (r.metadata as { created: boolean }).created === false);
      expect(audit).toHaveLength(1);
      expect((audit[0]!.metadata as { changed: string[] }).changed.sort()).toEqual(["county", "phone"]);

      const before = await snapshot();
      const same = await store.setProfile(both(), cong, profileIn({ city: "Alder Creek", county: "Delaware", yearOrganized: "1850", phone: "614-555-0100" }), 2);
      expect(same).toEqual({ kind: "ok", data: { id, created: false, unchanged: true } });
      expect(await snapshot()).toEqual(before);
    });

    it("setProfile: an all-empty create writes nothing; a create over an existing profile, and a wrong version, are `stale`", async () => {
      const cong = await freshCong();
      const before = await snapshot();
      expect(await store.setProfile(both(), cong, profileIn(), null)).toEqual({ kind: "ok", data: { id: "", created: false, unchanged: true } });
      expect(await snapshot()).toEqual(before);

      const made = await store.setProfile(both(), cong, profileIn({ city: "Birch" }), null);
      expect(made.kind).toBe("ok");
      const mid = await snapshot();
      expect(await store.setProfile(both(), cong, profileIn({ city: "Other" }), null)).toEqual({ kind: "refused", reason: "stale" });
      expect(await store.setProfile(both(), cong, profileIn({ city: "Other" }), 7)).toEqual({ kind: "refused", reason: "stale" });
      // an edit of a profile that does not exist yet is stale too
      expect(await store.setProfile(both(), await freshCong(), profileIn({ city: "Other" }), 1)).toEqual({ kind: "refused", reason: "stale" });
      expect(await snapshot()).toEqual(mid);
      // saving empty fields clears them (a profile is never removed)
      const cleared = await store.setProfile(both(), cong, profileIn(), 1);
      expect(cleared.kind).toBe("ok");
      expect(await q(sql`select city from oversight_profiles where organization_id = ${P} and about_org_id = ${cong}`)).toEqual([{ city: null }]);
    });

    it("building: create, update (changed names only), retire, bring back, remove", async () => {
      const created = await store.createBuilding(both(), C1, buildingIn({ name: `Sanct ${stamp}`, primary: true, yearBuilt: "1962", notes: "SENTINEL-NOTE" }));
      expect(created.kind).toBe("ok");
      const id = (created as { data: { id: string } }).data.id;
      expect(await one("oversight_buildings", id)).toMatchObject({ is_primary: true, year_built: 1962, row_version: 1, provenance: "presbytery_entered", created_by: fx.actingUserId, removed_at: null });
      await expectOneAudit(id, "tenant.oversight_building.created", "oversight_building", ["buildingId", "primary", "previousPrimaryBuildingId"], { buildingId: id, primary: true });

      const updated = await store.updateBuilding(both(), C1, id, buildingIn({ name: `Sanct ${stamp}`, primary: true, yearBuilt: "1963", notes: "SENTINEL-NOTE", roofCondition: "poor" }), 1);
      expect(updated).toEqual({ kind: "ok", data: { id } });
      expect(await one("oversight_buildings", id)).toMatchObject({ year_built: 1963, roof_condition: "poor", row_version: 2 });
      const upd = (await auditRows(id)).filter((r) => r.action === "tenant.oversight_building.updated");
      expect(upd).toHaveLength(1);
      expect((upd[0]!.metadata as { changed: string[] }).changed.sort()).toEqual(["roofCondition", "yearBuilt"]);

      const before = await snapshot();
      expect(await store.updateBuilding(both(), C1, id, buildingIn({ name: `Sanct ${stamp}`, primary: true, yearBuilt: "1963", notes: "SENTINEL-NOTE", roofCondition: "poor" }), 2)).toEqual({ kind: "ok", data: { id, unchanged: true } });
      expect(await snapshot()).toEqual(before);

      // retire clears the primary mark in the same UPDATE
      expect(await store.retireBuilding(both(), C1, id, { reason: "sold", retiredOn: "2026-01-02" })).toEqual({ kind: "ok", data: { id } });
      expect(await one("oversight_buildings", id)).toMatchObject({ retired_reason: "sold", is_primary: false, row_version: 3 });
      const ret = (await auditRows(id)).filter((r) => r.action === "tenant.oversight_building.retired");
      expect(ret).toHaveLength(1);
      expect(ret[0]!.metadata).toMatchObject({ buildingId: id, reason: "sold" });
      expect(await store.retireBuilding(both(), C1, id, { reason: "closed", retiredOn: "2026-01-03" })).toEqual({ kind: "refused", reason: "already_retired" });

      // bring back into use
      expect(await store.reinstateBuilding(both(), C1, id)).toEqual({ kind: "ok", data: { id } });
      expect(await one("oversight_buildings", id)).toMatchObject({ retired_on: null, retired_reason: null, row_version: 4 });
      const back = (await auditRows(id)).filter((r) => r.action === "tenant.oversight_building.updated" && JSON.stringify((r.metadata as { changed: string[] }).changed) === '["retired"]');
      expect(back).toHaveLength(1);
      expect(await store.reinstateBuilding(both(), C1, id)).toEqual({ kind: "refused", reason: "not_retired" });

      // remove (one-way)
      expect(await store.removeBuilding(both(), C1, id)).toEqual({ kind: "ok", data: { id } });
      expect(await one("oversight_buildings", id)).toMatchObject({ removed_by: fx.actingUserId, is_primary: false });
      expect((await one("oversight_buildings", id)).removed_at).not.toBeNull();
      await expectOneAudit(id, "tenant.oversight_building.removed", "oversight_building", ["buildingId"]);
      // a removed building is not found by anything
      expect(await store.updateBuilding(both(), C1, id, buildingIn({ name: "x" }), 5)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.retireBuilding(both(), C1, id, { reason: "sold", retiredOn: "2026-01-01" })).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removeBuilding(both(), C1, id)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.recordAppraisal(both(), C1, id, appraisalIn())).toEqual({ kind: "refused", reason: "not_found" });
    });

    it("making a building primary demotes the previous primary, recorded in the audit row", async () => {
      const first = await makeBuilding(C2, { primary: true });
      const second = await store.createBuilding(both(), C2, buildingIn({ name: `Second ${stamp}`, primary: true }));
      const secondId = (second as { data: { id: string } }).data.id;
      expect(await one("oversight_buildings", first)).toMatchObject({ is_primary: false, row_version: 2 });
      expect(await one("oversight_buildings", secondId)).toMatchObject({ is_primary: true });
      const audit = (await auditRows(secondId))[0]!;
      expect((audit.metadata as { previousPrimaryBuildingId: string }).previousPrimaryBuildingId).toBe(first);

      // an update that takes the mark back demotes the other, and a non-primary edit never touches it
      const taken = await store.updateBuilding(both(), C2, first, buildingIn({ name: String((await one("oversight_buildings", first)).name), primary: true }), 2);
      expect(taken.kind).toBe("ok");
      expect(await one("oversight_buildings", secondId)).toMatchObject({ is_primary: false });
      const takeAudit = (await auditRows(first)).filter((r) => r.action === "tenant.oversight_building.updated");
      expect(takeAudit).toHaveLength(1);
      expect(takeAudit[0]!.metadata).toMatchObject({ changed: ["primary"], previousPrimaryBuildingId: secondId });
      // exactly one live primary
      expect(await q(sql`select count(*)::int as n from oversight_buildings where organization_id = ${P} and about_org_id = ${C2} and is_primary and removed_at is null`)).toEqual([{ n: 1 }]);
    });

    it("removing a primary building clears the mark in the same UPDATE (the partial unique never holds a dead primary)", async () => {
      const a = await makeBuilding(C2, { primary: true });
      expect(await store.removeBuilding(both(), C2, a)).toEqual({ kind: "ok", data: { id: a } });
      expect(await one("oversight_buildings", a)).toMatchObject({ is_primary: false });
      const b = await makeBuilding(C2, { primary: true });
      expect(await one("oversight_buildings", b)).toMatchObject({ is_primary: true });
    });

    it("appraisals: record, a duplicate year, remove, then the year can be recorded again", async () => {
      const b = await makeBuilding();
      const rec = await store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2024", amount: "987654.32", notes: "SENTINEL-APPRAISAL-NOTE" }));
      expect(rec.kind).toBe("ok");
      const id = (rec as { data: { id: string } }).data.id;
      expect(await one("oversight_building_appraisals", id)).toMatchObject({ assessed_year: 2024, building_id: b, created_by: fx.actingUserId });
      expect(String((await one("oversight_building_appraisals", id)).amount_cents)).toBe("98765432");
      await expectOneAudit(id, "tenant.oversight_appraisal.recorded", "oversight_appraisal", ["buildingId", "appraisalId", "assessedYear"], { buildingId: b, appraisalId: id, assessedYear: 2024 });

      expect(await store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2024", amount: "1" }))).toEqual({ kind: "refused", reason: "duplicate_appraisal_year" });
      expect(await store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2025", amount: "1" }))).toMatchObject({ kind: "ok" });

      // a wrong building id, or the same appraisal under another building, is not found
      const other = await makeBuilding();
      expect(await store.removeAppraisal(both(), C1, other, id)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removeAppraisal(both(), C1, b, id)).toEqual({ kind: "ok", data: { id } });
      await expectOneAudit(id, "tenant.oversight_appraisal.removed", "oversight_appraisal", ["buildingId", "appraisalId"]);
      expect(await store.removeAppraisal(both(), C1, b, id)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2024", amount: "2" }))).toMatchObject({ kind: "ok" });
    });

    it("insurance: record, a duplicate year, edit (policy year fixed), unchanged, remove, record the year again", async () => {
      const rec = await store.recordInsurance(both(), C1, insuranceIn({ policyYear: "1999", carrier: "SENTINEL-CARRIER", policyNumber: "SENTINEL-POLICY-9", policyExpiresOn: "2000-03-01", notes: "SENTINEL-INS-NOTE" }));
      expect(rec.kind).toBe("ok");
      const id = (rec as { data: { id: string } }).data.id;
      await expectOneAudit(id, "tenant.oversight_insurance.recorded", "oversight_insurance", ["insuranceId", "policyYear"], { insuranceId: id, policyYear: 1999 });
      expect(await store.recordInsurance(both(), C1, insuranceIn({ policyYear: "1999" }))).toEqual({ kind: "refused", reason: "duplicate_policy_year" });

      const edit = insuranceIn({ carrier: "SENTINEL-CARRIER", policyNumber: "SENTINEL-POLICY-9", policyExpiresOn: "2001-03-01", notes: "SENTINEL-INS-NOTE", recentClaims: "no" }, "edit");
      expect(await store.updateInsurance(both(), C1, id, edit, 1)).toEqual({ kind: "ok", data: { id } });
      expect(await one("oversight_insurance_years", id)).toMatchObject({ policy_year: 1999, recent_claims: false, row_version: 2, updated_by: fx.actingUserId });
      const upd = (await auditRows(id)).filter((r) => r.action === "tenant.oversight_insurance.updated");
      expect(upd).toHaveLength(1);
      expect(upd[0]!.metadata).toMatchObject({ insuranceId: id, policyYear: 1999 });
      expect((upd[0]!.metadata as { changed: string[] }).changed.sort()).toEqual(["policyExpiresOn", "recentClaims"]);

      const before = await snapshot();
      expect(await store.updateInsurance(both(), C1, id, edit, 2)).toEqual({ kind: "ok", data: { id, unchanged: true } });
      expect(await snapshot()).toEqual(before);

      expect(await store.removeInsurance(both(), C1, id)).toEqual({ kind: "ok", data: { id } });
      await expectOneAudit(id, "tenant.oversight_insurance.removed", "oversight_insurance", ["insuranceId", "policyYear"], { policyYear: 1999 });
      expect(await store.updateInsurance(both(), C1, id, edit, 3)).toEqual({ kind: "refused", reason: "not_found" });
      // that year can be recorded again
      expect(await store.recordInsurance(both(), C1, insuranceIn({ policyYear: "1999" }))).toMatchObject({ kind: "ok" });
    });

    it("loans: record as open, edit, the as-of rule, mark paid off (balance 0 and date together), reopen, remove", async () => {
      const rec = await store.recordLoan(both(), C1, loanIn({ lender: "SENTINEL-LENDER", originalAmount: "250000", currentBalance: "123456.78", balanceAsOf: "2026-05-01", grantsAmount: "5000", guaranteeNote: "SENTINEL-GUARANTEE", notes: "SENTINEL-LOAN-NOTE", status: "paid_off" }));
      expect(rec.kind).toBe("ok");
      const id = (rec as { data: { id: string } }).data.id;
      // a new loan is always open, whatever status the form said
      expect(await one("oversight_loans", id)).toMatchObject({ status: "open", paid_off_on: null, kind: "presbytery_program", row_version: 1, created_by: fx.actingUserId });
      expect(String((await one("oversight_loans", id)).current_balance_cents)).toBe("12345678");
      await expectOneAudit(id, "tenant.oversight_loan.recorded", "oversight_loan", ["loanId", "kind"], { loanId: id, kind: "presbytery_program" });

      // a changed balance with the SAME as-of date is invalid on balanceAsOf, and nothing is written
      const before = await snapshot();
      const same = await store.updateLoan(both(), C1, id, loanIn({ lender: "SENTINEL-LENDER", originalAmount: "250000", currentBalance: "100000", balanceAsOf: "2026-05-01", grantsAmount: "5000", guaranteeNote: "SENTINEL-GUARANTEE", notes: "SENTINEL-LOAN-NOTE" }), 1);
      expect(same).toEqual({ kind: "invalid", field: "balanceAsOf", message: 'Update the "as of" date for the new balance.' });
      expect(await snapshot()).toEqual(before);

      const next = loanIn({ lender: "SENTINEL-LENDER", originalAmount: "250000", currentBalance: "100000", balanceAsOf: "2026-06-01", grantsAmount: "5000", guaranteeNote: "SENTINEL-GUARANTEE", notes: "SENTINEL-LOAN-NOTE" });
      expect(await store.updateLoan(both(), C1, id, next, 1)).toEqual({ kind: "ok", data: { id } });
      const upd = (await auditRows(id)).filter((r) => r.action === "tenant.oversight_loan.updated");
      expect(upd).toHaveLength(1);
      expect((upd[0]!.metadata as { changed: string[] }).changed.sort()).toEqual(["balanceAsOf", "currentBalance"]);
      expect(upd[0]!.metadata).toMatchObject({ loanId: id, kind: "presbytery_program" });
      // an unchanged edit writes and audits nothing
      const mid = await snapshot();
      expect(await store.updateLoan(both(), C1, id, next, 2)).toEqual({ kind: "ok", data: { id, unchanged: true } });
      expect(await snapshot()).toEqual(mid);
      // the form saying "paid off" about an open loan is `not_paid_off`
      expect(await store.updateLoan(both(), C1, id, { ...next, status: "paid_off" }, 2)).toEqual({ kind: "refused", reason: "not_paid_off" });

      // paid off: one UPDATE writes the status, the date and a $0 balance as of that date together
      expect(await store.markLoanPaidOff(both(), C1, id, { paidOffOn: "2026-06-10" })).toEqual({ kind: "ok", data: { id } });
      const paid = await one("oversight_loans", id);
      expect(paid).toMatchObject({ status: "paid_off", paid_off_on: "2026-06-10", balance_as_of: "2026-06-10", row_version: 3 });
      expect(String(paid.current_balance_cents)).toBe("0");
      const po = (await auditRows(id)).filter((r) => r.action === "tenant.oversight_loan.paid_off");
      expect(po).toHaveLength(1);
      expect(Object.keys(po[0]!.metadata as object).sort()).toEqual(["aboutOrgId", "kind", "loanId", "organizationId"]);
      expect(await store.markLoanPaidOff(both(), C1, id, { paidOffOn: "2026-06-11" })).toEqual({ kind: "refused", reason: "already_paid_off" });

      // reopen: the status goes back, the date clears, the balance is left as recorded ($0) until edited
      const reopened = await store.updateLoan(both(), C1, id, { ...next, currentBalanceCents: 0, balanceAsOf: "2026-06-10", status: "open" }, 3);
      expect(reopened).toEqual({ kind: "ok", data: { id, reopened: true } });
      const re = await one("oversight_loans", id);
      expect(re).toMatchObject({ status: "open", paid_off_on: null, balance_as_of: "2026-06-10", row_version: 4 });
      expect(String(re.current_balance_cents)).toBe("0");
      const reAudit = (await auditRows(id)).filter((r) => r.action === "tenant.oversight_loan.updated" && (r.metadata as { changed: string[] }).changed.includes("status"));
      expect(reAudit).toHaveLength(1);

      expect(await store.removeLoan(both(), C1, id)).toEqual({ kind: "ok", data: { id } });
      await expectOneAudit(id, "tenant.oversight_loan.removed", "oversight_loan", ["loanId", "kind"], { kind: "presbytery_program" });
      expect(await store.removeLoan(both(), C1, id)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.markLoanPaidOff(both(), C1, id, { paidOffOn: "2026-06-11" })).toEqual({ kind: "refused", reason: "not_found" });
    });

    it("no audit row, in any action, carries a value: sentinels in every free-text, money and address field are found in none", async () => {
      // Drive every write with sentinel values, then read back every oversight audit row about this presbytery.
      const sentinels = ["SENTINEL-ADDR", "SENTINEL-CITY", "SENTINEL-NOTE", "SENTINEL-APPRAISAL-NOTE", "SENTINEL-CARRIER", "SENTINEL-POLICY-9", "SENTINEL-LENDER", "SENTINEL-GUARANTEE", "SENTINEL-LOAN-NOTE", "SENTINEL-INS-NOTE", "SENTINEL-NAME", "98765432", "9876543.21", "123456.78", "12345678", "250000"];
      const marker = await auditCount();
      await store.setProfile(both(), await freshCong(), profileIn({ streetAddress: "SENTINEL-ADDR", city: "SENTINEL-CITY", phone: "614-555-0100" }), null);
      const b = await store.createBuilding(both(), C1, buildingIn({ name: `SENTINEL-NAME ${stamp}`, notes: "SENTINEL-NOTE" }));
      const bid = (b as { data: { id: string } }).data.id;
      await store.updateBuilding(both(), C1, bid, buildingIn({ name: `SENTINEL-NAME ${stamp}`, notes: "SENTINEL-NOTE 2", squareFeet: "12345" }), 1);
      await store.recordAppraisal(both(), C1, bid, appraisalIn({ assessedYear: "2015", amount: "9876543.21", notes: "SENTINEL-APPRAISAL-NOTE" }));
      await store.recordInsurance(both(), C1, insuranceIn({ policyYear: "1980", carrier: "SENTINEL-CARRIER", policyNumber: "SENTINEL-POLICY-9", notes: "SENTINEL-INS-NOTE" }));
      const l = await store.recordLoan(both(), C1, loanIn({ lender: "SENTINEL-LENDER", originalAmount: "250000", currentBalance: "123456.78", balanceAsOf: "2026-05-01", guaranteeNote: "SENTINEL-GUARANTEE", notes: "SENTINEL-LOAN-NOTE" }));
      await store.updateLoan(both(), C1, (l as { data: { id: string } }).data.id, loanIn({ lender: "SENTINEL-LENDER", originalAmount: "250000", currentBalance: "99999", balanceAsOf: "2026-06-01", guaranteeNote: "SENTINEL-GUARANTEE", notes: "SENTINEL-LOAN-NOTE" }), 1);
      expect(await auditCount()).toBeGreaterThan(marker + 5);

      const rows = await q(sql`select action, resource_type, resource_id, metadata from audit_events where action like 'tenant.oversight_%' and metadata->>'organizationId' = ${P}`);
      expect(rows.length).toBeGreaterThan(0);
      const text = JSON.stringify(rows);
      for (const s of sentinels) expect(text, s).not.toContain(s);
      // every metadata value is an id, a boolean, a year, an enumeration or a field name
      for (const row of rows) {
        for (const [k, v] of Object.entries(row.metadata as Record<string, unknown>)) {
          const okValue =
            v === null ||
            typeof v === "boolean" ||
            typeof v === "number" ||
            (typeof v === "string" && (/^[0-9a-f-]{36}$/.test(v) || /^[a-z_]+$/.test(v))) ||
            (Array.isArray(v) && v.every((x) => typeof x === "string" && /^[A-Za-z]+$/.test(x)));
          expect(okValue, `${row.action}.${k}`).toBe(true);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("the audit is in the same transaction (failing-first: an after-commit audit, or an audit on another connection, fails these)", () => {
    const writes: Array<[string, () => Promise<unknown>]> = [];

    async function arrange() {
      writes.length = 0;
      const b = await makeBuilding();
      const bPrimaryless = await makeBuilding();
      const ap = ((await store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2010", amount: "5" }))) as { data: { id: string } }).data.id;
      const ins = await makeInsurance();
      const loan = await makeLoan({ currentBalance: "10", balanceAsOf: "2026-05-01" });
      const loan2 = await makeLoan();
      const profCong = await freshCong();
      await store.setProfile(both(), profCong, profileIn({ city: "Birch" }), null);
      const profVersion = 1;
      const bVersion = Number((await one("oversight_buildings", bPrimaryless)).row_version);
      const insVersion = Number((await one("oversight_insurance_years", ins)).row_version);
      const loanVersion = Number((await one("oversight_loans", loan)).row_version);
      counter += 1;
      writes.push(
        ["setProfile", () => store.setProfile(both(), profCong, profileIn({ city: `Changed ${counter}` }), profVersion)],
        ["createBuilding", () => store.createBuilding(both(), C1, buildingIn({ name: `Fresh ${stamp}-${counter}` }))],
        ["updateBuilding", () => store.updateBuilding(both(), C1, bPrimaryless, buildingIn({ name: `Renamed ${stamp}-${counter}` }), bVersion)],
        ["retireBuilding", () => store.retireBuilding(both(), C1, b, { reason: "sold", retiredOn: "2026-01-01" })],
        ["removeBuilding", () => store.removeBuilding(both(), C1, bPrimaryless)],
        ["recordAppraisal", () => store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2011", amount: "6" }))],
        ["removeAppraisal", () => store.removeAppraisal(both(), C1, b, ap)],
        ["recordInsurance", () => store.recordInsurance(both(), C1, insuranceIn({ policyYear: String(1950 + counter) }))],
        ["updateInsurance", () => store.updateInsurance(both(), C1, ins, insuranceIn({ carrier: `Carrier ${counter}` }, "edit"), insVersion)],
        ["removeInsurance", () => store.removeInsurance(both(), C1, ins)],
        ["recordLoan", () => store.recordLoan(both(), C1, loanIn())],
        ["updateLoan", () => store.updateLoan(both(), C1, loan, loanIn({ lender: `Lender ${counter}`, currentBalance: "10", balanceAsOf: "2026-05-01" }), loanVersion)],
        ["markLoanPaidOff", () => store.markLoanPaidOff(both(), C1, loan2, { paidOffOn: "2026-06-01" })],
        ["removeLoan", () => store.removeLoan(both(), C1, loan2)],
      );
    }

    it("an audit insert that FAILS leaves the data unchanged and refuses with the one fixed save_failed (no data without its audit)", async () => {
      await arrange();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const [name, write] of writes) {
        const before = await snapshot();
        hooks.mode = "fail_before";
        const r = await write();
        hooks.mode = "ok";
        expect(r, name).toEqual({ kind: "refused", reason: "save_failed" });
        expect(await snapshot(), `${name} must leave the data unchanged`).toEqual(before);
      }
      // the log line is the SQLSTATE and nothing else: no message, no id, no content
      for (const call of log.mock.calls) expect(String(call[0])).toBe("[oversight] save failed (sqlstate none)");
    });

    it("an audit insert that SUCCEEDED and then has the transaction fail leaves NO audit row (nothing audited without its change)", async () => {
      await arrange();
      vi.spyOn(console, "error").mockImplementation(() => {});
      for (const [name, write] of writes) {
        const before = await snapshot();
        hooks.mode = "fail_after";
        const r = await write();
        hooks.mode = "ok";
        expect(r, name).toEqual({ kind: "refused", reason: "save_failed" });
        expect(await snapshot(), `${name}: neither the data nor its audit row may survive`).toEqual(before);
      }
    });

    it("the same writes succeed once the audit does (the control: the sabotage hooks, not the data, were the failure)", async () => {
      await arrange();
      for (const [name, write] of writes) {
        const before = await auditCount();
        const r = (await write()) as { kind: string };
        expect(r.kind, name).toBe("ok");
        expect(await auditCount(), `${name} writes exactly one audit row`).toBe(before + 1);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("optimistic concurrency by row_version (failing-first: dropping the version check or its WHERE fails these)", () => {
    it("a stale edit writes nothing and audits nothing, on all four editable tables", async () => {
      const cong = await freshCong();
      expect((await store.setProfile(both(), cong, profileIn({ city: "V1" }), null)).kind).toBe("ok");
      expect((await store.setProfile(both(), cong, profileIn({ city: "V2" }), 1)).kind).toBe("ok");
      const b = await makeBuilding();
      const ins = await makeInsurance();
      const loan = await makeLoan();
      // move each row's version on by one honest edit
      await store.updateBuilding(both(), C1, b, buildingIn({ name: `Bumped ${stamp}` }), 1);
      await store.updateInsurance(both(), C1, ins, insuranceIn({ carrier: "Bumped" }, "edit"), 1);
      await store.updateLoan(both(), C1, loan, loanIn({ lender: "Bumped" }), 1);

      const before = await snapshot();
      expect(await store.setProfile(both(), cong, profileIn({ city: "Stale" }), 1)).toEqual({ kind: "refused", reason: "stale" });
      expect(await store.updateBuilding(both(), C1, b, buildingIn({ name: `Stale ${stamp}` }), 1)).toEqual({ kind: "refused", reason: "stale" });
      expect(await store.updateInsurance(both(), C1, ins, insuranceIn({ carrier: "Stale" }, "edit"), 1)).toEqual({ kind: "refused", reason: "stale" });
      expect(await store.updateLoan(both(), C1, loan, loanIn({ lender: "Stale" }), 1)).toEqual({ kind: "refused", reason: "stale" });
      expect(await snapshot()).toEqual(before);
    });

    it("two simultaneous edits of one version end with one write and one `stale`, on all four editable tables", async () => {
      const cong = await freshCong();
      expect((await store.setProfile(both(), cong, profileIn({ city: "Race" }), null)).kind).toBe("ok");
      const profVersion = 1;
      const b = await makeBuilding();
      const ins = await makeInsurance();
      const loan = await makeLoan();
      const results = {
        profile: await Promise.all([store.setProfile(both(), cong, profileIn({ city: "Race A" }), profVersion), store.setProfile(both(), cong, profileIn({ city: "Race B" }), profVersion)]),
        building: await Promise.all([store.updateBuilding(both(), C1, b, buildingIn({ name: `A ${stamp}` }), 1), store.updateBuilding(both(), C1, b, buildingIn({ name: `B ${stamp}` }), 1)]),
        insurance: await Promise.all([store.updateInsurance(both(), C1, ins, insuranceIn({ carrier: "A" }, "edit"), 1), store.updateInsurance(both(), C1, ins, insuranceIn({ carrier: "B" }, "edit"), 1)]),
        loan: await Promise.all([store.updateLoan(both(), C1, loan, loanIn({ lender: "A" }), 1), store.updateLoan(both(), C1, loan, loanIn({ lender: "B" }), 1)]),
      };
      for (const [name, pair] of Object.entries(results)) {
        const kinds = pair.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort();
        expect(kinds, name).toEqual(["ok", "stale"]);
      }
      // exactly one version step each, and one audit row for the winner
      expect(Number((await one("oversight_buildings", b)).row_version)).toBe(2);
      expect(Number((await one("oversight_insurance_years", ins)).row_version)).toBe(2);
      expect(Number((await one("oversight_loans", loan)).row_version)).toBe(2);
      expect((await auditRows(b)).filter((r) => r.action === "tenant.oversight_building.updated")).toHaveLength(1);
      expect((await auditRows(loan)).filter((r) => r.action === "tenant.oversight_loan.updated")).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe("ids: another presbytery, another congregation, a removed row and the about-org trigger", () => {
    it("a congregation of another presbytery, or one that is not a member, is `not_found` for every write; another congregation's building is `not_found`", async () => {
      const bC2 = await makeBuilding(C2);
      const bC1 = await makeBuilding(C1);
      const before = await snapshot();
      expect(await store.createBuilding(both(), CX, buildingIn({ name: `x ${stamp}` }))).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.setProfile(both(), CX, profileIn({ city: "x" }), null)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.recordInsurance(both(), CX, insuranceIn())).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.recordLoan(both(), CX, loanIn())).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.createBuilding(both(), CN, buildingIn({ name: `x ${stamp}` }))).toEqual({ kind: "refused", reason: "not_found" });
      // C2's building addressed under C1, in every operation that names a building
      expect(await store.updateBuilding(both(), C1, bC2, buildingIn({ name: "x" }), 1)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.retireBuilding(both(), C1, bC2, { reason: "sold", retiredOn: "2026-01-01" })).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removeBuilding(both(), C1, bC2)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.recordAppraisal(both(), C1, bC2, appraisalIn())).toEqual({ kind: "refused", reason: "not_found" });
      // an appraisal of C1's building cannot be removed through C2
      const ap = ((await store.recordAppraisal(both(), C1, bC1, appraisalIn({ assessedYear: "2005" }))) as { data: { id: string } }).data.id;
      expect(await store.removeAppraisal(both(), C2, bC1, ap)).toEqual({ kind: "refused", reason: "not_found" });
      // insurance and loan ids of C1 addressed under C2
      const ins = await makeInsurance();
      const loan = await makeLoan();
      expect(await store.updateInsurance(both(), C2, ins, insuranceIn({ carrier: "x" }, "edit"), 1)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removeInsurance(both(), C2, ins)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.updateLoan(both(), C2, loan, loanIn({ lender: "x" }), 1)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.markLoanPaidOff(both(), C2, loan, { paidOffOn: "2026-01-01" })).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removeLoan(both(), C2, loan)).toEqual({ kind: "refused", reason: "not_found" });
      // one string for all of them: an id that does not exist at all
      const nowhere = "00000000-0000-4000-8000-0000000000ff";
      expect(await store.updateBuilding(both(), C1, nowhere, buildingIn({ name: "x" }), 1)).toEqual({ kind: "refused", reason: "not_found" });
      // The only rows written since the snapshot are the three fixtures made above (ap, ins, loan): no refusal wrote anything.
      const after = (await snapshot()) as { audit: Array<{ n: number }> };
      expect(after.audit[0]!.n).toBe((before as { audit: Array<{ n: number }> }).audit[0]!.n + 3);
    });

    it("another presbytery's person cannot write at this one (not a member: forbidden), and writes at their own presbytery cannot name this one's congregation", async () => {
      const before = await snapshot();
      expect(await store.createBuilding(ctxFor(person.other, P), C1, buildingIn({ name: `x ${stamp}` }))).toEqual({ kind: "refused", reason: "forbidden" });
      // at their own presbytery, C1 is not a member congregation: not_found
      expect(await store.createBuilding(ctxFor(person.other, P2), C1, buildingIn({ name: `x ${stamp}` }))).toEqual({ kind: "refused", reason: "not_found" });
      expect(await snapshot()).toEqual(before);
    });

    it("the about-org trigger's refusal (a congregation never affiliated) maps to `not_found`, with nothing written", async () => {
      hooks.pretendMember = CN;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const before = await snapshot();
      expect(await store.createBuilding(both(), CN, buildingIn({ name: `x ${stamp}` }))).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.setProfile(both(), CN, profileIn({ city: "x" }), null)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.recordInsurance(both(), CN, insuranceIn())).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.recordLoan(both(), CN, loanIn())).toEqual({ kind: "refused", reason: "not_found" });
      expect(await snapshot()).toEqual(before);
      expect(console.error).not.toHaveBeenCalled();
    });

    it("a building removed concurrently with an appraisal: the database guard's refusal is `building_removed` or `not_found`, and the appraisal is never recorded on a removed building", async () => {
      for (let i = 0; i < 4; i += 1) {
        const b = await makeBuilding();
        const [removal, record] = await Promise.all([
          store.removeBuilding(both(), C1, b),
          store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2012", amount: "7" })),
        ]);
        expect(removal.kind).toBe("ok");
        if (record.kind !== "ok") expect(["building_removed", "not_found"]).toContain((record as { reason: string }).reason);
        // whichever order, a live appraisal never hangs off a removed building without having been recorded first
        const rows = await q(sql`select a.id from oversight_building_appraisals a join oversight_buildings b on b.id = a.building_id where b.id = ${b} and a.removed_at is null`);
        expect(rows.length).toBe(record.kind === "ok" ? 1 : 0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("concurrency (failing-first: dropping the primary lock fails the primary cases)", () => {
    it("two simultaneous creates of one live building name end with one row and one `duplicate_name`", async () => {
      const name = `Twin ${stamp}`;
      const results = await Promise.all([store.createBuilding(both(), C1, buildingIn({ name })), store.createBuilding(both(), C1, buildingIn({ name: name.toUpperCase() }))]);
      const kinds = results.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort();
      expect(kinds).toEqual(["duplicate_name", "ok"]);
      expect(await q(sql`select count(*)::int as n from oversight_buildings where organization_id = ${P} and about_org_id = ${C1} and lower(name) = lower(${name}) and removed_at is null`)).toEqual([{ n: 1 }]);
      // the loser left no audit row
      const winner = results.find((r) => r.kind === "ok") as { data: { id: string } };
      expect((await q(sql`select count(*)::int as n from audit_events where action = 'tenant.oversight_building.created' and metadata->>'organizationId' = ${P} and resource_id = ${winner.data.id}`))[0]!.n).toBe(1);
      // a removed name is reusable
      expect(await store.removeBuilding(both(), C1, winner.data.id)).toMatchObject({ kind: "ok" });
      expect(await store.createBuilding(both(), C1, buildingIn({ name }))).toMatchObject({ kind: "ok" });
    });

    it("two simultaneous \"make primary\" on different buildings end with exactly one primary and no error", async () => {
      for (let round = 0; round < 3; round += 1) {
        const x = await makeBuilding(C2);
        const y = await makeBuilding(C2);
        const [rx, ry] = await Promise.all([
          store.updateBuilding(both(), C2, x, buildingIn({ name: String((await one("oversight_buildings", x)).name), primary: true }), 1),
          store.updateBuilding(both(), C2, y, buildingIn({ name: String((await one("oversight_buildings", y)).name), primary: true }), 1),
        ]);
        expect([rx.kind, ry.kind], `round ${round}`).toEqual(["ok", "ok"]);
        expect(await q(sql`select count(*)::int as n from oversight_buildings where organization_id = ${P} and about_org_id = ${C2} and is_primary and removed_at is null`)).toEqual([{ n: 1 }]);
        // tidy: the next round starts with a primary that this round's pair will demote
      }
    });

    it("three simultaneous creates, each primary, end with exactly one primary and no error", async () => {
      const results = await Promise.all([
        store.createBuilding(both(), C2, buildingIn({ name: `P1 ${stamp}`, primary: true })),
        store.createBuilding(both(), C2, buildingIn({ name: `P2 ${stamp}`, primary: true })),
        store.createBuilding(both(), C2, buildingIn({ name: `P3 ${stamp}`, primary: true })),
      ]);
      expect(results.map((r) => r.kind)).toEqual(["ok", "ok", "ok"]);
      expect(await q(sql`select count(*)::int as n from oversight_buildings where organization_id = ${P} and about_org_id = ${C2} and is_primary and removed_at is null`)).toEqual([{ n: 1 }]);
    });

    it("two simultaneous records for one insurance year, or one appraisal year, end with one winner", async () => {
      const ins = await Promise.all([store.recordInsurance(both(), C1, insuranceIn({ policyYear: "1971" })), store.recordInsurance(both(), C1, insuranceIn({ policyYear: "1971" }))]);
      expect(ins.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort()).toEqual(["duplicate_policy_year", "ok"]);
      expect(await q(sql`select count(*)::int as n from oversight_insurance_years where organization_id = ${P} and about_org_id = ${C1} and policy_year = 1971 and removed_at is null`)).toEqual([{ n: 1 }]);

      const b = await makeBuilding();
      const ap = await Promise.all([store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "1972", amount: "1" })), store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "1972", amount: "2" }))]);
      expect(ap.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort()).toEqual(["duplicate_appraisal_year", "ok"]);
    });

    it("two simultaneous first saves of a profile end with one profile and one `stale`", async () => {
      const cong = await freshCong();
      const results = await Promise.all([store.setProfile(both(), cong, profileIn({ city: "First A" }), null), store.setProfile(both(), cong, profileIn({ city: "First B" }), null)]);
      expect(results.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort()).toEqual(["ok", "stale"]);
      expect(await q(sql`select count(*)::int as n from oversight_profiles where organization_id = ${P} and about_org_id = ${cong}`)).toEqual([{ n: 1 }]);
    });
  });

  // ---------------------------------------------------------------------------
  it("a tenant write never sets provenance, and the database default is presbytery_entered on every table it writes", async () => {
    const b = await makeBuilding();
    const ap = ((await store.recordAppraisal(both(), C1, b, appraisalIn({ assessedYear: "2003" }))) as { data: { id: string } }).data.id;
    const ins = await makeInsurance();
    const loan = await makeLoan();
    expect((await one("oversight_buildings", b)).provenance).toBe("presbytery_entered");
    expect((await one("oversight_building_appraisals", ap)).provenance).toBe("presbytery_entered");
    expect((await one("oversight_insurance_years", ins)).provenance).toBe("presbytery_entered");
    expect((await one("oversight_loans", loan)).provenance).toBe("presbytery_entered");
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./store.ts", import.meta.url), "utf8"));
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")).not.toMatch(/\bprovenance\b/);
  });
});
