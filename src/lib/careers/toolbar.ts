/**
 * The description editor's toolbar as a pure function - no DOM, no `server-only`
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Pure helpers"). The editor
 * hands it the textarea's value and selection and writes back what it returns, so
 * every behaviour here is testable without a browser.
 *
 * The markdown subset has no escape syntax and no nesting (site-kit's renderer:
 * `**bold**` and `*italic*` cannot contain `*`), so the toolbar does the small,
 * predictable things: block actions (`##`, `###`, `-`, `1.`) work per selected
 * line and a second press removes the marker; `bold` and `italic` wrap the
 * selection and a second press unwraps it; `link` wraps the selection as
 * `[selection](https://)` and selects the `https://` placeholder, which the
 * validator refuses by name until the author finishes it.
 */

export type ToolbarAction =
  | "heading"
  | "subheading"
  | "bold"
  | "italic"
  | "bullets"
  | "numbers"
  | "link";

export interface ToolbarState {
  value: string;
  /** Selection start (UTF-16 offset), as a textarea reports it. */
  start: number;
  /** Selection end; equal to `start` for a caret. */
  end: number;
}

/** Any block marker the renderer reads at the start of a line. */
const BLOCK_MARKER_RE = /^(?:#{1,6} |[-*] |\d+\. )/;
const NUMBER_MARKER_RE = /^\d+\. /;

const LINK_PLACEHOLDER = "https://";
const EMPTY_LINK_LABEL = "your link text";

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(n, max));
}

function lineStartOf(value: string, index: number): number {
  return index === 0 ? 0 : value.lastIndexOf("\n", index - 1) + 1;
}

function lineEndOf(value: string, index: number): number {
  const at = value.indexOf("\n", index);
  return at === -1 ? value.length : at;
}

function applyBlock(
  state: ToolbarState,
  marker: string | "numbers",
): ToolbarState {
  const { value, start, end } = state;
  const lineStart = lineStartOf(value, start);
  // A selection that ends just after a newline does not include the next line.
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const lineEnd = lineEndOf(value, effectiveEnd);
  const lines = value.slice(lineStart, lineEnd).split("\n");

  const isNumbers = marker === "numbers";
  const has = (line: string) => (isNumbers ? NUMBER_MARKER_RE.test(line) : line.startsWith(marker));
  const strip = (line: string) => line.replace(BLOCK_MARKER_RE, "");
  const filled = lines.filter((line) => line.trim() !== "");
  // A single empty line still takes the marker, so the author can press the
  // button and start typing; blank lines inside a larger selection are left alone.
  const targets = lines.length === 1 ? lines : filled;
  const allHave = filled.length > 0 && filled.every(has);

  let counter = 0;
  const next = lines.map((line) => {
    if (!targets.includes(line) || (lines.length > 1 && line.trim() === "")) return line;
    if (allHave) return line.replace(isNumbers ? NUMBER_MARKER_RE : marker, "");
    counter += 1;
    return `${isNumbers ? `${counter}. ` : marker}${strip(line)}`;
  });

  const region = next.join("\n");
  const out = value.slice(0, lineStart) + region + value.slice(lineEnd);

  if (start === end) {
    const delta = next[0]!.length - lines[0]!.length;
    const caret = Math.max(lineStart, start + delta);
    return { value: out, start: caret, end: caret };
  }
  return { value: out, start: lineStart, end: lineStart + region.length };
}

function applyWrap(state: ToolbarState, marker: "**" | "*"): ToolbarState {
  const { value, start, end } = state;
  const m = marker.length;

  if (start === end) {
    const out = value.slice(0, start) + marker + marker + value.slice(end);
    return { value: out, start: start + m, end: start + m };
  }

  const selected = value.slice(start, end);

  // Already wrapped from outside: unwrap. A lone `*` next to another `*` is the
  // edge of a bold pair, not italic, so italic only unwraps a single `*` each side.
  const wrappedOutside =
    value.slice(start - m, start) === marker &&
    value.slice(end, end + m) === marker &&
    (marker === "**" || (value[start - 2] !== "*" && value[end + 1] !== "*"));
  if (start >= m && wrappedOutside) {
    const out = value.slice(0, start - m) + selected + value.slice(end + m);
    return { value: out, start: start - m, end: end - m };
  }

  // The selection itself includes the markers: unwrap.
  const wrappedInside =
    selected.length > 2 * m &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    (marker === "**" || (!selected.startsWith("**") && !selected.endsWith("**")));
  if (wrappedInside) {
    const inner = selected.slice(m, selected.length - m);
    const out = value.slice(0, start) + inner + value.slice(end);
    return { value: out, start, end: start + inner.length };
  }

  const out = value.slice(0, start) + marker + selected + marker + value.slice(end);
  return { value: out, start: start + m, end: end + m };
}

function applyLink(state: ToolbarState): ToolbarState {
  const { value, start, end } = state;
  const label = start === end ? EMPTY_LINK_LABEL : value.slice(start, end);
  const inserted = `[${label}](${LINK_PLACEHOLDER})`;
  const out = value.slice(0, start) + inserted + value.slice(end);
  const placeholderStart = start + 1 + label.length + 2;
  return { value: out, start: placeholderStart, end: placeholderStart + LINK_PLACEHOLDER.length };
}

export function applyToolbar(state: ToolbarState, action: ToolbarAction): ToolbarState {
  const max = state.value.length;
  const a = clamp(Math.min(state.start, state.end), max);
  const b = clamp(Math.max(state.start, state.end), max);
  const s: ToolbarState = { value: state.value, start: a, end: b };

  switch (action) {
    case "heading":
      return applyBlock(s, "## ");
    case "subheading":
      return applyBlock(s, "### ");
    case "bullets":
      return applyBlock(s, "- ");
    case "numbers":
      return applyBlock(s, "numbers");
    case "bold":
      return applyWrap(s, "**");
    case "italic":
      return applyWrap(s, "*");
    case "link":
      return applyLink(s);
  }
}
