import "server-only";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";
import { getPlatformDb } from "@/lib/db";

/**
 * The daily careers step: auto-close published postings whose closing date has
 * passed (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Cron"; DECISION-264).
 *
 * THE ONLY `getPlatformDb()` USER IN `src/lib/careers/` (`boundaries.test.ts`
 * pins it). `presby_careers_sweep()` is a parameterless-in-spirit CROSS-ORG
 * WRITER: it closes postings in every organization, derives nothing from
 * `presby_current_org()`, and is executable by the owner alone (the
 * `presby_reconcile_current_roll()` precedent), so it can only run on the
 * platform connection. It ignores the per-org toggle on purpose: a retention
 * clock must never depend on a switch a church can flip.
 *
 * "Open" is a derived predicate at READ time (the public definer compares the
 * closing date with the organization's own today), so this sweep is housekeeping
 * that makes the stored status catch up with what visitors already see, not the
 * gate: a posting is closed to the public the moment its date passes, up to
 * about a day before this runs.
 *
 * One transaction: the closes and their audit rows commit together, and a failed
 * audit insert (or a failed sweep) rolls everything back, so a posting is never
 * closed without a row saying so. The caller isolates a failure from the rest of
 * the maintenance cron.
 */

/** Rows per run; the definer clamps its argument to 1..1000. */
const SWEEP_BATCH = 200;

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []) as Record<
    string,
    unknown
  >[];
}

/**
 * The body of the step, on the caller's transaction (so a test can run it inside
 * one it rolls back). Returns the number of postings closed. Counts and audits
 * only `posting_closed` rows: a later increment adds other kinds to the same
 * result set.
 */
export async function sweepClosedPostings(tx: OrgTx): Promise<number> {
  const result = await tx.execute(sql`select * from presby_careers_sweep(${SWEEP_BATCH})`);
  const closed = rowsOf(result).filter((row) => row.kind === "posting_closed");
  for (const row of closed) {
    const postingId = String(row.posting_id);
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.CAREERS_POSTING_CLOSED,
      actor: null,
      resourceType: "job_posting",
      resourceId: postingId,
      metadata: {
        organizationId: String(row.organization_id),
        postingId,
        via: "closing_date",
      },
    });
  }
  return closed.length;
}

export async function runCareersSweep(): Promise<number> {
  return getPlatformDb().transaction((tx) => sweepClosedPostings(tx));
}
