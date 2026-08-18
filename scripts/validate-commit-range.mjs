#!/usr/bin/env node
/**
 * CI-side commit-grammar validation. The commit-msg git hook (scripts/commit-msg.mjs)
 * only runs where `npm install` has installed it — GitHub web edits, fresh clones
 * pre-install, and any hookless environment bypass it silently, and stats:escape
 * only detects that after the fact. This script closes the gap by validating every
 * commit in a range with the same exported validator the hook uses.
 *
 * Usage: node scripts/validate-commit-range.mjs "<rev-range>"
 *   e.g. node scripts/validate-commit-range.mjs "origin/main..HEAD"
 *
 * Exits 0 when every commit in the range passes, 1 otherwise (listing failures).
 */
import { execFileSync } from "node:child_process";
import { validateCommitMessage } from "./commit-msg.mjs";

const range = process.argv[2];
if (!range) {
  console.error('Usage: node scripts/validate-commit-range.mjs "<rev-range>"');
  process.exit(1);
}

// %H = hash; %B = raw body. Null-delimit records so multi-line messages parse safely.
const raw = execFileSync(
  "git",
  ["log", "--format=%H%n%B%x00", "--no-merges", range],
  { encoding: "utf8" },
);

const records = raw.split("\0").map((r) => r.trim()).filter(Boolean);
const failures = [];

for (const record of records) {
  const newline = record.indexOf("\n");
  const hash = (newline === -1 ? record : record.slice(0, newline)).trim();
  const message = newline === -1 ? "" : record.slice(newline + 1);
  const result = validateCommitMessage(message);
  if (!result.ok) {
    failures.push({ hash, error: result.error, subject: message.split("\n")[0] });
  }
}

if (failures.length === 0) {
  console.log(`commit-grammar: ${records.length} commit(s) in ${range} — all valid.`);
  process.exit(0);
}

console.error(`commit-grammar: ${failures.length} of ${records.length} commit(s) failed:\n`);
for (const { hash, subject, error } of failures) {
  console.error(`✗ ${hash.slice(0, 10)} ${subject}`);
  console.error(`  ${error.split("\n").join("\n  ")}\n`);
}
process.exit(1);
