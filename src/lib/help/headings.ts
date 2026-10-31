import { scanMarkdown } from "./markdown-scan";
import { createSlugger } from "./slug";

/**
 * Heading extraction, shared by the renderer's ids and the on-this-page list so the two cannot
 * disagree. A heading's text is its plain text: emphasis, code ticks, links and images reduce to
 * what a reader sees.
 */
export function plainHeadingText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/\*+|~~/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

/** Every ATX heading outside fenced code, in order, with per-document de-duplicated ids. */
export function extractHeadings(markdown: string): Heading[] {
  const next = createSlugger();
  return scanMarkdown(markdown).headings.map((h) => {
    const text = plainHeadingText(h.text);
    return { level: h.level, text, id: next(text) };
  });
}
