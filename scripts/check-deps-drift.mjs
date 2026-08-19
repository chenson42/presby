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
 * Three rules:
 *   1. `radix-ui` appears in neither `dependencies` nor `devDependencies` of
 *      package.json, nor as a root dependency in package-lock.json.
 *   2. No file under src/ imports from "radix-ui".
 *   3. Every `@radix-ui/react-*` specifier imported under src/ is present in
 *      package.json `dependencies` — catches a rewrite to a package nobody
 *      installed.
 *
 * Not a proof; just a tripwire. Comment-only lines are skipped — the header
 * comment in `dropdown-menu.tsx` quotes the umbrella import while explaining
 * why it must not be used, and a tripwire that fires on a comment describing
 * the invariant is a tripwire people learn to bypass.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) yield full;
  }
}

/** Lines whose trimmed form starts with a comment opener are not code. */
function isCommentLine(line) {
  const t = line.trim();
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.startsWith("{/*")
  );
}

const UMBRELLA_IMPORT_RE = /\bfrom\s*["']radix-ui["']/;
const RADIX_PKG_RE = /["'](@radix-ui\/[a-z0-9.-]+)["']/g;

const violations = [];

// ── Rule 1: the umbrella is not a declared dependency ────────────────────────

const pkg = JSON.parse(
  await fs.readFile(path.join(ROOT, "package.json"), "utf8"),
);
const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

if (Object.prototype.hasOwnProperty.call(declared, "radix-ui")) {
  violations.push({
    rule: 1,
    where: "package.json",
    message:
      '"radix-ui" is declared as a dependency. Remove it and depend on the individual @radix-ui/react-* packages (DECISION-048).',
  });
}

try {
  const lock = JSON.parse(
    await fs.readFile(path.join(ROOT, "package-lock.json"), "utf8"),
  );
  const rootEntry = lock.packages?.[""] ?? {};
  const lockDeclared = {
    ...(rootEntry.dependencies ?? {}),
    ...(rootEntry.devDependencies ?? {}),
  };
  if (Object.prototype.hasOwnProperty.call(lockDeclared, "radix-ui")) {
    violations.push({
      rule: 1,
      where: "package-lock.json",
      message:
        '"radix-ui" is a root dependency in the lockfile. Restore the lockfile and run `npm ci` — `npm run ui:add` does this for you.',
    });
  }
} catch {
  // No lockfile (fresh clone before install). Rule 1's package.json half still ran.
}

// ── Rules 2 and 3: what src/ actually imports ────────────────────────────────

const importedPackages = new Map(); // package name → "file:line" of first sighting

for await (const file of walk(SRC)) {
  const src = await fs.readFile(file, "utf8");
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    if (UMBRELLA_IMPORT_RE.test(line)) {
      violations.push({
        rule: 2,
        where: `${rel}:${i + 1}`,
        message: `imports from the "radix-ui" umbrella: ${line.trim().slice(0, 120)}`,
      });
    }

    for (const m of line.matchAll(RADIX_PKG_RE)) {
      if (!importedPackages.has(m[1])) {
        importedPackages.set(m[1], `${rel}:${i + 1}`);
      }
    }
  }
}

for (const [name, at] of importedPackages) {
  if (!Object.prototype.hasOwnProperty.call(pkg.dependencies ?? {}, name)) {
    violations.push({
      rule: 3,
      where: at,
      message: `imports "${name}", which is not in package.json dependencies. Install it deliberately (architect's five-criteria pass) before importing it.`,
    });
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

if (violations.length > 0) {
  console.error("Dependency-drift check FAILED:\n");
  for (const v of violations) {
    console.error(`  [rule ${v.rule}] ${v.where}`);
    console.error(`  > ${v.message}`);
    console.error("");
  }
  console.error(
    "  Why this matters: the radix-ui umbrella is ~40 packages in the audit and",
  );
  console.error(
    "  update path to use six (DECISION-048). It has arrived by surprise twice.",
  );
  console.error("");
  console.error("  Fix: generate primitives with `npm run ui:add -- <component>`,");
  console.error("  which rewrites the import and restores the lockfile for you.");
  console.error("");
  process.exit(1);
}

console.log("Dependency-drift check passed.");
