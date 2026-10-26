import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { readCard, rowsOf, toCount, type CardResult } from "./read-card";

/**
 * Tickets card. Numbers only: no subject, area, submitter or body is selected
 * (E18, DECISION-252).
 *
 *   newCount         status = 'new'
 *   unassignedOpen   open (new, triaged, in_progress) with no assignee
 *   oldestNewSeconds age of the oldest new ticket, in seconds, computed in SQL
 *                    (the Neon driver returns computed dates as strings), or
 *                    null when no ticket is new
 *
 * The status list matches `TICKET_STATUSES` (tickets-labels.ts); a test pins it.
 */
export interface TicketsCard {
  newCount: number;
  unassignedOpen: number;
  oldestNewSeconds: number | null;
}

export function readTicketsCard(): Promise<CardResult<TicketsCard>> {
  return readCard("tickets", async () => {
    const result = await getPlatformDb().execute(sql`
      select count(*) filter (where status = 'new')::int as new_count,
             count(*) filter (where assignee_user_id is null)::int as unassigned_open,
             date_part('epoch', now() - min(created_at) filter (where status = 'new'))::int as oldest_new_seconds
        from tickets
       where status in ('new', 'triaged', 'in_progress')
    `);
    const row = rowsOf(result)[0] ?? {};
    return {
      newCount: toCount(row.new_count),
      unassignedOpen: toCount(row.unassigned_open),
      oldestNewSeconds:
        row.oldest_new_seconds === null || row.oldest_new_seconds === undefined
          ? null
          : toCount(row.oldest_new_seconds),
    };
  });
}
