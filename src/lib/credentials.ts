import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import { appointments, ordinations } from "@/lib/db/domain/officers";
import { organizations } from "@/lib/db/domain/org";
import { memberships, people } from "@/lib/db/domain/people";

/**
 * Ministry credentials & pastoral appointments — Increment 2 of
 * `docs/work-log/2026-08-26-presbytery-functionality.md` (DECISION-112 /
 * DECISION-116). Records a minister's ordination-status changes and who
 * serves as pastor at a member congregation, both presbytery-side only.
 *
 * SAME SHAPE AS `src/lib/officers.ts` (Phase 3's own instruction): one
 * `withOrgContext()` transaction per exported function, the `credentials
 * .manage` gate checked FIRST inside every one of them via the private
 * `hasCredentialsManage` helper below, before any other read or write.
 * Thrown exceptions are reserved for genuine failure (`OrgAccessError`, a
 * malformed enum/date); every expected/denied outcome is a typed
 * `CredentialsResult` variant.
 *
 * ONE PERMISSION GATES BOTH JOBS (DECISION-116 ruling 1) — there is
 * deliberately no `ordinations.manage`/`appointments.manage` split.
 *
 * THE TRANSFERRING-IN-MINISTER CASE (DECISION-116 ruling 3): both
 * `recordOrdination()` and `recordAppointment()` require the target person
 * to hold a CURRENT `memberships` row at THIS org (F21 shape, same as
 * `startOfficerTerm`/`grantRole`) — never a side-door create-person flow.
 * An empty person-picker in `getCredentialsFormOptions()` is the correct
 * signal, not a bug: the clerk's next step is `/o/[slug]/admin/members`.
 *
 * `recordAppointment()`'s PARENT-PATH CHECK (Phase 1's "second org id"
 * adversarial finding, restated in Phase 3's Edge Cases): `servingOrgId` is
 * never trusted as a bare client-supplied id. It must resolve to an
 * `organizations` row whose `parentId` is THIS presbytery AND whose
 * `organizationType` is `congregation` or `new_worshiping_community` — a
 * congregation belonging to a DIFFERENT presbytery is rejected the same as
 * a nonexistent id, both as `invalid_target`.
 *
 * NO DB-LEVEL OVERLAP-EXCLUSION CONSTRAINT ON `appointments` (unlike
 * `officer_terms_no_overlap`) — DECISION-112/schema commit's own ruling,
 * mirroring DECISION-110's acceptance for `group_memberships`. The
 * check-before-insert against a second OPEN appointment for the same
 * person at the same `servingOrgId` is therefore an app-level, TOCTOU-prone
 * guard, accepted as proportionate for this low-frequency,
 * single-clerk-at-a-time write path (flagged in the work-log for
 * `docs/TODO.md` if that ever changes).
 *
 * RESOLVING AN AMBIGUITY BETWEEN PHASE 3'S API CONTRACT AND ITS EDGE CASES
 * (documented here so a future reader doesn't wonder why there is no
 * `endOrdination`/`removeOrdination` export): the API Contract lists
 * exactly one ordination-status write path, `changeOrdinationStatus()`,
 * accepting the full `credentialStatus` enum including `"removed"`. The
 * Edge Cases section separately calls for TWO distinct UI controls —
 * "Change status" and "End ordination", the latter with its own
 * confirmation copy naming the consequence — so the two don't read as one
 * dropdown mixing action classes. Both are implemented as calling this
 * SAME function: the admin UI's "Change status" picker offers every status
 * except `"removed"`; its "End ordination" control is a separate confirm
 * dialog that always submits `status: "removed"`. One backend function,
 * two UI entry points with different weight and copy — never two backend
 * functions for a change that only ever touches the same column.
 * `endedOn`/`endedReason` remain untouched by this module entirely, exactly
 * as DECISION-112 specifies: those model true removal semantics `ordinations`
 * already carried before this increment; `status = "removed"` is the new,
 * distinct "removed from ordered ministry" credential state, and this
 * module never writes to `endedOn`/`endedReason`.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CREDENTIALS_MANAGE = "credentials.manage";
const MINUTE_REFERENCE_MAX = 500;
const END_REASON_MAX = 500;

// ---------------------------------------------------------------------------
// Ordination vocabulary
// ---------------------------------------------------------------------------

export const ORDAINED_MINISTRIES = [
  "ruling_elder",
  "deacon",
  "minister_of_word_and_sacrament",
] as const;
export type OrdainedMinistry = (typeof ORDAINED_MINISTRIES)[number];

function isOrdainedMinistry(value: string): value is OrdainedMinistry {
  return (ORDAINED_MINISTRIES as readonly string[]).includes(value);
}

/**
 * Adapted verbatim from psvonline-portal's `credentialStatusEnum`
 * (`drizzle/0037_presby_ministry_credentials.sql`). `"removed"` is the
 * "removed from ordered ministry" credential state — see this file's own
 * header for how it is distinguished from `endedOn`/`endedReason` in the UI.
 */
