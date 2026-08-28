import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import { isExclusionViolation } from "@/lib/db/errors";
import { staffPositions } from "@/lib/db/domain/staff";
import { memberships, people } from "@/lib/db/domain/people";

/**
 * Staff and personnel administration (`docs/work-log/
 * 2026-08-27-staff-and-personnel.md`, Phase 3 API Contract, DECISION-128/
 * 129). Records who holds a paid, non-ordained position (bookkeeper, choir
 * director, custodian, part-time secretary) at a congregation or presbytery —
 * starts and ends `staff_positions` rows, and reads the current roster and a
 * given person's full staff history.
 *
 * SAME SHAPE AS `src/lib/officers.ts`: one `withOrgContext()` transaction per
 * exported function, the `staff.manage` gate checked FIRST inside every one
 * of them via the private `hasStaffManage` helper below. Thrown exceptions
 * are reserved for genuine failure (malformed date shape); every
 * expected/denied outcome is a typed `StaffResult` variant.
 *
 * DELIBERATELY ORTHOGONAL TO `officers.ts` (DECISION-128's Phase 2 placement
 * ruling) — this module never reads or writes `officer_terms`,
 * `group_memberships`, or `role_grants`, and grants nothing by itself. A
 * `staff_positions` row is a personnel-administration fact, not a
 * constitutional-office or software-access fact; "everyone who serves here"
 * is a read-time union at the UI layer, never a schema join.
 *
 * THIS MODULE NEVER DELETES A `staff_positions` ROW — `endStaffPosition()`
 * only sets `endsOn`/`endReason` on the existing row, matching
 * `officer_terms`'s own "soft-end, never delete" discipline (Phase 1 Open
 * Question 3). `startStaffPosition()` is a plain INSERT every time, never an
 * upsert — two non-consecutive positions in the same title for the same
 * person/org are two distinct rows, rejected as a unit only by the
 * `staff_positions_no_overlap` GIST exclusion when they actually overlap in
 * time (the F22-shaped guard database-admin's slice already proved at the
 * SQL layer).
 *
 * `positionKey = position.trim().toLowerCase()` is computed here, in
 * `startStaffPosition()`, BEFORE every insert — it is the GIST exclusion's
 * actual equality column (`drizzle/0039_presby_staff_and_personnel.sql`).
 * This is the ONE AND ONLY intended write path onto `staff_positions`; a
 * future raw-SQL import bypassing this function could still write two
 * differently-cased colliding titles (architect's Phase 2 flag, accepted for
 * the same reason `officer_terms.office` accepts the equivalent gap — no
 * import surface exists yet for this table).
 *
 * THE PERSON-PICKER FOR "ADD A NEW PERSON" IS NOT IN THIS FILE. Per
 * DECISION-128, staff hiring's inline person-creation is a thin caller of the
 * SAME shared, F21-safe `matchPerson()`/`createPerson()` in `src/lib/
 * people.ts` (which routes matching through `presby_match_person()` only,
 * never an unscoped `people` table search) — `admin/staff/actions.ts` imports
 * both directly. `getStaffFormOptions()` below is a DIFFERENT, narrower
 * query: the org's CURRENT members only (`memberships.ended_on is null`),
 * the identical F21 shape `getOfficerFormOptions()` already uses for the
 * "attach to someone already visible here" case — never a bare `select *
 * from people`.
 *
 * NO `recordAudit()` CALLS ANYWHERE IN THIS MODULE (DECISION-129, fourth
 * ruling) — staff hiring/termination mutations carry no access-change nexus
 * at all: `staff_positions` has no trigger and no FK into `role_grants`/
 * `group_memberships`, unlike `officer_terms`'s own
 * `officer_terms_sync_derived` trigger (which is exactly why *that* table's
 * mutations ARE audited). The correct analogy is `events.manage`/
 * `organization_service_times` (DECISION-113) — content/record-keeping
 * configuration, not an identity/access/security-control change. Each
 * mutation in `admin/staff/actions.ts` carries a `// audit-exempt:` comment
 * naming this reasoning for the next reader (the mechanical `check:audit`
 * tripwire would not fire either way, since the actual writes live here
 * behind `tx.insert`/`tx.update`, matching `officers.ts`'s own indirection —
 * the comment is for humans, not the tripwire).
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const STAFF_MANAGE = "staff.manage";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The single-permission gate every exported function in this module checks
 * FIRST. Not exported, same discipline `hasOfficersManage`/
 * `hasRoleGrantsManage` document — one place `presby_has_permission(...,
 * 'staff.manage')` is spelled out.
 */
