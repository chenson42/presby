import { z } from "zod";
import { EMAIL_COPY } from "@/lib/contact-methods/copy";
import {
  EMAIL_MAX,
  EMAIL_SUBTYPE_LABELS,
  EMAIL_SUBTYPES,
  MAX_ACTIVE_EMAILS,
  isValidEmailShape,
  normalizeEmail,
} from "@/lib/contact-methods/normalize";
import { nextPrimaryAfterRemoval } from "@/lib/contact-methods/email-routing";
import type {
  ActiveEmailRow,
  EmailRowInput,
  EmailSubtype,
} from "@/lib/contact-methods/types";

/**
 * The form-side shape of the address list editor (DECISION-216, Batch 3) and
 * every pure rule the editor, the three forms that host it and the review step
 * share. Pure: no React, no server code.
 *
 * The server (`planEmailSave`, `store.ts`) is the authority on every rule here.
 * These mirror it so a person sees the field error before the round trip, and
 * the strings come from `EMAIL_COPY`, so a direct post gets the same text.
 */

/** `""` is the select's "No label" option; it maps to a null subtype on the wire. */
export type EmailRowSubtypeValue = "" | EmailSubtype;

export interface EmailRowValue {
  /** Present for an address already on file; absent for one typed in this session. */
  id?: string;
  /** The database's own text for the row's age. Only saved rows carry it. */
  createdAt?: string;
  value: string;
  subtype: EmailRowSubtypeValue;
  isPrimary: boolean;
  doNotContact: boolean;
}

/** The slice of any host form the editor reads and writes. */
export interface EmailsFormShape {
  contact: { emails: EmailRowValue[] };
}

export const emailRowValueSchema = z.object({
  id: z.string().optional(),
  createdAt: z.string().optional(),
  value: z.string(),
  subtype: z.enum(["", ...EMAIL_SUBTYPES]),
  isPrimary: z.boolean(),
  doNotContact: z.boolean(),
});

/**
 * The list's own validation, attached to the array so each host form gets it
 * by using `contactEmailsSchema`. Issues land on `[index, "value"]`:
 *   - a blank EXISTING row: "Enter an email address, or remove this row."
 *   - a blank new row is simply ignored (it is dropped on submit)
 *   - shape, length and a repeat of an address earlier in the list
 *   - more than 10 non-blank rows (the editor disables Add at 10, so this is
 *     only reachable by a script; it lands on the first row over the limit)
 */
export const contactEmailsSchema = z.array(emailRowValueSchema).superRefine((rows, ctx) => {
  const seen = new Set<string>();
  let nonBlank = 0;
  rows.forEach((row, index) => {
    const normalized = normalizeEmail(row.value);
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message, path: [index, "value"] });
    if (normalized === "") {
      if (row.id) issue(EMAIL_COPY.existingBlank);
      return;
    }
    nonBlank += 1;
    if (nonBlank > MAX_ACTIVE_EMAILS) return issue(EMAIL_COPY.tooMany);
    if (normalized.length > EMAIL_MAX) return issue(EMAIL_COPY.tooLong);
    if (!isValidEmailShape(normalized)) return issue(EMAIL_COPY.invalidShape);
    if (seen.has(normalized)) return issue(EMAIL_COPY.duplicate);
    seen.add(normalized);
  });
});

export function blankEmailRow(isPrimary: boolean): EmailRowValue {
  return { value: "", subtype: "", isPrimary, doNotContact: false };
}

/** The edit form's starting list: the saved rows, in the canonical order the page loaded them. */
export function emailRowsFromSaved(saved: readonly ActiveEmailRow[]): EmailRowValue[] {
  return saved.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    value: row.value,
    subtype: row.subtype ?? "",
    isPrimary: row.isPrimary,
    doNotContact: row.doNotContact,
  }));
}

function isBlank(row: EmailRowValue): boolean {
  return normalizeEmail(row.value) === "";
}

/**
 * The index of the row that IS the main address as the planner will see it
 * (`planEmailSave`): the flagged row; failing that (the main row was removed,
 * or the list was empty when the first address was added) the first remaining
 * SAVED row in the order the page loaded them, else the first typed row. -1
 * when the list has no row at all. A blank unsaved row counts only when nothing
 * else does (so a lone blank row shows as the main address).
 */
