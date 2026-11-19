/**
 * The presbytery reports contract - docs/work-log/2026-11-15-presbytery-reports.md
 * (DECISION-337). PURE: no imports, so a page, a route, a test and the
 * boundaries scan can all read it. The registry is the one place a report is
 * named: its segment under `admin/reports/`, its existing permission key, its
 * title and its CSV filename base. A seventh report has to be registered here,
 * and `contract.test.ts` pins that the route tree matches. Six reports since
 * DECISION-348: Buildings and Insurance and loans (Congregation Oversight) join
 * the four; the dashboard still has four cards and keeps `DASHBOARD_REPORT_KEYS`.
 */

/** The existing global flag every report page and export sits behind (a toggle; bare isFlagEnabled). */
export const REPORTS_FLAG = "org_portal.reports";

/**
 * The flag the presbytery dashboard (`/o/<slug>/admin/insights`) sits behind
 * (DECISION-342). A toggle, never a gate on a card's data: each card's authority
 * is its report's own key, read live inside the reader's own transaction.
 */
export const INSIGHTS_FLAG = "org_portal.insights";

/**
 * Two more existing global flags, read by the dashboard page ONLY to decide whether
 * a card or a row is a link or plain text (a click must not land on "isn't turned
 * on"). Presentational: they gate nothing (DECISION-003).
 */
export const OVERSIGHT_FLAG = "org_portal.oversight";

/**
 * The existing global flag Committees & Commissions sits behind
 * (`/o/<slug>/admin/committees/**`; DECISION-359). A toggle (bare
 * `isFlagEnabled`); rollback is the flag. It is NOT `org_portal.groups`: the
 * committees tree depends on no groups-admin flag.
 */
export const COMMITTEES_FLAG = "org_portal.committees";
export const CREDENTIALS_FLAG = "org_portal.credentials";

/** Reports are for presbyteries only. */
export const REPORT_ORG_TYPES = ["presbytery"] as const;

export const REPORT_KEYS = [
  "vacant_pulpits",
  "membership_trend",
  "viability",
  "per_capita",
  "buildings",
  "insurance_and_loans",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export interface ReportDef {
  readonly key: ReportKey;
  /** The directory under `admin/reports/`; never a UUID (the sibling is `[aboutOrgId]`). */
  readonly segment: string;
  readonly title: string;
  /**
   * One existing permission key per report; an export uses its page's key. Two reports
   * may share a key (Viability and Buildings are both `congregation_oversight.manage`).
   */
  readonly permission: string;
  /** Plain-language "you need to ..." for the locked card and the forbidden state. */
  readonly permissionPhrase: string;
  readonly filenameBase: string;
}

export const REPORTS: readonly ReportDef[] = [
  {
    key: "vacant_pulpits",
    segment: "vacant-pulpits",
    title: "Vacant pulpits",
    permission: "credentials.manage",
    permissionPhrase: "manage credentials",
    filenameBase: "vacant-pulpits",
  },
  {
    key: "membership_trend",
    segment: "membership-trend",
    title: "Membership trend",
    permission: "statistics.manage",
    permissionPhrase: "manage statistics",
    filenameBase: "membership-trend",
  },
  {
    key: "viability",
    segment: "viability",
    title: "Viability",
    permission: "congregation_oversight.manage",
    permissionPhrase: "manage congregation oversight",
    filenameBase: "viability",
  },
  {
    key: "per_capita",
    segment: "per-capita",
    title: "Per capita",
    permission: "per_capita.manage",
    permissionPhrase: "manage per-capita billing",
    filenameBase: "per-capita",
  },
  {
    key: "buildings",
    segment: "buildings",
    title: "Buildings",
    permission: "congregation_oversight.manage",
    permissionPhrase: "manage congregation oversight",
    filenameBase: "buildings",
  },
  {
    // Tier 2 (DECISION-345): the finance key also requires two-factor at sign-in.
    key: "insurance_and_loans",
    segment: "insurance-and-loans",
    title: "Insurance and loans",
    permission: "congregation_oversight.finance",
    permissionPhrase: "manage congregation property finances",
    filenameBase: "insurance-and-loans",
  },
] as const;

/**
 * The four reports the dashboard (`/o/<slug>/admin/insights`) has a card for. The
 * dashboard's "no key held is forbidden" rule reads THESE keys only, so a holder
 * of the finance key alone (who has no dashboard card) still gets `forbidden`
 * there, before the unkeyed roster count is reachable (DECISION-342).
 */
export const DASHBOARD_REPORT_KEYS = ["vacant_pulpits", "membership_trend", "viability", "per_capita"] as const;

export const REPORT_SEGMENTS: readonly string[] = REPORTS.map((r) => r.segment);

export function reportByKey(key: ReportKey): ReportDef {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw new Error(`unknown report key: ${key}`);
  return def;
}

/**
 * The audit metadata (DECISION-339): the report key, the row count and the
 * year or window - never a congregation name, a note or an amount.
 */
export interface ReportAuditMetadata {
  organizationId: string;
  report: ReportKey;
  rowCount: number;
  /** Exactly one of these groups is present, or none (vacant pulpits, viability, buildings, insurance and loans). */
  fromYear?: number;
  toYear?: number;
  billingYear?: number;
  allYears?: true;
}

/** Who is reading: the signed-in user and the person row they are at this presbytery. */
export interface ReportViewer {
  userId: string;
  email: string | null;
  personId: string;
  organizationId: string;
}

/** A reader's outcome: the data, or a refusal for a missing key. Never a thrown permission error. */
export type ReportRead<T> = { kind: "ok"; data: T } | { kind: "forbidden" };

/** An export's outcome (the route turns each into a status). */
export type ReportExport =
  | { kind: "ok"; csv: string; rowCount: number; filenameBase: string }
  | { kind: "forbidden" }
  | { kind: "nothing_to_export" };
