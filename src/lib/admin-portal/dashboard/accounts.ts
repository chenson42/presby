import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { readCard, rowsOf, toCount, type CardResult } from "./read-card";

/**
 * Locked accounts card: `users.locked_until > now()`. The only writer of that
 * column is the failed-sign-in lockout in src/auth.ts; it is cleared from the
 * user page. A count; no address.
 */
export interface AccountsCard {
  locked: number;
}

export function readAccountsCard(): Promise<CardResult<AccountsCard>> {
  return readCard("accounts", async () => {
    const result = await getPlatformDb().execute(
      sql`select count(*)::int as locked from users where locked_until > now()`,
    );
    return { locked: toCount(rowsOf(result)[0]?.locked) };
  });
}
