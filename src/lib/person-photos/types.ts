import type { PhotoStateSnapshot } from "./consequences";
import type { StatusLines } from "./status-lines";
/**
 * Pure types for the person-photos module (docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3 "Library"). No imports from
 * server-only code, so a client island can name them.
 */

/** What a photo is chosen for. Mirrors person_photo_designations_purpose. */
export type Purpose = "directory" | "website";

/**
 * Why a mutation did not happen. Every kind has one fixed user-facing string in
 * `copy.ts` (Copy C6); `copy.test.ts` is exhaustive over this union.
 */
export type PhotoRefusal =
  | "feature_off"
  | "forbidden"
  | "not_found"
  | "minor"
  | "cap_reached"
  | "duplicate"
  | "unsupported_type"
  | "animated"
  | "too_many_pixels"
  | "too_large"
  | "unreadable"
  | "empty"
  | "already_removed"
  | "attestation_required"
  | "save_failed";

/** Why SQL withholds a photo. Priority order is the SQL's (0078 section 5). */
export type Withheld = "toggle_off" | "minor" | "merged" | "hide_photo";

/** The subset of refusals the image pipeline itself can produce. */
export type ImageRefusal = Extract<
  PhotoRefusal,
  "unsupported_type" | "animated" | "too_many_pixels" | "too_large" | "unreadable" | "empty"
>;

/**
 * `first` is the person's preferred or first name, set ONLY on the refusals whose
 * string names them (`minor`, `cap_reached`, `duplicate`; `copy.ts`): they all
 * arise after the membership was found, so it is always there when needed.
 */
export type Refused = { kind: "refused"; reason: PhotoRefusal; first?: string };

/** What a store mutation returns: ok (with any extra fields) or a typed refusal. */
export type MutationResult<T extends object = object> = ({ kind: "ok" } & T) | Refused;

/**
 * Where a person's photo shows on the public website, as the SAME SQL the
 * roster functions project (`presby_person_public_photo_status`).
 * `source`: the website designation, or the directory photo standing in because
 * its designator attested it for the website (DECISION-286).
 */
export interface WebsiteStatus {
  /** The master's key when it would be served; null when none is chosen or it is withheld. */
  imageKey: string | null;
  source: "website" | "directory_attested" | null;
  withheld: Withheld | null;
  /** True when a directory designation exists that is NOT attested and no website photo is chosen. */
  unattestedDirectoryOnly: boolean;
}

/** The directory's answer for this person (`presby_person_directory_photo`). */
export interface DirectoryStatus {
  photoId: string | null;
  thumbKey: string | null;
  withheld: "toggle_off" | "minor" | "hide_photo" | null;
}

/** Which public lists currently list the person (open `public_listed` rows). */
export type ListingKind = "staff" | "officer" | "committee";

export interface PhotoTileView {
  id: string;
  /** `data:` URI of the 160 px thumbnail, or null if it could not be read. */
  thumbSrc: string | null;
  width: number;
  height: number;
  createdAt: string;
  isDirectory: boolean;
  isWebsite: boolean;
  /** The directory designation carries the attestation (the Q6 fallback). */
  directoryAttested: boolean;
}

/**
 * Everything the photos page needs to render one person's set, assembled by
 * `reader.ts` in ONE organization transaction. Statuses come from SQL; nothing
 * here recomputes visibility.
 */
export interface PhotoSetView {
  personId: string;
  displayName: string;
  /** Preferred or first name, for `{first}`. */
  firstName: string;
  organizationName: string;
  photos: PhotoTileView[];
  count: number;
  /** `presby_photo_subject_is_minor`: the add control is disabled and the under-18 notice shows. */
  isMinor: boolean;
  directory: DirectoryStatus;
  website: WebsiteStatus;
  /** Open public listings of this person (empty = not listed). */
  listings: ListingKind[];
  /** The three "Where photos show" lines (Copy C2), chosen from the SQL answers. */
  lines: StatusLines;
  /** The state the dialogs' consequence sentences are computed from (`consequences.ts`). */
  state: PhotoStateSnapshot;
  /** The master of `?view=` when asked for and live, as a `data:` URI. */
  viewed: { photoId: string; src: string } | null;
}
