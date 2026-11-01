import { HELP_CONTACT_ADMIN_LINE, HELP_CONTACT_LINE, privacyContactText } from "./contact";

/**
 * Markdown may contain exactly three template tokens, replaced before rendering and before
 * every content check; any other `{{` fails H5.
 *
 *   {{contact}}         the "who to ask" line: the inviter, or the contact form (P3-5, Increment 2)
 *   {{contactAdmin}}    the same, for a reader who is a signed-in administrator: the ticket route
 *                       first, the contact form if they cannot file one
 *   {{privacyContact}}  the privacy policy's contact sentence, built from the build-time
 *                       address (contact.ts, env.ts); a true fallback when there is none
 */
const CONTACT_TOKEN = "{{contact}}";
const PRIVACY_CONTACT_TOKEN = "{{privacyContact}}";
const CONTACT_ADMIN_TOKEN = "{{contactAdmin}}";
const KNOWN_TOKENS = [CONTACT_TOKEN, CONTACT_ADMIN_TOKEN, PRIVACY_CONTACT_TOKEN] as const;

export function applyHelpTokens(
  markdown: string,
  contact: string = HELP_CONTACT_LINE,
  privacyContact: string | null = null,
  contactAdmin: string = HELP_CONTACT_ADMIN_LINE,
): string {
  // One pass with a function replacer: the replacement is inserted verbatim (no `$&` handling)
  // and is never re-scanned, so a replacement that contains braces is not expanded again.
  return markdown.replace(/\{\{(contact|contactAdmin|privacyContact)\}\}/g, (_match, name: string) =>
    name === "contact" ? contact : name === "contactAdmin" ? contactAdmin : privacyContactText(privacyContact),
  );
}

/** Every `{{` that is not a known token, with its 1-based line and the text from `{{`. */
export function unknownTemplateTokens(markdown: string): { line: number; snippet: string }[] {
  const out: { line: number; snippet: string }[] = [];
  markdown.split("\n").forEach((text, i) => {
    let from = 0;
    for (;;) {
      const at = text.indexOf("{{", from);
      if (at === -1) break;
      const known = KNOWN_TOKENS.find((t) => text.startsWith(t, at));
      if (known) {
        from = at + known.length;
        continue;
      }
      const close = text.indexOf("}}", at);
      out.push({ line: i + 1, snippet: text.slice(at, close === -1 ? undefined : close + 2) });
      from = at + 2;
    }
  });
  return out;
}
