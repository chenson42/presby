/**
 * The code-generated words of a contribution statement - docs/work-log/
 * 2026-10-15-online-giving.md, R12 / DECISION-173 and Batch 5b.
 *
 * WHAT IS CODE AND WHAT IS EDITABLE. The IRS-facing block (what was received,
 * that nothing was given in return, how non-cash gifts are described) is
 * generated HERE, versioned, and never editable by a treasurer - the
 * westervillelions precedent: an editable template lets the required wording
 * be edited out. A congregation controls only the greeting, the closing and
 * the signatory (`giving_settings`), and the greeting has exactly one token.
 *
 * VERSIONING. `STATEMENT_WORDING_VERSION` (statement-policy.ts) is snapshotted
 * on each issued statement. `statementWording(version)` returns the text for
 * THAT version and throws for one this code does not know: a snapshot is never
 * quietly re-worded by a newer text, and never rendered with an older one
 * under a newer number. A change to any string below is a new version, never an
 * edit (the golden test in wording.test.ts fails on an in-place edit).
 *
 * OPERATOR Q6. This text is the thing the CPA review is for. Version 1 says "no
 * goods or services" and deliberately omits the "intangible religious
 * benefits" clause; whether to add it is the CPA's call (it would be version 2).
 *
 * INERT TEXT. Every dynamic value (a donor's name, an organization's name) is
 * substituted by PLAIN string handling - split/join, never `String.replace`
 * with a string replacement (a name containing `$&` would be interpreted) and
 * never a template engine. A name is data wherever it lands.
 *
 * Pure: no imports from the database, no `server-only`.
 */
import { GREETING_TOKEN } from "../settings-input";

export const DEFAULT_GREETING = `Dear ${GREETING_TOKEN},`;
export const DEFAULT_CLOSING = "With gratitude for your generosity,";

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

/** 'YYYY-MM-DD' -> 'January 5, 2028'. A calendar date has no zone, so no Date object is involved. */
export function formatLongDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError(`formatLongDate: not a YYYY-MM-DD date: ${isoDate}`);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) throw new RangeError(`formatLongDate: month out of range: ${isoDate}`);
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/** The greeting with the one token replaced by the donor's name - plain replacement, every occurrence. */
export function composeGreeting(greetingTemplate: string, donorName: string): string {
  return greetingTemplate.split(GREETING_TOKEN).join(donorName);
}

/** The words a statement is built from, for one wording version. */
export interface StatementWording {
  version: number;
  title(year: number): string;
  /** The corrected-version line: "Corrected statement, replaces statement dated <date>". */
  correctedTitle(replacesDate: string): string;
  issuedLine(issuedDate: string): string;
  intro(doneeName: string, year: number): string;
  tableHeaders: { date: string; fund: string; description: string; amount: string };
  nonCashAmount: string;
  refundNote(formattedAmount: string): string;
  totalCashLabel: string;
  nonCashSummary(count: number): string;
  /** The required acknowledgment block, in order. Never edited by a treasurer. */
  requiredBlock(input: { doneeName: string; ein: string | null; nonCash: boolean; coveredFee: boolean; coveredFeeCounted: boolean; corrected: boolean; replacesDate: string | null }): string[];
  einLabel: string;
}

const V1: StatementWording = {
  version: 1,
  title: (year) => `${year} Contribution Statement`,
  correctedTitle: (replacesDate) => `Corrected statement, replaces statement dated ${formatLongDate(replacesDate)}`,
  issuedLine: (issuedDate) => `Date issued: ${formatLongDate(issuedDate)}`,
  intro: (doneeName, year) =>
    `This statement lists the contributions received by ${doneeName} from January 1, ${year} through December 31, ${year}.`,
  tableHeaders: { date: "Date", fund: "Fund", description: "Description", amount: "Amount" },
  nonCashAmount: "Non-cash gift",
  refundNote: (formattedAmount) => `Net of ${formattedAmount} refunded or returned`,
  totalCashLabel: "Total cash contributions",
  nonCashSummary: (count) =>
    count === 1
      ? "1 non-cash gift is described above. Its value is not stated."
      : `${count} non-cash gifts are described above. Their value is not stated.`,
  einLabel: "Tax identification number (EIN)",
  requiredBlock: ({ doneeName, nonCash, coveredFee, coveredFeeCounted, corrected, replacesDate }) => {
    const blocks: string[] = [];
    if (corrected && replacesDate) {
      blocks.push(
        `This corrected statement replaces the statement dated ${formatLongDate(replacesDate)}. Please use this statement for your records.`,
      );
    }
    blocks.push(`${doneeName} acknowledges receipt of the contributions listed above.`);
    blocks.push("No goods or services were provided in exchange for these contributions.");
    if (nonCash) {
      blocks.push(
        "Non-cash gifts are described, not valued. The donor is responsible for determining the value of a non-cash gift.",
      );
    }
    if (coveredFee) {
      blocks.push(
        coveredFeeCounted
          ? "Where a donor chose to cover the processing fee on an online gift, the fee is included in the amount shown."
          : "Where a donor chose to cover the processing fee on an online gift, the fee is not included in the amount shown.",
      );
    }
    blocks.push("Please keep this statement with your tax records.");
    return blocks;
  },
};

const WORDING: Readonly<Record<number, StatementWording>> = { 1: V1 };

/** The wording for a version, or a thrown error for one this code does not know (see the header). */
export function statementWording(version: number): StatementWording {
  const wording = WORDING[version];
  if (!wording) throw new RangeError(`statementWording: unknown wording version ${version}`);
  return wording;
}
