/**
 * presby domain schema.
 *
 * Phase 0 (tenancy spine) and Phase 1 (person, roll, officers, groups).
 * Design rationale and the review-findings log live in docs/schema-design.md.
 *
 * Ledger, giving, events, worship, and check-in are deliberately absent pending
 * their own requirements pass.
 */
export * from "./org";
export * from "./assets";
export * from "./people";
export * from "./person-ext";
export * from "./roll";
export * from "./officers";
export * from "./groups";
export * from "./authz";
export * from "./privacy";
export * from "./reporting";
