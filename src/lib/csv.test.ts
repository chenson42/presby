import { describe, expect, it } from "vitest";
import { centsToDecimal, csvIntegerCell, csvTextCell, joinCsvLines } from "./csv";

describe("csvTextCell", () => {
  it("is empty for null, undefined and the empty string", () => {
    expect(csvTextCell(null)).toBe("");
    expect(csvTextCell(undefined)).toBe("");
    expect(csvTextCell("")).toBe("");
  });

  it("quotes a cell with a comma, a double quote, CR or LF, and doubles inner quotes", () => {
    expect(csvTextCell("a,b")).toBe('"a,b"');
    expect(csvTextCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvTextCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvTextCell("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  it("guards a formula lead (= + - @ TAB CR) with a single quote", () => {
    for (const lead of ["=", "+", "-", "@", "\t"]) {
      expect(csvTextCell(`${lead}SUM(A1)`)).toBe(`'${lead}SUM(A1)`);
    }
    expect(csvTextCell("=1,2")).toBe(`"'=1,2"`);
    expect(csvTextCell("\rX")).toBe(`"'\rX"`);
  });

  it("leaves an ordinary cell alone", () => {
    expect(csvTextCell("Property Committee")).toBe("Property Committee");
  });
});

describe("centsToDecimal", () => {
  it("renders integer cents as a bare decimal", () => {
    expect(centsToDecimal(1)).toBe("0.01");
    expect(centsToDecimal(1234)).toBe("12.34");
    expect(centsToDecimal(10_000_000)).toBe("100000.00");
    expect(centsToDecimal(-250)).toBe("-2.50");
    expect(centsToDecimal(null)).toBe("");
  });

  it("refuses a non-integer", () => {
    expect(() => centsToDecimal(1.5)).toThrow(RangeError);
  });
});

describe("joinCsvLines", () => {
  it("terminates every line, the last included, with CRLF", () => {
    expect(joinCsvLines(["a", "b"], ["1,2", "3,4"])).toBe("a,b\r\n1,2\r\n3,4\r\n");
    expect(joinCsvLines(["a"], [])).toBe("a\r\n");
  });
});

describe("csvIntegerCell", () => {
  it("writes a safe integer bare, negative and zero included (never text-guarded)", () => {
    expect(csvIntegerCell(0)).toBe("0");
    expect(csvIntegerCell(2025)).toBe("2025");
    expect(csvIntegerCell(-12)).toBe("-12");
    expect(csvIntegerCell(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it("is empty for null and undefined", () => {
    expect(csvIntegerCell(null)).toBe("");
    expect(csvIntegerCell(undefined)).toBe("");
  });

  it("throws on a float, NaN, Infinity, an unsafe integer and a string", () => {
    expect(() => csvIntegerCell(1.5)).toThrow(RangeError);
    expect(() => csvIntegerCell(Number.NaN)).toThrow(RangeError);
    expect(() => csvIntegerCell(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => csvIntegerCell(2 ** 53)).toThrow(RangeError);
    expect(() => csvIntegerCell("12" as unknown as number)).toThrow(RangeError);
  });
});
