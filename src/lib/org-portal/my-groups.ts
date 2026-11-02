import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { todayInOrgZone } from "@/lib/shared/org-time";

/**
 * The viewer's OWN groups, for the portal home's "Yours" card (docs/work-log/
 * 2026-10-14-portal-home-alignment.md, B.1; DECISION-162 "Self-reads").
 *
 * WHY THIS IS NOT IN `src/lib/groups.ts`. That module's header promises two
 * things about every export: it checks `groups.manage` first, and every read
 * filters `membership_source = 'managed'`. This function breaks both on
 * purpose — it needs no permission (it is a person reading their own rows, the
 * same trust model as `home-data.ts`) and it includes the derived `session` /
 * `diaconate` groups. Putting it there would make that header false.
 *
 * RLS ON THESE TABLES IS TENANCY-ONLY. The policy hands any member of the org
 * the whole org's roster, so `gm.person_id = viewerPersonId` below is the ONLY
 * thing that makes this a self-read. That is paper, not database. Four
 * conditions hold it, and each is pinned by `my-groups.test.ts`:
 *
 *   1. NO TARGET-PERSON PARAMETER. `viewerPersonId` is the only person id and
 *      callers pass `resolved.org.personId`, never a request value. Never add a
 *      second person-id argument: that is the moment this becomes an ungated
 *      roster reader.
 *   2. THE PROJECTION IS `groups.id` AND `groups.name` ONLY. No role, roster,
 *      `description` or `meets_when`.
 *   3. "TODAY" IS THE ORG'S, from `orgTimeZoneInTx` + `todayInOrgZone`, bound
 *      as a `'YYYY-MM-DD'` string. Never `current_date` / `now()` — the
 *      database session zone is not the congregation's.
 *   4. A DB-BACKED TEST proves another member's rows, another org's rows, the
 *      `active_membership` and `all_memberships` groups and ended memberships
 *      are not returned.
 *
 * A member-facing groups page would get its own `groups.view` permission; this
 * function stays self-only.
 *
 * CURRENCY is date-aware: `starts_on <= today` and (`ends_on is null` or
 * `ends_on > today`). A membership ended today is ended; one starting today has
 * started. This diverges on purpose from the admin roster (`groups.ts` counts
 * `ends_on is null` only).
 *
 * EXCLUDES the two baseline kinds, `derived_from = 'active_membership'` and
 * `derived_from = 'all_memberships'` (Increment 3a, DECISION-232) — filtered on
 * the column, never on the name (a managed group may legally be named "Active
 * Membership"). Those groups are baseline-grant mechanisms, and a pill reading
 * "Active Membership" or "All Current Records" on every home would be a status
 * claim (DECISION-039): the second is held by EVERY live membership, visitors
 * included, and a pill saying so would tell a visitor, and anyone looking over
 * their shoulder, which standing the congregation recorded for them.
 * INCLUDES managed groups and the derived `session` and `diaconate` groups.
 *
 * `exists`, not a join: a person holding two overlapping current rows in one
 * group (a data anomaly the schema allows) would otherwise render duplicate
 * pills with duplicate React keys.
 *
 * Alphabetical, case-insensitive, deterministic. No `limit`: with no
 * destination for "+N more", every group is listed.
 */

export interface ViewerGroup {
  groupId: string;
  name: string;
}

interface GroupRow {
  group_id: string;
  name: string;
}

export async function getViewerGroups(
  viewerPersonId: string,
  organizationId: string,
): Promise<ViewerGroup[]> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const zone = await orgTimeZoneInTx(tx, organizationId);
    const today = todayInOrgZone(new Date(), zone);

    const result = await tx.execute(sql`
      select g.id as group_id, g.name as name
        from groups g
       where g.organization_id = ${organizationId}::uuid
         and g.derived_from is distinct from 'active_membership'
         and g.derived_from is distinct from 'all_memberships'
         and exists (
           select 1
             from group_memberships gm
            where gm.group_id = g.id
              and gm.organization_id = g.organization_id
              and gm.person_id = ${viewerPersonId}::uuid
              and gm.starts_on <= ${today}::date
              and (gm.ends_on is null or gm.ends_on > ${today}::date)
         )
       order by lower(g.name), g.name, g.id
    `);
    const rows = (result as unknown as { rows?: GroupRow[] }).rows ?? [];
    return rows.map((r) => ({ groupId: r.group_id, name: r.name }));
  });
}
