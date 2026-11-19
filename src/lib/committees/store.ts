import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { OrgAccessError, withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { COMMITTEES_GUARD_CODES, committeeDetails } from "@/lib/db/domain/committees";
import { groupMemberships, groups, groupTypes } from "@/lib/db/domain/groups";
import { memberships, people } from "@/lib/db/domain/people";
import { pgErrorField } from "@/lib/db/errors";
import {
  addManagedGroupSeatInTx,
  endManagedGroupMemberInTx,
  insertManagedGroupInTx,
  setManagedMembershipPublicListedInTx,
  updateManagedGroupInTx,
  type GroupsResult,
} from "@/lib/groups";
import { COMMITTEE_ROLES, type CommitteeRole } from "@/lib/group-roles";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { readGroupRoleGrantsInTx } from "@/lib/role-grants";
import { todayInOrgZone } from "@/lib/shared/org-time";
import {
  GROUPS_MANAGE_KEY,
  LIMITS,
  type ChangedField,
  type CommitteesCtx,
  type Outcome,
  type Refusal,
  type RefusalDetail,
  type Written,
} from "./contract";
import { VALIDATION } from "./copy";
import { addYears, classifySeat, seatsOverlap } from "./derive";
import type { CommitteeInput, SeatInput } from "./validate";

/**
 * THE ONLY WRITER of the committee tables in `src/` (`committee_details`; the two
 * commission tables are the second increment's). docs/work-log/2026-11-19-
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
};

/** Maps whatever a transaction threw to the one answer the caller gets. */
function outcomeFor(err: unknown): Outcome<never> {
  if (err instanceof Refuse) return { kind: "refused", reason: err.reason, detail: err.detail };
  if (err instanceof Invalid) return { kind: "invalid", field: err.field, message: err.detail };
  if (err instanceof OrgAccessError) return { kind: "refused", reason: "forbidden" };

  const code = pgErrorField(err, "code");
  const constraint = pgErrorField(err, "constraint");
  if (code === "23514" && constraint && constraint in GUARD_CODES) {
    return { kind: "refused", reason: GUARD_CODES[constraint]! };
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

/** The one audit write: in the mutation's own transaction (a failure here undoes the change). */
async function audit(
  tx: OrgTx,
  ctx: CommitteesCtx,
  action: CommitteeAuditAction,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, string | number | boolean | null | undefined | string[] | ChangedField[]>,
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

    const [person] = await tx
      .select({ firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(
        and(
          eq(memberships.personId, input.personId),
          eq(memberships.organizationId, ctx.organizationId),
          isNull(memberships.endedOn),
        ),
      )
      .limit(1);
    if (!person) throw new Refuse("not_a_member");

    const mine = await seatsOfPerson(tx, ctx, committeeId, input.personId);
    const proposed = { startsOn: input.startsOn, endsOn: input.endsOn };
    if (mine.some((seat) => seatsOverlap(proposed, seat))) {
      throw new Refuse("overlap", {
        personName: `${person.preferredName ?? person.firstName} ${person.lastName}`,
        committeeName: committee.name,
      });
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
