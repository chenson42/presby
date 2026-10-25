/**
 * Parish management's source-scan boundaries (docs/work-log/2026-10-25-parish-
 * management.md, Phase 3 tag BND; DECISIONS 242 to 245). Pure: reads source and
 * the migration as text, no database.
 *
 * `check:audit` is vacuous on the three `actions.ts` files because they only
 * delegate to `src/lib/parishes.ts`, so the "every mutation is audited" and
 * "one writer" properties are pinned here instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEAT_ONLY_PERMISSION_KEYS } from "./parishes-pure";

const root = path.resolve(__dirname, "../..");
const SRC = path.join(root, "src");
const PARISHES_ROUTE = path.join(SRC, "app/(org)/o/[slug]/directory/parishes");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Source with block and line comments removed, so a rule that bans a word does
 * not trip over prose explaining the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const nonTestSource = walk(SRC).filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"),
);

const PARISHES_TS = path.join(SRC, "lib/parishes.ts");
const parishesSource = stripComments(read(PARISHES_TS));

/** The body of each `export async function` in parishes.ts, by name. */
function exportedFunctionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const parts = source.split(/^export async function /m).slice(1);
  for (const part of parts) {
    const name = part.slice(0, part.indexOf("("));
    bodies.set(name, part);
  }
  return bodies;
}

