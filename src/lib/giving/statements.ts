import "server-only";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { enqueueEmail } from "@/lib/email";
import { getBlobStore } from "@/lib/storage/blob-store";
import { DUPLICATE_PAIRS } from "./donors";
import { errorChain, isoTs, rowsOf } from "./db-util";
import { givingKeysInTx } from "./keys";
import { liveSucceededGift } from "./live-predicate";
import { givingOrigin } from "./origin";
import { statementBlockers } from "./settings-input";
import { COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION, STATEMENT_WORDING_VERSION } from "./statement-policy";
import { statementIsLatest, statementIsStale } from "./statement-staleness";
import {
  decodeListCursor,
  encodeListCursor,
  isValidStatementYear,
  mapIssueError,
  statementIssuingEnabled,
  UUID_PATTERN as UUID,
  type IssueFailureReason,
} from "./statements/pure";
import {
  buildSnapshot,
  composeLines,
  doneeFromSettings,
  type CountingGift,
  type DonorForStatement,
  type SettingsForStatement,
} from "./statements/compose";
import { buildStatementNotice } from "./statements/notice";
import { renderStatementPdf } from "./statements/render-pdf";
import type { StatementDonee, StatementLineSnapshot, StatementSnapshot } from "./statements/snapshot";

/**
 * Contribution statements - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Statements (Batch 5)", R12, DECISION-173/174, and drizzle/0056.
 *
 * WHAT A STATEMENT IS. An issued statement is a FROZEN snapshot (the header and
 * its lines) plus the PDF rendered once at issue and stored through the blob
 * adapter. It is never edited and never re-rendered into the record; a
 * correction is version n+1. "Needs correction" is DERIVED
 * (`statement-staleness.ts`, the one definition) - never a column.
 *
 * WHO MAY DO WHAT (each function re-checks inside its own transaction; the page
 * and action gate is a courtesy, never the authority):
 *   previewStatementRun, listStatements, getStale, loadPrintRun,
 *   findStatementForDownload                  giving.view  (download: view OR manage)
 *   issueStatementBatch, reissueStatement     giving.manage AND giving.view (0056 S1:
 *                                             the insert guard refuses an issuer without both)
 *   recordDelivery, sendStatementNotices      giving.manage
 * Issue and re-issue also refuse in production until the operator sets
 * `GIVING_STATEMENTS_ENABLED=1` (Operator Q6: the CPA must rule on the wording
 * and the four accounting questions before any real statement exists). That is
 * an environment variable, not a platform flag (DECISION-003; no new platform
 * flags before go-live).
 *
 * THE ISSUE SEQUENCE, per donor, ONE tenant transaction each (a failure for one
 * donor never rolls back another):
 *   lock the donor row (FOR UPDATE) -> already issued? -> gather the root group's
 *   counting gifts -> compose -> render the PDF (a pure function of the
 *   snapshot) -> `store()` the blob (its own connection; it commits first, so a
 *   later failure leaves one unreferenced blob - the design's accepted note) ->
 *   insert the header, then the lines -> COMMIT. The database's deferred
 *   consistency triggers run AT COMMIT, so a disagreement between this composer
 *   and the rows surfaces as a REJECTION OF THE TRANSACTION PROMISE, caught in
 *   `issueGroup`'s caller (`mapIssueError`), never around the INSERT.
 * `pdf_sha256` is the sha256 hex of the exact Buffer handed to `store()`; the
 * insert guard compares it with `blob_assets.content_hash`. `issued_at` and
 * `occurred_at` are never supplied (stamped by the guards). `issued_by` /
 * `recorded_by` is the signed-in user's id; the database re-checks the keys.
 * The printed issue date is the org-local date of the transaction's `now()`,
 * which is exactly what the guard stamps as `issued_at` - so a later re-render
 * of the frozen snapshot prints the same date.
 *
 * Audit events are written by the CALLERS (`statements/actions.ts`, the
 * download and print routes) after commit; this module records none.
 *
 * Reads join the donor ROOT (merges are flat, `merged_into_id` depth <= 1) and
 * apply `liveSucceededGift` to every gift aggregate (P3-17): a Stripe test-mode
 * gift is never on a statement.
 */

const BATCH_SIZE = 25;
const NOTICE_BATCH_SIZE = 50;
const LIST_PAGE_SIZE = 50;
const PRINT_RUN_MAX = 1000;

export { isValidStatementYear, mapIssueError, statementIssuingEnabled, type IssueFailureReason };

export type StatementBlocker = "donee_name" | "donee_address";

/** The org's time zone as SQL (`organization_settings.time_zone`, America/New_York when absent: F132). */
function orgTimeZone(organizationId: string): SQL {
  return sql`coalesce((select os.time_zone from organization_settings os where os.organization_id = ${organizationId}::uuid), 'America/New_York')`;
}

/** The current calendar year in the org's own zone. */
async function orgYearNow(tx: OrgTx, organizationId: string): Promise<number> {
  const row = rowsOf(
    await tx.execute(
      sql`select extract(year from (now() at time zone ${orgTimeZone(organizationId)}))::int as y`,
    ),
  )[0];
  return Number(row?.y);
}

// ---------------------------------------------------------------------------
// The counting query (a restatement, in SQL, of drizzle/0056's counting rule)
// ---------------------------------------------------------------------------

/**
 * One row per gift of every donor-ROOT group that counts toward a year:
 * live-mode, succeeded, `occurred_on` inside the year (`g` is the gifts alias
 * `liveSucceededGift` names), with reversals netted as of now and `remaining` =
 * gross - net reversed - (the covered fee unless the policy counts it). Rows
 * with `remaining <= 0` are still returned here; callers filter them.
 */
function countingGifts(organizationId: string, year: number, coveredFeeCounted: boolean): SQL {
  return sql`
    select coalesce(d.merged_into_id, d.id) as root_id, g.id as gift_id, g.occurred_on::text as occurred_on,
           g.source, g.method, f.name as fund_name, g.stock_description, g.stock_quantity::text as stock_quantity,
           g.check_number, g.amount_cents as gross, g.donor_covered_fee_cents as covered,
           coalesce(rv.reversed, 0)::int as reversed,
           (g.amount_cents - coalesce(rv.reversed, 0)
             - case when ${coveredFeeCounted}::boolean then 0 else g.donor_covered_fee_cents end)::int as remaining
      from giving_gifts g
      join giving_donors d on d.id = g.donor_id and d.organization_id = g.organization_id
      join giving_funds f on f.id = g.fund_id and f.organization_id = g.organization_id
      left join lateral (
        select sum(case when r.kind = 'reinstatement' then -r.amount_cents else r.amount_cents end) as reversed
          from giving_gift_reversals r
         where r.organization_id = g.organization_id and r.gift_id = g.id
      ) rv on true
     where g.organization_id = ${organizationId}::uuid
       and ${liveSucceededGift}
       and g.occurred_on between make_date(${year}::int, 1, 1) and make_date(${year}::int, 12, 31)
  `;
}

