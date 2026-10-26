/**
 * The two-factor grant is an allow-list, not a convention (DECISION-292).
 *
 * `withTwoFactorGrant` is the only way the session's `twoFactorVerified` claim
 * becomes true (DECISION-230). Each new call site widens "who can mark a session
 * verified", so the list of importers, call sites and exports is closed and
 * checked for SET EQUALITY, not subset: adding a caller fails this file until the
 * list below is edited, and that edit is the review trigger. The grant-free
 * `unstable_update({})` refreshes elsewhere (the invitation accept, the admin
 * user actions) stay legitimate: the jwt callback reads nothing from the payload.
 *
 * Comments are stripped before every scan, so a comment cannot satisfy or defeat
 * a check.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const ROOT = resolve(SRC, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const files = walk(SRC).map((full) => ({
  path: relative(ROOT, full),
  src: stripComments(readFileSync(full, "utf-8")),
}));
const GRANT_FILE = "src/lib/auth/two-factor-grant.ts";

const TOTP_ACTIONS = "src/app/(auth)/totp/actions.ts";
const ENROL_ACTIONS = "src/app/(account)/account/2fa/actions.ts";

describe("two-factor grant allow-list (DECISION-292)", () => {
  it("G1: the importers of the grant module, and the names each takes, are exactly the three allowed", () => {
    const found: Record<string, string[]> = {};
    const specifiers: Record<string, number> = {};
    for (const f of files) {
      if (f.path === GRANT_FILE) continue;
      // Every way a module can be named as the grant module: import, re-export
      // (`export { x } from`, `export * from`, `export * as ns from`), a default or
      // namespace import. A `*` re-export is a barrel: it hands the grant to whoever
      // imports the barrel, so it takes the name "*" and fails the set below.
      const re =
        /(?:import|export)\s+(?:type\s+)?(?:\{([^}]*)\}|\*(?:\s+as\s+\w+)?|\w+)\s+from\s+["'][^"']*two-factor-grant["']/g;
      for (const m of f.src.matchAll(re)) {
        const names = (m[1] ?? "*")
          .split(",")
          .map((n) => n.trim().replace(/^type\s+/, "").replace(/\s+as\s+\w+$/, ""))
          .filter(Boolean);
        found[f.path] = [...(found[f.path] ?? []), ...names].sort();
      }
      if (/import\(\s*["'][^"']*two-factor-grant["']\s*\)/.test(f.src)) found[f.path] = [...(found[f.path] ?? []), "dynamic"];
      // Catch-all for any form the parse above does not model (require, a
      // side-effect import, `import x = require`): the module specifier may appear
      // once in each allowed file and nowhere else.
      const n = (f.src.match(/["'][^"']*two-factor-grant["']/g) ?? []).length;
      if (n > 0) specifiers[f.path] = n;
    }
    expect(found).toEqual({
      "src/auth.ts": ["takeTwoFactorGrant"],
      [TOTP_ACTIONS]: ["withTwoFactorGrant"],
      [ENROL_ACTIONS]: ["withTwoFactorGrant"],
    });
    expect(specifiers).toEqual({ "src/auth.ts": 1, [TOTP_ACTIONS]: 1, [ENROL_ACTIONS]: 1 });
  });

  it("G2: every mention of withTwoFactorGrant is the import or one allowed call (two in the totp actions, one in the enrolment actions), each in the one allowed shape", () => {
    // Count the NAME, not the call syntax: an alias (`const g = withTwoFactorGrant`),
    // `.call` / `.apply`, an aliased import from a barrel, a `typeof`, a namespace
    // member access all still spell the identifier, and none is one of the calls
    // below. Outside the grant module the name appears only in the two allowed files.
    const tokens: Record<string, number> = {};
    for (const f of files) {
      if (f.path === GRANT_FILE) continue;
      const n = (f.src.match(/\bwithTwoFactorGrant\b/g) ?? []).length;
      if (n > 0) tokens[f.path] = n;
    }
    // One mention for the import, plus one per allowed call.
    expect(tokens).toEqual({ [TOTP_ACTIONS]: 1 + 2, [ENROL_ACTIONS]: 1 + 1 });

    const shape =
      /(?:^|\n)\s*(?:(?:const|let)\s+\w+\s*=\s*|\w+\s*=\s*)?await\s+withTwoFactorGrant\(\s*session\.user\.id,\s*"(?:totp|recovery)",\s*\(\)\s*=>\s*unstable_update\(\{\}\),?\s*\)/g;
    for (const path of [TOTP_ACTIONS, ENROL_ACTIONS]) {
      const src = files.find((f) => f.path === path)!.src;
      const shaped = [...src.matchAll(shape)].length;
      expect(shaped, `${path}: every mention but the import is an awaited call, for session.user.id, with an empty-payload update`).toBe(
        tokens[path]! - 1,
      );
    }
  });

  it("G2b: every mention of takeTwoFactorGrant is the import or the one consume site in the jwt callback's update branch", () => {
    const tokens: Record<string, number> = {};
    for (const f of files) {
      if (f.path === GRANT_FILE) continue;
      const n = (f.src.match(/\btakeTwoFactorGrant\b/g) ?? []).length;
      if (n > 0) tokens[f.path] = n;
    }
    expect(tokens).toEqual({ "src/auth.ts": 2 });
    const src = files.find((f) => f.path === "src/auth.ts")!.src;
    expect(
      [...src.matchAll(/trigger\s*===\s*"update"\s*&&\s*takeTwoFactorGrant\(userId\)/g)].length,
      "the single call is gated on trigger === update and reads the token's own user id",
    ).toBe(1);
  });

  it("G3: the two 'use server' files export exactly their endpoints (no exported wrapper around the grant)", () => {
    function exportsOf(path: string): string[] {
      const src = files.find((f) => f.path === path)!.src;
      expect(src.trimStart().startsWith('"use server"') || src.trimStart().startsWith("'use server'"), `${path} is a use server file`).toBe(true);
      const names = new Set<string>();
      for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)) names.add(m[1]!);
      for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const n of m[1]!.split(",")) names.add(n.trim().replace(/^.*\s+as\s+/, ""));
      }
      if (/export\s+default/.test(src)) names.add("default");
      return [...names].filter(Boolean).sort();
    }
    expect(exportsOf(TOTP_ACTIONS)).toEqual(["verifyTotpAction"]);
    expect(exportsOf(ENROL_ACTIONS)).toEqual(["completeEnrollment", "regenerateRecoveryCodes"]);
  });

  it("G4: no 'use client' file under the enrolment or challenge routes reaches the session machinery or the grant", () => {
    const clients = files.filter(
      (f) =>
        (f.path.startsWith("src/app/(account)/account/2fa/") || f.path.startsWith("src/app/(auth)/totp/")) &&
        /^\s*["']use client["']/.test(readFileSync(join(ROOT, f.path), "utf-8")),
    );
    expect(clients.map((c) => c.path).length, "the scan found the client files").toBeGreaterThanOrEqual(4);
    for (const c of clients) {
      for (const banned of ["@/auth", "two-factor-grant", "unstable_update"]) {
        expect(c.src, `${c.path} must not contain ${banned}`).not.toContain(banned);
      }
    }
  });
});
