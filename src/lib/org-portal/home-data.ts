import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import {
  checkDirectoryView,
  countHouseholdDirectoryMembers,
} from "@/lib/directory";

/**
 * The portal home's own-row data: the greeting's display name, whether the
 * viewer may use the directory, and the "Yours" card's household.
 *
 * ONE `withOrgContext()` TRANSACTION, `getDirectory()`'s pattern — the
 * membership re-check and every read below run inside the same
 * transaction-scoped `app.current_org_id`, so nothing races between "is this
 * person still at this org" and "what does their own row say".
 *
 * THE DISPLAY NAME is a permission-less read of the viewer's own row:
 * `withOrgContext()`'s membership re-check is its whole gate, and a person
 * reading their own name needs no grant.
 *
 * `canViewDirectory` AND THE HOUSEHOLD BLOCK run `directory.view` through the
 * directory module's own `checkDirectoryView()` (the identical
 * `presby_has_permission()` call `getDirectory()` makes). A household is a
 * list of OTHER PEOPLE, which is directory data even when the scope is the
 * viewer's own household, so it is read only for a `directory.view` holder.
 * `canViewDirectory` also tells the page whether to render find-a-person (whose
 * authority runs only on submit, so the page has to decide visibility first —
 * the one page-level permission read DECISION-162 allows).
 *
 * THE HOUSEHOLD COUNT IS THE DIRECTORY'S COUNT (`countHouseholdDirectoryMembers`),
 * never a private copy of the eligibility rule (F136: this file once counted
 * `ended_on is null` only, so a widow's home said "2 members" while the
 * household page showed one). A household with fewer than TWO eligible people
 * is not shown at all — "Your household contains only you" is noise — so
 * `household` is non-null only when `memberCount >= 2`, by construction, and
 * `YoursZone` renders what it is given with no second copy of the rule (D2).
 *
 * A directory-hidden viewer with one visible housemate therefore gets a count
 * of one (they are not in the count) and no card (D3): they never see a wrong
 * number, and the household stays reachable from the directory. A viewer who
 * is themselves ineligible (a staff anchor; since drizzle/0066 a visitor holds
 * no directory.view at all) but whose household has two eligible
 * members sees "2 members" — it is the directory's count, and the card links to
 * a page showing exactly those two.
 */

export interface PortalHomeHousehold {
  id: string;
  name: string;
  /** The directory's count of this household. `>= 2` by construction. */
  memberCount: number;
}

export interface PortalHomeData {
  displayName: string;
  /** `directory.view`, read once here. Gates find-a-person and the household. */
  canViewDirectory: boolean;
  /** `null`, never an empty object: no household id, no `directory.view`, or
   * fewer than two eligible members. */
  household: PortalHomeHousehold | null;
}

interface PersonRow {
  first_name: string;
  preferred_name: string | null;
  household_id: string | null;
}

interface HouseholdRow {
  name: string;
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

    const canViewDirectory = await checkDirectoryView(
      tx,
      personId,
      organizationId,
    );

    let household: PortalHomeHousehold | null = null;
    if (canViewDirectory && personRow?.household_id) {
      const householdId = personRow.household_id;
      const householdResult = await tx.execute(sql`
        select h.name as name
          from households h
         where h.id = ${householdId}::uuid
           and h.organization_id = ${organizationId}::uuid
      `);
      const householdRow = (
        householdResult as unknown as { rows?: HouseholdRow[] }
      ).rows?.[0];
      if (householdRow) {
        const memberCount = await countHouseholdDirectoryMembers(
          tx,
          organizationId,
          householdId,
        );
        if (memberCount >= 2) {
          household = { id: householdId, name: householdRow.name, memberCount };
        }
      }
    }

    return { displayName, canViewDirectory, household };
  });
}
