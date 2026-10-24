/**
 * Characterization tests for the posted-email-rows schemas, added when the zod 4
 * upgrade met the person-emails release (docs/work-log/2026-10-23-zod-4.md,
 * "Phase 4 - post-merge conversion"). Ids use `z.guid()`, never `.uuid()`: the
 * ids in shipped migrations and in fixtures are not RFC 9562 UUIDs, and a strict
 * check would refuse a real row's id on save. The server turns every failure into
 * a fixed Copy string, so a failure here is pinned as that string, not zod's text.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RAW_EMAIL_ROWS,
  emailRowSchema,
  emailRowsSchema,
  newPersonEmailRowsSchema,
  parseNewPersonEmails,
  parseUpdateEmails,
} from "./email-rows-schema";
import { EMAIL_COPY } from "./copy";

const NON_RFC_IDS = ["00000000-0000-0000-0000-000000000005", "d9100000-0000-0000-0000-000000000010"];
const ROW = { value: "a@example.invalid", subtype: "work" as const, isPrimary: true, doNotContact: false };

describe("posted email rows accept every id shape the database holds", () => {
  it.each(NON_RFC_IDS)("row id and known id %s", (id) => {
    expect(parseUpdateEmails({ rows: [{ ...ROW, id }], knownIds: [id] })).toEqual({
      ok: true,
      value: { rows: [{ ...ROW, id }], knownIds: [id] },
    });
    expect(emailRowSchema.safeParse({ ...ROW, id }).success).toBe(true);
    expect(emailRowsSchema.safeParse({ rows: [], knownIds: [id] }).success).toBe(true);
  });

  it.each(["not-a-uuid", "", 5, null])("refuses the id %j with the shape message", (id) => {
    expect(parseUpdateEmails({ rows: [{ ...ROW, id }], knownIds: [] })).toEqual({
      ok: false,
      error: EMAIL_COPY.invalidShape,
    });
    expect(parseUpdateEmails({ rows: [], knownIds: [id] })).toEqual({ ok: false, error: EMAIL_COPY.invalidShape });
  });

  it("accepts a row with the id key absent and returns it without an id key", () => {
    const parsed = parseUpdateEmails({ rows: [ROW], knownIds: [] });
    expect(parsed).toEqual({ ok: true, value: { rows: [ROW], knownIds: [] } });
    if (parsed.ok) expect("id" in parsed.value.rows[0]!).toBe(false);
  });
});

describe("posted email rows stay strict and rebuilt", () => {
  it("refuses an unknown key on the list, on a row, and on a new-person row", () => {
    expect(emailRowsSchema.safeParse({ rows: [], knownIds: [], extra: 1 }).success).toBe(false);
    expect(emailRowSchema.safeParse({ ...ROW, extra: 1 }).success).toBe(false);
    expect(newPersonEmailRowsSchema.safeParse([{ ...ROW, extra: 1 }]).success).toBe(false);
  });

  it("the new-person row has no id and refuses one, even a well-formed one", () => {
    for (const id of NON_RFC_IDS) {
      expect(parseNewPersonEmails([{ ...ROW, id }])).toEqual({ ok: false, error: EMAIL_COPY.invalidShape });
    }
    expect(parseNewPersonEmails([ROW])).toEqual({ ok: true, value: [ROW] });
  });

  it("keeps the raw row cap and the null-or-listed label rule", () => {
    expect(newPersonEmailRowsSchema.safeParse(Array.from({ length: MAX_RAW_EMAIL_ROWS }, () => ROW)).success).toBe(true);
    expect(parseNewPersonEmails(Array.from({ length: MAX_RAW_EMAIL_ROWS + 1 }, () => ROW))).toEqual({
      ok: false,
      error: EMAIL_COPY.tooMany,
    });
    expect(parseNewPersonEmails([{ ...ROW, subtype: null }]).ok).toBe(true);
    expect(parseNewPersonEmails([{ ...ROW, subtype: "" }]).ok).toBe(false);
    expect(parseNewPersonEmails([{ ...ROW, subtype: "home" }]).ok).toBe(false);
  });
});
