/**
 * U5: the congregation records' source-scan boundaries (docs/work-log/
 * 2026-11-17-congregation-profile.md, Phase 2 R4 and Phase 3 "Test plan" U5;
 * DECISION-344, 347). A database-free scan over this module, the oversight route
 * tree and the oversight components, with a FAILING SAMPLE for every rule so a
 * rule that stops matching fails the suite instead of passing silently.
 *
 * `check:audit` scans only `actions.ts` files that call `db.` directly, and the
 * writes here live in `store.ts`, so the audit properties live in
 * `audit-coverage.test.ts` and `store.db.test.ts` (the person-photos precedent).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const MODULE_DIR = path.join(ROOT, "src/lib/oversight");
const ROUTES_DIR = path.join(ROOT, "src/app/(org)/o/[slug]/admin/oversight");
const COMPONENTS_DIR = path.join(ROOT, "src/components/oversight");

interface SourceFile {
  rel: string;
  content: string;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
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
const isSource = (f: string) => /\.tsx?$/.test(f) && !isTest(f);

const moduleFiles = load(walk(MODULE_DIR).filter(isSource));
const routeFiles = load(walk(ROUTES_DIR).filter(isSource));
const componentFiles = load(walk(COMPONENTS_DIR).filter(isSource));
const allSrc = load(walk(path.join(ROOT, "src")).filter(isSource));
const surface = [...moduleFiles, ...routeFiles, ...componentFiles];

interface Hit {
  rule: string;
  file: string;
}

const base = (rel: string) => rel.split("/").pop()!;

// ── The rules, as functions over data (so a sample can fail each) ──────────

const OWNER_CONNECTION = /\b(getPlatformDb|PLATFORM_DATABASE_URL|MIGRATE_DATABASE_URL)\b/;
function noOwnerConnection(files: SourceFile[]): Hit[] {
  return files.filter((f) => OWNER_CONNECTION.test(code(f.content))).map((f) => ({ rule: "no-owner-connection", file: f.rel }));
}

const SQL_TABLES = [
  "oversight_profiles",
  "oversight_buildings",
  "oversight_building_photos",
  "oversight_building_appraisals",
  "oversight_insurance_years",
  "oversight_loans",
];
const DRIZZLE_TABLES = [
  "oversightProfiles",
  "oversightBuildings",
  "oversightBuildingPhotos",
  "oversightBuildingAppraisals",
  "oversightInsuranceYears",
  "oversightLoans",
];
const TABLE_NAME = new RegExp(`\\b(${[...SQL_TABLES, ...DRIZZLE_TABLES].join("|")})\\b`);
/** The files that may name the six tables (R4): the module's own, the schema mirror, and the dev-docs classification. */
const TABLE_ALLOWED = [
  "src/lib/oversight/store.ts",
  "src/lib/oversight/photo-store.ts",
  "src/lib/oversight/photo-reads.ts",
  "src/lib/oversight/reads.ts",
  "src/lib/oversight/report-rows.ts",
  "src/lib/db/domain/oversight.ts",
  "src/lib/dev-docs.ts",
];
function tableNamesOnlyInAllowedFiles(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => !TABLE_ALLOWED.includes(f.rel) && TABLE_NAME.test(code(f.content)))
    .map((f) => ({ rule: "table-names-allowed-files", file: f.rel }));
}

const WRITE_CALL = /\.(insert|update|delete)\(/;
/** Files that name a table and are not a writer must not write: the readers are read-only. */
function readersDoNotWrite(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => ["reads.ts", "photo-reads.ts", "report-rows.ts"].includes(base(f.rel)) && WRITE_CALL.test(code(f.content).replace(/insertAuditRow/g, "")))
    .map((f) => ({ rule: "readers-are-read-only", file: f.rel }));
}

/** `store.ts` writes five tables and never the photo table (that is `photo-store.ts`'s). */
function storeNeverNamesPhotos(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => base(f.rel) === "store.ts" && /\b(oversight_building_photos|oversightBuildingPhotos)\b/.test(code(f.content)))
    .map((f) => ({ rule: "store-not-photos", file: f.rel }));
}

function noRecordAudit(files: SourceFile[]): Hit[] {
  return files.filter((f) => /\brecordAudit\b/.test(code(f.content))).map((f) => ({ rule: "no-recordAudit", file: f.rel }));
}

