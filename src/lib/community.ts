import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import {
  PARTICIPANT_REMOVAL_ENDED_REASON,
  isOnRecordKind,
  type RollActionKind,
} from "@/lib/roll-action-kinds";
import { deriveConnection, type Connection } from "@/lib/community-labels";
import { isUuid } from "@/lib/is-uuid";

/**
 * The admin Community readers that the member-facing Directory must never
 * serve: VISITORS, STAFF and FORMER PARTICIPANTS, plus the per-row badges and
 * the one-person status the edit page renders (docs/work-log/2026-10-22-
 * founding-admin-directory.md, Phase 3 "Library"; DECISION-200).
 *
 * WHY A SEPARATE FILE. The member Directory's eligibility predicate admits only
 * a live, roll-bearing or `'regular'` membership, so a visitor (engagement
 * `visitor`, no roll) and a staff anchor (`staff`, DECISION-129) are absent
 * from it by construction. Keeping the readers that DO list them in a file
 * `directory.ts` never imports is what keeps it that way; `community.source.
 * test.ts` pins both that `directory.ts` never imports this module and that the
 * predicate text never contains those two engagement values.
 *
 * EVERY EXPORT IS GATED ON `people.manage` (checked in the same transaction as
 * the read, exactly as `people.ts` does), NOT `directory.view`: these are admin
 * surfaces for the people an administrator can already open the edit page for.
 * That is also what lets the Community page degrade honestly for a
 * `people.manage` holder who lacks `directory.view` (DECISION-197): the
 * Directory-backed views come back `forbidden`, these keep working. They do NOT
 * apply `directory_hidden` for the same reason (a `people.manage` holder can
 * already edit any person), and that is a decision, not an oversight.
 *
 * Read-only: no write, no audit. Dates are cast `::text` in SQL so the Neon
 * driver never hands back a `Date` (`check:sql-date`).
 */

const PEOPLE_MANAGE = "people.manage";

async function canManagePeople(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${PEOPLE_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

export interface CommunityRow {
  personId: string;
  displayName: string;
  /** Primary email (admin surface: not subject to `hide_email`). */
  email: string | null;
  /** 'YYYY-MM-DD'. */
  firstVisitDate: string | null;
  /** Titles of the person's OPEN staff positions, oldest first. Empty on a
   * Staff-view row means a staff anchor with no position yet. */
  positions: string[];
  /** 'YYYY-MM-DD'; set only on the Former participants list. */
  endedOn: string | null;
}

export type CommunityListResult =
  | {
      kind: "ok";
      rows: CommunityRow[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }
  | { kind: "forbidden" };

export interface CommunityListOptions {
  search?: string;
  page: number;
  pageSize: number;
}

interface CommunityRowSql {
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  first_visit_date: string | null;
  positions: string[] | null;
  ended_on: string | null;
}

/** An open staff position: no end date, or an end date still ahead. The same
 * predicate `presby_record_participant_action`'s removal pre-check uses. */
const OPEN_POSITION_SQL = sql`(sp.ends_on is null or sp.ends_on > current_date)`;

/** Escapes `\`, `%` and `_` so a search term is matched literally. */
function likePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

type ListKind = "visitors" | "staff" | "former";

function listPredicate(kind: ListKind) {
  switch (kind) {
    case "visitors":
      // A visitor is a live membership with engagement 'visitor' and NO roll.
      // An enrolled visitor has a roll, so they leave this list on their own.
      return sql`m.engagement_status = 'visitor'
        and m.current_roll is null
        and m.ended_on is null
        and p.merged_into_id is null
        and p.date_of_death is null`;
    case "staff":
      // Staff is an open position OR the staff anchor (DECISION-200, and the
      // founding-administrator and treasurer shape from DECISION-128/183): a
      // live membership with engagement 'staff' lists even with no position
      // yet, so a person who joins by invitation is not invisible. The anchor
      // row carries no positions; the page says "No position yet". The
      // Directory still excludes the anchor (DECISION-129).
      return sql`m.ended_on is null
        and p.merged_into_id is null
        and p.date_of_death is null
        and (
          m.engagement_status = 'staff'
          or exists (
            select 1 from staff_positions sp
             where sp.person_id = m.person_id
               and sp.organization_id = m.organization_id
               and ${OPEN_POSITION_SQL}
          )
        )`;
    case "former":
      // The removal's own fixed marker (a constant, not user input).
      return sql`m.ended_on is not null
        and m.ended_reason = ${PARTICIPANT_REMOVAL_ENDED_REASON}
        and p.merged_into_id is null`;
  }
}

async function listCommunity(
  kind: ListKind,
  viewerPersonId: string,
  organizationId: string,
  opts: CommunityListOptions,
): Promise<CommunityListResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await canManagePeople(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const term = opts.search?.trim();
    const searchSql = term
      ? sql`and (
          p.first_name ilike ${likePattern(term)} escape '\\'
          or p.last_name ilike ${likePattern(term)} escape '\\'
          or p.preferred_name ilike ${likePattern(term)} escape '\\'
          or cm_email.value ilike ${likePattern(term)} escape '\\'
        )`
      : sql``;

    const fromWhere = sql`
        from memberships m
        join people p on p.id = m.person_id
        left join lateral (
          select value from contact_methods
           where person_id = p.id and kind = 'email'
           order by is_primary desc, id
           limit 1
        ) cm_email on true
       where m.organization_id = ${organizationId}::uuid
         and ${listPredicate(kind)}
         ${searchSql}
    `;

    const countResult = await tx.execute(sql`select count(*)::int as total ${fromWhere}`);
    const total =
      (countResult as unknown as { rows?: Array<{ total: number }> }).rows?.[0]
        ?.total ?? 0;

    const pageSize = Math.max(1, Math.floor(opts.pageSize));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), totalPages);

    const result = await tx.execute(sql`
      select m.person_id as person_id,
             p.first_name as first_name,
             p.last_name as last_name,
             p.preferred_name as preferred_name,
             cm_email.value as email,
             m.first_visit_date::text as first_visit_date,
             m.ended_on::text as ended_on,
             coalesce((
               select array_agg(sp.position order by sp.starts_on, sp.id)
                 from staff_positions sp
                where sp.person_id = m.person_id
                  and sp.organization_id = m.organization_id
                  and ${OPEN_POSITION_SQL}
             ), '{}') as positions
        ${fromWhere}
       order by p.last_name, p.first_name, m.person_id
       limit ${pageSize} offset ${(page - 1) * pageSize}
    `);
    const rows = (result as unknown as { rows?: CommunityRowSql[] }).rows ?? [];

    return {
      kind: "ok",
      rows: rows.map((row) => ({
        personId: row.person_id,
        displayName: `${row.preferred_name ?? row.first_name} ${row.last_name}`,
        email: row.email,
        firstVisitDate: row.first_visit_date,
        positions: row.positions ?? [],
        endedOn: row.ended_on,
      })),
      pagination: { page, pageSize, total, totalPages },
    };
  });
}