/** The identified, unmerged donors with at least one counting line, one row each. */
function eligibleRoots(organizationId: string, year: number, coveredFeeCounted: boolean): SQL {
  return sql`
    select c.root_id as donor_id
      from (${countingGifts(organizationId, year, coveredFeeCounted)}) c
      join giving_donors root
        on root.id = c.root_id and root.organization_id = ${organizationId}::uuid
       and root.kind = 'identified' and root.merged_into_id is null
     where c.remaining > 0
     group by c.root_id
  `;
}

// ---------------------------------------------------------------------------
// previewStatementRun
// ---------------------------------------------------------------------------

export interface StatementRunPreview {
  year: number;
  /** Identified donors with at least one counting gift in the year. */
  eligibleDonors: number;
  /** Of those, how many already hold a version-1 statement for the year. */
  alreadyIssued: number;
  /** `eligibleDonors - alreadyIssued`: what an issue run would create. */
  toIssue: number;
  /** Live gifts dated in the year that are still pending, so not on any statement yet. */
  excludedPending: number;
  /** Eligible donors with neither an email nor a mailing address: a statement is issued, but cannot be sent. */
  undeliverable: number;
  undeliverableDonors: Array<{ id: string; name: string }>;
  /** Non-cash (stock) gifts that will appear described and unvalued. */
  nonCash: number;
  /** Cash gifts recorded with no donor ("plate cash"): they never receive a statement. */
  plateCashExcluded: number;
  /** Latest statements for this year that a later gift or reversal has made out of date. */
  stale: number;
  /** Pairs of donors that look like one giver (two statements for one person if left unmerged). */
  possibleDuplicates: number;
  /** Latest statements for the year whose donor is a linked member with an email and no notice sent yet. */
  noticeCandidates: number;
  /** What stops an issue run: the donee's name or address is missing. */
  blockers: StatementBlocker[];
  /** False in production until `GIVING_STATEMENTS_ENABLED=1` (Operator Q6). */
  issuingEnabled: boolean;
}

export type PreviewStatementRunResult = { kind: "ok"; preview: StatementRunPreview } | { kind: "forbidden" } | { kind: "invalid_year" };