export const CREDENTIAL_STATUSES = [
  "active",
  "honorably_retired",
  "on_leave",
  "exempt_from_active_service",
  "disciplined",
  "removed",
  "deceased",
] as const;
export type CredentialStatusValue = (typeof CREDENTIAL_STATUSES)[number];

function isCredentialStatus(value: string): value is CredentialStatusValue {
  return (CREDENTIAL_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Appointment vocabulary
// ---------------------------------------------------------------------------

export const APPOINTMENT_CALL_TYPES = [
  "installed_pastor",
  "designated_pastor",
  "stated_supply",
  "interim_pastor",
  "temporary_supply",
  "parish_associate",
] as const;
export type AppointmentCallType = (typeof APPOINTMENT_CALL_TYPES)[number];

function isAppointmentCallType(value: string): value is AppointmentCallType {
  return (APPOINTMENT_CALL_TYPES as readonly string[]).includes(value);
}

/** `organizations.organizationType` values eligible as a `servingOrgId`. */
const SERVING_ORG_TYPES = ["congregation", "new_worshiping_community"] as const;

/**
 * The single-permission gate every exported function in this module checks
 * FIRST. Not exported — same discipline `hasOfficersManage`/
 * `hasRoleGrantsManage` document.
 */
async function hasCredentialsManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${CREDENTIALS_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

function displayNameOf(row: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return `${row.preferredName ?? row.firstName} ${row.lastName}`;
}

// ---------------------------------------------------------------------------
// Shared result type
// ---------------------------------------------------------------------------

export type CredentialsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

// ---------------------------------------------------------------------------
// listOrdinations
// ---------------------------------------------------------------------------

export interface OrdinationEntry {
  ordinationId: string;
  personId: string;
  displayName: string;
  ministry: OrdainedMinistry;
  /** 'YYYY-MM-DD'. */
  ordainedOn: string;
  status: CredentialStatusValue;
  minuteReference: string | null;
  /** True-removal fields, unchanged by this module. Non-null only for a
   *  pre-existing row this module never wrote. */
  endedOn: string | null;
  endedReason: string | null;
}

/** Every ordination row recorded at this org (presbytery), current + historical. */
export async function listOrdinations(
  viewerPersonId: string,
  organizationId: string,
): Promise<CredentialsResult<OrdinationEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasCredentialsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const rows = await tx
      .select({
        ordinationId: ordinations.id,
        personId: ordinations.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
        ministry: ordinations.ministry,
        ordainedOn: ordinations.ordainedOn,
        status: ordinations.status,
        minuteReference: ordinations.minuteReference,
        endedOn: ordinations.endedOn,
        endedReason: ordinations.endedReason,
      })
      .from(ordinations)
      .innerJoin(people, eq(people.id, ordinations.personId))
      .where(eq(ordinations.organizationId, organizationId))
      .orderBy(people.lastName, people.firstName, ordinations.ordainedOn);

    const data: OrdinationEntry[] = rows.map((row) => ({
      ordinationId: row.ordinationId,
      personId: row.personId,
      displayName: displayNameOf(row),
      ministry: row.ministry as OrdainedMinistry,
      ordainedOn: row.ordainedOn,
      status: row.status as CredentialStatusValue,
      minuteReference: row.minuteReference,
      endedOn: row.endedOn,
      endedReason: row.endedReason,
    }));

    return { kind: "ok", data };
  });
}

