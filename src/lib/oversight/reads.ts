import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { congregationOversight } from "@/lib/db/domain/presbytery";
import {
  oversightBuildingAppraisals,
  oversightBuildings,
  oversightInsuranceYears,
  oversightLoans,
  oversightProfiles,
} from "@/lib/db/domain/oversight";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { listMemberCongregations, resolveMemberCongregation } from "@/lib/presbytery";
import { todayInOrgZone } from "@/lib/shared/org-time";
import {
  OVERSIGHT_FINANCE_KEY,
  OVERSIGHT_MANAGE_KEY,
  type BuildingType,
  type Condition,
  type LoanKind,
  type LoanStatus,
  type OversightRead,
  type OversightViewer,
  type Provenance,
  type RetireReason,
} from "./contract";
import { latestAppraisal } from "./derive";

/**
 * The congregation records' readers (docs/work-log/2026-11-17-congregation-
 * profile.md, Phase 3 "API Contract: Reads"; R3; DECISION-347). ONE READER PER
 * SECTION, each its own `withOrgContext()` transaction and its own key check
 * (`presby_has_permission`, live, through `holdsPermissions`), so a section a
 * viewer's keys do not cover is DENIED inside its transaction, not merely hidden,
 * and a failing section cannot take the rest of the page down.
 *
 * Every reader returns `{ kind: "ok", data } | { kind: "forbidden" } |
 * { kind: "not_found" }` and never throws for a missing key. An `OrgAccessError`
 * (membership ended mid-request) propagates to the page's `[slug]/error.tsx`; any
 * other throw is the page's section load error. A congregation that is not a
 * member of this presbytery, a row of another congregation, another presbytery's
 * row and a removed row are the same `not_found`.
 *
 * Reads are not audited (DECISION-345, `paper`): only writes are.
 *
 * No blob access here (the photo reads are `photo-reads.ts`, Increment 2). Dates
 * are the database's `YYYY-MM-DD` text, never a `Date`.
 */

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface MemberCongregation {
  id: string;
  name: string;
  platformStatus: string;
}

export interface ProfileRow {
  id: string;
  streetAddress: string | null;
  city: string | null;
  county: string | null;
  yearOrganized: number | null;
  phone: string | null;
  provenance: Provenance;
  rowVersion: number;
}

export interface BuildingRow {
  id: string;
  name: string;
  buildingType: BuildingType;
  yearBuilt: number | null;
  firstAdditionYear: number | null;
  secondAdditionYear: number | null;
  squareFeet: number | null;
  roofCondition: Condition | null;
  plumbingCondition: Condition | null;
  hvacCondition: Condition | null;
  boilerCondition: Condition | null;
  hasSprinklers: boolean | null;
  hasFireAlarm: boolean | null;
  hasSecuritySystem: boolean | null;
  isPrimary: boolean;
  notes: string | null;
  retiredOn: string | null;
  retiredReason: RetireReason | null;
  provenance: Provenance;
  rowVersion: number;
}

export interface AppraisalRow {
  id: string;
  buildingId: string;
  assessedYear: number;
  amountCents: number;
  notes: string | null;
  provenance: Provenance;
}

export interface InsuranceRow {
  id: string;
  policyYear: number;
  carrier: string | null;
  policyNumber: string | null;
  policyExpiresOn: string | null;
  recentClaims: boolean | null;
  poolInterest: boolean | null;
  notes: string | null;
  provenance: Provenance;
  rowVersion: number;
}

export interface LoanRow {
  id: string;
  buildingId: string | null;
  kind: LoanKind;
  lender: string | null;
  originalAmountCents: number | null;
  currentBalanceCents: number | null;
  balanceAsOf: string | null;
  grantsAmountCents: number | null;
  guaranteeNote: string | null;
  notes: string | null;
  status: LoanStatus;
  paidOffOn: string | null;
  provenance: Provenance;
  rowVersion: number;
}

// ---------------------------------------------------------------------------
// The shared transaction shapes
// ---------------------------------------------------------------------------

/**
 * One transaction: the section's own key, then the congregation, then the read.
 * Exported for `photo-reads.ts`, which reads the photo table under the same key
 * order. `read` returns null for "no such row under this congregation", which is the
 * same `not_found` as a congregation that is not ours.
 */
export async function readUnder<T>(
  viewer: OversightViewer,
  key: string,
  aboutOrgId: string,
  read: (tx: OrgTx) => Promise<T | null>,
): Promise<OversightRead<T>> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const [held] = await holdsPermissions(tx, viewer, [key]);
    if (!held) return { kind: "forbidden" } as const;
    if (!(await resolveMemberCongregation(tx, viewer.organizationId, aboutOrgId))) return { kind: "not_found" } as const;
    const data = await read(tx);
    return data === null ? ({ kind: "not_found" } as const) : ({ kind: "ok", data } as const);
  });
}

