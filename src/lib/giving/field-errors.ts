/**
 * Turning a zod failure into `{ "donor.displayName": "message" }` - the shape
 * the giving server actions return as `fieldErrors` and the forms render
 * inline. PURE, shared by every giving validator.
 */
import type { ZodError } from "zod";

export type FieldErrors = Record<string, string>;

/** First message per dotted path; a root-level issue is keyed `_form`. */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? "_form" : issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** A real calendar date typed as YYYY-MM-DD (rejects 2026-02-30). */
export function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Control characters (other than ordinary space) never belong in a name or a memo. */
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
