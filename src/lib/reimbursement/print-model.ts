import { formatMoney } from "./amount-input";
import { COPY } from "./copy";
import type { MemberDetail } from "./detail-shape";
import { MAX_LENGTH } from "./limits";
import { cleanText } from "./text";

/**
 * What the printed form says - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * Copy C11, EC37, EC44. PURE: no database, no `server-only`, no PDF library;
 * `print.ts` draws exactly this and nothing else.
 *
 * C11, verbatim: "`Reimbursement request` (title), `{org}`, the C5 labels with
 * values, the status line (C5 wording for the requester), receipt file names,
 * `Printed from PresbyPortal.` No payment details and no history names."
 *
 * THE INPUT IS THE MEMBER PROJECTION (`MemberDetail`), and only that type is
 * accepted: it carries no actor names, no payments, no notes and no duplicate
 * flag for the requester, so a treasury-level object cannot be handed in by
 * accident (the parameter type refuses it, and `print-model.test.ts` feeds a
 * treasury-level shape and asserts none of its extra fields appears). The route
 * asks the database for the member level even when the viewer holds treasury
 * keys, so the printed form is the same sheet for everyone who may see the
 * request, and a form handed to an approver does not tell the requester anything
 * the requester's own page would not.
 *
 * THE STATUS LINE is always the requester's wording ("Sent back to you"), as the
 * sheet is the requester's form; it mirrors `RequestBanner`
 * (`reimbursements/request-parts.tsx`) and `print-model.test.ts` renders that
 * component and compares the two sentence for sentence, so they cannot drift.
 *
 * TEXT IS INERT. Free text was cleaned when stored; it is cleaned again here
 * (`cleanText`: control, bidi and zero-width characters out, whitespace
 * collapsed) and clamped to the database's own length for the field, so a value
 * that somehow exceeds it cannot run the form onto a hundred pages. Nothing here
 * builds markup; the renderer draws strings.
 */

export interface PrintField {
  label: string;
  /** One entry per printed line-block; a paragraph is one entry (the renderer wraps it). */
  lines: string[];
}

export interface PrintModel {
  /** `Reimbursement request`. */
  title: string;
  /** The organization's name, as the gate resolved it. */
  organization: string;
  /** The C5 status sentence in the requester's words. */
  statusLine: string;
  fields: PrintField[];
  /** `Printed from PresbyPortal.` */
  footer: string;
  /** The PDF's own title, the amount-free `Reimbursement request`. */
  documentTitle: string;
  /** `YYYY-MM-DD`, pinned into the PDF so the same request prints the same bytes. */
  stampDate: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `2026-10-05` becomes `October 5, 2026`. No `toLocale*`: a calendar date has no zone to shift. */
export function longDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return ymd;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

const FILE_NAME_MAX = 120;
const ORG_NAME_MAX = 200;

function clamp(value: string | null | undefined, max: number): string {
  const cleaned = cleanText(value) ?? "";
  const chars = Array.from(cleaned);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : cleaned;
}

/** The C5 banner as a plain sentence, in the requester's words. Mirrors `RequestBanner`. */
export function statusSentence(detail: MemberDetail, formatDate: (ymd: string) => string = longDate): string {
  const reason = clamp(detail.latestReason, MAX_LENGTH.reason);
  const dated = (make: (date: string) => string, ymd: string | null) => make(ymd ? formatDate(ymd) : "");
  switch (detail.status) {
    case "draft":
      return COPY.detail.banner.draft;
    case "submitted":
      return COPY.detail.banner.submitted[detail.route ?? "seat"];
    case "returned":
      return COPY.detail.banner.returned(reason, "requester");
    case "not_approved":
      return COPY.detail.banner.notApproved(reason);
    case "approved":
      return dated(COPY.detail.banner.approved, detail.approvedOn);
    case "paid":
      return dated(COPY.detail.banner.paid, detail.paidOn);
    case "withdrawn":
      return COPY.detail.banner.withdrawn;
    case "voided":
      return COPY.detail.banner.voided;
  }
}

export function buildPrintModel(input: { organizationName: string; detail: MemberDetail }): PrintModel {
  const { detail } = input;
  const labels = COPY.detail.labels;
  const fields: PrintField[] = [];
  const add = (label: string, value: string | null | undefined, max: number) => {
    const text = clamp(value, max);
    if (text !== "") fields.push({ label, lines: [text] });
  };

  if (detail.amountCents !== null) add(labels.amount, formatMoney(detail.amountCents), 40);
  if (detail.expenseDate) add(labels.date, longDate(detail.expenseDate), 40);
  add(labels.chargedTo, detail.group?.name, MAX_LENGTH.displayName * 2);
  add(labels.category, detail.category?.name, MAX_LENGTH.category);
  add(labels.payTo, detail.payee.name, MAX_LENGTH.vendor);
  add(labels.preApprover, detail.preApprovedByName, MAX_LENGTH.preApprover);
  add(labels.purpose, detail.purpose, MAX_LENGTH.purpose);

  // Receipts: the file names the requester gave, or the C4/C5 sentences. Never a link, never bytes.
  const receiptLines = detail.receipts.map((r) => clamp(r.displayName, FILE_NAME_MAX)).filter((n) => n !== "");
  if (receiptLines.length === 0) receiptLines.push(COPY.receipts.none);
  if (detail.receiptWaived) receiptLines.push(COPY.detail.receiptWaived);
  fields.push({ label: labels.receipts, lines: receiptLines });

  return {
    title: COPY.print.title,
    organization: clamp(input.organizationName, ORG_NAME_MAX),
    statusLine: statusSentence(detail),
    fields,
    footer: COPY.print.footer,
    documentTitle: COPY.print.title,
    stampDate: /^\d{4}-\d{2}-\d{2}/.test(detail.updatedAt) ? detail.updatedAt.slice(0, 10) : "1970-01-01",
  };
}
