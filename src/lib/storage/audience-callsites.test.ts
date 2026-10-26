/**
 * U4 - the audience call-site pin (F289, DECISION-277, R6;
 * docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3 "Test Plan" U4).
 *
 * Type checking makes `audience` a REQUIRED argument of `store()`, `resolve()`
 * and `resolveMeta()`, so an omission cannot compile. It cannot catch the WRONG
 * constant: `resolve({ ..., audience: "public_site" })` in a statement download
 * route compiles and silently reads (or silently misses) the wrong audience.
 * This scan pins the literal each call site passes.
 *
 * It walks every non-test source file under `src/` with the TypeScript
 * compiler API and, for every `getBlobStore().<method>(...)` call, reads the
 * first argument's object literal:
 *
 *   - every method needs `audience: "public_site" | "private"` as a STRING
 *     LITERAL (not a variable, not a conditional), EXCEPT the named exemptions
 *     below, which must NOT carry an `audience` at all (`resolvePublic()`: the
 *     database door `presby_public_site_asset()` is its contract);
 *   - the number of `getBlobStore` references in a file must equal the number
 *     of matched calls, so `const s = getBlobStore()` aliasing (which would
 *     hide a call from this scan) fails;
 *   - the calls, in source order, must equal the checked-in table below.
 *
 * A LATER ADAPTER METHOD (the site-ingest pipeline's `findByContentHashes`;
 * the person-photos pipeline's `resolveMany` is the one that arrived) needs only
 * a table edit here, never a change to the scan logic: it is held to "audience literal required" by
 * default, or added to EXEMPT_METHODS with the reason.
 *
 * THE TABLE IS THE ONLY THING A LATER PIPELINE EDITS. ACTIVE holds every file
 * that exists today (the scan fails on any difference, either direction).
 * FORWARD holds rows for files that land with a later pipeline, each with a
 * `since` note: a FORWARD file that does not exist yet is skipped; once it
 * exists it is held to its row exactly as an ACTIVE file is (a FORWARD file that
 * exists with no matching call is a stale row and fails). When its pipeline
 * merges, move the row from FORWARD to ACTIVE.
 *
 * Second assertion (DECISION-030): `blob_assets` is queried nowhere but
 * `src/lib/storage/blob-store.ts`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import ts from "typescript";

const SRC = join(process.cwd(), "src");

/** Methods exempt from "audience literal required". They must NOT pass an audience. */
const EXEMPT_METHODS: Record<string, string> = {
  resolvePublic: "its contract is the database door presby_public_site_asset(), which decides what is public",
};

const AUDIENCES = new Set(["public_site", "private"]);

/** Every file that calls getBlobStore() today, with its calls in source order. */
const ACTIVE: Record<string, string[]> = {
  "src/app/(admin)/admin/organizations/[id]/actions.ts": ["store:public_site"], // the logo
  "src/app/(admin)/admin/organizations/[id]/page.tsx": ["resolve:public_site"], // the mark preview
  "src/app/(admin)/admin/tickets/[id]/attachments/[key]/route.ts": ["resolve:private"],
  "src/app/(admin)/admin/tickets/[id]/page.tsx": ["resolveMeta:private"],
  "src/app/(admin)/admin/tickets/actions.ts": ["resolveMeta:private"],
  "src/app/(admin)/admin/tickets/upload-attachment-action.ts": ["store:private"],
  "src/app/(org)/o/[slug]/admin/branding/page.tsx": ["resolve:public_site"], // the mark preview
  "src/app/(org)/o/[slug]/admin/giving/statements/[statementId]/download/route.ts": ["resolve:private"],
  "src/app/(org)/o/[slug]/giving/statements/[statementId]/download/route.ts": ["resolve:private"],
  "src/app/(org)/o/[slug]/tickets/[id]/attachments/[key]/route.ts": ["resolve:private"],
  "src/app/(org)/o/[slug]/tickets/actions.ts": ["store:private"],
  "src/app/(public)/site/[slug]/assets/[key]/route.ts": ["resolvePublic"],
  // images first, then the bundle JSON (R2: the bundle is private, only a server-side reader uses it)
  "src/app/api/sites/ingest/route.ts": ["store:public_site", "store:private"],
  // person photos (DECISION-285): the thumbnails of a directory page, in one read (F332)
  "src/components/org-portal/person-avatar.tsx": ["resolveMany:private"],
  "src/lib/brand/read-org-brand.ts": ["resolve:public_site"], // the mark, inlined as data:
  "src/lib/giving/statements.ts": ["store:private"], // the statement PDF
  "src/lib/sites.ts": ["resolve:private"], // the content bundle (hydratePublishedSite)
  "src/lib/tenant-branding.ts": ["store:public_site"], // the logo
  "src/lib/tickets.ts": ["resolveMeta:private", "resolveMeta:private", "resolveMeta:private"],
};

