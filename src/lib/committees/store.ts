import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { OrgAccessError, withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import {
  COMMITTEES_GUARD_CODES,
  commissionRecordMembers,
  commissionRecords,
  committeeDetails,
} from "@/lib/db/domain/committees";
import { groupMemberships, groups, groupTypes } from "@/lib/db/domain/groups";
import { memberships, people } from "@/lib/db/domain/people";
import { pgErrorField, pgErrorMessages } from "@/lib/db/errors";
import {
  addManagedGroupSeatInTx,
  endManagedGroupMemberInTx,
  insertManagedGroupInTx,
  setManagedMembershipPublicListedInTx,
  updateManagedGroupInTx,
  type GroupsResult,
} from "@/lib/groups";
import { COMMITTEE_ROLES, type CommitteeRole } from "@/lib/group-roles";
import { isUuid } from "@/lib/is-uuid";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { resolveMemberCongregation } from "@/lib/presbytery";
import { readGroupRoleGrantsInTx } from "@/lib/role-grants";
import { todayInOrgZone } from "@/lib/shared/org-time";
import {
  GROUPS_MANAGE_KEY,
  LIMITS,
  type ChangedField,
  type CommissionChangedField,
  type CommitteesCtx,
  type Outcome,
  type Refusal,
  type RefusalDetail,
  type Written,
} from "./contract";
import { VALIDATION } from "./copy";
import { addYears, classifySeat, seatsOverlap } from "./derive";
import type { CommissionInput, CommitteeInput, EndCommissionInput, SeatInput } from "./validate";

/**
 * THE ONLY WRITER of the committee tables in `src/` (`committee_details` and, from
 * Increment 2, the two commission record tables). docs/work-log/2026-11-19-
 * presbytery-committees.md, Phase 3 "API Contract" and R1 to R6; DECISION-352,
 * 353, 354, 357, 359. `boundaries.test.ts` pins the list, and that NOTHING here
 * inserts, updates or deletes `groups` or `group_memberships`: a committee is a
 * managed group and a seat is a membership row, and both are written ONLY through
 * `@/lib/groups`' exported `*InTx` primitives (this module's key has already been
 * checked, so the primitives, which check none, are safe to call).
 *
 * EVERY WRITE is one `withOrgContext()` transaction (the actor must be an active
 * member of the presbytery) that repeats the whole check, cheapest and least
 * informative first:
 *
 *   1. `groups.manage`, by `presby_has_permission` through `holdsPermissions`
 *      (live; RLS is tenancy only)                                  -> forbidden
 *   2. the organization is a presbytery                              -> forbidden
 *   3. the committee resolves to THIS organization, type `committee`,
 *      `managed` (a choir, a derived group, another presbytery's and a
 *      nonexistent id are one answer)                                -> not_found
 *   4. a seat belongs to that committee                              -> seat_not_found
 *   5. the committee is not dissolved                                -> committee_dissolved
 *   6. the staleness check (the seat's role is the one the form held) -> stale
 *
 * then writes, then ONE audit row with `insertAuditRow(tx, ...)` in the SAME
 * transaction, so a failed audit insert undoes the change. Never `recordAudit()`
 * (it opens its own connection and swallows its failure). A change that changes
 * nothing writes nothing and audits nothing.
 *
 * AUDIT METADATA is ids, closed enumerations, booleans, counts, dates and field
 * NAMES only (`CHANGED_FIELDS`): never a committee name, purpose, meets-when text
 * or a person's name, because `audit_events` is platform-readable.
 *
 * CONCURRENCY. Two transaction-scoped advisory locks, taken BEFORE any row lock
 * (the oversight and worship pattern): `committee_names:{org}` (create, rename)
 * serializes the case-insensitive name check, which has no database index
 * (`paper`, R5.4: the predicate needs the group type, which lives in another
 * table); `committee_seats:{org}:{committee}` (add, change role, end, dissolve,
 * list, and an edit) serializes everything that reads a roster and then writes
 * it. When both are taken it is always names first, then seats, so no cycle exists.
 * A dissolve racing an add therefore leaves no open seat on a dissolved committee
 * (the add re-reads the committee after the lock). At the database that rule is the
 * store's alone, which is why it is the sole writer.
 *
 * DATES are half-open (T2): every end-like date is the first day the thing no
 * longer applies. A role change sets the old seat's `ends_on` and the new seat's
 * `starts_on` to the SAME effective date, in one transaction, with one audit row
 * (T3). "Today" is the organization's local calendar day (T15).
 *
 * COMMISSION RECORDS (Increment 2; DECISION-355, 358; the second half of this file).
 * A commission record is the presbytery's OWN note about an administrative
 * commission: it is not a group, carries no role and grants nothing, and NOTHING HERE
 * WRITES `administrative_commissions`, `org_delegations`, `role_grants` or a role id
 * (`boundaries.test.ts` pins every spelling). The same check order applies, with the
 * commission in place of the committee: key, organization type, then the record (this
 * organization's, not removed: one `not_found` for every other id), then the member,
 * then `commission_ended`, `stale`. The congregation it is about is optional and goes
 * through `resolveMemberCongregation()` (this presbytery's child, type congregation, no
 * lifecycle filter: a closing congregation is accepted, T7); every miss (another
 * presbytery's, a non-congregation, a nonexistent or a malformed id, and the 0045
 * trigger's refusal) is the one `congregation_not_found` answer.
 *
 * COMMISSION CONCURRENCY. One transaction advisory lock per record,
 * `commission_members:{org}:{commission}`, serializes the roster reads-then-writes
 * (add, end a member). It is NOT taken by ending or removing the record: an add racing
 * an end is the DATABASE's to settle, through the live-parent guard (0090 section 3c,
 * `FOR SHARE` against the end's row lock), and that guard's refusal is
 * `commission_ended`. Ending the record locks its row `FOR UPDATE` first and reads the
 * roster after, so a member added a moment earlier is ended with the rest. A member's
 * end takes the record `FOR SHARE`, so it cannot interleave with the end of the record.
 */

/** Thrown inside a transaction to roll it back with a typed refusal. */
class Refuse extends Error {
  constructor(
    readonly reason: Refusal,
    readonly detail?: RefusalDetail,
  ) {
    super(reason);
    this.name = "Refuse";
  }
}

/** Thrown inside a transaction to roll it back with a field-level validation message (a rule only the stored row can decide). */
class Invalid extends Error {
  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "Invalid";
  }
}

