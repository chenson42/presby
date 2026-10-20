import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_NAMES,
  FIXTURE_SECRET,
  fixtureBody,
  signStripePayload,
} from "./sign-event";

/**
 * The harness signs with node:crypto so it can be imported from Playwright and
 * from code the tripwire forbids from importing `stripe`. These tests prove it
 * is byte-for-byte what the SDK produces and verifies - so a green replay
 * harness is a statement about the real signature scheme, not about a copy of it.
 */
describe("sign-event agrees with the SDK", () => {
  const body = fixtureBody("checkout-session-completed-payment");

  it("produces the same header the SDK's own generateTestHeaderString produces", () => {
    const timestamp = 1790000123;
    const ours = signStripePayload(body, FIXTURE_SECRET, timestamp);
    const theirs = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: FIXTURE_SECRET, timestamp });
    expect(ours).toBe(theirs);
  });

  it("is accepted by Stripe.webhooks.constructEvent", () => {
    const event = Stripe.webhooks.constructEvent(body, signStripePayload(body), FIXTURE_SECRET, 300);
    expect(event.type).toBe("checkout.session.completed");
  });

  it("is rejected by the SDK under another secret or after a body change", () => {
    expect(() => Stripe.webhooks.constructEvent(body, signStripePayload(body, "another-secret"), FIXTURE_SECRET, 300)).toThrow();
    expect(() => Stripe.webhooks.constructEvent(`${body} `, signStripePayload(body), FIXTURE_SECRET, 300)).toThrow();
  });

  it("is deterministic for a fixed timestamp", () => {
    expect(signStripePayload(body, FIXTURE_SECRET, 1790000000)).toBe(signStripePayload(body, FIXTURE_SECRET, 1790000000));
  });
});

describe("fixtures", () => {
  it("every fixture is a well-formed event at the pinned API version for the fixture account", () => {
    for (const name of FIXTURE_NAMES) {
      const event = JSON.parse(fixtureBody(name));
      expect(event.object, name).toBe("event");
      expect(event.api_version, name).toBe("2026-09-30.endive");
      expect(event.account, name).toBe(FIXTURE_ACCOUNT);
      expect(event.livemode, name).toBe(false);
      expect(event.id, name).toMatch(/^evt_[A-Za-z0-9_]{8,64}$/);
      expect(event.type, name).toMatch(/^[a-z0-9_.]+$/);
    }
  });

  it("every fixture's provider ids match the shapes the database enforces (so it can be ingested for real)", () => {
    const text = FIXTURE_NAMES.map((n) => fixtureBody(n)).join("\n");
    for (const id of text.match(/\bacct_[A-Za-z0-9_]+/g) ?? []) expect(id).toMatch(/^acct_[A-Za-z0-9]{8,64}$/);
    for (const id of text.match(/\bcus_[A-Za-z0-9_]+/g) ?? []) expect(id).toMatch(/^cus_[A-Za-z0-9]{8,64}$/);
    for (const id of text.match(/\bpi_[A-Za-z0-9_]+/g) ?? []) expect(id).toMatch(/^pi_[A-Za-z0-9_]{8,64}$/);
    for (const id of text.match(/\bsub_[A-Za-z0-9_]+/g) ?? []) expect(id).toMatch(/^sub_[A-Za-z0-9_]{8,64}$/);
    for (const id of text.match(/\bcs_[A-Za-z0-9_]+/g) ?? []) expect(id).toMatch(/^cs_[A-Za-z0-9_]{8,255}$/);
    for (const id of text.match(/\bpo_[A-Za-z0-9_]+/g) ?? []) expect(id).toMatch(/^po_[A-Za-z0-9_]{8,64}$/);
  });

  it("contains only invented data: example.invalid addresses, a fake street, no key shapes", () => {
    const text = FIXTURE_NAMES.map((n) => fixtureBody(n)).join("\n");
    for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email).toMatch(/@example\.invalid$/);
    expect(text).not.toMatch(/\b(?:sk|rk|pk|whsec)_(?:live|test)?_?[A-Za-z0-9]{8,}/);
  });

  it("replacements swap every occurrence of a sentinel id", () => {
    const swapped = fixtureBody("checkout-session-completed-payment", { replacements: { [FIXTURE_ACCOUNT]: "acct_fixtureOther00001" } });
    expect(swapped).not.toContain(FIXTURE_ACCOUNT);
    expect(swapped).toContain("acct_fixtureOther00001");
  });
});
