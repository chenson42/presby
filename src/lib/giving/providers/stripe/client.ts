import "server-only";
import Stripe from "stripe";
import type { DonorDetails } from "../../types";
import { buildCheckoutParams, type CheckoutInput } from "./checkout";
import { STRIPE_API_VERSION, WEBHOOK_TOLERANCE_SECONDS } from "./constants";
import { ProviderError, WebhookSignatureError, type ProviderErrorDetails } from "./errors";
import {
  buildCreateAccountParams,
  buildOnboardingLinkParams,
  statementDescriptorFor,
} from "./onboarding";
import { mapV2AccountToStatus } from "./status";
import { assertStripeUrl, CHECKOUT_HOSTS, ONBOARDING_HOSTS } from "./urls";
import type { ConnectionStatusInput } from "../../types";

/**
 * THE STRIPE ALLOWLIST - the only module in presby that imports the `stripe`
 * package at runtime (R8; `check:giving-boundaries` B1 and an ESLint rule both
 * enforce it). docs/work-log/2026-10-15-online-giving.md, Phase 3 "The Stripe
 * allowlist".
 *
 * Why one narrow module. One platform key serves every congregation, so the key
 * is the most valuable secret in the system and the damage a bug here can do is
 * bounded by what this file can ask Stripe to do. Every export below is a
 * deliberate call; none of them lists, searches or reads customers, charges,
 * PaymentIntents or subscriptions. A test pins the exact export set and greps
 * this file for forbidden resource access. The production key is a RESTRICTED
 * key whose permissions are exactly the calls here (docs/deployment.md).
 *
 * Rules every function obeys:
 *   - the SDK is built LAZILY, per call, with the pinned `apiVersion`,
 *     `maxNetworkRetries: 2` and the idempotency key for a write;
 *   - it returns a PROJECTION - a small plain object - never an SDK object, so
 *     nothing downstream can reach for a field this module did not vouch for;
 *   - every URL Stripe hands back is origin-asserted before it leaves here;
 *   - a failure becomes a `ProviderError` with a fixed message. The SDK's own
 *     `message` is never thrown or logged; only Stripe's error `type`, `code`
 *     and request id are logged. The key can appear in neither.
 */

export { STRIPE_API_VERSION };

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

function secretKey(): string | null {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  return key === "" ? null : key;
}

function webhookSecret(): string | null {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  return secret === "" ? null : secret;
}

/** Both the API key and the webhook signing secret are set. */
export function isStripeConfigured(): boolean {
  return secretKey() !== null && webhookSecret() !== null;
}

/**
 * Which mode the platform key is in, read off its prefix. Informational (the
 * "Test mode" banner); a connection's `livemode` always comes from the account
 * Stripe returned, never from this. An unrecognized prefix reads as "test" - the
 * direction in which a mistake only hides money, never invents it.
 */
export function platformMode(): "live" | "test" {
  const key = secretKey() ?? "";
  return /^(sk|rk)_live_/.test(key) ? "live" : "test";
}

function sdk(): Stripe {
  const key = secretKey();
  if (!key) throw new ProviderError("unconfigured");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 });
}

// ---------------------------------------------------------------------------
// failures
// ---------------------------------------------------------------------------

type StripeLikeError = { type?: unknown; code?: unknown; statusCode?: unknown; requestId?: unknown };

function describe(err: unknown): ProviderErrorDetails {
  const e = (typeof err === "object" && err !== null ? err : {}) as StripeLikeError;
  const details: ProviderErrorDetails = {};
  if (typeof e.type === "string") details.stripeType = e.type;
  if (typeof e.code === "string") details.stripeCode = e.code;
  if (typeof e.requestId === "string") details.requestId = e.requestId;
  if (typeof e.statusCode === "number") details.statusCode = e.statusCode;
  return details;
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const details = describe(err);
  let code: ProviderError["code"] = "stripe_error";
  if (details.statusCode === 429 || details.stripeType === "StripeRateLimitError") code = "rate_limited";
  else if (details.stripeType === "StripeConnectionError") code = "network";
  else if (details.statusCode === 404) code = "not_found";
  return new ProviderError(code, details);
}

/** Runs one Stripe call; on failure logs type / code / request id ONLY and throws a `ProviderError`. */
async function call<T>(operation: string, fn: (stripe: Stripe) => Promise<T>): Promise<T> {
  const stripe = sdk(); // throws ProviderError("unconfigured") before any network
  try {
    return await fn(stripe);
  } catch (err) {
    const failure = toProviderError(err);
    console.error("[giving/stripe] call failed", { operation, code: failure.code, ...failure.details });
    throw failure;
  }
}

const ACCOUNT_ID = /^acct_[A-Za-z0-9]{8,64}$/;
const SESSION_ID = /^cs_[A-Za-z0-9_]{8,255}$/;