export async function previewStatementRun(
  personId: string,
  organizationId: string,
  year: number,
): Promise<PreviewStatementRunResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };
    if (!isValidStatementYear(year, await orgYearNow(tx, organizationId))) return { kind: "invalid_year" };
    const counted = COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION;

    const settings = rowsOf(
      await tx.execute(sql`
        select donee_legal_name, donee_address_line1, donee_city, donee_region, donee_postal_code
          from giving_settings where organization_id = ${organizationId}::uuid
      `),
    )[0];
    const blockers = statementBlockers({
      doneeLegalName: (settings?.donee_legal_name as string | null) ?? null,
      doneeAddressLine1: (settings?.donee_address_line1 as string | null) ?? null,
      doneeCity: (settings?.donee_city as string | null) ?? null,
      doneeRegion: (settings?.donee_region as string | null) ?? null,
      doneePostalCode: (settings?.donee_postal_code as string | null) ?? null,
    });

    const eligibility = rowsOf(
      await tx.execute(sql`
        with roots as (${eligibleRoots(organizationId, year, counted)})
        select count(*)::int as eligible,
               count(*) filter (where exists (
                 select 1 from giving_statements s
                  where s.organization_id = ${organizationId}::uuid and s.donor_id = roots.donor_id
                    and s.tax_year = ${year}::smallint and s.version = 1))::int as already_issued
          from roots
      `),
    )[0];

    const nonCash = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n
          from (${countingGifts(organizationId, year, counted)}) c
          join giving_donors root on root.id = c.root_id and root.organization_id = ${organizationId}::uuid
           and root.kind = 'identified' and root.merged_into_id is null
         where c.remaining > 0 and c.method = 'stock'
      `),
    )[0];

    const undeliverable = rowsOf(
      await tx.execute(sql`
        with roots as (${eligibleRoots(organizationId, year, counted)})
        select d.id, d.display_name, count(*) over ()::int as total
          from roots join giving_donors d on d.id = roots.donor_id and d.organization_id = ${organizationId}::uuid
         where d.email is null and coalesce(btrim(d.address_line1), '') = ''
         order by lower(d.display_name), d.id
         limit 25
      `),
    );

    const pending = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n from giving_gifts g
         where g.organization_id = ${organizationId}::uuid and g.livemode and g.status = 'pending'
           and g.occurred_on between make_date(${year}::int, 1, 1) and make_date(${year}::int, 12, 31)
      `),
    )[0];

    const plate = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n
          from giving_gifts g
          join giving_donors d on d.id = g.donor_id and d.organization_id = g.organization_id
         where g.organization_id = ${organizationId}::uuid and ${liveSucceededGift} and d.kind = 'unidentified'
           and g.occurred_on between make_date(${year}::int, 1, 1) and make_date(${year}::int, 12, 31)
      `),
    )[0];

    const stale = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n from giving_statements s
         where s.organization_id = ${organizationId}::uuid and s.tax_year = ${year}::smallint
           and ${statementIsLatest} and ${statementIsStale}
      `),
    )[0];

    const duplicates = rowsOf(
      await tx.execute(sql`select count(*)::int as n from (${DUPLICATE_PAIRS(organizationId)}) x`),
    )[0];

    const notices = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n from giving_statements s
          join giving_donors d on d.id = s.donor_id and d.organization_id = s.organization_id
         where s.organization_id = ${organizationId}::uuid and s.tax_year = ${year}::smallint
           and ${statementIsLatest}
           and d.linked_membership_id is not null and s.delivery_email is not null
           and not exists (select 1 from giving_statement_deliveries x
                            where x.organization_id = s.organization_id and x.statement_id = s.id
                              and x.channel = 'email_notice')
      `),
    )[0];

    const eligible = Number(eligibility?.eligible ?? 0);
    const alreadyIssued = Number(eligibility?.already_issued ?? 0);
    return {
      kind: "ok",
      preview: {
        year,
        eligibleDonors: eligible,
        alreadyIssued,
        toIssue: eligible - alreadyIssued,
        excludedPending: Number(pending?.n ?? 0),
        undeliverable: Number(undeliverable[0]?.total ?? 0),
        undeliverableDonors: undeliverable.map((r) => ({ id: String(r.id), name: String(r.display_name) })),
        nonCash: Number(nonCash?.n ?? 0),
        plateCashExcluded: Number(plate?.n ?? 0),
        stale: Number(stale?.n ?? 0),
        possibleDuplicates: Number(duplicates?.n ?? 0),
        noticeCandidates: Number(notices?.n ?? 0),
        blockers,
        issuingEnabled: statementIssuingEnabled(),
      },
    } satisfies PreviewStatementRunResult;
  });
}

// ---------------------------------------------------------------------------
// listStatements / getStale
// ---------------------------------------------------------------------------

export type StatementFilter = "all" | "stale" | "not_delivered" | "earlier";
export const STATEMENT_FILTERS: readonly StatementFilter[] = ["all", "stale", "not_delivered", "earlier"];

export interface StatementRow {
  id: string;
  donorId: string;
  donorName: string;
  taxYear: number;
  version: number;
  /** ISO-8601 UTC. */
  issuedAt: string;
  cashTotalCents: number;
  giftCount: number;
  nonCashCount: number;
  hasEmail: boolean;
  hasAddress: boolean;
  /** Nothing supersedes it. */
  isLatest: boolean;
  /** Latest AND a later gift or reversal has made it out of date (derived, never stored). */
  isStale: boolean;
  /** ISO-8601 UTC of the first print_mailed delivery, or null. */
  printMailedAt: string | null;
  /** ISO-8601 UTC of the first email notice, or null. */
  noticeSentAt: string | null;
  /** The notice email bounced (joined from email_queue.bounced_at). */
  noticeBounced: boolean;
}

export type ListStatementsResult =
  | { kind: "ok"; statements: StatementRow[]; nextCursor: string | null }
  | { kind: "forbidden" }
  | { kind: "invalid_year" };

function mapStatementRow(r: Record<string, unknown>): StatementRow {
  return {
    id: String(r.id),
    donorId: String(r.donor_id),
    donorName: String(r.donor_name),
    taxYear: Number(r.tax_year),
    version: Number(r.version),
    issuedAt: String(r.issued_at),
    cashTotalCents: Number(r.cash_total_cents),
    giftCount: Number(r.gift_count),
    nonCashCount: Number(r.non_cash_count),
    hasEmail: r.has_email === true,
    hasAddress: r.has_address === true,
    isLatest: r.is_latest === true,
    isStale: r.is_stale === true,
    printMailedAt: (r.print_mailed_at as string | null) ?? null,
    noticeSentAt: (r.notice_sent_at as string | null) ?? null,
    noticeBounced: r.notice_bounced === true,
  };
}

const STATEMENT_ROW_SELECT = sql`
  select s.id, s.donor_id, s.donor_name, s.tax_year, s.version, ${isoTs("s.issued_at")} as issued_at,
         s.cash_total_cents, s.gift_count, s.non_cash_count,
         (s.delivery_email is not null) as has_email, (coalesce(btrim(s.delivery_line1), '') <> '') as has_address,
         (${statementIsLatest}) as is_latest, (${statementIsLatest} and ${statementIsStale}) as is_stale,
         (select ${isoTs("min(x.occurred_at)")} from giving_statement_deliveries x
           where x.organization_id = s.organization_id and x.statement_id = s.id and x.channel = 'print_mailed') as print_mailed_at,
         (select ${isoTs("min(x.occurred_at)")} from giving_statement_deliveries x
           where x.organization_id = s.organization_id and x.statement_id = s.id and x.channel = 'email_notice') as notice_sent_at,
         exists (select 1 from giving_statement_deliveries x
                   join email_queue q on q.id = x.email_queue_id
                  where x.organization_id = s.organization_id and x.statement_id = s.id
                    and x.channel = 'email_notice' and q.bounced_at is not null) as notice_bounced
    from giving_statements s
