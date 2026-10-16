import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { NormalizedEvent } from "../types";
import {
  retrieveBalanceTransaction,
  retrieveEvent,
  retrieveInvoiceForPayment,
} from "../providers/stripe/client";
import { ProviderError } from "../providers/stripe/errors";
import { normalize, NormalizeError } from "../providers/stripe/normalize";
import {
  applyConnectionStatus,
  applyGift,
  applyGiftFee,
  applyIntentExpired,
  applyReversal,
  applySettlement,
  applySubscription,
  claimEvent,
  finishEvent,
  type ClaimedEvent,
  type FinishOutcome,
} from "./functions";
import { aggregateOutcomes, finishCode, planAudits, type PartResult } from "./outcome";

/**
 * The ingest processor - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Webhook" -> "`processInboxEvent(inboxId)`". Runs from the webhook's `after()`
 * and from the 5-minute cron; the same code, because the webhook is allowed to
 * be cut off and nothing depends on `after()` finishing.
 *
 *   claim (2-minute lease)  ->  body (or re-fetch if purged)  ->  normalize
 *   ->  for each normalized event, in order, its apply function
 *   ->  one verdict (`aggregateOutcomes`)  ->  `finish_event`  ->  audit.
 *
 * THIS FUNCTION NEVER THROWS. It runs where nobody can catch it (an `after()`
 * callback, a cron loop), so every failure becomes a verdict instead: an
 * unexpected exception finishes the event `failed:exception` (back-off, dead
 * letter at attempt 8); a shape the normalizer refuses finishes it dead with a
 * short code the operator can read on the health page.
 *
 * It uses `db` only (no session, no org context) and reaches Stripe only through
 * three allowlisted reads - a balance transaction (the fee), an invoice (which
 * subscription a renewal belongs to) and, for a purged body, an event - each
 * named by an id taken from a CLAIMED, signed event. A number read from the
 * event body is never the source of fee data; a fund or membership read from
 * Stripe metadata is never used at all (R9).
 *
 * AUDIT. Route handlers and this module are outside `check:audit`'s scan, so
 * the audit rows below are the hand-audit (QA reads them): system acts
 * (`actor: null`) written AFTER `finish_event`, ids and counts only, from
 * `planAudits()`. The keys already exist in `AUDIT_ACTIONS`. A replayed
 * delivery is a `noop` and audits nothing.
 */

export interface ProcessResult {
  inboxId: string;
  /** False when the row was not claimable (taken by another worker, not due, or gone). */
  claimed: boolean;
  /** The event's new status from `finish_event`, when one was written. */
  status: string | null;
  verdict: FinishOutcome | null;
  parts: string[];
}

/** A reinstatement of a reversal we never recorded is given up on after this many attempts. */
const REINSTATEMENT_GRACE_ATTEMPTS = 4;

export async function processInboxEvent(inboxId: string): Promise<ProcessResult> {
  const result: ProcessResult = { inboxId, claimed: false, status: null, verdict: null, parts: [] };

  let claim: ClaimedEvent | null;
  try {
    claim = await claimEvent(inboxId);
  } catch (err) {
    logFailure("claim", inboxId, err);
    return result;
  }
  if (!claim) return result;
  result.claimed = true;

  let verdict: { outcome: FinishOutcome; code: string | null };
  let parts: PartResult[] = [];
  try {
    const run = await runClaimed(inboxId, claim);
    parts = run.parts;
    verdict = run.verdict;
  } catch (err) {
    logFailure("process", inboxId, err);
    verdict = { outcome: "failed", code: "exception" };
  }
  result.parts = parts.map((p) => p.outcome);
  result.verdict = verdict.outcome;

  let status: string;
  try {
    status = await finishEvent(inboxId, verdict.outcome, verdict.code);
  } catch (err) {
    // The lease (2 minutes) expires and the cron retries; nothing is lost.
    logFailure("finish", inboxId, err);
    return result;
  }
  result.status = status;

  if (status === "not_processing" || status === "not_found") return result;
  await writeAudits(inboxId, claim, parts, status, verdict.code);
  return result;
}

// ---------------------------------------------------------------------------

async function runClaimed(
  inboxId: string,
  claim: ClaimedEvent,
): Promise<{ parts: PartResult[]; verdict: { outcome: FinishOutcome; code: string | null } }> {
  let body = claim.rawBody;
  if (body === null) {
    // The stored body was purged (90 days after a terminal state). The claim
    // always names the event (`presby_giving_claim_event()` returns
    // `external_event_id`), so it is re-read from Stripe, through the allowlisted
    // `retrieveEvent`, using the id of a row we already hold.
    try {
      body = await retrieveEvent(claim.accountId, claim.externalEventId);
    } catch (err) {
      // Stripe keeps events for about 30 days; presby purges at 90. A body that
      // is gone from both places is final, not transient: dead-letter it with a
      // code that says why instead of walking the retry ladder.
      if (err instanceof ProviderError && err.code === "not_found") return dead("body_unavailable");
      return { parts: [], verdict: { outcome: "failed", code: failureCode(err) } };
    }
  }

  let events: NormalizedEvent[];
  try {
    events = normalize(body, { accountId: claim.accountId, livemode: claim.livemode });
  } catch (err) {
    if (err instanceof NormalizeError) return dead(`normalize_${err.code}`);
    throw err;
  }
  if (events.length === 0) {
    return { parts: [], verdict: { outcome: "ignored", code: "no_events" } };
  }

  const parts: PartResult[] = [];
  for (const event of events) {
    parts.push(await applyOne(inboxId, claim, event));
  }
  return { parts, verdict: aggregateOutcomes(parts.map((p) => p.outcome)) };
}

