/**
 * The receipt blob boundary (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Receipts and the F289 audience API": "Nothing else in this increment touches
 * the blob store, and nothing imports `blob_assets`").
 *
 * `audience-callsites.test.ts` pins WHAT `receipts.ts` passes (the literal
 * `private`); this pins WHO may call at all, over the whole feature: the library,
 * the member tree and the treasurer tree. Also that the two receipt routes reach
 * bytes only through `receipts.ts`, and that the one place a receipt's `audience`
 * literal appears is the one file that stores or resolves it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const ZONES = [
  path.join(SRC, "lib", "reimbursement"),
  path.join(SRC, "app", "(org)", "o", "[slug]", "reimbursements"),
  path.join(SRC, "app", "(org)", "o", "[slug]", "admin", "reimbursements"),
];

function walk(dir: string): string[] {
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FILES = ZONES.flatMap(walk)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f))
  .map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), code: stripComments(readFileSync(f, "utf8")) }));

describe("only receipts.ts touches the blob store", () => {
  it("scans real files (not vacuous)", () => {
    expect(FILES.length).toBeGreaterThan(60);
    expect(FILES.some((f) => f.rel === "lib/reimbursement/receipts.ts")).toBe(true);
  });

  it("getBlobStore is named by lib/reimbursement/receipts.ts and nowhere else in the feature", () => {
    expect(FILES.filter((f) => /\bgetBlobStore\b/.test(f.code)).map((f) => f.rel)).toEqual(["lib/reimbursement/receipts.ts"]);
  });

  it("nothing in the feature names the blob table or imports the storage adapter's table", () => {
    const offenders = FILES.filter(
      (f) => f.rel !== "lib/reimbursement/migration-text.ts" && /\bblob_assets\b|\bblobAssets\b|domain\/assets/.test(f.code),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the two receipt routes reach the bytes through the receipts library, never the store", () => {
    const routes = FILES.filter((f) => /\/receipts\/(\[attachmentId\]\/)?route\.ts$/.test(f.rel));
    expect(routes.map((r) => r.rel).sort()).toEqual([
      "app/(org)/o/[slug]/reimbursements/[id]/receipts/[attachmentId]/route.ts",
      "app/(org)/o/[slug]/reimbursements/[id]/receipts/route.ts",
    ]);
    for (const route of routes) expect(route.code, route.rel).toMatch(/from "@\/lib\/reimbursement\/receipts"/);
  });

  it("receipts.ts hands the store the literal `private` and nothing else (the two calls: store, then resolve)", () => {
    const code = FILES.find((f) => f.rel === "lib/reimbursement/receipts.ts")!.code;
    expect([...code.matchAll(/\baudience\s*:\s*([^,}\s]+)/g)].map((m) => m[1])).toEqual(['"private"', '"private"']);
    expect(code).not.toMatch(/public_site/);
  });

  it("the upload route is the one place that imports the sanitizer, and it never imports sharp itself", () => {
    expect(FILES.filter((f) => /image-sanitize/.test(f.code)).map((f) => f.rel)).toEqual([
      "app/(org)/o/[slug]/reimbursements/[id]/receipts/route.ts",
    ]);
    expect(FILES.filter((f) => /["']sharp["']/.test(f.code))).toEqual([]);
  });
});
