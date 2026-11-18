/**
 * Every user-visible string this module produces (docs/work-log/2026-11-17-
 * congregation-profile.md, Phase 3 "Copy", C1 to C9). PURE: no imports, so a
 * form, a page, the validators and the tests read one file. A string that is
 * not in the design's Copy section does not belong here: it stops for a ruling.
 *
 * What no string below may deny (the Phase 2 record, "Accepted residuals no
 * string may deny"): reads are not audited, only writes (DECISION-345); a
 * congregation that departed the presbytery becomes unreachable here while its
 * rows stay (F453); the superseded carrier and expiry columns stay in the table,
 * visible to nobody (R8); an imported row stays marked imported after an edit.
 * Nothing here says "everything is recorded", "nothing is kept", or "only X can
 * see"; `copy.test.ts` pins it.
 */
import type { PhotoRefusal, Refusal } from "./contract";

// ---------------------------------------------------------------------------
// C9: refusals (one fixed string per kind, never raw database text)
// ---------------------------------------------------------------------------

export const REFUSAL: Record<Exclude<Refusal, "duplicate_appraisal_year">, string> = {
  forbidden: "You don't have permission to do that here.",
  // ONE string for an id that does not exist, belongs to another congregation or
  // another presbytery, or is removed (a prober cannot tell absent from foreign).
  not_found: "That record could not be found.",
  duplicate_name: "A building with that name is already recorded.",
  duplicate_policy_year: "Insurance for that year is already recorded. Edit it instead.",
  stale:
    "This record was changed by someone else after you opened it. Reload the page to see their change, then make yours again.",
  already_retired: "That building is already retired.",
  not_retired: "That building isn't retired.",
  already_paid_off: "That loan is already paid off.",
  not_paid_off: "That loan isn't paid off.",
  building_removed: "That building was removed.",
  save_failed: "We couldn't save that. Nothing was changed.",
};

/** The message for a refusal. `duplicate_appraisal_year` names the year the user typed. */
export function refusalMessage(reason: Refusal, detail: { assessedYear?: number } = {}): string {
  if (reason === "duplicate_appraisal_year") {
    return `An appraisal for ${detail.assessedYear ?? "that year"} is already recorded for this building. Remove it first to record a corrected amount.`;
  }
  return REFUSAL[reason];
}

/** The two answers before a form is read (the existing strings, reused). */
export const GATE_COPY = {
  signedOut: "You must be signed in to do that.",
  noAccess: "You don't have access to that organization.",
} as const;

// ---------------------------------------------------------------------------
// C9: validation messages (each is returned only by the check it names)
// ---------------------------------------------------------------------------

export const VALIDATION = {
  cityTooLong: "City must be 100 characters or fewer.",
  countyTooLong: "County must be 100 characters or fewer.",
  phone: "Phone can have digits, spaces and + ( ) - . x only, up to 40 characters.",
  yearOrganizedFormat: "Year organized must be a four-digit year.",
  yearOrganizedRange: (year: number) => `Year organized must be between 1600 and ${year}.`,

  buildingNameRequired: "Enter a name for the building.",
  buildingNameTooLong: "Name must be 120 characters or fewer.",
  buildingTypeRequired: "Choose a type.",
  yearFormat: (label: string) => `${label} must be a four-digit year.`,
  yearRange: (label: string, year: number) => `${label} must be between 1600 and ${year}.`,
  firstAdditionBeforeBuilt: "The first addition can't be before the year built.",
  secondAdditionBeforeFirst: "The second addition can't be before the first.",
  secondAdditionNeedsFirst: "Enter the first addition before the second.",
  squareFeetFormat: "Square feet must be a whole number of at least 1.",
  squareFeetTooMany: "Square feet can't be more than 5,000,000.",
  conditionNotInList: "Choose a condition from the list.",
  notesTooLong: (max: number) => `Notes must be ${max} characters or fewer.`,
  guaranteeTooLong: "Guarantee must be 1000 characters or fewer.",

  retireReasonRequired: "Choose why this building is retired.",
  dateRequired: "Enter the date.",
  dateInFuture: "The date can't be in the future.",

  assessedYearRequired: "Enter the year assessed.",
  assessedYearRange: (year: number) => `Year assessed must be between 1600 and ${year}.`,
  appraisalAmountRequired: "Enter the appraised amount in dollars.",
  appraisalAmountPositive: "Amount must be more than $0.",

  moneyFormat: "Enter the amount in dollars, for example 1250000 or 1250000.50.",
  moneyTooLarge: "Amount can't be more than $1,000,000,000.",

  policyYearRequired: "Enter the policy year.",
  policyYearRange: (maxYear: number) => `Policy year must be between 1900 and ${maxYear}.`,
  carrierTooLong: "Carrier must be 200 characters or fewer.",
  policyNumberTooLong: "Policy number must be 100 characters or fewer.",
  dateInvalid: "Enter a valid date.",

  loanKindRequired: "Choose the kind of loan.",
  lenderTooLong: "Lender must be 200 characters or fewer.",
  balanceDateRequired: "Enter the date the balance is as of.",
  balanceRequiredForDate: "Enter the balance this date applies to, or clear the date.",
  balanceDateStale: 'Update the "as of" date for the new balance.',

  captionTooLong: "Caption must be 200 characters or fewer.",
} as const;

// ---------------------------------------------------------------------------
// C3 to C8: toasts the forms show on success
// ---------------------------------------------------------------------------

