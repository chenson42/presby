/**
 * T9 (F343, DECISION-291; architect R2d): in the jwt callback the default-role
 * grant (which, for an INITIAL_ADMIN_EMAILS address, also switches the person's
 * own two-factor setting on) must run BEFORE the `dbUser` read, so the very
 * first token already carries `twoFactorRequired = true` together with the admin
 * features. A source-order pin: the ordering is the whole point and a refactor
 * that moved the grant below the read would pass every other test.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const code = fs.readFileSync(path.join(__dirname, "auth.ts"), "utf8");

describe("src/auth.ts jwt callback ordering", () => {
  it("ensureDefaultRole comes from @/lib/auth/default-role and is no longer defined in auth.ts", () => {
    expect(code).toMatch(/import\s*\{\s*ensureDefaultRole\s*\}\s*from\s*"@\/lib\/auth\/default-role"/);
    expect(code).not.toMatch(/function ensureDefaultRole/);
  });

  it("awaits ensureDefaultRole before the dbUser read and before the lastLoginAt update", () => {
    const grant = code.indexOf("await ensureDefaultRole(");
    const dbUser = code.indexOf("const dbUser = await db.query.users.findFirst");
    const lastLogin = code.indexOf("lastLoginAt: new Date()");
    expect(grant).toBeGreaterThan(-1);
    expect(dbUser).toBeGreaterThan(-1);
    expect(lastLogin).toBeGreaterThan(-1);
    expect(grant).toBeLessThan(lastLogin);
    expect(lastLogin).toBeLessThan(dbUser);
  });

  it("hands the helper the parsed INITIAL_ADMIN_EMAILS, which auth.ts keeps parsing", () => {
    expect(code).toMatch(/ensureDefaultRole\(user\.id,\s*user\.email \?\? null,\s*INITIAL_ADMIN_EMAILS\)/);
    expect(code).toMatch(/const INITIAL_ADMIN_EMAILS/);
  });
});
