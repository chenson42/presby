/**
 * The gifts CSV writer (docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "CSV export", G25). Pure: pinned to the byte.
 */
import { describe, expect, it } from "vitest";
import {
  CSV_HEADER,
  CSV_MAX_ROWS,
  buildGiftsCsv,
  centsToDecimal,
  csvRow,
  csvTextCell,
  exceedsCsvCap,
  type CsvGiftRow,
} from "./csv";

const BASE: CsvGiftRow = {
  giftId: "11111111-1111-4111-8111-111111111111",
  occurredOn: "2026-03-14",
  donorId: "22222222-2222-4222-8222-222222222222",
  donorName: "Imogen Thackeray",
  fundName: "General Fund",
  source: "offline",
  method: "check",
  status: "succeeded",
  amountCents: 12_550,
  donorCoveredFeeCents: 0,
  feeCents: null,
  netCents: null,
  reversedCents: 0,
  checkNumber: "1042",
};

describe("CSV_HEADER", () => {
  it("is exactly the contracted columns, in order", () => {
    expect(CSV_HEADER.join(",")).toBe(
      "gift_id,date,donor_id,donor_name,fund,source,method,status,amount,donor_covered_fee,stripe_fee,net,reversed,check_number",
    );
  });

  it("has no email, address or memo column (a deliberate edit to add one)", () => {
    for (const column of CSV_HEADER) {
      expect(column).not.toMatch(/email|address|memo|phone|street|city|zip/i);
    }
  });
});

describe("centsToDecimal", () => {
  it("formats integer cents as a bare decimal", () => {
    expect(centsToDecimal(0)).toBe("0.00");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(100)).toBe("1.00");
    expect(centsToDecimal(12_550)).toBe("125.50");
    expect(centsToDecimal(100_000_000)).toBe("1000000.00");
  });

  it("has no currency symbol or grouping (a spreadsheet must parse it as a number)", () => {
    expect(centsToDecimal(123_456_789)).toBe("1234567.89");
    expect(centsToDecimal(1)).not.toMatch(/[$,]/);
  });

  it("renders null/undefined as an empty cell, and a negative with its sign", () => {
    expect(centsToDecimal(null)).toBe("");
    expect(centsToDecimal(undefined)).toBe("");
    expect(centsToDecimal(-5)).toBe("-0.05");
  });

  it("refuses a non-integer", () => {
    expect(() => centsToDecimal(1.5)).toThrow(RangeError);
  });
});

describe("csvTextCell: RFC 4180 quoting", () => {
  it("leaves a plain value bare", () => {
    expect(csvTextCell("General Fund")).toBe("General Fund");
  });

  it("quotes a value with a comma, doubling an inner quote", () => {
    expect(csvTextCell("Smith, Jr.")).toBe('"Smith, Jr."');
    expect(csvTextCell('The "Building" Fund')).toBe('"The ""Building"" Fund"');
  });

  it("quotes a value with a CR or LF", () => {
    expect(csvTextCell("a\nb")).toBe('"a\nb"');
    expect(csvTextCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("renders null, undefined and the empty string as an empty cell", () => {
    expect(csvTextCell(null)).toBe("");
    expect(csvTextCell(undefined)).toBe("");
    expect(csvTextCell("")).toBe("");
  });
});

describe("csvTextCell: formula injection", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tTabbed", "\rReturned"])(
    "prefixes %j with a single quote",
    (value) => {
      expect(csvTextCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("prefixes first, then quotes", () => {
    expect(csvTextCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });

  it("does not touch a value that merely contains a trigger character later", () => {
    expect(csvTextCell("a=b")).toBe("a=b");
    expect(csvTextCell("Fund - Missions")).toBe("Fund - Missions");
  });

  it("is applied to a donor named with a leading minus", () => {
    const row = csvRow({ ...BASE, donorName: "-Rowan" });
    expect(row.split(",")[3]).toBe("'-Rowan");
  });
});

describe("csvRow / buildGiftsCsv", () => {
  it("writes the 14 columns in header order", () => {
    expect(csvRow(BASE)).toBe(
      [
        BASE.giftId,
        "2026-03-14",
        BASE.donorId,
        "Imogen Thackeray",
        "General Fund",
        "offline",
        "check",
        "succeeded",
        "125.50",
        "0.00",
        "",
        "",
        "0.00",
        "1042",
      ].join(","),
    );
    expect(csvRow(BASE).split(",")).toHaveLength(CSV_HEADER.length);
  });

  it("writes an online row's fee and net", () => {
    const row = csvRow({
      ...BASE,
      source: "online",
      method: "card",
      checkNumber: null,
      amountCents: 5_181,
      donorCoveredFeeCents: 181,
      feeCents: 181,
      netCents: 5_000,
    }).split(",");
    expect(row.slice(8, 13)).toEqual(["51.81", "1.81", "1.81", "50.00", "0.00"]);
    expect(row[13]).toBe("");
  });

  it("starts with the header, uses CRLF, and ends with a trailing CRLF", () => {
    const csv = buildGiftsCsv([BASE, { ...BASE, giftId: "33333333-3333-4333-8333-333333333333" }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(lines).toHaveLength(4); // header + 2 rows + the empty tail after the final CRLF
    expect(lines[3]).toBe("");
    expect(csv).not.toMatch(/(?<!\r)\n/); // no bare LF line breaks outside quoted cells
  });

  it("is just a header for no rows", () => {
    expect(buildGiftsCsv([])).toBe(`${CSV_HEADER.join(",")}\r\n`);
  });

  it("never emits an email or address from a row (the row type carries none)", () => {
    const csv = buildGiftsCsv([BASE]);
    expect(csv).not.toMatch(/@|example\.invalid/);
  });
});

describe("the row cap", () => {
  it("is 50,000, and 'exceeds' means strictly more", () => {
    expect(CSV_MAX_ROWS).toBe(50_000);
    expect(exceedsCsvCap(50_000)).toBe(false);
    expect(exceedsCsvCap(50_001)).toBe(true);
    expect(exceedsCsvCap(0)).toBe(false);
  });
});