/** Every `route.ts` and `loading.tsx` under the oversight tree is a violation (DECISION-350). */
function noRouteHandlerOrLoading(files: Array<{ rel: string }>): Hit[] {
  return files.filter((f) => /\/(route\.ts|loading\.tsx)$/.test(f.rel)).map((f) => ({ rule: "no-route-or-loading", file: f.rel }));
}

function pagesCallTheGate(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => f.rel.endsWith("/page.tsx"))
    .filter((f) => !/\bgateOversightPage\(/.test(code(f.content)))
    .map((f) => ({ rule: "page-calls-gate", file: f.rel }));
}

/** A page names only its own gate: never the reports or insights one. */
function pagesUseOnlyTheirGate(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => f.rel.endsWith("/page.tsx"))
    .filter((f) => /\b(gateReportPage|gateInsightsPage)\(/.test(code(f.content)))
    .map((f) => ({ rule: "page-own-gate", file: f.rel }));
}

/** The exported async functions of an `actions.ts`, with their bodies (brace matching from the `> {` that ends each signature). */
function actionBodies(content: string): Array<{ name: string; body: string }> {
  const c = code(content);
  const out: Array<{ name: string; body: string }> = [];
  for (const m of c.matchAll(/export async function (\w+)\s*\(/g)) {
    const marker = c.indexOf("> {", m.index!);
    if (marker < 0) continue;
    const open = marker + 2;
    let depth = 0;
    let end = open;
    for (let i = open; i < c.length; i++) {
      if (c[i] === "{") depth++;
      else if (c[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    out.push({ name: m[1]!, body: c.slice(open, end + 1) });
  }
  return out;
}

/** Every exported action calls the one gate helper first (it runs `assertOrgSession` before `resolveOrgContext`). */
function actionsCallTheActorGate(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files.filter((x) => base(x.rel) === "actions.ts")) {
    const actions = actionBodies(f.content);
    if (actions.length === 0) hits.push({ rule: "actions-found", file: f.rel });
    for (const a of actions) {
      const first = a.body.replace(/^\{\s*/, "");
      if (!/^const gate = await resolveOversightActor\(/.test(first)) hits.push({ rule: "action-calls-actor-gate-first", file: `${f.rel}#${a.name}` });
    }
  }
  return hits;
}

/** The helper itself authenticates (with the second-factor recheck) before it resolves the organization. */
function actorGateOrder(file: SourceFile | undefined): Hit[] {
  const c = file ? code(file.content) : "";
  const session = c.indexOf("assertOrgSession(");
  const resolve = c.indexOf("resolveOrgContext(");
  const ok = session >= 0 && resolve >= 0 && session < resolve && /\bauth\(\)/.test(c);
  return ok ? [] : [{ rule: "actor-gate-order", file: file?.rel ?? "action-gate.ts" }];
}

/** No action takes the organization from the client: no exported action signature names `organizationId`. */
function actionSignaturesNameNoOrganization(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files.filter((x) => base(x.rel) === "actions.ts")) {
    for (const m of code(f.content).matchAll(/export async function (\w+)\s*\(([^)]*)\)/g)) {
      if (/\borganizationId\b/.test(m[2]!)) hits.push({ rule: "no-org-param", file: `${f.rel}#${m[1]}` });
    }
  }
  return hits;
}

function noRedirectTargetParams(files: SourceFile[]): Hit[] {
  return files
    .filter(
      (f) =>
        /\.get(?:All)?\(\s*["'](callbackUrl|next|returnTo|redirect)["']/.test(code(f.content)) ||
        /\bsearchParams\.(callbackUrl|next|returnTo)\b/.test(code(f.content)) ||
        /\bquery\.(callbackUrl|next)\b/.test(code(f.content)) ||
        /\b(callbackUrl|returnTo)\s*[=:]\s*(?:searchParams|params)/.test(code(f.content)),
    )
    .map((f) => ({ rule: "no-redirect-target", file: f.rel }));
}

function noSharp(files: SourceFile[]): Hit[] {
  return files.filter((f) => /from\s*["']sharp["']|require\(\s*["']sharp["']\s*\)|import\(\s*["']sharp["']\s*\)/.test(code(f.content))).map((f) => ({ rule: "no-sharp", file: f.rel }));
}

/** `.store(` is `photo-store.ts`'s alone here, and every call there passes the literal `audience: "private"`. */
function blobStoreRule(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    const c = code(f.content);
    const calls = [...c.matchAll(/getBlobStore\(\)\s*\.\s*store\(/g)];
    if (calls.length === 0) continue;
    if (base(f.rel) !== "photo-store.ts") {
      hits.push({ rule: "store-only-in-photo-store", file: f.rel });
      continue;
    }
    for (const call of calls) {
      const window = c.slice(call.index!, call.index! + 600);
      if (!/audience:\s*"private"/.test(window)) hits.push({ rule: "store-private-literal", file: f.rel });
    }
  }
  return hits;
}

function noNumberInputs(files: SourceFile[]): Hit[] {
  return files.filter((f) => /type\s*=\s*["']number["']/.test(code(f.content))).map((f) => ({ rule: "no-number-input", file: f.rel }));
}

function noDangerousHtml(files: SourceFile[]): Hit[] {
  return files.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\b/.test(code(f.content))).map((f) => ({ rule: "no-dangerous-html", file: f.rel }));
}

function noConsoleLog(files: SourceFile[]): Hit[] {
  return files.filter((f) => /\bconsole\.log\(/.test(code(f.content))).map((f) => ({ rule: "no-console-log", file: f.rel }));
}

/** The names of exported functions and their bodies in a plain (non-actions) source file. */
function exportedFunctions(content: string): Array<{ name: string; body: string }> {
  const c = code(content);
  const starts = [...c.matchAll(/\n(?:export )?(?:async )?function (\w+)|\nconst \w+ =|\nclass \w+/g)];
  return starts
    .map((m, i) => ({ text: m[0], name: m[1], index: m.index!, end: starts[i + 1]?.index ?? c.length }))
    .filter((m) => m.text.startsWith("\nexport") && m.name)
    .map((m) => ({ name: m.name!, body: c.slice(m.index, m.end) }));
}

/** Every `store.ts` write checks its own table's key through `gate(`: tier 1 with the manage key, tier 2 with the finance key. */
function storeChecksItsKey(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "store-found", file: "store.ts" }];
  const hits: Hit[] = [];
  const fns = exportedFunctions(file.content);
  if (fns.length === 0) hits.push({ rule: "store-functions-found", file: file.rel });
  for (const fn of fns) {
    const finance = /Appraisal|Insurance|Loan/.test(fn.name);
    const want = finance ? "OVERSIGHT_FINANCE_KEY" : "OVERSIGHT_MANAGE_KEY";
    const other = finance ? "OVERSIGHT_MANAGE_KEY" : "OVERSIGHT_FINANCE_KEY";
    if (!new RegExp(`await gate\\(tx, ctx, ${want},`).test(fn.body) || new RegExp(`gate\\(tx, ctx, ${other},`).test(fn.body)) {
      hits.push({ rule: "store-checks-its-key", file: `${file.rel}#${fn.name}` });
    }
  }
  return hits;
}

/** Every reader checks a key inside its own transaction (directly or through `readUnder`). */
function readersCheckAKey(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "reads-found", file: "reads.ts" }];
  return exportedFunctions(file.content)
    .filter((fn) => /^read(Oversight|Profile|Building|Appraisals|Insurance|Loan)/.test(fn.name))
    .filter((fn) => !/\b(readUnder|holdsPermissions)\(/.test(fn.body))
    .map((fn) => ({ rule: "reader-checks-key", file: `${file.rel}#${fn.name}` }));
}

/** Every `photo-store.ts` write checks the manage key before anything else: through `gate(` (caption, cover, remove) or `checkUpload(` (add, whose first step is `requireKey(`). */
function photoStoreChecksTheKey(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "photo-store-found", file: "photo-store.ts" }];
  const hits: Hit[] = [];
  const fns = exportedFunctions(file.content);
  if (fns.length === 0) hits.push({ rule: "photo-store-functions-found", file: file.rel });
  for (const fn of fns) {
    const viaGate = /await gate\(tx, ctx, aboutOrgId\)/.test(fn.body);
    const viaUpload = /checkUpload\(tx, ctx, aboutOrgId, buildingId, file, (true|false)\)/.test(fn.body);
    if (!viaGate && !viaUpload) hits.push({ rule: "photo-store-checks-key", file: `${file.rel}#${fn.name}` });
  }
  const upload = /async function checkUpload\([\s\S]*?\n}\n/.exec(code(file.content))?.[0] ?? "";
  if (!/^async function checkUpload\([^)]*\)[^{]*\{\s*await requireKey\(tx, ctx\);/.test(upload)) {
    hits.push({ rule: "photo-store-checks-key", file: `${file.rel}#checkUpload` });
  }
  return hits;
}

/**
 * The upload's refusal order, read from the source (DECISION-346; the behavioural half is
 * `photo-store.unit.test.ts`): inside `checkUpload` the key, the toggle, the type, the congregation, the
 * building, then the cap; and in `addPhoto` the whole check, then the decode, then the blob store.
 */
function photoUploadOrder(file: SourceFile | undefined): Hit[] {
  const c = file ? code(file.content) : "";
  const upload = /async function checkUpload\([\s\S]*?\n}\n/.exec(c)?.[0] ?? "";
  const steps = ["requireKey(tx, ctx)", "isFlagEnabled(OVERSIGHT_FLAG)", "preflightPhoto(file)", "requireCongregation(", "await building(", "liveCount("];
  const at = steps.map((step) => upload.indexOf(step));
  const checkOrder = at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]!));
  const add = /export async function addPhoto\([\s\S]*?\n}\n/.exec(c)?.[0] ?? "";
  const phases = ["checkUpload(tx, ctx, aboutOrgId, buildingId, file, false)", "processPhoto(", "getBlobStore().store(", "checkUpload(tx, ctx, aboutOrgId, buildingId, file, true)"];
  const phaseAt = phases.map((step) => add.indexOf(step));
  const addOrder = phaseAt.every((i, n) => i >= 0 && (n === 0 || i > phaseAt[n - 1]!));
  // No decode call anywhere but addPhoto, and exactly one.
  const decodes = (c.match(/\bprocessPhoto\(/g) ?? []).length;
  return checkOrder && addOrder && decodes === 1 ? [] : [{ rule: "photo-upload-order", file: file?.rel ?? "photo-store.ts" }];
}

