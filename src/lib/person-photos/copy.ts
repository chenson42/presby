/**
 * Every user-facing string the person-photos SERVER side produces, in one place
 * so the copy-truthfulness check has one file to read (docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3 "Copy"). Pure, no imports beyond
 * types, importable by the client island and by the server actions alike.
 *
 * `{first}` is the person's preferred or first name. Every string below is the
 * design's text verbatim (Copy C1, C2, C4, C5, C6); the UI sections (headings,
 * labels, buttons, dialog titles) are added by Batch 3 beside them. A string
 * that is not in the design is not invented here: stop and ask.
 *
 * WHAT THE STRINGS CLAIM, AND THE SOURCE OF EACH CLAIM (the four checks):
 *   - "up to a day": the public door's `private, max-age=86400` cache header
 *     (F289); a removed or withheld photo can stay in a browser that saved it.
 *   - "stays in storage / can't be erased": `blob_assets` has no delete path.
 *   - "appears to be under 18": `presby_photo_subject_is_minor`, which includes
 *     the birth-year-only ambiguity (hence "appears"); a null date of birth with
 *     no child marker is an adult, and no string here claims "adults only".
 *   - "hidden their photo": `person_privacy.hide_photo`, a stored setting with no
 *     member-facing writer yet; the string describes the setting, not a promise
 *     the person can change it.
 *   - "can appear ... unless something withholds it": a sentence about what a surface WILL show
 *     is allowed only where the page's queries establish it. `hide_photo` and `merged` are known
 *     only when a designation exists (the SQL functions start from it), `minor` always; site
 *     status and the platform `sites.*` flags are not read. So "will appear" is never said
 *     (Phase 5 run 1 rulings).
 *   - SELECTION VERBS AND EFFECT VERBS (Phase 5 run 3, R-e6): a consequence sentence may use a selection
 *     verb ("uses", "keeps using", "no longer use") only to say which photo the designations PICK, and
 *     may state a visible effect only as a negative, hedged with "can ... unless something withholds
 *     it", or as "can no longer show". `consequences.claims.test.ts` checks every sentence against a
 *     ground-truth model of the SQL (a truth condition per key); a sentence cannot be added without one.
 *   - "who can see {first} in the directory": `presby_person_directory_photo` does not read
 *     `directory_hidden` or membership status; the directory's own eligibility is the directory's.
 *   - "listed": an open `public_listed` row in staff, officers or committees,
 *     read by `reader.ts`; never "showing now" (site status and the platform
 *     `sites.*` flags are not read).
 */
import { PHOTO_CAP_PER_PERSON } from "./limits";
import type { ListingKind, PhotoRefusal } from "./types";

/** Existing generic strings, reused verbatim (Copy C6). */
export const REUSED_COPY = {
  signedOut: "You must be signed in to do that.",
  noOrgAccess: "You don't have access to that organization.",
  forbidden: "You don't have permission to do that here.",
} as const;

/** One fixed string per refusal kind (Copy C6). `first` is only read by the three kinds that name the person. */
export const REFUSAL_COPY: Record<PhotoRefusal, (first: string) => string> = {
  feature_off: () => "Photos of people aren't turned on for this organization.",
  forbidden: () => REUSED_COPY.forbidden,
  not_found: () => "That person could not be found.",
  minor: (first) => `${first} appears to be under 18. Photos of children can't be added yet.`,
  cap_reached: (first) => `${first} already has 10 photos. Remove one to add another.`,
  duplicate: (first) => `That picture is already in ${first}'s photos.`,
  unsupported_type: () =>
    "That file isn't a JPEG, PNG or WebP picture. If it's an iPhone photo, pick it from your photo library or convert it to JPEG first.",
  animated: () => "Animated pictures aren't supported. Choose a still picture.",
  too_many_pixels: () => "That picture is too large to process. Try a smaller one.",
  too_large: () => "That picture is too big to upload. Try a smaller one.",
  unreadable: () => "We couldn't read that picture. Try a different file.",
  empty: () => "That file is empty.",
  already_removed: () => "That photo was already removed.",
  attestation_required: () => "Tick the box to confirm you have their permission.",
  save_failed: () => "We couldn't save that photo. Nothing was changed. Try again.",
};

