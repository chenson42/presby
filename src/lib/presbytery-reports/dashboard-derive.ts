/**
 * The presbytery dashboard's summaries - docs/work-log/2026-11-17-presbytery-dashboard.md
 * (Phase 3 "API Contract", DECISION-342). PURE: nothing is imported but the TYPES
 * of `derive.ts`, so the rules are tested without a database or a clock. Each
 * function reads the data its report already derived and keeps only what a card
 * shows, so a card and its report cannot disagree. THE HONESTY RULE: a missing
 * figure is never a zero. Every summary has a state for "nothing recorded"
 * (`none`, `no_figure`, `not_recorded`), and the views print that state in
 * words.
 */
import type {
  MembershipTrendData,
  PerCapitaData,
  VacantPulpitsData,
  ViabilityData,
} from "./derive";

export type TrendSummary =
  | { kind: "figure"; year: number; total: number; reporting: number; members: number; from: number; to: number }
  | { kind: "no_figure"; year: number; members: number; from: number; to: number }
  | { kind: "none"; from: number; to: number };

export type VacantSummary =
  | { kind: "not_recorded" }
  | { kind: "none_vacant"; total: number }
  | { kind: "some"; vacant: number; total: number };

export type PerCapitaSummary =
  | {
      kind: "figure";
      billingYear: number;
      billedCents: number;
      paidCents: number;
      outstandingCents: number;
      /** Billed rows that are a current member. */
      billedCount: number;
      /** The roster count: the denominator of "N of M congregations billed". */
      total: number;
      /** Billed rows whose congregation is no longer on the roster (the report keeps their bill). */
      departedBilled: number;
    }
  | { kind: "none"; billingYear: number; rateSet: boolean };

/** What the list keeps of a viability row: never the notes or the update date. */
export interface ViabilityListRow {
  organizationId: string;
  name: string;
  score: number | null;
  label: string;
}

export interface ViabilityList {
  rosterCount: number;
  anyNotAssessed: boolean;
  rows: ViabilityListRow[];
}

/**
 * The newest year in the window with any statistics row (a figure or not), with
 * that year's own footer. No row in the window: `none`. A row but no figure
 * (`reporting` is 0): `no_figure`, a dash and a sentence, never a total of 0.
 * `members` is the footer's count (cells that are not `not_member`), not the
 * current roster.
 */
export function summarizeTrend(data: MembershipTrendData): TrendSummary {
  const { from, to } = data;
  for (let i = data.years.length - 1; i >= 0; i -= 1) {
    if (!data.rows.some((row) => row.cells[i]?.kind === "value")) continue;
    const footer = data.footer[i];
    if (footer.reporting === 0) return { kind: "no_figure", year: footer.year, members: footer.members, from, to };
    return {
      kind: "figure",
      year: footer.year,
      total: footer.total,
      reporting: footer.reporting,
      members: footer.members,
      from,
      to,
    };
  }
  return { kind: "none", from, to };
}

/** `not_recorded` whenever no appointment is on file, so a count is never shown then. */
export function summarizeVacant(data: VacantPulpitsData): VacantSummary {
  if (!data.appointmentsRecorded) return { kind: "not_recorded" };
  if (data.rows.length === 0) return { kind: "none_vacant", total: data.rosterCount };
  return { kind: "some", vacant: data.rows.length, total: data.rosterCount };
}

/**
 * Billed rows are those whose status is not `not_billed`. Totals are the
 * report's own, so the card equals the report to the cent, a departed
 * congregation's kept bill included (counted apart in `departedBilled`).
 */
export function summarizePerCapita(data: PerCapitaData): PerCapitaSummary {
  const billingYear = data.billingYear;
  if (billingYear === null) throw new RangeError("summarizePerCapita: a single billing year is required");
  const billed = data.rows.filter((row) => row.status !== "not_billed");
  if (billed.length === 0) return { kind: "none", billingYear, rateSet: data.rateBasisYear !== null };
  return {
    kind: "figure",
    billingYear,
    billedCents: data.totals.billedCents,
    paidCents: data.totals.paidCents,
    outstandingCents: data.totals.outstandingCents,
    billedCount: billed.filter((row) => row.membership === "member").length,
    total: data.rosterCount,
    departedBilled: billed.filter((row) => row.membership === "departed").length,
  };
}

/** Keeps the order `deriveViability` gave (at risk, fair, healthy, not yet assessed). */
export function toViabilityList(data: ViabilityData): ViabilityList {
  return {
    rosterCount: data.rosterCount,
    anyNotAssessed: data.anyNotAssessed,
    rows: data.rows.map((row) => ({
      organizationId: row.organizationId,
      name: row.name,
      score: row.score,
      label: row.label,
    })),
  };
}