/** Visitors: engagement `visitor`, no roll, live. `people.manage`-gated. */
export function listVisitors(
  viewerPersonId: string,
  organizationId: string,
  opts: CommunityListOptions,
): Promise<CommunityListResult> {
  return listCommunity("visitors", viewerPersonId, organizationId, opts);
}

/** Staff: people with an open `staff_positions` row, whatever their
 * engagement, plus live engagement-`staff` anchors with no position yet
 * (`positions` is `[]` for those). `people.manage`-gated. */
export function listStaff(
  viewerPersonId: string,
  organizationId: string,
  opts: CommunityListOptions,
): Promise<CommunityListResult> {
  return listCommunity("staff", viewerPersonId, organizationId, opts);
}

/** Former participants: memberships ended by a participant removal (the fixed
 * `ended_reason` marker), the only way back to an Undo after the person leaves
 * every live list. `people.manage`-gated. */
export function listFormerParticipants(
  viewerPersonId: string,
  organizationId: string,
  opts: CommunityListOptions,
): Promise<CommunityListResult> {
  return listCommunity("former", viewerPersonId, organizationId, opts);
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type CommunityBadge =
  | "active"
  | "baptized"
  | "affiliate"
  | "participant"
  | "visitor"
  | "waiting";

/**
 * One query for the rendered ids. The roll wins (`active`, `baptized`,
 * `affiliate`, `participant`); with no roll, `waiting` means a pending roll
 * action exists ("Waiting for the Session"), then `visitor`. A person with no
 * badge (listed, staff anchor, ended) is omitted. `{}` without `people.manage`
 * (never an error: a badge is chrome, not a gate), and non-UUID ids are
 * dropped rather than reaching the cast.
 */
export async function getCommunityBadges(
  viewerPersonId: string,
  organizationId: string,
  personIds: string[],
): Promise<Record<string, CommunityBadge>> {
  const ids = [...new Set(personIds.filter((id) => isUuid(id)))];
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await canManagePeople(tx, viewerPersonId, organizationId))) {
      return {};
    }
    if (ids.length === 0) {
      return {};
    }

    const result = await tx.execute(sql`
      select m.person_id as person_id,
             m.current_roll as current_roll,
             m.engagement_status as engagement_status,
             exists (
               select 1 from roll_actions ra
                where ra.person_id = m.person_id
                  and ra.organization_id = m.organization_id
                  and ra.approval_status = 'pending'
             ) as has_pending
        from memberships m
       where m.organization_id = ${organizationId}::uuid
         and m.ended_on is null
         and m.person_id in (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
    `);
    const rows =
      (
        result as unknown as {
          rows?: Array<{
            person_id: string;
            current_roll: string | null;
            engagement_status: string;
            has_pending: boolean;
          }>;
        }
      ).rows ?? [];

    const badges: Record<string, CommunityBadge> = {};
    for (const row of rows) {
      const badge = badgeFor(row.current_roll, row.engagement_status, row.has_pending);
      if (badge) badges[row.person_id] = badge;
    }
    return badges;
  });
}

