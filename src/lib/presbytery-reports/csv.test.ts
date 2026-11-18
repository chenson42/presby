import { describe, expect, it } from "vitest";
import { buildGiftsCsv } from "@/lib/giving/csv";
import { buildRequestsCsv } from "@/lib/reimbursement/csv-shape";
import {
  BUILDINGS_HEADER,
  CSV_BOM,
  INSURANCE_LOANS_HEADER,
  MEMBERSHIP_TREND_HEADER,
  PER_CAPITA_HEADER,
  VACANT_PULPITS_HEADER,
  VIABILITY_HEADER,
  buildBuildingsCsv,
  buildInsuranceLoansCsv,
  buildMembershipTrendCsv,
  buildPerCapitaCsv,
  buildVacantPulpitsCsv,
  buildViabilityCsv,
} from "./csv";
import type { MembershipTrendData, PerCapitaData, PerCapitaRow, VacantPulpitsData, ViabilityData } from "./derive";
import type { BuildingsData, BuildingsRow, InsuranceLoansData, InsuranceLoansRow } from "./oversight-derive";

const BOM_BYTES = [0xef, 0xbb, 0xbf];
const bytesOf = (s: string) => Array.from(new TextEncoder().encode(s));

const vacant = (rows: VacantPulpitsData["rows"]): VacantPulpitsData => ({ today: "2026-06-15", rosterCount: rows.length, appointmentsRecorded: true, rows });
const trend = (rows: MembershipTrendData["rows"], years = [2024, 2025]): MembershipTrendData => ({
  from: years[0],
  to: years[years.length - 1],
  years,
  rosterCount: rows.length,
  rows,
  footer: [],
  hasData: true,
});
const viability = (rows: ViabilityData["rows"]): ViabilityData => ({ rosterCount: rows.length, rows, anyNotAssessed: false });
const perCapita = (rows: PerCapitaRow[]): PerCapitaData => ({
  billingYear: 2025,
  rateBasisYear: 2023,
  rosterCount: rows.length,
  rows,
  totals: { billedCents: 0, paidCents: 0, outstandingCents: 0 },
  anyBillsAnyYear: true,
});
const buildingsData = (rows: BuildingsRow[]): BuildingsData => ({
  rosterCount: rows.length,
  rows,
  withoutBuildings: rows.filter((r) => r.building === null).length,
  buildingCount: rows.filter((r) => r.building !== null).length,
});
const bRow = (over: Partial<BuildingsRow> = {}, building: Partial<NonNullable<BuildingsRow["building"]>> | null = {}): BuildingsRow => ({
  organizationId: "a",
  name: "Alder Creek",
  city: "Alderton",
  county: "Marsh",
  buildingsRetired: 0,
  building:
    building === null
      ? null
      : {
          id: "b1",
          aboutOrgId: "a",
          name: "Sanctuary",
          buildingType: "sanctuary",
          yearBuilt: 1902,
          firstAdditionYear: 1950,
          secondAdditionYear: null,
          squareFeet: 12500,
          roofCondition: "good",
          plumbingCondition: "fair",
          hvacCondition: "poor",
          boilerCondition: null,
          hasSprinklers: true,
          hasFireAlarm: false,
          hasSecuritySystem: null,
          isPrimary: true,
          ...building,
        },
  ...over,
});
const insuranceLoansData = (rows: InsuranceLoansRow[]): InsuranceLoansData => ({
  today: "2026-06-15",
  rosterCount: rows.length,
  rows,
  totals: {
    openLoans: 0,
    originalCents: null,
    balanceCents: null,
    grantsCents: null,
    originalUnrecorded: 0,
    balanceUnrecorded: 0,
    grantsUnrecorded: 0,
    appraisedCents: null,
    buildingsWithoutAppraisal: 0,
  },
});
const ilRow = (over: Partial<InsuranceLoansRow> = {}): InsuranceLoansRow => ({
  organizationId: "a",
  name: "Alder Creek",
  insurance: {
    policyYear: 2025,
    carrier: "Example Mutual",
    policyExpiresOn: "2026-09-01",
    expiry: "current",
    recentClaims: false,
    poolInterest: true,
  },
  openLoans: 1,
  originalCents: 25000000,
  balanceCents: 18125050,
  grantsCents: 500000,
  originalUnrecorded: 0,
  balanceUnrecorded: 0,
  grantsUnrecorded: 0,
  guarantees: ["Guaranteed up to the original amount"],
  appraisedCents: 120000000,
  buildingsWithoutAppraisal: 0,
  ...over,
});

