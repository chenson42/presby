/**
 * The shared live-mode predicate (P3-17 / G14) and its static tripwire:
 * docs/work-log/2026-10-15-online-giving.md. Pure: reads source as text.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_SUCCEEDED_GIFT, liveSucceededGift } from "./live-predicate";

const GIVING_DIR = __dirname;

/**
 * A non-test source file aggregates the gifts table when it names
 * `giving_gifts` AND calls `sum(` / `count(`. Such a file must apply the shared
 * fragment — by importing `LIVE_SUCCEEDED_GIFT` / `liveSucceededGift` or by
 * containing the literal `g.livemode`. Exported for the cases below.
 */
function violatesLivePredicate(source: string): boolean {
  const aggregates = /\b(sum|count)\s*\(/i.test(source) && /giving_gifts/.test(source);
  if (!aggregates) return false;
  const applies =
    /\bLIVE_SUCCEEDED_GIFT\b/.test(source) ||
    /\bliveSucceededGift\b/.test(source) ||
    /\bg\.livemode\b/.test(source);
  return !applies;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("LIVE_SUCCEEDED_GIFT", () => {
  it("is the exact fragment, through the alias `g`", () => {
    expect(LIVE_SUCCEEDED_GIFT).toBe("g.livemode and g.status = 'succeeded'");
  });

  it("is exported as a plain string literal in the source (the static tripwire and 46n both read it)", () => {
    const source = readFileSync(path.join(GIVING_DIR, "live-predicate.ts"), "utf8");
    expect(source).toContain(`export const LIVE_SUCCEEDED_GIFT = "g.livemode and g.status = 'succeeded'";`);
  });

  it("renders as a raw SQL chunk equal to the string", () => {
    // sql.raw yields a single StringChunk carrying the text.
    const chunks = (liveSucceededGift as unknown as { queryChunks: Array<{ value: string[] }> }).queryChunks;
    expect(chunks.map((c) => c.value.join("")).join("")).toBe(LIVE_SUCCEEDED_GIFT);
  });

  it("names the same `g.livemode` token the §46n database assertion reads", () => {
    const ddl = readFileSync(
      path.resolve(GIVING_DIR, "../../../scripts/giving/test-rls-46.sql"),
      "utf8",
    );
    const section = ddl.slice(ddl.indexOf("46n"));
    expect(section).toContain("g.livemode");
    expect(section).toContain("g.status = 'succeeded'");
  });
});

describe("the static tripwire (violatesLivePredicate)", () => {
  it("flags an aggregate over giving_gifts that omits the predicate", () => {
    expect(violatesLivePredicate("select sum(g.amount_cents) from giving_gifts g")).toBe(true);
    expect(violatesLivePredicate("select count(*) from giving_gifts")).toBe(true);
    expect(violatesLivePredicate("SELECT SUM (amount_cents) FROM giving_gifts g WHERE g.status = 'succeeded'")).toBe(true);
  });

  it("passes an aggregate that applies the fragment by import or by literal", () => {
    expect(
      violatesLivePredicate(
        'import { liveSucceededGift } from "./live-predicate"; sql`select sum(g.amount_cents) from giving_gifts g where ${liveSucceededGift}`',
      ),
    ).toBe(false);
    expect(
      violatesLivePredicate("select count(*) from giving_gifts g where g.livemode and g.status = 'succeeded'"),
    ).toBe(false);
  });

  it("ignores files that do not aggregate the gifts table", () => {
    expect(violatesLivePredicate("select g.id from giving_gifts g")).toBe(false);
    expect(violatesLivePredicate("select count(*) from people")).toBe(false);
  });
});

describe("every non-test file under src/lib/giving/", () => {
  it("that aggregates giving_gifts applies the shared live predicate", () => {
    const offenders = walk(GIVING_DIR)
      .filter((file) => violatesLivePredicate(readFileSync(file, "utf8")))
      .map((file) => path.relative(GIVING_DIR, file));
    expect(offenders).toEqual([]);
  });
});
