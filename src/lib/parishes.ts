import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow, insertAuditRows } from "@/lib/audit-tx";
import { deriveConnection, type Connection } from "@/lib/community-labels";
import { pgErrorField, isPgError } from "@/lib/db/errors";
import { DIRECTORY_HIDDEN_SQL, deriveDeaconsByOrgUnit } from "@/lib/directory";
import { isUuid } from "@/lib/is-uuid";
import { isCategoryAxisOn, orgFeatureEnabledInTx } from "@/lib/org-features";
import {
  BULK_MOVE_MAX,
  MANAGEABLE_UNIT_TYPES,
  PARISHES_FEATURE_KEY,
  PARISH_ASSIGN_KEY,
  UNASSIGNED_PAGE_SIZE,
  bucketForConnections,
  normalizeDistrictName,
  type UnassignedGroup,
} from "@/lib/parishes-pure";

/**
 * Parish (deacon-district) management - docs/work-log/2026-10-25-parish-
 * management.md, Phase 3 "API Contract"; DECISIONS 242 to 245; drizzle/0068.
 *
 * THE ONLY WRITER of `org_units` and of `households.org_unit_id`
 * (`parishes-boundaries.test.ts` scans for a second one). It also owns the
 * Parishes read that used to live in `directory.ts` as `getParishRoster()`
 * (moved here so this file can import the hidden-person expression and the deacon
 * derivation from `directory.ts` without an import cycle).
 *
 * SHAPE: same as `officers.ts` and `role-grants.ts`. Every exported function
 * opens ONE `withOrgContext()` transaction and, inside it, reads the per-org
 * toggle (`org_portal.parishes`, toggle-only) and then the viewer's authority
 * FIRST - live, on every call, never from a session claim - before any other
 * read or write. Thrown exceptions are reserved for genuine failure
 * (`OrgAccessError`, a database failure, a deadlock); every expected outcome is
 * a typed result. The category axis flag is read once, OUTSIDE the transaction
 * (the `calendar.ts` shape).
 *
 * AUTHORITY (one query, `getParishAuthority`): the Moderator of the Board of
 * Deacons seat holds `parishes.assign` through the resolver (DECISION-242);
 * an administrator holds `people.manage`. Either may move households.
 * `officers.manage` defines, renames, archives and restores districts.
 * `directory.view_hidden` widens only what names a viewer sees.
 *
 * LOCK ORDER (DECISION-245), every writer: `org_units` rows first (`FOR SHARE`
 * for a mover, `FOR UPDATE` for archive/rename/restore, by id), then
 * `households` rows (`FOR UPDATE`, by id). The `FOR SHARE` on the target
 * district is what makes "no household ends up in an archived district" hold
 * even against a concurrent archive; the drizzle/0068 trigger is the backstop
 * and the library maps its named constraints (`org_unit_target_archived`,
 * `org_unit_target_campus`, `org_unit_target_missing`).
 *
 * AUDIT: every mutator writes its row(s) with `insertAuditRow(s)` in the SAME
 * transaction, so a failed audit insert fails the change. No household or person
 * name is ever written. A move that changes nothing writes nothing. The route
 * `actions.ts` files carry no `recordAudit()` of their own.
 *
 * PRIVACY: names are masked HERE, server-side (`seesHiddenNames` false and the
 * shared `DIRECTORY_HIDDEN_SQL` true gives "Private"). No contact detail,
 * birthday, photo or address column is selected by anything in this file.
 */

const OFFICERS_MANAGE = "officers.manage";
const PEOPLE_MANAGE = "people.manage";
const DIRECTORY_VIEW_HIDDEN = "directory.view_hidden";

export const PRIVATE_NAME = "Private";

export interface ParishActor {
  userId: string;
  email: string | null;
}

