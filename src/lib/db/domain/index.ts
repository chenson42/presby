/**
 * presby domain schema.
 *
 * Phase 0 (tenancy spine) and Phase 1 (person, roll, officers, groups).
 * Design rationale and the review-findings log live in docs/schema-design.md.
 *
 * Ledger, worship, and check-in are deliberately absent pending their own
 * requirements pass. Events and giving are no longer on that list —
 * docs/work-log/2026-08-26-events-model.md closed events (see ./events) and
 * docs/work-log/2026-10-15-online-giving.md closed giving (see ./giving, which
 * holds the 0055 gift/fund/connection tables and the 0056 statement tables).
 */
export * from "./org";
export * from "./lifecycle";
export * from "./assets";
export * from "./people";
export * from "./person-ext";
export * from "./roll";
export * from "./officers";
export * from "./groups";
export * from "./authz";
export * from "./privacy";
export * from "./returns";
export * from "./publication";
export * from "./support";
export * from "./sites";
export * from "./org-features";
export * from "./org-feature-categories";
export * from "./events";
export * from "./presbytery";
export * from "./staff";
export * from "./imports";
export * from "./giving";
export * from "./domains";
export * from "./invitations";
