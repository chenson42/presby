import { describe, expect, it } from "vitest";
import {
  MAX_RAW_EMAIL_ROWS,
  MAX_RAW_EMAIL_VALUE,
  parseNewPersonEmails,
  parseUpdateEmails,
} from "./email-rows-schema";
import { EMAIL_COPY, emailRefusalMessage } from "./copy";

const ID = "11111111-1111-4111-8111-111111111111";
const ROW = { value: "a@b.invalid", subtype: "work" as const, isPrimary: true, doNotContact: false };

describe("parseUpdateEmails", () => {
  it("accepts rows and the ids the form loaded, and rebuilds them", () => {
    const parsed = parseUpdateEmails({ rows: [{ ...ROW, id: ID }], knownIds: [ID] });
    expect(parsed).toEqual({ ok: true, value: { rows: [{ ...ROW, id: ID }], knownIds: [ID] } });
  });

  it("accepts a null label (shown as 'Email')", () => {
    expect(parseUpdateEmails({ rows: [{ ...ROW, subtype: null }], knownIds: [] }).ok).toBe(true);
  });

  it.each([
    ["not an object", "rows"],
    ["rows missing", { knownIds: [] }],
    ["a stray property on the list", { rows: [], knownIds: [], extra: 1 }],
    ["a stray property on a row", { rows: [{ ...ROW, verifiedAt: "2020-01-01" }], knownIds: [] }],
    ["a forged verified flag", { rows: [{ ...ROW, verified: true }], knownIds: [] }],
    ["a non-uuid id", { rows: [{ ...ROW, id: "nope" }], knownIds: [] }],
    ["a non-uuid known id", { rows: [], knownIds: ["nope"] }],
    ["a subtype outside the vocabulary", { rows: [{ ...ROW, subtype: "home" }], knownIds: [] }],
    ["a non-boolean main flag", { rows: [{ ...ROW, isPrimary: "yes" }], knownIds: [] }],
    ["a megabyte value", { rows: [{ ...ROW, value: "a".repeat(MAX_RAW_EMAIL_VALUE + 1) }], knownIds: [] }],
  ])("refuses %s with the shape message", (_name, raw) => {
    expect(parseUpdateEmails(raw)).toEqual({ ok: false, error: EMAIL_COPY.invalidShape });
  });

  it("more than the raw cap of rows is the too-many message", () => {
    const rows = Array.from({ length: MAX_RAW_EMAIL_ROWS + 1 }, () => ROW);
    expect(parseUpdateEmails({ rows, knownIds: [] })).toEqual({ ok: false, error: EMAIL_COPY.tooMany });
  });

  it("the raw cap itself is allowed (blank rows a form leaves behind); the planner enforces ten", () => {
    const rows = Array.from({ length: MAX_RAW_EMAIL_ROWS }, () => ROW);
    expect(parseUpdateEmails({ rows, knownIds: [] }).ok).toBe(true);
  });
});

describe("parseNewPersonEmails", () => {
  it("accepts rows without ids", () => {
    expect(parseNewPersonEmails([ROW])).toEqual({ ok: true, value: [ROW] });
  });
  it("refuses a row that carries an id (nothing exists yet to refer to)", () => {
    expect(parseNewPersonEmails([{ ...ROW, id: ID }])).toEqual({ ok: false, error: EMAIL_COPY.invalidShape });
  });
  it("refuses a non-array", () => {
    expect(parseNewPersonEmails({ rows: [ROW] }).ok).toBe(false);
  });
});

describe("emailRefusalMessage covers every reason with a non-empty Copy string", () => {
  const reasons = ["invalid_shape", "too_long", "duplicate", "too_many", "multiple_primary", "bad_subtype", "emails_changed"] as const;
  it.each(reasons)("%s", (reason) => {
    const message = emailRefusalMessage({ reason });
    expect(message.length).toBeGreaterThan(10);
    // never a raw database or constraint message
    expect(message).not.toMatch(/violates|constraint|contact_methods|SQL|duplicate key/i);
  });
  it("states the 254-character and ten-address limits in words", () => {
    expect(EMAIL_COPY.tooLong).toContain("254");
    expect(EMAIL_COPY.tooMany).toContain("10");
  });
});