export interface ParishAuthority {
  /** `officers.manage`: define, rename, archive, restore. */
  canDefine: boolean;
  /** `parishes.assign` (the seat) or `people.manage`: move households. */
  canMove: boolean;
  /** `canMove` or `directory.view_hidden`: see household rows. */
  canListHouseholds: boolean;
  /** `canListHouseholds` or `canDefine`: reach the Parishes page at all. */
  canReadRoster: boolean;
  /** `people.manage` or `directory.view_hidden`: see a directory-hidden
   * person's name. */
  seesHiddenNames: boolean;
  /** The viewer holds `parishes.assign` (audit metadata `viaSeat`). */
  holdsSeatKey: boolean;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

const NO_AUTHORITY: ParishAuthority = {
  canDefine: false,
  canMove: false,
  canListHouseholds: false,
  canReadRoster: false,
  seesHiddenNames: false,
  holdsSeatKey: false,
};

/**
 * The single place the authority questions are answered: ONE query, four keys
 * (`presby_has_permission()` is the resolver; there is no second evaluator of
 * the seat's dates). With `managed` false (the org toggle is off) the three
 * management booleans are false and the roster read is `directory.view_hidden`
 * alone - today's behaviour.
 */
export async function getParishAuthority(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  managed = true,
): Promise<ParishAuthority> {
  const result = await tx.execute(sql`
    select k.key as key,
           presby_has_permission(
             ${personId}::uuid, ${organizationId}::uuid, k.key
           ) as allowed
      from unnest(array[
             ${OFFICERS_MANAGE}, ${PARISH_ASSIGN_KEY},
             ${PEOPLE_MANAGE}, ${DIRECTORY_VIEW_HIDDEN}
           ]::text[]) as k(key)
  `);
  const held = new Set(
    rowsOf<{ key: string; allowed: boolean | null }>(result)
      .filter((row) => row.allowed === true)
      .map((row) => row.key),
  );
  const viewHidden = held.has(DIRECTORY_VIEW_HIDDEN);
  if (!managed) {
    return {
      ...NO_AUTHORITY,
      canReadRoster: viewHidden,
      seesHiddenNames: viewHidden,
    };
  }
  const canDefine = held.has(OFFICERS_MANAGE);
  const holdsSeatKey = held.has(PARISH_ASSIGN_KEY);
  const canMove = holdsSeatKey || held.has(PEOPLE_MANAGE);
  const canListHouseholds = canMove || viewHidden;
  return {
    canDefine,
    canMove,
    canListHouseholds,
    canReadRoster: canListHouseholds || canDefine,
    seesHiddenNames: held.has(PEOPLE_MANAGE) || viewHidden,
    holdsSeatKey,
  };
}

type Gate =
  | { kind: "ok"; authority: ParishAuthority }
  | { kind: "off" };

/** Toggle first (a missing row is OFF), then authority. */
async function openGate(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  categoryAxisOn: boolean,
): Promise<Gate> {
  const on = await orgFeatureEnabledInTx(
    tx,
    organizationId,
    PARISHES_FEATURE_KEY,
    categoryAxisOn,
  );
  if (!on) return { kind: "off" };
  return {
    kind: "ok",
    authority: await getParishAuthority(tx, personId, organizationId, true),
  };
}

/**
 * Whether the Directory's Parishes tab should be offered: the toggle is on and
 * the viewer holds any of the three keys, or the toggle is off and the viewer
 * holds `directory.view_hidden` (today's rule). A convenience for navigation;
 * every page and action re-verifies.
 */
export async function canReadParishRoster(
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const managed = await orgFeatureEnabledInTx(
      tx,
      organizationId,
      PARISHES_FEATURE_KEY,
      categoryAxisOn,
    );
    const authority = await getParishAuthority(tx, personId, organizationId, managed);
    return authority.canReadRoster;
  });
}

// ---------------------------------------------------------------------------
// The single household count (DECISION-244)
// ---------------------------------------------------------------------------

/**
 * "Households in a district" means EVERY `households` row whose `org_unit_id`
 * is that district. It is the set a bulk move touches, so the dialog's N equals
 * the rows the transaction writes. The overview badges, the district page
 * header, the archive dialog, the bulk dialog and `expectedCount` all come from
 * here; nothing else counts households per district.
 */