/** The CONSTRAINT names of the 0090 guards this writer can meet, and what they mean to a caller. */
const GUARD_CODES: Record<string, Refusal> = {
  [COMMITTEES_GUARD_CODES.detailsDissolvedFinal]: "committee_dissolved",
  [COMMITTEES_GUARD_CODES.detailsTarget]: "not_found",
  // Commission records (Increment 2). The live-parent guard refuses a member of a removed record on every
  // connection and of an ended one off the owner path: the loser of an add racing an end or a removal.
  [COMMITTEES_GUARD_CODES.commissionRecordClosed]: "commission_ended",
  [COMMITTEES_GUARD_CODES.commissionRemovalFinal]: "not_found",
  [COMMITTEES_GUARD_CODES.commissionEndedFinal]: "already_ended",
};

/** What a guard's refusal says it is about, when the kind's sentence depends on the object (committee or commission). */
const GUARD_DETAIL: Record<string, RefusalDetail> = {
  [COMMITTEES_GUARD_CODES.commissionEndedFinal]: { subject: "commission" },
  [COMMITTEES_GUARD_CODES.commissionRemovalFinal]: { subject: "commission" },
};

/**
 * The CHECK that stops an appointment falling after a recorded end. The refusal is the ruled
 * sentence on the `appointedOn` field (orchestrator ruling on B5), not a `save_failed`.
 */
const APPOINTED_AFTER_END_CHECK = "commission_records_ended_after_appointed";

/** The one-open-seat unique index of a commission's roster: the database's backstop for the interval check. */
const COMMISSION_OPEN_SEAT_INDEX = "commission_record_members_one_open_idx";

/** The about-org trigger's refusal (0045's deny helper, SQLSTATE 42501): the congregation is not (or no longer) affiliated. */
const NOT_AFFILIATED_MARKER = "was not affiliated with this council";

/** Maps whatever a transaction threw to the one answer the caller gets. */
function outcomeFor(err: unknown): Outcome<never> {
  if (err instanceof Refuse) return { kind: "refused", reason: err.reason, detail: err.detail };
  if (err instanceof Invalid) return { kind: "invalid", field: err.field, message: err.detail };
  if (err instanceof OrgAccessError) return { kind: "refused", reason: "forbidden" };

  const code = pgErrorField(err, "code");
  const constraint = pgErrorField(err, "constraint");
  if (code === "23514" && constraint === APPOINTED_AFTER_END_CHECK) {
    return { kind: "invalid", field: "appointedOn", message: VALIDATION.appointedAfterEnd };
  }
  if (code === "23514" && constraint && constraint in GUARD_CODES) {
    return { kind: "refused", reason: GUARD_CODES[constraint]!, detail: GUARD_DETAIL[constraint] };
  }
  if (code === "23505" && constraint === COMMISSION_OPEN_SEAT_INDEX) {
    return { kind: "refused", reason: "overlap", detail: { subject: "commission" } };
  }
  // A fixed line: the SQLSTATE and nothing else. No message, no id, no content.
  console.error(`[committees] save failed (sqlstate ${code ?? "none"})`);
  return { kind: "refused", reason: "save_failed" };
}

async function attempt<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { kind: "ok", data: await fn() };
  } catch (err) {
    return outcomeFor(err);
  }
}

function inTransaction<T>(ctx: CommitteesCtx, fn: (tx: OrgTx) => Promise<T>): Promise<Outcome<T>> {
  return attempt(() => withOrgContext(ctx.personId, ctx.organizationId, fn));
}

type CommitteeAuditAction =
  | typeof AUDIT_ACTIONS.COMMITTEE_CREATED
  | typeof AUDIT_ACTIONS.COMMITTEE_UPDATED
  | typeof AUDIT_ACTIONS.COMMITTEE_LABELLED
  | typeof AUDIT_ACTIONS.COMMITTEE_DISSOLVED
  | typeof AUDIT_ACTIONS.COMMITTEE_MEMBER_ADDED
  | typeof AUDIT_ACTIONS.COMMITTEE_MEMBER_ROLE_CHANGED
  | typeof AUDIT_ACTIONS.COMMITTEE_MEMBER_ENDED
  | typeof AUDIT_ACTIONS.COMMITTEE_MEMBER_LISTED
  | typeof AUDIT_ACTIONS.COMMITTEE_MEMBER_UNLISTED;

type CommissionAuditAction =
  | typeof AUDIT_ACTIONS.COMMISSION_RECORD_RECORDED
  | typeof AUDIT_ACTIONS.COMMISSION_RECORD_UPDATED
  | typeof AUDIT_ACTIONS.COMMISSION_RECORD_MEMBER_ADDED
  | typeof AUDIT_ACTIONS.COMMISSION_RECORD_MEMBER_ENDED
  | typeof AUDIT_ACTIONS.COMMISSION_RECORD_ENDED
  | typeof AUDIT_ACTIONS.COMMISSION_RECORD_REMOVED;

/** The one audit write: in the mutation's own transaction (a failure here undoes the change). */
async function audit(
  tx: OrgTx,
  ctx: CommitteesCtx,
  action: CommitteeAuditAction | CommissionAuditAction,
  resourceType: string,
  resourceId: string,
  metadata: Record<
    string,
    string | number | boolean | null | undefined | string[] | ChangedField[] | CommissionChangedField[]
  >,
): Promise<void> {
  await insertAuditRow(tx, {
    action,
    actor: ctx.actor,
    resourceType,
    resourceId,
    metadata: { organizationId: ctx.organizationId, ...metadata },
  });
}

/** Steps 1 and 2 of the check order: the key, then the organization type. */
async function gate(tx: OrgTx, ctx: CommitteesCtx): Promise<void> {
  const [held] = await holdsPermissions(tx, ctx, [GROUPS_MANAGE_KEY]);
  if (!held) throw new Refuse("forbidden");
  const result = await tx.execute(sql`select organization_type from organizations where id = ${ctx.organizationId}`);
  const type = (result as unknown as { rows?: Array<{ organization_type: string }> }).rows?.[0]?.organization_type;
  if (type !== "presbytery") throw new Refuse("forbidden");
}

const lockNames = (tx: OrgTx, ctx: CommitteesCtx) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`committee_names:${ctx.organizationId}`}, 0))`);

const lockSeats = (tx: OrgTx, ctx: CommitteesCtx, committeeId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`committee_seats:${ctx.organizationId}:${committeeId}`}, 0))`,
  );

/** The organization's local calendar day (T15). */
async function localToday(tx: OrgTx, ctx: CommitteesCtx): Promise<string> {
  return todayInOrgZone(new Date(), await orgTimeZoneInTx(tx, ctx.organizationId));
}