// ---------------------------------------------------------------------------
// recordOrdination
// ---------------------------------------------------------------------------

export interface RecordOrdinationInput {
  personId: string;
  ministry: OrdainedMinistry;
  /** 'YYYY-MM-DD'. */
  ordainedOn: string;
  minuteReference?: string;
}

/**
 * New `ordinations` row, `status: 'active'`. `personId` must hold a CURRENT
 * membership at this org (F21 shape) — see this file's header for the
 * transferring-in-minister case this blocks.
 */
export async function recordOrdination(
  viewerPersonId: string,
  organizationId: string,
  input: RecordOrdinationInput,
): Promise<CredentialsResult<{ ordinationId: string }>> {
  if (!DATE_RE.test(input.ordainedOn)) {
    throw new Error(
      `recordOrdination: ordainedOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.ordainedOn)}`,
    );
  }
  if (!isOrdainedMinistry(input.ministry)) {
    throw new Error(
      `recordOrdination: unrecognized ministry ${JSON.stringify(input.ministry)}`,
    );
  }
  if (input.minuteReference && input.minuteReference.length > MINUTE_REFERENCE_MAX) {
    return {
      kind: "invalid_input",
      message: `Minute reference must be ${MINUTE_REFERENCE_MAX} characters or fewer.`,
    };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasCredentialsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    // F21 shape: a CURRENT membership at this org, not a bare people lookup.
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

    const [inserted] = await tx
      .insert(ordinations)
      .values({
        organizationId,
        personId: input.personId,
        ministry: input.ministry,
        ordainedOn: input.ordainedOn,
        minuteReference: input.minuteReference ?? null,
        status: "active",
      })
      .returning({ id: ordinations.id });

    return { kind: "ok", data: { ordinationId: inserted!.id } };
  });
}

// ---------------------------------------------------------------------------
// changeOrdinationStatus
// ---------------------------------------------------------------------------

export interface ChangeOrdinationStatusInput {
  ordinationId: string;
  status: CredentialStatusValue;
  minuteReference?: string;
}

/**
 * Updates `ordinations.status` on the EXISTING row — never `endedOn`/
 * `endedReason` (this file's header explains why, and how the "End
 * ordination" UI control reaches `status: "removed"` through this same
 * function rather than a separate one).
 */