export async function countHouseholdsByUnit(
  tx: OrgTx,
  organizationId: string,
  unitIds?: readonly string[],
): Promise<Map<string, number>> {
  if (unitIds !== undefined && unitIds.length === 0) return new Map();
  const result = await tx.execute(sql`
    select org_unit_id::text as org_unit_id, count(*)::int as n
      from households
     where organization_id = ${organizationId}::uuid
       and org_unit_id is not null
       ${
         unitIds === undefined
           ? sql``
           : sql`and org_unit_id in (${sql.join(
               unitIds.map((id) => sql`${id}::uuid`),
               sql`, `,
             )})`
       }
     group by org_unit_id
  `);
  const counts = new Map<string, number>();
  for (const row of rowsOf<{ org_unit_id: string; n: number }>(result)) {
    counts.set(row.org_unit_id, row.n);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Shared read shapes
// ---------------------------------------------------------------------------

export interface ParishUnitEntry {
  orgUnitId: string;
  name: string;
  unitType: string;
  archived: boolean;
  /** `null` when the district's deacon seat is vacant. */
  deaconName: string | null;
  householdCount: number;
}

export interface ParishTarget {
  orgUnitId: string;
  name: string;
}

/** One person on a household row: a name (or "Private") and a connection
 * badge. Deliberately no id, contact, birthday, photo or address. */
export interface ParishPersonLine {
  name: string;
  masked: boolean;
  connection: Connection;
}

export interface ParishHouseholdRow {
  householdId: string;
  name: string;
  people: ParishPersonLine[];
}

export interface UnassignedCounts {
  members: number;
  participants: number;
  visitors: number;
  others: number;
}

interface PersonRow {
  household_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  current_roll: string | null;
  engagement_status: string;
  hidden: boolean;
}

function toPersonLine(row: PersonRow, seesHiddenNames: boolean): ParishPersonLine {
  const masked = row.hidden === true && !seesHiddenNames;
  return {
    name: masked
      ? PRIVATE_NAME
      : `${row.preferred_name ?? row.first_name} ${row.last_name}`,
    masked,
    connection: deriveConnection({
      endedOn: null,
      endedReason: null,
      currentRoll: row.current_roll,
      engagementStatus: row.engagement_status,
    }),
  };
}

/** The current, living, unmerged people of each household in `householdIds`.
 * Names are masked HERE when `seesHiddenNames` is false. */
async function loadHouseholdPeople(
  tx: OrgTx,
  organizationId: string,
  householdIds: readonly string[],
  seesHiddenNames: boolean,
): Promise<Map<string, ParishPersonLine[]>> {
  const byHousehold = new Map<string, ParishPersonLine[]>();
  if (householdIds.length === 0) return byHousehold;
  const result = await tx.execute(sql`
    select m.household_id::text as household_id,
           p.first_name, p.last_name, p.preferred_name,
           m.current_roll, m.engagement_status,
           ${DIRECTORY_HIDDEN_SQL} as hidden
      from memberships m
      join people p on p.id = m.person_id
      left join person_privacy pp
             on pp.person_id = m.person_id
            and pp.organization_id = m.organization_id
     where m.organization_id = ${organizationId}::uuid
       and m.ended_on is null
       and p.date_of_death is null
       and p.merged_into_id is null
       and m.household_id in (${sql.join(
         householdIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
     order by p.last_name, p.first_name, p.id
  `);
  for (const row of rowsOf<PersonRow>(result)) {
    const list = byHousehold.get(row.household_id) ?? [];
    list.push(toPersonLine(row, seesHiddenNames));
    byHousehold.set(row.household_id, list);
  }
  return byHousehold;
}

interface UnassignedRow extends PersonRow {
  household_name: string;
}

export interface UnassignedHousehold extends ParishHouseholdRow {
  group: UnassignedGroup;
}

/**
 * The Unassigned definition (G8), computed in one place: a household with no
 * district and at least one living, unmerged person with a CURRENT membership
 * at this organization. Each household sits in exactly one of four buckets
 * (`bucketForConnections`, first match wins). One query returns one row per
 * (household, person); the buckets and counts are folded in TypeScript so the
 * connection vocabulary stays `deriveConnection()`, not a SQL copy of it.
 * Ordered by household name, then id.
 */
async function loadUnassigned(
  tx: OrgTx,
  organizationId: string,
  seesHiddenNames: boolean,
): Promise<UnassignedHousehold[]> {
  const result = await tx.execute(sql`
    select h.id::text as household_id, h.name as household_name,
           p.first_name, p.last_name, p.preferred_name,
           m.current_roll, m.engagement_status,
           ${DIRECTORY_HIDDEN_SQL} as hidden
      from households h
      join memberships m
        on m.household_id = h.id and m.organization_id = h.organization_id
      join people p on p.id = m.person_id
      left join person_privacy pp
             on pp.person_id = m.person_id
            and pp.organization_id = m.organization_id
     where h.organization_id = ${organizationId}::uuid
       and h.org_unit_id is null
       and m.ended_on is null
       and p.date_of_death is null
       and p.merged_into_id is null
     order by lower(h.name), h.id, p.last_name, p.first_name, p.id
  `);
  const order: string[] = [];
  const households = new Map<string, { name: string; people: ParishPersonLine[] }>();
  for (const row of rowsOf<UnassignedRow>(result)) {
    let entry = households.get(row.household_id);
    if (!entry) {
      entry = { name: row.household_name, people: [] };
      households.set(row.household_id, entry);
      order.push(row.household_id);
    }
    entry.people.push(toPersonLine(row, seesHiddenNames));
  }
  return order.map((householdId) => {
    const entry = households.get(householdId)!;
    return {
      householdId,
      name: entry.name,
      people: entry.people,
      group: bucketForConnections(entry.people.map((p) => p.connection)),
    };
  });
}

function countByGroup(households: readonly UnassignedHousehold[]): UnassignedCounts {
  const counts: UnassignedCounts = { members: 0, participants: 0, visitors: 0, others: 0 };
  for (const household of households) counts[household.group] += 1;
  return counts;
}

const MANAGEABLE_TYPES_SQL = sql.join(
  MANAGEABLE_UNIT_TYPES.map((t) => sql`${t}`),
  sql`, `,
);

interface UnitRow {
  id: string;
  name: string;
  unit_type: string;
  archived_at: string | null;
}

/** Active manageable districts, name-ordered - the move/assign targets. */
async function loadActiveTargets(
  tx: OrgTx,
  organizationId: string,
  excludeId?: string,
): Promise<ParishTarget[]> {
  const result = await tx.execute(sql`
    select id::text as id, name
      from org_units
     where organization_id = ${organizationId}::uuid
       and archived_at is null
       and unit_type in (${MANAGEABLE_TYPES_SQL})
       ${excludeId ? sql`and id <> ${excludeId}::uuid` : sql``}
     order by lower(name), id
  `);
  return rowsOf<{ id: string; name: string }>(result).map((row) => ({
    orgUnitId: row.id,
    name: row.name,
  }));
}

// ---------------------------------------------------------------------------
// getParishesOverview (replaces directory.ts's getParishRoster)
// ---------------------------------------------------------------------------

export type ParishesOverviewResult =
  | {
      kind: "ok";
      /** The org toggle is on. Off: the legacy read-only list, no links. */
      managed: boolean;
      authority: ParishAuthority;
      districts: ParishUnitEntry[];
      archived: ParishUnitEntry[];
      /** Households in no district (G8); `null` when the viewer may not list
       * households or the toggle is off. */
      unassignedCount: number | null;
      /** An open Moderator seat term whose holder has a current membership;
       * `null` unless the viewer can define districts. */
      seatFilled: boolean | null;
    }
  | { kind: "forbidden" };

/**
 * The Parishes page's data. `managed` false (toggle off) is the legacy view:
 * gated on `directory.view_hidden` alone, read-only, every active unit. The
 * household count is now EVERY household in the district (P3-10), not only
 * those with a directory-visible member.
 */
export async function getParishesOverview(
  personId: string,
  organizationId: string,
): Promise<ParishesOverviewResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const managed = await orgFeatureEnabledInTx(
      tx,
      organizationId,
      PARISHES_FEATURE_KEY,
      categoryAxisOn,
    );
    const authority = await getParishAuthority(tx, personId, organizationId, managed);
    if (!authority.canReadRoster) return { kind: "forbidden" };

    const unitsResult = await tx.execute(sql`
      select id::text as id, name, unit_type, archived_at::text as archived_at
        from org_units
       where organization_id = ${organizationId}::uuid
         ${
           managed
             ? sql`and unit_type in (${MANAGEABLE_TYPES_SQL})`
             : sql`and archived_at is null`
         }
       order by lower(name), id
    `);
    const units = rowsOf<UnitRow>(unitsResult);
    const ids = units.map((u) => u.id);
    const deacons = await deriveDeaconsByOrgUnit(tx, organizationId, ids);
    const counts = await countHouseholdsByUnit(tx, organizationId, ids);
    const entries: ParishUnitEntry[] = units.map((unit) => ({
      orgUnitId: unit.id,
      name: unit.name,
      unitType: unit.unit_type,
      archived: unit.archived_at !== null,
      deaconName: deacons.get(unit.id) ?? null,
      householdCount: counts.get(unit.id) ?? 0,
    }));

    let unassignedCount: number | null = null;
    if (managed && authority.canListHouseholds) {
      const unassigned = await loadUnassigned(tx, organizationId, authority.seesHiddenNames);
      unassignedCount = unassigned.length;
    }

    let seatFilled: boolean | null = null;
    if (managed && authority.canDefine) {
      const seat = await tx.execute(sql`
        select exists (
                 select 1
                   from officer_terms ot
                   join memberships m
                     on m.person_id = ot.person_id
                    and m.organization_id = ot.organization_id
                    and m.ended_on is null
                  where ot.organization_id = ${organizationId}::uuid
                    and ot.office = 'deacons_moderator'
                    and ot.starts_on <= current_date
                    and (ot.ends_on is null or ot.ends_on > current_date)
               ) as filled
      `);
      seatFilled = rowsOf<{ filled: boolean }>(seat)[0]?.filled === true;
    }

    return {
      kind: "ok",
      managed,
      authority,
      districts: entries.filter((e) => !e.archived),
      archived: entries.filter((e) => e.archived),
      unassignedCount,
      seatFilled,
    };
  });
}