const pcRow = (over: Partial<PerCapitaRow>): PerCapitaRow => ({
  billingYear: 2025,
  organizationId: "a",
  name: "Alder Creek",
  membership: "member",
  basisYear: 2023,
  endingActiveBasis: 100,
  rateApplied: "26.25",
  billedCents: 262500,
  paidCents: 0,
  outstandingCents: 262500,
  status: "unpaid",
  paidOn: null,
  notBilledReason: null,
  ...over,
});

describe("the headers, pinned verbatim", () => {
  it("vacant pulpits", () => {
    expect(VACANT_PULPITS_HEADER.join(",")).toBe("congregation,vacant_since,days_vacant,supply_call_type,supply_starts_on");
  });
  it("membership trend", () => {
    expect(MEMBERSHIP_TREND_HEADER.join(",")).toBe("congregation,year,ending_active,source");
  });
  it("viability states the scale in the score column", () => {
    expect(VIABILITY_HEADER.join(",")).toBe(
      "congregation,viability_label,viability_score_1_at_risk_3_healthy,redevelopment_notes,last_updated",
    );
  });
  it("per capita", () => {
    expect(PER_CAPITA_HEADER.join(",")).toBe(
      "billing_year,congregation,membership,basis_year,ending_active_basis,rate_per_member,billed,paid,outstanding,payment_status,paid_on,note",
    );
  });
  it("buildings (DECISION-348, C15)", () => {
    expect(BUILDINGS_HEADER.join(",")).toBe(
      "congregation,city,county,building,building_type,year_built,first_addition_year,second_addition_year,square_feet,roof_condition,plumbing_condition,hvac_condition,boiler_condition,sprinklers,fire_alarm,security_system,primary",
    );
  });
  it("insurance and loans (DECISION-348, C15)", () => {
    expect(INSURANCE_LOANS_HEADER.join(",")).toBe(
      "congregation,carrier,policy_year,policy_expires_on,recent_claims,pool_interest,open_loans,original_amount,balance,balance_unrecorded_loans,grants,guarantee,appraised_value,buildings_without_appraisal",
    );
  });
  it("neither oversight header names a street address, policy number, note, lender or photo", () => {
    for (const h of [...BUILDINGS_HEADER, ...INSURANCE_LOANS_HEADER]) {
      expect(h).not.toMatch(/street|address|policy_number|note|lender|photo|caption/i);
    }
  });
  it("no header names an email, address, phone, coordinate or person", () => {
    for (const h of [
      ...VACANT_PULPITS_HEADER,
      ...MEMBERSHIP_TREND_HEADER,
      ...VIABILITY_HEADER,
      ...PER_CAPITA_HEADER,
      ...BUILDINGS_HEADER,
      ...INSURANCE_LOANS_HEADER,
    ]) {
      expect(h).not.toMatch(/email|address|phone|street|zip|latitude|longitude|coordinate|person|minister|pastor_name/i);
    }
  });
});

describe("the byte-order mark", () => {
  const files = {
    vacant: buildVacantPulpitsCsv(vacant([])),
    trend: buildMembershipTrendCsv(trend([])),
    viability: buildViabilityCsv(viability([])),
    perCapita: buildPerCapitaCsv(perCapita([])),
    buildings: buildBuildingsCsv(buildingsData([])),
    insuranceLoans: buildInsuranceLoansCsv(insuranceLoansData([])),
  };

  it.each(Object.entries(files))("%s starts with EF BB BF, then the header", (_name, csv) => {
    expect(bytesOf(csv).slice(0, 3)).toEqual(BOM_BYTES);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charAt(1)).toBe(csv.charAt(1).toLowerCase()); // a header letter follows
  });

  it("is exactly one BOM (not doubled)", () => {
    for (const csv of Object.values(files)) expect(csv.startsWith(`${CSV_BOM}${CSV_BOM}`)).toBe(false);
  });

  it("the giving gifts and reimbursement files do not start with it", () => {
    expect(bytesOf(buildGiftsCsv([])).slice(0, 3)).not.toEqual(BOM_BYTES);
    expect(bytesOf(buildRequestsCsv([])).slice(0, 3)).not.toEqual(BOM_BYTES);
  });

  it("an empty report is the header line only, CRLF-terminated", () => {
    expect(files.vacant).toBe(`${CSV_BOM}congregation,vacant_since,days_vacant,supply_call_type,supply_starts_on\r\n`);
    expect(files.trend).toBe(`${CSV_BOM}congregation,year,ending_active,source\r\n`);
  });
});

