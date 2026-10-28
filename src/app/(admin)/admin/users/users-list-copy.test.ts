/**
 * T15 (F343, DECISION-291), Copy S7: /admin/users no longer marks a row
 * "2FA exempt". The marker read only the column, which is false for nearly
 * every new account and false for anyone required through a role, so it said
 * something untrue and became noise. A source pin: the page neither renders
 * the words nor selects the column that fed them.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const code = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");

describe("src/app/(admin)/admin/users/page.tsx", () => {
  it("has no '2FA exempt' marker", () => {
    expect(code).not.toMatch(/2FA exempt/i);
  });

  it("does not select users.twoFactorRequired (nothing on the page reads it any more)", () => {
    expect(code).not.toMatch(/twoFactorRequired/);
  });
});
