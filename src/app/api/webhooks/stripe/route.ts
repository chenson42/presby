/**
 * POST /api/webhooks/stripe - Stripe Connect event receiver.
 * docs/work-log/2026-10-15-online-giving.md, Phase 3 "Webhook".
 *
 * One endpoint for every connected congregation (scope: Connected accounts,
 * API version pinned - docs/deployment.md). The event's top-level `account`
 * says which congregation; the SIGNATURE is the only credential - `/api/*`
 * falls through `src/proxy.ts` without a session check, exactly like the Resend
 * webhook. No session, no `withOrgContext`: the route verifies, stores the raw
 * body through `presby_giving_ingest_event()` (a SECURITY DEFINER function that
 * takes no org id and derives the congregation from the connection row) and
 * hands processing to `after()` and the 5-minute cron.
 *
 * Response contract (money, so it differs from Resend's fail-open: an unset
 * secret is a 503 and Stripe retries, amending DECISION-028 r3):
 *
 *   STRIPE_WEBHOOK_SECRET unset                       503 { error: "Webhook not configured." }
 *   no Stripe-Signature header                        400 { error: "Missing webhook headers." }
 *   bad / stale signature, or not an event            400 { error: "Invalid webhook signature." }
 *   platform-scope event (no top-level `account`)     200 { received: true, handled: false }
 *   event type we are not subscribed to               200 { received: true, handled: false }
 *   ingest function throws (DB down)                  500 { error: "Internal server error." }
 *   accepted | duplicate | ignored                    200 { received: true }   <- ONE identical body
 *
 * The last row is deliberate: whether the account is one of ours, whether the
 * mode matches, and whether the event was seen before must not be learnable
 * from the response - not that an attacker without the signing secret can get
 * this far, but the endpoint must not become an oracle for tenancy if one ever
 * does. Unknown account and `livemode` mismatch are `ignored` inside the
 * database function and look exactly like a success.
 *
 * LOGGING. Event id and type only; never the body, never an account id, never a
 * donor field. AUDIT. The route itself is informational (nothing security-
 * sensitive happens at receipt) and writes no audit row; the processor audits
 * what it applies (`ingest/process.ts`, hand-audited - `check:audit` scans
 * only `actions.ts`).
 */

import { after, NextResponse } from "next/server";
import { ingestEvent } from "@/lib/giving/ingest/functions";
import { processInboxEvent } from "@/lib/giving/ingest/process";
import { verifyWebhook } from "@/lib/giving/providers/stripe/client";
import { isHandledEventType } from "@/lib/giving/providers/stripe/constants";
import { ProviderError } from "@/lib/giving/providers/stripe/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!(process.env.STRIPE_WEBHOOK_SECRET ?? "").trim()) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing webhook headers." }, { status: 400 });
  }

  // The RAW text: the HMAC is over these exact bytes, and the same bytes are what
  // we store so a replay verifies against what Stripe actually sent.
  const rawBody = await req.text();

  let event: ReturnType<typeof verifyWebhook>;
  try {
    event = verifyWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
    }
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  if (event.account === null || !isHandledEventType(event.type)) {
    return NextResponse.json({ received: true, handled: false });
  }

  let inboxId: string | null = null;
  let outcome: string;
  try {
    const ingested = await ingestEvent({
      account: event.account,
      eventId: event.id,
      livemode: event.livemode,
      eventType: event.type,
      rawBody,
    });
    outcome = ingested.outcome;
    inboxId = ingested.inboxId;
  } catch {
    // Stripe retries a 5xx with back-off (DECISION-028 r5). No body, no stack.
    console.error("[webhook/stripe] ingest failed", { id: event.id, type: event.type });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }

  console.info("[webhook/stripe] received", { id: event.id, type: event.type });

  if (outcome === "accepted" && inboxId) {
    const id = inboxId;
    // processInboxEvent never throws; if the function is cut off the event stays
    // `received` and the cron claims it once nothing holds the lease.
    after(() => processInboxEvent(id));
  }

  return NextResponse.json({ received: true });
}
