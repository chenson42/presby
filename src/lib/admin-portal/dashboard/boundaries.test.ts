/**
 * Source-scan boundaries for the platform dashboard's readers (docs/work-log/
 * 2026-10-25-platform-admin-redesign-inc1.md, Phase 2 R7b, DECISION-252). Pure
 * file reads: no database, always run. Modelled on
 * `src/lib/onboarding/boundaries.test.ts`.
 *
 * The platform tier shows platform-axis data only: organizations, accounts,
 * invitations, queue rows, tickets and feedback (as counts), domains, sites,
 * flags and audit rows. It never shows a count or content derived from people,
 * the roll, gifts, events or attendance. This test makes that the DEFAULT: a
 * reader may reach only the tables, the one `presby_*` function and the modules
 * listed below, so a NEW tenant table is forbidden until someone edits this list
 * on purpose, in review.
 *
 * Every non-test file in this directory is held to:
 *   1. TABLES BY IMPORT. Imports from `@/lib/db/schema` and `@/lib/db/domain/*`
 *      name only allow-listed tables.
 *   2. TABLES BY SQL. Every `from` / `join` identifier in raw `sql` text is an
 *      allow-listed table (snake_case) or a CTE the same file declares.
 *   3. FUNCTIONS. The only `presby_*` function named is
 *      `presby_founding_administrator_holder_count` (unused in Increment 1;
 *      permitted for Increment 2, which shares this directory).
 *   4. MODULES. The only `@/` modules imported are the allow-listed ones below.
 *   5. METADATA. `metadata` appears only as a `metadata->>'path'` extraction
 *      (E17): an audit row's metadata is never selected whole.
 *   6. HOW A READER TOUCHES THE DATABASE IS ALLOW-ONLY (loop-back 2: the deny
 *      patterns above were beaten three more ways, so the property is now stated
 *      as the forms that are permitted, and everything else is an offender):
 *        - a relative import must be a `./` sibling; any path that leaves the
 *          directory (or climbs with `..`) is an offender, as is any bare module
 *          other than `server-only` and `drizzle-orm`;
 *        - `.query.` / `["query"]` access is an offender: readers use the query
 *          builder or `sql` only, because `getPlatformDb()` carries the whole
 *          schema (`schema.ts` re-exports `./domain`) on its relational API;
 *        - the first argument of `.from(` and of every `...Join(` / `.join(` must
 *          be an identifier bound directly by an allow-listed table import; a
 *          `sql` fragment, member expression, call or local alias is an offender
 *          (`sql.join(` builds a fragment list, not a table, and is exempt);
 *        - a db handle comes from `getPlatformDb` in `@/lib/db` and nowhere else:
 *          `drizzle(`, `neon(`, `new Pool(` and `new Client(` are offenders.
 * The allow-list covers the Increment 2 cards as well as Increment 1's subset,
 * because they share this directory (the Phase 2 list, not Increment 1's).
 *
 * THE ONE RECORDED EXCEPTION (DECISION-252, F276, operator ruling Q8). "Required
 * but not enrolled" resolves through `people` and `memberships`. That predicate
 * lives in `src/lib/admin/two-factor-stranded.ts`, OUTSIDE this directory on
 * purpose, returns accounts or a count, and exports no member count. The
 * per-organization `member_count` stays page-local in `2fa/page.tsx`. Both are
 * pinned below (E20). Accepted residual (`paper`): nothing prevents a future
 * reader from reading a tenant table outside this directory; this scan, review
 * and the retrospective are the controls.
 *
 * ACCEPTED RESIDUAL OF THE SCAN ITSELF (`paper`): it reads source text. It cannot
 * see a computed property access (`db[key]`), a table reached through a value
 * produced elsewhere, or an allow-listed module (`@/lib/sites`, `@/lib/flags`,
 * ...) that itself reaches a tenant table.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(ROOT, "src");
const DASHBOARD = __dirname;

const ALLOWED_TABLES_SQL = [
  "organizations",
  "organization_brands",
  "organization_settings",
  "account_invitations",
  "audit_events",
  "email_queue",
  "tickets",
  "feedback",
  "users",
  "organization_domains",
  "organization_sites",
  "feature_flags",
  "organization_feature_toggles",
  "organization_feature_categories",
] as const;

/** The Drizzle export names of the same tables. `organizationSettings` is allowed for its `require_two_factor` column only. */
const ALLOWED_TABLES_IMPORT = [
  "organizations",
  "organizationBrands",
  "organizationSettings",
  "accountInvitations",
  "auditEvents",
  "emailQueue",
  "tickets",
  "feedback",
  "users",
  "organizationDomains",
  "organizationSites",
  "featureFlags",
  "organizationFeatureToggles",
  "organizationFeatureCategories",
] as const;

