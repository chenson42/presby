/**
 * The presbytery reports contract - docs/work-log/2026-11-15-presbytery-reports.md
 * (DECISION-337). PURE: no imports, so a page, a route, a test and the
 * boundaries scan can all read it. The registry is the one place a report is
 * named: its segment under `admin/reports/`, its existing permission key, its
 * title and its CSV filename base. A fifth report has to be registered here,
 * and `contract.test.ts` pins that the route tree matches.
 */

/** The existing global flag every report page and export sits behind (a toggle; bare isFlagEnabled). */
export const REPORTS_FLAG = "org_portal.reports";

/** Reports are for presbyteries only. */
export const REPORT_ORG_TYPES = ["presbytery"] as const;

export const REPORT_KEYS = ["vacant_pulpits", "membership_trend", "viability", "per_capita"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export interface ReportDef {
  readonly key: ReportKey;
  /** The directory under `admin/reports/`; never a UUID (the sibling is `[aboutOrgId]`). */
  readonly segment: string;
  readonly title: string;
  /** One existing permission key per report; an export uses its page's key. */
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
] as const;

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
  /** Exactly one of these groups is present, or none (vacant pulpits, viability). */
  fromYear?: number;
  toYear?: number;
  billingYear?: number;
  allYears?: true;
}
