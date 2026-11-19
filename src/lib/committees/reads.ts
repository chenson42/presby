import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { type GroupRoleValue } from "@/lib/group-roles";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { readGroupRoleGrantsInTx } from "@/lib/role-grants";
import { isUuid } from "@/lib/is-uuid";
import { todayInOrgZone } from "@/lib/shared/org-time";
import {
  GROUPS_MANAGE_KEY,
  type CommitteeKind,
  type CommitteesFormRead,
  type CommitteesRead,
  type CommitteesViewer,
} from "./contract";
import { compareNames, personStatus } from "./derive";

/**
 * The committees readers (docs/work-log/2026-11-19-presbytery-committees.md,
 * Phase 3 "API Contract: Reads"; R6.3; DECISION-352, 359). ONE READER PER SECTION
 * AND FORM-DEFAULT, each its own `withOrgContext()` transaction that checks, FIRST,
 * the key (`presby_has_permission(..., 'groups.manage')`, live, through
 * `holdsPermissions`: RLS is tenancy, not authorization) and then that the
 * organization is a presbytery. A viewer without either is `forbidden` inside the
 * transaction, never merely hidden, and a failing section cannot take the page down.
 *
 * Every reader returns `{ kind: "ok", data } | { kind: "forbidden" } | { kind:
 * "not_found" }` and never throws for a missing key. An `OrgAccessError`
 * (membership ended mid-request) propagates to the page's `[slug]/error.tsx`; any
 * other throw is the page's section load error.
 *
 * WRONG KIND OF GROUP (R6.3): a `small_group`, `choir`, `team`, a derived group,
 * another organization's id and a nonexistent id are the same `not_found`, from one
 * query that filters type `committee`, `managed` and the current organization. A
 * malformed id is `not_found` before any SQL (after the key check, so a viewer
 * without the key learns nothing from the shape of an id either).
 *
 * "TODAY" is the ORGANIZATION'S local calendar day (T15), read in the same
 * transaction (`orgTimeZoneInTx`); `now` is injectable for tests. Dates are the
 * database's `YYYY-MM-DD` text, never a `Date`. Reads are not audited.
 *
 * This file names the committees tables for READS only (`boundaries.test.ts`).
 */

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface CommitteeListRow {
  id: string;
  name: string;
  meetsWhen: string | null;
  /** Null is "Not yet labelled" (no details row, or a row with no kind). */
  kind: CommitteeKind | null;
  /** `YYYY-MM-DD` when dissolved, else null. */
  dissolvedOn: string | null;
  /** The chairs serving TODAY (co-chairs are both listed), in name order. */
  chairNames: string[];
  /** Seats in date today (zero-length seats and seats that start later are not counted). */
  servingCount: number;
}

export interface CommitteeList {
  /** The organization's local date. */
  today: string;
  /** Every committee when `showDissolved`, otherwise the live ones. */
  committees: CommitteeListRow[];
  /** Always the count of dissolved committees, shown or not. */
  dissolvedCount: number;
  showDissolved: boolean;
}

export interface CommitteeDetail {
  id: string;
  name: string;
  purpose: string | null;
  meetsWhen: string | null;
  kind: CommitteeKind | null;
  dissolvedOn: string | null;
}

export interface SeatRow {
  /** The `group_memberships` id. */
  membershipId: string;
  personId: string;
  displayName: string;
  role: GroupRoleValue;
  startsOn: string;
  endsOn: string | null;
  publicListed: boolean;
  /** False when the person's membership at THIS presbytery has ended ("No longer connected"). */
  connected: boolean;
  /** True when the person has a date of death ("Recorded as deceased"). */
  deceased: boolean;
}

export interface CarriedRole {
  id: string;
  name: string;
}

export interface CommitteePageData {
  committee: CommitteeDetail;
  /** Every seat, past and planned included; the page splits them with `splitRoster`. */
  seats: SeatRow[];
  /** The roles the committee's roster confers today (grants effective today to this group). */
  carriedRoles: CarriedRole[];
  today: string;
}

export interface CommitteeFormDefaults {
  /** Absent on the create form. */
  committee?: { id: string; name: string; kind: CommitteeKind | null; purpose: string; meetsWhen: string };
  today: string;
}

