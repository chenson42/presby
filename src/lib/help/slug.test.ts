import { describe, expect, it } from "vitest";
import { createSlugger, headingSlug } from "./slug";

describe("headingSlug", () => {
  it("lowercases and hyphenates words", () => {
    expect(headingSlug("Signing in with email")).toBe("signing-in-with-email");
  });
  it("drops apostrophes instead of hyphenating them", () => {
    expect(headingSlug("Why can't I see this?")).toBe("why-cant-i-see-this");
    expect(headingSlug("Your congregation’s website")).toBe("your-congregations-website");
  });
  it("collapses punctuation runs and trims hyphens", () => {
    expect(headingSlug("  --Step 1: (Sign in)!  ")).toBe("step-1-sign-in");
  });
  it("strips diacritics", () => {
    expect(headingSlug("Café hours")).toBe("cafe-hours");
  });
  it("returns an empty string when nothing sluggable is left", () => {
    expect(headingSlug("???")).toBe("");
  });
});

describe("createSlugger (per-document de-duplication)", () => {
  it("numbers repeats from -2", () => {
    const next = createSlugger();
    expect(next("Notes")).toBe("notes");
    expect(next("Notes")).toBe("notes-2");
    expect(next("Notes")).toBe("notes-3");
  });
  it("does not collide with a heading that is naturally called notes-2", () => {
    const next = createSlugger();
    expect(next("Notes 2")).toBe("notes-2");
    expect(next("Notes")).toBe("notes");
    expect(next("Notes")).toBe("notes-3");
  });
  it("gives an unsluggable heading a stable fallback", () => {
    const next = createSlugger();
    expect(next("???")).toBe("section");
    expect(next("!!!")).toBe("section-2");
  });
  it("is independent per slugger (per document)", () => {
    expect(createSlugger()("A")).toBe("a");
    expect(createSlugger()("A")).toBe("a");
  });
});