const nowStamp = () => sql`now()`;

/** Step 3: the committee, or `not_found` for any other id. One query, filtered by type, `managed` and the organization. */
async function loadCommittee(tx: OrgTx, ctx: CommitteesCtx, committeeId: string) {
  const [row] = await tx
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      meetsWhen: groups.meetsWhen,
      kind: committeeDetails.kind,
      dissolvedOn: committeeDetails.dissolvedOn,
    })
    .from(groups)
    .innerJoin(groupTypes, eq(groupTypes.id, groups.groupTypeId))
    .leftJoin(
      committeeDetails,
      and(eq(committeeDetails.groupId, groups.id), eq(committeeDetails.organizationId, groups.organizationId)),
    )
    .where(
      and(
        eq(groups.id, committeeId),
        eq(groups.organizationId, ctx.organizationId),
        eq(groups.membershipSource, "managed"),
        eq(groupTypes.key, "committee"),
      ),
    )
    .limit(1);
  if (!row) throw new Refuse("not_found");
  return row;
}

/** Step 4: a seat of THAT committee, or `seat_not_found`. */
async function loadSeat(tx: OrgTx, ctx: CommitteesCtx, committeeId: string, membershipId: string) {
  const [row] = await tx
    .select({
      id: groupMemberships.id,
      personId: groupMemberships.personId,
      groupRole: groupMemberships.groupRole,
      startsOn: groupMemberships.startsOn,
      endsOn: groupMemberships.endsOn,
      publicListed: groupMemberships.publicListed,
    })
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.id, membershipId),
        eq(groupMemberships.groupId, committeeId),
        eq(groupMemberships.organizationId, ctx.organizationId),
        eq(groupMemberships.source, "managed"),
      ),
    )
    .limit(1);
  if (!row) throw new Refuse("seat_not_found");
  return row;
}

/** What `groups.ts` returns when it declines, as a thrown typed answer. Only a miss is `ok`. */
function unwrap<T>(result: GroupsResult<T>, field: string): T {
  switch (result.kind) {
    case "ok":
      return result.data;
    case "invalid_input":
      throw new Invalid(field, result.message);
    case "overlap":
      throw new Refuse("overlap", { personName: result.personName, committeeName: result.groupName });
    case "invalid_target":
    case "forbidden":
      throw new Refuse("not_found");
  }
}

/** The case-insensitive, trimmed name check among NON-dissolved committees of this organization (Gap 8). */
async function assertNameFree(tx: OrgTx, ctx: CommitteesCtx, name: string, exceptGroupId: string | null): Promise<void> {
  const result = await tx.execute(sql`
    select g.name
      from groups g
      join group_types gt on gt.id = g.group_type_id
      left join committee_details cd on cd.group_id = g.id and cd.organization_id = g.organization_id
     where g.organization_id = ${ctx.organizationId}
       and g.membership_source = 'managed'
       and gt.key = 'committee'
       and cd.dissolved_on is null
       and lower(btrim(g.name)) = lower(btrim(${name}))
       ${exceptGroupId ? sql`and g.id <> ${exceptGroupId}` : sql``}
     order by g.name, g.id
     limit 1`);
  const existing = (result as unknown as { rows?: Array<{ name: string }> }).rows?.[0];
  if (existing) throw new Refuse("duplicate_name", { existingName: existing.name });
}

/** The roles the committee confers today, for the audit row's `grantsRole` (and `roleIds`). */
async function carriedRoleIds(tx: OrgTx, ctx: CommitteesCtx, committeeId: string, today: string): Promise<string[]> {
  const { carriedRoles } = await readGroupRoleGrantsInTx(tx, ctx.organizationId, committeeId, today);
  return carriedRoles.map((role) => role.id);
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

/**
 * A new committee: the managed group (through `groups.ts`) and its details row
 * (the label). The name is checked under the names lock among non-dissolved
 * committees: `duplicate_name` names the stored spelling of the existing one.
 */
export function createCommittee(ctx: CommitteesCtx, input: CommitteeInput): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    await lockNames(tx, ctx);
    await assertNameFree(tx, ctx, input.name, null);

    const [type] = await tx.select({ id: groupTypes.id }).from(groupTypes).where(eq(groupTypes.key, "committee")).limit(1);
    if (!type) throw new Error("the committee group type is missing");

    const made = unwrap(
      await insertManagedGroupInTx(tx, ctx.organizationId, {
        groupTypeId: type.id,
        name: input.name,
        description: input.purpose ?? undefined,
        meetsWhen: input.meetsWhen ?? undefined,
      }),
      "name",
    );
    await tx.insert(committeeDetails).values({
      organizationId: ctx.organizationId,
      groupId: made.groupId,
      kind: input.kind,
      createdBy: ctx.actor.userId,
      updatedBy: ctx.actor.userId,
    });

    await audit(tx, ctx, AUDIT_ACTIONS.COMMITTEE_CREATED, "committee", made.groupId, {
      committeeId: made.groupId,
      kind: input.kind,
    });
    return { id: made.groupId };
  });
}

/**
 * Edits a committee's name, purpose, meets-when and label. A dissolved committee is
 * `committee_dissolved`; nothing changed writes nothing and audits nothing
 * (`unchanged`). The label is upserted lazily: an unlabelled committee has no
 * details row until it is labelled, and every save requires a kind (T14). A save
 * can write two audit rows: `updated` for the group's own fields, `labelled` for the kind.
 */
