import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { withOrgContext, type OrgTx, type OrganizationType } from "@/lib/authz";
import {
  ORG_FEATURE_CATALOG,
  isCategoryAxisOn,
  orgFeatureEnabledInTx,
  orgTypeAdmitted,
} from "@/lib/org-features";
import { GIVING_TOGGLE_KEY } from "./access-pure";
import { isoTs, rowsOf } from "./db-util";
import { statementIsLatest } from "./statement-staleness";

/**
 * The member's OWN giving: their gifts and their year-end statements -
 * docs/work-log/2026-10-15-online-giving.md, Phase 3 "Member self-read" and
 * Flow 12; DECISION-162 "Self-reads".
 *
 * WHY THIS IS NOT IN `gifts.ts` OR `statements.ts`. Those modules promise a
 * giving key (`giving.view`) on every export. This function needs none - it is
 * a person reading rows that are theirs - so putting it there would make their
 * headers false, and would put a keyless read one import away from the
 * treasurer's ledger. It imports neither of them, and not the statement
 * renderer or the mail queue either (a member route must not pull pdfkit).
 *
 * RLS ON THESE TABLES IS TENANCY-ONLY. The policy hands any member of the org
 * every donor, gift and statement of the org, so the scoping below is the ONLY
 * thing that makes this a self-read. That is paper, not database. Four
 * conditions hold it, and `self.db.test.ts` pins each against a real database:
 *
 *   1. NO TARGET-PERSON PARAMETER. `viewerPersonId` is the only person id here
 *      and callers pass `resolved.org.personId`, never a request value. The
 *      membership is RESOLVED INSIDE, from the viewer's own current
 *      (`ended_on is null`) membership at this organization. Never add a second
 *      person or membership argument: that is the moment this becomes an
 *      ungated ledger reader.
 *   2. THE PROJECTION IS THE MINIMUM FOR DISPLAY. A gift: id, date, the fund's
 *      donor-facing name, the amount, its status, what was reversed. A
 *      statement: id, year, version, issue date, two flags. No donor name,
 *      email or address, no memo, check number or method, no fee, no net, no
 *      recorder, no staleness (the treasurer's concern, not the member's).
 *   3. A DB-BACKED TEST proves another member's rows, another organization's
 *      rows, a household member's rows and a Session member's view are not
 *      returned, and that a directory-hidden member still sees their own.
 *   4. IT LIVES OUTSIDE EVERY PERMISSION-GATED MODULE (above).
 *
 * WHOSE ROWS. A donor is the member's when it is linked to the member's
 * membership (`giving_donors.linked_membership_id`) AND it is a donor ROOT; the
 * rows of every donor merged into that root are the member's too (merges are
 * flat, depth <= 1, so one hop is the whole closure). Ownership is read from the
 * ROOT only: a merged-away donor's own link is frozen at merge time and never
 * consulted, so a stale link on a source can never show one member another
 * member's gifts. NOTHING ELSE confers ownership: not a shared household
 * (`memberships.household_id`), not a Session or other group, not a giving key,
 * not a matching name or email. A giving.view holder reading this gets exactly
 * what any other member gets.
 *
 * LIVE MODE ONLY (P3-17): a Stripe test-mode gift is practice, and a member's
 * history must not show practice as giving (`g.livemode`).
 *
 * ERRORS. A database failure THROWS. The page renders "We can't load your
 * giving history right now"; an empty list would read as lost money (Flow 12).
 * `OrgAccessError` (the membership ended between the page's resolve and this
 * transaction) also propagates.
 *
 * Gate: applicability (`org_portal.giving`'s org-type allow-list), then the org
 * toggle - the same two answers `loadGivingToggle` gives, read in the same
 * transaction as the rows so the answer and the data cannot disagree. Giving
 * has no platform flag (R11).
 */

/** Gifts shown on the page; the library reads one more to learn whether there are more. */
export const MY_GIFTS_LIMIT = 200;

export interface MyGift {
  id: string;
  /** 'YYYY-MM-DD', the date the gift is attributed to (the organization's local date). */
  occurredOn: string;
  /** The fund's donor-facing name (its online display name when it has one). */
  fundName: string;
  amountCents: number;
  status: "succeeded" | "pending" | "failed";
  /** Net of reversals and reinstatements, 0..amountCents. */
  reversedCents: number;
}

export interface MyStatement {
  id: string;
  taxYear: number;
  version: number;
  /** ISO-8601 UTC (`2027-01-12T15:03:09Z`), the shape `<FormattedDate>` renders. */
  issuedAt: string;
  /** A newer version of this statement exists. */
  superseded: boolean;
  /** Issued to a donor that was later merged into the member's donor (DECISION-173 ruling 1). */
  mergedSource: boolean;
}

export type MyGivingResult =
  | { kind: "ok"; gifts: MyGift[]; giftsTruncated: boolean; statements: MyStatement[] }
  /** The organization's type is outside the toggle's allow-list. */
  | { kind: "not_applicable" }
  | { kind: "toggle_off" };

export interface MyStatementForDownload {
  id: string;
  taxYear: number;
  version: number;
  blobAssetId: string;
}

