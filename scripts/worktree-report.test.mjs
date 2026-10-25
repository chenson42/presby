/**
 * Unit tests for the report-only disk and worktree script. It prints and
 * deletes nothing; the tests pin the parsing, the quoting of the suggested
 * commands, the merged / not-merged split, the 20 GiB line, and that the main
 * checkout never gets a removal suggestion.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import {
  parseWorktreePorcelain,
  shellQuote,
  removalSuggestions,
  formatReport,
  LOW_DISK_GIB,
} from "./worktree-report.mjs";

const PORCELAIN = [
  "worktree /w/presby",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree /w/presby-wf",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/pipeline/retro-workflow-efficiency",
  "",
  "worktree /w/presby detached",
  "HEAD 3333333333333333333333333333333333333333",
  "detached",
  "",
  "worktree /w/bare.git",
  "bare",
  "",
].join("\n");

describe("parseWorktreePorcelain", () => {
  const entries = parseWorktreePorcelain(PORCELAIN);

  it("reads every entry, the first being the main checkout", () => {
    expect(entries.map((e) => e.path)).toEqual(["/w/presby", "/w/presby-wf", "/w/presby detached", "/w/bare.git"]);
    expect(entries[0].isMain).toBe(true);
    expect(entries.slice(1).every((e) => !e.isMain)).toBe(true);
  });

  it("strips refs/heads/ from a branch", () => {
    expect(entries[0].branch).toBe("main");
    expect(entries[1].branch).toBe("pipeline/retro-workflow-efficiency");
  });

  it("marks a detached HEAD and a bare entry", () => {
    expect(entries[2]).toMatchObject({ detached: true, branch: null, head: "3333333333333333333333333333333333333333" });
    expect(entries[3]).toMatchObject({ bare: true, head: null });
  });

  it("returns an empty list for empty output", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("shellQuote", () => {
  it("single-quotes a path with a space", () => {
    expect(shellQuote("/w/a b")).toBe("'/w/a b'");
  });

  it("escapes a single quote inside the path", () => {
    expect(shellQuote("/w/it's")).toBe("'/w/it'\\''s'");
  });

  it("leaves no way to inject a command", () => {
    expect(shellQuote("/w/x; rm -rf ~")).toBe("'/w/x; rm -rf ~'");
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
  });
});

describe("removalSuggestions", () => {
  const entries = [
    { path: "/w/presby", isMain: true, merged: null, bare: false },
    { path: "/w/merged one", isMain: false, merged: true, bare: false },
    { path: "/w/open", isMain: false, merged: false, bare: false },
    { path: "/w/bare.git", isMain: false, merged: null, bare: true },
  ];

  it("a merged non-main worktree gets git worktree remove", () => {
    expect(removalSuggestions(entries)).toContain("git worktree remove '/w/merged one'");
  });

  it("an unmerged non-main worktree gets only the regenerable .next removal", () => {
    const out = removalSuggestions(entries);
    expect(out).toContain("rm -rf '/w/open/.next'");
    expect(out.some((l) => l.includes("worktree remove '/w/open'"))).toBe(false);
  });

  it("the main checkout and a bare entry never get any suggestion", () => {
    const out = removalSuggestions(entries).join("\n");
    expect(out).not.toContain("/w/presby'");
    expect(out).not.toContain("bare.git");
  });
});

describe("formatReport", () => {
  const model = (freeGiB) => ({
    repoRoot: "/w/presby",
    freeGiB,
    worktrees: [
      { path: "/w/presby", branch: "main", detached: false, merged: null, isMain: true, bare: false,
        sizes: { nodeModules: 2, next: 0.5, rest: 0.25 } },
      { path: "/w/presby-wf", branch: "pipeline/x", detached: false, merged: true, isMain: false, bare: false,
        sizes: { nodeModules: 2, next: 0.1, rest: 0.05 } },
    ],
  });

  it("says OK at or above 20 GiB", () => {
    expect(LOW_DISK_GIB).toBe(20);
    expect(formatReport(model(541.2))).toContain(
      "Disk: 541.2 GiB free on the volume holding /w/presby (checklist minimum 20 GiB: OK)",
    );
  });

  it("flags the low-disk case with the ENOSPC warning", () => {
    const text = formatReport(model(1.9));
    expect(text).toContain(
      'Disk: 1.9 GiB free on the volume holding /w/presby: BELOW the 20 GiB the new-feature checklist asks for. A full disk has surfaced as a Neon "fetch failed" before; free space before running suites.',
    );
  });

  it("prints one line per worktree with sizes, and states merged or not", () => {
    const text = formatReport(model(100));
    expect(text).toContain("/w/presby  main  node_modules 2.0 GiB, .next 0.5 GiB, rest 0.3 GiB");
    expect(text).toContain("/w/presby-wf  pipeline/x  merged into main  node_modules 2.0 GiB, .next 0.1 GiB, rest 0.1 GiB");
  });

  it("omits sizes when they were skipped", () => {
    const m = model(100);
    m.worktrees.forEach((w) => (w.sizes = null));
    const text = formatReport(m);
    expect(text).not.toContain(", .next ");
    expect(text).toContain("/w/presby-wf  pipeline/x  merged into main\n");
  });

  it("carries the hardlink, squash and deletes-nothing footer", () => {
    const text = formatReport(model(100));
    expect(text).toContain(
      'Hardlinked node_modules are counted in full for each worktree. A branch merged by squash shows as "not merged". This report deletes nothing; the commands below are suggestions for you to run.',
    );
  });

  it("lists the suggestions after the footer", () => {
    const text = formatReport(model(100));
    expect(text.indexOf("This report deletes nothing")).toBeLessThan(text.indexOf("git worktree remove '/w/presby-wf'"));
  });
});
