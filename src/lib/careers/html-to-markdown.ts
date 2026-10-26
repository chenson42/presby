/**
 * Paste converter: clipboard HTML (Word, Google Docs, a web page) to the
 * description's markdown subset - pure apart from the DOM parser it is handed,
 * no `server-only`, safe for the browser editor
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Pure helpers"; T11).
 *
 * WHAT IT NEVER DOES: execute or load anything. The default parser is
 * `DOMParser.parseFromString(html, "text/html")`, which yields an INERT document
 * (scripts do not run, images and stylesheets do not load). The tree is only
 * ever read through `nodeType`, `nodeName`, `childNodes`, `getAttribute` and
 * `nodeValue`; nothing is inserted into the live page.
 *
 * WHAT IT KEEPS: headings (`h1`/`h2` to `##`, `h3` to `h6` to `###`; the page
 * owns the `h1`), paragraphs, bold, italic, links whose address passes the SAME
 * rule the validator enforces (`checkHref`), bulleted and numbered lists (nested
 * lists are flattened to one level, the subset has no nesting), and the text of
 * table cells as paragraphs. WHAT IT DROPS: everything non-textual (images,
 * scripts, styles, comments, embedded objects), colours, fonts, hidden content.
 * A dropped link keeps its text, and the count is reported so the editor can say
 * so.
 *
 * THE SUBSET HAS NO ESCAPE SYNTAX (finding P3-8): a literal `*` in pasted text
 * would italicise a span, so it becomes U+2217 (a lookalike). A paragraph that
 * would begin with `#` becomes a heading to the renderer, so its first `#`
 * becomes U+FF03; a paragraph that is only `---` would be a rule, so it becomes
 * an em dash. A `](` in plain text could read as the middle of a link, so its
 * bracket becomes U+FF3D.
 *
 * The output of every fixture passes `validateDescription` (T11).
 */
import { checkHref } from "./description";
import { normalizeMultiline } from "./text";

/** Input larger than this is not converted; the caller lets the browser paste plain text. */
export const MAX_PASTE_HTML_CHARS = 200_000;
/** Deeper trees are flattened to their text rather than recursed into. */
const MAX_DEPTH = 60;

export interface HtmlToMarkdownResult {
  markdown: string;
  /** Links whose address was not usable; their text was kept, the link was not. */
  droppedLinks: number;
}

export type HtmlParser = (html: string) => Document;

const defaultParser: HtmlParser = (html) => new DOMParser().parseFromString(html, "text/html");

// Private-use sentinels carry emphasis through whitespace and merge cleanup
// without confusing it with `*` in the text (all of which are replaced).
const B0 = "";
const B1 = "";
const I0 = "";
const I1 = "";
const SENTINELS = /[-]/g;

const DROP = new Set([
  "script", "style", "meta", "link", "head", "title", "noscript", "template", "svg", "math",
  "iframe", "object", "embed", "img", "picture", "video", "audio", "canvas", "input", "select",
  "button", "textarea", "base", "area", "map", "colgroup", "col", "frameset", "xml",
]);

const BLOCK = new Set([
  "p", "div", "section", "article", "aside", "header", "footer", "main", "nav", "h1", "h2", "h3",
  "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "blockquote", "pre", "hr", "figure", "figcaption", "address", "dl", "dt", "dd", "fieldset",
  "details", "summary", "body", "html", "center", "caption", "form",
]);

interface Counters {
  dropped: number;
}

interface InlineCtx {
  bold: boolean;
  italic: boolean;
  /** Inside a heading: emphasis is the heading's own styling, not markdown. */
  heading: boolean;
  depth: number;
}

function nameOf(node: Node): string {
  return node.nodeName.toLowerCase();
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function styleOf(el: Element): string {
  return (el.getAttribute("style") ?? "").toLowerCase();
}

function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  const style = styleOf(el);
  return (
    /display\s*:\s*none/.test(style) ||
    /visibility\s*:\s*hidden/.test(style) ||
    /mso-hide\s*:\s*all/.test(style)
  );
}

function isWordListIgnore(el: Element): boolean {
  return /mso-list\s*:\s*ignore/.test(styleOf(el));
}

/** `true`/`false` when the element's own style says so, else `undefined`. */
function explicitBold(el: Element): boolean | undefined {
  const match = /font-weight\s*:\s*([a-z0-9]+)/.exec(styleOf(el));
  if (!match) return undefined;
  const value = match[1]!;
  if (value === "bold" || value === "bolder") return true;
  if (value === "normal" || value === "lighter") return false;
  const n = Number(value);
  return Number.isFinite(n) ? n >= 600 : undefined;
}

function explicitItalic(el: Element): boolean | undefined {
  const match = /font-style\s*:\s*([a-z]+)/.exec(styleOf(el));
  if (!match) return undefined;
  if (match[1] === "italic" || match[1] === "oblique") return true;
  if (match[1] === "normal") return false;
  return undefined;
}

function isBoldElement(el: Element): boolean {
  const explicit = explicitBold(el);
  if (explicit !== undefined) return explicit;
  const name = nameOf(el);
  return name === "strong" || name === "b";
}

