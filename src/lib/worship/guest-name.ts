import { LIMITS } from "./vocab";

/**
 * A guest's name - docs/work-log/2026-11-04-worship-inc1.md, Phase 3 module
 * layout (`guest-name.ts`); operator Q11. PURE.
 *
 * A guest (a visiting preacher, a hired organist who is not on record) is a
 * free-text NAME on a position and nothing else: no contact column exists. The
 * validator refuses text that looks like contact details so the name field
 * cannot become one. The database CHECK (`worship_assignments_guest_name_shape`)
 * is the backstop for length, trimming and control characters; the contact
 * rule is this file's alone.
 *
 * Refused: empty after trimming; more than 80 characters; any control
 * character (a line break included); an `@`; seven or more digits anywhere in
 * the text (a phone number may be written with spaces or punctuation, so
 * digits are counted, not runs).
 */

export const GUEST_NAME_CONTACT_MESSAGE = "Enter just a name. Contact details aren't kept here.";
export const GUEST_NAME_REQUIRED_MESSAGE = "Enter a name.";
export const GUEST_NAME_TOO_LONG_MESSAGE = `Names can be up to ${LIMITS.guestName} characters.`;

export type GuestNameResult =
  | { ok: true; name: string }
  | { ok: false; message: string };

export function validateGuestName(raw: unknown): GuestNameResult {
  if (typeof raw !== "string") return { ok: false, message: GUEST_NAME_REQUIRED_MESSAGE };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, message: GUEST_NAME_REQUIRED_MESSAGE };
  if ([...name].length > LIMITS.guestName) return { ok: false, message: GUEST_NAME_TOO_LONG_MESSAGE };
  if (/\p{Cc}/u.test(name)) return { ok: false, message: GUEST_NAME_CONTACT_MESSAGE };
  if (name.includes("@")) return { ok: false, message: GUEST_NAME_CONTACT_MESSAGE };
  const digits = name.match(/\d/g)?.length ?? 0;
  if (digits >= 7) return { ok: false, message: GUEST_NAME_CONTACT_MESSAGE };
  return { ok: true, name };
}
