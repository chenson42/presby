import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { findDirectoryPersonIds } from "@/lib/directory";

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
 * refuse to show. The eligibility predicate is not repeated here: the search
 * runs through `findDirectoryPersonIds()` in `src/lib/directory.ts`, which
 * composes the one shared `directoryEligibilityWhereSql()` the directory's
 * own readers use (not hidden, not merged, not deceased, relationship not
 * ended, current-roll/engagement). That predicate stays private to
 * `directory.ts`; this module consumes it only through the finder, so there
 * is no hand copy to drift (F136 — the previous copy had already drifted, and
 * the single-match jump could redirect to a person page the directory 404s).
 */

export type FindPersonMatchesResult =
  | { kind: "ok"; personIds: string[] }
  | { kind: "forbidden" };

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

    const personIds = await findDirectoryPersonIds(
      tx,
      organizationId,
      query,
      2,
    );
    return { kind: "ok", personIds };
  });
}
