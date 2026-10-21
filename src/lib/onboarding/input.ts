/**
 * Server-side input boundaries for the invitation surfaces (G17,
 * docs/work-log/2026-10-21-invitations.md). PURE: no database, no
 * `server-only`. Both `issue.ts` (platform operator input) and `accept.ts`
 * (anonymous invitee input) validate through here BEFORE a database call.
 *
 * What the database also checks (and this mirrors, never replaces): the
 * `account_invitations_email_shape` and `account_invitations_names_shape`
 * CHECKs, and the bcrypt-shape and non-blank-name raises inside
 * `presby_accept_invitation`.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EMAIL_MAX = 320;
export const NAME_MIN = 1;
export const NAME_MAX = 100;
export const PASSWORD_MIN = 8;
/** bcrypt silently truncates beyond 72 BYTES. Counted as UTF-8, not characters. */
export const PASSWORD_MAX_BYTES = 72;

/** Trim and lowercase; null unless it has the stored address shape. */
export function normalizeInvitationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX) return null;
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  return email;
}

/**
 * A person's name as stored: NFC, control characters removed, trimmed,
 * 1-100 characters. Null when it does not fit.
 */
export function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null;
  return name;
}

export type PasswordProblem = "too_short" | "too_long";

/** null when acceptable. Length in characters (min) and UTF-8 bytes (max). */
export function passwordProblem(value: unknown): PasswordProblem | null {
  if (typeof value !== "string") return "too_short";
  if ([...value].length < PASSWORD_MIN) return "too_short";
  if (Buffer.byteLength(value, "utf8") > PASSWORD_MAX_BYTES) return "too_long";
  return null;
}