`;

/** One page (50) of a year's statements. `giving.view`. Newest version of each donor unless `earlier`. */
export async function listStatements(
  personId: string,
  organizationId: string,
  input: { year: number; filter: StatementFilter; cursor?: string | null },
): Promise<ListStatementsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };
    if (!isValidStatementYear(input.year, await orgYearNow(tx, organizationId))) return { kind: "invalid_year" };

    const clauses: SQL[] = [
      sql`s.organization_id = ${organizationId}::uuid`,
      sql`s.tax_year = ${input.year}::smallint`,
    ];
    if (input.filter === "earlier") clauses.push(sql`not (${statementIsLatest})`);
    else clauses.push(sql`(${statementIsLatest})`);
    if (input.filter === "stale") clauses.push(sql`(${statementIsStale})`);
    if (input.filter === "not_delivered") {
      clauses.push(sql`not exists (select 1 from giving_statement_deliveries x
                                    where x.organization_id = s.organization_id and x.statement_id = s.id)`);
    }
    const cursor = decodeListCursor(input.cursor);
    if (cursor) clauses.push(sql`(lower(s.donor_name), s.id) > (${cursor.name}, ${cursor.id}::uuid)`);

    const result = await tx.execute(sql`
      ${STATEMENT_ROW_SELECT}
      where ${sql.join(clauses, sql` and `)}
      order by lower(s.donor_name), s.id
      limit ${LIST_PAGE_SIZE + 1}
    `);
    const rows = rowsOf(result).map(mapStatementRow);
    const more = rows.length > LIST_PAGE_SIZE;
    const statements = more ? rows.slice(0, LIST_PAGE_SIZE) : rows;
    return {
      kind: "ok",
      statements,
      nextCursor: more ? encodeListCursor(statements[statements.length - 1]!) : null,
    };
  });
}

export type GetStaleResult =
  | { kind: "ok"; statements: Array<{ id: string; donorId: string; donorName: string; taxYear: number; version: number }> }
  | { kind: "forbidden" };

/** Every latest statement, any year, that a later change has made out of date (<= 200). `giving.view`. */
export async function getStale(personId: string, organizationId: string): Promise<GetStaleResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };
    const result = await tx.execute(sql`
      select s.id, s.donor_id, s.donor_name, s.tax_year, s.version
        from giving_statements s
       where s.organization_id = ${organizationId}::uuid and ${statementIsLatest} and ${statementIsStale}
       order by s.tax_year desc, lower(s.donor_name), s.id
       limit 200
    `);
    return {
      kind: "ok",
      statements: rowsOf(result).map((r) => ({
        id: String(r.id),
        donorId: String(r.donor_id),
        donorName: String(r.donor_name),
        taxYear: Number(r.tax_year),
        version: Number(r.version),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Issue and re-issue
// ---------------------------------------------------------------------------

export type IssueBatchResult =
  | {
      kind: "ok";
      issued: number;
      /** Already issued by someone else, or nothing left to count. */
      skipped: number;
      failed: Array<{ donorId: string; donorName: string; reason: IssueFailureReason }>;
      issuedStatements: Array<{ statementId: string; donorId: string; version: number }>;
      /** Pass back as `cursor` for the next call; null when the run is complete. */
      nextCursor: string | null;
    }
  | { kind: "forbidden" }
  | { kind: "disabled" }
  | { kind: "invalid_year" }
  | { kind: "blocked"; blockers: StatementBlocker[] };

interface IssuePrep {
  settings: SettingsForStatement;
  donee: StatementDonee;
}

async function readSettings(tx: OrgTx, organizationId: string): Promise<SettingsForStatement> {
  const row = rowsOf(
    await tx.execute(sql`
      select donee_legal_name, donee_address_line1, donee_address_line2, donee_city, donee_region,
             donee_postal_code, donee_ein, signatory_name, signatory_title, greeting_text, closing_text
        from giving_settings where organization_id = ${organizationId}::uuid
    `),
  )[0];
  const text = (key: string) => (row ? ((row[key] as string | null) ?? null) : null);
  return {
    doneeLegalName: text("donee_legal_name"),
    doneeAddressLine1: text("donee_address_line1"),
    doneeAddressLine2: text("donee_address_line2"),
    doneeCity: text("donee_city"),
    doneeRegion: text("donee_region"),
    doneePostalCode: text("donee_postal_code"),
    doneeEin: text("donee_ein"),
    signatoryName: text("signatory_name"),
    signatoryTitle: text("signatory_title"),
    greetingText: text("greeting_text"),
    closingText: text("closing_text"),
  };
}

type OneResult =
  | { kind: "issued"; statementId: string; version: number }
  | { kind: "already_issued" }
  | { kind: "nothing_to_count" }
  | { kind: "donor_unavailable" }
  | { kind: "not_found" }
  | { kind: "not_latest" }
  | { kind: "not_stale" };

function toCountingGift(r: Record<string, unknown>): CountingGift {
  return {
    giftId: String(r.gift_id),
    occurredOn: String(r.occurred_on),
    source: r.source as "online" | "offline",
    method: (r.method as string | null) ?? null,
    fundName: String(r.fund_name),
    stockDescription: (r.stock_description as string | null) ?? null,
    stockQuantity: (r.stock_quantity as string | null) ?? null,
    checkNumber: (r.check_number as string | null) ?? null,
    grossCents: Number(r.gross),
    coveredFeeCents: Number(r.covered),
    reversedCents: Number(r.reversed),
  };
}

/**
 * Issues one donor's statement (version 1), or the correction of `reissueOf`,
 * inside the caller's tenant transaction - the sequence in the module header.
 * Returns a plain outcome for every expected refusal; a database refusal that
 * surfaces at COMMIT is the caller's to catch (the promise rejects).
 */
async function issueGroup(
  tx: OrgTx,
  args: {
    organizationId: string;
    userId: string;
    year: number;
    donorId: string;
    prep: IssuePrep;
    reissueOf?: string;
  },
): Promise<OneResult> {
  const { organizationId, userId, year, donorId, prep } = args;

  // 1. Lock the donor: concurrent issues for one donor serialize here, and the
  //    loser sees the winner's row below instead of racing the unique key.
  const donorRow = rowsOf(
    await tx.execute(sql`
      select id, kind, display_name, email, address_line1, address_line2, city, region, postal_code, country, merged_into_id
        from giving_donors
       where id = ${donorId}::uuid and organization_id = ${organizationId}::uuid
         for update
    `),
  )[0];
  if (!donorRow || donorRow.merged_into_id !== null || donorRow.kind !== "identified") {
    return { kind: "donor_unavailable" };
  }

  // 2. The predecessor, for a re-issue: it must be the latest and stale; otherwise v1 must not exist yet.
  let version = 1;
  let supersedesId: string | null = null;
  let replacesDate: string | null = null;
  if (args.reissueOf) {
    const prev = rowsOf(
      await tx.execute(sql`
        select s.id, s.donor_id, s.tax_year, s.version,
               (${statementIsLatest}) as is_latest, (${statementIsStale}) as is_stale,
               (s.issued_at at time zone ${orgTimeZone(organizationId)})::date::text as issued_date
          from giving_statements s
         where s.id = ${args.reissueOf}::uuid and s.organization_id = ${organizationId}::uuid
      `),
    )[0];
    if (!prev || String(prev.donor_id) !== donorId || Number(prev.tax_year) !== year) return { kind: "not_found" };
    if (prev.is_latest !== true) return { kind: "not_latest" };
    if (prev.is_stale !== true) return { kind: "not_stale" };
    version = Number(prev.version) + 1;
    supersedesId = String(prev.id);
    replacesDate = String(prev.issued_date);
  } else {
    const existing = rowsOf(
      await tx.execute(sql`
        select 1 from giving_statements
         where organization_id = ${organizationId}::uuid and donor_id = ${donorId}::uuid
           and tax_year = ${year}::smallint and version = 1
      `),
    )[0];
    if (existing) return { kind: "already_issued" };
  }

  // 3. The date the PDF prints: the org-local date of this transaction's now(), the instant
  //    the insert guard stamps as issued_at.
  const issuedDate = String(
    rowsOf(await tx.execute(sql`select (now() at time zone ${orgTimeZone(organizationId)})::date::text as d`))[0]!.d,
  );

  // 4. Gather and compose.
  const gifts = rowsOf(
    await tx.execute(sql`
      select * from (${countingGifts(organizationId, year, COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION)}) c
       where c.root_id = ${donorId}::uuid
       order by c.occurred_on, c.gift_id
    `),
  ).map(toCountingGift);
  const composed = composeLines(gifts, { taxYear: year, coveredFeeCounted: COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION });
  if (composed.giftCount === 0) return { kind: "nothing_to_count" };

  const donor: DonorForStatement = {
    displayName: String(donorRow.display_name),
    email: (donorRow.email as string | null) ?? null,
    addressLine1: (donorRow.address_line1 as string | null) ?? null,
    addressLine2: (donorRow.address_line2 as string | null) ?? null,
    city: (donorRow.city as string | null) ?? null,
    region: (donorRow.region as string | null) ?? null,
    postalCode: (donorRow.postal_code as string | null) ?? null,
    country: (donorRow.country as string | null) ?? null,
  };
  const snapshot = buildSnapshot({
    taxYear: year,
    version,
    wordingVersion: STATEMENT_WORDING_VERSION,
    issuedDate,
    replacesDate,
    donee: prep.donee,
    settings: prep.settings,
    donor,
    composed,
    coveredFeeCounted: COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION,
  });

  // 5. Render once, hash the exact bytes, store them (its own connection, committed first).
  const bytes = await renderStatementPdf([snapshot]);
  const pdfSha256 = createHash("sha256").update(bytes).digest("hex");
  const blob = await getBlobStore().store({ organizationId, bytes, contentType: "application/pdf" });

  // 6. The header, then its lines. The consistency triggers are DEFERRED: they run at COMMIT.
  const header = rowsOf(
    await tx.execute(sql`
      insert into giving_statements (
        organization_id, donor_id, tax_year, version, supersedes_id,
        donee_legal_name, donee_address_line1, donee_address_line2, donee_city, donee_region, donee_postal_code,
        donee_ein, signatory_name, signatory_title, greeting_text, closing_text, wording_version,
        donor_name, delivery_line1, delivery_line2, delivery_city, delivery_region, delivery_postal_code,
        delivery_country, delivery_email, period_start, period_end,
        cash_total_cents, gift_count, non_cash_count, covered_fee_counted, blob_asset_id, pdf_sha256, issued_by)
      values (
        ${organizationId}::uuid, ${donorId}::uuid, ${year}::smallint, ${version}::smallint, ${supersedesId}::uuid,
        ${snapshot.donee.legalName}, ${snapshot.donee.line1}, ${snapshot.donee.line2}, ${snapshot.donee.city},
        ${snapshot.donee.region}, ${snapshot.donee.postalCode},
        ${snapshot.donee.ein}, ${snapshot.donee.signatoryName}, ${snapshot.donee.signatoryTitle},
        ${snapshot.greetingText}, ${snapshot.closingText}, ${snapshot.wordingVersion}::smallint,
        ${snapshot.donorName}, ${snapshot.delivery.line1}, ${snapshot.delivery.line2}, ${snapshot.delivery.city},
        ${snapshot.delivery.region}, ${snapshot.delivery.postalCode},
        ${snapshot.delivery.country}, ${snapshot.delivery.email}, make_date(${year}::int, 1, 1), make_date(${year}::int, 12, 31),
        ${snapshot.cashTotalCents}::bigint, ${snapshot.giftCount}::int, ${snapshot.nonCashCount}::int,
        ${snapshot.coveredFeeCounted}::boolean, ${blob.key}::uuid, ${pdfSha256}, ${userId}::uuid)
      returning id
    `),
  )[0];
  const statementId = String(header!.id);

  const values = snapshot.lines.map(
    (l: StatementLineSnapshot) =>
      sql`(${organizationId}::uuid, ${statementId}::uuid, ${l.giftId}::uuid, ${l.lineNo}::smallint, ${l.occurredOn}::date,
           ${l.fundLabel}, ${l.description}, ${l.kind}, ${l.amountCents}::int, ${l.grossCents}::int,
           ${l.reversedCents}::int, ${l.coveredFeeCents}::int)`,
  );
  await tx.execute(sql`
    insert into giving_statement_lines (organization_id, statement_id, gift_id, line_no, occurred_on, fund_label,
           description, kind, amount_cents, gross_cents, reversed_cents, covered_fee_cents)
    values ${sql.join(values, sql`, `)}
  `);

  return { kind: "issued", statementId, version };
}

/** Postgres error code from the cause chain (no message: Drizzle's messages carry bound parameters). */
function pgCode(err: unknown): string {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth += 1) {
    if (typeof e.code === "string") return e.code;
  }
  return "unknown";
}

function logIssueFailure(organizationId: string, donorId: string, reason: string, err: unknown): void {
  // Ids and a Postgres code only: a Drizzle message carries the bound parameters (names, addresses).
  console.error("[giving-statements] issue failed", { organizationId, donorId, reason, code: pgCode(err) });
}

async function loadPrep(
  personId: string,
  organizationId: string,
  year: number,
  options: { donorIds?: string[]; cursor?: string | null; candidatesWanted: boolean },
): Promise<
  | { kind: "forbidden" }
  | { kind: "invalid_year" }
  | { kind: "blocked"; blockers: StatementBlocker[] }
  | { kind: "ok"; prep: IssuePrep; candidates: Array<{ id: string; name: string }> }
> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage || !has.view) return { kind: "forbidden" } as const;
    if (!isValidStatementYear(year, await orgYearNow(tx, organizationId))) return { kind: "invalid_year" } as const;

    const settings = await readSettings(tx, organizationId);
    const donee = doneeFromSettings(settings);
    if (!donee.ok) return { kind: "blocked", blockers: donee.blockers } as const;
    const prep: IssuePrep = { settings, donee: donee.donee };
    if (!options.candidatesWanted) return { kind: "ok", prep, candidates: [] } as const;

    const clauses: SQL[] = [
      sql`not exists (select 1 from giving_statements s
                       where s.organization_id = ${organizationId}::uuid and s.donor_id = roots.donor_id
                         and s.tax_year = ${year}::smallint and s.version = 1)`,
    ];
    if (options.cursor && UUID.test(options.cursor)) clauses.push(sql`roots.donor_id > ${options.cursor}::uuid`);
    const ids = (options.donorIds ?? []).filter((id) => UUID.test(id));
    if (options.donorIds && options.donorIds.length > 0) {
      if (ids.length === 0) return { kind: "ok", prep, candidates: [] } as const;
      clauses.push(sql`roots.donor_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
    }
    const result = await tx.execute(sql`
      with roots as (${eligibleRoots(organizationId, year, COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION)})
      select roots.donor_id as id, d.display_name as name
        from roots join giving_donors d on d.id = roots.donor_id and d.organization_id = ${organizationId}::uuid
       where ${sql.join(clauses, sql` and `)}
       order by roots.donor_id
       limit ${BATCH_SIZE + 1}
    `);
    return {
      kind: "ok",
      prep,
      candidates: rowsOf(result).map((r) => ({ id: String(r.id), name: String(r.name) })),
    } as const;
  });
}