// ---------------------------------------------------------------------------
// getDistrictPage
// ---------------------------------------------------------------------------

export type DistrictPageResult =
  | {
      kind: "ok";
      district: ParishUnitEntry;
      authority: ParishAuthority;
      households: ParishHouseholdRow[];
      total: number;
      page: number;
      pageSize: number;
      /** Active districts a household can move to (this one excluded);
       * empty unless the viewer can move households. */
      activeTargets: ParishTarget[];
    }
  | { kind: "off" }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/**
 * One district and its households, name-ordered, `UNASSIGNED_PAGE_SIZE` per
 * page. `not_found` covers a malformed id, another organization's id, a
 * nonexistent id and a campus alike - the same answer for all four.
 */
export async function getDistrictPage(
  personId: string,
  organizationId: string,
  orgUnitId: string,
  opts: { page?: number } = {},
): Promise<DistrictPageResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    const { authority } = gate;
    if (!authority.canListHouseholds) return { kind: "forbidden" };
    if (!isUuid(orgUnitId)) return { kind: "not_found" };

    const unitResult = await tx.execute(sql`
      select id::text as id, name, unit_type, archived_at::text as archived_at
        from org_units
       where id = ${orgUnitId}::uuid
         and organization_id = ${organizationId}::uuid
         and unit_type in (${MANAGEABLE_TYPES_SQL})
    `);
    const unit = rowsOf<UnitRow>(unitResult)[0];
    if (!unit) return { kind: "not_found" };

    const deacons = await deriveDeaconsByOrgUnit(tx, organizationId, [unit.id]);
    const counts = await countHouseholdsByUnit(tx, organizationId, [unit.id]);
    const total = counts.get(unit.id) ?? 0;
    const pageSize = UNASSIGNED_PAGE_SIZE;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), lastPage);

    const householdResult = await tx.execute(sql`
      select id::text as id, name
        from households
       where organization_id = ${organizationId}::uuid
         and org_unit_id = ${unit.id}::uuid
       order by lower(name), id
       limit ${pageSize} offset ${(page - 1) * pageSize}
    `);
    const householdRows = rowsOf<{ id: string; name: string }>(householdResult);
    const people = await loadHouseholdPeople(
      tx,
      organizationId,
      householdRows.map((h) => h.id),
      authority.seesHiddenNames,
    );

    return {
      kind: "ok",
      district: {
        orgUnitId: unit.id,
        name: unit.name,
        unitType: unit.unit_type,
        archived: unit.archived_at !== null,
        deaconName: deacons.get(unit.id) ?? null,
        householdCount: total,
      },
      authority,
      households: householdRows.map((h) => ({
        householdId: h.id,
        name: h.name,
        people: people.get(h.id) ?? [],
      })),
      total,
      page,
      pageSize,
      activeTargets: authority.canMove
        ? await loadActiveTargets(tx, organizationId, unit.id)
        : [],
    };
  });
}

