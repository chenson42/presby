import { HELP_CONTACT_HREF, helpHref } from "./urls";

/**
 * What `{{contact}}` becomes in a help page (P3-5; Increment 2, DECISION-300): ask whoever invited
 * you, or write to the team through the contact form. The inviter stays first because, for a
 * member, their own administrator is the right and faster answer. It promises no reply and no time.
 *
 * Used where the reader may have no administrator role (a treasurer or office worker, someone who
 * cannot sign in). The readers who are administrators get {{contactAdmin}} below.
 */
export const HELP_CONTACT_LINE = `Ask the person who invited you, or [send the PresbyPortal team a message](${HELP_CONTACT_HREF}).`;

/**
 * What `{{contactAdmin}}` becomes: for a reader who is a signed-in administrator. A founding
 * administrator's inviter is the PresbyPortal team itself, so "ask the person who invited you" would
 * be circular; a ticket has a verified identity and a reply thread. "If you cannot file one" admits an
 * administrator who does not hold the role, and keeps the form as the way out.
 */
export const HELP_CONTACT_ADMIN_LINE = `File a ticket: open Administration, then Tickets (see [Getting help](${helpHref("getting-help")}) for the steps). If you cannot file one, [send the PresbyPortal team a message](${HELP_CONTACT_HREF}).`;

/**
 * The public repository: the one place a reader with no other route is pointed (the contact form's
 * exit block and the privacy fallback below). Must stay in EXTERNAL_LINK_ALLOWLIST (links.ts);
 * contact.test.ts pins it.
 */
export const HELP_REPOSITORY_URL = "https://github.com/chenson42/presby";

/**
 * What `{{privacyContact}}` becomes in the privacy policy (operator ruling 2026-10-28). The
 * address comes from the build environment (env.ts), never from the repository.
 *
 * Unset (local, CI, previews): a sentence that is true without an address. The home page names
 * the public repository as the place to open an issue, so that is the only channel this can
 * promise; it says plainly that issues there are public.
 */
export const HELP_PRIVACY_CONTACT_FALLBACK =
  `Open an issue on the [PresbyPortal repository](${HELP_REPOSITORY_URL}). Issues there are public, so leave personal details out.`;

/** `email` must already have passed readPrivacyContactEmail (one plain address, safe in a link). */
export function privacyContactText(email: string | null): string {
  if (email === null) return HELP_PRIVACY_CONTACT_FALLBACK;
  // `_` is the one address character that can mean emphasis in link text.
  return `Email us at [${email.replace(/_/g, "\\_")}](mailto:${email}).`;
}
