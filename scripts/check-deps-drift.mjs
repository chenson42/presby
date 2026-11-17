#!/usr/bin/env node
/**
 * Radix umbrella guard. The shadcn registry emits
 *
 *     import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
 *
 * and the CLI installs the ~40-package `radix-ui` umbrella to satisfy it. This
 * repo depends on the individual `@radix-ui/react-*` packages instead — a small
 * auditable dependency surface is the charter (DECISION-048), and the umbrella
 * drags ~40 packages into the audit and update path to use six.
 *
 * Motivating incident: the umbrella arrived TWICE by surprise at Phase 4
 * (F-B1, docs/work-log/2026-08-18-backbone-and-org-sites.md), and was reverted
 * by hand both times — correctly, but by memory. Slice a of the brand
 * foundation runs `shadcn add` ten-plus times, which is where the third
 * occurrence becomes the silent one. `npm run ui:add` prevents it at generation
 * time; this script prevents it at merge time.
 *
 * Six rules:
 *   1. `radix-ui` appears in neither `dependencies` nor `devDependencies` of
 *      package.json, nor as a root dependency in package-lock.json.
 *   2. No file under src/ imports from "radix-ui".
 *   3. Every `@radix-ui/react-*` specifier imported under src/ is present in
 *      package.json `dependencies` — catches a rewrite to a package nobody
 *      installed.
 *   4. `leaflet` is in `dependencies` only and `@types/leaflet` in
 *      `devDependencies` only, each at a tilde range inside 1.9 (`~1.9.x`), in
 *      package.json and in the lockfile root alike. A caret would let a range
 *      cross into 2.x, which is ESM-only, drops the global `L` and is still a beta
 *      (DECISION-343, DECISION-122).
 *   5. `react-leaflet` and any `@react-leaflet/*` appear nowhere: not in
 *      package.json, not as a root dependency or any installed package in the
 *      lockfile, not in an import under src/. Its license is Hippocratic-2.1
 *      (DECISION-122).
 *   6. `leaflet` and `leaflet/...` are imported by EXACTLY ONE file,
 *      `src/app/(org)/o/[slug]/admin/insights/map.tsx` (static, side-effect, dynamic
 *      `import()`, `require` and type-only imports all count), and that file imports
 *      both `leaflet` and `leaflet/dist/leaflet.css`. The map's containment is the
 *      same two-way shape as treasury T5's `sharp`: no other file may reach for the
 *      library, and the one that must does (DECISION-343).
 *
 * Not a proof; just a tripwire. Comments are blanked first — the header
 * comment in `dropdown-menu.tsx` quotes the umbrella import while explaining
 * why it must not be used, and a tripwire that fires on a comment describing
 * the invariant is a tripwire people learn to bypass.
 *
 * Structured like `check-treasury-boundaries.mjs`: pure `check*` functions over
 * `{ pkg, lock, files }` (files are `{ path, content }` with POSIX paths relative
 * to the repo root), exported for `check-deps-drift.test.mjs`, and a `main` guard
 * so importing this file runs nothing.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { stripComments } from "./check-giving-boundaries.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

/** The one file that may, and must, import `leaflet` and its stylesheet (rule 6, DECISION-343). */
export const LEAFLET_FILE = "src/app/(org)/o/[slug]/admin/insights/map.tsx";

/** What a `leaflet` range must look like: a tilde inside 1.9, never a caret. */
const LEAFLET_RANGE_RE = /^~1\.9\.\d+$/;

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) yield full;
  }
}

/** Every non-test source file under src/, as `{ path, content }`. */
export async function collectFiles() {
  const files = [];
  for await (const file of walk(SRC)) {
    files.push({
      path: path.relative(ROOT, file).split(path.sep).join("/"),
      content: await fs.readFile(file, "utf8"),
    });
  }
  return files;
}

