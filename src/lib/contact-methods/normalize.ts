import type { EmailSubtype } from "./types";

/**
 * Pure email-address rules (ER16, ER18). No `server-only`, no runtime imports:
 * a client form and the server action share these constants and the shape test.
 */

export const EMAIL_MAX = 254;

/** The most active addresses one person may hold (D4 / Copy: "up to 10"). */
export const MAX_ACTIVE_EMAILS = 10;

export const EMAIL_SUBTYPES = ["personal", "work", "other"] as const satisfies readonly EmailSubtype[];

/** Phone keeps its own vocabulary (ER18). */
export const PHONE_SUBTYPES = ["mobile", "home", "work"] as const;

export const EMAIL_SUBTYPE_LABELS: Record<EmailSubtype, string> = {
  personal: "Personal",
  work: "Work",
  other: "Other",
};

/** Trim and lowercase: the stored form (the CHECK `contact_methods_value_shape` requires it). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Mirrors the SQL CHECK: exactly one `@`, a dot in the domain part, no
 * whitespace and no comma, at most 254 characters. JavaScript's `\s` is a
 * superset of the POSIX `[:space:]` the CHECK uses, so anything this accepts
 * the CHECK accepts (the safe direction); a DB test pins that one-way relation.
 * Expects an already-normalized value.
 */
const EMAIL_SHAPE = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

export function isValidEmailShape(value: string): boolean {
  return value.length <= EMAIL_MAX && EMAIL_SHAPE.test(value);
}

export function isEmailSubtype(value: unknown): value is EmailSubtype {
  return typeof value === "string" && (EMAIL_SUBTYPES as readonly string[]).includes(value);
}
