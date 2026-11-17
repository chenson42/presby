/**
 * The dashboard's summaries (DECISION-342). Built from the real `derive*`
 * functions where a shape is intricate, so a card is tested against what its
 * report would derive, not against a hand-made lookalike.
 */
import { describe, expect, it } from "vitest";
import {
  deriveMembershipTrend,
  derivePerCapita,
  deriveVacantPulpits,
  deriveViability,
  type MembershipTrendData,
  type PerCapitaRecordFact,
} from "./derive";
import { summarizePerCapita, summarizeTrend, summarizeVacant, toViabilityList } from "./dashboard-derive";

const ROSTER = [
  { id: "a", name: "Alder Creek" },
  { id: "b", name: "Birch Hollow" },
  { id: "c", name: "Cedar Ford" },
];

const stat = (endingActive: number | null) => ({ endingActive, provenance: "presbytery_entered" });

function trend(statistics: Array<[number, Array<[string, number | null]>]>): MembershipTrendData {
  const byYear = new Map(
    statistics.map(([year, rows]) => [year, new Map(rows.map(([id, n]) => [id, stat(n)]))] as const),
  );
  return deriveMembershipTrend(ROSTER, new Map(), byYear, 2021, 2025);
}

describe("summarizeTrend", () => {
  it("trend: newest year with any statistics row, with its fraction", () => {
    const data = trend([
      [2023, [["a", 100], ["b", 50], ["c", 20]]],
      [2024, [["a", 110], ["b", 55]]],
    ]);
    expect(summarizeTrend(data)).toEqual({
      kind: "figure",
      year: 2024,
      total: 165,
      reporting: 2,
      members: 3,
      from: 2021,
      to: 2025,
    });
  });

  it("trend: a row with no figure is no_figure, never a zero", () => {
    const data = trend([
      [2023, [["a", 100]]],
      [2024, [["a", null]]],
    ]);
    const summary = summarizeTrend(data);
    expect(summary).toEqual({ kind: "no_figure", year: 2024, members: 3, from: 2021, to: 2025 });
    expect("total" in summary).toBe(false);
  });

  it("trend: no row in the window is none", () => {
    expect(summarizeTrend(trend([]))).toEqual({ kind: "none", from: 2021, to: 2025 });
  });

  it("trend: members counts the congregations that were members that year, not the roster", () => {
    const windows = new Map([["c", { minYear: 2025, maxYear: null }]]);
    const data = deriveMembershipTrend(ROSTER, windows, new Map([[2024, new Map([["a", stat(10)]])]]), 2021, 2025);
    const summary = summarizeTrend(data);
    expect(summary).toMatchObject({ kind: "figure", year: 2024, reporting: 1, members: 2 });
  });
});

describe("summarizeVacant", () => {
  const appt = (servingOrgId: string, callType = "installed_pastor") => ({
    id: `${servingOrgId}-${callType}`,
    servingOrgId,
    callType,
    startsOn: "2020-01-01",
    endsOn: null,
  });

  it("vacant: not recorded is not_recorded", () => {
    const data = deriveVacantPulpits(ROSTER, [], "2026-11-16");
    expect(summarizeVacant(data)).toEqual({ kind: "not_recorded" });
  });

  it("vacant: an appointment that serves no roster congregation is still not_recorded", () => {
    const data = deriveVacantPulpits(ROSTER, [appt("elsewhere")], "2026-11-16");
    expect(summarizeVacant(data)).toEqual({ kind: "not_recorded" });
  });

  it("vacant: none_vacant only when appointments are recorded", () => {
    const data = deriveVacantPulpits(ROSTER, [appt("a"), appt("b"), appt("c", "designated_pastor")], "2026-11-16");
    expect(summarizeVacant(data)).toEqual({ kind: "none_vacant", total: 3 });
  });

  it("vacant: some counts the report's rows of the roster", () => {
    const data = deriveVacantPulpits(ROSTER, [appt("a")], "2026-11-16");
    expect(summarizeVacant(data)).toEqual({ kind: "some", vacant: 2, total: 3 });
  });
});

