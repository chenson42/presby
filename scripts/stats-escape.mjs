#!/usr/bin/env node
/**
 * Escape-rate reporter. Reads the git log (30 days by default, or everything
 * since `--since`) and prints a breakdown of `fix:` commits by channel
 * (Caught-By) and discovery phase (Discovered-In).
 *
 * The "grandfather cutoff" (2026-05-18) is the date the commit-message
 * standard was introduced. Commits before that date are expected to have no
 * trailers; this script calls them out explicitly so the missing-trailer
 * count isn't mistaken for hook bypasses.
 *
 * `--since=<value>` (or `--since <value>`) replaces the 30-day window, which
 * double-counts against the 14-day retrospective cadence. Accepted values
 * (anything else is refused before git runs, and git is called with an
 * argument array, never a shell string):
 *   YYYY-MM-DD            a bare date means local midnight
 *   YYYY-MM-DD HH:MM[:SS] (a `T` may replace the space)
 *   "N days ago" / "N weeks ago" (N is 1-3 digits; day, days, week, weeks)
 * git's --since compares the COMMITTER date, so a rebased or amended commit
 * counts by when it was rewritten, not when it was first authored; the report
 * header therefore says "since <value>", never "authored since". The default
 * output (no flag) is unchanged. CLAUDE.md's "30-day" wording stays true for
 * the default.
 *
 * Usage: node scripts/stats-escape.mjs [--since=2026-10-10]
 *        npm run stats:escape [-- --since=2026-10-10]
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseTrailers } from "./commit-msg.mjs";

// ── Constants ────────────────────────────────────────────────────────────────

const GRANDFATHER_CUTOFF = "2026-05-18";

const CAUGHT_BY_VALUES = [
  "automated-test",
  "agent-review",
  "human-review",
  "production",
];

const DISCOVERED_IN_VALUES = [
  "Phase-1",
  "Phase-2",
  "Phase-3",
  "Phase-4",
  "Phase-5",
  "Phase-6",
  "post-merge",
  "production",
];

const FIX_PREFIX_RE = /^fix(\([^)]+\))?:/;

// ── --since ──────────────────────────────────────────────────────────────────

const DEFAULT_SINCE = "30 days ago";
const ABSOLUTE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const RELATIVE_RE = /^\d{1,3} (day|days|week|weeks) ago$/;

function sinceIsAllowed(value) {
  if (RELATIVE_RE.test(value)) return true;
  return ABSOLUTE_RE.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * Reads `--since` from argv (the part after the node/script entries).
 *
 * @param {string[]} argv
 * @returns {{ since: string | null } | { error: string }}
 */
export function parseSinceArg(argv) {
  let value = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") {
      value = argv[i + 1] ?? "";
      break;
    }
    if (a.startsWith("--since=")) {
      value = a.slice("--since=".length);
      break;
    }
  }
  if (value === null) return { since: null };
  if (!sinceIsAllowed(value)) {
    return {
      error: `stats-escape: --since expects YYYY-MM-DD, YYYY-MM-DD HH:MM, or "N days|weeks ago" (got "${value}").`,
    };
  }
  return { since: value };
}

/**
 * The git log argument vector: a single --since option, no shell involved.
 *
 * @param {string | null} since
 * @returns {string[]}
 */
export function gitLogArgs(since) {
  return ["log", `--since=${since ?? DEFAULT_SINCE}`, "--format=%H%n%s%n%b%n---END---"];
}

/**
 * Report title and the parenthesised tag after "(30d)"-style labels.
 *
 * @param {string | null} since
 * @returns {{ title: string; tag: string }}
 */
export function windowLabel(since) {
  if (since === null) return { title: "Escape-Rate Report — 30-day window", tag: "30d" };
  return { title: `Escape-Rate Report — since ${since}`, tag: `since ${since}` };
}

// ── Git log parsing ──────────────────────────────────────────────────────────

/**
 * Fetch commit entries from git log (default window, or since `since`).
 * Returns an array of { hash, subject, body } objects.
 *
 * @param {string | null} since
 * @returns {{ hash: string; subject: string; body: string }[]}
 */
function fetchCommits(since) {
  let raw;
  try {
    raw = execFileSync("git", gitLogArgs(since), { encoding: "utf8" });
  } catch {
    console.error("stats-escape: git log failed. Are you in a git repository?");
    process.exit(1);
  }

  const entries = raw.split("---END---");
  const commits = [];

  for (const entry of entries) {
    const lines = entry.split("\n").filter((l) => l !== "");
    if (lines.length < 2) continue;

    const hash = lines[0].trim();
    const subject = lines[1].trim();
    if (!hash || !subject) continue;

    const body = lines.slice(2).join("\n");
    commits.push({ hash, subject, body });
  }

  return commits;
}

// ── Stats accumulation ───────────────────────────────────────────────────────

