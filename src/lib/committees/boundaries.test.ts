/**
 * U5: the committees' source-scan boundaries (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 2 R1, R3.3 and Phase 3 "Test plan" U5; DECISION-352, 355,
 * 359). A database-free scan over this module, the committees route tree and the
 * committees components, with a FAILING SAMPLE for every rule so a rule that stops
 * matching fails the suite instead of passing silently.
 *
 * `check:audit` scans only `actions.ts` files that call `db.` directly, and the
 * writes here live in `store.ts`, so the audit properties live in
 * `audit-coverage.test.ts` and `store.db.test.ts` (the oversight and person-photos
 * precedent).
 *
 * THE DOWNWARD-TABLE RULE (R3.3, "from day one"): nothing under this module, the
 * route tree or the components names `administrative_commissions`,
 * `org_delegations`, `role_grants` or a `role_id`, in SQL or Drizzle. A commission
 * is a RECORD, never a grant, and a committee reaches a role only through
 * `role-grants.ts#readGroupRoleGrantsInTx`, which reads.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const MODULE_DIR = path.join(ROOT, "src/lib/committees");
const ROUTES_DIR = path.join(ROOT, "src/app/(org)/o/[slug]/admin/committees");
const COMPONENTS_DIR = path.join(ROOT, "src/components/committees");

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

/** No raw connection import at all: every read and write goes through `withOrgContext()` (RLS plus the actor check). */
function noRawDbImport(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => /from\s*["']@\/lib\/db["']/.test(code(f.content)))
    .map((f) => ({ rule: "no-raw-db-import", file: f.rel }));
}

/** R3.3: the downward tables and every spelling of a role grant. `\b` so `roleIds` (an audit field, an array of ids) is not `roleId`. */
const DOWNWARD = /\b(administrative_commissions|administrativeCommissions|org_delegations|orgDelegations|role_grants|roleGrants|roleId|role_id)\b/;
function noDownwardTables(files: SourceFile[]): Hit[] {
  return files.filter((f) => DOWNWARD.test(code(f.content))).map((f) => ({ rule: "no-downward-tables", file: f.rel }));
}

const SQL_TABLES = ["committee_details", "commission_records", "commission_record_members"];
const DRIZZLE_TABLES = ["committeeDetails", "commissionRecords", "commissionRecordMembers"];
const TABLE_NAME = new RegExp(`\\b(${[...SQL_TABLES, ...DRIZZLE_TABLES].join("|")})\\b`);
/** The files that may name the three new tables (R3.3): the module's writer and reader, the schema mirror, and the dev-docs classification. */
const TABLE_ALLOWED = [
  "src/lib/committees/store.ts",
  "src/lib/committees/reads.ts",
  "src/lib/db/domain/committees.ts",
  "src/lib/dev-docs.ts",
];
function tableNamesOnlyInAllowedFiles(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => !TABLE_ALLOWED.includes(f.rel) && TABLE_NAME.test(code(f.content)))
    .map((f) => ({ rule: "table-names-allowed-files", file: f.rel }));
}

const WRITE_CALL = /\.(insert|update|delete)\(/;
/** The reader names tables and must not write: it is read-only. */
function readersDoNotWrite(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => base(f.rel) === "reads.ts" && WRITE_CALL.test(code(f.content).replace(/insertAuditRow/g, "")))
    .map((f) => ({ rule: "readers-are-read-only", file: f.rel }));
}

/** `store.ts` is the only file in the surface that writes the new tables (a Drizzle write or raw SQL). */
const NEW_TABLE_WRITE = new RegExp(
  `\\.(insert|update|delete)\\(\\s*(${DRIZZLE_TABLES.join("|")})\\b|\\b(insert\\s+into|update|delete\\s+from)\\s+(${SQL_TABLES.join("|")})\\b`,
  "i",
);
function onlyStoreWritesNewTables(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => base(f.rel) !== "store.ts" && NEW_TABLE_WRITE.test(code(f.content)))
    .map((f) => ({ rule: "only-store-writes-new-tables", file: f.rel }));
}

/** Nothing deletes any of the new tables, even `store.ts` (all deletes are soft; presby_app holds no DELETE). */
const NEW_TABLE_DELETE = new RegExp(`\\.delete\\(\\s*(${DRIZZLE_TABLES.join("|")})\\b|\\bdelete\\s+from\\s+(${SQL_TABLES.join("|")})\\b`, "i");
function neverDeletesNewTables(files: SourceFile[]): Hit[] {
  return files.filter((f) => NEW_TABLE_DELETE.test(code(f.content))).map((f) => ({ rule: "never-delete-new-tables", file: f.rel }));
}

