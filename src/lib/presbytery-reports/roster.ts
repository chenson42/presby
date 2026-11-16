import "server-only";
import { and, eq } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { organizations } from "@/lib/db/domain/org";
import type { RosterEntry } from "./derive";

/**
 * The one roster read in this module (Phase 1 ruling 1, Phase 2): the
 * presbytery's CURRENT member congregations - `parent_id` is this presbytery,
 * type `congregation`, and `lifecycle_status = 'active'`. Every reader starts
 * here and joins its own table to the result, never the other way round, so a
 * congregation of another presbytery (or one that has since moved or closed)
 * can never enter a report through a row that outlived its membership.
 *
 * `parent_id` is the derived cache of the affiliation history: this reads it
 * and never writes it, and no second affiliation reader is built here. New
 * worshiping communities are excluded, as oversight and statistics already
 * exclude them. `organizations` has no RLS by design (the structural table),
 * so the filter above is the whole fence.
 */
export async function readRoster(tx: OrgTx, organizationId: string): Promise<RosterEntry[]> {
  return tx
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(
      and(
        eq(organizations.parentId, organizationId),
        eq(organizations.organizationType, "congregation"),
        eq(organizations.lifecycleStatus, "active"),
      ),
    )
    .orderBy(organizations.name, organizations.id);
}
