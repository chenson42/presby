import { describe, expect, it } from "vitest";
import { HELP_CONTACT_LIMITS, HELP_CONTACT_TOPIC_KEYS } from "./contract";
import { validateHelpContact, type ValidHelpContact } from "./validate";

const good = {
  topic: "something_else",
  name: "Pat Example",
  email: "pat@example.invalid",
  congregation: "First Example Church",
  message: "A perfectly ordinary message.",
};

function ok(raw: Record<string, unknown>): ValidHelpContact {
  const r = validateHelpContact(raw);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.fieldErrors)}`);
  return r.value;
}
const errors = (raw: Record<string, unknown>) => {
  const r = validateHelpContact(raw);
  if (r.ok) throw new Error("expected a failure");
  return r.fieldErrors;
};

describe("validateHelpContact", () => {
  it("accepts a complete submission and returns the cleaned values", () => {
    expect(ok(good)).toEqual({
      topic: "something_else",
      name: "Pat Example",
      email: "pat@example.invalid",
      congregation: "First Example Church",
      message: "A perfectly ordinary message.",
    });
  });

  it("accepts every topic key and nothing else", () => {
    for (const topic of HELP_CONTACT_TOPIC_KEYS) expect(ok({ ...good, topic }).topic).toBe(topic);
    expect(errors({ ...good, topic: "billing" })).toEqual({ topic: "required" });
    expect(errors({ ...good, topic: "" })).toEqual({ topic: "required" });
    expect(errors({ ...good, topic: undefined })).toEqual({ topic: "required" });
    expect(errors({ ...good, topic: 7 })).toEqual({ topic: "required" });
  });

  it("a blank name or congregation becomes null, not an error", () => {
    const v = ok({ ...good, name: "   ", congregation: "" });
    expect(v.name).toBeNull();
    expect(v.congregation).toBeNull();
    const w = ok({ ...good, name: undefined, congregation: undefined });
    expect(w.name).toBeNull();
    expect(w.congregation).toBeNull();
  });

  describe("name and congregation lengths, in characters", () => {
    it("100 and 150 pass, 101 and 151 are too_long", () => {
      expect(ok({ ...good, name: "n".repeat(100) }).name).toHaveLength(100);
      expect(errors({ ...good, name: "n".repeat(101) })).toEqual({ name: "too_long" });
      expect(ok({ ...good, congregation: "c".repeat(150) }).congregation).toHaveLength(150);
      expect(errors({ ...good, congregation: "c".repeat(151) })).toEqual({ congregation: "too_long" });
    });
    it("an emoji is one character", () => {
      expect(ok({ ...good, name: "\u{1F600}".repeat(100) }).name).not.toBeNull();
      expect(errors({ ...good, name: "\u{1F600}".repeat(101) })).toEqual({ name: "too_long" });
    });
    it("a line break pasted into a name disappears instead of splitting it", () => {
      expect(ok({ ...good, name: "Pat\nExample" }).name).toBe("PatExample");
    });
  });

  describe("email", () => {
    it("is required, trimmed, and shown as typed (not lower-cased)", () => {
      expect(errors({ ...good, email: "" })).toEqual({ email: "required" });
      expect(errors({ ...good, email: "   " })).toEqual({ email: "required" });
      expect(ok({ ...good, email: "  Pat@Example.INVALID " }).email).toBe("Pat@Example.INVALID");
    });
    it("checks shape only, mirroring the 0083 CHECK", () => {
      for (const bad of [
        "no-at-sign",
        "two@@example.invalid",
        "a@b@example.invalid",
        "@example.invalid",
        "pat@",
        "pat@nodot",
        "x@a.", // the CHECK refuses an empty label after the last dot
        "x@.invalid", // and one before it
        "pat @example.invalid",
        "pat@exa mple.invalid",
      ]) {
        expect(errors({ ...good, email: bad }), bad).toEqual({ email: "bad_format" });
      }
      for (const fine of ["a@b.c", "first.last+tag@sub.example.invalid", "o'brien@example.invalid"]) {
        expect(ok({ ...good, email: fine }).email).toBe(fine);
      }
    });
    it("254 characters pass, 255 are too_long, and it is never truncated", () => {
      const local = (n: number) => `${"a".repeat(n - "@e.invalid".length)}@e.invalid`;
      expect(ok({ ...good, email: local(254) }).email).toHaveLength(254);
      expect(errors({ ...good, email: local(255) })).toEqual({ email: "too_long" });
    });
  });

  describe("message", () => {
    it("is required; whitespace-only is required, 9 characters is too_short, 10 passes", () => {
      expect(errors({ ...good, message: "" })).toEqual({ message: "required" });
      expect(errors({ ...good, message: "  \n\t  \n " })).toEqual({ message: "required" });
      expect(errors({ ...good, message: "123456789" })).toEqual({ message: "too_short" });
      expect(errors({ ...good, message: "  123456789  \n" })).toEqual({ message: "too_short" });
      expect(ok({ ...good, message: "1234567890" }).message).toBe("1234567890");
    });
    it("a 2,000-character message passes and 2,001 is too_long, never truncated", () => {
      expect(ok({ ...good, message: "m".repeat(HELP_CONTACT_LIMITS.messageMax) }).message).toHaveLength(2000);
      expect(errors({ ...good, message: "m".repeat(2001) })).toEqual({ message: "too_long" });
    });
    it("counts code points: 2,000 emoji pass although they are 4,000 UTF-16 units; 2,001 do not", () => {
      const emoji = "\u{1F600}";
      expect(ok({ ...good, message: emoji.repeat(2000) }).message.length).toBe(4000);
      expect(errors({ ...good, message: emoji.repeat(2001) })).toEqual({ message: "too_long" });
    });
    it("keeps newlines and tabs, turns CRLF into LF, and trims the ends", () => {
      expect(ok({ ...good, message: "\r\n  line one\r\n\tline two  \r\n" }).message).toBe("line one\n\tline two");
    });
    it("a message that is long only because of stripped characters is judged after stripping", () => {
      const padded = "short​".repeat(2); // 12 raw characters, 10 after stripping
      expect(ok({ ...good, message: padded }).message).toBe("shortshort");
      expect(errors({ ...good, message: "​".repeat(30) + "tiny" })).toEqual({ message: "too_short" });
    });
  });

  describe("hygiene on save (CA12)", () => {
    it("strips NUL and other controls, a bidi override and zero-width characters", () => {
      const v = ok({
        ...good,
        name: "Pat\u0000 ‮Example​",
        message: "Hello\u0000 there\u0007, ‮this⁦ is‍ fine.",
      });
      expect(v.name).toBe("Pat Example");
      expect(v.message).toBe("Hello there, this is fine.");
    });
    it("strips C1 controls and puts the text in NFC", () => {
      expect(ok({ ...good, message: "café \u0085is nice" }).message).toBe("café is nice");
    });
    it("a control character inside the email is removed before the shape check", () => {
      expect(ok({ ...good, email: "pat\u0000@example.invalid" }).email).toBe("pat@example.invalid");
    });
  });

  describe("a crafted request", () => {
    it("treats a non-string value as empty rather than throwing", () => {
      expect(errors({ topic: { a: 1 }, name: 5, email: ["x"], congregation: null, message: new Uint8Array(3) })).toEqual({
        topic: "required",
        email: "required",
        message: "required",
      });
    });
    it("refuses an enormous field cheaply instead of normalizing it", () => {
      const huge = "x".repeat(200_000);
      expect(errors({ ...good, message: huge, name: huge, email: huge, congregation: huge })).toEqual({
        message: "too_long",
        name: "too_long",
        email: "too_long",
        congregation: "too_long",
      });
    });
    it("reports every failing field at once", () => {
      expect(errors({ topic: "", name: "n".repeat(101), email: "bad", congregation: "", message: "short" })).toEqual({
        topic: "required",
        name: "too_long",
        email: "bad_format",
        message: "too_short",
      });
    });
  });
});
