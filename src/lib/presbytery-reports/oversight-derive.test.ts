import { describe, expect, it } from "vitest";
import type {
  AppraisalReportFact,
  BuildingReportFact,
  BuildingsReportFacts,
  InsuranceLoansReportFacts,
  InsuranceReportFact,
  OpenLoanReportFact,
} from "@/lib/oversight/report-facts";
import { deriveBuildings, deriveInsuranceLoans } from "./oversight-derive";

const A = { id: "a", name: "Alder Creek" };
const B = { id: "b", name: "Bramblewood" };
const C = { id: "c", name: "Cedar Hollow" };
const TODAY = "2026-06-15";

let seq = 0;
const building = (aboutOrgId: string, over: Partial<BuildingReportFact> = {}): BuildingReportFact => ({
  id: `bl${String(++seq).padStart(3, "0")}`,
  aboutOrgId,
  name: "Sanctuary",
  buildingType: "sanctuary",
  yearBuilt: null,
  firstAdditionYear: null,
  secondAdditionYear: null,
  squareFeet: null,
  roofCondition: null,
  plumbingCondition: null,
  hvacCondition: null,
  boilerCondition: null,
  hasSprinklers: null,
  hasFireAlarm: null,
  hasSecuritySystem: null,
  isPrimary: false,
  ...over,
});
const facts = (over: Partial<BuildingsReportFacts> = {}): BuildingsReportFacts => ({ profiles: [], buildings: [], retiredCounts: [], ...over });

describe("deriveBuildings", () => {
  it("carries the retired count on a congregation with none in use, so the page can say None in use or Not recorded", () => {
    const data = deriveBuildings([A, B, C], facts({ buildings: [building("a")], retiredCounts: [{ aboutOrgId: "b", retired: 2 }, { aboutOrgId: "a", retired: 1 }] }));
    expect(data.rows.map((r) => [r.name, r.building?.name ?? null, r.buildingsRetired])).toEqual([
      ["Alder Creek", "Sanctuary", 1],
      ["Bramblewood", null, 2],
      ["Cedar Hollow", null, 0],
    ]);
  });

  it("lists every roster congregation in roster order; one with no building is one line with building null", () => {
    const data = deriveBuildings([A, B, C], facts({ buildings: [building("c", { name: "Hall" }), building("a")] }));
    expect(data.rows.map((r) => [r.name, r.building?.name ?? null])).toEqual([
      ["Alder Creek", "Sanctuary"],
      ["Bramblewood", null],
      ["Cedar Hollow", "Hall"],
    ]);
    expect(data.rosterCount).toBe(3);
    expect(data.withoutBuildings).toBe(1);
    expect(data.buildingCount).toBe(2);
  });

  it("puts the primary first, then by name ignoring case, then id", () => {
    const data = deriveBuildings(
      [A],
      facts({
        buildings: [
          building("a", { name: "manse" }),
          building("a", { name: "Annex" }),
          building("a", { name: "Sanctuary", isPrimary: true }),
          building("a", { name: "Office" }),
        ],
      }),
    );
    expect(data.rows.map((r) => r.building?.name)).toEqual(["Sanctuary", "Annex", "manse", "Office"]);
  });

  it("repeats the congregation's city and county on each of its lines; none recorded is null", () => {
    const data = deriveBuildings(
      [A, B],
      facts({
        profiles: [{ aboutOrgId: "a", city: "Alderton", county: "Marsh" }],
        buildings: [building("a"), building("a", { name: "Hall" }), building("b")],
      }),
    );
    expect(data.rows.map((r) => [r.city, r.county])).toEqual([
      ["Alderton", "Marsh"],
      ["Alderton", "Marsh"],
      [null, null],
    ]);
  });

  it("ignores a fact about an organization that is not on the roster (a departed or foreign congregation)", () => {
    const data = deriveBuildings(
      [A],
      facts({
        profiles: [{ aboutOrgId: "z", city: "Elsewhere", county: "Nowhere" }],
        buildings: [building("z", { name: "Foreign" })],
      }),
    );
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].building).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/Foreign|Elsewhere/);
  });

  it("an empty roster is an empty report", () => {
    expect(deriveBuildings([], facts())).toEqual({ rosterCount: 0, rows: [], withoutBuildings: 0, buildingCount: 0 });
  });
});

const policy = (aboutOrgId: string, over: Partial<InsuranceReportFact> = {}): InsuranceReportFact => ({
  aboutOrgId,
  policyYear: 2025,
  carrier: "Example Mutual",
  policyExpiresOn: "2026-09-01",
  recentClaims: null,
  poolInterest: null,
  ...over,
});
const loan = (aboutOrgId: string, over: Partial<OpenLoanReportFact> = {}): OpenLoanReportFact => ({
  id: `ln${String(++seq).padStart(3, "0")}`,
  aboutOrgId,
  originalAmountCents: null,
  currentBalanceCents: null,
  grantsAmountCents: null,
  guaranteeNote: null,
  ...over,
});
const apprs = (buildingId: string, aboutOrgId: string, amountCents: number): AppraisalReportFact => ({
  buildingId,
  aboutOrgId,
  amountCents,
});
const il = (over: Partial<InsuranceLoansReportFacts> = {}): InsuranceLoansReportFacts => ({
  insurance: [],
  openLoans: [],
  buildings: [],
  appraisals: [],
  ...over,
});

