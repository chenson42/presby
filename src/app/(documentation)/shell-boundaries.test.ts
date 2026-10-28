/**
 * Source-scan pins for the public documentation group (Phase 3, R3, R8, R9). Properties a
 * behaviour test cannot see, read off the tree.
 *
 *   1. NO `loading.tsx` and NO `error.tsx` anywhere under `(documentation)`. A `loading.tsx`
 *      opens a Suspense boundary, so Next flushes a 200 before a page resolves and a
 *      `notFound()` renders the 404 page at HTTP 200 (CLAUDE.md, the (org) contract, measured
 *      2026-08-18; DECISION-251 for the same reason under (admin)). The group is static, so
 *      there is no loading state to show.
 *   2. Every content page is locked static: `dynamic = "error"`; a page under a `[param]`
 *      directory also has `dynamicParams = false` and `generateStaticParams`. Any auth(),
 *      headers(), cookies() or searchParams then fails `next build`.
 *   3. Nothing under the group, `components/help/` or the shared renderer reaches the
 *      database, the session, request headers, flags or authz, mounts `BrandTokens`, or sets
 *      inner HTML. (check:help H19 walks the import graph; this is the same rule's cheap,
 *      always-on half for the files this batch owns.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const GROUP_DIR = resolve(__dirname);
const HELP_COMPONENTS_DIR = resolve(ROOT, "src/components/help");
const RENDERER = resolve(ROOT, "src/components/shared/markdown-document.tsx");

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
const groupFiles = () => walk(GROUP_DIR);
const ownedSources = () => [...groupFiles(), ...walk(HELP_COMPONENTS_DIR), RENDERER].filter(isSource);

describe("documentation group boundaries", () => {
  it("has no loading.tsx anywhere — a loading.tsx would turn the help 404s into 200s", () => {
    const offenders = groupFiles()
      .filter((f) => /(^|\/)loading\.(tsx|ts|jsx|js)$/.test(f))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("has no error.tsx anywhere", () => {
    const offenders = groupFiles()
      .filter((f) => /(^|\/)error\.(tsx|ts|jsx|js)$/.test(f))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("has the help routes, the layout and the 404", () => {
    const rel = groupFiles().map((f) => relative(GROUP_DIR, f));
    for (const expected of [
      "layout.tsx",
      "help/page.tsx",
      "help/[slug]/page.tsx",
      "help/planned/page.tsx",
      "help/planned/[slug]/page.tsx",
      "help/not-found.tsx",
    ]) {
      expect(rel, expected).toContain(expected);
    }
  });

  it('declares dynamic = "error" on every page', () => {
    const pages = groupFiles().filter((f) => /(^|\/)page\.tsx$/.test(f));
    expect(pages.length).toBe(4);
    for (const f of pages) {
      expect(readFileSync(f, "utf8"), relative(ROOT, f)).toMatch(/export const dynamic = "error"/);
    }
  });

  it("locks every dynamic-segment page with dynamicParams = false and generateStaticParams", () => {
    const pages = groupFiles().filter((f) => /\[[^\]]+\][\\/]page\.tsx$/.test(f));
    expect(pages.length).toBe(2);
    for (const f of pages) {
      const src = readFileSync(f, "utf8");
      expect(src, relative(ROOT, f)).toMatch(/export const dynamicParams = false/);
      expect(src, relative(ROOT, f)).toMatch(/export function generateStaticParams\(/);
    }
  });

  it("reads no session, headers, cookies or search params, and never reaches the database or authz", () => {
    const files = ownedSources();
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      const name = relative(ROOT, f);
      expect(src, name).not.toMatch(/\bauth\(\s*\)/);
      expect(src, name).not.toMatch(/\b(?:headers|cookies)\(\s*\)/);
      expect(src, name).not.toMatch(/searchParams/);
      expect(src, name).not.toMatch(/from\s+["'](?:@\/auth|next-auth[^"']*|next\/headers|@\/lib\/db[^"']*|@\/lib\/flags|@\/lib\/authz|@\/lib\/sites[^"']*)["']/);
      expect(src, name).not.toMatch(/BrandTokens|getPlatformDb/);
    }
  });

  it("never sets inner HTML", () => {
    for (const f of ownedSources()) {
      expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
