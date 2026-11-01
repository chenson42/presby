import type { PhotoIntent, PhotoStateSnapshot } from "./consequences";

/**
 * THE OUTCOME MIRROR (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 5 run 3, R-e1). Pure: types
 * from `./consequences` only, no `server-only`, no database, no clock.
 *
 * A consequence sentence is chosen by comparing what the public surfaces show BEFORE a click with what
 * they would show AFTER it (`consequences.ts`). This file computes both from the person's designations
 * and the few facts the SQL reads, as a mirror of:
 *   - `presby_person_public_photo` (0078 section 5c): the active WEBSITE designation, else the active
 *     DIRECTORY designation only if it is attested; withheld for minor, then merged, then hide_photo
 *     (hide read PERSON-WIDE, at any organization);
 *   - `presby_person_directory_photo` (0078 section 5e): the active directory designation only;
 *     withheld for minor, then hide_photo scoped to THIS organization; no `merged` reason;
 *   - the two roster functions on top of the core (`presby_public_staff_roster` and its siblings),
 *     which add `public_listed`, an open term, an active organization and a LIVE site: the gates
 *     `not_listed` and `not_published` below. The core applies neither.
 * The toggle-off state is not mirrored: the page does not render when the toggle is off.
 *
 * It is a description of the SQL, never a second authority: `outcome-parity.db.test.ts` pins it to the
 * real functions, the public roster and the real store mutations over the full product of the
 * dimensions below, so a new SQL gate that is not a field of `Facts` fails that test.
 *
 * THE ONE DELIBERATE ASYMMETRY. `Facts` is everything; the page's snapshot (`PhotoStateSnapshot`) is the
 * part of it the page can read. What the page cannot read is treated as CLEAR: hide or merged with no
 * designation (the SQL functions start from a designation, so with none they return no row) and
 * whether the site is published (never read). So `mayShow` means "nothing the page KNOWS withholds it",
 * never "it is shown", and every sentence keyed to it is hedged ("can ... unless something withholds
 * it") or is a selection or negative claim. The claims registry (`consequences.claims.test.ts`)
 * checks that against the ground truth.
 */

/** Why a selected website photo would not show. Priority is the SQL's: minor, merged, hide_photo; then the two roster gates. */
export type WebsiteGate = "minor" | "merged" | "hide_photo" | "not_listed" | "not_published" | "clear";
export type WebsiteOutcome =
  | { photoId: null } // no candidate: nothing is selected
  | { photoId: string; source: "website" | "directory_attested"; gate: WebsiteGate };
export type DirectoryGate = "minor" | "hide_photo" | "clear";
export type DirectoryOutcome = { photoId: null } | { photoId: string; gate: DirectoryGate };
export interface Outcomes {
  website: WebsiteOutcome;
  directory: DirectoryOutcome;
}

/** Ground truth about one person, all of it. The snapshot is the part of it the page can read. */
export interface Facts {
  listed: boolean;
  published: boolean;
  minor: boolean;
  merged: boolean;
  /** Person-wide: what the website core reads. */
  hide: boolean;
  /** This organization only: what the directory function reads. */
  hideHere: boolean;
  website: { photoId: string } | null;
  directory: { photoId: string; attested: boolean } | null;
}

function websiteGateOf(f: Facts): WebsiteGate {
  if (f.minor) return "minor";
  if (f.merged) return "merged";
  if (f.hide) return "hide_photo";
  if (!f.listed) return "not_listed";
  if (!f.published) return "not_published";
  return "clear";
}

/** THE mirror of the two SQL functions plus the roster gates. */
export function outcomeOfFacts(f: Facts): Outcomes {
  let website: WebsiteOutcome = { photoId: null };
  if (f.website) website = { photoId: f.website.photoId, source: "website", gate: websiteGateOf(f) };
  else if (f.directory?.attested) website = { photoId: f.directory.photoId, source: "directory_attested", gate: websiteGateOf(f) };

  const directory: DirectoryOutcome = f.directory
    ? { photoId: f.directory.photoId, gate: f.minor ? "minor" : f.hideHere ? "hide_photo" : "clear" }
    : { photoId: null };
  return { website, directory };
}

/** Unknown is clear: published = true; what the page cannot read (hide or merged with no designation) is not set. */
export function factsOfSnapshot(s: PhotoStateSnapshot): Facts {
  return {
    listed: s.listed,
    published: true,
    minor: s.minor,
    merged: s.websiteWithheld === "merged",
    hide: s.websiteWithheld === "hide_photo" || s.directoryWithheld === "hide_photo",
    hideHere: s.directoryWithheld === "hide_photo",
    website: s.website,
    directory: s.directory,
  };
}

export function outcomesOf(s: PhotoStateSnapshot): Outcomes {
  return outcomeOfFacts(factsOfSnapshot(s));
}

/**
 * What `store.ts` does to the designations (`designatePhoto`, `undesignatePhoto`, `removePhoto`), and
 * nothing else: a click does not change who the person is, so the person-level fields are carried. A
 * designate for a person who appears to be under 18 is REFUSED by the store, so the state is unchanged.
 */
export function applyIntent(s: PhotoStateSnapshot, intent: PhotoIntent): PhotoStateSnapshot {
  switch (intent.kind) {
    case "designate_directory":
      if (s.minor) return s;
      return { ...s, directory: { photoId: intent.photoId, attested: intent.attested } };
    case "designate_website":
      if (s.minor) return s;
      return { ...s, website: { photoId: intent.photoId } };
    case "undesignate_directory":
      return { ...s, directory: null };
    case "undesignate_website":
      return { ...s, website: null };
    case "remove":
      return {
        ...s,
        website: s.website?.photoId === intent.photoId ? null : s.website,
        directory: s.directory?.photoId === intent.photoId ? null : s.directory,
      };
  }
}

export function afterIntent(s: PhotoStateSnapshot, intent: PhotoIntent): Outcomes {
  return outcomesOf(applyIntent(s, intent));
}

/**
 * What a click does to the SELECTED photo id: none to none, begins (none to a photo), ends (a photo to
 * none), moves (a photo to a different photo) or unchanged (the same photo, though the SOURCE may
 * differ: the website designation ended and the cleared directory designation of the same photo now
 * carries it).
 */
export type Shift = "none" | "begins" | "ends" | "moves" | "unchanged";

export function shiftOf(before: WebsiteOutcome, after: WebsiteOutcome): Shift {
  if (before.photoId === null) return after.photoId === null ? "none" : "begins";
  if (after.photoId === null) return "ends";
  return before.photoId === after.photoId ? "unchanged" : "moves";
}

export const selectedId = (o: WebsiteOutcome | DirectoryOutcome): string | null => o.photoId;

/** "Nothing the page knows withholds it": the HEDGED reading, not "it is shown". */
export const mayShow = (o: WebsiteOutcome): boolean => o.photoId !== null && o.gate === "clear";

/** The source of a selected website photo, null when none is selected. */
export const sourceOf = (o: WebsiteOutcome): "website" | "directory_attested" | null => (o.photoId === null ? null : o.source);
