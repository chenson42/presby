/**
 * THE WORLD: the full product of every dimension the person-photo SQL or the public roster reads
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 5 run 3, R-e3). TEST SUPPORT ONLY, pure, no
 * database: never imported by application code.
 *
 * Three loops of copy failures had one cause: the list of state dimensions lived in an author's head,
 * so each sweep covered the dimensions it remembered. This type IS the list. A new withheld reason or
 * roster predicate in the SQL is a new field here, or `outcome-parity.db.test.ts` (which seeds every
 * world into real Postgres and compares) fails. THE CHECKLIST FOR A FUTURE SQL GATE IS THIS TYPE.
 *
 * Photos are the symbolic names A and B (two photos of the same person); the DB test maps them to ids.
 */
import type { PhotoIntent, PhotoStateSnapshot } from "@/lib/person-photos/consequences";
import type { Facts } from "@/lib/person-photos/outcome";

export type PhotoName = "A" | "B";
/** `none`, a hide set at THIS organization, or one set at another (person_privacy has one row per person). */
export type HideScope = "none" | "this_org" | "other_org";
export type DirectoryDesignation = { photo: PhotoName; attested: boolean } | null;

export interface World {
  /** An open public listing at this organization (staff, officer or committee). */
  listed: boolean;
  /** The organization's site is `live` (and the organization active). The page never reads this. */
  published: boolean;
  minor: boolean;
  merged: boolean;
  hide: HideScope;
  website: PhotoName | null;
  directory: DirectoryDesignation;
}

const BOOLS = [false, true] as const;
const HIDES: HideScope[] = ["none", "this_org", "other_org"];
const WEBSITES: Array<PhotoName | null> = [null, "A", "B"];
/** 1 + 2 x 2 = 5: none, then each photo attested and plain. */
export const DIRECTORIES: DirectoryDesignation[] = [
  null,
  { photo: "A", attested: true },
  { photo: "A", attested: false },
  { photo: "B", attested: true },
  { photo: "B", attested: false },
];

/** 2 x 2 x 2 x 2 x 3 x 15 = 720, including website A with directory A attested AND unattested. */
export const WORLDS: World[] = [];
for (const listed of BOOLS)
  for (const published of BOOLS)
    for (const minor of BOOLS)
      for (const merged of BOOLS)
        for (const hide of HIDES)
          for (const website of WEBSITES)
            for (const directory of DIRECTORIES) WORLDS.push({ listed, published, minor, merged, hide, website, directory });

/** The ten intents over photos A and B. */
export const INTENTS: PhotoIntent[] = [
  { kind: "designate_directory", photoId: "A", attested: false },
  { kind: "designate_directory", photoId: "A", attested: true },
  { kind: "designate_directory", photoId: "B", attested: false },
  { kind: "designate_directory", photoId: "B", attested: true },
  { kind: "designate_website", photoId: "A" },
  { kind: "designate_website", photoId: "B" },
  { kind: "undesignate_directory" },
  { kind: "undesignate_website" },
  { kind: "remove", photoId: "A" },
  { kind: "remove", photoId: "B" },
];

export const worldKey = (w: World): string =>
  [
    w.listed ? "listed" : "unlisted",
    w.published ? "published" : "unpublished",
    w.minor ? "minor" : "adult",
    w.merged ? "merged" : "unmerged",
    `hide:${w.hide}`,
    `web:${w.website ?? "-"}`,
    `dir:${w.directory ? `${w.directory.photo}${w.directory.attested ? "+att" : ""}` : "-"}`,
  ].join(" ");

/** The ground truth about a world, as the mirror's input. */
export function factsOfWorld(w: World): Facts {
  return {
    listed: w.listed,
    published: w.published,
    minor: w.minor,
    merged: w.merged,
    hide: w.hide !== "none",
    hideHere: w.hide === "this_org",
    website: w.website ? { photoId: w.website } : null,
    directory: w.directory ? { photoId: w.directory.photo, attested: w.directory.attested } : null,
  };
}

/**
 * The READER'S PROJECTION: what the page can read of a world (`buildSnapshot` over the real queries).
 * The SQL functions start from a designation, so a withheld answer exists only while one does:
 *   - `websiteWithheld`: only when a website candidate exists and the person is not a minor (`minor`
 *     is its own field, and wins over merged and hide); merged, else hide_photo (person-wide);
 *   - `directoryWithheld`: only when a directory designation exists and the person is not a minor,
 *     and the hide is set at THIS organization.
 * `outcome-parity.db.test.ts` P2 pins this function to the real reader.
 */
export function snapshotOfWorld(w: World, first = "Ada"): PhotoStateSnapshot {
  const websiteCandidate = w.website !== null || w.directory?.attested === true;
  return {
    first,
    listed: w.listed,
    website: w.website ? { photoId: w.website } : null,
    directory: w.directory ? { photoId: w.directory.photo, attested: w.directory.attested } : null,
    minor: w.minor,
    directoryWithheld: w.directory !== null && !w.minor && w.hide === "this_org" ? "hide_photo" : null,
    websiteWithheld: websiteCandidate && !w.minor ? (w.merged ? "merged" : w.hide !== "none" ? "hide_photo" : null) : null,
  };
}

/**
 * What `store.ts` does to the designations, written independently of the mirror's `applyIntent`
 * (the DB test pins this one to the real store): the person fields are carried, a designate for a minor
 * is refused (the world is unchanged), `remove` ends every designation naming the photo.
 */
export function applyIntentToWorld(w: World, i: PhotoIntent): World {
  switch (i.kind) {
    case "designate_directory":
      if (w.minor) return w;
      return { ...w, directory: { photo: i.photoId as PhotoName, attested: i.attested } };
    case "designate_website":
      if (w.minor) return w;
      return { ...w, website: i.photoId as PhotoName };
    case "undesignate_directory":
      return { ...w, directory: null };
    case "undesignate_website":
      return { ...w, website: null };
    case "remove":
      return {
        ...w,
        website: w.website === i.photoId ? null : w.website,
        directory: w.directory?.photo === i.photoId ? null : w.directory,
      };
  }
}