const ALLOWED_FUNCTIONS = ["presby_founding_administrator_holder_count"] as const;

const ALLOWED_MODULES = [
  "admin/giving-ingest-health",
  "admin/two-factor-stranded",
  "domains/platform-read",
  "sites",
  "onboarding/status",
  "flags",
  "db",
  "permissions",
  "admin/format-age",
] as const;

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const isTest = (file: string) => /\.(test|spec)\.(ts|tsx)$/.test(file);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// ---- the checks, pure so they can be proven against synthetic offenders ----

const DB = "@/lib/db";
const ALLOWED_DB_VALUES = ["getPlatformDb"] as const;

/** `@/lib/db` exactly, `@/lib/db/schema`, the `@/lib/db/domain` barrel, or a file under it: the only db modules a reader may name. */
const isTableModule = (spec: string) => spec === `${DB}/schema` || spec === `${DB}/domain` || spec.startsWith(`${DB}/domain/`);
const isDbSpec = (spec: string) => spec === DB || spec.startsWith(`${DB}/`);

interface ImportStatement {
  /** `{ a, b as c }`, `* as ns`, `def`, `def, { a }`, or "" for a side-effect import. */
  clause: string;
  spec: string;
  /** A dynamic `import()` / `require()`: no clause can be read, so it is treated as a namespace. */
  dynamic: boolean;
}

const CLAUSE = String.raw`\*(?:\s*as\s+[\w$]+)?|\{[^}]*\}|[\w$]+(?:\s*,\s*(?:\*\s*as\s+[\w$]+|\{[^}]*\}))?`;

/** Every import, re-export, side-effect import and dynamic import in the code, quote style and line breaks notwithstanding. */
function importStatements(code: string): ImportStatement[] {
  const out: ImportStatement[] = [];
  for (const m of code.matchAll(new RegExp(String.raw`\b(?:import|export)\s+(?:type\s+)?(${CLAUSE})\s*from\s*["']([^"']+)["']`, "g"))) {
    out.push({ clause: m[1]!.trim(), spec: m[2]!, dynamic: false });
  }
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.push({ clause: "", spec: m[1]!, dynamic: false });
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]/g)) out.push({ clause: "", spec: m[1]!, dynamic: true });
  return out;
}

/** The `{ imported as local }` pairs of a clause. `local` is the identifier the file then uses. */
function namedBindings(clause: string): { imported: string; local: string }[] {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces) return [];
  return braces[1]!
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((n) => n.trim()))
    .filter((names) => names[0])
    .map((names) => ({ imported: names[0]!, local: names[1] ?? names[0]! }));
}

/** The names a `{ ... }` clause imports (before any `as`). */
const namedImports = (clause: string): string[] => namedBindings(clause).map((b) => b.imported);

/**
 * Everything wrong with how the code reaches `@/lib/db/**`: a namespace, default,
 * dynamic or re-export form (the names behind it cannot be read), a db module that
 * is not the schema or the domain barrel, or a named import that is not an
 * allow-listed table. `@/lib/db` itself carries only `getPlatformDb`.
 */
