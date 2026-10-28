/**
 * The posting description validator - pure, no `server-only`, no database; the
 * editor runs it live in the browser and the server runs it again before it
 * stores anything (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Pure
 * helpers"; DECISION-266).
 *
 * THE RENDERER IS THE SPEC. A description is rendered by presby-site-kit's
 * `<Prose>` (`dist/markdown.js`): a deliberately tiny subset with no raw HTML,
 * headings (`#` to `######`), `-`/`*` and `1.` lists, `---` rules, `**bold**`,
 * `*italic*` and `[label](href)` links, and NO escape syntax. This validator is
 * strictly NARROWER than that renderer, on purpose:
 *
 *   - The page owns the one `h1` and levels 4-6 are unstyled, so a line that the
 *     renderer would make a heading of level 1 or 4+ is refused.
 *   - site-kit's `sanitizeHref` also lets `tel:`, relative and `#` links through;
 *     staff-authored public text may link only to `https:`, `http:` and a bare
 *     `mailto:` address, with no credentials and no query. A link to a bad
 *     address is refused BY NAME instead of rendering as the text "label (href)".
 *   - `https://` with no host is its own error, because the toolbar inserts it
 *     as a placeholder and an unfinished link must not be publishable.
 *
 * Every href this accepts is one the renderer turns into an `<a href>`
 * (`description.test.ts` renders them through `<Prose>` to pin it).
 *
 * The normalised output (NFC, CRLF to LF, control, bidi and zero-width
 * characters removed, leading blank lines and trailing space trimmed) is what is stored and what is re-validated, so
 * `validate(validate(x).value)` is its own result.
 */
import { DESCRIPTION_MAX } from "./contract";
import { charCount, normalizeMultiline } from "./text";

export type DescriptionErrorCode =
  | "heading_single"
  | "heading_level"
  | "link_scheme"
  | "link_unfinished"
  | "too_long"
  | "empty";

export interface DescriptionError {
  /** 1-based line in the (CRLF-normalised) text; 0 for an error about the text as a whole. */
  line: number;
  /** The offending line, or the link's label, shortened for display. */
  snippet: string;
  code: DescriptionErrorCode;
  /** Copy S6, ready to show. */
  message: string;
}

export type DescriptionResult =
  | { ok: true; value: string }
  | { ok: false; errors: DescriptionError[] };

const SNIPPET_MAX = 40;
const HREF_MAX = 2000;

/** site-kit's block-level heading pattern (`dist/markdown.js` HEADING_RE), byte for byte. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
/**
 * Every `[label](href)` the renderer might link, with the href loosened to "no
 * `)`" so an href containing a space (which the renderer leaves as plain text)
 * is still caught and named. The renderer's own pattern is
 * `\[([^\]]+)\]\(([^)\s]+)\)`.
 */
const LINK_CANDIDATE_RE = /\[([^\]]+)\]\(([^)]*)\)/g;
/** A bare mailto address: no query, no fragment, no display name. */
const MAILTO_ADDRESS_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export type HrefCheck = { ok: true } | { ok: false; code: "link_scheme" | "link_unfinished" };

/**
 * The link rule, shared by the validator and the paste converter. `href` is the
 * text between the parentheses, untrimmed: surrounding whitespace is part of
 * what the renderer would receive, so it fails.
 */
export function checkHref(href: string): HrefCheck {
  if (href === "" || /^https?:\/\/$/i.test(href)) return { ok: false, code: "link_unfinished" };
  if (href.length > HREF_MAX || /\s/.test(href)) return { ok: false, code: "link_scheme" };

  if (/^mailto:/i.test(href)) {
    return MAILTO_ADDRESS_RE.test(href.slice("mailto:".length))
      ? { ok: true }
      : { ok: false, code: "link_scheme" };
  }

  // Strictly "scheme://host": `https:host`, `https:///host` and `https:\\host`
  // are all read as absolute by a browser, and none is worth the doubt.
  if (!/^https?:\/\/[^/\\@?#]/i.test(href)) return { ok: false, code: "link_scheme" };
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { ok: false, code: "link_scheme" };
  }
  if (url.hostname === "" || url.username !== "" || url.password !== "") {
    return { ok: false, code: "link_scheme" };
  }
  return { ok: true };
}

function snippetOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(collapsed);
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX).join("")}…` : collapsed;
}

/** Line (1-based) of the character at `index` in `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Normalises and validates a description. `requireNonEmpty` is for publishing: a
 * draft may be saved with no description at all.
 */
export function validateDescription(
  raw: string,
  options: { requireNonEmpty: boolean },
): DescriptionResult {
  const normalized = normalizeMultiline(typeof raw === "string" ? raw : "");
  const errors: DescriptionError[] = [];

  const lines = normalized.split("\n");
  lines.forEach((text, index) => {
    const heading = HEADING_RE.exec(text);
    if (!heading) return;
    const level = heading[1]!.length;
    if (level === 1) {
      errors.push({
        line: index + 1,
        snippet: snippetOf(text),
        code: "heading_single",
        message: `Line ${index + 1} ("${snippetOf(text)}") starts with a single #. Use the Heading or Subheading button for section titles.`,
      });
    } else if (level >= 4) {
      errors.push({
        line: index + 1,
        snippet: snippetOf(text),
        code: "heading_level",
        message: `Line ${index + 1} ("${snippetOf(text)}") uses a heading level we don't support. Use ## or ###.`,
      });
    }
  });

  for (const match of normalized.matchAll(LINK_CANDIDATE_RE)) {
    const check = checkHref(match[2]!);
    if (check.ok) continue;
    const line = lineAt(normalized, match.index ?? 0);
    const label = snippetOf(match[1]!);
    errors.push({
      line,
      snippet: label,
      code: check.code,
      message:
        check.code === "link_unfinished"
          ? `Line ${line}: finish the web address for the link "${label}", or remove the link.`
          : `Line ${line}: the link "${label}" isn't a web address we can use. Links can start with https://, http:// or mailto:.`,
    });
  }

  // Leading blank LINES and trailing whitespace go; leading spaces on the first
  // real line stay, because "  # x" is a paragraph to the renderer and trimming
  // it would turn the validated text into a heading.
  const value = normalized.replace(/^(?:[ \t]*\n)+/, "").trimEnd();
  if (charCount(value) > DESCRIPTION_MAX) {
    errors.push({
      line: 0,
      snippet: "",
      code: "too_long",
      message: "The description is too long. The limit is 20,000 characters.",
    });
  }
  if (options.requireNonEmpty && value === "") {
    errors.push({
      line: 0,
      snippet: "",
      code: "empty",
      message: "Add a description before publishing.",
    });
  }

  errors.sort((a, b) => a.line - b.line);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
