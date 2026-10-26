/**
 * T23 (Phase 5 run 3, R-e3): THE CLAIMS REGISTRY. Every consequence sentence carries the truth condition
 * it is allowed to rest on, and `consequencesFor` is run over the FULL product of the dimensions the
 * SQL and the roster read (720 worlds x 10 intents, `person-photo-world.ts`) and checked against the
 * GROUND TRUTH: publication, hide and merged all known, not the page's hedged view.
 *
 * Why this exists: three Phase 5 runs in a row failed copy truthfulness because each sentence was a
 * hand-written prediction guarded by a hand-written per-state predicate, and each sweep covered only
 * the dimensions its author remembered. Here the dimension list is a type (`World`), the
 * sentences are matched back to their keys by their rendered text, and an emitted string that maps to
 * no key, or to a key with no claim, FAILS.
 *
 *   S1 no lie             every emitted line's claim holds in the ground truth
 *   S2 no silent website change   if what the public website shows changes, a website line says so
 *   S3 no silent directory change on un-designate and remove
 *   S4 the residual       when a photo that shows leaves the website, the cache sentence is present
 *   S5 exhaustive         the registry's keys equal CONSEQUENCE_COPY's keys exactly
 *
 * To add a sentence: add the key to `CONSEQUENCE_COPY`, then its claim here. S5 fails until both exist.
 */
import { describe, expect, it } from "vitest";
import {
  INTENTS,
  WORLDS,
  applyIntentToWorld,
  factsOfWorld,
  snapshotOfWorld,
  worldKey,
  type World,
} from "@/lib/testing/person-photo-world";
import { consequencesFor, type PhotoIntent } from "./consequences";
import { CONSEQUENCE_COPY } from "./copy";
import { outcomeOfFacts, type DirectoryOutcome, type Outcomes, type WebsiteOutcome } from "./outcome";

type Key = keyof typeof CONSEQUENCE_COPY;
type Subject = "website" | "directory" | "residual";
interface Claim {
  subject: Subject;
  claim: (w: World, i: PhotoIntent, T0: Outcomes, T1: Outcomes) => boolean;
}

const FIRST = "Ada";

// ---- ground-truth helpers (the TRUTH, never the page's view)
const sel = (o: WebsiteOutcome | DirectoryOutcome): string | null => o.photoId;
const src = (o: WebsiteOutcome): "website" | "directory_attested" | null => (o.photoId === null ? null : o.source);
const shows = (o: WebsiteOutcome): boolean => o.photoId !== null && o.gate === "clear";
const dirShows = (o: DirectoryOutcome): boolean => o.photoId !== null && o.gate === "clear";
const photoOf = (i: PhotoIntent): string | null => ("photoId" in i ? i.photoId : null);
const truthOf = (w: World): Outcomes => outcomeOfFacts(factsOfWorld(w));

