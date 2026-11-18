/**
 * The facts the two presbytery reports read from the congregation records
 * (DECISION-348; docs/work-log/2026-11-17-congregation-profile.md, Phase 3 C15).
 * TYPES ONLY, no runtime code: `report-rows.ts` (the only reader of the tables
 * for a report) returns them, and `presbytery-reports/oversight-derive.ts`
 * (pure) consumes them, so the two modules agree on one shape and neither
 * imports the other's runtime.
 *
 * What is NOT here is the point: no street address, no policy number, no
 * free-text note, no photo, no loan lender. A report fact is a figure or a
 * short closed value, never a free-text note (the one free-text exception is the
 * loan guarantee text, which R7 admits and the CSV passes through the formula
 * guard). Every dollar figure is integer cents.
 */
import type { BuildingType, Condition } from "./contract";

/** The profile's two tier-1 columns a report shows. */
export interface ProfileReportFact {
  aboutOrgId: string;
  city: string | null;
  county: string | null;
}

/** One live, NOT retired building (a retired building is out of use; a removed one is gone). */
export interface BuildingReportFact {
  id: string;
  aboutOrgId: string;
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
}

/** The congregation's NEWEST live policy year (the highest `policyYear`). No policy number, no note. */
export interface InsuranceReportFact {
  aboutOrgId: string;
  policyYear: number;
  carrier: string | null;
  policyExpiresOn: string | null;
  recentClaims: boolean | null;
  poolInterest: boolean | null;
}

/** One live, open loan. Cents or null (not recorded); never a lender, a note, or a balance history. */
export interface OpenLoanReportFact {
  id: string;
  aboutOrgId: string;
  originalAmountCents: number | null;
  currentBalanceCents: number | null;
  grantsAmountCents: number | null;
  guaranteeNote: string | null;
}

/** A live, NOT retired building's id: the denominator of "buildings without an appraisal". */
export interface BuildingRefReportFact {
  id: string;
  aboutOrgId: string;
}

/** The NEWEST live appraisal of one live, not retired building. */
export interface AppraisalReportFact {
  buildingId: string;
  aboutOrgId: string;
  amountCents: number;
}

/** How many live buildings of one congregation are retired (only congregations with at least one appear). */
export interface RetiredCountReportFact {
  aboutOrgId: string;
  retired: number;
}

export interface BuildingsReportFacts {
  profiles: ProfileReportFact[];
  buildings: BuildingReportFact[];
  /** Lets a congregation with no building in use say "None in use" (all retired) rather than "Not recorded". */
  retiredCounts: RetiredCountReportFact[];
}

export interface InsuranceLoansReportFacts {
  insurance: InsuranceReportFact[];
  openLoans: OpenLoanReportFact[];
  buildings: BuildingRefReportFact[];
  appraisals: AppraisalReportFact[];
}
