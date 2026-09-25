import { sql } from "drizzle-orm";
import { db, getPlatformDb } from "@/lib/db";

// Vercel cron invokes via GET. See vercel.json for the schedule (0 3 * * *).
// Runs daily at 03:00 UTC to prune expired tokens from three tables:
//   - password_reset_tokens     (60-min TTL; one row per user max)
//   - email_verification_tokens (24-h TTL; one row per user max)
//   - user_totp_pending_enrollments (10-min TTL; one row per user max)
// POST is intentionally omitted — no admin "run now" surface exists yet.
export async function GET(req: Request) {
  // Guard: CRON_SECRET must be set for the worker to run.
  // Without it, ops has no way to authenticate requests — return 503 so the
  // Vercel cron dashboard surfaces a visible failure rather than silently no-oping.
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET) {
    return Response.json(
      { error: "Maintenance cron disabled: set CRON_SECRET to enable." },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  // DELETE expired rows, 500 per table per invocation.
  // Drizzle does not support .limit() on DELETE for Postgres; the subquery
  // form is required. RETURNING gives us the deleted count without a
  // separate SELECT. Untyped sql`` (no generic) is intentional — the type
  // parameter is unnecessary on execute() results.
  const [pwdResetResult, emailVerifyResult, totpPendingResult] =
    await Promise.all([
      db.execute(sql`
        DELETE FROM "password_reset_tokens"
        WHERE id IN (
          SELECT id FROM "password_reset_tokens"
          WHERE "expires_at" < now()
          LIMIT 500
        )
        RETURNING id
      `),
      db.execute(sql`
        DELETE FROM "email_verification_tokens"
        WHERE id IN (
          SELECT id FROM "email_verification_tokens"
          WHERE "expires_at" < now()
          LIMIT 500
        )
        RETURNING id
      `),
      db.execute(sql`
        DELETE FROM "user_totp_pending_enrollments"
        WHERE "user_id" IN (
          SELECT "user_id" FROM "user_totp_pending_enrollments"
          WHERE "expires_at" < now()
          LIMIT 500
        )
        RETURNING "user_id"
      `),
    ]);

  // F29: roll actions are routinely future-dated - a session approves a
  // transfer effective at month end. The trigger that maintains
  // memberships.current_roll fires when the action is APPROVED, but the correct
  // answer changes on its EFFECTIVE DATE, and nothing writes that day. So the
  // cache drifts with the passage of time and the directory shows a stale roll
  // while every report shows the right one.
  //
  // A non-zero count here is normal on any day an action takes effect. A
  // non-zero count that PERSISTS across runs means something else is wrong —
  // and this field is now the ONLY routine signal for that, because
  // presby_roll_cache_drift()'s `= 0` assertion left scripts/test-rls.sql in
  // the same change (C-4; the drift function is no longer callable from the
  // tenant role at all).
  //
  // THIS ONE STATEMENT RUNS ON getPlatformDb(), NOT db (C-4 / B-L3,
  // drizzle/0048 section 6). presby_reconcile_current_roll() is a
  // parameterless CROSS-ORG WRITER of memberships.current_roll: it is
  // SECURITY DEFINER, takes no org argument, and derives no actor from
  // presby_current_org(), so it is neither F26's case (a trigger that must
  // see across orgs inside a guarded operation) nor DECISION-135's sanctioned
  // function-mediated shape. 0048 revokes EXECUTE from presby_app and PUBLIC,
  // leaving the owner connection as its only caller.
  //
  // Only this statement moves. The three token DELETEs above deliberately
  // stay on `db` — moving the whole handler to one connection would widen
  // them from presby_app to owner for no reason (Phase 2 §2(b)). This route
  // is src/app/api/cron/, not src/app/(org)/, so the (org) contract's
  // getPlatformDb() ban is not crossed.
  const rollReconcile = await getPlatformDb().execute(
    sql`select presby_reconcile_current_roll() as fixed`,
  );
  const rolledForward = Number(
    (rollReconcile.rows[0] as { fixed: number } | undefined)?.fixed ?? 0,
  );

  const summary = {
    deletedPwdReset: pwdResetResult.rows.length,
    deletedEmailVerify: emailVerifyResult.rows.length,
    deletedTotpPending: totpPendingResult.rows.length,
    rollCacheRolledForward: rolledForward,
  };

  // Structured log for ops observability (Vercel Function logs / Datadog).
  console.log("[cron/maintenance]", JSON.stringify(summary));

  return Response.json({ ok: true, ...summary });
}
