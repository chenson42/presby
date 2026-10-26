import "server-only";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { isDayKey } from "@/lib/calendar/month";
import { jobPostings } from "@/lib/db/domain/careers";
import { isPgError, pgErrorField, pgErrorMessages } from "@/lib/db/errors";
import { isCategoryAxisOn, orgFeatureEnabledInTx } from "@/lib/org-features";
import {
  CAREERS_FEATURE_KEY,
  MAX_PUBLISHED_PER_ORG,
  type EmploymentType,
  type PayUnit,
} from "./contract";
import { closingDatePassed, isVisibleToPublic } from "./dates";
import { validateDescription } from "./description";
import {
  firstIssue,
  postingInputSchema,
  postingUpdateSchema,
  type PostingInput,
  type PostingUpdateInput,
} from "./input";
import { slugCandidate, slugFromTitle } from "./slug";

/**
 * The staff side of job postings: every read and write the `(org)` admin pages
 * and server actions make (docs/work-log/2026-10-25-careers-inc1.md, Phase 3
 * "Staff lib"). The anonymous read is `public.ts`; the cron's close is
 * `sweep.ts`; nothing else touches `job_postings`.
 *
 * THE GATE RUNS FIRST, IN THE SAME TRANSACTION, FOR EVERY CALL (a mutation
 * posted while the toggle is off is refused, not just hidden): the per-org
 * toggle `org_portal.careers` composed with the category axis exactly as
 * `orgFeatureEnabledInTx` composes it, then `careers.manage`. `careers.applicants`
 * unlocks nothing here (neither key implies the other). Order matters for what a
 * caller learns: with the toggle off EVERY member sees `feature_off` (Copy S1),
 * and only with it on does a member without the permission see `forbidden`
 * (Copy S2). `withOrgContext` has already refused a non-member by throwing.
 *
 * RLS enforces tenancy, not authorization: it keeps another organization's rows
 * out of every query below, but `careers.manage` is checked HERE. Drafts are
 * tier-1 content and a bug in this file could show one to a member of the same
 * organization - the accepted `paper` residual named in the design.
 *
 * WHAT THE DATABASE OWNS (drizzle/0071): `version`, `posted_on`,
 * `first_published_at`, `closed_at`, `updated_at` and `created_*` are trigger-
 * owned and outside `presby_app`'s column grants, so nothing here ever names
 * them in a write; `id`, `status` and `sort_order` are outside the INSERT grant
 * too, which is why the insert below is raw SQL (Drizzle's `.insert().values()`
 * lists EVERY column of the table with DEFAULT for the omitted ones, and a
 * column privilege is checked against that target list). The compare-and-set is
 * `where version = $loaded`; the trigger bumps the version on a content or
 * status change and not on a `sort_order` change, so a reorder never makes
 * somebody's save stale.
 *
 * AUDIT (DECISION-264): publish, close and reopen write one `audit_events` row
 * each, with `insertAuditRow(tx, ...)` in the SAME transaction as the change,
 * ids and an enum only. Create, edit, reorder and discarding a draft write none
 * (not disclosure changes; nothing was ever public). A fifth writer of
 * `job_postings.status` must audit too; `boundaries.test.ts` pins it.
 */

export interface CareersActor {
  userId: string;
  email: string | null;
}

export type PostingStatus = "draft" | "published" | "closed";

export interface PostingRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  location: string;
  employmentType: EmploymentType;
  payMinCents: number | null;
  payMaxCents: number | null;
  payUnit: PayUnit | null;
  descriptionMd: string;
  /** YYYY-MM-DD */
  closingDate: string | null;
  status: PostingStatus;
  sortOrder: number;
  version: number;
  /** YYYY-MM-DD; null until first published. */
  postedOn: string | null;
  firstPublishedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  /** What visitors see: published, and no closing date or closing date >= org today. */
  visibleToPublic: boolean;
}

export type CareersResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "feature_off"; canManageFeatures: boolean }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  /** The version the caller loaded is no longer the row's. Nothing was written. */
  | { kind: "stale" }
  | { kind: "slug_taken" }
  | { kind: "invalid_input"; field: string; message: string }
  | { kind: "incomplete"; missing: ("title" | "summary" | "location" | "description")[] }
  /** `reopening` is true for closed -> published, so the message can say "reopen" (Copy S8). */
  | { kind: "closing_date_passed"; reopening: boolean }
  | { kind: "publish_limit" }
  | { kind: "invalid_transition" };

