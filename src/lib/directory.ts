import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";

/**
 * The congregation directory — the first read of real tenant CONTENT, not
 * metadata (DECISION-061). Both the permission check and the
 * privacy-filtered read run inside ONE `withOrgContext()` transaction, so
 * nothing races between "may this person see the directory" and "what does
 * the directory contain".
 *
 * PRIVACY FILTERING IS SQL-LEVEL, NEVER APPLICATION-LEVEL:
 *   - `person_privacy.directory_hidden` excludes the row entirely, in
 *     `WHERE` — never selected, so there is nothing to accidentally render.
 *   - the five field-level flags (`hide_email`, `hide_phone`,
 *     `hide_address`, `hide_birthday`, `hide_photo`) null their own column
 *     via `CASE WHEN` in the `SELECT` list, so a hidden value is never
 *     materialized as a JS value a later refactor could leak.
 *
 * TWO SEPARATE ELIGIBILITY QUESTIONS (DECISION-065), deliberately not
 * conflated:
 *   - who is GRANTED `directory.view`: "any current membership"
 *     (`memberships.ended_on is null`) — the codebase's one existing
 *     definition of "current" — via the `active_membership` derived group
 *     and the resolver's arm 2. This function does not decide that;
 *     `presby_has_permission()` does, and it runs first.
 *   - who APPEARS as a row: the narrower, already-documented
 *     `docs/schema-design.md` §11 formula — `current_roll` in the
 *     roll-member statuses OR `engagement_status = 'regular'`, minus
 *     `directory_hidden`, minus deceased, minus a merged (tombstoned)
 *     person. A first-time visitor with a live membership can browse the
 *     directory without themselves being published in it.
 *
 * A missing `person_privacy` row defaults to the COLUMN'S OWN declared
 * defaults (DECISION-064) via `LEFT JOIN` + `COALESCE`, not to full
 * exclusion — nothing creates that row yet, and defensive-hide would ship
 * an empty directory to every congregation on day one.
 */

export interface DirectoryAddress {
  line1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

export interface DirectoryEntry {
  personId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  /** Nulled per `person_privacy.hide_email` (default false). */
  email: string | null;
  /** Nulled per `person_privacy.hide_phone` (default false). */
  phone: string | null;
  /** Nulled per `person_privacy.hide_address` (default false). */
  address: DirectoryAddress | null;
  /** 'YYYY-MM-DD'. Nulled per `person_privacy.hide_birthday` (default TRUE). */
  dateOfBirth: string | null;
  /** Nulled per `person_privacy.hide_photo` (default false). */
  photoKey: string | null;
}

export type DirectoryResult =
  | { kind: "ok"; entries: DirectoryEntry[] }
  | { kind: "forbidden" };

interface DirectoryRow {
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  date_of_birth: string | null;
  photo_key: string | null;
}

/**
 * Reads the congregation directory for `personId` at `organizationId`.
 *
 * Two DIFFERENT failure shapes, deliberately not merged:
 *
 *   - No `directory.view` grant: returns `{ kind: "forbidden" }`. This is
 *     the common, expected case for a brand-new visitor or a congregation
 *     that has not provisioned the baseline grant.
 *   - Genuinely broken (a DB failure, or `personId` holding no active
 *     membership at `organizationId` at all — `withOrgContext()` throws
 *     `OrgAccessError` in that case): THROWS. Never swallowed into a result
 *     variant, so the caller can tell "denied" apart from "broken" and does
 *     not render "you don't have permission" for a database outage.
 */
export async function getDirectory(
  personId: string,
  organizationId: string,
): Promise<DirectoryResult> {
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

    const result = await tx.execute(sql`
      select
        m.person_id                                          as person_id,
        p.first_name                                          as first_name,
        p.last_name                                           as last_name,
        p.preferred_name                                      as preferred_name,
        case when coalesce(pp.hide_email, false) then null
             else cm_email.value end                           as email,
        case when coalesce(pp.hide_phone, false) then null
             else cm_phone.value end                           as phone,
        case when coalesce(pp.hide_address, false) then null
             else addr.line1 end                               as address_line1,
        case when coalesce(pp.hide_address, false) then null
             else addr.city end                                as address_city,
        case when coalesce(pp.hide_address, false) then null
             else addr.region end                              as address_region,
        case when coalesce(pp.hide_address, false) then null
             else addr.postal_code end                         as address_postal_code,
        case when coalesce(pp.hide_birthday, true) then null
             else p.date_of_birth::text end                    as date_of_birth,
        case when coalesce(pp.hide_photo, false) then null
             else p.photo_key end                              as photo_key
        from memberships m
        join people p on p.id = m.person_id
        left join person_privacy pp
               on pp.person_id = m.person_id
              and pp.organization_id = m.organization_id
        left join lateral (
          select value from contact_methods
           where person_id = p.id and kind = 'email'
           order by is_primary desc, id
           limit 1
        ) cm_email on true
        left join lateral (
          select value from contact_methods
           where person_id = p.id and kind = 'phone'
           order by is_primary desc, id
           limit 1
        ) cm_phone on true
        left join lateral (
          select line1, city, region, postal_code from addresses
           where person_id = p.id
           order by is_primary desc, id
           limit 1
        ) addr on true
       where m.organization_id = ${organizationId}::uuid
         and coalesce(pp.directory_hidden, false) = false
         and p.merged_into_id is null
         and p.date_of_death is null
         and (
           m.current_roll in ('active', 'baptized', 'affiliate', 'other_participant')
           or m.engagement_status = 'regular'
         )
       order by p.last_name, p.first_name, m.person_id
    `);

    const rows = (result as unknown as { rows?: DirectoryRow[] }).rows ?? [];
    const entries: DirectoryEntry[] = rows.map((row) => {
      const hasAddress =
        row.address_line1 !== null ||
        row.address_city !== null ||
        row.address_region !== null ||
        row.address_postal_code !== null;
      return {
        personId: row.person_id,
        firstName: row.first_name,
        lastName: row.last_name,
        preferredName: row.preferred_name,
        email: row.email,
        phone: row.phone,
        address: hasAddress
          ? {
              line1: row.address_line1,
              city: row.address_city,
              region: row.address_region,
              postalCode: row.address_postal_code,
            }
          : null,
        dateOfBirth: row.date_of_birth,
        photoKey: row.photo_key,
      };
    });

    return { kind: "ok", entries };
  });
}
