import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";

/**
 * The "yours" zone's data for the portal-home rebuild (Phase 3, Increment 1).
 *
 * ONE `withOrgContext()` TRANSACTION, `getDirectory()`'s pattern — the
 * membership re-check and both reads below run inside the same
 * transaction-scoped `app.current_org_id`, so nothing races between "is
 * this person still at this org" and "what does their own row say".
 *
 * READS ONLY THE VIEWER'S OWN ROW. No permission check runs here, on
 * purpose: `withOrgContext()`'s own membership re-check IS the entire gate
 * — a person reading their own membership/household summary needs no
 * `directory.view` grant, the same way `getPortalHomeData` differs from
 * `getDirectory()` in scope, not in trust model.
 */

export interface PortalHomeHousehold {
  id: string;
  name: string;
  /** Count of OTHER CURRENT (not-ended) memberships sharing this household,
   * plus the viewer themselves. */
  memberCount: number;
}

export interface PortalHomeData {
  displayName: string;
  /** `null`, never an empty object, when the viewer has no `household_id`
   * (a very live case — presby's `households` link is nullable per
   * membership). */
  household: PortalHomeHousehold | null;
}

interface PersonRow {
  first_name: string;
  preferred_name: string | null;
  household_id: string | null;
}

interface HouseholdRow {
  name: string;
  member_count: string;
}

export async function getPortalHomeData(
  personId: string,
  organizationId: string,
): Promise<PortalHomeData> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const personResult = await tx.execute(sql`
      select p.first_name      as first_name,
             p.preferred_name  as preferred_name,
             m.household_id    as household_id
        from memberships m
        join people p on p.id = m.person_id
       where m.person_id = ${personId}::uuid
         and m.organization_id = ${organizationId}::uuid
       limit 1
    `);
    const personRows =
      (personResult as unknown as { rows?: PersonRow[] }).rows ?? [];
    const personRow = personRows[0];
    const displayName = personRow
      ? (personRow.preferred_name ?? personRow.first_name)
      : "there";

    let household: PortalHomeHousehold | null = null;
    if (personRow?.household_id) {
      const householdResult = await tx.execute(sql`
        select h.name as name,
               count(hm.id) filter (where hm.ended_on is null) as member_count
          from households h
          left join memberships hm
                 on hm.household_id = h.id
                and hm.organization_id = h.organization_id
         where h.id = ${personRow.household_id}::uuid
           and h.organization_id = ${organizationId}::uuid
         group by h.name
      `);
      const householdRows =
        (householdResult as unknown as { rows?: HouseholdRow[] }).rows ?? [];
      const row = householdRows[0];
      if (row) {
        household = {
          id: personRow.household_id,
          name: row.name,
          memberCount: Number(row.member_count),
        };
      }
    }

    return { displayName, household };
  });
}
