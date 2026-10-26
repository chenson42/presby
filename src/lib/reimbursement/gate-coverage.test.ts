/**
 * EC25 / P3-3: every reimbursement page, server action and route handler calls
 * one of the three gates (which run the Node-side 2FA check first), so the
 * stale-claim window cannot be reopened by a surface that forgets. A source scan
 * over both trees. A page that is only a redirect or a re-export may carry
 * `// gate-exempt: <reason>` on a line of its own.
 *
 * The member `actions.ts` (Batch 2a/3) and, from Batch 4, the treasurer tree's
 * `actions.ts`, `team/actions.ts` and `export/route.ts`; the scan is the standing
 * guard for the pages and routes later batches add.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ORG_TREE = path.resolve(__dirname, "../../app/(org)/o/[slug]");
const TREES = [path.join(ORG_TREE, "reimbursements"), path.join(ORG_TREE, "admin", "reimbursements")];
const SURFACE = /^(page\.tsx|actions\.ts|route\.ts)$/;
const GATE = /\bgateReimbursement(Page|Action|Route)\s*\(/;

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

describe("gate coverage of both reimbursement route trees (EC25)", () => {
  const files = TREES.flatMap(walk).filter((f) => SURFACE.test(path.basename(f)) && !f.endsWith(".test.ts"));

  it("finds the member actions file and the treasurer tree's three surfaces (the scan is not vacuous)", () => {
    const found = files.map((f) => path.relative(ORG_TREE, f));
    expect(found).toContain(path.join("reimbursements", "actions.ts"));
    expect(found).toContain(path.join("admin", "reimbursements", "actions.ts"));
    expect(found).toContain(path.join("admin", "reimbursements", "team", "actions.ts"));
    expect(found).toContain(path.join("admin", "reimbursements", "export", "route.ts"));
    expect(found).toContain(path.join("reimbursements", "[id]", "print", "route.ts"));
  });

  it("every treasurer-tree action and route names the key it needs - a bare gate call (member surface) is a defect there", () => {
    const treasury = files.filter((f) => f.includes(`${path.sep}admin${path.sep}reimbursements${path.sep}`));
    expect(treasury.length).toBeGreaterThanOrEqual(3);
    for (const file of treasury) {
      const source = readFileSync(file, "utf8");
      const calls = [...source.matchAll(/\bgateReimbursement(?:Page|Action|Route)\s*\(([^)]*)\)?/g)];
      expect(calls.length, path.relative(ORG_TREE, file)).toBeGreaterThan(0);
      // every call in the file carries a key set: `anyOf`, or a constant (PAY / VIEW / MANAGE) built from it
      expect(source, path.relative(ORG_TREE, file)).toMatch(/anyOf:\s*\[/);
      for (const call of calls) {
        expect(call[1], `${path.relative(ORG_TREE, file)}: ${call[0]}`).toMatch(/anyOf|PAY|VIEW|MANAGE/);
      }
    }
  });

  it("every page, actions file and route handler calls a reimbursement gate", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/\/\/\s*gate-exempt:/.test(source)) continue;
      expect(source, path.relative(ORG_TREE, file)).toMatch(GATE);
    }
  });

  it("no surface in either tree reads the session itself instead of going through a gate", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/\/\/\s*gate-exempt:/.test(source)) continue;
      expect(source, path.relative(ORG_TREE, file)).not.toMatch(/from "@\/auth"/);
    }
  });

  it("no loading.tsx exists on a segment whose job is to 404 or redirect (a Suspense boundary would flush a 200 first)", () => {
    const loading = TREES.flatMap(walk).filter((f) => path.basename(f) === "loading.tsx");
    expect(loading.filter((f) => /\[id\]/.test(f))).toEqual([]);
  });
});
