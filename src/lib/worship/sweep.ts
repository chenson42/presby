import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { platformOrigin } from "@/lib/domains/host";
import { insertQueueRowInTx } from "@/lib/email/queue";
import { buildReminderMessage, worshipLinks } from "./messages";
import { rowsOf, uuidList } from "./sql-util";

/**
 * The nightly reminder step - docs/work-log/2026-11-04-worship-inc1.md, Phase 3
 * "Cron" and DECISION-325. THE ONLY `getPlatformDb()` USER IN
 * `src/lib/worship/` (`boundaries.test.ts` pins it).
 *
 * `presby_worship_claim_reminders(p_batch)` is a CROSS-ORG WRITER: it selects
 * the due assignments of every organization (`FOR UPDATE SKIP LOCKED`), stamps
 * `unanswered_reminded_at` or `reminded_at` (set once, so each kind is sent at
 * most once per assignment), and returns the claimed rows with a deliverable
 * `role` address resolved in SQL. EXECUTE is held by the owner alone, so it can
 * only run on the platform connection. Due means: the toggle is on
 * (`presby_worship_enabled`), the service is uncancelled and starts within 72
 * hours (a request older than 24 hours) or 48 hours (a confirmed assignment) of
 * the organization's local now; the person is unmerged, living, still related
 * to the organization and not presumed a minor; never `declined`, `withdrawn`
 * or a guest.
 *
 * ONE TRANSACTION: the claim and the queue rows commit together, so a failed
 * queue insert rolls the stamps back (un-claims) and the next run retries. The
 * step writes NO worship table directly: the stamps are the definer's.
 *
 * TIMING (F429, accepted). This rides the existing 03:00 UTC maintenance run,
 * about 10 to 11 pm US Eastern. No fifth cron was added (R10). The reminders are
 * queued here and sent by the five-minute email-queue cron.
 *
 * ORIGIN. When `platformOrigin()` is null the step returns 0 and claims
 * NOTHING (a claim with no way to link would burn the once-only stamp).
 *
 * One email per claimed assignment: a volunteer holding two positions on one
 * service is reminded twice (the Copy has one line per reminder; grouping is a
 * later refinement, recorded in the work-log).
 *
 * The caller (`/api/cron/maintenance`) isolates a failure from the rest of the
 * run and logs a fixed label with counts only.
 */

/** Rows per run; the definer clamps its argument to 1..500. */
export const REMINDER_BATCH = 500;

type PlatformDb = ReturnType<typeof getPlatformDb>;
type PlatformTx = Parameters<Parameters<PlatformDb["transaction"]>[0]>[0];

/**
 * The body of the step on a caller's transaction (so a test can run it inside
 * one it rolls back). Returns the number of reminders queued.
 */
export async function sweepReminders(tx: PlatformTx): Promise<number> {
  const origin = platformOrigin();
  if (origin === null) return 0;

  const claimed = rowsOf(await tx.execute(sql`select * from presby_worship_claim_reminders(${REMINDER_BATCH})`));
  if (claimed.length === 0) return 0;

  // What each reminder says, read in one statement on the owner connection (no
  // tenant context: this is the cross-organization step). Names and times only.
  const ids = claimed.map((r) => String(r.assignment_id));
  const facts = new Map<string, Record<string, unknown>>();
  for (const row of rowsOf(
    await tx.execute(sql`
      select a.id::text as id, o.name as org_name, o.slug,
             to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at,
             wp.name as position_name, g.name as team_name
        from worship_assignments a
        join organizations o on o.id = a.organization_id
        join events e on e.id = a.event_id and e.organization_id = a.organization_id
        join worship_positions wp on wp.id = a.position_id and wp.organization_id = a.organization_id
        join groups g on g.id = a.group_id and g.organization_id = a.organization_id
       where a.id in (${uuidList(ids)})
    `),
  )) {
    facts.set(String(row.id), row);
  }

  let queued = 0;
  for (const claim of claimed) {
    const fact = facts.get(String(claim.assignment_id));
    if (!fact || typeof claim.address !== "string" || claim.address === "") {
      // A claimed row we cannot address would be silently lost; fail the step so the claim rolls back.
      throw new Error("worship reminder: a claimed row has no facts or no address");
    }
    const worshipMessage = buildReminderMessage({
      kind: claim.kind === "confirmed" ? "confirmed" : "unanswered",
      organizationName: String(fact.org_name),
      line: {
        startsAt: String(fact.starts_at),
        positionName: String(fact.position_name),
        teamName: String(fact.team_name),
      },
      link:
        claim.kind === "confirmed"
          ? worshipLinks.home(origin, String(fact.slug))
          : worshipLinks.request(origin, String(fact.slug), String(claim.assignment_id)),
    });
    await insertQueueRowInTx(tx, {
      to: claim.address,
      message: worshipMessage.message,
      templateKey: worshipMessage.templateKey,
    });
    queued += 1;
  }
  return queued;
}

export async function runWorshipReminderSweep(): Promise<number> {
  return getPlatformDb().transaction((tx) => sweepReminders(tx));
}
