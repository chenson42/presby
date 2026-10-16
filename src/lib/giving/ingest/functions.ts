import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "../db-util";
import type { DonorDetails, NormalizedEvent } from "../types";

/**
 * The webhook / cron path's ONLY door into the database - docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Webhook" and "Cron", DECISION-147
 * shape. Every call is a SECURITY DEFINER function (`drizzle/0055`, section 17)
 * on the `db` connection (`presby_app`, RLS enforced): there is NO session, NO
 * `withOrgContext`, NO org id argument anywhere in this file. Each function
 * derives the organization itself - from the inbox row, then the connection row
 * - which is why a forged or confused caller cannot steer a write into another
 * tenant. `giving_provider_events` has no `presby_app` privilege at all; this
 * file cannot read it, only claim a row through `presby_giving_claim_event()`.
 *
 * `check:giving-boundaries` B3 keeps `getPlatformDb()` and the owner connection
 * strings out of this directory. The two owner-only functions (health,
 * requeue) are NOT here; they live in `src/lib/admin/giving-ingest-health.ts`.
 *
 * Return vocabulary of the apply functions (1a notes, "For B3"):
 *   applied | applied:autolinked | applied:link_conflict | applied:status_changed
 *   | applied:disconnected | noop | none
 *   | parked:<code> | ignored:<code> | dead:<code>
 */

export type IngestOutcome = "accepted" | "duplicate" | "ignored";

/** Result of a failed-or-finished event as the processor reports it to `finishEvent`. */
export type FinishOutcome = "applied" | "ignored" | "parked" | "failed" | "dead";

async function first(query: ReturnType<typeof sql>): Promise<Record<string, unknown> | undefined> {
  return rowsOf(await db.execute(query))[0];
}

// ---- ingest (the route) -----------------------------------------------------

export async function ingestEvent(input: {
  account: string;
  eventId: string;
  livemode: boolean;
  eventType: string;
  rawBody: string;
}): Promise<{ outcome: IngestOutcome; inboxId: string | null }> {
  const row = await first(sql`
    select outcome, inbox_id from presby_giving_ingest_event(
      'stripe'::giving_provider, ${input.account}::text, ${input.eventId}::text,
      ${input.livemode}::boolean, ${input.eventType}::text, ${input.rawBody}::text)`);
  const outcome = String(row?.outcome ?? "ignored");
  return {
    outcome: outcome === "accepted" || outcome === "duplicate" ? outcome : "ignored",
    inboxId: row?.inbox_id ? String(row.inbox_id) : null,
  };
}

// ---- claim / finish / due ---------------------------------------------------

export interface ClaimedEvent {
  rawBody: string | null;
  eventType: string;
  attempts: number;
  bodyPurged: boolean;
  connectionId: string;
  accountId: string;
  livemode: boolean;
  /**
   * Not returned by `presby_giving_claim_event()` today. Read if a future
   * correction of 0055 adds them: `externalEventId` lets a purged body be
   * re-fetched (`retrieveEvent`), `organizationId` completes the audit rows.
   */
  externalEventId?: string;
  organizationId?: string;
}

/** Claims one due event (sets a 2-minute lease), or `null` when it is not claimable. */
export async function claimEvent(inboxId: string): Promise<ClaimedEvent | null> {
  const row = await first(sql`select * from presby_giving_claim_event(${inboxId}::uuid)`);
  if (!row) return null;
  return {
    rawBody: typeof row.raw_body === "string" ? row.raw_body : null,
    eventType: String(row.event_type),
    attempts: Number(row.attempts),
    bodyPurged: row.body_purged === true,
    connectionId: String(row.connection_id),
    accountId: String(row.external_account_id),
    livemode: row.livemode === true,
    ...(typeof row.external_event_id === "string" ? { externalEventId: row.external_event_id } : {}),
    ...(typeof row.organization_id === "string" ? { organizationId: row.organization_id } : {}),
  };
}

/** Returns the event's new status (`applied`, `ignored`, `parked`, `dead_letter`) or `not_processing` / `not_found`. */
export async function finishEvent(inboxId: string, outcome: FinishOutcome, code: string | null): Promise<string> {
  const row = await first(sql`
    select presby_giving_finish_event(${inboxId}::uuid, ${outcome}::text, ${code}::text) as status`);
  return String(row?.status ?? "not_found");
}

export async function dueEvents(limit: number): Promise<string[]> {
  const rows = rowsOf(await db.execute(sql`select inbox_id from presby_giving_due_events(${limit}::integer)`));
  return rows.map((r) => String(r.inbox_id));
}

// ---- apply (each acts only on a claimed `processing` row - D3) --------------

async function outcomeOf(query: ReturnType<typeof sql>): Promise<string> {
  const row = await first(query);
  return String(row?.outcome ?? "none");
}

/**
 * Postgres text cannot hold a NUL (`22021 invalid byte sequence`), and a JSON
 * string from the provider CAN decode to one (`"\u0000"`). Left alone, a donor
 * who typed one would make every attempt at the gift throw and the event would
 * walk to the dead-letter queue over a name. Stripped here, once, for every
 * provider-supplied string on its way into an apply function; the SQL cleaners
 * then bound and de-control the rest.
 */
