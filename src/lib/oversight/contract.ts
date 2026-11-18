/**
 * The congregation-records contract (docs/work-log/2026-11-17-congregation-
 * profile.md, Phase 3 "Module and file plan"; DECISION-344, 349). PURE: no
 * runtime imports (one type-only import, erased at build, from a file that has
 * none), so a form, a page, the validators, the store and the tests all read
 * the same lists and limits. A client form may import it.
 *
 * Every closed list and every limit here is pinned against the migration by
 * `contract.test.ts` (parsed out of `drizzle/0089_presby_oversight_records.sql`):
 * a list changed in one place and not the other fails the suite.
 *
 * Every row is THE PRESBYTERY'S OWN RECORD about a member congregation
 * (`organization_id` = the presbytery, `about_org_id` = the congregation).
 * Tiered by table, never by column (R1): tier 1 is `congregation_oversight.manage`
 * (profile, assessment, buildings, photos); tier 2 is
 * `congregation_oversight.finance` (appraisals, insurance years, loans).
 */
import type { ImageRefusal } from "@/lib/storage/image/limits";

/** The two tenant permission keys. Never mapped into `FEATURES.*` (Permissions vs Flags). */
export const OVERSIGHT_MANAGE_KEY = "congregation_oversight.manage";
export const OVERSIGHT_FINANCE_KEY = "congregation_oversight.finance";

export interface Labeled<V extends string> {
  readonly value: V;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Closed lists (the CHECK lists in 0089). Labels are the Copy section's (C5, C8).
// ---------------------------------------------------------------------------

export const BUILDING_TYPES = [
  { value: "sanctuary", label: "Sanctuary" },
  { value: "education_building", label: "Education building" },
  { value: "fellowship_hall", label: "Fellowship hall" },
  { value: "manse", label: "Manse" },
  { value: "parsonage", label: "Parsonage" },
  { value: "office", label: "Office" },
  { value: "vacant_land", label: "Vacant land" },
  { value: "annex", label: "Annex" },
  { value: "gymnasium", label: "Gymnasium" },
  { value: "other", label: "Other" },
] as const satisfies readonly Labeled<string>[];
export type BuildingType = (typeof BUILDING_TYPES)[number]["value"];

/** Null is "not recorded" (T2): the form's empty option, never a stored value. */
export const CONDITIONS = [
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
] as const satisfies readonly Labeled<string>[];
export type Condition = (typeof CONDITIONS)[number]["value"];

export const RETIRE_REASONS = [
  { value: "sold", label: "Sold" },
  { value: "demolished", label: "Demolished" },
  { value: "closed", label: "Closed" },
  { value: "other", label: "Other" },
] as const satisfies readonly Labeled<string>[];
export type RetireReason = (typeof RETIRE_REASONS)[number]["value"];

export const LOAN_KINDS = [
  { value: "presbytery_program", label: "Presbytery program loan" },
  { value: "guaranteed_outside", label: "Guaranteed outside loan" },
  { value: "other", label: "Other loan" },
] as const satisfies readonly Labeled<string>[];
export type LoanKind = (typeof LOAN_KINDS)[number]["value"];

export const LOAN_STATUSES = [
  { value: "open", label: "Open" },
  { value: "paid_off", label: "Paid off" },
] as const satisfies readonly Labeled<string>[];
export type LoanStatus = (typeof LOAN_STATUSES)[number]["value"];

/** `imported` is the owner-run import's alone (the 0089 provenance guard); a tenant write is always `presbytery_entered`. */
export const PROVENANCES = ["presbytery_entered", "imported"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** What a form's Yes / No / Not recorded select submits (T2): the empty string is "not recorded". */
export const TRI_STATE_VALUES = ["", "yes", "no"] as const;
export type TriStateValue = (typeof TRI_STATE_VALUES)[number];

/** Every value in a list, for a membership test. */
export const valuesOf = <V extends string>(list: readonly Labeled<V>[]): readonly V[] => list.map((item) => item.value);

// ---------------------------------------------------------------------------
// Limits (the char_length and range CHECKs in 0089)
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** `normalizeAddress` owns the address's own 500 / 6-line rule (src/lib/site-address.ts). */
  addressMax: 500,
  cityMax: 100,
  countyMax: 100,
  phoneMax: 40,
  /** A year column's DB floor and ceiling; the application's own ceiling is the current year (the validators). */
  yearMin: 1600,
  yearMax: 2100,
  buildingNameMax: 120,
  buildingNotesMax: 4000,
  squareFeetMin: 1,
  squareFeetMax: 5_000_000,
  appraisalNotesMax: 1000,
  /** The insurance policy year has its own, later floor. */
  policyYearMin: 1900,
  policyYearMax: 2100,
  carrierMax: 200,
  policyNumberMax: 100,
  insuranceNotesMax: 2000,
  lenderMax: 200,
  guaranteeNoteMax: 1000,
  loanNotesMax: 2000,
  captionMax: 200,
  /** Live photos per building, counted after the building row is locked (DECISION-346). */
  photoCap: 10,
  /** $1,000,000,000 in integer cents (DECISION-349). */
  moneyMaxCents: 100_000_000_000,
} as const;

// ---------------------------------------------------------------------------
// The closed names an audit row's `changed` array may carry. A field NAME, never a value.
// ---------------------------------------------------------------------------

export const CHANGED_FIELDS = [
  // profile
  "streetAddress",
  "city",
  "county",
  "yearOrganized",
  "phone",
  // building
  "name",
  "buildingType",
  "yearBuilt",
  "firstAdditionYear",
  "secondAdditionYear",
  "squareFeet",
  "roofCondition",
  "plumbingCondition",
  "hvacCondition",
  "boilerCondition",
  "hasSprinklers",
  "hasFireAlarm",
  "hasSecuritySystem",
  "primary",
  "notes",
  "retired",
  // insurance
  "carrier",
  "policyNumber",
  "policyExpiresOn",
  "recentClaims",
  "poolInterest",
  // loan
  "kind",
  "lender",
  "originalAmount",
  "currentBalance",
  "balanceAsOf",
  "grantsAmount",
  "guaranteeNote",
  "status",
] as const;
export type ChangedField = (typeof CHANGED_FIELDS)[number];

// ---------------------------------------------------------------------------
// Viewer, context, outcomes
// ---------------------------------------------------------------------------

/** Who is reading: the acting person and the presbytery (never from the client). */
export interface OversightViewer {
  personId: string;
  organizationId: string;
}

/** Who is writing: a viewer plus the acting user, for `created_by`/`updated_by` and the audit row. */
export interface OversightCtx extends OversightViewer {
  /** The acting user, for `created_by` / `updated_by` / `removed_by` and the audit row. */
  actor: { userId: string; email: string | null };
}

/**
 * Why a write was refused. One fixed string per kind (`copy.ts`), never raw
 * database text. `invalid` is the only kind that carries a field.
 */
export type Refusal =
  | "forbidden"
  | "not_found"
  | "duplicate_name"
  | "duplicate_policy_year"
  | "duplicate_appraisal_year"
  | "stale"
  | "already_retired"
  | "not_retired"
  | "already_paid_off"
  | "not_paid_off"
  | "building_removed"
  | "save_failed";

export type Outcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "refused"; reason: Refusal }
  | { kind: "invalid"; field: string; message: string };

