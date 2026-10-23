/**
 * Characterization tests for the events form schemas, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests"
 * 1). Everything goes through the real `zodResolver`, so the same assertions
 * cover the resolver's v3 and v4 paths. Enum fields with no message and
 * missing-key booleans are tamper-only: failure and path only.
 */
import { describe, expect, it } from "vitest";
import { MAX_SERIES_TOTAL } from "@/lib/events/recurrence";
import { resolveForm } from "@/lib/testing/zod-golden";
import { createEventSchema, editEventSchema, extendSeriesSchema } from "./event-schema";

const base = {
  title: "Fellowship supper",
  description: "",
  location: "",
  startsAt: "2026-06-07T18:00",
  endsAt: "",
  isPublic: true,
  allowsCheckin: false,
  eventTypeId: "none",
  repeats: false,
  patternType: "simple",
  simplePattern: undefined,
  ordinal: undefined,
  dayOfWeek: undefined,
  count: "",
};

describe("createEventSchema", () => {
  it("parses a valid one-off event unchanged", async () => {
    const out = await resolveForm(createEventSchema, base);
    expect(out.failed).toBe(false);
    expect(out.values).toEqual(base);
  });

  it("trims the title", async () => {
    const out = await resolveForm(createEventSchema, { ...base, title: "  Supper  " });
    expect((out.values as { title: string }).title).toBe("Supper");
  });

  it("pins the field messages", async () => {
    expect((await resolveForm(createEventSchema, { ...base, title: "   " })).errors).toEqual({
      title: "Title is required",
    });
    expect((await resolveForm(createEventSchema, { ...base, title: "x".repeat(201) })).errors).toEqual({
      title: "Title must be 200 characters or fewer",
    });
    expect((await resolveForm(createEventSchema, { ...base, description: "x".repeat(2001) })).errors).toEqual({
      description: "Description is too long",
    });
    expect((await resolveForm(createEventSchema, { ...base, location: "x".repeat(201) })).errors).toEqual({
      location: "That's too long",
    });
    expect((await resolveForm(createEventSchema, { ...base, startsAt: "" })).errors).toEqual({
      startsAt: "Start date and time are required",
    });
  });

  it("pins the end-before-start message", async () => {
    expect(
      (await resolveForm(createEventSchema, { ...base, startsAt: "2026-06-07T18:00", endsAt: "2026-06-07T17:00" }))
        .errors,
    ).toEqual({ endsAt: "End time can't be before the start time." });
  });

  it("pins the repeat messages", async () => {
    expect(
      (await resolveForm(createEventSchema, { ...base, repeats: true, patternType: "simple", count: "4" })).errors,
    ).toEqual({ simplePattern: "Choose a repeat pattern." });
    expect(
      (await resolveForm(createEventSchema, { ...base, repeats: true, patternType: "dayofweek", count: "4" })).errors,
    ).toEqual({ dayOfWeek: "Choose which day of the month this repeats on." });
    expect(
      (
        await resolveForm(createEventSchema, {
          ...base,
          repeats: true,
          patternType: "dayofweek",
          ordinal: "2nd",
          count: "4",
        })
      ).errors,
    ).toEqual({ dayOfWeek: "Choose which day of the month this repeats on." });
    const countMessage = `Enter a number of occurrences from 1 to ${MAX_SERIES_TOTAL}.`;
    for (const count of ["", "0", "-2", "1.5", "abc", String(MAX_SERIES_TOTAL + 1)]) {
      expect(
        (await resolveForm(createEventSchema, { ...base, repeats: true, simplePattern: "weekly", count })).errors,
      ).toEqual({ count: countMessage });
    }
    expect(
      (await resolveForm(createEventSchema, { ...base, repeats: true, simplePattern: "weekly", count: String(MAX_SERIES_TOTAL) }))
        .failed,
    ).toBe(false);
  });

  it("does not check the repeat fields when the event does not repeat", async () => {
    expect((await resolveForm(createEventSchema, { ...base, repeats: false, count: "abc" })).failed).toBe(false);
  });

  it("reports the cross-field issues together with a field-level failure", async () => {
    expect(
      (
        await resolveForm(createEventSchema, {
          ...base,
          title: "",
          startsAt: "2026-06-07T18:00",
          endsAt: "2026-06-07T09:00",
          repeats: true,
          patternType: "simple",
          count: "0",
        })
      ).errors,
    ).toEqual({
      title: "Title is required",
      endsAt: "End time can't be before the start time.",
      simplePattern: "Choose a repeat pattern.",
      count: `Enter a number of occurrences from 1 to ${MAX_SERIES_TOTAL}.`,
    });
  });

  it("skips the cross-field refinements after a fatal type failure", async () => {
    // `isPublic` is not a boolean: the type check is fatal, so the end-before-
    // start refinement never runs. Only failure and path are pinned for the
    // type message itself (a form always supplies a boolean).
    const out = await resolveForm(createEventSchema, {
      ...base,
      isPublic: "yes",
      startsAt: "2026-06-07T18:00",
      endsAt: "2026-06-07T09:00",
    });
    expect(Object.keys(out.errors)).toEqual(["isPublic"]);
  });

  it("fails (path only: enum with no message is tamper-only) on an unknown pattern type", async () => {
    expect(Object.keys((await resolveForm(createEventSchema, { ...base, patternType: "daily" })).errors)).toEqual([
      "patternType",
    ]);
  });
});

