import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COORDINATE_MESSAGES,
  mappablePair,
  parseCoordinateField,
  splitPastedPair,
  validateCoordinatePair,
} from "./coordinates";

describe("coordinates.ts is import-free", () => {
  it("has no import, require or dynamic import (safe for the client form, the write and the reader)", () => {
    const src = readFileSync(path.join(__dirname, "coordinates.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });
});

describe("parseCoordinateField", () => {
  it.each([null, undefined, "", "   ", "\t"])("treats %j as blank", (v) => {
    expect(parseCoordinateField(v)).toEqual({ kind: "blank" });
  });

  it.each([
    ["39.9612", 39.9612],
    ["-82.9988", -82.9988],
    ["+12", 12],
    [" 41 ", 41],
    [".5", 0.5],
    ["5.", 5],
    ["0", 0],
  ])("parses %j", (text, value) => {
    expect(parseCoordinateField(text)).toEqual({ kind: "number", value });
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e5", "1E5", "0x1", "39,9", "abc", "--1", "1 2", ".", "-", "1".repeat(400)])(
    "rejects %j",
    (text) => {
      expect(parseCoordinateField(text)).toEqual({ kind: "invalid" });
    },
  );
});

describe("mappablePair", () => {
  it("accepts a real pair", () => {
    expect(mappablePair(39.9612, -82.9988)).toEqual({ lat: 39.9612, lng: -82.9988 });
  });

  it("accepts the bounds", () => {
    expect(mappablePair(90, 180)).toEqual({ lat: 90, lng: 180 });
    expect(mappablePair(-90, -180)).toEqual({ lat: -90, lng: -180 });
  });

  it("accepts a point on one axis at zero", () => {
    expect(mappablePair(0, 10)).toEqual({ lat: 0, lng: 10 });
    expect(mappablePair(10, 0)).toEqual({ lat: 10, lng: 0 });
  });

  it.each([
    [90.0001, 0.5],
    [-90.0001, 0.5],
    [10, 180.0001],
    [10, -180.0001],
    [Number.NaN, 10],
    [10, Number.NaN],
    [Number.POSITIVE_INFINITY, 10],
    [10, Number.NEGATIVE_INFINITY],
    ["39.9", -82.9],
    [39.9, "-82.9"],
    [null, 10],
    [10, undefined],
    [0, 0],
    [-0, 0],
    [0, -0],
  ])("rejects (%j, %j)", (lat, lng) => {
    expect(mappablePair(lat, lng)).toBeNull();
  });
});

describe("validateCoordinatePair", () => {
  it("both blank is ok with no pair (clears the pin)", () => {
    expect(validateCoordinatePair(null, null)).toEqual({ ok: true, value: null });
    expect(validateCoordinatePair(undefined, undefined)).toEqual({ ok: true, value: null });
    expect(validateCoordinatePair(null, undefined)).toEqual({ ok: true, value: null });
  });

  it("a valid pair is ok", () => {
    expect(validateCoordinatePair(39.9612, -82.9988)).toEqual({
      ok: true,
      value: { lat: 39.9612, lng: -82.9988 },
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "39.9", {}, true])("refuses a non-finite-number latitude %j", (lat) => {
    expect(validateCoordinatePair(lat, -82)).toEqual({
      ok: false,
      field: "latitude",
      message: COORDINATE_MESSAGES.latitudeNumber,
    });
  });

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, "-82.9", []])("refuses a non-finite-number longitude %j", (lng) => {
    expect(validateCoordinatePair(39, lng)).toEqual({
      ok: false,
      field: "longitude",
      message: COORDINATE_MESSAGES.longitudeNumber,
    });
  });

  it("keeps the two existing range strings byte-identical", () => {
    expect(COORDINATE_MESSAGES.latitudeRange).toBe("Latitude must be between -90 and 90.");
    expect(COORDINATE_MESSAGES.longitudeRange).toBe("Longitude must be between -180 and 180.");
    expect(validateCoordinatePair(91, -82)).toEqual({ ok: false, field: "latitude", message: "Latitude must be between -90 and 90." });
    expect(validateCoordinatePair(39, -181)).toEqual({ ok: false, field: "longitude", message: "Longitude must be between -180 and 180." });
  });

  it("refuses a half-set pair and names the blank field", () => {
    expect(validateCoordinatePair(39, null)).toEqual({ ok: false, field: "longitude", message: COORDINATE_MESSAGES.halfSet });
    expect(validateCoordinatePair(undefined, -82)).toEqual({ ok: false, field: "latitude", message: COORDINATE_MESSAGES.halfSet });
  });

  it("refuses exactly 0 and 0 (and -0), naming latitude", () => {
    expect(validateCoordinatePair(0, 0)).toEqual({ ok: false, field: "latitude", message: COORDINATE_MESSAGES.zeroZero });
    expect(validateCoordinatePair(-0, 0)).toEqual({ ok: false, field: "latitude", message: COORDINATE_MESSAGES.zeroZero });
  });

  it("reports the first failure (latitude before longitude)", () => {
    expect(validateCoordinatePair(Number.NaN, 999)).toMatchObject({ field: "latitude" });
  });
});

describe("splitPastedPair", () => {
  it.each([
    ["39.9612, -82.9988", "39.9612", "-82.9988"],
    ["39.9612,-82.9988", "39.9612", "-82.9988"],
    ["39.9612 -82.9988", "39.9612", "-82.9988"],
    ["39.9612; -82.9988", "39.9612", "-82.9988"],
    ["  39.9612 ,  -82.9988  ", "39.9612", "-82.9988"],
    ["(39.9612, -82.9988)", "39.9612", "-82.9988"],
    ["39.9612°, -82.9988°", "39.9612", "-82.9988"],
    ["39.9612° -82.9988°", "39.9612", "-82.9988"],
    ["+39.9612, +82.9988", "+39.9612", "+82.9988"],
    ["39.961200, -82.998800", "39.961200", "-82.998800"],
    ["200, 300", "200", "300"],
  ])("splits %j", (text, latitude, longitude) => {
    expect(splitPastedPair(text)).toEqual({ latitude, longitude });
  });

  it.each([
    "",
    "   ",
    "39.9612",
    "39.9612, -82.9988, 5",
    "39.9612 -82.9988 5",
    "meet me at 39.9612, -82.9988",
    "39.9612-82.9988",
    "abc, def",
    "39.9612, abc",
    "1e5, 2",
  ])("leaves %j alone", (text) => {
    expect(splitPastedPair(text)).toBeNull();
  });
});
