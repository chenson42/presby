import { describe, expect, it } from "vitest";
import {
  type AppointmentFact,
  daysBetween,
  deriveMembershipTrend,
  derivePerCapita,
  deriveVacantPulpits,
  deriveViability,
  formatVacancyLength,
  inForce,
  parseCents,
  type PerCapitaRecordFact,
  type TrendStatFact,
} from "./derive";

const TODAY = "2026-06-15";
const A = { id: "a", name: "Alder Creek" };
const B = { id: "b", name: "Bramblewood" };
const C = { id: "c", name: "Cedar Hollow" };

let seq = 0;
const appt = (servingOrgId: string, callType: string, startsOn: string, endsOn: string | null = null): AppointmentFact => ({
  id: `ap${String(++seq).padStart(3, "0")}`,
  servingOrgId,
  callType,
  startsOn,
  endsOn,
});

describe("inForce", () => {
  it("starts today counts; starts tomorrow does not; ends today counts; ends yesterday does not; open end counts", () => {
    expect(inForce({ startsOn: TODAY, endsOn: null }, TODAY)).toBe(true);
    expect(inForce({ startsOn: "2026-06-16", endsOn: null }, TODAY)).toBe(false);
    expect(inForce({ startsOn: "2020-01-01", endsOn: TODAY }, TODAY)).toBe(true);
    expect(inForce({ startsOn: "2020-01-01", endsOn: "2026-06-14" }, TODAY)).toBe(false);
    expect(inForce({ startsOn: "2020-01-01", endsOn: "2026-06-16" }, TODAY)).toBe(true);
  });
});

describe("the vacancy matrix (every call type)", () => {
  const vacantFor = (callType: string, startsOn = "2020-01-01", endsOn: string | null = null) =>
    deriveVacantPulpits([A], [appt("a", callType, startsOn, endsOn)], TODAY).rows.length === 1;

  it("installed and designated fill the pulpit when in force", () => {
    expect(vacantFor("installed_pastor")).toBe(false);
    expect(vacantFor("designated_pastor")).toBe(false);
  });

  it("supply, interim and associate never fill the pulpit", () => {
    for (const t of ["stated_supply", "interim_pastor", "temporary_supply", "parish_associate"]) {
      expect(vacantFor(t)).toBe(true);
    }
  });

  it.each([
    ["starts today", TODAY, null, false],
    ["starts tomorrow", "2026-06-16", null, true],
    ["ends today", "2020-01-01", TODAY, false],
    ["ends tomorrow", "2020-01-01", "2026-06-16", false],
    ["ended yesterday", "2020-01-01", "2026-06-14", true],
  ])("an installed call that %s: vacant is %s", (_label, startsOn, endsOn, vacant) => {
    expect(vacantFor("installed_pastor", startsOn, endsOn)).toBe(vacant);
  });

  it("a parish associate does not make a filled pulpit vacant", () => {
    const r = deriveVacantPulpits([A], [appt("a", "installed_pastor", "2020-01-01"), appt("a", "parish_associate", "2020-01-01")], TODAY);
    expect(r.rows).toEqual([]);
  });

  it("a congregation with no appointment at all is vacant with nothing known", () => {
    const r = deriveVacantPulpits([A, B], [appt("b", "installed_pastor", "2020-01-01")], TODAY);
    expect(r.rows).toEqual([{ organizationId: "a", name: "Alder Creek", vacantSince: null, daysVacant: null, supply: null }]);
    expect(r.appointmentsRecorded).toBe(true);
  });
});

describe("vacant since, supply and sort", () => {
  it("vacant since is the latest ended installed or designated end; a still-future end is not 'ended'", () => {
    const r = deriveVacantPulpits(
      [A],
      [
        appt("a", "installed_pastor", "2000-01-01", "2010-03-01"),
        appt("a", "designated_pastor", "2010-04-01", "2024-03-15"),
        appt("a", "stated_supply", "2024-04-01", "2025-01-01"), // supply never sets vacant since
      ],
      TODAY,
    );
    expect(r.rows[0].vacantSince).toBe("2024-03-15");
    expect(r.rows[0].daysVacant).toBe(daysBetween("2024-03-15", TODAY));
  });

  it("supply is the in-force supply call with the latest start; ties break by call type then id", () => {
    const r = deriveVacantPulpits(
      [A],
      [
        appt("a", "stated_supply", "2025-01-01"),
        appt("a", "interim_pastor", "2025-09-01"),
        appt("a", "temporary_supply", "2025-09-01"),
        appt("a", "interim_pastor", "2020-01-01", "2021-01-01"), // not in force
      ],
      TODAY,
    );
    expect(r.rows[0].supply).toEqual({ callType: "interim_pastor", startsOn: "2025-09-01" });
  });

  it("a future-dated supply call is not shown", () => {
    const r = deriveVacantPulpits([A], [appt("a", "interim_pastor", "2026-07-01")], TODAY);
    expect(r.rows[0].supply).toBeNull();
  });

  it("sorts oldest vacancy first, then those with none, each by name then id", () => {
    const r = deriveVacantPulpits(
      [C, B, A],
      [appt("a", "installed_pastor", "2000-01-01", "2025-01-01"), appt("b", "installed_pastor", "2000-01-01", "2023-01-01")],
      TODAY,
    );
    expect(r.rows.map((x) => x.name)).toEqual(["Bramblewood", "Alder Creek", "Cedar Hollow"]);
  });

  it("appointments serving a congregation off the roster neither list nor count as 'recorded'", () => {
    const r = deriveVacantPulpits([A], [appt("elsewhere", "installed_pastor", "2000-01-01")], TODAY);
    expect(r.appointmentsRecorded).toBe(false);
    expect(r.rows.map((x) => x.name)).toEqual(["Alder Creek"]);
  });

  it("an empty roster is an empty report", () => {
    expect(deriveVacantPulpits([], [], TODAY)).toEqual({ today: TODAY, rosterCount: 0, appointmentsRecorded: false, rows: [] });
  });
});