/** The organization's local date (`YYYY-MM-DD`): for "Expired" and the future-date rules. `now` is injectable for tests. */
export async function readTodayInOrg(tx: OrgTx, organizationId: string, now: Date = new Date()): Promise<string> {
  return todayInOrgZone(now, await orgTimeZoneInTx(tx, organizationId));
}

/**
 * The `{ year, today }` a form page injects into its zod schema (the pure
 * validators never read a clock). The organization's local calendar day and its
 * year. Reads no record and no key: a page calls it only after a section reader
 * has already answered `ok`, to colour a form's own client-side checks.
 */
export async function readFormEnv(
  viewer: OversightViewer,
  now: Date = new Date(),
): Promise<{ year: number; today: string }> {
  const today = await withOrgContext(viewer.personId, viewer.organizationId, (tx) =>
    readTodayInOrg(tx, viewer.organizationId, now),
  );
  return { year: Number(today.slice(0, 4)), today };
}

// ---------------------------------------------------------------------------
// Access (the front door)
// ---------------------------------------------------------------------------

export interface OversightAccess {
  manage: boolean;
  finance: boolean;
  /** Present only when a congregation id was given and it is a member of this presbytery. */
  congregation: MemberCongregation | null;
}

/**
 * Which of the two keys the viewer holds. Neither key is `forbidden` BEFORE the
 * congregation is resolved (no existence leak); a key and a congregation that is
 * not ours is `not_found`.
 */
export async function readOversightAccess(
  viewer: OversightViewer,
  aboutOrgId?: string,
): Promise<OversightRead<OversightAccess>> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const [manage, finance] = await holdsPermissions(tx, viewer, [OVERSIGHT_MANAGE_KEY, OVERSIGHT_FINANCE_KEY]);
    if (!manage && !finance) return { kind: "forbidden" } as const;
    if (aboutOrgId === undefined) return { kind: "ok", data: { manage: !!manage, finance: !!finance, congregation: null } } as const;
    const congregation = await resolveMemberCongregation(tx, viewer.organizationId, aboutOrgId);
    if (!congregation) return { kind: "not_found" } as const;
    return { kind: "ok", data: { manage: !!manage, finance: !!finance, congregation } } as const;
  });
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export interface OversightListRow {
  organizationId: string;
  name: string;
  platformStatus: string;
  /** Present only for a viewer holding `congregation_oversight.manage` (tier 1). Absent, not null, otherwise. */
  manage?: {
    viabilityScore: number | null;
    /** The assessment row's update time (ISO), or null when there is no assessment. */
    assessmentUpdatedAt: string | null;
    city: string | null;
    county: string | null;
    /** Live, not retired. */
    buildingsInUse: number;
    /** Live and retired (a removed building is in neither figure). Lets the cell say "None in use" rather than "Not recorded". */
    buildingsRetired: number;
  };
  /** Present only for a viewer holding `congregation_oversight.finance` (tier 2). Absent, not null, otherwise. */
  finance?: {
    /** The NEWEST policy year's expiry (T8), or null. */
    insuranceExpiresOn: string | null;
  };
}

export interface OversightList {
  manage: boolean;
  finance: boolean;
  /** The organization's local date; only read for a finance holder (null otherwise). */
  today: string | null;
  rows: OversightListRow[];
}

/**
 * The list: either key opens it, and each column follows its own key. The
 * roster is `parent_id` plus type `congregation` with NO lifecycle filter (R9,
 * F453): a closed congregation still under the presbytery stays reachable; one
 * that departed (its `parent_id` moved) is not here. A FIXED number of queries
 * regardless of the roster size (the key check, the roster, then one grouped
 * read per held tier), pinned by `reads.db.test.ts`.
 */
