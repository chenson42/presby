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
  minor: false,
  directoryWithheld: null,
  websiteWithheld: null,
  ...over,
});

/**
 * The replacement sentences of the Phase 5 run 1 copy rulings (R-a3, R-a6),
 * spelled out LITERALLY so a failing test names the old wording, not a pointer
 * to whatever `copy.ts` now says.
 */
const S = {
  directoryAlsoOnWebsite:
    "Because Ada is listed on the public website and has no website photo, this photo can also appear there while the website is published, unless something withholds it, such as Ada hiding their photo or appearing to be under 18.",
  websiteListed:
    "Ada is listed, so this photo can appear on the website while the website is published, unless something withholds it, such as Ada hiding their photo or appearing to be under 18.",
  minorBlocked: "Ada appears to be under 18, so a photo of Ada can't be chosen for the directory or the website yet.",
  directoryHidden: "Ada has hidden their photo, so the directory won't show this photo while that is so.",
  websiteHidden: "Ada has hidden their photo, so the website won't show this photo while that is so.",
  websiteMerged: "This record was merged into another, so the website won't show this photo.",
  removeIsWebsiteWithheld: "It is also their website photo, which the website isn't showing at the moment.",
  directoryInitials: "Wherever Ada appears in the directory, their initials will show instead.",
  removeIsDirectory: "It is Ada's directory photo, so wherever Ada appears in the directory it will show initials instead.",
} as const;

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
    expected: [S.directoryAlsoOnWebsite],
  },
  {
    name: "directory, cleared, but not listed: used on the website only if listed and no website photo",
    state: state({ listed: false }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [C.directoryWebsiteConditional(first)],
  },
  {
    name: "directory, cleared, listed, but a website photo exists: the conditional line, never the 'also appear' one",
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
    expected: [S.websiteListed],
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
    expected: [S.websiteListed, C.websiteReplaces],
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
    expected: [S.directoryInitials, C.directoryAlsoOnWebsiteEnds],
  },
  {
    name: "stop directory photo, cleared but not listed: initials only",
    state: state({ listed: false, directory: { photoId: A, attested: true } }),
    intent: { kind: "undesignate_directory" },
    expected: [S.directoryInitials],
  },
  {
    name: "stop directory photo, cleared and listed but a website photo is chosen: initials only",
    state: state({ listed: true, website: { photoId: B }, directory: { photoId: A, attested: true } }),
    intent: { kind: "undesignate_directory" },
    expected: [S.directoryInitials],
  },
  {
    name: "stop directory photo, not cleared: initials only",
    state: state({ listed: true, directory: { photoId: A, attested: false } }),
    intent: { kind: "undesignate_directory" },
    expected: [S.directoryInitials],
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
    expected: [C.removeBase, S.removeIsDirectory],
  },
  {
    name: "remove a photo that is both the directory and the website photo (consequence 3)",
    state: state({ listed: true, website: { photoId: A }, directory: { photoId: A, attested: true } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, S.removeIsDirectory, C.removeIsWebsite, C.removeCaches],
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
    expected: [C.removeBase, S.removeIsDirectory, C.removeIsFallback, C.removeCaches],
  },
  {
    name: "remove a cleared directory photo while not listed: it is not on the website, so no website sentences",
    state: state({ listed: false, directory: { photoId: A, attested: true } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, S.removeIsDirectory],
  },

  // --- Phase 5 run 1 (R-a4): withheld states and under-18, T1
  {
    name: "designate directory, person appears to be under 18: only the blocked sentence, ticked or not",
    state: state({ minor: true, listed: true }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [S.minorBlocked],
  },
  {
    name: "designate directory unticked, minor: only the blocked sentence",
    state: state({ minor: true }),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [S.minorBlocked],
  },
  {
    name: "designate website, minor: only the blocked sentence",
    state: state({ minor: true, listed: true }),
    intent: { kind: "designate_website", photoId: A },
    expected: [S.minorBlocked],
  },
  {
    name: "designate directory, directory withheld (hide_photo), unticked: the hidden sentence only",
    state: state({ directoryWithheld: "hide_photo", listed: true }),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [S.directoryHidden],
  },
  {
    name: "designate directory ticked, directory withheld, listed, no website photo: hidden sentence first, then the hedged website one",
    state: state({ directoryWithheld: "hide_photo", listed: true }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [S.directoryHidden, S.directoryAlsoOnWebsite],
  },
  {
    name: "designate directory ticked, website withheld (hide_photo): the website-hidden sentence replaces the website one",
    state: state({ directoryWithheld: "hide_photo", websiteWithheld: "hide_photo", listed: true }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [S.directoryHidden, S.websiteHidden],
  },
  {
    name: "designate directory ticked, website withheld (merged)",
    state: state({ websiteWithheld: "merged", listed: true }),
    intent: { kind: "designate_directory", photoId: A, attested: true },
    expected: [S.websiteMerged],
  },
  {
    name: "designate directory unticked, replacing a cleared photo, but the website is withheld: it is not using it, so no 'will show none' claim",
    state: state({ listed: true, directory: { photoId: B, attested: true }, websiteWithheld: "hide_photo" }),
    intent: { kind: "designate_directory", photoId: A, attested: false },
    expected: [],
  },
  {
    name: "designate website, website withheld (hide_photo), listed: the hidden sentence, never 'can appear'",
    state: state({ websiteWithheld: "hide_photo", listed: true }),
    intent: { kind: "designate_website", photoId: A },
    expected: [S.websiteHidden],
  },
  {
    name: "designate website, website withheld (merged), replacing another website photo",
    state: state({ websiteWithheld: "merged", listed: true, website: { photoId: B } }),
    intent: { kind: "designate_website", photoId: A },
    expected: [S.websiteMerged, C.websiteReplaces],
  },
  {
    name: "stop directory, cleared and listed but the website is withheld: initials only, no 'website is also using it'",
    state: state({ listed: true, directory: { photoId: A, attested: true }, websiteWithheld: "hide_photo" }),
    intent: { kind: "undesignate_directory" },
    expected: [S.directoryInitials],
  },
  {
    name: "stop directory, cleared and listed, minor: initials only",
    state: state({ listed: true, minor: true, directory: { photoId: A, attested: true } }),
    intent: { kind: "undesignate_directory" },
    expected: [S.directoryInitials],
  },
  {
    name: "stop website photo, cleared directory photo, but the person appears to be under 18: the website will show none (no fall-back)",
    state: state({ listed: true, minor: true, website: { photoId: A }, directory: { photoId: B, attested: true } }),
    intent: { kind: "undesignate_website" },
    expected: [C.websiteStops, C.websiteShowsNone(first), C.websiteCaches],
  },
  {
    name: "stop website photo, cleared directory photo, website withheld: the website will show none (no fall-back)",
    state: state({ listed: true, websiteWithheld: "hide_photo", website: { photoId: A }, directory: { photoId: B, attested: true } }),
    intent: { kind: "undesignate_website" },
    expected: [C.websiteStops, C.websiteShowsNone(first), C.websiteCaches],
  },
  {
    name: "remove the website photo of someone under 18: the withheld wording, not 'it will leave the public website'",
    state: state({ listed: true, minor: true, website: { photoId: A } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, S.removeIsWebsiteWithheld, C.removeCaches],
  },
  {
    name: "remove the website photo while the website is withheld (merged)",
    state: state({ listed: true, websiteWithheld: "merged", website: { photoId: A } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, S.removeIsWebsiteWithheld, C.removeCaches],
  },
  {
    name: "remove a cleared directory photo the website is NOT using because the person appears to be under 18: directory sentence only",
    state: state({ listed: true, minor: true, directory: { photoId: A, attested: true } }),
    intent: { kind: "remove", photoId: A },
    expected: [C.removeBase, S.removeIsDirectory],
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

/**
 * T2 (Phase 5 run 1): over the FULL product of the snapshot and the five
 * intents, no sentence promises "will appear", and no sentence promises the
 * website will use, show or lose a photo when something withholds it. The
 * three "will show no photo" claims hold whether or not the site is published,
 * so they are the only ones allowed to say "will show".
 */
describe("no consequence sentence promises what a withheld state would break (T2)", () => {
  const bools = [false, true];
  const directories: PhotoStateSnapshot["directory"][] = [null, { photoId: B, attested: false }, { photoId: B, attested: true }];
  const websites: PhotoStateSnapshot["website"][] = [null, { photoId: A }];
  const dirWithheld: PhotoStateSnapshot["directoryWithheld"][] = [null, "hide_photo"];
  const webWithheld: PhotoStateSnapshot["websiteWithheld"][] = [null, "hide_photo", "merged"];
  const intents: PhotoIntent[] = [
    { kind: "designate_directory", photoId: A, attested: false },
    { kind: "designate_directory", photoId: A, attested: true },
    { kind: "designate_website", photoId: A },
    { kind: "undesignate_directory" },
    { kind: "undesignate_website" },
    { kind: "remove", photoId: A },
    { kind: "remove", photoId: B },
  ];
  const states: PhotoStateSnapshot[] = [];
  for (const listed of bools)
    for (const minor of bools)
      for (const directory of directories)
        for (const website of websites)
          for (const directoryWithheld of dirWithheld)
            for (const websiteWithheld of webWithheld)
              states.push(state({ listed, minor, directory, website, directoryWithheld, websiteWithheld }));

  it("covers the whole product (a guard against the loops shrinking)", () => {
    expect(states.length).toBe(2 * 2 * 3 * 2 * 2 * 3);
  });

  it("never says 'will appear' or 'will also appear', in any state", () => {
    for (const s of states)
      for (const intent of intents)
        for (const line of consequencesFor(s, intent)) expect(line, JSON.stringify([s, intent])).not.toMatch(/will (also )?appear/);
  });

  it("when anything withholds the photo, never says the website will use, appear with, leave or fall back to one", () => {
    const withheld = states.filter((s) => s.minor || s.websiteWithheld !== null || s.directoryWithheld !== null);
    expect(withheld.length).toBeGreaterThan(0);
    for (const s of withheld)
      for (const intent of intents)
        for (const line of consequencesFor(s, intent))
          expect(line, JSON.stringify([s, intent])).not.toMatch(/will (also )?(appear|use|leave|fall back)/);
  });

  it("directoryPhotoServesWebsite is false for every withheld combination", () => {
    for (const s of states) {
      if (s.minor || s.websiteWithheld !== null || s.directoryWithheld !== null)
        expect(directoryPhotoServesWebsite(s), JSON.stringify(s)).toBe(false);
    }
  });
});

describe("directoryPhotoServesWebsite mirrors the SQL fall-back rule", () => {
  it.each([
    [{ listed: true, website: null, directory: { photoId: A, attested: true } }, true],
    [{ listed: false, website: null, directory: { photoId: A, attested: true } }, false],
    [{ listed: true, website: { photoId: B }, directory: { photoId: A, attested: true } }, false],
    [{ listed: true, website: null, directory: { photoId: A, attested: false } }, false],
    [{ listed: true, website: null, directory: null }, false],
    [{ listed: true, website: null, directory: { photoId: A, attested: true }, minor: true }, false],
    [{ listed: true, website: null, directory: { photoId: A, attested: true }, websiteWithheld: "hide_photo" }, false],
    [{ listed: true, website: null, directory: { photoId: A, attested: true }, websiteWithheld: "merged" }, false],
  ] as Array<[Partial<PhotoStateSnapshot>, boolean]>)("%j -> %s", (over, expected) => {
    expect(directoryPhotoServesWebsite(state(over))).toBe(expected);
  });
});
