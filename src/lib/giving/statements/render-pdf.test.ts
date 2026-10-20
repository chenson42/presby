/**
 * The statement renderer (DECISION-174, Batch 5b). Text is read back out of the
 * PDF with the test-only extractor in src/lib/testing/pdf-text.ts, so each
 * assertion is about what a person opening the file would read.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { extractPdfPages, extractPdfText } from "@/lib/testing/pdf-text";
import { sampleLine, sampleSnapshot } from "./fixtures";

vi.mock("server-only", () => ({}));

const flat = (text: string) => text.replace(/\s+/g, " ");

describe("renderStatementPdf", () => {
  it("produces a PDF whose text carries the donee, EIN, address, donor, lines, totals and the required block", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const pdf = await renderStatementPdf([sampleSnapshot()]);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = flat(extractPdfText(pdf));
    expect(text).toContain("Fixture Presbyterian Church");
    expect(text).toContain("Tax identification number (EIN): 00-0000000");
    expect(text).toContain("1 Fixture Way");
    expect(text).toContain("Fixtureville, OH 00000");
    expect(text).toContain("2027 Contribution Statement");
    expect(text).toContain("Date issued: January 15, 2028");
    expect(text).toContain("Linden Marsh");
    expect(text).toContain("Dear Linden Marsh,");
    expect(text).toContain("03/07/2027");
    expect(text).toContain("Check #1042");
    expect(text).toContain("$250.00");
    expect(text).toContain("$101.81");
    expect(text).toContain("Total cash contributions");
    expect(text).toContain("$351.81");
    expect(text).toContain("No goods or services were provided in exchange for these contributions.");
    expect(text).toContain("Tess Treasurer");
    expect(text).not.toContain(String.fromCharCode(0xfffd));
  });

  it("omits the EIN line when the congregation has none", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const base = sampleSnapshot();
    const pdf = await renderStatementPdf([sampleSnapshot({ donee: { ...base.donee, ein: null } })]);
    expect(extractPdfText(pdf)).not.toContain("EIN");
  });

  it("prints a stock gift as a described non-cash line with no value, and says so", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const lines = [
      sampleLine(),
      sampleLine({
        lineNo: 2,
        giftId: "00000000-0000-4000-8000-000000000002",
        occurredOn: "2027-09-01",
        description: "Stock: 10 shares of Example Corp",
        kind: "non_cash",
        amountCents: null,
        grossCents: 99900,
      }),
    ];
    const pdf = await renderStatementPdf([sampleSnapshot({ lines })]);
    const text = flat(extractPdfText(pdf));
    expect(text).toContain("Stock: 10 shares of Example Corp");
    expect(text).toContain("Non-cash gift");
    expect(text).toContain("1 non-cash gift is described above. Its value is not stated.");
    expect(text).not.toContain("999.00");
    expect(text).toContain("$250.00");
  });

  it("titles a corrected version 'Corrected statement, replaces statement dated <date>'", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const pdf = await renderStatementPdf([sampleSnapshot({ version: 2, replacesDate: "2028-01-15", issuedDate: "2028-02-09" })]);
    const text = flat(extractPdfText(pdf));
    expect(text).toContain("Corrected statement, replaces statement dated January 15, 2028");
    expect(text).toContain("Date issued: February 9, 2028");
  });

  it("is byte-stable: the same snapshot renders to the same bytes, and a pinned date means no clock leaks in", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const a = await renderStatementPdf([sampleSnapshot()]);
    await new Promise((r) => setTimeout(r, 1100));
    const b = await renderStatementPdf([sampleSnapshot()]);
    expect(createHash("sha256").update(a).digest("hex")).toBe(createHash("sha256").update(b).digest("hex"));
    expect(a.toString("latin1")).toContain("D:20280115000000Z");
  });

  it("a snapshot inside a batch prints the same text on its pages as it does alone", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const first = sampleSnapshot();
    const second = sampleSnapshot({ donorName: "Hallie Vandermeer", lines: [sampleLine({ amountCents: 20000, grossCents: 20000 })] });
    const third = sampleSnapshot({ donorName: "Odette Brask", delivery: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null, email: null } });
    const batch = extractPdfPages(await renderStatementPdf([first, second, third]));
    const alone = [first, second, third].map(async (s) => extractPdfPages(await renderStatementPdf([s])));
    const singles = (await Promise.all(alone)).flat();
    expect(batch.length).toBe(3);
    expect(batch).toEqual(singles);
  });

  it("continues a long statement onto more pages with a continuation header, the next statement starting fresh", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const lines = Array.from({ length: 70 }, (_, i) =>
      sampleLine({ lineNo: i + 1, giftId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, occurredOn: `2027-${String((i % 12) + 1).padStart(2, "0")}-15`, amountCents: 1000 + i, grossCents: 1000 + i }),
    );
    const long = sampleSnapshot({ lines });
    const pages = extractPdfPages(await renderStatementPdf([long, sampleSnapshot({ donorName: "Next Donor" })]));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(flat(pages[1]!.join(" "))).toContain("(continued)");
    expect(flat(pages[pages.length - 1]!.join(" "))).toContain("Dear Next Donor,");
    expect(flat(pages.slice(0, -1).flat().join(" "))).toContain("Total cash contributions");
  });

  it("draws hostile names as inert text: braces, markup, dollar patterns, control characters, a huge name, RTL", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const hostile = ["{{x}}", "<script>alert(1)</script>", "$& $1 $` $'", `Nul${String.fromCharCode(0)}l${String.fromCharCode(0x202e)}bidi`, "A".repeat(10_000), "שלום مرحبا"];
    for (const name of hostile) {
      const pdf = await renderStatementPdf([sampleSnapshot({ donorName: name })]);
      const pages = extractPdfPages(pdf);
      expect(pages.length).toBeLessThanOrEqual(2);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
    const braces = flat(extractPdfText(await renderStatementPdf([sampleSnapshot({ donorName: "{{x}}" })])));
    expect(braces).toContain("Dear {{x}},");
    const dollars = flat(extractPdfText(await renderStatementPdf([sampleSnapshot({ donorName: "$& $1 $` $'" })])));
    expect(dollars).toContain("Dear $& $1 $` $',");
    const markup = flat(extractPdfText(await renderStatementPdf([sampleSnapshot({ donorName: "<script>alert(1)</script>" })])));
    expect(markup).toContain("<script>alert(1)</script>");
  });

  it("renders Latin Extended and Vietnamese names with the embedded font (no missing-glyph boxes)", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    for (const name of ["Nguyễn Thị Hương", "Zażółć Gęślą", "İstanbul Çelik", "Ωμέγα Дмитрий"]) {
      const text = extractPdfText(await renderStatementPdf([sampleSnapshot({ donorName: name })]));
      // A stacked mark (the dot below Vietnamese "ị") is a separate glyph with no ToUnicode entry, so it is
      // drawn but does not extract; compare the letters, and look at the sample PDF for the marks.
      const letters = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "");
      expect(letters(flat(text))).toContain(letters(`Dear ${name},`));
      expect(text).not.toContain(String.fromCharCode(0xfffd));
    }
  });

  it("refuses an unknown wording version rather than re-wording a snapshot", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    await expect(renderStatementPdf([sampleSnapshot({ wordingVersion: 99 })])).rejects.toThrow(/unknown wording version/);
  });

  it("refuses an empty batch", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    await expect(renderStatementPdf([])).rejects.toThrow(/no statements/);
  });

  it.skipIf(!process.env.STATEMENT_SAMPLE_DIR)("writes sample PDFs for a human to read (STATEMENT_SAMPLE_DIR)", async () => {
    const { renderStatementPdf } = await import("./render-pdf");
    const dir = process.env.STATEMENT_SAMPLE_DIR!;
    writeFileSync(`${dir}/single.pdf`, await renderStatementPdf([sampleSnapshot()]));
    writeFileSync(`${dir}/corrected.pdf`, await renderStatementPdf([sampleSnapshot({ version: 2, replacesDate: "2028-01-15", issuedDate: "2028-02-09", lines: [sampleLine({ description: "Stock: 10 shares of Example Corp", kind: "non_cash", amountCents: null }), sampleLine({ lineNo: 2, giftId: "00000000-0000-4000-8000-0000000000aa", reversedCents: 5000, amountCents: 20000 })] })]));
  });
});
