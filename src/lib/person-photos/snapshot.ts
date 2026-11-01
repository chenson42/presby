import type { PhotoStateSnapshot } from "./consequences";
import type { DirectoryStatus, ListingKind, Purpose, WebsiteStatus, Withheld } from "./types";

/**
 * What the photos page KNOWS about one person, built from the raw SQL answers and nothing else
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 5 run 3, R-e4). PURE: type imports only, no
 * `server-only`, no database. `reader.ts` runs the queries (`loadAnswers`) and calls this; the
 * parity test (`outcome-parity.db.test.ts`) runs the SAME two steps and compares the result with the
 * test world it seeded, so the page's idea of "what I can read" is pinned to the real queries.
 */

type Row = Record<string, unknown> | undefined;

/** One active (not ended) designation row of the person at this organization. */
export interface ActiveDesignation {
  photoId: string;
  purpose: Purpose;
  /** `public_attested_at`: non-null means the designation carries the website attestation. */
  attested: Date | string | null;
}

/** The raw answers of one read: every query `readPhotoSet` makes about a person's state. */
export interface PhotoAnswers {
  designations: ActiveDesignation[];
  /** The first row of `presby_person_directory_photo(org, person)`; undefined when it returned none. */
  dirRow: Row;
  /** The first row of `presby_person_public_photo_status(person)`; undefined when it returned none. */
  webRow: Row;
  /** `presby_photo_subject_is_minor`. */
  isMinor: boolean;
  /** The person's open public listings. */
  listings: ListingKind[];
}

const asNullableString = (v: unknown): string | null => (typeof v === "string" ? v : null);

export interface Statuses {
  directoryActive: ActiveDesignation | null;
  websiteActive: ActiveDesignation | null;
  directory: DirectoryStatus;
  website: WebsiteStatus;
}

/** The directory and website answers in the page's own types, plus the two active designations. */
export function statusesOf(a: PhotoAnswers): Statuses {
  const directoryActive = a.designations.find((d) => d.purpose === "directory") ?? null;
  const websiteActive = a.designations.find((d) => d.purpose === "website") ?? null;
  const directory: DirectoryStatus = {
    photoId: asNullableString(a.dirRow?.photo_id),
    thumbKey: asNullableString(a.dirRow?.thumb_key),
    withheld: (asNullableString(a.dirRow?.withheld) as DirectoryStatus["withheld"]) ?? null,
  };
  const website: WebsiteStatus = {
    imageKey: asNullableString(a.webRow?.image_key),
    source: (asNullableString(a.webRow?.source) as WebsiteStatus["source"]) ?? null,
    withheld: (asNullableString(a.webRow?.withheld) as Withheld | null) ?? null,
    unattestedDirectoryOnly: websiteActive === null && directoryActive !== null && directoryActive.attested === null,
  };
  return { directoryActive, websiteActive, directory, website };
}

/**
 * The state the dialogs' consequence sentences are computed from. The two withheld answers exist only
 * while a designation does (the SQL functions start from it), so null here means "none reported",
 * never "none applies".
 */
export function buildSnapshot(first: string, a: PhotoAnswers): PhotoStateSnapshot {
  const { directoryActive, websiteActive, directory, website } = statusesOf(a);
  return {
    first,
    listed: a.listings.length > 0,
    website: websiteActive ? { photoId: websiteActive.photoId } : null,
    directory: directoryActive ? { photoId: directoryActive.photoId, attested: directoryActive.attested !== null } : null,
    minor: a.isMinor,
    directoryWithheld: directory.withheld === "hide_photo" ? "hide_photo" : null,
    websiteWithheld: website.withheld === "hide_photo" || website.withheld === "merged" ? website.withheld : null,
  };
}
