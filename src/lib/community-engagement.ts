import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow, type AuditActor } from "@/lib/audit-tx";
import { isUuid } from "@/lib/is-uuid";
import { isRealYmd, todayUtcYmd } from "@/lib/ymd";
import { COMMUNITY_ARCHIVE_ENDED_REASON } from "@/lib/roll-action-kinds";
import {
  FIRST_VISIT_FLOOR,
  MAX_HOW_HEARD,
  isEditableEngagement,
  type EditableEngagement,
  type Engagement,
  type MembershipStanding,
} from "@/lib/membership-standing";

/**
 * The four Community writes of Increment 3a (docs/work-log/2026-10-22-founding-
 * admin-directory-inc3.md, Phase 3 section 5; DECISION-234, DECISION-235):
 * change a person's engagement, archive a person, restore an archived person,
 * and correct a visit's details.
 *
 * THIS IS THE ONLY NON-TEST MODULE THAT UPDATES `memberships.engagement_status`,
 * the archive's `ended_on` / `ended_reason`, `first_visit_date` or `how_heard`
 * (the INSERT sites are `people.ts`, the 0059/0064 definers, the 2b founding
 * paths and fixtures). `community-engagement.source.test.ts` pins the writer
 * list, so a second UPDATE site is a failing test. `community.ts` stays
 * read-only.
 *
 * WHY THESE WRITES ARE ACCESS-BEARING (G2). Engagement decides who is "listed in
 * the member directory" (standing `listed`), and that decides who holds the
 * Active Membership derived row (the `member` role) and who auto-connects at
 * sign-in (R55). Every write is therefore audited, in the SAME transaction as
 * the change, with `insertAuditRow(tx, ...)`: a throw from the audit insert
 * rolls the change back (EC-16). An `unchanged` result writes nothing.
 *
 * EVERY EXPORT: (1) runs inside `withOrgContext(viewerPersonId, organizationId,
 * ...)`, so the tenant comes from the verified session context and never from
 * input; (2) checks `people.manage` first, in that transaction; (3) looks the
 * person up by `(organization, person)` with `for update` on the membership, so
 * a person of another organization, a merged or deceased person and a missing id
 * are the same `not_found`, and two administrators acting at once are
 * serialized instead of overwriting each other blind; (4) reads the stored
 * standing from the SQL classifier `presby_membership_standing()` (R51), never
 * a TypeScript re-statement of it.
 *
 * THE DATABASE IS THE BACKSTOP FOR EVERY RULE HERE. `memberships_guard_engagement`
 * (0066) refuses a change on an ended membership, a transition into or out of
 * `staff`, and `visitor` on a rolled membership, for every role including the
 * owner; `memberships_guard_end` (0014) refuses ending a membership under an open
 * officer term or role grant. The pre-checks below produce the plain outcomes;
 * if a guard fires anyway its refusal is mapped to the same outcome.
 *
 * Dates are cast `::text` in SQL so the Neon driver never hands back a `Date`
 * (`check:sql-date`). Nothing is ever deleted: archive is an end date with a
 * fixed marker, restore clears exactly that marker.
 */

const PEOPLE_MANAGE = "people.manage";

/** The pastoral-axis writer's acting user: the audit actor, from the session. */
export type EngagementActor = NonNullable<AuditActor>;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type ChangeEngagementRefusal =
  | "forbidden"
  | "not_found"
  | "ended"
  | "staff_record"
  | "needs_no_roll"
  | "changed_meanwhile";

export type ChangeEngagementResult =
  | {
      kind: "ok";
      from: Engagement;
      to: EditableEngagement;
      standingFrom: MembershipStanding;
      standingTo: MembershipStanding;
      signInConnected: boolean;
    }
  | { kind: "unchanged" }
  | { kind: ChangeEngagementRefusal };

export type ArchiveRefusal =
  | "forbidden"
  | "not_found"
  | "already_ended"
  | "not_eligible"
  | "self_target"
  | "holds_position"
  | "pending_action";

export type ArchivePersonResult =
  | { kind: "ok"; engagement: Engagement; signInConnected: boolean }
  | { kind: ArchiveRefusal };

