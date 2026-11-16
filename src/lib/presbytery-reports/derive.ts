/**
 * The presbytery reports' derivation rules - docs/work-log/2026-11-15-presbytery-reports.md
 * (Phase 1 rulings, Phase 3 "Derivation rules"). PURE: no database, no
 * `server-only`; every function takes `today` as an ISO date string, so the
 * rules are tested without a clock or a connection. The readers fetch facts;
 * this file decides what they mean; `csv.ts` and the views render the result,
 * so a page and its file cannot disagree.
 */

export interface RosterEntry {
  id: string;
  name: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Name, then id: the one stable tie-break every report uses. */
function byNameThenId(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return compareText(a.name, b.name) || compareText(a.id, b.id);
}

// ---------------------------------------------------------------------------
// Vacant pulpits
// ---------------------------------------------------------------------------

export const FILLING_CALL_TYPES = ["installed_pastor", "designated_pastor"] as const;
export const SUPPLY_CALL_TYPES = ["stated_supply", "interim_pastor", "temporary_supply"] as const;

export interface AppointmentFact {
  id: string;
  servingOrgId: string;
  callType: string;
  startsOn: string;
  endsOn: string | null;
}

export interface VacantRow {
  organizationId: string;
  name: string;
  /** End date of the latest ended installed or designated call, or null. */
  vacantSince: string | null;
  /** Whole days from `vacantSince` to today, or null. */
  daysVacant: number | null;
  /** The most recent supply call in force today, or null. */
  supply: { callType: string; startsOn: string } | null;
}

export interface VacantPulpitsData {
  today: string;
  rosterCount: number;
  /** True when at least one appointment serves a current roster congregation (P3-2). */
  appointmentsRecorded: boolean;
  rows: VacantRow[];
}

/** `starts_on <= day` and (`ends_on` is null or `ends_on >= day`). ISO dates compare as text. */
export function inForce(a: { startsOn: string; endsOn: string | null }, day: string): boolean {
  return a.startsOn <= day && (a.endsOn === null || a.endsOn >= day);
}

/** Whole days between two ISO dates (UTC arithmetic), `to` minus `from`. */
export function daysBetween(from: string, to: string): number {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new RangeError("daysBetween: ISO dates required");
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Whole calendar months from `from` to `to`, rendered: "Less than a month",
 * "N months", "N years" or "N years, M months" (singular forms for one).
 */
export function formatVacancyLength(from: string, to: string): string {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new RangeError("formatVacancyLength: ISO dates required");
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  if (months < 1) return "Less than a month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const m = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;
  const y = (n: number) => `${n} ${n === 1 ? "year" : "years"}`;
  if (years === 0) return m(rest);
  if (rest === 0) return y(years);
  return `${y(years)}, ${m(rest)}`;
}

function isFilling(callType: string): boolean {
  return (FILLING_CALL_TYPES as readonly string[]).includes(callType);
}

function isSupply(callType: string): boolean {
  return (SUPPLY_CALL_TYPES as readonly string[]).includes(callType);
}

/**
 * A congregation is vacant when it has no installed or designated pastor in
 * force today. Supply never fills the pulpit and is shown separately; a parish
 * associate neither fills it nor makes it vacant. Starts from the roster and
 * joins the appointments to it, never the other way round.
 */
export function deriveVacantPulpits(
  roster: readonly RosterEntry[],
  appointments: readonly AppointmentFact[],
  today: string,
): VacantPulpitsData {
  const rosterIds = new Set(roster.map((r) => r.id));
  const byCongregation = new Map<string, AppointmentFact[]>();
  for (const a of appointments) {
    if (!rosterIds.has(a.servingOrgId)) continue;
    const list = byCongregation.get(a.servingOrgId);
    if (list) list.push(a);
    else byCongregation.set(a.servingOrgId, [a]);
  }

  const rows: VacantRow[] = [];
  for (const cong of roster) {
    const list = byCongregation.get(cong.id) ?? [];
    if (list.some((a) => isFilling(a.callType) && inForce(a, today))) continue;

    let vacantSince: string | null = null;
    for (const a of list) {
      if (!isFilling(a.callType) || a.endsOn === null || a.endsOn >= today) continue;
      if (vacantSince === null || a.endsOn > vacantSince) vacantSince = a.endsOn;
    }

    const supplies = list
      .filter((a) => isSupply(a.callType) && inForce(a, today))
      .sort(
        (a, b) =>
          compareText(b.startsOn, a.startsOn) || compareText(a.callType, b.callType) || compareText(a.id, b.id),
      );
    const supply = supplies[0] ? { callType: supplies[0].callType, startsOn: supplies[0].startsOn } : null;

    rows.push({
      organizationId: cong.id,
      name: cong.name,
      vacantSince,
      daysVacant: vacantSince === null ? null : daysBetween(vacantSince, today),
      supply,
    });
  }

  // Known vacantSince oldest first, then those with none; each group by name then id.
  rows.sort((a, b) => {
    if ((a.vacantSince === null) !== (b.vacantSince === null)) return a.vacantSince === null ? 1 : -1;
    if (a.vacantSince !== null && b.vacantSince !== null) {
      const c = compareText(a.vacantSince, b.vacantSince);
      if (c) return c;
    }
    return byNameThenId({ name: a.name, id: a.organizationId }, { name: b.name, id: b.organizationId });
  });

  return {
    today,
    rosterCount: roster.length,
    appointmentsRecorded: appointments.some((a) => rosterIds.has(a.servingOrgId)),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Membership trend
// ---------------------------------------------------------------------------

export type TrendSource = "presbytery_entered" | "published_by_congregation" | "imported";

export interface TrendStatFact {
  endingActive: number | null;
  provenance: string;
}

/** The structural shape of `fetchAffiliationWindows`'s entries. */
export interface TrendWindow {
  minYear: number | null;
  maxYear: number | null;
}

export type TrendCell =
  | { kind: "not_member" }
  | { kind: "no_data" }
  | { kind: "value"; endingActive: number | null; source: TrendSource };

export interface TrendRow {
  organizationId: string;
  name: string;
  /** One cell per year in `years`, same order. */
  cells: TrendCell[];
}

export interface TrendFooter {
  year: number;
  total: number;
  reporting: number;
  members: number;
}

export interface MembershipTrendData {
  from: number;
  to: number;
  years: number[];
  rosterCount: number;
  rows: TrendRow[];
  footer: TrendFooter[];
  /** True when any cell in the window has a statistics row on file. */
  hasData: boolean;
}

const TREND_SOURCES: readonly string[] = ["presbytery_entered", "published_by_congregation", "imported"];

/**
 * Per congregation and year: `not_member` when the year is outside the
 * congregation's affiliation window (an open side is `null`); otherwise the
 * coalesced row's figure and provenance, or `no_data`. A congregation with no
 * window entry is unconstrained. The window is an envelope: a gap year of a
 * congregation that left and rejoined reads `no_data`, not `not_member`.
 */
export function deriveMembershipTrend(
  roster: readonly RosterEntry[],
  windows: ReadonlyMap<string, TrendWindow>,
  statistics: ReadonlyMap<number, ReadonlyMap<string, TrendStatFact>>,
  from: number,
  to: number,
): MembershipTrendData {
  const years: number[] = [];
  for (let y = from; y <= to; y += 1) years.push(y);

  const rows: TrendRow[] = [...roster]
    .sort(byNameThenId)
    .map((cong) => {
      const window = windows.get(cong.id);
      const cells = years.map((year): TrendCell => {
        if (window) {
          if (window.minYear !== null && year < window.minYear) return { kind: "not_member" };
          if (window.maxYear !== null && year > window.maxYear) return { kind: "not_member" };
        }
        const fact = statistics.get(year)?.get(cong.id);
        if (!fact) return { kind: "no_data" };
        if (!TREND_SOURCES.includes(fact.provenance)) {
          throw new RangeError(`unknown statistics provenance: ${fact.provenance}`);
        }
        return { kind: "value", endingActive: fact.endingActive, source: fact.provenance as TrendSource };
      });
      return { organizationId: cong.id, name: cong.name, cells };
    });

  const footer = years.map((year, i): TrendFooter => {
    let total = 0;
    let reporting = 0;
    let members = 0;
    for (const row of rows) {
      const cell = row.cells[i];
      if (cell.kind === "not_member") continue;
      members += 1;
      if (cell.kind === "value" && cell.endingActive !== null) {
        total += cell.endingActive;
        reporting += 1;
      }
    }
    return { year, total, reporting, members };
  });

  return {
    from,
    to,
    years,
    rosterCount: roster.length,
    rows,
    footer,
    hasData: rows.some((r) => r.cells.some((c) => c.kind === "value")),
  };
}

// ---------------------------------------------------------------------------
// Viability
// ---------------------------------------------------------------------------

export const VIABILITY_LABELS: Readonly<Record<number, string>> = {
  1: "At risk",
  2: "Fair",
  3: "Healthy",
};
export const VIABILITY_NOT_ASSESSED = "Not yet assessed";

export interface ViabilityFact {
  aboutOrgId: string;
  viabilityScore: number | null;
  redevelopmentNotes: string | null;
  /** ISO date in the organization's time zone, or null. */
  updatedOn: string | null;
}

export interface ViabilityRow {
  organizationId: string;
  name: string;
  score: number | null;
  label: string;
  notes: string | null;
  lastUpdated: string | null;
}

export interface ViabilityData {
  rosterCount: number;
  rows: ViabilityRow[];
  /** True when any row is "Not yet assessed" (drives the pointer to Congregation Oversight). */
  anyNotAssessed: boolean;
}

/** Score 1, 2, 3, then not assessed; then name, then id. Starts from the roster. */
export function deriveViability(roster: readonly RosterEntry[], facts: readonly ViabilityFact[]): ViabilityData {
  const byOrg = new Map(facts.map((f) => [f.aboutOrgId, f]));
  const rows = roster.map((cong): ViabilityRow => {
    const fact = byOrg.get(cong.id);
    const score = fact?.viabilityScore ?? null;
    if (score !== null && !(score in VIABILITY_LABELS)) {
      throw new RangeError(`viability score out of range: ${score}`);
    }
    return {
      organizationId: cong.id,
      name: cong.name,
      score,
      label: score === null ? VIABILITY_NOT_ASSESSED : VIABILITY_LABELS[score],
      notes: fact?.redevelopmentNotes ?? null,
      lastUpdated: fact?.updatedOn ?? null,
    };
  });
  rows.sort(
    (a, b) =>
      (a.score ?? 99) - (b.score ?? 99) ||
      byNameThenId({ name: a.name, id: a.organizationId }, { name: b.name, id: b.organizationId }),
  );
  return { rosterCount: roster.length, rows, anyNotAssessed: rows.some((r) => r.score === null) };
}

// ---------------------------------------------------------------------------
// Per capita
// ---------------------------------------------------------------------------

export interface PerCapitaRecordFact {
  organizationId: string; // about_org_id
  name: string;
  billingYear: number;
  basisYear: number;
  endingActiveBasis: number | null;
  /** The stored rate as text. */
  rateApplied: string;
  /** Cents, as the driver returns bigint: a string. */
  billedCents: string;
  paidCents: string;
  paidStatus: string;
  paidOn: string | null;
}

export type PerCapitaStatus = "unpaid" | "partly_paid" | "paid" | "not_billed";
export type NotBilledReason = "no_statistics" | "not_generated";

export interface PerCapitaRow {
  billingYear: number;
  organizationId: string;
  name: string;
  /** `departed`: the record's congregation is not on today's roster. */
  membership: "member" | "departed";
  basisYear: number | null;
  endingActiveBasis: number | null;
  rateApplied: string | null;
  billedCents: number | null;
  paidCents: number | null;
  /** billed minus paid, in integer cents; negative is a credit. */
  outstandingCents: number | null;
  status: PerCapitaStatus;
  paidOn: string | null;
  notBilledReason: NotBilledReason | null;
}

export interface PerCapitaTotals {
  billedCents: number;
  paidCents: number;
  outstandingCents: number;
}

export interface PerCapitaData {
  /** The shown billing year, or null for the all-years long form. */
  billingYear: number | null;
  /** The year's rate row's basis year, if a rate row exists. */
  rateBasisYear: number | null;
  rosterCount: number;
  rows: PerCapitaRow[];
  totals: PerCapitaTotals;
  /** True when the presbytery has a bill in any year (shows "Export all years"). */
  anyBillsAnyYear: boolean;
}

/** Cents from the driver's string; a non-integer or unsafe value throws, never guessed. */
export function parseCents(text: string): number {
  if (typeof text !== "string" || !/^-?\d+$/.test(text)) {
    throw new RangeError("parseCents: expected an integer string");
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) throw new RangeError("parseCents: not a safe integer");
  return n;
}

function addSafe(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new RangeError("per-capita total is not a safe integer");
  return sum;
}

function statusOf(paidStatus: string): PerCapitaStatus {
  if (paidStatus === "unpaid") return "unpaid";
  if (paidStatus === "partial") return "partly_paid";
  if (paidStatus === "paid") return "paid";
  throw new RangeError(`unknown per-capita paid status: ${paidStatus}`);
}

export interface PerCapitaInput {
  roster: readonly RosterEntry[];
  records: readonly PerCapitaRecordFact[];
  /** The shown year, or null for every year. */
  billingYear: number | null;
  rateBasisYear: number | null;
  /**
   * Roster congregations that have a figure (a coalesced row with a non-null
   * ending active) for the basis year: the rule `generatePerCapitaRecords`
   * itself skips on. Only read when a rate row exists.
   */
  basisFigureOrgIds: ReadonlySet<string>;
  anyBillsAnyYear: boolean;
}

/**
 * Every record of the shown year (or of every year) plus, for the single-year
 * view and only when that year has at least one record, each roster
 * congregation without one as `not_billed`. All arithmetic is integer cents;
 * outstanding is billed minus paid.
 */
export function derivePerCapita(input: PerCapitaInput): PerCapitaData {
  const { roster, records, billingYear, rateBasisYear } = input;
  const rosterIds = new Set(roster.map((r) => r.id));

  const rows: PerCapitaRow[] = records.map((r): PerCapitaRow => {
    const billed = parseCents(r.billedCents);
    const paid = parseCents(r.paidCents);
    return {
      billingYear: r.billingYear,
      organizationId: r.organizationId,
      name: r.name,
      membership: rosterIds.has(r.organizationId) ? "member" : "departed",
      basisYear: r.basisYear,
      endingActiveBasis: r.endingActiveBasis,
      rateApplied: r.rateApplied,
      billedCents: billed,
      paidCents: paid,
      outstandingCents: billed - paid,
      status: statusOf(r.paidStatus),
      paidOn: r.paidOn,
      notBilledReason: null,
    };
  });

  if (billingYear !== null && records.length > 0) {
    const billedOrgs = new Set(records.map((r) => r.organizationId));
    const basisYear = rateBasisYear ?? records[0].basisYear;
    for (const cong of roster) {
      if (billedOrgs.has(cong.id)) continue;
      const noStatistics = rateBasisYear !== null && !input.basisFigureOrgIds.has(cong.id);
      rows.push({
        billingYear,
        organizationId: cong.id,
        name: cong.name,
        membership: "member",
        basisYear,
        endingActiveBasis: null,
        rateApplied: null,
        billedCents: null,
        paidCents: null,
        outstandingCents: null,
        status: "not_billed",
        paidOn: null,
        notBilledReason: noStatistics ? "no_statistics" : "not_generated",
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.billingYear - b.billingYear ||
      byNameThenId({ name: a.name, id: a.organizationId }, { name: b.name, id: b.organizationId }),
  );

  const totals: PerCapitaTotals = { billedCents: 0, paidCents: 0, outstandingCents: 0 };
  for (const row of rows) {
    if (row.billedCents === null || row.paidCents === null || row.outstandingCents === null) continue;
    totals.billedCents = addSafe(totals.billedCents, row.billedCents);
    totals.paidCents = addSafe(totals.paidCents, row.paidCents);
    totals.outstandingCents = addSafe(totals.outstandingCents, row.outstandingCents);
  }

  return {
    billingYear,
    rateBasisYear,
    rosterCount: roster.length,
    rows,
    totals,
    anyBillsAnyYear: input.anyBillsAnyYear,
  };
}
