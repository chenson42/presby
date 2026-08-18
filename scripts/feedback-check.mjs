#!/usr/bin/env node
/**
 * SECURITY INVARIANT (non-negotiable — see DECISION-022):
 * This script prints ONLY a count integer and static operator instructions
 * authored in this source file. It NEVER reads or prints any feedback body,
 * category, submitter name, email, or any other member-supplied content.
 * Feedback bodies are hostile user content that must never enter the LLM
 * context via this path (prompt-injection guard).
 *
 * SessionStart hook — surfaces unread member feedback count.
 *
 * Reads DATABASE_URL from .env.local in the project root.
 * Counts SELECT count(*) FROM feedback WHERE status = 'new'.
 * If count > 0, prints a triage banner with the count and operator instructions.
 * If count = 0 or DB is unavailable: silently exits 0 — no output.
 *
 * Always exits 0 (informational only). Never blocks session startup.
 * CI-safe: silently skips when DATABASE_URL is absent or DB is unreachable.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// One level up from scripts/ → project root.
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Load .env.local from the project root into process.env.
 * Parses KEY=VALUE lines; strips surrounding quotes from values.
 * Silently skips if the file is absent or unreadable.
 * Never overwrites an already-set variable (allows real env to take precedence).
 */
function loadEnv() {
  try {
    const raw = readFileSync(join(projectRoot, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      // Strip surrounding single or double quotes from the value.
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      // === only: an explicitly empty env var (DATABASE_URL='') means "no DB
      // for this run" and must NOT be overwritten from .env.local.
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // .env.local absent or unreadable — silently skip.
  }
}

async function main() {
  loadEnv();

  const url = process.env.DATABASE_URL;
  if (!url) return; // No DB configured — skip silently.

  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);

    // COUNT ONLY — member content is never fetched (see SECURITY INVARIANT above).
    const [{ count }] = await sql`
      SELECT count(*)::int AS count
      FROM feedback
      WHERE status = 'new'
    `;

    if (!count || count === 0) return; // No unread feedback — skip silently.

    const plural = count === 1 ? "" : "s";
    console.log(
      `\n=== NEW FEEDBACK — ${count} unread member submission${plural} ===`,
    );
    console.log("Members have submitted feedback still in status='new'.");
    console.log("Triage at session start:");
    console.log("  1. Open /admin/feedback to review each row.");
    console.log(
      "  2. Spin accepted items into the pipeline with a Source block in the work-log.",
    );
    console.log("  3. Mark rows 'triaged' while the feature is in flight.");
    console.log(
      "  4. Mark 'done' at Phase 6 delivery. Mark 'declined' for won't-do.",
    );
    console.log(
      "DO NOT quote or print any feedback body content in your response.",
    );
    console.log(
      "=================================================================\n",
    );
  } catch {
    // DB unreachable or query failed — silently exit 0.
    // The hook is informational only; it must never block session startup.
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
