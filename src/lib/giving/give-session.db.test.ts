/**
 * DB-backed tests for starting a gift (docs/work-log/2026-10-15-online-giving.md,
 * Batch 4a): the real `presby_giving_create_intent_{public,member}`,
 * `attach_session`, `fail_intent`, `presby_public_giving_config` and
 * `presby_giving_return_state` behind the TypeScript that wraps them, against
 * throwaway tenants (`createGivingFixture`, torn down with their organizations).
 * ONLY the Stripe allowlist is faked: no network call is ever made.
 *
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/give-session.db.test.ts
 *
 * The SQL-level refusal list (§46l) is also pinned in scripts/giving/test-rls-46.sql
 * and giving.db.test.ts; what THIS file adds is the wrapper's behaviour on top:
 * what `GiveResult` each refusal becomes, that the `created` row survives a Stripe
 * failure, that a repeat key never mints a second session, that the member path
 * links a membership and the public path structurally cannot, and that the two
 * page-side readers map the real rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const mockCreateSession = vi.hoisted(() => vi.fn());
const mockConfigured = vi.hoisted(() => vi.fn());
vi.mock("./providers/stripe/client", () => ({
  createCheckoutSession: (...a: unknown[]) => mockCreateSession(...a),
  isStripeConfigured: () => mockConfigured(),
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_fixtureGiveSession";

describe.skipIf(!hasDb)("starting a gift (Postgres-backed)", () => {
  type Fx = Awaited<ReturnType<typeof import("@/lib/testing/giving-fixture").createGivingFixture>>;
  let fx: Fx;
  let mod: typeof import("./give-session");
  let config: typeof import("./public-config");
  let grossUp: typeof import("./money").grossUp;
  let DEFAULT_RATES: typeof import("./money").DEFAULT_RATES;

  let orgA: string;
  let slugA: string;
  let fundGeneral: string;
  let fundBuilding: string; // active, NOT offered online
  let fundRetired: string;
  let connA: string;
  let orgB: string;
  let slugB: string;
  let fundB: string;
  let memberPerson: string;
  let memberMembership: string;
  let otherOrgMembership: string;
  let sessionCounter = 0;

  const q = async (query: ReturnType<typeof sql>) => fx.rowsOf(await fx.platform.execute(query));
  const key = () => crypto.randomUUID();
  const slugOf = async (org: string) => String((await q(sql`select slug from organizations where id = ${org}`))[0]!.slug);

  function parsed(overrides: Partial<import("./give-input").ParsedGive> = {}): import("./give-input").ParsedGive {
    return {
      amountCents: 5000,
      fundId: fundGeneral,
      frequency: "once",
      coverFees: false,
      method: "card",
      idempotencyKey: key(),
      ...overrides,
    };
  }

  const startPublic = (p: import("./give-input").ParsedGive, slug = slugA) =>
    mod.startGiveSession({ surface: "public", slug, parsed: p, create: () => mod.createPublicIntent(slug, p) });

  const intentFor = async (idempotencyKey: string) =>
    (await q(sql`select * from giving_checkout_intents where idempotency_key = ${idempotencyKey}`))[0];

  beforeAll(async () => {
    const { createGivingFixture } = await import("@/lib/testing/giving-fixture");
    fx = await createGivingFixture("give-session");
    mod = await import("./give-session");
    config = await import("./public-config");
    ({ grossUp, DEFAULT_RATES } = await import("./money"));

    orgA = await fx.makeOrg("live", { givingToggle: true });
    slugA = await slugOf(orgA);
    connA = await fx.makeConnection(orgA, { status: "active", livemode: false });
    fundGeneral = await fx.makeFund(orgA, "General Fund", { offeredOnline: true });
    fundBuilding = await fx.makeFund(orgA, "Building Fund", { offeredOnline: false });
    fundRetired = await fx.makeFund(orgA, "Old Missions", { retired: true });

    orgB = await fx.makeOrg("other", { givingToggle: true });
    slugB = await slugOf(orgB);
    await fx.makeConnection(orgB, { status: "active", livemode: false });
    fundB = await fx.makeFund(orgB, "Bramble General", { offeredOnline: true });

    memberPerson = await fx.makePerson("Odalys", "Giver");
    await fx.enroll(orgA, memberPerson, []);
    memberMembership = await fx.membershipOf(orgA, memberPerson);
    const otherPerson = await fx.makePerson("Talbot", "Elsewhere");
    await fx.enroll(orgB, otherPerson, []);
    otherOrgMembership = await fx.membershipOf(orgB, otherPerson);
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    mockConfigured.mockReturnValue(true);
    mockCreateSession.mockImplementation(async () => {
      sessionCounter += 1;
      return { sessionId: `cs_test_fixtureGive${Date.now()}${sessionCounter}`, url: CHECKOUT_URL };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // -------------------------------------------------------------------------
  describe("the public path", () => {
    it("writes the `created` intent, calls Stripe with the DATABASE's total, attaches the session -> `open`", async () => {
      const p = parsed({ amountCents: 5000, coverFees: true, method: "card" });
      const result = await startPublic(p);
      expect(result).toEqual({ kind: "checkout", url: CHECKOUT_URL });

      const row = (await intentFor(p.idempotencyKey))!;
      expect(row.status).toBe("open");
      expect(row.checkout_session_id).toMatch(/^cs_test_fixtureGive/);
      expect(row.membership_id).toBeNull(); // the public path is structurally unable to link
      expect(row.organization_id).toBe(orgA);
      expect(row.fund_id).toBe(fundGeneral);
      expect(row.livemode).toBe(false);

      // The charged total is the database's, and the TypeScript preview agrees to the cent.
      const expected = grossUp(5000, "card", DEFAULT_RATES);
      expect(Number(row.total_cents)).toBe(expected.totalCents);
      expect(Number(row.donor_covered_fee_cents)).toBe(expected.coveredCents);
      expect(mockCreateSession.mock.calls[0]![0]).toMatchObject({
        totalCents: expected.totalCents,
        coveredFeeCents: expected.coveredCents,
        fundDisplayName: "General Fund",
        intentId: row.id,
        idempotencyKey: `giving-session:${row.id}`,
        mode: "payment",
      });
    });

    it("a monthly gift is a subscription-mode session and the intent says so", async () => {
      const p = parsed({ frequency: "monthly" });
      expect((await startPublic(p)).kind).toBe("checkout");
      expect((await intentFor(p.idempotencyKey))!.frequency).toBe("monthly");
      expect(mockCreateSession.mock.calls[0]![0].mode).toBe("subscription");
    });

    it("Stripe NOT configured: the intent is written `failed` BEFORE the honest `unavailable` (the e2e path)", async () => {
      mockConfigured.mockReturnValue(false);
      const p = parsed({ amountCents: 3750, frequency: "monthly" });
      expect(await startPublic(p)).toEqual({ kind: "unavailable" });
      const row = (await intentFor(p.idempotencyKey))!;
      expect(row.status).toBe("failed");
      expect(row.fund_id).toBe(fundGeneral);
      expect(Number(row.gift_amount_cents)).toBe(3750);
      expect(Number(row.total_cents)).toBe(3750);
      expect(row.frequency).toBe("monthly");
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it("a Stripe failure leaves a `failed` row (never a vanished attempt) and answers `error`", async () => {
      mockCreateSession.mockRejectedValue(new Error("stripe is down"));
      const p = parsed();
      expect(await startPublic(p)).toEqual({ kind: "error" });
      const row = (await intentFor(p.idempotencyKey))!;
      expect(row.status).toBe("failed");
      expect(row.checkout_session_id).toBeNull();
    });

    it("a repeat of a started key is `already_started`: one intent, one session, no second Stripe call", async () => {
      const p = parsed();
      expect((await startPublic(p)).kind).toBe("checkout");
      expect(await startPublic(p)).toEqual({ kind: "already_started" });
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(await q(sql`select id from giving_checkout_intents where idempotency_key = ${p.idempotencyKey}`)).toHaveLength(1);
    });

    it("a repeat of a FAILED key never hands out a URL for the dead intent", async () => {
      mockConfigured.mockReturnValue(false);
      const p = parsed();
      expect(await startPublic(p)).toEqual({ kind: "unavailable" });
      mockConfigured.mockReturnValue(true);
      expect(await startPublic(p)).toEqual({ kind: "error" });
      expect((await intentFor(p.idempotencyKey))!.status).toBe("failed");
    });

    it("two concurrent submits of one key: one intent; neither is ever handed a URL for a different session", async () => {
      const p = parsed();
      const [a, b] = await Promise.all([startPublic(p), startPublic(p)]);
      expect(await q(sql`select id from giving_checkout_intents where idempotency_key = ${p.idempotencyKey}`)).toHaveLength(1);
      const kinds = [a.kind, b.kind].sort();
      // Either one wins and the other is told it was already started, or both get the (Stripe-idempotent) URL.
      expect(["already_started", "checkout"]).toEqual(expect.arrayContaining([kinds[0]!]));
      expect(["already_started", "checkout"]).toEqual(expect.arrayContaining([kinds[1]!]));
      expect((await intentFor(p.idempotencyKey))!.status).toBe("open");
    });
  });

  // -------------------------------------------------------------------------
  describe("refusals (the §46l list, seen through the wrapper)", () => {
    it("a retired fund, an offline-only fund and ANOTHER organization's fund are `invalid` on the fund, with no intent row", async () => {
      for (const fundId of [fundRetired, fundBuilding, fundB]) {
        const p = parsed({ fundId });
        expect(await startPublic(p)).toEqual({
          kind: "invalid",
          field: "fund",
          message: expect.stringContaining("isn't available"),
        });
        expect(await intentFor(p.idempotencyKey)).toBeUndefined();
      }
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it("a method the connection does not offer is `invalid` on the method", async () => {
      const cardOnly = await fx.makeOrg("cardonly", { givingToggle: true });
      const slug = await slugOf(cardOnly);
      const conn = await fx.makeConnection(cardOnly, { status: "active" });
      const fund = await fx.makeFund(cardOnly, "General", { offeredOnline: true });
      await fx.platform.transaction(async (tx) => {
        const { armGivingWrite } = await import("@/lib/testing/giving-fixture");
        await armGivingWrite(tx);
        await tx.execute(sql`update giving_provider_connections set ach_enabled = false where id = ${conn}`);
      });
      const p = parsed({ fundId: fund, method: "bank" });
      expect(await mod.startGiveSession({ surface: "public", slug, parsed: p, create: () => mod.createPublicIntent(slug, p) })).toMatchObject({
        kind: "invalid",
        field: "method",
      });
    });

    it("an unknown slug and an organization with no live connection are the same `unavailable`", async () => {
      const unknown = parsed();
      expect(
        await mod.startGiveSession({
          surface: "public",
          slug: "no-such-congregation-dbtest",
          parsed: unknown,
          create: () => mod.createPublicIntent("no-such-congregation-dbtest", unknown),
        }),
      ).toEqual({ kind: "unavailable" });

      const onboarding = await fx.makeOrg("onboarding", { givingToggle: true });
      const slug = await slugOf(onboarding);
      await fx.makeConnection(onboarding, { status: "onboarding" });
      const fund = await fx.makeFund(onboarding, "General", { offeredOnline: true });
      const p = parsed({ fundId: fund });
      expect(await mod.startGiveSession({ surface: "public", slug, parsed: p, create: () => mod.createPublicIntent(slug, p) })).toEqual({
        kind: "unavailable",
      });
    });

    it("a toggle-OFF organization is `unavailable` even with a live connection", async () => {
      const off = await fx.makeOrg("toggleoff", { givingToggle: false });
      const slug = await slugOf(off);
      await fx.makeConnection(off, { status: "active" });
      const fund = await fx.makeFund(off, "General", { offeredOnline: true });
      const p = parsed({ fundId: fund });
      expect(await mod.startGiveSession({ surface: "public", slug, parsed: p, create: () => mod.createPublicIntent(slug, p) })).toEqual({
        kind: "unavailable",
      });
    });

    it("the per-organization flood cap: the 201st `created` intent in an hour is `rate_limited`", async () => {
      const busy = await fx.makeOrg("busy", { givingToggle: true });
      const slug = await slugOf(busy);
      const conn = await fx.makeConnection(busy, { status: "active" });
      const fund = await fx.makeFund(busy, "General", { offeredOnline: true });
      await fx.platform.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, frequency, method_choice, cover_fees,
               gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status, expires_at)
        select ${busy}, ${conn}, ${fund}, 'once', 'card', false, 1000, 0, 1000, false, gen_random_uuid()::text, 'created',
               now() + interval '1 day'
          from generate_series(1, 200)`);
      const p = parsed({ fundId: fund });
      const result = await mod.startGiveSession({ surface: "public", slug, parsed: p, create: () => mod.createPublicIntent(slug, p) });
      expect(result).toMatchObject({ kind: "rate_limited" });
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(await intentFor(p.idempotencyKey)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("the member path", () => {
    const startMember = (p: import("./give-input").ParsedGive, membershipId = memberMembership) =>
      mod.startGiveSession({
        surface: "member",
        slug: slugA,
        parsed: p,
        create: () => mod.createMemberIntent({ personId: memberPerson, organizationId: orgA }, membershipId, p),
      });

    it("links the intent to the viewer's own membership and returns to the member pages", async () => {
      const p = parsed({ amountCents: 2500 });
      expect((await startMember(p)).kind).toBe("checkout");
      const row = (await intentFor(p.idempotencyKey))!;
      expect(row.membership_id).toBe(memberMembership);
      expect(row.status).toBe("open");
      expect(mockCreateSession.mock.calls[0]![0].successUrl).toContain(`/o/${slugA}/giving/give/return?session_id=`);
    });

    it("ANOTHER organization's membership id is `invalid` and writes nothing (a member cannot name someone else's)", async () => {
      const p = parsed();
      expect(await startMember(p, otherOrgMembership)).toMatchObject({ kind: "invalid", field: "form" });
      expect(await intentFor(p.idempotencyKey)).toBeUndefined();
    });

    it("a person with no membership at the organization cannot even open the transaction", async () => {
      const stranger = await fx.makePerson("Brannoc", "Stranger");
      const p = parsed();
      const result = await mod.startGiveSession({
        surface: "member",
        slug: slugA,
        parsed: p,
        create: () => mod.createMemberIntent({ personId: stranger, organizationId: orgA }, memberMembership, p),
      });
      expect(result).toEqual({ kind: "error" });
      expect(await intentFor(p.idempotencyKey)).toBeUndefined();
    });

    it("Stripe unset records a failed member intent and says `unavailable`", async () => {
      mockConfigured.mockReturnValue(false);
      const p = parsed();
      expect(await startMember(p)).toEqual({ kind: "unavailable" });
      const row = (await intentFor(p.idempotencyKey))!;
      expect(row.status).toBe("failed");
      expect(row.membership_id).toBe(memberMembership);
    });
  });

  // -------------------------------------------------------------------------
  describe("readPublicGivingConfig", () => {
    it("`live` for the fixture: funds in order, enabled methods, the org's own rates, bounds, test-mode flag, no account id", async () => {
      const c = await config.readPublicGivingConfig(slugA);
      expect(c.state).toBe("live");
      if (c.state !== "live") return;
      expect(c.funds).toEqual([{ id: fundGeneral, name: "General Fund" }]);
      expect(c.cardEnabled).toBe(true);
      expect(c.achEnabled).toBe(true);
      expect(c.livemode).toBe(false);
      expect(c.rates).toEqual(DEFAULT_RATES);
      expect([c.minAmountCents, c.maxAmountCents]).toEqual([100, 2_500_000]);
      expect(JSON.stringify(c)).not.toMatch(/acct_/);
      expect(JSON.stringify(c)).not.toContain(orgA);
    });

    it("`absent` is identical for an unknown slug, a non-tenant slug and a toggle-off organization", async () => {
      const off = await fx.makeOrg("absentoff", { givingToggle: false });
      await fx.makeConnection(off, { status: "active" });
      await fx.makeFund(off, "General", { offeredOnline: true });
      const nonTenant = await fx.makeOrg("nontenant"); // no toggle row, no connection
      const results = await Promise.all([
        config.readPublicGivingConfig("no-such-congregation-dbtest"),
        config.readPublicGivingConfig(await slugOf(off)),
        config.readPublicGivingConfig(await slugOf(nonTenant)),
        config.readPublicGivingConfig("Not A Slug"),
      ]);
      for (const r of results) expect(r).toEqual({ state: "absent" });
    });

    it("`unavailable` needs a live published site: the name and the public phone only", async () => {
      const site = await fx.makeOrg("sitelive", { givingToggle: true });
      const slug = await slugOf(site);
      await fx.platform.execute(sql`insert into organization_sites (organization_id, repo, status)
        values (${site}, ${`fixture-sites/give-session-${site}`}, 'live')`);
      const c = await config.readPublicGivingConfig(slug);
      expect(c.state).toBe("unavailable");
      if (c.state === "unavailable") {
        expect(c.organizationName).toContain("sitelive");
        expect(Object.keys(c).sort()).toEqual(["contactPhone", "organizationName", "state"]);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("readReturnState: the five panels from presby's own rows", () => {
    async function intentWithSession(options: {
      status?: string;
      frequency?: "once" | "monthly";
      subscriptionId?: string | null;
      org?: string;
      fund?: string;
      conn?: string;
      covered?: number;
    }) {
      const sessionId = `cs_test_fixtureReturn${Date.now()}${(sessionCounter += 1)}`;
      const org = options.org ?? orgA;
      const total = 5000 + (options.covered ?? 0);
      await fx.platform.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, frequency, method_choice, cover_fees,
               gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status,
               checkout_session_id, subscription_id, expires_at)
        values (${org}, ${options.conn ?? connA}, ${options.fund ?? fundGeneral}, ${options.frequency ?? "once"}, 'card',
                ${(options.covered ?? 0) > 0}, 5000, ${options.covered ?? 0}, ${total}, false, ${key()},
                ${options.status ?? "open"}, ${sessionId}, ${options.subscriptionId ?? null}, now() + interval '1 day')`);
      return sessionId;
    }

    it("`unknown` is the same for an absent, malformed and another organization's session id", async () => {
      const foreign = await intentWithSession({ org: orgB, fund: fundB, conn: (await q(sql`select id from giving_provider_connections where organization_id = ${orgB}`))[0]!.id as string });
      const expected = { state: "unknown" };
      expect(await config.readReturnState(slugA, "cs_test_doesNotExist0001")).toEqual(expected);
      expect(await config.readReturnState(slugA, "garbage")).toEqual(expected);
      expect(await config.readReturnState(slugA, foreign)).toEqual(expected);
      expect(await config.readReturnState("no-such-congregation-dbtest", foreign)).toEqual(expected);
      // ...and the foreign session is found under ITS OWN organization.
      expect((await config.readReturnState(slugB, foreign)).state).toBe("confirming");
    });

    it("`confirming` while the webhook is outstanding: the donor-visible facts and nothing else", async () => {
      const id = await intentWithSession({ status: "open", covered: 175 });
      expect(await config.readReturnState(slugA, id)).toEqual({
        state: "confirming",
        giftAmountCents: 5000,
        coveredCents: 175,
        fundName: "General Fund",
        frequency: "once",
        livemode: false,
      });
    });

    it("`failed` for a failed or expired intent; `received` for a monthly gift whose subscription exists", async () => {
      expect((await config.readReturnState(slugA, await intentWithSession({ status: "failed" }))).state).toBe("failed");
      expect((await config.readReturnState(slugA, await intentWithSession({ status: "expired" }))).state).toBe("failed");
      const monthly = await config.readReturnState(
        slugA,
        await intentWithSession({ status: "completed", frequency: "monthly", subscriptionId: "sub_fixtureReturn0001" }),
      );
      expect(monthly).toMatchObject({ state: "received", frequency: "monthly" });
    });

    it("`received` for a succeeded gift and `bank_pending` for a pending one, found through the intent", async () => {
      const donor = await fx.makeDonor(orgA, "Quillon Fixture");
      const succeeded = await fx.makeOnlineGift(orgA, connA, donor, fundGeneral, 5000, { status: "succeeded", livemode: false });
      const pending = await fx.makeOnlineGift(orgA, connA, donor, fundGeneral, 6000, { status: "pending", livemode: false });
      const failed = await fx.makeOnlineGift(orgA, connA, donor, fundGeneral, 7000, { status: "failed", livemode: false });
      const sessionFor = async (giftId: string) => {
        const sessionId = `cs_test_fixtureGift${Date.now()}${(sessionCounter += 1)}`;
        await fx.platform.execute(sql`update giving_checkout_intents set checkout_session_id = ${sessionId}
          where id = (select intent_id from giving_gifts where id = ${giftId})`);
        return sessionId;
      };
      expect(await config.readReturnState(slugA, await sessionFor(succeeded))).toMatchObject({ state: "received", giftAmountCents: 5000 });
      expect((await config.readReturnState(slugA, await sessionFor(pending))).state).toBe("bank_pending");
      expect((await config.readReturnState(slugA, await sessionFor(failed))).state).toBe("failed");
    });
  });
});
