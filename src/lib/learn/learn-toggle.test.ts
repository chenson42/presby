/**
 * T5b - the Learn toggle predicate's literals are the catalog's
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "Data Model" item 2 and
 * the Tests table; DECISION-331). `presby_learn_enabled(p_org, p_key)`
 * repeats, per Learn key, the catalog entry's `category` and `orgTypes` and
 * the category axis flag, because an anonymous request has no `personId` and
 * so cannot reach `orgFeatureEnabledInTx`. This pins every literal, read from
 * the LATEST definition across drizzle/*.sql in file order (so a later
 * migration's `create or replace`, Increment 1b's included, is what is
 * pinned, never 0087 alone). `public.db.test.ts` then proves the composition
 * against a real database over the whole matrix.
 *
 * The catalog half pins the SQL key set, each key's category and org_types literals, and the
 * category CHECK against `ORG_FEATURE_CATALOG` and `DOMAIN_ORDER` (Batch 2 landed both).
 *
 * Pure: the migrations are read as text.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));
const mockIsFlagEnabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
}));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));

import "@/lib/db/schema";
import { ORG_FEATURE_CATALOG, isCategoryAxisOn } from "@/lib/org-features";
import { DOMAIN_ORDER } from "@/lib/org-portal/tiles";

const DRIZZLE = path.resolve(__dirname, "../../../drizzle");
const MIGRATIONS = readdirSync(DRIZZLE)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((f) => ({ file: f, text: readFileSync(path.join(DRIZZLE, f), "utf8") }));

/** The latest `create [or replace] function <name>(` statement across every migration, through its closing `$function$;`. */
function latestDefinition(name: string): {
  file: string;
  body: string;
  rest: string;
} {
  const head = new RegExp(`create (?:or replace )?function ${name}\\(`, "g");
  let found: { file: string; body: string; rest: string } | null = null;
  for (const { file, text } of MIGRATIONS) {
    for (const m of text.matchAll(head)) {
      const start = m.index!;
      const open = text.indexOf("$function$", start);
      const close = text.indexOf("$function$;", open + "$function$".length);
      expect(open, `${file}: ${name} has a $function$ body`).toBeGreaterThan(-1);
      expect(close, `${file}: ${name}'s body closes`).toBeGreaterThan(open);
      found = {
        file,
        body: text.slice(start, close + "$function$;".length),
        rest: text.slice(close),
      };
    }
  }
  expect(found, `${name} is defined in some drizzle/*.sql`).not.toBeNull();
  return found!;
}

/** `when '<key>' then <literal>` pairs of the `case p_key ... end as <alias>` expression. */
function casePairs(body: string, alias: string): Map<string, string> {
  const block = body.match(new RegExp(`case p_key([\\s\\S]*?)end as ${alias}\\b`));
  expect(block, `a "case p_key ... end as ${alias}" expression`).not.toBeNull();
  expect(block![1], `the ${alias} CASE has no ELSE (an unknown key must be null, so false)`).not.toMatch(/\belse\b/);
  const pairs = new Map<string, string>();
  for (const m of block![1]!.matchAll(/when '([^']+)' then (.+?)\s*(?=\bwhen\b|$)/g)) {
    expect(pairs.has(m[1]!), `${m[1]} appears once in the ${alias} CASE`).toBe(false);
    pairs.set(m[1]!, m[2]!.trim());
  }
  return pairs;
}

/** A SQL org_types literal: `null::text[]` is null; `array['a', 'b']::text[]` is ['a','b'] sorted. */
function orgTypesLiteral(literal: string): string[] | null {
  if (/^null::text\[\]$/.test(literal)) return null;
  const arr = literal.match(/^array\[([^\]]*)\]::text\[\]$/);
  expect(arr, `org_types literal "${literal}" is null::text[] or array[...]::text[]`).not.toBeNull();
  return arr![1]!
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .sort();
}

