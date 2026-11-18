/**
 * U1: the congregation-records validators' boundaries (docs/work-log/
 * 2026-11-17-congregation-profile.md, Phase 3 "Test plan"). `year` and `today`
 * are injected, so no test uses fake timers. Every message asserted is a Copy C9
 * string.
 */
import { describe, expect, it } from "vitest";
import {
  appraisalSchema,
  buildingSchema,
  charLength,
  cleanLine,
  cleanText,
  insuranceSchema,
  loanSchema,
  paidOffSchema,
  parseAppraisal,
  parseBuilding,
  parseDate,
  parseInsurance,
  parseLoan,
  parseMoneyToCents,
  parsePaidOff,
  parseProfile,
  parseRetire,
  parseYear,
  profileSchema,
  retireSchema,
  type AppraisalValues,
  type BuildingValues,
  type InsuranceValues,
  type LoanValues,
  type ProfileValues,
} from "./validate";

const ENV = { year: 2026, today: "2026-06-15" };

const profile = (over: Partial<ProfileValues> = {}): ProfileValues => ({
  streetAddress: "",
  city: "",
  county: "",
  yearOrganized: "",
  phone: "",
  ...over,
});
const building = (over: Partial<BuildingValues> = {}): BuildingValues => ({
  name: "Main sanctuary",
  buildingType: "sanctuary",
  primary: false,
  yearBuilt: "",
  firstAdditionYear: "",
  secondAdditionYear: "",
  squareFeet: "",
  roofCondition: "",
  plumbingCondition: "",
  hvacCondition: "",
  boilerCondition: "",
  hasSprinklers: "",
  hasFireAlarm: "",
  hasSecuritySystem: "",
  notes: "",
  ...over,
});
const appraisal = (over: Partial<AppraisalValues> = {}): AppraisalValues => ({
  assessedYear: "2024",
  amount: "1250000",
  notes: "",
  ...over,
});
const insurance = (over: Partial<InsuranceValues> = {}): InsuranceValues => ({
  policyYear: "2026",
  carrier: "",
  policyNumber: "",
  policyExpiresOn: "",
  recentClaims: "",
  poolInterest: "",
  notes: "",
  ...over,
});
const loan = (over: Partial<LoanValues> = {}): LoanValues => ({
  kind: "presbytery_program",
  lender: "",
  originalAmount: "",
  currentBalance: "",
  balanceAsOf: "",
  grantsAmount: "",
  guaranteeNote: "",
  notes: "",
  status: "open",
  ...over,
});

/** The first error message for a field, or null when the parse succeeded. */
function errorOf(parsed: { ok: boolean; errors?: Record<string, string> }, field: string): string | null {
  return parsed.ok ? null : (parsed.errors?.[field] ?? null);
}

