import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { rowsOf } from "./db-util";

/**
 * The computed donor -> member link proposal - docs/work-log/
 * 2026-10-15-online-giving.md, Flow 9, G24 and the account-takeover row of the
 * adversarial table. COMPUTED ON READ, NEVER STORED: nothing here writes; a
 * proposal is just a query result a recorder may confirm or dismiss.
 *
 * ONE definition, two callers (the S5 rule): `proposalsForDonor` feeds the
 * donor page, `countLinkProposals` feeds the "needs attention" overview, and
 * both read the SAME fragment below so the overview can never promise a
 * proposal the donor page does not show.
 *
 * A proposal exists when a donor (identified, unmerged, not yet linked, with an
 * email) shares that EXACT normalised email with a person who
 *   - has a `person_identifiers` row of kind `email` that is NOT `is_shared`
 *     (a household's shared mailbox must never auto-suggest a spouse),
 *   - holds a CURRENT membership in THIS organization (never another congregation's),
 *   - is not hidden: `person_privacy.directory_hidden` and `hide_email` both
 *     false (a missing privacy row is the default, not hidden) - a hidden member
 *     can still be linked by hand, but is never SUGGESTED,
 *   - and has not already been dismissed for this donor.
 * The person is not merged. Matching is on `value_normalized` (lower-cased,
 * trimmed), against the donor's own normalised email.
 */

export interface LinkProposal {
  membershipId: string;
  /** The member's name as the confirm dialog shows it (the account-takeover defence). */
  personName: string;
}

/** The proposal rows, optionally for one donor. A fragment, not a statement. */
function proposalRows(organizationId: string, donorId: string | null): SQL {
  const donorClause = donorId ? sql` and d.id = ${donorId}::uuid` : sql``;
  return sql`
    select d.id as donor_id, m.id as membership_id,
           btrim(concat_ws(' ', coalesce(nullif(p.preferred_name, ''), p.first_name), p.last_name)) as person_name
      from giving_donors d
      join person_identifiers pi on pi.kind = 'email' and not pi.is_shared and pi.value_normalized = d.email
      join people p on p.id = pi.person_id and p.merged_into_id is null
      join memberships m on m.person_id = p.id and m.organization_id = d.organization_id and m.ended_on is null
      left join person_privacy pp on pp.person_id = p.id and pp.organization_id = d.organization_id
     where d.organization_id = ${organizationId}::uuid
       and d.kind = 'identified' and d.merged_into_id is null
       and d.linked_membership_id is null and d.email is not null
       and coalesce(pp.directory_hidden, false) = false
       and coalesce(pp.hide_email, false) = false
       and not exists (
         select 1 from giving_donor_link_decisions ld
          where ld.donor_id = d.id and ld.membership_id = m.id and ld.organization_id = d.organization_id)
       ${donorClause}
  `;
}

/** The proposed members for one donor (usually zero or one). */
export async function proposalsForDonor(
  tx: OrgTx,
  organizationId: string,
  donorId: string,
): Promise<LinkProposal[]> {
  const result = await tx.execute(sql`
    select distinct on (x.membership_id) x.membership_id, x.person_name
      from (${proposalRows(organizationId, donorId)}) x
     order by x.membership_id
  `);
  return rowsOf(result).map((r) => ({
    membershipId: String(r.membership_id),
    personName: String(r.person_name),
  }));
}

/** How many donors have at least one proposal waiting - the overview's count. */
export async function countLinkProposals(tx: OrgTx, organizationId: string): Promise<number> {
  const result = await tx.execute(sql`
    select count(distinct x.donor_id)::int as n from (${proposalRows(organizationId, null)}) x
  `);
  return Number(rowsOf(result)[0]?.n ?? 0);
}

export interface LinkSuggestion {
  donorId: string;
  donorName: string;
  membershipId: string;
  personName: string;
}

/** Up to 25 waiting proposals, donor name first, for the donors page's suggestions panel. */
export async function listLinkSuggestions(tx: OrgTx, organizationId: string): Promise<LinkSuggestion[]> {
  const result = await tx.execute(sql`
    select x.donor_id, d.display_name as donor_name, x.membership_id, x.person_name
      from (${proposalRows(organizationId, null)}) x
      join giving_donors d on d.id = x.donor_id and d.organization_id = ${organizationId}::uuid
     order by lower(d.display_name), x.donor_id, x.membership_id
     limit 25
  `);
  return rowsOf(result).map((r) => ({
    donorId: String(r.donor_id),
    donorName: String(r.donor_name),
    membershipId: String(r.membership_id),
    personName: String(r.person_name),
  }));
}
