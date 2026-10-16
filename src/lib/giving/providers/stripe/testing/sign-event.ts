/**
 * The signed-event test harness - docs/work-log/2026-10-15-online-giving.md,
 * Batch 3 ("the signed-event replay harness"). TEST SUPPORT ONLY: nothing in
 * `src/app` or the rest of `src/lib` imports this file.
 *
 * It signs fixture bodies exactly as Stripe does, so the REAL webhook route can
 * be driven with no Stripe account and no network: `Stripe-Signature:
 * t=<unix seconds>,v1=<HMAC-SHA256(secret, "<t>.<body>")>`. The route verifies
 * with the SDK's own `Stripe.webhooks.constructEvent`, which only needs those
 * bytes - `sign-event.test.ts` proves the two agree (the SDK's own
 * `generateTestHeaderString` produces the same header, and `verifyWebhook`
 * accepts ours). It uses `node:crypto` rather than the SDK so that it is
 * importable from Playwright specs and from `src/` code that
 * `check:giving-boundaries` forbids from importing `stripe` at runtime.
 *
 * Secrets in tests are NON-KEY-SHAPED literals (`giving-e2e-signing-secret`);
 * the SDK does not care what the secret looks like, and a real-looking one in
 * a public repository is a `check:secrets` finding.
 *
 * Fixture ids are obviously fake (`acct_fixture...`, `cs_fixture...`) and
 * match the shapes the database enforces (`drizzle/0055` regexes), so a fixture
 * body can be ingested for real. Run-specific values are swapped in with
 * `replacements` (a plain string replace of the fixture's sentinel id), so two
 * runs never collide on a globally unique account id.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const FIXTURE_SECRET = "giving-e2e-signing-secret";
export const FIXTURE_ACCOUNT = "acct_fixtureAccount0001";

const FIXTURE_DIR = path.join(process.cwd(), "src/lib/giving/providers/stripe/testing/fixtures");

export const FIXTURE_NAMES = [
  "account-application-deauthorized",
  "account-updated-active",
  "account-updated-restricted",
  "charge-dispute-closed-won",
  "charge-dispute-created-ach",
  "charge-dispute-created",
  "charge-dispute-funds-reinstated",
  "charge-dispute-funds-withdrawn",
  "charge-succeeded",
  "checkout-session-async-payment-failed",
  "checkout-session-async-payment-succeeded",
  "checkout-session-completed-payment-unpaid",
  "checkout-session-completed-payment",
  "checkout-session-completed-subscription",
  "checkout-session-expired",
  "customer-subscription-deleted",
  "invoice-payment-failed",
  "invoice-payment-paid",
  "payout-failed",
  "payout-paid",
  "refund-created",
  "refund-updated-failed",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** `t=<seconds>,v1=<hex hmac>` over `"<seconds>.<payload>"`. */
export function signStripePayload(
  payload: string,
  secret: string = FIXTURE_SECRET,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`, "utf8").digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

type JsonObject = Record<string, unknown>;

/**
 * A fixture's body as the exact string that gets signed and posted.
 * `replacements` swaps sentinel strings (every occurrence); `patch` edits the
 * parsed body before it is serialized (used to change `livemode`, the account,
 * a currency, an amount ...). Serialization is `JSON.stringify` with no
 * whitespace, so the signed bytes are deterministic.
 */
export function fixtureBody(
  name: FixtureName,
  options: { replacements?: Record<string, string>; patch?: (body: JsonObject) => void } = {},
): string {
  let text = readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8");
  for (const [from, to] of Object.entries(options.replacements ?? {})) {
    text = text.split(from).join(to);
  }
  const body = JSON.parse(text) as JsonObject;
  options.patch?.(body);
  return JSON.stringify(body);
}
