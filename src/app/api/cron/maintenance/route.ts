import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

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

  const summary = {
    deletedPwdReset: pwdResetResult.rows.length,
    deletedEmailVerify: emailVerifyResult.rows.length,
    deletedTotpPending: totpPendingResult.rows.length,
  };

  // Structured log for ops observability (Vercel Function logs / Datadog).
  console.log("[cron/maintenance]", JSON.stringify(summary));

  return Response.json({ ok: true, ...summary });
}
