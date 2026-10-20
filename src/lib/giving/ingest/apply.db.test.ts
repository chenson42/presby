/**
 * The apply functions, through the REAL SECURITY DEFINER functions on the
 * `presby_app` connection - docs/work-log/2026-10-15-online-giving.md, Batch 3a.
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/ingest/apply.db.test.ts
 *
 * Every case builds a fixture congregation, a connection, a checkout intent,
 * and a CLAIMED inbox row, calls an apply function exactly as `process.ts`
 * does, and asserts on the outcome string AND on the rows (read through the
 * owner connection). Cleanup is the organization delete.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { DonorDetails, NormalizedEvent } from "@/lib/giving/types";
import type { IngestHarness } from "@/lib/testing/giving-ingest-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Gift = Extract<NormalizedEvent, { kind: "gift" }>;
type Reversal = Extract<NormalizedEvent, { kind: "reversal" }>;
type Subscription = Extract<NormalizedEvent, { kind: "subscription" }>;

const NOON_UTC = new Date("2026-10-14T16:00:00Z");

function donorDetails(overrides: Partial<DonorDetails> = {}): DonorDetails {
  return {
    externalCustomerId: "",
    name: "Pat Fixture",
    email: "pat.fixture@example.invalid",
    address: { line1: "1 Fixture Way", line2: null, city: "Faketown", region: "OH", postal: "00000", country: "US" },
    ...overrides,
  };
}

describe.skipIf(!hasDb)("ingest apply functions (Postgres-backed)", () => {
  let h: IngestHarness;
  let ids: typeof import("@/lib/testing/giving-ingest-fixture").fixtureIds;
  let fns: typeof import("@/lib/giving/ingest/functions");

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-ingest-fixture");
    h = await mod.createIngestHarness("ingest-apply");
    ids = mod.fixtureIds;
    fns = h.functions;
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const gift = (o: Partial<Gift> & { sessionId?: string | null; paymentIntentId: string }): Gift => ({
    kind: "gift",
    status: "succeeded",
    sessionId: null,
    subscriptionId: null,
    invoiceId: null,
    amountCents: 5000,
    authorizedAt: NOON_UTC,
    failureCode: null,
    method: "card",
    donor: donorDetails({ externalCustomerId: ids.customer() }),
    ...o,
  });
  const apply = (inboxId: string, event: Gift, completion: { subscriptionId?: string | null; donor?: DonorDetails | null } = {}) =>
    fns.applyGift(inboxId, event, { subscriptionId: completion.subscriptionId ?? null, donor: completion.donor ?? null });
  const reversal = (o: Partial<Reversal> & { paymentIntentId: string; externalReversalId: string }): Reversal => ({
    kind: "reversal",
    reversalKind: "refund",
    amountCents: 1000,
    occurredAt: NOON_UTC,
    offsetsExternalReversalId: null,
    ...o,
  });

  /** An org + connection + intent + a first gift already applied; returns what later cases need. */
  async function paidGift(options: { amount?: number; livemode?: boolean } = {}) {
    const o = await h.org(`pay-${h.unique()}`);
    const sessionId = ids.session();
    const pi = ids.pi();
    await h.intent({ ...o, sessionId, totalCents: options.amount ?? 5000 });
    const inbox = await h.inbox(o.accountId);
    expect(await apply(inbox, gift({ sessionId, paymentIntentId: pi, amountCents: options.amount ?? 5000 }))).toBe("applied");
    return { ...o, sessionId, pi };
  }

  // -------------------------------------------------------------------------
  describe("apply_gift", () => {
    it("records the gift against the INTENT's fund, resolves a new donor, completes the intent", async () => {
      const o = await h.org("gift-basic");
      const sessionId = ids.session();
      const pi = ids.pi();
      const intentId = await h.intent({ ...o, sessionId, totalCents: 5181, coveredFeeCents: 181 });
      const inbox = await h.inbox(o.accountId);
      const customer = ids.customer();
      const result = await apply(inbox, gift({ sessionId, paymentIntentId: pi, amountCents: 5181, donor: donorDetails({ externalCustomerId: customer }) }));
      expect(result).toBe("applied");

      const row = await h.giftByPi(o.organizationId, pi);
      expect(row).toMatchObject({
        status: "succeeded",
        amount_cents: 5181,
        donor_covered_fee_cents: 181,
        fund_id: o.fundId,
        intent_id: intentId,
        method: "card",
        livemode: false, // the CONNECTION is test mode, so the gift is excluded from every total
      });
      const donors = await h.donors(o.organizationId);
      expect(donors).toHaveLength(1);
      expect(donors[0]).toMatchObject({ display_name: "Pat Fixture", email: "pat.fixture@example.invalid", kind: "identified", city: "Faketown" });
      expect(await h.identities(o.organizationId)).toEqual([{ donor_id: donors[0]!.id, external_customer_id: customer }]);
      expect(await h.intentRow(intentId)).toMatchObject({ status: "completed", payment_intent_id: pi, donor_id: donors[0]!.id });
    });

    it("a live-mode connection records a LIVE gift", async () => {
      const o = await h.org("gift-live", { connection: { livemode: true } });
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId, livemode: true });
      const inbox = await h.inbox(o.accountId, { livemode: true });
      expect(await apply(inbox, gift({ sessionId, paymentIntentId: pi }))).toBe("applied");
      expect((await h.giftByPi(o.organizationId, pi))!.livemode).toBe(true);
    });

    it("is idempotent: a second delivery of the same payment is a noop and writes nothing", async () => {
      const g = await paidGift();
      const again = await h.inbox(g.accountId);
      expect(await apply(again, gift({ sessionId: g.sessionId, paymentIntentId: g.pi }))).toBe("noop");
      expect(await h.gifts(g.organizationId)).toHaveLength(1);
      expect(await h.donors(g.organizationId)).toHaveLength(1);
    });

    it("a session id the connection does not own is ignored: no intent, no gift (R9)", async () => {
      const a = await h.org("gift-foreign-a");
      const b = await h.org("gift-foreign-b");
      const sessionId = ids.session();
      await h.intent({ ...b, sessionId }); // org B's intent
      const inbox = await h.inbox(a.accountId); // org A's connection receives the event
      expect(await apply(inbox, gift({ sessionId, paymentIntentId: ids.pi() }))).toBe("ignored:no_intent");
      expect(await h.gifts(a.organizationId)).toHaveLength(0);
      expect(await h.gifts(b.organizationId)).toHaveLength(0);
    });

    it("a payment with no intent at all is ignored", async () => {
      const o = await h.org("gift-nointent");
      const inbox = await h.inbox(o.accountId);
      expect(await apply(inbox, gift({ sessionId: ids.session(), paymentIntentId: ids.pi() }))).toBe("ignored:no_intent");
      expect(await h.gifts(o.organizationId)).toHaveLength(0);
    });

    it("the fund comes from the intent: nothing in the event can name another (the event has no fund field)", async () => {
      const o = await h.org("gift-fund");
      await h.makeFund(o.organizationId, "Other Online Fund", { offeredOnline: true }); // a second fund the event could try to name
      const sessionId = ids.session();
      await h.intent({ ...o, sessionId });
      const inbox = await h.inbox(o.accountId);
      const event = gift({ sessionId, paymentIntentId: ids.pi() }) as Gift & { fundId?: string };
      event.fundId = "99999999-9999-4999-8999-999999999999"; // ignored: the function has no such parameter
      expect(await apply(inbox, event)).toBe("applied");
      expect((await h.gifts(o.organizationId))[0]!.fund_id).toBe(o.fundId);
    });

    it("dead:amount_mismatch when the first payment differs from the intent total (a tamper signal); nothing recorded", async () => {
      const o = await h.org("gift-amount");
      const sessionId = ids.session();
      await h.intent({ ...o, sessionId, totalCents: 5000 });
      const inbox = await h.inbox(o.accountId);
      expect(await apply(inbox, gift({ sessionId, paymentIntentId: ids.pi(), amountCents: 4999 }))).toBe("dead:amount_mismatch");
      expect(await h.gifts(o.organizationId)).toHaveLength(0);
    });

    it("dead:mode_mismatch when a payment-mode event names a monthly intent", async () => {
      const o = await h.org("gift-mode");
      const sessionId = ids.session();
      await h.intent({ ...o, sessionId, frequency: "monthly" });
      const inbox = await h.inbox(o.accountId);
      expect(await apply(inbox, gift({ sessionId, paymentIntentId: ids.pi() }))).toBe("dead:mode_mismatch");
    });

    it("dead:intent_mismatch when the same PaymentIntent arrives under a different intent", async () => {
      const g = await paidGift();
      const second = ids.session();
      await h.intent({ organizationId: g.organizationId, connectionId: g.connectionId, fundId: g.fundId, sessionId: second });
      const inbox = await h.inbox(g.accountId);
      expect(await apply(inbox, gift({ sessionId: second, paymentIntentId: g.pi }))).toBe("dead:intent_mismatch");
    });

    it("rejects malformed provider values with a dead code, writing nothing", async () => {
      const o = await h.org("gift-dead");
      const sessionId = ids.session();
      await h.intent({ ...o, sessionId });
      const cases: Array<[Partial<Gift>, string]> = [
        [{ paymentIntentId: "pi_x" }, "dead:bad_payment_intent"],
        [{ paymentIntentId: ids.pi(), amountCents: 0 }, "dead:bad_amount"],
        [{ paymentIntentId: ids.pi(), amountCents: 100_000_001 }, "dead:bad_amount"],
        [{ paymentIntentId: ids.pi(), status: "bogus" as never }, "dead:bad_status"],
      ];
      for (const [overrides, expected] of cases) {
        const inbox = await h.inbox(o.accountId);
        expect(await apply(inbox, gift({ sessionId, paymentIntentId: ids.pi(), ...overrides }))).toBe(expected);
      }
      const noReference = await h.inbox(o.accountId);
      expect(await apply(noReference, gift({ sessionId: null, paymentIntentId: ids.pi() }))).toBe("dead:no_reference");
      expect(await h.gifts(o.organizationId)).toHaveLength(0);
    });

    it("acts only on a CLAIMED row (D3): an unclaimed or finished event is ignored:not_claimed", async () => {
      const o = await h.org("gift-claim");
      const sessionId = ids.session();
      await h.intent({ ...o, sessionId });
      const ingested = await fns.ingestEvent({ account: o.accountId, eventId: `evt_fixture${h.unique()}`, livemode: false, eventType: "x.y", rawBody: "{}" });
      // received, never claimed
      expect(await apply(ingested.inboxId!, gift({ sessionId, paymentIntentId: ids.pi() }))).toBe("ignored:not_claimed");
      // claimed, then finished
      const claimed = await h.inbox(o.accountId);
      await fns.finishEvent(claimed, "applied", null);
      expect(await apply(claimed, gift({ sessionId, paymentIntentId: ids.pi() }))).toBe("ignored:not_claimed");
      // an inbox id that does not exist
      expect(await apply("00000000-0000-4000-8000-00000000dead", gift({ sessionId, paymentIntentId: ids.pi() }))).toBe("ignored:no_event");
      expect(await h.gifts(o.organizationId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("gift status is one-way (pending -> succeeded | failed)", () => {
    async function pendingGift() {
      const o = await h.org(`status-${h.unique()}`);
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId, totalCents: 10000 });
      const inbox = await h.inbox(o.accountId);
      expect(await apply(inbox, gift({ sessionId, paymentIntentId: pi, amountCents: 10000, status: "pending", method: "us_bank_account" }))).toBe("applied");
      return { ...o, sessionId, pi };
    }
    const status = async (g: { organizationId: string; pi: string }) => (await h.giftByPi(g.organizationId, g.pi))!.status;
    const send = async (g: { accountId: string; sessionId: string; pi: string }, s: Gift["status"], failureCode: string | null = null) =>
      apply(await h.inbox(g.accountId), gift({ sessionId: g.sessionId, paymentIntentId: g.pi, amountCents: 10000, status: s, failureCode, method: "us_bank_account" }));

    it("pending -> succeeded applies; a late 'pending' afterwards is a noop; succeeded -> failed is illegal", async () => {
      const g = await pendingGift();
      expect(await send(g, "succeeded")).toBe("applied");
      expect(await status(g)).toBe("succeeded");
      expect(await send(g, "pending")).toBe("noop");
      expect(await send(g, "succeeded")).toBe("noop");
      expect(await send(g, "failed")).toBe("dead:illegal_transition");
      expect(await status(g)).toBe("succeeded");
    });

    it("pending -> failed applies and keeps a clean failure code; failed -> succeeded is illegal", async () => {
      const g = await pendingGift();
      expect(await send(g, "failed", "async_payment_failed")).toBe("applied");
      const row = await h.giftByPi(g.organizationId, g.pi);
      expect(row).toMatchObject({ status: "failed", failure_code: "async_payment_failed" });
      expect(await send(g, "succeeded")).toBe("dead:illegal_transition");
      expect(await status(g)).toBe("failed");
    });

    it("a first-seen FAILED payment (no earlier pending) is recorded as a failed gift", async () => {
      const o = await h.org("status-failed-first");
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId, totalCents: 10000 });
      const inbox = await h.inbox(o.accountId);
      expect(await apply(inbox, gift({ sessionId, paymentIntentId: pi, amountCents: 10000, status: "failed", failureCode: "async_payment_failed" }))).toBe("applied");
      expect(await status({ organizationId: o.organizationId, pi })).toBe("failed");
    });
  });

  // -------------------------------------------------------------------------
  describe("apply_gift_fee: set once, from the processor's balance-transaction numbers", () => {
    const fee = (inbox: string, pi: string, feeCents: number, netCents: number, method: string | null = "card") =>
      fns.applyGiftFee(inbox, { paymentIntentId: pi, feeCents, netCents, method });

    it("parks when the gift is not there yet, then applies once, and a repeat is a noop", async () => {
      const o = await h.org("fee-order");
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId });
      expect(await fee(await h.inbox(o.accountId), pi, 175, 4825)).toBe("parked:no_gift");
      expect(await apply(await h.inbox(o.accountId), gift({ sessionId, paymentIntentId: pi }))).toBe("applied");
      expect(await fee(await h.inbox(o.accountId), pi, 175, 4825)).toBe("applied");
      expect(await h.giftByPi(o.organizationId, pi)).toMatchObject({ fee_cents: 175, net_cents: 4825 });
      expect(await fee(await h.inbox(o.accountId), pi, 175, 4825)).toBe("noop");
    });

    it("a DIFFERENT fee later is a conflict, never an overwrite", async () => {
      const g = await paidGift();
      expect(await fee(await h.inbox(g.accountId), g.pi, 175, 4825)).toBe("applied");
      expect(await fee(await h.inbox(g.accountId), g.pi, 200, 4800)).toBe("dead:fee_conflict");
      expect((await h.giftByPi(g.organizationId, g.pi))!.fee_cents).toBe(175);
    });

    it("net must equal amount - fee, and a fee cannot be negative or null", async () => {
      const g = await paidGift();
      expect(await fee(await h.inbox(g.accountId), g.pi, 175, 4000)).toBe("dead:fee_mismatch");
      expect(await fee(await h.inbox(g.accountId), g.pi, -1, 5001)).toBe("dead:fee_mismatch");
      expect((await h.giftByPi(g.organizationId, g.pi))!.fee_cents).toBeNull();
    });

    it("fills the method only if the gift had none", async () => {
      const o = await h.org("fee-method");
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId });
      expect(await apply(await h.inbox(o.accountId), gift({ sessionId, paymentIntentId: pi, method: null }))).toBe("applied");
      expect((await h.giftByPi(o.organizationId, pi))!.method).toBeNull();
      expect(await fee(await h.inbox(o.accountId), pi, 175, 4825, "wallet")).toBe("applied");
      expect((await h.giftByPi(o.organizationId, pi))!.method).toBe("wallet");
    });
  });

  // -------------------------------------------------------------------------
  describe("apply_reversal", () => {
    const rev = (accountId: string, o: Reversal) => h.inbox(accountId).then((inbox) => fns.applyReversal(inbox, o));

    it("a refund BEFORE its gift parks (no_gift); once the gift exists the same refund applies once", async () => {
      const o = await h.org("rev-order");
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId });
      const refund = reversal({ paymentIntentId: pi, externalReversalId: ids.refund(), amountCents: 2000 });
      expect(await rev(o.accountId, refund)).toBe("parked:no_gift");
      expect(await h.reversals(o.organizationId)).toHaveLength(0);

      expect(await apply(await h.inbox(o.accountId), gift({ sessionId, paymentIntentId: pi }))).toBe("applied");
      expect(await rev(o.accountId, refund)).toBe("applied");
      expect(await rev(o.accountId, refund)).toBe("noop"); // replay: existence tested first (F143)
      const rows = await h.reversals(o.organizationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "refund", amount_cents: 2000, external_reversal_id: refund.externalReversalId });
    });

    it("partial refunds add up to the gift; the one that would exceed it is dead:over_reversal and writes nothing", async () => {
      const g = await paidGift({ amount: 5000 });
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), amountCents: 3000 }))).toBe("applied");
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), amountCents: 2000 }))).toBe("applied");
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), amountCents: 1 }))).toBe("dead:over_reversal");
      const rows = await h.reversals(g.organizationId);
      expect(rows).toHaveLength(2);
      expect(rows.reduce((n, r) => n + Number(r.amount_cents), 0)).toBe(5000);
    });

    it("a single over-large refund is dead:over_reversal", async () => {
      const g = await paidGift({ amount: 5000 });
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), amountCents: 5001 }))).toBe("dead:over_reversal");
      expect(await h.reversals(g.organizationId)).toHaveLength(0);
    });

    it("a dispute and an ACH return are recorded with their own kinds", async () => {
      const g = await paidGift({ amount: 5000 });
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, reversalKind: "dispute", externalReversalId: ids.dispute(), amountCents: 5000 }))).toBe("applied");
      const h2 = await paidGift({ amount: 4000 });
      expect(await rev(h2.accountId, reversal({ paymentIntentId: h2.pi, reversalKind: "ach_return", externalReversalId: ids.dispute(), amountCents: 4000 }))).toBe("applied");
      expect((await h.reversals(g.organizationId))[0]!.kind).toBe("dispute");
      expect((await h.reversals(h2.organizationId))[0]!.kind).toBe("ach_return");
    });

    it("a won dispute reinstates the money and frees the headroom for another reversal", async () => {
      const g = await paidGift({ amount: 5000 });
      const dispute = ids.dispute();
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, reversalKind: "dispute", externalReversalId: dispute, amountCents: 5000 }))).toBe("applied");
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), amountCents: 100 }))).toBe("dead:over_reversal");
      expect(await rev(g.accountId, reversal({
        paymentIntentId: g.pi, reversalKind: "reinstatement", externalReversalId: `${dispute}:won`, amountCents: 5000, offsetsExternalReversalId: dispute,
      }))).toBe("applied");
      const rows = await h.reversals(g.organizationId);
      expect(rows.find((r) => r.kind === "reinstatement")!.offsets_reversal_id).toBe(rows.find((r) => r.kind === "dispute")!.id);
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), amountCents: 100 }))).toBe("applied");
    });

    it("a reinstatement of a reversal that was never recorded parks (no_reversal)", async () => {
      const g = await paidGift();
      expect(await rev(g.accountId, reversal({
        paymentIntentId: g.pi, reversalKind: "reinstatement", externalReversalId: `${ids.refund()}:failed`, offsetsExternalReversalId: ids.refund(),
      }))).toBe("parked:no_reversal");
    });

    it("a reversal against a still-pending ACH gift parks; against a failed gift it is ignored", async () => {
      const o = await h.org("rev-pending");
      const pendingSession = ids.session();
      const pendingPi = ids.pi();
      await h.intent({ ...o, sessionId: pendingSession, totalCents: 10000 });
      await apply(await h.inbox(o.accountId), gift({ sessionId: pendingSession, paymentIntentId: pendingPi, amountCents: 10000, status: "pending" }));
      expect(await rev(o.accountId, reversal({ paymentIntentId: pendingPi, externalReversalId: ids.refund() }))).toBe("parked:gift_pending");

      const failedSession = ids.session();
      const failedPi = ids.pi();
      await h.intent({ ...o, sessionId: failedSession, totalCents: 10000 });
      await apply(await h.inbox(o.accountId), gift({ sessionId: failedSession, paymentIntentId: failedPi, amountCents: 10000, status: "failed" }));
      expect(await rev(o.accountId, reversal({ paymentIntentId: failedPi, externalReversalId: ids.refund() }))).toBe("ignored:gift_failed");
      expect(await h.reversals(o.organizationId)).toHaveLength(0);
    });

    it("a payment of ANOTHER connection (same PaymentIntent id elsewhere) is never touched", async () => {
      const a = await paidGift();
      const b = await h.org("rev-isolated");
      expect(await rev(b.accountId, reversal({ paymentIntentId: a.pi, externalReversalId: ids.refund() }))).toBe("parked:no_gift");
      expect(await h.reversals(a.organizationId)).toHaveLength(0);
    });

    it("rejects malformed reversals with a dead code", async () => {
      const g = await paidGift();
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), reversalKind: "bogus" as never }))).toBe("dead:bad_kind");
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: "", amountCents: 100 }))).toBe("dead:bad_reference");
      expect(await rev(g.accountId, reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), amountCents: 0 }))).toBe("dead:bad_amount");
    });
  });

  // -------------------------------------------------------------------------
  describe("subscriptions and renewals", () => {
    const sub = (o: Partial<Subscription> & { subscriptionId: string }): Subscription => ({
      kind: "subscription",
      action: "started",
      sessionId: null,
      donor: donorDetails({ externalCustomerId: ids.customer() }),
      at: NOON_UTC,
      ...o,
    });

    async function monthly(options: { total?: number; covered?: number } = {}) {
      const o = await h.org(`monthly-${h.unique()}`);
      const sessionId = ids.session();
      const subscriptionId = ids.subscription();
      const intentId = await h.intent({ ...o, sessionId, frequency: "monthly", totalCents: options.total ?? 2500, coveredFeeCents: options.covered ?? 0 });
      return { ...o, sessionId, subscriptionId, intentId };
    }

    it("'started' records the subscription and customer on the intent, resolves the donor, and creates NO gift", async () => {
      const m = await monthly();
      const customer = ids.customer();
      const inbox = await h.inbox(m.accountId);
      expect(await fns.applySubscription(inbox, sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId, donor: donorDetails({ externalCustomerId: customer }) }))).toBe("applied");
      const row = await h.intentRow(m.intentId);
      expect(row).toMatchObject({ subscription_id: m.subscriptionId, customer_id: customer, status: "completed" });
      expect(row.donor_id).toBeTruthy();
      expect(await h.gifts(m.organizationId)).toHaveLength(0);
      // a repeat is a noop; a DIFFERENT subscription on the same intent is a conflict
      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId }))).toBe("noop");
      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: ids.subscription() }))).toBe("dead:subscription_conflict");
    });

    it("'started' on a one-time intent is a mode mismatch; an unknown session is ignored", async () => {
      const o = await h.org("monthly-mode");
      const sessionId = ids.session();
      await h.intent({ ...o, sessionId, frequency: "once" });
      expect(await fns.applySubscription(await h.inbox(o.accountId), sub({ sessionId, subscriptionId: ids.subscription() }))).toBe("dead:mode_mismatch");
      expect(await fns.applySubscription(await h.inbox(o.accountId), sub({ sessionId: ids.session(), subscriptionId: ids.subscription() }))).toBe("ignored:no_intent");
    });

    it("a malformed subscription id is dead", async () => {
      const m = await monthly();
      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: "sub_x" }))).toBe("dead:bad_subscription");
    });

    it("a renewal BEFORE its subscription is known parks (no_subscription); after 'started' it records a gift at the collected amount", async () => {
      const m = await monthly({ total: 2500, covered: 100 });
      const pi = ids.pi();
      const renewal = gift({ subscriptionId: m.subscriptionId, invoiceId: ids.invoice(), paymentIntentId: pi, amountCents: 2500 });
      expect(await apply(await h.inbox(m.accountId), renewal)).toBe("parked:no_subscription");

      await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId }));
      expect(await apply(await h.inbox(m.accountId), renewal)).toBe("applied");
      expect(await h.giftByPi(m.organizationId, pi)).toMatchObject({ amount_cents: 2500, donor_covered_fee_cents: 100, fund_id: m.fundId, intent_id: m.intentId });
    });

    it("the FIRST payment must equal the intent total; a LATER renewal at another amount is recorded as collected with no covered fee", async () => {
      const m = await monthly({ total: 2500, covered: 100 });
      await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId }));
      const wrong = gift({ subscriptionId: m.subscriptionId, paymentIntentId: ids.pi(), amountCents: 3000 });
      expect(await apply(await h.inbox(m.accountId), wrong)).toBe("dead:amount_mismatch");

      const first = gift({ subscriptionId: m.subscriptionId, paymentIntentId: ids.pi(), amountCents: 2500 });
      expect(await apply(await h.inbox(m.accountId), first)).toBe("applied");
      const changed = gift({ subscriptionId: m.subscriptionId, paymentIntentId: ids.pi(), amountCents: 4000 });
      expect(await apply(await h.inbox(m.accountId), changed)).toBe("applied");
      const same = gift({ subscriptionId: m.subscriptionId, paymentIntentId: ids.pi(), amountCents: 2500 });
      expect(await apply(await h.inbox(m.accountId), same)).toBe("applied");
      const rows = await h.gifts(m.organizationId);
      expect(rows.map((r) => [r.amount_cents, r.donor_covered_fee_cents])).toEqual([
        [2500, 100],
        [4000, 0],
        [2500, 100],
      ]);
    });

    it("each paid invoice is its own gift keyed on its own PaymentIntent, all under one donor", async () => {
      const m = await monthly();
      await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId, donor: donorDetails({ externalCustomerId: ids.customer() }) }));
      for (let i = 0; i < 3; i++) {
        const renewal = gift({
          subscriptionId: m.subscriptionId, invoiceId: ids.invoice(), paymentIntentId: ids.pi(), amountCents: 2500,
          donor: donorDetails({ externalCustomerId: ids.customer() }), // a fresh Stripe customer each time must NOT fork the donor
        });
        expect(await apply(await h.inbox(m.accountId), renewal)).toBe("applied");
      }
      const rows = await h.gifts(m.organizationId);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.donor_id)).size).toBe(1);
    });

    it("a failed RENEWAL is a flag on the schedule, never a gift row (P3-16)", async () => {
      const m = await monthly();
      await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId }));
      const failed = gift({ subscriptionId: m.subscriptionId, paymentIntentId: ids.pi(), status: "failed", failureCode: "card_declined" });
      expect(await apply(await h.inbox(m.accountId), failed)).toBe("ignored:renewal_failed");
      expect(await h.gifts(m.organizationId)).toHaveLength(0);
      expect((await h.intentRow(m.intentId)).last_payment_failed_at).not.toBeNull();
    });

    it("'payment_failed' sets the flag; 'ended' sets the end once and a repeat is a noop; unknown subscriptions park", async () => {
      const m = await monthly();
      await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId }));
      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ action: "payment_failed", subscriptionId: m.subscriptionId }))).toBe("applied");
      expect((await h.intentRow(m.intentId)).last_payment_failed_at).not.toBeNull();

      expect((await h.intentRow(m.intentId)).subscription_ended_at).toBeNull();
      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ action: "ended", subscriptionId: m.subscriptionId }))).toBe("applied");
      expect((await h.intentRow(m.intentId)).subscription_ended_at).not.toBeNull();
      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ action: "ended", subscriptionId: m.subscriptionId }))).toBe("noop");

      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ action: "ended", subscriptionId: ids.subscription() }))).toBe("parked:no_subscription");
      expect(await fns.applySubscription(await h.inbox(m.accountId), sub({ action: "payment_failed", subscriptionId: ids.subscription() }))).toBe("parked:no_subscription");
    });

    it("an active monthly gift is counted until it ends", async () => {
      const m = await monthly();
      const count = async () =>
        Number(
          h.rowsOf(await h.owner(sql`
            select count(*)::int as n from giving_checkout_intents
             where organization_id = ${m.organizationId} and frequency = 'monthly'
               and subscription_id is not null and subscription_ended_at is null`))[0]!.n,
        );
      expect(await count()).toBe(0);
      await fns.applySubscription(await h.inbox(m.accountId), sub({ sessionId: m.sessionId, subscriptionId: m.subscriptionId }));
      expect(await count()).toBe(1);
      await fns.applySubscription(await h.inbox(m.accountId), sub({ action: "ended", subscriptionId: m.subscriptionId }));
      expect(await count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("donor resolution (P3-15) and auto-link", () => {
    async function oneGift(o: { organizationId: string; fundId: string; connectionId: string; accountId: string }, donor: DonorDetails, membershipId: string | null = null) {
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId, membershipId });
      const result = await apply(await h.inbox(o.accountId), gift({ sessionId, paymentIntentId: pi, donor }));
      return { result, gift: (await h.giftByPi(o.organizationId, pi))! };
    }

    it("the same Stripe customer on a later gift is the same donor", async () => {
      const o = await h.org("dedupe-customer");
      const customer = ids.customer();
      const a = await oneGift(o, donorDetails({ externalCustomerId: customer }));
      const b = await oneGift(o, donorDetails({ externalCustomerId: customer, name: "Someone Else", email: "else@example.invalid" }));
      expect(b.gift.donor_id).toBe(a.gift.donor_id);
      expect(await h.donors(o.organizationId)).toHaveLength(1);
    });

    it("a NEW customer attaches to an existing donor only when email AND case-folded name both match exactly one identified donor", async () => {
      const o = await h.org("dedupe-exact");
      const existing = await h.makeDonor(o.organizationId, "Pat Fixture", { email: "pat.fixture@example.invalid" });
      const r = await oneGift(o, donorDetails({ externalCustomerId: ids.customer(), name: "PAT FIXTURE", email: "Pat.Fixture@Example.Invalid" }));
      expect(r.gift.donor_id).toBe(existing);
      expect(await h.donors(o.organizationId)).toHaveLength(1);
    });

    it("an email-only match (different name) becomes a NEW donor, never a silent attach", async () => {
      const o = await h.org("dedupe-email-only");
      const existing = await h.makeDonor(o.organizationId, "Pat Fixture", { email: "shared.fixture@example.invalid" });
      const r = await oneGift(o, donorDetails({ externalCustomerId: ids.customer(), name: "Chris Different", email: "shared.fixture@example.invalid" }));
      expect(r.gift.donor_id).not.toBe(existing);
      expect(await h.donors(o.organizationId)).toHaveLength(2);
    });

    it("an ambiguous match (two donors with the same name and email) becomes a new donor", async () => {
      const o = await h.org("dedupe-ambiguous");
      await h.makeDonor(o.organizationId, "Pat Fixture", { email: "pat.fixture@example.invalid" });
      await h.makeDonor(o.organizationId, "Pat Fixture", { email: "pat.fixture@example.invalid" });
      const r = await oneGift(o, donorDetails({ externalCustomerId: ids.customer() }));
      expect((await h.donors(o.organizationId)).filter((d) => d.id === r.gift.donor_id)).toHaveLength(1);
      expect(await h.donors(o.organizationId)).toHaveLength(3);
    });

    it("never attaches across organizations", async () => {
      const a = await h.org("dedupe-xorg-a");
      const b = await h.org("dedupe-xorg-b");
      const existing = await h.makeDonor(a.organizationId, "Pat Fixture", { email: "pat.fixture@example.invalid" });
      const r = await oneGift(b, donorDetails({ externalCustomerId: ids.customer() }));
      expect(r.gift.donor_id).not.toBe(existing);
      expect(await h.donors(a.organizationId)).toHaveLength(1);
    });

    it("follows a merge to the root donor", async () => {
      const o = await h.org("dedupe-merged");
      const target = await h.makeDonor(o.organizationId, "Root Donor", { email: "root.fixture@example.invalid" });
      const source = await h.makeDonor(o.organizationId, "Pat Fixture", { email: "pat.fixture@example.invalid" });
      await h.owner(sql`update giving_donors set merged_into_id = ${target}, merged_at = now() where id = ${source}`);
      const customer = ids.customer();
      await h.owner(sql`insert into giving_donor_identities (organization_id, donor_id, connection_id, external_customer_id)
                        values (${o.organizationId}, ${source}, ${o.connectionId}, ${customer})`);
      const r = await oneGift(o, donorDetails({ externalCustomerId: customer }));
      expect(r.gift.donor_id).toBe(target);
    });

    it("hostile donor text is stored as bounded plain text; nothing is interpreted", async () => {
      const o = await h.org("dedupe-hostile");
      const r = await oneGift(o, donorDetails({
        externalCustomerId: ids.customer(),
        name: `<script>alert(1)</script>${"x".repeat(500)}`,
        email: "not-an-email",
        address: { line1: "1\u0000 Evil St", line2: null, city: "\u0007Town", region: "OH", postal: "00000", country: "usa-not-iso" },
      }));
      expect(r.result).toBe("applied");
      const donor = (await h.donors(o.organizationId)).find((d) => d.id === r.gift.donor_id)!;
      expect(String(donor.display_name)).toHaveLength(120);
      expect(String(donor.display_name).startsWith("<script>")).toBe(true); // text, escaped by React; never HTML
      expect(donor.email).toBeNull(); // an invalid shape is dropped
      expect(String(donor.city)).not.toMatch(/[\u0000-\u001f]/);
    });

    it("a missing name becomes 'Online donor'", async () => {
      const o = await h.org("dedupe-noname");
      const r = await oneGift(o, donorDetails({ externalCustomerId: ids.customer(), name: null, email: null }));
      const donor = (await h.donors(o.organizationId)).find((d) => d.id === r.gift.donor_id)!;
      expect(donor.display_name).toBe("Online donor");
    });

    describe("auto-link (Q10): only a signed-in member's own intent links", () => {
      it("links the donor to the intent's membership; a repeat is plain 'applied'; a different existing link is a CONFLICT left alone", async () => {
        const o = await h.org("autolink");
        const person = await h.makePerson("Avery", "Member");
        await h.addMember(o.organizationId, person);
        const membershipId = await h.membershipOf(o.organizationId, person);
        const other = await h.makePerson("Blake", "Other");
        await h.addMember(o.organizationId, other);
        const otherMembership = await h.membershipOf(o.organizationId, other);

        const customer = ids.customer();
        const first = await oneGift(o, donorDetails({ externalCustomerId: customer }), membershipId);
        expect(first.result).toBe("applied:autolinked");
        let donor = (await h.donors(o.organizationId))[0]!;
        expect(donor).toMatchObject({ linked_membership_id: membershipId, link_source: "self_online" });

        const again = await oneGift(o, donorDetails({ externalCustomerId: customer }), membershipId);
        expect(again.result).toBe("applied");

        const conflict = await oneGift(o, donorDetails({ externalCustomerId: customer }), otherMembership);
        expect(conflict.result).toBe("applied:link_conflict");
        donor = (await h.donors(o.organizationId))[0]!;
        expect(donor.linked_membership_id).toBe(membershipId);
      });

      it("a public intent (no membership) never links, even on an exact email match with a member", async () => {
        const o = await h.org("autolink-public");
        const person = await h.makePerson("Casey", "Member");
        await h.addMember(o.organizationId, person);
        const r = await oneGift(o, donorDetails({ externalCustomerId: ids.customer() }), null);
        expect(r.result).toBe("applied");
        expect((await h.donors(o.organizationId))[0]!.linked_membership_id).toBeNull();
      });

      it("an intent whose membership has ended does not link", async () => {
        const o = await h.org("autolink-ended");
        const person = await h.makePerson("Drew", "Gone");
        await h.addMember(o.organizationId, person);
        const membershipId = await h.membershipOf(o.organizationId, person);
        await h.owner(sql`update memberships set ended_on = current_date - 1, current_roll = 'removed' where id = ${membershipId}`);
        const r = await oneGift(o, donorDetails({ externalCustomerId: ids.customer() }), membershipId);
        expect(r.result).toBe("applied");
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("occurred_on: the org-local date, computed once, in SQL (F132)", () => {
    // 2026-12-31 23:30 America/New_York is 2027-01-01 04:30 UTC.
    const NEW_YEAR_UTC = new Date("2027-01-01T04:30:00Z");

    it("a 23:30 Eastern gift on Dec 31 is a Dec 31 gift even though its UTC instant is Jan 1 (an org with NO settings row)", async () => {
      const o = await h.org("year-nosettings", { timeZone: null });
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId });
      await apply(await h.inbox(o.accountId), gift({ sessionId, paymentIntentId: pi, authorizedAt: NEW_YEAR_UTC }));
      expect((await h.giftByPi(o.organizationId, pi))!.occurred_on).toBe("2026-12-31");
    });

    it("an org's own zone wins: the same instant is already Jan 1 in Berlin and still Dec 31 in Los Angeles", async () => {
      for (const [zone, expected] of [["Europe/Berlin", "2027-01-01"], ["America/Los_Angeles", "2026-12-31"]] as const) {
        const o = await h.org(`year-${zone === "Europe/Berlin" ? "berlin" : "losangeles"}`, { timeZone: zone });
        const sessionId = ids.session();
        const pi = ids.pi();
        await h.intent({ ...o, sessionId });
        await apply(await h.inbox(o.accountId), gift({ sessionId, paymentIntentId: pi, authorizedAt: NEW_YEAR_UTC }));
        expect((await h.giftByPi(o.organizationId, pi))!.occurred_on, zone).toBe(expected);
      }
    });

    it("changing the org's zone later never rewrites an existing gift", async () => {
      const o = await h.org("year-frozen", { timeZone: "America/New_York" });
      const sessionId = ids.session();
      const pi = ids.pi();
      await h.intent({ ...o, sessionId });
      await apply(await h.inbox(o.accountId), gift({ sessionId, paymentIntentId: pi, authorizedAt: NEW_YEAR_UTC }));
      await h.owner(sql`update organization_settings set time_zone = 'Pacific/Auckland' where organization_id = ${o.organizationId}`);
      expect((await h.giftByPi(o.organizationId, pi))!.occurred_on).toBe("2026-12-31");
    });

    it("a reversal's occurred_on is computed the same way", async () => {
      const g = await paidGift();
      await fns.applyReversal(await h.inbox(g.accountId), reversal({ paymentIntentId: g.pi, externalReversalId: ids.refund(), occurredAt: NEW_YEAR_UTC }));
      expect((await h.reversals(g.organizationId))[0]!.occurred_on).toBe("2026-12-31");
    });
  });

  // -------------------------------------------------------------------------
  describe("apply_intent_expired", () => {
    it("created/open -> expired; a repeat is a noop; a completed intent is left alone; unknown sessions are ignored", async () => {
      const o = await h.org("expired");
      const open = ids.session();
      const intentId = await h.intent({ ...o, sessionId: open, status: "open" });
      expect(await fns.applyIntentExpired(await h.inbox(o.accountId), open)).toBe("applied");
      expect((await h.intentRow(intentId)).status).toBe("expired");
      expect(await fns.applyIntentExpired(await h.inbox(o.accountId), open)).toBe("noop");

      const done = ids.session();
      const doneId = await h.intent({ ...o, sessionId: done, status: "completed" });
      expect(await fns.applyIntentExpired(await h.inbox(o.accountId), done)).toBe("noop");
      expect((await h.intentRow(doneId)).status).toBe("completed");

      expect(await fns.applyIntentExpired(await h.inbox(o.accountId), ids.session())).toBe("ignored:no_intent");
    });

    it("never expires another connection's intent", async () => {
      const a = await h.org("expired-a");
      const b = await h.org("expired-b");
      const session = ids.session();
      const intentId = await h.intent({ ...b, sessionId: session, status: "open" });
      expect(await fns.applyIntentExpired(await h.inbox(a.accountId), session)).toBe("ignored:no_intent");
      expect((await h.intentRow(intentId)).status).toBe("open");
    });
  });
});
