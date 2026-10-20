/**
 * Provider-neutral giving types — docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "`NormalizedEvent`". NO RUNTIME CODE and no imports: this file is
 * types only, so it can be imported from the provider adapter, the ingest
 * processor, tests and (as a type) the client without pulling anything in.
 * `stripe` is never imported here — the adapter (`providers/stripe/`) turns a
 * provider's body INTO these shapes; nothing downstream knows which provider
 * they came from (R1.F, provider-neutral interface).
 *
 * Amounts are integer CENTS everywhere. Dates that came from a provider
 * payload are `Date`s; the `occurred_on` a gift carries is computed in SQL, in
 * the organization's own time zone, never here (F132).
 */

/** What a provider tells us about a donor on a payment. Untrusted display text
 * and contact data: it is bounded and control-character-stripped in SQL before
 * it is stored, stored as text, and escaped by React everywhere it renders. */
export type DonorDetails = {
  externalCustomerId: string;
  name: string | null;
  email: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postal: string | null;
    country: string | null;
  };
};

/** A connection's capability snapshot, as the status mappers
 * (`providers/stripe/status.ts`) produce it and the
 * `presby_giving_apply_connection_status()` / `..._refresh_my_connection()`
 * functions consume it. Field-for-field the SQL parameters (minus the
 * inbox id and the deauthorized flag). */
export type ConnectionStatusInput = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** Card payments can be offered (capability active). */
  cardEnabled: boolean;
  /** US bank (ACH debit) payments can be offered (capability active). */
  achEnabled: boolean;
  /** The provider still needs something from the account holder. */
  requirementsDue: boolean;
  /** A short machine reason code from the provider when disabled, else null. */
  disabledReason: string | null;
};

/** The payment method a provider reports on a gift. */
export type GiftMethod = "card" | "us_bank_account";

/**
 * One provider event, normalized. `normalize(rawBody)` returns zero or more of
 * these per webhook body; the processor feeds each, in order, to the matching
 * SECURITY DEFINER apply function.
 *
 * Authority notes the shapes encode (R9): a `gift` carries NO fund and NO
 * membership — those come from presby's own checkout-intent row, never from
 * the provider's metadata. A `gift_fee` carries only the balance-transaction
 * id: a number read from a signed event body is never the source of fee data;
 * the processor retrieves the balance transaction through the allowlist and
 * passes fee/net to the apply function. An `invoice_payment.paid` normalizes to
 * a `gift` with `subscriptionId: null` and `donor: null`, and the processor
 * COMPLETES it with `retrieveInvoiceForPayment` before applying (P3-9).
 */
export type NormalizedEvent =
  | {
      kind: "gift";
      status: "pending" | "succeeded" | "failed";
      sessionId: string | null;
      subscriptionId: string | null;
      invoiceId: string | null;
      paymentIntentId: string;
      amountCents: number;
      authorizedAt: Date;
      failureCode: string | null;
      method: GiftMethod | null;
      /** Null for an `invoice_payment.paid`: the processor completes it from the invoice (P3-9). */
      donor: DonorDetails | null;
    }
  | {
      kind: "gift_fee";
      paymentIntentId: string;
      balanceTransactionId: string;
      method: GiftMethod | "wallet" | null;
    }
  | {
      kind: "reversal";
      paymentIntentId: string;
      reversalKind: "refund" | "dispute" | "ach_return" | "reinstatement";
      externalReversalId: string;
      amountCents: number;
      occurredAt: Date;
      /** For a reinstatement: the external id of the reversal it offsets. */
      offsetsExternalReversalId: string | null;
    }
  | {
      kind: "subscription";
      action: "started" | "ended" | "payment_failed";
      sessionId: string | null;
      subscriptionId: string;
      donor: DonorDetails | null;
      at: Date;
    }
  | { kind: "intent_expired"; sessionId: string }
  | {
      kind: "settlement";
      externalSettlementId: string;
      status: "paid" | "failed";
      /** `YYYY-MM-DD`, or null when the provider gave none. */
      arrivalDate: string | null;
      grossCents: number;
      automatic: boolean;
    }
  | {
      kind: "connection_status";
      status: ConnectionStatusInput;
      deauthorized: boolean;
    };

export type NormalizedEventKind = NormalizedEvent["kind"];