describe("daysBetween and formatVacancyLength", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-06-14", "2026-06-15")).toBe(1);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // leap year
    expect(() => daysBetween("2026-6-1", "2026-06-15")).toThrow();
  });

  it.each([
    ["2026-06-01", "2026-06-15", "Less than a month"],
    ["2026-05-16", "2026-06-15", "Less than a month"], // one day short of a calendar month
    ["2026-05-15", "2026-06-15", "1 month"],
    ["2026-01-15", "2026-06-15", "5 months"],
    ["2025-06-15", "2026-06-15", "1 year"],
    ["2024-06-15", "2026-06-15", "2 years"],
    ["2024-03-15", "2026-06-15", "2 years, 3 months"],
    ["2025-05-15", "2026-06-15", "1 year, 1 month"],
    ["2024-06-16", "2026-06-15", "1 year, 11 months"],
  ])("%s to %s reads %s", (from, to, text) => {
    expect(formatVacancyLength(from, to)).toBe(text);
  });
});

describe("the membership trend", () => {
  const stat = (endingActive: number | null, provenance = "presbytery_entered"): TrendStatFact => ({ endingActive, provenance });
  const stats = (entries: Array<[number, string, TrendStatFact]>) => {
    const m = new Map<number, Map<string, TrendStatFact>>();
    for (const [year, org, fact] of entries) {
      if (!m.has(year)) m.set(year, new Map());
      m.get(year)!.set(org, fact);
    }
    return m;
  };

  it("a row on file is a value with its provenance; none is no_data", () => {
    const t = deriveMembershipTrend([A], new Map(), stats([[2024, "a", stat(120, "published_by_congregation")]]), 2023, 2025);
    expect(t.rows[0].cells).toEqual([
      { kind: "no_data" },
      { kind: "value", endingActive: 120, source: "published_by_congregation" },
      { kind: "no_data" },
    ]);
    expect(t.hasData).toBe(true);
  });

  it("a row on file with a null figure is a value with null (not 'no data')", () => {
    const t = deriveMembershipTrend([A], new Map(), stats([[2024, "a", stat(null, "imported")]]), 2024, 2024);
    expect(t.rows[0].cells[0]).toEqual({ kind: "value", endingActive: null, source: "imported" });
    expect(t.footer[0]).toEqual({ year: 2024, total: 0, reporting: 0, members: 1 });
  });

  it("a year outside the affiliation window is not_member; the window edges are inclusive, by calendar year", () => {
    const windows = new Map([["a", { minYear: 2024, maxYear: 2025 }]]);
    const t = deriveMembershipTrend([A], windows, stats([[2024, "a", stat(10)], [2025, "a", stat(11)], [2026, "a", stat(12)]]), 2023, 2026);
    expect(t.rows[0].cells.map((c) => c.kind)).toEqual(["not_member", "value", "value", "not_member"]);
  });

  it("an open side (null) is unconstrained; a congregation with no window entry is unconstrained", () => {
    const windows = new Map([["a", { minYear: null, maxYear: 2024 }]]);
    const t = deriveMembershipTrend([A, B], windows, stats([]), 2020, 2026);
    expect(t.rows[0].cells.map((c) => c.kind)).toEqual(["no_data", "no_data", "no_data", "no_data", "no_data", "not_member", "not_member"]);
    expect(t.rows[1].cells.every((c) => c.kind === "no_data")).toBe(true);
  });

  it("a rejoined congregation's envelope shows 'no data' (not a dash) in the gap year", () => {
    // left after 2021, rejoined 2024: fetchAffiliationWindows reduces to the envelope min 2018, max null
    const windows = new Map([["a", { minYear: 2018, maxYear: null }]]);
    const t = deriveMembershipTrend([A], windows, stats([]), 2022, 2023);
    expect(t.rows[0].cells.map((c) => c.kind)).toEqual(["no_data", "no_data"]);
  });

  it("footer: total of numbers, count of numbers, and members (cells that are not a dash)", () => {
    const windows = new Map([["b", { minYear: 2025, maxYear: null }]]);
    const t = deriveMembershipTrend(
      [A, B, C],
      windows,
      stats([
        [2024, "a", stat(100)],
        [2024, "c", stat(null)],
        [2025, "a", stat(90)],
        [2025, "b", stat(30)],
      ]),
      2024,
      2025,
    );
    expect(t.footer).toEqual([
      { year: 2024, total: 100, reporting: 1, members: 2 },
      { year: 2025, total: 120, reporting: 2, members: 3 },
    ]);
  });

  it("rows are sorted by name; hasData is false with no row in the window", () => {
    const t = deriveMembershipTrend([C, A, B], new Map(), stats([]), 2025, 2025);
    expect(t.rows.map((r) => r.name)).toEqual(["Alder Creek", "Bramblewood", "Cedar Hollow"]);
    expect(t.hasData).toBe(false);
    expect(t.years).toEqual([2025]);
  });

  it("rejects an unknown provenance rather than guessing", () => {
    expect(() => deriveMembershipTrend([A], new Map(), stats([[2025, "a", stat(1, "mystery")]]), 2025, 2025)).toThrow();
  });
});

