import { describe, expect, it } from "vitest";
import { cleanText, textLength } from "./text";

describe("cleanText (the TypeScript twin of presby_reimbursement__clean_text)", () => {
  it("is null for null, undefined, empty and whitespace-only", () => {
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText("")).toBeNull();
    expect(cleanText("   \t\n  ")).toBeNull();
  });

  it("collapses runs of whitespace to one space and trims", () => {
    expect(cleanText("  folding   chairs\tfor\nthe  hall \r\n")).toBe("folding chairs for the hall");
  });

  it("turns line breaks (incl. NEL, LS, PS) into spaces, so a pasted multi-line note stays one line", () => {
    expect(cleanText("a\u0085b c d")).toBe("a b c d");
  });

  it("removes other control characters, bidi controls and zero-width characters (EC37)", () => {
    expect(cleanText("pa\u0000in\u0007t")).toBe("paint");
    expect(cleanText("a​b‍c﻿d")).toBe("abcd");
    expect(cleanText("gift ‮gnp.exe‬")).toBe("gift gnp.exe");
    expect(cleanText("x⁦y⁩z⁠")).toBe("xyz");
    expect(cleanText("\u007Fdel\u0090")).toBe("del");
  });

  it("applies NFC", () => {
    expect(cleanText("Café")).toBe("Café");
    expect(cleanText("Café")).toBe(cleanText("Café"));
  });

  it("keeps ordinary punctuation, digits, emoji and non-Latin text", () => {
    expect(cleanText("Paint & brushes (2 gal.) - $41.50, 100%")).toBe("Paint & brushes (2 gal.) - $41.50, 100%");
    expect(cleanText("Kerzen – für die Weihnachtsandacht")).toBe("Kerzen – für die Weihnachtsandacht");
  });

  it("does not interpret markup: it is plain text, escaped by the renderer", () => {
    expect(cleanText("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

describe("textLength (as char_length counts)", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(textLength("abc")).toBe(3);
    expect(textLength("a\u{1F600}b")).toBe(3);
    expect(textLength("")).toBe(0);
  });
});
