import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";

/**
 * Platform-side view of the giving webhook inbox - docs/work-log/
 * 2026-10-15-online-giving.md, P3-6 and DECISION-175 (4).
 *
 * THE ONE `getPlatformDb()` USER IN ALL OF GIVING. `presby_giving_ingest_health()`,
 * `presby_giving_dead_letters()` and `presby_giving_requeue_event()` are OWNER-ONLY (EXECUTE revoked from
 * `presby_app`), because they are cross-organization by nature: a summary of
 * every congregation's inbox, and a replay of any congregation's dead letter.
 * There is therefore no tenant-reachable cross-org summary anywhere. This file
 * sits outside `src/lib/giving/` on purpose, and `check:giving-boundaries`
 * keeps all three function names and `getPlatformDb()` out of everywhere else in the
 * giving tree (B3, B6).
 *
 * WHAT IT RETURNS. Counts and timestamps per connection from `listIngestHealth`
 * (no event ids there by design), and, from `listDeadLetters`, one row per
 * dead-lettered event: the inbox id (what `requeueDeadLetter` takes), the
 * connection and organization ids, the provider's event id and type, when it
 * arrived, how many attempts it had and a short error CODE. No amounts, no donor
 * names, no event bodies - the database functions cannot return them. The caller (a platform-axis page or action) gates on
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

export interface IngestHealthSummary {
  /** Connections the health function returned. */
  connections: number;
  /** Events waiting on something, summed over every connection (`parkedCount`). */
  waiting: number;
  /** Events given up on, summed over every connection (`deadLetterCount`). */
  deadLetters: number;
  /** Connections whose status is `restricted`. */
  restricted: number;
}

/**
 * The dashboard's Giving notices card (docs/work-log/
 * 2026-10-25-platform-admin-redesign-inc1.md): four numbers reduced from the
 * rows `listIngestHealth` returns. Pure. Nothing here carries an id, an amount or
 * a donor, because the rows it reduces do not.
 */
export function summarizeIngestHealth(rows: readonly IngestHealthRow[]): IngestHealthSummary {
  let waiting = 0;
  let deadLetters = 0;
  let restricted = 0;
  for (const r of rows) {
    waiting += r.parkedCount;
    deadLetters += r.deadLetterCount;
    if (r.status === "restricted") restricted += 1;
  }
  return { connections: rows.length, waiting, deadLetters, restricted };
}

/** One call of `presby_giving_ingest_health()`, reduced. */
export async function readIngestHealthSummary(): Promise<IngestHealthSummary> {
  return summarizeIngestHealth(await listIngestHealth());
}

/**
 * One dead-lettered event, as `presby_giving_dead_letters()` returns it (0055,
 * C2). Identifiers, a type, a time, a count and an error code - nothing a donor
 * wrote, nothing about money. The caller's page joins `organizationId` to the
 * public `organizations` table for a name.
 */
export interface DeadLetterRow {
  /** The inbox row's id: the argument `requeueDeadLetter()` takes. */
  eventId: string;
  connectionId: string;
  organizationId: string;
  /** The provider's own id (`evt_...`). */
  externalEventId: string;
  eventType: string;
  /** ISO-8601 UTC. */
  receivedAt: string | null;
  attempts: number;
  /** A short code (`over_reversal`, `normalize_api_version`, ...), or null. */
  lastErrorClass: string | null;
}

const DEAD_LETTER_LIMIT_MAX = 100;

/** Dead-lettered events across every organization, oldest first. `limit` is clamped to 1..100 (the database clamps too). */
export async function listDeadLetters(limit: number = DEAD_LETTER_LIMIT_MAX): Promise<DeadLetterRow[]> {
  const bounded = Math.min(DEAD_LETTER_LIMIT_MAX, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : DEAD_LETTER_LIMIT_MAX)));
  const result = await getPlatformDb().execute(sql`select * from presby_giving_dead_letters(${bounded}::integer)`);
  return rowsOf(result).map((r) => ({
    eventId: String(r.event_id),
    connectionId: String(r.connection_id),
    organizationId: String(r.organization_id),
    externalEventId: String(r.external_event_id),
    eventType: String(r.event_type),
    receivedAt: toIso(r.received_at),
    attempts: Number(r.attempts ?? 0),
    lastErrorClass: typeof r.last_error_class === "string" ? r.last_error_class : null,
  }));
}

export type RequeueResult = "requeued" | "not_dead_letter" | "not_found";

/**
 * Moves one dead-lettered event back to `received` (attempts reset) so the cron
 * retries it. `eventId` is a `DeadLetterRow.eventId`. The caller writes the
 * `ORG_GIVING_EVENT_REQUEUED` audit row (this module does no audit of its own).
 */
export async function requeueDeadLetter(eventId: string): Promise<RequeueResult> {
  const result = await getPlatformDb().execute(
    sql`select presby_giving_requeue_event(${eventId}::uuid) as outcome`,
  );
  const outcome = String(rowsOf(result)[0]?.outcome ?? "not_found");
  return outcome === "requeued" || outcome === "not_dead_letter" ? outcome : "not_found";
}

/**
 * Organization names for the platform pages' tables (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 3b). The health rows carry organization
 * ids only; the NAME comes from the public `organizations` table (id and name,
 * nothing else). Lives here so the platform pages read through this one module
 * and `getPlatformDb()` stays in a single file. An id with no row is simply
 * absent from the map (the caller falls back to "Unknown organization").
 */
export async function listOrganizationNames(organizationIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(organizationIds));
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const result = await getPlatformDb().execute(
    sql`select id, name from organizations where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
  );
  for (const r of rowsOf(result)) names.set(String(r.id), String(r.name));
  return names;
}