export interface SeatFormPerson {
  personId: string;
  displayName: string;
  /** A seat is serving or planned on this committee: the option reads "(already serves)" and is disabled. */
  alreadyServes: boolean;
}

export interface SeatFormOptions {
  committeeName: string;
  people: SeatFormPerson[];
  carriedRoles: CarriedRole[];
  today: string;
}

export interface SeatPageData {
  committeeId: string;
  committeeName: string;
  seat: SeatRow;
  today: string;
}

// ---------------------------------------------------------------------------
// The shared steps
// ---------------------------------------------------------------------------

type Rows<T> = { rows?: T[] };

async function rowsOf<T>(tx: OrgTx, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await tx.execute(query)) as unknown as Rows<T>).rows ?? [];
}

/** The key, then the organization type: both inside the caller's transaction. False is `forbidden`. */
async function mayManage(tx: OrgTx, viewer: CommitteesViewer): Promise<boolean> {
  const [held] = await holdsPermissions(tx, viewer, [GROUPS_MANAGE_KEY]);
  if (!held) return false;
  const rows = await rowsOf<{ organization_type: string }>(
    tx,
    sql`select organization_type from organizations where id = ${viewer.organizationId}`,
  );
  return rows[0]?.organization_type === "presbytery";
}

/** The organization's local date (`YYYY-MM-DD`). `now` is injectable for tests. */
async function todayInOrg(tx: OrgTx, organizationId: string, now: Date): Promise<string> {
  return todayInOrgZone(now, await orgTimeZoneInTx(tx, organizationId));
}

interface CommitteeRow {
  id: string;
  name: string;
  description: string | null;
  meets_when: string | null;
  kind: CommitteeKind | null;
  dissolved_on: string | null;
}

/** One query: a committee of THIS organization (type `committee`, `managed`), or null for any other id. */
async function loadCommittee(tx: OrgTx, organizationId: string, committeeId: string): Promise<CommitteeRow | null> {
  const rows = await rowsOf<CommitteeRow>(
    tx,
    sql`select g.id, g.name, g.description, g.meets_when, cd.kind, cd.dissolved_on::text as dissolved_on
          from groups g
          join group_types gt on gt.id = g.group_type_id
          left join committee_details cd on cd.group_id = g.id and cd.organization_id = g.organization_id
         where g.id = ${committeeId}
           and g.organization_id = ${organizationId}
           and g.membership_source = 'managed'
           and gt.key = 'committee'
         limit 1`,
  );
  return rows[0] ?? null;
}

const detailOf = (row: CommitteeRow): CommitteeDetail => ({
  id: row.id,
  name: row.name,
  purpose: row.description,
  meetsWhen: row.meets_when,
  kind: row.kind,
  dissolvedOn: row.dissolved_on,
});

interface SeatSqlRow {
  membership_id: string;
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  group_role: GroupRoleValue;
  starts_on: string;
  ends_on: string | null;
  public_listed: boolean;
  membership_ended_on: string | null;
  date_of_death: string | null;
}

const seatOf = (row: SeatSqlRow): SeatRow => {
  const status = personStatus({ membershipEndedOn: row.membership_ended_on, dateOfDeath: row.date_of_death });
  return {
    membershipId: row.membership_id,
    personId: row.person_id,
    displayName: `${row.preferred_name ?? row.first_name} ${row.last_name}`,
    role: row.group_role,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    publicListed: row.public_listed,
    connected: status.connected,
    deceased: status.deceased,
  };
};

/** The seat select shared by the committee page and the change-role page. A `where` fragment follows it. */
const SEAT_SELECT = sql`
  select gm.id as membership_id, gm.person_id, p.first_name, p.last_name, p.preferred_name,
         gm.group_role, gm.starts_on::text as starts_on, gm.ends_on::text as ends_on, gm.public_listed,
         m.ended_on::text as membership_ended_on, p.date_of_death::text as date_of_death
    from group_memberships gm
    join people p on p.id = gm.person_id
    left join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id`;

