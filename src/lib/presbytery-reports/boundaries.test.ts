/**
 * The presbytery reports' source-scan boundaries (docs/work-log/2026-11-15-
 * presbytery-reports.md, Phase 2 notes 4 and 6, DECISION-337 and 339). A
 * database-free scan over this module, the six report segments under
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
// The dashboard (DECISION-342): the one page outside REPORTS_DIR that composes the readers.
const INSIGHTS_DIR = path.join(ROOT, "src/app/(org)/o/[slug]/admin/insights");

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
const insightsFiles = load(walk(INSIGHTS_DIR).filter((f) => /\.tsx?$/.test(f) && !isTest(f)));
// Every non-test source file in the repo's src/ (the map's "nowhere else" rules read the whole tree).
const allSrcFiles = load(walk(path.join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f) && !isTest(f)));
const hubFile = load([path.join(REPORTS_DIR, "reports-hub.tsx")].filter((f) => { try { statSync(f); return true; } catch { return false; } }));

/**
 * The segments whose page.tsx has not landed yet. DECISION-348's two reports are built
 * in two batches: the server side (reader, CSV, export route; B7) and then the pages
 * and views (B8). B8 empties this list in its own commit, which makes every
 * "has a page" assertion below strict for all six.
 */
const PAGES_PENDING: readonly string[] = ["buildings", "insurance-and-loans"];

/** An oversight table by its SQL or Drizzle name: only `src/lib/oversight/` may write one. */
const NAMES_AN_OVERSIGHT_TABLE =
  /\b(oversight_(profiles|buildings|building_photos|building_appraisals|insurance_years|loans)|oversight(Profiles|Buildings|BuildingPhotos|BuildingAppraisals|InsuranceYears|Loans))\b/;

/** The six export functions, one per report (DECISION-348 added the last two). */
const SIX_EXPORTS = [
  "exportBuildingsReport",
  "exportInsuranceLoans",
  "exportMembershipTrend",
  "exportPerCapita",
  "exportVacantPulpits",
  "exportViability",
].sort();

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

/**
 * The dashboard page runs ITS OWN gate and never the reports one (DECISION-342): a
 * presbytery with insights on and reports off must still see its cards, and a
 * dashboard that borrowed the reports gate would inherit the reports flag.
 */