export function updateCommittee(
  ctx: CommitteesCtx,
  committeeId: string,
  input: CommitteeInput,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    // Names first, then seats (never the other way): the rename check and the dissolve check both need a stable committee.
    await lockNames(tx, ctx);
    await lockSeats(tx, ctx, committeeId);

    const stored = await loadCommittee(tx, ctx, committeeId);
    if (stored.dissolvedOn !== null) throw new Refuse("committee_dissolved", { during: "edit" });

    const changed: ChangedField[] = [];
    if (stored.name !== input.name) changed.push("name");
    if ((stored.description ?? null) !== input.purpose) changed.push("purpose");
    if ((stored.meetsWhen ?? null) !== input.meetsWhen) changed.push("meetsWhen");
    const kindChanged = stored.kind !== input.kind;

    if (changed.length === 0 && !kindChanged) return { id: committeeId, unchanged: true as const };

    if (changed.includes("name")) await assertNameFree(tx, ctx, input.name, committeeId);

    if (changed.length > 0) {
      unwrap(
        await updateManagedGroupInTx(tx, ctx.organizationId, {
          groupId: committeeId,
          name: input.name,
          description: input.purpose ?? undefined,
          meetsWhen: input.meetsWhen ?? undefined,
        }),
        "name",
      );
    }

    if (kindChanged) {
      const written = await tx
        .insert(committeeDetails)
        .values({
          organizationId: ctx.organizationId,
          groupId: committeeId,
          kind: input.kind,
          createdBy: ctx.actor.userId,
          updatedBy: ctx.actor.userId,
        })
        .onConflictDoUpdate({
          target: committeeDetails.groupId,
          set: { kind: input.kind, updatedAt: nowStamp(), updatedBy: ctx.actor.userId },
          setWhere: isNull(committeeDetails.dissolvedOn),
        })
        .returning({ id: committeeDetails.id });
      if (written.length === 0) throw new Refuse("committee_dissolved", { during: "edit" });
    }

    if (changed.length > 0) {
      await audit(tx, ctx, AUDIT_ACTIONS.COMMITTEE_UPDATED, "committee", committeeId, { committeeId, changed });
    }
    if (kindChanged) {
      await audit(tx, ctx, AUDIT_ACTIONS.COMMITTEE_LABELLED, "committee", committeeId, {
        committeeId,
        kind: input.kind,
        previousKind: stored.kind,
      });
    }
    return { id: committeeId };
  });
}

// ---------------------------------------------------------------------------
// Dissolve
// ---------------------------------------------------------------------------

/**
 * Dissolves a committee on a date that is not in the future (T5), ending every
 * seat. ONE transaction under the seat lock: the date may not precede the start of
 * any seat that has already begun (`date_before_start`, naming that date); the
 * details row is set (and created first if the committee was never labelled); every
 * seat with no end or an end after the date is ended AT the date, and a seat that
 * has not started yet is ended zero-length at its own start (nothing is deleted
 * and nothing is left open); one audit row carries the count. One-way: the guard
 * freezes the row, and a mistaken dissolve is an operator data fix.
 */
export function dissolveCommittee(
  ctx: CommitteesCtx,
  committeeId: string,
  dissolvedOn: string,
): Promise<Outcome<Written & { seatsEnded: number }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    await lockSeats(tx, ctx, committeeId);

    const stored = await loadCommittee(tx, ctx, committeeId);
    if (stored.dissolvedOn !== null) throw new Refuse("already_dissolved");

    const today = await localToday(tx, ctx);
    if (dissolvedOn > today) throw new Invalid("dissolvedOn", VALIDATION.dissolveFuture);

    const seats = await tx
      .select({ id: groupMemberships.id, startsOn: groupMemberships.startsOn, endsOn: groupMemberships.endsOn })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.groupId, committeeId), eq(groupMemberships.organizationId, ctx.organizationId)));

    const begun = seats.filter((s) => s.startsOn <= today).map((s) => s.startsOn);
    const latestBegun = begun.length > 0 ? begun.reduce((a, b) => (a > b ? a : b)) : null;
    if (latestBegun !== null && dissolvedOn < latestBegun) {
      throw new Refuse("date_before_start", { date: latestBegun });
    }

    await tx
      .insert(committeeDetails)
      .values({
        organizationId: ctx.organizationId,
        groupId: committeeId,
        kind: null,
        createdBy: ctx.actor.userId,
        updatedBy: ctx.actor.userId,
      })
      .onConflictDoNothing({ target: committeeDetails.groupId });
    const dissolved = await tx
      .update(committeeDetails)
      .set({
        dissolvedOn,
        dissolvedBy: ctx.actor.userId,
        dissolvedAt: nowStamp(),
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(
        and(
          eq(committeeDetails.groupId, committeeId),
          eq(committeeDetails.organizationId, ctx.organizationId),
          isNull(committeeDetails.dissolvedOn),
        ),
      )
      .returning({ id: committeeDetails.id });
    if (dissolved.length === 0) throw new Refuse("already_dissolved");

    let seatsEnded = 0;
    for (const seat of seats) {
      if (seat.endsOn !== null && seat.endsOn <= dissolvedOn) continue;
      // A seat that has not started ends zero-length at its own start; a begun seat ends at the dissolve date.
      const newEnd = seat.startsOn > dissolvedOn ? seat.startsOn : dissolvedOn;
      if (seat.endsOn === newEnd) continue;
      unwrap(await endManagedGroupMemberInTx(tx, ctx.organizationId, { groupMembershipId: seat.id, endsOn: newEnd }), "dissolvedOn");
      seatsEnded += 1;
    }

    const carriesRole = (await carriedRoleIds(tx, ctx, committeeId, today)).length > 0;
    await audit(tx, ctx, AUDIT_ACTIONS.COMMITTEE_DISSOLVED, "committee", committeeId, {
      committeeId,
      dissolvedOn,
      seatsEnded,
      carriesRole,
    });
    return { id: committeeId, seatsEnded };
  });
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** The person's other seats on this committee, as intervals, for the overlap check. */
async function seatsOfPerson(tx: OrgTx, ctx: CommitteesCtx, committeeId: string, personId: string) {
  return tx
    .select({ id: groupMemberships.id, startsOn: groupMemberships.startsOn, endsOn: groupMemberships.endsOn })
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.groupId, committeeId),
        eq(groupMemberships.organizationId, ctx.organizationId),
        eq(groupMemberships.personId, personId),
      ),
    );
}

/**
 * The display name of a person who holds a CURRENT membership at this presbytery, or
 * `not_a_member` (one answer for a person who left, never joined or does not exist).
 * Shared by a committee seat and a commission member: the same people list.
 */
async function currentMemberName(tx: OrgTx, ctx: CommitteesCtx, personId: string): Promise<string> {
  const [person] = await tx
    .select({ firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
    .from(memberships)
    .innerJoin(people, eq(people.id, memberships.personId))
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.organizationId, ctx.organizationId),
        isNull(memberships.endedOn),
      ),
    )
    .limit(1);
  if (!person) throw new Refuse("not_a_member");
  return `${person.preferredName ?? person.firstName} ${person.lastName}`;
}

/**
 * Adds a seat. The person must hold a CURRENT membership at this presbytery
 * (`not_a_member`, one answer for a person who left, never joined or does not
 * exist); the role is one of the six; the interval may not overlap another seat of
 * the same person on this committee (`overlap`, which names the person and the
 * committee; zero-length rows are ignored); a dissolved committee is refused. Co-chairs
 * are allowed. The write is `addManagedGroupSeatInTx` with the six roles and
 * `overlap: "caller"` (this function has just checked the intervals under its lock).
 */
