import { sql, type SQL } from "drizzle-orm";

/**
 * The ONE definition of "a gift that counts" — docs/work-log/
 * 2026-10-15-online-giving.md, P3-17 / G14. A connection's `livemode` is fixed
 * at creation from the platform key's mode; a Stripe TEST-mode gift is stored
 * with `livemode = false` and must never reach a total, an export, a
 * statement or a member's history. Offline gifts are always `livemode = true`.
 *
 * Every aggregate over `giving_gifts` — a `sum(`, a `count(`, a statement
 * gather, the CSV export — must apply this fragment through the table alias
 * `g`. A static test (`live-predicate.test.ts`) fails any non-test file under
 * `src/lib/giving/` that aggregates `giving_gifts` without it.
 *
 * The literal `g.livemode` is also what `scripts/giving/test-rls-46.sql`
 * (assertion 46n) reads — the database-side proof and the application-side
 * fragment name the same predicate.
 *
 * The string is a plain literal on purpose (the static test reads this file's
 * source); it contains no user input and is interpolated only through
 * `sql.raw` below.
 */
export const LIVE_SUCCEEDED_GIFT = "g.livemode and g.status = 'succeeded'";

/** The same fragment as a Drizzle `sql` chunk, for `sql\`... where ${liveSucceededGift}\``. */
export const liveSucceededGift: SQL = sql.raw(LIVE_SUCCEEDED_GIFT);
