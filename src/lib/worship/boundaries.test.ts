/**
 * Source-scan tripwires for the worship module's "appears nowhere else"
 * properties - docs/work-log/2026-11-04-worship-inc1.md, Phase 3 Tests
 * (`boundaries.test.ts`), DECISION-317/318/322/326 and architect addendum C1,
 * C2, S2. DB-free: these read source text, so a violation fails without a
 * database. No new `check:*` script (R-tripwires: this test, the DECISION-316
 * scan, the audience registry test, `check:audit`, `check:hydration-gate`,
 * `check:help` are the net). Every scan carries a sample that fails it, so the
 * scan is proved able to fail.
 *
 *   W1  the writers: exactly `store.ts` and `event-hooks.ts` write a `worship_*`
 *       table (C1). Not `sweep.ts`, not a page, not an action.
 *   W2  `event-hooks.ts` is imported by `events/hooks.ts` and nothing else, and
 *       it (with everything it imports) reaches no event writer or `store.ts`.
 *   W3  worship never writes `group_memberships` or `events` itself; rosters go
 *       through the `groups.ts` primitives and events through `events/{insert,
 *       mutate}.ts`.
 *   W4  `sweep.ts` is the only `getPlatformDb()` user under worship (the module
 *       and both route trees).
 *   W5  no import of sign-ups, treasury, reimbursement, careers or onboarding
 *       internals, nor of `@/lib/events` (the file).
 *   W6  `events` is named in a read only by the files the DECISION-316 test lists.
 *   W7  `insert into worship_services` appears only in `createService` and
 *       `generateServices`, each AFTER an `insertEventsInTx` call in the same
 *       function (the S2 residual's scan).
 *   W8  every presumed-minor decision goes through `presby_photo_subject_is_minor`;
 *       no second definition (date of birth, a child household role, an age).
 *   W9  no `callbackUrl`, `next=` or `redirect(` in the module or its actions.
 *   W10 `directory_hidden` is never named.
 *   W11 every store export runs its gate inside its own transaction.
 *   W12 no grant or roster date is compared against the SERVICE day
 *       (`presby_worship_org_today`): the in-effect day is the only clock for a
 *       `role_grants` / `group_memberships` date or a resolver call (F434).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MODULE = "src/lib/worship";
const ACTION_TREES = ["src/app/(org)/o/[slug]/worship", "src/app/(org)/o/[slug]/admin/worship"];
const STORE = `${MODULE}/store.ts`;
const HOOKS_FILE = `${MODULE}/event-hooks.ts`;

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:\\"'`])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) => stripComments(read(rel));

const moduleFiles = walk(MODULE);
/** Every non-test file under both route trees (pages, components, actions). */
const routeFiles = ACTION_TREES.flatMap(walk);
/** Only the server actions: the one place a client call reaches the store (a page may `redirect()` a signed-out visitor; an action never does). */
const actionFiles = routeFiles.filter((f) => /\/actions\.ts$/.test(f));
const allSource = walk("src").filter((f) => !f.startsWith("src/lib/testing/"));

// ---------------------------------------------------------------------------
// W1 - the writers
// ---------------------------------------------------------------------------

const WORSHIP_TABLE_IDENTIFIERS = [
  "worshipTeams",
  "worshipPositions",
  "worshipPositionQualifications",
  "worshipServiceTypes",
  "worshipServiceTypeTeams",
  "worshipServices",
  "worshipServiceTeams",
  "worshipAssignments",
  "worshipBlockouts",
];

/** A source text writes a worship table: raw SQL `insert into|update|delete from worship_x`, or Drizzle `.insert|update|delete(worshipX)`. */
function writesWorshipTable(source: string): boolean {
  const body = stripComments(source);
  if (/\b(insert\s+into|delete\s+from|update)\s+worship_[a-z_]+/i.test(body)) return true;
  const ids = WORSHIP_TABLE_IDENTIFIERS.join("|");
  return new RegExp(`\\.(insert|update|delete)\\(\\s*(${ids})\\b`).test(body);
}