export function computeStats(commits) {
  let totalCommits = 0;
  let totalFix = 0;
  let fixWithTrailers = 0;
  let fixMissingTrailers = 0;

  const caughtByCounts = Object.fromEntries(CAUGHT_BY_VALUES.map((k) => [k, 0]));
  const discoveredInCounts = Object.fromEntries(
    DISCOVERED_IN_VALUES.map((k) => [k, 0])
  );

  for (const { subject, body } of commits) {
    totalCommits++;

    if (!FIX_PREFIX_RE.test(subject)) continue;
    totalFix++;

    // Build a message string that parseTrailers can operate on
    const message = `${subject}\n\n${body}`;
    const trailers = parseTrailers(message);

    const caughtBy = trailers.get("Caught-By");
    const discoveredIn = trailers.get("Discovered-In");

    const hasValidCaughtBy = caughtBy && CAUGHT_BY_VALUES.includes(caughtBy);
    const hasValidDiscoveredIn =
      discoveredIn && DISCOVERED_IN_VALUES.includes(discoveredIn);

    if (hasValidCaughtBy && hasValidDiscoveredIn) {
      fixWithTrailers++;
      caughtByCounts[caughtBy]++;
      discoveredInCounts[discoveredIn]++;
    } else {
      fixMissingTrailers++;
    }
  }

  return {
    totalCommits,
    totalFix,
    fixWithTrailers,
    fixMissingTrailers,
    caughtByCounts,
    discoveredInCounts,
  };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function pct(count, total) {
  if (total === 0) return " (0%)";
  return ` (${Math.round((count / total) * 100)}%)`;
}

function padRight(str, width) {
  return str.padEnd(width);
}

function padLeft(str, width) {
  return String(str).padStart(width);
}

// ── Output ───────────────────────────────────────────────────────────────────

/** `label` then spaces to column `width`, always at least one space. */
function labelTo(label, width) {
  return label + " ".repeat(Math.max(1, width - label.length));
}

/**
 * The report as text. With no flag the output is byte-identical to the
 * pre-`--since` report (the retrospective copies it verbatim).
 *
 * @param {ReturnType<typeof computeStats>} stats
 * @param {{ title: string; tag: string }} label
 * @returns {string}
 */
export function formatReport(stats, label = windowLabel(null)) {
  const {
    totalCommits,
    totalFix,
    fixWithTrailers,
    fixMissingTrailers,
    caughtByCounts,
    discoveredInCounts,
  } = stats;
  const out = [];
  const log = (line = "") => out.push(line);
  const defaultWindow = label.tag === "30d";

  log(label.title);
  log(
    `Grandfather cutoff: ${GRANDFATHER_CUTOFF} (commits before this date lacked trailers by design)`
  );
  log("");
  log(`${labelTo(`Total commits (${label.tag}):`, 28)}${padLeft(totalCommits, 2)}`);
  log(`${labelTo(`fix: commits (${label.tag}):`, 29)}${padLeft(totalFix, 1)}`);
  log(`  With trailers:             ${padLeft(fixWithTrailers, 1)}`);
  log(
    `  Missing trailers (bypass): ${padLeft(fixMissingTrailers, 1)}   ← hook bypassed or pre-cutoff`
  );
  log("");

  if (fixWithTrailers === 0) {
    log(
      defaultWindow
        ? `Caught-By breakdown (no tagged fix: commits in the last 30 days)`
        : `Caught-By breakdown (no tagged fix: commits in this window)`
    );
    CAUGHT_BY_VALUES.forEach((k) => {
      log(`  ${padRight(k, 16)} ${padLeft(0, 1)}   (0%)`);
    });
    log("");
    log("Discovered-In breakdown:");
    DISCOVERED_IN_VALUES.forEach((k) => {
      log(`  ${padRight(k, 16)} ${padLeft(0, 1)}   (0%)`);
    });
    return out.join("\n");
  }

  log(
    `Caught-By breakdown (${fixWithTrailers} tagged fix: commit${fixWithTrailers === 1 ? "" : "s"}):`
  );
  CAUGHT_BY_VALUES.forEach((k) => {
    const count = caughtByCounts[k];
    log(`  ${padRight(k, 16)} ${padLeft(count, 1)}${pct(count, fixWithTrailers)}`);
  });
  log("");
  log("Discovered-In breakdown:");
  DISCOVERED_IN_VALUES.forEach((k) => {
    const count = discoveredInCounts[k];
    if (count > 0) {
      log(`  ${padRight(k, 16)} ${padLeft(count, 1)}${pct(count, fixWithTrailers)}`);
    }
  });
  return out.join("\n");
}

export function printReport(stats, label = windowLabel(null)) {
  console.log(formatReport(stats, label));
}

// ── Main ─────────────────────────────────────────────────────────────────────

// Run only when invoked directly (not imported by tests).
const invoked =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invoked) {
  const parsed = parseSinceArg(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(2);
  }
  const commits = fetchCommits(parsed.since);
  const stats = computeStats(commits);
  printReport(stats, windowLabel(parsed.since));
}
