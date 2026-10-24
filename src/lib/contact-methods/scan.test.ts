/**
 * Static source scans for the contact-methods module (DECISION-215/216, ER1b,
 * ER3b, ER14). They are tripwires, not the real control: the behavioural DB
 * tests (`store.db.test.ts`, `ended-readers.db.test.ts`) prove the rules; these
 * catch the next file that quietly breaks them.
 *
 *   1. ALLOW-LIST. Only the module itself, the three readers and the schema
 *      file may name the contact table; a comment-only mention needs an
 *      annotated exemption (`// contact-methods-scan-ok: <reason>`). Each
 *      reader must name `ended_at` or import the shared SQL fragments.
 *   2. SINGLE WRITER. Nothing in non-test `src/` writes the table except
 *      `store.ts`, and nothing deletes from it at all (removal is `ended_at`).
 *   3. AUTH NEVER READS CONTACT EMAILS. Sign-in, password reset, email
 *      verification and the auth API name neither the table, the module nor
 *      `presby_person_email`: a contact email authenticates nothing.
 *   4. THE READER IS THE ONLY DOOR to `presby_person_email`.
 *   5. NO ADDRESSES IN AUDIT METADATA, by construction: `store.ts` builds its
 *      audit metadata from ids and labels only.
 *
 * Test support (`src/lib/testing/`) writes fixtures on the owner connection and
 * is excluded, as are `*.test.*` files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (file: string) => /\.(test|spec)\.(ts|tsx)$/.test(file);
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const raw = (file: string) => readFileSync(file, "utf8");
const code = (file: string) => stripComments(raw(file));
const rel = (file: string) => path.relative(ROOT, file);
const at = (...parts: string[]) => path.join(SRC, ...parts);

const TESTING_DIR = at("lib", "testing") + path.sep;
const APP_FILES = walk(SRC).filter((f) => !isTest(f) && !f.startsWith(TESTING_DIR));

const TABLE = /contact_methods|contactMethods/;
const MODULE_DIR = at("lib", "contact-methods") + path.sep;

const ALLOWED_TO_NAME_TABLE = new Set([
  at("lib", "directory.ts"),
  at("lib", "community.ts"),
  at("lib", "onboarding", "issue.ts"),
  at("lib", "db", "domain", "people.ts"), // the Drizzle schema
]);
/** Files that name the table in prose only, each carrying the annotation. */
const EXPECTED_EXEMPT = [
  "src/app/(public)/site/[slug]/staff-directory.tsx",
  "src/lib/children.ts",
  "src/lib/dev-docs.ts",
];
const READERS = [at("lib", "directory.ts"), at("lib", "community.ts"), at("lib", "onboarding", "issue.ts")];

