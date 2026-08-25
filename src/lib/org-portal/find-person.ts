import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";

/**
 * The DB-level half of portal-home find-a-person (Phase 3, Increment 1).
 * Split out from `find-person-action.ts` for the same reason `getDirectory()`
 * lives in `src/lib/directory.ts` rather than inline in a page: this half is
 * genuine SQL worth a real-Postgres test (`find-person.test.ts`, the
 * `directory.test.ts` house pattern), while the action's job — deriving
 * identity from the session, choosing `redirect` vs `fallthrough`, building
 * the href — is orchestration, tested with mocks instead
 * (`find-person-action.test.ts`, the `directory/page.test.tsx` house
 * pattern).
 *
 * GATED ON `directory.view`, THE SAME PERMISSION `getDirectory()` CHECKS,
 * via the identical `presby_has_permission()` SQL call — a search box on
 * the portal home must never surface a person the directory itself would
 * refuse to show. FILTERED BY THE SAME ELIGIBILITY PREDICATE `getDirectory()`
 * uses (current-roll/engagement, not hidden, not merged, not deceased) —
 * copied here rather than imported, because `getDirectory()`'s predicate is
 * inline SQL, not an extracted fragment; Phase 3's cross-cutting risk note
 * (predicate drift) flags this as the single highest-risk repeat in the
 * whole four-increment pipeline and names it explicitly for that reason.
 */

export type FindPersonMatchesResult =
  | { kind: "ok"; personIds: string[] }
  | { kind: "forbidden" };

interface MatchRow {
  person_id: string;
}

/**
 * At most TWO ids — the caller only needs to distinguish zero / one / many,
 * never to enumerate every match, so there is no reason to materialize more.
 */
export async function findPersonMatches(
  personId: string,
  organizationId: string,
  query: string,
): Promise<FindPersonMatchesResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const permissionCheck = await tx.execute(sql`
      select presby_has_permission(
               ${personId}::uuid,
               ${organizationId}::uuid,
               'directory.view'
             ) as allowed
    `);
    const allowed =
      (
        permissionCheck as unknown as {
          rows?: Array<{ allowed?: boolean }>;
        }
      ).rows?.[0]?.allowed === true;
    if (!allowed) {
      return { kind: "forbidden" };
    }

    const like = `%${query}%`;
    const result = await tx.execute(sql`
      select distinct m.person_id as person_id
        from memberships m
        join people p on p.id = m.person_id
        left join person_privacy pp
               on pp.person_id = m.person_id
              and pp.organization_id = m.organization_id
        left join contact_methods cm
               on cm.person_id = p.id and cm.kind in ('email', 'phone')
       where m.organization_id = ${organizationId}::uuid
         and coalesce(pp.directory_hidden, false) = false
         and p.merged_into_id is null
         and p.date_of_death is null
         and (
           m.current_roll in ('active', 'baptized', 'affiliate', 'other_participant')
           or m.engagement_status = 'regular'
         )
         and (
           p.first_name ilike ${like}
           or p.last_name ilike ${like}
           or p.preferred_name ilike ${like}
           or cm.value ilike ${like}
         )
       limit 2
    `);
    const rows = (result as unknown as { rows?: MatchRow[] }).rows ?? [];
    return { kind: "ok", personIds: rows.map((row) => row.person_id) };
  });
}