describe("vacant pulpits file", () => {
  it("writes ISO dates, the day count as a number and the supply label", () => {
    const csv = buildVacantPulpitsCsv(
      vacant([
        { organizationId: "a", name: "Alder Creek", vacantSince: "2024-03-15", daysVacant: 822, supply: { callType: "interim_pastor", startsOn: "2025-01-02" } },
        { organizationId: "b", name: "Bramblewood", vacantSince: null, daysVacant: null, supply: null },
      ]),
    );
    expect(csv.slice(1)).toBe(
      [
        "congregation,vacant_since,days_vacant,supply_call_type,supply_starts_on",
        "Alder Creek,2024-03-15,822,Interim Pastor,2025-01-02",
        "Bramblewood,,,,",
        "",
      ].join("\r\n"),
    );
  });

  it("refuses a supply row that is not a supply call type", () => {
    expect(() =>
      buildVacantPulpitsCsv(vacant([{ organizationId: "a", name: "A", vacantSince: null, daysVacant: null, supply: { callType: "installed_pastor", startsOn: "2025-01-02" } }])),
    ).toThrow();
  });
});

describe("text cells are formula-guarded and quoted", () => {
  const lead = ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"];

  it.each(lead)("a congregation name beginning %j is apostrophe-prefixed in all four files", (name) => {
    const quoted = (csv: string) => csv.slice(1).split("\r\n")[1];
    const guarded = (cell: string) => cell.startsWith(`'${name}`) || cell.startsWith(`"'${name}`);
    expect(guarded(quoted(buildVacantPulpitsCsv(vacant([{ organizationId: "a", name, vacantSince: null, daysVacant: null, supply: null }]))))).toBe(true);
    expect(guarded(quoted(buildViabilityCsv(viability([{ organizationId: "a", name, score: 2, label: "Fair", notes: null, lastUpdated: null }]))))).toBe(true);
    expect(guarded(quoted(buildMembershipTrendCsv(trend([{ organizationId: "a", name, cells: [{ kind: "no_data" }, { kind: "no_data" }] }]))))).toBe(true);
    expect(guarded(quoted(buildPerCapitaCsv(perCapita([pcRow({ name })]))).split(",").slice(1).join(","))).toBe(true);
  });

  it("quotes commas, double quotes, CR and LF in a name and in notes", () => {
    const csv = buildViabilityCsv(
      viability([{ organizationId: "a", name: 'First, "Old" Church', score: 1, label: "At risk", notes: "Roof\nand, \"boiler\"\r\nurgent", lastUpdated: "2026-02-02" }]),
    );
    expect(csv).toContain('"First, ""Old"" Church",At risk,1,"Roof\nand, ""boiler""\r\nurgent",2026-02-02\r\n');
  });

  it("keeps accented names intact (the BOM exists for them)", () => {
    expect(buildViabilityCsv(viability([{ organizationId: "a", name: "Église Réformée", score: 2, label: "Fair", notes: null, lastUpdated: null }]))).toContain("Église Réformée,Fair,2,,\r\n");
  });
});

describe("membership trend file", () => {
  it("is long form: one row per congregation and year inside the window, with provenance; a dash year has no row", () => {
    const csv = buildMembershipTrendCsv(
      trend(
        [
          {
            organizationId: "a",
            name: "Alder Creek",
            cells: [{ kind: "not_member" }, { kind: "value", endingActive: 120, source: "published_by_congregation" }],
          },
          { organizationId: "b", name: "Bramblewood", cells: [{ kind: "no_data" }, { kind: "value", endingActive: null, source: "imported" }] },
        ],
        [2024, 2025],
      ),
    );
    expect(csv.slice(1).split("\r\n")).toEqual([
      "congregation,year,ending_active,source",
      "Alder Creek,2025,120,published_by_congregation",
      "Bramblewood,2024,,no_data",
      "Bramblewood,2025,,imported",
      "",
    ]);
  });
});

describe("viability file", () => {
  it("carries both the label and the score, notes, and the date", () => {
    const csv = buildViabilityCsv(
      viability([
        { organizationId: "a", name: "Alder Creek", score: 1, label: "At risk", notes: "Roof", lastUpdated: "2026-02-02" },
        { organizationId: "b", name: "Bramblewood", score: null, label: "Not yet assessed", notes: null, lastUpdated: null },
      ]),
    );
    expect(csv.slice(1).split("\r\n").slice(1, 3)).toEqual(["Alder Creek,At risk,1,Roof,2026-02-02", "Bramblewood,Not yet assessed,,,"]);
  });
});

