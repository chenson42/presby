/**
 * The inbox lifecycle - ingest, claim, finish, due, purge, expire, connection
 * status, settlements - through the REAL SECURITY DEFINER functions on the
 * `presby_app` connection. docs/work-log/2026-10-15-online-giving.md, Batch 3a.
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/ingest/lifecycle.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { IngestHarness } from "@/lib/testing/giving-ingest-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("ingest lifecycle (Postgres-backed)", () => {
  let h: IngestHarness;
  let ids: typeof import("@/lib/testing/giving-ingest-fixture").fixtureIds;
  let fns: typeof import("@/lib/giving/ingest/functions");

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-ingest-fixture");
    h = await mod.createIngestHarness("ingest-life");
    ids = mod.fixtureIds;
    fns = h.functions;
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const ingest = (accountId: string, overrides: Partial<Parameters<typeof fns.ingestEvent>[0]> = {}) =>
    fns.ingestEvent({
      account: accountId,
      eventId: `evt_fixture${h.unique()}`,
      livemode: false,
      eventType: "charge.succeeded",
      rawBody: '{"fixture":true}',
      ...overrides,
    });

  describe("ingest_event: one outcome for the route, nothing leaked", () => {
    it("accepts an event for a known account and stores the exact raw bytes", async () => {
      const o = await h.org("ingest-ok");
      const eventId = `evt_fixture${h.unique()}`;
      const body = ' {"exact":  "bytes" }\n';
      const result = await ingest(o.accountId, { eventId, rawBody: body });
      expect(result.outcome).toBe("accepted");
      const row = await h.eventRow(result.inboxId!);
      expect(row).toMatchObject({ status: "received", attempts: 0, event_type: "charge.succeeded", livemode: false });
      expect(row.raw_body).toBe(body);
    });

    it("a repeat of the same event id is a duplicate pointing at the SAME row; only one row exists", async () => {
      const o = await h.org("ingest-dup");
      const eventId = `evt_fixture${h.unique()}`;
      const first = await ingest(o.accountId, { eventId });
      const second = await ingest(o.accountId, { eventId, rawBody: '{"different":"body"}' });
      expect(first.outcome).toBe("accepted");
      expect(second).toEqual({ outcome: "duplicate", inboxId: first.inboxId });
      expect((await h.events(o.organizationId)).filter((e) => e.external_event_id === eventId)).toHaveLength(1);
      expect((await h.eventRow(first.inboxId!)).raw_body).toBe('{"fixture":true}'); // the first bytes win
    });

    it("an UNKNOWN account is ignored and writes nothing anywhere", async () => {
      const result = await ingest("acct_fixtureDoesNotExist01");
      expect(result).toEqual({ outcome: "ignored", inboxId: null });
    });

    it("a livemode mismatch is ignored and writes nothing", async () => {
      const o = await h.org("ingest-mode"); // a TEST-mode connection
      const eventId = `evt_fixture${h.unique()}`;
      expect(await ingest(o.accountId, { eventId, livemode: true })).toEqual({ outcome: "ignored", inboxId: null });
      expect(await h.events(o.organizationId)).toHaveLength(0);
    });

    it("ignores malformed ids, types and oversized bodies", async () => {
      const o = await h.org("ingest-shape");
      for (const overrides of [
        { eventId: "evt_x" },
        { eventId: "not_an_event" },
        { eventType: "UPPER.case" },
        { eventType: "x".repeat(101) },
        { eventType: "" },
        { rawBody: "x".repeat(1_000_001) },
      ]) {
        expect((await ingest(o.accountId, overrides)).outcome, JSON.stringify(overrides).slice(0, 40)).toBe("ignored");
      }
      expect((await ingest("not-an-account")).outcome).toBe("ignored");
      expect(await h.events(o.organizationId)).toHaveLength(0);
    });

    it("a DISCONNECTED connection still ingests (recurring gifts keep arriving, G22)", async () => {
      const o = await h.org("ingest-disconnected");
      await h.owner(sql`select presby_giving__disconnect(${o.connectionId}::uuid, 'treasurer')`);
      expect((await h.connectionRow(o.connectionId)).status).toBe("disconnected");
      expect((await ingest(o.accountId)).outcome).toBe("accepted");
    });

    it("never reads the org's giving toggle: an org with no toggle row ingests", async () => {
      const o = await h.org("ingest-no-toggle");
      const toggles = h.rowsOf(await h.owner(sql`select 1 from organization_feature_toggles where organization_id = ${o.organizationId} and feature_key = 'org_portal.giving'`));
      expect(toggles).toHaveLength(0);
      expect((await ingest(o.accountId)).outcome).toBe("accepted");
    });

    it("the event lands in the org that owns the CONNECTION, whatever else the body says", async () => {
      const a = await h.org("ingest-tenant-a");
      const b = await h.org("ingest-tenant-b");
      const result = await ingest(a.accountId, { rawBody: JSON.stringify({ account: b.accountId, organization: b.organizationId }) });
      expect(result.outcome).toBe("accepted");
      expect(await h.events(b.organizationId)).toHaveLength(0);
      expect(await h.events(a.organizationId)).toHaveLength(1);
    });
  });

  describe("claim_event", () => {
    it("returns the body and leases the row for two minutes; a second claim finds nothing", async () => {
      const o = await h.org("claim");
      const ingested = await ingest(o.accountId);
      const claim = await fns.claimEvent(ingested.inboxId!);
      expect(claim).toMatchObject({ rawBody: '{"fixture":true}', eventType: "charge.succeeded", attempts: 1, bodyPurged: false, accountId: o.accountId, livemode: false });
      expect(claim!.connectionId).toBe(o.connectionId);
      const row = await h.eventRow(ingested.inboxId!);
      expect(row.status).toBe("processing");
      expect(new Date(String(row.locked_until)).getTime()).toBeGreaterThan(Date.now() + 60_000);
      expect(await fns.claimEvent(ingested.inboxId!)).toBeNull();
    });

    it("re-claims a row whose lease has expired, counting another attempt", async () => {
      const o = await h.org("claim-lease");
      const ingested = await ingest(o.accountId);
      await fns.claimEvent(ingested.inboxId!);
      await h.owner(sql`update giving_provider_events set locked_until = now() - interval '1 second' where id = ${ingested.inboxId}`);
      expect((await fns.claimEvent(ingested.inboxId!))!.attempts).toBe(2);
    });

    it("does not claim a parked event before its back-off elapses, nor a finished one", async () => {
      const o = await h.org("claim-backoff");
      const ingested = await ingest(o.accountId);
      await fns.claimEvent(ingested.inboxId!);
      await fns.finishEvent(ingested.inboxId!, "parked", "no_gift");
      expect(await fns.claimEvent(ingested.inboxId!)).toBeNull();
      await h.owner(sql`update giving_provider_events set next_attempt_at = now() - interval '1 second' where id = ${ingested.inboxId}`);
      expect(await fns.claimEvent(ingested.inboxId!)).not.toBeNull();
      await fns.finishEvent(ingested.inboxId!, "applied", null);
      await h.owner(sql`update giving_provider_events set next_attempt_at = now() - interval '1 hour' where id = ${ingested.inboxId}`);
      expect(await fns.claimEvent(ingested.inboxId!)).toBeNull();
    });

    it("an unknown id claims nothing", async () => {
      expect(await fns.claimEvent("00000000-0000-4000-8000-00000000beef")).toBeNull();
    });
  });

  describe("finish_event: back-off, ageing and dead letters", () => {
    async function claimed(attempts = 1) {
      const o = await h.org(`finish-${h.unique()}`);
      const ingested = await ingest(o.accountId);
      let claim = await fns.claimEvent(ingested.inboxId!);
      for (let i = 1; i < attempts; i++) {
        await h.owner(sql`update giving_provider_events set locked_until = now() - interval '1 second' where id = ${ingested.inboxId}`);
        claim = await fns.claimEvent(ingested.inboxId!);
      }
      expect(claim!.attempts).toBe(attempts);
      return { ...o, inboxId: ingested.inboxId! };
    }

    it("applied and ignored are terminal and stamp processed_at; the lease is cleared", async () => {
      for (const outcome of ["applied", "ignored"] as const) {
        const e = await claimed();
        expect(await fns.finishEvent(e.inboxId, outcome, null)).toBe(outcome);
        const row = await h.eventRow(e.inboxId);
        expect(row.status).toBe(outcome);
        expect(row.processed_at).not.toBeNull();
        expect(row.locked_until).toBeNull();
      }
    });

    it("parked backs off 1, 5, 15, 60, 240, 720 minutes by attempt", async () => {
      const expected = [1, 5, 15, 60, 240, 720, 720];
      for (let attempt = 1; attempt <= 7; attempt++) {
        const e = await claimed(attempt);
        await fns.finishEvent(e.inboxId, "parked", "stripe_rate_limited");
        const row = await h.eventRow(e.inboxId);
        const minutes = (new Date(String(row.next_attempt_at)).getTime() - Date.now()) / 60_000;
        expect(row.status, `attempt ${attempt}`).toBe("parked");
        expect(minutes, `attempt ${attempt}`).toBeGreaterThan(expected[attempt - 1]! - 1.5);
        expect(minutes, `attempt ${attempt}`).toBeLessThanOrEqual(expected[attempt - 1]! + 0.5);
      }
    }, 120_000);

    it("a failed or parked event dead-letters at attempt 8", async () => {
      for (const outcome of ["failed", "parked"] as const) {
        const e = await claimed(8);
        expect(await fns.finishEvent(e.inboxId, outcome, "exception")).toBe("dead_letter");
        expect((await h.eventRow(e.inboxId)).processed_at).not.toBeNull();
      }
    }, 120_000);

    it("'dead' dead-letters immediately, with its code", async () => {
      const e = await claimed();
      expect(await fns.finishEvent(e.inboxId, "dead", "over_reversal")).toBe("dead_letter");
      expect(await h.eventRow(e.inboxId)).toMatchObject({ status: "dead_letter", last_error: "over_reversal" });
    });

    it("a no_gift / no_subscription park AGES OUT to ignored once the event is older than 24 hours", async () => {
      for (const code of ["no_gift", "no_subscription"]) {
        const fresh = await claimed();
        expect(await fns.finishEvent(fresh.inboxId, "parked", code)).toBe("parked");

        const old = await claimed();
        await h.owner(sql`update giving_provider_events set received_at = now() - interval '25 hours' where id = ${old.inboxId}`);
        expect(await fns.finishEvent(old.inboxId, "parked", code)).toBe("ignored");
        expect((await h.eventRow(old.inboxId)).processed_at).not.toBeNull();
      }
    });

    it("other parked codes do NOT age out (only a foreign payment's no_gift is expected to)", async () => {
      const old = await claimed();
      await h.owner(sql`update giving_provider_events set received_at = now() - interval '25 hours' where id = ${old.inboxId}`);
      expect(await fns.finishEvent(old.inboxId, "parked", "no_reversal")).toBe("parked");
    });

    it("only a claimed (processing) event can be finished", async () => {
      const o = await h.org("finish-state");
      const ingested = await ingest(o.accountId);
      expect(await fns.finishEvent(ingested.inboxId!, "applied", null)).toBe("not_processing");
      expect(await fns.finishEvent("00000000-0000-4000-8000-00000000beef", "applied", null)).toBe("not_found");
    });

    it("an unknown outcome is refused and changes nothing", async () => {
      const e = await claimed();
      await expect(fns.finishEvent(e.inboxId, "applied; drop table x" as never, null)).rejects.toThrow();
      expect((await h.eventRow(e.inboxId)).status).toBe("processing");
    });

    it("a malformed or long error code is stored as 'invalid_code', never the payload", async () => {
      const e = await claimed();
      await fns.finishEvent(e.inboxId, "ignored", "Fixture Donor <script>");
      expect((await h.eventRow(e.inboxId)).last_error).toBe("invalid_code");
    });
  });

  describe("due_events", () => {
    it("lists received events that are due, expired-lease events, and not parked-in-the-future or finished ones", async () => {
      const o = await h.org("due");
      const received = (await ingest(o.accountId)).inboxId!;
      const parked = (await ingest(o.accountId)).inboxId!;
      const leased = (await ingest(o.accountId)).inboxId!;
      const expired = (await ingest(o.accountId)).inboxId!;
      const done = (await ingest(o.accountId)).inboxId!;
      await fns.claimEvent(parked);
      await fns.finishEvent(parked, "parked", "no_gift"); // backs off into the future
      await fns.claimEvent(leased); // lease live
      await fns.claimEvent(expired);
      await h.owner(sql`update giving_provider_events set locked_until = now() - interval '1 second' where id = ${expired}`);
      await fns.claimEvent(done);
      await fns.finishEvent(done, "applied", null);
      const due = await fns.dueEvents(100);
      expect(due).toContain(received);
      expect(due).toContain(expired);
      for (const not of [parked, leased, done]) expect(due).not.toContain(not);
    });

    it("is bounded by the limit and clamped to 1..100", async () => {
      expect((await fns.dueEvents(1)).length).toBeLessThanOrEqual(1);
      expect((await fns.dueEvents(0)).length).toBeLessThanOrEqual(1); // clamped up to 1
      expect((await fns.dueEvents(10_000)).length).toBeLessThanOrEqual(100);
    });
  });

  describe("purge_bodies and expire_intents (cron hygiene)", () => {
    it("purges the raw body only 90 days after a TERMINAL state, and a purged event reports it on claim", async () => {
      const o = await h.org("purge");
      const oldDone = (await ingest(o.accountId)).inboxId!;
      const recentDone = (await ingest(o.accountId)).inboxId!;
      const oldParked = (await ingest(o.accountId)).inboxId!;
      for (const id of [oldDone, recentDone, oldParked]) await fns.claimEvent(id);
      await fns.finishEvent(oldDone, "applied", null);
      await fns.finishEvent(recentDone, "applied", null);
      await fns.finishEvent(oldParked, "parked", "no_reversal");
      await h.owner(sql`update giving_provider_events set processed_at = now() - interval '91 days' where id = ${oldDone}`);
      await h.owner(sql`update giving_provider_events set received_at = now() - interval '200 days' where id = ${oldParked}`);

      expect(await fns.purgeBodies()).toBeGreaterThanOrEqual(1);
      expect(await h.eventRow(oldDone)).toMatchObject({ raw_body: null });
      expect((await h.eventRow(oldDone)).body_purged_at).not.toBeNull();
      expect((await h.eventRow(recentDone)).raw_body).not.toBeNull();
      expect((await h.eventRow(oldParked)).raw_body).not.toBeNull(); // still working on it

      // Requeue it as the owner would, then claim: the body is gone and the claim says so.
      await h.owner(sql`select presby_giving_requeue_event(${oldDone}::uuid)`); // not a dead letter -> refused
      await h.owner(sql`update giving_provider_events set status = 'received', next_attempt_at = now() where id = ${oldDone}`);
      const claim = await fns.claimEvent(oldDone);
      expect(claim).toMatchObject({ rawBody: null, bodyPurged: true });
    });

    it("expires created/open intents past their expiry and leaves completed ones", async () => {
      const o = await h.org("expire");
      const stale = await h.intent({ ...o, status: "open" });
      const created = await h.intent({ ...o, status: "created", sessionId: null });
      const fresh = await h.intent({ ...o, status: "open" });
      const completed = await h.intent({ ...o, status: "completed" });
      await h.owner(sql`update giving_checkout_intents set expires_at = now() - interval '1 minute' where id in (${stale}, ${created}, ${completed})`);
      expect(await fns.expireIntents()).toBeGreaterThanOrEqual(2);
      expect((await h.intentRow(stale)).status).toBe("expired");
      expect((await h.intentRow(created)).status).toBe("expired");
      expect((await h.intentRow(fresh)).status).toBe("open");
      expect((await h.intentRow(completed)).status).toBe("completed");
    });
  });

  describe("apply_connection_status (account.updated / deauthorized)", () => {
    const status = (o: Partial<{ charges: boolean; payouts: boolean; details: boolean; card: boolean; ach: boolean; due: boolean; reason: string | null }>) => ({
      kind: "connection_status" as const,
      deauthorized: false,
      status: {
        chargesEnabled: o.charges ?? false, payoutsEnabled: o.payouts ?? false, detailsSubmitted: o.details ?? false,
        cardEnabled: o.card ?? false, achEnabled: o.ach ?? false, requirementsDue: o.due ?? false, disabledReason: o.reason ?? null,
      },
    });
    const ACTIVE = { charges: true, payouts: true, details: true, card: true, ach: true };

    async function onboarding() {
      return h.org(`status-${h.unique()}`, { connection: { status: "onboarding" } });
    }

    it("onboarding -> active -> restricted, with the mapping rules; an unchanged snapshot is plain 'applied'", async () => {
      const o = await onboarding();
      expect((await h.connectionRow(o.connectionId)).status).toBe("onboarding");

      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), status({ details: true }))).toBe("applied:status_changed");
      expect((await h.connectionRow(o.connectionId)).status).toBe("restricted"); // details submitted but not active

      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), status(ACTIVE))).toBe("applied:status_changed");
      expect(await h.connectionRow(o.connectionId)).toMatchObject({ status: "active", charges_enabled: true, payouts_enabled: true, card_enabled: true, ach_enabled: true });

      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), status(ACTIVE))).toBe("applied");

      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), status({ ...ACTIVE, due: true }))).toBe("applied:status_changed");
      expect(await h.connectionRow(o.connectionId)).toMatchObject({ status: "restricted", requirements_due: true });

      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), status({ ...ACTIVE, reason: "rejected.fraud" }))).toBe("applied");
      expect(await h.connectionRow(o.connectionId)).toMatchObject({ status: "restricted", disabled_reason: "rejected.fraud" });
    });

    it("a never-started account stays onboarding (and a repeat is 'applied')", async () => {
      const o = await onboarding();
      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), status({}))).toBe("applied");
      expect((await h.connectionRow(o.connectionId)).status).toBe("onboarding");
    });

    it("deauthorized disconnects (system reason), clears the public page, and a repeat is a noop; later statuses cannot revive it", async () => {
      const o = await h.org("status-deauth");
      const deauth = { kind: "connection_status" as const, deauthorized: true, status: status({}).status };
      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), deauth)).toBe("applied:disconnected");
      expect(await h.connectionRow(o.connectionId)).toMatchObject({ status: "disconnected", disconnected_reason: "deauthorized", public_enabled_at: null });
      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), deauth)).toBe("noop");
      expect(await fns.applyConnectionStatus(await h.inbox(o.accountId), status(ACTIVE))).toBe("noop");
      expect((await h.connectionRow(o.connectionId)).status).toBe("disconnected");
    });

    it("an inbox of one connection can only move THAT connection", async () => {
      const a = await onboarding();
      const b = await onboarding();
      await fns.applyConnectionStatus(await h.inbox(a.accountId), status(ACTIVE));
      expect((await h.connectionRow(a.connectionId)).status).toBe("active");
      expect((await h.connectionRow(b.connectionId)).status).toBe("onboarding");
    });
  });

  describe("apply_settlement", () => {
    it("records a payout, upserts on a repeat, and rejects a malformed id / status / amount", async () => {
      const o = await h.org("settle");
      const po = ids.payout();
      const event = { kind: "settlement" as const, externalSettlementId: po, status: "paid" as const, arrivalDate: "2026-10-20", grossCents: 12000, automatic: true };
      expect(await fns.applySettlement(await h.inbox(o.accountId), event)).toBe("applied");
      expect(await fns.applySettlement(await h.inbox(o.accountId), { ...event, status: "failed" })).toBe("applied");
      const rows = await h.settlements(o.organizationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ external_settlement_id: po, status: "failed", automatic: true, arrival_date: "2026-10-20" });
      expect(Number(rows[0]!.gross_cents)).toBe(12000);
      expect(await fns.applySettlement(await h.inbox(o.accountId), { ...event, externalSettlementId: "po_x" })).toBe("dead:bad_reference");
      expect(await fns.applySettlement(await h.inbox(o.accountId), { ...event, status: "bogus" as never })).toBe("dead:bad_status");
      expect(await fns.applySettlement(await h.inbox(o.accountId), { ...event, grossCents: -1 })).toBe("dead:bad_amount");
    });

    it("a test-mode connection's payout is a test-mode settlement", async () => {
      const o = await h.org("settle-mode");
      await fns.applySettlement(await h.inbox(o.accountId), { kind: "settlement", externalSettlementId: ids.payout(), status: "paid", arrivalDate: null, grossCents: 100, automatic: false });
      const row = h.rowsOf(await h.owner(sql`select livemode, automatic from giving_settlements where organization_id = ${o.organizationId}`))[0]!;
      expect(row).toMatchObject({ livemode: false, automatic: false });
    });
  });

  describe("apply_settlement_lines (Batch 6)", () => {
    const header = (po: string, automatic = true) => ({
      kind: "settlement" as const, externalSettlementId: po, status: "paid" as const, arrivalDate: "2026-10-20", grossCents: 4825, automatic,
    });
    const L = (n: string, over: Partial<import("@/lib/giving/ingest/functions").SettlementLineInput> = {}) => ({
      balanceTransactionId: `txn_fixture${n}`, kind: "charge", grossCents: 5000, feeCents: 175, netCents: 4825, paymentIntentId: null, ...over,
    });
    const lineRows = async (organizationId: string) =>
      h.rowsOf(await h.owner(sql`
        select l.external_balance_transaction_id as txn, l.kind, l.gross_cents::int as gross, l.fee_cents::int as fee,
               l.net_cents::int as net, l.payment_intent_id as pi, l.gift_id::text as gift_id
          from giving_settlement_lines l where l.organization_id = ${organizationId}
         order by l.external_balance_transaction_id`));

    it("is PARKED until the payout header exists, writes nothing, and then lands once the header does", async () => {
      const o = await h.org("lines-parked");
      const po = ids.payout();
      expect(await fns.applySettlementLines(await h.inbox(o.accountId), po, [L("parked1")])).toBe("parked:no_settlement");
      expect(await lineRows(o.organizationId)).toHaveLength(0);
      await fns.applySettlement(await h.inbox(o.accountId), header(po));
      expect(await fns.applySettlementLines(await h.inbox(o.accountId), po, [L("parked1")])).toBe("applied");
      expect(await lineRows(o.organizationId)).toHaveLength(1);
    });

    it("stores signed lines through typed arrays, is idempotent per balance transaction, and stamps lines_loaded_at", async () => {
      const o = await h.org("lines-store");
      const po = ids.payout();
      await fns.applySettlement(await h.inbox(o.accountId), header(po));
      const lines = [
        L("aaa"),
        L("bbb", { kind: "refund", grossCents: -1000, feeCents: 0, netCents: -1000, paymentIntentId: "pi_fixtureRefunded01" }),
        L("ccc", { kind: "adjustment", grossCents: 0, feeCents: 15, netCents: -15 }),
      ];
      expect(await fns.applySettlementLines(await h.inbox(o.accountId), po, lines)).toBe("applied");
      expect(await fns.applySettlementLines(await h.inbox(o.accountId), po, lines)).toBe("applied"); // again: no duplicates
      const rows = await lineRows(o.organizationId);
      expect(rows.map((r) => [r.txn, r.kind, r.gross, r.fee, r.net, r.pi])).toEqual([
        ["txn_fixtureaaa", "charge", 5000, 175, 4825, null],
        ["txn_fixturebbb", "refund", -1000, 0, -1000, "pi_fixtureRefunded01"],
        ["txn_fixtureccc", "adjustment", 0, 15, -15, null],
      ]);
      const loaded = h.rowsOf(await h.owner(sql`select lines_loaded_at is not null as loaded from giving_settlements where organization_id = ${o.organizationId}`));
      expect(loaded[0]!.loaded).toBe(true);
    });

    it("an EMPTY payout (no lines) is accepted and marks the payout loaded", async () => {
      const o = await h.org("lines-empty");
      const po = ids.payout();
      await fns.applySettlement(await h.inbox(o.accountId), header(po));
      expect(await fns.applySettlementLines(await h.inbox(o.accountId), po, [])).toBe("applied");
      const loaded = h.rowsOf(await h.owner(sql`select lines_loaded_at is not null as loaded from giving_settlements where organization_id = ${o.organizationId}`));
      expect(loaded[0]!.loaded).toBe(true);
    });

    it("an inbox event of one connection can only fill THAT connection's payout", async () => {
      const a = await h.org("lines-a");
      const b = await h.org("lines-b");
      const po = ids.payout();
      await fns.applySettlement(await h.inbox(a.accountId), header(po));
      // b's claimed event names a's payout id: b has no such payout, so it parks and a's payout is untouched.
      expect(await fns.applySettlementLines(await h.inbox(b.accountId), po, [L("cross")])).toBe("parked:no_settlement");
      expect(await lineRows(a.organizationId)).toHaveLength(0);
      expect(await lineRows(b.organizationId)).toHaveLength(0);
    });

    it("rejects a line shape the table forbids (a malformed payment intent id) - nothing is stored", async () => {
      const o = await h.org("lines-bad");
      const po = ids.payout();
      await fns.applySettlement(await h.inbox(o.accountId), header(po));
      await expect(fns.applySettlementLines(await h.inbox(o.accountId), po, [L("bad", { paymentIntentId: "not-a-pi" })])).rejects.toThrow();
      expect(await lineRows(o.organizationId)).toHaveLength(0);
    });

    it("text that carries a NUL is stripped on its way in, not thrown at the database", async () => {
      const o = await h.org("lines-nul");
      const po = ids.payout();
      await fns.applySettlement(await h.inbox(o.accountId), header(po));
      expect(await fns.applySettlementLines(await h.inbox(o.accountId), po, [L("nul\u0000ok")])).toBe("applied");
      expect((await lineRows(o.organizationId))[0]!.txn).toBe("txn_fixturenulok");
    });
  });

  describe("the presby_app connection cannot reach the inbox or the owner-only functions", () => {
    it("has no privilege on giving_provider_events and cannot execute health / requeue", async () => {
      const { db } = await import("@/lib/db");
      await expect(db.execute(sql`select count(*) from giving_provider_events`)).rejects.toThrow();
      await expect(db.execute(sql`select * from presby_giving_ingest_health()`)).rejects.toThrow();
      await expect(db.execute(sql`select presby_giving_requeue_event('00000000-0000-4000-8000-000000000000'::uuid)`)).rejects.toThrow();
    });
  });
});