/**
 * Issues up to 25 donors' version-1 statements for `year`, each in its own
 * transaction. Candidates are identified donors with a counting gift in the year
 * and no version-1 statement yet, in donor-id order; `cursor` is the last donor
 * id of the previous call and the dialog loops until `nextCursor` is null.
 * `donorIds`, when given, restricts the run to those donors.
 */
export async function issueStatementBatch(
  personId: string,
  organizationId: string,
  userId: string,
  input: { year: number; donorIds?: string[]; cursor?: string | null },
): Promise<IssueBatchResult> {
  if (!statementIssuingEnabled()) return { kind: "disabled" };
  const loaded = await loadPrep(personId, organizationId, input.year, {
    donorIds: input.donorIds,
    cursor: input.cursor,
    candidatesWanted: true,
  });
  if (loaded.kind !== "ok") return loaded;

  const batch = loaded.candidates.slice(0, BATCH_SIZE);
  const out = {
    kind: "ok" as const,
    issued: 0,
    skipped: 0,
    failed: [] as Array<{ donorId: string; donorName: string; reason: IssueFailureReason }>,
    issuedStatements: [] as Array<{ statementId: string; donorId: string; version: number }>,
    nextCursor: loaded.candidates.length > BATCH_SIZE ? batch[batch.length - 1]!.id : null,
  };

  for (const candidate of batch) {
    try {
      const result = await withOrgContext(personId, organizationId, (tx) =>
        issueGroup(tx, { organizationId, userId, year: input.year, donorId: candidate.id, prep: loaded.prep }),
      );
      if (result.kind === "issued") {
        out.issued += 1;
        out.issuedStatements.push({ statementId: result.statementId, donorId: candidate.id, version: result.version });
      } else if (result.kind === "donor_unavailable") {
        out.failed.push({ donorId: candidate.id, donorName: candidate.name, reason: "donor_unavailable" });
      } else {
        out.skipped += 1; // already issued by someone else, or nothing left to count
      }
    } catch (err) {
      const mapped = mapIssueError(err);
      if (mapped === "already_issued" || mapped === "already_reissued" || mapped === "nothing_to_count") {
        out.skipped += 1;
        continue;
      }
      const reason: IssueFailureReason = mapped;
      logIssueFailure(organizationId, candidate.id, reason, err);
      out.failed.push({ donorId: candidate.id, donorName: candidate.name, reason });
    }
  }
  return out;
}

