#!/usr/bin/env node
/**
 * SessionStart hook — unread operator briefings, and a staleness detector.
 *
 * TWO JOBS, and the second is the one that matters.
 *
 * 1. Count unread entries in docs/briefings.md and print them. An entry is
 *    unread while its checkbox is `- [ ]`; the operator ticks it to `- [x]`.
 *    Same convention as docs/TODO.md, so there is nothing new to learn.
 *
 * 2. Detect that the file has gone STALE. This is the whole point. A
 *    hand-written digest rots — this repo has watched it happen to
 *    docs/database-schema.md in sibling projects, to the invariants array in
 *    src/lib/dev-docs.ts, and it is why Workflow Rule 14 exists at all.
 *
 *    Briefings are prose and cannot be derived. But staleness CAN be measured,
 *    by comparing the file against two artifacts that cannot drift:
 *
 *      - docs/decisions.md   every DECISION-NNN is numbered and permanent
 *      - git log             every feat:/fix: commit is a fact
 *
 *    If a decision has been recorded or a feature or fix has shipped since the
 *    newest briefing entry, the digest is behind and this says so with numbers.
 *    That converts "remember to write it up" from discipline into a signal.
 *
 * Always exits 0. Informational only; never blocks session startup.
 * Silent when there is nothing unread and nothing missing.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRIEFINGS = join(projectRoot, "docs", "briefings.md");
const DECISIONS = join(projectRoot, "docs", "decisions.md");

/** Highest DECISION-NNN recorded in the decisions log. */
function highestDecision(text) {
  const nums = [...text.matchAll(/^## DECISION-(\d+):/gm)].map((m) =>
    Number(m[1]),
  );
  return nums.length ? Math.max(...nums) : 0;
}

/**
 * The newest briefing's `covers:` marker — the decision number and commit the
 * digest was last brought up to date against. Kept as an HTML comment so it
 * renders as nothing and cannot be mistaken for content.
 */
function readCoverage(text) {
  const m = text.match(/<!--\s*covers:\s*decision=(\d+)\s+commit=([0-9a-f]{7,40})\s*-->/);
  return m ? { decision: Number(m[1]), commit: m[2] } : null;
}

function shippedSince(commit) {
  try {
    const out = execSync(
      `git log ${commit}..HEAD --oneline --format=%s -- . 2>/dev/null`,
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .filter((l) => /^(feat|fix)(\(|:)/.test(l.trim()))
      .length;
  } catch {
    // Unknown commit (history rewritten, shallow clone, fresh fork) — not an
    // error worth shouting about at session start.
    return null;
  }
}

function main() {
  if (!existsSync(BRIEFINGS)) return;
  const text = readFileSync(BRIEFINGS, "utf8");

  const unread = (text.match(/^- \[ \]/gm) ?? []).length;
  const lines = [];

  if (unread > 0) {
    lines.push(
      `${unread} unread briefing${unread === 1 ? "" : "s"} — docs/briefings.md`,
    );
  }

  // Staleness: has anything happened since the digest was last updated?
  const coverage = readCoverage(text);
  if (coverage) {
    const stale = [];

    if (existsSync(DECISIONS)) {
      const latest = highestDecision(readFileSync(DECISIONS, "utf8"));
      const behind = latest - coverage.decision;
      if (behind > 0) {
        stale.push(
          `${behind} decision${behind === 1 ? "" : "s"} (through DECISION-${String(latest).padStart(3, "0")})`,
        );
      }
    }

    const commits = shippedSince(coverage.commit);
    if (commits && commits > 0) {
      stale.push(`${commits} feat/fix commit${commits === 1 ? "" : "s"}`);
    }

    if (stale.length) {
      lines.push(
        `briefings are BEHIND by ${stale.join(" and ")} — write them up, then move the covers: marker`,
      );
    }
  } else {
    lines.push(
      "briefings.md has no covers: marker — staleness cannot be measured",
    );
  }

  if (!lines.length) return;

  console.log("=== OPERATOR BRIEFINGS ===");
  for (const l of lines) console.log(`  ${l}`);
  console.log("==========================");
}

main();
