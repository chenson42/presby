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
 *    If a decision has been recorded that the digest does not name, or a
 *    feature or fix has shipped since the marker commit, the digest is behind
 *    and this says so with numbers. That converts "remember to write it up"
 *    from discipline into a signal.
 *
 *    The decision half counts recorded DECISION numbers ABOVE the marker that
 *    briefings.md does NOT name (`DECISION-0*N`, or inside a range written
 *    `DECISION-215–219`, `DECISION-215-219` or `DECISION-215 to DECISION-219`).
 *    It is deliberately not `max - marker`: numbers are pre-assigned out of
 *    order (Workflow Rule 16) and some are never assigned, so a high-water
 *    mark overcounts the gaps and goes blind to a late-landing number below
 *    the highest one. The marker stays at the contiguous floor. A number
 *    mentioned in passing silences it (accepted): the check measures naming,
 *    not prose.
 *
 * Always exits 0. Informational only; never blocks session startup.
 * Silent when there is nothing unread and nothing missing.
 */
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRIEFINGS = join(projectRoot, "docs", "briefings.md");
const DECISIONS = join(projectRoot, "docs", "decisions.md");

/** Widest `DECISION-A–B` range read as a range; wider is a date or a typo. */
const MAX_RANGE = 60;

/**
 * Distinct DECISION numbers recorded in the decisions log, sorted.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function recordedDecisions(text) {
  // Two heading styles coexist: `## DECISION-NNN:` (through 121) and the
  // bold paragraph `**DECISION-NNN` (122 onward). Count both, or the
  // decision half of the staleness signal goes silent.
  const nums = [...text.matchAll(/^(?:## |\*\*)DECISION-(\d+)/gm)].map((m) =>
    Number(m[1]),
  );
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * Every DECISION number the briefings text names, ranges expanded inclusively.
 * A reversed range or one wider than MAX_RANGE expands to nothing (only its
 * first endpoint, and its second when written with its own `DECISION-`, count).
 *
 * @param {string} text
 * @returns {Set<number>}
 */
export function namedDecisions(text) {
  const named = new Set();
  const re = /DECISION-0*(\d+)(?:\s*(?:–|-|to)\s*(DECISION-)?0*(\d+))?/g;
  for (const m of text.matchAll(re)) {
    const first = Number(m[1]);
    named.add(first);
    if (m[3] === undefined) continue;
    const second = Number(m[3]);
    if (second >= first && second - first <= MAX_RANGE) {
      for (let n = first; n <= second; n++) named.add(n);
    } else if (m[2] !== undefined) {
      named.add(second);
    }
  }
  return named;
}

/**
 * Recorded numbers above the marker's floor that no entry names.
 *
 * @param {number[]} recorded
 * @param {Set<number>} named
 * @param {number} floor
 * @returns {number[]}
 */
export function unnamedAboveFloor(recorded, named, floor) {
  return recorded.filter((n) => n > floor && !named.has(n));
}

/**
 * The behind-line for the session banner, or null when nothing is behind.
 *
 * @param {number[]} unnamed - sorted unnamed decision numbers
 * @param {number | null} commits - feat/fix commits since the marker commit
 * @returns {string | null}
 */
export function renderBehindLine(unnamed, commits) {
  const parts = [];
  const pad = (n) => `DECISION-${String(n).padStart(3, "0")}`;
  if (unnamed.length > 0) {
    const n = unnamed.length;
    parts.push(
      n <= 5
        ? `${n} decision${n === 1 ? "" : "s"} not yet named (${unnamed.map(pad).join(", ")})`
        : `${n} decisions not yet named (newest ${pad(unnamed[n - 1])})`,
    );
  }
  if (commits && commits > 0) {
    parts.push(`${commits} feat/fix commit${commits === 1 ? "" : "s"}`);
  }
  if (!parts.length) return null;
  return `briefings are BEHIND by ${parts.join(" and ")} — write them up and name each DECISION in an entry, then move the covers: marker`;
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
    const out = execFileSync(
      "git",
      ["log", `${commit}..HEAD`, "--format=%s", "--", "."],
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
    const unnamed = existsSync(DECISIONS)
      ? unnamedAboveFloor(
          recordedDecisions(readFileSync(DECISIONS, "utf8")),
          namedDecisions(text),
          coverage.decision,
        )
      : [];
    const behind = renderBehindLine(unnamed, shippedSince(coverage.commit));
    if (behind) lines.push(behind);
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

// Run only when invoked directly (not imported by tests).
const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) main();
