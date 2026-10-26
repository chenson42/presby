/**
 * Source-scan pins for the platform console shell (E13). These are properties
 * a behaviour test cannot see, so they are read off the tree.
 *
 *   1. NO `loading.tsx` ANYWHERE under `(admin)/admin` (R1c, DECISION-251, F274).
 *      A `loading.tsx` opens a Suspense boundary over every descendant route, so
 *      the `notFound()` routes (`organizations/[id]`, `users/[id]`,
 *      `tickets/[id]`, `whats-new/[id]`) would answer their 404s with HTTP 200
 *      (the (org) contract's 2026-08-18 measurement). Loading feedback is
 *      per-card `Suspense` only.
 *   2. No string literal beginning `/o/` under the console or in
 *      `components/admin-portal/` or the shared `console-*` shell: nothing on the platform tier links into a
 *      tenant route (Two Hierarchies, DECISION-251).
 *   3. `components/admin-portal/` and `shared/console-*` never mounts `BrandTokens` and never reaches
 *      `getPlatformDb`: it is presentation, in the platform palette.
 *   4. `error.tsx` does not reference `error.message` (E14).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");
const ADMIN_DIR = resolve(__dirname);
const PORTAL_DIR = resolve(ROOT, "src/components/admin-portal");
const SHARED_DIR = resolve(ROOT, "src/components/shared");

/** The promoted shell (DECISION-261) keeps the scans it had in admin-portal/. */
const consoleShellFiles = () =>
  readdirSync(SHARED_DIR)
    .filter((n) => /^console-.*\.tsx?$/.test(n))
    .map((n) => join(SHARED_DIR, n));

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

const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);

describe("console shell boundaries", () => {
  it("has no loading.tsx anywhere under (admin)/admin — a loading.tsx would turn four 404s into 200s", () => {
    const offenders = walk(ADMIN_DIR)
      .filter((f) => /(^|\/)loading\.(tsx|ts|jsx|js)$/.test(f))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("has an error.tsx at the console root", () => {
    expect(statSync(join(ADMIN_DIR, "error.tsx")).isFile()).toBe(true);
  });

  it("links nowhere into /o/ from the console or its shell components", () => {
    const files = [
      ...walk(ADMIN_DIR),
      ...walk(PORTAL_DIR),
      ...consoleShellFiles(),
    ].filter(isSource);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) =>
      /["'`]\/o\//.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("keeps components/admin-portal and the shared console shell free of BrandTokens and getPlatformDb", () => {
    expect(consoleShellFiles().filter(isSource).length).toBe(4);
    for (const f of [...walk(PORTAL_DIR), ...consoleShellFiles()].filter(isSource)) {
      const src = stripComments(readFileSync(f, "utf8"));
      expect(src, relative(ROOT, f)).not.toMatch(/BrandTokens|getPlatformDb/);
    }
  });

  it("never renders error.message in the error boundary", () => {
    const src = stripComments(readFileSync(join(ADMIN_DIR, "error.tsx"), "utf8"));
    expect(src).not.toMatch(/\.message\b/);
  });
});