export async function changeOrdinationStatus(
  viewerPersonId: string,
  organizationId: string,
  input: ChangeOrdinationStatusInput,
): Promise<CredentialsResult<{ ordinationId: string }>> {
  if (!isCredentialStatus(input.status)) {
    throw new Error(
      `changeOrdinationStatus: unrecognized status ${JSON.stringify(input.status)}`,
    );
  }
  if (input.minuteReference && input.minuteReference.length > MINUTE_REFERENCE_MAX) {
    return {
      kind: "invalid_input",
      message: `Minute reference must be ${MINUTE_REFERENCE_MAX} characters or fewer.`,
    };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasCredentialsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({ id: ordinations.id })
      .from(ordinations)
      .where(
        and(
          eq(ordinations.id, input.ordinationId),
          eq(ordinations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) {
      return { kind: "invalid_target" };
    }

    await tx
      .update(ordinations)
      .set({
        status: input.status,
        ...(input.minuteReference !== undefined
          ? { minuteReference: input.minuteReference }
          : {}),
      })
      .where(eq(ordinations.id, input.ordinationId));

    return { kind: "ok", data: { ordinationId: input.ordinationId } };
  });
}

// ---------------------------------------------------------------------------
// listAppointments
// ---------------------------------------------------------------------------

export interface AppointmentEntry {
  appointmentId: string;
  personId: string;
  displayName: string;
  servingOrgId: string;
  servingOrgName: string;
  callType: AppointmentCallType;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  /** 'YYYY-MM-DD', or null (current/open-ended). */
  endsOn: string | null;
  minuteReference: string | null;
}

/**
 * Every appointment recorded at this org (presbytery), current + historical,
 * joined against `organizations` for the serving-org display name.
 */
export async function listAppointments(
  viewerPersonId: string,
  organizationId: string,
): Promise<CredentialsResult<AppointmentEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasCredentialsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const servingOrg = organizations; // aliased for readability below

    const rows = await tx
      .select({
        appointmentId: appointments.id,
        personId: appointments.personId,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
        servingOrgId: appointments.servingOrgId,
        servingOrgName: servingOrg.name,
        callType: appointments.callType,
        startsOn: appointments.startsOn,
        endsOn: appointments.endsOn,
        minuteReference: appointments.minuteReference,
      })
      .from(appointments)
      .innerJoin(people, eq(people.id, appointments.personId))
      .innerJoin(servingOrg, eq(servingOrg.id, appointments.servingOrgId))
      .where(eq(appointments.organizationId, organizationId))
      .orderBy(servingOrg.name, appointments.startsOn);

    const data: AppointmentEntry[] = rows.map((row) => ({
      appointmentId: row.appointmentId,
      personId: row.personId,
      displayName: displayNameOf(row),
      servingOrgId: row.servingOrgId,
      servingOrgName: row.servingOrgName,
      callType: row.callType as AppointmentCallType,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      minuteReference: row.minuteReference,
    }));

    return { kind: "ok", data };
  });
}

// ---------------------------------------------------------------------------
// recordAppointment
// ---------------------------------------------------------------------------

export interface RecordAppointmentInput {
  personId: string;
  servingOrgId: string;
  callType: AppointmentCallType;
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  minuteReference?: string;
}

/**
 * ORDER: gate -> person is a CURRENT member of THIS org (F21) ->
 * `servingOrgId` parent-path check (this file's header) -> refuse a second
 * OPEN appointment for the same person at the same `servingOrgId` -> insert.
 */
export async function recordAppointment(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: RecordAppointmentInput,
): Promise<CredentialsResult<{ appointmentId: string }>> {
  if (!DATE_RE.test(input.startsOn)) {
    throw new Error(
      `recordAppointment: startsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.startsOn)}`,
    );
  }
  if (!isAppointmentCallType(input.callType)) {
    throw new Error(
      `recordAppointment: unrecognized callType ${JSON.stringify(input.callType)}`,
    );
  }
  if (input.minuteReference && input.minuteReference.length > MINUTE_REFERENCE_MAX) {
    return {
      kind: "invalid_input",
      message: `Minute reference must be ${MINUTE_REFERENCE_MAX} characters or fewer.`,
    };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasCredentialsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    // Step 1 — F21 shape: a CURRENT membership at this org.
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

    // Step 2 — parent-path check: servingOrgId must be an actual member
    // congregation/NWC of THIS presbytery, never a bare client-supplied id
    // and never a congregation belonging to a DIFFERENT presbytery.
    const [servingOrgRow] = await tx
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, input.servingOrgId),
          eq(organizations.parentId, organizationId),
          inArray(organizations.organizationType, [...SERVING_ORG_TYPES]),
        ),
      )
      .limit(1);
    if (!servingOrgRow) {
      return { kind: "invalid_target" };
    }

    // Resolve names BEFORE the collision check, so an invalid_input message
    // never needs a second query (same discipline startOfficerTerm documents
    // for its own overlap message).
    const [personRow] = await tx
      .select({
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(people)
      .where(eq(people.id, input.personId))
      .limit(1);
    const personName = personRow ? displayNameOf(personRow) : "That person";

    // Step 3 — app-level check-before-insert (no DB exclusion constraint on
    // this table; see this file's header). TOCTOU-prone, accepted per
    // DECISION-110's precedent for group_memberships.
    const [openConflict] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.organizationId, organizationId),
          eq(appointments.personId, input.personId),
          eq(appointments.servingOrgId, input.servingOrgId),
          isNull(appointments.endsOn),
        ),
      )
      .limit(1);
    if (openConflict) {
      return {
        kind: "invalid_input",
        message: `${personName} already has an open appointment at ${servingOrgRow.name} — end it first.`,
      };
    }

    const [inserted] = await tx
      .insert(appointments)
      .values({
        organizationId,
        personId: input.personId,
        servingOrgId: input.servingOrgId,
        callType: input.callType,
        startsOn: input.startsOn,
        minuteReference: input.minuteReference ?? null,
        recordedBy: actingUserId,
      })
      .returning({ id: appointments.id });

    return { kind: "ok", data: { appointmentId: inserted!.id } };
  });
}

