import { HELP_CONTACT_LINE } from "./contact";

/**
 * Markdown may contain exactly one template token, `{{contact}}` (P3-5). It is replaced
 * before rendering and before every content check; any other `{{` fails H5.
 */
const CONTACT_TOKEN = "{{contact}}";

export function applyHelpTokens(markdown: string, contact: string = HELP_CONTACT_LINE): string {
  // split/join, not a RegExp replace: the replacement is inserted verbatim and never re-expanded.
  return markdown.split(CONTACT_TOKEN).join(contact);
}

/** Every `{{` that is not `{{contact}}`, with its 1-based line and the text from `{{`. */
export function unknownTemplateTokens(markdown: string): { line: number; snippet: string }[] {
  const out: { line: number; snippet: string }[] = [];
  markdown.split("\n").forEach((text, i) => {
    let from = 0;
    for (;;) {
      const at = text.indexOf("{{", from);
      if (at === -1) break;
      if (text.startsWith(CONTACT_TOKEN, at)) {
        from = at + CONTACT_TOKEN.length;
        continue;
      }
      const close = text.indexOf("}}", at);
      out.push({ line: i + 1, snippet: text.slice(at, close === -1 ? undefined : close + 2) });
      from = at + 2;
    }
  });
  return out;
}