function dead(code: string) {
  return { parts: [] as PartResult[], verdict: { outcome: "dead" as const, code: finishCode(code) } };
}

/** One normalized event -> its apply function. Never throws; an exception is a `failed:*` part. */
async function applyOne(inboxId: string, claim: ClaimedEvent, event: NormalizedEvent): Promise<PartResult> {
  const part: PartResult = { kind: event.kind, outcome: "none" };
  try {
    switch (event.kind) {
      case "gift": {
        if (event.donor === null) {
          // invoice_payment.paid: learn the subscription and the donor from the
          // invoice (P3-9). A payment on an invoice with no subscription is not
          // a recurring gift of ours (a hand-made invoice): ignore, don't clutter.
          if (!event.invoiceId) {
            part.outcome = "dead:no_invoice";
            break;
          }
          const invoice = await retrieveInvoiceForPayment(claim.accountId, event.invoiceId);
          if (!invoice.subscriptionId) {
            part.outcome = "ignored:no_subscription_on_invoice";
            break;
          }
          part.outcome = await applyGift(inboxId, event, {
            subscriptionId: invoice.subscriptionId,
            donor: invoice.donor,
          });
        } else {
          part.outcome = await applyGift(inboxId, event, { subscriptionId: null, donor: null });
        }
        break;
      }
      case "gift_fee": {
        const txn = await retrieveBalanceTransaction(claim.accountId, event.balanceTransactionId);
        part.outcome = await applyGiftFee(inboxId, {
          paymentIntentId: event.paymentIntentId,
          feeCents: txn.feeCents,
          netCents: txn.netCents,
          method: event.method,
        });
        break;
      }
      case "reversal": {
        part.reversalKind = event.reversalKind;
        part.amountCents = event.amountCents;
        part.outcome = await applyReversal(inboxId, event);
        if (
          part.outcome === "parked:no_reversal" &&
          event.reversalKind === "reinstatement" &&
          claim.attempts >= REINSTATEMENT_GRACE_ATTEMPTS
        ) {
          // A refund that failed without ever having succeeded: nothing to offset.
          part.outcome = "ignored:no_reversal";
        }
        break;
      }
      case "subscription":
        part.outcome = await applySubscription(inboxId, event);
        break;
      case "intent_expired":
        part.outcome = await applyIntentExpired(inboxId, event.sessionId);
        break;
      case "settlement":
        part.outcome = await applySettlement(inboxId, event);
        break;
      case "connection_status":
        part.outcome = await applyConnectionStatus(inboxId, event);
        break;
    }
  } catch (err) {
    part.outcome = partOutcomeForError(err);
    logFailure(`apply:${event.kind}`, inboxId, err);
  }
  return part;
}

/** How a thrown error reads as a part outcome. Transient problems retry; shape problems do not. */
function partOutcomeForError(err: unknown): string {
  if (err instanceof ProviderError) {
    if (err.code === "bad_currency") return "ignored:not_usd";
    if (err.code === "bad_response" || err.code === "bad_origin") return "dead:stripe_bad_response";
    return `failed:${failureCode(err)}`;
  }
  return "failed:exception";
}

function failureCode(err: unknown): string {
  return err instanceof ProviderError ? `stripe_${err.code}` : "exception";
}

// ---------------------------------------------------------------------------
// audit (after finish_event; system actor; ids and counts only)
// ---------------------------------------------------------------------------

async function writeAudits(
  inboxId: string,
  claim: ClaimedEvent,
  parts: PartResult[],
  finalStatus: string,
  lastError: string | null,
): Promise<void> {
  const planned = planAudits(parts, finalStatus, lastError);
  for (const audit of planned) {
    const onEvent = audit.key === "GIVING_EVENT_DEAD_LETTERED";
    await recordAudit({
      action: AUDIT_ACTIONS[audit.key],
      actor: null,
      resourceType: onEvent ? "giving_provider_event" : "giving_provider_connection",
      resourceId: onEvent ? inboxId : claim.connectionId,
      metadata: {
        connectionId: claim.connectionId,
        inboxId,
        eventType: claim.eventType,
        organizationId: claim.organizationId,
        ...audit.metadata,
      },
    });
  }
}

/** Ids and error classes only - never a body, a name, an email or an amount. */
function logFailure(stage: string, inboxId: string, err: unknown): void {
  const detail = err instanceof ProviderError ? err.code : err instanceof Error ? err.name : "unknown";
  console.error("[giving/ingest] failed", { stage, inboxId, error: detail });
}
