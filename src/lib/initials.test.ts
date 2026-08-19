/**
 * Tests for the avatar's letters.
 *
 * Small function, disproportionate blast radius: it runs on every signed-in
 * page for every user, and the inputs it has to survive are whatever people
 * actually typed into a name field — one word, four words, an empty string, a
 * name in a script with no Latin letters, or nothing at all.
 */

import { describe, expect, it } from "vitest";
import { accountLabel, initialsFrom } from "./initials";

describe("initialsFrom", () => {
  it("takes the first and last word of a two-word name", () => {
    expect(initialsFrom("Ada Lovelace", "ada@example.invalid")).toBe("AL");
  });

  it("drops the middle names rather than crowding the circle", () => {
    expect(initialsFrom("Mary Anne Evans Cross", null)).toBe("MC");
  });

  it("returns a single letter for a single-word name", () => {
    expect(initialsFrom("Prince", null)).toBe("P");
  });

  it("collapses runs of whitespace instead of emitting a blank initial", () => {
    expect(initialsFrom("  Ada   Lovelace  ", null)).toBe("AL");
  });

  it("uppercases a lowercase name", () => {
    expect(initialsFrom("ada lovelace", null)).toBe("AL");
  });

  it("preserves diacritics rather than stripping them", () => {
    // Getting people's names right is the product. "O" would be a small insult.
    expect(initialsFrom("Ólafur Árnason", null)).toBe("ÓÁ");
  });

  it("handles a non-Latin script on its own terms", () => {
    expect(initialsFrom("Ярослав Мудрий", null)).toBe("ЯМ");
  });

  it("skips leading punctuation instead of rendering it", () => {
    expect(initialsFrom("(Bob) Smith", null)).toBe("BS");
  });

  it("falls back to the email local part when the name is absent", () => {
    expect(initialsFrom(null, "wren@example.invalid")).toBe("W");
  });

  it("falls back to the email when the name is only whitespace", () => {
    expect(initialsFrom("   ", "wren@example.invalid")).toBe("W");
  });

  it("falls back to the email when the name is only punctuation", () => {
    // A name field containing "--" has no letters in it, so it cannot produce
    // an initial and must not produce a hyphen in a circle.
    expect(initialsFrom("--", "wren@example.invalid")).toBe("W");
  });

  it("skips a leading underscore in an email local part", () => {
    expect(initialsFrom(null, "_ops@example.invalid")).toBe("O");
  });

  it("renders a question mark rather than an empty circle when it has nothing", () => {
    // An empty circle reads as a rendering bug; "?" reads as missing data.
    expect(initialsFrom(null, null)).toBe("?");
    expect(initialsFrom("", "")).toBe("?");
  });
});

describe("accountLabel", () => {
  it("prefers the name", () => {
    expect(accountLabel("Ada Lovelace", "ada@example.invalid")).toBe(
      "Ada Lovelace",
    );
  });

  it("falls back to the email — never to the initials, which read as nonsense aloud", () => {
    expect(accountLabel(null, "ada@example.invalid")).toBe(
      "ada@example.invalid",
    );
    expect(accountLabel("  ", "ada@example.invalid")).toBe(
      "ada@example.invalid",
    );
  });

  it("has a last resort", () => {
    expect(accountLabel(null, null)).toBe("your account");
  });
});
