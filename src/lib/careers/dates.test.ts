import { describe, expect, it } from "vitest";
import { closingDatePassed, isStale, isValidClosingDate, isVisibleToPublic } from "./dates";

describe("closingDatePassed", () => {
  it("is inclusive: the closing day itself is still open", () => {
    expect(closingDatePassed("2026-11-03", "2026-11-03")).toBe(false);
    expect(closingDatePassed("2026-11-03", "2026-11-02")).toBe(false);
    expect(closingDatePassed("2026-11-03", "2026-11-04")).toBe(true);
  });
  it("no closing date never passes", () => {
    expect(closingDatePassed(null, "2099-01-01")).toBe(false);
  });
});

describe("isValidClosingDate", () => {
  it("accepts real days in 2000-01-01 .. 2100-01-01", () => {
    expect(isValidClosingDate("2000-01-01")).toBe(true);
    expect(isValidClosingDate("2100-01-01")).toBe(true);
    expect(isValidClosingDate("2026-02-28")).toBe(true);
  });
  it("refuses out-of-window, impossible and malformed days", () => {
    expect(isValidClosingDate("1999-12-31")).toBe(false);
    expect(isValidClosingDate("2100-01-02")).toBe(false);
    expect(isValidClosingDate("2026-02-30")).toBe(false);
    expect(isValidClosingDate("2026-2-3")).toBe(false);
    expect(isValidClosingDate("")).toBe(false);
  });
});

describe("isVisibleToPublic", () => {
  it("only published, and not past the closing date", () => {
    expect(isVisibleToPublic("published", null, "2026-11-03")).toBe(true);
    expect(isVisibleToPublic("published", "2026-11-03", "2026-11-03")).toBe(true);
    expect(isVisibleToPublic("published", "2026-11-02", "2026-11-03")).toBe(false);
    expect(isVisibleToPublic("draft", null, "2026-11-03")).toBe(false);
    expect(isVisibleToPublic("closed", null, "2026-11-03")).toBe(false);
  });
});

describe("isStale", () => {
  it("is true at 60 days and after, with no closing date", () => {
    expect(isStale("2026-01-01", null, "2026-03-02")).toBe(true); // exactly 60 days
    expect(isStale("2026-01-01", null, "2026-03-01")).toBe(false); // 59 days
    expect(isStale("2026-01-01", null, "2027-01-01")).toBe(true);
  });
  it("is false with a closing date, or never posted", () => {
    expect(isStale("2026-01-01", "2026-12-31", "2027-01-01")).toBe(false);
    expect(isStale(null, null, "2027-01-01")).toBe(false);
  });
  it("is false rather than throwing on a malformed key", () => {
    expect(isStale("nope", null, "2027-01-01")).toBe(false);
    expect(isStale("2026-01-01", null, "nope")).toBe(false);
  });
});
