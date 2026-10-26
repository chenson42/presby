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
 * A sentence about what a surface WILL show is allowed only where the queries behind the snapshot
 * establish it (Phase 5 run 1 rulings, R-a): the snapshot carries `minor`, `directoryWithheld` and
 * `websiteWithheld`, and a sentence that cannot be established says "can ... unless something
 * withholds it". The site's publication status and the platform `sites.*` flags are NOT read.
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
  /** `presby_photo_subject_is_minor`: ALWAYS known (the one withheld reason that needs no designation). */
  minor: boolean;
  /**
   * `presby_person_directory_photo().withheld` when it reported `hide_photo` (scoped to this
   * organization); else null. null means "none reported", NOT "none applies": with no directory
   * designation the function returns no row.
   */
  directoryWithheld: "hide_photo" | null;
  /**
   * `presby_person_public_photo_status().withheld` when it reported `hide_photo` or `merged`; else
   * null. Same caveat as `directoryWithheld`. `minor` and `toggle_off` never appear here: minor is
   * its own field, and the toggle is off only on a page that does not render.
   */
  websiteWithheld: "hide_photo" | "merged" | null;
}

export type PhotoIntent =
  | { kind: "designate_directory"; photoId: string; attested: boolean }
  | { kind: "designate_website"; photoId: string }
  | { kind: "undesignate_directory" }
  | { kind: "undesignate_website" }
  | { kind: "remove"; photoId: string };

/**
 * Does anything the snapshot knows withhold this person's photo from the website? `hide_photo` is a
 * person-level setting, so a directory answer of `hide_photo` withholds the website photo too.
 */
function websiteIsWithheld(state: PhotoStateSnapshot): boolean {
  return state.minor || state.websiteWithheld !== null || state.directoryWithheld !== null;
}

/**
 * Is the website not showing this person's photo, for a reason the snapshot can establish? Everything
 * `websiteIsWithheld` knows, plus NOT LISTED: listing is a roster-function gate the SQL core
 * (`presby_person_public_photo`) does not apply, so an unlisted person's website photo is returned by
 * the core and shown by no roster. Site publication is NOT read, so a sentence that depends on it must
 * not claim a visible result (Phase 5 run 2, R-d1).
 */
function websiteNotShowing(state: PhotoStateSnapshot): boolean {
  return websiteIsWithheld(state) || !state.listed;
}

/**
 * Is the CURRENT directory photo what the public website is showing for this person right now?
 * A description of the SQL (a withheld person's photo is not shown), never a second authority.
 */
export function directoryPhotoServesWebsite(state: PhotoStateSnapshot): boolean {
  return state.directory?.attested === true && state.website === null && state.listed && !websiteIsWithheld(state);
}

/**
 * The sentence for a withheld website, by reason. Only called when `websiteWithheld` or
 * `directoryWithheld` is set: `merged` wins (as in the SQL), otherwise the hide is known, because
 * `hide_photo` is person-level and a directory answer of it is one the website core would give too.
 */
function websiteWithheldLine(state: PhotoStateSnapshot): string {
  return state.websiteWithheld === "merged" ? C.websiteMerged : C.websiteHidden(state.first);
}

export function consequencesFor(state: PhotoStateSnapshot, intent: PhotoIntent): string[] {
  const { first } = state;
  const lines: string[] = [];

  switch (intent.kind) {
    case "designate_directory": {
      // The store refuses a minor, so the dialog says so before the click and says nothing else.
      if (state.minor) return [C.minorBlocked(first)];
      if (state.directoryWithheld !== null) lines.push(C.directoryHidden(first));
      if (intent.attested) {
        if (state.websiteWithheld !== null || state.directoryWithheld !== null) lines.push(websiteWithheldLine(state));
        else
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
      if (state.minor) return [C.minorBlocked(first)];
      if (state.websiteWithheld !== null || state.directoryWithheld !== null) lines.push(websiteWithheldLine(state));
      else lines.push(state.listed ? C.websiteListed(first) : C.websiteNotListed(first));
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
      lines.push(
        state.directory?.attested === true && !websiteIsWithheld(state) ? C.websiteFallsBack(first) : C.websiteShowsNone(first),
      );
      lines.push(C.websiteCaches);
      return lines;
    }

    case "remove": {
      lines.push(C.removeBase);
      const isDirectory = state.directory?.photoId === intent.photoId;
      const isWebsite = state.website?.photoId === intent.photoId;
      const isFallback = isDirectory && directoryPhotoServesWebsite(state);
      if (isDirectory) lines.push(C.removeIsDirectory(first));
      if (isWebsite) lines.push(websiteNotShowing(state) ? C.removeIsWebsiteWithheld : C.removeIsWebsite);
      if (isFallback) lines.push(C.removeIsFallback);
      if (isWebsite || isFallback) lines.push(C.removeCaches);
      return lines;
    }
  }
}