describe("per capita file", () => {
  it("writes money as decimals from cents; an overpayment stays -12.00 (not text) and is noted Credit", () => {
    const csv = buildPerCapitaCsv(
      perCapita([
        pcRow({ billedCents: 10000, paidCents: 11200, outstandingCents: -1200, status: "paid", paidOn: "2025-04-01" }),
      ]),
    );
    const row = csv.slice(1).split("\r\n")[1];
    expect(row).toBe("2025,Alder Creek,Member,2023,100,26.25,100.00,112.00,-12.00,Paid,2025-04-01,Credit");
    expect(row).not.toContain("'-12.00");
  });

  it("a not-billed row leaves the figures empty and says why", () => {
    const base = { status: "not_billed" as const, billedCents: null, paidCents: null, outstandingCents: null, endingActiveBasis: null, rateApplied: null };
    const csv = buildPerCapitaCsv(
      perCapita([
        pcRow({ ...base, name: "Fairlawn Heights", organizationId: "f", notBilledReason: "no_statistics" }),
        pcRow({ ...base, name: "Elkhorn Crossing", organizationId: "e", notBilledReason: "not_generated" }),
      ]),
    );
    expect(csv.slice(1).split("\r\n").slice(1, 3)).toEqual([
      "2025,Fairlawn Heights,Member,2023,,,,,,Not billed,,No statistics on file for 2023",
      "2025,Elkhorn Crossing,Member,2023,,,,,,Not billed,,Not generated yet",
    ]);
  });

  it("marks a congregation that left, and prints a status for each stored state", () => {
    const rows = [
      pcRow({ membership: "departed", name: "Hollis Bend" }),
      pcRow({ status: "partly_paid", paidCents: 1000, outstandingCents: 261500, name: "Dunmore Ridge" }),
    ];
    const lines = buildPerCapitaCsv(perCapita(rows)).slice(1).split("\r\n");
    expect(lines[1]).toContain(",No longer a member,");
    expect(lines[2]).toContain(",Partly paid,");
  });

  it("throws on a rate that is not a plain decimal rather than guessing", () => {
    for (const rate of ["1e3", "-5", "5,00", "=1", ""]) {
      expect(() => buildPerCapitaCsv(perCapita([pcRow({ rateApplied: rate })]))).toThrow();
    }
  });

  it("accepts an integer rate and a long decimal", () => {
    expect(() => buildPerCapitaCsv(perCapita([pcRow({ rateApplied: "26" }), pcRow({ rateApplied: "26.2500" })]))).not.toThrow();
  });
});

describe("line terminators", () => {
  it("every line, the last included, ends CRLF and no bare LF ends a record", () => {
    const csv = buildViabilityCsv(viability([{ organizationId: "a", name: "A", score: 2, label: "Fair", notes: null, lastUpdated: null }]));
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toHaveLength(3);
  });
});

describe("buildings file (DECISION-348)", () => {
  it("writes one line per building, closed values as labels, tri-states as Yes / No / empty, numbers as numbers", () => {
    const csv = buildBuildingsCsv(buildingsData([bRow()]));
    expect(csv.slice(1).split("\r\n")).toEqual([
      BUILDINGS_HEADER.join(","),
      "Alder Creek,Alderton,Marsh,Sanctuary,Sanctuary,1902,1950,,12500,Good,Fair,Poor,,Yes,No,,Yes",
      "",
    ]);
  });

  it("an education building is written by its label, not its stored value", () => {
    const csv = buildBuildingsCsv(buildingsData([bRow({}, { buildingType: "education_building", isPrimary: false })]));
    expect(csv).toContain(",Education building,");
    expect(csv).not.toContain("education_building");
    expect(csv.slice(1).split("\r\n")[1].endsWith(",No")).toBe(true);
  });

  it("a congregation with no building in use is one line: its name, city and county, and nothing else", () => {
    const csv = buildBuildingsCsv(buildingsData([bRow({ name: "Bramblewood", city: null, county: "Marsh" }, null)]));
    expect(csv.slice(1).split("\r\n")[1]).toBe("Bramblewood,,Marsh,,,,,,,,,,,,,,");
    expect(csv.slice(1).split("\r\n")[1].split(",")).toHaveLength(BUILDINGS_HEADER.length);
  });

  it("every line has exactly as many cells as the header (no stray comma from a value)", () => {
    const csv = buildBuildingsCsv(buildingsData([bRow(), bRow({}, { name: "Annex", isPrimary: false }), bRow({ name: "Cedar" }, null)]));
    for (const l of csv.slice(1).split("\r\n").filter(Boolean)) expect(l.split(",")).toHaveLength(BUILDINGS_HEADER.length);
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])(
    "a congregation, city, county or building name beginning %j is apostrophe-guarded (each field on its own)",
    (text) => {
      const variants = [
        bRow({ name: text }),
        bRow({ city: text }),
        bRow({ county: text }),
        bRow({}, { name: text }),
      ];
      for (const row of variants) {
        const line = buildBuildingsCsv(buildingsData([row])).slice(1);
        expect(line.includes(`'${text}`) || line.includes(`"'${text}`)).toBe(true);
        expect(line.includes(`,${text},`) || line.includes(`\r\n${text},`)).toBe(false);
      }
    },
  );

  it("quotes a comma, quote and newline in a building name", () => {
    const csv = buildBuildingsCsv(buildingsData([bRow({}, { name: 'Hall, "East"\nWing' })]));
    expect(csv).toContain('"Hall, ""East""\nWing"');
  });
});

