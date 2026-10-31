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
 *      headers(), cookies() or searchParams then fails `next build`. The one exception is the
 *      404 catch-all `help/[...unmatched]`, which renders no content and is `force-dynamic`
 *      so a miss is never cached; it has its own pin, and there is no root `not-found.tsx` or
 *      `global-not-found` that would change a custom host's neutral 404 (DECISION-293).
 *   3. Nothing under the group, `components/help/` or the shared renderer reaches the
 *      database, the session, request headers, flags or authz, mounts `BrandTokens`, or sets
 *      inner HTML. (check:help H19 walks the import graph; this is the same rule's cheap,
 *      always-on half for the files this batch owns.) The ONE exception is
 *      `help/contact/actions.ts`, the contact form's `"use server"` endpoint (DECISION-304,
 *      replacing the old whole-subtree exemption): it is excluded by exact path, and pinned by
 *      its own test below (its first statement, its import allow-list, its single export).
 *      The page and the client island beside it stay in the scan.
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

/** The contact form's one database-reaching file (DECISION-304). Exactly one path, never a subtree. */
const CONTACT_ACTIONS = resolve(GROUP_DIR, "help", "contact", "actions.ts");

const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);
const groupFiles = () => walk(GROUP_DIR);
const ownedSources = () =>
  [...groupFiles(), ...walk(HELP_COMPONENTS_DIR), RENDERER].filter(isSource).filter((f) => f !== CONTACT_ACTIONS);

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
      "help/[...unmatched]/page.tsx",
      "help/not-found.tsx",
    ]) {
      expect(rel, expected).toContain(expected);
    }
  });

  // The catch-all renders no content: it only calls notFound(), and it is force-dynamic on purpose
  // (see the dedicated test below), so the content-route locks do not apply to it.
  const isCatchAll = (f: string) => relative(GROUP_DIR, f) === join("help", "[...unmatched]", "page.tsx");

  it('declares dynamic = "error" on every content page (the four that render content)', () => {
    const pages = groupFiles().filter((f) => /(^|\/)page\.tsx$/.test(f) && !isCatchAll(f));
    expect(pages.length).toBe(4);
    for (const f of pages) {
      expect(readFileSync(f, "utf8"), relative(ROOT, f)).toMatch(/export const dynamic = "error"/);
    }
  });

  it("locks every dynamic-segment content page with dynamicParams = false and generateStaticParams", () => {
    const pages = groupFiles().filter((f) => /\[[^\]]+\][\\/]page\.tsx$/.test(f) && !isCatchAll(f));
    expect(pages.length).toBe(2);
    for (const f of pages) {
      const src = readFileSync(f, "utf8");
      expect(src, relative(ROOT, f)).toMatch(/export const dynamicParams = false/);
      expect(src, relative(ROOT, f)).toMatch(/export function generateStaticParams\(/);
    }
  });

  it("the help 404 catch-all is force-dynamic, imports only next/navigation, and reads nothing from the request (DECISION-293)", () => {
    const file = resolve(GROUP_DIR, "help", "[...unmatched]", "page.tsx");
    const src = stripComments(readFileSync(file, "utf8"));
    expect(src).toMatch(/export const dynamic = "force-dynamic"/);
    expect(src).not.toMatch(/generateStaticParams|generateMetadata|dynamicParams|params/);
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["next/navigation"]);
    expect(src).toMatch(/\bnotFound\(\)/);
  });

  it("has no root not-found.tsx and no global-not-found.tsx: a custom host's neutral 404 (DECISION-040) must not change", () => {
    const appDir = resolve(ROOT, "src/app");
    const present = readdirSync(appDir).filter((n) => /^(global-not-found|not-found)\.(tsx|ts|jsx|js)$/.test(n));
    expect(present).toEqual([]);
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

describe("the contact form's one server-action file (DECISION-304)", () => {
  const src = () => readFileSync(CONTACT_ACTIONS, "utf8");
  const code = () => stripComments(src());

  it("exists, and is the only file under the group that is excluded from the scan", () => {
    expect(statSync(CONTACT_ACTIONS).isFile()).toBe(true);
    const excluded = [...groupFiles(), ...walk(HELP_COMPONENTS_DIR), RENDERER]
      .filter(isSource)
      .filter((f) => !ownedSources().includes(f));
    expect(excluded.map((f) => relative(ROOT, f))).toEqual(["src/app/(documentation)/help/contact/actions.ts"]);
  });

  it('begins with "use server"', () => {
    expect(stripComments(src()).trimStart()).toMatch(/^(["'])use server\1;?/);
  });

  it("imports only next/headers, next/server, @/lib/help-contact/* and @/types/actions", () => {
    const imports = [...code().matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec, spec).toMatch(/^(next\/headers|next\/server|@\/lib\/help-contact\/[a-z-]+|@\/types\/actions)$/);
    }
  });

  it("has no auth(), cookies(), searchParams, getPlatformDb or @/auth", () => {
    expect(code()).not.toMatch(/\bauth\(\s*\)|\bcookies\(\s*\)|searchParams|getPlatformDb|@\/auth|next-auth/);
  });

  it("exports exactly one function, because every export of a use-server file is a public endpoint", () => {
    const c = code();
    const exports = [...c.matchAll(/^export\s+(?!type\b|interface\b)(.+)$/gm)].map((m) => m[1]!);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatch(/^async function submitHelpContactAction\(/);
    expect(c).not.toMatch(/^export\s+(default|\{|\*|const|let|var)/m);
  });

  it("is imported from nowhere outside its own segment (H19 S2, repeated here as a cheap always-on scan)", () => {
    const outside = walk(resolve(ROOT, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => !f.startsWith(resolve(GROUP_DIR, "help", "contact")))
      .filter((f) => /help\/contact\/actions/.test(readFileSync(f, "utf8")));
    expect(outside.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
