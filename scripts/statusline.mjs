#!/usr/bin/env node
/**
 * Claude Code status line — what is running, and what is waiting for you.
 *
 * Renders one line, refreshed continuously by Claude Code:
 *
 *   presby ● main ✎3 │ ⚙ 2 agents · brand contract 4m · tooling 3m │ ✓ role admin design │ 📋 4 unread
 *
 * WHY THIS EXISTS. Subagents run in the background for minutes at a time and
 * the only way to know what is in flight was to ask. Now it is on screen.
 *
 * HOW LIVENESS IS DETERMINED, and its honest limit. Each subagent streams to
 * ~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl. A file
 * written to within LIVE_WINDOW_S is treated as running. That is a heuristic:
 * an agent thinking for longer than the window without emitting looks idle, and
 * one that finished a moment ago looks live. It is approximate on purpose —
 * approximate and always visible beats exact and only on request.
 *
 * WHAT THE LABEL IS. Claude Code writes agent-<id>.meta.json next to the
 * transcript with the `description` the orchestrator gave the Agent tool call
 * ("Implement c4 org brand emission") — that is what renders. It is a proper
 * label, not a heuristic: reading the transcript's opening prompt line instead
 * (the old approach) mostly produced "You are the ux-developer implementing…"
 * for every agent, since that is how every prompt in this repo's pipeline
 * starts — informative about the role, not about the work. Falls back to the
 * transcript-scraping heuristic only if meta.json is missing (an older Claude
 * Code version, or an agent spawned before this file existed).
 *
 * Reads session JSON on stdin (Claude Code supplies it). Never fails loudly:
 * any error prints the minimal segment, because a status line that throws is
 * worse than a status line that says less.
 *
 * FINISHED AGENTS, SHOWN UNTIL YOUR NEXT PROMPT. An agent whose transcript
 * has gone quiet (mtime older than LIVE_WINDOW_S) just vanished from this
 * line with no trace it ever ran — fine if you were watching, wrong if you
 * were away, since background agents are exactly the ones that finish while
 * you're away. `mark-user-prompt.mjs` (a `UserPromptSubmit` hook) stamps
 * `.claude/last-user-prompt.json` every time you submit a prompt from the
 * command line. A finished agent shows in a separate "✓ done" segment only
 * while its transcript's mtime is NEWER than that marker — i.e. it finished
 * after your last prompt, so you haven't seen it here yet. The next prompt
 * you submit moves the marker forward past that mtime, and the entry stops
 * appearing on the very next render — not on a timer, on your next command.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const LIVE_WINDOW_S = 90;
const REPO_ROOT = path_resolve_repo_root();
const LAST_PROMPT_MARKER = join(REPO_ROOT, ".claude", "last-user-prompt.json");

function path_resolve_repo_root() {
  // Mirrors pre-push-gate.mjs's own REPO_ROOT resolution (this file's parent
  // directory) — no new dependency for a one-line path join.
  const here = fileURLToPath(new URL(".", import.meta.url));
  return join(here, "..");
}

const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

const sh = (cmd, cwd) => {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

/** Human duration: 45s, 4m, 1h12m. */
function ago(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/** The current epoch-seconds value of the last-user-prompt marker, or 0 if
 * it doesn't exist yet (a fresh session, or the hook hasn't fired once) — 0
 * means "never seen anything," so no finished agent is treated as already
 * seen, which is the safe default (show it rather than hide it wrongly). */
function lastPromptAt() {
  const raw = read(LAST_PROMPT_MARKER);
  if (!raw) return 0;
  try {
    return Number(JSON.parse(raw)?.at) || 0;
  } catch {
    return 0;
  }
}

/**
 * Every subagent transcript in this session, newest first, each carrying
 * enough to classify as running (mtime within LIVE_WINDOW_S) or finished
 * (older) by the caller — one directory read serving both status-line
 * segments instead of two.
 *
 * The description is pulled from the agent's own meta.json rather than
 * tracked separately — derived, so it cannot drift from what is actually
 * running.
 */
function collectAgents(sessionId, projectDir) {
  if (!sessionId || !projectDir) return [];
  const dir = join(
    homedir(),
    ".claude",
    "projects",
    projectDir,
    sessionId,
    "subagents",
  );
  if (!existsSync(dir)) return [];

  const now = Date.now() / 1000;
  const out = [];

  for (const name of readdirSync(dir)) {
    if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    const mtimeS = st.mtimeMs / 1000;
    const idle = now - mtimeS;

    // Prefer meta.json's own `description` — the short label the orchestrator
    // gave this agent when spawning it. Only fall back to scraping the
    // transcript's opening prompt line if meta.json is missing or unreadable.
    const metaPath = path.replace(/\.jsonl$/, ".meta.json");
    const metaRaw = read(metaPath);
    let desc = null;
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw);
        if (meta?.description) desc = String(meta.description).slice(0, 40);
      } catch {
        /* fall through to the transcript heuristic below */
      }
    }

    if (!desc) {
      const head = read(path)?.slice(0, 1500) ?? "";
      const raw = head.match(/"content"\s*:\s*"([^"\\]{1,90})/)?.[1] ?? "";
      const cleaned = raw
        .replace(/[*`#]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      desc = cleaned
        ? cleaned.slice(0, 34).replace(/\s+\S*$/, "")
        : basename(name, ".jsonl").slice(6, 14);
    }

    out.push({
      desc,
      idle,
      mtimeS,
      age: Math.floor(now - st.birthtimeMs / 1000),
    });
  }
  return out.sort((a, b) => b.age - a.age);
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    /* no stdin — render what we can */
  }

  const cwd = input?.workspace?.current_dir ?? input?.cwd ?? process.cwd();
  const sessionId = input?.session_id;
  const projectDir = cwd ? cwd.replace(/\//g, "-") : null;

  const segments = [];

  // 1. Where am I
  const branch = sh("git rev-parse --abbrev-ref HEAD", cwd);
  const dirty = sh("git status --porcelain", cwd).split("\n").filter(Boolean).length;
  const repo = basename(cwd || "");
  segments.push(
    `${repo}${branch ? ` ● ${branch}` : ""}${dirty ? ` ✎${dirty}` : ""}`,
  );

  // 2. What is running, and what just finished while I wasn't looking
  const all = collectAgents(sessionId, projectDir);
  const running = all.filter((a) => a.idle <= LIVE_WINDOW_S);
  const promptAt = lastPromptAt();
  // "Finished" = gone quiet, AND finished after the last prompt I submitted —
  // otherwise I already saw it end on some earlier render of this same line.
  const finished = all.filter(
    (a) => a.idle > LIVE_WINDOW_S && a.mtimeS > promptAt,
  );

  if (running.length) {
    const shown = running
      .slice(0, 2)
      .map((a) => `${a.desc} ${ago(a.age)}`)
      .join(" · ");
    const more = running.length > 2 ? ` +${running.length - 2}` : "";
    segments.push(
      `⚙ ${running.length} agent${running.length === 1 ? "" : "s"} · ${shown}${more}`,
    );
  }
  if (finished.length) {
    const shown = finished
      .slice(0, 2)
      .map((a) => a.desc)
      .join(" · ");
    const more = finished.length > 2 ? ` +${finished.length - 2}` : "";
    segments.push(`✓ ${shown}${more}`);
  }

  // 3. What is waiting for me
  const briefings = read(join(cwd, "docs", "briefings.md"));
  if (briefings) {
    const unread = (briefings.match(/^- \[ \]/gm) ?? []).length;
    if (unread) segments.push(`\u{1F4CB} ${unread} unread`);
  }

  console.log(segments.join(" │ "));
}

try {
  main();
} catch {
  console.log(basename(process.cwd()));
}
