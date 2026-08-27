import { describe, expect, it } from "vitest";
import { MAX_SERIES_TOTAL } from "@/lib/events/recurrence";
import { createEventSchema, editEventSchema, extendSeriesSchema } from "./event-schema";

const baseCreate = {
  title: "Session meeting",
  startsAt: "2027-03-01T19:00",
  endsAt: "",
  isPublic: true,
  allowsCheckin: false,
  repeats: false,
  patternType: "simple" as const,
  simplePattern: "weekly" as const,
  ordinal: "1st" as const,
  dayOfWeek: "Monday" as const,
  count: "",
};

describe("createEventSchema", () => {
  it("accepts a minimal non-repeating submission", () => {
    expect(createEventSchema.safeParse(baseCreate).success).toBe(true);
  });

  it("rejects an empty title", () => {
    const result = createEventSchema.safeParse({ ...baseCreate, title: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a title over 200 characters", () => {
    const result = createEventSchema.safeParse({ ...baseCreate, title: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects a description over 2000 characters", () => {
    const result = createEventSchema.safeParse({
      ...baseCreate,
      description: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing startsAt", () => {
    const result = createEventSchema.safeParse({ ...baseCreate, startsAt: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an endsAt before startsAt", () => {
    const result = createEventSchema.safeParse({
      ...baseCreate,
      startsAt: "2027-03-01T19:00",
      endsAt: "2027-03-01T18:00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an endsAt after startsAt", () => {
    const result = createEventSchema.safeParse({
      ...baseCreate,
      startsAt: "2027-03-01T19:00",
      endsAt: "2027-03-01T20:00",
    });
    expect(result.success).toBe(true);
  });

  describe("repeats — simple pattern", () => {
    it("requires a count when repeats is checked", () => {
      const result = createEventSchema.safeParse({ ...baseCreate, repeats: true, count: "" });
      expect(result.success).toBe(false);
    });

    it("accepts a valid repeating submission", () => {
      const result = createEventSchema.safeParse({
        ...baseCreate,
        repeats: true,
        count: "10",
      });
      expect(result.success).toBe(true);
    });

    it(`rejects a count over ${MAX_SERIES_TOTAL} (the series-total cap)`, () => {
      const result = createEventSchema.safeParse({
        ...baseCreate,
        repeats: true,
        count: String(MAX_SERIES_TOTAL + 1),
      });
      expect(result.success).toBe(false);
    });

    it(`accepts a count of exactly ${MAX_SERIES_TOTAL}`, () => {
      const result = createEventSchema.safeParse({
        ...baseCreate,
        repeats: true,
        count: String(MAX_SERIES_TOTAL),
      });
      expect(result.success).toBe(true);
    });

    it("rejects a count of 0", () => {
      const result = createEventSchema.safeParse({ ...baseCreate, repeats: true, count: "0" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-integer count", () => {
      const result = createEventSchema.safeParse({
        ...baseCreate,
        repeats: true,
        count: "4.5",
      });
      expect(result.success).toBe(false);
    });

    it("ignores count validation entirely when repeats is unchecked", () => {
      const result = createEventSchema.safeParse({ ...baseCreate, repeats: false, count: "" });
      expect(result.success).toBe(true);
    });
  });

  describe("repeats — day-of-week pattern", () => {
    it("requires an ordinal and dayOfWeek when patternType is dayofweek", () => {
      const result = createEventSchema.safeParse({
        ...baseCreate,
        repeats: true,
        patternType: "dayofweek",
        ordinal: undefined,
        dayOfWeek: undefined,
        count: "6",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a valid day-of-week repeating submission", () => {
      const result = createEventSchema.safeParse({
        ...baseCreate,
        repeats: true,
        patternType: "dayofweek",
        ordinal: "2nd",
        dayOfWeek: "Tuesday",
        count: "6",
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("editEventSchema", () => {
  const base = {
    title: "Session meeting",
    startsAt: "2027-03-01T19:00",
    endsAt: "",
    isPublic: true,
    allowsCheckin: false,
  };

  it("accepts a minimal valid submission", () => {
    expect(editEventSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(editEventSchema.safeParse({ ...base, title: "" }).success).toBe(false);
  });

  it("rejects an endsAt before startsAt", () => {
    const result = editEventSchema.safeParse({
      ...base,
      startsAt: "2027-03-01T19:00",
      endsAt: "2027-03-01T18:00",
    });
    expect(result.success).toBe(false);
  });

  it("strips any recurrence-shaped fields a caller might send — this schema never validates or forwards them", () => {
    const result = editEventSchema.safeParse({ ...base, repeats: true, count: "999" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("repeats" in result.data).toBe(false);
      expect("count" in result.data).toBe(false);
    }
  });
});

describe("extendSeriesSchema", () => {
  const base = {
    patternType: "simple" as const,
    simplePattern: "weekly" as const,
    ordinal: "1st" as const,
    dayOfWeek: "Monday" as const,
    additionalCount: "4",
  };

  it("accepts a minimal valid submission", () => {
    expect(extendSeriesSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a missing additionalCount", () => {
    expect(extendSeriesSchema.safeParse({ ...base, additionalCount: "" }).success).toBe(false);
  });

  it("rejects a non-integer additionalCount", () => {
    expect(extendSeriesSchema.safeParse({ ...base, additionalCount: "2.5" }).success).toBe(
      false,
    );
  });

  it("rejects an additionalCount of 0", () => {
    expect(extendSeriesSchema.safeParse({ ...base, additionalCount: "0" }).success).toBe(false);
  });

  // NOTE: unlike createEventSchema, this schema does NOT itself check the
  // 52-occurrence series-total cap — the cap depends on the series' EXISTING
  // count, which this form never has client-side (it lives on the parent
  // row's own recurrenceCount, server-side only). `extendSeriesPattern()`
  // in src/lib/events.ts is the sole enforcement point — proven in
  // events.test.ts, not here.
  it("accepts a large additionalCount client-side (the server enforces the total cap)", () => {
    expect(extendSeriesSchema.safeParse({ ...base, additionalCount: "999" }).success).toBe(true);
  });

  it("requires ordinal/dayOfWeek when patternType is dayofweek", () => {
    const result = extendSeriesSchema.safeParse({
      ...base,
      patternType: "dayofweek",
      ordinal: undefined,
      dayOfWeek: undefined,
    });
    expect(result.success).toBe(false);
  });
});
