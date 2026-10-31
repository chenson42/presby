import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CAREERS_FEATURE_KEY,
  CAREERS_SLOT,
  DESCRIPTION_MAX,
  LOCATION_MAX,
  MAX_PUBLISHED_PER_ORG,
  PAY_CENTS_MAX,
  PUBLIC_POSTINGS_CAP,
  SLUG_MAX,
  STALE_AFTER_DAYS,
  SUMMARY_MAX,
  TITLE_MAX,
  employmentTypeLabel,
  formatPay,
  type PublicPostingSummary,
} from "./contract";

describe("formatPay (Copy P9)", () => {
  it("a range, in whole dollars when the cents are zero", () => {
    expect(formatPay(4500, 6000, "hour")).toBe("$45 to $60 per hour");
    expect(formatPay(5_200_000, 6_000_000, "year")).toBe("$52,000 to $60,000 per year");
  });

  it("two decimals when the cents are not zero", () => {
    expect(formatPay(4550, 6005, "hour")).toBe("$45.50 to $60.05 per hour");
    expect(formatPay(4505, 4505, "hour")).toBe("$45.05 per hour");
  });

  it("one amount when min equals max", () => {
    expect(formatPay(4500, 4500, "hour")).toBe("$45 per hour");
  });

  it("from and up to", () => {
    expect(formatPay(4500, null, "hour")).toBe("From $45 per hour");
    expect(formatPay(null, 6_000_000, "year")).toBe("Up to $60,000 per year");
  });

  it("no line when no pay was entered, or when an amount has no unit", () => {
    expect(formatPay(null, null, null)).toBeNull();
    expect(formatPay(null, null, "hour")).toBeNull();
    expect(formatPay(4500, null, null)).toBeNull();
  });

  it("zero is a real amount", () => {
    expect(formatPay(0, 0, "hour")).toBe("$0 per hour");
  });

  it("groups thousands past a million", () => {
    expect(formatPay(PAY_CENTS_MAX, PAY_CENTS_MAX, "year")).toBe("$1,000,000 per year");
  });
});

describe("employmentTypeLabel (Copy P4)", () => {
  it("labels the three types", () => {
    expect(employmentTypeLabel("full_time")).toBe("Full-time");
    expect(employmentTypeLabel("part_time")).toBe("Part-time");
    expect(employmentTypeLabel("intern")).toBe("Intern");
  });
});

describe("the constants are the database's", () => {
  const MIGRATION = readFileSync(
    path.resolve(__dirname, "../../../drizzle/0071_presby_careers.sql"),
    "utf8",
  );

  it("equals the design's table", () => {
    expect({
      PUBLIC_POSTINGS_CAP,
      MAX_PUBLISHED_PER_ORG,
      DESCRIPTION_MAX,
      SUMMARY_MAX,
      TITLE_MAX,
      LOCATION_MAX,
      SLUG_MAX,
      STALE_AFTER_DAYS,
    }).toEqual({
      PUBLIC_POSTINGS_CAP: 100,
      MAX_PUBLISHED_PER_ORG: 100,
      DESCRIPTION_MAX: 20000,
      SUMMARY_MAX: 300,
      TITLE_MAX: 150,
      LOCATION_MAX: 200,
      SLUG_MAX: 80,
      STALE_AFTER_DAYS: 60,
    });
  });

  it("matches the literals the migration carries", () => {
    expect(MIGRATION).toMatch(new RegExp(`c_cap\\s+constant integer := ${PUBLIC_POSTINGS_CAP};`));
    expect(MIGRATION).toMatch(
      new RegExp(`c_published_cap\\s+constant integer := ${MAX_PUBLISHED_PER_ORG};`),
    );
    expect(MIGRATION).toContain(`char_length(description_md) <= ${DESCRIPTION_MAX}`);
    expect(MIGRATION).toContain(`char_length(summary) <= ${SUMMARY_MAX}`);
    expect(MIGRATION).toContain(`char_length(location) <= ${LOCATION_MAX}`);
    expect(MIGRATION).toContain(`between 1 and ${TITLE_MAX}`);
    expect(MIGRATION).toContain(`between 1 and ${SLUG_MAX}`);
    expect(MIGRATION).toContain(`between 0 and ${PAY_CENTS_MAX}`);
  });

  it("names the slot and the toggle key", () => {
    expect(CAREERS_SLOT).toBe("careers");
    expect(CAREERS_FEATURE_KEY).toBe("org_portal.careers");
    expect(MIGRATION).toContain(`'${CAREERS_FEATURE_KEY}'`);
  });
});

describe("PublicPostingSummary", () => {
  it("has no id, organization id, status or version", () => {
    type Keys = keyof PublicPostingSummary;
    expectTypeOf<Keys>().toEqualTypeOf<
      | "slug"
      | "title"
      | "location"
      | "employmentType"
      | "payMinCents"
      | "payMaxCents"
      | "payUnit"
      | "summary"
      | "postedOn"
      | "closingDate"
    >();
  });
});