const t = (value: string | null | undefined): string | null =>
  typeof value === "string" ? value.replace(/\u0000/g, "") : null;

const NO_ADDRESS: DonorDetails["address"] = {
  line1: null,
  line2: null,
  city: null,
  region: null,
  postal: null,
  country: null,
};

export async function applyGift(
  inboxId: string,
  gift: Extract<NormalizedEvent, { kind: "gift" }>,
  completion: { subscriptionId: string | null; donor: DonorDetails | null },
): Promise<string> {
  const donor = completion.donor ?? gift.donor;
  const a = donor?.address ?? NO_ADDRESS;
  return outcomeOf(sql`
    select presby_giving_apply_gift(
      ${inboxId}::uuid, ${gift.status}::text, ${gift.sessionId}::text, ${completion.subscriptionId ?? gift.subscriptionId}::text,
      ${gift.invoiceId}::text, ${gift.paymentIntentId}::text, ${gift.amountCents}::integer,
      ${gift.authorizedAt}::timestamptz, ${t(gift.failureCode)}::text,
      ${t(donor?.externalCustomerId) || null}::text, ${t(donor?.name)}::text, ${t(donor?.email)}::text,
      ${t(a.line1)}::text, ${t(a.line2)}::text, ${t(a.city)}::text, ${t(a.region)}::text, ${t(a.postal)}::text, ${t(a.country)}::text,
      ${gift.method}::text) as outcome`);
}

export async function applyGiftFee(
  inboxId: string,
  input: { paymentIntentId: string; feeCents: number; netCents: number; method: string | null },
): Promise<string> {
  return outcomeOf(sql`
    select presby_giving_apply_gift_fee(
      ${inboxId}::uuid, ${input.paymentIntentId}::text, ${input.feeCents}::integer,
      ${input.netCents}::integer, ${input.method}::text) as outcome`);
}

export async function applyReversal(
  inboxId: string,
  reversal: Extract<NormalizedEvent, { kind: "reversal" }>,
): Promise<string> {
  return outcomeOf(sql`
    select presby_giving_apply_reversal(
      ${inboxId}::uuid, ${reversal.paymentIntentId}::text, ${reversal.reversalKind}::text,
      ${reversal.externalReversalId}::text, ${reversal.amountCents}::integer,
      ${reversal.occurredAt}::timestamptz, ${reversal.offsetsExternalReversalId}::text) as outcome`);
}

export async function applySubscription(
  inboxId: string,
  event: Extract<NormalizedEvent, { kind: "subscription" }>,
): Promise<string> {
  const d = event.donor;
  const a = d?.address ?? NO_ADDRESS;
  return outcomeOf(sql`
    select presby_giving_apply_subscription(
      ${inboxId}::uuid, ${event.action}::text, ${event.sessionId}::text, ${event.subscriptionId}::text,
      ${t(d?.externalCustomerId) || null}::text, ${t(d?.name)}::text, ${t(d?.email)}::text,
      ${t(a.line1)}::text, ${t(a.line2)}::text, ${t(a.city)}::text, ${t(a.region)}::text, ${t(a.postal)}::text, ${t(a.country)}::text,
      ${event.at}::timestamptz) as outcome`);
}

export async function applyIntentExpired(inboxId: string, sessionId: string): Promise<string> {
  return outcomeOf(sql`select presby_giving_apply_intent_expired(${inboxId}::uuid, ${sessionId}::text) as outcome`);
}

export async function applySettlement(
  inboxId: string,
  event: Extract<NormalizedEvent, { kind: "settlement" }>,
): Promise<string> {
  return outcomeOf(sql`
    select presby_giving_apply_settlement(
      ${inboxId}::uuid, ${event.externalSettlementId}::text, ${event.status}::text,
      ${event.arrivalDate}::date, ${event.grossCents}::bigint, ${event.automatic}::boolean) as outcome`);
}

export async function applyConnectionStatus(
  inboxId: string,
  event: Extract<NormalizedEvent, { kind: "connection_status" }>,
): Promise<string> {
  const s = event.status;
  return outcomeOf(sql`
    select presby_giving_apply_connection_status(
      ${inboxId}::uuid, ${s.chargesEnabled}::boolean, ${s.payoutsEnabled}::boolean, ${s.detailsSubmitted}::boolean,
      ${s.cardEnabled}::boolean, ${s.achEnabled}::boolean, ${s.requirementsDue}::boolean,
      ${s.disabledReason}::text, ${event.deauthorized}::boolean) as outcome`);
}

// ---- cron maintenance --------------------------------------------------------

export async function purgeBodies(): Promise<number> {
  const row = await first(sql`select presby_giving_purge_bodies() as n`);
  return Number(row?.n ?? 0);
}

export async function expireIntents(): Promise<number> {
  const row = await first(sql`select presby_giving_expire_intents() as n`);
  return Number(row?.n ?? 0);
}
