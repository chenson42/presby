/**
 * giving-webhook.spec.ts - the SIGNED-EVENT REPLAY HARNESS (online giving,
 * Batch 3a; docs/work-log/2026-10-15-online-giving.md). It signs fixture bodies
 * with the webhook secret exactly as Stripe does and POSTs them to the REAL
 * `/api/webhooks/stripe` route of a running dev server, against the real
 * database. No Stripe account, no network, no mock: the route, the SDK's own
 * signature check, the ingest/claim/apply/finish functions and the 5-minute
 * cron are all the shipped code.
 *
 * REQUIREMENT ON THE SERVER. The dev server must run with
 *   STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret   (a NON-key-shaped literal) // leak-ok: non-key-shaped test literal
 *   CRON_SECRET=giving-e2e-cron-secret // leak-ok: non-key-shaped test literal
 * `playwright.config.ts` sets both for a server it starts; a server you started
 * yourself (E2E_BASE_URL) needs them in its environment. The preflight below
 * says so plainly instead of failing every case with a 503. `STRIPE_SECRET_KEY`
 * stays UNSET: the webhook verifies with the SDK's static helper and the ingest
 * path in these cases never calls Stripe, which is itself part of what is proved.
 * (The two cases that need Stripe - the fee read and the invoice completion -
 * are covered in the DB-backed processor tests with a mocked client, and in the
 * operator's test-mode smoke.)
 *
 * Everything lives at a throwaway congregation (`e2e-giving-<stamp>`) and is
 * removed in afterAll by deleting that organization (the cascade is how gifts and
 * reversals, which are delete-guarded, go away). audit_events is append-only and
 * keeps its rows; each run's organization and connection ids are unique, so no
 * assertion can count another run's rows.
 */
import { test, expect, type APIRequestContext, type APIResponse, type BrowserContext } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  removeGivingFixture,
  setGivingRole,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
} from "./support/giving-fixture";
import {
  fixtureBody,
  signStripePayload,
  type FixtureName,
} from "../src/lib/giving/providers/stripe/testing/sign-event";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "giving-e2e-signing-secret";
const CRON_SECRET = process.env.CRON_SECRET ?? "giving-e2e-cron-secret";
const WEBHOOK = "/api/webhooks/stripe";

let sql: Sql;
let fx: GivingFixture;
const stamp = Date.now().toString(36);
let counter = 0;
const uniq = () => `${stamp}${(counter += 1).toString(36)}`;

/** The fixture connection (born onboarding; ingest does not care about status) and its account. */
const ACCOUNT = `acct_fixtureE2e${stamp}`;
let connectionId = "";

const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

/** A fixture body rewritten for this run: the account, unique ids, and a unique event id. */
function body(
  fixture: FixtureName,
  swaps: Record<string, string> = {},
  patch?: (b: Record<string, unknown>) => void,
  account = ACCOUNT,
): string {
  return fixtureBody(fixture, {
    replacements: { acct_fixtureAccount0001: account, ...swaps },
    patch(b) {
      b.id = `evt_fixture${uniq()}`;
      patch?.(b);
    },
  });
}

const eventId = (raw: string) => (JSON.parse(raw) as { id: string }).id;

function post(request: APIRequestContext, raw: string, secret = SECRET, timestamp?: number): Promise<APIResponse> {
  return request.post(WEBHOOK, {
    data: raw,
    headers: { "content-type": "application/json", "stripe-signature": signStripePayload(raw, secret, timestamp) },
  });
}

const eventRow = async (id: string) =>
  (await rows<{ id: string; status: string; last_error: string | null; attempts: number }>(
    sql`select id, status, last_error, attempts from giving_provider_events where external_event_id = ${id}`,
  ))[0];

