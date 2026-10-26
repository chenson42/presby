import { CONSEQUENCE_COPY as C } from "./copy";
import { afterIntent, applyIntent, mayShow, outcomesOf, shiftOf, sourceOf, type WebsiteGate } from "./outcome";

/**
 * The consequence sentences a designate, un-designate or remove dialog shows
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 "Library" and Copy
 * C4/C5; Phase 5 run 3, R-e2). PURE: a snapshot of the person's state plus the intended
 * action in, an ordered list of sentences out. No database, no clock.
 *
 * THE SENTENCES ARE CHOSEN BY COMPARING OUTCOMES, never by a per-state rule written by hand. The page
 * computes what the public surfaces select BEFORE the click and AFTER it, from a pure mirror of the
 * SQL (`outcome.ts`), and each row below picks its sentences from that comparison (did the selected
 * website photo begin, end, move, stay?). Three Phase 5 runs failed copy truthfulness because each
 * sentence was a hand-written prediction guarded by a hand-written predicate that covered only the
 * state dimensions its author remembered. Now every sentence key carries a declared truth condition
 * (`consequences.claims.test.ts`), checked over the full product of the dimensions the SQL reads, and
 * the mirror is pinned to the SQL and to the store by `outcome-parity.db.test.ts`.
 *
 * The snapshot is what the page already holds from SQL (`PhotoSetView`): which photo is the active
 * directory and website designation, whether the directory designation carries the website
 * attestation, whether the person is listed, and the withheld answers the SQL reported. What the page
 * cannot read (hide or merged with no designation, whether the site is published) is treated as clear,
 * so a sentence about what a surface will show is only ever a selection statement, a negative, or
 * hedged ("can ... unless something withholds it"). See `outcome.ts`'s header for that asymmetry.
 *
 * Each dialog's title, confirm and cancel labels, and the attestation checkboxes are UI strings
 * Batch 3 owns; this file returns only the sentences whose truth depends on state.
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
 * Is the CURRENT directory photo what the public website is selecting for this person, with nothing the
 * page knows withholding it? A description of the SQL (a withheld person's photo is not shown), never a
 * second authority; kept for the page and the tests.
 */
export function directoryPhotoServesWebsite(state: PhotoStateSnapshot): boolean {
  const { website } = outcomesOf(state);
  return sourceOf(website) === "directory_attested" && mayShow(website);
}

const isWithheld = (gate: WebsiteGate): boolean => gate === "merged" || gate === "hide_photo" || gate === "minor";

export function consequencesFor(state: PhotoStateSnapshot, intent: PhotoIntent): string[] {
  const { first } = state;

  // The store refuses a minor, so the dialog says so before the click and says nothing else.
  if (state.minor && (intent.kind === "designate_directory" || intent.kind === "designate_website")) return [C.minorBlocked(first)];

  const before = outcomesOf(state);
  const next = applyIntent(state, intent);
  const after = outcomesOf(next);
  const shift = shiftOf(before.website, after.website);
  const lines: string[] = [];

  /** The sentence for a withheld website, by reason; only called when the gate is `merged` or `hide_photo`. */
  const withheldLine = (gate: WebsiteGate): string => (gate === "merged" ? C.websiteMerged : C.websiteHidden(first));
  const websiteGate = after.website.photoId === null ? null : after.website.gate;
  const hiddenOrMerged = websiteGate === "merged" || websiteGate === "hide_photo";

  switch (intent.kind) {
    case "designate_directory": {
      if (after.directory.photoId !== null && after.directory.gate === "hide_photo") lines.push(C.directoryHidden(first));
      if (intent.attested) {
        // Gate first: a withheld website photo says so. Then WHICH photo the designations pick.
        if (websiteGate !== null && hiddenOrMerged) lines.push(withheldLine(websiteGate));
        else if (after.website.photoId !== intent.photoId) lines.push(C.websiteKeepsOther(first));
        else if (before.website.photoId === intent.photoId && sourceOf(before.website) === "website") lines.push(C.websiteAlreadyUses(first));
        else if (websiteGate === "not_listed") lines.push(C.websiteNotListed(first));
        else lines.push(C.directoryAlsoOnWebsite(first));
      } else if (shift === "ends" && mayShow(before.website)) {
        // Replacing a photo that the website is using with one that is not cleared for it.
        lines.push(C.directoryWebsiteWillStop(first));
      }
      return lines;
    }

    case "designate_website": {
      if (websiteGate !== null && hiddenOrMerged) lines.push(withheldLine(websiteGate));
      else lines.push(websiteGate === "not_listed" ? C.websiteNotListed(first) : C.websiteListed(first));
      if (sourceOf(before.website) === "website" && before.website.photoId !== intent.photoId) lines.push(C.websiteReplaces);
      return lines;
    }

    case "undesignate_directory": {
      if (before.directory.photoId !== null) lines.push(C.directoryInitials(first));
      if (shift === "ends" && mayShow(before.website)) lines.push(C.directoryAlsoOnWebsiteEnds);
      return lines;
    }

    case "undesignate_website": {
      // No website designation: the click changes nothing (a stale page; the page offers no button then).
      if (sourceOf(before.website) !== "website") return lines;
      if (shift === "unchanged") {
        // The same photo stays selected, as the cleared directory photo (R-e5): say so, and name the control
        // that does take it off, but only when applying it is verified to leave no photo selected.
        lines.push(C.websiteUnchangedCleared(first));
        if (afterIntent(next, { kind: "undesignate_directory" }).website.photoId === null) lines.push(C.websiteTakeOffTip);
        return lines;
      }
      lines.push(C.websiteStops);
      lines.push(shift === "moves" && websiteGate !== null && !isWithheld(websiteGate) ? C.websiteFallsBack(first) : C.websiteShowsNone(first));
      lines.push(C.websiteCaches);
      return lines;
    }

    case "remove": {
      lines.push(C.removeBase);
      if (before.directory.photoId === intent.photoId) lines.push(C.removeIsDirectory(first));
      if (before.website.photoId === intent.photoId) {
        const source = sourceOf(before.website);
        const shown = mayShow(before.website);
        if (source === "website") lines.push(shown ? C.removeIsWebsite : C.removeIsWebsiteWithheld);
        else if (shown) lines.push(C.removeIsFallback);
        if (source === "website" || shown) lines.push(C.removeCaches);
        // Removing the website photo hands the website to the cleared directory photo, if there is one.
        if (shift === "moves" && websiteGate !== null && !isWithheld(websiteGate)) lines.push(C.websiteFallsBack(first));
      }
      return lines;
    }
  }
}
