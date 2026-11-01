import { describe, expect, it } from "vitest";
import * as hygiene from "./text-hygiene";
import * as careersText from "./careers/text";

describe("text-hygiene (lifted from careers/text.ts, CA12)", () => {
  it("careers/text re-exports the identical functions, so its importers are unchanged", () => {
    expect(careersText.charCount).toBe(hygiene.charCount);
    expect(careersText.cleanText).toBe(hygiene.cleanText);
    expect(careersText.normalizeMultiline).toBe(hygiene.normalizeMultiline);
    expect(Object.keys(careersText).sort()).toEqual(Object.keys(hygiene).sort());
  });

  it("counts an emoji as one character", () => {
    expect(hygiene.charCount("a\u{1F600}b")).toBe(3);
  });

  it("strips NUL, a bidi override and zero-width characters, then applies NFC", () => {
    expect(hygiene.cleanText("  Ann\u0000‮Z​z é ")).toBe("AnnZz é");
    expect(hygiene.normalizeMultiline("a\u0000b\r\nc‮d")).toBe("ab\ncd");
  });

  it("imports nothing server-side (a client island walks this file)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./text-hygiene.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
  });
});
