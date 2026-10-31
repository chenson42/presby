/**
 * Source-scan boundaries for the contact form's server half (Phase 3 "H19
 * stopAt change", CA9, DECISION-304). Properties neither the type system nor
 * the database can see.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_CONTACT_LIMITS, HELP_CONTACT_TOPIC_KEYS } from "./contract";
import { HELP_CONTACT_TOPICS } from "@/lib/db/domain/help-contact";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
const ACTIONS = path.join(SRC, "app/(documentation)/help/contact/actions.ts");

const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => path.relative(ROOT, file);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const SPEC_RE = /(?:^|[\s;}])(?:import|export)(\s+type\b)?[^"'`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Runtime specifiers (type-only imports are erased). */
function specifiers(src: string): string[] {
  const found: string[] = [];
  for (const m of stripComments(src).matchAll(SPEC_RE)) {
    if (m[1]) continue;
    const spec = m[2] ?? m[3] ?? m[4];
    if (spec) found.push(spec);
  }
  return found;
}

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (base === null) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Every in-repo file reachable from `entry` through runtime imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const spec of specifiers(read(current))) {
      const next = resolve(spec, current);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

describe("the graph reached from actions.ts (CA9)", () => {
  it("never calls getPlatformDb(): the public action has no platform connection (the definition excepted)", () => {
    const files = reachable(ACTIONS);
    expect(files.length).toBeGreaterThan(5);
    const offenders = files
      .filter((f) => rel(f) !== "src/lib/db/index.ts")
      .filter((f) => /\bgetPlatformDb\s*\(/.test(stripComments(read(f))));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never reaches inbox.ts, the one file here that may call getPlatformDb", () => {
    expect(reachable(ACTIONS).map(rel)).not.toContain("src/lib/help-contact/inbox.ts");
  });
});

describe("inbox.ts is not importable from the public documentation tree (CA9)", () => {
  it("nothing under src/app/(documentation)/** or src/components/help/** imports it", () => {
    const files = [...walk(path.join(SRC, "app/(documentation)")), ...walk(path.join(SRC, "components/help"))];
    const offenders = files.filter((f) => /help-contact\/inbox/.test(stripComments(read(f))));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("only the inbox and the admin messages tree may call getPlatformDb under help-contact", () => {
    const callers = walk(path.join(SRC, "lib/help-contact"))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /\bgetPlatformDb\s*\(/.test(stripComments(read(f))))
      .map(rel);
    expect(callers.every((c) => c === "src/lib/help-contact/inbox.ts")).toBe(true);
  });
});

describe("the pure files stay pure (the client island walks them)", () => {
  for (const name of ["contract.ts", "copy.ts", "validate.ts", "configured.ts"]) {
    it(`${name} imports no server-only, no database, no next/*`, () => {
      const file = path.join(SRC, "lib/help-contact", name);
      for (const spec of specifiers(read(file))) {
        expect(spec, `${name} imports ${spec}`).not.toMatch(/^server-only$|^@\/lib\/db(\/|$)|^next(\/|$)|^@\/auth$/);
      }
    });
  }
  it("contract.ts and copy.ts import nothing at all", () => {
    for (const name of ["contract.ts", "copy.ts"]) {
      expect(specifiers(read(path.join(SRC, "lib/help-contact", name)))).toEqual([]);
    }
  });
});

describe("the TypeScript and migration 0083 agree", () => {
  const sql = read(path.join(ROOT, "drizzle/0083_presby_help_contact.sql"));

  it("the topic keys equal the domain mirror's and appear in the CHECK", () => {
    expect([...HELP_CONTACT_TOPIC_KEYS]).toEqual([...HELP_CONTACT_TOPICS]);
    const check = /help_contact_topic_allowed[\s\S]*?\)\s*;/.exec(sql)?.[0] ?? "";
    for (const key of HELP_CONTACT_TOPIC_KEYS) expect(check).toContain(`'${key}'`);
  });

  it("the bounds equal the CHECK's", () => {
    const bounds = /help_contact_bounds[\s\S]*?\)\s*;/.exec(sql)?.[0] ?? "";
    expect(bounds).toMatch(new RegExp(`char_length\\(name\\)\\s*<=\\s*${HELP_CONTACT_LIMITS.name}\\b`));
    expect(bounds).toMatch(new RegExp(`char_length\\(congregation\\)\\s*<=\\s*${HELP_CONTACT_LIMITS.congregation}\\b`));
    expect(bounds).toMatch(new RegExp(`char_length\\(email\\)\\s*<=\\s*${HELP_CONTACT_LIMITS.email}\\b`));
    expect(bounds).toMatch(new RegExp(`char_length\\(message\\)\\s*<=\\s*${HELP_CONTACT_LIMITS.messageMax}\\b`));
    expect(bounds).toMatch(new RegExp(`>=\\s*${HELP_CONTACT_LIMITS.messageMin}\\b`));
  });

  it("the email regex in validate.ts is the CHECK's, plus the whitespace rule", () => {
    expect(sql).toContain("'^[^@]+@[^@]+\\.[^@]+$'");
    expect(read(path.join(SRC, "lib/help-contact/validate.ts"))).toContain("/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/");
  });
});
