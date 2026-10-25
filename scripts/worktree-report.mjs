#!/usr/bin/env node
/**
 * Report-only disk and worktree report. It prints and DELETES NOTHING.
 *
 * Disk hit 1.9 GiB free during the 2026-10-24 retrospective, and a full disk
 * was read as a Neon "fetch failed" twice. This prints how much space is free
 * on the volume holding the repository, and for each git worktree: its branch,
 * whether its HEAD is already merged into main, and how big `node_modules`,
 * `.next` and everything else are, then the commands you could run to reclaim
 * space. The commands are text for you to run; nothing here runs them.
 *
 * Usage: node scripts/worktree-report.mjs [--no-sizes]
 *        npm run worktrees:report
 *
 * `--no-sizes` skips the `du` calls (slow with a large node_modules). Always
 * exits 0. Caveats, stated in the output: a hardlinked node_modules is counted
 * in full for every worktree, and a branch merged by squash shows as "not
 * merged" (this project merges with merge commits).
 */
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statfsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The new-feature checklist's minimum (.claude/skills/new-feature/SKILL.md). */
export const LOW_DISK_GIB = 20;

/**
 * Parses `git worktree list --porcelain`. The first entry is the main checkout.
 *
 * @param {string} text
 * @returns {{ path: string, head: string | null, branch: string | null, detached: boolean, bare: boolean, isMain: boolean }[]}
 */
export function parseWorktreePorcelain(text) {
  const entries = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter(Boolean);
    if (!lines.length) continue;
    const entry = { path: "", head: null, branch: null, detached: false, bare: false, isMain: false };
    for (const line of lines) {
      if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) entry.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      else if (line === "detached") entry.detached = true;
      else if (line === "bare") entry.bare = true;
    }
    if (entry.path) entries.push(entry);
  }
  if (entries.length) entries[0].isMain = true;
  return entries;
}

/** POSIX single-quoting, so a path with spaces or quotes cannot change the suggested command. */
export function shellQuote(p) {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Text-only suggestions. The main checkout and bare entries get none; a merged
 * worktree gets `git worktree remove`; any other gets the regenerable `.next`.
 *
 * @param {{ path: string, isMain: boolean, merged: boolean | null, bare: boolean }[]} entries
 * @returns {string[]}
 */
export function removalSuggestions(entries) {
  const out = [];
  for (const e of entries) {
    if (e.isMain || e.bare) continue;
    if (e.merged === true) out.push(`git worktree remove ${shellQuote(e.path)}`);
    else out.push(`rm -rf ${shellQuote(`${e.path}/.next`)}`);
  }
  return out;
}

const gib = (n) => n.toFixed(1);

/**
 * @param {{
 *   repoRoot: string,
 *   freeGiB: number,
 *   worktrees: { path: string, branch: string | null, detached: boolean, merged: boolean | null, isMain: boolean, bare: boolean,
 *                sizes: { nodeModules: number, next: number, rest: number } | null }[],
 * }} model
 * @returns {string}
 */
export function formatReport(model) {
  const lines = [];
  if (model.freeGiB >= LOW_DISK_GIB) {
    lines.push(`Disk: ${gib(model.freeGiB)} GiB free on the volume holding ${model.repoRoot} (checklist minimum ${LOW_DISK_GIB} GiB: OK)`);
  } else {
    lines.push(
      `Disk: ${gib(model.freeGiB)} GiB free on the volume holding ${model.repoRoot}: BELOW the ${LOW_DISK_GIB} GiB the new-feature checklist asks for. A full disk has surfaced as a Neon "fetch failed" before; free space before running suites.`,
    );
  }
  lines.push("");
  for (const w of model.worktrees) {
    const where = w.bare ? "bare" : w.detached ? "detached" : (w.branch ?? "unknown");
    const merged = w.isMain || w.merged === null ? "" : w.merged ? "  merged into main" : "  not merged";
    const sizes = w.sizes
      ? `  node_modules ${gib(w.sizes.nodeModules)} GiB, .next ${gib(w.sizes.next)} GiB, rest ${gib(w.sizes.rest)} GiB`
      : "";
    lines.push(`${w.path}  ${where}${merged}${sizes}`);
  }
  lines.push("");
  lines.push(
    'Hardlinked node_modules are counted in full for each worktree. A branch merged by squash shows as "not merged". This report deletes nothing; the commands below are suggestions for you to run.',
  );
  const suggestions = removalSuggestions(model.worktrees);
  if (suggestions.length) {
    lines.push("");
    for (const s of suggestions) lines.push(`  ${s}`);
  }
  return lines.join("\n");
}

// ── Gathering (the only part that touches the machine; all read-only) ────────

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function duGiB(target) {
  if (!existsSync(target)) return 0;
  try {
    const kb = Number(execFileSync("du", ["-sk", target], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb / 1024 / 1024 : 0;
  } catch {
    return 0;
  }
}

/** Exit code only: true when `head` is an ancestor of origin/main (or main). */
function isMerged(head, cwd) {
  for (const base of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", head, base], { cwd, stdio: "ignore" });
      return true;
    } catch (err) {
      if (err && err.status === 1) return false; // a real answer: not an ancestor
      // 128 / missing ref: try the next base
    }
  }
  return null;
}

function main() {
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const withSizes = !process.argv.includes("--no-sizes");
  let entries = [];
  try {
    entries = parseWorktreePorcelain(git(["worktree", "list", "--porcelain"], repoRoot));
  } catch {
    console.log("worktrees:report: git worktree list failed; showing disk only.");
  }
  const st = statfsSync(repoRoot);
  const worktrees = entries.map((e) => {
    let sizes = null;
    if (withSizes && !e.bare) {
      const nodeModules = duGiB(path.join(e.path, "node_modules"));
      const next = duGiB(path.join(e.path, ".next"));
      const total = duGiB(e.path);
      sizes = { nodeModules, next, rest: Math.max(0, total - nodeModules - next) };
    }
    return {
      ...e,
      merged: e.isMain || e.bare || !e.head ? null : isMerged(e.head, repoRoot),
      sizes,
    };
  });
  console.log(formatReport({ repoRoot, freeGiB: (st.bavail * st.bsize) / 1024 ** 3, worktrees }));
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  try {
    main();
  } catch (err) {
    console.log(`worktrees:report: ${err instanceof Error ? err.message : String(err)}`);
  }
}
