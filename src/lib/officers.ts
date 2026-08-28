import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import { isExclusionViolation } from "@/lib/db/errors";
import { officerTerms } from "@/lib/db/domain/officers";
import { orgUnits } from "@/lib/db/domain/org";
import { memberships, people } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

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
 * `setOfficerTermPublicListed()` (docs/work-log/
 * 2026-08-27-public-staff-directory.md, Phase 3) IS AN EXCEPTION to this
 * module's usual "audit lives in `admin/officers/actions.ts`" split
 * (`startOfficerTerm`/`endOfficerTerm`'s own `AUDIT_ACTIONS.OFFICER_TERM_
 * STARTED`/`ENDED` calls are in that actions.ts file, not here) —
 * `recordAudit()` is called from INSIDE this function per that work-log's
 * explicit Phase 3 instruction. See the function's own doc comment for the
 * `check:audit` tripwire-coverage finding this produced.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFFICERS_MANAGE = "officers.manage";

export const OFFICER_OFFICES = [
  "ruling_elder",
  "deacon",
  "clerk_of_session",
  "moderator",
  "treasurer",
  "trustee",
] as const;

export type OfficerOffice = (typeof OFFICER_OFFICES)[number];

export const OFFICE_LABELS: Record<OfficerOffice, string> = {
  ruling_elder: "Ruling Elder",
  deacon: "Deacon",
  clerk_of_session: "Clerk of Session",
  moderator: "Moderator",
  treasurer: "Treasurer",
  trustee: "Trustee",
};

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
  /** Public staff-directory opt-in (docs/work-log/
   * 2026-08-27-public-staff-directory.md) — additive field, same query. */
  publicListed: boolean;
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
  orgUnits: Array<{ orgUnitId: string; name: string }>;
}

export type OfficersResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string }
  | { kind: "overlap"; personName: string; officeLabel: string };

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
  public_listed: boolean;
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
        values ('ruling_elder'), ('deacon'), ('clerk_of_session'),
               ('moderator'), ('treasurer'), ('trustee')
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
        ot.public_listed        as public_listed
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
      publicListed: row.public_listed,
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

    const orgUnitRows = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.organizationId, organizationId))
      .orderBy(orgUnits.name);

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
 *   3. Validate `personId` is a CURRENT member of this org (F21 shape) —
 *      `invalid_target`.
 *   4. Validate `orgUnitId`, when supplied, belongs to THIS org —
 *      `invalid_target`. Closes the composite-tenant-key gap (F2/F21): an
 *      `org_unit` id from another organization can never be attached to a
 *      term here.
 *   5. Resolve the person's display name BEFORE the insert, so the
 *      `overlap` result never needs a second query after the failure (Phase
 *      3's own API-contract note).
 *   6. Insert, wrapped in try/catch for `officer_terms_no_overlap`
 *      (`isExclusionViolation()`) — mapped to `overlap`, never surfaced raw.
 */
export async function startOfficerTerm(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: StartOfficerTermInput,
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

    // Step 3 — F21 shape: a CURRENT membership at this org, not a bare
    // people lookup.
    const [membership] = await tx
      .select({ id: memberships.id })
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
      const [orgUnit] = await tx
        .select({ id: orgUnits.id })
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
      orgUnitId = orgUnit.id;
    }

    // Step 5 — resolved BEFORE the insert, so a caught overlap never needs a
    // second query.
    const [personRow] = await tx
      .select({
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(people)
      .where(eq(people.id, input.personId))
      .limit(1);
    const personName = personRow
      ? `${personRow.preferredName ?? personRow.firstName} ${personRow.lastName}`
      : "That person";

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

      return { kind: "ok", data: { termId: inserted!.id } };
    } catch (err) {
      if (isExclusionViolation(err)) {
        return {
          kind: "overlap",
          personName,
          officeLabel: OFFICE_LABELS[input.office],
        };
      }
      throw err;
    }
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
 */
export async function endOfficerTerm(
  viewerPersonId: string,
  organizationId: string,
  input: EndOfficerTermInput,
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

    const [term] = await tx
      .select({ id: officerTerms.id, startsOn: officerTerms.startsOn })
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

    await tx
      .update(officerTerms)
      .set({ endsOn: input.endsOn, endReason: input.endReason })
      .where(eq(officerTerms.id, input.termId));

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