describe("parseYear / parseDate / parseMoneyToCents / cleaning", () => {
  it("parseYear reads four digits only", () => {
    expect(parseYear("")).toEqual({ kind: "empty" });
    expect(parseYear("  ")).toEqual({ kind: "empty" });
    expect(parseYear("1950")).toEqual({ kind: "year", value: 1950 });
    expect(parseYear(" 1950 ")).toEqual({ kind: "year", value: 1950 });
    for (const bad of ["195", "19500", "19a0", "1950.5", "-1950", "0x7b0", "1e3"]) expect(parseYear(bad)).toEqual({ kind: "format" });
  });

  it("parseDate accepts a real calendar day only", () => {
    expect(parseDate("2026-06-15")).toBe("2026-06-15");
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "6/15/2026", "2026-6-5", "", "tomorrow"]) {
      expect(parseDate(bad), bad).toBeNull();
    }
  });

  it("parseMoneyToCents: the whole matrix", () => {
    const cents = (v: number) => ({ kind: "cents", value: v });
    expect(parseMoneyToCents("")).toEqual({ kind: "empty" });
    expect(parseMoneyToCents("   ")).toEqual({ kind: "empty" });
    expect(parseMoneyToCents("0")).toEqual(cents(0));
    expect(parseMoneyToCents("0.01")).toEqual(cents(1));
    expect(parseMoneyToCents("1250000")).toEqual(cents(125_000_000));
    expect(parseMoneyToCents("1,250,000")).toEqual(cents(125_000_000));
    expect(parseMoneyToCents("$5")).toEqual(cents(500));
    expect(parseMoneyToCents("$ 5")).toEqual(cents(500));
    expect(parseMoneyToCents("1250000.50")).toEqual(cents(125_000_050));
    expect(parseMoneyToCents("1250000.5")).toEqual(cents(125_000_050));
    expect(parseMoneyToCents("1000000000")).toEqual(cents(100_000_000_000));
    expect(parseMoneyToCents("1,000,000,000.00")).toEqual(cents(100_000_000_000));
    expect(parseMoneyToCents("1000000000.01")).toEqual({ kind: "too_large" });
    expect(parseMoneyToCents("1000000001")).toEqual({ kind: "too_large" });
    expect(parseMoneyToCents("99999999999999999999")).toEqual({ kind: "too_large" });
    for (const bad of ["1e5", "-1", "12.345", ".5", "5.", "1,25", "1,2500", "12,34,567", "abc", "1 000", "$-5", "5%", "NaN", "Infinity"]) {
      expect(parseMoneyToCents(bad), bad).toEqual({ kind: "format" });
    }
  });

  it("cleanLine drops control characters and collapses spaces; cleanText keeps LF line breaks", () => {
    expect(cleanLine("  Hall\u0000 of\t  Fame\n ")).toBe("Hall of Fame");
    expect(cleanText("Line one\r\nLine\u0007 two three\u0000 ")).toBe("Line one\nLine two\nthree");
  });

  it("charLength counts code points as Postgres char_length does", () => {
    expect(charLength("abc")).toBe(3);
    expect(charLength("\u{1F3DB}")).toBe(1);
    expect("\u{1F3DB}".length).toBe(2);
  });
});

describe("parseProfile", () => {
  it("accepts an all-empty profile as all nulls", () => {
    expect(parseProfile(profile(), ENV)).toEqual({
      ok: true,
      value: { streetAddress: null, city: null, county: null, yearOrganized: null, phone: null },
    });
  });

  it("normalises the address: 6 lines pass, 7 fail with the existing normalizeAddress message", () => {
    const six = Array.from({ length: 6 }, (_, i) => `Line ${i + 1}`).join("\n");
    expect(parseProfile(profile({ streetAddress: six }), ENV)).toMatchObject({ ok: true, value: { streetAddress: six } });
    const seven = `${six}\nLine 7`;
    expect(errorOf(parseProfile(profile({ streetAddress: seven }), ENV), "streetAddress")).toBe("Address can have up to 6 lines.");
    expect(errorOf(parseProfile(profile({ streetAddress: "x".repeat(501) }), ENV), "streetAddress")).toBe(
      "Address is too long (up to 500 characters).",
    );
  });

  it("the address's control characters and CRLF are cleaned, blank lines dropped", () => {
    const parsed = parseProfile(profile({ streetAddress: "  1 Main St\r\n\r\n\tSuite\u0000 2 \r\nTown, ST 00000" }), ENV);
    expect(parsed).toMatchObject({ ok: true, value: { streetAddress: "1 Main St\nSuite 2\nTown, ST 00000" } });
  });

  it("city and county: 100 passes, 101 fails; control characters in a name become spaces", () => {
    expect(parseProfile(profile({ city: "c".repeat(100), county: "k".repeat(100) }), ENV).ok).toBe(true);
    const long = parseProfile(profile({ city: "c".repeat(101), county: "k".repeat(101) }), ENV);
    expect(errorOf(long, "city")).toBe("City must be 100 characters or fewer.");
    expect(errorOf(long, "county")).toBe("County must be 100 characters or fewer.");
    expect(parseProfile(profile({ city: "Spring\u0000field" }), ENV)).toMatchObject({ ok: true, value: { city: "Spring field" } });
  });

  it("phone: digits, spaces and + ( ) - . x, up to 40", () => {
    for (const ok of ["614-555-0100", "(614) 555 0100 x12", "+1 614.555.0100", "6145550100"]) {
      expect(parseProfile(profile({ phone: ok }), ENV), ok).toMatchObject({ ok: true });
    }
    for (const bad of ["call us", "555-0100;", "5".repeat(41), "555<script>"]) {
      expect(errorOf(parseProfile(profile({ phone: bad }), ENV), "phone"), bad).toBe(
        "Phone can have digits, spaces and + ( ) - . x only, up to 40 characters.",
      );
    }
    expect(parseProfile(profile({ phone: "5".repeat(40) }), ENV).ok).toBe(true);
  });

  it("year organized: 1599 fails, 1600 and the current year pass, current+1 fails, a non-year fails", () => {
    const range = "Year organized must be between 1600 and 2026.";
    expect(errorOf(parseProfile(profile({ yearOrganized: "1599" }), ENV), "yearOrganized")).toBe(range);
    expect(parseProfile(profile({ yearOrganized: "1600" }), ENV)).toMatchObject({ ok: true, value: { yearOrganized: 1600 } });
    expect(parseProfile(profile({ yearOrganized: "2026" }), ENV)).toMatchObject({ ok: true, value: { yearOrganized: 2026 } });
    expect(errorOf(parseProfile(profile({ yearOrganized: "2027" }), ENV), "yearOrganized")).toBe(range);
    expect(errorOf(parseProfile(profile({ yearOrganized: "2101" }), ENV), "yearOrganized")).toBe(range);
    expect(errorOf(parseProfile(profile({ yearOrganized: "nineteen" }), ENV), "yearOrganized")).toBe(
      "Year organized must be a four-digit year.",
    );
    // {year} is interpolated from the injected env, not the clock.
    expect(errorOf(parseProfile(profile({ yearOrganized: "2031" }), { year: 2030, today: "2030-01-01" }), "yearOrganized")).toBe(
      "Year organized must be between 1600 and 2030.",
    );
  });

  it("a malformed (non-object, wrongly typed) payload reads as empty, never throws", () => {
    expect(parseProfile(null, ENV).ok).toBe(true);
    expect(parseProfile({ city: 42, phone: { x: 1 }, yearOrganized: ["1950"] }, ENV)).toMatchObject({ ok: true, value: { city: null, phone: null, yearOrganized: null } });
  });
});