/** What a store write returns on success: the row's id and whether anything was written. */
export interface Written {
  id: string;
  /** True when the edit changed nothing: nothing was written and nothing was audited. */
  unchanged?: true;
}

/**
 * Why a photo write was refused (Increment 2, copy C14). The six image kinds are
 * `ImageRefusal` from the shared pipeline (`src/lib/storage/image/limits.ts`);
 * every kind has one fixed string in `copy.ts` (`PHOTO_REFUSAL`), never raw
 * error text. `feature_off` is the global `org_portal.oversight` toggle being off
 * when an action arrives: it is worded as `not_found`, because with the toggle
 * off the surface does not exist.
 */
export type PhotoRefusal =
  | ImageRefusal
  | "forbidden"
  | "not_found"
  | "building_removed"
  | "duplicate"
  | "cap_reached"
  | "already_removed"
  | "save_failed";

export type PhotoOutcome<T> = { kind: "ok"; data: T } | { kind: "refused"; reason: PhotoRefusal };

/** What a photo write returns on success. */
export interface PhotoWritten {
  /** The photo's id. */
  id: string;
  /** True when the call changed nothing (same caption, already the cover): nothing was written or audited. */
  unchanged?: true;
}

/** What a read returns (the shape `presbytery-reports` uses, plus `not_found`). */
export type OversightRead<T> = { kind: "ok"; data: T } | { kind: "forbidden" } | { kind: "not_found" };

// ---------------------------------------------------------------------------
// What a Server Action returns (a superset of `ActionResult<{ id: string }>`)
// ---------------------------------------------------------------------------

/** The success payload of an oversight action: the row id plus which toast to show. */
export interface ActionData extends Written {
  /** `setProfileAction`: the profile was created (otherwise edited). */
  created?: boolean;
  /** `updateLoanAction`: a paid-off loan went back to open ("Loan reopened."). */
  reopened?: true;
}

/**
 * `{ ok: true, data }` or `{ ok: false, error }`, exactly `ActionResult`'s shape,
 * plus two optional extras a form may use: `field` (an `invalid` message belongs
 * under that field) and `kind` (why). `error` is always one fixed `copy.ts`
 * string, never database text.
 */
export type OversightActionResult =
  | { ok: true; data?: ActionData }
  | {
      ok: false;
      error: string;
      field?: string;
      kind?: Refusal | "invalid" | "unauthenticated" | "two_factor_required";
    };

/** The success payload of a photo action: the photo's id, plus whether the upload took the cover. */
export interface PhotoActionData extends PhotoWritten {
  /** `addBuildingPhotoAction`: the new photo became the building's cover. */
  cover?: boolean;
}

/**
 * What a photo Server Action returns: `ActionResult`'s shape, plus `kind` (why)
 * and, for a caption that fails its rule, `field: "caption"`. `error` is always
 * one fixed `copy.ts` string, never database text.
 */
export type PhotoActionResult =
  | { ok: true; data: PhotoActionData }
  | {
      ok: false;
      error: string;
      field?: string;
      kind?: PhotoRefusal | Refusal | "invalid" | "unauthenticated" | "two_factor_required";
    };