export function effectiveMainIndex(rows: readonly EmailRowValue[]): number {
  const counts = (row: EmailRowValue) => Boolean(row.id) || !isBlank(row);
  const flagged = rows.findIndex((row) => counts(row) && row.isPrimary);
  if (flagged >= 0) return flagged;
  const saved = rows.findIndex((row) => row.id);
  if (saved >= 0) return saved;
  const typed = rows.findIndex(counts);
  if (typed >= 0) return typed;
  // Nothing typed yet: the editor still shows its one blank row as the main
  // address (the flagged one, else the first), so the radio is never empty.
  const flaggedBlank = rows.findIndex((row) => row.isPrimary);
  return flaggedBlank >= 0 ? flaggedBlank : rows.length > 0 ? 0 : -1;
}

/**
 * The wire payload. Blank unsaved rows are dropped (the server drops them
 * too); everything else is sent exactly as it stands. NO main is invented
 * here: when the flagged row was removed the list goes up with no main and the
 * server promotes the oldest remaining one and says so ("Now the main
 * address"), which is what the Remove dialog told the administrator.
 */
export function toEmailRowInputs(
  rows: readonly EmailRowValue[],
  { withIds = true }: { withIds?: boolean } = {},
): EmailRowInput[] {
  return rows
    .filter((row) => (withIds && row.id) || !isBlank(row))
    .map((row) => ({
      ...(withIds && row.id ? { id: row.id } : {}),
      value: row.value,
      subtype: row.subtype === "" ? null : row.subtype,
      isPrimary: row.isPrimary,
      doNotContact: row.doNotContact,
    }));
}

/** New-person rows carry no ids. */
export function toNewPersonEmailInputs(
  rows: readonly EmailRowValue[],
): Omit<EmailRowInput, "id">[] | undefined {
  const inputs = toEmailRowInputs(rows, { withIds: false });
  return inputs.length > 0 ? inputs : undefined;
}

/** The ids the form loaded: the stale-form guard (`emails_changed`) compares them to the live set. */
export function knownEmailIds(saved: readonly ActiveEmailRow[]): string[] {
  return saved.map((row) => row.id);
}

/**
 * What the Remove dialog tells the administrator (Phase 3 Copy). `rows` is the
 * list as it stands; `index` is the row being removed. The successor is the
 * planner's own: the first remaining SAVED row in the loaded order
 * (`nextPrimaryAfterRemoval`), else the first typed row.
 */
export function describeRemoval(
  rows: readonly EmailRowValue[],
  index: number,
  saved: readonly ActiveEmailRow[],
  personName: string,
): { address: string; body: string } {
  const row = rows[index]!;
  const savedRow = saved.find((s) => s.id === row.id);
  const address = savedRow?.value ?? normalizeEmail(row.value);
  const others = rows.filter((other, i) => i !== index && (other.id || !isBlank(other)));
  const wasMain = effectiveMainIndex(rows) === index;

  let body = `${address} will stop being used and will no longer show on ${personName}'s record once you save. A record of the change is kept.`;
  if (others.length === 0) {
    body += ` It is the only address, so ${personName} will have no email address on file.`;
  } else if (wasMain) {
    const currentValue = new Map(rows.filter((r) => r.id).map((r) => [r.id!, r]));
    const keptSaved = saved.filter((s) => s.id !== row.id && currentValue.has(s.id));
    const next = nextPrimaryAfterRemoval(keptSaved, new Set<string>());
    const nextAddress = next
      ? normalizeEmail(currentValue.get(next.id)?.value ?? next.value)
      : normalizeEmail(others.find((other) => !other.id)!.value);
    body += ` It is the main address, so ${nextAddress} will become the main address.`;
  }
  return { address, body };
}

/** One review line: `address (Main, Work, Don't send)`; only labels that apply. */
export function reviewEmailLines(rows: readonly EmailRowValue[]): string[] {
  const main = effectiveMainIndex(rows);
  const lines: string[] = [];
  rows.forEach((row, index) => {
    if (isBlank(row)) return;
    const tags: string[] = [];
    if (index === main) tags.push("Main");
    if (row.subtype !== "") tags.push(EMAIL_SUBTYPE_LABELS[row.subtype]);
    if (row.doNotContact) tags.push("Don't send");
    const address = normalizeEmail(row.value);
    lines.push(tags.length > 0 ? `${address} (${tags.join(", ")})` : address);
  });
  return lines;
}