function dbImportOffenders(code: string): string[] {
  const out: string[] = [];
  for (const { clause, spec, dynamic } of importStatements(code)) {
    if (!isDbSpec(spec)) continue;
    if (spec !== DB && !isTableModule(spec)) {
      out.push(`${spec}: not a schema or domain module`);
      continue;
    }
    if (dynamic) out.push(`${spec}: dynamic import`);
    else if (/^\*/.test(clause) || /,\s*\*/.test(clause)) out.push(`${spec}: namespace or re-export (${clause})`);
    else if (clause && !clause.startsWith("{")) out.push(`${spec}: default import (${clause})`);
    else if (!clause) out.push(`${spec}: side-effect import`);
    const allowed: readonly string[] = spec === DB ? ALLOWED_DB_VALUES : ALLOWED_TABLES_IMPORT;
    for (const name of namedImports(clause)) if (!allowed.includes(name)) out.push(`${spec}: ${name}`);
  }
  return out;
}

const SQL_STOP_WORDS = new Set([
  "where", "join", "inner", "left", "right", "full", "cross", "natural", "on", "using", "group", "order", "limit",
  "offset", "having", "union", "except", "intersect", "returning", "window", "for", "lateral", "tablesample",
]);
const SQL_NAME = String.raw`(?:\\?"([^"\\]+)\\?"|([a-z_][a-z0-9_]*))`;

/**
 * Every table named after `from` / `join` in SQL text, minus CTE names the file
 * declares. Reads a whole comma-separated `from` list (`from a x, b y`), unquotes
 * a quoted identifier (`from "b"`, also as it appears escaped inside a JS string),
 * keeps only the table of a schema-qualified one, and reports an interpolated
 * `${...}` as `${}` because its target cannot be read.
 */
function sqlTables(code: string): string[] {
  const ctes = new Set<string>();
  for (const m of code.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) ctes.add(m[1]!.toLowerCase());
  for (const m of code.matchAll(/\)\s*,\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) ctes.add(m[1]!.toLowerCase());
  // An import's `from "..."` is a module path, not a table.
  const sqlText = code.replace(new RegExp(String.raw`\b(?:import|export)\s+(?:type\s+)?(?:${CLAUSE})\s*from\s*["'][^"']+["']`, "g"), "");
  const tables: string[] = [];
  for (const m of sqlText.matchAll(/\b(from|join)\s+/gi)) {
    const isFrom = m[1]!.toLowerCase() === "from";
    let rest = sqlText.slice(m.index! + m[0].length);
    for (;;) {
      if (rest.startsWith("${")) {
        tables.push("${}");
        rest = rest.slice(rest.indexOf("}") + 1);
      } else {
        const ref = rest.match(new RegExp(`^${SQL_NAME}(?:\\.${SQL_NAME})?`, "i"));
        if (!ref) break; // a subquery "(", or text that is not an identifier
        const ident = (ref[4] ?? ref[3] ?? ref[2] ?? ref[1])!.toLowerCase();
        if (!ctes.has(ident)) tables.push(ident);
        rest = rest.slice(ref[0].length);
      }
      if (!isFrom) break;
      const alias = rest.match(/^\s+(?:as\s+)?([a-z_][a-z0-9_]*)/i);
      if (alias && !SQL_STOP_WORDS.has(alias[1]!.toLowerCase())) rest = rest.slice(alias[0].length);
      const comma = rest.match(/^\s*,\s*/);
      if (!comma) break;
      rest = rest.slice(comma[0].length);
    }
  }
  return tables;
}

/** The only bare (package) modules a reader may import. A driver, a pool or a second client is not on this list. */
const ALLOWED_BARE_MODULES = ["server-only", "drizzle-orm"] as const;

/**
 * Every import whose path is relative and is not a `./name` sibling, and every bare
 * module that is not allow-listed. `@/` paths are `aliasImports`' job. A relative
 * path out of the directory reaches `src/lib/db/**` with no `@/` for anything to see.
 */
function moduleSpecOffenders(code: string): string[] {
  const out: string[] = [];
  for (const { spec } of importStatements(code)) {
    if (spec.startsWith(".")) {
      if (!/^\.\/[\w$.-]+$/.test(spec) || spec.includes("..")) out.push(`relative import ${spec}`);
    } else if (!spec.startsWith("@/") && !(ALLOWED_BARE_MODULES as readonly string[]).includes(spec)) {
      out.push(`bare module ${spec}`);
    }
  }
  return out;
}

