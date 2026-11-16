import { describe, expect, it } from "vitest";
import { parseAllYears, parseBillingYear, parseTrendWindow, parseYear } from "./params";

const NOW = new Date("2026-11-15T12:00:00Z");

describe("parseYear / parseBillingYear (strict four-digit years, 1900 to 2100)", () => {
  it.each([
    ["2020", 2020],
    ["1900", 1900],
    ["2100", 2100],
  ])("accepts %s", (raw, year) => {
    expect(parseYear(raw)).toEqual({ ok: true, value: year });
    expect(parseBillingYear(raw, NOW)).toEqual({ ok: true, value: year });
  });

  it.each([["" ], ["2020.0"], ["1e3"], ["0x7e4"], [" 2020"], ["2020 "], ["-5"], ["1899"], ["2101"], ["20200"], ["abc"], ["+2020"]])(
    "rejects %j (a blank value is NOT 1900)",
    (raw) => {
      expect(parseYear(raw)).toEqual({ ok: false });
      expect(parseBillingYear(raw, NOW)).toEqual({ ok: false });
    },
  );

  it("rejects an array value (a repeated key)", () => {
    expect(parseYear(["2020", "2021"])).toEqual({ ok: false });
    expect(parseBillingYear(["2020"], NOW)).toEqual({ ok: false });
  });

  it("parseYear requires a value; parseBillingYear defaults to the UTC year", () => {
    expect(parseYear(undefined)).toEqual({ ok: false });
    expect(parseBillingYear(undefined, NOW)).toEqual({ ok: true, value: 2026 });
    expect(parseBillingYear(null, new Date("2026-12-31T23:59:59Z"))).toEqual({ ok: true, value: 2026 });
  });
});

describe("parseTrendWindow", () => {
  const w = (from: string | string[] | undefined, to: string | string[] | undefined) => parseTrendWindow(from, to, NOW);

  it("both absent: the last five years ending last year", () => {
    expect(w(undefined, undefined)).toEqual({ ok: true, value: { from: 2021, to: 2025 } });
  });

  it("only to: five years ending there; only from: five years starting there", () => {
    expect(w(undefined, "2020")).toEqual({ ok: true, value: { from: 2016, to: 2020 } });
    expect(w("2018", undefined)).toEqual({ ok: true, value: { from: 2018, to: 2022 } });
  });

  it("both: as given", () => {
    expect(w("2020", "2022")).toEqual({ ok: true, value: { from: 2020, to: 2022 } });
    expect(w("2020", "2020")).toEqual({ ok: true, value: { from: 2020, to: 2020 } });
  });

  it("from after to is invalid", () => {
    expect(w("2022", "2020")).toEqual({ ok: false });
  });

  it("a span of 10 years is valid and 11 is not", () => {
    expect(w("2010", "2019")).toEqual({ ok: true, value: { from: 2010, to: 2019 } });
    expect(w("2010", "2020")).toEqual({ ok: false });
  });

  it("a derived year outside 1900 to 2100 is invalid", () => {
    expect(w(undefined, "1902")).toEqual({ ok: false }); // from = 1898
    expect(w("2098", undefined)).toEqual({ ok: false }); // to = 2102
    expect(w(undefined, "1904")).toEqual({ ok: true, value: { from: 1900, to: 1904 } });
    expect(w("2096", undefined)).toEqual({ ok: true, value: { from: 2096, to: 2100 } });
  });

  it("a bad or repeated value is invalid, even beside a good one", () => {
    expect(w("", "2020")).toEqual({ ok: false });
    expect(w("2020", "x")).toEqual({ ok: false });
    expect(w(["2020", "2021"], undefined)).toEqual({ ok: false });
    expect(w("1e3", undefined)).toEqual({ ok: false });
  });
});

describe("parseAllYears", () => {
  it("is false when absent and true only for exactly '1'", () => {
    expect(parseAllYears(undefined)).toEqual({ ok: true, value: false });
    expect(parseAllYears("1")).toEqual({ ok: true, value: true });
    for (const raw of ["", "0", "true", "yes", "11", "1 ", ["1"], ["1", "1"]]) {
      expect(parseAllYears(raw as never)).toEqual({ ok: false });
    }
  });
});
