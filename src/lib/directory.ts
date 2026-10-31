import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import {
  ACTIVE_MAIN_EMAIL_LATERAL,
  ACTIVE_PRIMARY_PHONE_LATERAL,
  staffWorkEmailLateral,
} from "@/lib/contact-methods/sql";

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
 *     `docs/schema-design.md` §11 formula, now asked of the one classifier
 *     (`presby_membership_standing(...) = 'listed'`: a roll in the four, or
 *     engagement regular; Increment 3a, DECISION-233), minus
 *     `directory_hidden`, minus deceased, minus a merged (tombstoned)
 *     person, minus an ended relationship (`ended_on` set — the access
 *     gate's own definition of "current", F136). A first-time visitor with a live membership can browse the
 *     directory without themselves being published in it.
 *
 * A missing `person_privacy` row defaults to the COLUMN'S OWN declared
 * defaults (DECISION-064) via `LEFT JOIN` + `COALESCE`, not to full
 * exclusion — nothing creates that row yet, and defensive-hide would ship
 * an empty directory to every congregation on day one.
 *
 * PHASE 3 INCREMENT 3 — `getHouseholds()`, `getHouseholdDetail()`, and
 * `getPersonDetail()` share the EXACT SAME eligibility predicate and row
 * query `getDirectory()` uses, via `directoryEligibilityWhereSql()` and
 * `queryDirectoryRows()` below, rather than five hand-copied WHERE clauses —
 * the Phase 3 design's own highest-risk item for this whole feature
 * ("privacy predicate drift ... invisible in a diff review that only reads
 * one function at a time"). `getDirectory()`'s own OWN mapping
 * (`mapRow()`) and SQL shape are UNCHANGED by this refactor — same columns,
 * same JOINs, same WHERE, same ORDER BY — only pulled into a function two of
 * its four callers now share.
 *
 * PHASE 3 INCREMENT 4 — `includeHidden` is a REQUEST, never trusted from the
 * caller: `getDirectory()`, `getHouseholds()`, `getHouseholdDetail()`, and
 * `getPersonDetail()` all re-verify it against `directory.view_hidden`
 * (`checkViewHidden()`) INSIDE their own `withOrgContext()` transaction
 * before honoring it. Honoring it drops ONLY the `directory_hidden`
 * (row-level) exclusion from `directoryEligibilityWhereSql()` — the five
 * field-level flags (`hide_email` etc.) are UNCHANGED and keep nulling their
 * own columns regardless of `includeHidden`, per the Phase 3 design's own
 * literal text ("the `directory_hidden` exclusion is dropped and
 * `DirectoryEntry` gains `isHidden: boolean`" — it does not say the
 * field-level CASE WHENs are bypassed too). `isHidden` reflects the row's
 * OWN `directory_hidden` value regardless of whether it was honored, so it
 * is only ever `true` in a result an elevated caller actually requested and
 * was granted — an ordinary caller can never receive a hidden row at all,
 * so the field is vacuously safe to always compute.
 *
 * The deacon derivation (`deriveDeaconsByOrgUnit()`) is a SEPARATE query
 * against `officer_terms`/`people`, deliberately NOT filtered through
 * `directoryEligibilityWhereSql()`/`queryDirectoryRows()` — a deacon is
 * shown BY OFFICE, the same way fpcw-directory (Phase 1's prior-art survey)
 * shows a parish's deacon regardless of that deacon's own directory privacy
 * settings. The Phase 3 design's own roster code fence (now `getParishesOverview()` in parishes.ts) types
 * this as a derivation off `officer_terms`/`people`, not off the
 * privacy-filtered directory read, which is the structural evidence for
 * this ruling — the design text has no separate prose sentence stating it,
 * but the query shape it specifies has only one honest reading.
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
  /** The person's active MAIN address. Nulled per `person_privacy.hide_email` (default false). */
  email: string | null;
  /**
   * ER23: the active Work address of a person with an OPEN staff position at
   * this organization, shown in addition to the main address. Null when there
   * is none, when the Main address IS the Work address (it is shown once, as
   * `email`), and when `hide_email` is set (that hides both).
   */
  workEmail?: string | null;
  /** Nulled per `person_privacy.hide_phone` (default false). */
  phone: string | null;
  /** Nulled per `person_privacy.hide_address` (default false). */
  address: DirectoryAddress | null;
  /** 'YYYY-MM-DD'. Nulled per `person_privacy.hide_birthday` (default TRUE). */
  dateOfBirth: string | null;
  /** Nulled per `person_privacy.hide_photo` (default false). */
  photoKey: string | null;
  /**
   * Increment 3 additions, OPTIONAL — `getDirectory()`'s own `mapRow()`
   * never sets these (its returned entries are byte-for-byte the same shape
   * Increment 2 shipped); only `getHouseholdDetail()`'s and
   * `getPersonDetail()`'s `mapRowExtended()` populates them, for the
   * household-linking and fuller-name-display those two detail surfaces need
   * and the members grid/list do not.
   */
  middleName?: string | null;
  suffix?: string | null;
  /** The person's household at this org, or null if unassigned. */
  householdId?: string | null;
  /** 'head' | 'spouse' | 'child' | 'other', or null. */
  householdRole?: string | null;
  /**
   * Increment 4. Reflects `person_privacy.directory_hidden` for THIS row,
   * regardless of whether `includeHidden` was honored — see this file's own
   * header for why that is safe. Drives the lock-badge UI; an ordinary
   * (non-`directory.view_hidden`) caller can never receive a row where this
   * is `true`, because such a row is excluded from the result entirely.
   */
  isHidden?: boolean;
}

export interface DirectoryPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type DirectoryResult =
  | {
      kind: "ok";
      entries: DirectoryEntry[];
      /** Present only when the caller passed `page`+`pageSize` — omitted is
       * byte-identical to every pre-Increment-5 result shape. */
      pagination?: DirectoryPagination;
    }
  | { kind: "forbidden" };

export interface GetDirectoryOptions {
  /**
   * A free-text fragment matched (case-insensitive, substring) against
   * first name, last name, preferred name, and the email and phone the card
   * SHOWS: the active main address (and a staff member's Work address) unless
   * `hide_email` is set, and the primary phone unless `hide_phone` is set.
   * Trimmed; empty/whitespace-only behaves exactly as omitted.
   *
   * Applied AFTER, never instead of, the existing privacy predicate — the
   * `directory_hidden` exclusion in the WHERE clause runs first and is
   * untouched by `search`. A search matches ONLY what the card would display
   * (F212, ER23a): a hidden email or phone, a non-main address and an ended
   * address never produce a match. Before F212 this matched the raw value even
   * when `hide_*` nulled it in the result, so typing a number confirmed a
   * hidden one by trial; that oracle is closed. The admin Community lists
   * (`community.ts`, `people.manage`) match every active address instead,
   * because the administrator's own surface shows them all.
   */
  search?: string;
  /**
   * Increment 4. A REQUEST to also include `directory_hidden` rows, honored
   * only after `checkViewHidden()` re-confirms the caller holds
   * `directory.view_hidden` inside THIS call's own transaction — never
   * trusted at face value. Omitted/`false` is byte-identical to every
   * pre-Increment-4 call — the regression floor every Increment 1–3 test
   * depends on.
   */
  includeHidden?: boolean;
  /**
   * Increment 5 (pagination/search/status). Narrows to ONE `current_roll`
   * value, replacing the default standing-`listed` eligibility branch entirely
   * for this call (does NOT also apply the standing test — an explicit roll
   * filter, not the listed test). Omitted = today's unfiltered eligibility, unchanged.
   */
  status?: DirectoryStatus;
  /**
   * Founding-admin-directory pipeline (DECISION-197/201): narrows to a SET of
   * `current_roll` values, for the admin Community page's Members view
   * (`['active','baptized','affiliate']`). Like `status` it replaces the
   * default standing-`listed` branch for this call and does not also admit a
   * regular attender with no roll. If `status` is ALSO given the two
   * intersect (`status` keeps its meaning). An EMPTY array matches nothing
   * (never an `in ()` syntax error, never "no filter"); values outside
   * `DIRECTORY_STATUSES` are dropped. The privacy predicate (hidden, merged,
   * deceased, ended) is untouched, and nothing here can admit a visitor or a
   * staff anchor: both have a null `current_roll`.
   */
  rollStatuses?: readonly DirectoryStatus[];
  /**
   * Increment 5. Both `page` and `pageSize` must be given together to
   * paginate at all — omitting either is byte-identical to omitting both,
   * which returns every eligible row with no LIMIT, exactly as every
   * pre-Increment-5 call did. `page` is 1-indexed and clamped server-side
   * to `[1, totalPages]` before the row query runs, so a stale bookmark or
   * back-button to a since-shrunk result set shows the new last page
   * rather than a confusing empty one.
   */
  page?: number;
  pageSize?: number;
}

/** Defined in `./directory-status.ts` (no `server-only` guard) so plain
 * presentational components can import the value without transitively
 * pulling in this whole DB-access module — re-exported here so every
 * existing `@/lib/directory` caller (this file's own server-side readers)
 * sees no difference. */
export { DIRECTORY_STATUSES, type DirectoryStatus } from "./directory-status";
import { DIRECTORY_STATUSES, type DirectoryStatus } from "./directory-status";

/** `Parameters<Parameters<typeof db.transaction>[0]>[0]` — see authz.ts. */
type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface DirectoryRow {
  person_id: string;
  household_id: string | null;
  household_role: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  preferred_name: string | null;
  email: string | null;
  work_email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  date_of_birth: string | null;
  photo_key: string | null;
  is_hidden: boolean;
}

/** A UUID-shaped string. A malformed route param fails this BEFORE any SQL
 * runs — an invalid-uuid Postgres error is a genuine failure (throws), which
 * is the wrong shape for a route segment id that should read as "not found",
 * not "broken". See `getHouseholdDetail()`/`getPersonDetail()`. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE `directory_hidden` expression: a person with no `person_privacy` row is
 * NOT hidden. Needs the `pp` alias (`person_privacy`, joined on the person and
 * the organization) in scope. Exported so `src/lib/parishes.ts` masks names by
 * the same test the directory filters rows by, never by a second hand-typed
 * copy (DECISION-244; `parishes-boundaries.test.ts` forbids the literal there).
 */
export const DIRECTORY_HIDDEN_SQL = sql`coalesce(pp.directory_hidden, false)`;

/**
 * THE shared privacy/eligibility predicate. `getDirectory()`'s own WHERE
 * clause, factored out unchanged so every increment-3 reader composes it
 * rather than re-typing it.
 *
 * `includeHidden` (Increment 4) drops ONLY the `directory_hidden` term —
 * every other eligibility rule (not merged, not deceased, relationship not
 * ended, current-roll/engagement) is UNCHANGED and still applies even to an
 * elevated caller.
 *
 * `m.ended_on is null` is the access gate's own definition of a current
 * relationship (`presby_membership_is_active()`, drizzle/0015) and is NOT a
 * date comparison: a future-dated `ended_on` counts as ended, exactly as the
 * gate treats it. Without this term a person whose relationship had ended but
 * whose `engagement_status` stayed 'regular' was listed (F136).
 * The caller must have already re-verified `directory.view_hidden` before
 * passing `true` here; this function trusts its own argument, same as
 * `queryDirectoryRows()` trusts `opts` — the re-verification itself lives in
 * `checkViewHidden()`, one layer up.
 */
function directoryEligibilityWhereSql(
  includeHidden: boolean,
  status?: DirectoryStatus,
  rollStatuses?: readonly DirectoryStatus[],
) {
  // `rollStatuses`: a closed, allow-listed `in (...)`. Empty (or all values
  // off the list) matches nothing rather than producing `in ()`.
  const rollSet =
    rollStatuses === undefined
      ? undefined
      : rollStatuses.filter((value) =>
          (DIRECTORY_STATUSES as readonly string[]).includes(value),
        );
  const rollSetSql =
    rollSet === undefined
      ? sql`true`
      : rollSet.length === 0
        ? sql`false`
        : sql`m.current_roll in (${sql.join(
            rollSet.map((value) => sql`${value}`),
            sql`, `,
          )})`;
  return sql`
    ${includeHidden ? sql`true` : sql`${DIRECTORY_HIDDEN_SQL} = false`}
    and p.merged_into_id is null
    and p.date_of_death is null
    and m.ended_on is null
    and ${
      status
        ? sql`m.current_roll = ${status}`
        : rollSet !== undefined
          ? sql`true`
          : sql`presby_membership_standing(m.current_roll, m.engagement_status) = 'listed'`
    }
    and ${rollSetSql}
  `;
}

interface QueryDirectoryRowsOptions {
  search?: string;
  /** Narrow to one household — `getHouseholdDetail()`'s member list. */
  householdId?: string;
  /** Narrow to one person — `getPersonDetail()`. */
  personId?: string;
  /** See `GetDirectoryOptions.includeHidden`. Already re-verified by the
   * caller — this function only threads it into the WHERE clause. */
  includeHidden?: boolean;
  /** Increment 5 — see `GetDirectoryOptions.status`. */
  status?: DirectoryStatus;
  /** See `GetDirectoryOptions.rollStatuses`. */
  rollStatuses?: readonly DirectoryStatus[];
  /** Increment 5 — see `GetDirectoryOptions.page`/`pageSize`. Both required
   * together to actually LIMIT/OFFSET; either alone is ignored. */
  page?: number;
  pageSize?: number;
}

/**
 * THE one search predicate (F212, ER23a), shared by the directory read and
 * Find a person so they can never disagree. Names, plus ONLY what the card
 * displays: the main and staff-Work addresses unless `hide_email`, the primary
 * phone unless `hide_phone`. Needs the `p`, `pp`, `cm_email`, `cm_work` and
 * `cm_phone` aliases in scope.
 */
function directorySearchSql(term: string) {
  const like = `%${term}%`;
  return sql`(
               p.first_name ilike ${like}
               or p.last_name ilike ${like}
               or p.preferred_name ilike ${like}
               or (not coalesce(pp.hide_email, false)
                   and (cm_email.value ilike ${like} or cm_work.value ilike ${like}))
               or (not coalesce(pp.hide_phone, false) and cm_phone.value ilike ${like})
             )`;
}

/**
 * THE shared FROM/JOIN/WHERE fragment `queryDirectoryRows()` and
 * `countDirectoryRows()` both build on — written once so a paginated count
 * can never drift out of sync with the rows it's counting (Increment 5's
 * own risk: a mismatched WHERE between the two would show "Page 1 of 3"
 * against a result that actually has 2 pages, or vice versa).
 */
function directoryFromWhereSql(
  organizationId: string,
  opts: QueryDirectoryRowsOptions,
) {
  const trimmedSearch = opts.search?.trim();
  return sql`
      from memberships m
      join people p on p.id = m.person_id
      left join person_privacy pp
             on pp.person_id = m.person_id
            and pp.organization_id = m.organization_id
      ${ACTIVE_MAIN_EMAIL_LATERAL}
      ${staffWorkEmailLateral(organizationId)}
      ${ACTIVE_PRIMARY_PHONE_LATERAL}
      left join lateral (
        select line1, city, region, postal_code from addresses
         where person_id = p.id
         order by is_primary desc, id
         limit 1
      ) addr on true
     where m.organization_id = ${organizationId}::uuid
       and ${directoryEligibilityWhereSql(Boolean(opts.includeHidden), opts.status, opts.rollStatuses)}
       ${trimmedSearch ? sql`and ${directorySearchSql(trimmedSearch)}` : sql``}
       ${
         opts.householdId
           ? sql`and m.household_id = ${opts.householdId}::uuid`
           : sql``
       }
       ${
         opts.personId ? sql`and m.person_id = ${opts.personId}::uuid` : sql``
       }
  `;
}

/**
 * Find-a-person's search (portal home): at most `limit` distinct person ids in
 * `organizationId` whose name, preferred name, or DISPLAYED email or phone
 * matches `query`. The caller has already verified `directory.view` inside
 * this same transaction.
 *
 * Exported as a finder rather than exporting the predicate: eligibility is
 * `directoryEligibilityWhereSql(false)` — the one shared predicate, never a
 * hand copy — so find-person can only ever match someone the directory itself
 * would list (F136). Contact matching uses `directorySearchSql()`, the same
 * predicate the directory's own search uses (F212): only what the card shows,
 * honouring `hide_email` and `hide_phone`, active addresses only. Before F212
 * this matched EVERY contact row, including a hidden person's address.
 */
export async function findDirectoryPersonIds(
  tx: OrgTx,
  organizationId: string,
  query: string,
  limit: number,
): Promise<string[]> {
  const result = await tx.execute(sql`
    select distinct m.person_id as person_id
      from memberships m
      join people p on p.id = m.person_id
      left join person_privacy pp
             on pp.person_id = m.person_id
            and pp.organization_id = m.organization_id
      ${ACTIVE_MAIN_EMAIL_LATERAL}
      ${staffWorkEmailLateral(organizationId)}
      ${ACTIVE_PRIMARY_PHONE_LATERAL}
     where m.organization_id = ${organizationId}::uuid
       and ${directoryEligibilityWhereSql(false)}
       and ${directorySearchSql(query)}
     limit ${limit}
  `);
  return (
    (result as unknown as { rows?: Array<{ person_id: string }> }).rows ?? []
  ).map((row) => row.person_id);
}

/**
 * Does `personId` appear in the directory of `organizationId`? One yes/no,
 * built on the SAME eligibility predicate the directory lists with
 * (`directoryEligibilityWhereSql(false)`: not hidden, not merged, not deceased,
 * relationship current, on the roll or a regular attender) - never a hand copy,
 * so it can only ever say yes to someone `getDirectory()` would list (F136).
 *
 * Added for reimbursements (docs/work-log/2026-10-25-treasury-inc1.md, EC17):
 * the beneficiary picker offers only listed people, and the action that
 * receives a POSTED id re-checks it here, so a `directory_hidden` member cannot
 * be named by hand-posting an id. It judges eligibility only; whether the
 * CALLER may see the directory is `checkDirectoryView`'s question, asked by the
 * caller.
 */
export async function isDirectoryListedPerson(
  tx: OrgTx,
  organizationId: string,
  personId: string,
): Promise<boolean> {
  if (!UUID_RE.test(personId)) return false;
  const result = await tx.execute(sql`
    select 1 as listed
      from memberships m
      join people p on p.id = m.person_id
      left join person_privacy pp
             on pp.person_id = m.person_id
            and pp.organization_id = m.organization_id
     where m.organization_id = ${organizationId}::uuid
       and m.person_id = ${personId}::uuid
       and ${directoryEligibilityWhereSql(false)}
     limit 1
  `);
  return ((result as unknown as { rows?: unknown[] }).rows ?? []).length > 0;
}

/**
 * THE shared row query. Same SELECT list, same JOINs, same eligibility
 * predicate, same ORDER BY `getDirectory()` has always used — `opts`
 * narrows the result set (search text, status, one household, one person)
 * without touching the privacy/eligibility logic itself, so there is
 * exactly one place that logic can drift out of sync with `getDirectory()`.
 * `page`/`pageSize` (Increment 5) LIMIT/OFFSET only when BOTH are given —
 * every pre-existing caller that passes neither gets every eligible row,
 * exactly as before.
 */
async function queryDirectoryRows(
  tx: OrgTx,
  organizationId: string,
  opts: QueryDirectoryRowsOptions = {},
): Promise<DirectoryRow[]> {
  const paginate =
    typeof opts.page === "number" && typeof opts.pageSize === "number";
  const result = await tx.execute(sql`
    select
      m.person_id                                          as person_id,
      m.household_id                                        as household_id,
      m.household_role                                      as household_role,
      p.first_name                                          as first_name,
      p.middle_name                                         as middle_name,
      p.last_name                                           as last_name,
      p.suffix                                              as suffix,
      p.preferred_name                                      as preferred_name,
      case when coalesce(pp.hide_email, false) then null
           else cm_email.value end                           as email,
      case when coalesce(pp.hide_email, false) then null
           when cm_work.value is not distinct from cm_email.value then null
           else cm_work.value end                            as work_email,
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
           else p.photo_key end                              as photo_key,
      coalesce(pp.directory_hidden, false)                    as is_hidden
      ${directoryFromWhereSql(organizationId, opts)}
     order by p.last_name, p.first_name, m.person_id
     ${
       paginate
         ? sql`limit ${opts.pageSize} offset ${(opts.page! - 1) * opts.pageSize!}`
         : sql``
     }
  `);

  return (result as unknown as { rows?: DirectoryRow[] }).rows ?? [];
}

/**
 * Increment 5. Total ELIGIBLE row count for `opts`, ignoring `opts.page`/
 * `opts.pageSize` themselves (a count query is never itself paginated) but
 * sharing `directoryFromWhereSql()` with `queryDirectoryRows()` so the two
 * can never disagree about which rows are being counted vs. returned.
 */
async function countDirectoryRows(
  tx: OrgTx,
  organizationId: string,
  opts: QueryDirectoryRowsOptions = {},
): Promise<number> {
  const result = await tx.execute(sql`
    select count(*)::int as total
      ${directoryFromWhereSql(organizationId, opts)}
  `);
  const row = (result as unknown as { rows?: Array<{ total: number }> })
    .rows?.[0];
  return row?.total ?? 0;
}

/**
 * Counts the people the ordinary directory would show in this household — the
 * number `getHouseholdDetail()` reports as `memberCount` for the same viewer
 * (F136: the portal home and the household page cannot disagree).
 *
 * Performs NO permission check: the caller must have established
 * `directory.view` in the SAME transaction (`checkDirectoryView`).
 * `includeHidden` is deliberately not a parameter — the home is not an
 * elevated surface, so a `directory.view_hidden` holder gets the ordinary count
 * there too.
 *
 * Tradeoff: `countDirectoryRows` carries the lateral contact joins this count
 * does not need. That is fine for a household (a handful of rows behind
 * `memberships_org_household_idx`); revisit only if a count ever runs
 * unscoped.
 */
export async function countHouseholdDirectoryMembers(
  tx: OrgTx,
  organizationId: string,
  householdId: string,
): Promise<number> {
  return countDirectoryRows(tx, organizationId, {
    householdId,
    includeHidden: false,
  });
}

/**
 * `getDirectory()`'s own mapping. Every field it set through Increment 3 is
 * UNCHANGED; Increment 4 adds `isHidden` (see this file's own header for why
 * that is safe to compute unconditionally, even for an ordinary caller).
 */
function mapRow(row: DirectoryRow): DirectoryEntry {
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
    workEmail: row.work_email,
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
    isHidden: row.is_hidden,
  };
}

/** The richer mapping `getHouseholdDetail()`/`getPersonDetail()` use. */
function mapRowExtended(row: DirectoryRow): DirectoryEntry {
  return {
    ...mapRow(row),
    middleName: row.middle_name,
    suffix: row.suffix,
    householdId: row.household_id,
    householdRole: row.household_role,
  };
}

/** The `directory.view` check, factored out so all four readers below run
 * the identical `presby_has_permission()` call `getDirectory()` always has.
 *
 * Exported (portal-home alignment) so the portal home and find-a-person run
 * THIS call rather than a private copy of the SQL: one definition of "may this
 * person see the directory", the way `directoryEligibilityWhereSql()` is one
 * definition of "who appears". */
export async function checkDirectoryView(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const permissionCheck = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             'directory.view'
           ) as allowed
  `);
  return (
    (
      permissionCheck as unknown as {
        rows?: Array<{ allowed?: boolean }>;
      }
    ).rows?.[0]?.allowed === true
  );
}

/**
 * The `directory.view_hidden` check (Increment 4) — same shape as
 * `checkDirectoryView()`, a different permission key. THIS is the
 * re-verification `includeHidden` is checked against; a caller's own
 * `{ includeHidden: true }` request is honored only when this returns
 * `true`, inside the SAME transaction, every single call — a grant revoked
 * mid-session is caught on the very next read, per the Phase 3 design's own
 * edge-case note.
 */
async function checkViewHidden(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const permissionCheck = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             'directory.view_hidden'
           ) as allowed
  `);
  return (
    (
      permissionCheck as unknown as {
        rows?: Array<{ allowed?: boolean }>;
      }
    ).rows?.[0]?.allowed === true
  );
}

