/**
 * T2 (F343, DECISION-291; docs/work-log/2026-10-26-2fa-default.md, Phase 3
 * "Test plan"): static pins on drizzle/0080_presby_two_factor_default.sql and
 * the Drizzle mirror. No database. The behaviour is proven on a real database
 * in two-factor-default.db.test.ts, scripts/giving/test-rls-46.sql (46j) and
 * scripts/domains/test-rls-47.sql (47n).
 *
 *   - The Drizzle `users.twoFactorRequired` default is false (parity does not
 *     compare defaults, R1(g)).
 *   - 0080 sets the column default to false and never updates `users`: existing
 *     accounts keep their value (operator ruling 3).
 *   - 0080 flags exactly the three administration keys, behind a count guard
 *     that runs BEFORE the update and a post-check AFTER it.
 *   - 0080 restates both comments and never redefines a function (R1(c): arm B
 *     reads `permissions.requires_two_factor` live, so no body change).
 *   - No top-level begin/commit: the file is applied with `psql -1`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { users } from "../schema";

const RAW = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0080_presby_two_factor_default.sql", import.meta.url)),
  "utf8",
);
/** Line comments removed, and whitespace collapsed, so a marker quoted in a comment never satisfies an assertion. */
const SQL = RAW.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();

describe("two-factor default (0080 text and the Drizzle mirror)", () => {
  it("the Drizzle column default is false", () => {
    const col = getTableConfig(users).columns.find((c) => c.name === "two_factor_required");
    expect(col).toBeDefined();
    expect(col!.notNull).toBe(true);
    expect(col!.hasDefault).toBe(true);
    expect(col!.default).toBe(false);
  });

  it("0080 sets the default and contains no update of users", () => {
    expect(SQL).toContain("alter table users alter column two_factor_required set default false");
    expect(SQL).not.toMatch(/update\s+(public\.)?users\b/);
    expect(SQL).not.toMatch(/insert\s+into\s+(public\.)?users\b/);
    expect(SQL).not.toMatch(/delete\s+from\s+(public\.)?users\b/);
  });

  it("0080 guards the catalog count before the flag update and checks it after", () => {
    const update =
      "update permissions set requires_two_factor = true where key in ('roles.manage','role_grants.manage','domains.manage') and not requires_two_factor";
    const iUpdate = SQL.indexOf(update);
    expect(iUpdate, "the three-key update, idempotent on replay").toBeGreaterThanOrEqual(0);
    const iGuard = SQL.indexOf("0080: expected 3 catalog rows");
    const iPost = SQL.indexOf("0080: the three keys are not all flagged");
    expect(iGuard).toBeGreaterThanOrEqual(0);
    expect(iPost).toBeGreaterThanOrEqual(0);
    expect(iGuard).toBeLessThan(iUpdate);
    expect(iPost).toBeGreaterThan(iUpdate);
    // Exactly one statement writes permissions, and it names only the three keys.
    expect(SQL.match(/update\s+permissions\b/g)).toHaveLength(1);
  });

  it("0080 restates both comments and never redefines presby_two_factor_required", () => {
    expect(SQL).toContain("comment on column users.two_factor_required is");
    expect(SQL).toContain("comment on column permissions.requires_two_factor is");
    expect(SQL).toContain("comment on function presby_two_factor_required(uuid) is");
    expect(SQL).not.toMatch(/create\s+(or\s+replace\s+)?function/);
    expect(SQL).not.toMatch(/create\s+(or\s+replace\s+)?trigger/);
    // A statement start, not the word: the users comment says "grant points".
    expect(SQL).not.toMatch(/(^|;)\s*(grant|revoke)\s/);
  });

  it("0080 has no top-level begin/commit (applied with psql -1)", () => {
    // Strip the two do-blocks' bodies, whose plpgsql "begin ... end" is not a transaction.
    const outside = SQL.replace(/do \$\$.*?\$\$;/g, "");
    expect(outside).not.toMatch(/(^|;)\s*(begin|start transaction)\b/);
    expect(outside).not.toMatch(/(^|;)\s*commit\b/);
  });
});
