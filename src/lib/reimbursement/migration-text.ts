import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Test support: the text of the reimbursement migrations, for the tests that pin
 * a TypeScript constant to what the SQL says (limits, the transition table, the
 * outcome lists, the permission keys and their descriptions). Not imported by
 * application code.
 */
const DRIZZLE = path.resolve(__dirname, "../../../drizzle");

export const MIGRATION_0073 = readFileSync(path.join(DRIZZLE, "0073_presby_reimbursements.sql"), "utf8");
export const MIGRATION_0074 = readFileSync(path.join(DRIZZLE, "0074_presby_reimbursement_permissions.sql"), "utf8");

/** The body of `create or replace function <name>(` up to its closing `end $$;`. */
export function functionBody(sqlText: string, name: string): string {
  const start = sqlText.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sqlText.indexOf("\nend $$;", start);
  if (end < 0) throw new Error(`function ${name} has no end $$;`);
  return sqlText.slice(start, end);
}
