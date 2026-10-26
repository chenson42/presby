/**
 * Characterization tests for the posting form schema (Phase 3 T12; the
 * `event-schema.golden.test.ts` precedent). Everything goes through the real
 * `zodResolver`, so the same assertions cover the resolver's path on whichever zod
 * major drives it. Expected values are written inline from the Copy S6 strings, never
 * snapshots; enum fields carry failure and path only (their messages are zod's own
 * and never reach a person: the selects cannot produce them).
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { centsToField, postingFormSchema, toPostingInput } from "./posting-schema";

const base = {
  title: "Music Director",
  location: "Sanctuary",
  employmentType: "part_time",
  payMin: "",
  payMax: "",
  payUnit: "hour",
  summary: "Lead the choir.",
  closingDate: "",
  slug: "",
  descriptionMd: "## About\n\nLead the choir.",
};

describe("postingFormSchema", () => {
  it("parses a valid opening unchanged", async () => {
    const out = await resolveForm(postingFormSchema, base);
    expect(out.failed).toBe(false);
    expect(out.values).toEqual(base);
  });

  it("trims the title", async () => {
    const out = await resolveForm(postingFormSchema, { ...base, title: "  Music Director  " });
    expect((out.values as { title: string }).title).toBe("Music Director");
  });

  it("pins the Copy S6 field messages", async () => {
    expect((await resolveForm(postingFormSchema, { ...base, title: "   " })).errors).toEqual({ title: "Enter a title." });
    expect((await resolveForm(postingFormSchema, { ...base, payMin: "1e3" })).errors).toEqual({
      payMin: "Enter a dollar amount like 45 or 52,000.",
    });
    expect((await resolveForm(postingFormSchema, { ...base, payMax: "45.555" })).errors).toEqual({
      payMax: "Enter a dollar amount like 45 or 52,000.",
    });
    expect((await resolveForm(postingFormSchema, { ...base, payMin: "60", payMax: "45" })).errors).toEqual({
      payMax: "The highest pay must be at least the lowest.",
    });
    expect((await resolveForm(postingFormSchema, { ...base, closingDate: "2026-02-30" })).errors).toEqual({
      closingDate: "Enter a date.",
    });
    expect((await resolveForm(postingFormSchema, { ...base, closingDate: "1999-12-31" })).errors).toEqual({
      closingDate: "Enter a date.",
    });
    expect((await resolveForm(postingFormSchema, { ...base, slug: "Not A Slug" })).errors).toEqual({
      slug: "Use letters, numbers and dashes only.",
    });
  });

  it("accepts the dollar shapes a person types", async () => {
    for (const [min, max] of [["45", "60"], ["$52,000", "60,000.50"], ["45.5", ""], ["", "60"], ["45", "45"]]) {
      expect((await resolveForm(postingFormSchema, { ...base, payMin: min, payMax: max })).failed, `${min}-${max}`).toBe(false);
    }
  });

  it("blocks a description the server would refuse, with the first Copy S6 message", async () => {
    const out = await resolveForm(postingFormSchema, { ...base, descriptionMd: "# Too big\n\ntext" });
    expect(out.errors).toEqual({
      descriptionMd: 'Line 1 ("# Too big") starts with a single #. Use the Heading or Subheading button for section titles.',
    });
    const link = await resolveForm(postingFormSchema, { ...base, descriptionMd: "[x](https://)" });
    expect(link.errors.descriptionMd).toBe('Line 1: finish the web address for the link "x", or remove the link.');
    // A draft may be saved with no description at all.
    expect((await resolveForm(postingFormSchema, { ...base, descriptionMd: "" })).failed).toBe(false);
  });

  it("falls back to the generic line for lengths the inputs already hold natively", async () => {
    const generic = "We couldn't save that. Try again.";
    expect((await resolveForm(postingFormSchema, { ...base, title: "x".repeat(151) })).errors).toEqual({ title: generic });
    expect((await resolveForm(postingFormSchema, { ...base, location: "x".repeat(201) })).errors).toEqual({ location: generic });
    expect((await resolveForm(postingFormSchema, { ...base, summary: "x".repeat(301) })).errors).toEqual({ summary: generic });
  });

  it("tamper: an unknown type or unit, or a missing key, fails on that path", async () => {
    expect((await resolveForm(postingFormSchema, { ...base, employmentType: "contractor" })).failed).toBe(true);
    expect(Object.keys((await resolveForm(postingFormSchema, { ...base, employmentType: "contractor" })).errors)).toEqual(["employmentType"]);
    expect(Object.keys((await resolveForm(postingFormSchema, { ...base, payUnit: "week" })).errors)).toEqual(["payUnit"]);
    const { summary: _s, ...missing } = base;
    expect(Object.keys((await resolveForm(postingFormSchema, missing)).errors)).toEqual(["summary"]);
  });
});

describe("toPostingInput", () => {
  it("converts dollars to cents, sends the unit only with pay and omits an empty slug", () => {
    expect(toPostingInput({ ...base, payMin: "$52,000.50", payMax: "60000", payUnit: "year", closingDate: "2027-01-31" } as never)).toEqual({
      title: "Music Director",
      summary: "Lead the choir.",
      location: "Sanctuary",
      employmentType: "part_time",
      payMinCents: 5200050,
      payMaxCents: 6000000,
      payUnit: "year",
      descriptionMd: "## About\n\nLead the choir.",
      closingDate: "2027-01-31",
    });
  });

  it("no pay means no unit, and a blank closing date is null", () => {
    const input = toPostingInput({ ...base, payUnit: "year" } as never);
    expect(input).toMatchObject({ payMinCents: null, payMaxCents: null, payUnit: null, closingDate: null });
    expect("slug" in input).toBe(false);
  });

  it("a typed slug is lower-cased and kept", () => {
    expect(toPostingInput({ ...base, slug: " Music-Director " } as never).slug).toBe("music-director");
  });
});

describe("centsToField", () => {
  it("round-trips whole dollars and cents", () => {
    expect(centsToField(null)).toBe("");
    expect(centsToField(4500)).toBe("45");
    expect(centsToField(4550)).toBe("45.50");
    expect(centsToField(5200000)).toBe("52000");
    expect(centsToField(5)).toBe("0.05");
  });
});
