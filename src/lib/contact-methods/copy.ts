import type { EmailRefusal } from "./types";
import { EMAIL_MAX, MAX_ACTIVE_EMAILS } from "./normalize";

/**
 * The user-facing strings the server returns for an email save (Phase 3 Copy).
 * Pure, so the editor form and the server action use the SAME text: a direct
 * post gets exactly what the browser would have shown.
 */
export const EMAIL_COPY = {
  existingBlank: "Enter an email address, or remove this row.",
  invalidShape: "Enter a valid email address.",
  tooLong: `That email address is too long. Use ${EMAIL_MAX} characters or fewer.`,
  duplicate: "This address is already in the list.",
  tooMany: `A person can have up to ${MAX_ACTIVE_EMAILS} email addresses.`,
  multiplePrimary: "Choose one main address.",
  badSubtype: "Choose a label from the list.",
  emailsChanged:
    "This person's email addresses changed while you were editing. Reload the page to see the current list. Nothing was saved.",
  saveFailed: "We couldn't save. Nothing was changed. Try again.",
} as const;

/** The message for a refusal. A blank EXISTING row is reported as `invalid_shape` by the planner. */
export function emailRefusalMessage(refusal: EmailRefusal): string {
  switch (refusal.reason) {
    case "invalid_shape":
      return EMAIL_COPY.invalidShape;
    case "too_long":
      return EMAIL_COPY.tooLong;
    case "duplicate":
      return EMAIL_COPY.duplicate;
    case "too_many":
      return EMAIL_COPY.tooMany;
    case "multiple_primary":
      return EMAIL_COPY.multiplePrimary;
    case "bad_subtype":
      return EMAIL_COPY.badSubtype;
    case "emails_changed":
      return EMAIL_COPY.emailsChanged;
  }
}
