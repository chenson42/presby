import { describe, expect, it } from "vitest";
import { SLUG_RE, isValidSlug, slugCandidate, slugFromTitle } from "./slug";

describe("slugFromTitle", () => {
  it("lower-cases and hyphenates", () => {
    expect(slugFromTitle("Music Director")).toBe("music-director");
    expect(slugFromTitle("  Part-Time   Sexton!! ")).toBe("part-time-sexton");
  });

  it("strips diacritics and folds compatibility characters", () => {
    expect(slugFromTitle("Directeur de la Musique, Église")).toBe("directeur-de-la-musique-eglise");
    expect(slugFromTitle("Ｏｆｆｉｃｅ　Ｍａｎａｇｅｒ")).toBe("office-manager");
  });

  it("collapses punctuation runs and trims hyphens", () => {
    expect(slugFromTitle("--A & B / C--")).toBe("a-b-c");
  });

  it("falls back to 'opening' when nothing is left", () => {
    expect(slugFromTitle("!!!")).toBe("opening");
    expect(slugFromTitle("")).toBe("opening");
    expect(slugFromTitle("音楽監督")).toBe("opening");
  });

  it("cuts a long title at 60 on a hyphen boundary", () => {
    const title = "Associate Pastor for Youth and Family Ministries and Community Outreach Programs";
    const slug = slugFromTitle(title);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
    expect("associate-pastor-for-youth-and-family-ministries-and-community-outreach-programs".startsWith(slug)).toBe(true);
    // never mid-word: the next character in the full slug is a hyphen
    const full = "associate-pastor-for-youth-and-family-ministries-and-community-outreach-programs";
    expect(full[slug.length]).toBe("-");
  });

  it("keeps a head that ends exactly at the cut (the next character is a hyphen)", () => {
    const head = `${"a".repeat(29)}-${"b".repeat(30)}`; // 60 characters
    expect(head).toHaveLength(60);
    expect(slugFromTitle(`${head} tail`)).toBe(head);
  });

  it("cuts one unbroken 200-character word hard at 60", () => {
    expect(slugFromTitle("x".repeat(200))).toBe("x".repeat(60));
  });

  it("every result satisfies the database's shape", () => {
    for (const title of ["A", "9 lives", "Ünïcödé", "x".repeat(200), "!!!", "a-b--c", "Pastor (Interim)"]) {
      const slug = slugFromTitle(title);
      expect(SLUG_RE.test(slug), title).toBe(true);
      expect(isValidSlug(slug), title).toBe(true);
    }
  });
});

describe("slugCandidate", () => {
  it("is the base, then base-2, base-3", () => {
    expect(slugCandidate("sexton", 1)).toBe("sexton");
    expect(slugCandidate("sexton", 2)).toBe("sexton-2");
    expect(slugCandidate("sexton", 50)).toBe("sexton-50");
  });

  it("a suffixed 60-character base still fits 80", () => {
    expect(slugCandidate("x".repeat(60), 50).length).toBeLessThanOrEqual(80);
  });
});

describe("isValidSlug", () => {
  it("matches the CHECK", () => {
    expect(isValidSlug("music-director")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("a".repeat(80))).toBe(true);
    expect(isValidSlug("a".repeat(81))).toBe(false);
    for (const bad of ["", "Music", "a b", "-a", "a-", "a--b", "../x", "a_b"]) {
      expect(isValidSlug(bad), bad).toBe(false);
    }
  });
});