// ---------------------------------------------------------------------------
// endAppointment
// ---------------------------------------------------------------------------

export interface EndAppointmentInput {
  appointmentId: string;
  /** 'YYYY-MM-DD'. */
  endsOn: string;
  endReason: string;
}

/** Sets `endsOn`/`endReason` on the existing row — never a delete, same
 *  discipline as `endOfficerTerm()`. */
export async function endAppointment(
  viewerPersonId: string,
  organizationId: string,
  input: EndAppointmentInput,
): Promise<CredentialsResult<{ appointmentId: string }>> {
  if (!DATE_RE.test(input.endsOn)) {
    throw new Error(
      `endAppointment: endsOn must be 'YYYY-MM-DD', got ${JSON.stringify(input.endsOn)}`,
    );
  }
  if (input.endReason.length > END_REASON_MAX) {
    return {
      kind: "invalid_input",
      message: `End reason must be ${END_REASON_MAX} characters or fewer.`,
    };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasCredentialsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({ id: appointments.id, startsOn: appointments.startsOn })
      .from(appointments)
      .where(
        and(
          eq(appointments.id, input.appointmentId),
          eq(appointments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) {
      return { kind: "invalid_target" };
    }

    // 'YYYY-MM-DD' strings compare correctly lexicographically.
    if (input.endsOn < row.startsOn) {
      return {
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      };
    }

    await tx
      .update(appointments)
      .set({ endsOn: input.endsOn, endReason: input.endReason })
      .where(eq(appointments.id, input.appointmentId));

    return { kind: "ok", data: { appointmentId: input.appointmentId } };
  });
}

// ---------------------------------------------------------------------------
// getCredentialsFormOptions
// ---------------------------------------------------------------------------

export interface CredentialsFormOptions {
  people: Array<{ personId: string; displayName: string }>;
  /**
   * `platformStatus` surfaces here deliberately (Phase 3 Edge Cases) — a
   * presbytery's own member-congregation list showing managed/unmanaged/
   * invited is presbytery-internal, legitimate per Phase 1's Adversarial
   * Pass note, not a public-prober leak.
   */
  servingOrgs: Array<{
    organizationId: string;
    name: string;
    platformStatus: string;
  }>;
}

/**
 * People: current memberships at this org (F21 shape, same as
 * `getOfficerFormOptions`). servingOrgs: `organizations` rows where
 * `parentId = organizationId` and type is congregation/NWC — the
 * presbytery's own member list, not a bare `select * from organizations`.
 */
export async function getCredentialsFormOptions(
  viewerPersonId: string,
  organizationId: string,
): Promise<CredentialsResult<CredentialsFormOptions>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasCredentialsManage(tx, viewerPersonId, organizationId))) {
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

    const servingOrgRows = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        platformStatus: organizations.platformStatus,
      })
      .from(organizations)
      .where(
        and(
          eq(organizations.parentId, organizationId),
          inArray(organizations.organizationType, [...SERVING_ORG_TYPES]),
        ),
      )
      .orderBy(organizations.name);

    return {
      kind: "ok",
      data: {
        people: peopleRows.map((row) => ({
          personId: row.personId,
          displayName: displayNameOf(row),
        })),
        servingOrgs: servingOrgRows.map((row) => ({
          organizationId: row.id,
          name: row.name,
          platformStatus: row.platformStatus,
        })),
      },
    };
  });
}
