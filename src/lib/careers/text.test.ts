import { describe, expect, it } from "vitest";
import { charCount, cleanText, normalizeMultiline } from "./text";

describe("charCount", () => {
  it("counts code points, not UTF-16 units (Postgres char_length)", () => {
    expect(charCount("abc")).toBe(3);
    expect(charCount("\u{1F600}")).toBe(1);
    expect("\u{1F600}".length).toBe(2);
    expect(charCount("")).toBe(0);
  });
});

describe("normalizeMultiline", () => {
  it("turns CRLF and a lone CR into LF", () => {
    expect(normalizeMultiline("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("keeps newline and tab, removes every other control character", () => {
    expect(normalizeMultiline("a\tb\nc\u0000d\u0007e\u007Ff\u0085g\u009Fh")).toBe("a\tb\ncdefgh");
  });

  it("removes bidi controls and zero-width characters", () => {
    const hostile = "Pay‮gnirts‬ ⁦x⁩‎‏​‌‍⁠﻿ok";
    expect(normalizeMultiline(hostile)).toBe("Paygnirts xok");
  });

  it("puts the text in NFC", () => {
    expect(normalizeMultiline("é")).toBe("é");
  });

  it("is idempotent", () => {
    const once = normalizeMultiline("A\r\n‮B́\u0000\n");
    expect(normalizeMultiline(once)).toBe(once);
  });

  it("does not trim", () => {
    expect(normalizeMultiline("  a  \n")).toBe("  a  \n");
  });
});

describe("cleanText", () => {
  it("removes newlines and tabs as well, and trims", () => {
    expect(cleanText("  Church\n Administrator\t ")).toBe("Church Administrator");
  });

  it("removes bidi, zero-width and control characters", () => {
    expect(cleanText("Mu‮sic​ Di\u0000rector")).toBe("Music Director");
  });

  it("is NFC and idempotent", () => {
    const once = cleanText(" Café ");
    expect(once).toBe("Café");
    expect(cleanText(once)).toBe(once);
  });
});