/** The truth condition each sentence may rest on (the design's R-e3 table). */
const CLAIMS: Record<Key, Claim> = {
  minorBlocked: { subject: "residual", claim: (w) => w.minor },
  directoryHidden: { subject: "directory", claim: (_w, _i, _T0, T1) => T1.directory.photoId !== null && T1.directory.gate === "hide_photo" },
  websiteHidden: { subject: "website", claim: (w) => w.hide !== "none" },
  websiteMerged: { subject: "website", claim: (w) => w.merged },
  directoryAlsoOnWebsite: {
    subject: "website",
    claim: (w, i, _T0, T1) => w.listed && sel(T1.website) === photoOf(i) && src(T1.website) === "directory_attested",
  },
  websiteListed: {
    subject: "website",
    claim: (w, i, _T0, T1) => w.listed && sel(T1.website) === photoOf(i) && src(T1.website) === "website",
  },
  websiteNotListed: { subject: "website", claim: (w) => !w.listed },
  websiteKeepsOther: {
    subject: "website",
    claim: (_w, i, _T0, T1) => sel(T1.website) !== null && sel(T1.website) !== photoOf(i) && src(T1.website) === "website",
  },
  websiteAlreadyUses: {
    subject: "website",
    claim: (_w, i, T0, T1) =>
      sel(T0.website) === photoOf(i) && src(T0.website) === "website" && JSON.stringify(T1.website) === JSON.stringify(T0.website),
  },
  websiteReplaces: {
    subject: "website",
    claim: (_w, i, T0, T1) => src(T0.website) === "website" && sel(T0.website) !== photoOf(i) && sel(T1.website) === photoOf(i),
  },
  directoryWebsiteWillStop: { subject: "website", claim: (_w, _i, T0, T1) => src(T0.website) === "directory_attested" && sel(T1.website) === null },
  directoryAlsoOnWebsiteEnds: { subject: "website", claim: (_w, _i, T0, T1) => src(T0.website) === "directory_attested" && sel(T1.website) === null },
  directoryInitials: { subject: "directory", claim: (_w, _i, T0, T1) => T0.directory.photoId !== null && T1.directory.photoId === null },
  websiteStops: { subject: "website", claim: (_w, _i, T0, T1) => src(T0.website) === "website" && sel(T1.website) !== sel(T0.website) },
  websiteFallsBack: { subject: "website", claim: (_w, _i, T0, T1) => sel(T1.website) !== sel(T0.website) && src(T1.website) === "directory_attested" },
  websiteShowsNone: { subject: "website", claim: (_w, _i, _T0, T1) => !shows(T1.website) },
  websiteUnchangedCleared: {
    subject: "website",
    claim: (_w, _i, T0, T1) =>
      sel(T1.website) === sel(T0.website) &&
      src(T0.website) === "website" &&
      src(T1.website) === "directory_attested" &&
      shows(T0.website) === shows(T1.website),
  },
  websiteTakeOffTip: {
    subject: "website",
    claim: (w, i) => sel(truthOf(applyIntentToWorld(applyIntentToWorld(w, i), { kind: "undesignate_directory" })).website) === null,
  },
  websiteCaches: { subject: "residual", claim: (_w, _i, T0, T1) => sel(T0.website) !== null && sel(T1.website) !== sel(T0.website) },
  removeBase: { subject: "residual", claim: () => true },
  removeIsDirectory: { subject: "directory", claim: (_w, i, T0, T1) => sel(T0.directory) === photoOf(i) && T1.directory.photoId === null },
  removeIsWebsite: {
    subject: "website",
    claim: (_w, i, T0, T1) => sel(T0.website) === photoOf(i) && src(T0.website) === "website" && sel(T1.website) !== photoOf(i),
  },
  removeIsWebsiteWithheld: {
    subject: "website",
    claim: (_w, i, T0, T1) =>
      sel(T0.website) === photoOf(i) && src(T0.website) === "website" && sel(T1.website) !== photoOf(i) && !shows(T0.website),
  },
  removeIsFallback: { subject: "website", claim: (_w, i, T0) => sel(T0.website) === photoOf(i) && src(T0.website) === "directory_attested" },
  removeCaches: { subject: "residual", claim: (_w, i, T0, T1) => sel(T0.website) === photoOf(i) && sel(T1.website) !== photoOf(i) },
};

/** Rendered text -> key, for the test person's first name. */
const RENDERED = new Map<string, Key>();
for (const key of Object.keys(CONSEQUENCE_COPY) as Key[]) {
  const entry = CONSEQUENCE_COPY[key] as string | ((first: string) => string);
  RENDERED.set(typeof entry === "function" ? entry(FIRST) : entry, key);
}

interface Seen {
  world: World;
  intent: PhotoIntent;
  lines: string[];
  keys: Array<Key | null>;
  T0: Outcomes;
  T1: Outcomes;
}

let memo: Seen[] | null = null;
function everything(): Seen[] {
  if (memo) return memo;
  memo = [];
  for (const world of WORLDS)
    for (const intent of INTENTS) {
      const lines = consequencesFor(snapshotOfWorld(world, FIRST), intent);
      memo.push({
        world,
        intent,
        lines,
        keys: lines.map((l) => RENDERED.get(l) ?? null),
        T0: truthOf(world),
        T1: truthOf(applyIntentToWorld(world, intent)),
      });
    }
  return memo;
}

