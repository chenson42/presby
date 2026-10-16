/**
 * Harness for the DB-backed ingest suites (`ingest/*.db.test.ts`) - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 3a. TEST SUPPORT ONLY.
 *
 * It sits on `createGivingFixture()` (throwaway organizations stamped
 * `deletable_until`, torn down by one org delete) and adds what the webhook /
 * cron path needs: a connection WITH its account id, funds, checkout intents
 * written on the owner path, and `inbox()` - a real inbox row ingested through
 * `presby_giving_ingest_event()` and CLAIMED through `presby_giving_claim_event()`
 * on the `presby_app` connection, which is the only state the apply functions
 * act on (1a deviation D3).
 *
 * Reads go through the owner connection (it sees every table; `presby_app` has
 * no privilege on the inbox at all). Every database module is imported INSIDE
 * the functions (the calendar fixture's rule); the calling test must
 * `vi.mock("server-only")` itself.
 */
import { sql } from "drizzle-orm";
import { createGivingFixture, type ConnectionOptions } from "./giving-fixture";

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] =>
  Array.isArray(result) ? (result as Row[]) : (((result as { rows?: Row[] }).rows ?? []) as Row[]);

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** A uuid-shaped idempotency key (the intents CHECK wants one). */
const uuid = () => crypto.randomUUID();

export interface IntentOptions {
  organizationId: string;
  connectionId: string;
  fundId: string;
  sessionId?: string | null;
  frequency?: "once" | "monthly";
  totalCents?: number;
  coveredFeeCents?: number;
  coverFees?: boolean;
  status?: "created" | "open" | "completed" | "expired" | "failed";
  membershipId?: string | null;
  donorId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  livemode?: boolean;
}

