import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import {
  oversightBuildingAppraisals,
  oversightBuildings,
  oversightInsuranceYears,
  oversightLoans,
  oversightProfiles,
} from "@/lib/db/domain/oversight";
import type { BuildingsReportFacts, InsuranceLoansReportFacts } from "./report-facts";

/**
 * The two presbytery reports' reads of the congregation records (DECISION-348;
 * docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "Module and file
 * plan"). The report readers in `src/lib/presbytery-reports/` call these inside
 * THEIR OWN `withOrgContext()` transaction, so the table names stay in this
 * module (R4, `boundaries.test.ts`) and one transaction serves the page and the
 * CSV (DECISION-337, 339).
 *
 * THE CALLER CHECKS THE KEY, inside the same transaction, before calling
 * (`congregation_oversight.manage` for buildings, `.finance` for insurance and
 * loans): these functions are plain reads and decide nothing about authority.
 * RLS fences every statement to the presbytery's own rows (`organization_id`);
 * the congregation list is the active roster the caller passes, so a row about
 * a congregation that has since left or closed never enters a report.
 *
 * Read-only, and each statement names its columns: no street address, no
 * policy number, no free-text note, no photo and no lender is ever selected, so
 * a later edit to a report cannot leak one by accident (`boundaries.test.ts`
 * scans this file for them). A FIXED number of queries (two for buildings, four
 * for insurance and loans) whatever the roster size.
 *
 * "Live" means `removed_at is null`. A building that is RETIRED (sold,
 * demolished, closed) is out of use and is not in either report: not in the
 * Buildings rows, and neither its appraisal nor its absence counts in the
 * appraised value. A paid-off loan is not an open loan.
 */

/** Buildings report: the profile's city and county, and every in-use building, for the given congregations. */
export async function readBuildingsReportFacts(
  tx: OrgTx,
  organizationId: string,
  aboutOrgIds: readonly string[],
): Promise<BuildingsReportFacts> {
  if (aboutOrgIds.length === 0) return { profiles: [], buildings: [] };
  const ids = [...aboutOrgIds];

  const profiles = await tx
    .select({
      aboutOrgId: oversightProfiles.aboutOrgId,
      city: oversightProfiles.city,
      county: oversightProfiles.county,
    })
    .from(oversightProfiles)
    .where(and(eq(oversightProfiles.organizationId, organizationId), inArray(oversightProfiles.aboutOrgId, ids)));

  const buildings = await tx
    .select({
      id: oversightBuildings.id,
      aboutOrgId: oversightBuildings.aboutOrgId,
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
    })
    .from(oversightBuildings)
    .where(
      and(
        eq(oversightBuildings.organizationId, organizationId),
        inArray(oversightBuildings.aboutOrgId, ids),
        isNull(oversightBuildings.removedAt),
        isNull(oversightBuildings.retiredOn),
      ),
    )
    .orderBy(asc(oversightBuildings.aboutOrgId), asc(oversightBuildings.name), asc(oversightBuildings.id));

  return { profiles, buildings };
}

/**
 * Insurance and loans report: each congregation's newest live policy year, its open live loans,
 * its in-use buildings and each one's newest live appraisal.
 */
export async function readInsuranceLoansReportFacts(
  tx: OrgTx,
  organizationId: string,
  aboutOrgIds: readonly string[],
): Promise<InsuranceLoansReportFacts> {
  if (aboutOrgIds.length === 0) return { insurance: [], openLoans: [], buildings: [], appraisals: [] };
  const ids = [...aboutOrgIds];

  // The newest policy year per congregation (T8): the highest `policy_year` among live rows.
  const insurance = await tx
    .selectDistinctOn([oversightInsuranceYears.aboutOrgId], {
      aboutOrgId: oversightInsuranceYears.aboutOrgId,
      policyYear: oversightInsuranceYears.policyYear,
      carrier: oversightInsuranceYears.carrier,
      policyExpiresOn: oversightInsuranceYears.policyExpiresOn,
      recentClaims: oversightInsuranceYears.recentClaims,
      poolInterest: oversightInsuranceYears.poolInterest,
    })
    .from(oversightInsuranceYears)
    .where(
      and(
        eq(oversightInsuranceYears.organizationId, organizationId),
        inArray(oversightInsuranceYears.aboutOrgId, ids),
        isNull(oversightInsuranceYears.removedAt),
      ),
    )
    .orderBy(oversightInsuranceYears.aboutOrgId, desc(oversightInsuranceYears.policyYear));

  const openLoans = await tx
    .select({
      id: oversightLoans.id,
      aboutOrgId: oversightLoans.aboutOrgId,
      originalAmountCents: oversightLoans.originalAmountCents,
      currentBalanceCents: oversightLoans.currentBalanceCents,
      grantsAmountCents: oversightLoans.grantsAmountCents,
      guaranteeNote: oversightLoans.guaranteeNote,
    })
    .from(oversightLoans)
    .where(
      and(
        eq(oversightLoans.organizationId, organizationId),
        inArray(oversightLoans.aboutOrgId, ids),
        isNull(oversightLoans.removedAt),
        eq(oversightLoans.status, "open"),
      ),
    )
    .orderBy(asc(oversightLoans.aboutOrgId), asc(oversightLoans.createdAt), asc(oversightLoans.id));

  const buildings = await tx
    .select({ id: oversightBuildings.id, aboutOrgId: oversightBuildings.aboutOrgId })
    .from(oversightBuildings)
    .where(
      and(
        eq(oversightBuildings.organizationId, organizationId),
        inArray(oversightBuildings.aboutOrgId, ids),
        isNull(oversightBuildings.removedAt),
        isNull(oversightBuildings.retiredOn),
      ),
    )
    .orderBy(asc(oversightBuildings.aboutOrgId), asc(oversightBuildings.id));

  // The newest live appraisal of each in-use building (the join keeps a retired or removed building out).
  const appraisals = await tx
    .selectDistinctOn([oversightBuildingAppraisals.buildingId], {
      buildingId: oversightBuildingAppraisals.buildingId,
      aboutOrgId: oversightBuildingAppraisals.aboutOrgId,
      amountCents: oversightBuildingAppraisals.amountCents,
    })
    .from(oversightBuildingAppraisals)
    .innerJoin(
      oversightBuildings,
      and(
        eq(oversightBuildings.id, oversightBuildingAppraisals.buildingId),
        eq(oversightBuildings.organizationId, oversightBuildingAppraisals.organizationId),
      ),
    )
    .where(
      and(
        eq(oversightBuildingAppraisals.organizationId, organizationId),
        inArray(oversightBuildingAppraisals.aboutOrgId, ids),
        isNull(oversightBuildingAppraisals.removedAt),
        isNull(oversightBuildings.removedAt),
        isNull(oversightBuildings.retiredOn),
      ),
    )
    .orderBy(oversightBuildingAppraisals.buildingId, desc(oversightBuildingAppraisals.assessedYear));

  return { insurance, openLoans, buildings, appraisals };
}