interface DeaconRow {
  org_unit_id: string;
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

/**
 * The ONE deacon↔care-unit derivation — shared by `getHouseholds()`,
 * `getHouseholdDetail()`, and `getParishesOverview()` (parishes.ts) so it can never drift into
 * two hand-copied queries (Phase 3's own cross-cutting risk note, applied to
 * this increment).
 *
 * `office = 'deacon'` and OPEN today - `starts_on <= current_date and
 * (ends_on is null or ends_on > current_date)`, the half-open rule the
 * resolver, `presby_officer_roster()` and the district target guard all use
 * (F265: this used to be `ends_on is null`, which dropped a deacon whose term
 * has a future end date and counted one that had not started), tie-broken `starts_on desc, id
 * asc` PER org unit (`distinct on`) — the Phase 3 design's exact rule for
 * "two active deacon terms on one org unit is a data anomaly the CHECK
 * doesn't prevent; resolve it the same deterministic way everywhere," not by
 * returning every match.
 *
 * Deliberately NOT filtered through `directoryEligibilityWhereSql()` /
 * `queryDirectoryRows()` — a deacon is shown BY OFFICE, the same way
 * fpcw-directory (Phase 1's prior-art survey) shows a parish's deacon
 * regardless of that deacon's own directory privacy settings. See this
 * file's own header for the fuller rationale.
 *
 * Returns a `Map<orgUnitId, deaconName>` — batched in one round trip rather
 * than one query per household, and empty (not an error) for an empty
 * `orgUnitIds` input.
 */
export async function deriveDeaconsByOrgUnit(
  tx: OrgTx,
  organizationId: string,
  orgUnitIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(orgUnitIds)];
  if (uniqueIds.length === 0) return new Map();

  const result = await tx.execute(sql`
    select distinct on (ot.org_unit_id)
           ot.org_unit_id as org_unit_id,
           ot.person_id   as person_id,
           p.first_name   as first_name,
           p.last_name    as last_name,
           p.preferred_name as preferred_name
      from officer_terms ot
      join people p on p.id = ot.person_id
     where ot.organization_id = ${organizationId}::uuid
       and ot.office = 'deacon'
       and ot.starts_on <= current_date
       and (ot.ends_on is null or ot.ends_on > current_date)
       and ot.org_unit_id in (${sql.join(
         uniqueIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
     order by ot.org_unit_id, ot.starts_on desc, ot.id asc
  `);
  const rows = (result as unknown as { rows?: DeaconRow[] }).rows ?? [];

  const deaconsByUnit = new Map<string, string>();
  for (const row of rows) {
    deaconsByUnit.set(
      row.org_unit_id,
      `${row.preferred_name ?? row.first_name} ${row.last_name}`,
    );
  }
  return deaconsByUnit;
}

/**
 * Reads the congregation directory for `personId` at `organizationId`.
 *
 * `opts.search`, when present, narrows the result set — see
 * `GetDirectoryOptions.search`'s own doc comment for the exact matched
 * columns and the privacy interaction. Omitted or empty behaves identically
 * to today's unfiltered read; existing callers that never pass `opts` are
 * unaffected.
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
  opts?: GetDirectoryOptions,
): Promise<DirectoryResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    if (!(await checkDirectoryView(tx, personId, organizationId))) {
      return { kind: "forbidden" };
    }

    const includeHidden =
      Boolean(opts?.includeHidden) &&
      (await checkViewHidden(tx, personId, organizationId));

    const wantsPagination =
      typeof opts?.page === "number" && typeof opts?.pageSize === "number";

    if (!wantsPagination) {
      const rows = await queryDirectoryRows(tx, organizationId, {
        search: opts?.search,
        status: opts?.status,
        rollStatuses: opts?.rollStatuses,
        includeHidden,
      });
      return { kind: "ok", entries: rows.map(mapRow) };
    }

    const pageSize = opts!.pageSize!;
    const total = await countDirectoryRows(tx, organizationId, {
      search: opts?.search,
      status: opts?.status,
      rollStatuses: opts?.rollStatuses,
      includeHidden,
    });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, opts!.page!), totalPages);

    const rows = await queryDirectoryRows(tx, organizationId, {
      search: opts?.search,
      status: opts?.status,
      rollStatuses: opts?.rollStatuses,
      includeHidden,
      page,
      pageSize,
    });
    return {
      kind: "ok",
      entries: rows.map(mapRow),
      pagination: { page, pageSize, total, totalPages },
    };
  });
}

// ---------------------------------------------------------------------------
// Phase 3, Increment 3 — households view + household/person detail.
// ---------------------------------------------------------------------------

export interface HouseholdSummary {
  householdId: string;
  name: string;
  city: string | null;
  region: string | null;
  /**
   * Counts only rows that would themselves pass `getDirectory()`'s WHERE
   * (current-roll/engagement, not hidden, not merged, not deceased) — the
   * SAME `queryDirectoryRows()` call `getDirectory()` itself uses, not a
   * second hand-written count.
   */
  memberCount: number;
  /**
   * Increment 4. Derived from `households.org_unit_id` via
   * `deriveDeaconsByOrgUnit()` — `null` when the household has no district
   * assigned, OR its district's deacon term is vacant. The two causes are
   * indistinguishable here on purpose (see `DeaconCard`'s own header).
   */
  deaconName: string | null;
}

export interface GetHouseholdsOptions {
  /** Matched against the household's own name, case-insensitive, trimmed. */
  search?: string;
  /** See `GetDirectoryOptions.includeHidden`. Re-verified inside this call. */
  includeHidden?: boolean;
}

export type GetHouseholdsResult =
  | { kind: "ok"; households: HouseholdSummary[] }
  | { kind: "forbidden" };

interface HouseholdRow {
  household_id: string;
  name: string;
  city: string | null;
  region: string | null;
  org_unit_id: string | null;
}

/**
 * The households view. A household with `memberCount === 0` — every member
 * privacy-hidden, off-roll, or the household genuinely has no members — is
 * DROPPED from the result entirely (Phase 1's confirmed default, matching
 * fpcw-directory precedent), never shown with a "no visible members" note.
 * `includeHidden` (honored) widens which members COUNT toward that
 * threshold, so a household an ordinary viewer sees as empty can appear for
 * an elevated one — the SAME `queryDirectoryRows()` call decides both, so
 * the Members and Households tabs, and the Parishes roster, can never
 * disagree about which households are eligible (Phase 2 note 4).
 */
export async function getHouseholds(
  personId: string,
  organizationId: string,
  opts?: GetHouseholdsOptions,
): Promise<GetHouseholdsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    if (!(await checkDirectoryView(tx, personId, organizationId))) {
      return { kind: "forbidden" };
    }

    const includeHidden =
      Boolean(opts?.includeHidden) &&
      (await checkViewHidden(tx, personId, organizationId));

    const memberRows = await queryDirectoryRows(tx, organizationId, {
      includeHidden,
    });
    const countsByHousehold = new Map<string, number>();
    for (const row of memberRows) {
      if (!row.household_id) continue;
      countsByHousehold.set(
        row.household_id,
        (countsByHousehold.get(row.household_id) ?? 0) + 1,
      );
    }

    const eligibleIds = [...countsByHousehold.keys()];
    if (eligibleIds.length === 0) {
      return { kind: "ok", households: [] };
    }

    const trimmedSearch = opts?.search?.trim();
    const result = await tx.execute(sql`
      select h.id as household_id, h.name as name,
             a.city as city, a.region as region,
             h.org_unit_id as org_unit_id
        from households h
        left join addresses a on a.id = h.mailing_address_id
       where h.organization_id = ${organizationId}::uuid
         and h.id in (${sql.join(
           eligibleIds.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
         ${
           trimmedSearch
             ? sql`and h.name ilike ${`%${trimmedSearch}%`}`
             : sql``
         }
       order by h.name
    `);
    const rows = (result as unknown as { rows?: HouseholdRow[] }).rows ?? [];

    const orgUnitIds = rows
      .map((row) => row.org_unit_id)
      .filter((id): id is string => id !== null);
    const deaconsByUnit = await deriveDeaconsByOrgUnit(
      tx,
      organizationId,
      orgUnitIds,
    );

    const households: HouseholdSummary[] = rows.map((row) => ({
      householdId: row.household_id,
      name: row.name,
      city: row.city,
      region: row.region,
      memberCount: countsByHousehold.get(row.household_id) ?? 0,
      deaconName: row.org_unit_id
        ? (deaconsByUnit.get(row.org_unit_id) ?? null)
        : null,
    }));

    return { kind: "ok", households };
  });
}

export interface HouseholdDetail {
  householdId: string;
  name: string;
  address: DirectoryAddress | null;
  memberCount: number;
  /** See `HouseholdSummary.deaconName` — the same derivation, same rules. */
  deaconName: string | null;
  members: DirectoryEntry[];
}

export interface GetHouseholdDetailOptions {
  /** See `GetDirectoryOptions.includeHidden`. Re-verified inside this call. */
  includeHidden?: boolean;
}

export type GetHouseholdDetailResult =
  | { kind: "ok"; household: HouseholdDetail }
  | { kind: "forbidden" }
  | { kind: "not-found" };

/**
 * One household's detail. `"not-found"` covers THREE cases the caller
 * cannot and must not distinguish (DECISION-040's non-disclosure
 * discipline, extended to this surface per the Phase 3 design): the id
 * doesn't exist at all, it belongs to another organization (RLS plus the
 * `organization_id` predicate both scope every query here), or it exists
 * but currently has zero visible eligible members. All three read as the
 * identical `{ kind: "not-found" }`. `opts.includeHidden` (honored) widens
 * the third case exactly as it does in `getHouseholds()`.
 */
export async function getHouseholdDetail(
  personId: string,
  organizationId: string,
  householdId: string,
  opts?: GetHouseholdDetailOptions,
): Promise<GetHouseholdDetailResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    if (!(await checkDirectoryView(tx, personId, organizationId))) {
      return { kind: "forbidden" };
    }
    if (!UUID_RE.test(householdId)) {
      return { kind: "not-found" };
    }

    const includeHidden =
      Boolean(opts?.includeHidden) &&
      (await checkViewHidden(tx, personId, organizationId));

    const memberRows = await queryDirectoryRows(tx, organizationId, {
      householdId,
      includeHidden,
    });
    if (memberRows.length === 0) {
      return { kind: "not-found" };
    }

    const householdResult = await tx.execute(sql`
      select h.name as name, a.line1 as line1, a.city as city,
             a.region as region, a.postal_code as postal_code,
             h.org_unit_id as org_unit_id
        from households h
        left join addresses a on a.id = h.mailing_address_id
       where h.id = ${householdId}::uuid
         and h.organization_id = ${organizationId}::uuid
       limit 1
    `);
    const householdRow = (
      householdResult as unknown as {
        rows?: Array<{
          name: string;
          line1: string | null;
          city: string | null;
          region: string | null;
          postal_code: string | null;
          org_unit_id: string | null;
        }>;
      }
    ).rows?.[0];
    if (!householdRow) {
      return { kind: "not-found" };
    }

    const members = memberRows.map(mapRowExtended);
    const hasAddress =
      householdRow.line1 !== null ||
      householdRow.city !== null ||
      householdRow.region !== null ||
      householdRow.postal_code !== null;

    let deaconName: string | null = null;
    if (householdRow.org_unit_id) {
      const deaconsByUnit = await deriveDeaconsByOrgUnit(tx, organizationId, [
        householdRow.org_unit_id,
      ]);
      deaconName = deaconsByUnit.get(householdRow.org_unit_id) ?? null;
    }

    return {
      kind: "ok",
      household: {
        householdId,
        name: householdRow.name,
        address: hasAddress
          ? {
              line1: householdRow.line1,
              city: householdRow.city,
              region: householdRow.region,
              postalCode: householdRow.postal_code,
            }
          : null,
        memberCount: members.length,
        deaconName,
        members,
      },
    };
  });
}