// ---------------------------------------------------------------------------
// getUnassignedPage
// ---------------------------------------------------------------------------

export type UnassignedPageResult =
  | {
      kind: "ok";
      /** Counts over all four groups, whatever `hide` is. */
      counts: UnassignedCounts;
      households: UnassignedHousehold[];
      /** Households in the groups that are not hidden. */
      totalShown: number;
      page: number;
      pageSize: number;
      activeTargets: ParishTarget[];
      authority: ParishAuthority;
    }
  | { kind: "off" }
  | { kind: "forbidden" };

export async function getUnassignedPage(
  personId: string,
  organizationId: string,
  opts: { hide?: ReadonlySet<UnassignedGroup>; page?: number } = {},
): Promise<UnassignedPageResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    const { authority } = gate;
    if (!authority.canListHouseholds) return { kind: "forbidden" };

    const all = await loadUnassigned(tx, organizationId, authority.seesHiddenNames);
    const hidden = opts.hide ?? new Set<UnassignedGroup>();
    const shown = all.filter((household) => !hidden.has(household.group));
    const pageSize = UNASSIGNED_PAGE_SIZE;
    const lastPage = Math.max(1, Math.ceil(shown.length / pageSize));
    const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), lastPage);

    return {
      kind: "ok",
      counts: countByGroup(all),
      households: shown.slice((page - 1) * pageSize, page * pageSize),
      totalShown: shown.length,
      page,
      pageSize,
      activeTargets: authority.canMove
        ? await loadActiveTargets(tx, organizationId)
        : [],
      authority,
    };
  });
}

// ---------------------------------------------------------------------------
// District lifecycle: define, rename, archive, restore
// ---------------------------------------------------------------------------

export type DistrictMutationFailure =
  | { kind: "off" }
  | { kind: "forbidden" };

export type DefineDistrictResult =
  | { kind: "ok"; orgUnitId: string; name: string }
  | DistrictMutationFailure
  | { kind: "invalid_input"; reason: "empty" | "too_long" }
  | { kind: "name_taken" };

const NAME_TAKEN_INDEX = "org_units_active_name_idx";

/** Creates a `district`. A duplicate active name (case-insensitive) is the
 * unique index's refusal, mapped by constraint name. */
export async function defineDistrict(
  personId: string,
  organizationId: string,
  actor: ParishActor,
  input: { name: string },
): Promise<DefineDistrictResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    if (!gate.authority.canDefine) return { kind: "forbidden" };

    const normalized = normalizeDistrictName(input.name);
    if (!normalized.ok) return { kind: "invalid_input", reason: normalized.reason };

    let orgUnitId: string;
    try {
      const inserted = await tx.execute(sql`
        insert into org_units (organization_id, unit_type, name)
        values (${organizationId}::uuid, 'district', ${normalized.name})
        returning id::text as id
      `);
      orgUnitId = rowsOf<{ id: string }>(inserted)[0]!.id;
    } catch (err) {
      if (isPgError(err, "23505", NAME_TAKEN_INDEX)) return { kind: "name_taken" };
      throw err;
    }

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.DISTRICT_CREATED,
      actor,
      resourceType: "org_unit",
      resourceId: orgUnitId,
      metadata: { organizationId, name: normalized.name },
    });
    return { kind: "ok", orgUnitId, name: normalized.name };
  });
}

type LockedUnit = { id: string; name: string; archived: boolean };

/** Locks one manageable unit `FOR UPDATE` (org_units first in the lock order),
 * scoped to the organization. `null` for a bad, foreign or missing id, or a
 * campus. */
async function lockUnitForUpdate(
  tx: OrgTx,
  organizationId: string,
  orgUnitId: string,
): Promise<LockedUnit | null> {
  if (!isUuid(orgUnitId)) return null;
  const result = await tx.execute(sql`
    select id::text as id, name, unit_type, archived_at::text as archived_at
      from org_units
     where id = ${orgUnitId}::uuid
       and organization_id = ${organizationId}::uuid
       and unit_type in (${MANAGEABLE_TYPES_SQL})
       for update
  `);
  const row = rowsOf<UnitRow>(result)[0];
  return row ? { id: row.id, name: row.name, archived: row.archived_at !== null } : null;
}

