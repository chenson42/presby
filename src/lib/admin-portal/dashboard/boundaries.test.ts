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

/** The names a `{ ... }` clause imports (before any `as`). */
function namedImports(clause: string): string[] {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces) return [];
  return braces[1]!
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim())
    .filter(Boolean);
}

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

  it("does not report the idioms the real readers use", () => {
    expect(
      offenders(
        `import { getPlatformDb } from "@/lib/db";\nimport { organizations } from "@/lib/db/schema";\nimport { sql } from "drizzle-orm";\n` +
          "export const q = sql`select 1 from organizations o left join audit_events a on a.resource_id = o.id`;",
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