describe("parseBuilding", () => {
  it("accepts a bare building and returns closed values", () => {
    expect(parseBuilding(building(), ENV)).toMatchObject({
      ok: true,
      value: { name: "Main sanctuary", buildingType: "sanctuary", primary: false, yearBuilt: null, squareFeet: null, roofCondition: null, hasSprinklers: null, notes: null },
    });
  });

  it("name: required, 120 passes, 121 fails, control characters collapse", () => {
    expect(errorOf(parseBuilding(building({ name: "   " }), ENV), "name")).toBe("Enter a name for the building.");
    expect(parseBuilding(building({ name: "n".repeat(120) }), ENV).ok).toBe(true);
    expect(errorOf(parseBuilding(building({ name: "n".repeat(121) }), ENV), "name")).toBe("Name must be 120 characters or fewer.");
    expect(parseBuilding(building({ name: "Fellowship\u0000\u0007  Hall" }), ENV)).toMatchObject({ ok: true, value: { name: "Fellowship Hall" } });
    // an emoji is one character, as in the database
    expect(parseBuilding(building({ name: "\u{1F3DB}".repeat(120) }), ENV).ok).toBe(true);
  });

  it("type: every listed value passes; empty and unknown fail", () => {
    for (const type of ["sanctuary", "education_building", "fellowship_hall", "manse", "parsonage", "office", "vacant_land", "annex", "gymnasium", "other"]) {
      expect(parseBuilding(building({ buildingType: type }), ENV).ok, type).toBe(true);
    }
    for (const bad of ["", "Sanctuary", "chapel", "other "]) {
      expect(errorOf(parseBuilding(building({ buildingType: bad }), ENV), "buildingType"), bad).toBe("Choose a type.");
    }
  });

  it("years: 1599 fails, 1600 passes, the current year passes, current+1 fails; a non-year says four-digit", () => {
    for (const [field, label] of [
      ["yearBuilt", "Year built"],
      ["firstAdditionYear", "First addition"],
    ] as const) {
      expect(errorOf(parseBuilding(building({ [field]: "1599" }), ENV), field)).toBe(`${label} must be between 1600 and 2026.`);
      expect(parseBuilding(building({ [field]: "1600" }), ENV).ok).toBe(true);
      expect(parseBuilding(building({ [field]: "2026" }), ENV).ok).toBe(true);
      expect(errorOf(parseBuilding(building({ [field]: "2027" }), ENV), field)).toBe(`${label} must be between 1600 and 2026.`);
      expect(errorOf(parseBuilding(building({ [field]: "abcd" }), ENV), field)).toBe(`${label} must be a four-digit year.`);
    }
    expect(errorOf(parseBuilding(building({ firstAdditionYear: "1960", secondAdditionYear: "2027" }), ENV), "secondAdditionYear")).toBe(
      "Second addition must be between 1600 and 2026.",
    );
  });

  it("addition ordering: first >= built, second >= first, second needs the first", () => {
    expect(errorOf(parseBuilding(building({ yearBuilt: "1950", firstAdditionYear: "1949" }), ENV), "firstAdditionYear")).toBe(
      "The first addition can't be before the year built.",
    );
    expect(parseBuilding(building({ yearBuilt: "1950", firstAdditionYear: "1950" }), ENV).ok).toBe(true);
    expect(errorOf(parseBuilding(building({ firstAdditionYear: "1960", secondAdditionYear: "1959" }), ENV), "secondAdditionYear")).toBe(
      "The second addition can't be before the first.",
    );
    expect(parseBuilding(building({ firstAdditionYear: "1960", secondAdditionYear: "1960" }), ENV).ok).toBe(true);
    expect(errorOf(parseBuilding(building({ secondAdditionYear: "1970" }), ENV), "secondAdditionYear")).toBe(
      "Enter the first addition before the second.",
    );
    // an addition with no build year recorded is not blocked
    expect(parseBuilding(building({ firstAdditionYear: "1960" }), ENV).ok).toBe(true);
    // the first addition being itself invalid does not also claim the second "needs" it
    expect(errorOf(parseBuilding(building({ firstAdditionYear: "19x0", secondAdditionYear: "1970" }), ENV), "secondAdditionYear")).toBeNull();
  });

  it("square feet: 0 fails, 1 passes, 5,000,000 passes, 5,000,001 fails, a decimal and text fail", () => {
    const format = "Square feet must be a whole number of at least 1.";
    expect(errorOf(parseBuilding(building({ squareFeet: "0" }), ENV), "squareFeet")).toBe(format);
    expect(parseBuilding(building({ squareFeet: "1" }), ENV)).toMatchObject({ ok: true, value: { squareFeet: 1 } });
    expect(parseBuilding(building({ squareFeet: "5000000" }), ENV)).toMatchObject({ ok: true, value: { squareFeet: 5_000_000 } });
    expect(parseBuilding(building({ squareFeet: "5,000,000" }), ENV)).toMatchObject({ ok: true, value: { squareFeet: 5_000_000 } });
    expect(errorOf(parseBuilding(building({ squareFeet: "5000001" }), ENV), "squareFeet")).toBe("Square feet can't be more than 5,000,000.");
    expect(errorOf(parseBuilding(building({ squareFeet: "99999999999" }), ENV), "squareFeet")).toBe("Square feet can't be more than 5,000,000.");
    for (const bad of ["12.5", "-3", "many", "1e3", "1,2"]) expect(errorOf(parseBuilding(building({ squareFeet: bad }), ENV), "squareFeet"), bad).toBe(format);
  });

  it("conditions: good, fair, poor and empty pass; anything else fails", () => {
    for (const c of ["", "good", "fair", "poor"]) expect(parseBuilding(building({ roofCondition: c, boilerCondition: c }), ENV).ok).toBe(true);
    for (const field of ["roofCondition", "plumbingCondition", "hvacCondition", "boilerCondition"] as const) {
      expect(errorOf(parseBuilding(building({ [field]: "excellent" }), ENV), field)).toBe("Choose a condition from the list.");
    }
  });

  it("tri-state: yes, no and empty map to true, false and null; a tampered value is refused", () => {
    const parsed = parseBuilding(building({ hasSprinklers: "yes", hasFireAlarm: "no", hasSecuritySystem: "" }), ENV);
    expect(parsed).toMatchObject({ ok: true, value: { hasSprinklers: true, hasFireAlarm: false, hasSecuritySystem: null } });
    expect(errorOf(parseBuilding(building({ hasSprinklers: "maybe" }), ENV), "hasSprinklers")).toBe(
      "We couldn't save that. Nothing was changed.",
    );
  });

  it("notes: 4000 passes, 4001 fails; line breaks are kept", () => {
    expect(parseBuilding(building({ notes: "n".repeat(4000) }), ENV).ok).toBe(true);
    expect(errorOf(parseBuilding(building({ notes: "n".repeat(4001) }), ENV), "notes")).toBe("Notes must be 4000 characters or fewer.");
    expect(parseBuilding(building({ notes: "Roof: 2018\r\nBoiler: 1996" }), ENV)).toMatchObject({ ok: true, value: { notes: "Roof: 2018\nBoiler: 1996" } });
  });

  it("primary is true only for the boolean true (a string is not a checkbox)", () => {
    expect(parseBuilding(building({ primary: true }), ENV)).toMatchObject({ ok: true, value: { primary: true } });
    expect(parseBuilding({ ...building(), primary: "true" }, ENV)).toMatchObject({ ok: true, value: { primary: false } });
  });

  it("reports several failures together, in field order", () => {
    const parsed = parseBuilding(building({ name: "", buildingType: "", yearBuilt: "1500" }), ENV);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(Object.keys(parsed.errors)).toEqual(["name", "buildingType", "yearBuilt"]);
      expect(parsed.field).toBe("name");
      expect(parsed.message).toBe("Enter a name for the building.");
    }
  });
});