describe("1. the contact table is named only where it is allowed", () => {
  const namers = APP_FILES.filter((f) => TABLE.test(raw(f)));

  it("the scan is not vacuous", () => {
    expect(namers.length).toBeGreaterThan(5);
    expect(namers).toContain(at("lib", "contact-methods", "store.ts"));
  });

  it("every file naming the table is the module, a reader, the schema, or an annotated exemption", () => {
    const offenders = namers.filter(
      (f) =>
        !f.startsWith(MODULE_DIR) &&
        !ALLOWED_TO_NAME_TABLE.has(f) &&
        !/contact-methods-scan-ok: \S/.test(raw(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the annotated exemptions are exactly the three prose-only files (the annotation cannot spread silently)", () => {
    const exempt = APP_FILES.filter((f) => /contact-methods-scan-ok:/.test(raw(f))).map(rel).sort();
    expect(exempt).toEqual([...EXPECTED_EXEMPT].sort());
    // and an exempt file really does not query the table (dev-docs.ts keeps the
    // table's NAME as a map key, which is documentation, not a query)
    for (const f of APP_FILES.filter((x) => EXPECTED_EXEMPT.includes(rel(x)))) {
      expect(code(f), rel(f)).not.toMatch(/\b(from|join|into|update)\s+contact_methods\b|\bcontactMethods\b/i);
    }
  });

  it("src/lib/people.ts does not name the table at all (it goes through the store)", () => {
    expect(raw(at("lib", "people.ts"))).not.toMatch(TABLE);
  });

  it("every reader names ended_at or imports the shared SQL fragments (the ended-row predicate has one home)", () => {
    for (const file of READERS) {
      const text = code(file);
      const ok = /\bended_at\b/.test(text) || /from\s+"@\/lib\/contact-methods\/sql"/.test(text);
      expect(ok, `${rel(file)} reads contact rows but neither names ended_at nor imports contact-methods/sql`).toBe(true);
    }
  });

  it("the directory and Community readers use the shared fragments, not their own copies of the lateral", () => {
    for (const file of [at("lib", "directory.ts"), at("lib", "community.ts")]) {
      const text = code(file);
      expect(text, rel(file)).toMatch(/from\s+"@\/lib\/contact-methods\/sql"/);
      expect(text, rel(file)).not.toMatch(/from\s+contact_methods/i);
    }
  });

  it("the shared SQL fragments filter ended rows in every statement", () => {
    const text = code(at("lib", "contact-methods", "sql.ts"));
    const froms = text.match(/from contact_methods\b/g) ?? [];
    const filtered = text.match(/ended_at is null/g) ?? [];
    expect(froms.length).toBeGreaterThanOrEqual(4);
    expect(filtered.length).toBeGreaterThanOrEqual(froms.length);
  });
});

describe("2. store.ts is the only writer, and nothing deletes", () => {
  const STORE = at("lib", "contact-methods", "store.ts");
  const WRITE = [
    /\.insert\(\s*contactMethods\b/,
    /\.update\(\s*contactMethods\b/,
    /\.delete\(\s*contactMethods\b/,
    /\binsert\s+into\s+contact_methods\b/i,
    /\bupdate\s+contact_methods\b/i,
    /\bdelete\s+from\s+contact_methods\b/i,
    /\btruncate\s+(table\s+)?contact_methods\b/i,
  ];
  const DELETE = [/\.delete\(\s*contactMethods\b/, /\bdelete\s+from\s+contact_methods\b/i, /\btruncate\s+(table\s+)?contact_methods\b/i];
  const writes = (file: string) => WRITE.some((re) => re.test(code(file)));

  it("store.ts writes (the scan is not vacuous)", () => {
    expect(writes(STORE)).toBe(true);
  });

  it("no other non-test source file writes the table", () => {
    expect(APP_FILES.filter((f) => f !== STORE && writes(f)).map(rel)).toEqual([]);
  });

  it("no non-test source file, store.ts included, deletes from it (removal is ended_at; DELETE is revoked from presby_app)", () => {
    expect(APP_FILES.filter((f) => DELETE.some((re) => re.test(code(f)))).map(rel)).toEqual([]);
  });

  it("the store never writes verified_at or created_at, and sets ended_at only to now() (the database owns them)", () => {
    const text = code(STORE);
    expect(text).not.toMatch(/verifiedAt/);
    // no `createdAt:` inside any .set({...}) or .values(...) body
    for (const m of text.matchAll(/\.(?:set|values)\(([\s\S]{0,600}?)\)\s*\.where|\.values\(([\s\S]{0,600}?)\);/g)) {
      expect(m[1] ?? m[2] ?? "").not.toMatch(/createdAt/);
    }
    for (const m of text.matchAll(/endedAt\s*:\s*([^,}\n]+)/g)) {
      expect(m[1]!.trim()).toBe("sql`now()`");
    }
  });
});

describe("3. a contact email authenticates nothing: auth paths never read contact emails", () => {
  const AUTH_ROOTS = [
    at("auth.ts"),
    at("lib", "auth"),
    at("app", "(auth)"),
    at("app", "(password-reset)"),
    at("app", "(email-verify)"),
    at("app", "api", "auth"),
  ];
  const authFiles = AUTH_ROOTS.flatMap((p) => {
    try {
      return statSync(p).isDirectory() ? walk(p) : [p];
    } catch {
      return [];
    }
  }).filter((f) => !isTest(f));

  it("the auth surface is non-empty (the scan is not vacuous)", () => {
    expect(authFiles.length).toBeGreaterThan(5);
    expect(authFiles).toContain(at("auth.ts"));
  });

  it("none of them names the table, the module, or presby_person_email", () => {
    const offenders = authFiles.filter((f) =>
      /contact_methods|contactMethods|contact-methods|presby_person_email|getPersonEmail/.test(code(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("4. reader.ts is the only TypeScript door to presby_person_email", () => {
  it("only reader.ts names the function in non-test source (an annotated prose file may describe it)", () => {
    const namers = APP_FILES.filter(
      (f) => /presby_person_email/.test(code(f)) && !/contact-methods-scan-ok: \S/.test(raw(f)),
    );
    expect(namers.map(rel)).toEqual([rel(at("lib", "contact-methods", "reader.ts"))]);
  });
});

describe("5. audit metadata carries ids and labels, never an address", () => {
  it("every audit call in store.ts builds metadata from ids and flags only", () => {
    const text = code(at("lib", "contact-methods", "store.ts"));
    const calls = [...text.matchAll(/auditEmail\([^;]*?\{([^;]*?)\}\s*,?\s*\);/gs)];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const [, body] of calls) {
      expect(body, "audit metadata must not reference a value or an address").not.toMatch(/\bvalue\b|address|\.value|email\b/i);
    }
  });
});