export type RenameDistrictResult =
  | { kind: "ok"; changed: boolean; name: string }
  | DistrictMutationFailure
  | { kind: "not_found" }
  | { kind: "wrong_state" }
  | { kind: "invalid_input"; reason: "empty" | "too_long" }
  | { kind: "name_taken" };

export async function renameDistrict(
  personId: string,
  organizationId: string,
  actor: ParishActor,
  input: { orgUnitId: string; name: string },
): Promise<RenameDistrictResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    if (!gate.authority.canDefine) return { kind: "forbidden" };

    const normalized = normalizeDistrictName(input.name);
    if (!normalized.ok) return { kind: "invalid_input", reason: normalized.reason };

    const unit = await lockUnitForUpdate(tx, organizationId, input.orgUnitId);
    if (!unit) return { kind: "not_found" };
    if (unit.archived) return { kind: "wrong_state" };
    if (unit.name === normalized.name) {
      return { kind: "ok", changed: false, name: unit.name };
    }

    try {
      await tx.execute(sql`
        update org_units set name = ${normalized.name}
         where id = ${unit.id}::uuid and organization_id = ${organizationId}::uuid
      `);
    } catch (err) {
      if (isPgError(err, "23505", NAME_TAKEN_INDEX)) return { kind: "name_taken" };
      throw err;
    }

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.DISTRICT_RENAMED,
      actor,
      resourceType: "org_unit",
      resourceId: unit.id,
      metadata: { organizationId, from: unit.name, to: normalized.name },
    });
    return { kind: "ok", changed: true, name: normalized.name };
  });
}

export type ArchiveDistrictResult =
  | { kind: "ok"; name: string; householdCount: number; openDeaconName: string | null }
  | DistrictMutationFailure
  | { kind: "not_found" }
  | { kind: "wrong_state" };

/**
 * Archives a district. Households stay in it until moved (they are not
 * reassigned); the guard trigger then refuses any move INTO it. The count and
 * the open deacon are read after the `FOR UPDATE` lock, when every in-flight
 * mover has committed or is waiting on that lock.
 */
export async function archiveDistrict(
  personId: string,
  organizationId: string,
  actor: ParishActor,
  input: { orgUnitId: string },
): Promise<ArchiveDistrictResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    if (!gate.authority.canDefine) return { kind: "forbidden" };

    const unit = await lockUnitForUpdate(tx, organizationId, input.orgUnitId);
    if (!unit) return { kind: "not_found" };
    if (unit.archived) return { kind: "wrong_state" };

    const counts = await countHouseholdsByUnit(tx, organizationId, [unit.id]);
    const deacons = await deriveDeaconsByOrgUnit(tx, organizationId, [unit.id]);
    const householdCount = counts.get(unit.id) ?? 0;
    const openDeaconName = deacons.get(unit.id) ?? null;

    await tx.execute(sql`
      update org_units set archived_at = now()
       where id = ${unit.id}::uuid and organization_id = ${organizationId}::uuid
         and archived_at is null
    `);

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.DISTRICT_ARCHIVED,
      actor,
      resourceType: "org_unit",
      resourceId: unit.id,
      metadata: { organizationId, householdCount, hadOpenDeacon: openDeaconName !== null },
    });
    return { kind: "ok", name: unit.name, householdCount, openDeaconName };
  });
}

export type RestoreDistrictResult =
  | { kind: "ok"; name: string }
  | DistrictMutationFailure
  | { kind: "not_found" }
  | { kind: "wrong_state" }
  | { kind: "name_taken" };

export async function restoreDistrict(
  personId: string,
  organizationId: string,
  actor: ParishActor,
  input: { orgUnitId: string },
): Promise<RestoreDistrictResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    if (!gate.authority.canDefine) return { kind: "forbidden" };

    const unit = await lockUnitForUpdate(tx, organizationId, input.orgUnitId);
    if (!unit) return { kind: "not_found" };
    if (!unit.archived) return { kind: "wrong_state" };

    try {
      await tx.execute(sql`
        update org_units set archived_at = null
         where id = ${unit.id}::uuid and organization_id = ${organizationId}::uuid
           and archived_at is not null
      `);
    } catch (err) {
      if (isPgError(err, "23505", NAME_TAKEN_INDEX)) return { kind: "name_taken" };
      throw err;
    }

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.DISTRICT_RESTORED,
      actor,
      resourceType: "org_unit",
      resourceId: unit.id,
      metadata: { organizationId },
    });
    return { kind: "ok", name: unit.name };
  });
}

// ---------------------------------------------------------------------------
// moveHousehold (single move, assign, clear, and Undo)
// ---------------------------------------------------------------------------

export type TargetUnavailableReason = "archived" | "campus";

export type MoveHouseholdResult =
  | {
      kind: "ok";
      /** false: the household was already at the target (a quiet no-op). */
      changed: boolean;
      fromOrgUnitId: string | null;
      toOrgUnitId: string | null;
      fromName: string | null;
      toName: string | null;
    }
  | DistrictMutationFailure
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "target_unavailable"; reason: TargetUnavailableReason };