export type ReissueResult =
  | { kind: "ok"; statementId: string; version: number }
  | { kind: "forbidden" }
  | { kind: "disabled" }
  | { kind: "blocked"; blockers: StatementBlocker[] }
  | { kind: "not_found" }
  | { kind: "not_latest" }
  | { kind: "not_stale" }
  | { kind: "already_reissued" }
  /** Every gift on the statement has since been reversed: there is nothing to put on a correction. */
  | { kind: "nothing_to_count" }
  | { kind: "failed"; reason: IssueFailureReason };

/**
 * Issues version n+1 of a LATEST, STALE statement: same donor and year, current
 * donee identity and gifts, titled "Corrected statement, replaces statement
 * dated X". The database refuses a fork (a statement is superseded at most
 * once); the "latest, stale only" rule is this function's.
 */
export async function reissueStatement(
  personId: string,
  organizationId: string,
  userId: string,
  statementId: string,
): Promise<ReissueResult> {
  if (!statementIssuingEnabled()) return { kind: "disabled" };
  if (!UUID.test(statementId)) return { kind: "not_found" };

  // Resolve donor and year first (a read), so the one-donor transaction below can lock the donor.
  const found = await withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage || !has.view) return { kind: "forbidden" } as const;
    const row = rowsOf(
      await tx.execute(sql`
        select s.donor_id, s.tax_year from giving_statements s
         where s.id = ${statementId}::uuid and s.organization_id = ${organizationId}::uuid
      `),
    )[0];
    if (!row) return { kind: "not_found" } as const;
    return { kind: "ok", donorId: String(row.donor_id), year: Number(row.tax_year) } as const;
  });
  if (found.kind !== "ok") return found;

  const loaded = await loadPrep(personId, organizationId, found.year, { candidatesWanted: false });
  if (loaded.kind === "forbidden") return { kind: "forbidden" };
  if (loaded.kind === "blocked") return { kind: "blocked", blockers: loaded.blockers };
  if (loaded.kind === "invalid_year") return { kind: "not_found" };

  try {
    const result = await withOrgContext(personId, organizationId, (tx) =>
      issueGroup(tx, {
        organizationId,
        userId,
        year: found.year,
        donorId: found.donorId,
        prep: loaded.prep,
        reissueOf: statementId,
      }),
    );
    switch (result.kind) {
      case "issued":
        return { kind: "ok", statementId: result.statementId, version: result.version };
      case "nothing_to_count":
        return { kind: "nothing_to_count" };
      case "donor_unavailable":
        return { kind: "failed", reason: "donor_unavailable" };
      case "already_issued":
        return { kind: "already_reissued" };
      default:
        return { kind: result.kind };
    }
  } catch (err) {
    const mapped = mapIssueError(err);
    if (mapped === "already_issued" || mapped === "already_reissued") return { kind: "already_reissued" };
    if (mapped === "nothing_to_count") return { kind: "nothing_to_count" };
    logIssueFailure(organizationId, found.donorId, mapped, err);
    return { kind: "failed", reason: mapped };
  }
}

// ---------------------------------------------------------------------------
// recordDelivery (print_mailed)
// ---------------------------------------------------------------------------

export type RecordDeliveryResult =
  | { kind: "ok"; alreadyRecorded: boolean }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/** Logs that a statement was mailed (`print_mailed`). Idempotent. `giving.manage`. */