/** Waits for the webhook's after() processing (or the cron) to move an event to `status`. */
async function waitForStatus(id: string, status: string) {
  await expect.poll(async () => (await eventRow(id))?.status ?? "absent", { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(status);
}

const gifts = () =>
  rows<{ status: string; amount_cents: number; fund_id: string; external_transaction_id: string }>(
    sql`select status, amount_cents, fund_id, external_transaction_id from giving_gifts where organization_id = ${fx.orgId}::uuid order by created_at`,
  );
const reversals = () =>
  rows<{ kind: string; amount_cents: number }>(
    sql`select kind, amount_cents from giving_gift_reversals where organization_id = ${fx.orgId}::uuid order by created_at`,
  );
const eventCount = async () =>
  Number((await rows<{ n: string }>(sql`select count(*)::int as n from giving_provider_events where organization_id = ${fx.orgId}::uuid`))[0]!.n);

async function addIntent(opts: { sessionId: string; total?: number; connection?: string }) {
  await sql`
    insert into giving_checkout_intents (organization_id, connection_id, fund_id, frequency, method_choice, cover_fees,
           gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status, checkout_session_id, expires_at)
    values (${fx.orgId}::uuid, ${opts.connection ?? connectionId}::uuid, ${fx.funds.general}::uuid, 'once', 'card', false,
            ${opts.total ?? 5000}, 0, ${opts.total ?? 5000}, false, ${crypto.randomUUID()}, 'open', ${opts.sessionId}, now() + interval '1 day')`;
}

async function runCron(request: APIRequestContext) {
  const res = await request.get("/api/cron/giving", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status(), "GET /api/cron/giving").toBe(200);
  return (await res.json()) as { ok: boolean; processed: number; purged: number; expired: number };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  sql = platformSql("giving-webhook");
  fx = await setupGivingFixture(sql);
  connectionId = crypto.randomUUID();
  // Connections are born onboarding (an insert guard); ingest does not care about status.
  await sql`
    insert into giving_provider_connections (id, organization_id, provider, external_account_id, livemode)
    values (${connectionId}::uuid, ${fx.orgId}::uuid, 'stripe', ${ACCOUNT}, false)`;
});

test.afterAll(async () => {
  if (sql && fx) await removeGivingFixture(sql, fx);
});

test.describe("preflight", () => {
  test("the server carries the webhook secret and the cron secret this spec signs with", async ({ request }) => {
    const ping = fixtureBody("checkout-session-completed-payment", {
      patch(b) {
        b.id = `evt_fixture${uniq()}`;
        b.type = "customer.created"; // acknowledged and dropped before the inbox
      },
    });
    const res = await post(request, ping);
    if (res.status() === 503) {
      throw new Error(
        "The dev server has no STRIPE_WEBHOOK_SECRET. Start it with STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret " + // leak-ok: non-key-shaped test literal
          "CRON_SECRET=giving-e2e-cron-secret (playwright.config.ts does this for a server it starts).", // leak-ok: non-key-shaped test literal
      );
    }
    if (res.status() === 400) {
      throw new Error(
        "The dev server rejected a correctly signed event: its STRIPE_WEBHOOK_SECRET differs from this spec's " +
          "(giving-e2e-signing-secret, or the STRIPE_WEBHOOK_SECRET in the test environment).",
      );
    }
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: false });

    const cron = await request.get("/api/cron/giving", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    if (cron.status() === 503 || cron.status() === 401) {
      throw new Error("The dev server's CRON_SECRET differs from this spec's (giving-e2e-cron-secret) or is unset.");
    }
    expect(cron.status()).toBe(200);
  });
});

test.describe("signature", () => {
  test("a bad signature is a 400 and nothing is written", async ({ request }) => {
    const raw = body("checkout-session-completed-payment");
    const before = await eventCount();

    const wrongSecret = await post(request, raw, "some-other-signing-secret");
    expect(wrongSecret.status()).toBe(400);
    expect(await wrongSecret.json()).toEqual({ error: "Invalid webhook signature." });

    const tampered = await request.post(WEBHOOK, {
      data: raw.replace("5000", "9000"),
      headers: { "content-type": "application/json", "stripe-signature": signStripePayload(raw) },
    });
    expect(tampered.status()).toBe(400);

    const stale = await post(request, raw, SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(stale.status()).toBe(400);

    const missing = await request.post(WEBHOOK, { data: raw, headers: { "content-type": "application/json" } });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: "Missing webhook headers." });

    expect(await eventCount()).toBe(before);
    expect(await eventRow(eventId(raw))).toBeUndefined();
  });
});

