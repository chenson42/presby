/**
 * What `{{contact}}` becomes in every page (P3-5). Operator ruling 2026-10-26: until the
 * contact form (Increment 2) ships, a reader is told to ask whoever invited them.
 * Increment 2 changes this one constant.
 */
export const HELP_CONTACT_LINE = "Ask the person who invited you.";

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
