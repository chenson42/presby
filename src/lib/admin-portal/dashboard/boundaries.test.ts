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

/** Names imported from `@/lib/db/schema` or `@/lib/db/domain/*`. */
function importedTables(code: string): string[] {
  const names: string[] = [];
  for (const m of code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"@\/lib\/db\/(?:schema|domain\/[^"]+)"/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** `from <ident>` / `join <ident>` in SQL text, minus CTE names the file declares. */
function sqlTables(code: string): string[] {
  const ctes = new Set<string>();
  for (const m of code.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) ctes.add(m[1]!.toLowerCase());
  for (const m of code.matchAll(/\)\s*,\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) ctes.add(m[1]!.toLowerCase());
  const tables: string[] = [];
  for (const m of code.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)) {
    const ident = m[1]!.toLowerCase();
    if (!ctes.has(ident)) tables.push(ident);
  }
  return tables;
}

function presbyFunctions(code: string): string[] {
  return [...code.matchAll(/\bpresby_[a-z0-9_]+/g)].map((m) => m[0]);
}

/** The path after `@/lib/` of every `@/` import, plus any `@/` import outside lib (returned whole). */
function aliasImports(code: string): string[] {
  return [...code.matchAll(/from\s*"(@\/[^"]+)"/g)].map((m) => m[1]!);
}

function bareMetadata(code: string): string[] {
  return [...code.matchAll(/\bmetadata\b(?!->>)/g)].map((m) => m[0]);
}

function moduleAllowed(spec: string): boolean {
  if (!spec.startsWith("@/lib/")) return false;
  const rest = spec.slice("@/lib/".length);
  return ALLOWED_MODULES.some((mod) => rest === mod || (mod === "db" && rest.startsWith("db/")));
}

const FILES = walk(DASHBOARD).filter((f) => !isTest(f));
const rel = (file: string) => path.relative(ROOT, file);
const read = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("the scan is not vacuous", () => {
  it("covers the readers, and catches a synthetic offender of each kind", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(12);
    expect(FILES.map((f) => path.basename(f))).toEqual(expect.arrayContaining(["tickets.ts", "recent-changes.ts", "read-card.ts"]));

    expect(importedTables(`import { people, users as u, type Foo } from "@/lib/db/domain/people";`)).toEqual(["people", "users", "Foo"]);
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
});

describe("R7b: dashboard readers reach platform-axis tables only", () => {
  it("imports name only allow-listed tables", () => {
    const offenders = FILES.flatMap((f) =>
      importedTables(read(f))
        .filter((name) => !(ALLOWED_TABLES_IMPORT as readonly string[]).includes(name))
        .map((name) => `${rel(f)}: ${name}`),
    );
    expect(offenders).toEqual([]);
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