const label = (s: Seen) => `${worldKey(s.world)} :: ${JSON.stringify(s.intent)}`;
/** The first few offenders, so a failure names the worlds (and the output stays readable). */
const report = (offenders: string[]) => offenders.slice(0, 12).concat(offenders.length > 12 ? [`... and ${offenders.length - 12} more (${offenders.length} total)`] : []);

describe("the claims registry over 720 worlds x 10 intents (T23)", () => {
  it("covers the whole product", () => {
    expect(WORLDS).toHaveLength(720);
    expect(INTENTS).toHaveLength(10);
    expect(everything()).toHaveLength(7200);
  });

  it("S5 exhaustive: the registry's keys equal CONSEQUENCE_COPY's keys exactly", () => {
    expect(Object.keys(CLAIMS).sort()).toEqual(Object.keys(CONSEQUENCE_COPY).sort());
  });

  it("every CONSEQUENCE_COPY sentence renders to a distinct string (a rendered line maps back to exactly one key)", () => {
    expect(RENDERED.size).toBe(Object.keys(CONSEQUENCE_COPY).length);
  });

  it("S1 no lie: every emitted line maps to a key with a claim, and the claim holds in the ground truth", () => {
    const offenders: string[] = [];
    for (const s of everything())
      s.keys.forEach((key, n) => {
        if (key === null) return void offenders.push(`${label(s)} :: emitted a string that maps to no key: "${s.lines[n]}"`);
        const entry = CLAIMS[key];
        if (!entry) return void offenders.push(`${label(s)} :: ${key} has no claim`);
        if (!entry.claim(s.world, s.intent, s.T0, s.T1)) offenders.push(`${label(s)} :: ${key} is false`);
      });
    expect(report(offenders)).toEqual([]);
  });

  it("S2 no silent website change: when what the website shows changes, a website-subject line says so", () => {
    const shownId = (o: WebsiteOutcome) => (shows(o) ? sel(o) : null);
    const offenders: string[] = [];
    for (const s of everything()) {
      if (shownId(s.T0.website) === shownId(s.T1.website)) continue;
      const says = s.keys.some((k) => k !== null && CLAIMS[k]?.subject === "website");
      if (!says) offenders.push(`${label(s)} :: website shows ${shownId(s.T0.website)} -> ${shownId(s.T1.website)} and no line says so`);
    }
    expect(report(offenders)).toEqual([]);
  });

  it("S3 no silent directory change: on un-designate and remove, a directory-subject line says so", () => {
    const shownId = (o: DirectoryOutcome) => (dirShows(o) ? sel(o) : null);
    const offenders: string[] = [];
    for (const s of everything()) {
      if (s.intent.kind !== "undesignate_directory" && s.intent.kind !== "remove") continue;
      if (shownId(s.T0.directory) === shownId(s.T1.directory)) continue;
      const says = s.keys.some((k) => k !== null && CLAIMS[k]?.subject === "directory");
      if (!says) offenders.push(`${label(s)} :: directory shows ${shownId(s.T0.directory)} -> ${shownId(s.T1.directory)} and no line says so`);
    }
    expect(report(offenders)).toEqual([]);
  });

  it("S4 the residual: when a photo that shows leaves the website, the cache sentence is present", () => {
    const offenders: string[] = [];
    for (const s of everything()) {
      if (s.intent.kind !== "undesignate_website" && s.intent.kind !== "remove") continue;
      if (!shows(s.T0.website) || sel(s.T1.website) === sel(s.T0.website)) continue;
      const want: Key = s.intent.kind === "remove" ? "removeCaches" : "websiteCaches";
      if (!s.keys.includes(want)) offenders.push(`${label(s)} :: a shown photo left the website and ${want} is absent`);
    }
    expect(report(offenders)).toEqual([]);
  });

  it("(e) QA run 3: 'Stop using on website' in the same-photo world never says the website stops using the photo", () => {
    const same = everything().filter(
      (s) => s.intent.kind === "undesignate_website" && s.world.website === "A" && s.world.directory?.photo === "A" && s.world.directory.attested,
    );
    expect(same).toHaveLength(2 * 2 * 2 * 2 * 3);
    for (const s of same) {
      expect(s.keys, label(s)).not.toContain("websiteStops");
      expect(s.keys, label(s)).toContain("websiteUnchangedCleared");
    }
  });
});
