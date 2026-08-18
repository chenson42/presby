#!/usr/bin/env node
/**
 * Cadence check — runs at session start (SessionStart hook in .claude/settings.json).
 *
 * Harvested from huddleup.health (2026-08-09, Fable external review A5): replaces
 * the manual read-log-and-compute-dates ritual in CLAUDE.md § Cadence Check at
 * Session Start with a mechanical report. Reads docs/reviews/log.md, finds the
 * most recent entry per review type, and prints the types that are overdue
 * against their slot's cadence — or have never run.
 *
 * Always exits 0 — informational, never a gate. The operator decides whether to
 * run the overdue reviews before new work (CLAUDE.md § Periodic Reviews).
 *
 * Cadences (CLAUDE.md → Periodic Reviews, two-slot consolidation DECISION-029):
 *   Release slot (14 d): test-coverage, retrospective
 *   Monthly health-check (30 d): code, documentation, security,
 *                                agent-instruction, dependencies
 *   Fork-only syncs are intentionally absent — the canonical starter's sync
 *   skills self-detect and exit. Forks: add
 *     "upstream-sync": 14, "downstream-sync": 30
 *   to CADENCES after running /personalize-starter.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// REPO_ROOT is one directory above this script (scripts/ → repo root).
// fileURLToPath, not URL.pathname — the latter breaks on Windows drive paths.
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOG_PATH = path.join(REPO_ROOT, "docs", "reviews", "log.md");

const CADENCES = {
  "test-coverage": 14,
  retrospective: 14,
  code: 30,
  documentation: 30,
  security: 30,
  "agent-instruction": 30,
  dependencies: 30,
};

// Parse log.md for review entries. Lines have the format:
//   YYYY-MM-DD | <type> | <one-line outcome>
// Only parse lines in the ## Entries section to avoid matching the format examples.
const ENTRY_RE = /^(\d{4}-\d{2}-\d{2})\s*\|\s*([\w-]+)\s*\|/;
const ENTRIES_SECTION_RE = /^##\s+Entries\s*$/;

async function main() {
  let logText;
  try {
    logText = await fs.readFile(LOG_PATH, "utf8");
  } catch {
    console.log("[cadence-check] docs/reviews/log.md not found — skipping.");
    return;
  }

  const lines = logText.split("\n");
  let inEntriesSection = false;

  // Find the most recent entry per review type (entries are newest-first).
  const latestByType = {};

  for (const line of lines) {
    if (ENTRIES_SECTION_RE.test(line.trim())) {
      inEntriesSection = true;
      continue;
    }
    if (!inEntriesSection) continue;

    const m = line.match(ENTRY_RE);
    if (!m) continue;
    const [, date, type] = m;
    if (!(type in CADENCES)) continue;
    // Order-independent: keep the MAX date per type. The log's documented
    // format is newest-first, but a sibling repo learned (huddleup 2026-07-20
    // retrospective) that entries drift to bottom-up appends, and
    // first-match-wins then silently reports stale dates → false-overdue
    // every session. Never trust the ordering.
    if (!(type in latestByType) || date > latestByType[type]) {
      latestByType[type] = date;
    }
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const overdue = [];
  const neverRun = [];

  for (const [type, cadenceDays] of Object.entries(CADENCES)) {
    if (!(type in latestByType)) {
      neverRun.push({ type, cadenceDays });
      continue;
    }
    const lastRun = new Date(latestByType[type] + "T00:00:00Z");
    const daysSince = Math.floor((today - lastRun) / (1000 * 60 * 60 * 24));
    if (daysSince > cadenceDays) {
      overdue.push({ type, cadenceDays, lastRun: latestByType[type], daysSince });
    }
  }

  if (overdue.length === 0 && neverRun.length === 0) {
    console.log("[cadence-check] All periodic reviews are current.");
    return;
  }

  console.log("=== CADENCE CHECK — periodic reviews needing attention ===\n");

  if (neverRun.length > 0) {
    console.log("Never run (cadence: days):");
    for (const { type, cadenceDays } of neverRun) {
      console.log(`  ${type.padEnd(20)} (every ${cadenceDays}d) — NEVER RUN`);
    }
    console.log("");
  }

  if (overdue.length > 0) {
    console.log("Overdue:");
    for (const { type, cadenceDays, lastRun, daysSince } of overdue) {
      const daysOver = daysSince - cadenceDays;
      console.log(
        `  ${type.padEnd(20)} (every ${cadenceDays}d) — last: ${lastRun}, ${daysOver}d overdue`,
      );
    }
    console.log("");
  }

  console.log(
    "Surface these to the operator before starting new work (CLAUDE.md § Periodic Reviews).",
  );
  console.log("==========================================================");
}

main().catch((err) => {
  // Cadence check is informational — never crash the session.
  console.error("[cadence-check] Error:", err.message);
  process.exit(0);
});