describe("insurance and loans file (DECISION-348)", () => {
  it("writes decimal dollars from cents, the counts as numbers, and tri-states as Yes / No", () => {
    const csv = buildInsuranceLoansCsv(insuranceLoansData([ilRow()]));
    expect(csv.slice(1).split("\r\n")).toEqual([
      INSURANCE_LOANS_HEADER.join(","),
      "Alder Creek,Example Mutual,2025,2026-09-01,No,Yes,1,250000.00,181250.50,0,5000.00,Guaranteed up to the original amount,1200000.00,0",
      "",
    ]);
  });

  it("cents format: 5 cents is 0.05, a recorded zero is 0.00 (not empty), the cap is 1000000000.00, a not-recorded figure is empty", () => {
    const csv = buildInsuranceLoansCsv(
      insuranceLoansData([
        ilRow({ originalCents: 5, balanceCents: 0, grantsCents: 100_000_000_000, appraisedCents: null }),
        ilRow({ name: "Bramblewood", originalCents: null, balanceCents: null, grantsCents: null, balanceUnrecorded: 2, openLoans: 2 }),
      ]),
    );
    const [, first, second] = csv.slice(1).split("\r\n");
    expect(first.split(",").slice(7, 11)).toEqual(["0.05", "0.00", "0", "1000000000.00"]);
    expect(first.split(",")[12]).toBe("");
    expect(second.split(",").slice(6, 11)).toEqual(["2", "", "", "2", ""]);
    expect(csv).not.toMatch(/\.\d{3}|e\+|NaN|undefined|null/);
  });

  it("a congregation with no records is its name and empties, with a zero count of open loans and unappraised buildings", () => {
    const csv = buildInsuranceLoansCsv(
      insuranceLoansData([ilRow({ name: "Cedar Hollow", insurance: null, openLoans: 0, originalCents: null, balanceCents: null, grantsCents: null, guarantees: [], appraisedCents: null })]),
    );
    expect(csv.slice(1).split("\r\n")[1]).toBe("Cedar Hollow,,,,,,0,,,0,,,,0");
  });

  it("joins several guarantee texts into one guarded, quoted cell", () => {
    const csv = buildInsuranceLoansCsv(insuranceLoansData([ilRow({ guarantees: ["First, loan", "Second loan"] })]));
    expect(csv).toContain('"First, loan; Second loan"');
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("a name, carrier or guarantee beginning %j is apostrophe-guarded", (text) => {
    const variants = [
      ilRow({ name: text }),
      ilRow({ insurance: { ...ilRow().insurance!, carrier: text } }),
      ilRow({ guarantees: [text] }),
    ];
    for (const row of variants) {
      const line = buildInsuranceLoansCsv(insuranceLoansData([row])).slice(1);
      expect(line.includes(`'${text}`) || line.includes(`"'${text}`)).toBe(true);
      expect(line.includes(`,${text},`) || line.includes(`\r\n${text},`)).toBe(false);
    }
  });

  it("a year and a count never pick up the text guard's apostrophe", () => {
    const csv = buildInsuranceLoansCsv(insuranceLoansData([ilRow({ openLoans: 3, buildingsWithoutAppraisal: 2 })]));
    expect(csv).not.toContain("'");
  });

  it("carries no policy number, lender or note even when the facts hold look-alikes (the facts do not have them)", () => {
    const csv = buildInsuranceLoansCsv(insuranceLoansData([ilRow()])) + buildBuildingsCsv(buildingsData([bRow()]));
    expect(csv).not.toMatch(/policy_number|lender|street/i);
  });
});
