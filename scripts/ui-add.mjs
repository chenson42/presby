#!/usr/bin/env node
/**
 * The supported way to generate a shadcn primitive in this repo.
 *
 *     npm run ui:add -- <component…>
 *
 * Raw `npx shadcn@latest add` is NOT supported, because it does two things this
 * repo has to undo every single time:
 *
 *   1. It emits `import { Foo as FooPrimitive } from "radix-ui"`, and
 *   2. it installs the ~40-package `radix-ui` umbrella to satisfy that import,
 *      rewriting package.json and package-lock.json.
 *
 * This repo depends on the individual `@radix-ui/react-*` packages instead — a
 * small auditable dependency surface is the charter (DECISION-048).
 *
 * Motivating incident: the umbrella arrived TWICE by surprise at Phase 4 (F-B1,
 * docs/work-log/2026-08-18-backbone-and-org-sites.md). Both times a human
 * noticed, rewrote the import by hand, and reverted the lockfile — correctly,
 * and from memory. Slice a of the brand foundation runs the generator ten-plus
 * times, which is where the third occurrence becomes the silent one. This
 * script is those two hand-corrections, written down.
 *
 * What it does, in order:
 *   1. Refuse to run if package.json or package-lock.json is already dirty —
 *      step 4 runs `npm ci`, which would happily discard an uncommitted
 *      lockfile edit. Snapshot both files into memory.
 *   2. `npx shadcn@latest add --yes --overwrite <component…>`.
 *   3. Rewrite every umbrella import in the files the generator touched under
 *      src/components/ui/ to the individual package.
 *      NOTE: no `X.Root` → `X` member-access normalisation is needed. A
 *      namespace import of @radix-ui/react-dropdown-menu exposes `.Root`,
 *      `.Trigger` and friends exactly as the umbrella's namespace does — see
 *      src/components/ui/dropdown-menu.tsx:17. Rewriting the import line is the
 *      whole job; rewriting member accesses would be a second, fragile regex
 *      with nothing to fix.
 *   4. Restore package.json + package-lock.json from the snapshot; `npm ci`.
 *   5. Fail loudly if any rewritten import targets a package that is not
 *      already in `dependencies`. THIS STEP IS THE POINT: it converts "surprise
 *      dependency" into "the build stops and names it."
 *   6. Run the dependency-drift tripwire.
 *   7. Remind the operator that primitives are generated files.
 *
 * Exported for unit-testing:
 *   kebab(name: string): string
 *   rewriteUmbrellaImports(source: string): { source, packages }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PKG = path.join(ROOT, "package.json");
const LOCK = path.join(ROOT, "package-lock.json");
const UI_DIR = "src/components/ui/";

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** DropdownMenu → dropdown-menu, AlertDialog → alert-dialog. */
export function kebab(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Rewrite every `radix-ui` umbrella import to the individual packages.
 *
 *   import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
 *   → import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
 *
 * A single statement may name more than one primitive; each becomes its own
 * namespace import, one per line.
 *
 * @param {string} source
 * @returns {{ source: string, packages: string[] }}
 */
export function rewriteUmbrellaImports(source) {
  const packages = [];
  const rewritten = source.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']radix-ui["'];?/g,
    (_match, specifiers) => {
      const lines = specifiers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((spec) => {
          const [exported, local] = spec.split(/\s+as\s+/).map((s) => s.trim());
          const pkg = `@radix-ui/react-${kebab(exported)}`;
          packages.push(pkg);
          return `import * as ${local ?? exported} from "${pkg}"`;
        });
      return lines.join("\n");
    },
  );
  return { source: rewritten, packages };
}

// ── Script entry point ───────────────────────────────────────────────────────

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`ui:add: \`${cmd} ${args.join(" ")}\` failed.`);
    console.error(result.stderr ?? "");
    process.exit(1);
  }
  return result.stdout ?? "";
}