// ---------------------------------------------------------------------------
// webhooks
// ---------------------------------------------------------------------------

export interface VerifiedWebhook {
  id: string;
  type: string;
  /** The connected account the event belongs to; null for a platform-scope event. */
  account: string | null;
  livemode: boolean;
  apiVersion: string | null;
}

/**
 * Verifies a webhook signature over the RAW body and returns the few facts the
 * route needs. Uses the SDK's STATIC `Stripe.webhooks.constructEvent` - it needs
 * the signing secret and nothing else, so it works with `STRIPE_SECRET_KEY`
 * unset (CI, the replay harness). The SDK event is never returned.
 * Throws `WebhookSignatureError` for a bad signature, a stale timestamp or a
 * body that is not an event, and `ProviderError("unconfigured")` if the
 * signing secret is not set.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string): VerifiedWebhook {
  const secret = webhookSecret();
  if (!secret) throw new ProviderError("unconfigured");
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signatureHeader, secret, WEBHOOK_TOLERANCE_SECONDS);
  } catch {
    throw new WebhookSignatureError();
  }
  if (typeof event?.id !== "string" || typeof event?.type !== "string") throw new WebhookSignatureError();
  const body = event as unknown as { account?: unknown; livemode?: unknown; api_version?: unknown };
  return {
    id: event.id,
    type: event.type,
    account: typeof body.account === "string" && body.account !== "" ? body.account : null,
    livemode: body.livemode === true,
    apiVersion: typeof body.api_version === "string" ? body.api_version : null,
  };
}

// ---------------------------------------------------------------------------
// connecting a congregation (Accounts v2 - the platform's own account)
// ---------------------------------------------------------------------------

export async function createConnectedAccount(input: {
  displayName: string;
  contactEmail: string;
  statementDescriptor?: string | null;
  idempotencyKey: string;
}): Promise<{ accountId: string; livemode: boolean }> {
  const params = buildCreateAccountParams({
    displayName: input.displayName,
    contactEmail: input.contactEmail,
    statementDescriptor:
      input.statementDescriptor === undefined
        ? statementDescriptorFor(input.displayName)
        : input.statementDescriptor,
  });
  return call("createConnectedAccount", async (stripe) => {
    const account = await stripe.v2.core.accounts.create(params, { idempotencyKey: input.idempotencyKey });
    if (!ACCOUNT_ID.test(account.id)) throw new ProviderError("bad_response");
    return { accountId: account.id, livemode: account.livemode === true };
  });
}

export async function createOnboardingLink(input: {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<{ url: string; expiresAt: Date | null }> {
  if (!ACCOUNT_ID.test(input.accountId)) throw new ProviderError("bad_response");
  const params = buildOnboardingLinkParams(input);
  return call("createOnboardingLink", async (stripe) => {
    const link = await stripe.v2.core.accountLinks.create(params);
    const url = assertStripeUrl(link.url, ONBOARDING_HOSTS);
    const expires = link.expires_at ? new Date(link.expires_at) : null;
    return { url, expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null };
  });
}

export async function retrieveConnectedAccount(accountId: string): Promise<ConnectionStatusInput> {
  if (!ACCOUNT_ID.test(accountId)) throw new ProviderError("bad_response");
  return call("retrieveConnectedAccount", async (stripe) => {
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ["configuration.merchant", "requirements"],
    });
    return mapV2AccountToStatus(account);
  });
}

// ---------------------------------------------------------------------------
// Checkout (Connect: direct charges on the congregation's account)
// ---------------------------------------------------------------------------

export async function createCheckoutSession(
  input: CheckoutInput & { accountId: string; idempotencyKey: string },
): Promise<{ sessionId: string; url: string }> {
  if (!ACCOUNT_ID.test(input.accountId)) throw new ProviderError("bad_response");
  const params = buildCheckoutParams(input);
  return call("createCheckoutSession", async (stripe) => {
    const session = await stripe.checkout.sessions.create(params, {
      stripeAccount: input.accountId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!SESSION_ID.test(session.id)) throw new ProviderError("bad_response");
    return { sessionId: session.id, url: assertStripeUrl(session.url, CHECKOUT_HOSTS) };
  });
}

// ---------------------------------------------------------------------------
// reconciliation reads (Connect). Projections of money objects, USD only.
// ---------------------------------------------------------------------------

function wholeCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ProviderError("bad_response");
  return value;
}

export async function retrieveBalanceTransaction(
  accountId: string,
  balanceTransactionId: string,
): Promise<{ amountCents: number; feeCents: number; netCents: number; currency: "usd" }> {
  if (!ACCOUNT_ID.test(accountId) || !/^txn_[A-Za-z0-9_]{8,255}$/.test(balanceTransactionId)) {
    throw new ProviderError("bad_response");
  }
  return call("retrieveBalanceTransaction", async (stripe) => {
    const txn = await stripe.balanceTransactions.retrieve(balanceTransactionId, {}, { stripeAccount: accountId });
    if (String(txn.currency).toLowerCase() !== "usd") throw new ProviderError("bad_currency");
    return {
      amountCents: wholeCents(txn.amount),
      feeCents: wholeCents(txn.fee),
      netCents: wholeCents(txn.net),
      currency: "usd" as const,
    };
  });
}

export interface PayoutBalanceRow {
  balanceTransactionId: string;
  /** Stripe's balance-transaction `type` (charge, payment, refund, adjustment, ...). */
  kind: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  paymentIntentId: string | null;
}

