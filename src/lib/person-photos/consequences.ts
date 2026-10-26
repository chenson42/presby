import { CONSEQUENCE_COPY as C } from "./copy";

/**
 * The consequence sentences a designate, un-designate or remove dialog shows
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 "Library" and Copy
 * C4/C5; the six consequences of Phase 2 R3). PURE: a snapshot of the person's
 * state plus the intended action in, an ordered list of sentences out. No
 * database, no clock.
 *
 * The snapshot is what the page already holds from SQL (`PhotoSetView`): which
 * photo is the active directory and website designation, whether the directory
 * designation carries the website attestation, and whether the person is
 * listed on any public list. Nothing is recomputed here beyond ONE derived
 * fact, the one the SQL core also derives: **the directory photo is standing in
 * on the website** exactly when it is attested, no website photo is chosen, and
 * the person is listed (`presby_person_public_photo`, DECISION-286). It is a
 * description of the SQL, never a second authority: the page's status lines come
 * from the SQL wrapper itself.
 *
 * Each dialog's title, confirm and cancel labels, and the attestation
 * checkboxes are UI strings Batch 3 owns; this file returns only the sentences
 * whose truth depends on state.
 */

export interface PhotoStateSnapshot {
  /** The person's preferred or first name, for `{first}`. */
  first: string;
  /** The person is on at least one open public list (staff, officer or committee). */
  listed: boolean;
  /** The active website designation's photo, if any. */
  website: { photoId: string } | null;
  /** The active directory designation, if any; `attested` = it carries the website attestation. */
  directory: { photoId: string; attested: boolean } | null;
}

export type PhotoIntent =
  | { kind: "designate_directory"; photoId: string; attested: boolean }
  | { kind: "designate_website"; photoId: string }
  | { kind: "undesignate_directory" }
  | { kind: "undesignate_website" }
  | { kind: "remove"; photoId: string };

/** Is the CURRENT directory photo what the public website is showing for this person right now? */
export function directoryPhotoServesWebsite(state: PhotoStateSnapshot): boolean {
  return state.directory?.attested === true && state.website === null && state.listed;
}

export function consequencesFor(state: PhotoStateSnapshot, intent: PhotoIntent): string[] {
  const { first } = state;
  const lines: string[] = [];

  switch (intent.kind) {
    case "designate_directory": {
      if (intent.attested) {
        lines.push(
          state.listed && state.website === null
            ? C.directoryAlsoOnWebsite(first)
            : C.directoryWebsiteConditional(first),
        );
      } else if (directoryPhotoServesWebsite(state)) {
        // Replacing a photo that the website is using with one that is not cleared for it.
        lines.push(C.directoryWebsiteWillStop(first));
      }
      return lines;
    }

    case "designate_website": {
      lines.push(state.listed ? C.websiteListed(first) : C.websiteNotListed(first));
      if (state.website !== null && state.website.photoId !== intent.photoId) lines.push(C.websiteReplaces);
      return lines;
    }

    case "undesignate_directory": {
      lines.push(C.directoryInitials(first));
      if (directoryPhotoServesWebsite(state)) lines.push(C.directoryAlsoOnWebsiteEnds);
      return lines;
    }

    case "undesignate_website": {
      lines.push(C.websiteStops);
      lines.push(state.directory?.attested === true ? C.websiteFallsBack(first) : C.websiteShowsNone(first));
      lines.push(C.websiteCaches);
      return lines;
    }

    case "remove": {
      lines.push(C.removeBase);
      const isDirectory = state.directory?.photoId === intent.photoId;
      const isWebsite = state.website?.photoId === intent.photoId;
      const isFallback = isDirectory && directoryPhotoServesWebsite(state);
      if (isDirectory) lines.push(C.removeIsDirectory(first));
      if (isWebsite) lines.push(C.removeIsWebsite);
      if (isFallback) lines.push(C.removeIsFallback);
      if (isWebsite || isFallback) lines.push(C.removeCaches);
      return lines;
    }
  }
}
