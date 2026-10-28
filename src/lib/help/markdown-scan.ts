/**
 * A small hand-written scanner for the markdown SUBSET help content is restricted to (P3-4):
 * ATX headings, inline links and images, fenced and inline code, GFM tables of those. It reads
 * headings, links and images, and flags everything outside the subset (raw HTML, reference
 * links, autolinks, bare URLs, entities, setext headings). `unified`, `mdast-util-*` and
 * `unist-util-visit` are transitive, and promoting one to a direct import was refused in Phase 2.
 *
 * Pure: no I/O. Every offset is preserved while masking, so `prose` has the input's length.
 */

export interface MdHeading { level: number; text: string; line: number }
export interface MdLink { text: string; destination: string; line: number }
export interface MdImage { alt: string; source: string; line: number }
export interface MdFinding { line: number; snippet: string }

export interface MarkdownScan {
  headings: MdHeading[];
  links: MdLink[];
  images: MdImage[];
  rawHtml: MdFinding[];
  autolinks: MdFinding[];
  referenceLinks: MdFinding[];
  bareUrls: MdFinding[];
  entities: MdFinding[];
  setext: MdFinding[];
  /** The markdown with link and image destinations blanked, for phrase scans. */
  prose: string;
}

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const SETEXT_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;

function blank(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

/** Which lines sit inside (or are the delimiters of) a fenced code block. */
function fenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let open: { char: string; len: number } | null = null;
  lines.forEach((line, i) => {
    if (open) {
      mask[i] = true;
      const close = new RegExp(`^ {0,3}${open.char === "`" ? "`" : "~"}{${open.len},}[ \\t]*$`);
      if (close.test(line)) open = null;
      return;
    }
    const m = FENCE_OPEN_RE.exec(line);
    if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      open = { char: m[1][0], len: m[1].length };
      mask[i] = true;
    }
  });
  return mask;
}

/** Replaces inline code spans (within a paragraph) with same-length filler so nothing inside is scanned. */
function maskInlineCode(text: string): string {
  return text
    .split(/(\n[ \t]*\n)/)
    .map((block, i) => (i % 2 === 1 ? block : maskBlock(block)))
    .join("");
}