describe("parseRetire", () => {
  it("needs a reason from the list and a real date that is not in the future", () => {
    expect(parseRetire({ reason: "sold", retiredOn: "2026-06-15" }, ENV)).toEqual({ ok: true, value: { reason: "sold", retiredOn: "2026-06-15" } });
    expect(errorOf(parseRetire({ reason: "", retiredOn: "2026-06-15" }, ENV), "reason")).toBe("Choose why this building is retired.");
    expect(errorOf(parseRetire({ reason: "moved", retiredOn: "2026-06-15" }, ENV), "reason")).toBe("Choose why this building is retired.");
    expect(errorOf(parseRetire({ reason: "sold", retiredOn: "" }, ENV), "retiredOn")).toBe("Enter the date.");
    expect(errorOf(parseRetire({ reason: "sold", retiredOn: "2026-02-30" }, ENV), "retiredOn")).toBe("Enter the date.");
    expect(errorOf(parseRetire({ reason: "sold", retiredOn: "2026-06-16" }, ENV), "retiredOn")).toBe("The date can't be in the future.");
    expect(parseRetire({ reason: "other", retiredOn: "1990-01-01" }, ENV).ok).toBe(true);
  });
});

describe("parseAppraisal", () => {
  it("accepts a year and an amount", () => {
    expect(parseAppraisal(appraisal({ notes: "  re-roofed " }), ENV)).toEqual({
      ok: true,
      value: { assessedYear: 2024, amountCents: 125_000_000, notes: "re-roofed" },
    });
  });

  it("year assessed: required; 1599 fails, 1600 and the current year pass, current+1 fails", () => {
    expect(errorOf(parseAppraisal(appraisal({ assessedYear: "" }), ENV), "assessedYear")).toBe("Enter the year assessed.");
    for (const bad of ["1599", "2027", "nope", "20245"]) {
      expect(errorOf(parseAppraisal(appraisal({ assessedYear: bad }), ENV), "assessedYear"), bad).toBe("Year assessed must be between 1600 and 2026.");
    }
    expect(parseAppraisal(appraisal({ assessedYear: "1600" }), ENV).ok).toBe(true);
    expect(parseAppraisal(appraisal({ assessedYear: "2026" }), ENV).ok).toBe(true);
  });

  it("amount: required, more than $0, at most $1,000,000,000, in dollars", () => {
    expect(errorOf(parseAppraisal(appraisal({ amount: "" }), ENV), "amount")).toBe("Enter the appraised amount in dollars.");
    expect(errorOf(parseAppraisal(appraisal({ amount: "0" }), ENV), "amount")).toBe("Amount must be more than $0.");
    expect(errorOf(parseAppraisal(appraisal({ amount: "0.00" }), ENV), "amount")).toBe("Amount must be more than $0.");
    expect(parseAppraisal(appraisal({ amount: "0.01" }), ENV)).toMatchObject({ ok: true, value: { amountCents: 1 } });
    expect(parseAppraisal(appraisal({ amount: "$1,250,000" }), ENV)).toMatchObject({ ok: true, value: { amountCents: 125_000_000 } });
    expect(parseAppraisal(appraisal({ amount: "1000000000" }), ENV).ok).toBe(true);
    expect(errorOf(parseAppraisal(appraisal({ amount: "1000000000.01" }), ENV), "amount")).toBe("Amount can't be more than $1,000,000,000.");
    for (const bad of ["1e5", "-1", "12.345", "lots"]) {
      expect(errorOf(parseAppraisal(appraisal({ amount: bad }), ENV), "amount"), bad).toBe(
        "Enter the amount in dollars, for example 1250000 or 1250000.50.",
      );
    }
  });

  it("notes: 1000 passes, 1001 fails", () => {
    expect(parseAppraisal(appraisal({ notes: "n".repeat(1000) }), ENV).ok).toBe(true);
    expect(errorOf(parseAppraisal(appraisal({ notes: "n".repeat(1001) }), ENV), "notes")).toBe("Notes must be 1000 characters or fewer.");
  });
});