/** R1: `groups` and `group_memberships` are written only through `@/lib/groups`; nothing in the surface writes them. */
const GROUP_WRITE = /\.(insert|update|delete)\(\s*(groups|groupMemberships)\b|\b(insert\s+into|update|delete\s+from)\s+(groups|group_memberships)\b/i;
function noDirectGroupWrites(files: SourceFile[]): Hit[] {
  return files.filter((f) => GROUP_WRITE.test(code(f.content))).map((f) => ({ rule: "no-direct-group-writes", file: f.rel }));
}

function noRecordAudit(files: SourceFile[]): Hit[] {
  return files.filter((f) => /\brecordAudit\b/.test(code(f.content))).map((f) => ({ rule: "no-recordAudit", file: f.rel }));
}

/** Every `route.ts` and `loading.tsx` under the committees tree is a violation (DECISION-251: no loading.tsx under admin/**). */
function noRouteHandlerOrLoading(files: Array<{ rel: string }>): Hit[] {
  return files.filter((f) => /\/(route\.ts|loading\.tsx)$/.test(f.rel)).map((f) => ({ rule: "no-route-or-loading", file: f.rel }));
}

/** R1: the committees tree depends on nothing in the groups admin and on no `org_portal.groups` flag. */
const GROUPS_ADMIN = /admin\/groups\b|\.\.\/groups\/|org_portal\.groups\b/;
function noGroupsAdminDependency(files: SourceFile[]): Hit[] {
  return files.filter((f) => GROUPS_ADMIN.test(code(f.content))).map((f) => ({ rule: "no-groups-admin-dependency", file: f.rel }));
}

/**
 * The placeholder page the committees pipeline replaces (it predates the gate and renders `ComingSoon`): exempt ONLY
 * while its own text still says so, so the exemption expires the moment the real page lands and cannot hide a page
 * that forgot the gate.
 */
const isPlaceholderPage = (f: SourceFile) => f.rel.endsWith("admin/committees/page.tsx") && /\bComingSoon\b/.test(code(f.content));
function pagesCallTheGate(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => f.rel.endsWith("/page.tsx") && !isPlaceholderPage(f))
    .filter((f) => !/\bgateCommitteesPage\(/.test(code(f.content)))
    .map((f) => ({ rule: "page-calls-gate", file: f.rel }));
}

/** A page names only its own gate: never the reports, insights or oversight one. */
function pagesUseOnlyTheirGate(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => f.rel.endsWith("/page.tsx"))
    .filter((f) => /\b(gateReportPage|gateInsightsPage|gateOversightPage)\(/.test(code(f.content)))
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

/** The actor gate call may follow a defensive read of the form's values (`const v = bag(values);`), but nothing that reaches a store or a read. */
function actionsCallTheActorGate(files: SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files.filter((x) => base(x.rel) === "actions.ts")) {
    const actions = actionBodies(f.content);
    if (actions.length === 0) hits.push({ rule: "actions-found", file: f.rel });
    for (const a of actions) {
      const first = a.body.replace(/^\{\s*/, "");
      const lead = first.replace(/^const v = bag\(values\);\s*/, "");
      if (!/^const gate = await resolveCommitteesActor\(/.test(lead)) hits.push({ rule: "action-calls-actor-gate-first", file: `${f.rel}#${a.name}` });
    }
  }
  return hits;
}

/**
 * The helper itself authenticates (with the second-factor recheck) before it resolves the organization,
 * and reads the `org_portal.committees` flag after that and before it checks an id (G1: every action,
 * through the one gate, answers what the page answers).
 */
function actorGateOrder(file: SourceFile | undefined): Hit[] {
  const c = file ? code(file.content) : "";
  const session = c.indexOf("assertOrgSession(");
  const resolve = c.indexOf("resolveOrgContext(");
  const flag = c.indexOf("isFlagEnabled(COMMITTEES_FLAG)");
  const ids = c.indexOf("isUuid(");
  const ok = session >= 0 && resolve >= 0 && session < resolve && /\bauth\(\)/.test(c) && flag > resolve && flag < ids;
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

function noSharpOrBlobStore(files: SourceFile[]): Hit[] {
  return files
    .filter((f) => /from\s*["']sharp["']|require\(\s*["']sharp["']\s*\)|import\(\s*["']sharp["']\s*\)|\bgetBlobStore\b/.test(code(f.content)))
    .map((f) => ({ rule: "no-sharp-or-blob-store", file: f.rel }));
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
  // A top-level interface or type also ends a function's body, so a row type's field names are never read as the function's.
  const starts = [...c.matchAll(/\n(?:export )?(?:async )?function (\w+)|\nconst \w+ =|\nclass \w+|\n(?:export )?(?:interface|type) \w+/g)];
  return starts
    .map((m, i) => ({ text: m[0], name: m[1], index: m.index!, end: starts[i + 1]?.index ?? c.length }))
    .filter((m) => m.text.startsWith("\nexport") && m.name)
    .map((m) => ({ name: m.name!, body: c.slice(m.index, m.end) }));
}

/**
 * Every `store.ts` write checks the key and the organization type FIRST (`await gate(tx, ctx)`), and does so before it
 * locks, reads a committee or writes anything.
 */
function storeChecksTheKeyFirst(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "store-found", file: "store.ts" }];
  const hits: Hit[] = [];
  const fns = exportedFunctions(file.content);
  if (fns.length === 0) hits.push({ rule: "store-functions-found", file: file.rel });
  for (const fn of fns) {
    const gateAt = fn.body.indexOf("await gate(tx, ctx)");
    const later = ["lockNames(", "lockSeats(", "lockMembers(", "loadCommittee(", "loadSeat(", "loadCommission(", "loadMember(", ".insert(", ".update("]
      .map((needle) => fn.body.indexOf(needle))
      .filter((i) => i >= 0);
    if (gateAt < 0 || later.some((i) => i < gateAt)) hits.push({ rule: "store-checks-key-first", file: `${file.rel}#${fn.name}` });
  }
  return hits;
}

/** The shared reader preamble checks the key and the organization type, and every exported reader goes through it. */
function readersCheckAKey(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "reads-found", file: "reads.ts" }];
  const c = code(file.content);
  const hits: Hit[] = [];
  const preamble = /function readUnder<[\s\S]*?\n}\n/.exec(c)?.[0] ?? "";
  if (!/mayManage\(tx, viewer\)/.test(preamble)) hits.push({ rule: "reader-preamble-checks-key", file: file.rel });
  const mayManage = /async function mayManage\([\s\S]*?\n}\n/.exec(c)?.[0] ?? "";
  if (!(/holdsPermissions\(/.test(mayManage) && /presbytery/.test(mayManage))) hits.push({ rule: "may-manage-checks-key-and-type", file: file.rel });
  for (const fn of exportedFunctions(file.content).filter((f) => /^read[A-Z]/.test(f.name))) {
    if (!/\breadUnder\(/.test(fn.body)) hits.push({ rule: "reader-checks-key", file: `${file.rel}#${fn.name}` });
  }
  return hits;
}

/** The commission tables in the Drizzle mirror have no role, group or public-listing column (DECISION-355: not a grant, not listable). */
function commissionTablesHaveNoGrantColumns(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "mirror-found", file: "committees.ts" }];
  const c = code(file.content);
  const start = c.indexOf("export const commissionRecords = pgTable(");
  if (start < 0) return [{ rule: "commission-tables-found", file: file.rel }];
  return /["'](role_id|group_id|public_listed)["']/.test(c.slice(start)) ? [{ rule: "commission-tables-no-grant-columns", file: file.rel }] : [];
}

