/**
 * The generated wording (DECISION-173, R12). The GOLDEN block is deliberate
 * friction: the required text is versioned code, so editing a string without
 * bumping STATEMENT_WORDING_VERSION fails here - and a snapshot's old version
 * keeps rendering its own words.
 */
import { describe, expect, it } from "vitest";
import { STATEMENT_WORDING_VERSION } from "../statement-policy";
import { composeGreeting, DEFAULT_CLOSING, DEFAULT_GREETING, formatLongDate, statementWording } from "./wording";

describe("statementWording v1 (golden)", () => {
  const w = statementWording(1);

  it("matches the version the policy constant names", () => {
    expect(STATEMENT_WORDING_VERSION).toBe(1);
    expect(w.version).toBe(STATEMENT_WORDING_VERSION);
  });

  it("titles, intro and the corrected line", () => {
    expect(w.title(2027)).toBe("2027 Contribution Statement");
    expect(w.correctedTitle("2028-01-15")).toBe("Corrected statement, replaces statement dated January 15, 2028");
    expect(w.issuedLine("2028-02-09")).toBe("Date issued: February 9, 2028");
    expect(w.intro("Fixture Presbyterian Church", 2027)).toBe(
      "This statement lists the contributions received by Fixture Presbyterian Church from January 1, 2027 through December 31, 2027.",
    );
  });

  it("the required block for a plain cash statement", () => {
    expect(
      w.requiredBlock({ doneeName: "Fixture Presbyterian Church", ein: null, nonCash: false, coveredFee: false, coveredFeeCounted: true, corrected: false, replacesDate: null }),
    ).toEqual([
      "Fixture Presbyterian Church acknowledges receipt of the contributions listed above.",
      "No goods or services were provided in exchange for these contributions.",
      "Please keep this statement with your tax records.",
    ]);
  });

  it("adds the non-cash sentence, the covered-fee sentence (by policy) and the correction sentence only when they apply", () => {
    const all = (coveredFeeCounted: boolean) =>
      w.requiredBlock({ doneeName: "X", ein: null, nonCash: true, coveredFee: true, coveredFeeCounted, corrected: true, replacesDate: "2028-01-15" });
    expect(all(true)).toEqual([
      "This corrected statement replaces the statement dated January 15, 2028. Please use this statement for your records.",
      "X acknowledges receipt of the contributions listed above.",
      "No goods or services were provided in exchange for these contributions.",
      "Non-cash gifts are described, not valued. The donor is responsible for determining the value of a non-cash gift.",
      "Where a donor chose to cover the processing fee on an online gift, the fee is included in the amount shown.",
      "Please keep this statement with your tax records.",
    ]);
    expect(all(false)[4]).toBe("Where a donor chose to cover the processing fee on an online gift, the fee is not included in the amount shown.");
  });

  it("never uses the phrase the CPA has not ruled on (Operator Q6)", () => {
    const text = JSON.stringify(
      w.requiredBlock({ doneeName: "X", ein: "12-3456789", nonCash: true, coveredFee: true, coveredFeeCounted: true, corrected: true, replacesDate: "2028-01-15" }),
    );
    expect(text).not.toContain("intangible religious");
  });

  it("the non-cash summary pluralizes", () => {
    expect(w.nonCashSummary(1)).toBe("1 non-cash gift is described above. Its value is not stated.");
    expect(w.nonCashSummary(3)).toBe("3 non-cash gifts are described above. Their value is not stated.");
  });

  it("an unknown version throws rather than falling back", () => {
    expect(() => statementWording(2)).toThrow(/unknown wording version 2/);
    expect(() => statementWording(0)).toThrow(/unknown wording version/);
  });
});

describe("composeGreeting (plain replacement, no engine)", () => {
  it("replaces every token and nothing else", () => {
    expect(composeGreeting("Dear {donor_name},", "Linden Marsh")).toBe("Dear Linden Marsh,");
    expect(composeGreeting("{donor_name} - thank you, {donor_name}.", "A")).toBe("A - thank you, A.");
    expect(composeGreeting("Thank you for your gifts this year.", "Linden Marsh")).toBe("Thank you for your gifts this year.");
  });

  it("treats a hostile name as data: braces, markup, replacement patterns, a 10,000-character name", () => {
    expect(composeGreeting(DEFAULT_GREETING, "{{x}}")).toBe("Dear {{x}},");
    expect(composeGreeting(DEFAULT_GREETING, "<script>alert(1)</script>")).toBe("Dear <script>alert(1)</script>,");
    expect(composeGreeting(DEFAULT_GREETING, "$& $1 $` $' $$")).toBe("Dear $& $1 $` $' $$,");
    const huge = "W".repeat(10_000);
    expect(composeGreeting(DEFAULT_GREETING, huge)).toBe(`Dear ${huge},`);
    expect(composeGreeting(DEFAULT_GREETING, "{donor_name}")).toBe("Dear {donor_name},");
  });

  it("has defaults a congregation that left the fields blank still prints", () => {
    expect(DEFAULT_GREETING).toBe("Dear {donor_name},");
    expect(DEFAULT_CLOSING.length).toBeGreaterThan(0);
  });
});

describe("formatLongDate", () => {
  it("formats a calendar date with no time zone involved", () => {
    expect(formatLongDate("2028-01-05")).toBe("January 5, 2028");
    expect(formatLongDate("2027-12-31")).toBe("December 31, 2027");
  });
  it("rejects anything else", () => {
    expect(() => formatLongDate("2028-13-01")).toThrow();
    expect(() => formatLongDate("1/5/2028")).toThrow();
  });
});
