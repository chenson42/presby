#!/usr/bin/env node
/**
 * UserPromptSubmit hook — stamps the moment the operator last typed something
 * from the command line, so `statusline.mjs` knows when a "finished" agent
 * has actually been seen and can stop showing it.
 *
 * WHY THIS EXISTS. Background agents finish while the operator is away from
 * the keyboard (per this session's own "keep going, notify only if blocked"
 * pattern). `statusline.mjs` already infers "running" from an agent
 * transcript's mtime being recent; once an agent goes quiet it just vanishes
 * from the line, with nothing marking that it finished at all. The operator
 * asked for finished work to stay visible until their NEXT command-line
 * interaction, then clear — which requires knowing when that interaction
 * happened, not just how long ago an agent went idle.
 *
 * Writes `.claude/last-user-prompt.json` (gitignored, per-machine — same
 * pattern as `pre-push-gate.mjs`'s marker) holding the current epoch seconds.
 * `statusline.mjs` shows a finished agent (mtime older than the running
 * window) only while its mtime is NEWER than this marker — i.e. it finished
 * after the operator's last prompt, so they haven't seen it yet. The next
 * prompt submission moves the marker forward past that mtime, and the
 * finished entry stops appearing on the turn after this hook fires.
 *
 * Fails silently (never blocks a prompt) — a status-line convenience must
 * never be able to break the actual session.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MARKER_PATH = path.join(REPO_ROOT, ".claude", "last-user-prompt.json");

try {
  mkdirSync(path.dirname(MARKER_PATH), { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify({ at: Date.now() / 1000 }));
} catch {
  // A marker write failing must never block the prompt it's timestamping.
}
