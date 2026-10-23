import { describe, expect, it } from "vitest";
import {
  blankEmailRow,
  contactEmailsSchema,
  describeRemoval,
  effectiveMainIndex,
  emailRowsFromSaved,
  knownEmailIds,
  reviewEmailLines,
  toEmailRowInputs,
  toNewPersonEmailInputs,
  type EmailRowValue,
} from "./email-addresses-form";
import { nextPrimaryAfterRemoval } from "@/lib/contact-methods/email-routing";
import { isValidEmailShape } from "@/lib/contact-methods/normalize";
import type { ActiveEmailRow } from "@/lib/contact-methods/types";

const SAVED: ActiveEmailRow[] = [
  { id: "a", value: "a@example.invalid", subtype: "personal", isPrimary: true, doNotContact: false, createdAt: "2026-01-02T00:00:00.000000Z" },
  { id: "b", value: "b@example.invalid", subtype: "work", isPrimary: false, doNotContact: true, createdAt: "2026-01-01T00:00:00.000000Z" },
  { id: "c", value: "c@example.invalid", subtype: null, isPrimary: false, doNotContact: false, createdAt: "2026-01-03T00:00:00.000000Z" },
];

const row = (value: string, extra: Partial<EmailRowValue> = {}): EmailRowValue => ({
  value, subtype: "", isPrimary: false, doNotContact: false, ...extra,
});

describe("contactEmailsSchema", () => {
  const issues = (rows: EmailRowValue[]) => {
    const r = contactEmailsSchema.safeParse(rows);
    return r.success ? [] : r.error.issues.map((i) => [i.path.join("."), i.message]);
  };

  it("accepts an empty list and a lone blank new row", () => {
    expect(issues([])).toEqual([]);
    expect(issues([blankEmailRow(true)])).toEqual([]);
  });

  it("refuses a blank SAVED row, pointing at it", () => {
    expect(issues([row("", { id: "a" })])).toEqual([["0.value", "Enter an email address, or remove this row."]]);
  });

  it("refuses a bad shape, a too-long address and a repeat (after trimming and lower-casing)", () => {
    expect(issues([row("nope")])).toEqual([["0.value", "Enter a valid email address."]]);
    expect(issues([row("a@b"), row("a, b@c.d")]).map((i) => i[1])).toEqual([
      "Enter a valid email address.",
      "Enter a valid email address.",
    ]);
    expect(issues([row(`${"x".repeat(250)}@e.invalid`)])[0]![1]).toBe(
      "That email address is too long. Use 254 characters or fewer.",
    );
    expect(issues([row("Same@Example.invalid"), row(" same@example.invalid ")])).toEqual([
      ["1.value", "This address is already in the list."],
    ]);
  });

  it("refuses an eleventh non-blank row but not blank ones", () => {
    const ten = Array.from({ length: 10 }, (_, n) => row(`n${n}@example.invalid`));
    expect(issues(ten)).toEqual([]);
    expect(issues([...ten, blankEmailRow(false)])).toEqual([]);
    expect(issues([...ten, row("eleven@example.invalid")])).toEqual([
      ["10.value", "A person can have up to 10 email addresses."],
    ]);
  });

  it("agrees with the shared shape rule on a sample (what the form lets through, the server's shape check accepts)", () => {
    for (const value of ["a@b.co", "a.b+c@d.e.f", "a@b", "a b@c.d", "a@@b.c", ""]) {
      const clientOk = issues([row(value)]).length === 0 || value.trim() === "";
      if (clientOk && value !== "") expect(isValidEmailShape(value.trim().toLowerCase())).toBe(true);
    }
  });
});

describe("emailRowsFromSaved / knownEmailIds", () => {
  it("keeps the loaded order, ids and labels, and maps a null label to the select's empty value", () => {
    const rows = emailRowsFromSaved(SAVED);
    expect(rows.map((r) => [r.id, r.subtype, r.isPrimary, r.doNotContact])).toEqual([
      ["a", "personal", true, false],
      ["b", "work", false, true],
      ["c", "", false, false],
    ]);
    expect(knownEmailIds(SAVED)).toEqual(["a", "b", "c"]);
  });
});