describe("W1: exactly store.ts and event-hooks.ts write a worship table", () => {
  it("across all of src (tests and test support excluded)", () => {
    const writers = allSource.filter((f) => writesWorshipTable(read(f))).sort();
    expect(writers).toEqual([HOOKS_FILE, STORE].sort());
  });

  it("the scan can fail: raw SQL, Drizzle and a write in a page are all seen", () => {
    expect(writesWorshipTable("await tx.execute(sql`insert into worship_teams (group_id) values (1)`)")).toBe(true);
    expect(writesWorshipTable("await tx.execute(sql`update worship_assignments set status = 'x'`)")).toBe(true);
    expect(writesWorshipTable("await tx.delete(worshipBlockouts)")).toBe(true);
    expect(writesWorshipTable("await tx.update(worshipAssignments).set({})")).toBe(true);
    expect(writesWorshipTable("await tx.select().from(worshipAssignments)")).toBe(false);
    expect(writesWorshipTable("// update worship_teams is not a write\nconst x = 1;")).toBe(false);
  });

  it("no action file touches a table at all (an action calls the store)", () => {
    for (const file of actionFiles) {
      expect(/\bworship_[a-z_]+\b/.test(code(file)), file).toBe(false);
      expect(new RegExp(`\\b(${WORSHIP_TABLE_IDENTIFIERS.join("|")})\\b`).test(code(file)), file).toBe(false);
    }
  });

  it("sweep.ts writes no table directly: the stamps are the definer's", () => {
    expect(writesWorshipTable(read(`${MODULE}/sweep.ts`))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// W2 - the hook file and the import cycle
// ---------------------------------------------------------------------------

const FORBIDDEN_FOR_HOOKS = new Set([
  "src/lib/events.ts",
  "src/lib/events/mutate.ts",
  "src/lib/events/hooks.ts",
  "src/lib/events/insert.ts",
  STORE,
]);

function runtimeImports(source: string): string[] {
  const body = stripComments(source);
  const out: string[] = [];
  for (const m of body.matchAll(/\b(import|export)\s+(type\s+)?([^;"'`]*?)\s*from\s*["']([^"']+)["']/g)) {
    const [, , typeKeyword, clause, spec] = m;
    if (typeKeyword) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause!.trim());
    if (named) {
      const specs = named[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      if (specs.length > 0 && specs.every((s) => /^type\s/.test(s))) continue;
    }
    out.push(spec!);
  }
  for (const m of body.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of body.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

function resolve(fromRel: string, spec: string, exists: (rel: string) => boolean): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(candidate) && exists(candidate)) return candidate;
  }
  return null;
}

type Graph = { read: (rel: string) => string; exists: (rel: string) => boolean };
const realGraph: Graph = { read, exists: (rel) => existsSync(path.join(ROOT, rel)) };

function reachesForbidden(start: string, graph: Graph): string[] {
  const hits: string[] = [];
  const seen = new Set([start]);
  const queue: Array<{ file: string; trail: string[] }> = [{ file: start, trail: [start] }];
  while (queue.length) {
    const { file, trail } = queue.shift()!;
    for (const spec of runtimeImports(graph.read(file))) {
      const target = resolve(file, spec, graph.exists);
      if (!target) continue;
      if (FORBIDDEN_FOR_HOOKS.has(target)) {
        hits.push([...trail, target].join(" -> "));
        continue;
      }
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push({ file: target, trail: [...trail, target] });
    }
  }
  return hits;
}

describe("W2: event-hooks.ts breaks the import cycle", () => {
  it("only events/hooks.ts imports it (types excepted)", () => {
    const importers = allSource
      .filter((f) => f !== HOOKS_FILE)
      .filter((f) => runtimeImports(read(f)).some((spec) => resolve(f, spec, realGraph.exists) === HOOKS_FILE))
      .sort();
    expect(importers).toEqual(["src/lib/events/hooks.ts"]);
  });

  it("it, and every file it imports, reaches no event writer and not store.ts", () => {
    expect(reachesForbidden(HOOKS_FILE, realGraph)).toEqual([]);
  });

  it("the scan can fail: a direct and a transitive path are both caught", () => {
    const files: Record<string, string> = {
      [HOOKS_FILE]: `import { cancelEvent } from "@/lib/events"; import { x } from "./notify";`,
      [`${MODULE}/notify.ts`]: `export * from "@/lib/worship/store";`,
      "src/lib/events.ts": "",
      [STORE]: "",
    };
    const graph: Graph = { read: (rel) => files[rel] ?? "", exists: (rel) => rel in files };
    expect(reachesForbidden(HOOKS_FILE, graph)).toEqual([
      `${HOOKS_FILE} -> src/lib/events.ts`,
      `${HOOKS_FILE} -> ${MODULE}/notify.ts -> ${STORE}`,
    ]);
  });

  it("the hook file's only imports from events are TYPES, from events/hooks.ts", () => {
    const body = code(HOOKS_FILE);
    expect(body).toMatch(/import type \{[^}]*\} from "@\/lib\/events\/hooks"/);
    expect(runtimeImports(read(HOOKS_FILE)).filter((s) => s.startsWith("@/lib/events"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// W3 - no raw write to group_memberships or events
// ---------------------------------------------------------------------------

function writesTable(source: string, table: string, identifier: string): boolean {
  const body = stripComments(source);
  if (new RegExp(`\\b(insert\\s+into|delete\\s+from|update)\\s+${table}\\b`, "i").test(body)) return true;
  return new RegExp(`\\.(insert|update|delete)\\(\\s*${identifier}\\b`).test(body);
}

describe("W3: rosters and events are written only through the shared primitives", () => {
  it("nothing under worship writes group_memberships or events", () => {
    for (const file of [...moduleFiles, ...routeFiles]) {
      expect(writesTable(read(file), "group_memberships", "groupMemberships"), `${file} writes group_memberships`).toBe(false);
      expect(writesTable(read(file), "events", "events"), `${file} writes events`).toBe(false);
    }
  });

  it("the scan can fail", () => {
    expect(writesTable("tx.execute(sql`insert into group_memberships (a) values (1)`)", "group_memberships", "groupMemberships")).toBe(true);
    expect(writesTable("tx.update(events).set({ cancelledAt: now })", "events", "events")).toBe(true);
    expect(writesTable("tx.select().from(events)", "events", "events")).toBe(false);
  });

  it("the roster and event writes it does make are the primitives", () => {
    const body = code(STORE);
    for (const name of ["addManagedGroupMemberInTx", "endManagedGroupMemberInTx", "insertManagedGroupInTx", "updateManagedGroupInTx"]) {
      expect(body, name).toContain(name);
    }
    for (const name of ["insertEventsInTx", "updateEventFieldsInTx", "cancelEventInTx"]) expect(body, name).toContain(name);
  });
});

// ---------------------------------------------------------------------------
// W4 - the one owner connection
// ---------------------------------------------------------------------------

describe("W4: sweep.ts is the only getPlatformDb() user", () => {
  it("under the module and both route trees", () => {
    const users = [...moduleFiles, ...routeFiles].filter((f) => /\bgetPlatformDb\b|PLATFORM_DATABASE_URL|MIGRATE_DATABASE_URL/.test(code(f))).sort();
    expect(users).toEqual([`${MODULE}/sweep.ts`]);
  });
});

// ---------------------------------------------------------------------------
// W5 - no imports of other modules' internals
// ---------------------------------------------------------------------------

const BANNED_IMPORT_PREFIXES = [
  "@/lib/event-signups",
  "@/lib/reimbursement",
  "@/lib/treasury",
  "@/lib/careers",
  "@/lib/onboarding",
];

function bannedImports(source: string): string[] {
  const body = stripComments(source);
  const specs = [...body.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]!);
  return specs.filter((s) => s === "@/lib/events" || s === "@/lib/events.ts" || BANNED_IMPORT_PREFIXES.some((p) => s === p || s.startsWith(`${p}/`)));
}

describe("W5: worship imports no other module's internals", () => {
  it("no sign-ups, treasury, reimbursement, careers or onboarding import, and not the events file", () => {
    for (const file of [...moduleFiles, ...routeFiles]) expect(bannedImports(read(file)), file).toEqual([]);
  });

  it("the scan can fail", () => {
    expect(bannedImports(`import { cancelEvent } from "@/lib/events";`)).toEqual(["@/lib/events"]);
    expect(bannedImports(`import { holdsPermissions } from "@/lib/treasury/keys";`)).toEqual(["@/lib/treasury/keys"]);
    expect(bannedImports(`import { x } from "@/lib/events/insert";`)).toEqual([]);
  });

  it("only store.ts imports the event writers (insert and mutate); nothing else under worship does", () => {
    const importers = moduleFiles
      .filter((f) => /@\/lib\/events\/(mutate|insert)/.test(code(f)))
      .sort();
    expect(importers).toEqual([STORE]);
  });
});

// ---------------------------------------------------------------------------
// W6 - who names `events` in a read
// ---------------------------------------------------------------------------

describe("W6: events is read only by the files DECISION-316 lists", () => {
  it("exactly drafts, event-hooks, reads, store and sweep", () => {
    const readers = moduleFiles.filter((f) => /\b(from|join)\s+events\b|\.from\(\s*events\b/.test(code(f))).sort();
    expect(readers).toEqual(
      [`${MODULE}/drafts.ts`, HOOKS_FILE, `${MODULE}/reads.ts`, STORE, `${MODULE}/sweep.ts`].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// W7 - the S2 residual: a service is only ever a newly created event
// ---------------------------------------------------------------------------

/** The names of the exported functions whose body contains `needle`, with whether `before` precedes it in that body. */
function functionsContaining(source: string, needle: RegExp, before: RegExp): Array<{ name: string; ordered: boolean }> {
  const body = stripComments(source);
  const starts = [...body.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => ({ name: m[1]!, index: m.index! }));
  const out: Array<{ name: string; ordered: boolean }> = [];
  starts.forEach((start, i) => {
    const text = body.slice(start.index, starts[i + 1]?.index ?? body.length);
    const at = text.search(needle);
    if (at === -1) return;
    const prior = text.search(before);
    out.push({ name: start.name, ordered: prior !== -1 && prior < at });
  });
  return out;
}

describe("W7: worship_services rows are created only beside a newly created event (S2, paper residual)", () => {
  const INSERT_SERVICE = /insert\s+into\s+worship_services\b/i;
  const AFTER = /\binsertEventsInTx\(/;

  it("only createService and generateServices insert one, each after insertEventsInTx in the same function", () => {
    const found = functionsContaining(read(STORE), INSERT_SERVICE, AFTER);
    expect(found).toEqual([
      { name: "createService", ordered: true },
      { name: "generateServices", ordered: true },
    ]);
  });

  it("the scan can fail: an insert with no event insert before it, and in a third function, are seen", () => {
    const sample = [
      "export function createService() { insertEventsInTx(); tx.execute(sql`insert into worship_services (x)`); }",
      "export function adoptEvent() { tx.execute(sql`insert into worship_services (x)`); }",
    ].join("\n");
    expect(functionsContaining(sample, INSERT_SERVICE, AFTER)).toEqual([
      { name: "createService", ordered: true },
      { name: "adoptEvent", ordered: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// W8 - one presumed-minor predicate
// ---------------------------------------------------------------------------

describe("W8: a presumed minor is decided by presby_photo_subject_is_minor, never a second definition", () => {
  it("no date of birth, child household role or age arithmetic anywhere in the module", () => {
    for (const file of moduleFiles) {
      expect(code(file), file).not.toMatch(/date_of_birth|birth_year_only|household_role|interval\s+'18 years'|dateOfBirth|householdRole/i);
    }
  });

  it("the Send, the cancel notice, the picker and the board go through the predicate", () => {
    expect(code(`${MODULE}/notify.ts`)).toContain("presby_photo_subject_is_minor");
    expect(code(`${MODULE}/reads.ts`)).toContain("presby_photo_subject_is_minor");
  });
});

// ---------------------------------------------------------------------------
// W9, W10 - no redirect targets, no hidden-directory literal
// ---------------------------------------------------------------------------

describe("W9: no callbackUrl, next= or redirect( in the module or its actions", () => {
  it("none of the three (pages are exempt: a page redirects a signed-out visitor through the (org) sequence)", () => {
    for (const file of [...moduleFiles, ...actionFiles]) {
      expect(code(file), file).not.toMatch(/callbackUrl|[?&]next=|\bredirect\s*\(/);
    }
  });
});

describe("W10: the hidden-directory column is never named", () => {
  it("no directory_hidden literal", () => {
    for (const file of [...moduleFiles, ...routeFiles]) expect(code(file), file).not.toMatch(/directory_hidden/);
  });
});

// ---------------------------------------------------------------------------
// W11 - every store export gates inside its own transaction
// ---------------------------------------------------------------------------

describe("W11: every store export runs through the gate", () => {
  it("each exported function returns guarded(...) (applicability, toggle, key, one transaction)", () => {
    const body = code(STORE);
    const exported = [...body.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThanOrEqual(24);
    const starts = [...body.matchAll(/^export (?:async )?function (\w+)/gm)];
    starts.forEach((m, i) => {
      const text = body.slice(m.index!, starts[i + 1]?.index ?? body.length);
      expect(text, m[1]).toMatch(/return guarded(?:<[^>]*>)?\(\s*viewer\b/);
    });
  });
});

// ---------------------------------------------------------------------------
// W12 - the in-effect day (F434, DECISION-328)
// ---------------------------------------------------------------------------

/** SQL comments (`-- ...`) and block comments, so prose that names the function is not a use of it. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

/** The text between the parentheses opened at `open` (balanced), or null when unbalanced. */
function argumentList(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

const CLOCK_CALLERS = ["presby_has_permission", "presby_effective_permissions", "presby_worship_leads_team"];

/**
 * Every place a grant or roster date is read against the service day: a
 * resolver or seat call whose arguments name `presby_worship_org_today`, or a
 * `starts_on` / `ends_on` comparison written against it. The one exemption is a
 * trigger's own `new.` row (the blockout guard compares worship's own dates).
 */
function serviceDayViolations(source: string): string[] {
  const body = stripSqlComments(stripComments(source));
  const found: string[] = [];
  for (const caller of CLOCK_CALLERS) {
    for (const m of body.matchAll(new RegExp(`\\b${caller}\\s*\\(`, "g"))) {
      const args = argumentList(body, m.index! + m[0].length - 1);
      if (args !== null && /presby_worship_org_today/.test(args)) found.push(`${caller}( ... presby_worship_org_today ... )`);
    }
  }
  for (const m of body.matchAll(/([^\s()]+)\s*(?:<=|>=|<|>)\s*presby_worship_org_today/g)) {
    const left = m[1]!;
    if (/(?:^|\.)(?:starts_on|ends_on)$/.test(left) && !left.startsWith("new.")) found.push(`${left} compared with presby_worship_org_today`);
  }
  for (const m of body.matchAll(/presby_worship_org_today\s*\([^)]*\)\s*(?:<=|>=|<|>)\s*([^\s()]+)/g)) {
    if (/(?:^|\.)(?:starts_on|ends_on)$/.test(m[1]!) && !m[1]!.startsWith("new.")) found.push(`presby_worship_org_today compared with ${m[1]}`);
  }
  return found;
}

describe("W12: a grant or roster date is never compared with the service day", () => {
  const sources = [...moduleFiles, "drizzle/0085_presby_worship.sql"];

  it("not in 0085 and not in any worship source file", () => {
    for (const file of sources) expect(serviceDayViolations(read(file)), file).toEqual([]);
  });

  it("the scan can fail: each offending form is seen, the blockout guard and prose are not", () => {
    expect(serviceDayViolations("rg.starts_on <= presby_worship_org_today(${organizationId}::uuid)")).toHaveLength(1);
    expect(serviceDayViolations("(gm.ends_on is null or gm.ends_on > presby_worship_org_today(wt.organization_id))")).toHaveLength(1);
    expect(serviceDayViolations("and ${a}.starts_on <= presby_worship_org_today(${org}::uuid)")).toHaveLength(1);
    expect(serviceDayViolations("presby_worship_org_today(x) >= gm.starts_on")).toHaveLength(1);
    expect(serviceDayViolations("presby_has_permission(p, o, 'worship.schedule', presby_worship_org_today(o))")).toHaveLength(1);
    expect(serviceDayViolations("presby_worship_leads_team(o, p, g,\n presby_worship_org_today(o))")).toHaveLength(1);
    expect(serviceDayViolations("if new.ends_on < presby_worship_org_today(new.organization_id) then")).toEqual([]);
    expect(serviceDayViolations("rg.starts_on <= presby_worship_in_effect_day(o)")).toEqual([]);
    expect(serviceDayViolations("-- gm.starts_on <= presby_worship_org_today(o)\n/* rg.ends_on > presby_worship_org_today(o) */")).toEqual([]);
  });
});