/** The contents of an automatic payout (Batch 6). One page; the caller pages on `hasMore`. */
export async function listBalanceTransactionsForPayout(
  accountId: string,
  payoutId: string,
  startingAfter?: string,
): Promise<{ rows: PayoutBalanceRow[]; hasMore: boolean }> {
  if (!ACCOUNT_ID.test(accountId) || !/^po_[A-Za-z0-9_]{8,64}$/.test(payoutId)) {
    throw new ProviderError("bad_response");
  }
  return call("listBalanceTransactionsForPayout", async (stripe) => {
    const page = await stripe.balanceTransactions.list(
      {
        payout: payoutId,
        limit: 100,
        expand: ["data.source"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: accountId },
    );
    const rows = page.data.map((txn): PayoutBalanceRow => {
      if (String(txn.currency).toLowerCase() !== "usd") throw new ProviderError("bad_currency");
      const source = txn.source as unknown as { payment_intent?: unknown } | string | null;
      const pi = typeof source === "object" && source !== null ? source.payment_intent : null;
      return {
        balanceTransactionId: txn.id,
        kind: String(txn.type),
        amountCents: wholeCents(txn.amount),
        feeCents: wholeCents(txn.fee),
        netCents: wholeCents(txn.net),
        paymentIntentId: typeof pi === "string" ? pi : null,
      };
    });
    return { rows, hasMore: page.has_more === true };
  });
}

/** Re-fetches an event whose stored body was purged (replay only). Returns its JSON. */
export async function retrieveEvent(accountId: string, eventId: string): Promise<string> {
  if (!ACCOUNT_ID.test(accountId) || !/^evt_[A-Za-z0-9_]{8,64}$/.test(eventId)) {
    throw new ProviderError("bad_response");
  }
  return call("retrieveEvent", async (stripe) => {
    const event = await stripe.events.retrieve(eventId, {}, { stripeAccount: accountId });
    return JSON.stringify(event);
  });
}

export interface InvoiceForPayment {
  subscriptionId: string | null;
  donor: DonorDetails;
  billingReason: string | null;
}

/**
 * ONE invoice, named by an id taken from an already-signed, claimed inbox event
 * (P3-9): the only way to learn which subscription - hence which intent, fund
 * and donor - a recurring payment belongs to, because a paid Invoice no longer
 * links to its PaymentIntent and `invoice_payment.paid` carries neither the
 * subscription nor the customer. Not a list, not a search, not a customer read;
 * the Invoice's own denormalized `customer_*` fields supply the donor, so no
 * Customers permission is needed. Called from `ingest/process.ts` only.
 */
export async function retrieveInvoiceForPayment(
  accountId: string,
  invoiceId: string,
): Promise<InvoiceForPayment> {
  if (!ACCOUNT_ID.test(accountId) || !/^in_[A-Za-z0-9_]{8,64}$/.test(invoiceId)) {
    throw new ProviderError("bad_response");
  }
  return call("retrieveInvoiceForPayment", async (stripe) => {
    const invoice = await stripe.invoices.retrieve(invoiceId, {}, { stripeAccount: accountId });
    const loose = invoice as unknown as {
      subscription?: unknown;
      customer?: unknown;
      parent?: { subscription_details?: { subscription?: unknown } | null } | null;
    };
    const subscription = loose.parent?.subscription_details?.subscription ?? loose.subscription;
    const customer = loose.customer;
    const address = invoice.customer_address;
    return {
      subscriptionId: idOf(subscription),
      donor: {
        externalCustomerId: idOf(customer) ?? "",
        name: invoice.customer_name ?? null,
        email: invoice.customer_email ?? null,
        address: {
          line1: address?.line1 ?? null,
          line2: address?.line2 ?? null,
          city: address?.city ?? null,
          region: address?.state ?? null,
          postal: address?.postal_code ?? null,
          country: address?.country ?? null,
        },
      },
      billingReason: invoice.billing_reason ?? null,
    };
  });
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "object" && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id !== "") return id;
  }
  return null;
}