export interface MoveHouseholdInput {
  householdId: string;
  /** The district the viewer saw; `null` for a household with none. */
  expectedOrgUnitId: string | null;
  /** `null` clears the assignment (a clear is a write, never a delete). */
  targetOrgUnitId: string | null;
  /** Stamped on the audit row; Undo is the same call with the roles of
   * expected and target swapped. */
  undo?: boolean;
}

function mapTargetTriggerError(err: unknown): MoveHouseholdResult | null {
  const constraint = pgErrorField(err, "constraint");
  if (constraint === "org_unit_target_archived") {
    return { kind: "target_unavailable", reason: "archived" };
  }
  if (constraint === "org_unit_target_campus") {
    return { kind: "target_unavailable", reason: "campus" };
  }
  if (constraint === "org_unit_target_missing") return { kind: "not_found" };
  return null;
}

/**
 * Moves one household with an expected-value conditional update.
 *
 *   1. Gate (toggle, then `canMove`), then validate the three uuids. Scope and
 *      authority come BEFORE the household's state is read: a caller without
 *      authority gets the same refusal whether the household exists or not.
 *   2. Lock the target `FOR SHARE` (org_units first), read its name and state:
 *      an archived or campus target is `target_unavailable`, a foreign or
 *      missing one is `not_found`.
 *   3. `UPDATE ... WHERE org_unit_id IS NOT DISTINCT FROM $expected`. Zero rows:
 *      read the current value - already the target is a quiet `changed: false`
 *      with NO audit row (a double click lands here), anything else is
 *      `conflict`, an absent household is `not_found`.
 *   4. Audit row, same transaction, only when a row changed.
 */
export async function moveHousehold(
  personId: string,
  organizationId: string,
  actor: ParishActor,
  input: MoveHouseholdInput,
): Promise<MoveHouseholdResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    if (!gate.authority.canMove) return { kind: "forbidden" };

    const { householdId, expectedOrgUnitId, targetOrgUnitId } = input;
    if (
      !isUuid(householdId) ||
      (expectedOrgUnitId !== null && !isUuid(expectedOrgUnitId)) ||
      (targetOrgUnitId !== null && !isUuid(targetOrgUnitId))
    ) {
      return { kind: "not_found" };
    }

    let toName: string | null = null;
    if (targetOrgUnitId !== null) {
      const targetResult = await tx.execute(sql`
        select id::text as id, name, unit_type, archived_at::text as archived_at
          from org_units
         where id = ${targetOrgUnitId}::uuid
           and organization_id = ${organizationId}::uuid
           for share
      `);
      const target = rowsOf<UnitRow>(targetResult)[0];
      if (!target) return { kind: "not_found" };
      if (target.unit_type === "campus") {
        return { kind: "target_unavailable", reason: "campus" };
      }
      if (target.archived_at !== null) {
        return { kind: "target_unavailable", reason: "archived" };
      }
      toName = target.name;
    }

    let fromName: string | null = null;
    if (expectedOrgUnitId !== null) {
      const fromResult = await tx.execute(sql`
        select name from org_units
         where id = ${expectedOrgUnitId}::uuid
           and organization_id = ${organizationId}::uuid
      `);
      fromName = rowsOf<{ name: string }>(fromResult)[0]?.name ?? null;
    }

    let changed = false;
    if (expectedOrgUnitId !== targetOrgUnitId) {
      try {
        const updated = await tx.execute(sql`
          update households
             set org_unit_id = ${targetOrgUnitId}::uuid
           where id = ${householdId}::uuid
             and organization_id = ${organizationId}::uuid
             and org_unit_id is not distinct from ${expectedOrgUnitId}::uuid
          returning id
        `);
        changed = rowsOf<{ id: string }>(updated).length > 0;
      } catch (err) {
        const mapped = mapTargetTriggerError(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    if (!changed) {
      const current = await tx.execute(sql`
        select org_unit_id::text as org_unit_id
          from households
         where id = ${householdId}::uuid
           and organization_id = ${organizationId}::uuid
      `);
      const row = rowsOf<{ org_unit_id: string | null }>(current)[0];
      if (!row) return { kind: "not_found" };
      if ((row.org_unit_id ?? null) !== targetOrgUnitId) return { kind: "conflict" };
      return {
        kind: "ok",
        changed: false,
        fromOrgUnitId: expectedOrgUnitId,
        toOrgUnitId: targetOrgUnitId,
        fromName,
        toName,
      };
    }

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.HOUSEHOLD_DISTRICT_CHANGED,
      actor,
      resourceType: "household",
      resourceId: householdId,
      metadata: {
        organizationId,
        fromOrgUnitId: expectedOrgUnitId,
        toOrgUnitId: targetOrgUnitId,
        viaSeat: gate.authority.holdsSeatKey,
        ...(input.undo ? { undo: true } : {}),
      },
    });

    return {
      kind: "ok",
      changed: true,
      fromOrgUnitId: expectedOrgUnitId,
      toOrgUnitId: targetOrgUnitId,
      fromName,
      toName,
    };
  });
}

// ---------------------------------------------------------------------------
// bulkMoveHouseholds
// ---------------------------------------------------------------------------