const predicate = latestDefinition("presby_learn_enabled");
const definer = latestDefinition("presby_public_learn");
const categories = casePairs(predicate.body, "category");
const orgTypes = casePairs(predicate.body, "org_types");
const ALL_SQL = MIGRATIONS.map((m) => m.text).join("\n");

describe("presby_learn_enabled: the composition's own literals (binding in every batch)", () => {
  it("the two CASE lists name the same keys, and every Learn key's category literal is 'learn'", () => {
    expect([...categories.keys()].sort()).toEqual([...orgTypes.keys()].sort());
    expect(categories.size).toBeGreaterThan(0);
    for (const [key, literal] of categories) expect(literal, key).toBe("'learn'");
    // Every org_types literal parses.
    for (const literal of orgTypes.values()) orgTypesLiteral(literal);
  });

  it("composes type, then axis and category, then toggle - joined to the key's category, keyed by p_key", () => {
    const body = predicate.body;
    expect(body).toMatch(/k\.org_types is null or o\.organization_type::text = any \(k\.org_types\)/);
    expect(body).toMatch(/c\.organization_id = p_org and c\.category = k\.category/);
    expect(body).toMatch(/t\.organization_id = p_org and t\.feature_key = p_key/);
    // An unknown key has a null category and is filtered out, so the outer coalesce answers false.
    expect(body).toMatch(/where o\.id = p_org\s+and k\.category is not null/);
    expect(body).toMatch(/^\s*select coalesce\(\(/m);
    expect(body).toMatch(/\), false\);\s*\$function\$;$/);
  });

  it("a MISSING toggle row is false (provisioned OFF) and a MISSING category row is true (DECISION-130)", () => {
    expect(predicate.body).toMatch(
      /coalesce\(\(select t\.enabled from organization_feature_toggles t[\s\S]*?\), false\)/,
    );
    expect(predicate.body).toMatch(
      /coalesce\(\(select c\.enabled from organization_feature_categories c[\s\S]*?\), true\)/,
    );
  });

  it("reads the same category-axis flag the application reads, and a missing flag row is axis OFF", async () => {
    mockIsFlagEnabled.mockResolvedValue(true);
    await isCategoryAxisOn();
    const flagKey = String(mockIsFlagEnabled.mock.calls.at(-1)![0]);
    expect(flagKey).toBe("org_portal.feature_categories");
    expect(predicate.body).toMatch(
      new RegExp(
        `not coalesce\\(\\(select f\\.enabled from feature_flags f\\s+where f\\.key = '${flagKey.replace(/\./g, "\\.")}'\\), false\\)`,
      ),
    );
  });

  it("is SECURITY INVOKER, stable, search_path pinned; the definer is SECURITY DEFINER, stable, search_path pinned", () => {
    const head = (body: string) => body.slice(0, body.indexOf("$function$"));
    expect(head(predicate.body)).not.toMatch(/security definer/);
    expect(head(predicate.body)).toMatch(/\bstable\b/);
    expect(head(predicate.body)).toMatch(/set search_path = public, pg_temp/);
    expect(head(definer.body)).toMatch(/security definer/);
    expect(head(definer.body)).toMatch(/\bstable\b/);
    expect(head(definer.body)).toMatch(/set search_path = public, pg_temp/);
    expect(head(definer.body)).toMatch(/returns table \(state text\)/);
  });

  it("the definer gates as careers does (active, live, then the predicate) and answers only available or unavailable", () => {
    const body = definer.body;
    const active = body.indexOf("v_org.status is distinct from 'active'");
    const live = body.indexOf("s.status = 'live'");
    const pred = body.indexOf("presby_learn_enabled(v_org.id, p_key)");
    expect(active).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(active);
    expect(pred).toBeGreaterThan(live);
    const states = [...body.matchAll(/select '([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(states).toEqual(["available", "unavailable"]);
  });
});

describe("grants and comments (binding in every batch)", () => {
  it("presby_learn_enabled: revoked from public, presby_app and presby_platform, and granted to NO ONE in any migration", () => {
    expect(predicate.rest).toMatch(
      /revoke all on function presby_learn_enabled\(uuid, text\) from public, presby_app, presby_platform;/,
    );
    expect(ALL_SQL).not.toMatch(/grant [^;]*on function presby_learn_enabled/i);
  });

  it("presby_public_learn: revoked from public, presby_app and presby_platform, then granted to presby_app ONLY", () => {
    expect(definer.rest).toMatch(
      /revoke all on function presby_public_learn\(text, text\) from public, presby_app, presby_platform;\s*grant execute on function presby_public_learn\(text, text\) to presby_app;/,
    );
    const grants = [...ALL_SQL.matchAll(/grant [^;]*on function presby_public_learn[^;]*;/gi)].map((m) => m[0]);
    expect(grants).toEqual(["grant execute on function presby_public_learn(text, text) to presby_app;"]);
  });

  it("both carry a function comment stating the collapse (one answer for every cause)", () => {
    for (const sig of ["presby_learn_enabled\\(uuid, text\\)", "presby_public_learn\\(text, text\\)"]) {
      const comment = ALL_SQL.match(new RegExp(`comment on function ${sig} is\\s+'((?:[^']|'')*)';`));
      expect(comment, sig).not.toBeNull();
      expect(comment![1], sig).toMatch(/one answer for (every cause|all of them)/);
    }
  });
});

describe("the CASE literals are the catalog's", () => {
  const learnEntries = ORG_FEATURE_CATALOG.filter((e) => (e.category as string) === "learn");

  it("the CASE keys are exactly the ORG_FEATURE_CATALOG entries whose category is `learn`", () => {
    expect([...categories.keys()].sort()).toEqual(learnEntries.map((e) => e.key).sort());
  });

  it("each key's category and org_types literals equal its entry's `category` and `orgTypes`; toggle-only, provisioned OFF", () => {
    for (const entry of learnEntries) {
      expect(categories.get(entry.key), entry.key).toBe(`'${entry.category}'`);
      const sqlTypes = orgTypesLiteral(orgTypes.get(entry.key)!);
      expect(sqlTypes, entry.key).toEqual(entry.orgTypes === null ? null : [...entry.orgTypes].sort());
      expect(entry.flag, `${entry.key}: no platform flag for SQL to compose`).toBeNull();
      expect(entry.provisionedOn, `${entry.key}: a missing toggle row is off`).toBe(false);
    }
  });

  it("the category CHECK admits exactly the selectable categories (DOMAIN_ORDER minus administration)", () => {
    const check = latestCategoryCheck();
    expect(check.sort()).toEqual(DOMAIN_ORDER.filter((d) => d !== "administration").sort());
  });
});

/** The value list of the latest `organization_feature_categories_category_check` across every migration. */
function latestCategoryCheck(): string[] {
  let list: string[] | null = null;
  for (const { text } of MIGRATIONS) {
    for (const m of text.matchAll(
      /(?:constraint organization_feature_categories_category_check\s+check|category\s+text\s+not null\s+check)\s*\(category in \(([^)]*)\)\)/g,
    )) {
      list = m[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    }
  }
  expect(list, "the category CHECK is in some drizzle/*.sql").not.toBeNull();
  return list!;
}

describe("the Drizzle mirror of the category CHECK (binding in every batch)", () => {
  it("lists exactly the values the latest migration's CHECK admits, `learn` included and `administration` not", () => {
    const mirror = readFileSync(path.resolve(__dirname, "../db/domain/org-feature-categories.ts"), "utf8");
    const m = mirror.match(/organization_feature_categories_category_check",\s*sql`\$\{t\.category\} in \(([^)]*)\)`/);
    expect(m, "the Drizzle check() names the live constraint").not.toBeNull();
    const drizzleList = m![1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    const sqlList = latestCategoryCheck();
    expect(drizzleList.sort()).toEqual([...sqlList].sort());
    expect(sqlList).toContain("learn");
    expect(sqlList).not.toContain("administration");
  });
});
