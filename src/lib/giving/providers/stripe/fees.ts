/**
 * Fee math for the Stripe adapter - DISPLAY ONLY (the database recomputes the
 * charged total in `presby_giving_create_intent_*`). The implementation lives
 * in `src/lib/giving/money.ts` because the formula is provider-neutral (it is
 * a donor-facing preview of a database function; Batch 1b, deviation 1). This
 * file is the Phase 3 path for it, so a Stripe-specific caller can import from
 * the adapter folder without caring where the math sits.
 */
export { DEFAULT_RATES, grossUp, type FeeRates, type GrossUpMethod } from "../../money";