describe("editEventSchema", () => {
  const edit = {
    title: "Fellowship supper",
    description: "",
    location: "",
    startsAt: "2026-06-07T18:00",
    endsAt: "",
    isPublic: false,
    allowsCheckin: true,
    eventTypeId: "none",
  };

  it("parses a valid edit unchanged", async () => {
    expect(await resolveForm(editEventSchema, edit)).toEqual({ values: edit, errors: {}, failed: false });
  });

  it("pins the messages, with the end-before-start issue reported alongside a field failure", async () => {
    expect(
      (await resolveForm(editEventSchema, { ...edit, title: "", endsAt: "2026-06-07T09:00" })).errors,
    ).toEqual({ title: "Title is required", endsAt: "End time can't be before the start time." });
    expect((await resolveForm(editEventSchema, { ...edit, startsAt: "" })).errors).toEqual({
      startsAt: "Start date and time are required",
    });
  });

  it("skips the end-before-start refinement after a fatal type failure", async () => {
    const out = await resolveForm(editEventSchema, { ...edit, allowsCheckin: "no", endsAt: "2026-06-07T09:00" });
    expect(Object.keys(out.errors)).toEqual(["allowsCheckin"]);
  });
});

describe("extendSeriesSchema", () => {
  const extend = { patternType: "simple", simplePattern: "weekly", additionalCount: "3" };

  it("parses a valid extension unchanged", async () => {
    expect(await resolveForm(extendSeriesSchema, extend)).toEqual({ values: extend, errors: {}, failed: false });
  });

  it("pins the messages", async () => {
    expect((await resolveForm(extendSeriesSchema, { ...extend, additionalCount: "" })).errors).toEqual({
      additionalCount: "Enter a number of additional occurrences",
    });
    for (const additionalCount of ["0", "-1", "1.5", "abc"]) {
      expect((await resolveForm(extendSeriesSchema, { ...extend, additionalCount })).errors).toEqual({
        additionalCount: "Enter at least 1 additional occurrence.",
      });
    }
    expect((await resolveForm(extendSeriesSchema, { ...extend, simplePattern: undefined })).errors).toEqual({
      simplePattern: "Choose a repeat pattern.",
    });
    expect(
      (await resolveForm(extendSeriesSchema, { ...extend, patternType: "dayofweek", simplePattern: undefined })).errors,
    ).toEqual({ dayOfWeek: "Choose which day of the month this repeats on." });
  });

  it("reports the pattern issue together with a count issue", async () => {
    expect(
      (await resolveForm(extendSeriesSchema, { ...extend, simplePattern: undefined, additionalCount: "0" })).errors,
    ).toEqual({
      simplePattern: "Choose a repeat pattern.",
      additionalCount: "Enter at least 1 additional occurrence.",
    });
  });
});