function badgeFor(
  currentRoll: string | null,
  engagementStatus: string,
  hasPending: boolean,
): CommunityBadge | null {
  if (currentRoll === "active" || currentRoll === "baptized" || currentRoll === "affiliate") {
    return currentRoll;
  }
  if (currentRoll === "other_participant") return "participant";
  if (currentRoll === null && hasPending) return "waiting";
  if (engagementStatus === "visitor") return "visitor";
  return null;
}

// ---------------------------------------------------------------------------
// One person's status (the edit page's Connection card)
// ---------------------------------------------------------------------------

export interface CommunityStatus {
  personId: string;
  connection: Connection;
  currentRoll: string | null;
  /** 'YYYY-MM-DD'. */
  currentRollSince: string | null;
  /** 'YYYY-MM-DD'. */
  endedOn: string | null;
  hasOpenStaffPosition: boolean;
  /** Pending roll actions for this person at this organization. */
  pendingCount: number;
  /** The person's latest EFFECTIVE (approved, not voided) action; the only
   * entry an Undo may target, and only when `onRecordKind`. */
  latestAction: {
    id: string;
    kind: RollActionKind;
    /** 'YYYY-MM-DD'. */
    effectiveDate: string;
    onRecordKind: boolean;
  } | null;
}

export type CommunityStatusResult =
  | { kind: "ok"; status: CommunityStatus }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export async function getCommunityStatus(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<CommunityStatusResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await canManagePeople(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }
    if (!isUuid(personId)) {
      return { kind: "not_found" };
    }

    const result = await tx.execute(sql`
      select m.engagement_status as engagement_status,
             m.current_roll as current_roll,
             m.current_roll_since::text as current_roll_since,
             m.ended_on::text as ended_on,
             m.ended_reason as ended_reason,
             exists (
               select 1 from staff_positions sp
                where sp.person_id = m.person_id
                  and sp.organization_id = m.organization_id
                  and ${OPEN_POSITION_SQL}
             ) as has_open_staff_position,
             (select count(*)::int from roll_actions ra
               where ra.person_id = m.person_id
                 and ra.organization_id = m.organization_id
                 and ra.approval_status = 'pending') as pending_count,
             la.id as latest_id,
             la.kind as latest_kind,
             la.effective_date::text as latest_effective_date
        from memberships m
        left join lateral (
          select ra.id, ra.kind, ra.effective_date
            from presby_effective_roll_actions ra
           where ra.person_id = m.person_id
             and ra.organization_id = m.organization_id
           order by ra.effective_date desc, ra.recorded_at desc
           limit 1
        ) la on true
       where m.organization_id = ${organizationId}::uuid
         and m.person_id = ${personId}::uuid
    `);
    const row = (
      result as unknown as {
        rows?: Array<{
          engagement_status: string;
          current_roll: string | null;
          current_roll_since: string | null;
          ended_on: string | null;
          ended_reason: string | null;
          has_open_staff_position: boolean;
          pending_count: number;
          latest_id: string | null;
          latest_kind: RollActionKind | null;
          latest_effective_date: string | null;
        }>;
      }
    ).rows?.[0];
    if (!row) {
      return { kind: "not_found" };
    }

    return {
      kind: "ok",
      status: {
        personId,
        connection: deriveConnection({
          endedOn: row.ended_on,
          endedReason: row.ended_reason,
          currentRoll: row.current_roll,
          engagementStatus: row.engagement_status,
        }),
        currentRoll: row.current_roll,
        currentRollSince: row.current_roll_since,
        endedOn: row.ended_on,
        hasOpenStaffPosition: row.has_open_staff_position === true,
        pendingCount: row.pending_count,
        latestAction:
          row.latest_id && row.latest_kind && row.latest_effective_date
            ? {
                id: row.latest_id,
                kind: row.latest_kind,
                effectiveDate: row.latest_effective_date,
                onRecordKind: isOnRecordKind(row.latest_kind),
              }
            : null,
      },
    };
  });
}
