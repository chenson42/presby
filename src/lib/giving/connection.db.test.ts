/**
 * connection.ts against a REAL Postgres connection with a MOCKED Stripe client
 * and audit writer - docs/work-log/2026-10-15-online-giving.md, Batch 3a. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/connection.db.test.ts
 *
 * What is proved here: the giving.manage gate inside every function; org
 * derivation from the identity (a manager of org A cannot reach org B); the
 * connection row's life (create -> onboarding -> active -> public -> disconnect),
 * including the idempotency key shape, the lost-race path, and every refusal.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { ProviderError } from "./providers/stripe/errors";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const stripe = vi.hoisted(() => ({
  isStripeConfigured: vi.fn(),
  platformMode: vi.fn(() => "test"),
  createConnectedAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  retrieveConnectedAccount: vi.fn(),
}));
vi.mock("./providers/stripe/client", () => stripe);

const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => String(key) }),
  recordAudit: audit.recordAudit,
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const ACTIVE = {
  chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, cardEnabled: true, achEnabled: true,
  requirementsDue: false, disabledReason: null,
};
const ORIGIN = "https://presby.example.invalid";

describe.skipIf(!hasDb)("connection.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let conn: typeof import("./connection");
  let counter = 0;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("connection-db-test");
    conn = await import("./connection");
  });
  afterAll(async () => {
    await fx?.cleanup();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
    stripe.isStripeConfigured.mockReturnValue(true);
    stripe.createConnectedAccount.mockImplementation(async () => ({ accountId: `acct_fixture${Date.now()}${(counter += 1)}`, livemode: false }));
    stripe.createOnboardingLink.mockResolvedValue({ url: "https://accounts.stripe.com/r/acct_fixture", expiresAt: null });
    stripe.retrieveConnectedAccount.mockResolvedValue(ACTIVE);
  });

  /** A congregation with a treasurer (all three keys), a viewer and a plain member. */
  async function scene(name = `c-${(counter += 1)}`) {
    const organizationId = await fx.makeOrg(name, { givingToggle: true });
    const manager = await fx.makeActor(organizationId, "Tess", "Manager", ["giving.view", "giving.record", "giving.manage"]);
    const viewer = await fx.makeActor(organizationId, "Vera", "Viewer", ["giving.view"]);
    const nobody = await fx.makeActor(organizationId, "Nora", "Nobody", []);
    const id = (a: { personId: string; userId: string }) => ({ personId: a.personId, organizationId, userId: a.userId, email: "tess.manager@example.invalid" });
    return { organizationId, manager: id(manager), viewer: id(viewer), nobody: id(nobody), slug: await slugOf(organizationId) };
  }
  async function slugOf(organizationId: string) {
    return String(fx.rowsOf(await fx.platform.execute(sql`select slug from organizations where id = ${organizationId}`))[0]!.slug);
  }
  const connections = async (organizationId: string) =>
    fx.rowsOf(await fx.platform.execute(sql`select * from giving_provider_connections where organization_id = ${organizationId} order by created_at`));

  describe("the gate", () => {
    it("every function refuses a holder of no manage key (viewer, nobody) and touches neither Stripe nor the table", async () => {
      const s = await scene();
      for (const who of [s.viewer, s.nobody]) {
        expect(await conn.loadConnectionPanel(who.personId, s.organizationId)).toEqual({ kind: "forbidden" });
        expect((await conn.startConnect(who, s.slug)).result).toEqual({ kind: "forbidden" });
        expect(await conn.continueConnect(who, s.slug)).toEqual({ kind: "forbidden" });
        expect(await conn.refreshConnection(who)).toEqual({ kind: "forbidden" });
        expect(await conn.attestPayouts(who)).toEqual({ kind: "forbidden" });
        expect(await conn.setPublicPage(who, true)).toEqual({ kind: "forbidden" });
        expect(await conn.updateRates(who, { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 })).toEqual({ kind: "forbidden" });
        expect(await conn.disconnectConnection(who)).toEqual({ kind: "forbidden" });
      }
      expect(stripe.createConnectedAccount).not.toHaveBeenCalled();
      expect(stripe.createOnboardingLink).not.toHaveBeenCalled();
      expect(await connections(s.organizationId)).toHaveLength(0);
    });

    it("a manager of org A cannot act on org B: the membership check throws before anything is read", async () => {
      const a = await scene();
      const b = await scene();
      const crossed = { ...a.manager, organizationId: b.organizationId };
      await expect(conn.startConnect(crossed, b.slug)).rejects.toThrow();
      await expect(conn.loadConnectionPanel(a.manager.personId, b.organizationId)).rejects.toThrow();
      expect(await connections(b.organizationId)).toHaveLength(0);
    });
  });

  describe("loadConnectionPanel: the projection the connect panel renders", () => {
    it("state 'none' before the first connect, with the online-fund count and no connection", async () => {
      const s = await scene();
      await fx.makeFund(s.organizationId, "General", { offeredOnline: true });
      await fx.makeFund(s.organizationId, "Retired", { retired: true });
      await fx.makeFund(s.organizationId, "Offline only", { offeredOnline: false });
      const result = await conn.loadConnectionPanel(s.manager.personId, s.organizationId);
      expect(result).toMatchObject({
        kind: "ok",
        panel: {
          state: "none", stripeConfigured: true, platformMode: "test", connection: null, onlineFundCount: 1, activeSchedules: 0,
          readiness: { missing: ["connection_active", "payouts_attested"], canGoPublic: false },
        },
      });
    });

    it("state 'unconfigured' when the installation has no Stripe, or no canonical origin", async () => {
      const s = await scene();
      stripe.isStripeConfigured.mockReturnValue(false);
      expect(await conn.loadConnectionPanel(s.manager.personId, s.organizationId)).toMatchObject({ panel: { state: "unconfigured", stripeConfigured: false } });
      stripe.isStripeConfigured.mockReturnValue(true);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      expect(await conn.loadConnectionPanel(s.manager.personId, s.organizationId)).toMatchObject({ panel: { state: "unconfigured" } });
    });

    it("reports the six states from the row and the full view, with ISO strings and the rates", async () => {
      const s = await scene();
      const start = await conn.startConnect(s.manager, s.slug);
      expect(start.result.kind).toBe("redirect");
      let panel = (await conn.loadConnectionPanel(s.manager.personId, s.organizationId) as { panel: import("./connection").ConnectionPanel }).panel;
      expect(panel.state).toBe("onboarding");
      expect(panel.connection).toMatchObject({
        status: "onboarding", livemode: false, chargesEnabled: false, requirementsDue: false, payoutsAttestedAt: null, publicEnabledAt: null,
        disconnectedAt: null, disconnectedReason: null, rates: { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 },
      });
      expect(panel.connection!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

      await conn.refreshConnection(s.manager);
      panel = (await conn.loadConnectionPanel(s.manager.personId, s.organizationId) as { panel: import("./connection").ConnectionPanel }).panel;
      expect(panel.state).toBe("active");

      stripe.retrieveConnectedAccount.mockResolvedValue({ ...ACTIVE, requirementsDue: true });
      await conn.refreshConnection(s.manager);
      panel = (await conn.loadConnectionPanel(s.manager.personId, s.organizationId) as { panel: import("./connection").ConnectionPanel }).panel;
      expect(panel.state).toBe("restricted");
      expect(panel.connection!.requirementsDue).toBe(true);

      await conn.disconnectConnection(s.manager);
      panel = (await conn.loadConnectionPanel(s.manager.personId, s.organizationId) as { panel: import("./connection").ConnectionPanel }).panel;
      expect(panel.state).toBe("disconnected");
      expect(panel.connection).toMatchObject({ status: "disconnected", disconnectedReason: "treasurer" });
      expect(panel.connection!.disconnectedAt).toMatch(/Z$/);
    });
  });

  describe("startConnect", () => {
    it("creates the Stripe account and the row (born onboarding, mode from Stripe, creator recorded) and returns the origin-asserted URL", async () => {
      const s = await scene();
      stripe.createConnectedAccount.mockResolvedValue({ accountId: "acct_fixtureStartLive001", livemode: true });
      const out = await conn.startConnect(s.manager, s.slug);
      expect(out.result).toEqual({ kind: "redirect", url: "https://accounts.stripe.com/r/acct_fixture" });
      expect(out.created).toBe(true);
      const rows = await connections(s.organizationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        external_account_id: "acct_fixtureStartLive001", livemode: true, status: "onboarding", provider: "stripe",
        charges_enabled: false, public_enabled_at: null, payouts_attested_at: null,
      });
      expect(rows[0]!.created_by).toBe(s.manager.userId);
      expect(out.connectionId).toBe(rows[0]!.id);
    });

    it("builds the account request from the org's name and the signed-in user's email, with the org-scoped idempotency key", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      expect(stripe.createConnectedAccount).toHaveBeenCalledWith({
        displayName: expect.stringContaining("Fixture"),
        contactEmail: "tess.manager@example.invalid",
        idempotencyKey: `giving-connect:${s.organizationId}:0`,
      });
    });

    it("the redirect and refresh URLs are fixed paths on the CONFIGURED origin, whatever else is in play", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      expect(stripe.createOnboardingLink).toHaveBeenCalledWith({
        accountId: expect.stringMatching(/^acct_/),
        returnUrl: `${ORIGIN}/o/${s.slug}/admin/giving/connect/return`,
        refreshUrl: `${ORIGIN}/o/${s.slug}/admin/giving/connect/refresh`,
      });
    });

    it("a second start while a connection is open is 'already_connected' and calls Stripe no further", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      stripe.createConnectedAccount.mockClear();
      expect((await conn.startConnect(s.manager, s.slug)).result).toEqual({ kind: "already_connected" });
      expect(stripe.createConnectedAccount).not.toHaveBeenCalled();
      expect(await connections(s.organizationId)).toHaveLength(1);
    });

    it("two simultaneous starts yield ONE connection (the one-open index), and exactly one reports 'created'", async () => {
      const s = await scene();
      stripe.createConnectedAccount.mockResolvedValue({ accountId: "acct_fixtureRaceOne0001", livemode: false }); // same idempotency key => same account
      const [a, b] = await Promise.all([conn.startConnect(s.manager, s.slug), conn.startConnect(s.manager, s.slug)]);
      expect(await connections(s.organizationId)).toHaveLength(1);
      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
      for (const r of [a, b]) expect(["redirect", "already_connected"]).toContain(r.result.kind);
    });

    it("a lost race to a DIFFERENT account is 'already_connected', not a second row", async () => {
      const s = await scene();
      let call = 0;
      stripe.createConnectedAccount.mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          // while "Stripe" answers, another tab connects a different account
          await fx.platform.execute(sql`
            insert into giving_provider_connections (organization_id, provider, external_account_id, livemode)
            values (${s.organizationId}, 'stripe', 'acct_fixtureOtherTab0001', false)`);
        }
        return { accountId: "acct_fixtureMineLost0001", livemode: false };
      });
      const out = await conn.startConnect(s.manager, s.slug);
      expect(out.result).toEqual({ kind: "already_connected" });
      expect(out.created).toBe(false);
      expect((await connections(s.organizationId)).map((r) => r.external_account_id)).toEqual(["acct_fixtureOtherTab0001"]);
    });

    it("Stripe refusing the account leaves nothing behind", async () => {
      const s = await scene();
      stripe.createConnectedAccount.mockRejectedValue(new ProviderError("stripe_error"));
      const out = await conn.startConnect(s.manager, s.slug);
      expect(out).toMatchObject({ result: { kind: "provider_error" }, created: false });
      expect(await connections(s.organizationId)).toHaveLength(0);
    });

    it("the row exists even if the onboarding link then fails: created is true, and Continue picks it up", async () => {
      const s = await scene();
      stripe.createOnboardingLink.mockRejectedValueOnce(new ProviderError("network"));
      const out = await conn.startConnect(s.manager, s.slug);
      expect(out).toMatchObject({ result: { kind: "provider_error" }, created: true });
      expect(await connections(s.organizationId)).toHaveLength(1);
      expect(await conn.continueConnect(s.manager, s.slug)).toEqual({ kind: "redirect", url: "https://accounts.stripe.com/r/acct_fixture" });
    });

    it("an unusable installation (no Stripe / no origin) is 'stripe_unconfigured' with no network and no row", async () => {
      const s = await scene();
      stripe.isStripeConfigured.mockReturnValue(false);
      expect((await conn.startConnect(s.manager, s.slug)).result).toEqual({ kind: "stripe_unconfigured" });
      stripe.isStripeConfigured.mockReturnValue(true);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://insecure.example.invalid");
      expect((await conn.startConnect(s.manager, s.slug)).result).toEqual({ kind: "stripe_unconfigured" });
      expect(stripe.createConnectedAccount).not.toHaveBeenCalled();
      expect(await connections(s.organizationId)).toHaveLength(0);
    });

    it("never calls Stripe without a contact email", async () => {
      const s = await scene();
      expect((await conn.startConnect({ ...s.manager, email: null }, s.slug)).result).toEqual({ kind: "provider_error" });
      expect(stripe.createConnectedAccount).not.toHaveBeenCalled();
    });

    it("a RE-connect after a disconnect gets a fresh idempotency key and a fresh row; history stays on the old one", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      await conn.disconnectConnection(s.manager);
      stripe.createConnectedAccount.mockClear();
      const again = await conn.startConnect(s.manager, s.slug);
      expect(again.result.kind).toBe("redirect");
      expect(stripe.createConnectedAccount.mock.calls[0]![0].idempotencyKey).toBe(`giving-connect:${s.organizationId}:1`);
      const rows = await connections(s.organizationId);
      expect(rows.map((r) => r.status)).toEqual(["disconnected", "onboarding"]);
    });
  });

  describe("continueConnect", () => {
    it("is 'no_connection' before a connect, and mints a link on the OPEN connection's account after", async () => {
      const s = await scene();
      expect(await conn.continueConnect(s.manager, s.slug)).toEqual({ kind: "no_connection" });
      stripe.createConnectedAccount.mockResolvedValue({ accountId: "acct_fixtureContinue001", livemode: false });
      await conn.startConnect(s.manager, s.slug);
      stripe.createOnboardingLink.mockClear();
      expect((await conn.continueConnect(s.manager, s.slug)).kind).toBe("redirect");
      expect(stripe.createOnboardingLink.mock.calls[0]![0].accountId).toBe("acct_fixtureContinue001");
    });

    it("is 'no_connection' once the connection is disconnected", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      await conn.disconnectConnection(s.manager);
      expect(await conn.continueConnect(s.manager, s.slug)).toEqual({ kind: "no_connection" });
    });

    it("provider failure is 'provider_error'", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      stripe.createOnboardingLink.mockRejectedValue(new ProviderError("rate_limited"));
      expect(await conn.continueConnect(s.manager, s.slug)).toEqual({ kind: "provider_error" });
    });
  });

  describe("refreshConnection: the URL proves nothing, the retrieve does", () => {
    it("maps the retrieved account through the database function and audits a status CHANGE once", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      const first = await conn.refreshConnection(s.manager);
      expect(first).toEqual({ kind: "ok", outcome: "applied:status_changed", status: ACTIVE });
      expect((await connections(s.organizationId))[0]).toMatchObject({ status: "active", charges_enabled: true, card_enabled: true, ach_enabled: true });
      expect(audit.recordAudit).toHaveBeenCalledTimes(1);
      expect(audit.recordAudit.mock.calls[0]![0]).toMatchObject({ action: "GIVING_CONNECTION_STATUS_CHANGED", resourceType: "giving_provider_connection" });

      const second = await conn.refreshConnection(s.manager);
      expect(second).toMatchObject({ kind: "ok", outcome: "applied" });
      expect(audit.recordAudit).toHaveBeenCalledTimes(1); // unchanged => silent
    });

    it("asks Stripe about the open connection's own account", async () => {
      const s = await scene();
      stripe.createConnectedAccount.mockResolvedValue({ accountId: "acct_fixtureRefresh0001", livemode: false });
      await conn.startConnect(s.manager, s.slug);
      await conn.refreshConnection(s.manager);
      expect(stripe.retrieveConnectedAccount).toHaveBeenCalledWith("acct_fixtureRefresh0001");
    });

    it("no connection, Stripe unusable, Stripe failing: typed results and no state change", async () => {
      const s = await scene();
      expect(await conn.refreshConnection(s.manager)).toEqual({ kind: "no_connection" });
      await conn.startConnect(s.manager, s.slug);
      stripe.retrieveConnectedAccount.mockRejectedValue(new ProviderError("network"));
      expect(await conn.refreshConnection(s.manager)).toEqual({ kind: "provider_error" });
      expect((await connections(s.organizationId))[0]!.status).toBe("onboarding");
      stripe.isStripeConfigured.mockReturnValue(false);
      expect(await conn.refreshConnection(s.manager)).toEqual({ kind: "stripe_unconfigured" });
    });

    it("cannot revive a disconnected connection", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      await conn.disconnectConnection(s.manager);
      expect(await conn.refreshConnection(s.manager)).toEqual({ kind: "no_connection" });
      expect((await connections(s.organizationId))[0]!.status).toBe("disconnected");
    });
  });

  describe("attestPayouts and the go-live gate", () => {
    async function activeConnection() {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      await conn.refreshConnection(s.manager);
      return s;
    }

    it("attestation records who and when, once; a repeat changes nothing; no connection is typed", async () => {
      const empty = await scene();
      expect(await conn.attestPayouts(empty.manager)).toEqual({ kind: "no_connection" });
      const s = await activeConnection();
      expect(await conn.attestPayouts(s.manager)).toEqual({ kind: "ok", changed: true });
      const row = (await connections(s.organizationId))[0]!;
      expect(row.payouts_attested_at).not.toBeNull();
      expect(row.payouts_attested_by).toBe(s.manager.userId);
      const stamp = row.payouts_attested_at;
      expect(await conn.attestPayouts(s.manager)).toEqual({ kind: "ok", changed: false });
      expect((await connections(s.organizationId))[0]!.payouts_attested_at).toEqual(stamp);
    });

    it("enable is refused with the exact missing list; each blocker clears independently", async () => {
      const s = await activeConnection();
      expect(await conn.setPublicPage(s.manager, true)).toEqual({ kind: "not_ready", missing: ["online_fund", "payouts_attested"] });
      await fx.makeFund(s.organizationId, "General", { offeredOnline: true });
      expect(await conn.setPublicPage(s.manager, true)).toEqual({ kind: "not_ready", missing: ["payouts_attested"] });
      await conn.attestPayouts(s.manager);
      const ok = await conn.setPublicPage(s.manager, true);
      expect(ok).toMatchObject({ kind: "ok", changed: true });
      const row = (await connections(s.organizationId))[0]!;
      expect(row.public_enabled_at).not.toBeNull();
      expect(row.public_enabled_by).toBe(s.manager.userId);
    });

    it("an onboarding (not yet active) connection cannot go public even when attested and funded", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      await fx.makeFund(s.organizationId, "General", { offeredOnline: true });
      await conn.attestPayouts(s.manager);
      expect(await conn.setPublicPage(s.manager, true)).toEqual({ kind: "not_ready", missing: ["connection_active"] });
    });

    it("no connection at all is typed, for both directions", async () => {
      const s = await scene();
      expect(await conn.setPublicPage(s.manager, true)).toEqual({ kind: "no_connection" });
      expect(await conn.setPublicPage(s.manager, false)).toEqual({ kind: "no_connection" });
    });

    it("enable is idempotent; take-offline is always allowed and clears who/when", async () => {
      const s = await activeConnection();
      await fx.makeFund(s.organizationId, "General", { offeredOnline: true });
      await conn.attestPayouts(s.manager);
      expect(await conn.setPublicPage(s.manager, true)).toMatchObject({ changed: true });
      expect(await conn.setPublicPage(s.manager, true)).toMatchObject({ kind: "ok", changed: false });
      expect(await conn.setPublicPage(s.manager, false)).toMatchObject({ kind: "ok", changed: true });
      expect(await conn.setPublicPage(s.manager, false)).toMatchObject({ kind: "ok", changed: false });
      const row = (await connections(s.organizationId))[0]!;
      expect(row).toMatchObject({ public_enabled_at: null, public_enabled_by: null });
      expect(row.payouts_attested_at).not.toBeNull(); // the attestation survives a take-offline
    });

    it("the 'live' predicate the public page uses agrees: active + public + toggle on", async () => {
      const s = await activeConnection();
      await fx.makeFund(s.organizationId, "General", { offeredOnline: true });
      await conn.attestPayouts(s.manager);
      const live = async () => fx.rowsOf(await fx.platform.execute(sql`select presby_giving__live_connection(${s.organizationId}::uuid) as c`))[0]!.c;
      expect(await live()).toBeNull();
      await conn.setPublicPage(s.manager, true);
      expect(await live()).not.toBeNull();
      await conn.setPublicPage(s.manager, false);
      expect(await live()).toBeNull();
    });
  });

  describe("updateRates", () => {
    it("changes only what changed, reports the field names, and a same-values save is a no-op", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      const same = await conn.updateRates(s.manager, { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 });
      expect(same).toMatchObject({ kind: "ok", changedFields: [] });
      const nonprofit = await conn.updateRates(s.manager, { cardFeeBps: 220, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 });
      expect(nonprofit).toMatchObject({ kind: "ok", changedFields: ["cardFeeBps"] });
      expect((await connections(s.organizationId))[0]).toMatchObject({ card_fee_bps: 220, card_fee_fixed_cents: 30 });
    });

    it("the schema's CHECK is the backstop for an out-of-bounds rate", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      await expect(conn.updateRates(s.manager, { cardFeeBps: 5000, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 })).rejects.toThrow();
      expect((await connections(s.organizationId))[0]!.card_fee_bps).toBe(290);
    });

    it("is typed when there is no open connection", async () => {
      const s = await scene();
      expect(await conn.updateRates(s.manager, { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 })).toEqual({ kind: "no_connection" });
    });
  });

  describe("disconnectConnection", () => {
    it("is local and terminal: clears the public page, records the treasurer, reports the active monthly gifts", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      await conn.refreshConnection(s.manager);
      await fx.makeFund(s.organizationId, "General", { offeredOnline: true });
      await conn.attestPayouts(s.manager);
      await conn.setPublicPage(s.manager, true);
      const row = (await connections(s.organizationId))[0]!;
      const fund = String(fx.rowsOf(await fx.platform.execute(sql`select id from giving_funds where organization_id = ${s.organizationId} limit 1`))[0]!.id);
      await fx.platform.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, frequency, method_choice, gift_amount_cents, total_cents,
               livemode, idempotency_key, status, subscription_id, expires_at)
        values (${s.organizationId}, ${row.id}, ${fund}, 'monthly', 'card', 2500, 2500, false, ${crypto.randomUUID()}, 'completed', ${`sub_fixture${Date.now()}`}, now() + interval '1 day')`);

      const out = await conn.disconnectConnection(s.manager);
      expect(out).toEqual({ kind: "ok", connectionId: row.id, activeSchedules: 1 });
      expect((await connections(s.organizationId))[0]).toMatchObject({
        status: "disconnected", disconnected_reason: "treasurer", public_enabled_at: null,
      });
      expect(await conn.disconnectConnection(s.manager)).toEqual({ kind: "no_connection" });
    });

    it("no connection is typed", async () => {
      const s = await scene();
      expect(await conn.disconnectConnection(s.manager)).toEqual({ kind: "no_connection" });
    });

    it("leaves Stripe alone: it makes no call to close or deauthorize anything", async () => {
      const s = await scene();
      await conn.startConnect(s.manager, s.slug);
      vi.clearAllMocks();
      await conn.disconnectConnection(s.manager);
      for (const fn of Object.values(stripe)) expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("goLiveBlockers (pure)", () => {
    it("lists exactly what is missing, in a stable order", () => {
      expect(conn.goLiveBlockers(null, 0)).toEqual(["connection_active", "online_fund", "payouts_attested"]);
      expect(conn.goLiveBlockers({ status: "active", payoutsAttestedAt: "x" }, 1)).toEqual([]);
      expect(conn.goLiveBlockers({ status: "restricted", payoutsAttestedAt: "x" }, 1)).toEqual(["connection_active"]);
      expect(conn.goLiveBlockers({ status: "active", payoutsAttestedAt: null }, 2)).toEqual(["payouts_attested"]);
    });
  });
});
