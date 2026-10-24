import "server-only";
import { sql } from "drizzle-orm";

/**
 * The RLS-side SQL fragments the member directory (`directory.ts`) and the
 * admin Community readers (`community.ts`) share, so the `ended_at` predicate
 * and the canonical order (ER1a) live in ONE copy (ER3b). They assume the
 * caller's `from` clause aliases `people` as `p`. Run on the `presby_app`
 * connection only: `contact_methods` is a global person child whose SELECT
 * policy needs a membership in the current organization, and nothing here
 * widens that.
 *
 * Every fragment filters `ended_at is null` itself. A source scan
 * (`scan.test.ts`) requires any reader file naming the table to either name
 * `ended_at` or import from this file.
 */

/** The person's active main address (display order: main, then oldest). `cm_email.value`. */
export const ACTIVE_MAIN_EMAIL_LATERAL = sql`
      left join lateral (
        select value from contact_methods
         where person_id = p.id and kind = 'email' and ended_at is null
         order by is_primary desc, created_at, id
         limit 1
      ) cm_email on true`;

/** The person's active primary phone. `cm_phone.value`. */
export const ACTIVE_PRIMARY_PHONE_LATERAL = sql`
      left join lateral (
        select value from contact_methods
         where person_id = p.id and kind = 'phone' and ended_at is null
         order by is_primary desc, created_at, id
         limit 1
      ) cm_phone on true`;

/**
 * A staff member's active Work address (ER23, D12): shown only for a person
 * with an OPEN staff position at this organization,
 * `starts_on <= current_date and (ends_on is null or ends_on > current_date)`,
 * read on the RLS connection. Several Work rows: the first in display order.
 * `cm_work.value`. The caller nulls it when it is the SAME address as the main
 * one, so that address is shown once.
 */
export function staffWorkEmailLateral(organizationId: string) {
  return sql`
      left join lateral (
        select cmw.value from contact_methods cmw
         where cmw.person_id = p.id and cmw.kind = 'email'
           and cmw.ended_at is null and cmw.subtype = 'work'
           and exists (
             select 1 from staff_positions sp
              where sp.person_id = p.id
                and sp.organization_id = ${organizationId}::uuid
                and sp.starts_on <= current_date
                and (sp.ends_on is null or sp.ends_on > current_date)
           )
         order by cmw.is_primary desc, cmw.created_at, cmw.id
         limit 1
      ) cm_work on true`;
}

/**
 * Whether ANY active email of the person matches a LIKE pattern. For the admin
 * Community search only (`people.manage`, ER23a): the administrator's own
 * surfaces show every address the person holds, so they may match every one.
 * Never used by a member-facing reader.
 */
export function anyActiveEmailLikeSql(pattern: string) {
  return sql`exists (
          select 1 from contact_methods cma
           where cma.person_id = p.id and cma.kind = 'email' and cma.ended_at is null
             and cma.value ilike ${pattern} escape '\\'
        )`;
}