export function addCommitteeSeat(
  ctx: CommitteesCtx,
  committeeId: string,
  input: SeatInput,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    await lockSeats(tx, ctx, committeeId);

    const committee = await loadCommittee(tx, ctx, committeeId);
    if (committee.dissolvedOn !== null) throw new Refuse("committee_dissolved");

    const personName = await currentMemberName(tx, ctx, input.personId);

    const mine = await seatsOfPerson(tx, ctx, committeeId, input.personId);
    const proposed = { startsOn: input.startsOn, endsOn: input.endsOn };
    if (mine.some((seat) => seatsOverlap(proposed, seat))) {
      throw new Refuse("overlap", { personName, committeeName: committee.name });
    }

    const added = unwrap(
      await addManagedGroupSeatInTx(
        tx,
        ctx.organizationId,
        { groupId: committeeId, personId: input.personId, groupRole: input.role, startsOn: input.startsOn, endsOn: input.endsOn },
        { allowedRoles: COMMITTEE_ROLES, overlap: "caller" },
      ),
      "startsOn",
    );

    const roleIds = await carriedRoleIds(tx, ctx, committeeId, await localToday(tx, ctx));
    const grantsRole = roleIds.length > 0;
    await audit(tx, ctx, AUDIT_ACTIONS.COMMITTEE_MEMBER_ADDED, "committee_member", added.groupMembershipId, {
      committeeId,
      membershipId: added.groupMembershipId,
      personId: input.personId,
      role: input.role,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      grantsRole,
      roleIds: grantsRole ? roleIds : undefined,
    });
    return { id: added.groupMembershipId };
  });
}

/**
 * Changes a seat's role as ONE act (T3): the old seat's `ends_on` and the new
 * seat's `starts_on` are both the effective date, so no instant is held twice or
 * not at all; the new seat inherits a planned end; the seat's public listing is
 * carried to the new row (so a listed person stays listed, with the new title);
 * one audit row. The form's `expectedRole` must still be the seat's role (`stale`),
 * the seat must not have ended (`already_ended`), and the new role must differ
 * (`same_role`). The effective date may not precede the seat's start and must
 * precede a planned end.
 */
export function changeCommitteeSeatRole(
  ctx: CommitteesCtx,
  committeeId: string,
  membershipId: string,
  input: { expectedRole: string; newRole: CommitteeRole; effectiveOn: string },
): Promise<Outcome<Written & { newMembershipId: string }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    await lockSeats(tx, ctx, committeeId);

    const committee = await loadCommittee(tx, ctx, committeeId);
    const seat = await loadSeat(tx, ctx, committeeId, membershipId);

    if (seat.groupRole !== input.expectedRole) throw new Refuse("stale");
    const today = await localToday(tx, ctx);
    // Every seat of a dissolved committee is ended, so a dissolved committee answers here.
    if (classifySeat(seat, today) === "past") throw new Refuse("already_ended");
    if (seat.groupRole === input.newRole) throw new Refuse("same_role");

    const effectiveOn = input.effectiveOn;
    if (effectiveOn > addYears(today, LIMITS.startAheadYears)) throw new Invalid("effectiveOn", VALIDATION.effectiveTooFar);
    if (effectiveOn < seat.startsOn) throw new Invalid("effectiveOn", VALIDATION.effectiveBeforeStart(seat.startsOn));
    if (seat.endsOn !== null && effectiveOn >= seat.endsOn) {
      throw new Invalid("effectiveOn", VALIDATION.effectiveNotBeforeEnd(seat.endsOn));
    }

    // The new seat [effectiveOn, planned end) must not meet any OTHER seat of the same person.
    const others = (await seatsOfPerson(tx, ctx, committeeId, seat.personId)).filter((s) => s.id !== seat.id);
    if (others.some((s) => seatsOverlap({ startsOn: effectiveOn, endsOn: seat.endsOn }, s))) {
      const [person] = await tx
        .select({ firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
        .from(people)
        .where(eq(people.id, seat.personId))
        .limit(1);
      throw new Refuse("overlap", {
        personName: person ? `${person.preferredName ?? person.firstName} ${person.lastName}` : undefined,
        committeeName: committee.name,
      });
    }

    unwrap(await endManagedGroupMemberInTx(tx, ctx.organizationId, { groupMembershipId: seat.id, endsOn: effectiveOn }), "effectiveOn");
    const added = unwrap(
      await addManagedGroupSeatInTx(
        tx,
        ctx.organizationId,
        { groupId: committeeId, personId: seat.personId, groupRole: input.newRole, startsOn: effectiveOn, endsOn: seat.endsOn },
        { allowedRoles: COMMITTEE_ROLES, overlap: "caller" },
      ),
      "effectiveOn",
    );
    if (seat.publicListed) {
      unwrap(
        await setManagedMembershipPublicListedInTx(tx, ctx.organizationId, ctx.actor.userId, {
          groupMembershipId: added.groupMembershipId,
          publicListed: true,
        }),
        "effectiveOn",
      );
    }

    const grantsRole = (await carriedRoleIds(tx, ctx, committeeId, today)).length > 0;
    await audit(tx, ctx, AUDIT_ACTIONS.COMMITTEE_MEMBER_ROLE_CHANGED, "committee_member", seat.id, {
      committeeId,
      membershipId: seat.id,
      newMembershipId: added.groupMembershipId,
      personId: seat.personId,
      fromRole: seat.groupRole,
      toRole: input.newRole,
      effectiveOn,
      grantsRole,
      publicListed: seat.publicListed,
    });
    return { id: seat.id, newMembershipId: added.groupMembershipId };
  });
}

/**
 * Ends a term (or moves a planned end, or cancels a term that has not started).
 * A seat that has not started is ended AT its own start whatever the date field
 * says ("Cancel planned term": a zero-length row, history keeps it); otherwise a
 * date is required, may not precede the seat's start, and may not be more than ten
 * years ahead. An already-ended seat is `already_ended`; the same end date again
 * changes nothing and audits nothing.
 */
