import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";

/**
 * Platform-side view of the giving webhook inbox - docs/work-log/
 * 2026-10-15-online-giving.md, P3-6 and DECISION-175 (4).
 *
 * THE ONE `getPlatformDb()` USER IN ALL OF GIVING. `presby_giving_ingest_health()`
 * and `presby_giving_requeue_event()` are OWNER-ONLY (EXECUTE revoked from
 * `presby_app`), because they are cross-organization by nature: a summary of
 * every congregation's inbox, and a replay of any congregation's dead letter.
 * There is therefore no tenant-reachable cross-org summary anywhere. This file
 * sits outside `src/lib/giving/` on purpose, and `check:giving-boundaries`
 * keeps both function names and `getPlatformDb()` out of everywhere else in the
 * giving tree (B3, B6).
 *
 * WHAT IT RETURNS. Counts and timestamps per connection. No amounts, no donor
 * names, no event bodies, no event ids - the database function cannot return
 * them. The caller (a platform-axis page or action) gates on
 * `FEATURES.ADMIN_ORGANIZATIONS`; this module does no authorization of its own
 * and must never be imported from a tenant route. Organization names, when a
 * page wants them, come from the public `organizations` table, not from here.
 *
 * Neither function is called from the webhook, the cron or the processor.
 */

export interface IngestHealthRow {
  organizationId: string;
  connectionId: string;
  provider: string;
  /** The connection's mode. A test-mode connection's traffic is rehearsal. */
  livemode: boolean;
  /** `onboarding` | `active` | `restricted` | `disconnected`. */
  status: string;
  receivedCount: number;
  appliedCount: number;
  /** Events waiting on something (a refund before its gift, a failed fee read). */
  parkedCount: number;
  /** Events given up on. Replay is the operator's act. */
  deadLetterCount: number;
  /** ISO-8601 UTC, or null for a connection that has never received an event. */
  lastReceivedAt: string | null;
  /** Age in seconds of the oldest event not yet in a terminal state; null if none. */
  oldestPendingSeconds: number | null;
}

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];
}

/** pg returns bigint counts as strings and timestamptz as Date (or string): normalize both. */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listIngestHealth(): Promise<IngestHealthRow[]> {
  const result = await getPlatformDb().execute(sql`select * from presby_giving_ingest_health()`);
  return rowsOf(result).map((r) => ({
    organizationId: String(r.organization_id),
    connectionId: String(r.connection_id),
    provider: String(r.provider),
    livemode: r.livemode === true,
    status: String(r.status),
    receivedCount: Number(r.received_count ?? 0),
    appliedCount: Number(r.applied_count ?? 0),
    parkedCount: Number(r.parked_count ?? 0),
    deadLetterCount: Number(r.dead_letter_count ?? 0),
    lastReceivedAt: toIso(r.last_received_at),
    oldestPendingSeconds: r.oldest_pending_seconds === null || r.oldest_pending_seconds === undefined
      ? null
      : Number(r.oldest_pending_seconds),
  }));
}

export type RequeueResult = "requeued" | "not_dead_letter" | "not_found";

/** Moves one dead-lettered event back to `received` (attempts reset) so the cron retries it. */
export async function requeueDeadLetter(inboxId: string): Promise<RequeueResult> {
  const result = await getPlatformDb().execute(
    sql`select presby_giving_requeue_event(${inboxId}::uuid) as outcome`,
  );
  const outcome = String(rowsOf(result)[0]?.outcome ?? "not_found");
  return outcome === "requeued" || outcome === "not_dead_letter" ? outcome : "not_found";
}
