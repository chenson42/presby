/**
 * U3: the consequence sentences (Phase 3 Test Plan U3; Phase 2 R3's six
 * consequences). Table-driven over the intent and the state it is chosen in:
 * listed or not, a website photo present or not, attested or not, replacing or
 * first. Pure; the strings are the design's (Copy C4/C5) and are asserted
 * against `copy.ts`, so a copy edit and a logic edit cannot drift silently.
 */
import { describe, expect, it } from "vitest";
import { consequencesFor, directoryPhotoServesWebsite, type PhotoIntent, type PhotoStateSnapshot } from "./consequences";
import { CONSEQUENCE_COPY as C } from "./copy";

const first = "Ada";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const state = (over: Partial<PhotoStateSnapshot> = {}): PhotoStateSnapshot => ({
  first,
  listed: false,
  website: null,
  directory: null,
  ...over,
});

interface Row {
  name: string;
  state: PhotoStateSnapshot;
  intent: PhotoIntent;
  expected: string[];
}

const rows: Row[] = [
  // --- consequence 1 and 4: choosing a DIRECTORY photo, with and without the clearance
  {
    name: "directory, cleared, person listed, no website photo: it also appears on the website",
    state: state({ listed: true }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [C.directoryAlsoOnWebsite(first)],
  },
  {
    name: "directory, cleared, but not listed: used on the website only if listed and no website photo",
    state: state({ listed: false }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [C.directoryWebsiteConditional(first)],
  },
  {
    name: "directory, cleared, listed, but a website photo exists: the conditional line, never 'will also appear'",
    state: state({ listed: true, website: { photoId: B } }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [C.directoryWebsiteConditional(first)],
  },
  {
    name: "directory, NOT cleared, nothing on the website depends on it: no consequence line",
    state: state({ listed: true, directory: { photoId: B, attested: false } }),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [],
  },
  {
    name: "directory, NOT cleared, first photo: no consequence line",
    state: state(),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [],
  },
  {
    name: "replacing a cleared directory photo the website is using with an uncleared one: the website will show none",
    state: state({ listed: true, directory: { photoId: B, attested: true } }),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [C.directoryWebsiteWillStop(first)],
  },
  {
    name: "replacing a cleared directory photo with an uncleared one, but a website photo exists: the website is not using it, so nothing to say",
    state: state({ listed: true, website: { photoId: B }, directory: { photoId: B, attested: true } }),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [],
  },
  {
    name: "replacing a cleared directory photo while not listed: the website is not using it, so nothing to say",
    state: state({ listed: false, directory: { photoId: B, attested: true } }),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [],
  },

  // --- the WEBSITE dialog
  {
    name: "website, first, listed",
    state: state({ listed: true }),
    intent: { kind: "designate_website", photoId: A },
    expected: [C.websiteListed(first)],
  },
  {
    name: "website, first, not listed",
    state: state({ listed: false }),
    intent: { kind: "designate_website", photoId: A },
    expected: [C.websiteNotListed(first)],
  },
  {
    name: "website, replacing another website photo: adds the replacement line",
    state: state({ listed: true, website: { photoId: B } }),
    intent: { kind: "designate_website", photoId: A },
    expected: [C.websiteListed(first), C.websiteReplaces],
  },
  {
    name: "website, choosing the photo that is already the website photo: it replaces nothing",
    state: state({ listed: false, website: { photoId: A } }),
    intent: { kind: "designate_website", photoId: A },
    expected: [C.websiteNotListed(first)],
  },

  // --- consequence 2: un-designating a website photo
  {
    name: "stop website photo, directory photo is cleared: names the fall-back (consequence 2)",
    state: state({ listed: true, website: { photoId: A }, directory: { photoId: B, attested: true } }),
    intent: { kind: "undesignate_website" },
    expected: [C.websiteStops, C.websiteFallsBack(first), C.websiteCaches],
  },
  {
    name: "stop website photo, directory photo not cleared: the website will show none",
    state: state({ listed: true, website: { photoId: A }, directory: { photoId: B, attested: false } }),
    intent: { kind: "undesignate_website" },
    expected: [C.websiteStops, C.websiteShowsNone(first), C.websiteCaches],
  },
  {
    name: "stop website photo, no directory photo at all: the website will show none",
    state: state({ website: { photoId: A } }),
    intent: { kind: "undesignate_website" },
    expected: [C.websiteStops, C.websiteShowsNone(first), C.websiteCaches],
  },

  // --- stopping the DIRECTORY photo
  {
    name: "stop directory photo that the website is also using (cleared, listed, no website photo)",
    state: state({ listed: true, directory: { photoId: A, attested: true } }),
    intent: { kind: "undesignate_directory" },
    expected: [C.directoryInitials(first), C.directoryAlsoOnWebsiteEnds],
  },
  {
    name: "stop directory photo, cleared but not listed: initials only",
    state: state({ listed: false, directory: { photoId: A, attested: true } }),
    intent: { kind: "undesignate_directory" },
    expected: [C.directoryInitials(first)],
  },
  {
    name: "stop directory photo, cleared and listed but a website photo is chosen: initials only",
    state: state({ listed: true, website: { photoId: B }, directory: { photoId: A, attested: true } }),
    intent: { kind: "undesignate_directory" },
    expected: [C.directoryInitials(first)],
  },
  {
    name: "stop directory photo, not cleared: initials only",
    state: state({ listed: true, directory: { photoId: A, attested: false } }),
    intent: { kind: "undesignate_directory" },
    expected: [C.directoryInitials(first)],
  },

  // --- consequence 3: removing
  {
    name: "remove a photo that serves nothing: the base sentence only, no cache sentence",
    state: state({ directory: { photoId: B, attested: false } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase],
  },
  {
    name: "remove the directory photo (not cleared)",
    state: state({ listed: true, directory: { photoId: A, attested: false } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, C.removeIsDirectory(first)],
  },
  {
    name: "remove a photo that is both the directory and the website photo (consequence 3)",
    state: state({ listed: true, website: { photoId: A }, directory: { photoId: A, attested: true } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, C.removeIsDirectory(first), C.removeIsWebsite, C.removeCaches],
  },
  {
    name: "remove the website photo only",
    state: state({ listed: true, website: { photoId: A }, directory: { photoId: B, attested: true } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, C.removeIsWebsite, C.removeCaches],
  },
  {
    name: "remove a cleared directory photo the website is using as the fall-back",
    state: state({ listed: true, directory: { photoId: A, attested: true } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, C.removeIsDirectory(first), C.removeIsFallback, C.removeCaches],
  },
  {
    name: "remove a cleared directory photo while not listed: it is not on the website, so no website sentences",
    state: state({ listed: false, directory: { photoId: A, attested: true } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, C.removeIsDirectory(first)],
  },
];

describe("consequencesFor", () => {
  it.each(rows)("$name", ({ state: s, intent, expected }) => {
    expect(consequencesFor(s, intent)).toEqual(expected);
  });

  it("uses the person's name in every sentence that names them", () => {
    const lines = consequencesFor(state({ first: "Zelda", listed: true }), { kind: "designate_website", photoId: A });
    expect(lines.join(" ")).toContain("Zelda");
    expect(lines.join(" ")).not.toContain("{first}");
  });

  it("the website-removal sentences carry the residual a browser or an archive can keep (G9)", () => {
    const all = [
      ...consequencesFor(state({ listed: true, website: { photoId: A } }), { kind: "undesignate_website" }),
      ...consequencesFor(state({ listed: true, website: { photoId: A } }), { kind: "remove", photoId: A }),
    ].join(" ");
    expect(all).toContain("up to a day");
    expect(all).toContain("search engines or web archives");
    expect(all).toContain("stays in storage and can't be erased");
  });
});

describe("directoryPhotoServesWebsite mirrors the SQL fall-back rule", () => {
  it.each([
    [{ listed: true, website: null, directory: { photoId: A, attested: true } }, true],
    [{ listed: false, website: null, directory: { photoId: A, attested: true } }, false],
    [{ listed: true, website: { photoId: B }, directory: { photoId: A, attested: true } }, false],
    [{ listed: true, website: null, directory: { photoId: A, attested: false } }, false],
    [{ listed: true, website: null, directory: null }, false],
  ])("%j -> %s", (over, expected) => {
    expect(directoryPhotoServesWebsite(state(over))).toBe(expected);
  });
});