function isItalicElement(el: Element): boolean {
  const explicit = explicitItalic(el);
  if (explicit !== undefined) return explicit;
  const name = nameOf(el);
  return name === "em" || name === "i";
}

function containsBlock(el: Element): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (!isElement(child)) continue;
    if (DROP.has(nameOf(child))) continue;
    if (BLOCK.has(nameOf(child)) || containsBlock(child)) return true;
  }
  return false;
}

function textNodeToMarkdown(raw: string): string {
  return raw
    .replace(SENTINELS, "")
    .replace(/\*/g, "∗")
    .replace(/\]\(/g, "］(")
    .replace(/\s+/g, " ");
}

function plainText(el: Element, counters: Counters, depth: number): string {
  return inlineChildren(el, { bold: false, italic: false, heading: true, depth }, counters)
    .replace(/\s+/g, " ")
    .trim();
}

function inlineChildren(parent: Node, ctx: InlineCtx, counters: Counters): string {
  let out = "";
  for (const child of Array.from(parent.childNodes)) out += inline(child, ctx, counters);
  return out;
}

function encodeParens(href: string): string {
  return href.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function inline(node: Node, ctx: InlineCtx, counters: Counters): string {
  if (node.nodeType === 3) return textNodeToMarkdown(node.nodeValue ?? "");
  if (!isElement(node)) return "";
  const name = nameOf(node);
  if (DROP.has(name) || isHidden(node) || isWordListIgnore(node)) return "";
  if (ctx.depth > MAX_DEPTH) return textNodeToMarkdown(node.textContent ?? "");
  if (name === "br") return " ";

  const next: InlineCtx = { ...ctx, depth: ctx.depth + 1 };

  if (name === "a") {
    const href = (node.getAttribute("href") ?? "").trim();
    if (href === "") return inlineChildren(node, next, counters);
    const label = plainText(node, counters, next.depth).replace(/\[/g, "(").replace(/\]/g, ")");
    if (label === "") return "";
    const cleaned = encodeParens(href);
    if (!checkHref(cleaned).ok) {
      counters.dropped += 1;
      return label;
    }
    // A link inside emphasis must sit OUTSIDE it: the renderer reads emphasis
    // content as plain text, so `**[x](y)**` would not link.
    return (
      (ctx.bold ? B1 : "") +
      (ctx.italic ? I1 : "") +
      `[${label}](${cleaned})` +
      (ctx.italic ? I0 : "") +
      (ctx.bold ? B0 : "")
    );
  }

  let open = "";
  let close = "";
  if (!ctx.heading) {
    if (isBoldElement(node) && !ctx.bold && !ctx.italic) {
      open = B0;
      close = B1;
      next.bold = true;
    } else if (isItalicElement(node) && !ctx.italic && !ctx.bold) {
      open = I0;
      close = I1;
      next.italic = true;
    }
  }

  const inner = inlineChildren(node, next, counters);
  if (BLOCK.has(name)) return ` ${open}${inner}${close} `;
  return `${open}${inner}${close}`;
}

/** Whitespace tidy, emphasis cleanup, then sentinels to markers. */
function finalizeInline(buffer: string): string {
  let s = buffer;
  for (const [open, close] of [
    [B0, B1],
    [I0, I1],
  ] as const) {
    // `**a****b**` (Word splits a run) becomes one run.
    s = s.replace(new RegExp(`${close}(\\s*)${open}`, "g"), "$1");
    // An emphasis with nothing in it is no emphasis.
    s = s.replace(new RegExp(`${open}(\\s*)${close}`, "g"), "$1");
    // Spaces belong outside the markers.
    s = s.replace(new RegExp(`${open}(\\s+)`, "g"), `$1${open}`);
    s = s.replace(new RegExp(`(\\s+)${close}`, "g"), `${close}$1`);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.replace(new RegExp(B0, "g"), "**").replace(new RegExp(B1, "g"), "**").replace(new RegExp(I0, "g"), "*").replace(new RegExp(I1, "g"), "*");
}

/** A paragraph the renderer would misread as a heading or a rule keeps its words and loses the syntax. */
function protectParagraph(text: string): string {
  if (/^#{1,6}(?:\s|$)/.test(text)) return text.replace("#", "＃");
  if (/^-{3,}$/.test(text)) return "—";
  return text;
}

interface WalkState {
  out: string[];
  counters: Counters;
  /** Index in `out` of the Word-list run being extended, or -1. */
  wordRun: number;
}

function pushBlock(state: WalkState, text: string): void {
  if (text !== "") {
    state.out.push(text);
    state.wordRun = -1;
  }
}

function listLines(list: Element, counters: Counters, depth: number): string[] {
  const ordered = nameOf(list) === "ol";
  const lines: string[] = [];
  let n = 0;
  if (depth > MAX_DEPTH) return lines;
  for (const child of Array.from(list.childNodes)) {
    if (!isElement(child) || isHidden(child)) continue;
    const name = nameOf(child);
    if (name === "ul" || name === "ol") {
      lines.push(...listLines(child, counters, depth + 1));
      continue;
    }
    if (name !== "li") continue;
    let buffer = "";
    const nested: string[] = [];
    for (const part of Array.from(child.childNodes)) {
      if (isElement(part) && (nameOf(part) === "ul" || nameOf(part) === "ol")) {
        nested.push(...listLines(part, counters, depth + 1));
      } else {
        buffer += inline(part, { bold: false, italic: false, heading: false, depth: depth + 1 }, counters);
      }
    }
    const text = protectParagraph(finalizeInline(buffer));
    if (text !== "") {
      n += 1;
      lines.push(`${ordered ? `${n}. ` : "- "}${text}`);
    }
    lines.push(...nested);
  }
  return lines;
}

function wordListMarker(el: Element): { ordered: boolean; number: number | null } {
  const stack: Element[] = [el];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of Array.from(current.childNodes)) {
      if (!isElement(child)) continue;
      if (isWordListIgnore(child)) {
        const glyph = (child.textContent ?? "").replace(/[\s ]+/g, "");
        const digits = /^\(?(\d{1,3})[.)]?$/.exec(glyph);
        return digits ? { ordered: true, number: Number(digits[1]) } : { ordered: false, number: null };
      }
      stack.push(child);
    }
  }
  return { ordered: false, number: null };
}

function walkChildren(
  parent: Node,
  state: WalkState,
  wrap: { bold: boolean; italic: boolean },
  depth: number,
): void {
  let buffer = "";
  const flush = () => {
    let text = finalizeInline(buffer);
    buffer = "";
    if (text === "") return;
    text = protectParagraph(text);
    if (wrap.bold) text = `**${text.replace(/\*+/g, "")}**`;
    else if (wrap.italic) text = `*${text.replace(/\*+/g, "")}*`;
    pushBlock(state, text);
  };

  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3) {
      buffer += textNodeToMarkdown(child.nodeValue ?? "");
      continue;
    }
    if (!isElement(child)) continue;
    const name = nameOf(child);
    if (DROP.has(name) || isHidden(child)) continue;

    if (depth > MAX_DEPTH) {
      buffer += textNodeToMarkdown(child.textContent ?? "");
      continue;
    }

    if (/^h[1-6]$/.test(name)) {
      flush();
      const text = finalizeInline(
        inline(child, { bold: false, italic: false, heading: true, depth: depth + 1 }, state.counters),
      );
      pushBlock(state, text === "" ? "" : `${name === "h1" || name === "h2" ? "## " : "### "}${text}`);
      continue;
    }
    if (name === "ul" || name === "ol") {
      flush();
      pushBlock(state, listLines(child, state.counters, depth + 1).join("\n"));
      continue;
    }
    if (name === "p" && /(^|\s)MsoListParagraph/i.test(child.getAttribute("class") ?? "")) {
      flush();
      const marker = wordListMarker(child);
      const text = protectParagraph(
        finalizeInline(inlineChildren(child, { bold: false, italic: false, heading: false, depth: depth + 1 }, state.counters)),
      );
      if (text !== "") {
        const line = `${marker.ordered ? `${marker.number ?? 1}. ` : "- "}${text}`;
        if (state.wordRun >= 0) {
          state.out[state.wordRun] += `\n${line}`;
        } else {
          state.out.push(line);
          state.wordRun = state.out.length - 1;
        }
      }
      continue;
    }
    if (BLOCK.has(name) || containsBlock(child)) {
      flush();
      // A transparent inline wrapper around blocks (Google Docs wraps the whole
      // document in `<b style="font-weight:normal">`) passes its emphasis down.
      const inlineWrapper = !BLOCK.has(name);
      const nextWrap = inlineWrapper
        ? {
            bold: wrap.bold || (isBoldElement(child) && !wrap.italic),
            italic: wrap.italic || (isItalicElement(child) && !wrap.bold),
          }
        : wrap;
      walkChildren(child, state, nextWrap, depth + 1);
      continue;
    }
    buffer += inline(child, { bold: false, italic: false, heading: false, depth: depth + 1 }, state.counters);
  }
  flush();
}

/**
 * Converts clipboard HTML. Returns `null` for input over `MAX_PASTE_HTML_CHARS`
 * (the caller lets the browser paste plain text instead) or when the parser
 * itself fails.
 */
export function htmlToMarkdown(
  html: string,
  parse: HtmlParser = defaultParser,
): HtmlToMarkdownResult | null {
  if (typeof html !== "string" || html.length > MAX_PASTE_HTML_CHARS) return null;
  let doc: Document;
  try {
    doc = parse(html);
  } catch {
    return null;
  }
  const root = doc.body ?? doc.documentElement;
  if (!root) return { markdown: "", droppedLinks: 0 };

  const state: WalkState = { out: [], counters: { dropped: 0 }, wordRun: -1 };
  walkChildren(root, state, { bold: false, italic: false }, 0);

  const markdown = normalizeMultiline(state.out.join("\n\n").replace(SENTINELS, "")).trim();
  return { markdown, droppedLinks: state.counters.dropped };
}