export async function createIngestHarness(label: string) {
  const fx = await createGivingFixture(label);
  const { platform } = fx;
  const functions = await import("@/lib/giving/ingest/functions");

  /** A fixture congregation with a connection (default: active, public, TEST mode) and one online fund. */
  async function org(
    name: string,
    options: Parameters<typeof fx.makeOrg>[1] & { connection?: ConnectionOptions & { none?: boolean } } = {},
  ) {
    const organizationId = await fx.makeOrg(name, options);
    const fundId = await fx.makeFund(organizationId, "General Fund", { offeredOnline: true });
    if (options.connection?.none) return { organizationId, fundId, connectionId: "", accountId: "" };
    const connectionId = await fx.makeConnection(organizationId, { livemode: false, ...options.connection });
    const accountId = String(
      rowsOf(await platform.execute(sql`select external_account_id from giving_provider_connections where id = ${connectionId}`))[0]!
        .external_account_id,
    );
    return { organizationId, fundId, connectionId, accountId };
  }

  async function intent(options: IntentOptions): Promise<string> {
    const total = options.totalCents ?? 5000;
    const covered = options.coveredFeeCents ?? 0;
    const result = await platform.execute(sql`
      insert into giving_checkout_intents (organization_id, connection_id, fund_id, membership_id, donor_id,
             frequency, method_choice, cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents,
             livemode, idempotency_key, status, checkout_session_id, subscription_id, customer_id, expires_at)
      values (${options.organizationId}, ${options.connectionId}, ${options.fundId}, ${options.membershipId ?? null},
              ${options.donorId ?? null}, ${options.frequency ?? "once"}, 'card',
              ${options.coverFees ?? covered > 0}, ${total - covered}, ${covered}, ${total},
              ${options.livemode ?? false}, ${uuid()}, ${options.status ?? "open"},
              ${options.sessionId === undefined ? `cs_fixture${unique()}` : options.sessionId},
              ${options.subscriptionId ?? null}, ${options.customerId ?? null}, now() + interval '1 day')
      returning id`);
    return String(rowsOf(result)[0]!.id);
  }

  /** Ingests a (synthetic) event body for `accountId` and CLAIMS it: the state the apply functions act on. */
  async function inbox(
    accountId: string,
    options: { type?: string; livemode?: boolean; body?: string; eventId?: string } = {},
  ): Promise<string> {
    const eventId = options.eventId ?? `evt_fixture${unique()}`;
    const ingested = await functions.ingestEvent({
      account: accountId,
      eventId,
      livemode: options.livemode ?? false,
      eventType: options.type ?? "checkout.session.completed",
      rawBody: options.body ?? JSON.stringify({ id: eventId, fixture: true }),
    });
    if (ingested.outcome !== "accepted" || !ingested.inboxId) {
      throw new Error(`[ingest harness] expected an accepted event, got ${ingested.outcome}`);
    }
    const claimed = await functions.claimEvent(ingested.inboxId);
    if (!claimed) throw new Error("[ingest harness] the event was not claimable");
    return ingested.inboxId;
  }

  const gifts = async (organizationId: string) =>
    rowsOf(await platform.execute(sql`
      select id, status, amount_cents, donor_covered_fee_cents, fee_cents, net_cents, method, fund_id, donor_id,
             intent_id, external_transaction_id, occurred_on::text as occurred_on, livemode, failure_code
        from giving_gifts where organization_id = ${organizationId} order by created_at, id`));

  const giftByPi = async (organizationId: string, paymentIntentId: string) =>
    (await gifts(organizationId)).find((g) => g.external_transaction_id === paymentIntentId);

  const reversals = async (organizationId: string) =>
    rowsOf(await platform.execute(sql`
      select id, gift_id, kind, amount_cents, external_reversal_id, offsets_reversal_id, occurred_on::text as occurred_on
        from giving_gift_reversals where organization_id = ${organizationId} order by created_at, id`));

  const donors = async (organizationId: string) =>
    rowsOf(await platform.execute(sql`
      select id, display_name, email, kind, merged_into_id, linked_membership_id, link_source, city
        from giving_donors where organization_id = ${organizationId} order by created_at, id`));

  const identities = async (organizationId: string) =>
    rowsOf(await platform.execute(sql`
      select donor_id, external_customer_id from giving_donor_identities where organization_id = ${organizationId}`));

  const intentRow = async (intentId: string) =>
    rowsOf(await platform.execute(sql`select * from giving_checkout_intents where id = ${intentId}`))[0]!;

  const eventRow = async (inboxId: string) =>
    rowsOf(await platform.execute(sql`
      select id, status, attempts, last_error, processed_at, locked_until, next_attempt_at, received_at, raw_body,
             body_purged_at, event_type, livemode from giving_provider_events where id = ${inboxId}`))[0]!;

  const events = async (organizationId: string) =>
    rowsOf(await platform.execute(sql`
      select id, external_event_id, status, last_error from giving_provider_events
       where organization_id = ${organizationId} order by received_at, id`));

  const connectionRow = async (connectionId: string) =>
    rowsOf(await platform.execute(sql`select * from giving_provider_connections where id = ${connectionId}`))[0]!;

  const settlements = async (organizationId: string) =>
    rowsOf(await platform.execute(sql`
      select external_settlement_id, status, gross_cents, automatic, arrival_date::text as arrival_date
        from giving_settlements where organization_id = ${organizationId}`));

  /** Runs SQL as the owner (back-dating a received_at, expiring a lease). */
  const owner = (query: ReturnType<typeof sql>) => platform.execute(query);

  return {
    ...fx,
    functions,
    org,
    intent,
    inbox,
    gifts,
    giftByPi,
    reversals,
    donors,
    identities,
    intentRow,
    eventRow,
    events,
    connectionRow,
    settlements,
    owner,
    unique,
    rowsOf,
  };
}

export type IngestHarness = Awaited<ReturnType<typeof createIngestHarness>>;

/** `pi_fixture...`-style ids matching the database's shape checks. */
export const fixtureIds = {
  pi: () => `pi_fixture${unique()}`,
  session: () => `cs_fixture${unique()}`,
  subscription: () => `sub_fixture${unique()}`,
  customer: () => `cus_fixture${unique()}`,
  invoice: () => `in_fixture${unique()}`,
  refund: () => `re_fixture${unique()}`,
  dispute: () => `dp_fixture${unique()}`,
  payout: () => `po_fixture${unique()}`,
};
