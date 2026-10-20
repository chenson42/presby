/**
 * GET /api/cron/domains - the custom-domain sweeper (every five minutes; see
 * vercel.json). docs/work-log/2026-10-19-custom-domains.md, Phase 3 API
 * Contract section 6 (Cron), T6, T11; Phase 2 R8.
 *
 * What one tick does: lease the claim rows that are due (`next_check_at`,
 * `FOR UPDATE SKIP LOCKED`, a 10 minute lease), then run each claim through
 * the one check routine as the machine actor - the ownership-proof lookup, the
 * attach / probe / lapse / park / release steps, and the reconciliation of
 * `attach_pending` and `release_pending` (a due row whose idempotent provider
 * call is simply retried). Idempotent: Vercel may miss or duplicate a run and
 * nothing is lost or done twice. It has its own schedule and its own failure
 * domain, separate from `maintenance` and `email-queue`.
 *
 * Same shape as the other crons: `CRON_SECRET` unset is a 503 (a visible
 * failure in the Vercel cron dashboard rather than a silent no-op), a wrong
 * bearer is a 401, GET only. The bearer is compared in constant time.
 * `?limit=` (default 50, max 200) bounds the rows leased. A 50 second budget
 * stops NEW claims from starting; whatever is left is due on the next tick.
 *
 * It responds with COUNTS ONLY and logs the same: never a hostname, an error
 * message or provider text. It also logs the HOST CLASS the request arrived on
 * (platform / custom / invalid) - one line per invocation - because Vercel's
 * docs do not say which host a scheduled invocation uses (T6, the F148
 * ambiguity); the real-domain acceptance pass reads these lines.
 *
 * AUDIT IS DELEGATED (R8). This route writes nothing itself: every state change
 * goes through `transitionDomain()` in src/lib/domains/service.ts, which writes
 * the new state and EXACTLY ONE `audit_events` row in the same transaction
 * (machine transitions carry a null actor and `metadata.trigger = "cron"`).
 * `npm run check:audit` does not scan route handlers; the coverage proof is
 * src/lib/domains/service.db.test.ts and sweep.db.test.ts, one test per edge.
 *
 * Cross-org reads happen on the platform connection inside the service (this
 * is src/app/api/cron/, outside the `(org)` tree where `getPlatformDb()` is
 * forbidden; precedent: cron/maintenance).
 */

import { timingSafeEqual } from "node:crypto";
import { isPlatformHost, requestHost } from "@/lib/domains/host";
import { DOMAIN_POLICY } from "@/lib/domains/policy";
import { sweepDueDomains } from "@/lib/domains/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUDGET_MS = 50_000;

function bearerMatches(header: string | null, secret: string): boolean {
  if (header === null) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hostClass(req: Request): "platform" | "custom" | "invalid" {
  const host = requestHost(req.headers);
  if (host === null) return "invalid";
  return isPlatformHost(host) ? "platform" : "custom";
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Domains cron disabled: set CRON_SECRET to enable." }, { status: 503 });
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const raw = Number.parseInt(new URL(req.url).searchParams.get("limit") ?? "", 10);
  const limit = Math.min(
    Math.max(1, Number.isFinite(raw) ? raw : DOMAIN_POLICY.sweep.defaultLimit),
    DOMAIN_POLICY.sweep.maxLimit,
  );

  try {
    const summary = await sweepDueDomains({ limit, deadlineMs: Date.now() + BUDGET_MS });
    console.info("[cron/domains]", JSON.stringify({ hostClass: hostClass(req), ...summary }));
    return Response.json({ ok: true, ...summary });
  } catch {
    console.error("[cron/domains] failed");
    return Response.json({ error: "Internal server error." }, { status: 500 });
  }
}
