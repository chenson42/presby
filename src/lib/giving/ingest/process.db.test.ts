/**
 * processInboxEvent end to end: REAL fixture bodies, the REAL ingest / claim /
 * apply / finish functions on the `presby_app` connection, a mocked Stripe
 * client (no network) and a mocked audit writer. docs/work-log/
 * 2026-10-15-online-giving.md, Batch 3a. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/ingest/process.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { ProviderError } from "@/lib/giving/providers/stripe/errors";
import { FIXTURE_ACCOUNT, fixtureBody, type FixtureName } from "@/lib/giving/providers/stripe/testing/sign-event";
import type { IngestHarness } from "@/lib/testing/giving-ingest-fixture";

vi.mock("server-only", () => ({}));

const stripe = vi.hoisted(() => ({
  retrieveBalanceTransaction: vi.fn(),
  retrieveInvoiceForPayment: vi.fn(),
  retrieveEvent: vi.fn(),
  listBalanceTransactionsForPayout: vi.fn(),
}));
vi.mock("@/lib/giving/providers/stripe/client", () => stripe);

const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => String(key) }),
  recordAudit: audit.recordAudit,
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("processInboxEvent (Postgres-backed, mocked Stripe)", () => {
  let h: IngestHarness;
  let fns: typeof import("@/lib/giving/ingest/functions");
  let processInboxEvent: typeof import("@/lib/giving/ingest/process").processInboxEvent;
  let ids: typeof import("@/lib/testing/giving-ingest-fixture").fixtureIds;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-ingest-fixture");
    h = await mod.createIngestHarness("ingest-process");
    ids = mod.fixtureIds;
    fns = h.functions;
    ({ processInboxEvent } = await import("@/lib/giving/ingest/process"));
  });
  afterAll(async () => {
    await h?.cleanup();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  /** A tenant whose connection has the fixture bodies' account swapped for its own. */
  async function tenant(name: string, options: Parameters<typeof h.org>[1] = {}) {
    const o = await h.org(name, options);
    return {
      ...o,
      /** A fixture body rewritten for this tenant: its account, a unique event id, and optional id swaps. */
      body(fixture: FixtureName, swaps: Record<string, string> = {}, patch?: (b: Record<string, unknown>) => void) {
        return fixtureBody(fixture, {
          replacements: {
            [FIXTURE_ACCOUNT]: o.accountId,
            ...swaps,
          },
          patch(b) {
            b.id = `evt_fixture${h.unique()}`;
            patch?.(b);
          },
        });
      },
      /** Ingest (real) without processing. */
      async deliverUnprocessed(body: string) {
        const parsed = JSON.parse(body) as { id: string; type: string; livemode: boolean };
        const ingested = await fns.ingestEvent({
          account: o.accountId, eventId: parsed.id, livemode: parsed.livemode, eventType: parsed.type, rawBody: body,
        });
        expect(ingested.outcome).toBe("accepted");
        return { inboxId: ingested.inboxId! };
      },
      /** Ingest (real) then process (real) a body. */
      async deliver(body: string) {
        const { inboxId } = await this.deliverUnprocessed(body);
        const result = await processInboxEvent(inboxId);
        return { inboxId, result };
      },
    };
  }

  function swaps(over: Record<string, string> = {}) {
    const pi = ids.pi();
    const session = ids.session();
    return { pi, session, map: { pi_fixturePaid000001: pi, cs_fixturePaid000001: session, ...over } };
  }

  it("a signed gift is applied: fund from the INTENT, event finished 'applied', no audit row for a plain gift", async () => {
    const t = await tenant("e2e-gift");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session, totalCents: 5000 });
    // The body also tries to name a foreign fund / membership in metadata: nothing reads it.
    const body = t.body("checkout-session-completed-payment", s.map, (b) => {
      (b.data as { object: { metadata: object } }).object.metadata = { fund_id: "99999999-9999-4999-8999-999999999999", presby_intent_id: "x" };
    });
    const { inboxId, result } = await t.deliver(body);
    expect(result).toMatchObject({ claimed: true, status: "applied", verdict: "applied" });
    const gift = await h.giftByPi(t.organizationId, s.pi);
    expect(gift).toMatchObject({ status: "succeeded", amount_cents: 5000, fund_id: t.fundId, method: "card" });
    expect(await h.eventRow(inboxId)).toMatchObject({ status: "applied", last_error: null });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("re-processing an applied event is a no-op: nothing is claimable, nothing changes", async () => {
    const t = await tenant("e2e-replay");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session });
    const { inboxId } = await t.deliver(t.body("checkout-session-completed-payment", s.map));
    const again = await processInboxEvent(inboxId);
    expect(again.claimed).toBe(false);
    expect(await h.gifts(t.organizationId)).toHaveLength(1);
  });

  it("a byte-identical redelivery is a DUPLICATE at ingest and processing it again is still one gift", async () => {
    const t = await tenant("e2e-dup");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session });
    const body = t.body("checkout-session-completed-payment", s.map);
    await t.deliver(body);
    const parsed = JSON.parse(body) as { id: string; type: string; livemode: boolean };
    const second = await fns.ingestEvent({ account: t.accountId, eventId: parsed.id, livemode: false, eventType: parsed.type, rawBody: body });
    expect(second.outcome).toBe("duplicate");
    expect(await h.gifts(t.organizationId)).toHaveLength(1);
    expect(await h.events(t.organizationId)).toHaveLength(1);
  });

  it("charge.succeeded sets the fee from the balance transaction the processor retrieved, once", async () => {
    const t = await tenant("e2e-fee");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session });
    await t.deliver(t.body("checkout-session-completed-payment", s.map));
    stripe.retrieveBalanceTransaction.mockResolvedValue({ amountCents: 5000, feeCents: 175, netCents: 4825, currency: "usd" });
    const { result } = await t.deliver(t.body("charge-succeeded", { pi_fixturePaid000001: s.pi }));
    expect(result.verdict).toBe("applied");
    expect(stripe.retrieveBalanceTransaction).toHaveBeenCalledWith(t.accountId, "txn_fixturePaid0000001");
    expect(await h.giftByPi(t.organizationId, s.pi)).toMatchObject({ fee_cents: 175, net_cents: 4825 });
  });

  it("charge.succeeded for a payment that is not a gift parks, then AGES OUT to ignored; the fee call failing parks with its own code", async () => {
    const t = await tenant("e2e-fee-foreign");
    stripe.retrieveBalanceTransaction.mockResolvedValue({ amountCents: 5000, feeCents: 175, netCents: 4825, currency: "usd" });
    const { inboxId, result } = await t.deliver(t.body("charge-succeeded", { pi_fixturePaid000001: ids.pi() }));
    expect(result).toMatchObject({ verdict: "parked", status: "parked" });
    expect(await h.eventRow(inboxId)).toMatchObject({ status: "parked", last_error: "no_gift" });

    // 25 hours later the retry gives up quietly: a foreign payment must not clutter dead letters.
    await h.owner(sql`update giving_provider_events set received_at = now() - interval '25 hours', next_attempt_at = now() where id = ${inboxId}`);
    const retry = await processInboxEvent(inboxId);
    expect(retry.status).toBe("ignored");
    expect(audit.recordAudit).not.toHaveBeenCalled();

    stripe.retrieveBalanceTransaction.mockRejectedValue(new ProviderError("unconfigured"));
    const failing = await t.deliver(t.body("charge-succeeded", { pi_fixturePaid000001: ids.pi() }));
    expect(failing.result).toMatchObject({ verdict: "failed", status: "parked" });
    expect(await h.eventRow(failing.inboxId)).toMatchObject({ status: "parked", last_error: "stripe_unconfigured", attempts: 1 });
  });

  it("a refund arriving BEFORE its gift parks, then applies exactly once when retried after the gift", async () => {
    const t = await tenant("e2e-order");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session });

    const refund = await t.deliver(t.body("refund-created", { pi_fixturePaid000001: s.pi }));
    expect(refund.result).toMatchObject({ verdict: "parked", status: "parked" });
    expect(await h.eventRow(refund.inboxId)).toMatchObject({ status: "parked", last_error: "no_gift" });
    expect(await h.reversals(t.organizationId)).toHaveLength(0);

    await t.deliver(t.body("checkout-session-completed-payment", s.map));
    await h.owner(sql`update giving_provider_events set next_attempt_at = now() where id = ${refund.inboxId}`);
    const retry = await processInboxEvent(refund.inboxId);
    expect(retry).toMatchObject({ verdict: "applied", status: "applied" });
    expect(await h.reversals(t.organizationId)).toHaveLength(1);
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    expect(audit.recordAudit.mock.calls[0]![0]).toMatchObject({ action: "GIVING_REVERSAL_RECORDED", actor: null });

    // and it cannot apply twice
    expect((await processInboxEvent(refund.inboxId)).claimed).toBe(false);
    expect(await h.reversals(t.organizationId)).toHaveLength(1);
  });

  it("an OVER-REVERSAL dead-letters, writes no reversal row, and is audited as a dead letter", async () => {
    const t = await tenant("e2e-over");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session });
    await t.deliver(t.body("checkout-session-completed-payment", s.map));
    const refund = await t.deliver(t.body("refund-created", { pi_fixturePaid000001: s.pi }));
    expect(refund.result.verdict).toBe("applied");
    audit.recordAudit.mockClear();

    const dispute = await t.deliver(t.body("charge-dispute-created", { pi_fixturePaid000001: s.pi }));
    expect(dispute.result).toMatchObject({ verdict: "dead", status: "dead_letter" });
    expect(await h.eventRow(dispute.inboxId)).toMatchObject({ status: "dead_letter", last_error: "over_reversal" });
    expect(await h.reversals(t.organizationId)).toHaveLength(1);
    expect(audit.recordAudit.mock.calls.map((c) => c[0].action)).toEqual(["GIVING_EVENT_DEAD_LETTERED"]);
    expect(audit.recordAudit.mock.calls[0]![0].metadata).toMatchObject({ lastError: "over_reversal", inboxId: dispute.inboxId });
  });

  describe("a dispute is ONE reversal whichever of its events arrives first (keyed on the dispute id)", () => {
    /** A paid gift, plus the swaps that point both dispute fixtures at it. */
    async function disputed(name: string) {
      const t = await tenant(name);
      const s = swaps();
      await h.intent({ ...t, sessionId: s.session });
      await t.deliver(t.body("checkout-session-completed-payment", s.map));
      const dispute = ids.dispute();
      audit.recordAudit.mockClear();
      return { t, dispute, map: { pi_fixturePaid000001: s.pi, dp_fixtureDispute00001: dispute } };
    }
    const reversalActions = () => audit.recordAudit.mock.calls.map((c) => c[0].action);

    it("created, then funds_withdrawn: one dispute row, the second delivery is a noop that audits nothing", async () => {
      const { t, map } = await disputed("e2e-dispute-cw");
      const first = await t.deliver(t.body("charge-dispute-created", map));
      expect(first.result).toMatchObject({ verdict: "applied", parts: ["applied"] });
      const second = await t.deliver(t.body("charge-dispute-funds-withdrawn", map));
      expect(second.result).toMatchObject({ verdict: "applied", status: "applied", parts: ["noop"] });
      const rows = await h.reversals(t.organizationId);
      expect(rows.map((r) => r.kind)).toEqual(["dispute"]);
      expect(reversalActions()).toEqual(["GIVING_REVERSAL_RECORDED"]);
    });

    it("funds_withdrawn, then created: the same single row, from the other direction", async () => {
      const { t, map } = await disputed("e2e-dispute-wc");
      const first = await t.deliver(t.body("charge-dispute-funds-withdrawn", map));
      expect(first.result).toMatchObject({ verdict: "applied", parts: ["applied"] });
      const second = await t.deliver(t.body("charge-dispute-created", map));
      expect(second.result).toMatchObject({ verdict: "applied", status: "applied", parts: ["noop"] });
      expect((await h.reversals(t.organizationId)).map((r) => r.kind)).toEqual(["dispute"]);
      expect(reversalActions()).toEqual(["GIVING_REVERSAL_RECORDED"]);
    });

    it("an inquiry (warning_*) records nothing, and its escalation to funds_withdrawn records the reversal once", async () => {
      const { t, map } = await disputed("e2e-dispute-inquiry");
      const inquiry = await t.deliver(
        t.body("charge-dispute-created", map, (b) => void ((b.data as { object: Record<string, unknown> }).object.status = "warning_needs_response")),
      );
      expect(inquiry.result).toMatchObject({ verdict: "ignored", status: "ignored" });
      expect(await h.reversals(t.organizationId)).toHaveLength(0);
      const withdrawn = await t.deliver(t.body("charge-dispute-funds-withdrawn", map));
      expect(withdrawn.result.parts).toEqual(["applied"]);
      expect(await h.reversals(t.organizationId)).toHaveLength(1);
    });

    it("an ACH return is one ach_return row whichever event lands first", async () => {
      const t = await tenant("e2e-dispute-ach");
      const session = ids.session();
      const pi = ids.pi();
      await h.intent({ ...t, sessionId: session, totalCents: 10000 });
      const swap = { cs_fixtureAch00000001: session, pi_fixtureAch00000001: pi };
      await t.deliver(t.body("checkout-session-completed-payment-unpaid", swap));
      await t.deliver(t.body("checkout-session-async-payment-succeeded", swap));
      const dispute = ids.dispute();
      const map = { pi_fixtureAch00000001: pi, dp_fixtureReturn000001: dispute };
      await t.deliver(t.body("charge-dispute-created-ach", map));
      // funds_withdrawn for a bank debit: the same dispute, shaped from the card fixture
      const second = await t.deliver(
        t.body("charge-dispute-funds-withdrawn", { pi_fixturePaid000001: pi, dp_fixtureDispute00001: dispute }, (b) => {
          const o = (b.data as { object: Record<string, unknown> }).object;
          o.amount = 10000;
          o.payment_method_details = { type: "us_bank_account" };
        }),
      );
      expect(second.result.parts).toEqual(["noop"]);
      expect((await h.reversals(t.organizationId)).map((r) => r.kind)).toEqual(["ach_return"]);
    });

    it("closed:won, then funds_reinstated: one reinstatement offsetting the dispute; the other order is the same", async () => {
      const a = await disputed("e2e-reinstate-cr");
      await a.t.deliver(a.t.body("charge-dispute-created", a.map));
      expect((await a.t.deliver(a.t.body("charge-dispute-closed-won", a.map))).result.parts).toEqual(["applied"]);
      expect((await a.t.deliver(a.t.body("charge-dispute-funds-reinstated", a.map))).result.parts).toEqual(["noop"]);
      const rowsA = await h.reversals(a.t.organizationId);
      expect(rowsA.map((r) => r.kind).sort()).toEqual(["dispute", "reinstatement"]);
      expect(rowsA.find((r) => r.kind === "reinstatement")!.offsets_reversal_id).toBe(rowsA.find((r) => r.kind === "dispute")!.id);

      const b = await disputed("e2e-reinstate-rc");
      await b.t.deliver(b.t.body("charge-dispute-funds-withdrawn", b.map));
      expect((await b.t.deliver(b.t.body("charge-dispute-funds-reinstated", b.map))).result.parts).toEqual(["applied"]);
      expect((await b.t.deliver(b.t.body("charge-dispute-closed-won", b.map))).result.parts).toEqual(["noop"]);
      expect((await h.reversals(b.t.organizationId)).map((r) => r.kind).sort()).toEqual(["dispute", "reinstatement"]);
    });

    it("a reinstatement that beats its withdrawal parks (no_reversal) and applies once the withdrawal lands", async () => {
      const { t, map } = await disputed("e2e-reinstate-early");
      const early = await t.deliver(t.body("charge-dispute-funds-reinstated", map));
      expect(early.result).toMatchObject({ verdict: "parked", status: "parked" });
      await t.deliver(t.body("charge-dispute-funds-withdrawn", map));
      await h.owner(sql`update giving_provider_events set next_attempt_at = now() where id = ${early.inboxId}`);
      expect((await processInboxEvent(early.inboxId)).parts).toEqual(["applied"]);
      expect((await h.reversals(t.organizationId)).map((r) => r.kind).sort()).toEqual(["dispute", "reinstatement"]);
    });
  });

  it("a refund that later FAILS is reinstated; one that never succeeded is parked then given up on", async () => {
    const t = await tenant("e2e-reinstate");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session });
    await t.deliver(t.body("checkout-session-completed-payment", s.map));
    await t.deliver(t.body("refund-created", { pi_fixturePaid000001: s.pi }));
    const failed = await t.deliver(t.body("refund-updated-failed", { pi_fixturePaid000001: s.pi }));
    expect(failed.result.verdict).toBe("applied");
    const kinds = (await h.reversals(t.organizationId)).map((r) => r.kind).sort();
    expect(kinds).toEqual(["refund", "reinstatement"]);

    // a different refund id that never succeeded
    const other = await tenant("e2e-reinstate-none");
    const o = swaps();
    await h.intent({ ...other, sessionId: o.session });
    await other.deliver(other.body("checkout-session-completed-payment", o.map));
    const orphan = await other.deliver(other.body("refund-updated-failed", { pi_fixturePaid000001: o.pi }));
    expect(orphan.result.verdict).toBe("parked");
    await h.owner(sql`update giving_provider_events set attempts = 3, next_attempt_at = now() where id = ${orphan.inboxId}`);
    const retry = await processInboxEvent(orphan.inboxId); // claim makes attempts 4 -> beyond the grace
    expect(retry).toMatchObject({ verdict: "ignored", status: "ignored" });
  });

  it("account.application.deauthorized disconnects the connection and is audited as a system act", async () => {
    const t = await tenant("e2e-deauth");
    const { result } = await t.deliver(t.body("account-application-deauthorized"));
    expect(result).toMatchObject({ verdict: "applied", status: "applied" });
    expect(await h.connectionRow(t.connectionId)).toMatchObject({ status: "disconnected", disconnected_reason: "deauthorized", public_enabled_at: null });
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    expect(audit.recordAudit.mock.calls[0]![0]).toMatchObject({
      action: "GIVING_CONNECTION_DISCONNECTED", actor: null, resourceId: t.connectionId,
      metadata: { reason: "deauthorized", connectionId: t.connectionId },
    });
    // Ingest continues for a disconnected connection, so recurring gifts stay recorded.
    const after = await fns.ingestEvent({ account: t.accountId, eventId: `evt_fixture${h.unique()}`, livemode: false, eventType: "charge.succeeded", rawBody: "{}" });
    expect(after.outcome).toBe("accepted");
  });

  it("account.updated moves the status and audits a CHANGE only", async () => {
    const t = await tenant("e2e-status", { connection: { status: "onboarding" } });
    const first = await t.deliver(t.body("account-updated-active"));
    expect(first.result.verdict).toBe("applied");
    expect((await h.connectionRow(t.connectionId)).status).toBe("active");
    expect(audit.recordAudit.mock.calls.map((c) => c[0].action)).toEqual(["GIVING_CONNECTION_STATUS_CHANGED"]);

    audit.recordAudit.mockClear();
    await t.deliver(t.body("account-updated-active"));
    expect(audit.recordAudit).not.toHaveBeenCalled(); // same snapshot: nothing changed

    await t.deliver(t.body("account-updated-restricted"));
    expect((await h.connectionRow(t.connectionId)).status).toBe("restricted");
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
  });

  it("a monthly gift end to end: subscription started, then an invoice payment COMPLETED from the invoice, then ended", async () => {
    const t = await tenant("e2e-monthly");
    const session = ids.session();
    const subscription = ids.subscription();
    const pi = ids.pi();
    const invoice = ids.invoice();
    await h.intent({ ...t, sessionId: session, frequency: "monthly", totalCents: 2500 });
    const donor = { externalCustomerId: ids.customer(), name: "Fixture Donor", email: "donor.fixture@example.invalid", address: { line1: null, line2: null, city: null, region: null, postal: null, country: null } };
    stripe.retrieveInvoiceForPayment.mockResolvedValue({ subscriptionId: subscription, donor, billingReason: "subscription_cycle" });

    const renewalBody = t.body("invoice-payment-paid", { pi_fixtureRenewal00001: pi, in_fixtureInvoice000001: invoice });
    // The renewal arrives BEFORE the subscription is known: parks
    const early = await t.deliver(renewalBody);
    expect(early.result.verdict).toBe("parked");
    expect(await h.eventRow(early.inboxId)).toMatchObject({ last_error: "no_subscription" });

    const started = await t.deliver(t.body("checkout-session-completed-subscription", { cs_fixtureMonthly0001: session, sub_fixtureMonthly0001: subscription }));
    expect(started.result.verdict).toBe("applied");
    expect(await h.gifts(t.organizationId)).toHaveLength(0);

    await h.owner(sql`update giving_provider_events set next_attempt_at = now() where id = ${early.inboxId}`);
    expect((await processInboxEvent(early.inboxId)).verdict).toBe("applied");
    expect(stripe.retrieveInvoiceForPayment).toHaveBeenCalledWith(t.accountId, invoice);
    expect(await h.giftByPi(t.organizationId, pi)).toMatchObject({ amount_cents: 2500, fund_id: t.fundId });

    const ended = await t.deliver(t.body("customer-subscription-deleted", { sub_fixtureMonthly0001: subscription }));
    expect(ended.result.verdict).toBe("applied");
  });

  it("an invoice payment on an invoice with no subscription is ignored without clutter", async () => {
    const t = await tenant("e2e-invoice-foreign");
    stripe.retrieveInvoiceForPayment.mockResolvedValue({ subscriptionId: null, donor: {}, billingReason: "manual" });
    const { result, inboxId } = await t.deliver(t.body("invoice-payment-paid", { pi_fixtureRenewal00001: ids.pi() }));
    expect(result).toMatchObject({ verdict: "ignored", status: "ignored" });
    expect(await h.eventRow(inboxId)).toMatchObject({ status: "ignored", last_error: "no_subscription_on_invoice" });
  });

  it("an unrecognized session is ignored (no intent): a Stripe payment presby never started is not a gift (R9)", async () => {
    const t = await tenant("e2e-no-intent");
    const { result } = await t.deliver(t.body("checkout-session-completed-payment", { cs_fixturePaid000001: ids.session(), pi_fixturePaid000001: ids.pi() }));
    expect(result).toMatchObject({ verdict: "ignored", status: "ignored" });
    expect(await h.gifts(t.organizationId)).toHaveLength(0);
    expect(await h.donors(t.organizationId)).toHaveLength(0);
  });

  it("a wrong api_version dead-letters visibly with its code", async () => {
    const t = await tenant("e2e-version");
    const { result, inboxId } = await t.deliver(t.body("checkout-session-expired", {}, (b) => void (b.api_version = "2020-08-27")));
    expect(result).toMatchObject({ verdict: "dead", status: "dead_letter" });
    expect(await h.eventRow(inboxId)).toMatchObject({ status: "dead_letter", last_error: "normalize_api_version" });
    expect(audit.recordAudit.mock.calls.map((c) => c[0].action)).toEqual(["GIVING_EVENT_DEAD_LETTERED"]);
  });

  it("an intent_expired closes the intent", async () => {
    const t = await tenant("e2e-expired");
    const session = ids.session();
    const intentId = await h.intent({ ...t, sessionId: session, status: "open" });
    await t.deliver(t.body("checkout-session-expired", { cs_fixtureExpired0001: session }));
    expect((await h.intentRow(intentId)).status).toBe("expired");
  });

  it("an ACH gift: pending at completion, succeeded later; a failed ACH is recorded failed", async () => {
    const t = await tenant("e2e-ach");
    const session = ids.session();
    const pi = ids.pi();
    await h.intent({ ...t, sessionId: session, totalCents: 10000 });
    const swap = { cs_fixtureAch00000001: session, pi_fixtureAch00000001: pi };
    await t.deliver(t.body("checkout-session-completed-payment-unpaid", swap));
    expect((await h.giftByPi(t.organizationId, pi))).toMatchObject({ status: "pending", method: "us_bank_account" });
    await t.deliver(t.body("checkout-session-async-payment-succeeded", swap));
    expect((await h.giftByPi(t.organizationId, pi))!.status).toBe("succeeded");

    const f = await tenant("e2e-ach-failed");
    const fs = ids.session();
    const fpi = ids.pi();
    await h.intent({ ...f, sessionId: fs, totalCents: 10000 });
    const fswap = { cs_fixtureAch00000001: fs, pi_fixtureAch00000001: fpi };
    await f.deliver(f.body("checkout-session-completed-payment-unpaid", fswap));
    await f.deliver(f.body("checkout-session-async-payment-failed", fswap));
    expect(await h.giftByPi(f.organizationId, fpi)).toMatchObject({ status: "failed", failure_code: "async_payment_failed" });
  });

  it("a payout is recorded as a settlement, and an AUTOMATIC one has its lines stored, matched to gifts by payment intent", async () => {
    const t = await tenant("e2e-payout");
    // The gift the payout pays out (a real payment-mode gift from the signed fixture).
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session, totalCents: 5000 });
    await t.deliver(t.body("checkout-session-completed-payment", s.map));
    const gift = await h.giftByPi(t.organizationId, s.pi);

    const po = ids.payout();
    stripe.listBalanceTransactionsForPayout.mockResolvedValue({
      rows: [
        { balanceTransactionId: `txn_${ids.payout().slice(3)}a`, kind: "charge", amountCents: 5000, feeCents: 175, netCents: 4825, paymentIntentId: s.pi },
        { balanceTransactionId: `txn_${ids.payout().slice(3)}b`, kind: "charge", amountCents: 3000, feeCents: 117, netCents: 2883, paymentIntentId: "pi_notOurGift00001" },
        { balanceTransactionId: `txn_${ids.payout().slice(3)}c`, kind: "adjustment", amountCents: -1000, feeCents: 0, netCents: -1000, paymentIntentId: null },
      ],
      hasMore: false,
    });
    const { result } = await t.deliver(t.body("payout-paid", { po_fixturePayout000001: po }));
    expect(result.verdict).toBe("applied");
    expect(stripe.listBalanceTransactionsForPayout).toHaveBeenCalledWith(t.accountId, po, undefined);

    const [settlement] = await h.settlements(t.organizationId);
    expect(settlement).toMatchObject({ external_settlement_id: po, status: "paid" });
    const lines = h.rowsOf(
      await h.owner(sql`
        select l.kind, l.gross_cents::int as gross, l.fee_cents::int as fee, l.net_cents::int as net, l.payment_intent_id, l.gift_id::text as gift_id
          from giving_settlement_lines l join giving_settlements s on s.id = l.settlement_id
         where s.organization_id = ${t.organizationId} and s.external_settlement_id = ${po}
         order by l.external_balance_transaction_id`),
    );
    expect(lines.map((l) => [l.kind, l.gross, l.fee, l.net])).toEqual([
      ["charge", 5000, 175, 4825],
      ["charge", 3000, 117, 2883],
      ["adjustment", -1000, 0, -1000],
    ]);
    // matched to OUR gift by payment intent; the foreign intent and the adjustment match nothing
    expect(lines.map((l) => l.gift_id)).toEqual([String(gift!.id), null, null]);
    const loaded = h.rowsOf(await h.owner(sql`select lines_loaded_at is not null as loaded from giving_settlements where organization_id = ${t.organizationId}`));
    expect(loaded[0]!.loaded).toBe(true);

    // The same payout delivered again (a new event id) stores nothing twice.
    await t.deliver(t.body("payout-paid", { po_fixturePayout000001: po }));
    const count = h.rowsOf(await h.owner(sql`select count(*)::int as n from giving_settlement_lines where organization_id = ${t.organizationId}`));
    expect(count[0]!.n).toBe(3);
  });

  it("a MANUAL payout is a header only: automatic = false, no lines, never loaded, Stripe never asked", async () => {
    const t = await tenant("e2e-payout-manual");
    const po = ids.payout();
    const { result } = await t.deliver(
      t.body("payout-paid", { po_fixturePayout000001: po }, (b) => void ((b.data as { object: Record<string, unknown> }).object.automatic = false)),
    );
    expect(result.verdict).toBe("applied");
    expect(stripe.listBalanceTransactionsForPayout).not.toHaveBeenCalled();
    expect((await h.settlements(t.organizationId))[0]).toMatchObject({ external_settlement_id: po, status: "paid", automatic: false });
    const n = h.rowsOf(await h.owner(sql`select count(*)::int as n from giving_settlement_lines where organization_id = ${t.organizationId}`));
    expect(n[0]!.n).toBe(0);
    const loaded = h.rowsOf(await h.owner(sql`select lines_loaded_at from giving_settlements where organization_id = ${t.organizationId}`));
    expect(loaded[0]!.lines_loaded_at).toBeNull();
  });

  it("a Stripe failure listing a payout's lines retries the event; the header is already there and the retry completes it", async () => {
    const t = await tenant("e2e-payout-retry");
    const po = ids.payout();
    stripe.listBalanceTransactionsForPayout.mockRejectedValueOnce(new ProviderError("network"));
    const first = await t.deliver(t.body("payout-paid", { po_fixturePayout000001: po }));
    expect(first.result.verdict).toBe("failed");
    expect((await h.settlements(t.organizationId))[0]).toMatchObject({ external_settlement_id: po });
    const unloaded = h.rowsOf(await h.owner(sql`select lines_loaded_at from giving_settlements where organization_id = ${t.organizationId}`));
    expect(unloaded[0]!.lines_loaded_at).toBeNull();

    // The event is parked with a back-off; make it due and let the cron's path take it again.
    stripe.listBalanceTransactionsForPayout.mockResolvedValue({
      rows: [{ balanceTransactionId: `txn_${ids.payout().slice(3)}z`, kind: "charge", amountCents: 2000, feeCents: 88, netCents: 1912, paymentIntentId: null }],
      hasMore: false,
    });
    await h.owner(sql`update giving_provider_events set next_attempt_at = now() - interval '1 minute' where id = ${first.inboxId}`);
    const again = await processInboxEvent(first.inboxId);
    expect(again.verdict).toBe("applied");
    const n = h.rowsOf(await h.owner(sql`select count(*)::int as n from giving_settlement_lines where organization_id = ${t.organizationId}`));
    expect(n[0]!.n).toBe(1);
  });

  it("a PURGED body is re-fetched through retrieveEvent with the inbox row's own event id, and the audit rows name the organization", async () => {
    const t = await tenant("e2e-purged");
    const session = ids.session();
    const intentId = await h.intent({ ...t, sessionId: session, status: "open" });
    const body = t.body("checkout-session-expired", { cs_fixtureExpired0001: session });
    const parsed = JSON.parse(body) as { id: string };
    const { inboxId } = await t.deliverUnprocessed(body);
    // The cron's purge, done by hand: a stored body 90 days past a terminal state is nulled.
    await h.owner(sql`update giving_provider_events set raw_body = null, body_purged_at = now() where id = ${inboxId}`);

    stripe.retrieveEvent.mockResolvedValue(body);
    const result = await processInboxEvent(inboxId);
    expect(stripe.retrieveEvent).toHaveBeenCalledWith(t.accountId, parsed.id);
    expect(result).toMatchObject({ verdict: "applied", status: "applied" });
    expect((await h.intentRow(intentId)).status).toBe("expired");

    // A re-fetched body that Stripe no longer serves in our shape dead-letters, and ITS audit row carries the org.
    const bad = t.body("checkout-session-expired", {}, (b) => void (b.api_version = "2020-08-27"));
    const second = await t.deliverUnprocessed(bad);
    await h.owner(sql`update giving_provider_events set raw_body = null, body_purged_at = now() where id = ${second.inboxId}`);
    stripe.retrieveEvent.mockResolvedValue(bad);
    audit.recordAudit.mockClear();
    await processInboxEvent(second.inboxId);
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    expect(audit.recordAudit.mock.calls[0]![0]).toMatchObject({
      action: "GIVING_EVENT_DEAD_LETTERED",
      metadata: { organizationId: t.organizationId, connectionId: t.connectionId, inboxId: second.inboxId },
    });
  });

  it("two simultaneous processors cannot both claim one event (the lease)", async () => {
    const t = await tenant("e2e-lease");
    const s = swaps();
    await h.intent({ ...t, sessionId: s.session });
    const body = t.body("checkout-session-completed-payment", s.map);
    const parsed = JSON.parse(body) as { id: string; type: string; livemode: boolean };
    const ingested = await fns.ingestEvent({ account: t.accountId, eventId: parsed.id, livemode: false, eventType: parsed.type, rawBody: body });
    const results = await Promise.all([processInboxEvent(ingested.inboxId!), processInboxEvent(ingested.inboxId!), processInboxEvent(ingested.inboxId!)]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(await h.gifts(t.organizationId)).toHaveLength(1);
  });
});