function main(components) {
  if (components.length === 0) {
    console.error("Usage: npm run ui:add -- <component…>");
    console.error("Example: npm run ui:add -- table input label textarea");
    process.exit(1);
  }

  // 1 — clean-tree precondition + snapshot.
  const dirtyManifest = capture("git", [
    "status",
    "--porcelain",
    "--",
    "package.json",
    "package-lock.json",
  ]).trim();

  if (dirtyManifest !== "") {
    console.error("ui:add: package.json or package-lock.json is already dirty:\n");
    console.error(dirtyManifest);
    console.error("");
    console.error(
      "  This script restores both files and runs `npm ci`, which would discard",
    );
    console.error("  your uncommitted edit. Commit or stash it first, then re-run.");
    process.exit(1);
  }

  const pkgSnapshot = readFileSync(PKG, "utf8");
  const lockSnapshot = readFileSync(LOCK, "utf8");

  // 2 — generate.
  console.log(`\nui:add: generating ${components.join(", ")}…\n`);

  const gen = run("npx", [
    "shadcn@latest",
    "add",
    "--yes",
    "--overwrite",
    ...components,
  ]);
  if (gen.status !== 0) {
    console.error("\nui:add: `shadcn add` failed. Nothing was rewritten.");
    console.error(
      "  package.json / package-lock.json may have been modified by the CLI —",
    );
    console.error("  check `git status` before re-running.");
    process.exit(gen.status ?? 1);
  }

  // 3 — rewrite the umbrella imports in the files the generator touched.
  const touched = capture("git", ["status", "--porcelain", "--", UI_DIR])
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter((p) => p.endsWith(".tsx") || p.endsWith(".ts"));

  // E9: a regenerated file byte-identical to what is committed is invisible to
  // `git status`. Harmless — there is nothing to rewrite — but say so rather
  // than reporting a silent success the operator reads as "the rewrite ran."
  if (touched.length === 0) {
    console.log(`\nui:add: git reports no added or modified files under ${UI_DIR}.`);
    console.log(
      "  Either the generated output is byte-identical to what is committed, or",
    );
    console.log("  the component names did not match anything. No rewrite was needed.");
  }

  const rewrittenFiles = [];
  const requestedPackages = new Set();

  for (const rel of touched) {
    const full = path.join(ROOT, rel);
    const before = readFileSync(full, "utf8");
    const { source: after, packages } = rewriteUmbrellaImports(before);
    for (const p of packages) requestedPackages.add(p);
    if (after !== before) {
      writeFileSync(full, after);
      rewrittenFiles.push({ rel, packages });
    }
  }

  if (rewrittenFiles.length > 0) {
    console.log("\nui:add: rewrote umbrella imports:");
    for (const f of rewrittenFiles) {
      console.log(`  ${f.rel} → ${f.packages.join(", ")}`);
    }
  }

  // 4 — restore the manifest and reinstall.
  writeFileSync(PKG, pkgSnapshot);
  writeFileSync(LOCK, lockSnapshot);
  console.log(
    "\nui:add: restored package.json + package-lock.json; running `npm ci`…\n",
  );

  const ci = run("npm", ["ci"]);
  if (ci.status !== 0) {
    console.error("\nui:add: `npm ci` failed. The dependency tree may be inconsistent.");
    process.exit(ci.status ?? 1);
  }

  // 5 — name any dependency the rewrite now requires but nobody installed.
  const declared = JSON.parse(pkgSnapshot).dependencies ?? {};
  const missing = [...requestedPackages].filter(
    (p) => !Object.prototype.hasOwnProperty.call(declared, p),
  );

  if (missing.length > 0) {
    console.error(
      "\nui:add: the generated primitives import packages that are NOT installed:\n",
    );
    for (const p of missing) console.error(`  ${p}`);
    console.error("");
    console.error("  These are new runtime dependencies. They need the architect's");
    console.error(
      "  five-criteria pass (CLAUDE.md → Agent Roster, Phase 2) before they can be",
    );
    console.error("  installed. Install deliberately, then re-run.");
    console.error("");
    console.error(
      "  The generated files are on disk with their imports already rewritten;",
    );
    console.error(
      "  the lockfile has been restored, so nothing was installed behind you.",
    );
    process.exit(1);
  }

  // 6 — tripwire.
  const drift = run("node", [path.join("scripts", "check-deps-drift.mjs")]);
  if (drift.status !== 0) process.exit(drift.status ?? 1);

  // 7 — the reminder.
  console.log("");
  console.log("ui:add: done. Primitives are GENERATED files — do not hand-edit them");
  console.log("casually. Any deliberate divergence from the registry gets a header");
  console.log("comment saying what diverged and why, the way");
  console.log("src/components/ui/dropdown-menu.tsx does.");
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("ui-add.mjs");

if (isMain) {
  main(process.argv.slice(2).filter((a) => a.trim() !== ""));
}
