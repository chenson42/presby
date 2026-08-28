/**
 * presby domain schema.
 *
 * Phase 0 (tenancy spine) and Phase 1 (person, roll, officers, groups).
 * Design rationale and the review-findings log live in docs/schema-design.md.
 *
 * Ledger, giving, worship, and check-in are deliberately absent pending their
 * own requirements pass. Events is no longer on that list — docs/work-log/
 * 2026-08-26-events-model.md is the requirements pass that closed it; see
 * ./events.
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
export * from "./support";
export * from "./sites";
export * from "./org-features";
export * from "./org-feature-categories";
export * from "./events";
export * from "./presbytery";
