/**
 * Statement policy constants — docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Pure helpers" (G10, G11). One place for each ruling that a CPA or
 * denominational-counsel answer could flip, so flipping it is a one-line
 * change reviewed on its own, not a hunt through the statement code.
 *
 * Pure: no imports, safe for `server-only` and client code alike.
 */

/**
 * G10 / Operator Q6 (CPA ruling pending). When a donor ticks "cover the
 * processing fees", the card is charged `gift + covered fee`. TRUE means the
 * whole amount charged counts as the donor's contribution on the year-end
 * statement (the covered fee is a gift to the congregation, deductible as one);
 * FALSE means only the base gift counts and the covered fee is excluded.
 *
 * The stored data supports either answer with no migration: each gift carries
 * `amount_cents` (the TOTAL charged) and `donor_covered_fee_cents` separately.
 * Statement assembly reads this constant and nothing else for the decision.
 * Default TRUE until the CPA rules (the donor demonstrably gave the money to the
 * congregation); issuing a real statement is gated on that ruling regardless
 * (`GIVING_STATEMENTS_ENABLED`).
 */
export const COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION: boolean = true;

/**
 * The version of the code-generated statement wording (the quid-pro-quo
 * sentence, the "no goods or services" statement, the receipt-vs-
 * acknowledgment language). Snapshotted onto each issued statement so a later
 * wording change never rewrites what an old statement said. Bump when the
 * generated text changes; never edit a snapshot.
 */
export const STATEMENT_WORDING_VERSION = 1;