describe("parseInsurance", () => {
  it("accepts a year alone and a full record", () => {
    expect(parseInsurance(insurance(), ENV, "create")).toMatchObject({
      ok: true,
      value: { policyYear: 2026, carrier: null, policyNumber: null, policyExpiresOn: null, recentClaims: null, poolInterest: null, notes: null },
    });
    expect(
      parseInsurance(insurance({ carrier: " Fieldstone Mutual ", policyNumber: "FM-100", policyExpiresOn: "2027-03-01", recentClaims: "no", poolInterest: "yes", notes: "ok" }), ENV, "create"),
    ).toMatchObject({
      ok: true,
      value: { carrier: "Fieldstone Mutual", policyNumber: "FM-100", policyExpiresOn: "2027-03-01", recentClaims: false, poolInterest: true, notes: "ok" },
    });
  });

  it("policy year (create): required; 1899 fails, 1900 passes, current+1 passes, current+2 fails", () => {
    expect(errorOf(parseInsurance(insurance({ policyYear: "" }), ENV, "create"), "policyYear")).toBe("Enter the policy year.");
    const range = "Policy year must be between 1900 and 2027.";
    expect(errorOf(parseInsurance(insurance({ policyYear: "1899" }), ENV, "create"), "policyYear")).toBe(range);
    expect(parseInsurance(insurance({ policyYear: "1900" }), ENV, "create").ok).toBe(true);
    expect(parseInsurance(insurance({ policyYear: "2027" }), ENV, "create").ok).toBe(true);
    expect(errorOf(parseInsurance(insurance({ policyYear: "2028" }), ENV, "create"), "policyYear")).toBe(range);
    expect(errorOf(parseInsurance(insurance({ policyYear: "abcd" }), ENV, "create"), "policyYear")).toBe(range);
    expect(parseInsurance(insurance({ policyYear: "2100" }), { year: 2099, today: "2099-01-01" }, "create").ok).toBe(true);
  });

  it("policy year (edit) is ignored: not required, not validated, never returned", () => {
    expect(parseInsurance(insurance({ policyYear: "garbage" }), ENV, "edit")).toMatchObject({ ok: true, value: { policyYear: null } });
  });

  it("carrier 200, policy number 100, notes 2000: the exact bounds", () => {
    expect(parseInsurance(insurance({ carrier: "c".repeat(200), policyNumber: "p".repeat(100), notes: "n".repeat(2000) }), ENV, "create").ok).toBe(true);
    const long = parseInsurance(insurance({ carrier: "c".repeat(201), policyNumber: "p".repeat(101), notes: "n".repeat(2001) }), ENV, "create");
    expect(errorOf(long, "carrier")).toBe("Carrier must be 200 characters or fewer.");
    expect(errorOf(long, "policyNumber")).toBe("Policy number must be 100 characters or fewer.");
    expect(errorOf(long, "notes")).toBe("Notes must be 2000 characters or fewer.");
  });

  it("expiry: a real date or empty; control characters in a name are cleaned", () => {
    expect(errorOf(parseInsurance(insurance({ policyExpiresOn: "2027-02-30" }), ENV, "create"), "policyExpiresOn")).toBe("Enter a valid date.");
    expect(errorOf(parseInsurance(insurance({ policyExpiresOn: "soon" }), ENV, "create"), "policyExpiresOn")).toBe("Enter a valid date.");
    // an expiry in the past is legitimate history, never refused
    expect(parseInsurance(insurance({ policyExpiresOn: "1999-12-31" }), ENV, "create").ok).toBe(true);
    expect(parseInsurance(insurance({ carrier: "Field\u0000stone" }), ENV, "create")).toMatchObject({ ok: true, value: { carrier: "Field stone" } });
  });
});