describe("viability", () => {
  it("sorts 1, 2, 3, then not assessed, then by name; labels follow the oversight list", () => {
    const d = deriveViability(
      [A, B, C, { id: "d", name: "Dunmore Ridge" }],
      [
        { aboutOrgId: "a", viabilityScore: 3, redevelopmentNotes: null, updatedOn: "2026-01-01" },
        { aboutOrgId: "b", viabilityScore: 1, redevelopmentNotes: "Roof, \"urgent\"", updatedOn: "2026-02-02" },
        { aboutOrgId: "c", viabilityScore: null, redevelopmentNotes: "Watching", updatedOn: "2026-03-03" },
      ],
    );
    expect(d.rows.map((r) => [r.name, r.score, r.label])).toEqual([
      ["Bramblewood", 1, "At risk"],
      ["Alder Creek", 3, "Healthy"],
      ["Cedar Hollow", null, "Not yet assessed"],
      ["Dunmore Ridge", null, "Not yet assessed"],
    ]);
    expect(d.anyNotAssessed).toBe(true);
    expect(d.rows[2].notes).toBe("Watching"); // a null score keeps its notes
  });

  it("a facts row for a congregation off the roster is ignored; all assessed clears the flag", () => {
    const d = deriveViability([A], [
      { aboutOrgId: "a", viabilityScore: 2, redevelopmentNotes: null, updatedOn: null },
      { aboutOrgId: "zzz", viabilityScore: 1, redevelopmentNotes: "x", updatedOn: null },
    ]);
    expect(d.rows).toHaveLength(1);
    expect(d.anyNotAssessed).toBe(false);
  });

  it("throws on a score the database CHECK forbids", () => {
    expect(() => deriveViability([A], [{ aboutOrgId: "a", viabilityScore: 4, redevelopmentNotes: null, updatedOn: null }])).toThrow();
  });
});

