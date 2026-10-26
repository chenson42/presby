# Treasury Increment 2: Giving continuity — Work Log

> **Slug:** `2026-10-25-treasury-inc2` (parent: `2026-10-25-treasury`)
> **Surface:** (org) treasurer and platform import door; giving admin riders
> **Permission(s):** TBD at this increment's Phase 1
> **Flag(s):** none expected (per-org toggle, operator rule: no new platform flags before go-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full (child of the multi-increment program; header only until kickoff)
> **Numbers:** **Migration: a fresh number at kickoff.** The parent's pre-assignment of 0074 to this increment is void: Increment 1 now holds 0073 (schema) and 0074 (permissions, templates, backfill). Careers holds 0075. DECISION-272–273 and F302–F304 remain pre-assigned to this increment. Dev port: assign at kickoff (3590 is Increment 1's).

Scope (from the parent log's program map, capabilities #6 (giving hardening riders), #7 (gift-history import door), #8 (Vanco settled-transaction import); #9 (statements go-live) is an operator and CPA track, not code):

- Giving hardening backlog as small riders (G17 monthly-gift list, G24 manual link, three overpromising or dead-end copy items, return pages that name no church, and similar).
- The repo-side gift-history import door: widen the `giving_gifts` source and provider vocabulary; idempotent on `(org, provider, external_transaction_id)`. The import script itself stays in `private/` (no general importer).
- Vanco settled-transaction import (depth "a" only: no hosted pages, no recurring-gift management, no second provider adapter; operator Q3 default).
- Timing: targets pre-cutover because giving moves to PresbyPortal at cutover (operator Q4). It must land before the January 2028 statement run in any case.

**Not started.** Phase 1 (analyst) runs at kickoff. Judgment-agent text is recorded verbatim here, not in the parent. Open questions that apply: Q3 (Vanco depth), Q4 (giving moves at cutover; ruled), Q9. Operator action outside code: ask Vanco for a sample settlement and donor-detail export, invented data only in the repo; recurring Vanco donors must re-enroll (Track K).
Dependency: F289 (`2026-10-25-public-asset-allowlist`) must be live before `GIVING_STATEMENTS_ENABLED` is set.

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
