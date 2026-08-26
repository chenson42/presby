#!/usr/bin/env node
/**
 * Pre-push gate — mechanizes Workflow Rule 5 ("use /pre-push before every push")
 * which previously existed only as prose (Fable external review 2026-08-09, A6).
 *
 * Two modes:
 *
 *  1. `node scripts/pre-push-gate.mjs --stamp`
 *     Run by the /pre-push skill after a clean "Ready to push: yes" summary.
 *     Writes .claude/pre-push-ok.json recording the HEAD the checks ran against.
 *
 *  2. No args — PreToolUse hook mode (registered in .claude/settings.json for
 *     the Bash tool). Reads the tool call as JSON on stdin; if the command is a
 *     `git push`, requires a marker stamped at the CURRENT HEAD:
 *       - marker missing  → exit 2 (blocks the push; run /pre-push first)
 *       - marker HEAD ≠ current HEAD → exit 2 (commits landed after the checks)
 *       - marker matches  → exit 0 (push proceeds)
 *     Non-push commands always exit 0. Any parse error fails OPEN (exit 0) —
 *     a broken hook must never brick every Bash call.
 *
 * The marker is gitignored and per-machine; pushing from a plain terminal is
 * not gated (the hook only runs inside Claude Code sessions), which matches
 * Rule 5's intent: the AGENT never pushes unchecked.
 *
 * Scoped to THIS repo only: a Bash `git push` run against some other git
 * repository entirely (e.g. a working checkout under the gitignored
 * `scratch/` directory — presby-site-kit, site-fpcw) is not gated by presby's
 * own marker. Found live: an agent pushing a scratch/ checkout was blocked by
 * a stale marker that had nothing to do with that repository, because the
 * hook checked presby's own HEAD regardless of which repo the command
 * actually targeted. `resolvePushTargetRepoRoot()` walks the command's `cd`
 * segments (from the hook payload's own `cwd`) and any inline `git -C` on the
 * push segment itself to find the real target directory, then resolves ITS
 * git toplevel — only when that equals presby's own repo root does the
 * marker check apply. Undeterminable (no payload cwd, `git` not runnable in
 * the resolved directory, etc.) fails toward gating — the conservative,
 * pre-existing behavior for presby's own pushes — not toward silently
 * ungating an unrecognized command.
 *
 * Exported for unit-testing:
 *   commandContainsGitPush(command: string): boolean
 *   resolvePushTargetRepoRoot(command: string, cwd: string): string | null
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MARKER_PATH = path.join(REPO_ROOT, ".claude", "pre-push-ok.json");

// ── Push detection ───────────────────────────────────────────────────────────

/**
 * True when the shell command invokes `git push` — i.e. `git` at command
 * position with `push` as its resolved subcommand.
 *
 * Two false-positive classes were caught live while building this:
 *   1. a substring scan matched "git push" inside echo/grep string arguments;
 *   2. a looser \bpush\b segment scan matched `git commit -m "… pre-push …"`
 *      (hyphen is a word boundary), i.e. any commit message mentioning the gate.
 * So: split on shell separators, tokenize, skip git's own global flags, and
 * compare the resolved subcommand. Splitting is quote-naive — a quoted string
 * containing "&& git push" still trips the gate; accepted, it fails closed.
 *
 * @param {string} command - the Bash tool's command string
 * @returns {boolean}
 */
export function commandContainsGitPush(command) {
  return command.split(/[;&|\n]+/).some((segment) => {
    const tokens = segment.trim().replace(/^[({\s]+/, "").split(/\s+/);
    if (tokens[0] !== "git") return false;
    let i = 1;
    while (i < tokens.length) {
      const t = tokens[i];
      // Global flags that consume a value (git -C <path> push, git -c k=v push …)
      if (
        t === "-C" ||
        t === "-c" ||
        t === "--git-dir" ||
        t === "--work-tree" ||
        t === "--namespace"
      ) {
        i += 2;
        continue;
      }
      if (t.startsWith("-")) {
        i += 1;
        continue;
      }
      return t === "push";
    }
    return false;
  });
}

// ── Push target resolution ───────────────────────────────────────────────────

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
 * Finds the git repository root a `git push` command in `command` would
 * actually act against, starting from `cwd`. Walks segments in order,
 * tracking directory changes from `cd`; a `-C <path>` on the push segment
 * itself (git's own precedence) overrides the tracked directory for that
 * push. Returns the resolved `git rev-parse --show-toplevel` for the
 * directory the push runs in, or `null` if it can't be determined (not a
 * git repo, `cd` to a nonexistent path, etc.) — callers should treat `null`
 * as "assume it's this repo" (fail toward gating).
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {string | null}
 */
export function resolvePushTargetRepoRoot(command, cwd) {
  let dir = cwd;
  const segments = command.split(/[;&|\n]+/);

  for (const segment of segments) {
    const tokens = segment.trim().replace(/^[({\s]+/, "").split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    if (tokens[0] === "cd" && tokens[1]) {
      dir = resolveDir(dir, tokens[1]);
      continue;
    }

    if (tokens[0] === "git") {
      let pushDir = dir;
      let i = 1;
      let isPush = false;
      while (i < tokens.length) {
        const t = tokens[i];
        if (t === "-C" && tokens[i + 1]) {
          pushDir = resolveDir(dir, tokens[i + 1]);
          i += 2;
          continue;
        }
        if (t === "-c" || t === "--git-dir" || t === "--work-tree" || t === "--namespace") {
          i += 2;
          continue;
        }
        if (t.startsWith("-")) {
          i += 1;
          continue;
        }
        isPush = t === "push";
        break;
      }
      if (isPush) {
        try {
          return execFileSync("git", ["-C", pushDir, "rev-parse", "--show-toplevel"], {
            encoding: "utf8",
          }).trim();
        } catch {
          return null;
        }
      }
    }
  }
  return null;
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

  if (!commandContainsGitPush(command)) process.exit(0);

  // Only gate pushes that actually target THIS repo. `null` (undeterminable)
  // falls through to the existing gated path — conservative, matches
  // pre-existing behavior for presby's own pushes.
  const targetRoot = resolvePushTargetRepoRoot(command, payloadCwd);
  if (targetRoot !== null && path.resolve(targetRoot) !== REPO_ROOT) {
    process.exit(0);
  }

  let marker = null;
  try {
    marker = JSON.parse(readFileSync(MARKER_PATH, "utf8"));
  } catch {
    // missing or unreadable marker → block below
  }

  let head;
  try {
    head = currentHead();
  } catch {
    process.exit(0); // not a git repo / git unavailable — fail open
  }

  if (!marker?.head) {
    console.error(
      "BLOCKED (Workflow Rule 5): no pre-push marker found.\n" +
        "Run /pre-push first — a clean 'Ready to push: yes' summary stamps the marker\n" +
        "(node scripts/pre-push-gate.mjs --stamp). Then retry the push.",
    );
    process.exit(2);
  }

  if (marker.head !== head) {
    console.error(
      `BLOCKED (Workflow Rule 5): pre-push marker is stale.\n` +
        `Checks ran at ${marker.head.slice(0, 10)} but HEAD is now ${head.slice(0, 10)} — ` +
        `commits landed after verification.\nRe-run /pre-push, then retry the push.`,
    );
    process.exit(2);
  }

  process.exit(0);
}

// Only run as a hook/stamp when invoked directly (not imported by tests).
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("pre-push-gate.mjs");

if (isMain) {
  if (process.argv[2] === "--stamp") stamp();
  else hook();
}
