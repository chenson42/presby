/**
 * Pre-push gate — mechanizes Workflow Rule 5 ("use /pre-push before every push")
 * which previously existed only as prose (Fable external review 2026-08-09, A6).
 *
 * Two modes:
 *
 *  1. `node scripts/pre-push-gate.mjs --stamp`
 *     Run by the /pre-push skill after a clean "Ready to push: yes" summary.
 *     Writes .claude/pre-push-ok.json recording the HEAD the checks ran against.
 *     This is the ONLY writer of the marker.
 *
 *  2. No args — PreToolUse hook mode (registered in .claude/settings.json for
 *     the Bash tool). Reads the tool call as JSON on stdin and hands it to the
 *     pure `decideHook()`:
 *       - no `git push` in the command → exit 0
 *       - the push targets some other repository (a scratch/ checkout) → exit 0
 *       - a HEAD-moving git command (commit, merge, rebase, cherry-pick, am,
 *         pull, revert, reset) comes before the push in the SAME command →
 *         exit 2, even with a fresh marker (Rule 5: commit, /pre-push, then
 *         push, as separate calls — a marker stamped before the commit does
 *         not describe the commit this command would push)
 *       - marker missing → exit 2 (run /pre-push first)
 *       - marker HEAD ≠ current HEAD → exit 2 (commits landed after the checks)
 *       - marker matches → exit 0 (push proceeds)
 *     Any parse error or exception fails OPEN (exit 0) — a broken hook must
 *     never brick every Bash call.
 *
 * The marker is gitignored and per-machine; pushing from a plain terminal is
 * not gated (the hook only runs inside Claude Code sessions), which matches
 * Rule 5's intent: the AGENT never pushes unchecked.
 *
 * Parsing. The command is read by a small shell lexer, not scanned: quotes,
 * `$(...)` and backtick substitutions, heredoc bodies, comments, `;`/`&`/`|`
 * lists, subshells and braces are understood, so a commit MESSAGE that talks
 * about `git commit && git push` is text, not a command (found live: the old
 * quote-naive splitter refused its own pipeline's commit messages). Wrapped
 * invocations are followed: `bash|sh|zsh|dash -c "..."`, `eval ...`, a shell
 * reading a heredoc, and the prefixes `command`, `env`, `exec`, `builtin`,
 * `time`, `nohup`, `nice`, `!`, `NAME=value`; `git` is matched by basename
 * (`/usr/bin/git`). Nesting is followed to depth 6.
 *
 * Scoped to THIS repo only: a `git push` run against some other git
 * repository entirely (a working checkout under the gitignored `scratch/`
 * directory) is not gated by presby's own marker, and neither is a
 * commit-then-push there. `cd` segments (from the hook payload's own `cwd`)
 * and any `git -C` are tracked to find the real target directory, then ITS
 * git toplevel is resolved. Undeterminable fails toward gating — the
 * conservative, pre-existing behavior for presby's own pushes.
 *
 * ACCEPTED RESIDUALS — the gate catches an agent's mistakes, not an adversary:
 *   - aliases (shell or git-config `ci`/`co`), variable indirection (`$G push`)
 *   - wrappers that are not a shell: xargs, find -exec, ssh, watch, make,
 *     `python -c`, `node -e`
 *   - `git checkout` / `git switch` (they move HEAD, but a branch-creating
 *     one-liner is common and legitimate)
 *   - more than 6 levels of nested shells (fails open)
 *   - a commit in one repository and a push of this one in the same command
 *     is judged by this repository's marker, not refused
 *   - a plain terminal is never gated, by design
 *   - `cd` inside a subshell or `bash -c` is treated as persisting (this is
 *     conservative toward gating)
 *
 * Exported for unit-testing:
 *   commandContainsGitPush(command: string): boolean
 *   resolvePushTargetRepoRoot(command: string, cwd: string): string | null
 *   analyzeGitInvocations(command: string, cwd: string): GitInvocation[]
 *   HEAD_MOVERS: ReadonlySet<string>
 *   decideHook(input): { exit: 0 } | { exit: 2, message: string }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MARKER_PATH = path.join(REPO_ROOT, ".claude", "pre-push-ok.json");

// ── Lexer ────────────────────────────────────────────────────────────────────

const SEP = new Set([";", "&", "|", "(", ")", "`"]);
const MAX_DEPTH = 6;

/**
 * Lexes `src` into simple commands: `[{ words, heredocs }]`, in execution
 * order (a `$(...)` inside double quotes runs before the command it sits in,
 * so its simple commands are emitted first). Never throws on malformed input
 * short of a stack overflow on absurd nesting, which callers treat as a
 * fail-open exception.
 *
 * @param {string} src
 * @returns {{ words: string[], heredocs: string[] }[]}
 */
