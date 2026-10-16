import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_SECRET,
  fixtureBody,
  signStripePayload,
} from "@/lib/giving/providers/stripe/testing/sign-event";

vi.mock("server-only", () => ({}));

const ingest = vi.hoisted(() => ({ ingestEvent: vi.fn() }));
vi.mock("@/lib/giving/ingest/functions", () => ingest);
const proc = vi.hoisted(() => ({ processInboxEvent: vi.fn() }));
vi.mock("@/lib/giving/ingest/process", () => proc);
const next = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: next.after }));

import { POST } from "./route";

const INBOX = "33333333-3333-4333-8333-333333333333";

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhooks/stripe", { method: "POST", body, headers });
}
const signed = (body: string, secret = FIXTURE_SECRET, ts?: number) => ({ "stripe-signature": signStripePayload(body, secret, ts) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", FIXTURE_SECRET);
  vi.stubEnv("STRIPE_SECRET_KEY", ""); // the webhook must not need the API key
  ingest.ingestEvent.mockResolvedValue({ outcome: "accepted", inboxId: INBOX });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

const BODY = fixtureBody("checkout-session-completed-payment");

describe("POST /api/webhooks/stripe - the response contract", () => {
  it("503 when the signing secret is unset (Stripe retries; money must not fail open)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const res = await POST(request(BODY, signed(BODY)));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Webhook not configured." });
    expect(ingest.ingestEvent).not.toHaveBeenCalled();
  });

  it("503 for a whitespace-only secret too", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "   ");
    expect((await POST(request(BODY, signed(BODY)))).status).toBe(503);
  });

  it("400 when the Stripe-Signature header is missing", async () => {
    const res = await POST(request(BODY));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing webhook headers." });
    expect(ingest.ingestEvent).not.toHaveBeenCalled();
  });

  it("400 for a signature made with the wrong secret", async () => {
    const res = await POST(request(BODY, signed(BODY, "some-other-secret")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid webhook signature." });
    expect(ingest.ingestEvent).not.toHaveBeenCalled();
    expect(next.after).not.toHaveBeenCalled();
  });

  it("400 for a body altered after signing", async () => {
    const res = await POST(request(BODY.replace("5000", "9000"), signed(BODY)));
    expect(res.status).toBe(400);
    expect(ingest.ingestEvent).not.toHaveBeenCalled();
  });

  it("400 for a stale timestamp (replay protection)", async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const res = await POST(request(BODY, signed(BODY, FIXTURE_SECRET, stale)));
    expect(res.status).toBe(400);
    expect(ingest.ingestEvent).not.toHaveBeenCalled();
  });

  it("400 for garbage in the signature header", async () => {
    expect((await POST(request(BODY, { "stripe-signature": "garbage" }))).status).toBe(400);
  });

  it("200 handled:false for a platform-scope event (no top-level account); nothing is written", async () => {
    const body = fixtureBody("checkout-session-completed-payment", { patch: (b) => void delete b.account });
    const res = await POST(request(body, signed(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: false });
    expect(ingest.ingestEvent).not.toHaveBeenCalled();
  });

  it("200 handled:false for a type we are not subscribed to; nothing is written", async () => {
    const body = fixtureBody("checkout-session-completed-payment", { patch: (b) => void (b.type = "customer.created") });
    const res = await POST(request(body, signed(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: false });
    expect(ingest.ingestEvent).not.toHaveBeenCalled();
  });

  it("500 when the ingest function throws (Stripe will retry); no body, no stack", async () => {
    ingest.ingestEvent.mockRejectedValue(new Error(`relation does not exist ${BODY}`));
    const res = await POST(request(BODY, signed(BODY)));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Internal server error." });
    expect(text).not.toContain("relation");
    expect(next.after).not.toHaveBeenCalled();
  });

  it("accepted / duplicate / ignored answer with ONE byte-identical 200", async () => {
    const texts: string[] = [];
    for (const outcome of ["accepted", "duplicate", "ignored"]) {
      ingest.ingestEvent.mockResolvedValue({ outcome, inboxId: outcome === "ignored" ? null : INBOX });
      const res = await POST(request(BODY, signed(BODY)));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      texts.push(await res.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe('{"received":true}');
  });
});

describe("POST /api/webhooks/stripe - what it hands to the database", () => {
  it("passes the verified facts and the EXACT raw bytes (trailing whitespace included)", async () => {
    const body = `${BODY}\n`;
    await POST(request(body, signed(body)));
    expect(ingest.ingestEvent).toHaveBeenCalledWith({
      account: FIXTURE_ACCOUNT,
      eventId: "evt_fixtureCheckoutSessionCompletedPayment",
      livemode: false,
      eventType: "checkout.session.completed",
      rawBody: body,
    });
  });

  it("accepts every one of the sixteen handled types", async () => {
    const { HANDLED_EVENT_TYPES } = await import("@/lib/giving/providers/stripe/constants");
    for (const type of HANDLED_EVENT_TYPES) {
      ingest.ingestEvent.mockClear();
      const body = fixtureBody("charge-succeeded", { patch: (b) => void (b.type = type) });
      expect((await POST(request(body, signed(body)))).status).toBe(200);
      expect(ingest.ingestEvent, type).toHaveBeenCalledTimes(1);
    }
  });

  it("schedules processing in after() for an ACCEPTED event only, and the callback processes that inbox row", async () => {
    await POST(request(BODY, signed(BODY)));
    expect(next.after).toHaveBeenCalledTimes(1);
    expect(proc.processInboxEvent).not.toHaveBeenCalled(); // not run inline
    await next.after.mock.calls[0]![0]();
    expect(proc.processInboxEvent).toHaveBeenCalledWith(INBOX);

    vi.clearAllMocks();
    ingest.ingestEvent.mockResolvedValue({ outcome: "duplicate", inboxId: INBOX });
    await POST(request(BODY, signed(BODY)));
    ingest.ingestEvent.mockResolvedValue({ outcome: "ignored", inboxId: null });
    await POST(request(BODY, signed(BODY)));
    expect(next.after).not.toHaveBeenCalled();
  });

  it("works with STRIPE_SECRET_KEY unset (verification uses the static helper)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await POST(request(BODY, signed(BODY)))).status).toBe(200);
  });

  it("logs the event id and type only: no body, no account, no donor field", async () => {
    await POST(request(BODY, signed(BODY)));
    ingest.ingestEvent.mockRejectedValue(new Error("boom"));
    await POST(request(BODY, signed(BODY)));
    const info = vi.mocked(console.info).mock.calls;
    const errors = vi.mocked(console.error).mock.calls;
    const logged = JSON.stringify([...info, ...errors]);
    expect(logged).toContain("evt_fixtureCheckoutSessionCompletedPayment");
    expect(logged).toContain("checkout.session.completed");
    for (const secret of [FIXTURE_ACCOUNT, "Fixture Donor", "example.invalid", "pi_fixturePaid000001", "5000", FIXTURE_SECRET]) {
      expect(logged, secret).not.toContain(secret);
    }
  });
});