export async function readOversightList(viewer: OversightViewer, now: Date = new Date()): Promise<OversightRead<OversightList>> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const [manage, finance] = await holdsPermissions(tx, viewer, [OVERSIGHT_MANAGE_KEY, OVERSIGHT_FINANCE_KEY]);
    if (!manage && !finance) return { kind: "forbidden" } as const;

    const roster = await listMemberCongregations(tx, viewer.organizationId);
    const org = viewer.organizationId;

    const assessments = new Map<string, { viabilityScore: number | null; updatedAt: Date | null }>();
    const profiles = new Map<string, { city: string | null; county: string | null }>();
    const buildingCounts = new Map<string, { inUse: number; retired: number }>();
    if (manage) {
      // Explicit columns (F454): the superseded carrier and expiry are never selected.
      const legacy = await tx
        .select({
          aboutOrgId: congregationOversight.aboutOrgId,
          viabilityScore: congregationOversight.viabilityScore,
          updatedAt: congregationOversight.updatedAt,
        })
        .from(congregationOversight)
        .where(eq(congregationOversight.organizationId, org));
      for (const row of legacy) assessments.set(row.aboutOrgId, { viabilityScore: row.viabilityScore, updatedAt: row.updatedAt });

      const profileRows = await tx
        .select({ aboutOrgId: oversightProfiles.aboutOrgId, city: oversightProfiles.city, county: oversightProfiles.county })
        .from(oversightProfiles)
        .where(eq(oversightProfiles.organizationId, org));
      for (const row of profileRows) profiles.set(row.aboutOrgId, { city: row.city, county: row.county });

      const counts = await tx
        .select({
          aboutOrgId: oversightBuildings.aboutOrgId,
          inUse: sql<number>`(count(*) filter (where ${oversightBuildings.retiredOn} is null))::int`,
          retired: sql<number>`(count(*) filter (where ${oversightBuildings.retiredOn} is not null))::int`,
        })
        .from(oversightBuildings)
        .where(and(eq(oversightBuildings.organizationId, org), isNull(oversightBuildings.removedAt)))
        .groupBy(oversightBuildings.aboutOrgId);
      for (const row of counts) buildingCounts.set(row.aboutOrgId, { inUse: Number(row.inUse), retired: Number(row.retired) });
    }

    const expiries = new Map<string, string | null>();
    let today: string | null = null;
    if (finance) {
      today = await readTodayInOrg(tx, org, now);
      const newest = await tx
        .selectDistinctOn([oversightInsuranceYears.aboutOrgId], {
          aboutOrgId: oversightInsuranceYears.aboutOrgId,
          policyExpiresOn: oversightInsuranceYears.policyExpiresOn,
        })
        .from(oversightInsuranceYears)
        .where(and(eq(oversightInsuranceYears.organizationId, org), isNull(oversightInsuranceYears.removedAt)))
        .orderBy(oversightInsuranceYears.aboutOrgId, desc(oversightInsuranceYears.policyYear));
      for (const row of newest) expiries.set(row.aboutOrgId, row.policyExpiresOn);
    }

    const rows: OversightListRow[] = roster.map((cong) => {
      const row: OversightListRow = { organizationId: cong.id, name: cong.name, platformStatus: cong.platformStatus };
      if (manage) {
        const assessment = assessments.get(cong.id);
        const profile = profiles.get(cong.id);
        row.manage = {
          viabilityScore: assessment?.viabilityScore ?? null,
          assessmentUpdatedAt: assessment?.updatedAt ? assessment.updatedAt.toISOString() : null,
          city: profile?.city ?? null,
          county: profile?.county ?? null,
          buildingsInUse: buildingCounts.get(cong.id)?.inUse ?? 0,
          buildingsRetired: buildingCounts.get(cong.id)?.retired ?? 0,
        };
      }
      if (finance) row.finance = { insuranceExpiresOn: expiries.get(cong.id) ?? null };
      return row;
    });
    return { kind: "ok", data: { manage: !!manage, finance: !!finance, today, rows } } as const;
  });
}

// ---------------------------------------------------------------------------
// Tier 1: profile and buildings
// ---------------------------------------------------------------------------

/** The profile, or `null` data when none is recorded yet (the create form), with its `rowVersion`. */
export function readProfile(viewer: OversightViewer, aboutOrgId: string): Promise<OversightRead<{ profile: ProfileRow | null }>> {
  return readUnder(viewer, OVERSIGHT_MANAGE_KEY, aboutOrgId, async (tx) => {
    const [row] = await tx
      .select({
        id: oversightProfiles.id,
        streetAddress: oversightProfiles.streetAddress,
        city: oversightProfiles.city,
        county: oversightProfiles.county,
        yearOrganized: oversightProfiles.yearOrganized,
        phone: oversightProfiles.phone,
        provenance: oversightProfiles.provenance,
        rowVersion: oversightProfiles.rowVersion,
      })
      .from(oversightProfiles)
      .where(and(eq(oversightProfiles.organizationId, viewer.organizationId), eq(oversightProfiles.aboutOrgId, aboutOrgId)));
    return { profile: row ?? null };
  });
}

