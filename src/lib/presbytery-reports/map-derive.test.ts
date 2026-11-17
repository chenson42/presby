import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveViabilityMap, toClientPins, type MapFact } from "./map-derive";
import { VIABILITY_LABELS, VIABILITY_NOT_ASSESSED } from "./derive";

const ROSTER = [
  { id: "00000000-0000-4000-8000-00000000000a", name: "Alder Creek" },
  { id: "00000000-0000-4000-8000-00000000000b", name: "Birch Hollow" },
  { id: "00000000-0000-4000-8000-00000000000c", name: "Cedar Ford" },
];
const [A, B, C] = ROSTER.map((r) => r.id) as [string, string, string];

const fact = (aboutOrgId: string, over: Partial<MapFact> = {}): MapFact => ({
  aboutOrgId,
  viabilityScore: 2,
  latitude: "39.9612",
  longitude: "-82.9988",
  ...over,
});

describe("deriveViabilityMap", () => {
  it("places a congregation with a usable pair, labelled by the list's own table", () => {
    const data = deriveViabilityMap(ROSTER, [fact(A, { viabilityScore: 1 }), fact(B, { viabilityScore: 3 }), fact(C, { viabilityScore: null })]);
    expect(data.total).toBe(3);
    expect(data.unplaced).toEqual([]);
    expect(data.pins.map((p) => [p.name, p.score, p.label])).toEqual([
      ["Alder Creek", 1, VIABILITY_LABELS[1]],
      ["Birch Hollow", 3, VIABILITY_LABELS[3]],
      ["Cedar Ford", null, VIABILITY_NOT_ASSESSED],
    ]);
    expect(data.pins[0]).toMatchObject({ lat: 39.9612, lng: -82.9988 });
  });

  it("keeps roster order for pins and for the unplaced list", () => {
    const data = deriveViabilityMap(ROSTER, [fact(C), fact(A, { latitude: null, longitude: null })]);
    expect(data.pins.map((p) => p.name)).toEqual(["Cedar Ford"]);
    expect(data.unplaced.map((u) => u.name)).toEqual(["Alder Creek", "Birch Hollow"]);
  });

  it("a congregation with no oversight row is unplaced, not dropped", () => {
    const data = deriveViabilityMap(ROSTER, [fact(A)]);
    expect(data.unplaced).toEqual([
      { id: B, name: "Birch Hollow" },
      { id: C, name: "Cedar Ford" },
    ]);
    expect(data.pins.length + data.unplaced.length).toBe(data.total);
  });

  it.each([
    ["NaN", "NaN", "-82.9"],
    ["Infinity", "Infinity", "-82.9"],
    ["a longitude of -Infinity", "39.9", "-Infinity"],
    ["empty strings", "", ""],
    ["a half-set pair (latitude only)", "39.9", null],
    ["a half-set pair (longitude only)", null, "-82.9"],
    ["scientific notation", "1e5", "-82.9"],
    ["out-of-range latitude", "91", "-82.9"],
    ["out-of-range longitude", "39.9", "-181"],
    ["exactly 0 and 0", "0", "0"],
    ["0.000 and 0.000", "0.000", "0.000"],
    ["garbage", "north", "west"],
  ])("a stored %s is unplaced, never a pin", (_name, latitude, longitude) => {
    const data = deriveViabilityMap([ROSTER[0]!], [fact(A, { latitude, longitude })]);
    expect(data.pins).toEqual([]);
    expect(data.unplaced).toEqual([{ id: A, name: "Alder Creek" }]);
  });

  it("a point with one axis at zero is a real location", () => {
    expect(deriveViabilityMap([ROSTER[0]!], [fact(A, { latitude: "0", longitude: "10" })]).pins).toHaveLength(1);
  });

  it("ignores a fact for a congregation that is not on the roster (a departed one never enters)", () => {
    const data = deriveViabilityMap([ROSTER[0]!], [fact(A), fact(B), fact("not-on-the-roster")]);
    expect(data.total).toBe(1);
    expect(data.pins.map((p) => p.id)).toEqual([A]);
    expect(data.unplaced).toEqual([]);
  });

  it("an empty roster is an empty map", () => {
    expect(deriveViabilityMap([], [fact(A)])).toEqual({ total: 0, pins: [], unplaced: [] });
  });

  it("throws the list's RangeError on a score outside 1 to 3, so the map degrades like the list", () => {
    expect(() => deriveViabilityMap([ROSTER[0]!], [fact(A, { viabilityScore: 9 })])).toThrow(RangeError);
  });

  it("does not throw for a corrupt score on a row that is unplaced anyway", () => {
    expect(() => deriveViabilityMap([ROSTER[0]!], [fact(A, { viabilityScore: 9, latitude: null, longitude: null })])).not.toThrow();
  });
});

describe("toClientPins", () => {
  const data = deriveViabilityMap(ROSTER, [fact(A, { viabilityScore: 1 })]);

  it("a client pin has EXACTLY seven keys (nothing else about a congregation reaches the browser)", () => {
    const [pin] = toClientPins(data, "northern", true);
    expect(Object.keys(pin!).sort()).toEqual(["href", "id", "lat", "lng", "label", "name", "score"].sort());
  });

  it("builds the href from the slug and the id only, when the oversight flag is on", () => {
    const [pin] = toClientPins(data, "northern", true);
    expect(pin!.href).toBe(`/o/northern/admin/oversight/${A}`);
    expect(pin!.href).not.toContain("Alder");
  });

  it("is null with the oversight flag off", () => {
    expect(toClientPins(data, "northern", false)[0]!.href).toBeNull();
  });

  it("a hostile name is carried as data and never enters an href", () => {
    const hostile = deriveViabilityMap([{ id: A, name: '<img src=x onerror=alert(1)>"' }], [fact(A)]);
    const [pin] = toClientPins(hostile, "northern", true);
    expect(pin!.name).toBe('<img src=x onerror=alert(1)>"');
    expect(pin!.href).toBe(`/o/northern/admin/oversight/${A}`);
  });

  it("serializes to nothing but the seven fields and the pin data", () => {
    const json = JSON.stringify(toClientPins(data, "northern", true));
    for (const banned of ["notes", "buildings", "insurance", "redevelopment", "updatedAt", "unplaced", "total"]) {
      expect(json).not.toContain(banned);
    }
  });
});

describe("map-derive.ts is pure", () => {
  it("imports only the coordinate rule and derive.ts (no database, no server-only, no Number( parsing)", () => {
    const src = readFileSync(path.join(__dirname, "map-derive.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./derive", "@/lib/coordinates"]);
    expect(src).not.toMatch(/server-only/);
    expect(src).not.toMatch(/\bNumber\(|\bparseInt\(|\bparseFloat\(/);
  });
});
