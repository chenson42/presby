/**
 * Every string the contact feature adds that is not in a help page (Phase 3
 * "Copy"; the group letters A to L match that section). PURE: no imports, so the
 * client island may walk it (H19, DECISION-304).
 *
 * Sections are added by the batch that renders them: E (the notification email)
 * is here with the server half; A to C (the form) arrive with the island; D (the
 * inbox) with the inbox.
 *
 * Not here on purpose: the numbers the strings quote. The limits come from
 * `HELP_CONTACT_LIMITS` in contract.ts and the notification window is the
 * definer's constant (docs/work-log/2026-10-31-help-contact.md, Copy B and E,
 * "Source of truth").
 */

/**
 * E. The notification email (`help_contact_notification`). CONSTANT and
 * content-free: the typed name, address, congregation and message are not
 * parameters of anything that builds it (C5, C9), so there is no path by which
 * a stranger's text reaches an operator's mail.
 */
export const HELP_CONTACT_EMAIL_COPY = {
  subject: "New message on the PresbyPortal contact form",
  preheader: "Open the inbox to read it.",
  heading: "A new contact message",
  paragraph1:
    "Someone sent a message to the PresbyPortal team through the contact form. The message is not in this email.",
  paragraph2:
    "You get this email at most once an hour, however many messages arrive. Open the inbox to read them.",
  button: "Open contact messages",
  footnote: "You are receiving this because your account can work tickets and contact messages.",
} as const;

/** The in-app path the email button opens; the origin is added by `platformOrigin()`. */
export const HELP_CONTACT_INBOX_PATH = "/admin/messages";