export type RestoreRefusal = "forbidden" | "not_found" | "not_archived" | "person_unavailable";

export type RestorePersonResult =
  | { kind: "ok"; engagement: Engagement; signInConnected: boolean }
  | { kind: RestoreRefusal };

export type VisitDetailsRefusal =
  | "forbidden"
  | "not_found"
  | "ended"
  | "bad_date"
  | "bad_text";

export type UpdateVisitDetailsResult = { kind: "ok" } | { kind: "unchanged" } | { kind: VisitDetailsRefusal };

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

async function canManagePeople(
  tx: OrgTx,
  viewerPersonId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${viewerPersonId}::uuid,
             ${organizationId}::uuid,
             ${PEOPLE_MANAGE}
           ) as allowed
  `);
  return rowsOf<{ allowed?: boolean }>(result)[0]?.allowed === true;
}

/** The SQLSTATE of a driver error, walking Drizzle's `cause` chain. */
function pgCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The server message of a driver error, walking the `cause` chain to the one carrying a SQLSTATE. */
function pgMessage(err: unknown): string {
  let current: unknown = err;
  let message = "";
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof (current as { code?: unknown }).code === "string" && current instanceof Error) {
      message = current.message;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return message;
}

/** A refusal raised by one of 0066's or 0014's membership triggers (`check_violation`, `memberships:` prefix). */
function membershipTriggerMessage(err: unknown): string | null {
  if (pgCode(err) !== "23514") return null;
  const message = pgMessage(err);
  return message.startsWith("memberships:") ? message : null;
}

interface MembershipRow {
  membership_id: string;
  engagement_status: Engagement;
  current_roll: string | null;
  ended_on: string | null;
  ended_reason: string | null;
  standing: MembershipStanding;
  sign_in_connected: boolean;
  first_visit_date: string | null;
  how_heard: string | null;
}

/**
 * The person's membership at THIS organization, locked, or null. A merged or
 * deceased person is "not found" here exactly as a missing id is: they cannot
 * be edited, and the answer must not tell the two apart. `of m` locks the
 * membership only; the person row is read, not locked.
 */
async function lockMembership(
  tx: OrgTx,
  organizationId: string,
  personId: string,
): Promise<MembershipRow | null> {
  const result = await tx.execute(sql`
    select m.id as membership_id,
           m.engagement_status as engagement_status,
           m.current_roll as current_roll,
           m.ended_on::text as ended_on,
           m.ended_reason as ended_reason,
           presby_membership_standing(m.current_roll, m.engagement_status) as standing,
           (p.user_id is not null) as sign_in_connected,
           m.first_visit_date::text as first_visit_date,
           m.how_heard as how_heard
      from memberships m
      join people p on p.id = m.person_id
     where m.organization_id = ${organizationId}::uuid
       and m.person_id = ${personId}::uuid
       and p.merged_into_id is null
       and p.date_of_death is null
       for update of m
  `);
  return rowsOf<MembershipRow>(result)[0] ?? null;
}

// ---------------------------------------------------------------------------
// changeEngagement
// ---------------------------------------------------------------------------

export interface ChangeEngagementInput {
  personId: string;
  to: EditableEngagement;
  /**
   * Optional optimistic-concurrency guard: the engagement the caller was
   * looking at. When given and different from what is stored the answer is
   * `changed_meanwhile` and nothing is written. Omitted, the write is
   * serialized by the row lock and audited with the true `from`.
   */
  expectedFrom?: Engagement;
}

/**
 * Sets one person's engagement. Rules, in order: an ended membership is `ended`;
 * a staff record is `staff_record` (staff is set only when the anchor is
 * created); a stale `expectedFrom` is `changed_meanwhile`; the same value is
 * `unchanged` (no write, no audit); Visitor for a person with a roll is
 * `needs_no_roll`. Then one conditional update; zero rows is `changed_meanwhile`
 * (unreachable under the row lock, kept as the honest answer should the row move).
 * Self-targeting is allowed and audited.
 */
export async function changeEngagement(
  viewerPersonId: string,
  organizationId: string,
  input: ChangeEngagementInput,
  actor: EngagementActor,
): Promise<ChangeEngagementResult> {
  if (!isEditableEngagement(input.to)) {
    // The action parses `to` against the closed list; reaching here is a bug in a caller.
    throw new Error("changeEngagement: `to` must be visitor, regular, inactive or moved_away");
  }
  const to: EditableEngagement = input.to;

  try {
    return await withOrgContext(viewerPersonId, organizationId, async (tx) => {
      if (!(await canManagePeople(tx, viewerPersonId, organizationId))) {
        return { kind: "forbidden" } as const;
      }
      if (!isUuid(input.personId)) return { kind: "not_found" } as const;

      const row = await lockMembership(tx, organizationId, input.personId);
      if (!row) return { kind: "not_found" } as const;
      if (row.ended_on !== null) return { kind: "ended" } as const;

      const from = row.engagement_status;
      if (from === "staff") return { kind: "staff_record" } as const;
      if (input.expectedFrom !== undefined && input.expectedFrom !== from) {
        return { kind: "changed_meanwhile" } as const;
      }
      if (to === from) return { kind: "unchanged" } as const;
      if (to === "visitor" && row.current_roll !== null) return { kind: "needs_no_roll" } as const;

      const updated = await tx.execute(sql`
        update memberships
           set engagement_status = ${to},
               updated_at = now()
         where id = ${row.membership_id}::uuid
           and organization_id = ${organizationId}::uuid
           and ended_on is null
           and engagement_status = ${from}
        returning presby_membership_standing(current_roll, engagement_status) as standing_to
      `);
      const written = rowsOf<{ standing_to: MembershipStanding }>(updated)[0];
      if (!written) return { kind: "changed_meanwhile" } as const;

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.TENANT_PERSON_ENGAGEMENT_CHANGED,
        actor,
        resourceType: "person",
        resourceId: input.personId,
        metadata: {
          organizationId,
          personId: input.personId,
          from,
          to,
          standingFrom: row.standing,
          standingTo: written.standing_to,
          signInConnected: row.sign_in_connected,
        },
      });

      return {
        kind: "ok",
        from,
        to,
        standingFrom: row.standing,
        standingTo: written.standing_to,
        signInConnected: row.sign_in_connected,
      } as const;
    });
  } catch (err) {
    // The engagement guard is the backstop for every rule above; map its
    // refusal to the same plain outcome rather than a database error.
    const message = membershipTriggerMessage(err);
    if (message !== null) {
      if (message.includes("has ended")) return { kind: "ended" };
      if (message.includes("staff")) return { kind: "staff_record" };
      if (message.includes("visitor")) return { kind: "needs_no_roll" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// archivePerson
// ---------------------------------------------------------------------------

/** The standings an archive may end: a visitor, an inactive person, and the fail-closed arm. */
const ARCHIVABLE_STANDINGS: readonly MembershipStanding[] = ["visitor", "inactive", "unclassified"];

/**
 * Archives a person: ends the membership with the fixed marker
 * `COMMUNITY_ARCHIVE_ENDED_REASON` (nothing is deleted; the record is kept and
 * Restore reverses it). Refusals before the write, in this order: `not_found`;
 * `self_target` (the viewer's own record); `already_ended`; `not_eligible`
 * unless the standing is visitor, inactive or unclassified (a member on the roll
 * leaves through a roll action, a participant is removed as a participant, a
 * staff anchor is not archived here); `pending_action` (a pending roll action
 * could never be approved on an ended membership); `holds_position` (an open
 * officer term, an open role grant of the person's own, or an open staff
 * position; the same predicate the participant-removal pre-check uses, without
 * a start-date test, so a future-dated seat also stops it).
 */
export async function archivePerson(
  viewerPersonId: string,
  organizationId: string,
  input: { personId: string },
  actor: EngagementActor,
): Promise<ArchivePersonResult> {
  try {
    return await withOrgContext(viewerPersonId, organizationId, async (tx) => {
      if (!(await canManagePeople(tx, viewerPersonId, organizationId))) {
        return { kind: "forbidden" } as const;
      }
      if (!isUuid(input.personId)) return { kind: "not_found" } as const;

      const row = await lockMembership(tx, organizationId, input.personId);
      if (!row) return { kind: "not_found" } as const;
      if (input.personId === viewerPersonId) return { kind: "self_target" } as const;
      if (row.ended_on !== null) return { kind: "already_ended" } as const;
      if (!ARCHIVABLE_STANDINGS.includes(row.standing)) return { kind: "not_eligible" } as const;

      const blockers = await tx.execute(sql`
        select exists (
                 select 1 from roll_actions ra
                  where ra.person_id = ${input.personId}::uuid
                    and ra.organization_id = ${organizationId}::uuid
                    and ra.approval_status = 'pending'
               ) as pending_action,
               (
                 exists (
                   select 1 from officer_terms ot
                    where ot.person_id = ${input.personId}::uuid
                      and ot.organization_id = ${organizationId}::uuid
                      and (ot.ends_on is null or ot.ends_on > current_date)
                 )
                 or exists (
                   select 1 from role_grants rg
                    where rg.person_id = ${input.personId}::uuid
                      and rg.organization_id = ${organizationId}::uuid
                      and (rg.ends_on is null or rg.ends_on > current_date)
                 )
                 or exists (
                   select 1 from staff_positions sp
                    where sp.person_id = ${input.personId}::uuid
                      and sp.organization_id = ${organizationId}::uuid
                      and (sp.ends_on is null or sp.ends_on > current_date)
                 )
               ) as holds_position
      `);
      const flags = rowsOf<{ pending_action: boolean; holds_position: boolean }>(blockers)[0];
      if (flags?.pending_action === true) return { kind: "pending_action" } as const;
      if (flags?.holds_position === true) return { kind: "holds_position" } as const;

      const updated = await tx.execute(sql`
        update memberships
           set ended_on = current_date,
               ended_reason = ${COMMUNITY_ARCHIVE_ENDED_REASON},
               updated_at = now()
         where id = ${row.membership_id}::uuid
           and organization_id = ${organizationId}::uuid
           and ended_on is null
           and presby_membership_standing(current_roll, engagement_status)
               in ('visitor', 'inactive', 'unclassified')
        returning engagement_status
      `);
      if (rowsOf(updated).length === 0) return { kind: "not_eligible" } as const;

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.TENANT_PERSON_ARCHIVED,
        actor,
        resourceType: "person",
        resourceId: input.personId,
        metadata: {
          organizationId,
          personId: input.personId,
          engagement: row.engagement_status,
          signInConnected: row.sign_in_connected,
        },
      });

      return {
        kind: "ok",
        engagement: row.engagement_status,
        signInConnected: row.sign_in_connected,
      } as const;
    });
  } catch (err) {
    // `memberships_guard_end` is the backstop for an open officer term or role
    // grant; the pre-check above normally answers first.
    if (membershipTriggerMessage(err) !== null) return { kind: "holds_position" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// restorePerson
// ---------------------------------------------------------------------------

/**
 * Restores an archived person: clears `ended_on` and `ended_reason` ONLY where
 * the reason is the archive marker (a participant removal, or any other ended
 * membership, is not restorable here), and only for a person who is not merged
 * or deceased. The engagement the row kept decides which list they return to.
 * Does not look across organizations: a person who has since gained a live
 * membership elsewhere is the existing `person_elsewhere` state, handled by the
 * sign-in standing core, not by this write.
 */
export async function restorePerson(
  viewerPersonId: string,
  organizationId: string,
  input: { personId: string },
  actor: EngagementActor,
): Promise<RestorePersonResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await canManagePeople(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" } as const;
    }
    if (!isUuid(input.personId)) return { kind: "not_found" } as const;

    const updated = await tx.execute(sql`
      update memberships m
         set ended_on = null,
             ended_reason = null,
             updated_at = now()
        from people p
       where p.id = m.person_id
         and m.organization_id = ${organizationId}::uuid
         and m.person_id = ${input.personId}::uuid
         and m.ended_on is not null
         and m.ended_reason = ${COMMUNITY_ARCHIVE_ENDED_REASON}
         and p.merged_into_id is null
         and p.date_of_death is null
      returning m.engagement_status as engagement,
                (p.user_id is not null) as sign_in_connected
    `);
    const restored = rowsOf<{ engagement: Engagement; sign_in_connected: boolean }>(updated)[0];

    if (!restored) {
      // Zero rows: tell the three reasons apart with one read (no write happened).
      const probe = await tx.execute(sql`
        select m.ended_on::text as ended_on,
               m.ended_reason as ended_reason,
               (p.merged_into_id is not null or p.date_of_death is not null) as unavailable
          from memberships m
          join people p on p.id = m.person_id
         where m.organization_id = ${organizationId}::uuid
           and m.person_id = ${input.personId}::uuid
      `);
      const state = rowsOf<{ ended_on: string | null; ended_reason: string | null; unavailable: boolean }>(
        probe,
      )[0];
      if (!state) return { kind: "not_found" } as const;
      const archived =
        state.ended_on !== null && state.ended_reason === COMMUNITY_ARCHIVE_ENDED_REASON;
      if (archived && state.unavailable) return { kind: "person_unavailable" } as const;
      // A merged or deceased person who was never archived is not told apart from a missing one.
      if (state.unavailable) return { kind: "not_found" } as const;
      return { kind: "not_archived" } as const;
    }

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.TENANT_PERSON_RESTORED,
      actor,
      resourceType: "person",
      resourceId: input.personId,
      metadata: {
        organizationId,
        personId: input.personId,
        engagement: restored.engagement,
        signInConnected: restored.sign_in_connected === true,
      },
    });

    return {
      kind: "ok",
      engagement: restored.engagement,
      signInConnected: restored.sign_in_connected === true,
    } as const;
  });
}

// ---------------------------------------------------------------------------
// updateVisitDetails
// ---------------------------------------------------------------------------

/**
 * Corrects a visit's first date and how the person heard about the
 * congregation (the two columns the wizard fills at creation). The date must be
 * a real calendar date from 1900-01-01 (D7: a floor on edit only) up to today
 * (UTC, the database's `current_date`); `howHeard` is trimmed and at most
 * `MAX_HOW_HEARD` characters; null or blank clears a field. An ended membership
 * is `ended`. Writes only those two columns, and audits only booleans: how_heard
 * is free text and is never copied into the audit row.
 */
export async function updateVisitDetails(
  viewerPersonId: string,
  organizationId: string,
  input: { personId: string; firstVisitDate: string | null; howHeard: string | null },
  actor: EngagementActor,
): Promise<UpdateVisitDetailsResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await canManagePeople(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" } as const;
    }

    const rawDate = typeof input.firstVisitDate === "string" ? input.firstVisitDate.trim() : "";
    const firstVisitDate = rawDate === "" ? null : rawDate;
    if (
      firstVisitDate !== null &&
      (!isRealYmd(firstVisitDate) || firstVisitDate < FIRST_VISIT_FLOOR || firstVisitDate > todayUtcYmd())
    ) {
      return { kind: "bad_date" } as const;
    }
    const rawHeard = typeof input.howHeard === "string" ? input.howHeard.trim() : "";
    const howHeard = rawHeard === "" ? null : rawHeard;
    if (howHeard !== null && howHeard.length > MAX_HOW_HEARD) return { kind: "bad_text" } as const;

    if (!isUuid(input.personId)) return { kind: "not_found" } as const;
    const row = await lockMembership(tx, organizationId, input.personId);
    if (!row) return { kind: "not_found" } as const;
    if (row.ended_on !== null) return { kind: "ended" } as const;

    const firstVisitDateChanged = firstVisitDate !== row.first_visit_date;
    const howHeardChanged = howHeard !== row.how_heard;
    if (!firstVisitDateChanged && !howHeardChanged) return { kind: "unchanged" } as const;

    await tx.execute(sql`
      update memberships
         set first_visit_date = ${firstVisitDate}::date,
             how_heard = ${howHeard}::text,
             updated_at = now()
       where id = ${row.membership_id}::uuid
         and organization_id = ${organizationId}::uuid
         and ended_on is null
    `);

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.TENANT_PERSON_VISIT_DETAILS_UPDATED,
      actor,
      resourceType: "person",
      resourceId: input.personId,
      metadata: {
        organizationId,
        personId: input.personId,
        firstVisitDateChanged,
        howHeardChanged,
      },
    });

    return { kind: "ok" } as const;
  });
}