export function endCommitteeSeat(
  ctx: CommitteesCtx,
  committeeId: string,
  membershipId: string,
  input: { endsOn: string | null },
): Promise<Outcome<Written & { cancelled: boolean }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    await lockSeats(tx, ctx, committeeId);

    await loadCommittee(tx, ctx, committeeId);
    const seat = await loadSeat(tx, ctx, committeeId, membershipId);

    const today = await localToday(tx, ctx);
    const state = classifySeat(seat, today);
    if (state === "past") throw new Refuse("already_ended");

    const cancelled = state === "planned";
    let endsOn: string;
    if (cancelled) {
      endsOn = seat.startsOn;
    } else {
      if (input.endsOn === null) throw new Invalid("endsOn", VALIDATION.dateInvalid);
      if (input.endsOn < seat.startsOn) throw new Invalid("endsOn", VALIDATION.endBeforeStart);
      if (input.endsOn > addYears(today, LIMITS.endAheadYears)) throw new Invalid("endsOn", VALIDATION.endTooFar);
      endsOn = input.endsOn;
    }
    if (seat.endsOn === endsOn) return { id: seat.id, cancelled, unchanged: true as const };

    unwrap(await endManagedGroupMemberInTx(tx, ctx.organizationId, { groupMembershipId: seat.id, endsOn }), "endsOn");
    await audit(tx, ctx, AUDIT_ACTIONS.COMMITTEE_MEMBER_ENDED, "committee_member", seat.id, {
      committeeId,
      membershipId: seat.id,
      personId: seat.personId,
      role: seat.groupRole,
      endsOn,
      cancelled,
    });
    return { id: seat.id, cancelled };
  });
}

/**
 * Lists or unlists a seat on the public committee directory (T9). Only a seat
 * serving now can be (`seat_not_found` otherwise). Audited IN this transaction as
 * `committee.member_listed|unlisted`; the groups admin's own events are written
 * after commit by `recordAudit()`, which a disclosure fact must not depend on. The
 * same value again changes nothing and audits nothing. Public display order is not
 * offered at a presbytery.
 */
export function setCommitteeSeatPublicListed(
  ctx: CommitteesCtx,
  committeeId: string,
  membershipId: string,
  publicListed: boolean,
): Promise<Outcome<Written & { publicListed: boolean }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    // The same lock a role change takes: it reads the listing and carries it, so the two must not interleave.
    await lockSeats(tx, ctx, committeeId);

    await loadCommittee(tx, ctx, committeeId);
    const seat = await loadSeat(tx, ctx, committeeId, membershipId);
    const today = await localToday(tx, ctx);
    if (classifySeat(seat, today) !== "serving") throw new Refuse("seat_not_found");
    if (seat.publicListed === publicListed) return { id: seat.id, publicListed, unchanged: true as const };

    unwrap(
      await setManagedMembershipPublicListedInTx(tx, ctx.organizationId, ctx.actor.userId, {
        groupMembershipId: seat.id,
        publicListed,
      }),
      "publicListed",
    );
    await audit(
      tx,
      ctx,
      publicListed ? AUDIT_ACTIONS.COMMITTEE_MEMBER_LISTED : AUDIT_ACTIONS.COMMITTEE_MEMBER_UNLISTED,
      "committee_member",
      seat.id,
      { committeeId, membershipId: seat.id, personId: seat.personId },
    );
    return { id: seat.id, publicListed };
  });
}

// ===========================================================================
// COMMISSION RECORDS (Increment 2). See the header: the presbytery's own record,
// not a group, not a grant. Every function below calls `gate` first (the
// boundaries test pins it) and writes ONE audit row in its own transaction.
// ===========================================================================

