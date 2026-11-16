/**
 * The presbytery reports' source-scan boundaries (docs/work-log/2026-11-15-
 * presbytery-reports.md, Phase 2 notes 4 and 6, DECISION-337 and 339). A
 * database-free scan over this module, the four report segments under
 * `admin/reports/`, and the components, with a failing sample for every rule so
 * a rule that stops matching fails the suite instead of passing silently.
 *
 * `check:audit` scans only `actions.ts` files, so the audit properties of a
 * `route.ts` export (DECISION-339) live here, the way
 * `reimbursement/audit-coverage.test.ts` carries them for DECISION-271.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_SEGMENTS } from "./contract";

const ROOT = path.resolve(__dirname, "../../..");
const MODULE_DIR = path.join(ROOT, "src/lib/presbytery-reports");
const REPORTS_DIR = path.join(ROOT, "src/app/(org)/o/[slug]/admin/reports");
const COMPONENTS_DIR = path.join(ROOT, "src/components/presbytery-reports");

interface SourceFile {
  rel: string;
  content: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function load(files: string[]): SourceFile[] {
  return files.map((f) => ({ rel: path.relative(ROOT, f), content: readFileSync(f, "utf8") }));
}

/** Strips comments so a rule reads code, not prose that names a thing in order to forbid it. */
function code(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);

const moduleFiles = load(walk(MODULE_DIR).filter((f) => /\.tsx?$/.test(f) && !isTest(f)));
const segmentFiles = load(
  REPORT_SEGMENTS.flatMap((s) => walk(path.join(REPORTS_DIR, s))).filter((f) => /\.tsx?$/.test(f) && !isTest(f)),
);
const componentFiles = load(walk(COMPONENTS_DIR).filter((f) => /\.tsx?$/.test(f) && !isTest(f)));
const hubFile = load([path.join(REPORTS_DIR, "reports-hub.tsx")].filter((f) => { try { statSync(f); return true; } catch { return false; } }));

const surface = [...moduleFiles, ...segmentFiles];
const routes = segmentFiles.filter((f) => f.rel.endsWith("route.ts"));
const pages = segmentFiles.filter((f) => f.rel.endsWith("page.tsx"));

interface Hit {
  rule: string;
  file: string;
}

// ── The rules, as functions over data (so a sample can fail each) ──────────

const OWNER_CONNECTION = /\b(getPlatformDb|PLATFORM_DATABASE_URL|MIGRATE_DATABASE_URL)\b/;
function noOwnerConnection(files: SourceFile[]): Hit[] {
  return files.filter((f) => OWNER_CONNECTION.test(code(f.content))).map((f) => ({ rule: "no-owner-connection", file: f.rel }));
}