function insightsCallsItsGate(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => f.rel.endsWith("page.tsx"))
    .filter((f) => {
      const c = code(f.content);
      return !/\bgateInsightsPage\(/.test(c) || /\bgateReportPage\(/.test(c);
    })
    .map((f) => ({ rule: "insights-calls-its-gate", file: f.rel }));
}

/** Names are tenant-entered text: they render through React text, never as HTML. */
function noDangerousHtml(files: SourceFile[]): Hit[] {
  return files.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\b/.test(code(f.content))).map((f) => ({ rule: "no-dangerous-html", file: f.rel }));
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

// ── The map's containment (DECISION-343) ───────────────────────────────────

/** The only two client files in the dashboard directory; `map-support.ts` is a plain helper with no directive. */
const CLIENT_FILES = ["map-loader.tsx", "map.tsx"];
const MAP_BROWSER_FILES = ["map-loader.tsx", "map.tsx", "map-support.ts"];
const isFile = (rel: string, name: string) => rel.endsWith(`/${name}`);

/** The `'use client'` files, by base name. */
function clientFileNames(files: SourceFile[]): string[] {
  return files.filter((file) => /^\s*["']use client["']/m.test(file.content)).map((file) => file.rel.split("/").pop()!);
}

/** `next/dynamic` appears only in the loader, and the loader says `ssr: false`. */
function dynamicOnlyInLoader(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const c = code(file.content);
    const loader = isFile(file.rel, "map-loader.tsx");
    if (/next\/dynamic/.test(c) && !loader) hits.push({ rule: "dynamic-only-in-loader", file: file.rel });
    if (loader && (!/next\/dynamic/.test(c) || !/\bssr:\s*false\b/.test(c))) hits.push({ rule: "loader-ssr-false", file: file.rel });
  }
  return hits;
}

/** Nothing imports the map module statically: only `import("./map")`, inside the loader. */
function mapImportedOnlyDynamically(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const c = code(file.content);
    if (/\bfrom\s*["'](?:\.\/map|[^"']*insights\/map)["']/.test(c) || /\bimport\s*["'](?:\.\/map|[^"']*insights\/map)["']/.test(c)) {
      hits.push({ rule: "map-static-import", file: file.rel });
    }
    const dynamicRefs = [...c.matchAll(/\bimport\(\s*["']([^"']*\/map)["']\s*\)/g)];
    if (dynamicRefs.length > 0 && !isFile(file.rel, "map-loader.tsx")) hits.push({ rule: "map-dynamic-outside-loader", file: file.rel });
  }
  return hits;
}

const BROWSER_BANS: Array<[string, RegExp]> = [
  ["process.env", /\bprocess\.env\b/],
  ["MAPTILER", /MAPTILER/],
  ["fetch(", /\bfetch\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["@/lib/db", /@\/lib\/db\b/],
  ["@/auth", /@\/auth\b/],
  ["next/headers", /next\/headers/],
  ["an actions import", /\bfrom\s*["'][^"']*actions["']|\bimport\s*["'][^"']*actions["']/],
  [".innerHTML", /\.innerHTML\b/],
  ["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
  ["bindTooltip", /\bbindTooltip\b/],
  ["circleMarker", /\bcircleMarker\b/],
  ["L.icon(", /\bL\.icon\(/],
  ["iconUrl", /\biconUrl\b/],
  ["an attribution option", /\battribution\s*:/],
];

/** The map's browser files read no environment, call no server, touch no database, and build no HTML. */
function browserFileBans(files: SourceFile[]): Hit[] {
  return files.flatMap((file) =>
    BROWSER_BANS.filter(([, re]) => re.test(code(file.content))).map(([name]) => ({ rule: `browser-ban:${name}`, file: file.rel })),
  );
}

/** `bindPopup(` takes only a DOM-node builder, and a divIcon's `html:` only the pin builder. */
function nodeBuildersOnly(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const c = code(file.content);
    for (const m of c.matchAll(/\bbindPopup\(\s*(?=\S)(?!popupNode\()/g)) hits.push({ rule: "bindPopup-node-only", file: `${file.rel}@${m.index}` });
    for (const m of c.matchAll(/\bhtml\s*:\s*(?=\S)(?!pinNode\()/g)) hits.push({ rule: "icon-html-node-only", file: `${file.rel}@${m.index}` });
  }
  return hits;
}

/** String and template literal contents blanked, so prose that says "latitude" is not a column access. */
function withoutStrings(content: string): string {
  return code(content).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

/** Among the module's files only the map reader and its derive name a coordinate column. */
function onlyMapFilesNameCoordinates(files: SourceFile[]): Hit[] {
  return files
    .filter((file) => !isFile(file.rel, "viability-map.ts") && !isFile(file.rel, "map-derive.ts"))
    .filter((file) => /\b(latitude|longitude)\b/i.test(withoutStrings(file.content)))
    .map((file) => ({ rule: "coordinates-only-in-map-files", file: file.rel }));
}

/** MAPTILER is named by exactly one source file: map-config.ts. */
function onlyConfigNamesMaptiler(files: SourceFile[]): Hit[] {
  return files
    .filter((file) => !file.rel.endsWith("presbytery-reports/map-config.ts") && /MAPTILER/.test(code(file.content)))
    .map((file) => ({ rule: "maptiler-only-in-config", file: file.rel }));
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
    expect(routes).toHaveLength(6);
    expect(pages).toHaveLength(REPORT_SEGMENTS.length - PAGES_PENDING.length);
    expect(componentFiles.length).toBeGreaterThan(5);
    // The insights page sits outside REPORTS_DIR, so it is not one of `pages`.
    expect(insightsFiles.length).toBeGreaterThanOrEqual(1);
    expect(insightsFiles.some((file) => file.rel.endsWith("page.tsx"))).toBe(true);
  });

  it("names no owner connection in the module or the six segments", () => {
    expect(noOwnerConnection(surface)).toEqual([]);
    expect(noOwnerConnection(componentFiles)).toEqual([]);
  });

  it("every page and route under the six segments calls the gate", () => {
    expect(callsGate([...pages, ...routes])).toEqual([]);
  });

  it("each route calls one of the module's export functions", () => {
    const names = exportFunctionNames(moduleFiles);
    expect(names.sort()).toEqual(SIX_EXPORTS);
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

  it("the dashboard page calls gateInsightsPage and not gateReportPage", () => {
    expect(insightsCallsItsGate(insightsFiles)).toEqual([]);
  });

  it("the dashboard directory names no owner connection, writes nothing, records no audit event and reads no redirect or loose number", () => {
    expect(noOwnerConnection(insightsFiles)).toEqual([]);
    expect(noWrites(insightsFiles)).toEqual([]);
    expect(noRecordAudit(insightsFiles)).toEqual([]);
    expect(noRedirectTargetParams(insightsFiles)).toEqual([]);
    expect(noLooseNumberParse(insightsFiles)).toEqual([]);
  });

  it("the only client components in the dashboard directory are the map loader and the map (the module and the components stay server-side)", () => {
    expect(clientFileNames(insightsFiles).sort()).toEqual([...CLIENT_FILES].sort());
    expect(noUseClient(moduleFiles)).toEqual([]);
    expect(noUseClient(componentFiles)).toEqual([]);
  });

  it("next/dynamic appears only in the loader, which says ssr: false, and nothing imports the map statically", () => {
    expect(dynamicOnlyInLoader([...insightsFiles, ...moduleFiles, ...componentFiles])).toEqual([]);
    expect(mapImportedOnlyDynamically([...allSrcFiles])).toEqual([]);
    const loader = insightsFiles.find((file) => isFile(file.rel, "map-loader.tsx"))!;
    expect(code(loader.content)).toMatch(/import\(\s*["']\.\/map["']\s*\)/);
  });

  it("the map's browser files read no environment, call no server, touch no database and build no HTML", () => {
    const browser = insightsFiles.filter((file) => MAP_BROWSER_FILES.some((name) => isFile(file.rel, name)));
    expect(browser.map((file) => file.rel.split("/").pop()).sort()).toEqual([...MAP_BROWSER_FILES].sort());
    expect(browserFileBans(browser)).toEqual([]);
  });

  it("bindPopup takes only the popup node builder and a divIcon's html only the pin node builder; the wheel never zooms", () => {
    const map = insightsFiles.find((file) => isFile(file.rel, "map.tsx"))!;
    expect(nodeBuildersOnly(insightsFiles)).toEqual([]);
    expect(code(map.content)).toMatch(/\bbindPopup\(\s*popupNode\(/);
    expect(code(map.content)).toMatch(/\bhtml:\s*pinNode\(/);
    expect(code(map.content)).toMatch(/\bscrollWheelZoom:\s*false\b/);
    expect(code(map.content)).toMatch(/\battributionControl:\s*false\b/);
  });

  it("only the map reader and its derive name a coordinate column; the viability read, the CSV and the audit never do", () => {
    expect(onlyMapFilesNameCoordinates(moduleFiles)).toEqual([]);
    const named = moduleFiles.filter((file) => /\b(latitude|longitude)\b/i.test(withoutStrings(file.content))).map((file) => file.rel.split("/").pop());
    expect(named.sort()).toEqual(["map-derive.ts", "viability-map.ts"]);
    for (const quiet of ["viability.ts", "csv.ts", "audit.ts"]) {
      expect(moduleFiles.some((file) => isFile(file.rel, quiet))).toBe(true);
    }
  });

  it("only map-config.ts names MAPTILER anywhere in src", () => {
    expect(onlyConfigNamesMaptiler(allSrcFiles)).toEqual([]);
    expect(allSrcFiles.some((file) => file.rel.endsWith("presbytery-reports/map-config.ts"))).toBe(true);
  });

  it("no dangerouslySetInnerHTML or innerHTML in the dashboard directory, the module or the components (names render as text)", () => {
    expect(noDangerousHtml([...insightsFiles, ...moduleFiles, ...componentFiles])).toEqual([]);
  });

  it("no loading.tsx exists anywhere under admin/insights/** (the gate calls notFound and redirect)", () => {
    const loading = walk(INSIGHTS_DIR).filter((p) => /(^|\/)loading\.tsx?$/.test(p));
    expect(loading).toEqual([]);
  });

  it("the module names no export function beyond the six (a dashboard export cannot appear unreviewed)", () => {
    expect(exportFunctionNames([...moduleFiles, ...insightsFiles, ...componentFiles]).sort()).toEqual(
      SIX_EXPORTS,
    );
  });

  it("the child directories of admin/reports are exactly the registry's segments plus [aboutOrgId]", () => {
    const dirs = readdirSync(REPORTS_DIR).filter((n) => statSync(path.join(REPORTS_DIR, n)).isDirectory());
    expect(dirs.sort()).toEqual([...REPORT_SEGMENTS, "[aboutOrgId]"].sort());
  });

  it("each segment has a page.tsx and an export/route.ts and nothing else that serves", () => {
    for (const segment of REPORT_SEGMENTS) {
      const files = walk(path.join(REPORTS_DIR, segment)).map((p) => path.relative(path.join(REPORTS_DIR, segment), p)).sort();
      expect(files, segment).toEqual(PAGES_PENDING.includes(segment) ? ["export/route.ts"] : ["export/route.ts", "page.tsx"]);
    }
  });

  it("the two oversight reports read their tables only through src/lib/oversight/report-rows.ts, never by name", () => {
    for (const f of [...moduleFiles, ...segmentFiles, ...componentFiles]) {
      expect(NAMES_AN_OVERSIGHT_TABLE.test(code(f.content)), f.rel).toBe(false);
    }
    const buildings = moduleFiles.find((f) => f.rel.endsWith("presbytery-reports/buildings.ts"))!;
    const insurance = moduleFiles.find((f) => f.rel.endsWith("presbytery-reports/insurance-loans.ts"))!;
    expect(code(buildings.content)).toMatch(/from "@\/lib\/oversight\/report-rows"/);
    expect(code(insurance.content)).toMatch(/from "@\/lib\/oversight\/report-rows"/);
  });

  it("each oversight report reader checks its own registry key inside its transaction before reading a row", () => {
    for (const [file, key] of [
      ["buildings.ts", "buildings"],
      ["insurance-loans.ts", "insurance_and_loans"],
    ] as const) {
      const f = moduleFiles.find((m) => m.rel.endsWith(`presbytery-reports/${file}`))!;
      const c = code(f.content);
      expect(c, file).toContain(`reportByKey("${key}")`);
      const held = c.indexOf("holdsPermissions(tx, viewer, [REPORT.permission])");
      const facts = c.search(/\b(readBuildingsReportFacts|readInsuranceLoansReportFacts)\(/);
      const roster = c.indexOf("readRoster(");
      expect(held, file).toBeGreaterThan(-1);
      expect(held, file).toBeLessThan(roster);
      expect(roster, file).toBeLessThan(facts);
    }
  });
});

// ── Each rule fails on a sample (a rule that stops matching must fail here) ─

describe("each rule flags a violating sample", () => {
  it("names-an-oversight-table matches the SQL and the Drizzle names", () => {
    for (const name of ["oversight_loans", "oversight_building_appraisals", "oversightInsuranceYears", "oversightBuildings"]) {
      expect(NAMES_AN_OVERSIGHT_TABLE.test(`from(${name})`), name).toBe(true);
    }
    expect(NAMES_AN_OVERSIGHT_TABLE.test("readBuildingsReportFacts(tx)")).toBe(false);
  });

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

  it("insights-calls-its-gate fails in both directions", () => {
    expect(insightsCallsItsGate([f("i/page.tsx", "export default async function P() { return null; }")])).toHaveLength(1);
    expect(insightsCallsItsGate([f("i/page.tsx", "await gateReportPage({})")])).toHaveLength(1);
    expect(insightsCallsItsGate([f("i/page.tsx", "await gateInsightsPage({}); await gateReportPage({})")])).toHaveLength(1);
    expect(insightsCallsItsGate([f("i/page.tsx", "await gateInsightsPage({})")])).toEqual([]);
    // the reports pages are held to the opposite rule by calls-gate
    expect(callsGate([f("x/page.tsx", "await gateInsightsPage({})")])).toHaveLength(1);
  });

  it("no-dangerous-html", () => {
    // Spelled in two pieces: check:brand-scope bans the attribute anywhere outside the brand emitter, samples included.
    const attribute = "dangerously" + "SetInnerHTML";
    expect(noDangerousHtml([f("a.tsx", `<p ${attribute}={{ __html: name }} />`)])).toHaveLength(1);
    expect(noDangerousHtml([f("a.ts", "el.innerHTML = name;")])).toHaveLength(1);
    expect(noDangerousHtml([f("a.tsx", "// never use raw HTML here\n<p>{name}</p>")])).toEqual([]);
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

  it("the map's containment rules (DECISION-343)", () => {
    // client files, by name
    expect(clientFileNames([f("i/a.tsx", '"use client";\nexport const a = 1;'), f("i/b.ts", "export const b = 1;")])).toEqual(["a.tsx"]);

    // next/dynamic only in the loader, with ssr: false
    expect(dynamicOnlyInLoader([f("i/page.tsx", 'import dynamic from "next/dynamic";')])).toHaveLength(1);
    expect(dynamicOnlyInLoader([f("i/map-loader.tsx", 'import dynamic from "next/dynamic"; dynamic(() => import("./map"), { ssr: true })')])).toHaveLength(1);
    expect(dynamicOnlyInLoader([f("i/map-loader.tsx", "export const x = 1;")])).toHaveLength(1);
    expect(dynamicOnlyInLoader([f("i/map-loader.tsx", 'import dynamic from "next/dynamic"; dynamic(() => import("./map"), { ssr: false })')])).toEqual([]);
    expect(dynamicOnlyInLoader([f("i/page.tsx", '// next/dynamic would be wrong here\nexport const a = 1;')])).toEqual([]);

    // the map is never imported statically
    expect(mapImportedOnlyDynamically([f("i/page.tsx", 'import Map from "./map";')])).toHaveLength(1);
    expect(mapImportedOnlyDynamically([f("i/page.tsx", 'import { x } from "../insights/map";')])).toHaveLength(1);
    expect(mapImportedOnlyDynamically([f("c/a.tsx", 'import Map from "@/app/(org)/o/[slug]/admin/insights/map";')])).toHaveLength(1);
    expect(mapImportedOnlyDynamically([f("i/page.tsx", 'const M = await import("./map");')])).toHaveLength(1);
    expect(mapImportedOnlyDynamically([f("i/map-loader.tsx", 'dynamic(() => import("./map"), { ssr: false })')])).toEqual([]);
    expect(mapImportedOnlyDynamically([f("i/page.tsx", 'import { ViabilityMapLoader } from "./map-loader";\nimport { x } from "./map-support";\nimport "./map.css";')])).toEqual([]);

    // browser-file bans
    for (const [bad, name] of [
      ["const k = process.env.X;", "process.env"],
      ['const k = "MAPTILER";', "MAPTILER"],
      ["await fetch(url);", "fetch("],
      ["new XMLHttpRequest();", "XMLHttpRequest"],
      ['import { db } from "@/lib/db";', "@/lib/db"],
      ['import { auth } from "@/auth";', "@/auth"],
      ['import { cookies } from "next/headers";', "next/headers"],
      ['import { go } from "./actions";', "an actions import"],
      ["el.innerHTML = x;", ".innerHTML"],
      ["el.insertAdjacentHTML('beforeend', x);", "insertAdjacentHTML"],
      ["marker.bindTooltip(name);", "bindTooltip"],
      ["L.circleMarker(p);", "circleMarker"],
      ["L.icon({ iconUrl: x });", "L.icon("],
      ["const o = { iconUrl: x };", "iconUrl"],
      ["L.tileLayer(u, { attribution: x });", "an attribution option"],
    ] as const) {
      expect(browserFileBans([f("i/map.tsx", bad)]).map((h) => h.rule), bad).toContain(`browser-ban:${name}`);
    }
    expect(browserFileBans([f("i/map.tsx", "// never process.env here\nconst o = { attributionControl: false };")])).toEqual([]);
    expect(browserFileBans([f("i/map.tsx", "const a = MAP_COPY.attribution;")])).toEqual([]);

    // DOM-node builders only
    expect(nodeBuildersOnly([f("i/map.tsx", "m.bindPopup(`<b>${name}</b>`);")])).toHaveLength(1);
    expect(nodeBuildersOnly([f("i/map.tsx", "m.bindPopup(name);")])).toHaveLength(1);
    expect(nodeBuildersOnly([f("i/map.tsx", "m.bindPopup(popupNode(pin), {});")])).toEqual([]);
    expect(nodeBuildersOnly([f("i/map.tsx", "L.divIcon({ html: `<span>${n}</span>` });")])).toHaveLength(1);
    expect(nodeBuildersOnly([f("i/map.tsx", "L.divIcon({ html: pinNode(pin) });")])).toEqual([]);

    // coordinate columns
    expect(onlyMapFilesNameCoordinates([f("src/lib/presbytery-reports/viability.ts", "select({ latitude: t.latitude })")])).toHaveLength(1);
    expect(onlyMapFilesNameCoordinates([f("src/lib/presbytery-reports/csv.ts", "row.longitude")])).toHaveLength(1);
    expect(onlyMapFilesNameCoordinates([f("src/lib/presbytery-reports/viability-map.ts", "select({ latitude: t.latitude })")])).toEqual([]);
    expect(onlyMapFilesNameCoordinates([f("src/lib/presbytery-reports/map-derive.ts", "fact.longitude")])).toEqual([]);
    expect(onlyMapFilesNameCoordinates([f("src/lib/presbytery-reports/copy.ts", 'const a = "Add a latitude and longitude";\nconst b = `Longitude ${n}`;\n// latitude')])).toEqual([]);

    // MAPTILER
    expect(onlyConfigNamesMaptiler([f("src/lib/other.ts", "env.NEXT_PUBLIC_MAPTILER_KEY")])).toHaveLength(1);
    expect(onlyConfigNamesMaptiler([f("src/lib/presbytery-reports/map-config.ts", "env.NEXT_PUBLIC_MAPTILER_KEY")])).toEqual([]);
  });
});