export async function recordDelivery(
  personId: string,
  organizationId: string,
  userId: string,
  statementId: string,
): Promise<RecordDeliveryResult> {
  if (!UUID.test(statementId)) return { kind: "not_found" };
  try {
    return await withOrgContext(personId, organizationId, async (tx) => {
      const has = await givingKeysInTx(tx, { personId, organizationId });
      if (!has.manage) return { kind: "forbidden" } as const;
      const statement = rowsOf(
        await tx.execute(sql`
          select s.donor_id from giving_statements s
           where s.id = ${statementId}::uuid and s.organization_id = ${organizationId}::uuid
        `),
      )[0];
      if (!statement) return { kind: "not_found" } as const;
      // Serialize concurrent marks on one donor, then check-and-insert.
      await tx.execute(sql`
        select 1 from giving_donors where id = ${String(statement.donor_id)}::uuid
           and organization_id = ${organizationId}::uuid for update
      `);
      const existing = rowsOf(
        await tx.execute(sql`
          select 1 from giving_statement_deliveries
           where organization_id = ${organizationId}::uuid and statement_id = ${statementId}::uuid
             and channel = 'print_mailed'
        `),
      )[0];
      if (existing) return { kind: "ok", alreadyRecorded: true } as const;
      await tx.execute(sql`
        insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by)
        values (${organizationId}::uuid, ${statementId}::uuid, 'print_mailed', ${userId}::uuid)
      `);
      return { kind: "ok", alreadyRecorded: false } as const;
    });
  } catch (err) {
    if (/giving_statement_delivery: not permitted/.test(errorChain(err))) return { kind: "forbidden" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// sendStatementNotices
// ---------------------------------------------------------------------------

export type SendNoticesResult =
  | {
      kind: "ok";
      sent: number;
      skipped: number;
      failed: number;
      /** Pass back as `cursor` for the next call; null when every candidate has been visited. */
      nextCursor: string | null;
      sentStatements: Array<{ statementId: string; version: number }>;
    }
  | { kind: "forbidden" }
  | { kind: "invalid_year" }
  /** NEXT_PUBLIC_APP_URL is unset or not https in production: there is no safe link to put in the email. */
  | { kind: "origin_unconfigured" };

/**
 * Emails a NOTICE (no amounts anywhere, subject included) for up to 50 of the
 * year's latest statements whose donor is linked to a membership and has an
 * email, and logs each as an `email_notice` delivery. Keyset-paged by statement
 * id (`cursor` / `nextCursor`), like the issue run, so a failure cannot make the
 * caller's loop spin on the same rows. The statement itself is
 * never in the email (R12). The queue row is enqueued FIRST and the delivery
 * inserted after it in the same tenant transaction, because the delivery must
 * carry the queue row's id (bounces join on it). `giving.manage`.
 */
export async function sendStatementNotices(
  personId: string,
  organizationId: string,
  userId: string,
  input: { year: number; cursor?: string | null },
): Promise<SendNoticesResult> {
  const origin = givingOrigin();
  const prelude = await withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" } as const;
    if (!isValidStatementYear(input.year, await orgYearNow(tx, organizationId))) return { kind: "invalid_year" } as const;
    const org = rowsOf(
      await tx.execute(sql`select name, slug from organizations where id = ${organizationId}::uuid`),
    )[0];
    const candidates = rowsOf(
      await tx.execute(sql`
        select s.id, s.donor_id, s.version
          from giving_statements s
          join giving_donors d on d.id = s.donor_id and d.organization_id = s.organization_id
         where s.organization_id = ${organizationId}::uuid and s.tax_year = ${input.year}::smallint
           and ${statementIsLatest}
           and d.linked_membership_id is not null and s.delivery_email is not null
           and not exists (select 1 from giving_statement_deliveries x
                            where x.organization_id = s.organization_id and x.statement_id = s.id
                              and x.channel = 'email_notice')
           ${input.cursor && UUID.test(input.cursor) ? sql`and s.id > ${input.cursor}::uuid` : sql``}
         order by s.id
         limit ${NOTICE_BATCH_SIZE + 1}
      `),
    );
    return {
      kind: "ok",
      organizationName: String(org?.name ?? ""),
      slug: String(org?.slug ?? ""),
      candidates: candidates.map((r) => ({ id: String(r.id), donorId: String(r.donor_id), version: Number(r.version) })),
    } as const;
  });
  if (prelude.kind !== "ok") return prelude;
  if (origin === null) return { kind: "origin_unconfigured" };

  const batch = prelude.candidates.slice(0, NOTICE_BATCH_SIZE);
  const link = `${origin}/o/${prelude.slug}/giving`;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const sentStatements: Array<{ statementId: string; version: number }> = [];

  for (const candidate of batch) {
    try {
      const outcome = await withOrgContext(personId, organizationId, async (tx) => {
        // Serialize concurrent sends for one donor; re-check inside the lock.
        await tx.execute(sql`
          select 1 from giving_donors where id = ${candidate.donorId}::uuid
             and organization_id = ${organizationId}::uuid for update
        `);
        const row = rowsOf(
          await tx.execute(sql`
            select s.delivery_email, s.version, (${statementIsLatest}) as is_latest,
                   exists (select 1 from giving_statement_deliveries x
                            where x.organization_id = s.organization_id and x.statement_id = s.id
                              and x.channel = 'email_notice') as noticed
              from giving_statements s
             where s.id = ${candidate.id}::uuid and s.organization_id = ${organizationId}::uuid
          `),
        )[0];
        if (!row || row.is_latest !== true || row.noticed === true || !row.delivery_email) return "skipped" as const;
        const notice = buildStatementNotice({
          organizationName: prelude.organizationName,
          taxYear: input.year,
          link,
          corrected: Number(row.version) > 1,
        });
        const queued = await enqueueEmail({
          to: String(row.delivery_email),
          message: notice.message,
          templateKey: notice.templateKey,
        });
        await tx.execute(sql`
          insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by, email_queue_id)
          values (${organizationId}::uuid, ${candidate.id}::uuid, 'email_notice', ${userId}::uuid, ${queued.id}::uuid)
        `);
        return "sent" as const;
      });
      if (outcome === "sent") {
        sent += 1;
        sentStatements.push({ statementId: candidate.id, version: candidate.version });
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      console.error("[giving-statements] notice failed", { organizationId, statementId: candidate.id, code: pgCode(err) });
    }
  }

  return {
    kind: "ok",
    sent,
    skipped,
    failed,
    nextCursor: prelude.candidates.length > NOTICE_BATCH_SIZE ? batch[batch.length - 1]!.id : null,
    sentStatements,
  };
}

// ---------------------------------------------------------------------------
// Download and the print run
// ---------------------------------------------------------------------------

export type FindStatementResult =
  | { kind: "ok"; statement: { id: string; donorId: string; taxYear: number; version: number; blobAssetId: string } }
  | { kind: "forbidden" }
  /** Absent, malformed, or another organization's: ONE shape for all three. */
  | { kind: "not_found" };

/** The statement a download route streams. `giving.view` OR `giving.manage`. */
export async function findStatementForDownload(
  personId: string,
  organizationId: string,
  statementId: string,
): Promise<FindStatementResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view && !has.manage) return { kind: "forbidden" };
    if (!UUID.test(statementId)) return { kind: "not_found" };
    const row = rowsOf(
      await tx.execute(sql`
        select s.id, s.donor_id, s.tax_year, s.version, s.blob_asset_id
          from giving_statements s
         where s.id = ${statementId}::uuid and s.organization_id = ${organizationId}::uuid
      `),
    )[0];
    if (!row) return { kind: "not_found" };
    return {
      kind: "ok",
      statement: {
        id: String(row.id),
        donorId: String(row.donor_id),
        taxYear: Number(row.tax_year),
        version: Number(row.version),
        blobAssetId: String(row.blob_asset_id),
      },
    };
  });
}

