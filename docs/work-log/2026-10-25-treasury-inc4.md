# Treasury Increment 4: Fund accounting core — Work Log

> **Slug:** `2026-10-25-treasury-inc4` (parent: `2026-10-25-treasury`)
> **Surface:** (org) treasurer; schema-heavy
> **Permission(s):** TBD at this increment's Phase 1
> **Flag(s):** none expected (per-org toggle, operator rule: no new platform flags before go-live)
> **Estimated complexity:** large (own program-level Phase 1/2 first)
> **Pipeline mode:** Full (child of the multi-increment program; header only until kickoff)
> **Numbers:** **Fresh numbers at kickoff.** DECISION-274–276 and F305–F310 are reserved for this increment's design kickoff, and the ledger alone needs more than that block holds.

Scope (from the parent log's program map, capabilities #11 (chart of accounts, funds unified with `giving_funds`, append-only journal with a balance constraint, opening balances, fiscal periods)):

- Runs its own program-level Phase 1/2 before any design, because the `schema-design-2.md` §7 sketch (double-entry lines, restriction on the fund) differs from the Lions model (cash-basis, single-entry with fund tagging).
- **One fund concept** (architect, Increment 1 Phase 2): reference `giving_funds`, or promote it to `funds` and split the donor-facing columns (`online_display_name`, `offered_online`) into a 1:1 giving table. No parallel `ledger_funds`.
- The reimbursement payment row is ledger-ready (own insert-only row, `unique (id, organization_id)`, no fund column yet).
- F301 follow-up lands here at the latest: generalize the downward-role guard (a module set or a `permissions` column) before the ledger adds a module.
- `ledger.approve` is an existing key nobody holds (S3, the F3b pattern from Increment 1): decide how it is delivered.

**Not started.** Phase 1 (analyst) runs at kickoff. Judgment-agent text is recorded verbatim here, not in the parent. Open questions that apply: Q2 (ledger later; ruled default), Q14 (fiscal year: calendar year, the January 1 boundary binds the finance cutover only).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Pending | — | — |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |
