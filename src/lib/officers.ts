import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import { isExclusionViolation, isPgError, pgErrorMessages } from "@/lib/db/errors";
import { officerTerms } from "@/lib/db/domain/officers";
import { groups } from "@/lib/db/domain/groups";
import { orgUnits } from "@/lib/db/domain/org";
import { memberships, people } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import { isUuid } from "@/lib/is-uuid";
import {
  OFFICER_OFFICES,
  OFFICE_LABELS,
  isAuthorityOffice,
  isPastorOffice,
  isSessionOffice,
  type OfficerOffice,
} from "@/lib/officer-offices";
import { isCategoryAxisOn, orgFeatureEnabledInTx } from "@/lib/org-features";
import { MANAGEABLE_UNIT_TYPES, PARISHES_FEATURE_KEY } from "@/lib/parishes-pure";
import { todayUtcYmd } from "@/lib/ymd";

/**
 * Officer-term administration — P?? gap 1 (`docs/work-log/
 * 2026-08-26-groups-and-officers.md`, Phase 3, commit 2/3). Records who
 * holds ordained/administrative office at a congregation — starts and ends
 * `officer_terms` rows for Session (`ruling_elder`), the Board of Deacons
 * (`deacon`), and the non-materialized offices (`clerk_of_session`,
 * `moderator`, `treasurer`, `trustee`) — and reads the current roster and a
 * given person's full officer history.
 *
 * SAME SHAPE AS `src/lib/role-grants.ts` (DECISION-096's precedent): one
 * `withOrgContext()` transaction per exported function, the `officers.manage`
 * gate checked FIRST inside every one of them — before any other read or
 * write — via the private `hasOfficersManage` helper below, mirroring
 * `hasRoleGrantsManage`'s placement exactly. Thrown exceptions are reserved
 * for genuine failure (`OrgAccessError`, a malformed call); every
 * expected/denied outcome is a typed `OfficersResult` variant.
 *
 * THIS MODULE NEVER WRITES `group_memberships`. `officer_terms_sync_derived`
 * (`drizzle/0009_presby_rls.sql`) is the only writer of the derived
 * Session/Diaconate rosters — "The Court Is Not a Group" (CLAUDE.md). This
 * module writes exactly two things to `officer_terms`: a new row
 * (`startOfficerTerm`) and an `ends_on`/`end_reason` update on an existing row
 * (`endOfficerTerm`). IT NEVER DELETES A ROW — `group_memberships
 * .officer_term_id` is an unconstrained FK (`drizzle/0017`'s own comment), so
 * a delete here would orphan a derived roster row with no trigger to clean
 * it up, leaving someone permanently seated on Session/Diaconate with no
 * corresponding term. Phase 2/3 both name this explicitly; there is
 * deliberately no `deleteOfficerTerm` export.
 *
 * F22 REGRESSION, AT THE APPLICATION LAYER — the reason this module exists
 * as a discrete, carefully-tested surface rather than a thin CRUD wrapper:
 * the trigger's own fix (keying the derived row on `officer_term_id`, one
 * row per term) is already proven at the SQL/fixture layer
 * (`scripts/test-rls.sql`), but this is the FIRST application write path
 * putting arbitrary user input onto `officer_terms`. `startOfficerTerm`
 * never upserts, never deletes, and never re-uses an existing term's id —
 * every call is a plain INSERT, so two non-consecutive terms for the same
 * person/office produce two distinct `officer_terms` rows (rejected as a
 * unit only by the `officer_terms_no_overlap` GIST exclusion constraint when
 * they actually overlap in time) and, downstream of the trigger, two
 * distinct `group_memberships` rows. `officers.test.ts` proves this
 * end-to-end, not just at the constraint layer.
 *
 * TWO DB-LEVEL FAILURE MODES THE NEW INPUT SURFACE CAN ACTUALLY TRIGGER,
 * both mapped to specific copy per Phase 3's API-contract table (never
 * surfaced as a raw DB error):
 *   1. `officer_terms_no_overlap` (Postgres `exclusion_violation`, 23P01) —
 *      an overlapping open term for the same person/office. Detected via
 *      `isExclusionViolation()` (`src/lib/db/errors.ts`, sibling to
 *      `isUniqueViolation()`), mapped to the `overlap` result variant.
 *   2. `officer_terms_org_unit_deacon_check` — org_unit required iff
 *      office === 'deacon'. Checked in application code BEFORE the insert
 *      (this file), so the CHECK constraint is a backstop that should never
 *      actually fire in normal operation, not the primary UX. Note the
 *      constraint itself is looser than the app rule (it only forbids a
 *      non-null org_unit on a non-deacon office; it does not itself require
 *      one on a deacon office) — the "iff" is an application-level rule,
 *      enforced here and again client-side (commit 3).
 *
 * AUDIT (Increment 2, DECISION-205, R13): `startOfficerTerm()` and
 * `endOfficerTerm()` write `tenant.officer_term.started`/`ended` HERE with
 * `insertAuditRow()` in the SAME transaction as the term (they used to be
 * written by `admin/officers/actions.ts` after commit through `recordAudit()`,
 * which swallows failures). A Session-bearing term is equivalent to a grant of
 * whatever the congregation's Session role carries, and grants are audited in
 * the transaction, so a term can no longer commit with no audit row. The
 * metadata is built from the term's own row, not client input, and carries
 * `selfRecorded` (the person's `user_id` is the actor): the first link of the
 * `paper` chain DECISION-205 names. `setOfficerTermPublicListed()`
 * (docs/work-log/2026-08-27-public-staff-directory.md) still calls
 * `recordAudit()` from inside the function, after commit; see its own doc
 * comment for the `check:audit` tripwire-coverage finding.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFFICERS_MANAGE = "officers.manage";

// The office vocabulary lives in the pure `officer-offices.ts` (DECISION-206):
// one list, re-exported here so existing importers keep their path.
export { OFFICER_OFFICES, OFFICE_LABELS };
export type { OfficerOffice };

function isOfficerOffice(value: string): value is OfficerOffice {
  return (OFFICER_OFFICES as readonly string[]).includes(value);
}

/**
 * The single-permission gate every exported function in this module checks
 * FIRST. Not exported, same discipline `hasRoleGrantsManage` documents — one
 * place `presby_has_permission(..., 'officers.manage')` is spelled out, so
 * the five call sites below cannot drift.
 */
async function hasOfficersManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${OFFICERS_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// Shared result / entry types
// ---------------------------------------------------------------------------

export interface OfficerRosterEntry {
  termId: string;
  personId: string;
  displayName: string;
  office: OfficerOffice;
  classYear: number | null;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  /** 'YYYY-MM-DD', or null (open-ended). */
  endsOn: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  /** The term's district has been archived (`org_units.archived_at`); shown
   * as "{name} (archived)" in the District column. */
  orgUnitArchived: boolean;
  /** Public staff-directory opt-in (docs/work-log/
   * 2026-08-27-public-staff-directory.md) — additive field, same query. */
  publicListed: boolean;
  /** Admin-set public-directory curation order (docs/work-log/
   * 2026-08-28-public-directory-primitives.md) — additive field, same
   * query. `null` = no curation set, alphabetical-by-name ordering. */
  publicDisplayOrder: number | null;
  /** Authority-bearing offices only (`AUTHORITY_OFFICES`: the Session offices
   * and the Moderator of the Board of Deacons seat): the term was recorded by
   * the person it seats (`recorded_by` equals the person's `user_id`), shown as
   * "Self-recorded" (S2, DECISION-205, F264). Always false for other offices. */
  selfRecorded: boolean;
}

export interface OfficerHistoryEntry {
  termId: string;
  office: OfficerOffice;
  classYear: number | null;
  startsOn: string;
  endsOn: string | null;
  endReason: string | null;
  yearsServed: number;
}

export interface OfficerFormOptions {
  people: Array<{ personId: string; displayName: string }>;
  /** ACTIVE districts and parishes only - an archived one cannot take a new
   * deacon term (drizzle/0068). */
  orgUnits: Array<{ orgUnitId: string; name: string }>;
  /** The per-org `org_portal.parishes` toggle is on (the "no districts" copy
   * differs: add them on the Parishes page, or turn the toggle on). */
  parishesEnabled: boolean;
}

export type OfficersResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string }
  | { kind: "overlap"; personName: string; officeLabel: string }
  /** A pastor office for a person who is on this congregation's roll (S1): a
   * pastor's membership is held by the presbytery, so the link carries no roll
   * fact. Pre-checked here and backstopped by the `officer_terms_pastor_no_roll`
   * trigger. */
  | { kind: "on_roll"; personName: string }
  /** A Session, pastor or diaconate office at an organization with no matching
   * derived group (only congregations have them). Used to be a raw foreign-key
   * error (F189). */
  | { kind: "invalid_office_for_org"; officeLabel: string }
  /** A deacon term pointed at an archived district or a campus. Pre-checked
   * here and backstopped by the `officer_terms_org_unit_target_guard` trigger
   * (drizzle/0068). */
  | { kind: "district_unavailable" };

// ---------------------------------------------------------------------------
// listOfficerRoster
// ---------------------------------------------------------------------------

interface RosterRow {
  term_id: string;
  person_id: string;
  person_preferred_name: string | null;
  person_first_name: string;
  person_last_name: string;
  office: string;
  class_year: number | null;
  starts_on: string;
  ends_on: string | null;
  org_unit_id: string | null;
  org_unit_name: string | null;
  org_unit_archived: boolean;
  public_listed: boolean;
  public_display_order: number | null;
  self_recorded: boolean;
}

/**
 * The current roster — Flow 3 — filtered to `office` when supplied, every
 * office otherwise. Calls `presby_officer_roster()` (`drizzle/
 * 0009_presby_rls.sql`) once per office rather than hand-reimplementing its
 * "current as of today" filter as a Drizzle join (same discipline
 * `effectivePermissions()` documents in `src/lib/authz.ts`), then joins
 * `people`/`officer_terms`/`org_units` for display fields the SQL function
 * itself does not return.
 */
export async function listOfficerRoster(
  viewerPersonId: string,
  organizationId: string,
  office?: OfficerOffice,
): Promise<OfficersResult<OfficerRosterEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOfficersManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      with all_offices(office) as (
        values ('ruling_elder'), ('installed_pastor'), ('co_pastor'),
               ('associate_pastor'), ('deacon'), ('deacons_moderator'),
               ('clerk_of_session'), ('moderator'), ('treasurer'), ('trustee')
      ),
      roster as (
        select o.office, r.person_id, r.term_id, r.class_year,
               r.starts_on, r.ends_on
          from all_offices o
          cross join lateral presby_officer_roster(
                       ${organizationId}::uuid, o.office
                     ) r
         where ${office ? sql`o.office = ${office}` : sql`true`}
      )
      select
        roster.term_id          as term_id,
        roster.person_id        as person_id,
        p.preferred_name        as person_preferred_name,
        p.first_name            as person_first_name,
        p.last_name             as person_last_name,
        roster.office           as office,
        roster.class_year       as class_year,
        roster.starts_on::text  as starts_on,
        roster.ends_on::text    as ends_on,
        ot.org_unit_id          as org_unit_id,
        ou.name                 as org_unit_name,
        (ou.archived_at is not null) as org_unit_archived,
        ot.public_listed        as public_listed,
        ot.public_display_order as public_display_order,
        (ot.recorded_by is not null and ot.recorded_by = p.user_id) as self_recorded
        from roster
        join people p on p.id = roster.person_id
        join officer_terms ot on ot.id = roster.term_id
        left join org_units ou on ou.id = ot.org_unit_id
       order by roster.office, p.last_name, p.first_name
    `);

    const rows = (result as unknown as { rows?: RosterRow[] }).rows ?? [];
    const data: OfficerRosterEntry[] = rows.map((row) => ({
      termId: row.term_id,
      personId: row.person_id,
      displayName: `${row.person_preferred_name ?? row.person_first_name} ${row.person_last_name}`,
      office: row.office as OfficerOffice,
      classYear: row.class_year,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      orgUnitId: row.org_unit_id,
      orgUnitName: row.org_unit_name,
      orgUnitArchived: row.org_unit_archived === true,
      publicListed: row.public_listed,
      publicDisplayOrder: row.public_display_order,
      selfRecorded: isAuthorityOffice(row.office) && row.self_recorded === true,
    }));

    return { kind: "ok", data };
  });
}

// ---------------------------------------------------------------------------
// getOfficerHistory
// ---------------------------------------------------------------------------

interface HistoryRow {
  office: string;
  term_id: string;
  class_year: number | null;
  starts_on: string;
  ends_on: string | null;
  end_reason: string | null;
  years_served: number;
}

/**
 * One person's full officer history (Flow 3) — every term they have ever
 * served, across offices, via `presby_officer_history()`. `personId` need
 * only have EVER held a membership at this org (not necessarily a CURRENT
 * one) — `officer_terms_person_fk` itself does not require an active
 * membership, and a person who has since left the congregation still has a
 * real history worth reading.
 */
export async function getOfficerHistory(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<OfficersResult<OfficerHistoryEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOfficersManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [membership] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, personId),
          eq(memberships.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!membership) {
      return { kind: "invalid_target" };
    }

    const result = await tx.execute(sql`
      select office,
             term_id,
             class_year,
             starts_on::text as starts_on,
             ends_on::text   as ends_on,
             end_reason,
             years_served::float8 as years_served
        from presby_officer_history(${organizationId}::uuid, ${personId}::uuid)
    `);

    const rows = (result as unknown as { rows?: HistoryRow[] }).rows ?? [];
    const data: OfficerHistoryEntry[] = rows.map((row) => ({
      termId: row.term_id,
      office: row.office as OfficerOffice,
      classYear: row.class_year,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      endReason: row.end_reason,
      yearsServed: row.years_served,
    }));

    return { kind: "ok", data };
  });
}

// ---------------------------------------------------------------------------
// getOfficerFormOptions
// ---------------------------------------------------------------------------

/**
 * The add-term form's own data — people scoped through `memberships`,
 * current only (`ended_on is null`), the identical F21 shape
 * `getGrantFormOptions` uses — NEVER a bare `select * from people`. `org_units`
 * is a plain `where organization_id = ...` read; the table carries no
 * further tenant-scoping concern beyond that (Phase 3's own note).
 */
export async function getOfficerFormOptions(
  viewerPersonId: string,
  organizationId: string,
): Promise<OfficersResult<OfficerFormOptions>> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOfficersManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const peopleRows = await tx
      .select({
        personId: memberships.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          isNull(memberships.endedOn),
        ),
      )
      .orderBy(people.lastName, people.firstName);

    // Active districts and parishes only: an archived district cannot take a
    // new deacon term, and a campus is not deacon care (drizzle/0068, G7).
    const orgUnitRows = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.organizationId, organizationId),
          isNull(orgUnits.archivedAt),
          inArray(orgUnits.unitType, [...MANAGEABLE_UNIT_TYPES]),
        ),
      )
      .orderBy(orgUnits.name);

    const parishesEnabled = await orgFeatureEnabledInTx(
      tx,
      organizationId,
      PARISHES_FEATURE_KEY,
      categoryAxisOn,
    );

    return {
      kind: "ok",
      data: {
        people: peopleRows.map((row) => ({
          personId: row.personId,
          displayName: `${row.preferredName ?? row.firstName} ${row.lastName}`,
        })),
        orgUnits: orgUnitRows.map((row) => ({
          orgUnitId: row.id,
          name: row.name,
        })),
        parishesEnabled,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// startOfficerTerm
// ---------------------------------------------------------------------------

export interface StartOfficerTermInput {
  personId: string;
  office: OfficerOffice;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  /** 'YYYY-MM-DD'. */
  electedOn?: string;
  /** 'YYYY-MM-DD'. */
  installedOn?: string;
  classYear?: number;
  minuteReference?: string;
  /** Required iff `office === 'deacon'`; forbidden otherwise. */
  orgUnitId?: string;
}

export interface OfficerActingOptions {
  /** Stamped on the audit row only. Never an authority claim. */
  actingUserEmail?: string | null;
}

/**
 * The derived group an office needs at its organization: the Session offices
 * (elders and pastors) need `session`, a deacon needs `diaconate`, the
 * Moderator of the Board of Deacons needs `deacons_moderator` (drizzle/0068,
 * DECISION-242), everything else needs none. Only congregations have these
 * groups, so this is how such an office at a presbytery becomes the typed
 * `invalid_office_for_org` instead of the trigger's raw foreign-key error.
 */
type RequiredDerivedGroup = "session" | "diaconate" | "deacons_moderator";

function requiredDerivedGroup(office: OfficerOffice): RequiredDerivedGroup | null {
  if (office === "deacon") return "diaconate";
  if (office === "deacons_moderator") return "deacons_moderator";
  if (isSessionOffice(office)) return "session";
  return null;
}

async function hasDerivedGroup(
  tx: OrgTx,
  organizationId: string,
  derivedFrom: RequiredDerivedGroup,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.organizationId, organizationId), eq(groups.derivedFrom, derivedFrom)))
    .limit(1);
  return row !== undefined;
}

/**
 * Records a new term of service. NEVER an upsert, NEVER a delete — a plain
 * INSERT every time, so two non-consecutive terms for the same person/office
 * are two distinct rows (F22's own failure mode, at this layer).
 *
 * ORDER OF OPERATIONS, each step named because a later reorder would reopen
 * a finding (mirrors `grantRole`'s own documented order):
 *   0. `hasOfficersManage` gate — `forbidden` if the caller doesn't hold
 *      `officers.manage` at all. Runs before anything else.
 *   1. `office`/date-shape validation — thrown, genuine bad input, matching
 *      `grantRole`'s own "malformed startsOn" contract.
 *   2. The deacon/org_unit "iff" rule — application-level (the CHECK
 *      constraint only forbids the non-deacon direction), checked BEFORE any
 *      query runs, returned as `invalid_input` naming which rule failed.
 *   2b. A Session, pastor or diaconate office needs the matching derived group
 *      at this organization (only congregations have them) —
 *      `invalid_office_for_org`.
 *   3. Validate `personId` is a CURRENT member of this org (F21 shape) —
 *      `invalid_target`.
 *   4. Validate `orgUnitId`, when supplied, belongs to THIS org —
 *      `invalid_target` - and is an ACTIVE district or parish
 *      (`district_unavailable` for an archived district or a campus, with
 *      the drizzle/0068 trigger as the backstop for the archive race). Closes the composite-tenant-key gap (F2/F21): an
 *      `org_unit` id from another organization can never be attached to a
 *      term here.
 *   5. Resolve the person's display name and `user_id` BEFORE the insert, so
 *      the `overlap` and `on_roll` results never need a second query after the
 *      failure (Phase 3's own API-contract note), and so the audit row can
 *      stamp `selfRecorded`.
 *   5b. A pastor office for a person on this congregation's roll is refused
 *      (`on_roll`, S1/DECISION-206): the roll as of the later of today and the
 *      start date, or `memberships.current_roll`, is non-null. The database
 *      trigger is the backstop for the race.
 *   6. Insert, wrapped in try/catch for `officer_terms_no_overlap`
 *      (`isExclusionViolation()`) — mapped to `overlap`, never surfaced raw —
 *      and for the two trigger refusals above.
 *   7. The audit row, in the SAME transaction (R13): `selfRecorded` is true
 *      when the person's `user_id` is the actor.
 */
export async function startOfficerTerm(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: StartOfficerTermInput,
  opts?: OfficerActingOptions,
): Promise<OfficersResult<{ termId: string }>> {
  if (!DATE_RE.test(input.startsOn)) {
    throw new Error(
      `startOfficerTerm: startsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.startsOn)}`,
    );
  }
  if (input.electedOn !== undefined && !DATE_RE.test(input.electedOn)) {
    throw new Error(
      `startOfficerTerm: electedOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.electedOn)}`,
    );
  }
  if (input.installedOn !== undefined && !DATE_RE.test(input.installedOn)) {
    throw new Error(
      `startOfficerTerm: installedOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.installedOn)}`,
    );
  }
  if (!isOfficerOffice(input.office)) {
    throw new Error(
      `startOfficerTerm: unrecognized office ${JSON.stringify(input.office)}`,
    );
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOfficersManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    // Step 2 — the deacon/org_unit "iff" rule, application-level, BEFORE any
    // query. The DB's own check constraint (`officer_terms_org_unit_deacon_
    // check`) only forbids the non-deacon-with-org_unit direction; it does
    // NOT require a deacon term to carry one. Requiring it is this app's own
    // rule, so it is enforced here, not left to the (looser) constraint.
    if (input.office === "deacon" && !input.orgUnitId) {
      return {
        kind: "invalid_input",
        message: "A deacon term needs a district (org unit) selected.",
      };
    }
    if (input.office !== "deacon" && input.orgUnitId) {
      return {
        kind: "invalid_input",
        message: `${OFFICE_LABELS[input.office]} terms don't take a district (org unit) — only deacon terms do.`,
      };
    }

    // Step 2b — the derived group the trigger will write to must exist here.
    const neededGroup = requiredDerivedGroup(input.office);
    if (neededGroup && !(await hasDerivedGroup(tx, organizationId, neededGroup))) {
      return {
        kind: "invalid_office_for_org",
        officeLabel: OFFICE_LABELS[input.office],
      };
    }

    // Step 3 — F21 shape: a CURRENT membership at this org, not a bare
    // people lookup. A malformed id is `invalid_target`, never a raw cast
    // error.
    if (!isUuid(input.personId)) {
      return { kind: "invalid_target" };
    }
    const [membership] = await tx
      .select({ id: memberships.id, currentRoll: memberships.currentRoll })
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, input.personId),
          eq(memberships.organizationId, organizationId),
          isNull(memberships.endedOn),
        ),
      )
      .limit(1);
    if (!membership) {
      return { kind: "invalid_target" };
    }

    // Step 4 — org_unit, when supplied, must belong to THIS org.
    let orgUnitId: string | null = null;
    if (input.orgUnitId) {
      if (!isUuid(input.orgUnitId)) {
        return { kind: "invalid_target" };
      }
      const [orgUnit] = await tx
        .select({
          id: orgUnits.id,
          unitType: orgUnits.unitType,
          archivedAt: orgUnits.archivedAt,
        })
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.id, input.orgUnitId),
            eq(orgUnits.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!orgUnit) {
        return { kind: "invalid_target" };
      }
      // An archived district or a campus cannot take a new deacon term. The
      // `officer_terms_org_unit_target_guard` trigger is the backstop for the
      // race with a concurrent archive.
      if (orgUnit.archivedAt !== null || orgUnit.unitType === "campus") {
        return { kind: "district_unavailable" };
      }
      orgUnitId = orgUnit.id;
    }

    // Step 5 — resolved BEFORE the insert, so a caught overlap never needs a
    // second query.
    const [personRow] = await tx
      .select({
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
        userId: people.userId,
      })
      .from(people)
      .where(eq(people.id, input.personId))
      .limit(1);
    const personName = personRow
      ? `${personRow.preferredName ?? personRow.firstName} ${personRow.lastName}`
      : "That person";
    const selfRecorded =
      personRow?.userId !== null &&
      personRow?.userId !== undefined &&
      personRow.userId === actingUserId;

    // Step 5b — S1: a pastor's membership is held by the presbytery, so a
    // pastor term cannot seat a person who is on this congregation's roll.
    if (isPastorOffice(input.office)) {
      const asOf = input.startsOn > todayUtcYmd() ? input.startsOn : todayUtcYmd();
      const replay = await tx.execute(sql`
        select presby_roll_as_of(
                 ${input.personId}::uuid,
                 ${organizationId}::uuid,
                 ${asOf}::date
               ) as roll
      `);
      const rollAsOf =
        (replay as unknown as { rows?: Array<{ roll?: string | null }> }).rows?.[0]?.roll ??
        null;
      if (membership.currentRoll !== null || rollAsOf !== null) {
        return { kind: "on_roll", personName };
      }
    }

    let termId: string;
    try {
      const [inserted] = await tx
        .insert(officerTerms)
        .values({
          organizationId,
          personId: input.personId,
          office: input.office,
          startsOn: input.startsOn,
          electedOn: input.electedOn ?? null,
          installedOn: input.installedOn ?? null,
          classYear: input.classYear ?? null,
          minuteReference: input.minuteReference ?? null,
          orgUnitId,
          recordedBy: actingUserId,
        })
        .returning({ id: officerTerms.id });
      termId = inserted!.id;
    } catch (err) {
      if (isExclusionViolation(err)) {
        return {
          kind: "overlap",
          personName,
          officeLabel: OFFICE_LABELS[input.office],
        };
      }
      // The races the pre-checks above cannot close: the roll changed between
      // the check and the insert (the trigger's own constraint name, so no
      // message is parsed), or the derived group vanished.
      if (isPgError(err, "23514", "officer_terms_pastor_no_roll")) {
        return { kind: "on_roll", personName };
      }
      if (
        isPgError(err, "23514", "org_unit_target_archived") ||
        isPgError(err, "23514", "org_unit_target_campus")
      ) {
        return { kind: "district_unavailable" };
      }
      if (
        isPgError(err, "23503") &&
        /has no derived group/.test(pgErrorMessages(err))
      ) {
        return {
          kind: "invalid_office_for_org",
          officeLabel: OFFICE_LABELS[input.office],
        };
      }
      throw err;
    }

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.OFFICER_TERM_STARTED,
      actor: { userId: actingUserId, email: opts?.actingUserEmail ?? null },
      resourceType: "officer_term",
      resourceId: termId,
      metadata: {
        organizationId,
        personId: input.personId,
        office: input.office,
        startsOn: input.startsOn,
        orgUnitId,
        selfRecorded,
      },
    });

    return { kind: "ok", data: { termId } };
  });
}

// ---------------------------------------------------------------------------
// endOfficerTerm
// ---------------------------------------------------------------------------

export interface EndOfficerTermInput {
  termId: string;
  /** 'YYYY-MM-DD'. */
  endsOn: string;
  endReason: string;
}

/**
 * Ends `input.termId` (`ends_on`/`end_reason` on the EXISTING row) — NEVER a
 * delete. `officer_terms_sync_derived` propagates `ends_on` into the
 * person's `group_memberships` row on its own; Session/Diaconate access
 * drops the day the term does, with no further write from this module.
 *
 * Writes `tenant.officer_term.ended` in the SAME transaction (R13). The
 * person and office in the metadata are read from the term's own row, never
 * from client input (the action used to forward them from the form), and
 * `selfRecorded` is stamped on the end as on the start.
 */
export async function endOfficerTerm(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: EndOfficerTermInput,
  opts?: OfficerActingOptions,
): Promise<OfficersResult<{ termId: string }>> {
  if (!DATE_RE.test(input.endsOn)) {
    throw new Error(
      `endOfficerTerm: endsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.endsOn)}`,
    );
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOfficersManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    if (!isUuid(input.termId)) {
      return { kind: "invalid_target" };
    }
    const [term] = await tx
      .select({
        id: officerTerms.id,
        startsOn: officerTerms.startsOn,
        personId: officerTerms.personId,
        office: officerTerms.office,
      })
      .from(officerTerms)
      .where(
        and(
          eq(officerTerms.id, input.termId),
          eq(officerTerms.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!term) {
      return { kind: "invalid_target" };
    }

    // 'YYYY-MM-DD' strings compare correctly lexicographically.
    if (input.endsOn < term.startsOn) {
      return {
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      };
    }

    const [person] = await tx
      .select({ userId: people.userId })
      .from(people)
      .where(eq(people.id, term.personId))
      .limit(1);
    const selfRecorded =
      person?.userId !== null &&
      person?.userId !== undefined &&
      person.userId === actingUserId;

    await tx
      .update(officerTerms)
      .set({ endsOn: input.endsOn, endReason: input.endReason })
      .where(eq(officerTerms.id, input.termId));

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.OFFICER_TERM_ENDED,
      actor: { userId: actingUserId, email: opts?.actingUserEmail ?? null },
      resourceType: "officer_term",
      resourceId: input.termId,
      metadata: {
        organizationId,
        personId: term.personId,
        office: term.office,
        endsOn: input.endsOn,
        endReason: input.endReason,
        selfRecorded,
      },
    });

    return { kind: "ok", data: { termId: input.termId } };
  });
}

// ---------------------------------------------------------------------------
// setOfficerTermPublicListed
// ---------------------------------------------------------------------------

export interface SetOfficerTermPublicListedInput {
  termId: string;
  publicListed: boolean;
}

/**
 * Public staff-directory opt-in/opt-out (docs/work-log/
 * 2026-08-27-public-staff-directory.md, Phase 3 API Contract). Toggles
 * `officer_terms.public_listed` — the bit `presby_public_staff_roster()`
 * (drizzle/0041) reads anonymously for `(public)/site/<slug>`'s staff
 * directory.
 *
 * ORDER OF OPERATIONS, mirroring `startOfficerTerm()`/`endOfficerTerm()`
 * exactly:
 *   1. `hasOfficersManage` gate — `forbidden` if the caller doesn't hold
 *      `officers.manage` at all.
 *   2. Row lookup scoped to `(id, organizationId)` — `invalid_target` if
 *      missing or belongs to another org (F2 shape, matching
 *      `endOfficerTerm`'s own lookup).
 *   3. Update `publicListed`, `publicListedBy = actingUserId`,
 *      `publicListedAt = now()` on EVERY call, in BOTH directions — turning
 *      the bit off is itself an attributable, timestamped act (Phase 3 Edge
 *      Cases: this departs from `recordedBy`'s "set once at creation"
 *      precedent on purpose).
 *   4. `recordAudit()` — `OFFICER_TERM_LISTED_PUBLICLY`/
 *      `OFFICER_TERM_UNLISTED_PUBLICLY` depending on direction. Called from
 *      INSIDE this function, not from `admin/officers/actions.ts` — a
 *      DELIBERATE divergence from `startOfficerTerm`/`endOfficerTerm`'s own
 *      "actions.ts owns the audit call" convention in THIS SAME FILE (see
 *      this file's header), per the work-log's explicit Phase 3 instruction.
 *
 * `check:audit` TRIPWIRE-COVERAGE FINDING (confirmed at Phase 4, step 2):
 * `scripts/check-audit-coverage.mjs` only walks `src/app/**\/actions.ts`
 * looking for a literal `db.insert|update|delete` in THAT file. This
 * function's `tx.update(officerTerms, ...)` lives here, in `src/lib/
 * officers.ts` — a file the script never visits at all (it isn't under
 * `src/app`, and isn't named `actions.ts`). `admin/officers/actions.ts`'s
 * own wrapper (`setOfficerTermPublicListedAction`) calls no `db.*` method
 * directly either, so even that file's mutation regex never fires. Net: the
 * tripwire is BLIND to this call site, on both counts, not just one — the
 * SAME finding `staff.ts`'s identical sibling function documents; recorded
 * once each per file rather than only once, since either file could be read
 * in isolation. Do not read `check:audit` passing as coverage evidence for
 * this mutation — only `officers.test.ts`'s own assertions (`recordAudit`
 * is called on both directions) prove it fires.
 */
export async function setOfficerTermPublicListed(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: SetOfficerTermPublicListedInput,
): Promise<OfficersResult<{ termId: string; publicListed: boolean }>> {
  const result = await withOrgContext(
    viewerPersonId,
    organizationId,
    async (tx): Promise<OfficersResult<{ termId: string; publicListed: boolean }>> => {
      if (!(await hasOfficersManage(tx, viewerPersonId, organizationId))) {
        return { kind: "forbidden" };
      }

      const [term] = await tx
        .select({ id: officerTerms.id })
        .from(officerTerms)
        .where(
          and(
            eq(officerTerms.id, input.termId),
            eq(officerTerms.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!term) {
        return { kind: "invalid_target" };
      }

      await tx
        .update(officerTerms)
        .set({
          publicListed: input.publicListed,
          publicListedBy: actingUserId,
          publicListedAt: new Date(),
        })
        .where(eq(officerTerms.id, input.termId));

      return {
        kind: "ok",
        data: { termId: input.termId, publicListed: input.publicListed },
      };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: result.data.publicListed
        ? AUDIT_ACTIONS.OFFICER_TERM_LISTED_PUBLICLY
        : AUDIT_ACTIONS.OFFICER_TERM_UNLISTED_PUBLICLY,
      resourceType: "officer_term",
      resourceId: result.data.termId,
      metadata: { organizationId, publicListed: result.data.publicListed },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// setOfficerTermPublicDisplayOrder
// ---------------------------------------------------------------------------

export interface SetOfficerTermPublicDisplayOrderInput {
  termId: string;
  publicDisplayOrder: number | null;
}

/**
 * The int4 bound `coalesce(public_display_order, MAX_INT), display_name`
 * (`presby_public_staff_roster()`, `presby_public_committee_roster()`)
 * depends on this never being a legitimate curated value.
 */
const MAX_PUBLIC_DISPLAY_ORDER = 2147483647;

/**
 * Admin-set public-directory curation input (docs/work-log/
 * 2026-08-28-public-directory-primitives.md, Phase 3 API Contract). A
 * SEPARATE mutation from `setOfficerTermPublicListed()` above — same
 * "omitted vs. cleared" ambiguity `setStaffPositionPublicDisplayOrder()`'s
 * own doc comment names, avoided the identical way: a required (non-
 * optional) `number | null` input, no third state to misinterpret.
 *
 * ORDER OF OPERATIONS, mirroring `setOfficerTermPublicListed()`'s shape
 * MINUS the audit call:
 *   1. `hasOfficersManage` gate — `forbidden` if the caller doesn't hold
 *      `officers.manage` at all.
 *   2. Row lookup scoped to `(id, organizationId)` — `invalid_target` if
 *      missing or belongs to another org.
 *   3. Validate `publicDisplayOrder` is `null` or a non-negative integer ≤
 *      2147483647 — `invalid_input` otherwise.
 *   4. Update `publicDisplayOrder` only.
 *
 * NO `recordAudit()` CALL, unlike `setOfficerTermPublicListed()` — setting a
 * display-order integer among people who are ALREADY public-listed changes
 * nothing about who is visible or reachable; it is purely a presentation-
 * order fact, the same DECISION-113 "content configuration" shape this
 * function's `staff.ts` sibling documents at length. Named explicitly so a
 * future reader doesn't "fix" the apparent asymmetry with this function's
 * `publicListed` sibling immediately above.
 */
export async function setOfficerTermPublicDisplayOrder(
  viewerPersonId: string,
  organizationId: string,
  input: SetOfficerTermPublicDisplayOrderInput,
): Promise<
  OfficersResult<{ termId: string; publicDisplayOrder: number | null }>
> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOfficersManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [term] = await tx
      .select({ id: officerTerms.id })
      .from(officerTerms)
      .where(
        and(
          eq(officerTerms.id, input.termId),
          eq(officerTerms.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!term) {
      return { kind: "invalid_target" };
    }

    if (
      input.publicDisplayOrder !== null &&
      (!Number.isInteger(input.publicDisplayOrder) ||
        input.publicDisplayOrder < 0 ||
        input.publicDisplayOrder > MAX_PUBLIC_DISPLAY_ORDER)
    ) {
      return {
        kind: "invalid_input",
        message:
          "Display order must be a whole number from 0 to 2147483647, or left blank.",
      };
    }

    await tx
      .update(officerTerms)
      .set({ publicDisplayOrder: input.publicDisplayOrder })
      .where(eq(officerTerms.id, input.termId));

    return {
      kind: "ok",
      data: {
        termId: input.termId,
        publicDisplayOrder: input.publicDisplayOrder,
      },
    };
  });
}