async function hasStaffManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${STAFF_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// Shared result / entry types — Phase 3's API Contract, verbatim
// ---------------------------------------------------------------------------

export type StaffResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string }
  | { kind: "overlap"; personName: string; position: string };

export interface StaffFormOptions {
  people: Array<{ personId: string; displayName: string }>;
}

export interface StaffPositionEntry {
  positionId: string;
  personId: string;
  displayName: string;
  position: string;
  department: string | null;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  /** 'YYYY-MM-DD', or null (open-ended). */
  endsOn: string | null;
  minuteReference: string | null;
}

export interface StaffHistoryEntry {
  positionId: string;
  position: string;
  department: string | null;
  startsOn: string;
  endsOn: string | null;
  endReason: string | null;
}

export interface StartStaffPositionInput {
  personId: string;
  /** Free text, trimmed, 1–200 chars. */
  position: string;
  department?: string;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  minuteReference?: string;
}

export interface EndStaffPositionInput {
  positionId: string;
  /** 'YYYY-MM-DD'. */
  endsOn: string;
  endReason: string;
}

// ---------------------------------------------------------------------------
// listStaffRoster
// ---------------------------------------------------------------------------

/**
 * The current staff roster, or (with `opts.includeEnded`) every position ever
 * recorded, open or ended, for this org. Mirrors `listOfficerRoster()`'s own
 * "include ended" toggle shape.
 */
export async function listStaffRoster(
  viewerPersonId: string,
  organizationId: string,
  opts?: { includeEnded?: boolean },
): Promise<StaffResult<StaffPositionEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasStaffManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const includeEnded = Boolean(opts?.includeEnded);
    const whereClause = includeEnded
      ? eq(staffPositions.organizationId, organizationId)
      : and(
          eq(staffPositions.organizationId, organizationId),
          isNull(staffPositions.endsOn),
        );

    const rows = await tx
      .select({
        positionId: staffPositions.id,
        personId: staffPositions.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
        position: staffPositions.position,
        department: staffPositions.department,
        startsOn: staffPositions.startsOn,
        endsOn: staffPositions.endsOn,
        minuteReference: staffPositions.minuteReference,
      })
      .from(staffPositions)
      .innerJoin(people, eq(people.id, staffPositions.personId))
      .where(whereClause)
      .orderBy(people.lastName, people.firstName, staffPositions.startsOn);

    const data: StaffPositionEntry[] = rows.map((row) => ({
      positionId: row.positionId,
      personId: row.personId,
      displayName: `${row.preferredName ?? row.firstName} ${row.lastName}`,
      position: row.position,
      department: row.department,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      minuteReference: row.minuteReference,
    }));

    return { kind: "ok", data };
  });
}

// ---------------------------------------------------------------------------
// getStaffHistory
// ---------------------------------------------------------------------------

/**
 * One person's full staff history — every position they have ever held at
 * this org, open or ended. `personId` need only have EVER held a membership
 * at this org (not necessarily a CURRENT one), same relaxed shape
 * `getOfficerHistory()` uses — a person who has since left still has a real
 * history worth reading.
 */
export async function getStaffHistory(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<StaffResult<StaffHistoryEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasStaffManage(tx, viewerPersonId, organizationId))) {
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

    const rows = await tx
      .select({
        positionId: staffPositions.id,
        position: staffPositions.position,
        department: staffPositions.department,
        startsOn: staffPositions.startsOn,
        endsOn: staffPositions.endsOn,
        endReason: staffPositions.endReason,
      })
      .from(staffPositions)
      .where(
        and(
          eq(staffPositions.organizationId, organizationId),
          eq(staffPositions.personId, personId),
        ),
      )
      .orderBy(staffPositions.startsOn);

    const data: StaffHistoryEntry[] = rows.map((row) => ({
      positionId: row.positionId,
      position: row.position,
      department: row.department,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      endReason: row.endReason,
    }));

    return { kind: "ok", data };
  });
}

// ---------------------------------------------------------------------------
// getStaffFormOptions
// ---------------------------------------------------------------------------

/**
 * The add-position form's "attach to someone already visible here" list —
 * CURRENT members of this org only (`memberships.ended_on is null`), the
 * identical F21 shape `getOfficerFormOptions()` uses. Deliberately no
 * roll-status or `engagementStatus` filter — a staff-only-anchored person
 * (`engagementStatus: "staff"`, DECISION-129) must be pickable here exactly
 * like a baptized member is, since a second staff position for an existing
 * staff-only person is a real, expected case.
 */