export const TOAST = {
  noChanges: "No changes to save.",
  profileSaved: "Profile saved.",
  assessmentSaved: "Oversight record saved.",
  buildingAdded: "Building added.",
  buildingSaved: "Building saved.",
  buildingRetired: "Building retired.",
  buildingReinstated: "Building brought back into use.",
  buildingRemoved: "Building removed.",
  appraisalRecorded: "Appraisal recorded.",
  appraisalRemoved: "Appraisal removed.",
  insuranceSaved: "Insurance saved.",
  insuranceRemoved: "Insurance removed.",
  loanSaved: "Loan saved.",
  loanPaidOff: "Loan marked paid off.",
  loanReopened: "Loan reopened.",
  loanRemoved: "Loan removed.",
  photoAdded: "Photo added.",
  captionSaved: "Caption saved.",
  coverChanged: "Cover changed.",
  photoRemoved: "Photo removed.",
} as const;

// ---------------------------------------------------------------------------
// C1, C2: the states a page or section renders in place of its content
// ---------------------------------------------------------------------------

export const STATE = {
  lockedBadge: "Locked",
  lockedManage: "You need permission to manage congregation oversight. An administrator can give it under Roles.",
  lockedFinance:
    "You need permission to manage congregation property finances. An administrator can give it under Roles.",
  sectionLoadError: "We couldn't load this section. Try again in a moment.",
  sectionTryAgain: "Try again",
  emptyProfile: "Nothing is recorded in the profile yet.",
  emptyBuildings: "No buildings are recorded for this congregation.",
  emptyInsurance: "No insurance is recorded for this congregation.",
  emptyLoans: "No loans are recorded for this congregation.",
  emptyAppraisals: "No appraisal is recorded for this building.",
  imported: "Imported from an earlier record.",
  notRecorded: "Not recorded",
  noneInUse: "None in use",
  managedNote:
    "This congregation is on PresbyPortal and can keep its own profile there. What you enter here is the presbytery's own copy: it does not change theirs, and theirs does not change it.",
  listNeedsManage:
    "Viability, city and county, and buildings need permission to manage congregation oversight. An administrator can give it under Roles.",
  listNeedsFinance:
    "Insurance needs permission to manage congregation property finances. An administrator can give it under Roles.",
} as const;

// ---------------------------------------------------------------------------
// C14: building photos (Increment 2)
// ---------------------------------------------------------------------------

/**
 * One fixed string per photo refusal kind. The picture refusals are the
 * person-photo strings, worded for a building; `forbidden`, `not_found` and
 * `building_removed` are the module's own (`REFUSAL`), repeated here by
 * reference so a photo action has one table to read.
 *
 * What the strings do not say: the orphaned blob a failed final transaction can
 * leave behind is not mentioned (nobody can act on it), and nothing here claims
 * a removed photo is erased: the remove dialog says the file stays in storage.
 */
export const PHOTO_REFUSAL: Record<PhotoRefusal, string> = {
  unsupported_type:
    "That file isn't a JPEG, PNG or WebP picture. If it's an iPhone photo, pick it from your photo library or convert it to JPEG first.",
  animated: "Animated pictures aren't supported. Choose a still picture.",
  too_many_pixels: "That picture is too large to process. Try a smaller one.",
  too_large: "That picture is too big to upload. Try a smaller one.",
  unreadable: "We couldn't read that picture. Try a different file.",
  empty: "That file is empty.",
  duplicate: "That picture is already in this building's photos.",
  cap_reached: "This building already has 10 photos. Remove one to add another.",
  already_removed: "That photo was already removed.",
  save_failed: "We couldn't save that photo. Nothing was changed. Try again.",
  forbidden: REFUSAL.forbidden,
  not_found: REFUSAL.not_found,
  building_removed: REFUSAL.building_removed,
};

/** The strings the photos page, the larger view and the building's Photos block render (the UI imports this). */
export const PHOTO_COPY = {
  blockHeading: "Photos",
  addPhoto: "Add a photo",
  allPhotos: (count: number) => `All photos (${count})`,
  pageTitle: (buildingName: string) => `Photos of ${buildingName}`,
  backToBuilding: (buildingName: string) => `Back to ${buildingName}`,
  /** The accessible name of a grid tile: its caption, or "photo". */
  viewLarger: (caption: string | null) => `View larger: ${caption ?? "photo"}`,
  editCaption: "Edit caption",
  captionLabel: "Caption (optional)",
  makeCover: "Make this the cover",
  /** The word on the grid tile that is the cover (never colour alone). */
  coverBadge: "Cover",
  /** The caption form's submit and the progress word on it and on the upload button (ratified in B8). */
  saveCaption: "Save caption",
  saving: "Saving…",
  removePhoto: "Remove photo",
  backToAll: "Back to all photos",
  /** The client's own rejection, when the upload fails before the server answers. */
  uploadFailed: "That picture couldn't be uploaded. Check your connection, or try a smaller picture.",
  removeDialog: {
    title: "Remove this photo?",
    body: "It will no longer be listed here. The picture file itself stays in storage and can't be erased from here.",
    confirm: "Remove photo",
    cancel: "Cancel",
  },
} as const;

/** A photo write's refusal as a sentence. */
export const photoRefusalMessage = (reason: PhotoRefusal): string => PHOTO_REFUSAL[reason];
