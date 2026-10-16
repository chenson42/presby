import { GIVE_MESSAGES } from "./giving-copy";
import { parseAmountToCents } from "./money";

/**
 * The give form's contract, as pure code - docs/work-log/2026-10-15-online-
 * giving.md, Phase 3 "Public surface actions" and Batch 4a's "Contract for 4b".
 *
 * PURE: no `server-only`, no database, no imports beyond two pure siblings, so
 * the client form can import the TYPES (and, if it wants, the field names) and
 * a unit test can drive `parseGiveForm()` with nothing mocked. Nothing here is
 * an authority: the database re-validates every field in
 * `presby_giving_create_intent_*` and computes the charged total itself; this
 * is the first, friendlier line of defence that names WHICH field is wrong.
 *
 * A user-typed amount is a STRING parsed exactly once, by `parseAmountToCents`
 * (`"10.999"`, `"1e3"`, `"-5"` and `"٣٠"` are all refused there). Money is
 * integer cents from here on.
 */

/** What a give action returns. The client form switches on `kind`. */
export type GiveResult =
  /** Navigate to `url`: the client re-asserts `new URL(url).origin === "https://checkout.stripe.com"`, then `window.location.assign(url)`. */
  | { kind: "checkout"; url: string }
  | { kind: "invalid"; field: GiveField; message: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  /** Toggle off, not live, no online fund, Stripe not configured: one message for all. */
  | { kind: "unavailable" }
  /** A repeat submit of a key whose Checkout session already exists. */
  | { kind: "already_started" }
  /** "We couldn't start your gift. You haven't been charged." */
  | { kind: "error" };

export type GiveField = "amount" | "fund" | "frequency" | "method" | "form";

export type GiveFrequency = "once" | "monthly";
export type GiveMethod = "card" | "bank" | "either";

/** The FormData field names the give actions read (the contract the form must honour). */
export const GIVE_FORM_FIELDS = {
  amount: "amount",
  fundId: "fundId",
  frequency: "frequency",
  coverFees: "coverFees",
  method: "method",
  idempotencyKey: "idempotencyKey",
  honeypot: "_hp",
  turnstileToken: "turnstileToken",
  /** What Cloudflare's widget injects on its own; accepted when `turnstileToken` is absent. */
  turnstileWidgetField: "cf-turnstile-response",
} as const;

export interface ParsedGive {
  amountCents: number;
  fundId: string;
  frequency: GiveFrequency;
  coverFees: boolean;
  method: GiveMethod;
  idempotencyKey: string;
}

export type ParseGiveResult =
  | { ok: true; value: ParsedGive }
  | { ok: false; result: Extract<GiveResult, { kind: "invalid" }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_AMOUNT_INPUT = 32;

function invalid(field: GiveField, message: string): ParseGiveResult {
  return { ok: false, result: { kind: "invalid", field, message } };
}

/** A FormData entry as a string, or "" when absent or a File. */
export function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Reads and validates the give fields. The FIRST failing field wins, in the
 * order a person fills the form: amount, fund, frequency, method.
 */
export function parseGiveForm(formData: FormData): ParseGiveResult {
  const amountText = formString(formData, GIVE_FORM_FIELDS.amount);
  // A multi-kilobyte "amount" is not a typo; refuse it before it reaches a regex.
  const amount =
    amountText.length > MAX_AMOUNT_INPUT
      ? ({ ok: false, reason: "format" } as const)
      : parseAmountToCents(amountText, "online");
  if (!amount.ok) {
    const message = {
      empty: GIVE_MESSAGES.amountEmpty,
      format: GIVE_MESSAGES.amountFormat,
      too_small: GIVE_MESSAGES.amountTooSmall,
      too_large: GIVE_MESSAGES.amountTooLarge,
    }[amount.reason];
    return invalid("amount", message);
  }

  const fundId = formString(formData, GIVE_FORM_FIELDS.fundId).trim().toLowerCase();
  if (!UUID.test(fundId)) return invalid("fund", GIVE_MESSAGES.fund);

  const frequency = formString(formData, GIVE_FORM_FIELDS.frequency).trim();
  if (frequency !== "once" && frequency !== "monthly") return invalid("frequency", GIVE_MESSAGES.frequency);

  const coverFeesText = formString(formData, GIVE_FORM_FIELDS.coverFees).trim();
  const coverFees = coverFeesText === "on" || coverFeesText === "true";

  const method = formString(formData, GIVE_FORM_FIELDS.method).trim();
  if (method !== "card" && method !== "bank" && method !== "either") {
    return invalid("method", GIVE_MESSAGES.method);
  }
  // The fee depends on the method, so "cover the fees" needs a chosen one.
  if (coverFees && method === "either") return invalid("method", GIVE_MESSAGES.methodForFees);

  const idempotencyKey = formString(formData, GIVE_FORM_FIELDS.idempotencyKey).trim().toLowerCase();
  if (!UUID.test(idempotencyKey)) return invalid("form", GIVE_MESSAGES.form);

  return {
    ok: true,
    value: { amountCents: amount.cents, fundId, frequency, coverFees, method, idempotencyKey },
  };
}

/** A URL-slug shape (a DNS label): the only thing a give action will look up or key a limiter on. */
export function isSlugShaped(slug: unknown): slug is string {
  return typeof slug === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
}