/** Rows for files that land with a later pipeline. Careers adds none (DECISION-263: no blob_assets). */
const FORWARD: Record<string, { calls: string[]; since: string }> = {
  "src/lib/reimbursement/receipts.ts": {
    calls: ["store:private", "resolve:private"],
    since: "treasury-inc1 (migration 0073, DECISION-270): reimbursement receipts are private",
  },
};

// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => relative(process.cwd(), f).split(sep).join("/");

/** Non-test source, minus the shared fixtures under src/lib/testing/. */
const FILES = walk(SRC).filter((f) => !rel(f).startsWith("src/lib/testing/"));

function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function parse(file: string): ts.SourceFile {
  return parseSource(file, readFileSync(file, "utf8"));
}

interface Scan {
  /** "method:audience", or "method" for an exempt method, in source order. */
  calls: string[];
  /** Calls that break the per-call rule, as readable strings. */
  violations: string[];
  /** How many `getBlobStore` references the file holds (calls, aliasing, passing it around). */
  references: number;
}

function isGetBlobStoreCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "getBlobStore";
}

function scanSourceFile(sf: ts.SourceFile, displayName: string): Scan {
  const calls: string[] = [];
  const violations: string[] = [];
  let references = 0;

  const visit = (node: ts.Node) => {
    // Every use of the identifier except the import specifier and the declaration itself.
    if (ts.isIdentifier(node) && node.text === "getBlobStore") {
      const p = node.parent;
      const isImport = ts.isImportSpecifier(p) || ts.isExportSpecifier(p);
      const isDecl = ts.isFunctionDeclaration(p) && p.name === node;
      if (!isImport && !isDecl) references++;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isGetBlobStoreCall(node.expression.expression)
    ) {
      const method = node.expression.name.text;
      const where = `${displayName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${method}()`;
      const arg = node.arguments[0];
      const literal = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
      const prop = literal?.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "audience",
      );
      const hasAudienceKey = Boolean(
        literal?.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === "audience"),
      );

      if (method in EXEMPT_METHODS) {
        if (hasAudienceKey) violations.push(`${where}: an exempt method must not pass an audience`);
        calls.push(method);
      } else if (!literal) {
        violations.push(`${where}: the first argument must be an object literal so its audience literal can be read`);
        calls.push(`${method}:?`);
      } else if (!prop || !(ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))) {
        violations.push(`${where}: needs \`audience: "public_site" | "private"\` as a string literal`);
        calls.push(`${method}:?`);
      } else if (!AUDIENCES.has(prop.initializer.text)) {
        violations.push(`${where}: audience "${prop.initializer.text}" is not in the closed vocabulary`);
        calls.push(`${method}:${prop.initializer.text}`);
      } else {
        calls.push(`${method}:${prop.initializer.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { calls, violations, references };
}

const scans = new Map(FILES.map((f) => [rel(f), scanSourceFile(parse(f), rel(f))]));
/** Files that mention getBlobStore at all. */
const callers = [...scans.entries()].filter(([, s]) => s.references > 0 || s.calls.length > 0);

describe("getBlobStore() call sites carry an audience literal (R6, Gap 15)", () => {
  it("every getBlobStore().<method>(...) call names its audience as a string literal in the closed vocabulary (exempt methods name none)", () => {
    const violations = callers.flatMap(([, s]) => s.violations);
    expect(violations).toEqual([]);
  });

  it("no file aliases or passes getBlobStore around: every reference is a matched getBlobStore().<method>( call", () => {
    const aliased = callers
      .filter(([, s]) => s.references !== s.calls.length)
      .map(([f, s]) => `${f}: ${s.references} getBlobStore reference(s), ${s.calls.length} matched call(s)`);
    expect(aliased).toEqual([]);
  });

  it("ACTIVE: the files that call getBlobStore() are exactly the table, with the table's calls in source order", () => {
    const actual: Record<string, string[]> = {};
    for (const [file, s] of callers) {
      if (file in FORWARD) continue; // a FORWARD file is held to its own row below
      actual[file] = s.calls;
    }
    expect(actual).toEqual(ACTIVE);
  });

  it("every ACTIVE file exists (a deleted caller leaves a stale row)", () => {
    const missing = Object.keys(ACTIVE).filter((f) => !existsSync(join(process.cwd(), f)));
    expect(missing).toEqual([]);
  });

  it("FORWARD: a row for a file that has landed is held to its calls exactly; one that has not landed is skipped", () => {
    const stale: string[] = [];
    for (const [file, row] of Object.entries(FORWARD)) {
      if (!existsSync(join(process.cwd(), file))) continue;
      const s = scans.get(file);
      if (!s || JSON.stringify(s.calls) !== JSON.stringify(row.calls)) {
        stale.push(`${file} (since ${row.since}): expected ${JSON.stringify(row.calls)}, found ${JSON.stringify(s?.calls ?? [])}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("a FORWARD file is never also an ACTIVE one (the row moves, it does not duplicate)", () => {
    expect(Object.keys(FORWARD).filter((f) => f in ACTIVE)).toEqual([]);
  });

  it("the vocabulary in this scan is the database's (blob_assets_audience_allowed)", () => {
    const migration = readFileSync(join(process.cwd(), "drizzle/0072_presby_blob_audience.sql"), "utf8");
    expect(migration).toMatch(/check \(audience in \('public_site',\s*'private'\)\)/);
    expect([...AUDIENCES].sort()).toEqual(["private", "public_site"]);
  });
});