/**
 * A commission record is NOT a group (DECISION-355): the commission functions of `store.ts` (every exported one
 * whose name has "Commission" in it) reach no `groups` primitive, no `group_memberships` and no role. A commission
 * member is a `commission_record_members` row; routing one through the groups primitives would make it a group
 * seat the permission resolver and the public roster can see.
 */
const GROUP_REACH = /\b(addManagedGroupSeatInTx|endManagedGroupMemberInTx|insertManagedGroupInTx|updateManagedGroupInTx|setManagedMembershipPublicListedInTx|groupMemberships|group_memberships|groups|groupTypes)\b|\bgroupId\b|\bgroup_id\b/;
function commissionFunctionsReachNoGroups(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "store-found", file: "store.ts" }];
  const fns = exportedFunctions(file.content).filter((f) => /Commission/.test(f.name));
  const hits: Hit[] = [];
  if (fns.length === 0) hits.push({ rule: "commission-functions-found", file: file.rel });
  for (const fn of fns) if (GROUP_REACH.test(fn.body)) hits.push({ rule: "commission-functions-reach-no-groups", file: `${file.rel}#${fn.name}` });
  return hits;
}

/**
 * The charge is tier 1 and sensitive (residual 10): only the one reader that renders the record (`readCommission`)
 * returns it. The list and the form readers do not name it, so a list can never carry a charge to a card, a CSV or a log.
 */
function chargeOnlyInTheRecordReader(file: SourceFile | undefined): Hit[] {
  if (!file) return [{ rule: "reads-found", file: "reads.ts" }];
  const readers = exportedFunctions(file.content).filter((f) => /^readCommission/.test(f.name));
  const hits: Hit[] = [];
  if (readers.length === 0) hits.push({ rule: "commission-readers-found", file: file.rel });
  for (const fn of readers) {
    if (fn.name !== "readCommission" && /\bcharge\b/.test(fn.body)) hits.push({ rule: "charge-only-in-the-record-reader", file: `${file.rel}#${fn.name}` });
  }
  return hits;
}

// ── The real tree ──────────────────────────────────────────────────────────

