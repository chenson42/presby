/**
 * attention.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, S5 / P3-5): the ONE definition of "needs
 * attention", the recorder's narrowed view (S4), and that test-mode activity
 * is never counted. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/attention.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("attention.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let attention: typeof import("./attention");
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let armGivingWrite: typeof import("@/lib/testing/giving-fixture").armGivingWrite;

  let org: string;
  let conn: string;
  let fund: string;
  let donor: string;
  let treasurer: { personId: string; userId: string };
  let recorder: { personId: string; userId: string };

  async function q(query: ReturnType<typeof sql>) {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  const load = (actor: { personId: string }, has: { view: boolean; record: boolean; manage: boolean }) =>
    withOrgContext(actor.personId, org, (tx) => attention.loadAttention(tx, { organizationId: org, has }));

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    armGivingWrite = mod.armGivingWrite;
    fx = await mod.createGivingFixture("attention-db-test");
    attention = await import("./attention");
    ({ withOrgContext } = await import("@/lib/authz"));

    org = await fx.makeOrg("a", { givingToggle: true });
    fund = await fx.makeFund(org, "General");
    donor = await fx.makeDonor(org, "Attention Donor", { email: "att@example.invalid" });
    treasurer = await fx.makeActor(org, "Tess", "Treasurer", ["giving.view", "giving.record", "giving.manage"]);
    recorder = await fx.makeActor(org, "Rex", "Recorder", ["giving.record"]);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("an organization with nothing wrong is clear, with the connection reported as 'none'", async () => {
    const a = await load(treasurer, { view: true, record: true, manage: true });
    expect(a).toMatchObject({
      scope: "full", failedGifts: 0, stuckPending: 0, monthlyPaymentFailures: 0, parkedEvents: 0, deadLetters: 0,
      staleStatements: 0, possibleDuplicateDonors: 0, linkProposals: 0,
      connection: { state: "none", testMode: false, requirementsDue: false, publicPageOn: false },
    });
    expect(attention.attentionIsClear(a)).toBe(true);
  });

  it("counts live-mode failed gifts (last 90 days) and pending gifts older than a week - never test-mode ones", async () => {
    conn = await fx.makeConnection(org, { status: "active", livemode: true });
    await fx.makeOnlineGift(org, conn, donor, fund, 5_000, { status: "failed" });
    await fx.makeOnlineGift(org, conn, donor, fund, 5_100, { status: "failed", livemode: false }); // rehearsal
    await fx.makeOnlineGift(org, conn, donor, fund, 5_200, { status: "pending" }); // fresh: not stuck
    // a pending gift whose status changed 8 days ago (status_changed_at has a default, so back-date on insert)
    await fx.platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      const intent = fx.rowsOf(await tx.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, donor_id, frequency, method_choice,
               cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status,
               payment_intent_id, expires_at, completed_at)
        values (${org}, ${conn}, ${fund}, ${donor}, 'once', 'bank', false, 6000, 0, 6000, true, ${crypto.randomUUID()},
                'completed', 'pi_fixture_stuck_1', now() + interval '1 day', now()) returning id`))[0]!;
      await tx.execute(sql`
        insert into giving_gifts (organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
               external_transaction_id, method, amount_cents, status, occurred_on, occurred_at, livemode, status_changed_at)
        values (${org}, ${donor}, ${fund}, 'online', 'stripe', ${conn}, ${String(intent.id)}, 'pi_fixture_stuck_1',
                'us_bank_account', 6000, 'pending', current_date - 8, now() - interval '8 days', true, now() - interval '8 days')`);
    });
    const a = await load(treasurer, { view: true, record: false, manage: false });
    expect(a).toMatchObject({ failedGifts: 1, stuckPending: 1 });
    expect(attention.attentionIsClear(a)).toBe(false);
  });

  it("counts active monthly gifts whose last renewal failed (a flag on the schedule, never a gift)", async () => {
    await fx.platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      await tx.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, donor_id, frequency, method_choice,
               cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status,
               subscription_id, expires_at, completed_at, last_payment_failed_at, subscription_ended_at)
        values (${org}, ${conn}, ${fund}, ${donor}, 'monthly', 'card', false, 2500, 0, 2500, true, ${crypto.randomUUID()},
                'completed', 'sub_fixture_failing_1', now() + interval '1 day', now(), now(), null),
               (${org}, ${conn}, ${fund}, ${donor}, 'monthly', 'card', false, 2600, 0, 2600, true, ${crypto.randomUUID()},
                'completed', 'sub_fixture_healthy_1', now() + interval '1 day', now(), null, null),
               (${org}, ${conn}, ${fund}, ${donor}, 'monthly', 'card', false, 2700, 0, 2700, true, ${crypto.randomUUID()},
                'completed', 'sub_fixture_ended_001', now() + interval '1 day', now(), now(), now()),
               (${org}, ${conn}, ${fund}, ${donor}, 'monthly', 'card', false, 2800, 0, 2800, false, ${crypto.randomUUID()},
                'completed', 'sub_fixture_testmode1', now() + interval '1 day', now(), now(), null)`);
    });
    const a = await load(treasurer, { view: true, record: false, manage: false });
    // only the live, still-active schedule whose last renewal failed counts
    expect(a.monthlyPaymentFailures).toBe(1);
  });

  it("reports parked events and dead letters as COUNTS from the DEFINER function (no payloads)", async () => {
    await q(sql`insert into giving_provider_events (organization_id, connection_id, provider, external_event_id, event_type, livemode, raw_body, status, last_error)
                values (${org}, ${conn}, 'stripe', 'evt_fixture_parked_1', 'charge.refunded', true, '{}', 'parked', 'no_gift'),
                       (${org}, ${conn}, 'stripe', 'evt_fixture_dead_001', 'charge.refunded', true, '{}', 'dead_letter', 'amount_mismatch')`);
    const a = await load(treasurer, { view: true, record: false, manage: false });
    expect(a).toMatchObject({ parkedEvents: 1, deadLetters: 1 });
  });

  it("reports the connection's state, test mode, requirements and public page", async () => {
    const a = await load(treasurer, { view: true, record: false, manage: false });
    expect(a.connection).toEqual({ state: "active", testMode: false, requirementsDue: false, publicPageOn: true });
    const testOrg = await fx.makeOrg("test-mode", { givingToggle: true });
    await fx.makeConnection(testOrg, { status: "restricted", livemode: false, isPublic: false });
    const actor = await fx.makeActor(testOrg, "Tom", "Test", ["giving.view"]);
    const t = await withOrgContext(actor.personId, testOrg, (tx) => attention.loadAttention(tx, { organizationId: testOrg, has: { view: true, record: false, manage: false } }));
    expect(t.connection).toMatchObject({ state: "restricted", testMode: true, publicPageOn: false });
    expect(attention.attentionIsClear(t)).toBe(false); // a restricted account needs attention
  });

  it("counts possible duplicate donors and waiting member-link proposals (same queries as their pages)", async () => {
    const dOrg = await fx.makeOrg("dupe-count", { givingToggle: true });
    const actor = await fx.makeActor(dOrg, "Dan", "Lister", ["giving.view", "giving.record"]);
    await fx.makeDonor(dOrg, "Twin Donor");
    await fx.makeDonor(dOrg, "twin donor");
    const memberPerson = await fx.makePerson("Matched", "Member");
    await fx.addMember(dOrg, memberPerson);
    await q(sql`insert into person_identifiers (person_id, kind, value_normalized) values (${memberPerson}, 'email', 'matched@example.invalid')`);
    await fx.makeDonor(dOrg, "Matched Donor", { email: "matched@example.invalid" });
    const a = await withOrgContext(actor.personId, dOrg, (tx) => attention.loadAttention(tx, { organizationId: dOrg, has: { view: true, record: true, manage: false } }));
    expect(a).toMatchObject({ possibleDuplicateDonors: 1, linkProposals: 1 });
    const donors = await import("./donors");
    const panel = await donors.listWaitingLinkSuggestions(actor.personId, dOrg);
    const dupes = await donors.listPossibleDuplicates(actor.personId, dOrg);
    expect(panel.kind === "ok" && panel.suggestions.length).toBe(a.linkProposals);
    expect(dupes.kind === "ok" && dupes.pairs.length).toBe(a.possibleDuplicateDonors);
  });

  it("S4: a recorder sees ONE number (link proposals); everything else is null - and no provider/ledger query runs for them", async () => {
    const a = await load(recorder, { view: false, record: true, manage: false });
    expect(a).toEqual({
      scope: "recorder",
      failedGifts: null, stuckPending: null, monthlyPaymentFailures: null, connection: null, parkedEvents: null,
      deadLetters: null, staleStatements: null, possibleDuplicateDonors: null, linkProposals: 0,
    });
    expect(attention.attentionIsClear(a)).toBe(true);
  });

  it("a manage-only holder gets the full picture (they connect Stripe and must see its state)", async () => {
    const manager = await fx.makeActor(org, "Mia", "Manager", ["giving.manage"]);
    const a = await load(manager, { view: false, record: false, manage: true });
    expect(a.scope).toBe("full");
    expect(a.connection?.state).toBe("active");
  });
});
