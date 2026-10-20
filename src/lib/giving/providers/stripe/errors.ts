/**
 * Errors the Stripe adapter throws. They carry a CODE and nothing else a
 * caller could log by accident: the message is fixed text per code, never the
 * SDK's `message` (which can echo a request fragment) and never a key. The
 * only diagnostic detail is a small struct of Stripe's own error `type`,
 * `code` and request id - the three things `client.ts` is allowed to log.
 *
 * Kept out of `client.ts` so the allowlist's export set stays exactly the set
 * Phase 3 lists, and so callers (the connect actions, the processor) can
 * `instanceof`-check without importing the module that imports `stripe`.
 */

export type ProviderErrorCode =
  /** STRIPE_SECRET_KEY (or the webhook secret) is not set on this installation. */
  | "unconfigured"
  /** A URL Stripe returned (or we were about to send) is not on an allowed origin. */
  | "bad_origin"
  /** Stripe answered, but not with the shape / values we require. */
  | "bad_response"
  /** A balance transaction (or other money object) was not in USD. */
  | "bad_currency"
  /** Stripe said 404: the object does not exist on that account. */
  | "not_found"
  /** HTTP 429 from Stripe. */
  | "rate_limited"
  /** Could not reach Stripe (connection / timeout). */
  | "network"
  /** Any other Stripe-side failure (auth, invalid request, api error). */
  | "stripe_error";

const MESSAGES: Record<ProviderErrorCode, string> = {
  unconfigured: "Stripe is not configured on this installation.",
  bad_origin: "Stripe returned a URL that is not on an allowed Stripe address.",
  bad_response: "Stripe returned a response presby cannot use.",
  bad_currency: "Stripe returned a non-USD amount.",
  not_found: "Stripe could not find that object.",
  rate_limited: "Stripe is rate limiting requests. Try again shortly.",
  network: "Could not reach Stripe.",
  stripe_error: "Stripe could not complete the request.",
};

export interface ProviderErrorDetails {
  stripeType?: string;
  stripeCode?: string;
  requestId?: string;
  statusCode?: number;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly details: ProviderErrorDetails;

  constructor(code: ProviderErrorCode, details: ProviderErrorDetails = {}) {
    super(MESSAGES[code]);
    this.name = "ProviderError";
    this.code = code;
    this.details = details;
  }

  /** Worth retrying later (a processor backs off rather than dead-lettering). */
  get transient(): boolean {
    return this.code === "rate_limited" || this.code === "network" || this.code === "stripe_error";
  }
}

/** The signature did not verify (or the body is not an event). The route answers 400. */
export class WebhookSignatureError extends Error {
  constructor() {
    super("The webhook signature could not be verified.");
    this.name = "WebhookSignatureError";
  }
}
