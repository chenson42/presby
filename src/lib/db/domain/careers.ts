import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  date,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * Careers, Increment 1: job postings (docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 "Data Model"; DECISION-264/265/266, DECISION-278).
 *
 * This file is for TypeScript's benefit. The ground truth is
 * drizzle/0071_presby_careers.sql, and most of what makes this table safe is
 * NOT expressible in the table builder:
 *
 *   - FORCE ROW LEVEL SECURITY + `tenant_isolation` (0071 section 6).
 *   - Column-limited `presby_app` grants and NO DELETE (0071 section 6).
 *     INSERT: organizationId, slug, title, summary, location, employmentType,
 *     the pay fields, descriptionMd, closingDate, createdBy, updatedBy.
 *     UPDATE: slug, title, summary, location, employmentType, the pay fields,
 *     descriptionMd, closingDate, status, sortOrder, updatedBy.
 *     `version`, `postedOn`, `firstPublishedAt`, `closedAt`, `createdAt` and
 *     `updatedAt` are TRIGGER-OWNED and in no grant: never `.set()` them,
 *     and never give `updatedAt` a Drizzle `$onUpdate` (it would put the
 *     column in the SET list and presby_app would be refused).
 *     `presby_platform` holds nothing (Two Hierarchies).
 *   - `job_postings_guard_update` (0071 section 5b): the four status edges
 *     (draft -> published, draft -> closed, published -> closed,
 *     closed -> published; nothing returns to draft), the immutables, the
 *     slug fixed after first publish, the stamps, the version bump on a
 *     content or status change only, the 100-published cap under a
 *     per-organization advisory lock, and the passed-closing-date refusal.
 *     Binds BOTH connections (F44: getPlatformDb() is neondb_owner).
 *     Refusals are `check_violation` (23514) with a `job_postings:` prefix.
 *   - `job_postings_guard_insert` (0071 section 5a): born `draft`, stamps
 *     forced.
 *   - `job_postings_guard_delete` (0071 section 5c): never deleted except by
 *     the fixture-teardown cascade (`insufficient_privilege`).
 *   - The anonymous read `presby_public_careers()`, the helper
 *     `presby_careers_org_today()` and the owner-only
 *     `presby_careers_sweep()` (0071 section 7).
 */

export const JOB_POSTING_STATUSES = ["draft", "published", "closed"] as const;
export type JobPostingStatus = (typeof JOB_POSTING_STATUSES)[number];

export const JOB_POSTING_EMPLOYMENT_TYPES = ["full_time", "part_time", "intern"] as const;
export type JobPostingEmploymentType = (typeof JOB_POSTING_EMPLOYMENT_TYPES)[number];

export const JOB_POSTING_PAY_UNITS = ["hour", "year"] as const;
export type JobPostingPayUnit = (typeof JOB_POSTING_PAY_UNITS)[number];

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

export const jobPostings = pgTable(
  "job_postings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Cascade reachable only through D10's guarded fixture teardown.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The public URL segment; unique per org; fixed once first published (trigger).
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    location: text("location").notNull().default(""),
    employmentType: text("employment_type")
      .$type<JobPostingEmploymentType>()
      .notNull()
      .default("full_time"),
    payMinCents: integer("pay_min_cents"),
    payMaxCents: integer("pay_max_cents"),
    payUnit: text("pay_unit").$type<JobPostingPayUnit>(),
    descriptionMd: text("description_md").notNull().default(""),
    // The last day applications are accepted, in the org's zone. YYYY-MM-DD.
    closingDate: date("closing_date", { mode: "string" }),
    status: text("status").$type<JobPostingStatus>().notNull().default("draft"),
    // Meaningful for published rows only; publishing puts the row at the top.
    sortOrder: integer("sort_order").notNull().default(0),
    // TRIGGER-OWNED compare-and-set counter.
    version: integer("version").notNull().default(1),
    // TRIGGER-OWNED: stamped once at first publish (owner may supply it then).
    postedOn: date("posted_on", { mode: "string" }),
    // TRIGGER-OWNED: stamped once at first publish, kept forever.
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    // TRIGGER-OWNED: set on close, cleared on reopen.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // NO ACTION, not set null (0071 header: the guard keeps created_by immutable).
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // TRIGGER-OWNED. Deliberately no $onUpdate (see the header).
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Composite Tenant Keys (F2): the target of Increment 2's applications FK.
    unique("job_postings_id_org_key").on(t.id, t.organizationId),
    unique("job_postings_org_slug_key").on(t.organizationId, t.slug),

    index("job_postings_org_status_sort_ix").on(t.organizationId, t.status, t.sortOrder),
    index("job_postings_closing_due_ix")
      .on(t.closingDate)
      .where(sql`${t.status} = 'published' and ${t.closingDate} is not null`),

    check(
      "job_postings_slug_shape",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 1 and 80`,
    ),
    check("job_postings_title_length", sql`char_length(btrim(${t.title})) between 1 and 150`),
    check("job_postings_summary_length", sql`char_length(${t.summary}) <= 300`),
    check("job_postings_location_length", sql`char_length(${t.location}) <= 200`),
    check("job_postings_description_length", sql`char_length(${t.descriptionMd}) <= 20000`),
    check(
      "job_postings_employment_type_allowed",
      sql`${t.employmentType} in (${sqlList(JOB_POSTING_EMPLOYMENT_TYPES)})`,
    ),
    check(
      "job_postings_pay_range",
      sql`(${t.payMinCents} is null or ${t.payMinCents} between 0 and 100000000)
        and (${t.payMaxCents} is null or ${t.payMaxCents} between 0 and 100000000)
        and (${t.payMinCents} is null or ${t.payMaxCents} is null or ${t.payMinCents} <= ${t.payMaxCents})`,
    ),
    check(
      "job_postings_pay_unit_shape",
      sql`(${t.payUnit} is null or ${t.payUnit} in (${sqlList(JOB_POSTING_PAY_UNITS)}))
        and ((${t.payUnit} is null) = (${t.payMinCents} is null and ${t.payMaxCents} is null))`,
    ),
    check(
      "job_postings_closing_date_range",
      sql`${t.closingDate} is null or ${t.closingDate} between date '2000-01-01' and date '2100-01-01'`,
    ),
    check("job_postings_status_allowed", sql`${t.status} in (${sqlList(JOB_POSTING_STATUSES)})`),
    // Only a published row exposes these fields (0071 header deviation note).
    check(
      "job_postings_complete_when_live",
      sql`${t.status} <> 'published'
        or (btrim(${t.summary}) <> '' and btrim(${t.location}) <> '' and btrim(${t.descriptionMd}) <> '')`,
    ),
    check(
      "job_postings_published_stamped",
      sql`${t.status} <> 'published' or ${t.firstPublishedAt} is not null`,
    ),
    check("job_postings_closed_stamped", sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`),
    check(
      "job_postings_posted_stamped",
      sql`(${t.postedOn} is null) = (${t.firstPublishedAt} is null)`,
    ),
    check("job_postings_version_positive", sql`${t.version} >= 1`),
  ],
);