export function lex(src) {
  let i = 0;
  const out = [];

  function list(stopAtParen) {
    let cmd = { words: [], heredocs: [] };
    let buf = "";
    let inWord = false;
    let depth = 0;
    const pending = [];
    const endWord = () => {
      if (inWord) {
        cmd.words.push(buf);
        buf = "";
        inWord = false;
      }
    };
    const endCmd = () => {
      endWord();
      if (cmd.words.length || cmd.heredocs.length || pending.some((p) => p.cmd === cmd)) {
        out.push(cmd);
      }
      cmd = { words: [], heredocs: [] };
    };
    const readHeredocBodies = () => {
      for (const p of pending.splice(0)) {
        let body = "";
        while (i < src.length) {
          let j = src.indexOf("\n", i);
          if (j === -1) j = src.length;
          const line = src.slice(i, j);
          i = Math.min(j + 1, src.length);
          if ((p.strip ? line.replace(/^\t+/, "") : line) === p.delim) break;
          body += line + "\n";
        }
        p.cmd.heredocs.push(body);
      }
    };

    while (i < src.length) {
      const c = src[i];
      if (c === " " || c === "\t") {
        endWord();
        i++;
        continue;
      }
      if (c === "\n") {
        endCmd();
        i++;
        if (pending.length) readHeredocBodies();
        continue;
      }
      if (c === "\\") {
        if (src[i + 1] === "\n") {
          i += 2;
          continue;
        }
        buf += src[i + 1] ?? "";
        inWord = true;
        i += 2;
        continue;
      }
      if (c === "#" && !inWord) {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === "'") {
        const j = src.indexOf("'", i + 1);
        const e = j === -1 ? src.length : j;
        buf += src.slice(i + 1, e);
        inWord = true;
        i = e + 1;
        continue;
      }
      if (c === '"') {
        i++;
        inWord = true;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === "\\" && i + 1 < src.length) {
            buf += src[i + 1];
            i += 2;
            continue;
          }
          if (src[i] === "$" && src[i + 1] === "(") {
            i += 2;
            list(true);
            buf += "_";
            continue;
          }
          if (src[i] === "`") {
            i++;
            const j = src.indexOf("`", i);
            out.push(...lex(src.slice(i, j === -1 ? src.length : j)));
            i = j === -1 ? src.length : j + 1;
            buf += "_";
            continue;
          }
          buf += src[i++];
        }
        i++;
        continue;
      }
      if (c === "<" && src.startsWith("<<<", i)) {
        // here-string: not a heredoc
        buf += "<<<";
        inWord = true;
        i += 3;
        continue;
      }
      if (c === "<" && src[i + 1] === "<") {
        i += 2;
        let strip = false;
        if (src[i] === "-") {
          strip = true;
          i++;
        }
        while (src[i] === " " || src[i] === "\t") i++;
        let delim = "";
        while (i < src.length && !/[\s;&|()<>]/.test(src[i])) {
          if (src[i] === "'" || src[i] === '"') {
            const q = src[i];
            const j = src.indexOf(q, i + 1);
            const e = j === -1 ? src.length : j;
            delim += src.slice(i + 1, e);
            i = e + 1;
          } else if (src[i] === "\\") {
            delim += src[i + 1] ?? "";
            i += 2;
          } else delim += src[i++];
        }
        endWord();
        pending.push({ delim, strip, cmd });
        continue;
      }
      if (c === "(") {
        depth++;
        endCmd();
        i++;
        continue;
      }
      if (c === ")") {
        endCmd();
        i++;
        if (depth > 0) depth--;
        else if (stopAtParen) return;
        continue;
      }
      if (SEP.has(c)) {
        endCmd();
        i++;
        continue;
      }
      buf += c;
      inWord = true;
      i++;
    }
    endCmd();
  }

  list(false);
  return out
    .filter((c) => c.words.length || c.heredocs.length)
    .map((c) => ({
      ...c,
      words: c.words[0] === "{" || c.words[0] === "}" ? c.words.slice(1) : c.words,
    }));
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/** Git subcommands that move HEAD; a chained push after any of them is refused. */
export const HEAD_MOVERS = new Set([
  "commit",
  "merge",
  "rebase",
  "cherry-pick",
  "am",
  "pull",
  "revert",
  "reset",
]);

