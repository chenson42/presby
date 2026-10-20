import type { NormalizedEvent } from "../types";
import type { FinishOutcome } from "./functions";

/**
 * The pure half of the ingest processor - docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "`processInboxEvent`". No database, no network, no `server-only`:
 * aggregation and audit planning are unit-tested directly, so the processor's
 * policy (what a mixed set of part outcomes MEANS, and what gets audited) is
 * pinned without a mock of anything.
 *
 * A part's outcome string is the apply functions' vocabulary:
 *   applied | applied:<suffix> | noop | none | parked:<code> | ignored:<code>
 *   | dead:<code> | failed:<code>
 */

export interface PartResult {
  kind: NormalizedEvent["kind"];
  outcome: string;
  /** For `reversal` parts: which kind of reversal, and how much (audit metadata). */
  reversalKind?: string;
  amountCents?: number;
}

const CODE_OK = /^[a-z0-9_:]{1,60}$/;

/** A finish code the database will accept (`^[a-z0-9_:]*$`, <= 60). */
export function finishCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (CODE_OK.test(raw)) return raw;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_:]+/g, "_")
    .slice(0, 60);
  return cleaned === "" ? null : cleaned;
}

function suffix(outcome: string): string {
  const at = outcome.indexOf(":");
  return at === -1 ? "" : outcome.slice(at + 1);
}

/**
 * Many parts, one verdict. Precedence is the Phase 3 text: any `dead:*` makes
 * the event dead; else any `parked:*` parks it (it retries, and so does any
 * failed part beside it); else any `failed:*` fails it (back-off, dead letter
 * at attempt 8); else, if every part was `ignored:*`, the event is ignored;
 * otherwise it is applied (a part that was already applied reads `noop`).
 */
export function aggregateOutcomes(parts: readonly string[]): { outcome: FinishOutcome; code: string | null } {
  const find = (prefix: string) => parts.find((p) => p.startsWith(prefix));
  const dead = find("dead:");
  if (dead) return { outcome: "dead", code: finishCode(suffix(dead)) };
  const parked = find("parked:");
  if (parked) return { outcome: "parked", code: finishCode(suffix(parked)) };
  const failed = find("failed:");
  if (failed) return { outcome: "failed", code: finishCode(suffix(failed)) };
  if (parts.length > 0 && parts.every((p) => p.startsWith("ignored:"))) {
    return { outcome: "ignored", code: finishCode(suffix(parts[0]!)) };
  }
  return { outcome: "applied", code: null };
}

export type PlannedAudit =
  | { key: "GIVING_REVERSAL_RECORDED"; metadata: { reversalKind: string | null; amountCents: number | null } }
  | { key: "GIVING_CONNECTION_STATUS_CHANGED"; metadata: Record<string, never> }
  | { key: "GIVING_CONNECTION_DISCONNECTED"; metadata: { reason: "deauthorized" } }
  | { key: "GIVING_DONOR_AUTOLINKED"; metadata: Record<string, never> }
  | { key: "GIVING_DONOR_LINK_CONFLICT"; metadata: Record<string, never> }
  | { key: "GIVING_EVENT_DEAD_LETTERED"; metadata: { lastError: string | null } };

/**
 * Which audit rows an event's outcome earns. Called AFTER `finish_event`, so a
 * row is written only for what actually committed. A duplicate (`noop`) writes
 * nothing, which is what makes a replayed delivery audit-silent.
 *
 * `finalStatus` is what `finish_event` returned: `dead_letter` earns the
 * dead-letter row whether the event was dead on its first attempt or failed its
 * eighth.
 */
export function planAudits(
  parts: readonly PartResult[],
  finalStatus: string,
  lastError: string | null,
): PlannedAudit[] {
  const out: PlannedAudit[] = [];
  for (const part of parts) {
    if (part.kind === "reversal" && part.outcome === "applied") {
      out.push({
        key: "GIVING_REVERSAL_RECORDED",
        metadata: { reversalKind: part.reversalKind ?? null, amountCents: part.amountCents ?? null },
      });
    } else if (part.kind === "connection_status" && part.outcome === "applied:status_changed") {
      out.push({ key: "GIVING_CONNECTION_STATUS_CHANGED", metadata: {} });
    } else if (part.kind === "connection_status" && part.outcome === "applied:disconnected") {
      out.push({ key: "GIVING_CONNECTION_DISCONNECTED", metadata: { reason: "deauthorized" } });
    } else if ((part.kind === "gift" || part.kind === "subscription") && part.outcome === "applied:autolinked") {
      out.push({ key: "GIVING_DONOR_AUTOLINKED", metadata: {} });
    } else if ((part.kind === "gift" || part.kind === "subscription") && part.outcome === "applied:link_conflict") {
      out.push({ key: "GIVING_DONOR_LINK_CONFLICT", metadata: {} });
    }
  }
  if (finalStatus === "dead_letter") {
    out.push({ key: "GIVING_EVENT_DEAD_LETTERED", metadata: { lastError } });
  }
  return out;
}