/** The refusal kinds whose string names the person; the action needs `first` only for these. */
export const REFUSALS_NAMING_PERSON: readonly PhotoRefusal[] = ["minor", "cap_reached", "duplicate"];

export function refusalMessage(reason: PhotoRefusal, first: string): string {
  return REFUSAL_COPY[reason](first);
}

/** A client-side rejection (the framework's 413, a dropped connection) maps to this. */
export const UPLOAD_REJECTED_COPY = "That picture couldn't be uploaded. Check your connection, or try a smaller picture.";

// ---------------------------------------------------------------------------
// C1: the toggle's off-warning on /o/<slug>/admin/features

const OFF_WARNING_TITLE = "Photos of people will be hidden";
const BROWSER_CACHE_SENTENCE = "Browsers that already saved a photo can keep showing it for up to a day.";

/** `count` distinct photos with an active designation on a live photo (0 means: no warning at all, the caller shows none). */
export function offWarningCopy(count: number): { title: string; description: string } {
  const noun = count === 1 ? "photo is" : "photos are";
  const them = count === 1 ? "it" : "them";
  return {
    title: OFF_WARNING_TITLE,
    description:
      `${count} ${noun} currently chosen for the directory or the website. ` +
      `Turning this off hides ${them} everywhere, including on your public website. ` +
      `Nothing is deleted, and turning it back on restores ${them}. ` +
      BROWSER_CACHE_SENTENCE,
  };
}

/** The count could not be read: the warning is still shown, generically. */
export const OFF_WARNING_FALLBACK = {
  title: OFF_WARNING_TITLE,
  description:
    "Turning this off hides every photo of a person, including on your public website. Nothing is deleted. " +
    BROWSER_CACHE_SENTENCE,
} as const;

// ---------------------------------------------------------------------------
// C2: the photos page's "Where photos show" lines

export const DIRECTORY_LINES = {
  shown: (first: string) => `Directory: members who can see ${first} in the directory see the photo marked "Directory" below.`,
  none: (first: string) => `Directory: no photo chosen, so members who can see ${first} in the directory see initials.`,
  hide: (first: string) => `Directory: not shown, because ${first} has hidden their photo.`,
  minor: (first: string) => `Directory: not shown. ${first} appears to be under 18, and photos of children aren't used yet.`,
} as const;

export const WEBSITE_LINES = {
  website: 'Website: the photo marked "Website" below.',
  fallback: "Website: the directory photo, because it was cleared for the website.",
  none: "Website: no photo chosen, so the website shows none.",
  unattested:
    'Website: none. The directory photo isn\'t cleared for the website. Choose a website photo, or choose "Clear for website" on the photo marked "Directory".',
  hide: (first: string) => `Website: not shown, because ${first} has hidden their photo.`,
  minor: (first: string) => `Website: not shown. ${first} appears to be under 18, and photos of children aren't used yet.`,
  merged: "Website: not shown, because this record was merged into another.",
} as const;

const LISTING_NOUN: Record<ListingKind, string> = {
  staff: "staff",
  officer: "officer",
  committee: "committee member",
};