export interface GetPersonDetailOptions {
  /** See `GetDirectoryOptions.includeHidden`. Re-verified inside this call. */
  includeHidden?: boolean;
}

export type GetPersonDetailResult =
  | { kind: "ok"; entry: DirectoryEntry }
  | { kind: "forbidden" }
  | { kind: "not-found" };

/**
 * One person's detail. `"not-found"` covers the same three cases
 * `getHouseholdDetail()`'s does: nonexistent id, another organization's id,
 * or a currently-ineligible/hidden target — all indistinguishable.
 * `opts.includeHidden` (honored) widens the third case, letting an elevated
 * caller reach a `directory_hidden` person's own detail page directly.
 */
export async function getPersonDetail(
  personId: string,
  organizationId: string,
  targetPersonId: string,
  opts?: GetPersonDetailOptions,
): Promise<GetPersonDetailResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    if (!(await checkDirectoryView(tx, personId, organizationId))) {
      return { kind: "forbidden" };
    }
    if (!UUID_RE.test(targetPersonId)) {
      return { kind: "not-found" };
    }

    const includeHidden =
      Boolean(opts?.includeHidden) &&
      (await checkViewHidden(tx, personId, organizationId));

    const rows = await queryDirectoryRows(tx, organizationId, {
      personId: targetPersonId,
      includeHidden,
    });
    if (rows.length === 0) {
      return { kind: "not-found" };
    }

    return { kind: "ok", entry: mapRowExtended(rows[0]!) };
  });
}