const UMBRELLA_IMPORT_RE = /\bfrom\s*["']radix-ui["']/;
const RADIX_PKG_RE = /["'](@radix-ui\/[a-z0-9.-]+)["']/g;

// A module specifier in any import position: `from "x"`, `import "x"` (side effect),
// `import("x")` and `require("x")`. A type-only import is a `from` and is matched too.
const SPECIFIER_RES = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** Every module specifier in comment-stripped source, as `{ specifier, line }`. */
function specifiersIn(code) {
  const found = [];
  for (const re of SPECIFIER_RES) {
    for (const m of code.matchAll(re)) {
      found.push({ specifier: m[1], line: code.slice(0, m.index).split("\n").length });
    }
  }
  return found;
}

const isLeaflet = (spec) => spec === "leaflet" || spec.startsWith("leaflet/");
const isReactLeaflet = (spec) =>
  spec === "react-leaflet" || spec.startsWith("react-leaflet/") || spec.startsWith("@react-leaflet/");
const isReactLeafletName = (name) =>
  name === "react-leaflet" || name.startsWith("@react-leaflet/");

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

/** Rules 1, 4 and 5 over one dependency block pair (package.json's, or the lockfile root's). */
function checkManifest({ where, dependencies, devDependencies, lockfile, declaredIn }) {
  const violations = [];
  const all = { ...(dependencies ?? {}), ...(devDependencies ?? {}) };

  if (has(all, "radix-ui")) {
    violations.push({
      rule: 1,
      where,
      message: lockfile
        ? '"radix-ui" is a root dependency in the lockfile. Restore the lockfile and run `npm ci` — `npm run ui:add` does this for you.'
        : '"radix-ui" is declared as a dependency. Remove it and depend on the individual @radix-ui/react-* packages (DECISION-048).',
    });
  }

  for (const [name, runtimeOnly] of [["leaflet", true], ["@types/leaflet", false]]) {
    const home = runtimeOnly ? dependencies : devDependencies;
    const other = runtimeOnly ? devDependencies : dependencies;
    const homeName = runtimeOnly ? "dependencies" : "devDependencies";
    const otherName = runtimeOnly ? "devDependencies" : "dependencies";
    if (has(other, name)) {
      violations.push({
        rule: 4,
        where,
        message: `"${name}" is in ${otherName}. It belongs in ${homeName} only (DECISION-343).`,
      });
    }
    if (has(home, name) && !LEAFLET_RANGE_RE.test(home[name])) {
      violations.push({
        rule: 4,
        where,
        message: `"${name}" is declared as "${home[name]}". Use a tilde range inside 1.9 (~1.9.x): a caret would let it cross into 2.x, which is ESM-only and still a beta (DECISION-343).`,
      });
    }
  }

  for (const name of Object.keys(all)) {
    if (isReactLeafletName(name)) {
      violations.push({
        rule: 5,
        where,
        message: `"${name}" is declared${declaredIn ? ` ${declaredIn}` : ""}. react-leaflet is rejected on license (Hippocratic-2.1, DECISION-122); the map uses leaflet directly, in one file.`,
      });
    }
  }
  return violations;
}

/**
 * The whole check over `{ pkg, lock, files }`, except rule 6's "and that file does" half
 * (`checkDepsDriftTree` adds it, so a synthetic tree need not carry the map file).
 * `lock` may be null (a fresh clone before install: the package.json halves still run).
 */
export function checkDepsDrift({ pkg, lock = null, files = [] }) {
  const violations = [];

  // ── Rules 1, 4 and 5: the manifests ───────────────────────────────────────
  violations.push(
    ...checkManifest({
      where: "package.json",
      dependencies: pkg.dependencies,
      devDependencies: pkg.devDependencies,
      lockfile: false,
      declaredIn: "in package.json",
    }),
  );

  if (lock) {
    const root = lock.packages?.[""] ?? {};
    violations.push(
      ...checkManifest({
        where: "package-lock.json",
        dependencies: root.dependencies,
        devDependencies: root.devDependencies,
        lockfile: true,
        declaredIn: "as a root dependency in the lockfile",
      }),
    );
    for (const name of ["leaflet", "@types/leaflet"]) {
      const inPkg = (pkg.dependencies ?? {})[name] ?? (pkg.devDependencies ?? {})[name];
      const inLock = (root.dependencies ?? {})[name] ?? (root.devDependencies ?? {})[name];
      if (inPkg !== inLock) {
        violations.push({
          rule: 4,
          where: "package-lock.json",
          message: `"${name}" is ${inPkg === undefined ? "absent" : `"${inPkg}"`} in package.json but ${inLock === undefined ? "absent" : `"${inLock}"`} at the lockfile root. Run \`npm install\` so they agree (DECISION-343).`,
        });
      }
    }
    for (const key of Object.keys(lock.packages ?? {})) {
      const name = key.replace(/^.*node_modules\//, "");
      if (key && isReactLeafletName(name)) {
        violations.push({
          rule: 5,
          where: "package-lock.json",
          message: `"${name}" is installed (${key}), directly or through another package. react-leaflet is rejected on license (Hippocratic-2.1, DECISION-122).`,
        });
      }
    }
  }

  // ── Rules 2, 3, 5 and 6: what src/ actually imports ───────────────────────
  const importedRadix = new Map(); // package name → "file:line" of first sighting
  let leafletImportedAnywhere = false;

  for (const file of files) {
    const code = stripComments(file.content);
    const lines = code.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (UMBRELLA_IMPORT_RE.test(line)) {
        violations.push({
          rule: 2,
          where: `${file.path}:${i + 1}`,
          message: `imports from the "radix-ui" umbrella: ${line.trim().slice(0, 120)}`,
        });
      }
      for (const m of line.matchAll(RADIX_PKG_RE)) {
        if (!importedRadix.has(m[1])) importedRadix.set(m[1], `${file.path}:${i + 1}`);
      }
    }

    // A test file may quote an import as a sample or mock a module by name; it never ships in a bundle.
    if (/\.test\.tsx?$/.test(file.path)) continue;

    for (const { specifier, line } of specifiersIn(code)) {
      if (isReactLeaflet(specifier)) {
        violations.push({
          rule: 5,
          where: `${file.path}:${line}`,
          message: `imports "${specifier}". react-leaflet is rejected on license (Hippocratic-2.1, DECISION-122); use leaflet directly, in ${LEAFLET_FILE} only.`,
        });
      }
      if (isLeaflet(specifier)) {
        leafletImportedAnywhere = true;
        if (file.path !== LEAFLET_FILE) {
          violations.push({
            rule: 6,
            where: `${file.path}:${line}`,
            message: `imports "${specifier}". Only ${LEAFLET_FILE} may import leaflet (a type-only import counts): the library loads lazily behind the map loader, and no other file may pull it into a page's bundle (DECISION-343).`,
          });
        }
      }
    }
  }

  for (const [name, at] of importedRadix) {
    if (!has(pkg.dependencies, name)) {
      violations.push({
        rule: 3,
        where: at,
        message: `imports "${name}", which is not in package.json dependencies. Install it deliberately (architect's five-criteria pass) before importing it.`,
      });
    }
  }

  if (leafletImportedAnywhere && !has(pkg.dependencies, "leaflet")) {
    violations.push({
      rule: 4,
      where: "package.json",
      message: '"leaflet" is imported under src/ but is not in package.json dependencies (DECISION-343).',
    });
  }

  return violations;
}

/**
 * Rule 6's other half, over the whole tree the command runs: the one file exists and imports
 * BOTH `leaflet` and `leaflet/dist/leaflet.css`. A tree where the map has stopped using the
 * library (or been renamed away) fails too, so the containment cannot rot into a dead list.
 */
export function checkLeafletHasItsImporter(files) {
  const file = files.find((f) => f.path === LEAFLET_FILE);
  if (!file) {
    return [
      {
        rule: 6,
        where: LEAFLET_FILE,
        message: `${LEAFLET_FILE} does not exist. Rule 6 is EXACTLY this one importer (DECISION-343): the map must exist, or the dependency has no user.`,
      },
    ];
  }
  const specs = specifiersIn(stripComments(file.content)).map((s) => s.specifier);
  const violations = [];
  for (const needed of ["leaflet", "leaflet/dist/leaflet.css"]) {
    if (!specs.includes(needed)) {
      violations.push({
        rule: 6,
        where: LEAFLET_FILE,
        message: `${LEAFLET_FILE} no longer imports "${needed}". Rule 6 requires both "leaflet" and "leaflet/dist/leaflet.css" here (the stylesheet loads with the lazy chunk, DECISION-343).`,
      });
    }
  }
  return violations;
}

/** The whole-tree check the command runs: every rule, plus rule 6's "and that file does". */
export function checkDepsDriftTree({ pkg, lock = null, files }) {
  return [...checkDepsDrift({ pkg, lock, files }), ...checkLeafletHasItsImporter(files)];
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-deps-drift.mjs");

if (isMain) {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  let lock = null;
  try {
    lock = JSON.parse(await fs.readFile(path.join(ROOT, "package-lock.json"), "utf8"));
  } catch {
    // No lockfile (fresh clone before install). The package.json halves still run.
  }
  const violations = checkDepsDriftTree({ pkg, lock, files: await collectFiles() });

  if (violations.length > 0) {
    console.error("Dependency-drift check FAILED:\n");
    for (const v of violations) {
      console.error(`  [rule ${v.rule}] ${v.where}`);
      console.error(`  > ${v.message}`);
      console.error("");
    }
    console.error("  Why this matters: the radix-ui umbrella is ~40 packages in the audit and");
    console.error("  update path to use six (DECISION-048). It has arrived by surprise twice. And the");
    console.error("  map library appears in exactly one file, below 2.x, without its wrapper (DECISION-343).");
    console.error("");
    console.error("  Fix: generate primitives with `npm run ui:add -- <component>`,");
    console.error("  which rewrites the import and restores the lockfile for you.");
    console.error("");
    process.exit(1);
  }

  console.log("Dependency-drift check passed.");
}