describe("parseLoan", () => {
  it("accepts a bare loan and a full one", () => {
    expect(parseLoan(loan(), ENV)).toMatchObject({
      ok: true,
      value: { kind: "presbytery_program", lender: null, originalAmountCents: null, currentBalanceCents: null, balanceAsOf: null, grantsAmountCents: null, status: "open" },
    });
    expect(
      parseLoan(
        loan({ lender: "Presbytery", originalAmount: "$250,000", currentBalance: "120000.50", balanceAsOf: "2026-06-01", grantsAmount: "0", guaranteeNote: "Guaranteed by the session", notes: "n" }),
        ENV,
      ),
    ).toMatchObject({
      ok: true,
      value: { originalAmountCents: 25_000_000, currentBalanceCents: 12_000_050, balanceAsOf: "2026-06-01", grantsAmountCents: 0 },
    });
  });

  it("kind must be listed", () => {
    for (const bad of ["", "mortgage"]) expect(errorOf(parseLoan(loan({ kind: bad }), ENV), "kind"), bad).toBe("Choose the kind of loan.");
    for (const ok of ["presbytery_program", "guaranteed_outside", "other"]) expect(parseLoan(loan({ kind: ok }), ENV).ok, ok).toBe(true);
  });

  it("money fields: $0 is a legitimate recorded amount; max passes; max+1 and bad text fail on the right field", () => {
    expect(parseLoan(loan({ originalAmount: "0", grantsAmount: "0" }), ENV)).toMatchObject({ ok: true, value: { originalAmountCents: 0, grantsAmountCents: 0 } });
    expect(parseLoan(loan({ originalAmount: "1000000000" }), ENV).ok).toBe(true);
    const bad = parseLoan(loan({ originalAmount: "1000000000.01", grantsAmount: "1e5", currentBalance: "-1", balanceAsOf: "2026-06-01" }), ENV);
    expect(errorOf(bad, "originalAmount")).toBe("Amount can't be more than $1,000,000,000.");
    expect(errorOf(bad, "grantsAmount")).toBe("Enter the amount in dollars, for example 1250000 or 1250000.50.");
    expect(errorOf(bad, "currentBalance")).toBe("Enter the amount in dollars, for example 1250000 or 1250000.50.");
  });

  it("the pair rule: a balance needs its date and a date needs its balance", () => {
    expect(errorOf(parseLoan(loan({ currentBalance: "100" }), ENV), "balanceAsOf")).toBe("Enter the date the balance is as of.");
    expect(errorOf(parseLoan(loan({ balanceAsOf: "2026-06-01" }), ENV), "currentBalance")).toBe(
      "Enter the balance this date applies to, or clear the date.",
    );
    // a balance of 0 is a balance
    expect(parseLoan(loan({ currentBalance: "0", balanceAsOf: "2026-06-01" }), ENV).ok).toBe(true);
  });

  it("the as-of date: a real day, not in the future (against the injected today)", () => {
    expect(errorOf(parseLoan(loan({ currentBalance: "1", balanceAsOf: "2026-06-16" }), ENV), "balanceAsOf")).toBe("The date can't be in the future.");
    expect(parseLoan(loan({ currentBalance: "1", balanceAsOf: "2026-06-15" }), ENV).ok).toBe(true);
    expect(errorOf(parseLoan(loan({ currentBalance: "1", balanceAsOf: "2026-02-30" }), ENV), "balanceAsOf")).toBe("Enter a valid date.");
    // the same date is fine once today moves
    expect(parseLoan(loan({ currentBalance: "1", balanceAsOf: "2026-06-16" }), { year: 2026, today: "2026-06-16" }).ok).toBe(true);
  });

  it("lender 200, guarantee 1000, notes 2000", () => {
    expect(parseLoan(loan({ lender: "l".repeat(200), guaranteeNote: "g".repeat(1000), notes: "n".repeat(2000) }), ENV).ok).toBe(true);
    const long = parseLoan(loan({ lender: "l".repeat(201), guaranteeNote: "g".repeat(1001), notes: "n".repeat(2001) }), ENV);
    expect(errorOf(long, "lender")).toBe("Lender must be 200 characters or fewer.");
    expect(errorOf(long, "guaranteeNote")).toBe("Guarantee must be 1000 characters or fewer.");
    expect(errorOf(long, "notes")).toBe("Notes must be 2000 characters or fewer.");
  });

  it("status is open or paid_off (empty reads as open); anything else is refused", () => {
    expect(parseLoan(loan({ status: "paid_off" }), ENV)).toMatchObject({ ok: true, value: { status: "paid_off" } });
    expect(parseLoan(loan({ status: "" }), ENV)).toMatchObject({ ok: true, value: { status: "open" } });
    expect(errorOf(parseLoan(loan({ status: "closed" }), ENV), "status")).toBe("We couldn't save that. Nothing was changed.");
  });
});

