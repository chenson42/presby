/**
 * A4 (Phase 2 addendum, docs/work-log/2026-10-19-custom-domains.md): writes to
 * `organization_domains` happen ONLY in src/lib/domains/service.ts.
 *
 * Why it matters: presby_app holds UPDATE on the state and observation columns
 * (T4), and the cross-org holding index makes a tenant-path write into a
 * holding state a fact about OTHER orgs (A3). The edge trigger bounds what a
 * write can do; this scan bounds where a write can come from, so the one
 * transition-and-audit choke point (transitionDomain(), R8) cannot be
 * bypassed by a second writer.
 *
 * Walks every .ts/.tsx file under src/ and fails on:
 *   1. `.insert(organizationDomains` / `.update(organizationDomains` (Drizzle
 *      builder writes) anywhere except service.ts and this file;
 *   2. a raw `insert into` / `update` / `delete from` / `alter table`
 *      `organization_domains` string in any NON-TEST file except service.ts.
 *      Test files may stage owner-path fixtures with raw SQL; application code
 *      may not, and `alter table organization_domains` (the backdating seam,
 *      e2e/support/domains-fixture.ts) never appears in application code.
 *
 * service.ts is exempt from rule 2 as well as rule 1: it is the sanctioned
 * writer, and the cron lease ("update ... where id in (select ... for update
 * skip locked)") is naturally raw SQL. Vacuously green until service.ts exists
 * (Batch 1a-ii); the matcher controls below keep the scan itself honest.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const SERVICE = ["lib", "domains", "service.ts"].join(sep);
const SELF = ["lib", "domains", "service-only-writes.test.ts"].join(sep);

const BUILDER_WRITE = /\.(?:insert|update)\(\s*organizationDomains\b/;
const RAW_WRITE = /\b(?:insert\s+into|update|delete\s+from|alter\s+table)\s+(?:public\.)?"?organization_domains"?\b/i;
const IS_TEST = /\.test\.tsx?$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((full) => ({ rel: relative(SRC, full), text: readFileSync(full, "utf8") }));

describe("A4: only src/lib/domains/service.ts writes organization_domains", () => {
  it("walks the real tree (not vacuous)", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.rel === ["lib", "db", "domain", "domains.ts"].join(sep))).toBe(true);
  });

  it("the matchers catch what they claim to (controls)", () => {
    for (const bad of [
      "await tx.update(organizationDomains).set({ state: 'live' })",
      "db.insert( organizationDomains ).values(row)",
    ]) {
      expect(BUILDER_WRITE.test(bad), bad).toBe(true);
    }
    for (const bad of [
      "sql`update organization_domains set state = 'live'`",
      "INSERT INTO organization_domains (id) values ($1)",
      "alter table organization_domains disable trigger organization_domains_guard_update",
      "delete from public.organization_domains where id = $1",
      'update "organization_domains" set observation = $1',
    ]) {
      expect(RAW_WRITE.test(bad), bad).toBe(true);
    }
    for (const fine of [
      "db.select().from(organizationDomains)",
      "select * from organization_domains where organization_id = $1",
      "select id from organization_domains for update skip locked",
      "references organization_domains(id, organization_id)",
    ]) {
      expect(BUILDER_WRITE.test(fine) || RAW_WRITE.test(fine), fine).toBe(false);
    }
  });

  it("no Drizzle insert/update of organizationDomains outside service.ts", () => {
    const offenders = FILES.filter((f) => f.rel !== SERVICE && f.rel !== SELF && BUILDER_WRITE.test(f.text)).map(
      (f) => f.rel,
    );
    expect(offenders, "route the write through src/lib/domains/service.ts (transitionDomain)").toEqual([]);
  });

  it("no raw insert/update/delete/alter of organization_domains in application code outside service.ts", () => {
    const offenders = FILES.filter((f) => !IS_TEST.test(f.rel) && f.rel !== SERVICE && RAW_WRITE.test(f.text)).map(
      (f) => f.rel,
    );
    expect(offenders, "raw writes belong in service.ts; fixtures in *.test.ts or e2e/support").toEqual([]);
  });
});
