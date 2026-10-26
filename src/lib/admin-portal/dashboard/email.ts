import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { readCard, rowsOf, toCount, type CardResult } from "./read-card";

/**
 * Email queue card. No address, subject or body is selected.
 *
 *   failed   status = 'failed', all time (the count strip on /admin/email-queue)
 *   overdue  status = 'queued' and coalesce(next_attempt_at, created_at) more
 *            than 30 minutes ago. The destination's "queued" filter lists every
 *            queued row, including ones not yet due, so the card says the
 *            threshold rather than a bare "queued" (Copy, group D).
 *
 * The `status in (...)` keeps the statement on `ix_email_queue_status_next`
 * instead of scanning every sent row.
 */
export interface EmailCard {
  failed: number;
  overdue: number;
}

export function readEmailCard(): Promise<CardResult<EmailCard>> {
  return readCard("email", async () => {
    const result = await getPlatformDb().execute(sql`
      select count(*) filter (where status = 'failed')::int as failed,
             count(*) filter (
               where status = 'queued'
                 and coalesce(next_attempt_at, created_at) < now() - interval '30 minutes'
             )::int as overdue
        from email_queue
       where status in ('failed', 'queued')
    `);
    const row = rowsOf(result)[0] ?? {};
    return { failed: toCount(row.failed), overdue: toCount(row.overdue) };
  });
}