// ── The real tree ──────────────────────────────────────────────────────────

describe("congregation records: source boundaries (U5)", () => {
  it("scans something (the rules are not vacuous)", () => {
    expect(moduleFiles.map((f) => base(f.rel))).toEqual(expect.arrayContaining(["contract.ts", "validate.ts", "copy.ts", "derive.ts", "store.ts", "reads.ts", "action-gate.ts"]));
    expect(routeFiles.filter((f) => base(f.rel) === "actions.ts").length).toBeGreaterThanOrEqual(6);
    expect(routeFiles.filter((f) => base(f.rel) === "page.tsx").length).toBeGreaterThanOrEqual(3);
  });

  it("no owner connection in the module, the oversight routes or the components", () => {
    expect(noOwnerConnection(surface)).toEqual([]);
  });

  it("the six table names appear only in the allowed files (R4)", () => {
    expect(tableNamesOnlyInAllowedFiles(allSrc)).toEqual([]);
  });

  it("the readers are read-only and store.ts never touches the photo table", () => {
    expect(readersDoNotWrite(moduleFiles)).toEqual([]);
    expect(storeNeverNamesPhotos(moduleFiles)).toEqual([]);
  });

  it("no recordAudit in the module (every write audits in its own transaction with insertAuditRow)", () => {
    expect(noRecordAudit(moduleFiles)).toEqual([]);
  });

  it("no route.ts and no loading.tsx anywhere under oversight/**", () => {
    expect(noRouteHandlerOrLoading(walk(ROUTES_DIR).map((f) => ({ rel: path.relative(ROOT, f) })))).toEqual([]);
  });

  it("every page.tsx under oversight/** calls gateOversightPage, and no other gate", () => {
    expect(pagesCallTheGate(routeFiles)).toEqual([]);
    expect(pagesUseOnlyTheirGate(routeFiles)).toEqual([]);
  });

  it("every exported action calls the actor gate first, and that gate runs assertOrgSession before resolveOrgContext", () => {
    expect(actionsCallTheActorGate(routeFiles)).toEqual([]);
    expect(actorGateOrder(moduleFiles.find((f) => base(f.rel) === "action-gate.ts"))).toEqual([]);
  });

  it("no action takes an organization id from the client", () => {
    expect(actionSignaturesNameNoOrganization(routeFiles)).toEqual([]);
  });

  it("no callbackUrl or next is ever read (the only redirects are static paths from the validated slug)", () => {
    expect(noRedirectTargetParams(surface)).toEqual([]);
  });

  it("no sharp import (the image pipeline is storage/image/photo.ts's alone, DECISION-312 and 346)", () => {
    expect(noSharp(surface)).toEqual([]);
  });

  it("getBlobStore().store( appears only in photo-store.ts, with the literal audience: \"private\"", () => {
    expect(blobStoreRule(surface)).toEqual([]);
  });

  it("no type=\"number\" input in the oversight components or forms (a number input drops pasted text)", () => {
    expect(noNumberInputs([...routeFiles, ...componentFiles])).toEqual([]);
  });

  it("no dangerouslySetInnerHTML and no console.log in the surface", () => {
    expect(noDangerousHtml(surface)).toEqual([]);
    expect(noConsoleLog(surface)).toEqual([]);
  });

  it("every store write checks its own table's key; every reader checks a key in its own transaction", () => {
    expect(storeChecksItsKey(moduleFiles.find((f) => base(f.rel) === "store.ts"))).toEqual([]);
    expect(readersCheckAKey(moduleFiles.find((f) => base(f.rel) === "reads.ts"))).toEqual([]);
  });

  it("every photo write checks the manage key first, and the upload's refusal order is key, toggle, type, building, cap, then decode, then store, then the locked recheck", () => {
    expect(photoStoreChecksTheKey(moduleFiles.find((f) => base(f.rel) === "photo-store.ts"))).toEqual([]);
    expect(photoUploadOrder(moduleFiles.find((f) => base(f.rel) === "photo-store.ts"))).toEqual([]);
  });

  it("every photo reader checks the key in its own transaction (readUnder), and photo-reads.ts reads the blob table through the store only", () => {
    expect(readersCheckAKey(moduleFiles.find((f) => base(f.rel) === "photo-reads.ts"))).toEqual([]);
    const reads = moduleFiles.find((f) => base(f.rel) === "photo-reads.ts");
    expect(reads && /\bblob_assets\b|\bblobAssets\b/.test(code(reads.content))).toBe(false);
  });
});

