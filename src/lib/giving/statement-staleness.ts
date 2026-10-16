import { sql, type SQL } from "drizzle-orm";

/**
 * Derived statement state - docs/work-log/2026-10-15-online-giving.md,
 * DECISION-173 ("staleness is derived, never stored") and Batch 5a.
 *
 * An issued statement row is frozen (drizzle/0056), so "this statement needs a
 * correction" can never be a column on it. It is computed, here, once, and
 * every reader - the treasurer's statements list, getStale(), the re-issue
 * gate, the member self-view - applies these fragments rather than restating
 * them. `giving-statements.db.test.ts` exercises exactly these strings against
 * the database, so a reader that imports them inherits that proof.
 *
 * ALIAS CONTRACT: both fragments are boolean SQL expressions over a
 * `giving_statements` row aliased `s`:
 *
 *   sql`select s.id from giving_statements s
 *        where ${statementIsLatest} and ${statementIsStale}`
 *
 * They read giving_donors / giving_gifts / giving_gift_reversals under the
 * caller's own RLS context, which is the statement's organization.
 *
 * WHAT MAKES A STATEMENT STALE. Some gift of the statement's donor-ROOT group
 * (the donor, and every donor merged into it - merges are flat, depth <= 1)
 * that is live (`g.livemode`, P3-17 - a Stripe test-mode gift never makes a
 * statement stale) and succeeded and dated inside the statement's period, AND
 * that changed after the statement was issued:
 *   - it was created after issued_at (a late-dated entry);
 *   - it became succeeded after issued_at (a pending ACH that cleared);
 *   - it gained a reversal after issued_at (a refund, dispute, return, void,
 *     or reinstatement); or
 *   - its donor was merged into the statement's donor after issued_at (the
 *     gift joined the group after the statement was composed).
 * A gift that is pending or failed now changes nothing on the statement, so it
 * makes nothing stale; when it later succeeds, status_changed_at does.
 *
 * issued_at is stamped by the database at insert (0056 deviation S2), so it is
 * the issuing transaction's start time - the same clock as gift created_at.
 *
 * Pure: no `server-only`, no database import.
 */
export const STATEMENT_IS_STALE = `exists (
  select 1
    from giving_donors sd
    join giving_gifts g on g.organization_id = sd.organization_id and g.donor_id = sd.id
   where sd.organization_id = s.organization_id
     and (sd.id = s.donor_id or sd.merged_into_id = s.donor_id)
     and g.livemode and g.status = 'succeeded'
     and g.occurred_on between s.period_start and s.period_end
     and (g.created_at > s.issued_at
          or g.status_changed_at > s.issued_at
          or (sd.merged_into_id = s.donor_id and sd.merged_at > s.issued_at)
          or exists (select 1 from giving_gift_reversals r
                      where r.organization_id = g.organization_id and r.gift_id = g.id
                        and r.created_at > s.issued_at)))`;

/** The latest version: nothing supersedes it (the chain never forks - 0056). */
export const STATEMENT_IS_LATEST = `not exists (
  select 1 from giving_statements s_next
   where s_next.organization_id = s.organization_id and s_next.supersedes_id = s.id)`;

/** The fragments as Drizzle `sql` chunks. Plain literals interpolated with sql.raw; no user input. */
export const statementIsStale: SQL = sql.raw(STATEMENT_IS_STALE);
export const statementIsLatest: SQL = sql.raw(STATEMENT_IS_LATEST);
