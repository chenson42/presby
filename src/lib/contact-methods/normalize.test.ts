import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX,
  EMAIL_SUBTYPES,
  EMAIL_SUBTYPE_LABELS,
  MAX_ACTIVE_EMAILS,
  PHONE_SUBTYPES,
  isEmailSubtype,
  isValidEmailShape,
  normalizeEmail,
} from "./normalize";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Nora.Ashgrove@Example.INVALID \n")).toBe("nora.ashgrove@example.invalid");
  });
  it("is idempotent", () => {
    const once = normalizeEmail("  A@B.C ");
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("isValidEmailShape", () => {
  const good = [
    "a@b.invalid",
    "nora@example.invalid",
    "first.last+tag@sub.example.invalid",
    "o'brien@example.invalid",
    "a@b.c.d",
    "ünï@example.invalid",
  ];
  const bad = [
    "",
    "plain",
    "a@b", // no dot in the domain part
    "@b.c",
    "a@.c",
    "a@b.",
    "a@@b.c",
    "a@b@c.d",
    "a b@c.d",
    "a@b .c",
    "a@b.c ",
    " a@b.c",
    "a@b.c\n",
    "a@x.c, b@y.d", // a comma list
    "a,b@c.d",
    "Name <a@b.c>", // a display name
  ];
  it.each(good)("accepts %s", (v) => expect(isValidEmailShape(v)).toBe(true));
  it.each(bad)("refuses %j", (v) => expect(isValidEmailShape(v)).toBe(false));

  it("enforces the 254-character cap at the boundary", () => {
    const local = "a".repeat(EMAIL_MAX - "@b.invalid".length);
    expect(isValidEmailShape(`${local}@b.invalid`)).toBe(true);
    expect(isValidEmailShape(`${local}a@b.invalid`)).toBe(false);
  });
});

describe("vocabularies", () => {
  it("email labels are exactly personal, work, other", () => {
    expect([...EMAIL_SUBTYPES]).toEqual(["personal", "work", "other"]);
  });
  it("phone keeps mobile, home, work", () => {
    expect([...PHONE_SUBTYPES]).toEqual(["mobile", "home", "work"]);
  });
  it("every email label has a display string, and 'home' is not one of them", () => {
    expect(Object.keys(EMAIL_SUBTYPE_LABELS).sort()).toEqual([...EMAIL_SUBTYPES].sort());
    expect(isEmailSubtype("home")).toBe(false);
    expect(isEmailSubtype("work")).toBe(true);
    expect(isEmailSubtype(null)).toBe(false);
  });
  it("the cap is ten", () => {
    expect(MAX_ACTIVE_EMAILS).toBe(10);
  });
});