describe("deriveInsuranceLoans", () => {
  it("one row per roster congregation, with or without records, and none for another organization", () => {
    const data = deriveInsuranceLoans(
      [A, B],
      il({ insurance: [policy("a"), policy("z", { carrier: "Foreign" })], openLoans: [loan("z")] }),
      TODAY,
    );
    expect(data.rows.map((r) => r.name)).toEqual(["Alder Creek", "Bramblewood"]);
    expect(data.rows[1]).toMatchObject({
      insurance: null,
      openLoans: 0,
      originalCents: null,
      balanceCents: null,
      grantsCents: null,
      appraisedCents: null,
    });
    expect(JSON.stringify(data)).not.toContain("Foreign");
  });

  it("measures expiry against the injected today: today is current, yesterday is expired, none is none", () => {
    const data = deriveInsuranceLoans(
      [A, B, C],
      il({
        insurance: [
          policy("a", { policyExpiresOn: TODAY }),
          policy("b", { policyExpiresOn: "2026-06-14" }),
          policy("c", { policyExpiresOn: null }),
        ],
      }),
      TODAY,
    );
    expect(data.rows.map((r) => r.insurance?.expiry)).toEqual(["current", "expired", "none"]);
    expect(data.today).toBe(TODAY);
  });

  it("sums only the recorded figures, counts the unrecorded, and never shows a false zero", () => {
    const data = deriveInsuranceLoans(
      [A, B],
      il({
        openLoans: [
          loan("a", { originalAmountCents: 1000, currentBalanceCents: 400, grantsAmountCents: null }),
          loan("a", { originalAmountCents: null, currentBalanceCents: null, grantsAmountCents: null }),
          loan("b", { originalAmountCents: 500, currentBalanceCents: 0, grantsAmountCents: 100 }),
        ],
      }),
      TODAY,
    );
    const [a, b] = data.rows;
    expect(a).toMatchObject({
      openLoans: 2,
      originalCents: 1000,
      originalUnrecorded: 1,
      balanceCents: 400,
      balanceUnrecorded: 1,
      grantsCents: null,
      grantsUnrecorded: 2,
    });
    expect(b).toMatchObject({ openLoans: 1, originalCents: 500, balanceCents: 0, grantsCents: 100, balanceUnrecorded: 0 });
    expect(data.totals).toEqual({
      openLoans: 3,
      originalCents: 1500,
      balanceCents: 400,
      grantsCents: 100,
      originalUnrecorded: 1,
      balanceUnrecorded: 1,
      grantsUnrecorded: 2,
      appraisedCents: null,
      buildingsWithoutAppraisal: 0,
    });
  });

  it("a recorded zero balance is 0, a missing one is null (the two are different)", () => {
    const data = deriveInsuranceLoans([A, B], il({ openLoans: [loan("a", { currentBalanceCents: 0 }), loan("b")] }), TODAY);
    expect(data.rows[0].balanceCents).toBe(0);
    expect(data.rows[1].balanceCents).toBeNull();
  });

  it("the guarantee texts of the open loans, trimmed, blanks left out, in the order recorded", () => {
    const data = deriveInsuranceLoans(
      [A],
      il({
        openLoans: [
          loan("a", { guaranteeNote: "  Presbytery guarantee " }),
          loan("a", { guaranteeNote: "   " }),
          loan("a", { guaranteeNote: null }),
          loan("a", { guaranteeNote: "Second" }),
        ],
      }),
      TODAY,
    );
    expect(data.rows[0].guarantees).toEqual(["Presbytery guarantee", "Second"]);
  });

  it("appraised value is the sum of each in-use building's newest appraisal; the rest are counted as without one", () => {
    const b1 = building("a");
    const b2 = building("a", { name: "Hall" });
    const b3 = building("a", { name: "Manse" });
    const data = deriveInsuranceLoans(
      [A, B],
      il({
        buildings: [b1, b2, b3, building("b")],
        appraisals: [apprs(b1.id, "a", 90_000_000), apprs(b2.id, "a", 10_000_000)],
      }),
      TODAY,
    );
    expect(data.rows[0]).toMatchObject({ appraisedCents: 100_000_000, buildingsWithoutAppraisal: 1 });
    expect(data.rows[1]).toMatchObject({ appraisedCents: null, buildingsWithoutAppraisal: 1 });
    expect(data.totals).toMatchObject({ appraisedCents: 100_000_000, buildingsWithoutAppraisal: 2 });
  });

  it("a congregation with no building in use has no appraisal and none missing", () => {
    const data = deriveInsuranceLoans([A], il(), TODAY);
    expect(data.rows[0]).toMatchObject({ appraisedCents: null, buildingsWithoutAppraisal: 0 });
  });

  it("an appraisal of a building that is not in the in-use list (retired or removed) is not counted", () => {
    const live = building("a");
    const data = deriveInsuranceLoans(
      [A],
      il({ buildings: [live], appraisals: [apprs(live.id, "a", 500), apprs("retired-one", "a", 999_999)] }),
      TODAY,
    );
    expect(data.rows[0]).toMatchObject({ appraisedCents: 500, buildingsWithoutAppraisal: 0 });
  });

  it("refuses a presbytery-wide total that is not a safe integer rather than rounding", () => {
    expect(() =>
      deriveInsuranceLoans(
        [A, B],
        il({ openLoans: [loan("a", { originalAmountCents: Number.MAX_SAFE_INTEGER }), loan("b", { originalAmountCents: 10 })] }),
        TODAY,
      ),
    ).toThrow(RangeError);
  });
});
