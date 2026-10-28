/**
 * The `[help:<token>]` grammar over docs/TODO.md (F349, DECISION-294). "In Flight" holds `- [x]`
 * lines and declined items stay `- [ ]`, so checkbox state alone cannot say Done or open; the
 * `## Done` heading splits the file and the word "declined" splits what is left:
 *
 *   done      a line starting `- [x]` AFTER the `## Done` heading
 *   open      a line starting `- [ ]` BEFORE it, not containing "declined" (any case)
 *   declined  a line starting `- [ ]` BEFORE it, containing "declined"
 *   ambiguous any other line carrying a token (a `- [x]` above Done, a `- [ ]` below it, prose)
 *   missing   the token is on no line
 *   duplicate the token occurs more than once in the file (on two lines, or twice on one)
 *
 * A token is exactly `[help:<token>]`, lowercase kebab; `[help: x]` and `[Help:x]` are not tokens.
 */
export type TokenState = "open" | "done" | "declined" | "ambiguous" | "missing" | "duplicate";

export interface TokenReading {
  token: string;
  state: TokenState;
  /** 1-based lines carrying the token (one entry per line, however many times it repeats there). */
  lines: number[];
}

export interface TodoReading {
  /** False when the file cannot be split into open and Done (no `## Done`, or several). */
  classifiable: boolean;
  reason?: string;
  readings: Map<string, TokenReading>;
}

const TOKEN_RE = /\[help:([a-z0-9]+(?:-[a-z0-9]+)*)\]/g;

export function readTodoTokens(todo: string): TodoReading {
  const lines = todo.split("\n");
  const doneAt = lines.reduce<number[]>((acc, l, i) => (l.trimEnd() === "## Done" ? [...acc, i] : acc), []);
  const classifiable = doneAt.length === 1;
  const reason = classifiable
    ? undefined
    : doneAt.length === 0
      ? 'cannot classify: no "## Done" heading found'
      : 'cannot classify: more than one "## Done" heading';

  const occurrences = new Map<string, { line: number; count: number }[]>();
  lines.forEach((text, i) => {
    const perLine = new Map<string, number>();
    for (const m of text.matchAll(TOKEN_RE)) perLine.set(m[1], (perLine.get(m[1]) ?? 0) + 1);
    for (const [token, count] of perLine) {
      const list = occurrences.get(token) ?? [];
      list.push({ line: i + 1, count });
      occurrences.set(token, list);
    }
  });

  const readings = new Map<string, TokenReading>();
  for (const [token, list] of occurrences) {
    const total = list.reduce((n, o) => n + o.count, 0);
    const lineNumbers = list.map((o) => o.line);
    if (total > 1) {
      readings.set(token, { token, state: "duplicate", lines: lineNumbers });
      continue;
    }
    const at = list[0].line - 1;
    readings.set(token, { token, state: classifiable ? classify(lines[at], at, doneAt[0]) : "ambiguous", lines: lineNumbers });
  }
  return { classifiable, reason, readings };
}

function classify(line: string, index: number, doneAt: number): TokenState {
  const afterDone = index > doneAt;
  if (line.startsWith("- [x]")) return afterDone ? "done" : "ambiguous";
  if (line.startsWith("- [ ]")) {
    if (afterDone) return "ambiguous";
    return /declined/i.test(line) ? "declined" : "open";
  }
  return "ambiguous";
}

export function readingFor(read: TodoReading, token: string): TokenReading {
  return read.readings.get(token) ?? { token, state: "missing", lines: [] };
}