export async function getStaffFormOptions(
  viewerPersonId: string,
  organizationId: string,
): Promise<StaffResult<StaffFormOptions>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasStaffManage(tx, viewerPersonId, organizationId))) {
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

    return {
      kind: "ok",
      data: {
        people: peopleRows.map((row) => ({
          personId: row.personId,
          displayName: `${row.preferredName ?? row.firstName} ${row.lastName}`,
        })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// startStaffPosition
// ---------------------------------------------------------------------------

/**
 * Records a new staff position. NEVER an upsert, NEVER a delete — a plain
 * INSERT every time, mirroring `startOfficerTerm()`'s own contract exactly.
 *
 * ORDER OF OPERATIONS (mirrors `startOfficerTerm()`'s own documented order):
 *   0. `hasStaffManage` gate — `forbidden` if the caller doesn't hold
 *      `staff.manage` at all. Runs before anything else.
 *   1. `startsOn` date-shape validation — thrown, genuine bad input,
 *      matching `startOfficerTerm()`'s own "malformed startsOn" contract.
 *   2. `position` trimmed/length-validated (1–200 chars) — `invalid_input`.
 *   3. Validate `personId` is a CURRENT member of this org (F21 shape) —
 *      `invalid_target`. This function never creates a `memberships` row;
 *      the "person doesn't exist yet" branch is `createPerson()`'s
 *      `rollAction: { kind: "none" }` arm, called from `admin/staff/
 *      actions.ts`, not from here.
 *   4. Resolve the person's display name BEFORE the insert, so the
 *      `overlap` result never needs a second query.
 *   5. Insert, wrapped in try/catch for `staff_positions_no_overlap`
 *      (`isExclusionViolation()`) — mapped to `overlap`, never surfaced raw.
 */
export async function startStaffPosition(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: StartStaffPositionInput,
): Promise<StaffResult<{ positionId: string }>> {
  if (!DATE_RE.test(input.startsOn)) {
    throw new Error(
      `startStaffPosition: startsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.startsOn)}`,
    );
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasStaffManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const trimmedPosition = input.position.trim();
    if (trimmedPosition.length < 1 || trimmedPosition.length > 200) {
      return {
        kind: "invalid_input",
        message: "Position must be between 1 and 200 characters.",
      };
    }
    // The GIST exclusion's actual equality column — case-folded so
    // "Secretary" and "secretary" collide as the same open term (architect's
    // Phase 2 normalization flag). `position` itself preserves the caller's
    // casing for display.
    const positionKey = trimmedPosition.toLowerCase();

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

    // Step 4 — resolved BEFORE the insert, so a caught overlap never needs a
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

    const trimmedDepartment = input.department?.trim();
    const trimmedMinuteReference = input.minuteReference?.trim();

    try {
      const [inserted] = await tx
        .insert(staffPositions)
        .values({
          organizationId,
          personId: input.personId,
          position: trimmedPosition,
          positionKey,
          department: trimmedDepartment || null,
          startsOn: input.startsOn,
          minuteReference: trimmedMinuteReference || null,
          recordedBy: actingUserId,
        })
        .returning({ id: staffPositions.id });

      return { kind: "ok", data: { positionId: inserted!.id } };
    } catch (err) {
      if (isExclusionViolation(err)) {
        return { kind: "overlap", personName, position: trimmedPosition };
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// endStaffPosition
// ---------------------------------------------------------------------------

/**
 * Ends `input.positionId` (`endsOn`/`endReason` on the EXISTING row) — NEVER
 * a delete. Mirrors `endOfficerTerm()`'s own contract: `invalid_target` if
 * the row doesn't exist (or belongs to another org), `invalid_input` if
 * `endsOn` precedes `startsOn`.
 *
 * Deliberately touches nothing in `role_grants`/`group_memberships` — HR and
 * access revocation stay two separate admin actions (Phase 1's own framing,
 * unchanged by this design; `staff_positions` carries no FK into either).
 */
export async function endStaffPosition(
  viewerPersonId: string,
  organizationId: string,
  input: EndStaffPositionInput,
): Promise<StaffResult<{ positionId: string }>> {
  if (!DATE_RE.test(input.endsOn)) {
    throw new Error(
      `endStaffPosition: endsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.endsOn)}`,
    );
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasStaffManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [position] = await tx
      .select({ id: staffPositions.id, startsOn: staffPositions.startsOn })
      .from(staffPositions)
      .where(
        and(
          eq(staffPositions.id, input.positionId),
          eq(staffPositions.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!position) {
      return { kind: "invalid_target" };
    }

    // 'YYYY-MM-DD' strings compare correctly lexicographically.
    if (input.endsOn < position.startsOn) {
      return {
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      };
    }

    await tx
      .update(staffPositions)
      .set({ endsOn: input.endsOn, endReason: input.endReason })
      .where(eq(staffPositions.id, input.positionId));

    return { kind: "ok", data: { positionId: input.positionId } };
  });
}