describe("parsePaidOff", () => {
  it("needs a real date that is not in the future", () => {
    expect(parsePaidOff({ paidOffOn: "2026-06-15" }, ENV)).toEqual({ ok: true, value: { paidOffOn: "2026-06-15" } });
    expect(errorOf(parsePaidOff({ paidOffOn: "" }, ENV), "paidOffOn")).toBe("Enter the date.");
    expect(errorOf(parsePaidOff({ paidOffOn: "2026-06-16" }, ENV), "paidOffOn")).toBe("The date can't be in the future.");
    expect(errorOf(parsePaidOff({ paidOffOn: "2026-02-30" }, ENV), "paidOffOn")).toBe("Enter the date.");
  });
});

describe("the zod schemas are the parsers (one rule, two wrappers)", () => {
  it("each schema reports the same field messages the parser does", () => {
    const cases: Array<[string, ReturnType<typeof profileSchema> | ReturnType<typeof buildingSchema> | ReturnType<typeof appraisalSchema> | ReturnType<typeof insuranceSchema> | ReturnType<typeof loanSchema> | ReturnType<typeof retireSchema> | ReturnType<typeof paidOffSchema>, unknown, Record<string, string>]> = [
      ["profile", profileSchema(ENV), profile({ yearOrganized: "1500", city: "c".repeat(101) }), (parseProfile(profile({ yearOrganized: "1500", city: "c".repeat(101) }), ENV) as { errors: Record<string, string> }).errors],
      ["building", buildingSchema(ENV), building({ name: "", yearBuilt: "2027" }), (parseBuilding(building({ name: "", yearBuilt: "2027" }), ENV) as { errors: Record<string, string> }).errors],
      ["appraisal", appraisalSchema(ENV), appraisal({ amount: "0" }), (parseAppraisal(appraisal({ amount: "0" }), ENV) as { errors: Record<string, string> }).errors],
      ["insurance", insuranceSchema(ENV, "create"), insurance({ policyYear: "1800" }), (parseInsurance(insurance({ policyYear: "1800" }), ENV, "create") as { errors: Record<string, string> }).errors],
      ["loan", loanSchema(ENV), loan({ currentBalance: "5" }), (parseLoan(loan({ currentBalance: "5" }), ENV) as { errors: Record<string, string> }).errors],
      ["retire", retireSchema(ENV), { reason: "", retiredOn: "" }, (parseRetire({ reason: "", retiredOn: "" }, ENV) as { errors: Record<string, string> }).errors],
      ["paid off", paidOffSchema(ENV), { paidOffOn: "" }, (parsePaidOff({ paidOffOn: "" }, ENV) as { errors: Record<string, string> }).errors],
    ];
    for (const [name, schema, input, expected] of cases) {
      const result = (schema as { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }).safeParse(input);
      expect(result.success, name).toBe(false);
      const got: Record<string, string> = {};
      for (const issue of result.error!.issues) if (!(String(issue.path[0]) in got)) got[String(issue.path[0])] = issue.message;
      expect(got, name).toEqual(expected);
    }
    expect(profileSchema(ENV).safeParse(profile()).success).toBe(true);
    expect(buildingSchema(ENV).safeParse(building()).success).toBe(true);
  });
});
