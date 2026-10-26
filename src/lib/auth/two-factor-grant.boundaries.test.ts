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
    for (const f of files) {
      if (f.path === GRANT_FILE) continue;
      const re = /(?:import|export)\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*two-factor-grant["']/g;
      for (const m of f.src.matchAll(re)) {
        const names = (m[1] ?? "*")
          .split(",")
          .map((n) => n.trim().replace(/^type\s+/, "").replace(/\s+as\s+\w+$/, ""))
          .filter(Boolean);
        found[f.path] = [...(found[f.path] ?? []), ...names].sort();
      }
      if (/import\(\s*["'][^"']*two-factor-grant["']\s*\)/.test(f.src)) found[f.path] = [...(found[f.path] ?? []), "dynamic"];
    }
    expect(found).toEqual({
      "src/auth.ts": ["takeTwoFactorGrant"],
      [TOTP_ACTIONS]: ["withTwoFactorGrant"],
      [ENROL_ACTIONS]: ["withTwoFactorGrant"],
    });
  });

  it("G2: withTwoFactorGrant( is called exactly twice in the totp actions and once in the enrolment actions, each in the one allowed shape", () => {
    const counts: Record<string, number> = {};
    for (const f of files) {
      if (f.path === GRANT_FILE) continue;
      const n = (f.src.match(/withTwoFactorGrant\s*\(/g) ?? []).length;
      if (n > 0) counts[f.path] = n;
    }
    // The import line mentions the name without a call: only calls were counted above.
    expect(counts).toEqual({ [TOTP_ACTIONS]: 2, [ENROL_ACTIONS]: 1 });

    const shape =
      /(?:^|\n)\s*(?:(?:const|let)\s+\w+\s*=\s*|\w+\s*=\s*)?await\s+withTwoFactorGrant\(\s*session\.user\.id,\s*"(?:totp|recovery)",\s*\(\)\s*=>\s*unstable_update\(\{\}\),?\s*\)/g;
    for (const path of [TOTP_ACTIONS, ENROL_ACTIONS]) {
      const src = files.find((f) => f.path === path)!.src;
      const shaped = [...src.matchAll(shape)].length;
      expect(shaped, `${path}: every call is awaited, for session.user.id, with an empty-payload update`).toBe(counts[path]);
    }
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
