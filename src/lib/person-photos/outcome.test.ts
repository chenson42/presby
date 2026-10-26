/**
 * T20 and T21 (Phase 5 run 3, R-e1, R-e3): the outcome mirror, pure.
 *
 * T20 pins `outcomeOfFacts` (the selection rule and the gate priority), `shiftOf`, and `applyIntent` on
 * hand-written rows, including the same-photo state (website A with directory A attested) that the
 * run 3 FAIL was about. T21 is the knowledge-soundness property over all 720 worlds: what the page can
 * read of a world never contradicts the ground truth. The mirror against the REAL SQL is
 * `outcome-parity.db.test.ts`.
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
import type { PhotoIntent, PhotoStateSnapshot } from "./consequences";
import {
  afterIntent,
  applyIntent,
  factsOfSnapshot,
  mayShow,
  outcomeOfFacts,
  outcomesOf,
  selectedId,
  shiftOf,
  sourceOf,
  type Facts,
  type WebsiteOutcome,
} from "./outcome";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const facts = (over: Partial<Facts> = {}): Facts => ({
  listed: true,
  published: true,
  minor: false,
  merged: false,
  hide: false,
  hideHere: false,
  website: null,
  directory: null,
  ...over,
});
const snap = (over: Partial<PhotoStateSnapshot> = {}): PhotoStateSnapshot => ({
  first: "Ada",
  listed: true,
  website: null,
  directory: null,
  minor: false,
  directoryWithheld: null,
  websiteWithheld: null,
  ...over,
});

describe("T20 outcomeOfFacts: the selection rule", () => {
  it("nothing designated selects nothing, on both surfaces", () => {
    expect(outcomeOfFacts(facts())).toEqual({ website: { photoId: null }, directory: { photoId: null } });
  });

  it("a website designation is selected, source website", () => {
    expect(outcomeOfFacts(facts({ website: { photoId: A } })).website).toEqual({ photoId: A, source: "website", gate: "clear" });
  });

  it("an ATTESTED directory designation stands in when there is no website photo", () => {
    expect(outcomeOfFacts(facts({ directory: { photoId: A, attested: true } })).website).toEqual({
      photoId: A,
      source: "directory_attested",
      gate: "clear",
    });
  });

  it("an UNATTESTED directory designation is no candidate for the website, but it is the directory photo", () => {
    const o = outcomeOfFacts(facts({ directory: { photoId: A, attested: false } }));
    expect(o.website).toEqual({ photoId: null });
    expect(o.directory).toEqual({ photoId: A, gate: "clear" });
  });

  it("a website designation beats the attested directory photo, even a DIFFERENT one", () => {
    expect(outcomeOfFacts(facts({ website: { photoId: A }, directory: { photoId: B, attested: true } })).website).toMatchObject({
      photoId: A,
      source: "website",
    });
  });

  it("the same photo as website photo and attested directory photo: selected once, source website, directory too", () => {
    const o = outcomeOfFacts(facts({ website: { photoId: A }, directory: { photoId: A, attested: true } }));
    expect(o.website).toEqual({ photoId: A, source: "website", gate: "clear" });
    expect(o.directory).toEqual({ photoId: A, gate: "clear" });
  });
});

describe("T20 outcomeOfFacts: the gate priority is the SQL's (minor, merged, hide_photo, then the roster gates)", () => {
  const w = { website: { photoId: A } } satisfies Partial<Facts>;
  it.each<[string, Partial<Facts>, string]>([
    ["everything clear", {}, "clear"],
    ["not published", { published: false }, "not_published"],
    ["not listed", { listed: false }, "not_listed"],
    ["not listed beats not published", { listed: false, published: false }, "not_listed"],
    ["hide beats the roster gates", { hide: true, listed: false, published: false }, "hide_photo"],
    ["merged beats hide", { merged: true, hide: true }, "merged"],
    ["minor beats merged", { minor: true, merged: true, hide: true }, "minor"],
  ])("%s -> %s", (_name, over, gate) => {
    expect(outcomeOfFacts(facts({ ...w, ...over })).website).toMatchObject({ gate });
  });

  it("the directory gate is minor, then hide set at THIS organization, and has no merged or roster gate", () => {
    const d = { directory: { photoId: A, attested: false } };
    expect(outcomeOfFacts(facts({ ...d, merged: true, listed: false, published: false })).directory).toEqual({ photoId: A, gate: "clear" });
    expect(outcomeOfFacts(facts({ ...d, hide: true, hideHere: false })).directory).toEqual({ photoId: A, gate: "clear" });
    expect(outcomeOfFacts(facts({ ...d, hide: true, hideHere: true })).directory).toEqual({ photoId: A, gate: "hide_photo" });
    expect(outcomeOfFacts(facts({ ...d, hide: true, hideHere: true, minor: true })).directory).toEqual({ photoId: A, gate: "minor" });
  });

  it("a hide set at ANOTHER organization withholds the website photo but not this directory photo", () => {
    const o = outcomeOfFacts(facts({ website: { photoId: A }, directory: { photoId: A, attested: true }, hide: true, hideHere: false }));
    expect(o.website).toMatchObject({ gate: "hide_photo" });
    expect(o.directory).toEqual({ photoId: A, gate: "clear" });
  });
});

describe("T20 mayShow, sourceOf, selectedId", () => {
  it("mayShow is 'nothing the page knows withholds it': a selected photo with a clear gate", () => {
    expect(mayShow({ photoId: null })).toBe(false);
    expect(mayShow({ photoId: A, source: "website", gate: "clear" })).toBe(true);
    for (const gate of ["minor", "merged", "hide_photo", "not_listed", "not_published"] as const)
      expect(mayShow({ photoId: A, source: "website", gate })).toBe(false);
  });

  it("sourceOf and selectedId read the selection", () => {
    expect(sourceOf({ photoId: null })).toBeNull();
    expect(sourceOf({ photoId: A, source: "directory_attested", gate: "clear" })).toBe("directory_attested");
    expect(selectedId({ photoId: A, gate: "clear" })).toBe(A);
    expect(selectedId({ photoId: null })).toBeNull();
  });
});

describe("T20 shiftOf: what a click does to the selected photo id", () => {
  const sel = (photoId: string, source: "website" | "directory_attested" = "website"): WebsiteOutcome => ({ photoId, source, gate: "clear" });
  const none: WebsiteOutcome = { photoId: null };
  it.each<[string, WebsiteOutcome, WebsiteOutcome, string]>([
    ["none to none", none, none, "none"],
    ["none to a photo", none, sel(A), "begins"],
    ["a photo to none", sel(A), none, "ends"],
    ["a photo to a different photo", sel(A), sel(B), "moves"],
    ["the same photo", sel(A), sel(A), "unchanged"],
    ["the same photo through a different source", sel(A, "website"), sel(A, "directory_attested"), "unchanged"],
  ])("%s", (_name, before, after, shift) => {
    expect(shiftOf(before, after)).toBe(shift);
  });

  it("stopping the website designation of a photo that is also the cleared directory photo is 'unchanged' (the run 3 defect)", () => {
    const s = snap({ website: { photoId: A }, directory: { photoId: A, attested: true } });
    expect(shiftOf(outcomesOf(s).website, afterIntent(s, { kind: "undesignate_website" }).website)).toBe("unchanged");
  });

  it("stopping it with a DIFFERENT cleared directory photo is 'moves', and with an uncleared one is 'ends'", () => {
    const moves = snap({ website: { photoId: A }, directory: { photoId: B, attested: true } });
    expect(shiftOf(outcomesOf(moves).website, afterIntent(moves, { kind: "undesignate_website" }).website)).toBe("moves");
    const ends = snap({ website: { photoId: A }, directory: { photoId: B, attested: false } });
    expect(shiftOf(outcomesOf(ends).website, afterIntent(ends, { kind: "undesignate_website" }).website)).toBe("ends");
  });
});

describe("T20 applyIntent: what the store does to the designations, and nothing else", () => {
  const full = snap({ website: { photoId: A }, directory: { photoId: B, attested: true }, websiteWithheld: "hide_photo", listed: false });

  it("designate_directory sets the directory designation and its attestation", () => {
    expect(applyIntent(full, { kind: "designate_directory", photoId: A, attested: false })).toEqual({ ...full, directory: { photoId: A, attested: false } });
  });
  it("designate_website sets the website designation", () => {
    expect(applyIntent(full, { kind: "designate_website", photoId: B })).toEqual({ ...full, website: { photoId: B } });
  });
  it("undesignate_directory and undesignate_website null their field", () => {
    expect(applyIntent(full, { kind: "undesignate_directory" })).toEqual({ ...full, directory: null });
    expect(applyIntent(full, { kind: "undesignate_website" })).toEqual({ ...full, website: null });
  });
  it("remove nulls BOTH fields that name the photo, and only those", () => {
    const both = snap({ website: { photoId: A }, directory: { photoId: A, attested: true } });
    expect(applyIntent(both, { kind: "remove", photoId: A })).toEqual({ ...both, website: null, directory: null });
    expect(applyIntent(full, { kind: "remove", photoId: A })).toEqual({ ...full, website: null });
    expect(applyIntent(full, { kind: "remove", photoId: B })).toEqual({ ...full, directory: null });
    expect(applyIntent(full, { kind: "remove", photoId: "00000000-0000-4000-8000-0000000000ff" })).toEqual(full);
  });
  it("a designate for a person who appears to be under 18 is refused by the store: the state is unchanged", () => {
    const minor = snap({ minor: true, website: { photoId: A } });
    for (const intent of [
      { kind: "designate_directory", photoId: B, attested: true },
      { kind: "designate_directory", photoId: B, attested: false },
      { kind: "designate_website", photoId: B },
    ] satisfies PhotoIntent[])
      expect(applyIntent(minor, intent)).toBe(minor);
    // un-designating and removing a minor's photo is never refused
    expect(applyIntent(minor, { kind: "undesignate_website" }).website).toBeNull();
    expect(applyIntent(minor, { kind: "remove", photoId: A }).website).toBeNull();
  });
  it("carries the person-level fields unchanged", () => {
    const after = applyIntent(full, { kind: "undesignate_website" });
    expect({ listed: after.listed, minor: after.minor, websiteWithheld: after.websiteWithheld }).toEqual({
      listed: false,
      minor: false,
      websiteWithheld: "hide_photo",
    });
  });
});

describe("T20 factsOfSnapshot: unknown is clear", () => {
  it("reads published as true, and merged and hide only from what the snapshot reports", () => {
    expect(factsOfSnapshot(snap())).toMatchObject({ published: true, merged: false, hide: false, hideHere: false });
    expect(factsOfSnapshot(snap({ websiteWithheld: "merged" }))).toMatchObject({ merged: true, hide: false });
    expect(factsOfSnapshot(snap({ websiteWithheld: "hide_photo" }))).toMatchObject({ hide: true, hideHere: false });
    expect(factsOfSnapshot(snap({ directoryWithheld: "hide_photo" }))).toMatchObject({ hide: true, hideHere: true });
  });
});

describe("T21 the world and what the page can know of it", () => {
  it("the product is 720 worlds, all distinct, including website A with directory A attested and unattested", () => {
    expect(WORLDS).toHaveLength(2 * 2 * 2 * 2 * 3 * 15);
    expect(new Set(WORLDS.map(worldKey)).size).toBe(720);
    expect(INTENTS).toHaveLength(10);
    const same = (attested: boolean) => (w: World) => w.website === "A" && w.directory?.photo === "A" && w.directory.attested === attested;
    expect(WORLDS.some(same(true))).toBe(true);
    expect(WORLDS.some(same(false))).toBe(true);
  });

  it("snapshotOfWorld: no candidate, minor and no directory designation report no withheld answer", () => {
    const base: World = { listed: true, published: true, minor: false, merged: true, hide: "other_org", website: null, directory: null };
    // nothing designated: the SQL functions return no row, so hide and merged are unreadable
    expect(snapshotOfWorld(base)).toMatchObject({ websiteWithheld: null, directoryWithheld: null });
    // an unattested directory photo is no website candidate, and the directory hide is scoped to this org
    expect(snapshotOfWorld({ ...base, directory: { photo: "A", attested: false } })).toMatchObject({ websiteWithheld: null, directoryWithheld: null });
    expect(snapshotOfWorld({ ...base, hide: "this_org", directory: { photo: "A", attested: false } })).toMatchObject({
      websiteWithheld: null,
      directoryWithheld: "hide_photo",
    });
    // a candidate exists: merged wins over hide on the website line
    expect(snapshotOfWorld({ ...base, website: "A" })).toMatchObject({ websiteWithheld: "merged" });
    expect(snapshotOfWorld({ ...base, merged: false, website: "A" })).toMatchObject({ websiteWithheld: "hide_photo" });
    // minor is its own field and silences both answers
    expect(snapshotOfWorld({ ...base, minor: true, website: "A", directory: { photo: "A", attested: true }, hide: "this_org" })).toMatchObject({
      minor: true,
      websiteWithheld: null,
      directoryWithheld: null,
    });
  });

  it("KNOWLEDGE IS SOUND over all 720 worlds: the page's outcomes never contradict the ground truth", () => {
    for (const w of WORLDS) {
      const truth = outcomeOfFacts(factsOfWorld(w));
      const known = outcomesOf(snapshotOfWorld(w));
      const label = worldKey(w);
      // the selected photo ids are always known
      expect(selectedId(known.website), label).toBe(selectedId(truth.website));
      expect(selectedId(known.directory), label).toBe(selectedId(truth.directory));
      if (known.website.photoId !== null && truth.website.photoId !== null) {
        expect(sourceOf(known.website), label).toBe(sourceOf(truth.website));
        const kg = known.website.gate;
        const tg = truth.website.gate;
        // a gate the page names is the truth's
        if (kg === "minor" || kg === "merged" || kg === "hide_photo" || kg === "not_listed") expect(tg, label).toBe(kg);
        // 'clear' means only that nothing readable withholds it: the unreadable ones are the exceptions
        if (kg === "clear") expect(["clear", "hide_photo", "merged", "not_published"], label).toContain(tg);
      }
      // the directory answer is exactly known whenever a directory designation exists
      expect(known.directory, label).toEqual(truth.directory);
    }
  });

  it("the world transitions agree with the mirror's applyIntent on the designations (the DB test pins both to the store)", () => {
    for (const w of WORLDS)
      for (const i of INTENTS) {
        const viaWorld = outcomeOfFacts(factsOfWorld(applyIntentToWorld(w, i)));
        // apply on the world's own snapshot: ids are symbolic, so selection and directory outcome must agree
        const viaMirror = outcomesOf(applyIntent(snapshotOfWorld(w), i));
        expect(selectedId(viaMirror.website), `${worldKey(w)} ${JSON.stringify(i)}`).toBe(selectedId(viaWorld.website));
        expect(selectedId(viaMirror.directory), `${worldKey(w)} ${JSON.stringify(i)}`).toBe(selectedId(viaWorld.directory));
      }
  });
});