/** A transaction that opens with the key and the organization-type check. */
function readUnder<T>(
  viewer: CommitteesViewer,
  read: (tx: OrgTx) => Promise<T>,
): Promise<{ kind: "forbidden" } | T> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    if (!(await mayManage(tx, viewer))) return { kind: "forbidden" } as const;
    return read(tx);
  });
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * The committees at this presbytery with the chairs serving today and the count
 * serving today. A FIXED number of queries regardless of how many committees
 * (the access check, the organization's zone, the committees, then one grouped
 * read of the serving seats), pinned by `reads.db.test.ts`. The dissolved ones are
 * returned only when asked, and their COUNT always is.
 */
export async function readCommitteeList(
  viewer: CommitteesViewer,
  options: { showDissolved?: boolean } = {},
  now: Date = new Date(),
): Promise<CommitteesRead<CommitteeList>> {
  const showDissolved = options.showDissolved === true;
  return readUnder(viewer, async (tx): Promise<CommitteesRead<CommitteeList>> => {
    const org = viewer.organizationId;
    const today = await todayInOrg(tx, org, now);

    const committees = await rowsOf<CommitteeRow>(
      tx,
      sql`select g.id, g.name, g.description, g.meets_when, cd.kind, cd.dissolved_on::text as dissolved_on
            from groups g
            join group_types gt on gt.id = g.group_type_id
            left join committee_details cd on cd.group_id = g.id and cd.organization_id = g.organization_id
           where g.organization_id = ${org}
             and g.membership_source = 'managed'
             and gt.key = 'committee'
           order by lower(g.name), g.id`,
    );

    const serving = await rowsOf<{ group_id: string; serving: string; chairs: string[] }>(
      tx,
      sql`select gm.group_id,
                 count(*) as serving,
                 coalesce(json_agg(coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name)
                          filter (where gm.group_role = 'chair'), '[]'::json) as chairs
            from group_memberships gm
            join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
            join group_types gt on gt.id = g.group_type_id and gt.key = 'committee'
            join people p on p.id = gm.person_id
           where gm.organization_id = ${org}
             and g.membership_source = 'managed'
             and gm.starts_on <= ${today}::date
             and (gm.ends_on is null or gm.ends_on > ${today}::date)
           group by gm.group_id`,
    );
    const byGroup = new Map(serving.map((row) => [row.group_id, row]));

    const dissolvedCount = committees.filter((c) => c.dissolved_on !== null).length;
    const listed = committees
      .filter((c) => showDissolved || c.dissolved_on === null)
      .map((c): CommitteeListRow => {
        const seats = byGroup.get(c.id);
        return {
          id: c.id,
          name: c.name,
          meetsWhen: c.meets_when,
          kind: c.kind,
          dissolvedOn: c.dissolved_on,
          chairNames: [...(seats?.chairs ?? [])].sort(compareNames),
          servingCount: seats ? Number(seats.serving) : 0,
        };
      });

    return { kind: "ok", data: { today, committees: listed, dissolvedCount, showDissolved } };
  });
}

// ---------------------------------------------------------------------------
// One committee
// ---------------------------------------------------------------------------

/** One committee, every seat with the person's status, and the roles it carries. */
export async function readCommittee(
  viewer: CommitteesViewer,
  committeeId: string,
  now: Date = new Date(),
): Promise<CommitteesRead<CommitteePageData>> {
  return readUnder(viewer, async (tx): Promise<CommitteesRead<CommitteePageData>> => {
    if (!isUuid(committeeId)) return { kind: "not_found" };
    const org = viewer.organizationId;
    const row = await loadCommittee(tx, org, committeeId);
    if (!row) return { kind: "not_found" };

    const today = await todayInOrg(tx, org, now);
    const seatRows = await rowsOf<SeatSqlRow>(
      tx,
      sql`${SEAT_SELECT}
           where gm.group_id = ${committeeId} and gm.organization_id = ${org}
           order by gm.starts_on, gm.id`,
    );
    const { carriedRoles } = await readGroupRoleGrantsInTx(tx, org, committeeId, today);

    return { kind: "ok", data: { committee: detailOf(row), seats: seatRows.map(seatOf), carriedRoles, today } };
  });
}

/**
 * The create and edit forms' defaults. Without an id: the empty create form (just
 * `today`). With one: the committee's values, `not_found` for a wrong kind of
 * group, and `committee_dissolved` for a dissolved one (the page renders the C4
 * state, not a form).
 */