// ── A failing sample for every rule ────────────────────────────────────────

const sample = (rel: string, content: string): SourceFile => ({ rel, content });

describe("each rule fails on a sample that breaks it", () => {
  it("no-owner-connection", () => {
    expect(noOwnerConnection([sample("a.ts", 'import { getPlatformDb } from "@/lib/db";')])).toHaveLength(1);
    expect(noOwnerConnection([sample("a.ts", "const u = process.env.MIGRATE_DATABASE_URL;")])).toHaveLength(1);
    expect(noOwnerConnection([sample("a.ts", "// getPlatformDb is forbidden here\nconst x = 1;")])).toHaveLength(0);
  });

  it("table-names-allowed-files", () => {
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/foo.ts", "tx.select().from(oversightLoans)")])).toHaveLength(1);
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/foo.ts", 'sql`select 1 from oversight_buildings`')])).toHaveLength(1);
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/oversight/reads.ts", "tx.select().from(oversightLoans)")])).toHaveLength(0);
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/foo.ts", 'const resourceType = "oversight_building";')])).toHaveLength(0);
  });

  it("readers-are-read-only and store-not-photos", () => {
    expect(readersDoNotWrite([sample("src/lib/oversight/reads.ts", "await tx.update(oversightLoans).set({})")])).toHaveLength(1);
    expect(readersDoNotWrite([sample("src/lib/oversight/reads.ts", "await tx.select().from(oversightLoans)")])).toHaveLength(0);
    expect(storeNeverNamesPhotos([sample("src/lib/oversight/store.ts", "tx.insert(oversightBuildingPhotos)")])).toHaveLength(1);
  });

  it("no-recordAudit", () => {
    expect(noRecordAudit([sample("a.ts", 'import { recordAudit } from "@/lib/audit";')])).toHaveLength(1);
    expect(noRecordAudit([sample("a.ts", "await insertAuditRow(tx, {})")])).toHaveLength(0);
  });

  it("no-route-or-loading", () => {
    expect(noRouteHandlerOrLoading([{ rel: "x/oversight/route.ts" }])).toHaveLength(1);
    expect(noRouteHandlerOrLoading([{ rel: "x/oversight/[id]/loading.tsx" }])).toHaveLength(1);
    expect(noRouteHandlerOrLoading([{ rel: "x/oversight/[id]/page.tsx" }])).toHaveLength(0);
  });

  it("page-calls-gate and page-own-gate", () => {
    expect(pagesCallTheGate([sample("x/oversight/page.tsx", "export default async function P() { await cachedAuth(); }")])).toHaveLength(1);
    expect(pagesCallTheGate([sample("x/oversight/page.tsx", "const gate = await gateOversightPage({ slug, path });")])).toHaveLength(0);
    expect(pagesUseOnlyTheirGate([sample("x/oversight/page.tsx", "await gateReportPage({ slug, path });")])).toHaveLength(1);
  });

  it("action-calls-actor-gate-first and actor-gate-order", () => {
    const bad = `"use server";\nexport async function fooAction(slug: string): Promise<X> {\n  const session = await auth();\n  return doIt();\n}\n`;
    expect(actionsCallTheActorGate([sample("x/oversight/actions.ts", bad)]).map((h) => h.rule)).toContain("action-calls-actor-gate-first");
    const good = `"use server";\nexport async function fooAction(slug: string): Promise<X> {\n  const gate = await resolveOversightActor(slug, {});\n  if (!gate.ok) return gate.result;\n  return doIt();\n}\n`;
    expect(actionsCallTheActorGate([sample("x/oversight/actions.ts", good)])).toHaveLength(0);
    expect(actorGateOrder(sample("action-gate.ts", "await resolveOrgContext(u, s); const c = assertOrgSession(await auth());"))).toHaveLength(1);
    expect(actorGateOrder(sample("action-gate.ts", "const c = assertOrgSession(await auth()); await resolveOrgContext(u, s);"))).toHaveLength(0);
    expect(actorGateOrder(undefined)).toHaveLength(1);
  });

  it("no-org-param", () => {
    expect(actionSignaturesNameNoOrganization([sample("x/oversight/actions.ts", "export async function a(organizationId: string, id: string) {}")])).toHaveLength(1);
    expect(actionSignaturesNameNoOrganization([sample("x/oversight/actions.ts", "export async function a(slug: string, id: string) {}")])).toHaveLength(0);
  });

  it("no-redirect-target", () => {
    expect(noRedirectTargetParams([sample("a.tsx", 'const next = searchParams.get("next");')])).toHaveLength(1);
    expect(noRedirectTargetParams([sample("a.tsx", "const u = query.callbackUrl;")])).toHaveLength(1);
    expect(noRedirectTargetParams([sample("a.tsx", "redirect(`/o/${slug}/admin/oversight`);")])).toHaveLength(0);
  });

  it("no-sharp", () => {
    expect(noSharp([sample("a.ts", 'import sharp from "sharp";')])).toHaveLength(1);
    expect(noSharp([sample("a.ts", 'const s = await import("sharp");')])).toHaveLength(1);
    expect(noSharp([sample("a.ts", "// sharp is Increment 2's\nconst x = 1;")])).toHaveLength(0);
  });

  it("store-only-in-photo-store and store-private-literal", () => {
    expect(blobStoreRule([sample("src/lib/oversight/store.ts", "await getBlobStore().store({ organizationId, audience: \"private\" });")])).toHaveLength(1);
    expect(blobStoreRule([sample("src/lib/oversight/photo-store.ts", "await getBlobStore().store({ organizationId, audience: \"public_site\" });")])).toHaveLength(1);
    expect(blobStoreRule([sample("src/lib/oversight/photo-store.ts", "await getBlobStore().store({ organizationId, audience: \"private\" });")])).toHaveLength(0);
  });

  it("no-number-input, no-dangerous-html and no-console-log", () => {
    expect(noNumberInputs([sample("a.tsx", '<Input type="number" />')])).toHaveLength(1);
    expect(noNumberInputs([sample("a.tsx", '<Input type="text" inputMode="decimal" />')])).toHaveLength(0);
    // The attribute is spelled in two pieces so check:brand-scope's text scan does not read this sample as a use.
    expect(noDangerousHtml([sample("a.tsx", `<div ${"danger"}${"ouslySetInnerHTML"}={{ __html: x }} />`)])).toHaveLength(1);
    expect(noConsoleLog([sample("a.ts", "console.log(x)")])).toHaveLength(1);
    expect(noConsoleLog([sample("a.ts", "console.error(x)")])).toHaveLength(0);
  });

  it("photo-store-checks-key and photo-upload-order", () => {
    const upload = (body: string) => `\nasync function checkUpload(tx, ctx, aboutOrgId, buildingId, file, lock) {\n${body}\n}\n`;
    const goodBody = "await requireKey(tx, ctx);\nif (!(await isFlagEnabled(OVERSIGHT_FLAG))) x;\npreflightPhoto(file);\nawait requireCongregation(tx);\nawait building(tx);\nliveCount(tx);";
    const add = (body: string) => `\nexport async function addPhoto(ctx) {\n${body}\n}\n`;
    const goodAdd = "checkUpload(tx, ctx, aboutOrgId, buildingId, file, false);\nprocessPhoto(file);\ngetBlobStore().store({});\ncheckUpload(tx, ctx, aboutOrgId, buildingId, file, true);";
    expect(photoUploadOrder(sample("photo-store.ts", upload(goodBody) + add(goodAdd)))).toHaveLength(0);
    // the type check after the building lookup
    const typeLate = goodBody.replace("preflightPhoto(file);\nawait requireCongregation(tx);\nawait building(tx);", "await requireCongregation(tx);\nawait building(tx);\npreflightPhoto(file);");
    expect(photoUploadOrder(sample("photo-store.ts", upload(typeLate) + add(goodAdd)))).toHaveLength(1);
    // the toggle before the key
    const flagFirst = goodBody.replace("await requireKey(tx, ctx);\nif (!(await isFlagEnabled(OVERSIGHT_FLAG))) x;", "if (!(await isFlagEnabled(OVERSIGHT_FLAG))) x;\nawait requireKey(tx, ctx);");
    expect(photoUploadOrder(sample("photo-store.ts", upload(flagFirst) + add(goodAdd)))).toHaveLength(1);
    // the decode before the pre-check, and a second decode call
    expect(photoUploadOrder(sample("photo-store.ts", upload(goodBody) + add("processPhoto(file);\n" + goodAdd)))).toHaveLength(1);
    // the locked recheck missing
    expect(photoUploadOrder(sample("photo-store.ts", upload(goodBody) + add(goodAdd.replace("file, true)", "file, false)"))))).toHaveLength(1);
    expect(photoUploadOrder(undefined)).toHaveLength(1);

    const writes = `\nexport function setPhotoCover(ctx) {\n  await gate(tx, ctx, aboutOrgId);\n}\n\nexport function removePhoto(ctx) {\n  return 1;\n}\n`;
    expect(photoStoreChecksTheKey(sample("photo-store.ts", upload(goodBody) + writes)).map((h) => h.file)).toEqual(["photo-store.ts#removePhoto"]);
    expect(photoStoreChecksTheKey(sample("photo-store.ts", upload(goodBody) + writes.replace("return 1;", "await gate(tx, ctx, aboutOrgId);")))).toHaveLength(0);
    // checkUpload that does something before the key
    expect(photoStoreChecksTheKey(sample("photo-store.ts", upload("preflightPhoto(file);\nawait requireKey(tx, ctx);") + writes.replace("return 1;", "await gate(tx, ctx, aboutOrgId);"))).map((h) => h.file)).toEqual(["photo-store.ts#checkUpload"]);
  });

  it("store-checks-its-key and reader-checks-key", () => {
    const wrongKey = `\nexport function recordLoan(ctx) {\n  await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);\n}\n`;
    expect(storeChecksItsKey(sample("store.ts", wrongKey))).toHaveLength(1);
    const noKey = `\nexport function createBuilding(ctx) {\n  return 1;\n}\n`;
    expect(storeChecksItsKey(sample("store.ts", noKey))).toHaveLength(1);
    const right = `\nexport function recordLoan(ctx) {\n  await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);\n}\n\nexport function createBuilding(ctx) {\n  await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);\n}\n`;
    expect(storeChecksItsKey(sample("store.ts", right))).toHaveLength(0);
    expect(readersCheckAKey(sample("reads.ts", "\nexport function readLoans(v) {\n  return db.select();\n}\n"))).toHaveLength(1);
    expect(readersCheckAKey(sample("reads.ts", "\nexport function readLoans(v) {\n  return readUnder(v, KEY, id, f);\n}\n"))).toHaveLength(0);
  });
});
