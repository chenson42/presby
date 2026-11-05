import { describe, expect, it } from "vitest";
import {
  STARTER_KEYS,
  STARTER_POSITION_LIMIT,
  STARTER_SETS,
  isStarterKey,
  startersFor,
  suggestedKind,
} from "./starters";
import { LIMITS } from "./vocab";

describe("the starter sets (Copy G3)", () => {
  it("has the six sets and none, in the ruled order", () => {
    expect(STARTER_SETS.map((s) => s.label)).toEqual([
      "Praise band",
      "Choir",
      "Liturgical team",
      "Ushers",
      "Greeters",
      "Sound and projection",
      "None, I'll add my own",
    ]);
    expect(STARTER_SETS.map((s) => s.key)).toEqual([...STARTER_KEYS]);
  });

  it("praise band: Worship leader, Vocals (2 people), Acoustic guitar, Electric guitar, Bass, Drums, Keys", () => {
    expect(startersFor("praise_band")).toEqual([
      { name: "Worship leader", slots: 1 },
      { name: "Vocals", slots: 2 },
      { name: "Acoustic guitar", slots: 1 },
      { name: "Electric guitar", slots: 1 },
      { name: "Bass", slots: 1 },
      { name: "Drums", slots: 1 },
      { name: "Keys", slots: 1 },
    ]);
  });

  it("ushers and greeters seat two where Copy says so", () => {
    expect(startersFor("ushers")).toEqual([
      { name: "Head usher", slots: 1 },
      { name: "Usher", slots: 2 },
    ]);
    expect(startersFor("greeters")).toEqual([{ name: "Greeter", slots: 2 }]);
  });

  it("every starter respects the position limits and has no duplicate name (case-insensitive) in its set", () => {
    for (const set of STARTER_SETS) {
      expect(set.positions.length).toBeLessThanOrEqual(STARTER_POSITION_LIMIT);
      const names = set.positions.map((p) => p.name.toLowerCase());
      expect(new Set(names).size, set.key).toBe(names.length);
      for (const p of set.positions) {
        expect(p.name).toBe(p.name.trim());
        expect([...p.name].length).toBeLessThanOrEqual(LIMITS.positionName);
        expect(p.slots).toBeGreaterThanOrEqual(LIMITS.slotsMin);
        expect(p.slots).toBeLessThanOrEqual(LIMITS.slotsMax);
      }
    }
  });

  it("none, undefined and an unknown key create no positions", () => {
    expect(startersFor("none")).toEqual([]);
    expect(startersFor(undefined)).toEqual([]);
    expect(startersFor(null)).toEqual([]);
    expect(startersFor("nonsense" as never)).toEqual([]);
  });

  it("isStarterKey is exact; the choir starter suggests the Choir kind", () => {
    expect(isStarterKey("choir")).toBe(true);
    expect(isStarterKey("orchestra")).toBe(false);
    expect(suggestedKind("choir")).toBe("choir");
    expect(suggestedKind("ushers")).toBe("team");
  });
});
