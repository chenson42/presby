import { describe, expect, expectTypeOf, it } from "vitest";
import {
  GENERIC_SAVE_ERROR,
  firstIssue,
  parseDollarsToCents,
  postingInputSchema,
  postingMoveSchema,
  postingStatusSchema,
  postingUpdateSchema,
  type PostingInput,
  type PostingUpdateInput,
} from "./input";

const GUID = "11111111-1111-1111-1111-111111111111";

const valid = {
  title: "Music Director",
  summary: "Lead our choirs.",
  location: "Fernwood",
  employmentType: "part_time",
  payMinCents: 4500,
  payMaxCents: 6000,
  payUnit: "hour",
  descriptionMd: "## Duties\n\nLead.",
  closingDate: "2027-03-01",
} as const;

function issues(schema: typeof postingInputSchema | typeof postingUpdateSchema, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected a failure");
  return result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

describe("postingInputSchema", () => {
  it("parses a valid posting", () => {
    const result = postingInputSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...valid, slug: undefined });
  });

  it("accepts a bare minimum (a draft with only a title)", () => {
    const result = postingInputSchema.safeParse({
      title: "Sexton",
      summary: "",
      location: "",
      employmentType: "full_time",
      descriptionMd: "",
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ payMinCents: null, payMaxCents: null, payUnit: null, closingDate: null });
  });

  it("cleans and trims plain-text fields", () => {
    const result = postingInputSchema.parse({ ...valid, title: "  Music‮ Dir​ector\n ", location: " Hall\t" });
    expect(result.title).toBe("Music Director");
    expect(result.location).toBe("Hall");
  });

  describe("bounds", () => {
    it("title 1-150", () => {
      expect(issues(postingInputSchema, { ...valid, title: "   " })).toEqual([{ path: "title", message: "Enter a title." }]);
      expect(issues(postingInputSchema, { ...valid, title: "x".repeat(151) })).toEqual([
        { path: "title", message: "Enter a title." },
      ]);
      expect(postingInputSchema.safeParse({ ...valid, title: "x".repeat(150) }).success).toBe(true);
    });

    it("summary 0-300, location 0-200", () => {
      expect(postingInputSchema.safeParse({ ...valid, summary: "x".repeat(300) }).success).toBe(true);
      expect(issues(postingInputSchema, { ...valid, summary: "x".repeat(301) })).toEqual([
        { path: "summary", message: GENERIC_SAVE_ERROR },
      ]);
      expect(postingInputSchema.safeParse({ ...valid, location: "x".repeat(200) }).success).toBe(true);
      expect(issues(postingInputSchema, { ...valid, location: "x".repeat(201) })).toEqual([
        { path: "location", message: GENERIC_SAVE_ERROR },
      ]);
    });

    it("lengths count code points, as Postgres does", () => {
      expect(postingInputSchema.safeParse({ ...valid, title: "\u{1F600}".repeat(150) }).success).toBe(true);
      expect(postingInputSchema.safeParse({ ...valid, title: "\u{1F600}".repeat(151) }).success).toBe(false);
    });

    it("employmentType is one of the three", () => {
      for (const ok of ["full_time", "part_time", "intern"]) {
        expect(postingInputSchema.safeParse({ ...valid, employmentType: ok }).success, ok).toBe(true);
      }
      for (const bad of ["full-time", "contract", "", null, 3]) {
        expect(postingInputSchema.safeParse({ ...valid, employmentType: bad }).success, String(bad)).toBe(false);
      }
    });

    it("pay is an integer 0..100,000,000", () => {
      expect(postingInputSchema.safeParse({ ...valid, payMinCents: 0, payMaxCents: 100_000_000 }).success).toBe(true);
      for (const bad of [-1, 100_000_001, 45.5, Number.NaN, "4500"]) {
        expect(postingInputSchema.safeParse({ ...valid, payMinCents: bad, payMaxCents: null }).success, String(bad)).toBe(false);
      }
    });

    it("the raw description is only request-size capped here", () => {
      expect(postingInputSchema.safeParse({ ...valid, descriptionMd: "x".repeat(100_000) }).success).toBe(true);
      expect(postingInputSchema.safeParse({ ...valid, descriptionMd: "x".repeat(100_001) }).success).toBe(false);
      expect(postingInputSchema.safeParse({ ...valid, descriptionMd: 5 }).success).toBe(false);
    });
  });

  describe("pay coupling", () => {
    it("min greater than max", () => {
      expect(issues(postingInputSchema, { ...valid, payMinCents: 7000, payMaxCents: 6000 })).toEqual([
        { path: "payMaxCents", message: "The highest pay must be at least the lowest." },
      ]);
    });
    it("min equal to max is fine; one amount alone is fine", () => {
      expect(postingInputSchema.safeParse({ ...valid, payMinCents: 5000, payMaxCents: 5000 }).success).toBe(true);
      expect(postingInputSchema.safeParse({ ...valid, payMinCents: 5000, payMaxCents: null }).success).toBe(true);
      expect(postingInputSchema.safeParse({ ...valid, payMinCents: null, payMaxCents: 5000 }).success).toBe(true);
    });
    it("amounts without a unit", () => {
      expect(issues(postingInputSchema, { ...valid, payUnit: null })).toEqual([
        { path: "payUnit", message: "Choose per hour or per year." },
      ]);
    });
    it("a unit without amounts", () => {
      expect(issues(postingInputSchema, { ...valid, payMinCents: null, payMaxCents: null })).toEqual([
        { path: "payUnit", message: GENERIC_SAVE_ERROR },
      ]);
    });
    it("a unit outside hour/year", () => {
      expect(postingInputSchema.safeParse({ ...valid, payUnit: "month" }).success).toBe(false);
    });
  });

  describe("closingDate", () => {
    it("empty means none", () => {
      expect(postingInputSchema.parse({ ...valid, closingDate: "" }).closingDate).toBeNull();
      expect(postingInputSchema.parse({ ...valid, closingDate: null }).closingDate).toBeNull();
      expect(postingInputSchema.parse({ ...valid, closingDate: undefined }).closingDate).toBeNull();
    });
    it("a real day inside 2000-01-01 .. 2100-01-01", () => {
      for (const ok of ["2000-01-01", "2100-01-01", "2028-02-29"]) {
        expect(postingInputSchema.safeParse({ ...valid, closingDate: ok }).success, ok).toBe(true);
      }
    });
    it("refuses an impossible, malformed or out-of-window day", () => {
      for (const bad of ["2026-02-30", "2027-02-29", "1999-12-31", "2100-01-02", "2026-1-5", "tomorrow", "2026-13-01"]) {
        expect(issues(postingInputSchema, { ...valid, closingDate: bad }), bad).toEqual([
          { path: "closingDate", message: "Enter a date." },
        ]);
      }
    });
  });

  describe("slug", () => {
    it("absent or empty means generate", () => {
      expect(postingInputSchema.parse(valid).slug).toBeUndefined();
      expect(postingInputSchema.parse({ ...valid, slug: "" }).slug).toBeUndefined();
      expect(postingInputSchema.parse({ ...valid, slug: null }).slug).toBeUndefined();
    });
    it("is lower-cased and trimmed", () => {
      expect(postingInputSchema.parse({ ...valid, slug: "  Music-Director " }).slug).toBe("music-director");
    });
    it("matches the database shape, 1-80", () => {
      expect(postingInputSchema.safeParse({ ...valid, slug: "a".repeat(80) }).success).toBe(true);
      for (const bad of ["a".repeat(81), "a b", "-a", "a-", "a--b", "../x", "a_b", "é"]) {
        expect(issues(postingInputSchema, { ...valid, slug: bad }), bad).toEqual([
          { path: "slug", message: "Use letters, numbers and dashes only." },
        ]);
      }
    });
  });

  it("strips keys the client has no business sending", () => {
    const parsed = postingInputSchema.parse({
      ...valid,
      status: "published",
      organizationId: GUID,
      version: 9,
      sortOrder: -5,
      postedOn: "2020-01-01",
      firstPublishedAt: "2020-01-01",
      createdBy: GUID,
    });
    expect(Object.keys(parsed).sort()).toEqual(
      ["closingDate", "descriptionMd", "employmentType", "location", "payMaxCents", "payMinCents", "payUnit", "summary", "title"].sort(),
    );
  });

  it("rejects a non-object", () => {
    for (const bad of [null, undefined, "x", 5, []]) {
      expect(postingInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("the parsed shape is the PostingInput type", () => {
    expectTypeOf(postingInputSchema.parse(valid)).toMatchTypeOf<PostingInput>();
  });
});

describe("postingUpdateSchema", () => {
  const update = { ...valid, id: GUID, version: 3 };

  it("parses a valid update and keeps id and version", () => {
    const result = postingUpdateSchema.parse(update);
    expect(result.id).toBe(GUID);
    expect(result.version).toBe(3);
    expectTypeOf(result).toMatchTypeOf<PostingUpdateInput>();
  });

  it("ids are GUIDs (including the all-ones fixture shape), not free text", () => {
    for (const bad of ["", "not-a-uuid", "1", "11111111-1111-1111-1111-11111111111", `${GUID}0`]) {
      expect(postingUpdateSchema.safeParse({ ...update, id: bad }).success, bad).toBe(false);
    }
  });

  it("version is an integer of at least 1", () => {
    for (const bad of [0, -1, 1.5, "3", null, Number.NaN]) {
      expect(postingUpdateSchema.safeParse({ ...update, version: bad }).success, String(bad)).toBe(false);
    }
  });

  it("runs the same cross-field rules", () => {
    expect(issues(postingUpdateSchema, { ...update, payUnit: null })[0]).toEqual({
      path: "payUnit",
      message: "Choose per hour or per year.",
    });
  });
});

describe("postingStatusSchema and postingMoveSchema", () => {
  it("status: only published or closed, never draft", () => {
    expect(postingStatusSchema.safeParse({ id: GUID, version: 1, to: "published" }).success).toBe(true);
    expect(postingStatusSchema.safeParse({ id: GUID, version: 1, to: "closed" }).success).toBe(true);
    for (const bad of ["draft", "open", "", null]) {
      expect(postingStatusSchema.safeParse({ id: GUID, version: 1, to: bad }).success, String(bad)).toBe(false);
    }
    expect(postingStatusSchema.safeParse({ id: "x", version: 1, to: "closed" }).success).toBe(false);
    expect(postingStatusSchema.safeParse({ id: GUID, version: 0, to: "closed" }).success).toBe(false);
  });

  it("move: up or down", () => {
    expect(postingMoveSchema.safeParse({ id: GUID, direction: "up" }).success).toBe(true);
    expect(postingMoveSchema.safeParse({ id: GUID, direction: "down" }).success).toBe(true);
    expect(postingMoveSchema.safeParse({ id: GUID, direction: "sideways" }).success).toBe(false);
  });
});

describe("parseDollarsToCents", () => {
  it.each([
    ["45", 4500],
    ["45.5", 4550],
    ["45.50", 4550],
    ["$45", 4500],
    ["52,000", 5_200_000],
    ["$52,000.50", 5_200_050],
    [" $ 1 2 ", 1200],
    ["0", 0],
    ["0.05", 5],
    ["1234567", 123_456_700],
  ])("accepts %s as %i cents", (raw, cents) => {
    expect(parseDollarsToCents(raw)).toBe(cents);
  });

  it.each(["1e3", "45.555", "-1", "", "12345678", "abc", "4 5.5.5", ".5", "45.", "+5", "0x10", "١٢"])(
    "refuses %j",
    (raw) => {
      expect(parseDollarsToCents(raw)).toBeNull();
    },
  );

  it("never goes through a float (no 0.1 + 0.2 drift)", () => {
    expect(parseDollarsToCents("0.29")).toBe(29);
    expect(parseDollarsToCents("19.99")).toBe(1999);
    expect(parseDollarsToCents("1.15")).toBe(115);
  });
});

describe("tamper cases", () => {
  it("prototype pollution keys are inert", () => {
    const parsed = postingInputSchema.parse(JSON.parse(`{"__proto__":{"admin":true},"constructor":1,${JSON.stringify(valid).slice(1)}`));
    expect((parsed as unknown as Record<string, unknown>).admin).toBeUndefined();
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});

describe("firstIssue - only Copy leaves the building", () => {
  it("passes a Copy S6 field error through with its field", () => {
    const result = postingInputSchema.safeParse({ ...valid, title: " " });
    if (result.success) throw new Error("expected failure");
    expect(firstIssue(result.error)).toEqual({ field: "title", message: "Enter a title." });
  });

  it("turns zod's own engineering messages into the generic line", () => {
    for (const bad of [null, "x", 5, [], { ...valid, employmentType: "nope" }, { ...valid, payMinCents: "4500" }]) {
      const result = postingInputSchema.safeParse(bad);
      if (result.success) throw new Error("expected failure");
      const { message } = firstIssue(result.error);
      expect(message, JSON.stringify(bad)).toBe(GENERIC_SAVE_ERROR);
      expect(message).not.toMatch(/invalid|expected|received/i);
    }
  });

  it("names the field, or 'input' for a non-object", () => {
    const result = postingInputSchema.safeParse(null);
    if (result.success) throw new Error("expected failure");
    expect(firstIssue(result.error).field).toBe("input");
  });
});