describe("one writer of org_units and households.org_unit_id", () => {
  const WRITE_PATTERNS: Array<[string, RegExp]> = [
    ["drizzle insert into org_units", /\.insert\(\s*orgUnits\s*\)/],
    ["drizzle update of org_units", /\.update\(\s*orgUnits\s*\)/],
    ["drizzle delete of org_units", /\.delete\(\s*orgUnits\s*\)/],
    ["drizzle update of households", /\.update\(\s*households\s*\)/],
    ["sql insert into org_units", /insert\s+into\s+org_units/i],
    ["sql update of org_units", /update\s+org_units/i],
    ["sql delete from org_units", /delete\s+from\s+org_units/i],
    ["sql update of households", /update\s+households/i],
  ];

  it("no source file other than src/lib/parishes.ts writes org_units or updates households", () => {
    const offenders: string[] = [];
    for (const file of nonTestSource) {
      if (file === PARISHES_TS) continue;
      const source = stripComments(read(file));
      for (const [label, pattern] of WRITE_PATTERNS) {
        if (pattern.test(source)) offenders.push(`${path.relative(root, file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no other source file sets households.org_unit_id when it inserts a household", () => {
    const offenders: string[] = [];
    for (const file of nonTestSource) {
      if (file === PARISHES_TS) continue;
      const source = stripComments(read(file));
      for (const match of source.matchAll(/\.insert\(\s*households\s*\)\s*\.values\(([\s\S]{0,600}?)\)\s*\.returning|\.insert\(\s*households\s*\)\s*\.values\(([\s\S]{0,600}?)\)\s*;/g)) {
        if (/orgUnitId|org_unit_id/.test(match[0])) offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("parishes.ts itself never deletes: districts are archived, never removed (all deletes are soft)", () => {
    expect(parishesSource).not.toMatch(/\bdelete\s+from\b/i);
    expect(parishesSource).not.toMatch(/\.delete\(/);
  });
});

describe("every mutator writes its audit row in the same transaction (G14)", () => {
  const bodies = exportedFunctionBodies(parishesSource);
  const MUTATORS = [
    "defineDistrict",
    "renameDistrict",
    "archiveDistrict",
    "restoreDistrict",
    "moveHousehold",
    "bulkMoveHouseholds",
  ];

  it("parishes.ts exports exactly the mutators and readers the design names", () => {
    expect([...bodies.keys()].sort()).toEqual(
      [
        ...MUTATORS,
        "canReadParishRoster",
        "countHouseholdsByUnit",
        "getDistrictPage",
        "getParishAuthority",
        "getParishesOverview",
        "getUnassignedPage",
      ].sort(),
    );
  });

  it.each(MUTATORS)("%s references an AUDIT_ACTIONS key and writes it with insertAuditRow(s)", (name) => {
    const body = bodies.get(name)!;
    expect(body).toMatch(/AUDIT_ACTIONS\.[A-Z_]+/);
    expect(body).toMatch(/insertAuditRows?\(/);
  });

  it.each(MUTATORS)("%s checks the toggle and the viewer's authority before it writes anything", (name) => {
    const body = bodies.get(name)!;
    const gate = body.indexOf("openGate(");
    expect(gate).toBeGreaterThan(-1);
    for (const write of [/\btx\.execute\(sql`\s*(insert|update)\b/i, /insertAuditRows?\(/]) {
      const at = body.search(write);
      if (at !== -1) expect(gate).toBeLessThan(at);
    }
  });

  it("no mutator uses the swallow-on-failure recordAudit() (a failed audit insert must fail the change)", () => {
    expect(parishesSource).not.toMatch(/\brecordAudit\(/);
  });

  it("the actions.ts files carry no recordAudit() either", () => {
    for (const file of walk(PARISHES_ROUTE).filter((f) => f.endsWith("actions.ts"))) {
      expect(stripComments(read(file)), path.relative(root, file)).not.toMatch(/\brecordAudit\(/);
    }
  });
});

describe("lock order (DECISION-245): org_units first, then households", () => {
  const bodies = exportedFunctionBodies(parishesSource);

  it("moveHousehold locks the target district FOR SHARE before it updates the household", () => {
    const body = bodies.get("moveHousehold")!;
    const share = body.search(/from org_units[\s\S]*?for share/);
    const update = body.indexOf("update households");
    expect(share).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(share);
  });

  it("bulkMoveHouseholds locks both districts FOR SHARE by id, then the source's households FOR UPDATE by id, then updates", () => {
    const body = bodies.get("bulkMoveHouseholds")!;
    const share = body.search(/from org_units[\s\S]*?order by id[\s\S]*?for share/);
    const lockHouseholds = body.search(/from households[\s\S]*?order by id[\s\S]*?for update/);
    const update = body.indexOf("update households");
    expect(share).toBeGreaterThan(-1);
    expect(lockHouseholds).toBeGreaterThan(share);
    expect(update).toBeGreaterThan(lockHouseholds);
  });

  it("archive, rename and restore lock the district FOR UPDATE before anything else is read or written", () => {
    const lock = parishesSource.indexOf("async function lockUnitForUpdate");
    expect(lock).toBeGreaterThan(-1);
    expect(parishesSource.slice(lock, lock + 900)).toMatch(/for update/);
    for (const name of ["renameDistrict", "archiveDistrict", "restoreDistrict"]) {
      const body = bodies.get(name)!;
      const taken = body.indexOf("lockUnitForUpdate(");
      const write = body.search(/update org_units/);
      expect(taken, name).toBeGreaterThan(-1);
      expect(write, name).toBeGreaterThan(taken);
    }
  });
});

describe("privacy: names are masked server-side; nothing contact-shaped is selected (G6, DECISION-244)", () => {
  it("parishes.ts selects no contact, birthday, photo or address column anywhere", () => {
    const sqlText = [...parishesSource.matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1]).join("\n");
    expect(sqlText.length).toBeGreaterThan(500);
    for (const forbidden of [
      /\bemail\b/i,
      /\bphone\b/i,
      /birth/i,
      /\bphoto\b/i,
      /\baddress(es)?\b/i,
      /contact_methods/i,
      /\bline1\b/i,
      /postal/i,
    ]) {
      expect(sqlText, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("the directory_hidden test comes from directory.ts's exported expression, never a second literal", () => {
    expect(parishesSource).toContain("DIRECTORY_HIDDEN_SQL");
    expect(parishesSource).not.toMatch(/directory_hidden/);
    const literal = /coalesce\(\s*pp\.directory_hidden/g;
    // directory.ts exports it and filters rows by it; nothing in the parishes
    // library or its route tree spells the literal a second time.
    const directory = stripComments(read(path.join(SRC, "lib/directory.ts")));
    expect(directory).toMatch(/export const DIRECTORY_HIDDEN_SQL = sql`coalesce\(pp\.directory_hidden, false\)`/);
    expect(directory).toContain("${DIRECTORY_HIDDEN_SQL} = false");
    const parishFiles = [PARISHES_TS, ...walk(PARISHES_ROUTE).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))];
    for (const file of parishFiles) {
      expect(stripComments(read(file)), path.relative(root, file)).not.toMatch(literal);
    }
  });

  it("the connection vocabulary is deriveConnection(): parishes.ts spells no roll or engagement literal of its own", () => {
    expect(parishesSource).toContain("deriveConnection(");
    for (const literal of ["other_participant", "'baptized'", "'affiliate'", "'visitor'", "'staff'"]) {
      expect(parishesSource, literal).not.toContain(literal);
    }
  });

  it("parishes.ts never reaches the platform connection", () => {
    expect(parishesSource).not.toMatch(/getPlatformDb|PLATFORM_DATABASE_URL/);
  });
});

describe("the seat-only key list matches the database function (drizzle/0068)", () => {
  it("SEAT_ONLY_PERMISSION_KEYS equals the `when` arms of presby_seat_key_group()", () => {
    const migrations = readdirSync(path.join(root, "drizzle")).filter((f) => /^\d{4}_presby_.*\.sql$/.test(f)).sort();
    const parishes = migrations.find((f) => f.includes("parishes"));
    expect(parishes).toBeDefined();
    const sqlText = read(path.join(root, "drizzle", parishes!));
    const fn = sqlText.slice(sqlText.indexOf("create or replace function presby_seat_key_group"));
    const body = fn.slice(0, fn.indexOf("$$;", fn.indexOf("as $$") + 5));
    const arms = [...body.matchAll(/when '([a-z_.]+)' then '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(arms.sort()).toEqual([...SEAT_ONLY_PERMISSION_KEYS].sort());
  });
});