/** "staff", "staff and committee member", "staff, officer and committee member": the design's `{staff, officer or committee member}`. */
export function listingKinds(kinds: readonly ListingKind[]): string {
  const order: ListingKind[] = ["staff", "officer", "committee"];
  const nouns = order.filter((k) => kinds.includes(k)).map((k) => LISTING_NOUN[k]);
  if (nouns.length <= 1) return nouns.join("");
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

export function listingLine(first: string, kinds: readonly ListingKind[]): string {
  if (kinds.length === 0) {
    return `${first} isn't listed on your public website, so no photo shows there. Listing is set separately, under Staff, Officers or Groups, by whoever manages those.`;
  }
  return `${first} is listed on your public website (${listingKinds(kinds)}). Photos appear there only while the person is listed and the website is published.`;
}

// ---------------------------------------------------------------------------
// C4 and C5: the consequence sentences the designate, un-designate and remove dialogs show.
// `consequences.ts` chooses among these from the person's live state.

export const CONSEQUENCE_COPY = {
  // C4, directory dialog
  directoryAlsoOnWebsite: (first: string) =>
    `Because ${first} is listed on the public website and has no website photo, this photo can also appear there while the website is published, unless something withholds it, such as ${first} hiding their photo or appearing to be under 18.`,
  directoryWebsiteWillStop: (first: string) =>
    `The website is using the current directory photo. After this it will show no photo for ${first}.`,
  // Phase 5 run 3 (R-e6, R-e8): chosen by comparing the website's outcome before and after the click
  // (`outcome.ts`), never by "a website photo exists". They replace `directoryWebsiteConditional`.
  websiteAlreadyUses: (first: string) => `This is already ${first}'s website photo, so this changes nothing on the website.`,
  websiteKeepsOther: (first: string) =>
    `${first} has a different website photo, so the website keeps using that one instead of this photo.`,
  // C4, website dialog
  websiteListed: (first: string) =>
    `${first} is listed, so this photo can appear on the website while the website is published, unless something withholds it, such as ${first} hiding their photo or appearing to be under 18.`,
  websiteNotListed: (first: string) =>
    `${first} isn't listed on the public website, so this photo won't appear there while that is so.`,
  websiteReplaces: "This replaces the current website photo.",
  // C4 (Phase 5 run 1, R-a3): what withholds a photo, said before the click
  minorBlocked: (first: string) =>
    `${first} appears to be under 18, so a photo of ${first} can't be chosen for the directory or the website yet.`,
  directoryHidden: (first: string) => `${first} has hidden their photo, so the directory won't show this photo while that is so.`,
  websiteHidden: (first: string) => `${first} has hidden their photo, so the website won't show this photo while that is so.`,
  websiteMerged: "This record was merged into another, so the website won't show this photo.",
  // C5, un-designate directory
  directoryInitials: (first: string) => `Wherever ${first} appears in the directory, their initials will show instead.`,
  directoryAlsoOnWebsiteEnds:
    "The website is also using this photo, because it was cleared for the website. After this, the website will show no photo.",
  // C5, un-designate website
  websiteStops: "The website will no longer use this photo.",
  websiteFallsBack: (first: string) =>
    `If ${first} is listed, the website will use their directory photo instead, because it was cleared for the website.`,
  websiteShowsNone: (first: string) => `The website will show no photo for ${first}.`,
  // Phase 5 run 3 (R-e5): the website designation and the cleared directory designation name ONE photo, so
  // stopping the first moves nothing; the dialog says so and names the control that does take it off.
  websiteUnchangedCleared: (first: string) =>
    `This photo is also ${first}'s directory photo, and it was cleared for the website, so this changes nothing on the website.`,
  websiteTakeOffTip: 'To take it off the website, use "Stop using in directory" on this photo as well.',
  websiteCaches:
    "Browsers that already saved it can keep showing it for up to a day, and copies kept by search engines or web archives can't be recalled.",
  // C5, remove
  removeBase: "It will no longer be used anywhere. The image file stays in storage and can't be erased from here.",
  removeIsDirectory: (first: string) =>
    `It is ${first}'s directory photo, so wherever ${first} appears in the directory it will show initials instead.`,
  removeIsWebsite: "It is also their website photo, so the public website can no longer show it.",
  removeIsWebsiteWithheld: "It is also their website photo, which the website isn't showing at the moment.",
  removeIsFallback: "It is also the photo the public website uses for them, because it was cleared for the website.",
  removeCaches: "Browsers that already saved it can keep showing it for up to a day.",
} as const;

// ---------------------------------------------------------------------------
// The UI strings (Copy C2, C3, C4, C5, C7, C8). Added by Batch 3; the design's
// text verbatim. `{first}` is the person's preferred or first name, `{name}`
// the display name, `{org}` the organization name.

/** C2: the photos page. */
export const PAGE_COPY = {
  heading: "Photos",
  backToEdit: "Back to edit person",
  off: (org: string) =>
    `Photos of people aren't turned on for ${org}. Someone who manages your organization's features can turn them on.`,
  whereHeading: "Where photos show",
  counter: (count: number) => `${count} of ${PHOTO_CAP_PER_PERSON} photos`,
  emptyTitle: "No photos yet",
  emptyBody: "Add the first photo below.",
  minorNotice: (first: string) =>
    `${first} appears to be under 18. Photos of children can't be added yet, and any existing photos are not shown in the directory or on the website.`,
  subheading: (name: string, org: string) => `${name} · ${org}`,
  tileAlt: (name: string, n: number) => `${name}, photo ${n}`,
  chipDirectory: "Directory",
  chipWebsite: "Website",
  chipDirectoryCleared: "Directory, cleared for website",
  useInDirectory: "Use in directory",
  stopInDirectory: "Stop using in directory",
  useOnWebsite: "Use on website",
  clearForWebsite: "Clear for website",
  stopOnWebsite: "Stop using on website",
  remove: "Remove",
  viewLarger: "View larger",
  backToAll: "Back to all photos",
} as const;

/** C3: the upload island. */
export const UPLOAD_COPY = {
  label: "Add a photo",
  button: "Choose a photo",
  helper:
    "Pick a picture or take one with your camera. JPEG, PNG or WebP. It is resized here and stored without location information.",
  preparing: "Getting the picture ready…",
  uploading: "Uploading…",
  added: "Photo added.",
  addedDirectory: (first: string) => `Photo added. It's now ${first}'s directory photo.`,
} as const;

/** C4: the designate dialogs. */
export const DESIGNATE_COPY = {
  directory: {
    title: "Use this photo in the directory?",
    body: (name: string, first: string) =>
      `Members who can see ${name} in the directory will see this photo, unless ${first} has hidden their photo or appears to be under 18.`,
    checkbox: (first: string) =>
      `I have ${first}'s permission to also use this photo on the public website if they are listed there and no website photo is chosen.`,
    confirm: "Use in directory",
  },
  website: {
    title: "Use this photo on the public website?",
    body: "Anyone on the internet can see a photo on the public website. Search engines and web archives may keep copies, and removing the photo later can't recall them.",
    checkbox: (first: string) => `I have ${first}'s permission to show this photo on the public website.`,
    confirm: "Use on website",
  },
  /** Phase 5 run 1, R-b2: clear the CURRENT directory photo for the website (the box the first designation left unticked). */
  clear: {
    title: "Clear this photo for the website?",
    body: (first: string) =>
      `This is ${first}'s directory photo. Clearing it lets the public website use it too when ${first} is listed and no website photo is chosen. Anyone on the internet can see a photo on the public website. Search engines and web archives may keep copies, and removing the photo later can't recall them.`,
    checkbox: (first: string) =>
      `I have ${first}'s permission to also use this photo on the public website if they are listed there and no website photo is chosen.`,
    confirm: "Clear for website",
  },
  cancel: "Cancel",
} as const;

/** C5: the un-designate and remove dialogs. */
export const CONFIRM_COPY = {
  stopDirectory: { title: "Stop using this photo in the directory?", confirm: "Stop using" },
  stopWebsite: { title: "Stop using this photo on the public website?", confirm: "Stop using" },
  remove: { title: "Remove this photo?", confirm: "Remove photo" },
  cancel: "Cancel",
} as const;

/** C7: the link on the edit-person page. */
export const EDIT_LINK_COPY = "Photos";

/**
 * C8: the "on" branch of the three public-listing dialogs (staff, officers,
 * groups). Gives NO instruction: its reader holds staff, officers or groups
 * management and may not hold `people.manage`.
 */
export function listingConsentCopy(personName: string): string {
  return (
    `This makes ${personName}'s name and role visible to anyone visiting the public website, including search engines and archival crawlers. ` +
    "A photo may be shown too, if a website photo has been chosen for them (or a directory photo cleared for the website) and they haven't hidden their photo."
  );
}