type Failure = Exclude<CareersResult<never>, { kind: "ok" }>;

const CAREERS_MANAGE = "careers.manage";
const ORG_FEATURES_MANAGE = "org_features.manage";
const SLUG_TRIES = 50;

const SLUG_FIXED_MESSAGE =
  "The web address can't be changed after an opening is published, because people may have saved or shared it.";
const CLOSING_PASSED_MESSAGE = "The closing date can't be in the past.";

type Row = typeof jobPostings.$inferSelect;

const guid = z.guid();

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []) as Record<string, unknown>[];
}

async function hasPermission(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  key: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(${personId}::uuid, ${organizationId}::uuid, ${key}) as allowed
  `);
  return rowsOf(result)[0]?.allowed === true;
}

/** Toggle (with the category axis), then `careers.manage`; `null` means the gate passed. */
async function gate(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  categoryAxisOn: boolean,
): Promise<Failure | null> {
  const on = await orgFeatureEnabledInTx(tx, organizationId, CAREERS_FEATURE_KEY, categoryAxisOn);
  if (!on) {
    return {
      kind: "feature_off",
      canManageFeatures: await hasPermission(tx, personId, organizationId, ORG_FEATURES_MANAGE),
    };
  }
  if (!(await hasPermission(tx, personId, organizationId, CAREERS_MANAGE))) {
    return { kind: "forbidden" };
  }
  return null;
}

/**
 * A database refusal a caller can act on, mapped outside the aborted
 * transaction. Anything else is a bug or an outage and is rethrown.
 */
function mapDbError(err: unknown): Failure {
  if (isPgError(err, "23505", "job_postings_org_slug_key")) return { kind: "slug_taken" };
  if (pgErrorField(err, "code") === "23514") {
    const text = pgErrorMessages(err);
    if (text.includes("job_postings: cap - at most")) return { kind: "publish_limit" };
    if (/job_postings: the closing date .* has passed/.test(text)) {
      return { kind: "closing_date_passed", reopening: false };
    }
    if (text.includes("is not a legal status change")) return { kind: "invalid_transition" };
    if (text.includes("job_postings: the slug is fixed")) {
      return { kind: "invalid_input", field: "slug", message: SLUG_FIXED_MESSAGE };
    }
  }
  throw err;
}

async function run<T>(
  personId: string,
  organizationId: string,
  body: (tx: OrgTx) => Promise<CareersResult<T>>,
): Promise<CareersResult<T>> {
  // The flag is read ONCE, outside the transaction, as org-features.ts does.
  const categoryAxisOn = await isCategoryAxisOn();
  try {
    return await withOrgContext(personId, organizationId, async (tx) => {
      const refused = await gate(tx, personId, organizationId, categoryAxisOn);
      if (refused) return refused;
      return body(tx);
    });
  } catch (err) {
    return mapDbError(err);
  }
}

async function orgTodayOf(tx: OrgTx, organizationId: string): Promise<string> {
  const result = await tx.execute(
    sql`select to_char(presby_careers_org_today(${organizationId}::uuid), 'YYYY-MM-DD') as today`,
  );
  const today = rowsOf(result)[0]?.today;
  if (typeof today !== "string" || !isDayKey(today)) {
    throw new Error("careers: could not read the organization's date");
  }
  return today;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toPostingRow(row: Row, orgToday: string): PostingRow {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    location: row.location,
    employmentType: row.employmentType,
    payMinCents: row.payMinCents,
    payMaxCents: row.payMaxCents,
    payUnit: row.payUnit,
    descriptionMd: row.descriptionMd,
    closingDate: row.closingDate,
    status: row.status,
    sortOrder: row.sortOrder,
    version: row.version,
    postedOn: row.postedOn,
    firstPublishedAt: iso(row.firstPublishedAt),
    closedAt: iso(row.closedAt),
    updatedAt: iso(row.updatedAt) as string,
    visibleToPublic: isVisibleToPublic(row.status, row.closingDate, orgToday),
  };
}

const STATUS_ORDER: Record<PostingStatus, number> = { published: 0, draft: 1, closed: 2 };

/** Published (display order), then drafts (newest edit first), then closed (most recently closed first). */
function compareForList(a: Row, b: Row): number {
  if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (a.status === "published") {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.postedOn !== b.postedOn) return (b.postedOn ?? "").localeCompare(a.postedOn ?? "");
    return a.id.localeCompare(b.id);
  }
  const at = (r: Row) => (a.status === "closed" ? r.closedAt ?? r.updatedAt : r.updatedAt).getTime();
  return at(b) - at(a);
}

function invalid(error: z.ZodError): Failure {
  return { kind: "invalid_input", ...firstIssue(error) };
}

async function loadRow(tx: OrgTx, organizationId: string, id: string): Promise<Row | null> {
  if (!guid.safeParse(id).success) return null;
  const [row] = await tx
    .select()
    .from(jobPostings)
    .where(and(eq(jobPostings.id, id), eq(jobPostings.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export async function listPostings(
  viewerPersonId: string,
  organizationId: string,
): Promise<CareersResult<{ postings: PostingRow[]; orgToday: string }>> {
  return run<{ postings: PostingRow[]; orgToday: string }>(viewerPersonId, organizationId, async (tx) => {
    const orgToday = await orgTodayOf(tx, organizationId);
    const rows = await tx
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.organizationId, organizationId));
    rows.sort(compareForList);
    return { kind: "ok", data: { postings: rows.map((r) => toPostingRow(r, orgToday)), orgToday } };
  });
}

export async function getPosting(
  viewerPersonId: string,
  organizationId: string,
  postingId: string,
): Promise<CareersResult<{ posting: PostingRow; orgToday: string }>> {
  return run<{ posting: PostingRow; orgToday: string }>(viewerPersonId, organizationId, async (tx) => {
    const row = await loadRow(tx, organizationId, postingId);
    if (!row) return { kind: "not_found" };
    const orgToday = await orgTodayOf(tx, organizationId);
    return { kind: "ok", data: { posting: toPostingRow(row, orgToday), orgToday } };
  });
}

// ---------------------------------------------------------------------------
// create and update
// ---------------------------------------------------------------------------

/** The first of `base`, `base-2` ... `base-50` the organization has not used, or null. */
async function freeSlug(tx: OrgTx, organizationId: string, base: string): Promise<string | null> {
  const result = await tx.execute(sql`
    select slug from job_postings
     where organization_id = ${organizationId}::uuid
       and (slug = ${base} or slug like ${`${base}-%`})
  `);
  const taken = new Set(rowsOf(result).map((r) => String(r.slug)));
  for (let attempt = 1; attempt <= SLUG_TRIES; attempt += 1) {
    const candidate = slugCandidate(base, attempt);
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

export async function createPosting(
  viewerPersonId: string,
  organizationId: string,
  actor: CareersActor,
  input: PostingInput,
): Promise<CareersResult<{ id: string }>> {
  return run<{ id: string }>(viewerPersonId, organizationId, async (tx) => {
    const parsed = postingInputSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;

    const description = validateDescription(data.descriptionMd, { requireNonEmpty: false });
    if (!description.ok) {
      return { kind: "invalid_input", field: "descriptionMd", message: description.errors[0]!.message };
    }

    // A slug the author typed is used exactly as typed (a collision is
    // `slug_taken`, never a silent suffix); a generated one is suffixed.
    const slug = data.slug ?? (await freeSlug(tx, organizationId, slugFromTitle(data.title)));
    if (slug === null) return { kind: "slug_taken" };

    // RAW SQL, deliberately: see the header (column-limited INSERT grant).
    const result = await tx.execute(sql`
      insert into job_postings (
        organization_id, slug, title, summary, location, employment_type,
        pay_min_cents, pay_max_cents, pay_unit, description_md, closing_date,
        created_by, updated_by
      ) values (
        ${organizationId}::uuid, ${slug}, ${data.title}, ${data.summary}, ${data.location},
        ${data.employmentType}, ${data.payMinCents}::integer, ${data.payMaxCents}::integer,
        ${data.payUnit}, ${description.value}, ${data.closingDate}::date,
        ${actor.userId}::uuid, ${actor.userId}::uuid
      )
      returning id
    `);
    const id = rowsOf(result)[0]?.id;
    if (typeof id !== "string") throw new Error("careers: insert returned no id");
    return { kind: "ok", data: { id } };
  });
}

export async function updatePosting(
  viewerPersonId: string,
  organizationId: string,
  actor: CareersActor,
  input: PostingUpdateInput,
): Promise<CareersResult<{ version: number }>> {
  return run<{ version: number }>(viewerPersonId, organizationId, async (tx) => {
    const parsed = postingUpdateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;

    const current = await loadRow(tx, organizationId, data.id);
    if (!current) return { kind: "not_found" };
    if (current.version !== data.version) return { kind: "stale" };

    const description = validateDescription(data.descriptionMd, { requireNonEmpty: false });
    if (!description.ok) {
      return { kind: "invalid_input", field: "descriptionMd", message: description.errors[0]!.message };
    }

    if (current.status === "published") {
      const missing: ("summary" | "location" | "description")[] = [];
      if (data.summary === "") missing.push("summary");
      if (data.location === "") missing.push("location");
      if (description.value.trim() === "") missing.push("description");
      if (missing.length > 0) return { kind: "incomplete", missing };

      // A passed date is refused only when this save CHANGES it to one: a posting
      // whose date has already passed (awaiting the sweep) can still be edited.
      if (data.closingDate !== null && data.closingDate !== current.closingDate) {
        const orgToday = await orgTodayOf(tx, organizationId);
        if (closingDatePassed(data.closingDate, orgToday)) {
          return { kind: "invalid_input", field: "closingDate", message: CLOSING_PASSED_MESSAGE };
        }
      }
    }

    const changesSlug = data.slug !== undefined && data.slug !== current.slug;
    if (changesSlug && current.firstPublishedAt !== null) {
      return { kind: "invalid_input", field: "slug", message: SLUG_FIXED_MESSAGE };
    }

    const [updated] = await tx
      .update(jobPostings)
      .set({
        title: data.title,
        summary: data.summary,
        location: data.location,
        employmentType: data.employmentType,
        payMinCents: data.payMinCents,
        payMaxCents: data.payMaxCents,
        payUnit: data.payUnit,
        descriptionMd: description.value,
        closingDate: data.closingDate,
        updatedBy: actor.userId,
        ...(changesSlug ? { slug: data.slug } : {}),
      })
      .where(
        and(
          eq(jobPostings.id, data.id),
          eq(jobPostings.organizationId, organizationId),
          eq(jobPostings.version, data.version),
        ),
      )
      .returning({ version: jobPostings.version });
    // The posting exists (loaded above), so no row back is a lost race.
    if (!updated) return { kind: "stale" };
    return { kind: "ok", data: { version: updated.version } };
  });
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

type Edge = "publish" | "close" | "reopen" | "discard";

/** The four legal edges; nothing returns to draft and a same-status request is no edge. */
function edgeOf(from: PostingStatus, to: "published" | "closed"): Edge | null {
  if (from === "draft" && to === "published") return "publish";
  if (from === "published" && to === "closed") return "close";
  if (from === "closed" && to === "published") return "reopen";
  if (from === "draft" && to === "closed") return "discard";
  return null;
}

export async function setPostingStatus(
  viewerPersonId: string,
  organizationId: string,
  actor: CareersActor,
  input: { id: string; version: number; to: "published" | "closed" },
): Promise<CareersResult<{ status: PostingStatus; version: number }>> {
  return run<{ status: PostingStatus; version: number }>(viewerPersonId, organizationId, async (tx) => {
    const current = await loadRow(tx, organizationId, input.id);
    if (!current) return { kind: "not_found" };
    if (current.version !== input.version) return { kind: "stale" };

    const edge = edgeOf(current.status, input.to);
    if (edge === null) return { kind: "invalid_transition" };

    if (input.to === "published") {
      const missing: ("title" | "summary" | "location" | "description")[] = [];
      if (current.title.trim() === "") missing.push("title");
      if (current.summary.trim() === "") missing.push("summary");
      if (current.location.trim() === "") missing.push("location");
      if (current.descriptionMd.trim() === "") missing.push("description");
      if (missing.length > 0) return { kind: "incomplete", missing };

      // The stored text was validated when it was saved; a path that skipped
      // that (an import, a manual repair) must not reach the public page.
      const description = validateDescription(current.descriptionMd, { requireNonEmpty: true });
      if (!description.ok) {
        return { kind: "invalid_input", field: "descriptionMd", message: description.errors[0]!.message };
      }

      const orgToday = await orgTodayOf(tx, organizationId);
      if (closingDatePassed(current.closingDate, orgToday)) {
        return { kind: "closing_date_passed", reopening: edge === "reopen" };
      }

      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(jobPostings)
        .where(
          and(
            eq(jobPostings.organizationId, organizationId),
            eq(jobPostings.status, "published"),
            ne(jobPostings.id, current.id),
          ),
        );
      if ((others?.n ?? 0) >= MAX_PUBLISHED_PER_ORG) return { kind: "publish_limit" };
    }

    const [updated] = await tx
      .update(jobPostings)
      .set({ status: input.to, updatedBy: actor.userId })
      .where(
        and(
          eq(jobPostings.id, current.id),
          eq(jobPostings.organizationId, organizationId),
          eq(jobPostings.version, input.version),
        ),
      )
      .returning({ status: jobPostings.status, version: jobPostings.version });
    if (!updated) return { kind: "stale" };

    // A reopened posting that was never published (a discarded draft brought
    // back) is its FIRST publication, and is recorded as one.
    const action =
      edge === "publish" || (edge === "reopen" && current.firstPublishedAt === null)
        ? AUDIT_ACTIONS.CAREERS_POSTING_PUBLISHED
        : edge === "close"
          ? AUDIT_ACTIONS.CAREERS_POSTING_CLOSED
          : edge === "reopen"
            ? AUDIT_ACTIONS.CAREERS_POSTING_REOPENED
            : null; // discard: nothing was ever public
    if (action !== null) {
      await insertAuditRow(tx, {
        action,
        actor,
        resourceType: "job_posting",
        resourceId: current.id,
        metadata: { organizationId, postingId: current.id, via: "staff" },
      });
    }

    return { kind: "ok", data: { status: updated.status, version: updated.version } };
  });
}

// ---------------------------------------------------------------------------
// reorder
// ---------------------------------------------------------------------------

/**
 * Moves a published posting one place within the published sequence and rewrites
 * `sort_order` densely (0..n-1) for the rows that changed. The organization's
 * published rows are locked for the move, so two managers reordering at once
 * serialise. A reorder bumps no `version` and no `updated_at` (the trigger
 * ignores `sort_order`), and writes no audit row.
 */
export async function movePosting(
  viewerPersonId: string,
  organizationId: string,
  _actor: CareersActor,
  input: { id: string; direction: "up" | "down" },
): Promise<CareersResult<{ moved: boolean }>> {
  return run<{ moved: boolean }>(viewerPersonId, organizationId, async (tx) => {
    const published = await tx
      .select({ id: jobPostings.id, sortOrder: jobPostings.sortOrder })
      .from(jobPostings)
      .where(and(eq(jobPostings.organizationId, organizationId), eq(jobPostings.status, "published")))
      .orderBy(asc(jobPostings.sortOrder), desc(jobPostings.postedOn), asc(jobPostings.id))
      .for("update");

    const index = published.findIndex((r) => r.id === input.id);
    if (index === -1) {
      // Not among the published rows: say whether it exists at all.
      const row = await loadRow(tx, organizationId, input.id);
      return row ? { kind: "invalid_transition" } : { kind: "not_found" };
    }

    const neighbour = input.direction === "up" ? index - 1 : index + 1;
    if (neighbour < 0 || neighbour >= published.length) {
      return { kind: "ok", data: { moved: false } };
    }

    const sequence = published.map((r) => r.id);
    [sequence[index], sequence[neighbour]] = [sequence[neighbour]!, sequence[index]!];

    const current = new Map(published.map((r) => [r.id, r.sortOrder]));
    for (const [position, id] of sequence.entries()) {
      if (current.get(id) === position) continue;
      await tx
        .update(jobPostings)
        .set({ sortOrder: position })
        .where(and(eq(jobPostings.id, id), eq(jobPostings.organizationId, organizationId)));
    }
    return { kind: "ok", data: { moved: true } };
  });
}
