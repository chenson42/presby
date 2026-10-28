import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { isDayKey } from "@/lib/calendar/month";
import { parseSiteKey } from "@/lib/domains/host";
import {
  PUBLIC_POSTINGS_CAP,
  isEmploymentType,
  isPayUnit,
  type PublicCareers,
  type PublicPosting,
  type PublicPostingRead,
  type PublicPostingSummary,
} from "./contract";
import { SLUG_RE } from "./slug";

/**
 * The careers pages' ONE anonymous read - `presby_public_careers(slug, posting)`
 * (drizzle/0071) on the anonymous `db` connection with NO org context and NO
 * session. docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "API Contract";
 * DECISION-264, DECISION-154.
 *
 * Same shape as `src/lib/public-calendar.ts`: one SECURITY DEFINER function that
 * ALWAYS returns exactly one row, one `try/catch`, a failure logged with the slug
 * only (never the error or its message, which embeds SQL and bound parameters).
 *
 * `failed` IS NOT `unavailable`. The definer collapses every "this organization
 * does not publish openings" reason into one `unavailable` answer, which the
 * platform pages render as the site's 404 and the slot renders as the notice. A
 * read that did not complete says nothing about the organization, so it must not
 * 404 a real page: the pages show a `noindex` notice for `failed`. And a failed
 * read must never become "no openings" - the empty list is reachable only through
 * a successful `available` row (every malformed row maps to `failed`).
 *
 * NO `unstable_cache` / `"use cache"`: freshness after an unpublish rests on the
 * `force-dynamic` site layout. React `cache()` only dedupes two readers on one
 * page within one render. `getPlatformDb()` is not used anywhere here.
 */

const UNAVAILABLE: PublicCareers & PublicPostingRead = { state: "unavailable" };
const FAILED: PublicCareers & PublicPostingRead = { state: "failed" };
/** A posting key this long cannot be a slug; it never reaches the database. */
const POSTING_KEY_MAX = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function nullableCents(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return undefined; // malformed
}

function nullableDay(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && isDayKey(value) ? value : undefined;
}

/** One posting object from the definer, narrowed field by field; `null` when anything is off. */
function mapSummary(raw: unknown): PublicPostingSummary | null {
  if (!isRecord(raw)) return null;
  const slug = nonEmpty(raw.slug);
  const title = nonEmpty(raw.title);
  const location = str(raw.location);
  const summary = str(raw.summary);
  const postedOn = nonEmpty(raw.posted_on);
  const payMin = nullableCents(raw.pay_min_cents);
  const payMax = nullableCents(raw.pay_max_cents);
  const closing = nullableDay(raw.closing_date);
  if (
    slug === null || !SLUG_RE.test(slug) || slug.length > 80 ||
    title === null || location === null || summary === null ||
    postedOn === null || !isDayKey(postedOn) ||
    payMin === undefined || payMax === undefined || closing === undefined ||
    !isEmploymentType(raw.employment_type)
  ) {
    return null;
  }
  const unit = raw.pay_unit;
  if (unit !== null && !isPayUnit(unit)) return null;
  return {
    slug,
    title,
    location,
    employmentType: raw.employment_type,
    payMinCents: payMin,
    payMaxCents: payMax,
    payUnit: unit,
    summary,
    postedOn,
    closingDate: closing,
  };
}

function mapPosting(raw: unknown): PublicPosting | null {
  const summary = mapSummary(raw);
  if (!summary || !isRecord(raw)) return null;
  const description = str(raw.description_md);
  if (description === null) return null;
  return { ...summary, descriptionMd: description };
}

function phoneOf(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? (value === "" ? null : value) : undefined;
}

/**
 * Maps the function's one row to the list union. Exported for the unit test.
 * Anything malformed - a row of the wrong state, a `postings_json` that is not an
 * array (the driver parses jsonb; a string is refused rather than re-parsed),
 * more than the cap, one bad posting, a bad date - is `failed`, never an empty list.
 */
export function mapPublicCareersRow(row: Record<string, unknown> | undefined): PublicCareers {
  if (!row) return FAILED;
  if (row.state === "unavailable") return UNAVAILABLE;
  if (row.state !== "available") return FAILED;

  const name = nonEmpty(row.organization_name);
  const today = nonEmpty(row.org_today);
  const phone = phoneOf(row.contact_phone);
  if (name === null || today === null || !isDayKey(today) || phone === undefined) return FAILED;
  if (!Array.isArray(row.postings_json) || row.postings_json.length > PUBLIC_POSTINGS_CAP) {
    return FAILED;
  }

  const postings: PublicPostingSummary[] = [];
  for (const raw of row.postings_json) {
    const posting = mapSummary(raw);
    if (!posting) return FAILED;
    postings.push(posting);
  }
  return { state: "available", organizationName: name, contactPhone: phone, orgToday: today, postings };
}

/** Maps the function's one row to the single-posting union. Exported for the unit test. */
export function mapPublicPostingRow(row: Record<string, unknown> | undefined): PublicPostingRead {
  if (!row) return FAILED;
  if (row.state === "unavailable") return UNAVAILABLE;
  if (row.state === "not_found") return { state: "not_found" };
  if (row.state !== "open" && row.state !== "closed") return FAILED;

  const name = nonEmpty(row.organization_name);
  const phone = phoneOf(row.contact_phone);
  if (name === null || phone === undefined || !isRecord(row.posting_json)) return FAILED;

  if (row.state === "open") {
    const posting = mapPosting(row.posting_json);
    return posting
      ? { state: "open", organizationName: name, contactPhone: phone, posting }
      : FAILED;
  }

  // closed: the definer projects slug and title ONLY; nothing else is read.
  const slug = nonEmpty(row.posting_json.slug);
  const title = nonEmpty(row.posting_json.title);
  if (slug === null || !SLUG_RE.test(slug) || title === null) return FAILED;
  return { state: "closed", organizationName: name, contactPhone: phone, slug, title };
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []) as Record<
    string,
    unknown
  >[];
}

/**
 * The list read. `slug` is the DATABASE-RETURNED slug (the render path's
 * closure), never a request value; a string that is not slug-shaped never
 * reaches the database. Never throws.
 */
export const readPublicCareers = cache(async function readPublicCareers(
  slug: string,
): Promise<PublicCareers> {
  if (parseSiteKey(slug).kind !== "slug") return UNAVAILABLE;
  try {
    const result = await db.execute(sql`select * from presby_public_careers(${slug}::text)`);
    return mapPublicCareersRow(rowsOf(result)[0]);
  } catch {
    console.error("[public-careers] read failed", { slug });
    return FAILED;
  }
});

/**
 * One posting. `posting` comes from the URL, so it is untrusted: the definer
 * answers `not_found` for anything malformed after the same gate as the list,
 * and a value too long to be a slug is answered here without a query.
 */
export const readPublicPosting = cache(async function readPublicPosting(
  slug: string,
  posting: string,
): Promise<PublicPostingRead> {
  if (parseSiteKey(slug).kind !== "slug") return UNAVAILABLE;
  if (typeof posting !== "string" || posting.length > POSTING_KEY_MAX) return { state: "not_found" };
  try {
    const result = await db.execute(
      sql`select * from presby_public_careers(${slug}::text, ${posting}::text)`,
    );
    return mapPublicPostingRow(rowsOf(result)[0]);
  } catch {
    console.error("[public-careers] read failed", { slug });
    return FAILED;
  }
});
