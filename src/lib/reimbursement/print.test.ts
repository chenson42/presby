/**
 * The printed form's renderer (Copy C11). Text is read back out of the PDF with
 * the test-only extractor in src/lib/testing/pdf-text.ts, so each assertion is
 * about what a person opening the file would read.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { extractPdfPages, extractPdfText } from "@/lib/testing/pdf-text";
import { memberDetailSchema } from "./detail-shape";
import { buildPrintModel } from "./print-model";

vi.mock("server-only", () => ({}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const flat = (text: string) => text.replace(/\s+/g, " ");

function model(over: Record<string, unknown> = {}, organizationName = "Alder Creek Church") {
  const detail = memberDetailSchema.parse({
    id: id(1),
    level: "member",
    status: "approved",
    kind: "reimburse",
    origin: "app",
    revision: 3,
    amountCents: 4_250,
    currency: "usd",
    expenseDate: "2026-10-05",
    purpose: "Folding tables for the fellowship hall",
    preApprovedByName: null,
    noReceiptClaimed: false,
    createdAt: "2026-10-21T10:00:00+00:00",
    firstSubmittedAt: "2026-10-21T10:05:00+00:00",
    submittedAt: "2026-10-21T10:05:00+00:00",
    updatedAt: "2026-10-22T09:00:00+00:00",
    group: { id: id(2), name: "Property Committee" },
    category: { id: id(3), name: "Supplies", retired: false },
    payee: { kind: "person", name: "Tamsin Brightwater", personId: id(4) },
    enteredOnBehalf: false,
    receipts: [{ id: id(5), displayName: "tables.pdf", contentType: "application/pdf", byteSize: 1234, createdAt: "2026-10-21T10:01:00+00:00" }],
    receiptWaived: false,
    approvedOn: "2026-10-25",
    decidedOn: "2026-10-25",
    latestReason: null,
    route: null,
    paidOn: null,
    duplicateReceipt: null,
    viewer: { relation: "creator", canEdit: false, canWithdraw: true, canDecide: false },
    history: [{ kind: "created", toStatus: "draft", on: "2026-10-21", at: "2026-10-21T10:00:00+00:00" }],
    ...over,
  });
  return buildPrintModel({ organizationName, detail });
}

describe("renderRequestPdf", () => {
  it("is a PDF whose text is the C11 content: title, organization, labels with values, status line, receipt name, footer", async () => {
    const { renderRequestPdf } = await import("./print");
    const pdf = await renderRequestPdf(model());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = flat(extractPdfText(pdf));
    for (const expected of [
      "Reimbursement request",
      "Alder Creek Church",
      "Approved on October 25, 2026. Waiting for payment.",
      "Amount",
      "$42.50",
      "Date of the expense",
      "October 5, 2026",
      "Charged to",
      "Property Committee",
      "Category",
      "Supplies",
      "Pay to",
      "Tamsin Brightwater",
      "What it was for",
      "Folding tables for the fellowship hall",
      "Receipts",
      "tables.pdf",
      "Printed from PresbyPortal.",
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).not.toContain(String.fromCharCode(0xfffd));
    // No history section, no payment details, no names beyond the payee.
    expect(text).not.toContain("History");
    expect(text).not.toContain("Check number");
  });

  it("prints the same request to the same bytes (dates pinned, no clock)", async () => {
    const { renderRequestPdf } = await import("./print");
    const a = await renderRequestPdf(model());
    const b = await renderRequestPdf(model());
    expect(createHash("sha256").update(a).digest("hex")).toBe(createHash("sha256").update(b).digest("hex"));
  });

  it("an unbroken 500-character purpose and a 200-character organization wrap; the text is all there and the form stays short", async () => {
    const { renderRequestPdf } = await import("./print");
    const purpose = "Unbroken".repeat(62).slice(0, 500);
    const pdf = await renderRequestPdf(model({ purpose }, "Org".repeat(70)));
    const pages = extractPdfPages(pdf);
    expect(pages.length).toBeLessThanOrEqual(2);
    const text = pages.flat().join("").replace(/\s+/g, "");
    expect(text).toContain(purpose);
  });

  it("a script the font lacks draws without throwing, and Latin Extended and Vietnamese names print", async () => {
    const { renderRequestPdf } = await import("./print");
    const pdf = await renderRequestPdf(model({ payee: { kind: "vendor", name: "Nguyễn Łukasz مرحبا" } }));
    const text = flat(extractPdfText(pdf));
    expect(text).toContain("Nguyễn Łukasz");
  });

  it("many receipts and a long form flow onto a second page rather than being cut off", async () => {
    const { renderRequestPdf } = await import("./print");
    const receipts = Array.from({ length: 5 }, (_, i) => ({
      id: id(10 + i),
      displayName: `receipt-${i}.jpg`,
      contentType: "image/jpeg",
      byteSize: 10,
      createdAt: "2026-10-21T10:01:00+00:00",
    }));
    const pdf = await renderRequestPdf(model({ receipts, purpose: "word ".repeat(99).trim() }));
    const text = flat(extractPdfText(pdf));
    for (let i = 0; i < 5; i += 1) expect(text).toContain(`receipt-${i}.jpg`);
    expect(text).toContain("Printed from PresbyPortal.");
  });
});