test.describe("a payment", () => {
  test("a good signature is a 200 and the gift is applied from presby's own intent, not from the event", async ({ request }) => {
    const sessionId = `cs_fixture${uniq()}`;
    const pi = `pi_fixture${uniq()}`;
    await addIntent({ sessionId, total: 5000 });
    // The body tries to name a foreign fund and membership in metadata; nothing reads either.
    const raw = body("checkout-session-completed-payment", { cs_fixturePaid000001: sessionId, pi_fixturePaid000001: pi }, (b) => {
      (b.data as { object: { metadata: object } }).object.metadata = {
        fund_id: "99999999-9999-4999-8999-999999999999",
        membership_id: "88888888-8888-4888-8888-888888888888",
      };
    });
    const res = await post(request, raw);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('{"received":true}');

    await waitForStatus(eventId(raw), "applied");
    const gift = (await gifts()).find((g) => g.external_transaction_id === pi)!;
    expect(gift).toMatchObject({ status: "succeeded", amount_cents: 5000, fund_id: fx.funds.general });
    const donor = (await rows<{ display_name: string; email: string }>(
      sql`select display_name, email from giving_donors where organization_id = ${fx.orgId}::uuid and display_name = 'Fixture Donor'`,
    ))[0];
    expect(donor).toBeTruthy();
  });

  test("a byte-identical replay is a no-op: the same 200, one event row, one gift", async ({ request }) => {
    const sessionId = `cs_fixture${uniq()}`;
    const pi = `pi_fixture${uniq()}`;
    await addIntent({ sessionId });
    const raw = body("checkout-session-completed-payment", { cs_fixturePaid000001: sessionId, pi_fixturePaid000001: pi });
    const first = await post(request, raw);
    await waitForStatus(eventId(raw), "applied");
    const giftsBefore = (await gifts()).length;
    const eventsBefore = await eventCount();

    const second = await post(request, raw);
    const third = await post(request, raw);
    expect(second.status()).toBe(200);
    expect(await second.text()).toBe(await first.text());
    expect(await third.text()).toBe(await first.text());
    // Give an erroneous second processing time to show itself.
    await new Promise((r) => setTimeout(r, 1500));
    expect((await gifts()).length).toBe(giftsBefore);
    expect(await eventCount()).toBe(eventsBefore);
    expect((await gifts()).filter((g) => g.external_transaction_id === pi)).toHaveLength(1);
  });

  test("an unknown account gets the SAME 200 and writes nothing", async ({ request }) => {
    const known = body("checkout-session-expired", { cs_fixtureExpired0001: `cs_fixture${uniq()}` });
    const knownRes = await post(request, known);

    const stranger = body("checkout-session-completed-payment", {}, undefined, "acct_fixtureNobodyKnowsMe1");
    const eventsBefore = await eventCount();
    const res = await post(request, stranger);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe(await knownRes.text());
    await new Promise((r) => setTimeout(r, 1000));
    expect(await eventRow(eventId(stranger))).toBeUndefined();
    expect(await eventCount()).toBe(eventsBefore);
    const anywhere = await rows(sql`select 1 from giving_provider_events where external_event_id = ${eventId(stranger)}`);
    expect(anywhere).toHaveLength(0);
  });

  test("a livemode mismatch gets the SAME 200 and writes nothing", async ({ request }) => {
    const sessionId = `cs_fixture${uniq()}`;
    const pi = `pi_fixture${uniq()}`;
    await addIntent({ sessionId });
    // The connection is test mode; the body claims live.
    const raw = body("checkout-session-completed-payment", { cs_fixturePaid000001: sessionId, pi_fixturePaid000001: pi }, (b) => void (b.livemode = true));
    const res = await post(request, raw);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('{"received":true}');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await eventRow(eventId(raw))).toBeUndefined();
    expect((await gifts()).find((g) => g.external_transaction_id === pi)).toBeUndefined();
  });

  test("a Stripe payment presby never started (no intent) is acknowledged and ignored, never a gift", async ({ request }) => {
    const pi = `pi_fixture${uniq()}`;
    const raw = body("checkout-session-completed-payment", { cs_fixturePaid000001: `cs_fixture${uniq()}`, pi_fixturePaid000001: pi });
    expect((await post(request, raw)).status()).toBe(200);
    await waitForStatus(eventId(raw), "ignored");
    expect((await gifts()).find((g) => g.external_transaction_id === pi)).toBeUndefined();
  });
});

