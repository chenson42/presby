// @vitest-environment jsdom
/**
 * The printed form's content (Copy C11, EC37, EC44): the C5 labels with values,
 * the requester's status line, receipt file names, the footer - and nothing from
 * payments, notes or history.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestBanner } from "@/app/(org)/o/[slug]/reimbursements/request-parts";
import { COPY } from "./copy";
import { memberDetailSchema, type MemberDetail } from "./detail-shape";
import { REQUEST_STATUSES } from "./states";
import { buildPrintModel, longDate, statusSentence } from "./print-model";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const BASE = {
  id: id(1),
  level: "member",
  status: "submitted",
  kind: "reimburse",
  origin: "app",
  revision: 2,
  amountCents: 412_550,
  currency: "usd",
  expenseDate: "2026-10-05",
  purpose: "Folding tables for the fellowship hall",
  preApprovedByName: "Cassius Orrin",
  noReceiptClaimed: false,
  createdAt: "2026-10-21T10:00:00+00:00",
  firstSubmittedAt: "2026-10-21T10:05:00+00:00",
  submittedAt: "2026-10-21T10:05:00+00:00",
  updatedAt: "2026-10-22T09:00:00+00:00",
  group: { id: id(2), name: "Property Committee" },
  category: { id: id(3), name: "Supplies", retired: false },
  payee: { kind: "person", name: "Tamsin Brightwater", personId: id(4) },
  enteredOnBehalf: false,
  receipts: [
    { id: id(5), displayName: "tables.pdf", contentType: "application/pdf", byteSize: 1234, createdAt: "2026-10-21T10:01:00+00:00" },
    { id: id(6), displayName: "receipt.jpg", contentType: "image/jpeg", byteSize: 99, createdAt: "2026-10-21T10:02:00+00:00" },
  ],
  receiptWaived: false,
  approvedOn: null,
  decidedOn: null,
  latestReason: null,
  route: "seat",
  paidOn: null,
  duplicateReceipt: null,
  viewer: { relation: "creator", canEdit: false, canWithdraw: true, canDecide: false },
  history: [{ kind: "created", toStatus: "draft", on: "2026-10-21", at: "2026-10-21T10:00:00+00:00" }],
};

function detail(over: Record<string, unknown> = {}): MemberDetail {
  return memberDetailSchema.parse({ ...BASE, ...over });
}

describe("the model", () => {
  it("is the C11 content: title, organization, the C5 labels with values, the status line, receipt names, the footer", () => {
    const model = buildPrintModel({ organizationName: "Alder Creek Church", detail: detail() });
    expect(model.title).toBe("Reimbursement request");
    expect(model.organization).toBe("Alder Creek Church");
    expect(model.statusLine).toBe("Waiting for approval.");
    expect(model.footer).toBe("Printed from PresbyPortal.");
    expect(model.fields).toEqual([
      { label: "Amount", lines: ["$4,125.50"] },
      { label: "Date of the expense", lines: ["October 5, 2026"] },
      { label: "Charged to", lines: ["Property Committee"] },
      { label: "Category", lines: ["Supplies"] },
      { label: "Pay to", lines: ["Tamsin Brightwater"] },
      { label: "Who approved it beforehand", lines: ["Cassius Orrin"] },
      { label: "What it was for", lines: ["Folding tables for the fellowship hall"] },
      { label: "Receipts", lines: ["tables.pdf", "receipt.jpg"] },
    ]);
  });

  it("leaves out a field the request does not have, and says so about receipts in the page's own words", () => {
    const model = buildPrintModel({
      organizationName: "Alder Creek Church",
      detail: detail({ category: null, preApprovedByName: null, receipts: [], receiptWaived: true, amountCents: null, expenseDate: null }),
    });
    expect(model.fields.map((f) => f.label)).toEqual(["Charged to", "Pay to", "What it was for", "Receipts"]);
    expect(model.fields.at(-1)!.lines).toEqual(["No receipt attached.", "Receipt waived."]);
  });

  it("carries no payment, history, note, approver or amount-in-title content (EC44)", () => {
    const withHistory = detail({
      status: "paid",
      paidOn: "2026-10-30",
      history: [
        { kind: "created", toStatus: "draft", on: "2026-10-21", at: "2026-10-21T10:00:00+00:00" },
        { kind: "payment_recorded", on: "2026-10-30", at: "2026-10-30T10:00:00+00:00", note: "Check 4471 mailed", actorName: "Octavia Vance" },
      ],
    });
    const model = buildPrintModel({ organizationName: "Alder Creek Church", detail: withHistory });
    const text = JSON.stringify(model);
    expect(text).not.toContain("Octavia");
    expect(text).not.toContain("4471");
    expect(text).not.toContain("History");
    expect(model.statusLine).toBe("Paid on October 30, 2026.");
    expect(model.documentTitle).toBe("Reimbursement request");
    expect(model.documentTitle).not.toMatch(/\d/);
  });

  it("is built only from the member projection: a treasury-level object's extra fields never appear", () => {
    const treasury = {
      ...detail(),
      level: "treasury",
      creatorName: "Hidden Creator",
      approval: { path: "seat", byName: "Hidden Approver", revision: 2, at: "2026-10-22T09:00:00+00:00" },
      payments: [{ id: id(9), kind: "payment", method: "check", reference: "SECRET-REF", amountCents: 1, byName: "Hidden Payer" }],
    } as unknown as MemberDetail;
    const text = JSON.stringify(buildPrintModel({ organizationName: "Alder Creek Church", detail: treasury }));
    for (const hidden of ["Hidden Creator", "Hidden Approver", "SECRET-REF", "Hidden Payer"]) expect(text).not.toContain(hidden);
  });

  it("cleans and clamps text: control, bidi and zero-width characters out, an absurd value cannot run on", () => {
    const evil = `Pa‮int\u0000 ​cans\n\nand more`;
    const model = buildPrintModel({
      organizationName: `Church\u0007 Name`,
      detail: detail({ purpose: evil, receipts: [{ ...BASE.receipts[0], displayName: "x".repeat(500) + ".pdf" }] }),
    });
    expect(model.organization).toBe("Church Name");
    expect(model.fields.find((f) => f.label === "What it was for")!.lines).toEqual(["Paint cans and more"]);
    const names = model.fields.at(-1)!.lines;
    expect(names).toHaveLength(1);
    expect(Array.from(names[0]!).length).toBeLessThanOrEqual(120);
    expect(names[0]!.endsWith("…")).toBe(true);
    // HTML is text: it is carried as typed and drawn as text by the renderer.
    const html = buildPrintModel({ organizationName: "A", detail: detail({ purpose: "<b>x</b> & <script>" }) });
    expect(html.fields.find((f) => f.label === "What it was for")!.lines).toEqual(["<b>x</b> & <script>"]);
  });
});

describe("longDate", () => {
  it("is a calendar date with no zone arithmetic", () => {
    expect(longDate("2026-10-05")).toBe("October 5, 2026");
    expect(longDate("2026-01-31")).toBe("January 31, 2026");
    expect(longDate("2026-12-01")).toBe("December 1, 2026");
    expect(longDate("not a date")).toBe("not a date");
    expect(longDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("the status line is the page's banner, in the requester's words", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, "");

  const cases: Array<[string, Record<string, unknown>]> = [
    ["draft", { status: "draft" }],
    ["submitted", { status: "submitted", route: "seat" }],
    ["submitted", { status: "submitted", route: "treasurer" }],
    ["submitted", { status: "submitted", route: "nobody" }],
    ["returned", { status: "returned", latestReason: "Wrong receipt" }],
    ["not_approved", { status: "not_approved", latestReason: "Out of budget" }],
    ["approved", { status: "approved", approvedOn: "2026-10-25" }],
    ["paid", { status: "paid", paidOn: "2026-10-26" }],
    ["withdrawn", { status: "withdrawn" }],
    ["voided", { status: "voided" }],
  ];

  it.each(cases)("%s: sentence for sentence what RequestBanner renders (with the date as the page's server render shows it)", (_status, over) => {
    const d = detail(over);
    const rendered = text(renderToStaticMarkup(<RequestBanner detail={d} audience="requester" />));
    // The page's SSR shows the ISO date until the client formats it; the PDF formats it. Compare with the identity formatter.
    expect(statusSentence(d, (ymd) => ymd)).toBe(rendered);
  });

  it("covers every status", () => {
    expect(new Set(cases.map(([s]) => s))).toEqual(new Set(REQUEST_STATUSES));
  });

  it("uses the requester's 'Sent back to you', even for a viewer who is an approver", () => {
    const d = detail({ status: "returned", latestReason: "Wrong receipt", viewer: { relation: "seat", canEdit: false, canWithdraw: false, canDecide: true } });
    expect(buildPrintModel({ organizationName: "A", detail: d }).statusLine).toBe(COPY.detail.banner.returned("Wrong receipt", "requester"));
  });
});
