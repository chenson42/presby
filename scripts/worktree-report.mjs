#!/usr/bin/env node
/**
 * Report-only disk and worktree report. It prints and DELETES NOTHING.
 *
 * Disk hit 1.9 GiB free during the 2026-10-24 retrospective, and a full disk
 * was read as a Neon "fetch failed" twice. This prints how much space is free
 * on the volume holding the repository, and for each git worktree: its branch,
 * a merge state, whether it has uncommitted or untracked files, and how big
 * `node_modules`, `.next` and everything else are, then the commands you could
 * run to reclaim space. The commands are text for you to run; nothing here
 * runs them.
 *
 * The merge state separates look-alikes. "Is HEAD an ancestor of origin/main"
 * is ALSO true for a worktree with no commits at all (its HEAD is a commit main
 * reached), which is how a brand-new pipeline worktree was once offered for
 * removal. So the state is computed from:
 *   1. does it have commits of its own: HEAD is NOT on origin/main's
 *      first-parent line (a branch merged by a merge commit is the SECOND
 *      parent of that merge, so it is off the line; a fresh worktree is on it);
 *   2. are all of them on origin/main: HEAD is an ancestor of origin/main;
 *   3. is it clean: `git status --porcelain` prints nothing (ignored files do
 *      not count); and
 *   4. is it a named branch: a detached HEAD is never classified.
 * `git worktree remove` is suggested ONLY when all four hold ("merged" and
 * clean). "No commits of its own", "not merged", detached, unknown, dirty and
 * dirty-unknown get no removal suggestion; the only other suggestion is the
 * regenerable `.next`. `origin/main` is the remote-tracking ref, as of your
 * last fetch, with no fallback to a local `main` (which can be ahead of what
 * was published).
 *
 * Known and accepted classification residuals (stated in the footer): a
 * fast-forwarded branch reads as "no commits of its own"; a squash-merged
 * branch reads as "not merged"; both err toward not suggesting removal. A
 * branch deliberately created from a commit that is itself off main's
 * first-parent line (the tip of an already-merged feature branch) would read as
 * "merged" while having no work of its own; the removal still needs a clean
 * tree, and the suggestion is only text.
 *
 * Usage: node scripts/worktree-report.mjs [--no-sizes]
 *        npm run worktrees:report
 *
 * `--no-sizes` skips the `du` calls (slow with a large node_modules). Always
 * exits 0. Every git call here is read-only (`worktree list`, `rev-parse`,
 * `rev-list`, `merge-base`, `status --no-optional-locks`); a test scans this
 * file to keep it so.
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
 * The four facts reduced to one state.
 *
 * @param {{ detached: boolean, ancestor: boolean | null, onFirstParent: boolean | null }} facts
 * @returns {"merged" | "none" | "unmerged" | null}
 *   merged: has commits of its own and all are on origin/main;
 *   none: HEAD is a commit main already had (new, unused, or fast-forwarded);
 *   unmerged: HEAD is not on origin/main; null: not classified.
 */
export function worktreeState({ detached, ancestor, onFirstParent }) {
  if (detached || ancestor === null || ancestor === undefined) return null;
  if (ancestor === false) return "unmerged";
  if (onFirstParent === null || onFirstParent === undefined) return null;
  return onFirstParent ? "none" : "merged";
}

/**
 * Text-only suggestions. The main checkout and bare entries get none.
 * `git worktree remove` only for a merged, clean worktree; otherwise the
 * regenerable `.next` removal, only when `.next` exists. Nothing else, ever.
 *
 * @param {{ path: string, isMain: boolean, bare: boolean, state: string | null, dirty: boolean | null, nextExists: boolean }[]} entries
 * @returns {string[]}
 */
export function removalSuggestions(entries) {
  const out = [];
  for (const e of entries) {
    if (e.isMain || e.bare) continue;
    if (e.state === "merged" && e.dirty === false) out.push(`git worktree remove ${shellQuote(e.path)}`);
    if (e.nextExists) out.push(`rm -rf ${shellQuote(`${e.path}/.next`)}`);
  }
  return out;
}

const gib = (n) => n.toFixed(1);

const STATE_LABEL = {
  merged: "merged into origin/main",
  none: "no commits of its own (new or unused)",
  unmerged: "not merged",
};

