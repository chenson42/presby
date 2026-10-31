# Treasury Increment 3: Contribution entry depth — Work Log

> **Slug:** `2026-10-25-treasury-inc3` (parent: `2026-10-25-treasury`)
> **Surface:** (org) treasurer
> **Permission(s):** TBD at this increment's Phase 1
> **Flag(s):** none expected (per-org toggle, operator rule: no new platform flags before go-live)
> **Estimated complexity:** large
> **Pipeline mode:** Full (child of the multi-increment program; header only until kickoff)
> **Numbers:** **Fresh numbers at kickoff** (none left in the Increment 1–2 block).

Scope (from the parent log's program map, capabilities #10 (counted-offering batches with a two-person count attestation, deposit totals, optional pledges)):

- Counted-offering batches with a two-person count attestation; deposit totals.
- Optional pledges only if FPCW uses them in Church360 (Q10: confirm).
- Designed **before** the ledger because a counted-offering batch is the unit a bank deposit reconciles against; designing the ledger first would force a retrofit.
- Uses the single `giving_funds` concept (architect's answer in Phase 2 of Increment 1).

**Not started.** Phase 1 (analyst) runs at kickoff. Judgment-agent text is recorded verbatim here, not in the parent. Open questions that apply: Q10 (pledges). Reuses `src/lib/treasury/` (team delegation, modules) and `src/lib/csv.ts` from Increment 1; extends `check:treasury-boundaries`.

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