/** The statement a member may download, or nothing: absent, not theirs and "giving is off" are one answer. */
export type FindMyStatementResult = { kind: "ok"; statement: MyStatementForDownload } | { kind: "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Gate = "on" | "not_applicable" | "toggle_off";

/** Applicability, then the toggle, inside the caller's transaction. */
async function readGate(tx: OrgTx, organizationId: string, categoryAxisOn: boolean): Promise<Gate> {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === GIVING_TOGGLE_KEY);
  if (!entry) throw new Error(`self: ${GIVING_TOGGLE_KEY} is not in ORG_FEATURE_CATALOG`);
  const row = rowsOf(
    await tx.execute(sql`select organization_type::text as t from organizations where id = ${organizationId}::uuid`),
  )[0];
  if (!orgTypeAdmitted(entry.orgTypes, (row?.t as OrganizationType | undefined) ?? null)) return "not_applicable";
  const enabled = await orgFeatureEnabledInTx(tx, organizationId, GIVING_TOGGLE_KEY, categoryAxisOn);
  return enabled ? "on" : "toggle_off";
}

/**
 * The donor roots that are the viewer's: identified, unmerged, linked to the
 * viewer's own CURRENT membership here. The ONE definition of "mine"; both reads
 * join through it. `d` below is any donor and `coalesce(d.merged_into_id, d.id)`
 * its root.
 */
function mineRoots(viewerPersonId: string, organizationId: string): SQL {
  return sql`
    select root.id
      from giving_donors root
     where root.organization_id = ${organizationId}::uuid
       and root.kind = 'identified'
       and root.merged_into_id is null
       and root.linked_membership_id in (
         select m.id
           from memberships m
          where m.organization_id = ${organizationId}::uuid
            and m.person_id = ${viewerPersonId}::uuid
            and m.ended_on is null)`;
}

export async function getMyGiving(viewerPersonId: string, organizationId: string): Promise<MyGivingResult> {
  // Read OUTSIDE the transaction: isFlagEnabled runs on its own connection.
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const gate = await readGate(tx, organizationId, categoryAxisOn);
    if (gate !== "on") return { kind: gate };

    const giftRows = rowsOf(
      await tx.execute(sql`
        select g.id::text as id, g.occurred_on::text as occurred_on,
               coalesce(f.online_display_name, f.name) as fund_name,
               g.amount_cents, g.status, coalesce(rv.reversed, 0) as reversed_cents
          from giving_gifts g
          join giving_donors d on d.id = g.donor_id and d.organization_id = g.organization_id
          join giving_funds f on f.id = g.fund_id and f.organization_id = g.organization_id
          left join lateral (
            select sum(case when r.kind = 'reinstatement' then -r.amount_cents else r.amount_cents end)::int as reversed
              from giving_gift_reversals r
             where r.gift_id = g.id and r.organization_id = g.organization_id
          ) rv on true
         where g.organization_id = ${organizationId}::uuid
           and g.livemode
           and coalesce(d.merged_into_id, d.id) in (${mineRoots(viewerPersonId, organizationId)})
         order by g.occurred_on desc, g.created_at desc, g.id desc
         limit ${MY_GIFTS_LIMIT + 1}`),
    );

    const statementRows = rowsOf(
      await tx.execute(sql`
        select s.id::text as id, s.tax_year, s.version, ${isoTs("s.issued_at")} as issued_at,
               not (${statementIsLatest}) as superseded,
               (s.donor_id <> coalesce(d.merged_into_id, d.id)) as merged_source
          from giving_statements s
          join giving_donors d on d.id = s.donor_id and d.organization_id = s.organization_id
         where s.organization_id = ${organizationId}::uuid
           and coalesce(d.merged_into_id, d.id) in (${mineRoots(viewerPersonId, organizationId)})
         order by s.tax_year desc, s.version desc, s.issued_at desc, s.id desc`),
    );

    return {
      kind: "ok" as const,
      giftsTruncated: giftRows.length > MY_GIFTS_LIMIT,
      gifts: giftRows.slice(0, MY_GIFTS_LIMIT).map((r) => ({
        id: String(r.id),
        occurredOn: String(r.occurred_on),
        fundName: String(r.fund_name),
        amountCents: Number(r.amount_cents),
        status: r.status as MyGift["status"],
        reversedCents: Number(r.reversed_cents),
      })),
      statements: statementRows.map((r) => ({
        id: String(r.id),
        taxYear: Number(r.tax_year),
        version: Number(r.version),
        issuedAt: String(r.issued_at),
        superseded: r.superseded === true,
        mergedSource: r.merged_source === true,
      })),
    };
  });
}

/**
 * One statement for the member download route, re-deriving ownership with the
 * SAME scoping as the list (no target-person parameter, membership resolved
 * inside). Returns `not_found` for a malformed id, an id that does not exist,
 * an id that is someone else's, another organization's, and for "giving is off
 * or not applicable" - the route answers all of them with one 404, so nothing in
 * a response says which. (A malformed id skips the query, as the treasurer's
 * lookup does; an id that is well formed costs the same one statement whether it
 * exists, is theirs or is not.)
 */
export async function findMyStatementForDownload(
  viewerPersonId: string,
  organizationId: string,
  statementId: string,
): Promise<FindMyStatementResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const gate = await readGate(tx, organizationId, categoryAxisOn);
    if (gate !== "on" || !UUID.test(statementId)) return { kind: "not_found" as const };
    const row = rowsOf(
      await tx.execute(sql`
        select s.id::text as id, s.tax_year, s.version, s.blob_asset_id::text as blob_asset_id
          from giving_statements s
          join giving_donors d on d.id = s.donor_id and d.organization_id = s.organization_id
         where s.id = ${statementId}::uuid
           and s.organization_id = ${organizationId}::uuid
           and coalesce(d.merged_into_id, d.id) in (${mineRoots(viewerPersonId, organizationId)})`),
    )[0];
    if (!row) return { kind: "not_found" as const };
    return {
      kind: "ok" as const,
      statement: {
        id: String(row.id),
        taxYear: Number(row.tax_year),
        version: Number(row.version),
        blobAssetId: String(row.blob_asset_id),
      },
    };
  });
}