export async function readCommitteeFormDefaults(
  viewer: CommitteesViewer,
  committeeId?: string,
  now: Date = new Date(),
): Promise<CommitteesFormRead<CommitteeFormDefaults>> {
  return readUnder(viewer, async (tx): Promise<CommitteesFormRead<CommitteeFormDefaults>> => {
    const org = viewer.organizationId;
    if (committeeId === undefined) {
      return { kind: "ok", data: { today: await todayInOrg(tx, org, now) } };
    }
    if (!isUuid(committeeId)) return { kind: "not_found" };
    const row = await loadCommittee(tx, org, committeeId);
    if (!row) return { kind: "not_found" };
    if (row.dissolved_on !== null) return { kind: "committee_dissolved" };
    return {
      kind: "ok",
      data: {
        today: await todayInOrg(tx, org, now),
        committee: {
          id: row.id,
          name: row.name,
          kind: row.kind,
          purpose: row.description ?? "",
          meetsWhen: row.meets_when ?? "",
        },
      },
    };
  });
}

/**
 * The add-member form: the people with a CURRENT membership at this presbytery (the
 * F21 shape, never a bare `people` scan), each flagged `alreadyServes` when a seat
 * is serving or planned on this committee; the committee's name; the roles it
 * carries. Zero eligible people is the page's guided empty state.
 */
export async function readSeatFormOptions(
  viewer: CommitteesViewer,
  committeeId: string,
  now: Date = new Date(),
): Promise<CommitteesFormRead<SeatFormOptions>> {
  return readUnder(viewer, async (tx): Promise<CommitteesFormRead<SeatFormOptions>> => {
    if (!isUuid(committeeId)) return { kind: "not_found" };
    const org = viewer.organizationId;
    const row = await loadCommittee(tx, org, committeeId);
    if (!row) return { kind: "not_found" };
    if (row.dissolved_on !== null) return { kind: "committee_dissolved" };

    const today = await todayInOrg(tx, org, now);
    const people = await rowsOf<{
      person_id: string;
      first_name: string;
      last_name: string;
      preferred_name: string | null;
      already_serves: boolean;
    }>(
      tx,
      sql`select p.id as person_id, p.first_name, p.last_name, p.preferred_name,
                 exists (select 1
                           from group_memberships gm
                          where gm.group_id = ${committeeId}
                            and gm.organization_id = m.organization_id
                            and gm.person_id = p.id
                            and (gm.ends_on is null or (gm.ends_on > ${today}::date and gm.ends_on > gm.starts_on))
                        ) as already_serves
            from memberships m
            join people p on p.id = m.person_id
           where m.organization_id = ${org}
             and m.ended_on is null
           order by p.last_name, p.first_name, p.id`,
    );
    const { carriedRoles } = await readGroupRoleGrantsInTx(tx, org, committeeId, today);

    return {
      kind: "ok",
      data: {
        committeeName: row.name,
        today,
        carriedRoles,
        people: people.map((p) => ({
          personId: p.person_id,
          displayName: `${p.preferred_name ?? p.first_name} ${p.last_name}`,
          alreadyServes: p.already_serves,
        })),
      },
    };
  });
}

/** One seat under this committee, for the change-role page and the dialogs; `not_found` for a seat of another committee. */
export async function readSeat(
  viewer: CommitteesViewer,
  committeeId: string,
  membershipId: string,
  now: Date = new Date(),
): Promise<CommitteesRead<SeatPageData>> {
  return readUnder(viewer, async (tx): Promise<CommitteesRead<SeatPageData>> => {
    if (!isUuid(committeeId) || !isUuid(membershipId)) return { kind: "not_found" };
    const org = viewer.organizationId;
    const committee = await loadCommittee(tx, org, committeeId);
    if (!committee) return { kind: "not_found" };

    const seatRows = await rowsOf<SeatSqlRow>(
      tx,
      sql`${SEAT_SELECT}
           where gm.id = ${membershipId} and gm.group_id = ${committeeId} and gm.organization_id = ${org}
           limit 1`,
    );
    if (!seatRows[0]) return { kind: "not_found" };

    return {
      kind: "ok",
      data: {
        committeeId,
        committeeName: committee.name,
        seat: seatOf(seatRows[0]),
        today: await todayInOrg(tx, org, now),
      },
    };
  });
}