const buildingColumns = {
  id: oversightBuildings.id,
  name: oversightBuildings.name,
  buildingType: oversightBuildings.buildingType,
  yearBuilt: oversightBuildings.yearBuilt,
  firstAdditionYear: oversightBuildings.firstAdditionYear,
  secondAdditionYear: oversightBuildings.secondAdditionYear,
  squareFeet: oversightBuildings.squareFeet,
  roofCondition: oversightBuildings.roofCondition,
  plumbingCondition: oversightBuildings.plumbingCondition,
  hvacCondition: oversightBuildings.hvacCondition,
  boilerCondition: oversightBuildings.boilerCondition,
  hasSprinklers: oversightBuildings.hasSprinklers,
  hasFireAlarm: oversightBuildings.hasFireAlarm,
  hasSecuritySystem: oversightBuildings.hasSecuritySystem,
  isPrimary: oversightBuildings.isPrimary,
  notes: oversightBuildings.notes,
  retiredOn: oversightBuildings.retiredOn,
  retiredReason: oversightBuildings.retiredReason,
  provenance: oversightBuildings.provenance,
  rowVersion: oversightBuildings.rowVersion,
} as const;

export interface BuildingsData {
  /** Live buildings, retired included, removed not: the primary first, then by name. */
  buildings: BuildingRow[];
  inUse: number;
  retired: number;
}

export function readBuildings(viewer: OversightViewer, aboutOrgId: string): Promise<OversightRead<BuildingsData>> {
  return readUnder(viewer, OVERSIGHT_MANAGE_KEY, aboutOrgId, async (tx) => {
    const buildings = await tx
      .select(buildingColumns)
      .from(oversightBuildings)
      .where(
        and(
          eq(oversightBuildings.organizationId, viewer.organizationId),
          eq(oversightBuildings.aboutOrgId, aboutOrgId),
          isNull(oversightBuildings.removedAt),
        ),
      )
      .orderBy(desc(oversightBuildings.isPrimary), asc(oversightBuildings.name), asc(oversightBuildings.id));
    const retired = buildings.filter((b) => b.retiredOn !== null).length;
    return { buildings, inUse: buildings.length - retired, retired };
  });
}

/** One live building under `(presbytery, congregation)`, or `not_found`. */
export function readBuilding(viewer: OversightViewer, aboutOrgId: string, buildingId: string): Promise<OversightRead<BuildingRow>> {
  return readUnder(viewer, OVERSIGHT_MANAGE_KEY, aboutOrgId, async (tx) => {
    const [row] = await tx
      .select(buildingColumns)
      .from(oversightBuildings)
      .where(
        and(
          eq(oversightBuildings.id, buildingId),
          eq(oversightBuildings.organizationId, viewer.organizationId),
          eq(oversightBuildings.aboutOrgId, aboutOrgId),
          isNull(oversightBuildings.removedAt),
        ),
      );
    return row ?? null;
  });
}

// ---------------------------------------------------------------------------
// Tier 2: appraisals, insurance, loans
// ---------------------------------------------------------------------------

export interface AppraisalsData {
  /** Live appraisals of one live building, newest year first. */
  appraisals: AppraisalRow[];
  /** The id of the "Current" one (the newest assessed year), or null. */
  latestId: string | null;
}

export function readAppraisals(viewer: OversightViewer, aboutOrgId: string, buildingId: string): Promise<OversightRead<AppraisalsData>> {
  return readUnder(viewer, OVERSIGHT_FINANCE_KEY, aboutOrgId, async (tx) => {
    const [building] = await tx
      .select({ id: oversightBuildings.id })
      .from(oversightBuildings)
      .where(
        and(
          eq(oversightBuildings.id, buildingId),
          eq(oversightBuildings.organizationId, viewer.organizationId),
          eq(oversightBuildings.aboutOrgId, aboutOrgId),
          isNull(oversightBuildings.removedAt),
        ),
      );
    if (!building) return null;
    const appraisals = await tx
      .select({
        id: oversightBuildingAppraisals.id,
        buildingId: oversightBuildingAppraisals.buildingId,
        assessedYear: oversightBuildingAppraisals.assessedYear,
        amountCents: oversightBuildingAppraisals.amountCents,
        notes: oversightBuildingAppraisals.notes,
        provenance: oversightBuildingAppraisals.provenance,
      })
      .from(oversightBuildingAppraisals)
      .where(
        and(
          eq(oversightBuildingAppraisals.organizationId, viewer.organizationId),
          eq(oversightBuildingAppraisals.aboutOrgId, aboutOrgId),
          eq(oversightBuildingAppraisals.buildingId, buildingId),
          isNull(oversightBuildingAppraisals.removedAt),
        ),
      )
      .orderBy(desc(oversightBuildingAppraisals.assessedYear), asc(oversightBuildingAppraisals.id));
    return { appraisals, latestId: latestAppraisal(appraisals)?.id ?? null };
  });
}