const WRAPPERS = new Set(["env", "command", "exec", "builtin", "time", "nohup", "nice", "!"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const GIT_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/**
 * Resolves a directory `arg` (as passed to `cd` or `git -C`) against `base`.
 * Handles `~` for HOME since a real shell would too.
 */
function resolveDir(base, arg) {
  let target = arg;
  if (target === "~" || target.startsWith("~/")) {
    target = path.join(process.env.HOME ?? "", target.slice(1));
  }
  return path.resolve(base, target);
}

/**
 * @typedef {{ sub: string | undefined, dir: string, index: number }} GitInvocation
 */

/**
 * Every `git` invocation in `command`, in execution order, with the absolute
 * directory it runs in (after `cd` tracking and `git -C`). `sub` is the first
 * non-flag word after git's own global flags.
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {GitInvocation[]}
 */
export function analyzeGitInvocations(command, cwd) {
  const res = [];
  let dir = cwd;

  function walk(src, depth) {
    for (const c of lex(src)) {
      const w = c.words.slice();
      while (w.length && (WRAPPERS.has(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
        const head = w.shift();
        if (head === "env") while (w[0]?.startsWith("-")) w.shift();
      }
      if (!w.length) continue;
      const prog = path.basename(w[0]);
      if (SHELLS.has(prog)) {
        if (depth >= MAX_DEPTH) continue;
        const ci = w.findIndex((x, k) => k > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(x));
        if (ci !== -1 && w[ci + 1] !== undefined) walk(w[ci + 1], depth + 1);
        else for (const h of c.heredocs) walk(h, depth + 1);
      } else if (prog === "eval") {
        if (depth < MAX_DEPTH) walk(w.slice(1).join(" "), depth + 1);
      } else if (prog === "cd") {
        if (w[1] !== undefined && w[1] !== "-") dir = resolveDir(dir, w[1]);
      } else if (prog === "git") {
        let gitDir = dir;
        let k = 1;
        while (k < w.length) {
          const t = w[k];
          if (t === "-C" && w[k + 1] !== undefined) {
            gitDir = resolveDir(gitDir, w[k + 1]);
            k += 2;
            continue;
          }
          if (GIT_VALUE_FLAGS.has(t)) {
            k += 2;
            continue;
          }
          if (t.startsWith("-")) {
            k++;
            continue;
          }
          break;
        }
        res.push({ sub: w[k], dir: gitDir, index: res.length });
      }
    }
  }

  walk(command, 0);
  return res;
}

/**
 * True when the shell command invokes `git push` — `git` at command position
 * (by basename, through the wrappers above) with `push` as its resolved
 * subcommand. Quoted text, comments and heredoc bodies are not commands; a
 * substitution, subshell, `bash -c` string or `eval` is.
 *
 * @param {string} command - the Bash tool's command string
 * @returns {boolean}
 */
export function commandContainsGitPush(command) {
  return analyzeGitInvocations(command, process.cwd()).some((g) => g.sub === "push");
}

// ── Push target resolution ───────────────────────────────────────────────────

function gitToplevel(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Finds the git repository root the first `git push` in `command` would act
 * against, starting from `cwd`. Returns the resolved `git rev-parse
 * --show-toplevel` for the directory the push runs in, or `null` if there is
 * no push or it can't be determined (not a git repo, `cd` to a nonexistent
 * path, etc.) — callers treat `null` as "assume it's this repo".
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {string | null}
 */
export function resolvePushTargetRepoRoot(command, cwd) {
  const push = analyzeGitInvocations(command, cwd).find((g) => g.sub === "push");
  return push ? gitToplevel(push.dir) : null;
}

// ── Decision ─────────────────────────────────────────────────────────────────

const CHAINED_MESSAGE = (sub) =>
  "BLOCKED (Workflow Rule 5): this command moves HEAD and pushes in one call.\n" +
  "Commit first, run /pre-push, then push in a separate call.\n" +
  `Found: git ${sub} before git push. Any of commit, merge, rebase, cherry-pick, am, pull, revert or reset counts, even when it changes nothing; run it in its own call.`;

/**
 * The gate's whole decision as a pure function (it reads no marker and writes
 * nothing, so tests never touch the operator's real stamp).
 *
 * @param {{
 *   command: string,
 *   cwd: string,
 *   repoRoot: string,
 *   marker: { head?: string } | null,
 *   head: string | null,
 *   toplevelOf?: (dir: string) => string | null,
 * }} input
 * @returns {{ exit: 0 } | { exit: 2, message: string }}
 */
export function decideHook(input) {
  const { command, cwd, repoRoot, marker, head } = input;
  const toplevelOf = input.toplevelOf ?? gitToplevel;
  try {
    const invs = analyzeGitInvocations(command, cwd);
    if (!invs.some((g) => g.sub === "push")) return { exit: 0 };

    const cache = new Map();
    const ours = (g) => {
      if (!cache.has(g.dir)) cache.set(g.dir, toplevelOf(g.dir));
      const top = cache.get(g.dir);
      // null (undeterminable) falls toward gating
      return top === null || path.resolve(top) === repoRoot;
    };

    // Target repository FIRST, so a scratch/ checkout's commit-then-push
    // stays exempt.
    const push = invs.find((g) => g.sub === "push" && ours(g));
    if (!push) return { exit: 0 };

    const mover = invs.find(
      (g) => g.index < push.index && g.sub !== undefined && HEAD_MOVERS.has(g.sub) && ours(g),
    );
    if (mover) return { exit: 2, message: CHAINED_MESSAGE(mover.sub) };

    if (head === null) return { exit: 0 }; // git unavailable — fail open

    if (!marker?.head) {
      return {
        exit: 2,
        message:
          "BLOCKED (Workflow Rule 5): no pre-push marker found.\n" +
          "Run /pre-push first — a clean 'Ready to push: yes' summary stamps the marker\n" +
          "(node scripts/pre-push-gate.mjs --stamp). Then retry the push.",
      };
    }
    if (marker.head !== head) {
      return {
        exit: 2,
        message:
          `BLOCKED (Workflow Rule 5): pre-push marker is stale.\n` +
          `Checks ran at ${marker.head.slice(0, 10)} but HEAD is now ${head.slice(0, 10)} — ` +
          `commits landed after verification.\nRe-run /pre-push, then retry the push.`,
      };
    }
    return { exit: 0 };
  } catch {
    return { exit: 0 }; // fail open — never brick Bash on a gate bug
  }
}

// ── Modes ────────────────────────────────────────────────────────────────────

function currentHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function stamp() {
  const head = currentHead();
  writeFileSync(
    MARKER_PATH,
    JSON.stringify({ head, stampedAt: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(`pre-push-gate: marker stamped for HEAD ${head.slice(0, 10)}`);
  process.exit(0);
}

function hook() {
  let command = "";
  let payloadCwd = REPO_ROOT;
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    command = payload?.tool_input?.command ?? "";
    payloadCwd = payload?.cwd || REPO_ROOT;
  } catch {
    process.exit(0); // fail open — never brick Bash on a malformed payload
  }

  let marker = null;
  try {
    marker = JSON.parse(readFileSync(MARKER_PATH, "utf8"));
  } catch {
    // missing or unreadable marker → decideHook blocks a push
  }

  let head = null;
  try {
    head = currentHead();
  } catch {
    // not a git repo / git unavailable — decideHook fails open
  }

  const decision = decideHook({
    command: typeof command === "string" ? command : "",
    cwd: payloadCwd,
    repoRoot: REPO_ROOT,
    marker,
    head,
  });
  if (decision.exit === 2) console.error(decision.message);
  process.exit(decision.exit);
}

// Only run as a hook/stamp when invoked directly (not imported by tests).
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("pre-push-gate.mjs");

if (isMain) {
  if (process.argv[2] === "--stamp") stamp();
  else hook();
}