describe("effectiveMainIndex", () => {
  it("is the flagged row", () => {
    expect(effectiveMainIndex(emailRowsFromSaved(SAVED))).toBe(0);
  });

  it("when the flagged saved row is gone, is the first remaining saved row in loaded order (the planner's promotion)", () => {
    const rows = emailRowsFromSaved(SAVED).slice(1);
    expect(effectiveMainIndex(rows)).toBe(0);
    expect(rows[0]!.id).toBe("b");
  });

  it("prefers a saved row over a typed one when nothing is flagged, and ignores blank unsaved rows", () => {
    expect(effectiveMainIndex([row("new@example.invalid"), row("x@example.invalid", { id: "s" })])).toBe(1);
    expect(effectiveMainIndex([blankEmailRow(true), row("typed@example.invalid")])).toBe(1);
  });

  it("a lone blank row is shown as the main address; an empty list has none", () => {
    expect(effectiveMainIndex([blankEmailRow(true)])).toBe(0);
    expect(effectiveMainIndex([])).toBe(-1);
  });

  it("agrees with the planner's own successor (nextPrimaryAfterRemoval) when the main is removed", () => {
    const rows = emailRowsFromSaved(SAVED);
    const without = rows.filter((r) => r.id !== "a");
    expect(without[effectiveMainIndex(without)]!.id).toBe(nextPrimaryAfterRemoval(SAVED, new Set(["a"]))!.id);
  });
});

describe("toEmailRowInputs / toNewPersonEmailInputs", () => {
  it("drops blank unsaved rows, keeps ids, maps '' to null, and invents no main", () => {
    const rows = emailRowsFromSaved(SAVED).slice(1); // the main was removed
    expect(toEmailRowInputs([...rows, blankEmailRow(false)])).toEqual([
      { id: "b", value: "b@example.invalid", subtype: "work", isPrimary: false, doNotContact: true },
      { id: "c", value: "c@example.invalid", subtype: null, isPrimary: false, doNotContact: false },
    ]);
  });

  it("new-person rows carry no ids; an all-blank list is undefined", () => {
    expect(toNewPersonEmailInputs([blankEmailRow(true)])).toBeUndefined();
    expect(toNewPersonEmailInputs([row("a@example.invalid", { id: "x", isPrimary: true })])).toEqual([
      { value: "a@example.invalid", subtype: null, isPrimary: true, doNotContact: false },
    ]);
  });
});

describe("describeRemoval", () => {
  it("a non-main address: the soft-removal sentence only", () => {
    const { body, address } = describeRemoval(emailRowsFromSaved(SAVED), 2, SAVED, "Nora Ashgrove");
    expect(address).toBe("c@example.invalid");
    expect(body).toBe(
      "c@example.invalid will stop being used and will no longer show on Nora Ashgrove's record once you save. A record of the change is kept.",
    );
  });

  it("the main address: names the oldest remaining one, by the planner's order (not by position)", () => {
    const { body } = describeRemoval(emailRowsFromSaved(SAVED), 0, SAVED, "Nora Ashgrove");
    expect(body.endsWith(" It is the main address, so b@example.invalid will become the main address.")).toBe(true);
  });

  it("the main address, when an earlier row was removed in this session: skips it", () => {
    const rows = emailRowsFromSaved(SAVED).filter((r) => r.id !== "b");
    const { body } = describeRemoval(rows, 0, SAVED, "Nora");
    expect(body).toContain("so c@example.invalid will become the main address");
  });

  it("the main address when only typed rows remain: names the first typed row", () => {
    const rows = [emailRowsFromSaved(SAVED)[0]!, row("new@example.invalid")];
    expect(describeRemoval(rows, 0, SAVED, "Nora").body).toContain("so new@example.invalid will become");
  });

  it("the only address: says the person will have none on file", () => {
    const only = SAVED.slice(0, 1);
    expect(describeRemoval(emailRowsFromSaved(only), 0, only, "Nora Ashgrove").body).toContain(
      "It is the only address, so Nora Ashgrove will have no email address on file.",
    );
  });
});

describe("reviewEmailLines", () => {
  it("lists Main, the label and Don't send, only the tags that apply; skips blanks", () => {
    expect(
      reviewEmailLines([
        row("A@Example.invalid", { isPrimary: true }),
        row("b@example.invalid", { subtype: "work", doNotContact: true }),
        row("c@example.invalid", { subtype: "other" }),
        row("d@example.invalid"),
        blankEmailRow(false),
      ]),
    ).toEqual([
      "a@example.invalid (Main)",
      "b@example.invalid (Work, Don't send)",
      "c@example.invalid (Other)",
      "d@example.invalid",
    ]);
  });
});
