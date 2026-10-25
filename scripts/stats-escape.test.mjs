/**
 * Unit tests for `stats:escape --since`. The default report must stay
 * byte-identical (the retrospective copies it verbatim; the two golden
 * strings below were captured from the pre-`--since` script on the same
 * fixed stats), the flag's value is allowlisted before git runs, and git is
 * called with an argument array, never a shell string.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSinceArg, gitLogArgs, windowLabel, formatReport } from "./stats-escape.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "stats-escape.mjs");

const STATS = {
  totalCommits: 40,
  totalFix: 5,
  fixWithTrailers: 4,
  fixMissingTrailers: 1,
  caughtByCounts: { "automated-test": 1, "agent-review": 2, "human-review": 1, production: 0 },
  discoveredInCounts: {
    "Phase-1": 0, "Phase-2": 0, "Phase-3": 0, "Phase-4": 1, "Phase-5": 1, "Phase-6": 0,
    "post-merge": 2, production: 0,
  },
};
const EMPTY = { ...STATS, fixWithTrailers: 0, fixMissingTrailers: 5 };

const GOLDEN_TAGGED = "Escape-Rate Report — 30-day window\nGrandfather cutoff: 2026-05-18 (commits before this date lacked trailers by design)\n\nTotal commits (30d):        40\nfix: commits (30d):          5\n  With trailers:             4\n  Missing trailers (bypass): 1   ← hook bypassed or pre-cutoff\n\nCaught-By breakdown (4 tagged fix: commits):\n  automated-test   1 (25%)\n  agent-review     2 (50%)\n  human-review     1 (25%)\n  production       0 (0%)\n\nDiscovered-In breakdown:\n  Phase-4          1 (25%)\n  Phase-5          1 (25%)\n  post-merge       2 (50%)\n";
const GOLDEN_EMPTY = "Escape-Rate Report — 30-day window\nGrandfather cutoff: 2026-05-18 (commits before this date lacked trailers by design)\n\nTotal commits (30d):        40\nfix: commits (30d):          5\n  With trailers:             0\n  Missing trailers (bypass): 5   ← hook bypassed or pre-cutoff\n\nCaught-By breakdown (no tagged fix: commits in the last 30 days)\n  automated-test   0   (0%)\n  agent-review     0   (0%)\n  human-review     0   (0%)\n  production       0   (0%)\n\nDiscovered-In breakdown:\n  Phase-1          0   (0%)\n  Phase-2          0   (0%)\n  Phase-3          0   (0%)\n  Phase-4          0   (0%)\n  Phase-5          0   (0%)\n  Phase-6          0   (0%)\n  post-merge       0   (0%)\n  production       0   (0%)\n";

describe("parseSinceArg", () => {
  it("no flag means no override", () => {
    expect(parseSinceArg([])).toEqual({ since: null });
    expect(parseSinceArg(["--other"])).toEqual({ since: null });
  });

  it.each([
    ["--since=2026-10-10", "2026-10-10"],
    ["--since=2026-10-10 14:30", "2026-10-10 14:30"],
    ["--since=2026-10-10T14:30:05", "2026-10-10T14:30:05"],
    ["--since=14 days ago", "14 days ago"],
    ["--since=2 weeks ago", "2 weeks ago"],
    ["--since=1 day ago", "1 day ago"],
  ])("accepts %s", (arg, value) => {
    expect(parseSinceArg([arg])).toEqual({ since: value });
  });

  it("accepts the two-token form", () => {
    expect(parseSinceArg(["--since", "2026-10-10"])).toEqual({ since: "2026-10-10" });
  });

  it.each([
    "2026-01-01; rm -rf x",
    "--output=x",
    "$(x)",
    "2026-13-45",
    "1000 days ago",
    "",
    "yesterday",
    "2026-01-01 && git push",
    "-1 days ago",
  ])("refuses %j with the copy-table error", (value) => {
    const r = parseSinceArg([`--since=${value}`]);
    expect(r).toEqual({
      error: `stats-escape: --since expects YYYY-MM-DD, YYYY-MM-DD HH:MM, or "N days|weeks ago" (got "${value}").`,
    });
  });

  it("refuses a bare --since with no value", () => {
    expect("error" in parseSinceArg(["--since"])).toBe(true);
  });
});

describe("gitLogArgs", () => {
  it("is an array with exactly one --since option", () => {
    const args = gitLogArgs("2026-10-10");
    expect(Array.isArray(args)).toBe(true);
    expect(args.filter((a) => a.startsWith("--since="))).toEqual(["--since=2026-10-10"]);
  });

  it("defaults to 30 days ago", () => {
    expect(gitLogArgs(null)).toContain("--since=30 days ago");
  });

  it("keeps a hostile-looking value inside the single option element", () => {
    // Never reachable through parseSinceArg; pins that no splitting happens here either.
    expect(gitLogArgs("x --output=y").filter((a) => a.startsWith("--"))).toEqual([
      "--since=x --output=y",
      "--format=%H%n%s%n%b%n---END---",
    ]);
  });
});

describe("report text", () => {
  it("default output is byte-identical to the pre-flag report", () => {
    expect(formatReport(STATS, windowLabel(null)) + "\n").toBe(GOLDEN_TAGGED);
    expect(formatReport(EMPTY, windowLabel(null)) + "\n").toBe(GOLDEN_EMPTY);
  });

  it("the flagged report carries 'since <value>' and no 30d", () => {
    const text = formatReport(STATS, windowLabel("2026-09-25"));
    expect(text).toContain("Escape-Rate Report — since 2026-09-25");
    expect(text).toContain("Total commits (since 2026-09-25):");
    expect(text).toContain("fix: commits (since 2026-09-25):");
    expect(text).not.toContain("30d");
    expect(text).not.toContain("30-day");
  });

  it("the flagged empty case says 'in this window'", () => {
    const text = formatReport(EMPTY, windowLabel("2026-09-25"));
    expect(text).toContain("(no tagged fix: commits in this window)");
    expect(text).not.toContain("last 30 days");
  });
});

describe("cli", () => {
  it("refuses a bad --since with exit 2 before running git", () => {
    const r = spawnSync("node", [SCRIPT, "--since=2026-01-01; echo pwned"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("stats-escape: --since expects");
    expect(r.stdout).toBe("");
  });

  it("prints the flagged header for a valid --since", () => {
    const r = spawnSync("node", [SCRIPT, "--since=2026-01-01"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Escape-Rate Report — since 2026-01-01");
  });
});
