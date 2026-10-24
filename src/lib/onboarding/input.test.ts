import { describe, it, expect } from "vitest";
import {
  normalizeInvitationEmail,
  normalizePersonName,
  passwordProblem,
  UUID_RE,
} from "./input";

describe("normalizeInvitationEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeInvitationEmail("  Marie.Doe@Example.INVALID ")).toBe("marie.doe@example.invalid");
  });
  it.each(["", "   ", "no-at-sign", "two@@example.invalid", "a b@example.invalid", "a@b c", "@example.invalid", "a@"])(
    "rejects %j",
    (value) => {
      expect(normalizeInvitationEmail(value)).toBeNull();
    },
  );
  it("rejects non-strings and over-length addresses", () => {
    expect(normalizeInvitationEmail(null)).toBeNull();
    expect(normalizeInvitationEmail(42)).toBeNull();
    expect(normalizeInvitationEmail(`${"a".repeat(310)}@example.invalid`)).toBeNull();
    expect(normalizeInvitationEmail(`${"a".repeat(300)}@example.invalid`)).not.toBeNull();
  });
});

describe("normalizePersonName", () => {
  it("trims, NFC-normalizes and strips control characters", () => {
    expect(normalizePersonName("  Marie\u0000 ")).toBe("Marie");
    expect(normalizePersonName("José")).toBe("José"); // e + combining acute -> precomposed
    expect(normalizePersonName("A\nB")).toBe("AB");
  });
  it("strips bidirectional override, embedding and isolate controls (they could reorder a sentence that shows the name)", () => {
    expect(normalizePersonName("Marie\u202eDoe")).toBe("MarieDoe");
    expect(normalizePersonName("\u202aMarie\u202c")).toBe("Marie");
    expect(normalizePersonName("\u2066Marie\u2069 Doe")).toBe("Marie Doe");
    expect(normalizePersonName("\u202e\u2066")).toBeNull();
    // Ordinary right-to-left letters and the benign marks are untouched.
    expect(normalizePersonName("שלום")).toBe("שלום");
  });
  it("rejects empty, whitespace-only, control-only and over-100 names", () => {
    expect(normalizePersonName("")).toBeNull();
    expect(normalizePersonName("   ")).toBeNull();
    expect(normalizePersonName("\u0000\u0007")).toBeNull();
    expect(normalizePersonName("x".repeat(101))).toBeNull();
    expect(normalizePersonName("x".repeat(100))).toBe("x".repeat(100));
    expect(normalizePersonName(undefined)).toBeNull();
  });
  it("produces a value the names_shape CHECK accepts (already trimmed)", () => {
    const stored = normalizePersonName("\t Marie Doe \n")!;
    expect(stored).toBe(stored.trim());
  });
});

describe("passwordProblem", () => {
  it("requires 8 characters", () => {
    expect(passwordProblem("1234567")).toBe("too_short");
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("")).toBe("too_short");
    expect(passwordProblem(undefined)).toBe("too_short");
  });
  it("caps at 72 BYTES of UTF-8, not 72 characters", () => {
    expect(passwordProblem("a".repeat(72))).toBeNull();
    expect(passwordProblem("a".repeat(73))).toBe("too_long");
    // 36 two-byte characters = 72 bytes (ok); 37 = 74 bytes (too long) though only 37 characters.
    expect(passwordProblem("é".repeat(36))).toBeNull();
    expect(passwordProblem("é".repeat(37))).toBe("too_long");
    // Emoji are 4 bytes: 18 of them = 72 bytes, 19 = 76.
    expect(passwordProblem("\u{1F600}".repeat(18))).toBeNull();
    expect(passwordProblem("\u{1F600}".repeat(19))).toBe("too_long");
  });
  it("counts characters (code points), not UTF-16 units, for the minimum", () => {
    expect(passwordProblem("\u{1F600}".repeat(7))).toBe("too_short");
    expect(passwordProblem("\u{1F600}".repeat(8))).toBeNull();
  });
});

describe("UUID_RE", () => {
  it("accepts a uuid and rejects look-alikes", () => {
    expect(UUID_RE.test("c1000000-0000-4000-8000-000000000001")).toBe(true);
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
    expect(UUID_RE.test("c1000000-0000-4000-8000-00000000000g")).toBe(false);
  });
});
