/**
 * GET /api/cron/giving - the giving worker (every five minutes; see vercel.json).
 * docs/work-log/2026-10-15-online-giving.md, Phase 3 "Cron".
 *
 * Does the three things nothing else will:
 *   1. processes due inbox events - a webhook whose `after()` was cut off, a
 *      parked event whose back-off has elapsed (a refund that arrived before its
 *      gift), an event whose lease expired;
 *   2. purges raw bodies 90 days after a terminal state (data minimisation);
 *   3. expires checkout intents that never completed.
 *
 * Same shape as `cron/maintenance`: `CRON_SECRET` unset is a 503 (a visible
 * failure in the Vercel cron dashboard rather than a silent no-op), a wrong
 * bearer is a 401. `db` only - no owner connection, no session. A 25 second
 * budget; whatever is left is picked up on the next run. GET only (Vercel cron
 * invokes GET); there is no admin "run now" surface.
 *
 * AUDIT. Processing writes its own audit rows (`ingest/process.ts`); the purge
 * and the expiry are routine data hygiene with no security meaning and write
 * none. Hand-audited here: `check:audit` does not scan route handlers.
 */

import { dueEvents, expireIntents, purgeBodies } from "@/lib/giving/ingest/functions";
import { processInboxEvent } from "@/lib/giving/ingest/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BATCH = 25;
const BUDGET_MS = 25_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Giving cron disabled: set CRON_SECRET to enable." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const deadline = Date.now() + BUDGET_MS;
  try {
    const due = await dueEvents(BATCH);
    let processed = 0;
    for (const inboxId of due) {
      if (Date.now() >= deadline) break;
      const result = await processInboxEvent(inboxId);
      if (result.claimed) processed += 1;
    }
    const purged = await purgeBodies();
    const expired = await expireIntents();

    const summary = { processed, purged, expired };
    console.info("[cron/giving]", JSON.stringify(summary));
    return Response.json({ ok: true, ...summary });
  } catch {
    console.error("[cron/giving] failed");
    return Response.json({ error: "Internal server error." }, { status: 500 });
  }
}
