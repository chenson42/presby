import { DIRECTORY_LINES, WEBSITE_LINES, listingLine } from "./copy";
import type { DirectoryStatus, ListingKind, WebsiteStatus } from "./types";

/**
 * The photos page's "Where photos show" lines, derived from the SQL answers
 * `reader.ts` read (docs/work-log/2026-10-26-person-photos-inc1.md, Copy C2).
 * PURE. The inputs are the OUTPUT of `presby_person_directory_photo()` and
 * `presby_person_public_photo_status()` (the same definer core the public roster
 * projects), so this file decides nothing about visibility: it only chooses the
 * sentence that describes an answer the database already gave. A `null` line
 * means "do not render one" (the toggle is off: the page shows its own off
 * state and never reaches here).
 */

export function directoryLine(first: string, status: DirectoryStatus): string | null {
  switch (status.withheld) {
    case "toggle_off":
      return null;
    case "hide_photo":
      return DIRECTORY_LINES.hide(first);
    case "minor":
      return DIRECTORY_LINES.minor(first);
    case null:
      return status.photoId === null ? DIRECTORY_LINES.none : DIRECTORY_LINES.shown;
  }
}

export function websiteLine(first: string, status: WebsiteStatus): string | null {
  switch (status.withheld) {
    case "toggle_off":
      return null;
    case "hide_photo":
      return WEBSITE_LINES.hide(first);
    case "minor":
      return WEBSITE_LINES.minor(first);
    case "merged":
      return WEBSITE_LINES.merged;
    case null:
      break;
  }
  if (status.source === "website") return WEBSITE_LINES.website;
  if (status.source === "directory_attested") return WEBSITE_LINES.fallback;
  // No eligible designation. The one case with a remedy: a directory photo exists but was
  // never cleared for the website, and no website photo is chosen.
  return status.unattestedDirectoryOnly ? WEBSITE_LINES.unattested : WEBSITE_LINES.none;
}

export interface StatusLines {
  directory: string | null;
  website: string | null;
  listing: string;
}

export function statusLines(input: {
  first: string;
  directory: DirectoryStatus;
  website: WebsiteStatus;
  listings: readonly ListingKind[];
}): StatusLines {
  return {
    directory: directoryLine(input.first, input.directory),
    website: websiteLine(input.first, input.website),
    listing: listingLine(input.first, input.listings),
  };
}