test.describe("reversals", () => {
  test("a refund arriving BEFORE its gift parks, then applies exactly once after the gift is recorded", async ({ request }) => {
    const sessionId = `cs_fixture${uniq()}`;
    const pi = `pi_fixture${uniq()}`;
    await addIntent({ sessionId });

    const refund = body("refund-created", { pi_fixturePaid000001: pi, re_fixtureRefund000001: `re_fixture${uniq()}` });
    expect((await post(request, refund)).status()).toBe(200);
    await waitForStatus(eventId(refund), "parked");
    expect((await eventRow(eventId(refund)))!.last_error).toBe("no_gift");
    expect((await reversals()).length).toBe(0);

    const gift = body("checkout-session-completed-payment", { cs_fixturePaid000001: sessionId, pi_fixturePaid000001: pi });
    expect((await post(request, gift)).status()).toBe(200);
    await waitForStatus(eventId(gift), "applied");

    // The parked refund's back-off is a minute; make it due and let the cron retry it.
    await sql`update giving_provider_events set next_attempt_at = now() where external_event_id = ${eventId(refund)}`;
    await runCron(request);
    await waitForStatus(eventId(refund), "applied");
    expect(await reversals()).toEqual([{ kind: "refund", amount_cents: 5000 }]);

    // Another cron run, and a replay of the refund, change nothing.
    await runCron(request);
    expect((await post(request, refund)).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 1000));
    expect((await reversals()).length).toBe(1);
  });

  test("a dispute is ONE reversal whichever event lands first: funds_withdrawn then created, then reinstated and closed:won", async ({ request }) => {
    const sessionId = `cs_fixture${uniq()}`;
    const pi = `pi_fixture${uniq()}`;
    const dp = `dp_fixture${uniq()}`;
    await addIntent({ sessionId });
    const gift = body("checkout-session-completed-payment", { cs_fixturePaid000001: sessionId, pi_fixturePaid000001: pi });
    await post(request, gift);
    await waitForStatus(eventId(gift), "applied");
    const before = (await reversals()).length;
    const swaps = { pi_fixturePaid000001: pi, dp_fixtureDispute00001: dp };

    const withdrawn = body("charge-dispute-funds-withdrawn", swaps);
    expect((await post(request, withdrawn)).status()).toBe(200);
    await waitForStatus(eventId(withdrawn), "applied");
    const created = body("charge-dispute-created", swaps);
    expect((await post(request, created)).status()).toBe(200);
    await waitForStatus(eventId(created), "applied"); // a noop: the dispute id is already recorded
    expect((await reversals()).slice(before)).toEqual([{ kind: "dispute", amount_cents: 5000 }]);

    const reinstated = body("charge-dispute-funds-reinstated", swaps);
    expect((await post(request, reinstated)).status()).toBe(200);
    await waitForStatus(eventId(reinstated), "applied");
    const closed = body("charge-dispute-closed-won", swaps);
    expect((await post(request, closed)).status()).toBe(200);
    await waitForStatus(eventId(closed), "applied");
    expect((await reversals()).slice(before).map((r) => r.kind).sort()).toEqual(["dispute", "reinstatement"]);

    // A redelivery of the first event is a byte-identical duplicate: nothing more is written.
    expect((await post(request, withdrawn)).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 1000));
    expect((await reversals()).length).toBe(before + 2);
  });

  test("an OVER-REVERSAL dead-letters: no reversal row, and the congregation sees a COUNT on its giving overview", async ({ request, browser }) => {
    const sessionId = `cs_fixture${uniq()}`;
    const pi = `pi_fixture${uniq()}`;
    await addIntent({ sessionId });
    const gift = body("checkout-session-completed-payment", { cs_fixturePaid000001: sessionId, pi_fixturePaid000001: pi });
    await post(request, gift);
    await waitForStatus(eventId(gift), "applied");
    const reversalsBefore = (await reversals()).length;

    const refund = body("refund-created", { pi_fixturePaid000001: pi, re_fixtureRefund000001: `re_fixture${uniq()}` });
    await post(request, refund);
    await waitForStatus(eventId(refund), "applied");
    const dispute = body("charge-dispute-created", { pi_fixturePaid000001: pi, dp_fixtureDispute00001: `dp_fixture${uniq()}` });
    await post(request, dispute);
    await waitForStatus(eventId(dispute), "dead_letter");
    expect((await eventRow(eventId(dispute)))!.last_error).toBe("over_reversal");
    expect((await reversals()).length).toBe(reversalsBefore + 1); // the refund only

    // The tenant overview says how many, and nothing else about them.
    await setGivingToggle(sql, fx, true);
    await setGivingRole(sql, fx, "treasurer");
    let ctx: BrowserContext | null = null;
    try {
      ctx = await verifiedContext(browser);
      const page = await ctx.newPage();
      await page.goto(`/o/${fx.slug}/admin/giving`);
      await expect(page.getByText(/payment notices? from Stripe could not be processed/i)).toBeVisible();
      const text = await page.locator("main").innerText();
      expect(text).toMatch(/\b1 payment notice from Stripe could not be processed/i);
      for (const leak of [pi, "Fixture Donor", "donor.fixture", "dp_fixture", "over_reversal", "5000", "$50.00"]) {
        expect(text, `the overview must not show ${leak}`).not.toContain(leak);
      }
    } finally {
      await ctx?.close();
      await setGivingRole(sql, fx, "none");
      await setGivingToggle(sql, fx, null);
    }
  });
});