/** `.query` as a property, by dot, optional chain or a literal bracket key: the relational API reaches every table in the schema. */
function queryApiAccess(code: string): string[] {
  const dotted = [...code.matchAll(/(?:\?\.|\.)\s*query\b/g)];
  const bracketed = [...code.matchAll(/\[\s*["'`]query["'`]\s*\]/g)];
  return [...dotted, ...bracketed].map(() => ".query access");
}

/** The local identifiers a file has bound, by import, to an allow-listed table. */
function tableBindings(code: string): Set<string> {
  const bound = new Set<string>();
  for (const { clause, spec, dynamic } of importStatements(code)) {
    if (dynamic || !isTableModule(spec)) continue;
    for (const { imported, local } of namedBindings(clause)) {
      if ((ALLOWED_TABLES_IMPORT as readonly string[]).includes(imported)) bound.add(local);
    }
  }
  return bound;
}

const BUILDER_TABLE_CALL = /\??\.\s*(from|join|[a-z]*Join[A-Za-z]*)\s*\(\s*/g;

/**
 * Every `.from(` / `.xxxJoin(` / `.join(` whose first argument is not a bare
 * identifier bound by an allow-listed table import. `sql.join(` is the one
 * exemption: it joins fragments in a list, it is not a table position.
 */
function builderTableOffenders(code: string): string[] {
  const bound = tableBindings(code);
  const out: string[] = [];
  for (const m of code.matchAll(BUILDER_TABLE_CALL)) {
    const receiver = code.slice(0, m.index!).match(/([\w$]*)\s*$/)![1];
    if (m[1] === "join" && receiver === "sql") continue;
    const rest = code.slice(m.index! + m[0].length);
    const arg = rest.match(/^([\w$]+)\s*(?=[,)])/);
    if (!arg || !bound.has(arg[1]!)) out.push(`builder table argument .${m[1]}(${rest.slice(0, 24).replace(/\s+/g, " ")}`);
  }
  return out;
}

/** A db handle built in the reader rather than taken from `getPlatformDb`. */
function dbHandleOffenders(code: string): string[] {
  return [...code.matchAll(/\b(?:drizzle|neon)\s*\(|\bnew\s+(?:Pool|Client)\s*\(/g)].map((m) => `db handle ${m[0].replace(/\s+/g, " ")}`);
}

function presbyFunctions(code: string): string[] {
  return [...code.matchAll(/\bpresby_[a-z0-9_]+/g)].map((m) => m[0]);
}

/** The path after `@/lib/` of every `@/` import, plus any `@/` import outside lib (returned whole). */
function aliasImports(code: string): string[] {
  return [...code.matchAll(/(?:\bfrom\s*|\b(?:import|require)\s*\(?\s*)["'`](@\/[^"'`]+)["'`]/g)].map((m) => m[1]!);
}

function bareMetadata(code: string): string[] {
  return [...code.matchAll(/\bmetadata\b(?!->>)/g)].map((m) => m[0]);
}

function moduleAllowed(spec: string): boolean {
  if (!spec.startsWith("@/lib/")) return false;
  const rest = spec.slice("@/lib/".length);
  // `db` is allowed by exact name; what may be named under `@/lib/db/` is dbImportOffenders' job.
  return ALLOWED_MODULES.some((mod) => rest === mod) || (isDbSpec(spec) && isTableModule(spec));
}

/** Every category of offence the scan reports for one file's code (the real readers, or a synthetic one). */
function offenders(code: string): string[] {
  return [
    ...dbImportOffenders(code).map((o) => `import ${o}`),
    ...sqlTables(code).filter((t) => !(ALLOWED_TABLES_SQL as readonly string[]).includes(t)).map((t) => `sql ${t}`),
    ...presbyFunctions(code).filter((f) => !(ALLOWED_FUNCTIONS as readonly string[]).includes(f)).map((f) => `function ${f}`),
    ...aliasImports(code).filter((s) => !moduleAllowed(s)).map((s) => `module ${s}`),
    ...bareMetadata(code).map(() => "metadata"),
    ...moduleSpecOffenders(code),
    ...queryApiAccess(code),
    ...builderTableOffenders(code),
    ...dbHandleOffenders(code),
  ];
}

const FILES = walk(DASHBOARD).filter((f) => !isTest(f));
const rel = (file: string) => path.relative(ROOT, file);
const read = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("the scan is not vacuous", () => {
  it("covers the readers, and catches a synthetic offender of each kind", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(12);
    expect(FILES.map((f) => path.basename(f))).toEqual(expect.arrayContaining(["tickets.ts", "recent-changes.ts", "read-card.ts"]));

    expect(dbImportOffenders(`import { people, users as u, type Foo } from "@/lib/db/domain/people";`)).toEqual([
      "@/lib/db/domain/people: people",
      "@/lib/db/domain/people: Foo",
    ]);
    expect(dbImportOffenders(`import {\n  organizations,\n  auditEvents,\n} from "@/lib/db/schema";`)).toEqual([]);
    expect(sqlTables("select 1 from people p join memberships m on true")).toEqual(["people", "memberships"]);
    expect(sqlTables("with recent as (select 1 from audit_events) select * from recent")).toEqual(["audit_events"]);
    expect(presbyFunctions("select presby_roll_as_of(1)")).toEqual(["presby_roll_as_of"]);
    expect(aliasImports(`import { x } from "@/lib/giving/ledger";`)).toEqual(["@/lib/giving/ledger"]);
    expect(moduleAllowed("@/lib/giving/ledger")).toBe(false);
    expect(moduleAllowed("@/components/shared/count-card")).toBe(false);
    expect(moduleAllowed("@/lib/sites")).toBe(true);
    expect(bareMetadata("select metadata from audit_events")).toEqual(["metadata"]);
    expect(bareMetadata("select metadata->>'a' from audit_events")).toEqual([]);
  });

  // QA's mutation table (Phase 5, finding 1): each form reaches the tenant table
  // `officer_terms` and must be reported. Every one slipped past the first scan.
  it.each([
    [
      "the barrel plus a query-builder .from()",
      `import { getPlatformDb } from "@/lib/db";\nimport { officerTerms } from "@/lib/db/domain";\nexport const r = () => getPlatformDb().select().from(officerTerms);`,
    ],
    ["a comma join in raw SQL", "export const q = sql`select 1 from organizations o, officer_terms t where t.organization_id = o.id`;"],
    ["a quoted identifier in raw SQL", 'export const q = sql`select 1 from "officer_terms"`;'],
    [
      "a namespace import",
      `import * as domain from "@/lib/db/domain/officers";\nexport const r = () => getPlatformDb().select().from(domain.officerTerms);`,
    ],
    ["a single-quoted barrel import across lines", "import {\n  officerTerms,\n} from '@/lib/db/domain';"],
    ["a dynamic import", 'export const load = () => import("@/lib/db/domain/officers");'],
    ["a re-export of the barrel", 'export * from "@/lib/db/domain";'],
    ["a schema-qualified quoted identifier inside a JS string", 'export const q = sql.raw("select 1 from public.\\"officer_terms\\"");'],
    ["a schema-qualified table", "export const q = sql`select 1 from public.officer_terms`;"],
    ["an interpolated table", "export const q = sql`select 1 from ${officerTerms}`;"],
    ["a comma join after an alias with AS", "export const q = sql`select 1 from organizations as o , officer_terms as t`;"],
    ["a table named only on a join", "export const q = sql`select 1 from organizations o join officer_terms t on t.organization_id = o.id`;"],
  ])("reports a tenant table reached through %s", (_form, code) => {
    // Reported for the tenant table or the db module itself, not by accident of some other rule.
    expect(offenders(code).some((o) => /officer_terms|officerTerms|@\/lib\/db|\$\{\}/.test(o))).toBe(true);
  });

  // QA's run-2 mutation table (M6-M8) and further evasions of the same class. These
  // are not table names or import shapes the scan could list: they are other ways to
  // hand the platform connection a tenant table. The scan is ALLOW-ONLY for how a
  // reader touches the database, so each must be reported by the rule that names the
  // allowed form, with the label asserted so it is not caught by accident of another.
  it.each([
    [
      "M6: a relative import that leaves the directory",
      `import { getPlatformDb } from "@/lib/db";\nimport { officerTerms } from "../../db/domain/officers";\nexport const r = () => getPlatformDb().select().from(officerTerms);`,
      /^relative import \.\.\/\.\.\/db\/domain\/officers/,
    ],
    [
      "M7: the relational query API, no import and no SQL text",
      `import { getPlatformDb } from "@/lib/db";\nexport const r = () => getPlatformDb().query.officerTerms.findMany({ columns: { id: true } });`,
      /^\.query access/,
    ],
    [
      "M8: a sql fragment as the query builder's table",
      "import { getPlatformDb } from \"@/lib/db\";\nimport { sql } from \"drizzle-orm\";\nexport const r = () => getPlatformDb().select({ n: count() }).from(sql`officer_terms`);",
      /^builder table argument \.from\(sql`/,
    ],
    [
      "a sql fragment as a joined table",
      "export const r = () => getPlatformDb().select().from(organizations).leftJoin(sql`officer_terms`, sql`true`);",
      /^builder table argument \.leftJoin\(sql`/,
    ],
    [
      "a local alias of an allowed table (the binding is no longer an import)",
      `import { organizations } from "@/lib/db/schema";\nconst t = pick() ?? organizations;\nexport const r = () => getPlatformDb().select().from(t);`,
      /^builder table argument \.from\(t\)/,
    ],
    [
      "a member expression as the builder's table",
      `import { organizations } from "@/lib/db/schema";\nexport const r = () => getPlatformDb().select().from(tables.officerTerms);`,
      /^builder table argument \.from\(tables\.officerTerms/,
    ],
    ["bracket access to the relational query API", `export const r = () => getPlatformDb()["query"].officerTerms.findFirst();`, /^\.query access/],
    ["optional-chained .query access", `export const r = () => getPlatformDb()?.query.officerTerms.findFirst();`, /^\.query access/],
    [
      "a dynamic relative require",
      `export const load = () => require("../../db/domain/officers");`,
      /^relative import \.\.\/\.\.\/db\/domain\/officers/,
    ],
    [
      "a sibling-looking relative path that climbs out and back in",
      `import { x } from "./../read-card";`,
      /^relative import \.\/\.\.\/read-card/,
    ],
    [
      "a second connection built from a driver import",
      `import { Pool } from "@neondatabase/serverless";\nexport const pool = new Pool({ connectionString: "x" });`,
      /^bare module @neondatabase\/serverless/,
    ],
    [
      "a drizzle() handle built in the reader",
      `import { drizzle } from "drizzle-orm/neon-serverless";\nexport const d = drizzle(somePool);`,
      /^db handle drizzle\(/,
    ],
    ["a drizzle() handle with no import in view", `export const d = drizzle(somePool);`, /^db handle drizzle\(/],
  ])("reports %s", (_form, code, label) => {
    expect(offenders(code).some((o) => label.test(o))).toBe(true);
  });

  it("does not report the idioms the real readers use", () => {
    expect(
      offenders(
        `import { getPlatformDb } from "@/lib/db";\nimport { organizations } from "@/lib/db/schema";\nimport { sql } from "drizzle-orm";\n` +
          "export const q = sql`select 1 from organizations o left join audit_events a on a.resource_id = o.id`;\n" +
          "export const j = sql.join([sql`a`, sql`b`], sql`, `);",
      ),
    ).toEqual([]);
    // The query builder is allowed when its tables are imported allow-listed tables, aliased or not.
    expect(
      offenders(
        `import { organizations, auditEvents as events } from "@/lib/db/schema";\nimport { read } from "./read-card";\nimport "server-only";\n` +
          `export const r = () => getPlatformDb().select().from(organizations).leftJoin(\n  events,\n  eq(events.resourceId, organizations.id),\n);`,
      ),
    ).toEqual([]);
  });
});

describe("R7b: dashboard readers reach platform-axis tables only", () => {
  it("imports from @/lib/db/** name only allow-listed tables, in a readable form", () => {
    const found = FILES.flatMap((f) => dbImportOffenders(read(f)).map((o) => `${rel(f)}: ${o}`));
    expect(found).toEqual([]);
  });

  it("every from/join identifier in raw SQL is an allow-listed table", () => {
    const offenders = FILES.flatMap((f) =>
      sqlTables(read(f))
        .filter((t) => !(ALLOWED_TABLES_SQL as readonly string[]).includes(t))
        .map((t) => `${rel(f)}: ${t}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the only presby_* function named is the allow-listed one", () => {
    const offenders = FILES.flatMap((f) =>
      presbyFunctions(read(f))
        .filter((fn) => !(ALLOWED_FUNCTIONS as readonly string[]).includes(fn))
        .map((fn) => `${rel(f)}: ${fn}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the only @/ modules imported are the allow-listed ones", () => {
    const offenders = FILES.flatMap((f) =>
      aliasImports(read(f))
        .filter((spec) => !moduleAllowed(spec))
        .map((spec) => `${rel(f)}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("imports are `./` siblings, `@/` allow-listed modules, or server-only and drizzle-orm", () => {
    expect(FILES.flatMap((f) => moduleSpecOffenders(read(f)).map((o) => `${rel(f)}: ${o}`))).toEqual([]);
  });

  it("no reader uses the relational query API", () => {
    expect(FILES.flatMap((f) => queryApiAccess(read(f)).map((o) => `${rel(f)}: ${o}`))).toEqual([]);
  });

  it("every query-builder table argument is an identifier bound by an allow-listed table import", () => {
    expect(FILES.flatMap((f) => builderTableOffenders(read(f)).map((o) => `${rel(f)}: ${o}`))).toEqual([]);
  });

  it("no reader builds its own db handle", () => {
    expect(FILES.flatMap((f) => dbHandleOffenders(read(f)).map((o) => `${rel(f)}: ${o}`))).toEqual([]);
  });

  it("metadata appears only as a metadata->>'path' extraction (E17)", () => {
    const offenders = FILES.filter((f) => bareMetadata(read(f)).length > 0).map(rel);
    expect(offenders).toEqual([]);
  });

  it("every reader runs on the platform connection and none touches the tenant one", () => {
    const offenders = FILES.filter((f) => /import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*"@\/lib\/db"/.test(read(f)) || /withOrgContext/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no reader links into a tenant route", () => {
    expect(FILES.filter((f) => /["'`]\/o\//.test(read(f))).map(rel)).toEqual([]);
  });
});

describe("E20: the 2FA exception stays one module", () => {
  const TREES = [path.join(SRC, "app", "(admin)"), path.join(SRC, "lib", "admin"), path.join(SRC, "lib", "admin-portal")];
  const TREE_FILES = TREES.flatMap(walk).filter((f) => !isTest(f));

  it("member_count appears only in the 2FA page, in the platform tier", () => {
    expect(TREE_FILES.length).toBeGreaterThan(20);
    const holders = TREE_FILES.filter((f) => /\bmember_count\b/.test(read(f))).map(rel);
    expect(holders).toEqual([rel(path.join(SRC, "app", "(admin)", "admin", "2fa", "page.tsx"))]);
  });

  it("two-factor-stranded.ts lives outside the scanned directory and returns accounts or a count, never a member count", () => {
    const file = path.join(SRC, "lib", "admin", "two-factor-stranded.ts");
    expect(file.startsWith(DASHBOARD + path.sep)).toBe(false);
    const code = read(file);
    expect(code).toMatch(/export (?:async )?function countStranded/);
    expect(code).toMatch(/export (?:async )?function listStranded/);
    expect(code).not.toMatch(/member_?count/i);
    expect(code).not.toMatch(/count\(m\./);
  });

  it("the dashboard directory never names people or memberships itself", () => {
    const offenders = FILES.filter((f) => /\b(?:people|memberships|roll_actions|giving_gifts)\b/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});