describe("summarizePerCapita", () => {
  const record = (organizationId: string, billed: string, paid: string, paidStatus = "unpaid"): PerCapitaRecordFact => ({
    organizationId,
    name: organizationId === "z" ? "Zion (left)" : organizationId,
    billingYear: 2026,
    basisYear: 2024,
    endingActiveBasis: 100,
    rateApplied: "25.00",
    billedCents: billed,
    paidCents: paid,
    paidStatus,
    paidOn: null,
  });
  const base = { roster: ROSTER, billingYear: 2026, basisFigureOrgIds: new Set<string>(), anyBillsAnyYear: true };

  it("per capita: no billed row is none with rateSet", () => {
    const noRate = derivePerCapita({ ...base, records: [], rateBasisYear: null });
    expect(summarizePerCapita(noRate)).toEqual({ kind: "none", billingYear: 2026, rateSet: false });
    const rate = derivePerCapita({ ...base, records: [], rateBasisYear: 2024 });
    expect(summarizePerCapita(rate)).toEqual({ kind: "none", billingYear: 2026, rateSet: true });
  });

  it("per capita: totals equal the report's and departed bills are counted apart", () => {
    const data = derivePerCapita({
      ...base,
      records: [record("a", "250000", "100000", "partial"), record("b", "125000", "0"), record("z", "50000", "50000", "paid")],
      rateBasisYear: 2024,
    });
    const summary = summarizePerCapita(data);
    expect(summary).toEqual({
      kind: "figure",
      billingYear: 2026,
      billedCents: data.totals.billedCents,
      paidCents: data.totals.paidCents,
      outstandingCents: data.totals.outstandingCents,
      billedCount: 2,
      total: 3,
      departedBilled: 1,
    });
    expect(data.totals.billedCents).toBe(425000);
  });

  it("per capita: a not_billed congregation is neither billed nor a total", () => {
    const data = derivePerCapita({ ...base, records: [record("a", "250000", "0")], rateBasisYear: 2024 });
    const summary = summarizePerCapita(data);
    expect(summary).toMatchObject({ kind: "figure", billedCount: 1, total: 3, billedCents: 250000 });
  });

  it("per capita: the all-years form is not a card and throws", () => {
    const data = derivePerCapita({ ...base, billingYear: null, records: [], rateBasisYear: null });
    expect(() => summarizePerCapita(data)).toThrow(RangeError);
  });
});

describe("toViabilityList", () => {
  it("toViabilityList keeps order and drops notes and dates", () => {
    const data = deriveViability(ROSTER, [
      { aboutOrgId: "a", viabilityScore: 3, redevelopmentNotes: "sell the manse", updatedOn: "2026-01-02" },
      { aboutOrgId: "b", viabilityScore: 1, redevelopmentNotes: "roof", updatedOn: "2026-02-03" },
    ]);
    const list = toViabilityList(data);
    expect(list.rows.map((r) => [r.name, r.label])).toEqual([
      ["Birch Hollow", "At risk"],
      ["Alder Creek", "Healthy"],
      ["Cedar Ford", "Not yet assessed"],
    ]);
    expect(list.anyNotAssessed).toBe(true);
    expect(list.rosterCount).toBe(3);
  });

  it("the viability list never carries notes or dates", () => {
    const data = deriveViability(ROSTER, [
      { aboutOrgId: "a", viabilityScore: 2, redevelopmentNotes: "SECRET-NOTE", updatedOn: "2026-01-02" },
    ]);
    const text = JSON.stringify(toViabilityList(data));
    expect(text).not.toContain("SECRET-NOTE");
    expect(text).not.toContain("2026-01-02");
    for (const row of toViabilityList(data).rows) {
      expect(Object.keys(row).sort()).toEqual(["label", "name", "organizationId", "score"]);
    }
  });

  it("an out-of-range score still throws in deriveViability, which is why the card must degrade alone", () => {
    expect(() =>
      deriveViability(ROSTER, [{ aboutOrgId: "a", viabilityScore: 9, redevelopmentNotes: null, updatedOn: null }]),
    ).toThrow(RangeError);
  });
});