/** A header row (and its lines) back into the snapshot the renderer takes - the print run's input. */
export function snapshotFromRows(
  header: Record<string, unknown>,
  lineRows: Array<Record<string, unknown>>,
): StatementSnapshot {
  const text = (key: string) => (header[key] as string | null) ?? null;
  const lines: StatementLineSnapshot[] = lineRows.map((l) => ({
    lineNo: Number(l.line_no),
    giftId: String(l.gift_id),
    occurredOn: String(l.occurred_on),
    fundLabel: String(l.fund_label),
    description: String(l.description),
    kind: l.kind as "cash" | "non_cash",
    amountCents: l.amount_cents === null || l.amount_cents === undefined ? null : Number(l.amount_cents),
    grossCents: Number(l.gross_cents),
    reversedCents: Number(l.reversed_cents),
    coveredFeeCents: Number(l.covered_fee_cents),
  }));
  return {
    taxYear: Number(header.tax_year),
    version: Number(header.version),
    wordingVersion: Number(header.wording_version),
    issuedDate: String(header.issued_date),
    replacesDate: text("replaces_date"),
    donee: {
      legalName: String(header.donee_legal_name),
      line1: String(header.donee_address_line1),
      line2: text("donee_address_line2"),
      city: String(header.donee_city),
      region: String(header.donee_region),
      postalCode: String(header.donee_postal_code),
      ein: text("donee_ein"),
      signatoryName: text("signatory_name"),
      signatoryTitle: text("signatory_title"),
    },
    greetingText: String(header.greeting_text),
    closingText: String(header.closing_text),
    donorName: String(header.donor_name),
    delivery: {
      line1: text("delivery_line1"),
      line2: text("delivery_line2"),
      city: text("delivery_city"),
      region: text("delivery_region"),
      postalCode: text("delivery_postal_code"),
      country: text("delivery_country"),
      email: text("delivery_email"),
    },
    cashTotalCents: Number(header.cash_total_cents),
    giftCount: Number(header.gift_count),
    nonCashCount: Number(header.non_cash_count),
    coveredFeeCounted: header.covered_fee_counted === true,
    lines,
  };
}

export type LoadPrintRunResult =
  | { kind: "ok"; statements: Array<{ id: string; snapshot: StatementSnapshot }> }
  | { kind: "forbidden" }
  | { kind: "invalid_year" }
  | { kind: "empty" }
  | { kind: "too_many" };

/**
 * The frozen snapshots of every LATEST statement for `year`, ordered by donor
 * name, for the print run (one PDF, rendered on demand by the same renderer
 * that rendered each at issue; never stored). At most 1,000. `giving.view`.
 */
export async function loadPrintRun(
  personId: string,
  organizationId: string,
  year: number,
): Promise<LoadPrintRunResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };
    if (!isValidStatementYear(year, await orgYearNow(tx, organizationId))) return { kind: "invalid_year" };

    const headers = rowsOf(
      await tx.execute(sql`
        select s.*,
               (s.issued_at at time zone ${orgTimeZone(organizationId)})::date::text as issued_date,
               (select (p.issued_at at time zone ${orgTimeZone(organizationId)})::date::text
                  from giving_statements p
                 where p.id = s.supersedes_id and p.organization_id = s.organization_id) as replaces_date
          from giving_statements s
         where s.organization_id = ${organizationId}::uuid and s.tax_year = ${year}::smallint and ${statementIsLatest}
         order by lower(s.donor_name), s.id
         limit ${PRINT_RUN_MAX + 1}
      `),
    );
    if (headers.length === 0) return { kind: "empty" };
    if (headers.length > PRINT_RUN_MAX) return { kind: "too_many" };

    const lineRows = rowsOf(
      await tx.execute(sql`
        select l.statement_id, l.line_no, l.gift_id, l.occurred_on::text as occurred_on, l.fund_label, l.description,
               l.kind, l.amount_cents, l.gross_cents, l.reversed_cents, l.covered_fee_cents
          from giving_statement_lines l
          join giving_statements s on s.id = l.statement_id and s.organization_id = l.organization_id
         where l.organization_id = ${organizationId}::uuid and s.tax_year = ${year}::smallint and ${statementIsLatest}
         order by l.statement_id, l.line_no
      `),
    );
    const byStatement = new Map<string, Array<Record<string, unknown>>>();
    for (const line of lineRows) {
      const key = String(line.statement_id);
      const list = byStatement.get(key) ?? [];
      list.push(line);
      byStatement.set(key, list);
    }
    return {
      kind: "ok",
      statements: headers.map((h) => ({
        id: String(h.id),
        snapshot: snapshotFromRows(h, byStatement.get(String(h.id)) ?? []),
      })),
    };
  });
}

/** One statement's snapshot, for the DB test that re-renders a stored statement (and any future per-statement view). */
export async function loadStatementSnapshot(
  personId: string,
  organizationId: string,
  statementId: string,
): Promise<StatementSnapshot | null> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view && !has.manage) return null;
    const header = rowsOf(
      await tx.execute(sql`
        select s.*,
               (s.issued_at at time zone ${orgTimeZone(organizationId)})::date::text as issued_date,
               (select (p.issued_at at time zone ${orgTimeZone(organizationId)})::date::text
                  from giving_statements p
                 where p.id = s.supersedes_id and p.organization_id = s.organization_id) as replaces_date
          from giving_statements s
         where s.id = ${statementId}::uuid and s.organization_id = ${organizationId}::uuid
      `),
    )[0];
    if (!header) return null;
    const lines = rowsOf(
      await tx.execute(sql`
        select l.line_no, l.gift_id, l.occurred_on::text as occurred_on, l.fund_label, l.description, l.kind,
               l.amount_cents, l.gross_cents, l.reversed_cents, l.covered_fee_cents
          from giving_statement_lines l
         where l.organization_id = ${organizationId}::uuid and l.statement_id = ${statementId}::uuid
         order by l.line_no
      `),
    );
    return snapshotFromRows(header, lines);
  });
}