describe("committees: source boundaries (U5)", () => {
  it("scans something (the rules are not vacuous)", () => {
    expect(moduleFiles.map((f) => base(f.rel))).toEqual(
      expect.arrayContaining(["contract.ts", "validate.ts", "copy.ts", "derive.ts", "store.ts", "reads.ts", "action-gate.ts"]),
    );
    expect(routeFiles.filter((f) => base(f.rel) === "actions.ts").length).toBeGreaterThanOrEqual(2);
    expect(allSrc.some((f) => f.rel === "src/lib/db/domain/committees.ts")).toBe(true);
  });

  it("no owner connection, and no raw db import, in the module, the committees routes or the components", () => {
    expect(noOwnerConnection(surface)).toEqual([]);
    expect(noRawDbImport(surface)).toEqual([]);
  });

  it("no downward table and no role anywhere in the surface (R3.3, from day one)", () => {
    expect(noDownwardTables(surface)).toEqual([]);
  });

  it("the three new table names appear only in the allowed files", () => {
    expect(tableNamesOnlyInAllowedFiles(allSrc)).toEqual([]);
  });

  it("store.ts is the only writer of the new tables; the reader is read-only; nothing deletes a new table", () => {
    expect(onlyStoreWritesNewTables(surface)).toEqual([]);
    expect(readersDoNotWrite(moduleFiles)).toEqual([]);
    expect(neverDeletesNewTables(surface)).toEqual([]);
  });

  it("nothing in the surface inserts, updates or deletes groups or group_memberships (writes go through @/lib/groups)", () => {
    expect(noDirectGroupWrites(surface)).toEqual([]);
    const store = moduleFiles.find((f) => base(f.rel) === "store.ts")!;
    for (const exported of [
      "addManagedGroupSeatInTx",
      "endManagedGroupMemberInTx",
      "insertManagedGroupInTx",
      "setManagedMembershipPublicListedInTx",
      "updateManagedGroupInTx",
    ]) {
      expect(code(store.content), exported).toContain(exported);
    }
  });

  it("no recordAudit in the module (every write audits in its own transaction with insertAuditRow)", () => {
    expect(noRecordAudit(surface)).toEqual([]);
  });

  it("no route.ts and no loading.tsx anywhere under admin/committees/**", () => {
    expect(noRouteHandlerOrLoading(walk(ROUTES_DIR).map((f) => ({ rel: path.relative(ROOT, f) })))).toEqual([]);
  });

  it("the committees tree imports nothing from admin/groups/ and reads no org_portal.groups flag", () => {
    expect(noGroupsAdminDependency(surface)).toEqual([]);
  });

  it("every page.tsx under admin/committees/** calls gateCommitteesPage, and no other gate", () => {
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

  it("no callbackUrl or next is ever read (back-links are static paths from the validated slug)", () => {
    expect(noRedirectTargetParams(surface)).toEqual([]);
  });

  it("no sharp import and no blob store (committees carry no files)", () => {
    expect(noSharpOrBlobStore(surface)).toEqual([]);
  });

  it("no type=\"number\" input in the committees components or forms (a number input drops pasted text)", () => {
    expect(noNumberInputs([...routeFiles, ...componentFiles])).toEqual([]);
  });

  it("no dangerouslySetInnerHTML and no console.log in the surface", () => {
    expect(noDangerousHtml(surface)).toEqual([]);
    expect(noConsoleLog(surface)).toEqual([]);
  });

  it("every store write checks the key and the organization type first; every reader checks them in its own transaction", () => {
    expect(storeChecksTheKeyFirst(moduleFiles.find((f) => base(f.rel) === "store.ts"))).toEqual([]);
    expect(readersCheckAKey(moduleFiles.find((f) => base(f.rel) === "reads.ts"))).toEqual([]);
  });

  it("the Drizzle mirror's commission tables have no role_id, group_id or public_listed column", () => {
    expect(commissionTablesHaveNoGrantColumns(allSrc.find((f) => f.rel === "src/lib/db/domain/committees.ts"))).toEqual([]);
  });

  it("the commission actions exist, and a commission is never a group: its store functions reach no groups primitive and no role", () => {
    const rels = routeFiles.map((f) => f.rel);
    expect(rels).toContain("src/app/(org)/o/[slug]/admin/committees/commissions/actions.ts");
    expect(rels).toContain("src/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions.ts");
    const store = moduleFiles.find((f) => base(f.rel) === "store.ts");
    expect(commissionFunctionsReachNoGroups(store)).toEqual([]);
    // the six commission writes are there, so the rule above is not vacuous
    expect(exportedFunctions(store!.content).filter((f) => /Commission/.test(f.name)).map((f) => f.name).sort()).toEqual(
      ["addCommissionMember", "endCommission", "endCommissionMember", "recordCommission", "removeCommissionRecord", "updateCommission"].sort(),
    );
  });

  it("only the record reader returns a commission's charge", () => {
    expect(chargeOnlyInTheRecordReader(moduleFiles.find((f) => base(f.rel) === "reads.ts"))).toEqual([]);
  });

  it("nothing in the surface writes administrative_commissions, org_delegations, role_grants or a role id, by any spelling (the hard rule of Increment 2)", () => {
    expect(noDownwardTables(surface)).toEqual([]);
    for (const f of surface) {
      expect(code(f.content), f.rel).not.toMatch(/\b(administrative_?commissions|administrativeCommissions|org_?delegations|orgDelegations|role_?grants|roleGrants|roleId|role_id)\b/i);
    }
  });
});

// ── A failing sample for every rule ────────────────────────────────────────

const sample = (rel: string, content: string): SourceFile => ({ rel, content });

describe("each rule fails on a sample that breaks it", () => {
  it("no-owner-connection and no-raw-db-import", () => {
    expect(noOwnerConnection([sample("a.ts", 'import { getPlatformDb } from "@/lib/db";')])).toHaveLength(1);
    expect(noOwnerConnection([sample("a.ts", "const u = process.env.MIGRATE_DATABASE_URL;")])).toHaveLength(1);
    expect(noOwnerConnection([sample("a.ts", "// getPlatformDb is forbidden here\nconst x = 1;")])).toHaveLength(0);
    expect(noRawDbImport([sample("a.ts", 'import { db } from "@/lib/db";')])).toHaveLength(1);
    expect(noRawDbImport([sample("a.ts", 'import { groups } from "@/lib/db/domain/groups";')])).toHaveLength(0);
  });

  it("no-downward-tables: every spelling of the downward tables and a role", () => {
    for (const text of [
      "from administrative_commissions",
      "tx.select().from(administrativeCommissions)",
      "select * from org_delegations",
      "tx.insert(orgDelegations)",
      "insert into role_grants",
      "tx.insert(roleGrants)",
      "const roleId = 1",
      'select("role_id")',
    ]) {
      expect(noDownwardTables([sample("src/lib/committees/store.ts", text)]), text).toHaveLength(1);
    }
    // `roleIds` (the audit field: an array of ids) is not a role id, and a comment is not code.
    expect(noDownwardTables([sample("a.ts", "metadata: { roleIds: ids }")])).toHaveLength(0);
    expect(noDownwardTables([sample("a.ts", "// never role_grants or roleId here\nconst x = 1;")])).toHaveLength(0);
  });

  it("table-names-allowed-files", () => {
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/foo.ts", "tx.select().from(committeeDetails)")])).toHaveLength(1);
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/foo.ts", "sql`select 1 from commission_records`")])).toHaveLength(1);
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/foo.ts", "tx.select().from(commissionRecordMembers)")])).toHaveLength(1);
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/committees/reads.ts", "tx.select().from(committeeDetails)")])).toHaveLength(0);
    expect(tableNamesOnlyInAllowedFiles([sample("src/lib/foo.ts", 'const resourceType = "committee_member";')])).toHaveLength(0);
  });

  it("readers-are-read-only", () => {
    expect(readersDoNotWrite([sample("src/lib/committees/reads.ts", "await tx.update(committeeDetails).set({})")])).toHaveLength(1);
    expect(readersDoNotWrite([sample("src/lib/committees/reads.ts", "await tx.insert(committeeDetails).values({})")])).toHaveLength(1);
    expect(readersDoNotWrite([sample("src/lib/committees/reads.ts", "await tx.select().from(committeeDetails)")])).toHaveLength(0);
  });

  it("only-store-writes-new-tables and never-delete-new-tables", () => {
    expect(onlyStoreWritesNewTables([sample("src/lib/committees/reads.ts", "await tx.insert(committeeDetails).values({})")])).toHaveLength(1);
    expect(onlyStoreWritesNewTables([sample("src/app/x/actions.ts", "await tx.update(commissionRecords).set({})")])).toHaveLength(1);
    expect(onlyStoreWritesNewTables([sample("src/lib/committees/derive.ts", "sql`update committee_details set kind = null`")])).toHaveLength(1);
    expect(onlyStoreWritesNewTables([sample("src/lib/committees/store.ts", "await tx.insert(committeeDetails).values({})")])).toHaveLength(0);
    expect(neverDeletesNewTables([sample("src/lib/committees/store.ts", "await tx.delete(committeeDetails)")])).toHaveLength(1);
    expect(neverDeletesNewTables([sample("src/lib/committees/store.ts", "sql`delete from commission_record_members`")])).toHaveLength(1);
    expect(neverDeletesNewTables([sample("src/lib/committees/store.ts", "await tx.update(committeeDetails).set({})")])).toHaveLength(0);
  });

  it("no-direct-group-writes", () => {
    for (const text of [
      "await tx.insert(groups).values({})",
      "await tx.update(groupMemberships).set({ endsOn })",
      "await tx.delete(groupMemberships)",
      "sql`insert into group_memberships (id) values (1)`",
      "sql`update groups set name = 'x'`",
      "sql`delete from group_memberships`",
    ]) {
      expect(noDirectGroupWrites([sample("src/lib/committees/store.ts", text)]), text).toHaveLength(1);
    }
    // a read is allowed
    expect(noDirectGroupWrites([sample("src/lib/committees/store.ts", "await tx.select().from(groupMemberships)")])).toHaveLength(0);
    expect(noDirectGroupWrites([sample("src/lib/committees/store.ts", "// never tx.insert(groups)\nconst x = 1;")])).toHaveLength(0);
  });

  it("no-recordAudit", () => {
    expect(noRecordAudit([sample("a.ts", 'import { recordAudit } from "@/lib/audit";')])).toHaveLength(1);
    expect(noRecordAudit([sample("a.ts", "await insertAuditRow(tx, {})")])).toHaveLength(0);
  });

  it("no-route-or-loading", () => {
    expect(noRouteHandlerOrLoading([{ rel: "x/committees/route.ts" }])).toHaveLength(1);
    expect(noRouteHandlerOrLoading([{ rel: "x/committees/[id]/loading.tsx" }])).toHaveLength(1);
    expect(noRouteHandlerOrLoading([{ rel: "x/committees/[id]/page.tsx" }])).toHaveLength(0);
  });

  it("no-groups-admin-dependency", () => {
    expect(noGroupsAdminDependency([sample("a.tsx", 'import { x } from "@/app/(org)/o/[slug]/admin/groups/public-listing-toggle";')])).toHaveLength(1);
    expect(noGroupsAdminDependency([sample("a.tsx", 'import { x } from "../groups/group-type-labels";')])).toHaveLength(1);
    expect(noGroupsAdminDependency([sample("a.ts", 'const on = await isFlagEnabled("org_portal.groups");')])).toHaveLength(1);
    expect(noGroupsAdminDependency([sample("a.ts", "// not the groups admin: admin/groups\nconst x = 1;")])).toHaveLength(0);
    expect(noGroupsAdminDependency([sample("a.ts", 'import { GROUP_ROLE_LABELS } from "@/lib/group-roles";')])).toHaveLength(0);
  });

  it("page-calls-gate and page-own-gate, and the placeholder exemption expires with the placeholder", () => {
    expect(pagesCallTheGate([sample("x/committees/page.tsx", "export default async function P() { await cachedAuth(); }")])).toHaveLength(1);
    expect(pagesCallTheGate([sample("x/committees/page.tsx", "const gate = await gateCommitteesPage({ slug, path });")])).toHaveLength(0);
    expect(pagesUseOnlyTheirGate([sample("x/committees/page.tsx", "await gateReportPage({ slug, path });")])).toHaveLength(1);
    expect(pagesUseOnlyTheirGate([sample("x/committees/page.tsx", "await gateOversightPage({ slug, path });")])).toHaveLength(1);
    // The stub renders ComingSoon and is exempt; the same file without it is not.
    expect(pagesCallTheGate([sample("src/app/(org)/o/[slug]/admin/committees/page.tsx", "return <ComingSoon area={AREA} />;")])).toHaveLength(0);
    expect(pagesCallTheGate([sample("src/app/(org)/o/[slug]/admin/committees/page.tsx", "return <Committees />;")])).toHaveLength(1);
    expect(pagesCallTheGate([sample("src/app/(org)/o/[slug]/admin/committees/new/page.tsx", "return <ComingSoon />;")])).toHaveLength(1);
  });

  it("action-calls-actor-gate-first and actor-gate-order", () => {
    const bad = `"use server";\nexport async function fooAction(slug: string): Promise<X> {\n  const session = await auth();\n  return doIt();\n}\n`;
    expect(actionsCallTheActorGate([sample("x/committees/actions.ts", bad)]).map((h) => h.rule)).toContain("action-calls-actor-gate-first");
    const good = `"use server";\nexport async function fooAction(slug: string): Promise<X> {\n  const gate = await resolveCommitteesActor(slug, {});\n  if (!gate.ok) return gate.result;\n  return doIt();\n}\n`;
    expect(actionsCallTheActorGate([sample("x/committees/actions.ts", good)])).toHaveLength(0);
    // the defensive read of the values may precede the gate; nothing else may
    const withBag = good.replace("const gate", "const v = bag(values);\n  const gate");
    expect(actionsCallTheActorGate([sample("x/committees/actions.ts", withBag)])).toHaveLength(0);
    const readsFirst = good.replace("const gate", "const rows = await readCommittee(viewer, id);\n  const gate");
    expect(actionsCallTheActorGate([sample("x/committees/actions.ts", readsFirst)])).toHaveLength(1);
    expect(actionsCallTheActorGate([sample("x/committees/actions.ts", "export const x = 1;")]).map((h) => h.rule)).toContain("actions-found");
    expect(actorGateOrder(sample("action-gate.ts", "await resolveOrgContext(u, s); const c = assertOrgSession(await auth());"))).toHaveLength(1);
    expect(actorGateOrder(sample("action-gate.ts", "const c = assertOrgSession(await auth()); await resolveOrgContext(u, s); await isFlagEnabled(COMMITTEES_FLAG); isUuid(v);"))).toHaveLength(0);
    expect(actorGateOrder(undefined)).toHaveLength(1);
    // G1: the flag check is part of the order, after the organization and before the ids
    const ordered = "const c = assertOrgSession(await auth()); await resolveOrgContext(u, s); if (!(await isFlagEnabled(COMMITTEES_FLAG))) return; isUuid(v);";
    expect(actorGateOrder(sample("action-gate.ts", ordered))).toHaveLength(0);
    expect(actorGateOrder(sample("action-gate.ts", ordered.replace("if (!(await isFlagEnabled(COMMITTEES_FLAG))) return; ", "")))).toHaveLength(1);
    expect(actorGateOrder(sample("action-gate.ts", "const c = assertOrgSession(await auth()); await resolveOrgContext(u, s); isUuid(v); isFlagEnabled(COMMITTEES_FLAG);"))).toHaveLength(1);
  });

  it("no-org-param", () => {
    expect(actionSignaturesNameNoOrganization([sample("x/committees/actions.ts", "export async function a(organizationId: string, id: string) {}")])).toHaveLength(1);
    expect(actionSignaturesNameNoOrganization([sample("x/committees/actions.ts", "export async function a(slug: string, id: string) {}")])).toHaveLength(0);
  });

  it("no-redirect-target", () => {
    expect(noRedirectTargetParams([sample("a.tsx", 'const next = searchParams.get("next");')])).toHaveLength(1);
    expect(noRedirectTargetParams([sample("a.tsx", "const u = query.callbackUrl;")])).toHaveLength(1);
    expect(noRedirectTargetParams([sample("a.tsx", "redirect(`/o/${slug}/admin/committees`);")])).toHaveLength(0);
  });

  it("no-sharp-or-blob-store", () => {
    expect(noSharpOrBlobStore([sample("a.ts", 'import sharp from "sharp";')])).toHaveLength(1);
    expect(noSharpOrBlobStore([sample("a.ts", 'const s = await import("sharp");')])).toHaveLength(1);
    expect(noSharpOrBlobStore([sample("a.ts", "const b = getBlobStore();")])).toHaveLength(1);
    expect(noSharpOrBlobStore([sample("a.ts", "// no sharp here\nconst x = 1;")])).toHaveLength(0);
  });

  it("no-number-input, no-dangerous-html and no-console-log", () => {
    expect(noNumberInputs([sample("a.tsx", '<Input type="number" />')])).toHaveLength(1);
    expect(noNumberInputs([sample("a.tsx", '<Input type="date" />')])).toHaveLength(0);
    // The attribute is spelled in two pieces so check:brand-scope's text scan does not read this sample as a use.
    expect(noDangerousHtml([sample("a.tsx", `<div ${"danger"}${"ouslySetInnerHTML"}={{ __html: x }} />`)])).toHaveLength(1);
    expect(noConsoleLog([sample("a.ts", "console.log(x)")])).toHaveLength(1);
    expect(noConsoleLog([sample("a.ts", "console.error(x)")])).toHaveLength(0);
  });

  it("store-checks-key-first and reader-checks-key", () => {
    const wrongOrder = `\nexport function addThing(ctx) {\n  await lockSeats(tx, ctx, id);\n  await gate(tx, ctx);\n}\n`;
    expect(storeChecksTheKeyFirst(sample("store.ts", wrongOrder))).toHaveLength(1);
    const noGate = `\nexport function addThing(ctx) {\n  return 1;\n}\n`;
    expect(storeChecksTheKeyFirst(sample("store.ts", noGate))).toHaveLength(1);
    const writesFirst = `\nexport function addThing(ctx) {\n  await tx.insert(committeeDetails);\n  await gate(tx, ctx);\n}\n`;
    expect(storeChecksTheKeyFirst(sample("store.ts", writesFirst))).toHaveLength(1);
    const good = `\nexport function addThing(ctx) {\n  await gate(tx, ctx);\n  await lockSeats(tx, ctx, id);\n}\n`;
    expect(storeChecksTheKeyFirst(sample("store.ts", good))).toHaveLength(0);
    expect(storeChecksTheKeyFirst(undefined)).toHaveLength(1);

    const reads = (reader: string, preamble = "return withOrgContext(a, b, async (tx) => { if (!(await mayManage(tx, viewer))) return 1; return read(tx); });") =>
      `\nfunction readUnder<T>(viewer, read) {\n  ${preamble}\n}\n\nasync function mayManage(tx, viewer) {\n  const [held] = await holdsPermissions(tx, viewer, [K]);\n  return type === "presbytery";\n}\n${reader}\n`;
    expect(readersCheckAKey(sample("reads.ts", reads("\nexport function readThing(v) {\n  return db.select();\n}\n")))).toHaveLength(1);
    expect(readersCheckAKey(sample("reads.ts", reads("\nexport function readThing(v) {\n  return readUnder(v, f);\n}\n")))).toHaveLength(0);
    expect(readersCheckAKey(sample("reads.ts", reads("\nexport function readThing(v) {\n  return readUnder(v, f);\n}\n", "return withOrgContext(a, b, read);")))).toHaveLength(1);
    expect(readersCheckAKey(undefined)).toHaveLength(1);
  });

  it("commission-functions-reach-no-groups", () => {
    const store = (body: string) => `\nexport function addCommissionMember(ctx) {\n  ${body}\n}\n`;
    expect(commissionFunctionsReachNoGroups(sample("store.ts", store("await gate(tx, ctx); await tx.insert(commissionRecordMembers);")))).toHaveLength(0);
    for (const bad of [
      "await addManagedGroupSeatInTx(tx, org, input, opts);",
      "await tx.insert(groupMemberships).values(v);",
      "await tx.execute(sql`insert into group_memberships (id) values (1)`);",
      "const g = await tx.select().from(groups);",
      "const x = { groupId: committeeId };",
    ]) {
      expect(commissionFunctionsReachNoGroups(sample("store.ts", store(bad))), bad).toHaveLength(1);
    }
    // a committee function may; only the Commission-named ones are held to it
    expect(commissionFunctionsReachNoGroups(sample("store.ts", `\nexport function addCommitteeSeat(ctx) {\n  await addManagedGroupSeatInTx();\n}\n${store("await gate(tx, ctx);")}`))).toHaveLength(0);
    expect(commissionFunctionsReachNoGroups(sample("store.ts", "\nexport function addCommitteeSeat(ctx) {\n  return 1;\n}\n")).map((h) => h.rule)).toContain("commission-functions-found");
    expect(commissionFunctionsReachNoGroups(undefined)).toHaveLength(1);
  });

  it("charge-only-in-the-record-reader", () => {
    const reads = (list: string) =>
      `\nexport async function readCommission(v) {\n  return sql\`select r.charge from commission_records r\`;\n}\n\nexport async function readCommissionList(v) {\n  ${list}\n}\n`;
    expect(chargeOnlyInTheRecordReader(sample("reads.ts", reads("return sql`select r.title from commission_records r`;")))).toHaveLength(0);
    expect(chargeOnlyInTheRecordReader(sample("reads.ts", reads("return sql`select r.title, r.charge from commission_records r`;")))).toHaveLength(1);
    expect(chargeOnlyInTheRecordReader(sample("reads.ts", "\nexport async function readThing(v) {\n  return 1;\n}\n")).map((h) => h.rule)).toContain("commission-readers-found");
    expect(chargeOnlyInTheRecordReader(undefined)).toHaveLength(1);
  });

  it("the key-first needles cover the commission loaders and the members lock", () => {
    const fn = (first: string) => `\nexport function endCommissionMember(ctx) {\n  ${first}\n  await gate(tx, ctx);\n}\n`;
    for (const early of ["await loadCommission(tx, ctx, id);", "await loadMember(tx, ctx, id, m);", "await lockMembers(tx, ctx, id);"]) {
      expect(storeChecksTheKeyFirst(sample("store.ts", fn(early))), early).toHaveLength(1);
    }
  });

  it("commission-tables-no-grant-columns", () => {
    const mirror = (extra: string) =>
      `export const committeeDetails = pgTable("committee_details", { groupId: uuid("group_id") });\nexport const commissionRecords = pgTable("commission_records", { id: uuid("id") ${extra} });\n`;
    expect(commissionTablesHaveNoGrantColumns(sample("committees.ts", mirror("")))).toHaveLength(0);
    expect(commissionTablesHaveNoGrantColumns(sample("committees.ts", mirror(', roleId: uuid("role_id")')))).toHaveLength(1);
    expect(commissionTablesHaveNoGrantColumns(sample("committees.ts", mirror(', g: uuid("group_id")')))).toHaveLength(1);
    expect(commissionTablesHaveNoGrantColumns(sample("committees.ts", mirror(', p: boolean("public_listed")')))).toHaveLength(1);
    expect(commissionTablesHaveNoGrantColumns(undefined)).toHaveLength(1);
  });
});
