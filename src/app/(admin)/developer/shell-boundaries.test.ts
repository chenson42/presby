/**
 * Source-scan pins for the developer portal (DECISION-258, E6, E12-E14). These
 * are properties a behaviour test cannot see, so they are read off the tree.
 * Allow-only or presence checks, never deny-lists of shapes (DECISION-252).
 *
 *   1. NO `loading.tsx` at any depth: `tables/[table]` and `erd/[module]` call
 *      `notFound()`, and a `loading.tsx` would send their 404s out as HTTP 200.
 *   2. `error.tsx` and `not-found.tsx` exist; `error.tsx` never reads `.message`.
 *   3. Every `page.tsx` calls `requireDeveloper(` with a literal first argument
 *      beginning `/developer`, BEFORE `notFound(`, `buildSchemaDocs(`,
 *      `buildErd(` and `loadDescriptions(`, so a non-entitled viewer gets one
 *      answer for every URL.
 *   4. `schema.json/route.ts` calls `checkDeveloperApiRequest(` before
 *      `buildSchemaDocs(`.
 *   5. No `getPlatformDb` under the tree or `src/lib/developer-portal/`.
 *   6. A closed allow-list of `@/` imports in the tree's non-test source.
 *   7. Nothing under `(org)` or `(public)` imports `@/components/admin-portal/`.
 *   8. `src/proxy.ts`'s `PROTECTION_RULES` names no `developer` (Ruling 1).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");
const DEV_DIR = resolve(__dirname);
const LIB_DIR = resolve(ROOT, "src/lib/developer-portal");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:"'`])\/\/.*$/gm, "$1");
}

const isSource = (f: string) =>
  /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);
const read = (f: string) => stripComments(readFileSync(f, "utf8"));
const rel = (f: string) => relative(ROOT, f);

describe("developer portal boundaries", () => {
  it("has no loading.tsx at any depth: a loading.tsx would turn the 404s into 200s (E13)", () => {
    const offenders = walk(DEV_DIR)
      .filter((f) => /(^|\/)loading\.(tsx|ts|jsx|js)$/.test(f))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("has an error.tsx and a not-found.tsx, and error.tsx never reads .message (E14)", () => {
    expect(statSync(join(DEV_DIR, "error.tsx")).isFile()).toBe(true);
    expect(statSync(join(DEV_DIR, "not-found.tsx")).isFile()).toBe(true);
    expect(read(join(DEV_DIR, "error.tsx"))).not.toMatch(/\.message\b/);
  });

  it("gates every page with a literal /developer path before any param-dependent read (E6)", () => {
    const pages = walk(DEV_DIR).filter((f) => /\/page\.tsx$/.test(f));
    // home, data-model, docs, tables/[table], erd/[module]
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const page of pages) {
      const src = read(page);
      const gate = src.match(/requireDeveloper\(\s*(["'`])\/developer/);
      expect(gate, `${rel(page)} must call requireDeveloper("/developer…")`).not.toBeNull();
      const gateAt = gate!.index!;
      for (const later of ["notFound(", "buildSchemaDocs(", "buildErd(", "loadDescriptions("]) {
        const at = src.indexOf(later);
        if (at !== -1) {
          expect(gateAt, `${rel(page)}: requireDeveloper( must precede ${later}`).toBeLessThan(at);
        }
      }
    }
  });

  it("checks the API request before reading the schema in schema.json (E11)", () => {
    const src = read(join(DEV_DIR, "schema.json/route.ts"));
    const gate = src.indexOf("checkDeveloperApiRequest(");
    const read_ = src.indexOf("buildSchemaDocs(");
    expect(gate).toBeGreaterThan(-1);
    expect(read_).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(read_);
  });

  it("never reaches getPlatformDb", () => {
    const files = [...walk(DEV_DIR), ...walk(LIB_DIR)].filter(isSource);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      expect(read(f), rel(f)).not.toMatch(/getPlatformDb/);
    }
  });

  it("imports only from the closed allow-list (the tenant tier is forbidden by omission)", () => {
    const ALLOWED: RegExp[] = [
      /^@\/lib\/dev-docs$/,
      /^@\/lib\/developer-portal\/[\w-]+$/,
      /^@\/lib\/platform-admin$/,
      /^@\/lib\/nav-data$/,
      /^@\/lib\/auth\/cached-auth$/,
      /^@\/auth$/,
      /^@\/lib\/version$/,
      /^@\/lib\/utils$/,
      /^@\/components\/ui\/[\w-]+$/,
      /^@\/components\/shared\/console-[\w-]+$/,
      /^@\/components\/shared\/(load-error|destination-card|formatted-date)$/,
      /^@\/components\/admin-portal\/admin-forbidden$/,
    ];
    const files = walk(DEV_DIR).filter(isSource);
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/from\s+["'](@\/[^"']+)["']/g)) {
        if (!ALLOWED.some((re) => re.test(m[1]))) offenders.push(`${rel(f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is never imported through components/admin-portal by (org) or (public)", () => {
    for (const group of ["(org)", "(public)"]) {
      const files = walk(resolve(ROOT, "src/app", group)).filter((f) => /\.(ts|tsx)$/.test(f));
      for (const f of files) {
        expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(
          /@\/components\/admin-portal\//,
        );
      }
    }
  });

  it("has no PROTECTION_RULES entry for /developer in src/proxy.ts (Ruling 1)", () => {
    const src = stripComments(readFileSync(resolve(ROOT, "src/proxy.ts"), "utf8"));
    const start = src.indexOf("const PROTECTION_RULES");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n];", start);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toMatch(/developer/i);
  });
});
