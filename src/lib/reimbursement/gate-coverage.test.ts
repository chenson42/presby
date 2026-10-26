/**
 * EC25 / P3-3: every reimbursement page, server action and route handler calls
 * one of the three gates (which run the Node-side 2FA check first), so the
 * stale-claim window cannot be reopened by a surface that forgets. A source scan
 * over both trees. A page that is only a redirect or a re-export may carry
 * `// gate-exempt: <reason>` on a line of its own.
 *
 * Today only the member `actions.ts` exists; the scan is the standing guard for
 * the pages and routes later batches add.
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

  it("finds at least the member actions file (the scan is not vacuous)", () => {
    expect(files.map((f) => path.relative(ORG_TREE, f))).toContain(path.join("reimbursements", "actions.ts"));
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
