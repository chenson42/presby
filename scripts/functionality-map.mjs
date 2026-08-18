#!/usr/bin/env node
/**
 * Functionality-map check — runs at session start (SessionStart hook in
 * .claude/settings.json). Prints the SHORT INDEX from
 * docs/product/functionality-map.md so every session starts already knowing
 * (at a glance) what functionality exists, without re-reconning the codebase.
 *
 * Companion to scripts/feedback-check.mjs. Harvested from the huddleup.health
 * fork (2026-07-12).
 *
 * It prints ONLY the short "## Index (short — for the session hook)" block
 * (from that heading up to the next `## ` heading) — the full map lives in the
 * doc and is read on demand (per the CLAUDE.md required-read rule). Keeping the
 * hook to the short index means the map can grow without bloating every session.
 *
 * Always exits 0 — informational, never a gate. Silently skips if the map is
 * missing (e.g. a fresh clone before the doc is written).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const MAP_PATH = path.join(REPO_ROOT, "docs", "product", "functionality-map.md");

async function main() {
  let text;
  try {
    text = await fs.readFile(MAP_PATH, "utf8");
  } catch {
    return; // no map yet — skip silently
  }

  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => /^##\s+Index \(short/i.test(l));
  if (startIdx === -1) return; // no short-index block — skip

  // Collect from the Index heading up to (but not including) the next `## ` heading.
  const block = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    block.push(lines[i]);
  }

  const body = block
    .join("\n")
    .trim()
    .replace(/\n?-{3,}\s*$/, ""); // drop a trailing horizontal rule
  if (!body) return;

  process.stdout.write(
    "=== FUNCTIONALITY MAP (what already exists — full map: docs/product/functionality-map.md) ===\n" +
      body +
      "\n" +
      "(Read the full map before proposing/scoping a feature, so you don't rebuild what exists. Update it at ship time — Workflow Rule 14.)\n" +
      "==============================================================================================\n",
  );
}

main().catch(() => {
  /* never gate a session on this */
});
