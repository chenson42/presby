#!/usr/bin/env node
/**
 * Claude Code status line — what is running, and what is waiting for you.
 *
 * Renders one line, refreshed continuously by Claude Code:
 *
 *   presby ● main ✎3 │ ⚙ 2 agents · brand contract 4m · tooling 3m │ 📋 4 unread
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
 * Reads session JSON on stdin (Claude Code supplies it). Never fails loudly:
 * any error prints the minimal segment, because a status line that throws is
 * worse than a status line that says less.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const LIVE_WINDOW_S = 90;

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

/**
 * Running subagents, newest first.
 *
 * The description is pulled from the agent's own transcript rather than tracked
 * separately — derived, so it cannot drift from what is actually running.
 */
function runningAgents(sessionId, projectDir) {
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
    const idle = now - st.mtimeMs / 1000;
    if (idle > LIVE_WINDOW_S) continue;

    // The label is derived from the agent's own opening prompt — the first
    // line of its transcript. Nothing is tracked alongside, so the label can
    // never disagree with what is actually running.
    const head = read(path)?.slice(0, 1500) ?? "";
    const raw = head.match(/"content"\s*:\s*"([^"\\]{1,90})/)?.[1] ?? "";
    const cleaned = raw
      .replace(/[*`#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const desc = cleaned
      ? cleaned.slice(0, 34).replace(/\s+\S*$/, "")
      : basename(name, ".jsonl").slice(6, 14);

    out.push({ desc, age: Math.floor(now - st.birthtimeMs / 1000) });
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

  // 2. What is running
  const agents = runningAgents(sessionId, projectDir);
  if (agents.length) {
    const shown = agents
      .slice(0, 2)
      .map((a) => `${a.desc} ${ago(a.age)}`)
      .join(" · ");
    const more = agents.length > 2 ? ` +${agents.length - 2}` : "";
    segments.push(
      `⚙ ${agents.length} agent${agents.length === 1 ? "" : "s"} · ${shown}${more}`,
    );
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