const insuranceColumns = {
  id: oversightInsuranceYears.id,
  policyYear: oversightInsuranceYears.policyYear,
  carrier: oversightInsuranceYears.carrier,
  policyNumber: oversightInsuranceYears.policyNumber,
  policyExpiresOn: oversightInsuranceYears.policyExpiresOn,
  recentClaims: oversightInsuranceYears.recentClaims,
  poolInterest: oversightInsuranceYears.poolInterest,
  notes: oversightInsuranceYears.notes,
  provenance: oversightInsuranceYears.provenance,
  rowVersion: oversightInsuranceYears.rowVersion,
} as const;

export interface InsuranceData {
  /** Live policy years, newest first. */
  years: InsuranceRow[];
  /** The organization's local date, for "Expired". */
  today: string;
}

export function readInsuranceYears(viewer: OversightViewer, aboutOrgId: string, now: Date = new Date()): Promise<OversightRead<InsuranceData>> {
  return readUnder(viewer, OVERSIGHT_FINANCE_KEY, aboutOrgId, async (tx) => {
    const years = await tx
      .select(insuranceColumns)
      .from(oversightInsuranceYears)
      .where(
        and(
          eq(oversightInsuranceYears.organizationId, viewer.organizationId),
          eq(oversightInsuranceYears.aboutOrgId, aboutOrgId),
          isNull(oversightInsuranceYears.removedAt),
        ),
      )
      .orderBy(desc(oversightInsuranceYears.policyYear), asc(oversightInsuranceYears.id));
    return { years, today: await readTodayInOrg(tx, viewer.organizationId, now) };
  });
}

export function readInsuranceYear(viewer: OversightViewer, aboutOrgId: string, recordId: string): Promise<OversightRead<InsuranceRow>> {
  return readUnder(viewer, OVERSIGHT_FINANCE_KEY, aboutOrgId, async (tx) => {
    const [row] = await tx
      .select(insuranceColumns)
      .from(oversightInsuranceYears)
      .where(
        and(
          eq(oversightInsuranceYears.id, recordId),
          eq(oversightInsuranceYears.organizationId, viewer.organizationId),
          eq(oversightInsuranceYears.aboutOrgId, aboutOrgId),
          isNull(oversightInsuranceYears.removedAt),
        ),
      );
    return row ?? null;
  });
}

const loanColumns = {
  id: oversightLoans.id,
  buildingId: oversightLoans.buildingId,
  kind: oversightLoans.kind,
  lender: oversightLoans.lender,
  originalAmountCents: oversightLoans.originalAmountCents,
  currentBalanceCents: oversightLoans.currentBalanceCents,
  balanceAsOf: oversightLoans.balanceAsOf,
  grantsAmountCents: oversightLoans.grantsAmountCents,
  guaranteeNote: oversightLoans.guaranteeNote,
  notes: oversightLoans.notes,
  status: oversightLoans.status,
  paidOffOn: oversightLoans.paidOffOn,
  provenance: oversightLoans.provenance,
  rowVersion: oversightLoans.rowVersion,
} as const;

/** Live loans: open first, then paid off; within each, newest first. */
export function readLoans(viewer: OversightViewer, aboutOrgId: string): Promise<OversightRead<{ loans: LoanRow[] }>> {
  return readUnder(viewer, OVERSIGHT_FINANCE_KEY, aboutOrgId, async (tx) => {
    const loans = await tx
      .select(loanColumns)
      .from(oversightLoans)
      .where(
        and(
          eq(oversightLoans.organizationId, viewer.organizationId),
          eq(oversightLoans.aboutOrgId, aboutOrgId),
          isNull(oversightLoans.removedAt),
        ),
      )
      // 'open' sorts before 'paid_off'.
      .orderBy(asc(oversightLoans.status), desc(oversightLoans.createdAt), asc(oversightLoans.id));
    return { loans };
  });
}

export function readLoan(viewer: OversightViewer, aboutOrgId: string, loanId: string): Promise<OversightRead<LoanRow>> {
  return readUnder(viewer, OVERSIGHT_FINANCE_KEY, aboutOrgId, async (tx) => {
    const [row] = await tx
      .select(loanColumns)
      .from(oversightLoans)
      .where(
        and(
          eq(oversightLoans.id, loanId),
          eq(oversightLoans.organizationId, viewer.organizationId),
          eq(oversightLoans.aboutOrgId, aboutOrgId),
          isNull(oversightLoans.removedAt),
        ),
      );
    return row ?? null;
  });
}
