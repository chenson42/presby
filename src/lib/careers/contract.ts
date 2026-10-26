/**
 * The careers contract - pure: no `server-only`, no database, no `next/*`. Safe
 * for a client component, the public pages, the slot and the staff lib alike
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "API Contract").
 *
 * `PublicPostingSummary` deliberately has NO id: the public page addresses a
 * posting by its slug, so an id would be a handle with nothing to open and a way
 * to probe (the `PublicCalendarEvent` precedent, DECISION-133). Nothing else an
 * anonymous visitor must not see is on it either: no organization id, no
 * `created_by`, no status, no sort order, no version, no timestamps.
 */

/** The `liveSlot` block name a content author places (`{"type":"liveSlot","props":{"slot":"careers"}}`). */
export const CAREERS_SLOT = "careers";

/**
 * The per-org toggle. The catalog entry in `src/lib/org-features.ts` repeats this
 * string and `presby_public_careers()` (drizzle/0071) composes it in SQL;
 * `public.db.test.ts` pins the three equal.
 */
export const CAREERS_FEATURE_KEY = "org_portal.careers";

/** The public list's row cap; equals `c_cap` in `presby_public_careers()` (drizzle/0071 7b). */
export const PUBLIC_POSTINGS_CAP = 100;
/** Published postings per organization, enforced by the update trigger; equals `c_published_cap` (0071 5b). */
export const MAX_PUBLISHED_PER_ORG = 100;

export const TITLE_MAX = 150;
export const SUMMARY_MAX = 300;
export const LOCATION_MAX = 200;
export const DESCRIPTION_MAX = 20000;
export const SLUG_MAX = 80;
/** Dollars-and-cents ceiling in whole cents, per CHECK `job_postings_pay_range`. */
export const PAY_CENTS_MAX = 100_000_000;
/** A published posting with no closing date is flagged to its managers after this many days. */
export const STALE_AFTER_DAYS = 60;

/** The closing-date window, per CHECK `job_postings_closing_date_range`. */
export const CLOSING_DATE_MIN = "2000-01-01";
export const CLOSING_DATE_MAX = "2100-01-01";

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "intern"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PAY_UNITS = ["hour", "year"] as const;
export type PayUnit = (typeof PAY_UNITS)[number];

export interface PublicPostingSummary {
  slug: string;
  title: string;
  location: string;
  employmentType: EmploymentType;
  payMinCents: number | null;
  payMaxCents: number | null;
  payUnit: PayUnit | null;
  summary: string;
  /** YYYY-MM-DD */
  postedOn: string;
  /** YYYY-MM-DD, the last day applications are accepted; null = open until closed. */
  closingDate: string | null;
}

export interface PublicPosting extends PublicPostingSummary {
  descriptionMd: string;
}

export type PublicCareers =
  | { state: "unavailable" }
  /** The read itself failed. NOT `unavailable`: the pages 404 for one and show a notice for the other. */
  | { state: "failed" }
  | {
      state: "available";
      organizationName: string;
      contactPhone: string | null;
      /** YYYY-MM-DD in the organization's own zone, from SQL. */
      orgToday: string;
      postings: PublicPostingSummary[];
    };

export type PublicPostingRead =
  | { state: "unavailable" }
  | { state: "failed" }
  | { state: "not_found" }
  | { state: "open"; organizationName: string; contactPhone: string | null; posting: PublicPosting }
  | {
      state: "closed";
      organizationName: string;
      contactPhone: string | null;
      slug: string;
      title: string;
    };

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  intern: "Intern",
};

export function employmentTypeLabel(type: EmploymentType): string {
  return EMPLOYMENT_TYPE_LABELS[type];
}

export function isEmploymentType(value: unknown): value is EmploymentType {
  return typeof value === "string" && (EMPLOYMENT_TYPES as readonly string[]).includes(value);
}

export function isPayUnit(value: unknown): value is PayUnit {
  return typeof value === "string" && (PAY_UNITS as readonly string[]).includes(value);
}

/** 4500 -> "$45"; 4550 -> "$45.50"; 5200000 -> "$52,000". No `Intl`/`toLocale*` (ui-standards). */
function formatDollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest === 0 ? `$${grouped}` : `$${grouped}.${String(rest).padStart(2, "0")}`;
}

/**
 * Copy P9. "{$45} to {$60} per hour"; "From {$45} per hour"; "Up to {$60,000} per
 * year"; one amount when min equals max. `null` when no pay was entered (or an
 * amount arrives with no unit, which the database refuses - nothing is guessed).
 */
export function formatPay(
  min: number | null,
  max: number | null,
  unit: PayUnit | null,
): string | null {
  if (min === null && max === null) return null;
  if (unit === null) return null;
  const per = `per ${unit}`;
  if (min !== null && max !== null) {
    if (min === max) return `${formatDollars(min)} ${per}`;
    return `${formatDollars(min)} to ${formatDollars(max)} ${per}`;
  }
  if (min !== null) return `From ${formatDollars(min)} ${per}`;
  return `Up to ${formatDollars(max as number)} ${per}`;
}