/** A transaction-scoped advisory lock on one commission's roster (add, end a member). Never taken by end or remove: the database settles those. */
const lockMembers = (tx: OrgTx, ctx: CommitteesCtx, commissionId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`commission_members:${ctx.organizationId}:${commissionId}`}, 0))`,
  );

/**
 * The commission record, or `not_found` for any other id: this organization's, not
 * removed, one query. `lock` takes a row lock in the same statement: `update` for the
 * writes that change the record, `share` for an act that must not interleave with the
 * record's end (the same lock the live-parent guard takes).
 */
async function loadCommission(tx: OrgTx, ctx: CommitteesCtx, commissionId: string, lock: "update" | "share" | null = null) {
  const query = tx
    .select({
      id: commissionRecords.id,
      title: commissionRecords.title,
      charge: commissionRecords.charge,
      aboutOrgId: commissionRecords.aboutOrgId,
      appointedOn: commissionRecords.appointedOn,
      minuteReference: commissionRecords.minuteReference,
      endedOn: commissionRecords.endedOn,
      rowVersion: commissionRecords.rowVersion,
    })
    .from(commissionRecords)
    .where(
      and(
        eq(commissionRecords.id, commissionId),
        eq(commissionRecords.organizationId, ctx.organizationId),
        isNull(commissionRecords.removedAt),
      ),
    )
    .limit(1);
  const [row] = lock === "update" ? await query.for("update") : lock === "share" ? await query.for("share") : await query;
  if (!row) throw new Refuse("not_found", { subject: "commission" });
  return row;
}

/** A member of THAT commission, or `seat_not_found` (the member twin of `not_found`). */
async function loadMember(tx: OrgTx, ctx: CommitteesCtx, commissionId: string, memberId: string) {
  const [row] = await tx
    .select({
      id: commissionRecordMembers.id,
      personId: commissionRecordMembers.personId,
      role: commissionRecordMembers.role,
      startsOn: commissionRecordMembers.startsOn,
      endsOn: commissionRecordMembers.endsOn,
    })
    .from(commissionRecordMembers)
    .where(
      and(
        eq(commissionRecordMembers.id, memberId),
        eq(commissionRecordMembers.commissionRecordId, commissionId),
        eq(commissionRecordMembers.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new Refuse("seat_not_found");
  return row;
}

/** The members of one commission, as intervals. */
const membersOfCommission = (tx: OrgTx, ctx: CommitteesCtx, commissionId: string) =>
  tx
    .select({
      id: commissionRecordMembers.id,
      personId: commissionRecordMembers.personId,
      startsOn: commissionRecordMembers.startsOn,
      endsOn: commissionRecordMembers.endsOn,
    })
    .from(commissionRecordMembers)
    .where(
      and(
        eq(commissionRecordMembers.commissionRecordId, commissionId),
        eq(commissionRecordMembers.organizationId, ctx.organizationId),
      ),
    );

/**
 * T7: the congregation a record is about is one of THIS presbytery's member
 * congregations (`resolveMemberCongregation`: parent, type congregation, no lifecycle
 * filter). Every miss is the one `congregation_not_found` answer carrying the stored
 * presbytery name: another presbytery's, a non-congregation, a nonexistent and a malformed
 * id are indistinguishable (DECISION-040). Returns the resolved (lower-case) id and the
 * name, which the trigger's later refusal (the affiliation history disagreeing with
 * `parent_id`) also needs, because the transaction is aborted by then.
 */
async function requireCongregation(
  tx: OrgTx,
  ctx: CommitteesCtx,
  aboutOrgId: string,
): Promise<{ congregationId: string; presbyteryName: string }> {
  const result = await tx.execute(sql`select name from organizations where id = ${ctx.organizationId}`);
  const presbyteryName = (result as unknown as { rows?: Array<{ name: string }> }).rows?.[0]?.name ?? "this presbytery";
  const found = isUuid(aboutOrgId) ? await resolveMemberCongregation(tx, ctx.organizationId, aboutOrgId) : null;
  if (!found) throw new Refuse("congregation_not_found", { presbyteryName });
  return { congregationId: found.id, presbyteryName };
}

/** A write that names a congregation: the 0045 trigger's refusal is the same one answer as a miss. */
async function writingAbout<T>(presbyteryName: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (pgErrorField(err, "code") === "42501" && pgErrorMessages(err).includes(NOT_AFFILIATED_MARKER)) {
      throw new Refuse("congregation_not_found", { presbyteryName });
    }
    throw err;
  }
}

/**
 * Records a commission (C15). The congregation is optional; named, it is resolved
 * under this presbytery (`congregation_not_found` for every miss). One row, one audit
 * row `commission_record.recorded` carrying only the ids.
 */
export function recordCommission(ctx: CommitteesCtx, input: CommissionInput): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    // The appointment may not be after today in the ORGANIZATION'S day (the form's parse used the server's UTC day).
    if (input.appointedOn > (await localToday(tx, ctx))) throw new Invalid("appointedOn", VALIDATION.appointedFuture);

    const about = input.aboutOrgId === null ? null : await requireCongregation(tx, ctx, input.aboutOrgId);
    const [row] = await writingAbout(about?.presbyteryName ?? "", () =>
      tx
        .insert(commissionRecords)
        .values({
          organizationId: ctx.organizationId,
          aboutOrgId: about?.congregationId ?? null,
          title: input.title,
          charge: input.charge,
          appointedOn: input.appointedOn,
          minuteReference: input.minuteReference,
          createdBy: ctx.actor.userId,
          updatedBy: ctx.actor.userId,
        })
        .returning({ id: commissionRecords.id }),
    );
    const id = row!.id;

    await audit(tx, ctx, AUDIT_ACTIONS.COMMISSION_RECORD_RECORDED, "commission_record", id, {
      commissionId: id,
      aboutOrgId: about?.congregationId ?? null,
    });
    return { id };
  });
}

/**
 * Edits a record's title, charge, congregation, appointed date and minute. The
 * record is locked and its `row_version` must be the one the form held (`stale`: the
 * charge is sensitive, so last-write-wins is the worst case). Nothing changed writes
 * nothing and audits nothing. An ENDED record may still be corrected (the database
 * freezes only its end); a congregation that has since left the presbytery may stay
 * named (a congregation is resolved only when the edit MOVES it). One audit row with the
 * field NAMES.
 */
export function updateCommission(
  ctx: CommitteesCtx,
  commissionId: string,
  input: CommissionInput,
  expectedVersion: number,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    const stored = await loadCommission(tx, ctx, commissionId, "update");
    if (stored.rowVersion !== expectedVersion) throw new Refuse("stale", { subject: "commission" });

    const wantedAbout = input.aboutOrgId === null ? null : input.aboutOrgId.toLowerCase();
    const changed: CommissionChangedField[] = [];
    if (stored.title !== input.title) changed.push("title");
    if ((stored.charge ?? null) !== input.charge) changed.push("charge");
    if ((stored.aboutOrgId ?? null) !== wantedAbout) changed.push("congregation");
    if (stored.appointedOn !== input.appointedOn) changed.push("appointedOn");
    if ((stored.minuteReference ?? null) !== input.minuteReference) changed.push("minuteReference");
    if (changed.length === 0) return { id: commissionId, unchanged: true as const };

    // Moving the appointment: not after today in the organization's day. An appointment after a recorded end is
    // refused by the database's CHECK, mapped to the ruled sentence in `outcomeFor`.
    if (changed.includes("appointedOn") && input.appointedOn > (await localToday(tx, ctx))) {
      throw new Invalid("appointedOn", VALIDATION.appointedFuture);
    }

    // Resolved only when the edit moves the congregation: an unrelated edit of a record whose congregation has left passes.
    const moved = changed.includes("congregation") && input.aboutOrgId !== null;
    const about = moved ? await requireCongregation(tx, ctx, input.aboutOrgId!) : null;
    const aboutOrgId = input.aboutOrgId === null ? null : (about?.congregationId ?? stored.aboutOrgId);

    await writingAbout(about?.presbyteryName ?? "", () =>
      tx
        .update(commissionRecords)
        .set({
          title: input.title,
          charge: input.charge,
          aboutOrgId,
          appointedOn: input.appointedOn,
          minuteReference: input.minuteReference,
          rowVersion: sql`${commissionRecords.rowVersion} + 1`,
          updatedAt: nowStamp(),
          updatedBy: ctx.actor.userId,
        })
        .where(and(eq(commissionRecords.id, commissionId), eq(commissionRecords.organizationId, ctx.organizationId))),
    );

    await audit(tx, ctx, AUDIT_ACTIONS.COMMISSION_RECORD_UPDATED, "commission_record", commissionId, {
      commissionId,
      changed,
    });
    return { id: commissionId };
  });
}

/**
 * Adds a member to a commission (C15; the person, role and date rules of a committee
 * seat: a CURRENT membership, one of the six titles, interval overlap). The roster is
 * read and written under the record's members lock. An ENDED record refuses
 * (`commission_ended`); an add that raced the end is refused by the database's live-parent
 * guard with the same answer. Never a `group_memberships` row: no group, no role.
 */
export function addCommissionMember(
  ctx: CommitteesCtx,
  commissionId: string,
  input: SeatInput,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    await lockMembers(tx, ctx, commissionId);

    const commission = await loadCommission(tx, ctx, commissionId);
    if (commission.endedOn !== null) throw new Refuse("commission_ended");

    const personName = await currentMemberName(tx, ctx, input.personId);

    const mine = (await membersOfCommission(tx, ctx, commissionId)).filter((m) => m.personId === input.personId);
    const proposed = { startsOn: input.startsOn, endsOn: input.endsOn };
    if (mine.some((member) => seatsOverlap(proposed, member))) {
      throw new Refuse("overlap", { personName, subject: "commission" });
    }

    const [added] = await tx
      .insert(commissionRecordMembers)
      .values({
        organizationId: ctx.organizationId,
        commissionRecordId: commissionId,
        personId: input.personId,
        role: input.role,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        createdBy: ctx.actor.userId,
        updatedBy: ctx.actor.userId,
      })
      .returning({ id: commissionRecordMembers.id });
    const memberId = added!.id;

    await audit(tx, ctx, AUDIT_ACTIONS.COMMISSION_RECORD_MEMBER_ADDED, "commission_record", commissionId, {
      commissionId,
      memberId,
      personId: input.personId,
      role: input.role,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    });
    return { id: memberId };
  });
}

/**
 * Ends a member's term (or moves a planned end, or cancels a term that has not
 * started): the committee seat's rules, on a commission's roster. Takes the record
 * `FOR SHARE`, so it cannot interleave with the record's own end (which then finds the
 * member already ended, or ends it with the rest).
 */
export function endCommissionMember(
  ctx: CommitteesCtx,
  commissionId: string,
  memberId: string,
  input: { endsOn: string | null },
): Promise<Outcome<Written & { cancelled: boolean }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);
    await lockMembers(tx, ctx, commissionId);

    await loadCommission(tx, ctx, commissionId, "share");
    const member = await loadMember(tx, ctx, commissionId, memberId);

    const today = await localToday(tx, ctx);
    const state = classifySeat(member, today);
    if (state === "past") throw new Refuse("already_ended");

    const cancelled = state === "planned";
    let endsOn: string;
    if (cancelled) {
      endsOn = member.startsOn;
    } else {
      if (input.endsOn === null) throw new Invalid("endsOn", VALIDATION.dateInvalid);
      if (input.endsOn < member.startsOn) throw new Invalid("endsOn", VALIDATION.endBeforeStart);
      if (input.endsOn > addYears(today, LIMITS.endAheadYears)) throw new Invalid("endsOn", VALIDATION.endTooFar);
      endsOn = input.endsOn;
    }
    if (member.endsOn === endsOn) return { id: member.id, cancelled, unchanged: true as const };

    await tx
      .update(commissionRecordMembers)
      .set({ endsOn, updatedAt: nowStamp(), updatedBy: ctx.actor.userId })
      .where(and(eq(commissionRecordMembers.id, member.id), eq(commissionRecordMembers.organizationId, ctx.organizationId)));

    await audit(tx, ctx, AUDIT_ACTIONS.COMMISSION_RECORD_MEMBER_ENDED, "commission_record", commissionId, {
      commissionId,
      memberId: member.id,
      personId: member.personId,
      role: member.role,
      endsOn,
      cancelled,
    });
    return { id: member.id, cancelled };
  });
}

/**
 * Ends the commission on a date that is not in the future (C15), ending every member:
 * the record is locked `FOR UPDATE` and its roster read AFTER, so a member added a
 * moment earlier is ended with the rest. The date may not precede the appointment or
 * the start of any member who has begun (`date_before_start`, naming that date). Every
 * member with no end or a later one ends at the date; one who has not started ends
 * zero-length at their own start (nothing deleted, nothing left open). One-way (the
 * guard freezes the end), `already_ended` after. One audit row with the count.
 */
export function endCommission(
  ctx: CommitteesCtx,
  commissionId: string,
  input: EndCommissionInput,
): Promise<Outcome<Written & { membersEnded: number }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);

    const stored = await loadCommission(tx, ctx, commissionId, "update");
    if (stored.endedOn !== null) throw new Refuse("already_ended", { subject: "commission" });

    const today = await localToday(tx, ctx);
    if (input.endedOn > today) throw new Invalid("endedOn", VALIDATION.endedFuture);
    if (input.endedOn < stored.appointedOn) throw new Invalid("endedOn", VALIDATION.endedBeforeAppointed(stored.appointedOn));

    const members = await membersOfCommission(tx, ctx, commissionId);
    const begun = members.filter((m) => m.startsOn <= today).map((m) => m.startsOn);
    const latestBegun = begun.length > 0 ? begun.reduce((a, b) => (a > b ? a : b)) : null;
    if (latestBegun !== null && input.endedOn < latestBegun) {
      throw new Refuse("date_before_start", { date: latestBegun, subject: "commission" });
    }

    await tx
      .update(commissionRecords)
      .set({
        endedOn: input.endedOn,
        endedMinuteReference: input.endedMinuteReference,
        endedBy: ctx.actor.userId,
        endedAt: nowStamp(),
        rowVersion: sql`${commissionRecords.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(and(eq(commissionRecords.id, commissionId), eq(commissionRecords.organizationId, ctx.organizationId)));

    let membersEnded = 0;
    for (const member of members) {
      if (member.endsOn !== null && member.endsOn <= input.endedOn) continue;
      // A member who has not started ends zero-length at their own start; a begun one ends at the date.
      const newEnd = member.startsOn > input.endedOn ? member.startsOn : input.endedOn;
      if (member.endsOn === newEnd) continue;
      await tx
        .update(commissionRecordMembers)
        .set({ endsOn: newEnd, updatedAt: nowStamp(), updatedBy: ctx.actor.userId })
        .where(and(eq(commissionRecordMembers.id, member.id), eq(commissionRecordMembers.organizationId, ctx.organizationId)));
      membersEnded += 1;
    }

    await audit(tx, ctx, AUDIT_ACTIONS.COMMISSION_RECORD_ENDED, "commission_record", commissionId, {
      commissionId,
      endedOn: input.endedOn,
      membersEnded,
    });
    return { id: commissionId, membersEnded };
  });
}

/**
 * Removes a record entered by mistake (the one way out, T8: all deletes are soft): the
 * removal pair is set, one way. A record already removed, or never this
 * organization's, is `not_found`. Its members are untouched (they have no removal of
 * their own), and nothing can be added to it again (the live-parent guard).
 */
export function removeCommissionRecord(ctx: CommitteesCtx, commissionId: string): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx);

    await loadCommission(tx, ctx, commissionId, "update");
    await tx
      .update(commissionRecords)
      .set({
        removedAt: nowStamp(),
        removedBy: ctx.actor.userId,
        rowVersion: sql`${commissionRecords.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(and(eq(commissionRecords.id, commissionId), eq(commissionRecords.organizationId, ctx.organizationId)));

    await audit(tx, ctx, AUDIT_ACTIONS.COMMISSION_RECORD_REMOVED, "commission_record", commissionId, { commissionId });
    return { id: commissionId };
  });
}
