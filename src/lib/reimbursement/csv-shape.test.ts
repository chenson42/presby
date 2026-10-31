import { describe, expect, it } from "vitest";
import { CSV_HEADER, buildRequestsCsv, csvRow, exceedsCsvCap, type CsvRequestRow } from "./csv-shape";
import { CSV_MAX_ROWS } from "./limits";

const ROW: CsvRequestRow = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "paid",
  kind: "reimburse",
  submittedOn: "2026-10-02",
  expenseDate: "2026-09-30",
  groupName: "Property Committee",
  categoryName: "Supplies",
  payeeName: "Imogen Quillfeather",
  purpose: "Paint for the fellowship hall",
  amountCents: 4150,
  approvedOn: "2026-10-03",
  approvalPath: "seat",
  paidOn: "2026-10-05",
  paymentMethod: "check",
  paymentReference: "1042",
  creatorName: "Imogen Quillfeather",
  approverName: "Tobias Fernwick",
  payerName: "Marguerite Alderwick",
  selfPaid: false,
};

describe("the header is exactly this list (adding a column is a deliberate edit to this file and its test)", () => {
  it("is pinned", () => {
    expect([...CSV_HEADER]).toEqual([
      "request_id", "status", "kind", "submitted_on", "expense_date", "charged_to", "category", "payee", "purpose",
      "amount", "approved_on", "approval_path", "paid_on", "payment_method", "payment_reference",
      "requested_by", "approved_by", "paid_by", "self_paid",
    ]);
  });

  it("carries the purpose (a treasurer cannot reconcile without it) and none of the columns P3-16 excludes", () => {
    expect(CSV_HEADER).toContain("purpose");
    for (const banned of ["pre_approved", "pre_approver", "bank", "account", "routing", "email", "phone", "address", "receipt", "note"]) {
      expect(CSV_HEADER.some((h) => h.includes(banned)), banned).toBe(false);
    }
  });
});

describe("one row", () => {
  it("is in header order with a bare decimal amount", () => {
    expect(csvRow(ROW)).toBe(
      "11111111-1111-4111-8111-111111111111,paid,reimburse,2026-10-02,2026-09-30,Property Committee,Supplies,Imogen Quillfeather,Paint for the fellowship hall,41.50,2026-10-03,seat,2026-10-05,check,1042,Imogen Quillfeather,Tobias Fernwick,Marguerite Alderwick,false",
    );
    expect(csvRow(ROW).split(",").length).toBe(CSV_HEADER.length);
  });

  it("an unpaid request has empty payment cells and self_paid false", () => {
    const line = csvRow({ ...ROW, status: "approved", paidOn: null, paymentMethod: null, paymentReference: null, payerName: null });
    expect(line).toContain(",2026-10-03,seat,,,,Imogen Quillfeather,Tobias Fernwick,,false");
  });

  it("RFC 4180: a comma, a quote and a newline in free text are quoted and doubled", () => {
    const line = csvRow({ ...ROW, purpose: 'Tables, "round"\nand chairs' });
    expect(line).toContain('"Tables, ""round""\nand chairs"');
  });

  it("formula guard: free text that starts with = + - @ TAB or CR is prefixed with a quote (purpose, names, group, category, reference)", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      const line = csvRow({
        ...ROW,
        purpose: `${lead}HYPERLINK("x")`,
        payeeName: `${lead}cmd`,
        groupName: `${lead}group`,
        categoryName: `${lead}cat`,
        paymentReference: `${lead}1042`,
        creatorName: `${lead}c`,
        approverName: `${lead}a`,
        payerName: `${lead}p`,
      });
      expect(line, JSON.stringify(lead)).not.toMatch(/(^|,)[=+\-@]/);
      expect(line).toContain(`'${lead}cmd`.replace(/[\t\r]/g, (c) => c));
    }
  });

  it("an amount is never formula-guarded (it is a number) and a null amount is empty", () => {
    expect(csvRow({ ...ROW, amountCents: 100000000 })).toContain(",1000000.00,");
    expect(csvRow({ ...ROW, amountCents: null })).toContain("Paint for the fellowship hall,,2026-10-03");
  });
});

describe("the file", () => {
  it("is the header then one CRLF-terminated line per row, the last included", () => {
    const file = buildRequestsCsv([ROW, { ...ROW, id: "22222222-2222-4222-8222-222222222222" }]);
    expect(file.split("\r\n")).toHaveLength(4);
    expect(file.startsWith(`${CSV_HEADER.join(",")}\r\n`)).toBe(true);
    expect(file.endsWith("\r\n")).toBe(true);
  });

  it("no rows is the header alone", () => {
    expect(buildRequestsCsv([])).toBe(`${CSV_HEADER.join(",")}\r\n`);
  });
});

describe("the cap (P3-16: 413, never a truncated file)", () => {
  it("is 20,000: that many rows is a whole file, one more is too many", () => {
    expect(CSV_MAX_ROWS).toBe(20_000);
    expect(exceedsCsvCap(0)).toBe(false);
    expect(exceedsCsvCap(20_000)).toBe(false);
    expect(exceedsCsvCap(20_001)).toBe(true);
  });
});
