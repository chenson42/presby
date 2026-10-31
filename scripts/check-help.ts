/**
 * check:help, the ninth tripwire (R7, DECISION-294, Workflow Rule 17): the help registry, its
 * markdown, links, images, labels, banned phrases and the [help:<token>] lines in docs/TODO.md
 * must agree. A thin runner: it reads the repo into plain in-memory inputs and hands them to
 * the pure rules in src/lib/help/checks.ts (H1 to H18) and scripts/lib/help-boundary.mjs (H19).
 * It needs no environment and no database. Run through tsx, which honours tsconfig's `@/` paths.
 *
 * The catalog and tile coverage rules cannot run here (src/lib/org-features.ts and
 * src/lib/org-portal/tiles.ts import "server-only" and the database); they are
 * src/lib/help/coverage.test.ts, which `npm run test` and CI run (P3-1).
 *
 * Prints `[H<n>] <file>: <message>` per violation and exits 1.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { checkHelp, formatViolation, readPngSize, type HelpCheckInput, type HelpViolation } from "../src/lib/help/checks";
import { HELP_PAGES } from "../src/lib/help/registry";
import type { HelpEntry } from "../src/lib/help/types";
import { SLUG_HISTORY } from "../src/lib/help/slug-history";
import { HELP_SHOTS } from "../src/lib/help/screenshots-data";
import { checkHelpBoundary } from "./lib/help-boundary.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(ROOT, file), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function readRequired(file: string): Promise<string> {
  const text = await readOptional(file);
  if (text === null) throw new Error(`check:help needs ${file}, which does not exist.`);
  return text;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(ROOT, dir))).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function main(): Promise<number> {
  const contentDir = "src/content/help";
  const contentFiles = [];
  for (const name of await listDir(contentDir)) {
    if (!name.endsWith(".md")) continue;
    contentFiles.push({ path: `${contentDir}/${name}`, content: await readRequired(`${contentDir}/${name}`) });
  }

  const imageFiles = [];
  for (const name of await listDir(`${contentDir}/images`)) {
    const file = path.join(ROOT, contentDir, "images", name);
    const stat = await fs.stat(file);
    if (!stat.isFile()) continue;
    const size = readPngSize(new Uint8Array(await fs.readFile(file)));
    imageFiles.push({ name, size: stat.size, width: size?.width ?? null, height: size?.height ?? null });
  }

  // Every code file under src/, tests included in the list; the rules skip tests themselves.
  const srcFiles = [];
  for await (const file of walk(path.join(ROOT, "src"))) {
    if (!/\.(ts|tsx|mts|js|mjs)$/.test(file) || file.endsWith(".d.ts")) continue;
    srcFiles.push({ path: rel(file), content: await fs.readFile(file, "utf8") });
  }

  // HELP_PAGES is `as const`, so an empty registry types as readonly []; widen it for the rules.
  const pages: readonly HelpEntry[] = HELP_PAGES;
  const pkg = JSON.parse(await readRequired("package.json")) as { version: string };

  const input: HelpCheckInput = {
    pages,
    contentFiles,
    imageFiles,
    shots: HELP_SHOTS,
    screenshotsSource: await readOptional("src/lib/help/screenshots.ts"),
    slugHistory: SLUG_HISTORY,
    todo: await readRequired("docs/TODO.md"),
    packageVersion: pkg.version,
    functionalityMap: await readRequired("docs/product/functionality-map.md"),
    srcFiles,
  };

  const violations: string[] = checkHelp(input).map((v: HelpViolation) => formatViolation(v));
  for (const v of checkHelpBoundary(srcFiles)) {
    violations.push(`${formatViolation({ rule: "H19", file: v.file, message: v.message })}\n       chain: ${v.chain.join("  ->  ")}`);
  }

  if (violations.length > 0) {
    console.error("Help check FAILED:\n");
    for (const line of violations) console.error(`  ${line}`);
    console.error(`\n  ${violations.length} violation(s). Why this matters: the help is part of the product (Workflow Rule 17);`);
    console.error("  a page that lags or leads its feature, or links nowhere, is worse than no page.");
    console.error("  The catalog and tile coverage rules run in `npm run test` (src/lib/help/coverage.test.ts).");
    return 1;
  }
  const published = pages.filter((p) => p.status === "published").length;
  console.log(`Help check passed (${pages.length} registry entries, ${published} published, ${contentFiles.length} content files, ${imageFiles.length} images).`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`check:help could not run: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