export type BulkMoveResult =
  | { kind: "ok"; moved: number; skipped: number; toName: string }
  | DistrictMutationFailure
  | { kind: "not_found" }
  | { kind: "source_not_archived" }
  | { kind: "same_unit" }
  | { kind: "target_unavailable"; reason: TargetUnavailableReason }
  | { kind: "too_many" }
  | { kind: "count_changed" };

export interface BulkMoveInput {
  sourceOrgUnitId: string;
  targetOrgUnitId: string;
  /** The count the viewer saw in the dialog (1 to `BULK_MOVE_MAX`). */
  expectedCount: number;
}

/**
 * Empties an archived district into an active one. THE REQUEST CARRIES NO
 * HOUSEHOLD IDS: an archived source can only shrink (the trigger refuses any
 * move into it), so the current set is the set the viewer saw minus moves made
 * since. `moved` is the current set; `skipped` is `expectedCount - moved`; a
 * set LARGER than `expectedCount` (a restore and a re-archive in between) is
 * `count_changed`. Over `BULK_MOVE_MAX` is `too_many` - never a truncation.
 * Lock order: both districts `FOR SHARE` by id, then the source's households
 * `FOR UPDATE` by id. The response carries counts only.
 */
export async function bulkMoveHouseholds(
  personId: string,
  organizationId: string,
  actor: ParishActor,
  input: BulkMoveInput,
): Promise<BulkMoveResult> {
  const categoryAxisOn = await isCategoryAxisOn();
  return withOrgContext(personId, organizationId, async (tx) => {
    const gate = await openGate(tx, personId, organizationId, categoryAxisOn);
    if (gate.kind === "off") return { kind: "off" };
    if (!gate.authority.canMove) return { kind: "forbidden" };

    const { sourceOrgUnitId, targetOrgUnitId, expectedCount } = input;
    if (!isUuid(sourceOrgUnitId) || !isUuid(targetOrgUnitId)) {
      return { kind: "not_found" };
    }
    if (sourceOrgUnitId.toLowerCase() === targetOrgUnitId.toLowerCase()) {
      return { kind: "same_unit" };
    }
    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
      return { kind: "count_changed" };
    }
    if (expectedCount > BULK_MOVE_MAX) return { kind: "too_many" };

    const unitsResult = await tx.execute(sql`
      select id::text as id, name, unit_type, archived_at::text as archived_at
        from org_units
       where id in (${sourceOrgUnitId}::uuid, ${targetOrgUnitId}::uuid)
         and organization_id = ${organizationId}::uuid
       order by id
         for share
    `);
    const units = rowsOf<UnitRow>(unitsResult);
    const source = units.find((u) => u.id === sourceOrgUnitId.toLowerCase());
    const target = units.find((u) => u.id === targetOrgUnitId.toLowerCase());
    if (!source || !target) return { kind: "not_found" };
    if (source.archived_at === null || source.unit_type === "campus") {
      return { kind: "source_not_archived" };
    }
    if (target.unit_type === "campus") {
      return { kind: "target_unavailable", reason: "campus" };
    }
    if (target.archived_at !== null) {
      return { kind: "target_unavailable", reason: "archived" };
    }

    const lockedResult = await tx.execute(sql`
      select id::text as id
        from households
       where organization_id = ${organizationId}::uuid
         and org_unit_id = ${source.id}::uuid
       order by id
         for update
    `);
    const householdIds = rowsOf<{ id: string }>(lockedResult).map((r) => r.id);
    if (householdIds.length > BULK_MOVE_MAX) return { kind: "too_many" };
    if (householdIds.length > expectedCount) return { kind: "count_changed" };

    const moved = householdIds.length;
    const skipped = expectedCount - moved;
    if (moved === 0) {
      return { kind: "ok", moved: 0, skipped, toName: target.name };
    }

    try {
      await tx.execute(sql`
        update households
           set org_unit_id = ${target.id}::uuid
         where organization_id = ${organizationId}::uuid
           and org_unit_id = ${source.id}::uuid
           and id in (${sql.join(
             householdIds.map((id) => sql`${id}::uuid`),
             sql`, `,
           )})
      `);
    } catch (err) {
      const mapped = mapTargetTriggerError(err);
      if (mapped && (mapped.kind === "target_unavailable" || mapped.kind === "not_found")) {
        return mapped;
      }
      throw err;
    }

    const batchId = randomUUID();
    const viaSeat = gate.authority.holdsSeatKey;
    await insertAuditRows(tx, [
      ...householdIds.map((householdId) => ({
        action: AUDIT_ACTIONS.HOUSEHOLD_DISTRICT_CHANGED,
        actor,
        resourceType: "household",
        resourceId: householdId,
        metadata: {
          organizationId,
          fromOrgUnitId: source.id,
          toOrgUnitId: target.id,
          viaSeat,
          batchId,
        },
      })),
      {
        action: AUDIT_ACTIONS.HOUSEHOLD_DISTRICT_BULK_MOVED,
        actor,
        resourceType: "org_unit",
        resourceId: source.id,
        metadata: {
          organizationId,
          batchId,
          toOrgUnitId: target.id,
          movedCount: moved,
          skippedCount: skipped,
        },
      },
    ]);

    return { kind: "ok", moved, skipped, toName: target.name };
  });
}