function maskBlock(block: string): string {
  let out = "";
  let i = 0;
  while (i < block.length) {
    if (block[i] === "\\") {
      out += block.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (block[i] !== "`") {
      out += block[i++];
      continue;
    }
    let run = 0;
    while (block[i + run] === "`") run++;
    // the next run of exactly `run` backticks closes the span
    let j = i + run;
    let close = -1;
    while (j < block.length) {
      if (block[j] !== "`") {
        j++;
        continue;
      }
      let r = 0;
      while (block[j + r] === "`") r++;
      if (r === run) {
        close = j;
        break;
      }
      j += r;
    }
    if (close === -1) {
      out += block.slice(i, i + run);
      i += run;
      continue;
    }
    out += block.slice(i, close + run).replace(/[^\n]/g, "c");
    i = close + run;
  }
  return out;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** The offset of the `]` matching the `[` at `open`, or -1; never crosses a blank line. */
function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "\n" && /^\n[ \t]*\n/.test(s.slice(i, i + 80))) return -1;
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

/** Parses `(dest "title")` starting at the `(`; returns the destination and the offset after `)`. */
function parseDestination(s: string, open: number): { dest: string; destStart: number; destEnd: number; end: number } | null {
  let i = open + 1;
  while (s[i] === " " || s[i] === "\t") i++;
  const destStart = i;
  let depth = 0;
  while (i < s.length && !/\s/.test(s[i])) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  const destEnd = i;
  const dest = s.slice(destStart, destEnd);
  while (s[i] === " " || s[i] === "\t" || s[i] === "\n") i++;
  if (s[i] === '"' || s[i] === "'") {
    const q = s[i];
    const end = s.indexOf(q, i + 1);
    if (end === -1) return null;
    i = end + 1;
    while (s[i] === " " || s[i] === "\t" || s[i] === "\n") i++;
  }
  if (s[i] !== ")") return null;
  return { dest, destStart, destEnd, end: i + 1 };
}

export function scanMarkdown(markdown: string): MarkdownScan {
  const lines = markdown.split("\n");
  const fenced = fenceMask(lines);

  // 1. Headings and setext, from the original lines.
  const headings: MdHeading[] = [];
  const setext: MdFinding[] = [];
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const h = HEADING_RE.exec(line);
    if (h) {
      headings.push({ level: h[1].length, text: (h[2] ?? "").trim(), line: i + 1 });
      return;
    }
    if (i > 0 && !fenced[i - 1] && SETEXT_RE.test(line) && lines[i - 1].trim() !== "" && !HEADING_RE.test(lines[i - 1])) {
      setext.push({ line: i + 1, snippet: `${lines[i - 1].trim()} / ${line.trim()}` });
    }
  });

  // 2. A length-preserving masked copy: fenced lines and inline code blanked.
  const afterFences = lines.map((l, i) => (fenced[i] ? blank(l) : l)).join("\n");
  const inline = maskInlineCode(afterFences);
  const starts = lineStarts(inline);

  // 3. Links, images, reference-style links.
  const links: MdLink[] = [];
  const images: MdImage[] = [];
  const referenceLinks: MdFinding[] = [];
  const destRanges: [number, number][] = [];
  const consumed: [number, number][] = []; // link constructs removed before the bare-URL scan
  for (let i = 0; i < inline.length; i++) {
    const c = inline[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c !== "[") continue;
    const isImage = inline[i - 1] === "!" && inline[i - 2] !== "\\";
    const close = matchBracket(inline, i);
    if (close === -1) continue;
    const text = inline.slice(i + 1, close);
    const next = inline[close + 1];
    const line = lineOf(starts, isImage ? i - 1 : i);
    if (next === "(") {
      const parsed = parseDestination(inline, close + 1);
      if (!parsed) continue;
      destRanges.push([close + 1, parsed.end]);
      consumed.push([close + 1, parsed.end]);
      if (isImage) images.push({ alt: markdown.slice(i + 1, close), source: parsed.dest, line });
      else links.push({ text: markdown.slice(i + 1, close), destination: parsed.dest, line });
      continue;
    }
    if (next === "[" || (next === ":" && (i === 0 || inline[i - 1] === "\n")) || text.startsWith("^")) {
      // `[a][b]`, `[a][]`, `[ref]: url` at a line start, and `[^note]`
      const after = next === "[" ? matchBracket(inline, close + 1) : close;
      referenceLinks.push({ line, snippet: inline.slice(i, Math.min(after + 1, i + 40)) });
    }
  }

  // 4. Autolinks, then raw HTML that is not an autolink.
  const autolinks: MdFinding[] = [];
  const autolinkRanges: [number, number][] = [];
  for (const m of inline.matchAll(/<(?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/g)) {
    if (inline[m.index - 1] === "\\") continue;
    autolinks.push({ line: lineOf(starts, m.index), snippet: m[0] });
    autolinkRanges.push([m.index, m.index + m[0].length]);
    consumed.push([m.index, m.index + m[0].length]);
  }
  const rawHtml: MdFinding[] = [];
  for (const m of inline.matchAll(/<(?:[A-Za-z]|!--|\/[A-Za-z])/g)) {
    if (inline[m.index - 1] === "\\") continue;
    if (autolinkRanges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    rawHtml.push({ line: lineOf(starts, m.index), snippet: inline.slice(m.index, m.index + 24).split("\n")[0] });
  }

  // 5. Bare URLs and emails, outside link destinations and autolinks.
  let bare = inline;
  for (const [a, b] of consumed) bare = bare.slice(0, a) + blank(bare.slice(a, b)) + bare.slice(b);
  const bareUrls: MdFinding[] = [];
  for (const m of bare.matchAll(/\bhttps?:\/\/[^\s<>)]+|\bwww\.[^\s<>)]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gi)) {
    bareUrls.push({ line: lineOf(starts, m.index), snippet: m[0] });
  }

  // 6. Entities left over (not an escaped one).
  const entities: MdFinding[] = [];
  for (const m of inline.matchAll(/&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g)) {
    if (inline[m.index - 1] === "\\") continue;
    entities.push({ line: lineOf(starts, m.index), snippet: m[0] });
  }

  // 7. Prose: the original with destinations blanked (length preserved).
  let prose = markdown;
  for (const [a, b] of destRanges) prose = prose.slice(0, a) + blank(prose.slice(a, b)) + prose.slice(b);

  return { headings, links, images, rawHtml, autolinks, referenceLinks, bareUrls, entities, setext, prose };
}