/**
 * @param {{
 *   repoRoot: string,
 *   freeGiB: number,
 *   baseFound: boolean,
 *   worktrees: { path: string, branch: string | null, detached: boolean, isMain: boolean, bare: boolean,
 *                state: "merged" | "none" | "unmerged" | null, dirty: boolean | null, nextExists: boolean,
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
    const segments = [w.path, w.bare ? "bare" : w.detached ? "detached" : (w.branch ?? "unknown")];
    if (!w.isMain && !w.bare && !w.detached && w.state) segments.push(STATE_LABEL[w.state]);
    if (!w.isMain && w.dirty === true) segments.push("uncommitted or untracked files");
    if (w.sizes) {
      segments.push(
        `node_modules ${gib(w.sizes.nodeModules)} GiB, .next ${gib(w.sizes.next)} GiB, rest ${gib(w.sizes.rest)} GiB`,
      );
    }
    lines.push(segments.join("  "));
  }
  if (!model.baseFound) lines.push("Merge state is not shown: origin/main was not found in this repository.");
  lines.push("");
  lines.push(
    'Hardlinked node_modules are counted in full for each worktree. "merged into origin/main" means the branch has commits of its own and every one of them is on origin/main as of your last fetch. A branch that was squash-merged or fast-forwarded cannot be told from an unmerged or an unused one, so no worktree removal is suggested for it. This report deletes nothing.',
  );
  const suggestions = removalSuggestions(model.worktrees);
  if (suggestions.length) {
    lines.push("");
    lines.push("Suggestions for you to run (nothing here has been run):");
    if (suggestions.some((s) => s.startsWith("git worktree remove"))) {
      lines.push(
        '"git worktree remove" also deletes the ignored files in that worktree, such as .env.local and node_modules; the branch is kept.',
      );
    }
    if (suggestions.some((s) => s.startsWith("rm -rf"))) {
      lines.push('".next" is regenerable; stop that worktree\'s dev server before removing it.');
    }
    for (const s of suggestions) lines.push(`  ${s}`);
  }
  return lines.join("\n");
}

// ── Gathering (the only part that touches the machine; all read-only) ────────

/**
 * The ONE place git is spawned. Never throws: `code` is the exit status (null
 * when git could not run at all). Every caller passes a read-only subcommand.
 */
function gitRun(args, cwd) {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err && typeof err.status === "number" ? err.status : null, out: "" };
  }
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

/**
 * The commit origin/main points at, or null. No fallback to a local `main`: it
 * can be ahead of what was published, and "merged" is a claim about origin/main.
 */
export function resolveBase(cwd) {
  const r = gitRun(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"], cwd);
  const sha = r.out.trim();
  return r.code === 0 && sha ? sha : null;
}

/** The set of commits on origin/main's first-parent line, or null on failure. */
export function firstParentLine(base, cwd) {
  const r = gitRun(["rev-list", "--first-parent", base], cwd);
  return r.code === 0 ? new Set(r.out.split("\n").filter(Boolean)) : null;
}

/**
 * @returns {{ ancestor: boolean | null, onFirstParent: boolean | null }}
 *   ancestor: exit code of `merge-base --is-ancestor` (0 true, 1 false, else null).
 */
export function worktreeFacts(head, base, line, cwd) {
  const r = gitRun(["merge-base", "--is-ancestor", head, base], cwd);
  const ancestor = r.code === 0 ? true : r.code === 1 ? false : null;
  return { ancestor, onFirstParent: line ? line.has(head) : null };
}

/**
 * Whether the worktree has uncommitted or untracked files (ignored files do not
 * count). `--no-optional-locks` keeps this from refreshing the worktree's index.
 * `--untracked-files=normal` makes the answer independent of a user's
 * status.showUntrackedFiles setting. null when it could not be read.
 */
export function isDirty(worktreePath) {
  const r = gitRun(["--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"], worktreePath);
  return r.code === 0 ? r.out.length > 0 : null;
}

/** Everything the report prints, gathered from the machine. Read-only. */
export function buildModel(repoRoot, { sizes: withSizes = true } = {}) {
  const listed = gitRun(["worktree", "list", "--porcelain"], repoRoot);
  const entries = listed.code === 0 ? parseWorktreePorcelain(listed.out) : [];
  const base = resolveBase(repoRoot);
  const line = base ? firstParentLine(base, repoRoot) : null;
  const st = statfsSync(repoRoot);
  const worktrees = entries.map((e) => {
    let sizes = null;
    if (withSizes && !e.bare) {
      const nodeModules = duGiB(path.join(e.path, "node_modules"));
      const next = duGiB(path.join(e.path, ".next"));
      const total = duGiB(e.path);
      sizes = { nodeModules, next, rest: Math.max(0, total - nodeModules - next) };
    }
    const classifiable = !e.isMain && !e.bare && !!e.head;
    const state =
      classifiable && base
        ? worktreeState({ detached: e.detached, ...worktreeFacts(e.head, base, line, repoRoot) })
        : null;
    return {
      ...e,
      state,
      dirty: e.isMain || e.bare ? null : isDirty(e.path),
      nextExists: existsSync(path.join(e.path, ".next")),
      sizes,
    };
  });
  return { repoRoot, freeGiB: (st.bavail * st.bsize) / 1024 ** 3, baseFound: base !== null, listFailed: listed.code !== 0, worktrees };
}

function main() {
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const model = buildModel(repoRoot, { sizes: !process.argv.includes("--no-sizes") });
  if (model.listFailed) console.log("worktrees:report: git worktree list failed; showing disk only.");
  console.log(formatReport(model));
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  try {
    main();
  } catch (err) {
    console.log(`worktrees:report: ${err instanceof Error ? err.message : String(err)}`);
  }
}
