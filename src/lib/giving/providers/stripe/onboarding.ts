import type Stripe from "stripe";

/**
 * Request builders for connecting a congregation's Stripe account - docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Stripe confirmations" 1. PURE: they only
 * assemble the parameter objects `client.ts` hands to the SDK, so the exact
 * Accounts v2 body is unit-tested without a network and without the SDK's
 * runtime (type-only import).
 *
 * The create body cannot be changed after the fact: `defaults.responsibilities`
 * is immutable once the merchant configuration exists, so it is exactly the
 * confirmed shape - a full Dashboard for the congregation, Stripe collecting the
 * fees and carrying the losses (presby takes no application fee and no
 * liability), card and ACH debit requested. `us_bank_transfer_payments` is a
 * different, push-style capability and is NOT requested.
 */

export type CreateAccountParams = Stripe.V2.Core.AccountCreateParams;
export type AccountLinkParams = Stripe.V2.Core.AccountLinkCreateParams;

/**
 * A statement descriptor Stripe will accept, derived from the congregation's
 * name: 5-22 characters, at least one letter, none of `< > \ ' " *`. Returns
 * `null` when nothing usable is left, in which case the field is omitted and
 * Stripe falls back to the name it collects during onboarding (G15).
 */
export function statementDescriptorFor(displayName: string): string | null {
  const cleaned = displayName
    .replace(/[\u0000-\u001f\u007f<>\\'"*]/g, " ")
    .replace(/[^\x20-\x7e]/g, " ") // Latin-only: Stripe's descriptor charset
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22)
    .trim();
  return cleaned.length >= 5 && /[A-Za-z]/.test(cleaned) ? cleaned : null;
}

export function buildCreateAccountParams(input: {
  displayName: string;
  contactEmail: string;
  statementDescriptor: string | null;
}): CreateAccountParams {
  const merchant: NonNullable<NonNullable<CreateAccountParams["configuration"]>["merchant"]> = {
    capabilities: {
      card_payments: { requested: true },
      ach_debit_payments: { requested: true },
    },
  };
  if (input.statementDescriptor) {
    merchant.statement_descriptor = { descriptor: input.statementDescriptor };
  }
  return {
    display_name: input.displayName.slice(0, 200),
    contact_email: input.contactEmail,
    dashboard: "full",
    identity: { country: "us", entity_type: "company" },
    configuration: { merchant },
    defaults: {
      currency: "usd",
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
    },
    include: ["configuration.merchant", "identity", "defaults", "requirements"],
  };
}

export function buildOnboardingLinkParams(input: {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}): AccountLinkParams {
  return {
    account: input.accountId,
    use_case: {
      type: "account_onboarding",
      // No `configurations` list: Phase 3's research read it off a docs page,
      // but the pinned SDK's own generated typings do not have it - stripe-node's
      // CHANGELOG records "Remove support for `configurations` on
      // V2.Core.AccountLinkCreateParams.use_case.account_onboarding". The
      // typings are generated from the exact API version we pin, so they win.
      // If the operator's test-mode smoke is refused with
      // `configs_must_match_to_use_account_links`, this is the one place to add it.
      account_onboarding: {
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
      },
    },
  };
}