test.describe("the connection", () => {
  test("a body at the wrong API version dead-letters visibly (the endpoint must be created at the pinned version)", async ({ request }) => {
    const raw = body("account-updated-active", {}, (b) => void (b.api_version = "2020-08-27"));
    expect((await post(request, raw)).status()).toBe(200);
    await waitForStatus(eventId(raw), "dead_letter");
    expect((await eventRow(eventId(raw)))!.last_error).toBe("normalize_api_version");
  });

  test("account.updated moves the status; account.application.deauthorized disconnects it and is audited as a system act", async ({ request }) => {
    const updated = body("account-updated-active");
    expect((await post(request, updated)).status()).toBe(200);
    await waitForStatus(eventId(updated), "applied");
    expect((await rows<{ status: string }>(sql`select status from giving_provider_connections where id = ${connectionId}::uuid`))[0]!.status).toBe("active");

    const raw = body("account-application-deauthorized");
    const res = await post(request, raw);
    expect(res.status()).toBe(200);
    await waitForStatus(eventId(raw), "applied");

    const conn = (await rows<{ status: string; disconnected_reason: string; public_enabled_at: string | null }>(
      sql`select status, disconnected_reason, public_enabled_at from giving_provider_connections where id = ${connectionId}::uuid`,
    ))[0]!;
    expect(conn).toMatchObject({ status: "disconnected", disconnected_reason: "deauthorized", public_enabled_at: null });

    // The audit rows are written after finish_event; poll for them. System actor: no user.
    await expect
      .poll(
        async () =>
          (await rows<{ actor_user_id: string | null; metadata: { reason?: string } }>(
            sql`select actor_user_id, metadata from audit_events where action = 'tenant.giving_connection.disconnected' and resource_id = ${connectionId}`,
          ))[0],
        { timeout: 20_000 },
      )
      .toMatchObject({ actor_user_id: null, metadata: { reason: "deauthorized" } });
    const changed = await rows(sql`select 1 from audit_events where action = 'tenant.giving_connection.status_changed' and resource_id = ${connectionId}`);
    expect(changed.length).toBe(1);

    // Ingest continues for a disconnected connection (recurring gifts stay recorded).
    const later = body("checkout-session-expired", { cs_fixtureExpired0001: `cs_fixture${uniq()}` });
    expect((await post(request, later)).status()).toBe(200);
    await waitForStatus(eventId(later), "ignored");

    // Replaying the deauthorization is a duplicate: audit-silent.
    expect((await post(request, raw)).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    const audits = await rows(sql`select 1 from audit_events where action = 'tenant.giving_connection.disconnected' and resource_id = ${connectionId}`);
    expect(audits).toHaveLength(1);
  });
});
