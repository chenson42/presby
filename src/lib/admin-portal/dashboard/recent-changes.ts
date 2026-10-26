import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { CHANGE_ACTIONS, UNKNOWN_ORGANIZATION, type ChangeAction } from "./change-labels";
import { readCard, rowsOf, type CardResult } from "./read-card";

/**
 * Recent operator changes (card 12, ruling S1; DECISION-194's accepted residual
 * becomes visible here). One statement over `audit_events` and the public
 * `organizations.name`.
 *
 * WHAT NEVER LEAVES. `metadata` is never selected whole: only three paths of it
 * are read, `metadata->>'organizationId'`, `metadata->>'selfAddressed'` and
 * `metadata->>'inviterIsInvitee'`, and only to find a subject and to narrow the
 * two invitation keys. A revoke's reason, an invitation's recipient or any other
 * metadata cannot reach a component, because nothing here selects it (E17,
 * pinned by boundaries.test.ts and recent-changes.db.test.ts). The only
 * address in a row is the actor's, which the same `ADMIN_AUDIT` holder already
 * reads on /admin/audit.
 *
 * The join compares as text, so a non-uuid `resource_id` (a flag key) can never
 * raise a cast error. The filtered, ordered, limited set is a CTE so the join
 * runs on at most ten rows.
 *
 * Indexes: `ix_audit_action_time (action, created_at)`. Unverified at
 * production volume (E27); Phase 5 runs EXPLAIN.
 */
export const RECENT_CHANGES_LIMIT = 10;

export interface RecentChangeRow {
  action: ChangeAction;
  /** The organization's name, the flag key, or null. "Unknown organization" for an organization that no longer resolves. */
  subject: string | null;
  actorEmail: string | null;
  /** ISO-8601 UTC. */
  at: string;
}

export interface RecentChangesCard {
  rows: RecentChangeRow[];
}

const ORG_SUBJECT_ACTIONS = new Set<string>([
  "org.founding_administrator.revoked",
  "org.treasurer.revoked",
  "invitation.created",
  "invitation.accepted",
]);

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function readRecentChangesCard(): Promise<CardResult<RecentChangesCard>> {
  return readCard("recent-changes", async () => {
    const actions = sql.join(
      CHANGE_ACTIONS.filter((a) => a !== "invitation.created" && a !== "invitation.accepted").map((a) => sql`${a}`),
      sql`, `,
    );
    const result = await getPlatformDb().execute(sql`
      with recent as (
        select id,
               action,
               actor_email,
               created_at,
               case
                 when action in ('org.founding_administrator.revoked', 'org.treasurer.revoked') then resource_id
                 when action in ('invitation.created', 'invitation.accepted') then metadata->>'organizationId'
                 else null
               end as org_ref,
               case when action = 'feature_flag.toggled' then resource_id else null end as flag_key
          from audit_events
         where action in (${actions})
            or (action = 'invitation.created' and metadata->>'selfAddressed' = 'true')
            or (action = 'invitation.accepted' and metadata->>'inviterIsInvitee' = 'true')
         order by created_at desc, id desc
         limit ${RECENT_CHANGES_LIMIT}
      )
      select recent.action, recent.actor_email, recent.created_at, recent.org_ref, recent.flag_key, o.name as org_name
        from recent
        left join organizations o on o.id::text = recent.org_ref
       order by recent.created_at desc, recent.id desc
    `);
    const rows: RecentChangeRow[] = [];
    for (const r of rowsOf(result)) {
      const action = String(r.action);
      const at = toIso(r.created_at);
      if (!(CHANGE_ACTIONS as readonly string[]).includes(action) || at === null) continue;
      let subject: string | null = null;
      if (ORG_SUBJECT_ACTIONS.has(action)) {
        subject = typeof r.org_name === "string" && r.org_name.length > 0 ? r.org_name : UNKNOWN_ORGANIZATION;
      } else if (action === "feature_flag.toggled") {
        subject = typeof r.flag_key === "string" && r.flag_key.length > 0 ? r.flag_key : null;
      }
      rows.push({
        action: action as ChangeAction,
        subject,
        actorEmail: typeof r.actor_email === "string" && r.actor_email.length > 0 ? r.actor_email : null,
        at,
      });
    }
    return { rows };
  });
}