describe("per capita", () => {
  const rec = (over: Partial<PerCapitaRecordFact> & { organizationId: string; name: string }): PerCapitaRecordFact => ({
    billingYear: 2025,
    basisYear: 2023,
    endingActiveBasis: 100,
    rateApplied: "26.25",
    billedCents: "262500",
    paidCents: "0",
    paidStatus: "unpaid",
    paidOn: null,
    ...over,
  });
  const base = { rateBasisYear: 2023, basisFigureOrgIds: new Set<string>(), anyBillsAnyYear: true };

  it("parseCents accepts integer strings and refuses anything else, including unsafe integers", () => {
    expect(parseCents("262500")).toBe(262500);
    expect(parseCents("-1250")).toBe(-1250);
    expect(() => parseCents("12.5")).toThrow();
    expect(() => parseCents("")).toThrow();
    expect(() => parseCents("9007199254740993")).toThrow();
  });

  it("outstanding is billed minus paid in cents; an overpayment is negative; totals are integer sums", () => {
    const d = derivePerCapita({
      ...base,
      roster: [A, B],
      billingYear: 2025,
      records: [
        rec({ organizationId: "a", name: "Alder Creek", billedCents: "262500", paidCents: "100000", paidStatus: "partial" }),
        rec({ organizationId: "b", name: "Bramblewood", billedCents: "10000", paidCents: "11250", paidStatus: "paid" }),
      ],
    });
    expect(d.rows.map((r) => [r.name, r.outstandingCents, r.status])).toEqual([
      ["Alder Creek", 162500, "partly_paid"],
      ["Bramblewood", -1250, "paid"],
    ]);
    expect(d.totals).toEqual({ billedCents: 272500, paidCents: 111250, outstandingCents: 161250 });
  });

  it("sub-cent stored values arrive as rounded cents strings and stay consistent (100.005 and 1e3 round alike)", () => {
    // The reader rounds in SQL: round(100.005 * 100) = 10001; round(1e3 * 100) = 100000.
    const d = derivePerCapita({
      ...base,
      roster: [A, B],
      billingYear: 2025,
      records: [
        rec({ organizationId: "a", name: "Alder Creek", billedCents: "20000", paidCents: "10001", paidStatus: "partial" }),
        rec({ organizationId: "b", name: "Bramblewood", billedCents: "100000", paidCents: "100000", paidStatus: "paid" }),
      ],
    });
    expect(d.rows[0].outstandingCents).toBe(9999);
    expect(d.rows[1].outstandingCents).toBe(0);
  });

  it("an unsafe cents string throws (never guessed)", () => {
    expect(() =>
      derivePerCapita({ ...base, roster: [A], billingYear: 2025, records: [rec({ organizationId: "a", name: "Alder Creek", billedCents: "9007199254740993" })] }),
    ).toThrow();
  });

  it("a record whose congregation is off the roster is kept and marked departed", () => {
    const d = derivePerCapita({
      ...base,
      roster: [A],
      billingYear: 2025,
      records: [rec({ organizationId: "gone", name: "Hollis Bend", billedCents: "5000", paidCents: "0" }), rec({ organizationId: "a", name: "Alder Creek" })],
    });
    expect(d.rows.find((r) => r.name === "Hollis Bend")?.membership).toBe("departed");
    expect(d.rows.find((r) => r.name === "Alder Creek")?.membership).toBe("member");
    expect(d.totals.billedCents).toBe(267500);
  });

  it("adds each roster congregation without a record as not billed, with its reason, when the year has records", () => {
    const d = derivePerCapita({
      ...base,
      roster: [A, B, C],
      billingYear: 2025,
      basisFigureOrgIds: new Set(["c"]),
      records: [rec({ organizationId: "a", name: "Alder Creek" })],
    });
    const byName = Object.fromEntries(d.rows.map((r) => [r.name, r]));
    expect(byName["Bramblewood"]).toMatchObject({ status: "not_billed", notBilledReason: "no_statistics", billedCents: null, basisYear: 2023 });
    expect(byName["Cedar Hollow"]).toMatchObject({ status: "not_billed", notBilledReason: "not_generated" });
    expect(d.totals.billedCents).toBe(262500); // not-billed rows add nothing
  });

  it("no rate row means 'not generated yet', never 'no statistics'", () => {
    const d = derivePerCapita({
      ...base,
      rateBasisYear: null,
      roster: [A, B],
      billingYear: 2025,
      records: [rec({ organizationId: "a", name: "Alder Creek" })],
    });
    expect(d.rows.find((r) => r.name === "Bramblewood")).toMatchObject({ notBilledReason: "not_generated", basisYear: 2023 });
  });

  it("a year with no records shows no not-billed rows (the empty state, not a list of 'not generated')", () => {
    const d = derivePerCapita({ ...base, roster: [A, B], billingYear: 2026, records: [] });
    expect(d.rows).toEqual([]);
    expect(d.totals).toEqual({ billedCents: 0, paidCents: 0, outstandingCents: 0 });
  });

  it("the all-years shape: records of every year, ordered by year then name, and never a not-billed row", () => {
    const d = derivePerCapita({
      ...base,
      roster: [A, B],
      billingYear: null,
      records: [
        rec({ organizationId: "b", name: "Bramblewood", billingYear: 2025 }),
        rec({ organizationId: "a", name: "Alder Creek", billingYear: 2025 }),
        rec({ organizationId: "a", name: "Alder Creek", billingYear: 2024, basisYear: 2022 }),
      ],
    });
    expect(d.rows.map((r) => [r.billingYear, r.name])).toEqual([
      [2024, "Alder Creek"],
      [2025, "Alder Creek"],
      [2025, "Bramblewood"],
    ]);
    expect(d.rows.some((r) => r.status === "not_billed")).toBe(false);
  });

  it("throws on a paid status the database CHECK forbids", () => {
    expect(() =>
      derivePerCapita({ ...base, roster: [A], billingYear: 2025, records: [rec({ organizationId: "a", name: "Alder Creek", paidStatus: "waived" })] }),
    ).toThrow();
  });
});