describe("the scan itself can fail (it is not vacuous)", () => {
  const scanText = (text: string) => scanSourceFile(parseSource("/virtual/x.ts", text), "x.ts");

  it("flags a call with no audience, a variable audience, a conditional audience and an unknown audience", () => {
    expect(scanText(`getBlobStore().store({ organizationId, bytes })`).violations).toHaveLength(1);
    expect(scanText(`getBlobStore().store({ organizationId, audience: aud })`).violations).toHaveLength(1);
    expect(scanText(`getBlobStore().resolve({ audience: x ? "private" : "public_site" })`).violations).toHaveLength(1);
    expect(scanText(`getBlobStore().store({ audience: "draft" })`).violations).toHaveLength(1);
    expect(scanText(`getBlobStore().store(input)`).violations).toHaveLength(1);
  });

  it("flags aliasing: a reference that is not a matched call", () => {
    const aliased = scanText(`const s = getBlobStore(); s.store({ audience: "private" });`);
    expect(aliased.references).toBe(1);
    expect(aliased.calls).toEqual([]);
  });

  it("reads a literal, and holds an exempt method to passing no audience", () => {
    expect(scanText(`getBlobStore().store({ audience: "private" })`)).toMatchObject({ calls: ["store:private"], violations: [] });
    expect(scanText(`getBlobStore().resolvePublic({ organizationId, key })`)).toMatchObject({ calls: ["resolvePublic"], violations: [] });
    expect(scanText(`getBlobStore().resolvePublic({ organizationId, key, audience: "public_site" })`).violations).toHaveLength(1);
  });

  it("resolveMany (person photos, F332) is held to the literal rule like resolve(): no audience, a variable or a conditional all fail", () => {
    expect(scanText(`getBlobStore().resolveMany({ organizationId, keys })`).violations).toHaveLength(1);
    expect(scanText(`getBlobStore().resolveMany({ organizationId, keys, audience: aud })`).violations).toHaveLength(1);
    expect(scanText(`getBlobStore().resolveMany({ organizationId, keys, audience: "private" })`)).toMatchObject({
      calls: ["resolveMany:private"],
      violations: [],
    });
  });

  it("a method added later is held to the literal rule by default (no scan-logic change needed)", () => {
    expect(scanText(`getBlobStore().findByContentHashes({ organizationId, hashes })`).violations).toHaveLength(1);
    expect(scanText(`getBlobStore().findByContentHashes({ organizationId, hashes, audience: "public_site" })`).calls).toEqual([
      "findByContentHashes:public_site",
    ]);
  });
});

describe("blob_assets is queried nowhere but blob-store.ts (DECISION-030)", () => {
  const BLOB_STORE = "src/lib/storage/blob-store.ts";

  it("the Drizzle table object is imported only by blob-store.ts (and the schema barrel)", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const f = rel(file);
      if (f === BLOB_STORE || f === "src/lib/db/domain/index.ts") continue;
      const sf = parse(file);
      for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        const spec = stmt.moduleSpecifier.text;
        const names = stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)
          ? stmt.importClause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text)
          : [];
        const fromAssetsModule = /(^|\/)domain\/assets$/.test(spec) || (spec === "./assets" && f.startsWith("src/lib/db/domain/"));
        if (names.includes("blobAssets") || (fromAssetsModule && f.startsWith("src/lib/db/domain/") === false)) {
          offenders.push(`${f} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no source file other than blob-store.ts holds raw SQL against blob_assets", () => {
    const offenders: string[] = [];
    const SQL = /\b(from|join|into|update)\s+blob_assets\b/i;
    for (const file of FILES) {
      const f = rel(file);
      if (f === BLOB_STORE) continue;
      const sf = parse(file);
      const visit = (node: ts.Node) => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          if (SQL.test(node.text)) offenders.push(`${f}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });
});