function callsGate(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => {
      const c = code(f.content);
      return f.rel.endsWith("route.ts") ? !/\bgateReportRoute\(/.test(c) : !/\bgateReportPage\(/.test(c);
    })
    .map((f) => ({ rule: "calls-gate", file: f.rel }));
}

function routeCallsAnExport(files: SourceFile[], names: string[]): Hit[] {
  const re = new RegExp(`\\b(${names.join("|")})\\(`);
  return files.filter((f) => !re.test(code(f.content))).map((f) => ({ rule: "route-calls-export", file: f.rel }));
}

/** Names of `export function exportX` / `export async function exportX` (not helpers like respondWithExport). */
function exportFunctionNames(files: SourceFile[]): string[] {
  return files.flatMap((f) => [...code(f.content).matchAll(/export (?:async )?function (export[A-Z]\w*)\b/g)].map((m) => m[1]));
}

/** The body text of one exported function, by brace matching from its signature. */
function functionBody(content: string, name: string): string {
  const c = code(content);
  const start = c.search(new RegExp(`export (?:async )?function ${name}\\b`));
  if (start < 0) return "";
  const open = c.indexOf("{", c.indexOf(")", c.indexOf("(", start)));
  let depth = 0;
  for (let i = open; i < c.length; i++) {
    if (c[i] === "{") depth++;
    else if (c[i] === "}" && --depth === 0) return c.slice(open, i + 1);
  }
  return c.slice(open);
}

function exportsAudit(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    for (const name of exportFunctionNames([f])) {
      if (!/\bauditReportExport\(/.test(functionBody(f.content, name))) hits.push({ rule: "export-audits", file: `${f.rel}#${name}` });
    }
  }
  return hits;
}

function auditHelperIsInTransaction(files: SourceFile[]): Hit[] {
  const audit = files.find((f) => f.rel.endsWith("presbytery-reports/audit.ts"));
  const c = audit ? code(audit.content) : "";
  const ok = /\binsertAuditRow\(\s*tx\b/.test(c) && /AUDIT_ACTIONS\.PRESBYTERY_REPORT_EXPORTED/.test(c);
  return ok ? [] : [{ rule: "audit-helper", file: "presbytery-reports/audit.ts" }];
}

function noRecordAudit(files: SourceFile[]): Hit[] {
  return files.filter((f) => /\brecordAudit\b/.test(code(f.content))).map((f) => ({ rule: "no-recordAudit", file: f.rel }));
}

function noForbiddenReads(files: SourceFile[]): Hit[] {
  const patterns = [
    /presby_list_published_returns_to_me/,
    /organization_affiliations(?!_public)\b/,
    /\borganizationAffiliations\b/,
    /@\/lib\/db\/domain\/people/,
    /\b(?:from|join)\s+(?:people|memberships)\b/i,
  ];
  return files.filter((f) => patterns.some((p) => p.test(code(f.content)))).map((f) => ({ rule: "no-forbidden-reads", file: f.rel }));
}

function noWrites(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => /\.(delete|insert|update)\(|\b(delete from|insert into|update\s+\w+\s+set)\b/i.test(code(f.content).replace(/insertAuditRow/g, "")))
    .map((f) => ({ rule: "read-only", file: f.rel }));
}

function noLinkToExport(files: SourceFile[]): Hit[] {
  return files.filter((f) => /<Link\b[^>]*href=[^>]*\/export/.test(code(f.content))).map((f) => ({ rule: "no-link-to-export", file: f.rel }));
}

function noJoinComma(files: SourceFile[]): Hit[] {
  return files.filter((f) => !f.rel.endsWith("presbytery-reports/csv.ts") && /\.join\(\s*["'`],["'`]\s*\)/.test(code(f.content))).map((f) => ({ rule: "no-join-comma", file: f.rel }));
}

function noRedirectTargetParams(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => /\.get(?:All)?\(\s*["'](callbackUrl|next|returnTo|redirect)["']/.test(code(f.content)) || /\bsearchParams\.(callbackUrl|next)\b/.test(code(f.content)) || /\bquery\.(callbackUrl|next)\b/.test(code(f.content)))
    .map((f) => ({ rule: "no-redirect-target", file: f.rel }));
}

function noLooseNumberParse(files: SourceFile[]): Hit[] {
  return files.filter((f) => /\b(Number|parseInt|parseFloat)\(/.test(code(f.content))).map((f) => ({ rule: "strict-params", file: f.rel }));
}

function noUseClient(files: SourceFile[]): Hit[] {
  return files.filter((f) => /^\s*["']use client["']/m.test(f.content)).map((f) => ({ rule: "no-use-client", file: f.rel }));
}

function rosterFiltersLifecycle(files: SourceFile[]): Hit[] {
  const roster = files.find((f) => f.rel.endsWith("presbytery-reports/roster.ts"));
  const c = roster ? code(roster.content) : "";
  return /lifecycleStatus|lifecycle_status/.test(c) && /["']active["']/.test(c) ? [] : [{ rule: "roster-lifecycle", file: "roster.ts" }];
}

function exportButtonIsAnAnchor(files: SourceFile[]): Hit[] {
  const button = files.find((f) => f.rel.endsWith("export-button.tsx"));
  const c = button ? code(button.content) : "";
  return /<a\b[^>]*\bdownload\b/.test(c) && !/next\/link/.test(c) ? [] : [{ rule: "export-button-anchor", file: "export-button.tsx" }];
}

const f = (rel: string, content: string): SourceFile => ({ rel, content });

// ── The real tree passes ───────────────────────────────────────────────────

describe("the real tree", () => {
  it("scans real files (a scan over nothing proves nothing)", () => {
    expect(moduleFiles.length).toBeGreaterThan(10);
    expect(routes).toHaveLength(4);
    expect(pages).toHaveLength(4);
    expect(componentFiles.length).toBeGreaterThan(5);
  });

  it("names no owner connection in the module or the four segments", () => {
    expect(noOwnerConnection(surface)).toEqual([]);
    expect(noOwnerConnection(componentFiles)).toEqual([]);
  });

  it("every page and route under the four segments calls the gate", () => {
    expect(callsGate([...pages, ...routes])).toEqual([]);
  });

  it("each route calls one of the module's export functions", () => {
    const names = exportFunctionNames(moduleFiles);
    expect(names.sort()).toEqual(["exportMembershipTrend", "exportPerCapita", "exportViability", "exportVacantPulpits"].sort());
    expect(routeCallsAnExport(routes, names)).toEqual([]);
  });

  it("each export function calls auditReportExport, which writes the row with insertAuditRow(tx) under the one key", () => {
    expect(exportsAudit(moduleFiles)).toEqual([]);
    expect(auditHelperIsInTransaction(moduleFiles)).toEqual([]);
  });

  it("nothing in the module, the routes or the pages calls recordAudit", () => {
    expect(noRecordAudit([...surface, ...componentFiles, ...hubFile])).toEqual([]);
  });

  it("the module names none of the forbidden reads (people, memberships, the base affiliations table, the archival read)", () => {
    expect(noForbiddenReads(moduleFiles)).toEqual([]);
  });

  it("the module and the segments are read-only (no insert, update or delete)", () => {
    expect(noWrites(surface)).toEqual([]);
  });

  it("no next/link href ends in /export, and the export button is a plain anchor with download", () => {
    expect(noLinkToExport([...componentFiles, ...segmentFiles, ...hubFile])).toEqual([]);
    expect(exportButtonIsAnAnchor(componentFiles)).toEqual([]);
  });

  it("no .join(',') outside csv.ts", () => {
    expect(noJoinComma([...surface, ...componentFiles, ...hubFile])).toEqual([]);
  });

  it("no route or page reads a callbackUrl or next parameter", () => {
    expect(noRedirectTargetParams([...routes, ...pages, ...moduleFiles])).toEqual([]);
  });

  it("no page or route parses a query value with Number, parseInt or parseFloat (strict parsing is params.ts)", () => {
    expect(noLooseNumberParse([...routes, ...pages])).toEqual([]);
  });

  it("the roster filters on an active lifecycle", () => {
    expect(rosterFiltersLifecycle(moduleFiles)).toEqual([]);
  });

  it("nothing here is a client component (the views are server components; the export is an anchor)", () => {
    expect(noUseClient([...surface, ...componentFiles, ...hubFile])).toEqual([]);
  });

  it("no loading.tsx exists anywhere under admin/reports/** (a Suspense boundary would serve a 404 at HTTP 200)", () => {
    const loading = walk(REPORTS_DIR).filter((p) => /(^|\/)loading\.tsx?$/.test(p));
    expect(loading).toEqual([]);
  });

  it("the child directories of admin/reports are exactly the registry's segments plus [aboutOrgId]", () => {
    const dirs = readdirSync(REPORTS_DIR).filter((n) => statSync(path.join(REPORTS_DIR, n)).isDirectory());
    expect(dirs.sort()).toEqual([...REPORT_SEGMENTS, "[aboutOrgId]"].sort());
  });

  it("each segment has a page.tsx and an export/route.ts and nothing else that serves", () => {
    for (const segment of REPORT_SEGMENTS) {
      const files = walk(path.join(REPORTS_DIR, segment)).map((p) => path.relative(path.join(REPORTS_DIR, segment), p)).sort();
      expect(files, segment).toEqual(["export/route.ts", "page.tsx"]);
    }
  });
});

// ── Each rule fails on a sample (a rule that stops matching must fail here) ─

describe("each rule flags a violating sample", () => {
  it("no-owner-connection", () => {
    expect(noOwnerConnection([f("a.ts", "const db = getPlatformDb();")])).toHaveLength(1);
    expect(noOwnerConnection([f("a.ts", "const u = process.env.PLATFORM_DATABASE_URL;")])).toHaveLength(1);
    expect(noOwnerConnection([f("a.ts", "const u = process.env.MIGRATE_DATABASE_URL;")])).toHaveLength(1);
    expect(noOwnerConnection([f("a.ts", "// never call getPlatformDb() here\n/* PLATFORM_DATABASE_URL */")])).toEqual([]);
  });

  it("calls-gate", () => {
    expect(callsGate([f("x/page.tsx", "export default async function P() { return null; }")])).toHaveLength(1);
    expect(callsGate([f("x/route.ts", "export async function GET() {}")])).toHaveLength(1);
    expect(callsGate([f("x/page.tsx", "await gateReportPage({})")])).toEqual([]);
    expect(callsGate([f("x/route.ts", "await gateReportRoute({})")])).toEqual([]);
    expect(callsGate([f("x/route.ts", "await gateReportPage({})")])).toHaveLength(1);
  });

  it("route-calls-export", () => {
    expect(routeCallsAnExport([f("r/route.ts", "return new Response('x')")], ["exportViability"])).toHaveLength(1);
    expect(routeCallsAnExport([f("r/route.ts", "await exportViability(gate)")], ["exportViability"])).toEqual([]);
  });

  it("export-audits", () => {
    const bad = f("m.ts", "export function exportViability(v) { return withOrgContext(a, b, async (tx) => { return read(tx); }); }");
    expect(exportsAudit([bad])).toHaveLength(1);
    const good = f("m.ts", "export function exportViability(v) { return withOrgContext(a, b, async (tx) => { await auditReportExport(tx, v, {}); }); }");
    expect(exportsAudit([good])).toEqual([]);
    // a response helper is not named export*, so it is not mistaken for an export function
    expect(exportFunctionNames([f("g.ts", "export function respondWithExport(r) { return r; }")])).toEqual([]);
    expect(exportFunctionNames([f("g.ts", "export async function exportViability(r) { return r; }")])).toEqual(["exportViability"]);
  });

  it("audit-helper", () => {
    expect(auditHelperIsInTransaction([f("src/lib/presbytery-reports/audit.ts", "await recordAudit({})")])).toHaveLength(1);
    expect(auditHelperIsInTransaction([f("src/lib/presbytery-reports/audit.ts", "await insertAuditRow(tx, { action: AUDIT_ACTIONS.OTHER })")])).toHaveLength(1);
    expect(
      auditHelperIsInTransaction([f("src/lib/presbytery-reports/audit.ts", "await insertAuditRow(tx, { action: AUDIT_ACTIONS.PRESBYTERY_REPORT_EXPORTED })")]),
    ).toEqual([]);
  });

  it("no-recordAudit", () => {
    expect(noRecordAudit([f("a.ts", "await recordAudit({ action })")])).toHaveLength(1);
    expect(noRecordAudit([f("a.ts", "// recordAudit swallows failures")])).toEqual([]);
  });

  it("no-forbidden-reads", () => {
    for (const bad of [
      "select presby_list_published_returns_to_me()",
      "from organization_affiliations where",
      'import { organizationAffiliations } from "@/lib/db/domain/lifecycle";',
      'import { people } from "@/lib/db/domain/people";',
      "sql`select * from people`",
      "sql`join memberships m on`",
    ]) {
      expect(noForbiddenReads([f("a.ts", bad)]), bad).toHaveLength(1);
    }
    expect(noForbiddenReads([f("a.ts", "from organization_affiliations_public where")])).toEqual([]);
  });

  it("read-only", () => {
    for (const bad of ["await tx.delete(x)", "await tx.insert(x).values(y)", "await tx.update(x).set(y)", "sql`delete from appointments`", "sql`update per_capita_records set x = 1`"]) {
      expect(noWrites([f("a.ts", bad)]), bad).toHaveLength(1);
    }
    expect(noWrites([f("a.ts", "await insertAuditRow(tx, {})")])).toEqual([]);
  });

  it("no-link-to-export and export-button-anchor", () => {
    expect(noLinkToExport([f("a.tsx", '<Link href={`${path}/export`}>x</Link>')])).toHaveLength(1);
    expect(noLinkToExport([f("a.tsx", '<a href={`${path}/export`} download>x</a>')])).toEqual([]);
    expect(exportButtonIsAnAnchor([f("export-button.tsx", 'import Link from "next/link"; <Link href="/x/export">x</Link>')])).toHaveLength(1);
    expect(exportButtonIsAnAnchor([f("export-button.tsx", "<a href={href} download>x</a>")])).toEqual([]);
  });

  it("no-join-comma", () => {
    expect(noJoinComma([f("a.ts", 'cells.join(",")')])).toHaveLength(1);
    expect(noJoinComma([f("src/lib/presbytery-reports/csv.ts", 'cells.join(",")')])).toEqual([]);
  });

  it("no-redirect-target", () => {
    expect(noRedirectTargetParams([f("a.ts", 'url.searchParams.get("callbackUrl")')])).toHaveLength(1);
    expect(noRedirectTargetParams([f("a.ts", "url.searchParams.get('next')")])).toHaveLength(1);
    expect(noRedirectTargetParams([f("a.tsx", "const x = query.callbackUrl;")])).toHaveLength(1);
    expect(noRedirectTargetParams([f("a.ts", 'search.get("from")')])).toEqual([]);
  });

  it("strict-params", () => {
    expect(noLooseNumberParse([f("a.tsx", "const y = Number(query.year);")])).toHaveLength(1);
    expect(noLooseNumberParse([f("a.tsx", "const y = parseInt(query.year, 10);")])).toHaveLength(1);
    expect(noLooseNumberParse([f("a.tsx", "const y = parseBillingYear(query.year, now);")])).toEqual([]);
  });

  it("roster-lifecycle and no-use-client", () => {
    expect(rosterFiltersLifecycle([f("src/lib/presbytery-reports/roster.ts", "where parentId = x")])).toHaveLength(1);
    expect(rosterFiltersLifecycle([f("src/lib/presbytery-reports/roster.ts", 'eq(organizations.lifecycleStatus, "active")')])).toEqual([]);
    expect(noUseClient([f("a.tsx", '"use client";\nexport const a = 1;')])).toHaveLength(1);
  });
});
